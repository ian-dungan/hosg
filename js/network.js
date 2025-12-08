// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.32 (CRITICAL INIT FIX)
// Fix: Moved _init logic directly into the constructor to resolve a TypeError
//      where the prototype method was not fully registered before being called.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    
    // Line 12 FIX: _init logic is now defined directly here.
    
    // 1. DEFINE YOUR CONNECTION VARIABLES
    const supabaseUrl = 'https://vaxfoafjjybwcxwhicla.supabase.co';
    const supabaseKey = 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';
    
    // 2. Initialize the Supabase Client
    if (typeof supabase !== 'undefined') {
        this.client = supabase.createClient(supabaseUrl, supabaseKey);
        console.log("[Network] Supabase client initialized.");
    } else {
        // This suggests an issue with the <script> tag in your HTML.
        console.error("[Network] Supabase client library not found. Check your HTML imports.");
    }
}

// NOTE: All previous prototype definitions for _init have been removed 
// as the logic is now in the constructor. Other methods remain attached to the prototype.

// SupabaseService.prototype.authenticate = ...
// SupabaseService.prototype.fetchCharacterId = ...
// SupabaseService.prototype.fetchCharacterState = ...
// SupabaseService.prototype.createCharacterState = ...
// SupabaseService.prototype.saveCharacterState = ...

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

    // --- Populate Maps ---
    SKILL_TEMPLATES.forEach(t => skillMap.set(t.id, t));

    console.log('[Network] Templates loaded (Simulated/Supabase).');
    return true; 
};

// Ensure NetworkManager is available globally (for Game.js)
window.NetworkManager = NetworkManager;
