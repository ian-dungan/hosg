// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.1.1 (CRITICAL GUI BUTTON FIX)
// Fix: Added full, correct implementation of _createActionBar to resolve 'not a constructor' error.
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
        this.advancedTexture.addControl(this.hud);

        const healthText = new BABYLON.GUI.TextBlock("healthText");
        healthText.color = "red";
        healthText.text = "HP: 100/100";
        healthText.height = "30px";
        this.hud.addControl(healthText);

        // Add Mana/Stamina placeholders here
        
        console.log('[UI] HUD created.'); 
    }

    _createTargetFrame() {
        this.targetFrame = new BABYLON.GUI.StackPanel("targetFrame");
        this.targetFrame.width = "200px";
        this.targetFrame.height = "50px";
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.targetFrame.paddingRight = "20px";
        this.targetFrame.isVisible = false;
        this.advancedTexture.addControl(this.targetFrame);
        console.log('[UI] Target frame created.'); 
    }

    _createActionBar() {
        // Defensive check against missing BABYLON.GUI
        if (!BABYLON.GUI || !BABYLON.GUI.Button || !BABYLON.GUI.StackPanel) {
            console.error("[UI] BABYLON.GUI components are undefined. Check if babylon.gui.min.js is loaded correctly.");
            return;
        }

        this.actionBar = new BABYLON.GUI.StackPanel("actionBarPanel");
        this.actionBar.width = "500px";
        this.actionBar.height = "70px";
        this.actionBar.isVertical = false;
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.advancedTexture.addControl(this.actionBar);

        for (let i = 0; i < 5; i++) {
            const slotId = "actionSlot" + i;
            // FIX: The method CreateSimpleButton is static and MUST be called on the BABYLON.GUI.Button class, not 'e' or 'this'.
            const button = BABYLON.GUI.Button.CreateSimpleButton(slotId, (i + 1).toString());
            button.width = "60px";
            button.height = "60px";
            button.color = "white";
            button.background = "black";
            button.alpha = 0.7;
            button.thickness = 2;
            button.paddingLeft = "5px";
            button.paddingRight = "5px";
            
            // Add reference to the slot for later updating
            this.actionBarSlots.push({ 
                button: button, 
                ability: null, 
                cooldownOverlay: null 
            });

            this.actionBar.addControl(button);
        }

        console.log('[UI] Action bar created.'); 
    }

    _createMessageSystem() {
        this.messageContainer = new BABYLON.GUI.StackPanel("messageContainer");
        this.messageContainer.width = "40%";
        this.messageContainer.height = "200px";
        this.messageContainer.isVertical = true;
        this.messageContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.advancedTexture.addControl(this.messageContainer);
        console.log('[UI] Message system created.');
    }

    showMessage(text, duration = 2000, type = 'info') {
        const textBlock = new BABYLON.GUI.TextBlock();
        textBlock.text = text;
        textBlock.color = type === 'error' ? 'red' : 
                          type === 'heal' ? 'lightgreen' :
                          type === 'enemyDamage' ? 'yellow' :
                          type === 'playerDamage' ? 'orange' : 'white';
        textBlock.fontSize = 18;
        textBlock.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        textBlock.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        textBlock.height = "25px"; 
        
        this.messageContainer.insertAt(0, textBlock); 

        while (this.messageContainer.children.length > 8) {
            this.messageContainer.children[this.messageContainer.children.length - 1].dispose();
        }

        setTimeout(() => {
            textBlock.dispose();
        }, duration);
    }
    
    _createInventoryWindow() {
        this.inventoryWindow = new BABYLON.GUI.Rectangle("inventoryWindow");
        this.inventoryWindow.width = "300px";
        this.inventoryWindow.height = "400px";
        this.inventoryWindow.background = "rgba(0,0,0,0.8)";
        this.inventoryWindow.color = "white";
        this.inventoryWindow.thickness = 2;
        this.inventoryWindow.isVisible = false;
        this.advancedTexture.addControl(this.inventoryWindow);
        
        const title = new BABYLON.GUI.TextBlock("invTitle");
        title.text = "Inventory";
        title.fontSize = 24;
        title.color = "white";
        title.height = "30px";
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

    // --- Update Loop ---
    
    update(player) {
        if (!this.hud) return; 
        
        // Update HUD elements (Health, Mana, Stamina)
        const healthText = this.hud.getChildByName("healthText");
        if (healthText) {
            const currentHealth = player.health;
            const maxHealth = player.stats ? player.stats.maxHealth : 100;
            healthText.text = `HP: ${currentHealth.toFixed(0)}/${maxHealth}`;
        }
        
        this.updateActionBar(player); 
    }
    
    updateActionBar(player) {
        if (!this.actionBarSlots || this.actionBarSlots.length === 0) return;
        
        // Bind the player's abilities to the first few slots
        for (let i = 0; i < this.actionBarSlots.length; i++) {
            const slot = this.actionBarSlots[i];
            const ability = player.abilities[i];
            
            if (ability) {
                // Update button text to ability name or initial
                slot.button.textBlock.text = ability.name.substring(0, 1);
                
                if (ability.isReady()) {
                    slot.button.background = "green";
                    slot.button.alpha = 1.0;
                } else {
                    const ratio = ability.getCooldownRatio();
                    slot.button.background = "black";
                    slot.button.alpha = 0.5 + (0.5 * ratio); 
                    // Show remaining cooldown time
                    slot.button.textBlock.text = Math.ceil(ability.currentCooldown).toString();
                }
                
                // Add click behavior (only for player)
                if (player.isPlayer && !slot.button.actionRegistered) {
                    slot.button.onPointerClickObservable.add(() => {
                        if (ability.isReady()) {
                            // Check if the game has a target property and it's not null before executing
                            const target = player.scene.game.player.target;
                            ability.execute(player, target);
                        } else {
                            this.showMessage(`[${ability.name}] is on cooldown!`, 1000, 'error');
                        }
                    });
                    slot.button.actionRegistered = true;
                }
            } else {
                // Empty slot
                slot.button.textBlock.text = (i + 1).toString();
                slot.button.background = "black";
                slot.button.alpha = 0.7;
            }
        }
    }
}

window.UIManager = UIManager;
