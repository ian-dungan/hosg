// The Beacon (minimal per scope cut): meadow island with dock, lighthouse and arena disc.
// Built in island-local space around (0, 0, 0) = BEACON_C at BEACON_TOP; the caller moves it.
import { Builder, hex, add, type V3 } from './mesh';
import { Kit, PAL, lighthouse, tree, waterfall } from './parts';
import { BEACON_R, BEACON_TOP, BEACON_C, BEACON_U, BEACON_PERP, ARENA_C, ARENA_Y, LIGHTHOUSE, B_DOCK_START, B_DOCK_LEN, B_DOCK_Y, DOCK_HW } from './layout';

const L = (x: number, z: number): [number, number] => [x - BEACON_C.x, z - BEACON_C.z];

export function buildBeacon(k: Kit, ring: Builder, water: Builder) {
  const b = k.b;
  const T = BEACON_TOP;
  const N = 28;
  const glowGrass = hex('#a8f07a');
  // top disc (glowing meadow) + underside
  b.withHint('up', () => {
    for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
      for (let r = 0; r < 4; r++) {
        const r0 = BEACON_R * r / 4, r1 = BEACON_R * (r + 1) / 4;
        const c = i % 2 ? PAL.grass : glowGrass;
        const p = (a: number, rr: number): V3 => [Math.cos(a) * rr, T, Math.sin(a) * rr];
        if (r === 0) b.tri(p(a0, 0), p(a1, r1), p(a0, r1), c);
        else b.quad(p(a0, r0), p(a0, r1), p(a1, r1), p(a1, r0), r % 2 ? c : PAL.grass2);
      }
    }
  });
  const under: [number, number][] = [[T, 1], [T - 2, 1.02], [T - 9, 0.85], [T - 20, 0.55], [T - 32, 0.25], [T - 42, 0]];
  const cols = [PAL.soil, PAL.rock1, PAL.rock2, PAL.rock3, PAL.rock4];
  b.withHint([0, T - 15, 0], () => {
    for (let r = 0; r < under.length - 1; r++) for (let i = 0; i < N; i++) {
      const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2;
      const p = (a: number, q: number): V3 => [Math.cos(a) * BEACON_R * under[q][1], under[q][0], Math.sin(a) * BEACON_R * under[q][1]];
      b.quad(p(a0, r), p(a1, r), p(a1, r + 1), p(a0, r + 1), cols[r]);
    }
  });
  // arena disc: inner (radius 12, permanent) + outer ring 12..15 (separate mesh, crumbles)
  const [ax, az] = L(ARENA_C.x, ARENA_C.z);
  b.prism([ax, T - 0.3, az], [ax, ARENA_Y, az], 12, 12, 32, PAL.plinth, { capB: PAL.pave1 });
  ring.prism([ax, T - 0.3, az], [ax, ARENA_Y, az], 15, 15, 32, PAL.plinth, { capB: PAL.pave2 });
  b.prism([ax, ARENA_Y, az], [ax, ARENA_Y + 0.02, az], 4, 4, 16, PAL.gold);
  // gate pillars
  const gx = ax + BEACON_U.x * 15.8, gz = az + BEACON_U.z * 15.8;
  for (const s of [-3, 3]) b.box(gx + BEACON_PERP.x * s, T + 2.5, gz + BEACON_PERP.z * s, 1.0, 5, 1.0, PAL.plinth, PAL.gold);
  b.prism([gx - BEACON_PERP.x * 3.6, T + 5.3, gz - BEACON_PERP.z * 3.6], [gx + BEACON_PERP.x * 3.6, T + 5.3, gz + BEACON_PERP.z * 3.6], 0.5, 0.5, 4, PAL.roof1, { rot: Math.PI / 4 });
  // striped lighthouse
  const [lx, lz] = L(LIGHTHOUSE.x, LIGHTHOUSE.z);
  lighthouse(k, lx, T, lz, 2.8, 16);
  // dock
  const dp = (u: number, v: number): V3 => [BEACON_U.x * u + BEACON_PERP.x * v, B_DOCK_Y, BEACON_U.z * u + BEACON_PERP.z * v];
  b.withHint('up', () => b.quad(dp(B_DOCK_START, -DOCK_HW), dp(B_DOCK_START + B_DOCK_LEN, -DOCK_HW), dp(B_DOCK_START + B_DOCK_LEN, DOCK_HW), dp(B_DOCK_START, DOCK_HW), PAL.woodLight));
  for (let u = B_DOCK_START + 2; u <= B_DOCK_START + B_DOCK_LEN; u += 3) for (const v of [-DOCK_HW, DOCK_HW]) { const p = dp(u, v); b.prism(add(p, [0, -3, 0]), add(p, [0, 1, 0]), 0.14, 0.12, 5, PAL.woodDark); }
  // a few trees off the meadow path
  for (const [u, v] of [[18, 14], [24, -15], [8, 20], [-2, -22], [30, 9]]) tree(b, BEACON_U.x * u + BEACON_PERP.x * v, T, BEACON_U.z * u + BEACON_PERP.z * v, 1.6, 1);
  waterfall(water, [-BEACON_PERP.x * BEACON_R, T, -BEACON_PERP.z * BEACON_R], [-BEACON_PERP.x, 0, -BEACON_PERP.z], 80, 5, 3);
}
