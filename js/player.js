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
        
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
    }

    createPlayerMesh() {
        // Capsule for visuals
        const visualMesh = BABYLON.MeshBuilder.CreateCapsule('playerVisual', {
            height: 1.8,
            radius: 0.3
        }, this.scene);
        
        // Box for physics (CapsuleImpostor not supported in Cannon.js)
        this.mesh = BABYLON.MeshBuilder.CreateBox('player', {
            width: 0.6,
            height: 1.8,
            depth: 0.6
        }, this.scene);
        
        this.mesh.position.y = 2;
        this.mesh.visibility = 0; // Invisible physics body
        
        // Attach visual mesh as child
        visualMesh.parent = this.mesh;
        visualMesh.visibility = 1;
        
        // Setup physics with BoxImpostor
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 1, friction: 0.2, restitution: 0.1 },
            this.scene
        );
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

        // Apply movement
        if (moveDirection.lengthSquared() > 0) {
            moveDirection.normalize();
            const speed = this.input.run ? 
                this.moveSpeed * CONFIG.PLAYER.RUN_MULTIPLIER : 
                this.moveSpeed;
            
            const velocity = moveDirection.scale(speed * deltaTime * 60);
            const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(
                    velocity.x,
                    currentVelocity.y,
                    velocity.z
                )
            );
        }

        // Handle jumping
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
    }

    jump() {
        if (this.isOnGround && this.mesh?.physicsImpostor) {
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
                new BABYLON.Vector3(velocity.x, this.jumpForce * 10, velocity.z)
            );
            this.isOnGround = false;
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