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
/** Downward acceleration in m/s². */
export const GRAVITY = 22;
/** Upward speed a jump starts with, in m/s (apex ≈ JUMP_SPEED² / 2·GRAVITY ≈ 1.45 m). */
export const JUMP_SPEED = 8;
/** Highest rise an adventurer walks up without jumping, in m. */
export const STEP_UP = 0.35;
/** Longest fall that does no damage, in m. */
export const SAFE_FALL = 3;
/** Health lost per metre fallen beyond SAFE_FALL. */
export const FALL_DAMAGE_PER_M = 10;
/** Full health. */
export const MAX_HP = 100;
/** Health regained per second once regeneration starts. */
export const HP_REGEN_PER_S = 2;
/** Seconds after taking damage before health starts to regenerate. */
export const HP_REGEN_DELAY_S = 6;
