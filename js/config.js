// Game configuration
const CONFIG = {
    // Core settings
    DEBUG: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    VERSION: '1.0.0',
    
    // Network settings
    NETWORK: {
        SERVER_URL: 'wss://hosg.onrender.com/',
        RECONNECT_DELAY: 3000,
        MAX_RECONNECT_ATTEMPTS: 5
    },
    
    // Player settings
    PLAYER: {
        MOVE_SPEED: 0.1,
        RUN_MULTIPLIER: 1.8,
        JUMP_FORCE: 0.5,
        HEALTH: 100,
        INVENTORY_SIZE: 20
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
        },
        TIME_OF_DAY: 0.5,
        TIME_SPEED: 0.0001
    },
    
    // Graphics settings
    GRAPHICS: {
        SHADOWS: {
            ENABLED: true,
            SIZE: 2048,
            BLUR_KERNEL: 32
        },
        LIGHTING: {
            SUN_INTENSITY: 1.0,
            AMBIENT_INTENSITY: 0.6
        },
        POST_PROCESSING: {
            ENABLED: true,
            BLOOM: true,
            SSAO: true,
            FXAA: true
        }
    },
    
    // Sound settings
    SOUND: {
        ENABLED: true,
        MUSIC_VOLUME: 0.5,
        EFFECTS_VOLUME: 0.7
    }
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
