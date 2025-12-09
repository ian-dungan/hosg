// ===========================================================
// HEROES OF SHADY GROVE - UI MANAGER
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
        this._createInventoryWindow(); 
        console.log('[UI] Initialized.');
    }

    _createHUD() {
        this.hud = new BABYLON.GUI.StackPanel("hudPanel");
        this.hud.width = "300px";
        this.hud.height = "100px";
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.left = "20px";
        this.hud.top = "20px";
        this.advancedTexture.addControl(this.hud);

        const createBar = (name, color) => {
            const bar = new BABYLON.GUI.Rectangle(name);
            bar.width = "100%";
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
            this.hud.addControl(bar);
            return fill;
        }

        this.healthBar = createBar("health", "red");
        this.staminaBar = createBar("stamina", "green");
        this.manaBar = createBar("mana", "blue");
    }

    _createTargetFrame() {
        this.targetFrame = new BABYLON.GUI.StackPanel("targetFrame");
        this.targetFrame.width = "200px";
        this.targetFrame.height = "60px";
        this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        this.targetFrame.top = "50px";
        this.targetFrame.isVisible = false;
        
        const nameText = new BABYLON.GUI.TextBlock("targetName");
        nameText.text = "Target";
        nameText.color = "white";
        nameText.height = "20px";
        this.targetFrame.addControl(nameText);
        this.targetName = nameText;

        const hpBar = new BABYLON.GUI.Rectangle("targetHP");
        hpBar.width = "100%";
        hpBar.height = "15px";
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
        this.actionBar.width = "400px";
        this.actionBar.height = "60px";
        this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.actionBar.paddingBottom = "20px";
        this.advancedTexture.addControl(this.actionBar);

        for (let i = 0; i < 5; i++) {
            const slot = new BABYLON.GUI.Rectangle("slot" + i);
            slot.width = "50px";
            slot.height = "50px";
            slot.thickness = 2;
            slot.color = "white";
            slot.background = "black";
            slot.alpha = 0.7;
            slot.paddingLeft = "5px";
            slot.paddingRight = "5px";

            const text = new BABYLON.GUI.TextBlock("slotText" + i);
            text.text = (i + 1).toString();
            text.color = "white";
            slot.addControl(text);
            slot.textBlock = text;

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

    _createInventoryWindow() {
        // Placeholder
    }

    showMessage(text, duration = 3000, type = 'info') {
        const msg = new BABYLON.GUI.TextBlock();
        msg.text = text;
        msg.color = type === 'error' ? "red" : (type === 'heal' ? "green" : "white");
        msg.fontSize = 20;
        msg.height = "30px";
        msg.shadowColor = "black";
        msg.shadowBlur = 2;
        
        this.messageContainer.addControl(msg);
        
        setTimeout(() => {
            msg.dispose();
        }, duration);
    }

    setTarget(target) {
        if (target) {
            this.targetFrame.isVisible = true;
            this.targetName.text = target.name;
        } else {
            this.targetFrame.isVisible = false;
        }
    }

    update(player) {
        if (player.stats.maxHealth > 0) {
            this.healthBar.width = (player.health / player.stats.maxHealth).toString();
        }
        
        if (player.target && !player.target.isDead) {
            if (player.target.stats && player.target.stats.maxHealth > 0) {
                this.targetHP.width = (player.target.health / player.target.stats.maxHealth).toString();
            }
        } else if (this.targetFrame.isVisible) {
            this.setTarget(null);
            player.target = null;
        }

        const abilities = Array.from(player.abilities.values());
        for (let i = 0; i < this.actionBarSlots.length; i++) {
            const slot = this.actionBarSlots[i];
            const ability = abilities[i];

            if (ability) {
                if (ability.isReady()) {
                    slot.button.background = "green";
                    slot.button.alpha = 1.0;
                    slot.button.textBlock.text = ability.name.substring(0, 3);
                } else {
                    const ratio = ability.getCooldownRatio();
                    slot.button.background = "gray";
                    slot.button.alpha = 0.5;
                    slot.button.textBlock.text = Math.ceil(ability.currentCooldown).toString();
                }
            } else {
                slot.button.background = "black";
                slot.button.textBlock.text = "";
            }
        }
    }
}
window.UIManager = UIManager;
