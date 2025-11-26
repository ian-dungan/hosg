// ui.js - User interface
export class UI {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.elements = {};
        
        this.init();
    }

    init() {
        // Create health bar
        this.createHealthBar();
        
        // Create minimap
        this.createMinimap();
    }

    createHealthBar() {
        // Create health bar elements
        const healthBar = document.createElement('div');
        healthBar.id = 'health-bar';
        healthBar.style.position = 'absolute';
        healthBar.style.bottom = '20px';
        healthBar.style.left = '20px';
        healthBar.style.width = '200px';
        healthBar.style.height = '20px';
        healthBar.style.backgroundColor = '#333';
        healthBar.style.border = '2px solid #000';
        
        const healthFill = document.createElement('div');
        healthFill.id = 'health-fill';
        healthFill.style.width = '100%';
        healthFill.style.height = '100%';
        healthFill.style.backgroundColor = '#f00';
        healthFill.style.transition = 'width 0.3s';
        
        healthBar.appendChild(healthFill);
        document.body.appendChild(healthBar);
        
        this.elements.healthBar = healthBar;
        this.elements.healthFill = healthFill;
    }

    createMinimap() {
        // Create minimap container
        const minimap = document.createElement('div');
        minimap.id = 'minimap';
        minimap.style.position = 'absolute';
        minimap.style.top = '20px';
        minimap.style.right = '20px';
        minimap.style.width = '150px';
        minimap.style.height = '150px';
        minimap.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        minimap.style.border = '2px solid #fff';
        
        document.body.appendChild(minimap);
        this.elements.minimap = minimap;
    }

    update() {
        // Update health bar
        if (this.elements.healthFill) {
            const healthPercent = (this.player.health / CONFIG.PLAYER.START_HEALTH) * 100;
            this.elements.healthFill.style.width = `${healthPercent}%`;
        }
        
        // Update minimap
        // This would update player position on the minimap
    }

    showMessage(message, type = 'info') {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        
        document.body.appendChild(messageElement);
        
        // Remove message after delay
        setTimeout(() => {
            messageElement.remove();
        }, 5000);
    }

    dispose() {
        // Clean up UI elements
        for (const element of Object.values(this.elements)) {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
        }
        this.elements = {};
    }
}