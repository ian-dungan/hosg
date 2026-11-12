import { describe, expect, it } from 'vitest';
import { REASON_GROVE_FULL } from '../messages';
import { SPAWN } from '../constants';
import { bandR, roadZ as groveRoadZ } from './layout';
import { GREENWAY_RECIPE, generateZone, prng } from './recipe';
import { GROVE_OBSTACLES } from './obstacles';
import { GROVE_EAST_GATE, GUILD_BOARD, REASON_JOB_NOT_HERE, ZONE_IDS, isZoneId, jobSwitchAt, zoneDef, zoneFullReason, type ZoneId } from './zones';
import { PLAZA_R, type Obstacle } from './layout';

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

  it('grove: town surface, SPAWN, no camps, one open exit to the Greenway entry', () => {
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
    expect(e.open).toBe(true);
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
      for (const o of [d, d.exits, d.exits[0], d.exits[0].arrive, d.spawn, d.banner, d.camps, ...d.camps, d.sanctuaries]) expect(Object.isFrozen(o)).toBe(true);
      expect(() => { (d.exits[0] as { open: boolean }).open = !d.exits[0].open; }).toThrow(TypeError);
      expect(() => { (d.exits as unknown as unknown[]).push({}); }).toThrow(TypeError);
    }
    expect(zoneDef('grove').exits[0].open).toBe(true);
  });

  it('zoneFullReason', () => {
    expect(zoneFullReason('grove')).toBe(REASON_GROVE_FULL);
    expect(zoneFullReason('greenway')).toBe('The Greenway is full, try again soon');
  });

  it("zoneDef('grove').exits[0].open === true (the east gate is open)", () => {
    expect(zoneDef('grove').exits[0].open).toBe(true);
  });

  it('the grove is a town everywhere; the Greenway is not, anywhere', () => {
    expect(zoneDef('grove')).toMatchObject({ town: true, sanctuaries: [] });
    expect(zoneDef('greenway')).toMatchObject({ town: false, sanctuaries: [] });
    for (const id of ZONE_IDS) {
      const d = zoneDef(id);
      const rng = prng(id === 'grove' ? 501 : 502);
      let found = 0;
      for (let tries = 0; found < 500 && tries < 200_000; tries++) {
        const x = (rng() * 2 - 1) * 400, z = (rng() * 2 - 1) * 400;
        if (d.surface(x, z) === null) continue;
        found++;
        expect(d.jobSwitch(x, z), `${id} (${x}, ${z})`).toBe(id === 'grove');
      }
      expect(found).toBe(500);
      if (id === 'grove') expect(d.jobSwitch(SPAWN.x, SPAWN.z)).toBe(true);
      else expect(d.jobSwitch(d.spawn.x, d.spawn.z)).toBe(false);
    }
  });

  it('a sanctuary circle allows job changes inside and not 0.1 m outside', () => {
    const def = { town: false, sanctuaries: [{ x: 10, z: -4, r: 6, name: 'Test Camp' }] };
    expect(jobSwitchAt(def, 10, -4)).toBe(true);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      expect(jobSwitchAt(def, 10 + dx * 5.9, -4 + dz * 5.9)).toBe(true);
      expect(jobSwitchAt(def, 10 + dx * 6.1, -4 + dz * 6.1)).toBe(false);
    }
    expect(jobSwitchAt({ town: false, sanctuaries: [] }, 10, -4)).toBe(false);
    expect(jobSwitchAt({ town: true, sanctuaries: [] }, 1e4, 1e4)).toBe(true);
    // Two circles: inside either one is enough.
    const two = { town: false, sanctuaries: [...def.sanctuaries, { x: -30, z: 0, r: 2, name: 'Another' }] };
    expect(jobSwitchAt(two, -30, 1.9)).toBe(true);
    expect(jobSwitchAt(two, -30, 2.1)).toBe(false);
    expect(REASON_JOB_NOT_HERE).toBe('Jobs can be changed only in a town or a sanctuary');
  });

  it('GUILD_BOARD stands on the plaza, near the spawn, clear of obstacles', () => {
    const { x, z, facing } = GUILD_BOARD;
    expect(zoneDef('grove').surface(x, z)).not.toBeNull();
    expect(zoneDef('grove').ground(x, z)).not.toBeNull();
    const fromSpawn = Math.hypot(x - SPAWN.x, z - SPAWN.z);
    expect(fromSpawn).toBeGreaterThanOrEqual(2);
    expect(fromSpawn).toBeLessThanOrEqual(6);
    expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(3); // the statue stands at the plaza's centre
    expect(Math.hypot(x, z)).toBeLessThanOrEqual(PLAZA_R);
    for (const o of GROVE_OBSTACLES) expect(clearance(o, x, z), JSON.stringify(o)).toBeGreaterThanOrEqual(0.5);
    // Facing the spawn (facing is atan2(dx, dz), as everywhere).
    const toSpawn = Math.atan2(SPAWN.x - x, SPAWN.z - z);
    expect(Math.abs(Math.atan2(Math.sin(facing - toSpawn), Math.cos(facing - toSpawn)))).toBeLessThan(1e-9);
    expect(Object.isFrozen(GUILD_BOARD)).toBe(true);
  });
});

/** How far (x, z) is from the obstacle's edge (negative inside). */
function clearance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === 'c') return Math.hypot(dx, dz) - o.r;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hw, lz = Math.abs(dx * o.s + dz * o.c) - o.hd;
  return lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}
