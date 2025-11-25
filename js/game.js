// Main game class
class Game {
    constructor() {
        // Core properties
        this.canvas = document.getElementById('renderCanvas');
        this.engine = new BABYLON.Engine(this.canvas, true, {
            preserveDrawingBuffer: true,
            stencil: true
        });
        
        // Scene and rendering
        this.scene = null;
        this.camera = null;
        this.light = null;
        this.shadowGenerator = null;
        
        // Game systems
        this.player = null;
        this.world = null;
        this.ui = null;
        this.network = null;
        this.audio = null;
        
        // Game state
        this.isPaused = false;
        this.lastUpdate = 0;
        this.gameTime = 0;
        this.fps = 0;
        this.frameCount = 0;
        this.lastFpsUpdate = 0;
        
        // Initialize the game
        this.init();
    }
    
    async init() {
        try {
            // Setup loading screen
            this.setupLoadingScreen();
            
            // Create the scene
            this.createScene();
            
            // Initialize systems
            await this.initSystems();
            
            // Start the game loop
            this.startGameLoop();
            
            // Handle window resize
            window.addEventListener('resize', () => {
                this.engine.resize();
            });
            
            // Expose game instance globally for debugging
            window.game = this;
            
        } catch (error) {
            console.error('Game initialization failed:', error);
            this.showError('Failed to initialize the game. Please try refreshing the page.');
        }
    }
    
    setupLoadingScreen() {
        const loadingScreen = document.getElementById('loading-screen');
        const loadingBar = document.getElementById('loading-bar-fill');
        const loadingText = document.getElementById('loading-text');
        
        this.engine.loadingScreen = {
            displayLoadingUI: () => {
                loadingScreen.style.display = 'flex';
            },
            hideLoadingUI: () => {
                loadingScreen.style.opacity = '0';
                setTimeout(() => {
                    loadingScreen.style.display = 'none';
                }, 500);
            },
            loadingUIBackgroundColor: '#0a0a1a',
            loadingUIText: 'Loading...'
        };
        
        // Update loading progress
        this.updateLoadingProgress = (progress, text) => {
            if (loadingBar) loadingBar.style.width = `${progress}%`;
            if (loadingText && text) loadingText.textContent = text;
        };
    }
    
    createScene() {
        // Create the scene
        this.scene = new BABYLON.Scene(this.engine);
        this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
        
        // Create camera (first-person by default)
        this.createCamera();
        
        // Create lights
        this.createLights();
        
        // Enable physics
        this.scene.enablePhysics(CONFIG.WORLD.GRAVITY, new BABYLON.CannonJSPlugin());
        
        // Enable inspector in debug mode
        if (CONFIG.DEBUG) {
            this.scene.debugLayer.show();
        }
    }
    
    createCamera() {
        // Create a free camera (first-person)
        this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 1.7, 0), this.scene);
        this.camera.attachControl(this.canvas, true);
        this.camera.ellipsoid = new BABYLON.Vector3(0.5, 0.9, 0.5);
        this.camera.ellipsoidOffset = new BABYLON.Vector3(0, 0.9, 0);
        this.camera.applyGravity = true;
        this.camera.checkCollisions = true;
        this.camera.speed = 0.4;
        this.camera.angularSensibility = 3000;
        this.camera.keysUp = [87];    // W
        this.camera.keysDown = [83];  // S
        this.camera.keysLeft = [65];  // A
        this.camera.keysRight = [68]; // D
        
        // Set camera collision
        this.camera.collisionMask = 1; // Only collide with the first collision group
    }
    
    createLights() {
        // Hemispheric light for ambient lighting
        const hemiLight = new BABYLON.HemisphericLight(
            'hemiLight', 
            new BABYLON.Vector3(0, 1, 0), 
            this.scene
        );
        hemiLight.intensity = 0.6;
        
        // Directional light for shadows
        const dirLight = new BABYLON.DirectionalLight(
            'dirLight', 
            new BABYLON.Vector3(-1, -2, -1), 
            this.scene
        );
        dirLight.position = new BABYLON.Vector3(20, 40, 20);
        dirLight.intensity = 0.8;
        
        // Shadow generator
        this.shadowGenerator = new BABYLON.ShadowGenerator(1024, dirLight);
        this.shadowGenerator.useBlurExponentialShadowMap = true;
        this.shadowGenerator.blurKernel = 32;
    }
    
    async initSystems() {
        try {
            // Initialize player
            this.updateLoadingProgress(20, 'Initializing player...');
            this.player = new Player(this.scene, this.camera, this.shadowGenerator);
            await this.player.init();
            
            // Initialize world
            this.updateLoadingProgress(40, 'Loading world...');
            this.world = new World(this.scene, this.shadowGenerator);
            await this.world.init();
            
            // Initialize UI
            this.updateLoadingProgress(60, 'Setting up UI...');
            this.ui = new UIManager(this);
            this.ui.init();
            
            // Initialize network
            this.updateLoadingProgress(80, 'Connecting to server...');
            this.network = new NetworkManager(this);
            await this.network.connect();
            
            // Initialize other systems
            this.updateLoadingProgress(90, 'Finalizing...');
            this.initInput();
            this.initEventListeners();
            
            // Hide loading screen
            this.updateLoadingProgress(100, 'Ready!');
            setTimeout(() => {
                this.engine.hideLoadingUI();
            }, 500);
            
        } catch (error) {
            console.error('Error initializing game systems:', error);
            throw error;
        }
    }
    
    initInput() {
        // Keyboard input
        this.keys = {};
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            // Toggle inventory with 'i' key
            if (e.key.toLowerCase() === 'i' && !e.repeat) {
                this.ui.togglePanel('inventory');
                e.preventDefault();
            }
            
            // Toggle chat with 'enter' key
            if (e.key === 'Enter' && !e.repeat) {
                const chatInput = document.getElementById('chat-input');
                if (document.activeElement !== chatInput) {
                    e.preventDefault();
                    chatInput.focus();
                }
            }
            
            // Toggle pause with 'escape' key
            if (e.key === 'Escape' && !e.repeat) {
                this.togglePause();
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        // Mouse input
        this.canvas.addEventListener('click', () => {
            // Lock pointer when clicking on canvas
            if (this.engine.isPointerLock && !document.pointerLockElement) {
                this.canvas.requestPointerLock = 
                    this.canvas.requestPointerLock || 
                    this.canvas.mozRequestPointerLock || 
                    this.canvas.webkitRequestPointerLock;
                
                this.canvas.requestPointerLock();
            }
        });
        
        // Handle pointer lock change
        const pointerLockChange = () => {
            if (document.pointerLockElement === this.canvas ||
                document.mozPointerLockElement === this.canvas ||
                document.webkitPointerLockElement === this.canvas) {
                // Pointer was locked
                this.isPointerLocked = true;
            } else {
                // Pointer was unlocked
                this.isPointerLocked = false;
            }
        };
        
        document.addEventListener('pointerlockchange', pointerLockChange, false);
        document.addEventListener('mozpointerlockchange', pointerLockChange, false);
        document.addEventListener('webkitpointerlockchange', pointerLockChange, false);
    }
    
    initEventListeners() {
        // Window focus/blur
        window.addEventListener('focus', () => {
            this.setPaused(false);
            this.engine.hideLoadingUI();
        });
        
        window.addEventListener('blur', () => {
            this.setPaused(true);
        });
        
        // Handle before unload
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }
    
    startGameLoop() {
        let lastTime = performance.now();
        
        const gameLoop = () => {
            // Calculate delta time
            const now = performance.now();
            const deltaTime = (now - lastTime) / 1000; // Convert to seconds
            lastTime = now;
            
            // Update FPS counter
            this.updateFpsCounter(deltaTime);
            
            // Update game state
            if (!this.isPaused) {
                this.update(deltaTime);
            }
            
            // Render the scene
            this.scene.render();
            
            // Request next frame
            requestAnimationFrame(gameLoop);
        };
        
        // Start the game loop
        requestAnimationFrame(gameLoop);
    }
    
    update(deltaTime) {
        try {
            // Update game time
            this.gameTime += deltaTime;
            
            // Update player
            if (this.player) {
                this.player.update(deltaTime, this.keys);
            }
            
            // Update world
            if (this.world) {
                this.world.update(deltaTime);
            }
            
            // Update network
            if (this.network) {
                this.network.update(deltaTime);
            }
            
            // Update UI
            if (this.ui) {
                this.ui.update(deltaTime);
            }
            
        } catch (error) {
            console.error('Error in game update:', error);
        }
    }
    
    updateFpsCounter(deltaTime) {
        this.frameCount++;
        this.lastFpsUpdate += deltaTime;
        
        if (this.lastFpsUpdate >= 1.0) { // Update every second
            this.fps = Math.round(this.frameCount / this.lastFpsUpdate);
            this.frameCount = 0;
            this.lastFpsUpdate = 0;
            
            // Update FPS counter in debug mode
            if (CONFIG.DEBUG && this.ui) {
                const fpsElement = document.getElementById('fps-counter');
                if (!fpsElement) {
                    const div = document.createElement('div');
                    div.id = 'fps-counter';
                    div.style.position = 'fixed';
                    div.style.bottom = '10px';
                    div.style.right = '10px';
                    div.style.color = 'white';
                    div.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
                    div.style.padding = '5px 10px';
                    div.style.borderRadius = '5px';
                    div.style.fontFamily = 'Arial, sans-serif';
                    div.style.fontSize = '14px';
                    document.body.appendChild(div);
                } else {
                    fpsElement.textContent = `FPS: ${this.fps}`;
                }
            }
        }
    }
    
    setPaused(paused) {
        this.isPaused = paused;
        
        // Show/hide pause menu
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu) {
            pauseMenu.style.display = paused ? 'flex' : 'none';
        }
        
        // Pause/resume audio
        if (this.audio) {
            if (paused) {
                this.audio.pauseAll();
            } else {
                this.audio.resumeAll();
            }
        }
    }
    
    togglePause() {
        this.setPaused(!this.isPaused);
    }
    
    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.style.position = 'fixed';
        errorDiv.style.top = '20px';
        errorDiv.style.left = '50%';
        errorDiv.style.transform = 'translateX(-50%)';
        errorDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.9)';
        errorDiv.style.color = 'white';
        errorDiv.style.padding = '15px 25px';
        errorDiv.style.borderRadius = '5px';
        errorDiv.style.zIndex = '1000';
        errorDiv.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
        errorDiv.style.fontFamily = 'Arial, sans-serif';
        errorDiv.style.fontSize = '16px';
        errorDiv.style.maxWidth = '80%';
        errorDiv.style.textAlign = 'center';
        errorDiv.textContent = message;
        
        document.body.appendChild(errorDiv);
        
        // Remove after 5 seconds
        setTimeout(() => {
            errorDiv.style.opacity = '0';
            setTimeout(() => {
                if (errorDiv.parentNode) {
                    errorDiv.parentNode.removeChild(errorDiv);
                }
            }, 500);
        }, 5000);
    }
    
    cleanup() {
        // Clean up resources
        if (this.network) {
            this.network.disconnect();
        }
        
        if (this.world) {
            this.world.dispose();
        }
        
        if (this.ui) {
            this.ui.dispose();
        }
        
        if (this.scene) {
            this.scene.dispose();
        }
        
        if (this.engine) {
            this.engine.dispose();
        }
        
        // Remove global reference
        if (window.game === this) {
            window.game = null;
        }
    }
}

// Start the game when the page loads
window.addEventListener('DOMContentLoaded', () => {
    // Check for WebGL support
    if (!BABYLON.Engine.isSupported()) {
        alert('Your browser does not support WebGL. Please try using a modern browser like Chrome, Firefox, or Edge.');
        return;
    }
    
    // Initialize the game
    window.game = new Game();
});
