// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.9 (PATCHED)
// Fix: Added init/loadAbilities methods with null check for skill templates.
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
            attackRange: CONFIG.COMBAT.BASE_ATTACK_RANGE // Assuming CONFIG.COMBAT exists
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
        
        // These methods are assumed to exist based on the constructor calls
        this._initCamera();
        this._initCollision();
        this._initMesh();
        this._initTargetHighlight();
        this._initInput(); 
    }
    
    /**
     * Loads character state from the database. Called from Game.init().
     * (Corresponds to line 91 in the trace)
     * @param {Object} data - The complete character data object from NetworkManager.loadCharacter
     * @param {Map} itemTemplates - Map of item templates
     * @param {Map} skillTemplates - Map of skill templates
     */
    init(data, itemTemplates, skillTemplates) {
        // Load position/rotation
        this.position.x = data.character.position_x;
        this.position.y = data.character.position_y;
        this.position.z = data.character.position_z;
        this.visualRoot.rotation.y = data.character.rotation_y;

        // Load resources
        this.health = data.character.health;
        this.mana = data.character.mana;
        this.stamina = data.character.stamina;

        // Load Inventory & Equipment
        // Assumes Inventory.load and Equipment.load are defined elsewhere (e.g., item.js)
        this.inventory.load(data.inventory_items, itemTemplates);
        this.equipment.load(data.equipped_items, itemTemplates);
        
        // Load Abilities
        this.loadAbilities(data.player_skills, skillTemplates);
        
        console.log(`[Player] Loaded position (${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) and state.`);
    }

    /**
     * Creates Ability objects from character skill records and template data.
     * (Corresponds to line 128 in the trace)
     */
    loadAbilities(skillRecords, skillTemplates) {
        if (!skillRecords) return;
        
        this.abilities = skillRecords.map(record => {
            // Find the full skill template using the skill_id from the character record
            const template = skillTemplates.get(record.skill_id);

            // 🌟 FIX: Prevent calling new Ability() with a missing template (The cause of the error)
            if (!template) {
                console.warn(`[Player] Missing skill template for ID ${record.skill_id}. Skipping ability.`);
                return null; 
            }

            // The Ability constructor will now receive a valid template
            return new Ability(template); 
        }).filter(a => a !== null); // Filter out any failed ability creations
        
        console.log(`[Player] Loaded ${this.abilities.length} abilities.`);
    }
    
    
    // ==================================================
    // Existing Methods (Included for file context)
    // ==================================================

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
        
        // Auto Attack logic (simple: if target is in range and GCD is down, auto-attack)
        const target = this.combat.target;
        // ... (rest of update logic)
    }

    handlePointerDown(pickInfo) {
        if (!pickInfo.hit) return;
        
        const mesh = pickInfo.pickedMesh;
        if (!mesh || !mesh.metadata) return;
        
        // Check if clicked mesh is targetable
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            this.setTarget(mesh);
        }
    }
    
    // Placeholder for other essential methods
    handleMovement(deltaTime) {}
    handleRotation() {}
    setTarget(mesh) {}
    takeDamage(damage) {}
    useAbility(ability, target) {}
    _initCamera() {}
    _initCollision() {}
    _initMesh() {}
    _initTargetHighlight() {}
    _initInput() {}

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
        }
        if (this.camera) {
            this.camera.dispose();
        }
        // Dispose other resources
    }
}
