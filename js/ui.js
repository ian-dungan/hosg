// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.12 (PATCHED)
// Fix: Corrected getCanvas() to getRenderingCanvas() in createInputBindings.
// Fix: Added placeholder grid creation methods for Inventory/Equipment.
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
        container.thickness = 1;
        container.cornerRadius = 5;
        container.color = "white";
        container.background = "#333333";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = top + "px";
        container.left = left + "px";
        this.gui.addControl(container);

        const bar = new BABYLON.GUI.Rectangle(name + "Bar");
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        bar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        bar.background = colorHex;
        bar.color = colorHex;
        bar.height = 1;
        bar.width = 1; // Starts full
        bar.thickness = 0;
        container.addControl(bar);

        const text = new BABYLON.GUI.TextBlock(name + "Text");
        text.text = `${labelText}: 100/100`;
        text.color = "white";
        text.fontSize = 16;
        container.addControl(text);

        return { container, bar, text };
    }

    createHUD() {
        // Player Status Bars
        this.healthBar = this.createStatusBar("health", "HP", "#A00000", 250, 25, 10, 10);
        this.manaBar = this.createStatusBar("mana", "MP", "#0000A0", 250, 25, 40, 10);
        this.staminaBar = this.createStatusBar("stamina", "STM", "#00A000", 250, 25, 70, 10);
        console.log("[UI] HUD created.");
    }

    createTargetFrame() {
        // Placeholder for the target frame UI element
        const container = new BABYLON.GUI.Rectangle("targetFrameContainer");
        container.width = "200px";
        container.height = "100px";
        container.thickness = 1;
        container.color = "white";
        container.background = "#222222";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.top = "10px";
        container.left = "-10px";
        container.isVisible = false;
        this.gui.addControl(container);

        const nameText = new BABYLON.GUI.TextBlock("targetName");
        nameText.text = "Target Name";
        nameText.color = "yellow";
        nameText.fontSize = 20;
        nameText.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        nameText.top = "5px";
        container.addControl(nameText);
        
        // Target Health Bar (simple placeholder)
        const barContainer = new BABYLON.GUI.Rectangle("targetHealthContainer");
        barContainer.width = 0.9;
        barContainer.height = "15px";
        barContainer.thickness = 0;
        barContainer.background = "black";
        barContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        container.addControl(barContainer);
        
        const healthBar = new BABYLON.GUI.Rectangle("targetHealthBar");
        healthBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        healthBar.height = 1;
        healthBar.width = 1; 
        healthBar.background = "red";
        healthBar.thickness = 0;
        barContainer.addControl(healthBar);

        this.targetFrame = { container, nameText, healthBar };
        console.log("[UI] Target frame created.");
    }
    
    updateTargetInfo(target) {
        if (!this.targetFrame) return;

        if (target && !target.isDead) {
            this.targetFrame.container.isVisible = true;
            this.targetFrame.nameText.text = target.name;
            const healthRatio = target.health / target.stats.maxHealth;
            this.targetFrame.healthBar.width = healthRatio.toFixed(2);
        } else {
            this.targetFrame.container.isVisible = false;
        }
    }

    createActionBar() {
        // Simple placeholder for the action bar
        this.actionBar = new BABYLON.GUI.StackPanel();
        this.actionBar.isVertical = false;
        this.actionBar.height = "60px";
        this.actionBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.paddingBottom = "10px";
        
        for (let i = 0; i < 5; i++) {
            const button = BABYLON.GUI.Button.CreateSimpleButton("ability" + (i + 1), i + 1);
            button.width = "50px";
            button.height = "50px";
            button.color = "white";
            button.background = "#555555";
            button.thickness = 1;
            button.paddingLeft = "5px";
            button.paddingRight = "5px";
            this.actionBar.addControl(button);
        }

        this.gui.addControl(this.actionBar);
        console.log("[UI] Action bar created.");
    }
    
    updateActionBar() {
        // This method would update the button visuals based on player.abilities and cooldowns
        if (!this.game.player || !this.actionBar) return;
        
        const buttons = this.actionBar.children.filter(c => c.name.startsWith('ability'));
        const playerAbilities = this.game.player.abilities;
        
        buttons.forEach((button, index) => {
            const ability = playerAbilities[index];
            if (ability) {
                const ratio = ability.getCooldownRatio();
                
                // Set text to ability name
                const textBlock = button.children[0];
                textBlock.text = ability.name;
                
                // Simple cooldown visual: darken the button
                if (!ability.isReady()) {
                    button.background = `rgba(100, 0, 0, ${0.5 + 0.5 * ratio})`;
                } else {
                    button.background = "#555555";
                }
            }
        });
    }

    createInventoryWindow() {
        this.inventoryWindow = new BABYLON.GUI.Rectangle("inventoryWindow");
        this.inventoryWindow.width = "400px";
        this.inventoryWindow.height = "600px";
        this.inventoryWindow.thickness = 2;
        this.inventoryWindow.color = "#AAAAAA";
        this.inventoryWindow.background = "rgba(0, 0, 0, 0.7)";
        this.inventoryWindow.isHitTestVisible = true; // Block raycasts
        this.inventoryWindow.isVisible = false;
        this.gui.addControl(this.inventoryWindow);
        
        // Title
        const title = new BABYLON.GUI.TextBlock("inventoryTitle");
        title.text = "Character Inventory";
        title.fontSize = 24;
        title.color = "white";
        title.height = "40px";
        title.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.inventoryWindow.addControl(title);
        
        // Main content area
        const contentPanel = new BABYLON.GUI.StackPanel("inventoryContent");
        contentPanel.isVertical = false;
        contentPanel.paddingTop = "40px";
        this.inventoryWindow.addControl(contentPanel);

        // Sub-panels
        const equipmentPanel = new BABYLON.GUI.StackPanel("equipmentPanel");
        equipmentPanel.width = "30%";
        contentPanel.addControl(equipmentPanel);
        this.equipmentGrid = this._createEquipmentGrid();
        equipmentPanel.addControl(this.equipmentGrid);
        
        const inventoryPanel = new BABYLON.GUI.StackPanel("inventoryPanel");
        inventoryPanel.width = "70%";
        contentPanel.addControl(inventoryPanel);
        this.inventoryGrid = this._createInventoryGrid();
        inventoryPanel.addControl(this.inventoryGrid);

        console.log("[UI] Inventory window created.");
    }
    
    _createInventoryGrid() {
        // Placeholder for the inventory grid
        const grid = new BABYLON.GUI.Grid("inventoryGrid");
        const CAPACITY = CONFIG.PLAYER.INVENTORY_SIZE;
        const COLUMNS = 4;
        const ROWS = Math.ceil(CAPACITY / COLUMNS);
        
        for (let i = 0; i < ROWS; i++) {
            grid.addRowDefinition(1 / ROWS, true);
        }
        for (let j = 0; j < COLUMNS; j++) {
            grid.addColumnDefinition(1 / COLUMNS, true);
        }
        
        for (let i = 0; i < CAPACITY; i++) {
            const button = BABYLON.GUI.Button.CreateImageButton(`invSlot${i}`, "", "");
            button.width = 0.8;
            button.height = 0.8;
            button.background = "#111111";
            button.color = "#555555";
            button.thickness = 1;
            grid.addControl(button, Math.floor(i / COLUMNS), i % COLUMNS);
        }
        
        grid.height = "90%";
        grid.width = "90%";
        return grid;
    }
    
    _createEquipmentGrid() {
        // Placeholder for the equipment grid (Head, Chest, Weapon, etc.)
        const grid = new BABYLON.GUI.Grid("equipmentGrid");
        // Define some rows for slots (Head, Body, Weapon)
        grid.addRowDefinition(0.33, true); 
        grid.addRowDefinition(0.33, true);
        grid.addRowDefinition(0.34, true);
        grid.addColumnDefinition(1.0, true);

        // Placeholder button for "Head"
        const headSlot = BABYLON.GUI.Button.CreateSimpleButton("equipSlot_Head", "Head");
        headSlot.color = "white";
        headSlot.background = "#111111";
        grid.addControl(headSlot, 0, 0);

        // Placeholder button for "Body"
        const bodySlot = BABYLON.GUI.Button.CreateSimpleButton("equipSlot_Body", "Body");
        bodySlot.color = "white";
        bodySlot.background = "#111111";
        grid.addControl(bodySlot, 1, 0);
        
        // Placeholder button for "Weapon"
        const weaponSlot = BABYLON.GUI.Button.CreateSimpleButton("equipSlot_Weapon", "Weapon");
        weaponSlot.color = "white";
        weaponSlot.background = "#111111";
        grid.addControl(weaponSlot, 2, 0);

        grid.height = "90%";
        grid.width = "90%";
        return grid;
    }

    toggleInventory() {
        this.uiVisible.inventory = !this.uiVisible.inventory;
        this.inventoryWindow.isVisible = this.uiVisible.inventory;

        // Tell the player class whether the UI is open to disable movement
        if (this.game.player) {
            this.game.player.setUISensitivity(this.uiVisible.inventory);
        }
    }
    
    createInputBindings() {
        // Key B for Inventory
        const canvas = this.scene.getEngine().getRenderingCanvas(); // CRASH FIX: getRenderingCanvas()
        
        canvas.addEventListener("keydown", (evt) => {
            // Only handle UI keypresses if the UI is not completely locked (e.g. by a modal)
            if (evt.keyCode === 66) { // B key
                this.toggleInventory();
            }
        });
        
        console.log("[UI] Input bindings created.");
    }

    // --- System Messages ---
    showMessage(text, duration, type = 'info') {
        const label = {
            'info': { color: 'white', duration: 1500 },
            'error': { color: 'red', duration: 2500 },
            'success': { color: 'lime', duration: 1500 },
            'playerDamage': { color: 'red', duration: 1000 },
            'enemyDamage': { color: 'yellow', duration: 1000 },
            'heal': { color: 'lime', duration: 1000 },
            'death': { color: 'darkred', duration: 5000 },
        }[type] || { color: 'white', duration: 1500 };

        // Duration override
        const finalDuration = duration || label.duration;

        // Create a system message (will appear at the bottom of the screen, transient messages)
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
             // This is an over-simplified fade, just a dispose after time
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
        const ratio = current / max;
        // Ensure ratio is a string representation of the number
        barElements.bar.width = ratio.toFixed(2); 
        barElements.text.text = `${label}: ${current.toFixed(0)}/${max.toFixed(0)}`;
    }
}
