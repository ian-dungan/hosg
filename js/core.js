// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.23 (WORLD CONFIG FIX)
// Fix: Added missing WORLD configuration block.
// ============================================================

const CONFIG = {
    PLAYER: {
        INVENTORY_SIZE: 30, 
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5
    },
    GAME: {
        GRAVITY: 9.81, 
    },
    WORLD: { // <--- NEW: Added missing WORLD config to prevent warnings
        SKYBOX: {
            PATH: null, // Keep null to skip creation by default
            SIZE: 512,
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5
        },
        SPAWNS: [
            // Placeholder for future NPC spawn data
        ]
    },
    ASSETS: {
        // Now points to the top-level assets folder as requested
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
                path: '/hosg/assets/models/'
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
    COMBAT: {
        RANGE_MELEE: 2.0,
        ATTACK_COOLDOWN_MELEE: 1.0, // 1 second
    },
    CLASSES: {
        Warrior: { 
            model: 'knight',
            stats: { 
                maxHealth: 120, maxMana: 30, maxStamina: 120, 
                attackPower: 15, magicPower: 5, moveSpeed: 0.15 
            }, 
            defaultAbility: 'Cleave' 
        },
        Rogue: { 
            model: 'knight',
            stats: { 
                maxHealth: 90, maxMana: 40, maxStamina: 130, 
                attackPower: 12, magicPower: 8, moveSpeed: 0.16 
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
            model: 'knight', 
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
    }
};

window.CONFIG = CONFIG;
