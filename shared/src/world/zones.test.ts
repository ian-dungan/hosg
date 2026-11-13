import { describe, expect, it } from 'vitest';
import { REASON_GROVE_FULL } from '../messages';
import { SPAWN } from '../constants';
import { bandR, roadZ as groveRoadZ } from './layout';
import { GREENWAY_RECIPE, generateZone, prng } from './recipe';
import { GROVE_OBSTACLES } from './obstacles';
import { GROVE_EAST_GATE, GUILD_BOARD, LAMPFALL_MOUTH, STALL_IDS, STALL_REACH, TOWN_STALLS, searchStallSpots, segmentDistance, stallAt, REASON_JOB_NOT_HERE, SAVE_ZONE_IDS, ZONE_IDS, isSaveZoneId, isZoneId, jobSwitchAt, zoneDef, zoneFullReason, type ZoneId } from './zones';
import { lampfallLayout } from './dungeon';
import { REASON_INSTANCES_FULL } from '../instance';
import { checkZoneLimits } from './limits';
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
    expect(ZONE_IDS).toEqual(['grove', 'greenway', 'lampfall']);
    expect(isZoneId('grove')).toBe(true); expect(isZoneId('greenway')).toBe(true); expect(isZoneId('lampfall')).toBe(true);
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

  it('greenway: generated, spawns at the entry, every camp spawn listed, an open exit back to the grove and the crater mouth', () => {
    const gw = zoneDef('greenway');
    const layout = generateZone(GREENWAY_RECIPE);
    expect(gw.spawn).toEqual(layout.entry);
    expect(gw.camps).toEqual(layout.camps.flatMap(c => c.spawns));
    expect(gw.camps).toHaveLength(21);
    expect(gw.exits).toHaveLength(2);
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
    expect(zoneFullReason('lampfall')).toBe(REASON_INSTANCES_FULL);
  });

  it('lampfall is instanced, not a town, with sanctuaries at the rim and the landing only', () => {
    const lf = zoneDef('lampfall'), layout = lampfallLayout();
    expect(lf).toMatchObject({ id: 'lampfall', name: 'The Lampfall', banner: ['The Lampfall', 'Where the Warden fell'], town: false, instanced: true });
    for (const id of SAVE_ZONE_IDS) expect(zoneDef(id).instanced).toBe(false);
    const rim = layout.rooms.find(r => r.id === 'rim')!, landing = layout.rooms.find(r => r.id === 'landing')!;
    expect(lf.sanctuaries).toEqual([
      { x: rim.x, z: rim.z, r: 6, name: 'Crater Rim' }, { x: landing.x, z: landing.z, r: 6, name: "Keeper's Landing" },
    ]);
    expect(lf.spawn).toEqual({ x: rim.x, z: rim.z, facing: rim.entryDir });
    expect(lf.jobSwitch(rim.x, rim.z)).toBe(true); expect(lf.jobSwitch(landing.x + 5.9, landing.z)).toBe(true);
    for (const r of layout.rooms) if (!r.sanctuary) expect(lf.jobSwitch(r.x, r.z), r.id).toBe(false);
    // the camps are every room's spawns; surface, ground and sight are the dungeon's
    expect(lf.camps).toEqual(layout.rooms.flatMap(r => r.spawns));
    expect(lf.camps).toHaveLength(12);
    const pillar = layout.pillars[0], rubble = layout.rubble[0];
    expect(lf.surface(pillar.x, pillar.z)).toBeNull(); expect(lf.sight(pillar.x, pillar.z)).toBe(false);
    expect(lf.surface(rubble.x, rubble.z)).toBe(rubble.top); expect(lf.ground(rubble.x, rubble.z)).toBeNull(); expect(lf.sight(rubble.x, rubble.z)).toBe(true);
    expect(lf.surface(0, 0)).toBeNull(); // off the floor
    // exits: the rim's stair (open) and the lamp-lift (shut until the Warden falls), both to the mouth
    expect(lf.exits).toEqual([
      { to: 'greenway', ...layout.exitStair, arrive: { ...LAMPFALL_MOUTH.arrive }, open: true },
      { to: 'greenway', ...layout.lampLift, arrive: { ...LAMPFALL_MOUTH.arrive }, open: false },
    ]);
    expect(() => checkZoneLimits(lf)).not.toThrow();
  });

  it('SAVE_ZONE_IDS excludes lampfall', () => {
    expect(SAVE_ZONE_IDS).toEqual(['grove', 'greenway']);
    expect(isSaveZoneId('grove')).toBe(true); expect(isSaveZoneId('greenway')).toBe(true);
    for (const v of ['lampfall', '', 'Grove', 1, null, undefined, {}, ['greenway']]) expect(isSaveZoneId(v)).toBe(false);
  });

  it('the Greenway has the mouth exit, clear of trees and rocks within 10 m and of camps within 20 m', () => {
    const gw = zoneDef('greenway'), layout = generateZone(GREENWAY_RECIPE);
    const e = gw.exits.find(x => x.to === 'lampfall')!;
    expect(e).toEqual({ to: 'lampfall', x: layout.mouth.x, z: layout.mouth.z, r: 2.5, arrive: zoneDef('lampfall').spawn, open: true, instance: true });
    expect(e.x).toBe(236); expect(e.z).toBe(layout.roadZ(236));
    expect(LAMPFALL_MOUTH).toMatchObject({ x: e.x, z: e.z, r: 2.5 });
    for (const o of layout.obstacles) expect(Math.hypot(o.x - e.x, o.z - e.z) - (o as { r: number }).r).toBeGreaterThanOrEqual(10);
    for (const c of layout.camps) expect(Math.hypot(c.x - e.x, c.z - e.z)).toBeGreaterThanOrEqual(20);
    expect(gw.exits.filter(x => x.instance)).toEqual([e]);
  });

  it('LAMPFALL_MOUTH.arrive stands on the Greenway surface', () => {
    const { arrive } = LAMPFALL_MOUTH;
    const layout = generateZone(GREENWAY_RECIPE);
    expect(arrive).toEqual({ x: LAMPFALL_MOUTH.x - 5, z: layout.roadZ(LAMPFALL_MOUTH.x - 5), facing: Math.PI / 2 });
    expect(zoneDef('greenway').surface(arrive.x, arrive.z)).not.toBeNull();
    expect(standable('greenway', arrive.x, arrive.z)).toBe(true);
    expect(Math.hypot(arrive.x - LAMPFALL_MOUTH.x, arrive.z - LAMPFALL_MOUTH.z)).toBeGreaterThan(LAMPFALL_MOUTH.r + 0.5);
    expect(Object.isFrozen(LAMPFALL_MOUTH)).toBe(true); expect(Object.isFrozen(arrive)).toBe(true);
  });

  it("zoneDef('grove').exits[0].open === true (the east gate is open)", () => {
    expect(zoneDef('grove').exits[0].open).toBe(true);
  });

  it('the grove is a town everywhere; the Greenway is not, anywhere', () => {
    expect(zoneDef('grove')).toMatchObject({ town: true, sanctuaries: [] });
    expect(zoneDef('greenway')).toMatchObject({ town: false, sanctuaries: [] });
    for (const id of SAVE_ZONE_IDS) {
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

describe('town stalls', () => {
  it('TOWN_STALLS stand on grove ground 12–20 m from the statue, 4 m clear of each other, the Guild Board and obstacles, off the walking lines to the exits', () => {
    expect(Object.keys(TOWN_STALLS)).toEqual(['smithy', 'tailor', 'barber', 'lampwright', 'vault']);
    const spots = searchStallSpots();
    for (const id of STALL_IDS) {
      const s = TOWN_STALLS[id];
      const [deg, r] = spots[id];
      expect(s.x, id).toBeCloseTo(r * Math.cos((deg * Math.PI) / 180), 9);
      expect(s.z, id).toBeCloseTo(r * Math.sin((deg * Math.PI) / 180), 9);
      const d = Math.hypot(s.x, s.z);
      expect(d).toBeGreaterThanOrEqual(12); expect(d).toBeLessThanOrEqual(20);
      expect(standable('grove', s.x, s.z)).toBe(true);
      for (const o of GROVE_OBSTACLES) expect(clearance(o, s.x, s.z), `${id} ${JSON.stringify(o)}`).toBeGreaterThanOrEqual(4);
      expect(Math.hypot(s.x - GUILD_BOARD.x, s.z - GUILD_BOARD.z)).toBeGreaterThanOrEqual(4);
      for (const e of zoneDef('grove').exits) expect(segmentDistance(s.x, s.z, SPAWN.x, SPAWN.z, e.x, e.z)).toBeGreaterThanOrEqual(3);
      for (const other of STALL_IDS) if (other !== id) expect(Math.hypot(s.x - TOWN_STALLS[other].x, s.z - TOWN_STALLS[other].z)).toBeGreaterThanOrEqual(4);
      // facing the statue
      const toStatue = Math.atan2(-s.x, -s.z);
      expect(Math.abs(Math.atan2(Math.sin(s.facing - toStatue), Math.cos(s.facing - toStatue)))).toBeLessThan(1e-9);
      expect(s.name.length).toBeGreaterThan(3); expect(s.keeper.length).toBeGreaterThan(3);
    }
    expect(TOWN_STALLS.smithy).toMatchObject({ name: 'Kettleworth Smithy', keeper: 'Hob Kettleworth' });
    expect(TOWN_STALLS.vault).toMatchObject({ name: 'The Grove Vault', keeper: 'Clerk Amsel' });
    expect(Object.isFrozen(TOWN_STALLS.barber)).toBe(true);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    expect({ spots, at: Object.fromEntries(STALL_IDS.map(id => [id, { x: round(TOWN_STALLS[id].x), z: round(TOWN_STALLS[id].z), facing: round(TOWN_STALLS[id].facing) }])) }).toMatchSnapshot();
  });

  it('stallAt finds a stall within STALL_REACH in the grove only', () => {
    expect(STALL_REACH).toBe(3.5);
    for (const id of STALL_IDS) {
      const { x, z } = TOWN_STALLS[id];
      expect(stallAt('grove', x, z)).toBe(id);
      expect(stallAt('grove', x + 0.5, z + 0.5)).toBe(id);
      expect(stallAt('greenway', x, z)).toBeNull();
      expect(stallAt('lampfall', x, z)).toBeNull();
    }
    expect(stallAt('grove', TOWN_STALLS.smithy.x + 3.6, TOWN_STALLS.smithy.z)).toBeNull();
    expect(stallAt('grove', SPAWN.x, SPAWN.z)).toBeNull();
    expect(stallAt('grove', NaN, 0)).toBeNull();
    // between the Tailor and the Barber (the closest pair, about 4.4 m apart), the nearer one answers
    const b = TOWN_STALLS.barber, l = TOWN_STALLS.tailor;
    expect(Math.hypot(b.x - l.x, b.z - l.z)).toBeLessThan(2 * STALL_REACH);
    expect(stallAt('grove', b.x + (l.x - b.x) * 0.4, b.z + (l.z - b.z) * 0.4)).toBe('barber');
    expect(stallAt('grove', b.x + (l.x - b.x) * 0.6, b.z + (l.z - b.z) * 0.6)).toBe('tailor');
  });
  it('no two stalls stand on one line from the statue (neither hides the other)', () => {
    for (const a of STALL_IDS) for (const c of STALL_IDS) {
      if (a >= c) continue;
      const d = Math.atan2(TOWN_STALLS[a].z, TOWN_STALLS[a].x) - Math.atan2(TOWN_STALLS[c].z, TOWN_STALLS[c].x);
      expect(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) * 180 / Math.PI, `${a} ${c}`).toBeGreaterThanOrEqual(12);
    }
  });
});

/** How far (x, z) is from the obstacle's edge (negative inside). */
function clearance(o: Obstacle, x: number, z: number): number {
  const dx = x - o.x, dz = z - o.z;
  if (o.kind === 'c') return Math.hypot(dx, dz) - o.r;
  const lx = Math.abs(dx * o.c - dz * o.s) - o.hw, lz = Math.abs(dx * o.s + dz * o.c) - o.hd;
  return lx <= 0 && lz <= 0 ? Math.max(lx, lz) : Math.hypot(Math.max(lx, 0), Math.max(lz, 0));
}
