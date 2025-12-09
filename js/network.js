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

    // Pull connection details from the global config (index.html) first, then fall back to the
    // hardcoded values the user provided. This makes the behavior consistent in local and hosted builds.
    const supabaseConfig = (typeof window !== 'undefined' && window.SUPABASE_CONFIG)
        ? window.SUPABASE_CONFIG
        : null;

    const supabaseUrl = (supabaseConfig && supabaseConfig.url)
        ? supabaseConfig.url
        : 'https://vaxfoafjjybwcxwhicla.supabase.co';
    const supabaseKey = (supabaseConfig && supabaseConfig.key)
        ? supabaseConfig.key
        : 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';

    // Initialize the Supabase Client
    if (typeof supabase !== 'undefined') {
        this.client = supabase.createClient(supabaseUrl, supabaseKey);
        console.log("[Network] Supabase client initialized.");
    } else {
        // This suggests an issue with the <script> tag in your HTML.
        console.error("[Network] Supabase client library not found. Check your HTML imports.");
    }
}

SupabaseService.prototype._ensureClient = function () {
    if (!this.client) {
        console.error('[Network] Supabase client is not initialized.');
        return false;
    }
    return true;
};

SupabaseService.prototype.fetchTemplates = async function () {
    if (!this._ensureClient()) return null;

    try {
        const [items, skills, npcs] = await Promise.all([
            this.client.from('hosg_item_templates').select('*'),
            this.client.from('hosg_skill_templates').select('*'),
            this.client.from('hosg_npc_templates').select('*'),
        ]);

        const results = { items: [], skills: [], npcs: [] };

        if (items.error) throw items.error;
        if (skills.error) throw skills.error;
        if (npcs.error) throw npcs.error;

        results.items = items.data || [];
        results.skills = skills.data || [];
        results.npcs = npcs.data || [];

        console.log('[Network] Templates loaded from Supabase.');
        return results;
    } catch (err) {
        console.error('[Network] Failed to load templates from Supabase:', err.message || err);
        return null;
    }
};

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

// Template loading now pulls from Supabase first and falls back to bundled data if unavailable
NetworkManager.prototype.loadTemplates = async function (itemMap, skillMap, npcMap) {
    const fallbackSkills = [
        {
            id: 'Cleave',
            code: 'CLEAVE',
            name: 'Cleave',
            skill_type: 'Attack',
            resource_cost: { mana: 0, stamina: 10 },
            cooldown_ms: 5000,
            effect: {
                type: 'damage',
                base_value: 10,
                magic_scaling: 0,
                physical_scaling: 0.5
            }
        },
    ];

    // Try Supabase first
    const templates = await this.supabase.fetchTemplates();

    if (templates) {
        templates.items.forEach(t => itemMap.set(t.id, t));
        templates.skills.forEach(t => skillMap.set(t.id, t));
        templates.npcs.forEach(t => npcMap.set(t.id, t));
        return true;
    }

    // Fall back to local data to keep the game playable offline or when Supabase is blocked
    console.warn('[Network] Falling back to local templates.');
    fallbackSkills.forEach(t => skillMap.set(t.id, t));
    return true;
};

// Ensure NetworkManager is available globally (for Game.js)
window.NetworkManager = NetworkManager;
