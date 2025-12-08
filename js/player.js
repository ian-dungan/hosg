// ===========================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.33 (INHERITANCE FIX)
// Fix: Removed unnecessary Entity/Character fallbacks, now relies on world.js.
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
        this.controls = { up: false, down: false, left: false, right: false };
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED || 0.15; 

        this.applyClass(this.className);
        this._initCamera();
        this._initInput();
        this._initTargetHighlight();

        console.log(`[Player] Player class '${this.className}' initialized.`);
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

            if (classConfig.defaultAbility && typeof game !== 'undefined' && game.skillTemplates) {
                const template = game.skillTemplates.get(classConfig.defaultAbility);
                this.addAbility(classConfig.defaultAbility, template);
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

        if (typeof game === 'undefined' || !game.assetManager) {
             console.error('[Player] game.assetManager is not initialized. Cannot load mesh.');
             return;
        }

        const meshes = game.assetManager.getAsset(modelAssetKey);

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
            this.mesh.physicsImpostor.registerBeforePhysics(this._lockRotation);

            console.log(`[Player] Mesh initialized with model: ${modelAssetKey}`);
        } else {
            this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name + "Mesh", { diameter: 2 }, this.scene);
            const mat = new BABYLON.StandardMaterial("fallbackMat", this.scene);
            mat.diffuseColor = new BABYLON.Color3(1, 0, 0);
            this.mesh.material = mat;
            console.warn(`[Player] Failed to load asset key: ${modelAssetKey}. Using fallback sphere.`);
        }
    }
    
    _lockRotation = () => {
        if (this.mesh && this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
        }
    }

    _initCamera() {
        if (typeof game !== 'undefined' && game.world && game.world.camera) {
            this.camera = game.world.camera;
            this.camera.target = this.mesh || new BABYLON.Vector3(0, 5, 0); 
            this.camera.target.y += 1.5; 
        }
    }

    _initInput() {
        this.handleKeyDown = (evt) => {
            switch (evt.key.toLowerCase()) {
                case 'w': this.controls.up = true; break;
                case 's': this.controls.down = true; break;
                case 'a': this.controls.left = true; break;
                case 'd': this.controls.right = true; break;
                case '1': this.executeAbilityInSlot(1); break;
                case '2': this.executeAbilityInSlot(2); break;
            }
        };

        this.handleKeyUp = (evt) => {
            switch (evt.key.toLowerCase()) {
                case 'w': this.controls.up = false; break;
                case 's': this.controls.down = false; break;
                case 'a': this.controls.left = false; break;
                case 'd': this.controls.right = false; break;
            }
        };
        
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        
        this.scene.onPointerDown = (evt, pickResult) => {
            if (pickResult.hit && pickResult.pickedMesh) {
                const targetEntity = this.scene.game.world.npcs.find(npc => npc.mesh === pickResult.pickedMesh);
                if (targetEntity) {
                    this.target = targetEntity;
                    this.scene.game.ui.setTarget(this.target);
                    console.log(`[Player] Target selected: ${this.target.name}`);
                }
            }
        };
    }
    
    update(deltaTime) {
        super.update(deltaTime); 

        this._updateMovement(deltaTime);
        this._updateCameraPosition();
    }

    _updateMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        let velocity = this.mesh.physicsImpostor.getLinearVelocity();
        let moveVector = new BABYLON.Vector3(0, 0, 0);

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
            
            const angle = Math.atan2(-moveVector.x, -moveVector.z);
            this.mesh.rotation.y = angle;
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
                const success = ability.execute(this, this.target);
                if (success && this.scene.game && this.scene.game.ui) {
                    this.scene.game.ui.update(this);
                }
            } else {
                 this.scene.game.ui.showMessage(`[${ability.name}] is on cooldown!`, 1000, 'error');
            }
        } else {
            this.scene.game.ui.showMessage(`Ability slot ${slotIndex} is empty.`, 1000, 'info');
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
        if (className !== 'Warrior' && className !== 'Wolf') return null; 

        if (className === 'Warrior') return {
            model: 'knight',
            stats: {
                maxHealth: 100, maxMana: 50, maxStamina: 100, attackPower: 10, magicPower: 5, moveSpeed: 0.15
            },
            defaultAbility: 'Cleave'
        };
        
        if (className === 'Wolf') return {
             model: 'wolf',
             stats: {
                maxHealth: 30, maxMana: 0, maxStamina: 50, attackPower: 5, magicPower: 0, moveSpeed: 0.18
            },
            defaultAbility: 'Bite' 
        }
    }

    _initTargetHighlight() { }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        this.scene.onPointerDown = null; 
        
        if(this.camera) this.camera.detachControl(this.scene.getEngine().getRenderingCanvas());
        super.dispose(); 
    }

    _updateCameraPosition() {
        if (this.camera && this.mesh) {
            this.camera.target.copyFrom(this.mesh.position);
            this.camera.target.y += 1.5; 
        }
    }
}
window.Player = Player;
