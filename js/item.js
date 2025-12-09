// ============================================================
// HEROES OF SHADY GROVE - ITEM / INVENTORY / EQUIPMENT (ES5)
// Converted to ES5 syntax for legacy browser compatibility.
// ============================================================

(function () {
    'use strict';

    // ----------------- Item -----------------
    function Item(template, instanceId, quantity) {
        if (!template) template = {};
        this.id = instanceId || 'new-' + Math.random().toString(36).substring(7);
        this.templateId = template.id;
        this.name = template.name || 'Item';
        this.description = template.description || '';
        this.quantity = typeof quantity === 'number' ? quantity : 1;
        this.itemType = template.item_type; // e.g., 'Consumable', 'Weapon'
        this.slot = template.equip_slot; // e.g., 'Head', 'Weapon_MainHand'
        this.rarity = template.rarity || 'Common';
        this.effects = template.effects || {}; // { health_restore: 10 }
        this.stats = template.stats || {}; // { attackPower: 5 }
    }

    Item.prototype.canStack = function (otherItem) {
        return otherItem && this.templateId === otherItem.templateId && this.itemType !== 'Weapon' && this.itemType !== 'Armor';
    };

    // ----------------- Inventory -----------------
    function Inventory(player) {
        this.player = player;
        var size = 20;
        if (typeof CONFIG !== 'undefined' && CONFIG.PLAYER && CONFIG.PLAYER.INVENTORY_SIZE) {
            size = CONFIG.PLAYER.INVENTORY_SIZE;
        }
        this.slots = new Array(size);
        for (var i = 0; i < size; i++) this.slots[i] = null;
    }

    Inventory.prototype.load = function (itemRecords, itemTemplates) {
        this.slots = this.slots.map(function () { return null; });
        if (!itemRecords || !itemTemplates || typeof itemTemplates.get !== 'function') return;

        for (var i = 0; i < itemRecords.length; i++) {
            var itemRecord = itemRecords[i];
            var template = itemTemplates.get(itemRecord.item_template_id);
            if (!template) {
                console.warn('[Inventory] Missing item template for id:', itemRecord.item_template_id);
                continue;
            }

            var item = new Item(template, itemRecord.id, itemRecord.quantity);
            if (itemRecord.slot_index >= 0 && itemRecord.slot_index < this.slots.length) {
                this.slots[itemRecord.slot_index] = item;
            } else {
                console.warn('[Inventory] Invalid slot index for item', item.name, itemRecord.slot_index);
            }
        }
    };

    Inventory.prototype.getSaveData = function () {
        var data = [];
        for (var i = 0; i < this.slots.length; i++) {
            var item = this.slots[i];
            if (item) {
                data.push({
                    item_template_id: item.templateId,
                    quantity: item.quantity,
                    slot_index: i,
                    location_type: 'inventory'
                });
            }
        }
        return data;
    };

    // ----------------- Equipment -----------------
    function Equipment(player) {
        this.player = player;
        this.slots = {}; // Key: slot name, Value: Item instance
    }

    Equipment.prototype.load = function (equipmentRecords, itemTemplates) {
        this.slots = {};
        if (!equipmentRecords || !itemTemplates || typeof itemTemplates.get !== 'function') return;

        for (var i = 0; i < equipmentRecords.length; i++) {
            var equipRecord = equipmentRecords[i];
            var template = itemTemplates.get(equipRecord.item_template_id);
            if (!template) continue;

            var instanceId = equipRecord.id;
            var item = new Item(template, instanceId, 1);
            if (template.equip_slot) {
                this.slots[template.equip_slot] = item;
            }
        }
    };

    Equipment.prototype.equip = function (item) {
        if (!item || !item.slot) return null;
        var previous = this.slots[item.slot] || null;
        this.slots[item.slot] = item;
        return previous;
    };

    Equipment.prototype.getSaveData = function () {
        var data = [];
        for (var slot in this.slots) {
            if (!Object.prototype.hasOwnProperty.call(this.slots, slot)) continue;
            var item = this.slots[slot];
            if (item) {
                data.push({
                    item_template_id: item.templateId,
                    quantity: 1,
                    equip_slot: item.slot
                });
            }
        }
        return data;
    };

    // Export globals
    window.Item = Item;
    window.Inventory = Inventory;
    window.Equipment = Equipment;
})();
