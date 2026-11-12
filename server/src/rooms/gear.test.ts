// Gear in the zone room (Plan 5): equip and unequip into the engine's kit and the state's `gear` code, gear per
// job, the stalls (Smithy, Lampwright, Tailor, Vault, Guild Board) and where each operation is allowed, talents
// and retraining, costumes, and the refusals while fighting, dead, casting, charging or travelling.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  GUILD_BOARD, INV_TEXT, ITEMS, LAMPWRIGHT_SEALS, RESPEC_PRICE, SMITHY_PRICE, TOWN_STALLS, COSTUMES, encodeGearLook, gearLookOf, itemStats, kitFor, newJobsSave,
  levelForXp, totalTo, worldOf, zoneDef, type InventorySave, type JobId, type StallId,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { accountFor, collect, collectFromJoin, intoLampfall, joinZone, place, saveAs, sendInv, serverRoom, sleep, startServer, trackLooks, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const START_GOLD = 2000;
async function start(store: Store = createMemoryStore({ newAdventurer: { gold: START_GOLD } })) {
  server = await startServer({ kits: true, combatSeed: 7, store });
  return server;
}

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const engine = (room: Room<any, any>) => {
  const w = worldOf(serverRoom(room).combat);
  return { w, a: w.adventurers.get(me(room).eid)! };
};

/** Joins the grove (or `zone`), with the inventory and refusal messages collected from the join. */
async function join(name: string, more: Parameters<typeof saveAs>[2] = {}, zone: 'grove' | 'greenway' = 'grove') {
  const { store, url } = server!;
  const account = await accountFor(store, name);
  if (Object.keys(more).length > 0 || zone !== 'grove') await saveAs(store, account.accountId, { zone, ...(zone === 'greenway' ? zoneDef('greenway').spawn : {}), ...more });
  const joined = await joinZone(url, account.token, zone);
  const views = collectFromJoin(joined.room, 'inventory');
  const refusals = collect(joined.room, 'invRefused');
  const looks = trackLooks(joined.room);
  await waitFor(() => views.length > 0 && looks.gear(me(joined.room).eid));
  return { ...joined, ...account, views, refusals, looks, last: () => views.at(-1)! };
}
type Joined = Awaited<ReturnType<typeof join>>;

/** Stands the adventurer 1 m from a stall (towards the statue): within reach. */
function atStall(j: Joined, id: StallId) {
  const s = TOWN_STALLS[id], d = Math.hypot(s.x, s.z);
  place(j.room, s.x - s.x / d, s.z - s.z / d);
}

/** Sends an op and waits for its answer: the next inventory view or refusal. */
async function op(j: Joined, o: Record<string, unknown> & { op: string }, id?: string | null) {
  await sleep(1000 / 8 + 5); // INV_OPS_PER_S
  const v = j.views.length, r = j.refusals.length;
  sendInv(j.room, o as never, id === undefined ? undefined : id);
  await waitFor(() => j.views.length > v || j.refusals.length > r, 3000);
  return j.refusals.length > r ? j.refusals.at(-1)!.reason as string : 'ok';
}

/** The gear code the client was last sent for its own adventurer. */
const gearOf = (j: Joined) => j.looks.gear(me(j.room).eid);
const uidOf = (view: any, item: string) => view.bag.find((i: any) => i.item === item)?.uid as number;

describe('gear', () => {
  it("equip a T1 chest: the kit's defence and max hp rise, the gear field changes, others in view see it once", async () => {
    await start();
    const a = await join('Alice');
    const b = await join('Bob');
    await waitFor(() => b.room.state.players.get(a.room.sessionId));
    const before = { ...engine(a.room).a.stats };
    const gearBefore = gearOf(a);
    expect(gearBefore).toBe(encodeGearLook(gearLookOf(a.last().bag && (await server!.store.getOrCreateAdventurer(a.accountId)).inventory, 'warrior', null)));
    atStall(a, 'smithy');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'thornrunner_chest' })).toBe('ok');
    expect(a.last().gold).toBe(START_GOLD - SMITHY_PRICE.chest);
    const uid = uidOf(a.last(), 'thornrunner_chest');
    expect(await op(a, { op: 'equip', uid, slot: 'chest' })).toBe('ok');
    const after = engine(a.room).a.stats;
    const chest = itemStats('thornrunner_chest'), plain = itemStats('plain_chest');
    expect(after.defence).toBeCloseTo(before.defence - plain.defence + chest.defence, 5);
    expect(after.maxHp).toBe(before.maxHp - plain.maxHp + chest.maxHp);
    expect(after.flow).toBe(chest.flow);
    expect(a.last().stats).toMatchObject({ defence: after.defence, maxHp: after.maxHp });
    await waitFor(() => gearOf(a) !== gearBefore && me(a.room).maxHp === after.maxHp);
    const inv = (await server!.store.getOrCreateAdventurer(a.accountId)).inventory;
    expect(gearOf(a)).toBe(encodeGearLook(gearLookOf(inv, 'warrior', null)));
    await waitFor(() => b.looks.gear(me(a.room).eid) === gearOf(a));
    // unequip: back to the starter chest, the kit as before
    expect(await op(a, { op: 'unequip', slot: 'chest' })).toBe('ok');
    expect(engine(a.room).a.stats).toEqual(before);
    await waitFor(() => gearOf(a) === gearBefore);
    expect(await op(a, { op: 'unequip', slot: 'weapon' })).toBe('fit');
  });

  it('switching job switches the gear set and the gear field', async () => {
    await start();
    const a = await join('Alice');
    atStall(a, 'smithy');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'hedgecutter' })).toBe('ok');
    const bare = gearOf(a);
    expect(await op(a, { op: 'equip', uid: uidOf(a.last(), 'hedgecutter'), slot: 'weapon' })).toBe('ok');
    await waitFor(() => gearOf(a) !== bare);
    const warriorGear = gearOf(a), warriorPower = engine(a.room).a.stats.power;
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => me(a.room).job === 'ninja' && gearOf(a) !== warriorGear);
    const store = (await server!.store.getOrCreateAdventurer(a.accountId)).inventory;
    expect(gearOf(a)).toBe(encodeGearLook(gearLookOf(store, 'ninja', null)));
    expect(engine(a.room).a.stats).toEqual(kitFor({ job: 'ninja', level: 1, gear: {}, talents: [] }).stats);
    // a blade does not fit the Ninja's weapon slot
    expect(await op(a, { op: 'equip', uid: uidOf(a.last(), 'hedgecutter'), slot: 'weapon' })).toBe('fit');
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => me(a.room).job === 'warrior' && gearOf(a) === warriorGear);
    expect(engine(a.room).a.stats.power).toBe(warriorPower);
  });

  it('buy at the Smithy in reach; refused away from it, in the Greenway, without gold, with a full bag', async () => {
    await start();
    const a = await join('Alice');
    place(a.room, TOWN_STALLS.smithy.x + 8, TOWN_STALLS.smithy.z);
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'thornrunner_legs' })).toBe('where');
    atStall(a, 'smithy');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'tollwind_legs' })).toBe('unknown'); // T3 is not the Smithy's
    expect(await op(a, { op: 'buy', stall: 'lampwright', item: 'tollwind_legs' })).toBe('where');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'thornrunner_legs' }, null)).toBe('no-id');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'thornrunner_legs' })).toBe('ok');
    expect(a.refusals.at(-2)).toMatchObject({ op: 'buy', reason: 'where', text: INV_TEXT.where });
    // forged junk is refused, never thrown on
    for (const junk of [{ op: 'buy', stall: 'smithy', item: 'x'.repeat(500) }, { op: 'buy', stall: 'moon', item: 'hedgecutter' }, { op: 'equip', uid: NaN, slot: 'chest' }, { op: 'equip', uid: -1, slot: 'chest' }, { op: 'nope' }]) {
      expect(await op(a, junk)).toBe('unknown');
    }
    a.room.send('inv', 'garbage');
    a.room.send('inv', null);
    expect(await op(a, { op: 'talent', row: 9, choice: 0 })).toBe('unknown');
    // without gold
    const poor = await join('Poor', {});
    await waitFor(async () => (await server!.store.getOrCreateAdventurer(poor.accountId)).invVersion >= 1); // its join wrote the starter kit back
    const p0 = await server!.store.getOrCreateAdventurer(poor.accountId);
    expect(await server!.store.writeInventory(p0.id, p0.invVersion, { inventory: p0.inventory, jobs: p0.jobs, dGold: -(START_GOLD - 10), dSeals: 0 })).not.toBeNull();
    atStall(poor, 'smithy');
    expect(await op(poor, { op: 'buy', stall: 'smithy', item: 'thornrunner_head' })).toBe('gold'); // (stale first: retried on the truth)
    await waitFor(() => poor.last().gold === 10); // read afresh for the refusal: the truth follows it
    // a full bag
    const full = await server!.store.getOrCreateAdventurer(poor.accountId);
    const inv: InventorySave = { ...full.inventory, bag: [...full.inventory.bag], nextUid: full.inventory.nextUid };
    while (inv.bag.length < 16 + 30) inv.bag.push({ uid: inv.nextUid++, item: 'thornrunner_feet', dye: [0, 0] });
    await server!.store.writeInventory(full.id, full.invVersion, { inventory: inv, jobs: full.jobs, dGold: 1000, dSeals: 0 });
    expect(await op(poor, { op: 'buy', stall: 'smithy', item: 'thornrunner_head' })).toBe('bag-full');
    // in the Greenway: no stalls at all
    const g = await join('Greenie', {}, 'greenway');
    expect(await op(g, { op: 'buy', stall: 'smithy', item: 'thornrunner_head' })).toBe('where');
  }, 20_000);

  it('sell refuses worn and starter items; bank only at the Vault', async () => {
    await start();
    const a = await join('Alice');
    atStall(a, 'smithy');
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'hedge_buckler' })).toBe('ok');
    const uid = uidOf(a.last(), 'hedge_buckler');
    expect(await op(a, { op: 'equip', uid, slot: 'offhand' })).toBe('ok');
    expect(await op(a, { op: 'sell', uid })).toBe('worn');
    expect(await op(a, { op: 'sell', uid: uidOf(a.last(), 'plain_chest') })).toBe('worn');
    expect(await op(a, { op: 'equip', uid: uidOf(a.last(), 'grove_buckler'), slot: 'offhand' })).toBe('ok');
    expect(await op(a, { op: 'sell', uid: uidOf(a.last(), 'grove_bow') })).toBe('worn'); // the Ranger wears it
    expect(await op(a, { op: 'bank', uid })).toBe('where');
    const gold = a.last().gold;
    expect(await op(a, { op: 'sell', uid })).toBe('ok');
    expect(a.last().gold).toBe(gold + ITEMS.hedge_buckler!.sell);
    expect(await op(a, { op: 'sell', uid })).toBe('unknown'); // sold already
    expect(await op(a, { op: 'buy', stall: 'smithy', item: 'hedge_buckler' })).toBe('ok');
    const again = uidOf(a.last(), 'hedge_buckler');
    atStall(a, 'vault');
    expect(await op(a, { op: 'sell', uid: again })).toBe('where');
    expect(await op(a, { op: 'bank', uid: again })).toBe('ok');
    expect(a.last().bank.map((i: any) => i.uid)).toEqual([again]);
    expect(await op(a, { op: 'bank', uid: uidOf(a.last(), 'plain_chest') })).toBe('worn');
    expect(await op(a, { op: 'unbank', uid: again })).toBe('ok');
  }, 15_000);

  it('Seals buy T3 at the Lampwright; not enough Seals → seals', async () => {
    await start();
    const a = await join('Alice');
    const id = (await server!.store.getOrCreateAdventurer(a.accountId)).id;
    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03']) await server!.store.awardSeal(id, day);
    atStall(a, 'lampwright');
    expect(LAMPWRIGHT_SEALS.chest).toBe(4);
    expect(await op(a, { op: 'buy', stall: 'lampwright', item: 'tollwind_chest' })).toBe('seals'); // (the awards made the session stale: retried on the truth)
    await waitFor(() => a.last().seals === 3);
    await server!.store.awardSeal(id, '2026-11-04');
    expect(await op(a, { op: 'buy', stall: 'lampwright', item: 'tollwind_chest' })).toBe('ok');
    expect(a.last()).toMatchObject({ seals: 0, gold: START_GOLD });
    expect(await op(a, { op: 'buy', stall: 'lampwright', item: 'thornrunner_chest' })).toBe('unknown'); // T1 is the Smithy's
    expect(await server!.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ seals: 0 });
  });

  it('talent choice in the grove at level 4, refused at level 3 or in the Greenway; respec free once, then 25 per row', async () => {
    await start();
    const jobs = (xp: number) => ({ curve: 2 as const, current: 'warrior' as JobId, jobs: { warrior: { level: levelForXp(xp), xp, picks: ['mend', 'bulwark'] as never, talents: [], outfit: null } } });
    const low = await join('Low', { jobs: jobs(totalTo(4) - 1) });
    expect(await op(low, { op: 'talent', row: 0, choice: 0 })).toBe('level');
    const green = await join('Green', { jobs: jobs(totalTo(4)) }, 'greenway');
    expect(await op(green, { op: 'talent', row: 0, choice: 0 })).toBe('where');
    const a = await join('Alice', { jobs: jobs(totalTo(7)) });
    const jobsMsgs = collectFromJoin(a.room, 'jobs');
    const before = engine(a.room).a.modIndex;
    expect(await op(a, { op: 'talent', row: 0, choice: 1 })).toBe('ok');
    expect(await op(a, { op: 'talent', row: 0, choice: 2 })).toBe('taken');
    expect(await op(a, { op: 'talent', row: 1, choice: 0 })).toBe('ok');
    expect(await op(a, { op: 'talent', row: 2, choice: 0 })).toBe('level');
    await waitFor(() => jobsMsgs.at(-1)?.jobs.warrior.talents.length === 2);
    expect(jobsMsgs.at(-1).jobs.warrior.talents).toEqual(['warrior_1b', 'warrior_2a']);
    expect(engine(a.room).a.modIndex).not.toEqual(before); // the kit took the talents
    expect((await server!.store.getOrCreateAdventurer(a.accountId)).jobs.jobs.warrior!.talents).toEqual(['warrior_1b', 'warrior_2a']);
    // retraining: at the Guild Board only; the first is free, then 25 a chosen row
    expect(await op(a, { op: 'respec' })).toBe('where');
    place(a.room, GUILD_BOARD.x + 1, GUILD_BOARD.z);
    const gold = a.last().gold;
    expect(await op(a, { op: 'respec' })).toBe('ok');
    expect(a.last().gold).toBe(gold);
    expect(a.last().freeRespec).toBe(false);
    expect(await op(a, { op: 'talent', row: 0, choice: 0 })).toBe('ok');
    expect(await op(a, { op: 'talent', row: 1, choice: 2 })).toBe('ok');
    expect(await op(a, { op: 'respec' })).toBe('ok');
    expect(a.last().gold).toBe(gold - 2 * RESPEC_PRICE);
    expect((await server!.store.getOrCreateAdventurer(a.accountId))).toMatchObject({ gold: gold - 2 * RESPEC_PRICE });
    expect((await server!.store.getOrCreateAdventurer(a.accountId)).jobs.jobs.warrior!.talents).toEqual([]);
  }, 15_000);

  it('wear an owned costume per job; an unowned one is refused', async () => {
    await start();
    const a = await join('Alice');
    const bare = gearOf(a);
    expect(await op(a, { op: 'wear', slot: 'body', costume: 'orchard_smock' })).toBe('unknown');
    expect(await op(a, { op: 'buyCostume', costume: 'orchard_smock' })).toBe('where');
    atStall(a, 'tailor');
    expect(await op(a, { op: 'buyCostume', costume: 'starfall_regalia' })).toBe('unknown'); // event only
    expect(await op(a, { op: 'buyCostume', costume: 'orchard_smock' })).toBe('ok');
    expect(a.last().gold).toBe(START_GOLD - COSTUMES.orchard_smock.price!);
    expect(await op(a, { op: 'buyCostume', costume: 'orchard_smock' })).toBe('owned');
    expect(await op(a, { op: 'wear', slot: 'head', costume: 'orchard_smock' })).toBe('fit');
    const statsBefore = { ...engine(a.room).a.stats };
    expect(await op(a, { op: 'wear', slot: 'body', costume: 'orchard_smock' })).toBe('ok');
    await waitFor(() => gearOf(a) !== bare);
    expect(engine(a.room).a.stats).toEqual(statsBefore); // looks never change a number
    expect(await op(a, { op: 'hideHead', hide: true })).toBe('ok');
    const stored = await server!.store.getOrCreateAdventurer(a.accountId);
    expect(stored.jobs.jobs.warrior!.outfit).toEqual({ body: 'orchard_smock', head: null, back: null, hideHead: true });
    await waitFor(() => gearOf(a) === encodeGearLook(gearLookOf(stored.inventory, 'warrior', stored.jobs.jobs.warrior!.outfit)));
    expect(gearOf(a)).toBe(encodeGearLook(gearLookOf(stored.inventory, 'warrior', stored.jobs.jobs.warrior!.outfit)));
    // per job: the Ninja wears none
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => me(a.room).job === 'ninja');
    await waitFor(() => gearOf(a) === encodeGearLook(gearLookOf(stored.inventory, 'ninja', null)));
  });

  it('equip refused in combat, dead, casting, charging, travelling', async () => {
    await start();
    const a = await join('Alice');
    const chest = uidOf(a.last(), 'plain_chest');
    const tryEquip = () => op(a, { op: 'equip', uid: chest, slot: 'chest' });
    expect(await tryEquip()).toBe('ok');
    const { w, a: adv } = engine(a.room);
    adv.lastCombatAt = w.now;
    expect(await tryEquip()).toBe('combat');
    adv.lastCombatAt = -Infinity;
    adv.cast = { id: 'mend', slot: 3, startedAt: w.now, endsAt: w.now + 1000, targetId: null, allyId: null, total: 1000 };
    expect(await tryEquip()).toBe('busy');
    adv.cast = null;
    adv.charge = { startedAt: w.now };
    expect(await tryEquip()).toBe('busy');
    adv.charge = null;
    const session = (serverRoom(a.room) as any).sessions.get(a.room.sessionId);
    session.travelling = new Promise(() => {});
    expect(await tryEquip()).toBe('busy');
    session.travelling = undefined;
    killAdventurer(w, adv, w.now);
    await sleep(150);
    expect(await tryEquip()).toBe('dead');
    expect(a.refusals.map((r) => r.text)).toContain(INV_TEXT.dead);
  });

  it('the kit goes in with the adventurer on join, relog and instance entry (dodges fit it); a job change re-kits at once', async () => {
    await start();
    // a level 10 Ninja with Fourth Roll (+1 dodge charge) in T1 light armour
    const jobs = { curve: 2 as const, current: 'ninja' as JobId, jobs: { ninja: { level: 10, xp: totalTo(10), picks: ['quickstep', 'ashcloud'] as never, talents: ['ninja_3c'], outfit: null } } };
    const account = await accountFor(server!.store, 'Nina');
    await saveAs(server!.store, account.accountId, { jobs });
    const want = kitFor({ job: 'ninja', level: 10, gear: {}, talents: ['ninja_3c'] });
    const check = async (room: Room<any, any>, full = true) => {
      const selves = collect(room, 'self');
      await waitFor(() => selves.length > 0);
      const w = worldOf(serverRoom(room).combat), adv = w.adventurers.get(me(room).eid)!;
      expect(adv.stats).toEqual(want.stats);
      expect(selves[0].dodgeMax).toBe(4);
      if (full) expect(selves[0].dodgeCharges).toBe(4); // (after a job change they refill towards it)
      expect(me(room)).toMatchObject({ level: 10, maxHp: want.stats.maxHp });
    };
    const first = await joinZone(server!.url, account.token, 'grove');
    await check(first.room);
    await first.room.leave();
    const again = await joinZone(server!.url, account.token, 'grove'); // relog: the carry keeps 4 dodges
    await check(again.room);
    // a job change re-kits in the same handler: the Warrior has 2 dodges, none of the Ninja's talent
    const selves = collect(again.room, 'self');
    again.room.send('job', { job: 'warrior' });
    await waitFor(() => selves.some((x) => x.job === 'warrior'));
    expect(selves.find((x) => x.job === 'warrior').dodgeMax).toBe(2);
    expect(engine(again.room).a.stats).toEqual(kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats);
    again.room.send('job', { job: 'ninja' });
    await waitFor(() => me(again.room).job === 'ninja');
    await again.room.leave();
    // into the Lampfall: the Greenway join, the travel and the instance's join each carry the kit
    const inside = await intoLampfall(server!.url, server!.store, account);
    await check(inside.room, false);
  }, 20_000);

  it('talent choice and respec are refused in combat, while casting and while charging', async () => {
    await start();
    const jobs = { curve: 2 as const, current: 'warrior' as JobId, jobs: { warrior: { level: 4, xp: totalTo(4), picks: ['mend', 'bulwark'] as never, talents: ['warrior_1a'], outfit: null } } };
    const a = await join('Alice', { jobs, x: GUILD_BOARD.x + 1, z: GUILD_BOARD.z });
    const { w, a: adv } = engine(a.room);
    adv.lastCombatAt = w.now;
    expect(await op(a, { op: 'respec' })).toBe('combat');
    adv.lastCombatAt = -Infinity;
    adv.cast = { id: 'mend', slot: 3, startedAt: w.now, endsAt: w.now + 1000, targetId: null, allyId: null, total: 1000 };
    expect(await op(a, { op: 'respec' })).toBe('busy');
    adv.cast = null;
    adv.charge = { startedAt: w.now };
    expect(await op(a, { op: 'respec' })).toBe('busy');
    adv.charge = null;
    expect(await op(a, { op: 'respec' })).toBe('ok');
    adv.lastCombatAt = w.now;
    expect(await op(a, { op: 'talent', row: 0, choice: 1 })).toBe('combat');
    adv.lastCombatAt = -Infinity;
    adv.charge = { startedAt: w.now };
    expect(await op(a, { op: 'talent', row: 0, choice: 1 })).toBe('busy');
    adv.charge = null;
    expect(await op(a, { op: 'talent', row: 0, choice: 1 })).toBe('ok');
  });
});
