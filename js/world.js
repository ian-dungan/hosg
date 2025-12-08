// ============================================================\
// HEROES OF SHADY GROVE - WORLD CORE v1.0.18 (BASE CLASS CONSOLIDATION)
// Fix: Consolidating Entity and Character definitions here to fix dependency errors.
// ============================================================\

// ==================== BASE CLASSES ====================

// Base Entity class (MUST be defined first)
function Entity(scene, position) {
  this.scene = scene;

  if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
    if (position instanceof BABYLON.Vector3) {
      this.position = position.clone();
    } else if (position && typeof position.x === 'number') { 
      this.position = new BABYLON.Vector3(position.x, position.y, position.z);
    } else {
      this.position = new BABYLON.Vector3(0, 0, 0);
    }
  } else {
    this.position = position || { x: 0, y: 0, z: 0 };
  }

  this.mesh = null;
  this.isDead = false;
  this.name = 'Entity';
}

Entity.prototype.update = function (deltaTime) {
  if (this.mesh && this.mesh.physicsImpostor) {
    // If we have a physics impostor, the impostor handles the mesh position
    this.position.copyFrom(this.mesh.position);
  } else if (this.mesh && this.mesh.position && this.position &&
      typeof this.mesh.position.copyFrom === "function") {
    // Basic position sync if no physics is used
    this.mesh.position.copyFrom(this.position);
  }
};

Entity.prototype.dispose = function () {
  this.isDead = true;
  if (this.mesh) {
    this.mesh.dispose();
  }
};
window.Entity = Entity;


// Character base class (MUST be defined after Entity)
class Character extends Entity {
    constructor(scene, position, name = 'Character') {
        super(scene, position);
        this.name = name;
        this.health = 100;
        this.stats = {}; 
        this.target = null;
        this.isDead = false;
        
        this.attack = function() {};
        
        this.takeDamage = function(damage, attacker) {
            this.health -= damage;
            if (this.health <= 0) {
                this.health = 0;
                this.isDead = true;
                this.dispose(); 
            }
        };
    }
    
    update(deltaTime) {
        super.update(deltaTime);
    }
}
window.Character = Character;

// ==================== WORLD CLASS ====================

class World {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.assetManager = null; // Set in index.html
        this.npcs = [];
        this.loots = [];
        this.activeSpawns = new Map();
        this.spawnTimer = 0;
        
        // This is only a placeholder for an actual Enemy class (which you haven't provided)
        // You would typically define Enemy, NPC, etc. after Character.
        this.Enemy = Character; 
    }

    createEnvironment(assetManager) {
        this.assetManager = assetManager; 
        this.createLighting();
        this.createSkybox();
        this.createGround();
        this.initSpawnZones();
        console.log('[World] Environment setup complete.');
    }

    createLighting() {
        const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 0.7;
    }

    createSkybox() {
        const skyboxConfig = CONFIG.WORLD.SKYBOX;
        if (skyboxConfig.PATH) {
            const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: skyboxConfig.SIZE }, this.scene);
            const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
            skyboxMaterial.backFaceCulling = false;
            skyboxMaterial.disableLighting = true;
            skybox.material = skyboxMaterial;
            skybox.infiniteDistance = true;
            skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(skyboxConfig.PATH, this.scene);
            skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        }
        
        // Setup PBR Environment (often better than StandardMaterial skybox)
        const hdrTexture = BABYLON.CubeTexture.CreateAll(CONFIG.ASSETS.BASE_PATH + "textures/environment/ibl/room.env", this.scene, true);
        this.scene.environmentTexture = hdrTexture;
        this.scene.imageProcessingConfiguration.exposure = skyboxConfig.EXPOSURE;
        this.scene.imageProcessingConfiguration.contrast = skyboxConfig.CONTRAST;
    }

    createGround() {
        const assetKey = 'environment_terrain_base';
        const meshes = this.assetManager.getAsset(assetKey);
        
        if (!meshes || meshes.length === 0) {
            console.error(`[World] Failed to load ground mesh for asset: ${assetKey}. Creating fallback.`);
            
            // Fallback ground
            const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, this.scene);
            ground.checkCollisions = true;
            ground.physicsImpostor = new BABYLON.PhysicsImpostor(
                ground,
                BABYLON.PhysicsImpostor.BoxImpostor,
                { mass: 0, friction: 0.5, restitution: 0.0 },
                this.scene
            );
            return;
        }

        const groundMesh = meshes[0].clone("terrain_mesh");
        groundMesh.parent = null;
        groundMesh.checkCollisions = true;

        // Apply physics to the ground mesh
        groundMesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            groundMesh,
            BABYLON.PhysicsImpostor.MeshImpostor,
            { mass: 0, friction: 0.5, restitution: 0.0 },
            this.scene
        );

        // Hide the original asset meshes
        meshes.forEach(m => m.setEnabled(false));
        console.log('[World] Terrain mesh created with physics impostor.');
    }

    // --- Spawn Logic ---
    initSpawnZones() {
        if (!CONFIG.WORLD.SPAWNS || CONFIG.WORLD.SPAWNS.length === 0) return;

        CONFIG.WORLD.SPAWNS.forEach(spawn => {
            if (!this.activeSpawns.has(spawn.id)) {
                this.activeSpawns.set(spawn.id, []);
            }
        });
        this.spawnTimer = 0;
    }

    spawnUpdate(deltaTime) {
        if (CONFIG.WORLD.SPAWNS.length === 0) return;

        this.spawnTimer += deltaTime;
        
        if (this.spawnTimer >= 5) { // Spawn check every 5 seconds
            CONFIG.WORLD.SPAWNS.forEach(spawnData => {
                const currentEntities = this.activeSpawns.get(spawnData.id) || [];
                
                // Remove dead entities from the active list
                const liveEntities = currentEntities.filter(e => !e.isDead);
                this.activeSpawns.set(spawnData.id, liveEntities);

                if (liveEntities.length < spawnData.max_spawn) {
                    const template = this.scene.game.npcTemplates.get(spawnData.npc_template_id);
                    if (template) {
                        this.spawnEnemy(spawnData, template, liveEntities);
                    } else {
                        console.warn(`[World] NPC template not found for spawn ID: ${spawnData.id}`);
                    }
                }
            });
            this.spawnTimer = 0; // Reset timer
        }
    }

    spawnEnemy(spawnData, template, currentEntities) { 
        
        if (currentEntities.length >= spawnData.max_spawn) return null; 
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (spawnData.spawn_radius * 0.8); 
        
        const offsetX = distance * Math.cos(angle);
        const offsetZ = distance * Math.sin(angle);
        
        const spawnPosition = new BABYLON.Vector3(
            spawnData.position_x + offsetX,
            spawnData.position_y + 10, 
            spawnData.position_z + offsetZ
        );
        
        // NOTE: 'Enemy' class is currently a placeholder for Character.
        const newEnemy = new this.Enemy(this.scene, spawnPosition, template, spawnData);
        
        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);
        
        return newEnemy;
    }
    
    // --- Main Update Loop ---
    update(deltaTime) {
        this.spawnUpdate(deltaTime); 

        // Filter out dead entities
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
    }
}
window.World = World;
