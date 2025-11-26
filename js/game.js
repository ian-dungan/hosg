// game.js - Main game class
// No need to destructure BABYLON here since we'll use BABYLON namespace directly

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = new BABYLON.Engine(canvas, true);
        this.scene = new BABYLON.Scene(this.engine);
        this.network = new Network();
        this.player = new Player(this.scene);
        this.world = new World(this.scene);
        this.ui = new UI(this.scene, this.player);
        
        this.init();
    }

    async init() {
        // Setup camera
        this.setupCamera();
        
        // Setup lighting
        this.setupLighting();
        
        // Load assets
        await this.loadAssets();
        
        // Start the game loop
        this.engine.runRenderLoop(() => this.update());
        
        // Handle window resize
        window.addEventListener('resize', () => this.engine.resize());
    }

    setupCamera() {
        // Create and position a camera
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
        this.camera.upperRadiusLimit = 20;
    }

    setupLighting() {
        // Create a light
        const light = new BABYLON.HemisphericLight(
            'light',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        light.intensity = 0.7;
    }

    async loadAssets() {
        // Load your game assets here
        // Example:
        // await BABYLON.SceneLoader.AppendAsync('models/', 'character.glb', this.scene);
    }

    update() {
        const deltaTime = this.engine.getDeltaTime() / 1000; // Convert to seconds
        
        // Update game objects
        this.player.update(deltaTime);
        this.world.update(deltaTime);
        this.ui.update();
        
        // Update camera to follow player
        if (this.player.mesh) {
            this.camera.target = this.player.mesh.position;
        }
        
        // Render the scene
        this.scene.render();
    }

    dispose() {
        // Clean up resources
        this.engine.dispose();
        this.player.dispose();
        this.world.dispose();
        this.ui.dispose();
    }
}
