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

    this._lastFrameTime = performance.now();
    this._running = false;

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    console.log("[Game] Initializing...");

    // Basic lighting
    // The World class will handle complex lighting, but a quick light helps debug
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);

    // Create World
    if (typeof World !== 'undefined') {
      // Use config values for world creation
      this.world = new World(this.scene, {
        size: CONFIG.WORLD.SIZE,
        segments: CONFIG.WORLD.TERRAIN_SIZE,
        maxHeight: 20,
        seed: CONFIG.WORLD.SEED || Math.random(),
        waterLevel: CONFIG.WORLD.WATER_LEVEL
      });
    } else {
      console.error("[Game] World class not defined.");
    }

    // Create Player
    if (typeof Player !== 'undefined') {
      this.player = new Player(this.scene);
      this.scene.player = this.player; // Keep a scene reference
      await this.player.init();
    } else {
      console.error("[Game] Player class not defined.");
    }

    // Initialize UI
    if (typeof UIManager !== 'undefined') {
      this.ui = new UIManager(this);
      this.scene.ui = this.ui;
      this.ui.player = this.player; // Re-assign player after it's created
    } else {
      console.warn("[Game] UIManager not defined.");
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

    // Start render loop
    this.start();
  }

  loadMusic() {
    // Load music file from your tracks folder
    const musicPath = "assets/sfx/tracks/eldertide.mp3"; // Change filename as needed
    
    try {
      this.music = new BABYLON.Sound(
        "backgroundMusic",
        musicPath,
        this.scene,
        () => {
          console.log("[Game] ✓ Music loaded");
        },
        {
          loop: true,
          autoplay: false, // Don't autoplay (browser restrictions)
          volume: this.musicVolume
        }
      );
      
      // Add click listener to start music (browsers require user interaction)
      document.addEventListener('click', () => {
        if (this.music && !this.music.isPlaying) {
          this.music.play();
          console.log("[Game] ♪ Music started");
        }
      }, { once: true });
      
    } catch (err) {
      console.warn("[Game] Music file not found or failed to load:", err);
    }
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
}
