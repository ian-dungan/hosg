// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.8
// HUD, Target Frame, Action Bar, Inventory, Messages
// ============================================================

class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;

        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.inventoryWindow = null;
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
        this.createInventoryWindow();
        this.createInputBindings(); 
    }

    // --- Status Bars ---
    createStatusBar(name, labelText, colorHex, width = 250, height = 25, top = 10, left = 10) {
        // ... (Status bar creation logic) ...
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
        bar.width = 1.0;
        bar.height = 1.0;
        bar.thickness = 0;
        bar.cornerRadius = 5;
        bar.background = colorHex;
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.addControl(bar);
        
        const text = new BABYLON.GUI.TextBlock(name + "Text");
        text.text = labelText;
        text.color = "white";
        text.fontSize = 14;
        text.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        container.addControl(text);

        return { container, bar, text };
    }

    createHUD() {
        this.hud = new BABYLON.GUI.Rectangle("hudRoot");
        this.hud.width = "100%";
        this.hud.height = "100%";
        this.hud.thickness = 0;
        this.gui.addControl(this.hud);
        
        this.healthBar = this.createStatusBar("health", "HP", "#ff4040", 250, 25, 10, 10);
        this.manaBar = this.createStatusBar("mana", "MP", "#4040ff", 250, 25, 40, 10);
        this.staminaBar = this.createStatusBar("stamina", "STM", "#40ff40", 250, 25, 70, 10);
    }
    
    // --- Target Frame ---
    createTargetFrame() {
        // ... (Target Frame creation logic) ...
        this.targetFrame = new BABYLON.GUI.StackPanel("targetPanel");
        this.targetFrame.width = "250px";
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.top = "10px";
        this.gui.addControl(this.targetFrame);
        this.targetFrame.isVisible = false;
        
        this.targetName = new BABYLON.GUI.TextBlock("targetNameText");
        this.targetName.height = "25px";
        this.targetName.color = "white";
        this.targetFrame.addControl(this.targetName);

        this.targetHealthContainer = new BABYLON.GUI.Rectangle("targetHealthContainer");
        this.targetHealthContainer.height = "20px";
        this.targetFrame.addControl(this.targetHealthContainer);

        this.targetHealthBar = new BABYLON.GUI.Rectangle("targetHealthBar");
        this.targetHealthBar.background = "#ff4040";
        this.targetHealthContainer.addControl(this.targetHealthBar);

        this.targetHealthText = new BABYLON.GUI.TextBlock("targetHealthText");
        this.targetHealthContainer.addControl(this.targetHealthText);
    }
    
    updateTargetInfo(target) {
        if (!target || target.isDead) {
            this.targetFrame.isVisible = false;
            return;
        }

        this.targetFrame.isVisible = true;
        this.targetName.text = target.name;
        
        const healthRatio = target.health / target.stats.maxHealth;
        
        this.targetHealthBar.width = healthRatio.toFixed(2);
        this.targetHealthText.text = `${target.health.toFixed(0)} / ${target.stats.maxHealth.toFixed(0)}`;
    }
    
    // --- Action Bar ---
    createActionBar() {
        this.actionBar = new BABYLON.GUI.StackPanel("actionBar");
        this.actionBar.isVertical = false;
        this.actionBar.height = "50px";
        this.actionBar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.paddingBottom = "10px";
        this.gui.addControl(this.actionBar);

        // Pre-populate buttons for quick access (abilities will be assigned in update)
        this.abilityButtons = [];
        for (let i = 0; i < 5; i++) {
            const ability = this.player.abilities[i];
            const button = this._createActionBarButton(ability, i + 1);
            this.actionBar.addControl(button);
            this.abilityButtons.push(button);
        }
    }
    
    _createActionBarButton(ability, keyBinding) {
        const button = new BABYLON.GUI.Button(`abilityBtn_${keyBinding}`);
        button.width = "40px";
        button.height = "40px";
        button.background = "#222222";
        button.color = "white";
        button.thickness = 1;
        button.cornerRadius = 5;
        button.paddingLeft = "5px";
        button.paddingRight = "5px";
        
        const textBlock = new BABYLON.GUI.TextBlock();
        textBlock.fontSize = 24;
        button.addControl(textBlock);
        
        const cooldownOverlay = new BABYLON.GUI.Rectangle("cooldownOverlay");
        cooldownOverlay.width = 1.0;
        cooldownOverlay.height = 1.0;
        cooldownOverlay.background = "rgba(0, 0, 0, 0.7)";
        cooldownOverlay.thickness = 0;
        button.addControl(cooldownOverlay);
        
        const keyLabel = new BABYLON.GUI.TextBlock();
        keyLabel.text = `${keyBinding}`;
        keyLabel.color = "yellow";
        keyLabel.fontSize = 10;
        keyLabel.top = "15px";
        keyLabel.left = "-15px";
        keyLabel.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        keyLabel.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        button.addControl(keyLabel);

        button.onPointerUpObservable.add(() => {
            if (button.ability) {
                this.player.castAbility(button.ability.code);
            }
        });
        
        button.ability = ability; 
        button.textBlock = textBlock;
        button.cooldownOverlay = cooldownOverlay; 
        
        return button;
    }
    
    updateActionBar() {
        const playerAbilities = this.player.abilities;
        this.abilityButtons.forEach((button, index) => {
            const ability = playerAbilities[index];
            button.ability = ability;
            button.isVisible = !!ability;
            if (!ability) return;

            button.textBlock.text = ability.code.charAt(0).toUpperCase();
            
            const overlay = button.cooldownOverlay;
            const ratio = ability.getCooldownRatio();
            
            if (ratio > 0) {
                overlay.isVisible = true;
                overlay.height = `${ratio * 100}%`; 
                overlay.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
            } else {
                overlay.isVisible = false;
            }
            
            // Global Cooldown visual check
            const gcdRatio = this.player.combat.globalCooldown / CONFIG.COMBAT.GLOBAL_COOLDOWN;
             if (gcdRatio > 0 && ability.code !== 'auto_attack') {
                button.background = 'rgba(0, 0, 0, 0.9)'; 
            } else {
                button.background = '#222222';
            }
        });
    }

    // --- Inventory Window ---
    createInventoryWindow() {
        this.inventoryWindow = new BABYLON.GUI.Rectangle("inventoryWindow");
        this.inventoryWindow.width = "300px";
        this.inventoryWindow.height = "400px";
        this.inventoryWindow.thickness = 2;
        this.inventoryWindow.cornerRadius = 10;
        this.inventoryWindow.color = "white";
        this.inventoryWindow.background = "rgba(0, 0, 0, 0.8)";
        this.gui.addControl(this.inventoryWindow);
        this.inventoryWindow.isVisible = false;
        
        const header = new BABYLON.GUI.TextBlock("invHeader");
        header.text = "Inventory (Press I)";
        header.color = "yellow";
        header.height = "30px";
        header.top = "-180px";
        this.inventoryWindow.addControl(header);

        this.inventorySlots = new BABYLON.GUI.Grid("invGrid");
        this.inventorySlots.width = "90%";
        this.inventorySlots.height = "80%";
        this.inventorySlots.top = "15px";
        this.inventorySlots.columnDefinitions.push(1/5, 1/5, 1/5, 1/5, 1/5);
        this.inventorySlots.rowDefinitions.push(1/4, 1/4, 1/4, 1/4);
        
        this.inventoryWindow.addControl(this.inventorySlots); 
    }

    toggleInventory() {
        this.uiVisible.inventory = !this.uiVisible.inventory;
        this.inventoryWindow.isVisible = this.uiVisible.inventory;
        
        if (this.uiVisible.inventory) {
            this.renderInventorySlots();
            this.player.setUISensitivity(true); 
        } else {
            this.player.setUISensitivity(false); 
        }
    }

    renderInventorySlots() {
        this.inventorySlots.getChildren().forEach(c => this.inventorySlots.removeControl(c));

        const inventory = this.player.inventory;
        
        inventory.slots.forEach((item, index) => {
            const col = index % 5;
            const row = Math.floor(index / 5);
            
            const slotButton = new BABYLON.GUI.Button(`invSlot_${index}`);
            slotButton.width = 0.9;
            slotButton.height = 0.9;
            slotButton.background = item ? "#555555" : "#333333";
            slotButton.color = "white";
            slotButton.thickness = 1;
            
            slotButton.onPointerUpObservable.add(() => {
                if (item) {
                    this.player.useItem(item, index);
                    this.renderInventorySlots(); 
                }
            });
            
            if (item) {
                const itemText = new BABYLON.GUI.TextBlock();
                itemText.text = item.name + (item.quantity > 1 ? ` (x${item.quantity})` : "");
                itemText.fontSize = 12;
                slotButton.addControl(itemText);
            }
            
            this.inventorySlots.addControl(slotButton, row, col);
        });
    }

    // --- Input Bindings ---
    createInputBindings() {
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        // Bind 'I' to toggle inventory
        this.scene.actionManager.registerAction(
            new BABYLON.ExecuteCodeAction(
                { trigger: BABYLON.ActionManager.OnKeyUpTrigger, parameter: 'i' },
                () => { this.toggleInventory(); }
            )
        );
        
        // Bind numbers 1-5 to cast abilities
        for (let i = 1; i <= 5; i++) {
            this.scene.actionManager.registerAction(
                new BABYLON.ExecuteCodeAction(
                    { trigger: BABYLON.ActionManager.OnKeyUpTrigger, parameter: i.toString() },
                    () => {
                        if (!this.uiVisible.inventory && this.player.abilities[i - 1]) {
                            this.player.castAbility(this.player.abilities[i - 1].code);
                        }
                    }
                )
            );
        }
    }

    // --- Floating Text ---
    showMessage(text, duration = 1500, type = 'default', mesh = null) {
        if (!text) return;

        var label = new BABYLON.GUI.TextBlock("floatingText");
        label.text = text;
        label.fontSize = 20;
        label.outlineWidth = 2;
        label.outlineColor = "black";

        if (type === "gold") { label.color = "#ffd700"; } 
        else if (type === "playerDamage") { label.color = "#ff3333"; } 
        else if (type === "enemyDamage") { label.color = "#ffffff"; }
        else if (type === "heal") { label.color = "#40ff40"; }
        else if (type === "success") { label.color = "#77ff77"; }
        else if (type === "warning") { label.color = "#ffdd55"; }
        else { label.color = "white"; }

        if (mesh) {
            // World Space Floating Text
            label.top = "-35%";
            label.left = "0px";
            this.gui.addControl(label);
            
            label.linkWithMesh(mesh);
            label.linkOffsetY = -100; // Above the mesh
            label.linkOffsetX = 0;
            
            var scene = this.scene;
            var startTime = performance.now();
            var total = duration;

            var observer = scene.onBeforeRenderObservable.add(function () {
                var t = (performance.now() - startTime) / total;
                if (t >= 1) {
                    scene.onBeforeRenderObservable.remove(observer);
                    label.dispose();
                } else {
                    // Float up slowly
                    label.linkOffsetY = -100 - t * 50; 
                    label.alpha = 1 - t; // Fade out
                }
            });
            
        } else {
            // Screen Space Message (for system messages)
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
}
window.UIManager = UIManager;
