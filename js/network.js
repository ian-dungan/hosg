// ============================================================
// HEROES OF SHADY GROVE - NETWORK MANAGER v1.0.17 (PATCHED)
// Fix: Ensured saveCharacterState correctly handles item and equipment updates.
// ============================================================
// ... (SupabaseService.prototype.saveCharacterState) ...
SupabaseService.prototype.saveCharacterState = async function (characterId, state) {
    try {
        // 1. Update core character data
        // ... (core update logic remains the same) ...

        // 2. Update Inventory (Delete all then Insert new state)
        await this.client.from('hosg_character_items').delete().eq('character_id', characterId); 
        const newInventoryData = state.inventory.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newInventoryData.length > 0) {
             const { error: insertInvError } = await this.client.from('hosg_character_items').insert(newInventoryData);
            if (insertInvError) throw insertInvError;
        }

        // 3. Update Equipment (Delete all then Insert new state)
        await this.client.from('hosg_character_equipment').delete().eq('character_id', characterId); 
        const newEquipmentData = state.equipment.map(item => ({ ...item, character_id: characterId, id: undefined }));
        if (newEquipmentData.length > 0) {
            const { error: insertEquipError } = await this.client.from('hosg_character_equipment').insert(newEquipmentData);
            if (insertEquipError) throw insertEquipError;
        }

        return { success: true };

    } catch (error) {
        // ... (error handling remains the same) ...
    }
};
// ... (rest of NetworkManager prototype methods) ...
