// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.1.0 (CRITICAL MESSAGE AND NULL FIX)
// Fix: Added showMessage() method. Added null check for this.hud in update().
// ============================================================

class UIManager {
    constructor(scene) {
        this.scene = scene;
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        
        // UI Elements (Initialized in _create methods)
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.messageContainer = null; // New container for messages
        this.inventoryWindow = null;
        this.actionBarSlots = []; // Array to hold references to the action bar buttons
    }

    // --- Initialization ---

    init() {
        this._createHUD(); 
        this._createTargetFrame(); 
        this._createActionBar(); 
        this._createMessageSystem(); // New system for messages
        this._createInventoryWindow(); 
        this._createInputBindings(); 
        console.log('[UI] All UI components initialized.');
    }

    _createHUD() {
        this.hud = new BABYLON.GUI.StackPanel("hudPanel");
        this.hud.width = "50%";
        this.hud.height = "100px";
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.paddingLeft = "20px";
        this.hud.paddingTop = "20px";
        this.advancedTexture.addControl(this.hud);

        const healthBar = new BABYLON.GUI.TextBlock("healthText", "HP: 100/100");
        healthBar.color = "red";
        healthBar.height = "20px";
        this.hud.addControl(healthBar);

        console.log('[UI] HUD created.'); 
    }

    _createTargetFrame() {
        this.targetFrame = new BABYLON.GUI.StackPanel("targetPanel");
        this.targetFrame.width = "200px";
        this.targetFrame.height = "50px";
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.targetFrame.paddingRight = "20px";
        this.targetFrame.paddingTop = "20px";
        this.targetFrame.isVisible = false;
        this.advancedTexture.addControl(this.targetFrame);

        const targetName = new BABYLON.GUI.TextBlock("targetName", "Target Name");
        targetName.color = "yellow";
        targetName.height = "20px";
        this.targetFrame.addControl(targetName);

        console.log('[UI] Target frame created.'); 
    }
    
    _createMessageSystem() {
        // Container for game messages (e.g., "Game Saved!")
        this.messageContainer = new BABYLON.GUI.StackPanel("messageContainer");
        this.messageContainer.width = "400px";
        this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        this.messageContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.advancedTexture.addControl(this.messageContainer);
    }

    _createActionBar() {
        this.actionBar = new BABYLON.GUI.StackPanel("actionBarPanel");
        this.actionBar.isHorizontal = true;
        this.actionBar.width = "400px";
        this.actionBar.height = "50px";
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.actionBar.paddingBottom = "10px";
        this.advancedTexture.addControl(this.actionBar);

        for (let i = 0; i < 6; i++) {
            const slot = new BABYLON.GUI.Button.CreateSimpleButton(`actionSlot${i}`, (i + 1).toString());
            slot.width = "50px";
            slot.height = "50px";
            slot.color = "white";
            slot.background = "#333333aa";
            slot.paddingLeft = "5px";
            slot.paddingRight = "5px";
            
            slot.textBlock = slot.children[0];
            
            this.actionBar.addControl(slot);
            this.actionBarSlots.push(slot);
        }

        console.log('[UI] Action bar created.'); 
    }

    // --- Message System Method (Fixes TypeError in game.js) ---
    /**
     * Shows a temporary game message in the center of the screen.
     * @param {string} message 
     * @param {number} durationMs 
     * @param {string} type - 'info', 'success', 'error', 'playerDamage', etc.
     */
    showMessage(message, durationMs = 3000, type = 'info') {
        if (!this.messageContainer) return;

        const textBlock = new BABYLON.GUI.TextBlock();
        textBlock.text = message;
        textBlock.color = this._getMessageColor(type);
        textBlock.fontSize = 20;
        textBlock.height = "30px";
        textBlock.paddingTop = "5px";
        
        // Add the message to the container
        this.messageContainer.addControl(textBlock);

        // Remove the message after durationMs
        setTimeout(() => {
            this.messageContainer.removeControl(textBlock);
            textBlock.dispose();
        }, durationMs);
    }
    
    _getMessageColor(type) {
        switch (type) {
            case 'success': return 'lightgreen';
            case 'error': return 'red';
            case 'playerDamage': return 'red';
            case 'enemyDamage': return 'yellow';
            case 'heal': return 'lightskyblue';
            default: return 'white';
        }
    }
    // -----------------------------------------------------------------

    updateActionBar(player) {
        const abilities = player.abilities || []; 

        abilities.forEach((ability, index) => {
            const slot = this.actionBarSlots[index];
            if (slot) {
                const abilityName = ability ? ability.name.substring(0, 8) : (index + 1).toString();
                slot.textBlock.text = abilityName;
                slot.textBlock.color = ability ? "yellow" : "gray";
            }
        });
    }

    _createInventoryWindow() {
        this.inventoryWindow = new BABYLON.GUI.Rectangle("inventoryWindow");
        this.inventoryWindow.width = "300px";
        this.inventoryWindow.height = "400px";
        this.inventoryWindow.background = "#000000cc";
        this.inventoryWindow.color = "white";
        this.inventoryWindow.isVisible = false;
        this.advancedTexture.addControl(this.inventoryWindow);

        const title = new BABYLON.GUI.TextBlock("inventoryTitle", "Inventory (I)");
        title.fontSize = 24;
        title.paddingTop = "10px";
        title.height = "40px";
        title.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.inventoryWindow.addControl(title);

        console.log('[UI] Inventory window created.'); 
    }

    _createInputBindings() {
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);

        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                BABYLON.ActionManager.OnKeyUpTrigger, 
                (evt) => {
                    if (evt.sourceEvent.key.toLowerCase() === 'i') {
                        this.inventoryWindow.isVisible = !this.inventoryWindow.isVisible;
                        console.log(`[UI] Toggled Inventory: ${this.inventoryWindow.isVisible}`);
                    }
                }
            )
        );

        console.log('[UI] Input bindings created.'); 
    }

    // --- Update Loop (Fixes the Null Error) ---
    
    update(player) {
        // CRITICAL FIX: Check if this.hud is initialized (fixes the null error)
        if (!this.hud) return; 
        
        // Update HUD elements (Health, Mana, Stamina)
        const healthText = this.hud.getChildByName("healthText");
        if (healthText) {
            const currentHealth = player.health;
            const maxHealth = player.stats ? player.stats.maxHealth : 100;
            healthText.text = `HP: ${currentHealth.toFixed(0)}/${maxHealth}`;
        }
        
        // Update action bar state
        this.updateActionBar(player); 
        
        // Target frame logic 
        // ... (remaining logic)
    }
}

window.UIManager = UIManager;
