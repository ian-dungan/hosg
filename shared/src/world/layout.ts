// World layout: where everything is, terrain height functions and walkability (groundAt).
// Pure maths — no Babylon imports — so it is cheap and testable, and shared by client and server.
import { GROVE_OBSTACLES } from './obstacles';

// `top` is the obstacle's top height in world Y: with it the obstacle is a platform you can stand on
// (surfaceAt), without it a wall that is never enterable. groundAt treats both as blocked.
export interface Circle { kind: 'c'; x: number; z: number; r: number; top?: number }
export interface Rect { kind: 'r'; x: number; z: number; hw: number; hd: number; c: number; s: number; top?: number } // yaw rotated
export type Obstacle = Circle | Rect;

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ───────── noise (pure copies so this file needs no client code) ─────────
function hash(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
export function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export { smooth };

// ───────── Shady Grove (town centre at origin) ─────────
export const PLAZA_R = 13.5;
export const PLINTH_R = 4.4;
/** Old island rim, still used to place the dock/street constants. */
export function groveR(a: number) {
  return 49 + 3.2 * Math.sin(3 * a + 0.7) + 2.0 * Math.sin(5 * a + 2.1) + 1.2 * Math.sin(9 * a + 0.3);
}
export const GROVE_CENTER = { x: 29, z: 3 };

/** Town-core terrain (flat plaza, grove knoll, gentle undulation). */
export function groveHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  const f = smooth(PLAZA_R + 0.5, PLAZA_R + 10, r);
  const dx = x - GROVE_CENTER.x, dz = z - GROVE_CENTER.z;
  const knoll = 1.6 * Math.exp(-(dx * dx + dz * dz) / (2 * 13 * 13));
  const north = 0.9 * smooth(16, 40, z);
  const und = 0.45 * Math.sin(x * 0.09 + 1.3) * Math.cos(z * 0.08 - 0.4) + 0.25 * Math.sin(x * 0.17 + z * 0.13);
  return f * (knoll + north + und);
}

// ───────── countryside ─────────
export const WATER_Y = -1.3;
const BED_Y = -2.7;
/** River centre line (runs north-south past the west edge of town). */
export function riverX(z: number) { return -58 + 3 * Math.sin(z * 0.03 + 0.2) + 14 * Math.sin(z * 0.004); }
/** East dirt road toward Normandy: z of the road centre at x (x >= 23). */
export function roadZ(x: number) { return 2.5 + 6 * Math.sin((x - 23) * 0.012); }
export const ROAD_X0 = 23;
/** Walkable band boundary radius at angle a. */
export function bandR(a: number) { return 100 + 6 * Math.sin(3 * a + 1) + 4 * Math.sin(7 * a + 2); }

// Out-of-play clearing for the Beacon/arena anchors (far south-east, behind hills).
export const BEACON_C = { x: 420, z: -260 };
export const BEACON_TOP = 12;
export const BEACON_R = 36;

/** Flattened pads (farms, the clearing): x, z, radius. Heights filled in lazily. */
export const FARMS: { x: number; z: number; yaw: number }[] = [
  { x: 165, z: 85, yaw: 2.4 }, { x: -20, z: 205, yaw: 3.4 }, { x: 150, z: -120, yaw: 0.6 }, { x: -175, z: -50, yaw: 1.2 },
];
const PADS: { x: number; z: number; r: number; y: number }[] = [
  ...FARMS.map(f => ({ x: f.x, z: f.z, r: 26, y: NaN })),
  { x: BEACON_C.x, z: BEACON_C.z, r: 50, y: BEACON_TOP },
];

function rawHeight(x: number, z: number) {
  const r = Math.hypot(x, z);
  let h = groveHeight(x, z);
  const c = smooth(42, 95, r);
  if (c > 0) h += c * 1.8 * (vnoise(x * 0.025 + 11, z * 0.025 + 3) - 0.5) * 2;
  const f = smooth(92, 190, r);
  if (f > 0) {
    let hill = 4 + 26 * vnoise(x * 0.006 + 5, z * 0.006 + 9) + 9 * vnoise(x * 0.021, z * 0.021);
    if (r > 80) { const a = Math.atan2(z, x); hill += 5 * smooth(bandR(a) - 4, bandR(a) + 22, r); }
    hill += smooth(450, 1500, r) * 70 * vnoise(x * 0.003 + 1, z * 0.003 + 2);
    // valleys along the river and the road
    const dr = Math.abs(x - riverX(z));
    let damp = smooth(14, 110, dr);
    if (x > ROAD_X0) damp *= smooth(5, 45, Math.abs(z - roadZ(x)));
    h += f * hill * damp;
  }
  const d = Math.abs(x - riverX(z));
  if (d < 16) { const t = smooth(5, 15, d); h = BED_Y + (h - BED_Y) * t; }
  return h;
}
for (const p of PADS) if (Number.isNaN(p.y)) p.y = rawHeight(p.x, p.z);
/** Full terrain height (town + countryside + river + pads). Used by the mesh and groundAt. */
export function groundHeight(x: number, z: number) {
  let h = rawHeight(x, z);
  for (const p of PADS) {
    const dx = x - p.x, dz = z - p.z; const d2 = dx * dx + dz * dz; const R = p.r + 30;
    if (d2 < R * R) h = p.y + (h - p.y) * smooth(p.r, R, Math.sqrt(d2));
  }
  return h;
}

// Direction Ellie points (horizontal unit vector from the statue toward the Beacon).
const bd = { x: -0.9, z: 0.42 };
const bl = Math.hypot(bd.x, bd.z);
export const BEACON_DIR = { x: bd.x / bl, z: bd.z / bl };
const PERP = { x: -BEACON_DIR.z, z: BEACON_DIR.x }; // 90° left of BEACON_DIR

// Dock: on the rim in the Beacon direction.
export const DOCK_ANGLE = Math.atan2(BEACON_DIR.z, BEACON_DIR.x);
export const DOCK_RIM = groveR(DOCK_ANGLE);
export const DOCK_LEN = 19;
export const DOCK_HW = 1.7;
export const DOCK_START = 41;
export const DOCK_Y = groundHeight(BEACON_DIR.x * DOCK_START, BEACON_DIR.z * DOCK_START) + 0.12;

// Main street from the plaza to the dock runs along BEACON_DIR. Tavern beside it.
export const TAVERN = { x: BEACON_DIR.x * 31 + PERP.x * 8.2, z: BEACON_DIR.z * 31 + PERP.z * 8.2, w: 8.5, d: 6.5 };
// tavern faces the street (its +Z local axis points toward -PERP)
export const TAVERN_YAW = Math.atan2(-PERP.x, -PERP.z);

export interface HouseDef { x: number; z: number; w: number; d: number; h: number; yaw: number; roof: 'roof' | 'teal' | 'roof2' | 'orange'; wall: 0 | 1 | 2; chimney?: boolean }
const H = (deg: number, r: number, w: number, d: number, h: number, roof: HouseDef['roof'], wall: HouseDef['wall'], chimney = false, yawOff = 0): HouseDef => {
  const a = deg * Math.PI / 180, x = Math.cos(a) * r, z = Math.sin(a) * r;
  return { x, z, w, d, h, yaw: Math.atan2(-x, -z) + yawOff, roof, wall, chimney };
};
const streetHouse = (t: number, w: number, d: number, h: number, roof: HouseDef['roof'], wall: HouseDef['wall'], chimney = false): HouseDef => ({
  x: BEACON_DIR.x * t - PERP.x * 8.4, z: BEACON_DIR.z * t - PERP.z * 8.4, w, d, h, yaw: Math.atan2(PERP.x, PERP.z), roof, wall, chimney,
});
export const HOUSES: HouseDef[] = [
  H(64, 21, 5.2, 4.4, 4.2, 'roof', 0, true),
  H(119, 20.5, 5.0, 4.4, 4.0, 'roof2', 2, true, 0.1),
  H(80, 32, 5.6, 4.6, 4.6, 'orange', 1, true),
  H(103, 31, 4.6, 4.2, 5.4, 'teal', 1),
  streetHouse(35, 5.4, 4.6, 5.2, 'teal', 0, true),
  H(196, 21.5, 5.0, 4.4, 4.4, 'teal', 0, true, -0.1),
  H(218, 30, 5.4, 4.6, 4.0, 'roof', 2),
  H(243, 21, 4.6, 4.2, 5.2, 'roof2', 1, true),
  H(284, 31, 5.6, 4.6, 4.2, 'orange', 0, true),
  H(304, 21.5, 4.8, 4.4, 4.6, 'teal', 2),
  H(201, 40, 5.0, 4.4, 4.2, 'roof', 1, true, 0.2),
];

export const STALLS = [
  { x: Math.cos(0.45) * 11, z: Math.sin(0.45) * 11, yaw: Math.atan2(-Math.cos(0.45), -Math.sin(0.45)), color: 'roof' },
  { x: Math.cos(-0.35) * 11, z: Math.sin(-0.35) * 11, yaw: Math.atan2(-Math.cos(-0.35), -Math.sin(-0.35)), color: 'teal' },
  { x: Math.cos(3.6) * 11, z: Math.sin(3.6) * 11, yaw: Math.atan2(-Math.cos(3.6), -Math.sin(3.6)), color: 'gold' },
] as const;
export const LAMPS: { x: number; z: number }[] = [0.95, 1.85, 3.1, 3.95, 4.35, 5.05, 5.75, 0.05].map(a => ({ x: Math.cos(a) * 12.4, z: Math.sin(a) * 12.4 }));

/** The big old trees of the original grove: x, z, scale (trunk radius = 0.42 * scale). */
export const GROVE_TREES: [number, number, number][] = [
  [24, -9, 2.3], [33, -3, 2.7], [25.5, 6.5, 2.4], [37, 10, 2.2], [21, 17, 2.0], [41, -11, 2.0], [31, 19, 2.3], [46, 14, 1.9], [30.5, -15, 1.9],
];
/** Other smaller trees around town. */
export const TOWN_TREES: [number, number, number, number][] = [
  [-14, 22, 1.2, 1], [8, 30, 1.1, 2], [-27, -8, 1.2, 1], [-8, -27, 1.0, 0], [14, -26, 1.2, 1], [-38, -16, 1.3, 2], [-22, 34, 1.0, 0], [20, 34, 1.2, 1], [-4, 44, 1.0, 2], [-30, 28, 1.0, 1],
];
export const WINDMILL = { x: Math.cos(1.05) * 41, z: Math.sin(1.05) * 41 };

// ───────── The Beacon anchors (out-of-play clearing, no polish) ─────────
const U = (() => { const l = Math.hypot(BEACON_C.x, BEACON_C.z); return { x: -BEACON_C.x / l, z: -BEACON_C.z / l }; })(); // toward town
export const BEACON_U = U;
export const BEACON_PERP = { x: -U.z, z: U.x };
export const ARENA_C = { x: BEACON_C.x - U.x * 12, z: BEACON_C.z - U.z * 12 };
export const ARENA_Y = BEACON_TOP + 0.3;
export const B_DOCK_U = 31;
export const B_DOCK_Y = BEACON_TOP;

// The floating Beacon island that appears in the sky where Ellie points.
export const SKY_ISLAND = { dist: 950, y: 168, r: 55 };

// ───────── walkability ─────────
/** Radius of the town + countryside area; beyond it only the out-of-play Beacon clearing is standable. */
const TOWN_R = 118;
const CELL = 4, GMIN = -116, GN = 58; // grid over [-116, 116]^2 for the town + band
export class Walk {
  private grid: Obstacle[][] = [];
  beaconUp = true; // the arena clearing is always standable (anchors stay valid)
  arenaRadius = 15;
  constructor(obs: readonly Obstacle[]) {
    for (let i = 0; i < GN * GN; i++) this.grid.push([]);
    for (const o of obs) {
      const ext = o.kind === 'c' ? o.r : Math.hypot(o.hw, o.hd);
      const i0 = Math.max(0, Math.floor((o.x - ext - GMIN) / CELL)), i1 = Math.min(GN - 1, Math.floor((o.x + ext - GMIN) / CELL));
      const j0 = Math.max(0, Math.floor((o.z - ext - GMIN) / CELL)), j1 = Math.min(GN - 1, Math.floor((o.z + ext - GMIN) / CELL));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) this.grid[j * GN + i].push(o);
    }
  }
  /** What covers (x, z): -Infinity for nothing, Infinity for a wall, else the highest platform top. */
  private cover(x: number, z: number): number {
    const i = Math.floor((x - GMIN) / CELL), j = Math.floor((z - GMIN) / CELL);
    if (i < 0 || j < 0 || i >= GN || j >= GN) return -Infinity;
    let top = -Infinity;
    for (const o of this.grid[j * GN + i]) {
      const dx = x - o.x, dz = z - o.z;
      let inside: boolean;
      if (o.kind === 'c') inside = dx * dx + dz * dz < o.r * o.r;
      else {
        // local coords: +X right, +Z front for yaw (c = cos yaw, s = sin yaw)
        const lx = dx * o.c - dz * o.s, lz = dx * o.s + dz * o.c;
        inside = Math.abs(lx) < o.hw && Math.abs(lz) < o.hd;
      }
      if (!inside) continue;
      if (o.top === undefined) return Infinity;
      if (o.top > top) top = o.top;
    }
    return top;
  }
  /** Ground height where an adventurer can stand, or null (out of bounds, water, or any obstacle — platforms included). */
  groundAt(x: number, z: number): number | null { return this.ground(x, z, false); }
  /**
   * Height of whatever an adventurer would stand on at (x, z): the higher of the terrain and the highest
   * platform top covering the point, or null where groundAt is null for any reason other than a platform.
   */
  surfaceAt(x: number, z: number): number | null { return this.ground(x, z, true); }
  private ground(x: number, z: number, platforms: boolean): number | null {
    const r2 = x * x + z * z;
    if (r2 < TOWN_R * TOWN_R) {
      // ferry jetty over the river
      const u = x * BEACON_DIR.x + z * BEACON_DIR.z, v = x * PERP.x + z * PERP.z;
      if (u > DOCK_START && u < DOCK_START + DOCK_LEN && Math.abs(v) < DOCK_HW - 0.3) return DOCK_Y;
      if (x < riverX(z) + 2) return null;
      const r = Math.sqrt(r2);
      if (r > 86 && r > bandR(Math.atan2(z, x)) - 1) return null;
      const h = groundHeight(x, z);
      if (h < WATER_Y + 0.25 && x < riverX(z) + 22) return null;
      const top = this.cover(x, z);
      if (top === -Infinity) return h;
      if (!platforms || top === Infinity) return null;
      return Math.max(h, top);
    }
    if (!this.beaconUp) return null;
    const bx = x - BEACON_C.x, bz = z - BEACON_C.z;
    if (bx * bx + bz * bz > (BEACON_R - 2) * (BEACON_R - 2)) return null;
    const ax = x - ARENA_C.x, az = z - ARENA_C.z, ad = Math.hypot(ax, az);
    if (ad < 15.6) {
      if (ad <= this.arenaRadius) return ARENA_Y;
      if (this.arenaRadius < 15) return null; // crumbled ring: a gap you cannot cross
      return ARENA_Y;
    }
    return BEACON_TOP;
  }
}

/** A fresh walkability object for the grove (each world owns one, since beaconUp/arenaRadius change). */
export function createGroveWalk(): Walk { return new Walk(GROVE_OBSTACLES); }

let groveWalk: Walk | null = null;
const defaultWalk = () => (groveWalk ??= createGroveWalk());
/** Ground height where an adventurer can stand, or null (obstacle, water, out of bounds). */
export function groveGroundY(x: number, z: number): number | null { return defaultWalk().groundAt(x, z); }
/** True if an adventurer can stand at (x, z). */
export function groveWalkable(x: number, z: number): boolean { return groveGroundY(x, z) !== null; }
/** True if an adventurer can stand at (x, z) in the grove town area, which is all the online zone allows (not the Beacon clearing). */
export function groveTownWalkable(x: number, z: number): boolean { return x * x + z * z < TOWN_R * TOWN_R && groveWalkable(x, z); }
/** Height of what an adventurer stands on at (x, z) in the grove (terrain or a platform top), or null. */
export function groveSurface(x: number, z: number): number | null { return defaultWalk().surfaceAt(x, z); }
/** groveSurface limited to the grove town area (null outside the radius groveTownWalkable uses). */
export function groveTownSurface(x: number, z: number): number | null { return x * x + z * z < TOWN_R * TOWN_R ? groveSurface(x, z) : null; }
