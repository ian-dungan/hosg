// ============================================================================
// HEROES OF SHADY GROVE - INVENTORY SYSTEM
// Drag-and-drop inventory with equipment slots, tooltips, and item management
// ============================================================================

class InventoryManager {
    constructor(player, game) {
        this.player = player;
        this.game = game;
        this.scene = game.scene;
        
        // Inventory configuration
        this.config = {
            INVENTORY_SLOTS: 24,      // 4x6 grid
            MAX_STACK_SIZE: 99,       // Max items per stack
            PICKUP_RANGE: 3.0,        // Range to pickup items
            LOOT_SPARKLE: true        // Show sparkle on loot
        };
        
        // Inventory data
        this.slots = new Array(this.config.INVENTORY_SLOTS).fill(null);
        
        // Equipment slots
        this.equipment = {
            head: null,
            chest: null,
            legs: null,
            feet: null,
            hands: null,
            weapon: null,
            offhand: null,
            neck: null,
            ring1: null,
            ring2: null,
            trinket1: null,
            trinket2: null
        };
        
        // Drag state
        this.draggedItem = null;
        this.draggedSlot = null;
        this.draggedSource = null; // 'inventory' or 'equipment'
        
        // Gold
        this.gold = 0;
        
        // UI elements (will be created)
        this.inventoryWindow = null;
        this.isOpen = false;
        
        console.log('[Inventory] System initialized');
    }
    
    // ========================================================================
    // UI CREATION
    // ========================================================================
    
    createInventoryUI() {
        // Create inventory window
        this.inventoryWindow = document.createElement('div');
        this.inventoryWindow.id = 'inventory-window';
        this.inventoryWindow.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 550px;
            background: linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%);
            border: 2px solid #666;
            border-radius: 8px;
            padding: 20px;
            display: none;
            z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            font-family: Arial, sans-serif;
            color: #fff;
        `;
        
        // Title bar
        const titleBar = document.createElement('div');
        titleBar.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #444;
        `;
        
        const title = document.createElement('h2');
        title.textContent = 'Inventory';
        title.style.cssText = 'margin: 0; font-size: 20px; color: #ffd700;';
        
        const closeBtn = document.createElement('button');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = `
            background: #ff4444;
            border: none;
            color: white;
            font-size: 24px;
            cursor: pointer;
            width: 30px;
            height: 30px;
            border-radius: 4px;
            line-height: 1;
        `;
        closeBtn.onclick = () => this.toggleInventory();
        
        titleBar.appendChild(title);
        titleBar.appendChild(closeBtn);
        this.inventoryWindow.appendChild(titleBar);
        
        // Main container
        const mainContainer = document.createElement('div');
        mainContainer.style.cssText = 'display: flex; gap: 20px;';
        
        // Left side - Equipment
        const equipmentPanel = this.createEquipmentPanel();
        
        // Right side - Inventory grid + gold
        const inventoryPanel = this.createInventoryPanel();
        
        mainContainer.appendChild(equipmentPanel);
        mainContainer.appendChild(inventoryPanel);
        this.inventoryWindow.appendChild(mainContainer);
        
        // Add to page
        document.body.appendChild(this.inventoryWindow);
        
        // Keyboard shortcut (I key)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'i' || e.key === 'I') {
                this.toggleInventory();
            }
        });
        
        console.log('[Inventory] UI created');
    }
    
    createEquipmentPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            flex: 0 0 180px;
            background: rgba(0,0,0,0.3);
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px;
        `;
        
        const title = document.createElement('h3');
        title.textContent = 'Equipment';
        title.style.cssText = 'margin: 0 0 10px 0; font-size: 14px; color: #ffd700; text-align: center;';
        panel.appendChild(title);
        
        // Equipment slots layout
        const slotOrder = [
            ['head'],
            ['neck'],
            ['chest'],
            ['weapon', 'offhand'],
            ['hands'],
            ['legs'],
            ['feet'],
            ['ring1', 'ring2'],
            ['trinket1', 'trinket2']
        ];
        
        slotOrder.forEach(row => {
            const rowDiv = document.createElement('div');
            rowDiv.style.cssText = 'display: flex; gap: 5px; justify-content: center; margin-bottom: 5px;';
            
            row.forEach(slotName => {
                const slot = this.createSlot(slotName, 'equipment');
                rowDiv.appendChild(slot);
            });
            
            panel.appendChild(rowDiv);
        });
        
        return panel;
    }
    
    createInventoryPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = 'flex: 1; display: flex; flex-direction: column;';
        
        // Gold display
        const goldDisplay = document.createElement('div');
        goldDisplay.id = 'gold-display';
        goldDisplay.style.cssText = `
            background: rgba(255, 215, 0, 0.1);
            border: 1px solid #ffd700;
            border-radius: 4px;
            padding: 8px;
            margin-bottom: 10px;
            text-align: center;
            font-weight: bold;
            color: #ffd700;
        `;
        goldDisplay.innerHTML = `<span style="font-size: 18px;">💰 ${this.gold} Gold</span>`;
        panel.appendChild(goldDisplay);
        
        // Inventory grid (4x6 = 24 slots)
        const grid = document.createElement('div');
        grid.id = 'inventory-grid';
        grid.style.cssText = `
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 4px;
            background: rgba(0,0,0,0.3);
            border: 1px solid #444;
            border-radius: 4px;
            padding: 10px;
        `;
        
        for (let i = 0; i < this.config.INVENTORY_SLOTS; i++) {
            const slot = this.createSlot(i, 'inventory');
            grid.appendChild(slot);
        }
        
        panel.appendChild(grid);
        
        return panel;
    }
    
    createSlot(id, type) {
        const slot = document.createElement('div');
        slot.className = 'item-slot';
        slot.dataset.slotId = id;
        slot.dataset.slotType = type;
        
        slot.style.cssText = `
            width: 50px;
            height: 50px;
            background: rgba(0, 0, 0, 0.5);
            border: 2px solid #555;
            border-radius: 4px;
            cursor: pointer;
            position: relative;
            transition: all 0.2s;
        `;
        
        // Equipment slot labels
        if (type === 'equipment') {
            const label = document.createElement('div');
            label.textContent = this.getSlotLabel(id);
            label.style.cssText = `
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                font-size: 10px;
                color: #888;
                pointer-events: none;
            `;
            slot.appendChild(label);
        }
        
        // Drag and drop events
        slot.addEventListener('dragstart', (e) => this.handleDragStart(e, id, type));
        slot.addEventListener('dragover', (e) => this.handleDragOver(e));
        slot.addEventListener('drop', (e) => this.handleDrop(e, id, type));
        slot.addEventListener('dragend', (e) => this.handleDragEnd(e));
        
        // Mouse events for tooltips
        slot.addEventListener('mouseenter', (e) => this.showTooltip(e, id, type));
        slot.addEventListener('mouseleave', () => this.hideTooltip());
        
        // Right-click to use/equip
        slot.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleRightClick(id, type);
        });
        
        return slot;
    }
    
    getSlotLabel(slotName) {
        const labels = {
            head: 'Head',
            chest: 'Chest',
            legs: 'Legs',
            feet: 'Feet',
            hands: 'Hands',
            weapon: 'Weapon',
            offhand: 'Shield',
            neck: 'Neck',
            ring1: 'Ring',
            ring2: 'Ring',
            trinket1: 'Trinket',
            trinket2: 'Trinket'
        };
        return labels[slotName] || slotName;
    }
    
    // ========================================================================
    // DRAG AND DROP
    // ========================================================================
    
    handleDragStart(e, slotId, type) {
        const item = type === 'inventory' ? this.slots[slotId] : this.equipment[slotId];
        if (!item) return;
        
        this.draggedItem = item;
        this.draggedSlot = slotId;
        this.draggedSource = type;
        
        e.dataTransfer.effectAllowed = 'move';
        e.target.style.opacity = '0.5';
        
        console.log(`[Inventory] Dragging ${item.name} from ${type}[${slotId}]`);
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        e.target.closest('.item-slot').style.background = 'rgba(100, 150, 255, 0.3)';
    }
    
    handleDrop(e, targetSlot, targetType) {
        e.preventDefault();
        e.target.closest('.item-slot').style.background = '';
        
        if (!this.draggedItem) return;
        
        // Get target item
        const targetItem = targetType === 'inventory' ? this.slots[targetSlot] : this.equipment[targetSlot];
        
        // Check if valid drop
        if (targetType === 'equipment') {
            // Must match equipment slot
            if (this.draggedItem.equipSlot !== targetSlot) {
                console.log(`[Inventory] Cannot equip ${this.draggedItem.name} in ${targetSlot} slot`);
                return;
            }
        }
        
        // Perform swap/move
        if (this.draggedSource === 'inventory' && targetType === 'inventory') {
            // Inventory to inventory
            this.swapInventorySlots(this.draggedSlot, targetSlot);
        } else if (this.draggedSource === 'inventory' && targetType === 'equipment') {
            // Inventory to equipment (equip)
            this.equipItem(this.draggedSlot, targetSlot);
        } else if (this.draggedSource === 'equipment' && targetType === 'inventory') {
            // Equipment to inventory (unequip)
            this.unequipItem(this.draggedSlot, targetSlot);
        } else if (this.draggedSource === 'equipment' && targetType === 'equipment') {
            // Equipment to equipment (swap)
            this.swapEquipment(this.draggedSlot, targetSlot);
        }
        
        this.updateUI();
    }
    
    handleDragEnd(e) {
        e.target.style.opacity = '1';
        this.draggedItem = null;
        this.draggedSlot = null;
        this.draggedSource = null;
        
        // Reset all slot backgrounds
        document.querySelectorAll('.item-slot').forEach(slot => {
            slot.style.background = 'rgba(0, 0, 0, 0.5)';
        });
    }
    
    handleRightClick(slotId, type) {
        if (type === 'inventory') {
            const item = this.slots[slotId];
            if (!item) return;
            
            if (item.type === 'consumable') {
                this.useItem(slotId);
            } else if (item.equipSlot) {
                // Auto-equip
                const targetSlot = item.equipSlot;
                this.equipItem(slotId, targetSlot);
                this.updateUI();
            }
        } else if (type === 'equipment') {
            // Unequip to first empty slot
            const emptySlot = this.findEmptySlot();
            if (emptySlot !== -1) {
                this.unequipItem(slotId, emptySlot);
                this.updateUI();
            }
        }
    }
    
    // ========================================================================
    // ITEM MANAGEMENT
    // ========================================================================
    
    addItem(item, quantity = 1) {
        // Check if stackable and already exists
        if (item.stackable) {
            for (let i = 0; i < this.slots.length; i++) {
                const existingItem = this.slots[i];
                if (existingItem && existingItem.id === item.id) {
                    // Add to existing stack
                    const addAmount = Math.min(quantity, this.config.MAX_STACK_SIZE - existingItem.quantity);
                    existingItem.quantity += addAmount;
                    quantity -= addAmount;
                    
                    if (quantity <= 0) {
                        this.updateUI();
                        return true;
                    }
                }
            }
        }
        
        // Add to empty slot(s)
        while (quantity > 0) {
            const emptySlot = this.findEmptySlot();
            if (emptySlot === -1) {
                console.log('[Inventory] Inventory full!');
                return false;
            }
            
            const addAmount = Math.min(quantity, this.config.MAX_STACK_SIZE);
            const newItem = { ...item, quantity: addAmount };
            this.slots[emptySlot] = newItem;
            quantity -= addAmount;
        }
        
        this.updateUI();
        return true;
    }
    
    removeItem(slotId, quantity = 1) {
        const item = this.slots[slotId];
        if (!item) return false;
        
        item.quantity -= quantity;
        if (item.quantity <= 0) {
            this.slots[slotId] = null;
        }
        
        this.updateUI();
        return true;
    }
    
    equipItem(inventorySlot, equipSlot) {
        const item = this.slots[inventorySlot];
        if (!item || item.equipSlot !== equipSlot) return;
        
        // Swap with existing equipment
        const oldEquipment = this.equipment[equipSlot];
        this.equipment[equipSlot] = item;
        this.slots[inventorySlot] = oldEquipment;
        
        // Apply item stats
        this.applyItemStats(item, true);
        if (oldEquipment) {
            this.applyItemStats(oldEquipment, false);
        }
        
        console.log(`[Inventory] Equipped ${item.name}`);
    }
    
    unequipItem(equipSlot, inventorySlot) {
        const item = this.equipment[equipSlot];
        if (!item) return;
        
        // Swap
        const inventoryItem = this.slots[inventorySlot];
        this.slots[inventorySlot] = item;
        this.equipment[equipSlot] = inventoryItem;
        
        // Remove item stats
        this.applyItemStats(item, false);
        if (inventoryItem && inventoryItem.equipSlot === equipSlot) {
            this.applyItemStats(inventoryItem, true);
        }
        
        console.log(`[Inventory] Unequipped ${item.name}`);
    }
    
    swapInventorySlots(slot1, slot2) {
        const temp = this.slots[slot1];
        this.slots[slot1] = this.slots[slot2];
        this.slots[slot2] = temp;
    }
    
    swapEquipment(slot1, slot2) {
        if (slot1 !== slot2) {
            const temp = this.equipment[slot1];
            this.equipment[slot1] = this.equipment[slot2];
            this.equipment[slot2] = temp;
        }
    }
    
    useItem(slotId) {
        const item = this.slots[slotId];
        if (!item || item.type !== 'consumable') return;
        
        // Apply consumable effect
        if (item.effect === 'heal') {
            this.player.stats.currentHP = Math.min(
                this.player.stats.maxHP,
                this.player.stats.currentHP + item.healAmount
            );
            console.log(`[Inventory] Used ${item.name}, healed ${item.healAmount} HP`);
            
            if (this.game.combat) {
                this.game.combat.logCombat(`Used ${item.name} (+${item.healAmount} HP)`);
            }
        } else if (item.effect === 'mana') {
            this.player.stats.currentMana = Math.min(
                this.player.stats.maxMana,
                this.player.stats.currentMana + item.manaAmount
            );
            console.log(`[Inventory] Used ${item.name}, restored ${item.manaAmount} Mana`);
        }
        
        // Remove one from stack
        this.removeItem(slotId, 1);
    }
    
    applyItemStats(item, apply) {
        if (!item.stats || !this.player.stats) return;
        
        const multiplier = apply ? 1 : -1;
        
        if (item.stats.strength) this.player.stats.strength += item.stats.strength * multiplier;
        if (item.stats.intelligence) this.player.stats.intelligence += item.stats.intelligence * multiplier;
        if (item.stats.armor) this.player.stats.armor += item.stats.armor * multiplier;
        if (item.stats.maxHP) {
            this.player.stats.maxHP += item.stats.maxHP * multiplier;
            this.player.stats.currentHP += item.stats.maxHP * multiplier;
        }
        if (item.stats.maxMana) {
            this.player.stats.maxMana += item.stats.maxMana * multiplier;
        }
        if (item.stats.weaponDamage) {
            this.player.stats.weaponDamage += item.stats.weaponDamage * multiplier;
        }
        
        console.log(`[Inventory] ${apply ? 'Applied' : 'Removed'} stats from ${item.name}`);
    }
    
    findEmptySlot() {
        for (let i = 0; i < this.slots.length; i++) {
            if (!this.slots[i]) return i;
        }
        return -1;
    }
    
    // ========================================================================
    // WORLD ITEM INTERACTION
    // ========================================================================
    
    pickupNearbyItems() {
        if (!this.game.world || !this.player.mesh) return;
        
        const playerPos = this.player.mesh.position;
        const itemsToRemove = [];
        
        for (const item of this.game.world.worldItems) {
            if (!item.mesh) continue;
            
            const distance = BABYLON.Vector3.Distance(playerPos, item.mesh.position);
            if (distance <= this.config.PICKUP_RANGE) {
                // Pick up item
                if (this.addItem(item.itemData, item.itemData.quantity || 1)) {
                    console.log(`[Inventory] Picked up ${item.itemData.name}`);
                    itemsToRemove.push(item);
                    
                    // Show pickup message
                    if (this.game.combat) {
                        this.game.combat.logCombat(`+${item.itemData.name}`);
                    }
                }
            }
        }
        
        // Remove picked up items
        itemsToRemove.forEach(item => {
            item.dispose();
            const index = this.game.world.worldItems.indexOf(item);
            if (index > -1) {
                this.game.world.worldItems.splice(index, 1);
            }
        });
    }
    
    // ========================================================================
    // TOOLTIP
    // ========================================================================
    
    showTooltip(e, slotId, type) {
        const item = type === 'inventory' ? this.slots[slotId] : this.equipment[slotId];
        if (!item) return;
        
        // Remove existing tooltip
        this.hideTooltip();
        
        const tooltip = document.createElement('div');
        tooltip.id = 'item-tooltip';
        tooltip.style.cssText = `
            position: fixed;
            background: linear-gradient(135deg, #1a1a1a 0%, #2a2a2a 100%);
            border: 2px solid ${this.getRarityColor(item.rarity)};
            border-radius: 4px;
            padding: 12px;
            z-index: 10000;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
            pointer-events: none;
        `;
        
        // Item name
        const name = document.createElement('div');
        name.textContent = item.name;
        name.style.cssText = `
            font-weight: bold;
            font-size: 14px;
            margin-bottom: 5px;
            color: ${this.getRarityColor(item.rarity)};
        `;
        tooltip.appendChild(name);
        
        // Item type
        const itemType = document.createElement('div');
        itemType.textContent = `${item.type}${item.equipSlot ? ' - ' + item.equipSlot : ''}`;
        itemType.style.cssText = 'font-size: 11px; color: #aaa; margin-bottom: 8px;';
        tooltip.appendChild(itemType);
        
        // Stats
        if (item.stats) {
            const statsDiv = document.createElement('div');
            statsDiv.style.cssText = 'border-top: 1px solid #444; padding-top: 5px; margin-top: 5px;';
            
            for (const [stat, value] of Object.entries(item.stats)) {
                const statLine = document.createElement('div');
                statLine.textContent = `+${value} ${this.getStatName(stat)}`;
                statLine.style.cssText = 'color: #4f4; font-size: 12px; margin: 2px 0;';
                statsDiv.appendChild(statLine);
            }
            
            tooltip.appendChild(statsDiv);
        }
        
        // Description
        if (item.description) {
            const desc = document.createElement('div');
            desc.textContent = `"${item.description}"`;
            desc.style.cssText = 'font-style: italic; color: #ffeb3b; font-size: 11px; margin-top: 8px;';
            tooltip.appendChild(desc);
        }
        
        // Value
        const value = document.createElement('div');
        value.textContent = `Value: ${item.value || 0} gold`;
        value.style.cssText = 'color: #ffd700; font-size: 11px; margin-top: 5px;';
        tooltip.appendChild(value);
        
        // Quantity
        if (item.quantity && item.quantity > 1) {
            const qty = document.createElement('div');
            qty.textContent = `Quantity: ${item.quantity}`;
            qty.style.cssText = 'color: #aaa; font-size: 11px;';
            tooltip.appendChild(qty);
        }
        
        document.body.appendChild(tooltip);
        
        // Position tooltip
        const rect = e.target.getBoundingClientRect();
        tooltip.style.left = (rect.right + 10) + 'px';
        tooltip.style.top = rect.top + 'px';
    }
    
    hideTooltip() {
        const tooltip = document.getElementById('item-tooltip');
        if (tooltip) tooltip.remove();
    }
    
    getRarityColor(rarity) {
        const colors = {
            common: '#9d9d9d',
            uncommon: '#1eff00',
            rare: '#0070dd',
            epic: '#a335ee',
            legendary: '#ff8000'
        };
        return colors[rarity] || colors.common;
    }
    
    getStatName(stat) {
        const names = {
            strength: 'Strength',
            intelligence: 'Intelligence',
            armor: 'Armor',
            maxHP: 'Health',
            maxMana: 'Mana',
            weaponDamage: 'Damage',
            critChance: 'Crit Chance',
            magicResist: 'Magic Resist'
        };
        return names[stat] || stat;
    }
    
    // ========================================================================
    // UI UPDATE
    // ========================================================================
    
    updateUI() {
        // Update inventory slots
        for (let i = 0; i < this.config.INVENTORY_SLOTS; i++) {
            const slotEl = document.querySelector(`.item-slot[data-slot-id="${i}"][data-slot-type="inventory"]`);
            if (slotEl) {
                this.updateSlotDisplay(slotEl, this.slots[i]);
            }
        }
        
        // Update equipment slots
        for (const [slotName, item] of Object.entries(this.equipment)) {
            const slotEl = document.querySelector(`.item-slot[data-slot-id="${slotName}"][data-slot-type="equipment"]`);
            if (slotEl) {
                this.updateSlotDisplay(slotEl, item);
            }
        }
        
        // Update gold
        const goldDisplay = document.getElementById('gold-display');
        if (goldDisplay) {
            goldDisplay.innerHTML = `<span style="font-size: 18px;">💰 ${this.gold} Gold</span>`;
        }
    }
    
    updateSlotDisplay(slotEl, item) {
        // Clear existing content except label
        const label = slotEl.querySelector('div');
        slotEl.innerHTML = '';
        if (!item && label) {
            slotEl.appendChild(label);
        }
        
        if (!item) {
            slotEl.style.background = 'rgba(0, 0, 0, 0.5)';
            slotEl.draggable = false;
            return;
        }
        
        slotEl.style.background = `linear-gradient(135deg, rgba(0,0,0,0.7) 0%, rgba(50,50,50,0.7) 100%)`;
        slotEl.style.borderColor = this.getRarityColor(item.rarity);
        slotEl.draggable = true;
        
        // Item icon (emoji or text)
        const icon = document.createElement('div');
        icon.textContent = item.icon || '📦';
        icon.style.cssText = `
            font-size: 24px;
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            pointer-events: none;
        `;
        slotEl.appendChild(icon);
        
        // Quantity for stackable items
        if (item.quantity && item.quantity > 1) {
            const qty = document.createElement('div');
            qty.textContent = item.quantity;
            qty.style.cssText = `
                position: absolute;
                bottom: 2px;
                right: 4px;
                font-size: 12px;
                font-weight: bold;
                color: white;
                text-shadow: 1px 1px 2px black;
                pointer-events: none;
            `;
            slotEl.appendChild(qty);
        }
    }
    
    toggleInventory() {
        this.isOpen = !this.isOpen;
        if (this.inventoryWindow) {
            this.inventoryWindow.style.display = this.isOpen ? 'block' : 'none';
        }
        
        if (this.isOpen) {
            this.updateUI();
        }
    }
    
    // ========================================================================
    // DATABASE PERSISTENCE
    // ========================================================================
    
    async saveToDatabase() {
        if (!window.supabaseService || !window.supabaseService.currentCharacter) {
            console.warn('[Inventory] Cannot save - no database connection');
            return false;
        }
        
        try {
            const characterId = window.supabaseService.currentCharacter.id;
            
            // First, delete all existing inventory items for this character
            await window.supabaseService.client
                .from('hosg_character_items')
                .delete()
                .eq('character_id', characterId)
                .eq('location_type', 'inventory');
            
            // Save current inventory items
            const itemsToSave = [];
            this.slots.forEach((item, index) => {
                if (item) {
                    itemsToSave.push({
                        character_id: characterId,
                        item_template_id: item.id,
                        quantity: item.quantity || 1,
                        slot_index: index,
                        location_type: 'inventory'
                    });
                }
            });
            
            if (itemsToSave.length > 0) {
                const { error } = await window.supabaseService.client
                    .from('hosg_character_items')
                    .insert(itemsToSave);
                
                if (error) throw error;
            }
            
            console.log(`[Inventory] ✓ Saved ${itemsToSave.length} items to database`);
            return true;
            
        } catch (error) {
            console.error('[Inventory] Failed to save:', error);
            return false;
        }
    }
    
    async loadFromDatabase() {
        if (!window.supabaseService || !window.supabaseService.currentCharacter) {
            console.warn('[Inventory] Cannot load - no database connection');
            return false;
        }
        
        try {
            const characterId = window.supabaseService.currentCharacter.id;
            
            // Load inventory items
            const { data: items, error } = await window.supabaseService.client
                .from('hosg_character_items')
                .select('*, hosg_item_templates(*)')
                .eq('character_id', characterId)
                .eq('location_type', 'inventory')
                .order('slot_index');
            
            if (error) throw error;
            
            // Clear current inventory
            this.slots = new Array(this.config.INVENTORY_SLOTS).fill(null);
            
            // Load items into slots
            if (items && items.length > 0) {
                items.forEach(dbItem => {
                    const template = dbItem.hosg_item_templates;
                    if (template && dbItem.slot_index < this.config.INVENTORY_SLOTS) {
                        this.slots[dbItem.slot_index] = {
                            id: template.id,
                            code: template.code,
                            name: template.name,
                            description: template.description,
                            type: template.item_type,
                            equipSlot: template.equip_slot,
                            rarity: template.rarity,
                            quantity: dbItem.quantity,
                            stats: template.stats || {},
                            effects: template.effects || {}
                        };
                    }
                });
                
                console.log(`[Inventory] ✓ Loaded ${items.length} items from database`);
            }
            
            // Update UI
            this.updateUI();
            return true;
            
        } catch (error) {
            console.error('[Inventory] Failed to load:', error);
            return false;
        }
    }
    
    async saveEquipmentToDatabase() {
        if (!window.supabaseService || !window.supabaseService.currentCharacter) {
            console.warn('[Inventory] Cannot save equipment - no database connection');
            return false;
        }
        
        try {
            const characterId = window.supabaseService.currentCharacter.id;
            
            // Delete existing equipment
            await window.supabaseService.client
                .from('hosg_character_equipment')
                .delete()
                .eq('character_id', characterId);
            
            // Save current equipment
            const equipmentToSave = [];
            Object.entries(this.equipment).forEach(([slot, item]) => {
                if (item) {
                    equipmentToSave.push({
                        character_id: characterId,
                        item_template_id: item.id,
                        equip_slot: slot
                    });
                }
            });
            
            if (equipmentToSave.length > 0) {
                const { error } = await window.supabaseService.client
                    .from('hosg_character_equipment')
                    .insert(equipmentToSave);
                
                if (error) throw error;
            }
            
            console.log(`[Inventory] ✓ Saved ${equipmentToSave.length} equipped items to database`);
            return true;
            
        } catch (error) {
            console.error('[Inventory] Failed to save equipment:', error);
            return false;
        }
    }
    
    async loadEquipmentFromDatabase() {
        if (!window.supabaseService || !window.supabaseService.currentCharacter) {
            console.warn('[Inventory] Cannot load equipment - no database connection');
            return false;
        }
        
        try {
            const characterId = window.supabaseService.currentCharacter.id;
            
            // Load equipment
            const { data: items, error } = await window.supabaseService.client
                .from('hosg_character_equipment')
                .select('*, hosg_item_templates(*)')
                .eq('character_id', characterId);
            
            if (error) throw error;
            
            // Clear current equipment
            Object.keys(this.equipment).forEach(slot => {
                this.equipment[slot] = null;
            });
            
            // Load equipment into slots
            if (items && items.length > 0) {
                items.forEach(dbItem => {
                    const template = dbItem.hosg_item_templates;
                    if (template && this.equipment.hasOwnProperty(dbItem.equip_slot)) {
                        this.equipment[dbItem.equip_slot] = {
                            id: template.id,
                            code: template.code,
                            name: template.name,
                            description: template.description,
                            type: template.item_type,
                            equipSlot: template.equip_slot,
                            rarity: template.rarity,
                            stats: template.stats || {},
                            effects: template.effects || {}
                        };
                    }
                });
                
                console.log(`[Inventory] ✓ Loaded ${items.length} equipped items from database`);
                
                // Recalculate stats with new equipment
                this.applyEquipmentStats();
            }
            
            // Update UI
            this.updateUI();
            return true;
            
        } catch (error) {
            console.error('[Inventory] Failed to load equipment:', error);
            return false;
        }
    }
    
    // ========================================================================
    // UPDATE LOOP
    // ========================================================================
    
    update(deltaTime) {
        // Auto-pickup nearby items
        this.pickupNearbyItems();
    }
}

// Export for use in game
if (typeof module !== 'undefined' && module.exports) {
    module.exports = InventoryManager;
}
