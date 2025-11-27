// UI Manager - simple HUD with health/mana/stamina bars
class UIManager {
    constructor(game) {
        this.game = game;
        this.scene = game.scene;
        this.player = game.player;

        this.gui = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);

        this.hud = null;
        this.healthBar = null;
        this.manaBar = null;
        this.staminaBar = null;
        this.debugText = null;

        this._init();
    }

    _init() {
        this.createHUD();
        if (CONFIG.DEBUG) {
            this.createDebugInfo();
        }
    }

    createHUD() {
        // Root HUD container
        this.hud = new BABYLON.GUI.Rectangle("hudRoot");
        this.hud.width = "100%";
        this.hud.height = "100%";
        this.hud.thickness = 0;
        this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.gui.addControl(this.hud);

        // Health bar
        this.healthBar = this.createStatusBar(
            "health",
            "HP",
            "#ff4040",
            200,
            18,
            10,
            10
        );
        this.hud.addControl(this.healthBar.container);

        // Mana bar
        this.manaBar = this.createStatusBar(
            "mana",
            "MP",
            "#4080ff",
            200,
            18,
            10,
            40
        );
        this.hud.addControl(this.manaBar.container);

        // Stamina bar
        this.staminaBar = this.createStatusBar(
            "stamina",
            "ST",
            "#40ff40",
            200,
            18,
            10,
            70
        );
        this.hud.addControl(this.staminaBar.container);
    }

    createStatusBar(id, label, color, width, height, left, top) {
        const container = new BABYLON.GUI.Rectangle(id + "Container");
        container.width = width + "px";
        container.height = height + 20 + "px";
        container.thickness = 0;
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = left + "px";
        container.top = top + "px";

        // Label
        const labelText = new BABYLON.GUI.TextBlock(id + "Label", label);
        labelText.color = "white";
        labelText.fontSize = 14;
        labelText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        labelText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        labelText.paddingLeft = 4;
        labelText.paddingTop = 0;
        container.addControl(labelText);

        // Background bar
        const background = new BABYLON.GUI.Rectangle(id + "Background");
        background.width = "100%";
        background.height = height + "px";
        background.thickness = 1;
        background.color = "white";
        background.background = "#000a";
        background.cornerRadius = 4;
        background.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        background.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.top = 18; // below label
        container.addControl(background);

        // Fill
        const fill = new BABYLON.GUI.Rectangle(id + "Fill");
        fill.width = "100%";
        fill.height = "100%";
        fill.thickness = 0;
        fill.background = color;
        fill.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        fill.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        background.addControl(fill);

        // Value text
        const valueText = new BABYLON.GUI.TextBlock(id + "Value", "");
        valueText.color = "white";
        valueText.fontSize = 12;
        valueText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        valueText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        background.addControl(valueText);

        const setValue = (current, max) => {
            max = max || 1;
            const ratio = Math.max(0, Math.min(1, current / max));
            fill.width = (ratio * 100).toFixed(1) + "%";
            valueText.text = `${Math.round(current)}/${Math.round(max)}`;
        };

        // Initialize with full bar
        setValue(1, 1);

        return {
            container,
            background,
            fill,
            valueText,
            setValue
        };
    }

    createDebugInfo() {
        this.debugText = new BABYLON.GUI.TextBlock("debugInfo");
        this.debugText.text = "FPS: 60";
        this.debugText.color = "lime";
        this.debugText.fontSize = 12;
        this.debugText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.debugText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.debugText.paddingTop = "10px";
        this.debugText.paddingRight = "10px";
        this.gui.addControl(this.debugText);
    }

    update(deltaTime) {
        if (!this.player) {
            this.player = this.game.player;
        }
        
        const p = this.player;
        if (!p) return;

        // Update health bar
        if (this.healthBar) {
            this.healthBar.setValue(p.health, p.maxHealth || CONFIG.PLAYER.HEALTH);
        }
        
        // Update mana bar
        if (this.manaBar) {
            const mana = typeof p.mana === "number" ? p.mana : 0;
            const maxMana = typeof p.maxMana === "number" ? p.maxMana : 100;
            this.manaBar.setValue(mana, maxMana);
        }
        
        // Update stamina bar
        if (this.staminaBar) {
            const stamina = typeof p.stamina === "number" ? p.stamina : 0;
            const maxStamina = typeof p.maxStamina === "number" ? p.maxStamina : CONFIG.PLAYER.STAMINA;
            this.staminaBar.setValue(stamina, maxStamina);
        }

        // Update debug info
        if (this.debugText && this.game.engine) {
            const fps = this.game.engine.getFps().toFixed(0);
            const pos = p.mesh ? p.mesh.position : new BABYLON.Vector3(0, 0, 0);
            this.debugText.text = `FPS: ${fps}\nPos: ${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}\nGrounded: ${p.isOnGround ? 'Yes' : 'No'}`;
        }
    }

    showMessage(message, duration = 3000) {
        const msgText = new BABYLON.GUI.TextBlock("message");
        msgText.text = message;
        msgText.color = "white";
        msgText.fontSize = 18;
        msgText.fontWeight = "bold";
        msgText.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        msgText.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        msgText.paddingTop = "-100px";
        
        const bg = new BABYLON.GUI.Rectangle("messageBg");
        bg.width = "400px";
        bg.height = "60px";
        bg.thickness = 2;
        bg.color = "white";
        bg.background = "rgba(0, 0, 0, 0.8)";
        bg.cornerRadius = 10;
        bg.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
        bg.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
        bg.paddingTop = "-100px";
        
        bg.addControl(msgText);
        this.gui.addControl(bg);

        setTimeout(() => {
            this.gui.removeControl(bg);
        }, duration);
    }

    dispose() {
        if (this.gui) {
            this.gui.dispose();
            this.gui = null;
        }
    }
}

window.UIManager = UIManager;
