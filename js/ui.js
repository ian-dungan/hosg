// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.13 (FINAL PATCH)
// Fix: Added complete createActionBar() and robust updateActionBar() to prevent 'undefined' crashes.
// ============================================================

class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        // player is set after Game.init is complete, so we use a getter/setter 
        // or rely on this.game.player being available later.
        this.player = game.player; 

        // Create the GUI texture
        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.inventoryWindow = null;
        this.messageQueue = []; 
        this.debugText = null;

        this.uiVisible = {
            inventory: false
        };

        this._init();
    }

    _init() {
        this.createHUD();
        this.createTargetFrame();
        this.createActionBar(); 
        this.createInventoryWindow();
        this.createInputBindings(); 
    }

    // --- Status Bars ---
    createStatusBar(name, labelText, colorHex, width = 250, height = 25, top = 10, left = 10) {
        const container = new BABYLON.GUI.Rectangle(name + "Container");
        container.width = `${width}px`;
        container.height = `${height}px`;
        container.cornerRadius = 5;
        container.color = "#FFF";
        container.thickness = 1;
        container.background = "rgba(0, 0, 0, 0.7)";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = top + "px";
        container.left = left + "px";
        this.gui.addControl(container);
        
        // The inner bar
        const bar = new BABYLON.GUI.Rectangle(name + "Bar");
        bar.width = 1; // Start at full width
        bar.height = 1;
        bar.cornerRadius = 5;
        bar.thickness = 0;
        bar.background = colorHex;
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.addControl(bar);

        // The label text
        const text = new BABYLON.GUI.TextBlock(name + "Label", labelText);
        text.color = "white";
        text.fontSize = 14;
        container.addControl(text);

        return { container, bar, text };
    }
    
    // --- HUD ---
    createHUD() {
        // Health Bar (Top Left)
        this.healthBar = this.createStatusBar("healthBar", "HP", "#C44", 250, 25, 10, 10);
        // Mana Bar (Below Health)
        this.manaBar = this.createStatusBar("manaBar", "MP", "#44C", 250, 25, 40, 10);
        // Stamina Bar (Below Mana)
        this.staminaBar = this.createStatusBar("staminaBar", "STM", "#4C4", 250, 25, 70, 10);
        
        console.log('[UI] HUD created.');
    }

    // --- Target Frame ---
    createTargetFrame() {
        this.targetFrame = {};
        this.targetFrame.container = new BABYLON.GUI.Rectangle("targetFrameContainer");
        this.targetFrame.container.width = "200px";
        this.targetFrame.container.height = "70px";
        this.targetFrame.container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.targetFrame.container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.container.thickness = 1;
        this.targetFrame.container.background = "rgba(0, 0, 0, 0.7)";
        this.targetFrame.container.top = "10px";
        this.targetFrame.container.left = "-10px";
        this.targetFrame.container.isVisible = false; // Hidden by default
        this.gui.addControl(this.targetFrame.container);
        
        // Target Name Text
        this.targetFrame.nameText = new BABYLON.GUI.TextBlock("targetNameText", "Target Name");
        this.targetFrame.nameText.height = "20px";
        this.targetFrame.nameText.color = "yellow";
        this.targetFrame.nameText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.container.addControl(this.targetFrame.nameText);
        
        // Target Health Bar
        this.targetFrame.healthBarContainer = this.createStatusBar("targetHealthBar", "HP", "#C44", 180, 20);
        this.targetFrame.healthBarContainer.container.top = "25px";
        this.targetFrame.healthBarContainer.container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.targetFrame.healthBarContainer.container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.healthBarContainer.container.left = "0px";
        this.targetFrame.healthBarContainer.container.thickness = 0;
        this.targetFrame.container.addControl(this.targetFrame.healthBarContainer.container);

        console.log('[UI] Target frame created.');
    }
    
    updateTargetInfo(target) {
        if (!target) {
            this.targetFrame.container.isVisible = false;
            return;
        }

        this.targetFrame.container.isVisible = true;
        this.targetFrame.nameText.text = `${target.name} (Lvl ${target.level})`;
        
        const ratio = target.health / target.stats.maxHealth;
        this._updateBar(this.targetFrame.healthBarContainer, target.health, target.stats.maxHealth, "HP");
    }

    // --- Action Bar ---
    createActionBar() {
        this.actionBar = {
            container: new BABYLON.GUI.Rectangle("actionBarContainer"),
            slots: [] // Array to hold references to UI elements for easy updating
        };
        this.actionBar.container.width = "400px";
        this.actionBar.container.height = "55px";
        this.actionBar.container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.actionBar.container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.container.thickness = 1;
        this.actionBar.container.color = "#FFF";
        this.actionBar.container.background = "rgba(0, 0, 0, 0.5)";
        this.actionBar.container.paddingBottom = "5px";
        this.gui.addControl(this.actionBar.container);

        const slotPanel = new BABYLON.GUI.StackPanel("actionBarSlotPanel");
        slotPanel.isHorizontal = true;
        slotPanel.width = 1;
        this.actionBar.container.addControl(slotPanel);
        
        // Create 5 slots
        for (let i = 0; i < 5; i++) {
            const slotContainer = new BABYLON.GUI.Rectangle(`actionSlot${i}`);
            slotContainer.width = "50px";
            slotContainer.height = "50px";
            slotContainer.thickness = 1;
            slotContainer.color = "#FFF";
            slotContainer.background = "rgba(100, 100, 100, 0.8)";
            slotContainer.paddingLeft = "5px";
            
            const abilityIcon = new BABYLON.GUI.Image(`abilityIcon${i}`, "");
            abilityIcon.width = 0.8;
            abilityIcon.height = 0.8;
            slotContainer.addControl(abilityIcon);

            const cooldownText = new BABYLON.GUI.TextBlock(`cooldownText${i}`);
            cooldownText.text = "";
            cooldownText.color = "white";
            cooldownText.fontSize = 20;
            slotContainer.addControl(cooldownText);
            
            // This object holds references to the UI elements we need to update
            this.actionBar.slots.push({
                container: slotContainer,
                abilityIcon: abilityIcon,
                cooldownText: cooldownText,
                // The key bind label
                abilityName: new BABYLON.GUI.TextBlock(`abilityName${i}`, (i + 1).toString()) 
            });
            
            // Add key bind label
            this.actionBar.slots[i].abilityName.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            this.actionBar.slots[i].abilityName.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
            this.actionBar.slots[i].abilityName.fontSize = 12;
            this.actionBar.slots[i].abilityName.color = "yellow";
            this.actionBar.slots[i].container.addControl(this.actionBar.slots[i].abilityName);
            
            slotPanel.addControl(slotContainer);
        }
        
        console.log('[UI] Action bar created.');
    }

    updateActionBar() { 
        if (!this.game.player || !this.actionBar || !this.actionBar.slots) return;

        const actionSlots = this.game.player.combat.actionSlots;

        // Safely iterate and update the action bar UI elements
        actionSlots.forEach((ability, index) => { 
            const uiSlot = this.actionBar.slots[index]; 

            if (!uiSlot || !uiSlot.container) return; 

            if (ability) {
                // Ability is assigned to the slot
                const ratio = ability.getCooldownRatio();
                
                // Cooldown logic
                if (ratio > 0) {
                    const remaining = ability.currentCooldown.toFixed(1);
                    uiSlot.cooldownText.text = remaining;
                    // Darken the slot to show cooldown
                    uiSlot.container.background = `rgba(0, 0, 0, ${0.5 + 0.5 * ratio})`;
                } else {
                    uiSlot.cooldownText.text = "";
                    uiSlot.container.background = "rgba(100, 100, 100, 0.8)";
                }
                
                // Set the ability icon (or a placeholder)
                uiSlot.abilityIcon.source = ability.icon || ""; 
                
            } else {
                // Slot is empty
                uiSlot.cooldownText.text = "";
                uiSlot.abilityIcon.source = "";
                uiSlot.container.background = "rgba(100, 100, 100, 0.5)"; 
            }
        });
    }

    // --- Inventory Window ---
    createInventoryWindow() {
        this.inventoryWindow = new BABYLON.GUI.Rectangle("inventoryWindow");
        this.inventoryWindow.width = "400px";
        this.inventoryWindow.height = "500px";
        this.inventoryWindow.color = "#FFF";
        this.inventoryWindow.thickness = 1;
        this.inventoryWindow.background = "rgba(0, 0, 0, 0.7)";
        this.inventoryWindow.isHitTestVisible = false; // Not clickable when hidden
        this.inventoryWindow.isVisible = false;
        this.gui.addControl(this.inventoryWindow);
        
        const title = new BABYLON.GUI.TextBlock("inventoryTitle", "INVENTORY");
        title.fontSize = 24;
        title.height = "40px";
        title.color = "white";
        title.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.inventoryWindow.addControl(title);

        this.inventoryGrid = this._createInventoryGrid();
        this.inventoryGrid.top = "40px";
        this.inventoryGrid.height = "80%";
        this.inventoryWindow.addControl(this.inventoryGrid);
        
        console.log('[UI] Inventory window created.');
    }
    
    _createInventoryGrid() {
        // Placeholder for the Grid layout. Actual population happens during update/open.
        const grid = new BABYLON.GUI.Grid("inventoryGrid");
        const columns = 5;
        const rows = CONFIG.PLAYER.INVENTORY_SIZE / columns; 

        // Set up columns
        for (let i = 0; i < columns; i++) {
            grid.addColumnDefinition(1 / columns);
        }
        // Set up rows
        for (let i = 0; i < rows; i++) {
            grid.addRowDefinition(1 / rows);
        }
        
        return grid;
    }

    toggleInventory() {
        this.uiVisible.inventory = !this.uiVisible.inventory;
        this.inventoryWindow.isVisible = this.uiVisible.inventory;
        this.inventoryWindow.isHitTestVisible = this.uiVisible.inventory;
        
        if (this.uiVisible.inventory) {
            this.updateInventoryWindow();
        }
    }
    
    updateInventoryWindow() {
        if (!this.game.player || !this.uiVisible.inventory) return;
        
        const playerInventory = this.game.player.inventory.slots;
        const columns = 5;
        
        this.inventoryGrid.clearControls(); // Clear old items

        for (let i = 0; i < playerInventory.length; i++) {
            const item = playerInventory[i];
            
            const slotContainer = new BABYLON.GUI.Rectangle(`invSlot${i}`);
            slotContainer.width = 0.9;
            slotContainer.height = 0.9;
            slotContainer.thickness = 1;
            slotContainer.color = "#FFF";
            slotContainer.background = "rgba(50, 50, 50, 0.8)";
            slotContainer.metadata = { slotIndex: i };
            
            if (item) {
                const itemIcon = new BABYLON.GUI.Image(`invItemIcon${i}`, item.icon || "");
                itemIcon.width = 0.8;
                itemIcon.height = 0.8;
                slotContainer.addControl(itemIcon);
                
                if (item.quantity > 1) {
                    const quantityText = new BABYLON.GUI.TextBlock(`invItemQuantity${i}`, item.quantity.toString());
                    quantityText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
                    quantityText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
                    quantityText.fontSize = 14;
                    quantityText.color = "white";
                    slotContainer.addControl(quantityText);
                }
            }
            
            const row = Math.floor(i / columns);
            const col = i % columns;
            this.inventoryGrid.addControl(slotContainer, row, col);
        }
    }

    // --- Input Bindings ---
    createInputBindings() {
        // Simple display of input context (placeholder)
        const text = new BABYLON.GUI.TextBlock("inputBindingsText", "W, A, S, D: Move | Shift: Sprint | 1-5: Ability | I: Inventory | T: Target");
        text.color = "white";
        text.fontSize = 14;
        text.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        text.paddingBottom = "5px";
        this.gui.addControl(text);
        
        console.log('[UI] Input bindings created.');
    }
    
    // --- System Messages ---
    showMessage(message, durationMs = 3000, messageType = 'info') {
        const durationSeconds = durationMs / 1000;
        const finalDuration = durationMs;
        
        const color = {
            'info': 'white',
            'success': '#0F0',
            'error': '#F00',
            'critical': '#FF0',
            'playerDamage': '#C44',
            'enemyDamage': '#FF0',
            'heal': '#4C4'
        }[messageType] || 'white';

        const systemMessage = new BABYLON.GUI.TextBlock();
        systemMessage.text = message;
        systemMessage.color = color;
        systemMessage.fontSize = 24;
        systemMessage.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        systemMessage.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        systemMessage.paddingBottom = "60px";
        systemMessage.alpha = 1;
        this.gui.addControl(systemMessage);
        
        setTimeout(() => {
             // Fade out system message
             systemMessage.dispose();
        }, finalDuration);
    }

    // --- Main Update Loop ---
    update(deltaTime) {
        // Player is sometimes null during initialization, so we check
        if (!this.game.player) {
             this.player = this.game.player;
             return; 
        }

        const pStats = this.game.player.stats;
        this._updateBar(this.healthBar, this.game.player.health, pStats.maxHealth, "HP");
        this._updateBar(this.manaBar, this.game.player.mana, pStats.maxMana, "MP");
        this._updateBar(this.staminaBar, this.game.player.stamina, pStats.maxStamina, "STM");

        this.updateTargetInfo(this.game.player.combat.target);
        this.updateActionBar();
    }

    _updateBar(barElements, current, max, label) {
        if (!barElements || !barElements.bar) return; // Safety check
        const ratio = current / max;
        // Ensure ratio is a string representation of the number
        barElements.bar.width = ratio.toFixed(2); 
        barElements.text.text = `${label}: ${Math.max(0, current).toFixed(0)} / ${max.toFixed(0)}`;
    }
}
// Ensure the UIManager class is globally accessible
window.UIManager = UIManager;
