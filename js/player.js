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
            
            console.log('Player initialized');
        } catch (error) {
            console.error('Error initializing player:', error);
        }
    }

    createPlayerMesh() {
        // Create capsule for player collision
        const capsule = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 1.8,
            radius: 0.3,
            subdivisions: 8,
            tessellation: 16
        }, this.scene);
        
        // Position capsule
        capsule.position.y = 2;
        
        // Create player material
        const material = new BABYLON.StandardMaterial('playerMaterial', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.8, 0.6, 0.4);
        material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        
        // Apply material
        capsule.material = material;
        
        // Enable physics
        capsule.checkCollisions = true;
        capsule.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
        capsule.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
        
        // Add physics impostor
        capsule.physicsImpostor = new BABYLON.PhysicsImpostor(
            capsule,
            BABYLON.PhysicsImpostor.CapsuleImpostor,
            { 
                mass: 1,
                friction: 0.2,
                restitution: 0.1
            },
            this.scene
        );
        
        // Add player mesh to shadow generator
        if (this.scene.shadowGenerator) {
            this.scene.shadowGenerator.getShadowMap().renderList.push(capsule);
        }
        
        // Create a root node for the player
        const rootNode = new BABYLON.TransformNode('playerRoot');
        capsule.parent = rootNode;
        
        // Store references
        this.mesh = rootNode;
        this.capsule = capsule;
        
        // Create a simple head for first-person view
        this.createHead();
    }

    createHead() {
        // Create head mesh (only visible in first-person view)
        this.head = BABYLON.MeshBuilder.CreateSphere('head', {
            diameter: 0.5
        }, this.scene);
        
        // Position head (aligned with camera in first-person)
        this.head.position.y = 0.3;
        this.head.parent = this.mesh;
        this.head.isVisible = false; // Only visible in first-person view
        
        // Create eye position (where the camera will be)
        this.eyePosition = new BABYLON.TransformNode('eyePosition');
        this.eyePosition.position.y = 1.6; // Eye level
        this.eyePosition.parent = this.mesh;
    }

    setupCamera() {
        // Create camera
        this.camera = new BABYLON.FollowCamera(
            'playerCamera',
            new BABYLON.Vector3(0, 0, -10),
            this.scene,
            this.mesh
        );
        
        // Configure camera
        this.camera.radius = 5; // Distance from target
        this.camera.heightOffset = 1.6; // Eye level
        this.camera.rotationOffset = 0;
        this.camera.cameraAcceleration = 0.1;
        this.camera.maxCameraSpeed = 10;
        this.camera.noRotationConstraint = false;
        
        // Set camera limits
        this.camera.upperHeightLimit = 2.0;
        this.camera.lowerHeightLimit = 1.0;
        this.camera.upperRotationOffset = 1.5; // Max look up
        this.camera.lowerRotationOffset = -1.5; // Max look down
        this.camera.upperRadiusLimit = 8;
        this.camera.lowerRadiusLimit = 2;
        
        // Attach camera to scene
        this.scene.activeCamera = this.camera;
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), false);
        
        // Lock pointer on click
        const canvas = this.scene.getEngine().getRenderingCanvas();
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock = canvas.requestPointerLock || 
                                       canvas.mozRequestPointerLock || 
                                       canvas.webkitRequestPointerLock;
            if (canvas.requestPointerLock) {
                canvas.requestPointerLock();
            }
        });
    }

    setupAnimations() {
        // Create animation groups
        this.animations = {
            idle: this.createAnimation('idle', 0, 30, true, 1.0),
            walk: this.createAnimation('walk', 40, 70, true, 1.5),
            run: this.createAnimation('run', 80, 110, true, 1.8),
            jump: this.createAnimation('jump', 120, 140, false, 1.2),
            attack: this.createAnimation('attack', 160, 190, false, 1.5)
        };
        
        // Set initial animation
        this.playAnimation('idle');
    }

    createAnimation(name, from, to, loop, speed) {
        // Create animation group
        const animationGroup = new BABYLON.AnimationGroup(name, this.scene);
        
        // Create animation for the capsule
        const animation = new BABYLON.Animation(
            `${name}_anim`,
            'position.y',
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Create keyframes
        const keyFrames = [];
        for (let i = from; i <= to; i++) {
            keyFrames.push({
                frame: i - from,
                value: Math.sin((i - from) * 0.1) * 0.05
            });
        }
        
        // Set keyframes
        animation.setKeys(keyFrames);
        
        // Add animation to the capsule
        this.capsule.animations = [animation];
        
        // Add animation to the group
        animationGroup.addTargetedAnimation(animation, this.capsule);
        
        // Configure animation group
        animationGroup.speedRatio = speed;
        animationGroup.loopAnimation = loop;
        
        return animationGroup;
    }

    playAnimation(name) {
        // Stop current animation if playing
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }
        
        // Play new animation
        if (this.animations[name]) {
            this.animations[name].play();
            this.currentAnimation = this.animations[name];
        }
    }

    setupInput() {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        
        // Keyboard input
        window.addEventListener('keydown', (e) => {
            switch(e.key.toLowerCase()) {
                case 'w':
                case 'arrowup':
                    this.input.forward = true;
                    break;
                case 's':
                case 'arrowdown':
                    this.input.backward = true;
                    break;
                case 'a':
                case 'arrowleft':
                    this.input.left = true;
                    break;
                case 'd':
                case 'arrowright':
                    this.input.right = true;
                    break;
                case ' ':
                    this.input.jump = true;
                    break;
                case 'shift':
                    this.input.run = true;
                    break;
                case 'e':
                    // Interact
                    this.interact();
                    break;
                case '1':
                case '2':
                case '3':
                case '4':
                case '5':
                    // Switch weapon
                    const weaponIndex = parseInt(e.key) - 1;
                    if (weaponIndex < this.weapons.length) {
                        this.equipWeapon(weaponIndex);
                    }
                    break;
            }
        });
        
        window.addEventListener('keyup', (e) => {
            switch(e.key.toLowerCase()) {
                case 'w':
                case 'arrowup':
                    this.input.forward = false;
                    break;
                case 's':
                case 'arrowdown':
                    this.input.backward = false;
                    break;
                case 'a':
                case 'arrowleft':
                    this.input.left = false;
                    break;
                case 'd':
                case 'arrowright':
                    this.input.right = false;
                    break;
                case ' ':
                    this.input.jump = false;
                    break;
                case 'shift':
                    this.input.run = false;
                    break;
            }
        });
        
        // Mouse input
        canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0) { // Left click
                this.attack();
            } else if (e.button === 2) { // Right click
                this.aim();
            }
        });
        
        // Mouse move for looking around
        canvas.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                const sensitivity = 0.002;
                this.camera.cameraRotation.y -= e.movementX * sensitivity;
                this.camera.cameraRotation.x -= e.movementY * sensitivity;
                
                // Clamp vertical rotation
                this.camera.cameraRotation.x = Math.max(
                    -Math.PI / 2.5,
                    Math.min(Math.PI / 3, this.camera.cameraRotation.x)
                );
            }
        });
    }

    update(deltaTime) {
        if (!this.mesh || !this.camera || !this.capsule || !this.capsule.physicsImpostor) {
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
        
        if (this.input.forward) {
            moveDirection.addInPlace(forward);
        }
        if (this.input.backward) {
            moveDirection.subtractInPlace(forward);
        }
        if (this.input.left) {
            moveDirection.subtractInPlace(right);
        }
        if (this.input.right) {
            moveDirection.addInPlace(right);
        }
        
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
        
        // Normalize and apply speed
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            
            // Apply movement speed
            const speed = this.input.run ? this.moveSpeed * 1.8 : this.moveSpeed;
            moveDirection.scaleInPlace(speed * deltaTime * 60);
            
            // Apply movement to physics body
            const targetVelocity = new BABYLON.Vector3(
                moveDirection.x * 10,
                currentVelocity.y,
                moveDirection.z * 10
            );
            
            // Apply damping for better control
            const damping = 0.9;
            this.capsule.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    targetVelocity.x * (1 - damping) + currentVelocity.x * damping,
                    targetVelocity.y,
                    targetVelocity.z * (1 - damping) + currentVelocity.z * damping
                )
            );
            
            // Update animation based on movement
            if (this.input.run) {
                this.playAnimation('run');
            } else {
                this.playAnimation('walk');
            }
        } else {
            // Apply damping when not moving
            const damping = 0.8;
            this.capsule.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    currentVelocity.x * damping,
                    currentVelocity.y,
                    currentVelocity.z * damping
                )
            );
            
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
    }

    updateGroundCheck() {
        // Cast a ray downward to check for ground
        const ray = new BABYLON.Ray(
            this.mesh.position.add(new BABYLON.Vector3(0, 0.5, 0)),
            new BABYLON.Vector3(0, -1, 0),
            0.6
        );
        
        const hit = this.scene.pickWithRay(ray);
        this.isOnGround = hit.hit && hit.distance < 0.6;
    }

    updateAnimations() {
        // Update animation based on movement state
        if (this.isOnGround) {
            const velocity = this.velocity.length();
            if (velocity > 0.1) {
                if (this.input.run) {
                    this.playAnimation('run');
                } else {
                    this.playAnimation('walk');
                }
            } else {
                this.playAnimation('idle');
            }
        } else {
            this.playAnimation('jump');
        }
    }

    updateCamera() {
        if (!this.mesh || !this.camera) return;
        
        // Update camera target to follow player
        this.camera.target = this.mesh.position.clone();
        
        // Apply camera shake if active
        if (this.cameraShake) {
            const time = Date.now() * 0.001;
            const shakeIntensity = this.shakeIntensity || 0.1;
            this.camera.position.addInPlace(new BABYLON.Vector3(
                Math.sin(time * 20) * shakeIntensity,
                Math.sin(time * 17) * shakeIntensity,
                0
            ));
            
            // Decrease shake over time
            this.shakeTime -= this.scene.getEngine().getDeltaTime() / 1000;
            if (this.shakeTime <= 0) {
                this.cameraShake = false;
            }
        }
    }

    jump() {
        if (this.isOnGround && this.capsule && this.capsule.physicsImpostor) {
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
        }
    }

    attack() {
        if (this.currentWeapon) {
            this.currentWeapon.attack();
        } else {
            // Play punch animation if no weapon equipped
            this.playAnimation('attack');
            
            // Check for melee hit
            this.checkMeleeHit();
        }
    }

    checkMeleeHit() {
        if (!this.camera) return;
        
        // Create a ray from the camera in the look direction
        const ray = new BABYLON.Ray(
            this.camera.position,
            this.camera.getDirection(BABYLON.Vector3.Forward()),
            2 // Max melee distance
        );
        
        // Cast the ray
        const hit = this.scene.pickWithRay(ray);
        
        if (hit.pickedMesh && hit.distance < 2) {
            // Check if we hit something that can take damage
            if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.takeDamage) {
                hit.pickedMesh.metadata.takeDamage(10); // Base damage
            }
        }
    }

    aim() {
        // Implement aiming logic
        console.log('Aiming...');
    }

    interact() {
        if (!this.camera) return;
        
        // Cast a ray to check for interactable objects
        const ray = new BABYLON.Ray(
            this.camera.position,
            this.camera.getDirection(BABYLON.Vector3.Forward()),
            3 // Max interaction distance
        );
        
        const hit = this.scene.pickWithRay(ray);
        
        if (hit.pickedMesh && hit.distance < 3) {
            // Check if the object is interactable
            if (hit.pickedMesh.metadata && hit.pickedMesh.metadata.onInteract) {
                hit.pickedMesh.metadata.onInteract(this);
            }
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        
        // Update UI
        if (this.scene.ui) {
            this.scene.ui.updateHealth(this.health, this.maxHealth);
        }
        
        // Apply camera shake
        this.applyCameraShake(0.3);
        
        // Check for death
        if (this.health <= 0) {
            this.die();
        }
    }

    heal(amount) {
        this.health = Math.min(this.health + amount, this.maxHealth);
        
        // Update UI
        if (this.scene.ui) {
            this.scene.ui.updateHealth(this.health, this.maxHealth);
        }
    }

    die() {
        console.log('Player died');
        // Handle player death
        if (this.scene.ui) {
            this.scene.ui.showMessage('You died!', 'error');
        }
        
        // Reset player position or show game over screen
        this.respawn();
    }

    respawn() {
        // Reset health
        this.health = this.maxHealth;
        
        // Reset position
        if (this.mesh) {
            this.mesh.position.set(0, 2, 0);
        }
        
        // Reset camera
        if (this.camera) {
            this.camera.rotation.set(0, 0, 0);
        }
        
        // Update UI
        if (this.scene.ui) {
            this.scene.ui.updateHealth(this.health, this.maxHealth);
        }
    }

    addWeapon(weapon) {
        if (!weapon) return;
        
        this.weapons.push(weapon);
        
        // Equip the weapon if it's the first one
        if (this.weapons.length === 1) {
            this.equipWeapon(0);
        }
    }

    equipWeapon(index) {
        if (index >= 0 && index < this.weapons.length) {
            // Hide current weapon
            if (this.currentWeapon) {
                this.currentWeapon.mesh.setEnabled(false);
            }
            
            // Show new weapon
            this.currentWeapon = this.weapons[index];
            this.currentWeapon.mesh.setEnabled(true);
            
            // Update UI
            if (this.scene.ui) {
                this.scene.ui.setActiveWeapon(this.currentWeapon.name);
            }
        }
    }

    applyCameraShake(intensity = 0.1, duration = 0.5) {
        this.cameraShake = true;
        this.shakeIntensity = intensity;
        this.shakeTime = duration;
    }

    dispose() {
        // Clean up resources
        if (this.mesh) {
            this.mesh.dispose();
        }
        if (this.camera) {
            this.camera.dispose();
        }
        if (this.inventory) {
            this.inventory.dispose();
        }
        
        // Dispose animations
        Object.values(this.animations).forEach(anim => anim.dispose());
        
        // Remove event listeners
        const canvas = this.scene.getEngine().getRenderingCanvas();
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
