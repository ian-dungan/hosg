// Task 6 review round 1: inventory writes and saves never undo each other (I1), loot is never dropped by a full
// queue (I2), a quick rejoin never misses or overwrites with an offline loot write (I3), and the minor items:
// the creator's dye write-back leaves jobs alone and updates an online look, a re-kit waits for the fight to
// end, gear/talent/pick changes are refused inside a sealed boss arena (P5-h), and the kill-key memory.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  GUILD_BOARD, RECENT_KILLS, RESPEC_PRICE, defaultLook, encodeLook, lampfallArena, lampfallLayout, levelForXp, totalTo, worldOf, zoneDef,
  type CampSpawn, type JobId, type Surface, type ZoneDef,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { InvWrite, Store } from '../store/types';
import {
  accountFor, collect, collectFromJoin, intoLampfall, joinZone, killFor, place, saveAs, sendInv, serverRoom, sleep, startServer, trackLooks, waitFor, walk,
  SECRET, type TestServer,
} from './testHelpers';
import { signToken } from '../auth/tokens';
import { killEnemy } from '../../../shared/src/combat/adventurer';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const THORNLINGS: CampSpawn[] = [0, 1, 2].map((i) => ({ kind: 'thornling', x: i * 8, z: -40, facing: 0 }));

async function start(over: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ kits: true, combatSeed: 3, serverSeed: 7, store: createMemoryStore(), reconnectSeconds: 1, ...over });
  return server;
}
const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);
const warrior = (xp: number, talents: string[] = []) => ({
  curve: 2 as const, current: 'warrior' as JobId,
  jobs: { warrior: { level: levelForXp(xp), xp, picks: ['mend', 'bulwark'] as never, talents, outfit: null } },
});

/** An account whose adventurer is stored with these jobs, gold, wardrobe and used free respec (before it joins). */
async function prepared(name: string, o: { jobs?: ReturnType<typeof warrior>; gold?: number; wardrobe?: string[]; freeRespecUsed?: JobId[]; at?: { x: number; z: number } } = {}) {
  const store = server!.store;
  const account = await accountFor(store, name);
  if (o.jobs || o.at) await saveAs(store, account.accountId, { ...(o.jobs ? { jobs: o.jobs } : {}), ...(o.at ?? {}) });
  const a = await store.getOrCreateAdventurer(account.accountId);
  const inventory = { ...a.inventory, wardrobe: (o.wardrobe ?? []) as never, freeRespecUsed: o.freeRespecUsed ?? [] };
  await store.writeInventory(a.id, a.invVersion, { inventory, jobs: a.jobs, dGold: o.gold ?? 0, dSeals: 0 });
  return account;
}
async function joined(account: { token: string }, zone: 'grove' | 'greenway' = 'grove') {
  const j = await joinZone(server!.url, account.token, zone);
  const views = collectFromJoin(j.room, 'inventory'), refusals = collect(j.room, 'invRefused');
  await waitFor(() => views.length > 0);
  await sleep(100); // the join's own write-back first
  return { ...j, views, refusals };
}

/** Holds every inventory write of `adventurerId` until `open()` (the write is then made for real). */
function holdWrites(store: Store, adventurerId: string) {
  const real = store.writeInventory.bind(store);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let held = 0;
  const spy = vi.spyOn(store, 'writeInventory').mockImplementation(async (id: string, expect: number, w: InvWrite) => {
    if (id === adventurerId) { held++; await gate; }
    return real(id, expect, w);
  });
  return { open: () => release(), held: () => held, spy };
}

describe('Task 6 review round 1', () => {
  it('I1: a paid respec, then the tab closes at once: the gold is spent and the talents are cleared in the store', async () => {
    await start();
    const acc = await prepared('Alice', { jobs: warrior(totalTo(7), ['warrior_1a', 'warrior_2a']), gold: 500, freeRespecUsed: ['warrior'], at: { x: GUILD_BOARD.x + 1, z: GUILD_BOARD.z } });
    const a = await joined(acc);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    sendInv(a.room, { op: 'respec' });
    await waitFor(() => hold.held() === 1);
    const left = a.room.leave();
    await sleep(100); // the leave's save is built now, and waits for the lock
    hold.open();
    await left;
    await waitFor(async () => (await stored(acc.accountId)).gold === 500 - 2 * RESPEC_PRICE);
    await sleep(200);
    const s = await stored(acc.accountId);
    expect(s.gold).toBe(500 - 2 * RESPEC_PRICE);
    expect(s.jobs.jobs.warrior!.talents).toEqual([]);
  }, 15_000);

  it('I1: a paid respec, then a travel at once: the travel save keeps the cleared talents', async () => {
    await start({ openExits: { grove: ['greenway'] } });
    const exit = zoneDef('grove').exits[0]!;
    const near = { x: exit.x - exit.r - 1.5, z: exit.z };
    const acc = await prepared('Bea', { jobs: warrior(totalTo(7), ['warrior_1a']), gold: 500, freeRespecUsed: ['warrior'], at: { x: GUILD_BOARD.x + 1, z: GUILD_BOARD.z } });
    const a = await joined(acc);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    sendInv(a.room, { op: 'respec' });
    await waitFor(() => hold.held() === 1);
    const ack = place(a.room, near.x, near.z);
    const travels = collect(a.room, 'travel');
    void walk(a.room, near, { x: exit.x, z: exit.z }, zoneDef('grove').surface, ack);
    await sleep(600);
    hold.open();
    await waitFor(() => travels.length > 0, 5000);
    await waitFor(async () => (await stored(acc.accountId)).zone === 'greenway');
    await sleep(200);
    const s = await stored(acc.accountId);
    expect(s.gold).toBe(500 - RESPEC_PRICE);
    expect(s.jobs.jobs.warrior!.talents).toEqual([]);
  }, 15_000);

  it('I1: a costume worn, then a second tab kicks the first: the outfit stays worn', async () => {
    await start();
    const acc = await prepared('Cid', { wardrobe: ['orchard_smock'] });
    const a = await joined(acc);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    sendInv(a.room, { op: 'wear', slot: 'body', costume: 'orchard_smock' });
    await waitFor(() => hold.held() === 1);
    const second = joinZone(server!.url, acc.token, 'grove');
    await sleep(100);
    hold.open();
    const b = await second;
    const jobsMsgs = collectFromJoin(b.room, 'jobs');
    await waitFor(() => jobsMsgs.length > 0);
    expect(jobsMsgs.at(-1).jobs.warrior.outfit).toMatchObject({ body: 'orchard_smock' });
    expect((await stored(acc.accountId)).jobs.jobs.warrior!.outfit).toMatchObject({ body: 'orchard_smock' });
  }, 15_000);

  it('I2: loot is never refused by a full queue while the store stalls', async () => {
    await start({ lootAlways: true, zones: { grove: { surface: flat, ground: flat, sight: () => true, camps: THORNLINGS } as Partial<ZoneDef> } });
    const acc = await prepared('Dot', { at: { x: 0, z: -36 } });
    const a = await joined(acc);
    const room = serverRoom(a.room);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    // a write that stalls, and a full queue behind it
    void room.enqueueInventory(acc.accountId, { retries: 0, run: (s, jobs) => ({ kind: 'write', info: null, write: { inventory: s.inv, jobs, dGold: 1, dSeals: 0 }, next: { inv: s.inv, gold: s.gold + 1, seals: s.seals, jobs, look: s.look, lookFree: s.lookFree } }) });
    await waitFor(() => hold.held() === 1);
    for (let i = 0; i < 70; i++) void room.enqueueInventory(acc.accountId, { retries: 0, run: () => ({ kind: 'none', info: null }) });
    const loot = collect(a.room, 'loot');
    const id = [...worldOf(room.combat).enemies.values()].find((e) => e.kind === 'thornling')!.id;
    killFor(a.room, id, [{ room: a.room }]);
    await sleep(300);
    hold.open();
    await waitFor(() => loot.length > 0, 5000);
    const s = await stored(acc.accountId);
    expect(s.inventory.bag.some((i) => i.uid === loot[0].items[0].uid)).toBe(true);
  }, 15_000);

  it('I3: leave with loot in flight, rejoin at once, change talents: the loot lands and the talents stay', async () => {
    await start({ lootAlways: true, zones: { grove: { surface: flat, ground: flat, sight: () => true, camps: THORNLINGS } as Partial<ZoneDef> } });
    const acc = await prepared('Eve', { jobs: warrior(totalTo(4)), at: { x: GUILD_BOARD.x + 1, z: GUILD_BOARD.z } });
    const adv = await stored(acc.accountId);
    const a = await joined(acc);
    const real = server!.store.writeInventory.bind(server!.store);
    let failed = 0;
    vi.spyOn(server!.store, 'writeInventory').mockImplementation(async (id, expect, w) => {
      if (id === adv.id && failed === 0) { failed++; throw new Error('the store is down for a moment'); }
      return real(id, expect, w);
    });
    const room = serverRoom(a.room);
    const enemy = [...worldOf(room.combat).enemies.values()].find((e) => e.kind === 'thornling')!;
    killFor(a.room, enemy.id, [{ room: a.room }]);
    await waitFor(() => failed === 1);
    const kept = vi.spyOn(console, 'error').mockImplementation(() => {});
    await a.room.leave();
    const b = await joined(acc);
    sendInv(b.room, { op: 'talent', row: 0, choice: 1 });
    await waitFor(async () => (await stored(acc.accountId)).jobs.jobs.warrior!.talents.length === 1);
    await sleep(1200); // past the loot's retry
    const s = await stored(acc.accountId);
    expect(s.jobs.jobs.warrior!.talents).toEqual(['warrior_1b']);
    expect(s.inventory.recentKills.length).toBe(1); // the loot landed (once)
    kept.mockRestore();
  }, 15_000);

  it('the creator dye write-back leaves jobs alone, and an online adventurer shows its new look at once', async () => {
    await start();
    const acc = await accountFor(server!.store, 'Fay');
    const a = await joined(acc);
    const looks = trackLooks(a.room);
    const eid = me(a.room).eid;
    await waitFor(() => looks.look(eid));
    const look = { ...defaultLook('someone else'), outfit: { dye1: 3, dye2: 4 } };
    const writes = vi.spyOn(server!.store, 'writeInventory');
    const res = await fetch(`${server!.url}/api/look`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken(acc.accountId, SECRET)}` }, body: JSON.stringify({ look }),
    });
    expect(res.status).toBe(200);
    await waitFor(() => looks.look(eid) === encodeLook(look), 3000);
    for (const call of writes.mock.calls) expect(call[2].jobs).toBeUndefined();
  }, 15_000);

  it('an equip that lands after a fight began re-kits only once the fight is over', async () => {
    await start();
    const acc = await prepared('Gus');
    const a = await joined(acc);
    const w = worldOf(serverRoom(a.room).combat);
    const adv = w.adventurers.get(me(a.room).eid)!;
    const chest = a.views.at(-1).bag.find((i: any) => i.item === 'plain_chest').uid;
    // a T1 chest in the bag first
    const s0 = await stored(acc.accountId);
    const inv = { ...s0.inventory, bag: [...s0.inventory.bag, { uid: s0.inventory.nextUid, item: 'thornrunner_chest', dye: [0, 0] as [number, number] }], nextUid: s0.inventory.nextUid + 1 };
    void chest;
    await server!.store.writeInventory(s0.id, s0.invVersion, { inventory: inv, jobs: s0.jobs, dGold: 0, dSeals: 0 });
    serverRoom(a.room).refreshInventory(acc.accountId);
    await waitFor(() => a.views.at(-1).bag.some((i: any) => i.item === 'thornrunner_chest'));
    const before = { ...adv.stats };
    const hold = holdWrites(server!.store, s0.id);
    sendInv(a.room, { op: 'equip', uid: s0.inventory.nextUid, slot: 'chest' });
    await waitFor(() => hold.held() === 1);
    adv.lastCombatAt = w.now; // a fight began while the write was in flight
    hold.open();
    await waitFor(() => a.views.at(-1).bag.find((i: any) => i.item === 'thornrunner_chest')?.worn.includes('warrior'));
    await sleep(200);
    expect(adv.stats).toEqual(before);
    adv.lastCombatAt = -Infinity;
    await waitFor(() => adv.stats.defence > before.defence, 3000);
  }, 15_000);

  it('P5-h: gear, talent and pick changes are refused inside a sealed boss arena', async () => {
    await start();
    const acc = await prepared('Hal', { jobs: warrior(totalTo(4)) });
    const i = await intoLampfall(server!.url, server!.store, acc);
    const room = serverRoom(i.room) as any;
    const arena = lampfallArena('wickhound');
    const L = lampfallLayout();
    let spot: { x: number; z: number } | undefined;
    for (const r of L.rooms) if (arena(r.x, r.z) && room.zone.surface(r.x, r.z) !== null) spot = { x: r.x, z: r.z };
    expect(spot).toBeTruthy();
    // no enemy left to fight (so every refusal below is the arena's, not a fight's)
    const w = worldOf(room.combat);
    for (const e of [...w.enemies.values()]) if (e.alive) killEnemy(w, e, w.now);
    await sleep(200);
    place(i.room, spot!.x, spot!.z);
    w.adventurers.get(me(i.room).eid)!.lastCombatAt = -Infinity;
    room.inst.sealed = 'wickhound';
    const refusals = collect(i.room, 'invRefused'), refused = collect(i.room, 'refused');
    sendInv(i.room, { op: 'unequip', slot: 'chest' });
    await sleep(150);
    sendInv(i.room, { op: 'talent', row: 0, choice: 0 });
    await waitFor(() => refusals.length === 2);
    expect(refusals.map((r) => r.reason)).toEqual(['combat', 'combat']);
    i.room.send('loadout', { picks: ['bulwark', 'mend'] });
    await waitFor(() => refused.length === 1);
    expect(refused[0]).toEqual({ action: 'loadout', reason: 'in-combat' });
    // between pulls but unsealed: allowed again
    room.inst.sealed = null;
    sendInv(i.room, { op: 'unequip', slot: 'chest' });
    await sleep(300);
    expect(refusals.slice(2).map((r) => r.reason)).not.toContain("combat");
  }, 20_000);

  it('a store call that times out gives the owner refusal save, and the stored truth', async () => {
    await start();
    const acc = await prepared('Ida', { wardrobe: ['orchard_smock'] });
    const a = await joined(acc);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(server!.store, 'writeInventory').mockRejectedValueOnce(new Error('canceling statement due to statement timeout'));
    const n = a.views.length;
    sendInv(a.room, { op: 'wear', slot: 'body', costume: 'orchard_smock' });
    await waitFor(() => a.refusals.length > 0 && a.views.length > n);
    expect(a.refusals[0].reason).toBe('save');
    quiet.mockRestore();
  }, 15_000);

  it('kill keys: 256 remembered', () => {
    expect(RECENT_KILLS).toBe(256);
  });
});
