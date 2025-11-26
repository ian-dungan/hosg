class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.velocity = new BABYLON.Vector3();
        this.isOnGround = false;
        this.moveSpeed = 0.1;
        this.jumpForce = 0.5;
        this.health = 100;
        this.maxHealth = 100;
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            run: false
        };
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
        console.log('Player initialized');
    }

    createPlayerMesh() {
        // Create a simple capsule for the player
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 1.8,
            radius: 0.3
        }, this.scene);
        
        // Create a simple material
        const material = new BABYLON.StandardMaterial('playerMat', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2); // Red color
        material.specularColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        this.mesh.material = material;
        
        // Position the player
        this.mesh.position.y = 2;
        this.mesh.checkCollisions = true;
        
        // Add physics
        if (this.scene.isPhysicsEnabled()) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh,
                BABYLON.PhysicsImpostor.CapsuleImpostor,
                { mass: 1, friction: 0.2, restitution: 0.1 },
                this.scene
            );
        }
    }

    setupCamera() {
        this.camera = this.scene.activeCamera;
        if (!this.camera) {
            this.camera = new BABYLON.UniversalCamera(
                'playerCamera',
                new BABYLON.Vector3(0, 1.6, -5),
                this.scene
            );
            this.scene.activeCamera = this.camera;
        }
        
        // Make camera follow the player
        if (this.camera instanceof BABYLON.UniversalCamera) {
            this.camera.parent = this.mesh;
            this.camera.position = new BABYLON.Vector3(0, 1.6, -5);
        }
    }

    setupInput() {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        
        // Keyboard input
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || key === 'arrowup') this.input.forward = true;
            if (key === 's' || key === 'arrowdown') this.input.backward = true;
            if (key === 'a' || key === 'arrowleft') this.input.left = true;
            if (key === 'd' || key === 'arrowright') this.input.right = true;
            if (key === ' ') this.input.jump = true;
            if (key === 'shift') this.input.run = true;
        });

        window.addEventListener('keyup', (e) => {
            const key = e.key.toLowerCase();
            if (key === 'w' || key === 'arrowup') this.input.forward = false;
            if (key === 's' || key === 'arrowdown') this.input.backward = false;
            if (key === 'a' || key === 'arrowleft') this.input.left = false;
            if (key === 'd' || key === 'arrowright') this.input.right = false;
            if (key === ' ') this.input.jump = false;
            if (key === 'shift') this.input.run = false;
        });

        // Lock pointer on click
        canvas.addEventListener('click', () => {
            if (document.pointerLockElement !== canvas) {
                canvas.requestPointerLock = canvas.requestPointerLock || 
                                          canvas.mozRequestPointerLock || 
                                          canvas.webkitRequestPointerLock;
                if (canvas.requestPointerLock) {
                    canvas.requestPointerLock();
                }
            }
        });
    }

    update(deltaTime) {
        if (!this.mesh) return;

        // Get camera direction
        let forward = new BABYLON.Vector3(0, 0, 1);
        let right = new BABYLON.Vector3(1, 0, 0);
        
        if (this.camera) {
            forward = this.camera.getForwardRay().direction;
            right = this.camera.getRightRay().direction;
            forward.y = 0;
            right.y = 0;
            forward.normalize();
            right.normalize();
        }

        // Calculate movement
        const moveDirection = new BABYLON.Vector3(0, 0, 0);
        if (this.input.forward) moveDirection.addInPlace(forward);
        if (this.input.backward) moveDirection.subtractInPlace(forward);
        if (this.input.left) moveDirection.subtractInPlace(right);
        if (this.input.right) moveDirection.addInPlace(right);

        // Apply movement
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            const speed = this.input.run ? this.moveSpeed * 1.8 : this.moveSpeed;
            moveDirection.scaleInPlace(speed * deltaTime * 60);
            
            if (this.mesh.physicsImpostor) {
                const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                this.mesh.physicsImpostor.setLinearVelocity(
                    new BABYLON.Vector3(
                        moveDirection.x * 10,
                        currentVelocity ? currentVelocity.y : 0,
                        moveDirection.z * 10
                    )
                );
            } else {
                // Fallback if physics is not enabled
                this.mesh.moveWithCollisions(moveDirection);
            }
        }

        // Handle jumping
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
    }

    jump() {
        if (this.isOnGround && this.mesh) {
            if (this.mesh.physicsImpostor) {
                const velocity = this.mesh.physicsImpostor.getLinearVelocity();
                this.mesh.physicsImpostor.setLinearVelocity(
                    new BABYLON.Vector3(velocity.x, this.jumpForce * 10, velocity.z)
                );
            } else {
                // Simple jump without physics
                this.mesh.position.y += 0.5;
            }
            this.isOnGround = false;
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        console.log(`Player took ${amount} damage. Health: ${this.health}`);
        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.log('Player died');
        // Reset player position
        if (this.mesh) {
            this.mesh.position = new BABYLON.Vector3(0, 5, 0);
            this.health = this.maxHealth;
        }
    }

    dispose() {
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.camera && this.camera !== this.scene.activeCamera) {
            this.camera.dispose();
            this.camera = null;
        }
    }
}
