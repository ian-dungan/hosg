// Plan 6 Tasks 3+4 review round 1: quest progress is not lost when a session ends with events or a reward task still
// waiting (a travel, a second tab), quest xp is not lost when a write commits and then throws, and the minor items:
// the in-flight save is forgotten once settled, the view is sent again at UTC midnight, quest gold lost at GOLD_MAX is
// said, a far-future done day cannot lock a daily, busy and dead refusals, the repaired write-back, and views only
// when they changed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  GOLD_MAX, LAMPFALL_MOUTH, STORY_NPCS, STORY_PROPS, lampfallArena, lampfallLayout, newQuestSave, pimGround, worldOf,
  type CampSpawn, type QuestSave, type Surface, type ZoneDef, type ZoneId,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { createMemoryStore } from '../store/memory';
import type { InvWrite, Store } from '../store/types';
import {
  accountFor, collect, collectFromJoin, intoLampfall, joinZone, killFor, place, questsOf, saveAs, sendQuest, serverRoom, sleep, startServer, storeQuests,
  waitFor, type TestServer,
} from './testHelpers';
import { questDay } from './quests';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => day(Date.now());
const flat: Surface = (x, z) => (Math.hypot(x, z) > 300 ? null : 0);
const flatZone = (camps: CampSpawn[]): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const mainAt = (step: number, counts: number[] = [0]): QuestSave => ({ ...newQuestSave(today()), active: [{ id: 'solstice_crossing', step, counts, since: today() }] });
const marrow = STORY_NPCS.marrow;

async function start(over: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ kits: true, combatSeed: 3, serverSeed: 7, store: createMemoryStore(), reconnectSeconds: 1, ...over });
  return server;
}
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);
const sessionOf = (room: Room<any, any>) => (serverRoom(room) as any).sessions.get(room.sessionId);

async function prepared(name: string, o: { zone?: ZoneId; at?: { x: number; z: number }; quests?: QuestSave; gold?: number } = {}) {
  const store = server!.store;
  const account = await accountFor(store, name);
  const zone = o.zone ?? 'grove';
  if (o.at || zone !== 'grove') await saveAs(store, account.accountId, { zone, ...(o.at ?? { x: 0, z: 0 }) });
  if (o.quests) await storeQuests(store, account.accountId, o.quests);
  if (o.gold) {
    const a = await store.getOrCreateAdventurer(account.accountId);
    await store.writeInventory(a.id, a.invVersion, { inventory: a.inventory, dGold: o.gold, dSeals: 0 });
  }
  return account;
}
async function joined(account: { token: string }, zone: ZoneId = 'grove') {
  const j = await joinZone(server!.url, account.token, zone);
  const views = questsOf(j.room), done = collectFromJoin(j.room, 'questDone'), refused = collect(j.room, 'questRefused');
  await waitFor(() => views.length > 0, 3000);
  await sleep(150);
  return { ...j, views, done, refused };
}

/** Holds every inventory write of `adventurerId` until `open()`. */
function holdWrites(store: Store, adventurerId: string) {
  const real = store.writeInventory.bind(store);
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let held = 0;
  vi.spyOn(store, 'writeInventory').mockImplementation(async (id: string, expect: number, w: InvWrite) => {
    if (id === adventurerId) { held++; await gate; }
    return real(id, expect, w);
  });
  return { open: () => release(), held: () => held };
}

describe('Tasks 3+4 review round 1', () => {
  it('I1: a kill whose reward task still waits when a second tab signs in is counted all the same', async () => {
    await start({ zones: { greenway: flatZone([{ kind: 'thornling', x: 0, z: -60, facing: 0 }]) } });
    const acc = await prepared('Kia', { zone: 'greenway', at: { x: 0, z: -36 }, quests: mainAt(8, [0, 0, 0, 0]) });
    const a = await joined(acc, 'greenway');
    const room = serverRoom(a.room);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    // a write in flight (as a loot write would be), and the kill's reward task waiting behind it
    void room.enqueueInventory(acc.accountId, { retries: 0, run: (s, jobs) => ({ kind: 'write', info: null, write: { inventory: s.inv, jobs, dGold: 1, dSeals: 0 }, next: { inv: s.inv, gold: s.gold + 1, seals: s.seals, jobs, look: s.look, lookFree: s.lookFree, quests: s.quests } }) });
    await waitFor(() => hold.held() === 1);
    const t = [...worldOf(room.combat).enemies.values()].find((e) => e.kind === 'thornling')!;
    await killFor(a.room, t.id, [{ room: a.room }]);
    await sleep(200); // the step's reward task is queued behind the held write
    const second = joinZone(server!.url, acc.token, 'greenway');
    await sleep(200);
    hold.open();
    const b = await second;
    const views = questsOf(b.room);
    await waitFor(() => views.length > 0, 3000);
    await waitFor(async () => (await stored(acc.accountId)).quests.active[0]!.counts[0] === 1, 3000);
  }, 20_000);

  it('I1: a place event queued in the step a session ends (an exit, a kick) is counted all the same', async () => {
    await start();
    const p = pimGround();
    const acc = await prepared('Lux', { at: { x: STORY_NPCS.tamsin.x, z: STORY_NPCS.tamsin.z }, quests: mainAt(1) });
    const a = await joined(acc);
    const room = serverRoom(a.room) as any;
    const session = sessionOf(a.room);
    room.questEvent(session, { e: 'reach', zone: 'grove', x: p.x, z: p.z });
    expect(session.questEvents).toHaveLength(1);
    await room.kick(a.room.sessionId); // before the step's flush
    await waitFor(async () => (await stored(acc.accountId)).quests.active[0]!.step === 2, 3000);
  }, 15_000);

  it('I2: a quest write that commits and then throws: the xp still reaches the session (and the store keeps it), and the truth is sent', async () => {
    await start();
    const acc = await prepared('Max', { at: { x: marrow.x + 1.5, z: marrow.z } });
    const a = await joined(acc);
    const xp = collect(a.room, 'jobXp');
    const real = server!.store.writeInventory.bind(server!.store);
    let thrown = 0;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(server!.store, 'writeInventory').mockImplementation(async (id, expect, w) => {
      const r = await real(id, expect, w);
      if (w.quests && thrown === 0) { thrown++; throw new Error('connection lost after commit'); }
      return r;
    });
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.refused.length > 0, 3000);
    expect(a.refused[0].reason).toBe('save');
    await waitFor(() => xp.some((m) => m.gained === 20), 3000);
    await waitFor(() => a.views.at(-1)!.active[0]!.step === 1, 3000); // the stored truth
    await a.room.leave();
    await sleep(200);
    expect((await stored(acc.accountId)).jobs.jobs.warrior!.xp).toBe(20);
    quiet.mockRestore();
  }, 15_000);

  it('the in-flight quests are forgotten once their write settles', async () => {
    await start();
    const acc = await prepared('Ned', { at: { x: marrow.x + 1.5, z: marrow.z } });
    const a = await joined(acc);
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.done.length > 0);
    expect(sessionOf(a.room).questAhead).toBeUndefined();
  }, 15_000);

  it('the view is sent again when the UTC day turns (today and offers change)', async () => {
    let offset = 0;
    await start({ wallClock: () => Date.now() + offset });
    const q: QuestSave = { ...mainAt(7), done: { bristle_bounty: { day: today(), times: 1 } } };
    const acc = await prepared('Ora', { quests: q });
    const a = await joined(acc);
    expect(a.views.at(-1)!.offers).not.toContain('bristle_bounty');
    const n = a.views.length;
    offset = DAY_MS;
    await waitFor(() => a.views.length > n, 3000);
    expect(a.views.at(-1)!.offers).toContain('bristle_bounty');
    expect(a.views.at(-1)!.done.find((d) => d.id === 'bristle_bounty')!.today).toBe(false);
  }, 15_000);

  it('quest gold lost at GOLD_MAX gets the purse-full notice', async () => {
    await start();
    const c = STORY_PROPS.crater_edge;
    const acc = await prepared('Pru', { zone: 'greenway', at: { x: c.x + 1, z: c.z }, quests: mainAt(13), gold: GOLD_MAX - 10 });
    const a = await joined(acc, 'greenway');
    const notices = collect(a.room, 'notice');
    sendQuest(a.room, { act: 'use', prop: 'crater_edge' });
    await waitFor(() => a.done.length > 0);
    expect(a.done[0].gold).toBe(10);
    await waitFor(() => notices.some((m) => /20/.test(m.text)), 3000);
  }, 15_000);

  it('a stored done day far in the future never locks a daily (at most tomorrow counts)', () => {
    const s = { ...mainAt(7), done: { bristle_bounty: { day: '2099-01-01', times: 1 } } };
    expect(questDay(s, '2026-11-12')).toBe('2026-11-12');
    const t = { ...mainAt(7), done: { bristle_bounty: { day: '2026-11-13', times: 1 } } };
    expect(questDay(t, '2026-11-12')).toBe('2026-11-13');
    expect(questDay(t, '2026-12-31')).toBe('2026-12-31');
    const y = { ...mainAt(7), done: { bristle_bounty: { day: '2027-01-01', times: 1 } } };
    expect(questDay(y, '2026-12-31')).toBe('2027-01-01');
  });

  it('acts are refused busy while travelling or displaced, and dead while down', async () => {
    await start();
    const acc = await prepared('Que', { at: { x: marrow.x + 1.5, z: marrow.z } });
    const a = await joined(acc);
    const session = sessionOf(a.room);
    session.awaitingDisplace = true;
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.refused.length === 1);
    session.awaitingDisplace = false;
    session.travelling = new Promise(() => {});
    await sleep(300);
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.refused.length === 2);
    session.travelling = undefined;
    const w = worldOf(serverRoom(a.room).combat);
    killAdventurer(w, w.adventurers.get(session.eid)!, w.now);
    await sleep(300);
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.refused.length === 3);
    expect(a.refused.map((r) => r.reason)).toEqual(['busy', 'busy', 'dead']);
    expect(a.done).toEqual([]);
  }, 15_000);

  it('acts are refused busy inside a sealed boss arena', async () => {
    await start();
    const acc = await prepared('Ray', { quests: { ...newQuestSave(today()), active: [], done: { solstice_crossing: { day: today(), times: 1 } } } });
    const i = await intoLampfall(server!.url, server!.store, acc);
    const views = questsOf(i.room), refused = collect(i.room, 'questRefused');
    await waitFor(() => views.length > 0);
    const room = serverRoom(i.room) as any;
    const L = lampfallLayout(), arena = lampfallArena('wickhound');
    const spot = L.rooms.find((r) => arena(r.x, r.z) && room.zone.surface(r.x, r.z) !== null)!;
    place(i.room, spot.x, spot.z);
    await sleep(100);
    room.inst.sealed = 'wickhound';
    sendQuest(i.room, { act: 'accept', quest: 'keepers_lamp' });
    await waitFor(() => refused.length > 0);
    expect(refused[0].reason).toBe('busy');
    room.inst.sealed = null;
    await sleep(300);
    sendQuest(i.room, { act: 'accept', quest: 'keepers_lamp' });
    await waitFor(() => views.at(-1)!.active.some((q) => q.id === 'keepers_lamp'), 3000);
    void LAMPFALL_MOUTH;
  }, 25_000);

  it('repaired quests are written back once on join', async () => {
    await start();
    const acc = await prepared('Sid', { quests: mainAt(3) });
    const store = server!.store;
    const real = store.getOrCreateAdventurer.bind(store);
    // the store read had to repair this adventurer's quests (as for garbage JSON): the room writes the repaired save back
    vi.spyOn(store, 'getOrCreateAdventurer').mockImplementation(async (id) => ({ ...(await real(id)), questsRepaired: true as const }));
    const writes = vi.spyOn(store, 'writeInventory');
    await joined(acc);
    await sleep(300);
    const withQuests = writes.mock.calls.filter((c) => (c[2] as InvWrite).quests !== undefined);
    expect(withQuests).toHaveLength(1);
    expect((withQuests[0]![2] as InvWrite).quests).toEqual(mainAt(3));
    expect((withQuests[0]![2] as InvWrite).jobs).toBeUndefined();
  }, 15_000);

  it('a quests view is sent only when it changed', async () => {
    await start();
    const acc = await prepared('Tor');
    const a = await joined(acc);
    const room = serverRoom(a.room) as any;
    const n = a.views.length;
    room.sendQuests(sessionOf(a.room));
    room.sendQuests(sessionOf(a.room));
    await sleep(300);
    expect(a.views.length).toBe(n);
  }, 15_000);
});
