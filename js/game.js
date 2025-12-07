// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.8
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
    this.network = new NetworkManager();
    
    // 1. Load Templates & Spawns
    this.itemTemplates = await this.network.supabase.fetchItemTemplates();
    this.skillTemplates = await this.network.supabase.fetchSkillTemplates();
    this.npcTemplates = await this.network.supabase.fetchNpcTemplates();
    const npcSpawns = await this.network.supabase.fetchNpcSpawns(1); 
    
    // 2. Create World
    this.world = new World(this.scene, { 
        npcSpawns: npcSpawns, 
        npcTemplates: this.npcTemplates 
    });
    await this.world.init();

    // 3. Load Character Data
    // Use a test UUID from the SQL data
    this.characterId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; 
    const characterLoadData = await this.network.supabase.loadCharacter(this.characterId);

    // 4. Create Player
    this.player = new Player(this.scene);
    await this.player.init({
        ...characterLoadData.character,
        inventory_items: characterLoadData.inventory,
        equipped_items: characterLoadData.equipment,
        player_skills: characterLoadData.skills,
        itemTemplates: this.itemTemplates,
        skillTemplates: this.skillTemplates
    });

    // 5. Initialize UI
    this.ui = new UIManager(this);
    
    // 6. Persistence Logic
    this.setupPersistence();
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
    this.stop();
    
    if (this.autosaveInterval) clearInterval(this.autosaveInterval);
    
    if (this.player && this.characterId) this.save(true);
    
    if (this.engine) this.engine.dispose();
  }

  stop() {
    this._running = false;
  }
}
