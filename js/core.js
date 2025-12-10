// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.25 (FINAL ASSET PATH + CONFIG FIXES)
// Fix: Ensured all asset paths are relative to the index.html file.
// Fix: Added missing MOVE_SPEED to PLAYER config.
// ============================================================

const CONFIG = {
    PLAYER: {
        INVENTORY_SIZE: 30, 
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        SPAWN_HEIGHT: 5,
        MOVE_SPEED: 0.15 // Added missing config value
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
        SPAWNS: [
            {
                id: 'spawn_wolf_hill',
                npc_template_id: 'wolf',
                position_x: 10,
                position_y: 0,
                position_z: 15,
                spawn_radius: 12,
                max_spawn: 2,
                respawn_time_s: 15
            },
            {
                id: 'spawn_goblin_camp',
                npc_template_id: 'goblin',
                position_x: -12,
                position_y: 0,
                position_z: -8,
                spawn_radius: 10,
                max_spawn: 3,
                respawn_time_s: 12
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
            goblin: {
                model: 'wolf.glb',
                // Placeholder goblin mesh uses the bundled wolf model until a dedicated goblin is added
                path: 'assets/enemies/'
            },
            wolf: {
                model: 'wolf.glb',
                // Use relative path to the repository root
                path: 'assets/enemies/'
            }
        },
        // No environment meshes are currently available in the repository.
        // Keep the object for future expansion but leave it empty to avoid 404s.
        ENVIRONMENT: {},

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
    }
};

window.CONFIG = CONFIG;
