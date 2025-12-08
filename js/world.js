// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.19 (FULL ENVIRONMENT FIX)
// Fix: Implements createSkybox, createGround, and creates a camera/light setup.
// ============================================================

// Base Entity class
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
    this.position.copyFrom(this.mesh.position);
  } else if (this.mesh && this.mesh.position && this.position &&
      typeof this.mesh.position.copyFrom === "function") {
    this.mesh.position.copyFrom(this.position);
  }
};

Entity.prototype.dispose = function () {
  this.isDead = true;
  if (this.mesh) {
    this.mesh.dispose();
    this.mesh = null;
  }
};

// Character Class (Player/NPC Base)
function Character(scene, position, name) {
  Entity.call(this, scene, position);
  this.name = name;
  this.stats = {}; // To be populated by Player/Enemy
  this.health = 100;
  this.isPlayer = false;
}
Character.prototype = Object.create(Entity.prototype);
Character.prototype.constructor = Character;

Character.prototype.takeDamage = function(damage, attacker) {
    this.health -= damage;
    if (this.health <= 0) {
        this.health = 0;
        this.die(attacker);
    }
}

Character.prototype.die = function(killer) {
    console.log(`${this.name} was slain by ${killer.name}.`);
    this.isDead = true;
    if (this.mesh) {
        // Simple disposal for now, replace with animation/loot drop later
        this.mesh.setEnabled(false);
        this.mesh.dispose();
    }
    // No explicit loot drop yet
}

// Enemy Class
function Enemy(scene, position, template, spawnData) {
    Character.call(this, scene, position, template.name);
    this.template = template;
    this.spawnData = spawnData;
    this.stats = { 
        ...template.stats,
        moveSpeed: template.stats.moveSpeed || 0.15
    }; 
    this.health = template.stats.maxHealth;
    this.attackRange = CONFIG.COMBAT.RANGE_MELEE || 2;
    this.attackCooldown = CONFIG.COMBAT.ATTACK_COOLDOWN_MELEE || 1;
    this.currentAttackCooldown = 0;
    this.target = null; // The enemy's current target (usually the player)
    
    // Asynchronously initialize the mesh
    this._initMesh();
}
Enemy.prototype = Object.create(Character.prototype);
Enemy.prototype.constructor = Enemy;

Enemy.prototype._initMesh = function() {
    const assetManager = this.scene.game.assetManager;

    if (!assetManager) {
        console.error(`[Enemy:${this.name}] AssetManager not available to load mesh.`);
        return;
    }
    
    const assetKey = this.template.model; // e.g., 'wolf'
    const loadedAsset = assetManager.getAsset(assetKey);
    
    if (loadedAsset && loadedAsset.length > 0) {
        // Clone the original mesh from the asset manager
        this.mesh = loadedAsset[0].clone(`${this.name}_mesh`, null);
        
        if (this.mesh) {
            this.mesh.position.copyFrom(this.position);
            this.mesh.name = this.name;
            this.mesh.checkCollisions = true; 
            
            // Add physics impostor for collision and gravity
            this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                this.mesh, 
                BABYLON.PhysicsImpostor.MeshImpostor, 
                { mass: 10, restitution: 0.1 }, 
                this.scene
            );
            
            console.log(`[Enemy:${this.name}] Mesh initialized.`);
        }
    } else {
        console.warn(`[Enemy:${this.name}] Asset for model '${assetKey}' not found. Using fallback sphere.`);
        this.mesh = BABYLON.MeshBuilder.CreateSphere(`${this.name}_sphere`, {diameter: 1}, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.checkCollisions = true; 
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh, 
            BABYLON.PhysicsImpostor.SphereImpostor, 
            { mass: 10, restitution: 0.1 }, 
            this.scene
        );
        const mat = new BABYLON.StandardMaterial(`${this.name}_mat`, this.scene);
        mat.diffuseColor = BABYLON.Color3.Red();
        this.mesh.material = mat;
    }
}

Enemy.prototype.update = function(deltaTime) {
    Character.prototype.update.call(this, deltaTime); // Apply movement/physics updates

    if (this.isDead || !this.mesh || !this.scene.game.player.mesh) return;

    // --- Simplified Enemy AI: Always target the player ---
    const player = this.scene.game.player;
    this.target = player;
    
    const distanceToPlayer = BABYLON.Vector3.Distance(this.mesh.position, player.mesh.position);

    this.currentAttackCooldown -= deltaTime;

    if (distanceToPlayer <= this.attackRange) {
        // 1. Attack the player
        if (this.currentAttackCooldown <= 0) {
            this.attack(player);
            this.currentAttackCooldown = this.attackCooldown;
        }
    } else if (distanceToPlayer < 25) { // Only chase if player is somewhat close
        // 2. Chase the player
        this._moveTo(player.mesh.position, this.stats.moveSpeed);
    } else {
        // 3. Idle (Stop movement)
        if (this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
        }
    }
}

Enemy.prototype._moveTo = function(targetPosition, speed) {
    if (!this.mesh || !this.mesh.physicsImpostor) return;

    const direction = targetPosition.subtract(this.mesh.position);
    direction.y = 0; // Ignore vertical difference for horizontal movement
    direction.normalize();

    // Set rotation to face the direction of movement
    const angle = Math.atan2(direction.x, direction.z);
    this.mesh.rotation.y = angle;

    // Apply impulse for movement (more realistic for physics)
    const velocity = direction.scale(speed * 60); // Scale by 60 for rough frame rate conversion
    this.mesh.physicsImpostor.setLinearVelocity(velocity);
}

Enemy.prototype.attack = function(target) {
    // Simple direct damage for now
    const damage = this.stats.attackPower || 5;
    target.takeDamage(damage, this);
    
    // Show damage message in UI
    if (this.scene.game.ui && this.scene.game.ui.showMessage) {
        this.scene.game.ui.showMessage(`${this.name} bites you for ${damage.toFixed(0)}!`, 1500, 'playerDamage');
    }
}


// World Class Definition

function World(scene, player) {
    this.scene = scene;
    this.player = player;
    this.npcs = [];
    this.loots = [];
    this.spawnData = (CONFIG.WORLD && CONFIG.WORLD.SPAWNS) || [];
    this.activeSpawns = new Map(); // Map<id, Enemy[]>
    this.lastSpawnCheck = 0; // ms
    this.SPAWN_CHECK_INTERVAL = 5000; // Check every 5 seconds
}

World.prototype.getSpawnedEntities = function(spawnId) {
    return this.activeSpawns.get(spawnId) || [];
}

World.prototype.spawnUpdate = function(deltaTime) {
    this.lastSpawnCheck += deltaTime * 1000; // Convert seconds to milliseconds
    if (this.lastSpawnCheck < this.SPAWN_CHECK_INTERVAL) return;

    this.lastSpawnCheck = 0; // Reset timer

    this.spawnData.forEach(spawnData => {
        const currentEntities = this.getSpawnedEntities(spawnData.id).filter(e => !e.isDead);

        // Remove dead NPCs from the active list
        this.activeSpawns.set(spawnData.id, currentEntities);

        if (currentEntities.length >= spawnData.max_spawn) return;

        // Fetch NPC template
        const template = this.scene.game.npcTemplates.get(spawnData.npc_template_id);
        if (!template) {
            console.warn(`[World] NPC Template not found for ID: ${spawnData.npc_template_id}`);
            return;
        }

        // Spawn logic: Find a random point within the spawn radius
        const angle = Math.random() * Math.PI * 2;
        const distance = Math.random() * (spawnData.spawn_radius * 0.8);

        const offsetX = distance * Math.cos(angle);
        const offsetZ = distance * Math.sin(angle);

        // Spawn higher up to let it fall to the ground via physics
        const spawnPosition = new BABYLON.Vector3(
            spawnData.position_x + offsetX,
            spawnData.position_y + 10,
            spawnData.position_z + offsetZ
        );

        const newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);

        this.npcs.push(newEnemy);
        this.activeSpawns.get(spawnData.id).push(newEnemy);

        console.log(`[World] Spawned ${newEnemy.name} at X:${newEnemy.position.x.toFixed(1)}, Z:${newEnemy.position.z.toFixed(1)}`);
    });
}

// --- Environment Methods ---

World.prototype.createCameraAndLights = function() {
    // Create an ArcRotateCamera for a 3rd person RPG view
    const camera = new BABYLON.ArcRotateCamera("Camera", -Math.PI / 2, Math.PI / 4, 15, BABYLON.Vector3.Zero(), this.scene);
    camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);

    // Set up camera properties for 3rd person control
    camera.radius = 15;
    camera.alpha = Math.PI / 4;
    camera.beta = 1.2;
    camera.lowerRadiusLimit = 5;
    camera.upperRadiusLimit = 30;
    camera.wheelPrecision = 20;

    // Link the player's mesh to the camera target for following
    this.player.camera = camera;

    // Simple Lights
    new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), this.scene);
    new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(0.5, -1, 0.5), this.scene);

    console.log("[World] Camera and lights created.");
}


World.prototype.createSkybox = function() {
    const skyboxConfig = CONFIG.WORLD.SKYBOX;

    if (!skyboxConfig.PATH) {
        console.warn("[World] Skybox PATH is null, skipping skybox creation.");
        return;
    }

    const size = skyboxConfig.SIZE;

    // Create Skybox Mesh
    const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: size }, this.scene);
    const skyboxMaterial = new BABYLON.PBRMaterial("skyBoxMaterial", this.scene);
    skyboxMaterial.backFaceCulling = false;

    // Create the Cube Texture for reflections and lighting
    // We use the full PATH here, as CreateFromPrefilteredData expects the DDS file
    skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture.CreateFromPrefilteredData(skyboxConfig.PATH, this.scene);
    skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;

    // Set material properties
    skyboxMaterial.microSurface = 1.0;
    skyboxMaterial.intensity = skyboxConfig.LEVEL;
    skyboxMaterial.cameraExposure = skyboxConfig.EXPOSURE;
    skyboxMaterial.cameraContrast = skyboxConfig.CONTRAST;
    skyboxMaterial.disableLighting = true;

    skybox.material = skyboxMaterial;
    skybox.infiniteDistance = true;
    skybox.isPickable = false;

    // Set as global environment map for PBR materials
    this.scene.environmentTexture = skyboxMaterial.reflectionTexture;
    console.log(`[World] Skybox created from ${skyboxConfig.PATH}.`);
}


World.prototype.createGround = function(assetManager) {
    const terrainAsset = assetManager.getAsset('terrain_base'); // Use the simple asset key

    if (terrainAsset && terrainAsset.length > 0) {
        const terrainMesh = terrainAsset[0];

        // Ensure the mesh is visible and has physics
        terrainMesh.position = new BABYLON.Vector3(0, 0, 0);

        // Make all meshes in the asset visible and apply physics
        terrainAsset.forEach(mesh => {
            mesh.checkCollisions = true;
            mesh.isPickable = true;

            // Add physics impostor for collision
            mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
                mesh,
                BABYLON.PhysicsImpostor.MeshImpostor,
                { mass: 0, restitution: 0.9, friction: 0.5 }, // Static object
                this.scene
            );
        });

        this.ground = terrainMesh; // Store the main ground mesh reference
        console.log("[World] Ground mesh created from assets.");
    } else {
        console.warn("[World] Terrain asset not found. Creating simple flat ground as fallback.");
        // Fallback: simple ground plane
        const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 500, height: 500 }, this.scene);
        const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMat.diffuseColor = new BABYLON.Color3(0.1, 0.4, 0.1); // Green color for grass
        ground.material = groundMat;
        ground.checkCollisions = true;

        ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            ground,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 0, restitution: 0.9, friction: 0.5 },
            this.scene
        );
        this.ground = ground;
    }
}

World.prototype.createSpawns = function() {
    this.spawnData.forEach(spawn => {
        // Initialize an empty array for active NPCs in this spawn zone
        this.activeSpawns.set(spawn.id, []);
        console.log(`[World] Initialized spawn zone: ${spawn.name}`);
    });
}

// Override the existing createEnvironment to call the new methods
World.prototype.createEnvironment = function(assetManager) {
    // 1. Setup Camera and Lights
    this.createCameraAndLights();

    // 2. Create Sky
    this.createSkybox();

    // 3. Create Ground (requires assetManager)
    this.createGround(assetManager);

    // 4. Setup Spawn Zones
    this.createSpawns();

    console.log("[World] Environment setup complete.");
};


// --- Main Update Loop ---
World.prototype.update = function(deltaTime) {
    this.spawnUpdate(deltaTime);

    this.npcs = this.npcs.filter(npc => !npc.isDead);
    this.npcs.forEach(npc => npc.update(deltaTime));

    this.loots = this.loots.filter(loot => !loot.isDead);
    this.loots.forEach(loot => loot.update(deltaTime));
};

World.prototype.dispose = function() {
    this.npcs.forEach(npc => npc.dispose());
    this.loots.forEach(loot => loot.dispose());
    this.npcs.length = 0;
    this.loots.length = 0;
};


window.World = World;
window.Entity = Entity;
window.Character = Character;
window.Enemy = Enemy;
