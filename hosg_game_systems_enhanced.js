// ============================================================
// HEROES OF SHADY GROVE - ENHANCED GAME SYSTEMS v3.1
// Includes: Loot, Quests, Inventory, Sound, Skills, Bosses
// ============================================================

// Initialize GameSystems if it doesn't exist
if (!window.GameSystems) {
    window.GameSystems = {
        npcManager: null,
        combat: null,
        init: function() { 
            console.log("[GameSystems] Initialized");
            return this; 
        }
    };
}

// ==================== SOUND SYSTEM ====================
class SoundSystem {
    constructor() {
        this.sounds = new Map();
        this.enabled = true;
        this.volume = 0.3;
        this.initSounds();
    }

    initSounds() {
        // Free sound effects from freesound.org via CDN
        this.sounds.set('hit', 'https://assets.mixkit.co/active_storage/sfx/2564/2564-preview.mp3');
        this.sounds.set('levelup', 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3');
        this.sounds.set('loot', 'https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3');
        this.sounds.set('quest', 'https://assets.mixkit.co/active_storage/sfx/1469/1469-preview.mp3');
        this.sounds.set('death', 'https://assets.mixkit.co/active_storage/sfx/2488/2488-preview.mp3');
        this.sounds.set('skill', 'https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3');
    }

    play(soundKey) {
        if (!this.enabled) return;
        try {
            const audio = new Audio(this.sounds.get(soundKey));
            audio.volume = this.volume;
            audio.play().catch(() => {});
        } catch (e) {
            console.warn('Failed to play sound:', e);
        }
    }
}

// ==================== LOOT SYSTEM ====================
class LootSystem {
    constructor(scene) {
        this.scene = scene;
        this.lootTables = this.initLootTables();
    }

    initLootTables() {
        return {
            common: [
                { type: 'gold', amount: [5, 15], chance: 1.0 },
                { type: 'potion_health', amount: 1, chance: 0.3 },
                { type: 'potion_mana', amount: 1, chance: 0.2 }
            ],
            uncommon: [
                { type: 'gold', amount: [15, 30], chance: 1.0 },
                { type: 'potion_health', amount: [1, 2], chance: 0.4 },
                { type: 'potion_mana', amount: [1, 2], chance: 0.3 },
                { type: 'scroll_teleport', amount: 1, chance: 0.1 }
            ],
            rare: [
                { type: 'gold', amount: [30, 60], chance: 1.0 },
                { type: 'weapon', rarity: 'uncommon', chance: 0.3 },
                { type: 'armor', rarity: 'uncommon', chance: 0.2 },
                { type: 'accessory', rarity: 'uncommon', chance: 0.1 }
            ],
            epic: [
                { type: 'gold', amount: [60, 120], chance: 1.0 },
                { type: 'weapon', rarity: 'rare', chance: 0.4 },
                { type: 'armor', rarity: 'rare', chance: 0.3 },
                { type: 'accessory', rarity: 'rare', chance: 0.2 },
                { type: 'skill_tome', level: 1, chance: 0.1 }
            ],
            legendary: [
                { type: 'gold', amount: [120, 240], chance: 1.0 },
                { type: 'weapon', rarity: 'epic', chance: 0.5 },
                { type: 'armor', rarity: 'epic', chance: 0.4 },
                { type: 'accessory', rarity: 'epic', chance: 0.3 },
                { type: 'skill_tome', level: 2, chance: 0.2 },
                { type: 'mount', rarity: 'epic', chance: 0.1 }
            ]
        };
    }

    generateLoot(rarity = 'common') {
        const loot = [];
        const table = this.lootTables[rarity] || this.lootTables.common;

        for (const item of table) {
            if (Math.random() <= item.chance) {
                const amount = Array.isArray(item.amount) 
                    ? Math.floor(Math.random() * (item.amount[1] - item.amount[0] + 1)) + item.amount[0]
                    : item.amount;
                
                loot.push({
                    type: item.type,
                    amount: amount,
                    rarity: item.rarity || 'common'
                });
            }
        }

        return loot;
    }

    createLootPile(position, loot, lifetime = 30000) {
        const lootPile = BABYLON.MeshBuilder.CreateBox('lootPile', { size: 0.5 }, this.scene);
        lootPile.position = position.clone();
        lootPile.lootData = loot;
        lootPile.checkCollisions = false;
        
        // Make loot slightly float above ground
        position.y += 0.25;
        
        // Simple animation
        const startTime = Date.now();
        const animate = () => {
            const elapsed = Date.now() - startTime;
            if (elapsed < lifetime) {
                lootPile.position.y = position.y + Math.sin(elapsed / 500) * 0.1;
                requestAnimationFrame(animate);
            } else {
                lootPile.dispose();
            }
        };
        
        requestAnimationFrame(animate);
        return lootPile;
    }
}

// ==================== INVENTORY SYSTEM ====================
class InventorySystem {
    constructor() {
        this.items = [];
        this.maxSlots = 30;
        this.gold = 0;
        this.equipped = {
            weapon: null,
            armor: null,
            accessory: null
        };
    }

    addItem(item) {
        if (this.items.length >= this.maxSlots) {
            return false; // Inventory full
        }
        
        // Stack stackable items
        if (item.stackable) {
            const existing = this.items.find(i => 
                i.type === item.type && 
                (!i.rarity || i.rarity === item.rarity)
            );
            
            if (existing) {
                existing.amount += item.amount || 1;
                return true;
            }
        }
        
        this.items.push({...item, id: this.generateItemId()});
        return true;
    }

    removeItem(index) {
        if (index >= 0 && index < this.items.length) {
            const item = this.items[index];
            if (item.amount > 1) {
                item.amount--;
                return {...item, amount: 1};
            }
            return this.items.splice(index, 1)[0];
        }
        return null;
    }

    equipItem(index) {
        if (index < 0 || index >= this.items.length) return false;
        
        const item = this.items[index];
        const slot = this.getSlotForItem(item);
        
        if (!slot) return false; // Not equippable
        
        // Swap if slot is occupied
        if (this.equipped[slot]) {
            const oldItem = this.equipped[slot];
            this.equipped[slot] = item;
            this.items[index] = oldItem;
        } else {
            this.equipped[slot] = item;
            this.items.splice(index, 1);
        }
        
        return true;
    }

    getStats() {
        let stats = {
            attack: 0,
            defense: 0,
            maxHp: 0,
            maxMp: 0
        };

        for (const [slot, item] of Object.entries(this.equipped)) {
            if (!item) continue;
            if (item.stats) {
                for (const [stat, value] of Object.entries(item.stats)) {
                    stats[stat] = (stats[stat] || 0) + value;
                }
            }
        }

        return stats;
    }

    generateItemId() {
        return 'item_' + Math.random().toString(36).substr(2, 9);
    }

    getSlotForItem(item) {
        const type = item.type || '';
        if (type.includes('sword') || type.includes('staff') || type.includes('bow')) {
            return 'weapon';
        } else if (type.includes('armor') || type.includes('robe')) {
            return 'armor';
        } else if (type.includes('ring') || type.includes('amulet')) {
            return 'accessory';
        }
        return null;
    }
}

// ==================== SHADOW SYSTEM ====================
let shadowGenerator = null;

function setupShadows(scene) {
    if (!scene) {
        console.warn("No scene provided for shadow setup");
        return null;
    }

    try {
        // Create a directional light if none exists
        let light = scene.lights.find(l => l instanceof BABYLON.DirectionalLight);
        
        if (!light) {
            console.log("Creating directional light for shadows...");
            light = new BABYLON.DirectionalLight("shadowLight", new BABYLON.Vector3(-1, -2, -1), scene);
            light.position = new BABYLON.Vector3(0, 20, 0);
            light.intensity = 0.8;
        }

        shadowGenerator = new BABYLON.ShadowGenerator(1024, light);
        shadowGenerator.useBlurExponentialShadowMap = true;
        shadowGenerator.blurKernel = 16;
        shadowGenerator.forceBackFacesOnly = true;
        shadowGenerator.bias = 0.0001;
        
        console.log("Shadow system initialized");
        return shadowGenerator;
    } catch (error) {
        console.warn("Shadow initialization failed, continuing without shadows:", error);
        return null;
    }
}

// ==================== TARGETING SYSTEM ====================
function targetNearestEnemy() {
    if (!window.GameSystems || !window.GameSystems.npcManager) {
        console.warn("NPC Manager not available for targeting");
        return;
    }

    const enemies = Array.from(window.GameSystems.npcManager.enemies.values());
    if (enemies.length === 0) {
        console.log("No enemies to target");
        return;
    }

    // Get player position (assuming it's available in window.player or similar)
    const playerPos = window.player ? window.player.position : new BABYLON.Vector3(0, 0, 0);
    
    // Find the closest enemy
    let closestEnemy = null;
    let closestDistance = Infinity;
    
    for (const enemy of enemies) {
        if (enemy.mesh && enemy.mesh.root) {
            const distance = BABYLON.Vector3.Distance(playerPos, enemy.mesh.root.position);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestEnemy = enemy;
            }
        }
    }

    if (closestEnemy) {
        console.log(`Targeting ${closestEnemy.name} (${closestDistance.toFixed(1)}m away)`);
        // Highlight the target
        highlightTarget(closestEnemy);
        return closestEnemy;
    }
    
    return null;
}

// Make it globally available
window.targetNearestEnemy = targetNearestEnemy;

function highlightTarget(target) {
    // Clear previous highlight
    clearTargetHighlight();
    
    if (!target || !target.mesh || !target.mesh.root) return;
    
    // Store original material
    target._originalMaterial = target.mesh.root.material;
    
    // Create highlight material
    const highlightMaterial = new BABYLON.StandardMaterial("highlight", window.scene);
    highlightMaterial.emissiveColor = new BABYLON.Color3(1, 0.2, 0.2);
    highlightMaterial.specularPower = 10;
    
    // Apply highlight
    target.mesh.root.material = highlightMaterial;
    
    // Store reference to clear later
    window._currentTarget = target;
}

function clearTargetHighlight() {
    if (window._currentTarget && 
        window._currentTarget.mesh && 
        window._currentTarget.mesh.root && 
        window._currentTarget._originalMaterial) {
        
        // Restore original material
        window._currentTarget.mesh.root.material = window._currentTarget._originalMaterial;
        delete window._currentTarget._originalMaterial;
    }
    window._currentTarget = null;
}

// Initialize shadows when the scene is ready
if (window.GameSystems.init) {
    const originalInit = window.GameSystems.init;
    window.GameSystems.init = function(scene, supabase) {
        const result = originalInit.call(this, scene, supabase);
        // Delay shadow setup to ensure scene is fully initialized
        setTimeout(() => setupShadows(scene), 500);
        return result;
    };
}

console.log("[HOSG] Enhanced game systems loaded v3.1");
