// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.8 (PATCHED)
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

// ==================== TEMPLATE LOADERS (Patched to return Map) ====================

// Utility to convert an array of objects to a Map keyed by 'id'
function arrayToMap(data) {
    const templateMap = new Map();
    if (data) {
        data.forEach(item => templateMap.set(item.id, item));
    }
    return templateMap;
}

SupabaseService.prototype.loadItemTemplates = async function () {
    const { data, error } = await this.client
        .from('hosg_item_templates')
        .select('*');

    if (error) throw error;
    console.log(`[Supabase] Fetched ${data.length} item templates.`);
    return arrayToMap(data);
};

SupabaseService.prototype.loadSkillTemplates = async function () {
    const { data, error } = await this.client
        .from('hosg_skill_templates')
        .select('*');

    if (error) throw error;
    console.log(`[Supabase] Fetched ${data.length} skill templates.`);
    return arrayToMap(data);
};

SupabaseService.prototype.loadNPCTemplates = async function () {
    const { data, error } = await this.client
        .from('hosg_npc_templates')
        .select('*');

    if (error) throw error;
    console.log(`[Supabase] Fetched ${data.length} NPC templates.`);
    return arrayToMap(data);
};

SupabaseService.prototype.loadSpawnPoints = async function () {
    const { data, error } = await this.client
        .from('hosg_spawn_points')
        .select('*');

    if (error) throw error;
    console.log(`[Supabase] Fetched ${data.length} spawn points.`);
    return data; // Return as array (or convert to map if needed for lookup elsewhere)
};

// ==================== CHARACTER DATA LOAD/SAVE ====================

SupabaseService.prototype.loadCharacter = async function (characterId) {
    // ... (Your existing loadCharacter implementation)
    // NOTE: This implementation is complex and requires multiple database calls.
    // I will assume your existing implementation correctly loads character, inventory_items, equipped_items, and player_skills.
    
    // Placeholder implementation (based on what is needed by game.js and player.js)
    try {
        const { data: charData, error: charError } = await this.client.from('hosg_characters').select('*').eq('id', characterId).single();
        if (charError) throw charError;

        const { data: invData, error: invError } = await this.client.from('hosg_character_items').select('*').eq('character_id', characterId).eq('location_type', 'inventory');
        if (invError) throw invError;
        
        const { data: equipData, error: equipError } = await this.client.from('hosg_character_equipment').select('*').eq('character_id', characterId);
        if (equipError) throw equipError;

        const { data: skillData, error: skillError } = await this.client.from('hosg_character_skills').select('*').eq('character_id', characterId);
        if (skillError) throw skillError;

        console.log(`[Supabase] Loaded character ${charData.name} (Lvl ${charData.level})`);
        
        return {
            character: charData,
            inventory_items: invData,
            equipped_items: equipData,
            player_skills: skillData
        };
    } catch (error) {
        console.error('[Supabase] Failed to load character:', error.message);
        throw new Error('Failed to load character data.');
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    // ... (Your existing saveCharacterState implementation)
    try {
        // 1. Update character core state (position, stats, resources)
        const { error: updateCharError } = await this.client
            .from('hosg_characters')
            .update({
                position_x: state.position.x,
                position_y: state.position.y,
                position_z: state.position.z,
                rotation_y: state.rotation_y,
                stats: state.stats, 
                health: state.health,
                mana: state.mana,
                stamina: state.stamina
            })
            .eq('id', characterId);
        if (updateCharError) throw updateCharError;

        // 2. Update Inventory (Delete all then re-insert)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment (Delete all then re-insert)
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
// Network Manager (WebSocket) - kept for future use
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
    this.connected = false;
    this._listeners = {};
};
