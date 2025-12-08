// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.19 (PATCHED)
// Refactor: Added loginTest, startNewGameSession, and removed hardcoded character ID.
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
    this.network = new NetworkManager();
    this.characterId = null; // Removed hardcoded ID

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
    
    // 1. Load Templates (always required)
    await this.network.loadTemplates(this.itemTemplates, this.skillTemplates, this.npcTemplates);
    
    // 2. Start the new login/creation flow
    // NOTE: You must replace this with your actual UI/Menu logic later.
    await this.loginTest();
  }

  /**
   * Placeholder test function for login/account/character creation flow.
   * Demonstrates how the new network methods are used.
   */
  async loginTest() {
    const ACCOUNT_NAME = 'test_player@hosg.com'; // Use a test email or name
    const CHARACTER_NAME = 'SirPlaysalot'; 
    let accountId;
    let characterToLoadId;

    // --- 1. Get/Create Account ---
    let accResult = await this.network.supabase.getAccountByName(ACCOUNT_NAME);

    if (accResult.success && accResult.account) {
        accountId = accResult.account.id;
        console.log(`[Login] Account found: ${ACCOUNT_NAME} (ID: ${accountId})`);
    } else {
        console.log(`[Login] Account not found. Creating new account: ${ACCOUNT_NAME}`);
        const createResult = await this.network.supabase.createAccount(ACCOUNT_NAME);
        if (!createResult.success) {
            console.error(`[Login] Failed to create account: ${createResult.error}`);
            return;
        }
        accountId = createResult.account.id;
    }

    // --- 2. Check for Characters (Simplified: just look for the test character name) ---
    // In a real game, you would fetch all characters linked to the account ID.
    const charResult = await this.network.supabase.getCharacterByName(CHARACTER_NAME);
    
    if (charResult.success && charResult.character) {
        characterToLoadId = charResult.character.id;
        console.log(`[Login] Character found: ${CHARACTER_NAME} (ID: ${characterToLoadId})`);
    } else {
        console.log(`[Login] Character not found. Creating new character: ${CHARACTER_NAME}`);
        const createCharResult = await this.network.supabase.createCharacter(accountId, CHARACTER_NAME);
        if (!createCharResult.success) {
            console.error(`[Login] Failed to create character: ${createCharResult.error}`);
            return;
        }
        characterToLoadId = createCharResult.characterId;
    }

    // --- 3. Start Game Session ---
    await this.startNewGameSession(characterToLoadId);
  }

  /**
   * Handles the initialization of the player and starting the game loop.
   * @param {string} characterId - The UUID of the character to load.
   */
  async startNewGameSession(characterId) {
    this.characterId = characterId;

    // Player must be initialized AFTER templates are loaded and before UI
    this.player = new Player(this.scene); 
    await this.player.init(); 

    // Load state onto the player
    const loadResult = await this.network.supabase.loadCharacterState(this.characterId);
    if (loadResult.success) {
        this.player.loadState(loadResult.state); 
    } else {
        console.warn(`[Game] Failed to load character state: ${loadResult.error}. Using default state.`);
        // Note: If load fails after character creation, it means the character record exists
        // but the load failed. The Player object will still have default stats.
    }

    // Initialize UI
    this.ui = new UIManager(this);
    
    this.setupPersistence();
    this.start();
  }

  start() {
    // ... (rest of start function remains the same) ...
  }

  setupPersistence() {
    // ... (rest of setupPersistence function remains the same) ...
  }
  
  async save(isCritical = false) {
    // ... (rest of save function remains the same) ...
  }

  dispose() {
    // ... (rest of dispose function remains the same) ...
  }
}
