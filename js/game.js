// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.10 (PATCHED)
// Fix: Removed unexpected invisible character in Game constructor.
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
    this.scene.createDefaultCamera(true, true, true);
    this.scene.activeCamera.attachControl(this.canvas, true);

    // 1. Load Data Templates
    this.network = new NetworkManager();
    const loadResult = await this.network.supabase.loadTemplates();

    if (!loadResult.success) {
      throw new Error("Failed to load game data from Supabase.");
    }
    
    // Store templates on Maps for quick lookup
    loadResult.templates.itemTemplates.forEach(t => this.itemTemplates.set(t.id, t));
    loadResult.templates.skillTemplates.forEach(t => this.skillTemplates.set(t.id, t));
    loadResult.templates.npcTemplates.forEach(t => this.npcTemplates.set(t.id, t));
    this.spawnPoints = loadResult.templates.spawnPoints;

    console.log("[Bootstrap] Templates loaded successfully.");

    // 2. Load Assets
    this.assetManager = new AssetManager(this.scene);
    await this.assetManager.loadAll();
    console.log("[Bootstrap] Assets loaded successfully.");

    // 3. Initialize World, Player, and UI
    this.world = new World(this.scene);
    this.world.createGround();
    this.world.createWater();
    this.world.createSky();
    this.world.createSpawnPoints(this.spawnPoints, this.npcTemplates);

    this.player = new Player(this.scene);
    // Player mesh/camera/input setup must be awaited before starting game
    await this.player._initMesh(); 
    this.player._initCamera();
    this.player._initInput();
    this.player.mesh.position.y = CONFIG.PLAYER.SPAWN_HEIGHT;

    this.ui = new UIManager(this); 
    this.player.setUIManager(this.ui); // Link player back to UI for messages

    // 4. Persistence setup (Temporary hardcoded ID for demo)
    this.characterId = 1; 
    await this.loadCharacter(this.characterId);
    this.setupPersistence();

    console.log("[Bootstrap] Game initialized.");
    this.start();
  }
  
  async loadCharacter(characterId) {
    if (!this.network.supabase) return;
    
    const result = await this.network.supabase.getCharacterData(characterId);
    
    if (result.success && result.data) {
        const data = result.data;
        
        // 1. Load Position
        this.player.mesh.position.set(data.position_x, data.position_y, data.position_z);
        if (this.player.visualRoot) {
            this.player.visualRoot.rotation.y = data.rotation_y;
        }

        // 2. Load Stats/Health/Resources
        this.player.stats = { ...this.player.stats, ...data.stats };
        this.player.health = data.health;
        this.player.mana = data.mana;
        this.player.stamina = data.stamina;

        // 3. Load Inventory and Equipment (using Maps created from templates)
        this.player.inventory.load(data.hosg_character_items, this.itemTemplates);
        this.player.equipment.load(data.hosg_character_equipment, this.itemTemplates);
        
        // 4. Load Abilities (assuming abilities are not stored per character yet)
        
        this.ui.showMessage(`Character ID ${characterId} loaded.`, 2000, 'success');
    } else {
         this.ui.showMessage(`Character ID ${characterId} not found. Starting new game.`, 3000, 'info');
         // Initialize player resources to max if load fails
         this.player.health = this.player.stats.maxHealth;
         this.player.mana = this.player.stats.maxMana;
         this.player.stamina = this.player.stats.maxStamina;
    }
  }

  start() {
    this._lastFrameTime = performance.now();
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
    window.removeEventListener('beforeunload', this.save);
    
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

    if (this.engine) {
      this.engine.dispose();
    }
  }
}
