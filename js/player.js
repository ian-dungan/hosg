// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.8 (PATCHED)
// Requires Character (from world.js), Ability, Item (from item.js)
// ============================================================

class Player extends Character {
    constructor(scene) {
        super(scene, new BABYLON.Vector3(0, CONFIG.PLAYER.SPAWN_HEIGHT, 0), 'Player');
        
        this.isPlayer = true; 

        this.stats = {
            maxHealth: CONFIG.PLAYER.HEALTH,
            maxMana: CONFIG.PLAYER.MANA, 
            maxStamina: CONFIG.PLAYER.STAMINA,
            attackPower: 10,
            magicPower: 5,
            moveSpeed: CONFIG.PLAYER.MOVE_SPEED,
            runMultiplier: CONFIG.PLAYER.RUN_MULTIPLIER
        };

        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;

        this.combat = {
            globalCooldown: 0,
            target: null,
            attackRange: CONFIG.COMBAT.BASE_ATTACK_RANGE
        };
        
        this.inventory = new Inventory(this); 
        this.equipment = new Equipment(this); 
        this.abilities = []; 
        
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            jump: false,
            isUIOpen: false 
        };
        
        // Placeholder methods/setups for BABYLON dependencies
        this.setupCamera = () => { /* ... BABYLON Camera setup ... */ };
        this.setupInputHandling = () => { /* ... BABYLON Input setup ... */ };
        this.setupTargeting = () => { /* ... BABYLON Targeting setup ... */ };
        this.setupMesh = () => { 
            // Minimal placeholder mesh for testing
            this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerMesh", { height: 1.8, diameter: 0.8 }, this.scene);
            this.visualRoot = this.mesh; 
            this.mesh.material = new BABYLON.StandardMaterial('pMat', this.scene);
            this.mesh.material.diffuseColor = BABYLON.Color3.Blue();
            this.mesh.position.y = this.position.y;
            this.mesh.metadata = { isPlayer: true, owner: this };
        };
        this.handleMovement = (deltaTime) => { /* ... Movement Logic ... */ };
        this.handleRotation = () => { /* ... Rotation Logic ... */ };
        this.playAnimation = (name) => { /* ... Animation Logic ... */ };

        this.setupCamera();
        this.setupInputHandling();
        this.setupTargeting();
    }

    async init(characterLoadData = {}) {
        const charData = characterLoadData.character || {};
        const initialPosition = new BABYLON.Vector3(
            charData.position_x || 0,
            charData.position_y || CONFIG.PLAYER.SPAWN_HEIGHT,
            charData.position_z || 0
        );
        this.position.copyFrom(initialPosition);
        
        if (charData.stats) {
            this.stats = { ...this.stats, ...charData.stats };
        }
        this.health = charData.health || this.stats.maxHealth;
        this.mana = charData.mana || this.stats.maxMana; 
        this.stamina = charData.stamina || this.stats.maxStamina;
        
        this.setupMesh(); 
        if (this.visualRoot) this.visualRoot.rotation.y = charData.rotation_y || 0;
        
        this.inventory.load(characterLoadData.inventory_items || [], characterLoadData.itemTemplates);
        this.equipment.load(characterLoadData.equipped_items || [], characterLoadData.itemTemplates);
        
        // Load abilities, relying on the passed skillTemplates Map
        this.loadAbilities(characterLoadData.player_skills || [], characterLoadData.skillTemplates);

        // Placeholder for setting up targeting from click (must be integrated with scene/mesh)
        this.scene.onPointerDown = (evt, pickResult) => {
            if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.metadata) {
                const metadata = pickResult.pickedMesh.metadata;
                if (metadata.isEnemy || metadata.isNPC) {
                    this.combat.target = metadata.owner;
                } else if (metadata.isLoot) {
                    this.handleLoot(metadata.owner);
                } else {
                    this.combat.target = null; 
                }
            }
        };
    }

    loadAbilities(skills, skillTemplates) {
        this.abilities = [];
        skills.forEach(skillInstance => {
            const template = skillTemplates.get(skillInstance.skill_id);
            
            if (template) {
                this.abilities.push(new Ability(template));
            } else {
                 // PATCH: Graceful handling for missing templates
                 console.warn(`[Player] Missing skill template for ID: ${skillInstance.skill_id}. Skipping ability load.`);
            }
        });
        
        // Ensure Auto Attack is always index 0
        const autoAttackTemplate = {
            id: 0, code: 'auto_attack', name: 'Auto Attack', skill_type: 'Physical', 
            resource_cost: {}, cooldown_ms: CONFIG.COMBAT.GLOBAL_COOLDOWN * 1000, 
            effect: { type: 'damage', requiresTarget: true, base_value: CONFIG.COMBAT.BASE_MELEE_DAMAGE, physical_scaling: 1.0 }
        };
        if (!this.abilities.find(a => a.code === 'auto_attack')) {
             this.abilities.unshift(new Ability(autoAttackTemplate));
        }
    }
    
    // ... (rest of the file)
    castAbility(abilityCode) {
        if (this.isDead || this.combat.globalCooldown > 0) {
            this.scene.game.ui.showMessage('Global Cooldown in effect.', 1000, 'warning');
            return false;
        }

        const ability = this.abilities.find(a => a.code === abilityCode);
        if (!ability || !ability.isReady()) return false;
        
        const cost = ability.resourceCost;
        if ((cost.mana || 0) > this.mana || (cost.stamina || 0) > this.stamina) {
            this.scene.game.ui.showMessage(`Not enough resources for ${ability.name}.`, 1500, 'warning');
            return false;
        }

        let target = this.combat.target;
        if (ability.effectData.requiresTarget) {
            if (!target || target.isDead) {
                this.scene.game.ui.showMessage('Requires a valid target.', 1500, 'warning');
                return false;
            }
            const range = ability.type === 'Magic' ? CONFIG.COMBAT.BASE_CAST_RANGE : CONFIG.COMBAT.BASE_ATTACK_RANGE;
            const distance = BABYLON.Vector3.Distance(this.mesh.position, target.mesh.position);
            if (distance > range) { 
                this.scene.game.ui.showMessage('Target is out of range.', 1500, 'warning');
                return false;
            }
        }
        
        this.mana -= cost.mana || 0;
        this.stamina -= cost.stamina || 0;
        this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN;
        
        return ability.execute(this, target);
    }
    
    // ... (rest of the file)
    autoAttack() {
        return this.castAbility('auto_attack');
    }
    
    useItem(item, slotIndex) {
        if (item.itemType === 'Consumable') {
            if (item.effects.health_restore) {
                this.health = Math.min(this.stats.maxHealth, this.health + item.effects.health_restore);
                this.scene.game.ui.showMessage(`Restored ${item.effects.health_restore} Health!`, 1500, 'heal');
            }
            this.inventory.removeItem(slotIndex, 1);
        } else if (item.itemType === 'Weapon' || item.itemType === 'Armor') {
            const unequippedItem = this.equipment.equip(item);
            this.inventory.removeItem(slotIndex, 1); 
            if (unequippedItem) {
                if (!this.inventory.addItem(unequippedItem)) {
                    this.equipment.equip(unequippedItem);
                    this.scene.game.ui.showMessage("Inventory full! Cannot swap gear.", 2000, 'error');
                }
            }
        }
    }
    
    handleLoot(lootContainer) {
        if (lootContainer.isOpened) return;

        let goldTotal = 0;
        let itemsLooted = 0;
        
        lootContainer.loot.forEach(lootEntry => {
            if (lootEntry.item_template_id === -1) { 
                goldTotal += lootEntry.quantity;
            } else {
                const template = this.scene.game.itemTemplates.get(lootEntry.item_template_id);
                if (template) {
                    const itemInstance = new Item(template, null, lootEntry.quantity);
                    if (this.inventory.addItem(itemInstance)) {
                        itemsLooted++;
                    }
                }
            }
        });
        
        if (goldTotal > 0) {
            this.scene.game.ui.showMessage(`Looted ${goldTotal} Gold!`, 1500, 'gold');
        }
        
        if (goldTotal > 0 || itemsLooted > 0) {
            lootContainer.isOpened = true;
            if (lootContainer.mesh) lootContainer.mesh.material.diffuseColor = BABYLON.Color3.Gray(); 
        }
    }

    getSaveData() {
        return {
            position: this.position,
            rotation_y: this.visualRoot ? this.visualRoot.rotation.y : 0,
            stats: this.stats, 
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData() 
        };
    }
    
    setUISensitivity(isUIOpen) {
        if (isUIOpen) {
            this.input.forward = this.input.backward = this.input.left = this.input.right = false;
        }
        this.input.isUIOpen = isUIOpen;
    }

    update(deltaTime) {
        super.update(deltaTime); 
        
        this.abilities.forEach(ability => ability.update(deltaTime));

        if (!this.input.isUIOpen) { 
            this.handleMovement(deltaTime);
            this.handleRotation();
        }
        
        if (this.combat.globalCooldown > 0) {
            this.combat.globalCooldown -= deltaTime;
        }
        
        // Auto Attack logic
        const target = this.combat.target;
        if (target && !target.isDead && BABYLON.Vector3.Distance(this.mesh.position, target.mesh.position) <= this.combat.attackRange) {
            this.autoAttack();
        }
    }
}
window.Player = Player;
