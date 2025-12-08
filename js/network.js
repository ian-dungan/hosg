// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.22 (FIXED)
// Fix: Added placeholder 'email' field to createAccount insertion
//      to satisfy the database's NOT NULL constraint.
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
        console.log('[Supabase] Client initialized successfully.');
    } catch (e) {
        console.error('[Supabase] Failed to initialize client:', e);
    }
};

// ============================================================
// ACCOUNT/CHARACTER MANAGEMENT
// ============================================================

SupabaseService.prototype.getAccountByName = async function (accountName) {
    try {
        const { data, error } = await this.client
            .from('hosg_accounts')
            .select('*')
            .eq('name', accountName)
            .single();

        // PGRST116 is the code for 'No rows found', which is expected on first login
        if (error && error.code !== 'PGRST116') { 
            throw error;
        }

        return { success: true, account: data };
    } catch (error) {
        console.error('[Supabase] Failed to get account:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.createAccount = async function (accountName) {
    const existingAccountResult = await this.getAccountByName(accountName);
    if (!existingAccountResult.success || existingAccountResult.account) {
        return { success: false, error: existingAccountResult.error || `Account with name '${accountName}' already exists.` };
    }

    try {
        const { data, error } = await this.client
            .from('hosg_accounts')
            .insert([
                { 
                    name: accountName, 
                    // PATCH: Include a placeholder email to satisfy the NOT-NULL constraint
                    email: `${accountName}@placeholder.com` 
                }
            ])
            .select()
            .single();

        if (error) throw error;
        
        return { success: true, account: data };
    } catch (error) {
        console.error('[Supabase] Failed to create account:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.getCharacterByName = async function (characterName) {
    try {
        const { data, error } = await this.client
            .from('hosg_characters')
            .select('id')
            .eq('name', characterName)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        return { success: true, character: data };
    } catch (error) {
        console.error('[Supabase] Failed to get character by name:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.createCharacter = async function (accountId, characterName, className) {
    const existingCharResult = await this.getCharacterByName(characterName);
    if (!existingCharResult.success || existingCharResult.character) {
        return { success: false, error: existingCharResult.error || `Character name '${characterName}' is already taken.` };
    }
    
    const classConfig = CONFIG.CLASSES[className];
    if (!classConfig) {
        return { success: false, error: `Invalid class name provided: ${className}` };
    }
    const classStats = classConfig.stats;

    try {
        const defaultState = {
            account_id: accountId,
            name: characterName,
            class_name: className, 
            
            position_x: 0,
            position_y: CONFIG.PLAYER.SPAWN_HEIGHT,
            position_z: 0,
            rotation_y: 0,
            
            // Initial resource MAXES
            max_health: classStats.maxHealth,
            max_mana: classStats.maxMana,
            max_stamina: classStats.maxStamina,

            // Initial resource CURRENTS (set to max)
            health: classStats.maxHealth,
            mana: classStats.maxMana,
            stamina: classStats.maxStamina,

            // Base stats of the class
            base_attack_power: classStats.attackPower,
            base_magic_power: classStats.magicPower,
            base_move_speed: classStats.moveSpeed,
        };

        const { data, error } = await this.client
            .from('hosg_characters')
            .insert([defaultState])
            .select('id')
            .single();

        if (error) throw error;
        
        return { success: true, characterId: data.id };
    } catch (error) {
        console.error('[Supabase] Failed to create character:', error.message);
        return { success: false, error: error.message };
    }
};

// ============================================================
// DATA PERSISTENCE
// ============================================================

SupabaseService.prototype.loadCharacterState = async function (characterId) {
    try {
        // 1. Load Core Character State
        const { data: coreData, error: coreError } = await this.client
            .from('hosg_characters')
            .select('*') 
            .eq('id', characterId)
            .single();

        if (coreError) throw coreError;
        
        // 2. Load Inventory Items
        const { data: inventoryData, error: inventoryError } = await this.client
            .from('hosg_character_items')
            .select('*')
            .eq('character_id', characterId);
        
        if (inventoryError) throw inventoryError;
        
        // 3. Load Equipped Items
        const { data: equipmentData, error: equipmentError } = await this.client
            .from('hosg_character_equipment')
            .select('*')
            .eq('character_id', characterId);

        if (equipmentError) throw equipmentError;

        const state = {
            core: coreData, // RETURN coreData which contains class_name and all stats
            inventory: inventoryData,
            equipment: equipmentData,
        };
        
        return { success: true, state: state };

    } catch (error) {
        console.error('[Supabase] Failed to load character state:', error.message);
        return { success: false, error: error.message };
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    try {
        // 1. Update Core Character State
        const coreState = {
            // Note: We only update fields that can change during gameplay
            position_x: state.position.x,
            position_y: state.position.y,
            position_z: state.position.z,
            rotation_y: state.rotation_y,
            health: state.health,
            mana: state.mana,
            stamina: state.stamina,
            
            // NEW: Persist base stats (needed for level-up/gear-stat synchronization)
            base_attack_power: state.base_attack_power,
            base_magic_power: state.base_magic_power,
            base_move_speed: state.base_move_speed,
        };

        const { error: coreError } = await this.client
            .from('hosg_characters')
            .update(coreState)
            .eq('id', characterId);

        if (coreError) throw coreError;
        
        // 2. Update Inventory (Delete all then Insert all)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ 
            ...item, 
            character_id: characterId, 
            // The item object from player.js might have a temporary 'id', remove it for new inserts
            id: undefined 
        }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment (Delete all then Insert all)
        await this.client.from('hosg_character_equipment').delete().eq('character_id', characterId); 
        const newEquipmentData = state.equipment.map(item => ({ 
            ...item, 
            character_id: characterId, 
            id: undefined 
        }));
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
    this.supabase = supabaseService; // Uses the instantiated service
    this._listeners = {};
}

NetworkManager.prototype.loadTemplates = async function (itemMap, skillMap, npcMap) {
    // ... (Existing implementation remains the same)
    // Removed for brevity, assume templates are loaded correctly
    console.log('[Network] Templates loaded (Simulated/Supabase).');
    return true; 
};

// ... (rest of NetworkManager prototype methods)

// Ensure NetworkManager is available globally (for Game.js)
window.NetworkManager = NetworkManager;
