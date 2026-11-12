// Every zone fits inside what the zone room's state can carry (positions are quantised over wrapping
// ranges, server/src/rooms/state.ts), and the registry and the generator refuse ones that would not.
import { describe, expect, it } from 'vitest';
import { GREENWAY_RECIPE, generateZone } from './recipe';
import { STATE_XZ_LIMIT_M, STATE_Y_MAX_M, STATE_Y_MIN_M, ZONE_LIMIT_MARGIN_M, ZONE_XZ_MAX_M, ZONE_Y_MAX_M, ZONE_Y_MIN_M, checkZoneLimits, insideZoneLimits } from './limits';
import { ZONE_IDS, greenwayLayout, zoneDef } from './zones';

/** How far the scan for walkable ground reaches: past the state's limits, so nothing walkable hides outside. */
const SCAN_M = STATE_XZ_LIMIT_M + 8;
const SCAN_STEP = 2;

describe('zone limits', () => {
  it('leave a margin inside the state\'s quantised ranges', () => {
    expect(ZONE_XZ_MAX_M).toBe(STATE_XZ_LIMIT_M - ZONE_LIMIT_MARGIN_M);
    expect(ZONE_Y_MIN_M).toBeGreaterThan(STATE_Y_MIN_M);
    expect(ZONE_Y_MAX_M).toBeLessThan(STATE_Y_MAX_M);
    expect(insideZoneLimits(ZONE_XZ_MAX_M, -ZONE_XZ_MAX_M, 0)).toBe(true);
    expect(insideZoneLimits(ZONE_XZ_MAX_M + 0.1, 0)).toBe(false);
    expect(insideZoneLimits(0, 0, ZONE_Y_MAX_M + 0.1)).toBe(false);
  });

  for (const id of ZONE_IDS) {
    it(`${id}: spawn, exits, arrivals, camps and every walkable sample (with its height) are inside them`, () => {
      const def = zoneDef(id);
      const points: { what: string; x: number; z: number; y?: number }[] = [
        { what: 'spawn', ...def.spawn },
        ...def.exits.flatMap((e) => [{ what: 'exit', x: e.x, z: e.z }, { what: 'arrival', ...e.arrive }]),
        ...def.camps.map((c) => ({ what: 'camp spawn', x: c.x, z: c.z })),
      ];
      for (const p of points) expect(insideZoneLimits(p.x, p.z, p.y), `${p.what} (${p.x}, ${p.z})`).toBe(true);
      let lo = Infinity, hi = -Infinity, walkable = 0;
      for (let x = -SCAN_M; x <= SCAN_M; x += SCAN_STEP) {
        for (let z = -SCAN_M; z <= SCAN_M; z += SCAN_STEP) {
          const y = def.surface(x, z);
          if (y === null) continue;
          walkable++;
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
          if (!insideZoneLimits(x, z, y)) expect.fail(`walkable (${x}, ${z}) at height ${y} is outside the zone limits`);
        }
      }
      expect(walkable).toBeGreaterThan(1000);
      expect(lo).toBeGreaterThanOrEqual(ZONE_Y_MIN_M);
      expect(hi).toBeLessThanOrEqual(ZONE_Y_MAX_M);
    });
  }

  it('the Greenway generator\'s extents (x 0..width, z ±depth/2) are inside them', () => {
    const { width, depth } = greenwayLayout().recipe;
    for (const [x, z] of [[0, -depth / 2], [width, depth / 2]]) expect(insideZoneLimits(x, z)).toBe(true);
  });

  it('the generator refuses a recipe that would not fit (too wide, too deep, too hilly)', () => {
    expect(() => generateZone({ ...GREENWAY_RECIPE, width: ZONE_XZ_MAX_M + 1 })).toThrow(/zone limits/);
    expect(() => generateZone({ ...GREENWAY_RECIPE, depth: 2 * ZONE_XZ_MAX_M + 2 })).toThrow(/zone limits/);
    expect(() => generateZone({ ...GREENWAY_RECIPE, hills: ZONE_Y_MAX_M })).toThrow(/zone limits/);
  });

  it('the registry\'s check refuses a zone whose spawn, exit or arrival is outside them', () => {
    const def = zoneDef('greenway');
    expect(() => checkZoneLimits(def)).not.toThrow();
    expect(() => checkZoneLimits({ ...def, spawn: { x: 600, z: 0 } })).toThrow(/spawn/);
    expect(() => checkZoneLimits({ ...def, exits: [{ ...def.exits[0], arrive: { x: 0, z: -900 } }] })).toThrow(/arrival/);
  });
});
