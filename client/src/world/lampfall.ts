// buildLampfall: the Lampfall, the crater beneath the Greenway's east end where the Beacon's keeper fell. Everything
// comes from the shared dungeon layout (lampfallLayout(): generateDungeon(LAMPFALL_RECIPE)): room circles joined by
// straight corridors, pillars, rubble, the sealed arenas' lamp-gates, the exit stair and the lamp-lift. Nothing is
// placed by hand; cosmetic placements (lamps, debris, roots) are derived from the layout with an integer hash.
//
// The look: flat-shaded stone flags (PALETTE.stone shaded down, each room its own tint) and rough-cut walls in
// PALETTE.rock that rise and lean in deeper down (open to the sky at the rim, closing to a vault in the pit); warm
// lamp crystals on the walls every 8–12 m with warm pools under them; one hemispheric and one dim directional light,
// plus one warm light that follows the camera; a deep teal-violet fog from 25 m. The floor is kept light enough that
// telegraphs and fields read on every tier. The Lens Pit has a brass compass rose with the phase 2 and 3 fire-ring
// radii inlaid as faint rings, the fallen lamp-head at its centre and the lamp-lift (a brass cage) that rises after
// the kill. Each lamp-gate is a brass portcullis that drops while its gate is shut (state.gates), with its gate
// circle glowing on the floor. The sanctuaries are rings of small lanterns; the checkpoints a brass keeper's mark.
//
// Geometry is merged per material and per room (each room with the corridor leaving it is one chunk, for culling):
// lit, detail (debris, roots, light shafts: med and high only), glow (lamp crystals) and pools (additive).
// Pure parts (the plan and the geometry, in Builders) are tested without WebGL in lampfall.test.ts.
import {
  Vector3, Color3, Color4, StandardMaterial, DirectionalLight, HemisphericLight, PointLight,
  Scene, MeshBuilder, DynamicTexture, Mesh, type AbstractMesh, type ArcRotateCamera, type TransformNode, type Material,
} from '@babylonjs/core';
import {
  lampfallLayout, lampfallGates, SANCTUARY_R,
  type DungeonLayout, type DungeonRoom, type RoomId,
} from '@sg2/shared';
import type { WorldApi, AnchorName, Anchor, Quality } from '../core/contracts';
import { PALETTE } from '../core/contracts';
import { Builder, hex, mix, tint, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { WorldFxPlugin, WFX } from './shading';
import { createLook } from './look';
import { FIELD_LOOK } from '../combat/fields';
import { lampfallSurfaces, type LampfallLive } from './lampfallPlain';

// ───────────────────────── numbers ─────────────────────────

/** Wall height at the rim and in the deepest room, in m (deeper rooms have taller walls). */
export const WALL_H: [number, number] = [4.2, 6.0];
/** How far the wall tops lean in at the deepest room (the vault closing), in m; none at the rim. */
export const WALL_LEAN = 1.3;
/** Wall facet length range, in m (6–10 facets per 10 m). */
export const FACET_M: [number, number] = [1.0, 1.6];
/** Lamp crystals on the walls about every this many metres of wall. */
export const LAMP_EVERY_M = 10;
/** The floor flags' ring width and length, in m. */
const FLAG_RING = 1.9, FLAG_LEN = 2.1, FLAG_GAP = 0.07;
/** How far the drawn floor stands over the walk (flags) and the grout under it, in m. */
const FLAG_Y = 0.02;
/** Field radii (the Warden's phases 2 and 3) the compass inlays, in m. */
export const PIT_RINGS = [15, 12];
/** The gate portcullis's height and how far it lifts when open, in m. */
const GATE_H = 4.0, GATE_LIFT = 6.2;
/** An open portcullis fades out above this lift (it is drawn up into the rock; it must not hide the room from the camera), in m. */
const GATE_FADE_FROM = 3.2;
/** Budget (the brief): triangles and draw calls on med and low. */
export const LAMPFALL_BUDGET = { med: { tris: 70_000, draws: 70 }, low: { tris: 35_000, draws: 45 } };

// ───────────────────────── palette ─────────────────────────
const C = {
  stone: hex(PALETTE.stone), rock: hex(PALETTE.rock), gold: hex(PALETTE.gold), horizon: hex(PALETTE.horizon), teal: hex(PALETTE.teal), roof: hex(PALETTE.roof),
  slate: hex('#8d8498'), slateDark: hex('#4a4058'), brass: hex('#d49a3a'), brassDark: hex('#8f6328'), iron: hex('#3a3346'),
  root: hex('#5e3b2a'), root2: hex('#7d5136'), moss: hex('#5f9f5c'), lamp: PAL.lamp, cream: hex('#f6ead6'), hollow: hex('#1d1426'), crystal: hex('#9ff2ea'),
};
/** Per room: a slight tint on the floor flags (mixed into the shaded stone). */
const ROOM_TINT: Record<RoomId, RGB> = {
  rim: hex('#e8d9b0'), root_cellar: hex('#d8c4a4'), brass_gallery: hex('#e6cfa0'), cog_hall: hex('#d4c8b8'),
  wick_den: hex('#d8b49a'), landing: hex('#d6d0bc'), lens_pit: hex('#c4b8ae'),
};
/** The floor: the stone shaded down 25–35%, a room's tint mixed in. */
export const floorColour = (room: RoomId, k = 0.7): RGB => tint(mix(C.stone, ROOM_TINT[room], 0.35), k);

/** An integer hash of (x, y) in [0, 1): the same in every browser. */
export function hh(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 1024) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 1024) | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ───────────────────────── the plan (pure) ─────────────────────────

export interface WallPt { x: number; z: number; y: number }
/** A wall along a floor edge: points in order (facet corners), each with the floor height at its foot. */
export interface WallRun { chunk: number; kind: 'arc' | 'side'; ref: string; pts: WallPt[]; h: number; lean: number; out: [number, number][] }
export interface FloorPiece { kind: 'room' | 'corridor'; id: string; chunk: number }
export interface GatePlan { bit: number; encounter: string; x: number; z: number; y: number; ux: number; uz: number; width: number; chunk: number }
export interface LampPlan { x: number; z: number; y: number; nx: number; nz: number; chunk: number }
export type DebrisKind = 'gear' | 'rail' | 'lens' | 'block';
export interface DebrisPlan { kind: DebrisKind; x: number; z: number; y: number; yaw: number; s: number; chunk: number }
export interface RootPlan { x: number; z: number; y: number; len: number; nx: number; nz: number; chunk: number }
export interface LampfallPlan {
  layout: DungeonLayout;
  floors: FloorPiece[];
  walls: WallRun[];
  pillars: { x: number; z: number; r: number; h: number; y: number; chunk: number }[];
  rubble: { x: number; z: number; r: number; top: number; y: number; chunk: number }[];
  gates: GatePlan[];
  lamps: LampPlan[];
  debris: DebrisPlan[];
  roots: RootPlan[];
  sanctuaries: { x: number; z: number; r: number; y: number; chunk: number }[];
  checkpoints: { x: number; z: number; y: number; chunk: number }[];
  exitStair: { x: number; z: number; y: number; ux: number; uz: number; edge: number; chunk: number };
  lift: { x: number; z: number; r: number; y: number; chunk: number };
  compass: { x: number; z: number; y: number; r: number; chunk: number };
  chunks: number;
}

const depthK = (y: number) => Math.max(0, Math.min(1, -y / 18));
/** The point at yaw-angle a (x = sin a, z = cos a) r m from (x, z). */
const at = (x: number, z: number, a: number, r: number): [number, number] => [x + Math.sin(a) * r, z + Math.cos(a) * r];
const yaw = (dx: number, dz: number) => Math.atan2(dx, dz);
const wrap = (a: number) => { let t = a % (Math.PI * 2); if (t < 0) t += Math.PI * 2; return t; };

/** Which room (index) a point is in (the nearest centre whose circle holds it), else the nearest. */
function roomIndexAt(rooms: readonly DungeonRoom[], x: number, z: number): number {
  let best = 0, bd = Infinity;
  rooms.forEach((r, i) => { const d = Math.hypot(x - r.x, z - r.z) - r.r; if (d < bd) { bd = d; best = i; } });
  return best;
}

export function lampfallPlan(layout: DungeonLayout = lampfallLayout()): LampfallPlan {
  const { rooms, corridors, walk } = layout;
  const idx = new Map<RoomId, number>(rooms.map((r, i) => [r.id, i]));
  const hw = layout.recipe.corridor.width / 2;
  const floorAt = (x: number, z: number, fallback: number) => walk.floor(x, z) ?? fallback;
  const floors: FloorPiece[] = [
    ...rooms.map((r, i) => ({ kind: 'room' as const, id: r.id, chunk: i })),
    ...corridors.map((c, i) => ({ kind: 'corridor' as const, id: `${c.from}>${c.to}#${i}`, chunk: idx.get(c.from)! })),
  ];
  const wallH = (y: number) => WALL_H[0] + (WALL_H[1] - WALL_H[0]) * depthK(y);
  // the exit stair cuts a notch in the rim's wall
  const rim = rooms[0];
  const ex = layout.exitStair;
  const exDir = yaw(ex.x - rim.x, ex.z - rim.z);
  const STAIR_HALF = 1.7;

  // ── walls: an arc between each pair of neighbouring mouths in every room, two sides along every corridor ──
  const walls: WallRun[] = [];
  const facet = (seedA: number, seedB: number) => FACET_M[0] + (FACET_M[1] - FACET_M[0]) * hh(seedA, seedB);
  rooms.forEach((r, i) => {
    const mouths: { a: number; half: number }[] = [];
    for (const c of corridors) {
      if (c.from !== r.id && c.to !== r.id) continue;
      const other = rooms[idx.get(c.from === r.id ? c.to : c.from)!];
      mouths.push({ a: yaw(other.x - r.x, other.z - r.z), half: Math.asin(Math.min(1, hw / r.r)) });
    }
    if (i === 0) mouths.push({ a: exDir, half: Math.asin(Math.min(1, STAIR_HALF / r.r)) });
    mouths.sort((p, q) => wrap(p.a) - wrap(q.a));
    for (let k = 0; k < mouths.length; k++) {
      const m0 = mouths[k], m1 = mouths[(k + 1) % mouths.length];
      const a0 = wrap(m0.a) + m0.half;
      let a1 = wrap(m1.a) - m1.half;
      if (a1 <= a0) a1 += Math.PI * 2;
      const lenM = (a1 - a0) * r.r;
      const pts: WallPt[] = [], out: [number, number][] = [];
      let s = 0;
      const push = (a: number) => { const [x, z] = at(r.x, r.z, a, r.r); pts.push({ x, z, y: r.floorY }); out.push([Math.sin(a), Math.cos(a)]); };
      push(a0);
      while (true) {
        s += facet(r.x + s, r.z + k);
        if (s >= lenM - 0.5) break;
        push(a0 + s / r.r);
      }
      push(a1);
      walls.push({ chunk: i, kind: 'arc', ref: `${r.id}#${k}`, pts, h: wallH(r.floorY), lean: WALL_LEAN * depthK(r.floorY), out });
    }
  });
  corridors.forEach((c, ci) => {
    const A = rooms[idx.get(c.from)!], B = rooms[idx.get(c.to)!];
    const dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d, nx = uz, nz = -ux;
    const sA = Math.sqrt(A.r * A.r - hw * hw), sB = d - Math.sqrt(B.r * B.r - hw * hw);
    for (const sg of [1, -1]) {
      const pts: WallPt[] = [], out: [number, number][] = [];
      const push = (s: number) => {
        const x = A.x + ux * s + nx * sg * hw, z = A.z + uz * s + nz * sg * hw;
        // the floor at the wall's foot, sampled just inside the corridor (the walk's own floor)
        const y = floorAt(x - nx * sg * 0.12, z - nz * sg * 0.12, A.floorY);
        pts.push({ x, z, y }); out.push([nx * sg, nz * sg]);
      };
      push(sA);
      let s = sA;
      while (true) { s += facet(c.ax + s, sg + ci); if (s >= sB - 0.4) break; push(s); }
      push(sB);
      const yMid = (A.floorY + B.floorY) / 2;
      walls.push({ chunk: idx.get(c.from)!, kind: 'side', ref: `${c.from}>${c.to}#${ci}${sg > 0 ? '+' : '-'}`, pts, h: wallH(yMid), lean: WALL_LEAN * depthK(yMid) * 0.6, out });
    }
  });

  // ── obstacles, gates and the special places ──
  const pillars = layout.pillars.map((p) => ({ ...p, y: floorAt(p.x, p.z, 0), chunk: roomIndexAt(rooms, p.x, p.z) }));
  const rubble = layout.rubble.map((p) => ({ ...p, y: floorAt(p.x, p.z, 0), chunk: roomIndexAt(rooms, p.x, p.z) }));
  const gates: GatePlan[] = lampfallGates().map((g) => ({
    bit: g.bit, encounter: g.encounter, x: g.x, z: g.z, y: floorAt(g.x, g.z, 0), ux: g.ux, uz: g.uz, width: layout.recipe.corridor.width,
    chunk: roomIndexAt(rooms, g.room.x, g.room.z),
  }));

  // ── lamps on the walls, every LAMP_EVERY_M or so of wall ──
  const lamps: LampPlan[] = [];
  for (const w of walls) {
    let acc = LAMP_EVERY_M * (0.35 + 0.3 * hh(w.pts[0].x, w.pts[0].z));
    for (let k = 1; k < w.pts.length; k++) {
      const p = w.pts[k - 1], q = w.pts[k], seg = Math.hypot(q.x - p.x, q.z - p.z);
      acc += seg;
      if (acc < LAMP_EVERY_M * (0.8 + 0.4 * hh(q.x, q.z))) continue;
      acc = 0;
      const [ox, oz] = w.out[k];
      lamps.push({ x: (p.x + q.x) / 2, z: (p.z + q.z) / 2, y: (p.y + q.y) / 2, nx: -ox, nz: -oz, chunk: w.chunk });
    }
  }

  // ── brass debris from the Beacon near the walls, and roots hanging from the rim's and the cellar's wall tops ──
  const debris: DebrisPlan[] = [];
  const roots: RootPlan[] = [];
  const KINDS: DebrisKind[] = ['gear', 'rail', 'lens', 'block', 'gear', 'lens'];
  rooms.forEach((r, i) => {
    const n = Math.round(r.r * 0.55);
    for (let k = 0; k < n * 3 && debris.filter(d => d.chunk === i).length < n; k++) {
      const a = hh(r.x + k * 3.1, r.z - k) * Math.PI * 2, rr = r.r - 0.7 - 1.6 * hh(k, r.x);
      const [x, z] = at(r.x, r.z, a, rr);
      // keep the corridor mouths clear
      if (walk.floor(x + Math.sin(a) * 1.2, z + Math.cos(a) * 1.2) !== r.floorY) continue;
      debris.push({ kind: KINDS[(k + i) % KINDS.length], x, z, y: r.floorY, yaw: hh(x, z) * 6.283, s: 0.7 + 0.6 * hh(z, x), chunk: i });
    }
  });
  for (const w of walls) {
    if (!(w.ref.startsWith('rim') || w.ref.startsWith('root_cellar') || w.ref.startsWith('rim>'))) continue;
    for (let k = 0; k < w.pts.length; k++) {
      if (hh(w.pts[k].x * 1.3, w.pts[k].z) > 0.62) continue;
      const [ox, oz] = w.out[k];
      roots.push({ x: w.pts[k].x - ox * 0.25, z: w.pts[k].z - oz * 0.25, y: w.pts[k].y + w.h, len: 1.4 + 2.2 * hh(w.pts[k].z, k), nx: -ox, nz: -oz, chunk: w.chunk });
    }
  }

  const sanctuaries = rooms.filter(r => r.sanctuary).map((r) => ({ x: r.sanctuary!.x, z: r.sanctuary!.z, r: r.sanctuary!.r ?? SANCTUARY_R, y: r.floorY, chunk: idx.get(r.id)! }));
  const checkpoints = rooms.filter(r => r.checkpoint).map((r) => ({ x: r.x, z: r.z, y: r.floorY, chunk: idx.get(r.id)! }));
  const exLen = Math.hypot(ex.x - rim.x, ex.z - rim.z) || 1;
  const exitStair = { x: ex.x, z: ex.z, y: rim.floorY, ux: (ex.x - rim.x) / exLen, uz: (ex.z - rim.z) / exLen, edge: rim.r, chunk: 0 };
  const pitI = rooms.findIndex(r => r.id === 'lens_pit');
  const pit = rooms[pitI];
  const lift = { x: layout.lampLift.x, z: layout.lampLift.z, r: layout.lampLift.r, y: pit.floorY, chunk: pitI };
  const compass = { x: pit.x, z: pit.z, y: pit.floorY, r: pit.r, chunk: pitI };
  return { layout, floors, walls, pillars, rubble, gates, lamps, debris, roots, sanctuaries, checkpoints, exitStair, lift, compass, chunks: rooms.length };
}

// ───────────────────────── geometry (pure: into Builders) ─────────────────────────

/** Per chunk: lit (floors, walls, pillars, rubble, fixtures), detail (debris, roots), glow (crystals), pools and shafts of light (additive; shafts med and high only). */
export interface ChunkGeo { lit: Builder; detail: Builder; glow: Builder; pool: Builder; shaft: Builder }
export interface LampfallGeo {
  chunks: ChunkGeo[];
  /** Per gate: the portcullis (local space: x across, y up, z along the way in) and its glowing gate circle (world). */
  gates: { bars: Builder; seal: Builder }[];
  /** The lamp-lift cage (local space, its foot at the origin) and its lamp. */
  lift: { cage: Builder; glow: Builder };
}

/** Builds every mesh's geometry from the plan (no WebGL). */
export function lampfallGeometry(plan: LampfallPlan): LampfallGeo {
  const L = plan.layout;
  const chunks: ChunkGeo[] = Array.from({ length: plan.chunks }, (_, i) => {
    const g = { lit: new Builder(900 + i), detail: new Builder(950 + i), glow: new Builder(980 + i), pool: new Builder(990 + i), shaft: new Builder(1100 + i) };
    g.glow.cj = 0; g.pool.cj = 0; g.shaft.cj = 0;
    return g;
  });
  L.rooms.forEach((r, i) => roomFloor(chunks[i].lit, r, i === plan.compass.chunk));
  L.corridors.forEach((c, ci) => corridorFloor(chunks[plan.floors[L.rooms.length + ci].chunk].lit, plan, ci));
  for (const w of plan.walls) wallRun(chunks[w.chunk].lit, w);
  for (const p of plan.pillars) pillar(chunks[p.chunk].lit, p);
  for (const p of plan.rubble) rubbleBlock(chunks[p.chunk].lit, p);
  for (const l of plan.lamps) lampFixture(chunks[l.chunk], l);
  for (const d of plan.debris) debrisPiece(chunks[d.chunk], d);
  for (const r of plan.roots) hangingRoot(chunks[r.chunk].detail, r);
  for (const s of plan.sanctuaries) sanctuaryRing(chunks[s.chunk], s);
  for (const c of plan.checkpoints) keeperMark(chunks[c.chunk], c);
  exitStair(chunks[plan.exitStair.chunk], plan);
  pitCentre(chunks[plan.compass.chunk], plan);
  for (const g of plan.gates) gateFrame(chunks[g.chunk].lit, g);
  const gates = plan.gates.map((g) => { const bars = new Builder(1200 + g.bit), seal = new Builder(1300 + g.bit); seal.cj = 0; portcullis(bars, g.width); gateSeal(seal, g, L); return { bars, seal }; });
  const lift = { cage: new Builder(1400), glow: new Builder(1401) }; lift.glow.cj = 0;
  liftCage(lift.cage, lift.glow, plan.lift.r);
  return { chunks, gates, lift };
}

/** Triangles of the geometry on a tier (low draws no detail). */
export function lampfallTriangles(geo: LampfallGeo, q: Quality): number {
  let n = 0;
  for (const c of geo.chunks) n += c.lit.tris + c.glow.tris + c.pool.tris + (q === 'low' ? 0 : c.detail.tris + c.shaft.tris);
  for (const g of geo.gates) n += g.bars.tris + g.seal.tris;
  return n + geo.lift.cage.tris + geo.lift.glow.tris;
}

// ── floors ──
function roomFloor(b: Builder, r: DungeonRoom, pit: boolean) {
  const base = tint(floorColour(r.id), 0.62);
  // the grout: a disc a little lower than the flags, a hair wider than the room (the corridor ends meet it)
  const nB = Math.max(24, Math.ceil(r.r * 4));
  b.withHint('up', () => {
    for (let j = 0; j < nB; j++) {
      const [x0, z0] = at(r.x, r.z, (j / nB) * Math.PI * 2, r.r + 0.08), [x1, z1] = at(r.x, r.z, ((j + 1) / nB) * Math.PI * 2, r.r + 0.08);
      b.triW([r.x, r.floorY, r.z], [x0, r.floorY, z0], [x1, r.floorY, z1], base, base, base, 'up');
    }
  });
  // flags in rings (the Lens Pit's middle is left for the lamp-head)
  const y = r.floorY + FLAG_Y;
  const r0 = pit ? 2.6 : 0;
  const nRings = Math.max(1, Math.round((r.r - r0) / FLAG_RING));
  for (let k = 0; k < nRings; k++) {
    const ra = r0 + ((r.r - r0) * k) / nRings, rb = r0 + ((r.r - r0) * (k + 1)) / nRings;
    const mid = (ra + rb) / 2, n = Math.max(5, Math.round((Math.PI * 2 * mid) / FLAG_LEN));
    const off = hh(r.x + k, r.z) * Math.PI * 2;
    for (let j = 0; j < n; j++) {
      const a0 = off + (j / n) * Math.PI * 2, a1 = off + ((j + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const ga = FLAG_GAP / Math.max(0.5, mid);
      const rA = ra === 0 ? 0 : ra + FLAG_GAP, rB = rb - FLAG_GAP;
      const v = hh(r.x + j * 1.7, r.z + k * 2.3);
      const col = floorColour(r.id, 0.66 + 0.09 * v);
      const P = (a: number, rr: number): V3 => { const [x, z] = at(r.x, r.z, a, rr); return [x, y, z]; };
      if (rA === 0) b.triW(P(am, 0), P(a0 + ga * 2, rB), P(a1 - ga * 2, rB), col, col, col, 'up');
      else {
        // two segments along the arc so a long flag still follows the circle
        const p0 = P(a0 + ga, rA), p1 = P(am, rA), p2 = P(a1 - ga, rA), q0 = P(a0 + ga, rB), q1 = P(am, rB), q2 = P(a1 - ga, rB);
        b.triW(p0, q0, q1, col, col, col, 'up'); b.triW(p0, q1, p1, col, col, col, 'up');
        b.triW(p1, q1, q2, col, col, col, 'up'); b.triW(p1, q2, p2, col, col, col, 'up');
      }
    }
  }
}

function corridorFloor(b: Builder, plan: LampfallPlan, ci: number) {
  const L = plan.layout, c = L.corridors[ci], walk = L.walk;
  const A = L.rooms.find(r => r.id === c.from)!, B = L.rooms.find(r => r.id === c.to)!;
  const ex = c.bx - c.ax, ez = c.bz - c.az, len = Math.hypot(ex, ez), ux = ex / len, uz = ez / len, nx = uz, nz = -ux;
  const hw = c.w / 2;
  const fy = (s: number, l: number, fb: number) => walk.floor(c.ax + ux * s + nx * l, c.az + uz * s + nz * l) ?? fb;
  // row boundaries along the corridor: every metre, plus every terrace edge (found by sampling the walk's floor)
  const S = [0];
  const edges: number[] = [];
  let prev = fy(0.02, 0, c.ay);
  for (let s = 0.05; s < len; s += 0.05) { const y = fy(s, 0, prev); if (Math.abs(y - prev) > 0.3) edges.push(s - 0.025); prev = y; }
  for (let s = 1; s < len - 0.3; s += 1) if (!edges.some(e => Math.abs(e - s) < 0.4)) S.push(s);
  S.push(...edges); S.push(len); S.sort((p, q) => p - q);
  const tintC = floorColour(A.id, 0.66), tintD = floorColour(B.id, 0.66);
  const nW = 6;
  const lip = tint(mix(C.stone, C.cream, 0.4), 0.92);
  for (let j = 0; j < nW; j++) {
    const l0 = -hw + (c.w * j) / nW, l1 = -hw + (c.w * (j + 1)) / nW;
    // the ends follow the room circles (no gap and no overlap with the room's floor)
    const sA0 = Math.sqrt(Math.max(0, A.r * A.r - l0 * l0)) - A.r, sA1 = Math.sqrt(Math.max(0, A.r * A.r - l1 * l1)) - A.r;
    const sB0 = len + B.r - Math.sqrt(Math.max(0, B.r * B.r - l0 * l0)), sB1 = len + B.r - Math.sqrt(Math.max(0, B.r * B.r - l1 * l1));
    for (let i = 0; i < S.length - 1; i++) {
      const s0 = S[i], s1 = S[i + 1];
      const a0 = i === 0 ? sA0 : s0, a1 = i === 0 ? sA1 : s0, b0 = i === S.length - 2 ? sB0 : s1, b1 = i === S.length - 2 ? sB1 : s1;
      const ya = fy(s0 + 0.012, 0, c.ay) + FLAG_Y, yb = fy(s1 - 0.012, 0, c.by) + FLAG_Y;
      const t = (s0 + s1) / 2 / len, v = hh(c.ax + i, j + ci);
      const col = tint(mix(tintC, tintD, t), 0.92 + 0.14 * v);
      const P = (s: number, l: number, y: number): V3 => [c.ax + ux * s + nx * l, y, c.az + uz * s + nz * l];
      const g = 0.035;
      b.triW(P(a0 + g, l0 + g, ya), P(b0 - g, l0 + g, yb), P(b1 - g, l1 - g, yb), col, col, col, 'up');
      b.triW(P(a0 + g, l0 + g, ya), P(b1 - g, l1 - g, yb), P(a1 + g, l1 - g, ya), col, col, col, 'up');
      // the grout under the gaps
      const gr = tint(tintC, 0.6);
      b.triW(P(a0, l0, ya - FLAG_Y), P(b0, l0, yb - FLAG_Y), P(b1, l1, yb - FLAG_Y), gr, gr, gr, 'up');
      b.triW(P(a0, l0, ya - FLAG_Y), P(b1, l1, yb - FLAG_Y), P(a1, l1, ya - FLAG_Y), gr, gr, gr, 'up');
      // a terrace edge: the riser and a lighter lip on the upper step, so the climb reads on a phone
      if (i < S.length - 2) {
        const yn = fy(s1 + 0.012, 0, yb);
        if (Math.abs(yn - (yb - FLAG_Y)) > 0.3) {
          const hi = Math.max(yb, yn + FLAG_Y), lo = Math.min(yb, yn + FLAG_Y) - FLAG_Y;
          const riser = tint(floorColour(A.id), 0.48);
          b.triW(P(s1, l0, lo), P(s1, l1, lo), P(s1, l1, hi), riser, riser, riser, P(s1 + (yn < yb ? -1 : 1), 0, (hi + lo) / 2));
          b.triW(P(s1, l0, lo), P(s1, l1, hi), P(s1, l0, hi), riser, riser, riser, P(s1 + (yn < yb ? -1 : 1), 0, (hi + lo) / 2));
          const up = yn < yb ? -1 : 1, lw = 0.28;
          b.triW(P(s1, l0, hi + 0.012), P(s1 + up * lw, l0, hi + 0.012), P(s1 + up * lw, l1, hi + 0.012), lip, lip, lip, 'up');
          b.triW(P(s1, l0, hi + 0.012), P(s1 + up * lw, l1, hi + 0.012), P(s1, l1, hi + 0.012), lip, lip, lip, 'up');
        }
      }
    }
  }
  // ramps: a lighter lip across every 1.6 m, so the slope reads
  if (c.steps === 0 && Math.abs(c.by - c.ay) > 0.2) {
    for (let s = 1.6; s < len - 0.8; s += 1.6) {
      const y = fy(s, 0, c.ay) + FLAG_Y + 0.012, y2 = fy(s + 0.22, 0, c.ay) + FLAG_Y + 0.012;
      const P = (ss: number, l: number, yy: number): V3 => [c.ax + ux * ss + nx * l, yy, c.az + uz * ss + nz * l];
      b.triW(P(s, -hw, y), P(s + 0.22, -hw, y2), P(s + 0.22, hw, y2), lip, lip, lip, 'up');
      b.triW(P(s, -hw, y), P(s + 0.22, hw, y2), P(s, hw, y), lip, lip, lip, 'up');
    }
  }
}

// ── walls ──
function wallRun(b: Builder, w: WallRun) {
  const rockA = mix(C.rock, C.slate, 0.5), rockB = mix(C.rock, C.slateDark, 0.55);
  const n = w.pts.length;
  const top: V3[] = [], foot: V3[] = [], mid: V3[] = [], lip: V3[] = [];
  for (let k = 0; k < n; k++) {
    const p = w.pts[k], [ox, oz] = w.out[k];
    const j = (hh(p.x * 0.7, p.z * 1.3) - 0.5) * 0.36;          // rough-cut: each facet corner set in or out a little
    const ht = w.h * (0.9 + 0.22 * hh(p.z, p.x));
    const lean = w.lean * (0.8 + 0.4 * hh(p.x, k));
    foot.push([p.x + ox * j, p.y - 0.25, p.z + oz * j]);
    mid.push([p.x + ox * (j - lean * 0.25), p.y + ht * 0.55, p.z + oz * (j - lean * 0.25)]);
    top.push([p.x + ox * (j - lean), p.y + ht, p.z + oz * (j - lean)]);
    lip.push([p.x + ox * (j - lean * 0.92), p.y + ht * 0.93, p.z + oz * (j - lean * 0.92)]);
  }
  for (let k = 0; k < n - 1; k++) {
    const p = w.pts[k], q = w.pts[k + 1];
    const [ox, oz] = w.out[k];
    const hint: V3 = [(p.x + q.x) / 2 + ox * 6, (p.y + q.y) / 2 + w.h * 0.4, (p.z + q.z) / 2 + oz * 6];
    const v = hh(p.x + 0.5, p.z - 0.5);
    // single-sided, facing into the room: from outside (the camera behind a near wall) it is not drawn at all
    const lo = tint(rockA, 0.9 + 0.2 * v), hi = tint(rockB, 0.8 + 0.2 * v), edge = tint(rockB, 0.55);
    b.triW(foot[k], foot[k + 1], mid[k + 1], lo, lo, mix(lo, hi, 0.5), hint); b.triW(foot[k], mid[k + 1], mid[k], lo, mix(lo, hi, 0.5), mix(lo, hi, 0.5), hint);
    b.triW(mid[k], mid[k + 1], lip[k + 1], mix(lo, hi, 0.5), mix(lo, hi, 0.5), hi, hint); b.triW(mid[k], lip[k + 1], lip[k], mix(lo, hi, 0.5), hi, hi, hint);
    b.triW(lip[k], lip[k + 1], top[k + 1], edge, edge, edge, hint); b.triW(lip[k], top[k + 1], top[k], edge, edge, edge, hint);
  }
}

// ── obstacles ──
function pillar(b: Builder, p: LampfallPlan['pillars'][number]) {
  const sides = 8, col = mix(C.stone, C.slate, 0.45), dark = tint(col, 0.7);
  b.push();
  b.withHint([p.x, p.y + 1, p.z], () => {
    b.prism([p.x, p.y, p.z], [p.x, p.y + 0.4, p.z], p.r * 1.12, p.r * 1.08, sides, dark, { rot: 0.2 });   // plinth
    b.prism([p.x, p.y + 0.4, p.z], [p.x, p.y + p.h * 0.55, p.z], p.r * 0.92, p.r * 0.88, sides, col, { rot: 0.2, caps: false });
    b.prism([p.x, p.y + p.h * 0.55, p.z], [p.x, p.y + p.h * 0.6, p.z], p.r * 0.97, p.r * 0.97, sides, dark, { rot: 0.2, caps: false });
  });
  // the broken top: a jagged crown of the shaft's last drum
  const y0 = p.y + p.h * 0.6, rr = p.r * 0.86;
  for (let k = 0; k < sides; k++) {
    const a0 = 0.2 + (k / sides) * Math.PI * 2, a1 = 0.2 + ((k + 1) / sides) * Math.PI * 2;
    const h0 = p.h * (0.82 + 0.18 * hh(p.x + k, p.z)), h1 = p.h * (0.82 + 0.18 * hh(p.x + k + 1, p.z));
    const [x0, z0] = at(p.x, p.z, a0, rr), [x1, z1] = at(p.x, p.z, a1, rr);
    const hint: V3 = [p.x, y0, p.z];
    b.triW([x0, y0, z0], [x1, y0, z1], [x1, p.y + h1, z1], col, col, tint(col, 1.08), hint);
    b.triW([x0, y0, z0], [x1, p.y + h1, z1], [x0, p.y + h0, z0], col, tint(col, 1.08), tint(col, 1.08), hint);
    b.triW([x0, p.y + h0, z0], [x1, p.y + h1, z1], [p.x, p.y + p.h * 0.78, p.z], tint(col, 1.12), tint(col, 1.12), tint(col, 0.95), 'up');
  }
  // a crack down the shaft
  const ca = hh(p.z, p.x) * Math.PI * 2, [cx, cz] = at(p.x, p.z, ca, p.r * 0.93);
  b.prism([cx, p.y + p.h * 0.75, cz], [cx + 0.05, p.y + 0.9, cz + 0.05], 0.04, 0.03, 3, C.hollow, { caps: false });
  b.pop();
}

function rubbleBlock(b: Builder, p: LampfallPlan['rubble'][number]) {
  const h = p.top - p.y, col = mix(C.stone, C.slate, 0.35), topC = tint(mix(C.stone, C.cream, 0.3), 0.9);
  const yaw0 = hh(p.x, p.z) * 6.283;
  b.push(); b.T(p.x, p.y, p.z); b.RY(yaw0);
  // stacked blocks: a wide footing, a top slab with a flat light top (it reads as something to climb on)
  const r = p.r;
  b.taperBox([0, -0.1, 0], r * 1.75, r * 1.55, [0, h * 0.55, 0], r * 1.7, r * 1.5, tint(col, 0.8), tint(col, 0.9));
  b.taperBox([0.08 * r, h * 0.5, -0.05 * r], r * 1.6, r * 1.42, [0.06 * r, h, -0.04 * r], r * 1.55, r * 1.38, col, topC);
  b.box(-0.55 * r, 0.12, 0.62 * r, 0.5, 0.3, 0.45, tint(col, 0.75));
  b.pop();
}

// ── fixtures ──
function lampFixture(g: ChunkGeo, l: LampPlan) {
  const b = g.lit, y = l.y + 2.5, x = l.x + l.nx * 0.15, z = l.z + l.nz * 0.15;
  b.prism([l.x - l.nx * 0.2, y - 0.1, l.z - l.nz * 0.2], [x + l.nx * 0.35, y - 0.25, z + l.nz * 0.35], 0.07, 0.06, 4, C.brassDark);
  b.prism([x + l.nx * 0.35, y - 0.38, z + l.nz * 0.35], [x + l.nx * 0.35, y - 0.25, z + l.nz * 0.35], 0.16, 0.11, 6, C.brass);
  // the crystal: a warm faceted point (gold or horizon)
  const cx = x + l.nx * 0.35, cz = z + l.nz * 0.35, warm = hh(l.x, l.z) < 0.5 ? C.gold : C.horizon;
  g.glow.withHint([cx, y, cz], () => {
    const top: V3 = [cx, y + 0.42, cz], bot: V3 = [cx, y - 0.28, cz];
    for (let k = 0; k < 5; k++) {
      const a0 = (k / 5) * Math.PI * 2, a1 = ((k + 1) / 5) * Math.PI * 2;
      const p0: V3 = [cx + Math.sin(a0) * 0.16, y, cz + Math.cos(a0) * 0.16], p1: V3 = [cx + Math.sin(a1) * 0.16, y, cz + Math.cos(a1) * 0.16];
      g.glow.tri(p0, p1, top, warm, warm, C.lamp); g.glow.tri(p1, p0, bot, tint(warm, 0.8), tint(warm, 0.8), warm);
    }
  });
  // its warm pool on the floor and the wall
  pool(g.pool, cx + l.nx * 1.0, l.y + 0.05, cz + l.nz * 1.0, 3.4, tint(warm, 0.3));
}

/** A soft additive disc (vertex colour falls off to black at the edge). */
function pool(b: Builder, x: number, y: number, z: number, r: number, col: RGB) {
  const n = 14, black: RGB = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const [x0, z0] = at(x, z, (k / n) * Math.PI * 2, r), [x1, z1] = at(x, z, ((k + 1) / n) * Math.PI * 2, r);
    const [m0, n0] = at(x, z, (k / n) * Math.PI * 2, r * 0.45), [m1, n1] = at(x, z, ((k + 1) / n) * Math.PI * 2, r * 0.45);
    const mid = tint(col, 0.55);
    b.triW([x, y, z], [m0, y, n0], [m1, y, n1], col, mid, mid, 'up');
    b.triW([m0, y, n0], [x0, y, z0], [x1, y, z1], mid, black, black, 'up');
    b.triW([m0, y, n0], [x1, y, z1], [m1, y, n1], mid, black, mid, 'up');
  }
}

function debrisPiece(g: ChunkGeo, d: DebrisPlan) {
  const b = g.detail;
  b.push(); b.T(d.x, d.y, d.z); b.RY(d.yaw); b.SC(d.s);
  if (d.kind === 'gear') {
    // a fallen gear, tipped against nothing: a toothed brass disc lying flat
    b.RX(0.12);
    b.prism([0, 0.0, 0], [0, 0.12, 0], 0.55, 0.55, 10, C.brassDark, { capB: C.brass });
    for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.box(Math.sin(a) * 0.62, 0.06, Math.cos(a) * 0.62, 0.14, 0.11, 0.14, C.brass); }
    b.prism([0, 0.12, 0], [0, 0.16, 0], 0.16, 0.16, 6, C.iron);
  } else if (d.kind === 'rail') {
    b.prism([-0.9, 0.06, 0], [0, 0.18, 0.3], 0.05, 0.05, 4, C.brass);
    b.prism([0, 0.18, 0.3], [0.85, 0.07, 0.05], 0.05, 0.05, 4, C.brass);
    for (const x of [-0.6, 0.0, 0.55]) b.prism([x, 0.02, x * 0.2], [x, 0.36, x * 0.2 + 0.1], 0.03, 0.03, 3, C.brassDark);
  } else if (d.kind === 'lens') {
    // lens fragments that glint
    b.box(0, 0.05, 0, 0.5, 0.1, 0.34, C.brassDark);
    g.glow.push(); g.glow.M = b.M;
    for (let k = 0; k < 3; k++) {
      const a = k * 2.1, r = 0.25 + 0.15 * k;
      g.glow.tri([Math.sin(a) * r, 0.04, Math.cos(a) * r], [Math.sin(a + 0.5) * r + 0.12, 0.3, Math.cos(a + 0.5) * r], [Math.sin(a + 1) * r, 0.04, Math.cos(a + 1) * r], C.crystal, C.cream, C.crystal);
    }
    g.glow.pop();
  } else {
    b.taperBox([0, 0, 0], 0.7, 0.55, [0.05, 0.38, 0], 0.6, 0.45, tint(C.slate, 0.8), tint(C.slate, 0.95));
    b.taperBox([0.55, 0, 0.3], 0.35, 0.3, [0.55, 0.2, 0.3], 0.3, 0.26, tint(C.slate, 0.75));
  }
  b.pop();
}

function hangingRoot(b: Builder, r: RootPlan) {
  // a tapering strip hanging down the wall's face, facing into the room (culled with the wall seen from behind)
  const col = hh(r.x, r.z) < 0.5 ? C.root : C.root2, n = 5, tx = -r.nz, tz = r.nx;
  const hint: V3 = [r.x - r.nx * 4, r.y - r.len / 2, r.z - r.nz * 4];
  let prev: [V3, V3] | null = null;
  for (let k = 0; k <= n; k++) {
    const t = k / n, sway = Math.sin(t * 3.1 + r.x) * 0.22 * t, w = 0.12 * (1 - t * 0.85), off = 0.08 + 0.06 * t;
    const cx = r.x + r.nx * off + tx * sway, cz = r.z + r.nz * off + tz * sway, y = r.y - r.len * t;
    const pair: [V3, V3] = [[cx - tx * w, y, cz - tz * w], [cx + tx * w, y, cz + tz * w]];
    if (prev) { b.triW(prev[0], prev[1], pair[1], col, col, col, hint); b.triW(prev[0], pair[1], pair[0], col, col, col, hint); }
    prev = pair;
  }
  if (hh(r.z, r.x) < 0.3) { const y = r.y - 0.25; b.triW([r.x + r.nx * 0.1 - tx * 0.35, y + 0.2, r.z + r.nz * 0.1 - tz * 0.35], [r.x + r.nx * 0.1 + tx * 0.35, y + 0.2, r.z + r.nz * 0.1 + tz * 0.35], [r.x + r.nx * 0.12, y - 0.35, r.z + r.nz * 0.12], C.moss, C.moss, tint(C.moss, 0.8), hint); }
}

function sanctuaryRing(g: ChunkGeo, s: LampfallPlan['sanctuaries'][number]) {
  const n = 12;
  // a faint inlaid ring of pale stone marks the circle
  const y = s.y + FLAG_Y + 0.012, ring = tint(mix(C.teal, C.cream, 0.55), 0.95);
  for (let k = 0; k < 48; k++) {
    const a0 = (k / 48) * Math.PI * 2, a1 = ((k + 1) / 48) * Math.PI * 2;
    const [x0, z0] = at(s.x, s.z, a0, s.r - 0.09), [x1, z1] = at(s.x, s.z, a1, s.r - 0.09), [x2, z2] = at(s.x, s.z, a1, s.r + 0.09), [x3, z3] = at(s.x, s.z, a0, s.r + 0.09);
    g.lit.triW([x0, y, z0], [x1, y, z1], [x2, y, z2], ring, ring, ring, 'up'); g.lit.triW([x0, y, z0], [x2, y, z2], [x3, y, z3], ring, ring, ring, 'up');
  }
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.13, [x, z] = at(s.x, s.z, a, s.r);
    g.lit.prism([x, s.y, z], [x, s.y + 0.22, z], 0.17, 0.14, 6, tint(C.slate, 0.85), { capB: C.brassDark });
    g.lit.prism([x, s.y + 0.22, z], [x, s.y + 0.3, z], 0.11, 0.1, 6, C.brass);
    g.glow.ball([x, s.y + 0.42, z], 0.12, k % 2 ? C.lamp : mix(C.lamp, C.teal, 0.35), 0.85, 1.25, 0.85, 0);
    g.lit.prism([x, s.y + 0.55, z], [x, s.y + 0.66, z], 0.12, 0.02, 6, C.roof);
    pool(g.pool, x, s.y + 0.05, z, 1.3, tint(C.lamp, 0.12));
  }
}

function keeperMark(g: ChunkGeo, c: LampfallPlan['checkpoints'][number]) {
  // a brass eight-point star set into the floor, a glowing gem at its heart
  const y = c.y + FLAG_Y + 0.015;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, l = k % 2 ? 0.9 : 1.5, w = 0.28;
    const [tx, tz] = at(c.x, c.z, a, l), [lx, lz] = at(c.x, c.z, a - Math.PI / 2, w), [rx, rz] = at(c.x, c.z, a + Math.PI / 2, w);
    g.lit.triW([lx, y, lz], [tx, y, tz], [rx, y, rz], k % 2 ? C.brassDark : C.brass, C.gold, k % 2 ? C.brassDark : C.brass, 'up');
  }
  g.glow.prism([c.x, y, c.z], [c.x, y + 0.06, c.z], 0.3, 0.24, 6, C.lamp);
  pool(g.pool, c.x, y + 0.01, c.z, 2.2, tint(C.lamp, 0.18));
}

function exitStair(g: ChunkGeo, plan: LampfallPlan) {
  const e = plan.exitStair, b = g.lit;
  const rim = plan.layout.rooms[0];
  const nx = e.uz, nz = -e.ux, w = 1.65;
  const foot = rim.r - 0.3;
  const steps = 12, rise = 0.33, run = 0.48;
  const P = (s: number, l: number, y: number): V3 => [rim.x + e.ux * s + nx * l, y, rim.z + e.uz * s + nz * l];
  const stepC = tint(floorColour('rim'), 0.95), lip = tint(mix(C.stone, C.cream, 0.4), 0.95), riser = tint(floorColour('rim'), 0.55);
  for (let k = 0; k < steps; k++) {
    const s0 = foot + k * run, s1 = s0 + run, y = rim.floorY + (k + 1) * rise;
    const hint: V3 = P(s0 - 2, 0, y - rise / 2);
    b.triW(P(s0, -w, y - rise), P(s0, w, y - rise), P(s0, w, y), riser, riser, riser, hint); b.triW(P(s0, -w, y - rise), P(s0, w, y), P(s0, -w, y), riser, riser, riser, hint);
    b.triW(P(s0, -w, y), P(s0, w, y), P(s1, w, y), lip, lip, stepC, 'up'); b.triW(P(s0, -w, y), P(s1, w, y), P(s1, -w, y), lip, stepC, stepC, 'up');
  }
  // the cheek walls up the stair, and the crater lip it climbs out by
  const top = rim.floorY + steps * rise, end = foot + steps * run + 1.5;
  for (const sg of [1, -1]) {
    const l = sg * (w + 0.05);
    const wallC = mix(C.rock, C.slate, 0.3);
    const hint: V3 = P((foot + end) / 2, sg * 6, 2);
    b.triW(P(foot - 0.3, l, -0.2), P(end, l, -0.2), P(end, l, top + 1.6), wallC, wallC, tint(wallC, 0.75), hint);
    b.triW(P(foot - 0.3, l, -0.2), P(end, l, top + 1.6), P(foot - 0.3, l, plan.walls[0].h), wallC, tint(wallC, 0.75), tint(wallC, 0.75), hint);
  }
  b.triW(P(foot + steps * run, -w, top), P(foot + steps * run, w, top), P(end, w, top), stepC, stepC, stepC, 'up');
  b.triW(P(foot + steps * run, -w, top), P(end, w, top), P(end, -w, top), stepC, stepC, stepC, 'up');
  // daylight spilling down the stair from the Greenway above (a soft additive shaft), and a lamp at the top
  shaft(g.shaft, P(end, 0, top + 6), P(foot + 1, 0, rim.floorY), 2.4, tint(mix(C.horizon, C.cream, 0.6), 0.14));
  g.glow.ball(P(end - 0.6, w - 0.2, top + 1.2), 0.2, C.lamp, 1, 1.3, 1, 0);
  // the rim is open to the sky: two more shafts of daylight falling into it
  shaft(g.shaft, [rim.x - 3, rim.floorY + 14, rim.z + 5], [rim.x + 1.5, rim.floorY, rim.z + 1], 2.2, tint(mix(C.horizon, C.cream, 0.6), 0.11));
  shaft(g.shaft, [rim.x + 4, rim.floorY + 14, rim.z - 6], [rim.x + 2, rim.floorY, rim.z - 2.5], 1.6, tint(mix(C.horizon, C.cream, 0.6), 0.08));
}

/** A shaft of light: two crossed additive quads from `a` (bright) down to `b` (faded), `w` wide. */
function shaft(b: Builder, a: V3, c: V3, w: number, col: RGB) {
  const black: RGB = [0, 0, 0];
  for (const [dx, dz] of [[1, 0], [0, 1]] as const) {
    const o: V3 = [dx * w / 2, 0, dz * w / 2];
    b.triW([a[0] - o[0], a[1], a[2] - o[2]], [a[0] + o[0], a[1], a[2] + o[2]], [c[0] + o[0] * 1.6, c[1], c[2] + o[2] * 1.6], col, col, black, null);
    b.triW([a[0] - o[0], a[1], a[2] - o[2]], [c[0] + o[0] * 1.6, c[1], c[2] + o[2] * 1.6], [c[0] - o[0] * 1.6, c[1], c[2] - o[2] * 1.6], col, black, black, null);
  }
}

function pitCentre(g: ChunkGeo, plan: LampfallPlan) {
  const c = plan.compass, b = g.lit, y = c.y + FLAG_Y + 0.02;
  const ring = (r: number, w: number, col: RGB, n = 96, yy = y) => {
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const [x0, z0] = at(c.x, c.z, a0, r - w / 2), [x1, z1] = at(c.x, c.z, a1, r - w / 2), [x2, z2] = at(c.x, c.z, a1, r + w / 2), [x3, z3] = at(c.x, c.z, a0, r + w / 2);
      b.triW([x0, yy, z0], [x1, yy, z1], [x2, yy, z2], col, col, col, 'up'); b.triW([x0, yy, z0], [x2, yy, z2], [x3, yy, z3], col, col, col, 'up');
    }
  };
  // the compass rose: eight brass points, long at the quarters, with a ring at the edge and degree ticks
  for (let k = 0; k < 8; k++) {
    // a dull, dark bronze inlay: it must never be mistaken for a telegraph
    const a = (k / 8) * Math.PI * 2, l = k % 2 ? 5.5 : 8.5;
    const [tx, tz] = at(c.x, c.z, a, l), [lx, lz] = at(c.x, c.z, a - 0.32, 3.0), [rx, rz] = at(c.x, c.z, a + 0.32, 3.0);
    const [mx, mz] = at(c.x, c.z, a, 2.7);
    const lite = tint(mix(C.brassDark, C.slate, 0.35), k % 2 ? 0.62 : 0.78), dark = tint(lite, 0.72);
    b.triW([lx, y, lz], [tx, y, tz], [mx, y, mz], lite, lite, lite, 'up');
    b.triW([mx, y, mz], [tx, y, tz], [rx, y, rz], dark, dark, dark, 'up');
  }
  ring(c.r - 0.9, 0.22, tint(C.brassDark, 0.75));
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2, [x0, z0] = at(c.x, c.z, a, c.r - 1.7), [x1, z1] = at(c.x, c.z, a, c.r - (k % 4 ? 1.25 : 1.0));
    const [px, pz] = at(0, 0, a + Math.PI / 2, 0.07);
    const tc = tint(C.brassDark, 0.7);
    b.triW([x0 - px, y, z0 - pz], [x1 - px, y, z1 - pz], [x1 + px, y, z1 + pz], tc, tc, tc, 'up');
    b.triW([x0 - px, y, z0 - pz], [x1 + px, y, z1 + pz], [x0 + px, y, z0 + pz], tc, tc, tc, 'up');
  }
  // the phase 2 and 3 fire-ring radii, faint: the safe floor shrinks to these
  for (const r of PIT_RINGS) ring(r, 0.14, tint(mix(C.brassDark, C.slate, 0.3), 0.8));
  // the fallen lamp-head, sunk into the floor at the centre (low enough to stand on), and the lift's hatch ring
  ring(plan.lift.r + 0.1, 0.18, C.iron);
  b.prism([c.x, c.y - 0.05, c.z], [c.x, c.y + 0.16, c.z], 2.5, 2.4, 16, C.brassDark, { capB: tint(C.iron, 1.2), caps: true });
  b.prism([c.x, c.y + 0.16, c.z], [c.x, c.y + 0.24, c.z], 2.4, 2.25, 16, C.brass, { caps: false });
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2, [x0, z0] = at(c.x, c.z, a, 0.5), [x1, z1] = at(c.x, c.z, a, 2.3);
    b.prism([x0, c.y + 0.2, z0], [x1, c.y + 0.24, z1], 0.07, 0.07, 4, C.brassDark, { caps: false });
  }
  for (let k = 0; k < 7; k++) {
    const a = hh(k, 3) * 6.283, r = 0.6 + 1.4 * hh(3, k), [x, z] = at(c.x, c.z, a, r);
    g.glow.tri([x - 0.25, c.y + 0.25, z], [x + 0.05, c.y + 0.4, z + 0.18], [x + 0.2, c.y + 0.25, z - 0.12], C.crystal, C.cream, mix(C.crystal, C.lamp, 0.5));
  }
  pool(g.pool, c.x, c.y + 0.3, c.z, 4.5, tint(C.lamp, 0.18));
}

function gateFrame(b: Builder, g: GatePlan) {
  const nx = g.uz, nz = -g.ux, w = g.width / 2 + 0.25, top = g.y + GATE_H + 0.5;
  const post = mix(C.stone, C.slate, 0.4);
  for (const sg of [1, -1]) {
    const x = g.x + nx * sg * w, z = g.z + nz * sg * w;
    b.prism([x, g.y - 0.2, z], [x, top, z], 0.42, 0.36, 6, post, { capB: tint(post, 0.8) });
    b.ball([x, top + 0.15, z], 0.28, C.brass, 1, 0.7, 1, 0);
  }
  const l0 = g.x + nx * w, l1 = g.x - nx * w;
  b.prism([l0, top - 0.15, g.z + nz * w], [l1, top - 0.15, g.z - nz * w], 0.32, 0.32, 4, tint(post, 0.85), { rot: Math.PI / 4 });
  b.prism([g.x, top - 0.15, g.z], [g.x + g.ux * 0.4, top - 0.15, g.z + g.uz * 0.4], 0.35, 0.35, 8, C.brass);
}

/** The portcullis, in local space: x across the corridor, y up from the floor, z along the way into the room. */
function portcullis(b: Builder, width: number) {
  const w = width / 2 + 0.2, bar = C.brassDark, band = C.brass;
  const n = Math.round((w * 2) / 0.42);
  for (let k = 0; k <= n; k++) {
    const x = -w + (k * 2 * w) / n;
    b.prism([x, 0.15, 0], [x, GATE_H, 0], 0.055, 0.05, 4, bar);
    b.prism([x, 0.15, 0], [x, -0.05, 0], 0.05, 0.0, 4, C.iron);                // the spikes
  }
  for (const y of [0.9, 2.2, 3.5]) b.box(0, y, 0, w * 2 + 0.1, 0.13, 0.12, band);
  b.box(0, GATE_H, 0, w * 2 + 0.2, 0.22, 0.2, band);
}

/** The gate circle on the floor (the wall a shut gate is): a glowing ring and a lamp sigil, additive, in world space. */
function gateSeal(b: Builder, g: GatePlan, L: DungeonLayout) {
  const r = 3, n = 48, y = g.y + 0.08, col = tint(hex('#ffb070'), 0.75), black: RGB = [0, 0, 0];
  for (let k = 0; k < n; k++) {
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const [x0, z0] = at(g.x, g.z, a0, r), [x1, z1] = at(g.x, g.z, a1, r), [m0, n0] = at(g.x, g.z, a0, r - 0.6), [m1, n1] = at(g.x, g.z, a1, r - 0.6);
    // only over floor (the circle reaches past the corridor's walls)
    const yy0 = L.walk.floor(x0, z0), yy1 = L.walk.floor(x1, z1);
    const y0 = (yy0 ?? g.y) + 0.08, y1 = (yy1 ?? g.y) + 0.08;
    b.triW([m0, y, n0], [x0, y0, z0], [x1, y1, z1], tint(col, 0.35), col, col, 'up');
    b.triW([m0, y, n0], [x1, y1, z1], [m1, y, n1], tint(col, 0.35), col, tint(col, 0.35), 'up');
    b.triW([g.x, y, g.z], [m0, y, n0], [m1, y, n1], black, tint(col, 0.35), tint(col, 0.35), 'up');
    // the curtain: light rising from the circle's edge where there is floor
    if (yy0 !== null && yy1 !== null) {
      b.triW([x0, y0, z0], [x1, y1, z1], [x1, y1 + 2.6, z1], col, col, black, null);
      b.triW([x0, y0, z0], [x1, y1 + 2.6, z1], [x0, y0 + 2.6, z0], col, black, black, null);
    }
  }
  // the lamp sigil in the middle
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2, [tx, tz] = at(g.x, g.z, a, 1.3), [lx, lz] = at(g.x, g.z, a - 0.35, 0.5), [rx, rz] = at(g.x, g.z, a + 0.35, 0.5);
    b.triW([lx, y, lz], [tx, y, tz], [rx, y, rz], tint(col, 0.6), col, tint(col, 0.6), 'up');
  }
}

/** The lamp-lift: a brass cage with a lamp inside, its foot at the local origin. */
function liftCage(b: Builder, g: Builder, r: number) {
  const rr = r - 0.35, h = 3.0;
  b.prism([0, 0, 0], [0, 0.25, 0], rr + 0.2, rr + 0.15, 12, C.brassDark, { capB: C.brass });
  for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; b.prism([Math.sin(a) * rr, 0.25, Math.cos(a) * rr], [Math.sin(a) * rr, h, Math.cos(a) * rr], 0.06, 0.06, 4, C.brass, { caps: false }); }
  for (const y of [1.2, h]) b.prism([0, y, 0], [0, y + 0.12, 0], rr + 0.08, rr + 0.08, 12, C.brass, { caps: false });
  b.prism([0, h + 0.1, 0], [0, h + 0.9, 0], rr + 0.25, 0.15, 12, C.roof, { col2: PAL.roof2 });
  b.ball([0, h + 1.0, 0], 0.16, C.gold, 1, 1, 1, 0);
  b.prism([0, h + 0.1, 0], [0, h - 0.5, 0], 0.03, 0.03, 3, C.iron, { caps: false });
  g.ball([0, h - 0.85, 0], 0.38, C.lamp, 0.9, 1.25, 0.9, 1);
}

// ───────────────────────── the world ─────────────────────────

/** The Lampfall's world: the WorldApi plus its gates and lamp-lift (from the instance's state). */
export interface LampfallWorld extends WorldApi {
  readonly layout: DungeonLayout;
  /** state.gates: the shut lamp-gates as bits (GATE_WICK, GATE_WICK_EXIT, GATE_PIT); their portcullises drop or lift. */
  setGates(mask: number): void;
  /** state.lift: the lamp-lift rises at the Lens Pit's centre. */
  setLift(open: boolean): void;
  /** Triangles built per tier (for the budget readout). */
  readonly triangles: { med: number; low: number };
  /** Removes everything the world built (a zone change disposes its whole scene; this is for the viewer and tests). */
  dispose(): void;
}

const C3 = (h: string) => Color3.FromHexString(h);
/** The dungeon's fog, deep teal-violet. */
export const LAMPFALL_FOG = '#2a2d48';

/**
 * `live` (online: from the instance room's state) gives the shut-gate bits and the lamp-lift: the walk the client
 * predicts on makes every shut gate a wall exactly as the server does (gatedSurface), and the portcullises and the
 * lift follow it. Without `live` (the viewer, tests), setGates and setLift drive both.
 */
export function buildLampfall(scene: Scene, live?: LampfallLive): LampfallWorld {
  const layout = lampfallLayout();
  const plan = lampfallPlan(layout);
  const geo = lampfallGeometry(plan);
  const walk = layout.walk;
  const owned: { meshes: Mesh[]; mats: Material[]; other: { dispose(): void }[] } = { meshes: [], mats: [], other: [] };

  // ───── atmosphere ─────
  const fogCol = C3(LAMPFALL_FOG);
  scene.clearColor = new Color4(fogCol.r * 0.8, fogCol.g * 0.8, fogCol.b * 0.85, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = fogCol;
  scene.fogStart = 25; scene.fogEnd = 95;
  scene.ambientColor = new Color3(0, 0, 0);
  const sun = new DirectionalLight('lf_sun', new Vector3(0.35, -1, 0.25), scene);
  sun.diffuse = C3('#c9c2e8'); sun.specular = new Color3(0, 0, 0); sun.intensity = 0.36;
  sun.position = new Vector3(-40, 80, -30);
  const hemi = new HemisphericLight('lf_fill', new Vector3(0.1, 1, 0.2), scene);
  hemi.diffuse = C3('#aebce4'); hemi.groundColor = C3('#7a5e5a'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.52;
  const lantern = new PointLight('lf_lantern', new Vector3(0, 3, 0), scene);
  lantern.diffuse = C3('#ffcf8a'); lantern.specular = new Color3(0, 0, 0); lantern.intensity = 0.38; lantern.range = 14;
  owned.other.push(sun, hemi, lantern);

  // ───── materials ─────
  const lit = (name: string, o: ConstructorParameters<typeof WorldFxPlugin>[1]) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0); m.emissiveColor = new Color3(0.06, 0.05, 0.08);
    new WorldFxPlugin(m, o);
    owned.mats.push(m);
    return m;
  };
  const mLit = lit('lf_lit', { noise: 0.22, rim: 0.16, fade: true });
  const mDetail = lit('lf_detail', { noise: 0.15, rim: 0.2 });
  const mGlow = new StandardMaterial('lf_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1); new WorldFxPlugin(mGlow, { flicker: true }); owned.mats.push(mGlow);
  const additive = (name: string) => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); m.diffuseColor = new Color3(0, 0, 0); m.alpha = 0.999;
    m.alphaMode = 1; m.disableDepthWrite = true; m.backFaceCulling = false; m.fogEnabled = false;
    owned.mats.push(m);
    return m;
  };
  const mPool = additive('lf_pool');
  const mSeal = additive('lf_seal');
  const mShaft = additive('lf_shaft');

  // ───── meshes ─────
  const mk = (b: Builder, name: string, mat: Material): Mesh | null => {
    if (b.tris === 0) return null;
    const m = b.build(scene, name, mat as StandardMaterial);
    m.hasVertexAlpha = false;
    owned.meshes.push(m);
    return m;
  };
  interface Chunk { lit: Mesh | null; detail: Mesh | null; glow: Mesh | null; pool: Mesh | null; shaft: Mesh | null }
  const chunks: Chunk[] = geo.chunks.map((g, i) => ({
    lit: mk(g.lit, `lf_lit_${i}`, mLit), detail: mk(g.detail, `lf_detail_${i}`, mDetail),
    glow: mk(g.glow, `lf_glow_${i}`, mGlow), pool: mk(g.pool, `lf_pool_${i}`, mPool), shaft: mk(g.shaft, `lf_shaft_${i}`, mShaft),
  }));
  for (const c of chunks) for (const m of [c.lit, c.detail, c.glow, c.pool, c.shaft]) if (m) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; m.isPickable = false; }
  for (const c of chunks) { if (c.pool) c.pool.alphaIndex = 10; if (c.shaft) c.shaft.alphaIndex = 30; }
  // the floors are pickable (tap-to-walk)
  for (const c of chunks) if (c.lit) c.lit.isPickable = true;

  // the gates: a portcullis each (moves) and its glowing circle (shown while shut)
  const gates = plan.gates.map((g, i) => {
    const bars = mk(geo.gates[i].bars, `lf_gate_${g.bit}`, mDetail)!;
    bars.position.set(g.x, g.y + GATE_LIFT, g.z);
    bars.rotation.y = Math.atan2(g.ux, g.uz);
    bars.visibility = 0; bars.setEnabled(false);
    const seal = mk(geo.gates[i].seal, `lf_gateSeal_${g.bit}`, mSeal)!;
    seal.alphaIndex = 20; seal.setEnabled(false);
    return { g, bars, seal, y: GATE_LIFT, shut: false };
  });
  // the lamp-lift (hidden until the Warden falls)
  const liftCageM = mk(geo.lift.cage, 'lf_lift', mDetail)!, liftGlowM = mk(geo.lift.glow, 'lf_liftGlow', mGlow)!;
  liftGlowM.parent = liftCageM;
  liftCageM.position.set(plan.lift.x, plan.lift.y - 4.2, plan.lift.z);
  liftCageM.setEnabled(false);
  let liftOpen = false, liftT = 0;

  // ───── anchors and spawns ─────
  const rim = layout.rooms[0];
  const start: Anchor = { pos: new Vector3(rim.x, rim.floorY, rim.z), facing: rim.entryDir };
  const spawns = layout.rooms.flatMap(r => r.spawns).map(s => new Vector3(s.x, walk.floor(s.x, s.z) ?? 0, s.z));
  const pit = layout.rooms.find(r => r.id === 'lens_pit')!;
  const lens = new Vector3(pit.x, pit.floorY + 4, pit.z);

  // ───── quality, shadows, glow, post ─────
  let quality: Quality = 'med';
  let cam: ArcRotateCamera | null = null;
  const statics = chunks.flatMap(c => [c.lit, c.detail]).filter((m): m is Mesh => m !== null);
  const casters: AbstractMesh[] = [...statics, ...gates.map(g => g.bars)];
  const receivers: Mesh[] = [...statics];
  const look = createLook(scene, {
    prefix: 'lf', sun, casters, receivers,
    shadow: { high: { maxZ: 70, cascades: 2, size: 2048 }, med: { maxZ: 40, cascades: 1, size: 1024 } },
    glowMeshes: () => [...chunks.map(c => c.glow).filter((m): m is Mesh => m !== null), liftGlowM],
  });
  // blob shadows for characters on 'low' (no shadow maps there): made with the first character
  let blobMat: StandardMaterial | null = null;
  const blobMaterial = (): StandardMaterial => {
    if (blobMat) return blobMat;
    const blobTex = new DynamicTexture('lf_blob', { width: 64, height: 64 }, scene, false);
    { const g = blobTex.getContext() as unknown as CanvasRenderingContext2D; const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(20,14,34,0.6)'); r.addColorStop(1, 'rgba(20,14,34,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); blobTex.hasAlpha = true; blobTex.update(); }
    blobMat = new StandardMaterial('lf_blobmat', scene); blobMat.diffuseTexture = blobTex; blobMat.useAlphaFromDiffuseTexture = true; blobMat.disableLighting = true; blobMat.emissiveColor = new Color3(1, 1, 1); blobMat.zOffset = -2;
    owned.mats.push(blobMat); owned.other.push(blobTex);
    return blobMat;
  };
  const blobs: { root: TransformNode; disc: Mesh }[] = [];
  const setQuality = (q: Quality) => {
    quality = q;
    FIELD_LOOK.low = q === 'low';
    for (const c of chunks) { c.detail?.setEnabled(q !== 'low'); c.shaft?.setEnabled(q !== 'low'); }
    lantern.setEnabled(q !== 'low');
    for (const b of blobs) b.disc.setEnabled(q === 'low');
    look.setQuality(q);
  };

  let mask = 0;
  const { surface, ground } = lampfallSurfaces(live ? () => live.gates() : () => mask, layout);
  let time = 0;
  const tmpTarget = new Vector3();
  const triangles = { med: lampfallTriangles(geo, 'med'), low: lampfallTriangles(geo, 'low') };

  const world: LampfallWorld = {
    layout, triangles,
    addShadowCaster: (root: TransformNode) => {
      for (const m of root.getChildMeshes(false)) {
        if (casters.includes(m)) continue;
        if ((m.material as StandardMaterial | null)?.disableLighting) continue;
        casters.push(m);
        look.addCaster(m);
      }
      if (!blobs.some(b => b.root === root)) {
        const disc = MeshBuilder.CreateGround('lf_blob_' + blobs.length, { width: 1.3, height: 1.3 }, scene);
        disc.material = blobMaterial(); disc.isPickable = false; disc.setEnabled(quality === 'low');
        blobs.push({ root, disc });
      }
    },
    attachCamera: (c: ArcRotateCamera) => { cam = c; look.attachCamera(c); },
    groundAt: (x, z) => ground(x, z),
    surfaceAt: (x, z) => surface(x, z),
    anchor: (_name: AnchorName) => ({ pos: start.pos.clone(), facing: start.facing }),
    enemySpawns: () => spawns.map(p => p.clone()),
    raiseBeacon: () => Promise.resolve(),
    get beaconRaised() { return false; },
    // underground: no sky for the Beacon or the falling star (WorldApi: zones without a sky do nothing)
    setBeaconRaised: () => {},
    fallingStar: () => Promise.resolve(),
    setArenaPhase: () => {},
    statueLens: lens,
    setQuality,
    setGates(m: number) {
      mask = m | 0;
      for (const g of gates) {
        const shut = (mask & g.g.bit) !== 0;
        if (shut !== g.shut) { g.shut = shut; g.seal.setEnabled(shut); }
      }
    },
    setLift(open: boolean) {
      if (open === liftOpen) return;
      liftOpen = open; liftCageM.setEnabled(open);
      if (!open) { liftT = 0; liftCageM.position.y = plan.lift.y - 4.2; }
    },
    update: (dt) => {
      time += dt;
      if (live) { world.setGates(live.gates()); world.setLift(live.lift()); }
      look.update();
      WFX.time = time;
      const ac = cam ?? (scene.activeCamera as ArcRotateCamera | null);
      if (ac && ac.target) { tmpTarget.copyFrom(ac.target); WFX.target.copyFrom(tmpTarget); WFX.fadeRadius = 3.2; }
      // the warm lantern light rides above whoever the camera follows
      lantern.position.set(tmpTarget.x, tmpTarget.y + 3.2, tmpTarget.z);
      // portcullises: drop fast, lift slowly; the circle pulses while shut
      for (const g of gates) {
        const want = g.shut ? 0 : GATE_LIFT;
        const speed = g.shut ? 9 : 1.6;
        if (g.y !== want) {
          g.y = want > g.y ? Math.min(want, g.y + speed * dt) : Math.max(want, g.y - speed * dt); g.bars.position.y = g.g.y + g.y;
          const vis = Math.max(0, Math.min(1, 1 - (g.y - GATE_FADE_FROM) / (GATE_LIFT - GATE_FADE_FROM)));
          g.bars.visibility = vis; g.bars.setEnabled(vis > 0.01);
        }
        if (g.shut) g.seal.visibility = 0.75 + 0.25 * Math.sin(time * 3.2);
      }
      if (liftOpen && liftT < 1) { liftT = Math.min(1, liftT + dt / 3.5); const e = liftT * liftT * (3 - 2 * liftT); liftCageM.position.y = plan.lift.y - 4.2 + 4.2 * e; }
      for (let i = blobs.length - 1; i >= 0; i--) {
        const b = blobs[i];
        if (b.root.isDisposed()) { b.disc.dispose(); blobs.splice(i, 1); continue; }
        const p = b.root.position;
        b.disc.position.set(p.x, (walk.surfaceAt(p.x, p.z) ?? p.y) + 0.04, p.z);
      }
    },
    dispose() {
      for (const b of blobs) b.disc.dispose();
      blobs.length = 0;
      look.setQuality('low');
      for (const m of owned.meshes) m.dispose();
      for (const m of owned.mats) m.dispose(true, true);
      for (const o of owned.other) o.dispose();
      owned.meshes.length = 0; owned.mats.length = 0; owned.other.length = 0;
    },
  };
  return world;
}
