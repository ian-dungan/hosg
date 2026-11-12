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
import { Color3, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';
import {
  ABILITIES, CHARGE_FULL_S, CHARGE_INTERRUPT_FRAC, DEATH_MIN_S, AUTO_RESPAWN_S, DODGE_CHARGES, DODGE_MIN_GAP_S, DODGE_REFILL_S,
  ENEMY_ATTACKS, ENEMY_KINDS, PLAN3_FREE_POOL, MARK_BITS, SPRINT_S, SPRINT_SCALE, TARGET_RANGE, TELEGRAPH_LEAD_S, WEAPONS,
  dodgeDisplacement, simulateDisplacement,
  type AbilityId, type C2S, type EnemyAttackId, type EnemyKindId, type FxEvent, type MarkId, type S2C, type SelfView, type WeaponId,
} from '@sg2/shared';
import type { HudApi, HudEvent, HudState, StatusId, TapInfo } from '../core/contracts';
import type { Game } from '../boot';
import type { Enemies } from '../net/enemies';
import type { Remotes } from '../net/remotes';
import { windupElapsedS, type EnemyStateView, type PlayerView, type ZoneRoom } from '../net/session';
import { ABILITY_DEFS } from './abilityDefs';
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
 * The five ability slots as the HUD shows them, timers counted down from when `self` arrived. Written into
 * `out` (its entries reused, so nothing is allocated per frame) and returned.
 */
export function slotView(self: SelfSnap | null, nowMs: number, dead = false, out: HudState['slots'] = []): HudState['slots'] {
  if (!self) { out.length = 0; return out; }
  const el = Math.max(0, (nowMs - self.at) / 1000);
  const gcd = Math.max(0, self.gcd - el); // shown only while the slot also cools
  out.length = Math.min(out.length, self.slots.length);
  for (let i = 0; i < self.slots.length; i++) {
    const id = self.slots[i], a = ABILITIES[id];
    const cd = Math.max(0, (self.cd[i] ?? 0) - el);
    const usable = !dead && !(a.cost !== undefined && self.momentum < a.cost);
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

const GUARDED: StatusId[] = ['guard'], UNGUARDED: StatusId[] = [];
/** The Plan 3 marks the HUD has statuses for (Rooted and Dazed get theirs in Task 7). */
const MARK_IDS: readonly Extract<MarkId, StatusId>[] = ['marked', 'burning', 'soaked'];
/** The marks set in `bits` as HUD status ids, written into `out` (emptied first) and returned. */
export function markStatuses(bits: number, out: StatusId[] = []): StatusId[] {
  out.length = 0;
  for (const m of MARK_IDS) if (bits & MARK_BITS[m]) out.push(m);
  return out;
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
  charges: 'No dodges left', air: "Can't dodge in the air", 'in-combat': 'Not during a fight',
};
/** The toast for a refusal, or null for the silent ones (stale, rate, dead, busy, invalid). */
export function refusalText(reason: string): string | null { return REFUSAL_TEXT[reason] ?? null; }

// ───────────────────────── the controller ─────────────────────────

/** How long a predicted dodge holds back poses waiting for the server's answer, in ms. */
const DODGE_WAIT_MS = 1000;
/** A predicted roll this close to the server's end needs no correction, in m. */
const DODGE_SNAP_M = 0.05;
/** Tap-to-walk keeps this much inside the weapon's range, in m. */
const RANGE_MARGIN = 0.5;
/** Charging slows the adventurer to this (the server's CHARGE_MOVE_SCALE). */
const CHARGE_SCALE = 0.4;
/** After a release, keep the charge slow this long unless the server says the charge is over, in ms. */
const RELEASE_SLOW_MS = 400;
/** Sprint ends this much earlier on the client than on the server (never faster than allowed), in s. */
const SPRINT_EARLY_S = 0.15;

export interface CombatDebug {
  self: { hp: number; momentum: number; dead: boolean; target: number | null } | null;
  fxSeen: number;
  ack: number;
  dodges: number; refusals: string[]; corrections: number; displaced: number;
  telegraphs: number;
  inDanger: boolean;
  /** The last fx events and refusals with their time (performance.now ms), for playtests. */
  log: { t: number; e: unknown }[];
  /** The enemy tap-to-walk keeps in range (null for none). */
  chasing: number | null;
}

/** The room messages the controller handles. */
export const COMBAT_MESSAGES = ['self', 'displaced', 'respawned', 'refused', 'fx', 'credit'] as const;
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
}

const isKind = (k: string): k is EnemyKindId => Object.prototype.hasOwnProperty.call(ENEMY_KINDS, k);
const isAttack = (a: string): a is EnemyAttackId => Object.prototype.hasOwnProperty.call(ENEMY_ATTACKS, a);

export function createCombat(o: CombatOpts): CombatController {
  const { game, hud, room, state } = o;
  const rig = () => game.rig;
  const meState = (): PlayerView | undefined => room.state.players?.get(room.sessionId);
  const debug: CombatDebug = { self: null, fxSeen: 0, ack: 0, dodges: 0, refusals: [], corrections: 0, displaced: 0, telegraphs: 0, inDanger: false, log: [], chasing: null };
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

  const telegraphs: Telegraphs = createTelegraphs(game.scene, game.world, room);
  const overheads: Overheads = createOverheads(game.scene, room, o.enemies);
  const effects: Effects = createEffects({ game, hud, room, remotes: o.remotes, enemies: o.enemies });
  // A soft ring on the ground under this adventurer, so it reads at a glance in a crowd of enemies and trees.
  const ringMat = new StandardMaterial('selfRingMat', game.scene);
  ringMat.disableLighting = true; ringMat.emissiveColor = new Color3(1, 0.93, 0.72); ringMat.alpha = 0.55; ringMat.zOffset = -2;
  const selfRing = MeshBuilder.CreateTorus('selfRing', { diameter: 1.15, thickness: 0.06, tessellation: 40 }, game.scene);
  selfRing.scaling.y = 0.2; selfRing.position.y = 0.05; selfRing.isPickable = false; selfRing.material = ringMat;
  selfRing.parent = game.rig.view.root;

  // ── helpers ──
  const myEid = () => meState()?.eid ?? -1;
  // Until Task 7 the HUD knows only the Plan 3 weapons: anything but the Bow shows as the Blade.
  const weapon = (): 'blade' | 'bow' => ((self?.weapon ?? (meState()?.weapon as WeaponId | undefined)) === 'bow' ? 'bow' : 'blade');
  const range = () => WEAPONS[weapon()].autoRange;
  const isDead = () => !!meState()?.dead;
  const enemyView = (eid: number) => room.state.enemies?.get(String(eid));
  const toast = (t: string | null) => { if (t) hud.toast(t); };

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

  // ── HUD events ──
  const onHud = (e: HudEvent) => {
    if (disposed) return;
    switch (e.type) {
      case 'ability': {
        if (isDead()) return;
        const id = self?.slots[e.slot];
        const now = performance.now();
        if (id === 'charged_shot' && !charge.press(e.slot, now)) return;
        lastPress = { slot: e.slot, at: now };
        o.send('ability', { slot: e.slot, phase: 'press' });
        break;
      }
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
      case 'swapWeapon': if (!isDead()) o.send('swap', {} as Record<string, never>); break;
      case 'openLoadout': {
        if (!self || isDead()) return;
        if (self.inCombat) { toast(refusalText('in-combat')); return; }
        const current = self.slots.slice(3, 5);
        void hud.loadout(PLAN3_FREE_POOL.map((id) => ABILITY_DEFS[id]), current, weapon(), 2).then((ids) => {
          if (disposed || ids.length !== 2 || (ids[0] === current[0] && ids[1] === current[1])) return;
          o.send('loadout', { free: [ids[0] as AbilityId, ids[1] as AbilityId] });
        });
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
    hud.dismissEndScreen();
    deathScreen = false;
  };
  const onRefused = (m: S2C['refused']) => {
    debug.refusals.push(`${m.action}:${m.reason}`);
    note({ t: 'refused', ...m });
    if (debug.refusals.length > 50) debug.refusals.shift();
    if (m.action === 'dodge') {
      if (pending) { rollBack(pending.from); pending = null; }
      if (m.reason === 'charges') charges = 0;
    }
    if (m.action === 'ability' && charge.pressedAt !== null && refusalIsForCharge(lastPress, charge.slot, performance.now())) charge.cancel();
    // a refused respawn (too early): the death screen comes back with its button
    if (m.action === 'respawn' && deathScreen) { hud.dismissEndScreen(); deathScreen = false; }
    if (m.action === 'target' && target !== null) setTarget(null, false);
    // an ability pressed while it cools shakes its button already: no "Not ready" toast for it
    if (!(m.action === 'ability' && m.reason === 'cooldown')) toast(refusalText(m.reason));
  };
  const onFx = (m: S2C['fx']) => {
    debug.fxSeen += m.events.length;
    for (const ev of m.events) note(ev);
    const me = myEid();
    for (const ev of m.events as FxEvent[]) {
      if (ev.t === 'hit' && ev.dst === me && target === null && room.state.enemies?.get(String(ev.src))) setTarget(ev.src);
      if (ev.t === 'use' && ev.src === me && ev.ability === 'sprint') sprintUntil = performance.now() + (SPRINT_S - SPRINT_EARLY_S) * 1000;
      if (ev.t === 'hit' && room.state.enemies?.get(String(ev.dst))) hurtAt.set(ev.dst, performance.now());
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

    // charges refill on the client's own clock between `self`s
    if (self && charges < DODGE_CHARGES && self.dodgeNextIn > 0 && now - self.at > self.dodgeNextIn * 1000 && charges === self.dodgeCharges) charges++;

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
    if (!room.reconnection.isReconnecting && !travelling) r.setMoveScale(scale); // a travel holds the adventurer still

    // death
    if (dead && deadSince === null) {
      deadSince = now;
      pending = null;
      game.walkTo(null); followEid = null;
      charge.cancel();
    }
    if (!dead && deadSince !== null) { deadSince = null; if (deathScreen) { hud.dismissEndScreen(); deathScreen = false; } }
    if (dead && !deathScreen && deadSince !== null) {
      deathScreen = true;
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
    p.swapLocked = !!self?.inCombat;
    p.statuses = (me?.shield ?? 0) > 0 ? GUARDED : UNGUARDED;
    if (self) {
      const el = (now - self.at) / 1000;
      const refill = charges >= DODGE_CHARGES ? 1 : Math.max(0, Math.min(1, 1 - (self.dodgeNextIn - el) / DODGE_REFILL_S));
      const pd = (p.dodge ??= { charges: 0, max: DODGE_CHARGES, refill: 1 }); // reused: no per-frame objects
      pd.charges = Math.max(0, charges); pd.max = DODGE_CHARGES; pd.refill = refill;
      const held = charge.pressedAt !== null ? (now - charge.pressedAt) / 1000 : self.charge !== null ? self.charge + el : null;
      if (held !== null && !dead) { myCast.frac = Math.min(1, held / CHARGE_FULL_S); p.cast = myCast; } else p.cast = null;
    }
    state.slots = slotView(self, now, dead, slotsOut);
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
      const statuses = markStatuses(t.marks ?? 0, targetStatuses);
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

    overheads.update({ target, hurtAt, now, me: myEid() });
    effects.update(dt);

    debug.ack = ack;
    debug.chasing = chase?.eid ?? null;
    debug.self = me ? { hp: me.hp, momentum: self?.momentum ?? 0, dead, target } : null;
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
        default: break;
      }
    },
    canSendPose: () => !pending && !rig().displacing && !isDead(),
    onTap(tap) {
      if (isDead()) return true;
      const ids = tapIds; ids.clear();
      room.state.enemies?.forEach((e) => { if (e.mode !== 'dead') ids.add(e.eid); });
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
      effects.dispose();
      if (deathScreen) hud.dismissEndScreen();
      hud.danger('off');
    },
  };
}
