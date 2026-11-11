// The valley around Shady Grove: terrain to the horizon, river, east road, hedgerows,
// fields, woods, farms, sheep and distant blue mountains.
import { Builder, hex, mix, tint, type RGB, type V3 } from './mesh';
import { Kit, PAL, house, tree, lantern } from './parts';
import {
  groundHeight as H, riverX, roadZ, bandR, ROAD_X0, WATER_Y, GROVE_TREES, FARMS, BEACON_C, BEACON_DIR, vnoise, smooth, type Obstacle,
} from './layout';
import { onPath } from './town';

const circ = (x: number, z: number, r: number): Obstacle => ({ kind: 'c', x, z, r });
function h2(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }

const WOODS: [number, number, number][] = [
  [135, 42, 40], [150, -35, 38], [108, -82, 26], [72, 150, 40], [-5, -165, 45], [215, 170, 60], [240, -205, 55],
  [-125, 125, 45], [-150, -175, 55], [330, 40, 70], [40, -270, 60], [-260, 40, 60], [120, 260, 70], [-60, 330, 70], [-330, -260, 80],
];
export function woodAt(x: number, z: number) {
  let w = 0; for (const [cx, cz, r] of WOODS) { const d = Math.hypot(x - cx, z - cz); if (d < r) w = Math.max(w, 1 - smooth(r * 0.55, r, d)); }
  return w;
}
const FIELD_COLS: RGB[] = [hex('#e9c46a'), hex('#9fd36a'), hex('#7cc760'), hex('#c7d96a'), hex('#b98a5a'), hex('#a5d873'), hex('#e3b45c')];
const FA = 0.35, FCX = 52, FCZ = 38;
function fieldCell(x: number, z: number) {
  const c = Math.cos(FA), s = Math.sin(FA);
  const u = x * c + z * s, v = -x * s + z * c;
  return [Math.floor(u / FCX), Math.floor(v / FCZ)] as const;
}
function fieldOk(x: number, z: number) {
  const r = Math.hypot(x, z);
  if (r < 118 || r > 560) return false;
  if (Math.abs(x - riverX(z)) < 26) return false;
  if (x > ROAD_X0 && Math.abs(z - roadZ(x)) < 9) return false;
  if (woodAt(x, z) > 0.2) return false;
  if (Math.hypot(x - BEACON_C.x, z - BEACON_C.z) < 70) return false;
  return true;
}
const grassBase = (x: number, z: number): RGB => {
  const n = vnoise(x * 0.06 + 3, z * 0.06 + 7);
  let c = mix(PAL.grass2, PAL.grass, n);
  c = mix(c, hex('#a5d873'), Math.max(0, vnoise(x * 0.11, z * 0.11) - 0.55) * 1.4);
  return c;
};
function shadeAt(x: number, z: number) { let s = 0; for (const [tx, tz, sc] of GROVE_TREES) { const d = Math.hypot(x - tx, z - tz); s = Math.max(s, 1 - Math.min(1, Math.max(0, (d - sc * 1.6) / (sc * 1.8)))); } return s; }
function groundCol(x: number, z: number, y: number): RGB {
  const r = Math.hypot(x, z);
  let c = grassBase(x, z);
  if (r < 60) c = mix(c, PAL.shade, shadeAt(x, z) * 0.75);
  if (fieldOk(x, z)) { const [i, j] = fieldCell(x, z); c = mix(c, FIELD_COLS[Math.floor(h2(i, j) * FIELD_COLS.length)], 0.85); }
  const w = woodAt(x, z); if (w > 0) c = mix(c, hex('#4f9a55'), w * 0.8);
  if (y < WATER_Y + 0.7 && Math.abs(x - riverX(z)) < 22) c = mix(c, hex('#d9c38f'), Math.min(1, (WATER_Y + 0.7 - y) / 0.6));
  if (y > 25) c = mix(c, hex('#8fbf6a'), Math.min(1, (y - 25) / 40));
  c = mix(c, hex('#9dbb95'), smooth(140, 1200, r) * 0.55);
  return c;
}

/** Cheap far tree: trunk + one or two faceted blobs. */
function farTree(b: Builder, x: number, y: number, z: number, s: number, kind: number) {
  const lc = kind === 1 ? hex('#5cbf86') : kind === 2 ? hex('#6fbf55') : PAL.leaf2;
  b.prism([x, y - 0.3, z], [x, y + 1.6 * s, z], 0.18 * s, 0.12 * s, 4, PAL.woodDark, { caps: false });
  if (kind === 1) b.prism([x, y + 0.9 * s, z], [x, y + 4.4 * s, z], 1.1 * s, 0, 6, hex('#3f8f5f')); // conifer
  else { b.ball([x, y + 2.2 * s, z], 1.25 * s, lc, 1, 0.85, 1, 0, 0.3, tint(lc, 0.75)); if (s > 1.6) b.ball([x + 0.6 * s, y + 1.8 * s, z + 0.3 * s], 0.8 * s, lc, 1, 0.85, 1, 0, 0.3, tint(lc, 0.75)); }
}

function hedge(b: Builder, ax: number, az: number, bx: number, bz: number, hgt = 1.5) {
  const L = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.round(L / 9));
  const yaw = Math.atan2(bx - ax, bz - az);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; const y = H(x, z);
    b.push(); b.T(x, y, z); b.RY(yaw);
    b.taperBox([0, -0.9, 0], 1.3, L / n + 0.2, [0, hgt, 0], 0.9, L / n + 0.1, hex('#4f9e58'), hex('#5fb05e'));
    b.pop();
  }
}

export interface CountryOut { obstacles: Obstacle[] }

/**
 * terrain: the ground mesh; band: near trees/hedges/sheep (casts shadows);
 * far: woods, farms, mountains; water: river; glow: windows/lamps.
 */
export function buildCountryside(terrain: Builder, band: Kit, far: Kit, water: Builder, mount: Builder): CountryOut {
  const obs: Obstacle[] = [];
  // ───── terrain: polar mesh to the horizon ─────
  const radii: number[] = []; for (let j = 0; j <= 30; j++) radii.push(j * 3.2);
  while (radii[radii.length - 1] < 2000) radii.push(radii[radii.length - 1] * 1.085);
  const NA = 128;
  const ring = radii.map((r, j) => {
    const out: V3[] = [];
    for (let i = 0; i < NA; i++) {
      const a = i / NA * Math.PI * 2;
      const rr = j === 0 ? 0 : r * (1 + (h2(i, j) - 0.5) * (j > 30 ? 0.08 : 0.03));
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr; out.push([x, H(x, z), z]);
    }
    return out;
  });
  const ringCol = ring.map(rr => rr.map(p => groundCol(p[0], p[2], p[1])));
  terrain.cj = 0.012;
  terrain.withHint('up', () => {
    for (let j = 0; j < ring.length - 1; j++) for (let i = 0; i < NA; i++) {
      const k = (i + 1) % NA;
      const A = ring[j][i], B = ring[j][k], C = ring[j + 1][i], D = ring[j + 1][k];
      const cA = ringCol[j][i], cB = ringCol[j][k], cC = ringCol[j + 1][i], cD = ringCol[j + 1][k];
      if (j === 0) { terrain.tri(A, D, C, cA, cD, cC); continue; }
      if ((i + j) % 2) { terrain.tri(A, B, D, cA, cB, cD); terrain.tri(A, D, C, cA, cD, cC); }
      else { terrain.tri(A, B, C, cA, cB, cC); terrain.tri(B, D, C, cB, cD, cC); }
    }
  });

  // ───── river ─────
  water.withHint('up', () => {
    let z = -2000;
    while (z < 2000) {
      const step = Math.abs(z) < 160 ? 4 : 30; const z1 = z + step;
      const x0 = riverX(z), x1 = riverX(z1), w = 12;
      const col = h2(Math.floor(z / 4), 3) > 0.7 ? hex('#a9e0ec') : hex('#7cc4d8');
      water.quad([x0 - w, WATER_Y, z], [x0 + w, WATER_Y, z], [x1 + w, WATER_Y, z1], [x1 - w, WATER_Y, z1], col);
      z = z1;
    }
  });
  // reeds + stepping stones along the town bank
  for (let z = -90; z < 90; z += 3.5) {
    if (Math.abs(z - 22) < 6) continue; // jetty
    const x = riverX(z) + 9 + h2(z, 1) * 2; const y = H(x, z);
    if (y > WATER_Y + 0.5 || h2(z, 7) < 0.4) continue;
    for (let q = 0; q < 4; q++) band.b.prism([x + h2(z, q) - 0.5, y - 0.2, z + h2(q, z) - 0.5], [x + h2(z, q) - 0.5 + 0.1, y + 1.2 + h2(q, q + z), z + h2(q, z) - 0.5], 0.07, 0, 3, q % 2 ? hex('#6fae5a') : hex('#8fbf5a'));
  }

  // ───── east road to Normandy ─────
  {
    const b = far.b;
    let x = ROAD_X0;
    b.withHint('up', () => {
      while (x < 1900) {
        const step = x < 140 ? 2.4 : x < 400 ? 8 : 30; const x1 = x + step;
        const z0 = roadZ(x), z1 = roadZ(x1); const w = x < 400 ? 1.9 : 3;
        const lift = x < 140 ? 0.07 : x < 400 ? 0.35 : 1.2;
        const v = 0.93 + 0.12 * h2(Math.floor(x / 2.4), 5);
        const grass = hex('#7fbb5c'), dirt = tint(hex('#d2a673'), v), rut = tint(hex('#a97c52'), v), crown = mix(hex('#c9b178'), grass, 0.35);
        const S = [-w - 0.9, -w, -w * 0.62, -w * 0.3, 0, w * 0.3, w * 0.62, w, w + 0.9];
        const C = [grass, dirt, rut, crown, crown, crown, rut, dirt, grass];
        const P = (xx: number, zc: number, s: number): V3 => [xx, H(xx, zc + s) + lift - (Math.abs(s) > w ? 0.03 : 0), zc + s];
        for (let k = 0; k < S.length - 1; k++) b.quad(P(x, z0, S[k]), P(x1, z1, S[k]), P(x1, z1, S[k + 1]), P(x, z0, S[k + 1]), C[k], C[k + 1]);
        x = x1;
      }
    });
  }
  // signpost just past the grove
  {
    const b = band.b; const sx = 52, sz = roadZ(52) + 3.2, sy = H(sx, sz);
    b.prism([sx, sy - 0.3, sz], [sx, sy + 3.0, sz], 0.1, 0.09, 5, PAL.woodDark);
    b.push(); b.T(sx, sy + 2.5, sz);
    b.box(0.55, 0, 0, 1.3, 0.34, 0.07, PAL.woodLight); b.prism([1.2, 0, 0], [1.5, 0, 0], 0.2, 0, 3, PAL.woodLight, { rot: Math.PI / 2 }); // east: Normandy
    b.box(0.6, 0, 0.04, 0.9, 0.1, 0.02, PAL.roof1);
    b.box(-0.5, -0.45, 0, 1.1, 0.3, 0.07, PAL.woodLight); b.prism([-1.05, -0.45, 0], [-1.3, -0.45, 0], 0.18, 0, 3, PAL.woodLight, { rot: Math.PI / 2 }); // west: town
    b.box(-0.5, -0.45, 0.04, 0.7, 0.08, 0.02, PAL.roof3);
    b.ball([0, 0.45, 0], 0.12, PAL.gold, 1, 1, 1, 0);
    b.pop();
    obs.push(circ(sx, sz, 0.4));
  }

  // ───── walkable-band boundary: hedge ring + tree belt, road gate ─────
  let gateX = 80; while (Math.hypot(gateX, roadZ(gateX)) < bandR(Math.atan2(roadZ(gateX), gateX)) - 1.5) gateX += 0.5;
  {
    const N = 240; let prev: [number, number] | null = null;
    for (let i = 0; i <= N; i++) {
      const a = i / N * Math.PI * 2; const r = bandR(a) - 0.2; const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const blockedSeg = x < riverX(z) + 6 || (x > 0 && Math.abs(z - roadZ(x)) < 3.2);
      if (blockedSeg) { prev = null; continue; }
      if (prev) hedge(band.b, prev[0], prev[1], x, z, 1.6);
      prev = [x, z];
    }
    // belt of trees beyond the hedge
    const rng = far.b.rng;
    for (let i = 0; i < 110; i++) {
      const a = i / 110 * Math.PI * 2 + rng.r(-0.02, 0.02);
      for (const off of [4.5, 12]) {
        const r = bandR(a) + off + rng.r(-1.5, 1.5); const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (x < riverX(z) + 10 || (x > 0 && Math.abs(z - roadZ(x)) < 6)) continue;
        if (off === 4.5 && i % 2 === 0) tree(band.b, x, H(x, z), z, rng.r(1.4, 1.9), i % 5 === 0 ? 1 : i % 3 === 0 ? 2 : 0);
        else farTree(far.b, x, H(x, z), z, rng.r(1.5, 2.3), (i + Math.round(off)) % 4 === 0 ? 1 : 0);
      }
    }
    // farm gate across the road
    const b = band.b; const gz = roadZ(gateX), gy = H(gateX, gz);
    for (const s of [-2.6, 2.6]) b.prism([gateX, gy - 0.3, gz + s], [gateX, gy + 1.5, gz + s], 0.14, 0.12, 5, PAL.timber);
    for (const yy of [0.45, 0.9, 1.3]) b.prism([gateX, gy + yy, gz - 2.6], [gateX, gy + yy, gz + 2.6], 0.06, 0.06, 4, PAL.woodLight);
    b.prism([gateX, gy + 0.45, gz - 2.5], [gateX, gy + 1.3, gz + 2.5], 0.05, 0.05, 4, PAL.woodLight);
    lantern(band, gateX - 1, gy, gz + 3.4, 2.8, Math.PI / 2);
  }

  // ───── scattered trees + sheep in the band ─────
  {
    const rng = band.b.rng; let placed = 0;
    for (let i = 0; i < 300 && placed < 26; i++) {
      const a = rng.r(0, 6.28), r = rng.r(54, 92); const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (x < riverX(z) + 14 || onPath(x, z, 4) || (x > ROAD_X0 - 4 && Math.abs(z - roadZ(x)) < 7) || r > bandR(a) - 6) continue;
      if (obs.some(o => o.kind === 'c' && Math.hypot(o.x - x, o.z - z) < 9)) continue;
      const s = rng.r(1.1, 1.6); tree(band.b, x, H(x, z), z, s, placed % 4 === 0 ? 1 : placed % 3 === 0 ? 2 : 0);
      obs.push(circ(x, z, 0.25 * s + 0.25)); placed++;
    }
    for (let i = 0; i < 9; i++) {
      const x = 62 + rng.r(-10, 12), z = 42 + rng.r(-9, 9), y = H(x, z), yaw = rng.r(0, 6.28);
      const b = band.b; b.push(); b.T(x, y, z); b.RY(yaw);
      b.ball([0, 0.75, 0], 0.55, PAL.white, 1.35, 0.85, 1, 0, 0.35, hex('#ece6dc'));
      b.ball([0, 0.95, 0.75], 0.24, hex('#3d3340'), 0.9, 1.1, 1.2, 0);
      for (const [lx, lz] of [[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.4], [0.3, 0.4]]) b.prism([lx, 0.5, lz], [lx, -0.05, lz], 0.07, 0.06, 4, hex('#3d3340'), { caps: false });
      b.pop(); obs.push(circ(x, z, 0.9));
    }
  }

  // ───── fields, hedgerows ─────
  {
    const c = Math.cos(FA), s = Math.sin(FA);
    const w = (u: number, v: number): [number, number] => [u * c - v * s, u * s + v * c];
    for (let i = -12; i <= 12; i++) for (let j = -16; j <= 16; j++) {
      const [x0, z0] = w(i * FCX, j * FCZ), [x1, z1] = w((i + 1) * FCX, j * FCZ), [x2, z2] = w(i * FCX, (j + 1) * FCZ);
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, nx = (x0 + x2) / 2, nz = (z0 + z2) / 2;
      const r = Math.hypot(mx, mz);
      if (r > 380) continue;
      if (fieldOk(mx, mz) && h2(i, j + 50) > 0.35) { hedge(far.b, x0, z0, x1, z1, 1.4); if (h2(i, j) > 0.6) farTree(far.b, x0, H(x0, z0), z0, 1.6, 0); }
      if (fieldOk(nx, nz) && h2(i + 50, j) > 0.35) hedge(far.b, x0, z0, x2, z2, 1.4);
    }
  }

  // ───── woods ─────
  {
    const rng = far.b.rng;
    for (const [cx, cz, R] of WOODS) {
      const n = Math.round(R * R / 120);
      for (let i = 0; i < n; i++) {
        const a = rng.r(0, 6.28), rr = Math.sqrt(rng.next()) * R * 0.9; const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        if (Math.hypot(x, z) < bandR(Math.atan2(z, x)) + 8 || Math.abs(x - riverX(z)) < 16 || (x > ROAD_X0 && Math.abs(z - roadZ(x)) < 8)) continue;
        if (FARMS.some(f => Math.hypot(f.x - x, f.z - z) < 32)) continue;
        farTree(far.b, x, H(x, z), z, rng.r(1.6, 2.6) * (Math.hypot(cx, cz) > 250 ? 1.4 : 1), rng.next() < 0.3 ? 1 : rng.next() < 0.5 ? 2 : 0);
      }
    }
  }

  // ───── farms ─────
  for (const f of FARMS) {
    const y = H(f.x, f.z);
    const fc = Math.cos(f.yaw), fs = Math.sin(f.yaw);
    const P = (lx: number, lz: number): [number, number] => [f.x + fc * lx + fs * lz, f.z - fs * lx + fc * lz];
    const [hx, hz] = P(-6, 2); house(far, hx, y, hz, 6, 5, 4.6, f.yaw, PAL.wall, PAL.roof1, { chimney: true, foundation: 1.5 });
    const [bx, bz] = P(7, -2); house(far, bx, y, bz, 7, 9, 5.5, f.yaw + Math.PI / 2, hex('#c0605a'), hex('#5d4675'), { foundation: 1.5, door: true, rh: 4.5 });
    const [sx, sz] = P(13, 5); far.b.prism([sx, y - 0.5, sz], [sx, y + 9, sz], 1.6, 1.6, 8, hex('#d8e6ee'), { caps: false }); far.b.prism([sx, y + 9, sz], [sx, y + 11, sz], 1.8, 0, 8, PAL.roof3);
    for (let q = 0; q < 4; q++) { const [px, pz] = P(-2 + q * 2.4, 9); far.b.prism([px - 0.5, y + 0.6, pz], [px + 0.5, y + 0.6, pz], 0.6, 0.6, 8, hex('#f2c66a')); }
    const yard = [P(-12, -8), P(16, -8), P(16, 13), P(-12, 13)];
    for (let q = 0; q < 4; q++) { const [ax, az] = yard[q], [cx2, cz2] = yard[(q + 1) % 4]; far.b.prism([ax, H(ax, az) + 0.8, az], [cx2, H(cx2, cz2) + 0.8, cz2], 0.06, 0.06, 4, PAL.woodLight, { caps: false }); }
    for (let q = 0; q < 3; q++) { const [tx, tz] = P(-14 + q * 3, -11 - q); tree(far.b, tx, H(tx, tz), tz, 1.6, q === 1 ? 1 : 0); }
  }

  // ───── distant blue mountains ─────
  {
    const b = mount; const rng = b.rng;
    const bdA = Math.atan2(BEACON_DIR.z, BEACON_DIR.x);
    for (let i = 0; i < 44; i++) {
      const a = i / 44 * Math.PI * 2 + rng.r(-0.05, 0.05);
      const da = Math.abs(Math.atan2(Math.sin(a - bdA), Math.cos(a - bdA)));
      const mult = 0.3 + 0.7 * smooth(0.15, 0.55, da);
      for (const layer of [0, 1]) {
        const r = (layer ? 1850 : 1450) + rng.r(-120, 120);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        const hgt = rng.r(120, 300) * mult * (layer ? 1.5 : 1), base = rng.r(220, 340) * (layer ? 1.3 : 1);
        const tip: V3 = [x + rng.r(-60, 60), 20 + hgt, z + rng.r(-60, 60)];
        const col = layer ? hex('#a9b9dc') : hex('#8ea3d0');
        b.prism([x, 0, z], tip, base, 0, 7, col, { rot: rng.r(0, 1), col2: hex('#c3cde6') });
        if (hgt > 220) b.prism([tip[0], tip[1] - hgt * 0.18, tip[2]], tip, base * 0.19, 0, 7, hex('#eef0fa'));
      }
    }
  }
  return { obstacles: obs };
}
