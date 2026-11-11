// (1) The out-of-play arena clearing that carries the Beacon/arena anchors (no polish).
// (2) The floating Beacon island that emerges in the sky where Ellie points.
import { Builder, hex, type V3 } from './mesh';
import { Kit, PAL, lighthouse, tree, waterfall, island, cloudPuff } from './parts';
import { BEACON_R, BEACON_TOP, BEACON_U, BEACON_PERP, ARENA_C, ARENA_Y, BEACON_C, SKY_ISLAND } from './layout';

/** Clearing built in world coordinates. `ring` gets the outer arena ring (12..15) that crumbles. */
export function buildArenaClearing(b: Builder, ring: Builder) {
  const T = BEACON_TOP + 0.05;
  b.prism([BEACON_C.x, T - 0.4, BEACON_C.z], [BEACON_C.x, T, BEACON_C.z], BEACON_R, BEACON_R, 24, PAL.grass2, { capB: PAL.grass });
  const ax = ARENA_C.x, az = ARENA_C.z;
  b.prism([ax, T - 0.3, az], [ax, ARENA_Y, az], 12, 12, 32, PAL.plinth, { capB: PAL.pave1 });
  ring.prism([ax, T - 0.3, az], [ax, ARENA_Y - 0.01, az], 15, 15, 32, PAL.plinth, { capB: PAL.pave2 });
  b.prism([ax, ARENA_Y, az], [ax, ARENA_Y + 0.02, az], 4, 4, 16, PAL.gold);
  const gx = ax + BEACON_U.x * 15.8, gz = az + BEACON_U.z * 15.8;
  for (const s of [-3, 3]) b.box(gx + BEACON_PERP.x * s, T + 2.5, gz + BEACON_PERP.z * s, 1.0, 5, 1.0, PAL.plinth, PAL.gold);
  b.prism([gx - BEACON_PERP.x * 3.6, T + 5.3, gz - BEACON_PERP.z * 3.6], [gx + BEACON_PERP.x * 3.6, T + 5.3, gz + BEACON_PERP.z * 3.6], 0.5, 0.5, 4, PAL.roof1, { rot: Math.PI / 4 });
}

/** Sky island in local coordinates (origin = island top centre). */
export function buildSkyIsland(k: Kit, water: Builder) {
  const b = k.b, R = SKY_ISLAND.r;
  island(b, 0, 0, 0, R, R * 2.1, { n: 20, seed: 91, tipOff: [R * 0.15, R * 0.1], dome: 4, bump: 2, topCol: hex('#a8f07a'), topCol2: PAL.grass });
  lighthouse(k, -R * 0.35, 1.5, -R * 0.2, 5, 30);
  for (let i = 0; i < 14; i++) { const a = b.rng.r(0, 6.28), r = b.rng.r(R * 0.2, R * 0.8); tree(b, Math.cos(a) * r, 1.5, Math.sin(a) * r, b.rng.r(2.4, 3.6), i % 2 ? 1 : 0); }
  for (const ang of [0.9, 1.5]) waterfall(water, [Math.cos(ang) * R * 0.97, 0.4, Math.sin(ang) * R * 0.97], [Math.cos(ang), 0, Math.sin(ang)], 220, 7, Math.floor(ang * 10));
}

/** The cloud bank that hides the island's spot, in two halves that part (local coords). */
export function buildCloudBank(left: Builder, right: Builder) {
  const R = SKY_ISLAND.r;
  for (const [bb, sd] of [[left, -1], [right, 1]] as [Builder, number][]) {
    for (let i = 0; i < 9; i++) {
      const c: V3 = [sd * bb.rng.r(5, R * 1.3), bb.rng.r(-R * 1.2, -R * 0.2), bb.rng.r(-R * 0.6, R * 0.6)];
      cloudPuff(bb, c, bb.rng.r(R * 0.45, R * 0.7), 0.6);
    }
  }
}
