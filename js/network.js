// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.10 (PATCHED)
// Supabase wrapper for data persistence and template loading
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


// ----------------------------------------------------------------
// TEMPLATE LOADING FUNCTIONS
// ----------------------------------------------------------------

/**
 * Load all item templates (Maps: ID -> Template)
 */
SupabaseService.prototype.loadItemTemplates = async function () {
    try {
        const { data, error } = await this.client
            .from('hosg_item_templates')
            .select('*');

        if (error) throw error;

        console.log(`[Supabase] Fetched ${data.length} item templates.`);
        return new Map(data.map(template => [template.id, template]));
    } catch (error) {
        console.error('[Supabase] Failed to load item templates:', error.message);
        return new Map();
    }
};

/**
 * Load all skill templates (Maps: ID -> Template)
 */
SupabaseService.prototype.loadSkillTemplates = async function () {
    try {
        const { data, error } = await this.client
            .from('hosg_skill_templates')
            .select('*');

        if (error) throw error;

        console.log(`[Supabase] Fetched ${data.length} skill templates.`);
        return new Map(data.map(template => [template.id, template]));
    } catch (error) {
        console.error('[Supabase] Failed to load skill templates:', error.message);
        return new Map();
    }
};

/**
 * Load all NPC/Enemy templates (Maps: ID -> Template)
 */
SupabaseService.prototype.loadNPCTemplates = async function () {
    try {
        const { data, error } = await this.client
            .from('hosg_npc_templates')
            .select('*');

        if (error) throw error;

        console.log(`[Supabase] Fetched ${data.length} NPC templates.`);
        return new Map(data.map(template => [template.id, template]));
    } catch (error) {
        console.error('[Supabase] Failed to load NPC templates:', error.message);
        return new Map();
    }
};

/**
 * Load all world spawn points (NPC Spawns)
 * @returns {Promise<Array>} Array of spawn point objects
 */
SupabaseService.prototype.loadSpawnPoints = async function () {
    try {
        // PATCH: Corrected table name based on schema (hosg_npc_spawns)
        const { data, error } = await this.client
            .from('hosg_npc_spawns') // <--- CORRECTED TABLE NAME
            .select('*');

        if (error) throw error;

        console.log(`[Supabase] Fetched ${data.length} spawn points.`);
        return data || []; // This should remain an array for World initialization
    } catch (error) {
        console.error('[Supabase] Failed to load spawn points:', error.message);
        // We throw here because the game cannot proceed without this data
        throw error;
    }
};

// ----------------------------------------------------------------
// PERSISTENCE FUNCTIONS
// ----------------------------------------------------------------

/**
 * Load character data by UUID
 * @param {string} characterId - The UUID of the character to load
 * @returns {Promise<Object>} An object containing character, inventory_items, equipped_items, player_skills
 */
SupabaseService.prototype.loadCharacter = async function (characterId) {
    try {
        // 1. Load basic character stats
        const { data: charData, error: charError } = await this.client
            .from('hosg_characters')
            .select('*')
            .eq('id', characterId)
            .single();

        if (charError) throw charError;

        // 2. Load inventory items
        const { data: inventoryData, error: invError } = await this.client
            .from('hosg_character_items')
            .select('*')
            .eq('character_id', characterId);

        if (invError) throw invError;
        
        // 3. Load equipped items
        const { data: equipmentData, error: equipError } = await this.client
            .from('hosg_character_equipment')
            .select('*')
            .eq('character_id', characterId);
            
        if (equipError) throw equipError;
        
        // 4. Load player skills
        const { data: skillData, error: skillError } = await this.client
            .from('hosg_character_skills')
            .select('*')
            .eq('character_id', characterId);

        if (skillError) throw skillError;

        console.log(`[Supabase] Loaded character ${charData.name}`);
        
        return {
            character: charData,
            inventory_items: inventoryData,
            equipped_items: equipmentData,
            player_skills: skillData 
        };

    } catch (error) {
        console.error('[Supabase] Failed to load character:', error.message);
        throw error;
    }
};


/**
 * Save character position, stats, inventory, and equipment.
 * @param {string} characterId - The UUID of the character
 * @param {Object} state - The state object from player.getSaveData()
 * @returns {Promise<Object>} { success: boolean, error: string? }
 */
SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    try {
        // 1. Update character record
        const { error: updateCharError } = await this.client
            .from('hosg_characters')
            .update({
                position_x: state.position.x,
                position_y: state.position.y,
                position_z: state.position.z,
                rotation_y: state.rotation_y,
                stats_json: state.stats,
                health: state.health,
                mana: state.mana,
                stamina: state.stamina
            })
            .eq('id', characterId);

        if (updateCharError) throw updateCharError;
        
        // 2. Update Inventory
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment
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
function NetworkManager() {
    this.socket = null;
    this.connected = false;
    this.shouldReconnect = true;
    this.supabase = supabaseService;
    this._listeners = {};
}
// ... (rest of NetworkManager prototype methods)
NetworkManager.prototype.dispose = function() {
    this.shouldReconnect = false;
    if (this.socket) {
        this.socket.close();
        this.socket = null;
    }
};
