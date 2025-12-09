// ===========================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.1 (FIXED)
// ===========================================================

class UIManager {
    constructor(scene) {
        this.scene = scene;
        // Create fullscreen UI when GUI is available; otherwise fall back to an HTML container.
        if (typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.AdvancedDynamicTexture) {
            this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);
        } else {
            console.warn('[UI] BABYLON.GUI not available. Falling back to HTML message container.');
            this.advancedTexture = null;
        }
        
        this.hud = null;
        this.targetFrame = null;
        this.actionBar = null;
        this.messageContainer = null; 
        this.inventoryWindow = null;
        this.actionBarSlots = []; 
    }

    init() {
        this._createHUD();
        this._createTargetFrame();
        this._createActionBar();
        this._createMessageSystem();
        this._createInventoryWindow(); 
        this._createInputBindings(); 
        console.log('[UI] All UI components initialized.');
    }

    _createHUD() {
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel)) {
            console.warn('[UI] HUD skipped: GUI system unavailable.');
            return;
        }

        this.hud = new BABYLON.GUI.StackPanel("hudPanel");
        this.hud.width = "300px";
        this.hud.height = "150px";
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.left = "20px";
        this.hud.top = "20px";
        this.advancedTexture.addControl(this.hud);

        const createBar = (name, color, label) => {
            const container = new BABYLON.GUI.StackPanel(name + "_container");
            container.height = "30px";
            container.isVertical = false;
            
            const labelText = new BABYLON.GUI.TextBlock(name + "_label");
            labelText.text = label;
            labelText.width = "80px";
            labelText.color = "white";
            labelText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            labelText.fontSize = 14;
            container.addControl(labelText);
            
            const bar = new BABYLON.GUI.Rectangle(name);
            bar.width = "200px";
            bar.height = "20px";
            bar.background = "black";
            bar.color = "white";
            bar.thickness = 1;
            
            const fill = new BABYLON.GUI.Rectangle(name + "_fill");
            fill.width = "100%";
            fill.height = "100%";
            fill.background = color;
            fill.thickness = 0;
            fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
            
            bar.addControl(fill);
            container.addControl(bar);
            this.hud.addControl(container);
            
            return fill;
        }

        this.healthBar = createBar("health", "red", "HP:");
        this.manaBar = createBar("mana", "blue", "MP:");
        this.staminaBar = createBar("stamina", "green", "SP:");
    }

    _createTargetFrame() {
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel)) {
            console.warn('[UI] Target frame skipped: GUI system unavailable.');
            return;
        }

        this.targetFrame = new BABYLON.GUI.StackPanel("targetFrame");
        this.targetFrame.width = "250px";
        this.targetFrame.height = "80px";
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.targetFrame.top = "50px";
        this.targetFrame.background = "rgba(0,0,0,0.5)";
        this.targetFrame.isVisible = false;
        
        const nameText = new BABYLON.GUI.TextBlock("targetName");
        nameText.text = "Target";
        nameText.color = "yellow";
        nameText.fontSize = 18;
        nameText.height = "25px";
        this.targetFrame.addControl(nameText);
        this.targetName = nameText;

        const hpBar = new BABYLON.GUI.Rectangle("targetHP");
        hpBar.width = "100%";
        hpBar.height = "20px";
        hpBar.background = "black";
        
        const hpFill = new BABYLON.GUI.Rectangle("targetHPFill");
        hpFill.width = "100%";
        hpFill.height = "100%";
        hpFill.background = "red";
        hpFill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        
        hpBar.addControl(hpFill);
        this.targetFrame.addControl(hpBar);
        this.targetHP = hpFill;

        this.advancedTexture.addControl(this.targetFrame);
    }

    _createActionBar() {
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.Button && BABYLON.GUI.StackPanel)) {
            console.error("[UI] BABYLON.GUI components are undefined. Check if babylon.gui.min.js is loaded correctly.");
            return;
        }

        this.actionBar = new BABYLON.GUI.StackPanel("actionBarPanel");
        this.actionBar.width = "500px";
        this.actionBar.height = "70px";
        this.actionBar.isVertical = false;
        this.actionBar.width = "450px";
        this.actionBar.height = "70px";
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.paddingBottom = "20px";
        this.advancedTexture.addControl(this.actionBar);

        for (let i = 0; i < 5; i++) {
            const slot = new BABYLON.GUI.Rectangle("slot" + i);
            slot.width = "60px";
            slot.height = "60px";
            slot.thickness = 2;
            slot.color = "white";
            slot.background = "rgba(0,0,0,0.7)";
            slot.paddingLeft = "5px";
            slot.paddingRight = "5px";

            const keyText = new BABYLON.GUI.TextBlock("slotKey" + i);
            keyText.text = (i + 1).toString();
            keyText.color = "white";
            keyText.fontSize = 12;
            keyText.top = "-20px";
            slot.addControl(keyText);
            
            const abilityText = new BABYLON.GUI.TextBlock("slotAbility" + i);
            abilityText.text = "";
            abilityText.color = "white";
            abilityText.fontSize = 14;
            slot.addControl(abilityText);
            slot.abilityText = abilityText;

            this.actionBar.addControl(slot);
            this.actionBarSlots.push({ button: slot });
        }
    }

    _createMessageSystem() {
        if (this.advancedTexture && typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel) {
            this.messageContainer = new BABYLON.GUI.StackPanel("messageContainer");
            this.messageContainer.width = "40%";
            this.messageContainer.height = "200px";
            this.messageContainer.isVertical = true;
            this.messageContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
            this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
            this.advancedTexture.addControl(this.messageContainer);
            console.log('[UI] Message system created (GUI).');
            return;
        }

        // HTML fallback (when GUI is unavailable)
        var existing = document.getElementById('ui-message-container');
        if (existing) {
            this.messageContainer = existing;
            return;
        }

        var body = document.body || document.getElementsByTagName('body')[0];
        if (!body) {
            body = document.createElement('body');
            document.documentElement.appendChild(body);
        }

        var container = document.createElement('div');
        container.id = 'ui-message-container';
        container.style.position = 'fixed';
        container.style.top = '10px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.width = '40%';
        container.style.maxHeight = '200px';
        container.style.overflow = 'hidden';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '6px';
        container.style.zIndex = '9999';
        body.appendChild(container);
        this.messageContainer = container;
        console.log('[UI] Message system created (HTML fallback).');
    }

    showMessage(text, duration = 2000, type = 'info') {
        if (!this.messageContainer) {
            this._createMessageSystem();
            if (!this.messageContainer) return;
        }

        // HTML fallback path
        if (!(typeof BABYLON !== 'undefined' && BABYLON.GUI && this.messageContainer instanceof BABYLON.GUI.StackPanel)) {
            var div = document.createElement('div');
            div.textContent = text;
            div.style.padding = '6px 10px';
            div.style.background = 'rgba(0,0,0,0.7)';
            div.style.color = type === 'error' ? 'red' :
                type === 'heal' ? 'lightgreen' :
                    type === 'enemyDamage' ? 'yellow' :
                        type === 'playerDamage' ? 'orange' : 'white';
            div.style.fontSize = '16px';
            div.style.borderRadius = '4px';
            div.style.border = '1px solid rgba(255,255,255,0.2)';

            // Prepend
            if (this.messageContainer.firstChild) {
                this.messageContainer.insertBefore(div, this.messageContainer.firstChild);
            } else {
                this.messageContainer.appendChild(div);
            }

            // Cull overflow
            while (this.messageContainer.childNodes.length > 7) {
                var last = this.messageContainer.lastChild;
                if (last) last.remove();
            }

            setTimeout(function () { div.remove(); }, duration);
            return;
        }

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
        
        switch(type) {
            case 'error': msg.color = "red"; break;
            case 'heal': msg.color = "lime"; break;
            case 'playerDamage': msg.color = "orange"; break;
            case 'enemyDamage': msg.color = "yellow"; break;
            default: msg.color = "white";
        }
        
        msg.fontSize = 18;
        msg.height = "25px";
        msg.shadowColor = "black";
        msg.shadowBlur = 3;
        msg.shadowOffsetX = 2;
        msg.shadowOffsetY = 2;
        
        this.messageContainer.addControl(msg);
        
        setTimeout(() => {
            if (msg && msg.dispose) {
                msg.dispose();
            }
        }, duration);
    }
    
    _createInventoryWindow() {
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.Rectangle && BABYLON.GUI.TextBlock)) {
            console.warn('[UI] Inventory window skipped: GUI system unavailable.');
            return;
        }

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
        if (typeof BABYLON === 'undefined' || !this.scene) {
            console.warn('[UI] Input bindings skipped: Babylon or scene unavailable.');
            return;
        }

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

    setTarget(target) {
        if (target && !target.isDead) {
            this.targetFrame.isVisible = true;
            this.targetName.text = target.name + " (Lvl " + (target.level || 1) + ")";
        } else {
            this.targetFrame.isVisible = false;
        }
    }

    update(player) {
        if (!player) return;
        
        // Update player bars
        if (player.stats.maxHealth > 0) {
            this.healthBar.width = Math.max(0, player.health / player.stats.maxHealth).toString();
        }
        
        if (player.stats.maxMana > 0) {
            this.manaBar.width = Math.max(0, player.mana / player.stats.maxMana).toString();
        }
        
        if (player.stats.maxStamina > 0) {
            this.staminaBar.width = Math.max(0, player.stamina / player.stats.maxStamina).toString();
        }
        
        // Update target frame
        if (player.target && !player.target.isDead) {
            if (player.target.stats && player.target.stats.maxHealth > 0) {
                this.targetHP.width = Math.max(0, player.target.health / player.target.stats.maxHealth).toString();
            }
        } else if (this.targetFrame.isVisible) {
            this.setTarget(null);
            player.target = null;
        }

        // Update action bar abilities
        const abilities = Array.from(player.abilities.values());
        for (let i = 0; i < this.actionBarSlots.length; i++) {
            const slot = this.actionBarSlots[i];
            const ability = abilities[i];

            if (ability) {
                if (ability.isReady()) {
                    slot.button.color = "lime";
                    slot.button.thickness = 3;
                    slot.button.abilityText.text = ability.name.substring(0, 8);
                } else {
                    const ratio = ability.getCooldownRatio();
                    slot.button.color = "gray";
                    slot.button.thickness = 2;
                    slot.button.abilityText.text = Math.ceil(ability.currentCooldown) + "s";
                }
            } else {
                slot.button.color = "white";
                slot.button.thickness = 2;
                slot.button.abilityText.text = "";
            }
        }
    }
}
window.UIManager = UIManager;
