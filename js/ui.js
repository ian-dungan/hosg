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
        this.messageBox = null;

        this._init();
    }

    _init() {
        this.createHUD();
        this.createMinimap();
        if (CONFIG.DEBUG) {
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

        // Mana bar (below health)
        this.manaBar = this.createStatusBar(
            "mana",
            "MP",
            "#4040ff",
            200,
            18,
            10,
            35
        );
        this.hud.addControl(this.manaBar.container);

        // Stamina bar (below mana)
        this.staminaBar = this.createStatusBar(
            "stamina",
            "ST",
            "#40ff40",
            200,
            18,
            10,
            60
        );
        this.hud.addControl(this.staminaBar.container);
    }

    createStatusBar(name, label, color, width, height, x, y) {
        const container = new BABYLON.GUI.Rectangle(`${name}Container`);
        container.width = `${width}px`;
        container.height = `${height}px`;
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = `${x}px`;
        container.top = `${y}px`;
        container.color = "white";
        container.thickness = 2;
        container.background = "black";

        // Fill bar
        const fill = new BABYLON.GUI.Rectangle(`${name}Fill`);
        fill.width = 1.0; // Starts full
        fill.height = 1.0;
        fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        fill.background = color;
        fill.thickness = 0;
        container.addControl(fill);

        // Text label
        const text = new BABYLON.GUI.TextBlock(`${name}Text`);
        text.text = label;
        text.color = "white";
        text.fontSize = 12;
        container.addControl(text);

        return { container, fill, text };
    }

    createMinimap() {
        const size = 150;
        this.minimap = new BABYLON.GUI.Rectangle("minimapContainer");
        this.minimap.width = `${size}px`;
        this.minimap.height = `${size}px`;
        this.minimap.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.minimap.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.minimap.left = "-10px";
        this.minimap.top = "10px";
        this.minimap.color = "white";
        this.minimap.thickness = 2;
        this.minimap.background = "rgba(0, 0, 0, 0.5)";
        this.minimap.clipChildren = true;
        this.hud.addControl(this.minimap);
    }

    createMessageBox() {
        this.messageBox = new BABYLON.GUI.TextBlock("messageBox");
        this.messageBox.width = 0.5;
        this.messageBox.height = "40px";
        this.messageBox.color = "white";
        this.messageBox.fontSize = 20;
        this.messageBox.outlineWidth = 1;
        this.messageBox.outlineColor = "black";
        this.messageBox.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.messageBox.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.messageBox.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.messageBox.top = "-50px";
        this.messageBox.text = "";
        this.messageBox.alpha = 0;
        this.gui.addControl(this.messageBox);
    }

    showMessage(text, duration = 2000) {
        if (!this.messageBox) return;

        this.messageBox.text = text;
        this.messageBox.alpha = 1;

        // Fade out after duration
        clearTimeout(this._messageTimeout);
        this._messageTimeout = setTimeout(() => {
            this.messageBox.alpha = 0;
        }, duration);
    }

    createDebugInfo() {
        this.debugText = new BABYLON.GUI.TextBlock("debugText");
        this.debugText.width = 0.3;
        this.debugText.height = "100px";
        this.debugText.color = "white";
        this.debugText.fontSize = 12;
        this.debugText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.debugText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.debugText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.debugText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.debugText.left = "-10px";
        this.debugText.top = "-10px";
        this.gui.addControl(this.debugText);
    }

    updateDebugInfo(deltaTime) {
        if (!this.debugText || !this.player || !this.player.mesh) return;

        const fps = this.game.engine.getFps().toFixed(0);
        const pos = this.player.mesh.position;
        const vel = this.player.velocity;

        let text = `FPS: ${fps}\n`;
        text += `Pos: x${pos.x.toFixed(1)} y${pos.y.toFixed(1)} z${pos.z.toFixed(1)}\n`;
        text += `Vel: x${vel.x.toFixed(1)} y${vel.y.toFixed(1)} z${vel.z.toFixed(1)}\n`;
        text += `Grounded: ${this.player.isGrounded ? 'Yes' : 'No'}\n`;
        text += `Anim: ${this.player.currentAnimation || 'None'}`;

        this.debugText.text = text;
    }

    updateMinimap() {
        if (!this.minimap || !this.player || !this.player.mesh) return;

        // Clear old dots
        this.minimapDots.forEach(dot => dot.dispose());
        this.minimapDots = [];

        const mapSize = 150; // minimap width/height in pixels
        const worldSize = this.game.world ? this.game.world.options.size : 1000;
        const scale = mapSize / worldSize;
        const playerPos = this.player.mesh.position;

        // Player dot (center of the minimap)
        const playerDot = new BABYLON.GUI.Ellipse();
        playerDot.width = "6px";
        playerDot.height = "6px";
        playerDot.color = "white";
        playerDot.background = "blue";
        this.minimap.addControl(playerDot);
        this.minimapDots.push(playerDot);

        // Add NPC/Enemy dots
        const entities = [...this.game.world.npcs, ...this.game.world.enemies];

        for (const entity of entities) {
            if (!entity.mesh) continue;

            const entityPos = entity.mesh.position;
            // Calculate relative position to player
            const relX = (entityPos.x - playerPos.x) * scale;
            const relY = (entityPos.z - playerPos.z) * scale;

            // Only show entities near the player (within minimap bounds)
            if (Math.abs(relX) > mapSize / 2 || Math.abs(relY) > mapSize / 2) {
                continue;
            }

            const dot = new BABYLON.GUI.Ellipse();
            dot.width = "4px";
            dot.height = "4px";
            dot.color = "white";
            dot.background = entity instanceof Enemy ? "red" : "yellow";
            dot.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            dot.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
            dot.left = `${relX}px`;
            dot.top = `${-relY}px`; // Invert Y for minimap convention

            this.minimap.addControl(dot);
            this.minimapDots.push(dot);
        }
    }


    update(deltaTime) {
        // Update stats bars
        if (this.player) {
            this.healthBar.fill.width = `${this.player.health / this.player.maxHealth}`;
            this.manaBar.fill.width = `${this.player.mana / this.player.maxMana}`;
            this.staminaBar.fill.width = `${this.player.stamina / this.player.maxStamina}`;
        }

        if (CONFIG.DEBUG) {
            this.updateDebugInfo(deltaTime);
        }

        this.updateMinimap();
    }

    dispose() {
        this.gui.dispose();
    }

    /**
     * Shows a floating damage/text indicator in 3D space.
     * @param {string} text - The text to display (e.g., damage number).
     * @param {BABYLON.Vector3} worldPosition - The world position to display at.
     * @param {string} type - 'playerDamage', 'enemyDamage', 'gold', 'heal', 'default'
     * @param {number} duration - ms to display the text for.
     */
    showFloatingText(text, worldPosition, type, duration) {
        if (!worldPosition) return;

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
        
        // Use position to place it via linkWithMesh, but we need a temporary mesh for this
        const textMesh = BABYLON.MeshBuilder.CreateBox("floatingTextMesh", { size: 0.1 }, this.scene);
        textMesh.position.copyFrom(worldPosition);
        textMesh.isVisible = false;
        
        this.gui.addControl(label);
        label.linkWithMesh(textMesh);
        label.linkOffsetY = -50; // Start 50px above the mesh center

        var scene = this.scene;
        var startTime = performance.now();
        var total = duration;

        var observer = scene.onBeforeRenderObservable.add(function () {
            var t = (performance.now() - startTime) / total;
            if (t >= 1) {
                scene.onBeforeRenderObservable.remove(observer);
                this.gui.removeControl(label);
                textMesh.dispose();
            } else {
                // Animate text upwards (by changing the mesh position)
                var offset = 0.005 * deltaTime; // Small constant upward movement
                textMesh.position.y += offset;

                // Animate fade out
                label.alpha = 1 - t;
            }
        }.bind(this));
    }
}


/**
 * Simple Inventory class for item management
 */
class Inventory {
    constructor(size) {
        this.size = size;
        this.items = []; // Array of item data objects
    }

    addItem(itemData) {
        // Check for stackable items
        if (itemData.stackable) {
            const existingItem = this.items.find(i => i.id === itemData.id);
            if (existingItem) {
                existingItem.quantity += itemData.quantity;
                console.log(`[Inventory] Stacked ${itemData.name}. New quantity: ${existingItem.quantity}`);
                return true;
            }
        }

        // Add new item if space is available
        if (this.items.length < this.size) {
            this.items.push(itemData);
            console.log(`[Inventory] Added new item: ${itemData.name}`);
            return true;
        }

        console.log(`[Inventory] No space for ${itemData.name}`);
        return false;
    }

    removeItem(itemId, quantity = 1) {
        const index = this.items.findIndex(i => i.id === itemId);
        if (index === -1) return false;

        const item = this.items[index];

        if (item.quantity > quantity) {
            item.quantity -= quantity;
            return true;
        } else if (item.quantity === quantity) {
            this.items.splice(index, 1);
            return true;
        }

        return false;
    }

    // A stub for equipping functionality
    equipItem(itemData, slot) {
        // In a full implementation, this would handle moving the item to an 'equipped' slot
        console.log(`[Inventory] Equipped ${itemData.name} to ${slot} slot.`);
        return true;
    }
}
