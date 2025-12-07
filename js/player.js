// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.12 (PATCHED)
// Fix: Implemented basic takeDamage logic.
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

        this._initInput();
        this._initCamera();
        this._initTargetHighlight();
        this._initCollision();
        this._initMesh(); // This now calls an async implementation (see below)
    }

    // New load method to handle persistence
    async load(characterState, itemTemplates, skillTemplates) {
        if (characterState) {
            console.log("[Player] Loading state from persistence...");
            this.name = characterState.name || this.name;
            
            // Stats
            this.stats = characterState.stats || this.stats;
            this.health = characterState.health || this.stats.maxHealth;
            this.mana = characterState.mana || this.stats.maxMana;
            this.stamina = characterState.stamina || this.stats.maxStamina;

            // Position and Rotation
            this.position.x = characterState.position_x || 0;
            this.position.y = characterState.position_y || CONFIG.PLAYER.SPAWN_HEIGHT;
            this.position.z = characterState.position_z || 0;
            if (this.visualRoot) {
                this.visualRoot.rotation.y = characterState.rotation_y || 0;
            }

            // Inventory and Equipment
            this.inventory.load(characterState.items, itemTemplates);
            this.equipment.load(characterState.equipment, itemTemplates);
            
            // Abilities (TODO: Add skill loading logic here)

        } else {
            console.log("[Player] No save data found. Initializing new character.");
            // On new character, ensure the character is created in the database
            // NOTE: The game.js init currently relies on a hardcoded ID, so we skip DB insertion here
            // but the player starts with base stats.
        }
        
        // Finalize player setup after loading
        await this._initMesh(); // Load the 3D model after basic setup
    }

    // === PATCH: Implemented core damage logic ===
    takeDamage(damage, source) {
        if (this.health <= 0) return;
        
        const finalDamage = Math.max(0, damage); 
        this.health -= finalDamage;

        if (this.scene.game.ui && this.mesh) {
            this.scene.game.ui.createFloatingText(
                this.mesh, 
                finalDamage.toFixed(0), 
                'playerDamage'
            );
        }

        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.scene.game.ui.showMessage("You have fallen!", 5000, 'error');
            // TODO: Implement death and respawn logic
        }
    }
    // ===============================================

    // Placeholder methods for completeness
    handleMovement(deltaTime) {}
    handleRotation() {}
    setTarget(mesh) {}
    useAbility(ability, target) {}
    _initCamera() {}
    _initCollision() {}
    _initInput() {}
    _initTargetHighlight() {}
    
    async _initMesh() { 
        // Dummy implementation to ensure visualRoot and mesh are defined. 
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.isVisible = false;
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder visible mesh (Box for now)
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // offset to stand on the ground
    }

    // ... (rest of methods)
    // ...
    getSaveData() {
        return {
            name: this.name,
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

    update(deltaTime) {
        super.update(deltaTime); 
        
        // ... (update logic) ...
    }

    dispose() {
        // ... (dispose logic) ...
    }
}

window.Player = Player;
