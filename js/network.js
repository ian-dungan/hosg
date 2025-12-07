// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.8
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


// ======== TEMPLATE FETCHING ========

SupabaseService.prototype.fetchItemTemplates = async function () {
    if (!this.client) return new Map();
    try {
        const { data, error } = await this.client.from('hosg_item_templates').select('*');
        if (error) throw error;
        const templateMap = new Map();
        data.forEach(template => {
             // Parse JSONB fields
            if (typeof template.effects === 'string') { template.effects = JSON.parse(template.effects); }
            if (typeof template.stats === 'string') { template.stats = JSON.parse(template.stats); }
            templateMap.set(template.id, template);
        });
        console.log(`[Supabase] Fetched ${templateMap.size} item templates.`);
        return templateMap;
    } catch (error) {
        console.error('[Supabase] Failed to fetch item templates:', error.message);
        return new Map();
    }
};

SupabaseService.prototype.fetchSkillTemplates = async function () {
    if (!this.client) return new Map();
    try {
        const { data, error } = await this.client.from('hosg_skill_templates').select('*');
        if (error) throw error;
        const templateMap = new Map();
        data.forEach(template => {
            if (typeof template.resource_cost === 'string') { try { template.resource_cost = JSON.parse(template.resource_cost); } catch (e) { template.resource_cost = {}; } }
            if (typeof template.effect === 'string') { try { template.effect = JSON.parse(template.effect); } catch (e) { template.effect = {}; } }
            templateMap.set(template.id, template);
        });
        console.log(`[Supabase] Fetched ${templateMap.size} skill templates.`);
        return templateMap;
    } catch (error) {
        console.error('[Supabase] Failed to fetch skill templates:', error.message);
        return new Map();
    }
};

SupabaseService.prototype.fetchNpcTemplates = async function () {
    if (!this.client) return new Map();
    try {
        const { data, error } = await this.client.from('hosg_npc_templates').select('*');
        if (error) throw error;
        const templateMap = new Map();
        data.forEach(template => {
            if (typeof template.stats === 'string') { try { template.stats = JSON.parse(template.stats); } catch (e) { template.stats = {}; } }
            if (typeof template.loot_table === 'string') { try { template.loot_table = JSON.parse(template.loot_table); } catch (e) { template.loot_table = {}; } }
            templateMap.set(template.id, template);
        });
        console.log(`[Supabase] Fetched ${templateMap.size} NPC templates.`);
        return templateMap;
    } catch (error) {
        console.error('[Supabase] Failed to fetch NPC templates:', error.message);
        return new Map();
    }
};

SupabaseService.prototype.fetchNpcSpawns = async function (zoneId = 1) { 
    if (!this.client) return [];
    try {
        const { data, error } = await this.client.from('hosg_npc_spawns').select('*').eq('zone_id', zoneId); 
        if (error) throw error;
        console.log(`[Supabase] Fetched ${data.length} spawn points.`);
        return data;
    } catch (error) {
        console.error('[Supabase] Failed to fetch NPC spawns:', error.message);
        return [];
    }
};

// ======== CHARACTER DATA LOADING / SAVING ========

SupabaseService.prototype.loadCharacter = async function (characterId) {
    if (!this.client) return {};
    
    try {
        let { data: character, error: charError } = await this.client.from('hosg_characters').select('*').eq('id', characterId).single();
        if (charError) throw charError;

        let { data: inventory, error: invError } = await this.client.from('hosg_character_items').select('*').eq('character_id', characterId);
        if (invError) throw invError;

        let { data: equipment, error: equipError } = await this.client.from('hosg_character_equipment').select('*').eq('character_id', characterId);
        if (equipError) throw equipError;
        
        let { data: skills, error: skillError } = await this.client.from('hosg_character_skills').select('*').eq('character_id', characterId);
        if (skillError) throw skillError;

        console.log(`[Supabase] Loaded character ${character.name} (Lvl ${character.level})`);
        
        return {
            character: character,
            inventory: inventory,
            equipment: equipment,
            skills: skills
        };

    } catch (error) {
        console.error('[Supabase] Failed to load character:', error.message);
        throw error;
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    if (!this.client || !characterId || !state) return { success: false, error: 'Missing data' };

    try {
        // --- A. Update hosg_characters (Position/Stats/Resources) ---
        const charUpdate = {
            position_x: state.position.x,
            position_y: state.position.y,
            position_z: state.position.z,
            rotation_y: state.rotation_y,
            health: state.health,
            mana: state.mana,
            stamina: state.stamina,
            stats: state.stats 
        };

        const { error: charError } = await this.client.from('hosg_characters').update(charUpdate).eq('id', characterId);
        if (charError) throw charError;

        // --- B. Inventory & Equipment transaction (Delete all, Insert all) ---
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId).eq('location_type', 'inventory'); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

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
    }
};

var networkManager = new NetworkManager();
