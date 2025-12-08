// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.20 (PATCHED)
// Updated createCharacter to handle class selection and stats.
// ============================================================

// ... (existing SupabaseService.prototype.getAccountByName and createAccount remain the same) ...

// ... (existing getCharacterByName remains the same) ...

SupabaseService.prototype.createCharacter = async function (accountId, characterName, className) {
    // 1. Check for duplicate character name
    const existingCharResult = await this.getCharacterByName(characterName);
    if (!existingCharResult.success) {
         return { success: false, error: existingCharResult.error };
    }
    if (existingCharResult.character) {
        return { success: false, error: `Character name '${characterName}' is already taken.` };
    }
    
    // --- NEW: Get class configuration and validate it ---
    const classConfig = CONFIG.CLASSES[className];
    if (!classConfig) {
        return { success: false, error: `Invalid class name provided: ${className}` };
    }
    const classStats = classConfig.stats;

    // 2. Insert new character with default stats
    try {
        const defaultState = {
            account_id: accountId,
            name: characterName,
            class_name: className, // ADDED: Save the class name
            
            // Initial position (pulled from CONFIG.PLAYER)
            position_x: 0,
            position_y: CONFIG.PLAYER.SPAWN_HEIGHT,
            position_z: 0,
            rotation_y: 0,
            
            // Initial resource MAXES (from class config)
            max_health: classStats.maxHealth,
            max_mana: classStats.maxMana,
            max_stamina: classStats.maxStamina,

            // Initial resource CURRENTS (set to max)
            health: classStats.maxHealth,
            mana: classStats.maxMana,
            stamina: classStats.maxStamina,

            // Persist the base stats of the class upon creation
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

// ... (loadCharacterState will now load the class_name and new base stats in the core object)

// ... (The rest of network.js remains the same) ...
