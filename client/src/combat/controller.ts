// Combat on the client: turns the HUD's buttons, keys and taps into intents for the server, and the server's
// state and messages into what the player sees and feels. The server decides everything (hits, damage,
// cooldowns, Momentum, dodges, knockbacks, deaths); this only predicts the adventurer's own dodge roll, with the
// shared displacement simulation, so it is never corrected.
//
// The ack protocol: every `move` and `dodge` carries `ack`, the latest seq from `displaced` or `respawned`.
// - A dodge is predicted at once from the body's pose; until its `displaced` (or a `refused`, or 1 s) no poses go
//   out. Its `displaced` puts the body at `to` if the prediction ended more than 5 cm off; a refused dodge goes
//   back to the pose it was sent from (then any `correct`, as always).
// - A knockback (or a resync) replays the server's displacement from its `from`; a held dodge it dropped is
//   forgotten. A respawn stands the body at the statue. Each adopts the new seq.
// - Key auto-repeat never sends anything again (the server allows 20 intents a second).
//
// Jobs (Plan 3b): the bar is the current job's five slots (from `self`); the job board (the Guild Board, J, the
// Jobs button) sends `job`, the picks chooser (L) `loadout { picks }`; the server says yes with `jobs`, or why
// not with `refused`. Ally-aimed abilities carry the focused adventurer (a tap on them, F) as `ally`; without
// one the server picks (the lowest health in range). A spell's cast slows the adventurer from the press (never
// faster than the server allows) and fills the cast bar from the server's cast.
import { Color3, Matrix, MeshBuilder, StandardMaterial, Vector3, type Viewport } from '@babylonjs/core';
import {
  ABILITIES, BUFF_BITS, CAST_MOVE_SCALE, CHARGE_FULL_S, CHARGE_INTERRUPT_FRAC, CHARGE_MOVE_SCALE, DEATH_MIN_S, AUTO_RESPAWN_S, DEBUFF_BITS, DODGE_CHARGES,
  DODGE_MIN_GAP_S, DODGE_REFILL_S, ENEMY_ATTACKS, ENEMY_KINDS, GUILD_BOARD, JOBS, MARK_BITS, RANGE_FUZZ, REASON_JOB_NOT_HERE, SPRINT_S, SPRINT_SCALE, TARGET_RANGE,
  TELEGRAPH_LEAD_S, TICK_HZ, WEAPONS, dodgeDisplacement, isJobId, simulateDisplacement,
  BOSSES, LAMPFALL_MOUTH, RELEASE_MIN_S, REASON_IN_COMBAT, lampfallLayout, type InstanceView, type CheckpointId,
  type AbilityId, type BuffId, type C2S, type CastView, type DebuffId, type EnemyAttackId, type EnemyKindId, type FxEvent, type JobId, type JobsView,
  type MarkId, type S2C, type SelfView, type ZoneId,
} from '@sg2/shared';
import type { BossBar, HudApi, HudEvent, HudState, PartyBar, StatusId, TapInfo } from '../core/contracts';
import type { PartyState } from '../net/party';
import { bossBar, bossTitle } from '../hud/boss';
import { partyBars } from '../hud/party';
import { edgeMarkerLayout, type EdgeCam, type EdgeMarker, type EdgeMember } from './edgeMarkers';
import { lampfallRoomAt } from '../world/lampfallPlain';
import type { Game } from '../boot';
import type { Enemies } from '../net/enemies';
import type { Remotes } from '../net/remotes';
import { windupElapsedS, type EnemyStateView, type PlayerView, type ZoneRoom } from '../net/session';
import { ABILITY_DEFS } from './abilityDefs';
import { mouthHintText } from './mouthHint';
import { FOCUS_RANGE, aimHint, createAllyFocus, createFocusRing, createPartyRings, type AllyPos } from './allyFocus';
import { article, jobBoardView, roleLabel } from '../hud/jobs';
import { GUILD_BOARD_EID, GUILD_BOARD_REACH } from '../world/guildBoard';
import { createTelegraphs, type Telegraphs } from './telegraphs';
import { createOverheads, type Overheads } from './overheads';
import { createEffects, type Effects } from './effects';

// ───────────────────────── pure helpers (tested) ─────────────────────────

/** `self` as received, with when it arrived (performance.now ms): the timers in it count down from then. */
export type SelfSnap = SelfView & { at: number };

/**
 * What a tap means for combat. An enemy tap targets it, and walks into range when tap-to-walk is on and the
 * enemy is out of reach (`reach`: from the adventurer to the enemy's edge; `range`: the weapon's). A tap on
 * anything else walks there when tap-to-walk is on, and targets nothing.
 */
export function tapAction(
  tap: { entityId: number | null; point: { x: number; y: number; z: number } | null },
  settings: { tapToWalk: boolean }, enemyIds: ReadonlySet<number>, reach: number, range: number,
): { target: number | undefined; walk: 'enemy' | 'ground' | null } {
  if (tap.entityId !== null && enemyIds.has(tap.entityId)) {
    return { target: tap.entityId, walk: settings.tapToWalk && reach > range ? 'enemy' : null };
  }
  return { target: undefined, walk: settings.tapToWalk && tap.point ? 'ground' : null };
}

/**
 * What a tap is on, from everything under it (nearest first): an enemy anywhere in the list wins (one standing
 * behind an ally can still be chosen), else another adventurer (`me` never counts), else nothing.
 */
export function tapSubject(
  ids: readonly number[], isEnemy: (id: number) => boolean, isAdventurer: (id: number) => boolean, me: number,
): { kind: 'enemy' | 'ally'; id: number } | null {
  for (const id of ids) if (isEnemy(id)) return { kind: 'enemy', id };
  for (const id of ids) if (id !== me && isAdventurer(id)) return { kind: 'ally', id };
  return null;
}

/**
 * The five ability slots as the HUD shows them, timers counted down from when `self` arrived. Written into
 * `out` (its entries reused, so nothing is allocated per frame) and returned.
 */
export function slotView(
  self: SelfSnap | null, nowMs: number, dead = false, out: HudState['slots'] = [], casting: AbilityId | null = self?.cast ? self.cast.ability : null,
): HudState['slots'] {
  if (!self) { out.length = 0; return out; }
  const el = Math.max(0, (nowMs - self.at) / 1000);
  const gcd = Math.max(0, self.gcd - el); // shown only while the slot also cools
  // a cast in progress (`casting`): every other button waits for it (the server answers 'busy')
  out.length = Math.min(out.length, self.slots.length);
  for (let i = 0; i < self.slots.length; i++) {
    const id = self.slots[i], a = ABILITIES[id];
    const cd = Math.max(0, (self.cd[i] ?? 0) - el);
    const usable = !dead && !(a.cost !== undefined && self.momentum < a.cost) && (casting === null || casting === id);
    // the global cooldown only shows on a slot whose own cooldown is shorter, as the sweep's last part
    const s = (out[i] ??= { ability: ABILITY_DEFS[id], cdRemaining: 0, usable: true });
    s.ability = ABILITY_DEFS[id]; s.cdRemaining = cd > 0 ? Math.max(cd, gcd) : 0; s.usable = usable;
  }
  return out;
}

/** How full a telegraph's decal is (0..1): it fills from first sight and is full TELEGRAPH_LEAD_S before it lands. */
export function telegraphFill(firstSeenMs: number, nowMs: number, total: number): number {
  const span = total - TELEGRAPH_LEAD_S;
  if (!(span > 0)) return 1;
  return Math.max(0, Math.min(1, (nowMs - firstSeenMs) / 1000 / span));
}

/** Tab: the next enemy outward from the current target (nearest first, wrapping), among those within TARGET_RANGE. */
export function cycleTarget(current: number | null, list: readonly { eid: number; d: number }[]): number | null {
  const near = list.filter((e) => e.d <= TARGET_RANGE).sort((a, b) => a.d - b.d || a.eid - b.eid);
  if (near.length === 0) return null;
  const i = current === null ? -1 : near.findIndex((e) => e.eid === current);
  return near[(i + 1) % near.length].eid;
}

/** A screen-space input direction (x right, y up) as a unit ground direction for a camera at `alpha`; null = `facing`. */
export function screenToWorld(dir: { x: number; y: number } | null, alpha: number, facing: number): { x: number; z: number } {
  if (!dir || Math.hypot(dir.x, dir.y) < 0.2) return { x: Math.sin(facing), z: Math.cos(facing) };
  const fx = -Math.cos(alpha), fz = -Math.sin(alpha), rx = fz, rz = -fx;
  const wx = rx * dir.x + fx * dir.y, wz = rz * dir.x + fz * dir.y, l = Math.hypot(wx, wz) || 1;
  return { x: wx / l, z: wz / l };
}

/** The marks, in the order the HUD shows them. */
const MARK_IDS: readonly Extract<MarkId, StatusId>[] = ['marked', 'burning', 'soaked', 'rooted', 'dazed'];
/** The marks set in `bits` as HUD status ids, written into `out` (emptied first) and returned. */
export function markStatuses(bits: number, out: StatusId[] = []): StatusId[] {
  out.length = 0;
  for (const m of MARK_IDS) if (bits & MARK_BITS[m]) out.push(m);
  return out;
}
/** Adventurer buffs (aegis and aegis_ally share a bit: one icon) and enemy debuffs, as HUD status ids. */
const BUFF_IDS: readonly Extract<BuffId, StatusId>[] = ['roar', 'aegis', 'sheltered', 'rain', 'pact', 'mist', 'bloodbond'];
const DEBUFF_IDS: readonly Extract<DebuffId, StatusId>[] = ['blinded', 'weakpoint'];
/** The buffs (an adventurer's BUFF_BITS) or debuffs (an enemy's DEBUFF_BITS) set in `bits`, appended to `out` and returned. */
export function buffStatuses(bits: number, on: 'adventurer' | 'enemy', out: StatusId[] = []): StatusId[] {
  if (on === 'adventurer') { for (const b of BUFF_IDS) if (bits & BUFF_BITS[b]) out.push(b); } else for (const d of DEBUFF_IDS) if (bits & DEBUFF_BITS[d]) out.push(d);
  return out;
}

/** How far along the server's cast is (0..1), counted on from when the `self` carrying it arrived (`at`, ms). */
export function castFrac(cast: NonNullable<CastView>, at: number, nowMs: number): number {
  if (!(cast.total > 0)) return 1;
  const left = cast.left - Math.max(0, (nowMs - at) / 1000);
  return Math.max(0, Math.min(1, 1 - left / cast.total));
}

/**
 * Whether a `displaced`/`respawned` numbered `seq` is news to a client at `ack`. The server sends the last
 * one again after a reconnect: one already applied must not pull the adventurer back to where it was.
 */
export function isNewSeq(ack: number, seq: number): boolean { return seq > ack; }

/**
 * Whether a walk toward an enemy (tap-to-walk) carries on: not when it could not start (no way there: give up
 * instead of searching again every frame), nor once the player has steered themselves since it began.
 */
export function keepFollowing(started: boolean, followSince: number, walkOverriddenAt: number): boolean {
  return started && !(walkOverriddenAt > followSince);
}

/** A press no `self` has shown charging within this is taken as over (lost or refused), in ms. */
export const CHARGE_CONFIRM_MS = 1000;
/**
 * Whether a Charged Shot this client pressed at `pressedAt` is still held as the server sees it. Once a `self`
 * showing the charge has arrived (at `chargeSeenAt`), a later one showing none says it is over (released,
 * auto-released at 2.5 s, cancelled by a knock or a swap), whatever happened to the key or button. Before
 * that, a `self` without the charge may simply predate the press reaching the server (any round trip), so
 * only CHARGE_CONFIRM_MS without the charge ever showing ends it.
 */
export function chargeStillHeld(
  pressedAt: number, chargeSeenAt: number | null, self: { at: number; charge: number | null } | null, nowMs: number,
): boolean {
  if (chargeSeenAt !== null) return !(self && self.at > chargeSeenAt && self.charge === null);
  return !(nowMs - pressedAt > CHARGE_CONFIRM_MS && (!self || self.charge === null));
}

/**
 * A held Charged Shot as this client sees it. `pressedAt` (null when not held) slows the adventurer and
 * fills the cast bar; `up` says whether a key-up sends the release, which it always does for the slot the
 * charge was pressed on, even when the charge is already over here (the server ignores a stray release).
 */
export function createChargeHold() {
  let pressedAt: number | null = null, slot: number | null = null, seenAt: number | null = null;
  return {
    get pressedAt() { return pressedAt; },
    get slot() { return slot; },
    /** A press; false while one is held (key auto-repeat). */
    press(s: number, now: number): boolean {
      if (pressedAt !== null) return false;
      pressedAt = now; slot = s; seenAt = null;
      return true;
    },
    /** A `self` arrived at `at` showing `charge`. */
    onSelf(charge: number | null, at: number) { if (pressedAt !== null && charge !== null && seenAt === null) seenAt = at; },
    /** Per frame: drops a charge the server says is over. */
    update(self: { at: number; charge: number | null } | null, now: number) {
      if (pressedAt !== null && !chargeStillHeld(pressedAt, seenAt, self, now)) pressedAt = null;
    },
    /** A key-up on `s`: true when it sends the release (once per press). */
    up(s: number): boolean {
      if (slot === null || s !== slot) return false;
      slot = null; pressedAt = null;
      return true;
    },
    /** Death or a refused press: not held any more (the key-up still sends its release). */
    cancel() { pressedAt = null; },
  };
}

/**
 * Whether an ability refusal is for the Charged Shot press: refusals carry no slot, so only when the last
 * ability this client pressed was that slot, within 600 ms.
 */
export function refusalIsForCharge(lastPress: { slot: number; at: number } | null, chargeSlot: number | null, nowMs: number): boolean {
  return !!lastPress && chargeSlot !== null && lastPress.slot === chargeSlot && nowMs - lastPress.at < 600;
}

/** A dodge pressed while one is still waiting for its answer is rolled once that one is done, if within this, in ms. */
export const DODGE_QUEUE_MS = 400;

const REFUSAL_TEXT: Record<string, string> = {
  range: 'Out of range', cooldown: 'Not ready', momentum: 'Not enough Momentum', sight: "Can't see the target", 'no-target': 'No target',
  charges: 'No dodges left', air: "Can't dodge in the air", 'in-combat': 'Not during a fight', 'no-ally': 'Nobody to help here',
  'not-here': REASON_JOB_NOT_HERE,
};
/**
 * The toast for a refusal of `action`, or null for the silent ones (stale, rate, dead, invalid; busy, except
 * for a job change, which says to finish first: a press during a cast is silent).
 */
export function refusalText(reason: string, action?: string): string | null {
  if ((action === 'job' || action === 'loadout') && reason === 'busy') return 'Finish what you are doing first';
  return REFUSAL_TEXT[reason] ?? null;
}

// ───────────────────────── the controller ─────────────────────────

/** How long a predicted dodge holds back poses waiting for the server's answer, in ms. */
const DODGE_WAIT_MS = 1000;
/** A predicted roll this close to the server's end needs no correction, in m. */
const DODGE_SNAP_M = 0.05;
/** Tap-to-walk keeps this much inside the weapon's range, in m. */
const RANGE_MARGIN = 0.5;
/** Charging slows the adventurer to this (the server's own). */
const CHARGE_SCALE = CHARGE_MOVE_SCALE;
/** After a release, keep the charge slow this long unless the server says the charge is over, in ms. */
const RELEASE_SLOW_MS = 400;
/** Sprint ends this much earlier on the client than on the server (never faster than allowed), in s. */
const SPRINT_EARLY_S = 0.15;

export interface CombatDebug {
  self: { hp: number; momentum: number; dead: boolean; target: number | null; job: JobId | null; cast: CastView } | null;
  /** The last `jobs` (null before it arrives). */
  jobs: JobsView | null;
  /** The last 20 refusals. */
  refused: { action: string; reason: string }[];
  /** The focused adventurer's engine id (null: none). */
  allyFocus: number | null;
  fxSeen: number;
  ack: number;
  dodges: number; refusals: string[]; corrections: number; displaced: number;
  telegraphs: number;
  inDanger: boolean;
  /** The last fx events and refusals with their time (performance.now ms), for playtests. */
  log: { t: number; e: unknown }[];
  /** The enemy tap-to-walk keeps in range (null for none). */
  chasing: number | null;
  /** The spell pool: visuals live and instances drawn last frame (set once the effects exist). */
  spells?: { readonly live: number; readonly drawn: number };
  /** Plan 4: the boss frame's boss (null: none shown). */
  boss: { kind: string; phase: number; warded: boolean; enrageIn: number | null } | null;
  /** Which end screen is up: 'fallen' (dead in an instance), 'wipe', 'defeat' (the statue), or ''. */
  screen: string;
}

/** Where the Lampfall's checkpoints are, by name (the wipe and release lines). */
export function checkpointName(cp: CheckpointId | undefined): string {
  const room = lampfallLayout().rooms.find((r) => r.checkpoint === (cp ?? 'rim'));
  return room?.name ?? 'Crater Rim';
}

/** Seconds left of an instance countdown sent as `s` (wipeIn, releaseIn) `sinceMs` ago; null when there is none. */
export function countdownLeft(s: number | null | undefined, sinceMs: number): number | null {
  return typeof s === 'number' ? Math.max(0, s - sinceMs / 1000) : null;
}

/** Plan 4: the party and the instance (online.ts keeps them; the controller reads them). */
export interface CombatSocial {
  readonly party: PartyState;
  /** The last `instance` message in this room and when it arrived (performance.now ms), or null. */
  instance(): { view: InstanceView; at: number } | null;
}

/** The room messages the controller handles. */
export const COMBAT_MESSAGES = ['self', 'displaced', 'respawned', 'refused', 'fx', 'credit', 'jobs', 'jobXp', 'revived'] as const;
export type CombatMessage = typeof COMBAT_MESSAGES[number];

export interface CombatController {
  /** The ack every move must carry. */
  readonly ack: number;
  /** False while a predicted dodge waits for its answer, a displacement plays, or the adventurer is dead. */
  canSendPose(): boolean;
  /** A combat message from the room (online.ts registers the handlers at once and forwards them). */
  message(type: CombatMessage, m: unknown): void;
  /** A HUD event (online.ts forwards them: the HUD outlives each room). */
  onHud(e: HudEvent): void;
  /** A tap on the 3D view; true when combat handled it (an enemy tap). */
  onTap(tap: TapInfo): boolean;
  /** The server corrected the pose (online.ts places the body): any displacement in progress stops. */
  onCorrect(): void;
  /** `travel` arrived: the adventurer is held still (move scale 0) until this room ends. */
  onTravel(): void;
  /** Fills the HUD state; call every frame. */
  update(dt: number): void;
  readonly debug: CombatDebug;
  dispose(): void;
}

export interface CombatOpts {
  game: Game;
  hud: HudApi;
  room: ZoneRoom;
  state: HudState;
  remotes: Remotes;
  enemies: Enemies;
  send: <K extends keyof C2S>(type: K, message: C2S[K]) => void;
  /** The zone this room is (the job board's note; the Guild Board stands in the grove). */
  zone: ZoneId;
  /** Plan 4 (online): the party and the instance. */
  social?: CombatSocial;
  /** Plan 5 (online): opens the character sheet's Talents tab (the job board's Talents button). */
  openTalents?: () => void;
}

const isKind = (k: string): k is EnemyKindId => Object.prototype.hasOwnProperty.call(ENEMY_KINDS, k);
const isAttack = (a: string): a is EnemyAttackId => Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, a);

export function createCombat(o: CombatOpts): CombatController {
  const { game, hud, room, state } = o;
  const rig = () => game.rig;
  const meState = (): PlayerView | undefined => room.state.players?.get(room.sessionId);
  const debug: CombatDebug = {
    self: null, jobs: null, refused: [], allyFocus: null, fxSeen: 0, ack: 0, dodges: 0, refusals: [], corrections: 0, displaced: 0, telegraphs: 0, inDanger: false, log: [], chasing: null,
    boss: null, screen: '',
  };
  const note = (e: unknown) => { debug.log.push({ t: performance.now(), e }); if (debug.log.length > 200) debug.log.splice(0, 50); };

  let ack = 0;
  let self: SelfSnap | null = null;
  let target: number | null = null;
  /** The last view of the target, kept while it is briefly out of the state (interest edge), so the frame never flickers. */
  let targetSeen: { e: EnemyStateView; at: number } | null = null;
  let targetCopy: Record<string, unknown> | null = null;
  let followEid: number | null = null;
  /** When the current walk toward followEid began (a later walkOverriddenAt means the player steered away). */
  let followSince = -Infinity;
  /** A walk toward followEid is under way (one that stops without arriving, stuck or overridden, ends the follow). */
  let followWalk = false;
  /** Tap-to-walk keeps the adventurer in range of this enemy (a tapped target) until the player moves themselves. */
  let chase: { eid: number; since: number } | null = null;
  let pending: { from: { x: number; z: number; y: number }; end: { x: number; z: number; y: number }; at: number } | null = null;
  let lastDodgeAt = -Infinity;
  /** Charges as this client counts them (the server's, less the dodges sent since). */
  let charges = DODGE_CHARGES, chargesSetAt = -Infinity;
  let releasedAt = -Infinity;
  /** The held Charged Shot (its release goes to the slot it was pressed on, whatever the bar shows now). */
  const charge = createChargeHold();
  let lastPress: { slot: number; at: number } | null = null;
  /** A dodge pressed while another waited for its answer (rolled once that one is done, within DODGE_QUEUE_MS). */
  let queuedDodge: { dir: { x: number; y: number } | null; at: number } | null = null;
  let travelling = false;
  let sprintUntil = -Infinity;
  let deadSince: number | null = null;
  let deathScreen = false;
  const windupSince = new Map<number, { attack: string; at: number }>();
  const hurtAt = new Map<number, number>();
  const lastHp = new Map<number, number>();
  const enemyMaps = [windupSince, hurtAt, lastHp] as Map<number, unknown>[];
  const slotsOut: HudState['slots'] = [];
  const targetStatuses: StatusId[] = [];
  const tapIds = new Set<number>();
  let disposed = false;
  const myCast = { name: 'Charged Shot', frac: 0, mark: CHARGE_INTERRUPT_FRAC };
  const spellCast = { name: '', frac: 0 };
  /** The last `jobs`; a job change seen in it is announced. */
  let jobs: JobsView | null = null;
  const jobBadge = { id: 'warrior' as JobId, name: '', glyph: '', level: 1 };
  /** A spell this client pressed (slowed from the press until the server's `self` shows the cast over). */
  let castPress: { slot: number; at: number; seenAt: number | null } | null = null;
  /** This adventurer's cast from its `cast` fx (the bar starts at once, before `self` shows it). */
  let castFx: { ability: AbilityId; total: number; at: number } | null = null;
  /** When `revived` arrived: the state may still show the adventurer dead for a moment. */
  let revivedAt = -Infinity;
  let boardOpen = false;
  const focus = createAllyFocus();
  const focusRing = createFocusRing(game.scene);
  const allyView: NonNullable<HudState['ally']> = { name: '', hp: 0, maxHp: 1, statuses: [], dead: false, inRange: true, glyph: '', cast: null };
  const allyCast = { name: '', frac: 0 };
  const selfStatuses: StatusId[] = [];
  /** What the context prompt does now (E or its button). */
  let promptAction: { kind: 'revive'; eid: number; slot: number } | { kind: 'board' } | { kind: 'mouth' } | { kind: 'release' } | { kind: 'releaseWait' } | null = null;

  // ── Plan 4: parties, the boss frame, the Lampfall ──
  const social = o.social ?? null;
  const party = social?.party ?? null;
  const instanced = o.zone === 'lampfall';
  /** Dead in an instance and the Fallen screen put away ("Watch"): the prompt offers Release instead. */
  let watching = false;
  /** Bumped whenever an end screen opens, so a stale screen's answer is ignored. */
  let screenSeq = 0;
  /** A `phase` fx per boss: when its transition began (the banner and the frame's transition flag). */
  const phaseFx = new Map<number, number>();
  const bossOut = { phaseMarks: [] as number[] } as unknown as BossBar;
  const bossOpts = { windupFrac: 0, transitionLeftS: 0, targeted: false };
  const bossDebug = { kind: '', phase: 0, warded: false, enrageIn: null as number | null };
  const partyOut: PartyBar[] = [];
  const rings = createPartyRings(game.scene);
  const edgePool: EdgeMember[] = [], edgeList: EdgeMember[] = [], edgeOut: EdgeMarker[] = [];
  const projIn = new Vector3(), projOut = new Vector3();
  let viewport: Viewport | null = null, vpW = 0, vpH = 0;
  const vpSize = { w: 0, h: 0 };
  const edgeCam: EdgeCam & { x: number; z: number } = {
    x: 0, z: 0,
    project(x, y, z, out) {
      projIn.set(x, y, z);
      Vector3.ProjectToRef(projIn, Matrix.IdentityReadOnly, game.scene.getTransformMatrix(), viewport!, projOut);
      out.x = projOut.x; out.y = projOut.y; out.front = projOut.z > 0 && projOut.z < 1;
    },
  };
  /** The room the adventurer stands in (the Lampfall: a banner on walking into the next one), checked a few times a second. */
  let roomId: string | null = null, roomCheckAt = 0;
  /** The crater mouth's note, recomputed a few times a second (not every frame). */
  let mouthHint: string | null = null, mouthNear = false, mouthCheckAt = 0;
  let releaseText = '', releaseN = -1;

  const telegraphs: Telegraphs = createTelegraphs(game.scene, game.world, room);
  const overheads: Overheads = createOverheads(game.scene, room, o.enemies);
  const effects: Effects = createEffects({ game, hud, room, remotes: o.remotes, enemies: o.enemies });
  debug.spells = effects.spells;
  // A soft ring on the ground under this adventurer, so it reads at a glance in a crowd of enemies and trees.
  const ringMat = new StandardMaterial('selfRingMat', game.scene);
  ringMat.disableLighting = true; ringMat.emissiveColor = new Color3(1, 0.93, 0.72); ringMat.alpha = 0.55; ringMat.zOffset = -2;
  const selfRing = MeshBuilder.CreateTorus('selfRing', { diameter: 1.15, thickness: 0.06, tessellation: 40 }, game.scene);
  selfRing.scaling.y = 0.2; selfRing.position.y = 0.05; selfRing.isPickable = false; selfRing.material = ringMat;
  selfRing.parent = game.rig.view.root;

  // ── helpers ──
  const myEid = () => meState()?.eid ?? -1;
  /** The current job: the server's `self`, else the state's, else the last `jobs`. */
  const job = (): JobId => {
    const j = self?.job ?? meState()?.job ?? jobs?.current;
    return isJobId(j) ? j : 'warrior';
  };
  const weapon = () => JOBS[job()].weapon;
  const range = () => WEAPONS[weapon()].autoRange;
  /** Every other adventurer in view, as the aim hint and F see them. */
  // (pooled: they run every frame for the revive prompt and the focus, so they allocate nothing once warm)
  const otherPool: AllyPos[] = [], othersList: AllyPos[] = [];
  let otherN = 0;
  const collectOther = (p: PlayerView, sid: string) => {
    if (sid === room.sessionId || p.eid === undefined || p.eid < 0) return;
    const a = (otherPool[otherN] ??= { id: 0, x: 0, z: 0, hp: 0, maxHp: 1, alive: true });
    a.id = p.eid; a.x = p.x; a.z = p.z; a.hp = p.hp; a.maxHp = Math.max(1, p.maxHp); a.alive = !p.dead;
    otherN++;
  };
  const others = (): AllyPos[] => {
    otherN = 0;
    room.state.players?.forEach(collectOther);
    othersList.length = 0;
    for (let i = 0; i < otherN; i++) othersList.push(otherPool[i]);
    return othersList;
  };
  const meAllyBuf: AllyPos = { id: -1, x: 0, z: 0, hp: 1, maxHp: 1, alive: true };
  const meAlly = (): AllyPos => {
    const m = meState(), r = rig().position, a = meAllyBuf;
    a.id = myEid(); a.x = r.x; a.z = r.z; a.hp = m?.hp ?? 1; a.maxHp = Math.max(1, m?.maxHp ?? 1); a.alive = !m?.dead;
    return a;
  };
  const found = { sid: '', p: null as PlayerView | null };
  let findEid = -1;
  const findPlayer = (p: PlayerView, sid: string) => { if (!found.p && sid !== room.sessionId && p.eid === findEid) { found.sid = sid; found.p = p; } };
  /** Another adventurer by engine id (one reused answer: read it before the next call). */
  const playerByEid = (eid: number): { sid: string; p: PlayerView } | null => {
    found.p = null; findEid = eid;
    room.state.players?.forEach(findPlayer);
    return found.p ? (found as { sid: string; p: PlayerView }) : null;
  };
  const isPlayerEid = (eid: number) => playerByEid(eid) !== null;
  /** A party member standing in this room, from its PlayerState (partyBars reads it at once). */
  const memberHere = (eid: number) => playerByEid(eid)?.p;
  const isBossKind = (k: string) => Object.prototype.hasOwnProperty.call(BOSSES, k);
  /** The first engaged boss in view (forEach callback, made once: nothing allocated per frame). */
  let bossPick: EnemyStateView | undefined;
  const pickBoss = (e: EnemyStateView) => { if (!bossPick && isBossKind(e.kind) && (e.mode === 'fight' || e.mode === 'windup' || e.mode === 'stunned')) bossPick = e; };
  const isReviveId = (id: AbilityId) => ABILITIES[id].aim === 'dead-ally';
  const setFocus = (id: number | null) => { o.remotes.setFocus(id); debug.allyFocus = id; };
  const isDead = () => !!meState()?.dead;
  const enemyView = (eid: number) => room.state.enemies?.get(String(eid));
  const toast = (t: string | null) => { if (t) hud.toast(t); };
  /** A party member here (by engine id): the server's automatic picks choose only these (the ally rule). */
  const isMemberEid = (id: number) => !!party?.memberByEid(id);
  const myName = () => meState()?.name ?? '';
  const inst = () => social?.instance() ?? null;
  /** Seconds until this adventurer may release (dead in an instance), counted from the last `instance`. */
  const releaseLeft = (now: number) => {
    const i = inst();
    const left = i ? countdownLeft(i.view.releaseIn, now - i.at) : null;
    return left ?? Math.max(0, RELEASE_MIN_S - (deadSince !== null ? (now - deadSince) / 1000 : 0));
  };
  const wipeLeft = (now: number) => { const i = inst(); return i ? countdownLeft(i.view.wipeIn, now - i.at) : null; };
  const checkpoint = () => checkpointName(inst()?.view.checkpoint);
  const sendRelease = () => {
    const left = releaseLeft(performance.now());
    if (left > 0.05) { toast(`You can release in ${Math.ceil(left)} s`); return false; }
    o.send('release', {} as Record<string, never>);
    return true;
  };

  let lastTargetSent = -Infinity;
  const setTarget = (id: number | null, tell = true) => {
    if (id === target) return;
    if (tell) lastTargetSent = performance.now();
    if (target !== null) o.enemies.get(target)?.view.setTargeted(false);
    target = id;
    targetSeen = null; targetCopy = null;
    if (id !== null) o.enemies.get(id)?.view.setTargeted(true);
    if (tell) o.send('target', { id });
  };

  const followTarget = (eid: number) => {
    const d = o.enemies.get(eid), e = enemyView(eid);
    if (!d || !e || !isKind(e.kind)) return;
    const within = range() + ENEMY_KINDS[e.kind].radius - RANGE_MARGIN;
    followEid = eid;
    const since = performance.now();
    const started = game.walkTo(new Vector3(d.x, d.y, d.z), {
      within,
      then: () => { followEid = null; followWalk = false; },
      follow: () => {
        const v = o.enemies.get(eid), ev = enemyView(eid);
        if (!v || !ev || ev.mode === 'dead' || target !== eid) { followEid = null; return null; }
        return new Vector3(v.x, v.y, v.z);
      },
    });
    // no way there: stop following (and chasing), or it would search again (and toast) every frame
    if (!keepFollowing(started, since, game.walkOverriddenAt)) { followEid = null; chase = null; followWalk = false; }
    else { followSince = since; followWalk = true; }
  };

  // ── dodge ──
  const dodge = (dir: { x: number; y: number } | null) => {
    const r = rig();
    if (isDead() || travelling || room.reconnection.isReconnecting) return;
    if (pending || r.displacing) { queuedDodge = { dir, at: performance.now() }; return; }
    if (!r.body.grounded) { toast(refusalText('air')); return; }
    const now = performance.now();
    if (now - lastDodgeAt < DODGE_MIN_GAP_S * 1000) return;
    if (charges <= 0) { toast(refusalText('charges')); return; }
    const w = screenToWorld(dir, r.camera.alpha, r.facing);
    const from = { x: r.body.x, z: r.body.z, y: r.body.y };
    const d = dodgeDisplacement(w.x, w.z);
    const end = simulateDisplacement(from, d, (x, z) => game.world.surfaceAt(x, z));
    game.walkTo(null); followWalk = false; // the follow carries on after the roll
    o.send('dodge', { x: from.x, z: from.z, y: from.y, facing: Math.atan2(w.x, w.z), moving: true, ack, dx: w.x, dz: w.z });
    r.faceTowards(from.x + w.x, from.z + w.z);
    r.displace(from, d);
    pending = { from, end: { x: end.x, z: end.z, y: end.y }, at: now };
    lastDodgeAt = now;
    charges--; chargesSetAt = now;
    debug.dodges++;
  };

  const rollBack = (to: { x: number; z: number; y: number }) => {
    rig().place(new Vector3(to.x, to.y, to.z));
  };

  // ── abilities, the job board and the picks ──
  /** Presses slot `slot`, aimed at `ally` (else the focus, for an ally-aimed ability). */
  const press = (slot: number, ally?: number) => {
    if (isDead()) return;
    const id = self?.slots[slot];
    const now = performance.now();
    if (id === 'charged_shot' && !charge.press(slot, now)) return;
    lastPress = { slot, at: now };
    const a = id ? ABILITIES[id] : null;
    const allyAimed = !!a && (a.aim === 'ally' || a.aim === 'other-ally' || a.aim === 'dead-ally');
    const to = ally ?? (allyAimed && focus.id !== null ? focus.id : undefined);
    if (to !== undefined) focus.use(now);
    o.send('ability', to === undefined ? { slot, phase: 'press' } : { slot, phase: 'press', ally: to });
    // aimed at someone (the focus, the revive prompt): their name label flashes at once. With no aim the server's
    // own pick may follow rules this client cannot see (parties), so nothing flashes until the heal fx names them.
    if (a && allyAimed && to !== undefined && to !== myEid()) o.remotes.pulse(to);
    // a spell: slowed from the press (the server slows from a moment into the cast), never faster than allowed
    if (a && (a.cast ?? 0) > 0 && !self?.cast && !castPress) castPress = { slot, at: now, seenAt: null };
  };
  const openLoadout = () => {
    if (!self || isDead()) return;
    if (self.inCombat) { toast(refusalText('in-combat')); return; }
    const j = job(), current = self.slots.slice(3, 5);
    void hud.loadout(JOBS[j].pool.map((id) => ABILITY_DEFS[id]), current, JOBS[j].name, 2).then((ids) => {
      if (disposed || ids.length !== 2 || (ids[0] === current[0] && ids[1] === current[1])) return;
      o.send('loadout', { picks: [ids[0] as AbilityId, ids[1] as AbilityId] });
    });
  };
  const openJobs = () => {
    if (boardOpen) return;
    boardOpen = true;
    const r = rig().position;
    const view = jobBoardView(jobs, o.zone, { current: job(), pos: { x: r.x, z: r.z } });
    if (o.openTalents) view.talents = true;
    if (!view.note && self?.inCombat) view.note = refusalText('in-combat', 'job');
    void hud.jobs(view).then((id) => {
      boardOpen = false;
      if (disposed || !id) return;
      if (id === 'talents') { o.openTalents?.(); return; }
      if (id === job()) { openLoadout(); return; } // "Change picks" on the current job
      o.send('job', { job: id });
    });
  };

  // ── HUD events ──
  const onHud = (e: HudEvent) => {
    if (disposed) return;
    switch (e.type) {
      case 'ability': press(e.slot); break;
      case 'abilityUp': {
        // the slot it was pressed on, even if a swap or a loadout change has put something else there since
        if (charge.up(e.slot)) {
          releasedAt = performance.now();
          o.send('ability', { slot: e.slot, phase: 'release' });
        }
        break;
      }
      case 'dodge': dodge(e.dir); break;
      case 'cycleTarget': {
        const me = rig().position, list: { eid: number; d: number }[] = [];
        room.state.enemies?.forEach((v) => { if (v.mode !== 'dead' && v.mode !== 'return') list.push({ eid: v.eid, d: Math.hypot(v.x - me.x, v.z - me.z) }); });
        const next = cycleTarget(target, list);
        if (next !== null) setTarget(next);
        break;
      }
      case 'clearTarget': setTarget(null); followEid = null; chase = null; break;
      case 'respawn': if (isDead()) o.send('respawn', {} as Record<string, never>); break;
      case 'openJobs': openJobs(); break;
      case 'openLoadout': openLoadout(); break;
      case 'cycleAlly': {
        const id = focus.cycle(rig().position, others(), performance.now());
        setFocus(id);
        if (id === null) toast('Nobody near to focus');
        break;
      }
      case 'clearAlly': focus.clear(); setFocus(null); break;
      case 'focusMember': {
        if (playerByEid(e.eid)) setFocus(focus.set(e.eid, performance.now()));
        else toast('Not close enough to see them');
        break;
      }
      case 'invite': {
        const who = playerByEid(e.eid);
        if (!who) { toast('They are not here any more'); break; }
        o.send('party', { op: 'invite', eid: e.eid });
        // the server sends no answer when it works (only a refusal): say so here
        toast(`Invite sent to ${who.p.name}`);
        break;
      }
      case 'release': if (isDead() && instanced) sendRelease(); break;
      case 'leaveInstance': if (instanced && !isDead()) o.send('leaveInstance', {} as Record<string, never>); break;
      case 'interact': {
        const a = promptAction;
        if (a?.kind === 'revive') press(a.slot, a.eid);
        else if (a?.kind === 'board') openJobs();
        else if (a?.kind === 'release' || a?.kind === 'releaseWait') sendRelease();
        else if (a?.kind === 'mouth') {
          const y = game.world.groundAt(LAMPFALL_MOUTH.x, LAMPFALL_MOUTH.z) ?? rig().position.y;
          if (!game.walkTo(new Vector3(LAMPFALL_MOUTH.x, y, LAMPFALL_MOUTH.z))) toast('Walk into the crater to climb down');
        }
        break;
      }
      default: break;
    }
  };

  // ── server messages ──
  const onSelf = (m: S2C['self']) => {
    const now = performance.now();
    self = { ...m, at: now };
    // the server's count, unless it predates a dodge this client has just sent
    if (now - chargesSetAt > 500 || m.dodgeCharges < charges) charges = m.dodgeCharges;
    charge.onSelf(m.charge, now);
    if (m.charge === null && charge.pressedAt === null) releasedAt = -Infinity;
    if (castPress && m.cast && castPress.seenAt === null) castPress.seenAt = now;
    if (!m.cast && castFx && now - castFx.at > 400) castFx = null; // its castEnd was missed (a reconnect)
  };
  const onJobs = (m: S2C['jobs']) => {
    const was = jobs?.current;
    jobs = m;
    debug.jobs = m;
    if (was !== undefined && was !== m.current && isJobId(m.current)) {
      const j = JOBS[m.current];
      hud.toast(`You are now ${article(j.name)}`);
      hud.banner(j.name, `${roleLabel(j.role)} · ${WEAPONS[j.weapon].name}`);
      castPress = null; castFx = null;
    }
  };
  const onJobXp = (m: S2C['jobXp']) => {
    note({ t: 'jobXp', ...m });
    if (jobs && isJobId(m.job)) jobs = { ...jobs, jobs: { ...jobs.jobs, [m.job]: { ...jobs.jobs[m.job], xp: m.xp, level: m.level } } };
    if (m.levelUp && isJobId(m.job)) hud.toast(`${JOBS[m.job].name} reached level ${m.level}`);
  };
  const onRevived = (m: S2C['revived']) => {
    note({ t: 'revived', ...m });
    revivedAt = performance.now();
    deadSince = null;
    watching = false;
    if (deathScreen) { screenSeq++; hud.dismissEndScreen(); deathScreen = false; debug.screen = ''; }
    hud.toast('Back on your feet');
  };
  const onDisplaced = (m: S2C['displaced']) => {
    if (!isNewSeq(ack, m.seq)) return; // sent again after a reconnect: already applied
    debug.displaced++;
    note({ t: 'displaced', kind: m.kind, seq: m.seq });
    const wasFollowing = followEid;
    game.walkTo(null); followWalk = false; // the follow carries on once the displacement has played
    followEid = wasFollowing;
    const r = rig();
    if (m.kind === 'dodge' && pending) {
      const off = Math.hypot(pending.end.x - m.to.x, pending.end.z - m.to.z, pending.end.y - m.to.y);
      if (off > DODGE_SNAP_M) { r.place(new Vector3(m.to.x, m.to.y, m.to.z)); debug.corrections++; }
    } else if (m.kind === 'resync') {
      r.place(new Vector3(m.to.x, m.to.y, m.to.z));
    } else {
      r.displace(m.from, m.d); // a knockback (or a roll this client did not predict): the server's own
    }
    pending = null;
    ack = m.seq;
  };
  const onRespawned = (m: S2C['respawned']) => {
    if (!isNewSeq(ack, m.seq)) return; // sent again after a reconnect: already applied
    pending = null;
    game.walkTo(null);
    followEid = null;
    rig().place(new Vector3(m.x, m.y, m.z));
    ack = m.seq;
    screenSeq++;
    hud.dismissEndScreen();
    deathScreen = false; watching = false; debug.screen = '';
  };
  const onRefused = (m: S2C['refused']) => {
    debug.refusals.push(`${m.action}:${m.reason}`);
    debug.refused.push({ action: m.action, reason: m.reason });
    if (debug.refused.length > 20) debug.refused.shift();
    note({ t: 'refused', ...m });
    if (debug.refusals.length > 50) debug.refusals.shift();
    // a refused spell press: not slowed any more (a press during a cast is refused 'busy' and changes nothing)
    if (m.action === 'ability' && m.reason !== 'busy' && castPress && lastPress?.slot === castPress.slot && castPress.seenAt === null) castPress = null;
    if (m.action === 'dodge') {
      if (pending) { rollBack(pending.from); pending = null; }
      if (m.reason === 'charges') charges = 0;
    }
    if (m.action === 'ability' && charge.pressedAt !== null && refusalIsForCharge(lastPress, charge.slot, performance.now())) charge.cancel();
    // a refused respawn (too early): the death screen comes back with its button
    if (m.action === 'respawn' && deathScreen) { hud.dismissEndScreen(); deathScreen = false; }
    if (m.action === 'target' && target !== null) setTarget(null, false);
    // an ability pressed while it cools shakes its button already: no "Not ready" toast for it
    if (!(m.action === 'ability' && m.reason === 'cooldown')) toast(refusalText(m.reason, m.action));
  };
  const onFx = (m: S2C['fx']) => {
    debug.fxSeen += m.events.length;
    for (const ev of m.events) note(ev);
    const me = myEid();
    for (const ev of m.events as FxEvent[]) {
      if (ev.t === 'hit' && ev.dst === me && target === null && room.state.enemies?.get(String(ev.src))) setTarget(ev.src);
      if (ev.t === 'use' && ev.src === me && ev.ability === 'sprint') sprintUntil = performance.now() + (SPRINT_S - SPRINT_EARLY_S) * 1000;
      if (ev.t === 'hit' && room.state.enemies?.get(String(ev.dst))) hurtAt.set(ev.dst, performance.now());
      if (ev.t === 'cast' && ev.src === me) castFx = { ability: ev.ability, total: ev.total, at: performance.now() };
      if (ev.t === 'phase') {
        // a boss between phases: its banner (lore.phases is 0-based: ev.phase is already the next one)
        phaseFx.set(ev.src, performance.now());
        const k = enemyView(ev.src)?.kind;
        if (k && Object.prototype.hasOwnProperty.call(BOSSES, k)) {
          const data = BOSSES[k as keyof typeof BOSSES];
          hud.banner(data.lore.phases[ev.phase] ?? data.phases[ev.phase]?.name ?? '', bossTitle(ENEMY_KINDS[k as EnemyKindId].name));
        }
      }
      if (ev.t === 'castEnd' && ev.src === me) {
        castFx = null; castPress = null;
        if (!ev.ok && ev.reason === 'interrupt') toast(`${ABILITIES[ev.ability].name} interrupted`);
        else if (!ev.ok && ev.reason === 'fizzle') toast(`${ABILITIES[ev.ability].name} fizzled: out of reach or sight`);
      }
    }
    effects.handle(m.events as FxEvent[], me);
  };

  // ── per frame ──
  const update = (dt: number) => {
    if (disposed) return;
    const now = performance.now();
    const r = rig();
    const me = meState();
    const dead = !!me?.dead;

    // a dodge answered by nothing for a second: send poses again (the server ignores them until its answer)
    if (pending && now - pending.at > DODGE_WAIT_MS) pending = null;
    // a dodge pressed meanwhile rolls now (or is dropped when it waited too long)
    if (queuedDodge && !pending && !r.displacing) { const q = queuedDodge; queuedDodge = null; if (now - q.at <= DODGE_QUEUE_MS) dodge(q.dir); }
    // a charge the server says is over (released, auto-released, cancelled) is not held here either, whatever the key did
    charge.update(self, now);
    // a spell press the server says is over (or never started) is not slowed any more
    if (castPress && !chargeStillHeld(castPress.at, castPress.seenAt, self ? { at: self.at, charge: self.cast ? 1 : null } : null, now)) castPress = null;

    // charges refill on the client's own clock between `self`s
    const maxDodges = self?.dodgeMax ?? DODGE_CHARGES;
    if (self && charges < maxDodges && self.dodgeNextIn > 0 && now - self.at > self.dodgeNextIn * 1000 && charges === self.dodgeCharges) charges++;

    // the server's target is the truth: it drops dead or far targets, and refuses bad ones
    const serverTarget = me?.target ?? -1;
    if (target !== null && serverTarget === -1 && me && now - lastTargetSent > 600) setTarget(null, false);
    else if (serverTarget >= 0 && serverTarget !== target && now - lastTargetSent > 600) setTarget(serverTarget, false);

    // speed: what the server allows now
    const charging = charge.pressedAt !== null || (self?.charge !== null && self?.charge !== undefined) || now - releasedAt < RELEASE_SLOW_MS;
    let scale = 1;
    if (dead) scale = 0;
    else if (charging) scale = CHARGE_SCALE;
    else if (now < sprintUntil) scale = SPRINT_SCALE;
    if (charging && now < sprintUntil) scale = CHARGE_SCALE * SPRINT_SCALE;
    // casting (the server's view, or a spell just pressed): CAST_MOVE_SCALE on top
    if (!dead && (castPress !== null || !!self?.cast || castFx !== null)) scale *= CAST_MOVE_SCALE;
    if (!room.reconnection.isReconnecting && !travelling) r.setMoveScale(scale); // a travel holds the adventurer still

    // death
    if (dead && deadSince === null && now - revivedAt > 2000) {
      deadSince = now;
      pending = null;
      game.walkTo(null); followEid = null;
      charge.cancel();
    }
    if (!dead && deadSince !== null) { deadSince = null; watching = false; if (deathScreen && debug.screen !== 'wipe') { screenSeq++; hud.dismissEndScreen(); deathScreen = false; debug.screen = ''; } }
    // the Lampfall: a wipe's screen (over any other), else the Fallen screen (wait for a revive, or release)
    const wipe = instanced ? wipeLeft(now) : null;
    if (wipe !== null && wipe > 0 && debug.screen !== 'wipe') {
      const seq = ++screenSeq;
      deathScreen = true; debug.screen = 'wipe';
      void hud.endScreen('defeat', ['Everyone in the party has fallen.', 'The foes still standing go back to their places.'], ['OK'], {
        title: 'The light goes out…', countdown: { seconds: wipe, text: `Back to the ${checkpoint()} in {s} s` },
      }).then(() => { if (seq === screenSeq) { deathScreen = false; watching = true; debug.screen = ''; } });
    } else if (instanced && dead && !deathScreen && !watching && deadSince !== null && now - revivedAt > 2000) {
      const seq = ++screenSeq;
      deathScreen = true; debug.screen = 'fallen';
      void hud.endScreen('defeat', ['You have fallen.', `A party member can bring you back, or release to get up at the ${checkpoint()}.`], ['Release', 'Watch'], {
        title: 'Fallen', countdown: { seconds: releaseLeft(now), text: 'Release in {s} s', doneText: 'You can release now' },
      }).then((i) => {
        if (seq !== screenSeq || disposed) return;
        debug.screen = '';
        if (i === 0) { if (sendRelease()) debug.screen = 'released'; else deathScreen = false; } // too early: it comes back
        else { deathScreen = false; watching = i === 1; }
      });
    }
    if (!instanced && dead && !deathScreen && deadSince !== null && now - revivedAt > 2000) {
      deathScreen = true; debug.screen = 'defeat';
      const since = (now - deadSince) / 1000;
      void hud.endScreen('defeat', ['You were defeated.', 'You will wake by the statue in Shady Grove.'], ['Return to the statue'], {
        countdown: { seconds: Math.max(1, AUTO_RESPAWN_S - since), text: 'Waking there by yourself in {s} s' },
        waitS: Math.max(0, DEATH_MIN_S - since),
      }).then((i) => {
        if (i === 0 && !disposed) o.send('respawn', {} as Record<string, never>);
        if (i === 0 && isDead()) deathScreen = true; // stays until respawned arrives
      });
    }

    // resume following the target once a knockback or roll has played; keep a chased target in range
    if (chase && (chase.eid !== target || game.walkOverriddenAt > chase.since || dead)) chase = null;
    // the player steered themselves (keys, joystick) since the walk toward the target began: stop following
    if (followEid !== null && game.walkOverriddenAt > followSince) followEid = null;
    // the walk toward it stopped without arriving (stuck against something): give up, or it would walk into it again and again
    if (followWalk && !game.walking) { followWalk = false; if (followEid !== null) { followEid = null; chase = null; } }
    if (followEid !== null && !r.displacing && !pending && target === followEid && !game.walking) followTarget(followEid);
    else if (chase && followEid === null && !r.displacing && !pending && !game.walking && hud.settings.tapToWalk) {
      const e = enemyView(chase.eid);
      if (e && isKind(e.kind) && e.mode !== 'dead' && Math.hypot(e.x - r.position.x, e.z - r.position.z) > range() + ENEMY_KINDS[e.kind].radius + 0.3) followTarget(chase.eid);
    }

    // enemies: wind-up start times, hurt times, the target ring
    room.state.enemies?.forEach((e) => {
      const w = windupSince.get(e.eid);
      // its start by the server's clock (from its telegraph), so one first seen mid-wind-up shows how far along it is
      if (e.windup && (!w || w.attack !== e.windup)) windupSince.set(e.eid, { attack: e.windup, at: now - windupElapsedS(room.state, e.eid) * 1000 });
      else if (!e.windup && w) windupSince.delete(e.eid);
      const was = lastHp.get(e.eid);
      if (was !== undefined && e.hp < was) hurtAt.set(e.eid, now);
      lastHp.set(e.eid, e.hp);
    });
    if (target !== null) o.enemies.get(target)?.view.setTargeted(true);
    // forget enemies that left the view
    for (const m of enemyMaps) {
      if (m.size > 0) for (const eid of m.keys()) if (!room.state.enemies?.get(String(eid))) m.delete(eid);
    }

    // telegraphs (and the danger edge when standing in one)
    const inDanger = telegraphs.update(now, r.position.x, r.position.z);
    if (inDanger !== debug.inDanger) { debug.inDanger = inDanger; hud.danger(inDanger ? 'on' : 'off'); }
    debug.telegraphs = telegraphs.count;

    // HUD: the adventurer
    const p = state.player;
    if (me) { p.hp = me.hp; p.maxHp = me.maxHp; }
    p.dead = dead;
    if (selfRing.isEnabled() === dead) selfRing.setEnabled(!dead);
    p.weapon = weapon();
    p.momentum = self ? self.momentum : 0;
    p.jobLocked = !!self?.inCombat;
    const j = job();
    jobBadge.id = j; jobBadge.name = JOBS[j].name; jobBadge.glyph = JOBS[j].glyph; jobBadge.level = jobs?.jobs[j]?.level ?? 1;
    p.job = jobBadge;
    selfStatuses.length = 0;
    if ((me?.shield ?? 0) > 0) selfStatuses.push('guard');
    p.statuses = buffStatuses(me?.buffs ?? 0, 'adventurer', selfStatuses);
    if (self) {
      const el = (now - self.at) / 1000;
      const refill = charges >= maxDodges ? 1 : Math.max(0, Math.min(1, 1 - (self.dodgeNextIn - el) / DODGE_REFILL_S));
      const pd = (p.dodge ??= { charges: 0, max: maxDodges, refill: 1 }); // reused: no per-frame objects
      pd.charges = Math.max(0, charges); pd.max = maxDodges; pd.refill = refill;
      const held = charge.pressedAt !== null ? (now - charge.pressedAt) / 1000 : self.charge !== null ? self.charge + el : null;
      if (held !== null && !dead) { myCast.frac = Math.min(1, held / CHARGE_FULL_S); p.cast = myCast; }
      else if (!dead && (castFx || self.cast)) {
        // a spell: from its `cast` fx at once, else from the server's `self`
        const id = castFx?.ability ?? self.cast!.ability;
        spellCast.name = ABILITIES[id].name;
        spellCast.frac = castFx ? Math.min(1, (now - castFx.at) / 1000 / Math.max(0.05, castFx.total)) : castFrac(self.cast!, self.at, now);
        p.cast = spellCast;
      } else p.cast = null;
    }
    state.slots = slotView(self, now, dead, slotsOut, castFx?.ability ?? self?.cast?.ability ?? null);
    state.inCombat = !!self?.inCombat;

    // HUD: the target (kept from its last sight while briefly out of view)
    let t: EnemyStateView | undefined = target !== null ? enemyView(target) : undefined;
    // a copy of its last sight, into one reused object (no per-frame allocation)
    if (t) { targetCopy = Object.assign(targetCopy ?? {}, t); if (targetSeen) { targetSeen.e = targetCopy as unknown as EnemyStateView; targetSeen.at = now; } else targetSeen = { e: targetCopy as unknown as EnemyStateView, at: now }; }
    else if (target !== null && targetSeen && now - targetSeen.at < 3000) t = targetSeen.e;
    else if (target !== null && targetSeen && now - targetSeen.at >= 3000) { setTarget(null); }
    if (t && isKind(t.kind)) {
      const k = ENEMY_KINDS[t.kind];
      const w = windupSince.get(t.eid);
      const statuses = buffStatuses(t.debuffs ?? 0, 'enemy', markStatuses(t.marks ?? 0, targetStatuses));
      if (t.mode === 'stunned') statuses.push('stunned');
      state.target = {
        name: k.name, hp: t.hp, maxHp: t.maxHp, statuses,
        stagger: t.stagger ?? 0, maxStagger: t.maxStagger ?? 0, isBoss: k.elite,
        staggerImmune: t.staggerImmune ?? 0, surging: !!t.surging,
        cast: t.windup && isAttack(t.windup) ? {
          name: ENEMY_ATTACKS[t.windup].name, interruptible: ENEMY_ATTACKS[t.windup].interruptible,
          frac: w ? Math.min(1, (now - w.at) / 1000 / Math.max(0.1, t.windupTotal || ENEMY_ATTACKS[t.windup].windup)) : 0,
        } : null,
      };
    } else state.target = null;

    // ally focus: dropped when they leave the view or go unused; the ring under them and their frame
    focus.update(isPlayerEid, now);
    if (focus.id !== debug.allyFocus) setFocus(focus.id);
    const fp = focus.id !== null ? playerByEid(focus.id) : null;
    focusRing.attach(fp ? o.remotes.viewOfEid(focus.id!)?.root ?? null : null);
    focusRing.update(dt);
    if (fp) {
      const a = allyView, pv = fp.p;
      a.name = pv.name; a.hp = pv.hp; a.maxHp = pv.maxHp; a.dead = !!pv.dead;
      a.glyph = isJobId(pv.job) ? JOBS[pv.job].glyph : '';
      a.inRange = Math.hypot(pv.x - r.position.x, pv.z - r.position.z) <= FOCUS_RANGE + RANGE_FUZZ;
      a.eid = focus.id!;
      a.canInvite = !!party && !party.memberByEid(focus.id!) && party.canInvite(myName());
      a.statuses.length = 0;
      if ((pv.shield ?? 0) > 0) a.statuses.push('guard');
      buffStatuses(pv.buffs ?? 0, 'adventurer', a.statuses);
      const c = pv.cast ?? '';
      if (c && Object.prototype.hasOwnProperty.call(ABILITIES, c)) {
        allyCast.name = ABILITIES[c as AbilityId].name;
        const total = Math.max(0.1, pv.castTotal ?? 1), clock = room.state.clock;
        allyCast.frac = typeof clock === 'number' && typeof pv.castAt === 'number' ? Math.max(0, Math.min(1, (clock - pv.castAt) / TICK_HZ / total)) : 0;
        a.cast = allyCast;
      } else a.cast = null;
      state.ally = a;
    } else state.ally = null;

    // the context prompt: revive a fallen adventurer in reach (Second Dawn on the bar), or the Guild Board
    promptAction = null;
    let promptText: string | null = null;
    const reviveSlot = self ? self.slots.findIndex(isReviveId) : -1;
    // only while it can be cast now: not cooling down, and no other cast under way
    const reviveReady = reviveSlot >= 0 && !!self && (self.cd[reviveSlot] ?? 0) - (now - self.at) / 1000 <= 0 && !self.cast && !castFx;
    if (!dead && reviveReady && self) {
      const ab = ABILITIES[self.slots[reviveSlot]];
      // the server's own pick reaches party members only (the ally rule): the hint guesses the same
      const want = aimHint(ab, focus.id, meAlly(), others(), isMemberEid);
      const who = want !== null ? playerByEid(want) : null;
      if (who && want !== null) { promptAction = { kind: 'revive', eid: want, slot: reviveSlot }; promptText = `${ab.name} · Revive ${who.p.name}`; }
    }
    if (!promptAction && o.zone === 'grove' && Math.hypot(GUILD_BOARD.x - r.position.x, GUILD_BOARD.z - r.position.z) <= GUILD_BOARD_REACH) {
      promptAction = { kind: 'board' }; promptText = 'Guild Board · Jobs';
    }
    // dead in the Lampfall with the Fallen screen put away: Release (once allowed)
    if (!promptAction && dead && instanced && !deathScreen) {
      const n = Math.ceil(releaseLeft(now));
      if (n !== releaseN) { releaseN = n; releaseText = n > 0 ? `Release in ${n} s` : `Release · get up at the ${checkpoint()}`; }
      promptAction = n > 0 ? { kind: 'releaseWait' } : { kind: 'release' }; promptText = releaseText;
    }
    // the crater mouth (the Greenway): what the Lampfall is, who comes along, and why not now
    if (o.zone === 'greenway' && now >= mouthCheckAt) {
      mouthCheckAt = now + 400;
      const d = Math.hypot(LAMPFALL_MOUTH.x - r.position.x, LAMPFALL_MOUTH.z - r.position.z);
      mouthNear = d <= 14 && !dead;
      if (!mouthNear) mouthHint = null;
      else if (self?.inCombat) mouthHint = REASON_IN_COMBAT;
      else {
        const v = party?.view;
        const mates = v ? v.members.filter((m) => m.name !== myName()).map((m) => m.name) : [];
        mouthHint = mouthHintText(mates, jobBadge.level);
      }
    }
    if (!promptAction && mouthNear && o.zone === 'greenway' && !self?.inCombat && !dead) { promptAction = { kind: 'mouth' }; promptText = 'Enter the Lampfall'; }
    state.prompt = promptText;
    state.hint = o.zone === 'greenway' ? mouthHint : null;

    // the Lampfall: a banner with each room's name on walking into it
    if (instanced && now >= roomCheckAt) {
      roomCheckAt = now + 250;
      const rm = lampfallRoomAt(r.position.x, r.position.z);
      if (rm && rm.id !== roomId) { if (roomId !== null) hud.banner(rm.name, 'The Lampfall'); roomId = rm.id; }
    }

    // the party frames (members here read their PlayerState), their rings, and the edge markers toward those off screen
    if (party) {
      const pos = r.position;
      state.party = partyBars(party.view, myName(), memberHere, pos, partyOut);
      let ring = 0, en = 0;
      for (const b of state.party) {
        if (b.eid < 0) continue;
        const pv = playerByEid(b.eid)?.p;
        if (!pv) continue;
        rings.set(ring++, o.remotes.viewOfEid(b.eid)?.root ?? null);
        const m = (edgePool[en] ??= { id: 0, x: 0, y: 0, z: 0, initial: '' });
        m.id = b.eid; m.x = pv.x; m.y = pv.y + 1; m.z = pv.z; m.initial = b.name.charAt(0).toUpperCase();
        en++;
      }
      rings.clearFrom(ring);
      edgeList.length = 0;
      for (let i = 0; i < en; i++) edgeList.push(edgePool[i]);
      const cv = game.scene.getEngine().getRenderingCanvas(), cam = game.scene.activeCamera;
      if (cv && cam && en > 0) {
        const w = cv.clientWidth, hh = cv.clientHeight;
        if (!viewport || w !== vpW || hh !== vpH) { vpW = w; vpH = hh; viewport = cam.viewport.toGlobal(w, hh); }
        vpSize.w = w; vpSize.h = hh; edgeCam.x = pos.x; edgeCam.z = pos.z;
        state.edges = edgeMarkerLayout(edgeCam, vpSize, edgeList, hud.exclusions(), edgeOut);
      } else { edgeOut.length = 0; state.edges = edgeOut; }
    }

    // the boss frame: the targeted boss, else an engaged one in view
    let boss: EnemyStateView | undefined = target !== null ? enemyView(target) : undefined;
    if (boss && !isBossKind(boss.kind)) boss = undefined;
    if (!boss) { bossPick = undefined; room.state.enemies?.forEach(pickBoss); boss = bossPick; }
    if (boss) {
      const w = windupSince.get(boss.eid), data = BOSSES[boss.kind as keyof typeof BOSSES];
      bossOpts.windupFrac = w && boss.windup ? (now - w.at) / 1000 / Math.max(0.1, boss.windupTotal || 1) : 0;
      const ph = phaseFx.get(boss.eid);
      bossOpts.transitionLeftS = ph !== undefined ? data.transitionS - (now - ph) / 1000 : 0;
      bossOpts.targeted = boss.eid === target;
      state.boss = bossBar(boss, room.state.clock, bossOpts, bossOut);
      bossDebug.kind = boss.kind; bossDebug.phase = bossOut.phase; bossDebug.warded = bossOut.warded; bossDebug.enrageIn = bossOut.enrageIn;
      debug.boss = bossDebug;
    } else { state.boss = null; debug.boss = null; }

    overheads.update({ target, hurtAt, now, me: myEid() });
    effects.update(dt);

    debug.ack = ack;
    debug.chasing = chase?.eid ?? null;
    debug.self = me ? { hp: me.hp, momentum: self?.momentum ?? 0, dead, target, job: job(), cast: self?.cast ?? null } : null;
  };
  return {
    get ack() { return ack; },
    onHud,
    message(type, m) {
      if (disposed) return;
      switch (type) {
        case 'self': onSelf(m as S2C['self']); break;
        case 'displaced': onDisplaced(m as S2C['displaced']); break;
        case 'respawned': onRespawned(m as S2C['respawned']); break;
        case 'refused': onRefused(m as S2C['refused']); break;
        case 'fx': onFx(m as S2C['fx']); break;
        case 'credit': note({ t: 'credit', ...(m as S2C['credit']) }); break; // a kill is shown by the enemy's death; logged for playtests
        case 'jobs': onJobs(m as S2C['jobs']); break;
        case 'jobXp': onJobXp(m as S2C['jobXp']); break;
        case 'revived': onRevived(m as S2C['revived']); break;
        default: break;
      }
    },
    canSendPose: () => !pending && !rig().displacing && !isDead(),
    onTap(tap) {
      // the Guild Board: walk over (tap-to-walk) and open the job board, like talking to someone
      if (tap.entityId === GUILD_BOARD_EID) {
        const pos = rig().position;
        followEid = null; chase = null;
        if (Math.hypot(GUILD_BOARD.x - pos.x, GUILD_BOARD.z - pos.z) <= GUILD_BOARD_REACH || !hud.settings.tapToWalk || isDead()) { game.walkTo(null); openJobs(); return true; }
        const y = game.world.groundAt(GUILD_BOARD.x, GUILD_BOARD.z) ?? pos.y;
        if (!game.walkTo(new Vector3(GUILD_BOARD.x, y, GUILD_BOARD.z), { within: GUILD_BOARD_REACH - 0.3, then: () => { if (!disposed) openJobs(); } })) openJobs();
        return true;
      }
      const ids = tapIds; ids.clear();
      room.state.enemies?.forEach((e) => { if (e.mode !== 'dead') ids.add(e.eid); });
      const subject = tapSubject(tap.entityIds ?? (tap.entityId !== null ? [tap.entityId] : []), (id) => ids.has(id), (id) => playerByEid(id) !== null, myEid());
      // another adventurer (and no enemy under the tap): focus them for ally abilities (again: clear it). In a town
      // the tap still walks to the ground there (boot.ts, with tap-to-walk on); out in the wild it only focuses.
      if (subject?.kind === 'ally') {
        setFocus(focus.tap(subject.id, performance.now()));
        if (o.zone === 'grove' && hud.settings.tapToWalk && tap.point && !isDead()) { followEid = null; chase = null; return false; }
        return true;
      }
      if (isDead()) return true;
      if (subject?.kind === 'enemy' && subject.id !== tap.entityId) tap = { ...tap, entityId: subject.id };
      let reach = Infinity;
      if (tap.entityId !== null && ids.has(tap.entityId)) {
        const e = enemyView(tap.entityId)!, pos = rig().position;
        reach = Math.hypot(e.x - pos.x, e.z - pos.z) - (isKind(e.kind) ? ENEMY_KINDS[e.kind].radius : 0.5);
      }
      const a = tapAction(tap, hud.settings, ids, reach, range());
      // the ground: boot.ts walks there (when the setting is on); walking toward an enemy stops
      if (a.target === undefined) { followEid = null; chase = null; return false; }
      setTarget(a.target);
      // with tap-to-walk on, a tapped enemy is chased: kept in range while it moves (until the player moves themselves)
      chase = hud.settings.tapToWalk ? { eid: a.target, since: performance.now() } : null;
      if (a.walk === 'enemy') followTarget(a.target);
      else { game.walkTo(null); followEid = null; }
      return true;
    },
    onCorrect() { pending = null; },
    onTravel() { travelling = true; queuedDodge = null; },
    update,
    debug,
    dispose() {
      disposed = true;
      if (target !== null) o.enemies.get(target)?.view.setTargeted(false);
      telegraphs.dispose();
      overheads.dispose();
      selfRing.dispose(); ringMat.dispose();
      focusRing.dispose(); o.remotes.setFocus(null);
      rings.dispose();
      state.prompt = null; state.ally = null; state.boss = null; state.hint = null; state.edges = undefined;
      partyOut.length = 0; state.party = partyOut; phaseFx.clear();
      screenSeq++;
      effects.dispose();
      if (deathScreen) hud.dismissEndScreen();
      hud.closeSheets(); // the board and the picks belong to this room: their answers would go nowhere
      hud.danger('off');
    },
  };
}
