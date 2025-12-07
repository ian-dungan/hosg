// ============================================================\n
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.12 (PATCHED)
// Fix: Implemented all missing Player setup methods (_initCamera, _initCollision, _initInput)
// Fix: Implemented core movement/rotation logic (handleMovement, handleRotation)
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
            attackRange: CONFIG.COMBAT.BASE_ATTACK_RANGE
        };
        
        // This is where the Player instance is assigned to the game for UI access
        this.scene.game.player = this; 

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
            keysDown: {} // To track key state
        };
        
        this.camera = null;
        this.visualRoot = null;
    }

    // --- INITIALIZATION SEQUENCE ---

    async init() {
        // 1. Create a placeholder mesh (until real assets are loaded)
        await this._initMesh(); 
        
        // 2. Setup Camera, Physics, and Controls
        this._initCamera(); // Fixes the crash here
        this._initCollision();
        this._initInput();
        this._initTargetHighlight();
        
        // 3. Load combat data (Abilities)
        this._loadAbilities(this.scene.game.skillTemplates);

        console.log("[Player] Initialization complete.");
    }
    
    // --- SETUP IMPLEMENTATIONS ---
    
    async _initMesh() { 
        // Dummy implementation to ensure visualRoot and mesh are defined. 
        // The mesh is the non-visible physics collider, visualRoot holds the camera/model.
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.isVisible = false;
        this.mesh.checkCollisions = true;
        this.mesh.isPickable = false; // Player's physics body should not be picked

        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder visible mesh (Box for now)
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        // Offset to align model to the base of the cylinder/ground
        placeholderMesh.position.y = -0.9; 
        
        console.log("[Player] Mesh and visual root created.");
    }

    _initCamera() {
        // Create an ArcRotateCamera for third-person view
        // Note: The camera needs a target, which is the player's mesh
        this.camera = new BABYLON.ArcRotateCamera("playerCamera", 
            -Math.PI / 2, Math.PI / 3, 10, this.mesh.position.clone(), this.scene);
        
        // Prevent camera from going through the ground
        this.camera.checkCollisions = true; 
        
        // Camera restrictions
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 20;
        this.camera.betaMin = 0.1;
        this.camera.betaMax = (Math.PI / 2) * 0.95; 

        // CRASH FIX: Use the correct method to get the canvas.
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), false);
        
        // Disable the camera's built-in input to handle movement manually
        this.camera.inputs.clear();

        console.log("[Player] Camera initialized.");
    }

    _initCollision() {
        // Player Physics Impostor (required for collision and movement)
        if (typeof BABYLON.PhysicsImpostor !== "undefined" && this.mesh) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.CylinderImpostor, 
                { 
                    mass: CONFIG.PLAYER.MASS, 
                    friction: CONFIG.PLAYER.FRICTION, 
                    restitution: 0.0, // No bounce
                    linearDamping: CONFIG.PLAYER.LINEAR_DAMPING,
                    angularDamping: CONFIG.PLAYER.ANGULAR_DAMPING
                }, 
                this.scene
            );
            
            // Initial position setting on the physics body
            this.mesh.position.copyFrom(this.position); 
            console.log("[Player] Collision and physics initialized.");
        } else {
            console.warn("[Player] Physics engine not found or mesh not defined.");
        }
    }
    
    _initInput() {
        // --- Keyboard Input ---
        this.scene.actionManager = new BABYLON.ActionManager(this.scene);
        
        const map = {};
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyDownTrigger, (evt) => {
            map[evt.sourceEvent.keyCode] = evt.sourceEvent.type === "keydown";
            this.input.keysDown = map; 
            this.input.forward = map[87] || map[38];  // W or Up Arrow
            this.input.backward = map[83] || map[40]; // S or Down Arrow
            this.input.left = map[65] || map[37];     // A or Left Arrow
            this.input.right = map[68] || map[39];    // D or Right Arrow
            this.input.run = map[16];                 // Shift
            this.input.jump = map[32];                // Space
            this.input.ability1 = map[49];            // 1
        }));
        
        this.scene.actionManager.registerAction(new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnKeyUpTrigger, (evt) => {
            map[evt.sourceEvent.keyCode] = evt.sourceEvent.type === "keydown";
            this.input.keysDown = map; 
            this.input.forward = map[87] || map[38];
            this.input.backward = map[83] || map[40];
            this.input.left = map[65] || map[37];
            this.input.right = map[68] || map[39];
            this.input.run = map[16];
            this.input.jump = map[32];
            this.input.ability1 = map[49];
        }));

        // --- Mouse/Pointer Input for targeting ---
        this.scene.onPointerObservable.add((pointerInfo) => {
            switch (pointerInfo.type) {
                case BABYLON.PointerEventTypes.POINTERDOWN:
                    // Right-click for targetting
                    if (pointerInfo.event.button === 2) { 
                        const pickResult = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
                        if (pickResult.hit) {
                            this.handleTargeting(pickResult.pickedMesh);
                        }
                    }
                    break;
            }
        });
        
        console.log("[Player] Input bindings initialized.");
    }
    
    _initTargetHighlight() {
        // Placeholder for a system to highlight the current target
        this.targetHighlight = BABYLON.MeshBuilder.CreateTorus("targetHighlight", { diameter: 2, thickness: 0.1 }, this.scene);
        this.targetHighlight.isVisible = false;
        this.targetHighlight.rotation.x = Math.PI / 2;
        
        const mat = new BABYLON.StandardMaterial("targetMat", this.scene);
        mat.emissiveColor = BABYLON.Color3.Red();
        mat.disableLighting = true;
        this.targetHighlight.material = mat;

        console.log("[Player] Target highlighting initialized.");
    }

    _loadAbilities(skillTemplates) {
        if (skillTemplates.size === 0) {
            console.warn("[Player] No skill templates available. Cannot load abilities.");
            return;
        }

        // For now, give the player a default attack ability (ID 1)
        const defaultAbilityTemplate = skillTemplates.get(1);
        if (defaultAbilityTemplate) {
            this.abilities.push(new Ability(defaultAbilityTemplate));
            console.log(`[Player] Loaded default ability: ${defaultAbilityTemplate.name}`);
        } else {
             console.warn("[Player] Default ability (ID 1) not found in templates.");
        }
    }

    // --- GAME LOOP LOGIC ---
    
    update(deltaTime) {
        super.update(deltaTime); 
        
        // Update all active abilities (for cooldowns)
        this.abilities.forEach(ability => ability.update(deltaTime));

        if (!this.input.isUIOpen) { 
            this.handleMovement(deltaTime);
            this.handleRotation();
            
            // Check for ability 1 cast (Key '1')
            if (this.input.ability1 && this.abilities.length > 0 && this.abilities[0].isReady()) {
                const ability = this.abilities[0];
                const success = this.useAbility(ability, this.combat.target);
                // If the ability was successfully used, reset the key state to prevent spam
                if (success) {
                    this.input.keysDown[49] = false; 
                }
            }
        }
        
        // Update player's position based on physics (which is updated by the engine)
        this.position.copyFrom(this.mesh.position);

        // Update target highlight position
        if (this.combat.target && !this.combat.target.isDead && this.targetHighlight) {
            this.targetHighlight.position.copyFrom(this.combat.target.mesh.position);
            this.targetHighlight.position.y += 0.05; // Slightly above ground
            this.targetHighlight.isVisible = true;
        } else if (this.targetHighlight) {
            this.targetHighlight.isVisible = false;
        }
        
        if (this.combat.globalCooldown > 0) {
            this.combat.globalCooldown -= deltaTime;
        }
    }
    
    handleMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        let moveVector = BABYLON.Vector3.Zero();
        const speed = this.stats.moveSpeed * (this.input.run ? this.stats.runMultiplier : 1.0);
        
        // Get the direction the camera is facing in the horizontal plane
        const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
        forward.y = 0;
        forward.normalize();

        const right = this.camera.getDirection(BABYLON.Vector3.Right());
        right.y = 0;
        right.normalize();

        if (this.input.forward) {
            moveVector.addInPlace(forward);
        }
        if (this.input.backward) {
            moveVector.subtractInPlace(forward);
        }
        if (this.input.right) {
            moveVector.addInPlace(right);
        }
        if (this.input.left) {
            moveVector.subtractInPlace(right);
        }
        
        if (moveVector.lengthSquared() > 0) {
            moveVector.normalize();
            // Apply impulse force for physics-based movement
            const impulse = moveVector.scale(speed * CONFIG.PLAYER.IMPULSE_STRENGTH);
            this.mesh.physicsImpostor.setLinearVelocity(impulse);
            
            // Player rotation logic is now in handleRotation
        } else {
            // Decelerate the player if no input is given
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            const horizontalVelocity = new BABYLON.Vector3(currentVelocity.x, 0, currentVelocity.z);
            if (horizontalVelocity.lengthSquared() > 0) {
                const dampingForce = horizontalVelocity.scale(-CONFIG.PLAYER.LINEAR_DAMPING * 5); // Increased damping for quick stop
                this.mesh.physicsImpostor.applyForce(dampingForce, this.mesh.position);
            }
        }
        
        // Simple Jump Logic
        if (this.input.jump) {
            // A raycast/check would be needed here to ensure the player is on the ground
            // For now, we allow jumping if vertical velocity is low
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            if (Math.abs(currentVelocity.y) < 0.1) {
                 const jumpImpulse = new BABYLON.Vector3(0, CONFIG.PLAYER.IMPULSE_STRENGTH * CONFIG.PLAYER.JUMP_FORCE, 0);
                 this.mesh.physicsImpostor.applyImpulse(jumpImpulse, this.mesh.position);
            }
        }
    }
    
    handleRotation() {
        if (!this.mesh || !this.visualRoot) return;

        // Get the rotation of the ArcRotateCamera in the Y-axis
        const cameraAlpha = this.camera.alpha;
        
        // Calculate the target rotation for the player's visual root
        // (The visual root is a child of the physics mesh, allowing the physics body to stay upright)
        const targetRotationY = cameraAlpha; 

        // Lerp the visual rotation for smooth turning
        const currentRotationY = this.visualRoot.rotation.y;
        this.visualRoot.rotation.y = BABYLON.Scalar.Lerp(
            currentRotationY, 
            targetRotationY, 
            CONFIG.PLAYER.ROTATION_LERP
        );
        
        // The physics mesh (collider) does not need to rotate for movement, 
        // which prevents weird physics bugs.
    }
    
    // --- COMBAT & INTERACTION ---
    
    setTarget(mesh) {
        if (!mesh || !mesh.metadata || !mesh.metadata.entity) {
            this.combat.target = null;
            this.scene.game.ui.updateTargetInfo(null);
            return;
        }

        this.combat.target = mesh.metadata.entity;
        this.scene.game.ui.updateTargetInfo(this.combat.target);
    }
    
    handleTargeting(mesh) {
        // If we click on a targetable entity
        if (mesh && mesh.metadata && (mesh.metadata.isEnemy || mesh.metadata.isNPC)) {
            this.setTarget(mesh);
        } else {
            // Clicking elsewhere clears the target
            this.setTarget(null);
        }
    }
    
    useAbility(ability, target) {
        // Check Global Cooldown
        if (this.combat.globalCooldown > 0) {
            this.scene.game.ui.showMessage("Global Cooldown", 1000, 'error');
            return false;
        }
        
        // Check specific ability cooldown is handled by isReady() in update loop
        
        // Check Resources (Mana, Stamina)
        // Placeholder resource check
        if (this.mana < ability.resourceCost.mana) {
             this.scene.game.ui.showMessage("Not enough Mana", 1000, 'error');
             return false;
        }
        
        // Cast the ability
        const success = ability.execute(this, target);
        
        if (success) {
            // Spend resources
            this.mana -= ability.resourceCost.mana;
            this.stamina -= ability.resourceCost.stamina;

            // Apply Global Cooldown
            this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN_MS / 1000;
        }
        
        return success;
    }
    
    takeDamage(damage) {
        super.takeDamage(damage); // Calls the Character's base takeDamage
        // Additional player-specific logic (e.g. death screen)
        if (this.isDead) {
            this.scene.game.ui.showMessage("You Died!", 5000, 'death');
            // TODO: Implement respawn logic
        }
    }
    
    // --- PERSISTENCE ---

    getSaveData() {
        return {
            position: this.mesh ? this.mesh.position : this.position, // Use mesh position for physics accuracy
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
        // ... (existing logic)
        this.input.isUIOpen = isUIOpen;
    }
    
    dispose() {
        if (this.camera) {
            this.camera.dispose();
            this.scene.getEngine().exitPointerlock(); // Release mouse lock
        }
        super.dispose();
    }
}
