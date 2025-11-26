class Network {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.pendingMessages = [];
        this.eventListeners = {};
        
        // Connect to server
        this.connect();
    }
    
    connect() {
        try {
            // Create WebSocket connection
            this.socket = new WebSocket(CONFIG.NETWORK.SERVER_URL);
            
            // Connection opened
            this.socket.onopen = () => {
                console.log('Connected to server');
                this.connected = true;
                this.reconnectAttempts = 0;
                
                // Send any pending messages
                this.flushPendingMessages();
                
                // Trigger connect event
                this.trigger('connect');
            };
            
            // Listen for messages
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    this.handleMessage(data);
                } catch (error) {
                    console.error('Error parsing message:', error);
                }
            };
            
            // Handle connection closed
            this.socket.onclose = () => {
                console.log('Disconnected from server');
                this.connected = false;
                this.trigger('disconnect');
                
                // Try to reconnect
                this.reconnect();
            };
            
            // Handle errors
            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.connected = false;
                this.trigger('error', error);
            };
            
        } catch (error) {
            console.error('Error connecting to server:', error);
            this.reconnect();
        }
    }
    
    reconnect() {
        if (this.reconnectAttempts < CONFIG.NETWORK.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
            
            console.log(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${CONFIG.NETWORK.MAX_RECONNECT_ATTEMPTS})`);
            
            setTimeout(() => {
                this.connect();
            }, delay);
        } else {
            console.error('Max reconnection attempts reached');
            this.trigger('reconnect_failed');
        }
    }
    
    send(type, data = {}) {
        const message = {
            type,
            data,
            timestamp: Date.now()
        };
        
        const messageStr = JSON.stringify(message);
        
        if (this.connected) {
            this.socket.send(messageStr);
        } else {
            console.log('Queueing message (not connected):', type, data);
            this.pendingMessages.push(messageStr);
        }
    }
    
    flushPendingMessages() {
        if (this.connected && this.pendingMessages.length > 0) {
            console.log(`Flushing ${this.pendingMessages.length} pending messages`);
            
            for (const message of this.pendingMessages) {
                this.socket.send(message);
            }
            
            this.pendingMessages = [];
        }
    }
    
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        
        this.eventListeners[event].push(callback);
        return () => this.off(event, callback);
    }
    
    off(event, callback) {
        if (this.eventListeners[event]) {
            const index = this.eventListeners[event].indexOf(callback);
            if (index !== -1) {
                this.eventListeners[event].splice(index, 1);
            }
        }
    }
    
    trigger(event, ...args) {
        if (this.eventListeners[event]) {
            for (const callback of this.eventListeners[event]) {
                try {
                    callback(...args);
                } catch (error) {
                    console.error(`Error in ${event} handler:`, error);
                }
            }
        }
    }
    
    handleMessage(message) {
        // Handle different message types
        switch (message.type) {
            case 'player_joined':
                this.handlePlayerJoined(message.data);
                break;
                
            case 'player_left':
                this.handlePlayerLeft(message.data);
                break;
                
            case 'player_update':
                this.handlePlayerUpdate(message.data);
                break;
                
            case 'world_state':
                this.handleWorldState(message.data);
                break;
                
            case 'chat_message':
                this.handleChatMessage(message.data);
                break;
                
            default:
                console.log('Unhandled message type:', message.type, message.data);
                break;
        }
        
        // Trigger generic message event
        this.trigger('message', message);
    }
    
    // Message handlers
    handlePlayerJoined(data) {
        console.log('Player joined:', data);
        this.trigger('player_joined', data);
    }
    
    handlePlayerLeft(data) {
        console.log('Player left:', data);
        this.trigger('player_left', data);
    }
    
    handlePlayerUpdate(data) {
        this.trigger('player_update', data);
    }
    
    handleWorldState(data) {
        this.trigger('world_state', data);
    }
    
    handleChatMessage(data) {
        console.log('Chat:', data);
        this.trigger('chat_message', data);
    }
    
    // Disconnect from server
    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        
        this.connected = false;
        this.pendingMessages = [];
        this.eventListeners = {};
    }
}

// Make Network class globally available
window.Network = Network;
