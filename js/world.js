// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.8
// Includes Base Entity, Character, Enemy AI, and Loot
// ============================================================

// Base Entity class
function Entity(scene, position) {
  this.scene = scene;

  if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
    if (position instanceof BABYLON.Vector3) {
      this.position = position.clone();
    } else {
      this.position = new BABYLON.Vector3(position.x, position.y, position.z);
    }
  } else {
    this.position = position || { x: 0, y: 0, z: 0 };
  }

  this.mesh = null;
  this.isDead = false;
}

Entity.prototype.update = function (deltaTime) {
  if (this.mesh && this.mesh.position && this.position &&
      typeof this.mesh.position.copyFrom === "function") {
    this.mesh.position.copyFrom(this.position);
  }
};

Entity.prototype.dispose = function () {
  this.isDead = true;
  if (this.mesh && typeof this.mesh.dispose === "function") {
    this.mesh.dispose();
    this.mesh = null;
  }
};


// ============================================================
// CHARACTER CLASS (Base for Player and Enemy)
// ============================================================
class Character extends Entity {
    constructor(scene, position, name) {
        super(scene, position);
        this.name = name;
        this.isDead = false;
        this.isPlayer = false;
        
        // Base Stats (Actual stats loaded by Player/Enemy constructors)
        this.stats = { maxHealth: 100, attackPower: 10, moveSpeed: 5.5 };
        this.health = this.stats.maxHealth;
        this.combat = { globalCooldown: 0 };
    }
    
    takeDamage(damage, source = null) {
        if (this.isDead) return;
        this.health -= damage;
        
        const messageType = this.isPlayer ? 'playerDamage' : 'enemyDamage';
        this.scene.game.ui.showMessage(`-${damage.toFixed(0)} HP`, 1000, messageType, this.mesh);
        
        if (this.health <= 0) {
            this.health = 0;
            this.onDeath(source);
        }
    }
    
    onDeath(killer) {
        this.isDead = true;
    }

    update(deltaTime) {
        super.update(deltaTime);
        // Common update logic (e.g., gravity check, global cooldown)
    }
}


// ============================================================
// LOOT CONTAINER CLASS
// ============================================================
class LootContainer extends Entity {
    constructor(scene, position, lootData) {
        super(scene, position, 'LootContainer');
        this.rawLootData = lootData || {};
        this.loot = this._generateLoot(); 
        this.isOpened = false;
        this.disposeTimer = 300; 

        // Create visual mesh
        const mesh = BABYLON.MeshBuilder.CreateBox('lootbox', { size: 0.5 }, this.scene);
        mesh.position.copyFrom(this.position);
        mesh.position.y = World.getTerrainHeight(this.position) + 0.25; 
        mesh.isPickable = true;
        mesh.material = new BABYLON.StandardMaterial('lootMat', this.scene);
        mesh.material.diffuseColor = BABYLON.Color3.Yellow();
        mesh.metadata = { isLoot: true, owner: this };
        this.mesh = mesh;
    }

    _generateLoot() {
        const generatedLoot = [];
        const itemTemplates = this.scene.game.itemTemplates;

        // 1. Handle Gold/Currency
        if (this.rawLootData.gold) {
            const [min, max] = this.rawLootData.gold;
            const goldAmount = Math.floor(Math.random() * (max - min + 1)) + min;
            if (goldAmount > 0) {
                generatedLoot.push({ item_template_id: -1, name: 'Gold', quantity: goldAmount });
            }
        }

        // 2. Handle Dropped Items
        if (this.rawLootData.items && Array.isArray(this.rawLootData.items)) {
            this.rawLootData.items.forEach(lootRule => {
                if (Math.random() < (lootRule.chance || 1.0)) {
                    const template = itemTemplates.get(lootRule.item_template_id);
                    if (template) {
                        const [min, max] = lootRule.quantity;
                        const quantity = Math.floor(Math.random() * (max - min + 1)) + min;
                        if (quantity > 0) {
                            generatedLoot.push({ item_template_id: lootRule.item_template_id, quantity: quantity });
                        }
                    }
                }
            });
        }
        return generatedLoot;
    }

    update(deltaTime) {
        super.update(deltaTime);
        if (this.disposeTimer > 0) {
            this.disposeTimer -= deltaTime;
            if (this.disposeTimer <= 0) {
                this.dispose(); 
            }
        }
    }
}


// ============================================================
// ENEMY CLASS (AI Implementation)
// ============================================================
class Enemy extends Character {
    constructor(scene, position, template, spawnData) {
        super(scene, position, template.name); 
        this.isPlayer = false;
        this.template = template;
        this.spawnData = spawnData; 
        
        this.state = 'Idle'; 
        this.combat = {
            globalCooldown: 0,
            attackRange: 2.0 
        };
        this.target = this.scene.game.player; 
        this.origin = position.clone(); 
        this.detectionRange = 15; 
        this.aggroRange = 30; 
        
        this.stats = {
            maxHealth: template.stats.maxHealth || 50,
            attackPower: template.stats.attackPower || 5,
            moveSpeed: template.stats.moveSpeed || 3.0,
        };
        this.health = this.stats.maxHealth;
        
        this.input = { forward: false, backward: false, left: false, right: false };
        
        this.setupMesh(); 
    }
    
    setupMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateBox(this.name, { size: 1.0, height: 1.5 }, this.scene);
        this.position.copyFrom(this.origin);
        this.mesh.position.y = World.getTerrainHeight(this.position) + 0.75; 
        this.mesh.isPickable = true;
        
        const mat = new BABYLON.StandardMaterial(`${this.name}Mat`, this.scene);
        mat.diffuseColor = BABYLON.Color3.Red();
        this.mesh.material = mat;
        
        this.mesh.metadata = { isEnemy: true, owner: this };
    }
    
    castAbility(target) {
        if (this.isDead || this.combat.globalCooldown > 0) return false;
        
        this.combat.globalCooldown = CONFIG.COMBAT.GLOBAL_COOLDOWN; 

        const damage = this.stats.attackPower + (Math.random() * 2 - 1); 
        
        target.takeDamage(damage, this); 
        
        return true;
    }

    handleMovement(deltaTime) {
        let speed = this.stats.moveSpeed;
        if (this.input.forward) {
            const forward = this.mesh.forward;
            this.position.addInPlace(forward.scale(speed * deltaTime));
        }
    }
    
    handleRotation() {}
    
    onDeath(killer) {
        if (this.isDead) return;
        super.onDeath(killer);
        
        this.scene.game.ui.showMessage(`${this.name} was defeated!`, 2000, 'success');
        
        if (this.template.loot_table) {
            const lootPosition = this.position.clone();
            lootPosition.y = World.getTerrainHeight(lootPosition) + 0.1; 
            this.scene.game.world.loots.push(new LootContainer(this.scene, lootPosition, this.template.loot_table));
        }
        
        this.dispose();
    }

    update(deltaTime) {
        super.update(deltaTime); 
        if (this.isDead) return;

        const player = this.scene.game.player;
        const distance = BABYLON.Vector3.Distance(this.position, player.position);
        const homeDistance = BABYLON.Vector3.Distance(this.position, this.origin);
        
        if (this.combat.globalCooldown > 0) {
            this.combat.globalCooldown -= deltaTime;
        }
        
        this.input.forward = false;

        // --- AI State Machine ---
        if (this.state === 'Idle' || this.state === 'Wander') {
            if (distance < this.detectionRange) { this.state = 'Chase'; }
        }
        
        if (this.state === 'Chase') {
            if (distance > this.aggroRange || player.isDead) {
                this.state = 'Return'; 
            } else if (distance <= this.combat.attackRange) {
                this.state = 'Attack'; 
            } else {
                this.faceTarget(player.position);
                this.input.forward = true;
            }
        }
        
        if (this.state === 'Attack') {
            if (distance > this.combat.attackRange * 1.5) { 
                this.state = 'Chase'; 
            } else {
                this.faceTarget(player.position);
                this.castAbility(player); 
            }
        }
        
        if (this.state === 'Return') {
            if (homeDistance < 1.0) {
                this.state = 'Idle'; 
            } else {
                this.faceTarget(this.origin);
                this.input.forward = true;
            }
        }
        
        this.handleMovement(deltaTime);
        this.mesh.position.y = World.getTerrainHeight(this.position) + 0.75; 
    }
    
    faceTarget(targetPosition) {
        const direction = targetPosition.subtract(this.position);
        const angle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = angle; 
    }
}


// ============================================================
// WORLD CLASS
// ============================================================

class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.options = { size: options.size || CONFIG.WORLD.SIZE };
        
        this.terrain = null;
        this.npcs = []; 
        this.loots = [];
        this.spawnPoints = options.npcSpawns || []; 
        this.npcTemplates = options.npcTemplates || new Map(); 
        this.activeSpawns = new Map(); 
    }
    
    static getTerrainHeight(position) {
        // Placeholder implementation
        return 0; 
    }

    async init() {
        // Assume generateWorld and other setup is here
        this.initializeSpawns();
    }
    
    initializeSpawns() {
        if (this.spawnPoints.length === 0) return;

        this.spawnPoints.forEach(spawnData => {
            const template = this.npcTemplates.get(spawnData.npc_template_id);
            if (!template) return;

            this.activeSpawns.set(spawnData.id, []);
            
            for (let i = 0; i < spawnData.max_spawn; i++) {
                 this.trySpawn(spawnData, template);
            }
            
            // Set up a permanent respawn loop
            setInterval(() => {
                this.trySpawn(spawnData, template);
            }, spawnData.respawn_seconds * 1000);
        });
    }
    
    trySpawn(spawnData, template) {
        const currentEntities = this.activeSpawns.get(spawnData.id).filter(e => !e.isDead);
        
        if (currentEntities.length >= spawnData.max_spawn) return false; 
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * spawnData.spawn_radius;
        
        const offsetX = distance * Math.cos(angle);
        const offsetZ = distance * Math.sin(angle);
        
        const spawnPosition = new BABYLON.Vector3(
            spawnData.position_x + offsetX,
            spawnData.position_y + 10, 
            spawnData.position_z + offsetZ
        );
        
        const newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);
        
        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);
        
        return newEnemy;
    }
    
    update(deltaTime) {
        this.npcs = this.npcs.filter(npc => !npc.isDead); 
        this.npcs.forEach(npc => npc.update(deltaTime));
        
        this.loots = this.loots.filter(loot => !loot.isDead);
        this.loots.forEach(loot => loot.update(deltaTime));
    }
    
    dispose() {
        this.npcs.forEach(npc => npc.dispose());
        this.loots.forEach(loot => loot.dispose());
    }
}
