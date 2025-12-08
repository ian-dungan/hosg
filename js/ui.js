// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.8 (ACTION BAR FIX)
// Fix: Added defensive check to updateActionBar to prevent crash if player abilities are undefined.
// ============================================================

class UIManager {
    constructor(scene) {
        this.scene = scene;
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
        
        // UI Elements (Initialized in _create methods)
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.inventoryWindow = null;
        this.actionBarSlots = []; // Array to hold references to the action bar buttons
    }

    // --- Initialization ---

    init() {
        this._createHUD(); // Line 81
        this._createTargetFrame(); // Line 115
        this._createActionBar(); // Line 192
        this._createInventoryWindow(); // Line 257
        this._createInputBindings(); // Line 339
        console.log('[UI] All UI components initialized.');
    }

    _createHUD() {
        // Placeholder for the main status HUD (Health, Mana, Stamina bars)
        this.hud = new BABYLON.GUI.StackPanel("hudPanel");
        this.hud.width = "50%";
        this.hud.height = "100px";
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.paddingLeft = "20px";
        this.hud.paddingTop = "20px";
        this.advancedTexture.addControl(this.hud);

        // Placeholder for a Health Bar
        const healthBar = new BABYLON.GUI.TextBlock("healthText", "HP: 100/100");
        healthBar.color = "red";
        healthBar.height = "20px";
        this.hud.addControl(healthBar);

        console.log('[UI] HUD created.'); // Line 81 (approximate)
    }

    _createTargetFrame() {
        // Placeholder for the target information frame
        this.targetFrame = new BABYLON.GUI.StackPanel("targetPanel");
        this.targetFrame.width = "200px";
        this.targetFrame.height = "50px";
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.targetFrame.paddingRight = "20px";
        this.targetFrame.paddingTop = "20px";
        this.targetFrame.isVisible = false;
        this.advancedTexture.addControl(this.targetFrame);

        // Placeholder for Target Name
        const targetName = new BABYLON.GUI.TextBlock("targetName", "Target Name");
        targetName.color = "yellow";
        targetName.height = "20px";
        this.targetFrame.addControl(targetName);

        console.log('[UI] Target frame created.'); // Line 115 (approximate)
    }

    _createActionBar() {
        // Container for the action bar slots
        this.actionBar = new BABYLON.GUI.StackPanel("actionBarPanel");
        this.actionBar.isHorizontal = true;
        this.actionBar.width = "400px";
        this.actionBar.height = "50px";
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.actionBar.paddingBottom = "10px";
        this.advancedTexture.addControl(this.actionBar);

        // Create 6 placeholder slots (matching 1-6 keys)
        for (let i = 0; i < 6; i++) {
            const slot = new BABYLON.GUI.Button.CreateSimpleButton(`actionSlot${i}`, (i + 1).toString());
            slot.width = "50px";
            slot.height = "50px";
            slot.color = "white";
            slot.background = "#333333aa";
            slot.paddingLeft = "5px";
            slot.paddingRight = "5px";
            
            // Reference the text block for easy updating
            slot.textBlock = slot.children[0];
            
            this.actionBar.addControl(slot);
            this.actionBarSlots.push(slot);
        }

        console.log('[UI] Action bar created.'); // Line 192 (approximate)
    }

    updateActionBar(player) {
        // CRITICAL FIX: Ensure player.abilities is an array before calling forEach
        // This prevents the TypeError: Cannot read properties of undefined (reading 'forEach')
        const abilities = player.abilities || []; // Line 201 (approximate)

        abilities.forEach((ability, index) => {
            const slot = this.actionBarSlots[index];
            if (slot) {
                // Placeholder logic: Update button text/texture based on ability object
                const abilityName = ability ? ability.name.substring(0, 8) : (index + 1).toString();
                slot.textBlock.text = abilityName;
                slot.textBlock.color = ability ? "yellow" : "gray";
            }
        });
    }

    _createInventoryWindow() {
        // Placeholder for the main inventory window
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

        console.log('[UI] Inventory window created.'); // Line 257 (approximate)
    }

    _createInputBindings() {
        // Placeholder for handling input (e.g., toggling inventory with 'I')
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

        console.log('[UI] Input bindings created.'); // Line 339 (approximate)
    }

    // --- Update Loop ---
    
    // Line 387 (approximate)
    update(player) {
        // Update HUD elements (Health, Mana, Stamina)
        const healthText = this.hud.getChildByName("healthText");
        if (healthText) {
            // Placeholder: Assuming player has health/stats properties
            const currentHealth = player.stats ? player.stats.health : 100;
            const maxHealth = player.stats ? player.stats.maxHealth : 100;
            healthText.text = `HP: ${currentHealth}/${maxHealth}`;
        }
        
        // Update action bar state
        this.updateActionBar(player); 
        
        // Target frame logic (Placeholder)
        // if (player.target) {
        //     this.targetFrame.isVisible = true;
        //     this.targetFrame.getChildByName("targetName").text = player.target.name;
        // } else {
        //     this.targetFrame.isVisible = false;
        // }
    }
}

// Ensure the UIManager class is globally accessible
window.UIManager = UIManager;
