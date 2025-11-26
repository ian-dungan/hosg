class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.velocity = new BABYLON.Vector3();
        this.isOnGround = false;
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        this.health = CONFIG.PLAYER.HEALTH;
        this.maxHealth = CONFIG.PLAYER.HEALTH;
        this.inventory = null;
        this.currentWeapon = null;
        this.weapons = [];
        this.animations = {};
        this.currentAnimation = null;
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            run: false
        };
        
        // Physics initialization flag
        this.physicsReady = false;
        
        // Initialize player
        this.init();
    }

    async init() {
        try {
            // Create player mesh
            this.createPlayerMesh();
            
            // Setup camera
            this.setupCamera();
            
            // Setup animations
            this.setupAnimations();
            
            // Setup input
            this.setupInput();
            
            // Mark physics as ready after a short delay to ensure everything is initialized
            setTimeout(() => {
                this.physicsReady = true;
            }, 100);
            
            console.log('Player initialized');
        } catch (error) {
            console.error('Error initializing player:', error);
        }
    }

    // ... [Previous methods remain the same until updateMovement] ...

    update(deltaTime) {
        if (!this.mesh || !this.camera || !this.physicsReady) {
            return; // Skip update if required components aren't ready
        }
        
        // Update movement
        this.updateMovement(deltaTime);
        
        // Update animations
        this.updateAnimations();
        
        // Update camera position to follow player
        this.updateCamera();
    }

    updateMovement(deltaTime) {
        // Check if we have a valid physics impostor
        if (!this.capsule || !this.capsule.physicsImpostor) {
            return; // Skip physics updates if not ready
        }

        try {
            // Get camera forward and right vectors
            const forward = this.camera.getDirection(BABYLON.Vector3.Forward());
            const right = this.camera.getDirection(BABYLON.Vector3.Right());
            
            // Project onto XZ plane
            forward.y = 0;
            right.y = 0;
            forward.normalize();
            right.normalize();
            
            // Calculate movement direction
            const moveDirection = new BABYLON.Vector3(0, 0, 0);
            
            if (this.input.forward) moveDirection.addInPlace(forward);
            if (this.input.backward) moveDirection.subtractInPlace(forward);
            if (this.input.left) moveDirection.subtractInPlace(right);
            if (this.input.right) moveDirection.addInPlace(right);
            
            // Get current velocity safely
            let currentVelocity;
            try {
                currentVelocity = this.capsule.physicsImpostor.getLinearVelocity();
                if (!currentVelocity) {
                    currentVelocity = BABYLON.Vector3.Zero();
                }
            } catch (e) {
                currentVelocity = BABYLON.Vector3.Zero();
            }
            
            // If we have movement input
            if (moveDirection.lengthSquared() > 0) {
                moveDirection.normalize();
                
                // Apply movement speed
                const speed = this.input.run ? this.moveSpeed * 1.8 : this.moveSpeed;
                moveDirection.scaleInPlace(speed * deltaTime * 60);
                
                // Calculate target velocity
                const targetVelocity = new BABYLON.Vector3(
                    moveDirection.x * 10,
                    currentVelocity ? currentVelocity.y : 0,
                    moveDirection.z * 10
                );
                
                // Apply damping for better control
                const damping = 0.9;
                const newVelocity = new BABYLON.Vector3(
                    targetVelocity.x * (1 - damping) + (currentVelocity ? currentVelocity.x * damping : 0),
                    targetVelocity.y,
                    targetVelocity.z * (1 - damping) + (currentVelocity ? currentVelocity.z * damping : 0)
                );
                
                // Safely set velocity
                if (this.capsule && this.capsule.physicsImpostor) {
                    this.capsule.physicsImpostor.setLinearVelocity(newVelocity);
                }
                
                // Update animation based on movement
                this.playAnimation(this.input.run ? 'run' : 'walk');
            } else {
                // Apply damping when not moving
                if (currentVelocity && this.capsule && this.capsule.physicsImpostor) {
                    const damping = 0.8;
                    const newVelocity = new BABYLON.Vector3(
                        currentVelocity.x * damping,
                        currentVelocity.y,
                        currentVelocity.z * damping
                    );
                    this.capsule.physicsImpostor.setLinearVelocity(newVelocity);
                }
                
                // Play idle animation when not moving
                if (this.currentAnimation !== this.animations.idle) {
                    this.playAnimation('idle');
                }
            }
            
            // Handle jumping
            if (this.input.jump && this.isOnGround) {
                this.jump();
            }
            
            // Update ground check
            this.updateGroundCheck();
            
        } catch (error) {
            console.error('Error in updateMovement:', error);
        }
    }

    jump() {
        if (this.isOnGround && this.capsule && this.capsule.physicsImpostor) {
            try {
                const currentVelocity = this.capsule.physicsImpostor.getLinearVelocity() || BABYLON.Vector3.Zero();
                this.capsule.physicsImpostor.setLinearVelocity(
                    new BABYLON.Vector3(
                        currentVelocity.x,
                        this.jumpForce * 10,
                        currentVelocity.z
                    )
                );
                this.isOnGround = false;
                this.playAnimation('jump');
            } catch (e) {
                console.error('Error in jump:', e);
            }
        }
    }

    // ... [Rest of the methods remain the same] ...

    dispose() {
        // Clean up resources
        this.physicsReady = false;
        
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        
        if (this.camera) {
            this.camera.dispose();
            this.camera = null;
        }
        
        if (this.inventory) {
            this.inventory.dispose();
            this.inventory = null;
        }
        
        // Dispose animations
        if (this.animations) {
            Object.values(this.animations).forEach(anim => {
                if (anim && typeof anim.dispose === 'function') {
                    anim.dispose();
                }
            });
            this.animations = {};
        }
        
        // Remove event listeners
        const canvas = this.scene ? this.scene.getEngine().getRenderingCanvas() : null;
        if (canvas) {
            canvas.removeEventListener('mousedown', this.onMouseDown);
            canvas.removeEventListener('mousemove', this.onMouseMove);
        }
        
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
    }
}

// Make Player class globally available
window.Player = Player;
