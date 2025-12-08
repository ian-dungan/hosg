// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.11 (FINAL PATCH)
// Fix: Updated createSky to load the user's specific HDRI asset path for the skybox.
// Fix: Added NPC Spawning logic and fixed NPC template lookup error.
// ============================================================

// Base Entity class
function Entity(scene, position) {
  this.scene = scene;

  if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
    if (position instanceof BABYLON.Vector3) {
      this.position = position.clone();
    } else if (position && typeof position.x === 'number') { // Handle basic object {x, y, z}
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
  // If the entity has a physics impostor, we let physics update the mesh position
  if (this.mesh && this.mesh.physicsImpostor) {
    // Read the new position from the physics mesh
    this.position.copyFrom(this.mesh.position);
  } else if (this.mesh && this.mesh.position && this.position &&
      typeof this.mesh.position.copyFrom === "function") {
    // Fallback: copy logical position to mesh position
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
        this.level = 1;
        this.stats = {}; // Placeholder, overwritten by Player/Enemy
        this.health = 1; 
        this.isAttackable = true; // For targeting logic
        this.visualRoot = null; // Separate node for visuals/rotation
    }

    _initMesh() {
        // Must be implemented by subclasses
    }
    
    _initCollision(mass, friction) {
        // Must be implemented by subclasses if using physics
    }

    // Must be implemented by subclasses
    takeDamage(damage, source) {
        console.log(`${this.name} took ${damage} damage.`);
    }

    // Generic highlight toggle (used by Player for target selection)
    _toggleHighlight(isHighlighted) {
        if (!this.mesh) return;

        if (!this._highlightLayer) {
            this._highlightLayer = new BABYLON.HighlightLayer("highlightLayer", this.scene);
            this._highlightLayer.innerGlow = true;
            this._highlightLayer.outerGlow = false;
            this._highlightLayer.blurVerticalSize = 0.3;
            this._highlightLayer.blurHorizontalSize = 0.3;
        }

        if (isHighlighted) {
            this._highlightLayer.addMesh(this.mesh, BABYLON.Color3.Teal());
        } else {
            this._highlightLayer.removeMesh(this.mesh);
        }
    }
}

// ============================================================
// ENEMY CLASS (Placeholder)
// ============================================================
class Enemy extends Character {
    constructor(scene, position, template, spawnData) {
        // Set basic properties from template
        const health = template.stats.health || 50;
        super(scene, position, template.name);
        
        this.templateId = template.id;
        this.spawnData = spawnData;
        this.level = template.level || 1;
        
        this.stats = {
            maxHealth: health,
            attackPower: template.stats.attackPower || 5,
            moveSpeed: template.stats.moveSpeed || 0.1,
        };
        this.health = health;
        
        this.isNPC = true;
        this.isEnemy = true;
        this.isAttackable = true;
        
        this._initMesh(template.model);
        this._initCollision(10, 0.5); // Enemies are lighter than the player
    }
    
    async _initMesh(modelKey) {
        const assets = this.scene.game.assetManager.assets;
        const modelAsset = assets[`CHARACTERS_${modelKey}`];
        
        if (modelAsset && modelAsset[0]) {
             // Create an instance of the loaded mesh
             this.visualRoot = modelAsset[0].clone(this.name, null);
             this.visualRoot.position.copyFrom(this.position);
             this.visualRoot.scaling = new BABYLON.Vector3(0.5, 0.5, 0.5);
             
             // Create a simple, invisible collision mesh for physics
             this.mesh = BABYLON.MeshBuilder.CreateCylinder("enemyCollider", { height: 2, diameter: 1 }, this.scene);
             this.mesh.position.copyFrom(this.position);
             this.mesh.isVisible = false;
             
             // Attach visual root to the collider mesh
             this.visualRoot.parent = this.mesh;
             
             // Metadata allows picking/targeting
             this.mesh.metadata = { isEnemy: true, entity: this };
             
        } else {
             // Fallback: Simple placeholder box
             console.warn(`[Enemy] Model ${modelKey} not found. Using placeholder.`);
             this.mesh = BABYLON.MeshBuilder.CreateBox(this.name + "_Box", { size: 1 }, this.scene);
             this.mesh.position.copyFrom(this.position);
             this.mesh.metadata = { isEnemy: true, entity: this };
             this.visualRoot = this.mesh;
        }
    }

    _initCollision(mass, friction) {
        if (this.scene.isPhysicsEnabled && this.mesh) {
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.BoxImpostor,
                { 
                    mass: mass, 
                    friction: friction, 
                    restitution: 0.1 
                }, 
                this.scene
            );
            // Prevent rotation
            if (this.mesh.physicsImpostor && typeof this.mesh.physicsImpostor.setAngularFactor === 'function') {
                this.mesh.physicsImpostor.setAngularFactor(0);
            }
        }
    }

    takeDamage(damage, source) {
        damage = Math.max(0, damage);
        this.health -= damage;
        
        if (this.scene.game.ui && this.scene.game.ui.showMessage) {
            const messageType = source.isPlayer ? 'enemyDamage' : 'damage';
            this.scene.game.ui.showMessage(`${this.name} took ${damage.toFixed(0)} damage!`, 1500, messageType);
        }

        if (this.health <= 0) {
            this.health = 0;
            this.die();
        }
    }
    
    die() {
        if (this.isDead) return;
        this.isDead = true;
        
        // Remove target if the player was targeting this enemy
        if (this.scene.game.player && this.scene.game.player.combat.target === this) {
            this.scene.game.player.setTarget(null);
        }
        
        // Dispose mesh after a short delay
        setTimeout(() => this.dispose(), 3000);
        console.log(`${this.name} died.`);
    }

    update(deltaTime) {
        // Enemy logic (placeholder AI)
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
        this.spawnAreas = [];
        this.activeSpawns = new Map(); // Map<SpawnId, Array<Enemy>>
        this.npcTemplates = new Map(); // Map<TemplateId, TemplateObject>

        // Patch: Bind update loop for spawning
        this.spawnUpdateInterval = 5000; // 5 seconds
        this.lastSpawnUpdateTime = 0;
    }

    async init(templates) {
        this.npcTemplates = templates.npcTemplates || new Map();
        
        this.createGround();
        this.createWater();
        this.createSky();
        
        // Load Spawns from CONFIG
        this.spawnAreas = (typeof CONFIG !== 'undefined' && CONFIG.WORLD && CONFIG.WORLD.SPAWN_AREAS) 
                          ? CONFIG.WORLD.SPAWN_AREAS : [];
        
        // Initialize activeSpawns map
        this.spawnAreas.forEach(spawn => {
            if (!this.activeSpawns.has(spawn.id)) {
                this.activeSpawns.set(spawn.id, []);
            }
        });
        
        // Initial spawn call
        this.spawnUpdate(0); 
        
        console.log('[World] Initialized. Spawning NPCs...');
    }
    
    // --- Environment Creation ---
    createGround() {
        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 500, height: 500 }, this.scene);
        const groundMaterial = new BABYLON.StandardMaterial("groundMat", this.scene);
        
        groundMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.7, 0.5);
        groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        ground.material = groundMaterial;
        
        // Add physics impostor for collision
        if (this.scene.isPhysicsEnabled) {
            ground.physicsImpostor = new BABYLON.PhysicsImpostor(
                ground, 
                BABYLON.PhysicsImpostor.BoxImpostor, 
                { mass: 0, friction: 0.5, restitution: 0.1 }, 
                this.scene
            );
        }
        
        // Set ground to be non-pickable by default to avoid interfering with target picking
        ground.isPickable = false; 
    }

    createWater() {
        // Placeholder for water mesh/material
    }

    createSky() {
        // PATCH: Use the user-provided HDRI texture path
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.PBRMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Load the HDRI texture from the user's specified path
        const hdrTexture = new BABYLON.HDRCubeTexture(
            "/assets/sky/DaySkyHDRI023B_4K_TONEMAPPED.jpg", // User's specified path
            this.scene, 
            512 // Size of the texture (optional)
        );
        
        skyboxMaterial.reflectionTexture = hdrTexture;
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.reflectionTexture.level = 0.5; // Controls brightness/intensity

        // Material settings for PBR Skybox
        skyboxMaterial.disableLighting = true; // Skybox shouldn't be affected by scene lights
        skyboxMaterial.microSurface = 1.0;
        skyboxMaterial.cameraExposure = 0.6;
        skyboxMaterial.cameraContrast = 1.2;
        
        skybox.material = skyboxMaterial;
        skybox.isPickable = false; // Cannot be clicked
        
        // Set scene environment texture (for reflections on other materials)
        this.scene.environmentTexture = hdrTexture;
        
        console.log('[World] Skybox created using user-provided HDRI.');
    }
    
    // --- Spawning Logic ---
    spawnUpdate(deltaTime) {
        this.lastSpawnUpdateTime += deltaTime * 1000;
        
        if (this.lastSpawnUpdateTime < this.spawnUpdateInterval) return;
        
        this.lastSpawnUpdateTime = 0; // Reset timer

        this.spawnAreas.forEach(spawnData => {
            this.trySpawnEnemy(spawnData);
        });
    }

    trySpawnEnemy(spawnData) {
        const template = this.npcTemplates.get(spawnData.npc_template_id);
        if (!template) {
            // FIX: Added template not found error logging for debugging
            console.warn(`[World] NPC template ${spawnData.npc_template_id} not found for spawn ${spawnData.id}.`);
            return null;
        }

        // Filter out dead entities from the active list
        let currentEntities = this.activeSpawns.get(spawnData.id).filter(e => !e.isDead);
        this.activeSpawns.set(spawnData.id, currentEntities); // Update the map reference
        
        if (currentEntities.length >= spawnData.max_spawn) return null; 
        
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (spawnData.spawn_radius * 0.8); // 80% of radius
        
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
    
    // --- Main Update Loop ---
    update(deltaTime) {
        // Handle spawning logic
        this.spawnUpdate(deltaTime); 

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
        this.spawnAreas.length = 0;
    }
}

// Ensure the World, Character, and Enemy classes are globally accessible
window.World = World;
window.Character = Character;
window.Enemy = Enemy;
