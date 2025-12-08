// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.26 (WORLD RESTORED)
// Fix: Ensured all asset paths are relative to the index.html file.
// Fix: Added missing MOVE_SPEED to PLAYER config.
// New: Activated SKYBOX and added WOLF spawn zone.
// ============================================================

const CONFIG = {
    PLAYER: {
        INVENTORY_SIZE: 30, 
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5,
        MOVE_SPEED: 0.15 // Player base movement speed
    },
    GAME: {
        GRAVITY: 9.81, 
    },
    WORLD: { 
        SKYBOX: {
            // SETTING THIS PATH ACTIVATES THE SKYBOX 
            PATH: "assets/environment/skybox/shadygrove_sky_specular.dds", 
            SIZE: 512,
            EXPOSURE: 0.6,
            CONTRAST: 1.2,
            LEVEL: 0.5
        },
        SPAWNS: [
            // Wolf Spawn Zone
            {
                id: 1,
                name: "Wolf Den",
                npc_template_id: "Wolf", // Matches the template in network.js
                position_x: 20,
                position_y: 0,
                position_z: 20,
                spawn_radius: 50,
                max_spawn: 5, // Maximum 5 wolves at once
                respawn_delay_ms: 5000 
            }
        ]
    },
    ASSETS: {
        // Use relative path "assets/"
        BASE_PATH: "assets/", 
        
        CHARACTERS: {
            knight: {
                model: 'knight03.glb',
                // Use relative path to the repository root
                path: 'assets/player/character/'
            },
            wolf: {
                model: 'wolf.glb',
                // Use relative path to the repository root
                path: 'assets/enemies/'
            }
        },
        ENVIRONMENT: {
            terrain_base: { 
                model: 'terrain_base.glb', // Model for the grass terrain
                path: 'assets/environment/' 
            }
        }
    },
    COMBAT: {
        RANGE_MELEE: 2,
        RANGE_RANGED: 15,
        ATTACK_COOLDOWN_MELEE: 1,
        ATTACK_COOLDOWN_RANGED: 1.5,
    },
    CLASSES: { 
        Warrior: { 
            model: 'knight', // Asset key name
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
};
