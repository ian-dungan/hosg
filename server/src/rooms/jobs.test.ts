// Jobs in the zone room: the job and picks intents (town-only switching, per-job picks), every
// ability press checked against the current job, per-job xp from kills, casts and buffs mirrored to
// the state, ally-aimed supports, revives where the body lies (and their races with respawns and
// saves), Plan 3 saves, and state fields that change only on events. Timers run on testClock.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  ABILITIES, DEATH_MIN_S, JOBS, REASON_ELSEWHERE, KILL_XP, MAX_HP, SPAWN, TICK_HZ, isJobsSave, levelForXp, newJobsSave, slotsFor, totalTo, worldOf, xpToNext,
  type AbilityId, type CampSpawn, type JobId, type JobsSave, type Surface, type ZoneDef, type ZoneId,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import type { AdventurerSave, Store } from '../store/types';
import { SECRET, accountFor, collect, collectFromJoin, joinZone, saveAs, serverRoom, sleep, startServer, testClock, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(opts?: Parameters<typeof startServer>[0]): Promise<TestServer> {
  server = await startServer({ combatSeed: 11, ...opts });
  return server;
}

/** Flat open ground everywhere within 200 m, all in sight (the zone's own exits stay where they are). */
const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatZone = (camps: CampSpawn[], more: Partial<ZoneDef> = {}): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps, ...more });
const DUMMY: CampSpawn = { kind: 'dummy', x: 3, z: -11, facing: 0 };
const THORNLING: CampSpawn = { kind: 'thornling', x: 0, z: -40, facing: 0 };
/** The grove (a town) with a dummy, and a Greenway (not a town) with a dummy near (0, -20). */
const zones = (grove: CampSpawn[] = [DUMMY], greenway: CampSpawn[] = [{ kind: 'dummy', x: 0, z: -20, facing: 0 }], more: Partial<ZoneDef> = {}) => ({
  zones: { grove: flatZone(grove, more), greenway: flatZone(greenway) },
});

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const enemyOf = (room: Room<any, any>, kind: string) => [...room.state.enemies.values()].find((e: any) => e.kind === kind);
const events = (fx: any[]) => fx.flatMap((m) => m.events);
const pose = (x: number, z: number, ack = 0) => ({ x, z, y: 0, facing: 0, moving: false, ack });

/** A save with `job` current and its picks (default: its solo picks). */
function jobsAs(job: JobId, picks?: [AbilityId, AbilityId]): JobsSave {
  const s = newJobsSave(job);
  if (picks) s.jobs[job]!.picks = [picks[0], picks[1]];
  return s;
}

/** Joins `zone` with the adventurer saved at (x, z) (and any other changes) first. */
async function joinAt(url: string, store: Store, name: string, x: number, z: number, more: Parameters<typeof saveAs>[2] = {}, zone: ZoneId = 'grove') {
  const account = await accountFor(store, name);
  await saveAs(store, account.accountId, { x, z, facing: 0, zone, ...more });
  return { ...(await joinZone(url, account.token, zone)), ...account };
}

/** The adventurer's engine state in the server room behind `room`. */
function engineOf(room: Room<any, any>) {
  const combat = serverRoom(room).combat;
  return { w: worldOf(combat), a: worldOf(combat).adventurers.get(me(room).eid)! };
}

/** Kills the adventurer behind `room` in its engine (the room sees the death on its next step). */
function kill(room: Room<any, any>) {
  const { w, a } = engineOf(room);
  killAdventurer(w, a, w.now);
}

const stored = async (store: Store, accountId: string) => store.getOrCreateAdventurer(accountId);

describe('job switching', () => {
  it('join sends jobs; a new adventurer is a level 1 Warrior', async () => {
    const { url, store } = await start(zones());
    const account = await accountFor(store, 'Alice');
    const joined = await joinZone(url, account.token, 'grove');
    const jobs = collectFromJoin(joined.room, 'jobs');
    const selves = collect(joined.room, 'self');
    await waitFor(() => jobs.length > 0 && selves.length > 0);
    expect(jobs[0].current).toBe('warrior');
    expect(Object.keys(jobs[0].jobs).sort()).toEqual(Object.keys(JOBS).sort());
    expect(jobs[0].jobs.warrior).toEqual({ level: 1, xp: 0, next: xpToNext(0), picks: [...JOBS.warrior.picks.solo] });
    expect(jobs[0].jobs.ninja).toEqual({ level: 1, xp: 0, next: xpToNext(0), picks: [...JOBS.ninja.picks.solo] });
    expect(me(joined.room)).toMatchObject({ job: 'warrior', weapon: 'blade' });
    // unset until their first event (an adventurer coming into a view arrives whole): read as '' and 0
    for (const k of ['cast', 'castTotal', 'castAt', 'buffs']) expect(me(joined.room)[k] ?? 0).toBeFalsy();
    expect(selves[0]).toMatchObject({ job: 'warrior', dodgeMax: JOBS.warrior.dodgeCharges, cast: null, slots: slotsFor({ job: 'warrior', picks: [...JOBS.warrior.picks.solo] }) });
    expect(enemyOf(joined.room, 'dummy').debuffs ?? 0).toBe(0);
  });

  it('job in the grove: slots, state.job, state.weapon change; jobs sent; saved at once; rejoin keeps it', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const jobs = collectFromJoin(a.room, 'jobs');
    const selves = collect(a.room, 'self');
    const refused = collect(a.room, 'refused');
    await waitFor(() => jobs.length > 0);
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => jobs.some((j) => j.current === 'ninja'));
    await waitFor(() => me(a.room).job === 'ninja');
    expect(me(a.room).weapon).toBe(JOBS.ninja.weapon);
    const slots = slotsFor({ job: 'ninja', picks: [...JOBS.ninja.picks.solo] });
    await waitFor(() => selves.some((s) => s.job === 'ninja'));
    expect(selves.at(-1)).toMatchObject({ job: 'ninja', slots, dodgeMax: 3 });
    // saved at once (not at the next periodic save, nor on leaving)
    await waitFor(async () => (await stored(store, a.accountId)).jobs.current === 'ninja');
    expect((await stored(store, a.accountId)).jobs.jobs.warrior).toBeDefined(); // the Warrior's record is kept
    expect(refused).toEqual([]);
    // a relog after the change (Task 5 review: nothing of the Plan 3 bridge survives)
    await a.room.leave();
    const again = await joinZone(url, a.token, 'grove');
    const jobs2 = collectFromJoin(again.room, 'jobs');
    const selves2 = collect(again.room, 'self');
    await waitFor(() => jobs2.length > 0 && selves2.length > 0);
    expect(jobs2[0].current).toBe('ninja');
    expect(me(again.room)).toMatchObject({ job: 'ninja', weapon: 'daggers' });
    expect(selves2[0].slots).toEqual(slots);
  });

  it("a saved Ninja joins with the Ninja's three dodges", async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z, { jobs: jobsAs('ninja') });
    const selves = collectFromJoin(a.room, 'self');
    await waitFor(() => selves.length > 0);
    expect(selves[0]).toMatchObject({ job: 'ninja', dodgeCharges: JOBS.ninja.dodgeCharges, dodgeMax: JOBS.ninja.dodgeCharges });
  });

  it('job in the Greenway → refused not-here, nothing changes', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', 0, -12, {}, 'greenway');
    const jobs = collectFromJoin(a.room, 'jobs');
    const selves = collect(a.room, 'self');
    const refused = collect(a.room, 'refused');
    await waitFor(() => jobs.length > 0 && selves.length > 0);
    engineOf(a.room).a.momentum = 30;
    await sleep(300);
    const before = { self: selves.at(-1), saved: (await stored(store, a.accountId)).jobs };
    expect(before.self.momentum).toBeGreaterThan(0);
    for (const job of ['ranger', 'white_mage']) a.room.send('job', { job });
    await waitFor(() => refused.length === 2);
    expect(refused).toEqual([{ action: 'job', reason: 'not-here' }, { action: 'job', reason: 'not-here' }]);
    await sleep(300);
    expect(me(a.room)).toMatchObject({ job: 'warrior', weapon: 'blade' });
    expect(jobs.length).toBe(1);
    expect(selves.at(-1)).toMatchObject({ job: 'warrior', slots: before.self.slots, cd: before.self.cd });
    expect(selves.at(-1).momentum).toBeGreaterThan(before.self.momentum - 10); // no reset (only decay)
    expect((await stored(store, a.accountId)).jobs).toEqual(before.saved);
  });

  it('job while in combat, dead, casting, travelling → refused with the right reason; unknown and future ids → invalid', async () => {
    const clock = testClock(1);
    const exit = { to: 'greenway' as const, x: 12, z: -2, r: 1, arrive: { x: 0, z: -30, facing: 0 }, open: true };
    const { url, store } = await start({ ...zones([DUMMY], undefined, { exits: [exit] }), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 3, -6, { jobs: jobsAs('black_mage') });
    const refused = collect(a.room, 'refused');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    // unknown and future jobs, junk
    a.room.send('job', { job: 'monk' });
    a.room.send('job', { job: 'nobody' });
    a.room.send('job', { job: 7 });
    a.room.send('job', 'warrior');
    await waitFor(() => refused.length >= 4);
    expect(refused.slice(0, 4)).toEqual(Array(4).fill({ action: 'job', reason: 'invalid' }));
    // casting (Hearthfall, 2.5 s)
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
    a.room.send('ability', { slot: 2, phase: 'press' });
    await waitFor(() => me(a.room).cast === 'hearthfall');
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => refused.length >= 5);
    expect(refused[4]).toEqual({ action: 'job', reason: 'busy' });
    // in combat (it hit the dummy)
    await waitFor(() => me(a.room).cast === '', 4000);
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => refused.length >= 6);
    expect(refused[5]).toEqual({ action: 'job', reason: 'in-combat' });
    // dead
    kill(a.room);
    await waitFor(() => me(a.room).dead);
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => refused.length >= 7);
    expect(refused[6]).toEqual({ action: 'job', reason: 'dead' });
    expect(me(a.room).job).toBe('black_mage');

    // travelling: the travel's save is held back while the job arrives
    const b = await joinAt(url, store, 'Bob', 9, -2);
    const bRefused = collect(b.room, 'refused');
    const save = store.saveAdventurer.bind(store);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(store, 'saveAdventurer').mockImplementation(async (s: AdventurerSave, e?: { zone: ZoneId }) => {
      if (s.zone === 'greenway') await held;
      return save(s, e);
    });
    for (let x = 9.4; x <= 12; x += 0.4) {
      b.room.send('move', pose(Math.min(x, 12), -2));
      await sleep(1000 / TICK_HZ);
    }
    await waitFor(() => (serverRoom(b.room) as any).sessions.get(b.room.sessionId)?.travelling !== undefined);
    b.room.send('job', { job: 'ranger' });
    await waitFor(() => bRefused.length > 0);
    expect(bRefused).toEqual([{ action: 'job', reason: 'busy' }]);
    release();
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'greenway');
    expect((await stored(store, b.accountId)).jobs.current).toBe('warrior');
  }, 15_000);

  it('job spam: 40 in a burst → at most the intent budget reach the engine, the rest refused rate', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const refused = collect(a.room, 'refused');
    const jobs = collectFromJoin(a.room, 'jobs');
    await waitFor(() => jobs.length > 0);
    const room = serverRoom(a.room);
    const intent = vi.spyOn(room.combat, 'intent');
    const saves = vi.spyOn(store, 'saveAdventurer');
    for (let i = 0; i < 40; i++) a.room.send('job', { job: i % 2 === 0 ? 'ninja' : 'paladin' });
    await waitFor(() => refused.some((r) => r.reason === 'rate'));
    await sleep(500);
    const jobIntents = intent.mock.calls.filter(([, i]) => i.t === 'job').length;
    expect(jobIntents).toBeLessThanOrEqual(30);
    expect(jobIntents).toBeGreaterThan(0);
    expect(refused.filter((r) => r.reason === 'rate')).toEqual([{ action: 'job', reason: 'rate' }]); // throttled, once
    expect(refused.filter((r) => r.reason !== 'rate')).toEqual([]);
    // job saves are coalesced: never one per message
    expect(saves.mock.calls.length).toBeLessThan(10);
    await waitFor(async () => (await stored(store, a.accountId)).jobs.current === me(a.room).job);
  });

  it('each job remembers its picks', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const jobs = collectFromJoin(a.room, 'jobs');
    const selves = collect(a.room, 'self');
    await waitFor(() => jobs.length > 0);
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => jobs.at(-1).current === 'ninja');
    a.room.send('loadout', { picks: ['weak_point', 'quickstep'] });
    await waitFor(() => jobs.at(-1).jobs.ninja.picks[0] === 'weak_point');
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => jobs.at(-1).current === 'warrior');
    expect(jobs.at(-1).jobs.warrior.picks).toEqual([...JOBS.warrior.picks.solo]);
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => jobs.at(-1).current === 'ninja');
    expect(jobs.at(-1).jobs.ninja.picks).toEqual(['weak_point', 'quickstep']);
    await waitFor(() => selves.at(-1)?.job === 'ninja' && selves.at(-1).slots[3] === 'weak_point');
    expect(selves.at(-1).slots).toEqual(slotsFor({ job: 'ninja', picks: ['weak_point', 'quickstep'] }));
    await a.room.leave();
    await waitFor(async () => (await stored(store, a.accountId)).jobs.jobs.ninja?.picks[0] === 'weak_point');
  });

  it('a job or picks change keeps curve 2, xp, talents and outfit (the save passes isJobsSave)', async () => {
    const { url, store } = await start(zones());
    const outfit = { body: 'orchard_smock' as const, head: null, back: null, hideHead: true };
    const saved: JobsSave = {
      current: 'warrior', curve: 2,
      jobs: { warrior: { level: 7, xp: totalTo(7) + 5, picks: ['mend', 'bulwark'], talents: ['warrior_1b', 'warrior_2c'], outfit } },
    };
    expect(isJobsSave(saved)).toBe(true);
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z, { jobs: saved });
    const jobs = collectFromJoin(a.room, 'jobs');
    await waitFor(() => jobs.length > 0);
    a.room.send('job', { job: 'ninja' });
    await waitFor(async () => (await stored(store, a.accountId)).jobs.current === 'ninja');
    let s = (await stored(store, a.accountId)).jobs;
    expect(isJobsSave(s)).toBe(true);
    expect(s.curve).toBe(2);
    expect(s.jobs.warrior).toEqual(saved.jobs.warrior);
    a.room.send('loadout', { picks: ['weak_point', 'quickstep'] });
    await waitFor(() => jobs.at(-1).jobs.ninja.picks[0] === 'weak_point');
    a.room.send('job', { job: 'warrior' });
    await waitFor(async () => (await stored(store, a.accountId)).jobs.current === 'warrior');
    s = (await stored(store, a.accountId)).jobs;
    expect(isJobsSave(s)).toBe(true);
    expect(s.curve).toBe(2);
    expect(s.jobs.warrior).toEqual(saved.jobs.warrior);
    expect(s.jobs.ninja!.picks).toEqual(['weak_point', 'quickstep']);
  });

  it("loadout with another job's ability, a duplicate, a bar ability or an unknown id → refused invalid", async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const refused = collect(a.room, 'refused');
    const jobs = collectFromJoin(a.room, 'jobs');
    await waitFor(() => jobs.length > 0);
    for (const picks of [['mend', 'sprint'], ['mend', 'mend'], ['slash', 'mend'], ['mend', 'nothing']]) a.room.send('loadout', { picks });
    a.room.send('loadout', { free: ['mend', 'bulwark'] }); // Plan 3's shape: dropped
    a.room.send('loadout', { picks: ['mend'] });
    a.room.send('loadout', 'everything');
    await waitFor(() => refused.length >= 4);
    await sleep(200);
    expect(refused).toEqual(Array(4).fill({ action: 'loadout', reason: 'invalid' }));
    expect(jobs.length).toBe(1);
    expect((await stored(store, a.accountId)).jobs.jobs.warrior!.picks).toEqual([...JOBS.warrior.picks.solo]);
    // a valid change is taken, sent and kept
    a.room.send('loadout', { picks: ['rallying_roar', 'skullringer'] });
    await waitFor(() => jobs.length === 2);
    expect(jobs[1].jobs.warrior.picks).toEqual(['rallying_roar', 'skullringer']);
  });

  it("slot 1 after a switch is the new job's quick skill (a use fx names it)", async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', 3, -12.4);
    const fx = collect(a.room, 'fx');
    const jobs = collectFromJoin(a.room, 'jobs');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    await waitFor(() => jobs.length > 0);
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => me(a.room).job === 'ninja');
    a.room.send('target', { id: dummy.eid });
    a.room.send('ability', { slot: 0, phase: 'press' });
    await waitFor(() => events(fx).some((e) => e.t === 'use' && e.src === me(a.room).eid));
    expect(events(fx).find((e) => e.t === 'use').ability).toBe(JOBS.ninja.bar[0]);
  });

  it('cooldowns are kept per ability id across a job change, and Momentum is reset', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z, { hp: 50 });
    const selves = collect(a.room, 'self');
    const jobs = collectFromJoin(a.room, 'jobs');
    await waitFor(() => jobs.length > 0);
    a.room.send('ability', { slot: 3, phase: 'press' }); // Mend
    await waitFor(() => selves.some((s) => s.cd[3] > 0));
    engineOf(a.room).a.momentum = 40;
    a.room.send('job', { job: 'paladin' });
    await waitFor(() => selves.at(-1)?.job === 'paladin');
    expect(selves.at(-1).momentum).toBe(0);
    a.room.send('job', { job: 'warrior' });
    await waitFor(() => selves.at(-1)?.job === 'warrior');
    expect(selves.at(-1).cd[3]).toBeGreaterThan(ABILITIES.mend.cooldown - 3);
  });
});

describe('job xp', () => {
  it('kill credit gives job xp to the current job only; jobXp and jobs sent; persists across relog; the dummy gives none', async () => {
    const { url, store } = await start(zones([{ kind: 'dummy', x: 8, z: -34, facing: 0 }, THORNLING]));
    const a = await joinAt(url, store, 'Alice', 0, -36, { jobs: jobsAs('ranger') });
    const b = await joinAt(url, store, 'Bob', 0.9, -38.8);
    const jobXp = collect(a.room, 'jobXp'), credits = collect(a.room, 'credit'), jobs = collectFromJoin(a.room, 'jobs');
    const bJobXp = collect(b.room, 'jobXp');
    await waitFor(() => jobs.length > 0);
    const thornling = await waitFor(() => enemyOf(a.room, 'thornling'));
    a.room.send('target', { id: thornling.eid });
    b.room.send('target', { id: thornling.eid });
    // both on its threat table, then it is one hit from death
    const e = [...worldOf(serverRoom(a.room).combat).enemies.values()].find((x) => x.kind === 'thornling')!;
    await waitFor(() => e.threat.has(me(a.room).eid) && e.threat.has(me(b.room).eid), 4000);
    e.hp = 1;
    await waitFor(() => credits.length > 0 && jobXp.length > 0 && bJobXp.length > 0, 4000);
    const gain = KILL_XP.thornling;
    expect(credits).toEqual([{ kind: 'thornling' }]);
    expect(jobXp).toEqual([{ job: 'ranger', gained: gain, xp: gain, level: levelForXp(gain), levelUp: false }]);
    expect(bJobXp).toEqual([{ job: 'warrior', gained: gain, xp: gain, level: levelForXp(gain), levelUp: false }]);
    await waitFor(() => jobs.length > 1);
    expect(jobs.at(-1).jobs.ranger).toMatchObject({ xp: gain, next: xpToNext(gain) });
    expect(jobs.at(-1).jobs.warrior).toMatchObject({ xp: 0 });
    // the Training Dummy gives nothing (and sends no jobs)
    const dummy = enemyOf(a.room, 'dummy');
    const d = [...worldOf(serverRoom(a.room).combat).enemies.values()].find((x) => x.kind === 'dummy')!;
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => d.threat.has(me(a.room).eid), 4000);
    d.hp = 1;
    await waitFor(() => credits.length > 1, 4000);
    await waitFor(() => jobXp.length > 1);
    expect(jobXp[1]).toEqual({ job: 'ranger', gained: 0, xp: gain, level: levelForXp(gain), levelUp: false });
    await sleep(200);
    expect(jobs.length).toBe(2);
    // per job, saved
    await a.room.leave();
    await waitFor(async () => (await stored(store, a.accountId)).jobs.jobs.ranger?.xp === gain);
    expect((await stored(store, a.accountId)).jobs.jobs.warrior?.xp ?? 0).toBe(0);
    const again = await joinZone(url, a.token, 'grove');
    const jobs2 = collectFromJoin(again.room, 'jobs');
    await waitFor(() => jobs2.length > 0);
    expect(jobs2[0].jobs.ranger.xp).toBe(gain);
  }, 15_000);
});

describe('casts, allies and revives', () => {
  it('a cast shows in state (cast, castTotal, castAt) and clears at its end', async () => {
    const clock = testClock(2);
    const { url, store } = await start({ ...zones(), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 3, -5, { jobs: jobsAs('black_mage') });
    const b = await joinAt(url, store, 'Bob', 2, -4);
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
    a.room.send('ability', { slot: 2, phase: 'press' });
    const seen = await waitFor(() => b.room.state.players.get(a.room.sessionId)?.cast === 'hearthfall' && b.room.state.players.get(a.room.sessionId));
    expect(seen.castTotal).toBe(ABILITIES.hearthfall.cast);
    expect(Math.abs(b.room.state.clock - seen.castAt)).toBeLessThanOrEqual(3);
    const castAt = seen.castAt;
    await sleep(300);
    expect(b.room.state.players.get(a.room.sessionId).castAt).toBe(castAt); // not rewritten while it runs
    await waitFor(() => b.room.state.players.get(a.room.sessionId).cast === '', 3000);
    expect(b.room.state.players.get(a.room.sessionId).castTotal).toBe(0);
  });

  it("ally: Field Dressing with ally = the other session's eid heals that adventurer", async () => {
    const { url, store } = await start(zones([]));
    const a = await joinAt(url, store, 'Alice', 0, -5, { hp: 60 });
    const b = await joinAt(url, store, 'Bob', 2, -5, { hp: 40, jobs: jobsAs('ranger') });
    const fx = collect(b.room, 'fx');
    await sleep(200);
    const slot = slotsFor({ job: 'ranger', picks: [...JOBS.ranger.picks.solo] }).indexOf('field_dressing');
    b.room.send('ability', { slot, phase: 'press', ally: 1.5 }); // not an integer: dropped
    await sleep(200);
    expect(events(fx).some((e) => e.t === 'use')).toBe(false);
    b.room.send('ability', { slot, phase: 'press', ally: me(a.room).eid });
    await waitFor(() => events(fx).some((e) => e.t === 'heal'));
    expect(events(fx).find((e) => e.t === 'heal')).toMatchObject({ dst: me(a.room).eid });
    await waitFor(() => me(a.room).hp > 60);
    expect(b.room.state.players.get(b.room.sessionId).hp).toBe(40);
  });

  /** Alice (a White Mage with Second Dawn) and Bob, both in `zone` near (0, -10). */
  async function reviveScene(opts: { zone?: ZoneId; rate?: number; store?: Store; reconnectSeconds?: number } = {}) {
    const clock = testClock(opts.rate ?? 4);
    const zone = opts.zone ?? 'grove';
    const s = await start({ ...zones([]), combatClock: clock.now, autoRespawnSeconds: 6, ...(opts.store ? { store: opts.store } : {}), ...(opts.reconnectSeconds ? { reconnectSeconds: opts.reconnectSeconds } : {}) });
    const a = await joinAt(s.url, s.store, 'Alice', 0, -10, { jobs: jobsAs('white_mage', ['second_dawn', 'soft_rain']) }, zone);
    const b = await joinAt(s.url, s.store, 'Bob', 3, -10, {}, zone);
    await sleep(200);
    return { ...s, clock, a, b, slot: 3 };
  }

  it('Second Dawn revives a dead second session where it lay: revived, moves accepted, no auto respawn later', async () => {
    const { store, clock, a, b, slot } = await reviveScene();
    const revived = collect(b.room, 'revived'), respawned = collect(b.room, 'respawned'), corrections = collect(b.room, 'correct');
    kill(b.room);
    await waitFor(() => me(b.room).dead);
    await waitFor(async () => (await stored(store, b.accountId)).hp === MAX_HP); // saved as respawned meanwhile
    a.room.send('ability', { slot, phase: 'press', ally: me(b.room).eid });
    await waitFor(() => revived.length > 0, 3000);
    expect(revived[0]).toEqual({ hp: Math.round(0.4 * MAX_HP), by: me(a.room).eid });
    await waitFor(() => !me(b.room).dead);
    expect(me(b.room)).toMatchObject({ dead: false, hp: Math.round(0.4 * MAX_HP), x: 3, z: -10 });
    // moves carry the same ack as before
    b.room.send('move', { ...pose(3.3, -10), moving: true });
    await waitFor(() => Math.abs(me(b.room).x - 3.3) < 0.02);
    // saved alive where it stands, never at the statue
    await b.room.leave();
    await waitFor(async () => (await stored(store, b.accountId)).hp === Math.round(0.4 * MAX_HP));
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'grove' });
    expect(Math.abs((await stored(store, b.accountId)).x - 3.3)).toBeLessThan(0.01);
    clock.skip(10);
    await sleep(200);
    expect(respawned).toEqual([]);
    expect(corrections).toEqual([]);
  });

  it('a revive during the death save (Greenway): it is saved alive where it lay, not at the statue, and never sent on', async () => {
    const store = createMemoryStore();
    const save = store.saveAdventurer.bind(store);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let holding = false;
    vi.spyOn(store, 'saveAdventurer').mockImplementation(async (s: AdventurerSave, e?: { zone: ZoneId }) => {
      if (holding && s.zone === 'grove' && s.hp === MAX_HP) await held; // the death's save, as respawned
      return save(s, e);
    });
    const { a, b, slot } = await reviveScene({ zone: 'greenway', store });
    const revived = collect(b.room, 'revived'), kicked = collect(b.room, 'kicked'), notices = collect(b.room, 'notice');
    holding = true;
    kill(b.room);
    await waitFor(() => me(b.room).dead);
    a.room.send('ability', { slot, phase: 'press', ally: me(b.room).eid });
    await waitFor(() => revived.length > 0, 3000);
    release(); // the death save lands after the revive
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'grove');
    // the room saves it again alive, in the Greenway, where it lay
    const room = serverRoom(b.room) as any;
    await room.saveAll();
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'greenway');
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'greenway', x: 3, z: -10, hp: Math.round(0.4 * MAX_HP) });
    await room.saveAll();
    expect(kicked).toEqual([]);
    expect(notices).toEqual([]);
    await waitFor(() => !me(b.room).dead);
  });

  it('Return to the statue pressed before the revive lands: the cast fizzles and it is at the statue', async () => {
    const { a, b, slot, store } = await reviveScene({ zone: 'greenway', rate: 1 });
    const aFx = collect(a.room, 'fx');
    const travels = collect(b.room, 'travel'), revived = collect(b.room, 'revived');
    kill(b.room);
    await waitFor(() => me(b.room).dead);
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'grove');
    a.room.send('ability', { slot, phase: 'press', ally: me(b.room).eid }); // 3 s cast
    await waitFor(() => events(aFx).some((e) => e.t === 'cast'));
    (serverRoom(b.room) as any).wallMs = () => Date.now() + DEATH_MIN_S * 1000;
    const bSession = (serverRoom(b.room) as any).sessions.get(b.room.sessionId);
    bSession.deadAt -= DEATH_MIN_S; // the minimum time dead has passed
    b.room.send('respawn', {});
    await waitFor(() => travels.length > 0);
    await waitFor(() => events(aFx).some((e) => e.t === 'castEnd'), 5000);
    expect(events(aFx).find((e) => e.t === 'castEnd')).toMatchObject({ ok: false });
    expect(revived).toEqual([]);
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: MAX_HP });
  });

  it('a revive, then Return to the statue: refused, it stays where it lay', async () => {
    const { a, b, slot } = await reviveScene();
    const revived = collect(b.room, 'revived'), refused = collect(b.room, 'refused'), respawned = collect(b.room, 'respawned');
    kill(b.room);
    await waitFor(() => me(b.room).dead);
    a.room.send('ability', { slot, phase: 'press', ally: me(b.room).eid });
    await waitFor(() => revived.length > 0, 3000);
    b.room.send('respawn', {});
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'respawn', reason: 'invalid' }]);
    expect(respawned).toEqual([]);
    await waitFor(() => !me(b.room).dead);
    expect(me(b.room)).toMatchObject({ x: 3, z: -10, dead: false });
  });

  it('revived in the Greenway, then signed in elsewhere before any save of it alive: the kick saves it where it lay, and it comes back there', async () => {
    const { url, a, b, slot, store } = await reviveScene({ zone: 'greenway' });
    const revived = collect(b.room, 'revived'), kicked = collect(b.room, 'kicked');
    kill(b.room);
    await waitFor(() => me(b.room).dead);
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'grove'); // the death, saved as respawned
    a.room.send('ability', { slot, phase: 'press', ally: me(b.room).eid });
    await waitFor(() => revived.length > 0, 3000);
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'grove' }); // not saved alive yet
    // signing in again asks GET /api/zone (the grove now) and joins there: that kicks the old session,
    // whose save puts it back in the Greenway, so the grove sends it on
    await expect(joinZone(url, b.token, 'grove')).rejects.toThrow(REASON_ELSEWHERE);
    await waitFor(() => kicked.length > 0);
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'greenway', x: 3, z: -10, hp: Math.round(0.4 * MAX_HP) });
    const again = await joinZone(url, b.token, 'greenway');
    expect(me(again.room)).toMatchObject({ x: 3, z: -10, hp: Math.round(0.4 * MAX_HP), dead: false });
    const respawned = collect(again.room, 'respawned');
    await sleep(300);
    expect(respawned).toEqual([]);
  });

  it('a job message from a session the room does not hold (not entered yet, or gone) is refused busy', async () => {
    const { url, store } = await start(zones());
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const room = serverRoom(a.room) as any;
    const sent: any[] = [];
    room.onJob({ sessionId: 'not-entered', send: (type: string, message: unknown) => sent.push({ type, message }) }, { job: 'ninja' });
    expect(sent).toEqual([{ type: 'refused', message: { action: 'job', reason: 'busy' } }]);
  });

  it('disconnected while dead, then revived: saved alive where it lay when the window runs out', async () => {
    const { a, b, slot, store } = await reviveScene({ zone: 'greenway', reconnectSeconds: 1.5 });
    kill(b.room);
    const sessionId = b.room.sessionId, eid = me(b.room).eid;
    await waitFor(() => me(b.room).dead);
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'grove');
    b.room.connection.close();
    await sleep(100);
    a.room.send('ability', { slot, phase: 'press', ally: eid });
    await waitFor(() => a.room.state.players.get(sessionId)?.dead === false, 3000);
    await waitFor(() => !a.room.state.players.has(sessionId), 4000); // the window ran out
    await waitFor(async () => (await stored(store, b.accountId)).zone === 'greenway');
    expect(await stored(store, b.accountId)).toMatchObject({ zone: 'greenway', x: 3, z: -10, hp: Math.round(0.4 * MAX_HP) });
  });
});

describe('saves', () => {
  it('Plan 3 saves (memory legacyRows) join as warrior/ranger; garbage joins as a Warrior', async () => {
    const legacyRows = [
      { accountId: 'acc-blade', loadout: { weapon: 'blade', free: ['bulwark', 'mend'] } },
      { accountId: 'acc-bow', loadout: { weapon: 'bow', free: ['taunt', 'sprint'] } },
      { accountId: 'acc-junk', jobs: 'not a jobs save', loadout: { weapon: 'staff' } },
      { accountId: 'acc-wrong', jobs: { current: 'warrior', jobs: { warrior: { level: 1, xp: 0, picks: ['sprint', 'mend'], talents: [], outfit: null } } } },
    ];
    const base = createMemoryStore({ legacyRows });
    // Plan 3's accounts, as they were (the rows are keyed by them)
    const ids = legacyRows.map((r) => r.accountId);
    const store: Store = {
      ...base,
      findAccountById: async (id) => (await base.findAccountById(id)) ?? (ids.includes(id) ? { id, username: id, passwordHash: null, isGuest: true, isGm: false } : null),
    };
    const { url } = await start({ ...zones(), store });
    const expected: [string, JobId, string, AbilityId[]][] = [
      ['acc-blade', 'warrior', 'blade', ['bulwark', 'mend']],
      ['acc-bow', 'ranger', 'bow', [...JOBS.ranger.picks.solo]],
      ['acc-junk', 'warrior', 'blade', [...JOBS.warrior.picks.solo]],
      ['acc-wrong', 'warrior', 'blade', [...JOBS.warrior.picks.solo]],
    ];
    for (const [id, job, weapon, picks] of expected) {
      await store.nameAdventurer(id, id.slice(4));
      await saveAs(store, id, { x: SPAWN.x, z: SPAWN.z });
      const joined = await joinZone(url, signToken(id, SECRET), 'grove');
      const jobs = collectFromJoin(joined.room, 'jobs');
      await waitFor(() => jobs.length > 0);
      expect(me(joined.room)).toMatchObject({ job, weapon });
      expect(jobs[0].jobs[job].picks).toEqual(picks);
      await joined.room.leave();
      const saved = (await store.getOrCreateAdventurer(id)).jobs;
      expect(isJobsSave(saved)).toBe(true);
      expect(saved.current).toBe(job);
    }
  });

  it('a repaired save is written back on its first join', async () => {
    const base = createMemoryStore({ legacyRows: [{ accountId: 'acc-old', loadout: { weapon: 'bow', free: ['taunt', 'sprint'] } }] });
    const store: Store = { ...base, findAccountById: async (id) => (id === 'acc-old' ? { id, username: 'Old', passwordHash: null, isGuest: true, isGm: false } : base.findAccountById(id)) };
    const saves = vi.spyOn(store, 'saveAdventurer');
    const { url } = await start({ ...zones(), store });
    await store.nameAdventurer('acc-old', 'Old');
    const before = saves.mock.calls.length;
    const joined = await joinZone(url, signToken('acc-old', SECRET), 'grove');
    await waitFor(() => saves.mock.calls.length > before);
    expect(saves.mock.calls.at(-1)![0].jobs.current).toBe('ranger');
    await joined.room.leave();
    // an ordinary join writes nothing extra
    const fresh = await accountFor(store, 'Fresh');
    const n = saves.mock.calls.length;
    const j2 = await joinZone(url, fresh.token, 'grove');
    await sleep(300);
    expect(saves.mock.calls.length).toBe(n);
    await j2.room.leave();
  });

  it('relog mid-cast: no cost, cooldowns per id carried', async () => {
    const clock = testClock(1);
    const { url, store } = await start({ ...zones(), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 3, -5, { jobs: jobsAs('black_mage') });
    const selves = collect(a.room, 'self');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
    a.room.send('ability', { slot: 0, phase: 'press' }); // Cinder Dart: instant
    await waitFor(() => selves.some((s) => s.cd[0] > 0));
    clock.skip(1.5); // past the GCD
    await sleep(100);
    a.room.send('ability', { slot: 2, phase: 'press' }); // Hearthfall: a 2.5 s cast
    await waitFor(() => me(a.room).cast === 'hearthfall');
    await a.room.leave();
    const again = await joinZone(url, a.token, 'grove');
    const selves2 = collect(again.room, 'self');
    await waitFor(() => selves2.length > 0);
    expect(me(again.room).cast ?? '').toBe('');
    expect(selves2[0].cast).toBeNull();
    expect(selves2[0].cd[2]).toBe(0); // the dropped cast cost nothing
    expect(selves2[0].cd[0]).toBeGreaterThan(0); // Cinder Dart's cooldown came along
  });
});

describe('bandwidth', () => {
  it('state fields change only on events: walking patches cost the same before and after a job switch', async () => {
    const clock = testClock(0); // stands still: each step moves it on by exactly one tick
    const { url, store } = await start({ ...zones([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', -20, -10);
    const b = await joinAt(url, store, 'Bob', -20, -14);
    const room = serverRoom(a.room) as any;
    // stepped and patched by hand, so every patch holds exactly one step of Alice's walk
    room.setSimulationInterval(undefined);
    room.setPatchRate(null);
    const sizes: number[] = [];
    const connection = b.room.connection as unknown as { events: { onmessage?: (ev: { data: ArrayBuffer | string }) => void } };
    const onmessage = connection.events.onmessage;
    connection.events.onmessage = (ev) => {
      sizes.push(typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength);
      onmessage?.(ev);
    };
    const alice = { sessionId: a.room.sessionId };
    const session = room.sessions.get(a.room.sessionId);
    let x = -20;
    /** `steps` steps of Alice walking east at 4 m/s: the bytes of each patch Bob received. */
    const walkFor = async (steps: number) => {
      sizes.length = 0;
      for (let k = 0; k < steps; k++) {
        x += 4 / TICK_HZ;
        session.movement.metres = 10; // (the wall clock does not matter here)
        room.onMove(alice, { ...pose(x, -10), moving: true });
        clock.skip(1 / TICK_HZ);
        room.step();
        room.broadcastPatch();
        await sleep(5);
      }
      await sleep(50);
      return [...sizes];
    };
    await walkFor(5);
    const before = await walkFor(30);
    a.room.send('job', { job: 'ninja' });
    await waitFor(() => session.jobs.current === 'ninja');
    clock.skip(1 / TICK_HZ);
    room.step();
    room.broadcastPatch();
    await waitFor(() => b.room.state.players.get(a.room.sessionId)?.job === 'ninja');
    await walkFor(5);
    const after = await walkFor(30);
    const sum = (v: number[]) => v.reduce((n, k) => n + k, 0);
    expect(before.length).toBe(30);
    expect(after.length).toBe(30);
    expect(Math.abs(sum(after) - sum(before)) / sum(before)).toBeLessThan(0.02);
    expect(Math.max(...after)).toBe(Math.max(...before)); // no walking patch carries anything new
  }, 15_000);
});
