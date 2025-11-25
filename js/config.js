// Game Configuration
const CONFIG = {
    // Debug mode
    DEBUG: false,
    
    // Game settings
    VERSION: '1.0.0',
    TICK_RATE: 60,
    MAX_PLAYERS: 100,
    
    // Player settings
    PLAYER: {
        START_HEALTH: 100,
        START_MANA: 50,
        START_LEVEL: 1,
        MOVEMENT_SPEED: 0.2,
        ROTATION_SPEED: 0.01,
        JUMP_FORCE: 0.5
    },
    
    // World settings
    WORLD: {
        GRAVITY: { x: 0, y: -9.81, z: 0 },
        CHUNK_SIZE: 32,
        VIEW_DISTANCE: 3
    },
    
    // Network settings
    NETWORK: {
        RECONNECT_DELAY: 3000,
        MAX_RECONNECT_ATTEMPTS: 5,
        SYNC_RATE: 100 // ms
    },
    
    // Asset paths
    ASSETS: {
        MODELS: 'assets/models/',
        TEXTURES: 'assets/textures/',
        AUDIO: 'assets/audio/',
        UI: 'assets/ui/'
    }
};

// Initialize Supabase
let supabase = null;
if (typeof supabase !== 'undefined') {
    supabase = window.supabase.createClient(
        'YOUR_SUPABASE_URL',
        'YOUR_SUPABASE_ANON_KEY'
    );
}

// Game state
const GameState = {
    MENU: 'menu',
    PLAYING: 'playing',
    PAUSED: 'paused',
    GAME_OVER: 'game_over'
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CONFIG, GameState, supabase };
}
