// config.js - Enhanced with new features
const CONFIG = {
    // Core settings
    DEBUG: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    VERSION: '1.2.0',
    TICK_RATE: 60,
    MAX_PLAYERS: 100,
    
    // Weather system
    WEATHER: {
        CYCLE_DURATION: 300, // seconds
        DAY_LENGTH: 120, // seconds
        NIGHT_LENGTH: 60, // seconds
        WEATHER_TYPES: ['clear', 'rain', 'snow'],
        CURRENT_WEATHER: 'clear',
        TRANSITION_SPEED: 0.01
    },

    // World settings
    WORLD: {
        GRAVITY: { x: 0, -9.81, z: 0 },
        CHUNK_SIZE: 32,
        VIEW_DISTANCE: 3,
        TERRAIN: {
            WIDTH: 200,
            HEIGHT: 200,
            SUBDIVISIONS: 100
        },
        // New: Time of day (0-1, where 0 is midnight, 0.5 is noon)
        TIME_OF_DAY: 0.25, // Start at dawn
        TIME_SPEED: 0.0001, // Speed of time progression
        // New: Weather particles
        MAX_RAIN_PARTICLES: 5000,
        MAX_SNOW_PARTICLES: 10000
    },

    // Player settings
    PLAYER: {
        START_HEALTH: 100,
        START_MANA: 50,
        MOVEMENT_SPEED: 10.0,
        RUN_MULTIPLIER: 1.8,
        JUMP_FORCE: 5.0,
        GRAVITY: -9.81,
        INVENTORY_SIZE: 20
    },

    // Graphics settings
    GRAPHICS: {
        SHADOWS: {
            ENABLED: true,
            SIZE: 1024,
            BLUR_KERNEL: 32
        },
        LIGHTING: {
            SUN_INTENSITY: 1.0,
            AMBIENT_INTENSITY: 0.6,
            SUN_DIRECTION: { x: -1, y: -1, z: -1 }
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
        EFFECTS_VOLUME: 0.7,
        // Procedural sound parameters
        WIND_SPEED: 0.5,
        RAIN_INTENSITY: 0,
        SNOW_INTENSITY: 0
    }
};

// Make CONFIG globally available
window.CONFIG = CONFIG;
