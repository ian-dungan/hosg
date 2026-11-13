// Plan 6 Review Focus 1: every quest reward is given exactly once, whatever arrives twice, races or fails: the same
// talk sent 20 times, a second tab, a disconnect right after, one kill through two credits, a stale version, kill xp
// landing mid-write, a daily taken again, and a client that floods `quest` messages.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QUEST_OPS_PER_S, STORY_NPCS, newQuestSave, type CampSpawn, type QuestSave, type Surface, type ZoneDef } from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { InvWrite, Store } from '../store/types';
import {
  accountFor, collect, collectFromJoin, joinZone, killFor, partyUp, questsOf, saveAs, sendQuest, serverRoom, sleep, startServer, storeQuests, waitFor,
  type TestServer,
} from './testHelpers';
import { worldOf } from '@sg2/shared';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const DAY_MS = 86_400_000;
const flat: Surface = (x, z) => (Math.hypot(x, z) > 300 ? null : 0);
const flatZone = (camps: CampSpawn[]): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = () => day(Date.now());
const marrow = STORY_NPCS.marrow, bram = STORY_NPCS.bram;

async function start(over: Parameters<typeof startServer>[0] = {}) {
  server = await startServer({ kits: true, combatSeed: 3, serverSeed: 7, store: createMemoryStore(), reconnectSeconds: 1, ...over });
  return server;
}
const stored = (accountId: string) => server!.store.getOrCreateAdventurer(accountId);

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

async function prepared(name: string, at: { x: number; z: number }, quests?: QuestSave, zone: 'grove' | 'greenway' = 'grove') {
  const account = await accountFor(server!.store, name);
  await saveAs(server!.store, account.accountId, { zone, ...at });
  if (quests) await storeQuests(server!.store, account.accountId, quests);
  return account;
}
async function joined(account: { token: string }, zone: 'grove' | 'greenway' = 'grove') {
  const j = await joinZone(server!.url, account.token, zone);
  const views = questsOf(j.room), done = collectFromJoin(j.room, 'questDone'), refused = collect(j.room, 'questRefused');
  await waitFor(() => views.length > 0, 3000);
  return { ...j, views, done, refused };
}
const xpOf = async (accountId: string) => (await stored(accountId)).jobs.jobs.warrior!.xp;

describe('quest rewards are paid exactly once', () => {
  it('the completing talk sent 20 times in one tick pays once', async () => {
    await start();
    const acc = await prepared('Ada', { x: marrow.x + 1.5, z: marrow.z });
    const a = await joined(acc);
    for (let i = 0; i < 20; i++) sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.done.length > 0);
    await sleep(500);
    expect(a.done).toHaveLength(1);
    expect(await xpOf(acc.accountId)).toBe(20);
    expect((await stored(acc.accountId)).quests.active[0]!.step).toBe(1);
    // the rest: 'rate' past the bucket, or nothing (a talk that completes nothing writes and says nothing)
    expect(a.refused.every((r) => r.reason === 'rate')).toBe(true);
  }, 15_000);

  it('a second tab sends the same talk mid-queue: paid once', async () => {
    await start();
    const acc = await prepared('Bea', { x: marrow.x + 1.5, z: marrow.z });
    const a = await joined(acc);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => hold.held() === 1);
    const second = joined(acc); // kicks the first; its join waits for the write in flight
    await sleep(200);
    hold.open();
    const b = await second;
    sendQuest(b.room, { act: 'talk', npc: 'marrow' });
    await sleep(500);
    expect(b.done).toEqual([]);
    expect(b.views.at(-1)!.active[0]!.step).toBe(1);
    expect(await xpOf(acc.accountId)).toBe(20);
  }, 15_000);

  it('a disconnect right after the completing talk: after rejoin store and view agree, paid once', async () => {
    await start();
    const acc = await prepared('Cid', { x: marrow.x + 1.5, z: marrow.z });
    const a = await joined(acc);
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await a.room.leave();
    const b = await joined(acc);
    await sleep(300);
    const s = await stored(acc.accountId);
    expect(b.views.at(-1)!.active[0]!.step).toBe(s.quests.active[0]!.step);
    expect(s.jobs.jobs.warrior!.xp).toBe(s.quests.active[0]!.step === 1 ? 20 : 0);
    sendQuest(b.room, { act: 'talk', npc: 'marrow' }); // done already, or done now: never twice
    await sleep(500);
    expect(await xpOf(acc.accountId)).toBe(20);
    expect((await stored(acc.accountId)).quests.active[0]!.step).toBe(1);
  }, 15_000);

  it('the same kill through the engine credit and the party share counts once', async () => {
    await start({ zones: { greenway: flatZone([{ kind: 'thornling', x: 0, z: -40, facing: 0 }]) } });
    const at = (step: number): QuestSave => ({ ...newQuestSave(today()), active: [{ id: 'solstice_crossing', step, counts: [0, 0, 0, 0], since: today() }] });
    const accA = await prepared('Dan', { x: 0, z: -36 }, at(8), 'greenway');
    const accB = await prepared('Eli', { x: 2, z: -36 }, at(8), 'greenway');
    const a = await joined(accA, 'greenway'), b = await joined(accB, 'greenway');
    await partyUp(a.room, b.room, 'Eli');
    const w = worldOf(serverRoom(a.room).combat);
    const t = [...w.enemies.values()].find((e) => e.kind === 'thornling')!;
    // both on its threat table (engine credit) and in one party (the share): one kill, one count each
    await killFor(a.room, t.id, [{ room: a.room }, { room: b.room }]);
    await waitFor(() => a.views.at(-1)!.active[0]!.counts[0] === 1 && b.views.at(-1)!.active[0]!.counts[0] === 1, 3000);
    await sleep(400);
    expect(a.views.at(-1)!.active[0]!.counts[0]).toBe(1);
    expect(b.views.at(-1)!.active[0]!.counts[0]).toBe(1);
    expect((await stored(accA.accountId)).quests.seen).toHaveLength(1);
  }, 20_000);

  it('a stale version from a Seal in between: retried on the truth, paid once', async () => {
    await start();
    const acc = await prepared('Fay', { x: marrow.x + 1.5, z: marrow.z });
    const a = await joined(acc);
    await sleep(200);
    const adv = await stored(acc.accountId);
    expect(await server!.store.awardSeal(adv.id, today())).toMatchObject({ awarded: true }); // behind the queue's back
    const writes = vi.spyOn(server!.store, 'writeInventory');
    sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.done.length > 0, 3000);
    await sleep(300);
    expect(writes.mock.results.length).toBe(2); // stale, then written on the fresh truth
    const s = await stored(acc.accountId);
    expect(s).toMatchObject({ seals: 1 });
    expect(s.jobs.jobs.warrior!.xp).toBe(20);
    expect(a.done).toHaveLength(1);
  }, 15_000);

  it("a kill landing between the reward task's run and its write: both xp amounts end in the session and in the store", async () => {
    await start({ zones: { grove: flatZone([{ kind: 'thornling', x: 0, z: -60, facing: 0 }]) } });
    const acc = await prepared('Gil', { x: 0, z: -27 });
    // the Guild Board step (a job or picks choice completes it, 20 xp)
    const s0: QuestSave = { ...newQuestSave(today()), active: [{ id: 'solstice_crossing', step: 5, counts: [0], since: today() }] };
    await storeQuests(server!.store, acc.accountId, s0);
    const a = await joined(acc);
    const xpMsgs = collect(a.room, 'jobXp');
    await sleep(200);
    const hold = holdWrites(server!.store, (await stored(acc.accountId)).id);
    a.room.send('loadout', { picks: ['bulwark', 'mend'] }); // completes `board` (20 xp): its write is held
    await waitFor(() => hold.held() === 1, 3000);
    const w = worldOf(serverRoom(a.room).combat);
    const t = [...w.enemies.values()].find((e) => e.kind === 'thornling')!;
    await killFor(a.room, t.id, [{ room: a.room }]);
    await waitFor(() => xpMsgs.length > 0, 3000);
    const killXp = xpMsgs[0].gained as number;
    expect(killXp).toBeGreaterThan(0);
    hold.open();
    await waitFor(() => a.done.length > 0, 3000);
    await waitFor(() => xpMsgs.some((m) => m.gained === 20), 3000);
    expect(xpMsgs.at(-1)!.xp).toBe(killXp + 20); // the session holds both
    await a.room.leave();
    await waitFor(async () => (await xpOf(acc.accountId)) === killXp + 20, 3000); // and so does the store
  }, 20_000);

  it('daily: complete, abandon, accept again the same day → done-today; next day accepted', async () => {
    let offset = 0;
    await start({ wallClock: () => Date.now() + offset });
    const past: QuestSave = { ...newQuestSave(today()), active: [{ id: 'solstice_crossing', step: 7, counts: [0], since: today() }] };
    const acc = await prepared('Hal', { x: bram.x + 1.2, z: bram.z }, past);
    const a = await joined(acc);
    const last = () => a.views.at(-1)!;
    expect(last().offers).toContain('bristle_bounty');
    // accept, abandon, accept again: allowed (not completed today)
    sendQuest(a.room, { act: 'accept', quest: 'bristle_bounty' });
    await waitFor(() => last().active.some((q) => q.id === 'bristle_bounty'));
    sendQuest(a.room, { act: 'abandon', quest: 'bristle_bounty' });
    await waitFor(() => !last().active.some((q) => q.id === 'bristle_bounty'));
    await sleep(300);
    sendQuest(a.room, { act: 'accept', quest: 'bristle_bounty' });
    await waitFor(() => last().active.some((q) => q.id === 'bristle_bounty'));
    // complete it: six boars counted (stored straight, as the server's own events would), then tell Bram
    await a.room.leave();
    const s = await stored(acc.accountId);
    await storeQuests(server!.store, acc.accountId, { ...s.quests, active: s.quests.active.map((q) => (q.id === 'bristle_bounty' ? { ...q, step: 1, counts: [0] } : q)) });
    const b = await joined(acc);
    const lastB = () => b.views.at(-1)!;
    sendQuest(b.room, { act: 'talk', npc: 'bram' });
    await waitFor(() => b.done.length > 0);
    expect(b.done[0]).toMatchObject({ quest: 'bristle_bounty', xp: 50, gold: 20, questDone: true });
    await sleep(200);
    sendQuest(b.room, { act: 'accept', quest: 'bristle_bounty' });
    await waitFor(() => b.refused.length > 0);
    expect(b.refused[0]).toMatchObject({ act: 'accept', reason: 'done-today', text: 'Come back tomorrow for that one.' });
    expect(lastB().offers).not.toContain('bristle_bounty');
    // clock skew: a save whose daily was done "tomorrow" (by a clock that ran ahead) is still done today here
    await b.room.leave();
    const s2 = await stored(acc.accountId);
    await storeQuests(server!.store, acc.accountId, { ...s2.quests, done: { ...s2.quests.done, bristle_bounty: { day: day(Date.now() + DAY_MS), times: 1 } } });
    const c = await joined(acc);
    expect(c.views.at(-1)!.offers).not.toContain('bristle_bounty');
    sendQuest(c.room, { act: 'accept', quest: 'bristle_bounty' });
    await waitFor(() => c.refused.length > 0);
    expect(c.refused[0].reason).toBe('done-today');
    // the day after that: offered and accepted
    offset = 2 * DAY_MS;
    await sleep(300);
    sendQuest(c.room, { act: 'accept', quest: 'bristle_bounty' });
    await waitFor(() => c.views.at(-1)!.active.some((q) => q.id === 'bristle_bounty'), 3000);
    expect((await stored(acc.accountId)).gold).toBe(20);
  }, 25_000);

  it('30 quest messages a second: rate after 4', async () => {
    await start();
    const acc = await prepared('Ivy', { x: marrow.x + 10, z: marrow.z });
    const a = await joined(acc);
    for (let i = 0; i < 30; i++) sendQuest(a.room, { act: 'talk', npc: 'marrow' });
    await waitFor(() => a.refused.length === 30, 3000);
    expect(QUEST_OPS_PER_S).toBe(4);
    // (the four the bucket let through are refused where when their task runs: after the 26 refused at once)
    expect(a.refused.filter((r) => r.reason === 'where')).toHaveLength(4);
    expect(a.refused.filter((r) => r.reason === 'rate')).toHaveLength(26);
    expect(a.refused[0]).toEqual({ act: 'talk', reason: 'rate', text: 'Slow down a little.' });
    // junk never throws and never changes anything
    for (const junk of [null, 7, 'talk', { act: 'talk' }, { act: 'talk', npc: 'marrow', choice: -1 }, { act: 'talk', npc: 'marrow', choice: NaN }, { act: 'accept', quest: 'x'.repeat(5000) }, { act: 'use', prop: 'plaque', extra: 1 }]) {
      await sleep(260);
      sendQuest(a.room, junk);
    }
    await waitFor(() => a.refused.length === 38, 5000);
    expect(a.refused.slice(30).every((r) => r.act === null && r.reason === 'unknown')).toBe(true);
    expect((await stored(acc.accountId)).quests).toEqual(newQuestSave(today()));
  }, 20_000);
});
