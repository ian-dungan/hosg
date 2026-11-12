// (Line comments only: the generator source scan forbids a double star.)
// The dungeon generator: turns a DungeonRecipe (rooms in order, corridor sizes, one stair) into the
// Lampfall's floor plan: room circles joined by straight corridors, pillars and rubble, the enemy camps
// from the encounter table, the sealed arenas' gate circles, the exit stair and the lamp-lift. Nothing
// is placed by hand.
//
// The server and every client run this, so it follows recipe.ts's rule: only exactly-rounded
// operations (+ − × ÷, sqrt, floor, round, min/max/abs). No trigonometry, exponentials, powers or
// Math's own random (recipe.test.ts and dungeon.test.ts scan this file). Yaws come from yawOf, an
// arctangent built from those operations alone.
import { ENCOUNTERS, type EncounterId } from '../combat/encounters';
import { SEAL_GATE_R, type CheckpointId } from '../instance';
import { prng, type CampSpawn } from './recipe';
import { ZoneWalk } from './zoneWalk';
import { ZONE_Y_MAX_M, ZONE_Y_MIN_M, assertInsideZoneLimits } from './limits';
import type { Obstacle } from './layout';
import type { Sanctuary } from './zones';

export type RoomId = 'rim' | 'root_cellar' | 'brass_gallery' | 'cog_hall' | 'wick_den' | 'landing' | 'lens_pit';
export interface RoomSpec {
  id: RoomId; name: string; r: number; floorY: number; encounter?: EncounterId;
  pillars: number; platforms: number; sanctuary?: boolean; checkpoint?: CheckpointId; sealed?: boolean;
}
export interface DungeonRecipe {
  id: 'lampfall'; seed: number; rooms: readonly RoomSpec[];
  corridor: { width: number; minLen: number; maxLen: number };
  // The corridor between these two rooms drops in flat terraces instead of a ramp.
  stair: { between: [RoomId, RoomId]; stepRise: number; stepLen: number };
}

// The Lampfall: the crater beneath the Greenway's east end, where the Beacon's keeper fell.
export const LAMPFALL_RECIPE: DungeonRecipe = {
  id: 'lampfall', seed: 4404,
  rooms: [
    { id: 'rim', name: 'Crater Rim', r: 9, floorY: 0, pillars: 0, platforms: 2, checkpoint: 'rim', sanctuary: true },
    { id: 'root_cellar', name: 'Root Cellar', r: 11, floorY: -3, encounter: 'root_cellar', pillars: 2, platforms: 1 },
    { id: 'brass_gallery', name: 'Brass Gallery', r: 13, floorY: -6, encounter: 'brass_gallery', pillars: 6, platforms: 3 },
    { id: 'cog_hall', name: 'Cog Hall', r: 12, floorY: -9, encounter: 'cog_hall', pillars: 4, platforms: 2 },
    { id: 'wick_den', name: 'Wick Den', r: 16, floorY: -12, encounter: 'wickhound', pillars: 0, platforms: 0, sealed: true },
    { id: 'landing', name: "Keeper's Landing", r: 8, floorY: -15, pillars: 0, platforms: 1, checkpoint: 'landing', sanctuary: true },
    { id: 'lens_pit', name: 'Lens Pit', r: 22, floorY: -18, encounter: 'warden', pillars: 0, platforms: 0, sealed: true },
  ],
  corridor: { width: 5, minLen: 12, maxLen: 18 },
  stair: { between: ['wick_den', 'landing'], stepRise: 1.0, stepLen: 4 },
};

export interface Gate { x: number; z: number; r: number }
export interface DungeonRoom {
  id: RoomId; name: string; x: number; z: number; r: number; floorY: number;
  // Yaw from the room centre toward the corridor it is entered by (as Pose.facing). The rim, entered
  // by none, points along its only corridor (into the dungeon).
  entryDir: number;
  // Sealed rooms: the gate circle on their entry corridor (null otherwise).
  gate: Gate | null;
  // Sealed rooms with a way on (the Wick Den): the gate circle on the corridor they are left by. A
  // sealed arena with an open back door would be no seal: the server shuts both.
  exitGate: Gate | null;
  spawns: CampSpawn[]; checkpoint?: CheckpointId; sanctuary?: Sanctuary;
}
export interface DungeonCorridor {
  from: RoomId; to: RoomId;
  // a: where it leaves `from` (on that room's edge); b: where it enters `to`. w: its width.
  ax: number; az: number; bx: number; bz: number; w: number;
  // The floor at a and at b; steps: the number of terrace drops between them (0 for a ramp).
  ay: number; by: number; steps: number;
}
export interface DungeonLayout {
  recipe: DungeonRecipe; rooms: DungeonRoom[];
  corridors: DungeonCorridor[];
  // Walls (no top). h: visual height only.
  pillars: { x: number; z: number; r: number; h: number }[];
  // Platforms: top is the standing height.
  rubble: { x: number; z: number; r: number; top: number }[];
  // In the rim: back to the Greenway.
  exitStair: { x: number; z: number; r: number };
  // The Lens Pit's centre (opens after the Warden).
  lampLift: { x: number; z: number; r: number };
  walk: DungeonWalk;
}

// ───────── exact arctangent ─────────

const PI = Math.PI, HALF_PI = PI / 2, SIXTH_PI = PI / 6;
const SQRT3 = Math.sqrt(3), INV_SQRT3 = 1 / SQRT3, TAN_PI_12 = 2 - SQRT3;

// atan(t) for t in [0, 1]: reduced to |u| ≤ tan(π/12) (≈ 0.268), then its Taylor series to u²¹
// (the next term is below 2e-14).
function atanUnit(t: number): number {
  let base = 0, u = t;
  if (t > TAN_PI_12) { u = (t - INV_SQRT3) / (1 + t * INV_SQRT3); base = SIXTH_PI; }
  const u2 = u * u;
  let s = 0;
  for (let k = 21; k >= 1; k -= 2) s = 1 / k - u2 * s;
  return base + u * s;
}

// The yaw facing (dx, dz), as Pose.facing (forward = (sin f, cos f)): atan2(dx, dz), in [−π, π].
export function yawOf(dx: number, dz: number): number {
  const ax = Math.abs(dx), az = Math.abs(dz);
  if (ax === 0 && az === 0) return 0;
  let a = ax <= az ? atanUnit(ax / az) : HALF_PI - atanUnit(az / ax);
  if (dz < 0) a = PI - a;
  return dx < 0 ? -a : a;
}

// ───────── walkability ─────────

// Where an adventurer can stand in a dungeon: the union of the room circles and the corridor capsules
// (each running centre to centre, so its ends lie inside the rooms), minus pillars, plus rubble tops.
// The same meanings as ZoneWalk's: groundAt is null on any obstacle, surfaceAt stands on platform tops.
export class DungeonWalk {
  private readonly inner: ZoneWalk;
  // Each corridor's capsule: from one room centre (fx, fz) along (sx, sz) to the other.
  private readonly caps: { c: DungeonCorridor; fx: number; fz: number; sx: number; sz: number; s2: number }[];
  constructor(private readonly rooms: readonly DungeonRoom[], corridors: readonly DungeonCorridor[],
    private readonly stairStepLen: number, obstacles: readonly Obstacle[]) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rooms) { x0 = Math.min(x0, r.x - r.r); x1 = Math.max(x1, r.x + r.r); z0 = Math.min(z0, r.z - r.r); z1 = Math.max(z1, r.z + r.r); }
    this.caps = corridors.map(c => {
      const from = rooms.find(r => r.id === c.from)!, to = rooms.find(r => r.id === c.to)!;
      const sx = to.x - from.x, sz = to.z - from.z;
      return { c, fx: from.x, fz: from.z, sx, sz, s2: sx * sx + sz * sz };
    });
    this.inner = new ZoneWalk({ x0, x1, z0, z1 }, (x, z) => this.floor(x, z) ?? 0, obstacles);
  }

  // The floor height at (x, z), or null outside every room and corridor (obstacles not counted).
  floor(x: number, z: number): number | null {
    for (const r of this.rooms) { const dx = x - r.x, dz = z - r.z; if (dx * dx + dz * dz <= r.r * r.r) return r.floorY; }
    for (const { c, fx, fz, sx, sz, s2 } of this.caps) {
      // inside the capsule from centre to centre?
      const t = Math.min(1, Math.max(0, ((x - fx) * sx + (z - fz) * sz) / s2));
      const px = x - fx - sx * t, pz = z - fz - sz * t, hw = c.w / 2;
      if (px * px + pz * pz > hw * hw) continue;
      return corridorFloor(c, x, z, this.stairStepLen);
    }
    return null;
  }

  // Floor height where an adventurer can stand, or null (off the floor, or any obstacle, platforms included).
  groundAt(x: number, z: number): number | null { return this.floor(x, z) === null ? null : this.inner.groundAt(x, z); }
  // Height of what an adventurer would stand on (the floor or a platform top), or null (off the floor or a wall).
  surfaceAt(x: number, z: number): number | null { return this.floor(x, z) === null ? null : this.inner.surfaceAt(x, z); }
}

// A corridor's floor at (x, z): along its edge-to-edge axis, a ramp from ay to by, or terraces.
function corridorFloor(c: DungeonCorridor, x: number, z: number, stepLen: number): number {
  const ex = c.bx - c.ax, ez = c.bz - c.az, len = Math.sqrt(ex * ex + ez * ez);
  const s = Math.min(len, Math.max(0, ((x - c.ax) * ex + (z - c.az) * ez) / len));
  if (c.steps === 0) return c.ay + (c.by - c.ay) * (s / len);
  // terrace edges at o, o + stepLen, ...: the flight centred in the corridor
  const o = (len - (c.steps - 1) * stepLen) / 2, rise = (c.by - c.ay) / c.steps;
  let k = 0;
  for (let j = 0; j < c.steps; j++) if (s >= o + j * stepLen) k++;
  return c.ay + rise * k;
}

// ───────── the generator ─────────

// Least gap between a room and any room or corridor it does not join, in m.
const ROOM_GAP = 6;
const ROOM_REROLLS = 20;
// Steepest ramp a corridor may be.
const MAX_SLOPE = 0.25;
// Each terrace of a stair is at least this long, in m (the first and last too).
const MIN_TERRACE = 2;
// Obstacle sizes: pillar radius and visual height, rubble radius and height above the floor.
const PILLAR_R: [number, number] = [0.8, 1.4], PILLAR_H: [number, number] = [3, 5.5];
const RUBBLE_R: [number, number] = [1, 1.8], RUBBLE_RISE: [number, number] = [0.45, 1.05];
// An obstacle's edge keeps this far from spawns, the room centre, corridor mouths (beyond the corridor's
// half-width) and other obstacles; and from the room's wall (so the gap there can be walked), unless set into it.
const OBSTACLE_GAP = 2.5, WALL_GAP = 1.2;
// ...or it is set into the wall by at least this much (its centre still on the floor).
const WALL_SET_IN = 0.3;
// A clear lane (each side of the axis) from the room centre to each corridor mouth.
const LANE = 1.5;
const OBSTACLE_TRIES = 600;
// The sanctuary circle at the rim's and the landing's centre, in m.
export const SANCTUARY_R = 6;
// The exit stair: this far from the rim's centre, away from its corridor; and its radius (and the lamp-lift's).
const EXIT_STAIR_FROM_CENTRE = 6, EXIT_R = 2.5;
// A gate circle's centre is this far beyond the room's edge (so it overlaps the room a little and no
// sliver of corridor is left between the two).
const GATE_OUT = SEAL_GATE_R - 1;

function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const sx = bx - ax, sz = bz - az, s2 = sx * sx + sz * sz;
  const t = s2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * sx + (pz - az) * sz) / s2));
  const dx = px - ax - sx * t, dz = pz - az - sz * t;
  return dx * dx + dz * dz;
}
const cross = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
// Distance between segments ab and cd (0 when they cross).
function segSegDist(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const d1 = cross(ax, az, bx, bz, cx, cz), d2 = cross(ax, az, bx, bz, dx, dz), d3 = cross(cx, cz, dx, dz, ax, az), d4 = cross(cx, cz, dx, dz, bx, bz);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.sqrt(Math.min(segDist2(ax, az, cx, cz, dx, dz), segDist2(bx, bz, cx, cz, dx, dz), segDist2(cx, cz, ax, az, bx, bz), segDist2(dx, dz, ax, az, bx, bz)));
}

export function generateDungeon(r: DungeonRecipe): DungeonLayout {
  const fail = (why: string): never => { throw new Error(`generateDungeon(${r.id}): ${why}`); };
  const rng = prng(r.seed);
  const specs = r.rooms, w = r.corridor.width, hw = w / 2;
  if (specs.length < 2 || specs[0].id !== 'rim') fail('the first room must be the rim');

  // 1. rooms, in order: each at corridor length + both radii from the one before, within ±60° of +x
  const placed: { spec: RoomSpec; x: number; z: number; ux: number; uz: number }[] = [{ spec: specs[0], x: 20, z: 0, ux: 1, uz: 0 }];
  const segs: { ax: number; az: number; bx: number; bz: number; len: number }[] = [];
  for (let i = 1; i < specs.length; i++) {
    const prev = placed[i - 1], spec = specs[i];
    let found = false;
    for (let attempt = 0; attempt <= ROOM_REROLLS && !found; attempt++) {
      // a direction by its slope: tan(±60°) = ±√3 (exact arithmetic, no angle)
      const slope = (2 * rng() - 1) * SQRT3, n = Math.sqrt(1 + slope * slope), ux = 1 / n, uz = slope / n;
      const len = r.corridor.minLen + (r.corridor.maxLen - r.corridor.minLen) * rng();
      const d = prev.spec.r + len + spec.r, x = prev.x + ux * d, z = prev.z + uz * d;
      const seg = { ax: prev.x + ux * prev.spec.r, az: prev.z + uz * prev.spec.r, bx: x - ux * spec.r, bz: z - uz * spec.r, len };
      let ok = true;
      // the new room against every earlier room (but the one it joins) and every earlier corridor
      for (let k = 0; k < i - 1 && ok; k++) {
        const o = placed[k], dx = x - o.x, dz = z - o.z, gap = o.spec.r + spec.r + ROOM_GAP;
        if (dx * dx + dz * dz < gap * gap) ok = false;
      }
      for (const s of segs) if (ok && segDist2(x, z, s.ax, s.az, s.bx, s.bz) < (spec.r + hw + ROOM_GAP) * (spec.r + hw + ROOM_GAP)) ok = false;
      // the new corridor against every earlier room (but the one it leaves) and corridor (but the one into it)
      for (let k = 0; k < i - 1 && ok; k++) {
        const o = placed[k], gap = o.spec.r + hw + ROOM_GAP;
        if (segDist2(o.x, o.z, seg.ax, seg.az, seg.bx, seg.bz) < gap * gap) ok = false;
      }
      for (let k = 0; k < segs.length - 1 && ok; k++) {
        const s = segs[k];
        if (segSegDist(s.ax, s.az, s.bx, s.bz, seg.ax, seg.az, seg.bx, seg.bz) < w + ROOM_GAP) ok = false;
      }
      if (ok) { placed.push({ spec, x, z, ux, uz }); segs.push(seg); found = true; }
    }
    if (!found) fail(`no room for ${spec.id}`);
  }
  // the rim's own direction is its corridor's
  placed[0].ux = placed[1].ux; placed[0].uz = placed[1].uz;

  // 2. limits: every room inside ±ZONE_XZ_MAX_M, every floor and platform within the heights
  for (const p of placed) {
    assertInsideZoneLimits(`generateDungeon(${r.id}): room ${p.spec.id}'s corner`, p.x - p.spec.r, p.z - p.spec.r, p.spec.floorY);
    assertInsideZoneLimits(`generateDungeon(${r.id}): room ${p.spec.id}'s corner`, p.x + p.spec.r, p.z + p.spec.r, p.spec.floorY);
    if (p.spec.floorY + RUBBLE_RISE[1] > ZONE_Y_MAX_M || p.spec.floorY < ZONE_Y_MIN_M) fail(`room ${p.spec.id}'s heights are outside the zone limits`);
  }

  // 3. corridors: ramps (slope ≤ MAX_SLOPE), or the stair's terraces
  const corridors: DungeonCorridor[] = segs.map((s, i) => {
    const a = specs[i], b = specs[i + 1];
    const stair = r.stair.between[0] === a.id && r.stair.between[1] === b.id;
    const drop = b.floorY - a.floorY;
    let steps = 0;
    if (stair) {
      steps = Math.round(Math.abs(drop) / r.stair.stepRise);
      if (steps < 1 || Math.abs(steps * r.stair.stepRise - Math.abs(drop)) > 1e-9) fail(`the stair ${a.id}>${b.id} does not divide into ${r.stair.stepRise} m steps`);
      if ((s.len - (steps - 1) * r.stair.stepLen) / 2 < MIN_TERRACE) fail(`the stair ${a.id}>${b.id} is too short for its steps`);
    } else if (Math.abs(drop) > MAX_SLOPE * s.len) fail(`the corridor ${a.id}>${b.id} is steeper than ${MAX_SLOPE}`);
    return { from: a.id, to: b.id, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz, w, ay: a.floorY, by: b.floorY, steps };
  });

  // 4. rooms: entry direction, gates, spawns (the encounter's −z toward the entry mouth), checkpoint, sanctuary
  const rooms: DungeonRoom[] = placed.map((p, i) => {
    const { spec } = p;
    // e: unit vector from the centre toward the entry mouth (the rim: along its corridor)
    const ex = i === 0 ? p.ux : -p.ux, ez = i === 0 ? p.uz : -p.uz;
    const entry = { x: p.x + ex * spec.r, z: p.z + ez * spec.r };
    const next = placed[i + 1];
    const room: DungeonRoom = {
      id: spec.id, name: spec.name, x: p.x, z: p.z, r: spec.r, floorY: spec.floorY, entryDir: yawOf(ex, ez),
      gate: spec.sealed && i > 0 ? { x: p.x + ex * (spec.r + GATE_OUT), z: p.z + ez * (spec.r + GATE_OUT), r: SEAL_GATE_R } : null,
      exitGate: spec.sealed && next ? { x: p.x + next.ux * (spec.r + GATE_OUT), z: p.z + next.uz * (spec.r + GATE_OUT), r: SEAL_GATE_R } : null,
      spawns: [],
    };
    if (spec.encounter) {
      // local +z is away from the entry (−e), local +x is +z turned a quarter right: (−ez, ex)
      for (const s of ENCOUNTERS[spec.encounter].spawns) {
        const x = p.x + s.dx * -ez + s.dz * -ex, z = p.z + s.dx * ex + s.dz * -ez;
        room.spawns.push({ kind: s.kind, x, z, facing: yawOf(entry.x - x, entry.z - z) });
      }
    }
    if (spec.checkpoint) room.checkpoint = spec.checkpoint;
    if (spec.sanctuary) room.sanctuary = { x: p.x, z: p.z, r: SANCTUARY_R, name: spec.name };
    return room;
  });

  // 5. the exit stair (in the rim, opposite its corridor) and the lamp-lift (the last room's centre)
  const rim = placed[0], last = rooms[rooms.length - 1];
  const exitStair = { x: rim.x - rim.ux * EXIT_STAIR_FROM_CENTRE, z: rim.z - rim.uz * EXIT_STAIR_FROM_CENTRE, r: EXIT_R };
  const lampLift = { x: last.x, z: last.z, r: EXIT_R };

  // 6. pillars and rubble: rejection-sampled per room, clear of spawns, the centre, the corridor mouths
  // and lanes, the exit stair, the wall and each other
  const pillars: DungeonLayout['pillars'] = [], rubble: DungeonLayout['rubble'] = [];
  placed.forEach((p, i) => {
    const room = rooms[i], R = p.spec.r;
    const mouths: { x: number; z: number }[] = [];
    if (i > 0) mouths.push({ x: corridors[i - 1].bx, z: corridors[i - 1].bz });
    if (i < corridors.length) mouths.push({ x: corridors[i].ax, z: corridors[i].az });
    const mine: { x: number; z: number; r: number }[] = [];
    const fits = (x: number, z: number, or: number): boolean => {
      const dx = x - p.x, dz = z - p.z, dc2 = dx * dx + dz * dz;
      // against the wall: either a walkable gap of WALL_GAP, or set into the wall (no gap at all)
      const outer = R - or - WALL_GAP, setIn = R - or + WALL_SET_IN, innerR = or + OBSTACLE_GAP;
      if (dc2 > R * R || dc2 < innerR * innerR) return false;
      if (dc2 > outer * outer && (outer < 0 || dc2 < setIn * setIn)) return false;
      for (const s of room.spawns) if ((x - s.x) * (x - s.x) + (z - s.z) * (z - s.z) < innerR * innerR) return false;
      for (const m of mouths) {
        const g = or + OBSTACLE_GAP + hw;
        if ((x - m.x) * (x - m.x) + (z - m.z) * (z - m.z) < g * g) return false;
        if (segDist2(x, z, p.x, p.z, m.x, m.z) < (or + LANE) * (or + LANE)) return false;
      }
      if (i === 0) {
        const g = or + exitStair.r + 1;
        if ((x - exitStair.x) * (x - exitStair.x) + (z - exitStair.z) * (z - exitStair.z) < g * g) return false;
      }
      for (const o of mine) { const g = or + o.r + OBSTACLE_GAP; if ((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z) < g * g) return false; }
      return true;
    };
    const place = (count: number, rr: [number, number], what: string, add: (x: number, z: number, or: number) => void) => {
      for (let k = 0; k < count; k++) {
        let ok = false;
        for (let t = 0; t < OBSTACLE_TRIES && !ok; t++) {
          const or = rr[0] + (rr[1] - rr[0]) * rng(), x = p.x + (2 * rng() - 1) * R, z = p.z + (2 * rng() - 1) * R;
          if (!fits(x, z, or)) continue;
          mine.push({ x, z, r: or }); add(x, z, or); ok = true;
        }
        if (!ok) fail(`no room for ${what} ${k} in ${p.spec.id}`);
      }
    };
    place(p.spec.pillars, PILLAR_R, 'pillar', (x, z, or) => pillars.push({ x, z, r: or, h: PILLAR_H[0] + (PILLAR_H[1] - PILLAR_H[0]) * rng() }));
    place(p.spec.platforms, RUBBLE_R, 'rubble', (x, z, or) => rubble.push({ x, z, r: or, top: p.spec.floorY + RUBBLE_RISE[0] + (RUBBLE_RISE[1] - RUBBLE_RISE[0]) * rng() }));
  });

  // 7. walkability
  const obstacles: Obstacle[] = [
    ...pillars.map((o): Obstacle => ({ kind: 'c', x: o.x, z: o.z, r: o.r })),
    ...rubble.map((o): Obstacle => ({ kind: 'c', x: o.x, z: o.z, r: o.r, top: o.top })),
  ];
  const walk = new DungeonWalk(rooms, corridors, r.stair.stepLen, obstacles);
  return { recipe: r, rooms, corridors, pillars, rubble, exitStair, lampLift, walk };
}

let lampfall: DungeonLayout | null = null;
// generateDungeon(LAMPFALL_RECIPE), generated once (the layout behind zoneDef('lampfall')).
export function lampfallLayout(): DungeonLayout { return (lampfall ??= generateDungeon(LAMPFALL_RECIPE)); }
