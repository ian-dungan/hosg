// ===========================================================
// HEROES OF SHADY GROVE - WORLD CORE v1.0.20 (CHARACTER BASE FIX)
// Fix: Added the missing Character base class before World declaration.
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
        if (this.health <= 0) {
            this.isDead = true;
            console.log(`[Character] ${this.name} was slain by ${source.name}.`);
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
        } else {
             console.error(`[Character] Failed to add ability ${abilityName}. Ability class or template missing.`);
        }
    }

    dispose() {
        super.dispose();
    }
}
window.Character = Character;

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
    if (CONFIG.WORLD.SKYBOX && CONFIG.WORLD.SKYBOX.PATH) {
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: CONFIG.WORLD.SKYBOX.SIZE }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(CONFIG.WORLD.SKYBOX.PATH, this.scene);
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
        let activeNpcs = this.activeSpawns.get(spawn.id);
        
        if (activeNpcs.length < spawn.max_spawn) {
            const template = this.scene.game.npcTemplates.get(spawn.npc_template_id);
            if (template && this.scene.game.assetManager.getAsset(template.model)) {
                // Re-using Player class as NPC fallback for now
                const npc = new window.Player(this.scene, new BABYLON.Vector3(spawn.position_x, spawn.position_y + 1, spawn.position_z), template.id);
                npc.isPlayer = false; 
                npc.name = template.name;
                npc.assetManager = this.scene.game.assetManager; 
                npc.applyClass(template.id, template); 
                
                const defaultAbilityTemplate = this.scene.game.skillTemplates.get(template.defaultAbility);
                if (defaultAbilityTemplate) {
                    npc.addAbility(template.defaultAbility, defaultAbilityTemplate);
                }

                this.npcs.push(npc);
                activeNpcs.push(npc);
            }
        }
    });

    this.activeSpawns.forEach((npcs, spawnId) => {
        this.activeSpawns.set(spawnId, npcs.filter(npc => !npc.isDead));
    });
};

window.World = World;
