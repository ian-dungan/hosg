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
        TERRAIN_SIZE: 256,  // Reduced from 1024 for faster loading (256x256 = 65k vertices vs 1M)
        WATER_LEVEL: 0,
        SEED: 12345,  // Fixed seed for consistent terrain (change this for different landscapes)
        
        // Skybox configuration
        SKYBOX: {
            ENABLED: true,
            TEXTURE_KEY: 'sky_hdri', // References ASSET_PATHS.TEXTURES
            SIZE: 1000,
            EXPOSURE: 0.8,
            CONTRAST: 1.2
        },
        
        // Ground configuration  
        GROUND: {
            TEXTURE_KEY: 'grass', // References ASSET_PATHS.TEXTURES
            TILE_SCALE: 50 // How many times to tile the texture
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
