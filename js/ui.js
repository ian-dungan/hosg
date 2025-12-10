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
        this.playerDot = null;
        
        // Message system
        this.messageContainer = null;
        this.messageText = null;
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
        this.createMessageBox();
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

    createMinimap() {
        const size = 150; // Minimap size in pixels
        const mapScale = 200; // World units to cover
        
        // Minimap container (bottom-right corner)
        const minimapContainer = new BABYLON.GUI.Rectangle("minimapContainer");
        minimapContainer.width = size + "px";
        minimapContainer.height = size + "px";
        minimapContainer.cornerRadius = 10;
        minimapContainer.color = "#ffffff";
        minimapContainer.thickness = 2;
        minimapContainer.background = "rgba(0, 0, 0, 0.5)";
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
        
        // Player dot (always in center of minimap)
        this.playerDot = new BABYLON.GUI.Ellipse("playerDot");
        this.playerDot.width = "5px";
        this.playerDot.height = "5px";
        this.playerDot.color = "yellow";
        this.playerDot.background = "yellow";
        this.playerDot.thickness = 0;
        minimapContainer.addControl(this.playerDot);
        
        // Store minimap info
        this.minimap = {
            container: minimapContainer,
            size: size,
            mapScale: mapScale,
            // Convert world coordinates to minimap pixel coordinates
            worldToMap: (worldX, worldZ) => {
                // Calculate relative to map center (0,0)
                // In a real minimap, this would be relative to player, but for now fixed scale
                const pixelX = (worldX / mapScale) * size;
                const pixelY = (worldZ / mapScale) * size;
                return { x: pixelX, y: pixelY };
            }
        };
        
        // Call immediately to populate the map
        this.updateMinimapLandmarks();
        
        console.log('[UI] Minimap created');
    }
    
    // FIX: Patched function that prevents the TypeError crash
    updateMinimapLandmarks() {
        if (!this.minimap || !this.game.world || !this.player || !this.player.mesh) return;
        
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
                
                this.minimap.container.addControl(dot);
                this.minimapDots.push(dot);
            }
        }
        
        // Get Landmarks (using the new getLandmarks function from world.js)
        if (typeof this.game.world.getLandmarks === 'function') {
             const landmarks = this.game.world.getLandmarks();
             for (const landmark of landmarks) {
                const landmarkX = landmark.position.x;
                const landmarkZ = landmark.position.z;
                
                const dotX = (landmarkX - playerX) * scale;
                const dotY = (landmarkZ - playerZ) * scale;
                
                if (Math.abs(dotX) < mapSize / 2 && Math.abs(dotY) < mapSize / 2) {
                    const dot = new BABYLON.GUI.Ellipse("landmarkDot");
                    dot.width = "6px";
                    dot.height = "6px";
                    dot.color = "white";
                    dot.background = "orange";
                    dot.thickness = 1;
                    dot.left = dotX + "px";
                    dot.top = -dotY + "px";
                    
                    this.minimap.container.addControl(dot);
                    this.minimapDots.push(dot);
                }
             }
        }

        // Update player dot (always in center)
        this.playerDot.left = "0px";
        this.playerDot.top = "0px";
    }

    createMessageBox() {
        this.messageContainer = new BABYLON.GUI.Rectangle("messageContainer");
        this.messageContainer.width = "400px";
        this.messageContainer.height = "60px";
        this.messageContainer.cornerRadius = 5;
        this.messageContainer.color = "white";
        this.messageContainer.thickness = 1;
        this.messageContainer.background = "rgba(0, 0, 0, 0.7)";
        this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.messageContainer.top = "15%";
        this.messageContainer.isVisible = false;
        this.gui.addControl(this.messageContainer);

        this.messageText = new BABYLON.GUI.TextBlock("messageText");
        this.messageText.text = "";
        this.messageText.color = "white";
        this.messageText.fontSize = 20;
        this.messageText.textWrapping = true;
        this.messageContainer.addControl(this.messageText);
    }

    showMessage(text, duration = 3000, type = "default") {
        if (!this.messageContainer) return;
        
        this.messageQueue.push({ text, duration, type });
        if (!this.isShowingMessage) {
            this.processMessageQueue();
        }
    }
    
    processMessageQueue() {
        if (this.messageQueue.length === 0) {
            this.isShowingMessage = false;
            this.messageContainer.isVisible = false;
            return;
        }

        this.isShowingMessage = true;
        const msg = this.messageQueue.shift();
        this.messageText.text = msg.text;
        
        // Color based on type
        if (msg.type === 'error') this.messageText.color = "#ff5555";
        else if (msg.type === 'success') this.messageText.color = "#55ff55";
        else this.messageText.color = "white";

        this.messageContainer.isVisible = true;

        setTimeout(() => {
            this.processMessageQueue();
        }, msg.duration);
    }

    createDebugInfo() {
        this.debugText = new BABYLON.GUI.TextBlock("debugInfo");
        this.debugText.text = "FPS: 0";
        this.debugText.color = "lime";
        this.debugText.fontSize = 12;
        this.debugText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.debugText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.debugText.paddingTop = "10px";
        this.debugText.paddingRight = "10px";
        this.gui.addControl(this.debugText);
    }
    
    updateDebugInfo() {
        if (!this.debugText) return;
        const fps = this.game.engine.getFps().toFixed();
        const pos = this.player && this.player.mesh ? this.player.mesh.position : {x:0, y:0, z:0};
        const chunkX = Math.floor(pos.x / 32); // Assuming chunk size 32
        const chunkZ = Math.floor(pos.z / 32);
        
        this.debugText.text = `FPS: ${fps}\nPos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}\nChunk: ${chunkX}, ${chunkZ}\nEntities: ${this.game.world ? (this.game.world.npcs.length + this.game.world.enemies.length) : 0}`;
    }
    
    // Shows floating text in the 3D world (e.g. damage numbers)
    showFloatingText(text, position, type = 'default') {
        if (!position || typeof BABYLON.GUI === 'undefined') return;

        // Use a lightweight GUI plane for 3D text
        const plane = BABYLON.MeshBuilder.CreatePlane("floatingText", { width: 2, height: 1 }, this.scene);
        plane.parent = null;
        plane.position.copyFrom(position);
        plane.position.y += 1.5; // Offset above target
        plane.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        plane.isPickable = false;

        const advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateForMesh(plane);
        
        const label = new BABYLON.GUI.TextBlock();
        label.text = text;
        label.fontSize = 48; // Scaled down by texture size
        
        if (type === "gold") label.color = "#ffd700";
        else if (type === "playerDamage") label.color = "#ff3333";
        else if (type === "enemyDamage") label.color = "#ffffff";
        else if (type === "heal") label.color = "#33ff33";
        else label.color = "white";
        
        // Add outline
        label.outlineWidth = 2;
        label.outlineColor = "black";
        
        advancedTexture.addControl(label);

        // Animation: Float up and fade out
        const frameRate = 10;
        const ySlide = new BABYLON.Animation("ySlide", "position.y", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keyFramesY = [];
        keyFramesY.push({ frame: 0, value: plane.position.y });
        keyFramesY.push({ frame: frameRate, value: plane.position.y + 1.0 });
        ySlide.setKeys(keyFramesY);

        const opacityFade = new BABYLON.Animation("opacityFade", "visibility", frameRate, BABYLON.Animation.ANIMATIONTYPE_FLOAT, BABYLON.Animation.ANIMATIONLOOPMODE_CONSTANT);
        const keyFramesO = [];
        keyFramesO.push({ frame: 0, value: 1 });
        keyFramesO.push({ frame: frameRate, value: 0 });
        opacityFade.setKeys(keyFramesO);

        plane.animations.push(ySlide);
        plane.animations.push(opacityFade);

        const anim = this.scene.beginAnimation(plane, 0, frameRate, false);

        anim.onAnimationEnd = () => {
            advancedTexture.dispose();
            plane.dispose();
        };
    }
    
    // UI-level targeting info (top of screen)
    showTargetInfo(name, health, maxHealth) {
        if (!this.targetPanel) {
            this.targetPanel = new BABYLON.GUI.StackPanel();
            this.targetPanel.width = "300px";
            this.targetPanel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.targetPanel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
            this.targetPanel.top = "50px";
            this.gui.addControl(this.targetPanel);
            
            this.targetName = new BABYLON.GUI.TextBlock();
            this.targetName.text = name;
            this.targetName.color = "white";
            this.targetName.height = "30px";
            this.targetPanel.addControl(this.targetName);
            
            this.targetHealthBar = new BABYLON.GUI.Rectangle();
            this.targetHealthBar.width = "100%";
            this.targetHealthBar.height = "10px";
            this.targetHealthBar.color = "black";
            this.targetHealthBar.thickness = 1;
            this.targetHealthBar.background = "grey";
            this.targetPanel.addControl(this.targetHealthBar);
            
            this.targetHealthFill = new BABYLON.GUI.Rectangle();
            this.targetHealthFill.width = "100%";
            this.targetHealthFill.height = "100%";
            this.targetHealthFill.color = "red";
            this.targetHealthFill.thickness = 0;
            this.targetHealthFill.background = "red";
            this.targetHealthFill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            this.targetHealthBar.addControl(this.targetHealthFill);
        }
        
        this.targetPanel.isVisible = true;
        this.targetName.text = name;
        const pct = Math.max(0, Math.min(1, health / maxHealth));
        this.targetHealthFill.width = (pct * 100) + "%";
    }
    
    hideTargetInfo() {
        if (this.targetPanel) {
            this.targetPanel.isVisible = false;
        }
    }

    dispose() {
        if (this.gui) {
            this.gui.dispose();
            this.gui = null;
        }
    }
}
