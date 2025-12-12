// ============================================================================
// HEROES OF SHADY GROVE - CLIENT NETWORK MANAGER
// Handles real-time multiplayer via WebSocket
// ============================================================================

function NetworkManager(game, url) {
  this.game = game;
  this.url = url || (typeof CONFIG !== 'undefined' && CONFIG.NETWORK ? CONFIG.NETWORK.WS_URL : null);
  
  if (!this.url) {
    console.error("[Network] No WebSocket URL provided");
    return;
  }

  this.socket = null;
  this.connected = false;
  this.shouldReconnect = true;
  this.reconnectAttempt = 0;
  this.reconnectTimeout = null;
  this.sessionId = null;
  this.roomId = 'default_room';
  
  // Other players
  this.otherPlayers = new Map();
  this.playerMeshes = new Map();

  // Position update throttling
  this.lastPositionSent = 0;
  this.positionUpdateRate = 100; // 100ms = 10 updates/second

  this._handlers = {};
  
  console.log('[Network] ✓ Created with URL:', this.url);
}

// ============================================================================
// EVENT SYSTEM
// ============================================================================

NetworkManager.prototype.on = function(eventName, handler) {
  if (!this._handlers[eventName]) {
    this._handlers[eventName] = [];
  }
  this._handlers[eventName].push(handler);
};

NetworkManager.prototype._emit = function(eventName, data) {
  if (this._handlers[eventName]) {
    this._handlers[eventName].forEach(function(handler) {
      handler(data);
    });
  }
};

// ============================================================================
// CONNECTION
// ============================================================================

NetworkManager.prototype.connect = function() {
  var self = this;
  this.shouldReconnect = true;

  if (this.reconnectAttempt >= 5) {
    console.log("[Network] Max reconnection attempts reached");
    return;
  }

  console.log("[Network] Connecting... (attempt " + (this.reconnectAttempt + 1) + ")");

  try {
    this.socket = new WebSocket(this.url);
  } catch (err) {
    console.error("[Network] Failed to create WebSocket:", err);
    this.scheduleReconnect();
    return;
  }

  this.socket.onopen = function() {
    console.log("[Network] ✓ Connected!");
    self.connected = true;
    self.reconnectAttempt = 0;
    self._emit("connected");
    
    // Join room after connection
    setTimeout(function() {
      self.joinRoom();
    }, 100);
  };

  this.socket.onmessage = function(event) {
    self.handleMessage(event);
  };

  this.socket.onerror = function(event) {
    console.error("[Network] WebSocket error");
    self._emit("error", event);
  };

  this.socket.onclose = function() {
    console.log("[Network] Disconnected");
    self.connected = false;
    self._emit("disconnected");
    self.clearOtherPlayers();
    
    if (self.shouldReconnect) {
      self.scheduleReconnect();
    }
  };
};

NetworkManager.prototype.scheduleReconnect = function() {
  var self = this;
  this.reconnectAttempt++;
  var delay = Math.min(1000 * Math.pow(2, this.reconnectAttempt), 10000);
  
  console.log("[Network] Reconnecting in " + (delay / 1000) + " seconds...");
  
  this.reconnectTimeout = setTimeout(function() {
    self.connect();
  }, delay);
};

NetworkManager.prototype.disconnect = function() {
  this.shouldReconnect = false;
  if (this.socket) {
    this.socket.close();
    this.socket = null;
  }
  this.connected = false;
  this.clearOtherPlayers();
  clearTimeout(this.reconnectTimeout);
  this.reconnectAttempt = 0;
};

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

NetworkManager.prototype.handleMessage = function(event) {
  try {
    var message = JSON.parse(event.data);
    
    switch (message.type) {
      case 'welcome':
        this.sessionId = message.sessionId;
        console.log('[Network] Session:', this.sessionId);
        break;
        
      case 'joined':
        console.log('[Network] ✓ Joined room, players online:', message.playersOnline);
        break;
        
      case 'players':
        this.handleExistingPlayers(message.players);
        break;
        
      case 'player_joined':
        this.handlePlayerJoined(message.player);
        break;
        
      case 'player_left':
        this.handlePlayerLeft(message.sessionId);
        break;
        
      case 'position':
        this.handlePositionUpdate(message);
        break;
        
      case 'chat':
        this.handleChatMessage(message);
        break;
        
      case 'action':
        this.handleAction(message);
        break;
    }
  } catch (err) {
    console.error("[Network] Parse error:", err);
  }
};

// ============================================================================
// ROOM & PLAYER MANAGEMENT
// ============================================================================

NetworkManager.prototype.joinRoom = function() {
  if (!this.connected || !this.game.player) {
    console.log('[Network] Cannot join: not ready');
    return;
  }
  
  var characterData = window.supabaseService ? window.supabaseService.currentCharacter : null;
  var characterName = characterData ? characterData.name : 'Adventurer';
  var characterId = characterData ? characterData.id : null;
  var level = this.game.player.level || 1;
  
  this.send({
    type: 'join',
    roomId: this.roomId,
    characterName: characterName,
    characterId: characterId,
    level: level,
    position: {
      x: this.game.player.mesh.position.x,
      y: this.game.player.mesh.position.y,
      z: this.game.player.mesh.position.z
    },
    rotation: this.game.player.mesh.rotation.y
  });
  
  console.log('[Network] Sent join request:', characterName);
};

NetworkManager.prototype.send = function(data) {
  if (this.socket && this.socket.readyState === WebSocket.OPEN) {
    this.socket.send(JSON.stringify(data));
  }
};

NetworkManager.prototype.sendPosition = function() {
  if (!this.connected || !this.game.player || !this.game.player.mesh) return;
  
  // Throttle position updates
  var now = Date.now();
  if (now - this.lastPositionSent < this.positionUpdateRate) {
    return;
  }
  this.lastPositionSent = now;
  
  this.send({
    type: 'position',
    position: {
      x: this.game.player.mesh.position.x,
      y: this.game.player.mesh.position.y,
      z: this.game.player.mesh.position.z
    },
    rotation: this.game.player.mesh.rotation.y
  });
};

NetworkManager.prototype.sendChat = function(message) {
  this.send({
    type: 'chat',
    message: message
  });
};

// ============================================================================
// PLAYER HANDLERS
// ============================================================================

NetworkManager.prototype.handleExistingPlayers = function(players) {
  var self = this;
  console.log('[Network] Received', players.length, 'existing players');
  
  players.forEach(function(playerData) {
    self.createOtherPlayer(playerData);
  });
};

NetworkManager.prototype.handlePlayerJoined = function(playerData) {
  console.log('[Network] Player joined:', playerData.characterName);
  this.createOtherPlayer(playerData);
};

NetworkManager.prototype.handlePlayerLeft = function(sessionId) {
  console.log('[Network] Player left:', sessionId);
  this.removeOtherPlayer(sessionId);
};

NetworkManager.prototype.handlePositionUpdate = function(message) {
  var mesh = this.playerMeshes.get(message.sessionId);
  if (!mesh) return;
  
  // Smooth movement (lerp)
  mesh.position.x += (message.position.x - mesh.position.x) * 0.3;
  mesh.position.y += (message.position.y - mesh.position.y) * 0.3;
  mesh.position.z += (message.position.z - mesh.position.z) * 0.3;
  mesh.rotation.y = message.rotation;
};

NetworkManager.prototype.handleChatMessage = function(message) {
  console.log('[Chat]', message.characterName + ':', message.message);
  this._emit('chat', message);
  
  // Display in combat log
  if (this.game.combat) {
    this.game.combat.logCombat('[' + message.characterName + '] ' + message.message);
  }
};

NetworkManager.prototype.handleAction = function(message) {
  console.log('[Network] Action:', message.action);
  this._emit('action', message);
};

// ============================================================================
// PLAYER MESH CREATION
// ============================================================================

NetworkManager.prototype.createOtherPlayer = function(playerData) {
  if (this.playerMeshes.has(playerData.sessionId)) {
    console.log('[Network] Player already exists:', playerData.sessionId);
    return;
  }
  
  console.log('[Network] Creating player mesh:', playerData.characterName);
  
  // Store player data
  this.otherPlayers.set(playerData.sessionId, playerData);
  
  // Create player mesh (simple capsule for now)
  var playerMesh = BABYLON.MeshBuilder.CreateCapsule(
    'otherPlayer_' + playerData.sessionId,
    { height: 1.8, radius: 0.3 },
    this.game.scene
  );
  
  // Position
  playerMesh.position.x = playerData.position.x;
  playerMesh.position.y = playerData.position.y;
  playerMesh.position.z = playerData.position.z;
  playerMesh.rotation.y = playerData.rotation;
  
  // Material
  var mat = new BABYLON.StandardMaterial('playerMat_' + playerData.sessionId, this.game.scene);
  mat.diffuseColor = new BABYLON.Color3(0.3, 0.6, 1.0); // Blue for other players
  mat.emissiveColor = new BABYLON.Color3(0.1, 0.2, 0.3);
  playerMesh.material = mat;
  
  // Create floating name tag
  this.createNameTag(playerMesh, playerData.characterName, playerData.level);
  
  // Store mesh
  this.playerMeshes.set(playerData.sessionId, playerMesh);
  
  console.log('[Network] ✓ Player created:', playerData.characterName);
};

NetworkManager.prototype.createNameTag = function(parentMesh, name, level) {
  // Create plane for name tag
  var plane = BABYLON.MeshBuilder.CreatePlane(
    'nameTag_' + parentMesh.name,
    { width: 2, height: 0.5 },
    this.game.scene
  );
  
  plane.parent = parentMesh;
  plane.position.y = 1.2; // Above player head
  plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL; // Always face camera
  
  // Create dynamic texture for text
  var texture = new BABYLON.DynamicTexture(
    'nameTagTexture_' + parentMesh.name,
    { width: 512, height: 128 },
    this.game.scene
  );
  
  var mat = new BABYLON.StandardMaterial('nameTagMat_' + parentMesh.name, this.game.scene);
  mat.diffuseTexture = texture;
  mat.emissiveTexture = texture;
  mat.opacityTexture = texture;
  mat.backFaceCulling = false;
  plane.material = mat;
  
  // Draw text
  var ctx = texture.getContext();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, 512, 128);
  
  ctx.font = 'bold 48px Arial';
  ctx.fillStyle = '#00ff00'; // Green text
  ctx.textAlign = 'center';
  ctx.fillText(name + ' (Lv.' + level + ')', 256, 80);
  
  texture.update();
};

NetworkManager.prototype.removeOtherPlayer = function(sessionId) {
  var mesh = this.playerMeshes.get(sessionId);
  if (mesh) {
    mesh.dispose();
    this.playerMeshes.delete(sessionId);
  }
  
  this.otherPlayers.delete(sessionId);
  console.log('[Network] ✓ Player removed:', sessionId);
};

NetworkManager.prototype.clearOtherPlayers = function() {
  var self = this;
  this.playerMeshes.forEach(function(mesh) {
    mesh.dispose();
  });
  this.playerMeshes.clear();
  this.otherPlayers.clear();
  console.log('[Network] ✓ Cleared all other players');
};

// ============================================================================
// UPDATE LOOP
// ============================================================================

NetworkManager.prototype.update = function() {
  // Send position updates if connected
  if (this.connected) {
    this.sendPosition();
  }
};

// ============================================================================
// CLEANUP
// ============================================================================

NetworkManager.prototype.dispose = function() {
  this.disconnect();
  this._handlers = {};
  console.log("[Network] ✓ Disposed");
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NetworkManager;
}
