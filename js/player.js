class Player {
    constructor(scene, camera, shadowGenerator) {
        this.scene = scene;
        this.camera = camera;
        this.shadowGenerator = shadowGenerator;
        
        // Player properties
        this.mesh = null;
        this.stats = {
            health: CONFIG.PLAYER.START_HEALTH,
            maxHealth: CONFIG.PLAYER.START_HEALTH,
            mana: CONFIG.PLAYER.START_MANA,
            maxMana: CONFIG.PLAYER.START_MANA,
            level: CONFIG.PLAYER.START_LEVEL,
            experience: 0,
            experienceToNextLevel: 100
        };
        
        // Movement
        this.speed = CONFIG.PLAYER.MOVEMENT_SPEED;
        this.rotationSpeed = CONFIG.PLAYER.ROTATION_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        this.isJumping = false;
        this.velocity = new BABYLON.Vector3(0, 0, 0);
        
        // Inventory
        this.inventory = {
            items: [],
            maxSlots: 20,
            gold: 100
        };
        
        // Skills
        this.skills = {
            combat: { level: 1, xp: 0 },
            magic: { level: 1, xp: 0 },
            crafting: { level: 1, xp: 0 }
        };
        
        // Quests
        this.activeQuests = [];
        this.completedQuests = [];
    }
    
    async init() {
        await this.createMesh();
        this.setupPhysics();
        // this.setupAnimations(); // TODO: Fix animations later
    }
    
    async createMesh() {
        // Create player mesh (simplified for example)
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 2,
            radius: 0.5
        }, this.scene);
        
        this.mesh.position = new BABYLON.Vector3(0, 2, 0);
        
        // Add shadow
        if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(this.mesh);
        }
        
        // Set camera to follow player
        this.camera.parent = this.mesh;
        this.camera.position = new BABYLON.Vector3(0, 2, -5);
        // FreeCamera / TargetCamera uses setTarget instead of lookAt
        if (typeof this.camera.setTarget === 'function') {
            this.camera.setTarget(BABYLON.Vector3.Zero());
        }
    }
    
    setupPhysics() {
        // Set up physics body
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 1, friction: 0.2, restitution: 0.3 },
            this.scene
        );
    }
    
    setupAnimations() {
        // Setup animation groups
        this.animations = {
            idle: this.createAnimation('idle', 0, 20, true),
            walk: this.createAnimation('walk', 21, 41, true),
            run: this.createAnimation('run', 42, 62, true),
            jump: this.createAnimation('jump', 63, 83, false),
            attack: this.createAnimation('attack', 84, 104, false)
        };
        
        // Start with idle animation
        this.currentAnimation = this.animations.idle;
        // this.currentAnimation.play(true); // TODO: Fix
    }
    
    createAnimation(name, from, to, loop) {
        const animation = new BABYLON.Animation(
            `${name}_anim`,
            'position.y',
            30,
            BABYLON.Animation.ANIMATIONTYPE_FLOAT,
            BABYLON.Animation.ANIMATIONLOOPMODE_CYCLE
        );
        
        // Simple up and down animation for example
        const keyFrames = [];
        keyFrames.push({ frame: 0, value: 0 });
        keyFrames.push({ frame: 15, value: 0.5 });
        keyFrames.push({ frame: 30, value: 0 });
        
        animation.setKeys(keyFrames);
        return animation;
    }
    
    update(deltaTime, input) {
        if (!this.mesh) return;
        
        // Handle movement
        this.handleMovement(deltaTime, input);
        
        // Update animation based on movement
        this.updateAnimation(input);
        
        // Update position
        this.mesh.physicsImpostor.setLinearVelocity(this.velocity);
    }
    
    handleMovement(deltaTime, input) {
        // Reset velocity
        this.velocity = new BABYLON.Vector3(0, this.velocity.y, 0);
        
        // Get camera forward and right vectors
        const forward = this.camera.getForwardRay().direction;
        const right = this.camera.getRightRay().direction;
        
        // Flatten vectors to horizontal plane
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();
        
        // Calculate movement direction
        const moveDirection = new BABYLON.Vector3(0, 0, 0);
        
        if (input['w'] || input['ArrowUp']) {
            moveDirection.addInPlace(forward);
        }
        if (input['s'] || input['ArrowDown']) {
            moveDirection.subtractInPlace(forward);
        }
        if (input['a'] || input['ArrowLeft']) {
            moveDirection.subtractInPlace(right);
        }
        if (input['d'] || input['ArrowRight']) {
            moveDirection.addInPlace(right);
        }
        
        // Normalize and apply speed
        if (moveDirection.length() > 0) {
            moveDirection.normalize();
            moveDirection.scaleInPlace(this.speed);
        }
        
        // Apply movement
        this.velocity.x = moveDirection.x;
        this.velocity.z = moveDirection.z;
        
        // Jump
        if ((input[' '] || input['Spacebar'] === ' ') && !this.isJumping) {
            this.jump();
        }
    }
    
    jump() {
        if (this.isJumping) return;
        
        this.isJumping = true;
        this.velocity.y = this.jumpForce;
        
        // Play jump animation
        this.playAnimation('jump', false, () => {
            this.playAnimation('idle');
        });
    }
    
    playAnimation(name, loop = true, onAnimationEnd = null) {
        if (this.currentAnimation) {
            this.currentAnimation.stop();
        }
        
        this.currentAnimation = this.animations[name];
        if (this.currentAnimation) {
            this.currentAnimation.loopAnimation = loop;
            this.currentAnimation.play(loop);
            
            if (onAnimationEnd) {
                this.scene.onBeforeRenderObservable.addOnce(() => {
                    onAnimationEnd();
                }, undefined, false, this.currentAnimation);
            }
        }
    }
    
    updateAnimation(input) {
        // Simple animation state machine
        const isMoving = input['w'] || input['a'] || input['s'] || input['d'] || 
                        input['ArrowUp'] || input['ArrowDown'] || 
                        input['ArrowLeft'] || input['ArrowRight'];
        
        if (isMoving) {
            if (input['Shift']) {
                this.playAnimation('run');
            } else {
                this.playAnimation('walk');
            }
        } else if (this.currentAnimation !== this.animations.jump) {
            this.playAnimation('idle');
        }
    }
    
    // Inventory methods
    addItem(item, quantity = 1) {
        // Add item to inventory
        const existingItem = this.inventory.items.find(i => i.id === item.id);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else if (this.inventory.items.length < this.inventory.maxSlots) {
            this.inventory.items.push({ ...item, quantity });
            return true;
        }
        return false;
    }
    
    removeItem(itemId, quantity = 1) {
        const itemIndex = this.inventory.items.findIndex(i => i.id === itemId);
        if (itemIndex !== -1) {
            const item = this.inventory.items[itemIndex];
            if (item.quantity > quantity) {
                item.quantity -= quantity;
            } else {
                this.inventory.items.splice(itemIndex, 1);
            }
            return true;
        }
        return false;
    }
    
    // Combat methods
    takeDamage(amount) {
        this.stats.health = Math.max(0, this.stats.health - amount);
        if (this.stats.health <= 0) {
            this.die();
        }
        return this.stats.health;
    }
    
    heal(amount) {
        this.stats.health = Math.min(this.stats.maxHealth, this.stats.health + amount);
        return this.stats.health;
    }
    
    die() {
        // Handle player death
        console.log('Player died!');
        this.playAnimation('idle');
        // Add respawn logic here
    }
    
    // Experience and leveling
    addExperience(amount) {
        this.stats.experience += amount;
        if (this.stats.experience >= this.stats.experienceToNextLevel) {
            this.levelUp();
        }
    }
    
    levelUp() {
        this.stats.level++;
        this.stats.experience -= this.stats.experienceToNextLevel;
        this.stats.experienceToNextLevel = Math.floor(this.stats.experienceToNextLevel * 1.5);
        
        // Increase stats
        this.stats.maxHealth += 20;
        this.stats.health = this.stats.maxHealth;
        this.stats.maxMana += 10;
        this.stats.mana = this.stats.maxMana;
        
        console.log(`Level up! You are now level ${this.stats.level}`);
        
        // Update UI
        if (window.game && window.game.ui) {
            window.game.ui.updatePlayerStats();
        }
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Player;
}
