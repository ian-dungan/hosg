// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.13 (PATCHED)
// Fix: Removed unnecessary and crashing call to this.player.setUIManager() from init().
// ============================================================

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error("Canvas not found");

    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true; // Cleaned up line
    this.scene.game = this; 

    if (typeof CANNON !== "undefined") {
      const gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
      this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
    } 

    this.world = null;
    this.player = null;
    this.ui = null;
    this.network = null;
    this.characterId = null; 

    this.itemTemplates = new Map();
    this.skillTemplates = new Map();
    this.npcTemplates = new Map();

    this._lastFrameTime = performance.now();
    this._running = false;
    this.autosaveInterval = null;

    window.addEventListener("resize", () => { this.engine.resize(); });
  }

  async init() {
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);
    this.world = new World(this.scene);
    
    await this.network.loadTemplates(this.itemTemplates, this.skillTemplates, this.npcTemplates);
    
    // Hardcoded Character ID for persistence for now (will be replaced by login)
    this.characterId = 1; 

    // Player must be initialized AFTER templates are loaded and before UI
    this.player = new Player(this.scene); 
    await this.player.init(); // This is an async call now

    // Load state onto the player
    const loadResult = await this.network.loadCharacterState(this.characterId);
    if (loadResult.success) {
        // Player's inventory and equipment loading is now handled inside player.js/item.js
        this.player.loadState(loadResult.state); 
    } else {
        console.warn(`[Game] Failed to load character state: ${loadResult.error}. Using default state.`);
    }

    // Initialize UI
    this.ui = new UIManager(this);
    // REMOVED: if (this.player) this.player.setUIManager(this.ui); // Crash was here
    
    this.setupPersistence();
    this.start();
  }

  start() {
    this.scene.executeWhenReady(() => {
        // Ensure player is available before starting game loop
        if (!this.player) {
            console.error("[Bootstrap] Game failed to start: Player not initialized.");
            return;
        }

        console.log("[Bootstrap] Game started.");
        this._running = true;

        // Start rendering loop
        this.engine.runRenderLoop(() => {
            const currentTime = performance.now();
            const deltaTime = (currentTime - this._lastFrameTime) / 1000;
            this._lastFrameTime = currentTime;

            if (!this._running) return;

            if (this.player) this.player.update(deltaTime);
            if (this.world) this.world.update(deltaTime);
            if (this.ui) this.ui.update(deltaTime);

            this.scene.render();
        });

        if (this.ui) {
            this.ui.showMessage("Welcome to Heroes of Shady Grove! (Persistence Active)", 3000);
        }
    });
  }

  setupPersistence() {
    this.autosaveInterval = setInterval(() => {
        this.save();
    }, 60000); 

    window.addEventListener('beforeunload', () => {
        this.save(true);
    });
  }
  
  async save(isCritical = false) {
    if (!this.player || !this.characterId) return;
    
    const state = this.player.getSaveData();
    const result = await this.network.supabase.saveCharacterState(this.characterId, state);
    
    if (result.success) {
        if (!isCritical) this.ui.showMessage("Game Saved!", 1500, 'success');
    } else {
        this.ui.showMessage(`SAVE FAILED: ${result.error}`, 3000, 'error');
    }
  }

  dispose() {
    console.log("[Game] Disposing resources");
    this.stop();
    clearInterval(this.autosaveInterval);
    if (this.player) this.player.dispose();
    if (this.world) this.world.dispose();
    if (this.ui) this.ui.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
