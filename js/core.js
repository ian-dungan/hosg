// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.20 (PATCHED)
// Update: Added SKYBOX configuration to CONFIG.WORLD.
// ============================================================

const CONFIG = {
    // === PATCH START: ADDING MISSING BLOCKS ===
    PLAYER: {
        INVENTORY_SIZE: 30, // Default value to fix the critical crash in item.js
        // Placeholder values matching fallbacks in player.js (for robust initialization):
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5
    },
    GAME: {
        GRAVITY: 9.81, // Default gravity value to fix the warning and enable physics
    },
    // === PATCH END ===
    
    // ... (existing NETWORK, COMBAT blocks remain the same)

    WORLD: {
        // === NEW: SKYBOX CONFIGURATION (READ BY world.js) ===
        SKYBOX: {
            // NOTE: Ensure your file is named DaySkyHDRI023B_4K_TONEMAPPED.hdr in your /assets/sky/ folder
            PATH: "/assets/sky/DaySkyHDRI023B_4K_TONEMAPPED.hdr",
            SIZE: 512, // Texture resolution for HDRCubeTexture
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5 // reflection level (hdrTexture.level)
        },
        
        // --- SPAWN AREAS (Kept for completeness) ---
        SPAWN_AREAS: [
            // Your existing spawn area definitions will go here
        ]
    },

    // === NEW: CHARACTER CLASSES AND BASE STATS ===
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
                attackPower: 12, magicPower: 0, moveSpeed: 0.18 
            },
            defaultAbility: 'Stab'
        },
        // ... (rest of classes)
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
        Monk: { 
            model: 'knight',
            stats: { 
                maxHealth: 110, maxMana: 50, maxStamina: 130, 
                attackPower: 12, magicPower: 10, moveSpeed: 0.16 
            },
            defaultAbility: 'Fists of Fury'
        }
    }
};

// Ensure CONFIG is globally accessible
window.CONFIG = CONFIG;
