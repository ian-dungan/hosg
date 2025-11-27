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

        this._init();
    }

    _init() {
        this.createHUD();
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

    /**
     * Create a generic labeled status bar.
     */
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
        background.thickness = 0;
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

    /**
     * Called each frame from Game.update if available.
     */
    update(deltaTime) {
        if (!this.player) {
            this.player = this.game.player;
        }
        const p = this.player;
        if (!p) return;

        if (this.healthBar) {
            this.healthBar.setValue(p.health, p.maxHealth || CONFIG.PLAYER.HEALTH);
        }
        if (this.manaBar) {
            const mana = typeof p.mana === "number" ? p.mana : 0;
            const maxMana = typeof p.maxMana === "number" ? p.maxMana : 100;
            this.manaBar.setValue(mana, maxMana);
        }
        if (this.staminaBar) {
            const stamina = typeof p.stamina === "number" ? p.stamina : 0;
            const maxStamina = typeof p.maxStamina === "number" ? p.maxStamina : CONFIG.PLAYER.STAMINA;
            this.staminaBar.setValue(stamina, maxStamina);
        }
    }
}

window.UIManager = UIManager;
