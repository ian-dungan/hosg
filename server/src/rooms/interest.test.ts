// Interest management: each client's state holds itself, and only the adventurers, enemies and
// telegraphs near it (INTEREST_RADIUS, leaving only beyond INTEREST_RADIUS + INTEREST_HYSTERESIS);
// the zone's true head count is the `online` field; chat stays zone-wide; positions arrive as plain
// numbers (quantised on the wire, within 2 cm).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/sdk';
import { CLIENT_RECONNECTION, INTEREST_HYSTERESIS, INTEREST_MAX_ADVENTURERS, INTEREST_RADIUS, INTEREST_RANK_HYSTERESIS, STATE_XZ_LIMIT_M, SPAWN, TICK_HZ, worldOf, type CampSpawn, type Surface, type ZoneDef } from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import type { Store } from '../store/types';
import { Grid, LEAVE_R, interested, telegraphInterested } from './interest';
import { accountFor, collect, joinZone, saveAs, serverRoom, sleep, startServer, sx, testClock, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(opts?: Parameters<typeof startServer>[0]): Promise<TestServer> {
  server = await startServer({ combatSeed: 7, ...opts });
  return server;
}

/** Flat open ground everywhere within 200 m, all in sight. */
const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatGrove = (camps: CampSpawn[] = []): { zones: { grove: Partial<ZoneDef> } } => ({ zones: { grove: { surface: flat, ground: flat, sight: () => true, camps } } });

const players = (room: Room<any, any>) => room.state.players;
type Joined = { room: Room<any, any> };
const sees = (a: Joined, b: Joined) => players(a.room)?.has(b.room.sessionId) === true;

async function joinAt(url: string, store: Store, name: string, x: number, z: number) {
  const account = await accountFor(store, name);
  await saveAs(store, account.accountId, { x, z, facing: 0, zone: 'grove' });
  const joined = await joinZone(url, account.token, 'grove');
  return { ...joined, ...account };
}

/** Stops the room's engine from ticking (its state stays as set), so a test can pin targets by hand. */
function freezeEngine(room: Room<any, any>) {
  const server = serverRoom(room) as any;
  server.combat.tick = () => ({ fx: [], displaced: [], died: [], kills: [] });
  return worldOf(server.combat);
}
const enemyIds = (room: Room<any, any>) => [...(room.state.enemies?.values() ?? [])].map((e: any) => e.eid);

/** A few patches' time: long enough for the room to have stepped and patched twice. */
const patches = () => sleep(4 * (1000 / TICK_HZ));

describe('the interest rule', () => {
  it('enters at the radius and leaves only beyond the hysteresis band', () => {
    const r = INTEREST_RADIUS, h = INTEREST_HYSTERESIS;
    expect(interested(r * r, false)).toBe(true);
    expect(interested((r + 0.1) ** 2, false)).toBe(false);
    expect(interested((r + h - 0.1) ** 2, true)).toBe(true);
    expect(interested((r + h + 0.1) ** 2, true)).toBe(false);
  });

  it('a telegraph is seen when any part of it reaches within the radius', () => {
    const viewer = { x: 0, z: 0 };
    expect(telegraphInterested(viewer, { x: INTEREST_RADIUS + 2.9, z: 0, shape: 'circle', r: 3, width: 0 })).toBe(true);
    expect(telegraphInterested(viewer, { x: INTEREST_RADIUS + 3.1, z: 0, shape: 'circle', r: 3, width: 0 })).toBe(false);
    expect(telegraphInterested(viewer, { x: INTEREST_RADIUS + 9, z: 0, shape: 'line', r: 9, width: 1.8 })).toBe(true);
  });

  it('the state\'s position range is the shared zone limit (it wraps beyond)', () => {
    expect(sx(STATE_XZ_LIMIT_M - 1)).toBe(STATE_XZ_LIMIT_M - 1);
    expect(sx(STATE_XZ_LIMIT_M)).toBe(-STATE_XZ_LIMIT_M);
    expect(INTEREST_MAX_ADVENTURERS).toBe(50);
    expect(INTEREST_RANK_HYSTERESIS).toBe(10);
  });

  it('the grid returns everything within a cell of a point, and not far things', () => {
    const grid = new Grid<{ x: number; z: number; id: number }>();
    const items = Array.from({ length: 400 }, (_, i) => ({ x: (i % 20) * 20 - 200, z: Math.floor(i / 20) * 20 - 200, id: i }));
    for (const it of items) grid.insert(it);
    for (const p of [{ x: 0, z: 0 }, { x: -137, z: 55 }, { x: 199, z: -199 }]) {
      const near: number[] = [];
      grid.near(p.x, p.z, (it) => near.push(it.id));
      const want = items.filter((it) => Math.hypot(it.x - p.x, it.z - p.z) <= LEAVE_R).map((it) => it.id);
      for (const id of want) expect(near).toContain(id);
      expect(near.length).toBeLessThan(items.length / 2);
    }
    grid.clear();
    let n = 0;
    grid.near(0, 0, () => n++);
    expect(n).toBe(0);
  });
});

describe('who a client sees', () => {
  it('itself always; another adventurer only within the radius, added and removed on crossing it (with hysteresis)', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 62);
    await patches();
    expect(sees(a, a)).toBe(true);
    expect(sees(b, b)).toBe(true);
    expect(sees(a, b)).toBe(false); // 62 m apart
    expect(sees(b, a)).toBe(false);
    await walk(b.room, { x: 0, z: 62 }, { x: 0, z: 58 }, flat);
    await waitFor(() => sees(a, b) && sees(b, a));
    expect(players(a.room).get(b.room.sessionId)).toMatchObject({ name: 'Bob' });
    await walk(b.room, { x: 0, z: 58 }, { x: 0, z: 68 }, flat); // inside the hysteresis band: still seen
    await patches();
    expect(sees(a, b)).toBe(true);
    await walk(b.room, { x: 0, z: 68 }, { x: 0, z: 72 }, flat);
    await waitFor(() => !sees(a, b) && !sees(b, a));
    expect(sees(a, a)).toBe(true);
  });

  it('positions arrive as numbers within 2 cm of the pose sent', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 5);
    b.room.send('move', { x: 0.3137, z: 5.2219, y: 0, facing: 2.5, moving: true });
    await waitFor(() => Math.abs((players(a.room).get(b.room.sessionId)?.z ?? 0) - 5.2219) < 0.02);
    const seen = players(a.room).get(b.room.sessionId);
    expect(seen.x).toBeCloseTo(0.3137, 1);
    expect(Math.abs(seen.x - 0.3137)).toBeLessThan(0.02);
    expect(Math.abs(seen.facing - 2.5)).toBeLessThan(0.02);
    expect(seen.moving).toBe(true);
  });

  it('`online` counts everyone in the zone, seen or not', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    await joinAt(url, store, 'Bob', 0, 150);
    const c = await joinAt(url, store, 'Cara', 150, 0);
    await waitFor(() => a.room.state.online === 3);
    expect(players(a.room).size).toBe(1);
    await c.room.leave();
    await waitFor(() => a.room.state.online === 2);
  });

  it('/healthz reports each zone\'s patch time (p95, ms: one encode per client view) and the event-loop delay p99', async () => {
    const { url, store } = await start(flatGrove());
    await joinAt(url, store, 'Alice', 0, 0);
    await patches();
    const health: any = await (await fetch(`${url}/healthz`)).json();
    expect(Number.isFinite(health.zones.grove.patchMs)).toBe(true);
    expect(health.zones.grove.patchMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(health.eventLoopP99Ms)).toBe(true); // the process's event-loop delay p99 (ms, last 5 s)
    expect(health.eventLoopP99Ms).toBeGreaterThanOrEqual(0);
  });

  it('`online` stays true when an account signs in again (its older session is kicked)', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 150);
    await waitFor(() => a.room.state.online === 2);
    collect(b.room, 'kicked');
    const again = await joinZone(url, b.token, 'grove');
    await waitFor(() => serverRoom(a.room).playerCount === 2 && a.room.state.online === 2);
    await patches();
    expect(a.room.state.online).toBe(2);
    await again.room.leave();
    await waitFor(() => a.room.state.online === 1);
  });

  it('caps the adventurers in a view at the nearest K, with rank hysteresis (enter at rank K, leave past K + slack)', async () => {
    const { url, store } = await start({ ...flatGrove(), viewCap: { max: 2, slack: 1 } });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 10);
    const c = await joinAt(url, store, 'Cara', 0, 20);
    const d = await joinAt(url, store, 'Dan', 0, 30);
    await waitFor(() => sees(a, b) && sees(a, c));
    await patches();
    expect(sees(a, d)).toBe(false); // rank 3 > K
    expect(sees(a, a)).toBe(true);
    await walk(d.room, { x: 0, z: 30 }, { x: 0, z: 15 }, flat); // D rank 2, C rank 3: D comes in, C stays
    await waitFor(() => sees(a, d));
    expect(sees(a, c)).toBe(true);
    const e = await joinAt(url, store, 'Eve', 0, 3); // E 1, B 2, D 3, C 4: C leaves, E comes in
    await waitFor(() => sees(a, e) && !sees(a, c));
    expect(sees(a, b) && sees(a, d)).toBe(true);
    expect(a.room.state.online).toBe(5);
  });

  it('chat stays zone-wide', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 150);
    const heard = collect(a.room, 'chat');
    b.room.send('chat', { text: 'hello from afar' });
    await waitFor(() => heard.some((m) => m.text === 'hello from afar'));
  });

  it('a dodge across the radius brings the dodger into view', async () => {
    const clock = testClock(1);
    const { url, store } = await start({ ...flatGrove(), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 63);
    await patches();
    expect(sees(a, b)).toBe(false);
    b.room.send('dodge', { x: 0, z: 63, y: 0, facing: Math.PI, moving: false, ack: 0, dx: 0, dz: -1 });
    await waitFor(() => sees(a, b));
    await waitFor(() => (players(a.room).get(b.room.sessionId)?.z ?? 99) < 59);
  });

  it('a respawn at the statue leaves the view of those near the death and enters the view of those at the statue', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ ...flatGrove(), combatClock: clock.now, autoRespawnSeconds: 3 });
    const a = await joinAt(url, store, 'Alice', 0, 120);
    const there = await joinAt(url, store, 'Bob', 3, 120);
    const statue = await joinAt(url, store, 'Cara', SPAWN.x + 3, SPAWN.z);
    await waitFor(() => sees(there, a));
    expect(sees(statue, a)).toBe(false);
    const room = serverRoom(a.room);
    const w = worldOf(room.combat);
    killAdventurer(w, w.adventurers.get(players(a.room).get(a.room.sessionId).eid)!, w.now);
    await waitFor(() => sees(statue, a), 5000);
    await waitFor(() => !sees(there, a));
    expect(players(statue.room).get(a.room.sessionId)).toMatchObject({ dead: false });
  });

  it('after a reconnect there is no ghost of someone who walked out of view meanwhile, and they come back into view', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { url, store } = await start({ ...flatGrove(), reconnectSeconds: 20 });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 58);
    await waitFor(() => sees(a, b));
    Object.assign(a.room.reconnection, { enabled: true, ...CLIENT_RECONNECTION });
    const reconnected = new Promise<void>((resolve) => a.room.onReconnect(() => resolve()));
    (matchMaker.getLocalRoomById(a.room.roomId).clients.get(a.room.sessionId) as any).ref.terminate();
    await walk(b.room, { x: 0, z: 58 }, { x: 0, z: 72 }, flat); // out of view while A is away
    await reconnected;
    await waitFor(() => !sees(a, b));
    await patches();
    expect(sees(a, b)).toBe(false);
    await walk(b.room, { x: 0, z: 72 }, { x: 0, z: 59 }, flat);
    await waitFor(() => sees(a, b));
  }, 15_000);

  it('after a reconnect there is no ghost of someone who left the zone meanwhile', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const { url, store } = await start({ ...flatGrove(), reconnectSeconds: 20 });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 10);
    await waitFor(() => sees(a, b));
    Object.assign(a.room.reconnection, { enabled: true, ...CLIENT_RECONNECTION });
    const reconnected = new Promise<void>((resolve) => a.room.onReconnect(() => resolve()));
    (matchMaker.getLocalRoomById(a.room.roomId).clients.get(a.room.sessionId) as any).ref.terminate();
    await b.room.leave();
    await reconnected;
    await patches();
    expect(sees(a, b)).toBe(false);
    expect(a.room.state.online).toBe(1);
  }, 15_000);

  it('someone who leaves the zone is gone from every view that had them', async () => {
    const { url, store } = await start(flatGrove());
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const b = await joinAt(url, store, 'Bob', 0, 10);
    await waitFor(() => sees(a, b));
    await b.room.leave();
    await waitFor(() => players(a.room).size === 1);
  });
});

describe('enemies and telegraphs in view', () => {
  const thornlingAt = (x: number, z: number): CampSpawn => ({ kind: 'thornling', x, z, facing: 0 });

  it('an enemy comes into view at the radius, long before it can reach or aggro', async () => {
    const { url, store } = await start(flatGrove([thornlingAt(0, 64)]));
    const a = await joinAt(url, store, 'Alice', 0, 0);
    await patches();
    expect(a.room.state.enemies?.size ?? 0).toBe(0);
    await walk(a.room, { x: 0, z: 0 }, { x: 0, z: 5 }, flat);
    await waitFor(() => a.room.state.enemies?.size === 1);
    expect([...a.room.state.enemies.values()][0]).toMatchObject({ kind: 'thornling', mode: 'idle' });
  });

  it('the telegraph of an enemy just outside the radius whose attack reaches inside is seen, with its owner', async () => {
    const clock = testClock(4);
    // The Thornling stands 62 m from Alice; its Thorn Burst (r 3) reaches 59 m from her.
    const { url, store } = await start({ ...flatGrove([thornlingAt(0, 62)]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const far = await joinAt(url, store, 'Dan', 0, -10); // 72 m from the Thornling's burst
    await joinAt(url, store, 'Bob', 0, 63.5); // aggroes it
    await patches();
    expect(a.room.state.enemies?.size ?? 0).toBe(0);
    await waitFor(() => a.room.state.telegraphs?.size > 0, 6000);
    const tele = [...a.room.state.telegraphs.values()][0];
    expect(tele).toMatchObject({ attack: 'thorn_burst', shape: 'circle' });
    expect(a.room.state.enemies.get(String(tele.owner))).toMatchObject({ kind: 'thornling' });
    expect(far.room.state.telegraphs?.size ?? 0).toBe(0);
    expect(far.room.state.enemies?.size ?? 0).toBe(0);
    await waitFor(() => (a.room.state.telegraphs?.size ?? 0) === 0, 6000); // resolved: deleted from the view too
  });

  it('a telegraph carries its start on the room clock, so a client first seeing it late knows how far along it is', async () => {
    const clock = testClock(4);
    const { url, store } = await start({ ...flatGrove([thornlingAt(0, 3)]), combatClock: clock.now });
    const b = await joinAt(url, store, 'Bob', 0, 0); // aggroes it
    await waitFor(() => b.room.state.telegraphs?.size > 0, 6000);
    const tele = [...b.room.state.telegraphs.values()][0];
    const c0 = b.room.state.clock;
    expect(Number.isInteger(c0) && Number.isInteger(tele.at)).toBe(true);
    expect(tele.at).toBeLessThanOrEqual(c0);
    expect(c0 - tele.at).toBeLessThanOrEqual(Math.ceil(tele.total * TICK_HZ));
    // a client that joins mid-wind-up reads the same start
    const late = await joinAt(url, store, 'Cy', 0, -4);
    await waitFor(() => late.room.state.telegraphs?.get(String(tele.id)) !== undefined || (b.room.state.telegraphs?.size ?? 0) === 0, 6000);
    const seen = late.room.state.telegraphs?.get(String(tele.id));
    if (seen) expect(seen.at).toBe(tele.at);
    expect(late.room.state.clock).toBeGreaterThanOrEqual(c0);
  });

  it('the targeted enemy stays in view however far (beyond the hysteresis band)', async () => {
    const { url, store } = await start(flatGrove([{ kind: 'dummy', x: 0, z: 30, facing: 0 }, { kind: 'dummy', x: 0, z: 100, facing: 0 }]));
    const a = await joinAt(url, store, 'Alice', 0, 0);
    await waitFor(() => a.room.state.enemies?.size === 1);
    const w = freezeEngine(a.room);
    const far = [...w.enemies.values()].find((e: any) => e.z === 100)!;
    w.adventurers.get(players(a.room).get(a.room.sessionId).eid)!.targetId = far.id;
    await waitFor(() => enemyIds(a.room).includes(far.id));
    await patches();
    expect(enemyIds(a.room)).toContain(far.id);
    expect(players(a.room).get(a.room.sessionId).target).toBe(far.id);
  });

  it('an enemy targeting the client is brought into view however far', async () => {
    const { url, store } = await start(flatGrove([{ kind: 'dummy', x: 0, z: 100, facing: 0 }]));
    const a = await joinAt(url, store, 'Alice', 0, 0);
    await patches();
    expect(enemyIds(a.room)).toEqual([]);
    const w = freezeEngine(a.room);
    const far = [...w.enemies.values()][0] as any;
    far.targetId = players(a.room).get(a.room.sessionId).eid;
    await waitFor(() => enemyIds(a.room).includes(far.id));
  });

  it('a telegraph owner seen only for its telegraph leaves the view once the telegraph resolves', async () => {
    const clock = testClock(4);
    // A Bramble Boar 70.5 m from Alice (beyond the 70 m band): its Gore Charge line (9 m, 1.8 wide)
    // reaches within 60 m, so the telegraph and the boar are seen; it charges away, toward Bob.
    const { url, store } = await start({ ...flatGrove([{ kind: 'boar', x: 0, z: 70.5, facing: 0 }]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    await joinAt(url, store, 'Bob', 0, 72.5);
    await patches();
    expect(enemyIds(a.room)).toEqual([]);
    await waitFor(() => (a.room.state.telegraphs?.size ?? 0) > 0, 6000);
    expect(enemyIds(a.room)).toHaveLength(1);
    await waitFor(() => (a.room.state.telegraphs?.size ?? 0) === 0, 6000);
    await waitFor(() => enemyIds(a.room).length === 0);
  });

  it('fx follow the view: a hit on an enemy in view arrives, one out of view does not', async () => {
    const clock = testClock(4);
    const { url, store } = await start({ ...flatGrove([{ kind: 'dummy', x: 3, z: 0, facing: 0 }]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, 0);
    const near = await joinAt(url, store, 'Cara', 0, 55);
    const far = await joinAt(url, store, 'Bob', 0, 80);
    const nearFx = collect(near.room, 'fx'), farFx = collect(far.room, 'fx');
    const dummy = await waitFor(() => [...(a.room.state.enemies?.values() ?? [])][0]);
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => nearFx.flatMap((m) => m.events).some((e) => e.t === 'hit'), 4000);
    expect(farFx).toEqual([]);
  });
});
