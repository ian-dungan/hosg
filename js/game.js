// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.11 (PATCHED)
// Fix: Handle character state loading gracefully (load or create).
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
      } catch(e) {
         console.error("[Game] Failed to enable physics:", e);
      }
    } 

    this.world = null;
    this.player = null;
    this.ui = null;
    this.network = null;
    // NOTE: This ID is currently hardcoded for persistence demo purposes
    this.characterId = '00000000-0000-0000-0000-000000000001'; 

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
    this.scene.ambientColor = new BABYLON.Color3(0.5, 0.5, 0.5);

    this.network = new NetworkManager(this);
    
    // 1. Load Templates (Items, Skills, NPCs, Spawns)
    const templateData = await this.network.supabase.loadTemplates();
    
    // Populate Maps
    templateData.itemTemplates.forEach(t => this.itemTemplates.set(t.id, t));
    templateData.skillTemplates.forEach(t => this.skillTemplates.set(t.id, t));
    templateData.npcTemplates.forEach(t => this.npcTemplates.set(t.code, t)); // NPCs mapped by CODE

    // 2. Load World and NPCs
    this.world = new World(this.scene);
    // Pass NPC Templates by code Map and spawn points Array
    this.world.loadSpawns(templateData.spawnPoints, this.npcTemplates); 

    // 3. Load Character State (or create new if none exists)
    let characterState = null;
    try {
        // loadCharacterState now returns null if not found
        characterState = await this.network.supabase.loadCharacterState(this.characterId);
    } catch(e) {
        console.error("[Game] CRITICAL: Database load failed. Starting a new character.", e);
        // On critical failure, characterState remains null to create a new player
    }
    
    this.player = new Player(this.scene);
    // load method is responsible for setting up a new player if characterState is null
    await this.player.load(characterState, this.itemTemplates, this.skillTemplates);
    

    // 4. Setup UI and Start Loop
    this.ui = new UIManager(this);
    this.start();
    this.setupPersistence();
  }

  start() {
    // ... (rest of start method) ...
  }

  setupPersistence() {
    // ... (rest of setupPersistence method) ...
  }
  
  async save(isCritical = false) {
    // ... (rest of save method) ...
  }

  dispose() {
    // ... (rest of dispose method) ...
  }
}

window.Game = Game;
