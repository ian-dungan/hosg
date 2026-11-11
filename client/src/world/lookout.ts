// The Old Lookout: a weathered pale-stone outcrop at the southern foot of the grove knoll, five
// stacked tiers spiralling up to a ruined watch platform with a bench and a small flag. It is climbed
// only by jumping tier to tier (each 0.9 m above the last); its far side is a sheer 4.5 m drop.
// LOOKOUT is the single source for both the mesh and the walk obstacles.
import { Builder, hex, mix, tint, hash, type RGB, type V3 } from './mesh';
import { Kit, PAL } from './parts';
import { groundHeight, type Obstacle } from './layout';

const CX = 34, CZ = -27;
/** Local +X (the sheer side) points away from the plaza, toward the south-east. */
const YAW = (50 * Math.PI) / 180;
const RISE = 0.9;
const BASE = groundHeight(CX, CZ);
const C = Math.cos(YAW), S = Math.sin(YAW);

/** Tier footprints in local coordinates [x0, x1, z0, z1]. Each tier sits on the one before; the part of
 *  a tier the next one does not cover is its ledge (2.6 m deep), and the ledges spiral round to the top. */
const RECTS: [number, number, number, number][] = [
  [-4.6, 4.6, -4.6, 4.6],   // 1: base; ledge on the -X side (facing the plaza)
  [-2.0, 4.6, -4.6, 4.6],   // 2: ledge along +Z
  [-2.0, 4.6, -4.6, 2.0],   // 3: ledge on the -X side of what is left
  [0.6, 4.6, -4.6, 2.0],    // 4: ledge along -Z
  [0.6, 4.6, -2.0, 2.0],    // 5: the 4 x 4 m watch platform
];
/** Each tier's ledge (what the next tier leaves uncovered), local [x0, x1, z0, z1]. */
const LEDGES: [number, number, number, number][] = [
  [-4.6, -2.0, -4.6, 4.6], [-2.0, 4.6, 2.0, 4.6], [-2.0, 0.6, -4.6, 2.0], [0.6, 4.6, -4.6, -2.0], [0.6, 4.6, -2.0, 2.0],
];

/** Local (x, z) to world (x, z), the same convention as Rect obstacles and Builder.RY. */
const W = (lx: number, lz: number): [number, number] => [CX + C * lx + S * lz, CZ - S * lx + C * lz];

export interface LookoutTier { x: number; z: number; hw: number; hd: number; yaw: number; top: number }
export const LOOKOUT: { x: number; z: number; tiers: LookoutTier[] } = {
  x: CX, z: CZ,
  tiers: RECTS.map(([x0, x1, z0, z1], i) => {
    const [x, z] = W((x0 + x1) / 2, (z0 + z1) / 2);
    return { x, z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, yaw: YAW, top: BASE + RISE * (i + 1) };
  }),
};
const TOP = LOOKOUT.tiers[4].top;

// pieces on the watch platform (local)
const BENCH = { x: 1.55, z: 1.1, hw: 0.36, hd: 0.85 };   // seat faces -X, back to the drop
const FLAG = { x: 1.05, z: -1.55 };
const PARAPET: [number, number, number, number, number][] = [ // x, z, half length along z, height, lean
  [4.38, -1.05, 0.32, 0.62, 0.05], [4.4, 1.15, 0.38, 0.44, -0.04],
];
const PILLAR = { x: 4.25, z: -1.75 };
const BOULDERS: [number, number, number][] = [[5.35, 3.55, 0.78], [5.7, -3.3, 0.95], [1.6, -5.45, 0.72], [-2.7, 5.4, 0.62], [3.5, 5.35, 0.58]];

const rectObs = (lx: number, lz: number, hw: number, hd: number, top?: number): Obstacle => {
  const [x, z] = W(lx, lz);
  const o: Obstacle = { kind: 'r', x, z, hw, hd, c: C, s: S };
  if (top !== undefined) o.top = top;
  return o;
};

const STONE: RGB = hex('#ecdcc0'), STONE_D: RGB = hex('#c9b394'), STONE_L: RGB = hex('#f6ecd8');
const MOSS: RGB = hex('#8fc45f'), MOSS_D: RGB = hex('#5ea456');

/** A rough stone slab over local rect [x0,x1]x[z0,z1] from y0 to a flat top at y1 (top face exactly covers the rect). */
function slab(b: Builder, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, seed: number, topCol: RGB) {
  // perimeter points round the rect, each with the direction it is pushed outward (diagonal at corners)
  const per: { p: [number, number]; n: [number, number] }[] = [];
  const side = (ax: number, az: number, bx: number, bz: number, nx: number, nz: number, cx: number, cz: number) => {
    const n = Math.max(3, Math.round(Math.hypot(bx - ax, bz - az) / 0.95));
    for (let i = 0; i < n; i++) { const t = i / n; per.push({ p: [ax + (bx - ax) * t, az + (bz - az) * t], n: i === 0 ? [cx, cz] : [nx, nz] }); }
  };
  side(x0, z0, x1, z0, 0, -1, -1, -1); side(x1, z0, x1, z1, 1, 0, 1, -1); side(x1, z1, x0, z1, 0, 1, 1, 1); side(x0, z1, x0, z0, -1, 0, -1, 1);
  const ns = per.length;
  const h = y1 - y0;
  // rings from the foot up: weathered strata that bulge and pinch, rounded over at the lip
  const ring = (y: number, out: number, jit: number, salt: number, yj = 0): V3[] => per.map(({ p, n }, i) => {
    const o = out + jit * hash(i * 3.7 + seed, salt);
    return [p[0] + n[0] * o, y + yj * (hash(i * 1.3 + seed, salt + 5) - 0.5), p[1] + n[1] * o];
  });
  const top = ring(y1, 0.03, 0.08, 1);
  const lip = ring(y1 - Math.min(0.16, h * 0.2), 0.2, 0.12, 2);
  const s1 = ring(y1 - h * 0.38, 0.12, 0.2, 3, 0.12);
  const s2 = ring(y1 - h * 0.5, 0.28, 0.22, 5, 0.1);
  const s3 = ring(y1 - h * 0.78, 0.2, 0.3, 6, 0.1);
  const bot = ring(y0, 0.38, 0.3, 4);
  const bands: [V3[], V3[], RGB, RGB][] = [
    [bot, s3, tint(STONE_D, 0.9), STONE_D], [s3, s2, STONE_D, STONE], [s2, s1, tint(STONE_D, 1.02), STONE], [s1, lip, STONE, STONE_L], [lip, top, STONE_L, mix(STONE_L, topCol, 0.3)],
  ];
  const centre: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  b.withHint(centre, () => {
    for (let i = 0; i < ns; i++) {
      const j = (i + 1) % ns, v = 0.93 + 0.12 * hash(i + seed, 9);
      for (const [lo, hi, cl, ch] of bands) b.quad(lo[i], lo[j], hi[j], hi[i], tint(cl, v), tint(ch, v));
    }
  });
  b.withHint('up', () => {
    const c: V3 = [(x0 + x1) / 2, y1, (z0 + z1) / 2];
    for (let i = 0; i < ns; i++) { const j = (i + 1) % ns; b.tri(c, top[j], top[i], topCol, mix(topCol, STONE_L, 0.4), mix(topCol, STONE_L, 0.4)); }
  });
}

/** A tuft of grass blades at local (x, y, z). */
function tuft(b: Builder, x: number, y: number, z: number, s: number, r: () => number) {
  const n = 4 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * 6.283, l = (0.28 + r() * 0.25) * s, w = 0.06 * s;
    const bx = x + Math.cos(a) * 0.08, bz = z + Math.sin(a) * 0.08, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
    const tip: V3 = [bx + Math.cos(a) * l * 0.45, y + l, bz + Math.sin(a) * l * 0.45];
    b.withHint(null, () => b.tri([bx - px, y - 0.02, bz - pz], [bx + px, y - 0.02, bz + pz], tip, MOSS_D, MOSS_D, i % 2 ? PAL.grass : PAL.grass2));
  }
}

/** Builds the Old Lookout into the town kit and returns its walk obstacles (tiers and the bench are platforms). */
export function buildLookout(k: Kit): Obstacle[] {
  const b = k.b;
  const obs: Obstacle[] = [];
  const rng = b.rng; const r = () => rng.next();
  let lo = Infinity;
  for (let x = -5; x <= 5; x += 1) for (let z = -5; z <= 5; z += 1) { const [wx, wz] = W(x, z); lo = Math.min(lo, groundHeight(wx, wz)); }

  b.push(); b.T(CX, 0, CZ); b.RY(YAW);
  // ───── the stone tiers ─────
  RECTS.forEach(([x0, x1, z0, z1], i) => {
    const top = LOOKOUT.tiers[i].top;
    const y0 = i === 0 ? lo - 0.5 : LOOKOUT.tiers[i - 1].top - 0.3;
    slab(b, x0, x1, z0, z1, y0, top, 17 + i * 31, i === 4 ? mix(STONE_L, MOSS, 0.12) : mix(STONE_L, MOSS, 0.5));
  });
  // rounded, weathered chunks at the outer corners of each tier (below its top, so they never get in the way)
  RECTS.forEach(([x0, x1, z0, z1], i) => {
    const top = LOOKOUT.tiers[i].top, below = i === 0 ? lo : LOOKOUT.tiers[i - 1].top;
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      if (r() < 0.45) continue;   // weathered away unevenly, not on every corner
      const rad = 0.4 + r() * 0.45;
      b.ball([cx, Math.max(below + rad * 0.3, top - rad * (0.75 + r() * 0.3)), cz], rad, STONE_L, 0.9 + r() * 0.5, 0.6, 0.9 + r() * 0.5, 1, 0.45, STONE_D);
    }
  });
  // ───── moss and grass on the ledges ─────
  const oldW = b.windFn;
  LEDGES.slice(0, 4).forEach(([x0, x1, z0, z1], i) => {
    const y = LOOKOUT.tiers[i].top;
    const area = (x1 - x0) * (z1 - z0);
    for (let m = 0; m < Math.round(area / 4.5); m++) {
      const x = x0 + 0.3 + r() * (x1 - x0 - 0.6), z = z0 + 0.3 + r() * (z1 - z0 - 0.6);
      b.ball([x, y - 0.02, z], 0.28 + r() * 0.3, mix(MOSS, PAL.grass, r() * 0.6), 1.3, 0.12, 1, 1, 0.4);
    }
    b.windFn = (p: V3) => Math.max(0, p[1] - y) * 0.5;
    for (let t = 0; t < Math.round(area / 1.1); t++) {
      // tufts gather at the foot of the next riser and along the outer edge
      const edge = r() < 0.5;
      const x = x0 + 0.2 + r() * (x1 - x0 - 0.4), z = z0 + 0.2 + r() * (z1 - z0 - 0.4);
      const ex = edge ? (r() < 0.5 ? x0 + 0.25 : x1 - 0.25) : x, ez = edge && (x1 - x0) > (z1 - z0) ? (r() < 0.5 ? z0 + 0.25 : z1 - 0.25) : z;
      tuft(b, (x1 - x0) > (z1 - z0) ? x : ex, y, (x1 - x0) > (z1 - z0) ? ez : z, 0.9 + r() * 0.5, r);
    }
    b.windFn = oldW;
  });
  // moss creeping over the lips of the ledges
  RECTS.forEach(([x0, x1, z0, z1], i) => {
    const y = LOOKOUT.tiers[i].top;
    for (let m = 0; m < 10; m++) {
      const sd = Math.floor(r() * 4), t = r();
      const x = sd === 0 ? x0 : sd === 1 ? x1 : x0 + (x1 - x0) * t, z = sd === 2 ? z0 : sd === 3 ? z1 : z0 + (z1 - z0) * t;
      b.ball([x, y - 0.12 - r() * 0.15, z], 0.18 + r() * 0.16, mix(MOSS_D, MOSS, r()), 1, 0.7, 1, 0, 0.3);
    }
  });
  // ───── rubble at the foot ─────
  for (const [x, z, rad] of BOULDERS) {
    const [wx, wz] = W(x, z);
    b.ball([x, groundHeight(wx, wz) + rad * 0.35, z], rad, STONE, 1.15, 0.8, 1, 1, 0.35, STONE_D);
    obs.push({ kind: 'c', x: wx, z: wz, r: rad * 0.8 });
  }
  // ───── the ruined watch platform ─────
  // worn flagstones, a few missing
  b.withHint('up', () => {
    for (let gx = 0; gx < 4; gx++) for (let gz = 0; gz < 4; gz++) {
      if (hash(gx * 5.1, gz * 3.3) < 0.18) continue;
      const ax = 0.7 + gx * 0.97, az = -1.9 + gz * 0.97, w = 0.9;
      const col = hash(gz, gx) > 0.5 ? PAL.pave1 : PAL.pave2;
      b.quad([ax, TOP + 0.015, az], [ax + w, TOP + 0.015, az], [ax + w, TOP + 0.015, az + w], [ax, TOP + 0.015, az + w], tint(col, 0.95), col);
    }
  });
  // broken parapet along the drop, with a gap in the middle
  for (const [x, z, hl, ht, lean] of PARAPET) {
    b.push(); b.T(x, TOP, z); b.RZ(lean);
    b.taperBox([0, -0.05, 0], 0.4, hl * 2, [0, ht, 0], 0.34, hl * 2 - 0.15, STONE, STONE_L);
    b.box(0.02, ht + 0.06, hl * 0.4, 0.3, 0.12, hl * 0.7, STONE_L);
    b.pop();
    obs.push(rectObs(x, z, 0.3, hl));
  }
  // what is left of the watchtower: a tall broken corner pillar, a short stump and a fallen block
  b.prism([PILLAR.x, TOP - 0.05, PILLAR.z], [PILLAR.x, TOP + 0.35, PILLAR.z], 0.36, 0.32, 6, STONE_D, { capB: STONE });
  b.prism([PILLAR.x, TOP + 0.35, PILLAR.z], [PILLAR.x, TOP + 2.5, PILLAR.z], 0.27, 0.24, 6, STONE, { capB: STONE_D });
  b.prism([PILLAR.x, TOP + 2.5, PILLAR.z], [PILLAR.x + 0.06, TOP + 2.95, PILLAR.z - 0.04], 0.24, 0.12, 6, STONE_L, { capB: STONE_D }); // broken top
  b.box(PILLAR.x - 0.1, TOP + 2.35, PILLAR.z, 0.62, 0.14, 0.62, STONE_L);                               // a band of carved stone
  obs.push(rectObs(PILLAR.x, PILLAR.z, 0.38, 0.38));
  b.prism([4.25, TOP - 0.05, 1.85], [4.25, TOP + 0.8, 1.85], 0.25, 0.2, 6, STONE, { capB: STONE_D });
  obs.push(rectObs(4.25, 1.85, 0.3, 0.3));
  b.box(3.4, TOP + 0.13, -1.1, 0.55, 0.26, 0.4, STONE_D, STONE);
  b.windFn = (p: V3) => Math.max(0, p[1] - TOP) * 0.5;
  for (const [x, z] of [[4.0, -0.5], [1.0, 1.85], [3.9, 1.3], [0.85, -0.6], [2.4, -1.85]]) tuft(b, x, TOP, z, 1.1, r);
  b.windFn = oldW;
  // bench, looking back over the steps toward the plaza
  {
    b.push(); b.T(BENCH.x, TOP, BENCH.z);
    b.box(0, 0.45, 0, 0.5, 0.1, 1.7, PAL.woodLight);
    b.box(0.26, 0.8, 0, 0.08, 0.38, 1.7, PAL.woodLight);
    for (const sz of [-0.68, 0.68]) b.box(0, 0.21, sz, 0.44, 0.42, 0.14, STONE_D, STONE);
    b.pop();
    obs.push(rectObs(BENCH.x, BENCH.z, BENCH.hw, BENCH.hd, TOP + 0.5));
  }
  b.pop();

  // a small pennant on a pole (world space, so its wind weights match)
  {
    const [fx, fz] = W(FLAG.x, FLAG.z), y = TOP, h = 3.3;
    b.prism([fx, y - 0.1, fz], [fx, y + h, fz], 0.06, 0.04, 5, PAL.woodDark);
    b.ball([fx, y + h + 0.05, fz], 0.08, PAL.gold, 1, 1, 1, 0);
    // streams toward -X (the plaza side), along the platform rather than over the drop
    const dx = -C, dz = S;
    b.windFn = (p: V3) => Math.hypot(p[0] - fx, p[2] - fz) * 0.22;
    b.sheet((u, v) => [fx + dx * u * 1.5 + dz * Math.sin(u * 4 + v) * 0.12 * u, y + h - 0.08 - v * 0.8 * (1 - u * 0.85), fz + dz * u * 1.5 - dx * Math.sin(u * 4 + v) * 0.12 * u], 6, 2, (i) => i % 2 ? PAL.roof1 : tint(PAL.roof1, 0.9));
    b.windFn = oldW;
    obs.push({ kind: 'c', x: fx, z: fz, r: 0.18 });
  }

  for (let i = 0; i < 5; i++) {
    const t = LOOKOUT.tiers[i];
    obs.push({ kind: 'r', x: t.x, z: t.z, hw: t.hw, hd: t.hd, c: C, s: S, top: t.top });
  }
  return obs;
}
