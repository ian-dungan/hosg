// Core configuration and shared helpers

const CONFIG = {
  VERSION: "1.0.0",
  DEBUG: true,

  GAME: {
    FPS: 60,
    GRAVITY: 9.81,
    PHYSICS_ENGINE: "cannon"
  },

  PLAYER: {
    MOVE_SPEED: 0.1,
    RUN_MULTIPLIER: 1.8,
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
    WS_URL: "wss://hosg.onrender.com/",
    MAX_PLAYERS: 100,
    TICK_RATE: 20,
    TIMEOUT: 30000,
    RECONNECT_DELAY_MS: 5000
  },

  SUPABASE: {
    URL: "https://vaxfoafjjybwcxwhicla.supabase.co",
    KEY: "sb_publishable_zFmHKiJYok_bNJSjUL4DOA_h6XCC1YD"
  }
};

function logDebug(...args) {
  if (CONFIG.DEBUG) {
    console.log("[DEBUG]", ...args);
  }
}

window.CONFIG = CONFIG;
window.logDebug = logDebug;
