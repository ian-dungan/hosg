class Game {
    constructor(canvas) {
        this.canvas = canvas;
        this.engine = new BABYLON.Engine(canvas, true, { 
            preserveDrawingBuffer: true,
            stencil: true,
            disableWebGL2Support: false
        });
        this.scene = null;
        this.network = null;
        this.player = null;
        this.world = null;
        this.ui = null;
        this.miniMap = null;
        this.weatherSystem = null;
        this.lastUpdateTime = 0;
        this.isInitialized = false;

        // Initialize the game
        this.init();
    }

    async init() {
        try {
            // Create scene
            this.scene = new BABYLON.Scene(this.engine);
            this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
            
            // Enable physics
            const gravityVector = new BABYLON.Vector3(0, -9.81, 0);
            const physicsPlugin = new BABYLON.CannonJSPlugin();
            this.scene.enablePhysics(gravityVector, physicsPlugin);
            
            // Setup camera
            this.setupCamera();
            
            // Setup lighting
            this.setupLighting();
            
            // Create world
            this.world = new World(this.scene);
            
            // Create player
            this.player = new Player(this.scene);
            
            // Create UI
            this.ui = new UI(this.scene, this.player);
            
            // Create minimap
            this.miniMap = new MiniMap(this.scene, this.player, this.world);
            
            // Initialize network
            this.network = new Network();
            
            // Setup input
            this.setupInput();
            
            // Setup post-processing
            this.setupPostProcessing();
            
            // Start the game loop
            this.engine.runRenderLoop(() => this.update());
            
            // Handle window resize
            window.addEventListener('resize', () => this.engine.resize());
            
            // Hide loading screen
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }
            
            this.isInitialized = true;
            console.log('Game initialized successfully');
        } catch (error) {
            console.error('Error initializing game:', error);
            this.ui.showMessage('Error initializing game: ' + error.message, 'error');
        }
    }

    setupCamera() {
        // Create camera
        this.camera = new BABYLON.ArcRotateCamera(
            'camera',
            -Math.PI / 2,
            Math.PI / 3,
            20,
            BABYLON.Vector3.Zero(),
            this.scene
        );
        
        // Attach camera to canvas
        this.camera.attachControl(this.canvas, true);
        this.camera.lowerRadiusLimit = 5;
        this.camera.upperRadiusLimit = 100;
        this.camera.radius = 20;
        this.camera.upperBetaLimit = Math.PI / 2.2;
        this.camera.lowerBetaLimit = 0.1;
        
        // Enable collision for camera
        this.camera.checkCollisions = true;
        this.camera.applyGravity = true;
        this.camera.ellipsoid = new BABYLON.Vector3(1, 1, 1);
        this.camera.ellipsoidOffset = new BABYLON.Vector3(0, 1, 0);
    }

    setupLighting() {
        // Create main light (sun)
        const light = new BABYLON.HemisphericLight(
            'light',
            new BABYLON.Vector3(0, 1, 0),
            this.scene
        );
        light.intensity = 0.7;
        
        // Add directional light for shadows
        const dirLight = new BABYLON.DirectionalLight(
            'dirLight',
            new BABYLON.Vector3(-1, -1, 1),
            this.scene
        );
        dirLight.position = new BABYLON.Vector3(20, 40, 20);
        dirLight.intensity = 0.8;
        
        // Enable shadows
        if (BABYLON.ShadowGenerator) {
            const shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
            shadowGenerator.useBlurExponentialShadowMap = true;
            shadowGenerator.blurKernel = 32;
            this.shadowGenerator = shadowGenerator;
        }
        
        // Set ambient color
        this.scene.ambientColor = new BABYLON.Color3(0.3, 0.3, 0.3);
    }

    setupPostProcessing() {
        // Only enable post-processing if supported
        if (!BABYLON.Effect.ShadersStore["LensFlarePixelShader"]) {
            console.warn('Post-processing not fully supported in this environment');
            return;
        }
        
        // Create pipeline
        const pipeline = new BABYLON.DefaultRenderingPipeline(
            'defaultPipeline',
            true,
            this.scene,
            [this.camera]
        );
        
        // Configure effects
        pipeline.samples = 4;
        pipeline.fxaaEnabled = true;
        pipeline.bloomEnabled = true;
        pipeline.bloomWeight = 0.4;
        pipeline.bloomKernel = 64;
        pipeline.bloomScale = 0.5;
        pipeline.imageProcessingEnabled = true;
        pipeline.imageProcessing.contrast = 1.2;
        pipeline.imageProcessing.exposure = 1.2;
    }

    setupInput() {
        // Keyboard input
        this.keys = {};
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            // Toggle fullscreen on F11
            if (e.key === 'F11') {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else {
                    document.documentElement.requestFullscreen();
                }
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse input
        this.canvas.addEventListener('click', () => {
            // Request pointer lock when canvas is clicked
            this.canvas.requestPointerLock = 
                this.canvas.requestPointerLock || 
                this.canvas.mozRequestPointerLock || 
                this.canvas.webkitRequestPointerLock;
            
            if (this.canvas.requestPointerLock) {
                this.canvas.requestPointerLock();
            }
        });
    }

    update() {
        try {
            const now = performance.now();
            const deltaTime = this.lastUpdateTime ? (now - this.lastUpdateTime) / 1000 : 0;
            this.lastUpdateTime = now;
            
            // Update player
            if (this.player) {
                this.player.update(deltaTime, this.keys);
                
                // Update camera to follow player
                if (this.player.mesh) {
                    this.camera.target = this.player.mesh.position.clone();
                    
                    // Update minimap
                    if (this.miniMap) {
                        this.miniMap.update();
                    }
                }
            }
            
            // Update world
            if (this.world) {
                this.world.update(deltaTime);
            }
            
            // Update weather system
            if (this.weatherSystem) {
                this.weatherSystem.update(deltaTime);
            }
            
            // Update network
            if (this.network) {
                this.network.update();
            }
            
            // Render scene
            this.scene.render();
            
        } catch (error) {
            console.error('Error in game loop:', error);
        }
    }

    dispose() {
        // Clean up resources
        if (this.scene) {
            this.scene.dispose();
        }
        if (this.engine) {
            this.engine.dispose();
        }
        if (this.miniMap) {
            this.miniMap.dispose();
        }
        if (this.weatherSystem) {
            this.weatherSystem.dispose();
        }
        
        // Remove event listeners
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
    }
}

// Start the game when the window loads
window.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('renderCanvas');
    if (canvas) {
        const game = new Game(canvas);
        
        // Handle window resize
        window.addEventListener('resize', () => {
            game.engine.resize();
        });
    } else {
        console.error('Canvas element not found');
    }
});
