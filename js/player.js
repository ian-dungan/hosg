// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.32 (CRITICAL ASSETMANAGER NULL FIX)
// Fix: Added null-check in _initMesh to ensure assetManager is available before use.
// ============================================================

// Safety guards: ensure Entity/Character exist even if previous scripts failed to load.
if (typeof Entity === 'undefined') {
    console.warn('[Player] Entity base class missing. Installing minimal fallback.');
    class Entity {
        constructor(scene, position) {
            this.scene = scene;
            this.position = position || new BABYLON.Vector3(0, 0, 0);
            this.mesh = null;
            this.isDead = false;
        }

        update() {
            if (this.mesh && this.mesh.position && this.position && typeof this.mesh.position.copyFrom === 'function') {
                this.mesh.position.copyFrom(this.position);
            }
        }

        dispose() {
            this.isDead = true;
            if (this.mesh && typeof this.mesh.dispose === 'function') {
                this.mesh.dispose();
                this.mesh = null;
            }
        }
    }
    window.Entity = Entity;
}

// Safety guard: if Character failed to load (e.g., due to script order issues),
// provide a minimal fallback to avoid a ReferenceError and allow the game to
// continue using basic Entity behavior until assets load correctly.
if (typeof Character === 'undefined' && typeof Entity !== 'undefined') {
    console.warn('[Player] Character base class missing. Using minimal fallback.');
    class Character extends Entity {
        constructor(scene, position, name = 'Character') {
            super(scene, position, name);
            this.name = name;
            this.health = 100;
            this.target = null;
        }
    }
    window.Character = Character;
}

class Player extends Character {
    constructor(scene) {
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const playerConfig = C.PLAYER || {};
        const combatConfig = C.COMBAT || {};
        
        const spawnHeight = playerConfig.SPAWN_HEIGHT || 5; 
        
        super(scene, new BABYLON.Vector3(0, spawnHeight, 0), 'Player');
        
        this.isPlayer = true; 
        this.className = null; 
        
        this.stats = {
            maxHealth: playerConfig.HEALTH || 100,
            maxMana: playerConfig.MANA || 50, 
            maxStamina: playerConfig.STAMINA || 100,
            
            attackPower: 10,
            magicPower: 5,
            
            moveSpeed: playerConfig.MOVE_SPEED || 0.15, 

            attackRange: combatConfig.RANGE_MELEE || 2,
            attackCooldown: combatConfig.ATTACK_COOLDOWN_MELEE || 1,
            
            currentAttackPower: 10,
            currentMagicPower: 5,
        };
        
        this.health = this.stats.maxHealth;
        this.mana = this.stats.maxMana;
        this.stamina = this.stats.maxStamina;
        this.abilities = []; 
        this.inventory = new Inventory(this);
        this.equipment = new Equipment(this);

        this.keys = {}; // For input tracking
        this.camera = null;
        this.target = null;
        this.lastAttackTime = 0;
        this.isGrounded = true;
        
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handlePointerDown = this.handlePointerDown.bind(this);

        this._initCamera();
        this._initInput();
        this._initPhysics(); 

        // CRITICAL: applyClass calls _initMesh immediately.
        // The fix is to ensure the assetManager is assigned BEFORE new Player(scene) runs.
        this.applyClass('Warrior'); 
    }
    
    _initCamera() {
        this.camera = new BABYLON.FollowCamera("PlayerCamera", this.position.clone(), this.scene);
        this.camera.radius = 10; // Distance of the camera from the target
        this.camera.heightOffset = 4; // Height of camera above the target
        this.camera.rotationOffset = 180; // Start facing backward
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 20;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    }
    
    _initInput() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = this.handlePointerDown;
    }

    _initPhysics() {
        if (!this.mesh) {
            // Create a simple invisible mesh just for physics collision/position
            this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollision", {
                height: 2, diameter: 1
            }, this.scene);
            this.mesh.isVisible = false;
            this.mesh.checkCollisions = true; 
        }

        this.mesh.position.copyFrom(this.position);
        
        // Add a physics impostor
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh, 
            BABYLON.PhysicsImpostor.CylinderImpostor, 
            { mass: 1, restitution: 0.1, friction: 0.5 }, 
            this.scene
        );
        
        // Set collision filters if necessary (future feature)
    }

    _initMesh(assetKey) {
        // CRITICAL FIX: Check if assetManager is ready
        if (!this.scene.game || !this.scene.game.assetManager) {
            console.error("[Player] Cannot initialize mesh. AssetManager is not available on game object.");
            // Fallback: Make the collision mesh visible for debugging
            if(this.mesh) this.mesh.isVisible = true;
            return;
        }

        // Use the simple key name (e.g., 'knight')
        const assetMeshes = this.scene.game.assetManager.getAsset(assetKey); 
        
        if (assetMeshes && assetMeshes.length > 0) {
            const rootMesh = assetMeshes[0].clone("PlayerMesh", null);
            rootMesh.isVisible = true;

            // Attach the visual mesh to the collision mesh as a child
            if (this.mesh) {
                rootMesh.parent = this.mesh;
                // Offset the visual mesh so it sits correctly on the ground relative to the collision mesh
                rootMesh.position = new BABYLON.Vector3(0, -1, 0); 
                rootMesh.rotation.y = Math.PI; // Face the correct direction for the camera
            }

            // Store the root mesh reference 
            this.visualMesh = rootMesh; 
        } else {
            console.warn(`[Player] Failed to load mesh for asset: ${assetKey}. AssetManager load failed or key is wrong.`);
            // Fallback: Make the collision mesh visible for debugging
            if(this.mesh) this.mesh.isVisible = true;
        }
    }

    // --- Input Handlers ---

    handleKeyDown(event) {
        this.keys[event.key.toLowerCase()] = true;
    }

    handleKeyUp(event) {
        this.keys[event.key.toLowerCase()] = false;
    }

    handlePointerDown(evt) {
        if (evt.button === 0) { // Left click
            const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);

            if (pickResult.hit && pickResult.pickedMesh && pickResult.pickedMesh.parent) {
                const targetEntity = this.scene.game.world.npcs.find(
                    (npc) => npc.mesh && npc.mesh === pickResult.pickedMesh.parent
                );

                if (targetEntity) {
                    this.target = targetEntity;
                    this.scene.game.ui.showMessage(`Target acquired: ${this.target.name}`, 1000, 'info');

                    // If a target is acquired and an ability is ready, perform an attack
                    const attackAbility = this.abilities[0]; 
                    if (attackAbility && attackAbility.isReady()) {
                        attackAbility.execute(this, this.target);
                    }
                } else {
                    this.target = null;
                }
            } else {
                this.target = null;
            }
        }
    }

    // --- Core Update Loop ---
    
    update(deltaTime) {
        this.abilities.forEach(ability => ability.update(deltaTime));
        this._updateMovement(deltaTime);
        this._updateCameraPosition();
        
        // Keep the Character base update (syncs collision mesh position to this.position)
        Entity.prototype.update.call(this, deltaTime);
    }
    
    _updateMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;
        
        const impulseForce = 25; 
        const velocity = this.mesh.physicsImpostor.getLinearVelocity();
        let moveVector = BABYLON.Vector3.Zero();

        if (this.keys['w']) moveVector.z += 1;
        if (this.keys['s']) moveVector.z -= 1;
        if (this.keys['a']) moveVector.x -= 1;
        if (this.keys['d']) moveVector.x += 1;

        if (moveVector.lengthSquared() > 0) {
            moveVector = moveVector.normalize();

            // Rotate the move vector based on the camera's rotation
            const yRotation = this.camera.rotationOffset * (Math.PI / 180);
            const matrix = BABYLON.Matrix.RotationY(yRotation);
            moveVector = BABYLON.Vector3.TransformCoordinates(moveVector, matrix);
            
            // Apply impulse
            const impulse = moveVector.scale(impulseForce);
            this.mesh.physicsImpostor.applyImpulse(
                impulse,
                this.mesh.getAbsolutePosition()
            );

            // Update visual mesh rotation (only if visual mesh exists)
            if (this.visualMesh) {
                const targetAngle = Math.atan2(moveVector.x, moveVector.z);
                this.visualMesh.rotation.y = targetAngle;
            }
        }

        // Simple velocity dampening to prevent sliding indefinitely
        const horizontalVelocity = new BABYLON.Vector3(velocity.x, 0, velocity.z);
        if (horizontalVelocity.lengthSquared() > 0.01) {
            const dampingForce = horizontalVelocity.scale(-2); // Apply opposing force
            this.mesh.physicsImpostor.applyForce(
                dampingForce,
                this.mesh.getAbsolutePosition()
            );
        }
    }

    // --- Class & Stats ---

    applyClass(className) {
        const classConfig = CONFIG && CONFIG.ASSETS && CONFIG.ASSETS.CLASSES
            ? CONFIG.ASSETS.CLASSES[className]
            : null;

        if (classConfig) {
            this.className = className;
            
            // 1. Apply Stats
            Object.assign(this.stats, classConfig.stats);
            this.health = this.stats.maxHealth;
            this.mana = this.stats.maxMana;
            this.stamina = this.stats.maxStamina;

            // 2. Initialize Mesh
            const assetKey = classConfig.model; // e.g., 'knight'
            this._initMesh(assetKey);
            
            // 3. Initialize Abilities
            if (this.scene.game.skillTemplates) {
                const defaultAbilityTemplate = this.scene.game.skillTemplates.get(classConfig.defaultAbility);
                if (defaultAbilityTemplate) {
                    this.abilities = [new Ability(defaultAbilityTemplate)];
                } else {
                    console.warn(`[Player] Default ability template not found for: ${classConfig.defaultAbility}`);
                    this.abilities = []; // Ensure it's still an array
                }
            }
            
            console.log(`[Player] Applied default class: ${className}`);
        } else {
            console.warn(`[Player] Class config not found for: ${className}`);
        }
    }

    // --- Cleanup/Utility ---
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
        
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
    }

    _updateCameraPosition() {
        if (this.camera && this.mesh) {
            this.camera.target.copyFrom(this.mesh.position);
        }
    }
}
// Ensure the Player class is globally accessible
window.Player = Player;
