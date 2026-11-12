// Engine II (Plan 4): the boss script. A boss (an enemy kind with `boss` data) runs Plan 3's aggro,
// targeting, leash, chase and autos (enemyAi.ts), but its telegraphed attacks come from its phase's
// rotation instead of cooldowns, and it has phases (a hp floor, an invulnerable transition, then the
// next phase's fields, adds and ward), an enrage timer and its own party-size scale table.
//
// The per-tick order (from enemyAi.stepEnemy): bossBusy first (the enrage clock, the transition, the
// Break stun, placing a repeat sequence's next telegraph, resolving due telegraphs); then Plan 3's
// aggro, wake, scaling and target choice; then stepBoss (start the next rotation entry when it can);
// then, when stepBoss says 'chase', Plan 3's chase and auto (anchored: at the camp spot).
//
// A rotation entry places one telegraph (Plan 3), one per engaged adventurer (`targets: 'each'`) or a
// timed sequence (`repeat`); the boss is rooted until its last telegraph resolves. Its `windup` spans
// them all. An interrupt (Plan 3) removes the entry's telegraph; a Break removes them all; either way
// the entry is over and the next starts `gap` s later.
//
// Deterministic: no clock, no Math.random; adventurers in insertion order, adds in spawn order.
import { ENEMY_ATTACKS, type EnemyAttackData, type EnemyAttackId } from './enemies';
import { ROTATION_SKIP_S, scaleFactor, type BossData, type BossPhase } from './bosses';
import type { AdventurerState, CombatWorld, EnemyState } from './engine';
import { cancelWindup, despawnEnemy, spawnEnemy, TIME_EPS } from './adventurer';
import { addField, removeFieldsOf } from './fields';
import { TOLL_PARTY_RAW_PER } from './constants';
import { enemyScaleN, farthestEngaged, inArena, resolveTelegraph, shapeFor } from './enemyAi';
import { lineOfSight } from './sight';

export interface BossAi {
  /** The phase index (0-based); during a transition already the phase being entered. */
  phase: number;
  /** A transition (act 'phase') ends then; -Infinity when none. */
  transitionUntil: number;
  /** When it woke (first engaged), null while asleep. */
  wokeAt: number | null;
  /** The next rotation entry (an index into the phase's rotation, taken mod its length) and when it may start. */
  next: number; nextAt: number;
  /** The entry `next` has waited since (no target in its useRange or sight), null while not waiting. */
  waitSince: number | null;
  /** Ids of the adds the current fight spawned (alive or not). */
  adds: number[];
  /** While any of `adds` lives, the boss takes × this; null without a ward. */
  wardMult: number | null;
  enraged: boolean; enrageUses: number;
  /** The phase anchors it at its camp spot. */
  anchored: boolean;
  /** The rotation entry in flight (its telegraphs still pending or still to be placed), else null. */
  busy: EnemyAttackId | null;
  /** When the entry in flight started. */
  busyAt: number;
  /** Its placed telegraphs not yet resolved, with the raw each deals. */
  pending: { tg: number; raw: number }[];
  /** A `repeat` sequence's next telegraph: the k-th, due at nextAt. */
  seq: { attack: EnemyAttackId; k: number; nextAt: number; dir: number; x: number; z: number; raw: number } | null;
}

const STATE = new WeakMap<EnemyState, BossAi>();

function asleep(): BossAi {
  return {
    phase: 0, transitionUntil: -Infinity, wokeAt: null, next: 0, nextAt: Infinity, waitSince: null, adds: [], wardMult: null,
    enraged: false, enrageUses: 0, anchored: false, busy: null, busyAt: -Infinity, pending: [], seq: null,
  };
}
function stateOf(e: EnemyState): BossAi {
  let s = STATE.get(e);
  if (!s) { s = asleep(); STATE.set(e, s); }
  return s;
}
/** The boss's script state (tests, debugging); undefined for anything that is not a boss. */
export function bossAiStateOf(e: EnemyState): BossAi | undefined {
  return e.data.boss ? stateOf(e) : undefined;
}

const script = (e: EnemyState): BossData => e.data.boss!;
const phaseOf = (e: EnemyState, s: BossAi): BossPhase => script(e).phases[s.phase];
function event(w: CombatWorld, e: EnemyState, ev: 'wake' | 'phase' | 'enrage' | 'reset', nowS: number, phase?: number): void {
  w.out.boss.push(phase === undefined ? { enemy: e.id, kind: e.kind, event: ev, atS: nowS } : { enemy: e.id, kind: e.kind, event: ev, phase, atS: nowS });
}

// ───────── views ─────────
export function bossPhase(e: EnemyState): number {
  return e.data.boss ? stateOf(e).phase : 0;
}
/** Some add of the boss's ward still lives. */
export function bossWarded(w: CombatWorld, e: EnemyState): boolean {
  if (!e.data.boss) return false;
  const s = stateOf(e);
  if (s.wardMult === null) return false;
  for (const id of s.adds) if (w.enemies.get(id)?.alive) return true;
  return false;
}
/** Seconds to the enrage (0 once enraged); null for a boss without one, or asleep. */
export function bossEnrageIn(e: EnemyState, nowS: number): number | null {
  const en = e.data.boss?.enrage;
  if (!en) return null;
  const s = stateOf(e);
  if (s.wokeAt === null) return null;
  return Math.max(0, s.wokeAt + en.s - nowS);
}
export function bossAutoEvery(e: EnemyState): number | undefined {
  return e.data.boss ? phaseOf(e, stateOf(e)).autoEvery : undefined;
}
export function bossAnchored(e: EnemyState): boolean {
  return e.data.boss !== undefined && stateOf(e).anchored;
}

// ───────── damage: the floor and the ward (adventurer.damageEnemy) ─────────
/** The incoming amount after the ward (rounded, at least 1 for a real hit). */
export function bossIncoming(w: CombatWorld, e: EnemyState, amount: number): number {
  if (!(amount > 0) || !bossWarded(w, e)) return amount;
  return Math.max(1, Math.round(amount * stateOf(e).wardMult!));
}
/** The lowest hp damage may leave: the phase's untilFrac × maxHp (0 in the last phase or asleep). */
export function bossFloor(e: EnemyState): number {
  const s = stateOf(e);
  const phases = script(e).phases;
  if (s.phase >= phases.length - 1) return 0;
  return phases[s.phase].untilFrac * e.maxHp;
}

// ───────── wake, transitions, reset, death ─────────
/** First engaged: the clock starts, phase 0's rotation begins after its gap. */
export function wakeBoss(w: CombatWorld, e: EnemyState, nowS: number): void {
  const s = asleep();
  STATE.set(e, s);
  s.wokeAt = nowS;
  enterPhase(e, s, 0, nowS);
  event(w, e, 'wake', nowS);
}
function enterPhase(e: EnemyState, s: BossAi, k: number, nowS: number): void {
  const p = script(e).phases[k];
  s.phase = k; s.anchored = p.anchor === true;
  s.next = 0; s.nextAt = s.enraged ? nowS : nowS + p.gap; s.waitSince = null;
}

/** Drops every telegraph of the entry in flight (and the wind-up); with `advance`, the rotation moves on a gap later. */
export function cancelBossAttacks(w: CombatWorld, e: EnemyState, nowS: number, advance: boolean): void {
  if (!e.data.boss) return;
  const s = stateOf(e);
  cancelWindup(w, e);
  for (const p of s.pending) w.telegraphs.delete(p.tg);
  for (const t of w.telegraphs.values()) if (t.owner === e.id) w.telegraphs.delete(t.id);
  s.pending = []; s.seq = null;
  if (s.busy !== null) {
    s.busy = null;
    if (advance) entryDone(e, s, nowS);
  }
}
function entryDone(e: EnemyState, s: BossAi, nowS: number): void {
  const en = script(e).enrage;
  if (s.enraged && en) s.nextAt = s.busyAt + en.every;
  else { s.next++; s.nextAt = nowS + phaseOf(e, s).gap; }
  s.waitSince = null;
}

/** hp reached the phase floor: invulnerable and still for transitionS (telegraphs cancelled), `phase` fx and event. */
export function startTransition(w: CombatWorld, e: EnemyState, nowS: number): void {
  const s = stateOf(e);
  cancelBossAttacks(w, e, nowS, false);
  const next = s.phase + 1;
  s.phase = next;
  s.transitionUntil = nowS + script(e).transitionS;
  e.act = 'phase'; e.actUntil = s.transitionUntil; e.surging = false;
  w.out.fx.push({ t: 'phase', src: e.id, phase: next });
  event(w, e, 'phase', nowS, next);
}
function endTransition(w: CombatWorld, e: EnemyState, s: BossAi, nowS: number): void {
  e.act = ''; e.actUntil = -Infinity; s.transitionUntil = -Infinity;
  const p = phaseOf(e, s);
  const on = p.onEnter;
  if (on?.clearFields) removeFieldsOf(w, e.id);
  for (const f of on?.fields ?? []) addField(w, e, f, nowS);
  if (on?.adds?.length) {
    // the boss's current factor (never below what it has reached this fight)
    const scale = scaleFactor(e.data, enemyScaleN(e));
    for (const add of on.adds) {
      const c = { kind: add.kind, x: e.camp.x + add.dx, z: e.camp.z + add.dz, facing: e.camp.facing, ...(e.camp.arena ? { arena: e.camp.arena } : {}) };
      const a = spawnEnemy(w, c, { engageWith: e.threat.ids(), scale, nowS, src: e.id });
      s.adds.push(a.id);
    }
    s.wardMult = on.wardMult ?? null;
  }
  enterPhase(e, s, s.phase, nowS);
}
/** Its live adds despawned (no credit), its fields and telegraphs removed. */
function clearFight(w: CombatWorld, e: EnemyState, s: BossAi, nowS: number): void {
  cancelBossAttacks(w, e, nowS, false);
  for (const id of s.adds) { const a = w.enemies.get(id); if (a) despawnEnemy(w, a); }
  removeFieldsOf(w, e.id);
}
/** Going home (startReturn): phase 0, adds and fields gone, the enrage clock stopped, `reset` event (when it was awake). */
export function resetBoss(w: CombatWorld, e: EnemyState, nowS = w.now): void {
  if (!e.data.boss) return;
  const s = stateOf(e);
  const awake = s.wokeAt !== null;
  clearFight(w, e, s, nowS);
  STATE.set(e, asleep());
  if (awake) event(w, e, 'reset', nowS);
}
/** Its death (killEnemy): live adds despawned with no credit, fields and telegraphs gone. */
export function bossDied(w: CombatWorld, e: EnemyState, nowS: number): void {
  if (!e.data.boss) return;
  const s = stateOf(e);
  clearFight(w, e, s, nowS);
  const phase = s.phase;
  STATE.set(e, { ...asleep(), phase });
}

// ───────── the tick ─────────
/**
 * Before Plan 3's targeting: the enrage clock, the transition, a Break's stun, the repeat sequence and
 * due telegraphs. True when the boss does nothing else this tick (in transition, stunned, or rooted
 * by an entry in flight).
 */
export function bossBusy(w: CombatWorld, e: EnemyState, nowS: number): boolean {
  const s = stateOf(e);
  if (s.wokeAt === null) return e.act === 'stun' && nowS < e.actUntil - TIME_EPS;
  const en = script(e).enrage;
  if (en && !s.enraged && nowS >= s.wokeAt + en.s - TIME_EPS) {
    s.enraged = true;
    w.out.fx.push({ t: 'enrage', src: e.id });
    event(w, e, 'enrage', nowS);
    if (e.act !== 'phase') { cancelBossAttacks(w, e, nowS, false); s.nextAt = nowS; s.waitSince = null; }
  }
  if (e.act === 'phase') {
    if (nowS < s.transitionUntil - TIME_EPS) return true;
    endTransition(w, e, s, nowS);
  }
  if (e.act === 'stun' && nowS < e.actUntil - TIME_EPS) return true;
  if (s.busy === null) return false;
  // nobody left to fight (a wipe, or everyone left the arena): the entry is dropped, so Plan 3's no-target rule runs
  if (!e.threat.ids().some((id) => { const a = w.adventurers.get(id); return a !== undefined && a.alive && inArena(e, a); })) {
    cancelBossAttacks(w, e, nowS, true);
    return false;
  }
  // the sequence's next telegraphs, from where the first was placed
  while (s.seq && nowS >= s.seq.nextAt - TIME_EPS) {
    const q = s.seq, atk = ENEMY_ATTACKS[q.attack], rep = atk.repeat!;
    const dir = q.dir + q.k * rep.rotate;
    e.facing = dir;
    place(w, e, atk, { kind: 'line', x: q.x, z: q.z, dir, length: atk.length ?? 0, width: atk.width ?? 0 }, q.raw, nowS);
    q.k++; q.nextAt += rep.every;
    if (q.k >= rep.count) s.seq = null;
  }
  // due telegraphs resolve in the order they were placed; one an interrupt removed is dropped
  let keep = 0;
  for (let i = 0; i < s.pending.length; i++) {
    const p = s.pending[i];
    const tg = w.telegraphs.get(p.tg);
    if (!tg) continue;
    if (nowS >= tg.endsAt - TIME_EPS) {
      w.telegraphs.delete(p.tg);
      resolveTelegraph(w, e, tg, p.raw, nowS);
      if (!e.alive || s !== STATE.get(e) || s.busy === null) return true; // it died, reset or was broken meanwhile
      continue;
    }
    s.pending[keep++] = p;
  }
  s.pending.length = keep;
  if (s.pending.length === 0 && s.seq === null) {
    e.windup = null;
    s.busy = null;
    entryDone(e, s, nowS);
    return false;
  }
  return true;
}

function place(w: CombatWorld, e: EnemyState, atk: EnemyAttackData, shape: ReturnType<typeof shapeFor>, raw: number, nowS: number): number {
  const id = w.nextTelegraphId++;
  w.telegraphs.set(id, { id, owner: e.id, attack: atk.id, shape, startedAt: nowS, endsAt: nowS + atk.windup });
  stateOf(e).pending.push({ tg: id, raw });
  return id;
}

/** Engaged live adventurers in the arena within range and in sight, in table order. */
function engagedWithin(w: CombatWorld, e: EnemyState, range: number): AdventurerState[] {
  const out: AdventurerState[] = [];
  for (const id of e.threat.ids()) {
    const a = w.adventurers.get(id);
    if (!a || !a.alive || !inArena(e, a)) continue;
    if (Math.hypot(a.x - e.x, a.z - e.z) <= range && lineOfSight(w.zone.sight, e.x, e.z, a.x, a.z)) out.push(a);
  }
  return out;
}

/**
 * After Plan 3's targeting, with live target t: starts the next rotation entry (or, enraged, the
 * enrage attack) when it is due and can start. 'handled' when it started one (the boss is rooted);
 * 'chase' to run Plan 3's chase and auto this tick.
 */
export function stepBoss(w: CombatWorld, e: EnemyState, nowS: number): 'handled' | 'chase' {
  const s = stateOf(e);
  const t = e.targetId === null ? undefined : w.adventurers.get(e.targetId);
  if (s.wokeAt === null || s.busy !== null || !t || !t.alive || nowS < s.nextAt - TIME_EPS) return 'chase';
  const data = script(e), p = phaseOf(e, s);
  const enraged = s.enraged && data.enrage !== undefined;
  const id: EnemyAttackId = enraged ? data.enrage!.attack : p.rotation[s.next % p.rotation.length];
  const atk = ENEMY_ATTACKS[id];
  let aims: AdventurerState[];
  if (atk.targets === 'each') aims = engagedWithin(w, e, atk.useRange);
  else if (atk.aimAt === 'farthest') { const f = farthestEngaged(w, e, atk.useRange); aims = f ? [f] : []; }
  else aims = Math.hypot(t.x - e.x, t.z - e.z) <= atk.useRange && lineOfSight(w.zone.sight, e.x, e.z, t.x, t.z) ? [t] : [];
  if (aims.length === 0) {
    s.waitSince ??= nowS;
    if (nowS - s.waitSince >= ROTATION_SKIP_S - TIME_EPS) { if (!enraged) s.next++; s.waitSince = null; }
    return 'chase';
  }
  s.waitSince = null;
  // an unavoidable attack grows with the party beyond three (TOLL_PARTY_RAW_PER a member: ruling P4-m E)
  const party = atk.unavoidable ? 1 + TOLL_PARTY_RAW_PER * Math.max(0, enemyScaleN(e) - 3) : 1;
  const raw = (atk.raw + (enraged && atk.ramp ? atk.ramp * s.enrageUses : 0)) * party;
  if (enraged) s.enrageUses++;
  const face = atk.targets === 'each' ? t : aims[0];
  if (face.x !== e.x || face.z !== e.z) e.facing = Math.atan2(face.x - e.x, face.z - e.z);
  let first = -1;
  for (const a of aims) { const tg = place(w, e, atk, shapeFor(e, atk, a), raw, nowS); if (first < 0) first = tg; }
  let endsAt = nowS + atk.windup;
  if (atk.repeat && atk.repeat.count > 1) {
    const sh = w.telegraphs.get(first)!.shape;
    s.seq = { attack: id, k: 1, nextAt: nowS + atk.repeat.every, dir: sh.kind === 'line' ? sh.dir : e.facing, x: e.x, z: e.z, raw };
    endsAt += (atk.repeat.count - 1) * atk.repeat.every;
  }
  e.windup = { attack: id, startedAt: nowS, endsAt, interruptible: atk.interruptible, telegraphId: first };
  s.busy = id; s.busyAt = nowS;
  return 'handled';
}
