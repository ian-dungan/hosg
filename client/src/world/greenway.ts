// buildGreenway: the Greenway, the old road east of Shady Grove through sunlit woods. Everything comes
// from the shared zone layout (generateZone(GREENWAY_RECIPE)): terrain, road, trees, rocks, camps, gates.
// Nothing is placed by hand; cosmetic camp props are derived from the recipe's seed.
//
// Same look as the town (world/index.ts): toon-lit vertex-coloured low-poly, painted noise, cloud shadows,
// cascaded shadows, graded post, the shader sky, grass on med and high.
//
// The ground is drawn to match the shared ZoneWalk (what the server and the character controller stand the
// adventurer on) within 2 cm: an adaptive grid refines where the terrain curves (greenway.test.ts checks it).
// Heights are computed once while building, cached in arrays; nothing here calls the recipe per frame.
import {
  Vector3, Color3, Color4, StandardMaterial, DirectionalLight, HemisphericLight, GlowLayer, CascadedShadowGenerator,
  Scene, MeshBuilder, DynamicTexture, Mesh, VertexData, type AbstractMesh,
  DefaultRenderingPipeline, SSAO2RenderingPipeline, ImageProcessingConfiguration, type ArcRotateCamera, type TransformNode,
} from '@babylonjs/core';
import { ENEMY_KINDS, greenwayLayout, prng, type ZoneLayout } from '@sg2/shared';
import type { WorldApi, AnchorName, Anchor, Quality } from '../core/contracts';
import { Builder, hex, mix, tint, vnoise, hash, type RGB, type V3 } from './mesh';
import { Kit, PAL, tree, lantern } from './parts';
import { createShaderSky, SUN_DIR, HAZE } from './sky';
import { WorldFxPlugin, WFX, type WfxOpts } from './shading';
import { buildGrass } from './grass';
import { createLife } from './life';

// ───────────────────────── placements (pure) ─────────────────────────

export type TreeKind = 'round' | 'blossom' | 'teal' | 'pine' | 'oak' | 'birch' | 'amber';
export interface TreeP { x: number; z: number; y: number; s: number; kind: TreeKind }
export interface RockP { x: number; z: number; y: number; r: number; h: number; top: number | null; yaw: number }
export type PropKind = 'firepit' | 'nest' | 'sticks' | 'leanto' | 'totem' | 'milestone' | 'fence' | 'logs';
export interface PropP { kind: PropKind; x: number; z: number; y: number; r: number; yaw: number; s: number }
export interface CampP { x: number; z: number; r: number; props: PropP[] }
export interface GreenwayPlacements {
  trees: TreeP[];
  rocks: RockP[];
  camps: CampP[];
  /** The west gate arch (across the road; yaw is the road's direction there). */
  gate: { x: number; z: number; y: number; yaw: number };
  /** The fallen-tree barricade across the road at the east end. */
  barricade: { x: number; z: number; y: number; yaw: number };
  /** Cheap trees beyond the walkable bounds (the tree belt). */
  belt: { x: number; z: number; y: number; s: number; kind: number }[];
  /** Old things along the road: milestones, broken fence, log piles (low, cosmetic). */
  roadside: PropP[];
  /** Low ferns and bushes round the trees (cosmetic, knee-high at most). */
  undergrowth: { x: number; z: number; y: number; s: number; kind: 'fern' | 'bush' }[];
}

/** Props keep this far (beyond the road's half width and their own radius) from the road centre line, in m. */
export const PROP_ROAD_CLEAR = 1.2;
/** Props keep this far (beyond both radii) from every spawn point, in m. */
export const PROP_SPAWN_CLEAR = 0.4;
/** Footprint radius of each prop kind, in m (scaled by the prop's size). */
const PROP_R: Record<PropKind, number> = { firepit: 1.15, nest: 0.85, sticks: 0.75, leanto: 1.25, totem: 0.4, milestone: 0.35, fence: 1.4, logs: 1.0 };

/** True distance from (x, z) to the road's centre line (sampled every 0.25 m in x). */
export function roadDistance(layout: ZoneLayout, x: number, z: number, max = 30): number {
  let best = max;
  for (let sx = Math.floor((x - max) * 4) / 4; sx <= x + max; sx += 0.25) {
    const d = Math.hypot(sx - x, layout.roadZ(sx) - z);
    if (d < best) best = d;
  }
  return best;
}

const roadYaw = (layout: ZoneLayout, x: number) => Math.atan2(1, (layout.roadZ(x + 0.5) - layout.roadZ(x - 0.5)) / 1); // facing along +x

/** Everything the Greenway world draws, and where: derived only from the layout (and its seed). */
export function greenwayPlacements(layout: ZoneLayout): GreenwayPlacements {
  const H = layout.height;
  const seed = layout.recipe.seed;
  const trees: TreeP[] = layout.trees.map((t) => {
    const h = hash(t.x * 0.37, t.z * 0.61);
    let kind: TreeKind;
    if (t.kind === 1) kind = h < 0.12 ? 'amber' : 'pine';
    else if (t.kind === 2) kind = h < 0.45 ? 'birch' : 'teal';
    else kind = t.s > 1.62 && h < 0.5 ? 'oak' : h < 0.06 ? 'blossom' : h < 0.14 ? 'amber' : 'round';
    return { x: t.x, z: t.z, y: H(t.x, t.z), s: t.s, kind };
  });
  const rocks: RockP[] = layout.rocks.map((r) => ({ x: r.x, z: r.z, y: H(r.x, r.z), r: r.r, h: r.h, top: r.top, yaw: hash(r.x, r.z) * 6.283 }));

  // camp props: a cold fire pit in a ring of stones, bramble nests, stick piles, and something tall seen
  // from afar (a lean-to of poles or a bramble totem) at the camp's edge
  const spawns = layout.camps.flatMap(c => c.spawns);
  const halfRoad = layout.recipe.road.width / 2;
  const camps: CampP[] = layout.camps.map((c, ci) => {
    const rng = prng((seed * 31 + ci * 7919 + 1013) >>> 0);
    const props: PropP[] = [];
    const want: { kind: PropKind; ring: [number, number] }[] = [
      { kind: rng() < 0.5 ? 'leanto' : 'totem', ring: [0.72, 0.98] },
      { kind: 'firepit', ring: [0.15, 0.55] },
      { kind: 'nest', ring: [0.3, 0.9] }, { kind: 'nest', ring: [0.3, 0.9] },
      { kind: 'sticks', ring: [0.35, 0.9] },
      { kind: rng() < 0.5 ? 'nest' : 'sticks', ring: [0.4, 0.95] },
      { kind: 'totem', ring: [0.8, 1.05] },
    ];
    for (const w of want) {
      const s = w.kind === 'totem' || w.kind === 'leanto' ? 1 : 0.8 + 0.4 * rng();
      const r = PROP_R[w.kind] * s;
      for (let t = 0; t < 120; t++) {
        const a = rng() * Math.PI * 2, d = c.r * (w.ring[0] + (w.ring[1] - w.ring[0]) * rng());
        const x = c.x + Math.cos(a) * d, z = c.z + Math.sin(a) * d;
        if (roadDistance(layout, x, z, halfRoad + PROP_ROAD_CLEAR + r + 1) <= halfRoad + PROP_ROAD_CLEAR + r) continue;
        if (spawns.some(sp => Math.hypot(sp.x - x, sp.z - z) <= r + ENEMY_KINDS[sp.kind].radius + PROP_SPAWN_CLEAR)) continue;
        if (props.some(p => Math.hypot(p.x - x, p.z - z) <= p.r + r + 0.3)) continue;
        props.push({ kind: w.kind, x, z, y: H(x, z), r, yaw: rng() * Math.PI * 2, s });
        break;
      }
    }
    return { x: c.x, z: c.z, r: c.r, props };
  });

  // the gate stands just outside the walkable west edge (its posts and open leaves are never walked into)
  const W = layout.recipe.width;
  const gx = Math.max(-1, layout.walk.bounds.x0 - 0.3), gz = layout.roadZ(Math.max(0, gx));
  const bx = W - 1.2, bz = layout.roadZ(bx);

  // the tree belt beyond the walkable bounds (and the west hedge's far side), cheap trees
  const belt: GreenwayPlacements['belt'] = [];
  {
    const rng = prng((seed * 13 + 77) >>> 0);
    const hd = layout.recipe.depth / 2;
    for (let t = 0; t < 4000 && belt.length < 520; t++) {
      const x = -34 + (W + 70) * rng(), z = -(hd + 34) + (2 * hd + 68) * rng();
      const outX = x < 0 ? -x : x > W ? x - W : 0, outZ = Math.max(0, Math.abs(z) - hd);
      const out = Math.max(outX, outZ);
      if (out < 1.5 || out > 32) continue;
      if (x < 2 && Math.abs(z - layout.roadZ(Math.max(0, x))) < 7) continue; // the road west, back toward the grove
      if (x > W - 2 && Math.abs(z - layout.roadZ(Math.min(W, x))) < 4) continue;
      if (belt.some(o => Math.hypot(o.x - x, o.z - z) < 3.4)) continue;
      belt.push({ x, z, y: H(x, z), s: 1.3 + 1.1 * rng(), kind: Math.floor(rng() * 3) });
    }
  }
  // undergrowth: ferns and bushes in the trees' shade, off the road, out of the camps, clear of rocks
  const undergrowth: GreenwayPlacements['undergrowth'] = [];
  {
    const rng = prng((seed * 7 + 515) >>> 0);
    for (let t = 0; t < 6000 && undergrowth.length < 900; t++) {
      const tr = layout.trees[Math.floor(rng() * layout.trees.length)];
      const a = rng() * Math.PI * 2, d = 1.2 + 3.2 * rng();
      const x = tr.x + Math.cos(a) * d, z = tr.z + Math.sin(a) * d;
      if (layout.walk.groundAt(x, z) === null) continue;
      if (Math.abs(z - layout.roadZ(x)) < halfRoad + 2.5) continue;
      if (layout.camps.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) continue;
      if (layout.rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 0.8)) continue;
      undergrowth.push({ x, z, y: H(x, z), s: 0.7 + 0.6 * rng(), kind: rng() < 0.65 ? 'fern' : 'bush' });
    }
    // and in clumps along the road's verges
    for (let t = 0; t < 2000 && undergrowth.length < 1200; t++) {
      const x = W * rng(), side = rng() < 0.5 ? -1 : 1, z = layout.roadZ(x) + side * (halfRoad + 1.6 + 3.5 * rng());
      if (layout.walk.groundAt(x, z) === null) continue;
      if (Math.hypot(x - layout.entry.x, z - layout.entry.z) < 6) continue;
      if (layout.camps.some(c => Math.hypot(c.x - x, c.z - z) < c.r + 1.5)) continue;
      if (layout.rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r + 0.8)) continue;
      if (roadDistance(layout, x, z, halfRoad + 3) <= halfRoad + 1.3) continue;
      undergrowth.push({ x, z, y: H(x, z), s: 0.6 + 0.5 * rng(), kind: rng() < 0.55 ? 'fern' : 'bush' });
    }
  }
  // the old road's furniture: every 16–28 m one side or the other, never near a camp, the gates or a rock
  const roadside: PropP[] = [];
  {
    const rng = prng((seed * 11 + 303) >>> 0);
    const kinds: PropKind[] = ['milestone', 'fence', 'logs', 'fence', 'milestone', 'logs'];
    for (let x = 16 + 8 * rng(), k = 0; x < W - 12; x += 16 + 12 * rng(), k++) {
      const side = rng() < 0.5 ? -1 : 1, kind = kinds[k % kinds.length], off = halfRoad + 1.6 + PROP_R[kind] + 0.6 * rng();
      const dz = (layout.roadZ(x + 0.25) - layout.roadZ(x - 0.25)) / 0.5, L = Math.hypot(1, dz);
      const px = x - side * off * dz / L, pz = layout.roadZ(x) + side * off / L;
      const r = PROP_R[kind];
      if (layout.walk.groundAt(px, pz) === null) continue;
      if (layout.camps.some(c => Math.hypot(c.x - px, c.z - pz) < c.r + 4)) continue;
      if (layout.rocks.some(o => Math.hypot(o.x - px, o.z - pz) < o.r + r + 0.8)) continue;
      if (layout.trees.some(t => Math.hypot(t.x - px, t.z - pz) < 0.8 + r)) continue;
      if (roadDistance(layout, px, pz, halfRoad + 3 + r) <= halfRoad + 1 + r) continue;
      roadside.push({ kind, x: px, z: pz, y: H(px, pz), r, yaw: roadYaw(layout, x) + (kind === 'logs' ? 0.3 * (rng() - 0.5) : 0), s: 1 });
    }
  }
  return {
    trees, rocks, camps, undergrowth, roadside,
    gate: { x: gx, z: gz, y: H(gx, gz), yaw: roadYaw(layout, gx) },
    barricade: { x: bx, z: bz, y: H(bx, bz), yaw: roadYaw(layout, bx) },
    belt,
  };
}

/**
 * A platform rock's flat top: an irregular convex polygon (world x, z) at exactly `capY`, scaled so that every
 * edge keeps at least the walk circle's radius from the centre (the whole platform has rock under it).
 * Walls have no cap (capY null).
 */
export function rockShape(r: Pick<RockP, 'x' | 'z' | 'r' | 'top'>): { sides: number; top: [number, number][]; capY: number | null } {
  const sides = 7 + Math.floor(hash(r.z, r.x) * 3);
  const rot = hash(r.x * 1.9, r.z * 0.7) * 6.283;
  const pts: [number, number][] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i + (hash(i, r.x) - 0.5) * 0.2) / sides * 6.283, k = 1 + 0.05 * hash(r.z, i); // small jitter: stays convex
    pts.push([Math.cos(a) * k, Math.sin(a) * k]);
  }
  let inner = Infinity; // nearest edge to the centre, for the unit polygon
  for (let i = 0; i < sides; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % sides];
    inner = Math.min(inner, Math.abs(ax * bz - az * bx) / Math.hypot(bx - ax, bz - az));
  }
  const s = (r.r * 1.03) / inner;
  return { sides, top: pts.map(([x, z]) => [r.x + x * s, r.z + z * s]), capY: r.top };
}

// ───────────────────────── colours ─────────────────────────

const grassBase = (x: number, z: number): RGB => {   // the countryside's (world/countryside.ts)
  const n = vnoise(x * 0.06 + 3, z * 0.06 + 7);
  let c = mix(PAL.grass2, PAL.grass, n);
  c = mix(c, hex('#a5d873'), Math.max(0, vnoise(x * 0.11, z * 0.11) - 0.55) * 1.4);
  return c;
};
const WOOD_FLOOR = hex('#4f9a55'), SHADE = hex('#4c8f52'), TRAMPLED = hex('#b98a5a'), EARTH = hex('#d2a673'), MOSS = hex('#6fae5a');
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

/** A 1 m grid of tree shade (0..1) over the near region, from the tree placements. */
function shadeGrid(plan: GreenwayPlacements, x0: number, z0: number, nx: number, nz: number): Float32Array {
  const g = new Float32Array(nx * nz);
  for (const t of [...plan.trees, ...plan.belt]) {
    const R = 3.0 * t.s;
    for (let i = Math.max(0, Math.floor(t.x - R - x0)); i <= Math.min(nx - 1, Math.ceil(t.x + R - x0)); i++) {
      for (let j = Math.max(0, Math.floor(t.z - R - z0)); j <= Math.min(nz - 1, Math.ceil(t.z + R - z0)); j++) {
        const d = Math.hypot(x0 + i - t.x, z0 + j - t.z);
        const s = 1 - smooth(R * 0.35, R, d);
        if (s > g[j * nx + i]) g[j * nx + i] = s;
      }
    }
  }
  return g;
}

// ───────────────────────── terrain mesh (pure) ─────────────────────────

/** The drawn terrain rectangle (beyond it the far ring takes over), in m; base cells are 2 m. */
const NEAR = { x0: -48, x1: 304, z0: -136, z1: 136 };
const BASE = 2;
/** Finest refinement: 2 m cells halve down to 2 / 2^MAX_LEVEL m. */
const MAX_LEVEL = 4;
/** The lattice heights are computed on (vertices sit on every second point of it), in m. */
const Q = BASE / (1 << (MAX_LEVEL + 1));
const PER_BASE = BASE / Q;
/** Largest height error a cell may leave (checked at its edge midpoints and centre), in m. */
const TOL = 0.012;

export interface TerrainMesh {
  positions: Float32Array; colors: Float32Array; indices: Uint32Array;
  /** Triangles in the mesh (all of them are ground). */
  topTriangles: number;
  /** Cells at each refinement level (2, 1, 0.5, 0.25 m). */
  levels: number[];
}

/** The terrain as an indexed mesh: an adaptive grid, finer where the ground curves, so it matches layout.height. */
export function greenwayTerrain(layout: ZoneLayout, plan: GreenwayPlacements): TerrainMesh {
  const H = layout.height;
  const nI = (NEAR.x1 - NEAR.x0) / BASE, nJ = (NEAR.z1 - NEAR.z0) / BASE;
  // heights on the Q lattice, computed once each (an array cache; NaN = not computed)
  const cache = new Map<number, number>();
  const hq = (i: number, j: number): number => {
    const k = i * 16384 + j;
    let h = cache.get(k);
    if (h === undefined) { h = H(NEAR.x0 + i * Q, NEAR.z0 + j * Q); cache.set(k, h); }
    return h;
  };
  const b = layout.walk.bounds;
  const refinable = (ci: number, cj: number) => {
    const x0 = NEAR.x0 + ci * BASE, z0 = NEAR.z0 + cj * BASE;
    return x0 + BASE > b.x0 - 1.5 && x0 < b.x1 + 1.5 && z0 + BASE > b.z0 - 1.5 && z0 < b.z1 + 1.5;
  };
  // diagonal choice for one quad (corner lattice indices i, j, step s): true = the 00–11 diagonal
  const diagErr = (i: number, j: number, s: number): [boolean, number] => {
    const h = s / 2;
    const c = hq(i + h, j + h);
    const eA = Math.abs(c - (hq(i, j) + hq(i + s, j + s)) / 2), eB = Math.abs(c - (hq(i + s, j) + hq(i, j + s)) / 2);
    return eA <= eB ? [true, eA] : [false, eB];
  };
  const quadErr = (i: number, j: number, s: number): number => {
    const h = s / 2;
    const e = Math.max(
      Math.abs(hq(i + h, j) - (hq(i, j) + hq(i + s, j)) / 2), Math.abs(hq(i + h, j + s) - (hq(i, j + s) + hq(i + s, j + s)) / 2),
      Math.abs(hq(i, j + h) - (hq(i, j) + hq(i, j + s)) / 2), Math.abs(hq(i + s, j + h) - (hq(i + s, j) + hq(i + s, j + s)) / 2),
    );
    return Math.max(e, diagErr(i, j, s)[1]);
  };
  const level = new Uint8Array(nI * nJ);
  const levels = new Array(MAX_LEVEL + 1).fill(0) as number[];
  for (let ci = 0; ci < nI; ci++) for (let cj = 0; cj < nJ; cj++) {
    let L = 0;
    if (refinable(ci, cj)) {
      for (; L < MAX_LEVEL; L++) {
        const n = 1 << L, s = PER_BASE / n;
        let worst = 0;
        for (let a = 0; a < n && worst <= TOL; a++) for (let c = 0; c < n && worst <= TOL; c++) worst = Math.max(worst, quadErr(ci * PER_BASE + a * s, cj * PER_BASE + c * s, s));
        if (worst <= TOL) break;
      }
    }
    level[ci * nJ + cj] = L;
    levels[L]++;
  }

  // colours
  const sx0 = Math.floor(NEAR.x0), sz0 = Math.floor(NEAR.z0), snx = NEAR.x1 - NEAR.x0 + 2, snz = NEAR.z1 - NEAR.z0 + 2;
  const shade = shadeGrid(plan, sx0, sz0, snx, snz);
  const shadeAt = (x: number, z: number) => {
    const i = Math.round(x - sx0), j = Math.round(z - sz0);
    return i >= 0 && j >= 0 && i < snx && j < snz ? shade[j * snx + i] : 0;
  };
  const colorAt = (x: number, z: number, y: number): RGB => {
    let c = grassBase(x, z);
    c = mix(c, SHADE, shadeAt(x, z) * 0.7);
    for (const cp of plan.camps) {
      const d = Math.hypot(x - cp.x, z - cp.z);
      if (d < cp.r + 3) {
        const n = vnoise(x * 0.45 + 11, z * 0.45 + 5);
        const k = (1 - smooth(cp.r * 0.55, cp.r + 2.5, d + (n - 0.5) * 3)) * 0.85;
        c = mix(c, mix(TRAMPLED, EARTH, n), k);
      }
    }
    const out = Math.max(b.x0 - x, x - b.x1, b.z0 - z, z - b.z1);
    if (out > -6) c = mix(c, WOOD_FLOOR, smooth(-6, 10, out) * 0.7);
    if (y > 2.2) c = mix(c, MOSS, Math.min(0.45, (y - 2.2) * 0.12));
    return c;
  };

  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const vmap = new Map<number, number>();
  const vert = (i: number, j: number): number => {
    const k = i * 16384 + j;
    let v = vmap.get(k);
    if (v === undefined) {
      const x = NEAR.x0 + i * Q, z = NEAR.z0 + j * Q, y = hq(i, j);
      v = pos.length / 3;
      pos.push(x, y, z);
      const c = colorAt(x, z, y), jit = 1 + (hash(x * 1.3, z * 1.7) - 0.5) * 0.04;
      col.push(Math.min(1, c[0] * jit), Math.min(1, c[1] * jit), Math.min(1, c[2] * jit), 1);
      vmap.set(k, v);
    }
    return v;
  };
  const triUp = (a: number, b2: number, c: number) => {
    // front faces are wound so that cross(P[c] − P[a], P[b] − P[a]) points up (see Builder.build)
    const ax = pos[a * 3], az = pos[a * 3 + 2];
    const ux = pos[b2 * 3] - ax, uz = pos[b2 * 3 + 2] - az, vx = pos[c * 3] - ax, vz = pos[c * 3 + 2] - az;
    const cy = uz * vx - ux * vz; // cross(u, v).y
    if (cy > 0) idx.push(a, c, b2); else idx.push(a, b2, c);
  };
  // A quad on a cell's edge whose neighbour is finer takes the neighbour's extra edge points and is drawn as a fan
  // from its centre, so cells of different levels meet without T-junction cracks.
  const levelAt = (ci: number, cj: number, L: number) => (ci < 0 || cj < 0 || ci >= nI || cj >= nJ ? L : level[ci * nJ + cj]);
  const loop: number[] = [];
  const side = (i0: number, j0: number, di: number, dj: number, s: number, Ln: number) => {
    const step = Math.min(s, PER_BASE >> Ln);
    for (let k = 0; k < s; k += step) loop.push(vert(i0 + di * k, j0 + dj * k));
  };
  for (let ci = 0; ci < nI; ci++) for (let cj = 0; cj < nJ; cj++) {
    const L = level[ci * nJ + cj], n = 1 << L, s = PER_BASE / n;
    const lB = levelAt(ci, cj - 1, L), lR = levelAt(ci + 1, cj, L), lT = levelAt(ci, cj + 1, L), lL = levelAt(ci - 1, cj, L);
    for (let a = 0; a < n; a++) for (let c = 0; c < n; c++) {
      const i = ci * PER_BASE + a * s, j = cj * PER_BASE + c * s;
      const nb = c === 0 ? lB : L, nr = a === n - 1 ? lR : L, nt = c === n - 1 ? lT : L, nl = a === 0 ? lL : L;
      if (nb > L || nr > L || nt > L || nl > L) {
        loop.length = 0;
        side(i, j, 1, 0, s, nb); side(i + s, j, 0, 1, s, nr); side(i + s, j + s, -1, 0, s, nt); side(i, j + s, 0, -1, s, nl);
        const ctr = vert(i + s / 2, j + s / 2);
        for (let k = 0; k < loop.length; k++) triUp(ctr, loop[k], loop[(k + 1) % loop.length]);
        continue;
      }
      const v00 = vert(i, j), v10 = vert(i + s, j), v01 = vert(i, j + s), v11 = vert(i + s, j + s);
      const [main] = diagErr(i, j, s);
      if (main) { triUp(v00, v10, v11); triUp(v00, v11, v01); } else { triUp(v00, v10, v01); triUp(v10, v11, v01); }
    }
  }
  const topTriangles = idx.length / 3;
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx), topTriangles, levels };
}

/** Height the road is drawn above the ground (a polygon offset keeps it in front), in m. */
const ROAD_LIFT = 0.012;

/** The dirt road in the countryside's style (verges, ruts, a grassy crown), following the centre line. */
export function greenwayRoad(layout: ZoneLayout): { positions: Float32Array; colors: Float32Array; indices: Uint32Array } {
  const H = layout.height, W = layout.recipe.width;
  const w = layout.recipe.road.width / 2;
  const S = [-w - 0.9, -w, -w * 0.62, -w * 0.3, 0, w * 0.3, w * 0.62, w, w + 0.9];
  const grass = hex('#86c262'), crownC = mix(hex('#c9b178'), hex('#7fbb5c'), 0.35);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const X0 = -40, X1 = W + 24, STEP = 0.5;
  let rows = 0;
  for (let x = X0; x <= X1 + 1e-9; x += STEP) {
    const zc = layout.roadZ(x), dz = (layout.roadZ(x + 0.25) - layout.roadZ(x - 0.25)) / 0.5;
    const L = Math.hypot(1, dz), nx = -dz / L, nz = 1 / L; // unit normal to the centre line
    const v = 0.93 + 0.12 * hash(Math.floor(x / 2.4), 5);
    const dirt = tint(hex('#d2a673'), v), rut = tint(hex('#a97c52'), v);
    const C = [grass, dirt, rut, crownC, crownC, crownC, rut, dirt, grass];
    for (let k = 0; k < S.length; k++) {
      const px = x + nx * S[k], pz = zc + nz * S[k];
      pos.push(px, H(px, pz) + ROAD_LIFT, pz);
      col.push(C[k][0], C[k][1], C[k][2], 1);
    }
    rows++;
  }
  const n = S.length;
  for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < n; k++) {
    const a = r * n + k, b = a + 1, c = a + n, d = c + 1;
    // wound like the terrain: front faces up
    idx.push(a, b, d, a, d, c);
  }
  // check winding with the first quad and flip all if needed
  const ax = pos[0], az = pos[2], bx = pos[3], bz = pos[5], dx = pos[(n + 1) * 3], dzz = pos[(n + 1) * 3 + 2];
  const cy = (dzz - az) * (bx - ax) - (dx - ax) * (bz - az); // cross(P[d] − P[a], P[b] − P[a]).y for (a, b, d)
  if (!(cy > 0)) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return { positions: new Float32Array(pos), colors: new Float32Array(col), indices: new Uint32Array(idx) };
}

// ───────────────────────── props (Builder) ─────────────────────────

/** Tall, slender conifer. */
function pine(b: Builder, x: number, y: number, z: number, s: number) {
  b.push(); b.T(x, y, z); b.RY(hash(x, z) * 6.28); b.SC(s, s, s);
  const oldW = b.windFn; const y0 = y + 1.2 * s;
  b.windFn = (p: V3) => Math.max(0, p[1] - y0) * 0.022;
  b.prism([0, -0.2, 0], [0, 1.5, 0], 0.15, 0.1, 5, PAL.woodDark);
  const cols = [hex('#3f8f5f'), hex('#4a9d66'), hex('#57ab6c')];
  const tiers: [number, number, number][] = [[0.75, 2.5, 1.2], [1.6, 3.35, 0.95], [2.45, 4.25, 0.68], [3.3, 4.95, 0.4]];
  tiers.forEach(([a, t, r], i) => b.prism([0, a, 0], [0.02, t, 0.01], r, 0, 7, cols[i % 3], { col2: tint(cols[i % 3], 0.78), rot: i * 0.45 }));
  b.windFn = oldW; b.pop();
}
/** Pale-trunked tree with a tall, narrow canopy (birch-like). */
function birch(b: Builder, x: number, y: number, z: number, s: number, leaf: RGB, leaf2: RGB) {
  b.push(); b.T(x, y, z); b.RY(hash(z, x) * 6.28); b.SC(s, s, s);
  const oldW = b.windFn; const y0 = y + 1.5 * s;
  b.windFn = (p: V3) => Math.max(0, p[1] - y0) * 0.03;
  b.prism([0, -0.2, 0], [0.06, 2.4, 0.03], 0.12, 0.07, 5, hex('#efe6d6'));
  for (let i = 0; i < 4; i++) b.box(0.02, 0.5 + i * 0.45, 0.0, 0.25, 0.05, 0.25, hex('#4a3a3a'));
  b.ball([0.05, 3.0, 0], 0.95, leaf, 0.85, 1.55, 0.85, 1, 0.35, leaf2);
  b.ball([0.35, 2.4, 0.2], 0.55, leaf, 1, 1.1, 1, 1, 0.3, leaf2);
  b.ball([-0.3, 2.6, -0.15], 0.55, leaf, 1, 1.15, 1, 0, 0.3, leaf2);
  b.windFn = oldW; b.pop();
}
/** A broadleaf tree in other leaf colours (parts.tree's shape). */
function tintedTree(b: Builder, x: number, y: number, z: number, s: number, leaf: RGB, leaf2: RGB) {
  b.push(); b.T(x, y, z); b.RY(hash(x, z) * 6.28); b.SC(s, s, s);
  const oldW = b.windFn; const y0 = y + 1.3 * s;
  b.windFn = (p: V3) => Math.max(0, p[1] - y0) * 0.028;
  b.prism([0, -0.2, 0], [0.05, 1.6, 0.02], 0.16, 0.1, 5, PAL.woodDark);
  b.ball([0.05, 2.3, 0], 1.0, leaf, 1.1, 0.85, 1.1, 1, 0.35, leaf2);
  b.ball([0.55, 1.9, 0.25], 0.65, leaf, 1, 0.85, 1, 1, 0.3, leaf2);
  b.ball([-0.5, 2.0, -0.2], 0.7, leaf, 1, 0.85, 1, 1, 0.3, leaf2);
  b.windFn = oldW; b.pop();
}
function drawTree(b: Builder, t: TreeP) {
  switch (t.kind) {
    case 'pine': pine(b, t.x, t.y, t.z, t.s * 0.95); break;
    case 'birch': birch(b, t.x, t.y, t.z, t.s, hex('#a5d36a'), hex('#6fb257')); break;
    case 'amber': tintedTree(b, t.x, t.y, t.z, t.s, hex('#f0b04a'), hex('#d9803c')); break;
    case 'oak': tree(b, t.x, t.y, t.z, t.s * 0.78, 3); break;
    case 'blossom': tree(b, t.x, t.y, t.z, t.s, 1); break;
    case 'teal': tree(b, t.x, t.y, t.z, t.s, 2); break;
    default: tree(b, t.x, t.y, t.z, t.s, 0);
  }
}
/** A fern: fronds arching out from the root. */
function fern(b: Builder, x: number, y: number, z: number, s: number) {
  const n = 6, rot = hash(x, z) * 6.28, oldW = b.windFn;
  b.windFn = (p: V3) => Math.max(0, p[1] - y) * 0.5;
  b.withHint(null, () => {
    for (let i = 0; i < n; i++) {
      const a = rot + i / n * 6.283, c = Math.cos(a), sn = Math.sin(a), L = (0.55 + 0.25 * hash(i, x)) * s;
      const mid: V3 = [x + c * L * 0.5, y + 0.38 * s, z + sn * L * 0.5], tip: V3 = [x + c * L, y + 0.12 * s, z + sn * L];
      const w = 0.09 * s, px = -sn * w, pz = c * w;
      const col = i % 2 ? PAL.leafDeep : hex('#4c9e58');
      b.tri([x, y, z], [mid[0] + px, mid[1], mid[2] + pz], mid, col, col, PAL.leaf2);
      b.tri([x, y, z], mid, [mid[0] - px, mid[1], mid[2] - pz], col, PAL.leaf2, col);
      b.tri([mid[0] + px, mid[1], mid[2] + pz], tip, mid, PAL.leaf2, PAL.leaf1, PAL.leaf2);
      b.tri([mid[0] - px, mid[1], mid[2] - pz], mid, tip, PAL.leaf2, PAL.leaf2, PAL.leaf1);
    }
  });
  b.windFn = oldW;
}
/** A low, dark bush. */
function bush(b: Builder, x: number, y: number, z: number, s: number) {
  const c = hash(z, x) < 0.5 ? hex('#3f8f52') : hex('#4a9a4f');
  b.ball([x, y + 0.22 * s, z], 0.42 * s, c, 1.25, 0.7, 1.1, 0, 0.35, tint(c, 0.7));
  b.ball([x + 0.3 * s, y + 0.16 * s, z + 0.12 * s], 0.28 * s, c, 1.1, 0.75, 1, 0, 0.35, tint(c, 0.7));
  if (hash(x, z) < 0.35) for (let k = 0; k < 3; k++) b.ball([x + (hash(k, x) - 0.5) * 0.6 * s, y + 0.42 * s, z + (hash(z, k) - 0.5) * 0.5 * s], 0.05, k % 2 ? PAL.flowerA : PAL.white, 1, 1, 1, 0);
}

/** Cheap far tree for the belt: a trunk and one or two faceted blobs, or a cone. */
function farTree(b: Builder, x: number, y: number, z: number, s: number, kind: number) {
  b.prism([x, y - 0.3, z], [x, y + 1.6 * s, z], 0.18 * s, 0.12 * s, 4, PAL.woodDark, { caps: false });
  if (kind === 1) b.prism([x, y + 0.9 * s, z], [x, y + 4.6 * s, z], 1.15 * s, 0, 6, hex('#3f8f5f'), { col2: hex('#2f7a50') });
  else {
    const lc = kind === 2 ? hex('#5cbf86') : PAL.leaf2;
    b.ball([x, y + 2.3 * s, z], 1.3 * s, lc, 1, 0.85, 1, 0, 0.3, tint(lc, 0.72));
    if (s > 1.8) b.ball([x + 0.6 * s, y + 1.9 * s, z + 0.3 * s], 0.8 * s, lc, 1, 0.85, 1, 0, 0.3, tint(lc, 0.72));
  }
}

/** A faceted rock from stacked rings (world points), each ring's colour, closed on top with `cap` (or a tip). */
function ringRock(b: Builder, rings: V3[][], cols: RGB[], top: { cap?: RGB; tip?: V3 }) {
  const n = rings[0].length;
  const c = rings[0].reduce((s, p) => [s[0] + p[0] / n, 0, s[2] + p[2] / n], [0, 0, 0] as V3);
  const mid: V3 = [c[0], (rings[0][0][1] + rings[rings.length - 1][0][1]) / 2, c[2]];
  b.withHint(mid, () => {
    for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < n; i++) {
      const q = (i + 1) % n;
      b.quad(rings[k][i], rings[k][q], rings[k + 1][q], rings[k + 1][i], cols[k], cols[k + 1]);
    }
  });
  const last = rings[rings.length - 1];
  if (top.cap) b.withHint('up', () => { for (let i = 1; i + 1 < n; i++) b.tri(last[0], last[i], last[i + 1], i % 2 ? top.cap! : tint(top.cap!, 0.94)); });
  else if (top.tip) b.withHint(mid, () => { for (let i = 0; i < n; i++) b.tri(last[i], last[(i + 1) % n], top.tip!, cols[cols.length - 1]); });
}
/** A ring of n points round (cx, cz) at height y: radius r with craggy jitter, turned by rot. */
function crag(cx: number, cz: number, y: number, r: number, n: number, rot: number, jit: number, seed: number): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) { const a = rot + i / n * 6.283, k = 1 + jit * (hash(i + seed, seed * 1.7) - 0.5); out.push([cx + Math.cos(a) * r * k, y, cz + Math.sin(a) * r * k]); }
  return out;
}

/** Rocks: platforms are broad warm boulders with a flat mossy top; walls are tall, craggy dark-purple spires. */
function drawRock(b: Builder, r: RockP, H: (x: number, z: number) => number) {
  const { top, capY } = rockShape(r);
  let gmin = Infinity;
  for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; gmin = Math.min(gmin, H(r.x + Math.cos(a) * r.r * 1.2, r.z + Math.sin(a) * r.r * 1.2)); }
  gmin = Math.min(gmin, r.y);
  if (capY !== null) {
    // a broad boulder of warm cliff stone, bevelled at the rim, with a pale flat top (exactly capY) patched with moss
    const ring = (y: number, k: number, j: number): V3[] => top.map(([x, z], i) => { const f = k * (1 + j * (hash(i, y) - 0.5)); return [r.x + (x - r.x) * f, y, r.z + (z - r.z) * f]; });
    const rim = capY - 0.1, belly = gmin + (rim - gmin) * 0.5;
    const warm = mix(PAL.rock2, PAL.rock1, 0.5), deep = tint(PAL.rock2, 0.72), pale = mix(PAL.stone2, PAL.rock1, 0.25);
    const oldCj = b.cj; b.cj = 0.08;
    ringRock(b, [ring(gmin - 0.45, 1.1, 0.12), ring(belly, 1.22, 0.14), ring(rim, 1.07, 0.05), ring(capY, 1, 0)], [deep, warm, mix(warm, pale, 0.5), pale], { cap: pale });
    b.cj = oldCj;
    // moss patches lying on the top, and loose stones round the foot
    for (let k = 0; k < 2; k++) { const a = r.yaw + k * 2.6, d = r.r * (0.35 + 0.3 * hash(k, r.z)); b.ball([r.x + Math.cos(a) * d, capY + 0.005, r.z + Math.sin(a) * d], 0.3 * Math.min(1.4, r.r), k ? PAL.grass : PAL.grass2, 1.5, 0.12, 1.1, 1, 0.35); }
    for (let k = 0; k < 6; k++) { const a = k * 1.1 + r.yaw, d = r.r * 1.5 + 0.25 * hash(k, r.z); const x = r.x + Math.cos(a) * d, z = r.z + Math.sin(a) * d; b.ball([x, H(x, z) + 0.04, z], 0.12 + 0.12 * hash(k, r.x), k % 2 ? warm : deep, 1.1, 0.65, 1, 0, 0.45); }
  } else {
    // a crag: a tall main spire and one or two lower ones beside it, plum-purple stone with cliff-red strata
    const n = 6 + Math.floor(hash(r.x, r.z) * 3), rot = r.yaw, seed = Math.floor(hash(r.z, r.x) * 50);
    const c1 = tint(PAL.rock4, 0.85), c2 = PAL.rock4, c3 = mix(PAL.rock4, PAL.rock3, 0.55), band = tint(PAL.rock2, 0.9);
    const oldCj = b.cj; b.cj = 0.08;
    const spire = (cx: number, cz: number, rr: number, hh: number, sd: number) => {
      const tx = (hash(cx, 3 + sd) - 0.5) * rr * 0.6, tz = (hash(3 + sd, cz) - 0.5) * rr * 0.6;
      ringRock(b, [
        crag(cx, cz, gmin - 0.5, rr * 1.08, n, rot, 0.25, sd),
        crag(cx + tx * 0.15, cz + tz * 0.15, r.y + hh * 0.22, rr, n, rot + 0.15, 0.3, sd + 1),
        crag(cx + tx * 0.25, cz + tz * 0.25, r.y + hh * 0.3, rr * 0.92, n, rot + 0.2, 0.3, sd + 2),
        crag(cx + tx * 0.55, cz + tz * 0.55, r.y + hh * 0.62, rr * 0.6, n, rot + 0.45, 0.35, sd + 3),
        crag(cx + tx * 0.85, cz + tz * 0.85, r.y + hh * 0.86, rr * 0.3, n, rot + 0.7, 0.4, sd + 4),
      ], [c1, band, c2, c3, c3], { tip: [cx + tx, r.y + hh, cz + tz] });
    };
    spire(r.x, r.z, r.r, r.h * 1.25 + r.r * 0.9, seed);
    for (let k = 0; k < (r.r > 1.2 ? 2 : 1); k++) {
      const a = r.yaw + 2.2 + k * 2.4, sx = r.x + Math.cos(a) * r.r * 0.62, sz = r.z + Math.sin(a) * r.r * 0.62;
      spire(sx, sz, r.r * 0.5, (r.h * 1.25 + r.r * 0.9) * (0.45 + 0.2 * hash(r.x, 9 + k)), seed + 10 + k * 7);
    }
    b.cj = oldCj;
  }
}

const BRAMBLE = hex('#2f6e45'), THORN = PAL.roof1;
function bramble(b: Builder, cx: number, cy: number, cz: number, r: number, hgt: number, seed: number) {
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * 6.283 + seed, a2 = a + 1.9 + hash(seed, k);
    const p0: V3 = [cx + Math.cos(a) * r, cy - 0.05, cz + Math.sin(a) * r];
    const p1: V3 = [cx + Math.cos(a) * r * 0.3, cy + hgt * (0.7 + 0.4 * hash(k, seed)), cz + Math.sin(a) * r * 0.3];
    const p2: V3 = [cx + Math.cos(a2) * r * 0.9, cy - 0.05, cz + Math.sin(a2) * r * 0.9];
    b.prism(p0, p1, 0.05, 0.04, 4, k % 2 ? BRAMBLE : PAL.woodDark, { caps: false });
    b.prism(p1, p2, 0.04, 0.035, 4, k % 2 ? PAL.woodDark : BRAMBLE, { caps: false });
    if (k % 2 === 0) b.prism(p1, [p1[0] + 0.1, p1[1] + 0.16, p1[2]], 0.04, 0, 3, THORN);
    if (k % 3 === 0) b.ball(p1, 0.12, PAL.leafDeep, 1.2, 0.6, 1, 0, 0.3);
  }
}
function drawProp(b: Builder, p: PropP) {
  const { x, y, z, s } = p;
  b.push(); b.T(x, y, z); b.RY(p.yaw);
  switch (p.kind) {
    case 'firepit': {
      for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283; b.ball([Math.cos(a) * 0.95 * s, 0.1, Math.sin(a) * 0.95 * s], 0.2 * s, k % 2 ? PAL.plinth : PAL.stone2, 1.2, 0.75, 1, 0, 0.35); }
      b.prism([0, 0.0, 0], [0, 0.04, 0], 0.72 * s, 0.7 * s, 9, hex('#4d4248'));          // cold ash
      for (let k = 0; k < 4; k++) { const a = k * 0.8; b.prism([Math.cos(a) * 0.6 * s, 0.07, Math.sin(a) * 0.6 * s], [-Math.cos(a) * 0.5 * s, 0.18, -Math.sin(a) * 0.5 * s], 0.07, 0.06, 5, k % 2 ? hex('#3a2a28') : PAL.woodDark); }
      break;
    }
    case 'nest': bramble(b, 0, 0, 0, 0.75 * s, 0.6 * s, hash(x, z) * 9); b.ball([0, 0.08, 0], 0.5 * s, PAL.woodDark, 1.2, 0.3, 1.2, 0, 0.3); break;
    case 'sticks':
      for (let k = 0; k < 8; k++) { const a = k * 0.73 + hash(k, x); const L = 0.7 * s; b.prism([Math.cos(a) * L, 0.06 + k * 0.035, Math.sin(a) * L], [-Math.cos(a) * L, 0.1 + k * 0.03, -Math.sin(a) * L], 0.045, 0.04, 4, k % 3 ? PAL.wood : PAL.woodLight); }
      break;
    case 'leanto': {
      const top: V3 = [0, 2.7, 0];
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.283; b.prism([Math.cos(a) * 1.15, -0.1, Math.sin(a) * 1.15], [top[0] - Math.cos(a) * 0.25, top[1] + 0.3, top[2] - Math.sin(a) * 0.25], 0.06, 0.045, 4, k % 2 ? PAL.wood : PAL.woodDark); }
      // a tattered hide over one side, teal and cliff red
      b.withHint(null, () => {
        for (let k = 0; k < 3; k++) {
          const a0 = k / 6 * 6.283, a1 = (k + 1) / 6 * 6.283;
          b.tri([Math.cos(a0) * 1.05, 0.25, Math.sin(a0) * 1.05], [Math.cos(a1) * 1.05, 0.15, Math.sin(a1) * 1.05], [0, 2.45, 0], k === 1 ? PAL.rock2 : PAL.roof3);
        }
      });
      b.ball([0, 2.8, 0], 0.16, PAL.stone, 1, 1.2, 1, 0);
      break;
    }
    case 'milestone': {
      b.taperBox([0, -0.2, 0], 0.42, 0.3, [0, 0.62, 0], 0.32, 0.24, PAL.stone2, PAL.plinth);
      b.ball([0, 0.62, 0], 0.17, PAL.plinth, 1, 0.55, 0.75, 0);
      b.box(0, 0.42, 0.13, 0.18, 0.05, 0.02, PAL.plinthDark);
      b.ball([0.15, 0.05, 0.1], 0.14, PAL.grass2, 1.3, 0.5, 1, 0, 0.3);
      break;
    }
    case 'fence': { // a few old posts, one rail still up, one fallen
      for (let k = 0; k < 3; k++) b.prism([0, -0.2, -1.2 + k * 1.2], [0.04 * (k - 1), 0.85 - 0.12 * (k % 2), -1.2 + k * 1.2], 0.08, 0.07, 5, PAL.woodDark);
      b.prism([0, 0.6, -1.25], [0, 0.55, 0.05], 0.045, 0.045, 4, PAL.woodLight);
      b.prism([0.35, 0.05, 0.15], [0.55, 0.06, 1.35], 0.045, 0.045, 4, PAL.wood);
      b.ball([0.1, 0.06, 1.2], 0.25, PAL.leafDeep, 1.3, 0.6, 1.2, 0, 0.35);
      break;
    }
    case 'logs': {
      for (const [lx, ly, len] of [[-0.25, 0.17, 1.7], [0.22, 0.17, 1.5], [0, 0.45, 1.6]] as const) {
        b.prism([lx, ly, -len / 2], [lx, ly, len / 2], 0.18, 0.18, 7, PAL.wood, { capA: PAL.woodLight, capB: PAL.woodLight });
      }
      b.ball([0.5, 0.12, 0.6], 0.2, PAL.grass2, 1.2, 0.5, 1, 0, 0.3);
      break;
    }
    case 'totem': {
      b.prism([0, -0.3, 0], [0.05, 3.3, 0.02], 0.13, 0.09, 6, PAL.woodDark);
      for (let k = 0; k < 6; k++) { const yy = 0.4 + k * 0.45; b.prism([0.16, yy, 0], [-0.16, yy + 0.3, 0.12], 0.05, 0.05, 4, BRAMBLE, { caps: false }); b.prism([0.1, yy + 0.15, 0.1], [0.24, yy + 0.3, 0.2], 0.035, 0, 3, THORN); }
      // a horned stone-pale skull-gourd on top, and a tattered teal pennant
      b.ball([0.05, 3.42, 0.04], 0.25, PAL.stone, 1, 0.85, 1.15, 1, 0.2);
      b.box(-0.03, 3.37, 0.25, 0.08, 0.08, 0.04, hex('#2a1f33')); b.box(0.13, 3.37, 0.25, 0.08, 0.08, 0.04, hex('#2a1f33'));
      for (const sx of [-1, 1]) b.prism([0.05 + sx * 0.2, 3.5, 0], [0.05 + sx * 0.45, 3.85, -0.08], 0.06, 0, 4, PAL.stone2);
      b.withHint(null, () => { b.tri([0.05, 3.0, 0], [0.05, 2.45, 0], [0.95, 2.62, 0.1], PAL.roof3); b.tri([0.05, 3.0, 0], [0.95, 2.62, 0.1], [0.8, 2.95, 0.05], tint(PAL.roof3, 0.85)); });
      break;
    }
  }
  b.pop();
}

/** A hedge segment like the town's boundary hedges. */
function hedge(b: Builder, H: (x: number, z: number) => number, ax: number, az: number, bx: number, bz: number, hgt = 1.6) {
  const L = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.round(L / 5));
  const yaw = Math.atan2(bx - ax, bz - az);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; const y = H(x, z);
    b.push(); b.T(x, y, z); b.RY(yaw);
    b.taperBox([0, -0.9, 0], 1.3, L / n + 0.2, [0, hgt, 0], 0.9, L / n + 0.1, hex('#4f9e58'), hex('#5fb05e'));
    b.pop();
  }
}

/** The west gate: the town's farm-gate posts and rails (swung open), under an arch with a lantern and a sign. */
function drawGate(k: Kit, g: GreenwayPlacements['gate'], H: (x: number, z: number) => number): { sign: V3; signBack: V3; lantern: V3 } {
  const b = k.b;
  b.push(); b.T(g.x, g.y, g.z); b.RY(g.yaw - Math.PI / 2); // local +Z across the road, +X along it (east)
  const span = 2.9;
  for (const s of [-span, span]) {
    b.prism([0, -0.4, s], [0, 4.1, s], 0.2, 0.16, 6, PAL.timber);
    b.ball([0, 4.18, s], 0.16, PAL.gold, 1, 1, 1, 0);
  }
  // arch: two beams meeting above the road, and a crossbeam
  b.prism([0, 3.7, -span - 0.25], [0, 4.55, 0], 0.13, 0.11, 5, PAL.woodDark);
  b.prism([0, 3.7, span + 0.25], [0, 4.55, 0], 0.13, 0.11, 5, PAL.woodDark);
  b.prism([0, 3.55, -span - 0.4], [0, 3.55, span + 0.4], 0.11, 0.11, 5, PAL.timber);
  // the sign hangs under the crossbeam (its painted face is a separate plane)
  for (const s of [-0.75, 0.75]) b.prism([0, 3.5, s], [0, 3.05, s], 0.025, 0.025, 3, PAL.woodDark);
  b.box(0, 2.78, 0, 0.1, 0.62, 1.95, PAL.woodLight);
  b.box(0, 3.1, 0, 0.12, 0.08, 2.05, PAL.woodDark);
  // the farm gate's two leaves swung open against the posts (like the grove's east gate, rails of woodLight)
  for (const side of [-1, 1]) {
    b.push(); b.T(0, 0, side * (span - 0.15)); b.RY(side * 1.5); // swung outward, toward the grove
    for (const yy of [0.45, 0.9, 1.3]) b.prism([0, yy, 0], [0, yy, -side * 2.5], 0.06, 0.06, 4, PAL.woodLight);
    b.prism([0, 0.45, 0], [0, 1.3, -side * 2.4], 0.05, 0.05, 4, PAL.woodLight);
    b.prism([0, -0.1, -side * 2.5], [0, 1.45, -side * 2.5], 0.09, 0.08, 5, PAL.timber);
    b.pop();
  }
  b.pop();
  // a lantern on its own post beside the road, inside the gate (like the grove's)
  const yaw = g.yaw - Math.PI / 2, c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number): [number, number] => [g.x + c * lx + s * lz, g.z - s * lx + c * lz];
  const [lx, lz] = at(-0.9, 3.8);
  lantern(k, lx, H(lx, lz), lz, 2.9, yaw + Math.PI);
  const [sx, sz] = at(0.06, 0), [bx, bz] = at(-0.06, 0);
  return { sign: [sx, g.y + 2.78, sz], signBack: [bx, g.y + 2.78, bz], lantern: [lx, H(lx, lz) + 2.6, lz] };
}

/** The fallen-tree barricade across the road at the east end: a great trunk on its side, its roots and brambles. */
function drawBarricade(b: Builder, p: GreenwayPlacements['barricade']) {
  b.push(); b.T(p.x, p.y, p.z); b.RY(p.yaw - Math.PI / 2);
  b.prism([0.1, 0.62, -7], [-0.2, 0.75, 7.5], 0.62, 0.48, 8, PAL.woodDark, { col2: PAL.wood });
  b.ball([0.1, 0.7, -7.3], 0.95, PAL.woodDark, 0.6, 1.1, 0.5, 1, 0.4);
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283; b.prism([0.1, 0.7, -7.2], [0.1 + Math.cos(a) * 1.4, 0.7 + Math.sin(a) * 1.3, -7.6 - 0.3 * hash(k, 2)], 0.14, 0.03, 4, PAL.woodDark); }
  for (let k = 0; k < 5; k++) { const zz = -5 + k * 2.6; b.prism([0, 1.0, zz], [0.5 - k % 2, 2.3, zz + 0.6], 0.09, 0.03, 4, PAL.wood); b.ball([0.5 - k % 2, 2.35, zz + 0.6], 0.38, PAL.leaf2, 1, 0.8, 1, 0, 0.3, PAL.leafDeep); }
  for (let k = 0; k < 6; k++) bramble(b, -1.0 + (k % 2) * 2, 0.05, -5 + k * 2, 0.7, 0.9, k * 3.1);
  // stakes driven into the road in front
  for (let k = 0; k < 5; k++) b.prism([1.5, -0.2, -2.4 + k * 1.2], [0.75, 1.3, -2.4 + k * 1.2], 0.08, 0.0, 4, PAL.woodLight);
  b.pop();
}

/** Low hills, woods and blue mountains beyond the near terrain, so the edge of the world is never seen. The far
 *  ground's inner ring is the near terrain's own boundary (same points, same heights), so the two meet without a seam. */
function drawFar(far: Builder, mount: Builder, layout: ZoneLayout) {
  const H = layout.height;
  const cx = (NEAR.x0 + NEAR.x1) / 2, cz = (NEAR.z0 + NEAR.z1) / 2;
  const rng = prng(layout.recipe.seed + 404);
  const per: [number, number][] = [];
  for (let x = NEAR.x0; x < NEAR.x1; x += BASE) per.push([x, NEAR.z0]);
  for (let z = NEAR.z0; z < NEAR.z1; z += BASE) per.push([NEAR.x1, z]);
  for (let x = NEAR.x1; x > NEAR.x0; x -= BASE) per.push([x, NEAR.z1]);
  for (let z = NEAR.z1; z > NEAR.z0; z -= BASE) per.push([NEAR.x0, z]);
  const F = [1, 1.1, 1.25, 1.5, 1.95, 2.7, 4, 6.2, 9.5];
  const farY = (x: number, z: number) => 4 + 16 * vnoise(x * 0.005 + 3, z * 0.005 + 1) - 2;
  const ring = F.map((f, k) => per.map(([px, pz]): V3 => {
    const x = cx + (px - cx) * f, z = cz + (pz - cz) * f;
    const t = smooth(0, 3, k);
    return [x, k === 0 ? H(x, z) : H(x, z) * (1 - t) + farY(x, z) * t, z];
  }));
  const n = per.length;
  far.withHint('up', () => {
    for (let k = 0; k + 1 < F.length; k++) for (let i = 0; i < n; i++) {
      const q = (i + 1) % n;
      const c = mix(WOOD_FLOOR, hex('#9dbb95'), Math.min(1, k / 6));
      far.tri(ring[k][i], ring[k][q], ring[k + 1][q], c); far.tri(ring[k][i], ring[k + 1][q], ring[k + 1][i], tint(c, 0.97));
    }
  });
  // rolling wooded hills
  for (let i = 0; i < 70; i++) {
    const a = rng() * 6.283, f = 1.2 + rng() * 2.2;
    const x = cx + Math.cos(a) * (NEAR.x1 - cx) * f, z = cz + Math.sin(a) * (NEAR.z1 - cz) * f;
    const hs = 22 + rng() * 40, y = farY(x, z);
    const c = mix(hex('#4f9a55'), hex('#8fae8e'), Math.min(1, (f - 1.2) / 2.2));
    far.ball([x, y - hs * 0.22, z], hs, c, 1.4, 0.3 + rng() * 0.15, 1.2, 1, 0.3, tint(c, 0.8));
    for (let k = 0; k < 4; k++) farTree(far, x + (rng() - 0.5) * hs, y + hs * 0.04, z + (rng() - 0.5) * hs, 3 + rng() * 2, k % 3);
  }
  // distant blue mountains (like the town's)
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * 6.283 + (rng() - 0.5) * 0.1;
    for (const layer of [0, 1]) {
      const r = (layer ? 1650 : 1300) + (rng() - 0.5) * 240;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const hgt = (90 + rng() * 200) * (layer ? 1.5 : 1), base = (200 + rng() * 120) * (layer ? 1.3 : 1);
      const tip: V3 = [x + (rng() - 0.5) * 120, 20 + hgt, z + (rng() - 0.5) * 120];
      mount.prism([x, 0, z], tip, base, 0, 7, layer ? hex('#a9b9dc') : hex('#8ea3d0'), { rot: rng(), col2: hex('#c3cde6') });
      if (hgt > 220) mount.prism([tip[0], tip[1] - hgt * 0.18, tip[2]], tip, base * 0.19, 0, 7, hex('#eef0fa'));
    }
  }
}

// ───────────────────────── the world ─────────────────────────

const C3 = (h: string) => { const c = hex(h); return new Color3(c[0], c[1], c[2]); };
/** Static geometry is cut into strips this wide along the road, so off-screen strips are culled. */
const CHUNK_W = 66;

/** Paints `text` on one face of the west gate's sign (a canvas texture: built in code, no asset). */
function signPlane(scene: Scene, at: V3, yaw: number, text: string): Mesh {
  const tex = new DynamicTexture('gw_signtex', { width: 512, height: 160 }, scene, true);
  const g = tex.getContext() as unknown as CanvasRenderingContext2D;
  g.fillStyle = '#c9925e'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#5e3b2a'; g.lineWidth = 10; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#4a2c1c'; g.font = 'bold 70px Georgia, "Times New Roman", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 84);
  tex.update();
  const m = new StandardMaterial('gw_signmat', scene);
  m.diffuseTexture = tex; m.specularColor = new Color3(0, 0, 0); m.emissiveColor = new Color3(0.18, 0.15, 0.12);
  const plane = MeshBuilder.CreatePlane('gw_sign', { width: 1.85, height: 0.56 }, scene);
  plane.material = m; plane.position.set(at[0], at[1], at[2]); plane.rotation.y = yaw; plane.isPickable = false;
  return plane;
}

export function buildGreenway(scene: Scene): WorldApi {
  const layout = greenwayLayout();
  const plan = greenwayPlacements(layout);
  const H = layout.height;
  const walk = layout.walk;

  // ───── atmosphere (the town's light, a little more forest haze) ─────
  const fogCol = C3(HAZE);
  scene.clearColor = new Color4(fogCol.r, fogCol.g, fogCol.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = fogCol;
  scene.fogStart = 45; scene.fogEnd = 640;
  scene.ambientColor = new Color3(0, 0, 0);
  const sunDir = new Vector3(-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]);
  const sun = new DirectionalLight('gw_sun', sunDir, scene);
  sun.diffuse = C3('#ffd9a8'); sun.specular = C3('#ffe7c4'); sun.intensity = 1.0;
  sun.position = new Vector3(SUN_DIR[0] * 120, SUN_DIR[1] * 120, SUN_DIR[2] * 120);
  const hemi = new HemisphericLight('gw_fill', new Vector3(0.15, 1, 0.25), scene);
  hemi.diffuse = C3('#b9cdf2'); hemi.groundColor = C3('#9c8a8a'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.62;

  // ───── materials (as the town's) ─────
  const litMat = (name: string, fx: WfxOpts | null, emissive = 0) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(emissive, emissive, emissive);
    if (fx) new WorldFxPlugin(m, fx);
    return m;
  };
  const mLit = litMat('gw_lit', { noise: 0.2, rim: 0.22, cloudShadow: 0.16, fade: true, wind: true });
  const mTerrainMat = litMat('gw_terrainmat', { noise: 0.34, cloudShadow: 0.18 }); mTerrainMat.diffuseColor = new Color3(0.93, 0.9, 0.78);
  const mRoadMat = litMat('gw_roadmat', { noise: 0.3, cloudShadow: 0.18 }); mRoadMat.diffuseColor = new Color3(0.93, 0.9, 0.78); mRoadMat.zOffset = -2;
  const mGrass = litMat('gw_grassmat', { noise: 0.25, cloudShadow: 0.18, wind: true }); mGrass.backFaceCulling = false; mGrass.diffuseColor = new Color3(0.94, 0.91, 0.8);
  const mFarMat = litMat('gw_farmat', { noise: 0.22, cloudShadow: 0.18 });
  const mGlow = new StandardMaterial('gw_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1);
  new WorldFxPlugin(mGlow, { flicker: true });
  const mMountMat = litMat('gw_mount', { noise: 0.12 }); mMountMat.fogEnabled = false; mMountMat.diffuseColor = new Color3(0.42, 0.42, 0.46); mMountMat.emissiveColor = C3('#8d8aa0');

  // ───── terrain + road (indexed meshes, smooth normals) ─────
  const indexed = (name: string, d: { positions: Float32Array; colors: Float32Array; indices: Uint32Array }, mat: StandardMaterial) => {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = d.positions; vd.colors = d.colors; vd.indices = d.indices;
    const normals = new Float32Array(d.positions.length);
    VertexData.ComputeNormals(d.positions, d.indices, normals);
    vd.normals = normals;
    vd.applyToMesh(m, false);
    m.material = mat; m.hasVertexAlpha = false;
    return m;
  };
  const terrain = greenwayTerrain(layout, plan);
  const mTerrain = indexed('gw_terrain', terrain, mTerrainMat);
  const mRoad = indexed('gw_road', greenwayRoad(layout), mRoadMat);

  // ───── trees, rocks, camps, gates: merged per strip along the road ─────
  const W = layout.recipe.width;
  const nChunks = Math.ceil((W + 40) / CHUNK_W);
  const chunkOf = (x: number) => Math.max(0, Math.min(nChunks - 1, Math.floor((x + 20) / CHUNK_W)));
  const chunks: Builder[] = Array.from({ length: nChunks }, (_, i) => new Builder(400 + i));
  for (const t of plan.trees) drawTree(chunks[chunkOf(t.x)], t);
  for (const r of plan.rocks) drawRock(chunks[chunkOf(r.x)], r, H);
  for (const c of plan.camps) for (const p of c.props) drawProp(chunks[chunkOf(p.x)], p);
  for (const u of plan.undergrowth) (u.kind === 'fern' ? fern : bush)(chunks[chunkOf(u.x)], u.x, u.y, u.z, u.s);
  for (const p of plan.roadside) drawProp(chunks[chunkOf(p.x)], p);
  const glowB = new Builder(450);
  const gateKit = new Kit(chunks[0], glowB);
  const gateOut = drawGate(gateKit, plan.gate, H);
  drawBarricade(chunks[chunkOf(plan.barricade.x)], plan.barricade);
  // the west boundary hedge (as the town's hedge ring), open where the road passes the gate
  {
    const gz = layout.westGate.z, hd = layout.recipe.depth / 2;
    hedge(chunks[0], H, -0.6, gz - 3.4, -0.6, -hd + 2);
    hedge(chunks[0], H, -0.6, gz + 3.4, -0.6, hd - 2);
  }
  const beltB = new Builder(460);
  for (const t of plan.belt) farTree(beltB, t.x, t.y, t.z, t.s, t.kind);
  const farB = new Builder(470), mountB = new Builder(471);
  drawFar(farB, mountB, layout);

  // grass: tier A (med+high) and tier B (high only), off the road, rocks, trees and camps' trampled middles
  const gOk = (x: number, z: number) => {
    if (walk.groundAt(x, z) === null) return false;
    if (Math.abs(z - layout.roadZ(x)) < 3.2) return false;
    return !plan.camps.some(c => Math.hypot(c.x - x, c.z - z) < c.r * 0.7);
  };
  const bnd = walk.bounds;
  const sampleIn = (b: Builder) => (): [number, number] => {
    // most tufts within reach of the road (where adventurers walk), the rest anywhere
    const x = b.rng.r(bnd.x0, bnd.x1);
    const z = b.rng.next() < 0.6 ? layout.roadZ(x) + b.rng.r(-26, 26) : b.rng.r(bnd.z0, bnd.z1);
    return [x, z];
  };
  const grassA = new Builder(81), grassB = new Builder(82);
  buildGrass(grassA, 6000, H, gOk, sampleIn(grassA));
  buildGrass(grassB, 9000, H, gOk, sampleIn(grassB));

  const mk = (b: Builder, name: string, mat: StandardMaterial) => b.build(scene, name, mat);
  const mChunks = chunks.map((b, i) => mk(b, `gw_chunk_${i}`, mLit));
  const mGlowM = mk(glowB, 'gw_glowm', mGlow);
  const mBelt = mk(beltB, 'gw_belt', mFarMat);
  const mFar = mk(farB, 'gw_far', mFarMat);
  const mMount = mk(mountB, 'gw_mountains', mMountMat);
  const mGrassA = mk(grassA, 'gw_grass_a', mGrass);
  const mGrassB = mk(grassB, 'gw_grass_b', mGrass);
  // the plane's front faces −Z; turned to face east, along the road, toward an adventurer walking back west
  // "Shady Grove" on the face toward the zone (read walking back west), "The Greenway" on the face toward the grove
  const sign = signPlane(scene, gateOut.sign, plan.gate.yaw - Math.PI, 'Shady Grove');
  const signBack = signPlane(scene, gateOut.signBack, plan.gate.yaw, 'The Greenway');
  const statics: Mesh[] = [mTerrain, mRoad, ...mChunks, mGlowM, mBelt, mFar, mMount, mGrassA, mGrassB, sign, signBack];
  for (const m of statics) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; }
  // the ground is pickable (tap-to-walk); the far scenery is not
  for (const m of [mMount, mFar, mBelt, mGrassA, mGrassB, mGlowM, sign, signBack]) m.isPickable = false;
  mTerrain.isPickable = true; mRoad.isPickable = true;

  const sky = createShaderSky(scene, new Vector3(-0.4, 0.5, 0.75)); // the cloud bank stays where the Beacon would be: off to the north-west
  const life = createLife(scene, []);

  // ───── anchors and spawns ─────
  const entry = layout.entry;
  const entryAnchor: Anchor = { pos: new Vector3(entry.x, H(entry.x, entry.z), entry.z), facing: entry.facing };
  const spawns = layout.camps.flatMap(c => c.spawns).map(s => new Vector3(s.x, H(s.x, s.z), s.z));
  const lens = new Vector3(gateOut.lantern[0], gateOut.lantern[1], gateOut.lantern[2]);

  // ───── quality: shadows, glow, post (as the town's) ─────
  let quality: Quality = 'med';
  let shadow: CascadedShadowGenerator | null = null;
  let glow: GlowLayer | null = null;
  let cam: ArcRotateCamera | null = null;
  let pipe: DefaultRenderingPipeline | null = null;
  let ssao: SSAO2RenderingPipeline | null = null;
  const casters: AbstractMesh[] = [...mChunks];
  const receivers: Mesh[] = [mTerrain, mRoad, ...mChunks, mGrassA, mGrassB];
  const blobTex = new DynamicTexture('gw_blob', { width: 64, height: 64 }, scene, false);
  { const g = blobTex.getContext() as unknown as CanvasRenderingContext2D; const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(40,30,60,0.55)'); r.addColorStop(1, 'rgba(40,30,60,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); blobTex.hasAlpha = true; blobTex.update(); }
  const blobMat = new StandardMaterial('gw_blobmat', scene); blobMat.diffuseTexture = blobTex; blobMat.useAlphaFromDiffuseTexture = true; blobMat.disableLighting = true; blobMat.emissiveColor = new Color3(1, 1, 1); blobMat.zOffset = -2;
  const blobs: { root: TransformNode; disc: Mesh }[] = [];
  const ip = scene.imageProcessingConfiguration;
  const grade = (c: ImageProcessingConfiguration) => {
    c.toneMappingEnabled = true; c.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    c.exposure = 1.08; c.contrast = 1.12;
    c.colorCurvesEnabled = true;
    const cc = c.colorCurves!; cc.globalSaturation = 4; cc.shadowsHue = 235; cc.shadowsDensity = 22; cc.shadowsSaturation = 20; cc.highlightsHue = 40; cc.highlightsDensity = 18; cc.highlightsSaturation = 15;
    c.vignetteEnabled = true; c.vignetteWeight = 1.25; c.vignetteStretch = 0.5; c.vignetteColor = new Color4(0.16, 0.1, 0.22, 0);
  };
  let shadowFor: Quality | null = null;
  const applyShadows = (q: Quality) => {
    if (!scene.activeCamera && !cam) { shadowFor = null; return; }
    shadowFor = q;
    shadow?.dispose(); shadow = null;
    for (const m of receivers) m.receiveShadows = q !== 'low';
    if (q === 'low') return;
    const csm = new CascadedShadowGenerator(q === 'high' ? 2048 : 1024, sun);
    if (cam) csm.camera = cam;
    csm.numCascades = q === 'high' ? 3 : 2;
    csm.lambda = 0.82; csm.shadowMaxZ = q === 'high' ? 150 : 95; csm.stabilizeCascades = true; csm.cascadeBlendPercentage = 0.12;
    csm.usePercentageCloserFiltering = true; csm.filteringQuality = q === 'high' ? CascadedShadowGenerator.QUALITY_HIGH : CascadedShadowGenerator.QUALITY_MEDIUM;
    csm.bias = 0.004; csm.normalBias = 0.025; csm.darkness = 0.38;
    csm.depthClamp = true; csm.autoCalcDepthBounds = false;
    for (const c of casters) if (!c.isDisposed()) csm.addShadowCaster(c, false);
    shadow = csm;
  };
  const applyPost = () => {
    pipe?.dispose(); pipe = null; ssao?.dispose(); ssao = null;
    glow?.dispose(); glow = null;
    if (quality !== 'low') {
      glow = new GlowLayer('gw_glowlayer', scene, { mainTextureRatio: quality === 'high' ? 0.5 : 0.25, blurKernelSize: quality === 'high' ? 32 : 16 });
      glow.intensity = 0.5;
      glow.addIncludedOnlyMesh(mGlowM);
      glow.customEmissiveColorSelector = (_mesh, _s, _m, result) => { result.set(1, 0.72, 0.36, 1); };
    }
    grade(ip); ip.isEnabled = true;
    if (!cam || quality === 'low') return;
    pipe = new DefaultRenderingPipeline('gw_post', quality === 'high', scene, [cam]);
    pipe.imageProcessingEnabled = true;
    if (quality === 'high') {
      pipe.samples = 4; pipe.fxaaEnabled = false;
      pipe.bloomEnabled = true; pipe.bloomThreshold = 0.86; pipe.bloomWeight = 0.22; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;
      pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.12; pipe.sharpen.colorAmount = 1;
      try {
        ssao = new SSAO2RenderingPipeline('gw_ssao', scene, { ssaoRatio: 0.5, blurRatio: 0.5 }, [cam]);
        ssao.radius = 1.2; ssao.totalStrength = 0.9; ssao.base = 0.2; ssao.samples = 12; ssao.maxZ = 140; ssao.minZAspect = 0.4; ssao.expensiveBlur = true;
      } catch (e) { console.warn('SSAO unavailable', e); ssao = null; }
    } else { pipe.fxaaEnabled = true; }
  };
  const setQuality = (q: Quality) => {
    quality = q;
    mGrassA.setEnabled(q !== 'low');
    mGrassB.setEnabled(q === 'high');
    mBelt.setEnabled(true);
    sky.setOctaves(q === 'low' ? 3 : q === 'med' ? 4 : 5);
    life.setLevel(q);
    for (const b of blobs) b.disc.setEnabled(q === 'low');
    applyShadows(q);
    applyPost();
  };
  setQuality('med');

  let time = 0;
  const tmpTarget = new Vector3();
  return {
    addShadowCaster: (root: TransformNode) => {
      for (const m of root.getChildMeshes(false)) {
        if (casters.includes(m)) continue;
        if ((m.material as StandardMaterial | null)?.disableLighting) continue; // glowing bits cast no shadow
        casters.push(m);
        shadow?.addShadowCaster(m, false);
      }
      if (!blobs.some(b => b.root === root)) {
        const disc = MeshBuilder.CreateGround('gw_blob_' + blobs.length, { width: 1.3, height: 1.3 }, scene);
        disc.material = blobMat; disc.isPickable = false; disc.setEnabled(quality === 'low');
        blobs.push({ root, disc });
      }
    },
    attachCamera: (c: ArcRotateCamera) => { cam = c; applyShadows(quality); applyPost(); },
    groundAt: (x, z) => walk.groundAt(x, z),
    surfaceAt: (x, z) => walk.surfaceAt(x, z),
    // grove-only anchors (the statue, the docks, the arena) have no place here: they all answer the entry
    anchor: (_name: AnchorName) => ({ pos: entryAnchor.pos.clone(), facing: entryAnchor.facing }),
    enemySpawns: () => spawns.map(p => p.clone()),
    raiseBeacon: () => Promise.resolve(),
    get beaconRaised() { return false; },
    setArenaPhase: () => {},
    statueLens: lens,
    setQuality,
    update: (dt) => {
      time += dt;
      if (shadowFor !== quality && (cam || scene.activeCamera)) applyShadows(quality);
      WFX.time = time;
      WFX.wind = 0.8 + 0.2 * Math.sin(time * 0.31);
      const ac = cam ?? (scene.activeCamera as ArcRotateCamera | null);
      if (ac && ac.target) { tmpTarget.copyFrom(ac.target); WFX.target.copyFrom(tmpTarget); WFX.fadeRadius = 3.2; }
      sky.update(time);
      life.update(dt, time, WFX.target);
      for (let i = blobs.length - 1; i >= 0; i--) {
        const b = blobs[i];
        if (b.root.isDisposed()) { b.disc.dispose(); blobs.splice(i, 1); continue; }
        const p = b.root.position;
        b.disc.position.set(p.x, (walk.surfaceAt(p.x, p.z) ?? p.y) + 0.04, p.z);
      }
      for (let i = casters.length - 1; i >= 0; i--) if (casters[i].isDisposed()) casters.splice(i, 1);
    },
  };
}
