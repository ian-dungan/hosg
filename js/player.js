class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.camera = null;
        this.inventory = new Inventory(CONFIG.PLAYER.INVENTORY_SIZE);
        this.velocity = new BABYLON.Vector3();
        this.isOnGround = false;
        this.health = CONFIG.PLAYER.HEALTH;
        this.maxHealth = CONFIG.PLAYER.HEALTH;
        this.mana = 100;
        this.maxMana = 100;
        this.stamina = CONFIG.PLAYER.STAMINA;
        this.maxStamina = CONFIG.PLAYER.STAMINA;
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        this.grounded = false;
        this.lastGroundCheck = 0;
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
    }

    createPlayerMesh() {
        // Create root transform for the player
        this.mesh = new BABYLON.TransformNode('player', this.scene);
        this.mesh.position.y = 20; // Start well above ground to ensure proper spawn
        
        // Create human-like body parts
        this.createHumanBody();
        
        // Setup ellipsoid for collisions on the root node
        this.mesh.ellipsoid = new BABYLON.Vector3(0.4, 0.9, 0.4);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);

        // Create invisible collision capsule for physics
        this.collisionMesh = BABYLON.MeshBuilder.CreateCapsule('playerCollision', {
            height: 1.8,
            radius: 0.4
        }, this.scene);
        this.collisionMesh.position = new BABYLON.Vector3(0, 20, 0); // Explicit high spawn
        this.collisionMesh.visibility = 0; // Invisible
        this.collisionMesh.checkCollisions = true;

        // Setup physics impostor on collision mesh
        const physicsEngine = this.scene.getPhysicsEngine();
        if (physicsEngine && typeof CANNON !== 'undefined') {
            try {
                this.collisionMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.collisionMesh,
                    BABYLON.PhysicsImpostor.CylinderImpostor,
                    { 
                        mass: 15, // Balanced mass for good control
                        friction: 0.2, // Balanced friction - prevents sliding but allows movement
                        restitution: 0.0 // No bouncing
                    },
                    this.scene
                );
                
                // Lock rotation and configure physics body
                if (this.collisionMesh.physicsImpostor.physicsBody) {
                    this.collisionMesh.physicsImpostor.physicsBody.fixedRotation = true;
                    this.collisionMesh.physicsImpostor.physicsBody.updateMassProperties();
                    
                    // Lock X and Z rotation to prevent tipping
                    this.collisionMesh.physicsImpostor.physicsBody.angularDamping = 0.99;
                    
                    // Balanced linear damping for smooth movement with proper stopping
                    this.collisionMesh.physicsImpostor.physicsBody.linearDamping = 0.3;
                    
                    // Increase contact stiffness to prevent sinking
                    if (this.collisionMesh.physicsImpostor.physicsBody.material) {
                        this.collisionMesh.physicsImpostor.physicsBody.material.friction = 0.2;
                    }
                }
                
                logDebug('[Player] Physics impostor created successfully');
            } catch (err) {
                console.error('[Player] Failed to create physics impostor:', err);
            }
        } else {
            console.warn('[Player] Physics engine not available, using basic collisions');
        }
    }

    createHumanBody() {
        // Body (torso)
        const torso = BABYLON.MeshBuilder.CreateBox('torso', {
            width: 0.5,
            height: 0.7,
            depth: 0.3
        }, this.scene);
        torso.position.y = 1.2;
        torso.parent = this.mesh;
        
        const torsoMat = new BABYLON.StandardMaterial('torsoMat', this.scene);
        torsoMat.diffuseColor = new BABYLON.Color3(0.2, 0.4, 0.6); // Blue shirt
        torso.material = torsoMat;
        
        // Head
        const head = BABYLON.MeshBuilder.CreateSphere('head', {
            diameter: 0.35,
            segments: 16
        }, this.scene);
        head.position.y = 1.75;
        head.parent = this.mesh;
        
        const headMat = new BABYLON.StandardMaterial('headMat', this.scene);
        headMat.diffuseColor = new BABYLON.Color3(0.9, 0.7, 0.6); // Skin tone
        head.material = headMat;
        
        // Arms
        for (let side of [-1, 1]) {
            const arm = BABYLON.MeshBuilder.CreateCylinder(`arm${side}`, {
                height: 0.6,
                diameter: 0.12
            }, this.scene);
            arm.position = new BABYLON.Vector3(side * 0.35, 1.15, 0);
            arm.parent = this.mesh;
            arm.material = headMat;
        }
        
        // Legs
        for (let side of [-1, 1]) {
            const leg = BABYLON.MeshBuilder.CreateCylinder(`leg${side}`, {
                height: 0.8,
                diameter: 0.15
            }, this.scene);
            leg.position = new BABYLON.Vector3(side * 0.15, 0.4, 0);
            leg.parent = this.mesh;
            
            const legMat = new BABYLON.StandardMaterial(`legMat${side}`, this.scene);
            legMat.diffuseColor = new BABYLON.Color3(0.2, 0.2, 0.3); // Dark pants
            leg.material = legMat;
        }
        
        // Store body parts for animation
        this.bodyParts = {
            torso,
            head,
            leftArm: this.mesh.getChildMeshes().find(m => m.name === 'arm-1'),
            rightArm: this.mesh.getChildMeshes().find(m => m.name === 'arm1'),
            leftLeg: this.mesh.getChildMeshes().find(m => m.name === 'leg-1'),
            rightLeg: this.mesh.getChildMeshes().find(m => m.name === 'leg1')
        };
    }

    setupCamera() {
        // Use ArcRotateCamera for better third-person controls
        this.camera = new BABYLON.ArcRotateCamera(
            'playerCam',
            -Math.PI / 2,
            Math.PI / 3,
            8,
            new BABYLON.Vector3(0, 0, 0),
            this.scene
        );
        
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        this.camera.lowerRadiusLimit = 3;
        this.camera.upperRadiusLimit = 15;
        this.camera.lowerBetaLimit = 0.1;
        this.camera.upperBetaLimit = Math.PI / 2.2;
        this.camera.wheelPrecision = 50;
        
        // Set player mesh as target
        this.camera.setTarget(this.mesh.position);
        
        this.scene.activeCamera = this.camera;
    }

    setupInput() {
        this.input = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            jump: false,
            run: false
        };

        // Gamepad state
        this.gamepad = {
            connected: false,
            index: -1,
            deadzone: 0.15
        };

        // Keyboard controls
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

        // Gamepad connection
        window.addEventListener('gamepadconnected', (e) => {
            console.log('[Player] Gamepad connected:', e.gamepad.id);
            this.gamepad.connected = true;
            this.gamepad.index = e.gamepad.index;
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            console.log('[Player] Gamepad disconnected');
            this.gamepad.connected = false;
            this.gamepad.index = -1;
        });
    }

    updateGamepadInput() {
        if (!this.gamepad.connected) return;

        const gamepads = navigator.getGamepads();
        if (!gamepads || !gamepads[this.gamepad.index]) return;

        const gp = gamepads[this.gamepad.index];
        const deadzone = this.gamepad.deadzone;

        // Left stick (movement)
        const lx = Math.abs(gp.axes[0]) > deadzone ? gp.axes[0] : 0;
        const ly = Math.abs(gp.axes[1]) > deadzone ? gp.axes[1] : 0;

        // Apply stick input (override keyboard if present)
        if (Math.abs(lx) > 0 || Math.abs(ly) > 0) {
            this.input.forward = ly < -0.1;
            this.input.backward = ly > 0.1;
            this.input.left = lx < -0.1;
            this.input.right = lx > 0.1;
        }

        // Buttons (Xbox layout)
        // A button (0) - Jump
        if (gp.buttons[0] && gp.buttons[0].pressed) {
            if (!this.gamepadJumpPressed) {
                this.input.jump = true;
                this.gamepadJumpPressed = true;
            }
        } else {
            this.gamepadJumpPressed = false;
            this.input.jump = false;
        }

        // LB (4) or RB (5) or RT (7) - Run
        const runPressed = (gp.buttons[4] && gp.buttons[4].pressed) ||
                          (gp.buttons[5] && gp.buttons[5].pressed) ||
                          (gp.axes[7] > 0.5);
        this.input.run = runPressed;

        // Right stick for camera control (handled by camera separately)
        const rx = Math.abs(gp.axes[2]) > deadzone ? gp.axes[2] : 0;
        const ry = Math.abs(gp.axes[3]) > deadzone ? gp.axes[3] : 0;
        
        if (this.camera && (Math.abs(rx) > 0 || Math.abs(ry) > 0)) {
            this.camera.alpha -= rx * 0.05;
            this.camera.beta = Math.max(0.1, Math.min(Math.PI / 2.2, 
                this.camera.beta + ry * 0.03));
        }
    }

    checkGrounded() {
        if (!this.collisionMesh) return false;
        
        const now = Date.now();
        if (now - this.lastGroundCheck < 100) return this.grounded;
        
        this.lastGroundCheck = now;
        
        // Raycast downward from collision mesh to check if on ground
        const ray = new BABYLON.Ray(
            this.collisionMesh.position,
            new BABYLON.Vector3(0, -1, 0),
            1.0  // Check 1 unit below
        );
        
        const hit = this.scene.pickWithRay(ray, (mesh) => {
            // Check against terrain and objects with collision, but not player
            return mesh !== this.mesh && 
                   mesh !== this.collisionMesh && 
                   mesh.checkCollisions;
        });
        
        // Also verify with physics velocity
        let isStable = false;
        if (this.collisionMesh.physicsImpostor) {
            const velocity = this.collisionMesh.physicsImpostor.getLinearVelocity();
            isStable = Math.abs(velocity.y) < 1.0; // Not falling fast
        }
        
        this.grounded = (hit && hit.hit && hit.distance < 1.0) || isStable;
        return this.grounded;
    }

    update(deltaTime) {
        if (!this.mesh || !this.collisionMesh) return;

        // Update gamepad input
        this.updateGamepadInput();

        // Sync visual mesh with collision mesh
        this.mesh.position.copyFrom(this.collisionMesh.position);
        this.mesh.rotation.y = this.collisionMesh.rotation.y;

        // Improved ground check
        this.isOnGround = this.checkGrounded();

        // Get camera direction for movement
        const forward = this.camera.getForwardRay().direction;
        forward.y = 0;
        forward.normalize();
        
        const right = BABYLON.Vector3.Cross(forward, BABYLON.Vector3.Up());

        // Calculate movement direction
        const moveDirection = new BABYLON.Vector3();
        if (this.input.forward) moveDirection.addInPlace(forward);
        if (this.input.backward) moveDirection.subtractInPlace(forward);
        if (this.input.left) moveDirection.subtractInPlace(right);
        if (this.input.right) moveDirection.addInPlace(right);

        // Apply movement
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            const speed = this.input.run ? 
                this.moveSpeed * CONFIG.PLAYER.RUN_MULTIPLIER : 
                this.moveSpeed;
            
            if (this.collisionMesh.physicsImpostor) {
                // Use impulse for responsive movement with refined physics
                const currentVelocity = this.collisionMesh.physicsImpostor.getLinearVelocity();
                
                // Apply impulse in movement direction (adjusted for new mass/friction)
                const impulseStrength = speed * 150; // Increased for higher friction
                const impulse = moveDirection.scale(impulseStrength);
                
                // Apply impulse at center of mass
                this.collisionMesh.physicsImpostor.applyImpulse(
                    impulse,
                    this.collisionMesh.getAbsolutePosition()
                );
                
                // Limit maximum velocity to prevent runaway speed
                const maxSpeed = speed * 100; // Increased cap for better responsiveness
                const currentSpeed = Math.sqrt(currentVelocity.x * currentVelocity.x + currentVelocity.z * currentVelocity.z);
                if (currentSpeed > maxSpeed) {
                    const scale = maxSpeed / currentSpeed;
                    this.collisionMesh.physicsImpostor.setLinearVelocity(
                        new BABYLON.Vector3(
                            currentVelocity.x * scale,
                            currentVelocity.y,
                            currentVelocity.z * scale
                        )
                    );
                }
                
                // Smooth rotation to movement direction
                if (moveDirection.length() > 0.1) {
                    const targetAngle = Math.atan2(moveDirection.x, moveDirection.z);
                    const currentAngle = this.collisionMesh.rotation.y;
                    const angleDiff = targetAngle - currentAngle;
                    
                    // Normalize angle difference to -PI to PI
                    let normalizedDiff = angleDiff;
                    while (normalizedDiff > Math.PI) normalizedDiff -= Math.PI * 2;
                    while (normalizedDiff < -Math.PI) normalizedDiff += Math.PI * 2;
                    
                    // Smooth rotation
                    this.collisionMesh.rotation.y += normalizedDiff * 0.2;
                }
            } else {
                // Fallback to direct movement
                const velocity = moveDirection.scale(speed * deltaTime * 60);
                this.collisionMesh.moveWithCollisions(velocity);
            }
            
            // Add walking animation
            this.animateWalking(deltaTime);
        }

        // Handle jumping
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
        
        // Safety check - if player falls below -10, respawn
        if (this.collisionMesh.position.y < -10) {
            console.log('[Player] Fell through world, respawning');
            this.collisionMesh.position.y = 10;
            if (this.collisionMesh.physicsImpostor) {
                this.collisionMesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            }
        }
        
        // Update camera target to follow player
        this.camera.setTarget(this.mesh.position.add(new BABYLON.Vector3(0, 1, 0)));
        
        // Regenerate stamina when not running
        if (!this.input.run && this.stamina < this.maxStamina) {
            this.stamina = Math.min(this.maxStamina, this.stamina + deltaTime * 10);
        }
        
        // Consume stamina when running
        if (this.input.run && this.stamina > 0) {
            this.stamina = Math.max(0, this.stamina - deltaTime * 20);
        }
    }

    animateWalking(deltaTime) {
        if (!this.bodyParts) return;
        
        // Simple walk cycle
        this.walkCycle = (this.walkCycle || 0) + deltaTime * 5;
        const swing = Math.sin(this.walkCycle);
        
        // Swing arms opposite to legs
        if (this.bodyParts.leftArm) {
            this.bodyParts.leftArm.rotation.x = swing * 0.5;
        }
        if (this.bodyParts.rightArm) {
            this.bodyParts.rightArm.rotation.x = -swing * 0.5;
        }
        if (this.bodyParts.leftLeg) {
            this.bodyParts.leftLeg.rotation.x = -swing * 0.3;
        }
        if (this.bodyParts.rightLeg) {
            this.bodyParts.rightLeg.rotation.x = swing * 0.3;
        }
    }

    jump() {
        if (!this.isOnGround || !this.collisionMesh) return;
        
        if (this.collisionMesh.physicsImpostor) {
            const velocity = this.collisionMesh.physicsImpostor.getLinearVelocity();
            this.collisionMesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(velocity.x, this.jumpForce * 10, velocity.z)
            );
        } else {
            // Fallback jump
            this.velocity.y = this.jumpForce * 10;
        }
        
        this.isOnGround = false;
        this.grounded = false;
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) {
            this.die();
        }
    }

    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    die() {
        console.log('[Player] died');
        // Respawn logic
        if (this.mesh) {
            this.mesh.position.y = 10;
            this.health = this.maxHealth;
            this.mana = this.maxMana;
            this.stamina = this.maxStamina;
        }
    }

    dispose() {
        if (this.mesh) {
            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.dispose();
            }
            this.mesh.dispose();
            this.mesh = null;
        }
        if (this.camera) {
            this.camera.dispose();
            this.camera = null;
        }
    }
}

class Inventory {
    constructor(size) {
        this.size = size;
        this.items = [];
        this.equippedItem = null;
    }

    addItem(item) {
        if (this.items.length < this.size) {
            this.items.push(item);
            return true;
        }
        return false;
    }

    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            return this.items.splice(index, 1)[0];
        }
        return null;
    }

    equipItem(index) {
        if (index >= 0 && index < this.items.length) {
            this.equippedItem = this.items[index];
            return true;
        }
        return false;
    }

    useEquippedItem() {
        if (this.equippedItem && typeof this.equippedItem.use === 'function') {
            return this.equippedItem.use();
        }
        return false;
    }
}

window.Player = Player;
window.Inventory = Inventory;
