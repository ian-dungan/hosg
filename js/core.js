// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.24 (ASSET PATH FIX)
// Fix: Changed all asset paths to be relative to the index.html file to resolve 404 errors.
// ============================================================

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
            PATH: null, // Keep null to skip box mesh skybox creation
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
        // CRITICAL FIX: Use relative path "assets/"
        BASE_PATH: "assets/", 
        
        CHARACTERS: {
            knight: { 
                model: 'Knight03.glb',
                // CRITICAL FIX: Relative path 'assets/player/character/'
                path: 'assets/player/character/' 
            },
            wolf: {
                model: 'Wolf.glb',
                // CRITICAL FIX: Relative path 'assets/models/'
                path: 'assets/models/'
            }
        },
        ENVIRONMENT: {
            terrain_base: { 
                model: 'FantasyTerrain.glb',
                // CRITICAL FIX: Relative path 'assets/environment/'
                path: 'assets/environment/' 
            }
        },

        CLASSES: { 
            Warrior: { 
                model: 'knight',
                stats: { 
                    maxHealth: 120, maxMana: 50, maxStamina: 120, 
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
                    attackPower: 14, magicPower: 8, moveSpeed: 0.15 
                }, 
                defaultAbility: 'Shoot'
            }
        }
    }
};

window.CONFIG = CONFIG;
