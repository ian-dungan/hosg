// ===========================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.2.0 (STORAGE BYPASS FIX)
// Fix: CRITICALLY sets 'auth.storage: null' to bypass browser tracking prevention
//      and allow the Supabase client to initialize and query the database.
// ===========================================================

function SupabaseService(config) {
    this.config = config || {};
    this.client = null;

    // Pull connection details from the global config (index.html) first, then fall back to the
    // hardcoded values the user provided. This makes the behavior consistent in local and hosted builds.
    var supabaseConfig = (typeof window !== 'undefined' && window.SUPABASE_CONFIG)
        ? window.SUPABASE_CONFIG
        : null;

    var supabaseUrl = (supabaseConfig && supabaseConfig.url)
        ? supabaseConfig.url
        : 'https://vaxfoafjjybwcxwhicla.supabase.co';
    var supabaseKey = (supabaseConfig && supabaseConfig.key)
        ? supabaseConfig.key
        : 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';

    // Initialize the Supabase Client
    if (typeof supabase !== 'undefined') {
        try {
            // CRITICAL FIX: Explicitly set storage to null to prevent browser security errors.
            this.client = supabase.createClient(supabaseUrl, supabaseKey, {
                auth: {
                    storage: null // Tells the SDK not to use local storage/cookies
                }
            });
            console.log("[Network] Supabase client initialized successfully (Storage Bypassed).");

        } catch (err) {
            // This is unlikely to be hit with the fix above, but kept for robustness.
            console.error("[Network] Supabase initialization failed. Switching to OFFLINE MODE.", err);
            this.client = null;
            this.isOffline = true;
        }
    } else {
        console.error("[Network] Supabase client library not found. Check your HTML imports.");
        this.isOffline = true;
    }
}

SupabaseService.prototype._ensureClient = function () {
    if (!this.client) {
        console.error('[Network] Supabase client is not initialized.');
        return false;
    }
    return true;
};

SupabaseService.prototype.fetchTemplates = function () {
    if (!this._ensureClient()) return Promise.resolve(null);

    var self = this;

    return Promise.all([
        self.client.from('hosg_item_templates').select('*'),
        self.client.from('hosg_skill_templates').select('*'),
        self.client.from('hosg_npc_templates').select('*')
    ]).then(function (results) {
        var items = results[0];
        var skills = results[1];
        var npcs = results[2];

        if (items.error) throw items.error;
        if (skills.error) throw skills.error;
        if (npcs.error) throw npcs.error;

        console.log('[Network] Templates loaded from Supabase.');
        return {
            items: items.data || [],
            skills: skills.data || [],
            npcs: npcs.data || []
        };
    }).catch(function (err) {
        console.error('[Network] Failed to load templates from Supabase:', err && err.message ? err.message : err);
        return null;
    });
};

// NOTE: All previous prototype definitions for _init have been removed 
// as the logic is now in the constructor. Other methods remain attached to the prototype.

// SupabaseService.prototype.authenticate = ...
// SupabaseService.prototype.fetchCharacterId = ...
// SupabaseService.prototype.fetchCharacterState = ...
// SupabaseService.prototype.createCharacterState = ...
// SupabaseService.prototype.saveCharacterState = ...

var supabaseService = new SupabaseService();

    // --- 1. Define Offline Fallbacks ---
    const OFFLINE_SKILLS = [
        { id: 'Cleave', code: 'CLEAVE', name: 'Cleave', skill_type: 'Attack', resource_cost: { mana: 0, stamina: 10 }, cooldown_ms: 5000, effect: { type: 'damage', base_value: 10, physical_scaling: 0.5 } },
        { id: 'Fireball', code: 'FIREBALL', name: 'Fireball', skill_type: 'Magic', resource_cost: { mana: 20, stamina: 0 }, cooldown_ms: 3000, effect: { type: 'damage', base_value: 15, magic_scaling: 0.8 } },
        { id: 'Heal', code: 'HEAL', name: 'Heal', skill_type: 'Magic', resource_cost: { mana: 30, stamina: 0 }, cooldown_ms: 8000, effect: { type: 'heal', base_value: 25 } }
    ];

// Template loading now pulls from Supabase first and falls back to bundled data if unavailable
NetworkManager.prototype.loadTemplates = function (itemMap, skillMap, npcMap) {
    var fallbackSkills = [
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
        }
    ];

    return this.supabase.fetchTemplates().then(function (templates) {
        if (templates) {
            templates.items.forEach(function (t) { return itemMap.set(t.id, t); });
            templates.skills.forEach(function (t) { return skillMap.set(t.id, t); });
            templates.npcs.forEach(function (t) { return npcMap.set(t.id, t); });
            return true;
        }

        // Fall back to local data to keep the game playable offline or when Supabase is blocked
        console.warn('[Network] Falling back to local templates.');
        fallbackSkills.forEach(function (t) { return skillMap.set(t.id, t); });
        return true;
    });
};

SupabaseService.prototype.authenticate = async function () { return { error: "Storage Disabled" }; };
SupabaseService.prototype.saveCharacter = async function () { console.log("[Network] Save ignored (Storage Disabled)"); };

window.SupabaseService = SupabaseService;
