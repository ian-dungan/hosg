// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.18 (PATCHED)
// Fix: Added methods for Account and Character Creation/Lookup.
// ============================================================

//
// Supabase wrapper
//
function SupabaseService(config) {
    this.config = config || {};
    this.client = null;
    this._init();
}

// ... (SupabaseService.prototype._init, fetch template methods remain the same) ...

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
    // 1. Check for duplicate account name first
    const existingAccountResult = await this.getAccountByName(accountName);
    if (!existingAccountResult.success) {
         return { success: false, error: existingAccountResult.error };
    }
    if (existingAccountResult.account) {
        return { success: false, error: `Account with name '${accountName}' already exists.` };
    }

    // 2. Insert new account
    try {
        const { data, error } = await this.client
            .from('hosg_accounts')
            .insert([{ name: accountName }])
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

SupabaseService.prototype.createCharacter = async function (accountId, characterName) {
    // 1. Check for duplicate character name
    const existingCharResult = await this.getCharacterByName(characterName);
    if (!existingCharResult.success) {
         return { success: false, error: existingCharResult.error };
    }
    if (existingCharResult.character) {
        return { success: false, error: `Character name '${characterName}' is already taken.` };
    }

    // 2. Insert new character with default stats from CONFIG.PLAYER
    try {
        const defaultState = {
            account_id: accountId,
            name: characterName,
            // Initial position
            position_x: 0,
            position_y: CONFIG.PLAYER.SPAWN_HEIGHT,
            position_z: 0,
            rotation_y: 0,
            // Initial stats (from core.js)
            health: CONFIG.PLAYER.HEALTH,
            mana: CONFIG.PLAYER.MANA,
            stamina: CONFIG.PLAYER.STAMINA,
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

SupabaseService.prototype.loadCharacterState = async function (characterId) {
// ... (Existing loadCharacterState code remains the same) ...
};

SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
// ... (Existing saveCharacterState code remains the same) ...
};

var supabaseService = new SupabaseService();

function NetworkManager() {
// ... (NetworkManager constructor and loadTemplates remain the same) ...
}

// ... (rest of NetworkManager prototype methods) ...
