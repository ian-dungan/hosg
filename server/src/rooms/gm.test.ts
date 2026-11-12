// GM tools through the rooms (memory store; game masters marked by the store's test-only testGms, as
// SG2_TEST_GMS does): /gm lines, announce, grants online and offline, events, teleport, kick, the audit
// log and the limits, and that no client message or route can make anyone a game master.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { CHAT_MIN_INTERVAL_MS, GOLD_MAX, LAMPFALL_MOUTH, groveTownSurface, zoneDef } from '@sg2/shared';
import { GM_ANNOUNCE_EVERY_S, GM_GOLD_PER_DAY, GM_HELP, GM_PER_MIN } from '../gm/commands';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import {
  accountFor, collect, collectFromJoin, intoLampfall, joinGrove, joinZone, saveAs, sendInv, sleep, startServer, waitFor, walk, type TestServer,
} from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(gms: string[] = ['Gail']): Promise<TestServer> {
  const store = createMemoryStore({ testGms: gms });
  server = await startServer({ store, reconnectSeconds: 1 });
  return server;
}

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
/** Audit rows oldest first. */
const audit = async (store: Store) => (await store.gmAudit(1000)).reverse();
/** Every message of every type the room receives from now on, as [type, message]. */
function everything(room: Room<any, any>): [string, any][] {
  const all: [string, any][] = [];
  room.onMessage('*', (type: string | number, message: any) => all.push([String(type), message]));
  return all;
}
const say = (room: Room<any, any>, text: string) => room.send('chat', { text });
/** A GM line, then the GM's result notice. */
async function gm(room: Room<any, any>, notices: any[], line: string): Promise<string> {
  const before = notices.length;
  say(room, line);
  const n = await waitFor(() => notices[before], 3000);
  return n.text as string;
}

describe('GM tools', () => {
  it('a non-GM /gm line is ordinary chat: nothing runs, no reply but the chat line, one refused audit row', async () => {
    const { url, store } = await start();
    const bob = await accountFor(store, 'Bob'), cara = await accountFor(store, 'Cara'), gail = await accountFor(store, 'Gail');
    const b = await joinGrove(url, bob.token), c = await joinGrove(url, cara.token), g = await joinGrove(url, gail.token);
    const seenB = everything(b.room), seenC = everything(c.room), seenG = everything(g.room);
    say(b.room, '/gm announce free gold');
    await waitFor(() => seenC.some(([t]) => t === 'chat'));
    await sleep(CHAT_MIN_INTERVAL_MS + 50);
    say(b.room, '/gx announce free gold'); // any other slash line: the same treatment
    await waitFor(() => seenC.filter(([t]) => t === 'chat').length === 2);
    await sleep(300);
    for (const seen of [seenB, seenC, seenG]) {
      const chats = seen.filter(([t]) => t === 'chat').map(([, m]) => m);
      expect(chats).toEqual([{ from: 'Bob', text: '/gm announce free gold', channel: 'zone' }, { from: 'Bob', text: '/gx announce free gold', channel: 'zone' }]);
      expect(seen.some(([t]) => t === 'announce' || t === 'notice')).toBe(false);
      expect(JSON.stringify(seen)).not.toContain('grant gold');
    }
    const rows = await audit(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gmAccount: bob.accountId, command: 'denied', ok: false, target: null, args: { text: '/gm announce free gold' } });
    // a game master's own /gm line goes to nobody else; its ordinary chat carries the badge
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm help')).toBe(GM_HELP);
    await sleep(CHAT_MIN_INTERVAL_MS + 50);
    say(g.room, 'hello');
    await waitFor(() => seenB.filter(([t]) => t === 'chat').length === 3);
    expect(seenB.filter(([t]) => t === 'chat').at(-1)![1]).toEqual({ from: 'Gail', text: 'hello', channel: 'zone', gm: true });
    expect(seenB.some(([, m]) => JSON.stringify(m).includes('/gm help'))).toBe(false);
    expect(seenG.some(([t, m]) => t === 'chat' && m.text === '/gm help')).toBe(false);
  }, 20000);

  it('a GM announce reaches every room and instance; a second within 30 s is refused and audited', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob'), cara = await accountFor(store, 'Cara');
    const g = await joinGrove(url, gail.token);
    await saveAs(store, bob.accountId, { zone: 'greenway', ...zoneDef('greenway').spawn });
    const b = await joinZone(url, bob.token, 'greenway');
    const c = await intoLampfall(url, store, cara);
    const got = [g, b, c].map((x) => collect(x.room, 'announce'));
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm announce The <b>lamps</b> are lit')).toMatch(/announced/i);
    await waitFor(() => got.every((l) => l.length === 1), 3000);
    for (const l of got) expect(l[0]).toEqual({ text: 'The <b>lamps</b> are lit', event: null }); // plain text, as typed (clients set it as text)
    expect(await gm(g.room, notices, '/gm announce again')).toMatch(new RegExp(`${GM_ANNOUNCE_EVERY_S}|wait`, 'i'));
    await sleep(200);
    expect(got.every((l) => l.length === 1)).toBe(true);
    const rows = (await audit(store)).filter((r) => r.command === 'announce');
    expect(rows.map((r) => [r.gmAccount, r.ok, (r.args as any).text])).toEqual([[gail.accountId, true, 'The <b>lamps</b> are lit'], [gail.accountId, false, 'again']]);
  }, 30000);

  it('grant gold, item and costume to an online adventurer in another zone: one queue write each, a notice, an audit row', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob');
    const g = await joinGrove(url, gail.token);
    await saveAs(store, bob.accountId, { zone: 'greenway', ...zoneDef('greenway').spawn });
    const b = await joinZone(url, bob.token, 'greenway');
    const bobNotices = collect(b.room, 'notice'), invs = collect(b.room, 'inventory');
    await waitFor(() => invs.length > 0); // the join's view (and its starter-kit write-back) first
    await sleep(200);
    const writes = vi.spyOn(store, 'writeInventory');
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm grant gold 250 bob')).toMatch(/gave Bob 250 gold/);
    expect(await gm(g.room, notices, '/gm grant item hedgecutter Bob')).toMatch(/gave Bob Hedgecutter/);
    expect(await gm(g.room, notices, '/gm grant costume straw_sunhat Bob')).toMatch(/gave Bob Straw Sunhat/);
    await waitFor(() => bobNotices.length === 3);
    expect(bobNotices.map((n) => n.text)).toEqual(['A game master gave you 250 gold', 'A game master gave you Hedgecutter', 'A game master gave you Straw Sunhat']);
    expect(writes).toHaveBeenCalledTimes(3);
    const a = await store.getOrCreateAdventurer(bob.accountId);
    expect(a.gold).toBe(250);
    expect(a.inventory.bag.filter((i) => i.item === 'hedgecutter')).toHaveLength(1);
    expect(a.inventory.wardrobe).toEqual(['straw_sunhat']);
    await waitFor(() => invs.at(-1)?.wardrobe?.includes('straw_sunhat'));
    expect(invs.at(-1).gold).toBe(250);
    // again: an owned costume is refused, nothing written
    expect(await gm(g.room, notices, '/gm grant costume straw_sunhat Bob')).toMatch(/already has/i);
    expect(writes).toHaveBeenCalledTimes(3);
    // unknown target: a clear error, for the GM only
    expect(await gm(g.room, notices, '/gm grant gold 5 Nobody')).toMatch(/no adventurer named Nobody/i);
    const rows = (await audit(store)).filter((r) => r.command.startsWith('grant'));
    expect(rows.map((r) => [r.command, r.target, r.ok])).toEqual([
      ['grant gold', 'bob', true], ['grant item', 'Bob', true], ['grant costume', 'Bob', true], ['grant costume', 'Bob', false], ['grant gold', 'Nobody', false],
    ]);
    expect(rows[0]!.args).toMatchObject({ amount: 250, name: 'bob' });
  }, 20000);

  it('grant to an offline adventurer lands once even when two grants race', async () => {
    const { url, store } = await start(['Gail', 'Gus']);
    const gail = await accountFor(store, 'Gail'), gus = await accountFor(store, 'Gus'), bob = await accountFor(store, 'Bob');
    const bobAdv = await store.getOrCreateAdventurer(bob.accountId);
    const g1 = await joinGrove(url, gail.token), g2 = await joinGrove(url, gus.token);
    const n1 = collect(g1.room, 'notice'), n2 = collect(g2.room, 'notice');
    // a Seal lands in the middle of the first write: that write is stale and tried again on the truth
    const write = store.writeInventory.bind(store);
    let bumped = false;
    vi.spyOn(store, 'writeInventory').mockImplementation(async (id, expect, w) => {
      if (!bumped && id === bobAdv.id) { bumped = true; await store.awardSeal(id, '2026-11-12'); }
      return write(id, expect, w);
    });
    say(g1.room, '/gm grant gold 7 Bob');
    say(g2.room, '/gm grant item hedgecutter Bob');
    await waitFor(() => n1.length > 0 && n2.length > 0, 3000);
    expect(n1[0].text).toMatch(/gave Bob 7 gold/);
    expect(n2[0].text).toMatch(/gave Bob Hedgecutter/);
    const a = await store.getOrCreateAdventurer(bob.accountId);
    expect(a.gold).toBe(7);
    expect(a.seals).toBe(1);
    expect(a.inventory.bag.filter((i) => i.item === 'hedgecutter')).toHaveLength(1);
    // the same grant retried (same key) lands once
    expect(await store.grantOffline('Bob', { gold: 3, key: 'gm:retry-once-0001' })).toBe('done');
    expect(await store.grantOffline('bob', { gold: 3, key: 'gm:retry-once-0001' })).toBe('done');
    expect((await store.getOrCreateAdventurer(bob.accountId)).gold).toBe(10);
    // when Bob joins, he holds everything
    const b = await joinGrove(url, bob.token);
    const invs = collectFromJoin(b.room, 'inventory');
    await waitFor(() => invs.length > 0);
    expect(invs.at(-1).gold).toBe(10);
    expect(invs.at(-1).seals).toBe(1);
  }, 20000);

  it('event award gives an event costume that cannot be bought', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob'), cara = await accountFor(store, 'Cara');
    const g = await joinGrove(url, gail.token), b = await joinGrove(url, bob.token);
    const notices = collect(g.room, 'notice'), announces = collect(b.room, 'announce');
    expect(await gm(g.room, notices, '/gm event award starfall_regalia Bob')).toMatch(/no event/i);
    expect(await gm(g.room, notices, '/gm event start Lantern Night')).toMatch(/Lantern Night/);
    await waitFor(() => announces.length === 1);
    expect(announces[0]).toEqual({ text: 'Event: Lantern Night', event: 'Lantern Night' });
    expect(((await (await fetch(`${url}/healthz`)).json()) as any).event).toBe('Lantern Night');
    expect(await gm(g.room, notices, '/gm event award starfall_regalia Bob Cara Nobody')).toMatch(/Bob.*Cara.*Nobody/s);
    expect((await store.getOrCreateAdventurer(bob.accountId)).inventory.wardrobe).toEqual(['starfall_regalia']);
    expect((await store.getOrCreateAdventurer(cara.accountId)).inventory.wardrobe).toEqual(['starfall_regalia']); // offline
    const rows = (await audit(store)).filter((r) => r.command === 'event award');
    expect(rows.map((r) => [r.target, r.ok])).toEqual([['Bob', false], ['Bob', true], ['Cara', true], ['Nobody', false]]);
    expect(rows[1]!.args).toMatchObject({ costume: 'starfall_regalia', event: 'Lantern Night', eventGrant: true });
    // Bob cannot buy one (event only), even at the Tailor
    const refused = collect(b.room, 'invRefused');
    sendInv(b.room, { op: 'buyCostume', costume: 'beacon_halo' });
    await waitFor(() => refused.length === 1);
    expect(refused[0].reason).toMatch(/unknown|where/);
    expect(await gm(g.room, notices, '/gm event end')).toMatch(/ended/i);
    expect(((await (await fetch(`${url}/healthz`)).json()) as any).event).toBeNull();
  }, 20000);

  it('tp moves the GM; tp to someone in another zone is refused', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob'), cara = await accountFor(store, 'Cara');
    await saveAs(store, bob.accountId, { x: 4, z: -11 });
    await saveAs(store, cara.accountId, { zone: 'greenway', ...zoneDef('greenway').spawn });
    const g = await joinGrove(url, gail.token);
    await joinGrove(url, bob.token);
    await joinZone(url, cara.token, 'greenway');
    const notices = collect(g.room, 'notice'), corrects = collect(g.room, 'correct');
    expect(await gm(g.room, notices, '/gm tp Bob')).toMatch(/moved/i);
    expect(corrects.at(-1)).toMatchObject({ x: 4, z: -11 });
    await waitFor(() => Math.abs(me(g.room).x - 4) < 0.05 && Math.abs(me(g.room).z + 11) < 0.05);
    expect(await gm(g.room, notices, '/gm tp -3 -12')).toMatch(/moved/i);
    expect(corrects.at(-1)).toMatchObject({ x: -3, z: -12, y: groveTownSurface(-3, -12)! + 0 });
    expect(await gm(g.room, notices, '/gm tp 3 -2')).toMatch(/no ground/i); // the statue
    // its moves go on from there (the server's own position)
    await walk(g.room, { x: -3, z: -12 }, { x: -3.4, z: -12 });
    await waitFor(() => Math.abs(me(g.room).x + 3.4) < 0.05);
    expect(await gm(g.room, notices, '/gm tp Cara')).toMatch(/not here/i);
    expect(await gm(g.room, notices, '/gm tp 9000 9000')).toMatch(/no ground/i);
    expect(await gm(g.room, notices, '/gm tp Nobody')).toMatch(/not online/i);
    // the move is saved like any other
    await g.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(gail.accountId)).x === -3.4);
    const rows = (await audit(store)).filter((r) => r.command === 'tp');
    expect(rows.map((r) => r.ok)).toEqual([true, true, false, false, false, false]);
  }, 20000);

  it('tp is refused in an instance', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail');
    const i = await intoLampfall(url, store, gail);
    const notices = collect(i.room, 'notice');
    expect(await gm(i.room, notices, '/gm tp 0 0')).toMatch(/instance/i);
    expect((await store.getOrCreateAdventurer(gail.accountId))).toMatchObject({ zone: 'greenway', x: LAMPFALL_MOUTH.arrive.x, z: LAMPFALL_MOUTH.arrive.z });
  }, 20000);

  it('kick disconnects with the notice and saves', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob');
    const g = await joinGrove(url, gail.token), b = await joinGrove(url, bob.token);
    await walk(b.room, me(b.room), { x: me(b.room).x + 1.2, z: me(b.room).z });
    const to = { x: me(b.room).x, z: me(b.room).z };
    const bobNotices = collect(b.room, 'notice'), kicked = collect(b.room, 'kicked');
    let code = 0;
    b.room.onLeave((c: number) => { code = c; });
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm kick Bob shouting in the plaza')).toMatch(/kicked Bob/i);
    await waitFor(() => code !== 0, 3000);
    expect(code).toBe(4003);
    expect(bobNotices.map((n) => n.text)).toContain('Removed by a game master: shouting in the plaza');
    expect(kicked).toEqual([{ reason: 'Removed by a game master: shouting in the plaza' }]);
    const saved = await store.getOrCreateAdventurer(bob.accountId);
    expect(Math.abs(saved.x - to.x)).toBeLessThan(0.01);
    // Bob may sign in again
    const again = await joinGrove(url, bob.token);
    expect(me(again.room)).toBeTruthy();
    expect(await gm(g.room, notices, '/gm kick Nobody afk')).toMatch(/not online/i);
  }, 20000);

  it('21 commands in a minute: the 21st is refused rate', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail');
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice');
    for (let i = 0; i < GM_PER_MIN; i++) say(g.room, '/gm help');
    say(g.room, '/gm help');
    await waitFor(() => notices.length === GM_PER_MIN + 1, 4000);
    expect(notices.slice(0, GM_PER_MIN).every((n) => n.text === GM_HELP)).toBe(true);
    expect(notices.at(-1).text).toMatch(/too many/i);
    const rows = await audit(store);
    expect(rows).toHaveLength(GM_PER_MIN + 1);
    expect(rows.at(-1)).toMatchObject({ command: 'help', ok: false, result: expect.stringMatching(/too many/i) });
  }, 20000);

  it('gold beyond 100 000 a day is refused', async () => {
    const { url, store } = await start(['Gail', 'Bob']);
    const gail = await accountFor(store, 'Gail'), bob = await accountFor(store, 'Bob');
    await store.logGm({ gmAccount: gail.accountId, command: 'grant gold', target: 'Bob', args: { amount: GM_GOLD_PER_DAY - 10, name: 'Bob' }, ok: true, result: 'done' });
    await store.logGm({ gmAccount: gail.accountId, command: 'grant gold', target: 'Bob', args: { amount: 9000, name: 'Bob' }, ok: false, result: 'refused' }); // refusals do not count
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice');
    expect(await gm(g.room, notices, '/gm grant gold 10 Bob')).toMatch(/gave Bob 10 gold/);
    expect(await gm(g.room, notices, '/gm grant gold 1 Bob')).toMatch(/100000|100 000|a day/i);
    expect((await store.getOrCreateAdventurer(bob.accountId)).gold).toBe(10);
    // another game master's own day is its own; a purse that would pass GOLD_MAX takes nothing (refused, nothing lost)
    const adv = await store.getOrCreateAdventurer(bob.accountId);
    await store.writeInventory(adv.id, adv.invVersion, { inventory: adv.inventory, jobs: adv.jobs, dGold: GOLD_MAX - 10 - 5, dSeals: 0 });
    const b = await joinGrove(url, bob.token);
    const bn = collect(b.room, 'notice');
    expect(await gm(b.room, bn, '/gm grant gold 6 Bob')).toMatch(/purse/i);
    expect((await store.getOrCreateAdventurer(bob.accountId)).gold).toBe(GOLD_MAX - 5);
    say(b.room, '/gm grant gold 5 Bob'); // (to itself: the target's notice and the GM's)
    await waitFor(() => bn.some((n) => /You gave Bob 5 gold/.test(n.text)));
    expect((await store.getOrCreateAdventurer(bob.accountId)).gold).toBe(GOLD_MAX);
  }, 20000);

  it('no client message can make an account a GM', async () => {
    const { url, store } = await start();
    const bob = await accountFor(store, 'Bob'), gail = await accountFor(store, 'Gail');
    const forged = { isGm: true, is_gm: true, gm: true, role: 'gm' };
    const b = await joinGrove(url, bob.token);
    for (const type of ['move', 'chat', 'target', 'ability', 'swap', 'job', 'dodge', 'loadout', 'respawn', 'party', 'release', 'leaveInstance', 'inv', 'look', 'emote', 'gm', 'role', 'setGm']) {
      b.room.send(type, { ...forged, text: '/gm grant gold 5 Bob' });
    }
    await sleep(300);
    // routes too, with the same fields
    const post = (path: string, body: object, token?: string) => fetch(`${url}/api${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
    });
    await post('/register', { username: 'Mallory', password: 'a-long-password-1', ...forged });
    await post('/guest', forged);
    await post('/name', { name: 'Bobby', ...forged }, bob.token);
    await post('/look', { ...forged }, bob.token);
    // and the join options
    const client = new (await import('@colyseus/sdk')).Client(url);
    const again = await client.joinOrCreate('grove', { token: bob.token, ...forged });
    again.onMessage('*', () => {});
    await sleep(200);
    await again.leave();
    // a game master cannot make game masters either
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice');
    for (const line of ['/gm grant gm Bob', '/gm role grant Bob', '/gm setgm Bob', '/gm isGm Bob true']) {
      expect(await gm(g.room, notices, line)).not.toMatch(/gave|granted/i);
    }
    expect((await store.findAccountByUsername('Bob'))!.isGm).toBe(false);
    expect((await store.findAccountByUsername('Mallory'))?.isGm ?? false).toBe(false);
    expect(await store.listGms()).toEqual(['Gail']);
  }, 20000);

  it('a revoked game master loses its commands at once', async () => {
    const { url, store } = await start();
    const gail = await accountFor(store, 'Gail');
    const g = await joinGrove(url, gail.token);
    const notices = collect(g.room, 'notice'), announces = collect(g.room, 'announce');
    expect(await gm(g.room, notices, '/gm help')).toBe(GM_HELP);
    expect(await store.setGm('gail', false)).toBe(true);
    expect(await gm(g.room, notices, '/gm announce still here')).not.toBe(GM_HELP);
    await sleep(200);
    expect(announces).toHaveLength(0);
    expect((await audit(store)).at(-1)).toMatchObject({ gmAccount: gail.accountId, command: 'denied', ok: false });
  }, 20000);
});
