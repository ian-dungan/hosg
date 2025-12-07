// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.12 (FIXED)
// Fixes Supabase 404 error by changing 'hosg_spawn_points' to 'hosg_spawn_point'
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

SupabaseService.prototype._fetch = async function (tableName, label) {
    if (!this.client) {
        return { error: new Error(`Supabase client not initialized. Failed to fetch ${label}.`) };
    }
    console.log(`[Supabase] Fetching ${label}...`);
    try {
        const { data, error } = await this.client.from(tableName).select('*');
        if (error) {
            console.warn(`[Supabase] Failed to fetch ${label}:`, error);
            return { data: null, error: error };
        }
        return { data: data, error: null };
    } catch (error) {
        console.error(`[Supabase] Unknown error while fetching ${label}:`, error);
        return { data: null, error: error };
    }
};

SupabaseService.prototype.loadTemplates = async function () {
    console.log('[Supabase] Loading all templates...');

    try {
        let result;

        // Fetch Item Templates
        result = await this._fetch('hosg_item_templates', 'item templates');
        if (result.error) throw new Error('Failed to fetch item templates: ' + result.error.message);
        const itemTemplates = result.data;
        console.log(`[Supabase] Fetched ${itemTemplates.length} item templates.`);

        // Fetch Skill Templates
        result = await this._fetch('hosg_skill_templates', 'skill templates');
        if (result.error) throw new Error('Failed to fetch skill templates: ' + result.error.message);
        const skillTemplates = result.data;
        console.log(`[Supabase] Fetched ${skillTemplates.length} skill templates.`);

        // Fetch NPC Templates
        result = await this._fetch('hosg_npc_templates', 'NPC templates');
        if (result.error) throw new Error('Failed to fetch NPC templates: ' + result.error.message);
        const npcTemplates = result.data;
        console.log(`[Supabase] Fetched ${npcTemplates.length} NPC templates.`);

        // Fetch Spawn Points
        // PATCH: Corrected table name from 'hosg_spawn_points' to 'hosg_spawn_point'
        result = await this._fetch('hosg_spawn_point', 'spawn points'); 
        if (result.error) throw new Error('Failed to fetch spawn points: ' + result.error.message);
        const spawnPoints = result.data;
        console.log(`[Supabase] Fetched ${spawnPoints.length} spawn points.`);

        this.templates = {
            itemTemplates: itemTemplates,
            skillTemplates: skillTemplates,
            npcTemplates: npcTemplates,
            spawnPoints: spawnPoints
        };

        return { success: true };

    } catch (error) {
        console.log(`[Supabase] Failed to load templates:`, error);
        return { success: false, error: error };
    }
};

SupabaseService.prototype.getCharacterData = async function (characterId) {
    if (!this.client) {
        return { error: 'Supabase client not initialized.' };
    }

    try {
        const { data: characterData, error: charError } = await this.client
            .from('hosg_characters')
            .select('*, hosg_character_items(*), hosg_character_equipment(*)')
            .eq('id', characterId)
            .single();

        if (charError) throw charError;

        return { success: true, data: characterData };
    } catch (error) {
        console.error('[Supabase] Failed to get character data:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    if (!this.client) {
        return { success: false, error: 'Supabase client not initialized.' };
    }

    try {
        // 1. Update Character Table (Position, Stats, Health/Mana/Stamina)
        const { error: updateCharError } = await this.client
            .from('hosg_characters')
            .update({
                position_x: state.position.x,
                position_y: state.position.y,
                position_z: state.position.z,
                rotation_y: state.rotation_y,
                health: state.health,
                mana: state.mana,
                stamina: state.stamina,
                stats: state.stats
            })
            .eq('id', characterId);
            
        if (updateCharError) throw updateCharError;

        // 2. Update Inventory (Delete all, then insert new)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment
        await this.client.from('hosg_character_equipment').delete().eq('character_id', characterId
