// HEROES OF SHADY GROVE - CONFIGURATION
const HOSG_CONFIG = {
  supabase: {
    url: 'YOUR_SUPABASE_URL_HERE',
    anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE'
  },
  
  multiplayer: {
    serverUrl: 'wss://your-server.onrender.com',
    enabled: true,
    reconnectDelay: 3000
  },
  
  game: {
    version: '2.0.0',
    startingZone: 'zone_5_5',
    maxLevel: 100,
    saveInterval: 30000,
    networkSyncInterval: 100
  }
};

let hosgSupabase = null;

if (HOSG_CONFIG.supabase.url && HOSG_CONFIG.supabase.url !== 'YOUR_SUPABASE_URL_HERE') {
  hosgSupabase = supabase.createClient(
    HOSG_CONFIG.supabase.url,
    HOSG_CONFIG.supabase.anonKey
  );
  console.log('[Config] Supabase client initialized');
} else {
  console.warn('[Config] Supabase not configured - running in demo mode');
}

console.log('[Config] HOSG Configuration loaded v' + HOSG_CONFIG.game.version);
