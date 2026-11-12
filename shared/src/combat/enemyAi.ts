// The enemy AI: every live enemy, every tick (called from engine.tick, after the adventurers and
// before enemy status). Aggro, target choice, chasing (straight lines, else budgeted path searches),
// the chase surge, the leash and the unreachable rule (walk home invulnerable, heal on arrival),
// autos, telegraphed attacks, elite scaling and how a hit on an adventurer resolves (i-frames,
// parry, shield, knock).
//
// Deterministic: enemies are visited in id order (the engine's Map is insertion ordered and ids only
// grow), path searches are served first-come first-served (ties by id), and nothing reads the clock
// or Math.random. Bounded: path searches share ENEMY_PATH_BUDGET expanded nodes per tick (and at most
// PATHS_PER_TICK searches), each over a cached per-zone clearance grid; every other check is a handful
// of ground samples. Robust to adventurers vanishing at any point: only ids are kept, and every one is
// looked up again.
import type { Surface } from '../body';
import { RUN_SPEED } from '../constants';
import { findPath, withClearance, type Vec2 } from '../path';
import {
  AGGRO_THREAT, DISPLACE_SUBSTEP_M, ENEMY_PATH_NODES, ENEMY_REPLAN_S, PARRY_MOMENTUM, PARRY_STAGGER, PARRY_STUN_S, PATHS_PER_TICK,
  PERFECT_DODGE_MOMENTUM, PERFECT_DODGE_STAGGER, PERFECT_DODGE_WINDOW_S, UNREACHABLE_S, EVASION_PERFECT_MOMENTUM, ROOTED_SPEED_SCALE, SHELTER_SHARE,
  ELITE_SCALE_PER, ELITE_SCALE_CAP,
} from './constants';
import { knockDisplacement } from './displace';
import { ENEMY_ATTACKS, type EnemyAttackData, type EnemyAttackId, type Knock } from './enemies';
import type { AdventurerState, CombatWorld, CombatZone, EnemyState } from './engine';
import { applyStagger, cancelWindup, hurtAdventurer, isInvulnerable, knockAdventurer, TIME_EPS } from './adventurer';
import { hasBuff, hasDebuff, takenMult, threatMult, traitOf } from './effects';
import { breakCast } from './casting';
import { gainMomentum } from './momentum';
import { inShape, type Shape } from './shapes';
import { lineOfSight } from './sight';
import { enemyHit } from './stats';

// ───────── tuning of the AI itself (not combat numbers) ─────────
/** Engaged with no valid target for this long → walk home. */
export const NO_TARGET_S = 3;
/** Speed scale while walking home. */
export const RETURN_SPEED_SCALE = 1.5;
/** A walk home that takes longer than this (or finds no way) ends with the enemy put back at its camp. */
export const RETURN_MAX_S = 20;
/** The chase surge: an enemy with a target that has been out of range of every attack for this long… */
export const SURGE_AFTER_S = 3;
/**
 * …moves at SURGE_SCALE × RUN_SPEED until a hit lands on its target (damage taken or absorbed: a dodged,
 * parried or missed attack does not end it); while surging with its target in auto reach it autos rather
 * than starting a telegraph. So plain running never kites it; Sprint and dodges break away briefly.
 */
export const SURGE_SCALE = 1.3;
/** An ordinary enemy cannot be parry-stunned again for this long after a parry stun ends. */
export const PARRY_STUN_IMMUNE_S = 3;
/** Expanded path-search nodes shared by every enemy of a zone per tick. */
export const ENEMY_PATH_BUDGET = 2000;
/** A search starts only with at least this much of the tick's budget left. */
const MIN_SEARCH_NODES = 200;
/** Grid of enemy path searches, in m. */
export const ENEMY_PATH_CELL = 1;
/** Resolution of the cached clearance grid, in m (path cells and smoothing samples land on it). */
const GRID = 0.5;
/** A clearance-grid fill (17 ground samples) counts as this many expanded nodes against the budget. */
const FILL_COST = 2;
/** Home when this close to the camp spot, in m. */
const ARRIVE_M = 0.25;
/** A melee enemy closes to this much inside its auto reach, so a small step back does not break contact. */
const REACH_MARGIN = 0.3;
/** "Progress" toward an out-of-reach target: this much less to go than the best so far, in m. */
const PROGRESS_M = 0.5;
/** A path whose end is this far from where the goal now is gets re-planned (at the next allowed time). */
const GOAL_MOVED_M = 1.5;
/** Spacing of the samples a straight walk is checked with, in m. */
const LINE_STEP = 0.4;
/** A refused step re-checks the straight line at most this often, in s. */
const RECHECK_S = 0.25;
/** Step of the Gore Charge dash, in m. */
const DASH_STEP = 0.25;

// ───────── per-enemy AI state (kept beside the engine's EnemyState) ─────────
export interface EnemyAi {
  engaged: boolean;
  noTargetSince: number | null;
  nextAutoAt: number;
  /** Movement: walking straight at the goal, or along `path`. */
  direct: boolean;
  path: Vec2[] | null; pathIdx: number; pathGoalX: number; pathGoalZ: number;
  /** Next straight-line check (planAt), the earliest refused-step re-check, and the earliest next search. */
  planAt: number; checkAt: number; searchAt: number;
  /** A step was refused: re-check soon (a search still waits for searchAt). */
  dirty: boolean;
  /** The last finished path search found no way. */
  noWay: boolean;
  /** Waiting for a path search since (null: not waiting), toward (wantX, wantZ). */
  wantSince: number | null; wantX: number; wantZ: number;
  /** When it last searched, and the longest it ever waited for a search (s). */
  searchedAt: number; longestWaitS: number;
  /** Unreachable rule: the least still to go so far (path length, or straight distance), and when it last shrank. */
  progTarget: number | null; progBest: number; progAt: number;
  /** The chase surge: last time it was in range of any attack (or started one). */
  chanceAt: number;
  /** Elite scaling: the most adventurers engaged so far this fight. */
  scaleN: number;
  /** An ordinary enemy's parry-stun immunity ends then. */
  parryImmuneUntil: number;
  returnSince: number;
}
const AI = new WeakMap<EnemyState, EnemyAi>();
function aiOf(e: EnemyState, nowS: number): EnemyAi {
  let ai = AI.get(e);
  if (!ai) {
    ai = {
      engaged: false, noTargetSince: null, nextAutoAt: -Infinity,
      direct: true, path: null, pathIdx: 0, pathGoalX: 0, pathGoalZ: 0, planAt: -Infinity, checkAt: -Infinity, searchAt: -Infinity,
      dirty: false, noWay: false, wantSince: null, wantX: 0, wantZ: 0, searchedAt: -Infinity, longestWaitS: 0,
      progTarget: null, progBest: Infinity, progAt: nowS, chanceAt: nowS, scaleN: 1, parryImmuneUntil: -Infinity, returnSince: -Infinity,
    };
    AI.set(e, ai);
  }
  return ai;
}
/** The AI's internal state of an enemy (for tests, debugging and determinism checks). */
export function enemyAiStateOf(e: EnemyState): EnemyAi | undefined {
  return AI.get(e);
}
function resetMovement(ai: EnemyAi): void {
  ai.direct = true; ai.path = null; ai.pathIdx = 0; ai.planAt = -Infinity; ai.checkAt = -Infinity; ai.dirty = false; ai.noWay = false;
  ai.wantSince = null;
}

// ───────── per-zone helpers (cached: no allocation per tick) ─────────
const passCache = new WeakMap<CombatZone, Map<number, (x: number, z: number) => boolean>>();
/** Where an enemy of radius r may stand, exactly: on `ground` with r of ground all round it. */
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

/** Grid points filled so far (all zones): the cost of a cold grid, charged to the path budget. */
let gridFills = 0;
/** Chunks of the clearance grid: CHUNK × CHUNK points, 0 unknown, 1 passable, 2 not. */
const CHUNK = 64;
const gridCache = new WeakMap<CombatZone, Map<number, (x: number, z: number) => boolean>>();
/**
 * Passability for enemy path searches: a lazily filled, per-zone, per-radius grid of GRID m (built once
 * from the zone's ground and shared by every enemy of that radius), so a search node costs one lookup.
 * A point is answered by the grid point nearest it, tested with both r and r + GRID·√½ of clearance: at
 * grid points (where every search cell lies) it never says passable where the exact enemyPassable(r)
 * refuses; between them the wider ring keeps it on the safe side. Ground is static for a zone.
 */
export function enemyPathPassable(zone: CombatZone, r: number): (x: number, z: number) => boolean {
  let m = gridCache.get(zone);
  if (!m) { m = new Map(); gridCache.set(zone, m); }
  let f = m.get(r);
  if (!f) {
    const exactR = enemyPassable(zone, r), wide = enemyPassable(zone, r + GRID * Math.SQRT1_2);
    const exact = (x: number, z: number) => exactR(x, z) && wide(x, z);
    const chunks = new Map<number, Uint8Array>();
    f = (x: number, z: number): boolean => {
      const i = Math.round(x / GRID), j = Math.round(z / GRID);
      if (!Number.isFinite(i) || !Number.isFinite(j)) return false;
      const ci = Math.floor(i / CHUNK), cj = Math.floor(j / CHUNK);
      const key = (ci + 32768) * 65536 + (cj + 32768);
      let ch = chunks.get(key);
      if (!ch) { ch = new Uint8Array(CHUNK * CHUNK); chunks.set(key, ch); }
      const k = (i - ci * CHUNK) * CHUNK + (j - cj * CHUNK);
      let v = ch[k];
      if (v === 0) { v = exact(i * GRID, j * GRID) ? 1 : 2; ch[k] = v; gridFills++; }
      return v === 1;
    };
    m.set(r, f);
  }
  return f;
}

/** Path searches, expanded nodes and straight-line checks in the last tick (for tests and server metrics). */
interface Stats { searches: number; nodes: number; fills: number; lineChecks: number; ticks: number; warm: WarmCursor }
interface WarmCursor { camp: number; k: number; done: boolean }
const stats = new WeakMap<CombatWorld, Stats>();
/** Last tick: path searches, nodes they expanded, clearance-grid points filled, straight-line checks. */
export function enemyAiStats(w: CombatWorld): { searches: number; nodes: number; fills: number; lineChecks: number } {
  const s = stats.get(w);
  return { searches: s?.searches ?? 0, nodes: s?.nodes ?? 0, fills: s?.fills ?? 0, lineChecks: s?.lineChecks ?? 0 };
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
let curStats: Stats = { searches: 0, nodes: 0, fills: 0, lineChecks: 0, ticks: 0, warm: { camp: 0, k: 0, done: false } };
const waiting: EnemyState[] = [];
const searchStats = { expanded: 0, exhausted: false };

export function stepEnemies(w: CombatWorld, nowS: number, dt: number): void {
  let st = stats.get(w);
  if (!st) { st = { searches: 0, nodes: 0, fills: 0, lineChecks: 0, ticks: 0, warm: { camp: 0, k: 0, done: false } }; stats.set(w, st); }
  st.searches = 0; st.nodes = 0; st.fills = 0; st.lineChecks = 0;
  curStats = st;
  const fills0 = gridFills;
  for (const e of w.enemies.values()) stepEnemy(w, e, nowS, dt);
  const left = runSearches(w, nowS, st);
  warmGrid(w, st, Math.min(WARM_PER_TICK, Math.floor(left / FILL_COST)));
  st.fills = gridFills - fills0;
  st.ticks++;
  separate(w);
}

/**
 * The tick's path searches, first come first served (ties by id), while the node budget lasts. A
 * search the budget cut short is not a "no way": the enemy stays first in line for the next tick.
 */
function runSearches(w: CombatWorld, now: number, st: Stats): number {
  waiting.length = 0;
  for (const e of w.enemies.values()) { const ai = AI.get(e); if (e.alive && ai && ai.wantSince !== null) waiting.push(e); }
  if (waiting.length === 0) return ENEMY_PATH_BUDGET;
  waiting.sort((a, b) => AI.get(a)!.wantSince! - AI.get(b)!.wantSince! || a.id - b.id);
  let left = ENEMY_PATH_BUDGET;
  for (const e of waiting) {
    if (st.searches >= PATHS_PER_TICK || left < MIN_SEARCH_NODES) break;
    const ai = AI.get(e)!;
    const maxNodes = Math.min(ENEMY_PATH_NODES, left);
    const fills0 = gridFills;
    const p = findPath({ x: e.x, z: e.z }, { x: ai.wantX, z: ai.wantZ }, enemyPathPassable(w.zone, e.data.radius),
      { cell: ENEMY_PATH_CELL, maxNodes, pockets: false, stats: searchStats });
    st.searches++;
    left -= searchStats.expanded + FILL_COST * (gridFills - fills0);
    st.nodes += searchStats.expanded;
    if (!p && searchStats.exhausted && maxNodes < ENEMY_PATH_NODES) continue; // cut short by the budget: retry
    ai.longestWaitS = Math.max(ai.longestWaitS, now - ai.wantSince!);
    ai.wantSince = null;
    ai.searchedAt = now;
    ai.searchAt = now + ENEMY_REPLAN_S; ai.planAt = now + ENEMY_REPLAN_S;
    ai.direct = false; ai.path = p; ai.pathIdx = 0; ai.pathGoalX = ai.wantX; ai.pathGoalZ = ai.wantZ; ai.dirty = false; ai.noWay = p === null;
    // a new route: progress is measured along it from here (the clock is not reset)
    ai.progBest = p ? pathLeft(e, ai) + hyp(ai.wantX - p[p.length - 1].x, ai.wantZ - p[p.length - 1].z) : ai.progBest;
  }
  return Math.max(0, left);
}

/** Clearance-grid points filled ahead of need per tick, from what the path budget left over. */
const WARM_PER_TICK = 150;
/**
 * Fills the clearance grid ahead of need, camp by camp (each with its enemy's radius, out to its leash
 * plus 5 m, row by row), with what the tick's path budget left over: after a couple of minutes every
 * search near a camp runs on a warm grid. Deterministic: the camps in the zone's order.
 */
function warmGrid(w: CombatWorld, st: Stats, n: number): void {
  const c = st.warm;
  if (c.done || n <= 0) return;
  const enemies = w.enemies;
  let budget = n;
  for (const e of enemies.values()) {
    if (budget <= 0) break;
    if (e.id < c.camp) continue;
    const R = Math.ceil((e.data.leash + 5) / GRID), side = 2 * R + 1;
    const pass = enemyPathPassable(w.zone, e.data.radius);
    while (c.k < side * side && budget > 0) {
      const di = (c.k % side) - R, dj = Math.floor(c.k / side) - R;
      c.k++;
      if (di * di + dj * dj > R * R) continue;
      const before = gridFills;
      pass((Math.round(e.camp.x / GRID) + di) * GRID, (Math.round(e.camp.z / GRID) + dj) * GRID);
      budget -= gridFills - before;
    }
    if (c.k >= side * side) { c.camp = e.id + 1; c.k = 0; }
  }
  if (budget > 0) c.done = true;
}

function stepEnemy(w: CombatWorld, e: EnemyState, now: number, dt: number): void {
  if (!e.alive) { AI.delete(e); return; }
  const d = e.data;
  if (d.speed <= 0 && d.auto === null && d.attacks.length === 0) return; // the training dummy
  const ai = aiOf(e, now);

  if (e.act === 'return') { walkHome(w, e, ai, now, dt); return; }
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
      if (hyp(a.x - e.x, a.z - e.z) <= d.aggro && lineOfSight(w.zone.sight, e.x, e.z, a.x, a.z)) e.threat.add(a.id, AGGRO_THREAT * threatMult(w, a.id));
    }
  }
  if (!ai.engaged) {
    if (e.threat.choose(null, now, ANY) === null) return; // idle at camp
    ai.engaged = true;
    for (const id of d.attacks) e.attackReadyAt[id] = now + ENEMY_ATTACKS[id].firstAt;
    ai.nextAutoAt = now;
    ai.noTargetSince = null;
    ai.progTarget = null;
    ai.chanceAt = now;
  }
  if (d.elite) scaleElite(w, e, ai);

  // target: the threat table's choice, every tick (its TARGET_SWITCH_MULT hysteresis keeps it steady,
  // and a taunt then starts and ends on the tick); only live adventurers in this zone are valid
  const current = e.targetId !== null && validTarget(w, e.targetId) ? e.targetId : null;
  e.targetId = e.threat.choose(current, now, (id) => validTarget(w, id));
  const t = liveAdventurer(w, e.targetId);
  if (!t) {
    e.targetId = null;
    e.surging = false;
    ai.noTargetSince ??= now;
    if (now - ai.noTargetSince >= NO_TARGET_S - TIME_EPS) startReturn(w, e, ai, now);
    return;
  }
  ai.noTargetSince = null;

  // leash
  if (hyp(e.x - e.camp.x, e.z - e.camp.z) > d.leash) { startReturn(w, e, ai, now); return; }

  const dist = hyp(t.x - e.x, t.z - e.z);
  const sees = lineOfSight(w.zone.sight, e.x, e.z, t.x, t.z);

  // the chase surge: out of range of every attack for SURGE_AFTER_S → faster until a hit lands on the target
  const auto = d.auto;
  const reachE = dist - d.radius;
  const inReach = auto !== null && reachE <= auto.reach && (!auto.ranged || sees);
  let chance = inReach;
  // "in range to start an attack": in auto reach, or a ready telegraph's useRange (one still cooling down
  // cannot be started, so circling just outside auto reach does not hold the surge off)
  for (const id of d.attacks) if (sees && dist <= ENEMY_ATTACKS[id].useRange && now >= (e.attackReadyAt[id] ?? Infinity) - TIME_EPS) chance = true;
  if (chance && !e.surging) ai.chanceAt = now;
  if (!e.surging && now - ai.chanceAt > SURGE_AFTER_S + TIME_EPS) e.surging = true;

  // a telegraphed attack, when one is ready and the target is within its useRange (Thorn Hail: aimed at
  // the farthest engaged adventurer within it). A surging enemy with its target in auto reach autos instead.
  if (!(e.surging && inReach)) {
    for (const id of d.attacks) {
      const atk = ENEMY_ATTACKS[id];
      if (now < (e.attackReadyAt[id] ?? Infinity) - TIME_EPS) continue;
      const aim = AIM_FARTHEST.has(id) ? farthestEngaged(w, e, atk.useRange) : dist <= atk.useRange && sees ? t : null;
      if (!aim) continue;
      startWindup(w, e, atk, aim, now);
      ai.chanceAt = now;
      holdProgress(ai, now);
      return;
    }
  }

  // chase: melee closes to a little inside reach, a ranged enemy to keepRange (and into sight)
  const stopReach = auto === null ? 0 : auto.ranged ? Math.min(auto.reach, d.keepRange ?? auto.reach) : auto.reach - REACH_MARGIN;
  const stop = stopReach + d.radius;
  // Rooted slows the chase, surge included
  const speed = (e.surging ? SURGE_SCALE * RUN_SPEED : d.speed) * ((e.marks.rooted ?? -Infinity) > now ? ROOTED_SPEED_SCALE : 1);
  let free = false;
  if (dist > stop || (auto?.ranged && !sees)) {
    const x0 = e.x, z0 = e.z;
    ai.dirty = false;
    const moved = walk(w, e, ai, t.x, t.z, auto?.ranged && !sees ? 0 : stop, speed, dt, now);
    // walking unhindered (a whole step, nothing refused) is progress too: a runner is the surge's and the
    // leash's business, not the unreachable rule's
    free = moved && !ai.dirty && hyp(e.x - x0, e.z - z0) >= 0.5 * speed * dt;
  } else if (dist > 0) e.facing = Math.atan2(t.x - e.x, t.z - e.z);

  // the auto, when in reach after this tick's step (horizontal only: an adventurer on a rock within
  // reach is hit). Checked after moving, so a chaser that closes the gap swings on the same tick.
  const dist2 = hyp(t.x - e.x, t.z - e.z);
  const inReach2 = auto !== null && dist2 - d.radius <= auto.reach && (!auto.ranged || (dist2 === dist ? sees : lineOfSight(w.zone.sight, e.x, e.z, t.x, t.z)));
  if (inReach2) {
    holdProgress(ai, now);
    if (dist2 > 0) e.facing = Math.atan2(t.x - e.x, t.z - e.z);
    if (now >= ai.nextAutoAt - TIME_EPS) {
      ai.nextAutoAt = now + auto.every;
      ai.chanceAt = now;
      resolveHit(w, e, t, auto.raw, 'auto', !auto.ranged, null, now);
    }
  }

  // the unreachable rule: out of reach with no progress for UNREACHABLE_S → home. Progress is what is
  // left to go: along the path while one is followed (a detour that first leads away still counts),
  // else the straight distance. No path at all means no progress.
  if (!inReach2) {
    if (ai.progTarget !== t.id) { ai.progTarget = t.id; ai.progBest = Infinity; ai.progAt = now; }
    const left = toGo(e, ai, t);
    if (left < ai.progBest - PROGRESS_M) { ai.progBest = left; ai.progAt = now; }
    else if (free) ai.progAt = now;
    if (now - ai.progAt >= UNREACHABLE_S - TIME_EPS) startReturn(w, e, ai, now);
  }
}

/** Attacks aimed at the farthest engaged adventurer within their useRange, not the threat target. */
const AIM_FARTHEST: ReadonlySet<EnemyAttackId> = new Set<EnemyAttackId>(['thorn_hail']);
/** The live adventurer on e's threat table farthest from it within `range` and in sight (ties: earliest in the table). */
function farthestEngaged(w: CombatWorld, e: EnemyState, range: number): AdventurerState | null {
  let best: AdventurerState | null = null, bestD = -1;
  for (const id of e.threat.ids()) {
    const a = liveAdventurer(w, id);
    if (!a) continue;
    const d = hyp(a.x - e.x, a.z - e.z);
    if (d <= range && d > bestD && lineOfSight(w.zone.sight, e.x, e.z, a.x, a.z)) { best = a; bestD = d; }
  }
  return best;
}

/** What is left to go to the target: along the path being followed, else straight. */
function toGo(e: EnemyState, ai: EnemyAi, t: AdventurerState): number {
  if (!ai.direct && ai.path && ai.pathIdx < ai.path.length) {
    const end = ai.path[ai.path.length - 1];
    return pathLeft(e, ai) + hyp(t.x - end.x, t.z - end.z);
  }
  return hyp(t.x - e.x, t.z - e.z);
}
function pathLeft(e: EnemyState, ai: EnemyAi): number {
  const p = ai.path!;
  let s = 0, x = e.x, z = e.z;
  for (let i = ai.pathIdx; i < p.length; i++) { s += hyp(p[i].x - x, p[i].z - z); x = p[i].x; z = p[i].z; }
  return s;
}

/** ENEMY_REPLAN_S, spread ±25% by id, so enemies engaged on the same tick do not all re-check together. */
function replanIn(e: EnemyState): number {
  return ENEMY_REPLAN_S * (0.75 + 0.5 * ((e.id * 0.6180339887) % 1));
}

/** Rooted, stunned or in reach: the unreachable clock does not run. */
function holdProgress(ai: EnemyAi, now: number): void {
  ai.progBest = Infinity; ai.progAt = now;
}

/**
 * Elite scaling: n = distinct live adventurers on its threat table (at most ELITE_SCALE_CAP). When n
 * rises, max hp and the stagger bar's capacity become base × (1 + ELITE_SCALE_PER × (n − 1)), and hp
 * keeps its fraction. Never scales down during a fight; back to base at home or on respawn.
 */
function scaleElite(w: CombatWorld, e: EnemyState, ai: EnemyAi): void {
  let n = 0;
  for (const id of e.threat.ids()) if (liveAdventurer(w, id)) n++;
  n = Math.min(ELITE_SCALE_CAP, n);
  if (n <= ai.scaleN) return;
  ai.scaleN = n;
  const f = 1 + ELITE_SCALE_PER * (n - 1);
  const max = e.data.hp * f;
  e.hp = (e.hp * max) / e.maxHp;
  e.maxHp = max;
  e.stagger.max = e.data.stagger * f;
}

// ───────── walking ─────────
/**
 * One tick of walking toward (gx, gz), stopping `stop` short of it: straight when the line is clear,
 * else along a path (asking for a search, which runs at the end of the tick when ENEMY_REPLAN_S and the
 * node budget allow). Every step must be passable ground (a step from an unclear spot may go anywhere
 * on ground, to get clear); a refused step marks the plan dirty. y follows the ground.
 */
function walk(w: CombatWorld, e: EnemyState, ai: EnemyAi, gx: number, gz: number, stop: number, speed: number, dt: number, now: number): boolean {
  const d = hyp(gx - e.x, gz - e.z);
  if (d <= stop || !(dt > 0)) return false;
  const pass = enemyPassable(w.zone, e.data.radius);
  const grid = enemyPathPassable(w.zone, e.data.radius);
  const goalMoved = !ai.direct && ai.path !== null && hyp(gx - ai.pathGoalX, gz - ai.pathGoalZ) > GOAL_MOVED_M;
  const due = now >= ai.planAt - TIME_EPS || ((ai.dirty || goalMoved || (!ai.direct && ai.path === null)) && now >= ai.checkAt - TIME_EPS);
  if (due && ai.wantSince === null) {
    curStats.lineChecks++;
    ai.checkAt = now + RECHECK_S;
    if (clearLine(e.x, e.z, gx, gz, grid)) {
      ai.direct = true; ai.path = null; ai.dirty = false; ai.noWay = false; ai.planAt = now + replanIn(e);
    } else if (now >= ai.searchAt - TIME_EPS) {
      ai.wantSince = now; ai.wantX = gx; ai.wantZ = gz; ai.dirty = false;
      if (ai.direct) { ai.direct = false; ai.path = null; }
    } else {
      if (ai.direct) { ai.direct = false; ai.path = null; } // blocked straight ahead: wait for the next search
      ai.dirty = false; ai.planAt = Math.min(ai.planAt, ai.searchAt);
    }
  } else if (ai.wantSince !== null) { ai.wantX = gx; ai.wantZ = gz; }
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
function stepToward(w: CombatWorld, e: EnemyState, ai: EnemyAi, wx: number, wz: number, len: number, pass: (x: number, z: number) => boolean): boolean {
  const dx = wx - e.x, dz = wz - e.z, l = hyp(dx, dz);
  if (!(l > 1e-9) || !(len > 0)) return false;
  const ground = w.zone.ground;
  const ok = pass(e.x, e.z)
    ? pass
    : (x: number, z: number) => ground(x, z) !== null; // not clear where it stands: any ground gets it clear
  // in sub-steps of at most DISPLACE_SUBSTEP_M, so no thin obstacle is stepped over
  const n = Math.max(1, Math.ceil(len / DISPLACE_SUBSTEP_M));
  const sx = ((dx / l) * len) / n, sz = ((dz / l) * len) / n;
  let x = e.x, z = e.z, moved = false;
  for (let k = 0; k < n; k++) {
    let nx = x + sx, nz = z + sz;
    if (!ok(nx, nz)) {
      ai.dirty = true;
      if (ok(x + sx, z)) nz = z;
      else if (ok(x, z + sz)) nx = x;
      else break;
    }
    if (ground(nx, nz) === null) { ai.dirty = true; break; }
    x = nx; z = nz; moved = true;
  }
  if (!moved) { ai.dirty = true; return false; }
  e.facing = Math.atan2(x - e.x, z - e.z);
  e.x = x; e.z = z; e.y = ground(x, z)!;
  return true;
}

// ───────── going home ─────────
function startReturn(w: CombatWorld, e: EnemyState, ai: EnemyAi, now: number): void {
  cancelWindup(w, e);
  e.act = 'return'; e.actUntil = Infinity; e.targetId = null; e.surging = false;
  e.threat.clear();
  e.marks = {}; e.burning = null;
  e.stagger = { value: 0, max: e.stagger.max, brokenUntil: -Infinity, lastGainAt: -Infinity };
  ai.engaged = false; ai.noTargetSince = null; ai.returnSince = now; ai.progTarget = null;
  resetMovement(ai);
}

function walkHome(w: CombatWorld, e: EnemyState, ai: EnemyAi, now: number, dt: number): void {
  const c = e.camp;
  if (hyp(c.x - e.x, c.z - e.z) > ARRIVE_M) {
    walk(w, e, ai, c.x, c.z, 0, e.data.speed * RETURN_SPEED_SCALE, dt, now);
    const lost = ai.noWay; // searched, and there is no way home
    if (!lost && now - ai.returnSince < RETURN_MAX_S - TIME_EPS && hyp(c.x - e.x, c.z - e.z) > ARRIVE_M) return;
  }
  // home (or put back): base and full hp, threat clear, ready to notice adventurers again
  e.x = c.x; e.z = c.z; e.y = w.zone.ground(c.x, c.z) ?? e.y; e.facing = c.facing;
  e.maxHp = e.data.hp; e.hp = e.maxHp; e.act = ''; e.actUntil = -Infinity; e.targetId = null;
  e.stagger = { value: 0, max: e.data.stagger, brokenUntil: -Infinity, lastGainAt: -Infinity };
  e.threat.clear(); e.attackReadyAt = {};
  ai.scaleN = 1; ai.parryImmuneUntil = -Infinity;
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
    case 'ring-self': return { kind: 'ring', x: e.x, z: e.z, dir, inner: atk.inner ?? 0, r: atk.r ?? 0 };
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
 * dodged from inside it within PERFECT_DODGE_WINDOW_S: elite +15 stagger, adventurer +10 Momentum, a
 * Ninja +25); an auto on an adventurer in Mist Form, or from a Blinded enemy → `miss` (why); an open
 * parry against a parryable hit → `parry` (nothing taken, +20 Momentum, the elite +35 stagger, an
 * ordinary enemy stunned PARRY_STUN_S unless it is still parry-stun immune); else enemyHit(raw,
 * defence, takenMult) through the shield (Shelter moving its share to the Paladin), a landed telegraph
 * breaking a cast, then the knock.
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
      a.momentum = gainMomentum(a.momentum, traitOf(a) === 'dusk_slip' ? EVASION_PERFECT_MOMENTUM : PERFECT_DODGE_MOMENTUM);
      if (e.data.elite) applyStagger(w, e, PERFECT_DODGE_STAGGER, now);
    }
    return;
  }
  // revive safety: a plain miss (never perfect: no Momentum, no stagger)
  if (now < a.reviveSafeUntil) { fxOf(w).push({ t: 'miss', src: e.id, dst: a.id, perfect: false }); return; }
  // autos only: Mist Form on the adventurer, or a Blinded enemy, misses (telegraphs still hit)
  if (by === 'auto') {
    const why = hasBuff(a, 'mist', now) ? 'mist' : hasDebuff(e, 'blinded', now) ? 'blind' : null;
    if (why) { fxOf(w).push({ t: 'miss', src: e.id, dst: a.id, perfect: false, why }); return; }
  }
  if (parryable && now < a.parryUntil) {
    a.parryUntil = -Infinity;
    fxOf(w).push({ t: 'parry', src: a.id, dst: e.id });
    a.momentum = gainMomentum(a.momentum, PARRY_MOMENTUM);
    if (e.data.elite) applyStagger(w, e, PARRY_STAGGER, now);
    else stunEnemy(w, e, PARRY_STUN_S, now);
    return;
  }
  const final = enemyHit(raw, a.stats.defence, takenMult(w, a, e, now));
  // Shelter: a live Paladin src in this room takes floor(final × SHELTER_SHARE), × its own taken-mult,
  // through its i-frames and without breaking its cast
  const sh = a.buffs.sheltered;
  const pal = sh && sh.until > now ? w.adventurers.get(sh.src) : undefined;
  const sheltered = pal !== undefined && pal !== a && pal.alive && pal.job === 'paladin';
  const moved = sheltered ? Math.floor(final * SHELTER_SHARE) : 0;
  const got = hurtAdventurer(w, a, final - moved, e.id, by, now);
  if (sheltered && moved > 0) hurtAdventurer(w, pal, Math.round(moved * takenMult(w, pal, e, now)), e.id, by, now, true);
  const landed = got.taken + got.absorbed > 0;
  // the chase surge ends only when a hit lands on its target (taken or absorbed)
  if (e.surging && a.id === e.targetId && landed) { e.surging = false; aiOf(e, now).chanceAt = now; }
  // a telegraph that lands (hp or shield) breaks a cast; autos never do
  if (by !== 'auto' && landed && a.alive) breakCast(w, a, 'interrupt', now);
  if (knock && a.alive) knockAdventurer(w, a, knockDisplacement({ x: e.x, z: e.z }, a, knock, lineDir), now);
}

/**
 * An ordinary enemy stunned for `s` (Plan 3's parry stun, also the conduct reaction's): its wind-up
 * cancelled, act 'stun'; then immune to it for PARRY_STUN_IMMUNE_S after the stun ends. Returns false
 * (nothing happens) while it is still immune.
 */
export function stunEnemy(w: CombatWorld, e: EnemyState, s: number, now: number): boolean {
  const ai = aiOf(e, now);
  if (now < ai.parryImmuneUntil - TIME_EPS) return false;
  cancelWindup(w, e);
  e.act = 'stun'; e.actUntil = now + s;
  ai.parryImmuneUntil = now + s + PARRY_STUN_IMMUNE_S;
  return true;
}

// ───────── keeping apart ─────────
const sepDx: number[] = [], sepDz: number[] = [], sepList: EnemyState[] = [];
/**
 * Overlapping enemies are pushed apart by their radii: each moves half the overlap (all of it when the
 * other is rooted), at most DISPLACE_SUBSTEP_M a tick, only onto passable ground and never across
 * anything (the midpoint is checked too). Pushes are summed first and then applied, so the result does
 * not depend on the order enemies are visited in.
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
    let px = sepDx[i], pz = sepDz[i];
    if (px === 0 && pz === 0) continue;
    const l = hyp(px, pz);
    if (l > DISPLACE_SUBSTEP_M) { px *= DISPLACE_SUBSTEP_M / l; pz *= DISPLACE_SUBSTEP_M / l; }
    const e = sepList[i];
    const pass = enemyPassable(w.zone, e.data.radius);
    const nx = e.x + px, nz = e.z + pz;
    if (!pass(nx, nz) || !pass(e.x + px / 2, e.z + pz / 2)) continue;
    const y = w.zone.ground(nx, nz);
    if (y === null) continue;
    e.x = nx; e.z = nz; e.y = y;
  }
}
const rooted = (e: EnemyState) => e.windup !== null || e.act === 'stun';
