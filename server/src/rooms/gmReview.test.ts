// Task 7 review round 1: the audit log cannot be flooded by non-GMs, a revoked GM loses its badge within 30 s,
// item grants count toward the daily gold cap, a failed grant says it may have landed, and test GMs are never guests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { CHAT_MIN_INTERVAL_MS, ITEMS } from '@sg2/shared';
import { GM_GOLD_PER_DAY } from '../gm/commands';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { SECRET, accountFor as guestFor, collect, joinGrove, serverRoom, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function member(store: Store, username: string) {
  const account = await store.createAccount({ username, passwordHash: 'h', isGuest: false });
  await store.nameAdventurer(account.id, username);
  return { accountId: account.id, token: signToken(account.id, SECRET) };
}
async function start(gms = ['Gail']) {
  server = await startServer({ store: createMemoryStore({ testGms: gms }) });
  return server;
}
const session = (room: Room<any, any>) => (serverRoom(room) as any).sessions.get(room.sessionId);
const say = (room: Room<any, any>, text: string) => room.send('chat', { text });
async function gm(room: Room<any, any>, notices: any[], line: string): Promise<string> {
  const before = notices.length;
  say(room, line);
  return (await waitFor(() => notices[before], 3000)).text as string;
}

describe('Task 7 review round 1', () => {
  it('I1: 100 non-GM /gm lines write at most one audit row, holding the verb only', async () => {
    const { url, store } = await start();
    const bob = await member(store, 'Bob');
    const b = await joinGrove(url, bob.token);
    const chats = collect(b.room, 'chat');
    for (let i = 0; i < 100; i++) {
      session(b.room).lastChatAt = -Infinity; // past the chat interval every time
      say(b.room, `/gm grant gold ${i + 1} Bob secret words ${i}`);
      await sleep(30);
    }
    await waitFor(() => chats.length === 100, 5000);
    await sleep(200);
    const rows = (await store.gmAudit(1000)).filter((r) => r.command === 'denied');
    expect(rows.length).toBeLessThanOrEqual(1);
    expect(rows[0]?.args).toEqual({ verb: '/gm grant' });
    expect(JSON.stringify(rows)).not.toContain('secret');
  }, 20_000);

  it('I2: a revoked GM loses the chat badge within 30 s of chat', async () => {
    const { url, store } = await start();
    const gail = await member(store, 'Gail');
    const g = await joinGrove(url, gail.token);
    const chats = collect(g.room, 'chat');
    say(g.room, 'one');
    await waitFor(() => chats.length === 1);
    expect(chats[0].gm).toBe(true);
    await store.setGm('Gail', false);
    session(g.room).roleCheckedAt -= 31_000; // 31 s later
    await sleep(CHAT_MIN_INTERVAL_MS + 20);
    say(g.room, 'two');
    await waitFor(() => chats.length === 2);
    expect(chats[1].gm).toBeUndefined();
  }, 20_000);

  it('item grants count their sell value toward the daily gold cap', async () => {
    const { url, store } = await start();
    const gail = await member(store, 'Gail');
    await member(store, 'Bob');
    const value = ITEMS.last_bell!.sell;
    await store.logGm({ gmAccount: gail.accountId, command: 'grant gold', target: 'Bob', args: { amount: GM_GOLD_PER_DAY - value + 1, name: 'Bob', counted: GM_GOLD_PER_DAY - value + 1 }, ok: true, result: 'done' });
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm grant item last_bell Bob')).toMatch(/a day/);
    expect((await store.getOrCreateAdventurer((await store.findAccountByUsername('Bob'))!.id)).inventory.bag.some((i) => i.item === 'last_bell')).toBe(false);
  }, 20_000);

  it('a grant that failed says it may have landed, and counts toward the cap', async () => {
    const { url, store } = await start();
    const gail = await member(store, 'Gail');
    await member(store, 'Bob');
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice');
    vi.spyOn(store, 'grantOffline').mockResolvedValueOnce('failed');
    expect(await gm(g.room, notices, '/gm grant gold 400 Bob')).toMatch(/may not have landed.*check before retrying/i);
    expect(await store.gmGoldToday(gail.accountId, new Date().toISOString().slice(0, 10))).toBe(400);
  }, 20_000);

  it('test GMs are never guests', async () => {
    const { url, store } = await start(['Gail']);
    const gail = await guestFor(store, 'Gail'); // a guest account with that name
    const g = await joinGrove(url, gail.token);
    const chats = collect(g.room, 'chat');
    say(g.room, '/gm help');
    await waitFor(() => chats.length === 1); // ordinary chat: not a game master
    expect((await store.findAccountById(gail.accountId))!.isGm).toBe(false);
  }, 20_000);
});
