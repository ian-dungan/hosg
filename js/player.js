// ============================================================
// HEROES OF SHADY GROVE - PLAYER CLASS v1.0.12 (PATCHED)
// Fix: Added physics impostor and implemented movement/rotation.
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
            attackRange: CONFIG.COMBAT.BASE_ATTACK_RANGE // Now safely referenced
        };
        
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
            isUIOpen: false 
        };
        
        this.uiManager = null;
    }

    setUIManager(uiManager) {
        this.uiManager = uiManager;
    }

    // Proactive Fix: Implement physics impostor and placeholder mesh
    async _initMesh() { 
        this.mesh = BABYLON.MeshBuilder.CreateCylinder("playerCollider", { height: this.colliderHeight, diameter: this.colliderRadius * 2 }, this.scene);
        this.mesh.isVisible = false;
        
        // Ensure the mesh is initially positioned
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
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("playerBox", { size: 1.0 }, this.scene);
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9; // offset to stand on the ground
    }

    // Proactive Fix: Implemented movement logic
    handleMovement(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        const body = this.mesh.physicsImpostor;
        const currentVelocity = body.getLinearVelocity();
        const speed = this.stats.moveSpeed * (this.input.run ? this.stats.runMultiplier : 1.0);

        let moveVector = BABYLON.Vector3.Zero();

        // Calculate move direction relative to camera (simplified 3rd person control)
        // Assumes a camera is attached to the scene, providing an 'alpha' (Yaw) value
        const cameraYaw = this.scene.activeCamera.alpha;
        const cameraRotationMatrix = BABYLON.Matrix.RotationY(cameraYaw);
        
        if (this.input.forward) moveVector.addInPlace(new BABYLON.Vector3(0, 0, 1));
        if (this.input.backward) moveVector.addInPlace(new BABYLON.Vector3(0, 0, -1));
        if (this.input.right) moveVector.addInPlace(new BABYLON.Vector3(1, 0, 0));
        if (this.input.left) moveVector.addInPlace(new BABYLON.Vector3(-1, 0, 0));

        if (moveVector.lengthSquared() > 0) {
            moveVector = moveVector.normalize();
            
            // Transform movement from local input space to world space based on camera angle
            moveVector = BABYLON.Vector3.TransformCoordinates(moveVector, cameraRotationMatrix);
            
            // Set horizontal velocity directly for responsive movement
            let newVelocity = moveVector.scale(speed * CONFIG.PLAYER.IMPULSE_STRENGTH); // Scale speed by a large value to overcome friction/damping
            
            // Keep the vertical velocity
            newVelocity.y = currentVelocity.y; 
            
            body.setLinearVelocity(newVelocity);

        } else {
            // Smoothly slow down (damping) when no input is provided
            const dampedX = currentVelocity.x * (1 - CONFIG.PLAYER.LINEAR_DAMPING);
            const dampedZ = currentVelocity.z * (1 - CONFIG.PLAYER.LINEAR_DAMPING);
            body.setLinearVelocity(new BABYLON.Vector3(dampedX, currentVelocity.y, dampedZ));
        }
        
        // Handle Jump
        if (this.input.jump) {
             // Simple ground check: check if vertical velocity is near zero
             if (Math.abs(currentVelocity.y) < 0.1) {
                 // Apply an impulse to jump
                 body.applyImpulse(new BABYLON.Vector3(0, CONFIG.PLAYER.IMPULSE_STRENGTH * CONFIG.PLAYER.JUMP_FORCE, 0), this.mesh.getAbsolutePosition());
             }
             this.input.jump = false; 
        }

        // Update the position property after physics step
        this.position.copyFrom(this.mesh.position);
    }
    
    // Proactive Fix: Implemented rotation logic
    handleRotation() {
        if (!this.mesh || !this.visualRoot || !this.mesh.physicsImpostor) return;

        const body = this.mesh.physicsImpostor;
        const linearVelocity = body.getLinearVelocity();
        
        // Check for significant horizontal movement before rotating
        const horizontalVelocity = Math.sqrt(linearVelocity.x * linearVelocity.x + linearVelocity.z * linearVelocity.z);
        
        if (horizontalVelocity > 0.1) {
            // Calculate the angle of the current horizontal velocity
            const targetRotation = Math.atan2(linearVelocity.x, linearVelocity.z);

            // Smooth rotation (Lerp)
            const currentRotation = this.visualRoot.rotation.y;
            
            let diff = targetRotation - currentRotation;
            // Handle angle wrap-around
            if (diff > Math.PI) diff -= 2 * Math.PI;
            if (diff < -Math.PI) diff += 2 * Math.PI;

            const lerpedRotation = currentRotation + diff * CONFIG.PLAYER.ROTATION_LERP;
            
            this.visualRoot.rotation.y = lerpedRotation;
            this.visualRoot.rotation.x = 0; // Prevent tilting
            this.visualRoot.rotation.z = 0; // Prevent tilting
        }
    }
    
    // Placeholder methods (re-added for completeness, though movement is now implemented)
    _initCamera() {} 
    _initInput() {} 
    setTarget(mesh) {} 
    takeDamage(damage) {}
    useAbility(ability, target) {}
    _initTargetHighlight() {}
    // ... (rest of the class)
    
    // ... (rest of the class)

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
                // Simplified auto-attack: find the first available attack ability
                const autoAttackAbility = this.abilities.find(a => a.type === 'attack');
                if (autoAttackAbility && autoAttackAbility.isReady()) {
                    autoAttackAbility.execute(this, target);
                    this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN_MS / 1000;
                }
            }
        }
    }
    
    // ... (rest of methods)
}
