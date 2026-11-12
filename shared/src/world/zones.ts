// The zone registry: every zone room's walkability, spawn point, enemy camps and exits.
// Built lazily and cached, so importing this costs nothing until a zone is asked for.
import { SPAWN } from '../constants';
import { REASON_GROVE_FULL } from '../messages';
import { REASON_INSTANCES_FULL } from '../instance';
import type { Surface } from '../body';
import { bandR, createGroveWalk, groveTownSurface, roadZ as groveRoadZ } from './layout';
import { GREENWAY_RECIPE, generateZone, type CampSpawn } from './recipe';
import { checkZoneLimits } from './limits';
import { lampfallLayout } from './dungeon';
import { GROVE_OBSTACLES } from './obstacles';
import type { Obstacle } from './layout';

/**
 * What the combat engine needs from a zone (same shape as combat/engine.ts's CombatZone, Task 2;
 * restated so the world registry does not depend on the combat package).
 */
export interface CombatZone {
  readonly surface: Surface; readonly ground: Surface; readonly sight: (x: number, z: number) => boolean; readonly camps: readonly CampSpawn[];
  /** Whether an adventurer standing at (x, z) may change job (jobSwitchAt of the zone's def). */
  readonly jobSwitch: (x: number, z: number) => boolean;
}

/** A circle where jobs can be changed outside a town (a safe camp). */
export interface Sanctuary { readonly x: number; readonly z: number; readonly r: number; readonly name: string }

/** Why a job change is refused where jobSwitch is false. */
export const REASON_JOB_NOT_HERE = 'Jobs can be changed only in a town or a sanctuary';

/** True in a town, anywhere; elsewhere only inside a sanctuary circle (its edge counts as inside). */
export function jobSwitchAt(def: Pick<ZoneDef, 'town' | 'sanctuaries'>, x: number, z: number): boolean {
  if (def.town) return true;
  for (const s of def.sanctuaries) {
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r) return true;
  }
  return false;
}

export type ZoneId = 'grove' | 'greenway' | 'lampfall';
/** Every zone with a def. The Lampfall is instanced: the server opens a room per party, never one up front. */
export const ZONE_IDS: readonly ZoneId[] = ['grove', 'greenway', 'lampfall'];
export function isZoneId(v: unknown): v is ZoneId { return typeof v === 'string' && (ZONE_IDS as readonly string[]).includes(v); }
/** A zone an adventurer may be saved in (and the zones with one shared room each). Never the Lampfall. */
export type SaveZoneId = 'grove' | 'greenway';
export const SAVE_ZONE_IDS: readonly SaveZoneId[] = ['grove', 'greenway'];
export function isSaveZoneId(v: unknown): v is SaveZoneId { return typeof v === 'string' && (SAVE_ZONE_IDS as readonly string[]).includes(v); }

/** Walking into the circle (x, z, r) takes an adventurer to zone `to`, standing at `arrive`. Closed exits do nothing. */
export interface ZoneExit {
  readonly to: ZoneId; readonly x: number; readonly z: number; readonly r: number;
  readonly arrive: { readonly x: number; readonly z: number; readonly facing: number };
  /** Whether the exit works by default. Defs are frozen: a gate opened at run time lives in server state, not here. */
  readonly open: boolean;
  /** The exit leads into an instance (the Greenway's crater mouth): the server picks the party's room. */
  readonly instance?: true;
}
/** Deeply frozen and shared by every caller (zoneDef caches it). */
export interface ZoneDef extends CombatZone {
  readonly id: ZoneId; readonly name: string; readonly banner: readonly [string, string];
  readonly spawn: { readonly x: number; readonly z: number; readonly facing: number };
  readonly exits: readonly ZoneExit[];
  /** A town: jobs can be changed anywhere in it. */
  readonly town: boolean;
  /** Circles outside a town where jobs can be changed too (the Lampfall's rim and landing). */
  readonly sanctuaries: readonly Sanctuary[];
  /** An instanced zone (only the Lampfall): a room per party, opened by the server; never saved in. */
  readonly instanced: boolean;
}

/**
 * The Guild Board in the grove's Plaza of the Two, where the job board is opened: south-east of the
 * statue, about 4 m from SPAWN, facing it. A marker only, not an obstacle (nothing collides with it).
 */
export const GUILD_BOARD: { readonly x: number; readonly z: number; readonly facing: number } = Object.freeze({
  x: 3, z: -8, facing: Math.atan2(SPAWN.x - 3, SPAWN.z - -8),
});

type BaseDef = Omit<ZoneDef, 'town' | 'sanctuaries' | 'jobSwitch' | 'instanced'>;
/** Adds town, sanctuaries and their jobSwitch, and instanced, to a def. */
function withJobs(d: BaseDef, town: boolean, sanctuaries: Sanctuary[], instanced = false): ZoneDef {
  const def: ZoneDef = { ...d, town, sanctuaries, instanced, jobSwitch: (x, z) => jobSwitchAt(def, x, z) };
  return def;
}

/** The farm gate across Shady Grove's east road, where the walkable band ends (the loop countryside.ts used to run itself). */
export const GROVE_EAST_GATE: { x: number; z: number } = (() => {
  let x = 80;
  while (Math.hypot(x, groveRoadZ(x)) < bandR(Math.atan2(groveRoadZ(x), x)) - 1.5) x += 0.5;
  return { x, z: groveRoadZ(x) };
})();

/** Radius of each exit circle, in m. */
const EXIT_R = 2.5;
/** How far inside the grove's east gate an adventurer arrives from the Greenway, in m. */
const GROVE_ARRIVE_BACK = 5;

function buildGrove(): ZoneDef {
  return withJobs(groveBase(), true, []);
}

function buildGreenway(): ZoneDef {
  return withJobs(greenwayBase(), false, []); // a data hook: later safe camps go here
}

function groveBase(): BaseDef {
  const walk = createGroveWalk();
  const surface: Surface = groveTownSurface;
  const ground: Surface = (x, z) => (groveTownSurface(x, z) === null ? null : walk.groundAt(x, z));
  return {
    id: 'grove', name: 'Shady Grove', banner: ['The Plaza of the Two', 'Shady Grove'],
    surface, ground, sight: (x, z) => surface(x, z) !== null, camps: [],
    spawn: { ...SPAWN },
    exits: [{ to: 'greenway', x: GROVE_EAST_GATE.x, z: GROVE_EAST_GATE.z, r: EXIT_R, arrive: { ...greenwayLayout().entry }, open: true }],
  };
}

function greenwayBase(): BaseDef {
  const layout = greenwayLayout();
  const surface: Surface = (x, z) => layout.walk.surfaceAt(x, z);
  const ax = GROVE_EAST_GATE.x - GROVE_ARRIVE_BACK;
  return {
    id: 'greenway', name: 'The Greenway', banner: ['The Greenway', 'Beyond the east gate'],
    surface, ground: (x, z) => layout.walk.groundAt(x, z), sight: (x, z) => surface(x, z) !== null,
    camps: layout.camps.flatMap(c => c.spawns.map(sp => ({ ...sp }))), // copies: freezing the def leaves the layout alone
    spawn: { ...layout.entry },
    exits: [
      { to: 'grove', x: layout.westGate.x, z: layout.westGate.z, r: EXIT_R, arrive: { x: ax, z: groveRoadZ(ax), facing: -Math.PI / 2 }, open: true },
      { to: 'lampfall', x: layout.mouth.x, z: layout.mouth.z, r: EXIT_R, arrive: lampfallSpawn(), open: true, instance: true },
    ],
  };
}

/** Where an adventurer stands on entering the Lampfall: the rim's centre, facing into the dungeon. */
function lampfallSpawn(): { x: number; z: number; facing: number } {
  const rim = lampfallLayout().rooms[0];
  return { x: rim.x, z: rim.z, facing: rim.entryDir };
}

function buildLampfall(): ZoneDef {
  const layout = lampfallLayout();
  const surface: Surface = (x, z) => layout.walk.surfaceAt(x, z);
  const back = { ...LAMPFALL_MOUTH.arrive };
  const base: BaseDef = {
    id: 'lampfall', name: 'The Lampfall', banner: ['The Lampfall', 'Where the Warden fell'],
    surface, ground: (x, z) => layout.walk.groundAt(x, z), sight: (x, z) => surface(x, z) !== null,
    // Data only for now: no room for this zone is opened until the server has instances (Plan 4 Task 7).
    camps: layout.rooms.flatMap(r => r.spawns.map(sp => ({ ...sp }))), // copies: freezing the def leaves the layout alone
    spawn: lampfallSpawn(),
    exits: [
      { to: 'greenway', x: layout.exitStair.x, z: layout.exitStair.z, r: layout.exitStair.r, arrive: back, open: true },
      // the lamp-lift: shut until the Warden falls (the server opens it per instance)
      { to: 'greenway', x: layout.lampLift.x, z: layout.lampLift.z, r: layout.lampLift.r, arrive: { ...back }, open: false },
    ],
  };
  const sanctuaries = layout.rooms.flatMap(r => (r.sanctuary ? [{ ...r.sanctuary }] : []));
  return withJobs(base, false, sanctuaries, true);
}

/** Step back from the crater mouth along the road to arrive at, in m. */
const MOUTH_ARRIVE_BACK = 5;
let mouth: { x: number; z: number; r: number; arrive: { x: number; z: number; facing: number } } | null = null;
function mouthData() {
  if (!mouth) {
    const gw = greenwayLayout(), ax = gw.mouth.x - MOUTH_ARRIVE_BACK;
    mouth = deepFreeze({ x: gw.mouth.x, z: gw.mouth.z, r: EXIT_R, arrive: { x: ax, z: gw.roadZ(ax), facing: Math.PI / 2 } });
  }
  return mouth;
}
/**
 * The crater mouth in the Greenway (the exit into the Lampfall), and where an adventurer leaving the
 * Lampfall stands: on the road just west of it. Read lazily: the Greenway is generated on first use.
 */
export const LAMPFALL_MOUTH: { readonly x: number; readonly z: number; readonly r: number; readonly arrive: { readonly x: number; readonly z: number; readonly facing: number } } = Object.freeze({
  get x() { return mouthData().x; },
  get z() { return mouthData().z; },
  get r() { return mouthData().r; },
  get arrive() { return mouthData().arrive; },
});

let greenway: ReturnType<typeof generateZone> | null = null;
/** generateZone(GREENWAY_RECIPE), generated once (the layout behind zoneDef('greenway')). */
export function greenwayLayout() { return (greenway ??= generateZone(GREENWAY_RECIPE)); }

/** Freezes o and everything reachable from it (functions are left as they are). */
function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const defs = new Map<ZoneId, ZoneDef>();
/** The zone's definition, built on first use (and checked against the zone limits, limits.ts) and cached. */
export function zoneDef(id: ZoneId): ZoneDef {
  let d = defs.get(id);
  if (!d) {
    const built = id === 'grove' ? buildGrove() : id === 'greenway' ? buildGreenway() : buildLampfall();
    checkZoneLimits(built); // throws for a zone the room's state could not carry
    d = deepFreeze(built);
    defs.set(id, d);
  }
  return d;
}

/** The text a join is refused with when the zone's room is full. */
export function zoneFullReason(id: ZoneId): string {
  return id === 'grove' ? REASON_GROVE_FULL : id === 'greenway' ? 'The Greenway is full, try again soon' : REASON_INSTANCES_FULL;
}

// ───────── town stalls ─────────
export type StallId = 'smithy' | 'tailor' | 'barber' | 'lampwright' | 'vault';
export const STALL_IDS: readonly StallId[] = Object.freeze(['smithy', 'tailor', 'barber', 'lampwright', 'vault']);
/** Stall operations need the adventurer within this of the stall (m), in the grove. */
export const STALL_REACH = 3.5;

/**
 * Where each stall stands, as [angle in degrees, radius in m] from the statue (x = r·cos a, z = r·sin a):
 * the first spot searchStallSpots() finds for it (zones.test.ts checks they agree, and snapshots them).
 */
const STALL_SPOTS: Readonly<Record<StallId, readonly [number, number]>> = Object.freeze({
  smithy: [30, 17], tailor: [75, 14], barber: [90, 16], lampwright: [90, 20], vault: [150, 14],
});
const STALL_NAMES: Readonly<Record<StallId, { name: string; keeper: string }>> = Object.freeze({
  smithy: { name: 'Kettleworth Smithy', keeper: 'Hob Kettleworth' },
  tailor: { name: 'Bobbin & Thimble', keeper: 'Wren Bobbin' },
  barber: { name: 'The Trimmed Hedge', keeper: 'Old Sorrel' },
  lampwright: { name: 'The Lampwright', keeper: 'Ottilie Brasswick' },
  vault: { name: 'The Grove Vault', keeper: 'Clerk Amsel' },
});

/** The five town stalls around the Plaza of the Two, each facing the statue (facing = atan2(dx, dz) towards it). */
export const TOWN_STALLS: Readonly<Record<StallId, { readonly x: number; readonly z: number; readonly facing: number; readonly name: string; readonly keeper: string }>> =
  deepFreeze(Object.fromEntries(STALL_IDS.map(id => {
    const [deg, r] = STALL_SPOTS[id], a = (deg * Math.PI) / 180, x = r * Math.cos(a), z = r * Math.sin(a);
    return [id, { x, z, facing: Math.atan2(-x, -z), ...STALL_NAMES[id] }];
  })) as Record<StallId, { x: number; z: number; facing: number; name: string; keeper: string }>);

/** The stall within STALL_REACH of (x, z) in `zone` (the nearest), or null; only the grove has stalls. */
export function stallAt(zone: ZoneId, x: number, z: number): StallId | null {
  if (zone !== 'grove' || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  let best: StallId | null = null, bestD = STALL_REACH;
  for (const id of STALL_IDS) {
    const d = Math.hypot(TOWN_STALLS[id].x - x, TOWN_STALLS[id].z - z);
    if (d <= bestD) { best = id; bestD = d; }
  }
  return best;
}

/** How far (x, z) is from an obstacle's edge (negative inside). */
function obstacleClearance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === 'c') return Math.hypot(dx, dz) - o.r;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hw, lz = Math.abs(dx * o.s + dz * o.c) - o.hd;
  return lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}
/** The distance from (px, pz) to the segment a–b. */
export function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(px - ax - t * vx, pz - az - t * vz);
}

/** The placement rule's distances (m). */
export const STALL_RULE = Object.freeze({ rMin: 12, rMax: 20, clear: 4, offLine: 3, groundR: 1 });

/** Whether (x, z) meets the placement rule against the grove and the stalls already placed. */
export function stallSpotOk(x: number, z: number, placed: readonly { x: number; z: number }[]): boolean {
  const grove = zoneDef('grove'), r = Math.hypot(x, z);
  if (r < STALL_RULE.rMin || r > STALL_RULE.rMax) return false;
  if (grove.ground(x, z) === null) return false;
  for (let k = 0; k < 8; k++) {
    const b = (k * Math.PI) / 4;
    if (grove.ground(x + STALL_RULE.groundR * Math.cos(b), z + STALL_RULE.groundR * Math.sin(b)) === null) return false;
  }
  for (const o of GROVE_OBSTACLES) if (obstacleClearance(o, x, z) < STALL_RULE.clear) return false; // the statue's base is the first obstacle
  if (Math.hypot(x - GUILD_BOARD.x, z - GUILD_BOARD.z) < STALL_RULE.clear || Math.hypot(x - SPAWN.x, z - SPAWN.z) < STALL_RULE.clear) return false;
  for (const e of grove.exits) if (segmentDistance(x, z, SPAWN.x, SPAWN.z, e.x, e.z) < STALL_RULE.offLine) return false;
  for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < STALL_RULE.clear) return false;
  return true;
}

/**
 * The deterministic search behind STALL_SPOTS: for each stall in table order, angles in 15° steps from 30°
 * (all the way round), radii 12..20 m in whole metres, the first spot meeting stallSpotOk. Slow (tests only).
 */
export function searchStallSpots(): Record<StallId, [number, number]> {
  const placed: { x: number; z: number }[] = [];
  const out = {} as Record<StallId, [number, number]>;
  for (const id of STALL_IDS) {
    search: for (let k = 0; k < 24; k++) {
      const deg = (30 + 15 * k) % 360, a = (deg * Math.PI) / 180;
      for (let r = STALL_RULE.rMin; r <= STALL_RULE.rMax; r++) {
        const x = r * Math.cos(a), z = r * Math.sin(a);
        if (!stallSpotOk(x, z, placed)) continue;
        placed.push({ x, z });
        out[id] = [deg, r];
        break search;
      }
    }
  }
  return out;
}
