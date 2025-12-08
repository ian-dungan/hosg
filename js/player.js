// ============================================================\
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.33 (CRITICAL CONFIG & ASSET MESH FIX)
// Fix: 1. Removed _initMesh() call from constructor.
//      2. Added assetManager property.
//      3. Corrected _initMesh to use the new CONFIG.ASSETS.CLASSES path.
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
        // This is set in index.html, before _initMesh is called.
        this.assetManager = null; 
        
        // Assuming Inventory and Equipment are defined in item.js
        this.inventory = new Inventory(this);
        this.equipment = new Equipment(this);
        this.abilities = []; 

        // ** PATCH 2: CRITICAL FIX - REMOVED MESH INIT CALL **
        // this._initMesh(); // <-- THIS LINE IS NOW GONE

        this._initCamera();
        this._initControls();
        // NOTE: Collision init will now run before mesh init
        this._initCollision();
        this._initTargetHighlight();
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

        // 1. Get the class config using the correct path
        const className = this.className || 'Warrior'; 
        // ** CRITICAL FIX: Use the new CONFIG path (CONFIG.ASSETS.CLASSES) **
        const classConfig = CONFIG.ASSETS.CLASSES[className]; 

        if (!classConfig) {
            console.error(`[Player] Class configuration not found for: ${className}`);
            return;
        }

        // 2. Resolve the asset key from the class model property (e.g., 'knight')
        const assetModelKey = classConfig.model;
        const assetKey = 'characters_' + assetModelKey; 
        
        const meshes = this.assetManager.getAsset(assetKey);
        
        if (!meshes || meshes.length === 0) {
            console.error(`[Player] Failed to load mesh for asset: ${assetKey}. AssetManager load failed or key is wrong.`);
            return;
        }

        // Clone the root mesh for the player instance
        // Assuming the root mesh is the first one in the array
        this.mesh = meshes[0].clone(this.name + "_mesh", null, true);
        if (!this.mesh) {
            console.error("[Player] Failed to clone player mesh.");
            return;
        }
        
        this.mesh.parent = null; 
        this.mesh.isPickable = true;
        this.mesh.checkCollisions = true;
        this.mesh.position.copyFrom(this.position);
        
        // Hide the original asset meshes
        meshes.forEach(m => m.setEnabled(false));

        // Use the collision mesh logic to attach the visual mesh
        this._initCollisionMesh(this.mesh); 
        this._updateCameraPosition();
        
        // IMPORTANT: Update the camera target to the mesh's position once initialized
        this.camera.target = this.mesh.position;
    }

    _initCamera() {
        this.camera = new BABYLON.FollowCamera("playerCamera", new BABYLON.Vector3(0, 5, -10), this.scene);
        // Set an initial target, which will be updated by _initMesh
        this.camera.target = new BABYLON.Vector3(0, 5, 0); 
        this.camera.radius = 8;
        this.camera.heightOffset = 4;
        this.camera.rotationOffset = 180;
        this.camera.cameraAcceleration = 0.05;
        this.camera.maxCameraSpeed = 20;

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
        let movement = new BABYLON.Vector3(0, 0, 0);
        let moveSpeed = this.stats.moveSpeed * 100 * deltaTime; 

        if (this.isMoving.forward) movement.z += moveSpeed;
        if (this.isMoving.backward) movement.z -= moveSpeed;
        if (this.isMoving.left) movement.x -= moveSpeed;
        if (this.isMoving.right) movement.x += moveSpeed;

        if (movement.length() > 0) {
            movement = movement.normalize().scale(moveSpeed);
            
            const cameraDirection = this.camera.getDirection(BABYLON.Vector3.Forward());
            cameraDirection.y = 0; 
            cameraDirection.normalize();

            if (this.mesh && this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(movement.x * 10, this.mesh.physicsImpostor.getLinearVelocity().y, movement.z * 10));
                
                const targetYaw = this.camera.rotationOffset * (Math.PI / 180); 
                this.mesh.rotation.y = targetYaw; 
            }
        } else if (this.mesh && this.mesh.physicsImpostor) {
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, currentVelocity.y, 0));
        }
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

    _initCollision() {
        // This is a placeholder that will be completed by _initCollisionMesh, 
        // which runs later after the mesh is loaded.
        // It's called in the constructor, but the actual physics object
        // creation is done in _initCollisionMesh(parentMesh).
    }

    _initCollisionMesh(parentMesh) {
        const impostorSize = new BABYLON.Vector3(1, 2, 1);
        const impostorMesh = BABYLON.MeshBuilder.CreateBox("playerCollisionBox", { height: impostorSize.y, width: impostorSize.x, depth: impostorSize.z }, this.scene);
        impostorMesh.visibility = 0.0; 
        impostorMesh.checkCollisions = true;
        impostorMesh.isPickable = false;
        impostorMesh.position.copyFrom(this.position);
        impostorMesh.position.y += impostorSize.y / 2; 

        this.collisionMesh = impostorMesh;
        
        if (parentMesh) {
            parentMesh.parent = impostorMesh;
            parentMesh.position.y = -impostorSize.y / 2; 
        }

        impostorMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            impostorMesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 80, friction: 0.5, restitution: 0.0 },
            this.scene
        );

        impostorMesh.physicsImpostor.setAngularFactor(new BABYLON.Vector3(0, 1, 0));
        console.log(`[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.`);

        // The mesh property now points to the physics mesh for movement/position updates
        this.mesh = impostorMesh; 
    }

    // --- Class and Stats ---

    applyDefaultClass(className) {
        if (!className) {
            className = this.className || 'Warrior'; 
        }
        this.className = className;
        const classConfig = CONFIG.ASSETS.CLASSES[className];

        if (classConfig) {
            Object.assign(this.stats, classConfig.stats);
            this.health = this.stats.maxHealth;
            this.mana = this.stats.maxMana;
            this.stamina = this.stats.maxStamina;

            if (classConfig.defaultAbility && this.scene.game && this.scene.game.skillTemplates) {
                const defaultAbilityTemplate = this.scene.game.skillTemplates.get(classConfig.defaultAbility);
                if (defaultAbilityTemplate) {
                    // Assuming Ability class is defined in ability.js
                    this.abilities = [new Ability(defaultAbilityTemplate)];
                } else {
                    console.warn(`[Player] Default ability template not found for: ${classConfig.defaultAbility}`);
                    this.abilities = []; 
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
