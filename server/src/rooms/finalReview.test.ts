// Plan 3 final review (server): elite stagger bars past one byte and kept up to date, maps that stay
// bounded, a death save never raced into a kick, a knock in a long fall charging the whole fall, and a
// held dodge a knock replaces being refused rather than dropped.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { SPAWN, TICK_HZ, fallDamage, worldOf, type CampSpawn, type Surface, type ZoneDef, type ZoneId } from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { accountFor, collect, joinZone, saveAs, serverRoom, sleep, startServer, testClock, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatZone = (camps: CampSpawn[]): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const MOSSBACK: CampSpawn = { kind: 'mossback', x: 0, z: -20, facing: 0 };
const THORNLING: CampSpawn = { kind: 'thornling', x: 0, z: -20, facing: 0 };
const pose = (x: number, z: number, ack = 0) => ({ x, z, y: 0, facing: 0, moving: false, ack });
const enemyOf = (room: Room<any, any>, kind: string) => [...room.state.enemies.values()].find((e: any) => e.kind === kind);
const sessionOf = (room: Room<any, any>) => (serverRoom(room) as any).sessions.get(room.sessionId);

async function joinAt(url: string, store: Store, name: string, x: number, z: number, more: Parameters<typeof saveAs>[2] = {}, zone: ZoneId = 'grove') {
  const account = await accountFor(store, name);
  await saveAs(store, account.accountId, { x, z, facing: 0, zone, ...more });
  return { ...(await joinZone(url, account.token, zone)), ...account };
}

describe('elite stagger bar with more than one adventurer (I1)', () => {
  it('four adventurers on a Mossback: maxStagger 310 and maxHp 2325 reach the state, and stagger is not clamped to a byte', async () => {
    // The combat clock stands still and the room is stepped by hand (one tick a step): the fight plays
    // out the same however busy the machine is.
    const clock = testClock(0);
    server = await startServer({ combatSeed: 7, combatClock: clock.now, zones: { grove: flatZone([MOSSBACK]) } });
    const { url, store } = server;
    const joined: Awaited<ReturnType<typeof joinAt>>[] = [];
    for (const [i, [x, z]] of [[0, -17.6], [2.4, -20], [-2.4, -20], [0, -22.4]].entries()) joined.push(await joinAt(url, store, `A${i}`, x, z));
    const room = joined[0].room;
    const zr = serverRoom(room) as any;
    zr.setSimulationInterval(undefined);
    const moss = await waitFor(() => enemyOf(room, 'mossback'));
    expect(moss).toMatchObject({ maxHp: 750, maxStagger: 100 });
    for (const j of joined) j.room.send('target', { id: moss.eid }); // in reach: their autos put them all on its threat table
    await waitFor(() => joined.every((j) => j.room.state.players.get(j.room.sessionId)?.target === moss.eid));
    const engine = [...worldOf(zr.combat).enemies.values()].find((x) => x.kind === 'mossback')!;
    for (let k = 0; k < 10 * TICK_HZ && Math.round(engine.stagger.max) !== 310; k++) {
      clock.skip(1 / TICK_HZ);
      zr.step();
    }
    expect(Math.round(engine.stagger.max)).toBe(310);
    await waitFor(() => enemyOf(room, 'mossback')?.maxStagger === 310, 3000);
    expect(enemyOf(room, 'mossback').maxHp).toBe(2325);
    // a stagger value past 255 is shown as it is
    const e = zr.state.enemies.get(String(moss.eid));
    e.stagger = 300;
    expect(e.stagger).toBe(300);
  });
});

describe('room maps stay bounded (I2)', () => {
  it('many telegraphs and adventurers come and go: the key and targeting maps hold only what is live', async () => {
    const clock = testClock(6);
    server = await startServer({ combatSeed: 7, combatClock: clock.now, zones: { grove: flatZone([THORNLING]) } });
    const { url, store } = server;
    let telegraphs = 0;
    for (let i = 0; i < 4; i++) {
      const a = await joinAt(url, store, `T${i}`, 0, -16);
      const zr = serverRoom(a.room) as any;
      const seen = new Set<number>();
      await waitFor(() => enemyOf(a.room, 'thornling')); // it comes for the adventurer by itself (no autos back: it lives)
      await waitFor(() => {
        a.room.state.telegraphs.forEach((t: any) => seen.add(t.id));
        return seen.size >= 2 || a.room.state.players.get(a.room.sessionId)?.dead;
      }, 6000);
      telegraphs += seen.size;
      const room = zr;
      await a.room.leave();
      await waitFor(() => room.state.players.size === 0);
      // a few steps with nobody there (counted, not slept: a busy machine may step late)
      let steps = 0;
      const step = room.step;
      room.step = (...args: unknown[]) => { steps++; return step.apply(room, args); };
      await waitFor(() => steps >= 3, 5000);
      room.step = step;
      const live = room.state.enemies.size + room.state.telegraphs.size;
      expect(room.keys?.size ?? 0).toBeLessThanOrEqual(live);
      expect(room.targeting.size).toBe(0);
    }
    expect(telegraphs).toBeGreaterThanOrEqual(4);
  }, 30_000);
});

describe('a death in the Greenway and the periodic save (M1)', () => {
  it('a saveAll while the death save is still being written does not kick the dead adventurer', async () => {
    const base = createMemoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store: Store = Object.assign(Object.create(base), {
      saveAdventurer: async (a: any, expect?: any) => {
        if (a.hp === 100) await gate; // the save as respawned (dead: at the statue, full health)
        return base.saveAdventurer(a, expect);
      },
    });
    const clock = testClock(10);
    server = await startServer({ combatSeed: 7, store, combatClock: clock.now, zones: { greenway: flatZone([THORNLING]) } });
    const a = await joinAt(server.url, store, 'Alice', 0, -18, { hp: 5 }, 'greenway');
    const kicked = collect(a.room, 'kicked');
    await waitFor(() => a.room.state.players.get(a.room.sessionId).dead, 6000);
    const zr = serverRoom(a.room) as any;
    const saving = zr.saveAll();
    await sleep(20);
    release();
    await saving;
    await sleep(100);
    expect(kicked).toEqual([]);
    expect(zr.sessions.get(a.room.sessionId)).toBeDefined();
    expect(await base.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', hp: 100 });
  });
});

describe('a knock during a long fall (M2)', () => {
  it('charges the fall down to where the push really starts (the start is clamped to 2 m over the ground)', async () => {
    server = await startServer({ combatSeed: 7, zones: { grove: flatZone([]) } });
    const a = await joinAt(server.url, server.store, 'Alice', SPAWN.x, SPAWN.z);
    const hurts = collect(a.room, 'hurt');
    const room = serverRoom(a.room) as any;
    const session = sessionOf(a.room);
    // falling from 10 m, at 8 m when knocked: the push starts at 2 m (the clamp), so 8 m of the fall is behind it
    session.movement.air = { grounded: false, airStartMs: 0, airStartY: 10, peakY: 10, y: 8 };
    const from = { x: SPAWN.x, z: SPAWN.z, y: 8 };
    const start = { x: SPAWN.x, z: SPAWN.z, y: 2 };
    const at = { x: SPAWN.x + 1, z: SPAWN.z, y: 0 };
    room.displace(session, {
      id: session.eid, kind: 'knock', from, d: { vx: 3, vz: 0, vy: 0, seconds: 0.3 },
      result: { ...at, drop: 2, drops: [2], fallHp: fallDamage(2), seconds: 0.6, grounded: true, path: [{ t: 0, ...start }, { t: 0.6, ...at }] },
    });
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(8) + fallDamage(2), cause: 'fall' }]);
  });
});

describe('a held dodge and a knock (M3)', () => {
  it('a dodge held for its gap that a knock replaces is refused as busy', async () => {
    const clock = testClock(0);
    server = await startServer({ combatSeed: 7, combatClock: clock.now, zones: { grove: flatZone([]) } });
    const a = await joinAt(server.url, server.store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    const refused = collect(a.room, 'refused');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length === 1);
    const end = displaced[0].to;
    clock.skip(0.3);
    a.room.send('dodge', { ...pose(end.x, end.z, 1), dx: 0, dz: 1 });
    const session = sessionOf(a.room);
    await waitFor(() => session.pendingDodge !== undefined);
    const room = serverRoom(a.room) as any;
    const to = { x: end.x + 1, z: end.z, y: 0 };
    room.displace(session, {
      id: session.eid, kind: 'knock', from: { ...end }, d: { vx: 3, vz: 0, vy: 0, seconds: 0.3 },
      result: { ...to, drop: 0, drops: [], fallHp: 0, seconds: 0.3, grounded: true, path: [{ t: 0, ...end }, { t: 0.3, ...to }] },
    });
    await waitFor(() => refused.length === 1);
    expect(refused).toEqual([{ action: 'dodge', reason: 'busy' }]);
    await waitFor(() => displaced.length === 2);
    expect(displaced[1]).toMatchObject({ kind: 'knock', seq: 2 });
  });
});
