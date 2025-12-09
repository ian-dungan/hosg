// ===========================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.1.0 (ENHANCED)
// Now with ENEMIES section and per-asset custom paths
// ===========================================================

const CONFIG = {
    PLAYER: {
        INVENTORY_SIZE: 30, 
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5,
        MOVE_SPEED: 0.15 
    },
    GAME: {
        GRAVITY: 9.81, 
    },
    WORLD: { 
        SKYBOX: {
            // Skybox file (configured in ASSETS section)
            FILE: "shadygrove_sky_specular.dds",
            SIZE: 512,
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5
        },
        SPAWNS: [
            {
                id: 1,
                name: "Wolf Den",
                npc_template_id: "Wolf",
                position_x: 20,
                position_y: 0,
                position_z: 20,
                spawn_radius: 10,
                max_spawn: 3
            }
        ]
    },
    // =========================================
    // ASSET CONFIGURATION - EDIT PATHS HERE!
    // =========================================
    ASSETS: {
        // Base asset directory (relative to index.html)
        BASE_PATH: "assets/",
        
        // Subfolder structure (used as defaults)
        PATHS: {
            CHARACTERS: "player/character/",
            ENEMIES: "enemies/",
            ENVIRONMENT: "environment/",
            SKYBOX: "environment/skybox/",
            ITEMS: "items/",
            WEAPONS: "weapons/",
            ARMOR: "armor/",
            EFFECTS: "effects/",
            UI: "ui/",
            AUDIO: "audio/",
            MUSIC: "audio/music/",
            SFX: "audio/sfx/"
        },
        
        // Player Character Models
        // Each can have: model (filename), path (override default), required (boolean)
        CHARACTERS: {
            knight: { 
                model: "Knight03.glb",
                path: "characters/",  // Optional: override default path
                required: true 
            }
            // Examples:
            // mage: { 
            //     model: "Mage01.glb",
            //     path: "characters/mages/",  // Custom subfolder
            //     required: true 
            // },
            // archer: {
            //     model: "Archer.glb",
            //     path: "https://cdn.example.com/models/",  // Use CDN
            //     required: false
            // }
        },
        
        // Enemy Models (NPCs, Monsters, Bosses)
        ENEMIES: {
            wolf: { 
                model: "Wolf.glb",
                path: "enemies/",  // Optional: override default path
                required: false 
            }
            // Examples:
            // goblin: {
            //     model: "Goblin.glb",
            //     path: "enemies/humanoids/",
            //     required: false
            // },
            // dragon: {
            //     model: "Dragon_Boss.glb",
            //     path: "enemies/bosses/",
            //     required: true
            // },
            // rat: {
            //     model: "Rat.glb",
            //     path: "../shared/creatures/",  // Parent directory
            //     required: false
            // }
        },
        
        // Environment Assets (trees, rocks, buildings, etc.)
        ENVIRONMENT: {
            tree1: { 
                model: "Tree01.glb",
                path: "environment/nature/"
            }
            // Examples:
            // rock1: { 
            //     model: "Rock01.glb",
            //     path: "environment/nature/"
            // },
            // house1: { 
            //     model: "House01.glb",
            //     path: "environment/buildings/"
            // },
            // castle: {
            //     model: "Castle.glb",
            //     path: "https://cdn.example.com/structures/"
            // }
        },
        
        // Items (can be used for loot, quest items, etc.)
        ITEMS: {
            // Examples:
            // health_potion: {
            //     model: "Potion_Red.glb",
            //     path: "items/consumables/"
            // },
            // gold_coin: {
            //     model: "Coin.glb",
            //     path: "items/currency/"
            // }
        },
        
        // Weapons
        WEAPONS: {
            // Examples:
            // iron_sword: {
            //     model: "Sword_Iron.glb",
            //     path: "weapons/swords/"
            // },
            // wooden_bow: {
            //     model: "Bow_Wood.glb",
            //     path: "weapons/bows/"
            // }
        },
        
        // Armor
        ARMOR: {
            // Examples:
            // iron_helmet: {
            //     model: "Helmet_Iron.glb",
            //     path: "armor/helmets/"
            // },
            // leather_boots: {
            //     model: "Boots_Leather.glb",
            //     path: "armor/boots/"
            // }
        },
        
        // Class Definitions (link models to game classes)
        CLASSES: {
            Warrior: { 
                model: 'knight',
                category: 'CHARACTERS',  // Which section the model is in
                stats: { 
                    maxHealth: 120, 
                    maxMana: 50, 
                    maxStamina: 120, 
                    attackPower: 15, 
                    magicPower: 5, 
                    moveSpeed: 0.15 
                }, 
                defaultAbility: 'Cleave' 
            },
            Wolf: { 
                model: 'wolf',
                category: 'ENEMIES',  // Wolf is in ENEMIES section
                stats: { 
                    maxHealth: 30, 
                    maxMana: 0, 
                    maxStamina: 50, 
                    attackPower: 5, 
                    magicPower: 0, 
                    moveSpeed: 0.18 
                },
                defaultAbility: 'Bite'
            }
            // Examples:
            // Mage: { 
            //     model: 'mage',
            //     category: 'CHARACTERS',
            //     stats: {...}
            // },
            // Goblin: {
            //     model: 'goblin',
            //     category: 'ENEMIES',
            //     stats: {...}
            // }
        },
        
        // Helper function to get full path for any asset
        getAssetPath: function(category, assetKey) {
            const categoryData = this[category];
            if (!categoryData || !categoryData[assetKey]) {
                console.warn(`[Assets] Asset not found: ${category}.${assetKey}`);
                return null;
            }
            
            const asset = categoryData[assetKey];
            if (!asset.model) return null;
            
            // If asset has custom path, use it
            if (asset.path) {
                // Check if path is absolute (http:// or https://)
                if (asset.path.startsWith('http://') || asset.path.startsWith('https://')) {
                    return asset.path + asset.model;
                }
                // Check if path is absolute file path (starts with /)
                if (asset.path.startsWith('/')) {
                    return asset.path + asset.model;
                }
                // Otherwise combine with BASE_PATH
                return this.BASE_PATH + asset.path + asset.model;
            }
            
            // Use default path from PATHS
            const defaultPath = this.PATHS[category] || "";
            return this.BASE_PATH + defaultPath + asset.model;
        },
        
        // Get character model path
        getCharacterPath: function(assetKey) {
            return this.getAssetPath('CHARACTERS', assetKey);
        },
        
        // Get enemy model path
        getEnemyPath: function(assetKey) {
            return this.getAssetPath('ENEMIES', assetKey);
        },
        
        // Get environment model path
        getEnvironmentPath: function(assetKey) {
            return this.getAssetPath('ENVIRONMENT', assetKey);
        },
        
        // Get item model path
        getItemPath: function(assetKey) {
            return this.getAssetPath('ITEMS', assetKey);
        },
        
        // Get weapon model path
        getWeaponPath: function(assetKey) {
            return this.getAssetPath('WEAPONS', assetKey);
        },
        
        // Get armor model path
        getArmorPath: function(assetKey) {
            return this.getAssetPath('ARMOR', assetKey);
        },
        
        // Get skybox path
        getSkyboxPath: function(filename) {
            return this.BASE_PATH + this.PATHS.SKYBOX + filename;
        },
        
        // Get path by class name (looks up in CLASSES)
        getClassModelPath: function(className) {
            const classData = this.CLASSES[className];
            if (!classData) {
                console.warn(`[Assets] Class not found: ${className}`);
                return null;
            }
            
            const category = classData.category || 'CHARACTERS';
            return this.getAssetPath(category, classData.model);
        }
    }
};
window.CONFIG = CONFIG;
