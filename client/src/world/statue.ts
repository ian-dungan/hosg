// The Statue of the Two: Ellie mid-stride pointing at the sky, Felix with a hand on her
// shoulder sighting along her arm through his spyglass. Built on a stepped octagonal plinth.
import { Builder, hex, add, mul, norm, type RGB, type V3 } from './mesh';
import { PAL } from './parts';
import { BEACON_DIR } from './layout';

export const PLINTH_TOP = 2.95;
export const FIG_S = 2.95;           // ~1.7 m model units -> ~5 m figures
// Local (pre-mirror) directions, as in the concept render.
const POINT_DIR_LOCAL = norm([-0.78, 0.5, 0.4]);
const GLASS_DIR_LOCAL = norm([-0.62, 0.62, 0.48]);
// We mirror X (concept was right-handed) so the local pointing direction becomes (+0.78, .., 0.4).
export const FIG_YAW = Math.atan2(BEACON_DIR.x, BEACON_DIR.z) - Math.atan2(-POINT_DIR_LOCAL[0], POINT_DIR_LOCAL[2]);

interface Cols { S: RGB; S2: RGB; SH: RGB; acc: RGB }

function ellie(b: Builder, c: Cols) {
  const { S, S2, SH, acc } = c;
  b.limb([0.085, 0.88, 0.03], [0.11, 0.5, 0.2], 0.075, 0.06, S2);
  b.limb([0.11, 0.5, 0.2], [0.115, 0.12, 0.24], 0.06, 0.047, S2);
  b.taperBox([0.115, 0.0, 0.28], 0.11, 0.26, [0.115, 0.16, 0.25], 0.12, 0.15, SH);
  b.limb([-0.085, 0.88, -0.02], [-0.1, 0.5, -0.13], 0.075, 0.06, S2);
  b.limb([-0.1, 0.5, -0.13], [-0.105, 0.18, -0.34], 0.06, 0.047, S2);
  b.prism([-0.105, 0.2, -0.38], [-0.105, 0.03, -0.22], 0.062, 0.052, 6, SH);
  b.prism([0, 1.0, 0.01], [0, 0.6, -0.08], 0.17, 0.3, 8, S, { caps: false });
  b.taperBox([0, 0.9, 0], 0.28, 0.18, [0, 1.36, 0.05], 0.34, 0.19, S);
  b.taperBox([0, 0.9, 0], 0.31, 0.21, [0, 0.97, 0.005], 0.31, 0.21, acc);
  b.box(-0.19, 0.86, -0.02, 0.09, 0.17, 0.2, SH);
  b.prism([0.15, 1.34, 0.05], [-0.17, 0.92, -0.02], 0.024, 0.024, 4, SH);
  b.limb([0, 1.34, 0.04], [0, 1.46, 0.08], 0.05, 0.045, S);
  b.ball([0, 1.57, 0.09], 0.13, S, 0.95, 1.05, 1.0, 1);
  b.prism([0.0, 1.575, 0.205], [0.0, 1.56, 0.245], 0.026, 0.007, 4, S);
  b.ball([0, 1.62, 0.05], 0.14, SH, 1.02, 0.92, 1.05, 1);
  // ponytail streaming in the wind
  b.chain([[0, 1.66, -0.06], [0.0, 1.64, -0.18], [0.04, 1.6, -0.3], [0.1, 1.6, -0.44], [0.17, 1.64, -0.58], [0.23, 1.7, -0.68]], [0.06, 0.065, 0.06, 0.05, 0.035, 0.014], SH);
  // scarf + tails
  b.prism([0, 1.33, 0.03], [0, 1.4, 0.05], 0.1, 0.085, 8, acc);
  b.sheet((u, v) => { const x = -0.05 + u * 0.1, z = -0.05 - v * 0.6, y = 1.36 - v * 0.05 + Math.sin(v * 5) * 0.04; return [x + v * 0.12 + Math.sin(v * 6) * 0.03, y, z]; }, 1, 5, () => acc);
  // the pointing arm, flung out to the sky (slightly thick so it reads from afar)
  const sh: V3 = [-0.19, 1.33, 0.03];
  const el = add(sh, mul(POINT_DIR_LOCAL, 0.29)), ha = add(sh, mul(POINT_DIR_LOCAL, 0.56));
  b.ball(sh, 0.072, S, 1, 1, 1, 0);
  b.limb(sh, el, 0.064, 0.055, S); b.limb(el, ha, 0.055, 0.045, S);
  b.ball(ha, 0.05, S, 1, 1, 1, 0);
  b.prism(ha, add(ha, mul(POINT_DIR_LOCAL, 0.12)), 0.024, 0.01, 4, S);
  // other arm swung back holding a rolled chart
  const ls: V3 = [0.19, 1.33, 0.0], le: V3 = [0.26, 1.1, -0.1], lh: V3 = [0.28, 0.93, -0.17];
  b.ball(ls, 0.064, S, 1, 1, 1, 0); b.limb(ls, le, 0.052, 0.045, S); b.limb(le, lh, 0.045, 0.037, S);
  b.prism([0.28, 0.93, -0.35], [0.28, 0.95, -0.0], 0.042, 0.042, 6, acc);
}

/** Returns the lens centre in builder-local coords (caller transforms). */
function felix(b: Builder, g: Builder, c: Cols, cloak: RGB): V3 {
  const { S, S2, SH, acc } = c;
  b.limb([0.13, 0.95, 0.02], [0.17, 0.52, 0.13], 0.088, 0.072, S2);
  b.limb([0.17, 0.52, 0.13], [0.18, 0.13, 0.14], 0.072, 0.057, S2);
  b.taperBox([0.18, 0.0, 0.19], 0.14, 0.3, [0.18, 0.2, 0.15], 0.15, 0.17, SH);
  b.limb([-0.13, 0.95, -0.02], [-0.17, 0.52, -0.12], 0.088, 0.072, S2);
  b.limb([-0.17, 0.52, -0.12], [-0.19, 0.13, -0.2], 0.072, 0.057, S2);
  b.taperBox([-0.19, 0.0, -0.15], 0.14, 0.3, [-0.19, 0.2, -0.18], 0.15, 0.17, SH);
  b.prism([0, 1.02, 0], [0, 0.66, -0.04], 0.21, 0.28, 8, S2, { caps: false });
  b.taperBox([0, 0.95, 0], 0.37, 0.24, [0, 1.47, 0.02], 0.56, 0.29, S);
  b.taperBox([0, 0.94, 0], 0.4, 0.27, [0, 1.02, 0.0], 0.4, 0.27, SH);
  b.box(0, 0.98, 0.14, 0.09, 0.08, 0.02, acc);
  b.ball([0.28, 1.45, 0.0], 0.11, cloak, 1.1, 0.8, 1.1, 1);
  b.ball([-0.28, 1.45, 0.0], 0.11, cloak, 1.1, 0.8, 1.1, 1);
  b.limb([0, 1.46, 0.02], [0, 1.57, 0.04], 0.066, 0.06, S);
  b.ball([0, 1.69, 0.05], 0.145, S, 0.95, 1.05, 1, 1);
  b.prism([0.0, 1.695, 0.185], [0.0, 1.68, 0.23], 0.028, 0.008, 4, S);
  b.ball([0, 1.75, 0.01], 0.145, SH, 1.02, 0.75, 1.05, 1);
  for (let i = 0; i < 6; i++) { const a = -0.6 + i * 0.35; b.prism([Math.sin(a) * 0.1, 1.8, -0.02 + Math.cos(a) * 0.06], [Math.sin(a) * 0.15, 1.9, -0.14], 0.05, 0.0, 4, SH); }
  // spyglass to the eye, sighting along Ellie's arm
  const eye: V3 = [-0.05, 1.72, 0.16];
  const D = GLASS_DIR_LOCAL;
  const sgA = add(eye, mul(D, 0.02)), sgB = add(eye, mul(D, 0.55));
  b.prism(sgA, add(sgA, mul(D, 0.2)), 0.04, 0.04, 8, acc);
  b.prism(add(sgA, mul(D, 0.2)), sgB, 0.05, 0.06, 8, acc);
  b.prism(sgB, add(sgB, mul(D, 0.04)), 0.07, 0.07, 8, acc);
  g.M = b.M;
  g.prism(add(sgB, mul(D, 0.035)), add(sgB, mul(D, 0.05)), 0.058, 0.058, 8, hex('#fff2c0'));
  const lens = add(sgB, mul(D, 0.05));
  // left arm steadies the glass
  const ls: V3 = [0.27, 1.42, 0.0], le: V3 = [0.2, 1.38, 0.3], lh = add(eye, mul(D, 0.34));
  b.limb(ls, le, 0.066, 0.056, S); b.limb(le, lh, 0.056, 0.046, S); b.ball(lh, 0.054, S, 1, 1, 1, 0);
  // right arm: hand on Ellie's shoulder
  const rs: V3 = [-0.27, 1.42, 0.0], re: V3 = [-0.4, 1.35, 0.3], rh: V3 = [-0.47, 1.33, 0.56];
  b.limb(rs, re, 0.066, 0.056, S); b.limb(re, rh, 0.056, 0.046, S); b.ball(rh, 0.058, S, 1.1, 0.8, 1.2, 0);
  // cloak billowing back
  b.sheet((u, v) => {
    const th = (u - 0.5) * Math.PI * 1.05;
    const rx = 0.28 + v * 0.3, rz = 0.16 + v * 0.22;
    let x = Math.sin(th) * rx, z = -0.04 - Math.cos(th) * rz;
    const y = 1.47 - v * 0.98 + v * v * 0.1;
    z -= v * v * 0.32; x += v * v * 0.16 * (0.6 + u * 0.6);
    z += Math.sin(u * 7 + v * 4) * 0.045 * v;
    return [x, y, z];
  }, 9, 6, () => cloak);
  // round shield on the back
  b.push(); b.T(-0.02, 1.18, -0.36); b.RX(-0.25);
  b.prism([0, 0, 0.02], [0, 0, -0.06], 0.31, 0.29, 12, S2, { rot: 0.1 });
  b.prism([0, 0, -0.06], [0, 0, -0.07], 0.24, 0.24, 12, cloak, { rot: 0.1 });
  b.prism([0, 0, -0.05], [0, 0, -0.1], 0.08, 0.05, 8, acc);
  b.pop();
  return lens;
}

/** Builds plinth + figures at (x, y, z). Returns the lens world position. */
export function buildStatue(b: Builder, g: Builder, x: number, y: number, z: number): V3 {
  const oct = { rot: Math.PI / 8 };
  b.prism([x, y - 0.6, z], [x, y + 0.42, z], 4.3, 4.2, 8, PAL.plinth, { ...oct, capB: PAL.pave2 });
  b.prism([x, y + 0.42, z], [x, y + 0.84, z], 3.65, 3.55, 8, PAL.plinth, { ...oct, capB: PAL.pave1 });
  b.prism([x, y + 0.84, z], [x, y + 2.35, z], 2.7, 2.55, 8, hex('#c8b49a'), oct);
  b.prism([x, y + 1.8, z], [x, y + 2.0, z], 2.63, 2.61, 8, hex('#c9944a'), oct);
  b.prism([x, y + 2.35, z], [x, y + 2.65, z], 2.95, 3.0, 8, PAL.plinth, { ...oct, capB: PAL.stone2 });
  b.prism([x, y + 2.65, z], [x, y + PLINTH_TOP, z], 2.5, 2.4, 8, PAL.stone2, oct);
  // bronze plaque facing the start (south) and two banners
  b.push(); b.T(x, y + 1.45, z); b.RY(Math.PI); b.box(0, 0, 2.62, 1.5, 0.55, 0.08, hex('#c9944a')); b.box(0, 0, 2.66, 1.2, 0.08, 0.04, PAL.gold); b.pop();
  for (const a of [Math.PI * 1.25, Math.PI * 1.75, Math.PI * 0.5]) {
    const bx = x + Math.cos(a) * 3.02, bz = z + Math.sin(a) * 3.02;
    b.push(); b.T(bx, y + 2.6, bz); b.RY(Math.atan2(Math.cos(a), Math.sin(a)));
    b.sheet((u, v) => [(u - 0.5) * 0.95, -v * 1.6, 0.05 + Math.sin(v * 3) * 0.06], 2, 4, (_i, j) => j === 3 ? PAL.gold : hex('#d9503f'));
    b.pop();
  }
  // figures
  b.push(); b.T(x, y + PLINTH_TOP, z); b.RY(FIG_YAW); b.SC(FIG_S); b.SC(-1, 1, 1);
  b.taperBox([0.0, -0.04, -0.1], 1.35, 1.6, [0.0, 0.06, -0.1], 1.25, 1.5, PAL.stone2);
  b.taperBox([-0.2, 0.0, 0.44], 0.3, 0.3, [-0.2, 0.1, 0.44], 0.26, 0.26, PAL.stone2);
  const ellieCols: Cols = { S: hex('#f3e2c2'), S2: hex('#e6d0aa'), SH: hex('#d9a75a'), acc: hex('#e27a52') };
  const felixCols: Cols = { S: hex('#e2d3b8'), S2: hex('#cdb995'), SH: hex('#b99a72'), acc: hex('#e0a53a') };
  b.push(); b.T(-0.3, 0.06, 0.2); ellie(b, ellieCols); b.pop();
  b.push(); b.T(0.3, 0.06, -0.45); b.SC(1.08);
  const lensL = felix(b, g, felixCols, hex('#4fa594'));
  const lensW = b.tp(lensL);
  b.pop();
  b.pop();
  return lensW;
}
