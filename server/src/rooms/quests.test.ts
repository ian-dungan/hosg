// Plan 6 Task 4: the opening quest on the server. Every objective is decided from the server's own state (the last
// accepted pose, the engine's kill credit with the party share, the engine's fx, accepted job and loadout intents,
// applied equips); each step and its reward land in one inventory write; quest messages go to their owner only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  BAG_SLOTS, JOBS, bagUsed, JUMP_MIN_M, PARTY_SHARE_R, STORY_NPCS, STORY_PROPS, groveTownSurface, lampfallArena, lampfallLayout, makeBody, newQuestSave, pimGround,
  questsView, stepBody, worldOf, zoneDef, type CampSpawn, type FxEvent, type QuestSave, type Surface, type ZoneDef, type ZoneId,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { InvWrite } from '../store/types';
import {
  accountFor, collect, collectFromJoin, intoLampfall, joinZone, killFor, partyUp, place, questsOf, saveAs, sendInv, sendQuest, serverRoom, sleep, startServer,
  storeQuests, waitFor, walk, type TestServer,
} from './testHelpers';
import { actsFromFx, jumpCounts, placeEvents, questDay, questWatch } from './quests';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const today = () => new Date().toISOString().slice(0, 10);
const flat: Surface = (x, z) => (Math.hypot(x, z) > 300 ? null : 0);
const flatZone = (camps: CampSpawn[], over: Partial<ZoneDef> = {}): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps, ...over });
const camp = (kind: CampSpawn['kind'], n: number, z = -40): CampSpawn[] => Array.from({ length: n }, (_, i) => ({ kind, x: i * 8, z, facing: 0 }));

/** The main quest at `step` (fresh counts), with `more` actives after it. */
function mainAt(step: number, more: QuestSave['active'] = [], counts?: number[]): QuestSave {
  const n = [1, 1, 1, 1, 1, 1, 1, 1, 4, 1, 2, 1, 1, 1][step]!;
  return { ...newQuestSave(today()), active: [{ id: 'solstice_crossing', step, counts: counts ?? Array(n).fill(0), since: today() }, ...more] };
}
/** The main quest done (and `active` taken). */
function mainDone(active: QuestSave['active'] = []): QuestSave {
  return { ...newQuestSave(today()), active, done: { solstice_crossing: { day: today(), times: 1, choice: 1 } } };
}

async function start(over: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ kits: true, combatSeed: 3, serverSeed: 7, store: createMemoryStore(), reconnectSeconds: 1, ...over });
  return server;
}
const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);

/** An account stored at (x, z) in `zone` with `quests` (and `gold`), joined there: its rooms and the quest messages it gets. */
async function joinedAt(name: string, o: { zone?: ZoneId; at?: { x: number; z: number }; quests?: QuestSave } = {}) {
  const store = server!.store;
  const account = await accountFor(store, name);
  const zone = o.zone ?? 'grove';
  if (o.at || zone !== 'grove') await saveAs(store, account.accountId, { zone, ...(o.at ?? zoneDef(zone).spawn) });
  if (o.quests) await storeQuests(store, account.accountId, o.quests);
  const j = await joinZone(server!.url, account.token, zone);
  const views = questsOf(j.room), done = collectFromJoin(j.room, 'questDone'), refused = collect(j.room, 'questRefused');
  await waitFor(() => views.length > 0, 3000);
  return { ...j, ...account, views, done, refused, last: () => views.at(-1)! };
}
const npc = (id: keyof typeof STORY_NPCS) => STORY_NPCS[id];
const prop = (id: keyof typeof STORY_PROPS) => STORY_PROPS[id];
/** The current step of the main quest in the latest view (-1: done). */
const mainStep = (views: { active: { id: string; step: number }[] }[]) => views.at(-1)?.active.find((a) => a.id === 'solstice_crossing')?.step ?? -1;

/** Poses of a standing jump at (x, z) on `surface`: up and back down, one per tick. */
function jumpPoses(x: number, z: number, surface: Surface) {
  const body = makeBody(x, z, surface);
  const out: { x: number; z: number; y: number; facing: number; moving: boolean }[] = [];
  for (let i = 0; i < 40; i++) {
    stepBody(body, { vx: 0, vz: 0, jump: i === 0 }, 1 / 15, surface);
    out.push({ x: body.x, z: body.z, y: body.y, facing: 0, moving: false });
    if (i > 0 && body.grounded) break;
  }
  return out;
}
async function sendPoses(room: Room<any, any>, poses: { x: number; z: number; y: number; facing: number; moving: boolean }[], ack = 0) {
  for (const p of poses) {
    room.send('move', { ...p, ack });
    await sleep(1000 / 15);
  }
}

describe('quest helpers (pure)', () => {
  it('acts from the engine fx: finisher, picks, combos and dodges (in a fight) of this adventurer only', () => {
    const fx: FxEvent[] = [
      { t: 'use', src: 1, ability: JOBS.warrior.bar[1] },
      { t: 'use', src: 1, ability: 'mend' },
      { t: 'use', src: 2, ability: 'bulwark' },
      { t: 'use', src: 1, ability: JOBS.warrior.bar[0] },
      { t: 'hit', src: 1, dst: 9, amount: 5, absorbed: 0, by: 'sunder', combo: ['marked'] as never },
      { t: 'hit', src: 1, dst: 9, amount: 5, absorbed: 0, by: 'auto' },
      { t: 'hit', src: 1, dst: 9, amount: 5, absorbed: 0, by: 'auto', combo: [] },
      { t: 'dodge', src: 1 },
      { t: 'dodge', src: 2 },
    ];
    expect(actsFromFx(fx, 1, 'warrior', ['mend', 'bulwark'], true)).toEqual([
      { e: 'act', what: 'finisher' }, { e: 'act', what: 'pick' }, { e: 'act', what: 'combo' }, { e: 'act', what: 'dodge' },
    ]);
    // out of a fight a dodge is not a fight's dodge; picks and finishers still count (lenient on purpose)
    expect(actsFromFx(fx, 1, 'warrior', ['mend', 'bulwark'], false).map((e) => (e as { what: string }).what)).toEqual(['finisher', 'pick', 'combo']);
    expect(actsFromFx(fx, 3, 'warrior', ['mend', 'bulwark'], true)).toEqual([]);
  });

  it('a jump counts at JUMP_MIN_M above the surface, rising from where it left the ground', () => {
    expect(JUMP_MIN_M).toBe(0.6);
    expect(jumpCounts(0.8, 0, 0)).toBe(true);
    expect(jumpCounts(0.4, 0, 0)).toBe(false);
    expect(jumpCounts(0.8, null, 0)).toBe(false);
    expect(jumpCounts(1.8, 1, 1)).toBe(true); // up from a crate
    expect(jumpCounts(0.8, 0, 1)).toBe(false); // walking off a crate (a fall, not a jump)
  });

  it('places: a reach event only inside a current step circle of this zone; watch flags follow the current steps', () => {
    const p = pimGround();
    expect(placeEvents(mainAt(1), 'grove', p.x + 1, p.z)).toEqual([{ e: 'reach', zone: 'grove', x: p.x + 1, z: p.z }]);
    expect(placeEvents(mainAt(1), 'grove', p.x + 9, p.z)).toEqual([]);
    expect(placeEvents(mainAt(1), 'greenway', p.x, p.z)).toEqual([]);
    expect(placeEvents(mainAt(2), 'grove', p.x, p.z)).toEqual([]);
    expect(questWatch(mainAt(0))).toEqual({ place: false, jump: false, acts: false, equip: false });
    expect(questWatch(mainAt(1))).toMatchObject({ place: true, jump: false });
    expect(questWatch(mainAt(2))).toMatchObject({ jump: true });
    expect(questWatch(mainAt(8))).toMatchObject({ acts: true });
    expect(questWatch(mainAt(12))).toMatchObject({ equip: true });
  });

  it('the quest day never goes back before a day the save already holds (clock skew)', () => {
    const s = { ...mainAt(7), done: { bristle_bounty: { day: '2026-11-13', times: 1 } } };
    expect(questDay(s, '2026-11-12')).toBe('2026-11-13');
    expect(questDay(s, '2026-11-14')).toBe('2026-11-14');
  });
});

describe('the quest on the server', () => {
  it('a new adventurer joins with the main quest at Marrow and gets quests once, a step after join', async () => {
    await start();
    const writes = vi.spyOn(server!.store, 'writeInventory');
    const a = await joinedAt('Ada');
    await sleep(400);
    expect(a.views).toEqual([questsView(newQuestSave(today()), today())]);
    for (const c of writes.mock.calls) expect((c[2] as InvWrite).quests).toBeUndefined(); // nothing written for it
    expect((await stored(a.accountId)).quests).toEqual(newQuestSave(today()));
  }, 15_000);

  it('talk to Marrow in reach advances; 10 m away is refused where; from the Greenway is refused where', async () => {
    await start();
    const m = npc('marrow');
    const far = await joinedAt('Far', { at: { x: m.x + 10, z: m.z } });
    sendQuest(far.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => far.refused.length > 0);
    expect(far.refused[0]).toEqual({ act: 'talk', reason: 'where', text: 'You need to be closer.' });
    const gw = await joinedAt('Gwen', { zone: 'greenway', at: { x: npc('nell').x, z: npc('nell').z } });
    sendQuest(gw.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => gw.refused.length > 0);
    expect(gw.refused[0].reason).toBe('where');
    const near = await joinedAt('Near', { at: { x: m.x + 1.5, z: m.z } });
    const xp = collect(near.room, 'jobXp');
    sendQuest(near.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => near.done.length > 0);
    expect(near.done[0]).toMatchObject({ quest: 'solstice_crossing', stepId: 'marrow', xp: 20, gold: 0, item: null, questDone: false });
    await waitFor(() => mainStep(near.views) === 1);
    await waitFor(() => xp.some((x) => x.gained === 20));
    expect(near.refused).toEqual([]);
    const s = await stored(near.accountId);
    expect(s.quests.active[0]!.step).toBe(1);
    expect(s.jobs.jobs.warrior!.xp).toBe(20);
    expect(mainStep(far.views)).toBe(0);
  }, 20_000);

  it('walking to the tavern completes pim_find; a pose the server corrected does not', async () => {
    await start();
    const p = pimGround(), from = { x: npc('tamsin').x, z: npc('tamsin').z };
    expect(Math.hypot(from.x - p.x, from.z - p.z)).toBeGreaterThan(6);
    const a = await joinedAt('Pip', { at: from, quests: mainAt(1) });
    const corrections = collect(a.room, 'correct');
    a.room.send('move', { x: p.x, z: p.z, y: groveTownSurface(p.x, p.z), facing: 0, moving: true, ack: 0 }); // 8 m in one step
    await waitFor(() => corrections.length > 0);
    await sleep(300);
    expect(mainStep(a.views)).toBe(1);
    await walk(a.room, from, { x: p.x + 1, z: p.z + 1 });
    await waitFor(() => mainStep(a.views) === 2, 3000);
    expect(a.done.map((d) => [d.stepId, d.xp, d.gold])).toEqual([['pim_find', 0, 0]]); // a step with no reward: its moment all the same
  }, 20_000);

  it('a jump completes pim_hop: a pose 0.8 m above the surface counts, 0.4 m does not, standing on a crate does not', async () => {
    // a flat grove with a 1.2 m crate at (0, -20)
    const crate: Surface = (x, z) => (Math.hypot(x, z) > 300 ? null : Math.abs(x) < 2 && Math.abs(z + 20) < 2 ? 1.2 : 0);
    await start({ zones: { grove: flatZone([], { surface: crate, ground: crate }) } });
    const a = await joinedAt('Hop', { at: { x: 0, z: -20 }, quests: mainAt(2) });
    expect(me(a.room).y).toBeCloseTo(1.2);
    const corrections = collect(a.room, 'correct');
    await walk(a.room, { x: 0, z: -20 }, { x: 1.5, z: -20 }, crate); // on the crate
    await walk(a.room, { x: 1.5, z: -20 }, { x: 4, z: -20 }, crate); // and off it (a fall, not a jump)
    await sleep(300);
    expect(mainStep(a.views)).toBe(2);
    // a real jump from the ground: its arc rises past JUMP_MIN_M
    const poses = jumpPoses(4, -20, crate);
    expect(Math.max(...poses.map((q) => q.y))).toBeGreaterThan(0.8);
    await sendPoses(a.room, poses);
    await waitFor(() => mainStep(a.views) === 3, 3000);
    expect(corrections).toEqual([]);
  }, 20_000);

  it('the plaque completes with 30 xp and questDone scene beacon, to the owner only', async () => {
    await start();
    const pl = prop('plaque');
    const a = await joinedAt('Pla', { at: { x: pl.x + 1.8, z: pl.z - 1 }, quests: mainAt(4) });
    const b = await joinedAt('Bys', { at: { x: pl.x - 1.8, z: pl.z - 1 }, quests: mainAt(4) });
    const bQuests = b.views.length;
    sendQuest(a.room, { act: 'use', prop: 'plaque' });
    await waitFor(() => a.done.length > 0);
    expect(a.done[0]).toMatchObject({ stepId: 'plaque', xp: 30, scene: 'beacon' });
    await sleep(300);
    expect(b.done).toEqual([]);
    expect(b.views.length).toBe(bQuests);
  }, 20_000);

  it('choosing the current job at the Guild Board completes board; a loadout change does too', async () => {
    await start();
    const a = await joinedAt('Job', { quests: mainAt(5) });
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => mainStep(a.views) === 6, 3000);
    expect(a.done[0]).toMatchObject({ stepId: 'board', xp: 20 });
    const b = await joinedAt('Pick', { quests: mainAt(5) });
    b.room.send('loadout', { picks: ['bulwark', 'mend'] });
    await waitFor(() => mainStep(b.views) === 6, 3000);
  }, 20_000);

  it('travelling to the Greenway completes gate on join', async () => {
    await start();
    const a = await joinedAt('Gate', { zone: 'greenway', quests: mainAt(6) });
    await waitFor(() => mainStep(a.views) === 7, 3000);
    expect((await stored(a.accountId)).quests.active[0]!.step).toBe(7);
  }, 15_000);

  it('first_fight: three Thornling kills, a finisher, a combo and a dodge in a fight, counted from the engine', async () => {
    await start({ zones: { greenway: flatZone(camp('thornling', 4)) } });
    const a = await joinedAt('Fig', { zone: 'greenway', at: { x: 0, z: -36 }, quests: mainAt(8) });
    const room = serverRoom(a.room);
    const w = worldOf(room.combat);
    const eid = me(a.room).eid;
    const adv = w.adventurers.get(eid)!;
    const thornlings = [...w.enemies.values()].filter((e) => e.kind === 'thornling');
    for (const t of thornlings.slice(0, 3)) await killFor(a.room, t.id, [{ room: a.room }]);
    await waitFor(() => a.last().active[0]!.counts[0] === 3, 3000);
    // a finisher, from the engine: target the last Thornling in reach with Momentum to spend
    const last = thornlings[3]!;
    last.x = adv.x; last.z = adv.z - 1.5;
    a.room.send('target', { id: last.id });
    await sleep(150);
    adv.momentum = 100;
    a.room.send('ability', { slot: 1, phase: 'press' });
    await waitFor(() => a.last().active[0]!.counts[1] === 1, 3000);
    // a combo: the engine's hit fx with a combo
    w.out.fx.push({ t: 'hit', src: eid, dst: last.id, amount: 1, absorbed: 0, by: 'slash', combo: ['marked'] as never });
    await waitFor(() => a.last().active[0]!.counts[2] === 1, 3000);
    // a dodge roll in the fight
    adv.lastCombatAt = w.now;
    a.room.send('dodge', { x: adv.x, z: adv.z, y: 0, facing: 0, moving: false, ack: 0, dx: 1, dz: 0 });
    await waitFor(() => mainStep(a.views) === 9, 3000);
    expect(a.done.map((d) => [d.stepId, d.xp, d.gold])).toEqual([['first_fight', 60, 10]]);
    expect((await stored(a.accountId)).gold).toBeGreaterThanOrEqual(10);
  }, 25_000);

  it('a duo: one lands the kill, both count it; a member beyond PARTY_SHARE_R does not; a 2% tagger does not', async () => {
    await start({ zones: { greenway: flatZone(camp('thornling', 2)) } });
    const a = await joinedAt('Duo', { zone: 'greenway', at: { x: 0, z: -36 }, quests: mainAt(10) });
    const b = await joinedAt('Bud', { zone: 'greenway', at: { x: 2, z: -36 }, quests: mainAt(10) });
    const c = await joinedAt('Cat', { zone: 'greenway', at: { x: 0, z: -40 + PARTY_SHARE_R + 10 }, quests: mainAt(10) });
    const d = await joinedAt('Dee', { zone: 'greenway', at: { x: -2, z: -36 }, quests: mainAt(8) });
    await partyUp(a.room, b.room, 'Bud');
    await partyUp(a.room, c.room, 'Cat');
    const w = worldOf(serverRoom(a.room).combat);
    const t = [...w.enemies.values()].find((e) => e.kind === 'thornling')!;
    await killFor(a.room, t.id, [{ room: a.room, threat: 98 }, { room: d.room, threat: 2 }]);
    await waitFor(() => mainStep(a.views) === 11 && mainStep(b.views) === 11, 3000);
    await sleep(300);
    expect(a.done[0]).toMatchObject({ stepId: 'duo', xp: 60, gold: 15 });
    expect(b.done[0]).toMatchObject({ stepId: 'duo', xp: 60, gold: 15 });
    expect(mainStep(c.views)).toBe(10);
    expect(d.last().active[0]!.counts[0]).toBe(0);
  }, 25_000);

  it('members on different steps each advance their own (main and Bristle Bounty from one boar kill)', async () => {
    await start({ zones: { greenway: flatZone(camp('boar', 1)) } });
    const a = await joinedAt('Ann', { zone: 'greenway', at: { x: 0, z: -36 }, quests: mainAt(10) });
    const b = await joinedAt('Ben', { zone: 'greenway', at: { x: 2, z: -36 }, quests: mainAt(11, [{ id: 'bristle_bounty', step: 0, counts: [2], since: today() }]) });
    await partyUp(a.room, b.room, 'Ben');
    const w = worldOf(serverRoom(a.room).combat);
    const boar = [...w.enemies.values()].find((e) => e.kind === 'boar')!;
    await killFor(a.room, boar.id, [{ room: a.room }]);
    await waitFor(() => mainStep(a.views) === 11, 3000);
    await waitFor(() => b.last().active.find((q) => q.id === 'bristle_bounty')?.counts[0] === 3, 3000);
    expect(mainStep(b.views)).toBe(11);
  }, 20_000);

  it('nell_report with choice 2 gives the Rootbound Hauberk, 40 gold and 40 xp in one write; no choice → choice; full bag → bag-full', async () => {
    await start();
    const n = npc('nell');
    const a = await joinedAt('Rep', { zone: 'greenway', at: { x: n.x + 1, z: n.z }, quests: mainAt(11) });
    await sleep(200);
    sendQuest(a.room, { act: 'talk', npc: 'nell' });
    await waitFor(() => a.refused.length > 0);
    expect(a.refused[0]).toMatchObject({ act: 'talk', reason: 'choice' });
    const writes = vi.spyOn(server!.store, 'writeInventory');
    const before = await stored(a.accountId);
    sendQuest(a.room, { act: 'talk', npc: 'nell', choice: 2 });
    await waitFor(() => a.done.length > 0);
    expect(a.done[0]).toMatchObject({ stepId: 'nell_report', xp: 40, gold: 40, item: 'rootbound_chest' });
    expect(writes).toHaveBeenCalledTimes(1);
    const w = writes.mock.calls[0]![2] as InvWrite;
    expect(w.dGold).toBe(40);
    expect(w.inventory.bag.some((i) => i.item === 'rootbound_chest')).toBe(true);
    expect(w.quests!.active[0]!.step).toBe(12);
    expect(w.jobs!.jobs.warrior!.xp).toBe(before.jobs.jobs.warrior!.xp + 40);
    const s = await stored(a.accountId);
    expect(s.gold).toBe(before.gold + 40);
    // a full bag: refused, nothing written
    const full = await joinedAt('Ful', { zone: 'greenway', at: { x: n.x - 1, z: n.z }, quests: mainAt(11) });
    const f = await stored(full.accountId);
    const bag = [...f.inventory.bag];
    let uid = f.inventory.nextUid;
    while (bagUsed({ ...f.inventory, bag }) < BAG_SLOTS) bag.push({ uid: uid++, item: 'hedge_buckler', dye: [0, 0] });
    await server!.store.writeInventory(f.id, f.invVersion, { inventory: { ...f.inventory, bag, nextUid: uid }, dGold: 0, dSeals: 0 });
    serverRoom(full.room).refreshInventory(full.accountId);
    await sleep(200);
    writes.mockClear();
    sendQuest(full.room, { act: 'talk', npc: 'nell', choice: 0 });
    await waitFor(() => full.refused.length > 0);
    expect(full.refused[0]).toMatchObject({ act: 'talk', reason: 'bag-full', text: 'Make room in your bag first.' });
    expect(writes).not.toHaveBeenCalled();
    expect((await stored(full.accountId)).quests.active[0]!.step).toBe(11);
  }, 25_000);

  it('equipping the chest completes equip in the same write as the equip', async () => {
    await start();
    const acc = await accountFor(server!.store, 'Eq');
    await storeQuests(server!.store, acc.accountId, mainAt(12));
    const a0 = await stored(acc.accountId);
    const uid = a0.inventory.nextUid;
    await server!.store.writeInventory(a0.id, a0.invVersion, {
      inventory: { ...a0.inventory, bag: [...a0.inventory.bag, { uid, item: 'thornrunner_chest', dye: [0, 0] }], nextUid: uid + 1 }, dGold: 0, dSeals: 0,
    });
    const j = await joinZone(server!.url, acc.token, 'grove');
    const views = questsOf(j.room), done = collectFromJoin(j.room, 'questDone');
    await waitFor(() => views.length > 0);
    await sleep(200);
    const writes = vi.spyOn(server!.store, 'writeInventory');
    sendInv(j.room, { op: 'equip', uid, slot: 'chest' });
    await waitFor(() => done.length > 0, 3000);
    expect(done[0]).toMatchObject({ stepId: 'equip', xp: 20 });
    expect(writes).toHaveBeenCalledTimes(1);
    const w = writes.mock.calls[0]![2] as InvWrite;
    expect(w.inventory.gear.warrior!.chest).toBe(uid);
    expect(w.quests!.active[0]!.step).toBe(13);
  }, 20_000);

  it("the crater completes the quest: title added, unlock home:starter_cottage saved, The Keeper's Lamp offered", async () => {
    await start();
    const c = prop('crater_edge');
    const a = await joinedAt('Cra', { zone: 'greenway', at: { x: c.x + 1, z: c.z }, quests: mainAt(13) });
    sendQuest(a.room, { act: 'use', prop: 'crater_edge' });
    await waitFor(() => a.done.length > 0);
    expect(a.done[0]).toMatchObject({ stepId: 'crater', xp: 40, gold: 30, title: 'Witness of the Crossing', unlock: 'home:starter_cottage', scene: 'crater', questDone: true });
    await waitFor(async () => (await stored(a.accountId)).titles.includes('Witness of the Crossing'));
    const s = await stored(a.accountId);
    expect(s.quests.unlocks).toEqual(['home:starter_cottage']);
    expect(s.quests.done.solstice_crossing).toMatchObject({ times: 1 });
    await waitFor(() => a.last().offers.includes('keepers_lamp'));
    sendQuest(a.room, { act: 'accept', quest: 'keepers_lamp' });
    await waitFor(() => a.last().active.some((q) => q.id === 'keepers_lamp'));
  }, 20_000);

  it('epilogue kills in a Lampfall instance count (Wickhound, Warden)', async () => {
    await start();
    const acc = await accountFor(server!.store, 'Epi');
    await storeQuests(server!.store, acc.accountId, mainDone([{ id: 'keepers_lamp', step: 0, counts: [0], since: today() }]));
    const i = await intoLampfall(server!.url, server!.store, acc);
    const views = questsOf(i.room);
    await waitFor(() => views.at(-1)?.active.find((q) => q.id === 'keepers_lamp')?.step === 1, 3000); // descend: on join
    const room = serverRoom(i.room) as any;
    const w = worldOf(room.combat);
    const L = lampfallLayout();
    const spotIn = (arena: (x: number, z: number) => boolean) => L.rooms.find((r) => arena(r.x, r.z) && room.zone.surface(r.x, r.z) !== null)!;
    const hound = [...w.enemies.values()].find((e) => e.kind === 'wickhound')!;
    const ws = spotIn(lampfallArena('wickhound'));
    place(i.room, ws.x, ws.z);
    await sleep(100);
    await killFor(i.room, hound.id, [{ room: i.room }]);
    await waitFor(() => views.at(-1)?.active.find((q) => q.id === 'keepers_lamp')?.step === 2, 3000);
    const warden = [...w.enemies.values()].find((e) => e.kind === 'fallen_warden')!;
    const wa = spotIn(lampfallArena('warden'));
    place(i.room, wa.x, wa.z);
    await sleep(100);
    await killFor(i.room, warden.id, [{ room: i.room }]);
    await waitFor(() => views.at(-1)?.done.some((d) => d.id === 'keepers_lamp'), 3000);
    const s = await stored(acc.accountId);
    expect(s.quests.done.keepers_lamp).toMatchObject({ times: 1 });
  }, 30_000);

  it('a done quest with the title missing gets it back on join', async () => {
    await start();
    const acc = await accountFor(server!.store, 'Tit');
    await storeQuests(server!.store, acc.accountId, mainDone());
    expect((await stored(acc.accountId)).titles).toEqual([]);
    await joinZone(server!.url, acc.token, 'grove');
    await waitFor(async () => (await stored(acc.accountId)).titles.includes('Witness of the Crossing'), 3000);
  }, 15_000);

  it('nothing new in the state: the encoded patches carry no quest data; quests messages only to their owner', async () => {
    await start();
    const m = npc('marrow');
    const b = await joinedAt('Watcher', { at: { x: m.x - 1.5, z: m.z } });
    const bDone = collect(b.room, 'questDone'), bViews = collect(b.room, 'quests');
    const a = await joinedAt('Talker', { at: { x: m.x + 1.5, z: m.z } });
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.done.length > 0);
    await sleep(300);
    expect(bDone).toEqual([]);
    expect(bViews).toEqual([]);
    // the state's schema has no quest field
    const fields = Object.keys(me(b.room).toJSON());
    for (const f of fields) expect(f.toLowerCase()).not.toMatch(/quest/);
    expect(Object.keys(b.room.state.toJSON()).some((k) => /quest/i.test(k))).toBe(false);
  }, 15_000);

  it('irrelevant kills and jumps cause no extra writes', async () => {
    // Training Dummies drop nothing: with the main quest at Marrow (a talk), 50 kills and a jump write nothing at all
    await start({ zones: { grove: flatZone(camp('dummy', 50, -30)) } });
    const a = await joinedAt('Irr', { at: { x: 0, z: -26 } });
    await sleep(300);
    const writes = vi.spyOn(server!.store, 'writeInventory');
    const w = worldOf(serverRoom(a.room).combat);
    for (const e of [...w.enemies.values()].filter((x) => x.kind === 'dummy')) await killFor(a.room, e.id, [{ room: a.room }]);
    await sendPoses(a.room, jumpPoses(0, -26, flat));
    await sleep(500);
    expect(writes).not.toHaveBeenCalled();
    expect(mainStep(a.views)).toBe(0);
  }, 25_000);
});
