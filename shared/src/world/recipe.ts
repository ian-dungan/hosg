// Seeded zone recipes: a small generator that turns a ZoneRecipe into a zone's terrain, road, trees,
// rocks, enemy camps and spawn points. Nothing is placed by hand.
//
// The server and every client run this, so it must give bit-identical results on every JavaScript
// engine: only exactly-rounded operations (+ − × ÷, sqrt, floor, min/max/abs, imul and integer bit
// operations). No trigonometry, exponentials, logarithms, powers or Math's own random — their results
// may differ in the last bit between engines (recipe.test.ts scans this file for them).
import type { Obstacle } from './layout';
import { ENEMY_KINDS, type EnemyKindId } from '../combat/enemies';
import { ZoneWalk } from './zoneWalk';
import { ZONE_Y_MAX_M, ZONE_Y_MIN_M, assertInsideZoneLimits } from './limits';

// Where one enemy starts (and respawns), facing as Pose.facing: forward = (sin f, cos f). Same shape as combat's CampSpawn.
export interface CampSpawn { kind: EnemyKindId; x: number; z: number; facing: number }

// The order kinds are placed in a camp: elites first (they stand at the centre), then the others.
const KIND_ORDER: readonly EnemyKindId[] = ['mossback', 'thornling', 'boar', 'archer', 'dummy'];

export interface ZoneRecipe {
  id: string; seed: number; width: number; depth: number; hills: number;
  road: { wander: number; width: number };
  trees: { count: number; spacing: number };
  rocks: { count: number; platformShare: number };
  camps: { groups: Partial<Record<EnemyKindId, number>>[]; deep: number[]; offset: [number, number]; deepOffset: [number, number]; radius: number; spacing: number };
}

// The Greenway: the woods beyond Shady Grove's east gate.
export const GREENWAY_RECIPE: ZoneRecipe = {
  id: 'greenway', seed: 7331, width: 260, depth: 180, hills: 2.5,
  road: { wander: 16, width: 3.2 },
  trees: { count: 380, spacing: 3.6 },
  rocks: { count: 48, platformShare: 0.4 },
  camps: {
    groups: [
      { thornling: 3 }, { thornling: 2, boar: 2 }, { archer: 3, boar: 1 }, { thornling: 2, archer: 2, boar: 1 },
      { mossback: 1, thornling: 2 }, { mossback: 1, boar: 1 },
    ],
    deep: [5], offset: [16, 24], deepOffset: [45, 55], radius: 9, spacing: 5,
  },
};

export interface ZoneLayout {
  recipe: ZoneRecipe;
  // Terrain height (no obstacles).
  height(x: number, z: number): number;
  // The road's centre line.
  roadZ(x: number): number;
  trees: { x: number; z: number; s: number; kind: 0 | 1 | 2 }[];
  // top: a platform's standing height, or null for a wall. h: visual height only.
  rocks: { x: number; z: number; r: number; h: number; top: number | null }[];
  camps: { x: number; z: number; r: number; spawns: CampSpawn[] }[];
  obstacles: Obstacle[];
  entry: { x: number; z: number; facing: number };
  westGate: { x: number; z: number };
  walk: ZoneWalk;
}

// ───────── random and noise ─────────

// mulberry32: a seeded stream of numbers in [0, 1).
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A lattice value in [0, 1] for integer cell (i, j) under a seed (an integer hash with a murmur3 finaliser).
function lattice(seed: number, i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Value noise in [0, 1]: lattice values at integer points, blended with smoothstep.
export function noise2(seed: number, x: number, z: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = lattice(seed, ix, iz), b = lattice(seed, ix + 1, iz), c = lattice(seed, ix, iz + 1), d = lattice(seed, ix + 1, iz + 1);
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

// 0 at or below a, 1 at or above b, smoothstep between.
function smooth(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ───────── the generator ─────────

// Distance between road control points, in m.
const ROAD_STEP = 26;
// Spacing of the road samples used to measure distance to the road, in x (m).
const ROAD_TAB = 0.5;
// Road flattening: full within this distance of the centre line, none beyond ROAD_FLAT_OUT.
const ROAD_FLAT_IN = 3, ROAD_FLAT_OUT = 13;
// Terrain rises BOUND_RISE m over the last BOUND_RAMP m to the east, north and south bounds. Not the
// west bound: the road starts there and the west gate stays at road level.
const BOUND_RISE = 4, BOUND_RAMP = 14;
const CAMP_REROLLS = 20, CAMP_GAP = 34, CAMP_ENTRY_GAP = 35, CAMP_BOUND_GAP = 15;
// A camp's centre is re-rolled if the (bending) road passes closer than radius + this (not in the brief's list; see the report).
const CAMP_ROAD_GAP = 4;
const SPAWN_TRIES = 400;
// Least free gap between two rocks, and between a rock and a tree, so every rock and tree can be walked round.
const ROCK_GAP = 2, ROCK_TREE_GAP = 1.5;
// Rocks and trees stay this far (centre to entry/gate, beyond their radius) from the entry and the west gate.
const GATE_CLEAR = 5;
// Largest tree obstacle radius: 0.25 · 1.8 + 0.25.
const TREE_R_MAX = 0.7;

export function generateZone(r: ZoneRecipe): ZoneLayout {
  const rng = prng(r.seed);
  const { width, depth, hills, seed } = r;
  const halfD = depth / 2;
  // The zone must fit inside what the room's state can carry (limits.ts): x 0..width, z ±depth/2,
  // and its highest ground (hills, the rise at the bounds, a rock platform's top) and lowest.
  assertInsideZoneLimits(`Zone recipe '${r.id}': its far corner`, width, halfD);
  const peak = hills * 1.35 + BOUND_RISE + 1.05, trough = -hills * 1.35;
  if (peak > ZONE_Y_MAX_M || trough < ZONE_Y_MIN_M) {
    throw new Error(`Zone recipe '${r.id}': heights ${trough}..${peak} m are outside the zone limits (${ZONE_Y_MIN_M}..${ZONE_Y_MAX_M} m)`);
  }
  const bounds = { x0: 0.5, x1: width - 2, z0: -(halfD - 1), z1: halfD - 1 };

  // 1. road: control points every ROAD_STEP m, smoothstep between them
  const nCtrl = Math.max(1, Math.ceil(width / ROAD_STEP));
  const ctrl: number[] = [0];
  for (let k = 1; k <= nCtrl; k++) ctrl.push((rng() - 0.5) * 2 * r.road.wander);
  const roadZ = (x: number): number => {
    const t = x / ROAD_STEP;
    const k = Math.min(nCtrl - 1, Math.max(0, Math.floor(t)));
    const f = Math.min(1, Math.max(0, t - k));
    return ctrl[k] + (ctrl[k + 1] - ctrl[k]) * (f * f * (3 - 2 * f));
  };
  const nTab = Math.floor(width / ROAD_TAB);
  const tab: number[] = [];
  for (let i = 0; i <= nTab; i++) tab.push(roadZ(i * ROAD_TAB));
  // Distance from (x, z) to the road's centre line (sampled every ROAD_TAB m in x), capped at max.
  const roadDist = (x: number, z: number, max: number): number => {
    let best = max * max;
    const i0 = Math.max(0, Math.ceil((x - max) / ROAD_TAB)), i1 = Math.min(nTab, Math.floor((x + max) / ROAD_TAB));
    for (let i = i0; i <= i1; i++) {
      const dx = i * ROAD_TAB - x, dz = tab[i] - z, d2 = dx * dx + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };

  // 2. height (uses the camps placed in step 3; nothing reads it before then)
  const camps: { x: number; z: number; r: number; side: number; spawns: CampSpawn[] }[] = [];
  const campR = r.camps.radius;
  const height = (x: number, z: number): number => {
    let h = hills * (2 * noise2(seed, x / 40, z / 40) - 1) + 0.35 * hills * (2 * noise2(seed + 1, x / 14, z / 14) - 1);
    let f = smooth(ROAD_FLAT_IN, ROAD_FLAT_OUT, roadDist(x, z, ROAD_FLAT_OUT));
    for (const c of camps) {
      const dx = x - c.x, dz = z - c.z, d2 = dx * dx + dz * dz, out = c.r + 4;
      if (d2 < out * out) f = Math.min(f, smooth(c.r, out, Math.sqrt(d2)));
    }
    h *= f;
    const edge = Math.min(width - x, z + halfD, halfD - z);
    if (edge < BOUND_RAMP) h += BOUND_RISE * smooth(0, 1, (BOUND_RAMP - edge) / BOUND_RAMP);
    return h;
  };

  const entry = { x: 8, z: roadZ(8), facing: Math.PI / 2 };
  const westGate = { x: 2, z: roadZ(2) };
  const dist = (ax: number, az: number, bx: number, bz: number) => { const dx = ax - bx, dz = az - bz; return Math.sqrt(dx * dx + dz * dz); };

  // 3. camps
  const groups = r.camps.groups;
  const deepSet = new Set(r.camps.deep);
  const nOrdinary = groups.length - deepSet.size;
  let ordinary = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const deep = deepSet.has(gi);
    const base = deep ? width * 0.55 : 40 + (nOrdinary > 1 ? (width - 70) * ordinary / (nOrdinary - 1) : 0);
    if (!deep) ordinary++;
    const [o0, o1] = deep ? r.camps.deepOffset : r.camps.offset;
    let x = 0, z = 0, side = 1, found = false;
    for (let attempt = 0; attempt <= CAMP_REROLLS && !found; attempt++) {
      x = base + (2 * rng() - 1) * (deep ? 10 : 8);
      side = rng() < 0.5 ? -1 : 1;
      z = roadZ(x) + side * (o0 + (o1 - o0) * rng());
      const ok = camps.every(c => dist(x, z, c.x, c.z) >= CAMP_GAP)
        && dist(x, z, entry.x, entry.z) >= CAMP_ENTRY_GAP
        && x >= CAMP_BOUND_GAP && x <= width - CAMP_BOUND_GAP && z >= -halfD + CAMP_BOUND_GAP && z <= halfD - CAMP_BOUND_GAP
        && roadDist(x, z, campR + CAMP_ROAD_GAP) >= campR + CAMP_ROAD_GAP;
      found = ok;
    }
    // never a silently broken layout: a recipe with no room for its camps is refused (deterministically)
    if (!found) throw new Error(`generateZone(${r.id}): no valid site for camp ${gi}`);
    camps.push({ x, z, r: campR, side, spawns: [] });
  }
  // spawns: elites at the centre, the rest rejection-sampled within radius − 1, spacing apart; all face the road
  const inner = campR - 1, sp2 = r.camps.spacing * r.camps.spacing;
  camps.forEach((c, gi) => {
    const facing = c.side > 0 ? Math.PI : 0;
    for (const kind of KIND_ORDER) {
      const n = groups[gi][kind] ?? 0;
      for (let k = 0; k < n; k++) {
        if (ENEMY_KINDS[kind].elite) { c.spawns.push({ kind, x: c.x, z: c.z, facing }); continue; }
        let placed = false;
        for (let t = 0; t < SPAWN_TRIES && !placed; t++) {
          const dx = (2 * rng() - 1) * inner, dz = (2 * rng() - 1) * inner;
          if (dx * dx + dz * dz > inner * inner) continue;
          const x = c.x + dx, z = c.z + dz;
          if (c.spawns.some(s => { const ex = s.x - x, ez = s.z - z; return ex * ex + ez * ez < sp2; })) continue;
          c.spawns.push({ kind, x, z, facing });
          placed = true;
        }
        if (!placed) throw new Error(`generateZone(${r.id}): no room for a ${kind} in camp ${gi}`);
      }
    }
  });

  // 4. rocks
  const bw = bounds.x1 - bounds.x0, bd = bounds.z1 - bounds.z0;
  const rocks: ZoneLayout['rocks'] = [];
  for (let t = 0; t < r.rocks.count * 30 && rocks.length < r.rocks.count; t++) {
    const x = bounds.x0 + bw * rng(), z = bounds.z0 + bd * rng(), rr = 0.6 + 1.4 * rng();
    if (roadDist(x, z, 5) < 5) continue;
    if (camps.some(c => dist(x, z, c.x, c.z) < c.r + 3 + rr)) continue;
    if (dist(x, z, entry.x, entry.z) < rr + GATE_CLEAR || dist(x, z, westGate.x, westGate.z) < rr + GATE_CLEAR) continue;
    if (rocks.some(o => dist(x, z, o.x, o.z) < o.r + rr + ROCK_GAP)) continue;
    const platform = rng() < r.rocks.platformShare;
    const top = platform ? height(x, z) + 0.45 + 0.6 * rng() : null;
    rocks.push({ x, z, r: rr, h: 1.5 + 1.6 * rng(), top });
  }

  // 5. trees (a spatial grid of cells `spacing` wide keeps the spacing check cheap)
  const trees: ZoneLayout['trees'] = [];
  const spacing = r.trees.spacing, sp = spacing * spacing;
  const gi = Math.ceil(bw / spacing) + 1, gj = Math.ceil(bd / spacing) + 1;
  const cells: number[][] = Array.from({ length: gi * gj }, () => []);
  const cellOf = (x: number, z: number) => [Math.floor((x - bounds.x0) / spacing), Math.floor((z - bounds.z0) / spacing)] as const;
  const crowded = (x: number, z: number) => {
    const [ci, cj] = cellOf(x, z);
    for (let j = Math.max(0, cj - 1); j <= Math.min(gj - 1, cj + 1); j++) for (let i = Math.max(0, ci - 1); i <= Math.min(gi - 1, ci + 1); i++) {
      for (const k of cells[j * gi + i]) { const dx = trees[k].x - x, dz = trees[k].z - z; if (dx * dx + dz * dz < sp) return true; }
    }
    return false;
  };
  for (let t = 0; t < r.trees.count * 30 && trees.length < r.trees.count; t++) {
    const x = bounds.x0 + bw * rng(), z = bounds.z0 + bd * rng();
    const edge = Math.min(x, width - x, z + halfD, halfD - z);
    if (!(edge < 20 || noise2(seed + 2, x / 30, z / 30) > 0.35)) continue;
    if (roadDist(x, z, 6) < 6) continue;
    if (camps.some(c => dist(x, z, c.x, c.z) < c.r + 2)) continue;
    if (dist(x, z, entry.x, entry.z) < 10) continue;
    if (rocks.some(o => dist(x, z, o.x, o.z) < o.r + TREE_R_MAX + ROCK_TREE_GAP)) continue;
    if (crowded(x, z)) continue;
    const s = 1 + 0.8 * rng(), kind = Math.floor(3 * rng()) as 0 | 1 | 2;
    const [ci, cj] = cellOf(x, z);
    cells[cj * gi + ci].push(trees.length);
    trees.push({ x, z, s, kind });
  }

  // 6–7. obstacles (circles only) and walkability
  const obstacles: Obstacle[] = [
    ...rocks.map((o): Obstacle => (o.top === null ? { kind: 'c', x: o.x, z: o.z, r: o.r } : { kind: 'c', x: o.x, z: o.z, r: o.r, top: o.top })),
    ...trees.map((o): Obstacle => ({ kind: 'c', x: o.x, z: o.z, r: 0.25 * o.s + 0.25 })),
  ];
  const walk = new ZoneWalk(bounds, height, obstacles);

  return {
    recipe: r, height, roadZ, trees, rocks,
    camps: camps.map(c => ({ x: c.x, z: c.z, r: c.r, spawns: c.spawns })),
    obstacles, entry, westGate, walk,
  };
}
