// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.22 (PATCHED)
// Fix: Corrected SyntaxError in _initCamera() method.
// Refactored to use a class-based stat system.
// ============================================================

class Player extends Character {
    constructor(scene) {
        // Character constructor needs to be called first
        super(scene, new BABYLON.Vector3(0, CONFIG.PLAYER.SPAWN_HEIGHT, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; // Store class name
        
        // Stats are now set by applyClass or loadState
        this.stats = {}; 
        this.health = 0;
        this.mana = 0; 
        this.stamina = 0;

        this.combat = {
            globalCooldown: 0,
            target: null,
            attackRange: CONFIG.COMBAT.BASE_ATTACK_RANGE // Assuming CONFIG.COMBAT exists
        };
        
        // Assuming Inventory/Equipment are correctly imported from item.js
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
            // Ability keys (e.g., 1-5 for action bar)
            ability1: false, ability2: false, ability3: false, 
            ability4: false, ability5: false,
            target: false
        };
        
        // We will now bind input methods to the instance for Babylon event listeners
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseClick = this.handleMouseClick.bind(this);
    }

    /**
     * Applies base stats and default abilities for the given class.
     * @param {string} className - The name of the class (e.g., 'Fighter').
     */
    applyClass(className) {
        // NOTE: CONFIG.CLASSES must be defined in core.js for this to work
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
        
        // Set current resources to max if they were zero (first load/creation)
        if (this.health === 0) this.health = this.stats.maxHealth;
        if (this.mana === 0) this.mana = this.stats.maxMana;
        if (this.stamina === 0) this.stamina = this.stats.maxStamina;
        
        console.log(`[Player] Class set: ${this.className}. Base Health: ${this.stats.maxHealth}`);
        
        // Load default abilities 
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
        
        // Note: applyClass is called by loadState in game.js after fetching data.
        
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

        // Current resources are loaded from the state, overriding the class defaults
        this.health = state.core.health;
        this.mana = state.core.mana;
        this.stamina = state.core.stamina;

        // Base stats from the DB override CONFIG defaults if they exist (for persistence)
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
        // Ensure you save the new base class stats for persistence!
        return {
            position: this.mesh ? this.mesh.position : this.position,
            rotation_y: this.visualRoot ? this.visualRoot.rotation.y : 0,
            
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            
            // Explicitly save the current base stats
            base_attack_power: this.stats.attackPower,
            base_magic_power: this.stats.magicPower,
            base_move_speed: this.stats.moveSpeed,
            
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
            // ... add more keys for other abilities
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
            // ... add more keys for other abilities
        }
    }

    handleMouseClick(evt, pickResult) {
        if (evt.button === 0) { // Left click
            if (pickResult.hit && pickResult.pickedMesh) {
                this.selectTarget(pickResult.pickedMesh);
            }
            if (this.combat.target && this.abilities.length > 0) {
                // Auto-cast the first ability on left click if a target is selected
                this.useAbility(this.abilities[0], this.combat.target);
            }
        }
    }

    // --- Core Gameplay Methods ---

    canJump() {
        // Simple check: In a real physics system, you'd check if the player is grounded.
        return this.position.y <= CONFIG.PLAYER.SPAWN_HEIGHT + 0.1; 
    }

    handleMovement(deltaTime) {
        const speed = this.stats.moveSpeed * (this.input.run ? this.stats.runMultiplier : 1);
        const camera = this.scene.activeCamera;
        
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
            // Apply movement to the physics body
            if (this.mesh.physicsImpostor) {
                let velocity = moveVector.scale(speed * CONFIG.PLAYER.IMPULSE_STRENGTH * 10 * deltaTime);
                let currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                
                // Keep vertical velocity (gravity/jump)
                velocity.y = currentVelocity.y;
                
                this.mesh.physicsImpostor.setLinearVelocity(velocity);
            }
        } else {
            // Apply damping when no input
            if (this.mesh.physicsImpostor) {
                let currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                currentVelocity.x *= (1 - CONFIG.PLAYER.LINEAR_DAMPING);
                currentVelocity.z *= (1 - CONFIG.PLAYER.LINEAR_DAMPING);
                this.mesh.physicsImpostor.setLinearVelocity(currentVelocity);
            }
        }

        if (this.input.jump) {
            if (this.canJump()) {
                if (this.mesh.physicsImpostor) {
                    this.mesh.physicsImpostor.applyImpulse(
                        new BABYLON.Vector3(0, CONFIG.PLAYER.JUMP_FORCE * CONFIG.PLAYER.IMPULSE_STRENGTH, 0),
                        this.mesh.getAbsolutePosition()
                    );
                }
            }
            this.input.jump = false; // Only jump once per key press
        }
    }

    handleRotation() {
        const camera = this.scene.activeCamera;
        if (!camera || !this.visualRoot) return;

        // Get the direction the camera is facing on the XZ plane
        const forwardVector = camera.getDirection(BABYLON.Vector3.Forward()).normalize();
        
        // Calculate the target rotation angle based on the forward vector
        const targetRotationY = Math.atan2(forwardVector.x, forwardVector.z);
        
        // Apply smooth rotation (using lerp/slerp approximation)
        let currentRotationY = this.visualRoot.rotation.y;
        let delta = targetRotationY - currentRotationY;

        // Handle wrap-around
        if (delta > Math.PI) delta -= 2 * Math.PI;
        if (delta < -Math.PI) delta += 2 * Math.PI;

        this.visualRoot.rotation.y = currentRotationY + delta * CONFIG.PLAYER.ROTATION_LERP;
    }

    selectTarget(mesh) {
        if (!mesh || !mesh.metadata) return;
        
        // Check if clicked mesh is targetable (assuming Enemy and NPC are targetable)
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
        if (this.combat.globalCooldown > 0) {
            this.scene.game.ui.showMessage('Ability on global cooldown.', 1000, 'error');
            return false;
        }

        if (ability.execute(this, target)) {
             // Successful cast, start GCD
            this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN / 1000;
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
        // TODO: Implement respawn logic
    }

    interact() {
        const MAX_INTERACT_DISTANCE = 3.0; // Max distance for interaction
        const mesh = this.mesh;
        
        // Simple raycast forward
        const ray = new BABYLON.Ray(mesh.position, mesh.forward, MAX_INTERACT_DISTANCE);
        const hit = this.scene.pickWithRay(ray, (m) => m !== mesh);
        
        if (hit.hit && hit.pickedMesh) {
            const pickedMesh = hit.pickedMesh;
            const metadata = pickedMesh.metadata;
            
            if (!metadata) return;

            if (metadata.isLootContainer) {
                this._openLootContainer(pickedMesh.metadata.entity);
            } else if (metadata.isNPC) {
                // Start dialogue
                this.scene.game.ui.showMessage(`Interacting with ${metadata.entity.name}`, 2000, 'info');
            }
        }
    }

    _openLootContainer(lootContainer) {
        if (!lootContainer.isOpened) {
            console.log(`Opened loot container: ${lootContainer.name}`);
            // Add items to inventory, then mark as opened
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
        
        // Auto Attack logic (simple: if target is in range and GCD is down, auto-attack)
        const target = this.combat.target;
        if (target && !target.isDead && BABYLON.Vector3.Distance(this.mesh.position, target.position) < this.combat.attackRange) {
            if (this.combat.globalCooldown <= 0) {
                 // Use the first ability (which should be the basic attack)
                this.useAbility(this.abilities[0], target);
            }
        }

        // Regen
        this.mana = Math.min(this.stats.maxMana, this.mana + this.stats.maxMana * CONFIG.PLAYER.MANA_REGEN_RATE * deltaTime);
        this.stamina = Math.min(this.stats.maxStamina, this.stamina + this.stats.maxStamina * CONFIG.PLAYER.STAMINA_REGEN_RATE * deltaTime);
    }
    
    // --- Babylon.js Specific Initializers ---
    _initCamera() {
         const camera = new BABYLON.UniversalCamera("playerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
         camera.setTarget(BABYLON.Vector3.Zero());
         // FIX: Corrected Syntax Error here. Attach control to the rendering canvas.
         camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true); 
         camera.rotation.x = 0.4;
         this.scene.activeCamera = camera;
    }

    _initCollision() {
        if (!this.mesh) return;
        this.mesh.checkCollisions = true;
        this.mesh.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5); 
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0); 
        
        if (typeof CANNON !== "undefined" && this.scene.getPhysicsEngine()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.SphereImpostor, 
                { 
                    mass: CONFIG.PLAYER.MASS, 
                    friction: CONFIG.PLAYER.FRICTION, 
                    restitution: 0.1 
                }, 
                this.scene
            );
            // Lock rotation
            this.mesh.physicsImpostor.setAngularFactor(0);
        }
    }
    
    async _initMesh() { 
        // Dummy implementation to ensure visualRoot and mesh are defined. 
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false;
        this.mesh.metadata = { isPlayer: true, entity: this };
        
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder visible mesh (Box for now)
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // offset to stand on the ground
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
            this.scene.game.ui.dispose(); // Also dispose UI when player is disposed
        }
    }
}
