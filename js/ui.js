// ============================================================
// HEROES OF SHADY GROVE - UI MANAGER v1.1.2 (MESSAGE PREPEND FIX)
// Fix: Replaced insertAt with robust prepending logic in showMessage.
// ============================================================

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

    // --- Initialization ---

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
        
        console.log('[UI] HUD created.'); 
    }

    _createTargetFrame() {
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.StackPanel)) {
            console.warn('[UI] Target frame skipped: GUI system unavailable.');
            return;
        }

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
        if (!this.advancedTexture || !(typeof BABYLON !== 'undefined' && BABYLON.GUI && BABYLON.GUI.Button && BABYLON.GUI.StackPanel)) {
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
            const button = BABYLON.GUI.Button.CreateSimpleButton(slotId, (i + 1).toString());
            button.width = "60px";
            button.height = "60px";
            button.color = "white";
            button.background = "black";
            button.alpha = 0.7;
            button.thickness = 2;
            button.paddingLeft = "5px";
            button.paddingRight = "5px";
            
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
        
        // CRITICAL FIX: Robust prepending logic to replace missing insertAt
        const oldChildren = [...this.messageContainer.children];
        this.messageContainer.clearControls();
        
        // 1. Add the newest message
        this.messageContainer.addControl(textBlock); 
        
        // 2. Re-add the old messages (maintaining order)
        const maxMessages = 7; 
        for (let i = 0; i < Math.min(maxMessages, oldChildren.length); i++) {
            this.messageContainer.addControl(oldChildren[i]);
        }
        
        // 3. Dispose of the messages that were culled
        for (let i = maxMessages; i < oldChildren.length; i++) {
            oldChildren[i].dispose();
        }

        // Set a timeout to remove the message after the duration
        setTimeout(() => {
            textBlock.dispose();
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
        
        for (let i = 0; i < this.actionBarSlots.length; i++) {
            const slot = this.actionBarSlots[i];
            const ability = player.abilities[i];
            
            if (ability) {
                slot.button.textBlock.text = ability.name.substring(0, 1);
                
                if (ability.isReady()) {
                    slot.button.background = "green";
                    slot.button.alpha = 1.0;
                    slot.button.textBlock.text = ability.name.substring(0, 1);
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
