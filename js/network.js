// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.15 (PATCHED)
// Fix: Added missing loadTemplates to NetworkManager and fetch template methods to SupabaseService.
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
    // ... (Existing _init code remains the same) ...
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

    if (!this.config.url) this.config.url = 'YOUR_SUPABASE_URL';
    if (!this.config.key) this.config.key = 'YOUR_SUPABASE_ANON_KEY';

    if (this.config.url === 'YOUR_SUPABASE_URL') {
        console.warn("[Supabase] Using placeholder URL/Key. Please update CONFIG.SUPABASE or window.SUPABASE_CONFIG.");
    }
    
    try {
        this.client = window.supabase.createClient(this.config.url, this.config.key);
        console.log("[Supabase] Client initialized");
    } catch (e) {
        console.error("[Supabase] Client initialization failed:", e);
        this.client = null;
    }
};

// --- NEW TEMPLATE FETCHING METHODS ---

/**
 * Utility to fetch data from a template table.
 * @param {string} tableName - The name of the Supabase table.
 */
SupabaseService.prototype._fetchTemplate = async function (tableName) {
    try {
        const { data, error } = await this.client.from(tableName).select('*');
        if (error) throw error;
        return { success: true, data: data };
    } catch (error) {
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.fetchItemTemplates = async function () {
    console.log("[Supabase] Fetching item templates...");
    return this._fetchTemplate('hosg_item_templates'); // Assumes table name is hosg_item_templates
};

SupabaseService.prototype.fetchSkillTemplates = async function () {
    console.log("[Supabase] Fetching skill templates...");
    return this._fetchTemplate('hosg_skill_templates'); // Assumes table name is hosg_skill_templates
};

SupabaseService.prototype.fetchNPCTemplates = async function () {
    console.log("[Supabase] Fetching NPC templates...");
    return this._fetchTemplate('hosg_npc_templates'); // Assumes table name is hosg_npc_templates
};

SupabaseService.prototype.loadCharacterState = async function (characterId) {
    // ... (Existing loadCharacterState code remains the same) ...
    try {
        // 1. Fetch character core data (stats, position, etc.)
        const { data: characterData, error: charError } = await this.client
            .from('hosg_characters')
            .select('*')
            .eq('id', characterId)
            .single();

        if (charError) throw charError;

        // 2. Fetch inventory items
        const { data: inventoryData, error: invError } = await this.client
            .from('hosg_character_items')
            .select('*')
            .eq('character_id', characterId);

        if (invError) throw invError;
        
        // 3. Fetch equipped items
        const { data: equipmentData, error: equipError } = await this.client
            .from('hosg_character_equipment')
            .select('*')
            .eq('character_id', characterId);

        if (equipError) throw equipError;

        return { 
            success: true, 
            state: { 
                core: characterData, 
                inventory: inventoryData,
                equipment: equipmentData
            } 
        };

    } catch (error) {
        console.error('[Supabase] Failed to load character state:', error.message);
        return { success: false, error: error.message };
    }
};


SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    // ... (Existing saveCharacterState code remains the same) ...
    try {
        
        // 1. Update core character data (e.g., position, health, mana, stamina)
        const { error: coreError } = await this.client
            .from('hosg_characters')
            .update({
                position_x: state.position.x,
                position_y: state.position.y,
                position_z: state.position.z,
                rotation_y: state.rotation_y,
                health: state.health,
                mana: state.mana,
                stamina: state.stamina
            })
            .eq('id', characterId);

        if (coreError) throw coreError;

        // 2. Update Inventory (Delete all then Insert new state)
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

// --- NEW METHOD ADDED TO NETWORK MANAGER ---
NetworkManager.prototype.loadTemplates = async function (itemMap, skillMap, npcMap) {
    console.log("[Supabase] Loading all templates...");
    
    // Use Promise.all to fetch all templates concurrently
    const [itemResult, skillResult, npcResult] = await Promise.all([
        this.supabase.fetchItemTemplates(),
        this.supabase.fetchSkillTemplates(),
        this.supabase.fetchNPCTemplates()
    ]);
    
    // Process Item Templates
    if (itemResult.success) {
        itemResult.data.forEach(t => itemMap.set(t.id, t));
    } else {
        console.error(`[Supabase] Failed to fetch item templates: ${itemResult.error}`);
    }

    // Process Skill Templates
    if (skillResult.success) {
        skillResult.data.forEach(t => skillMap.set(t.id, t));
    } else {
        console.error(`[Supabase] Failed to fetch skill templates: ${skillResult.error}`);
    }
    
    // Process NPC Templates
    if (npcResult.success) {
        npcResult.data.forEach(t => npcMap.set(t.id, t));
    } else {
        console.error(`[Supabase] Failed to fetch NPC templates: ${npcResult.error}`);
    }
    
    console.log("[Bootstrap] Templates loaded successfully.");
    return { success: true };
};

// ... (rest of NetworkManager prototype methods like dispose) ...
