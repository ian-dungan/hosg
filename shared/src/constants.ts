// Game-wide numbers both the client and the server rely on.

/** Server state updates per second. */
export const TICK_HZ = 15;
/** Adventurer running speed in m/s (the client rig moves at exactly this speed). */
export const RUN_SPEED = 6;
/** Adventurers in one zone room. */
export const MAX_PLAYERS = 100;
/** How long a dropped adventurer stays in the world while the client reconnects. */
export const RECONNECT_SECONDS = 30;
/**
 * The client's automatic reconnection (the Colyseus SDK's `room.reconnection` settings): retry at
 * once however long the room has been up, at least every 2 s, until RECONNECT_SECONDS runs out
 * (the client gives up then, so the retry count is never the limit).
 */
export const CLIENT_RECONNECTION = { minUptime: 0, maxRetries: 1000, maxDelay: 2000 } as const;
/** How often online adventurers are saved. */
export const SAVE_SECONDS = 60;
/** Longest chat message, in characters. */
export const CHAT_MAX = 200;
/** Minimum time between two chat messages from one adventurer. */
export const CHAT_MIN_INTERVAL_MS = 1000;
/** Where new adventurers appear in the grove (south side of the plaza). */
export const SPAWN = { x: 0, z: -11, facing: 0 } as const;
