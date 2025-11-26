class UIManager {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.ui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI');
        this.healthBar = null;
        this.staminaBar = null;
        this.ammoText = null;
        this.init();
    }

    init() {
        this.createHealthBar();
        this.createStaminaBar();
        this.createAmmoCounter();
        this.createCrosshair();
    }

    createHealthBar() {
        const panel = new BABYLON.GUI.StackPanel();
        panel.width = '200px';
        panel.height = '30px';
        panel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        panel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        panel.left = '20px';
        panel.top = '-50px';
        
        const header = new BABYLON.GUI.TextBlock();
        header.text = 'HEALTH';
        header.height = '20px';
        header.color = 'white';
        panel.addControl(header);
        
        const background = new BABYLON.GUI.Rectangle();
        background.width = 1;
        background.height = '20px';
        background.color = 'black';
        background.background = '#333';
        background.thickness = 1;
        
        this.healthBar = new BABYLON.GUI.Rectangle();
        this.healthBar.width = 1;
        this.healthBar.height = 1;
        this.healthBar.background = '#ff3300';
        this.healthBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        background.addControl(this.healthBar);
        
        panel.addControl(background);
        this.ui.addControl(panel);
    }

    createStaminaBar() {
        // Similar to health bar but for stamina
    }

    createAmmoCounter() {
        this.ammoText = new BABYLON.GUI.TextBlock();
        this.ammoText.text = 'AMMO: 30/120';
        this.ammoText.color = 'white';
        this.ammoText.fontSize = 24;
        this.ammoText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ammoText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.ammoText.left = '-20px';
        this.ammoText.top = '-20px';
        this.ui.addControl(this.ammoText);
    }

    createCrosshair() {
        const crosshair = new BABYLON.GUI.Ellipse();
        crosshair.width = '10px';
        crosshair.height = '10px';
        crosshair.color = 'white';
        crosshair.thickness = 2;
        this.ui.addControl(crosshair);
    }

    update() {
        // Update health bar
        if (this.healthBar) {
            const healthPercent = this.player.health / this.player.maxHealth;
            this.healthBar.width = healthPercent;
            this.healthBar.background = healthPercent > 0.5 ? '#33cc33' : 
                                       healthPercent > 0.2 ? '#ff9900' : '#ff3300';
        }
        
        // Update other UI elements...
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
        
        // Remove message after duration
        setTimeout(() => {
            this.ui.removeControl(message);
        }, duration);
    }

    dispose() {
        this.ui.dispose();
    }
}

class NetworkManager {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.socket = null;
        this.connected = false;
        this.playerId = null;
        this.players = new Map();
        this.init();
    }

    init() {
        // Initialize WebSocket connection
        this.socket = new WebSocket('wss://yourserver.com/game');
        
        this.socket.onopen = () => {
            console.log('Connected to server');
            this.connected = true;
            this.send('player_join', {
                name: 'Player',
                position: this.player.mesh.position
            });
        };
        
        this.socket.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
        };
        
        this.socket.onclose = () => {
            console.log('Disconnected from server');
            this.connected = false;
            // Attempt to reconnect
            setTimeout(() => this.init(), 5000);
        };
    }

    handleMessage(data) {
        switch (data.type) {
            case 'player_joined':
                this.handlePlayerJoined(data);
                break;
            case 'player_left':
                this.handlePlayerLeft(data);
                break;
            case 'player_update':
                this.handlePlayerUpdate(data);
                break;
            case 'world_state':
                this.handleWorldState(data);
                break;
        }
    }

    handlePlayerJoined(data) {
        if (data.id === this.playerId) return;
        
        // Create a representation of the other player
        const playerMesh = BABYLON.MeshBuilder.CreateBox(`player_${data.id}`, {
            size: 1
        }, this.scene);
        playerMesh.position = new BABYLON.Vector3(
            data.position.x,
            data.position.y,
            data.position.z
        );
        
        this.players.set(data.id, {
            id: data.id,
            mesh: playerMesh,
            name: data.name
        });
    }

    handlePlayerLeft(data) {
        const player = this.players.get(data.id);
        if (player) {
            player.mesh.dispose();
            this.players.delete(data.id);
        }
    }

    handlePlayerUpdate(data) {
        const player = this.players.get(data.id);
        if (player) {
            // Update player position and rotation
            player.mesh.position.x = data.position.x;
            player.mesh.position.y = data.position.y;
            player.mesh.position.z = data.position.z;
            player.mesh.rotation.y = data.rotation.y;
        }
    }

    handleWorldState(data) {
        // Update all players' positions from server
        data.players.forEach(playerData => {
            if (playerData.id === this.playerId) return;
            
            let player = this.players.get(playerData.id);
            if (!player) {
                this.handlePlayerJoined(playerData);
                player = this.players.get(playerData.id);
            }
            
            // Interpolate to smooth movement
            BABYLON.Vector3.LerpToRef(
                player.mesh.position,
                new BABYLON.Vector3(
                    playerData.position.x,
                    playerData.position.y,
                    playerData.position.z
                ),
                0.2,
                player.mesh.position
            );
            
            // Update rotation
            player.mesh.rotation.y = playerData.rotation.y;
        });
    }

    send(type, data) {
        if (!this.connected) return;
        
        this.socket.send(JSON.stringify({
            type,
            ...data,
            playerId: this.playerId,
            timestamp: Date.now()
        }));
    }

    update() {
        if (!this.connected || !this.playerId) return;
        
        // Send player update to server
        this.send('player_update', {
            position: this.player.mesh.position,
            rotation: this.player.mesh.rotation,
            health: this.player.health
        });
    }

    dispose() {
        if (this.socket) {
            this.socket.close();
        }
        this.players.forEach(player => player.mesh.dispose());
        this.players.clear();
    }
}
