// game.js - Main game class
// Using global BABYLON object from CDN
const { Engine, Scene, Vector3, HemisphericLight, ArcRotateCamera } = BABYLON;

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = new Engine(canvas, true);
        this.scene = new Scene(this.engine);
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
        this.camera = new ArcRotateCamera(
            'camera',
            -Math.PI / 2,
            Math.PI / 3,
            10,
            Vector3.Zero(),
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 2;
        this.camera.upperRadiusLimit = 20;
    }

    setupLighting() {
        // Create a light
        const light = new HemisphericLight(
            'light',
            new Vector3(0, 1, 0),
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

// Start the game when the page loads
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    const game = new Game(canvas);
});
