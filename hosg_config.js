// ============================================================
// HEROES OF SHADY GROVE - CONFIGURATION
// Update these with your actual Supabase credentials
// ============================================================

// SUPABASE CONFIGURATION
// Get these from: https://app.supabase.com/project/_/settings/api
const HOSG_CONFIG = {
  supabase: {
    url: 'YOUR_SUPABASE_URL_HERE',           // e.g., 'https://xxxxx.supabase.co'
    anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE'   // Your public anon key
  },

  multiplayer: {
    serverUrl: 'wss://your-server.onrender.com',  // Your WebSocket server URL
    enabled: true,
    reconnectDelay: 3000
  },

  game: {
    version: '2.0.0',
    startingZone: 'zone_5_5',        // Shady Grove starting zone
    maxLevel: 100,
    saveInterval: 30000,             // 30 seconds
    networkSyncInterval: 100         // 100ms
  }
};

// ------------------------------------------------------------
// Bridge HOSG_CONFIG into global window config for index.html
// index.html reads window.HOSG_SUPABASE_URL / ANON_KEY and
// then creates the Supabase client via hosgEnsureSupabase().
// ------------------------------------------------------------
if (typeof window !== 'undefined') {
  // Only set these if they aren't already set elsewhere
  if (!window.HOSG_SUPABASE_URL &&
      HOSG_CONFIG.supabase.url &&
      HOSG_CONFIG.supabase.url !== 'YOUR_SUPABASE_URL_HERE') {
    window.HOSG_SUPABASE_URL = HOSG_CONFIG.supabase.url;
  }

  if (!window.HOSG_SUPABASE_ANON_KEY &&
      HOSG_CONFIG.supabase.anonKey &&
      HOSG_CONFIG.supabase.anonKey !== 'YOUR_SUPABASE_ANON_KEY_HERE') {
    window.HOSG_SUPABASE_ANON_KEY = HOSG_CONFIG.supabase.anonKey;
  }
}

// Basic logging so you can see config status in the console
if (HOSG_CONFIG.supabase.url &&
    HOSG_CONFIG.supabase.url !== 'YOUR_SUPABASE_URL_HERE') {
  console.log('[Config] Supabase credentials configured via HOSG_CONFIG');
} else {
  console.warn('[Config] Supabase not configured! Update hosg_config.js with your credentials');
  console.warn('[Config] Get credentials from: https://app.supabase.com/project/_/settings/api');
}

console.log('[Config] HOSG Configuration loaded v' + HOSG_CONFIG.game.version);
