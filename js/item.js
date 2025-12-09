// ===========================================================
// HEROES OF SHADY GROVE - ITEM SYSTEM
// ===========================================================

class Item {
    constructor(template, instanceId = null, quantity = 1) {
        this.id = instanceId || 'new-' + Math.random().toString(36).substring(7);
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
}

class Inventory {
    constructor(player) {
        this.player = player;
        this.slots = new Array(CONFIG.PLAYER.INVENTORY_SIZE).fill(null);
    }
}
window.Item = Item;
window.Inventory = Inventory;
