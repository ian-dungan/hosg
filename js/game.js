// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.12 (PATCHED)
// Fix: Ensured safe physics plugin initialization and light creation
// to resolve "Cannot read properties of null (reading 'getUniqueId')" error.
// ============================================================

class Game {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error("Canvas not found");

    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.collisionsEnabled = true; 
    this.scene.game = this; 

    // Physics setup is moved to a separate method/later step for safety
    this.initPhysics(); 

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

  /**
   * Initializes the physics engine and plugin safely.
   */
  initPhysics() {
      // Check if CANNON (or the equivalent physics library) is loaded globally
      if (typeof CANNON !== "undefined") {
        try {
            const gravity = new BABYLON.Vector3(0, -CONFIG.GAME.GRAVITY, 0);
            // This is the line that sometimes fails if the plugin is not registered
            this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
            console.log('[Game] Physics enabled with CannonJSPlugin.');
        } catch (e) {
            console.warn('[Game] Failed to enable CannonJSPlugin. Falling back to no physics.', e.message);
        }
      } else {
          console.warn('[Game] Cannon.js not found. Physics disabled.');
      }
  }

  async init() {
    // This is the line that was crashing (light is a BABYLON.Node)
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);
    
    // Create the World and Player *before* setting up the UI 
    this.world = new World(this.scene); 
    this.player = new Player(this.scene);
    
    await this.player.init(); // Player initialization must complete before UI can reference its mesh

    // UI depends on the player being defined
    this.ui = new UIManager(this); 
    
    // Network initialization (including template loading and login logic)
    // This is a placeholder for your login/load flow
    await this.loadGameData();
    
    // Start game loop
    this.run(); 

    // Setup persistence
    this.setupPersistence();
  }
  
  async loadGameData() {
      // This is where you would handle login/character selection
      const accountName = "TestUser"; // Hardcode for testing
      const characterName = "TestChar";
      const className = "Fighter"; // Or load from form input
      
      const networkManager = new NetworkManager();
      this.network = networkManager;
      
      // 1. Get/Create Account
      let accountResult = await this.network.supabase.getAccountByName(accountName);
      if (!accountResult.account) {
          accountResult = await this.network.supabase.createAccount(accountName);
      }
      if (!accountResult.success) throw new Error(`Account error: ${accountResult.error}`);
      const accountId = accountResult.account.id;
      
      // 2. Get/Create Character
      let charResult = await this.network.supabase.getCharacterByName(characterName);
      if (!charResult.character) {
          charResult = await this.network.supabase.createCharacter(accountId, characterName, className);
      }
      if (!charResult.success) throw new Error(`Character error: ${charResult.error}`);
      this.characterId = charResult.character.id;
      
      // 3. Load Templates (needed for inventory/abilities)
      const templateResult = await this.network.loadTemplates(
          this.itemTemplates, 
          this.skillTemplates, 
          this.npcTemplates
      );
      if (!templateResult) throw new Error("Failed to load game templates.");

      // 4. Load Character State
      const stateResult = await this.network.supabase.loadCharacterState(this.characterId);
      if (stateResult.success) {
          this.player.loadState(stateResult.state);
          console.log(`[Game] Character state loaded for ID: ${this.characterId}`);
      } else {
          console.warn(`[Game] Failed to load character state. Applying default class: ${className}`);
          this.player.applyClass(className);
      }
      
      // 5. Initialize World (Spawns, map, etc.)
      this.world.init();
  }

  run() {
    console.log("[Game] Starting render loop...");
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
    if (!this.player || !this.characterId || !this.network) return;
    
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
    this.player.dispose();
    this.world.dispose();
    this.scene.dispose();
    this.engine.dispose();
  }
}
