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
        this.minimap = null;
        this.minimapDots = [];
        this.playerDot = null; 

        this._init();
    }

    _init() {
        this.createHUD();
        this.createMinimap();
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
        container.height = height + "px";
        container.cornerRadius = 5;
        container.color = color;
        container.thickness = 1;
        container.background = "rgba(0, 0, 0, 0.5)";
        container.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        container.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        container.left = left + "px";
        container.top = top + "px";
        
        const labelText = new BABYLON.GUI.TextBlock(id + "Label", label);
        labelText.width = "30px";
        labelText.color = "white";
        labelText.fontSize = 12;
        labelText.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        labelText.paddingLeft = "5px";
        container.addControl(labelText);

        const bar = new BABYLON.GUI.Rectangle(id + "Bar");
        bar.width = "100%"; // Will be dynamically scaled
        bar.height = 1;
        bar.background = color;
        bar.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_LEFT;
        bar.thickness = 0;
        container.addControl(bar);
        
        return { container, bar, label: labelText };
    }

    createMinimap() {
        this.minimap = new BABYLON.GUI.Rectangle("minimapContainer");
        this.minimap.width = "150px";
        this.minimap.height = "150px";
        this.minimap.cornerRadius = 10;
        this.minimap.background = "rgba(0, 0, 0, 0.5)";
        this.minimap.thickness = 1;
        this.minimap.color = "white";
        this.minimap.horizontalAlignment = BABYLON.GUI.Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.minimap.verticalAlignment = BABYLON.GUI.Control.VERTICAL_ALIGNMENT_TOP;
        this.minimap.paddingRight = "10px";
        this.minimap.paddingTop = "10px";
        this.gui.addControl(this.minimap);

        // Player dot (always in center of minimap)
        this.playerDot = new BABYLON.GUI.Ellipse("playerDot");
        this.playerDot.width = "5px";
        this.playerDot.height = "5px";
        this.playerDot.color = "yellow";
        this.playerDot.background = "yellow";
        this.playerDot.thickness = 0;
        this.minimap.addControl(this.playerDot);

        // Call immediately to populate the map, which was the source of the crash
        this.updateMinimapLandmarks();
    }

    // Patched function that fixes the TypeError crash
    updateMinimapLandmarks() {
        if (!this.game.world || !this.player || !this.player.mesh) return;

        // Clean up previous dots
        this.minimapDots.forEach(dot => dot.dispose());
        this.minimapDots = [];

        // Define map constants
        const mapSize = 150; 
        const worldSize = this.game.world.options.size || 1000;
        const scale = mapSize / worldSize; 

        const playerX = this.player.mesh.position.x;
        const playerZ = this.player.mesh.position.z;
        
        // Combine NPCs and Enemies, defensively checking for null arrays
        const entities = [...(this.game.world.npcs || []), ...(this.game.world.enemies || [])];
        
        for (const entity of entities) {
            // FIX: Safely check if entity, its mesh, and its position are valid
            if (!entity || !entity.mesh || !entity.mesh.position) {
                continue; // Skip any entity that is null, undefined, or missing its position
            }

            // Calculate position relative to player (center of minimap)
            const entityX = entity.mesh.position.x;
            const entityZ = entity.mesh.position.z;
            
            const dotX = (entityX - playerX) * scale;
            const dotY = (entityZ - playerZ) * scale;

            // Only draw dots within the minimap's bounds
            if (Math.abs(dotX) < mapSize / 2 && Math.abs(dotY) < mapSize / 2) {
                const isEnemy = entity.constructor.name === 'Enemy';

                const dot = new BABYLON.GUI.Ellipse("mapDot");
                dot.width = isEnemy ? "4px" : "3px";
                dot.height = isEnemy ? "4px" : "3px";
                dot.color = isEnemy ? "red" : "blue";
                dot.background = isEnemy ? "red" : "blue";
                dot.thickness = 0;
                dot.left = dotX + "px";
                dot.top = -dotY + "px"; 
                
                this.minimap.addControl(dot);
                this.minimapDots.push(dot);
            }
        }

        // Update player dot (always in center)
        this.playerDot.left = "0px";
        this.playerDot.top = "0px";

    }

    update(deltaTime) {
        // Update status bars
        this.updateStatusBar(this.healthBar, this.player.health, this.player.maxHealth);
        this.updateStatusBar(this.manaBar, this.player.mana, this.player.maxMana);
        this.updateStatusBar(this.staminaBar, this.player.stamina, this.player.maxStamina);

        // Update minimap landmarks
        this.updateMinimapLandmarks();

        if (this.debugText) {
            this.updateDebugInfo();
        }
    }

    updateStatusBar(statusBar, current, max) {
        const percentage = Math.max(0, current / max);
        statusBar.bar.width = percentage * 100 + "%";
        statusBar.label.text = `${statusBar.label.text.substring(0, 2)} ${Math.floor(current)}/${max}`;
    }
    
    // Placeholder functions (inferred/required for class completeness)
    createDebugInfo() { /* Implementation omitted for brevity */ }
    updateDebugInfo() { /* Implementation omitted for brevity */ }
    showMessage(text, duration) { /* Implementation omitted for brevity */ }
    
    // Combat UI methods
    showCombatUI(show) {
        if (show && !this.combatUI) {
            this.createCombatUI();
        }
        
        if (this.combatUI) {
            this.combatUI.style.display = show ? 'block' : 'none';
        }
    }
    
    createCombatUI() {
        // Create combat UI container
        this.combatUI = document.createElement('div');
        this.combatUI.id = 'combat-ui';
        this.combatUI.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            width: 400px;
            display: none;
            z-index: 100;
            font-family: Arial, sans-serif;
        `;
        
        // Target frame
        const targetFrame = document.createElement('div');
        targetFrame.id = 'target-frame';
        targetFrame.style.cssText = `
            background: linear-gradient(135deg, rgba(139, 0, 0, 0.8) 0%, rgba(80, 0, 0, 0.9) 100%);
            border: 2px solid #ff4444;
            border-radius: 8px;
            padding: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;
        
        targetFrame.innerHTML = `
            <div style="color: #ff4444; font-size: 14px; font-weight: bold; margin-bottom: 8px;">
                <span id="target-name">Enemy</span>
                <span id="target-level" style="color: #ffd700; float: right;">Lvl 1</span>
            </div>
            <div style="background: rgba(0,0,0,0.3); border-radius: 4px; height: 24px; position: relative; overflow: hidden;">
                <div id="target-hp-bar" style="background: linear-gradient(90deg, #ff0000, #cc0000); height: 100%; width: 100%; transition: width 0.3s ease;"></div>
                <div id="target-hp-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 12px; font-weight: bold; text-shadow: 1px 1px 2px black;">
                    100 / 100
                </div>
            </div>
        `;
        
        this.combatUI.appendChild(targetFrame);
        
        // Ability bar
        const abilityBar = document.createElement('div');
        abilityBar.id = 'ability-bar';
        abilityBar.style.cssText = `
            display: flex;
            gap: 8px;
            margin-top: 15px;
            justify-content: center;
        `;
        
        // Create ability buttons
        const abilities = [
            { key: '1', name: 'Power Strike', cooldown: 3000, icon: '⚔️' },
            { key: '2', name: 'Cleave', cooldown: 6000, icon: '💥' },
            { key: '3', name: 'Heal', cooldown: 8000, icon: '💚' }
        ];
        
        abilities.forEach(ability => {
            const btn = document.createElement('div');
            btn.id = `ability-${ability.key}`;
            btn.className = 'ability-button';
            btn.style.cssText = `
                width: 50px;
                height: 50px;
                background: linear-gradient(135deg, rgba(40, 40, 60, 0.9) 0%, rgba(20, 20, 40, 0.95) 100%);
                border: 2px solid #666;
                border-radius: 6px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                position: relative;
                transition: all 0.2s;
            `;
            
            btn.innerHTML = `
                <div style="font-size: 20px;">${ability.icon}</div>
                <div style="font-size: 10px; color: #aaa; margin-top: 2px;">${ability.key}</div>
                <div class="cooldown-overlay" style="display: none; position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); border-radius: 4px; align-items: center; justify-content: center; color: white; font-size: 12px;"></div>
            `;
            
            btn.addEventListener('mouseenter', () => {
                if (!btn.classList.contains('on-cooldown')) {
                    btn.style.borderColor = '#ffd700';
                    btn.style.transform = 'scale(1.1)';
                }
            });
            
            btn.addEventListener('mouseleave', () => {
                btn.style.borderColor = '#666';
                btn.style.transform = 'scale(1)';
            });
            
            abilityBar.appendChild(btn);
        });
        
        this.combatUI.appendChild(abilityBar);
        document.body.appendChild(this.combatUI);
    }
    
    updateTargetFrame(target) {
        if (!target || !target.stats) return;
        
        const nameEl = document.getElementById('target-name');
        const levelEl = document.getElementById('target-level');
        const hpBar = document.getElementById('target-hp-bar');
        const hpText = document.getElementById('target-hp-text');
        
        if (nameEl) nameEl.textContent = target.name;
        if (levelEl) levelEl.textContent = `Lvl ${target.stats.level || 1}`;
        
        if (hpBar && hpText) {
            const hpPercent = (target.stats.currentHP / target.stats.maxHP) * 100;
            hpBar.style.width = hpPercent + '%';
            hpText.textContent = `${Math.floor(target.stats.currentHP)} / ${target.stats.maxHP}`;
        }
    }
    
    showAbilityCooldown(abilityKey, duration) {
        const btn = document.getElementById(`ability-${abilityKey}`);
        if (!btn) return;
        
        const overlay = btn.querySelector('.cooldown-overlay');
        if (!overlay) return;
        
        btn.classList.add('on-cooldown');
        btn.style.borderColor = '#333';
        overlay.style.display = 'flex';
        
        const startTime = Date.now();
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, duration - elapsed);
            const seconds = Math.ceil(remaining / 1000);
            
            overlay.textContent = seconds > 0 ? seconds : '';
            
            if (remaining <= 0) {
                clearInterval(interval);
                btn.classList.remove('on-cooldown');
                btn.style.borderColor = '#666';
                overlay.style.display = 'none';
            }
        }, 100);
    }
    
    updateXPBar() {
        // Update XP display
        if (this.player && this.player.stats) {
            console.log(`[UI] XP: ${this.player.stats.currentXP}/${this.player.stats.level * 100}`);
        }
    }
    
    updatePlayerStats() {
        // Update stat displays after level up
        console.log(`[UI] Stats updated`);
    }
    
    updateCombatLog(entry) {
        // Add to combat log
        console.log(`[UI] ${entry}`);
    }
    
    // Create target menu system (MMORPG-style context menu)
    createTargetMenu() {
        this.targetMenu = {
            isVisible: false,
            selectedIndex: 0,
            options: [],
            container: null,
            target: null,
            
            show: function(target) {
                this.isVisible = true;
                this.selectedIndex = 0;
                this.target = target;
                
                // Determine available actions based on target type
                this.options = [];
                
                if (target.isEnemy) {
                    this.options.push({ label: 'Attack', action: 'attack', icon: '⚔️' });
                    this.options.push({ label: 'Use Item', action: 'useItem', icon: '🧪' });
                    this.options.push({ label: 'Consider', action: 'consider', icon: '🔍' });
                } else {
                    // NPC
                    this.options.push({ label: 'Talk', action: 'talk', icon: '💬' });
                    this.options.push({ label: 'Trade', action: 'trade', icon: '💰' });
                    this.options.push({ label: 'Use Item', action: 'useItem', icon: '🧪' });
                    this.options.push({ label: 'Consider', action: 'consider', icon: '🔍' });
                }
                
                this.options.push({ label: 'Cancel', action: 'cancel', icon: '❌' });
                
                // Create or update UI
                this.createUI();
            },
            
            hide: function() {
                this.isVisible = false;
                this.target = null;
                if (this.container) {
                    this.container.style.display = 'none';
                }
            },
            
            createUI: function() {
                if (!this.container) {
                    // Create container
                    this.container = document.createElement('div');
                    this.container.id = 'target-menu';
                    this.container.style.cssText = `
                        position: fixed;
                        bottom: 20px;
                        right: 20px;
                        background: linear-gradient(135deg, rgba(20, 20, 40, 0.95) 0%, rgba(10, 10, 30, 0.98) 100%);
                        border: 3px solid #ffd700;
                        border-radius: 10px;
                        padding: 15px;
                        min-width: 220px;
                        max-width: 280px;
                        box-shadow: 0 8px 24px rgba(0,0,0,0.8);
                        z-index: 10001;
                        font-family: Arial, sans-serif;
                    `;
                    document.body.appendChild(this.container);
                }
                
                // Clear and rebuild
                this.container.innerHTML = '<div id="menu-options"></div>';
                
                const optionsContainer = this.container.querySelector('#menu-options');
                
                this.options.forEach((option, index) => {
                    const optionEl = document.createElement('div');
                    optionEl.className = 'menu-option';
                    optionEl.dataset.index = index;
                    optionEl.style.cssText = `
                        padding: 12px 20px;
                        margin: 5px 0;
                        background: ${index === this.selectedIndex ? 'rgba(255, 215, 0, 0.4)' : 'rgba(255, 255, 255, 0.1)'};
                        border: 2px solid ${index === this.selectedIndex ? '#ffd700' : 'rgba(255, 255, 255, 0.2)'};
                        border-radius: 5px;
                        color: white;
                        cursor: pointer;
                        transition: all 0.2s;
                        text-align: left;
                        font-size: 16px;
                        font-weight: ${index === this.selectedIndex ? 'bold' : 'normal'};
                    `;
                    optionEl.innerHTML = `${option.icon} ${option.label}`;
                    
                    optionEl.addEventListener('mouseenter', () => {
                        this.selectedIndex = index;
                        this.createUI();
                    });
                    
                    optionEl.addEventListener('click', () => {
                        this.executeSelected();
                    });
                    
                    optionsContainer.appendChild(optionEl);
                });
                
                this.container.style.display = 'block';
            },
            
            moveSelection: function(direction) {
                this.selectedIndex += direction;
                
                // Wrap around
                if (this.selectedIndex < 0) {
                    this.selectedIndex = this.options.length - 1;
                }
                if (this.selectedIndex >= this.options.length) {
                    this.selectedIndex = 0;
                }
                
                // Update visual
                this.createUI();
            },
            
            executeSelected: function() {
                const selected = this.options[this.selectedIndex];
                if (!selected) return;
                
                const game = window.game;
                const combat = game?.combat;
                const target = this.target || combat?.currentTarget;
                
                console.log(`[UI] Executing: ${selected.action} on ${target?.name}`);
                
                switch (selected.action) {
                    case 'attack':
                        if (target && target.isEnemy && combat) {
                            combat.enterCombat();
                            console.log('[UI] Entering combat with:', target.name);
                        }
                        break;
                        
                    case 'talk':
                        console.log('[UI] Talking to:', target?.name);
                        alert(`${target?.name} says: "Greetings, traveler!"`);
                        break;
                        
                    case 'trade':
                        console.log('[UI] Trading with:', target?.name);
                        alert(`${target?.name} says: "What would you like to buy or sell?"`);
                        break;
                        
                    case 'useItem':
                        console.log('[UI] Using item on:', target?.name);
                        if (game?.player?.inventory) {
                            game.player.inventory.toggleInventory();
                            alert('Select an item from your inventory to use.');
                        } else {
                            alert('Inventory system not available.');
                        }
                        break;
                        
                    case 'consider':
                        if (target) {
                            const level = target.stats?.level || 1;
                            const hp = target.stats?.currentHP || target.health || 100;
                            const maxHP = target.stats?.maxHP || target.maxHealth || 100;
                            const hpPercent = Math.round((hp / maxHP) * 100);
                            
                            let assessment = '';
                            if (target.isEnemy) {
                                if (hpPercent >= 75) assessment = 'Strong and healthy.';
                                else if (hpPercent >= 50) assessment = 'Wounded but dangerous.';
                                else if (hpPercent >= 25) assessment = 'Severely wounded.';
                                else assessment = 'Near death.';
                            } else {
                                assessment = 'Looks friendly.';
                            }
                            
                            alert(`${target.name}\nLevel: ${level}\nHealth: ${hp}/${maxHP} (${hpPercent}%)\n\n${assessment}`);
                        }
                        break;
                        
                    case 'cancel':
                        // Just close menu
                        break;
                }
                
                this.hide();
            }
        };
        
        // Store reference in UIManager
        console.log('[UI] Target menu created');
    }
    
    dispose() {
        // Clean up UI elements
        if (this.targetMenu && this.targetMenu.container) {
            this.targetMenu.container.remove();
        }
    }
}
