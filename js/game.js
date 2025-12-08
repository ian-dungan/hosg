// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.11 (PATCHED)
// Fix: Added safe access for CONFIG.GAME.GRAVITY in constructor.
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
      // FIX: Check if CONFIG and CONFIG.GAME are defined before accessing GRAVITY
      const gameConfig = (typeof CONFIG !== 'undefined' && CONFIG.GAME) ? CONFIG.GAME : {};
      
      if (gameConfig.GRAVITY) {
        const gravity = new BABYLON.Vector3(0, -gameConfig.GRAVITY, 0);
        try {
            this.scene.enablePhysics(gravity, new BABYLON.CannonJSPlugin());
            console.log('[Game] Physics enabled with CannonJSPlugin.');
        } catch (e) {
             console.warn('[Game] Failed to enable CannonJSPlugin. Falling back to no physics.', e.message);
        }
      } else {
        console.warn('[Game] CONFIG.GAME.GRAVITY is undefined, skipping physics initialization.');
      }
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
    this.player = new Player(this.scene);
    
    await this.player.init(); 

    this.ui = new UIManager(this); 
    
    await this.loadGameData();
    
    this.run(); 

    this.setupPersistence();
  }
  
  async loadGameData() {
      const accountName = "TestUser"; 
      const characterName = "TestChar";
      const className = "Fighter";
      
      const networkManager = new NetworkManager();
      this.network = networkManager;
      
      let accountResult = await this.network.supabase.getAccountByName(accountName);
      if (!accountResult.account) {
          accountResult = await this.network.supabase.createAccount(accountName);
      }
      if (!accountResult.success) throw new Error(`Account error: ${accountResult.error}`);
      const accountId = accountResult.account.id;
      
      let charResult = await this.network.supabase.getCharacterByName(characterName);
      if (!charResult.character) {
          charResult = await this.network.supabase.createCharacter(accountId, characterName, className);
      }
      if (!charResult.success) throw new Error(`Character error: ${charResult.error}`);
      this.characterId = charResult.character.id;
      
      const templateResult = await this.network.loadTemplates(
          this.itemTemplates, 
          this.skillTemplates, 
          this.npcTemplates
      );
      if (!templateResult) throw new Error("Failed to load game templates.");

      const stateResult = await this.network.supabase.loadCharacterState(this.characterId);
      if (stateResult.success) {
          this.player.loadState(stateResult.state);
          console.log(`[Game] Character state loaded for ID: ${this.characterId}`);
      } else {
          console.warn(`[Game] Failed to load character state. Applying default class: ${className}`);
          this.player.applyClass(className);
      }
      
      this.world.init();
  }

  run() {
    console.log("[Game] Starting render loop...");
    this._lastFrameTime = performance.now();
    this._running = true;

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
