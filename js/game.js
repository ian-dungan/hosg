// Main Game Class
class Game {
    constructor(canvasId) {
        // Get the canvas element
        this.canvas = document.getElementById(canvasId);
        if (!this.canvas) {
            console.error('Canvas element not found!');
            return;
        }

        // Initialize the Babylon.js engine
        this.engine = new BABYLON.Engine(this.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });

        // Create the scene
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);

        // Store references
        this.player = null;
        this.world = null;
        this.ui = null;

        // Initialize the game
        this.init();
    }

    async init() {
        try {
            // Setup scene
            this.setupScene();

            // Create world
            this.world = new World(this.scene);

            // Create player
            this.player = new Player(this.scene);
            
            // Create UI
            this.ui = new UIManager(this);
            
            // Create crosshair
            createCrosshair(this.scene);

            // Hide loading screen if any
            const loadingScreen = document.getElementById('loadingScreen');
            if (loadingScreen) {
                loadingScreen.style.display = 'none';
            }

            // Start render loop
            this.run();

        } catch (error) {
            console.error('Error initializing game:', error);
        }
    }

    setupScene() {
        // Enable physics
        this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.CannonJSPlugin());

        // Optimize scene
        this.scene.optimize
