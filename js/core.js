// ====================== CONFIGURATION ======================
// Heroes of Shady Grove v1.0.7
// Core configuration settings

const CONFIG = {
    VERSION: '1.0.7',
    DEBUG: true,
    
    GAME: {
        FPS: 60,
        GRAVITY: 9.81,
        PHYSICS_ENGINE: 'cannon'
    },
    
    PLAYER: {
        MOVE_SPEED: 0.15,        // v1.0.7: Increased from 0.1 for better responsiveness
        RUN_MULTIPLIER: 2.0,     // 2x speed when running
        JUMP_FORCE: 0.2,
        HEALTH: 100,
        STAMINA: 100,
        INVENTORY_SIZE: 20
    },
    
    WORLD: {
        SIZE: 1000,
        CHUNK_SIZE: 32,
        TERRAIN_SIZE: 1024,
        WATER_LEVEL: 0
    },
    
    NETWORK: {
        // Use Render deployment URL or localhost for development
        WS_URL: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            ? 'ws://localhost:8080'
            : 'wss://hosg.onrender.com',
        MAX_PLAYERS: 100,
        TICK_RATE: 20,
        TIMEOUT: 30000,
        RECONNECT_DELAY_MS: 5000
    },
    
    SUPABASE: {
        url: 'https://vaxfoafjjybwcxwhicla.supabase.co',
        key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZheGZvYWZqanlid2N4d2hpY2xhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzI1NjA3NzgsImV4cCI6MjA0ODEzNjc3OH0.rLu2rRxe1rWHxn-PiR_w7xd1mhwf0y5YBWnCXFx5y7M'
    }
};

window.CONFIG = CONFIG;
