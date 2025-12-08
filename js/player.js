// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.30 (INITIALIZATION FIX)
// Fix: Ensured 'abilities', 'inventory', and 'equipment' are always initialized to safe values.
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
        
        // CRITICAL FIX: Ensure these are always initialized to prevent crashes in other modules (like ui.js)
        this.abilities = []; 
        this.inventory = null; 
        this.equipment = null; 

        // Inventory and Abilities (Requires item.js and ability.js to load first)
        if (typeof Inventory !== 'undefined' && typeof Equipment !== 'undefined' && typeof Ability !== 'undefined') {
            this.inventory = new Inventory(this);
            this.equipment = new Equipment(this);
            // Abilities will be loaded/initialized in loadSaveData or applyClass
        } else {
            console.warn('[Player] Inventory, Equipment, or Ability classes not found. Inventory/Abilities disabled.');
        }

        this.camera = null; 
        this.visualRoot = null; 
        this.colliderHeight = 2; // For physics impostor

        this._initCollision(playerConfig.MASS || 1, playerConfig.FRICTION || 0.5);
        this._initMesh(this.className); // Uses this.className which is null, will use placeholder
        this._initCamera();
        this._initTargetHighlight();

        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        
        this.scene.onPointerDown = this.handlePointerDown.bind(this);
        
        console.log(`[Player] State loaded. Character: ${this.className}, Health: ${this.health}`);
    }
    
    // --- Initialization Methods ---

    _initMesh(className) {
        // Find the model asset key. Defaults to 'knight' if class config is missing or null.
        const modelAssetKey = (CONFIG.CLASSES && CONFIG.CLASSES[className]) 
            ? CONFIG.CLASSES[className].model 
            : 'knight';
        
        // AssetManager is attached to the scene, so we assume it exists if the game started.
        const assetManager = this.scene.game.assetManager;
        const assets = assetManager ? assetManager.assets : null;

        // The key for the loaded asset is typically CATEGORY_key
        const visualAssetKey = `CHARACTERS_${modelAssetKey}`; 
        
        let visualAsset = assets ? assets[visualAssetKey] : null;

        if (visualAsset && visualAsset[0]) {
            // Use the loaded asset
            this.visualRoot = visualAsset[0].clone(this.name, null);
            this.visualRoot.setParent(this.mesh);
            this.visualRoot.position.y = -this.colliderHeight / 2; // Position visual mesh correctly
            this.visualRoot.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
        } else {
            // Placeholder mesh if asset not found
            console.warn(`[Player] "${modelAssetKey}" model not found. Using simple placeholder mesh.`);
            this.visualRoot = BABYLON.MeshBuilder.CreateSphere("placeholder", { diameter: 1 }, this.scene);
            this.visualRoot.setParent(this.mesh);
            this.visualRoot.position.y = 0;
            this.visualRoot.material = new BABYLON.StandardMaterial("playerMat", this.scene);
            this.visualRoot.material.diffuseColor = BABYLON.Color3.Blue();
        }
    }

    _initCollision(mass, friction) {
        // Create an invisible collision mesh (Cylinder)
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: this.colliderHeight, diameter: 1 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false; // Keep the collider invisible

        if (this.scene.isPhysicsEnabled) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.CylinderImpostor, 
                { mass: mass, restitution: 0.1, friction: friction }, 
                this.scene
            );
            
            // Lock rotation
            if (this.mesh.physicsImpostor.setAngularFactor) {
                this.mesh.physicsImpostor.setAngularFactor(BABYLON.Vector3.Zero());
            } else {
                console.warn('[Player] Physics impostor ready, but setAngularFactor is missing or failed to initialize correctly. Rotation may occur.');
            }
        }
    }

    _initCamera() {
        const C = typeof CONFIG === 'undefined' ? {} : CONFIG;
        const cameraConfig = C.CAMERA || {};

        this.camera = new BABYLON.FollowCamera("playerCamera", 
            new BABYLON.Vector3(0, cameraConfig.HEIGHT || 10, cameraConfig.DISTANCE || -10), 
            this.scene);
            
        this.camera.radius = cameraConfig.RADIUS || 15; // How far back the camera is from the target
        this.camera.heightOffset = cameraConfig.HEIGHT || 8; // How high above the target the camera is
        this.camera.rotationOffset = cameraConfig.ROTATION_OFFSET || 0;
        this.camera.cameraAcceleration = cameraConfig.ACCELERATION || 0.05;
        this.camera.maxCameraSpeed = cameraConfig.MAX_SPEED || 20;

        // IMPORTANT: Attach the camera to the player's collision mesh
        this.camera.lockedTarget = this.mesh; 

        // Attach controls to the canvas
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        
        console.log('[Player] Camera initialized.');
    }
    
    // --- Input and Logic ---

    handleKeyDown(evt) {
        // ... (input handling logic remains the same) ...
        switch (evt.key.toLowerCase()) {
            case 'w': this.input.forward = true; break;
            case 's': this.input.backward = true; break;
            case 'a': this.input.left = true; break;
            case 'd': this.input.right = true; break;
            
            case '1': this.input.action1 = true; break;
            case '2': this.input.action2 = true; break;
            case '3': this.input.action3 = true; break;
            case '4': this.input.action4 = true; break;
        }
    }

    handleKeyUp(evt) {
        // ... (input handling logic remains the same) ...
        switch (evt.key.toLowerCase()) {
            case 'w': this.input.forward = false; break;
            case 's': this.input.backward = false; break;
            case 'a': this.input.left = false; break;
            case 'd': this.input.right = false; break;
            
            case '1': this.input.action1 = false; break;
            case '2': this.input.action2 = false; break;
            case '3': this.input.action3 = false; break;
            case '4': this.input.action4 = false; break;
        }
    }
    
    handlePointerDown(evt, pickInfo) {
        if (pickInfo.hit && pickInfo.pickedMesh) {
            const pickedEntity = pickInfo.pickedMesh.parent ? pickInfo.pickedMesh.parent.metadata : pickInfo.pickedMesh.metadata;
            
            if (pickedEntity && pickedEntity.isAttackable) {
                this.setTarget(pickedEntity);
            } else {
                this.setTarget(null);
            }
        } else {
            this.setTarget(null);
        }
    }

    processInput() {
        // ... (movement logic remains the same) ...
        let movementVector = BABYLON.Vector3.Zero();
        const speed = this.stats.moveSpeed;

        if (this.input.forward) movementVector.z += speed;
        if (this.input.backward) movementVector.z -= speed;
        if (this.input.left) movementVector.x -= speed;
        if (this.input.right) movementVector.x += speed;

        this.isMoving = movementVector.length() > 0;

        if (this.isMoving) {
            // Apply movement direction relative to camera rotation
            const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
            const right = this.camera.getDirection(BABYLON.Vector3.Right());

            const moveDirection = forward.scale(movementVector.z).add(right.scale(movementVector.x));
            moveDirection.y = 0; // Keep movement horizontal

            // Apply force to physics impostor
            if (this.mesh.physicsImpostor) {
                const linearVelocity = moveDirection.scale(100); 
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(linearVelocity.x, this.mesh.physicsImpostor.getLinearVelocity().y, linearVelocity.z));
            } else {
                // Non-physics movement fallback
                this.mesh.position.addInPlace(moveDirection);
            }
            
            // Visual rotation (Look in direction of movement)
            this.visualRoot.rotation.y = Math.atan2(moveDirection.x, moveDirection.z);
        } else {
            // Stop movement when no input is pressed
            if (this.mesh.physicsImpostor) {
                const currentYVelocity = this.mesh.physicsImpostor.getLinearVelocity().y;
                this.mesh.physicsImpostor.setLinearVelocity(new BABYLON.Vector3(0, currentYVelocity, 0));
            }
        }
        
        // Process Abilities/Combat
        if (this.input.action1) {
            this.startAttack();
        } 
        
        if (this.abilities && this.input.action2) {
            this.attemptAbility(this.abilities[0]); // Use first ability
        }
    }
    
    processAbilities(deltaTime) {
        // Update ability cooldowns
        if (this.abilities) {
            this.abilities.forEach(ability => ability.update(deltaTime));
        }
    }
    
    // --- Combat and Abilities ---
    
    setTarget(entity) {
        if (this.target === entity) return;
        
        // Remove highlight from old target
        if (this.target && this.target._toggleHighlight) {
            this.target._toggleHighlight(false);
        }
        
        this.target = entity;
        this.combat.target = entity;
        
        // Add highlight to new target and update UI
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
        
        if (distance <= this.stats.attackRange) {
            // Melee attack
            const damage = this.stats.attackPower * (Math.random() * 0.4 + 0.8); // Random damage multiplier
            this.combat.target.takeDamage(damage, this);
            
            // Display feedback
            this.scene.game.ui.showMessage(`You hit ${this.combat.target.name} for ${damage.toFixed(0)}!`, 1500, 'playerDamage');
            
            // Reset cooldown
            this.combat.attackTimer = this.stats.attackCooldown;
        } else {
            this.scene.game.ui.showMessage('Target is out of range.', 1500, 'info');
        }
    }
    
    attemptAbility(ability) {
        if (!ability || !ability.isReady()) return;
        
        // Execute the ability (handles costs, effects, and cooldown start)
        ability.execute(this, this.combat.target);
    }

    // --- Update Loop ---

    update(deltaTime) {
        super.update(deltaTime); // Update base entity position (syncs mesh position to this.position)
        this.processInput();
        this.processCombat(deltaTime);
        this.processAbilities(deltaTime); // Update cooldowns
        this._updateCameraPosition();
    }

    processCombat(deltaTime) {
        if (this.combat.attackTimer > 0) {
            this.combat.attackTimer -= deltaTime;
        }
        
        // If target died, clear target
        if (this.combat.target && this.combat.target.isDead) {
            this.setTarget(null);
        }
    }
    
    // --- Persistence ---
    
    getSaveData() {
        // CRITICAL: Ensure inventory and equipment are checked before calling getSaveData
        const inventoryData = this.inventory ? this.inventory.getSaveData() : [];
        const equipmentData = this.equipment ? this.equipment.getSaveData() : [];
        
        return {
            health: this.health,
            mana: this.mana,
            stamina: this.stamina,
            stats: this.stats, // Contains max stats and current base stats
            className: this.className,
            // Only save the IDs of the abilities the player has
            abilities: this.abilities.map(ability => ability.id), 
            inventory: inventoryData,
            equipment: equipmentData
        };
    }
    
    async loadSaveData(data, itemTemplates, skillTemplates) {
        if (!data) {
            console.log('[Player] No save data found.');
            return;
        }
        
        this.health = data.health || this.stats.maxHealth;
        this.mana = data.mana || this.stats.maxMana;
        this.stamina = data.stamina || this.stats.maxStamina;
        this.className = data.className || 'Warrior';
        
        // Load stats, overriding defaults
        Object.assign(this.stats, data.stats);
        
        // Inventory and Equipment Load
        if (this.inventory && this.equipment) {
            this.inventory.load(data.inventory, itemTemplates);
            this.equipment.load(data.equipment, itemTemplates);
        }
        
        // Abilities Load
        if (data.abilities && skillTemplates && typeof Ability !== 'undefined') {
            this.abilities = data.abilities
                .map(abilityId => {
                    const template = skillTemplates.get(abilityId);
                    return template ? new Ability(template) : null;
                })
                .filter(ability => ability !== null);
        } else {
            console.warn('[Player] Abilities not loaded from save. Applying class default.');
            // Fallback: Apply default class abilities if data.abilities is missing
            this.applyClass(this.className);
        }
        
        console.log('[Player] State loaded from save.');
    }
    
    // Placeholder: This is called by Game.loadGameData when no save state is found
    applyClass(className) {
        this.className = className;
        const classConfig = CONFIG.CLASSES[className];
        if (classConfig) {
            // Update base stats from the config
            Object.assign(this.stats, classConfig.stats);
            this.health = this.stats.maxHealth;
            this.mana = this.stats.maxMana;
            this.stamina = this.stats.maxStamina;
            
            // Add default ability for this class
            if (typeof Ability !== 'undefined' && classConfig.defaultAbility) {
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
        
        // Dispose camera control
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
    }

    _updateCameraPosition() {
        // Sync the camera target to the player's collision mesh position
        if (this.camera) {
            this.camera.target.copyFrom(this.mesh.position);
        }
    }
}
// Ensure the Player class is globally accessible
window.Player = Player;
