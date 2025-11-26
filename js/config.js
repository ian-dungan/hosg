// config.js - Core game configuration
const CONFIG = {
    // Core settings
    DEBUG: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    VERSION: '1.0.0',
    TICK_RATE: 60,
    MAX_PLAYERS: 100,
    
    // Network settings
    NETWORK: {
        ENABLED: true,  // Make sure networking is enabled
        SERVER_URL: 'wss://hosg.onrender.com',  // Your Render WebSocket server
        RECONNECT_DELAY: 3000,
        MAX_RECONNECT_ATTEMPTS: 5,
        PORT: 10000,  // Default WebSocket port for Render
        HOST: '0.0.0.0'
    },

    // Player settings
    PLAYER: {
        START_HEALTH: 100,
        START_MANA: 50,
        MOVEMENT_SPEED: 5.0,
        RUN_MULTIPLIER: 1.5,
        JUMP_FORCE: 5.0,
        GRAVITY: -9.81
    },

    // World settings
    WORLD: {
        GRAVITY: { x: 0, y: -9.81, z: 0 },
        CHUNK_SIZE: 32,
        VIEW_DISTANCE: 3
    },

    // Graphics settings
    GRAPHICS: {
        SHADOWS: {
            ENABLED: true,
            SIZE: 2048
        },
        POST_PROCESSING: {
            BLOOM: true,
            SSAO: true,
            FXAA: true
        }
    }
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
