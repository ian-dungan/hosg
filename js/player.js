// ============================================================\
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.32 (CRITICAL ASSET MESH FIX)
// Fix: Removed _initMesh() call from constructor to ensure it runs only after
//      the AssetManager is available and assets are loaded in index.html.
// ============================================================\

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

        // ** PATCH 1: ADD ASSET MANAGER PROPERTY **
        // This is set later in index.html
        this.assetManager = null; 
        
        this.inventory = new Inventory(this);
        this.equipment = new Equipment(this);
        this.abilities = []; // Will be populated in applyDefaultClass

        // ** PATCH 2: CRITICAL FIX - REMOVED MESH INIT CALL **
        // this._initMesh(); // <-- THIS LINE HAS BEEN REMOVED TO PREVENT CRASH

        this._initCamera();
        this._initControls();
        this._initTargetHighlight();
        this._initCollision();
    }

    // --- Core Methods ---
    
    update(deltaTime) {
        super.update(deltaTime);
        this.updateMovement(deltaTime);
        this.updateAbilities(deltaTime);
        this._updateCameraPosition();
    }

    updateAbilities(deltaTime) {
        if (this.abilities) {
            this.abilities.forEach(ability => ability.update(deltaTime));
        }
    }

    // --- Mesh and Visuals ---

    _initMesh() {
        if (!this.assetManager) {
            console.error("[Player] Cannot initialize mesh: AssetManager is not assigned to player.");
            return;
        }

        const className = this.className || 'Warrior'; // Default class
        const classConfig = CONFIG.ASSETS.CHARACTERS[className.toLowerCase()] || CONFIG.ASSETS.CLASSES.Warrior;
        
        // Find the appropriate asset name (assuming it's keyed correctly in CONFIG.ASSETS)
        const assetName = Object.keys(CONFIG.ASSETS.CHARACTERS).find(key => 
            CONFIG.ASSETS.CHARACTERS[key].model === classConfig.model
        );
        
        const meshes = this.assetManager.getAsset('characters_' + assetName);
        if (!meshes || meshes.length === 0) {
            console.error(`[Player] Failed to load mesh for asset: ${assetName}`);
            return;
        }

        // Clone the root mesh for the player instance
        this.mesh = meshes[0].clone(this.name + "_mesh", null, true);
        if (!this.mesh) {
            console.error("[Player] Failed to clone player mesh.");
            return;
        }
        
        this.mesh.parent = null; // Detach from the asset root
        this.mesh.isPickable = true;
        this.mesh.checkCollisions = true;
        this.mesh.position.copyFrom(this.position);
        
        // Hide the original asset meshes
        meshes.forEach(m => m.setEnabled(false));

        // Create the bounding box mesh for physics (the Character class is responsible for the impostor)
        this._initCollisionMesh(this.mesh); 
        
        // Set the camera target to the mesh position
        this._updateCameraPosition();
    }

    _initCamera() {
        this.camera = new BABYLON.FollowCamera("playerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        this.camera.target = this.mesh ? this.mesh.position : new BABYLON.Vector3(0, 5, 0); 
        this.camera.radius = 8;
        this.camera.heightOffset = 4;
        this.camera.rotationOffset = 180;
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 20;

        // Use the default canvas control
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    }
    
    // --- Control and Movement ---
    
    _initControls() {
        this.isMoving = { forward: false, backward: false, left: false, right: false, jump: false };
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    updateMovement(deltaTime) {
        // Simple WASD movement on the XZ plane
        let movement = new BABYLON.Vector3(0, 0, 0);
        let moveSpeed = this.stats.moveSpeed * 100 * deltaTime; 

        if (this.isMoving.forward) movement.z += moveSpeed;
        if (this.isMoving.backward) movement.z -= moveSpeed;
        if (this.isMoving.left) movement.x -= moveSpeed;
        if (this.isMoving.right) movement.x += moveSpeed;

        if (movement.length() > 0) {
            movement = movement.normalize().scale(moveSpeed);
            
            // Apply movement relative to camera direction
            const cameraDirection = this.camera.getDirection(BABYLON.Vector3.Forward());
            cameraDirection.y = 0; 
            cameraDirection.normalize();

            // Simple mesh movement (needs physics impostor)
            if (this.mesh && this.mesh.physicsImpostor) {
                // Apply force/velocity to the physics impostor
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(movement.x * 10, this.mesh.physicsImpostor.getLinearVelocity().y, movement.z * 10));
                
                // Rotation
                const targetYaw = this.camera.rotationOffset * (Math.PI / 180); 
                this.mesh.rotation.y = targetYaw; 
            }
        } else if (this.mesh && this.mesh.physicsImpostor) {
            // Stop movement smoothly
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, currentVelocity.y, 0));
        }

        // Jump logic (if needed)
        // if (this.isMoving.jump && this.canJump) { ... }
    }

    handleKeyDown(event) {
        switch (event.key.toLowerCase()) {
            case 'w': this.isMoving.forward = true; break;
            case 's': this.isMoving.backward = true; break;
            case 'a': this.isMoving.left = true; break;
            case 'd': this.isMoving.right = true; break;
            case ' ': this.isMoving.jump = true; break;
        }
    }

    handleKeyUp(event) {
        switch (event.key.toLowerCase()) {
            case 'w': this.isMoving.forward = false; break;
            case 's': this.isMoving.backward = false; break;
            case 'a': this.isMoving.left = false; break;
            case 'd': this.isMoving.right = false; break;
            case ' ': this.isMoving.jump = false; break;
        }
    }
    
    // --- Collision and Physics ---

    _initCollisionMesh(parentMesh) {
        // Create a simple bounding box impostor to handle physics
        const impostorSize = new BABYLON.Vector3(1, 2, 1);
        const impostorMesh = BABYLON.MeshBuilder.CreateBox("playerCollisionBox", { height: impostorSize.y, width: impostorSize.x, depth: impostorSize.z }, this.scene);
        impostorMesh.visibility = 0.0; // Invisible
        impostorMesh.checkCollisions = true;
        impostorMesh.isPickable = false;
        impostorMesh.position.copyFrom(this.position);
        impostorMesh.position.y += impostorSize.y / 2; // Lift off the ground

        this.collisionMesh = impostorMesh;
        
        // Parent the visual mesh to the collision mesh so visuals follow physics
        if (parentMesh) {
            parentMesh.parent = impostorMesh;
            parentMesh.position.y = -impostorSize.y / 2; // Position the visual mesh relative to the collision box base
        }

        // Apply Physics Impositor
        impostorMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            impostorMesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 80, friction: 0.5, restitution: 0.0 },
            this.scene
        );

        // Prevent rotation on Z and X axes, allowing only yaw (Y)
        impostorMesh.physicsImpostor.setAngularFactor(new BABYLON.Vector3(0, 1, 0));
        console.log(`[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.`);

        this.mesh = impostorMesh; // The mesh property now points to the physics mesh
    }

    // --- Class and Stats ---

    applyDefaultClass(className) {
        if (!className) {
            className = this.className || 'Warrior'; // Use current or default
        }
        this.className = className;
        const classConfig = CONFIG.ASSETS.CLASSES[className];

        if (classConfig) {
            // Update base stats
            Object.assign(this.stats, classConfig.stats);
            this.health = this.stats.maxHealth;
            this.mana = this.stats.maxMana;
            this.stamina = this.stats.maxStamina;

            // Initialize default ability
            if (classConfig.defaultAbility && this.scene.game && this.scene.game.skillTemplates) {
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

    // --- Cleanup/Utility ---\
    
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
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
    }

    _updateCameraPosition() {
        // Sync the camera target to the player's collision mesh position
        if (this.camera && this.mesh) {
            this.camera.target.copyFrom(this.mesh.position);
        }
    }
}
// Ensure the Player class is globally accessible
window.Player = Player;
