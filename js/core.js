// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.22 (PATH FIX + .JPG REVERT)
// Fix: Retained /hosg/ path prefix.
// Revert: Skybox path reverted to use the .jpg extension.
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
    
    WORLD: {
        SKYBOX: {
            // CRITICAL FIX: Path includes the /hosg/ subfolder prefix.
            // REVERT: File extension is now .jpg as requested.
            PATH: "/hosg/assets/sky/DaySkyHDRI023B_4K_TONEMAPPED.jpg",
            SIZE: 512,      
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5      
        },
        
        SPAWN_AREAS: [
            // Your existing spawn area definitions will go here
        ]
    },

    CLASSES: {
        Fighter: { 
            model: 'knight', 
            stats: { 
                maxHealth: 120, maxMana: 30, maxStamina: 100, 
                attackPower: 15, magicPower: 5, moveSpeed: 0.15 
            }, 
            defaultAbility: 'Basic Attack' 
        },
        Rogue: { 
            model: 'knight', 
            stats: { 
                maxHealth: 80, maxMana: 0, maxStamina: 120, 
                attackPower: 18, magicPower: 0, moveSpeed: 0.18 
            }, 
            defaultAbility: 'Backstab'
        },
        Wizard: { 
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
        Monk: { 
            model: 'knight',
            stats: { 
                maxHealth: 110, maxMana: 50, maxStamina: 130, 
                attackPower: 12, magicPower: 5, moveSpeed: 0.17 
            }, 
            defaultAbility: 'Fists of Fury'
        },
        Bard: { 
            model: 'knight',
            stats: { 
                maxHealth: 95, maxMana: 90, maxStamina: 95, 
                attackPower: 10, magicPower: 10, moveSpeed: 0.15 
            }, 
            defaultAbility: 'Inspire'
        }
    }
};

window.CONFIG = CONFIG;
