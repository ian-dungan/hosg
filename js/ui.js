// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.2.0 (LEGACY SAFE)
// Converted to ES5-friendly syntax (no class/arrow/let/const)
// while preserving existing HUD, action bar, message, and
// inventory behavior with Babylon GUI or HTML fallbacks.
// ============================================================

function UIManager(scene) {
    this.scene = scene;

    // Create fullscreen UI when available; fall back to HTML otherwise.
    if (typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.AdvancedDynamicTexture) {
        this.advancedTexture = BABYLON.GUI.AdvancedDynamicTexture.CreateFullscreenUI('UI', true, scene);
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

// --- Initialization ---
UIManager.prototype.init = function () {
    this._createHUD();
    this._createTargetFrame();
    this._createActionBar();
    this._createMessageSystem();
    this._createInventoryWindow();
    this._createInputBindings();
    console.log('[UI] All UI components initialized.');
};

// --- HUD ---
UIManager.prototype._createHUD = function () {
    if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel)) {
        console.warn('[UI] HUD skipped: GUI system unavailable.');
        return;
    }

    this.hud = new BABYLON.GUI.StackPanel('hudPanel');
    this.hud.width = '50%';
    this.hud.height = '100px';
    this.hud.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this.hud.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
    this.hud.paddingLeft = '20px';
    this.advancedTexture.addControl(this.hud);

    var healthText = new BABYLON.GUI.TextBlock('healthText');
    healthText.color = 'red';
    healthText.text = 'HP: 100/100';
    healthText.height = '30px';
    this.hud.addControl(healthText);

    console.log('[UI] HUD created.');
};

// --- Target Frame ---
UIManager.prototype._createTargetFrame = function () {
    if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel)) {
        console.warn('[UI] Target frame skipped: GUI system unavailable.');
        return;
    }

    this.targetFrame = new BABYLON.GUI.StackPanel('targetFrame');
    this.targetFrame.width = '200px';
    this.targetFrame.height = '50px';
    this.targetFrame.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this.targetFrame.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
    this.targetFrame.paddingRight = '20px';
    this.targetFrame.isVisible = false;
    this.advancedTexture.addControl(this.targetFrame);
    console.log('[UI] Target frame created.');
};

// --- Action Bar ---
UIManager.prototype._createActionBar = function () {
    if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.Button && BABYLON.GUI.StackPanel)) {
        console.error('[UI] BABYLON.GUI components are undefined. Check if babylon.gui.min.js is loaded correctly.');
        return;
    }

    this.actionBar = new BABYLON.GUI.StackPanel('actionBarPanel');
    this.actionBar.width = '500px';
    this.actionBar.height = '70px';
    this.actionBar.isVertical = false;
    this.actionBar.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_BOTTOM;
    this.advancedTexture.addControl(this.actionBar);

    for (var i = 0; i < 5; i++) {
        var slotId = 'actionSlot' + i;
        var button = BABYLON.GUI.Button.CreateSimpleButton(slotId, (i + 1).toString());
        button.width = '60px';
        button.height = '60px';
        button.color = 'white';
        button.background = 'black';
        button.alpha = 0.7;
        button.thickness = 2;
        button.paddingLeft = '5px';
        button.paddingRight = '5px';

        this.actionBarSlots.push({
            button: button,
            ability: null,
            cooldownOverlay: null
        });

        this.actionBar.addControl(button);
    }

    console.log('[UI] Action bar created.');
};

// --- Message System ---
UIManager.prototype._createMessageSystem = function () {
    if (this.advancedTexture && typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel) {
        this.messageContainer = new BABYLON.GUI.StackPanel('messageContainer');
        this.messageContainer.width = '40%';
        this.messageContainer.height = '200px';
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
};

UIManager.prototype.showMessage = function (text, duration, type) {
    duration = typeof duration === 'number' ? duration : 2000;
    type = type || 'info';

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
            if (last && last.parentNode) last.parentNode.removeChild(last);
        }

        setTimeout(function () { if (div && div.parentNode) div.parentNode.removeChild(div); }, duration);
        return;
    }

    var textBlock = new BABYLON.GUI.TextBlock();
    textBlock.text = text;
    textBlock.color = type === 'error' ? 'red' :
        type === 'heal' ? 'lightgreen' :
            type === 'enemyDamage' ? 'yellow' :
                type === 'playerDamage' ? 'orange' : 'white';
    textBlock.fontSize = 18;
    textBlock.textHorizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_CENTER;
    textBlock.textVerticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_CENTER;
    textBlock.height = '25px';

    // Robust prepending logic to replace missing insertAt
    var oldChildren = this.messageContainer.children ? Array.prototype.slice.call(this.messageContainer.children) : [];
    if (typeof this.messageContainer.clearControls === 'function') {
        this.messageContainer.clearControls();
    }

    // 1. Add the newest message
    if (typeof this.messageContainer.addControl === 'function') {
        this.messageContainer.addControl(textBlock);
    }

    // 2. Re-add the old messages (maintaining order)
    var maxMessages = 7;
    for (var i = 0; i < Math.min(maxMessages, oldChildren.length); i++) {
        if (typeof this.messageContainer.addControl === 'function') {
            this.messageContainer.addControl(oldChildren[i]);
        }
    }

    // 3. Dispose of the messages that were culled
    for (var j = maxMessages; j < oldChildren.length; j++) {
        if (oldChildren[j] && typeof oldChildren[j].dispose === 'function') {
            oldChildren[j].dispose();
        }
    }

    // Set a timeout to remove the message after the duration
    var self = this;
    setTimeout(function () {
        if (textBlock && typeof textBlock.dispose === 'function') {
            textBlock.dispose();
        }
        // Remove the message from GUI if still present
        if (self.messageContainer && self.messageContainer.children && self.messageContainer.children.length > 0) {
            var children = Array.prototype.slice.call(self.messageContainer.children);
            for (var k = 0; k < children.length; k++) {
                if (children[k] === textBlock && typeof self.messageContainer.removeControl === 'function') {
                    self.messageContainer.removeControl(children[k]);
                }
            }
        }
    }, duration);
};

// --- Inventory Window ---
UIManager.prototype._createInventoryWindow = function () {
    if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.Rectangle && BABYLON.GUI.TextBlock)) {
        console.warn('[UI] Inventory window skipped: GUI system unavailable.');
        return;
    }

    this.inventoryWindow = new BABYLON.GUI.Rectangle('inventoryWindow');
    this.inventoryWindow.width = '300px';
    this.inventoryWindow.height = '400px';
    this.inventoryWindow.background = 'rgba(0,0,0,0.8)';
    this.inventoryWindow.color = 'white';
    this.inventoryWindow.thickness = 2;
    this.inventoryWindow.isVisible = false;
    this.advancedTexture.addControl(this.inventoryWindow);

    var title = new BABYLON.GUI.TextBlock('invTitle');
    title.text = 'Inventory';
    title.fontSize = 24;
    title.color = 'white';
    title.height = '30px';
    title.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
    this.inventoryWindow.addControl(title);

    console.log('[UI] Inventory window created.');
};

// --- Input Bindings ---
UIManager.prototype._createInputBindings = function () {
    if (typeof BABYLON === 'undefined' || !this.scene) {
        console.warn('[UI] Input bindings skipped: Babylon or scene unavailable.');
        return;
    }

    this.scene.actionManager = new BABYLON.ActionManager(this.scene);

    this.scene.actionManager.registerAction(
        new BABYLON.ExecuteCodeAction(
            BABYLON.ActionManager.OnKeyUpTrigger,
            (function (self) {
                return function (evt) {
                    if (!self.inventoryWindow) return;
                    var key = evt.sourceEvent && evt.sourceEvent.key ? evt.sourceEvent.key.toLowerCase() : '';
                    if (key === 'i') {
                        self.inventoryWindow.isVisible = !self.inventoryWindow.isVisible;
                        console.log('[UI] Toggled Inventory: ' + self.inventoryWindow.isVisible);
                    }
                };
            })(this)
        )
    );

    console.log('[UI] Input bindings created.');
};

// --- Update Loop ---
UIManager.prototype.update = function (player) {
    if (!this.hud) return;

    // Update HUD elements (Health)
    var healthText = (typeof this.hud.getChildByName === 'function') ? this.hud.getChildByName('healthText') : null;
    if (healthText) {
        var currentHealth = player && typeof player.health === 'number' ? player.health : 0;
        var maxHealth = (player && player.stats && player.stats.maxHealth) ? player.stats.maxHealth : 100;
        healthText.text = 'HP: ' + currentHealth.toFixed(0) + '/' + maxHealth;
    }

    this.updateActionBar(player);
};

UIManager.prototype.updateActionBar = function (player) {
    if (!this.actionBarSlots || this.actionBarSlots.length === 0 || !player) return;

    var self = this;
    for (var i = 0; i < this.actionBarSlots.length; i++) {
        var slot = this.actionBarSlots[i];
        var ability = player.abilities ? player.abilities[i] : null;

        if (ability && slot.button) {
            slot.button.textBlock.text = ability.name.substring(0, 1);

            if (typeof ability.isReady === 'function' && ability.isReady()) {
                slot.button.background = 'green';
                slot.button.alpha = 1.0;
                slot.button.textBlock.text = ability.name.substring(0, 1);
            } else if (typeof ability.getCooldownRatio === 'function') {
                var ratio = ability.getCooldownRatio();
                slot.button.background = 'black';
                slot.button.alpha = 0.5 + (0.5 * ratio);
                slot.button.textBlock.text = Math.ceil(ability.currentCooldown || 0).toString();
            }

            // Add click behavior (only for player)
            if (player.isPlayer && !slot.button.actionRegistered) {
                (function (abilityRef) {
                    slot.button.onPointerClickObservable.add(function () {
                        if (typeof abilityRef.isReady === 'function' && abilityRef.isReady()) {
                            var target = player.scene && player.scene.game && player.scene.game.player ? player.scene.game.player.target : null;
                            if (typeof abilityRef.execute === 'function') {
                                abilityRef.execute(player, target);
                            }
                        } else {
                            self.showMessage('[' + abilityRef.name + '] is on cooldown!', 1000, 'error');
                        }
                    });
                })(ability);
                slot.button.actionRegistered = true;
            }
        } else if (slot.button) {
            // Empty slot
            slot.button.textBlock.text = (i + 1).toString();
            slot.button.background = 'black';
            slot.button.alpha = 0.7;
        }
    }
};

window.UIManager = UIManager;

