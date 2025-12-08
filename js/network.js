// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.33 (NPC TEMPLATE ADDED)
// Fix: Moved _init logic directly into the constructor to resolve a TypeError
//      where the prototype method was not fully registered before being called.
// New: Added Wolf NPC template for World spawning.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    
    // 1. DEFINE YOUR CONNECTION VARIABLES
    const supabaseUrl = 'https://vaxfoafjjybwcxwhicla.supabase.co';
    const supabaseKey = 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';
    
    // 2. Initialize the Supabase Client
    if (typeof supabase !== 'undefined') {
        this.client = supabase.createClient(supabaseUrl, supabaseKey);
        console.log("[Network] Supabase client initialized.");
    } else {
        console.error("[Network] Supabase client library not found. Check your HTML imports.");
    }
}

// NOTE: Placeholder implementations for Supabase methods
SupabaseService.prototype.authenticate = async function (email, password) { /* ... implementation ... */ return { session: { access_token: 'fake_token' }, user: { id: 'fake_id' } }; };
SupabaseService.prototype.fetchCharacterId = async function (userId) { /* ... implementation ... */ return 1; };
SupabaseService.prototype.fetchCharacterState = async function (characterId) { /* ... implementation ... */ return { position: { x: 0, y: 5, z: 0 }, health: 100, mana: 50, stamina: 100, inventory: [], equipment: [] }; };
SupabaseService.prototype.createCharacterState = async function (userId, data) { /* ... implementation ... */ return { id: 1, ...data }; };
SupabaseService.prototype.saveCharacterState = async function (characterId, data) { /* ... implementation ... */ return true; };


var supabaseService = new SupabaseService();

//
// Network Manager (WebSocket) - kept for future use
//
function NetworkManager() {
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.supabase = supabaseService; // Uses the instantiated service
    this._listeners = {};
}

// CRITICAL FIX: Implement template loading with simulated data
NetworkManager.prototype.loadTemplates = async function (itemMap, skillMap, npcMap) {
    // --- Simulated Skill Templates ---
    const SKILL_TEMPLATES = [
        {
            id: 'Cleave', // The ID the player.js file is looking for
            code: 'CLEAVE',
            name: 'Cleave',
            skill_type: 'Attack',
            resource_cost: { mana: 0, stamina: 10 },
            cooldown_ms: 5000,
            effect: {
                type: 'damage',
                base_value: 10,
                magic_scaling: 0,
                physical_scaling: 0.5 // Cleave scales with attack power
            }
        },
        // Placeholder for other abilities (Fireball, Heal, etc.)
    ];

    // --- Simulated NPC Templates (NEW) ---
    const NPC_TEMPLATES = [
        {
            id: 'Wolf', 
            name: 'Wolf',
            model: 'wolf', // Asset key name from CONFIG.ASSETS.CHARACTERS
            level: 1,
            stats: {
                maxHealth: 30,
                attackPower: 5,
                moveSpeed: 0.18,
            },
            defaultAbility: 'Bite', // Placeholder for a default ability
            loot: [ /* ... loot table data ... */ ],
        }
    ];

    // --- Populate Maps ---
    SKILL_TEMPLATES.forEach(t => skillMap.set(t.id, t));
    NPC_TEMPLATES.forEach(t => npcMap.set(t.id, t)); // CRITICAL: Populate the NPC map

    console.log('[Network] Templates loaded (Simulated/Supabase).');
    return true; 
};

// Ensure NetworkManager is available globally (for Game.js)
window.NetworkManager = NetworkManager;
