// Final review I1: a promise a room starts and does not await never rejects unhandled (Node 22 ends the
// process on one): each is caught, logged (throttled) and counted in stepErrors, and the room carries on.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { CHAT_MIN_INTERVAL_MS } from '@sg2/shared';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import { SECRET, accountFor, collect, joinGrove, serverRoom, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const session = (room: Room<any, any>) => (serverRoom(room) as any).sessions.get(room.sessionId);
const boom = () => Promise.reject(new Error('boom (test)'));

describe('unhandled rejections in the rooms (final review I1)', () => {
  it('a failing periodic save is caught and counted', async () => {
    server = await startServer({ saveSeconds: 0.1 });
    const a = await accountFor(server.store, 'Saver');
    const { room } = await joinGrove(server.url, a.token);
    const grove = serverRoom(room) as any;
    const before = grove.stepErrors;
    grove.save = boom;
    await waitFor(() => grove.stepErrors > before, 3000);
    delete grove.save; // (the prototype's again, for the close)
  }, 15_000);

  it('a failing travel is caught and counted, and the adventurer is not left travelling', async () => {
    server = await startServer();
    const a = await accountFor(server.store, 'Walker');
    const { room } = await joinGrove(server.url, a.token);
    const grove = serverRoom(room) as any;
    const s = session(room);
    const greenway = grove.rooms.get('greenway');
    const before = grove.stepErrors;
    grove.save = boom;
    grove.travel(s, { to: 'greenway', arrive: { x: 0, z: 0, facing: 0 } }, greenway, { ...s.lastGood });
    await waitFor(() => grove.stepErrors > before, 3000);
    await waitFor(() => s.travelling === undefined, 3000);
    delete grove.save;
  }, 15_000);

  it('a failing instance entry is caught and counted', async () => {
    server = await startServer();
    const a = await accountFor(server.store, 'Delver');
    const { room } = await joinGrove(server.url, a.token);
    const grove = serverRoom(room) as any;
    const s = session(room);
    const before = grove.stepErrors;
    grove.instances.enter = async () => 'full';
    grove.notice = () => { throw new Error('boom (test)'); };
    grove.enterInstance(s, { ...s.lastGood });
    await waitFor(() => grove.stepErrors > before, 3000);
  }, 15_000);

  it("a GM's chat line re-run after the role check is guarded like any handler", async () => {
    server = await startServer({ store: createMemoryStore({ testGms: ['Gail'] }) });
    const account = await server.store.createAccount({ username: 'Gail', passwordHash: 'h', isGuest: false });
    await server.store.nameAdventurer(account.id, 'Gail');
    const { room } = await joinGrove(server.url, signToken(account.id, SECRET));
    const chats = collect(room, 'chat');
    const grove = serverRoom(room) as any;
    room.send('chat', { text: 'one' });
    await waitFor(() => chats.length === 1);
    session(room).roleCheckedAt -= 31_000;
    await sleep(CHAT_MIN_INTERVAL_MS + 20);
    const before = grove.stepErrors;
    const broadcast = grove.broadcast;
    grove.broadcast = (type: string, ...rest: unknown[]) => {
      if (type === 'chat') throw new Error('boom (test)');
      return broadcast.call(grove, type, ...rest);
    };
    room.send('chat', { text: 'two' });
    await waitFor(() => grove.stepErrors > before, 3000);
  }, 15_000);
});

describe('offline loot (final review M1)', () => {
  it("is written under the session's own write lock (after its save in flight), not a fresh one", async () => {
    server = await startServer();
    const a = await accountFor(server.store, 'Looter');
    const { room } = await joinGrove(server.url, a.token);
    const grove = serverRoom(room) as any;
    const s = session(room);
    const locks: unknown[] = [];
    const make = grove.makeQueue;
    grove.makeQueue = function (this: unknown, ...args: unknown[]) { locks.push(args[1]); return make.apply(this, args); };
    grove.offlineLoot(s, []);
    expect(locks).toEqual([s.lock]);
    expect(locks[0]).toBe(s.lock);
  }, 15_000);
});
