// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.10 (PATCHED)
// Fix: Added missing World class definition and environment creation methods (createGround, createWater, createSky)
// Fix: Added placeholder Enemy class definition.
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
        // Placeholder stats (will be overwritten by Player/Enemy classes)
        this.stats = { maxHealth: 100, attackPower: 1 }; 
        this.health = this.stats.maxHealth;
    }
    
    // Placeholder damage function, necessary for the ability.js/player.js combat logic
    takeDamage(damage) {
        this.health -= damage;
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
            this.dispose(); 
        }
    }
    
    // Placeholder update function, necessary for player/enemy loops
    update(deltaTime) {
        // Base character update logic (e.g. animation, pathfinding, etc.)
    }
}


// ============================================================
// ENEMY CLASS (Extends Character - Placeholder to prevent crash)
// ============================================================
class Enemy extends Character {
    constructor(scene, position, template, spawnData) {
        super(scene, position, template.name || 'Enemy');
        this.template = template;
        this.spawnData = spawnData;
        this.isEnemy = true;
        
        // Placeholder Enemy Mesh
        this.mesh = BABYLON.MeshBuilder.CreateBox("enemyBox", { height: 1.5, width: 0.8, depth: 0.8 }, this.scene);
        this.mesh.position.copyFrom(position);
        this.mesh.material = new BABYLON.StandardMaterial("enemyMat", this.scene);
        this.mesh.material.diffuseColor = BABYLON.Color3.Red();
        
        // Add physics impostor
        if (typeof BABYLON.PhysicsImpostor !== "undefined") {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { mass: 10, friction: 0.5, restitution: 0.1 }, 
                this.scene
            );
        }

        // Metadata for player targeting
        this.mesh.metadata = { entity: this, isEnemy: true }; 
    }
}


// ============================================================
// WORLD CLASS (Implementation for Game.init())
// ============================================================
class World {
    constructor(scene) {
        this.scene = scene;
        this.npcs = [];
        this.loots = [];
        this.activeSpawns = new Map(); // Map<spawnId, Entity[]>
    }

    createGround() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            width: CONFIG.WORLD.TERRAIN_SIZE,
            height: CONFIG.WORLD.TERRAIN_SIZE
        }, this.scene);
        
        ground.checkCollisions = true;
        ground.isPickable = true;
        
        // Ground material
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.1, 0.5, 0.1); 
        ground.material = groundMat;

        // Physics impostor for ground (Static: mass 0)
        if (typeof BABYLON.PhysicsImpostor !== "undefined") {
             ground.physicsImpostor = new BABYLON.PhysicsImpostor(
                ground, 
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { mass: 0, friction: 1.0, restitution: 0.0 }, 
                this.scene
            );
        }
        console.log("[World] Ground created.");
    }
    
    createWater() {
        if (CONFIG.WORLD.WATER_LEVEL > 0) {
            const waterMesh = BABYLON.MeshBuilder.CreateGround("water", {
                width: CONFIG.WORLD.TERRAIN_SIZE,
                height: CONFIG.WORLD.TERRAIN_SIZE
            }, this.scene);
            waterMesh.position.y = CONFIG.WORLD.WATER_LEVEL;
            
            // Simple transparent blue material
            const waterMat = new BABYLON.StandardMaterial("waterMat", this.scene);
            waterMat.diffuseColor = new BABYLON.Color3(0, 0.5, 1);
            waterMat.alpha = 0.6;
            waterMesh.material = waterMat;
        }
        console.log("[World] Water created.");
    }

    createSky() {
        // Simple procedural skybox
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.disableLighting = true;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.6, 0.8);
        skybox.material = skyboxMaterial;
        console.log("[World] Sky created.");
    }

    /**
     * Initializes NPC spawns based on data fetched from Supabase.
     */
    createSpawnPoints(spawnPoints, npcTemplates) {
        if (!spawnPoints || spawnPoints.length === 0) {
            console.warn("[World] No spawn points loaded.");
            return;
        }
        
        spawnPoints.forEach(spawnData => {
            const template = npcTemplates.get(spawnData.npc_template_id);
            if (!template) {
                console.warn(`[World] Template ID ${spawnData.npc_template_id} not found for spawn point ${spawnData.id}.`);
                return;
            }
            
            // Initialize the active spawn list for this point
            this.activeSpawns.set(spawnData.id, []);
            
            // Spawn initial enemies up to max_spawn
            for (let i = 0; i < spawnData.max_spawn; i++) {
                this.trySpawn(spawnData, template);
            }

            // Set up a permanent respawn loop
            setInterval(() => {
                this.trySpawn(spawnData, template);
            }, spawnData.respawn_seconds * 1000);
        });
        console.log(`[World] Initialized ${spawnPoints.length} spawn zones.`);
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
            spawnData.position_y + 10, // Spawn above ground to fall down
            spawnData.position_z + offsetZ
        );
        
        // This relies on the placeholder Enemy class definition above
        const newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);
        
        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);
        
        return newEnemy;
    }
    
    update(deltaTime) {
        // Filter out dead NPCs/Loots and update the active ones
        this.npcs = this.npcs.filter(npc => !npc.isDead); 
        this.npcs.forEach(npc => npc.update(deltaTime));
        
        this.loots = this.loots.filter(loot => !loot.isDead);
        this.loots.forEach(loot => loot.update(deltaTime));
    }
    
    dispose() {
        this.npcs.forEach(npc => npc.dispose());
        this.loots.forEach(loot => loot.dispose());
        this.npcs.length = 0;
        this.loots.length = 0;
        this.activeSpawns.clear();
    }
}
