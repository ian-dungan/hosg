// Global configuration shared across the game.
// Keeping this isolated prevents duplicate class definitions when other modules
// (game.js, world.js, player.js, etc.) are loaded.
const CONFIG = {
  VERSION: '1.0.0',
  DEBUG: true,
  GAME: { FPS: 60, GRAVITY: 9.81, PHYSICS_ENGINE: 'cannon' },
  PLAYER: {
    MOVE_SPEED: 0.1,
    RUN_MULTIPLIER: 1.8,
    JUMP_FORCE: 0.2,
    HEALTH: 100,
    STAMINA: 100,
    INVENTORY_SIZE: 20
  },
  WORLD: { SIZE: 1000, CHUNK_SIZE: 32, TERRAIN_SIZE: 1024, WATER_LEVEL: 0 },
  NETWORK: {
    MAX_PLAYERS: 100,
    TICK_RATE: 20,
    TIMEOUT: 30000,
    WS_URL: null,
    RECONNECT_DELAY_MS: 5000
  }
};
