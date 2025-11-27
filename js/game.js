// Main Game orchestration

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.error("[Game] Canvas element not found:", canvasId);
      return;
    }

    this.engine = new BABYLON.Engine(this.canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true
    });

    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;

    // Physics
    if (typeof CANNON !== "undefined") {
      const gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
      this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
    } else {
      console.warn("[Game] CANNON.js not found – physics disabled");
    }

    this.world = null;
    this.player = null;
    this.ui = null;
    this.network = null;

    this._lastFrameTime = performance.now();

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  async init() {
    // Basic ambient light
    const hemi = new BABYLON.HemisphericLight(
      "ambientLight",
      new BABYLON.Vector3(0, 1, 0),
      this.scene
    );
    hemi.intensity = 0.6;

    // World
    this.world = new World(this.scene, {
      size: CONFIG.WORLD.SIZE,
      waterLevel: CONFIG.WORLD.WATER_LEVEL
    });

    // Player
    this.player = new Player(this.scene);

    // UI
    this.ui = new UIManager(this);

    // Network
    if (window.NetworkManager) {
      this.network = new NetworkManager(CONFIG.NETWORK.WS_URL);
      try {
        await this.network.connect();
      } catch (err) {
        console.error("[Game] Failed to connect to WebSocket server", err);
      }
    }

    // Example server event hook; adjust to your protocol
    if (this.network) {
      this.network.on("welcome", (data) => {
        console.log("[Game] welcome from server:", data);
      });
    }

    console.log("[Game] Initialization complete");
  }

  start() {
    this._lastFrameTime = performance.now();

    this.engine.runRenderLoop(() => {
      const now = performance.now();
      const deltaTime = (now - this._lastFrameTime) / 1000;
      this._lastFrameTime = now;

      if (this.player && typeof this.player.update === "function") {
        this.player.update(deltaTime);
      }

      if (this.ui && typeof this.ui.update === "function") {
        this.ui.update(deltaTime);
      }

      this.scene.render();
    });
  }

  dispose() {
    if (this.network) {
      this.network.dispose();
      this.network = null;
    }
    if (this.engine) {
      this.engine.dispose();
    }
  }
}

window.Game = Game;
