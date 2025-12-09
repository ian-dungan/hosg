// ===========================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.0.1 (FIXED)
// ===========================================================

class UIManager {
    constructor(scene) {
        this.scene = scene;
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI");
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
        console.log('[UI] Initialized.');
    }

    _createHUD() {
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
        this.actionBar = new BABYLON.GUI.StackPanel("actionBar");
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
        this.messageContainer = new BABYLON.GUI.StackPanel("msgContainer");
        this.messageContainer.width = "400px";
        this.messageContainer.height = "300px";
        this.messageContainer.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.messageContainer.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.messageContainer.top = "50px";
        this.messageContainer.isHitTestVisible = false; 
        this.advancedTexture.addControl(this.messageContainer);
    }

    showMessage(text, duration = 3000, type = 'info') {
        const msg = new BABYLON.GUI.TextBlock();
        msg.text = text;
        
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
