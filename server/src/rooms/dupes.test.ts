// Never lose, never duplicate (Review Focus 1): races between operations, disconnects, a second tab, travel
// and instance entry mid-write, replays, stale versions and store failures. Every case ends with uids unique
// across bag, bank and gear, gold conserved (Δ = loot + sales − purchases), and the store and the view agreeing.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  INV_OPS_PER_S, ITEMS, LAMPFALL_MOUTH, SMITHY_PRICE, TOWN_STALLS, newInventory, newJobsSave, zoneDef, type InventorySave, type StallId,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { InventoryQueue, WriteLock, type InvSnapshot } from './inventoryQueue';
import { applyLoot } from './rewards';
import {
  accountFor, collect, collectFromJoin, joinInstance, joinZone, opId, place, saveAs, sendInv, sleep, startServer, waitFor, walk, type TestServer,
} from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const START_GOLD = 1000;

/** A memory store whose inventory writes can be held at a gate, or made to fail. */
function gatedStore() {
  const base = createMemoryStore({ newAdventurer: { gold: START_GOLD } });
  let gate: Promise<void> | null = null, open: () => void = () => {};
  let fail = false, held = 0, writes = 0;
  const store: Store = {
    ...base,
    async writeInventory(...args) {
      if (fail) throw new Error('store down');
      if (gate) {
        held++;
        await gate;
      }
      writes++;
      return base.writeInventory(...args);
    },
  };
  return {
    store, base,
    hold() { gate = new Promise((r) => (open = r)); },
    release() { gate = null; open(); },
    failing(on: boolean) { fail = on; },
    get held() { return held; },
    get writes() { return writes; },
  };
}

async function start(store: Store, more: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ kits: true, combatSeed: 5, store, ...more });
  return server;
}

async function join(name: string, more: Parameters<typeof saveAs>[2] = {}) {
  const account = await accountFor(server!.store, name);
  if (Object.keys(more).length) await saveAs(server!.store, account.accountId, more);
  return { ...(await enter(account.token, more.zone === 'greenway' ? 'greenway' : 'grove')), ...account };
}
async function enter(token: string, zone: 'grove' | 'greenway' = 'grove') {
  const joined = await joinZone(server!.url, token, zone);
  const views = collectFromJoin(joined.room, 'inventory'), refusals = collect(joined.room, 'invRefused');
  await waitFor(() => views.length > 0);
  return { ...joined, views, refusals };
}
const atStall = (room: Room<any, any>, id: StallId) => {
  const s = TOWN_STALLS[id], d = Math.hypot(s.x, s.z);
  place(room, s.x - s.x / d, s.z - s.z / d);
};
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);

/** Every uid once across bag and bank; every gear ref to a bag uid. */
function checkUids(inv: InventorySave) {
  const uids = [...inv.bag, ...inv.bank].map((i) => i.uid);
  expect(new Set(uids).size).toBe(uids.length);
  for (const g of Object.values(inv.gear)) for (const u of Object.values(g ?? {})) expect(inv.bag.some((i) => i.uid === u)).toBe(true);
}
/** Gold from the start, by the ledger: sales of items gone from `before`, purchases of items minted since. */
function ledger(before: InventorySave, after: InventorySave, startGold: number) {
  const now = new Set([...after.bag, ...after.bank].map((i) => i.uid));
  let gold = startGold;
  for (const i of [...before.bag, ...before.bank]) if (!now.has(i.uid)) gold += ITEMS[i.item]!.sell;
  for (const i of [...after.bag, ...after.bank]) if (i.uid >= before.nextUid) gold -= ITEMS[i.item]!.price!;
  return gold;
}
/** The adventurer with five sellable T1 pieces in its bag before it joins. */
async function seeded(name: string) {
  const account = await accountFor(server!.store, name);
  const a = await stored(account.accountId);
  const inv = { ...a.inventory, bag: [...a.inventory.bag] };
  for (const item of ['hedgecutter', 'thornrunner_chest', 'thornrunner_legs', 'rootbound_head', 'hedge_buckler']) inv.bag.push({ uid: inv.nextUid++, item, dye: [0, 0] });
  await server!.store.writeInventory(a.id, a.invVersion, { inventory: inv, jobs: a.jobs, dGold: 0, dSeals: 0 });
  return { ...(await enter(account.token)), ...account, before: (await stored(account.accountId)).inventory };
}

describe('dupes', () => {
  it('50 concurrent mixed ops: uids unique, gold conserved', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await seeded('Alice');
    atStall(a.room, 'smithy');
    await sleep(1100); // a full token bucket
    const uids = a.before.bag.filter((i) => i.uid > 16).map((i) => i.uid);
    const items = ['thornrunner_feet', 'thornrunner_hands', 'hedge_buckler', 'rootbound_back'];
    for (let k = 0; k < 50; k++) {
      const u = uids[k % uids.length]!;
      const ops = [
        { op: 'sell', uid: u }, { op: 'equip', uid: u, slot: ITEMS[a.before.bag.find((i) => i.uid === u)!.item]!.slot }, { op: 'unequip', slot: 'chest' },
        { op: 'buy', stall: 'smithy', item: items[k % items.length] },
      ];
      sendInv(a.room, ops[k % ops.length] as never);
    }
    await waitFor(() => a.views.length + a.refusals.length >= 51, 5000);
    await sleep(300);
    const s = await stored(a.accountId);
    checkUids(s.inventory);
    expect(s.gold).toBe(ledger(a.before, s.inventory, START_GOLD));
    expect(a.views.at(-1).gold).toBe(s.gold);
    expect(a.refusals.filter((r) => r.reason === 'rate').length).toBeGreaterThanOrEqual(50 - INV_OPS_PER_S - 1);
  });

  it('sell while equipping the same uid: one wins, the other is refused', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await seeded('Alice');
    atStall(a.room, 'smithy');
    const chest = a.before.bag.find((i) => i.item === 'thornrunner_chest')!.uid, legs = a.before.bag.find((i) => i.item === 'thornrunner_legs')!.uid;
    sendInv(a.room, { op: 'equip', uid: chest, slot: 'chest' });
    sendInv(a.room, { op: 'sell', uid: chest });
    sendInv(a.room, { op: 'sell', uid: legs });
    sendInv(a.room, { op: 'equip', uid: legs, slot: 'legs' });
    await waitFor(() => a.refusals.length >= 2, 3000);
    await sleep(300);
    expect(a.refusals.map((r) => [r.op, r.reason])).toEqual([['sell', 'worn'], ['equip', 'unknown']]);
    const s = await stored(a.accountId);
    checkUids(s.inventory);
    expect(s.inventory.gear.warrior!.chest).toBe(chest);
    expect(s.inventory.bag.some((i) => i.uid === legs)).toBe(false);
    expect(s.gold).toBe(START_GOLD + ITEMS.thornrunner_legs!.sell);
  });

  it('two buys with gold for one: exactly one lands', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    const s0 = await stored(a.accountId);
    await server!.store.writeInventory(s0.id, s0.invVersion, { inventory: s0.inventory, jobs: s0.jobs, dGold: SMITHY_PRICE.weapon - START_GOLD, dSeals: 0 });
    atStall(a.room, 'smithy');
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' });
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'millward_sword' });
    await waitFor(() => a.refusals.length >= 1, 3000);
    await sleep(300);
    expect(a.refusals.map((r) => r.reason)).toEqual(['gold']);
    const s = await stored(a.accountId);
    expect(s.gold).toBe(0);
    expect(s.inventory.bag.filter((i) => i.uid > 16)).toHaveLength(1);
    checkUids(s.inventory);
  });

  it('a disconnect right after buy: after rejoin the store and the view agree, and the gold left matches', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    atStall(a.room, 'smithy');
    g.hold();
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' });
    await waitFor(() => g.held > 0);
    setTimeout(() => g.release(), 300); // (the leave's save waits for the write: the session's writes never interleave)
    await a.room.leave(); // the write is in flight
    const again = await enter(a.token); // its join waits for that write
    const s = await stored(a.accountId);
    expect(s.inventory.bag.filter((i) => i.item === 'hedgecutter')).toHaveLength(1);
    expect(s.gold).toBe(START_GOLD - SMITHY_PRICE.weapon);
    expect(again.views[0].gold).toBe(s.gold);
    expect(again.views[0].bag.map((i: any) => i.uid)).toEqual(s.inventory.bag.map((i) => i.uid));
  });

  it("a second tab mid-queue: the old session's queued ops are dropped, the in-flight one lands once", async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    atStall(a.room, 'smithy');
    g.hold();
    for (const item of ['hedgecutter', 'hedge_buckler', 'thornrunner_feet', 'thornrunner_hands']) sendInv(a.room, { op: 'buy', stall: 'smithy', item });
    await waitFor(() => g.held === 1);
    const kicked = collect(a.room, 'kicked');
    setTimeout(() => g.release(), 300);
    const tab2 = await enter(a.token);
    await waitFor(() => kicked.length > 0);
    await sleep(300);
    const s = await stored(a.accountId);
    expect(s.inventory.bag.filter((i) => i.uid > 16).map((i) => i.item)).toEqual(['hedgecutter']);
    expect(s.gold).toBe(START_GOLD - SMITHY_PRICE.weapon);
    expect(tab2.views[0].gold).toBe(s.gold);
    expect(g.writes).toBe(2); // the join's write-back and the one buy
  });

  it('zone travel and instance entry mid-write: the write lands once, and the next room shows it', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice', { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    const chest = a.views[0].bag.find((i: any) => i.item === 'plain_chest').uid;
    g.hold();
    sendInv(a.room, { op: 'equip', uid: chest, slot: 'chest' }, null);
    sendInv(a.room, { op: 'unequip', slot: 'head' }, null);
    await waitFor(() => g.held === 1);
    const travels = collect(a.room, 'travel');
    setTimeout(() => g.release(), 600); // (the travel's save waits for the write in flight)
    await walk(a.room, LAMPFALL_MOUTH.arrive, { x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z }, zoneDef('greenway').surface);
    const travel = await waitFor(() => travels[0], 4000);
    const inside = await joinInstance(server!.url, a.token, travel.instance);
    const views = collectFromJoin(inside.room, 'inventory');
    await waitFor(() => views.length > 0);
    const s = await stored(a.accountId);
    expect(views[0].bag.map((i: any) => i.uid)).toEqual(s.inventory.bag.map((i) => i.uid));
    expect(g.writes).toBeLessThanOrEqual(3); // write-back, the equip (in flight); the unequip was dropped or ran
    checkUids(s.inventory);
  }, 15_000);

  it('the same kill handled twice gives one reward', async () => {
    const store = createMemoryStore();
    const account = await store.createAccount({ username: 'Alice', passwordHash: null, isGuest: true });
    const a = await store.getOrCreateAdventurer(account.id);
    const snap: InvSnapshot = { inv: a.inventory, gold: 0, seals: 0, look: a.look ?? (await import('@sg2/shared')).defaultLook(account.id), lookFree: true, version: a.invVersion };
    const queue = new InventoryQueue(snap, {
      lock: new WriteLock(), jobs: () => newJobsSave(), write: (e, w) => store.writeInventory(a.id, e, w),
      load: async () => { const b = await store.getOrCreateAdventurer(account.id); return { ...snap, inv: b.inventory, gold: b.gold, seals: b.seals, version: b.invVersion }; },
    });
    const award = { src: { kind: 'mossback' as const, zone: 'greenway' as const }, seedParts: [1, 'r', 9, 1, account.id], killKey: 'r:9:1', job: 'warrior' as const, day: '2026-11-12', x: 0, z: 0 };
    const task = () => ({
      retries: 5,
      run: (s: InvSnapshot, jobs: ReturnType<typeof newJobsSave>) => {
        const out = applyLoot({ inv: s.inv, gold: s.gold, seals: s.seals, jobs }, [award], true);
        return out.given.every((x) => x.dup) ? { kind: 'none' as const, info: null }
          : { kind: 'write' as const, info: null, write: { inventory: out.state.inv, jobs, dGold: out.dGold, dSeals: 0 }, next: { ...out.state, look: s.look, lookFree: s.lookFree } };
      },
    });
    const [r1, r2] = await Promise.all([queue.push(task()), queue.push(task())]);
    expect([r1.status, r2.status]).toEqual(['applied', 'unchanged']);
    const b = await store.getOrCreateAdventurer(account.id);
    expect(b.inventory.bag).toHaveLength(17);
    expect(b.inventory.recentKills).toEqual(['r:9:1']);
    // a second queue (another session) with a stale snapshot: re-read, and still nothing more
    const other = new InventoryQueue(snap, (queue as any).deps);
    expect((await other.push(task())).status).toBe('unchanged');
    expect((await store.getOrCreateAdventurer(account.id)).inventory.bag).toHaveLength(17);
    expect(newInventory([0, 0]).bag).toHaveLength(16);
  });

  it('a stale version from a GM write in between: retried once, nothing lost', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    // a "GM grant" straight to the store: an item and 100 gold (the session has not seen it)
    const s0 = await stored(a.accountId);
    const granted = { ...s0.inventory, bag: [...s0.inventory.bag, { uid: s0.inventory.nextUid, item: 'last_bell', dye: [0, 0] as [number, number] }], nextUid: s0.inventory.nextUid + 1 };
    await server!.store.writeInventory(s0.id, s0.invVersion, { inventory: granted, jobs: s0.jobs, dGold: 100, dSeals: 0 });
    atStall(a.room, 'smithy');
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' });
    await waitFor(() => a.views.at(-1).bag.some((i: any) => i.item === 'hedgecutter'), 3000);
    const s = await stored(a.accountId);
    expect(s.inventory.bag.map((i) => i.item)).toEqual(expect.arrayContaining(['last_bell', 'hedgecutter']));
    expect(s.gold).toBe(START_GOLD + 100 - SMITHY_PRICE.weapon);
    expect(a.views.at(-1).gold).toBe(s.gold);
    checkUids(s.inventory);
  });

  it('30 ops a second: rate after 8', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await sleep(1100);
    for (let k = 0; k < 30; k++) sendInv(a.room, { op: 'hideHead', hide: k % 2 === 0 });
    await waitFor(() => a.refusals.length >= 30 - INV_OPS_PER_S, 3000);
    await sleep(300);
    expect(a.refusals.every((r) => r.reason === 'rate' && r.text === 'Slow down a little')).toBe(true);
    expect(a.refusals.length).toBe(30 - INV_OPS_PER_S);
  });

  it('the same op id replayed after relog changes nothing, and the view is sent again', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    atStall(a.room, 'smithy');
    const id = opId();
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, id);
    await waitFor(() => a.views.at(-1).bag.some((i: any) => i.item === 'hedgecutter'));
    await a.room.leave();
    const again = await enter(a.token);
    atStall(again.room, 'smithy');
    const n = again.views.length;
    sendInv(again.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, id);
    await waitFor(() => again.views.length > n);
    const s = await stored(a.accountId);
    expect(s.inventory.bag.filter((i) => i.item === 'hedgecutter')).toHaveLength(1);
    expect(s.gold).toBe(START_GOLD - SMITHY_PRICE.weapon);
    expect(again.views.at(-1).gold).toBe(s.gold);
    expect(again.refusals).toEqual([]);
  });

  it('a save failure mid-op: no partial state, and the client is told', async () => {
    const g = gatedStore();
    await start(g.store);
    const a = await join('Alice');
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    atStall(a.room, 'smithy');
    const before = await stored(a.accountId);
    g.failing(true);
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' });
    await waitFor(() => a.refusals.length > 0);
    expect(a.refusals[0]).toMatchObject({ op: 'buy', reason: 'save' });
    await waitFor(() => a.views.length >= 2);
    expect(a.views.at(-1).gold).toBe(START_GOLD);
    expect(a.views.at(-1).bag.some((i: any) => i.item === 'hedgecutter')).toBe(false);
    const after = await stored(a.accountId);
    expect(after).toMatchObject({ gold: before.gold, invVersion: before.invVersion });
    g.failing(false);
    sendInv(a.room, { op: 'buy', stall: 'smithy', item: 'hedgecutter' });
    await waitFor(() => a.views.at(-1).bag.some((i: any) => i.item === 'hedgecutter'));
    expect((await stored(a.accountId)).gold).toBe(START_GOLD - SMITHY_PRICE.weapon);
  });
});

describe('the inventory queue', () => {
  it('a settle that throws never stalls the queue; a closed queue drops what waits and lets the running write land', async () => {
    const errors: unknown[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let version = 0, writes = 0;
    const snap: InvSnapshot = { inv: newInventory([0, 0]), gold: 0, seals: 0, look: (await import('@sg2/shared')).defaultLook('x'), lookFree: true, version: 0 };
    const q = new InventoryQueue(snap, {
      lock: new WriteLock(), jobs: () => newJobsSave(), onError: (e) => errors.push(e),
      load: async () => ({ ...snap, version }),
      write: async () => { await gate; writes++; version++; return { version, gold: 0, seals: 0 }; },
    });
    const task = (settle?: () => void) => ({
      retries: 1, settle,
      run: (s: InvSnapshot, jobs: ReturnType<typeof newJobsSave>) => ({ kind: 'write' as const, info: null, write: { inventory: s.inv, jobs, dGold: 0, dSeals: 0 }, next: { inv: s.inv, gold: 0, seals: 0, jobs, look: s.look, lookFree: true } }),
    });
    const first = q.push(task(() => { throw new Error('boom'); }));
    const second = q.push(task());
    const third = q.push(task());
    await sleep(20);
    q.close();
    expect((await third).status).toBe('dropped');
    expect((await second).status).toBe('dropped');
    release();
    expect((await first).status).toBe('applied');
    await q.idle();
    expect(writes).toBe(1);
    expect(errors).toHaveLength(1);
    expect((await q.push(task())).status).toBe('dropped');
  });
});
