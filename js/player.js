// Player Class
class Player extends Entity {
    constructor(scene, options = {}) {
        super(scene, options.position);
        
        // Player properties
        this.type = 'player';
        this.name = options.name || 'Player';
        this.health = options.health || CONFIG.PLAYER.HEALTH;
        this.maxHealth = options.maxHealth || CONFIG.PLAYER.HEALTH;
        this.speed = options.speed || CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = options.jumpForce || CONFIG.PLAYER.JUMP_FORCE;
        this.runMultiplier = options.runMultiplier || CONFIG.PLAYER.RUN_MULTIPLIER;
        
        // Physics
        this.velocity = new BABYLON.Vector3();
        this.direction = new BABYLON.Vector3();
        this.moveVector = new BABYLON.Vector3();
        this.isGrounded = false;
        this.isRunning = false;
        this.isJumping = false;
        
        // Camera
        this.camera = null;
        this.cameraOffset = new BABYLON.Vector3(0, 1.6, 0);
        this.cameraSensitivity = options.cameraSensitivity || CONFIG.PLAYER.CAMERA.SENSITIVITY;
        this.minPitch = options.minPitch || CONFIG.PLAYER.CAMERA.MIN_PITCH;
        this.maxPitch = options.maxPitch || CONFIG.PLAYER.CAMERA.MAX_PITCH;
        this.yaw = 0;
        this.pitch = 0;
        
        // Input
        this.input = new InputManager();
        this.keys = {
            forward: 'w',
            backward: 's',
            left: 'a',
            right: 'd',
            jump: ' ',
            run: 'shift',
            crouch: 'control',
            interact: 'e',
            inventory: 'i',
            map: 'm'
        };
        
        // Inventory and equipment
        this.inventory = new Inventory(CONFIG.PLAYER.INVENTORY_SIZE);
        this.equipment = new Equipment();
        this.quickSlots = new Array(5).fill(null); // 0-4 for quick slots
        
        // Stats
        this.stats = {
            level: options.level || 1,
            experience: options.experience || 0,
            strength: options.strength || 10,
            agility: options.agility || 10,
            intelligence: options.intelligence || 10,
            stamina: options.stamina || 10,
            get maxHealth() { return 100 + (this.stamina * 5); },
            get maxMana() { return 50 + (this.intelligence * 3); },
            get maxStamina() { return 100 + (this.stamina * 2); },
            get attackPower() { return this.strength * 2; },
            get defense() { return this.agility + (this.stamina * 0.5); },
            get criticalChance() { return 0.05 + (this.agility * 0.01); }
        };
        
        // Skills
        this.skills = new Skills();
        
        // Quests
        this.quests = new QuestLog();
        
        // Effects
        this.effects = [];
        
        // Initialize
        this.init();
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupPhysics();
        this.setupInput();
    }

    createPlayerMesh() {
        // Create a simple capsule for the player
        this.mesh = BABYLON.MeshBuilder.CreateCapsule('player', {
            height: 1.8,
            radius: 0.3
        }, this.scene);
        
        // Set initial position
        this.mesh.position.copyFrom(this.position);
        
        // Create a simple material
        const material = new BABYLON.StandardMaterial('playerMaterial', this.scene);
        material.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.8);
        material.specularColor = new BABYLON.Color3(0.2, 0.2, 0.2);
        this.mesh.material = material;
        
        // Enable collisions
        this.mesh.checkCollisions = true;
    }

    setupCamera() {
        // Create a free camera
        this.camera = new BABYLON.FreeCamera('playerCamera', new BABYLON.Vector3(0, 0, 0), this.scene);
        this.camera.minZ = 0.1;
        this.camera.speed = 0; // We'll handle movement manually
        this.camera.angularSensibility = 1000;
        this.camera.applyGravity = false;
        this.camera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
        this.camera.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
        this.camera.checkCollisions = true;
        
        // Set camera as active
        this.scene.activeCamera = this.camera;
        
        // Lock pointer on click
        const canvas = this.scene.getEngine().getRenderingCanvas();
        canvas.addEventListener('click', () => {
            if (!document.pointerLockElement) {
                canvas.requestPointerLock = canvas.requestPointerLock || 
                                          canvas.mozRequestPointerLock || 
                                          canvas.webkitRequestPointerLock;
                canvas.requestPointerLock();
            }
        });
    }

    setupPhysics() {
        // Create physics impostor for the player
        this.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.CapsuleImpostor,
            { 
                mass: 1, 
                friction: 0.2, 
                restitution: 0.1,
                nativeOptions: {
                    move: true // Enable kinematic movement
                }
            },
            this.scene
        );
        
        // Enable physics for the camera
        this.camera.getScene().gravity = new BABYLON.Vector3(0, -9.81, 0);
    }

    setupInput() {
        // Keyboard input
        this.input.on('keydown', (key) => {
            // Toggle run with shift
            if (key === this.keys.run) {
                this.isRunning = true;
            }
            
            // Jump with space
            if (key === this.keys.jump && this.isGrounded) {
                this.jump();
            }
            
            // Toggle inventory
            if (key === this.keys.inventory) {
                this.toggleInventory();
            }
            
            // Toggle map
            if (key === this.keys.map) {
                this.toggleMap();
            }
        });
        
        this.input.on('keyup', (key) => {
            if (key === this.keys.run) {
                this.isRunning = false;
            }
        });
        
        // Mouse movement for camera
        this.input.on('mousemove', (delta) => {
            if (document.pointerLockElement === this.scene.getEngine().getRenderingCanvas()) {
                this.yaw -= delta.x * this.cameraSensitivity;
                this.pitch = BABYLON.Scalar.Clamp(
                    this.pitch - (delta.y * this.cameraSensitivity),
                    this.minPitch,
                    this.maxPitch
                );
            }
        });
        
        // Mouse clicks
        this.input.on('mousedown', (button) => {
            if (button === 0) { // Left click
                this.attack();
            } else if (button === 1) { // Right click
                this.block();
            } else if (button === 2) { // Middle click
                this.interact();
            }
        });
    }

    update(deltaTime) {
        if (!this.mesh || !this.camera) return;
        
        // Update movement
        this.updateMovement(deltaTime);
        
        // Update camera
        this.updateCamera();
        
        // Update physics
        this.updatePhysics(deltaTime);
        
        // Update effects
        this.updateEffects(deltaTime);
        
        // Update stats
        this.updateStats();
        
        // Update animations
        this.updateAnimations(deltaTime);
    }

    updateMovement(deltaTime) {
        // Reset movement vector
        this.moveVector.set(0, 0, 0);
        
        // Get movement input
        if (this.input.isKeyDown(this.keys.forward)) this.moveVector.z += 1;
        if (this.input.isKeyDown(this.keys.backward)) this.moveVector.z -= 1;
        if (this.input.isKeyDown(this.keys.left)) this.moveVector.x -= 1;
        if (this.input.isKeyDown(this.keys.right)) this.moveVector.x += 1;
        
        // Normalize movement vector
        if (this.moveVector.lengthSquared() > 0) {
            this.moveVector.normalize();
            
            // Apply movement speed
            let speed = this.speed;
            if (this.isRunning) {
                speed *= this.runMultiplier;
            }
            
            this.moveVector.scaleInPlace(speed * deltaTime);
            
            // Rotate movement vector based on camera yaw
            const rotationMatrix = BABYLON.Matrix.RotationY(this.yaw);
            BABYLON.Vector3.TransformNormalToRef(
                this.moveVector,
                rotationMatrix,
                this.moveVector
            );
            
            // Apply movement to position
            this.position.addInPlace(this.moveVector);
        }
    }

    updateCamera() {
        // Update camera position to follow player
        this.camera.position.copyFrom(this.position).addInPlace(this.cameraOffset);
        
        // Update camera rotation
        this.camera.rotation.x = this.pitch;
        this.camera.rotation.y = this.yaw;
        
        // Update player mesh rotation to match camera yaw
        this.mesh.rotation.y = this.yaw;
    }

    updatePhysics(deltaTime) {
        if (!this.physicsImpostor) return;
        
        // Apply gravity
        if (!this.isGrounded) {
            this.velocity.y += this.scene.gravity.y * deltaTime;
        } else {
            this.velocity.y = 0;
        }
        
        // Update position based on velocity
        this.position.addInPlace(this.velocity.scale(deltaTime));
        
        // Update physics impostor position
        this.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
        this.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
        this.physicsImpostor.setNewBodyPosition(this.position);
        
        // Check if grounded
        this.checkGrounded();
    }

    checkGrounded() {
        // Cast a ray downward to check for ground
        const ray = new BABYLON.Ray(
            this.position.add(new BABYLON.Vector3(0, 0.5, 0)),
            new BABYLON.Vector3(0, -1, 0),
            1.1
        );
        
        const hit = this.scene.pickWithRay(ray);
        this.isGrounded = hit.hit && hit.distance < 1.1;
    }

    updateEffects(deltaTime) {
        // Update active effects
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            effect.duration -= deltaTime;
            
            if (effect.duration <= 0) {
                // Effect expired
                if (effect.onEnd) effect.onEnd(this);
                this.effects.splice(i, 1);
            } else {
                // Update effect
                if (effect.onUpdate) effect.onUpdate(this, deltaTime);
            }
        }
    }

    updateStats() {
        // Update any stats that might change based on equipment or effects
        const equipmentStats = this.equipment.getStats();
        
        // Apply equipment bonuses
        for (const stat in equipmentStats) {
            if (this.stats[stat] !== undefined) {
                this.stats[stat] += equipmentStats[stat];
            }
        }
        
        // Ensure health doesn't exceed max
        this.health = Math.min(this.health, this.stats.maxHealth);
    }

    updateAnimations(deltaTime) {
        // Update player animations based on state
        if (this.moveVector.lengthSquared() > 0) {
            if (this.isRunning) {
                this.playAnimation('run');
            } else {
                this.playAnimation('walk');
            }
        } else {
            this.playAnimation('idle');
        }
    }

    jump() {
        if (this.isGrounded) {
            this.velocity.y = this.jumpForce;
            this.isGrounded = false;
            this.isJumping = true;
            
            // Play jump sound
            if (this.scene.audio) {
                this.scene.audio.playSound('jump');
            }
        }
    }

    attack() {
        // Check if attack is on cooldown
        if (this.attackCooldown > 0) return;
        
        // Play attack animation
        this.playAnimation('attack');
        
        // Get equipped weapon or use default attack
        const weapon = this.equipment.getSlot('mainHand');
        const damage = weapon ? 
            weapon.damage + (this.stats.strength * 0.5) : 
            this.stats.attackPower;
        
        // Check for hits
        this.checkAttackHit(damage);
        
        // Set attack cooldown
        this.attackCooldown = weapon ? 
            weapon.attackSpeed : 
            CONFIG.COMBAT.BASE_ATTACK_RATE;
            
        // Play attack sound
        if (this.scene.audio) {
            const soundName = weapon ? 
                `weapon_${weapon.type}_swing` : 'punch';
            this.scene.audio.playSound(soundName);
        }
    }

    checkAttackHit(damage) {
        // Create a ray in the direction the player is facing
        const ray = new BABYLON.Ray(
            this.position.add(new BABYLON.Vector3(0, 1, 0)),
            this.getForwardVector(),
            CONFIG.COMBAT.BASE_ATTACK_RANGE
        );
        
        // Check for hits
        const hit = this.scene.pickWithRay(ray);
        if (hit.pickedMesh && hit.pickedMesh !== this.mesh) {
            // Check if the hit object has an entity component
            const entity = this.scene.getEntityByMesh(hit.pickedMesh);
            if (entity && entity.takeDamage) {
                // Calculate final damage with critical hit chance
                const isCritical = Math.random() < this.stats.criticalChance;
                const finalDamage = isCritical ? damage * 1.5 : damage;
                
                // Apply damage
                const killed = entity.takeDamage(finalDamage);
                
                // Play hit sound
                if (this.scene.audio) {
                    const soundName = isCritical ? 'critical_hit' : 'hit';
                    this.scene.audio.playSound(soundName);
                }
                
                // Show damage numbers
                this.showDamageNumber(finalDamage, hit.pickedPoint, isCritical);
                
                // If enemy was killed, gain experience
                if (killed && entity.type === 'enemy') {
                    this.gainExperience(entity.experience || 10);
                }
            }
        }
    }

    block() {
        // Start blocking if not already blocking
        if (!this.isBlocking) {
            this.isBlocking = true;
            this.playAnimation('block_start');
            
            // Set up block end timeout
            this.blockTimeout = setTimeout(() => {
                this.stopBlocking();
            }, 2000); // Max block duration
            
            // Play block sound
            if (this.scene.audio) {
                this.scene.audio.playSound('block');
            }
        }
    }

    stopBlocking() {
        if (this.isBlocking) {
            this.isBlocking = false;
            clearTimeout(this.blockTimeout);
            this.playAnimation('block_end');
        }
    }

    interact() {
        // Check for interactable objects in front of the player
        const ray = new BABYLON.Ray(
            this.position.add(new BABYLON.Vector3(0, 1, 0)),
            this.getForwardVector(),
            3 // Interaction range
        );
        
        const hit = this.scene.pickWithRay(ray);
        if (hit.pickedMesh) {
            const entity = this.scene.getEntityByMesh(hit.pickedMesh);
            if (entity && entity.onInteract) {
                entity.onInteract(this);
            }
        }
    }

    takeDamage(amount, source = null) {
        // Apply damage reduction from armor/stats
        const damageReduction = this.stats.defense * 0.01;
        const finalDamage = Math.max(1, amount * (1 - damageReduction));
        
        // Apply damage
        this.health -= finalDamage;
        
        // Show damage number
        this.showDamageNumber(finalDamage, this.position.add(new BABYLON.Vector3(0, 2, 0)), false);
        
        // Play hurt sound
        if (this.scene.audio) {
            this.scene.audio.playSound('player_hurt');
        }
        
        // Check for death
        if (this.health <= 0) {
            this.die(source);
            return true; // Entity was killed
        }
        
        return false; // Entity is still alive
    }

    die(killer = null) {
        // Play death animation
        this.playAnimation('die');
        
        // Disable controls
        this.enabled = false;
        
        // Show death screen
        if (this.scene.ui) {
            this.scene.ui.showDeathScreen(killer);
        }
        
        // Play death sound
        if (this.scene.audio) {
            this.scene.audio.playSound('player_death');
        }
        
        // Respawn after delay
        setTimeout(() => {
            this.respawn();
        }, 5000);
    }

    respawn() {
        // Reset health
        this.health = this.stats.maxHealth;
        
        // Reset position to spawn point
        this.position.copyFrom(this.spawnPoint || BABYLON.Vector3.Zero());
        
        // Reset state
        this.enabled = true;
        
        // Hide death screen
        if (this.scene.ui) {
            this.scene.ui.hideDeathScreen();
        }
    }

    gainExperience(amount) {
        // Apply any experience bonuses
        const finalAmount = Math.floor(amount * (1 + (this.stats.experienceGain || 0) * 0.01));
        
        // Add to experience
        this.stats.experience += finalAmount;
        
        // Check for level up
        const expNeeded = this.getExpForLevel(this.stats.level + 1);
        if (this.stats.experience >= expNeeded) {
            this.levelUp();
        }
        
        // Show experience gain
        if (this.scene.ui) {
            this.scene.ui.showFloatingText(`+${finalAmount} XP`, this.position.add(new BABYLON.Vector3(0, 2, 0)), 'cyan');
        }
    }

    levelUp() {
        // Increase level
        this.stats.level++;
        
        // Increase stats
        this.stats.strength += 2;
        this.stats.agility += 2;
        this.stats.intelligence += 2;
        this.stats.stamina += 2;
        
        // Restore health and mana
        this.health = this.stats.maxHealth;
        
        // Show level up effect
        if (this.scene.ui) {
            this.scene.ui.showLevelUp(this.stats.level);
        }
        
        // Play level up sound
        if (this.scene.audio) {
            this.scene.audio.playSound('level_up');
        }
        
        // Check for another level up (in case of large experience gain)
        const expNeeded = this.getExpForLevel(this.stats.level + 1);
        if (this.stats.experience >= expNeeded) {
            this.levelUp();
        }
    }

    getExpForLevel(level) {
        // Simple exponential experience curve
        return Math.floor(100 * Math.pow(1.5, level - 1));
    }

    playAnimation(name, loop = false, speed = 1.0) {
        // This would be implemented with your animation system
        // For now, we'll just log the animation
        if (this.currentAnimation !== name) {
            console.log(`Playing animation: ${name}`);
            this.currentAnimation = name;
        }
    }

    getForwardVector() {
        // Calculate forward vector from yaw rotation
        return new BABYLON.Vector3(
            Math.sin(this.yaw),
            0,
            Math.cos(this.yaw)
        ).normalize();
    }

    getRightVector() {
        // Calculate right vector from yaw rotation
        return new BABYLON.Vector3(
            Math.sin(this.yaw + Math.PI/2),
            0,
            Math.cos(this.yaw + Math.PI/2)
        ).normalize();
    }

    showDamageNumber(amount, position, isCritical = false) {
        if (this.scene.ui) {
            this.scene.ui.showDamageNumber(amount, position, isCritical);
        }
    }

    toggleInventory() {
        if (this.scene.ui) {
            this.scene.ui.toggleInventory();
        }
    }

    toggleMap() {
        if (this.scene.ui) {
            this.scene.ui.toggleMap();
        }
    }

    addEffect(effect) {
        this.effects.push(effect);
        if (effect.onStart) effect.onStart(this);
    }

    removeEffect(effectId) {
        const index = this.effects.findIndex(e => e.id === effectId);
        if (index !== -1) {
            const effect = this.effects[index];
            if (effect.onEnd) effect.onEnd(this);
            this.effects.splice(index, 1);
        }
    }

    hasEffect(effectId) {
        return this.effects.some(e => e.id === effectId);
    }

    dispose() {
        // Clean up resources
        if (this.mesh) {
            this.mesh.dispose();
            this.mesh = null;
        }
        
        if (this.physicsImpostor) {
            this.physicsImpostor.dispose();
            this.physicsImpostor = null;
        }
        
        if (this.camera) {
            this.camera.dispose();
            this.camera = null;
        }
        
        // Dispose of input
        this.input.dispose();
        
        // Clear effects
        this.effects = [];
    }
}

// Inventory System
class Inventory {
    constructor(size) {
        this.size = size;
        this.items = [];
        this.gold = 0;
        this.maxStackSize = 99;
        this.onChange = new BABYLON.Observable();
    }

    addItem(item, quantity = 1) {
        // If item is stackable, try to add to existing stack
        if (item.stackable) {
            const existingStack = this.items.find(i => 
                i.id === item.id && 
                i.quantity < this.maxStackSize
            );
            
            if (existingStack) {
                const remainingSpace = this.maxStackSize - existingStack.quantity;
                const addAmount = Math.min(remainingSpace, quantity);
                existingStack.quantity += addAmount;
                
                // Notify listeners
                this.onChange.notifyObservers({
                    type: 'item_added',
                    item: existingStack,
                    quantity: addAmount
                });
                
                // If there's more to add, recursively call with remaining
                const remaining = quantity - addAmount;
                if (remaining > 0) {
                    return this.addItem({...item}, remaining);
                }
                
                return true;
            }
        }
        
        // If we can't stack or there's no existing stack, add as new item
        if (this.items.length < this.size) {
            const newItem = {...item, quantity: Math.min(quantity, this.maxStackSize)};
            this.items.push(newItem);
            
            // Notify listeners
            this.onChange.notifyObservers({
                type: 'item_added',
                item: newItem,
                quantity: newItem.quantity
            });
            
            // If there's more to add, recursively call with remaining
            const remaining = quantity - newItem.quantity;
            if (remaining > 0) {
                return this.addItem({...item}, remaining);
            }
            
            return true;
        }
        
        return false; // Inventory full
    }

    removeItem(item, quantity = 1) {
        const index = this.items.indexOf(item);
        if (index === -1) return false;
        
        if (item.quantity > quantity) {
            // Reduce quantity
            item.quantity -= quantity;
            
            // Notify listeners
            this.onChange.notifyObservers({
                type: 'item_removed',
                item: item,
                quantity: quantity
            });
        } else {
            // Remove item entirely
            const removedItem = this.items.splice(index, 1)[0];
            
            // Notify listeners
            this.onChange.notifyObservers({
                type: 'item_removed',
                item: removedItem,
                quantity: removedItem.quantity
            });
        }
        
        return true;
    }

    hasItem(itemId, quantity = 1) {
        const total = this.items
            .filter(item => item.id === itemId)
            .reduce((sum, item) => sum + item.quantity, 0);
            
        return total >= quantity;
    }

    getItemCount(itemId) {
        return this.items
            .filter(item => item.id === itemId)
            .reduce((sum, item) => sum + item.quantity, 0);
    }

    getItems() {
        return [...this.items];
    }

    addGold(amount) {
        this.gold = Math.max(0, this.gold + amount);
        
        // Notify listeners
        this.onChange.notifyObservers({
            type: 'gold_changed',
            amount: amount,
            total: this.gold
        });
        
        return this.gold;
    }

    removeGold(amount) {
        const actualAmount = Math.min(amount, this.gold);
        this.gold = Math.max(0, this.gold - amount);
        
        // Notify listeners
        this.onChange.notifyObservers({
            type: 'gold_changed',
            amount: -actualAmount,
            total: this.gold
        });
        
        return actualAmount;
    }

    getGold() {
        return this.gold;
    }

    swapItems(index1, index2) {
        if (index1 < 0 || index1 >= this.items.length || 
            index2 < 0 || index2 >= this.items.length) {
            return false;
        }
        
        // Swap items
        [this.items[index1], this.items[index2]] = 
            [this.items[index2], this.items[index1]];
            
        // Notify listeners
        this.onChange.notounceObservers({
            type: 'items_swapped',
            index1: index1,
            index2: index2
        });
        
        return true;
    }

    clear() {
        this.items = [];
        this.gold = 0;
        
        // Notify listeners
        this.onChange.notifyObservers({
            type: 'inventory_cleared'
        });
    }

    serialize() {
        return {
            items: this.items.map(item => ({
                id: item.id,
                quantity: item.quantity,
                // Add any other serializable properties
                ...(item.data ? { data: item.data } : {})
            })),
            gold: this.gold,
            size: this.size
        };
    }

    deserialize(data) {
        if (!data) return;
        
        this.items = data.items || [];
        this.gold = data.gold || 0;
        this.size = data.size || this.size;
        
        // Notify listeners
        this.onChange.notifyObservers({
            type: 'inventory_loaded'
        });
    }
}

// Equipment System
class Equipment {
    constructor() {
        this.slots = {
            head: null,
            chest: null,
            legs: null,
            feet: null,
            mainHand: null,
            offHand: null,
            ring1: null,
            ring2: null,
            amulet: null
        };
        
        this.onEquip = new BABYLON.Observable();
        this.onUnequip = new BABYLON.Observable();
    }

    equip(item, slot = null) {
        if (!item || !item.equipSlot) return false;
        
        // If slot is not specified, use the item's default slot
        const targetSlot = slot || item.equipSlot;
        
        // Check if the slot is valid
        if (!this.slots.hasOwnProperty(targetSlot)) {
            console.error(`Invalid equipment slot: ${targetSlot}`);
            return false;
        }
        
        // Check if the slot is already occupied
        const oldItem = this.slots[targetSlot];
        if (oldItem) {
            // Unequip the old item first
            this.unequip(targetSlot);
        }
        
        // Equip the new item
        this.slots[targetSlot] = item;
        
        // Apply any stat bonuses
        if (item.stats) {
            // This would be handled by the game's stat system
        }
        
        // Notify listeners
        this.onEquip.notifyObservers({
            slot: targetSlot,
            item: item,
            oldItem: oldItem
        });
        
        return true;
    }

    unequip(slot) {
        // Check if the slot is valid
        if (!this.slots.hasOwnProperty(slot)) {
            console.error(`Invalid equipment slot: ${slot}`);
            return null;
        }
        
        // Get the item in the slot
        const item = this.slots[slot];
        if (!item) return null;
        
        // Remove the item from the slot
        this.slots[slot] = null;
        
        // Remove any stat bonuses
        if (item.stats) {
            // This would be handled by the game's stat system
        }
        
        // Notify listeners
        this.onUnequip.notifyObservers({
            slot: slot,
            item: item
        });
        
        return item;
    }

    getSlot(slot) {
        return this.slots[slot] || null;
    }

    getStats() {
        const stats = {
            strength: 0,
            agility: 0,
            intelligence: 0,
            stamina: 0,
            armor: 0,
            damage: 0,
            // Add other stats as needed
        };
        
        // Sum up stats from all equipped items
        for (const slot in this.slots) {
            const item = this.slots[slot];
            if (item && item.stats) {
                for (const stat in item.stats) {
                    if (stats.hasOwnProperty(stat)) {
                        stats[stat] += item.stats[stat];
                    }
                }
            }
        }
        
        return stats;
    }

    serialize() {
        const result = {};
        
        // Only include slots that have items
        for (const slot in this.slots) {
            if (this.slots[slot]) {
                result[slot] = {
                    id: this.slots[slot].id,
                    // Add any other serializable properties
                    ...(this.slots[slot].data ? { data: this.slots[slot].data } : {})
                };
            }
        }
        
        return result;
    }

    deserialize(data) {
        if (!data) return;
        
        // Clear all slots
        for (const slot in this.slots) {
            this.slots[slot] = null;
        }
        
        // Equip items from data
        for (const slot in data) {
            if (this.slots.hasOwnProperty(slot) && data[slot]) {
                // In a real game, you would look up the item by ID
                const item = {
                    id: data[slot].id,
                    equipSlot: slot,
                    // Add any other properties
                    ...(data[slot].data ? { data: data[slot].data } : {})
                };
                
                this.equip(item, slot);
            }
        }
    }
}

// Quest System
class QuestLog {
    constructor() {
        this.activeQuests = [];
        this.completedQuests = [];
        this.failedQuests = [];
        this.onQuestUpdated = new BABYLON.Observable();
    }

    addQuest(quest) {
        // Check if quest is already active or completed
        if (this.getQuest(quest.id)) {
            console.warn(`Quest ${quest.id} is already in progress or completed`);
            return false;
        }
        
        // Create a new quest instance
        const newQuest = {
            ...quest,
            startedAt: Date.now(),
            completed: false,
            failed: false,
            objectives: quest.objectives.map(obj => ({
                ...obj,
                current: 0,
                completed: false
            }))
        };
        
        // Add to active quests
        this.activeQuests.push(newQuest);
        
        // Notify listeners
        this.onQuestUpdated.notifyObservers({
            type: 'quest_added',
            quest: newQuest
        });
        
        return true;
    }

    updateQuest(questId, objectiveIndex, amount = 1) {
        const quest = this.getQuest(questId);
        if (!quest || quest.completed || quest.failed) return false;
        
        const objective = quest.objectives[objectiveIndex];
        if (!objective || objective.completed) return false;
        
        // Update objective progress
        objective.current = Math.min(objective.required, objective.current + amount);
        objective.completed = objective.current >= objective.required;
        
        // Check if all objectives are completed
        const allCompleted = quest.objectives.every(obj => obj.completed);
        if (allCompleted) {
            this.completeQuest(questId);
        }
        
        // Notify listeners
        this.onQuestUpdated.notifyObservers({
            type: 'objective_updated',
            quest: quest,
            objectiveIndex: objectiveIndex,
            objective: objective
        });
        
        return true;
    }

    completeQuest(questId) {
        const index = this.activeQuests.findIndex(q => q.id === questId);
        if (index === -1) return false;
        
        const quest = this.activeQuests[index];
        quest.completed = true;
        quest.completedAt = Date.now();
        
        // Move to completed quests
        this.activeQuests.splice(index, 1);
        this.completedQuests.push(quest);
        
        // Notify listeners
        this.onQuestUpdated.notifyObservers({
            type: 'quest_completed',
            quest: quest
        });
        
        // Grant rewards
        if (quest.rewards) {
            // This would be handled by the game's reward system
            console.log(`Quest ${quest.id} completed! Rewards:`, quest.rewards);
        }
        
        return true;
    }

    failQuest(questId) {
        const index = this.activeQuests.findIndex(q => q.id === questId);
        if (index === -1) return false;
        
        const quest = this.activeQuests[index];
        quest.failed = true;
        quest.failedAt = Date.now();
        
        // Move to failed quests
        this.activeQuests.splice(index, 1);
        this.failedQuests.push(quest);
        
        // Notify listeners
        this.onQuestUpdated.notifyObservers({
            type: 'quest_failed',
            quest: quest
        });
        
        return true;
    }

    getQuest(questId) {
        return this.activeQuests.find(q => q.id === questId) || 
               this.completedQuests.find(q => q.id === questId) ||
               this.failedQuests.find(q => q.id === questId);
    }

    hasQuest(questId) {
        return this.getQuest(questId) !== undefined;
    }

    isQuestCompleted(questId) {
        const quest = this.getQuest(questId);
        return quest ? quest.completed : false;
    }

    isQuestFailed(questId) {
        const quest = this.getQuest(questId);
        return quest ? quest.failed : false;
    }

    getActiveQuests() {
        return [...this.activeQuests];
    }

    getCompletedQuests() {
        return [...this.completedQuests];
    }

    getFailedQuests() {
        return [...this.failedQuests];
    }

    serialize() {
        return {
            activeQuests: this.activeQuests,
            completedQuests: this.completedQuests,
            failedQuests: this.failedQuests
        };
    }

    deserialize(data) {
        if (!data) return;
        
        this.activeQuests = data.activeQuests || [];
        this.completedQuests = data.completedQuests || [];
        this.failedQuests = data.failedQuests || [];
    }
}

// Skills System
class Skills {
    constructor() {
        this.skills = {};
        this.skillPoints = 0;
        this.onSkillUpdated = new BABYLON.Observable();
    }

    addSkill(skillId, name, maxLevel = 100, initialLevel = 1) {
        if (this.skills[skillId]) return false;
        
        this.skills[skillId] = {
            id: skillId,
            name: name,
            level: Math.max(1, Math.min(initialLevel, maxLevel)),
            experience: 0,
            maxLevel: maxLevel
        };
        
        return true;
    }

    addExperience(skillId, amount) {
        const skill = this.skills[skillId];
        if (!skill || skill.level >= skill.maxLevel) return false;
        
        // Apply any experience modifiers
        const finalAmount = Math.floor(amount);
        
        // Add experience
        skill.experience += finalAmount;
        
        // Check for level up
        const expNeeded = this.getExperienceForLevel(skill.level + 1);
        if (skill.experience >= expNeeded && skill.level < skill.maxLevel) {
            this.levelUp(skillId);
        }
        
        // Notify listeners
        this.onSkillUpdated.notifyObservers({
            type: 'experience_added',
            skillId: skillId,
            amount: finalAmount,
            skill: skill
        });
        
        return true;
    }

    levelUp(skillId) {
        const skill = this.skills[skillId];
        if (!skill || skill.level >= skill.maxLevel) return false;
        
        skill.level++;
        
        // Notify listeners
        this.onSkillUpdated.notifyObservers({
            type: 'skill_level_up',
            skillId: skillId,
            newLevel: skill.level,
            skill: skill
        });
        
        return true;
    }

    getSkill(skillId) {
        return this.skills[skillId] || null;
    }

    getSkillLevel(skillId) {
        const skill = this.getSkill(skillId);
        return skill ? skill.level : 0;
    }

    getExperienceForLevel(level) {
        // Simple exponential experience curve
        return Math.floor(100 * Math.pow(1.1, level - 1));
    }

    addSkillPoint() {
        this.skillPoints++;
        
        // Notify listeners
        this.onSkillUpdated.notifyObservers({
            type: 'skill_point_added',
            total: this.skillPoints
        });
    }

    spendSkillPoint(skillId) {
        if (this.skillPoints <= 0) return false;
        
        const skill = this.skills[skillId];
        if (!skill || skill.level >= skill.maxLevel) return false;
        
        this.skillPoints--;
        skill.level++;
        
        // Notify listeners
        this.onSkillUpdated.notifyObservers({
            type: 'skill_point_spent',
            skillId: skillId,
            newLevel: skill.level,
            remainingPoints: this.skillPoints,
            skill: skill
        });
        
        return true;
    }

    getSkills() {
        return Object.values(this.skills);
    }

    serialize() {
        return {
            skills: this.skills,
            skillPoints: this.skillPoints
        };
    }

    deserialize(data) {
        if (!data) return;
        
        this.skills = data.skills || {};
        this.skillPoints = data.skillPoints || 0;
    }
}

// Export for Node.js/CommonJS
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        Player,
        Inventory,
        Equipment,
        QuestLog,
        Skills
    };
}
