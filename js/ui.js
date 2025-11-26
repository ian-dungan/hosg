// ui.js - User Interface
class UI {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.healthBar = null;
        this.healthText = null;
        this.messageElement = null;
        this.init();
    }

    init() {
        this.createHealthBar();
        this.createMessageElement();
    }

    createHealthBar() {
        // Create health bar container
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.top = '20px';
        container.style.left = '20px';
        container.style.width = '200px';
        container.style.height = '30px';
        container.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        container.style.borderRadius = '5px';
        container.style.overflow = 'hidden';
        document.body.appendChild(container);

        // Create health bar
        this.healthBar = document.createElement('div');
        this.healthBar.style.height = '100%';
        this.healthBar.style.width = '100%';
        this.healthBar.style.backgroundColor = '#4CAF50';
        this.healthBar.style.transition = 'width 0.3s';
        container.appendChild(this.healthBar);

        // Create health text
        this.healthText = document.createElement('div');
        this.healthText.style.position = 'absolute';
        this.healthText.style.top = '0';
        this.healthText.style.left = '0';
        this.healthText.style.width = '100%';
        this.healthText.style.height = '100%';
        this.healthText.style.display = 'flex';
        this.healthText.style.alignItems = 'center';
        this.healthText.style.justifyContent = 'center';
        this.healthText.style.color = 'white';
        this.healthText.style.fontWeight = 'bold';
        container.appendChild(this.healthText);
    }

    createMessageElement() {
        this.messageElement = document.createElement('div');
        this.messageElement.className = 'message';
        document.body.appendChild(this.messageElement);
    }

    showMessage(text, type = 'info') {
        this.messageElement.textContent = text;
        this.messageElement.className = `message ${type}`;
        this.messageElement.style.display = 'block';
        
        // Hide message after 3 seconds
        setTimeout(() => {
            this.messageElement.style.display = 'none';
        }, 3000);
    }

    update() {
        // Update health bar
        if (this.player && this.healthBar && this.healthText) {
            const healthPercent = (this.player.health / CONFIG.PLAYER.START_HEALTH) * 100;
            this.healthBar.style.width = `${healthPercent}%`;
            this.healthBar.style.backgroundColor = 
                healthPercent > 50 ? '#4CAF50' : 
                healthPercent > 20 ? '#FFC107' : '#F44336';
            this.healthText.textContent = `HP: ${Math.ceil(this.player.health)}/${CONFIG.PLAYER.START_HEALTH}`;
        }
    }

    dispose() {
        // Clean up UI elements
        if (this.healthBar && this.healthBar.parentNode) {
            this.healthBar.parentNode.remove();
        }
        if (this.messageElement && this.messageElement.parentNode) {
            this.messageElement.parentNode.removeChild(this.messageElement);
        }
    }
}

// Make UI globally available
window.UI = UI;
