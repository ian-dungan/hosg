// UI Manager - simple HUD with health/mana/stamina bars
class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;

        // CRITICAL: Ensure BABYLON.GUI is available before creating UI
        if (typeof BABYLON.GUI === 'undefined') {
            console.error('[UI] BABYLON.GUI is not loaded. Cannot initialize UIManager.');
            // Create a temporary object to avoid null reference errors
            this.gui = { addControl: () => {}, removeControl: () => {} };
            return;
        }

        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);

        this.hud = null;
        this.healthBar = null;
        this.manaBar = null;
        this.staminaBar = null;
        this.debugText = null;
        this.minimap = null;
        this.minimapDots = [];
        this.messageContainer = null;
        this.messageQueue = [];
        this.isShowingMessage = false;

        this._init();
    }

    _init() {
        this.createHUD();
        this.createMinimap();
        if (typeof CONFIG !== 'undefined' && CONFIG.DEBUG) {
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
        
        // Message Container (Center of screen, for general messages)
        this.messageContainer = new BABYLON.GUI.Rectangle("messageContainer");
        this.messageContainer.width = "400px";
        this.messageContainer.height = "50px";
        this.messageContainer.thickness = 0;
        this.messageContainer.background = "#00000088";
        this.messageContainer.color = "#ffffff";
        this.messageContainer.isVisible = false;
        this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.messageContainer.top = "10%";
        this.gui.addControl(this.messageContainer);
        
        this.messageText = new BABYLON.GUI.TextBlock("messageText", "");
        this.messageText.color = "white";
        this.messageText.fontSize = 24;
        this.messageContainer.addControl(this.messageText);
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
        this.debugText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
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
        
        // Map Area (for dots)
        const mapArea = new BABYLON.GUI.Rectangle("mapArea");
        mapArea.width = "80%";
        mapArea.height = "80%";
        mapArea.thickness = 0;
        minimapContainer.addControl(mapArea);
        
        // Player dot
        const playerDot = new BABYLON.GUI.Ellipse("playerDot");
        playerDot.width = "10px";
        playerDot.height = "10px";
        playerDot.color = "yellow";
        playerDot.background = "yellow";
        playerDot.thickness = 1;
        playerDot.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        playerDot.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        mapArea.addControl(playerDot);
        
        // Store minimap info
        this.minimap = {
            container: minimapContainer,
            mapArea: mapArea,
            playerDot: playerDot,
            size: size,
            mapScale: mapScale,
            // Convert world coordinates to minimap % offset from center
            worldToMapPercent: (worldX, worldZ) => {
                const offsetX = worldX / (mapScale / 2);
                const offsetY = worldZ / (mapScale / 2); // Z maps to vertical axis
                return { x: offsetX * 50, y: -offsetY * 50 }; // % offset, Y is inverted
            }
        };
        
        // Initial landmark update
        this.updateMinimapLandmarks();
        
        console.log('[UI] Minimap created');
    }
    
    updateMinimapLandmarks() {
        if (!this.minimap || !this.game.world) return;
        
        // Only run this once, or when world state changes significantly (new building, etc.)
        if (this.minimapDots.length > 0) return;
        
        // Get landmarks from world (Now fixed by the patch in world.js)
        const landmarks = this.game.world.getLandmarks();
        
        // Add landmark dots
        for (const landmark of landmarks) {
            const { x: percentX, y: percentY } = this.minimap.worldToMapPercent(landmark.position.x, landmark.position.z);
            
            // Create dot based on type
            let color = "#ffffff";
            let dotSize = 8;
            let shape = "Ellipse";
            
            if (landmark.type === 'building' || landmark.type === 'fort') {
                color = "#ffaa00"; // Orange for structures
                dotSize = 10;
                shape = "Rectangle";
            } else if (landmark.type === 'tree_grove') {
                color = "#00ff00"; // Green for forests
                dotSize = 12;
            } else if (landmark.type === 'cave' || landmark.type === 'ruin') {
                color = "#aaaaaa"; // Grey for ruins/caves
                dotSize = 8;
            } else if (landmark.type === 'water') {
                color = "#0000ff"; // Blue for water features
                dotSize = 6;
            } else {
                 color = "#ffffff";
                 dotSize = 6;
            }
            
            const dot = (shape === "Rectangle") 
                ? new BABYLON.GUI.Rectangle(`landmarkDot_${landmark.name}`)
                : new BABYLON.GUI.Ellipse(`landmarkDot_${landmark.name}`);
                
            dot.width = dotSize + "px";
            dot.height = dotSize + "px";
            dot.color = color;
            dot.background = color;
            dot.thickness = 1;
            
            // Set position using percentages
            dot.left = percentX + "%";
            dot.top = percentY + "%";
            
            this.minimap.mapArea.addControl(dot);
            this.minimapDots.push(dot);
            
            // Add tooltip on hover
            dot.onPointerEnterObservable.add(() => {
                this.showMessage(landmark.name, 0, "tooltip", landmark.position);
            });
            dot.onPointerOutObservable.add(() => {
                this.hideMessage("tooltip");
            });
        }
        
        console.log(`[UI] Loaded ${landmarks.length} minimap landmarks.`);
    }

    update(deltaTime) {
        // Update status bars
        if (this.player) {
            this.updatePlayerStats(this.player);
        }

        // Process message queue
        this.processMessageQueue(deltaTime);
    }
    
    updatePlayerStats(player) {
        if (this.healthBar) {
            this.healthBar.setValue(player.health, player.maxHealth);
        }
        if (this.manaBar) {
            this.manaBar.setValue(player.mana, player.maxMana);
        }
        if (this.staminaBar) {
            this.staminaBar.setValue(player.stamina, player.maxStamina);
        }
    }
    
    updateDebugText(text) {
        if (this.debugText) {
            this.debugText.text = text;
        }
    }
    
    // =========================================================
    // MESSAGING & NOTIFICATIONS
    // =========================================================
    
    showMessage(text, duration = 3000, type = "default") {
        this.messageQueue.push({ text, duration, type, startTime: performance.now() });
        if (!this.isShowingMessage) {
            this.processMessageQueue();
        }
    }
    
    processMessageQueue() {
        if (this.isShowingMessage || this.messageQueue.length === 0) return;
        
        const message = this.messageQueue.shift();
        this.isShowingMessage = true;
        
        // Show the message
        this.messageText.text = message.text;
        this.messageContainer.isVisible = true;
        
        // Hide after duration
        if (message.duration > 0) {
            setTimeout(() => {
                this.messageContainer.isVisible = false;
                this.isShowingMessage = false;
                // Process next message immediately
                this.processMessageQueue();
            }, message.duration);
        }
    }
    
    hideMessage(type = "default") {
        // Simple logic to hide the currently showing message
        if (type === "default" && this.isShowingMessage) {
            this.messageContainer.isVisible = false;
            this.isShowingMessage = false;
            this.processMessageQueue();
        }
    }

    // Displays floating damage/loot text above an entity in 3D space
    showFloatingText(text, targetPosition, type, duration) {
        if (typeof BABYLON.GUI.Container3D === 'undefined') {
             console.warn('[UI] Cannot show floating text, BABYLON.GUI.Container3D is not loaded.');
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
                
                // If there's a target position, project it to 2D screen space 
                // and position the text over it.
                if (targetPosition) {
                    const worldPos = targetPosition.clone();
                    worldPos.y += 1.0; // Lift text slightly above head
                    const screenPos = BABYLON.Vector3.Project(
                        worldPos,
                        BABYLON.Matrix.Identity(),
                        scene.getEngine().getTransformMatrix(),
                        scene.activeCamera.viewport
                    );
                    
                    if (screenPos.z < 1) { // Check if object is in front of camera
                        const screenX = scene.getEngine().getRenderWidth() * screenPos.x;
                        const screenY = scene.getEngine().getRenderHeight() * (1 - screenPos.y);
                        
                        // Use raw positioning for absolute placement
                        label.left = screenX + "px";
                        label.top = screenY + "px";
                    } else {
                        // Hide if behind camera
                        label.isVisible = false;
                    }
                }
            }
        });
    }

    dispose() {
        console.log('[UI] Disposing UI resources...');
        if (this.gui) {
            this.gui.dispose();
            this.gui = null;
        }
        this.messageQueue = [];
        this.isShowingMessage = false;
        this.minimapDots = [];
    }
}
