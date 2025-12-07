// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.13 (PATCHED)
// Fix: Added physics impostor, movement, rotation, and camera initialization.
// ============================================================

class Player extends Character {
    constructor(scene) {
        // Character constructor needs to be called first
        super(scene, new BABYLON.Vector3(0, CONFIG.PLAYER.SPAWN_HEIGHT, 0), 'Player');
        
        this.isPlayer = true; 
        this.colliderHeight = 1.8;
        this.colliderRadius = 0.4;

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
        
        this.inventory = new Inventory(this); 
        this.equipment = new Equipment(this); 
        this.abilities = []; // Abilities will be loaded in game.js
        
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            run: false,
            jump: false,
            isUIOpen: false 
        };
        
        this.uiManager = null;
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    // Fix: Implemented physics impostor and mesh
    async _initMesh() { 
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: this.colliderHeight, diameter: this.colliderRadius * 2 }, this.scene);
        this.mesh.isVisible = false;
        this.mesh.checkCollisions = true;

        this.mesh.position.copyFrom(this.position);

        // Create the physics impostor
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh, 
            BABYLON.PhysicsImpostor.CylinderImpostor, 
            { 
                mass: CONFIG.PLAYER.MASS, 
                friction: CONFIG.PLAYER.FRICTION, 
                restitution: 0.0, 
                linearDamping: CONFIG.PLAYER.LINEAR_DAMPING 
            }, 
            this.scene
        );
        
        this.visualRoot = new BABYLON.TransformNode("playerVisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder visible mesh (Box for now)
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { height: 1.8, width: 0.8, depth: 0.8 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // offset to stand on the ground
    }

    // Fix: Implemented camera setup
    _initCamera() {
        const camera = new BABYLON.ArcRotateCamera("ArcRotateCamera", -Math.PI / 2, Math.PI / 3, 10, this.mesh.position, this.scene);
        camera.attachControl(this.scene.getEngine().getCanvas(), true);
        camera.upperRadiusLimit = 20;
        camera.lowerRadiusLimit = 3;
        camera.wheelPrecision = 50;
        camera.target = this.mesh.position; 
        this.scene.activeCamera = camera;
    } 

    // Stub: Input logic will be in UIManager, so this is just a placeholder
    _initInput() {}
    
    // Fix: Implemented movement logic
    handleMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        const body = this.mesh.physicsImpostor;
        const currentVelocity = body.getLinearVelocity();
        const speed = this.stats.moveSpeed * (this.input.run ? this.stats.runMultiplier : 1.0);

        let moveVector = BABYLON.Vector3.Zero();
        const camera = this.scene.activeCamera;
        if (!camera) return;
        
        const cameraYaw = camera.alpha || 0; 
        const cameraRotationMatrix = BABYLON.Matrix.RotationY(cameraYaw);
        
        if (this.input.forward) moveVector.addInPlace(new BABYLON.Vector3(0, 0, 1));
        if (this.input.backward) moveVector.addInPlace(new BABYLON.Vector3(0, 0, -1));
        if (this.input.right) moveVector.addInPlace(new BABYLON.Vector3(1, 0, 0));
        if (this.input.left) moveVector.addInPlace(new BABYLON.Vector3(-1, 0, 0));

        if (moveVector.lengthSquared() > 0) {
            moveVector = moveVector.normalize();
            moveVector = BABYLON.Vector3.TransformCoordinates(moveVector, cameraRotationMatrix);
            
            let newVelocity = moveVector.scale(speed * CONFIG.PLAYER.IMPULSE_STRENGTH); 
            
            newVelocity.y = currentVelocity.y; 
            
            body.setLinearVelocity(newVelocity);

        } else {
            // Apply damping when no input
            const dampingFactor = 1 - (CONFIG.PLAYER.LINEAR_DAMPING * deltaTime * 60); 
            const dampedX = currentVelocity.x * dampingFactor;
            const dampedZ = currentVelocity.z * dampingFactor;
            body.setLinearVelocity(new BABYLON.Vector3(dampedX, currentVelocity.y, dampedZ));
        }
        
        // Handle Jump
        if (this.input.jump) {
             if (Math.abs(currentVelocity.y) < 0.1) {
                 body.applyImpulse(new BABYLON.Vector3(0, CONFIG.PLAYER.IMPULSE_STRENGTH * CONFIG.PLAYER.JUMP_FORCE, 0), this.mesh.getAbsolutePosition());
             }
             this.input.jump = false; 
        }

        this.position.copyFrom(this.mesh.position);
    }
    
    // Fix: Implemented rotation logic
    handleRotation() {
        if (!this.mesh || !this.visualRoot || !this.mesh.physicsImpostor) return;

        const body = this.mesh.physicsImpostor;
        const linearVelocity = body.getLinearVelocity();
        
        const horizontalVelocity = Math.sqrt(linearVelocity.x * linearVelocity.x + linearVelocity.z * linearVelocity.z);
        
        if (horizontalVelocity > 0.1) {
            const targetRotation = Math.atan2(linearVelocity.x, linearVelocity.z);
            const currentRotation = this.visualRoot.rotation.y;
            
            let diff = targetRotation - currentRotation;
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;

            const lerpedRotation = currentRotation + diff * CONFIG.PLAYER.ROTATION_LERP;
            
            this.visualRoot.rotation.y = lerpedRotation;
        }
    }
    
    // ... (rest of methods)
    
    // Stub implementation
    handleTargeting(mesh) {
        if (!mesh || !mesh.metadata) return;
        
        if (mesh.metadata.isEnemy || mesh.metadata.isNPC) {
            this.setTarget(mesh.metadata.entity); // Assume Entity class stores itself in metadata
        }
    }
    
    // Simple setter for now
    setTarget(entity) {
        this.combat.target = entity;
        // Logic to update highlight/UI would go here
    }

    takeDamage(damage) {
        this.health -= damage;
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.uiManager.showMessage("You died!", 5000, 'error');
            // Dispose mesh and potentially respawn logic here
            this.dispose(); 
        }
    }

    getSaveData() {
        return {
            position: this.position,
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
        if (isUIOpen) {
            this.input.forward = this.input.backward = this.input.left = this.input.right = false;
        }
        this.input.isUIOpen = isUIOpen;
    }

    update(deltaTime) {
        super.update(deltaTime); 
        
        this.abilities.forEach(ability => ability.update(deltaTime));

        if (!this.input.isUIOpen) { 
            this.handleMovement(deltaTime);
            this.handleRotation();
        }
        
        if (this.combat.globalCooldown > 0) {
            this.combat.globalCooldown -= deltaTime;
        }
        
        // Auto Attack logic (simple: if target is in range and GCD is down, auto-attack)
        const target = this.combat.target;
        if (target && !target.isDead && BABYLON.Vector3.Distance(this.mesh.position, target.mesh.position) < this.combat.attackRange) {
            if (this.combat.globalCooldown <= 0) {
                // Find the first available attack ability
                const autoAttackAbility = this.abilities.find(a => a.type === 'attack');
                if (autoAttackAbility && autoAttackAbility.isReady()) {
                    autoAttackAbility.execute(this, target);
                    this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN_MS / 1000;
                }
            }
        }
    }
}
