// player.js - Enhanced player with better controls and model

class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.health = CONFIG.PLAYER.START_HEALTH;
        this.mana = CONFIG.PLAYER.START_MANA;
        this.position = new BABYLON.Vector3(0, 5, 0);
        this.velocity = new BABYLON.Vector3(0, 0, 0);
        this.isJumping = false;
        this.isRunning = false;
        this.moveDirection = new BABYLON.Vector3(0, 0, 0);
        this.inputMap = {};
        
        // Setup input
        this.setupInput();
    }

    async loadModel() {
        // Create a simple player model
        const playerMaterial = new BABYLON.StandardMaterial("playerMaterial", this.scene);
        playerMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Red color
        playerMaterial.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        
        // Create a capsule shape for the player
        const sphere = BABYLON.MeshBuilder.CreateSphere("playerBody", {
            diameter: 1
        }, this.scene);
        
        const cylinder = BABYLON.MeshBuilder.CreateCylinder("playerCylinder", {
            height: 1,
            diameter: 1
        }, this.scene);
        cylinder.position.y = 0.5;
        
        // Merge meshes
        this.mesh = BABYLON.Mesh.MergeMeshes([sphere, cylinder], true);
        this.mesh.material = playerMaterial;
        this.mesh.position = this.position;
        this.mesh.checkCollisions = true;
        
        // Add physics
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.CylinderImpostor,
            { mass: 1, friction: 0.5, restitution: 0.1 },
            this.scene
        );
        
        // Add to shadow caster
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.addShadowCaster(this.mesh);
        }
        
        // Add a simple animation
        this.scene.registerBeforeRender(() => {
            if (this.mesh && this.moveDirection.length() > 0) {
                this.mesh.rotation.y = Math.atan2(
                    this.moveDirection.x,
                    this.moveDirection.z
                );
            }
        });
    }

    setupInput() {
        // Keyboard input
        this.scene.onKeyboardObservable.add((kbInfo) => {
            if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN) {
                this.inputMap[kbInfo.event.key.toLowerCase()] = kbInfo.type === BABYLON.KeyboardEventTypes.KEYDOWN;
                
                // Toggle run with Shift
                if (kbInfo.event.key === 'Shift') {
                    this.isRunning = true;
                }
                
                // Jump with Space
                if (kbInfo.event.key === ' ' && !this.isJumping) {
                    this.jump();
                }
            } else if (kbInfo.type === BABYLON.KeyboardEventTypes.KEYUP) {
                this.inputMap[kbInfo.event.key.toLowerCase()] = false;
                
                if (kbInfo.event.key === 'Shift') {
                    this.isRunning = false;
                }
            }
        });
    }

    update(deltaTime) {
        if (!this.mesh) return;
        
        // Reset movement
        this.moveDirection.set(0, 0, 0);
        
        // Get camera forward and right vectors
        const camera = this.scene.activeCamera;
        const forward = camera.getForwardRay().direction;
        const right = camera.getDirection(BABYLON.Vector3.Right());
        
        // Flatten vectors
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();
        
        // Movement based on input
        if (this.inputMap['w'] || this.inputMap['arrowup']) {
            this.moveDirection.addInPlace(forward);
        }
        if (this.inputMap['s'] || this.inputMap['arrowdown']) {
            this.moveDirection.subtractInPlace(forward);
        }
        if (this.inputMap['a'] || this.inputMap['arrowleft']) {
            this.moveDirection.subtractInPlace(right);
        }
        if (this.inputMap['d'] || this.inputMap['arrowright']) {
            this.moveDirection.addInPlace(right);
        }
        
        // Normalize and apply speed
        if (this.moveDirection.length() > 0) {
            this.moveDirection.normalize();
            const speed = this.isRunning ? 
                CONFIG.PLAYER.MOVEMENT_SPEED * CONFIG.PLAYER.RUN_MULTIPLIER : 
                CONFIG.PLAYER.MOVEMENT_SPEED;
            
            this.moveDirection.scaleInPlace(speed * deltaTime);
            
            // Apply movement
            if (this.mesh.physicsImpostor) {
                const velocity = this.mesh.physicsImpostor.getLinearVelocity();
                velocity.x = this.moveDirection.x;
                velocity.z = this.moveDirection.z;
                this.mesh.physicsImpostor.setLinearVelocity(velocity);
            } else {
                this.mesh.position.addInPlace(this.moveDirection);
            }
        }
        
        // Update position reference
        this.position.copyFrom(this.mesh.position);
    }

    jump() {
        if (!this.isJumping && this.mesh.physicsImpostor) {
            this.isJumping = true;
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            velocity.y = CONFIG.PLAYER.JUMP_FORCE;
            this.mesh.physicsImpostor.setLinearVelocity(velocity);
            
            // Reset jump after a short delay
            setTimeout(() => {
                this.isJumping = false;
            }, 1000);
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        return this.health > 0;
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
    }
}

// Make Player globally available
window.Player = Player;
