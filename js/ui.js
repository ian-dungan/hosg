// UI Manager - simple HUD with health/mana/stamina bars
class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;

        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);

        this.hud = null;
        this.healthBar = null;
        this.manaBar = null;
        this.staminaBar = null;
        this.debugText = null;
        this.minimap = null;
        this.minimapDots = [];
        this.playerDot = null; 

        this._init();
    }

    _init() {
        this.createHUD();
        this.createMinimap();
        if (CONFIG.DEBUG) {
            this.createDebugInfo();
        }
    }

    createHUD() {
        // Root HUD container
        this.hud = new BABYLON.GUI.Rectangle("hudRoot");
        this.hud.width = "100%";
        this.hud.height = "100%";
        this.hud.thickness = 0;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.gui.addControl(this.hud);

        // Health bar
        this.healthBar = this.createStatusBar(
            "health",
            "HP",
            "#ff4040",
            200,
            18,
            10,
            10
        );
        this.hud.addControl(this.healthBar.container);

        // Mana bar
        this.manaBar = this.createStatusBar(
            "mana",
            "MP",
            "#4080ff",
            200,
            18,
            10,
            40
        );
        this.hud.addControl(this.manaBar.container);

        // Stamina bar
        this.staminaBar = this.createStatusBar(
            "stamina",
            "ST",
            "#40ff40",
            200,
            18,
            10,
            70
        );
        this.hud.addControl(this.staminaBar.container);
    }

    createStatusBar(id, label, color, width, height, left, top) {
        const container = new BABYLON.GUI.Rectangle(id + "Container");
        container.width = width + "px";
        container.height = height + "px";
        container.cornerRadius = 5;
        container.color = color;
        container.thickness = 1;
        container.background = "rgba(0, 0, 0, 0.5)";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = left + "px";
        container.top = top + "px";
        
        const labelText = new BABYLON.GUI.TextBlock(id + "Label", label);
        labelText.width = "30px";
        labelText.color = "white";
        labelText.fontSize = 12;
        labelText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        labelText.paddingLeft = "5px";
        container.addControl(labelText);

        const bar = new BABYLON.GUI.Rectangle(id + "Bar");
        bar.width = "100%"; // Will be dynamically scaled
        bar.height = 1;
        bar.background = color;
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        bar.thickness = 0;
        container.addControl(bar);
        
        return { container, bar, label: labelText };
    }

    createMinimap() {
        this.minimap = new BABYLON.GUI.Rectangle("minimapContainer");
        this.minimap.width = "150px";
        this.minimap.height = "150px";
        this.minimap.cornerRadius = 10;
        this.minimap.background = "rgba(0, 0, 0, 0.5)";
        this.minimap.thickness = 1;
        this.minimap.color = "white";
        this.minimap.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.minimap.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.minimap.paddingRight = "10px";
        this.minimap.paddingTop = "10px";
        this.gui.addControl(this.minimap);

        // Player dot (always in center of minimap)
        this.playerDot = new BABYLON.GUI.Ellipse("playerDot");
        this.playerDot.width = "5px";
        this.playerDot.height = "5px";
        this.playerDot.color = "yellow";
        this.playerDot.background = "yellow";
        this.playerDot.thickness = 0;
        this.minimap.addControl(this.playerDot);

        // Call immediately to populate the map, which was the source of the crash
        this.updateMinimapLandmarks();
    }

    // Patched function that fixes the TypeError crash
    updateMinimapLandmarks() {
        if (!this.game.world || !this.player || !this.player.mesh) return;

        // Clean up previous dots
        this.minimapDots.forEach(dot => dot.dispose());
        this.minimapDots = [];

        // Define map constants
        const mapSize = 150; 
        const worldSize = this.game.world.options.size || 1000;
        const scale = mapSize / worldSize; 

        const playerX = this.player.mesh.position.x;
        const playerZ = this.player.mesh.position.z;
        
        // Combine NPCs and Enemies, defensively checking for null arrays
        const entities = [...(this.game.world.npcs || []), ...(this.game.world.enemies || [])];
        
        for (const entity of entities) {
            // FIX: Safely check if entity, its mesh, and its position are valid
            if (!entity || !entity.mesh || !entity.mesh.position) {
                continue; // Skip any entity that is null, undefined, or missing its position
            }

            // Calculate position relative to player (center of minimap)
            const entityX = entity.mesh.position.x;
            const entityZ = entity.mesh.position.z;
            
            const dotX = (entityX - playerX) * scale;
            const dotY = (entityZ - playerZ) * scale;

            // Only draw dots within the minimap's bounds
            if (Math.abs(dotX) < mapSize / 2 && Math.abs(dotY) < mapSize / 2) {
                const isEnemy = entity.constructor.name === 'Enemy';

                const dot = new BABYLON.GUI.Ellipse("mapDot");
                dot.width = isEnemy ? "4px" : "3px";
                dot.height = isEnemy ? "4px" : "3px";
                dot.color = isEnemy ? "red" : "blue";
                dot.background = isEnemy ? "red" : "blue";
                dot.thickness = 0;
                dot.left = dotX + "px";
                dot.top = -dotY + "px"; 
                
                this.minimap.addControl(dot);
                this.minimapDots.push(dot);
            }
        }

        // Update player dot (always in center)
        this.playerDot.left = "0px";
        this.playerDot.top = "0px";

    }

    update(deltaTime) {
        // Update status bars
        this.updateStatusBar(this.healthBar, this.player.health, this.player.maxHealth);
        this.updateStatusBar(this.manaBar, this.player.mana, this.player.maxMana);
        this.updateStatusBar(this.staminaBar, this.player.stamina, this.player.maxStamina);

        // Update minimap landmarks
        this.updateMinimapLandmarks();

        if (this.debugText) {
            this.updateDebugInfo();
        }
    }

    updateStatusBar(statusBar, current, max) {
        const percentage = Math.max(0, current / max);
        statusBar.bar.width = percentage * 100 + "%";
        statusBar.label.text = `${statusBar.label.text.substring(0, 2)} ${Math.floor(current)}/${max}`;
    }
    
    // Placeholder functions (inferred/required for class completeness)
    createDebugInfo() { /* Implementation omitted for brevity */ }
    updateDebugInfo() { /* Implementation omitted for brevity */ }
    showMessage(text, duration) { /* Implementation omitted for brevity */ }
    
    // Combat UI methods
    showCombatUI(show) {
        // Simple implementation - just logs for now
        // Could add target frame, combat log window, etc.
        console.log(`[UI] Combat UI ${show ? 'shown' : 'hidden'}`);
    }
    
    updateXPBar() {
        // Update XP display
        if (this.player && this.player.stats) {
            console.log(`[UI] XP: ${this.player.stats.currentXP}/${this.player.stats.level * 100}`);
        }
    }
    
    updatePlayerStats() {
        // Update stat displays after level up
        console.log(`[UI] Stats updated`);
    }
    
    updateCombatLog(entry) {
        // Add to combat log
        console.log(`[UI] ${entry}`);
    }
    
    dispose() { /* Implementation omitted for brevity */ }
}
