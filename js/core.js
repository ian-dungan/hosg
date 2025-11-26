// ====================== CONFIG.JS ======================
const CONFIG = {
    VERSION: '1.0.0',
    DEBUG: true,
    GAME: { FPS: 60, GRAVITY: 9.81, PHYSICS_ENGINE: 'cannon' },
    PLAYER: { MOVE_SPEED: 0.1, RUN_MULTIPLIER: 1.8, JUMP_FORCE: 0.2, HEALTH: 100, STAMINA: 100, INVENTORY_SIZE: 20 },
    WORLD: { SIZE: 1000, CHUNK_SIZE: 32, TERRAIN_SIZE: 1024, WATER_LEVEL: 0 },
    NETWORK: { MAX_PLAYERS: 100, TICK_RATE: 20, TIMEOUT: 30000 }
};

// ====================== ASSETMANAGER.JS ======================
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = new Map();
        this.queue = [];
        this.loading = false;
    }

    addToQueue(name, url, type = 'texture', options = {}) {
        this.queue.push({ name, url, type, options });
    }

    async loadAll() {
        if (this.loading) return;
        this.loading = true;
        
        for (const {name, url, type, options} of this.queue) {
            try {
                await this.loadAsset(name, url, type, options);
            } catch (error) {
                console.error(`Failed to load ${name}:`, error);
            }
        }
        this.loading = false;
    }

    loadAsset(name, url, type) {
        return new Promise((resolve, reject) => {
            try {
                let asset;
                switch (type.toLowerCase()) {
                    case 'texture':
                        asset = new BABYLON.Texture(url, this.scene);
                        break;
                    case 'mesh':
                        BABYLON.SceneLoader.ImportMesh('', '', url, this.scene, 
                            (meshes) => resolve(this.assets.set(name, meshes)),
                            null, 
                            (_, msg) => reject(new Error(`Mesh load failed: ${msg}`))
                        );
                        return;
                    default:
                        return reject(new Error(`Unsupported type: ${type}`));
                }
                asset.onLoadObservable.add(() => {
                    this.assets.set(name, asset);
                    resolve(asset);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    get(name) { return this.assets.get(name); }
    dispose() { 
        this.assets.forEach(asset => asset.dispose?.()); 
        this.assets.clear(); 
    }
}

// ====================== WORLD.JS ======================
class World {
    constructor(scene) {
        this.scene = scene;
        this.ground = null;
        this.skybox = null;
        this.water = null;
    }

    init() {
        this.createGround();
        this.createSkybox();
        this.createWater();
    }

    createGround() {
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: CONFIG.WORLD.SIZE,
            height: CONFIG.WORLD.SIZE,
            subdivisions: 100
        }, this.scene);
        
        const mat = new BABYLON.StandardMaterial('groundMat', this.scene);
        mat.diffuseTexture = new BABYLON.Texture('assets/textures/ground.jpg', this.scene);
        this.ground.material = mat;
        this.ground.checkCollisions = true;
    }

    createSkybox() {
        this.skybox = BABYLON.MeshBuilder.CreateBox('skybox', {size: 10000}, this.scene);
        const mat = new BABYLON.StandardMaterial('skyboxMat', this.scene);
        mat.backFaceCulling = false;
        mat.reflectionTexture = new BABYLON.CubeTexture('assets/textures/skybox/skybox', this.scene);
        mat.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        mat.disableLighting = true;
        this.skybox.material = mat;
    }

    createWater() {
        this.water = BABYLON.MeshBuilder.CreateGround('water', {
            width: CONFIG.WORLD.SIZE,
            height: CONFIG.WORLD.SIZE
        }, this.scene);
        this.water.position.y = CONFIG.WORLD.WATER_LEVEL;
    }

    dispose() {
        [this.ground, this.skybox, this.water].forEach(mesh => mesh?.dispose());
    }
}

// ====================== GAME.JS ======================
class Game {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.engine = new BABYLON.Engine(this.canvas, true);
        this.scene = new BABYLON.Scene(this.engine);
        this.assets = new AssetManager(this.scene);
        this.keys = {};
        this.setupScene();
    }

    setupScene() {
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
        this.scene.gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
        this.scene.collisionsEnabled = true;
    }

    setupPhysics() {
    // Use the same gravity as the scene config
    const gravityVector = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);

    if (typeof CANNON !== "undefined") {
        this.scene.enablePhysics(gravityVector, new BABYLON.CannonJSPlugin());
    } else {
        console.warn("CANNON.js not found – skipping physics setup.");
    }
}

    setupCamera() {
        this.camera = new BABYLON.ArcRotateCamera('camera', 0, 0, 10, BABYLON.Vector3.Zero(), this.scene);
        this.camera.setPosition(new BABYLON.Vector3(0, 5, -10));
        this.camera.attachControl(this.canvas, true);
    }

    setupLighting() {
        const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 0.7;
    }

    async loadAssets() {
        // Example asset loading
        this.assets.addToQueue('playerModel', 'assets/models/player.glb', 'mesh');
        await this.assets.loadAll();
    }

    async init() {
        this.setupPhysics();
        this.setupCamera();
        this.setupLighting();
        await this.loadAssets();
        
        this.world = new World(this.scene);
        this.world.init();
        
        // Player will be initialized by player.js
        console.log('Game initialized');
    }

    run() {
        this.engine.runRenderLoop(() => {
            if (!this.isPaused) {
                const deltaTime = this.engine.getDeltaTime() / 1000;
                this.scene.render();
            }
        });

        window.addEventListener('resize', () => this.engine.resize());
    }

    dispose() {
        this.engine.dispose();
        this.world?.dispose();
        this.assets.dispose();
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.game = new Game('renderCanvas');
    window.game.init().then(() => window.game.run());
});
