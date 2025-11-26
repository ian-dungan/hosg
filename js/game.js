// game.js - Main game class with enhanced graphics

class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = new BABYLON.Engine(canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
        
        // Enable physics
        this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.CannonJSPlugin());
        
        this.network = new Network();
        this.player = new Player(this.scene);
        this.world = new World(this.scene);
        this.ui = new UI(this.scene, this.player);
        
        this.init();
    }

    async init() {
        try {
            // Setup camera with better defaults
            this.setupCamera();
            
            // Setup enhanced lighting
            this.setupLighting();
            
            // Create environment
            await this.setupEnvironment();
            
            // Load player model
            await this.player.loadModel();
            
            // Start the game loop
            this.engine.runRenderLoop(() => this.update());
            
            // Handle window resize
            window.addEventListener('resize', () => this.engine.resize());
            
            console.log('Game initialized with enhanced graphics');
        } catch (error) {
            console.error('Error initializing game:', error);
        }
    }

    setupCamera() {
        // Create and position a camera
        this.camera = new BABYLON.ArcRotateCamera(
            "camera", 
            -Math.PI / 2, 
            Math.PI / 2, 
            10, 
            BABYLON.Vector3.Zero(), 
            this.scene
        );
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 100;
        this.camera.wheelDeltaPercentage = 0.01;
        this.camera.upperBetaLimit = Math.PI / 2;
    }

    setupLighting() {
        // Hemispheric light to simulate sky light
        const hemiLight = new BABYLON.HemisphericLight(
            'hemiLight',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        hemiLight.intensity = 0.6;
        hemiLight.groundColor = new BABYLON.Color3(0.3, 0.3, 0.2);
        hemiLight.diffuse = new BABYLON.Color3(0.8, 0.8, 0.9);
        
        // Directional light to simulate sun
        this.sunLight = new BABYLON.DirectionalLight(
            'sunLight',
            new BABYLON.Vector3(-1, -2, -1),
            this.scene
        );
        this.sunLight.intensity = 0.9;
        this.sunLight.position = new BABYLON.Vector3(20, 40, 20);
        
        // Shadows
        this.sunLight.shadowEnabled = true;
        const shadowGenerator = new BABYLON.ShadowGenerator(2048, this.sunLight);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 32;
        shadowGenerator.normalBias = 0.05;
        
        // Store shadow generator for later use
        this.shadowGenerator = shadowGenerator;
    }

    async setupEnvironment() {
        // Create skybox
        const skybox = BABYLON.MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, this.scene);
        const skyboxMaterial = new BABYLON.StandardMaterial("skyBox", this.scene);
        skyboxMaterial.backFaceCulling = false;
        skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture(
            "https://assets.babylonjs.com/textures/skybox/skybox", 
            this.scene
        );
        skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;
        skyboxMaterial.disableLighting = true;
        skybox.material = skyboxMaterial;
        
        // Add some fog
        this.scene.fogMode = BABYLON.Scene.FOGMODE_LINEAR;
        this.scene.fogColor = new BABYLON.Color3(0.9, 0.9, 1);
        this.scene.fogStart = 20;
        this.scene.fogEnd = 100;
        
        // Add some post-processing
        this.setupPostProcessing();
    }

    setupPostProcessing() {
        // Create pipeline
        const pipeline = new BABYLON.DefaultRenderingPipeline(
            "defaultPipeline",
            true,
            this.scene,
            [this.camera]
        );
        
        // Configure effects
        pipeline.imageProcessingEnabled = true;
        pipeline.imageProcessing.contrast = 1.4;
        pipeline.imageProcessing.exposure = 0.6;
        pipeline.imageProcessing.toneMappingEnabled = true;
        pipeline.samples = 4;
        
        // Add bloom effect
        pipeline.bloomEnabled = true;
        pipeline.bloomThreshold = 0.8;
        pipeline.bloomWeight = 0.5;
        pipeline.bloomKernel = 64;
        pipeline.bloomScale = 0.5;
        
        // Add depth of field
        pipeline.depthOfFieldEnabled = true;
        pipeline.depthOfField.fStop = 1.4;
        pipeline.depthOfField.focalLength = 100;
        pipeline.depthOfField.focusDistance = 50;
    }

    async loadAssets() {
        // Load any additional game assets here
        const assetsManager = new BABYLON.AssetsManager(this.scene);
        
        // Example: Load a character model
        // const characterTask = assetsManager.addMeshTask("character", "", "models/", "character.glb");
        // characterTask.onSuccess = (task) => {
        //     task.loadedMeshes[0].scaling = new BABYLON.Vector3(0.1, 0.1, 0.1);
        //     this.player.mesh = task.loadedMeshes[0];
        //     this.shadowGenerator.addShadowCaster(this.player.mesh);
        // };
        
        await assetsManager.loadAsync();
    }

    update() {
        const deltaTime = this.engine.getDeltaTime() / 1000;
        
        // Update game objects
        if (this.player) {
            this.player.update(deltaTime);
            
            // Update camera to follow player
            if (this.player.mesh) {
                this.camera.target = this.player.mesh.position;
            }
        }
        
        if (this.world) {
            this.world.update(deltaTime);
        }
        
        if (this.ui) {
            this.ui.update();
        }
        
        // Render the scene
        this.scene.render();
    }

    dispose() {
        // Clean up resources
        this.engine.dispose();
        if (this.player) this.player.dispose();
        if (this.world) this.world.dispose();
        if (this.ui) this.ui.dispose();
    }
}

// Make Game globally available
window.Game = Game;
