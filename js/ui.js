// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.9 (PATCHED)
// Fix: Implemented Input Bindings and necessary placeholders for control.
// ============================================================

class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        // NOTE: this.player is assigned, but may not be fully initialized until game.init completes.
        this.player = game.player; 

        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.inventoryWindow = null; // Defined here for the placeholder fix
        this.debugText = null;
        this.messageQueue = []; // For floating text

        this.uiVisible = {
            inventory: false
        };

        this._init();
    }

    _init() {
        this.createHUD();
        this.createTargetFrame();
        this.createActionBar();
        this.createInventoryWindow(); // Now implemented as a placeholder
        this.createInputBindings(); 
    }
    
    // Placeholder for HUD
    createHUD() {
        this.healthBar = this.createStatusBar("healthBar", "HP", "#FF0000", 250, 25, 10, 10);
        this.manaBar = this.createStatusBar("manaBar", "MP", "#0000FF", 250, 25, 45, 10);
        this.staminaBar = this.createStatusBar("staminaBar", "STM", "#00FF00", 250, 25, 80, 10);
    }
    
    // Placeholder for TargetFrame
    createTargetFrame() {
        // ... (stub)
    }
    
    // Placeholder for ActionBar
    createActionBar() {
        // ... (stub)
    }
    
    // Placeholder for Inventory Window (Prevents crash in toggleInventory)
    createInventoryWindow() {
        const rect = new BABYLON.GUI.Rectangle("inventoryWindow");
        rect.width = 0.5;
        rect.height = 0.8;
        rect.background = "rgba(0, 0, 0, 0.7)";
        rect.color = "white";
        rect.isVisible = false;
        this.gui.addControl(rect);
        this.inventoryWindow = rect;
    }


    // --- Status Bars ---
    createStatusBar(name, labelText, colorHex, width = 250, height = 25, top = 10, left = 10) {
        const container = new BABYLON.GUI.Rectangle(name + "Container");
        container.width = `${width}px`;
        container.height = `${height}px`;
        container.thickness = 1;
        container.cornerRadius = 5;
        container.color = "white";
        container.background = "#333333";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = `${top}px`;
        container.left = `${left}px`;
        this.gui.addControl(container);

        const bar = new BABYLON.GUI.Rectangle(name + "Bar");
        bar.width = 1.0; // Starts full
        bar.height = 1.0;
        bar.thickness = 0;
        bar.background = colorHex;
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.addControl(bar);

        const text = new BABYLON.GUI.TextBlock(name + "Text", labelText);
        text.color = "white";
        text.fontSize = 18;
        container.addControl(text);

        return { container, bar, text };
    }
    
    // Fix: Implemented core input bindings for player control
    createInputBindings() {
        // Keyboard Bindings
        window.addEventListener('keydown', (event) => {
            if (!this.player || this.player.input.isUIOpen) return;
            switch (event.keyCode) {
                case 87: // W
                    this.player.input.forward = true;
                    break;
                case 83: // S
                    this.player.input.backward = true;
                    break;
                case 65: // A
                    this.player.input.left = true;
                    break;
                case 68: // D
                    this.player.input.right = true;
                    break;
                case 16: // Shift (Run)
                    this.player.input.run = true;
                    break;
                case 32: // Space (Jump)
                    this.player.input.jump = true;
                    break;
                case 73: // I (Inventory)
                    this.toggleInventory();
                    break;
                case 49: // 1 (Ability 1)
                    if (this.player.abilities[0]) {
                         // Simple attack requires a target (stub for now)
                         this.player.abilities[0].execute(this.player, this.player.combat.target);
                    }
                    break;
            }
        });

        window.addEventListener('keyup', (event) => {
            if (!this.player) return;
            switch (event.keyCode) {
                case 87: // W
                    this.player.input.forward = false;
                    break;
                case 83: // S
                    this.player.input.backward = false;
                    break;
                case 65: // A
                    this.player.input.left = false;
                    break;
                case 68: // D
                    this.player.input.right = false;
                    break;
                case 16: // Shift
                    this.player.input.run = false;
                    break;
            }
        });
        
        // Mouse/Pointer Logic (Targeting)
        this.scene.onPointerObservable.add((pointerInfo) => {
            switch (pointerInfo.type) {
                case BABYLON.PointerEventTypes.POINTERDOWN:
                    // Right-click (button 2) for targeting
                    if (pointerInfo.event.button === 2) { 
                        if (pointerInfo.pickInfo.hit && pointerInfo.pickInfo.pickedMesh) {
                            this.player.handleTargeting(pointerInfo.pickInfo.pickedMesh);
                        }
                    }
                    break;
            }
        });
        
        // Disable right-click context menu
        this.scene.getEngine().getCanvas().oncontextmenu = (e) => e.preventDefault();
    }
    
    // Fix: Implemented toggleInventory
    toggleInventory() {
        this.uiVisible.inventory = !this.uiVisible.inventory;
        if (this.inventoryWindow) {
            this.inventoryWindow.isVisible = this.uiVisible.inventory;
        }
        // Notify player class to disable movement when UI is open
        this.player.setUISensitivity(this.uiVisible.inventory); 
    }

    // Placeholder methods
    updateTargetInfo(target) {}
    updateActionBar() {}

    showMessage(text, duration = 2000, type = 'info') {
        const labels = {
            info: { color: "white" },
            success: { color: "lime" },
            error: { color: "red" },
            heal: { color: "green" },
            playerDamage: { color: "yellow" },
            enemyDamage: { color: "orange" }
        };
        
        const label = labels[type] || labels.info;
        
        // Simple system messages
        const systemMessage = new BABYLON.GUI.TextBlock();
        systemMessage.text = text;
        systemMessage.color = label.color;
        systemMessage.fontSize = 24;
        systemMessage.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        systemMessage.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        systemMessage.paddingBottom = "60px";
        systemMessage.alpha = 1;
        this.gui.addControl(systemMessage);
        
        setTimeout(() => {
             // Fade out system message
             systemMessage.onAfterDrawObservable.addOnce(() => systemMessage.dispose());
        }, duration);
    }

    // --- Main Update Loop ---
    update(deltaTime) {
        if (!this.player) return;

        const pStats = this.player.stats;
        this._updateBar(this.healthBar, this.player.health, pStats.maxHealth, "HP");
        this._updateBar(this.manaBar, this.player.mana, pStats.maxMana, "MP");
        this._updateBar(this.staminaBar, this.player.stamina, pStats.maxStamina, "STM");

        this.updateTargetInfo(this.player.combat.target);
        this.updateActionBar();
    }

    _updateBar(barElements, current, max, label) {
        const ratio = current / max;
        barElements.bar.width = ratio.toFixed(2);
        barElements.text.text = `${label}: ${current.toFixed(0)} / ${max.toFixed(0)}`;
    }
    
    dispose() {
        // Clean up GUI controls
        if (this.gui) {
            this.gui.dispose();
            this.gui = null;
        }
        // Input listeners are on window and will be garbage collected or managed by the system.
    }
}
