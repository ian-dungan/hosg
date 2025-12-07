// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.8
// Core configuration constants (Patched with Mana/Combat)
// ============================================================

const CONFIG = {
    VERSION: '1.0.8',
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
        MANA: 50, // Added Mana
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
        WATER_LEVEL: 0
    },
    
    NETWORK: {
        WS_URL: 'wss://hosg.onrender.com',
        MAX_PLAYERS: 100,
        TICK_RATE: 20
    },

    // ======== NEW COMBAT CONSTANTS ========
    COMBAT: {
        GLOBAL_COOLDOWN: 0.5, // 0.5 seconds GCD
        BASE_MELEE_DAMAGE: 5,
        BASE_ATTACK_RANGE: 2.5,
        BASE_CAST_RANGE: 15
    }
};
