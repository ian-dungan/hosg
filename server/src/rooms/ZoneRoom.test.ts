import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloseCode, matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { CLIENT_RECONNECTION, HP_REGEN_DELAY_S, SPAWN, TICK_HZ, fallDamage, groveTownSurface, makeBody, stepBody, type Body, type Surface } from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '../auth/tokens';
import { SECRET, accountFor, collect, joinGrove, saveAs, serverRoom, shown, sleep, startServer, sx, sy, testClock, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(opts?: Parameters<typeof startServer>[0]): Promise<TestServer> {
  server = await startServer(opts);
  return server;
}

/** Height of the grove's surface at (x, z) (0 where there is none, so a move there is still well formed). */
const ground = (x: number, z: number) => (groveTownSurface(x, z) ?? 0) + 0; // + 0: never -0
/** A running pose standing on the grove's surface. */
const pose = (x: number, z: number) => ({ x, z, y: ground(x, z), facing: 0, moving: true });

/** Turns automatic reconnection back on (joinGrove turns it off), with the browser client's settings. */
function reconnectLikeTheBrowser(room: Room<any, any>): void {
  Object.assign(room.reconnection, { enabled: true, ...CLIENT_RECONNECTION });
}

/** Cuts a client's socket the way a lost network does: the server destroys it, and both ends see 1006. */
function cutSocket(room: Room<any, any>): void {
  const serverClient = matchMaker.getLocalRoomById(room.roomId).clients.get(room.sessionId) as any;
  serverClient.ref.terminate();
}

/** Resolves with the next onDrop's close code. */
const nextDrop = (room: Room<any, any>) => new Promise<number>((resolve) => room.onDrop((code: number) => resolve(code)));

describe('joining the grove', () => {
  it('rejects a join without a valid token', async () => {
    const { url } = await start();
    await expect(new Client(url).joinOrCreate('grove', {})).rejects.toThrow();
    await expect(new Client(url).joinOrCreate('grove', { token: 'not-a-token' })).rejects.toThrow();
    const unknownAccount = signToken('00000000-0000-4000-8000-000000000000', SECRET);
    await expect(new Client(url).joinOrCreate('grove', { token: unknownAccount })).rejects.toThrow();
  });

  it('refuses an account whose adventurer has no name yet, and admits it once named', async () => {
    const { url, store } = await start();
    const registered = await fetch(`${url}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'rowan_88', password: 'longenough' }),
    });
    const { token, name } = (await registered.json()) as any;
    expect(name).toBeNull();
    await expect(new Client(url).joinOrCreate('grove', { token })).rejects.toThrow('Name your adventurer first');

    const named = await fetch(`${url}/api/name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Elowen' }),
    });
    expect(named.status).toBe(200);
    const a = await joinGrove(url, token);
    expect(a.room.state.players.get(a.room.sessionId)?.name).toBe('Elowen');
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    await waitFor(() => b.room.state.players.get(a.room.sessionId));
    expect(b.room.state.players.get(a.room.sessionId)?.name).toBe('Elowen'); // the adventurer's name, not 'rowan_88'
  });

  it('admits a guest without naming, under its Guest- name', async () => {
    const { url } = await start();
    const { token, name } = (await (await fetch(`${url}/api/guest`, { method: 'POST' })).json()) as any;
    expect(name).toMatch(/^Guest-\d{6}$/);
    const { room } = await joinGrove(url, token);
    expect(room.state.players.get(room.sessionId)?.name).toBe(name);
  });

  it('puts a new adventurer at SPAWN, standing on the ground, under its name, with full health', async () => {
    const { url, store } = await start();
    const { token } = await accountFor(store, 'Ellie');
    const { room } = await joinGrove(url, token);
    const me = room.state.players.get(room.sessionId);
    expect(me).toMatchObject({ name: 'Ellie', x: SPAWN.x, z: SPAWN.z, y: ground(SPAWN.x, SPAWN.z), facing: SPAWN.facing, moving: false });
    expect(me).toMatchObject({ hp: 100, maxHp: 100 });
  });

  it('uses SPAWN when the saved position is not walkable in the town', async () => {
    const { url, store } = await start();
    const { accountId, token } = await accountFor(store, 'Ellie');
    await saveAs(store, accountId, { x: 420, z: -260, facing: 1 }); // the far Beacon clearing
    const { room } = await joinGrove(url, token);
    expect(room.state.players.get(room.sessionId)).toMatchObject({ x: SPAWN.x, z: SPAWN.z });
  });
});

describe('movement', () => {
  it('two adventurers see each other, and a legal move from A reaches B within 300 ms', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    await waitFor(() => a.room.state.players.get(b.room.sessionId));
    expect(b.room.state.players.get(a.room.sessionId)?.name).toBe('Alice');

    const sentAt = Date.now();
    a.room.send('move', { x: 0.4, z: -11, y: ground(0.4, -11), facing: 1.5, moving: true });
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === sx(0.4), 300);
    expect(Date.now() - sentAt).toBeLessThan(300);
    expect(b.room.state.players.get(a.room.sessionId)).toMatchObject(shown({ x: 0.4, z: -11, y: ground(0.4, -11), facing: 1.5, moving: true }));
  });

  it('corrects a move that is too fast and leaves the state unchanged', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    a.room.send('move', pose(2000, 0));
    await waitFor(() => corrections.length > 0);
    expect(corrections[0]).toEqual({ x: SPAWN.x, z: SPAWN.z, y: ground(SPAWN.x, SPAWN.z) });
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject({ x: SPAWN.x, z: SPAWN.z });
  });

  it('ignores malformed moves and still accepts a following legal one', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    a.room.send('move', { x: NaN, z: -11, y: 0, facing: 0, moving: true });
    a.room.send('move', { x: 0.4, z: -11, facing: 0, moving: true }); // no height
    a.room.send('move', 'hello');
    a.room.send('move', null);
    a.room.send('move', pose(0.4, -11));
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.x === sx(0.4));
    expect(corrections).toEqual([]);
  });

  it('limits speed over a burst: many small steps in under 1 s cannot outrun the allowance', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    const sent = Array.from({ length: 40 }, (_, i) => pose(SPAWN.x + (i + 1) * 0.4, SPAWN.z)); // 16 m at once
    for (const p of sent) a.room.send('move', p);
    await waitFor(() => corrections.length > 0);
    await sleep(100);
    const me = a.room.state.players.get(a.room.sessionId);
    expect(me.x - SPAWN.x).toBeLessThanOrEqual(6 * 1.3 + 0.5 + 0.2); // one second's worth plus slack, no more
    // The correction is exact: the server's last accepted pose, which is one of the poses sent (the
    // state shows it quantised).
    const last = corrections.at(-1);
    expect(last).toEqual((serverRoom(a.room) as any).sessions.get(a.room.sessionId).lastGood);
    expect(sent.map(({ x, z, y }) => ({ x, z, y }))).toContainEqual(last);
    expect(shown(last)).toEqual({ x: me.x, z: SPAWN.z, y: me.y });
  });

  it('does not give a re-joining account a fresh allowance', async () => {
    const { url, store } = await start();
    const { token } = await accountFor(store, 'Alice');
    const first = await joinGrove(url, token);
    await sleep(1100); // bank a full allowance, then spend it
    const firstCorrections = collect(first.room, 'correct');
    for (let i = 1; i <= 40; i++) first.room.send('move', pose(SPAWN.x + i * 0.4, SPAWN.z));
    await waitFor(() => firstCorrections.length > 0);
    // The correction names the last accepted position; wait for the state patch to show it too.
    await waitFor(() => first.room.state.players.get(first.room.sessionId).x === sx(firstCorrections[0].x));
    const spentAt = first.room.state.players.get(first.room.sessionId).x;
    expect(spentAt - SPAWN.x).toBeGreaterThan(7);

    collect(first.room, 'kicked');
    const again = await joinGrove(url, token); // kicks the first session
    const corrections = collect(again.room, 'correct');
    const startX = again.room.state.players.get(again.room.sessionId).x;
    expect(startX).toBe(spentAt);
    for (let i = 1; i <= 40; i++) again.room.send('move', pose(startX + i * 0.4, SPAWN.z));
    await waitFor(() => corrections.length > 0);
    await sleep(50);
    expect(again.room.state.players.get(again.room.sessionId).x - startX).toBeLessThan(2); // not another 8.3 m
  });

  it('absorbs a catch-up burst of 60 moves: the client stays connected and moves normally afterwards', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    let left = false;
    a.room.onLeave(() => (left = true));
    collect(a.room, 'correct');
    for (let i = 1; i <= 60; i++) a.room.send('move', pose(SPAWN.x + (i % 2) * 0.4, SPAWN.z)); // back and forth
    await sleep(1100);
    const me = a.room.state.players.get(a.room.sessionId);
    const next = me.x + 0.4;
    a.room.send('move', pose(next, SPAWN.z));
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.x === sx(next));
    expect(left).toBe(false);
  });

  it('throttles a sustained flood without disconnecting anyone or stalling the room', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    let left = false;
    a.room.onLeave(() => (left = true));
    collect(a.room, 'correct');
    const floodStart = Date.now();
    for (let round = 0; round < 5; round++) {
      for (let i = 1; i <= 100; i++) a.room.send('move', pose(SPAWN.x + (round * 100 + i) * 0.4, SPAWN.z));
      await sleep(20);
    }
    // Another adventurer's move still goes through promptly.
    b.room.send('move', pose(SPAWN.x - 0.4, SPAWN.z));
    await waitFor(() => a.room.state.players.get(b.room.sessionId)?.x === sx(SPAWN.x - 0.4), 500);
    await sleep(200);
    const elapsed = (Date.now() - floodStart) / 1000;
    const travelled = a.room.state.players.get(a.room.sessionId).x - SPAWN.x;
    expect(travelled).toBeLessThanOrEqual(0.5 + 6 * 1.3 * elapsed);
    expect(left).toBe(false);
  });

  it('corrects a move into the statue plinth', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    await walk(a.room, SPAWN, { x: 0, z: -4.6 });
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.z === sx(-4.6));
    a.room.send('move', pose(0, -4.2)); // a short step onto the plinth
    await sleep(1000); // long enough that (0, 0) is in range: only the plinth blocks it
    a.room.send('move', pose(0, 0));
    await waitFor(() => corrections.length === 2);
    const before = { x: 0, z: -4.6, y: ground(0, -4.6) };
    expect(corrections).toEqual([before, before]);
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject(shown({ x: 0, z: -4.6 }));
  });
});

describe('sessions', () => {
  it('kicks the older client when the same account joins twice', async () => {
    const { url, store } = await start();
    const { token } = await accountFor(store, 'Alice');
    const first = await joinGrove(url, token);
    const kicked = collect(first.room, 'kicked');
    const left = new Promise<number>((resolve) => first.room.onLeave((code) => resolve(code)));

    const second = await joinGrove(url, token);
    expect(await left).toBeGreaterThan(0);
    expect(kicked).toEqual([{ reason: 'Signed in somewhere else' }]);
    await waitFor(() => !second.room.state.players.get(first.room.sessionId));
    expect(second.room.state.players.size).toBe(1);
    expect(second.room.state.players.get(second.room.sessionId)?.name).toBe('Alice');
  });

  it('lets the newer of two overlapping joins of one account win', async () => {
    const memory = createMemoryStore();
    // onAuth and onJoin both load the adventurer. The older join's second load (in its onJoin, after it claimed the
    // account) is held until the newer join's own onJoin load starts, i.e. until the newer one has claimed it: the
    // overlap is made by the store, not by wall-clock sleeps (which a busy machine can reorder).
    let calls = 0;
    let olderLoading!: () => void, newerClaimed!: () => void;
    const olderInJoin = new Promise<void>((resolve) => (olderLoading = resolve));
    const release = new Promise<void>((resolve) => (newerClaimed = resolve));
    const slow: Store = {
      ...memory,
      getOrCreateAdventurer: async (accountId) => {
        const call = ++calls;
        if (call === 2) { olderLoading(); await release; }
        if (call === 4) newerClaimed();
        return memory.getOrCreateAdventurer(accountId);
      },
    };
    const { url } = await start({ store: slow });
    const { token } = await accountFor(slow, 'Alice');
    // The refused join is logged by Colyseus (server) and the SDK (client); keep it out of the output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const older = new Client(url).joinOrCreate('grove', { token });
    await olderInJoin;
    const newer = joinGrove(url, token);
    await expect(older).rejects.toThrow('Signed in somewhere else');
    const { room } = await newer;
    expect(room.state.players.size).toBe(1);
    expect(room.state.players.get(room.sessionId)?.name).toBe('Alice');
  });

  it('refuses a join when the grove is full, and never opens a second grove room', async () => {
    const { url, store } = await start({ maxPlayers: 2 });
    await joinGrove(url, (await accountFor(store, 'Alice')).token);
    await joinGrove(url, (await accountFor(store, 'Bob')).token);
    const carol = await accountFor(store, 'Carol');
    await expect(new Client(url).joinOrCreate('grove', { token: carol.token })).rejects.toThrow(
      'Shady Grove is full, try again soon',
    );
    expect(await matchMaker.query({ name: 'grove' })).toHaveLength(1);
  });

  it('still admits an account that is already in a full grove, kicking its old session', async () => {
    const { url, store } = await start({ maxPlayers: 2 });
    const alice = await accountFor(store, 'Alice');
    const first = await joinGrove(url, alice.token);
    await joinGrove(url, (await accountFor(store, 'Bob')).token);
    const kicked = collect(first.room, 'kicked');
    const again = await joinGrove(url, alice.token);
    await waitFor(() => kicked.length === 1);
    expect(kicked).toEqual([{ reason: 'Signed in somewhere else' }]);
    await waitFor(() => again.room.state.players.size === 2);
    expect(again.room.state.players.get(again.room.sessionId)?.name).toBe('Alice');
    expect(await matchMaker.query({ name: 'grove' })).toHaveLength(1);
  });

  it('restores the last position after leaving and joining again', async () => {
    const { url, store } = await start();
    const { accountId, token } = await accountFor(store, 'Alice');
    const first = await joinGrove(url, token);
    await walk(first.room, SPAWN, { x: 1.2, z: -10 });
    await waitFor(() => first.room.state.players.get(first.room.sessionId)?.x === sx(1.2));
    await first.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(accountId)).x === 1.2);

    const again = await joinGrove(url, token);
    expect(again.room.state.players.get(again.room.sessionId)).toMatchObject(shown({ x: 1.2, z: -10 }));
  });

  it('saves online adventurers every saveSeconds', async () => {
    const { url, store } = await start({ saveSeconds: 0.2 });
    const { accountId, token } = await accountFor(store, 'Alice');
    const a = await joinGrove(url, token);
    a.room.send('move', pose(0.4, -11));
    await waitFor(async () => (await store.getOrCreateAdventurer(accountId)).x === 0.4);
    expect(a.room.state.players.get(a.room.sessionId)).toBeDefined(); // still online
  });

  it('keeps running when saving fails', async () => {
    const memory = createMemoryStore();
    const failing: Store = { ...memory, saveAdventurer: async () => Promise.reject(new Error('database down')) };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({ store: failing, saveSeconds: 0.1 });
    const a = await joinGrove(url, (await accountFor(failing, 'Alice')).token);
    await waitFor(() => logged.mock.calls.length > 0);
    a.room.send('move', pose(0.4, -11));
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.x === sx(0.4));
  });

  it('keeps a dropped adventurer for the reconnect window, then saves and removes them', async () => {
    const { url, store } = await start({ reconnectSeconds: 1 });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    a.room.send('move', pose(0.4, -11));
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === sx(0.4));

    // Drop A's socket without consent: A stays in the world, and reconnecting resumes the same entry.
    a.room.connection.close();
    await sleep(200);
    expect(b.room.state.players.get(a.room.sessionId)).toBeDefined();
    const resumed = await a.client.reconnect(a.room.reconnectionToken);
    resumed.reconnection.enabled = false;
    expect(resumed.sessionId).toBe(a.room.sessionId);
    resumed.send('move', pose(0.8, -11));
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === sx(0.8));
    expect(b.room.state.players.size).toBe(2);

    // Drop again and stay away: after the window the entry is gone and the position was saved.
    resumed.connection.close();
    await sleep(500);
    expect(b.room.state.players.get(a.room.sessionId)).toBeDefined();
    await waitFor(() => !b.room.state.players.get(a.room.sessionId), 2000);
    expect((await store.getOrCreateAdventurer(alice.accountId)).x).toBe(0.8);
  });

  // The path the browser takes (client/src/online.ts): the SDK's own automatic reconnection.
  for (const [how, drop, expectedCode] of [
    ['the network is lost', cutSocket, CloseCode.ABNORMAL_CLOSURE],
    ['the browser goes offline', (room: Room<any, any>) => room.connection.close(CloseCode.MAY_TRY_RECONNECT), CloseCode.MAY_TRY_RECONNECT],
  ] as const) {
    it(`reconnects the same room object by itself when ${how}`, async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {}); // the SDK narrates each reconnection step
      const { url, store } = await start();
      const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
      const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
      reconnectLikeTheBrowser(a.room);
      const sessionId = a.room.sessionId;
      const dropped = nextDrop(a.room);
      const reconnected = new Promise<void>((resolve) => a.room.onReconnect(() => resolve()));
      let left = false;
      a.room.onLeave(() => (left = true));

      drop(a.room);
      expect(await dropped).toBe(expectedCode);
      expect(a.room.reconnection.isReconnecting).toBe(true);
      await reconnected;
      expect(a.room.reconnection.isReconnecting).toBe(false);
      expect(a.room.sessionId).toBe(sessionId);

      // State patches flow again: B's move shows up on A, and A's move on B.
      b.room.send('move', pose(0.4, -11));
      await waitFor(() => a.room.state.players.get(b.room.sessionId)?.x === sx(0.4));
      a.room.send('move', pose(-0.4, -11));
      await waitFor(() => b.room.state.players.get(sessionId)?.x === sx(-0.4));
      expect(b.room.state.players.size).toBe(2);
      expect(left).toBe(false);
    });
  }

  it('frees the reconnect seat of an away session it kicks, so one account cannot fill the grove', async () => {
    const { url, store } = await start({ maxPlayers: 2 }); // Colyseus maxClients = 4; windows last 30 s
    const looper = await accountFor(store, 'Mallory');
    const grove = () => matchMaker.getLocalRoomById(rooms[0]!) as any;
    const rooms: string[] = [];
    for (let i = 0; i < 6; i++) {
      // Join, then cut the socket abruptly: the server opens a reconnect window (a reserved seat).
      const { room } = await joinGrove(url, looper.token);
      rooms[0] = room.roomId;
      const left = new Promise<void>((resolve) => room.onLeave(() => resolve()));
      cutSocket(room);
      await left;
      await waitFor(() => Object.prototype.hasOwnProperty.call(grove()._reservedSeats, room.sessionId));
      // The next join of the same account kicks that away session.
    }
    const last = await joinGrove(url, looper.token);
    expect(Object.keys(grove()._reservedSeats).length).toBe(0); // every kicked window gave its seat back
    expect(grove().hasReachedMaxClients()).toBe(false);
    const other = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    await waitFor(() => other.room.state.players.size === 2);
    expect(last.room.state.players.get(last.room.sessionId)?.name).toBe('Mallory');
  });
});

describe('health', () => {
  it('GET /healthz reports adventurers online, the measured patch rate and memory', async () => {
    const { url, store, app } = await start();
    const health = async (): Promise<any> => (await fetch(`${url}/healthz`)).json();
    expect(await health()).toMatchObject({ ok: true, players: 0 });
    await joinGrove(url, (await accountFor(store, 'Alice')).token);
    await sleep(1000);
    const report = await health();
    expect(report).toMatchObject({ ok: true, players: 1 });
    expect(report.tickHz).toBeGreaterThan(TICK_HZ - 2);
    expect(report.tickHz).toBeLessThanOrEqual(TICK_HZ + 1);
    expect(report.peakRssMb).toBeGreaterThanOrEqual(report.rssMb);
    expect(report.rssMb).toBeGreaterThan(0);
    const stats = app.stats();
    expect(stats.players).toBe(1);
    expect(Math.abs(stats.tickHz - report.tickHz)).toBeLessThan(2);
  });

  it('serves the client files from clientDir, and the accounts API under /api', async () => {
    const clientDir = await mkdtemp(join(tmpdir(), 'sg2-client-'));
    try {
      await writeFile(join(clientDir, 'index.html'), '<title>Shady Grove 2</title>');
      const { url } = await start({ clientDir });
      expect(await (await fetch(`${url}/`)).text()).toBe('<title>Shady Grove 2</title>');
      const guest = await fetch(`${url}/api/guest`, { method: 'POST' });
      expect(guest.status).toBe(200);
      expect(await guest.json()).toMatchObject({ token: expect.any(String), name: expect.stringMatching(/^Guest-/) });
    } finally {
      await rm(clientDir, { recursive: true });
    }
  });
});

// ───────── height ─────────

/**
 * A test grove: flat ground (null beyond 60 m) with, along z = SPAWN.z, five 2.5 m deep tiers 0.9 m
 * apart from x = 2 (top 4.5 m, ending in a sheer drop at x = 14.5), and along z = RAMP_Z a walkable
 * ramp up to 10 m at x = 12.5, also ending in a sheer drop.
 */
const RAMP_Z = -30;
const TIERS_END = 14.5;
const RAMP_END = 12.5;
const testSurface: Surface = (x, z) => {
  if (Math.hypot(x, z) > 60) return null;
  if (Math.abs(z - SPAWN.z) < 3 && x >= 2 && x < TIERS_END) return 0.9 * (1 + Math.floor((x - 2) / 2.5));
  if (Math.abs(z - RAMP_Z) < 3 && x > 0 && x <= RAMP_END) return Math.min(10, 0.8 * x);
  return 0;
};

type SentPose = { x: number; z: number; y: number; facing: number; moving: boolean };

/** Poses a client sends at TICK_HZ while the shared controller runs it towards +x, jumping by `jumpWhen`. */
function recordRun(body: Body, surface: Surface, untilX: number, jumpWhen: (b: Body) => boolean, maxSeconds = 8): SentPose[] {
  const sent: SentPose[] = [];
  const dt = 1 / TICK_HZ;
  for (let t = 0; t < maxSeconds && !(body.x >= untilX && body.grounded); t += dt) {
    stepBody(body, { vx: body.x < untilX ? 6 : 0, vz: 0, jump: body.grounded && jumpWhen(body) }, dt, surface);
    sent.push({ x: body.x, z: body.z, y: body.y, facing: Math.PI / 2, moving: true });
  }
  return sent;
}

/** Sends poses one per tick on a fixed schedule (so the timing does not drift). */
async function sendPoses(room: Room<any, any>, poses: SentPose[]): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < poses.length; i++) {
    const due = start + (i * 1000) / TICK_HZ;
    if (due > Date.now()) await sleep(due - Date.now());
    room.send('move', poses[i]);
  }
}

/** Joins with the adventurer saved at (x, z) first. */
async function joinAt(url: string, store: Store, name: string, x: number, z: number) {
  const { accountId, token } = await accountFor(store, name);
  await saveAs(store, accountId, { x, z, facing: 0 });
  return joinGrove(url, token);
}

/** Walks a client up the test ramp from its foot (x = 0) to the top, in grounded running steps. */
function rampPoses(): SentPose[] {
  const out: SentPose[] = [];
  const n = Math.ceil(RAMP_END / 0.4);
  for (let i = 1; i <= n; i++) {
    const x = (RAMP_END * i) / n;
    out.push({ x, z: RAMP_Z, y: testSurface(x, RAMP_Z)!, facing: 0, moving: true });
  }
  return out;
}

describe('height', () => {
  it('a legal jump is reflected in the other clients\' y', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    await waitFor(() => b.room.state.players.get(a.room.sessionId));
    const corrections = collect(a.room, 'correct');
    const seen: number[] = [];
    b.room.onStateChange(() => seen.push(b.room.state.players.get(a.room.sessionId)?.y ?? 0));
    const body = makeBody(SPAWN.x, SPAWN.z, groveTownSurface);
    let jumped = false;
    const jumpOnce = () => !jumped && (jumped = true);
    await sendPoses(a.room, recordRun(body, groveTownSurface, SPAWN.x + 5, jumpOnce));
    await sleep(200);
    expect(corrections).toEqual([]);
    expect(Math.max(...seen) - ground(SPAWN.x, SPAWN.z)).toBeGreaterThan(1.2);
    expect(b.room.state.players.get(a.room.sessionId).y).toBe(sy(body.y));
  });

  it('corrects a pose 50 m up and leaves the state unchanged', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    const spawn = { x: SPAWN.x, z: SPAWN.z, y: ground(SPAWN.x, SPAWN.z) };
    a.room.send('move', { x: SPAWN.x + 0.2, z: SPAWN.z, y: 50, facing: 0, moving: true });
    await waitFor(() => corrections.length > 0);
    await sleep(100);
    expect(corrections).toEqual([spawn]);
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject(spawn);
  });

  it('cannot gain height by mashing jump: airborne poses each 1 m above the last are corrected', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    const y0 = ground(SPAWN.x, SPAWN.z);
    let highest = y0;
    a.room.onStateChange(() => (highest = Math.max(highest, a.room.state.players.get(a.room.sessionId)?.y ?? y0)));
    await sendPoses(a.room, Array.from({ length: 10 }, (_, i) => ({ x: SPAWN.x, z: SPAWN.z, y: y0 + i + 1, facing: 0, moving: true })));
    await sleep(200);
    expect(corrections.length).toBeGreaterThanOrEqual(8);
    expect(highest - y0).toBeLessThanOrEqual(2);
  });

  it('climbing a tall platform by legal jumps, then stepping off its edge, costs fallDamage(drop) and sends hurt', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, SPAWN.z);
    const corrections = collect(a.room, 'correct');
    const hurts = collect(a.room, 'hurt');
    const body = makeBody(0, SPAWN.z, testSurface);
    // jump whenever the next tier's edge is just ahead
    const nextEdge = (x: number) => 2 + 2.5 * Math.max(0, Math.floor((x - 2) / 2.5) + 1);
    const climb = recordRun(body, testSurface, 13.5, (b) => b.x < 12 && nextEdge(b.x) - b.x < 0.6);
    expect(body.y).toBeCloseTo(4.5, 9);
    const fall = recordRun(body, testSurface, TIERS_END + 2, () => false);
    expect(body.y).toBe(0);
    await sendPoses(a.room, [...climb, ...fall]);
    await waitFor(() => hurts.length > 0);
    expect(corrections).toEqual([]);
    expect(hurts).toEqual([{ amount: fallDamage(4.5), cause: 'fall' }]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).hp === 100 - fallDamage(4.5));
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject({ y: 0, maxHp: 100 });
  });

  it('repeated falls never take hp below 1, even when the poses in the air are never sent', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    const corrections = collect(a.room, 'correct');
    const hurts = collect(a.room, 'hurt');
    const me = () => a.room.state.players.get(a.room.sessionId);
    for (let round = 0; round < 2; round++) {
      // up the ramp, straight down to the ground beyond its edge, and back to its foot
      const flat = (x: number, z: number) => ({ x, z, y: 0, facing: 0, moving: true });
      const down = flat(RAMP_END + 0.4, RAMP_Z), aside = flat(RAMP_END + 0.4, RAMP_Z - 3.2), corner = flat(0, RAMP_Z - 3.2);
      await sendPoses(a.room, [
        ...rampPoses(), down,
        ...stepsBetween(down, aside), ...stepsBetween(aside, corner), ...stepsBetween(corner, flat(0, RAMP_Z)),
      ]);
      await waitFor(() => hurts.length === round + 1);
    }
    expect(corrections).toEqual([]);
    expect(hurts).toEqual([
      { amount: fallDamage(10), cause: 'fall' },
      { amount: 100 - fallDamage(10) - 1, cause: 'fall' },
    ]);
    await waitFor(() => me().hp === 1);
  }, 15_000);

  it('health comes back HP_REGEN_PER_S a second once the regen delay has passed since the last fall', async () => {
    // the regen delay is the engine's (HP_REGEN_DELAY_S): the combat clock is jumped over it
    const clock = testClock(1);
    const { url, store } = await start({ zones: { grove: { surface: testSurface } }, combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    const hurts = collect(a.room, 'hurt');
    const me = () => a.room.state.players.get(a.room.sessionId);
    await sendPoses(a.room, [...rampPoses(), { x: RAMP_END + 0.4, z: RAMP_Z, y: 0, facing: 0, moving: true }]);
    await waitFor(() => hurts.length === 1);
    const hurtAt = clock.now();
    await waitFor(() => me().hp === 100 - fallDamage(10));
    await sleep(600);
    expect(me().hp).toBe(100 - fallDamage(10)); // still inside the delay
    clock.skip(HP_REGEN_DELAY_S - 1);
    await sleep(300);
    expect(me().hp).toBe(100 - fallDamage(10)); // still inside it, just
    clock.skip(1);
    await waitFor(() => me().hp >= 100 - fallDamage(10) + 2, 2500);
    expect(clock.now() - hurtAt).toBeGreaterThan(HP_REGEN_DELAY_S);
    const hp = me().hp;
    await sleep(1000);
    expect(me().hp - hp).toBeGreaterThanOrEqual(1);
    expect(me().hp - hp).toBeLessThanOrEqual(3); // about 2 a second
  }, 10_000);

  it('dropping the socket in mid-air and reconnecting on the ground still costs the health', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    const corrections = collect(a.room, 'correct');
    await sendPoses(a.room, [...rampPoses(), { x: RAMP_END + 0.3, z: RAMP_Z, y: 9.9, facing: 0, moving: true }]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).y === sy(9.9));

    a.room.connection.close(); // dropped in the air
    await sleep(200);
    const resumed = await a.client.reconnect(a.room.reconnectionToken);
    resumed.reconnection.enabled = false;
    const hurts = collect(resumed, 'hurt');
    resumed.send('move', { x: RAMP_END + 0.6, z: RAMP_Z, y: 0, facing: 0, moving: true });
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
    expect(corrections).toEqual([]);
  });

  it('a re-joining account keeps its air track: landing after a re-join mid-air still costs the health', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const { accountId, token } = await accountFor(store, 'Alice');
    await saveAs(store, accountId, { x: 0, z: RAMP_Z, facing: 0 });
    const first = await joinGrove(url, token);
    await sendPoses(first.room, [...rampPoses(), { x: RAMP_END + 0.3, z: RAMP_Z, y: 9.9, facing: 0, moving: true }]);
    await waitFor(() => first.room.state.players.get(first.room.sessionId).y === sy(9.9));
    collect(first.room, 'kicked');
    const again = await joinGrove(url, token); // kicks the first session
    const hurts = collect(again.room, 'hurt');
    expect(again.room.state.players.get(again.room.sessionId)).toMatchObject(shown({ x: RAMP_END + 0.3, y: 9.9 }));
    again.room.send('move', { x: RAMP_END + 0.6, z: RAMP_Z, y: 0, facing: 0, moving: true });
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
  });
});

describe('height after a long gap in the air', { timeout: 15_000 }, () => {
  const offTheTop = { x: RAMP_END + 0.3, z: RAMP_Z, y: 9.9, facing: 0, moving: true };
  const below = { x: RAMP_END + 0.6, z: RAMP_Z, y: 0, facing: 0, moving: true };

  // From a 10 m take-off the jump ceiling is below the ground after about 1.7 s: these gaps are longer.
  it('accepts a landing that arrives 2.5 s after the last pose in the air', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    const corrections = collect(a.room, 'correct');
    const hurts = collect(a.room, 'hurt');
    await sendPoses(a.room, [...rampPoses(), offTheTop]);
    await sleep(2500);
    await sendPoses(a.room, [below, { ...below, x: below.x + 0.4 }]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).x === sx(below.x + 0.4));
    expect(corrections).toEqual([]);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
  });

  it('reconnecting 2.5 s after going airborne, on the ground, still costs the health and is not corrected', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    await sendPoses(a.room, [...rampPoses(), offTheTop]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).y === sy(9.9));
    a.room.connection.close();
    await sleep(2500);
    const resumed = await a.client.reconnect(a.room.reconnectionToken);
    resumed.reconnection.enabled = false;
    const corrections = collect(resumed, 'correct');
    const hurts = collect(resumed, 'hurt');
    resumed.send('move', below);
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
    resumed.send('move', { ...below, x: below.x + 0.4 });
    await waitFor(() => resumed.state.players.get(resumed.sessionId).x === sx(below.x + 0.4));
    expect(corrections).toEqual([]);
  });

  it('re-joining 2.5 s after going airborne lands on the ground with the fall\'s damage', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const { accountId, token } = await accountFor(store, 'Alice');
    await saveAs(store, accountId, { x: 0, z: RAMP_Z, facing: 0 });
    const first = await joinGrove(url, token);
    await sendPoses(first.room, [...rampPoses(), offTheTop]);
    await waitFor(() => first.room.state.players.get(first.room.sessionId).y === sy(9.9));
    collect(first.room, 'kicked');
    await sleep(2500);
    const again = await joinGrove(url, token);
    const corrections = collect(again.room, 'correct');
    const hurts = collect(again.room, 'hurt');
    again.room.send('move', below);
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
    expect(corrections).toEqual([]);
  });

  it('a correction in the air puts the adventurer on the ground below, with the fall\'s damage, and the next step from there is accepted', async () => {
    const { url, store } = await start({ zones: { grove: { surface: testSurface } } });
    const a = await joinAt(url, store, 'Alice', 0, RAMP_Z);
    const corrections = collect(a.room, 'correct');
    const hurts = collect(a.room, 'hurt');
    await sendPoses(a.room, [...rampPoses(), offTheTop]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).y === sy(9.9));
    a.room.send('move', { ...offTheTop, y: 50 });
    await waitFor(() => corrections.length > 0);
    const landed = { x: offTheTop.x, z: offTheTop.z, y: 0 };
    expect(corrections).toEqual([landed]);
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(10), cause: 'fall' }]);
    await waitFor(() => a.room.state.players.get(a.room.sessionId).y === 0);
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject(shown(landed));
    // the client takes the corrected pose and carries on from it: accepted, no loop
    a.room.send('move', { ...landed, x: landed.x + 0.4, facing: 0, moving: true });
    await waitFor(() => a.room.state.players.get(a.room.sessionId).x === sx(landed.x + 0.4));
    expect(corrections).toHaveLength(1);
    expect(hurts).toHaveLength(1);
  });
});

/** Running steps of at most 0.4 m from `from` to `to` (excluding `from`), on flat ground at y = 0. */
function stepsBetween(from: SentPose, to: SentPose): SentPose[] {
  const n = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.4);
  return Array.from({ length: n }, (_, i) => ({
    x: from.x + ((to.x - from.x) * (i + 1)) / n, z: from.z + ((to.z - from.z) * (i + 1)) / n, y: 0, facing: 0, moving: true,
  }));
}
