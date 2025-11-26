// network.js - Network communication
export class Network {
    constructor() {
        this.socket = null;
        this.connected = false;
        this.messageQueue = [];
    }

    async connect() {
        return new Promise((resolve, reject) => {
            try {
                this.socket = new WebSocket(CONFIG.NETWORK.SERVER_URL);
                
                this.socket.onopen = () => {
                    this.connected = true;
                    console.log('Connected to server');
                    this.processMessageQueue();
                    resolve();
                };
                
                this.socket.onmessage = (event) => {
                    this.handleMessage(JSON.parse(event.data));
                };
                
                this.socket.onclose = () => {
                    this.connected = false;
                    console.log('Disconnected from server');
                    this.handleReconnect();
                };
                
                this.socket.onerror = (error) => {
                    console.error('Network error:', error);
                    reject(error);
                };
            } catch (error) {
                console.error('Failed to connect:', error);
                reject(error);
            }
        });
    }

    send(message) {
        if (!this.connected) {
            this.messageQueue.push(message);
            return false;
        }
        
        try {
            this.socket.send(JSON.stringify(message));
            return true;
        } catch (error) {
            console.error('Failed to send message:', error);
            return false;
        }
    }

    processMessageQueue() {
        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift();
            this.send(message);
        }
    }

    handleMessage(message) {
        // Handle incoming messages from server
        // Example: if (message.type === 'playerUpdate') { ... }
    }

    handleReconnect() {
        if (this.reconnectAttempts >= CONFIG.NETWORK.MAX_RECONNECT_ATTEMPTS) {
            console.error('Max reconnection attempts reached');
            return;
        }
        
        setTimeout(() => {
            console.log('Attempting to reconnect...');
            this.connect();
        }, CONFIG.NETWORK.RECONNECT_DELAY);
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.connected = false;
        }
    }
}