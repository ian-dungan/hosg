// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.21 (ASSET PATHS FIX)
// Fix: Updated BASE_PATH per request and made other paths explicit to prevent 404s.
// ============================================================

const CONFIG = {
    // === PATCH START: ADDING MISSING BLOCKS ===
    PLAYER: {
        INVENTORY_SIZE: 30, // Default value to fix the critical crash in item.js
        // Placeholder values matching fallbacks in player.js (for robust initialization):\
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5
    },
    GAME: {
        GRAVITY: 9.81, // Default gravity value to fix the warning and enable physics
    },
    // NEW BLOCK: Custom Asset Paths
    ASSETS: {
        // UPDATED: Now points to the top-level assets folder as requested
        BASE_PATH: "/hosg/assets/", 
        
        CHARACTERS: {
            knight: { 
                model: 'Knight03.glb',
                // CUSTOM PATH
                path: '/hosg/assets/player/character/' 
            },
            wolf: {
                model: 'Wolf.glb',
                // EXPLICIT PATH: Overrides BASE_PATH to point to /models/
                path: '/hosg/assets/models/'
            }
        },
        ENVIRONMENT: {
            terrain_base: { 
                model: 'TerrainBase.glb',
                // EXPLICIT PATH: Overrides BASE_PATH
                path: 'hosg/assets/textures/ground/grass
/Grass004_2K-JPG_AmbientOcclusion.jpg'
            },
            tree_pine: { 
                model: 'TreePine.glb',
                // EXPLICIT PATH: Overrides BASE_PATH
                path: '/hosg/assets/models/'
            },
            grass_tuft: { 
                model: 'GrassTuft.glb',
                // EXPLICIT PATH: Overrides BASE_PATH
                path: '/hosg/assets/models/'
            }
        }
    },
    // === PATCH END ===
    
    WORLD: {
        MAX_NPCS: 50,
        CHUNK_SIZE: 16
    },
    NETWORK: {
        // Placeholder for future network config
        HOST: 'localhost',
        PORT: 8080
    },
    COMBAT: {
        RANGE_MELEE: 2,
        ATTACK_COOLDOWN_MELEE: 1.0
    },

    // === CHARACTER CLASSES AND BASE STATS ===
    CLASSES: {
        Fighter: { 
            model: 'knight', 
            stats: { 
                maxHealth: 120, maxMana: 30, maxStamina: 100, 
                attackPower: 15, magicPower: 5, moveSpeed: 0.15 
            }, 
            defaultAbility: 'Basic Attack' // Ability name for the action bar
        },
        Rogue: { 
            model: 'knight', 
            stats: { 
                maxHealth: 80, maxMana: 0, maxStamina: 120, 
                attackPower: 14, magicPower: 8, moveSpeed: 0.16 
            }, 
            defaultAbility: 'Backstab' 
        },
        Mage: { 
            model: 'knight',
            stats: { 
                maxHealth: 70, maxMana: 150, maxStamina: 80, 
                attackPower: 5, magicPower: 20, moveSpeed: 0.14 
            }, 
            defaultAbility: 'Fireball' 
        },
        Cleric: { 
            model: 'knight',\
            stats: { 
                maxHealth: 100, maxMana: 100, maxStamina: 90, 
                attackPower: 10, magicPower: 12, moveSpeed: 0.15 
            }, 
            defaultAbility: 'Heal'
        },
        Ranger: { 
            model: 'knight',
            stats: { 
                maxHealth: 90, maxMana: 50, maxStamina: 110, 
                attackPower: 14, magicPower: 8, moveSpeed: 0.16 
            }, 
            defaultAbility: 'Aimed Shot'
        },
        Warlock: { 
            model: 'knight',
            stats: { 
                maxHealth: 85, maxMana: 130, maxStamina: 85, 
                attackPower: 8, magicPower: 18, moveSpeed: 0.14 
            }, 
            defaultAbility: 'Shadow Bolt'
        },
        Monk: { 
            model: 'knight',
            stats: { 
                maxHealth: 110, maxMana: 50, maxStamina: 130, 
                attackPower: 12, magicPower: 8, moveSpeed: 0.17 
            }, 
            defaultAbility: 'Flurry'
        }
    }
};

// Ensure CONFIG is globally accessible
window.CONFIG = CONFIG;
