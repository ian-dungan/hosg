// ============================================================
// HEROES OF SHADY GROVE - ITEM AND INVENTORY SYSTEM
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
    constructor(player) {
        this.player = player;
        this.slots = new Array(CONFIG.PLAYER.INVENTORY_SIZE).fill(null);
    }

    load(items, itemTemplates) {
        this.slots.fill(null); 
        
        items.forEach(itemRecord => {
            const template = itemTemplates.get(itemRecord.item_template_id);
            if (template) {
                const item = new Item(template, itemRecord.id, itemRecord.quantity);
                this.slots[itemRecord.slot_index] = item;
            }
        });
    }
    
    addItem(item) {
        if (!item || item.quantity <= 0) return false;

        // Try to stack
        for (let i = 0; i < this.slots.length; i++) {
            const existingItem = this.slots[i];
            if (existingItem && existingItem.canStack(item)) {
                existingItem.quantity += item.quantity;
                return true;
            }
        }

        // Find first empty slot
        const emptyIndex = this.slots.indexOf(null);
        if (emptyIndex !== -1) {
            this.slots[emptyIndex] = item;
            return true;
        }

        this.player.scene.game.ui.showMessage("Inventory is full!", 1500, 'error');
        return false;
    }
    
    removeItem(slotIndex, quantity = 1) {
        const item = this.slots[slotIndex];
        if (!item || item.quantity < quantity) return null;

        if (item.quantity > quantity) {
            item.quantity -= quantity;
            return item; 
        } else {
            this.slots[slotIndex] = null;
            return item;
        }
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

    load(equipmentRecords, itemTemplates) {
        this.slots = {}; 
        
        equipmentRecords.forEach(equipRecord => {
            const template = itemTemplates.get(equipRecord.item_template_id);
            if (template) {
                const item = new Item(template, equipRecord.id, 1);
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
