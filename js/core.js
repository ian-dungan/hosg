// ====================== CONFIG.JS ======================
const CONFIG = {
    VERSION: '1.0.0',
    DEBUG: true,
    GAME: { FPS: 60, GRAVITY: 9.81, PHYSICS_ENGINE: 'cannon' },
    PLAYER: { MOVE_SPEED: 0.1, RUN_MULTIPLIER: 1.8, JUMP_FORCE: 0.2, HEALTH: 100, STAMINA: 100, INVENTORY_SIZE: 20 },
    WORLD: { SIZE: 1000, CHUNK_SIZE: 32, TERRAIN_SIZE: 1024, WATER_LEVEL: 0 }
};

// ====================== ASSETMANAGER.JS ======================
class AssetManager {
    constructor(scene) {
        this.scene = scene;
        this.assets = new Map();
    }

    async loadAll() {
        console.log('Skipping asset loading');
        return Promise.resolve();
    }

    get(name) { 
        console.log('Asset requested but not loaded:', name);
        return null; 
    }

    dispose() {
        this.assets.clear();
    }
}

// ====================== WORLD.JS ======================
class World {
    constructor(scene) {
        this.scene = scene;
        this.ground = null;
        this.skybox = null;
    }

    init() {
        this.createGround();
        this.createSkybox();
        console.log('World initialized');
    }

    createGround() {
        this.ground = BABYLON.MeshBuilder.CreateGround('ground', {
            width: 100,
            height: 100,
            subdivisions: 20
        }, this.scene);
        
        const groundMaterial = new BABYLON.StandardMaterial('groundMat', this.scene);
        groundMaterial.diffuseColor = new BABYLON.Color3(0.4, 0.8, 0.3);
        groundMaterial.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
        this.ground.material = groundMaterial;
        this.ground.checkCollisions = true;
    }

    createSkybox() {
        this.skybox = BABYLON.MeshBuilder.CreateBox('skybox', {size: 1000}, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial('skyboxMat', this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.disableLighting = true;
        
        // Create gradient from dark blue to light blue
        skyboxMaterial.diffuseColor = new BABYLON.Color3(0.8, 0.8, 1.0);
        skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);
        
        this.skybox.material = skyboxMaterial;
        this.skybox.infiniteDistance = true;
    }

    update() {
        // Update world systems
    }

    dispose() {
        if (this.ground) this.ground.dispose();
        if (this.skybox) this.skybox.dispose();
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
        this.isPaused = false;
        this.setupScene();
    }

    setupScene() {
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
        this.setupPhysics();
        this.setupCamera();
        this.setupLighting();
    }

    setupPhysics() {
        try {
            if (typeof CANNON !== 'undefined') {
                const physicsPlugin = new BABYLON.CannonJSPlugin();
                this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), physicsPlugin);
                console.log('Physics engine initialized');
            } else {
                console.warn('Cannon.js not found, running without physics');
                this.scene.gravity = new BABYLON.Vector3(0, -9.81, 0);
            }
        } catch (e) {
            console.error('Error initializing physics:', e);
            this.scene.gravity = new BABYLON.Vector3(0, -9.81, 0);
        }
    }

    setupCamera() {
        this.camera = new BABYLON.ArcRotateCamera(
            'camera', 
            -Math.PI / 2, 
            Math.PI / 3, 
            10, 
            BABYLON.Vector3.Zero(), 
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 50;
    }

    setupLighting() {
        const light = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0, 1, 0), this.scene);
        light.intensity = 0.7;
        
        const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-1, -2, -1), this.scene);
        sun.intensity = 0.8;
        sun.position = new BABYLON.Vector3(20, 40, 20);
    }

    async loadAssets() {
        console.log('Loading assets...');
        await this.assets.loadAll();
    }

    async init() {
        try {
            await this.loadAssets();
            
            this.world = new World(this.scene);
            this.world.init();
            
            this.player = new Player(this.scene);
            
            console.log('Game initialized');
            return true;
        } catch (error) {
            console.error('Error initializing game:', error);
            throw error;
        }
    }

    run() {
        this.engine.runRenderLoop(() => {
            if (!this.isPaused) {
                const deltaTime = this.engine.getDeltaTime() / 1000;
                this.update(deltaTime);
                this.scene.render();
            }
        });

        window.addEventListener('resize', () => this.engine.resize());
    }

    update(deltaTime) {
        if (this.player) {
            this.player.update(deltaTime);
        }
        if (this.world) {
            this.world.update(deltaTime);
        }
    }

    dispose() {
        this.engine.dispose();
        this.world?.dispose();
        this.player?.dispose();
        this.assets.dispose();
    }
}

// Initialize game when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    const loadingDiv = document.getElementById('loading');
    try {
        loadingDiv.textContent = 'Initializing...';
        window.game = new Game('renderCanvas');
        await window.game.init();
        loadingDiv.style.display = 'none';
        window.game.run();
    } catch (error) {
        console.error('Failed to start game:', error);
        loadingDiv.textContent = `Error: ${error.message}`;
        loadingDiv.style.color = 'red';
    }
});
