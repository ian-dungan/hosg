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
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        
        // Gamepad support
        this.gamepad = null;
        this.gamepadIndex = -1;
        this.lastJumpButton = false;
        
        // Animation
        this.walkCycle = 0;
        this.visualRoot = null;
        this.leftLeg = null;
        this.rightLeg = null;
        
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
    }

    createPlayerMesh() {
        // Physics body (invisible box)
        this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
            width: 0.7,
            height: 1.8,
            depth: 0.5
        }, this.scene);
        
        // Spawn at safe height (will drop to terrain)
        this.mesh.position.y = 20;
        this.mesh.visibility = 0;
        
        // Create knight character as visual
        this.createKnightModel();
        
        // Enhanced physics with better values for smooth movement
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { 
                mass: 5,           // Heavier = more stable, less sliding
                friction: 0.2,      // Ground friction
                restitution: 0.0    // No bounce
            },
            this.scene
        );
        
        // Apply damping to prevent sliding
        this.mesh.physicsImpostor.physicsBody.linearDamping = 0.3;
        this.mesh.physicsImpostor.physicsBody.angularDamping = 0.9;
    }
    
    createKnightModel() {
        // Container for all visual parts
        const visualRoot = new BABYLON.TransformNode('knightVisual', this.scene);
        visualRoot.parent = this.mesh;
        visualRoot.position.y = -0.9; // Adjust to align with physics box
        this.visualRoot = visualRoot;
        
        // Materials
        const armorMat = new BABYLON.StandardMaterial('armorMat', this.scene);
        armorMat.diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.65);
        armorMat.specularColor = new BABYLON.Color3(0.8, 0.8, 0.8);
        armorMat.specularPower = 64;
        
        const clothMat = new BABYLON.StandardMaterial('clothMat', this.scene);
        clothMat.diffuseColor = new BABYLON.Color3(0.5, 0.1, 0.1);
        
        const skinMat = new BABYLON.StandardMaterial('skinMat', this.scene);
        skinMat.diffuseColor = new BABYLON.Color3(0.9, 0.75, 0.65);
        
        // Torso (armored chest)
        const torso = BABYLON.MeshBuilder.CreateBox('torso', {
            width: 0.6, height: 0.8, depth: 0.4
        }, this.scene);
        torso.parent = visualRoot;
        torso.position.y = 1.0;
        torso.material = armorMat;
        
        // Head (helmet)
        const head = BABYLON.MeshBuilder.CreateSphere('head', {
            diameter: 0.4, segments: 8
        }, this.scene);
        head.parent = visualRoot;
        head.position.y = 1.6;
        head.material = armorMat;
        
        // Visor (face guard)
        const visor = BABYLON.MeshBuilder.CreateBox('visor', {
            width: 0.35, height: 0.15, depth: 0.25
        }, this.scene);
        visor.parent = head;
        visor.position = new BABYLON.Vector3(0, 0, 0.12);
        visor.material = armorMat;
        
        // Shoulders (pauldrons)
        const leftShoulder = BABYLON.MeshBuilder.CreateSphere('leftShoulder', {
            diameter: 0.35, segments: 8
        }, this.scene);
        leftShoulder.parent = visualRoot;
        leftShoulder.position = new BABYLON.Vector3(-0.4, 1.3, 0);
        leftShoulder.scaling.y = 0.7;
        leftShoulder.material = armorMat;
        
        const rightShoulder = leftShoulder.clone('rightShoulder');
        rightShoulder.parent = visualRoot;
        rightShoulder.position.x = 0.4;
        
        // Arms
        const leftArm = BABYLON.MeshBuilder.CreateCylinder('leftArm', {
            height: 0.7, diameter: 0.15
        }, this.scene);
        leftArm.parent = visualRoot;
        leftArm.position = new BABYLON.Vector3(-0.4, 0.75, 0);
        leftArm.material = clothMat;
        
        const rightArm = leftArm.clone('rightArm');
        rightArm.parent = visualRoot;
        rightArm.position.x = 0.4;
        
        // Hands (gauntlets)
        const leftHand = BABYLON.MeshBuilder.CreateBox('leftHand', {
            width: 0.15, height: 0.2, depth: 0.15
        }, this.scene);
        leftHand.parent = visualRoot;
        leftHand.position = new BABYLON.Vector3(-0.4, 0.35, 0);
        leftHand.material = armorMat;
        
        const rightHand = leftHand.clone('rightHand');
        rightHand.parent = visualRoot;
        rightHand.position.x = 0.4;
        
        // Belt
        const belt = BABYLON.MeshBuilder.CreateCylinder('belt', {
            height: 0.15, diameter: 0.65
        }, this.scene);
        belt.parent = visualRoot;
        belt.position.y = 0.55;
        belt.material = armorMat;
        
        // Legs (armored)
        const leftLeg = BABYLON.MeshBuilder.CreateCylinder('leftLeg', {
            height: 0.9, diameterTop: 0.18, diameterBottom: 0.15
        }, this.scene);
        leftLeg.parent = visualRoot;
        leftLeg.position = new BABYLON.Vector3(-0.15, 0, 0);
        leftLeg.material = armorMat;
        this.leftLeg = leftLeg;
        
        const rightLeg = leftLeg.clone('rightLeg');
        rightLeg.parent = visualRoot;
        rightLeg.position.x = 0.15;
        this.rightLeg = rightLeg;
        
        // Feet (armored boots)
        const leftFoot = BABYLON.MeshBuilder.CreateBox('leftFoot', {
            width: 0.2, height: 0.15, depth: 0.3
        }, this.scene);
        leftFoot.parent = visualRoot;
        leftFoot.position = new BABYLON.Vector3(-0.15, -0.5, 0.05);
        leftFoot.material = armorMat;
        
        const rightFoot = leftFoot.clone('rightFoot');
        rightFoot.parent = visualRoot;
        rightFoot.position.x = 0.15;
        
        // Cape
        const cape = BABYLON.MeshBuilder.CreatePlane('cape', {
            width: 0.5, height: 0.8
        }, this.scene);
        cape.parent = visualRoot;
        cape.position = new BABYLON.Vector3(0, 0.8, -0.25);
        cape.material = clothMat;
        
        console.log('[Player] Knight character model created');
    }

    setupCamera() {
        this.camera = new BABYLON.FollowCamera('playerCam', 
            new BABYLON.Vector3(0, 1.6, -5), 
            this.scene, 
            this.mesh
        );
        this.camera.radius = 5;
        this.camera.heightOffset = 1.6;
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
    }

    update(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;

        // Poll gamepad if available
        this.updateGamepadInput();

        // Get movement direction from camera
        const forward = this.camera.getFrontPosition(1).subtract(this.camera.position).normalize();
        const right = this.camera.getDirection(BABYLON.Vector3.Right());
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // Calculate movement vector (supports both keyboard and gamepad)
        const moveDirection = new BABYLON.Vector3();
        if (this.input.forward) moveDirection.addInPlace(forward);
        if (this.input.backward) moveDirection.subtractInPlace(forward);
        if (this.input.left) moveDirection.subtractInPlace(right);
        if (this.input.right) moveDirection.addInPlace(right);

        // Apply movement with improved physics
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            
            // Speed based on running state
            const speed = this.input.run ? 
                this.moveSpeed * CONFIG.PLAYER.RUN_MULTIPLIER : 
                this.moveSpeed;
            
            // Smooth acceleration
            const velocity = moveDirection.scale(speed * deltaTime * 60);
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            
            // Apply velocity (preserve vertical component for gravity/jumping)
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    velocity.x,
                    currentVelocity.y,
                    velocity.z
                )
            );
            
            // Rotate character to face movement direction
            const targetAngle = Math.atan2(moveDirection.x, moveDirection.z);
            const currentAngle = this.mesh.rotation.y;
            
            // Smooth rotation interpolation
            let angleDiff = targetAngle - currentAngle;
            // Normalize angle difference to -PI to PI
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            
            this.mesh.rotation.y += angleDiff * 0.15; // Smooth turn speed
            
            // Animate legs while moving
            this.animateWalking(deltaTime, this.input.run);
        } else {
            // Stop movement smoothly when no input
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    currentVelocity.x * 0.85,  // Deceleration
                    currentVelocity.y,
                    currentVelocity.z * 0.85
                )
            );
            
            // Reset leg positions when standing still
            this.resetLegPositions();
        }

        // Handle jumping with improved physics
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
        
        // Ground detection
        this.checkGroundContact();
    }
    
    animateWalking(deltaTime, isRunning) {
        if (!this.leftLeg || !this.rightLeg) return;
        
        // Walking animation speed
        const animSpeed = isRunning ? 15 : 10;
        this.walkCycle = (this.walkCycle || 0) + deltaTime * animSpeed;
        
        // Leg swing using sine wave
        const swing = Math.sin(this.walkCycle);
        const maxSwing = isRunning ? 0.3 : 0.2;
        
        this.leftLeg.rotation.x = swing * maxSwing;
        this.rightLeg.rotation.x = -swing * maxSwing;
    }
    
    resetLegPositions() {
        if (!this.leftLeg || !this.rightLeg) return;
        
        // Smoothly return legs to neutral position
        this.leftLeg.rotation.x *= 0.9;
        this.rightLeg.rotation.x *= 0.9;
    }
    
    checkGroundContact() {
        // Raycast downward to detect ground
        const origin = this.mesh.position.clone();
        const direction = new BABYLON.Vector3(0, -1, 0);
        const length = 1.0; // Check 1 unit below
        
        const ray = new BABYLON.Ray(origin, direction, length);
        const hit = this.scene.pickWithRay(ray, (mesh) => {
            return mesh.name === 'terrain' || mesh.checkCollisions;
        });
        
        // Consider grounded if hit within threshold
        this.isOnGround = hit && hit.hit && hit.distance < 0.95;
    }

    jump() {
        if (this.isOnGround && this.mesh?.physicsImpostor) {
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            // Stronger, more responsive jump
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(velocity.x, this.jumpForce * 12, velocity.z)
            );
            this.isOnGround = false;
            console.log('[Player] Jump!');
        }
    }

    updateGamepadInput() {
        // Check for connected gamepads
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        
        if (!this.gamepad || this.gamepadIndex === -1) {
            // Find first connected gamepad
            for (let i = 0; i < gamepads.length; i++) {
                if (gamepads[i]) {
                    this.gamepad = gamepads[i];
                    this.gamepadIndex = i;
                    console.log('[Player] Gamepad connected:', this.gamepad.id);
                    break;
                }
            }
        } else {
            // Update existing gamepad reference
            this.gamepad = gamepads[this.gamepadIndex];
        }
        
        if (!this.gamepad) return;
        
        const deadzone = CONFIG.CONTROLS.GAMEPAD.DEADZONE;
        
        // Left stick - movement (axes 0 and 1)
        const leftX = Math.abs(this.gamepad.axes[0]) > deadzone ? this.gamepad.axes[0] : 0;
        const leftY = Math.abs(this.gamepad.axes[1]) > deadzone ? this.gamepad.axes[1] : 0;
        
        // Map analog stick to digital input
        if (leftY < -deadzone) this.input.forward = true;
        else if (!this.input.forward) this.input.forward = false;
        
        if (leftY > deadzone) this.input.backward = true;
        else if (!this.input.backward) this.input.backward = false;
        
        if (leftX < -deadzone) this.input.left = true;
        else if (!this.input.left) this.input.left = false;
        
        if (leftX > deadzone) this.input.right = true;
        else if (!this.input.right) this.input.right = false;
        
        // A button (0) - jump
        const jumpButton = this.gamepad.buttons[0] && this.gamepad.buttons[0].pressed;
        if (jumpButton && !this.lastJumpButton) {
            this.input.jump = true;
        } else {
            this.input.jump = false;
        }
        this.lastJumpButton = jumpButton;
        
        // Right trigger (7) or Right bumper (5) - run
        const runButton = (this.gamepad.buttons[7] && this.gamepad.buttons[7].pressed) ||
                         (this.gamepad.buttons[5] && this.gamepad.buttons[5].pressed);
        this.input.run = runButton;
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) {
            this.die();
        }
    }

    die() {
        console.log('Player died');
        // Handle player death
    }

    dispose() {
        this.mesh?.dispose();
        this.camera?.dispose();
    }
}

class Inventory {
    constructor(size) {
        this.size = size;
        this.items = [];
        this.equippedItem = null;
        this.gold = 0;
    }

    addGold(amount) {
        if (typeof amount === "number" && !isNaN(amount)) {
            this.gold += amount;
        }
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
        if (this.equippedItem) {
            // Use the equipped item
            return true;
        }
        return false;
    }
}
