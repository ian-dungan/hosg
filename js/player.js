// player.js - Player controller
import { Vector3, MeshBuilder } from '@babylonjs/core';

export class Player {
    constructor(scene) {
        this.scene = scene;
        this.position = Vector3.Zero();
        this.velocity = Vector3.Zero();
        this.rotation = 0;
        this.health = CONFIG.PLAYER.START_HEALTH;
        this.mana = CONFIG.PLAYER.START_MANA;
        
        this.init();
    }

    init() {
        // Create player mesh
        this.mesh = MeshBuilder.CreateCylinder('player', {
            height: 2,
            diameter: 1
        }, this.scene);
        
        // Set initial position
        this.mesh.position = this.position.clone();
    }

    update(deltaTime) {
        // Update position based on velocity
        this.position.addInPlace(this.velocity.scale(deltaTime));
        this.mesh.position.copyFrom(this.position);
        
        // Apply gravity
        this.velocity.y += CONFIG.PLAYER.GRAVITY * deltaTime;
        
        // Simple ground collision
        if (this.position.y < 0) {
            this.position.y = 0;
            this.velocity.y = 0;
        }
    }

    move(direction) {
        const speed = CONFIG.PLAYER.MOVEMENT_SPEED;
        this.velocity.x = direction.x * speed;
        this.velocity.z = direction.z * speed;
    }

    jump() {
        if (Math.abs(this.position.y) < 0.1) {
            this.velocity.y = CONFIG.PLAYER.JUMP_FORCE;
        }
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        return this.health <= 0;
    }

    dispose() {
        this.mesh.dispose();
    }
}