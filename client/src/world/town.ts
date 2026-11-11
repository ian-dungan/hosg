// Shady Grove: the island, the Plaza of the Two, houses, tavern, grove, dock.
import { Builder, hex, tint, mix, add, vnoise, hash, type RGB, type V3 } from './mesh';
import { Kit, PAL, ROOFS, WALLS, house, tree, lantern, bunting, flag, ship, windmillBody } from './parts';
import {
  groveR, groveHeight, PLAZA_R, PLINTH_R, HOUSES, STALLS, LAMPS, GROVE_TREES, TOWN_TREES, WINDMILL, TAVERN, TAVERN_YAW,
  BEACON_DIR, DOCK_ANGLE, DOCK_RIM, DOCK_START, DOCK_LEN, DOCK_HW, DOCK_Y, GROVE_CENTER, type Obstacle,
} from './layout';

const PERP = { x: -BEACON_DIR.z, z: BEACON_DIR.x };
const H = groveHeight;

export interface TownOut { obstacles: Obstacle[]; pimGround: V3; pimFacing: number; windmillHub: V3; windmillYaw: number; ferry: V3 }

const circ = (x: number, z: number, r: number): Obstacle => ({ kind: 'c', x, z, r });
const rect = (x: number, z: number, hw: number, hd: number, yaw: number): Obstacle => ({ kind: 'r', x, z, hw, hd, c: Math.cos(yaw), s: Math.sin(yaw) });

/** Distance from point to segment, and along-param. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az; const l2 = dx * dx + dz * dz;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
export const PATHS: { a: [number, number]; b: [number, number]; w: number }[] = [
  { a: [BEACON_DIR.x * (PLAZA_R - 1), BEACON_DIR.z * (PLAZA_R - 1)], b: [BEACON_DIR.x * (DOCK_RIM - 1), BEACON_DIR.z * (DOCK_RIM - 1)], w: 4.2 }, // main street
  { a: [PLAZA_R - 1, 0.5], b: [GROVE_CENTER.x - 6, 2.5], w: 3.0 },   // grove lane
  { a: [-1.5, PLAZA_R - 1], b: [-4, 40], w: 3.0 },                    // north lane
  { a: [-2.5, -PLAZA_R + 1], b: [-6, -40], w: 2.6 },                  // south lane
];
export function onPath(x: number, z: number, pad = 0) {
  for (const p of PATHS) if (segDist(x, z, p.a[0], p.a[1], p.b[0], p.b[1]) < p.w / 2 + pad) return true;
  return false;
}

export function buildTown(k: Kit, props: Kit): TownOut {
  const b = k.b;
  const obs: Obstacle[] = [];

  // ───── island top (polar mesh following groveHeight) ─────
  const NA = 96, NR = 22;
  const rim: number[] = []; for (let i = 0; i <= NA; i++) rim.push(groveR(i / NA * Math.PI * 2));
  const P = (i: number, j: number): V3 => {
    const a = i / NA * Math.PI * 2, t = j / NR;
    const tt = j === NR ? 1 : t * (0.97 + 0.03 * hash(i % NA, j)); // tiny jitter for facets
    const r = rim[i] * tt; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    return [x, H(x, z), z];
  };
  const shadeAt = (x: number, z: number) => { let s = 0; for (const [tx, tz, sc] of GROVE_TREES) { const d = Math.hypot(x - tx, z - tz); s = Math.max(s, 1 - Math.min(1, Math.max(0, (d - sc * 1.6) / (sc * 1.8)))); } return s; };
  const grassCol = (x: number, z: number): RGB => {
    const n = vnoise(x * 0.06 + 3, z * 0.06 + 7);
    let c = mix(PAL.grass2, PAL.grass, n);
    c = mix(c, hex('#a5d873'), Math.max(0, vnoise(x * 0.11, z * 0.11) - 0.55) * 1.4);
    c = mix(c, PAL.shade, shadeAt(x, z) * 0.75);
    return c;
  };
  const verts: V3[][] = []; for (let i = 0; i <= NA; i++) { verts.push([]); for (let j = 0; j <= NR; j++) verts[i].push(P(i % NA === 0 ? 0 : i, j)); }
  // make the seam exact
  for (let j = 0; j <= NR; j++) verts[NA][j] = verts[0][j];
  b.withHint('up', () => {
    for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
      const a = verts[i][j], bb = verts[i + 1][j], c = verts[i + 1][j + 1], d = verts[i][j + 1];
      const cx = (a[0] + c[0]) / 2, cz = (a[2] + c[2]) / 2;
      const col = grassCol(cx, cz);
      if (j === 0) b.tri(a, c, d, col);
      else { b.tri(a, bb, c, col); b.tri(a, c, d, tint(col, 0.97)); }
    }
  });
  // ───── rocky underside ─────
  const under: [number, number, RGB][] = [[-1.2, 1.015, PAL.soil], [-4.5, 0.95, PAL.rock1], [-11, 0.8, PAL.rock2], [-20, 0.58, PAL.rock2], [-31, 0.34, PAL.rock3], [-42, 0.14, PAL.rock4], [-52, 0.0, PAL.rock4]];
  const NU = 48;
  const ring = (k2: number): V3[] => {
    const out: V3[] = [];
    for (let i = 0; i <= NU; i++) {
      const ii = i % NU, a = ii / NU * Math.PI * 2;
      if (k2 < 0) { const r = groveR(a); const x = Math.cos(a) * r, z = Math.sin(a) * r; out.push([x, H(x, z), z]); continue; }
      const [dy, f] = under[k2];
      const r = groveR(a) * f * (1 + (vnoise(Math.cos(a) * 3 + k2, Math.sin(a) * 3) - 0.5) * 0.25);
      const tip = k2 >= 4 ? [-4 * (k2 - 3), 3 * (k2 - 3)] : [0, 0];
      out.push([Math.cos(a) * r + tip[0], dy + (k2 > 0 ? (hash(ii, k2) - 0.5) * 2.5 : 0), Math.sin(a) * r + tip[1]]);
    }
    return out;
  };
  let prev = ring(-1);
  for (let k2 = 0; k2 < under.length; k2++) {
    const cur = ring(k2);
    b.withHint([0, -18 + k2 * 0, 0], () => {
      for (let i = 0; i < NU; i++) b.quad(prev[i], prev[i + 1], cur[i + 1], cur[i], under[k2][2]);
    });
    prev = cur;
  }
  // a couple of small rock spurs hanging below
  for (const [ax, az, len] of [[18, -20, 16], [-22, -14, 12], [10, 26, 20]] as [number, number, number][]) {
    b.prism([ax, -6, az], [ax * 0.8, -6 - len, az * 0.8], 6, 0, 6, PAL.rock3);
  }

  // ───── Plaza of the Two ─────
  const ringsR = [PLINTH_R - 0.2, 4.9, 5.5, 6.4, 7.3, 8.2, 8.7, 9.6, 10.5, 11.4, 12.3, PLAZA_R];
  const oldCj = b.cj; b.cj = 0.05;
  b.withHint('up', () => {
    for (let r = 0; r < ringsR.length - 1; r++) {
      const segs = Math.round(ringsR[r + 1] * 6.5), off = (r % 2) * 0.5;
      for (let i = 0; i < segs; i++) {
        const a0 = (i + off) / segs * Math.PI * 2, a1 = (i + 1 + off) / segs * Math.PI * 2, r0 = ringsR[r], r1 = ringsR[r + 1];
        const col = r === 1 ? hex('#e9c27a') : r === 5 ? PAL.verd : hash(i, r) > 0.5 ? PAL.pave1 : hash(r, i) > 0.5 ? PAL.pave2 : hex('#e8d6b6');
        const y = 0.04;
        b.quad([Math.cos(a0) * r0, y, Math.sin(a0) * r0], [Math.cos(a0) * r1, y, Math.sin(a0) * r1], [Math.cos(a1) * r1, y, Math.sin(a1) * r1], [Math.cos(a1) * r0, y, Math.sin(a1) * r0], col);
      }
    }
    // gold compass rose inlay, the long north-west ray toward where Ellie points
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + DOCK_ANGLE, L = i % 2 ? 7.2 : 9.6;
      const y = 0.055, tip: V3 = [Math.cos(a) * (i === 0 ? 12.6 : L), y, Math.sin(a) * (i === 0 ? 12.6 : L)];
      const s1: V3 = [Math.cos(a + 0.09) * 5.5, y, Math.sin(a + 0.09) * 5.5], s2: V3 = [Math.cos(a - 0.09) * 5.5, y, Math.sin(a - 0.09) * 5.5];
      b.tri(s2, tip, s1, PAL.gold);
    }
  });
  b.cj = oldCj;
  // plaza kerb
  b.prism([0, -0.3, 0], [0, 0.12, 0], PLAZA_R + 0.25, PLAZA_R + 0.2, 48, PAL.plinth, { caps: false });
  obs.push(circ(0, 0, PLINTH_R));

  // ───── cobbled paths ─────
  for (const p of PATHS) {
    const [ax, az] = p.a, [bx, bz] = p.b; const L = Math.hypot(bx - ax, bz - az); const n = Math.ceil(L / 1.2);
    const dx = (bx - ax) / L, dz = (bz - az) / L, px = -dz, pz = dx;
    const cols = Math.max(2, Math.round(p.w / 1.05));
    b.withHint('up', () => {
      for (let i = 0; i < n; i++) {
        const t0 = i / n * L, t1 = (i + 1) / n * L;
        for (let c = 0; c < cols; c++) {
          const s0 = -p.w / 2 + c * p.w / cols + ((i % 2) ? 0.25 : 0), s1 = Math.min(p.w / 2, s0 + p.w / cols - 0.06);
          const pt = (t: number, s: number): V3 => { const x = ax + dx * t + px * s, z = az + dz * t + pz * s; return [x, H(x, z) + 0.06, z]; };
          const col = hash(i * 3.1 + ax, c) > 0.5 ? PAL.pave1 : hash(c, i * 1.7 + bz) > 0.4 ? PAL.pave2 : PAL.pave3;
          b.quad(pt(t0, s0), pt(t1 - 0.06, s0), pt(t1 - 0.06, s1), pt(t0, s1), col);
        }
      }
    });
  }

  // ───── houses ─────
  for (const h of HOUSES) {
    const y = Math.min(H(h.x, h.z), ...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
      const lx = sx * h.w / 2, lz = sz * h.d / 2; const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
      return H(h.x + c * lx + s * lz, h.z - s * lx + c * lz);
    }));
    house(k, h.x, y, h.z, h.w, h.d, h.h, h.yaw, WALLS[h.wall], ROOFS[h.roof], { chimney: h.chimney, foundation: 1.8 });
    obs.push(rect(h.x, h.z, h.w / 2 + 0.45, h.d / 2 + 0.45, h.yaw));
    // flower box hedge beside the door
    const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), rx = Math.cos(h.yaw), rz = -Math.sin(h.yaw);
    for (const sd of [-1, 1]) {
      const px = h.x + fz * 0 + fx * (h.d / 2 + 0.9) + rx * sd * (h.w / 2 - 0.3), pz = h.z + fz * (h.d / 2 + 0.9) + rz * sd * (h.w / 2 - 0.3);
      props.b.ball([px, H(px, pz) + 0.3, pz], 0.55, PAL.leaf2, 1.2, 0.75, 1, 0, 0.3, PAL.grassDark);
      props.b.ball([px, H(px, pz) + 0.72, pz], 0.14, [PAL.flowerA, PAL.flowerB, PAL.blossom][(h.wall + (sd > 0 ? 1 : 0)) % 3], 1, 0.8, 1, 0);
    }
  }

  // ───── harbour tavern "The Second Chance" with Pim the figurehead ─────
  const tv = TAVERN; const ty = Math.min(H(tv.x, tv.z), H(tv.x + 4, tv.z + 4), H(tv.x - 4, tv.z - 4), H(tv.x + 4, tv.z - 4), H(tv.x - 4, tv.z + 4));
  house(k, tv.x, ty, tv.z, tv.w, tv.d, 6.4, TAVERN_YAW, PAL.wall2, PAL.roof1, { chimney: true, foundation: 1.8, storeys: 2, shutter: PAL.roof3 });
  obs.push(rect(tv.x, tv.z, tv.w / 2 + 0.45, tv.d / 2 + 0.45, TAVERN_YAW));
  const fwd = { x: Math.sin(TAVERN_YAW), z: Math.cos(TAVERN_YAW) };
  const doorX = tv.x + fwd.x * (tv.d / 2), doorZ = tv.z + fwd.z * (tv.d / 2);
  b.push(); b.T(tv.x, ty, tv.z); b.RY(TAVERN_YAW);
  // porch roof + posts
  b.box(0, 3.05, tv.d / 2 + 1.1, 3.6, 0.16, 2.2, PAL.roof3);
  for (const sx of [-1.6, 1.6]) b.prism([sx, 0, tv.d / 2 + 2.0], [sx, 3.0, tv.d / 2 + 2.0], 0.1, 0.1, 5, PAL.timber);
  // hanging sign: a gold tankard on teal
  b.prism([2.6, 3.4, tv.d / 2], [2.6, 3.4, tv.d / 2 + 1.3], 0.05, 0.05, 4, PAL.woodDark);
  b.box(2.6, 2.75, tv.d / 2 + 1.15, 0.08, 1.0, 1.25, PAL.roof3);
  b.box(2.6, 2.75, tv.d / 2 + 1.15, 0.12, 0.5, 0.36, PAL.gold);
  // Pim: carved figurehead above the door, leaning out over the street
  b.push(); b.T(0, 3.9, tv.d / 2 + 0.15); b.RX(0.7); b.SC(1.35);
  b.box(0, -0.1, -0.1, 0.5, 0.25, 0.25, PAL.woodDark); // bracket
  b.taperBox([0, -0.2, 0.08], 0.36, 0.26, [0, 0.55, 0.18], 0.46, 0.3, PAL.woodLight);
  b.prism([0, 0.15, 0.14], [0, 0.42, 0.2], 0.25, 0.25, 8, PAL.roof3, { caps: false }); // teal sash
  b.limb([0, 0.55, 0.18], [0, 0.68, 0.22], 0.08, 0.07, PAL.woodLight);
  b.ball([0, 0.83, 0.26], 0.2, PAL.woodLight, 0.95, 1.05, 1, 1);
  b.prism([0, 0.84, 0.44], [0, 0.82, 0.52], 0.04, 0.01, 4, PAL.woodLight); // nose
  k.glow(g => { g.ball([0.08, 0.88, 0.43], 0.035, hex('#7ff0ff'), 1, 1, 1, 0); g.ball([-0.08, 0.88, 0.43], 0.035, hex('#7ff0ff'), 1, 1, 1, 0); });
  b.chain([[0, 0.98, 0.18], [0, 1.0, 0.0], [0.05, 0.92, -0.2], [0.0, 0.8, -0.38]], [0.17, 0.16, 0.12, 0.06], PAL.gold); // flowing gilded hair
  for (const sd of [-1, 1]) { // swept-back carved wings
    b.sheet((u, v) => [sd * (0.22 + u * 0.75), 0.45 + u * 0.35 - v * 0.55 * (1 - u * 0.5), 0.05 - u * 0.45], 3, 2, (i) => i === 2 ? PAL.gold : PAL.woodLight);
  }
  b.pop();
  b.pop();
  lantern(k, doorX + Math.cos(TAVERN_YAW) * 2.4 + fwd.x * 2.3, ty, doorZ - Math.sin(TAVERN_YAW) * 2.4 + fwd.z * 2.3, 3.0, TAVERN_YAW + Math.PI / 2);
  // barrels and crates by the tavern
  for (const [ox, oz] of [[-3.2, 1.0], [-3.9, 1.7], [-3.4, 2.4]]) {
    const px = doorX + Math.cos(TAVERN_YAW) * ox + fwd.x * oz, pz = doorZ - Math.sin(TAVERN_YAW) * ox + fwd.z * oz;
    b.prism([px, H(px, pz) - 0.1, pz], [px, H(px, pz) + 0.95, pz], 0.4, 0.4, 8, hex('#9a6040'), { capB: hex('#b07a50') });
    obs.push(circ(px, pz, 0.55));
  }
  // porch posts obstacle
  for (const sx of [-1.6, 1.6]) {
    const px = tv.x + Math.cos(TAVERN_YAW) * sx + fwd.x * (tv.d / 2 + 2.0), pz = tv.z - Math.sin(TAVERN_YAW) * sx + fwd.z * (tv.d / 2 + 2.0);
    obs.push(circ(px, pz, 0.3));
  }
  const pimGround: V3 = [doorX + fwd.x * 2.6, 0, doorZ + fwd.z * 2.6]; pimGround[1] = H(pimGround[0], pimGround[2]);
  const pimFacing = TAVERN_YAW + Math.PI;

  // ───── market stalls ─────
  const stallCols: Record<string, RGB> = { roof: PAL.roof1, teal: PAL.roof3, gold: PAL.roof4 };
  for (const st of STALLS) {
    b.push(); b.T(st.x, 0.04, st.z); b.RY(st.yaw);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.prism([sx * 1.2, 0, sz * 0.75], [sx * 1.2, 2.4, sz * 0.75], 0.07, 0.07, 4, PAL.woodDark);
    b.box(0, 0.45, 0.2, 2.3, 0.9, 1.0, PAL.wood, PAL.woodLight);
    for (let i = 0; i < 7; i++) b.ball([-0.9 + i * 0.3, 0.98, 0.15 + (i % 2) * 0.25], 0.16, [hex('#ff7a5c'), hex('#ffd36a'), PAL.leaf1, hex('#ff9aa6')][i % 4], 1, 0.8, 1, 0);
    for (let i = 0; i < 6; i++) { const x0 = -1.35 + i * 2.7 / 6, x1 = x0 + 2.7 / 6; b.withHint(null, () => b.quad([x0, 2.65, -0.95], [x1, 2.65, -0.95], [x1, 2.1, 1.3], [x0, 2.1, 1.3], i % 2 ? PAL.sail : stallCols[st.color])); }
    b.box(-1.7, 0.35, 0.6, 0.7, 0.7, 0.7, PAL.wood, hex('#b07a50'));
    b.pop();
    obs.push(rect(st.x, st.z, 1.75 + 0.6, 1.0, st.yaw));
  }
  // ───── lamps ─────
  for (const l of LAMPS) { lantern(k, l.x, 0.04, l.z, 3.1, Math.atan2(-l.x, -l.z) - Math.PI / 2); obs.push(circ(l.x, l.z, 0.35)); }
  // street lamps along main street
  for (const t of [20, 28, 36, 44]) {
    const sd = t % 16 === 4 ? 1 : -1;
    const x = BEACON_DIR.x * t + PERP.x * 2.9 * sd, z = BEACON_DIR.z * t + PERP.z * 2.9 * sd;
    lantern(k, x, H(x, z), z, 3.1, Math.atan2(-PERP.x * sd, -PERP.z * sd) - Math.PI / 2); obs.push(circ(x, z, 0.35));
  }
  // bunting across the plaza between lamps, and over the main street
  const lp = (i: number, y: number): V3 => [LAMPS[i].x, y, LAMPS[i].z];
  const bcols = [PAL.roof1, hex('#ffd36a'), PAL.roof3, PAL.sail];
  bunting(props.b, lp(0, 3.2), lp(1, 3.2), 0.6, 12, bcols);
  bunting(props.b, lp(1, 3.2), lp(2, 3.2), 0.7, 14, bcols);
  bunting(props.b, lp(2, 3.2), lp(3, 3.2), 0.6, 10, bcols);
  bunting(props.b, lp(4, 3.2), lp(5, 3.2), 0.6, 10, bcols);
  bunting(props.b, lp(5, 3.2), lp(6, 3.2), 0.6, 10, bcols);
  bunting(props.b, lp(6, 3.2), lp(7, 3.2), 0.6, 10, bcols);
  bunting(props.b, lp(7, 3.2), lp(0, 3.2), 0.6, 10, bcols);
  // bunting from the plinth to some lamps (festival)
  for (const i of [0, 2, 4, 6]) bunting(props.b, [Math.cos(Math.atan2(LAMPS[i].z, LAMPS[i].x)) * 2.4, 3.0, Math.sin(Math.atan2(LAMPS[i].z, LAMPS[i].x)) * 2.4], lp(i, 3.25), 0.8, 9, bcols);
  for (const t of [22, 32, 42]) {
    const a: V3 = [BEACON_DIR.x * t + PERP.x * 3.6, 0, BEACON_DIR.z * t + PERP.z * 3.6], c: V3 = [BEACON_DIR.x * t - PERP.x * 3.6, 0, BEACON_DIR.z * t - PERP.z * 3.6];
    a[1] = H(a[0], a[2]) + 4.6; c[1] = H(c[0], c[2]) + 4.6;
    for (const p of [a, c]) { b.prism([p[0], p[1] - 4.9, p[2]], [p[0], p[1] + 0.1, p[2]], 0.08, 0.06, 5, PAL.woodDark); obs.push(circ(p[0], p[2], 0.3)); }
    bunting(props.b, a, c, 0.7, 11, bcols);
  }
  // flags on the plaza rim
  flag(b, [Math.cos(DOCK_ANGLE + 0.45) * 13.0, 0, Math.sin(DOCK_ANGLE + 0.45) * 13.0], 6.5, PAL.roof3, -1);
  flag(b, [Math.cos(DOCK_ANGLE - 0.45) * 13.0, 0, Math.sin(DOCK_ANGLE - 0.45) * 13.0], 6.5, PAL.roof1, -1);
  obs.push(circ(Math.cos(DOCK_ANGLE + 0.45) * 13.0, Math.sin(DOCK_ANGLE + 0.45) * 13.0, 0.3));
  obs.push(circ(Math.cos(DOCK_ANGLE - 0.45) * 13.0, Math.sin(DOCK_ANGLE - 0.45) * 13.0, 0.3));
  // benches around the plaza
  for (const a of [0.2, 1.4, 2.6, 4.7, 5.4]) {
    const x = Math.cos(a) * 9.4, z = Math.sin(a) * 9.4, yaw = Math.atan2(-x, -z);
    b.push(); b.T(x, 0.04, z); b.RY(yaw);
    b.box(0, 0.45, 0, 1.8, 0.1, 0.5, PAL.woodLight); b.box(0, 0.8, -0.25, 1.8, 0.4, 0.08, PAL.woodLight);
    for (const sx of [-0.75, 0.75]) b.box(sx, 0.22, 0, 0.12, 0.45, 0.45, PAL.woodDark);
    b.pop(); obs.push(rect(x, z, 1.0, 0.4, yaw));
  }
  // planters
  for (const a of [0.85, 2.2, 3.6, 4.15, 5.85]) {
    const x = Math.cos(a) * 11.3, z = Math.sin(a) * 11.3;
    b.box(x, 0.4, z, 1.3, 0.8, 1.3, PAL.plinth, hex('#6b4a36'));
    for (let i = 0; i < 5; i++) b.ball([x + b.rng.r(-0.45, 0.45), 0.9, z + b.rng.r(-0.45, 0.45)], 0.28, [PAL.blossom, hex('#ffd36a'), hex('#ff7a5c'), PAL.leaf1][i % 4], 1, 0.8, 1, 0);
    obs.push(circ(x, z, 0.95));
  }

  // ───── the grove: big old shady trees ─────
  for (const [x, z, s] of GROVE_TREES) {
    tree(b, x, H(x, z), z, s, 3);
    obs.push(circ(x, z, 0.42 * s + 0.25));
  }
  // a mossy stone ring + bench under the oldest tree, and hanging lanterns
  {
    const [ox, oz] = [GROVE_TREES[1][0], GROVE_TREES[1][1]];
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.28; const x = ox + Math.cos(a) * 4.6, z = oz + Math.sin(a) * 4.6; if (onPath(x, z, 0.5)) continue; b.ball([x, H(x, z) + 0.2, z], 0.45, i % 2 ? PAL.plinth : hex('#a8b48e'), 1, 0.6, 1, 0, 0.3); }
    for (const [tx, tz, s] of GROVE_TREES) k.glow(g => { g.ball([tx + s * 0.9, H(tx, tz) + s * 1.75, tz + 0.4], 0.16, hex('#ffcf6a'), 1, 1.2, 1, 0); });
  }
  for (const [x, z, s, kind] of TOWN_TREES) { tree(b, x, H(x, z), z, s * 1.25, kind); obs.push(circ(x, z, 0.25 * s + 0.2)); }
  // windmill on the north rise
  const wy = H(WINDMILL.x, WINDMILL.z);
  const wyaw = Math.atan2(-WINDMILL.x, -WINDMILL.z) + 0.5;
  windmillBody(k, WINDMILL.x, wy, WINDMILL.z, wyaw, 1.1);
  obs.push(circ(WINDMILL.x, WINDMILL.z, 1.9));
  const hub: V3 = [WINDMILL.x + Math.sin(wyaw) * 1.9 * 1.1, wy + 6.3 * 1.1, WINDMILL.z + Math.cos(wyaw) * 1.9 * 1.1];

  // ───── rim fence (skips the dock mouth) ─────
  const NF = 120;
  let lastP: V3 | null = null;
  for (let i = 0; i <= NF; i++) {
    const a = i / NF * Math.PI * 2; const r = groveR(a) - 0.7; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const dA = Math.abs(Math.atan2(Math.sin(a - DOCK_ANGLE), Math.cos(a - DOCK_ANGLE))) * r;
    if (dA < 3) { lastP = null; continue; }
    const p: V3 = [x, H(x, z), z];
    b.prism([x, p[1] - 0.2, z], [x, p[1] + 1.05, z], 0.09, 0.08, 4, PAL.timber);
    if (lastP) { b.prism(add(lastP, [0, 0.95, 0]), add(p, [0, 0.95, 0]), 0.06, 0.06, 4, PAL.woodLight, { caps: false }); b.prism(add(lastP, [0, 0.5, 0]), add(p, [0, 0.5, 0]), 0.05, 0.05, 4, PAL.woodLight, { caps: false }); }
    lastP = p;
  }

  // ───── ferry dock ─────
  const du = BEACON_DIR, dv = PERP;
  const dp = (u: number, v: number, y: number): V3 => [du.x * u + dv.x * v, y, du.z * u + dv.z * v];
  b.withHint('up', () => {
    for (let i = 0; i < Math.round(DOCK_LEN / 0.6); i++) {
      const u0 = DOCK_START + i * 0.6, u1 = u0 + 0.55;
      b.quad(dp(u0, -DOCK_HW, DOCK_Y), dp(u1, -DOCK_HW, DOCK_Y), dp(u1, DOCK_HW, DOCK_Y), dp(u0, DOCK_HW, DOCK_Y), i % 3 ? PAL.woodLight : hex('#b98252'));
    }
  });
  for (let u = DOCK_START + 2; u <= DOCK_START + DOCK_LEN; u += 3) for (const v of [-DOCK_HW, DOCK_HW]) {
    const p = dp(u, v, DOCK_Y); b.prism([p[0], DOCK_Y - (u > DOCK_RIM ? 4 : 1.5), p[2]], [p[0], DOCK_Y + 1.1, p[2]], 0.15, 0.13, 5, PAL.woodDark);
  }
  b.prism(dp(DOCK_START, -DOCK_HW, DOCK_Y + 0.95), dp(DOCK_START + DOCK_LEN, -DOCK_HW, DOCK_Y + 0.95), 0.06, 0.06, 4, PAL.woodLight);
  b.prism(dp(DOCK_START, DOCK_HW, DOCK_Y + 0.95), dp(DOCK_START + DOCK_LEN, DOCK_HW, DOCK_Y + 0.95), 0.06, 0.06, 4, PAL.woodLight);
  // under-deck beams
  for (const v of [-1, 1]) b.prism(dp(DOCK_START, v, DOCK_Y - 0.3), dp(DOCK_START + DOCK_LEN, v, DOCK_Y - 0.3), 0.28, 0.28, 4, PAL.woodDark, { rot: Math.PI / 4 });
  const lampP = dp(DOCK_START + DOCK_LEN - 0.4, DOCK_HW + 0.3, DOCK_Y);
  lantern(k, lampP[0], DOCK_Y, lampP[2], 3.2, Math.atan2(dv.x, dv.z) + Math.PI / 2);
  // dock crane
  const cr = dp(DOCK_RIM - 4, -DOCK_HW - 2.2, 0); cr[1] = H(cr[0], cr[2]);
  b.prism([cr[0], cr[1] - 0.3, cr[2]], [cr[0], cr[1] + 5.5, cr[2]], 0.25, 0.2, 6, PAL.wood);
  const arm = dp(DOCK_RIM + 3, -DOCK_HW + 0.5, cr[1] + 5.2);
  b.prism([cr[0], cr[1] + 5.3, cr[2]], arm, 0.14, 0.1, 5, PAL.wood);
  b.prism(arm, [arm[0], arm[1] - 2.5, arm[2]], 0.02, 0.02, 3, PAL.woodDark);
  b.box(arm[0], arm[1] - 3.0, arm[2], 0.7, 0.6, 0.7, PAL.wood, hex('#b07a50'));
  obs.push(circ(cr[0], cr[2], 0.5));
  // little ferry moored alongside the pier
  const fp = dp(DOCK_START + DOCK_LEN - 4.5, DOCK_HW + 3.0, DOCK_Y - 1.4);
  ship(k, fp[0], fp[1], fp[2], Math.atan2(du.x, du.z), 0.55, { masts: 1, stripe: PAL.roof3, wing: hex('#ff9a6a') });

  // ───── scatter: shrubs, flowers, grass tufts (props mesh) ─────
  const pb = props.b; const rng = pb.rng;
  const blocked = (x: number, z: number, pad: number) => {
    const r = Math.hypot(x, z); if (r < PLAZA_R + 1 || r > groveR(Math.atan2(z, x)) - 1.6) return true;
    if (onPath(x, z, 0.6)) return true;
    for (const o of obs) {
      if (o.kind === 'c') { if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return true; }
      else { const dx = x - o.x, dz = z - o.z; const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c; if (Math.abs(lx) < o.hw + pad && Math.abs(lz) < o.hd + pad) return true; }
    }
    return false;
  };
  for (let i = 0; i < 520; i++) {
    const a = rng.r(0, 6.283), r = Math.sqrt(rng.next()) * 50; const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (blocked(x, z, 0.3)) continue;
    const y = H(x, z); const q = rng.next();
    if (q < 0.22) pb.ball([x, y + 0.3, z], rng.r(0.5, 0.85), PAL.leaf2, 1.2, 0.75, 1, 0, 0.3, PAL.grassDark);
    else if (q < 0.5) for (let j = 0; j < 4; j++) pb.ball([x + rng.r(-0.45, 0.45), y + 0.2, z + rng.r(-0.45, 0.45)], 0.16, [PAL.blossom, hex('#ffd36a'), PAL.white, hex('#ff7a5c')][Math.floor(rng.r(0, 4))], 1, 0.8, 1, 0);
    else for (let j = 0; j < 3; j++) pb.prism([x + rng.r(-0.3, 0.3), y - 0.05, z + rng.r(-0.3, 0.3)], [x + rng.r(-0.45, 0.45), y + rng.r(0.45, 0.85), z + rng.r(-0.45, 0.45)], 0.12, 0, 3, j % 2 ? PAL.grass2 : PAL.grassDark);
  }
  void tint;
  return { obstacles: obs, pimGround, pimFacing, windmillHub: hub, windmillYaw: wyaw, ferry: fp };
}
