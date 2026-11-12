// (Line comments only: the generator source scan forbids a double star.)
// How big a zone may be: the zone room's state carries positions quantised on the wire
// (server/src/rooms/state.ts): x and z in [-STATE_XZ_LIMIT_M, STATE_XZ_LIMIT_M), feet heights in
// [STATE_Y_MIN_M, STATE_Y_MAX_M). The ranges wrap, so anything outside them would silently come back
// somewhere else. Every zone (hand-made or generated, Plan 7 included) must fit inside them with
// ZONE_LIMIT_MARGIN_M to spare; the registry and the generator throw for one that would not.

export const STATE_XZ_LIMIT_M = 512;
export const STATE_Y_MIN_M = -64;
export const STATE_Y_MAX_M = 192;
// Room a zone leaves inside the state's limits (jumps, knockbacks, displacement paths).
export const ZONE_LIMIT_MARGIN_M = 12;
// A zone's walkable ground, spawn, exits and arrival points stay within ±ZONE_XZ_MAX_M in x and z.
export const ZONE_XZ_MAX_M = STATE_XZ_LIMIT_M - ZONE_LIMIT_MARGIN_M;
// ...and its ground heights within [ZONE_Y_MIN_M, ZONE_Y_MAX_M].
export const ZONE_Y_MIN_M = STATE_Y_MIN_M + ZONE_LIMIT_MARGIN_M;
export const ZONE_Y_MAX_M = STATE_Y_MAX_M - ZONE_LIMIT_MARGIN_M;

// Whether a ground point (and its height, when given) is inside the zone limits.
export function insideZoneLimits(x: number, z: number, y?: number): boolean {
  const xz = Math.abs(x) <= ZONE_XZ_MAX_M && Math.abs(z) <= ZONE_XZ_MAX_M;
  return xz && (y === undefined || (y >= ZONE_Y_MIN_M && y <= ZONE_Y_MAX_M));
}

// Throws unless the point is inside the zone limits; `what` names it in the error.
export function assertInsideZoneLimits(what: string, x: number, z: number, y?: number): void {
  if (!insideZoneLimits(x, z, y)) {
    const at = y === undefined ? `(${x}, ${z})` : `(${x}, ${z}) at height ${y}`;
    throw new Error(`${what} ${at} is outside the zone limits (±${ZONE_XZ_MAX_M} m, heights ${ZONE_Y_MIN_M}..${ZONE_Y_MAX_M} m)`);
  }
}

// What checkZoneLimits reads of a zone (a ZoneDef).
export interface ZonePoints {
  readonly spawn: { readonly x: number; readonly z: number };
  readonly exits: readonly { readonly x: number; readonly z: number; readonly arrive: { readonly x: number; readonly z: number } }[];
  readonly camps: readonly { readonly x: number; readonly z: number }[];
}

// Throws unless the zone's spawn, exits, arrival points and camp spawns are inside the zone limits (the registry runs it).
export function checkZoneLimits(zone: ZonePoints): void {
  assertInsideZoneLimits('The spawn', zone.spawn.x, zone.spawn.z);
  for (const e of zone.exits) {
    assertInsideZoneLimits('An exit', e.x, e.z);
    assertInsideZoneLimits('An arrival point', e.arrive.x, e.arrive.z);
  }
  for (const c of zone.camps) assertInsideZoneLimits('A camp spawn', c.x, c.z);
}
