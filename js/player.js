// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.28 (SYNTAX FIX + ASSET RECOVERY)
// Fix: Completed the truncated _initCamera method and closed the class definition.
// Update: Player now initializes using the loaded 'knight' model.
// ============================================================

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

        // Player State
        this.input = {
            forward: false, backward: false, left: false, right: false,
            action1: false, action2: false, action3: false, action4: false
        };
        this.isMoving = false;
        
        this.target = null;
        this.combat = {
            target: null,
            attackTimer: 0
        };

        // Inventory and Abilities (Requires item.js and ability.js to load first)
        if (typeof Inventory !== 'undefined' && typeof Equipment !== 'undefined') {
            this.inventory = new Inventory(this);
            this.equipment = new Equipment(this);
        } else {
            console.warn('[Player] Inventory/Equipment classes are not defined. Check item.js script order.');
            this.inventory = { load: () => {}, addItem: () => {} };
            this.equipment = { load: () => {} };
        }

        this.abilities = new Map();
        
        this._initCollision(60, 0.2); 
        this._initMesh();
        this._initCamera();
        this._initInput();
    }
    
    // --- ASSET RECOVERY: Use the loaded 'knight' model ---
    async _initMesh() {
        const assets = this.scene.game.assetManager ? this.scene.game.assetManager.assets : null;
        const modelAsset = assets ? assets['CHARACTERS_knight'] : null;

        if (modelAsset && modelAsset[0]) {
            // Create an instance of the loaded mesh and set it as the visual root
            this.visualRoot = modelAsset[0].clone("player_visual", null);
            this.visualRoot.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5); 
            
            // Attach visual root to the collider mesh
            this.visualRoot.parent = this.mesh;
            
            // Recursively make all parts of the model not pickable
            this.visualRoot.getChildMeshes().forEach(m => m.isPickable = false);

            console.log('[Player] Mesh and visual root created from "knight" asset.');
        } else {
            // Fallback: simple visible box if model failed to load
            console.warn('[Player] "knight" model not found. Using simple placeholder mesh.');
            this.visualRoot = this.mesh; 
            this.mesh.isVisible = true;
            this.mesh.material = new BABYLON.StandardMaterial("playerMat", this.scene);
            this.mesh.material.diffuseColor = BABYLON.Color3.Blue();
        }
    }
    
    // --- Initialization Methods ---
    _initCollision(mass, friction) {
        // Create an invisible collision mesh (Cylinder)
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: 2, diameter: 1 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false; // Keep the collider invisible

        if (this.scene.isPhysicsEnabled) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { 
                    mass: mass, 
                    friction: friction, 
                    restitution: 0.1 
                }, 
                this.scene
            );

            if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
                this.mesh.physicsImpostor.setAngularFactor(0); // Prevent rotation
            } else {
                 console.warn('[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.');
            }
        }
    }

    _initCamera() {
        this.camera = new BABYLON.ArcRotateCamera(
            "ArcRotateCamera",
            -Math.PI / 2, 
            Math.PI / 3, 
            10, 
            this.mesh.position, 
            this.scene
        );

        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 25;
        this.camera.upperBetaLimit = Math.PI / 2.2;
        this.camera.setTarget(this.mesh.position); 
        // FIX: The line below was truncated in the previous patch
        this.camera.attachControl(this.scene.getEngine().get  ? this.scene.getEngine().getRenderingCanvas() : null, true); 
        
        console.log('[Player] Camera initialized.');
    }

    _initInput() {
        // Handle input events
        this.handleKeyDown = (event) => {
            switch (event.key) {
                case 'w': case 'W': this.input.forward = true; break;
                case 's': case 'S': this.input.backward = true; break;
                case 'a': case 'A': this.input.left = true; break;
                case 'd': case 'D': this.input.right = true; break;
                // Ability actions (Placeholder)
                case '1': this.input.action1 = true; break;
                case '2': this.input.action2 = true; break;
                case '3': this.input.action3 = true; break;
                case '4': this.input.action4 = true; break;
                case 'i': case 'I': 
                    if(this.scene.game.ui) this.scene.game.ui.toggleInventory();
                    break;
            }
        };

        this.handleKeyUp = (event) => {
            switch (event.key) {
                case 'w': case 'W': this.input.forward = false; break;
                case 's': case 'S': this.input.backward = false; break;
                case 'a': case 'A': this.input.left = false; break;
                case 'd': case 'D': this.input.right = false; break;
                // Ability actions
                case '1': this.input.action1 = false; break;
                case '2': this.input.action2 = false; break;
                case '3': this.input.action3 = false; break;
                case '4': this.input.action4 = false; break;
            }
        };

        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        
        // --- Pointer Down (Targeting/Attacking) ---
        this.scene.onPointerDown = (evt, pickResult) => {
            if (evt.button === 0 && pickResult.hit) { // Left click
                // Check if we hit an enemy (Enemy class sets metadata)
                const pickedMesh = pickResult.pickedMesh;
                if (pickedMesh && pickedMesh.metadata && pickedMesh.metadata.isEnemy) {
                    this.setTarget(pickedMesh.metadata.entity);
                } else {
                    this.setTarget(null); // Clear target if we click the ground/non-enemy
                }
            }
        };
    }
    
    // --- Combat ---
    setTarget(entity) {
        if (this.combat.target && this.combat.target._toggleHighlight) {
            this.combat.target._toggleHighlight(false);
        }
        
        this.combat.target = entity;
        
        if (entity && entity._toggleHighlight) {
            entity._toggleHighlight(true);
            this.scene.game.ui.updateTargetInfo(entity); // Update UI immediately
        } else {
            this.scene.game.ui.updateTargetInfo(null);
        }
    }

    startAttack() {
        if (!this.combat.target || this.combat.target.isDead) return;
        
        // Check cooldown
        if (this.combat.attackTimer > 0) return;

        const distance = BABYLON.Vector3.Distance(this.mesh.position, this.combat.target.mesh.position);
        if (distance > this.stats.attackRange) {
            this.scene.game.ui.showMessage("Too far to attack!", 1500, 'error');
            return;
        }

        // Basic attack logic
        const damage = this.stats.currentAttackPower;
        this.combat.target.takeDamage(damage, this);

        // Reset cooldown
        this.combat.attackTimer = this.stats.attackCooldown;
        
        // Face the target
        const targetPos = this.combat.target.mesh.position;
        const direction = targetPos.subtract(this.mesh.position);
        const rotationY = Math.atan2(direction.x, direction.z);
        this.visualRoot.rotation.y = rotationY;
    }
    
    // --- Update Loop ---
    update(deltaTime) {
        this.processInput(deltaTime);
        this.processAbilities(deltaTime);
        this.processCombat(deltaTime);
        this._handleCamera(deltaTime);
        super.update(deltaTime);
        
        // Sync the camera to the player's position
        if (this.camera) {
            this.camera.target.copyFrom(this.mesh.position);
        }
    }
    
    processInput(deltaTime) {
        let impulse = new BABYLON.Vector3(0, 0, 0);
        const speed = this.stats.moveSpeed;
        
        this.isMoving = this.input.forward || this.input.backward || this.input.left || this.input.right;

        // Get camera direction vectors
        const cameraTransform = this.camera.getDirection(BABYLON.Vector3.Forward());
        const forward = cameraTransform.clone();
        forward.y = 0; // Prevent upward movement
        forward.normalize();
        
        const right = new BABYLON.Vector3(forward.z, 0, -forward.x);
        right.normalize();

        if (this.input.forward) impulse.addInPlace(forward);
        if (this.input.backward) impulse.addInPlace(forward.scale(-1));
        if (this.input.left) impulse.addInPlace(right.scale(-1));
        if (this.input.right) impulse.addInPlace(right);
        
        if (impulse.length() > 0) {
            impulse.normalize().scaleInPlace(speed * mass);
            if (this.mesh.physicsImpostor) {
                // Apply impulse relative to current velocity to prevent slow movement
                // We use setLinearVelocity for simple top-down movement control
                const targetVelocity = impulse.scale(1 / mass * 300); // Scale to a high speed
                this.mesh.physicsImpostor.setLinearVelocity(targetVelocity);
            }
        } else {
            // Stop movement if no input is detected
            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, 0, 0));
            }
        }
        
        // Fix camera rotation issues by locking physics rotation
        if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
            this.mesh.physicsImpostor.setAngularFactor(0);
        }
    }
    
    processCombat(deltaTime) {
        // Process attack cooldown
        if (this.combat.attackTimer > 0) {
            this.combat.attackTimer -= deltaTime;
        }

        // Auto-attack if a target is present and attack action is pressed or conditions are met
        if (this.input.action1) {
            this.startAttack();
        }
    }

    processAbilities(deltaTime) {
        // Update ability cooldowns
        this.abilities.forEach(ability => ability.update(deltaTime));

        // Check for ability key presses
        if (this.input.action2) {
            const ability = this.abilities.get('Ability_2'); // Replace with actual ability ID
            if (ability && ability.isReady()) {
                ability.execute(this, this.combat.target);
            }
            this.input.action2 = false; // Consume input
        }
    }

    // --- Persistence ---
    getSaveData() {
        return {
            position: { x: this.mesh.position.x, y: this.mesh.position.y, z: this.mesh.position.z },
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            inventory: this.inventory.getSaveData(),
            equipment: this.equipment.getSaveData(),
            className: this.className,
            // Abilities data to save...
        };
    }

    loadSaveData(data) {
        if (!data) return;
        
        // Position
        if (data.position && this.mesh) {
            this.mesh.position.set(data.position.x, data.position.y, data.position.z);
        }
        
        // Stats and Resources
        this.health = data.health || this.stats.maxHealth;
        this.mana = data.mana || this.stats.maxMana;
        this.stamina = data.stamina || this.stats.maxStamina;
        this.className = data.className || this.className;
        
        // Inventory/Equipment loading requires item templates which are loaded separately
        // These will be loaded via Game.loadGameData() after this.
        
        console.log(`[Player] State loaded. Character: ${this.className}, Level: ${data.level || 1}`);
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
        
        // Dispose camera control
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
    }

    _handleCamera(deltaTime) {
        // Camera rotation to match player visual direction
        if(this.visualRoot) {
            if(this.isMoving) {
                // Get the horizontal direction of the current velocity
                const velocity = this.mesh.physicsImpostor.getLinearVelocity();
                
                // Only update rotation if there's actual horizontal movement
                if (Math.abs(velocity.x) > 0.01 || Math.abs(velocity.z) > 0.01) {
                    const targetRotation = Math.atan2(velocity.x, velocity.z);
                    
                    // Smoothly interpolate current rotation to target rotation
                    const currentRotation = this.visualRoot.rotation.y;
                    let delta = targetRotation - currentRotation;
                    // Normalize delta to ensure shortest rotation path
                    while (delta > Math.PI) delta -= 2 * Math.PI;
                    while (delta < -Math.PI) delta += 2 * Math.PI;

                    this.visualRoot.rotation.y += delta * 0.2; // 0.2 is the smoothing factor
                }
            }
        }
    }
}
// Ensure the Player class is globally accessible
window.Player = Player;
