// Main Game orchestration

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error("[Game] Canvas element not found:", canvasId);
      throw new Error("Canvas not found");
    }

    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.scene.game = this; // Allow access to game from scene
    
    // CRITICAL: Disable ALL debug visualization globally
    this.disableAllDebugVisualization();

    // Physics setup
    if (typeof CANNON !== "undefined") {
      const gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
      try {
        this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
        console.log("[Game] Physics engine enabled (Cannon.js)");
      } catch (err) {
        console.error("[Game] Failed to enable physics:", err);
      }
    } else {
      console.warn("[Game] CANNON.js not found - physics disabled");
    }

    this.world = null;
    this.player = null;
    this.ui = null;
    this.network = null;
    this.music = null;
    this.musicVolume = 0.3; // 30% volume by default
    this.combat = null; // Combat system

    this._lastFrameTime = performance.now();
    this._running = false;

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }
  
  disableAllDebugVisualization() {
    // Disable debug layer
    if (this.scene.debugLayer) {
      this.scene.debugLayer.hide();
    }
    
    // Disable ALL bounding boxes globally
    this.scene.forceShowBoundingBoxes = false;
    
    // Disable utility layer (used for gizmos, etc)
    if (BABYLON.UtilityLayerRenderer) {
      const utilityLayer = BABYLON.UtilityLayerRenderer.DefaultUtilityLayer;
      if (utilityLayer) {
        utilityLayer.utilityLayerScene.autoClear = false;
        utilityLayer.shouldRender = false;
      }
      
      const keeperUtilityLayer = BABYLON.UtilityLayerRenderer.DefaultKeepDepthUtilityLayer;
      if (keeperUtilityLayer) {
        keeperUtilityLayer.utilityLayerScene.autoClear = false;
        keeperUtilityLayer.shouldRender = false;
      }
    }
    
    // Disable any gizmo managers
    if (this.scene._gizmoManager) {
      this.scene._gizmoManager.dispose();
      this.scene._gizmoManager = null;
    }
    
    // Observer to hide debug visualization on ALL meshes (existing and new)
    this.scene.onNewMeshAddedObservable.add((mesh) => {
      this.hideDebugOnMesh(mesh);
    });
    
    // Hide debug on all existing meshes
    this.scene.meshes.forEach(mesh => {
      this.hideDebugOnMesh(mesh);
    });
    
    // Disable physics debug rendering if present
    if (this.scene.physicsEnabled && this.scene.getPhysicsEngine()) {
      const engine = this.scene.getPhysicsEngine();
      if (engine.setDebugMode) {
        engine.setDebugMode(0); // 0 = no debug
      }
    }
    
    console.log('[Game] All debug visualization disabled');
  }
  
  hideDebugOnMesh(mesh) {
    if (!mesh) return;
    
    // Hide all debug rendering options
    mesh.showBoundingBox = false;
    mesh.showSubMeshesBoundingBox = false;
    mesh.renderOutline = false;
    mesh.renderOverlay = false;
    mesh.showEllipsoid = false;
    
    // Hide wireframe
    if (mesh.material) {
      mesh.material.wireframe = false;
    }
    
    // Hide meshes with debug names
    const name = (mesh.name || '').toLowerCase();
    if (name.includes('collision') || 
        name.includes('collider') || 
        name.includes('hitbox') ||
        name.includes('debug') ||
        name.includes('physics') ||
        name.includes('primitive') ||
        name.includes('helper') ||
        name.includes('gizmo') ||
        name.includes('bounds') ||
        name.includes('box')) {
      mesh.isVisible = false;
      mesh.setEnabled(false);
    }
  }

  async init() {
    console.log("[Game] Initializing...");

    // Show loading screen
    this.showLoadingScreen();

    // Basic lighting
    // The World class will handle complex lighting, but a quick light helps debug
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);

    // Create World
    if (typeof World !== 'undefined') {
      this.updateLoadingScreen('Creating world...', 5);
      
      // Use config values for world creation
      this.world = new World(this.scene, {
        size: CONFIG.WORLD.SIZE,
        segments: CONFIG.WORLD.TERRAIN_SIZE,
        maxHeight: 10,  // Reduced from 20 for gentler hills (try 5-20)
        seed: CONFIG.WORLD.SEED || Math.random(),
        waterLevel: CONFIG.WORLD.WATER_LEVEL,
        onProgress: (message, percent) => {
          this.updateLoadingScreen(message, percent);
        }
      });
      
      // Wait for world to finish initializing
      await this.world.init();
    } else {
      console.error("[Game] World class not defined.");
    }

    // Create Player
    this.updateLoadingScreen('Creating player...', 92);
    if (typeof Player !== 'undefined') {
      this.player = new Player(this.scene);
      this.scene.player = this.player; // Keep a scene reference
      await this.player.init();
    } else {
      console.error("[Game] Player class not defined.");
    }

    // Initialize UI
    this.updateLoadingScreen('Initializing UI...', 94);
    if (typeof UIManager !== 'undefined') {
      this.ui = new UIManager(this);
      this.scene.ui = this.ui;
      this.ui.player = this.player; // Re-assign player after it's created
    } else {
      console.warn("[Game] UIManager not defined.");
    }

    // Initialize Combat System
    this.updateLoadingScreen('Loading combat system...', 96);
    if (typeof CombatSystem !== 'undefined') {
      this.combat = new CombatSystem(this);
      this.scene.combat = this.combat;
      
      // Initialize player stats
      if (this.player) {
        this.player.stats = this.combat.getDefaultStats(this.player);
      }
    } else {
      console.warn("[Game] CombatSystem not defined.");
    }

    // Initialize Inventory System
    this.updateLoadingScreen('Creating inventory...', 98);
    if (typeof InventoryManager !== 'undefined' && this.player) {
      this.player.inventory = new InventoryManager(this.player, this);
      this.player.inventory.createInventoryUI();
      console.log("[Game] Inventory system initialized");
    } else {
      console.warn("[Game] InventoryManager not defined.");
    }

    // Initialize Network
    if (typeof NetworkManager !== 'undefined') {
      this.network = new NetworkManager(this);
      this.network.connect();
    } else {
      console.warn("[Game] NetworkManager not defined.");
    }

    // Load background music
    this.loadMusic();

    // Hide loading screen
    this.updateLoadingScreen('Ready!', 100);
    setTimeout(() => this.hideLoadingScreen(), 500);
    
    // FINAL PASS: Hide all debug visualization on all meshes
    setTimeout(() => {
      console.log('[Game] Final debug cleanup pass...');
      this.scene.meshes.forEach(mesh => this.hideDebugOnMesh(mesh));
      console.log('[Game] Debug cleanup complete');
    }, 1000);

    // Start render loop
    this.start();
  }

  loadMusic() {
    // Load music file from your tracks folder
    const musicPath = "assets/sfx/tracks/background.mp3"; // Change filename as needed
    
    try {
      this.music = new BABYLON.Sound(
        "backgroundMusic",
        musicPath,
        this.scene,
        () => {
          console.log("[Game] ✓ Music loaded");
          this.showMusicPrompt();
        },
        {
          loop: true,
          autoplay: false, // Don't autoplay (browser restrictions)
          volume: this.musicVolume
        }
      );
      
    } catch (err) {
      console.warn("[Game] Music file not found or failed to load:", err);
    }
  }
  
  showMusicPrompt() {
    const musicPrompt = document.createElement('div');
    musicPrompt.id = 'music-prompt';
    musicPrompt.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 2px solid #ffd700;
      border-radius: 8px;
      padding: 15px 20px;
      z-index: 10000;
      font-family: Arial, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      cursor: pointer;
      transition: all 0.3s;
    `;
    
    musicPrompt.innerHTML = `
      <div style="color: #ffd700; font-weight: bold; margin-bottom: 5px;">🎵 Click to Enable Music</div>
      <div style="color: #aaa; font-size: 12px;">Background music available</div>
    `;
    
    musicPrompt.addEventListener('mouseenter', () => {
      musicPrompt.style.transform = 'scale(1.05)';
    });
    
    musicPrompt.addEventListener('mouseleave', () => {
      musicPrompt.style.transform = 'scale(1)';
    });
    
    musicPrompt.addEventListener('click', () => {
      if (this.music) {
        this.music.play();
        console.log('[Game] ♪ Music started');
        musicPrompt.remove();
        this.showMusicControls();
      }
    });
    
    document.body.appendChild(musicPrompt);
  }
  
  showMusicControls() {
    const controls = document.createElement('div');
    controls.id = 'music-controls';
    controls.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0,0,0,0.7);
      border: 1px solid #666;
      border-radius: 6px;
      padding: 8px 12px;
      z-index: 10000;
      display: flex;
      gap: 10px;
      align-items: center;
    `;
    
    controls.innerHTML = `
      <button id="music-toggle" style="background: #4CAF50; border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px;">🔊 Mute</button>
      <input type="range" id="music-volume" min="0" max="100" value="30" style="width: 80px;">
    `;
    
    document.body.appendChild(controls);
    
    const toggleBtn = document.getElementById('music-toggle');
    const volumeSlider = document.getElementById('music-volume');
    
    toggleBtn.addEventListener('click', () => {
      if (this.music.isPlaying) {
        this.music.pause();
        toggleBtn.textContent = '🔇 Unmute';
        toggleBtn.style.background = '#f44336';
      } else {
        this.music.play();
        toggleBtn.textContent = '🔊 Mute';
        toggleBtn.style.background = '#4CAF50';
      }
    });
    
    volumeSlider.addEventListener('input', (e) => {
      const volume = e.target.value / 100;
      this.musicVolume = volume;
      if (this.music) {
        this.music.setVolume(volume);
      }
    });
  }

  toggleMusic() {
    if (!this.music) return;
    
    if (this.music.isPlaying) {
      this.music.pause();
      console.log("[Game] Music paused");
    } else {
      this.music.play();
      console.log("[Game] Music playing");
    }
  }

  setMusicVolume(volume) {
    // volume: 0.0 to 1.0
    this.musicVolume = Math.max(0, Math.min(1, volume));
    if (this.music) {
      this.music.setVolume(this.musicVolume);
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    console.log("[Game] Started");

    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaTime = (now - this._lastFrameTime) / 1000; // Convert to seconds
      this._lastFrameTime = now;

      // Update player
      if (this.player && typeof this.player.update === "function") {
        try {
          this.player.update(deltaTime);
        } catch (err) {
          console.error("[Game] Player update error:", err);
        }
      }

      // Update world
      if (this.world && typeof this.world.update === "function") {
        try {
          this.world.update(deltaTime);
        } catch (err) {
          console.error("[Game] World update error:", err);
        }
      }

      // Update UI
      if (this.ui && typeof this.ui.update === "function") {
        try {
          this.ui.update(deltaTime);
        } catch (err) {
          console.error("[Game] UI update error:", err);
        }
      }

      // Update Combat System
      if (this.combat && typeof this.combat.update === "function") {
        try {
          this.combat.update(deltaTime);
        } catch (err) {
          console.error("[Game] Combat update error:", err);
        }
      }

      // Update Inventory System
      if (this.player && this.player.inventory && typeof this.player.inventory.update === "function") {
        try {
          this.player.inventory.update(deltaTime);
        } catch (err) {
          console.error("[Game] Inventory update error:", err);
        }
      }
      
      // Update WorldItems (loot on ground)
      if (this.world && this.world.worldItems) {
        try {
          for (let i = this.world.worldItems.length - 1; i >= 0; i--) {
            const worldItem = this.world.worldItems[i];
            if (worldItem && typeof worldItem.update === 'function') {
              worldItem.update(deltaTime);
              
              // Auto-pickup if player is close
              if (this.player && this.player.mesh && this.player.inventory) {
                const distance = BABYLON.Vector3.Distance(
                  this.player.mesh.position,
                  worldItem.mesh.position
                );
                
                const pickupRange = 3.0; // units
                if (distance < pickupRange) {
                  // Pick up item
                  const success = this.player.inventory.addItem(worldItem.itemData);
                  if (success) {
                    console.log(`[Game] Picked up: ${worldItem.itemData.name}`);
                    worldItem.dispose();
                    this.world.worldItems.splice(i, 1);
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error("[Game] WorldItems update error:", err);
        }
      }

      // Render scene
      try {
        this.scene.render();
      } catch (err) {
        console.error("[Game] Render error:", err);
      }
    });

    if (this.ui) {
      this.ui.showMessage("Welcome to Heroes of Shady Grove!", 3000);
    }
  }

  stop() {
    this._running = false;
    console.log("[Game] Stopped");
  }

  dispose() {
    console.log("[Game] Disposing resources");
    this.stop();
    
    if (this.network) {
      this.network.dispose();
      this.network = null;
    }
    
    if (this.ui) {
      this.ui.dispose();
      this.ui = null;
    }
    
    if (this.player) {
      this.player.dispose();
      this.player = null;
    }
    
    if (this.world && typeof this.world.dispose === "function") {
      this.world.dispose();
      this.world = null;
    }

    if (this.scene) {
        this.scene.dispose();
        this.scene = null;
    }
    
    if (this.engine) {
      this.engine.dispose();
      this.engine = null;
    }
  }
  
  // Loading screen methods
  showLoadingScreen() {
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'loading-screen';
    loadingDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      z-index: 10000;
      font-family: Arial, sans-serif;
    `;
    
    loadingDiv.innerHTML = `
      <h1 style="color: #ffd700; font-size: 48px; margin-bottom: 20px; text-shadow: 2px 2px 4px rgba(0,0,0,0.5);">
        Heroes of Shady Grove
      </h1>
      <div style="width: 400px; max-width: 80%; background: rgba(0,0,0,0.3); border-radius: 10px; padding: 4px;">
        <div id="loading-bar" style="width: 0%; height: 30px; background: linear-gradient(90deg, #4CAF50, #8BC34A); border-radius: 8px; transition: width 0.3s ease;"></div>
      </div>
      <p id="loading-text" style="color: #fff; margin-top: 20px; font-size: 18px;">Starting...</p>
      <p id="loading-percent" style="color: #aaa; margin-top: 10px; font-size: 16px;">0%</p>
    `;
    
    document.body.appendChild(loadingDiv);
  }
  
  updateLoadingScreen(message, percent) {
    const loadingBar = document.getElementById('loading-bar');
    const loadingText = document.getElementById('loading-text');
    const loadingPercent = document.getElementById('loading-percent');
    
    if (loadingBar) loadingBar.style.width = percent + '%';
    if (loadingText) loadingText.textContent = message;
    if (loadingPercent) loadingPercent.textContent = Math.round(percent) + '%';
  }
  
  hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
      loadingScreen.style.opacity = '0';
      loadingScreen.style.transition = 'opacity 0.5s ease';
      setTimeout(() => {
        if (loadingScreen.parentNode) {
          loadingScreen.parentNode.removeChild(loadingScreen);
        }
      }, 500);
    }
  }
}
