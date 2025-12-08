// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.11 (PATCHED)
// Fix: Added the World class definition and the required init(templates) method.
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
  this.isAttackable = false; // Entities are not attackable by default
}

Entity.prototype.update = function (deltaTime) {
    // Rely on physics impostor for position update for physics-controlled entities (Characters/NPCs)
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
        this.level = 1;
        this.health = 100;
        this.mana = 50;
        this.stamina = 100;
        this.isAttackable = true;
    }
    
    // Placeholder takeDamage method required by Ability.js
    takeDamage(damage, source) {
        this.health -= damage;
        this.health = Math.max(0, this.health);
        
        if (this.health <= 0) {
            this.die();
        }
    }
    
    die() {
        if (this.isDead) return;
        this.isDead = true;
        // Basic cleanup: Hide the mesh and remove physics
        if (this.mesh) {
            this.mesh.isVisible = false;
            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.dispose();
            }
        }
    }
}

// ============================================================
// ENEMY CLASS (Placeholder)
// ============================================================
class Enemy extends Character {
    constructor(scene, position, template, spawnData) {
        super(scene, position, template.name || 'Enemy');
        this.template = template;
        this.spawnData = spawnData;
        
        // Apply template stats
        this.level = template.level;
        this.stats = template.stats || {};
        this.health = this.stats.maxHealth || 100;
        this.isAggro = false; // State
        
        this._initMesh();
        this._initCollision(100, 0.5); 
    }
    
    _initMesh() {
        // Create a hidden mesh for physics collision
        this.mesh = BABYLON.MeshBuilder.CreateCylinder(`npcCollider_${this.name}`, { height: 1.8, diameter: 0.8 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = false;
        this.mesh.metadata = { isNPC: true, entity: this };
        
        // Create a separate node for the visual model
        this.visualRoot = new BABYLON.TransformNode(`npcVisualRoot_${this.name}`, this.scene);
        this.visualRoot.parent = this.mesh;
        
        // Placeholder cube for visual representation
        const placeholderMesh = BABYLON.MeshBuilder.CreateBox("npcBox", { size: 1.0 }, this.scene);
        placeholderMesh.material = new BABYLON.StandardMaterial("npcMat", this.scene);
        placeholderMesh.material.diffuseColor = BABYLON.Color3.Red();
        placeholderMesh.parent = this.visualRoot;
        placeholderMesh.position.y = -0.9;
    }
    
    _initCollision(mass, friction) { 
        if (this.scene.isPhysicsEnabled && typeof BABYLON.PhysicsImpostor !== "undefined") {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.SphereImpostor, 
                { mass: mass, friction: friction, restitution: 0.1 }, 
                this.scene
            );
            if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
                this.mesh.physicsImpostor.setAngularFactor(0); 
            }
        }
    }

    update(deltaTime) {
        if (this.isDead) return;
        super.update(deltaTime);
    }
}


// ============================================================
// WORLD CLASS 
// ============================================================
class World {
    constructor(scene) {
        this.scene = scene;
        this.npcs = [];
        this.loots = [];
        this.activeSpawns = new Map(); // Map<SpawnID, Entity[]>
        this.templates = {};
        
        // Make the world accessible on the scene for convenience
        this.scene.world = this; 
    }

    /**
     * Initializes the world, creates environment, and sets up NPC spawns.
     * Called from Game.js after templates are loaded.
     * @param {Object} templates - The collection of all loaded templates (items, skills, npcs, zones).
     */
    init(templates) {
        // 1. Store templates
        this.templates = templates || {};
        
        // 2. Create the environment
        this.createGround();
        this.createSky();
        this.createWater();
        
        // 3. Setup Spawns
        // Placeholder data, normally loaded from hosg_npc_spawns.
        const starterSpawnData = [
            { id: 1, npc_template_id: 101, zone_id: 1, position_x: 0, position_y: 0, position_z: 10, respawn_seconds: 15, max_spawn: 3, spawn_radius: 5.0 },
        ];

        const spawnRecords = this.templates.npcSpawnRecords || starterSpawnData;

        for (const spawnRecord of spawnRecords) {
            const npcTemplate = this.templates.npcTemplates ? this.templates.npcTemplates.get(spawnRecord.npc_template_id) : null;
            if (npcTemplate) {
                 this._loadSpawn(spawnRecord, npcTemplate);
            } else {
                 console.warn(`[World] NPC template ${spawnRecord.npc_template_id} not found for spawn ${spawnRecord.id}.`);
            }
        }
        
        console.log('[World] Initialized. Spawning NPCs...');
    }

    createGround() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, this.scene);
        
        const groundMaterial = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.6, 0.4);
        ground.material = groundMaterial;
        
        if (this.scene.isPhysicsEnabled && typeof BABYLON.PhysicsImpostor !== "undefined") {
            ground.physicsImpostor = new BABYLON.PhysicsImpostor(
                ground, 
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { mass: 0, restitution: 0.1, friction: 0.5 }, 
                this.scene
            );
        }
    }

    createWater() {
        // Placeholder for a water/lake surface
    }

    createSky() {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.disableLighting = true;
        skybox.material = skyboxMaterial;
        skybox.infiniteDistance = true;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        // Using a placeholder cube texture
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture("https://playground.babylonjs.com/textures/skybox/skybox", this.scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    }

    /**
     * Attempts to spawn an NPC based on its spawn data and template.
     */
    _loadSpawn(spawnData, template) {
        if (!this.activeSpawns.has(spawnData.id)) {
            this.activeSpawns.set(spawnData.id, []);
        }
        
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
        this.activeSpawns.clear();
        this.npcs = [];
        this.loots = [];
        
        this.scene.getMeshByName("ground")?.dispose();
        this.scene.getMeshByName("skyBox")?.dispose();
    }
}
// Ensure the World class is globally accessible
window.World = World;
