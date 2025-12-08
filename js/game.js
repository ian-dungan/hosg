// ============================================================
// HEROES OF SHADY GROVE - GAME ORCHESTRATION v1.0.16 (PATCHED)
// Fix: Changed hardcoded characterId from integer '1' to a UUID placeholder
//      to match expected database schema and prevent a 400 Bad Request error.
// ============================================================

class Game {
  // ... (constructor remains the same)

  async init() {
    new BABYLON.HemisphericLight("light1", new BABYLON.Vector3(0, 1, 0), this.scene);
    this.world = new World(this.scene);
    
    await this.network.loadTemplates(this.itemTemplates, this.skillTemplates, this.npcTemplates);
    
    // Hardcoded Character ID for persistence for now (will be replaced by login)
    // FIX: Replaced integer '1' with a UUID placeholder. YOU MUST REPLACE THIS WITH A REAL UUID!
    this.characterId = '00000000-0000-0000-0000-000000000001'; 
    // The previous value '1' caused a Supabase 400 Bad Request error.

    // Player must be initialized AFTER templates are loaded and before UI
    this.player = new Player(this.scene); 
    await this.player.init(); 

    // Load state onto the player
    const loadResult = await this.network.supabase.loadCharacterState(this.characterId);
// ... (rest of the file remains the same)
