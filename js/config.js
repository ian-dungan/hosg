// Game configuration
const CONFIG = {
  // Game settings
  VERSION: "2.0.0",
  DEBUG: window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1",
  
  // Supabase configuration
  SUPABASE_URL: "https://your-supabase-project.supabase.co",
  SUPABASE_KEY: "your-supabase-anon-key",
  
  // Game settings
  TICK_RATE: 30, // Game ticks per second
  CHUNK_SIZE: 32, // Size of world chunks
  RENDER_DISTANCE: 3, // Number of chunks to render in each direction
  
  // Player settings
  PLAYER: {
    MOVE_SPEED: 0.1,
    ROTATION_SPEED: 0.03,
    JUMP_FORCE: 0.5,
    GRAVITY: 0.2,
    COLLISION_EPSILON: 0.01
  },
  
  // Network settings
  NETWORK: {
    RECONNECT_DELAY: 3000,
    MAX_RECONNECT_ATTEMPTS: 5,
    PING_INTERVAL: 10000
  },
  
  // UI settings
  UI: {
    CHAT_MAX_MESSAGES: 100,
    NOTIFICATION_DURATION: 5000
  }
};

// Initialize Supabase client
const supabase = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

// Debug helper
function debugLog(...args) {
  if (CONFIG.DEBUG) {
    console.log("[DEBUG]", ...args);
  }
}

// Export for modules
window.CONFIG = CONFIG;
window.supabase = supabase;
window.debugLog = debugLog;
