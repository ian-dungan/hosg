// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.12 (PATCHED)
// Fix: Changed loadCharacterState to use .maybeSingle() for graceful character loading.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this._init();
}

SupabaseService.prototype._init = function () {
    if (typeof window === "undefined") return;

    var globalConfig = window.SUPABASE_CONFIG || (typeof CONFIG !== "undefined" ? CONFIG.SUPABASE : null);
    if (globalConfig) {
        for (var k in globalConfig) {
            if (Object.prototype.hasOwnProperty.call(globalConfig, k)) {
                this.config[k] = globalConfig[k];
            }
        }
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        console.warn("[Supabase] supabase-js CDN script not loaded; client not initialized.");
        return;
    }

    // Default configuration if not set globally (replace with your actual URL/Key)
    if (!this.config.url) this.config.url = 'YOUR_SUPABASE_URL';
    if (!this.config.key) this.config.key = 'YOUR_SUPABASE_ANON_KEY';

    if (this.config.url === 'YOUR_SUPABASE_URL') {
        console.warn("[Supabase] Using placeholder URL/Key. Please update CONFIG.SUPABASE or window.SUPABASE_CONFIG.");
    }
    
    try {
        this.client = window.supabase.createClient(this.config.url, this.config.key);
        console.log("[Supabase] Client initialized");
    } catch (err) {
        console.error("[Supabase] Failed to create client:", err);
        this.client = null;
    }
};

SupabaseService.prototype.getClient = function () {
    return this.client;
};

// Internal fetch helper
SupabaseService.prototype._fetch = async function (table, type) {
    console.log(`[Supabase] Fetching ${type}...`);
    const { data, error, status } = await this.client.from(table).select('*');

    if (error && status !== 406) {
        console.error(`[Supabase] Failed to fetch ${type}:`, error);
        throw error;
    }
    console.log(`[Supabase] Fetched ${data ? data.length : 0} ${type}.`);
    return data;
};

/**
 * Loads all static templates (items, skills, npcs, spawns) into the game's Maps.
 */
SupabaseService.prototype.loadTemplates = async function () {
    console.log("[Supabase] Loading all templates...");

    try {
        // Fetch all four template types
        const [items, skills, npcs, spawns] = await Promise.all([
            this._fetch('hosg_item_templates', 'item templates'),
            this._fetch('hosg_skill_templates', 'skill templates'),
            this._fetch('hosg_npc_templates', 'NPC templates'),
            this._fetch('hosg_spawn_points', 'spawn points') 
        ]);

        // Map data to the Game instance's Maps (assuming this is called from Game.init)
        // Note: The game instance maps are updated directly, as `this.game` is passed
        // but since `loadTemplates` is called before `this.game` is fully initialized,
        // the mapping is done back in `game.js`.

        console.log("[Supabase] All templates loaded.");
        return { 
            itemTemplates: items, 
            skillTemplates: skills, 
            npcTemplates: npcs,
            spawnPoints: spawns 
        };
    } catch (error) {
        console.error("[Supabase] Failed to load templates:", error);
        throw new Error("Failed to load game data from Supabase.");
    }
};

/**
 * Loads a character's state, inventory, and equipment.
 * @param {string} characterId - The UUID of the character to load.
 * @returns {Object|null} The character state object, or null if not found.
 */
SupabaseService.prototype.loadCharacterState = async function (characterId) {
    if (!this.client) return null;

    try {
        // Fetch character state and nested items/equipment via a JOIN/FOREIGN KEY relationship
        const { data: characterData, error: charError } = await this.client
            .from('hosg_characters')
            .select('*, items:hosg_character_items(*), equipment:hosg_character_equipment(*)')
            .eq('id', characterId)
            // === PATCH: Use maybeSingle() to return null instead of throwing error on 0 rows ===
            .maybeSingle(); 

        if (charError && charError.code !== 'PGRST116') { // PGRST116 is the error code for '0 rows'
            console.error('[Supabase] Failed to load character:', charError);
            throw charError;
        }

        if (!characterData) {
            console.log('[Supabase] Character not found. Will create new.');
            return null; // Character not found
        }
        
        console.log(`[Supabase] Loaded character ${characterId}.`);
        return characterData;

    } catch (error) {
        console.error('[Supabase] Failed to load character:', error.message);
        throw error; // Re-throw critical errors for Game.init to handle
    }
};

/**
 * Saves the player's current state, inventory, and equipment.
 * @param {string} characterId - The UUID of the character to save.
 * @param {Object} state - The data from player.getSaveData().
 * @returns {Object} { success: boolean, error?: string }
 */
SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    if (!this.client) return { success: false, error: 'Supabase client not initialized.' };

    try {
        // 1. Update Character Table (Main Stats, Position, Rotation)
        const charUpdate = {
            name: state.name || 'Hero', // Assuming player has a name property now
            position_x: state.position.x,
            position_y: state.position.y,
            position_z: state.position.z,
            rotation_y: state.rotation_y,
            health: state.health,
            mana: state.mana,
            stamina: state.stamina,
            stats: state.stats // Saves the entire stats object as JSONB
        };

        const { error: updateError } = await this.client
            .from('hosg_characters')
            .update(charUpdate)
            .eq('id', characterId);

        if (updateError) throw updateError;

        // 2. Update Inventory (Delete all then re-insert current items)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment (Delete all then re-insert current equipment)
        await this.client.from('hosg_character_equipment').delete().eq('character_id', characterId); 
        const newEquipmentData = state.equipment.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newEquipmentData.length > 0) {
            const { error: insertEquipError } = await this.client.from('hosg_character_equipment').insert(newEquipmentData);
            if (insertEquipError) throw insertEquipError;
        }

        return { success: true };

    } catch (error) {
        console.error('[Supabase] Failed to save character state:', error.message);
        return { success: false, error: error.message };
    }
};


var supabaseService = new SupabaseService();

//
// Network Manager (WebSocket)
//
function NetworkManager(game) {
    this.game = game; // Added for context access
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.supabase = supabaseService;
    this.supabase.game = game; // Give Supabase access to game instance (e.g. for maps)
    this._listeners = {};
}
// ... (rest of NetworkManager prototype methods)
NetworkManager.prototype.dispose = function() {
    this.shouldReconnect = false;
    if (this.socket) {
        this.socket.close();
        this.socket = null;
    }
    this.connected = false;
};
// Expose the service globally
window.SupabaseService = SupabaseService;
window.NetworkManager = NetworkManager;
