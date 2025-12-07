// ============================================================
// HEROES OF SHADY GROVE - ITEM AND INVENTORY SYSTEM v1.0.10 (PATCHED)
// Fix: Ensured Inventory.load() uses the passed itemTemplates argument.
// ============================================================

// Item Class
class Item {
    constructor(template, instanceId = null, quantity = 1) {
        this.id = instanceId || 'new-' + Math.random().toString(36).substring(7);
        this.templateId = template.id;
        this.name = template.name;
        this.description = template.description || '';
        this.quantity = quantity;
        this.itemType = template.item_type; // e.g., 'Consumable', 'Weapon', 'Armor'
        this.slot = template.equip_slot; // e.g., 'Head', 'Weapon_MainHand'
        this.rarity = template.rarity || 'Common';
        this.effects = template.effects || {}; // { health_restore: 10 }
        this.stats = template.stats || {}; // { attackPower: 5 }
    }

    canStack(otherItem) {
        return this.templateId === otherItem.templateId && this.itemType !== 'Weapon' && this.itemType !== 'Armor';
    }
}

// Inventory Class
class Inventory {
    // Note: The constructor in player.js passes 'this' (the Player) as the only arg,
    // so we keep the constructor simple. Capacity is pulled from CONFIG.
    constructor(player) {
        this.player = player;
        this.slots = new Array(CONFIG.PLAYER.INVENTORY_SIZE).fill(null);
    }

    /**
     * Loads item data fetched from the database into the inventory structure.
     * @param {Array<Object>} itemRecords - Array of item records from hosg_character_items.
     * @param {Map<number, Object>} itemTemplates - Map of all item templates (ID -> Template).
     */
    load(itemRecords, itemTemplates) { // <-- itemTemplates is the argument here
        this.slots.fill(null); 
        
        itemRecords.forEach(itemRecord => {
            // FIX: itemTemplates is guaranteed to be defined here, as Player.init passes it.
            const template = itemTemplates.get(itemRecord.item_template_id);
            
            if (template) {
                // Instantiate the Item object
                const item = new Item(template, itemRecord.id, itemRecord.quantity);
                
                // Place the item in the correct slot
                if (itemRecord.slot_index >= 0 && itemRecord.slot_index < this.slots.length) {
                     this.slots[itemRecord.slot_index] = item;
                } else {
                    console.warn(`[Inventory] Item ${item.name} has invalid slot index ${itemRecord.slot_index}.`);
                }
            } else {
                console.warn(`[Inventory] Could not find item template for ID ${itemRecord.item_template_id}. Skipping.`);
            }
        });
        console.log(`[Inventory] Loaded ${itemRecords.length} items from database into inventory.`);
    }

    getSaveData() {
        return this.slots
            .map((item, index) => {
                if (item) {
                    return {
                        item_template_id: item.templateId,
                        quantity: item.quantity,
                        slot_index: index,
                        location_type: 'inventory'
                    };
                }
                return null;
            })
            .filter(data => data !== null);
    }
}

// Equipment Class
class Equipment {
    constructor(player) {
        this.player = player;
        this.slots = {}; // Key: slot name, Value: Item instance
    }

    /**
     * Loads equipped item data.
     * @param {Array<Object>} equipmentRecords - Records from hosg_character_equipment.
     * @param {Map<number, Object>} itemTemplates - Map of all item templates (ID -> Template).
     */
    load(equipmentRecords, itemTemplates) {
        this.slots = {}; 
        
        equipmentRecords.forEach(equipRecord => {
            const template = itemTemplates.get(equipRecord.item_template_id);
            if (template) {
                // Instance ID is generally not needed for equipped items, but we use it for consistency
                const instanceId = equipRecord.id; 
                // Quantity is always 1 for equipped items
                const item = new Item(template, instanceId, 1);
                
                // Assuming 'equip_slot' is a field on the template
                this.slots[template.equip_slot] = item; 
            }
        });
    }

    equip(item) {
        const slot = item.slot;
        if (!slot) return null;

        const previouslyEquipped = this.slots[slot] || null;

        // Equip the new item
        this.slots[slot] = item;
        
        // TODO: Re-calculate player stats here or in player.js after equipping
        // This is a placeholder for future logic
        // this.player.updateStatsFromEquipment(); 

        return previouslyEquipped;
    }
    
    getSaveData() {
        return Object.values(this.slots).map(item => ({
            item_template_id: item.templateId,
            quantity: 1, 
            equip_slot: item.slot
        }));
    }
}
