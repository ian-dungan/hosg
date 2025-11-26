// config.js - Core game configuration
const CONFIG = {
    // Core settings
    DEBUG: false,
    VERSION: '1.0.0',
    TICK_RATE: 60,
    MAX_PLAYERS: 100,
    
    // Network settings
    NETWORK: {
        SERVER_URL: 'ws://localhost:3000',
        RECONNECT_DELAY: 3000,
        MAX_RECONNECT_ATTEMPTS: 5
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

// Export for both browser and Node.js
try { module.exports = CONFIG; } catch (e) { window.CONFIG = CONFIG; }