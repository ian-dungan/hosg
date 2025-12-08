// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.28 (FIXED)
// Fix: Corrected SyntaxError in _initCamera's attachControl call (missing parenthesis/malformed arguments).
// Fix: Added physics impostor setAngularFactor(0, 0, 0) to prevent unintended character rotation.
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
    
    // --- Private Initialization Methods ---
    
    _initMesh() {
        // Create an invisible sphere as the main physics body
        this.mesh = BABYLON.MeshBuilder.CreateSphere("playerMesh", { diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false;
        this.mesh.metadata = { isPlayer: true, entity: this };

        // Create a separate node for the visual model
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;

        // Placeholder cube (replace with loaded model)
        const placeholder = BABYLON.MeshBuilder.CreateBox("playerVisual", { size: 0.8 }, this.scene);
        placeholder.parent = this.visualRoot;
        placeholder.position.y = 0.4; // Center it on the physics sphere
        
        return Promise.resolve();
    }
    
    _initCollision(mass, friction) {
        if (!this.mesh) {
            console.error('[Player] Cannot initialize collision: mesh is null.');
            return;
        }

        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.SphereImpostor, 
            { mass: mass, friction: friction, restitution: 0.1 },
            this.scene
        );
        
        // Fix for unintended character rotation
        if (this.mesh.physicsImpostor.setAngularFactor) {
            this.mesh.physicsImpostor.setAngularFactor(new BABYLON.Vector3(0, 0, 0));
            console.log('[Player] Physics impostor ready. Angular factor set to (0, 0, 0).');
        } else {
            console.warn('[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.');
        }
    }
    
    _initCamera() {
        // Third-person camera setup (ArcRotate or Follow Camera)
        this.camera = new BABYLON.ArcRotateCamera("playerCamera", 
            -Math.PI / 2, Math.PI / 4, 15, 
            this.mesh.position, this.scene);

        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 20;
        
        // PATCH: Corrected the SyntaxError on the attachControl call
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        
        this.camera.target = this.mesh.position;
    }
    
    _initInput() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = this.handlePointerDown; // Handle mouse clicks
    }
    
    _handleKeyDown(event) {
        this.keys[event.key.toLowerCase()] = true;
        
        // Handle Sprint Toggle (Shift)
        if (event.key.toLowerCase() === 'shift' && this.stamina > 0) {
            this.isSprinting = true;
        }
        
        // Handle Ability Hotkeys (1-5)
        const slotIndex = parseInt(event.key, 10) - 1;
        if (slotIndex >= 0 && slotIndex < 5) {
            this.useAbilitySlot(slotIndex);
        }

        // Handle Inventory Toggle (I)
        if (event.key.toLowerCase() === 'i' && this.scene.game.ui) {
            this.scene.game.ui.toggleInventory();
        }
    }

    _handleKeyUp(event) {
        this.keys[event.key.toLowerCase()] = false;
        
        // Handle Sprint Toggle (Shift)
        if (event.key.toLowerCase() === 'shift') {
            this.isSprinting = false;
        }
    }
    
    // --- Combat / Targeting ---
    _handlePointerDown(event, pickResult) {
        // Right-click: Clear Target
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

    useAbilitySlot(slotIndex) {
        const ability = this.combat.actionSlots[slotIndex];
        if (!ability || !ability.isReady()) return;
        
        const target = this.combat.target;

        if (ability.execute(this, target)) {
            // Ability successfully used (cooldown started, resources consumed)
            // Can add visual/audio feedback here
        }
    }

    getAbility(name) {
        return this.combat.abilities.get(name);
    }
    
    loadAbility(abilityTemplate) {
        if (!abilityTemplate) return;
        const ability = new Ability(abilityTemplate);
        this.combat.abilities.set(ability.name, ability);
    }

    setAbilitySlot(slotIndex, abilityName) {
        const ability = this.getAbility(abilityName);
        if (!ability) {
             console.error(`[Player] Cannot set ability slot: Ability '${abilityName}' not loaded.`);
             return;
        }
        this.combat.actionSlots[slotIndex] = ability;
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
        // Reset current stats to base stats
        this.stats.currentAttackPower = this.stats.attackPower;
        this.stats.currentMagicPower = this.stats.magicPower;
        this.stats.currentMoveSpeed = this.stats.moveSpeed;

        // Apply equipment bonuses (placeholder logic)
        for (const slot in this.equipment.slots) {
            const item = this.equipment.slots[slot];
            if (item && item.stats) {
                this.stats.currentAttackPower += item.stats.attackPower || 0;
                this.stats.currentMagicPower += item.stats.magicPower || 0;
                this.stats.currentMoveSpeed += item.stats.moveSpeed || 0;
            }
        }
    }
    
    getSaveData() {
        return {
            position_x: this.mesh.position.x,
            position_y: this.mesh.position.y,
            position_z: this.mesh.position.z,
            rotation_y: this.visualRoot.rotation.y,
            
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,

            // Base stats from class
            base_attack_power: this.stats.attackPower,
            base_magic_power: this.stats.magicPower,
            base_move_speed: this.stats.moveSpeed,
            
            // Experience/Level/Gold (placeholder)
            level: 1,
            experience: 0,

            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData(),
        };
    }
    
    loadFromData(data) {
        this.mesh.position.set(data.position_x, data.position_y, data.position_z);
        this.visualRoot.rotation.y = data.rotation_y;
        
        // Resources
        this.health = data.health;
        this.mana = data.mana;
        this.stamina = data.stamina;

        // Stats (assuming max stats are loaded from class selection)
        this.stats.attackPower = data.base_attack_power;
        this.stats.magicPower = data.base_magic_power;
        this.stats.moveSpeed = data.base_move_speed;
        
        // Level/XP
        // this.level = data.level;
        // this.experience = data.experience;

        // Apply equipment/recalculate current stats
        this.updateStatsFromEquipment();

        // Load Inventory and Equipment
        // This is done in Game.js using the network service, but can be done here too
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
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas())
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
