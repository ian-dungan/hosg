class NetworkManager {
  constructor(game) {
    this.game = game;
    this.socket = null;
    this.connected = false;
    this.playerId = null;
    this.players = new Map();
    this.ping = 0;
    this.lastPingTime = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.pingInterval = null;
  }
  
  async connect() {
    try {
      // Generate a unique player ID if not already set
      if (!this.playerId) {
        this.playerId = localStorage.getItem('playerId') || this.generateId();
        localStorage.setItem('playerId', this.playerId);
      }
      
      // Connect to WebSocket server
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
      this.socket = new WebSocket(wsUrl);
      
      // Set up event handlers
      this.socket.onopen = () => this.onOpen();
      this.socket.onmessage = (event) => this.onMessage(event);
      this.socket.onclose = () => this.onClose();
      this.socket.onerror = (error) => this.onError(error);
      
      debugLog('Connecting to server...');
      
    } catch (error) {
      console.error('Error connecting to server:', error);
      this.handleConnectionError(error);
    }
  }
  
  onOpen() {
    debugLog('Connected to server');
    this.connected = true;
    this.reconnectAttempts = 0;
    
    // Send player info to server
    this.send({
      type: 'player_join',
      playerId: this.playerId,
      position: this.game.player?.state.position?.asArray() || [0, 0, 0],
      rotation: this.game.player?.state.rotation || 0
    });
    
    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, 10000);
  }
  
  onMessage(event) {
    try {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'welcome':
          this.handleWelcome(data);
          break;
          
        case 'player_joined':
          this.handlePlayerJoined(data);
          break;
          
        case 'player_left':
          this.handlePlayerLeft(data);
          break;
          
        case 'player_update':
          this.handlePlayerUpdate(data);
          break;
          
        case 'chat_message':
          this.handleChatMessage(data);
          break;
          
        case 'pong':
          this.handlePong(data);
          break;
          
        default:
          console.warn('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  }
  
  onClose() {
    debugLog('Disconnected from server');
    this.connected = false;
    
    // Clear ping interval
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    // Try to reconnect
    this.tryReconnect();
  }
  
  onError(error) {
    console.error('WebSocket error:', error);
    this.handleConnectionError(error);
  }
  
  handleConnectionError(error) {
    console.error('Connection error:', error);
    
    // Try to reconnect if not already reconnecting
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
      debugLog(`Reconnecting in ${delay / 1000} seconds... (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.game.showError('Unable to connect to the server. Please check your internet connection and refresh the page.');
    }
  }
  
  tryReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
      debugLog(`Attempting to reconnect in ${delay / 1000} seconds... (Attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
      }, delay);
    } else {
      console.error('Max reconnection attempts reached');
      this.game.showError('Disconnected from server. Please refresh the page to reconnect.');
    }
  }
  
  sendPing() {
    if (!this.connected) return;
    
    this.lastPingTime = Date.now();
    this.send({
      type: 'ping',
      timestamp: this.lastPingTime
    });
  }
  
  handlePong(data) {
    if (data.timestamp === this.lastPingTime) {
      this.ping = Date.now() - this.lastPingTime;
      debugLog(`Ping: ${this.ping}ms`);
    }
  }
  
  handleWelcome(data) {
    debugLog('Welcome message received:', data);
    
    // Update player ID if server provided a new one
    if (data.playerId) {
      this.playerId = data.playerId;
      localStorage.setItem('playerId', this.playerId);
    }
    
    // Handle initial game state
    if (data.players) {
      for (const playerData of data.players) {
        if (playerData.id !== this.playerId) {
          this.addRemotePlayer(playerData);
        }
      }
    }
  }
  
  handlePlayerJoined(data) {
    if (data.player.id === this.playerId) return;
    this.addRemotePlayer(data.player);
  }
  
  handlePlayerLeft(data) {
    this.removeRemotePlayer(data.playerId);
  }
  
  handlePlayerUpdate(data) {
    // Update remote player
    if (data.playerId !== this.playerId && this.players.has(data.playerId)) {
      const player = this.players.get(data.playerId);
      if (player && player.updateFromNetwork) {
        player.updateFromNetwork(data);
      }
    }
  }
  
  handleChatMessage(data) {
    if (this.game.ui) {
      this.game.ui.addChatMessage(data.sender, data.message, data.timestamp);
    }
  }
  
  addRemotePlayer(playerData) {
    if (this.players.has(playerData.id)) return;
    
    debugLog('Adding remote player:', playerData.id);
    
    // Create a simple representation of the remote player
    const player = {
      id: playerData.id,
      name: playerData.name || `Player_${playerData.id.substring(0, 6)}`,
      position: new BABYLON.Vector3().fromArray(playerData.position || [0, 0, 0]),
      rotation: playerData.rotation || 0,
      mesh: null,
      nameLabel: null
    };
    
    // Create a simple mesh for the remote player
    const mesh = BABYLON.MeshBuilder.CreateCapsule(`player_${player.id}`, {
      height: 1.8,
      radius: 0.4
    }, this.game.scene);
    
    // Position the mesh
    mesh.position = player.position.clone();
    mesh.rotation.y = player.rotation;
    
    // Create material
    const material = new BABYLON.StandardMaterial(`playerMaterial_${player.id}`, this.game.scene);
    material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 1.0); // Blueish color for other players
    mesh.material = material;
    
    // Enable shadows
    this.game.shadowGenerator.addShadowCaster(mesh);
    
    // Create name label
    const nameLabel = new BABYLON.GUI.Rectangle(`playerName_${player.id}`);
    nameLabel.background = 'rgba(0, 0, 0, 0.5)';
    nameLabel.height = '30px';
    nameLabel.width = '120px';
    nameLabel.cornerRadius = 5;
    
    const nameText = new BABYLON.GUI.TextBlock(`playerNameText_${player.id}`, player.name);
    nameText.color = 'white';
    nameText.fontSize = 14;
    nameLabel.addControl(nameText);
    
    // Create advanced dynamic texture
    const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('playerUI', true, this.game.scene);
    advancedTexture.addControl(nameLabel);
    
    // Position the name label above the player
    nameLabel.linkWithMesh(mesh);
    nameLabel.linkOffsetY = -50;
    
    // Store the player
    player.mesh = mesh;
    player.nameLabel = nameLabel;
    player.updateFromNetwork = (data) => {
      if (data.position) {
        mesh.position = BABYLON.Vector3.FromArray(data.position);
      }
      if (data.rotation !== undefined) {
        mesh.rotation.y = data.rotation;
      }
    };
    
    this.players.set(player.id, player);
  }
  
  removeRemotePlayer(playerId) {
    if (!this.players.has(playerId)) return;
    
    debugLog('Removing remote player:', playerId);
    
    const player = this.players.get(playerId);
    
    // Clean up mesh
    if (player.mesh) {
      player.mesh.dispose();
    }
    
    // Clean up name label
    if (player.nameLabel) {
      player.nameLabel.dispose();
    }
    
    // Remove from players map
    this.players.delete(playerId);
  }
  
  sendChatMessage(message) {
    if (!this.connected || !message.trim()) return;
    
    this.send({
      type: 'chat_message',
      message: message.trim()
    });
  }
  
  sendPlayerUpdate() {
    if (!this.connected || !this.game.player) return;
    
    this.send({
      type: 'player_update',
      position: this.game.player.state.position.asArray(),
      rotation: this.game.player.state.rotation,
      state: {
        health: this.game.player.state.health,
        maxHealth: this.game.player.state.maxHealth,
        isMoving: this.game.player.state.isMoving,
        isAttacking: this.game.player.state.isAttacking
      }
    });
  }
  
  send(data) {
    if (!this.connected || !this.socket) {
      console.warn('Cannot send message, not connected to server');
      return;
    }
    
    try {
      this.socket.send(JSON.stringify(data));
    } catch (error) {
      console.error('Error sending message:', error);
    }
  }
  
  update(deltaTime) {
    // Send player updates at a fixed rate
    if (this.connected && this.game.player) {
      this.sendPlayerUpdate();
    }
    
    // Update remote players
    for (const [id, player] of this.players) {
      // Update name label position
      if (player.mesh && player.nameLabel) {
        const screenPos = BABYLON.Vector3.Project(
          new BABYLON.Vector3(
            player.mesh.position.x,
            player.mesh.position.y + 2,
            player.mesh.position.z
          ),
          BABYLON.Matrix.Identity(),
          this.game.scene.getTransformMatrix(),
          this.game.scene.activeCamera.viewport.toGlobal(
            this.game.scene.getEngine().getRenderWidth(),
            this.game.scene.getEngine().getRenderHeight()
          )
        );
        
        player.nameLabel.left = `${screenPos.x - 60}px`;
        player.nameLabel.top = `${screenPos.y}px`;
      }
    }
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    
    this.connected = false;
  }
  
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
}
