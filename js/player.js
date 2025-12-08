// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.20 (PATCHED)
// Refactored to use a class-based stat system.
// ============================================================

class Player extends Character {
    constructor(scene) {
        super(scene, new BABYLON.Vector3(0, CONFIG.PLAYER.SPAWN_HEIGHT, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; // NEW: Store class name
        
        // Remove hardcoded stats; they will be set by applyClass or loadState
        this.stats = {}; 
        this.health = 0;
        this.mana = 0; 
        this.stamina = 0;
        // ... (rest of constructor remains the same) ...
    }
    
    // NEW: Function to apply class stats and defaults
    applyClass(className) {
        const classConfig = CONFIG.CLASSES[className] || CONFIG.CLASSES.Fighter; // Default to Fighter
        const stats = classConfig.stats;
        this.className = className;

        // Set the base stats for the player
        this.stats = {
            maxHealth: stats.maxHealth,
            maxMana: stats.maxMana, 
            maxStamina: stats.maxStamina,
            attackPower: stats.attackPower,
            magicPower: stats.magicPower,
            moveSpeed: stats.moveSpeed,
            runMultiplier: CONFIG.PLAYER.RUN_MULTIPLIER 
        };
        
        // Set current resources to max if they were zero (first load)
        if (this.health === 0) this.health = this.stats.maxHealth;
        if (this.mana === 0) this.mana = this.stats.maxMana;
        if (this.stamina === 0) this.stamina = this.stats.maxStamina;
        
        console.log(`[Player] Class set: ${this.className}. Base Health: ${this.stats.maxHealth}`);
        
        // Load default abilities (we need to clear abilities if this is a fresh load)
        this.abilities = []; 
        const defaultAbilityName = classConfig.defaultAbility; 
        const defaultAbilityTemplate = this.scene.game.skillTemplates.get(101); // Assuming 101 is a basic skill ID
        
        // If template exists, add it. Otherwise, add a generic basic attack.
        if (defaultAbilityTemplate) {
            this.abilities.push(new Ability(defaultAbilityTemplate));
        } else {
             // Fallback to a hardcoded basic attack
            this.abilities.push(new Ability({
                id: 0, code: 'BASIC_ATTACK', name: defaultAbilityName, skill_type: 'combat',
                cooldown_ms: 1000, resource_cost: { mana: 0, stamina: 0 },
                effect: { type: 'damage', base_value: 1, magic_scaling: 0.1, physical_scaling: 0.9 }
            }));
        }
    }
    
    // Update init to remove the old hardcoded ability loading
    async init() {
        // NOTE: The applyClass call is now in loadState, as we need the loaded character data first.
        // The applyClass call is also what now loads the default ability.
        
        await this._initMesh();
        console.log('[Player] Mesh and visual root created.');
        
        this._initCamera();
        console.log('[Player] Camera initialized.');
        
        this._initCollision();
        console.log('[Player] Collision and physics initialized.');
        
        this._initInput();
        console.log('[Player] Input bindings initialized.');
        
        this._initTargetHighlight();
        console.log('[Player] Target highlighting initialized.');

        // REMOVED: Old hardcoded ability loading is moved to applyClass
        
        console.log('[Player] Initialization complete.');
    }
    
    // Update loadState to call applyClass first
    loadState(state) {
        // Load class first to establish base stats and default abilities
        this.applyClass(state.core.class_name);
        
        this.position.set(state.core.position_x, state.core.position_y, state.core.position_z);
        
        if (this.visualRoot) {
            this.visualRoot.rotation.y = state.core.rotation_y;
        }

        // Current resources are loaded from the state, overriding the class defaults
        this.health = state.core.health;
        this.mana = state.core.mana;
        this.stamina = state.core.stamina;

        // Base stats from the DB override CONFIG if they exist (for stat changes mid-game)
        // We use the new base_ fields stored in the database
        this.stats.attackPower = state.core.base_attack_power || this.stats.attackPower;
        this.stats.magicPower = state.core.base_magic_power || this.stats.magicPower;
        
        this.inventory.load(state.inventory, this.scene.game.itemTemplates);
        this.equipment.load(state.equipment, this.scene.game.itemTemplates);
    }
    
    // ... (rest of player.js methods) ...
}
