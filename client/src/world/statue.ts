// The Statue of the Two (hero asset): Ellie mid-stride pointing at the sky, Felix with a hand on
// her shoulder sighting along her arm through his spyglass. Carved stone with bronze accents,
// on a moulded octagonal plinth with a bronze plaque.
import { DynamicTexture, Mesh, MeshBuilder, StandardMaterial, Color3, type Scene } from '@babylonjs/core';
import { Builder, hex, add, sub, mul, norm, cross, mix, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { BEACON_DIR } from './layout';

export const PLINTH_TOP = 2.95;
export const FIG_S = 2.95;
const POINT_DIR_LOCAL = norm([-0.78, 0.27, 0.4]);
const GLASS_DIR_LOCAL = norm([-0.66, 0.36, 0.5]);
export const FIG_YAW = Math.atan2(BEACON_DIR.x, BEACON_DIR.z) - Math.atan2(-POINT_DIR_LOCAL[0], POINT_DIR_LOCAL[2]);

interface Cols { S: RGB; S2: RGB; SH: RGB; acc: RGB; dark: RGB }
const SIDES = 10;

function limb(b: Builder, a: V3, c: V3, ra: number, rc: number, col: RGB) { b.prism(a, c, ra, rc, SIDES, col, { caps: false }); b.ball(a, ra * 1.0, col, 1, 1, 1, 1); b.ball(c, rc * 1.0, col, 1, 1, 1, 1); }

/** Pleated skirt / coat tail: a cone whose radius alternates to carve folds. */
function pleat(b: Builder, top: V3, bot: V3, rt: number, rb: number, n: number, depth: number, col: RGB, flareBack = 0) {
  const rings = 4; const R: V3[][] = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings; const c = add(top, mul(sub(bot, top), t)); const r = rt + (rb - rt) * t; const ring: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2; const f = 1 + (i % 2 ? depth : -depth) * t;
      const back = Math.max(0, -Math.cos(a)) * flareBack * t * t;
      ring.push([c[0] + Math.sin(a) * r * f, c[1], c[2] + Math.cos(a) * r * f - back]);
    }
    R.push(ring);
  }
  b.withHint(add(top, mul(sub(bot, top), 0.5)), () => {
    for (let k = 0; k < rings; k++) for (let i = 0; i < n; i++) { const j = (i + 1) % n; b.quad(R[k][i], R[k][j], R[k + 1][j], R[k + 1][i], col, k === rings - 1 ? mix(col, PAL.stoneHair, 0.25) : col); }
  });
}

/** Head with a carved face, looking along local +Z. */
function head(b: Builder, c: V3, r: number, col: RGB, hair: RGB, dark: RGB, female: boolean) {
  b.ball(c, r, col, 0.92, 1.06, 1.0, 2);
  b.ball([c[0], c[1] - r * 0.55, c[2] + r * 0.35], r * 0.42, col, 1.1, 0.8, 1, 1);             // jaw / chin
  b.prism([c[0], c[1] + r * 0.05, c[2] + r * 0.88], [c[0], c[1] - r * 0.32, c[2] + r * 1.12], r * 0.13, r * 0.08, 6, col); // nose
  for (const sd of [-1, 1]) {
    b.ball([c[0] + sd * r * 0.36, c[1] + r * 0.12, c[2] + r * 0.82], r * 0.16, dark, 1.1, 0.7, 0.5, 1);  // eye socket
    b.ball([c[0] + sd * r * 0.36, c[1] + r * 0.13, c[2] + r * 0.86], r * 0.08, col, 1, 0.8, 0.6, 1);     // eyeball
    b.prism([c[0] + sd * r * 0.12, c[1] + r * 0.33, c[2] + r * 0.88], [c[0] + sd * r * 0.58, c[1] + r * 0.28, c[2] + r * 0.74], r * 0.07, r * 0.05, 5, col); // brow
    b.ball([c[0] + sd * r * 0.94, c[1], c[2] - r * 0.05], r * 0.22, col, 0.45, 1, 0.75, 1);              // ear
    b.ball([c[0] + sd * r * 0.42, c[1] - r * 0.2, c[2] + r * 0.72], r * 0.2, col, 1, 0.8, 0.6, 1);       // cheek
  }
  b.prism([c[0] - r * 0.2, c[1] - r * 0.47, c[2] + r * 0.86], [c[0] + r * 0.2, c[1] - r * 0.44, c[2] + r * 0.86], r * 0.04, r * 0.04, 5, dark); // mouth (smiling)
  b.ball([c[0] - r * 0.22, c[1] - r * 0.42, c[2] + r * 0.84], r * 0.05, dark, 1, 1, 1, 0); b.ball([c[0] + r * 0.22, c[1] - r * 0.42, c[2] + r * 0.84], r * 0.05, dark, 1, 1, 1, 0);
  // hair cap
  b.ball([c[0], c[1] + r * 0.22, c[2] - r * 0.12], r * 1.04, hair, 1.0, female ? 0.86 : 0.78, 1.04, 2);
  if (female) for (let i = 0; i < 6; i++) { const x = -0.6 + i * 0.24; b.prism([c[0] + x * r, c[1] + r * 0.82, c[2] + r * 0.45], [c[0] + x * r * 1.25 + 0.02, c[1] + r * 0.34, c[2] + r * 0.86], r * 0.13, r * 0.03, 5, hair); }
}

function hand(b: Builder, wrist: V3, dir: V3, col: RGB, pose: 'point' | 'flat' | 'fist', s = 1) {
  const d = norm(dir); const side = norm(cross(d, [0, 1, 0])); const up = norm(cross(side, d));
  const palm = add(wrist, mul(d, 0.05 * s));
  b.ball(palm, 0.045 * s, col, 1.15, 0.7, 1.3, 1);
  if (pose === 'fist') { b.ball(add(palm, mul(d, 0.04 * s)), 0.042 * s, col, 1.2, 0.9, 1, 1); return; }
  for (let f = 0; f < 4; f++) {
    const o = add(palm, mul(side, (f - 1.5) * 0.022 * s));
    if (pose === 'point' && f !== 1) { b.ball(add(add(o, mul(d, 0.035 * s)), mul(up, -0.012 * s)), 0.017 * s, col, 1, 1, 1, 0); continue; }
    const len = (pose === 'point' ? 0.1 : 0.075 - Math.abs(f - 1.5) * 0.008) * s;
    const tip = add(add(o, mul(d, len)), mul(up, pose === 'flat' ? -0.03 * s : 0));
    b.prism(add(o, mul(d, 0.02 * s)), tip, 0.012 * s, 0.009 * s, 5, col);
  }
  b.prism(add(palm, mul(side, -0.04 * s)), add(add(palm, mul(side, -0.06 * s)), mul(d, 0.05 * s)), 0.013 * s, 0.01 * s, 5, col); // thumb
}

function ellie(b: Builder, c: Cols) {
  const { S, S2, SH, acc, dark } = c;
  // legs: front striding, back heel-up
  limb(b, [0.085, 0.88, 0.03], [0.11, 0.5, 0.2], 0.075, 0.06, S2);
  limb(b, [0.11, 0.5, 0.2], [0.115, 0.14, 0.24], 0.06, 0.047, S2);
  b.prism([0.115, 0.36, 0.24], [0.115, 0.14, 0.25], 0.07, 0.065, SIDES, SH, { caps: false }); // boot cuff
  b.taperBox([0.115, 0.0, 0.29], 0.11, 0.27, [0.115, 0.15, 0.25], 0.12, 0.15, SH);
  limb(b, [-0.085, 0.88, -0.02], [-0.1, 0.5, -0.13], 0.075, 0.06, S2);
  limb(b, [-0.1, 0.5, -0.13], [-0.105, 0.2, -0.33], 0.06, 0.047, S2);
  b.prism([-0.105, 0.42, -0.2], [-0.105, 0.22, -0.33], 0.07, 0.066, SIDES, SH, { caps: false });
  b.prism([-0.105, 0.2, -0.39], [-0.105, 0.03, -0.22], 0.062, 0.052, 7, SH);
  // pleated tunic skirt, flaring back in the wind
  pleat(b, [0, 1.0, 0.01], [0, 0.6, -0.06], 0.17, 0.3, 18, 0.08, S, 0.1);
  // torso + belt with buckle
  b.taperBox([0, 0.9, 0], 0.28, 0.18, [0, 1.36, 0.05], 0.34, 0.19, S);
  b.ball([0, 1.2, 0.08], 0.13, S, 1.25, 0.9, 0.7, 1); // chest volume
  b.taperBox([0, 0.9, 0], 0.31, 0.21, [0, 0.97, 0.005], 0.31, 0.21, SH);
  b.box(0, 0.935, 0.11, 0.07, 0.06, 0.02, acc);
  b.box(-0.19, 0.86, -0.02, 0.09, 0.17, 0.2, SH); // satchel
  b.prism([0.15, 1.34, 0.05], [-0.17, 0.92, -0.02], 0.024, 0.024, 4, SH);
  // neck, head looking up toward the far sky
  limb(b, [0, 1.34, 0.04], [0, 1.46, 0.08], 0.05, 0.045, S);
  b.push(); b.T(0, 1.57, 0.09); b.RX(-0.18); b.T(0, -1.57, -0.09);
  head(b, [0, 1.57, 0.09], 0.13, S, SH, dark, true);
  b.pop();
  // ponytail streaming in the wind, with a tie
  b.chain([[0, 1.66, -0.06], [0.0, 1.64, -0.18], [0.04, 1.6, -0.3], [0.1, 1.6, -0.44], [0.17, 1.64, -0.58], [0.23, 1.7, -0.68]], [0.06, 0.066, 0.06, 0.05, 0.035, 0.014], SH);
  b.prism([0, 1.66, -0.12], [0.0, 1.65, -0.17], 0.068, 0.068, 8, acc);
  // scarf + tails
  b.prism([0, 1.33, 0.03], [0, 1.4, 0.05], 0.1, 0.085, SIDES, acc);
  b.sheet((u, v) => { const x = -0.05 + u * 0.1, z = -0.05 - v * 0.6, y = 1.36 - v * 0.05 + Math.sin(v * 5) * 0.04; return [x + v * 0.12 + Math.sin(v * 6) * 0.03, y, z]; }, 2, 7, () => acc);
  // the pointing arm, flung out to the sky
  const sh: V3 = [-0.19, 1.33, 0.03];
  const el = add(sh, mul(POINT_DIR_LOCAL, 0.29)), wr = add(sh, mul(POINT_DIR_LOCAL, 0.53));
  b.ball(sh, 0.075, S, 1, 1, 1, 1);
  limb(b, sh, el, 0.064, 0.054, S); limb(b, el, wr, 0.054, 0.04, S);
  b.prism(add(sh, mul(POINT_DIR_LOCAL, 0.04)), add(sh, mul(POINT_DIR_LOCAL, 0.2)), 0.078, 0.066, SIDES, S2, { caps: false }); // sleeve
  hand(b, wr, POINT_DIR_LOCAL, S, 'point', 1.1);
  // other arm swung back holding a rolled chart
  const ls: V3 = [0.19, 1.33, 0.0], le: V3 = [0.26, 1.1, -0.1], lh: V3 = [0.28, 0.93, -0.17];
  b.ball(ls, 0.066, S, 1, 1, 1, 1); limb(b, ls, le, 0.052, 0.045, S); limb(b, le, lh, 0.045, 0.037, S);
  hand(b, lh, [0, -0.6, -0.4], S, 'fist');
  b.prism([0.28, 0.92, -0.36], [0.28, 0.95, 0.02], 0.045, 0.045, SIDES, acc);
  b.prism([0.28, 0.92, -0.37], [0.28, 0.92, -0.33], 0.05, 0.05, SIDES, SH);
}

function felix(b: Builder, g: Builder, c: Cols, cloak: RGB): V3 {
  const { S, S2, SH, acc, dark } = c;
  limb(b, [0.13, 0.95, 0.02], [0.17, 0.52, 0.13], 0.088, 0.072, S2);
  limb(b, [0.17, 0.52, 0.13], [0.18, 0.15, 0.14], 0.072, 0.057, S2);
  b.prism([0.18, 0.42, 0.15], [0.18, 0.16, 0.15], 0.085, 0.08, SIDES, SH, { caps: false });
  b.taperBox([0.18, 0.0, 0.19], 0.14, 0.3, [0.18, 0.2, 0.15], 0.15, 0.17, SH);
  limb(b, [-0.13, 0.95, -0.02], [-0.17, 0.52, -0.12], 0.088, 0.072, S2);
  limb(b, [-0.17, 0.52, -0.12], [-0.19, 0.15, -0.2], 0.072, 0.057, S2);
  b.prism([-0.19, 0.42, -0.18], [-0.19, 0.16, -0.2], 0.085, 0.08, SIDES, SH, { caps: false });
  b.taperBox([-0.19, 0.0, -0.15], 0.14, 0.3, [-0.19, 0.2, -0.18], 0.15, 0.17, SH);
  pleat(b, [0, 1.02, 0], [0, 0.64, -0.04], 0.21, 0.29, 16, 0.06, S2, 0.06);
  b.taperBox([0, 0.95, 0], 0.37, 0.24, [0, 1.47, 0.02], 0.56, 0.29, S);
  b.ball([0, 1.26, 0.07], 0.17, S, 1.35, 0.85, 0.7, 1);
  b.taperBox([0, 0.94, 0], 0.4, 0.27, [0, 1.02, 0.0], 0.4, 0.27, SH);
  b.box(0, 0.98, 0.14, 0.1, 0.09, 0.02, acc);
  for (const sd of [-1, 1]) { b.ball([sd * 0.28, 1.45, 0.0], 0.115, cloak, 1.15, 0.8, 1.15, 1); b.ball([sd * 0.28, 1.47, 0.0], 0.06, acc, 1, 0.6, 1, 0); }
  // collar strap across the chest
  b.prism([0.22, 1.42, 0.12], [-0.16, 1.0, 0.13], 0.025, 0.025, 4, SH);
  limb(b, [0, 1.46, 0.02], [0, 1.57, 0.04], 0.066, 0.06, S);
  head(b, [0, 1.69, 0.05], 0.145, S, SH, dark, false);
  for (let i = 0; i < 7; i++) { const a = -0.75 + i * 0.25; b.prism([Math.sin(a) * 0.1, 1.8, -0.02 + Math.cos(a) * 0.06], [Math.sin(a) * 0.16, 1.92, -0.15], 0.05, 0.0, 5, SH); }
  // spyglass to the eye, sighting along Ellie's arm (bronze)
  const eye: V3 = [-0.05, 1.72, 0.16];
  const D = GLASS_DIR_LOCAL;
  const sgA = add(eye, mul(D, 0.02)), sgB = add(eye, mul(D, 0.55));
  b.prism(sgA, add(sgA, mul(D, 0.2)), 0.04, 0.04, 12, acc);
  b.prism(add(sgA, mul(D, 0.2)), add(sgA, mul(D, 0.215)), 0.05, 0.05, 12, mix(acc, PAL.white, 0.25));
  b.prism(add(sgA, mul(D, 0.215)), sgB, 0.05, 0.06, 12, acc);
  b.prism(add(sgA, mul(D, 0.38)), add(sgA, mul(D, 0.395)), 0.062, 0.062, 12, mix(acc, PAL.white, 0.25));
  b.prism(sgB, add(sgB, mul(D, 0.04)), 0.072, 0.072, 12, acc);
  g.M = b.M;
  g.prism(add(sgB, mul(D, 0.035)), add(sgB, mul(D, 0.05)), 0.06, 0.06, 12, hex('#fff2c0'));
  const lens = add(sgB, mul(D, 0.05));
  const ls: V3 = [0.27, 1.42, 0.0], le: V3 = [0.2, 1.38, 0.3], lh = add(eye, mul(D, 0.3));
  limb(b, ls, le, 0.066, 0.056, S); limb(b, le, lh, 0.056, 0.046, S); hand(b, lh, D, S, 'fist');
  const rs: V3 = [-0.27, 1.42, 0.0], re: V3 = [-0.4, 1.35, 0.3], rh: V3 = [-0.47, 1.33, 0.54];
  limb(b, rs, re, 0.066, 0.056, S); limb(b, re, rh, 0.056, 0.046, S); hand(b, rh, [-0.15, -0.2, 1], S, 'flat');
  // cloak with real folds, billowing back
  b.sheet((u, v) => {
    const th = (u - 0.5) * Math.PI * 1.05;
    const rx = 0.28 + v * 0.3, rz = 0.16 + v * 0.22;
    let x = Math.sin(th) * rx, z = -0.04 - Math.cos(th) * rz;
    const y = 1.47 - v * 0.98 + v * v * 0.1;
    z -= v * v * 0.32; x += v * v * 0.16 * (0.6 + u * 0.6);
    z += Math.sin(u * 7 + v * 4) * 0.045 * v - Math.abs(Math.sin(u * 18)) * 0.03 * v;
    return [x, y, z];
  }, 18, 8, () => cloak);
  b.push(); b.T(-0.02, 1.18, -0.36); b.RX(-0.25);
  b.prism([0, 0, 0.02], [0, 0, -0.06], 0.31, 0.29, 20, S2, { rot: 0.1 });
  b.prism([0, 0, -0.06], [0, 0, -0.075], 0.25, 0.25, 20, cloak, { rot: 0.1 });
  b.prism([0, 0, -0.05], [0, 0, -0.11], 0.08, 0.05, 12, acc);
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.ball([Math.cos(a) * 0.28, Math.sin(a) * 0.28, -0.065], 0.018, acc, 1, 1, 1, 0); }
  b.pop();
  return lens;
}

/** Builds plinth + figures. Statue mesh goes to `b` (smoothed later), bronze to `bronze`, lens glow to `g`. */
export function buildStatue(b: Builder, g: Builder, x: number, y: number, z: number, bronze: Builder = b): V3 {
  const oct = { rot: Math.PI / 8 };
  const stone = hex('#d8c8ad'), stoneD = hex('#bcaa8f'), stoneL = hex('#ecdfc7');
  b.aoFn = (p: V3) => 0.78 + 0.22 * Math.min(1, Math.max(0, (p[1] - y) / 1.2));
  b.prism([x, y - 0.6, z], [x, y + 0.36, z], 4.3, 4.25, 8, stoneD, { ...oct, capB: stone });
  b.prism([x, y + 0.36, z], [x, y + 0.44, z], 4.32, 4.32, 8, stoneL, oct);
  b.prism([x, y + 0.44, z], [x, y + 0.78, z], 3.65, 3.6, 8, stoneD, { ...oct, capB: stone });
  b.prism([x, y + 0.78, z], [x, y + 0.86, z], 3.0, 2.9, 8, stoneL, oct);
  b.prism([x, y + 0.86, z], [x, y + 2.35, z], 2.7, 2.55, 8, stone, oct);
  // carved recessed panels on each face of the drum
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4; const nx = Math.sin(a), nz = Math.cos(a);
    if (k === 4) continue; // plaque face (south)
    b.push(); b.T(x + nx * 2.43, y + 1.55, z + nz * 2.43); b.RY(a); b.RX(-0.08);
    b.box(0, 0, 0, 1.25, 1.05, 0.06, stoneD); b.box(0, 0, 0.02, 1.05, 0.85, 0.05, stone);
    b.ball([0, 0, 0.06], 0.24, stoneL, 1, 1, 0.3, 1); // carved rosette
    b.pop();
  }
  b.prism([x, y + 2.35, z], [x, y + 2.47, z], 2.85, 2.95, 8, stoneL, oct);
  b.prism([x, y + 2.47, z], [x, y + 2.65, z], 3.0, 3.0, 8, stone, { ...oct, capB: stoneL });
  b.prism([x, y + 2.65, z], [x, y + PLINTH_TOP, z], 2.5, 2.4, 8, stoneL, oct);
  bronze.prism([x, y + 1.82, z], [x, y + 1.98, z], 2.64, 2.62, 8, hex('#b98745'), oct);
  // plaque frame (the inscription is a separate textured quad)
  bronze.push(); bronze.T(x, y + 1.38, z - 2.46); bronze.RY(Math.PI); bronze.RX(0.08);
  bronze.box(0, 0, 0, 1.78, 0.86, 0.07, hex('#9a6c36'));
  bronze.pop();
  // laurel wreath under the plaque
  for (let i = 0; i < 14; i++) { const a = Math.PI * (0.15 + 0.7 * i / 13); bronze.ball([x + Math.cos(a) * 0.55, y + 0.93 - Math.sin(a) * 0.04, z - 2.53], 0.07, hex('#7fa36a'), 1.6, 0.6, 0.6, 0); }
  // banners hanging from the cornice
  b.aoFn = null;
  const oldW = b.windFn;
  for (const a of [Math.PI * 1.25, Math.PI * 1.75, Math.PI * 0.5]) {
    const bx = x + Math.cos(a) * 3.04, bz = z + Math.sin(a) * 3.04;
    b.push(); b.T(bx, y + 2.6, bz); b.RY(Math.atan2(Math.cos(a), Math.sin(a)));
    b.windFn = (p: V3) => Math.max(0, y + 2.6 - p[1]) * 0.07;
    b.sheet((u, v) => [(u - 0.5) * 0.95, -v * 1.6, 0.05 + Math.sin(v * 3) * 0.06], 2, 6, (_i, j) => j === 5 ? PAL.gold : hex('#c9473a'));
    b.pop();
  }
  b.windFn = oldW;
  // figures
  b.aoFn = (p: V3) => 0.8 + 0.2 * Math.min(1, Math.max(0, (p[1] - y - PLINTH_TOP) / 2.5));
  b.push(); b.T(x, y + PLINTH_TOP, z); b.RY(FIG_YAW); b.SC(FIG_S); b.SC(-1, 1, 1);
  b.taperBox([0.0, -0.04, -0.1], 1.35, 1.6, [0.0, 0.06, -0.1], 1.25, 1.5, stoneD);
  b.ball([0.45, 0.06, 0.4], 0.12, stone, 1.3, 0.5, 1, 1); b.ball([-0.5, 0.06, -0.6], 0.14, stone, 1.3, 0.5, 1, 1); // carved rocks
  const ellieCols: Cols = { S: hex('#f1e4cc'), S2: hex('#e6d5b8'), SH: hex('#d9b98a'), acc: hex('#c98a4e'), dark: hex('#a99478') };
  const felixCols: Cols = { S: hex('#e9dcc4'), S2: hex('#d9c8aa'), SH: hex('#c8b08a'), acc: hex('#c98a4e'), dark: hex('#a08c70') };
  b.push(); b.T(-0.3, 0.06, 0.2); ellie(b, ellieCols); b.pop();
  b.push(); b.T(0.3, 0.06, -0.45); b.SC(1.08);
  const lensL = felix(b, g, felixCols, hex('#5f9f8c'));
  const lensW = b.tp(lensL);
  b.pop();
  b.pop();
  b.aoFn = null;
  return lensW;
}

/** Bronze plaque with the inscription. */
export function buildPlaque(scene: Scene, x: number, y: number, z: number): Mesh {
  const W = 512, H = 240;
  const t = new DynamicTexture('statue_plaque', { width: W, height: H }, scene, true);
  const g = t.getContext() as unknown as CanvasRenderingContext2D;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#c9944e'); bg.addColorStop(0.5, '#b07a3a'); bg.addColorStop(1, '#8c5c2a');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#e8c27a'; g.lineWidth = 6; g.strokeRect(12, 12, W - 24, H - 24);
  g.strokeStyle = '#6e4620'; g.lineWidth = 2; g.strokeRect(22, 22, W - 44, H - 44);
  const text = (s: string, yy: number, size: number, font: string) => {
    g.font = `${font} ${size}px Georgia, 'Times New Roman', serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f3d79a'; g.fillText(s, W / 2 + 1.5, yy + 1.5);
    g.fillStyle = '#4a2c10'; g.fillText(s, W / 2, yy);
  };
  text('ELLIE  &  FELIX', 82, 52, 'bold');
  text('who found the way, and made it possible', 140, 22, 'italic');
  text('~ fair winds to the Two ~', 186, 24, 'italic');
  t.update();
  const m = MeshBuilder.CreatePlane('statue_plaque', { width: 1.62, height: 0.76 }, scene);
  const mat = new StandardMaterial('statue_plaquemat', scene);
  mat.diffuseTexture = t; mat.specularColor = new Color3(0.35, 0.28, 0.16); mat.specularPower = 32; mat.emissiveColor = new Color3(0.18, 0.14, 0.1);
  m.material = mat; m.position.set(x, y + 1.38, z - 2.505); m.rotation.x = -0.08; m.isPickable = false;
  m.freezeWorldMatrix();
  return m;
}
