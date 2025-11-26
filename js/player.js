class Player extends Entity {
    constructor(scene) {
        super(scene);
        this.camera = null;
        this.velocity = new BABYLON.Vector3();
        this.isOnGround = false;
        this.moveSpeed = CONFIG.PLAYER.MOVE_SPEED;
        this.jumpForce = CONFIG.PLAYER.JUMP_FORCE;
        this.inventory = new Inventory(CONFIG.PLAYER.INVENTORY_SIZE);
        this.equipment = new Equipment();
        this.stats = this.createDefaultStats();
        this.skills = new Skills();
        this.quests = new QuestLog();
        this.target = null;
        this.keys = {};
        this.mouseDelta = { x: 0, y: 0 };
        this.yaw = 0;
        this.pitch = 0;
        
        this.init();
    }

    createDefaultStats() {
        return {
            level: 1,
            experience: 0,
            strength: 10,
            agility: 10,
            intelligence: 10,
            stamina: 10,
            get maxHealth() { return 100 + (this.stamina * 5); },
            get maxMana() { return 50 + (this.intelligence * 3); },
            get attackPower() { return this.strength * 2; },
            get defense() { return this.agility + (this.stamina * 0.5); }
        };
    }

    init() {
        this.createPlayerMesh();
        this.setupCamera();
        this.setupInput();
        this.setupCombat();
    }

    createPlayerMesh() {
        // Create a simple capsule for the player
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
            { mass: 1, friction: 0.2, restitution: 0.1 },
            this.scene
        );
    }

    setupCamera() {
        // Create a free camera
        this.camera = new BABYLON.FreeCamera('playerCamera', new BABYLON.Vector3(0, 1.6, -5), this.scene);
        this.camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
        this.camera.minZ = 0.1;
        this.camera.speed = 0;
        this.camera.angularSensibility = 5000;
        this.camera.applyGravity = false;
        this.camera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
        this.camera.checkCollisions = true;
        
        // Set initial camera position
        this.camera.parent = this.mesh;
        this.camera.position = new BABYLON.Vector3(0, 1.6, 0);
    }

    setupInput() {
        const canvas = this.scene.getEngine().getRenderingCanvas();
        
        // Keyboard input
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            // Toggle debug mode with F1
            if (e.key === 'F1') {
                CONFIG.GAME.DEBUG = !CONFIG.GAME.DEBUG;
                console.log('Debug mode:', CONFIG.GAME.DEBUG);
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse look
        canvas.addEventListener('mousemove', (e) => {
            if (!document.pointerLockElement) return;
            
            const sensitivity = CONFIG.PLAYER.CAMERA.SENSITIVITY;
            this.yaw -= e.movementX * sensitivity;
            this.pitch = BABYLON.Scalar.Clamp(
                this.pitch - (e.movementY * sensitivity),
                CONFIG.PLAYER.CAMERA.MIN_PITCH,
                CONFIG.PLAYER.CAMERA.MAX_PITCH
            );
            
            this.mesh.rotation.y = this.yaw;
            this.camera.rotation.x = this.pitch;
        });
        
        // Click to lock pointer
        canvas.addEventListener('click', () => {
            canvas.requestPointerLock = canvas.requestPointerLock || 
                                       canvas.mozRequestPointerLock || 
                                       canvas.webkitRequestPointerLock;
            canvas.requestPointerLock();
        });
    }

    setupCombat() {
        this.attackCooldown = 0;
        this.combatAbilities = [];
        this.effects = [];
    }

    update(deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;
        
        // Handle movement
        this.handleMovement(deltaTime);
        
        // Update combat
        this.updateCombat(deltaTime);
        
        // Update effects
        this.updateEffects(deltaTime);
        
        // Update stats
        this.updateStats();
    }

    handleMovement(deltaTime) {
        if (!this.camera) return;
        
        const moveVector = BABYLON.Vector3.Zero();
        const forward = this.camera.getForwardRay().direction;
        const right = this.camera.getRightRay().direction;
        
        // Flatten y to keep movement horizontal
        forward.y = 0;
        right.y = 0;
        forward.normalize();
        right.normalize();
        
        // Apply movement based on input
        if (this.keys['w'] || this.keys['arrowup']) moveVector.addInPlace(forward);
        if (this.keys['s'] || this.keys['arrowdown']) moveVector.addInPlace(forward.scale(-1));
        if (this.keys['a'] || this.keys['arrowleft']) moveVector.addInPlace(right.scale(-1));
        if (this.keys['d'] || this.keys['arrowright']) moveVector.addInPlace(right);
        
        // Normalize and apply speed
        if (moveVector.lengthSquared() > 0) {
            moveVector.normalize().scaleInPlace(this.moveSpeed * deltaTime * 60);
            
            // Apply movement
            const newPosition = this.mesh.position.add(moveVector);
            this.mesh.position.copyFrom(newPosition);
        }
        
        // Jumping
        if ((this.keys[' '] || this.keys[' ']) && this.isOnGround) {
            this.velocity.y = this.jumpForce;
            this.isOnGround = false;
        }
        
        // Apply gravity
        this.velocity.y += this.scene.gravity.y * deltaTime;
        this.mesh.position.y += this.velocity.y * deltaTime;
        
        // Simple ground check
        const ray = new BABYLON.Ray(
            this.mesh.position.add(new BABYLON.Vector3(0, 0.5, 0)),
            new BABYLON.Vector3(0, -1, 0),
            1.1
        );
        
        const hit = this.scene.pickWithRay(ray);
        this.isOnGround = hit.hit && hit.distance < 1.1;
        
        if (this.isOnGround && this.velocity.y < 0) {
            this.velocity.y = 0;
            this.mesh.position.y = hit.pickedPoint.y;
        }
    }

    updateCombat(deltaTime) {
        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
        }
        
        // Left mouse button attack
        if (this.scene.pointerDown && this.attackCooldown <= 0) {
            this.attack();
            this.attackCooldown = 1.0 / CONFIG.COMBAT.BASE_ATTACK_RATE;
        }
    }

    attack() {
        // Simple forward attack
        const ray = new BABYLON.Ray(
            this.mesh.position.add(new BABYLON.Vector3(0, 1, 0)),
            this.mesh.forward,
            CONFIG.COMBAT.BASE_ATTACK_RANGE
        );
        
        const hit = this.scene.pickWithRay(ray);
        if (hit.pickedMesh && hit.pickedMesh !== this.mesh) {
            const entity = this.scene.getEntityByMesh(hit.pickedMesh);
            if (entity && entity.takeDamage) {
                const damage = this.calculateDamage();
                const isDead = entity.takeDamage(damage);
                console.log(`Hit ${hit.pickedMesh.name} for ${damage} damage${isDead ? ' (killed)' : ''}`);
            }
        }
    }

    calculateDamage() {
        let damage = CONFIG.COMBAT.BASE_DAMAGE;
        
        // Add weapon damage if equipped
        if (this.equipment.mainHand && this.equipment.mainHand.damage) {
            damage += this.equipment.mainHand.damage;
        }
        
        // Add stat bonuses
        damage += this.stats.attackPower * 0.5;
        
        // Add some randomness
        damage *= 0.8 + Math.random() * 0.4;
        
        return Math.max(1, Math.floor(damage));
    }

    updateEffects(deltaTime) {
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const effect = this.effects[i];
            effect.duration -= deltaTime;
            if (effect.duration <= 0) {
                effect.remove(this);
                this.effects.splice(i, 1);
            } else {
                effect.update(deltaTime, this);
            }
        }
    }

    addEffect(effect) {
        this.effects.push(effect);
        effect.apply(this);
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

    addExperience(amount) {
        this.stats.experience += amount;
        const expNeeded = this.getExpForLevel(this.stats.level + 1);
        
        if (this.stats.experience >= expNeeded) {
            this.levelUp();
        }
    }

    levelUp() {
        this.stats.level++;
        this.stats.strength += 2;
        this.stats.agility += 2;
        this.stats.intelligence += 2;
        this.stats.stamina += 2;
        
        // Heal on level up
        this.health = this.stats.maxHealth;
        
        console.log(`Level up! You are now level ${this.stats.level}`);
    }

    getExpForLevel(level) {
        return Math.floor(100 * Math.pow(1.5, level - 1));
    }
}

// Inventory System
class Inventory {
    constructor(size) {
        this.size = size;
        this.items = [];
        this.gold = 0;
    }

    addItem(item, quantity = 1) {
        // Stack if item exists and is stackable
        if (item.stackable) {
            const existing = this.items.find(i => i.id === item.id);
            if (existing) {
                existing.quantity += quantity;
                return true;
            }
        }
        
        // Add new item if there's space
        if (this.items.length < this.size) {
            item.quantity = quantity;
            this.items.push(item);
            return true;
        }
        return false;
    }

    removeItem(index, quantity = 1) {
        if (index < 0 || index >= this.items.length) return null;
        
        const item = this.items[index];
        if (item.quantity > quantity) {
            item.quantity -= quantity;
            return { ...item, quantity };
        } else {
            return this.items.splice(index, 1)[0];
        }
    }

    hasItem(itemId, quantity = 1) {
        const item = this.items.find(i => i.id === itemId);
        return item && item.quantity >= quantity;
    }

    addGold(amount) {
        this.gold = Math.max(0, this.gold + amount);
        return this.gold;
    }

    removeGold(amount) {
        if (this.gold >= amount) {
            this.gold -= amount;
            return amount;
        }
        return 0;
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
    }

    equip(item) {
        if (!item || !item.slot) return false;
        
        const oldItem = this.slots[item.slot];
        this.slots[item.slot] = item;
        return oldItem; // Return the item that was replaced
    }

    unequip(slot) {
        const item = this.slots[slot];
        if (item) {
            this.slots[slot] = null;
            return item;
        }
        return null;
    }

    getStats() {
        const stats = {
            strength: 0,
            agility: 0,
            intelligence: 0,
            stamina: 0,
            armor: 0,
            damage: 0
        };

        for (const slot in this.slots) {
            const item = this.slots[slot];
            if (item && item.stats) {
                for (const stat in item.stats) {
                    if (stats[stat] !== undefined) {
                        stats[stat] += item.stats[stat];
                    }
                }
            }
        }

        return stats;
    }
}

// Quest System
class QuestLog {
    constructor() {
        this.activeQuests = [];
        this.completedQuests = [];
    }

    addQuest(quest) {
        if (!this.hasQuest(quest.id) && !this.isQuestCompleted(quest.id)) {
            this.activeQuests.push({
                ...quest,
                objectives: quest.objectives.map(obj => ({...obj, current: 0})),
                isCompleted: false
            });
            return true;
        }
        return false;
    }

    updateQuest(questId, objectiveIndex, amount = 1) {
        const quest = this.getQuest(questId);
        if (quest && !quest.isCompleted) {
            const objective = quest.objectives[objectiveIndex];
            if (objective) {
                objective.current = Math.min(objective.required, objective.current + amount);
                quest.isCompleted = quest.objectives.every(obj => obj.current >= obj.required);
                return true;
            }
        }
        return false;
    }

    completeQuest(questId) {
        const index = this.activeQuests.findIndex(q => q.id === questId);
        if (index !== -1) {
            const quest = this.activeQuests[index];
            this.completedQuests.push({
                ...quest,
                completedAt: Date.now()
            });
            this.activeQuests.splice(index, 1);
            return true;
        }
        return false;
    }

    hasQuest(questId) {
        return this.activeQuests.some(q => q.id === questId);
    }

    isQuestCompleted(questId) {
        return this.completedQuests.some(q => q.id === questId);
    }

    getQuest(questId) {
        return this.activeQuests.find(q => q.id === questId);
    }
}

// Skills System
class Skills {
    constructor() {
        this.skills = {
            // Combat
            swords: { level: 1, xp: 0 },
            archery: { level: 1, xp: 0 },
            magic: { level: 1, xp: 0 },
            
            // Crafting
            blacksmithing: { level: 1, xp: 0 },
            alchemy: { level: 1, xp: 0 },
            enchanting: { level: 1, xp: 0 },
            
            // Gathering
            mining: { level: 1, xp: 0 },
            herbalism: { level: 1, xp: 0 },
            skinning: { level: 1, xp: 0 }
        };
    }

    addXp(skill, amount) {
        if (this.skills[skill]) {
            this.skills[skill].xp += amount;
            const xpNeeded = this.getXpForLevel(this.skills[skill].level + 1);
            
            if (this.skills[skill].xp >= xpNeeded) {
                this.levelUp(skill);
            }
        }
    }

    levelUp(skill) {
        if (this.skills[skill]) {
            this.skills[skill].level++;
            console.log(`${skill} leveled up to ${this.skills[skill].level}!`);
        }
    }

    getXpForLevel(level) {
        return Math.floor(100 * Math.pow(1.2, level - 1));
    }

    getSkillLevel(skill) {
        return this.skills[skill] ? this.skills[skill].level : 0;
    }
}

// Add getEntityByMesh helper to scene
BABYLON.Scene.prototype.getEntityByMesh = function(mesh) {
    // This will be populated by the World class
    return this._entities ? this._entities.get(mesh) : null;
};
