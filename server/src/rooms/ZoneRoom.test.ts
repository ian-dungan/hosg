import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { SPAWN } from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signToken } from '../auth/tokens';
import { SECRET, accountFor, collect, joinGrove, sleep, startServer, waitFor, walk, type TestServer } from './testHelpers';

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

const pose = (x: number, z: number) => ({ x, z, facing: 0, moving: true });

describe('joining the grove', () => {
  it('rejects a join without a valid token', async () => {
    const { url } = await start();
    await expect(new Client(url).joinOrCreate('grove', {})).rejects.toThrow();
    await expect(new Client(url).joinOrCreate('grove', { token: 'not-a-token' })).rejects.toThrow();
    const unknownAccount = signToken('00000000-0000-4000-8000-000000000000', SECRET);
    await expect(new Client(url).joinOrCreate('grove', { token: unknownAccount })).rejects.toThrow();
  });

  it('puts a new adventurer at SPAWN, under the account name', async () => {
    const { url, store } = await start();
    const { token } = await accountFor(store, 'Ellie');
    const { room } = await joinGrove(url, token);
    const me = room.state.players.get(room.sessionId);
    expect(me).toMatchObject({ name: 'Ellie', x: SPAWN.x, z: SPAWN.z, facing: SPAWN.facing, moving: false });
  });

  it('uses SPAWN when the saved position is not walkable in the town', async () => {
    const { url, store } = await start();
    const { accountId, token } = await accountFor(store, 'Ellie');
    const saved = await store.getOrCreateAdventurer(accountId, 'Ellie');
    await store.saveAdventurer({ id: saved.id, x: 420, z: -260, facing: 1 }); // the far Beacon clearing
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
    a.room.send('move', { x: 0.4, z: -11, facing: 1.5, moving: true });
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === 0.4, 300);
    expect(Date.now() - sentAt).toBeLessThan(300);
    expect(b.room.state.players.get(a.room.sessionId)).toMatchObject({ x: 0.4, z: -11, facing: 1.5, moving: true });
  });

  it('corrects a move that is too fast and leaves the state unchanged', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    a.room.send('move', pose(2000, 0));
    await waitFor(() => corrections.length > 0);
    expect(corrections[0]).toEqual({ x: SPAWN.x, z: SPAWN.z });
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject({ x: SPAWN.x, z: SPAWN.z });
  });

  it('ignores malformed moves and still accepts a following legal one', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    a.room.send('move', { x: NaN, z: -11, facing: 0, moving: true });
    a.room.send('move', 'hello');
    a.room.send('move', null);
    a.room.send('move', pose(0.4, -11));
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.x === 0.4);
    expect(corrections).toEqual([]);
  });

  it('limits speed over a burst: many small steps in under 1 s cannot outrun the allowance', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    for (let i = 1; i <= 40; i++) a.room.send('move', pose(SPAWN.x + i * 0.4, SPAWN.z)); // 16 m at once
    await waitFor(() => corrections.length > 0);
    await sleep(100);
    const me = a.room.state.players.get(a.room.sessionId);
    expect(me.x - SPAWN.x).toBeLessThanOrEqual(6 * 1.3 + 0.5 + 0.2); // one second's worth plus slack, no more
    expect(corrections.at(-1)).toEqual({ x: me.x, z: SPAWN.z });
  });

  it('disconnects a client that floods the room with messages', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const left = new Promise<number>((resolve) => a.room.onLeave((code) => resolve(code)));
    for (let i = 0; i < 200; i++) a.room.send('move', pose(SPAWN.x, SPAWN.z));
    expect(await left).toBe(4002);
  });

  it('corrects a move into the statue plinth', async () => {
    const { url, store } = await start();
    const a = await joinGrove(url, (await accountFor(store, 'Alice')).token);
    const corrections = collect(a.room, 'correct');
    await walk(a.room, SPAWN, { x: 0, z: -4.6 });
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.z === -4.6);
    a.room.send('move', pose(0, -4.2)); // a short step onto the plinth
    await sleep(1000); // long enough that (0, 0) is in range: only the plinth blocks it
    a.room.send('move', pose(0, 0));
    await waitFor(() => corrections.length === 2);
    expect(corrections).toEqual([{ x: 0, z: -4.6 }, { x: 0, z: -4.6 }]);
    expect(a.room.state.players.get(a.room.sessionId)).toMatchObject({ x: 0, z: -4.6 });
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
    const slow: Store = {
      ...memory,
      getOrCreateAdventurer: async (accountId, name) => {
        await sleep(200);
        return memory.getOrCreateAdventurer(accountId, name);
      },
    };
    const { url } = await start({ store: slow });
    const { token } = await accountFor(slow, 'Alice');
    // The refused join is logged by Colyseus (server) and the SDK (client); keep it out of the output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const older = new Client(url).joinOrCreate('grove', { token });
    await sleep(50);
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
    await waitFor(() => first.room.state.players.get(first.room.sessionId)?.x === 1.2);
    await first.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(accountId, 'Alice')).x === 1.2);

    const again = await joinGrove(url, token);
    expect(again.room.state.players.get(again.room.sessionId)).toMatchObject({ x: 1.2, z: -10 });
  });

  it('saves online adventurers every saveSeconds', async () => {
    const { url, store } = await start({ saveSeconds: 0.2 });
    const { accountId, token } = await accountFor(store, 'Alice');
    const a = await joinGrove(url, token);
    a.room.send('move', pose(0.4, -11));
    await waitFor(async () => (await store.getOrCreateAdventurer(accountId, 'Alice')).x === 0.4);
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
    await waitFor(() => a.room.state.players.get(a.room.sessionId)?.x === 0.4);
  });

  it('keeps a dropped adventurer for the reconnect window, then saves and removes them', async () => {
    const { url, store } = await start({ reconnectSeconds: 1 });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const b = await joinGrove(url, (await accountFor(store, 'Bob')).token);
    a.room.send('move', pose(0.4, -11));
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === 0.4);

    // Drop A's socket without consent: A stays in the world, and reconnecting resumes the same entry.
    a.room.connection.close();
    await sleep(200);
    expect(b.room.state.players.get(a.room.sessionId)).toBeDefined();
    const resumed = await a.client.reconnect(a.room.reconnectionToken);
    resumed.reconnection.enabled = false;
    expect(resumed.sessionId).toBe(a.room.sessionId);
    resumed.send('move', pose(0.8, -11));
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.x === 0.8);
    expect(b.room.state.players.size).toBe(2);

    // Drop again and stay away: after the window the entry is gone and the position was saved.
    resumed.connection.close();
    await sleep(500);
    expect(b.room.state.players.get(a.room.sessionId)).toBeDefined();
    await waitFor(() => !b.room.state.players.get(a.room.sessionId), 2000);
    expect((await store.getOrCreateAdventurer(alice.accountId, 'Alice')).x).toBe(0.8);
  });
});

describe('health', () => {
  it('GET /healthz reports the number of adventurers online', async () => {
    const { url, store, app } = await start();
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ ok: true, players: 0 });
    await joinGrove(url, (await accountFor(store, 'Alice')).token);
    expect(await (await fetch(`${url}/healthz`)).json()).toEqual({ ok: true, players: 1 });
    expect(app.stats()).toEqual({ players: 1, tickHz: 15 });
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
