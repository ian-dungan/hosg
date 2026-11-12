// The zone registry: every zone room's walkability, spawn point, enemy camps and exits.
// Built lazily and cached, so importing this costs nothing until a zone is asked for.
import { SPAWN } from '../constants';
import { REASON_GROVE_FULL } from '../messages';
import type { Surface } from '../body';
import { bandR, createGroveWalk, groveTownSurface, roadZ as groveRoadZ } from './layout';
import { GREENWAY_RECIPE, generateZone, type CampSpawn } from './recipe';
import { checkZoneLimits } from './limits';

/**
 * What the combat engine needs from a zone (same shape as combat/engine.ts's CombatZone, Task 2;
 * restated so the world registry does not depend on the combat package).
 */
export interface CombatZone { readonly surface: Surface; readonly ground: Surface; readonly sight: (x: number, z: number) => boolean; readonly camps: readonly CampSpawn[] }

export type ZoneId = 'grove' | 'greenway';
export const ZONE_IDS: readonly ZoneId[] = ['grove', 'greenway'];
export function isZoneId(v: unknown): v is ZoneId { return typeof v === 'string' && (ZONE_IDS as readonly string[]).includes(v); }

/** Walking into the circle (x, z, r) takes an adventurer to zone `to`, standing at `arrive`. Closed exits do nothing. */
export interface ZoneExit {
  readonly to: ZoneId; readonly x: number; readonly z: number; readonly r: number;
  readonly arrive: { readonly x: number; readonly z: number; readonly facing: number };
  /** Whether the exit works by default. Defs are frozen: a gate opened at run time lives in server state, not here. */
  readonly open: boolean;
}
/** Deeply frozen and shared by every caller (zoneDef caches it). */
export interface ZoneDef extends CombatZone {
  readonly id: ZoneId; readonly name: string; readonly banner: readonly [string, string];
  readonly spawn: { readonly x: number; readonly z: number; readonly facing: number };
  readonly exits: readonly ZoneExit[];
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

function buildGreenway(): ZoneDef {
  const layout = greenwayLayout();
  const surface: Surface = (x, z) => layout.walk.surfaceAt(x, z);
  const ax = GROVE_EAST_GATE.x - GROVE_ARRIVE_BACK;
  return {
    id: 'greenway', name: 'The Greenway', banner: ['The Greenway', 'Beyond the east gate'],
    surface, ground: (x, z) => layout.walk.groundAt(x, z), sight: (x, z) => surface(x, z) !== null,
    camps: layout.camps.flatMap(c => c.spawns.map(sp => ({ ...sp }))), // copies: freezing the def leaves the layout alone
    spawn: { ...layout.entry },
    exits: [{ to: 'grove', x: layout.westGate.x, z: layout.westGate.z, r: EXIT_R, arrive: { x: ax, z: groveRoadZ(ax), facing: -Math.PI / 2 }, open: true }],
  };
}

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
    const built = id === 'grove' ? buildGrove() : buildGreenway();
    checkZoneLimits(built); // throws for a zone the room's state could not carry
    d = deepFreeze(built);
    defs.set(id, d);
  }
  return d;
}

/** The text a join is refused with when the zone's room is full. */
export function zoneFullReason(id: ZoneId): string {
  return id === 'grove' ? REASON_GROVE_FULL : 'The Greenway is full, try again soon';
}
