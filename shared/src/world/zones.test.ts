import { describe, expect, it } from 'vitest';
import { REASON_GROVE_FULL } from '../messages';
import { SPAWN } from '../constants';
import { bandR, roadZ as groveRoadZ } from './layout';
import { GREENWAY_RECIPE, generateZone } from './recipe';
import { GROVE_EAST_GATE, ZONE_IDS, isZoneId, zoneDef, zoneFullReason, type ZoneId } from './zones';

/** Standable: ground (not a platform) here and 0.4 m around (an adventurer's radius). */
function standable(id: ZoneId, x: number, z: number): boolean {
  const g = zoneDef(id).ground;
  if (g(x, z) === null) return false;
  for (const [dx, dz] of [[0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) if (g(x + dx, z + dz) === null) return false;
  return true;
}

describe('zone registry', () => {
  it('ZONE_IDS and isZoneId', () => {
    expect(ZONE_IDS).toEqual(['grove', 'greenway']);
    expect(isZoneId('grove')).toBe(true); expect(isZoneId('greenway')).toBe(true);
    for (const v of ['', 'Grove', 'beacon', 1, null, undefined, {}, ['grove']]) expect(isZoneId(v)).toBe(false);
  });

  it('zoneDef is built once and cached', () => {
    expect(zoneDef('greenway')).toBe(zoneDef('greenway'));
    expect(zoneDef('grove')).toBe(zoneDef('grove'));
    expect(zoneDef('grove').id).toBe('grove'); expect(zoneDef('greenway').id).toBe('greenway');
  });

  it('GROVE_EAST_GATE is the gate countryside.ts derives (its loop, restated)', () => {
    let gateX = 80; while (Math.hypot(gateX, groveRoadZ(gateX)) < bandR(Math.atan2(groveRoadZ(gateX), gateX)) - 1.5) gateX += 0.5;
    expect(GROVE_EAST_GATE).toEqual({ x: gateX, z: groveRoadZ(gateX) });
  });

  it('the grove has ground 2 m before the gate and none 2 m beyond it', () => {
    const g = zoneDef('grove').ground;
    const { x } = GROVE_EAST_GATE;
    expect(g(x - 2, groveRoadZ(x - 2))).not.toBeNull();
    expect(g(x + 2, groveRoadZ(x + 2))).toBeNull();
  });

  it('grove: town surface, SPAWN, no camps, one closed exit to the Greenway entry', () => {
    const grove = zoneDef('grove');
    expect(grove.spawn).toEqual(SPAWN);
    expect(grove.camps).toEqual([]);
    expect(grove.surface(SPAWN.x, SPAWN.z)).not.toBeNull();
    expect(grove.ground(300, 0)).toBeNull(); // beyond the town
    expect(grove.sight(SPAWN.x, SPAWN.z)).toBe(true);
    expect(grove.exits).toHaveLength(1);
    const e = grove.exits[0];
    expect(e).toMatchObject({ to: 'greenway', x: GROVE_EAST_GATE.x, z: GROVE_EAST_GATE.z, r: 2.5 });
    expect(e.arrive).toEqual(generateZone(GREENWAY_RECIPE).entry);
    expect(e.open).toBe(false);
    expect(grove.banner).toEqual(['The Plaza of the Two', 'Shady Grove']);
  });

  it('greenway: generated, spawns at the entry, every camp spawn listed, one open exit back to the grove', () => {
    const gw = zoneDef('greenway');
    const layout = generateZone(GREENWAY_RECIPE);
    expect(gw.spawn).toEqual(layout.entry);
    expect(gw.camps).toEqual(layout.camps.flatMap(c => c.spawns));
    expect(gw.camps).toHaveLength(21);
    expect(gw.exits).toHaveLength(1);
    const e = gw.exits[0];
    expect(e).toMatchObject({ to: 'grove', x: layout.westGate.x, z: layout.westGate.z, r: 2.5, open: true });
    const ax = GROVE_EAST_GATE.x - 5;
    expect(e.arrive).toEqual({ x: ax, z: groveRoadZ(ax), facing: -Math.PI / 2 });
    expect(gw.banner).toEqual(['The Greenway', 'Beyond the east gate']);
    // sight is blocked by walls, not by platforms
    const wall = layout.rocks.find(r => r.top === null)!, plat = layout.rocks.find(r => r.top !== null)!;
    expect(gw.sight(wall.x, wall.z)).toBe(false);
    expect(gw.sight(plat.x, plat.z)).toBe(true);
    expect(gw.surface(plat.x, plat.z)).toBe(plat.top);
  });

  it('each exit circle contains a standable point', () => {
    for (const id of ZONE_IDS) for (const e of zoneDef(id).exits) {
      let found = false;
      for (let dx = -e.r; dx <= e.r && !found; dx += 0.25) for (let dz = -e.r; dz <= e.r && !found; dz += 0.25) {
        if (dx * dx + dz * dz <= e.r * e.r && standable(id, e.x + dx, e.z + dz)) found = true;
      }
      expect(found, `${id} → ${e.to}`).toBe(true);
    }
  });

  it('each arrive is standable in the destination and outside every exit circle there (no ping-pong)', () => {
    for (const id of ZONE_IDS) for (const e of zoneDef(id).exits) {
      const dest = zoneDef(e.to);
      expect(standable(e.to, e.arrive.x, e.arrive.z), `${id} → ${e.to}`).toBe(true);
      for (const back of dest.exits) {
        const dx = e.arrive.x - back.x, dz = e.arrive.z - back.z;
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan(back.r + 0.5);
      }
    }
  });

  it('zone definitions are deeply frozen (a later "open the gate" cannot change the cached def)', () => {
    for (const id of ZONE_IDS) {
      const d = zoneDef(id);
      for (const o of [d, d.exits, d.exits[0], d.exits[0].arrive, d.spawn, d.banner, d.camps, ...d.camps]) expect(Object.isFrozen(o)).toBe(true);
      expect(() => { (d.exits[0] as { open: boolean }).open = !d.exits[0].open; }).toThrow(TypeError);
      expect(() => { (d.exits as unknown as unknown[]).push({}); }).toThrow(TypeError);
    }
    expect(zoneDef('grove').exits[0].open).toBe(false);
  });

  it('zoneFullReason', () => {
    expect(zoneFullReason('grove')).toBe(REASON_GROVE_FULL);
    expect(zoneFullReason('greenway')).toBe('The Greenway is full, try again soon');
  });

  it("zoneDef('grove').exits[0].open === false", () => {
    expect(zoneDef('grove').exits[0].open).toBe(false);
  });
});
