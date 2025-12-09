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
        container.height = height + 20 + "px";
        container.thickness = 0;
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = left + "px";
        container.top = top + "px";

        // Label
        const labelText = new BABYLON.GUI.TextBlock(id + "Label", label);
        labelText.color = "white";
        labelText.fontSize = 14;
        labelText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        labelText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        labelText.paddingLeft = 4;
        labelText.paddingTop = 0;
        container.addControl(labelText);

        // Background bar
        const background = new BABYLON.GUI.Rectangle(id + "Background");
        background.width = "100%";
        background.height = height + "px";
        background.thickness = 1;
        background.color = "white";
        background.background = "#000a";
        background.cornerRadius = 4;
        background.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        background.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.top = 18; // below label
        container.addControl(background);

        // Fill
        const fill = new BABYLON.GUI.Rectangle(id + "Fill");
        fill.width = "100%";
        fill.height = "100%";
        fill.thickness = 0;
        fill.background = color;
        fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        fill.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.addControl(fill);

        // Value text
        const valueText = new BABYLON.GUI.TextBlock(id + "Value", "");
        valueText.color = "white";
        valueText.fontSize = 12;
        valueText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        valueText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        background.addControl(valueText);

        const setValue = (current, max) => {
            max = max || 1;
            const ratio = Math.max(0, Math.min(1, current / max));
            fill.width = (ratio * 100).toFixed(1) + "%";
            valueText.text = `${Math.round(current)}/${Math.round(max)}`;
        };

        // Initialize with full bar
        setValue(1, 1);

        return {
            container,
            background,
            fill,
            valueText,
            setValue
        };
    }

    createDebugInfo() {
        this.debugText = new BABYLON.GUI.TextBlock("debugInfo");
        this.debugText.text = "FPS: 60";
        this.debugText.color = "lime";
        this.debugText.fontSize = 12;
        this.debugText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.debugText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.debugText.paddingTop = "10px";
        this.debugText.paddingRight = "10px";
        this.gui.addControl(this.debugText);
    }
    
    createMinimap() {
        const size = 200; // Minimap size in pixels
        const mapScale = 200; // World units to cover (200x200 world area)
        
        // Minimap container (bottom-right corner)
        const minimapContainer = new BABYLON.GUI.Rectangle("minimapContainer");
        minimapContainer.width = size + "px";
        minimapContainer.height = size + "px";
        minimapContainer.cornerRadius = 10;
        minimapContainer.color = "#ffffff";
        minimapContainer.thickness = 2;
        minimapContainer.background = "#000000";
        minimapContainer.alpha = 0.8;
        minimapContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        minimapContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        minimapContainer.paddingRight = "10px";
        minimapContainer.paddingBottom = "10px";
        this.gui.addControl(minimapContainer);
        
        // Minimap title
        const title = new BABYLON.GUI.TextBlock("minimapTitle", "MAP");
        title.color = "#ffffff";
        title.fontSize = 14;
        title.fontWeight = "bold";
        title.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        title.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        title.paddingTop = "5px";
        minimapContainer.addControl(title);
        
        // Store minimap info
        this.minimap = {
            container: minimapContainer,
            size: size,
            mapScale: mapScale,
            worldToMap: (worldX, worldZ) => {
                // Convert world coordinates to minimap pixel coordinates
                const pixelX = (worldX / mapScale) * (size * 0.8) + size / 2;
                const pixelY = (worldZ / mapScale) * (size * 0.8) + size / 2;
                return { x: pixelX, y: pixelY };
            }
        };
        
        // Add landmarks to minimap
        this.updateMinimapLandmarks();
        
        console.log('[UI] Minimap created');
    }
    
    updateMinimapLandmarks() {
        if (!this.minimap || !this.game.world) return;
        
        // Clear old dots
        for (const dot of this.minimapDots) {
            this.minimap.container.removeControl(dot);
        }
        this.minimapDots = [];
        
        // Get landmarks from world
        const landmarks = this.game.world.getLandmarks();
        
        // Add landmark dots
        for (const landmark of landmarks) {
            const { x, y } = this.minimap.worldToMap(landmark.position.x, landmark.position.z);
            
            // Create dot based on type
            let color = "#ffffff";
            let dotSize = 6;
            
            if (landmark.type === 'building') {
                color = "#ffaa00"; // Orange for buildings
                dotSize = 8;
            } else if (landmark.type === 'tree_grove') {
                color = "#00ff00"; // Green for forests
                dotSize = 12;
            } else if (landmark.type === 'rock_formation') {
                color = "#888888"; // Gray for rocks
                dotSize = 10;
            }
            
            const dot = new BABYLON.GUI.Ellipse(`landmark_${landmark.name}`);
            dot.width = dotSize + "px";
            dot.height = dotSize + "px";
            dot.color = color;
            dot.thickness = 1;
            dot.background = color;
            dot.alpha = 0.7;
            dot.left = (x - this.minimap.size / 2) + "px";
            dot.top = (y - this.minimap.size / 2) + "px";
            
            // Tooltip on hover
            dot.onPointerEnterObservable.add(() => {
                dot.thickness = 2;
                dot.alpha = 1;
                // Could add label popup here
            });
            
            dot.onPointerOutObservable.add(() => {
                dot.thickness = 1;
                dot.alpha = 0.7;
            });
            
            this.minimap.container.addControl(dot);
            this.minimapDots.push(dot);
        }
        
        // Add player dot (last so it's on top)
        const playerDot = new BABYLON.GUI.Ellipse("playerDot");
        playerDot.width = "8px";
        playerDot.height = "8px";
        playerDot.color = "#ff0000";
        playerDot.thickness = 2;
        playerDot.background = "#ffffff";
        this.minimap.container.addControl(playerDot);
        this.minimap.playerDot = playerDot;
        
        console.log('[UI] Minimap updated with', landmarks.length, 'landmarks');
    }

    update(deltaTime) {
        if (!this.player) {
            this.player = this.game.player;
        }
        
        const p = this.player;
        if (!p) return;

        // Update health bar
        if (this.healthBar) {
            this.healthBar.setValue(p.health, p.maxHealth || CONFIG.PLAYER.HEALTH);
        }
        
        // Update mana bar
        if (this.manaBar) {
            const mana = typeof p.mana === "number" ? p.mana : 0;
            const maxMana = typeof p.maxMana === "number" ? p.maxMana : 100;
            this.manaBar.setValue(mana, maxMana);
        }
        
        // Update stamina bar
        if (this.staminaBar) {
            const stamina = typeof p.stamina === "number" ? p.stamina : 0;
            const maxStamina = typeof p.maxStamina === "number" ? p.maxStamina : CONFIG.PLAYER.STAMINA;
            this.staminaBar.setValue(stamina, maxStamina);
        }

        // Update debug info
        if (this.debugText && this.game.engine) {
            const fps = this.game.engine.getFps().toFixed(0);
            const pos = p.mesh ? p.mesh.position : new BABYLON.Vector3(0, 0, 0);
            this.debugText.text = `FPS: ${fps}\nPos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}\nGrounded: ${p.onGround ? 'Yes' : 'No'}`;
        }
        
        // Update minimap player position
        if (this.minimap && this.minimap.playerDot && p.mesh) {
            const { x, y } = this.minimap.worldToMap(p.mesh.position.x, p.mesh.position.z);
            this.minimap.playerDot.left = (x - this.minimap.size / 2) + "px";
            this.minimap.playerDot.top = (y - this.minimap.size / 2) + "px";
        }
    }

    showMessage(message, duration = 3000) {
        const msgText = new BABYLON.GUI.TextBlock("message");
        msgText.text = message;
        msgText.color = "white";
        msgText.fontSize = 18;
        msgText.fontWeight = "bold";
        msgText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        msgText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        msgText.paddingTop = "-100px";
        
        const bg = new BABYLON.GUI.Rectangle("messageBg");
        bg.width = "400px";
        bg.height = "60px";
        bg.thickness = 2;
        bg.color = "white";
        bg.background = "rgba(0, 0, 0, 0.8)";
        bg.cornerRadius = 10;
        bg.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        bg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        bg.paddingTop = "-100px";
        
        bg.addControl(msgText);
        this.gui.addControl(bg);

        setTimeout(() => {
            this.gui.removeControl(bg);
        }, duration);
    }

    dispose() {
        if (this.gui) {
            this.gui.dispose();
            this.gui = null;
        }
    }

    showDamageNumber(amount, position, isPlayerHit) {
        var prefix = isPlayerHit ? "-" : "";
        var text = "" + prefix + amount;
        this.showFloatingText(text, position, isPlayerHit ? "playerDamage" : "enemyDamage", 800);
    }

    showFloatingText(text, position, type, duration) {
        if (!this.gui || !this.scene || typeof BABYLON === "undefined" || !BABYLON.GUI) {
            return;
        }

        if (typeof type === "undefined") type = "default";
        if (typeof duration === "undefined") duration = 1500;

        var label = new BABYLON.GUI.TextBlock("floatingText");
        label.text = text;
        label.fontSize = 20;
        label.outlineWidth = 2;
        label.outlineColor = "black";

        if (type === "gold") {
            label.color = "#ffd700";
        } else if (type === "playerDamage") {
            label.color = "#ff3333";
        } else if (type === "enemyDamage") {
            label.color = "#ffffff";
        } else {
            label.color = "white";
        }

        label.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        label.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        label.top = "-35%";
        label.left = "0px";

        this.gui.addControl(label);

        var scene = this.scene;
        var startTime = performance.now();
        var total = duration;

        var observer = scene.onBeforeRenderObservable.add(function () {
            var t = (performance.now() - startTime) / total;
            if (t >= 1) {
                scene.onBeforeRenderObservable.remove(observer);
                this.gui.removeControl(label);
            } else {
                var offset = -35 - t * 15;
                label.top = offset + "%";
                label.alpha = 1 - t;
            }
        }.bind(this));
    }
}

window.UIManager = UIManager;
