// ===========================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.1.0 (FIXED)
// Fixes: Proper Enemy class, improved NPC spawning, better physics
// ===========================================================

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
  if (this.mesh && typeof this.mesh.dispose === "function") {
    this.mesh.dispose();
    this.mesh = null;
  }
};

// ===========================================================
// Base Character Class (Inherits from Entity)
// ===========================================================
class Character extends Entity {
    constructor(scene, position, name = 'Character') {
        super(scene, position);
        this.name = name;
        this.isPlayer = false; 
        this.stats = {}; 
        this.health = 0;
        this.mana = 0;
        this.stamina = 0;
        this.abilities = new Map(); 
        this.target = null;
    }

    takeDamage(damage, source) {
        this.health = Math.max(0, this.health - damage);
        if (this.health <= 0 && !this.isDead) {
            this.isDead = true;
            console.log(`[Character] ${this.name} was slain by ${source ? source.name : 'unknown'}.`);
            if (this.onDeath) this.onDeath();
        }
        return damage;
    }

    update(deltaTime) {
        super.update(deltaTime);
        this.abilities.forEach(ability => ability.update(deltaTime));
    }
    
    addAbility(abilityName, template) {
        if (typeof Ability !== 'undefined' && template) {
            const newAbility = new Ability(template);
            this.abilities.set(abilityName, newAbility);
            console.log(`[Character] ${this.name} learned ${abilityName}`);
        } else {
             console.error(`[Character] Failed to add ability ${abilityName}. Ability class or template missing.`);
        }
    }

    dispose() {
        if (this.mesh && this.mesh.physicsImpostor) {
            this.mesh.physicsImpostor.dispose();
        }
        super.dispose();
    }
}
window.Character = Character;

    createLight() {
        const light = new BABYLON.DirectionalLight("dir01", new BABYLON.Vector3(0.5, -1, 0.5), this.scene);
        light.position = new BABYLON.Vector3(-20, 40, -20);
        light.intensity = 1.0;
    }
    
    createEnvironment() {
        this.createSkybox();
        // this.createWeather(); // Future feature
    }
    
    createSkybox() {
        const skyboxConfig = CONFIG.WORLD.SKYBOX;

        // 1. Optional classic skybox (if PATH is provided in config)
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

        // 2. Setup PBR Environment using pre-filtered data (.env)
        // Prefer a prefiltered environment map if available. Use a reliable CDN fallback
        // to avoid 404s when the local file is missing.
        const environmentSource = CONFIG.ASSETS.BASE_PATH + "textures/environment/ibl/room.env";

        // Older browsers reported a stray syntax error inside this block. Rebuild it using
        // only classic functions/strings to avoid any parsing surprises.
        let hdrTexture = null;
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
    }
    
    createGround() {
        const envConfig = CONFIG && CONFIG.ASSETS ? CONFIG.ASSETS.ENVIRONMENT : null;
        const terrainConfig = envConfig ? envConfig.terrain_base : null;
        const terrainAsset = terrainConfig
            ? this.scene.game.assetManager.getAsset(terrainConfig.model)
            : null;

        if (terrainAsset && terrainAsset.length > 0) {
            const terrain = terrainAsset[0];
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
                    `[World] Failed to load TerrainBase mesh '${terrainConfig.model}'. Using simple plane as fallback.`
                );
            }
            const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 100, height: 100 }, this.scene);
            ground.physicsImpostor = new BABYLON.PhysicsImpostor(
                ground,
                BABYLON.PhysicsImpostor.BoxImpostor,
                { mass: 0, restitution: 0.9 },
                this.scene
            );
            ground.receiveShadows = true;

            const groundMaterial = new BABYLON.StandardMaterial("groundMat", this.scene);
            groundMaterial.diffuseColor = new BABYLON.Color3(0.5, 0.5, 0.5);
            ground.material = groundMaterial;
        }
    }

    spawnUpdate(deltaTime) {
        if (!CONFIG.WORLD.SPAWNS) return;

        CONFIG.WORLD.SPAWNS.forEach(spawnData => {
            const spawnId = spawnData.id;
            let timer = this.spawnTimers.get(spawnId) || 0;
            timer += deltaTime;

            const activeEntities = this.activeSpawns.get(spawnId).filter(e => !e.isDead);
            this.activeSpawns.set(spawnId, activeEntities);

            if (activeEntities.length < spawnData.max_spawn && timer >= spawnData.respawn_time_s) {
                const template = this.scene.game.npcTemplates.get(spawnData.npc_template_id);
                if (template) {
                    this.spawnEnemy(spawnData, template);
                    timer = 0; // Reset timer only on successful spawn
                }
            }
            
            // Lock rotation
            this.mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
            this.mesh.physicsImpostor.registerBeforePhysics(() => {
                if (this.mesh && this.mesh.physicsImpostor) {
                    this.mesh.physicsImpostor.setAngularVelocity(BABYLON.Vector3.Zero());
                }
            });
            
            console.log(`[Enemy] ${this.name} mesh initialized with model: ${modelKey}`);
        } else {
            // Fallback sphere
            this.mesh = BABYLON.MeshBuilder.CreateSphere(this.name + "_mesh", { diameter: 1.5 }, this.scene);
            this.mesh.position.copyFrom(this.position);
            const mat = new BABYLON.StandardMaterial("enemyFallback", this.scene);
            mat.diffuseColor = new BABYLON.Color3(0.8, 0.2, 0.2);
            this.mesh.material = mat;
            console.warn(`[Enemy] Failed to load asset: ${modelKey}. Using fallback.`);
        }
    }
    
    update(deltaTime) {
        if (this.isDead) return;
        
        super.update(deltaTime);
        
        // Check leash distance
        const distFromSpawn = BABYLON.Vector3.Distance(this.position, this.spawnPosition);
        if (distFromSpawn > this.leashDistance) {
            this.resetToSpawn();
            return;
        }
        
        // AI behavior
        const player = this.scene.game ? this.scene.game.player : null;
        if (player && !player.isDead) {
            const distToPlayer = BABYLON.Vector3.Distance(this.position, player.position);
            
            if (distToPlayer < this.aggroRange) {
                this.target = player;
                this.moveTowards(player.position, deltaTime);
                
                // Attack if in range
                if (distToPlayer < this.attackRange) {
                    this.tryAttack(deltaTime);
                }
            } else {
                this.target = null;
                this.wander(deltaTime);
            }
        } else {
            this.wander(deltaTime);
        }
        
        // Update attack cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= deltaTime;
        }
    }
    
    moveTowards(targetPos, deltaTime) {
        if (!this.mesh || !this.mesh.physicsImpostor) return;
        
        const direction = targetPos.subtract(this.position);
        direction.y = 0;
        
        if (direction.lengthSquared() > 0.01) {
            direction.normalize();
            
            // Apply movement
            const velocity = this.mesh.physicsImpostor.getLinearVelocity();
            const moveSpeed = this.stats.moveSpeed || 0.15;
            velocity.x = direction.x * moveSpeed * (1 / deltaTime);
            velocity.z = direction.z * moveSpeed * (1 / deltaTime);
            this.mesh.physicsImpostor.setLinearVelocity(velocity);
            
            // Face direction
            const angle = Math.atan2(-direction.x, -direction.z);
            this.mesh.rotation.y = angle;
        }
    }
    
    wander(deltaTime) {
        this.wanderTimer -= deltaTime;
        
        if (this.wanderTimer <= 0) {
            this.wanderTimer = this.wanderDelay + Math.random() * 2;
            
            // Occasionally move to random nearby point
            if (Math.random() < 0.3) {
                const randomOffset = new BABYLON.Vector3(
                    (Math.random() - 0.5) * 10,
                    0,
                    (Math.random() - 0.5) * 10
                );
                const wanderTarget = this.spawnPosition.add(randomOffset);
                this.moveTowards(wanderTarget, deltaTime);
            } else {
                // Stop moving
                if (this.mesh && this.mesh.physicsImpostor) {
                    const velocity = this.mesh.physicsImpostor.getLinearVelocity();
                    velocity.x = 0;
                    velocity.z = 0;
                    this.mesh.physicsImpostor.setLinearVelocity(velocity);
                }
            }
        }
    }
    
    tryAttack(deltaTime) {
        if (this.attackCooldown <= 0 && this.target) {
            const ability = Array.from(this.abilities.values())[0];
            if (ability && ability.isReady()) {
                ability.execute(this, this.target);
                this.attackCooldown = this.attackDelay;
            }
        }
    }
    
    resetToSpawn() {
        this.position.copyFrom(this.spawnPosition);
        if (this.mesh) {
            this.mesh.position.copyFrom(this.spawnPosition);
            if (this.mesh.physicsImpostor) {
                this.mesh.physicsImpostor.setLinearVelocity(BABYLON.Vector3.Zero());
            }
        }
        this.health = this.stats.maxHealth;
        this.target = null;
        console.log(`[Enemy] ${this.name} reset to spawn`);
    }
    
    onDeath() {
        // Death effects
        if (this.mesh) {
            // Fade out animation
            this.mesh.visibility = 0.5;
        }
        
        // TODO: Drop loot based on template.loot_table
        console.log(`[Enemy] ${this.name} died`);
    }
}
window.Enemy = Enemy;

// ===========================================================
// World Core Class
// ===========================================================
function World(scene, player) {
    this.scene = scene;
    this.player = player;
    this.npcs = [];
    this.loots = [];
    this.spawnData = CONFIG.WORLD.SPAWNS || [];
    this.activeSpawns = new Map(); 
    this.ground = null;
    this.camera = null;
    this.light = null;

    this.scene.enablePhysics(
        new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0),
        new BABYLON.CannonJSPlugin(true, 10, window.CANNON)
    );
}

World.prototype.createCameraAndLights = function() {
    const camera = new BABYLON.ArcRotateCamera(
        "playerCamera",
        Math.PI / 2,
        Math.PI / 4,
        15, 
        new BABYLON.Vector3(0, 5, 0), 
        this.scene
    );
    camera.attachControl(this.scene.getEngine().getRenderingCanvas(), true);
    camera.inputs.remove(camera.inputs.attached.mousewheel);
    camera.upperRadiusLimit = 40;
    camera.lowerRadiusLimit = 5;
    camera.pinchPrecision = 50;

    new BABYLON.HemisphericLight("hemiLight", new BABYLON.Vector3(0, 1, 0), this.scene);
    
    const light = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(0.5, -1, 0.2), this.scene);
    light.position = new BABYLON.Vector3(-20, 40, -20);
    light.intensity = 0.7;

    this.camera = camera;
    this.light = light;
}

World.prototype.createSkybox = function() {
    if (CONFIG.WORLD.SKYBOX && CONFIG.WORLD.SKYBOX.FILE) {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: CONFIG.WORLD.SKYBOX.SIZE }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        
        // Build skybox path from ASSETS configuration
        const skyboxPath = CONFIG.ASSETS.getSkyboxPath(CONFIG.WORLD.SKYBOX.FILE);
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(skyboxPath, this.scene);
        
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        skybox.material = skyboxMaterial;
        
        this.scene.environmentTexture = skyboxMaterial.reflectionTexture;
        this.scene.imageProcessingConfiguration.exposure = CONFIG.WORLD.SKYBOX.EXPOSURE;
        this.scene.imageProcessingConfiguration.contrast = CONFIG.WORLD.SKYBOX.CONTRAST;
    }
}

World.prototype.createGround = function(assetManager) {
    const ground = BABYLON.MeshBuilder.CreateGround(
        "ground",
        { width: 500, height: 500 },
        this.scene
    );
    
    const groundMat = new BABYLON.StandardMaterial("groundMat", this.scene);
    groundMat.diffuseColor = new BABYLON.Color3(0.3, 0.5, 0.3);
    groundMat.specularColor = new BABYLON.Color3(0, 0, 0);
    ground.material = groundMat;

    ground.physicsImpostor = new BABYLON.PhysicsImpostor(
        ground,
        BABYLON.PhysicsImpostor.BoxImpostor,
        { mass: 0, restitution: 0.9, friction: 0.5 },
        this.scene
    );
    this.ground = ground;
}

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
