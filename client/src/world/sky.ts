// Sky dome, the sea of clouds and the distant vista (islands, waterfalls, wind-ships).
import { Builder, hex, mix, norm, vnoise, type RGB, type V3 } from './mesh';
import { Kit, PAL, island, tree, house, waterfall, cloudPuff, lighthouse, windmillBody } from './parts';
import { PALETTE } from '../core/contracts';

export const SUN_DIR: V3 = norm([-0.62, 0.52, -0.58]); // toward the sun
export const CLOUD_Y = -72;

export function buildSkyDome(b: Builder, radius: number) {
  const zen = hex(PALETTE.skyDeep), mid = hex(PALETTE.sky), hor = hex(PALETTE.horizon), horCool = hex('#cfe0f5'), below = hex('#fbe6d6');
  const col = (d: V3): RGB => {
    const sa = Math.max(0, (d[0] * SUN_DIR[0] + d[2] * SUN_DIR[2]) / (Math.hypot(d[0], d[2]) * Math.hypot(SUN_DIR[0], SUN_DIR[2]) + 1e-6));
    const h = d[1];
    const horizon = mix(mix(horCool, hor, 0.45), hex('#ffb37a'), Math.pow(sa, 2));
    if (h < 0) return mix(horizon, below, Math.min(1, -h * 4));
    let c = mix(horizon, mid, Math.min(1, h / 0.28));
    c = mix(c, zen, Math.max(0, Math.min(1, (h - 0.2) / 0.55)));
    return c;
  };
  const NA = 40, NE = 16;
  const P = (i: number, j: number): V3 => {
    const a = i / NA * Math.PI * 2; const e = -0.35 + j / NE * (Math.PI / 2 + 0.35);
    return [Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)];
  };
  b.cj = 0;
  b.withHint([0, 0, 0], () => {
    for (let i = 0; i < NA; i++) for (let j = 0; j < NE; j++) {
      const p = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      const s = (v: V3): V3 => [v[0] * radius, v[1] * radius, v[2] * radius];
      // smooth per-vertex gradient
      b.triW(s(p[0]), s(p[1]), s(p[2]), col(p[0]), col(p[1]), col(p[2]), [0, 0, 0]);
      b.triW(s(p[0]), s(p[2]), s(p[3]), col(p[0]), col(p[2]), col(p[3]), [0, 0, 0]);
    }
  });
}

/** Cloud sea: lumpy floor + puffs. `extra` receives the extra puffs used at med/high. */
export function buildClouds(base: Builder, extra: Builder) {
  const G = 30, EXT = 1500;
  const h = (x: number, z: number) => CLOUD_Y - 6 + (vnoise(x * 0.004, z * 0.004) - 0.5) * 40;
  base.withHint('up', () => {
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
      const x0 = -EXT + i / G * 2 * EXT, x1 = -EXT + (i + 1) / G * 2 * EXT, z0 = -EXT + j / G * 2 * EXT, z1 = -EXT + (j + 1) / G * 2 * EXT;
      base.quad([x0, h(x0, z0), z0], [x0, h(x0, z1), z1], [x1, h(x1, z1), z1], [x1, h(x1, z0), z0], PAL.cloud);
    }
  });
  const rng = base.rng;
  // collar of puffs hugging the grove's underside and around the beacon below
  for (let i = 0; i < 40; i++) { const a = rng.r(0, 6.28), r = rng.r(20, 70); cloudPuff(base, [Math.cos(a) * r, CLOUD_Y + rng.r(-4, 14), Math.sin(a) * r], rng.r(10, 18), 0.5); }
  for (let i = 0; i < 70; i++) { const a = rng.r(0, 6.28), r = rng.r(90, 900); cloudPuff(base, [Math.cos(a) * r, CLOUD_Y + rng.r(-8, 12), Math.sin(a) * r], rng.r(18, 45) * (0.6 + r / 700), 0.55, 0); }
  const r2 = extra.rng;
  for (let i = 0; i < 110; i++) { const a = r2.r(0, 6.28), r = r2.r(60, 1100); cloudPuff(extra, [Math.cos(a) * r, CLOUD_Y + r2.r(-6, 18), Math.sin(a) * r], r2.r(14, 40) * (0.6 + r / 700), 0.55, r < 300 ? 1 : 0); }
  // towering cumulus on the horizon
  for (const [x, z, hgt] of [[-900, -500, 380], [-300, -1000, 330], [600, -900, 420], [1000, 200, 300], [-1000, 500, 360], [300, 1050, 340]] as [number, number, number][]) {
    for (let q = 0; q < 10; q++) { const t = q / 10; extra.ball([x + r2.r(-1, 1) * 120 * (1 - t * 0.6), CLOUD_Y + t * hgt, z + r2.r(-1, 1) * 100], r2.r(80, 130) * (1 - t * 0.45), PAL.cloud, 1, 0.8, 1, 1, 0.25, hex('#f3e6ef')); }
  }
}

/** Distant floating islands with waterfalls + a windmill and a lighthouse. Water into `w`. */
export function buildVista(k: Kit, w: Builder) {
  const b = k.b;
  const isl = (x: number, y: number, z: number, R: number, depth: number, seed: number, trees: number, falls: number[]) => {
    island(b, x, y, z, R, depth, { n: R > 40 ? 22 : 14, seed, tipOff: [R * 0.12, R * 0.06], dome: R * 0.08, bump: R * 0.03 });
    for (let i = 0; i < trees; i++) { const a = b.rng.r(0, 6.28), r = b.rng.r(0, R * 0.7); tree(b, x + Math.cos(a) * r, y + R * 0.04, z + Math.sin(a) * r, R * b.rng.r(0.06, 0.1), i % 3 === 0 ? 1 : i % 3 === 1 ? 2 : 0); }
    for (const ang of falls) waterfall(w, [x + Math.cos(ang) * R * 0.98, y + 0.3, z + Math.sin(ang) * R * 0.98], [Math.cos(ang), 0, Math.sin(ang)], depth * 1.6 + 40, R * 0.12, Math.floor(ang * 10));
  };
  // mid-distance islands
  isl(110, 18, -170, 26, 60, 33, 7, [-1.6, -1.1]);
  house(k, 104, 19.5, -172, 6, 5, 5, 0.6, PAL.wall, PAL.roof3, { chimney: true, foundation: 2 });
  windmillBody(k, 118, 19, -164, -0.4, 1.4);
  isl(-120, 30, -180, 18, 40, 41, 5, [-1.3]);
  isl(160, 12, 70, 20, 45, 45, 6, [0.2]);
  house(k, 156, 13.5, 66, 5, 4.4, 4.4, 2.2, PAL.wall2, PAL.roof1, { foundation: 2 });
  isl(-40, 44, 230, 14, 30, 51, 4, [1.7]);
  isl(-60, 6, -80, 7, 16, 61, 2, []);
  isl(70, -8, 90, 8, 18, 62, 2, []);
  // far, big ones that dissolve into the haze
  isl(-480, 60, -520, 90, 160, 71, 14, [0.8, 1.2]);
  lighthouse(k, -460, 66, -540, 6, 38);
  isl(520, 90, -380, 110, 180, 73, 14, [2.6, 3.1]);
  isl(450, 40, 520, 80, 150, 75, 10, [-2.2]);
  isl(-620, 120, 320, 120, 200, 77, 10, [-0.4]);
  isl(-180, 110, -760, 70, 130, 79, 8, [1.5]);
  isl(-330, 25, 210, 22, 50, 81, 5, [-0.7]);
}

/** A wind-ship flying a slow circle; built around its own origin. */
export function vistaShipPath(t: number, i: number): { x: number; y: number; z: number; yaw: number } {
  const R = i === 0 ? 84 : 260, w = i === 0 ? 0.025 : -0.012, ph = i === 0 ? 1.0 : 3.6;
  const a = ph + t * w;
  const x = Math.cos(a) * R + (i === 0 ? 10 : -60), z = Math.sin(a) * R + (i === 0 ? -10 : 40);
  const y = (i === 0 ? -8 : 30) + Math.sin(t * 0.4 + i) * 1.2;
  // tangent direction of motion
  const tx = -Math.sin(a) * Math.sign(w), tz = Math.cos(a) * Math.sign(w);
  return { x, y, z, yaw: Math.atan2(tx, tz) };
}
