// ============================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.19 (LEGACY SAFETY)
// Rewritten with ES5-compatible syntax to avoid browser parse
// errors that were intermittently reported on legacy engines.
// ============================================================

// Base Entity class
function Entity(scene, position) {
    this.scene = scene;

    if (typeof BABYLON !== "undefined" && BABYLON.Vector3) {
        if (position instanceof BABYLON.Vector3) {
            this.position = position.clone();
        } else if (position && typeof position.x === "number") {
            this.position = new BABYLON.Vector3(position.x, position.y, position.z);
        } else {
            this.position = new BABYLON.Vector3(0, 0, 0);
        }
    } else {
        this.position = position || { x: 0, y: 0, z: 0 };
    }

    this.mesh = null;
    this.isDead = false;
    this.name = "Entity";
}

Entity.prototype.update = function (deltaTime) {
    if (this.mesh && this.mesh.physicsImpostor) {
        this.position.copyFrom(this.mesh.position);
    } else if (
        this.mesh &&
        this.mesh.position &&
        this.position &&
        typeof this.mesh.position.copyFrom === "function"
    ) {
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

// Character class (extends Entity)
function Character(scene, position, name) {
    Entity.call(this, scene, position);
    this.name = name || "Character";
    this.health = 100;
    this.target = null;
}
Character.prototype = Object.create(Entity.prototype);
Character.prototype.constructor = Character;

Character.prototype.takeDamage = function (damageAmount, attacker) {
    this.health -= damageAmount;
    if (this.health <= 0) {
        this.health = 0;
        this.die(attacker);
    }
};

Character.prototype.die = function (killer) {
    this.isDead = true;
    if (this.scene && this.scene.game && this.scene.game.ui) {
        this.scene.game.ui.showMessage(this.name + " was slain by " + killer.name + "!", 3000, "error");
    }
    this.dispose();
};

// Enemy class (extends Character)
function Enemy(scene, position, template, spawnData) {
    Character.call(this, scene, position, template.name);

    this.template = template;
    this.spawnData = spawnData;

    // Use the model name from the asset config
    this._initMesh(CONFIG.ASSETS.CHARACTERS.wolf.model);
    this._initBehavior();
}
Enemy.prototype = Object.create(Character.prototype);
Enemy.prototype.constructor = Enemy;

Enemy.prototype._initMesh = function (assetName) {
    var assetMeshes = this.scene.game.assetManager.getAsset(assetName);
    if (assetMeshes && assetMeshes.length > 0) {
        // Clone the asset mesh
        this.mesh = assetMeshes[0].clone(this.name, null);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = true;

        // Apply a physics impostor for collision
        this.mesh.physicsImpostor = new BABYLON.PhysicsImpostor(
            this.mesh,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 1, restitution: 0.1 },
            this.scene
        );

        // Position the mesh correctly on the ground
        this.mesh.position.y += 1;
    } else {
        console.warn(
            "[Enemy] Failed to load mesh for asset: " + assetName + ". AssetManager load failed or key is wrong."
        );
        // Fallback: use a simple sphere
        this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name, { diameter: 2 }, this.scene);
        this.mesh.position.copyFrom(this.position);
        this.mesh.isVisible = true;
    }
};

Enemy.prototype._initBehavior = function () {
    this.moveTimer = 0;
    this.state = "idle"; // 'idle', 'chase', 'attack'
    this.target = null;
};

Enemy.prototype.update = function (deltaTime) {
    Entity.prototype.update.call(this, deltaTime);

    // Simple AI: always target the player
    if (this.scene.game.player) {
        this.target = this.scene.game.player;
    }

    if (this.target) {
        this._updateMovement(deltaTime);
    }
};

Enemy.prototype._updateMovement = function (deltaTime) {
    if (!this.mesh || !this.target.mesh) return;

    var distance = BABYLON.Vector3.Distance(this.mesh.position, this.target.mesh.position);
    var chaseRange = 10;
    var attackRange = 2;

    // Determine state
    if (distance > chaseRange) {
        this.state = "idle";
    } else if (distance > attackRange) {
        this.state = "chase";
    } else {
        this.state = "attack";
    }

    // Execute state logic
    if (this.state === "chase") {
        var direction = this.target.mesh.position.subtract(this.mesh.position);
        var moveVector = direction.normalize().scale(0.05); // Simple speed adjustment

        // Only apply force in the X-Z plane to prevent flying
        this.mesh.physicsImpostor.setLinearVelocity(
            new BABYLON.Vector3(
                moveVector.x * 5,
                this.mesh.physicsImpostor.getLinearVelocity().y,
                moveVector.z * 5
            )
        );

        // Face the target
        var angle = Math.atan2(direction.x, direction.z);
        this.mesh.rotation.y = angle;
    } else if (this.state === "attack") {
        // Attack logic placeholder
    }
};

// World Class
function World(scene) {
    this.scene = scene;
    this.npcs = [];
    this.loots = [];
    this.spawnTimers = new Map();
    this.activeSpawns = new Map();

    if (CONFIG.WORLD && CONFIG.WORLD.SPAWNS) {
        CONFIG.WORLD.SPAWNS.forEach(function (spawn) {
            this.spawnTimers.set(spawn.id, 0);
            this.activeSpawns.set(spawn.id, []);
        }, this);
    }
}

World.prototype.init = function () {
    this.createLight();
    this.createEnvironment();
    this.createGround();
};

World.prototype.createLight = function () {
    var light = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.5, -1, 0.5), this.scene);
    light.position = new BABYLON.Vector3(-20, 40, -20);
    light.intensity = 1.0;
};

World.prototype.createEnvironment = function () {
    this.createSkybox();
    // this.createWeather(); // Future feature
};

World.prototype.createSkybox = function () {
    var skyboxConfig = CONFIG.WORLD.SKYBOX;

    // 1. Optional classic skybox (if PATH is provided in config)
    if (skyboxConfig.PATH) {
        var skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: skyboxConfig.SIZE }, this.scene);
        var skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.disableLighting = true;
        skybox.material = skyboxMaterial;
        skybox.infiniteDistance = true;
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(skyboxConfig.PATH, this.scene);
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
    }

    // 2. Setup PBR Environment using pre-filtered data (.env)
    var environmentSource = CONFIG.ASSETS.BASE_PATH + "textures/environment/ibl/room.env";
    var hdrTexture = null;
    try {
        hdrTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(environmentSource, this.scene);
    } catch (err) {
        console.warn(
            "[World] Failed to load environment map from " + environmentSource + ". Using Babylon fallback.",
            err
        );
        hdrTexture = BABYLON.CubeTexture.CreateFromPrefilteredData(
            "https://assets.babylonjs.com/environments/environmentSpecular.env",
            this.scene
        );
    }

    this.scene.environmentTexture = hdrTexture;
    this.scene.imageProcessingConfiguration.exposure = skyboxConfig.EXPOSURE;
    this.scene.imageProcessingConfiguration.contrast = skyboxConfig.CONTRAST;
};

World.prototype.createGround = function () {
    var envConfig = CONFIG && CONFIG.ASSETS ? CONFIG.ASSETS.ENVIRONMENT : null;
    var terrainConfig = envConfig ? envConfig.terrain_base : null;
    var terrainAsset = terrainConfig ? this.scene.game.assetManager.getAsset(terrainConfig.model) : null;

    if (terrainAsset && terrainAsset.length > 0) {
        var terrain = terrainAsset[0];
        terrain.name = "TerrainBase";
        terrain.isPickable = true;
        terrain.receiveShadows = true;

        // Set the model to be static collision ground
        terrain.physicsImpostor = new BABYLON.PhysicsImpostor(
            terrain,
            BABYLON.PhysicsImpostor.MeshImpostor, // MeshImpostor for complex shapes
            { mass: 0, restitution: 0.9 }, // Mass 0 for static object
            this.scene
        );
    } else {
        if (terrainConfig) {
            console.warn(
                "[World] Failed to load TerrainBase mesh '" + terrainConfig.model + "'. Using simple plane as fallback."
            );
        }
        var ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, this.scene);
        ground.physicsImpostor = new BABYLON.PhysicsImpostor(
            ground,
            BABYLON.PhysicsImpostor.BoxImpostor,
            { mass: 0, restitution: 0.9 },
            this.scene
        );
        ground.receiveShadows = true;

        var groundMaterial = new BABYLON.StandardMaterial("groundMat", this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
        ground.material = groundMaterial;
    }
};

World.prototype.spawnUpdate = function (deltaTime) {
    if (!CONFIG.WORLD.SPAWNS) return;

    CONFIG.WORLD.SPAWNS.forEach(function (spawnData) {
        var spawnId = spawnData.id;
        var timer = this.spawnTimers.get(spawnId) || 0;
        timer += deltaTime;

        var activeEntities = this.activeSpawns.get(spawnId).filter(function (e) { return !e.isDead; });
        this.activeSpawns.set(spawnId, activeEntities);

        if (activeEntities.length < spawnData.max_spawn && timer >= spawnData.respawn_time_s) {
            var template = this.scene.game.npcTemplates.get(spawnData.npc_template_id);
            if (template) {
                this.spawnEnemy(spawnData, template);
                timer = 0; // Reset timer only on successful spawn
            }
        }
        this.spawnTimers.set(spawnId, timer);
    }, this);
};

World.prototype.spawnEnemy = function (spawnData, template) {
    var currentEntities = this.activeSpawns.get(spawnData.id).filter(function (e) { return !e.isDead; });

    if (currentEntities.length >= spawnData.max_spawn) return null;

    var angle = Math.random() * Math.PI * 2;
    var distance = Math.random() * (spawnData.spawn_radius * 0.8);

    var offsetX = distance * Math.cos(angle);
    var offsetZ = distance * Math.sin(angle);

    var spawnPosition = new BABYLON.Vector3(
        spawnData.position_x + offsetX,
        spawnData.position_y + 10,
        spawnData.position_z + offsetZ
    );

    var newEnemy = new Enemy(this.scene, spawnPosition, template, spawnData);

    this.npcs.push(newEnemy);
    this.activeSpawns.get(spawnData.id).push(newEnemy);

    return newEnemy;
};

World.prototype.update = function (deltaTime) {
    this.spawnUpdate(deltaTime);

    this.npcs = this.npcs.filter(function (npc) { return !npc.isDead; });
    this.npcs.forEach(function (npc) { return npc.update(deltaTime); });

    this.loots = this.loots.filter(function (loot) { return !loot.isDead; });
    this.loots.forEach(function (loot) { return loot.update(deltaTime); });
};

World.prototype.dispose = function () {
    this.npcs.forEach(function (npc) { return npc.dispose(); });
    this.loots.forEach(function (loot) { return loot.dispose(); });
    this.npcs.length = 0;
    this.loots.length = 0;
};

World.prototype.createSpawns = function() {
    this.spawnData.forEach(spawn => {
        this.activeSpawns.set(spawn.id, []);
        console.log(`[World] Initialized spawn zone: ${spawn.name}`);
    });
}

World.prototype.createEnvironment = function(assetManager) {
    this.createCameraAndLights();
    this.createSkybox();
    this.createGround(assetManager);
    this.createSpawns();
    console.log("[World] Environment setup complete.");
};

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
    if (this.ground) this.ground.dispose();
    if (this.camera) this.camera.dispose();
    this.scene.dispose();
};

World.prototype.spawnUpdate = function(deltaTime) {
    this.spawnData.forEach(spawn => {
        let activeNpcs = this.activeSpawns.get(spawn.id) || [];
        
        // Filter out dead NPCs
        activeNpcs = activeNpcs.filter(npc => !npc.isDead);
        this.activeSpawns.set(spawn.id, activeNpcs);
        
        // Spawn new enemies if needed
        if (activeNpcs.length < spawn.max_spawn) {
            const templateId = spawn.npc_template_id;
            const template = this.scene.game.npcTemplates.get(templateId);
            
            if (template && this.scene.game.assetManager.getAsset(template.model)) {
                // Calculate spawn position with some randomness
                const randomOffset = new BABYLON.Vector3(
                    (Math.random() - 0.5) * spawn.spawn_radius,
                    0,
                    (Math.random() - 0.5) * spawn.spawn_radius
                );
                const spawnPos = new BABYLON.Vector3(
                    spawn.position_x,
                    spawn.position_y + 1,
                    spawn.position_z
                ).add(randomOffset);
                
                // Create enemy using proper Enemy class
                const enemy = new Enemy(
                    this.scene,
                    spawnPos,
                    template,
                    this.scene.game.assetManager
                );
                
                this.npcs.push(enemy);
                activeNpcs.push(enemy);
                
                console.log(`[World] Spawned ${enemy.name} at spawn zone ${spawn.name}`);
            } else {
                console.warn(`[World] Cannot spawn ${templateId} - template or asset missing`);
            }
        }
    });
};

window.World = World;
