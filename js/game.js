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

    this._lastFrameTime = performance.now();
    this._running = false;

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    console.log("[Game] Initializing...");

    // Basic lighting setup is handled by World now, but keeping ambient for safety
    if (!this.scene.lights.length) {
      new BABYLON.HemisphericLight("ambient", new BABYLON.Vector3(0, 1, 0), this.scene);
    }

    // 1. Create World
    if (typeof World !== "undefined") {
      this.world = new World(this.scene, {
        size: CONFIG.WORLD.SIZE,
        waterLevel: CONFIG.WORLD.WATER_LEVEL
      });
      // World's init is ASYNC now and handles asset loading.
      // We don't await the constructor, but the world handles its own readiness signal.
    } else {
      console.error("[Game] World class not defined.");
      return;
    }

    // 2. Create Player
    if (typeof Player !== "undefined") {
      this.player = new Player(this.scene);
      this.scene.player = this.player; // Global access via scene
    } else {
      console.error("[Game] Player class not defined.");
      return;
    }

    // 3. Create UI
    if (typeof UIManager !== "undefined") {
      this.ui = new UIManager(this);
    } else {
      console.warn("[Game] UIManager class not defined.");
    }
    
    // 4. Create Network Manager (if necessary)
    if (typeof NetworkManager !== "undefined") {
        this.network = new NetworkManager(this, CONFIG.NETWORK.WS_URL);
        this.network.connect(); // Connect asynchronously
    } else {
        console.warn("[Game] NetworkManager class not defined.");
    }

    // 5. Start main loop
    this.start();

    console.log("[Game] Initialization complete.");
  }

  start() {
    this._running = true;
    console.log("[Game] Started");

    this.engine.runRenderLoop(() => {
      if (!this._running) {
        return;
      }

      const now = performance.now();
      const deltaTime = (now - this._lastFrameTime) / 1000; // in seconds
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
