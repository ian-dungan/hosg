// ============================================================
// HEROES OF SHADY GROVE - INVENTORY SYSTEM v1.0.8
// Manages the player's items, quantity, and slots.
// ============================================================

class Inventory {
    constructor(game, capacity = CONFIG.PLAYER.INVENTORY_SIZE) {
        this.game = game;
        this.capacity = capacity;
        // The items array will hold objects, possibly like:
        // { slot_index: 0, item_template_id: 1002, quantity: 5, itemData: {...} }
        this.items = new Array(capacity).fill(null);
        console.log(`[Inventory] Initialized with capacity: ${capacity}`);
    }

    /**
     * Loads item data fetched from the database into the inventory structure.
     * @param {Array<Object>} dbItems - Array of item records from hosg_character_items.
     */
    loadFromDB(dbItems) {
        if (!dbItems || dbItems.length === 0) return;

        dbItems.forEach(dbItem => {
            const templateId = dbItem.item_template_id;
            
            // Look up the full item data from the game's itemTemplates cache
            const itemData = this.game.itemTemplates.find(t => t.id === templateId);
            
            if (itemData) {
                // Combine the inventory-specific data (slot, quantity) with template data
                const inventoryItem = {
                    ...dbItem,
                    itemData: itemData
                };
                
                if (dbItem.slot_index >= 0 && dbItem.slot_index < this.capacity) {
                    this.items[dbItem.slot_index] = inventoryItem;
                } else {
                    console.warn(`[Inventory] Item template ${templateId} has invalid slot index ${dbItem.slot_index}.`);
                }
            } else {
                console.warn(`[Inventory] Could not find item template for ID ${templateId}.`);
            }
        });
        console.log(`[Inventory] Loaded ${dbItems.length} items from database.`);
    }

    /**
     * Finds the first slot containing a specific item template ID.
     * @param {number} templateId 
     * @returns {Object|null} The inventory item object or null.
     */
    findItem(templateId) {
        return this.items.find(item => item && item.item_template_id === templateId);
    }
    
    // Placeholder for future inventory logic (add, remove, use item, etc.)
    addItem(templateId, quantity) {
        // ... future logic
        return true;
    }
}
