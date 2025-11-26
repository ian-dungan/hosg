// game.js - Main game class
// Using global BABYLON object

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
        try {
            // Setup camera
            this.setupCamera();
            
            // Setup lighting
            this.setupLighting();
            
            // Create skybox
            this.world.createSkybox();
            
            // Load any additional assets
            await this.loadAssets();
            
            // Start the game loop
            this.engine.runRenderLoop(() => this.update());
            
            // Handle window resize
            window.addEventListener('resize', () => this.engine.resize());
            
            console.log('Game initialized successfully');
        } catch (error) {
            console.error('Error initializing game:', error);
        }
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
        // Hemispheric light to simulate sky light
        const hemiLight = new BABYLON.HemisphericLight(
            'hemiLight',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemiLight.intensity = CONFIG.GRAPHICS.LIGHTING.AMBIENT_INTENSITY || 0.8;
        hemiLight.specular = new BABYLON.Color3(0, 0, 0);
        
        // Directional light to simulate sun
        this.sunLight = new BABYLON.DirectionalLight(
            'sunLight',
            new BABYLON.Vector3(
                CONFIG.GRAPHICS.LIGHTING.SUN_DIRECTION?.x || 1,
                CONFIG.GRAPHICS.LIGHTING.SUN_DIRECTION?.y || -1,
                CONFIG.GRAPHICS.LIGHTING.SUN_DIRECTION?.z || 1
            ),
            this.scene
        );
        this.sunLight.intensity = CONFIG.GRAPHICS.LIGHTING.SUN_INTENSITY || 0.9;
        this.sunLight.position = new BABYLON.Vector3(0, 50, 0);
        
        // Enable shadows if configured
        if (CONFIG.GRAPHICS.SHADOWS?.ENABLED) {
            this.sunLight.shadowEnabled = true;
            const shadowGenerator = new BABYLON.ShadowGenerator(
                CONFIG.GRAPHICS.SHADOWS.SIZE || 1024, 
                this.sunLight
            );
            shadowGenerator.useBlurExponentialShadowMap = true;
            shadowGenerator.blurKernel = CONFIG.GRAPHICS.SHADOWS.BLUR_KERNEL || 32;
        }
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

// Make Game globally available
window.Game = Game;
