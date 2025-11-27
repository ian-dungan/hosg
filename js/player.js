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
        // Create capsule for player
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 1.8,
            radius: 0.3
        }, this.scene);
        
        this.mesh.position.y = 5; // Start above ground
        this.mesh.checkCollisions = true;
        
        // Setup ellipsoid for collisions
        this.mesh.ellipsoid = new BABYLON.Vector3(0.3, 0.9, 0.3);
        this.mesh.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);

        // Setup physics impostor
        const physicsEngine = this.scene.getPhysicsEngine();
        if (physicsEngine && typeof CANNON !== 'undefined') {
            try {
                this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                    this.mesh,
                    BABYLON.PhysicsImpostor.CylinderImpostor,
                    { 
                        mass: 1, 
                        friction: 0.5, 
                        restitution: 0.1 
                    },
                    this.scene
                );
                
                // Lock rotation to prevent player from tipping over
                if (this.mesh.physicsImpostor.physicsBody) {
                    this.mesh.physicsImpostor.physicsBody.fixedRotation = true;
                    this.mesh.physicsImpostor.physicsBody.updateMassProperties();
                }
                
                logDebug('[Player] Physics impostor created successfully');
            } catch (err) {
                console.error('[Player] Failed to create physics impostor:', err);
            }
        } else {
            console.warn('[Player] Physics engine not available, using basic collisions');
        }
        
        // Make player invisible (third-person view)
        this.mesh.visibility = 0.3;
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

    checkGrounded() {
        if (!this.mesh) return false;
        
        const now = Date.now();
        if (now - this.lastGroundCheck < 100) return this.grounded;
        
        this.lastGroundCheck = now;
        
        // Raycast downward to check if on ground
        const ray = new BABYLON.Ray(
            this.mesh.position,
            new BABYLON.Vector3(0, -1, 0),
            1.2
        );
        
        const hit = this.scene.pickWithRay(ray, (mesh) => {
            return mesh !== this.mesh && mesh.checkCollisions;
        });
        
        this.grounded = hit && hit.hit && hit.distance < 1.2;
        return this.grounded;
    }

    update(deltaTime) {
        if (!this.mesh) return;

        // Check if grounded
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
            
            const velocity = moveDirection.scale(speed * deltaTime * 60);
            
            if (this.mesh.physicsImpostor) {
                // Use physics
                const currentVelocity = this.mesh.physicsImpostor.getLinearVelocity();
                this.mesh.physicsImpostor.setLinearVelocity(
                    new BABYLON.Vector3(
                        velocity.x,
                        currentVelocity.y,
                        velocity.z
                    )
                );
            } else {
                // Fallback to direct movement
                this.mesh.moveWithCollisions(velocity);
            }
        }

        // Handle jumping
        if (this.input.jump && this.isOnGround) {
            this.jump();
        }
        
        // Update camera target to follow player
        this.camera.setTarget(this.mesh.position);
        
        // Regenerate stamina when not running
        if (!this.input.run && this.stamina < this.maxStamina) {
            this.stamina = Math.min(this.maxStamina, this.stamina + deltaTime * 10);
        }
        
        // Consume stamina when running
        if (this.input.run && this.stamina > 0) {
            this.stamina = Math.max(0, this.stamina - deltaTime * 20);
        }
    }

    jump() {
        if (!this.isOnGround) return;
        
        if (this.mesh.physicsImpostor) {
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            this.mesh.physicsImpostor.setLinearVelocity(
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
