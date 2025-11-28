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

    this._lastFrameTime = performance.now();
    this._running = false;

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    console.log("[Game] Initializing...");

    // Basic lighting (will be overridden by World class)
    const hemi = new BABYLON.HemisphericLight(
      "tempLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );
    hemi.intensity = 0.6;

    // World
    try {
      this.world = new World(this.scene, {
        size: CONFIG.WORLD.SIZE,
        waterLevel: CONFIG.WORLD.WATER_LEVEL
      });
      console.log("[Game] World initialized");
    } catch (err) {
      console.error("[Game] World initialization failed:", err);
      throw err;
    }

    // Player
    try {
      this.player = new Player(this.scene);
      // Expose player on the scene so AI and other systems can find it
      this.scene.player = this.player;
      console.log("[Game] Player initialized");
    } catch (err) {
      console.error("[Game] Player initialization failed:", err);
      throw err;
    }

    // UI
    try {
      this.ui = new UIManager(this);
      console.log("[Game] UI initialized");
    } catch (err) {
      console.error("[Game] UI initialization failed:", err);
      throw err;
    }

    // Network (optional - game works without it)
    if (window.NetworkManager) {
      try {
        this.network = new NetworkManager(CONFIG.NETWORK.WS_URL);
        
        // Setup network event handlers
        this.network.on("open", () => {
          console.log("[Game] Connected to multiplayer server");
          if (this.ui) {
            this.ui.showMessage("Connected to multiplayer server", 2000);
          }
        });
        
        this.network.on("close", () => {
          console.log("[Game] Disconnected from multiplayer server");
        });
        
        this.network.on("error", (err) => {
          console.error("[Game] Network error:", err);
        });
        
        this.network.on("maxReconnectReached", () => {
          console.error("[Game] Failed to connect to multiplayer server");
          if (this.ui) {
            this.ui.showMessage("Playing in offline mode", 3000);
          }
        });

        // Connect (don't block game startup if it fails)
        this.network.connect().catch((err) => {
          console.warn("[Game] Failed to connect to multiplayer server:", err);
          if (this.ui) {
            this.ui.showMessage("Playing in offline mode", 3000);
          }
        });
      } catch (err) {
        console.error("[Game] Network initialization failed:", err);
      }
    }

    console.log("[Game] Initialization complete");
  }

  start() {
    if (this._running) {
      console.warn("[Game] Already running");
      return;
    }

    this._running = true;
    this._lastFrameTime = performance.now();

    console.log("[Game] Starting render loop");

    this.engine.runRenderLoop(() => {
      if (!this._running) return;

      const now = performance.now();
      const deltaTime = (now - this._lastFrameTime) / 1000;
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

window.Game = Game;
