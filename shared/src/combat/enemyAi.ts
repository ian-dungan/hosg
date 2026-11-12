// The enemy AI: every live enemy, every tick (called from engine.tick, after the adventurers and
// before enemy status). Aggro, target choice, chasing (straight lines, else budgeted path searches),
// the leash and the unreachable rule (walk home invulnerable, heal on arrival), autos, telegraphed
// attacks and how a hit on an adventurer resolves (i-frames, parry, shield, knock).
//
// Deterministic: enemies are visited in id order (the engine's Map is insertion ordered and ids only
// grow), and nothing reads the clock or Math.random. Bounded: at most PATHS_PER_TICK path searches of
// at most ENEMY_PATH_NODES per tick across the zone; every other check is a handful of ground samples.
// Robust to adventurers vanishing at any point: only ids are kept, and every one is looked up again.
import type { Surface } from '../body';
import { findPath, withClearance, type Vec2 } from '../path';
import {
  AGGRO_THREAT, ENEMY_PATH_NODES, ENEMY_REPLAN_S, PARRY_MOMENTUM, PARRY_STAGGER, PARRY_STUN_S, PATHS_PER_TICK,
  PERFECT_DODGE_MOMENTUM, PERFECT_DODGE_STAGGER, PERFECT_DODGE_WINDOW_S, UNREACHABLE_S,
} from './constants';
import { knockDisplacement } from './displace';
import { ENEMY_ATTACKS, type EnemyAttackData, type EnemyAttackId, type Knock } from './enemies';
import type { AdventurerState, CombatWorld, CombatZone, EnemyState } from './engine';
import { applyStagger, cancelWindup, hurtAdventurer, isInvulnerable, knockAdventurer, TIME_EPS } from './adventurer';
import { gainMomentum } from './momentum';
import { inShape, type Shape } from './shapes';
import { lineOfSight } from './sight';
import { enemyHit } from './stats';

// ───────── tuning of the AI itself (not combat numbers) ─────────
/** Engaged with no valid target for this long → walk home. */
export const NO_TARGET_S = 3;
/** Speed scale while walking home. */
export const RETURN_SPEED_SCALE = 1.5;
/** Home when this close to the camp spot, in m. */
const ARRIVE_M = 0.25;
/** A walk home that takes longer than this (or finds no way) ends with the enemy put back at its camp. */
export const RETURN_MAX_S = 20;
/** A melee enemy closes to this much inside its auto reach, so a small step back does not break contact. */
const REACH_MARGIN = 0.3;
/** "Progress" toward an out-of-reach target: getting this much closer than the best so far, in m. */
const PROGRESS_M = 0.5;
/** A path whose end is this far from where the goal now is gets re-planned (at the next allowed time). */
const GOAL_MOVED_M = 1.5;
/** Spacing of the samples a straight walk is checked with, in m. */
const LINE_STEP = 0.4;
/** Step of the Gore Charge dash, in m. */
const DASH_STEP = 0.25;

// ───────── per-enemy AI state (kept beside the engine's EnemyState) ─────────
interface Ai {
  engaged: boolean;
  noTargetSince: number | null;
  nextAutoAt: number;
  /** Movement: walking straight at the goal, or along `path`. */
  direct: boolean;
  path: Vec2[] | null; pathIdx: number; pathGoalX: number; pathGoalZ: number;
  /** Next straight-line check, and the earliest next path search. */
  planAt: number; searchAt: number;
  /** A step was refused: re-plan at once (a search still waits for searchAt). */
  dirty: boolean;
  /** The last path search found no way. */
  noWay: boolean;
  /** Unreachable rule: the best distance to the target so far, and when it last improved. */
  progTarget: number | null; progBest: number; progAt: number;
  returnSince: number;
}
const AI = new WeakMap<EnemyState, Ai>();
function aiOf(e: EnemyState, nowS: number): Ai {
  let ai = AI.get(e);
  if (!ai) {
    ai = {
      engaged: false, noTargetSince: null, nextAutoAt: -Infinity,
      direct: true, path: null, pathIdx: 0, pathGoalX: 0, pathGoalZ: 0, planAt: -Infinity, searchAt: -Infinity, dirty: false, noWay: false,
      progTarget: null, progBest: Infinity, progAt: nowS, returnSince: -Infinity,
    };
    AI.set(e, ai);
  }
  return ai;
}
function resetMovement(ai: Ai): void {
  ai.direct = true; ai.path = null; ai.pathIdx = 0; ai.planAt = -Infinity; ai.dirty = false; ai.noWay = false;
}

// ───────── per-zone helpers (cached: no allocation per tick) ─────────
const passCache = new WeakMap<CombatZone, Map<number, (x: number, z: number) => boolean>>();
/** Where an enemy of radius r may stand: on `ground` with r of ground all round it. */
export function enemyPassable(zone: CombatZone, r: number): (x: number, z: number) => boolean {
  let m = passCache.get(zone);
  if (!m) { m = new Map(); passCache.set(zone, m); }
  let f = m.get(r);
  if (!f) {
    const ground: Surface = zone.ground;
    f = withClearance((x, z) => ground(x, z) !== null, r);
    m.set(r, f);
  }
  return f;
}

/** Path searches run in the last tick of each world (for tests and the server's metrics). */
const stats = new WeakMap<CombatWorld, { searches: number; ticks: number }>();
export function enemyAiStats(w: CombatWorld): { searches: number } {
  return { searches: stats.get(w)?.searches ?? 0 };
}

const hyp = Math.hypot;
const ANY = () => true;
const fxOf = (w: CombatWorld) => w.out.fx;

/** True if every LINE_STEP along a→b (both ends included) is passable. */
function clearLine(ax: number, az: number, bx: number, bz: number, pass: (x: number, z: number) => boolean): boolean {
  const d = hyp(bx - ax, bz - az);
  const n = Math.max(1, Math.ceil(d / LINE_STEP));
  for (let k = 0; k <= n; k++) if (!pass(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
  return true;
}

const validTarget = (w: CombatWorld, id: number) => liveAdventurer(w, id) !== null;
function liveAdventurer(w: CombatWorld, id: number | null): AdventurerState | null {
  if (id === null) return null;
  const a = w.adventurers.get(id);
  return a && a.alive ? a : null;
}

// ───────── the tick ─────────
export function stepEnemies(w: CombatWorld, nowS: number, dt: number): void {
  let st = stats.get(w);
  if (!st) { st = { searches: 0, ticks: 0 }; stats.set(w, st); }
  st.searches = 0;
  const budget = { left: PATHS_PER_TICK };
  // Visit enemies in id order, but start each tick one further along, so no enemy is always last in
  // line for the search budget.
  const n = w.enemies.size;
  if (n > 0) {
    const start = st.ticks % n;
    let i = 0;
    for (const e of w.enemies.values()) { if (i >= start) stepEnemy(w, e, nowS, dt, budget); i++; }
    i = 0;
    for (const e of w.enemies.values()) { if (i >= start) break; stepEnemy(w, e, nowS, dt, budget); i++; }
  }
  st.ticks++;
  st.searches = PATHS_PER_TICK - budget.left;
  separate(w);
}

function stepEnemy(w: CombatWorld, e: EnemyState, now: number, dt: number, budget: { left: number }): void {
  if (!e.alive) { AI.delete(e); return; }
  const d = e.data;
  if (d.speed <= 0 && d.auto === null && d.attacks.length === 0) return; // the training dummy
  const ai = aiOf(e, now);

  if (e.act === 'return') { walkHome(w, e, ai, now, dt, budget); return; }
  if (e.act === 'stun' && now < e.actUntil - TIME_EPS) { holdProgress(ai, now); return; }

  if (e.windup) {
    if (now >= e.windup.endsAt - TIME_EPS) resolveWindup(w, e, now);
    holdProgress(ai, now);
    return; // rooted, facing locked
  }

  // aggro: an enemy with no target notices adventurers within `aggro` and in sight (y ignored)
  if (e.targetId === null && d.aggro > 0) {
    for (const a of w.adventurers.values()) {
      if (!a.alive || e.threat.has(a.id)) continue;
      if (hyp(a.x - e.x, a.z - e.z) <= d.aggro && lineOfSight(w.zone.sight, e.x, e.z, a.x, a.z)) e.threat.add(a.id, AGGRO_THREAT);
    }
  }
  if (!ai.engaged) {
    if (e.threat.choose(null, now, ANY) === null) return; // idle at camp
    ai.engaged = true;
    for (const id of d.attacks) e.attackReadyAt[id] = now + ENEMY_ATTACKS[id].firstAt;
    ai.nextAutoAt = now;
    ai.noTargetSince = null;
    ai.progTarget = null;
  }

  // target: the threat table's choice, every tick (its TARGET_SWITCH_MULT hysteresis keeps it steady,
  // and a taunt then starts and ends on the tick); only live adventurers in this zone are valid
  const current = e.targetId !== null && validTarget(w, e.targetId) ? e.targetId : null;
  e.targetId = e.threat.choose(current, now, (id) => validTarget(w, id));
  const t = liveAdventurer(w, e.targetId);
  if (!t) {
    e.targetId = null;
    ai.noTargetSince ??= now;
    if (now - ai.noTargetSince >= NO_TARGET_S - TIME_EPS) startReturn(w, e, ai, now);
    return;
  }
  ai.noTargetSince = null;

  // leash
  if (hyp(e.x - e.camp.x, e.z - e.camp.z) > d.leash) { startReturn(w, e, ai, now); return; }

  const dist = hyp(t.x - e.x, t.z - e.z);
  const sees = lineOfSight(w.zone.sight, e.x, e.z, t.x, t.z);

  // a telegraphed attack, when one is ready and the target is within its useRange
  for (const id of d.attacks) {
    const atk = ENEMY_ATTACKS[id];
    if (now >= (e.attackReadyAt[id] ?? Infinity) - TIME_EPS && dist <= atk.useRange && sees) {
      startWindup(w, e, atk, t, now);
      holdProgress(ai, now);
      return;
    }
  }

  // the auto, when in reach (horizontal only: an adventurer on a rock within reach is hit)
  const auto = d.auto;
  const reachE = dist - d.radius;
  const inReach = auto !== null && reachE <= auto.reach && (!auto.ranged || sees);
  if (inReach) {
    holdProgress(ai, now);
    if (dist > 0) e.facing = Math.atan2(t.x - e.x, t.z - e.z);
    if (now >= ai.nextAutoAt - TIME_EPS) {
      ai.nextAutoAt = now + auto.every;
      resolveHit(w, e, t, auto.raw, 'auto', !auto.ranged, null, now);
    }
  }

  // chase: melee closes to a little inside reach, a ranged enemy to keepRange (and into sight)
  const stopReach = auto === null ? 0 : auto.ranged ? Math.min(auto.reach, d.keepRange ?? auto.reach) : auto.reach - REACH_MARGIN;
  const stop = stopReach + d.radius;
  if (dist > stop || (auto?.ranged && !sees)) walk(w, e, ai, t.x, t.z, auto?.ranged && !sees ? 0 : stop, d.speed, dt, now, budget);
  else if (dist > 0) e.facing = Math.atan2(t.x - e.x, t.z - e.z);

  // the unreachable rule: out of reach with no progress for UNREACHABLE_S → home
  if (!inReach) {
    if (ai.progTarget !== t.id) { ai.progTarget = t.id; ai.progBest = Infinity; }
    const nd = hyp(t.x - e.x, t.z - e.z);
    if (nd < ai.progBest - PROGRESS_M) { ai.progBest = nd; ai.progAt = now; }
    if (now - ai.progAt >= UNREACHABLE_S - TIME_EPS) startReturn(w, e, ai, now);
  }
}

/** Rooted, stunned or in reach: the unreachable clock does not run. */
function holdProgress(ai: Ai, now: number): void {
  ai.progBest = Infinity; ai.progAt = now;
}

// ───────── walking ─────────
/**
 * One tick of walking toward (gx, gz), stopping `stop` short of it: straight when the line is clear,
 * else along a path (a search runs only when the budget and ENEMY_REPLAN_S allow). Every step must be
 * passable ground (a step from an unclear spot may go anywhere on ground, to get clear); a refused
 * step marks the plan dirty. y follows the ground.
 */
function walk(w: CombatWorld, e: EnemyState, ai: Ai, gx: number, gz: number, stop: number, speed: number, dt: number, now: number, budget: { left: number }): boolean {
  const d = hyp(gx - e.x, gz - e.z);
  if (d <= stop || !(dt > 0)) return false;
  const pass = enemyPassable(w.zone, e.data.radius);
  const goalMoved = !ai.direct && ai.path !== null && hyp(gx - ai.pathGoalX, gz - ai.pathGoalZ) > GOAL_MOVED_M;
  if (ai.dirty || now >= ai.planAt - TIME_EPS || goalMoved || (!ai.direct && ai.path === null)) {
    if (clearLine(e.x, e.z, gx, gz, pass)) {
      ai.direct = true; ai.path = null; ai.dirty = false; ai.noWay = false; ai.planAt = now + ENEMY_REPLAN_S;
    } else if (now >= ai.searchAt - TIME_EPS && budget.left > 0) {
      budget.left--;
      const p = findPath({ x: e.x, z: e.z }, { x: gx, z: gz }, pass, { maxNodes: ENEMY_PATH_NODES });
      ai.searchAt = now + ENEMY_REPLAN_S; ai.planAt = now + ENEMY_REPLAN_S;
      ai.direct = false; ai.path = p; ai.pathIdx = 0; ai.pathGoalX = gx; ai.pathGoalZ = gz; ai.dirty = false; ai.noWay = p === null;
    } else if (ai.direct) {
      ai.direct = false; ai.path = null; // blocked straight ahead: wait for a search
    }
  }
  let wx = gx, wz = gz, limit = d - stop;
  if (!ai.direct) {
    const p = ai.path;
    if (!p) return false; // no way found (or not searched yet): stand
    while (ai.pathIdx < p.length && hyp(p[ai.pathIdx].x - e.x, p[ai.pathIdx].z - e.z) < 0.05) ai.pathIdx++;
    if (ai.pathIdx < p.length) {
      wx = p[ai.pathIdx].x; wz = p[ai.pathIdx].z;
      limit = Math.min(hyp(wx - e.x, wz - e.z), d - stop);
    }
  }
  return stepToward(w, e, ai, wx, wz, Math.min(speed * dt, limit), pass);
}

/** Moves up to `len` toward (wx, wz) (sliding along x or z when the straight step is refused). */
function stepToward(w: CombatWorld, e: EnemyState, ai: Ai, wx: number, wz: number, len: number, pass: (x: number, z: number) => boolean): boolean {
  const dx = wx - e.x, dz = wz - e.z, l = hyp(dx, dz);
  if (!(l > 1e-9) || !(len > 0)) return false;
  const mx = (dx / l) * len, mz = (dz / l) * len;
  const ground = w.zone.ground;
  const ok = pass(e.x, e.z)
    ? pass
    : (x: number, z: number) => ground(x, z) !== null; // not clear where it stands: any ground gets it clear
  let nx = e.x + mx, nz = e.z + mz;
  if (!ok(nx, nz)) {
    if (ok(e.x + mx, e.z)) nz = e.z;
    else if (ok(e.x, e.z + mz)) nx = e.x;
    else { ai.dirty = true; return false; }
    ai.dirty = true;
  }
  const y = ground(nx, nz);
  if (y === null) { ai.dirty = true; return false; }
  e.facing = Math.atan2(nx - e.x, nz - e.z);
  e.x = nx; e.z = nz; e.y = y;
  return true;
}

// ───────── going home ─────────
function startReturn(w: CombatWorld, e: EnemyState, ai: Ai, now: number): void {
  cancelWindup(w, e);
  e.act = 'return'; e.actUntil = Infinity; e.targetId = null;
  e.threat.clear();
  e.marks = {}; e.burning = null;
  e.stagger = { value: 0, max: e.stagger.max, brokenUntil: -Infinity, lastGainAt: -Infinity };
  ai.engaged = false; ai.noTargetSince = null; ai.returnSince = now; ai.progTarget = null;
  resetMovement(ai);
}

function walkHome(w: CombatWorld, e: EnemyState, ai: Ai, now: number, dt: number, budget: { left: number }): void {
  const c = e.camp;
  if (hyp(c.x - e.x, c.z - e.z) > ARRIVE_M) {
    walk(w, e, ai, c.x, c.z, 0, e.data.speed * RETURN_SPEED_SCALE, dt, now, budget);
    const lost = ai.noWay; // searched, and there is no way home
    if (!lost && now - ai.returnSince < RETURN_MAX_S - TIME_EPS && hyp(c.x - e.x, c.z - e.z) > ARRIVE_M) return;
  }
  // home (or put back): full hp, threat clear, ready to notice adventurers again
  e.x = c.x; e.z = c.z; e.y = w.zone.ground(c.x, c.z) ?? e.y; e.facing = c.facing;
  e.hp = e.maxHp; e.act = ''; e.actUntil = -Infinity; e.targetId = null;
  e.threat.clear(); e.attackReadyAt = {};
  resetMovement(ai);
}

// ───────── attacks ─────────
function shapeFor(e: EnemyState, atk: EnemyAttackData, t: AdventurerState): Shape {
  const dir = t.x === e.x && t.z === e.z ? e.facing : Math.atan2(t.x - e.x, t.z - e.z);
  switch (atk.shape) {
    case 'circle-self': return { kind: 'circle', x: e.x, z: e.z, r: atk.r ?? 0 };
    case 'circle-target': return { kind: 'circle', x: t.x, z: t.z, r: atk.r ?? 0 };
    case 'cone': return { kind: 'cone', x: e.x, z: e.z, dir, r: atk.r ?? 0, angle: atk.angle ?? 0 };
    case 'line': return { kind: 'line', x: e.x, z: e.z, dir, length: atk.length ?? 0, width: atk.width ?? 0 };
  }
}

/** Places the telegraph (fixed from now on), roots the enemy and locks its facing; the cooldown runs from now. */
function startWindup(w: CombatWorld, e: EnemyState, atk: EnemyAttackData, t: AdventurerState, now: number): void {
  const shape = shapeFor(e, atk, t);
  if (t.x !== e.x || t.z !== e.z) e.facing = Math.atan2(t.x - e.x, t.z - e.z);
  const id = w.nextTelegraphId++;
  w.telegraphs.set(id, { id, owner: e.id, attack: atk.id, shape, startedAt: now, endsAt: now + atk.windup });
  e.windup = { attack: atk.id, startedAt: now, endsAt: now + atk.windup, interruptible: atk.interruptible, telegraphId: id };
  e.attackReadyAt[atk.id] = now + atk.cooldown;
}

/** The wind-up is over: every live adventurer inside the telegraph is hit; a Gore Charge then dashes. */
function resolveWindup(w: CombatWorld, e: EnemyState, now: number): void {
  const wu = e.windup!;
  const tg = wu.telegraphId === null ? undefined : w.telegraphs.get(wu.telegraphId);
  cancelWindup(w, e);
  if (!tg) return;
  const atk = ENEMY_ATTACKS[wu.attack];
  const shape = tg.shape;
  const lineDir = shape.kind === 'line' ? shape.dir : undefined;
  for (const a of w.adventurers.values()) {
    if (!a.alive || !e.alive) continue;
    if (inShape(shape, a.x, a.z)) resolveHit(w, e, a, atk.raw, atk.id, atk.parryable, atk.knock ?? null, now, shape, lineDir);
    else if (isInvulnerable(a, now) && dodgedFrom(a, shape, now)) resolveHit(w, e, a, atk.raw, atk.id, atk.parryable, null, now, shape, lineDir);
  }
  if (atk.dashToEnd && e.alive && shape.kind === 'line') dash(w, e, shape);
}

function dodgedFrom(a: AdventurerState, shape: Shape, now: number): boolean {
  return a.lastDodgeFrom !== null && now - a.lastDodgeAt <= PERFECT_DODGE_WINDOW_S + TIME_EPS && inShape(shape, a.lastDodgeFrom.x, a.lastDodgeFrom.z);
}

/** Along the line to its end, in DASH_STEP steps on passable ground, stopping early where it ends. */
function dash(w: CombatWorld, e: EnemyState, s: Extract<Shape, { kind: 'line' }>): void {
  const pass = enemyPassable(w.zone, e.data.radius);
  const ux = Math.sin(s.dir), uz = Math.cos(s.dir);
  const steps = Math.floor(s.length / DASH_STEP + 1e-9);
  let x = e.x, z = e.z;
  for (let k = 1; k <= steps; k++) {
    const nx = s.x + ux * DASH_STEP * k, nz = s.z + uz * DASH_STEP * k;
    if (!pass(nx, nz)) break;
    x = nx; z = nz;
  }
  e.x = x; e.z = z; e.y = w.zone.ground(x, z) ?? e.y;
  const ai = AI.get(e);
  if (ai) resetMovement(ai);
}

/**
 * One enemy hit on an adventurer, in order: i-frames → `miss` (perfect when inside the telegraph, or
 * dodged from inside it within PERFECT_DODGE_WINDOW_S: elite +15 stagger, adventurer +10 Momentum);
 * an open parry against a parryable hit → `parry` (nothing taken, +20 Momentum, the elite +35
 * stagger, an ordinary enemy stunned PARRY_STUN_S); else enemyHit(raw, defence) through the shield,
 * then the knock.
 */
export function resolveHit(
  w: CombatWorld, e: EnemyState, a: AdventurerState, raw: number, by: EnemyAttackId | 'auto', parryable: boolean,
  knock: Knock | null, now: number, shape?: Shape, lineDir?: number,
): void {
  if (!a.alive) return;
  a.lastCombatAt = now;
  if (isInvulnerable(a, now)) {
    const perfect = shape !== undefined && (inShape(shape, a.x, a.z) || dodgedFrom(a, shape, now));
    fxOf(w).push({ t: 'miss', src: e.id, dst: a.id, perfect });
    if (perfect) {
      a.momentum = gainMomentum(a.momentum, PERFECT_DODGE_MOMENTUM);
      if (e.data.elite) applyStagger(w, e, PERFECT_DODGE_STAGGER, now);
    }
    return;
  }
  if (parryable && now < a.parryUntil) {
    a.parryUntil = -Infinity;
    fxOf(w).push({ t: 'parry', src: a.id, dst: e.id });
    a.momentum = gainMomentum(a.momentum, PARRY_MOMENTUM);
    if (e.data.elite) applyStagger(w, e, PARRY_STAGGER, now);
    else {
      cancelWindup(w, e);
      e.act = 'stun'; e.actUntil = now + PARRY_STUN_S;
    }
    return;
  }
  hurtAdventurer(w, a, enemyHit(raw, a.stats.defence), e.id, by, now);
  if (knock && a.alive) knockAdventurer(w, a, knockDisplacement({ x: e.x, z: e.z }, a, knock, lineDir), now);
}

// ───────── keeping apart ─────────
const sepDx: number[] = [], sepDz: number[] = [], sepList: EnemyState[] = [];
/**
 * Overlapping enemies are pushed apart by their radii: each moves half the overlap (all of it when the
 * other is rooted), only onto passable ground. Pushes are summed first and then applied, so the result
 * does not depend on the order enemies are visited in.
 */
function separate(w: CombatWorld): void {
  sepList.length = 0;
  for (const e of w.enemies.values()) if (e.alive && e.act !== 'return' && !(e.data.speed <= 0)) sepList.push(e);
  const n = sepList.length;
  if (n < 2) return;
  for (let i = 0; i < n; i++) { sepDx[i] = 0; sepDz[i] = 0; }
  let any = false;
  for (let i = 0; i < n; i++) {
    const a = sepList[i];
    for (let j = i + 1; j < n; j++) {
      const b = sepList[j];
      const dx = b.x - a.x, dz = b.z - a.z, rr = a.data.radius + b.data.radius;
      if (Math.abs(dx) >= rr || Math.abs(dz) >= rr) continue;
      const d = hyp(dx, dz), over = rr - d;
      if (!(over > 1e-6)) continue;
      const ux = d > 1e-9 ? dx / d : 1, uz = d > 1e-9 ? dz / d : 0; // exactly stacked: apart along x, lower id to −x
      const ra = rooted(a), rb = rooted(b);
      if (ra && rb) continue;
      const sa = ra ? 0 : rb ? 1 : 0.5, sb = 1 - sa;
      sepDx[i] -= ux * over * sa; sepDz[i] -= uz * over * sa;
      sepDx[j] += ux * over * sb; sepDz[j] += uz * over * sb;
      any = true;
    }
  }
  if (!any) return;
  for (let i = 0; i < n; i++) {
    if (sepDx[i] === 0 && sepDz[i] === 0) continue;
    const e = sepList[i];
    const nx = e.x + sepDx[i], nz = e.z + sepDz[i];
    if (!enemyPassable(w.zone, e.data.radius)(nx, nz)) continue;
    const y = w.zone.ground(nx, nz);
    if (y === null) continue;
    e.x = nx; e.z = nz; e.y = y;
  }
}
const rooted = (e: EnemyState) => e.windup !== null || e.act === 'stun';
