// Personal loot and xp in the zone room (Plan 5): who is credited (the engine's minimum-contribution credit and
// Plan 4's party share), rolls per adventurer into its own bag, a full bag, the purse at GOLD_MAX, the daily
// guaranteed drop, pack clears in an instance, catch-up xp and level-ups.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  BAG_SLOTS, CATCH_UP_MULT, CLEAR_XP, GOLD_MAX, ITEMS, KILL_XP, NO_CREDIT_TEXT, PACK_ENCOUNTERS, bagFullText, kitFor, levelForXp, newInventory, purseFullText, totalTo, worldOf,
  type CampSpawn, type InvState, type InventorySave, type JobId, type Surface, type ZoneDef,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { applyLoot, type LootAward } from './rewards';
import { accountFor, collect, collectFromJoin, intoLampfall, joinZone, killFor, partyUp, saveAs, serverRoom, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatZone = (camps: CampSpawn[]): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const THORNLINGS: CampSpawn[] = [0, 1, 2, 3, 4, 5].map((i) => ({ kind: 'thornling', x: i * 8, z: -40, facing: 0 }));

async function start(opts: { always?: boolean; store?: Store } = {}) {
  server = await startServer({
    kits: true, combatSeed: 3, serverSeed: 12345, lootAlways: opts.always ?? true, store: opts.store ?? createMemoryStore(),
    zones: { grove: flatZone(THORNLINGS), greenway: flatZone([]) },
  });
  return server;
}

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const jobsAt = (xp: Partial<Record<JobId, number>>, current: JobId = 'warrior') => ({
  curve: 2 as const, current,
  jobs: Object.fromEntries(Object.entries(xp).map(([j, x]) => [j, { level: levelForXp(x!), xp: x, picks: j === 'warrior' ? ['mend', 'bulwark'] : ['field_dressing', 'pinning_shot'], talents: [], outfit: null }])) as never,
});
async function join(name: string, at: { x: number; z: number }, more: Parameters<typeof saveAs>[2] = {}) {
  const account = await accountFor(server!.store, name);
  await saveAs(server!.store, account.accountId, { x: at.x, z: at.z, ...more });
  const joined = await joinZone(server!.url, account.token, 'grove');
  const views = collectFromJoin(joined.room, 'inventory'), loot = collect(joined.room, 'loot'), notices = collect(joined.room, 'notice');
  await waitFor(() => views.length > 0);
  return { ...joined, ...account, views, loot, notices };
}
/** The engine id of the n-th thornling (by camp order). */
const thornling = (room: Room<any, any>, n = 0) => [...worldOf(serverRoom(room).combat).enemies.values()].filter((e) => e.kind === 'thornling')[n]!.id;
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);

describe('loot', () => {
  it('two adventurers credited for one kill each roll their own loot; a 2% tagger gets nothing', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 }), b = await join('Bob', { x: 1, z: -36 }), c = await join('Cara', { x: 2, z: -36 });
    const xpC = collect(c.room, 'jobXp');
    await killFor(a.room, thornling(a.room), [{ room: a.room, threat: 50 }, { room: b.room, threat: 50 }, { room: c.room, threat: 1 }], 200);
    await waitFor(() => a.loot.length > 0 && b.loot.length > 0);
    for (const j of [a, b]) {
      expect(j.loot).toHaveLength(1);
      expect(j.loot[0].items).toHaveLength(1);
      expect(ITEMS[j.loot[0].items[0].item]!.tier).toBe(1);
      expect(j.loot[0].gold).toBeGreaterThanOrEqual(1);
    }
    // each rolled its own (keyed by account): the stores agree with what they were told
    for (const j of [a, b]) expect((await stored(j.accountId)).inventory.bag.some((i) => i.uid === j.loot[0].items[0].uid)).toBe(true);
    await waitFor(() => c.notices.some((n) => n.text === NO_CREDIT_TEXT));
    await sleep(200);
    expect(c.loot).toEqual([]);
    expect(xpC).toEqual([]);
    expect((await stored(c.accountId)).gold).toBe(0);
  });

  it('a party member 30 m away gets party-share loot; a stranger does not', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 }), m = await join('Mira', { x: 0, z: -6 }), s = await join('Sam', { x: 2, z: -6 });
    await partyUp(a.room, m.room, 'Mira');
    killFor(a.room, thornling(a.room), [{ room: a.room }]);
    await waitFor(() => a.loot.length > 0 && m.loot.length > 0);
    await sleep(200);
    expect(s.loot).toEqual([]);
    expect(m.loot[0].items).toHaveLength(1);
  });

  it('loot lands in the bag with a loot message to that adventurer only', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 }), b = await join('Bob', { x: 1, z: -36 });
    const id = thornling(a.room);
    const e = worldOf(serverRoom(a.room).combat).enemies.get(id)!;
    killFor(a.room, id, [{ room: a.room }]);
    await waitFor(() => a.loot.length > 0);
    const msg = a.loot[0];
    expect(msg).toMatchObject({ soldFor: 0, x: e.x, z: e.z });
    await waitFor(() => a.views.at(-1).bag.some((i: any) => i.uid === msg.items[0].uid));
    expect(a.views.at(-1).gold).toBe(msg.gold);
    await sleep(200);
    expect(b.loot).toEqual([]);
    // saved in the same write: a relog shows it, with no second message and no second item
    await a.room.leave();
    const again = await joinZone(server!.url, a.token, 'grove');
    const views = collectFromJoin(again.room, 'inventory'), loot2 = collect(again.room, 'loot');
    await waitFor(() => views.length > 0);
    expect(views[0].bag.filter((i: any) => i.item === msg.items[0].item)).toHaveLength(1);
    expect(views[0].gold).toBe(msg.gold);
    await sleep(200);
    expect(loot2).toEqual([]);
  });

  it('a full bag sells the drop and says so', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 });
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    const s = await stored(a.accountId);
    const inv: InventorySave = { ...s.inventory, bag: [...s.inventory.bag] };
    while (inv.bag.length < 16 + BAG_SLOTS) inv.bag.push({ uid: inv.nextUid++, item: 'rootbound_feet', dye: [0, 0] });
    await server!.store.writeInventory(s.id, s.invVersion, { inventory: inv, jobs: s.jobs, dGold: 0, dSeals: 0 });
    serverRoomSession(a.room).queue.markStale();
    killFor(a.room, thornling(a.room), [{ room: a.room }]);
    await waitFor(() => a.loot.length > 0);
    const msg = a.loot[0];
    expect(msg.items).toEqual([]);
    expect(msg.soldFor).toBeGreaterThan(0);
    await waitFor(() => a.notices.some((n) => /^Your bag is full: .+ was sold for \d+ gold$/.test(n.text)));
    const line = a.notices.find((n) => n.text.startsWith('Your bag'))!.text;
    expect(Object.values(ITEMS).some((it) => line === bagFullText(it!.name, msg.soldFor) && it!.sell === msg.soldFor)).toBe(true);
    expect((await stored(a.accountId)).gold).toBe(msg.gold + msg.soldFor);
  });

  it('gold at GOLD_MAX: the extra is dropped with a notice, never above the cap', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 });
    await waitFor(async () => (await stored(a.accountId)).invVersion >= 1);
    const s = await stored(a.accountId);
    await server!.store.writeInventory(s.id, s.invVersion, { inventory: s.inventory, jobs: s.jobs, dGold: GOLD_MAX, dSeals: 0 });
    serverRoomSession(a.room).queue.markStale();
    killFor(a.room, thornling(a.room), [{ room: a.room }]);
    await waitFor(() => a.loot.length > 0);
    await waitFor(() => a.notices.some((n) => n.text === purseFullText(a.loot[0].gold)));
    expect((await stored(a.accountId)).gold).toBe(GOLD_MAX);
  });

  it('the first Wickhound kill of a UTC day drops; the second that day may not', () => {
    // (rolled exactly as the room rolls it: applyLoot over the queued state)
    const day = '2026-11-12';
    let state: InvState = { inv: newInventory([0, 0]), gold: 0, seals: 0, jobs: jobsAt({ warrior: 0 }) };
    const award = (k: number): LootAward => ({ src: { kind: 'wickhound', zone: 'lampfall' }, seedParts: [1, 'room', 7, k, 'acct'], killKey: `room:7:${k}`, job: 'warrior', day, x: 0, z: 0 });
    const first = applyLoot(state, [award(1)]);
    expect(first.given[0]!.items).toHaveLength(1);
    expect(first.state.inv.lootDays.wickhound).toBe(day);
    state = first.state;
    let none = 0;
    for (let k = 2; k < 40; k++) {
      const r = applyLoot(state, [award(k)]);
      if (r.given[0]!.items.length === 0) none++;
      expect(r.given[0]!.gold).toBe(25);
    }
    expect(none).toBeGreaterThan(15); // 25% after the first: most second kills drop nothing
    // the same kill key again: nothing
    expect(applyLoot(first.state, [award(1)]).given[0]!.dup).toBe(true);
    // the next day drops again
    expect(applyLoot(state, [{ ...award(99), day: '2026-11-13' }]).given[0]!.items).toHaveLength(1);
  });

  it('pack clears give CLEAR_XP and gold to credited members in the instance', async () => {
    server = await startServer({ kits: true, combatSeed: 3, serverSeed: 9, lootAlways: false });
    const acc = await accountFor(server.store, 'Alice');
    const inside = await intoLampfall(server.url, server.store, acc);
    const xp = collect(inside.room, 'jobXp'), loot = collect(inside.room, 'loot');
    const room = serverRoom(inside.room) as any;
    const enc = PACK_ENCOUNTERS[0]!;
    const ids = [...room.inst.encounterOf].filter(([, e]: [number, string]) => e === enc).map(([id]: [number]) => id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) killFor(inside.room, id, [{ room: inside.room }]);
    await waitFor(() => loot.length >= ids.length + 1, 4000);
    const kinds = ids.map((id: number) => room.combat.get(id)?.kind ?? worldOf(room.combat).enemies.get(id)?.kind);
    const killXpSum = kinds.reduce((n: number, k: string) => n + (KILL_XP as Record<string, number>)[k]!, 0);
    await waitFor(() => xp.reduce((n, m) => n + m.gained, 0) === killXpSum + CLEAR_XP);
    expect(xp.filter((m) => m.gained === CLEAR_XP)).toHaveLength(1);
    expect(loot.filter((l) => l.gold === 10 && l.items.length === 0).length).toBeGreaterThanOrEqual(1); // the clear's own gold
  }, 20_000);

  it('catch-up: a level 2 job beside a level 6 job gains 1.5×', async () => {
    await start();
    const a = await join('Alice', { x: 0, z: -36 }, { jobs: jobsAt({ ranger: totalTo(6), warrior: totalTo(2) }) });
    const xp = collect(a.room, 'jobXp');
    killFor(a.room, thornling(a.room), [{ room: a.room }]);
    await waitFor(() => xp.length > 0);
    expect(xp[0]).toMatchObject({ job: 'warrior', gained: Math.floor(KILL_XP.thornling * CATCH_UP_MULT) });
  });

  it('a level-up refreshes max hp and sends levelUp with the talent row at 4, 7 and 10', async () => {
    await start();
    for (const [i, level, row] of [[0, 4, 0], [1, 7, 1], [2, 10, 2], [3, 3, null]] as const) {
      const a = await join(`Lev${level}`, { x: i * 8, z: -36 }, { jobs: jobsAt({ warrior: totalTo(level) - 1 }) });
      const ups = collect(a.room, 'levelUp');
      const before = me(a.room).maxHp, lvlAt = me(a.room).lvlAt ?? 0;
      expect(me(a.room).level).toBe(level - 1);
      killFor(a.room, thornling(a.room, i), [{ room: a.room }]);
      await waitFor(() => ups.length > 0);
      expect(ups[0]).toEqual({ job: 'warrior', level, talentRow: row });
      const want = kitFor({ job: 'warrior', level, gear: {}, talents: [] }).stats.maxHp;
      await waitFor(() => me(a.room).maxHp === want && me(a.room).level === level && (me(a.room).lvlAt ?? 0) > lvlAt);
      expect(want).toBeGreaterThan(before);
      expect(worldOf(serverRoom(a.room).combat).adventurers.get(me(a.room).eid)!.stats.maxHp).toBe(want);
    }
  }, 20_000);

  it('a crash between kill and save loses the loot, never duplicates it; a store outage tells nobody wrong', async () => {
    const base = createMemoryStore();
    let down = false;
    const store: Store = { ...base, writeInventory: (...args) => (down ? Promise.reject(new Error('store down')) : base.writeInventory(...args)) };
    await start({ store });
    const a = await join('Alice', { x: 0, z: -36 });
    await waitFor(async () => (await base.getOrCreateAdventurer(a.accountId)).invVersion >= 1);
    down = true;
    killFor(a.room, thornling(a.room), [{ room: a.room }]);
    await sleep(2000); // its tries run out
    expect(a.loot).toEqual([]);
    const s = await base.getOrCreateAdventurer(a.accountId);
    expect(s.inventory.bag).toHaveLength(16);
    expect(s.gold).toBe(0);
    down = false;
    await a.room.leave();
    const again = await joinZone(server!.url, a.token, 'grove');
    const views = collectFromJoin(again.room, 'inventory');
    await waitFor(() => views.length > 0);
    expect(views[0].bag).toHaveLength(16);
    expect(views[0].gold).toBe(0);
  }, 15_000);
});

/** The server session behind a client (for marking its queue stale after a direct store write). */
function serverRoomSession(room: Room<any, any>) {
  return (serverRoom(room) as any).sessions.get(room.sessionId);
}
