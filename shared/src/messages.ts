// Message shapes between client and server, keyed by message type, and the reasons the server
// gives when it refuses a join or ends a session (the client recognises them by exact text).
import type { AbilityId } from './combat/abilities';
import type { Displacement } from './combat/displace';
import type { Refusal, SelfView } from './combat/engine';
import type { EnemyKindId } from './combat/enemies';
import type { FxEvent } from './combat/fx';
import type { Pose } from './movement';
import type { ZoneId } from './world/zones';

/** A join refused because the account's adventurer has no name yet. */
export const REASON_NAME_FIRST = 'Name your adventurer first';
/** A session ended because the same account joined from somewhere else. */
export const REASON_SIGNED_IN_ELSEWHERE = 'Signed in somewhere else';
/** A join refused because the grove holds MAX_PLAYERS adventurers. */
export const REASON_GROVE_FULL = 'Shady Grove is full, try again soon';
/**
 * A join refused because the adventurer is saved in another zone: the client asks GET /api/zone
 * where it is and joins that zone's room instead.
 */
export const REASON_ELSEWHERE = 'Your adventurer is somewhere else';
/** Travel through an open exit that could not be saved (the adventurer stays where it was). */
export const REASON_TRAVEL_FAILED = 'The way is blocked for now, try again soon';

/** Client → server. */
export type C2S = {
  move: Pose;
  chat: { text: string };
  /** Target an enemy by engine id, or clear the target (null). */
  target: { id: number | null };
  /** An ability slot (0..4: quick, finisher, signature, free, free): press, or release (Charged Shot). */
  ability: { slot: number; phase: 'press' | 'release' };
  /** Blade ⇄ Bow (only out of combat). */
  swap: Record<string, never>;
  /**
   * A dodge roll: the pose it starts from (checked like a move) and a direction. Its ack must be the
   * latest displacement's seq, or the one before while the latest displacement was this client's own
   * dodge (a predicted double roll). A dodge arriving up to 0.15 s before its minimum gap or its next
   * charge is held and rolled then (never closer than 0.4 s to the last roll); a held dodge is
   * dropped silently by a knock or a death (the client rolls back from `displaced` or the death).
   * Any refused dodge means: back to the pose it was sent from (then any `correct`, as always).
   */
  dodge: Pose & { dx: number; dz: number };
  /** The two free picks (only out of combat). */
  loadout: { free: [AbilityId, AbilityId] };
  /** Get up again after dying (from DEATH_MIN_S on). */
  respawn: Record<string, never>;
};

/** What a refused intent was. */
export type IntentAction = 'target' | 'ability' | 'swap' | 'dodge' | 'loadout' | 'respawn';

/** Server → client. */
export type S2C = {
  chat: { from: string; text: string };
  /** The move was refused: go back to the last accepted pose. */
  correct: { x: number; z: number; y: number };
  /** Health lost (already taken off the adventurer's hp). */
  hurt: { amount: number; cause: 'fall' };
  kicked: { reason: string };
  /**
   * The adventurer walked through an open exit and is now saved in `zone`, at that exit's arrival
   * point. The server ends this session (consented) right after: the client joins the room named `zone`.
   */
  travel: { zone: ZoneId };
  /** A short line to show the player (for example why an exit refused them). */
  notice: { text: string };
  /** Combat events near this adventurer (or involving it), once per tick, only when there are any. */
  fx: { events: FxEvent[] };
  /**
   * The server moved this adventurer (a dodge it asked for, or a knockback): it is at `to` now. From
   * now on every pose the client sends carries `ack: seq`; poses with an older ack are ignored.
   */
  /**
   * kind 'resync': no movement of its own; the server lost track of a displacement the client is
   * waiting for and puts it at its own position (from = to) with a new seq.
   */
  displaced: { seq: number; kind: 'dodge' | 'knock' | 'resync'; from: { x: number; z: number; y: number }; d: Displacement; to: { x: number; z: number; y: number } };
  /**
   * An intent the server refused. For a dodge: 'stale' alone for a bad ack; `correct` then 'stale'
   * when its pose was refused; 'cooldown' or 'charges' alone when it came too early to be held (its
   * pose not taken); and a refusal from the engine after its pose was taken (busy, air, ...) is
   * followed by a `correct` to that pose. 'rate': more intents than the intent budget (20 a second,
   * bursts of 30).
   */
  refused: { action: IntentAction; reason: Refusal | 'stale' | 'rate' };
  /** The adventurer's own combat numbers, at most 5 times a second, only when they changed. */
  self: SelfView;
  /** This adventurer shares the kill of an enemy of this kind. */
  credit: { kind: EnemyKindId };
  /**
   * Revived in this room at the statue, at full health. Like a displacement it starts a new ack:
   * poses from now on carry `ack: seq`.
   */
  respawned: { x: number; z: number; y: number; seq: number };
};
