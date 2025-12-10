// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v2.0.0
// Core configuration constants
// ============================================================

const CONFIG = {
    VERSION: '2.0.0',
    DEBUG: true,
    
    GAME: {
        FPS: 60,
        GRAVITY: 9.81,
        PHYSICS_ENGINE: 'cannon'
    },
    
    PLAYER: {
        MOVE_SPEED: 0.15,
        RUN_MULTIPLIER: 1.8,
        JUMP_FORCE: 0.22,
        HEALTH: 100,
        MANA: 50,
        STAMINA: 100,
        INVENTORY_SIZE: 20,
        SPAWN_HEIGHT: 20,
        
        // Physics settings
        MASS: 15,
        FRICTION: 0.2,
        LINEAR_DAMPING: 0.3,
        ANGULAR_DAMPING: 0.99,
        IMPULSE_STRENGTH: 150,
        MAX_SPEED: 100,
        ROTATION_LERP: 0.2
    },
    
    WORLD: {
        SIZE: 1000,
        CHUNK_SIZE: 32,
        TERRAIN_SIZE: 1024,
        WATER_LEVEL: 0,
        SEED: 12345,  // Fixed seed for consistent terrain (change this for different landscapes)
        
        // Skybox configuration
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
    },
    
    NETWORK: {
        WS_URL: 'wss://hosg.onrender.com',
        MAX_PLAYERS: 100,
        TICK_RATE: 20
    },
    
    SUPABASE: {
        url: 'https://vaxfoafjjybwcxwhicla.supabase.co',
        key: 'sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD'
    }
};

window.CONFIG = CONFIG;
