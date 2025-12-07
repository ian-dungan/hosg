// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION v1.0.9 (PATCHED)
// Fix: Added missing CONFIG.COMBAT block to prevent TypeError in player.js
// ============================================================

const CONFIG = {
    VERSION: '1.0.9',
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
    
    // --- NEW COMBAT CONFIGURATION ---
    COMBAT: {
        BASE_ATTACK_RANGE: 3.5, // Standard attack range in Babylon units (meters)
        GLOBAL_COOLDOWN_MS: 500, // 0.5 seconds global cooldown after ability use
        AUTO_ATTACK_INTERVAL_MS: 1500 // Time between automatic attacks
    },
    
    WORLD: {
        SIZE: 1000,
        CHUNK_SIZE: 32,
        TERRAIN_SIZE: 1024,
        WATER_LEVEL: 0
    },
    
    NETWORK: {
        WS_URL: 'wss://hosg.onrender.com',
        MAX_PLAYERS: 1
    }
};
