// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.9 (PATCHED)
// Main loop and Persistence Handler
// ============================================================

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error("Canvas not found");

    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true;
    this.scene.game = this; 

    if (typeof CANNON !== "undefined") {
      const gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
      try {
        this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
      } catch (err) {
        console.warn("[Game] CannonJSPlugin not available. Physics disabled.");
      }
    } 

    this.world = null;
    this.player = null;
    this.ui = null;
    this.network = null;
    this.characterId = null; 

    // Initialize Maps for templates
    this.itemTemplates = new Map();
    this.skillTemplates = new Map();
    this.npcTemplates = new Map();
    this.spawnPoints = []; // Spawn points remain an array

    this._lastFrameTime = performance.now();
    this._running = false;
    this.autosaveInterval = null;

    window.addEventListener("resize", () => { this.engine.resize(); });
  }

  async init() {
    console.log("[Game] Initializing...");
    
    // Basic lighting
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);
    
    // 1. Load Assets
    this.assets = new AssetManager(this.scene);
    await this.assets.loadAll();
    
    // 2. Initialize Network & Load Templates
    this.network = new NetworkManager();
    
    // PATCH: Use the correct function names (load...Templates)
    this.itemTemplates = await this.network.supabase.loadItemTemplates();
    this.skillTemplates = await this.network.supabase.loadSkillTemplates();
    this.npcTemplates = await this.network.supabase.loadNPCTemplates();
    this.spawnPoints = await this.network.supabase.loadSpawnPoints();

    // 3. Initialize World (Needs loaded templates for spawns)
    this.world = new World(this.scene, { 
        spawnPoints: this.spawnPoints, 
        npcTemplates: this.npcTemplates 
    });
    
    // 4. Load Character Data from Network
    // NOTE: Using a hardcoded test UUID, replace this with your auth logic
    const characterLoadData = await this.network.supabase.loadCharacter('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'); 

    // 5. Initialize Player
    this.player = new Player(this.scene); 
    
    // 6. Initialize Player with all necessary data and templates
    await this.player.init({
        ...characterLoadData, // character, inventory_items, equipped_items, player_skills
        itemTemplates: this.itemTemplates, // Pass the Map
        skillTemplates: this.skillTemplates // Pass the Map
    });

    // 7. Initialize UI (Needs player object)
    this.ui = new UIManager(this); 
    
    // 8. Final setup
    this.characterId = characterLoadData.character.id;
    this.setupPersistence();
    
    console.log("[Bootstrap] Game ready.");
  }

  start() {
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
