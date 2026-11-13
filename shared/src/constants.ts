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
 * How long a zone room keeps a seat reserved by matchmaking for the socket that should take it (s). A
 * client opens its socket right after the matchmake answer; an account has at most one such seat
 * pending at a time (a flood of matchmake calls cannot hold a zone's seats). 15 s, the client's own join
 * timeout: with 5 s a busy page (a slow phone building its zone) missed its seat three times in a row
 * ("seat reservation expired", then "Cannot reach the server") in the live smoke tests.
 */
export const SEAT_RESERVATION_S = 15;
/** Matchmake calls (joins, including travels) per address a minute by default (SG2_JOIN_RATE_PER_MIN). */
export const JOIN_RATE_PER_MIN = 600;
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
