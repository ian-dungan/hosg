// player.js
// Using global BABYLON object from CDN
const { Vector3, MeshBuilder } = BABYLON;

class Player {
    constructor(scene) {
        this.scene = scene;
        this.mesh = null;
        this.health = CONFIG.PLAYER.START_HEALTH;
        this.mana = CONFIG.PLAYER.START_MANA;
        this.position = new Vector3(0, 2, 0); // Start slightly above ground
        this.velocity = new Vector3(0, 0, 0);
        this.isJumping = false;
        this.isRunning = false;
        this.init();
    }

    init() {
        // Create player mesh
        this.mesh = MeshBuilder.CreateBox('player', { 
            width: 1, 
            height: 2, 
            depth: 1 
        }, this.scene);
        this.mesh.position = this.position;
        this.mesh.checkCollisions = true;
    }

    update(deltaTime) {
        // Apply gravity
        this.velocity.y += CONFIG.PLAYER.GRAVITY * deltaTime;
        
        // Update position
        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.mesh.position.copyFrom(this.position);
        
        // Simple ground collision
        if (this.position.y < 1) {
            this.position.y = 1;
            this.velocity.y = 0;
            this.isJumping = false;
        }
    }

    move(direction) {
        // Move player in the given direction
        const moveSpeed = CONFIG.PLAYER.MOVEMENT_SPEED * 
                         (this.isRunning ? CONFIG.PLAYER.RUN_MULTIPLIER : 1);
        this.velocity.x = direction.x * moveSpeed;
        this.velocity.z = direction.z * moveSpeed;
    }

    jump() {
        if (!this.isJumping) {
            this.velocity.y = CONFIG.PLAYER.JUMP_FORCE;
            this.isJumping = true;
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
