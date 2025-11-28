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
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
    }

    createPlayerMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 1.8,
            radius: 0.3
        }, this.scene);
        
        this.mesh.position.y = 2;
        this.mesh.checkCollisions = true;
        
        // Setup physics
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.CapsuleImpostor,
            { mass: 1, friction: 0.8, restitution: 0.0 },
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

        // Get movement direction from camera
        const forward = this.camera.getFrontPosition(1).subtract(this.camera.position).normalize();
        const right = this.camera.getDirection(BABYLON.Vector3.Right());
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();

        // Calculate movement vector
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
