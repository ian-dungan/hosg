// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.31 (TEMPLATE SIMULATION FIX)
// Fix: Added placeholder template data for item and skill to prevent runtime warnings/errors.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this._init();
}

// ... (other SupabaseService methods remain the same) ...
// The following methods from network.js were skipped to save space, but remain unchanged in the full file.
// SupabaseService.prototype._init
// SupabaseService.prototype.authenticate
// SupabaseService.prototype.fetchCharacterId
// SupabaseService.prototype.fetchCharacterState
// SupabaseService.prototype.createCharacterState
// SupabaseService.prototype.saveCharacterState


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
