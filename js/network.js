class NetworkManager {
    constructor(game) {
        this.game = game;
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.playerId = null;
        this.otherPlayers = new Map();
        this.pendingMessages = [];
    }
    
    async connect() {
        if (this.connected) return true;
        
        return new Promise((resolve, reject) => {
            try {
                // In a real game, this would connect to your game server
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                const host = window.location.host;
                this.socket = new WebSocket(`${protocol}//${host}/game`);
                
                this.socket.onopen = () => {
                    console.log('Connected to game server');
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.flushPendingMessages();
                    resolve(true);
                };
                
                this.socket.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };
                
                this.socket.onclose = () => {
                    console.log('Disconnected from game server');
                    this.connected = false;
                    this.handleDisconnect();
                };
                
                this.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    this.connected = false;
                    reject(error);
                };
                
            } catch (error) {
                console.error('Failed to connect to server:', error);
                this.connected = false;
                reject(error);
            }
        });
    }
    
    handleMessage(message) {
        if (!message || !message.type) return;
        
        switch (message.type) {
            case 'player_connected':
                this.handlePlayerConnected(message);
                break;
                
            case 'player_disconnected':
                this.handlePlayerDisconnected(message);
                break;
                
            case 'player_update':
                this.handlePlayerUpdate(message);
                break;
                
            case 'world_update':
                this.handleWorldUpdate(message);
                break;
                
            case 'chat_message':
                this.handleChatMessage(message);
                break;
                
            default:
                console.log('Unknown message type:', message.type);
        }
    }
    
    handlePlayerConnected(data) {
        console.log(`Player connected: ${data.playerId}`);
        
        // If this is our connection, store our player ID
        if (data.isLocalPlayer) {
            this.playerId = data.playerId;
            
            // Set up periodic position updates
            setInterval(() => {
                this.sendPlayerUpdate();
            }, 1000 / CONFIG.NETWORK.SYNC_RATE);
        } else {
            // Create a representation of the other player
            this.createOtherPlayer(data);
        }
    }
    
    handlePlayerDisconnected(data) {
        console.log(`Player disconnected: ${data.playerId}`);
        this.removeOtherPlayer(data.playerId);
    }
    
    handlePlayerUpdate(data) {
        // Update other player's position/state
        const otherPlayer = this.otherPlayers.get(data.playerId);
        if (otherPlayer) {
            // Interpolate to new position
            if (data.position) {
                otherPlayer.targetPosition = new BABYLON.Vector3(
                    data.position.x,
                    data.position.y,
                    data.position.z
                );
            }
            
            // Update animation
            if (data.animation && otherPlayer.mesh) {
                // In a real game, this would update the player's animation
                console.log(`Player ${data.playerId} animation: ${data.animation}`);
            }
        }
    }
    
    handleWorldUpdate(data) {
        // Update world state (NPCs, items, etc.)
        // This would be implemented based on your game's needs
        console.log('World update:', data);
    }
    
    handleChatMessage(data) {
        // Display chat message in UI
        if (this.game.ui) {
            this.game.ui.addChatMessage(data.sender, data.message, data.isSystem);
        }
    }
    
    createOtherPlayer(data) {
        // Don't create duplicate players
        if (this.otherPlayers.has(data.playerId)) return;
        
        // Create a simple representation of the other player
        const otherPlayer = {
            id: data.playerId,
            name: data.name || `Player_${data.playerId}`,
            position: new BABYLON.Vector3(0, 0, 0),
            targetPosition: null,
            mesh: null
        };
        
        // Create a simple mesh for the other player
        otherPlayer.mesh = BABYLON.MeshBuilder.CreateCylinder(`player_${data.playerId}`, {
            height: 2,
            diameter: 0.8
        }, this.game.scene);
        
        // Set initial position
        if (data.position) {
            otherPlayer.mesh.position = new BABYLON.Vector3(
                data.position.x,
                data.position.y,
                data.position.z
            );
        }
        
        // Set material (different color for other players)
        const material = new BABYLON.StandardMaterial(`playerMat_${data.playerId}`, this.game.scene);
        material.diffuseColor = new BABYLON.Color3(0.2, 0.8, 0.2);
        otherPlayer.mesh.material = material;
        
        // Add to other players map
        this.otherPlayers.set(data.playerId, otherPlayer);
    }
    
    removeOtherPlayer(playerId) {
        const otherPlayer = this.otherPlayers.get(playerId);
        if (otherPlayer && otherPlayer.mesh) {
            otherPlayer.mesh.dispose();
        }
        this.otherPlayers.delete(playerId);
    }
    
    sendPlayerUpdate() {
        if (!this.connected || !this.game.player) return;
        
        const message = {
            type: 'player_update',
            position: {
                x: this.game.player.mesh.position.x,
                y: this.game.player.mesh.position.y,
                z: this.game.player.mesh.position.z
            },
            rotation: {
                x: this.game.player.mesh.rotation.x,
                y: this.game.player.mesh.rotation.y,
                z: this.game.player.mesh.rotation.z
            },
            animation: this.game.player.currentAnimationName || 'idle',
            timestamp: Date.now()
        };
        
        this.send(message);
    }
    
    sendChatMessage(message) {
        this.send({
            type: 'chat_message',
            message: message,
            timestamp: Date.now()
        });
    }
    
    send(message) {
        if (!message) return;
        
        // Add timestamp if not set
        if (!message.timestamp) {
            message.timestamp = Date.now();
        }
        
        // If not connected, queue the message
        if (!this.connected) {
            this.pendingMessages.push(message);
            return;
        }
        
        // Send the message
        try {
            this.socket.send(JSON.stringify(message));
        } catch (error) {
            console.error('Failed to send message:', error);
            this.pendingMessages.push(message);
            this.connected = false;
        }
    }
    
    flushPendingMessages() {
        while (this.pendingMessages.length > 0) {
            const message = this.pendingMessages.shift();
            this.send(message);
        }
    }
    
    handleDisconnect() {
        // Clear all other players
        for (const playerId of this.otherPlayers.keys()) {
            this.removeOtherPlayer(playerId);
        }
        
        // Try to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            console.log(`Attempting to reconnect in ${delay/1000} seconds...`);
            
            setTimeout(() => {
                this.reconnectAttempts++;
                this.connect().catch(console.error);
            }, delay);
        } else {
            console.error('Max reconnection attempts reached');
            // Notify the player
            if (this.game.ui) {
                this.game.ui.showNotification('Disconnected from server', 'error');
            }
        }
    }
    
    update(deltaTime) {
        // Update other players (interpolate positions)
        for (const player of this.otherPlayers.values()) {
            if (player.targetPosition && player.mesh) {
                // Simple linear interpolation
                player.mesh.position = BABYLON.Vector3.Lerp(
                    player.mesh.position,
                    player.targetPosition,
                    Math.min(1, deltaTime * 5) // Adjust the factor for smoother/faster movement
                );
            }
        }
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.connected = false;
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = NetworkManager;
}
