// config.js - Core game configuration
const CONFIG = {
    // Core settings
    DEBUG: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    VERSION: '1.1.1',
    TICK_RATE: 60,
    MAX_PLAYERS: 100,
    
    // Network settings
    NETWORK: {
        ENABLED: true,
        SERVER_URL: 'wss://hosg.onrender.com',
        RECONNECT_DELAY: 3000,
        MAX_RECONNECT_ATTEMPTS: 5,
        PORT: 10000,
        HOST: '0.0.0.0'
    },

    // Player settings
    PLAYER: {
        START_HEALTH: 100,
        START_MANA: 50,
        MOVEMENT_SPEED: 10.0,
        RUN_MULTIPLIER: 1.8,
        JUMP_FORCE: 5.0,
        GRAVITY: -9.81
    },

    // World settings
    WORLD: {
        GRAVITY: { x: 0, y: -9.81, z: 0 },
        CHUNK_SIZE: 32,
        VIEW_DISTANCE: 3,
        TERRAIN: {
            WIDTH: 200,
            HEIGHT: 200,
            SUBDIVISIONS: 100
        }
    },

    // Graphics settings
    GRAPHICS: {
        SHADOWS: {
            ENABLED: true,
            SIZE: 1024,
            BLUR_KERNEL: 32
        },
        LIGHTING: {
            SUN_INTENSITY: 0.9,
            AMBIENT_INTENSITY: 0.6,
            SUN_DIRECTION: { x: -1, y: -2, z: -1 }
        },
        POST_PROCESSING: {
            ENABLED: true,
            BLOOM: true,
            SSAO: true,
            FXAA: true
        }
    }
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
