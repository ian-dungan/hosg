// Reusable low-poly props (houses, trees, lamps, ships, islands, clouds, waterfalls).
import { Builder, hex, tint, add, mul, norm, lerp3, hash, vnoise, type RGB, type V3 } from './mesh';
import { PALETTE } from '../core/contracts';

export const PAL = {
  stone: hex(PALETTE.stone), stone2: hex('#dcc5a0'), stoneHair: hex('#cfb38c'), plinth: hex('#b9a993'), plinthDark: hex('#8f7f70'),
  gold: hex(PALETTE.gold), verd: hex('#4fb3a0'), pave1: hex('#efe2c9'), pave2: hex('#dcc6a2'), pave3: hex('#c9ae86'),
  grass: hex(PALETTE.meadow), grass2: hex('#7cc760'), grassDark: hex('#5aa95a'), shade: hex('#5f9f5c'),
  soil: hex('#f0a56b'), rock1: hex('#e07f5a'), rock2: hex(PALETTE.cliff), rock3: hex('#8e4f68'), rock4: hex(PALETTE.rock),
  wall: hex('#f6ead6'), wall2: hex('#f4d2b4'), wall3: hex('#d8e6ee'), timber: hex('#7d5136'),
  roof1: hex(PALETTE.roof), roof2: hex('#d9553f'), roof3: hex(PALETTE.teal), roof4: hex('#f0a33a'),
  wood: hex('#8a5a3c'), woodDark: hex('#5e3b2a'), woodLight: hex('#c9925e'), sail: hex('#fbf1dc'), sailStripe: hex('#f06a50'),
  leaf1: hex('#71c45a'), leaf2: hex('#4fae63'), leafDeep: hex('#3f9a5a'), blossom: hex('#ff9aa6'), blossom2: hex('#e8728a'),
  cloud: hex(PALETTE.cloud), water: hex('#d8f3ff'), lamp: hex('#ffd27a'), window: hex('#ffc861'),
  flowerA: hex('#ff7a8a'), flowerB: hex('#ffd36a'), flowerC: hex('#ff8a5c'), white: hex('#ffffff'),
};
const WALLS = [PAL.wall, PAL.wall2, PAL.wall3];
export const ROOFS = { roof: PAL.roof1, roof2: PAL.roof2, teal: PAL.roof3, orange: PAL.roof4 } as const;

/** Lit builder + unlit glow builder that share transforms. */
export class Kit {
  constructor(public b: Builder, public g: Builder) {}
  glow(f: (g: Builder) => void) { this.g.M = this.b.M; f(this.g); }
}

function roofSlope(b: Builder, a: V3, bb: V3, c: V3, e: V3, col: RGB) {
  const rows = 4;
  for (let k = 0; k < rows; k++) {
    const t0 = k / rows, t1 = (k + 1) / rows;
    const A = lerp3(a, e, t0), B = lerp3(bb, c, t0), C = lerp3(bb, c, t1), E = lerp3(a, e, t1);
    const lift: V3 = [0, 0.07, 0];
    b.quad(A, B, add(C, lift), add(E, lift), tint(col, k % 2 ? 1.0 : 0.9));
  }
}

export interface HouseOpts { door?: boolean; chimney?: boolean; shutter?: RGB; rh?: number; foundation?: number; storeys?: number }
/** House with front (door) facing local +Z. Origin at ground centre. */
export function house(k: Kit, x: number, y: number, z: number, w: number, d: number, h: number, yaw: number, wall: RGB, roof: RGB, opt: HouseOpts = {}) {
  const b = k.b;
  b.push(); b.T(x, y, z); b.RY(yaw);
  const fd = opt.foundation ?? 1.2;
  b.box(0, 0.25 - fd / 2, 0, w + 0.3, fd + 0.5, d + 0.3, PAL.plinth, PAL.pave2);
  b.box(0, h / 2 + 0.25, 0, w, h - 0.5 + 0.0001, d, wall);
  b.box(0, h * 0.55, 0, w + 0.06, 0.18, d + 0.06, PAL.timber);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * w / 2, h / 2, sz * d / 2, 0.22, h, 0.22, PAL.timber);
  const shut = opt.shutter || [PAL.roof3, PAL.roof1, hex('#4a7fd0')][Math.floor(b.rng.next() * 3)];
  const win = (wx: number, wy: number, wz: number, side: number) => { // side 0 = front, ±1 = side faces
    const sx = side ? 0.06 : 0.66, sz = side ? 0.66 : 0.06;
    b.box(wx, wy, wz, sx, 0.82, sz, PAL.timber);
    k.glow(g => g.box(wx + side * 0.03, wy, wz + (side ? 0 : 0.03), side ? 0.06 : 0.46, 0.58, side ? 0.46 : 0.06, PAL.window));
    if (!side) {
      b.box(wx - 0.44, wy, wz + 0.03, 0.2, 0.74, 0.05, shut); b.box(wx + 0.44, wy, wz + 0.03, 0.2, 0.74, 0.05, shut);
      b.box(wx, wy - 0.48, wz + 0.13, 0.72, 0.16, 0.24, PAL.woodDark);
      for (let i = 0; i < 3; i++) b.ball([wx - 0.22 + i * 0.22, wy - 0.35, wz + 0.16], 0.13, [PAL.flowerA, PAL.flowerB, PAL.flowerC][i], 1, 0.8, 1, 0);
    }
  };
  const nwin = Math.max(1, Math.floor(w / 1.7));
  const storeys = opt.storeys ?? (h > 4.8 ? 2 : 1);
  const rows = storeys === 2 ? [h * 0.3, h * 0.75] : [h * 0.55];
  for (let i = 0; i < nwin; i++) {
    const wx = -w / 2 + (i + 0.5) * w / nwin;
    for (let r = 0; r < rows.length; r++) {
      const isDoor = opt.door !== false && r === 0 && i === Math.floor(nwin / 2);
      if (!isDoor) win(wx, rows[r], d / 2 + 0.03, 0);
    }
  }
  const nside = Math.max(1, Math.floor(d / 2));
  for (let i = 0; i < nside; i++) { const wz = -d / 2 + (i + 0.5) * d / nside; win(-w / 2 - 0.03, rows[rows.length - 1], wz, -1); win(w / 2 + 0.03, rows[rows.length - 1], wz, 1); }
  if (opt.door !== false) {
    const dx = -w / 2 + (Math.floor(nwin / 2) + 0.5) * w / nwin;
    b.box(dx, 0.95, d / 2 + 0.04, 0.9, 1.9, 0.08, PAL.woodDark);
    b.box(dx, 1.95, d / 2 + 0.06, 1.1, 0.14, 0.12, PAL.timber);
    b.box(dx, 0.08, d / 2 + 0.45, 1.2, 0.16, 0.6, PAL.pave2);
  }
  // gable roof, ridge along the longer side
  const o = 0.45, rh = opt.rh || Math.min(w, d) * 0.6;
  b.withHint([0, h, 0], () => {
    if (w >= d) {
      const a: V3 = [-w / 2 - o, h, d / 2 + o], bb: V3 = [w / 2 + o, h, d / 2 + o], c: V3 = [w / 2 + o, h + rh, 0], e: V3 = [-w / 2 - o, h + rh, 0], f: V3 = [-w / 2 - o, h, -d / 2 - o], g: V3 = [w / 2 + o, h, -d / 2 - o];
      roofSlope(b, a, bb, c, e, roof); roofSlope(b, g, f, e, c, roof);
      const gh = rh * (d / 2) / (d / 2 + o);
      b.tri([-w / 2, h, d / 2], [-w / 2, h + gh, 0], [-w / 2, h, -d / 2], wall);
      b.tri([w / 2, h, d / 2], [w / 2, h, -d / 2], [w / 2, h + gh, 0], wall);
      b.quad(a, [a[0], a[1] - 0.16, a[2]], [bb[0], bb[1] - 0.16, bb[2]], bb, tint(roof, 0.7));
      b.quad(g, [g[0], g[1] - 0.16, g[2]], [f[0], f[1] - 0.16, f[2]], f, tint(roof, 0.7));
    } else {
      const a: V3 = [w / 2 + o, h, -d / 2 - o], bb: V3 = [w / 2 + o, h, d / 2 + o], c: V3 = [0, h + rh, d / 2 + o], e: V3 = [0, h + rh, -d / 2 - o], f: V3 = [-w / 2 - o, h, -d / 2 - o], g: V3 = [-w / 2 - o, h, d / 2 + o];
      roofSlope(b, a, bb, c, e, roof); roofSlope(b, g, f, e, c, roof);
      const gh = rh * (w / 2) / (w / 2 + o);
      b.tri([w / 2, h, d / 2], [0, h + gh, d / 2], [-w / 2, h, d / 2], wall);
      b.tri([w / 2, h, -d / 2], [-w / 2, h, -d / 2], [0, h + gh, -d / 2], wall);
    }
  });
  if (w < d) k.glow(g => g.box(0, h + rh * 0.3, d / 2 + 0.04, 0.45, 0.5, 0.06, PAL.window));
  if (opt.chimney) { b.box(w * 0.25, h + rh * 0.75, -d * 0.18, 0.55, rh * 1.1, 0.55, PAL.plinth); b.box(w * 0.25, h + rh * 1.32, -d * 0.18, 0.7, 0.14, 0.7, PAL.plinthDark); }
  b.pop();
}

/** Tree. kind 0 = green, 1 = blossom, 2 = teal-green, 3 = big old grove oak. */
export function tree(b: Builder, x: number, y: number, z: number, s: number, kind = 0) {
  b.push(); b.T(x, y, z); b.RY(hash(x, z) * 6.28); b.SC(s, s, s);
  const lc = kind === 1 ? PAL.blossom : kind === 2 ? hex('#5cbf86') : kind === 3 ? hex('#6cbf55') : PAL.leaf1;
  const lc2 = kind === 1 ? PAL.blossom2 : kind === 2 ? hex('#3d9a74') : kind === 3 ? PAL.leafDeep : PAL.leaf2;
  if (kind === 3) {
    // gnarled old trunk with root flare and two big limbs
    b.prism([0, -0.3, 0], [0.05, 1.4, 0.02], 0.42, 0.3, 7, PAL.woodDark);
    for (let i = 0; i < 5; i++) { const a = i / 5 * 6.28 + 0.4; b.prism([0, 0.35, 0], [Math.cos(a) * 0.75, -0.1, Math.sin(a) * 0.75], 0.16, 0.05, 4, PAL.woodDark); }
    b.prism([0.05, 1.3, 0.02], [0.75, 2.5, 0.2], 0.24, 0.14, 6, PAL.woodDark);
    b.prism([0.05, 1.3, 0.02], [-0.7, 2.4, -0.25], 0.24, 0.14, 6, PAL.woodDark);
    b.prism([0.05, 1.3, 0.02], [0.0, 2.7, 0.0], 0.22, 0.12, 6, PAL.woodDark);
    b.ball([0.0, 3.05, 0], 1.45, lc, 1.15, 0.72, 1.15, 1, 0.35, lc2);
    b.ball([0.95, 2.65, 0.35], 1.0, lc, 1.1, 0.7, 1.1, 1, 0.3, lc2);
    b.ball([-0.9, 2.7, -0.35], 1.05, lc, 1.1, 0.72, 1.1, 1, 0.3, lc2);
    b.ball([0.15, 2.6, -0.95], 0.9, lc, 1.1, 0.7, 1.1, 1, 0.3, lc2);
    b.ball([-0.2, 2.55, 0.95], 0.85, lc, 1.1, 0.7, 1.1, 1, 0.3, lc2);
  } else {
    b.prism([0, -0.2, 0], [0.05, 1.6, 0.02], 0.16, 0.1, 5, PAL.woodDark);
    b.ball([0.05, 2.3, 0], 1.0, lc, 1.1, 0.85, 1.1, 1, 0.35, lc2);
    b.ball([0.55, 1.9, 0.25], 0.65, lc, 1, 0.85, 1, 1, 0.3, lc2);
    b.ball([-0.5, 2.0, -0.2], 0.7, lc, 1, 0.85, 1, 1, 0.3, lc2);
  }
  b.pop();
}

export function lantern(k: Kit, x: number, y: number, z: number, h = 3.0, yaw = 0) {
  const b = k.b;
  b.push(); b.T(x, y, z); b.RY(yaw);
  b.prism([0, -0.1, 0], [0, h, 0], 0.09, 0.07, 5, PAL.woodDark);
  b.box(0, 0.15, 0, 0.38, 0.32, 0.38, PAL.plinthDark);
  b.prism([0, h - 0.05, 0], [0.5, h + 0.05, 0], 0.045, 0.045, 4, PAL.woodDark);
  k.glow(g => g.ball([0.5, h - 0.36, 0], 0.21, hex('#ffcf6a'), 1, 1.2, 1, 0));
  b.prism([0.5, h - 0.13, 0], [0.5, h + 0.07, 0], 0.24, 0.05, 6, PAL.roof2);
  b.pop();
}

export function bunting(b: Builder, a: V3, c: V3, sag: number, n: number, cols: RGB[]) {
  b.withHint(null, () => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 0.7) / n, tm = (i + 0.35) / n;
      const p = (t: number): V3 => { const q = lerp3(a, c, t); q[1] -= Math.sin(t * Math.PI) * sag; return q; };
      const A = p(t0), B = p(t1), C = p(tm); C[1] -= 0.5;
      b.tri(A, B, C, cols[i % cols.length]);
    }
  });
  b.prism(a, c, 0.025, 0.025, 3, PAL.woodDark, { caps: false });
}

export function flag(b: Builder, base: V3, h: number, col: RGB, dir = 1) {
  b.prism(base, add(base, [0, h, 0]), 0.07, 0.045, 5, PAL.woodDark);
  b.ball(add(base, [0, h + 0.05, 0]), 0.1, PAL.gold, 1, 1, 1, 0);
  b.sheet((u, v) => [base[0] + dir * u * 1.7, base[1] + h - 0.1 - v * 0.95 + Math.sin(u * 4) * 0.12, base[2] + Math.sin(u * 5 + v) * 0.18 * u], 4, 1, (i) => i % 2 ? col : tint(col, 0.9));
}

export function ship(k: Kit, x: number, y: number, z: number, yaw: number, s: number, opt: { hull?: RGB; stripe?: RGB; sail?: RGB; wing?: RGB; masts?: number; noWings?: boolean } = {}) {
  const b = k.b;
  b.push(); b.T(x, y, z); b.RY(yaw); b.SC(s, s, s);
  const NS = 9, L = 12;
  const st: V3[][] = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const w = 1.7 * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.42) / 0.58, 2)));
    const yd = 1.3 + 0.9 * Math.pow(t, 3) + 0.7 * Math.pow(1 - t, 3);
    const yk = -1.35 * (w / 1.7) - 0.15;
    const zz = (t - 0.5) * L;
    st.push([[-w, yd, zz], [-w * 0.9, yd * 0.45, zz], [0, yk, zz], [w * 0.9, yd * 0.45, zz], [w, yd, zz]]);
  }
  const hullC = opt.hull || PAL.wood, keel = hex('#4f3628');
  b.withHint([0, 1.2, 0], () => {
    for (let i = 0; i < NS; i++) for (let q = 0; q < 4; q++) b.quad(st[i][q], st[i + 1][q], st[i + 1][q + 1], st[i][q + 1], q === 0 || q === 3 ? hullC : keel);
    for (let i = 0; i < NS; i++) for (const sd of [-1, 1]) {
      const a = st[i][sd < 0 ? 0 : 4], c = st[i + 1][sd < 0 ? 0 : 4];
      b.quad([a[0] * 1.02, a[1] - 0.05, a[2]], [c[0] * 1.02, c[1] - 0.05, c[2]], [c[0] * 1.02, c[1] - 0.45, c[2]], [a[0] * 1.02, a[1] - 0.45, a[2]], opt.stripe || PAL.sailStripe);
    }
    for (let q = 1; q < 4; q++) b.tri(st[0][0], st[0][q], st[0][q + 1], PAL.woodDark);
  });
  b.withHint([0, -5, 0], () => { for (let i = 0; i < NS; i++) b.quad(st[i][0], st[i][4], st[i + 1][4], st[i + 1][0], PAL.woodLight); });
  b.box(0, 2.0, -3.6, 2.4, 1.4, 2.6, PAL.wall2); b.box(0, 2.8, -3.6, 2.8, 0.25, 3.0, PAL.roof3);
  k.glow(g => g.box(0, 2.0, -2.28, 1.4, 0.4, 0.06, PAL.lamp));
  const masts: [number, number, number][] = opt.masts === 1 ? [[0.6, 8, 4.2]] : [[1.2, 10, 4.6], [-2.2, 8, 3.8]];
  for (const [mz, mh, sw] of masts) {
    b.prism([0, 1.3, mz], [0, mh, mz], 0.15, 0.1, 6, PAL.woodDark);
    for (let q = 0; q < 2; q++) {
      const y0 = 3.2 + q * (mh - 3.4) / 2, y1 = y0 + (mh - 3.6) / 2 - 0.2, ww = sw * (1 - q * 0.22);
      b.box(0, y1 + 0.1, mz, ww * 1.05, 0.12, 0.12, PAL.woodDark);
      b.sheet((u, v) => [(u - 0.5) * ww * (1 - v * 0.06), y1 - v * (y1 - y0), mz + 0.15 + Math.sin(u * Math.PI) * Math.sin(v * Math.PI * 0.9 + 0.2) * 0.9], 4, 3, (_i, j) => (j === 1 ? (opt.stripe || PAL.sailStripe) : (opt.sail || PAL.sail)));
    }
    b.sheet((u, v) => [Math.sin(u * 3) * 0.2, mh - 0.05 - v * 0.35 + u * 0.05, mz - u * 2.2], 3, 1, () => opt.stripe || PAL.sailStripe);
  }
  b.prism([0, 2.4, L / 2 - 0.4], [0, 4.0, L / 2 + 3.2], 0.1, 0.06, 5, PAL.woodDark);
  b.withHint(null, () => b.tri([0, 3.9, L / 2 + 3.0], [0, 9.5, 1.3], [0, 2.6, 1.6], opt.sail || PAL.sail));
  if (!opt.noWings) for (const sd of [-1, 1]) {
    const base: V3 = [sd * 1.6, 1.8, 0.3];
    for (let f = 0; f < 4; f++) {
      const a0 = 0.15 + f * 0.24, a1 = a0 + 0.22, r = 5.2 - f * 0.5;
      const p0 = add(base, [sd * Math.cos(a0) * r, Math.sin(a0) * r * 0.55, -f * 0.9 - 0.6]);
      const p1 = add(base, [sd * Math.cos(a1) * r, Math.sin(a1) * r * 0.55, -f * 0.9 - 1.6]);
      b.withHint(null, () => b.tri(base, p0, p1, f % 2 ? (opt.sail || PAL.sail) : (opt.wing || hex('#ffd36a'))));
    }
  }
  k.glow(g => g.ball([0, 3.4, -L / 2 - 0.2], 0.3, hex('#ffcf6a'), 1, 1.2, 1, 0));
  b.pop();
}

export function windmillBody(k: Kit, x: number, y: number, z: number, yaw: number, s: number) {
  const b = k.b;
  b.push(); b.T(x, y, z); b.RY(yaw); b.SC(s, s, s);
  b.prism([0, -0.6, 0], [0, 6, 0], 1.6, 1.15, 8, PAL.wall2, { caps: false });
  b.prism([0, 6, 0], [0, 8.2, 0], 1.45, 0.0, 8, PAL.roof2);
  k.glow(g => g.box(0, 2.6, 1.42, 0.5, 0.7, 0.1, PAL.window));
  b.box(0, 0.9, 1.5, 0.8, 1.6, 0.1, PAL.woodDark);
  b.prism([0, 6.3, 1.2], [0, 6.3, 1.9], 0.3, 0.3, 6, PAL.woodDark);
  b.pop();
}
/** Sails around local origin, spinning about local Z. */
export function windmillSails(b: Builder) {
  for (let i = 0; i < 4; i++) {
    b.push(); b.RZ(i * Math.PI / 2);
    b.box(0, 2.6, 0.2, 0.14, 5.2, 0.14, PAL.woodDark);
    b.box(0.55, 3.2, 0.25, 0.95, 3.6, 0.05, PAL.sail);
    b.box(0.55, 3.2, 0.27, 0.95, 0.6, 0.05, PAL.sailStripe);
    b.pop();
  }
}

export function lighthouse(k: Kit, x: number, y: number, z: number, r: number, h: number) {
  const b = k.b;
  b.push(); b.T(x, y, z);
  const bands = 6;
  for (let i = 0; i < bands; i++) {
    const y0 = i * h / bands, y1 = (i + 1) * h / bands, r0 = r * (1 - 0.2 * i / bands), r1 = r * (1 - 0.2 * (i + 1) / bands);
    b.prism([0, y0, 0], [0, y1, 0], r0, r1, 10, i % 2 ? PAL.roof1 : PAL.wall, { caps: false });
  }
  const rt = r * 0.8;
  b.prism([0, h, 0], [0, h + 0.6, 0], rt * 1.45, rt * 1.45, 10, PAL.plinth);
  k.glow(g => g.prism([0, h + 0.6, 0], [0, h + 2.6, 0], rt * 0.85, rt * 0.85, 8, hex('#ffd46a')));
  b.prism([0, h + 2.6, 0], [0, h + 5.2, 0], rt * 1.25, 0.0, 8, PAL.roof3);
  b.prism([0, h + 5.2, 0], [0, h + 6.4, 0], 0.08, 0.04, 4, PAL.gold);
  b.pop();
}

/** Floating island top + rocky underside (rings). Returns nothing; top is a simple cap. */
export function island(b: Builder, cx: number, cy: number, cz: number, Rr: number, depth: number, opt: { n?: number; seed?: number; tipOff?: [number, number]; dome?: number; bump?: number; noTop?: boolean; topCol?: RGB; topCol2?: RGB } = {}) {
  const n = opt.n || 18, s = opt.seed || 1;
  const rings: [number, number][] = [[0, 1.0], [-0.04, 1.03], [-0.16, 0.93], [-0.34, 0.74], [-0.55, 0.5], [-0.78, 0.25], [-1.0, 0.0]];
  const cols = [PAL.grassDark, PAL.soil, PAL.rock1, PAL.rock2, PAL.rock3, PAL.rock4];
  const P = rings.map((rg, ri) => {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2 + ri * 0.13;
      const kk = 1 + (vnoise(Math.cos(a) * 2 + s, Math.sin(a) * 2 + ri * 0.7 + s) - 0.5) * 0.35;
      const tip = rg[0] < -0.5 ? (opt.tipOff || [0, 0]) : [0, 0];
      const t = -rg[0];
      pts.push([cx + Math.cos(a) * Rr * rg[1] * kk + tip[0] * t, cy + rg[0] * depth + (ri > 0 ? (hash(i, ri + s) - 0.5) * depth * 0.06 : 0), cz + Math.sin(a) * Rr * rg[1] * kk + tip[1] * t]);
    }
    return pts;
  });
  const top = opt.topCol || PAL.grass, top2 = opt.topCol2 || PAL.grass2;
  const ctr: V3 = [cx, cy + (opt.dome || 0), cz];
  const inner = P[0].map((p): V3 => [cx + (p[0] - cx) * 0.55, cy + (opt.dome || 0) * 0.6 + (hash(p[0], p[2]) - 0.5) * (opt.bump || 0.8), cz + (p[2] - cz) * 0.55]);
  if (!opt.noTop) b.withHint('up', () => {
    for (let i = 0; i < n; i++) {
      const q = (i + 1) % n;
      b.tri(P[0][i], inner[q], P[0][q], top2); b.tri(P[0][i], inner[i], inner[q], top);
      b.tri(inner[i], ctr, inner[q], i % 2 ? top : top2);
    }
  });
  b.withHint([cx, cy - depth * 0.3, cz], () => {
    for (let r = 0; r < P.length - 1; r++) for (let i = 0; i < n; i++) {
      const q = (i + 1) % n; const col = cols[Math.min(r, cols.length - 1)];
      if (r === P.length - 2) b.tri(P[r][i], P[r][q], P[r + 1][i], col);
      else b.quad(P[r][i], P[r][q], P[r + 1][q], P[r + 1][i], col);
    }
  });
}

export function waterfall(b: Builder, top: V3, outward: V3, height: number, width: number, seed: number) {
  const segs = 10, strips = 4;
  const o = norm([outward[0], 0, outward[2]]); const side: V3 = [-o[2], 0, o[0]];
  const pt = (u: number, v: number): V3 => {
    const arc = Math.min(v * 6, 1);
    const out = (1 - Math.pow(1 - arc, 2)) * width * 0.9 + v * width * 0.3;
    const w = width * (0.5 + v * 1.4);
    const y = -Math.pow(v, 1.15) * height;
    return add(add(top, mul(o, out)), add(mul(side, (u - 0.5) * w), [0, y, 0]));
  };
  b.withHint(add(top, mul(o, -50)), () => {
    for (let i = 0; i < strips; i++) for (let j = 0; j < segs; j++) {
      const c = (i + j + seed) % 3 === 0 ? PAL.white : ((i + seed) % 2 ? hex('#cfeefc') : hex('#a9dcf5'));
      const a = pt(i / strips, j / segs), bb = pt((i + 1) / strips, j / segs), cc = pt((i + 1) / strips, (j + 1) / segs), d = pt(i / strips, (j + 1) / segs);
      b.tri(a, bb, cc, c); b.tri(a, cc, d, c);
    }
  });
}

export function cloudPuff(b: Builder, c: V3, r: number, flat = 0.55, detail = 1) {
  const n = 2 + Math.floor(b.rng.next() * 3);
  for (let i = 0; i < n; i++) b.ball(add(c, [b.rng.r(-1, 1) * r * 0.9, b.rng.r(0, 0.35) * r, b.rng.r(-1, 1) * r * 0.5]), r * b.rng.r(0.45, 0.85), PAL.cloud, 1, flat, 1, detail, 0.25, hex('#f3e6ef'));
}

export { WALLS };
