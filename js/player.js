// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.28 (FINAL PATCH)
// Fix: Corrected Babylon.js API calls in _initInput, _initCamera, and dispose.
// Fix: Renamed loadSaveData to loadState and added template safety checks.
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
        this.level = 1; // Explicitly initialize level
        
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
        // These classes must be defined in item.js
        if (typeof Inventory === 'undefined' || typeof Equipment === 'undefined') {
            console.error("[Player] Inventory/Equipment classes are not defined. Check item.js script order.");
            this.inventory = { getSaveData: () => [], load: () => {} };
            this.equipment = { getSaveData: () => [], load: () => {}, slots: {} };
        } else {
            this.inventory = new Inventory(this);
            this.equipment = new Equipment();
        }

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
        if (this.scene.game.ui && this.scene.game.ui.showMessage) {
            this.scene.game.ui.showMessage(`You took ${damage.toFixed(0)} damage from ${source.name}!`, 1500, 'playerDamage');
        }
        
        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;
        if (this.scene.game.ui && this.scene.game.ui.showMessage) {
            this.scene.game.ui.showMessage("You have died.", 5000, 'critical');
        }
        console.log('Player died.');
        // TODO: Respawn logic
    }
    
    // --- Movement Helpers ---
    _handleMovement(deltaTime) {
        // Fallback for CONFIG check
        const playerConfig = (typeof CONFIG !== 'undefined' && CONFIG.PLAYER) ? CONFIG.PLAYER : {};
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5;

        const speed = this.stats.currentMoveSpeed * (this.isSprinting ? 1.5 : 1.0);
        let moveVector = new BABYLON.Vector3(0, 0, 0);
        
        if (!this.visualRoot || !this.mesh || !this.mesh.physicsImpostor) return;

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
                if (this.mesh.position.y < spawnHeight + 0.1) {
                    this.mesh.physicsImpostor.setLinearVelocity(
                        this.mesh.physicsImpostor.getLinearVelocity().add(new BABYLON.Vector3(0, 5, 0))
                    );
                    this.keys[' '] = false; // Consume the jump key press
                }
            }

            // Apply force
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            const newVelocity = new BABYLON.Vector3(moveVector.x, 0, moveVector.z);
            
            // Keep existing vertical velocity (gravity/jump)
            newVelocity.y = currentVelocity.y; 

            // Use the simplified linear velocity calculation for character movement
            this.mesh.physicsImpostor.setLinearVelocity(
                newVelocity
            );
            
            this.isMoving = true;
        } else {
            this.isMoving = false;
            // Stop horizontal movement when keys are released
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, currentVelocity.y, 0));
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
            if (this.scene.game.ui && this.scene.game.ui.toggleInventory) {
                this.scene.game.ui.toggleInventory();
            }
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
            // Need to implement _toggleHighlight in the base Character/Enemy classes if they don't have it
            if (typeof this.combat.target._toggleHighlight === 'function') {
                this.combat.target._toggleHighlight(false);
            }
        }
        
        this.combat.target = target;
        
        if (target) {
            if (typeof target._toggleHighlight === 'function') {
                target._toggleHighlight(true);
            }
            if (this.scene.game.ui && this.scene.game.ui.updateTargetInfo) {
                this.scene.game.ui.updateTargetInfo(target);
            }
        } else {
            if (this.scene.game.ui && this.scene.game.ui.updateTargetInfo) {
                this.scene.game.ui.updateTargetInfo(null);
            }
        }
    }
    
    getAbility(name) {
        return this.combat.abilities.get(name);
    }
    
    loadAbility(abilityTemplate) {
        if (!abilityTemplate) return;
        // Requires the Ability class to be loaded from ability.js
        if (typeof Ability === 'undefined') {
             console.error("[Player] Ability class is undefined. Check ability.js script order.");
             return null;
        }
        const ability = new Ability(abilityTemplate);
        this.combat.abilities.set(ability.name, ability);
        return ability;
    }
    
    setAbilitySlot(slotIndex, abilityName) {
        const ability = this.combat.abilities.get(abilityName);
        if (ability && slotIndex >= 0 && slotIndex < this.combat.actionSlots.length) {
            this.combat.actionSlots[slotIndex] = ability;
        }
    }
    
    useAbilitySlot(slotIndex) {
        const ability = this.combat.actionSlots[slotIndex];
        if (!ability || !ability.isReady()) return;
        
        const target = this.combat.target;
        
        if (ability.execute(this, target)) {
            // Ability was successfully used (cost paid, cooldown started)
        }
    }
    
    // --- Save/Load Data (FIXED) ---
    /**
     * Returns a save data object formatted for the NetworkManager.
     * Includes flattened character stats (for hosg_characters table) and nested data
     * for inventory/equipment (for separate save operations).
     */
    getSaveData() {
        if (!this.mesh) return {};

        // Data for hosg_characters table (flatter structure)
        const charData = {
            // Core Stats
            level: this.level,
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            
            // Position (flattened to match table columns)
            position_x: parseFloat(this.mesh.position.x.toFixed(2)),
            position_y: parseFloat(this.mesh.position.y.toFixed(2)),
            position_z: parseFloat(this.mesh.position.z.toFixed(2)),
            rotation_y: parseFloat(this.mesh.rotation.y.toFixed(2)),
            
            // JSONB 'stats' column in the database
            stats: { 
                className: this.className,
            },
        };

        // Nested data for separate save operations in network.js
        const nestedData = {
            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData(),
            // Only store the names of abilities in the slots
            action_slots: this.combat.actionSlots.map(a => a ? a.name : null) 
        };
        
        // Combine them for network.js to process
        return {
            ...charData,
            ...nestedData
        };
    }
    
    /**
     * Loads the character state from a database record and templates.
     */
    async loadState(data, templates) {
        if (!data) return;
        
        // FIX: ADD SAFETY CHECKS FOR TEMPLATES
        const itemTemplates = templates && templates.itemTemplates ? templates.itemTemplates : new Map();
        const skillTemplates = templates && templates.skillTemplates ? templates.skillTemplates : new Map();

        // Fallback for CONFIG check
        const playerConfig = (typeof CONFIG !== 'undefined' && CONFIG.PLAYER) ? CONFIG.PLAYER : {};
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5;

        // Load basic character state from the hosg_characters record
        this.level = data.level !== undefined ? data.level : 1;
        this.health = data.health !== undefined ? data.health : this.stats.maxHealth;
        this.mana = data.mana !== undefined ? data.mana : this.stats.maxMana;
        this.stamina = data.stamina !== undefined ? data.stamina : this.stats.maxStamina;

        // Apply position
        if (this.mesh) {
            this.mesh.position.set(data.position_x || 0, data.position_y || spawnHeight, data.position_z || 0);
            this.mesh.rotation.y = data.rotation_y || 0;
        }
        
        // Load className from the JSONB stats column
        const characterStats = data.stats || {};
        this.className = characterStats.className || this.className;

        // Load Abilities from Templates
        this.combat.abilities.clear();
        for (const template of skillTemplates.values()) {
            this.loadAbility(template);
        }

        // Load Inventory and Equipment
        if (typeof this.inventory.load === 'function') {
            if (data.inventory) this.inventory.load(data.inventory, itemTemplates); 
        } else {
             console.warn("[Player] Inventory.load is missing. Check item.js script order.");
        }
        
        if (typeof this.equipment.load === 'function') {
            if (data.equipment) this.equipment.load(data.equipment, itemTemplates);
        } else {
             console.warn("[Player] Equipment.load is missing. Check item.js script order.");
        }
        
        
        // Load Action Bar Slots
        if (data.action_slots) {
             data.action_slots.forEach((abilityName, index) => {
                if (abilityName) {
                    this.setAbilitySlot(index, abilityName);
                }
            });
        }
        
        // Apply class stats (must run after className is set)
        if (this.className) {
            this.selectClass(this.className);
        }
        
        console.log(`[Player] State loaded. Character: ${this.className}, Level: ${this.level}`);
    }
    
    selectClass(className) {
        // Fallback for CONFIG check
        const configClasses = (typeof CONFIG !== 'undefined' && CONFIG.CLASSES) ? CONFIG.CLASSES : {};
        const classData = configClasses[className];

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
        
        // FIX: Replaced non-existent 'getRenderingCanvasId' with 'getRenderingCanvas()'
        // Disable default browser context menu on right-click
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
            canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        }
    }

    _initCamera() {
        // Use a standard FollowCamera
        this.camera = new BABYLON.FollowCamera("PlayerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        this.camera.radius = 15; // Distance from the target
        this.camera.heightOffset = 4; // Height above the target
        this.camera.rotationOffset = 180; // Angle around the target
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxSpeed = 10;
        
        // FIX: Completed the call to attachControl
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if (canvas) {
            this.camera.attachControl(canvas, true);
        }
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
        
        // FIX: Completed the call to detachControl
        const canvas = this.scene.getEngine().getRenderingCanvas();
        if(this.camera && canvas) {
            this.camera.detachControl(canvas)
        }
    }

    _handleCamera(deltaTime) {
        if (!this.visualRoot || !this.mesh || !this.mesh.physicsImpostor) return;
        
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
