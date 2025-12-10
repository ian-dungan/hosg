// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.33 (GLOBAL SAFETY)
// ES5-safe Supabase + template loader with hard global export so
// bootstrap scripts never see NetworkManager as undefined.
// ============================================================

(function (global) {
    //
    // Supabase wrapper
    //
    function SupabaseService(config) {
        this.config = config || {};
        this.client = null;

        // Pull connection details from the global config (index.html) first, then fall back to the
        // hardcoded values the user provided. This makes the behavior consistent in local and hosted builds.
        var supabaseConfig = (typeof global !== 'undefined' && global.SUPABASE_CONFIG)
            ? global.SUPABASE_CONFIG
            : null;

        var supabaseUrl = (supabaseConfig && supabaseConfig.url)
            ? supabaseConfig.url
            : 'https://vaxfoafjjybwcxwhicla.supabase.co';
        var supabaseKey = (supabaseConfig && supabaseConfig.key)
            ? supabaseConfig.key
            : 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD';

        // Avoid spawning multiple GoTrue clients by reusing an existing instance when possible
        if (global.__hosgSupabaseClient) {
            this.client = global.__hosgSupabaseClient;
            console.log('[Network] Supabase client reused.');
            return;
        }

        // Initialize the Supabase Client
        if (typeof supabase !== 'undefined') {
            this.client = supabase.createClient(supabaseUrl, supabaseKey);
            global.__hosgSupabaseClient = this.client;
            console.log('[Network] Supabase client initialized.');
        } else {
            // This suggests an issue with the <script> tag in your HTML.
            console.error('[Network] Supabase client library not found. Check your HTML imports.');
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
        var fallbackNpcs = [
            {
                id: 'wolf',
                name: 'Wolf',
                asset_key: 'wolf.glb',
                behavior: 'aggressive',
                base_health: 60,
                base_attack: 8
            },
            {
                id: 'goblin',
                name: 'Goblin',
                asset_key: 'wolf.glb',
                behavior: 'aggressive',
                base_health: 50,
                base_attack: 6
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
            fallbackNpcs.forEach(function (t) { return npcMap.set(t.id, t); });
            return true;
        });
    };

    // Ensure NetworkManager is available globally (for Game.js) even if global is not window
    global.NetworkManager = NetworkManager;
})(typeof window !== 'undefined' ? window : this);
