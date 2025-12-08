// ============================================================\
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.24 (ASSET CONFIG FIX)
// Fix: Moved CLASSES config inside ASSETS block to match how it's used in Player.js
// ============================================================\

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
    WORLD: { 
        SKYBOX: {
            PATH: null,
            SIZE: 512,
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5
        },
        SPAWNS: []
    },
    ASSETS: {
        BASE_PATH: "/hosg/assets/", 
        
        CHARACTERS: {
            knight: { 
                model: 'Knight03.glb',
                path: '/hosg/assets/player/character/' 
            },
            wolf: {
                model: 'Wolf.glb',
                path: '/hosg/assets/models/'
            }
        },
        ENVIRONMENT: {
            // ... (rest of environment assets) ...
        },

        // ** CRITICAL FIX: CLASSES MOVED HERE **
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

// Character base class (assuming this is defined here or in a separate file)
class Character extends Entity {
    // ... (rest of Character class definition) ...
    // Assuming Entity is defined in core.js or world.js
}
