// Main game class
class Game {
  constructor() {
    this.canvas = document.getElementById('renderCanvas');
    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true
    });
    
    this.scene = null;
    this.camera = null;
    this.light = null;
    this.shadowGenerator = null;
    
    this.player = null;
    this.world = null;
    this.ui = null;
    this.network = null;
    
    this.isPaused = false;
    this.lastUpdate = 0;
    
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
      
    } catch (error) {
      console.error('Game initialization failed:', error);
      this.showError('Failed to initialize the game. Please try refreshing the page.');
    }
  }
  
  setupLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    const loadingBar = document.getElementById('loading-bar');
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
      loadingBar.style.width = `${progress}%`;
      if (text) {
        loadingText.textContent = text;
      }
    };
  }
  
  createScene() {
    // Create the scene
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.1, 0.1, 0.2, 1);
    
    // Create camera
    this.camera = new BABYLON.FreeCamera('camera', new BABYLON.Vector3(0, 5, -10), this.scene);
    this.camera.setTarget(BABYLON.Vector3.Zero());
    this.camera.attachControl(this.canvas, true);
    
    // Create lights
    this.createLights();
    
    // Enable physics
    this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), new BABYLON.CannonJSPlugin());
    
    // Enable inspector in debug mode
    if (CONFIG.DEBUG) {
      this.scene.debugLayer.show();
    }
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
      this.updateLoadingProgress(20, 'Initializing player...');
      
      // Initialize player
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
      
      // Toggle character panel
      if (e.key === 'c' && !e.repeat) {
        this.ui.toggleCharacterPanel();
      }
      
      // Toggle chat input
      if (e.key === 'Enter' && !e.repeat) {
        const chatInput = document.getElementById('chat-input');
        if (document.activeElement !== chatInput) {
          e.preventDefault();
          chatInput.focus();
        }
      }
    });
    
    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });
  }
  
  initEventListeners() {
    // Window focus/blur
    window.addEventListener('focus', () => {
      this.isPaused = false;
      this.engine.hideLoadingUI();
    });
    
    window.addEventListener('blur', () => {
      this.isPaused = true;
    });
    
    // Handle before unload
    window.addEventListener('beforeunload', () => {
      if (this.network) {
        this.network.disconnect();
      }
    });
  }
  
  startGameLoop() {
    let lastTime = performance.now();
    
    const gameLoop = () => {
      // Calculate delta time
      const now = performance.now();
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;
      
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
  
  showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.style.position = 'fixed';
    errorDiv.style.top = '20px';
    errorDiv.style.left = '50%';
    errorDiv.style.transform = 'translateX(-50%)';
    errorDiv.style.backgroundColor = 'rgba(239, 68, 68, 0.9)';
    errorDiv.style.color: 'white';
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
        document.body.removeChild(errorDiv);
      }, 500);
    }, 5000);
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
