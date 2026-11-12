// Message shapes between client and server, keyed by message type, and the reasons the server
// gives when it refuses a join or ends a session (the client recognises them by exact text).
import type { AbilityId } from './combat/abilities';
import type { JobId } from './combat/jobs';
import type { Displacement } from './combat/displace';
import type { Refusal, SelfView } from './combat/engine';
import type { EnemyKindId } from './combat/enemies';
import type { FxEvent } from './combat/fx';
import type { InstanceView, VictoryView } from './instance';
import type { PartyOp, PartyRefusal, PartyView } from './party';
import type { Pose } from './movement';
import type { ZoneId } from './world/zones';

/** Why a job change is refused where the zone allows none (`refused { action: 'job', reason: 'not-here' }`). */
export { REASON_JOB_NOT_HERE } from './world/zones';

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
/** Walking into the crater mouth mid-fight (corrected, with this notice). */
export const REASON_IN_COMBAT = 'Finish the fight before you climb down into the Lampfall';
/** Travel through an open exit that could not be saved (the adventurer stays where it was). */
export const REASON_TRAVEL_FAILED = 'The way is blocked for now, try again soon';

/** One member's changed numbers in `partyStatus` (see there). */
export interface PartyStatusLine { i: number; hp?: number; maxHp?: number; dead?: boolean; searing?: number; job?: JobId; level?: number }

/** Client → server. */
export type C2S = {
  move: Pose;
  /** channel 'party': to every online member of the sender's party, in any room (absent: 'zone'). */
  chat: { text: string; channel?: 'zone' | 'party' };
  /** Target an enemy by engine id, or clear the target (null). */
  target: { id: number | null };
  /**
   * An ability slot of the current job (0..4: quick, finisher, signature, pick, pick): press, or
   * release (Charged Shot). ally: the engine id of the adventurer an ally-aimed ability should land on
   * (an integer; else the aim rule picks one). The server checks the slot against the current job.
   */
  ability: { slot: number; phase: 'press' | 'release'; ally?: number };
  /**
   * @deprecated Plan 3's weapon swap: gone (the weapon is the job's). Kept only so the Plan 3 client
   * builds until Task 7; the server ignores it silently.
   */
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
  /**
   * The current job's two picks (two distinct ids of its pool), anywhere out of combat. The `free`
   * shape is Plan 3's, deprecated: kept only so the Plan 3 client builds until Task 7; the server drops it.
   */
  loadout: { picks: [AbilityId, AbilityId] } | { free: [AbilityId, AbilityId] };
  /**
   * Change job: only where the zone allows it (a town, a sanctuary), out of combat, alive, not
   * displaced, casting or charging. The job's own saved picks come with it; Momentum resets to 0.
   */
  job: { job: JobId };
  /** Get up again after dying (from DEATH_MIN_S on). */
  respawn: Record<string, never>;
  /** A party request (`parsePartyOp` checks it; anything else is dropped). */
  party: PartyOp;
  /** Dead in an instance: get up at its current checkpoint (from RELEASE_MIN_S on). */
  release: Record<string, never>;
  /** Leave the Lampfall for the crater mouth (the victory screen's button). */
  leaveInstance: Record<string, never>;
};

/** What a refused intent was. */
export type IntentAction = 'target' | 'ability' | 'dodge' | 'loadout' | 'job' | 'respawn';

/** One job's progress and picks as the owner sees them (level from xp; next = xp still needed, 0 at the cap). */
export interface JobView { level: number; xp: number; next: number; picks: [AbilityId, AbilityId] }
/** The owner's jobs: the current one, and every starting job (one never played shows level 1 with its solo picks). */
export interface JobsView { current: JobId; jobs: Record<JobId, JobView> }

/** Server → client. */
export type S2C = {
  /** channel: where the line was said (absent: 'zone', as before Plan 4). */
  chat: { from: string; text: string; channel?: 'zone' | 'party' };
  /** The move was refused: go back to the last accepted pose. */
  correct: { x: number; z: number; y: number };
  /** Health lost (already taken off the adventurer's hp). */
  hurt: { amount: number; cause: 'fall' };
  kicked: { reason: string };
  /**
   * The adventurer walked through an open exit and is now saved in `zone`, at that exit's arrival
   * point. The server ends this session (consented) right after: the client joins the room named `zone`,
   * or with `instance`, the room with that id (a Lampfall instance) by id.
   */
  travel: { zone: ZoneId; instance?: string };
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
  /**
   * The adventurer's own combat numbers, at most 5 times a second, only when they changed: with its job,
   * dodgeMax and cast (cast.left and timers rounded to 0.01 s). swapCd and swapLock are always 0
   * (deprecated: they stay only while the engine's SelfView has them, until Task 7).
   */
  self: SelfView;
  /** This adventurer shares the kill of an enemy of this kind. */
  credit: { kind: EnemyKindId };
  /** The owner's jobs: a step after joining (or reconnecting), and after a job or picks change or xp. */
  jobs: JobsView;
  /** Xp a kill gave the current job (0 for the Training Dummy), sent with every `credit`. */
  jobXp: { job: JobId; gained: number; xp: number; level: number; levelUp: boolean };
  /**
   * Revived where it lay (Second Dawn), with `hp`, by the adventurer with engine id `by`. Unlike
   * `respawned` it starts no new ack and moves nothing: poses carry the same ack as before the death.
   */
  revived: { hp: number; by: number };
  /**
   * Revived in this room at the statue, at full health. Like a displacement it starts a new ack:
   * poses from now on carry `ack: seq`.
   */
  respawned: { x: number; z: number; y: number; seq: number };
  /** The receiver's party (null: none), after any change, and at most PARTY_STATUS_HZ for member status. */
  party: { party: PartyView | null };
  /**
   * Members whose numbers changed since the receiver last heard (at most PARTY_STATUS_HZ): `i` is the
   * member's index in the last `party` view; only the changed fields are present. A change of members,
   * leader, online flag, zone or eid comes as a whole `party` view instead.
   */
  partyStatus: { m: PartyStatusLine[] };
  /** An invite to join party `partyId`, from its leader `from`; size: its members now. */
  partyInvite: { partyId: string; from: string; size: number };
  /** A party request the server refused (text: PARTY_TEXT[reason]). */
  partyRefused: { reason: PartyRefusal; text: string };
  /** The instance this adventurer is in: on join and when it changes. */
  instance: InstanceView;
  /** A boss kill this adventurer is credited with. */
  victory: VictoryView;
};
