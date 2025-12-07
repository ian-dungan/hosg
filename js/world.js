// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.9 (PATCHED)
// Fix: Added missing World.loadSpawns method and initialization of entity lists.
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
// (Assuming this exists and is complete)
// ============================================================
class Character extends Entity {
    constructor(scene, position, name) {
        super(scene, position);
        this.name = name;
        this.isDead = false;
        // Placeholder methods/properties for Character functionality
        this.health = 100;
        this.visualRoot = null; 
    }
    
    // Placeholder takeDamage method to prevent future errors
    takeDamage(damage) {
        this.health -= damage;
        if (this.health <= 0) {
            this.isDead = true;
            this.dispose();
        }
    }
}

// ============================================================
// ENEMY CLASS (Simple placeholder for spawns)
// (Assuming this exists and extends Character)
// ============================================================
class Enemy extends Character {
    constructor(scene, position, template, spawnData) {
        super(scene, position, template.name);
        this.template = template;
        this.spawnData = spawnData;
        this.isNPC = true;
        this._initMesh(); // Initialize visual
    }
    
    _initMesh() {
        // Simple placeholder visual for the spawned NPC
        this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name + "Collider", { diameter: 1.0 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        
        this.visualRoot = new BABYLON.TransformNode(this.name + "VisualRoot", this.scene);
        this.visualRoot.parent = this.mesh;

        const sphere = BABYLON.MeshBuilder.CreateSphere(this.name + "Visual", { diameter: 1.0 }, this.scene);
        sphere.parent = this.visualRoot;
        
        // Mark the mesh for targeting
        this.mesh.metadata = {
            isEnemy: true,
            isNPC: true,
            character: this
        };
        
        // Simple Material
        const mat = new BABYLON.StandardMaterial("npcMat", this.scene);
        mat.diffuseColor = BABYLON.Color3.Red(); // Or a color based on template
        sphere.material = mat;
    }
    
    // Overriding the base update to allow enemies to move/AI logic
    update(deltaTime) {
        super.update(deltaTime);
        // Simple AI/Movement logic goes here
    }
}


// ============================================================
// Loot Container (Placeholder)
// ============================================================
class LootContainer extends Entity {
    constructor(scene, position, lootData) {
        super(scene, position);
        this.lootData = lootData;
        this.isOpened = false;
        this.isLoot = true;
        this._initMesh();
    }
    
    _initMesh() {
        this.mesh = BABYLON.MeshBuilder.CreateBox("LootBox", { size: 1.0 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.metadata = { isLoot: true, loot: this };
        
        const mat = new BABYLON.StandardMaterial("lootMat", this.scene);
        mat.diffuseColor = BABYLON.Color3.Yellow();
        this.mesh.material = mat;
    }
}

// World Class
class World {
    constructor(scene, options = {}) {
        this.scene = scene;
        this.options = {
            size: options.size || CONFIG.WORLD.SIZE,
            // ... other options
        };

        // --- ADDED/Initialized these properties ---
        this.npcs = [];
        this.loots = [];
        this.activeSpawns = new Map(); // Map<spawnId, Array<Enemy>>
        // --- END ADDED ---
        
        this.createTerrain();
        this.createWater();
    }

    // Creates a simple ground plane
    createTerrain() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", {
            width: this.options.size,
            height: this.options.size,
            subdivisions: 10
        }, this.scene);
        
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.2);
        ground.material = groundMat;
        ground.checkCollisions = true; // Enable collisions for terrain
        ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            ground, 
            BABYLON.PhysicsImpostor.BoxImpostor, 
            { mass: 0, restitution: 0.9 }, 
            this.scene
        );
    }
    
    // Creates a simple water plane
    createWater() {
        const water = BABYLON.MeshBuilder.CreateGround("water", {
            width: this.options.size,
            height: this.options.size,
            subdivisions: 10
        }, this.scene);
        
        water.position.y = CONFIG.WORLD.WATER_LEVEL;
        
        const waterMat = new BABYLON.StandardMaterial("waterMat", this.scene);
        waterMat.diffuseColor = new BABYLON.Color3(0, 0.5, 0.7);
        waterMat.alpha = 0.8;
        water.material = waterMat;
    }

    /**
     * @param {Array<Object>} spawnPoints - Array of spawn records from Supabase
     * @param {Map<string, Object>} npcTemplates - Map of NPC templates (code -> template)
     */
    loadSpawns(spawnPoints, npcTemplates) {
        console.log(`[World] Loading ${spawnPoints.length} spawn points.`);
        
        // Clear existing spawns/entities
        this.npcs.forEach(npc => npc.dispose());
        this.npcs = [];
        this.activeSpawns.clear();

        spawnPoints.forEach(spawnData => {
            const template = npcTemplates.get(spawnData.npc_code);
            
            if (!template) {
                console.warn(`[World] NPC template not found for code: ${spawnData.npc_code}. Skipping spawn.`);
                return;
            }
            
            this.activeSpawns.set(spawnData.id, []);
            
            // Create initial spawns up to max_spawn
            for (let i = 0; i < spawnData.max_spawn; i++) {
                this.trySpawn(spawnData, template);
            }
            
            // Set up a permanent respawn loop
            // NOTE: This will continue running until the World is disposed.
            setInterval(() => {
                this.trySpawn(spawnData, template);
            }, spawnData.respawn_seconds * 1000);
        });
    }
    
    trySpawn(spawnData, template) {
        const currentEntities = this.activeSpawns.get(spawnData.id).filter(e => !e.isDead);
        
        if (currentEntities.length >= spawnData.max_spawn) return false; 
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (spawnData.spawn_radius || 5); // Use a default radius if missing
        
        const offsetX = distance * Math.cos(angle);
        const offsetZ = distance * Math.sin(angle);
        
        const spawnPosition = new BABYLON.Vector3(
            spawnData.position_x + offsetX,
            spawnData.position_y + 10, // Spawn above ground to account for physics
            spawnData.position_z + offsetZ
        );
        
        // Note: Assuming 'Enemy' class is defined and accepts these arguments
        const newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);
        
        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);
        
        return newEnemy;
    }
    
    update(deltaTime) {
        // Filter out disposed/dead entities
        this.npcs = this.npcs.filter(npc => !npc.isDead); 
        this.loots = this.loots.filter(loot => !loot.isDead);
        
        // Update remaining entities
        this.npcs.forEach(npc => npc.update(deltaTime));
        this.loots.forEach(loot => loot.update(deltaTime));
    }
    
    dispose() {
        console.log("[World] Disposing resources");
        
        // Dispose all entities
        this.npcs.forEach(npc => npc.dispose());
        this.loots.forEach(loot => loot.dispose());
        
        // Clean up internal lists
        this.npcs = [];
        this.loots = [];
        this.activeSpawns.clear();
        
        // Dispose meshes (Ground, Water, etc.)
        const ground = this.scene.getMeshByName("ground");
        if (ground) ground.dispose();
        
        const water = this.scene.getMeshByName("water");
        if (water) water.dispose();
    }
}
