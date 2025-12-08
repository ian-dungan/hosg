// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.26 (FIXED)
// Fix: Removed direct assignment to UI in constructor to prevent 'Cannot set properties of null' crash.
// ============================================================

class Player extends Character {
    constructor(scene) {
        // Safe access to CONFIG properties using logical OR for fallbacks.
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const playerConfig = C.PLAYER || {};
        const combatConfig = C.COMBAT || {};
        
        // 1. Character constructor
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5; 
        
        super(scene, new BABYLON.Vector3(0, spawnHeight, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; 
        
        // 2. Safely initialize stats object using fallbacks
        this.stats = {
            maxHealth: playerConfig.HEALTH || 100,
            maxMana: playerConfig.MANA || 50, 
            maxStamina: playerConfig.STAMINA || 100,
            
            attackPower: 10,
            magicPower: 5,
            
            moveSpeed: playerConfig.MOVE_SPEED || 0.15, 

            // Combat stats
            attackRange: combatConfig.RANGE_MELEE || 2,
            attackCooldown: combatConfig.ATTACK_COOLDOWN_MELEE || 1,
            
            // Stats that will be updated by class selection
            currentAttackPower: 10,
            currentMagicPower: 5,
            currentMoveSpeed: 0.15,
        };
        
        // Current resources
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;
        
        this.isMoving = false;
        this.isSprinting = false;
        this.keys = {}; // Current state of pressed keys
        
        // Initialize Inventory and Equipment
        this.inventory = new Inventory(this);
        this.equipment = new Equipment();
        
        this.combat = {
            target: null,
            lastAttackTime: 0,
            abilities: new Map(), // Map<AbilityName, Ability Instance>
            actionSlots: new Array(5).fill(null) // Holds ability objects
        };
        
        // REMOVED: this.scene.game.ui.player = this; // THIS LINE WAS CAUSING THE CRASH
        
        // Bind event handlers
        this.handleKeyDown = this._handleKeyDown.bind(this);
        this.handleKeyUp = this._handleKeyUp.bind(this);
        this.handlePointerDown = this._handlePointerDown.bind(this);
    }
    
    // --- Public Initialization ---
    // The main init function called from Game.js after scene setup
    async init() {
        await this._initMesh();
        
        // Use a high mass and friction for a character controller
        this._initCollision(100, 0.5); 
        this._initCamera();
        this._initInput();
        this._initTargetHighlight();
        
        console.log('[Player] Mesh and visual root created.');
        console.log('[Player] Camera initialized.');
    }

    // --- Core Updates ---
    update(deltaTime) {
        if (this.isDead) return;
        
        this._handleMovement(deltaTime);
        this._handleCamera(deltaTime);
        this._handleStamina(deltaTime);
        
        // Update ability cooldowns
        this.combat.abilities.forEach(ability => ability.update(deltaTime));

        // Always call the Character base update
        super.update(deltaTime);
    }
    
    // --- Resource/Combat Management ---
    takeDamage(damage, source) {
        damage = Math.max(0, damage);
        this.health -= damage;
        
        // Visual/audio feedback
        this.scene.game.ui.showMessage(`You took ${damage.toFixed(0)} damage from ${source.name}!`, 1500, 'playerDamage');
        
        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        this.scene.game.ui.showMessage("You have died.", 5000, 'critical');
        console.log('Player died.');
        // TODO: Respawn logic
    }
    
    // --- Movement Helpers ---
    _handleMovement(deltaTime) {
        const speed = this.stats.currentMoveSpeed * (this.isSprinting ? 1.5 : 1.0);
        let moveVector = new BABYLON.Vector3(0, 0, 0);
        
        const forward = this.visualRoot.forward;
        const right = this.visualRoot.right;

        // Apply movement forces relative to the camera/visual direction
        if (this.keys['w']) moveVector.addInPlace(forward);
        if (this.keys['s']) moveVector.subtractInPlace(forward);
        if (this.keys['a']) moveVector.subtractInPlace(right);
        if (this.keys['d']) moveVector.addInPlace(right);

        if (moveVector.length() > 0) {
            moveVector = moveVector.normalize().scale(speed * deltaTime * 60); // Scale by 60 for consistency
            
            // Check for jump
            if (this.keys[' ']) {
                // Check if on ground (simplified)
                if (this.mesh.position.y < CONFIG.PLAYER.SPAWN_HEIGHT + 0.1) {
                    this.mesh.physicsImpostor.setLinearVelocity(
                        this.mesh.physicsImpostor.getLinearVelocity().add(new BABYLON.Vector3(0, 5, 0))
                    );
                    this.keys[' '] = false; // Consume the jump key press
                }
            }

            // Apply force
            if (this.mesh.physicsImpostor) {
                const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                const newVelocity = new BABYLON.Vector3(moveVector.x, 0, moveVector.z);
                
                // Keep existing vertical velocity (gravity/jump)
                newVelocity.y = currentVelocity.y; 

                // Use the simplified linear velocity calculation for character movement
                this.mesh.physicsImpostor.setLinearVelocity(
                    newVelocity
                );
            }
            
            this.isMoving = true;
        } else {
            this.isMoving = false;
            // Stop horizontal movement when keys are released
            if (this.mesh.physicsImpostor) {
                const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, currentVelocity.y, 0));
            }
        }
    }
    
    _handleStamina(deltaTime) {
        if (this.isSprinting && this.isMoving) {
            this.stamina -= deltaTime * 10; // Stamina drain
            this.stamina = Math.max(0, this.stamina);
            if (this.stamina === 0) {
                this.isSprinting = false; // Stop sprinting
            }
        } else if (this.stamina < this.stats.maxStamina) {
            this.stamina += deltaTime * 5; // Stamina regen
            this.stamina = Math.min(this.stats.maxStamina, this.stamina);
        }
    }

    // --- Input Handling ---
    _handleKeyDown(event) {
        const key = event.key.toLowerCase();
        this.keys[key] = true;
        
        // Handle sprint toggle
        if (key === 'shift' && this.stamina > 0) {
            this.isSprinting = true;
        }
        
        // Handle action bar keys (1, 2, 3, 4, 5)
        if (key >= '1' && key <= '5') {
            const slotIndex = parseInt(key) - 1;
            this.useAbilitySlot(slotIndex);
        }
        
        // Handle inventory toggle
        if (key === 'i') {
            this.scene.game.ui.toggleInventory();
        }
        
        // Handle target select (T for nearest)
        if (key === 't') {
            this._selectNearestTarget();
        }
    }

    _handleKeyUp(event) {
        const key = event.key.toLowerCase();
        this.keys[key] = false;
        
        // Handle sprint release
        if (key === 'shift') {
            this.isSprinting = false;
        }
    }
    
    _handlePointerDown(event, pickResult) {
        // Right-click: Clear target
        if (event.button === 2) { 
            this.setTarget(null);
            return;
        }

        // Left-click: Attack or Select Target
        if (event.button === 0 && pickResult.hit) { 
            if (pickResult.pickedMesh.metadata && pickResult.pickedMesh.metadata.entity && pickResult.pickedMesh.metadata.entity.isAttackable) {
                // Clicked an enemy
                const newTarget = pickResult.pickedMesh.metadata.entity;
                this.setTarget(newTarget);
                // Attempt to auto-attack immediately
                this.useAbilitySlot(0); 
            } else {
                // Clicked on ground/world, clear target
                this.setTarget(null);
            }
        }
    }
    
    _selectNearestTarget() {
        const world = this.scene.game.world;
        if (!world || !world.npcs || world.npcs.length === 0) return;
        
        let nearestNpc = null;
        let minDistanceSq = Infinity;
        
        for (const npc of world.npcs) {
            if (npc.isDead) continue;
            
            const distanceSq = BABYLON.Vector3.DistanceSquared(this.position, npc.position);
            
            if (distanceSq < minDistanceSq) {
                minDistanceSq = distanceSq;
                nearestNpc = npc;
            }
        }
        
        if (nearestNpc) {
            this.setTarget(nearestNpc);
        }
    }
    
    // --- Combat / Ability ---
    setTarget(target) {
        if (this.combat.target === target) return;
        
        if (this.combat.target) {
            this.combat.target._toggleHighlight(false);
        }
        
        this.combat.target = target;
        
        if (target) {
            target._toggleHighlight(true);
            this.scene.game.ui.updateTargetInfo(target);
        } else {
            this.scene.game.ui.updateTargetInfo(null);
        }
    }
    
    getAbility(name) {
        return this.combat.abilities.get(name);
    }
    
    loadAbility(abilityTemplate) {
        if (!abilityTemplate) return;
        const ability = new Ability(abilityTemplate);
        this.combat.abilities.set(ability.name, ability);
        return ability;
    }
    
    setAbilitySlot(slotIndex, abilityName) {
        const ability = this.combat.abilities.get(abilityName);
        if (ability && slotIndex >= 0 && slotIndex < this.combat.actionSlots.length) {
            this.combat.actionSlots[slotIndex] = ability;
            this.scene.game.ui.updateActionBar();
        }
    }
    
    useAbilitySlot(slotIndex) {
        const ability = this.combat.actionSlots[slotIndex];
        if (!ability || !ability.isReady()) return;
        
        // If ability requires a target, and we have one, use it.
        // Or if it's a self-cast/AoE, use it with 'this' as target/caster.
        const target = this.combat.target;
        
        if (ability.execute(this, target)) {
            // Ability was successfully used (cost paid, cooldown started)
        }
    }
    
    // --- Save/Load Data ---
    getSaveData() {
        return {
            class_name: this.className,
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            position: {
                x: this.mesh.position.x,
                y: this.mesh.position.y,
                z: this.mesh.position.z,
            },
            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData(),
            action_slots: this.combat.actionSlots.map(a => a ? a.name : null)
        };
    }
    
    async loadSaveData(data, templates) {
        this.className = data.class_name;
        this.health = data.health;
        this.mana = data.mana;
        this.stamina = data.stamina;

        // Apply position
        if (data.position && this.mesh) {
            this.mesh.position.set(data.position.x, data.position.y, data.position.z);
        }
        
        // Load Inventory and Equipment
        this.inventory.load(data.inventory, templates.itemTemplates);
        this.equipment.load(data.equipment, templates.itemTemplates);
        
        // Load Abilities
        this.combat.abilities.clear();
        for (const [name, template] of templates.skillTemplates.entries()) {
            this.loadAbility(template);
        }

        // Load Action Bar Slots
        if (data.action_slots) {
             data.action_slots.forEach((abilityName, index) => {
                if (abilityName) {
                    this.setAbilitySlot(index, abilityName);
                }
            });
        }
        
        // Apply class stats
        this.selectClass(this.className);
    }
    
    selectClass(className) {
        const classData = CONFIG.CLASSES[className];
        if (!classData) {
            console.error(`[Player] Cannot select class: ${className} not found in CONFIG.CLASSES.`);
            return;
        }
        
        this.className = className;
        
        // 1. Update Stats based on class (base stats)
        this.stats.maxHealth = classData.stats.maxHealth;
        this.stats.maxMana = classData.stats.maxMana;
        this.stats.maxStamina = classData.stats.maxStamina;
        this.stats.attackPower = classData.stats.attackPower;
        this.stats.magicPower = classData.stats.magicPower;
        this.stats.moveSpeed = classData.stats.moveSpeed;
        
        // Reset current resources to max (or maintain current ratio if needed)
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;
        
        // Recalculate derived stats (current stats including equipment)
        this.updateStatsFromEquipment(); 

        // 2. Load Default Ability into Slot 1
        if (classData.defaultAbility) {
            this.setAbilitySlot(0, classData.defaultAbility);
        }
        
        // 3. Update Visuals (Placeholder)
        // this._loadVisuals(classData.model); 
        
        console.log(`[Player] Class selected: ${this.className}`);
    }
    
    updateStatsFromEquipment() {
        // Start with base class stats
        let ap = this.stats.attackPower;
        let mp = this.stats.magicPower;
        let speed = this.stats.moveSpeed;
        
        // Apply equipment bonuses
        Object.values(this.equipment.slots).forEach(item => {
            if (item && item.stats) {
                ap += item.stats.attackPower || 0;
                mp += item.stats.magicPower || 0;
                speed += item.stats.moveSpeed || 0;
            }
        });
        
        // Set derived current stats
        this.stats.currentAttackPower = ap;
        this.stats.currentMagicPower = mp;
        this.stats.currentMoveSpeed = speed;
    }
    
    // --- Private Initialization Methods ---
    
    _initInput() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = this.handlePointerDown;
        this.scene.onPointerUp = (evt) => {
            // Placeholder for future pointer up logic
        };
        
        // Disable default browser context menu on right-click
        this.scene.getEngine().get

    }

    _initCamera() {
        // Use a standard FollowCamera
        this.camera = new BABYLON.FollowCamera("PlayerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        this.camera.radius = 15; // Distance from the target
        this.camera.heightOffset = 4; // Height above the target
        this.camera.rotationOffset = 180; // Angle around the target
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxSpeed = 10;
        this.camera.attachControl(this.scene.getEngine().get
            // Placeholder for future camera control logic
        );
    }

    _initCollision(mass, friction) { 
        if (this.scene.isPhysicsEnabled && typeof BABYLON.PhysicsImpostor !== "undefined") {
            // Create the impostor
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.SphereImpostor, // Sphere Impostor for rolling/smooth motion
                { 
                    mass: mass, 
                    friction: friction, 
                    restitution: 0.1 
                }, 
                this.scene
            );
            
            // FIX: Safely call setAngularFactor to prevent rotation/tumbling
            if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
                this.mesh.physicsImpostor.setAngularFactor(0); // Prevents rotation/tumbling on collision
            } else {
                console.warn("[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.");
            }

        }
    }
    
    async _initMesh() { 
        // Create a hidden mesh for physics collision
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false;
        this.mesh.metadata = { isPlayer: true, entity: this };
        
        // Create a separate node for the visual model
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder cube for visual representation
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // Center the model visually
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
        
        // Dispose camera control
        if(this.camera) this.camera.detachControl(this.scene.getEngine().get)
    }

    _handleCamera(deltaTime) {
        // Camera rotation to match player visual direction
        if(this.visualRoot) {
            // Simple rotation logic to face movement direction
            if(this.isMoving) {
                // Calculate target rotation from velocity
                const velocity = this.mesh.physicsImpostor.getLinearVelocity();
                const targetRotation = Math.atan2(velocity.x, velocity.z);
                
                // Smoothly interpolate current rotation to target rotation
                const currentRotation = this.visualRoot.rotation.y;
                let delta = targetRotation - currentRotation;
                while (delta > Math.PI) delta -= 2 * Math.PI;
                while (delta < -Math.PI) delta += 2 * Math.PI;

                this.visualRoot.rotation.y += delta * 0.1; // 0.1 is the smoothing factor
            }
        }
    }
}
// Ensure the Player class is globally accessible if not using modules
window.Player = Player;
