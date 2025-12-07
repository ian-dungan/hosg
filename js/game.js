// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.10 (PATCHED)
// Fix: Removed unexpected '\n' character in Game constructor.
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
    this.assets = new AssetManager(this.scene); // Assuming AssetManager exists
    await this.assets.loadAssets(); // Wait for assets to finish loading

    this.network = new NetworkManager();
    this.characterId = "00000000-0000-0000-0000-000000000001"; // Placeholder character ID

    // 1. Load Templates (Game data)
    this.itemTemplates = await this.network.supabase.loadItemTemplates();
    this.skillTemplates = await this.network.supabase.loadSkillTemplates();
    this.npcTemplates = await this.network.supabase.loadNPCTemplates();

    // 2. Load World (Terrain, Spawns)
    const spawnPoints = await this.network.supabase.loadSpawnPoints();
    this.world = new World(this.scene); 
    this.world.loadSpawns(spawnPoints, this.npcTemplates);
    
    // 3. Load Player Data
    const characterData = await this.network.supabase.loadCharacter(this.characterId);
    
    // 4. Initialize Player
    this.player = new Player(this.scene);

    // FIX: Await player visuals setup before attempting to set position/rotation
    await this.player.setupVisuals(); 

    // Pass the loaded data to the player and UI
    this.player.init(characterData, this.itemTemplates, this.skillTemplates);
    
    // 5. Initialize UI
    this.ui = new UIManager(this); 

    this.setupPersistence();
    this.start();
  }

  start() {
    if (this._running) return;
    console.log("[Game] Starting game loop...");
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
    
    if (this.network) this.network.dispose();
    if (this.ui) this.ui.dispose();
    if (this.player) this.player.dispose();
    if (this.world && typeof this.world.dispose === "function") this.world.dispose();
    
    this.engine.dispose();
  }
}
