// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.23 (PATCHED)
// Fix: Cleaned up constructor for robust CONFIG access.
// ============================================================

class Player extends Character {
    constructor(scene) {
        // Safe access to CONFIG properties using logical OR for fallbacks.
        // It is critical that CONFIG is defined in core.js before this script loads.
        // If CONFIG is not defined, it defaults to an empty object {} to avoid a crash.
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const playerConfig = C.PLAYER || {};
        const combatConfig = C.COMBAT || {};
        
        // 1. Character constructor (Line 15 Fix)
        // Defaults to 5 if CONFIG.PLAYER.SPAWN_HEIGHT is not available.
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5; 
        
        super(scene, new BABYLON.Vector3(0, spawnHeight, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; 
        
        // 2. Safely initialize stats object using fallbacks
        this.stats = {
            // Defaults to 100, 50, 100 if CONFIG is missing
            maxHealth: playerConfig.HEALTH || 100,
            maxMana: playerConfig.MANA || 50, 
            maxStamina: playerConfig.STAMINA || 100,
            
            attackPower: 10,
            magicPower: 5,
            
            // Defaults to 0.15 and 1.8 if CONFIG is missing
            moveSpeed: playerConfig.MOVE_SPEED || 0.15,
            runMultiplier: playerConfig.RUN_MULTIPLIER || 1.8 
        };
        
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;

        this.combat = {
            globalCooldown: 0,
            target: null,
            // Defaults to 3.0 if CONFIG.COMBAT is missing
            attackRange: combatConfig.BASE_ATTACK_RANGE || 3.0 
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
            isUIOpen: false,
            ability1: false, ability2: false, ability3: false, 
            ability4: false, ability5: false,
            target: false
        };
        
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseClick = this.handleMouseClick.bind(this);
    }

    /**
     * Applies base stats and default abilities for the given class.
     * @param {string} className - The name of the class (e.g., 'Fighter').
     */
    applyClass(className) {
        // This method assumes CONFIG is loaded, as it's called after template loading in loadGameData
        const C = CONFIG || {};
        const classConfig = C.CLASSES ? (C.CLASSES[className] || C.CLASSES.Fighter) : null; 
        
        // Use fallbacks if CONFIG.CLASSES is still missing
        if (!classConfig) {
             console.error("[Player] CONFIG.CLASSES not found. Cannot apply class.");
             this.className = className;
             return; 
        }

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
            runMultiplier: C.PLAYER.RUN_MULTIPLIER // This is safe since this.stats already has fallbacks
        };
        
        if (this.health === 0) this.health = this.stats.maxHealth;
        if (this.mana === 0) this.mana = this.stats.maxMana;
        if (this.stamina === 0) this.stamina = this.stats.maxStamina;
        
        console.log(`[Player] Class set: ${this.className}. Base Health: ${this.stats.maxHealth}`);
        
        // Load default abilities 
        this.abilities = []; 
        const defaultAbilityName = classConfig.defaultAbility; 
        const defaultAbilityTemplate = this.scene.game.skillTemplates.get(101); 
        
        if (defaultAbilityTemplate) {
            this.abilities.push(new Ability(defaultAbilityTemplate));
        } else {
             // Fallback to a hardcoded basic attack
            this.abilities.push(new Ability({
                id: 0, code: 'BASIC_ATTACK', name: defaultAbilityName || 'Basic Attack', skill_type: 'combat',
                cooldown_ms: 1000, resource_cost: { mana: 0, stamina: 0 },
                effect: { type: 'damage', base_value: 1, magic_scaling: 0.1, physical_scaling: 0.9 }
            }));
        }
    }

    async init() {
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
        
        console.log('[Player] Initialization complete.');
    }
    
    /**
     * Loads the character's state from the database record.
     * @param {Object} state - The object containing core, inventory, and equipment data.
     */
    loadState(state) {
        // Load class first to establish base stats and default abilities
        this.applyClass(state.core.class_name);
        
        this.position.set(state.core.position_x, state.core.position_y, state.core.position_z);
        
        if (this.visualRoot) {
            this.visualRoot.rotation.y = state.core.rotation_y;
        }

        this.health = state.core.health;
        this.mana = state.core.mana;
        this.stamina = state.core.stamina;

        this.stats.attackPower = state.core.base_attack_power || this.stats.attackPower;
        this.stats.magicPower = state.core.base_magic_power || this.stats.magicPower;
        this.stats.moveSpeed = state.core.base_move_speed || this.stats.moveSpeed;
        
        this.inventory.load(state.inventory, this.scene.game.itemTemplates);
        this.equipment.load(state.equipment, this.scene.game.itemTemplates);
    }
    
    /**
     * Gathers all relevant player data for persistence/saving.
     * @returns {Object} The save data object.
     */
    getSaveData() {
        return {
            core: {
                position_x: this.mesh ? this.mesh.position.x : this.position.x,
                position_y: this.mesh ? this.mesh.position.y : this.position.y,
                position_z: this.mesh ? this.mesh.position.z : this.position.z,
                rotation_y: this.visualRoot ? this.visualRoot.rotation.y : 0,
                
                health: this.health,
                mana: this.mana,
                stamina: this.stamina,
                class_name: this.className,
                
                base_attack_power: this.stats.attackPower,
                base_magic_power: this.stats.magicPower,
                base_move_speed: this.stats.moveSpeed,
            },
            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData() 
        };
    }
    
    // --- Input Handling Methods ---
    _initInput() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = this.handleMouseClick;
    }

    handleKeyDown(event) {
        if (this.input.isUIOpen) return;
        switch (event.key.toLowerCase()) {
            case 'w': this.input.forward = true; break;
            case 's': this.input.backward = true; break;
            case 'a': this.input.left = true; break;
            case 'd': this.input.right = true; break;
            case ' ': if (this.canJump()) this.input.jump = true; break;
            case 'shift': this.input.run = true; break;
            case 'f': this.interact(); break; // Interact key
            case 'i': this.scene.game.ui.toggleInventory(); break;
            case '1': this.input.ability1 = true; break;
        }
    }

    handleKeyUp(event) {
        switch (event.key.toLowerCase()) {
            case 'w': this.input.forward = false; break;
            case 's': this.input.backward = false; break;
            case 'a': this.input.left = false; break;
            case 'd': this.input.right = false; break;
            case ' ': this.input.jump = false; break;
            case 'shift': this.input.run = false; break;
            case '1': this.input.ability1 = false; break;
        }
    }

    handleMouseClick(evt, pickResult) {
        if (evt.button === 0) { // Left click
            if (pickResult.hit && pickResult.pickedMesh) {
                this.selectTarget(pickResult.pickedMesh);
            }
            if (this.combat.target && this.abilities.length > 0) {
                this.useAbility(this.abilities[0], this.combat.target);
            }
        }
    }

    // --- Core Gameplay Methods ---

    canJump() {
        // Use safe access with fallback
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const spawnHeight = (C.PLAYER && C.PLAYER.SPAWN_HEIGHT) || 5;
        return this.position.y <= spawnHeight + 0.1; 
    }

    handleMovement(deltaTime) {
        const speed = this.stats.moveSpeed * (this.input.run ? this.stats.runMultiplier : 1);
        const camera = this.scene.activeCamera;
        
        // Define local CONFIG for movement constants with sensible fallbacks
        const C = typeof CONFIG === 'undefined' ? { PLAYER: {} } : CONFIG;
        const playerConfig = C.PLAYER || {};
        const impulseStrength = playerConfig.IMPULSE_STRENGTH || 150;
        const linearDamping = playerConfig.LINEAR_DAMPING || 0.3;
        const jumpForce = playerConfig.JUMP_FORCE || 0.22;
        
        let moveVector = BABYLON.Vector3.Zero();

        if (this.input.forward) {
            moveVector.addInPlace(camera.getDirection(BABYLON.Vector3.Forward()));
        }
        if (this.input.backward) {
            moveVector.addInPlace(camera.getDirection(BABYLON.Vector3.Backward()));
        }
        if (this.input.left) {
            moveVector.addInPlace(camera.getDirection(BABYLON.Vector3.Left()));
        }
        if (this.input.right) {
            moveVector.addInPlace(camera.getDirection(BABYLON.Vector3.Right()));
        }
        
        if (moveVector.lengthSquared() > 0) {
            moveVector.normalize();
            if (this.mesh.physicsImpostor) {
                let velocity = moveVector.scale(speed * impulseStrength * 10 * deltaTime);
                let currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                
                velocity.y = currentVelocity.y;
                
                this.mesh.physicsImpostor.setLinearVelocity(velocity);
            }
        } else {
            if (this.mesh.physicsImpostor) {
                let currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                currentVelocity.x *= (1 - linearDamping);
                currentVelocity.z *= (1 - linearDamping);
                this.mesh.physicsImpostor.setLinearVelocity(currentVelocity);
            }
        }

        if (this.input.jump) {
            if (this.canJump()) {
                if (this.mesh.physicsImpostor) {
                    this.mesh.physicsImpostor.applyImpulse(
                        new BABYLON.Vector3(0, jumpForce * impulseStrength, 0),
                        this.mesh.getAbsolutePosition()
                    );
                }
            }
            this.input.jump = false; 
        }
    }

    handleRotation() {
        const camera = this.scene.activeCamera;
        if (!camera || !this.visualRoot) return;
        
        const C = typeof CONFIG === 'undefined' ? { PLAYER: {} } : CONFIG;
        const rotationLerp = (C.PLAYER && C.PLAYER.ROTATION_LERP) || 0.2;

        const forwardVector = camera.getDirection(BABYLON.Vector3.Forward()).normalize();
        
        const targetRotationY = Math.atan2(forwardVector.x, forwardVector.z);
        
        let currentRotationY = this.visualRoot.rotation.y;
        let delta = targetRotationY - currentRotationY;

        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;

        this.visualRoot.rotation.y = currentRotationY + delta * rotationLerp;
    }

    selectTarget(mesh) {
        if (!mesh || !mesh.metadata) return;
        
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            const target = this.scene.game.world.npcs.find(npc => npc.mesh === mesh);
            if (target) {
                this.combat.target = target;
                console.log(`Target set to: ${target.name}`);
                this.scene.game.ui.setTarget(target);
            }
        }
    }

    useAbility(ability, target) {
        const C = typeof CONFIG === 'undefined' ? { COMBAT: {} } : CONFIG;
        const globalCooldown = (C.COMBAT && C.COMBAT.GLOBAL_COOLDOWN) || 1000;
        
        if (this.combat.globalCooldown > 0) {
            this.scene.game.ui.showMessage('Ability on global cooldown.', 1000, 'error');
            return false;
        }

        if (ability.execute(this, target)) {
            this.combat.globalCooldown = globalCooldown / 1000;
            return true;
        }
        return false;
    }

    takeDamage(damage, source) {
        this.health -= damage;
        this.health = Math.max(0, this.health);
        
        this.scene.game.ui.showMessage(`You took ${damage.toFixed(0)} damage from ${source.name}!`, 1500, 'playerDamage');

        if (this.health === 0) {
            this.die();
        }
    }

    die() {
        console.log("Player has died.");
        this.isDead = true;
        this.scene.game.ui.showMessage("YOU DIED. Game Over.", 5000, 'critical');
    }

    interact() {
        const MAX_INTERACT_DISTANCE = 3.0; 
        const mesh = this.mesh;
        
        const ray = new BABYLON.Ray(mesh.position, mesh.forward, MAX_INTERACT_DISTANCE);
        const hit = this.scene.pickWithRay(ray, (m) => m !== mesh);
        
        if (hit.hit && hit.pickedMesh) {
            const pickedMesh = hit.pickedMesh;
            const metadata = pickedMesh.metadata;
            
            if (!metadata) return;

            if (metadata.isLootContainer) {
                this._openLootContainer(pickedMesh.metadata.entity);
            } else if (metadata.isNPC) {
                this.scene.game.ui.showMessage(`Interacting with ${metadata.entity.name}`, 2000, 'info');
            }
        }
    }

    _openLootContainer(lootContainer) {
        if (!lootContainer.isOpened) {
            console.log(`Opened loot container: ${lootContainer.name}`);
            lootContainer.loot.forEach(item => {
                this.inventory.addItem(item.templateId, item.quantity);
            });
            lootContainer.isOpened = true;
            if (lootContainer.mesh) lootContainer.mesh.material.diffuseColor = BABYLON.Color3.Gray(); 
        }
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
        
        const target = this.combat.target;
        if (target && !target.isDead && BABYLON.Vector3.Distance(this.mesh.position, target.position) < this.combat.attackRange) {
            if (this.combat.globalCooldown <= 0) {
                this.useAbility(this.abilities[0], target);
            }
        }

        const C = typeof CONFIG === 'undefined' ? { PLAYER: {} } : CONFIG;
        const manaRegenRate = (C.PLAYER && C.PLAYER.MANA_REGEN_RATE) || 0.005;
        const staminaRegenRate = (C.PLAYER && C.PLAYER.STAMINA_REGEN_RATE) || 0.01;
        
        // Regen
        this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.maxMana * manaRegenRate * deltaTime);
        this.stamina = Math.min(this.stats.maxStamina, this.stamina + this.stats.maxStamina * staminaRegenRate * deltaTime);
    }
    
    // --- Babylon.js Specific Initializers ---
    _initCamera() {
         const camera = new BABYLON.UniversalCamera("playerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
         camera.setTarget(BABYLON.Vector3.Zero());
         camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true); 
         camera.rotation.x = 0.4;
         this.scene.activeCamera = camera;
    }

    _initCollision() {
        if (!this.mesh) return;
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5); 
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0); 
        
        const C = typeof CONFIG === 'undefined' ? { PLAYER: {} } : CONFIG;
        const mass = (C.PLAYER && C.PLAYER.MASS) || 15;
        const friction = (C.PLAYER && C.PLAYER.FRICTION) || 0.2;
        
        if (typeof CANNON !== "undefined" && this.scene.getPhysicsEngine()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.SphereImpostor, 
                { 
                    mass: mass, 
                    friction: friction, 
                    restitution: 0.1 
                }, 
                this.scene
            );
            this.mesh.physicsImpostor.setAngularFactor(0);
        }
    }
    
    async _initMesh() { 
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false;
        this.mesh.metadata = { isPlayer: true, entity: this };
        
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; 
    }
    
    _initTargetHighlight() {
        // Placeholder for future target highlight effect
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = null;
        if (this.scene.game.ui) {
            this.scene.game.ui.dispose();
        }
    }
}
