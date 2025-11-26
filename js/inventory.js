// inventory.js - Procedural inventory system
class Inventory {
    constructor(scene, player) {
        this.scene = scene;
        this.player = player;
        this.items = [];
        this.maxSize = CONFIG.PLAYER.INVENTORY_SIZE;
        this.ui = null;
        this.init();
    }

    init() {
        // Create UI for inventory
        this.createUI();
        
        // Add some initial items for testing
        this.addItem(this.createItem('Health Potion', 'Restores 25 health', 'potion'));
        this.addItem(this.createItem('Mana Potion', 'Restores 25 mana', 'potion'));
        this.addItem(this.createItem('Sword', 'A sharp blade', 'weapon'));
    }

    createUI() {
        // Create inventory container
        this.ui = document.createElement('div');
        this.ui.id = 'inventory-ui';
        this.ui.style.position = 'absolute';
        this.ui.style.bottom = '20px';
        this.ui.style.right = '20px';
        this.ui.style.width = '200px';
        this.ui.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        this.ui.style.border = '2px solid #444';
        this.ui.style.borderRadius = '5px';
        this.ui.style.padding = '10px';
        this.ui.style.color = 'white';
        this.ui.style.fontFamily = 'Arial, sans-serif';
        this.ui.style.display = 'none'; // Hidden by default
        
        // Title
        const title = document.createElement('div');
        title.textContent = 'Inventory (I to toggle)';
        title.style.fontWeight = 'bold';
        title.style.marginBottom = '10px';
        title.style.borderBottom = '1px solid #444';
        title.style.paddingBottom = '5px';
        this.ui.appendChild(title);
        
        // Items container
        this.itemsContainer = document.createElement('div');
        this.itemsContainer.id = 'inventory-items';
        this.ui.appendChild(this.itemsContainer);
        
        // Add to document
        document.body.appendChild(this.ui);
        
        // Toggle with 'I' key
        window.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'i') {
                this.ui.style.display = this.ui.style.display === 'none' ? 'block' : 'none';
            }
        });
    }

    createItem(name, description, type) {
        // Create a simple item object
        return {
            id: `item_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            name,
            description,
            type,
            icon: this.createItemIcon(type),
            use: this.getItemUseFunction(type)
        };
    }

    createItemIcon(type) {
        // Create a simple icon based on item type
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        
        switch(type) {
            case 'potion':
                // Draw a potion
                ctx.fillStyle = '#FF0000';
                ctx.fillRect(size * 0.4, size * 0.2, size * 0.2, size * 0.3);
                ctx.fillStyle = '#FF6666';
                ctx.beginPath();
                ctx.ellipse(size * 0.5, size * 0.5, size * 0.2, size * 0.1, 0, 0, Math.PI * 2);
                ctx.fill();
                break;
                
            case 'weapon':
                // Draw a sword
                ctx.fillStyle = '#999999';
                // Blade
                ctx.fillRect(size * 0.45, size * 0.1, size * 0.1, size * 0.6);
                // Hilt
                ctx.fillStyle = '#8B4513';
                ctx.fillRect(size * 0.4, size * 0.7, size * 0.2, size * 0.1);
                break;
                
            default:
                // Default icon
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, size, size);
                break;
        }
        
        return canvas.toDataURL();
    }

    getItemUseFunction(type) {
        // Return a function that will be called when the item is used
        switch(type) {
            case 'potion':
                return () => {
                    this.player.health = Math.min(
                        this.player.health + 25, 
                        CONFIG.PLAYER.START_HEALTH
                    );
                    return true; // Item was consumed
                };
                
            case 'weapon':
                return () => {
                    console.log('Swinging sword!');
                    return false; // Item was not consumed
                };
                
            default:
                return () => {
                    console.log('Using item');
                    return false;
                };
        }
    }

    addItem(item) {
        if (this.items.length >= this.maxSize) {
            console.warn('Inventory is full!');
            return false;
        }
        
        this.items.push(item);
        this.updateUI();
        return true;
    }

    removeItem(itemId) {
        const index = this.items.findIndex(item => item.id === itemId);
        if (index !== -1) {
            this.items.splice(index, 1);
            this.updateUI();
            return true;
        }
        return false;
    }

    updateUI() {
        // Clear current items
        this.itemsContainer.innerHTML = '';
        
        // Add each item to the UI
        this.items.forEach(item => {
            const itemElement = document.createElement('div');
            itemElement.className = 'inventory-item';
            itemElement.style.display = 'flex';
            itemElement.style.alignItems = 'center';
            itemElement.style.padding = '5px';
            itemElement.style.margin = '5px 0';
            itemElement.style.borderBottom = '1px solid #444';
            itemElement.style.cursor = 'pointer';
            
            // Add hover effect
            itemElement.onmouseover = () => {
                itemElement.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
            };
            itemElement.onmouseout = () => {
                itemElement.style.backgroundColor = 'transparent';
            };
            
            // Item icon
            const icon = document.createElement('img');
            icon.src = item.icon;
            icon.width = 32;
            icon.height = 32;
            icon.style.marginRight = '10px';
            itemElement.appendChild(icon);
            
            // Item info
            const info = document.createElement('div');
            info.style.flex = '1';
            
            const name = document.createElement('div');
            name.textContent = item.name;
            name.style.fontWeight = 'bold';
            info.appendChild(name);
            
            const desc = document.createElement('div');
            desc.textContent = item.description;
            desc.style.fontSize = '0.8em';
            desc.style.color = '#AAA';
            info.appendChild(desc);
            
            itemElement.appendChild(info);
            
            // Use button
            const useButton = document.createElement('button');
            useButton.textContent = 'Use';
            useButton.style.padding = '2px 8px';
            useButton.style.marginLeft = '5px';
            useButton.style.cursor = 'pointer';
            useButton.onclick = (e) => {
                e.stopPropagation();
                const wasUsed = item.use();
                if (wasUsed) {
                    this.removeItem(item.id);
                }
            };
            itemElement.appendChild(useButton);
            
            // Add to container
            this.itemsContainer.appendChild(itemElement);
        });
    }

    dispose() {
        if (this.ui && this.ui.parentNode) {
            this.ui.parentNode.removeChild(this.ui);
        }
    }
}

// Make Inventory globally available
window.Inventory = Inventory;
