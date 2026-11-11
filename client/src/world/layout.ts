// World layout: where everything is, terrain height functions and walkability (groundAt).
// Pure maths — no Babylon imports — so it is cheap and testable.

export interface Circle { kind: 'c'; x: number; z: number; r: number }
export interface Rect { kind: 'r'; x: number; z: number; hw: number; hd: number; c: number; s: number } // yaw rotated
export type Obstacle = Circle | Rect;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ───────── Shady Grove island (centre at origin) ─────────
export const PLAZA_R = 13.5;
export const PLINTH_R = 4.4;
/** Island rim radius at angle a (atan2(z, x)). */
export function groveR(a: number) {
  return 49 + 3.2 * Math.sin(3 * a + 0.7) + 2.0 * Math.sin(5 * a + 2.1) + 1.2 * Math.sin(9 * a + 0.3);
}
export const EDGE_MARGIN = 1.4; // walkable up to rim - margin (fence sits at rim - 0.7)
export const GROVE_CENTER = { x: 29, z: 3 };

/** Terrain height of Shady Grove (also used for the mesh, so the two agree). */
export function groveHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const f = smooth(PLAZA_R + 0.5, PLAZA_R + 10, r);
  const dx = x - GROVE_CENTER.x, dz = z - GROVE_CENTER.z;
  const knoll = 1.6 * Math.exp(-(dx * dx + dz * dz) / (2 * 13 * 13));
  const north = 0.9 * smooth(16, 40, z);
  const und = 0.45 * Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.08 - 0.4) + 0.25 * Math.sin(x * 0.17 + z * 0.13);
  return f * (knoll + north + und);
}

// Direction Ellie points (horizontal unit vector from the statue toward the Beacon).
const bd = { x: -0.9, z: 0.42 };
const bl = Math.hypot(bd.x, bd.z);
export const BEACON_DIR = { x: bd.x / bl, z: bd.z / bl };
const PERP = { x: -BEACON_DIR.z, z: BEACON_DIR.x }; // 90° left of BEACON_DIR

// Dock: on the rim in the Beacon direction.
export const DOCK_ANGLE = Math.atan2(BEACON_DIR.z, BEACON_DIR.x);
export const DOCK_RIM = groveR(DOCK_ANGLE);
export const DOCK_LEN = 15;      // from rim - 3 outwards
export const DOCK_HW = 1.7;
export const DOCK_START = DOCK_RIM - 3;
export const DOCK_Y = groveHeight(BEACON_DIR.x * DOCK_RIM, BEACON_DIR.z * DOCK_RIM) + 0.22;

// Main street from the plaza to the dock runs along BEACON_DIR. Tavern beside it.
export const TAVERN = { x: BEACON_DIR.x * 31 + PERP.x * 8.2, z: BEACON_DIR.z * 31 + PERP.z * 8.2, w: 8.5, d: 6.5 };
// tavern faces the street (its +Z local axis points toward -PERP)
export const TAVERN_YAW = Math.atan2(-PERP.x, -PERP.z);

export interface HouseDef { x: number; z: number; w: number; d: number; h: number; yaw: number; roof: 'roof' | 'teal' | 'roof2' | 'orange'; wall: 0 | 1 | 2; chimney?: boolean }
const H = (deg: number, r: number, w: number, d: number, h: number, roof: HouseDef['roof'], wall: HouseDef['wall'], chimney = false, yawOff = 0): HouseDef => {
  const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
  return { x, z, w, d, h, yaw: Math.atan2(-x, -z) + yawOff, roof, wall, chimney };
};
export const HOUSES: HouseDef[] = [
  H(70, 25, 5.2, 4.4, 4.2, 'roof', 0, true),
  H(93, 27, 4.6, 4.2, 5.4, 'teal', 1),
  H(117, 24, 5.0, 4.4, 4.0, 'roof2', 2, true, 0.15),
  H(82, 39, 5.6, 4.6, 4.6, 'orange', 1, true),
  H(105, 39, 4.8, 4.4, 5.6, 'roof', 0),
  H(192, 25, 5.0, 4.4, 4.4, 'teal', 0, true, -0.1),
  H(216, 30, 5.4, 4.6, 4.0, 'roof', 2),
  H(242, 26, 4.6, 4.2, 5.2, 'roof2', 1, true),
  H(270, 32, 5.6, 4.6, 4.2, 'orange', 0, true),
  H(300, 25, 4.8, 4.4, 4.6, 'teal', 2),
  H(200, 40, 5.0, 4.4, 4.2, 'roof', 1, true, 0.2),
];

export const STALLS = [
  { x: Math.cos(0.45) * 11, z: Math.sin(0.45) * 11, yaw: Math.atan2(-Math.cos(0.45), -Math.sin(0.45)), color: 'roof' },
  { x: Math.cos(-0.35) * 11, z: Math.sin(-0.35) * 11, yaw: Math.atan2(-Math.cos(-0.35), -Math.sin(-0.35)), color: 'teal' },
  { x: Math.cos(3.6) * 11, z: Math.sin(3.6) * 11, yaw: Math.atan2(-Math.cos(3.6), -Math.sin(3.6)), color: 'gold' },
] as const;
export const LAMPS: { x: number; z: number }[] = [0.95, 1.85, 3.1, 3.95, 4.35, 5.05, 5.75, 0.05].map(a => ({ x: Math.cos(a) * 12.4, z: Math.sin(a) * 12.4 }));

/** The big old trees of the original grove: x, z, scale (trunk radius = 0.42 * scale). */
export const GROVE_TREES: [number, number, number][] = [
  [24, -9, 2.3], [33, -3, 2.7], [25.5, 6.5, 2.4], [37, 10, 2.2], [21, 17, 2.0], [41, -11, 2.0], [31, 19, 2.3], [43, 2, 1.9], [30.5, -15, 1.9],
];
/** Other smaller trees around town. */
export const TOWN_TREES: [number, number, number, number][] = [
  [-14, 22, 1.2, 1], [8, 30, 1.1, 2], [-27, -8, 1.2, 1], [-8, -27, 1.0, 0], [14, -26, 1.2, 1], [-38, -16, 1.3, 2], [-22, 34, 1.0, 0], [20, 34, 1.2, 1], [-4, 44, 1.0, 2], [-30, 28, 1.0, 1],
];
export const WINDMILL = { x: Math.cos(1.05) * 41, z: Math.sin(1.05) * 41 };

// ───────── The Beacon (minimal) ─────────
export const BEACON_DIST = 150;
export const BEACON_R = 36;
export const BEACON_TOP = 3;
export const BEACON_C = { x: BEACON_DIR.x * BEACON_DIST, z: BEACON_DIR.z * BEACON_DIST };
const U = { x: -BEACON_DIR.x, z: -BEACON_DIR.z }; // from beacon centre toward the grove
export const BEACON_U = U;
export const BEACON_PERP = PERP;
export const ARENA_C = { x: BEACON_C.x - U.x * 12, z: BEACON_C.z - U.z * 12 };
export const ARENA_Y = BEACON_TOP + 0.3;
export const LIGHTHOUSE = { x: BEACON_C.x - U.x * 30, z: BEACON_C.z - U.z * 30 };
export const B_DOCK_START = BEACON_R - 3;
export const B_DOCK_LEN = 12;
export const B_DOCK_Y = BEACON_TOP + 0.2;

// ───────── walkability ─────────
const CELL = 4, GMIN = -64, GN = 32; // grid over [-64, 64]^2 for Shady Grove
export class Walk {
  private grid: Obstacle[][] = [];
  beaconUp = false;
  arenaRadius = 15;
  constructor(obs: Obstacle[]) {
    for (let i = 0; i < GN * GN; i++) this.grid.push([]);
    for (const o of obs) {
      const ext = o.kind === 'c' ? o.r : Math.hypot(o.hw, o.hd);
      const i0 = Math.max(0, Math.floor((o.x - ext - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((o.x + ext - GMIN) / CELL));
      const j0 = Math.max(0, Math.floor((o.z - ext - GMIN) / CELL)), j1 = Math.min(GN - 1, Math.floor((o.z + ext - GMIN) / CELL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[j * GN + i].push(o);
    }
  }
  private blocked(x: number, z: number) {
    const i = Math.floor((x - GMIN) / CELL), j = Math.floor((z - GMIN) / CELL);
    if (i < 0 || j < 0 || i >= GN || j >= GN) return false;
    for (const o of this.grid[j * GN + i]) {
      const dx = x - o.x, dz = z - o.z;
      if (o.kind === 'c') { if (dx * dx + dz * dz < o.r * o.r) return true; }
      else {
        // local coords: +X right, +Z front for yaw (c = cos yaw, s = sin yaw)
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        if (Math.abs(lx) < o.hw && Math.abs(lz) < o.hd) return true;
      }
    }
    return false;
  }
  groundAt(x: number, z: number): number | null {
    const r2 = x * x + z * z;
    if (r2 < 70 * 70) {
      // ferry pier
      const u = x * BEACON_DIR.x + z * BEACON_DIR.z, v = x * PERP.x + z * PERP.z;
      if (u > DOCK_START && u < DOCK_START + DOCK_LEN && Math.abs(v) < DOCK_HW - 0.3) return DOCK_Y;
      const r = Math.sqrt(r2);
      if (r > 40) { if (r > groveR(Math.atan2(z, x)) - EDGE_MARGIN) return null; }
      if (this.blocked(x, z)) return null;
      return groveHeight(x, z);
    }
    if (!this.beaconUp) return null;
    const bx = x - BEACON_C.x, bz = z - BEACON_C.z;
    const bu = bx * U.x + bz * U.z, bv = bx * PERP.x + bz * PERP.z;
    if (bu > B_DOCK_START && bu < B_DOCK_START + B_DOCK_LEN && Math.abs(bv) < DOCK_HW - 0.3) return B_DOCK_Y;
    const ax = x - ARENA_C.x, az = z - ARENA_C.z, ad = Math.hypot(ax, az);
    if (ad < 15.6) {
      if (ad <= this.arenaRadius) return ARENA_Y;
      if (this.arenaRadius < 15) return null; // crumbled ring: a gap you cannot cross
      return ARENA_Y; // rim of the disc in phase 1
    }
    const lx = x - LIGHTHOUSE.x, lz = z - LIGHTHOUSE.z;
    if (lx * lx + lz * lz < 3.2 * 3.2) return null;
    if (Math.hypot(bx, bz) > BEACON_R - 2) return null;
    return BEACON_TOP;
  }
}
