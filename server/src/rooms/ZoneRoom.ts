// A zone room (one per zone): validated movement and height, fall damage, periodic saving, reconnect
// window, travel through open exits, one session per account across every room, and the zone's
// fight: the shared combat engine run on the room's tick, fed with validated intents, and mirrored
// to clients (state, per-client fx, `self`), with server-stamped dodges and knockbacks, death and respawn.
// Jobs: each adventurer runs its current job (saved with it); jobs change only where the zone allows
// (a town, a sanctuary), picks anywhere out of combat; kills give the current job xp; a revive
// (Second Dawn) stands the dead up where they lay.
// Each client's state is its own view (interest management): itself, and the adventurers, enemies and
// telegraphs near it (INTEREST_RADIUS, with hysteresis), kept from a spatial grid rebuilt each step;
// `online` is the zone's head count. Chat is zone-wide (or party-wide), and fx follow the views.
// Parties (Plan 4): the process's one registry (Parties) decides membership; each room relays it: party
// requests, invites wherever the invitee is, party chat, the engine's allies (setParty on every way into
// the engine), pinned party members in each view, member status at most PARTY_STATUS_HZ, and kill
// credit shared with party members nearby.
import { randomUUID } from 'node:crypto';
import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import { StateView } from '@colyseus/schema';
import {
  ABILITIES,
  CHAT_MIN_INTERVAL_MS,
  DEATH_MIN_S,
  DISPLACE_FUZZ_M,
  DODGE_CHARGES,
  DODGE_MIN_GAP_S,
  DODGE_REFILL_S,
  INTEREST_MAX_ADVENTURERS,
  JOBS,
  JOB_IDS,
  KILL_XP,
  INTEREST_RANK_HYSTERESIS,
  MAX_HP,
  MAX_MOVE_ALLOWANCE,
  MOMENTUM_DECAY_PER_S,
  PARTY_SHARE_R,
  PARTY_STATUS_HZ,
  PARTY_TEXT,
  parsePartyOp,
  SPAWN,
  REASON_ELSEWHERE,
  REASON_NAME_FIRST,
  REASON_SIGNED_IN_ELSEWHERE,
  REASON_TRAVEL_FAILED,
  STEP_SLACK,
  TICK_HZ,
  checkPose,
  cleanChat,
  fallDamage,
  landAirTrack,
  makeAirTrack,
  parsePose,
  refillAllowance,
  addJobXp,
  createCombat,
  isJobId,
  isJobsSave,
  loadoutOf,
  newJobsSave,
  recordFor,
  worldOf,
  xpToNext,
  zoneFullReason,
  type Carry,
  type Combat,
  type CombatantView,
  type AbilityId,
  type DisplaceOut,
  type EnemyKindId,
  type FxEvent,
  type Intent,
  type IntentAction,
  type JobId,
  type JobsSave,
  type JobsView,
  type Loadout,
  type PartyRefusal,
  type PartyStatusLine,
  type PartyView,
  type Pose,
  type Refusal,
  type S2C,
  type SelfView,
  type TickOut,
  type ZoneDef,
  type ZoneExit,
  type ZoneId,
  AUTO_RELEASE_S,
  BOSSES,
  INSTANCE_EVICT_S,
  INSTANCE_RECONNECT_S,
  MAX_INSTANCES,
  LAMPFALL_MOUTH,
  PARTY_MAX,
  REASON_ARENA_SEALED,
  REASON_IN_COMBAT,
  REASON_INSTANCES_FULL,
  REASON_LEFT_PARTY,
  RELEASE_MIN_S,
  SEAL_DELAY_S,
  WIPE_DELAY_S,
  GATE_PIT,
  GATE_WICK,
  GATE_WICK_EXIT,
  gatedSight,
  gatedSurface,
  lampfallArena,
  lampfallGates,
  lampfallLayout,
  roomSideOf,
  shutGateOnStep,
  yawOf,
  type ArenaEncounter,
  type BossEvent,
  type CampSpawn,
  type CheckpointId,
  type EncounterId,
  type InstanceView,
  type VictoryView,
  EMOTES,
  EMOTE_MIN_S,
  GUILD_BOARD,
  INV_SAVE_TEXT,
  INV_TEXT,
  NO_CREDIT_TEXT,
  PACK_ENCOUNTERS,
  STALL_REACH,
  applyInvOp,
  bagFullText,
  barberCost,
  defaultLook,
  encodeGearLook,
  encodeLook,
  gearItems,
  gearLookOf,
  inventoryView,
  kitFor,
  levelForXp,
  lootTable,
  parseInvOp,
  parseLook,
  purseFullText,
  stallAt,
  type EmoteId,
  type InvCtx,
  type InvOp,
  type InvRefusedReason,
  type Kit,
  type Look,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer'; // (a relog of the dead inside: re-added dead)
import { verifyToken } from '../auth/tokens';
import type { MemberStatus, Parties } from '../party/parties';
import { utcDay, type Adventurer, type AdventurerSave, type Store } from '../store/types';
import { InventoryQueue, TokenBucket, WriteLock, type InvSnapshot, type InvTask, type TaskResult } from './inventoryQueue';
import { applyLoot, clearXp, itemName, killXp, talentRowFor, type LootAward } from './rewards';
import type { InstanceInfo, Instances } from './instances';
import { isGmLine, runGmLine, type GmHost, type GmProcess } from '../gm/commands';
import { applyGrant, grantThing, type GmGrant, type GrantOutcome } from '../gm/grant';
import { Grid, dist2, interested, telegraphInterested } from './interest';
import { PatchRateMeter } from './patchRate';
import type { Allowance, Presence } from './presence';
import { EnemyState as EnemySchema, FieldState as FieldSchema, PlayerState, TelegraphState as TelegraphSchema, ZoneState } from './state';

export interface ZoneRoomOptions {
  store: Store;
  reconnectSeconds: number;
  saveSeconds: number;
  /** Most adventurers in the room (including ones inside their reconnect window, and travellers on their way in). */
  maxPlayers: number;
  /** The zone this room runs: where adventurers can stand (`surface`), its spawn and its exits. */
  zone: ZoneDef;
  /** Which session holds each account, across all rooms (and the accounts' movement allowances). */
  presence: Presence;
  /** The live room of each zone (one per zone): travel looks up the destination here. */
  rooms: Map<ZoneId, ZoneRoom>;
  /** Whether the exits from zone `from` to zone `to` are open now (gates are server state; ZoneExit.open is only the default). */
  isExitOpen: (from: ZoneId, to: ZoneId) => boolean;
  /** Seed of the combat engine's generator. */
  combatSeed: number;
  /**
   * The combat clock, in seconds: monotonic and room-relative (never Date.now). Test-only; by default
   * each room uses performance.now() from its creation.
   */
  combatClock?: () => number;
  /** Seconds after a death before the adventurer gets up by itself (AUTO_RESPAWN_S; shorter in tests). */
  autoRespawnSeconds: number;
  /** Test-only: the wall clock (ms) the movement checks and budgets use (default Date.now). */
  wallClock?: () => number;
  /** Test-only: how long a failed respawn save waits before it is tried again (ms; default 5000). */
  respawnRetryMs?: number;
  /** Test-only: the most other adventurers a view holds, and the rank slack before one leaves. */
  viewCap?: { max: number; slack: number };
  /** The process's party registry, shared by every room. */
  parties: Parties;
  /** The process's Lampfall instances (the Greenway's crater mouth opens them; the party accept checks them). */
  instances?: Instances;
  /** This room is a Lampfall instance (its key is the party's, or 'solo:' + accountId). */
  instance?: { key: string; registry: Instances; parties?: Parties; startAt?: CheckpointId; timings?: Partial<InstanceTimings> };
  /** The process's loot seed (a random 32-bit value made at start, never the engine's): rollLoot's first seed part. */
  serverSeed: number;
  /** Adventurers run their kits (kitFor: level, gear, talents); false (test-only) runs everyone on STARTER_STATS with no mods. */
  kits?: boolean;
  /** Test-only (SG2_TEST_LOOT=always): every credited kill on a row with items drops one. */
  lootAlways?: boolean;
  /** Each inventory write that lands (the app's invWritesPerS). */
  onInvWrite?: () => void;
  /** The process's GM tools (limits, event, announce); absent: /gm lines are ordinary chat for everyone. */
  gm?: GmProcess;
}

/** Operations refused inside a sealed boss arena (ruling P5-h): gear and talents. */
const SEALED_REFUSED: readonly InvOp['op'][] = ['equip', 'unequip', 'talent', 'respec'];
/** Refusals an operation checks once more on a fresh read before giving them (balances and room). */
const RECHECK: readonly string[] = ['gold', 'seals', 'bag-full', 'bank-full', 'purse-full'];
/** Loot writes that fail (the store threw) are tried again this many times, this far apart (ms), then given up (logged). */
const LOOT_TRIES = 3;
const LOOT_RETRY_MS = 500;
/** A stale loot write is re-read and rolled again up to this many times. */
const LOOT_STALE_RETRIES = 5;

/** An instance's timings (s): the Numbers by default, shorter in tests. */
export interface InstanceTimings { reconnectS: number; evictS: number; wipeS: number; releaseMinS: number; autoReleaseS: number; sealS: number }
const INSTANCE_TIMINGS: InstanceTimings = {
  reconnectS: INSTANCE_RECONNECT_S, evictS: INSTANCE_EVICT_S, wipeS: WIPE_DELAY_S, releaseMinS: RELEASE_MIN_S, autoReleaseS: AUTO_RELEASE_S, sealS: SEAL_DELAY_S,
};

/** A GM's kick closes the connection with this code (the client shows the sign-in screen with the reason). */
const GM_KICK_CODE = 4003;
/** The Lampfall's gate bits of each boss room's entry gate. */
const ENTRY_GATE: Record<ArenaEncounter, number> = { wickhound: GATE_WICK, warden: GATE_PIT };
/** A boss kind's encounter and leaderboard id. */
const BOSS_OF: Partial<Record<EnemyKindId, { encounter: ArenaEncounter; boss: 'wickhound' | 'fallen_warden' }>> = {
  wickhound: { encounter: 'wickhound', boss: 'wickhound' }, fallen_warden: { encounter: 'warden', boss: 'fallen_warden' },
};
/** The solo Warden title (Numbers → Rewards). */
const SOLO_TITLE = 'Lampbreaker';
/** Instances opened so far in this process (their steps are staggered by it). */
let instanceSerial = 0;
/** An enemy fighting within this long (s) before the last death makes it a wipe. */
const WIPE_FIGHT_S = 5;

/** A running instance: its checkpoint, cleared encounters, gates, seal, wipe, lamp-lift and evictions. */
interface InstanceRun {
  key: string;
  registry: Instances;
  t: InstanceTimings;
  cleared: Set<EncounterId>;
  /** Shut gates (bits): the walls of the instance's surface. */
  gates: number;
  sealed: ArenaEncounter | null;
  arenas: Record<ArenaEncounter, (x: number, z: number) => boolean>;
  /** Each camp enemy's encounter (adds have none). */
  encounterOf: Map<number, EncounterId>;
  /** Each boss: when it woke (combat s), when its gate shuts, and the most adventurers inside since it woke. */
  bosses: Map<number, { encounter: ArenaEncounter; boss: 'wickhound' | 'fallen_warden'; wokeAt: number | null; sealAt: number | null; most: number }>;
  wipeAt: number | null;
  lastFightAt: number;
  /** Enemies seen fighting (targeting someone, or winding up), and when last (combat s): a wipe resets these. */
  fighting: Map<number, number>;
  lift: boolean;
  /** accountId -> when it is sent out (combat s): it left or was kicked from the party. */
  evictAt: Map<string, number>;
  startedAt: number;
}

/** Where the dead get up again: the statue in this zone. */
const RESPAWN_ZONE: ZoneId = 'grove';
/** Most engine ticks one room step runs to catch its clock up (a stall, or a test clock running fast). */
const MAX_TICKS_PER_STEP = 16;
/** `self` goes to each owner every this many steps at most (TICK_HZ / 3 = 5 a second). */
const SELF_EVERY_STEPS = 3;
/**
 * Each client's view is checked against the interest radius every this many steps (spread over the
 * steps by session; telegraphs and targets every step). At 2 that is 7.5 times a second: an adventurer
 * running (or sprinting, 8.4 m/s) covers about 1 m in between, well inside the 10 m hysteresis band.
 */
const VIEW_FULL_EVERY_STEPS = 2;
/** Window over which a room's step time p95 is measured (ms). */
const TICK_WINDOW_MS = 5000;
/** The same kind of failure (a step phase, a handler, a save) is logged at most this often (ms). */
const LOG_EVERY_MS = 60_000;
/**
 * Arrival jitter a dodge's timers allow for (s): an honest client sends a second dodge at least
 * DODGE_MIN_GAP_S after the first (or once its own count says a charge is back), but the network can
 * bunch two messages up by about twice the one-way jitter (±60 ms → 120 ms). A dodge that arrives up
 * to this early is held until the gap has passed or the charge is back, then rolled.
 */
const DODGE_GAP_TOLERANCE_S = 0.15;
/** A dodge accepted but never stamped (a failed step) is resynced after this long (s, combat clock). */
const DISPLACE_RESYNC_S = 2;
/** A respawn whose save failed is not tried again sooner than this (ms). */
const RESPAWN_RETRY_MS = 5000;
/** How long an account's pending respawn admits it to the respawn zone however full (ms). */
const RESPAWN_ADMIT_MS = 30 * 60_000;
/** Intents have their own budget, so held keys never starve moves: a second, and the burst. */
const INTENT_RATE = 20;
const INTENT_BURST = 30;
/** At most one `refused 'rate'` to a client this often (ms); further dropped intents are silent. */
const RATE_REFUSAL_EVERY_MS = 250;
const INTENTS: Record<string, IntentAction> = { target: 'target', ability: 'ability', dodge: 'dodge', loadout: 'loadout', job: 'job', respawn: 'respawn' };
/** A fresh carry for `job`: what a join without a kept one starts with (all of the job's dodges). */
const freshCarry = (job: JobId): Carry => ({ cooldowns: {}, gcd: 0, dodgeCharges: JOBS[job].dodgeCharges, dodgeRefillIn: 0, momentum: 0 });
/**
 * How long a leaver's combat state (cooldowns, dodge charges, Momentum) is kept for its next join, in
 * ms: the longest cooldown anything has, plus a margin. After that everything would be ready anyway.
 */
const CARRY_KEEP_MS = (Math.max(...Object.values(ABILITIES).map((a) => a.cooldown), DODGE_REFILL_S * DODGE_CHARGES) + 5) * 1000;

/** A member's status is read, and a `party` view sent to one client for status changes, at most this often (ms). */
const PARTY_STATUS_MS = 1000 / PARTY_STATUS_HZ;


/** A measured time (ms) and when it was taken (wall ms). */
interface Timing { at: number; ms: number }

/**
 * `jobs` with the engine's job and picks (`l`) as current: that job's xp, talents and outfit and every
 * other record kept. A session's jobs are always on the current curve (the store reads them with
 * parseJobsSave), so the result says so: without `curve: 2`, isJobsSave refuses it.
 */
function withLoadout(jobs: JobsSave, l: Loadout): JobsSave {
  return { curve: 2, current: l.job, jobs: { ...jobs.jobs, [l.job]: { ...recordFor(jobs, l.job), picks: [l.picks[0], l.picks[1]] } } };
}

/** What the owner is told of its jobs: every starting job (unplayed ones fresh), level from xp. */
function jobsView(s: JobsSave): JobsView {
  const jobs = {} as JobsView['jobs'];
  for (const id of JOB_IDS) {
    const r = recordFor(s, id);
    jobs[id] = { level: r.level, xp: r.xp, next: xpToNext(r.xp), picks: [r.picks[0], r.picks[1]], talents: [...r.talents], outfit: r.outfit ? { ...r.outfit } : null };
  }
  return { current: s.current, jobs };
}

/** Drops timings older than TICK_WINDOW_MS (oldest first). */
function forgetOld(times: Timing[], now: number) {
  let old = 0;
  while (old < times.length && times[old].at <= now - TICK_WINDOW_MS) old++;
  if (old > 0) times.splice(0, old);
}
/** p95 of the timings (0 for none). */
function p95(times: Timing[]): number {
  if (times.length === 0) return 0;
  const sorted = times.map((t) => t.ms).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (v: number) => Math.round(v * 100) / 100;
const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
const u16 = (v: number) => Math.min(65535, Math.max(0, Math.round(v)));

/**
 * A carry `seconds` older: cooldowns, the GCD, the shield and sprint run down, dodge charges refill
 * (up to `maxCharges`, the job's), Momentum decays, and every "since" grows. Absent optional fields
 * stay absent; Plan 3's swapCd is dropped.
 */
export function ageCarry(c: Carry, seconds: number, maxCharges: number = DODGE_CHARGES): Carry {
  const s = Math.max(0, seconds);
  const cooldowns: Carry['cooldowns'] = {};
  for (const [id, left] of Object.entries(c.cooldowns) as [keyof Carry['cooldowns'], number][]) if (left - s > 0) cooldowns[id] = left - s;
  let charges = Math.min(c.dodgeCharges, maxCharges), refill = c.dodgeRefillIn, rest = s;
  while (charges < maxCharges && rest >= refill) { rest -= refill; charges++; refill = DODGE_REFILL_S; }
  const aged: Carry = {
    cooldowns, gcd: Math.max(0, c.gcd - s), dodgeCharges: charges, dodgeRefillIn: charges < maxCharges ? refill - rest : 0,
    momentum: Math.max(0, c.momentum - MOMENTUM_DECAY_PER_S * s),
  };
  const since = (v: number | undefined) => (v === undefined ? undefined : v + s);
  const left = (v: number | undefined) => (v === undefined ? undefined : Math.max(0, v - s));
  const extras: Record<string, number | undefined> = {
    sinceCombat: since(c.sinceCombat), sinceHurt: since(c.sinceHurt), sinceDealt: since(c.sinceDealt),
    sprintLeft: left(c.sprintLeft), shieldLeft: left(c.shieldLeft), shield: c.shield,
  };
  if (extras.shieldLeft === 0) extras.shield = 0;
  for (const [k, v] of Object.entries(extras)) if (v !== undefined) (aged as unknown as Record<string, number>)[k] = v;
  if (aged.sinceCombat !== undefined) aged.sinceCombat = Math.min(aged.sinceCombat, 1e6); // the engine's cap
  if (aged.sinceHurt !== undefined) aged.sinceHurt = Math.min(aged.sinceHurt, 1e6);
  if (aged.sinceDealt !== undefined) aged.sinceDealt = Math.min(aged.sinceDealt, 1e6);
  return aged;
}

/** The point an fx event is heard from: its target, else its source. */
const fxFocus = (e: FxEvent): number => ('dst' in e && e.dst !== undefined ? e.dst : (e as { src: number }).src);
const fxInvolves = (e: FxEvent, id: number) => ('src' in e && e.src === id) || ('dst' in e && e.dst === id);

function enemyMode(v: CombatantView): string {
  if (!v.alive) return 'dead';
  if (v.act === 'return') return 'return';
  if (v.act === 'stun') return 'stunned';
  if (v.windup) return 'windup';
  return v.targetId !== null ? 'fight' : 'idle';
}

/** One adventurer in the room. */
interface Session {
  client: Client;
  /** What this client's state holds besides its own adventurer (the room keeps it every step; see updateView). */
  view: StateView;
  /** The adventurers, enemies and telegraphs in `view` (not its own adventurer). */
  seen: Set<Viewed>;
  /** Which step (mod VIEW_FULL_EVERY_STEPS) its view's radius check falls on. */
  viewTurn: number;
  accountId: string;
  adventurerId: string;
  player: PlayerState;
  /**
   * The adventurer's jobs, saved with it: as the store read them, then only ever changed from the
   * engine's own job and picks and from xp (setJobs keeps it a valid JobsSave).
   */
  jobs: JobsSave;
  /** `jobs` is to be sent on the next step (a join or a reconnect). */
  jobsDue: boolean;
  /** A job change's save in flight, and whether another is wanted once it settles (they are coalesced). */
  jobSave?: Promise<void>;
  jobSaveAgain: boolean;
  /** When the cast its state shows began (combat clock, s), or NaN: a new cast is told from a running one. */
  castStart: number;
  /** A revive that came while the client was away, sent when it reconnects. */
  missedRevive?: S2C['revived'];
  /** Last accepted position (exact: the state's copy is quantised). */
  lastGood: { x: number; z: number; y: number };
  /** Last accepted facing (exact, as sent). */
  facing: number;
  /** The account's movement allowance and air track (shared with its later sessions). */
  movement: Allowance;
  /** Its id in the combat engine. */
  eid: number;
  /** Displacements (dodges, knockbacks, respawns) issued to this session: a move must carry this as its ack. */
  displaceSeq: number;
  /** A dodge was accepted and its displacement is not stamped yet: moves are ignored until it is. */
  awaitingDisplace: boolean;
  /** The last message that set displaceSeq, sent again on a reconnect (the client may have missed it). */
  lastSeqMessage?: { type: 'displaced'; message: S2C['displaced'] } | { type: 'respawned'; message: S2C['respawned'] };
  /** Everyone else sees the body travel a displacement's path, one sample a step. */
  anim?: { path: { x: number; z: number; y: number }[]; i: number };
  /**
   * Dead (the engine said so): moves are ignored, and it is saved as respawned. deadAt is on the combat
   * clock. A revive (Second Dawn) ends it where it lies.
   */
  dead: boolean;
  deadAt: number;
  /** The death's save as respawned (at the statue in RESPAWN_ZONE): every later save waits for it. */
  deathSave?: Promise<'saved' | 'refused' | 'failed'>;
  /**
   * The store holds this adventurer as respawned (RESPAWN_ZONE's statue): until a save of it alive lands
   * (after a revive), its saves expect RESPAWN_ZONE there.
   */
  respawnSaved: boolean;
  /** The last `self` sent, as JSON ('' = none yet). */
  lastSelf: string;
  /** What the latest displacement was: a dodge of its own lets the next dodge carry the ack before it. */
  lastDisplaceKind: 'dodge' | 'knock' | 'resync' | 'respawn' | null;
  /** When awaitingDisplace was set (combat clock), so a lost stamp is resynced. */
  awaitingSince: number;
  /** A dodge that arrived just inside the minimum gap, held until `due` (combat clock). */
  pendingDodge?: { dx: number; dz: number; due: number };
  /** When the room last had a dodge accepted for it (combat clock). */
  lastDodgeAt: number;
  /** The engine's hp as of the last mirror (saved as floor: relogs never gain the fraction). */
  hpExact: number;
  /** A failed respawn is not tried again before this (wall ms). */
  respawnRetryAt: number;
  /** Intent budget: tokens left, when last refilled (wall ms), and the last `refused 'rate'` (wall ms). */
  intentTokens: number;
  intentTokensAt: number;
  rateRefusedAt: number;
  /** Message token bucket: tokens left, and when it was last refilled (ms). */
  tokens: number;
  tokensAt: number;
  /** When this adventurer's last chat line went out (ms), or -Infinity. */
  lastChatAt: number;
  /** Set while the client is away and may reconnect. */
  reconnection?: Deferred<Client>;
  /** Set while a travel is being saved: moves are ignored, and leaving does not save over it. Settles once the travel is done or refused. */
  travelling?: Promise<void>;
  /** The last notice sent, and when (ms): the same line is not repeated within NOTICE_REPEAT_MS. */
  lastNotice?: { text: string; at: number };
  /** Its party members in this room (their PlayerStates): always in its view. */
  pins: PlayerState[];
  /** A member's status changed: a `party` view is due (sent at most every PARTY_STATUS_MS). */
  partyDue: boolean;
  /** When its last `party` view or `partyStatus` was sent, and its own status last read (wall ms). */
  partySentAt: number;
  /** The party as this client last heard it (a full view, with every `partyStatus` since applied), or null. */
  partySent: PartyView | null;
  /** The party the engine has it in (an instance's sealed arena splits a party: outside is not allied). */
  engineParty: string | null;
  /** What its last `instance` message said (its discrete parts), '' = none yet. */
  instanceSent: string;
  statusAt: number;
  // ───────── Plan 5 ─────────
  /** Its inventory queue (every op, Barber visit, loot award and grant), and the lock its saves share with it. */
  queue: InventoryQueue;
  /** A landed inventory write changed its jobs (talents, outfits): `jobs` is sent when the task settles. */
  invJobsChanged?: boolean;
  /** A kit change waits for the fight (or cast) to end: tried again every step. */
  kitPending?: boolean;
  /** The stored GM role as last read (at join, and on each /gm line): its chat lines carry the badge, its /gm lines are run. */
  isGm: boolean;
  lock: WriteLock;
  /** INV_OPS_PER_S for inventory and Barber requests. */
  invBucket: TokenBucket;
  /** `inventory` and `lookFree` are to be sent on the next step (a join or a reconnect). */
  invDue: boolean;
  /** Loot rolls from this step's kills, written as one queue task at the step's end. */
  loot: LootAward[];
  /** What the kit was made from (job, level, worn items, talents), as JSON: the kit is set again only when it changes. */
  kitKey: string;
  /** The engine's max hp (the kit's) as of the last mirror. */
  maxHp: number;
  /** When the last emote was accepted (combat clock). */
  emoteAt: number;
  /** Its look and gear codes (encodeLook, encodeGearLook): sent in `looks`, never in the state. */
  lookCode: string;
  gearCode: string;
  /** What this client was last sent of each adventurer's codes (by engine id; only adventurers in this room). */
  looksSent: Map<number, string>;
  /** Adventurers whose codes this client is due (they came into its view, or changed): sent at the step's end. */
  looksOut: Set<Session>;
}

const NO_ENEMIES: readonly EnemySchema[] = [];

/** Something a client's view can hold. */
type Viewed = PlayerState | EnemySchema | TelegraphSchema | FieldSchema;

/** What a successful onAuth attaches to the client (`client.auth`). */
interface JoinAuth {
  accountId: string;
  /** The stored role at sign-in (the chat badge); every /gm line reads the role from the store again. */
  isGm: boolean;
}

/** The account for a join's `{ token }` option, or false (missing or invalid token, unknown account). */
async function authenticate(store: Store, jwtSecret: string, options: unknown): Promise<JoinAuth | false> {
  const token = (options as { token?: unknown } | undefined)?.token;
  const verified = typeof token === 'string' ? verifyToken(token, jwtSecret) : null;
  const account = verified && (await store.findAccountById(verified.accountId));
  return account ? { accountId: account.id, isGm: account.isGm === true } : false;
}

/**
 * Per-client message budget (token bucket): refills at 3 * TICK_HZ a second and holds about 4 s of
 * normal traffic, so a catch-up burst after a stall is absorbed. Messages beyond it are dropped
 * silently; the client stays connected.
 */
const MESSAGE_RATE = 3 * TICK_HZ;
const MESSAGE_BURST = 4 * (TICK_HZ + 1);
/** How long after its last move an absent account's allowance is surely full again and can be forgotten. */
const ALLOWANCE_FORGET_MS = 2000;
/** The same notice is not sent to one adventurer again within this (ms), however often it walks into a full gate. */
const NOTICE_REPEAT_MS = 2000;

const clampHp = (hp: number, max: number = MAX_HP) => (Number.isFinite(hp) ? Math.min(max, Math.max(1, Math.round(hp))) : max);

export class ZoneRoom extends Room<{ state: ZoneState }> {
  state = new ZoneState();
  autoDispose = false; // a zone's one room lives as long as the server

  /** The zone this room runs. */
  zone!: ZoneDef;
  private store!: Store;
  private reconnectSeconds!: number;
  private accounts!: Presence;
  private rooms!: Map<ZoneId, ZoneRoom>;
  private isExitOpen!: (from: ZoneId, to: ZoneId) => boolean;
  private maxPlayers!: number;
  /** The zone's fight (public for tests and in-process tools). */
  combat!: Combat;
  /** The combat clock (seconds, monotonic). */
  private clockS!: () => number;
  private autoRespawnSeconds!: number;
  private sessionByEid = new Map<number, Session>();
  private steps = 0;
  /** Step times (ms) over the last TICK_WINDOW_MS, oldest first. */
  private tickTimes: Timing[] = [];
  /** Patch times (ms) over the last TICK_WINDOW_MS, oldest first. */
  private patchTimes: Timing[] = [];
  /** When each kind of failure was last logged (wall ms). */
  private loggedAt = new Map<string, number>();
  /** Failures caught in steps and handlers since the room started (stats). */
  stepErrors = 0;
  private wallMs!: () => number;
  private respawnRetryMs!: number;
  private disposed = false;
  /** The combat clock at the engine's last tick. */
  private lastTickAt = 0;
  private sessions = new Map<string, Session>(); // key: sessionId
  /** Accounts with a seat here (joining, in the room or away), by the session that holds it: accountId -> sessionId. */
  private sessionByAccount = new Map<string, string>();
  /**
   * Seats kept for travellers saved in this zone who have not joined yet: accountId -> until (ms). A
   * seat is kept for the reconnect window, which a slow phone loading the zone needs at most.
   */
  private arrivals = new Map<string, number>();
  /** Travels still being saved, by session id: they outlive the session if it is kicked or leaves meanwhile. */
  private travels = new Map<string, Promise<void>>();
  private patchMeter = new PatchRateMeter(Date.now());
  /** Adventurers and enemies by position, rebuilt each step for the views. */
  private grid = new Grid<PlayerState | EnemySchema>();
  /** Engine ids of the owners of telegraphs a view holds, reused by updateView. */
  private owners = new Set<number>();
  /** Joins so far (spreads the views' radius checks over the steps). */
  private joins = 0;
  /** Enemies by the engine id of the adventurer they target, rebuilt with the grid. */
  private targeting = new Map<number, EnemySchema[]>();
  /** Adventurers within a view's radius rule, and their squared distances (reused by updateView). */
  private near: PlayerState[] = [];
  private nearD2: number[] = [];
  private order: number[] = [];
  /** The adventurers a view keeps this check (reused by updateView). */
  private keep = new Set<PlayerState>();
  /** The view cap: at most `max` other adventurers, leaving past rank max + slack. */
  private viewCap = { max: INTEREST_MAX_ADVENTURERS, slack: INTEREST_RANK_HYSTERESIS };
  private parties!: Parties;
  /** How long a traveller stays online and named between this room and the next (ms). */
  private travelKeepMs = 30_000;
  /** The process's instances (the crater mouth, party accepts). */
  private instances?: Instances;
  /** Set when this room is a Lampfall instance. */
  private inst?: InstanceRun;
  /** An instance's delayed first step (the stagger). */
  private startTimer?: ReturnType<typeof setTimeout>;
  private serverSeed = 0;
  private kits = true;
  private lootAlways = false;
  private onInvWrite?: () => void;
  private gm?: GmProcess;
  /** Kills handled so far (a loot roll's seed part and kill key). */
  private killCounter = 0;
  /** Each engaged enemy's threat table (adventurer ids) as last seen alive: who fought it but got no credit (at most one entry an enemy). */
  private threatSeen = new Map<number, number[]>();
  /** Per pack encounter of an instance: the accounts credited for any of its kills (its clear's reward). */
  private encounterCredit = new Map<string, Set<string>>();

  onCreate(options: ZoneRoomOptions & { instanceKey?: string }) {
    this.instances = options.instances ?? options.instance?.registry;
    if (options.instance) {
      // a Lampfall instance: never in `rooms`; its key comes with the create call
      const key = typeof options.instanceKey === 'string' ? options.instanceKey : options.instance.key;
      // only Instances.enter opens one (a client's joinOrCreate('lampfall') or create is refused)
      if (!options.instance.registry.expects(key)) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
      this.setupInstance(options, key);
    } else {
      // Never a second room for a zone (Colyseus would open one if it ever saw this one as full).
      if (options.rooms.has(options.zone.id)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(options.zone.id));
      this.zone = options.zone;
    }
    this.store = options.store;
    this.maxPlayers = this.inst ? PARTY_MAX : options.maxPlayers;
    // Admission is decided by canAdmit, so Colyseus must never see the room as full (it would open
    // a second one): leave room for an account's new session joining before its old one is kicked.
    this.maxClients = this.maxPlayers * 2;
    this.reconnectSeconds = this.inst ? this.inst.t.reconnectS : options.reconnectSeconds;
    this.travelKeepMs = options.reconnectSeconds * 1000;
    this.accounts = options.presence;
    this.rooms = options.rooms;
    this.isExitOpen = options.isExitOpen;
    this.autoRespawnSeconds = options.autoRespawnSeconds;
    this.wallMs = options.wallClock ?? Date.now;
    this.respawnRetryMs = options.respawnRetryMs ?? RESPAWN_RETRY_MS;
    if (options.viewCap) this.viewCap = { ...options.viewCap };
    this.parties = options.parties;
    this.serverSeed = options.serverSeed;
    this.kits = options.kits !== false;
    this.lootAlways = options.lootAlways === true;
    this.onInvWrite = options.onInvWrite;
    this.gm = options.gm;
    const createdAt = performance.now();
    this.clockS = options.combatClock ?? (() => (performance.now() - createdAt) / 1000);
    this.lastTickAt = this.clockS();
    this.combat = createCombat(this.zone, { seed: options.combatSeed, nowS: this.lastTickAt });
    if (this.inst) this.tagEncounters();
    this.mirrorZone();
    if (this.inst) {
      this.state.instance = this.roomId ?? '';
      this.mirrorInstance();
      this.inst.registry.attach(this.inst.key, this);
    } else this.rooms.set(this.zone.id, this);
    this.setPatchRate(1000 / TICK_HZ);

    this.onMessage('move', this.guard('move', (client, message) => this.onMove(client, message)));
    this.onMessage('chat', this.guard('chat', (client, message) => this.onChat(client, message)));
    this.onMessage('target', this.guard('target', (client, message) => this.onTarget(client, message)));
    this.onMessage('ability', this.guard('ability', (client, message) => this.onAbility(client, message)));
    // Plan 3's weapon swap is gone; the Plan 3 client still sends it until Task 7: ignored silently.
    this.onMessage('swap', this.guard('swap', () => {}));
    this.onMessage('job', this.guard('job', (client, message) => this.onJob(client, message)));
    this.onMessage('dodge', this.guard('dodge', (client, message) => this.onDodge(client, message)));
    this.onMessage('loadout', this.guard('loadout', (client, message) => this.onLoadout(client, message)));
    this.onMessage('respawn', this.guard('respawn', (client) => this.onRespawn(client)));
    this.onMessage('party', this.guard('party', (client, message) => this.onParty(client, message)));
    this.onMessage('release', this.guard('release', (client) => this.onRelease(client)));
    this.onMessage('leaveInstance', this.guard('leaveInstance', (client) => this.onLeaveInstance(client)));
    this.onMessage('inv', this.guard('inv', (client, message) => this.onInv(client, message)));
    this.onMessage('look', this.guard('look', (client, message) => this.onLook(client, message)));
    this.onMessage('emote', this.guard('emote', (client, message) => this.onEmote(client, message)));
    // (intents spend the intent budget, every other message the message budget: see guard)
    this.clock.setInterval(() => {
      this.forgetIdleAllowances();
      void this.saveAll();
    }, options.saveSeconds * 1000);
    if (this.inst) {
      // instances' steps spread over the tick (12 of them would otherwise all land at once): the n-th
      // opened starts n × (1/TICK_HZ)/MAX_INSTANCES s late
      const offset = ((instanceSerial++ % MAX_INSTANCES) * (1000 / TICK_HZ)) / MAX_INSTANCES;
      this.startTimer = setTimeout(() => { if (!this.disposed) this.setSimulationInterval(() => this.step(), 1000 / TICK_HZ); }, offset);
    } else this.setSimulationInterval(() => this.step(), 1000 / TICK_HZ);
  }

  async onJoin(client: Client) {
    const { accountId, isGm } = client.auth as JoinAuth;
    const sessionId = client.sessionId;
    // Checked again here because two joins can pass onAuth at the same time.
    if (!this.canAdmit(accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(this.zone.id));
    // Claim the account before any await, in every room at once, so a later join of the same account
    // (here or in another zone) kicks this one; and kick the session that held it, wherever it is.
    // An older session of this account in this instance (a fresh sign-in after a drop): the new one
    // stands where it stood (alive), so a relog never moves anyone out of a fight or into a sealed one.
    const before = this.inst ? this.sessionOf(accountId) : undefined;
    const prevSpot = before ? { ...before.lastGood, facing: before.facing } : undefined;
    // (dead: it stays dead where it fell, on the same release clock)
    const prevDeadAt = before?.dead ? before.deadAt : undefined;
    const previous = this.accounts.claim(accountId, this, sessionId);
    this.sessionByAccount.set(accountId, sessionId);
    const giveUp = () => {
      this.accounts.release(accountId, sessionId);
      if (this.sessionByAccount.get(accountId) === sessionId) this.sessionByAccount.delete(accountId);
    };

    let adventurer: Adventurer;
    let name: string;
    try {
      // Saves the older session (unless it was travelling: then this waits for the travel's own save).
      if (previous) await previous.room.kick(previous.sessionId);
      // An ended session's inventory write still in flight lands first (once), so this join reads the truth.
      await this.accounts.inventorySettled(accountId);
      adventurer = await this.store.getOrCreateAdventurer(accountId);
      // onAuth refused unnamed adventurers already; names are never taken away, so this is a safeguard.
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      name = adventurer.name;
      // The same account joined again while this join was loading: the newer one wins.
      if (this.accounts.get(accountId)?.sessionId !== sessionId) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_SIGNED_IN_ELSEWHERE);
      }
      // It travelled (or was moved) to another zone after onAuth looked: that zone's room takes it. An
      // instance's adventurers are saved in the Greenway (at the crater mouth), and must be allowed in.
      if (adventurer.zone !== this.homeZone) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
      if (this.inst && !this.instanceInfo()?.allowed.has(accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
    } catch (err) {
      giveUp();
      throw err;
    }
    this.arrivals.delete(accountId);

    // Standing on the surface at the saved spot (the zone's spawn if nobody can stand there now), unless
    // the account's air track says it is still falling there (a re-join mid-air in this zone): then it
    // carries on falling. An air track from another zone means nothing here.
    const surface = this.zone.surface;
    // (in an instance: where it stood, or the current checkpoint)
    const from = this.inst ? (prevSpot ?? this.checkpointSpot()) : adventurer;
    const savedY = surface(from.x, from.z);
    const start = savedY === null ? this.zone.spawn : from;
    if (this.inst) this.inst.registry.release(accountId); // seated now: no hold needed
    const movement = this.allowanceFor(accountId);
    if (savedY === null || movement.air.grounded || movement.zone !== this.zone.id) {
      movement.air = makeAirTrack(savedY ?? surface(start.x, start.z) ?? 0);
    }
    movement.zone = this.zone.id;
    const y = movement.air.y + 0; // + 0: never -0 (terrain height can be), which state and messages encode differently
    const look = adventurer.look ?? defaultLook(accountId);
    const snapshot: InvSnapshot = {
      inv: adventurer.inventory, gold: adventurer.gold, seals: adventurer.seals, look, lookFree: adventurer.lookFree, version: adventurer.invVersion,
    };
    if (this.zone.id === RESPAWN_ZONE) this.accounts.respawns.delete(accountId);
    // Combat state a relog keeps (cooldowns, timers, combat, shield, sprint, Momentum), from its last
    // session anywhere, or a fresh one; a hurt adventurer waits out the regen delay again (relogging
    // never heals sooner).
    // Its jobs as the store read them (a Plan 3 save reads as the Warrior or the Ranger); the engine
    // runs the current job with its picks. (The adventurer row's own level and xp are untouched and
    // unused until Plan 5: job xp lives in jobs.)
    const loaded = isJobsSave(adventurer.jobs) ? adventurer.jobs : newJobsSave();
    // The kit (level, worn gear, talents) goes in with the adventurer, so the carry's dodges fit it.
    const kit = this.kitOf(loaded, snapshot.inv, loaded.current);
    const maxHp = this.kits ? kit.kit.stats.maxHp : MAX_HP;
    const hp = clampHp(adventurer.hp, maxHp);
    // (a kit may give one dodge charge more: the carry ages up to that, and the engine clamps it to the kit's own)
    const maxCharges = JOBS[loaded.current].dodgeCharges + (this.kits ? 1 : 0);
    const carry: Carry = { ...(this.takeCarry(accountId, maxCharges) ?? freshCarry(loaded.current)), ...(hp < maxHp ? { sinceHurt: 0 } : {}) };
    const now = this.nowS();
    const eid = this.combat.addAdventurer({
      x: start.x, z: start.z, y, facing: start.facing, hp, loadout: loadoutOf(loaded), carry, ...(this.kits ? { kit: kit.kit, level: kit.level } : {}),
    }, now);
    const engineJobs = withLoadout(loaded, this.combat.jobLoadout(eid)!);
    const jobs = isJobsSave(engineJobs) ? engineJobs : loaded;
    const job = jobs.current;
    // cast, castTotal, castAt and buffs stay unset (read as '' and 0) until their first event: an
    // adventurer coming into a view arrives whole, and most never cast or carry a buff.
    const player = Object.assign(new PlayerState(), {
      name, x: start.x, z: start.z, y, facing: start.facing, moving: false, hp, maxHp,
      eid, weapon: JOBS[job].weapon, target: -1, dead: false, act: '', shield: 0, job,
      level: levelForXp(recordFor(jobs, job).xp),
    });
    const lock = new WriteLock();
    const session: Session = {
      client,
      view: new StateView(),
      seen: new Set(),
      viewTurn: this.joins++ % VIEW_FULL_EVERY_STEPS,
      accountId,
      adventurerId: adventurer.id,
      player,
      jobs,
      jobsDue: true,
      jobSaveAgain: false,
      castStart: NaN,
      lastGood: { x: start.x, z: start.z, y },
      facing: start.facing,
      movement,
      eid,
      displaceSeq: 0,
      awaitingDisplace: false,
      dead: false,
      deadAt: -Infinity,
      respawnSaved: false,
      lastSelf: '',
      lastDisplaceKind: null,
      awaitingSince: -Infinity,
      lastDodgeAt: -Infinity,
      hpExact: hp,
      respawnRetryAt: -Infinity,
      intentTokens: INTENT_BURST,
      intentTokensAt: this.wallMs(),
      rateRefusedAt: -Infinity,
      tokens: MESSAGE_BURST,
      tokensAt: this.wallMs(),
      lastChatAt: -Infinity,
      pins: [],
      partyDue: false,
      partySentAt: -Infinity,
      partySent: null,
      engineParty: null,
      instanceSent: '',
      statusAt: -Infinity,
      queue: undefined as unknown as InventoryQueue,
      lock,
      invBucket: new TokenBucket(this.wallMs()),
      invDue: true,
      loot: [],
      kitKey: kit.key,
      maxHp,
      emoteAt: -Infinity,
      lookCode: encodeLook(look),
      gearCode: this.gearCode(snapshot.inv, jobs, job),
      looksSent: new Map(),
      looksOut: new Set(),
      isGm: isGm === true,
    };
    session.queue = this.makeQueue(snapshot, lock, adventurer.id, accountId, () => session.jobs, (j) => {
      // (inside the write lock: a save waiting on it reads these jobs, even if the session ended meanwhile)
      if (this.mergeJobs(session, j)) session.invJobsChanged = true;
    });
    this.sessions.set(sessionId, session);
    this.sessionByEid.set(eid, session);
    if (prevDeadAt !== undefined) {
      const w = worldOf(this.combat);
      const a = w.adventurers.get(eid);
      if (a) killAdventurer(w, a, now);
      Object.assign(session, { dead: true, deadAt: prevDeadAt });
    }
    this.mirrorPlayer(session);
    this.state.players.set(sessionId, player);
    this.state.online = this.state.players.size;
    // Its view: itself always, and at once whatever is near (so its first state already shows them).
    session.view.add(player);
    session.looksOut.add(session); // its own codes
    client.view = session.view;
    // Findable by name while online; its party (if any) learns where it is now, and the engine has it
    // in the party (the engine forgets parties with the adventurer: every join sets it again).
    this.accounts.named(accountId, name);
    this.parties.setStatus(accountId, this.statusOf(session));
    session.statusAt = this.wallMs();
    this.partyMoved(accountId);
    this.sendInvites(session); // invites sent while it was between rooms or away
    this.refreshView(session);
    // A save the store had to repair (a Plan 3 one, or one with bad parts) is written back repaired.
    if (adventurer.jobsRepaired) this.saveJobs(session);
    // ...and an inventory the store had to repair (a new adventurer's starter kit, a migrated row): once, through the queue.
    if (adventurer.inventoryRepaired) {
      void session.queue.push({
        retries: 1,
        run: (s, jobs) => ({ kind: 'write', write: { inventory: s.inv, jobs, dGold: 0, dSeals: 0 }, next: { inv: s.inv, gold: s.gold, seals: s.seals, jobs, look: s.look, lookFree: s.lookFree }, info: null }),
        settle: (r) => { if (r.status === 'failed') this.logFailure('inventory', 'Writing back a repaired inventory failed', r.error); },
      });
    }
  }

  onDrop(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.player.moving = false;
    session.reconnection = this.allowReconnection(client, this.reconnectSeconds);
    session.reconnection.catch(() => {}); // a window that runs out (or is cut short) ends in onLeave
  }

  onReconnect(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.client = client;
    client.view = session.view; // (Colyseus carries it over too)
    session.reconnection = undefined;
    // Its view stood still while it was away: brought up to date at once.
    this.refreshView(session);
    // It may have missed the message that set the ack its moves must carry, and its `self` is stale.
    if (session.lastSeqMessage) this.sendTo(client, session.lastSeqMessage.type, session.lastSeqMessage.message as never);
    if (session.missedRevive) this.sendTo(client, 'revived', session.missedRevive);
    session.missedRevive = undefined;
    session.lastSelf = '';
    session.jobsDue = true;
    session.invDue = true;
    // its looks: everything in its view again (what it held may be gone with the old connection)
    session.looksSent.clear();
    session.looksOut.add(session);
    for (const item of session.seen) if (item instanceof PlayerState) this.lookDue(session, item);
    session.partySent = null;
    this.sendParty(session); // its party may have changed while it was away
    this.sendInvites(session);
  }

  /** The account's open invites, again (a join or a reconnect: one sent meanwhile never reached it). */
  private sendInvites(session: Session) {
    for (const inv of this.parties.invitesFor(session.accountId)) {
      this.sendTo(session.client, 'partyInvite', { partyId: inv.partyId, from: inv.from, size: inv.size });
    }
  }

  async onLeave(client: Client) {
    await this.removeSession(client.sessionId);
  }

  async onDispose() {
    this.disposed = true;
    clearTimeout(this.startTimer);
    if (this.inst) this.inst.registry.disposed(this.roomId);
    if (this.rooms.get(this.zone.id) === this) this.rooms.delete(this.zone.id);
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.removeSession(sessionId)));
  }

  /**
   * Whether an account may join: it already has a seat here (its old session will be kicked) or one
   * kept for it as a traveller, or there is space beside everyone here and every traveller on the way.
   */
  canAdmit(accountId: string): boolean {
    const now = Date.now();
    let held = 0;
    for (const [id, until] of this.arrivals) {
      if (until <= now) this.arrivals.delete(id);
      else if (!this.sessionByAccount.has(id)) held++;
    }
    // An instance admits only an allowed account (the party) with a seat: its session here (in the
    // room or away inside its window), or a traveller's held seat (the crater mouth's checks passed).
    if (this.inst) {
      const info = this.instanceInfo();
      if (!info?.allowed.has(accountId)) return false;
      return this.sessionByAccount.has(accountId) || this.arrivals.has(accountId) || (info.heldFor.get(accountId) ?? -Infinity) > now;
    }
    if (this.sessionByAccount.has(accountId) || this.arrivals.has(accountId)) return true;
    // Someone who died (saved as respawned here) always gets up at the statue, however full it is.
    if (this.zone.id === RESPAWN_ZONE && (this.accounts.respawns.get(accountId) ?? -Infinity) > this.wallMs()) return true;
    return this.sessionByAccount.size + held < this.maxPlayers;
  }

  /** Keeps a seat for an account travelling here, for the reconnect window or until it joins. */
  holdArrival(accountId: string): void {
    this.arrivals.set(accountId, Date.now() + this.reconnectSeconds * 1000);
  }

  /** Gives back a seat kept by holdArrival (the travel did not happen). */
  releaseArrival(accountId: string): void {
    this.arrivals.delete(accountId);
  }

  /** State patches actually sent per second over the last 5 s (TICK_HZ when the server keeps up). */
  get measuredPatchHz(): number {
    return this.patchMeter.rate(Date.now());
  }

  broadcastPatch(): boolean {
    this.patchMeter.record(Date.now());
    const started = performance.now();
    const sent = super.broadcastPatch();
    const now = Date.now();
    this.patchTimes.push({ at: now, ms: performance.now() - started });
    forgetOld(this.patchTimes, now);
    return sent;
  }

  /**
   * p95 of the time a state patch takes to encode and send (ms, last 5 s; 0 before any): with
   * per-client views that is one encode per client, outside the step.
   */
  get patchMsP95(): number {
    forgetOld(this.patchTimes, Date.now());
    return p95(this.patchTimes);
  }

  /** Adventurers in this room, including ones inside their reconnect window. */
  get playerCount(): number {
    return this.state.players.size;
  }

  /** A pose a client sent: ignored while dead, travelling or being displaced, or with any ack but the latest. */
  private onMove(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const pose = parsePose(message);
    if (!session || !pose || session.travelling || session.dead || session.awaitingDisplace) return;
    if (pose.ack !== session.displaceSeq) return; // sent before a displacement it has not applied yet (or forged): silent
    this.acceptPose(session, pose, this.wallMs());
  }

  /**
   * Checks a pose from the last accepted one (allowance at the engine's speed scale, height, walls) and
   * takes it, with any fall's damage, or corrects the client; true if taken. A pose into an open exit
   * starts the travel there.
   */
  private acceptPose(session: Session, pose: Pose, now: number): boolean {
    const movement = session.movement;
    movement.metres = refillAllowance(movement.metres, (now - movement.at) / 1000, this.combat.speedScale(session.eid, this.nowS()));
    movement.at = now;
    const { result, landedDrop } = checkPose(session.lastGood, movement.air, pose, now, movement.metres, this.zone.surface);
    if (result !== 'ok') {
      this.correct(session, now);
      // into a shut lamp-gate (its circle is a wall): say why
      if (this.inst && shutGateOnStep(this.inst.gates, session.lastGood, pose)) this.notice(session, REASON_ARENA_SEALED, now);
      return false;
    }
    // Into an open exit (by the server's own, just-checked position): the move stands only if the
    // adventurer may go through.
    const exit = this.exitAt(pose.x, pose.z);
    const destination = exit && this.rooms.get(exit.to);
    if (exit && session.dead) {
      this.correct(session, now); // the dead never travel (a death is saved as respawned, at the statue)
      return false;
    }
    // the crater mouth: into the party's instance (alive, out of combat, and one free or its own open)
    if (exit?.instance && !this.mayEnterMouth(session, now)) return false;
    if (exit && !exit.instance && !destination?.canAdmit(session.accountId)) {
      this.correct(session, now);
      this.notice(session, zoneFullReason(exit.to), now);
      return false;
    }
    const before = session.lastGood;
    movement.metres -= Math.hypot(pose.x - session.lastGood.x, pose.z - session.lastGood.z);
    session.lastGood = { x: pose.x, z: pose.z, y: pose.y };
    session.facing = pose.facing;
    session.anim = undefined;
    Object.assign(session.player, { x: pose.x, z: pose.z, y: pose.y, facing: pose.facing, moving: pose.moving });
    this.combat.setPose(session.eid, pose.x, pose.z, pose.y, pose.facing);
    const damage = fallDamage(landedDrop);
    if (damage > 0) this.fall(session, damage);
    if (exit?.instance) this.enterInstance(session, before);
    else if (exit && destination) this.travel(session, { to: exit.to, arrive: exit.arrive }, destination, before);
    return true;
  }

  // ───────── Plan 5: kits, the inventory queue, shops, the Barber, emotes ─────────

  /** The kit `job` runs (kitFor: its level, what it wears, its talents), its level, and what it was made from. */
  private kitOf(jobs: JobsSave, inv: InvSnapshot['inv'], job: JobId): { kit: Kit; level: number; key: string } {
    const r = recordFor(jobs, job), level = levelForXp(r.xp), gear = gearItems(inv, job);
    return { kit: kitFor({ job, level, gear, talents: r.talents }), level, key: JSON.stringify([job, level, gear, r.talents]) };
  }

  /** What `job` shows (gear, costumes, the hidden head) as the state's code. */
  private gearCode(inv: InvSnapshot['inv'], jobs: JobsSave, job: JobId): string {
    return encodeGearLook(gearLookOf(inv, job, recordFor(jobs, job).outfit));
  }

  /**
   * The kit, the `gear` code and the `level` from the session's jobs and inventory now. The engine's kit is set
   * only when what it is made from changed (a job change, equip, talent, level-up): loot or a dye never re-kits.
   * Callers re-kit only out of combat and not mid-cast (operations are refused then), except a level-up.
   */
  private refreshKit(session: Session, now = false) {
    const inv = session.queue.snapshot.inv, job = session.jobs.current;
    const k = this.kitOf(session.jobs, inv, job);
    if (k.key !== session.kitKey) {
      // An operation's context was checked when it ran; its write may land once a fight or a cast has begun:
      // the kit then waits until the adventurer is out of combat and not casting or charging (a level-up and a
      // job change pass `now`).
      const self = this.combat.self(session.eid);
      if (!now && self && (self.inCombat || self.cast !== null || self.charge !== null)) {
        session.kitPending = true;
        return;
      }
      session.kitPending = false;
      session.kitKey = k.key;
      if (this.kits) this.combat.setKit(session.eid, k.kit, k.level);
    } else session.kitPending = false;
    const p = session.player, gear = this.gearCode(inv, session.jobs, job);
    if (session.gearCode !== gear) {
      session.gearCode = gear;
      this.codesChanged(session);
    }
    if (p.level !== k.level) p.level = k.level;
    this.mirrorPlayer(session);
  }

  /**
   * `player`'s codes are due to this client unless it was sent them as they are now (an adventurer coming
   * back into its view costs nothing: the client keeps what it was sent, by engine id).
   */
  private lookDue(session: Session, player: PlayerState) {
    const other = this.sessionByEid.get(player.eid);
    if (other && session.looksSent.get(player.eid) !== `${other.lookCode} ${other.gearCode}`) session.looksOut.add(other);
  }

  /** An adventurer's look or gear code changed: due to itself and every client that has it in view. */
  private codesChanged(session: Session) {
    for (const s of this.sessions.values()) if (s === session || s.seen.has(session.player)) s.looksOut.add(session);
  }

  /** The step's due codes to one client, as one `looks` message. */
  private sendLooks(session: Session) {
    if (session.looksOut.size === 0 || session.reconnection) return;
    const a: [number, string, string][] = [];
    for (const o of session.looksOut) {
      if (this.sessions.get(o.client.sessionId) !== o) continue; // gone meanwhile
      const key = `${o.lookCode} ${o.gearCode}`;
      if (session.looksSent.get(o.eid) === key) continue;
      session.looksSent.set(o.eid, key);
      a.push([o.eid, o.lookCode, o.gearCode]);
    }
    session.looksOut.clear();
    if (a.length > 0) this.sendTo(session.client, 'looks', { a });
  }

  /** The adventurer's inventory queue: reads and writes the store for it, its writes under the session's lock. */
  private makeQueue(
    snapshot: InvSnapshot, lock: WriteLock, adventurerId: string, accountId: string, jobs: () => JobsSave, landed?: (jobs: JobsSave) => void,
  ): InventoryQueue {
    return new InventoryQueue(snapshot, {
      lock,
      jobs,
      landed,
      write: (expect, w) => this.store.writeInventory(adventurerId, expect, w),
      load: async () => {
        const a = await this.store.getOrCreateAdventurer(accountId);
        return { inv: a.inventory, gold: a.gold, seals: a.seals, look: a.look ?? defaultLook(accountId), lookFree: a.lookFree, version: a.invVersion };
      },
      onWrite: () => this.onInvWrite?.(),
      onError: (err) => this.logFailure('inventory', 'Applying an inventory result failed', err),
    });
  }

  /** The owner's inventory view now (or when it is back). */
  private sendInventory(session: Session) {
    if (session.reconnection) {
      session.invDue = true;
      return;
    }
    const s = session.queue.snapshot;
    this.sendTo(session.client, 'inventory', inventoryView({ inv: s.inv, gold: s.gold, seals: s.seals, jobs: session.jobs }));
  }

  private refuseInv(session: Session, op: InvOp['op'] | 'look' | null, reason: InvRefusedReason) {
    if (session.reconnection) return;
    const text = reason === 'save' ? INV_SAVE_TEXT : INV_TEXT[reason];
    this.sendTo(session.client, 'invRefused', { op, reason, text });
  }

  /** Inside an instance's sealed boss arena now (ruling P5-h: no gear, talent or pick changes there). */
  private inSealedArena(session: Session): boolean {
    const sealed = this.inst?.sealed;
    return !!sealed && this.inst!.arenas[sealed](session.lastGood.x, session.lastGood.z);
  }

  /** Where and how the adventurer stands for an operation, from the server's own view (never the client's). */
  private invCtx(session: Session): InvCtx {
    const self = this.combat.self(session.eid);
    const { x, z } = session.lastGood;
    const grove = this.zone.id === 'grove' && !this.inst;
    return {
      stall: grove ? stallAt('grove', x, z) : null,
      jobSwitch: this.zone.jobSwitch(x, z),
      townBoard: grove && Math.hypot(x - GUILD_BOARD.x, z - GUILD_BOARD.z) <= STALL_REACH,
      inCombat: self?.inCombat ?? false,
      dead: session.dead || !(this.combat.get(session.eid)?.alive ?? false),
      busy: session.travelling !== undefined || (self?.cast ?? null) !== null || (self?.charge ?? null) !== null || session.awaitingDisplace,
    };
  }

  /**
   * Talents and outfits from an operation's result, onto the session's jobs as they are now (xp, picks and the
   * current job may have moved on while the write was in flight: the session is their authority).
   */
  private mergeJobs(session: Session, result: JobsSave) {
    const next: JobsSave = { ...session.jobs, jobs: { ...session.jobs.jobs } };
    for (const [id, r] of Object.entries(result.jobs) as [JobId, NonNullable<JobsSave['jobs'][JobId]>][]) {
      const cur = next.jobs[id];
      next.jobs[id] = cur ? { ...cur, talents: [...r.talents], outfit: r.outfit ? { ...r.outfit } : null } : { ...r, picks: [r.picks[0], r.picks[1]], talents: [...r.talents] };
    }
    const changed = JSON.stringify(next) !== JSON.stringify(session.jobs);
    this.setJobs(session, next);
    return changed;
  }

  /** A task's end as the owner hears it: the view after a change (or a resend), else the refusal. */
  private settleInv(session: Session, op: InvOp['op'] | 'look' | null, r: TaskResult<unknown>) {
    if (this.sessions.get(session.client.sessionId) !== session) return; // ended meanwhile (its write, if any, landed)
    switch (r.status) {
      case 'applied':
        // (its jobs were merged as the write landed: see makeQueue's landed)
        if (session.invJobsChanged) {
          session.invJobsChanged = false;
          this.sendJobs(session);
        }
        this.refreshKit(session);
        this.sendInventory(session);
        return;
      case 'unchanged':
        this.sendInventory(session); // a resent op id: the client hears the truth again
        return;
      case 'refused':
        this.refuseInv(session, op, r.reason as InvRefusedReason);
        if (r.reread) this.sendInventory(session); // it was read afresh: the truth as well
        return;
      case 'stale':
      case 'failed':
        if (r.status === 'failed') this.logFailure('inventory', 'An inventory write failed', r.error);
        this.refuseInv(session, op, 'save');
        this.refreshKit(session);
        this.sendInventory(session); // the stored truth
        return;
      case 'dropped':
        return;
    }
  }

  /** `inv`: an operation through the queue (parseInvOp; at most INV_OPS_PER_S a second, more → 'rate'). */
  private onInv(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    const op = parseInvOp(message);
    const name = op?.op ?? null;
    if (!session.invBucket.take(this.wallMs())) return this.refuseInv(session, name, 'rate');
    if (!op) return this.refuseInv(session, null, 'unknown');
    void session.queue.push<null>({
      retries: 1,
      recheck: RECHECK,
      run: (s, jobs) => {
        // ruling P5-h: no gear or talent change inside a sealed boss arena (between pulls too)
        if (SEALED_REFUSED.includes(op.op) && this.inSealedArena(session)) return { kind: 'refuse', reason: 'combat' };
        const r = applyInvOp({ inv: s.inv, gold: s.gold, seals: s.seals, jobs }, op, this.invCtx(session));
        if ('refusal' in r) return { kind: 'refuse', reason: r.refusal };
        if (r.dup) return { kind: 'none', info: null };
        return {
          kind: 'write', info: null,
          write: { inventory: r.state.inv, jobs: r.state.jobs, dGold: r.dGold, dSeals: r.dSeals },
          next: { ...r.state, look: s.look, lookFree: s.lookFree },
        };
      },
      settle: (r) => this.settleInv(session, op.op, r),
    });
  }

  /**
   * `look`: the Barber, within reach of its stall, alive, out of combat and not busy. parseLook first (the
   * server never throws on a bad look); barberCost gold, or nothing on the free visit; an unchanged look
   * costs nothing and changes nothing.
   */
  private onLook(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    if (!session.invBucket.take(this.wallMs())) return this.refuseInv(session, 'look', 'rate');
    const look = parseLook((message as { look?: unknown } | null)?.look);
    if (!look) return this.refuseInv(session, 'look', 'unknown');
    void session.queue.push<boolean>({
      retries: 1,
      recheck: RECHECK,
      run: (s, jobs) => {
        const ctx = this.invCtx(session);
        if (ctx.dead) return { kind: 'refuse', reason: 'dead' };
        if (ctx.inCombat) return { kind: 'refuse', reason: 'combat' };
        if (ctx.busy) return { kind: 'refuse', reason: 'busy' };
        if (ctx.stall !== 'barber') return { kind: 'refuse', reason: 'where' };
        if (encodeLook(look) === encodeLook(s.look)) return { kind: 'none', info: false };
        const cost = s.lookFree ? 0 : barberCost(s.look, look);
        if (s.gold < cost) return { kind: 'refuse', reason: 'gold' };
        return {
          kind: 'write', info: s.lookFree,
          write: { inventory: s.inv, jobs, dGold: -cost, dSeals: 0, look, ...(s.lookFree ? { lookFree: false as const } : {}) },
          next: { inv: s.inv, gold: s.gold - cost, seals: s.seals, jobs, look, lookFree: false },
        };
      },
      settle: (r) => {
        if (r.status === 'applied' || r.status === 'stale' || r.status === 'failed') this.lookChanged(session, r.status === 'applied' && r.info === true);
        this.settleInv(session, 'look', r);
      },
    });
  }

  /** The look field from the queue's look; `lookFree` when the free visit was just spent. */
  private lookChanged(session: Session, spentFree: boolean) {
    const code = encodeLook(session.queue.snapshot.look);
    if (session.lookCode !== code) {
      session.lookCode = code;
      this.codesChanged(session);
    }
    if (spentFree && !session.reconnection) this.sendTo(session.client, 'lookFree', { free: false });
  }

  /** `emote`: alive, out of combat, at most one every EMOTE_MIN_S (others are dropped); only the state's two fields. */
  private onEmote(client: Client, message: unknown) {
    const session = this.actor(client);
    const emote = (message as { emote?: unknown } | null)?.emote;
    if (!session || typeof emote !== 'string' || !(EMOTES as readonly string[]).includes(emote) || session.dead) return;
    const now = this.nowS();
    if (now - session.emoteAt < EMOTE_MIN_S - 1e-6 || this.combat.self(session.eid)?.inCombat) return;
    session.emoteAt = now;
    session.player.emote = emote as EmoteId;
    session.player.emoteAt = this.clockSteps(now);
  }

  /** In-process (Task 7's grants): runs a task through the account's queue here; undefined when it has no session here. */
  public enqueueInventory<T>(accountId: string, task: InvTask<T>): Promise<TaskResult<T>> | undefined {
    const session = this.sessionOf(accountId);
    if (!session) return undefined;
    const settle = task.settle;
    return session.queue.push<T>({
      ...task,
      settle: (r) => {
        settle?.(r);
        this.settleInv(session, null, r as TaskResult<unknown>);
      },
    });
  }

  /**
   * In-process: the store changed behind the account's queue here (a GM grant offline, offline loot, the creator):
   * the queue re-reads, and the owner hears the truth (inventory, look). False when it has no session here.
   */
  public refreshInventory(accountId: string): boolean {
    const session = this.sessionOf(accountId);
    if (!session) return false;
    session.queue.markStale();
    const wasFree = session.queue.snapshot.lookFree;
    void session.queue.push<null>({
      retries: 0, unbounded: true,
      run: () => ({ kind: 'none', info: null }),
      settle: (r) => {
        if (r.status === 'unchanged') this.lookChanged(session, wasFree && !r.snapshot.lookFree);
        this.settleInv(session, null, r as TaskResult<unknown>);
        if (r.status === 'unchanged') this.refreshKit(session);
      },
    });
    return true;
  }

  /** A loot task for `awards`: rolled from the queued state, at most once per kill key; then `loot`, its notices and the view. */
  private lootTask(session: Session, awards: LootAward[], tries: number): InvTask<ReturnType<typeof applyLoot>['given']> {
    return {
      retries: LOOT_STALE_RETRIES,
      unbounded: true, // never refused for a full queue (a stalled store must not drop loot)
      run: (s, jobs) => {
        const out = applyLoot({ inv: s.inv, gold: s.gold, seals: s.seals, jobs }, awards, this.lootAlways);
        if (out.given.every((g) => g.dup)) return { kind: 'none', info: out.given };
        return {
          kind: 'write', info: out.given,
          write: { inventory: out.state.inv, jobs, dGold: out.dGold, dSeals: 0 },
          next: { ...out.state, look: s.look, lookFree: s.lookFree },
        };
      },
      settle: (r) => {
        if (r.status === 'failed' || r.status === 'stale') {
          if (r.status === 'failed') this.logFailure('loot', 'A loot write failed', r.error);
          // tried again a little later (a kill key is rewarded once however often it is tried); then given up
          if (tries + 1 < LOOT_TRIES) {
            // (held as in flight from now: a rejoin meanwhile waits for it, and reads the store after it lands)
            const retry = new Promise<void>((resolve) => setTimeout(resolve, LOOT_RETRY_MS)).then(() => session.queue.push(this.lootTask(session, awards, tries + 1)));
            this.accounts.inventoryInFlight(session.accountId, retry.then(() => {}));
          } else this.logFailure('loot', 'Loot was given up after its tries', new Error(`${awards.length} awards for ${session.accountId}`));
          return;
        }
        if (r.status === 'dropped') {
          this.offlineLoot(session, awards); // the session ended first: written for the adventurer all the same
          return;
        }
        if (r.status === 'refused') {
          this.logFailure('loot', 'Loot could not be applied', new Error(`${r.reason}: ${awards.length} awards for ${session.accountId}`));
          return;
        }
        if (r.status !== 'applied' || this.sessions.get(session.client.sessionId) !== session) return;
        for (const g of r.info) {
          if (g.dup || session.reconnection) continue;
          this.sendTo(session.client, 'loot', { items: g.items, gold: g.gold, soldFor: g.soldFor, x: g.award.x, z: g.award.z });
          for (const sold of g.sold) this.sendTo(session.client, 'notice', { text: bagFullText(itemName(sold.item), sold.gold) });
          if (g.lost > 0) this.sendTo(session.client, 'notice', { text: purseFullText(g.lost) });
        }
        this.sendInventory(session);
      },
    };
  }

  /** The step's loot rolls for the session, as one write. */
  private flushLoot(session: Session) {
    if (session.loot.length === 0) return;
    const awards = session.loot.splice(0);
    void session.queue.push(this.lootTask(session, awards, 0));
  }

  /** Loot for an adventurer whose session ended before its write: a queue of its own on the stored truth (the kill keys keep it once). */
  private offlineLoot(session: Session, awards: LootAward[]) {
    const jobs = session.jobs;
    const queue = this.makeQueue(session.queue.snapshot, new WriteLock(), session.adventurerId, session.accountId, () => jobs);
    queue.markStale();
    const flight = queue.push({
      retries: LOOT_STALE_RETRIES,
      run: (s, j) => {
        const out = applyLoot({ inv: s.inv, gold: s.gold, seals: s.seals, jobs: j }, awards, this.lootAlways);
        if (out.given.every((g) => g.dup)) return { kind: 'none', info: null };
        // (jobs left as stored: this write has no session, and a newer one may hold newer jobs)
        return { kind: 'write', info: null, write: { inventory: out.state.inv, dGold: out.dGold, dSeals: 0 }, next: { ...out.state, look: s.look, lookFree: s.lookFree } };
      },
      unbounded: true,
      settle: (r) => {
        if (r.status === 'failed' || r.status === 'stale' || r.status === 'refused') {
          this.logFailure('loot', 'Loot for an adventurer who left could not be written', r.status === 'failed' ? r.error : new Error(r.status));
        }
        // back online already (it read the store before this landed): its session hears the truth
        if (r.status === 'applied') this.accounts.get(session.accountId)?.room.refreshInventory(session.accountId);
      },
    });
    this.accounts.inventoryInFlight(session.accountId, flight.then(() => {}));
  }

  // ───────── intents ─────────

  /** The session of a client that may act now (not travelling), or undefined. */
  private actor(client: Client): Session | undefined {
    const session = this.sessions.get(client.sessionId);
    return session && !session.travelling ? session : undefined;
  }

  /** Passes an intent to the engine; a refusal goes back to the client. True if accepted. */
  private intent(session: Session, action: IntentAction, intent: Intent): boolean {
    const refusal = this.combat.intent(session.eid, intent, this.nowS());
    if (refusal) this.refuse(session, action, refusal);
    return refusal === null;
  }

  private refuse(session: Session, action: IntentAction, reason: Refusal | 'stale' | 'rate') {
    this.sendTo(session.client, 'refused', { action, reason });
  }

  private onTarget(client: Client, message: unknown) {
    const session = this.actor(client);
    const id = (message as { id?: unknown } | null)?.id;
    if (!session || (id !== null && !Number.isSafeInteger(id))) return;
    if (this.intent(session, 'target', { t: 'target', id: id as number | null })) this.mirrorPlayer(session);
  }

  private onAbility(client: Client, message: unknown) {
    const session = this.actor(client);
    const { slot, phase, ally } = (typeof message === 'object' && message !== null ? message : {}) as { slot?: unknown; phase?: unknown; ally?: unknown };
    if (!session || !Number.isSafeInteger(slot) || (phase !== 'press' && phase !== 'release')) return;
    if (ally !== undefined && !Number.isSafeInteger(ally)) return;
    // A release with no charge in progress (the shot already loosed, auto-released or cancelled, or no
    // press at all) is dropped silently: the client sends one on every key-up of the slot.
    if (phase === 'release' && (this.combat.self(session.eid)?.charge ?? null) === null) return;
    // (the engine checks the slot against the current job's five, and the ally it names)
    this.intent(session, 'ability', { t: 'ability', slot: slot as number, phase, ...(ally !== undefined ? { ally: ally as number } : {}) });
  }

  /** New picks for the current job (two distinct ids of its pool), anywhere out of combat: sent back as `jobs`. */
  private onLoadout(client: Client, message: unknown) {
    const session = this.actor(client);
    const picks = (message as { picks?: unknown } | null)?.picks;
    if (!session || !Array.isArray(picks) || picks.length !== 2 || !picks.every((p) => typeof p === 'string')) return;
    if (this.inSealedArena(session)) return this.refuse(session, 'loadout', 'in-combat'); // ruling P5-h
    if (!this.intent(session, 'loadout', { t: 'loadout', picks: [picks[0], picks[1]] as [AbilityId, AbilityId] })) return;
    this.takeJob(session);
    this.sendJobs(session);
  }

  /**
   * A job change: refused (with the engine's reason, 'busy' while travelling, 'invalid' for anything
   * but a starting job) or taken with that job's own saved picks, then sent as `jobs` and saved at once.
   */
  private onJob(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    // not entered yet (or gone already): nothing to change
    if (!session) return this.sendTo(client, 'refused', { action: 'job', reason: 'busy' });
    const job = (message as { job?: unknown } | null)?.job;
    if (!isJobId(job)) return this.refuse(session, 'job', 'invalid');
    if (session.travelling) return this.refuse(session, 'job', 'busy');
    const before = session.jobs;
    if (!this.intent(session, 'job', { t: 'job', job, picks: recordFor(session.jobs, job).picks })) return;
    this.takeJob(session);
    // the engine keeps the old job's kit through a job change: the new job's kit (its gear and talents) at once
    this.refreshKit(session, true);
    this.sendJobs(session);
    if (JSON.stringify(before) !== JSON.stringify(session.jobs)) this.saveJobs(session);
  }

  /** The engine's job and picks become the ones saved with the adventurer. */
  private takeJob(session: Session) {
    const l = this.combat.jobLoadout(session.eid);
    if (l) this.setJobs(session, withLoadout(session.jobs, l));
  }

  /** Replaces the session's jobs, only with a valid JobsSave (anything else is logged and the last good one kept). */
  private setJobs(session: Session, next: JobsSave) {
    if (isJobsSave(next)) session.jobs = next;
    else this.logFailure('jobs', 'A jobs value failed its check; the last good one is kept', new TypeError(JSON.stringify(next)));
  }

  private sendJobs(session: Session) {
    session.jobsDue = false;
    if (session.reconnection) session.jobsDue = true; // (sent when it is back)
    else this.sendTo(session.client, 'jobs', jobsView(session.jobs));
  }

  /**
   * Saves now, best effort as travels are (a failure is logged; the periodic save tries again). At most
   * one such save is in flight per session: changes meanwhile are saved once it settles.
   */
  private saveJobs(session: Session) {
    if (session.jobSave) {
      session.jobSaveAgain = true;
      return;
    }
    session.jobSave = (async () => {
      do {
        session.jobSaveAgain = false;
        if (session.travelling || session.dead || this.sessions.get(session.client.sessionId) !== session) return;
        await this.save(session);
      } while (session.jobSaveAgain);
    })().finally(() => { session.jobSave = undefined; });
  }

  /** The current job gains a kill's xp (KILL_XP, × CATCH_UP_MULT below the highest job level): see gainXpAmount. */
  private gainXp(session: Session, kind: EnemyKindId): number {
    return this.gainXpAmount(session, killXp(session.jobs, session.jobs.current, kind));
  }

  /**
   * The current job gains `amount` xp: `jobXp` always (0 from the Training Dummy), `jobs` when it changed; a
   * level-up re-kits at once (the one kit change allowed mid-fight), sets `level` and `lvlAt`, and sends `levelUp`.
   */
  private gainXpAmount(session: Session, amount: number): number {
    const job = session.jobs.current;
    const had = recordFor(session.jobs, job).xp;
    const { save, level, levelUp } = addJobXp(session.jobs, job, amount);
    this.setJobs(session, save);
    const xp = recordFor(session.jobs, job).xp;
    this.sendTo(session.client, 'jobXp', { job, gained: xp - had, xp, level, levelUp });
    if (xp !== had) this.sendJobs(session);
    if (levelUp) {
      this.refreshKit(session, true);
      session.player.lvlAt = Math.max(1, this.clockSteps(this.nowS()));
      if (!session.reconnection) this.sendTo(session.client, 'levelUp', { job, level, talentRow: talentRowFor(level) });
      this.sendInventory(session); // its stats
    }
    return xp - had;
  }

  /**
   * A dodge: its starting pose is checked like any move first; a refused pose is corrected and the
   * dodge refused as 'stale'. It must carry the latest ack, or the one before when the latest
   * displacement was this client's own dodge (a client that predicts its rolls sends the second
   * before the first's `displaced` reaches it; its pose is then checked from the first roll's end).
   * One arriving up to DODGE_GAP_TOLERANCE_S before its minimum gap or its next charge (network
   * jitter) is held until then; one arriving earlier than that is refused ('cooldown' or 'charges')
   * before its pose is taken, with no correction, so mashing the button while empty never piles up
   * corrections. Otherwise the engine rolls from the accepted pose and the room stamps the result on
   * the next step; if the engine refuses it (busy, in the air, ...), the refusal is followed by a
   * `correct` to that pose. For the client every refused dodge means the same: back to the pose it
   * was sent from (then any `correct`, as always).
   */
  private onDodge(client: Client, message: unknown) {
    const session = this.actor(client);
    const pose = parsePose(message);
    const { dx, dz } = (typeof message === 'object' && message !== null ? message : {}) as { dx?: unknown; dz?: unknown };
    if (!session || !pose || !finite(dx) || !finite(dz) || Math.abs(dx) > 1e6 || Math.abs(dz) > 1e6) return;
    if (session.dead) return this.refuse(session, 'dodge', 'dead');
    const ownRollBefore = pose.ack === session.displaceSeq - 1 && session.lastDisplaceKind === 'dodge';
    // A dodge still held (not rolled yet) gives way to a newer press: the latest press is the one rolled.
    const replacing = session.pendingDodge !== undefined;
    if ((session.awaitingDisplace && !replacing) || (pose.ack !== session.displaceSeq && !ownRollBefore)) return this.refuse(session, 'dodge', 'stale');
    if (replacing) {
      session.pendingDodge = undefined;
      session.awaitingDisplace = false;
    }
    const now = this.nowS();
    // The engine's view is computed at its own latest time (the last tick or intent): the refill is
    // that much nearer now.
    const view = this.combat.self(session.eid);
    const stale = Math.max(0, now - worldOf(this.combat).now);
    const gapWait = session.lastDodgeAt + DODGE_MIN_GAP_S - now;
    const chargeWait = view && view.dodgeCharges <= 0 ? Math.max(0, view.dodgeNextIn - stale) : 0;
    if (chargeWait > DODGE_GAP_TOLERANCE_S) return this.refuse(session, 'dodge', 'charges');
    if (gapWait > DODGE_GAP_TOLERANCE_S) return this.refuse(session, 'dodge', 'cooldown');
    if (!this.acceptPose(session, pose, this.wallMs())) return this.refuse(session, 'dodge', 'stale');
    if (session.travelling) return;
    // (a roll toward a shut lamp-gate is not refused: the instance's walled surface stops it at the wall, P4-b)
    const wait = Math.max(gapWait, chargeWait);
    if (wait > 1e-6 && wait <= DODGE_GAP_TOLERANCE_S) {
      session.pendingDodge = { dx, dz, due: now + wait + 1e-6 };
      session.awaitingDisplace = true; // its moves wait for the roll, like any accepted dodge's
      session.awaitingSince = now;
      return;
    }
    this.startDodge(session, dx, dz, now);
  }

  /** Rolls from the last accepted pose; a refusal goes back with a `correct` to that pose (the client may have predicted the roll). */
  private startDodge(session: Session, dx: number, dz: number, now: number) {
    session.pendingDodge = undefined;
    session.awaitingDisplace = false;
    const refusal = this.combat.intent(session.eid, { t: 'dodge', dx, dz, from: { ...session.lastGood }, grounded: session.movement.air.grounded }, now);
    if (refusal) {
      this.refuse(session, 'dodge', refusal);
      this.correct(session, this.wallMs());
      return;
    }
    session.awaitingDisplace = true;
    session.awaitingSince = now;
    session.lastDodgeAt = now;
  }

  private onRespawn(client: Client) {
    const session = this.actor(client);
    if (!session) return;
    // an instance has no statue: `release` takes its place
    if (!session.dead || this.inst) return this.refuse(session, 'respawn', 'invalid');
    if (this.nowS() - session.deadAt < DEATH_MIN_S - 1e-6 || this.wallMs() < session.respawnRetryAt) return this.refuse(session, 'respawn', 'cooldown');
    this.respawn(session);
  }

  /** The open exit whose circle holds (x, z), if any. */
  private exitAt(x: number, z: number): ZoneExit | undefined {
    return this.zone.exits.find((e, i) => (x - e.x) * (x - e.x) + (z - e.z) * (z - e.z) <= e.r * e.r
      // an instance's exits: the stair always, the lamp-lift once the Warden fell (server state, per instance)
      && (this.inst ? i === 0 || this.inst.lift : this.isExitOpen(this.zone.id, e.to)));
  }

  /**
   * Takes the adventurer through `exit`: one save puts it in the next zone at the exit's arrival point
   * (written only while it is still saved here), then the client is told and the session ends without
   * saving again. Until then its moves are ignored and a seat is kept in the next zone. If the save
   * fails, it stays here, back at `before` (its last pose outside the exit), with a notice.
   */
  private travel(session: Session, exit: Pick<ZoneExit, 'to' | 'arrive'>, destination: ZoneRoom, before: Session['lastGood'], respawn = false, into?: string) {
    const sessionId = session.client.sessionId;
    const { x, z, facing } = exit.arrive;
    destination.holdArrival(session.accountId);
    // into an instance (room id `into`): saved in the Greenway at the crater mouth, never in the Lampfall
    const savedAs: Pick<AdventurerSave, 'zone' | 'x' | 'z' | 'facing'> = into ? { zone: 'greenway', ...LAMPFALL_MOUTH.arrive } : { zone: exit.to, x, z, facing };
    const travelling = (async () => {
      // A respawn elsewhere: the death may have been saved as respawned already (that is this travel's save).
      if (respawn) await session.deathSave;
      const result = respawn && session.respawnSaved ? 'saved' : await this.save(session, savedAs);
      const saved = result === 'saved';
      if (this.sessions.get(sessionId) !== session) {
        // Kicked or gone while saving: that ended the session already, without saving over the travel.
        // If the travel was not saved either, save it here as it is (kick waits for this).
        if (!saved) {
          destination.releaseArrival(session.accountId);
          await this.save(session);
        }
        return;
      }
      if (!saved) {
        destination.releaseArrival(session.accountId);
        session.travelling = undefined;
        if (respawn && result === 'refused') {
          // Not saved here any more: it already is in the respawn zone (an earlier save went through).
          await this.sendOn(session);
          return;
        }
        if (respawn) session.respawnRetryAt = this.wallMs() + this.respawnRetryMs; // the store is down: not every step
        if (!respawn) {
          session.lastGood = before;
          Object.assign(session.player, before, { moving: false });
          this.combat.setPose(session.eid, before.x, before.z, before.y, session.facing);
          this.correct(session, this.wallMs());
        }
        this.notice(session, REASON_TRAVEL_FAILED, this.wallMs());
        return;
      }
      // Died while the travel was being saved (alive, in the next zone): saved again, as respawned.
      // Never left saved alive: tried again (with the respawn backoff) until written or no longer there.
      if (session.dead && !respawn) {
        while ((await this.save(session, undefined, savedAs.zone)) === 'failed' && !this.disposed) {
          await new Promise((resolve) => setTimeout(resolve, this.respawnRetryMs));
        }
      }
      // Its height here means nothing there: it arrives standing (the next room's join places it).
      session.movement.zone = exit.to;
      await this.removeSession(sessionId, { save: false });
      if (session.reconnection) {
        // Away while it was saved: there is no client to tell. Ending the window makes a reconnect
        // fail, and the client's fresh join then asks GET /api/zone and finds the next zone.
        session.reconnection.reject(new Error('travelled'));
      } else {
        this.sendTo(session.client, 'travel', into ? { zone: 'lampfall', instance: into } : { zone: exit.to });
        session.client.leave(CloseCode.CONSENTED);
      }
    })().finally(() => this.travels.delete(sessionId));
    session.travelling = travelling;
    this.travels.set(sessionId, travelling);
  }

  /** Sends a notice line, unless the same one went to this adventurer within NOTICE_REPEAT_MS. */
  private notice(session: Session, text: string, now: number) {
    if (session.lastNotice?.text === text && now - session.lastNotice.at < NOTICE_REPEAT_MS) return;
    session.lastNotice = { text, at: now };
    this.sendTo(session.client, 'notice', { text });
  }

  /**
   * Sends the client back to its last accepted pose. In the air, that pose would soon be refused
   * itself (the arc runs out), so the adventurer is first landed on the ground below it, with the
   * fall's damage: the corrected pose is then one the next move can start from.
   */
  private correct(session: Session, now: number) {
    const air = session.movement.air;
    if (!air.grounded) {
      const { x, z } = session.lastGood;
      const groundY = (this.zone.surface(x, z) ?? air.y) + 0; // + 0: never -0
      const damage = fallDamage(landAirTrack(air, groundY));
      session.lastGood = { x, z, y: groundY };
      session.player.y = groundY;
      session.player.moving = false;
      this.combat.setPose(session.eid, x, z, groundY, session.facing);
      if (damage > 0) this.fall(session, damage);
    }
    this.sendTo(session.client, 'correct', { ...session.lastGood });
  }

  /**
   * Fall damage through the engine (never the last point; it restarts the regen delay); the client is
   * told the health it sees lost (hp shows as Math.ceil of the engine's).
   */
  private fall(session: Session, damage: number) {
    const shown = () => Math.ceil(this.combat.get(session.eid)?.hp ?? 0); // the hp the client sees
    const before = shown();
    this.combat.damage(session.eid, damage, this.nowS(), 'fall');
    const amount = before - shown();
    this.mirrorPlayer(session);
    if (amount > 0) this.sendTo(session.client, 'hurt', { amount, cause: 'fall' });
  }

  /**
   * Cleaned text goes to everyone in the room, sender included (channel 'zone', the default), or with
   * channel 'party' to every online member of the sender's party in any room (none: refused
   * 'not-member'). Empty text, any other channel, and lines within CHAT_MIN_INTERVAL_MS of the
   * sender's last (on either channel) are dropped.
   */
  private onChat(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const text = cleanChat((message as { text?: unknown } | null)?.text);
    const channel = (message as { channel?: unknown } | null)?.channel ?? 'zone';
    if (!session || text === null || (channel !== 'zone' && channel !== 'party')) return;
    // A game master's /gm line is a command (never broadcast); anyone else's is ordinary chat, like any other text.
    const gmLine = isGmLine(text);
    if (gmLine && session.isGm && this.gm) return this.onGmLine(session, text);
    const party = channel === 'party' ? this.parties.partyOf(session.accountId) : undefined;
    if (channel === 'party' && !party) return this.refuseParty(session, 'not-member');
    const now = Date.now();
    if (now - session.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
    session.lastChatAt = now;
    // (a non-GM's /gm line: one refused audit row, never seen by any client)
    if (gmLine) this.audit({ gmAccount: session.accountId, command: 'denied', target: null, args: { text }, ok: false, result: 'not a game master' });
    const chat: S2C['chat'] = { from: session.player.name, text, channel, ...(session.isGm ? { gm: true as const } : {}) };
    if (!party) return this.broadcast('chat', chat);
    for (const m of party.members) {
      const claim = this.accounts.get(m.accountId);
      claim?.room.deliver(claim.sessionId, 'chat', chat);
    }
  }

  // ───────── parties ─────────

  /**
   * A party request (parsePartyOp, else dropped). An invite by eid names an adventurer in this
   * room that the sender's view holds; by name, any online adventurer (exact, any case). Anyone
   * else is 'unknown', which says nothing about whether it exists or is offline. A valid invite goes
   * to the invitee wherever it is; every outcome of a change reaches the members through onChange.
   */
  private onParty(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const op = parsePartyOp(message);
    if (!session || !op) return;
    const me = { accountId: session.accountId, name: session.player.name };
    let refusal: PartyRefusal | undefined;
    switch (op.op) {
      case 'invite': {
        let to: { accountId: string; name: string } | undefined;
        if ('eid' in op) {
          const other = this.sessionByEid.get(op.eid);
          if (other && (other === session || session.seen.has(other.player))) to = { accountId: other.accountId, name: other.player.name };
        } else {
          const accountId = this.accounts.names.get(op.name.toLowerCase());
          const name = accountId === undefined ? undefined : this.accounts.nameOf(accountId);
          // online in a room, or between two (a travel)
          if (accountId !== undefined && name !== undefined && (this.accounts.get(accountId) || this.accounts.isTravelling(accountId))) to = { accountId, name };
        }
        if (!to) {
          refusal = this.parties.inviteUnknown(session.accountId);
          break;
        }
        const r = this.parties.invite(me, to);
        if (typeof r === 'string') {
          refusal = r;
          break;
        }
        const claim = this.accounts.get(to.accountId);
        claim?.room.deliver(claim.sessionId, 'partyInvite', { partyId: r.partyId, from: me.name, size: r.size });
        break;
      }
      case 'accept': {
        if (this.inOtherInstance(session.accountId, op.partyId)) {
          refusal = 'in-instance';
          break;
        }
        const r = this.parties.accept(session.accountId, me.name, op.partyId);
        if (typeof r === 'string') refusal = r;
        break;
      }
      case 'decline':
        this.parties.decline(session.accountId, op.partyId);
        break;
      case 'leave':
        if (!this.parties.partyOf(session.accountId)) refusal = 'not-member';
        else this.parties.leave(session.accountId);
        break;
      case 'kick':
      case 'lead': {
        const r = op.op === 'kick' ? this.parties.kick(session.accountId, op.name) : this.parties.lead(session.accountId, op.name);
        if (typeof r === 'string') refusal = r;
        break;
      }
    }
    if (refusal) this.refuseParty(session, refusal);
  }

  private refuseParty(session: Session, reason: PartyRefusal) {
    this.sendTo(session.client, 'partyRefused', { reason, text: PARTY_TEXT[reason] });
  }

  /** A message to one session of this room, if it is here and connected (party chat, invites). */
  public deliver<T extends keyof S2C>(sessionId: string, type: T, message: S2C[T]): void {
    const session = this.sessions.get(sessionId);
    if (session && !session.reconnection) this.sendTo(session.client, type, message);
  }

  /**
   * The account's party changed (or it has none now): its session here, if any, gets the view now,
   * the engine has it in the party (or none), and its pins are its members in this room.
   */
  public partyChanged(accountId: string): void {
    const session = this.sessionOf(accountId);
    if (!session) return;
    const party = this.parties.partyOf(accountId);
    this.applyParty(session);
    // A new member's status is not known yet: read now, and the members who already got a view without it hear soon.
    if (party && this.parties.setStatus(accountId, this.statusOf(session))) {
      session.statusAt = this.wallMs();
      for (const m of party.members) if (m.accountId !== accountId) this.accounts.get(m.accountId)?.room.partyStatusChanged(m.accountId);
    }
    session.pins = [];
    for (const m of party?.members ?? []) {
      const other = m.accountId === accountId ? undefined : this.sessionOf(m.accountId);
      if (other) session.pins.push(other.player);
    }
    this.sendParty(session);
  }

  /** A member's status changed: the account's session here gets a view within PARTY_STATUS_MS. */
  public partyStatusChanged(accountId: string): void {
    const session = this.sessionOf(accountId);
    if (session) session.partyDue = true;
  }

  /** The account came into or left this room: every member of its party hears (eids and pins); without one, its own session. */
  private partyMoved(accountId: string) {
    const party = this.parties.partyOf(accountId);
    if (!party) return this.partyChanged(accountId);
    for (const m of party.members) {
      const claim = this.accounts.get(m.accountId);
      claim?.room.partyChanged(m.accountId);
    }
  }

  private sessionOf(accountId: string): Session | undefined {
    const sessionId = this.sessionByAccount.get(accountId);
    return sessionId === undefined ? undefined : this.sessions.get(sessionId);
  }

  /** The session's party view now (when connected; else when it is back). */
  private sendParty(session: Session) {
    if (session.reconnection) {
      session.partyDue = true;
      return;
    }
    const party = this.parties.partyOf(session.accountId);
    session.partyDue = false;
    session.partySentAt = this.wallMs();
    const view = party ? this.parties.view(party, this.roomId) : null;
    session.partySent = view;
    this.sendTo(session.client, 'party', { party: view });
  }

  /**
   * A due status update: only the members whose numbers changed, as compact `partyStatus` lines (about
   * 30 B each), when the members, leader, online flags, zones and eids are as the client last heard;
   * otherwise the whole view.
   */
  private sendPartyStatus(session: Session) {
    const party = this.parties.partyOf(session.accountId);
    const last = session.partySent;
    const view = party ? this.parties.view(party, this.roomId) : null;
    const sameShape = last !== null && view !== null && last.id === view.id && last.members.length === view.members.length
      && last.members.every((m, i) => {
        const n = view.members[i];
        return m.name === n.name && m.leader === n.leader && m.online === n.online && m.eid === n.eid && m.zone === n.zone;
      });
    if (!sameShape || session.reconnection) return this.sendParty(session);
    session.partyDue = false;
    session.partySentAt = this.wallMs();
    const lines: PartyStatusLine[] = [];
    view.members.forEach((n, i) => {
      const m = last.members[i], line: PartyStatusLine = { i };
      if (m.hp !== n.hp) line.hp = n.hp;
      if (m.maxHp !== n.maxHp) line.maxHp = n.maxHp;
      if (m.dead !== n.dead) line.dead = n.dead;
      if (m.searing !== n.searing) line.searing = n.searing;
      if (m.job !== n.job) line.job = n.job;
      if (m.level !== n.level) line.level = n.level;
      if (Object.keys(line).length > 1) lines.push(line);
    });
    if (lines.length > 0) this.sendTo(session.client, 'partyStatus', { m: lines });
    session.partySent = view;
  }

  /** What the party is told of this member. */
  private statusOf(session: Session): MemberStatus {
    const p = session.player, job = session.jobs.current;
    return {
      zone: this.zone.id, roomId: this.roomId, eid: session.eid, job, level: recordFor(session.jobs, job).level,
      hp: p.hp, maxHp: p.maxHp, dead: p.dead, searing: this.combat.get(session.eid)?.searing ?? 0,
    };
  }

  /**
   * Each member here has its status read every PARTY_STATUS_MS; a change makes a view due for every
   * member of its party, wherever they are. A due view goes out at most every PARTY_STATUS_MS per client.
   * Members in the same room are pinned in each other's views, so their hp, maxHp, dead and job are
   * in the state already: a change of only those makes a view due only for members in other rooms
   * (the client reads same-room members, eid ≥ 0, from the state; this keeps a duo's fight free of
   * party traffic).
   */
  private relayPartyStatus(wall: number) {
    for (const session of this.sessions.values()) {
      if (wall - session.statusAt >= PARTY_STATUS_MS) {
        session.statusAt = wall;
        const party = this.parties.partyOf(session.accountId);
        const before = party ? this.parties.statusOf(session.accountId) : null;
        const now = party ? this.statusOf(session) : null;
        if (party && now && this.parties.setStatus(session.accountId, now)) {
          const inState = before !== null && before.zone === now.zone && before.roomId === now.roomId && before.eid === now.eid
            && before.level === now.level && before.searing === now.searing;
          for (const m of party.members) {
            const claim = this.accounts.get(m.accountId);
            if (claim && !(inState && claim.room === this)) claim.room.partyStatusChanged(m.accountId);
          }
        }
      }
      if (session.partyDue && !session.reconnection && wall - session.partySentAt >= PARTY_STATUS_MS) this.sendPartyStatus(session);
    }
  }

  /**
   * Ends an account's older session in this room, connected or away; its adventurer is saved and
   * removed at once. A session that is travelling is not saved again: this waits for its travel's own
   * save to settle instead, so whoever kicked it then loads the adventurer where it really is.
   */
  async kick(sessionId: string, why: { reason: string; code: number } = { reason: REASON_SIGNED_IN_ELSEWHERE, code: CloseCode.CONSENTED }) {
    const session = this.sessions.get(sessionId);
    const travel = this.travels.get(sessionId); // also for a session that already left mid-travel
    if (!session) {
      await travel;
      return;
    }
    // Away: end the reconnect window at once, which frees its reserved seat (Colyseus counts reserved
    // seats toward maxClients, so a window left open would let one account fill the room). Ended
    // before the save, so a reconnection cannot slip in meanwhile; a client that comes back finds
    // its session gone ("Connection lost").
    if (session.reconnection) session.reconnection.reject(new Error(why.reason));
    await this.removeSession(sessionId);
    if (!session.reconnection) {
      if (why.code !== CloseCode.CONSENTED) this.sendTo(session.client, 'notice', { text: why.reason });
      this.sendTo(session.client, 'kicked', { reason: why.reason });
      session.client.leave(why.code);
    }
    await travel;
  }

  // ───────── GM tools (server only: see gm/commands.ts) ─────────

  /** An announcement to everyone in this room. */
  public announce(m: S2C['announce']): void {
    this.broadcast('announce', m);
  }

  /** One audit row; a store failure is logged (with the row) and never stops the command's answer. */
  private audit(row: Parameters<Store['logGm']>[0]): Promise<void> {
    return this.store.logGm(row).catch((err) => this.logFailure('gm-audit', `A GM audit row could not be written: ${JSON.stringify(row)}`, err));
  }

  /**
   * A GM's /gm line: the role is read from the store again first (a revoked GM loses its commands at once), then
   * the line runs (one at a time per GM), every outcome is audited, and the GM alone hears the result as a notice.
   */
  private onGmLine(session: Session, text: string): void {
    const gm = this.gm!;
    void gm.serial(session.accountId, async () => {
      let isGm = false;
      try {
        isGm = (await this.store.findAccountById(session.accountId))?.isGm === true;
      } catch (err) {
        this.logFailure('gm', 'Reading a GM role failed', err);
        await this.audit({ gmAccount: session.accountId, command: 'denied', target: null, args: { text }, ok: false, result: 'the role could not be read' });
        this.deliverTo(session, 'That could not be checked just now; try again');
        return;
      }
      if (!isGm) {
        session.isGm = false;
        await this.audit({ gmAccount: session.accountId, command: 'denied', target: null, args: { text }, ok: false, result: 'not a game master (revoked)' });
        this.deliverTo(session, 'You are not a game master');
        return;
      }
      const run = await runGmLine(text, session.accountId, this.gmHost(session));
      for (const row of run.rows) await this.audit({ gmAccount: session.accountId, ...row });
      this.deliverTo(session, run.notice);
    }).catch((err) => this.logFailure('gm', 'A GM command failed', err));
  }

  /** A notice to the session, if it is still here and connected. */
  private deliverTo(session: Session, text: string) {
    if (this.sessions.get(session.client.sessionId) === session && !session.reconnection) this.sendTo(session.client, 'notice', { text });
  }

  /** What a GM's command acts with: this room for its own moves, presence for everyone else, the store for the rest. */
  private gmHost(session: Session): GmHost {
    const gm = this.gm!;
    const online = (name: string) => {
      const accountId = this.accounts.names.get(name.toLowerCase());
      const claim = accountId === undefined ? undefined : this.accounts.get(accountId);
      return accountId === undefined ? undefined : { accountId, claim, name: this.accounts.nameOf(accountId) ?? name };
    };
    return {
      store: this.store,
      limits: gm.limits,
      now: () => Date.now(),
      event: () => gm.event,
      setEvent: (title) => { gm.event = title; },
      announce: (text) => gm.announceAll(text),
      key: () => `gm:${randomUUID()}`,
      grant: async (name, g) => {
        const o = online(name);
        if (o?.claim) {
          const r = await o.claim.room.grantTo(o.accountId, g);
          if (r !== 'dropped') return { outcome: r, name: o.name };
        }
        // offline (or between rooms, or its session just ended): straight to the store, the same key
        const outcome = await this.store.grantOffline(name, g);
        if (outcome === 'done' && o) this.accounts.get(o.accountId)?.room.refreshInventory(o.accountId);
        return { outcome, name: o?.name ?? name };
      },
      tp: (to) => this.gmTeleport(session, to, online),
      kick: async (name, reason) => {
        const o = online(name);
        if (!o?.claim) return { ok: false, result: `${name} is not online` };
        await o.claim.room.kick(o.claim.sessionId, { reason: `Removed by a game master: ${reason}`, code: GM_KICK_CODE });
        return { ok: true, result: `Kicked ${o.name}: ${reason}` };
      },
    };
  }

  /**
   * A GM grant to the account's session here, through its inventory queue (the same compare-and-set and checks as
   * any operation; at most once per grant key). The owner gets "A game master gave you …" and its new view.
   * 'dropped': no session here, or it ended first (the caller writes it offline with the same key).
   */
  public grantTo(accountId: string, g: GmGrant): Promise<GrantOutcome | 'dropped'> {
    const session = this.sessionOf(accountId);
    if (!session) return Promise.resolve('dropped');
    return session.queue.push<boolean>({
      retries: 3,
      unbounded: true,
      recheck: ['bag-full', 'purse-full'],
      run: (s, jobs) => {
        const r = applyGrant(s.inv, s.gold, g);
        if ('refusal' in r) return { kind: 'refuse', reason: r.refusal };
        if (r.dup) return { kind: 'none', info: false };
        // (jobs left as stored: a grant changes none)
        return { kind: 'write', info: true, write: { inventory: r.inv, dGold: r.dGold, dSeals: 0 }, next: { inv: r.inv, gold: s.gold + r.dGold, seals: s.seals, jobs, look: s.look, lookFree: s.lookFree } };
      },
      settle: (r) => {
        if (this.sessions.get(session.client.sessionId) !== session) return;
        if (r.status === 'applied') {
          this.refreshKit(session);
          if (!session.reconnection) this.sendTo(session.client, 'notice', { text: `A game master gave you ${grantThing(g)}` });
        }
        if (r.status !== 'dropped') this.sendInventory(session);
      },
    }).then((r) => {
      switch (r.status) {
        case 'applied': case 'unchanged': return 'done';
        case 'refused': return r.reason as GrantOutcome;
        case 'dropped': return 'dropped';
        default: return 'failed';
      }
    });
  }

  /**
   * A GM's own move (a server `correct`): to a named adventurer in this room, or to (x, z) on this room's ground.
   * Never in an instance (arenas, gates and checkpoints), never while dead, travelling, displaced or fighting,
   * never onto an exit; the saved-zone check of every later save is unchanged (the spot is in this zone).
   */
  private gmTeleport(session: Session, to: { name: string } | { x: number; z: number }, online: (name: string) => { accountId: string; claim?: { room: ZoneRoom; sessionId: string }; name: string } | undefined): { ok: boolean; result: string } {
    if (this.inst) return { ok: false, result: 'Teleport is not allowed in an instance' };
    if (this.sessions.get(session.client.sessionId) !== session) return { ok: false, result: 'You are not here any more' };
    if (session.dead || session.travelling || session.awaitingDisplace || session.anim) return { ok: false, result: 'You cannot move now (dead, travelling or being moved)' };
    if (this.combat.self(session.eid)?.inCombat) return { ok: false, result: 'Not while you are in combat' };
    let x: number, z: number, label: string;
    if ('name' in to) {
      const o = online(to.name);
      if (!o?.claim) return { ok: false, result: `${to.name} is not online` };
      if (o.claim.room !== this) return { ok: false, result: `${o.name} is not here (another zone or an instance)` };
      const other = this.sessionOf(o.accountId);
      if (!other) return { ok: false, result: `${o.name} is not here` };
      ({ x, z } = other.lastGood);
      label = o.name;
    } else {
      ({ x, z } = to);
      label = `(${x}, ${z})`;
    }
    const ground = this.zone.surface(x, z);
    if (ground === null) return { ok: false, result: `No ground at ${label}` };
    if (this.exitAt(x, z)) return { ok: false, result: `${label} is in an exit` };
    const y = ground + 0;
    session.lastGood = { x, z, y };
    session.movement.air = makeAirTrack(y);
    session.movement.at = this.wallMs();
    session.pendingDodge = undefined;
    Object.assign(session.player, { x, z, y, moving: false });
    this.combat.setPose(session.eid, x, z, y, session.facing);
    this.sendTo(session.client, 'correct', { x, z, y });
    return { ok: true, result: `Moved to ${label}` };
  }

  /** Takes the adventurer out of the room and saves it (not when it is travelling, or `save` is false); unknown sessions are ignored. */
  private async removeSession(sessionId: string, opts: { save?: boolean } = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (this.sessionByAccount.get(session.accountId) === sessionId) this.sessionByAccount.delete(session.accountId);
    this.state.players.delete(sessionId);
    this.state.online = this.state.players.size;
    // Everyone who saw it gets its removal with the state; their views forget it, and its own view goes.
    for (const other of this.sessions.values()) {
      other.seen.delete(session.player);
      other.looksSent.delete(session.eid);
      other.looksOut.delete(session);
    }
    // A client still connected for a moment (travelling, kicked) gets only the unfiltered state until it goes.
    if (session.client.view === session.view) session.client.view = undefined;
    session.view.dispose();
    // Its inventory queue: the write in flight lands (once; the account's next join waits for it), the rest is
    // dropped; loot rolled this step but not written yet is written for it all the same.
    if (session.loot.length > 0) this.offlineLoot(session, session.loot.splice(0));
    session.queue.close();
    this.accounts.inventoryInFlight(session.accountId, session.queue.idle());
    this.leaveFight(session);
    // Its party members here stop pinning it; the party sees it gone from this room.
    for (const other of this.sessions.values()) {
      const i = other.pins.indexOf(session.player);
      if (i >= 0) other.pins.splice(i, 1);
    }
    if (this.parties.clearRoom(session.accountId, this.roomId)) this.partyMoved(session.accountId);
    if (session.travelling) {
      // The account stays held until the travel's save settles, so a sign-in meanwhile (anywhere)
      // kicks this claim and waits for that save, then loads the adventurer where it really is.
      // (a travel that went through keeps it online and named until the next room's join claims it)
      const release = () => this.accounts.release(session.accountId, sessionId, this.travelKeepMs);
      void session.travelling.then(release, release);
      return;
    }
    this.accounts.release(session.accountId, sessionId);
    if (opts.save !== false && !this.savedElsewhere(session)) await this.save(session);
  }

  /**
   * Out of the engine (enemies drop it from their threat tables). A live adventurer's cooldowns,
   * dodge charges and Momentum are kept for the account's next join, in any zone.
   */
  private leaveFight(session: Session) {
    if (!this.sessionByEid.delete(session.eid)) return;
    const carry = session.dead ? undefined : this.combat.carryOf(session.eid);
    if (carry) this.accounts.carries.set(session.accountId, { carry, at: this.wallMs() });
    this.combat.removeAdventurer(session.eid);
  }

  /**
   * The account's kept combat state, aged by the time since it left (dodges refill up to `maxCharges`,
   * its job's); forgotten once taken or after CARRY_KEEP_MS.
   */
  private takeCarry(accountId: string, maxCharges: number): Carry | undefined {
    const kept = this.accounts.carries.get(accountId);
    if (!kept) return undefined;
    this.accounts.carries.delete(accountId);
    const ago = this.wallMs() - kept.at;
    return ago < CARRY_KEEP_MS ? ageCarry(kept.carry, ago / 1000, maxCharges) : undefined;
  }

  /** A dead adventurer already saved as respawned in another zone: this room must not save it again. */
  private savedElsewhere(session: Session): boolean {
    return session.dead && session.respawnSaved && this.zone.id !== RESPAWN_ZONE;
  }

  /**
   * Saves everyone here. A save the store refuses means the adventurer is no longer saved in this zone
   * (a travel that was written although the call failed): that session is sent on rather than left
   * playing unsaved; its client finds the right zone through GET /api/zone.
   */
  private async saveAll() {
    const here = [...this.sessions.values()].filter((session) => !session.travelling && !this.savedElsewhere(session));
    await Promise.all(
      here.map(async (session) => {
        // A death still being saved (as respawned, in the grove): saving it again from here meanwhile
        // would be refused once that lands, and kick the dead adventurer. Wait for it, then look again.
        if (session.deathSave) {
          await session.deathSave;
          if (session.travelling || this.savedElsewhere(session) || this.sessions.get(session.client.sessionId) !== session) return;
        }
        if ((await this.save(session)) !== 'refused') return;
        if (this.sessions.get(session.client.sessionId) === session && !session.travelling) await this.sendOn(session);
      }),
    );
  }

  /** Ends a session whose adventurer is saved in another zone now, without saving, telling the client why. */
  private async sendOn(session: Session) {
    if (session.reconnection) session.reconnection.reject(new Error(REASON_ELSEWHERE));
    await this.removeSession(session.client.sessionId, { save: false });
    if (!session.reconnection) {
      this.sendTo(session.client, 'notice', { text: REASON_ELSEWHERE });
      this.sendTo(session.client, 'kicked', { reason: REASON_ELSEWHERE });
      session.client.leave(CloseCode.CONSENTED);
    }
  }

  /** Saves the adventurer (see write), once any save of its death has settled. */
  private async save(
    session: Session, to?: Pick<AdventurerSave, 'zone' | 'x' | 'z' | 'facing'>, expectZone?: ZoneId,
  ): Promise<'saved' | 'refused' | 'failed'> {
    if (session.deathSave) await session.deathSave;
    return this.write(session, to, expectZone);
  }

  /**
   * Writes the adventurer as it is in this room (or with `to`'s zone and spot, for a travel), only while
   * it is still saved in `expectZone` (by default this zone, or RESPAWN_ZONE for one revived after its
   * death was saved as respawned there): 'saved' if written, 'refused' if the store says it is not
   * (saved elsewhere, or unknown), 'failed' if the store threw (logged).
   */
  private async write(
    session: Session, to?: Pick<AdventurerSave, 'zone' | 'x' | 'z' | 'facing'>, expectZone?: ZoneId,
  ): Promise<'saved' | 'refused' | 'failed'> {
    const expect = expectZone ?? (this.inst ? this.homeZone : session.respawnSaved && !session.dead ? RESPAWN_ZONE : this.zone.id);
    // Where it really is (the state's copy is quantised, and mid-displacement shows the path).
    const { x, z } = session.lastGood, facing = session.facing;
    // Health as a whole number rounded down (at least 1): a relog never gains the fraction.
    const hp = Math.max(1, Math.floor(session.hpExact));
    // The dead are always saved as respawned: at the statue, with full health.
    const dead = session.dead;
    // In an instance: always at the crater mouth in the Greenway (a crash or restart puts it there); the dead at full health.
    const full = Math.max(1, Math.round(session.maxHp));
    const as = this.inst ? { zone: 'greenway' as const, ...LAMPFALL_MOUTH.arrive, ...(dead ? { hp: full } : {}), ...to }
      : dead ? { zone: RESPAWN_ZONE, ...this.respawnSpot(), hp: full } : to;
    let result: 'saved' | 'refused' | 'failed';
    try {
      // Under the session's write lock, with its jobs read only once the lock is held: an inventory write that
      // landed first (a respec, a costume worn) has merged its jobs already, so a save never undoes it.
      result = (await session.lock.run(() => {
        const values: AdventurerSave = { id: session.adventurerId, x, z, facing, zone: this.zone.id, hp, jobs: session.jobs, ...as };
        return this.store.saveAdventurer(values, { zone: expect });
      })) ? 'saved' : 'refused';
    } catch (err) {
      this.logFailure('save', 'Saving an adventurer failed', err);
      return 'failed';
    }
    if (this.inst) return result; // never saved as respawned
    if (result === 'saved' && dead) {
      this.accounts.respawns.set(session.accountId, this.wallMs() + RESPAWN_ADMIT_MS);
      session.respawnSaved = true; // (also when it was revived meanwhile: the store holds the statue until it is saved alive)
    } else if (result === 'saved' && !to && !session.dead) {
      if (session.respawnSaved) this.accounts.respawns.delete(session.accountId);
      session.respawnSaved = false;
    }
    return result;
  }

  /** Logs a failure, at most once a minute per kind (so an outage or a bad tick cannot flood the log); every one is counted. */
  private logFailure(kind: string, what: string, err: unknown) {
    this.stepErrors++;
    const now = Date.now();
    if (now - (this.loggedAt.get(kind) ?? -Infinity) < LOG_EVERY_MS) return;
    this.loggedAt.set(kind, now);
    console.error(`${what} (${this.zone.id}; logged at most once a minute):`, err);
  }

  /** Runs one piece of a step; a throw is counted and logged (throttled) and the step goes on. */
  private safely(kind: string, fn: () => void) {
    try {
      fn();
    } catch (err) {
      this.logFailure(`step:${kind}`, `The ${kind} part of a room step failed`, err);
    }
  }

  private sendTo<K extends keyof S2C>(client: Client, type: K, message: S2C[K]) {
    client.send(type, message);
  }

  /** Where the dead get up: the statue (RESPAWN_ZONE's spawn). */
  private respawnSpot(): { x: number; z: number; facing: number } {
    const { x, z, facing } = this.rooms.get(RESPAWN_ZONE)?.zone.spawn ?? SPAWN;
    return { x, z, facing };
  }

  // ───────── death and respawn ─────────

  /** The engine killed this adventurer: moves stop, and the death is saved as respawned at once. */
  private died(session: Session) {
    session.dead = true;
    session.deadAt = this.nowS();
    session.awaitingDisplace = false;
    session.anim = undefined;
    session.pendingDodge = undefined;
    session.player.moving = false;
    if (this.inst) return; // no statue in an instance: it lies here until revived or released (saved at the mouth)
    if (session.travelling) return; // the travel saves it again as respawned once it has landed
    session.deathSave = this.write(session); // write() marks it respawnSaved
  }

  /**
   * The engine revived this adventurer where it lies (Second Dawn): alive again with the moves' ack it
   * had (nothing moved it), no respawn due; told with `revived`. A death already saved as respawned is
   * saved over by its next save (which expects RESPAWN_ZONE until then: see write).
   */
  private revived(session: Session, r: { hp: number; by: number }) {
    if (!session.dead) return; // a death this room never saw: nothing to undo (the mirror shows it alive)
    Object.assign(session, { dead: false, deadAt: -Infinity, respawnRetryAt: -Infinity, pendingDodge: undefined, awaitingDisplace: false, anim: undefined });
    this.mirrorPlayer(session);
    const message: S2C['revived'] = { hp: r.hp, by: r.by };
    if (session.reconnection) session.missedRevive = message;
    else this.sendTo(session.client, 'revived', message);
  }

  /** Up again at the statue: revived here in RESPAWN_ZONE; from anywhere else, a travel there (one save). */
  private respawn(session: Session) {
    if (this.zone.id !== RESPAWN_ZONE) {
      const destination = this.rooms.get(RESPAWN_ZONE);
      if (!destination) return; // every zone's room exists while the server runs
      // Gone from the fight at once: nobody can revive it now (a Second Dawn on it fizzles).
      this.leaveFight(session);
      this.travel(session, { to: RESPAWN_ZONE, arrive: this.respawnSpot() }, destination, session.lastGood, true);
      return;
    }
    const { x, z, facing } = this.zone.spawn;
    const y = (this.zone.surface(x, z) ?? 0) + 0; // + 0: never -0
    this.combat.revive(session.eid, { x, z, y }, this.nowS());
    this.combat.setPose(session.eid, x, z, y, facing);
    Object.assign(session, {
      dead: false, deadAt: -Infinity, respawnSaved: false, deathSave: undefined, anim: undefined, awaitingDisplace: false,
      pendingDodge: undefined, respawnRetryAt: -Infinity, lastDisplaceKind: 'respawn',
    });
    this.accounts.respawns.delete(session.accountId);
    session.lastGood = { x, z, y };
    session.facing = facing;
    session.movement.air = makeAirTrack(y);
    session.movement.zone = this.zone.id;
    Object.assign(session.player, { x, z, y, facing, moving: false });
    // Poses sent while it was dead are stale now: the respawn starts a new ack.
    const message: S2C['respawned'] = { x, z, y, seq: ++session.displaceSeq };
    session.lastSeqMessage = { type: 'respawned', message };
    this.mirrorPlayer(session);
    this.sendTo(session.client, 'respawned', message);
  }

  // ───────── Lampfall instances ─────────

  /** The zone this room's adventurers are saved in: its own, or for an instance the Greenway (at the crater mouth). */
  private get homeZone(): ZoneId {
    return this.inst ? 'greenway' : this.zone.id;
  }

  /**
   * An instance: its own surface, ground and sight over the shared frozen def (each shut gate circle a
   * wall and blind: P4-b), its camps from the def with each boss camp's arena (P4-c), the Wick Den's way
   * on shut until the Wickhound is cleared (P4-a), and with startAt 'landing' (a test start) only the
   * Warden left.
   */
  private setupInstance(options: ZoneRoomOptions, key: string) {
    const opt = options.instance!;
    const base = options.zone;
    const layout = lampfallLayout();
    const encounterAt = (x: number, z: number): EncounterId | undefined => {
      const i = layout.rooms.findIndex((r) => (x - r.x) * (x - r.x) + (z - r.z) * (z - r.z) <= r.r * r.r);
      return i < 0 ? undefined : layout.recipe.rooms[i].encounter;
    };
    const arenas = { wickhound: lampfallArena('wickhound'), warden: lampfallArena('warden') };
    const landing = opt.startAt === 'landing';
    const cleared = new Set<EncounterId>();
    const camps: CampSpawn[] = [];
    for (const c of base.camps) {
      const enc = encounterAt(c.x, c.z);
      if (landing && enc !== 'warden') {
        if (enc) cleared.add(enc);
        continue;
      }
      camps.push(enc === 'wickhound' || enc === 'warden' ? { ...c, arena: arenas[enc] } : { ...c });
    }
    this.inst = {
      key, registry: opt.registry, t: { ...INSTANCE_TIMINGS, ...opt.timings }, cleared,
      gates: cleared.has('wickhound') ? 0 : GATE_WICK_EXIT, sealed: null, arenas, encounterOf: new Map(), bosses: new Map(),
      wipeAt: null, lastFightAt: -Infinity, fighting: new Map(), lift: false, evictAt: new Map(), startedAt: (options.wallClock ?? Date.now)(),
    };
    const mask = () => this.inst?.gates ?? 0;
    this.zone = { ...base, surface: gatedSurface(base.surface, mask), ground: gatedSurface(base.ground, mask), sight: gatedSight(base.sight, mask), camps, jobSwitch: base.jobSwitch };
    this.autoDispose = false; // the registry closes it
  }

  /** Each camp enemy's encounter (by the room its camp is in), and the bosses' records. */
  private tagEncounters() {
    const inst = this.inst!;
    const layout = lampfallLayout();
    for (const e of worldOf(this.combat).enemies.values()) {
      const i = layout.rooms.findIndex((r) => (e.camp.x - r.x) * (e.camp.x - r.x) + (e.camp.z - r.z) * (e.camp.z - r.z) <= r.r * r.r);
      const enc = i < 0 ? undefined : layout.recipe.rooms[i].encounter;
      if (enc) inst.encounterOf.set(e.id, enc);
      const boss = BOSS_OF[e.kind];
      if (boss) inst.bosses.set(e.id, { ...boss, wokeAt: null, sealAt: null, most: 0 });
    }
  }

  private instanceInfo(): InstanceInfo | undefined {
    return this.inst?.registry.byRoom(this.roomId);
  }

  /** The current checkpoint: the rim, or the landing once the Wickhound is cleared (P4-a). */
  private get checkpoint(): CheckpointId {
    return this.inst?.cleared.has('wickhound') ? 'landing' : 'rim';
  }

  /** Where the current checkpoint stands an adventurer: its room's centre, facing on into the dungeon. */
  private checkpointSpot(): { x: number; z: number; facing: number } {
    const layout = lampfallLayout();
    const id = this.checkpoint;
    const i = layout.rooms.findIndex((r) => r.checkpoint === id);
    const room = layout.rooms[i], next = layout.rooms[i + 1] ?? room;
    return { x: room.x, z: room.z, facing: next === room ? room.entryDir : yawOf(next.x - room.x, next.z - room.z) };
  }

  /** The account has a seat here: a session (in the room or away within its window) or a traveller's held seat. */
  hasSeat(accountId: string): boolean {
    return this.sessionByAccount.has(accountId) || (this.arrivals.get(accountId) ?? -Infinity) > Date.now();
  }

  /** An instance has space for the account (allowed, and a seat already or fewer than PARTY_MAX): the crater mouth's check. */
  hasRoomFor(accountId: string): boolean {
    if (!this.instanceInfo()?.allowed.has(accountId)) return false;
    if (this.hasSeat(accountId)) return true;
    let seats = this.sessionByAccount.size;
    const now = Date.now();
    for (const [id, until] of this.arrivals) if (until > now && !this.sessionByAccount.has(id)) seats++;
    return seats < this.maxPlayers;
  }

  /** Travellers are on their way in. */
  hasArrivals(): boolean {
    const now = Date.now();
    for (const until of this.arrivals.values()) if (until > now) return true;
    return false;
  }

  /** The account left or was kicked from the party: told now, sent to the mouth after INSTANCE_EVICT_S. */
  evict(accountId: string): void {
    const inst = this.inst;
    if (!inst || inst.evictAt.has(accountId)) return;
    inst.evictAt.set(accountId, this.nowS() + inst.t.evictS);
    const session = this.sessionOf(accountId);
    if (session && !session.reconnection) this.notice(session, REASON_LEFT_PARTY, this.wallMs());
  }

  /** The registry gave this instance a new key (a party formed around it, or dissolved). */
  rekeyed(key: string): void {
    if (this.inst) this.inst.key = key;
  }

  /** Closing: everyone is sent to the mouth (with `reason`), then the room disconnects. */
  async closeInstance(reason?: string): Promise<void> {
    const now = this.wallMs();
    for (const session of [...this.sessions.values()]) {
      if (session.travelling) continue;
      if (reason && !session.reconnection) this.notice(session, reason, now);
      this.travelOut(session);
    }
    this.arrivals.clear();
    await Promise.allSettled([...this.travels.values()]);
    if (!this.disposed) await this.disconnect();
  }

  /** Walking into the crater mouth: refused (corrected, with a notice) mid-fight or when every instance is taken. */
  private mayEnterMouth(session: Session, now: number): boolean {
    const reg = this.instances;
    const refuse = (text: string) => {
      this.correct(session, now);
      this.notice(session, text, now);
      return false;
    };
    if (!reg) return refuse(REASON_INSTANCES_FULL);
    if (this.combat.self(session.eid)?.inCombat) return refuse(REASON_IN_COMBAT);
    if (!reg.canEnter(reg.keyFor(session.accountId, this.parties))) return refuse(REASON_INSTANCES_FULL);
    return true;
  }

  /**
   * Into the party's instance (opened now if it has none): its seat is held, the adventurer is saved at
   * the crater mouth in the Greenway, and the client is told to join the instance by id. If it cannot
   * get in after all (the last instance went to another party meanwhile), it is put back with the notice.
   */
  private enterInstance(session: Session, before: Session['lastGood']) {
    const reg = this.instances!;
    const sessionId = session.client.sessionId;
    const key = reg.keyFor(session.accountId, this.parties);
    const members = this.parties.partyOf(session.accountId)?.members.map((m) => m.accountId) ?? [];
    const entering = (async () => {
      let r: InstanceInfo | 'full';
      try {
        r = await reg.enter(key, session.accountId, members);
      } catch (err) {
        this.logFailure('instance', 'Opening an instance failed', err);
        r = 'full';
      }
      const room = r === 'full' ? null : r.room;
      if (this.sessions.get(sessionId) !== session) {
        await this.save(session); // kicked or gone meanwhile: saved here as it is
        return;
      }
      if (r === 'full' || !room || !room.hasRoomFor(session.accountId)) {
        session.travelling = undefined;
        session.lastGood = before;
        Object.assign(session.player, before, { moving: false });
        this.combat.setPose(session.eid, before.x, before.z, before.y, session.facing);
        this.correct(session, this.wallMs());
        this.notice(session, REASON_INSTANCES_FULL, this.wallMs());
        return;
      }
      reg.hold(session.accountId, room.roomId, room.reconnectSeconds * 1000);
      session.travelling = undefined;
      this.travel(session, { to: 'lampfall', arrive: LAMPFALL_MOUTH.arrive }, room, before, false, room.roomId);
      await session.travelling;
    })().finally(() => { if (this.travels.get(sessionId) === entering) this.travels.delete(sessionId); });
    session.travelling = entering;
    this.travels.set(sessionId, entering);
  }

  /** Out of the instance to the crater mouth (the stair, the lamp-lift, leaveInstance, an eviction, a close). */
  private travelOut(session: Session) {
    const greenway = this.rooms.get('greenway');
    if (!greenway || session.travelling) return;
    this.leaveFight(session);
    this.travel(session, { to: 'greenway', arrive: LAMPFALL_MOUTH.arrive }, greenway, session.lastGood);
  }

  /** `release`: dead in an instance, from RELEASE_MIN_S on: up at the checkpoint (else refused as a respawn would be). */
  private onRelease(client: Client) {
    const session = this.actor(client);
    if (!session) return;
    if (!this.inst || !session.dead) return this.refuse(session, 'respawn', 'invalid');
    if (this.nowS() - session.deadAt < this.inst.t.releaseMinS - 1e-6) return this.refuse(session, 'respawn', 'cooldown');
    this.release(session);
  }

  /** `leaveInstance`: alive in an instance, out to the crater mouth. */
  private onLeaveInstance(client: Client) {
    const session = this.actor(client);
    if (!session || !this.inst) return;
    if (session.dead) return this.refuse(session, 'respawn', 'dead');
    this.travelOut(session);
  }

  /** Up at the instance's checkpoint at full health (a release, or the end of a wipe). */
  private release(session: Session) {
    const { x, z, facing } = this.checkpointSpot();
    this.standUp(session, x, z, facing);
  }

  /** Revived at (x, z) with full health, a new ack (`respawned`), and nothing of the death left. */
  private standUp(session: Session, x: number, z: number, facing: number) {
    const y = (this.zone.surface(x, z) ?? 0) + 0; // + 0: never -0
    this.combat.revive(session.eid, { x, z, y }, this.nowS());
    this.combat.setPose(session.eid, x, z, y, facing);
    Object.assign(session, {
      dead: false, deadAt: -Infinity, respawnSaved: false, deathSave: undefined, anim: undefined, awaitingDisplace: false,
      pendingDodge: undefined, respawnRetryAt: -Infinity, lastDisplaceKind: 'respawn',
    });
    session.lastGood = { x, z, y };
    session.facing = facing;
    session.movement.air = makeAirTrack(y);
    session.movement.zone = this.zone.id;
    Object.assign(session.player, { x, z, y, facing, moving: false });
    const message: S2C['respawned'] = { x, z, y, seq: ++session.displaceSeq };
    session.lastSeqMessage = { type: 'respawned', message };
    this.mirrorPlayer(session);
    if (!session.reconnection) this.sendTo(session.client, 'respawned', message);
  }

  /**
   * The party the engine has the adventurer in: its party's id; in an instance while an arena is sealed,
   * those outside it are put apart (`id#out`), so no automatic or area heal, buff or revive reaches in
   * (an explicit one needs sight, which a shut gate blocks): ruling P4-c.
   */
  private applyParty(session: Session) {
    const id = this.parties.partyOf(session.accountId)?.id || null;
    const sealed = this.inst?.sealed;
    const want = id && sealed && !this.inst!.arenas[sealed](session.lastGood.x, session.lastGood.z) ? `${id}#out` : id;
    if (want === session.engineParty && this.combat.get(session.eid)) return;
    session.engineParty = want;
    this.combat.setParty(session.eid, want);
  }

  /** Accepting `partyId` would put the account in a party whose instance is not the one it stands in ('in-instance'). */
  private inOtherInstance(accountId: string, partyId: string): boolean {
    const reg = this.instances;
    const mine = reg?.instanceOf(accountId);
    if (!reg || !mine) return false;
    const inviter = this.parties.inviterOf(partyId, accountId);
    const theirs = this.parties.get(partyId) ? reg.byKey(partyId) : inviter !== undefined ? reg.instanceOf(inviter) : undefined;
    return theirs !== undefined && theirs !== mine;
  }

  /** A kill inside: nothing respawns; an encounter whose enemies are all dead is cleared; a boss's death opens its gates and rewards. */
  private instanceKill(kill: TickOut['kills'][number], xp: Map<Session, number>, nowS: number) {
    const inst = this.inst!;
    const e = worldOf(this.combat).enemies.get(kill.enemy);
    if (e) e.respawnAt = Infinity; // killed enemies stay dead
    const enc = inst.encounterOf.get(kill.enemy);
    if (enc && !inst.cleared.has(enc)) {
      const w = worldOf(this.combat);
      const left = [...inst.encounterOf].some(([id, en]) => en === enc && w.enemies.get(id)?.alive);
      if (!left) {
        inst.cleared.add(enc);
        this.clearRewards(enc);
      }
    }
    const boss = inst.bosses.get(kill.enemy);
    if (!boss) return;
    inst.bosses.delete(kill.enemy);
    this.unseal(boss.encounter);
    if (boss.encounter === 'wickhound') inst.gates &= ~GATE_WICK_EXIT; // on to the landing (its checkpoint counts now)
    else {
      inst.lift = true;
      inst.registry.markCleared(this.roomId);
    }
    const credited = [...xp].map(([session, gained]) => ({ session, xp: gained }));
    const seconds = Math.max(0.1, Math.round((nowS - (boss.wokeAt ?? nowS)) * 10) / 10);
    const most = Math.max(boss.most, this.sessions.size);
    void this.bossFallen(boss.boss, seconds, most, credited).catch((err) => this.logFailure('rewards', 'A boss reward failed', err));
  }

  /** A pack encounter cleared: each adventurer credited for any of its kills and still here gets CLEAR_XP (with catch-up) and its clear loot. */
  private clearRewards(enc: EncounterId) {
    const credited = this.encounterCredit.get(enc);
    this.encounterCredit.delete(enc);
    if (!credited || !(PACK_ENCOUNTERS as readonly string[]).includes(enc)) return;
    const day = utcDay(this.wallMs());
    for (const accountId of credited) {
      const session = this.sessionOf(accountId);
      if (!session) continue;
      this.gainXpAmount(session, clearXp(session.jobs, session.jobs.current));
      session.loot.push({
        src: { clear: enc }, seedParts: [this.serverSeed, this.roomId, `clear:${enc}`, 0, accountId], killKey: `${this.roomId}:clear:${enc}`,
        job: session.jobs.current, day, x: session.lastGood.x, z: session.lastGood.z,
      });
    }
  }

  /** A boss woke (its gate shuts SEAL_DELAY_S later) or reset (its gate opens again). */
  private bossEvent(b: BossEvent) {
    const inst = this.inst!;
    const boss = inst.bosses.get(b.enemy);
    if (!boss) return;
    if (b.event === 'wake') {
      boss.wokeAt = b.atS;
      boss.sealAt = b.atS + inst.t.sealS;
      boss.most = this.sessions.size;
    } else if (b.event === 'reset') {
      boss.wokeAt = null;
      boss.sealAt = null;
      boss.most = 0;
      this.unseal(boss.encounter);
    }
  }

  /** The gate shuts: a wall now; anyone standing in its circle is put on the room side (a `displaced` resync). */
  private seal(encounter: ArenaEncounter) {
    const inst = this.inst!;
    inst.sealed = encounter;
    inst.gates |= ENTRY_GATE[encounter];
    for (const g of lampfallGates()) {
      if ((inst.gates & g.bit) === 0) continue;
      for (const session of this.sessions.values()) {
        const p = session.lastGood;
        if ((p.x - g.x) * (p.x - g.x) + (p.z - g.z) * (p.z - g.z) > g.r * g.r || session.travelling) continue;
        const to = roomSideOf(g);
        this.placeAt(session, to.x, to.z);
      }
    }
    for (const session of this.sessions.values()) this.applyParty(session);
  }

  /** Puts the adventurer at (x, z) on the surface: a `displaced` resync (a new ack; its client is put there). */
  private placeAt(session: Session, x: number, z: number) {
    const y = (this.zone.surface(x, z) ?? session.lastGood.y) + 0;
    this.combat.setPose(session.eid, x, z, y, session.facing);
    Object.assign(session.player, { x, z, y, moving: false });
    session.anim = undefined;
    session.pendingDodge = undefined;
    session.awaitingDisplace = false;
    const at = { x, z, y };
    this.displace(session, {
      id: session.eid, kind: 'resync', from: at, d: { vx: 0, vz: 0, vy: 0, seconds: 0 },
      result: { ...at, drop: 0, drops: [], fallHp: 0, seconds: 0, grounded: true, path: [{ t: 0, ...at }] },
    });
  }

  /** Test-only (in-process tests): puts a session's adventurer at (x, z); the ack its moves carry from now on. */
  testPlace(sessionId: string, x: number, z: number): number {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('no such session');
    this.placeAt(session, x, z);
    return session.displaceSeq;
  }

  private unseal(encounter: ArenaEncounter) {
    const inst = this.inst!;
    for (const boss of inst.bosses.values()) if (boss.encounter === encounter) boss.sealAt = null;
    inst.gates &= ~ENTRY_GATE[encounter];
    if (inst.sealed === encounter) inst.sealed = null;
    for (const session of this.sessions.values()) this.applyParty(session);
  }

  /** Each step in an instance: seals due, evictions due, the wipe rule, the party split, and the instance state and views. */
  private stepInstance(now: number) {
    const inst = this.inst!;
    if (!this.state.instance && this.roomId) this.state.instance = this.roomId;
    for (const boss of inst.bosses.values()) {
      if (boss.wokeAt !== null) boss.most = Math.max(boss.most, this.sessions.size);
      if (boss.sealAt !== null && now >= boss.sealAt) {
        boss.sealAt = null;
        this.seal(boss.encounter);
      }
    }
    const info = this.instanceInfo();
    for (const [accountId, at] of inst.evictAt) {
      if (info?.allowed.has(accountId)) {
        inst.evictAt.delete(accountId); // back in the party in time
        continue;
      }
      if (now < at) continue;
      inst.evictAt.delete(accountId);
      const session = this.sessionOf(accountId);
      if (session) this.travelOut(session);
    }
    // a fight is on while any enemy targets someone
    for (const e of this.state.enemies.values()) {
      if (e.target < 0 && e.mode !== 'windup') continue;
      inst.lastFightAt = now;
      inst.fighting.set(e.eid, now);
    }
    for (const [id, at] of inst.fighting) if (now - at > WIPE_FIGHT_S) inst.fighting.delete(id);
    const everyone = [...this.sessions.values()].filter((s) => !s.travelling);
    if (inst.wipeAt === null && everyone.length > 0 && everyone.every((s) => s.dead) && now - inst.lastFightAt <= WIPE_FIGHT_S) {
      inst.wipeAt = now + inst.t.wipeS;
      // every engaged enemy goes home now, once (one that already reset itself answers false: nothing to do)
      for (const id of inst.fighting.keys()) this.combat.resetEnemy(id, now);
      inst.fighting.clear();
    }
    if (inst.wipeAt !== null && now >= inst.wipeAt) {
      inst.wipeAt = null;
      for (const session of this.sessions.values()) if (session.dead && !session.travelling) this.release(session);
    }
    for (const session of this.sessions.values()) this.applyParty(session);
    this.mirrorInstance();
    for (const session of this.sessions.values()) this.sendInstance(session);
  }

  /** The instance's state: its room id, sealed arena, shut gates, wipe clock and lamp-lift. */
  private mirrorInstance() {
    const inst = this.inst!, st = this.state;
    const sealed = inst.sealed ?? '', wipeAt = inst.wipeAt === null ? 0 : this.clockSteps(inst.wipeAt);
    if (st.sealed !== sealed) st.sealed = sealed;
    if (st.gates !== inst.gates) st.gates = inst.gates;
    if (st.wipeAt !== wipeAt) st.wipeAt = wipeAt;
    if (st.lift !== inst.lift) st.lift = inst.lift;
  }

  /** The instance as this adventurer sees it, sent when any of its parts changes (the countdowns are sent as they stand then). */
  private sendInstance(session: Session) {
    if (session.reconnection) return;
    const inst = this.inst!, now = this.nowS();
    const view: InstanceView = {
      checkpoint: this.checkpoint, cleared: [...inst.cleared], sealed: inst.sealed,
      wipeIn: inst.wipeAt === null ? null : round2(Math.max(0, inst.wipeAt - now)),
      releaseIn: session.dead ? round2(Math.max(0, session.deadAt + inst.t.releaseMinS - now)) : null,
      partySize: this.parties.get(inst.key)?.members.length ?? 1, startedAt: inst.startedAt,
    };
    const key = JSON.stringify({ ...view, wipeIn: view.wipeIn !== null, releaseIn: session.dead ? session.deadAt : null });
    if (key === session.instanceSent) return;
    session.instanceSent = key;
    this.sendTo(session.client, 'instance', view);
  }

  /**
   * A boss fell: the kill on the leaderboard (with its rank), and for each credited adventurer its
   * victory: the xp it got, for the Warden one Seal a UTC day (awardSeal is atomic: a retry, a reconnect
   * or a second kill that day gives none) and, for a solo kill, the title.
   */
  private async bossFallen(boss: 'wickhound' | 'fallen_warden', seconds: number, most: number, credited: { session: Session; xp: number }[]) {
    if (credited.length === 0) return;
    const names = credited.map((c) => c.session.player.name).slice(0, PARTY_MAX);
    const partySize = Math.min(PARTY_MAX, Math.max(1, credited.length, most));
    const solo = credited.length === 1 && most <= 1;
    const rank = await this.retry('boss kill', () => this.store.recordBossKill({ boss, partySize, seconds, names, at: new Date(this.wallMs()) }));
    const day = utcDay(this.wallMs());
    await Promise.all(credited.map(async ({ session, xp }) => {
      let seal = false, seals = 0, title: string | null = null;
      if (boss === 'fallen_warden') {
        // (read first: a retry after a lost answer says "already today", and the count tells whether it was this kill)
        const before = await this.retry('seals', () => this.store.getOrCreateAdventurer(session.accountId));
        const r = await this.retry('seal', () => this.store.awardSeal(session.adventurerId, day));
        if (r) seal = r.awarded || (before !== undefined && before.sealDay !== day && r.seals > before.seals);
        if (r) seals = r.seals;
        // the award bumped inv_version: the queue reads the new truth (and the owner hears its Seals)
        if (r?.awarded) {
          session.queue.markStale();
          void session.queue.push({ retries: 0, run: () => ({ kind: 'none', info: null }), settle: (res) => this.settleInv(session, null, res) });
        }
        if (solo && (await this.retry('title', () => this.store.addTitle(session.adventurerId, SOLO_TITLE))) !== undefined) title = SOLO_TITLE;
      } else {
        seals = (await this.retry('seals', () => this.store.getOrCreateAdventurer(session.accountId)))?.seals ?? 0;
      }
      const victory: VictoryView = { boss, seconds, partySize, xp, seal, seals, title, rank: rank?.rank ?? null, lore: BOSSES[boss].lore.victory };
      const claim = this.accounts.get(session.accountId);
      claim?.room.deliver(claim.sessionId, 'victory', victory);
    }));
  }

  /** A store call, tried up to three times (logged when it gives up): undefined if it never succeeded. */
  private async retry<T>(what: string, call: () => Promise<T>): Promise<T | undefined> {
    for (let i = 0; i < 3; i++) {
      try {
        return await call();
      } catch (err) {
        if (i === 2) this.logFailure('rewards', `A reward (${what}) could not be saved`, err);
        else await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    return undefined;
  }

  // ───────── the step ─────────

  /** The combat clock now (seconds). */
  private nowS(): number {
    return this.clockS();
  }

  /** p95 of the room's step time over the last 5 s, in ms (0 before any step). */
  get tickMsP95(): number {
    forgetOld(this.tickTimes, Date.now());
    return p95(this.tickTimes);
  }

  /** One room step, timed: every part of it runs, whatever another part throws (see safely). */
  private step() {
    const started = performance.now();
    this.advance();
    const now = Date.now();
    this.tickTimes.push({ at: now, ms: performance.now() - started });
    forgetOld(this.tickTimes, now);
  }

  /**
   * Runs the engine up to the combat clock (one tick per 1/TICK_HZ, at most MAX_TICKS_PER_STEP),
   * handling each tick's displacements, deaths and kills one by one; then, per session, moves
   * displaced bodies along their paths, rolls held dodges, resyncs lost displacements, reconciles
   * deaths the step missed and respawns the long dead; then mirrors the state and sends fx and `self`.
   */
  private advance() {
    const w0 = this.lastTickAt;
    const target = Math.max(this.nowS(), w0);
    const n = Math.min(MAX_TICKS_PER_STEP, Math.max(1, Math.round((target - w0) * TICK_HZ)));
    const fx: FxEvent[] = [];
    this.safely('held dodges', () => {
      for (const session of this.sessions.values()) {
        const held = session.pendingDodge;
        if (held && held.due <= target && !session.dead && !session.travelling) this.startDodge(session, held.dx, held.dz, Math.max(target, held.due));
      }
    });
    this.safely('threat', () => this.seeThreat());
    for (let k = 1; k <= n; k++) {
      let out: TickOut | undefined;
      this.safely('tick', () => { out = this.combat.tick(w0 + ((target - w0) * k) / n); });
      if (!out) break;
      this.handle(out, w0 + ((target - w0) * k) / n);
      for (const e of out.fx) fx.push(e);
    }
    this.lastTickAt = target;
    this.steps++;
    const wall = this.wallMs();
    for (const session of this.sessions.values()) {
      this.safely('session', () => {
        if (session.anim) this.animate(session);
        if (session.awaitingDisplace && !session.pendingDodge && target - session.awaitingSince > DISPLACE_RESYNC_S) this.resync(session);
        if (!session.dead && this.combat.get(session.eid)?.alive === false) this.died(session); // a death the step lost
        if (this.inst) {
          if (session.dead && !session.travelling && target - session.deadAt >= this.inst.t.autoReleaseS) this.release(session);
        } else if (session.dead && !session.travelling && target - session.deadAt >= this.autoRespawnSeconds && wall >= session.respawnRetryAt) this.respawn(session);
        if (session.jobsDue && !session.reconnection) this.sendJobs(session);
        if (session.invDue && !session.reconnection) {
          session.invDue = false;
          this.sendInventory(session);
          this.sendTo(session.client, 'lookFree', { free: session.queue.snapshot.lookFree });
        }
        this.flushLoot(session);
        if (session.kitPending) this.refreshKit(session);
      });
    }
    if (this.inst) this.safely('instance', () => this.stepInstance(target));
    this.safely('mirror', () => this.mirrorAll());
    this.safely('party', () => this.relayPartyStatus(wall));
    this.safely('views', () => this.updateViews());
    for (const session of this.sessions.values()) this.safely('looks', () => this.sendLooks(session));
    if (fx.length > 0) this.safely('fx', () => this.sendFx(fx));
    if (this.steps % SELF_EVERY_STEPS === 0) {
      for (const session of this.sessions.values()) this.safely('self', () => this.sendSelf(session));
    }
  }

  /** Each engaged enemy's threat table now (the step's kills clear them): who fought an enemy that then died without crediting them. */
  private seeThreat() {
    const enemies = worldOf(this.combat).enemies;
    for (const id of this.threatSeen.keys()) if (!enemies.has(id)) this.threatSeen.delete(id); // gone (despawned)
    for (const e of enemies.values()) {
      if (!e.alive) continue; // (a dead one keeps what was seen until its kill is handled)
      const ids = e.threat.ids();
      if (ids.length > 0) this.threatSeen.set(e.id, ids);
      else this.threatSeen.delete(e.id);
    }
  }

  /** A tick's displacements, deaths and kills, each on its own (one that throws does not stop the rest). */
  private handle(out: TickOut, nowS: number) {
    for (const d of out.displaced) {
      const session = this.sessionByEid.get(d.id);
      if (session) this.safely('displace', () => this.displace(session, d));
    }
    for (const id of out.died) {
      const session = this.sessionByEid.get(id);
      if (session && !session.dead) this.safely('death', () => this.died(session));
    }
    // (kills before despawned: an add that died this tick is still in the state for its credit)
    for (const kill of out.kills) {
      const xp = new Map<Session, number>();
      let credited = this.creditedFor(kill);
      // a boss: only those inside its arena (the dead lying there too), never a member waiting outside
      const boss = this.inst?.bosses.get(kill.enemy);
      if (boss) {
        const arena = this.inst!.arenas[boss.encounter];
        credited = new Set([...credited].filter((c) => arena(c.lastGood.x, c.lastGood.z)));
      }
      const counter = ++this.killCounter;
      const at = this.combat.get(kill.enemy) ?? this.state.enemies.get(this.keyOf(kill.enemy));
      const day = utcDay(this.wallMs());
      const hasLoot = (() => { const row = lootTable({ kind: kill.kind, zone: this.zone.id }); return row.gold[1] > 0 || row.tier !== null; })();
      for (const session of credited) {
        this.safely('credit', () => {
          this.sendTo(session.client, 'credit', { kind: kill.kind });
          xp.set(session, this.gainXp(session, kill.kind));
          if (hasLoot) {
            session.loot.push({
              src: { kind: kill.kind, zone: this.zone.id }, seedParts: [this.serverSeed, this.roomId, kill.enemy, counter, session.accountId],
              killKey: `${this.roomId}:${kill.enemy}:${counter}`, job: session.jobs.current, day, x: at?.x ?? 0, z: at?.z ?? 0,
            });
          }
        });
      }
      // fought it, but too little to be credited (and no party member nearby shared it): said, not silent
      const seen = this.threatSeen.get(kill.enemy) ?? [];
      this.threatSeen.delete(kill.enemy);
      for (const id of seen) {
        const session = this.sessionByEid.get(id);
        if (session && !credited.has(session) && !session.reconnection) this.notice(session, NO_CREDIT_TEXT, this.wallMs());
      }
      if (this.inst) {
        const enc = this.inst.encounterOf.get(kill.enemy);
        if (enc && (PACK_ENCOUNTERS as readonly string[]).includes(enc)) {
          let set = this.encounterCredit.get(enc);
          if (!set) this.encounterCredit.set(enc, (set = new Set()));
          for (const session of credited) set.add(session.accountId);
        }
        this.safely('instance kill', () => this.instanceKill(kill, xp, nowS));
      }
    }
    for (const b of out.boss ?? []) if (this.inst) this.safely('boss', () => this.bossEvent(b));
    for (const id of out.despawned ?? []) this.safely('despawn', () => this.dropEnemy(id));
    for (const r of out.revived ?? []) {
      const session = this.sessionByEid.get(r.id);
      if (session) this.safely('revive', () => this.revived(session, r));
    }
  }

  /**
   * Who a kill credits: the engine's credited adventurers, and every party member of one of them that is
   * in this room within PARTY_SHARE_R of the enemy (alive or dead), each once.
   */
  private creditedFor(kill: TickOut['kills'][number]): Set<Session> {
    const credited = new Set<Session>();
    for (const id of kill.credit) {
      const session = this.sessionByEid.get(id);
      if (session) credited.add(session);
    }
    const at = this.combat.get(kill.enemy) ?? this.state.enemies.get(this.keyOf(kill.enemy));
    if (!at) return credited;
    const r2 = PARTY_SHARE_R * PARTY_SHARE_R;
    for (const session of [...credited]) {
      for (const m of this.parties.partyOf(session.accountId)?.members ?? []) {
        const other = this.sessionOf(m.accountId);
        if (other && !credited.has(other) && dist2(other.lastGood, at) <= r2) credited.add(other);
      }
    }
    return credited;
  }

  /**
   * A dodge accepted but never stamped (its step failed): the client is put where the engine has it,
   * with a new seq (`displaced` kind 'resync', from = to), and its moves count again.
   */
  private resync(session: Session) {
    const v = this.combat.get(session.eid);
    if (!v) return;
    const at = { x: v.x, z: v.z, y: v.y + 0 };
    const path = [{ t: 0, ...at }];
    this.displace(session, {
      id: session.eid, kind: 'resync', from: at, d: { vx: 0, vz: 0, vy: 0, seconds: 0 },
      result: { ...at, drop: 0, drops: [], fallHp: 0, seconds: 0, grounded: true, path },
    });
  }

  /**
   * Stamps a displacement on the movement checks: a new ack, the end as the last accepted pose,
   * standing there, an allowance of at most a full one plus DISPLACE_FUZZ_M, and the falls on the way
   * charged; then tells the client, and everyone else sees the body travel the path.
   */
  private displace(session: Session, d: DisplaceOut | (Omit<DisplaceOut, 'kind'> & { kind: 'resync' })) {
    if (!d.result.grounded) return; // no displacement (the engine sends none like this)
    const kind = d.kind;
    const end = { x: d.result.x, z: d.result.z, y: d.result.y + 0 };
    const seq = ++session.displaceSeq;
    session.awaitingDisplace = false;
    // A dodge still held for its gap gives way to this: say so (the client predicted it, and rolls back).
    if (session.pendingDodge && kind !== 'dodge' && !session.reconnection) this.refuse(session, 'dodge', 'busy');
    session.pendingDodge = undefined;
    session.lastDisplaceKind = kind;
    session.lastGood = end;
    const movement = session.movement;
    const now = this.wallMs();
    // Knocked in mid-air: the fall it was already in is charged too, from its highest point to where the push began.
    const air = movement.air;
    // (Down to where the push really starts: an airborne start more than 2 m up is clamped, path[0].)
    const pushedFrom = d.result.path[0]?.y ?? d.from.y;
    const before = air.grounded ? 0 : fallDamage(Math.max(air.peakY, air.airStartY) - pushedFrom);
    movement.air = makeAirTrack(end.y);
    const scale = this.combat.speedScale(session.eid, this.nowS());
    movement.metres = Math.min(refillAllowance(movement.metres, (now - movement.at) / 1000, scale), MAX_MOVE_ALLOWANCE * Math.max(1, scale)) + DISPLACE_FUZZ_M;
    movement.at = now;
    if (before + d.result.fallHp > 0) this.fall(session, before + d.result.fallHp);
    session.anim = kind === 'resync' ? undefined : { path: d.result.path, i: 1 };
    if (kind === 'resync') Object.assign(session.player, end);
    session.player.moving = false;
    const message: S2C['displaced'] = { seq, kind, from: { ...d.from }, d: { ...d.d }, to: end };
    session.lastSeqMessage = { type: 'displaced', message };
    if (!session.reconnection) this.sendTo(session.client, 'displaced', message);
  }

  /** One path sample further along a displacement (one a step: the samples are 1/TICK_HZ apart). */
  private animate(session: Session) {
    const anim = session.anim!;
    const p = anim.path[Math.min(anim.i, anim.path.length - 1)];
    Object.assign(session.player, { x: p.x, z: p.z, y: p.y + 0 });
    if (++anim.i >= anim.path.length) {
      Object.assign(session.player, session.lastGood);
      session.anim = undefined;
    }
  }

  /**
   * Each client gets the events that involve its adventurer, or whose focus (target, else source) is in
   * its view: what it can draw (FX_RADIUS is the interest radius).
   */
  private sendFx(events: FxEvent[]) {
    const focus = events.map((e) => this.viewedOf(fxFocus(e)));
    for (const session of this.sessions.values()) {
      if (session.reconnection) continue;
      const mine = events.filter((e, i) => {
        if (fxInvolves(e, session.eid)) return true;
        const at = focus[i];
        return at !== undefined && session.seen.has(at);
      });
      if (mine.length > 0) this.sendTo(session.client, 'fx', { events: mine });
    }
  }

  /** The state entry of an engine id: an adventurer's PlayerState or an enemy's EnemyState. */
  private viewedOf(eid: number): Viewed | undefined {
    return this.sessionByEid.get(eid)?.player ?? this.state.enemies.get(this.keyOf(eid));
  }

  // ───────── interest (per-client views) ─────────

  /** Every connected client's view, from a grid of everyone's position rebuilt for the step. */
  private updateViews() {
    this.fillGrid();
    for (const session of this.sessions.values()) {
      const full = (session.viewTurn + this.steps) % VIEW_FULL_EVERY_STEPS === 0;
      if (!session.reconnection) this.safely('view', () => this.updateView(session, full));
    }
  }

  /** The grid holds every adventurer and enemy in the state, where it is now. */
  private fillGrid() {
    const grid = this.grid;
    grid.clear();
    for (const session of this.sessions.values()) grid.insert(session.player);
    for (const list of this.targeting.values()) list.length = 0;
    for (const e of this.state.enemies.values()) {
      grid.insert(e);
      if (e.target < 0) continue;
      let list = this.targeting.get(e.target);
      if (!list) this.targeting.set(e.target, (list = []));
      list.push(e);
    }
    // an adventurer nobody targets any more (or one that left) keeps no entry: the map holds the targeted only
    for (const [eid, list] of this.targeting) if (list.length === 0) this.targeting.delete(eid);
  }

  /** Adventurers a view keeps whatever the radius and the cap: its party members in this room (shown and kept like the target). */
  private pinnedAdventurers(session: Session): readonly PlayerState[] {
    return session.pins;
  }

  /** One client's view brought up to date now (a join, a reconnect), from a fresh grid. */
  private refreshView(session: Session) {
    this.safely('views', () => {
      this.fillGrid();
      this.updateView(session);
    });
  }

  /**
   * One client's view, by the interest rule (interested): adventurers and enemies within the radius
   * come in, and go out only beyond the hysteresis band. Adventurers are capped at the nearest
   * viewCap.max (rank hysteresis: in at rank ≤ max, out past max + slack); enemies are not. Its own
   * adventurer is always in it. Shown and kept whatever the radius or the cap: the enemy it targets,
   * enemies targeting it, the owner of any telegraph it sees, and its pinned adventurers (parties,
   * later). A telegraph is seen when any part of it reaches within the radius (telegraphInterested)
   * or its owner is seen, and stays until it resolves. Telegraphs and pins are checked every step;
   * the radius and the cap (`full`) every VIEW_FULL_EVERY_STEPS steps. Cost: the grid cells around it
   * plus what it sees (plus a sort of the adventurers in range when there are more than the cap).
   */
  private updateView(session: Session, full = true) {
    const me = session.player, seen = session.seen, view = session.view;
    const owners = this.owners;
    owners.clear();
    const show = (item: Viewed) => {
      if (seen.has(item)) return;
      seen.add(item);
      view.add(item);
      if (item instanceof PlayerState) this.lookDue(session, item);
    };
    for (const f of this.state.fields.values()) show(f); // every field, whatever the radius
    for (const t of this.state.telegraphs.values()) {
      const owner = this.state.enemies.get(this.keyOf(t.owner));
      if (!seen.has(t) && !telegraphInterested(me, t) && !(owner && seen.has(owner))) continue;
      show(t);
      owners.add(t.owner);
      if (owner) show(owner);
    }
    const target = me.target >= 0 ? this.state.enemies.get(this.keyOf(me.target)) : undefined;
    if (target) show(target);
    for (const e of this.targeting.get(me.eid) ?? NO_ENEMIES) show(e);
    const pinned = this.pinnedAdventurers(session);
    for (const p of pinned) show(p);
    if (!full) return;

    // Adventurers within the radius rule, ranked by distance when there are more than the cap.
    const near = this.near, nearD2 = this.nearD2, keep = this.keep;
    near.length = 0;
    nearD2.length = 0;
    keep.clear();
    this.grid.near(me.x, me.z, (item) => {
      if (item === me) return;
      const d2 = dist2(me, item);
      if (item instanceof EnemySchema) {
        if (!seen.has(item) && interested(d2, false)) show(item);
      } else if (interested(d2, seen.has(item))) {
        near.push(item as PlayerState);
        nearD2.push(d2);
      }
    });
    const { max, slack } = this.viewCap;
    if (near.length <= max) {
      for (const p of near) keep.add(p);
    } else {
      const order = this.order;
      order.length = 0;
      for (let k = 0; k < near.length; k++) order.push(k);
      order.sort((i, j) => nearD2[i] - nearD2[j]);
      for (let rank = 1; rank <= order.length; rank++) {
        const p = near[order[rank - 1]];
        if (rank <= max || (rank <= max + slack && seen.has(p))) keep.add(p);
      }
    }
    for (const p of keep) show(p);
    for (const item of seen) {
      if (item instanceof TelegraphSchema || item instanceof FieldSchema) continue;
      if (item instanceof EnemySchema) {
        if (interested(dist2(me, item), true) || item === target || item.target === me.eid || owners.has(item.eid)) continue;
      } else if (keep.has(item as PlayerState) || pinned.includes(item as PlayerState)) continue;
      seen.delete(item);
      view.remove(item);
    }
  }

  /** The owner's own numbers, when they changed since the last `self`. */
  private sendSelf(session: Session) {
    if (session.reconnection) return;
    const view = this.combat.self(session.eid);
    if (!view) return;
    const cast = view.cast ?? null;
    const self: SelfView = {
      ...view, momentum: round2(view.momentum), cd: view.cd.map(round2), gcd: round2(view.gcd),
      swapCd: 0, swapLock: 0, // deprecated (Plan 3), until the engine's SelfView drops them (Task 7)
      dodgeNextIn: round2(view.dodgeNextIn), charge: view.charge === null ? null : round2(view.charge),
      cast: cast && { ability: cast.ability, total: round2(cast.total), left: round2(cast.left) },
    };
    const json = JSON.stringify(self);
    if (json === session.lastSelf) return;
    session.lastSelf = json;
    this.sendTo(session.client, 'self', self);
  }

  /** The engine's view of one adventurer onto its PlayerState (after an intent or a fall; steps use mirrorAll). */
  private mirrorPlayer(session: Session) {
    const v = this.combat.get(session.eid);
    if (v) this.mirrorPlayerView(session, v);
  }

  /** One pass over the engine's combatants: each enemy and each adventurer's state (only fields that changed are set). */
  private mirrorAll() {
    const clock = this.clockSteps(worldOf(this.combat).now);
    if (this.state.clock !== clock) this.state.clock = clock;
    for (const v of this.combat.all()) {
      if (v.team === 'enemy') this.mirrorEnemy(v);
      else {
        const session = this.sessionByEid.get(v.id);
        if (session) this.mirrorPlayerView(session, v);
      }
    }
    this.mirrorTelegraphs();
    this.mirrorFields();
  }

  private mirrorPlayerView(session: Session, v: CombatantView) {
    const p = session.player;
    session.hpExact = v.hp;
    const hp = v.alive ? Math.max(1, Math.ceil(v.hp)) : 0;
    if (p.hp !== hp) p.hp = hp;
    session.maxHp = v.maxHp;
    const maxHp = Math.round(v.maxHp);
    if (p.maxHp !== maxHp) p.maxHp = maxHp;
    const dead = !v.alive;
    if (p.dead !== dead) p.dead = dead;
    if (p.act !== v.act) p.act = v.act;
    const target = v.targetId ?? -1;
    if (p.target !== target) p.target = target;
    const shield = byte(v.shield);
    if (p.shield !== shield) p.shield = shield;
    // Job, buffs and casts change only on events (a job change, a buff on or off, a cast's start or end).
    const job = v.job ?? session.jobs.current, weapon = JOBS[job].weapon;
    if (p.job !== job) p.job = job;
    if (p.weapon !== weapon) p.weapon = weapon;
    const buffs = v.buffs ?? 0;
    if ((p.buffs ?? 0) !== buffs) p.buffs = buffs;
    const searing = v.searing ?? 0;
    if ((p.searing ?? 0) !== searing) p.searing = searing;
    const cast = v.cast ?? null;
    if (cast) {
      const startS = worldOf(this.combat).now - (cast.total - cast.left);
      if (p.cast !== cast.ability || !(Math.abs(startS - session.castStart) < 0.05)) {
        p.cast = cast.ability;
        p.castTotal = cast.total;
        p.castAt = this.clockSteps(startS);
        session.castStart = startS;
      }
    } else if ((p.cast ?? '') !== '') {
      p.cast = '';
      p.castTotal = 0;
      session.castStart = NaN;
    }
  }

  /** Enemies and telegraphs onto the state (the room's start; steps use mirrorAll). */
  private mirrorZone() {
    for (const v of this.combat.all()) if (v.team === 'enemy') this.mirrorEnemy(v);
    this.mirrorTelegraphs();
    this.mirrorFields();
  }

  /** Fields onto the state (every client gets every one): added once, deleted when gone. */
  private mirrorFields() {
    let live: Set<string> | undefined;
    for (const f of this.combat.fields()) {
      const key = this.keyOf(f.id);
      (live ??= new Set()).add(key);
      if (this.state.fields.has(key)) continue;
      const s = f.shape;
      this.state.fields.set(key, new FieldSchema({
        id: f.id, owner: f.owner, field: f.field, shape: s.kind, x: s.x, z: s.z,
        r: s.kind === 'circle' || s.kind === 'ring' || s.kind === 'cone' ? s.r : s.length, inner: s.kind === 'ring' ? s.inner : 0,
        raw: byte(f.raw), at: this.clockSteps(f.startedAt),
      }));
    }
    if (this.state.fields.size === 0) return;
    for (const [key, f] of [...this.state.fields.entries()]) {
      if (live?.has(key)) continue;
      this.state.fields.delete(key);
      for (const session of this.sessions.values()) session.seen.delete(f); // gone from every view with the state
    }
  }

  /** An enemy that left the engine (despawned, or a dead add pruned): out of the state and every view. */
  private dropEnemy(id: number) {
    const key = this.keyOf(id);
    const e = this.state.enemies.get(key);
    if (!e) return;
    this.state.enemies.delete(key);
    for (const session of this.sessions.values()) session.seen.delete(e);
  }

  /** An enemy onto the state: fields set only when changed. */
  private mirrorEnemy(v: CombatantView) {
    {
      const key = this.keyOf(v.id);
      let e = this.state.enemies.get(key);
      if (!e) {
        // (debuffs stays unset, read as 0, until its first debuff)
        e = Object.assign(new EnemySchema(), {
          eid: v.id, kind: v.kind, x: v.x, z: v.z, y: v.y, facing: v.facing, hp: Math.ceil(v.hp), maxHp: u16(v.maxHp), stagger: 0,
          maxStagger: u16(v.maxStagger), marks: 0, mode: 'idle', target: -1, windup: '', windupTotal: 0, surging: false, staggerImmune: 0,
        });
        // (unset for an ordinary enemy, read as 'ordinary': most enemies cost nothing for it)
        if (v.tier && v.tier !== 'ordinary') e.tier = v.tier;
        this.state.enemies.set(key, e);
      }
      const hp = Math.ceil(v.hp), stagger = u16(v.stagger), maxStagger = u16(v.maxStagger), mode = enemyMode(v), target = v.targetId ?? -1;
      const windup = v.windup?.attack ?? '', windupTotal = v.windup?.total ?? 0;
      if (e.x !== v.x) e.x = v.x;
      if (e.z !== v.z) e.z = v.z;
      if (e.y !== v.y) e.y = v.y;
      if (e.facing !== v.facing) e.facing = v.facing;
      if (e.hp !== hp) e.hp = hp;
      if (e.stagger !== stagger) e.stagger = stagger;
      if (e.maxStagger !== maxStagger) e.maxStagger = maxStagger; // an elite's bar grows with the adventurers it fights
      if (e.marks !== v.marks) e.marks = v.marks;
      if (e.mode !== mode) e.mode = mode;
      if (e.target !== target) e.target = target;
      if (e.windup !== windup) e.windup = windup;
      if (e.windupTotal !== windupTotal) e.windupTotal = windupTotal;
      const maxHp = u16(v.maxHp);
      if (e.maxHp !== maxHp) e.maxHp = maxHp;
      const surging = v.surging === true, staggerImmune = round2(v.staggerImmune ?? 0);
      if (e.surging !== surging) e.surging = surging;
      if (e.staggerImmune !== staggerImmune) e.staggerImmune = staggerImmune;
      const debuffs = v.debuffs ?? 0;
      if ((e.debuffs ?? 0) !== debuffs) e.debuffs = debuffs; // (unset until its first debuff)
      // a boss: its phase, ward and enrage clock (unset, read as 0 and false, for everything else)
      const phase = v.phase ?? 0, warded = v.warded === true;
      if ((e.phase ?? 0) !== phase) e.phase = phase;
      if ((e.warded ?? false) !== warded) e.warded = warded;
      const now = worldOf(this.combat).now;
      const enrageIn = v.enrageIn ?? null;
      const enrageAt = enrageIn === null ? 0 : enrageIn > 0 ? this.clockSteps(now + enrageIn) : (e.enrageAt || this.clockSteps(now));
      if (Math.abs((e.enrageAt ?? 0) - enrageAt) > 1 || (enrageAt === 0) !== ((e.enrageAt ?? 0) === 0)) e.enrageAt = enrageAt;
    }
  }

  /** Telegraphs onto the state: added once, deleted when gone. */
  private mirrorTelegraphs() {
    const live = new Set<string>();
    for (const t of this.combat.telegraphs()) {
      const key = this.keyOf(t.id);
      live.add(key);
      if (this.state.telegraphs.has(key)) continue;
      const s = t.shape;
      const props = {
        id: t.id, owner: t.owner, attack: t.attack, shape: s.kind, x: s.x, z: s.z,
        dir: s.kind === 'circle' ? 0 : s.dir, r: s.kind === 'line' ? s.length : s.r,
        width: s.kind === 'line' ? s.width : 0, angle: s.kind === 'cone' ? s.angle : 0, total: t.total,
        at: this.clockSteps(worldOf(this.combat).now - (t.total - t.left)),
      };
      // inner only on rings (unset, read as 0, elsewhere: no bytes for every other telegraph)
      this.state.telegraphs.set(key, new TelegraphSchema((s.kind === 'ring' ? { ...props, inner: s.inner } : props) as typeof props & { inner: number }));
    }
    for (const [key, t] of [...this.state.telegraphs.entries()]) {
      if (live.has(key)) continue;
      this.state.telegraphs.delete(key);
      for (const session of this.sessions.values()) session.seen.delete(t); // gone from every view with the state
    }
  }

  /** A combat time (s) as a step count on the state's `clock` (never negative). */
  private clockSteps(s: number): number {
    return Math.max(0, Math.round(s * TICK_HZ));
  }

  /** The state key of an enemy or telegraph (no cache: telegraph ids are never reused, so one would only grow). */
  private keyOf(id: number): string {
    return String(id);
  }

  /**
   * The account's allowance, shared by every room; a new one holds only the step slack, so joining
   * never banks distance. A new one's air track is set by the join.
   */
  private allowanceFor(accountId: string): Allowance {
    let allowance = this.accounts.allowances.get(accountId);
    if (!allowance) {
      allowance = { metres: STEP_SLACK, at: this.wallMs(), air: makeAirTrack(0), zone: this.zone.id };
      this.accounts.allowances.set(accountId, allowance);
    }
    return allowance;
  }

  /** Drops allowances of accounts that are online nowhere and have been still long enough to be full anyway. */
  private forgetIdleAllowances() {
    const now = this.wallMs();
    for (const [accountId, allowance] of this.accounts.allowances) {
      if (!this.accounts.get(accountId) && now - allowance.at > ALLOWANCE_FORGET_MS) this.accounts.allowances.delete(accountId);
    }
    for (const [accountId, kept] of this.accounts.carries) if (now - kept.at >= CARRY_KEEP_MS) this.accounts.carries.delete(accountId);
    for (const [accountId, until] of this.accounts.respawns) if (until <= now) this.accounts.respawns.delete(accountId);
  }

  /**
   * Takes one token from the client's message bucket, or for an intent from its intent bucket; false
   * (drop the message) when it is empty. A dropped intent is answered `refused 'rate'` (at most one
   * every RATE_REFUSAL_EVERY_MS); other dropped messages are silent.
   */
  private takeToken(client: Client, type: string): boolean {
    const session = this.sessions.get(client.sessionId);
    if (!session) return true; // handlers ignore messages without a session anyway
    const now = this.wallMs();
    const action = INTENTS[type];
    if (action) {
      session.intentTokens = Math.min(INTENT_BURST, session.intentTokens + ((now - session.intentTokensAt) / 1000) * INTENT_RATE);
      session.intentTokensAt = now;
      if (session.intentTokens >= 1) {
        session.intentTokens -= 1;
        return true;
      }
      if (now - session.rateRefusedAt >= RATE_REFUSAL_EVERY_MS) {
        session.rateRefusedAt = now;
        this.refuse(session, action, 'rate');
      }
      return false;
    }
    session.tokens = Math.min(MESSAGE_BURST, session.tokens + ((now - session.tokensAt) / 1000) * MESSAGE_RATE);
    session.tokensAt = now;
    if (session.tokens < 1) return false;
    session.tokens -= 1;
    return true;
  }

  /** Wraps a message handler: rate-limited per client, and a throw is logged (throttled) while the room carries on. */
  private guard(type: string, handler: (client: Client, message: unknown) => void) {
    return (client: Client, message: unknown) => {
      if (!this.takeToken(client, type)) return;
      try {
        handler(client, message);
      } catch (err) {
        this.logFailure(`handler:${type}`, `The ${type} handler failed`, err);
      }
    };
  }
}

/**
 * The room class for one zone of one app. Joins are checked during matchmaking (static onAuth), so a
 * bad token, an adventurer without a name, one saved in another zone, or a full zone is refused over
 * HTTP before any seat or socket is opened.
 */
export function zoneRoomFor(options: ZoneRoomOptions, jwtSecret: string): typeof ZoneRoom {
  const zone = options.zone.id;
  return class extends ZoneRoom {
    static async onAuth(_token: string, joinOptions: unknown, _context: AuthContext) {
      const auth = await authenticate(options.store, jwtSecret, joinOptions);
      if (!auth) return false;
      const adventurer = await options.store.getOrCreateAdventurer(auth.accountId);
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      if (adventurer.zone !== zone) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
      const room = options.rooms.get(zone);
      if (room && !room.canAdmit(auth.accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(zone));
      return auth;
    }
  };
}

/**
 * The room class for the Lampfall's instances (one room per party, opened by Instances.enter with
 * `{ instanceKey }`). Joins are checked in the room (onAuth with the room at hand): a bad token, an
 * adventurer without a name, one not saved in the Greenway (where everyone inside is saved), or an
 * account not allowed in this instance (another party's) is refused with REASON_ELSEWHERE.
 */
export function instanceRoomFor(options: ZoneRoomOptions, jwtSecret: string): typeof ZoneRoom {
  return class extends ZoneRoom {
    async onAuth(_client: Client, joinOptions: unknown, _context: AuthContext) {
      const auth = await authenticate(options.store, jwtSecret, joinOptions);
      if (!auth) return false;
      const adventurer = await options.store.getOrCreateAdventurer(auth.accountId);
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      if (adventurer.zone !== 'greenway' || !this.canAdmit(auth.accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
      return auth;
    }
  };
}
