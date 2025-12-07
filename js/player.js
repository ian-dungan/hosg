// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.11 (PATCHED)
// Fix: Moved mesh/visual initialization to an awaitable method.
// ============================================================

class Player extends Character {
    constructor(scene) {
        // Character constructor needs to be called first
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
        
        // Removed: this._initCamera(), this._initCollision(), this._initMesh(), etc.
        // These will now be called by setupVisuals()
        this._initInput(); // Input can be initialized immediately
    }
    
    /**
     * Called from Game.init(). Loads all visual elements (Mesh, Camera, etc.)
     * This must be awaited before setting mesh position/rotation.
     */
    async setupVisuals() {
        // Assuming these methods load assets or create Babylon objects
        await this._initMesh(); 
        this._initCamera();
        this._initCollision();
        this._initTargetHighlight();
        console.log("[Player] Visuals and camera initialized.");
    }
    
    /**
     * Loads character state from the database. Called from Game.init().
     * (Corresponds to line 91 in the trace)
     * @param {Object} data - The complete character data object from NetworkManager.loadCharacter
     * @param {Map} itemTemplates - Map of item templates
     * @param {Map} skillTemplates - Map of skill templates
     */
    init(data, itemTemplates, skillTemplates) {
        // **this.mesh and this.visualRoot are now guaranteed to be defined**
        // because Game.init() will await setupVisuals() before calling this.

        // Load position/rotation
        if (this.mesh && this.mesh.position) {
            this.mesh.position.x = data.character.position_x;
            this.mesh.position.y = data.character.position_y;
            this.mesh.position.z = data.character.position_z;
        }

        if (this.visualRoot && this.visualRoot.rotation) {
            this.visualRoot.rotation.y = data.character.rotation_y; 
        }

        // Load resources
        this.health = data.character.health;
        this.mana = data.character.mana;
        this.stamina = data.character.stamina;

        // Load Inventory & Equipment
        this.inventory.load(data.inventory_items, itemTemplates);
        this.equipment.load(data.equipped_items, itemTemplates);
        
        // Load Abilities
        this.loadAbilities(data.player_skills, skillTemplates);
        
        console.log(`[Player] Loaded position (${this.mesh.position.x.toFixed(2)}, ${this.mesh.position.y.toFixed(2)}, ${this.mesh.position.z.toFixed(2)}) and state.`);
    }

    /**
     * Creates Ability objects from character skill records and template data.
     */
    loadAbilities(skillRecords, skillTemplates) {
        if (!skillRecords) return;
        
        this.abilities = skillRecords.map(record => {
            const template = skillTemplates.get(record.skill_id);

            if (!template) {
                console.warn(`[Player] Missing skill template for ID ${record.skill_id}. Skipping ability.`);
                return null; 
            }

            return new Ability(template); 
        }).filter(a => a !== null); 
        
        console.log(`[Player] Loaded ${this.abilities.length} abilities.`);
    }
    
    
    // ==================================================
    // Existing Methods 
    // ==================================================

    getSaveData() {
        return {
            position: this.mesh.position, 
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
    
    // Placeholder methods (now must be implemented to set this.mesh and this.visualRoot)
    handleMovement(deltaTime) {}
    handleRotation() {}
    setTarget(mesh) {}
    takeDamage(damage) {}
    useAbility(ability, target) {}
    _initCamera() {}
    _initCollision() {}
    async _initMesh() { 
        // Dummy implementation to ensure visualRoot and mesh are defined. 
        // A real implementation would load a model like 'knight03.glb' here.
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.isVisible = false;
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder visible mesh (Box for now)
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // offset to stand on the ground
    }
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
