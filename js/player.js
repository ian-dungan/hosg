// ===========================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.1.0 (FIXED)
// Fixes: Proper initialization order, deferred camera setup, improved controls
// ===========================================================

if (typeof Character === 'undefined') {
    throw new Error('[Player] Character base class not found. Ensure world.js loads first.');
}

class Player extends Character {
    constructor(scene, position, className = 'Warrior') {
        super(scene, position, 'Player');
        this.isPlayer = true;
        this.className = className;
        this.camera = null;
        this.controls = { up: false, down: false, left: false, right: false, space: false };
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED || 0.15; 
        this.isJumping = false;
        this.cameraInitialized = false;

        this.applyClass(this.className);
        this._initInput();
        this._initTargetHighlight();

        console.log(`[Player] Player class '${this.className}' initialized.`);
    }

    // Initialize camera - called AFTER world is created
    initCamera(worldCamera) {
        if (worldCamera) {
            this.camera = worldCamera;
            this.camera.target = this.mesh ? this.mesh.position : this.position;
            if (this.mesh) {
                this.camera.target.y += 1.5;
            }
            this.cameraInitialized = true;
            console.log('[Player] Camera linked to player');
        }
    }

    applyClass(className, optionalConfig = null) {
        this.className = className;
        let classConfig = optionalConfig || this._getClassConfig(className);
        
        if (classConfig) {
            this.stats = { ...this.stats, ...classConfig.stats };
            this.health = this.stats.maxHealth;
            this.mana = this.stats.maxMana;
            this.stamina = this.stats.maxStamina;

            this._initMesh(classConfig.model);

            // Add default ability if available
            if (classConfig.defaultAbility) {
                // Defer ability loading if templates aren't loaded yet
                setTimeout(() => {
                    if (this.scene.game && this.scene.game.skillTemplates) {
                        const template = this.scene.game.skillTemplates.get(classConfig.defaultAbility);
                        if (template) {
                            this.addAbility(classConfig.defaultAbility, template);
                        }
                    }
                }, 100);
            }
        } else {
            console.error(`[Player] FATAL: Class config not found for: ${className}`);
            this.stats = { maxHealth: 100, maxMana: 50, maxStamina: 100, attackPower: 10, magicPower: 5, moveSpeed: 0.15 };
            this.health = this.stats.maxHealth;
        }
    }

    _initMesh(modelAssetKey) {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }

        if (!this.scene.game || !this.scene.game.assetManager) {
             console.error('[Player] game.assetManager is not initialized. Cannot load mesh.');
             return;
        }

        const meshes = this.scene.game.assetManager.getAsset(modelAssetKey);

        if (meshes && meshes.length > 0) {
            this.mesh = meshes[0].clone(this.name + "Mesh");
            this.mesh.position.copyFrom(this.position);
            this.mesh.scaling.setAll(1.5); 
            this.mesh.checkCollisions = true;
            
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { mass: 1, restitution: 0.1, friction: 0.5 },
                this.scene
            );

            if (meshes[0].skeleton) {
                this.mesh.skeleton = meshes[0].skeleton.clone();
            }

            this.mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
            this.mesh.physicsImpostor.registerBeforePhysics(() => this._lockRotation());

            console.log(`[Player] Mesh initialized with model: ${modelAssetKey}`);
        } else {
            // Fallback sphere
            this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name + "Mesh", { diameter: 2 }, this.scene);
            this.mesh.position.copyFrom(this.position);
            
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.SphereImpostor,
                { mass: 1, restitution: 0.1, friction: 0.5 },
                this.scene
            );
            
            const mat = new BABYLON.StandardMaterial("fallbackMat", this.scene);
            mat.diffuseColor = new BABYLON.Color3(0, 0.5, 1);
            this.mesh.material = mat;
            console.warn(`[Player] Failed to load asset key: ${modelAssetKey}. Using fallback sphere.`);
        }
    }
    
    _lockRotation() {
        if (this.mesh && this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
        }
    }

    _initInput() {
        this.handleKeyDown = (evt) => {
            switch (evt.key.toLowerCase()) {
                case 'w': this.controls.up = true; break;
                case 's': this.controls.down = true; break;
                case 'a': this.controls.left = true; break;
                case 'd': this.controls.right = true; break;
                case ' ': 
                    this.controls.space = true;
                    if (!this.isJumping) {
                        this.jump();
                    }
                    break;
                case '1': this.executeAbilityInSlot(1); break;
                case '2': this.executeAbilityInSlot(2); break;
                case '3': this.executeAbilityInSlot(3); break;
                case '4': this.executeAbilityInSlot(4); break;
                case '5': this.executeAbilityInSlot(5); break;
            }
        };

        this.handleKeyUp = (evt) => {
            switch (evt.key.toLowerCase()) {
                case 'w': this.controls.up = false; break;
                case 's': this.controls.down = false; break;
                case 'a': this.controls.left = false; break;
                case 'd': this.controls.right = false; break;
                case ' ': this.controls.space = false; break;
            }
        };
        
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        
        // Mouse click for targeting
        this.scene.onPointerDown = (evt, pickResult) => {
            if (evt.button === 0 && pickResult.hit && pickResult.pickedMesh) {
                // Find if clicked mesh belongs to an NPC
                if (this.scene.game && this.scene.game.world) {
                    const targetEntity = this.scene.game.world.npcs.find(
                        npc => npc.mesh === pickResult.pickedMesh || 
                               (npc.mesh && npc.mesh.getChildMeshes && npc.mesh.getChildMeshes().includes(pickResult.pickedMesh))
                    );
                    
                    if (targetEntity) {
                        this.target = targetEntity;
                        if (this.scene.game.ui) {
                            this.scene.game.ui.setTarget(this.target);
                        }
                        console.log(`[Player] Target selected: ${this.target.name}`);
                    }
                }
            }
        };
    }
    
    jump() {
        if (!this.mesh || !this.mesh.physicsImpostor || this.isJumping) return;
        
        const velocity = this.mesh.physicsImpostor.getLinearVelocity();
        velocity.y = 5; // Jump force
        this.mesh.physicsImpostor.setLinearVelocity(velocity);
        this.isJumping = true;
        
        // Reset jump flag after a delay
        setTimeout(() => {
            this.isJumping = false;
        }, 500);
    }
    
    update(deltaTime) {
        if (this.isDead) return;
        
        super.update(deltaTime); 

        this._updateMovement(deltaTime);
        this._updateCameraPosition();
        
        // Check if target is still valid
        if (this.target && (this.target.isDead || !this.target.mesh)) {
            this.target = null;
            if (this.scene.game && this.scene.game.ui) {
                this.scene.game.ui.setTarget(null);
            }
        }
    }

    _updateMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        let velocity = this.mesh.physicsImpostor.getLinearVelocity();
        let moveVector = new BABYLON.Vector3(0, 0, 0);

        // Only move if camera is initialized
        if (this.cameraInitialized && this.camera) {
            const cameraForward = this.camera.getDirection(BABYLON.Vector3.Forward());
            cameraForward.y = 0; 
            cameraForward.normalize();
            
            const cameraRight = BABYLON.Vector3.Cross(BABYLON.Vector3.Up(), cameraForward);

            if (this.controls.up) moveVector.addInPlace(cameraForward);
            if (this.controls.down) moveVector.subtractInPlace(cameraForward);
            if (this.controls.right) moveVector.addInPlace(cameraRight);
            if (this.controls.left) moveVector.subtractInPlace(cameraRight);
            
            if (moveVector.lengthSquared() > 0) {
                moveVector.normalize().scaleInPlace(this.stats.moveSpeed);
                velocity.x = moveVector.x * (1 / deltaTime);
                velocity.z = moveVector.z * (1 / deltaTime);
                
                // Face movement direction
                const angle = Math.atan2(-moveVector.x, -moveVector.z);
                this.mesh.rotation.y = angle;
            } else {
                velocity.x = 0;
                velocity.z = 0;
            }
        } else {
            velocity.x = 0;
            velocity.z = 0;
        }

        this.mesh.physicsImpostor.setLinearVelocity(velocity);
    }
    
    executeAbilityInSlot(slotIndex) {
        const abilityArray = Array.from(this.abilities.values());
        const ability = abilityArray[slotIndex - 1]; 
        
        if (ability) {
            if (ability.isReady()) {
                // Check resource costs
                const cost = ability.resourceCost || {};
                if ((cost.mana || 0) > this.mana || (cost.stamina || 0) > this.stamina) {
                    if (this.scene.game && this.scene.game.ui) {
                        this.scene.game.ui.showMessage(`Not enough resources for ${ability.name}!`, 1000, 'error');
                    }
                    return;
                }
                
                // Deduct costs
                this.mana -= (cost.mana || 0);
                this.stamina -= (cost.stamina || 0);
                
                // Execute ability
                const requiresTarget = ability.effectData && ability.effectData.requiresTarget;
                const targetToUse = requiresTarget ? this.target : this;
                
                const success = ability.execute(this, targetToUse);
                if (success && this.scene.game && this.scene.game.ui) {
                    this.scene.game.ui.update(this);
                }
            } else {
                if (this.scene.game && this.scene.game.ui) {
                    this.scene.game.ui.showMessage(`[${ability.name}] is on cooldown!`, 1000, 'error');
                }
            }
        } else {
            if (this.scene.game && this.scene.game.ui) {
                this.scene.game.ui.showMessage(`Ability slot ${slotIndex} is empty.`, 1000, 'info');
            }
        }
    }

    _getClassConfig(className) {
        if (typeof CONFIG !== 'undefined' && CONFIG.ASSETS && CONFIG.ASSETS.CLASSES) {
            return CONFIG.ASSETS.CLASSES[className] || this._getFallbackClassConfig(className);
        } else {
            console.warn(`[Player] CONFIG.ASSETS.CLASSES unavailable. Using minimal fallback.`);
            return this._getFallbackClassConfig(className);
        }
    }

    _getFallbackClassConfig(className) {
        if (className !== 'Warrior') return null;

        return {
            model: 'knight',
            stats: {
                maxHealth: 100, maxMana: 50, maxStamina: 100, 
                attackPower: 10, magicPower: 5, moveSpeed: 0.15
            },
            defaultAbility: 'Cleave'
        };
    }

    _initTargetHighlight() { 
        // TODO: Add visual target highlighting
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.dispose();
            }
            this.mesh.dispose();
            this.mesh = null;
        }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = null; 
        
        if (this.camera) {
            this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
        }
        super.dispose(); 
    }

    _updateCameraPosition() {
        if (this.cameraInitialized && this.camera && this.mesh) {
            this.camera.target.copyFrom(this.mesh.position);
            this.camera.target.y += 1.5; 
        }
    }
}
window.Player = Player;
