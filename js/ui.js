class UI {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.elements = {};
        this.chatMessages = [];
        this.maxChatMessages = 10;
        
        // Initialize UI
        this.init();
    }
    
    init() {
        // Create UI elements
        this.createHealthBar();
        this.createCrosshair();
        this.createChat();
        this.createMessageDisplay();
        
        // Setup event listeners
        this.setupEventListeners();
        
        console.log('UI initialized');
    }
    
    createHealthBar() {
        // Create health bar container
        const container = document.createElement('div');
        container.id = 'health-bar-container';
        container.style.position = 'absolute';
        container.style.bottom = '20px';
        container.style.left = '20px';
        container.style.width = '200px';
        container.style.height = '20px';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        container.style.borderRadius = '10px';
        container.style.overflow = 'hidden';
        
        // Create health bar
        const healthBar = document.createElement('div');
        healthBar.id = 'health-bar';
        healthBar.style.height = '100%';
        healthBar.style.width = '100%';
        healthBar.style.backgroundColor = '#4CAF50';
        healthBar.style.transition = 'width 0.3s';
        
        // Add to container
        container.appendChild(healthBar);
        document.body.appendChild(container);
        
        // Store reference
        this.elements.healthBar = healthBar;
    }
    
    createCrosshair() {
        // Create crosshair container
        const container = document.createElement('div');
        container.id = 'crosshair';
        container.style.position = 'absolute';
        container.style.top = '50%';
        container.style.left = '50%';
        container.style.transform = 'translate(-50%, -50%)';
        container.style.width = '20px';
        container.style.height = '20px';
        
        // Create crosshair elements
        const horizontal = document.createElement('div');
        horizontal.style.position = 'absolute';
        horizontal.style.top = '50%';
        horizontal.style.left = '0';
        horizontal.style.width = '100%';
        horizontal.style.height = '2px';
        horizontal.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        horizontal.style.transform = 'translateY(-50%)';
        
        const vertical = document.createElement('div');
        vertical.style.position = 'absolute';
        vertical.style.top = '0';
        vertical.style.left = '50%';
        vertical.style.width = '2px';
        vertical.style.height = '100%';
        vertical.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
        vertical.style.transform = 'translateX(-50%)';
        
        // Add to container
        container.appendChild(horizontal);
        container.appendChild(vertical);
        document.body.appendChild(container);
        
        // Store reference
        this.elements.crosshair = container;
    }
    
    createChat() {
        // Create chat container
        const container = document.createElement('div');
        container.id = 'chat-container';
        container.style.position = 'absolute';
        container.style.bottom = '60px';
        container.style.left = '20px';
        container.style.width = '300px';
        container.style.maxHeight = '200px';
        container.style.overflowY = 'auto';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        container.style.padding = '10px';
        container.style.borderRadius = '5px';
        container.style.color = '#fff';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '14px';
        container.style.display = 'none'; // Hidden by default
        
        // Create chat messages container
        const messages = document.createElement('div');
        messages.id = 'chat-messages';
        container.appendChild(messages);
        
        // Create chat input
        const input = document.createElement('input');
        input.id = 'chat-input';
        input.type = 'text';
        input.placeholder = 'Press T to chat...';
        input.style.width = '100%';
        input.style.marginTop = '10px';
        input.style.padding = '5px';
        input.style.border = 'none';
        input.style.borderRadius = '3px';
        input.style.display = 'none'; // Hidden by default
        
        // Add to container
        container.appendChild(input);
        document.body.appendChild(container);
        
        // Store references
        this.elements.chatContainer = container;
        this.elements.chatMessages = messages;
        this.elements.chatInput = input;
        
        // Setup chat input handling
        this.setupChatInput();
    }
    
    createMessageDisplay() {
        // Create message display container
        const container = document.createElement('div');
        container.id = 'message-display';
        container.style.position = 'absolute';
        container.style.top = '20px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        container.style.padding = '10px 20px';
        container.style.borderRadius = '5px';
        container.style.color = '#fff';
        container.style.fontFamily = 'Arial, sans-serif';
        container.style.fontSize = '16px';
        container.style.textAlign = 'center';
        container.style.opacity = '0';
        container.style.transition = 'opacity 0.3s';
        
        // Add to document
        document.body.appendChild(container);
        
        // Store reference
        this.elements.messageDisplay = container;
    }
    
    setupEventListeners() {
        // Toggle chat with T key
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 't' && !this.elements.chatInput.matches(':focus')) {
                this.toggleChat(true);
            } else if (e.key === 'Escape' && this.elements.chatInput.matches(':focus')) {
                this.toggleChat(false);
            } else if (e.key === 'Enter' && this.elements.chatInput.matches(':focus')) {
                this.sendChatMessage();
            }
        });
    }
    
    setupChatInput() {
        const input = this.elements.chatInput;
        
        // Handle Enter key to send message
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.sendChatMessage();
            }
        });
    }
    
    toggleChat(focus) {
        const chatContainer = this.elements.chatContainer;
        const chatInput = this.elements.chatInput;
        
        if (focus) {
            chatContainer.style.display = 'block';
            chatInput.style.display = 'block';
            chatInput.focus();
        } else {
            chatContainer.style.display = 'none';
            chatInput.style.display = 'none';
            chatInput.blur();
        }
    }
    
    sendChatMessage() {
        const input = this.elements.chatInput;
        const message = input.value.trim();
        
        if (message) {
            // Send chat message to server
            if (window.game && window.game.network) {
                window.game.network.send('chat_message', {
                    text: message,
                    timestamp: Date.now()
                });
            }
            
            // Add to local chat
            this.addChatMessage('You', message);
            
            // Clear input
            input.value = '';
        }
        
        // Hide chat
        this.toggleChat(false);
    }
    
    addChatMessage(sender, message) {
        const messages = this.elements.chatMessages;
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.style.marginBottom = '5px';
        messageEl.style.wordWrap = 'break-word';
        
        // Format message
        const senderEl = document.createElement('span');
        senderEl.style.color = '#4CAF50';
        senderEl.style.fontWeight = 'bold';
        senderEl.textContent = sender + ': ';
        
        const textEl = document.createTextNode(message);
        
        messageEl.appendChild(senderEl);
        messageEl.appendChild(textEl);
        
        // Add to chat
        messages.appendChild(messageEl);
        
        // Limit number of messages
        while (messages.children.length > this.maxChatMessages) {
            messages.removeChild(messages.firstChild);
        }
        
        // Scroll to bottom
        messages.scrollTop = messages.scrollHeight;
    }
    
    showMessage(text, type = 'info') {
        const messageEl = this.elements.messageDisplay;
        
        // Set message text and style based on type
        messageEl.textContent = text;
        
        switch (type) {
            case 'error':
                messageEl.style.backgroundColor = 'rgba(255, 0, 0, 0.7)';
                break;
            case 'success':
                messageEl.style.backgroundColor = 'rgba(0, 200, 0, 0.7)';
                break;
            case 'warning':
                messageEl.style.backgroundColor = 'rgba(255, 165, 0, 0.7)';
                break;
            default:
                messageEl.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        }
        
        // Show message
        messageEl.style.opacity = '1';
        
        // Hide after delay
        clearTimeout(this.messageTimeout);
        this.messageTimeout = setTimeout(() => {
            messageEl.style.opacity = '0';
        }, 3000);
    }
    
    updateHealth(current, max) {
        const healthBar = this.elements.healthBar;
        if (!healthBar) return;
        
        // Calculate health percentage
        const percentage = Math.max(0, Math.min(100, (current / max) * 100));
        
        // Update health bar
        healthBar.style.width = `${percentage}%`;
        
        // Change color based on health
        if (percentage > 60) {
            healthBar.style.backgroundColor = '#4CAF50'; // Green
        } else if (percentage > 30) {
            healthBar.style.backgroundColor = '#FFC107'; // Yellow
        } else {
            healthBar.style.backgroundColor = '#F44336'; // Red
        }
    }
    
    setActiveWeapon(weaponName) {
        // Update UI to show active weapon
        console.log('Active weapon:', weaponName);
        // You can implement weapon UI here
    }
    
    dispose() {
        // Clean up UI elements
        for (const id in this.elements) {
            const element = this.elements[id];
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        }
        
        // Clear event listeners
        document.removeEventListener('keydown', this.onKeyDown);
    }
}

// Make UI class globally available
window.UI = UI;
