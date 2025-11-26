// network.js
class Network {
    constructor() {
        this.socket = null;
        this.messageQueue = [];
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.connect();
    }

    async connect() {
        try {
            this.socket = new WebSocket(CONFIG.NETWORK.SERVER_URL);
            
            this.socket.onopen = () => {
                console.log('Connected to server');
                this.isConnected = true;
                this.reconnectAttempts = 0;
                this.processMessageQueue();
            };

            this.socket.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };

            this.socket.onclose = () => {
                this.isConnected = false;
                console.log('Disconnected from server');
                this.handleReconnect();
            };

            this.socket.onerror = (error) => {
                console.error('WebSocket error:', error);
                this.socket.close();
            };
        } catch (error) {
            console.error('Failed to connect:', error);
            this.handleReconnect();
        }
    }

    send(message) {
        if (this.isConnected) {
            this.socket.send(JSON.stringify(message));
        } else {
            this.messageQueue.push(message);
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
        console.log('Received message:', message);
        // Add your message handling logic here
    }

    handleReconnect() {
        if (this.reconnectAttempts < CONFIG.NETWORK.MAX_RECONNECT_ATTEMPTS) {
            this.reconnectAttempts++;
            console.log(`Attempting to reconnect (${this.reconnectAttempts}/${CONFIG.NETWORK.MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(() => this.connect(), CONFIG.NETWORK.RECONNECT_DELAY);
        } else {
            console.error('Max reconnection attempts reached');
        }
    }

    disconnect() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
            this.isConnected = false;
        }
    }
}
