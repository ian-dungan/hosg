class UIManager {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.ui = null;
        this.healthBar = null;
        this.init();
    }

    init() {
        // Create advanced texture for UI
        this.ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        
        // Create health bar
        this.createHealthBar();
        
        console.log('UI initialized');
    }

    createHealthBar() {
        const panel = new BABYLON.GUI.Rectangle();
        panel.width = '200px';
        panel.height = '30px';
        panel.cornerRadius = 10;
        panel.color = 'white';
        panel.thickness = 2;
        panel.background = 'rgba(0, 0, 0, 0.5)';
        panel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        panel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        panel.top = '20px';
        panel.left = '20px';
        this.ui.addControl(panel);

        const healthText = new BABYLON.GUI.TextBlock();
        healthText.text = 'HEALTH';
        healthText.color = 'white';
        healthText.fontSize = 16;
        healthText.top = '-10px';
        healthText.left = '10px';
        healthText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        panel.addControl(healthText);

        this.healthBar = new BABYLON.GUI.Rectangle();
        this.healthBar.width = '90%';
        this.healthBar.height = '60%';
        this.healthBar.cornerRadius = 5;
        this.healthBar.background = '#ff3300';
        this.healthBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.healthBar.left = '5%';
        this.healthBar.top = '20px';
        panel.addControl(this.healthBar);
    }

    update() {
        if (this.healthBar && this.player) {
            const healthPercent = this.player.health / this.player.maxHealth;
            this.healthBar.width = `${healthPercent * 90}%`;
            this.healthBar.background = healthPercent > 0.5 ? '#33cc33' : 
                                       healthPercent > 0.2 ? '#ff9900' : '#ff3300';
        }
    }

    showMessage(text, duration = 3000) {
        const message = new BABYLON.GUI.TextBlock();
        message.text = text;
        message.color = 'white';
        message.fontSize = 24;
        message.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        message.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        message.top = '50px';
        this.ui.addControl(message);
        
        setTimeout(() => {
            this.ui.removeControl(message);
        }, duration);
    }

    dispose() {
        if (this.ui) {
            this.ui.dispose();
            this.ui = null;
        }
    }
}

class NetworkManager {
    constructor() {
        this.connected = false;
        this.socket = null;
    }

    connect() {
        console.log('Network manager initialized (no actual connection)');
        this.connected = true;
        return Promise.resolve();
    }

    send(event, data) {
        console.log(`[NETWORK] ${event}`, data);
    }

    disconnect() {
        this.connected = false;
        console.log('Disconnected from server');
    }

    dispose() {
        this.disconnect();
    }
}

// Export classes to global scope
window.UIManager = UIManager;
window.NetworkManager = NetworkManager;
