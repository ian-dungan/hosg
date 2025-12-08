// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.29 (SCHEMA ALIGNMENT)
// Fix: Consolidated base stat fields (e.g., base_attack_power, max_health) 
//      into the single 'stats' JSONB column on hosg_characters to match the schema.
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
// UTILITY FUNCTIONS (Placeholder Hashing)
// ============================================================

function simpleHash(input) {
    if (!input) return 'NO_INPUT_SUPPLIED';
    return `HASHED_TEST_${input}_${input.length}chars`;
}

// ============================================================
// ACCOUNT/CHARACTER MANAGEMENT
// ============================================================

SupabaseService.prototype.getAccountByName = async function (accountName) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
    try {
        const { data, error } = await this.client
            .from('hosg_accounts')
            .select('*')
            .eq('username', accountName)
            .single();

        // PGRST116 is the code for 'No rows found', which is expected on first login
        if (error && error.code !== 'PGRST116') { 
            throw error;
        }

        return { success: true, account: data };
    } catch (error) {
        console.error('[Supabase] Failed to get account:', error.message || error);
        return { success: false, error: error.message || String(error) };
    }
};

SupabaseService.prototype.createAccount = async function (accountName) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
    const existingAccountResult = await this.getAccountByName(accountName);
    if (!existingAccountResult.success || existingAccountResult.account) {
        return { success: false, error: existingAccountResult.error || `Account with name '${accountName}' already exists.` };
    }

    // Generate placeholder values to satisfy database constraints (username only required from user)
    const placeholderEmail = `${accountName}@placeholder.com`; 
    const hashedPassword = simpleHash(accountName); 

    try {
        const { data, error } = await this.client
            .from('hosg_accounts')
            .insert([
                { 
                    username: accountName, 
                    email: placeholderEmail, 
                    password_hash: hashedPassword 
                }
            ])
            .select()
            .single();

        if (error) throw error;
        
        return { success: true, account: data };
    } catch (error) {
        console.error('[Supabase] Failed to create account:', error.message || error);
        return { success: false, error: error.message || String(error) };
    }
};

SupabaseService.prototype.getCharacterByName = async function (characterName) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
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
        console.error('[Supabase] Failed to get character by name:', error.message || error);
        return { success: false, error: error.message || String(error) };
    }
};

SupabaseService.prototype.createCharacter = async function (accountId, characterName, className) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
    const existingCharResult = await this.getCharacterByName(characterName);
    if (!existingCharResult.success || existingCharResult.character) {
        return { success: false, error: existingCharResult.error || `Character name '${characterName}' is already taken.` };
    }
    
    const classConfig = CONFIG.CLASSES[className];
    if (!classConfig) {
        return { success: false, error: `Invalid class name provided: ${className}` };
    }
    const classStats = classConfig.stats;

    // Consolidate the stats object
    const characterStats = {
        // Base stats from class config
        max_health: classStats.maxHealth,
        max_mana: classStats.maxMana,
        max_stamina: classStats.maxStamina,
        base_attack_power: classStats.attackPower,
        base_magic_power: classStats.magicPower,
        base_move_speed: classStats.moveSpeed,
        // Add any other base stats here
    };

    try {
        const defaultState = {
            user_id: accountId, 
            name: characterName,
            class_name: className, // Assuming class_name is a valid column, though not in the provided schema snippet, it's safer to keep for now.
            
            position_x: 0,
            position_y: CONFIG.PLAYER.SPAWN_HEIGHT,
            position_z: 0,
            rotation_y: 0,
            
            // Initial resource CURRENTS (set to max, but using direct fields from schema)
            health: classStats.maxHealth,
            mana: classStats.maxMana,
            stamina: classStats.maxStamina,
            
            // All base/max stats go into the JSONB 'stats' column
            stats: characterStats // <-- FIX: Insert characterStats into 'stats' column
        };

        const { data, error } = await this.client
            .from('hosg_characters')
            .insert([defaultState])
            .select('id')
            .single();

        if (error) throw error;
        
        return { success: true, characterId: data.id };
    } catch (error) {
        console.error('[Supabase] Failed to create character:', error.message || error);
        return { success: false, error: error.message || String(error) };
    }
};

// ============================================================
// DATA PERSISTENCE
// ============================================================

SupabaseService.prototype.loadCharacterState = async function (characterId) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
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
            core: coreData, 
            inventory: inventoryData,
            equipment: equipmentData,
        };
        
        return { success: true, state: state };

    } catch (error) {
        console.error('[Supabase] Failed to load character state:', error.message || error);
        return { success: false, error: error.message || String(error) };
    }
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    if (!this.client) { 
        return { success: false, error: "Supabase client not initialized." };
    }
    try {
        // Prepare stats to save into the JSONB column
        const characterStats = {
             // NEW: Persist base stats (needed for level-up/gear-stat synchronization)
            base_attack_power: state.base_attack_power,
            base_magic_power: state.base_magic_power,
            base_move_speed: state.base_move_speed,
            // Include Max resources here if they are also changing/persisted via JSONB
            max_health: state.max_health,
            max_mana: state.max_mana,
            max_stamina: state.max_stamina,
        };

        // 1. Update Core Character State
        const coreState = {
            // Fields that are direct columns
            position_x: state.position.x,
            position_y: state.position.y,
            position_z: state.position.z,
            rotation_y: state.rotation_y,
            health: state.health,
            mana: state.mana,
            stamina: state.stamina,
            
            // The JSONB column for custom stats
            stats: characterStats // <-- FIX: Update the 'stats' JSONB column
        };
        // NOTE: We also remove the old non-existent fields from the update object
        delete coreState.base_attack_power;
        delete coreState.base_magic_power;
        delete coreState.base_move_speed;
        
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
        console.error('[Supabase] Failed to save character state:', error.message || error);
        return { success: false, error: error.message || String(error) };
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
    console.log('[Network] Templates loaded (Simulated/Supabase).');
    return true; 
};

// Ensure NetworkManager is available globally (for Game.js)
window.NetworkManager = NetworkManager;
