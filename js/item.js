// ===========================================================
// HEROES OF SHADY GROVE - ITEM SYSTEM v1.0.1 (FIXED)
// ===========================================================

class Item {
    constructor(template, instanceId = null, quantity = 1) {
        this.id = instanceId || 'item-' + Math.random().toString(36).substring(7);
        this.templateId = template.id;
        this.name = template.name;
        this.description = template.description || '';
        this.quantity = quantity;
        this.itemType = template.item_type; 
        this.slot = template.equip_slot; 
        this.rarity = template.rarity || 'Common';
        this.effects = template.effects || {}; 
        this.stats = template.stats || {}; 
    }
    
    isStackable() {
        return this.itemType === 'Consumable' || this.itemType === 'Material';
    }
    
    canEquip() {
        return this.slot !== null && this.slot !== undefined;
    }
}

class Inventory {
    constructor(player) {
        this.player = player;
        this.slots = new Array(CONFIG.PLAYER.INVENTORY_SIZE || 30).fill(null);
    }
    
    addItem(item) {
        // Try to stack with existing items first
        if (item.isStackable()) {
            for (let i = 0; i < this.slots.length; i++) {
                const slot = this.slots[i];
                if (slot && slot.templateId === item.templateId) {
                    slot.quantity += item.quantity;
                    return true;
                }
            }
        }
        
        // Find empty slot
        const emptyIndex = this.slots.findIndex(slot => slot === null);
        if (emptyIndex !== -1) {
            this.slots[emptyIndex] = item;
            return true;
        }
        
        return false; // Inventory full
    }
    
    removeItem(slotIndex, quantity = 1) {
        if (slotIndex < 0 || slotIndex >= this.slots.length) return false;
        
        const item = this.slots[slotIndex];
        if (!item) return false;
        
        item.quantity -= quantity;
        if (item.quantity <= 0) {
            this.slots[slotIndex] = null;
        }
        
        return true;
    }
}

window.Item = Item;
window.Inventory = Inventory;
