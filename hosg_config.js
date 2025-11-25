// hosg_config.js - Game Configuration
console.log('[Config] Loading HOSG configuration...');

const HOSG_CONFIG = {
    version: '2.0.0',
    
    // Supabase configuration
    supabase: {
        url: 'YOUR_SUPABASE_URL_HERE', // Replace with your Supabase URL
        anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE' // Replace with your anon key
    },
    
    // Multiplayer configuration
    multiplayer: {
        serverUrl: window.location.hostname === 'localhost' 
            ? 'ws://localhost:8080' 
            : 'wss://your-production-server.com',
        enabled: true,
        reconnectDelay: 3000,
        maxReconnectAttempts: 5
    },
    
    // Game settings
    game: {
        debug: false,
        gravity: -9.81,
        renderScale: 1.0,
        maxFPS: 60,
        minFPS: 30
    },
    
    // Graphics settings
    graphics: {
        shadows: true,
        postProcess: true,
        antiAliasing: true,
        hdEnabled: true
    }
};

// Initialize Supabase
function initSupabase() {
    if (!HOSG_CONFIG.supabase.url || HOSG_CONFIG.supabase.url.includes('YOUR_')) {
        console.warn('[Config] Supabase not configured - running in demo mode');
        return null;
    }

    try {
        const { createClient } = supabase;
        const client = createClient(
            HOSG_CONFIG.supabase.url,
            HOSG_CONFIG.supabase.anonKey
        );
        console.log('[Config] Supabase client initialized');
        return client;
    } catch (error) {
        console.error('[Config] Error initializing Supabase:', error);
        return null;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Supabase if available
    if (typeof supabase !== 'undefined') {
        window.supabase = initSupabase();
    } else {
        console.warn('[Config] Supabase JS client not loaded');
    }
    
    console.log(`[Config] HOSG Configuration loaded v${HOSG_CONFIG.version}`);
});

// Export configuration
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HOSG_CONFIG, initSupabase };
}
