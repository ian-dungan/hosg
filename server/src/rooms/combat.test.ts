// Combat in the zone room: the engine's enemies and fights mirrored to clients, intents and their
// refusals, server-stamped dodges and knockbacks, death and respawn, relogging, fx interest, and a
// room that survives nonsense. Timers run on an injected combat clock (testClock), never real time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { DODGE_DISTANCE, REASON_ELSEWHERE, SPAWN, TICK_HZ, fallDamage, worldOf, zoneDef, type CampSpawn, type Surface, type ZoneDef, type ZoneId } from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { ageCarry } from './ZoneRoom';
import { accountFor, collect, joinZone, saveAs, serverRoom, sleep, startServer, testClock, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(opts?: Parameters<typeof startServer>[0]): Promise<TestServer> {
  server = await startServer({ combatSeed: 7, ...opts });
  return server;
}

/** Flat open ground everywhere within 200 m (no plinth, no buildings), all in sight. */
const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatZone = (camps: CampSpawn[]): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const DUMMY: CampSpawn = { kind: 'dummy', x: 3, z: -11, facing: 0 };
const THORNLING: CampSpawn = { kind: 'thornling', x: 0, z: -20, facing: 0 };
const BOAR: CampSpawn = { kind: 'boar', x: 0, z: -20, facing: 0 };
const grove = (camps: CampSpawn[]) => ({ zones: { grove: flatZone(camps) } });

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const pose = (x: number, z: number, ack = 0) => ({ x, z, y: 0, facing: 0, moving: false, ack });
const enemyOf = (room: Room<any, any>, kind: string) => [...room.state.enemies.values()].find((e: any) => e.kind === kind);

/** Joins `zone` with the adventurer saved at (x, z) (and any other changes) first. */
async function joinAt(url: string, store: Store, name: string, x: number, z: number, more: Parameters<typeof saveAs>[2] = {}, zone: ZoneId = 'grove') {
  const account = await accountFor(store, name);
  await saveAs(store, account.accountId, { x, z, facing: 0, zone, ...more });
  const joined = await joinZone(url, account.token, zone);
  return { ...joined, ...account };
}

/** Keeps sending `p` once a tick until stopped (a client standing still). */
function keepSending(room: Room<any, any>, p: () => object) {
  const timer = setInterval(() => room.send('move', p()), 1000 / TICK_HZ);
  return () => clearInterval(timer);
}

describe('enemies in the state', () => {
  it('the grove state shows the dummy with its kind, hp and maxHp', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    expect(dummy).toMatchObject({ kind: 'dummy', hp: 40, maxHp: 40, mode: 'idle', target: -1, x: 3, z: -11 });
    expect(me(a.room)).toMatchObject({ weapon: 'blade', target: -1, dead: false, act: '', shield: 0, hp: 100 });
    expect('momentum' in me(a.room).toJSON()).toBe(false); // the owner gets it in `self`; nobody else needs it
    expect(dummy).toMatchObject({ surging: false, staggerImmune: 0 });
    expect(me(a.room).eid).toBeGreaterThan(0);
    expect(a.room.state.telegraphs.size).toBe(0);
  });

  it('/healthz and stats() report each zone\'s tick time (p95, ms)', async () => {
    const { url, app } = await start(grove([DUMMY]));
    await sleep(300);
    const health: any = await (await fetch(`${url}/healthz`)).json();
    for (const zone of ['grove', 'greenway'] as const) {
      expect(Number.isFinite(health.zones[zone].tickMs)).toBe(true);
      expect(health.zones[zone].tickMs).toBeGreaterThanOrEqual(0);
      expect(health.zones[zone].stepErrors).toBe(0);
    }
    expect(app.stats().zones.grove.tickMs).toBeGreaterThanOrEqual(0);
  });
});

describe('a fight', () => {
  it('kills the dummy with 10-point Blade autos within 5 s, credits the kill, and it comes back 5 s later once nobody stands by', async () => {
    const clock = testClock(4);
    const { url, store } = await start({ ...grove([DUMMY]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const fx = collect(a.room, 'fx');
    const credits = collect(a.room, 'credit');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    const eid = me(a.room).eid;
    const t0 = clock.now();
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
    const events = () => fx.flatMap((m) => m.events);
    await waitFor(() => events().some((e) => e.t === 'death' && e.dst === dummy.eid), 3000);
    expect(clock.now() - t0).toBeLessThan(5);
    const hits = events().filter((e) => e.t === 'hit' && e.dst === dummy.eid);
    expect(hits.length).toBe(4);
    for (const h of hits) expect(h).toMatchObject({ src: eid, amount: 10, by: 'auto' });
    await waitFor(() => credits.length > 0);
    expect(credits).toEqual([{ kind: 'dummy' }]);
    await waitFor(() => enemyOf(a.room, 'dummy').mode === 'dead');
    expect(me(a.room).target).toBe(-1);
    const diedAt = clock.now();
    // standing by holds the respawn; 7 m away it comes back
    await walk(a.room, { x: SPAWN.x, z: SPAWN.z }, { x: SPAWN.x - 4, z: SPAWN.z - 5.8 }, flat);
    await waitFor(() => enemyOf(a.room, 'dummy').mode === 'idle', 3000);
    expect(clock.now() - diedAt).toBeGreaterThanOrEqual(5 - 0.5); // diedAt was read up to a patch (×4 clock) late
    expect(enemyOf(a.room, 'dummy')).toMatchObject({ hp: 40, x: 3, z: -11 });
    expect(events().some((e) => e.t === 'spawn' && e.dst === dummy.eid)).toBe(true);
  });

  it('refuses an ability out of range', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', -3, -11);
    const refused = collect(a.room, 'refused');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('target', { id: dummy.eid });
    a.room.send('ability', { slot: 0, phase: 'press' });
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'ability', reason: 'range' }]);
  });

  it('sends its own numbers to the owner as `self`, only when they change', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const selves = collect(a.room, 'self');
    await waitFor(() => selves.length > 0);
    expect(selves[0]).toMatchObject({ weapon: 'blade', slots: ['slash', 'sunder', 'parry', 'mend', 'bulwark'], dodgeCharges: 2, inCombat: false });
    await sleep(400);
    expect(selves.length).toBe(1); // nothing changed
    a.room.send('ability', { slot: 3, phase: 'press' }); // Mend
    await waitFor(() => selves.some((s) => s.cd[3] > 19));
    await sleep(500);
    expect(selves.length).toBeLessThanOrEqual(1 + 5); // at most 5 a second
  });
});

describe('intent spam and nonsense', () => {
  it('50 ability presses in 1 s use the ability once; junk is ignored or refused; a legal move still works', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const fx = collect(a.room, 'fx');
    const refused = collect(a.room, 'refused');
    const corrections = collect(a.room, 'correct');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
    for (let i = 0; i < 50; i++) {
      a.room.send('ability', { slot: 0, phase: 'press' });
      await sleep(20);
    }
    await sleep(150);
    const uses = fx.flatMap((m) => m.events).filter((e) => e.t === 'use' && e.src === me(a.room).eid);
    expect(uses).toEqual([{ t: 'use', src: me(a.room).eid, ability: 'slash', dst: dummy.eid }]);
    expect(refused.length).toBeGreaterThan(40);
    expect(refused.every((r) => r.action === 'ability' && (r.reason === 'cooldown' || r.reason === 'busy' || r.reason === 'rate'))).toBe(true);

    refused.length = 0;
    await sleep(700); // the intent budget refills (20 a second)
    const before = { ...me(a.room).toJSON() };
    a.room.send('target', { id: 'x' });
    a.room.send('target', { id: 99999 });
    a.room.send('target', { id: 1.5 });
    a.room.send('target', null);
    a.room.send('ability', { slot: 9, phase: 'press' });
    a.room.send('ability', { slot: '0', phase: 'press' });
    a.room.send('ability', { slot: 0, phase: 'hold' });
    a.room.send('ability', { slot: 2, phase: 'release' }); // a release with no press
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: NaN, dz: 0 });
    a.room.send('dodge', { x: 'a', dx: 1, dz: 0 });
    a.room.send('respawn', {}); // while alive
    a.room.send('loadout', { free: ['mend', 'mend'] });
    a.room.send('loadout', 'everything');
    a.room.send('swap', 42);
    await sleep(300);
    expect(me(a.room).target).toBe(dummy.eid);
    expect(me(a.room).x).toBe(before.x);
    expect(me(a.room).weapon).toBe('blade');
    expect(refused).toEqual(expect.arrayContaining([
      { action: 'target', reason: 'invalid' },
      { action: 'ability', reason: 'invalid' },
      { action: 'respawn', reason: 'invalid' },
      { action: 'loadout', reason: 'invalid' },
    ]));
    expect(corrections).toEqual([]);
    a.room.send('move', { ...pose(SPAWN.x + 0.3, SPAWN.z), moving: true });
    await waitFor(() => me(a.room).x === SPAWN.x + 0.3);
  });

  it('a move whose ack is not the latest displacement is ignored, without a correction', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const corrections = collect(a.room, 'correct');
    a.room.send('move', pose(SPAWN.x + 0.3, SPAWN.z, 5)); // no displacement was ever issued
    await sleep(200);
    expect(me(a.room).x).toBe(SPAWN.x);
    a.room.send('move', pose(SPAWN.x + 0.3, SPAWN.z, 0));
    await waitFor(() => me(a.room).x === SPAWN.x + 0.3);
    expect(corrections).toEqual([]);
  });

  it('a throwing tick is logged once and the room carries on', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const combat = serverRoom(a.room).combat;
    const tick = combat.tick.bind(combat);
    vi.spyOn(combat, 'tick').mockImplementation(() => { throw new Error('boom'); });
    await sleep(300);
    vi.mocked(combat.tick).mockImplementation(tick);
    expect(errors).toHaveBeenCalledTimes(1);
    a.room.send('move', { ...pose(SPAWN.x + 0.3, SPAWN.z), moving: true });
    await waitFor(() => me(a.room).x === SPAWN.x + 0.3);
    const dummy = enemyOf(a.room, 'dummy');
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => me(a.room).target === dummy.eid);
  });
});

describe('weapons and loadout', () => {
  it('swaps and changes free picks out of combat, saves them, and refuses both in combat', async () => {
    const clock = testClock(1);
    const { url, store } = await start({ ...grove([DUMMY]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const refused = collect(a.room, 'refused');
    a.room.send('swap', {});
    await waitFor(() => me(a.room).weapon === 'bow');
    a.room.send('loadout', { free: ['taunt', 'sprint'] });
    await sleep(150);
    expect(refused).toEqual([]);
    const dummy = enemyOf(a.room, 'dummy');
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => enemyOf(a.room, 'dummy').hp < 40); // a Bow auto: in combat now
    clock.skip(2); // past the swap cooldown
    a.room.send('swap', {});
    a.room.send('loadout', { free: ['mend', 'bulwark'] });
    await waitFor(() => refused.length === 2);
    expect(refused).toEqual([{ action: 'swap', reason: 'in-combat' }, { action: 'loadout', reason: 'in-combat' }]);
    expect(me(a.room).weapon).toBe('bow');
    await a.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).loadout.free[0] === 'taunt');
    expect((await store.getOrCreateAdventurer(a.accountId)).loadout).toEqual({ weapon: 'bow', free: ['taunt', 'sprint'] });
  });
});

describe('death and respawn', () => {
  it('a thornling kills an adventurer that stands there; the dead cannot move; respawn is refused at 1 s and works at 3 s, at the statue with full health', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ ...grove([THORNLING]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 30 });
    const refused = collect(a.room, 'refused');
    const respawned = collect(a.room, 'respawned');
    const diedAt = clock.now();
    await waitFor(() => me(a.room).dead, 6000);
    clock.setRate(1);
    expect(clock.now() - diedAt).toBeLessThan(60);
    expect(me(a.room)).toMatchObject({ hp: 0, act: 'dead', target: -1 });
    a.room.send('move', { ...pose(0.3, -18), moving: true });
    await sleep(150);
    expect(me(a.room).x).toBe(0);
    a.room.send('respawn', {});
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'respawn', reason: 'cooldown' }]);
    clock.skip(3);
    a.room.send('respawn', {});
    await waitFor(() => respawned.length > 0);
    expect(respawned).toEqual([{ x: SPAWN.x, z: SPAWN.z, y: 0, seq: 1 }]);
    await waitFor(() => !me(a.room).dead);
    expect(me(a.room)).toMatchObject({ x: SPAWN.x, z: SPAWN.z, hp: 100, act: '' });
    // the respawn starts a new ack: moves from the statue with it are accepted
    a.room.send('move', { ...pose(SPAWN.x + 0.3, SPAWN.z, 1), moving: true });
    await waitFor(() => me(a.room).x === SPAWN.x + 0.3);
  });

  it('respawns by itself after autoRespawnSeconds', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ ...grove([THORNLING]), combatClock: clock.now, autoRespawnSeconds: 2 });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 10 });
    const respawned = collect(a.room, 'respawned');
    await waitFor(() => me(a.room).dead, 6000);
    await waitFor(() => respawned.length > 0, 3000);
    await waitFor(() => !me(a.room).dead);
    expect(me(a.room)).toMatchObject({ dead: false, hp: 100, x: SPAWN.x, z: SPAWN.z });
  });

  it('dying in the Greenway: respawn travels to the grove, saved at the statue with full health', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ zones: { greenway: flatZone([THORNLING]) }, combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 10 }, 'greenway');
    const travels = collect(a.room, 'travel');
    await waitFor(() => me(a.room).dead, 6000);
    // a death is saved as respawned at once
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).zone === 'grove');
    clock.skip(3);
    a.room.send('respawn', {});
    await waitFor(() => travels.length > 0);
    expect(travels).toEqual([{ zone: 'grove' }]);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 });
    const again = await joinZone(url, a.token, 'grove');
    expect(me(again.room)).toMatchObject({ x: SPAWN.x, z: SPAWN.z, hp: 100, dead: false });
  });
});

describe('dodge', () => {
  it('a dodge moves 4.5 m; moves from its end with the new ack are accepted; a dodge from 20 m away is corrected and refused', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    const corrections = collect(a.room, 'correct');
    const refused = collect(a.room, 'refused');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length > 0);
    const [d] = displaced;
    expect(d).toMatchObject({ seq: 1, kind: 'dodge', from: { x: SPAWN.x, z: SPAWN.z, y: 0 } });
    expect(Math.hypot(d.to.x - SPAWN.x, d.to.z - SPAWN.z)).toBeCloseTo(DODGE_DISTANCE, 1);
    // moves still carrying the old ack are ignored; from the end with the new one, accepted
    a.room.send('move', pose(SPAWN.x, SPAWN.z, 0));
    a.room.send('move', { ...pose(d.to.x + 0.4, d.to.z, 1), moving: true });
    await waitFor(() => me(a.room).x === d.to.x + 0.4);
    expect(corrections).toEqual([]);
    await sleep(450); // past the minimum gap (an earlier one is refused 'cooldown' before its pose is looked at)
    a.room.send('dodge', { ...pose(d.to.x + 20, d.to.z, 1), dx: 1, dz: 0 });
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'dodge', reason: 'stale' }]);
    expect(corrections).toEqual([{ x: d.to.x + 0.4, z: d.to.z, y: 0 }]);
    // a dodge with an ack never issued is refused as stale, with no correction
    a.room.send('dodge', { ...pose(d.to.x + 0.4, d.to.z, 7), dx: 1, dz: 0 });
    await waitFor(() => refused.length > 1);
    expect(refused[1]).toEqual({ action: 'dodge', reason: 'stale' });
    expect(corrections).toHaveLength(1);
  });
});

describe('knockback', () => {
  it('a Gore Charge knock: old poses with the old ack are never corrected, the first poses from the end are accepted, and others see the body travel', async () => {
    const clock = testClock(4);
    const { url, store } = await start({ ...grove([BOAR]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, -14);
    const b = await joinAt(url, store, 'Bob', 6, -11);
    const displaced = collect(a.room, 'displaced');
    const corrections = collect(a.room, 'correct');
    const seen: { x: number; z: number }[] = [];
    b.room.onStateChange(() => {
      const p = b.room.state.players.get(a.room.sessionId);
      if (p) seen.push({ x: p.x, z: p.z });
    });
    const stop = keepSending(a.room, () => pose(0, -14, 0));
    try {
      await waitFor(() => displaced.length > 0, 4000);
      const [d] = displaced;
      expect(d).toMatchObject({ seq: 1, kind: 'knock', from: { x: 0, z: -14 } });
      seen.length = 0;
      await sleep(500); // still sending the pre-knock pose with the old ack
      expect(corrections).toEqual([]);
      stop();
      // others saw it on the way, not just at both ends
      const between = seen.filter((p) => Math.hypot(p.x - d.to.x, p.z - d.to.z) > 0.05 && Math.hypot(p.x - d.from.x, p.z - d.from.z) > 0.05);
      expect(between.length).toBeGreaterThan(0);
      const last = seen[seen.length - 1];
      expect(last.x).toBeCloseTo(d.to.x, 6);
      expect(last.z).toBeCloseTo(d.to.z, 6);
      a.room.send('move', { ...pose(d.to.x + 0.3, d.to.z, d.seq), moving: true });
      await waitFor(() => me(a.room).x === d.to.x + 0.3);
      expect(corrections).toEqual([]);
    } finally {
      stop();
    }
  });
});

describe('falls', () => {
  /** Flat ground with a 5 m ledge east of x = 6. */
  const ledge: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : x > 2 && x <= 6 && Math.abs(z + 11) < 2 ? Math.min(5, (x - 2) * 1.25) : 0);
  it('still cost hp and never kill; the hp in the state is the engine\'s', async () => {
    const { url, store } = await start({ zones: { grove: { surface: ledge, ground: ledge, sight: () => true, camps: [] } } });
    const a = await joinAt(url, store, 'Alice', 2, -11, { hp: 10 });
    const hurts = collect(a.room, 'hurt');
    await walk(a.room, { x: 2, z: -11 }, { x: 6, z: -11 }, ledge);
    await walk(a.room, { x: 6, z: -11 }, { x: 6.4, z: -11 }, ledge);
    await waitFor(() => hurts.length > 0);
    expect(fallDamage(5)).toBeGreaterThan(10);
    expect(hurts).toEqual([{ amount: 9, cause: 'fall' }]);
    await waitFor(() => me(a.room).hp === 1);
    const room = serverRoom(a.room);
    expect(Math.ceil(room.combat.get(me(a.room).eid)!.hp)).toBe(1);
  });
});

describe('relogging', () => {
  it('at 40 hp, leaving and joining again gives 40, and the thornling no longer has the leaver on its threat table', async () => {
    const { url, store } = await start(grove([THORNLING]));
    const a = await joinAt(url, store, 'Alice', 0, -13.5, { hp: 40 });
    const room = serverRoom(a.room);
    const thornling = [...worldOf(room.combat).enemies.values()][0];
    const eid = me(a.room).eid;
    await waitFor(() => thornling.threat.has(eid));
    await a.room.leave();
    await waitFor(async () => !thornling.threat.has(eid) && (await store.getOrCreateAdventurer(a.accountId)).hp === 40);
    const again = await joinZone(url, a.token, 'grove');
    expect(me(again.room)).toMatchObject({ hp: 40 });
    expect(thornling.threat.has(eid)).toBe(false);
  });

  it('cooldowns and spent dodges survive a relog', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    a.room.send('ability', { slot: 3, phase: 'press' }); // Mend: 20 s
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length > 0);
    await a.room.leave();
    await sleep(100);
    const again = await joinZone(url, a.token, 'grove');
    const selves = collect(again.room, 'self');
    await waitFor(() => selves.length > 0);
    expect(selves[0].cd[3]).toBeGreaterThan(18);
    expect(selves[0].dodgeCharges).toBe(1);
  });

  it('disconnecting while dead: the next join is in the grove at the statue with full health', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ ...grove([THORNLING]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 10 });
    await waitFor(() => me(a.room).dead, 6000);
    await a.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).hp === 100);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 });
    const again = await joinZone(url, a.token, 'grove');
    expect(me(again.room)).toMatchObject({ x: SPAWN.x, z: SPAWN.z, hp: 100, dead: false });
  });

  it('a dropped adventurer stays in the fight for the reconnect window: it is still hit, and dies, and is saved respawned', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ ...grove([THORNLING]), combatClock: clock.now, reconnectSeconds: 1.5 });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 30 });
    const b = await joinAt(url, store, 'Bob', 8, -11);
    const sessionId = a.room.sessionId;
    await waitFor(() => (b.room.state.players.get(sessionId)?.hp ?? 30) < 30, 3000);
    a.room.connection.close(); // dropped mid-fight, not left
    const hpAtDrop = b.room.state.players.get(sessionId).hp;
    await waitFor(() => b.room.state.players.get(sessionId)?.dead === true, 3000);
    expect(hpAtDrop).toBeGreaterThan(0);
    await waitFor(() => !b.room.state.players.has(sessionId), 3000); // the window ran out
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 });
  });
});

describe('fx interest', () => {
  it('a client 100 m from a fight gets no fx for it; one 50 m away does', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const far = await joinAt(url, store, 'Bob', 3, 89);
    const near = await joinAt(url, store, 'Cara', 3, 39);
    const farFx = collect(far.room, 'fx');
    const nearFx = collect(near.room, 'fx');
    const ownFx = collect(a.room, 'fx');
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('target', { id: dummy.eid });
    a.room.send('ability', { slot: 0, phase: 'press' });
    await waitFor(() => ownFx.flatMap((m) => m.events).some((e) => e.t === 'hit'));
    await waitFor(() => nearFx.flatMap((m) => m.events).some((e) => e.t === 'hit'));
    await sleep(200);
    expect(farFx).toEqual([]);
  });
});

/** The server-side session of a client's adventurer (room internals, for tests that reach in). */
const sessionOf = (room: Room<any, any>) => (serverRoom(room) as any).sessions.get(room.sessionId);

describe('dodges at higher latency (fix round 1)', () => {
  it('a second dodge carrying the ack before its own first roll is checked from that roll\'s end and accepted', async () => {
    const clock = testClock(0); // frozen: the gaps are set by skip
    const { url, store } = await start({ ...grove([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    const refused = collect(a.room, 'refused');
    const corrections = collect(a.room, 'correct');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length === 1);
    const end = displaced[0].to;
    clock.skip(0.45);
    // the client predicted the first roll and rolls again from its end before it heard `displaced`
    a.room.send('dodge', { ...pose(end.x, end.z, 0), dx: 0, dz: 1 });
    await waitFor(() => displaced.length === 2);
    expect(displaced[1]).toMatchObject({ seq: 2, kind: 'dodge', from: { x: end.x, z: end.z } });
    expect(refused).toEqual([]);
    expect(corrections).toEqual([]);
  });

  it('a second dodge arriving up to 0.15 s inside the minimum gap is held and rolled, not refused', async () => {
    const clock = testClock(0);
    const { url, store } = await start({ ...grove([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    const refused = collect(a.room, 'refused');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length === 1);
    const end = displaced[0].to;
    clock.skip(0.3); // sent 0.4 s after the first, bunched up by jitter
    a.room.send('dodge', { ...pose(end.x, end.z, 1), dx: 0, dz: 1 });
    await sleep(200);
    expect(displaced).toHaveLength(1); // held
    clock.skip(0.11);
    await waitFor(() => displaced.length === 2);
    expect(refused).toEqual([]);
  });

  it('a dodge the engine refuses after its pose was accepted (in the air) comes back refused with a correct', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const refused = collect(a.room, 'refused');
    const corrections = collect(a.room, 'correct');
    a.room.send('dodge', { ...pose(SPAWN.x + 0.2, SPAWN.z), y: 0.5, dx: 1, dz: 0 }); // just jumped
    await waitFor(() => refused.length === 1);
    expect(refused).toEqual([{ action: 'dodge', reason: 'air' }]);
    expect(corrections).toEqual([{ x: SPAWN.x + 0.2, z: SPAWN.z, y: 0 }]); // landed below the pose it was sent from
  });

  it('a dodge too early to be held is refused (cooldown, charges) without its pose being taken and without a correct', async () => {
    const clock = testClock(0);
    const { url, store } = await start({ ...grove([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const displaced = collect(a.room, 'displaced');
    const refused = collect(a.room, 'refused');
    const corrections = collect(a.room, 'correct');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length === 1);
    const end = displaced[0].to;
    clock.skip(0.1); // still rolling
    a.room.send('dodge', { ...pose(end.x + 0.2, end.z, 1), dx: 0, dz: 1 });
    await waitFor(() => refused.length === 1);
    expect(refused).toEqual([{ action: 'dodge', reason: 'cooldown' }]);
    clock.skip(0.5);
    a.room.send('dodge', { ...pose(end.x + 0.2, end.z, 1), dx: 0, dz: 1 });
    await waitFor(() => displaced.length === 2);
    clock.skip(0.5);
    const end2 = displaced[1].to;
    for (let i = 0; i < 5; i++) a.room.send('dodge', { ...pose(end2.x, end2.z, 2), dx: 0, dz: -1 }); // mashing while empty
    await waitFor(() => refused.length === 6);
    expect(refused.slice(1)).toEqual(Array(5).fill({ action: 'dodge', reason: 'charges' }));
    expect(corrections).toEqual([]);
  });

  it('a dodge 0.12 s before a charge is back is held even when the engine\'s view is a step old', async () => {
    const clock = testClock(0);
    const { url, store } = await start({ ...grove([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const room = serverRoom(a.room) as any;
    const displaced = collect(a.room, 'displaced');
    const refused = collect(a.room, 'refused');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    await waitFor(() => displaced.length === 1);
    clock.skip(0.45);
    a.room.send('dodge', { ...pose(displaced[0].to.x, displaced[0].to.z, 1), dx: 0, dz: 1 });
    await waitFor(() => displaced.length === 2);
    room.setSimulationInterval(undefined); // steps by hand from here: the engine's clock stays behind
    const firstAt = 0; // the first roll's refill is due 5 s after it
    clock.skip(5 - 0.45 - 0.12 - firstAt);
    const end = displaced[1].to;
    a.room.send('dodge', { ...pose(end.x, end.z, 2), dx: -1, dz: 0 });
    await sleep(100);
    expect(refused).toEqual([]);
    expect(sessionOf(a.room).pendingDodge).toBeDefined();
    clock.skip(0.2);
    room.step();
    room.step();
    await waitFor(() => displaced.length === 3);
    expect(refused).toEqual([]);
  });

  it('a displacement while away is sent again on reconnecting', async () => {
    const clock = testClock(4);
    const { url, store } = await start({ ...grove([BOAR]), combatClock: clock.now, reconnectSeconds: 10 });
    const a = await joinAt(url, store, 'Alice', 0, -14);
    const session = sessionOf(a.room);
    a.room.connection.close();
    await waitFor(() => session.displaceSeq > 0, 5000);
    const resumed = await a.client.reconnect(a.room.reconnectionToken);
    resumed.reconnection.enabled = false;
    const displaced = collect(resumed, 'displaced');
    await waitFor(() => displaced.length > 0);
    expect(displaced[0]).toMatchObject({ seq: session.displaceSeq >= 1 ? displaced[0].seq : -1, kind: 'knock' });
    expect(displaced[0].seq).toBeGreaterThanOrEqual(1);
    resumed.send('move', { ...pose(displaced[0].to.x, displaced[0].to.z + 0.3, displaced[0].seq), y: displaced[0].to.y, moving: true });
    await waitFor(() => resumed.state.players.get(resumed.sessionId).z === displaced[0].to.z + 0.3 || session.displaceSeq > displaced[0].seq);
  });

  it('knocked in mid-air: the fall it was in is charged as well', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const hurts = collect(a.room, 'hurt');
    const room = serverRoom(a.room) as any;
    const session = sessionOf(a.room);
    session.movement.air = { grounded: false, airStartMs: 0, airStartY: 10, peakY: 10, y: 2 };
    const from = { x: SPAWN.x, z: SPAWN.z, y: 2 };
    const at = { x: SPAWN.x + 1, z: SPAWN.z, y: 0 };
    room.displace(session, {
      id: session.eid, kind: 'knock', from, d: { vx: 3, vz: 0, vy: 0, seconds: 0.3 },
      result: { ...at, drop: 2, drops: [2], fallHp: fallDamage(2), seconds: 0.6, grounded: true, path: [{ t: 0, ...from }, { t: 0.6, ...at }] },
    });
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: fallDamage(8) + fallDamage(2), cause: 'fall' }]);
  });
});

describe('robust steps (fix round 1)', () => {
  it('a throwing handler for one adventurer does not stop the others; a lost dodge stamp is resynced', async () => {
    const clock = testClock(0);
    const { url, store, app } = await start({ ...grove([]), combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const b = await joinAt(url, store, 'Bob', SPAWN.x - 6, SPAWN.z);
    const room = serverRoom(a.room) as any;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const displace = room.displace.bind(room);
    const aEid = me(a.room).eid;
    vi.spyOn(room, 'displace').mockImplementation((...args: any[]) => {
      if (args[0].eid === aEid && args[1].kind === 'dodge') throw new Error('boom');
      return displace(...args);
    });
    const aDisplaced = collect(a.room, 'displaced');
    const bDisplaced = collect(b.room, 'displaced');
    a.room.send('dodge', { ...pose(SPAWN.x, SPAWN.z), dx: 1, dz: 0 });
    b.room.send('dodge', { ...pose(SPAWN.x - 6, SPAWN.z), dx: -1, dz: 0 });
    await waitFor(() => bDisplaced.length === 1);
    await sleep(150);
    expect(aDisplaced).toEqual([]);
    expect(app.stats().zones.grove.stepErrors).toBeGreaterThanOrEqual(1);
    expect(errors).toHaveBeenCalledTimes(1);
    clock.skip(2.5); // the stamp never came: resynced at the server's position
    await waitFor(() => aDisplaced.length === 1);
    const r = aDisplaced[0];
    expect(r).toMatchObject({ seq: 1, kind: 'resync' });
    expect(r.from).toEqual(r.to);
    a.room.send('move', { ...pose(r.to.x + 0.3, r.to.z, 1), moving: true });
    await waitFor(() => me(a.room).x === r.to.x + 0.3);
  });

  it('a death the step lost is reconciled from the engine on the next step', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const room = serverRoom(a.room) as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const died = room.died.bind(room);
    let calls = 0;
    vi.spyOn(room, 'died').mockImplementation((...args: any[]) => {
      if (calls++ === 0) throw new Error('boom');
      return died(...args);
    });
    killAdventurer(worldOf(room.combat), worldOf(room.combat).adventurers.get(me(a.room).eid)!, room.combat.get(me(a.room).eid).hp);
    await waitFor(() => me(a.room).dead);
    await waitFor(() => sessionOf(a.room).dead === true);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe('respawn saves (fix round 1)', () => {
  it('a respawn from the Greenway whose save fails is tried again no sooner than every 5 s, logging once', async () => {
    const clock = testClock(10);
    const base = createMemoryStore();
    let failing = false, deadSaves = 0;
    const store: Store = Object.assign(Object.create(base), {
      saveAdventurer: async (a: any, expect?: any) => {
        if (failing && a.hp === 100) { deadSaves++; throw new Error('db down'); }
        return base.saveAdventurer(a, expect);
      },
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({ store, zones: { greenway: flatZone([THORNLING]) }, combatClock: clock.now, autoRespawnSeconds: 1 });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 5 }, 'greenway');
    failing = true;
    await waitFor(() => me(a.room).dead, 6000);
    await sleep(1000); // 10 s of combat time: auto respawn is due every step
    expect(deadSaves).toBeLessThanOrEqual(2); // the death's own save, and one respawn try
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('a respawn travel the store refuses (already saved in the grove) sends the session on', async () => {
    const clock = testClock(10);
    const base = createMemoryStore();
    let failOnce = true;
    const store: Store = Object.assign(Object.create(base), {
      saveAdventurer: async (a: any, expect?: any) => {
        if (a.hp === 100 && failOnce) { failOnce = false; throw new Error('db blip'); }
        return base.saveAdventurer(a, expect);
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({ store, zones: { greenway: flatZone([THORNLING]) }, combatClock: clock.now });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 5 }, 'greenway');
    const kicked = collect(a.room, 'kicked');
    await waitFor(() => me(a.room).dead, 6000);
    await sleep(100);
    await saveAs(store, a.accountId, { zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 }); // written meanwhile, elsewhere
    clock.skip(3);
    a.room.send('respawn', {});
    await waitFor(() => kicked.length > 0);
    expect(kicked).toEqual([{ reason: REASON_ELSEWHERE }]);
  });

  it('a death during a travel save is saved again as respawned once the travel lands', async () => {
    const base = createMemoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store: Store = Object.assign(Object.create(base), {
      saveAdventurer: async (a: any, expect?: any) => {
        if (a.zone === 'greenway') await gate;
        return base.saveAdventurer(a, expect);
      },
    });
    const exit = { to: 'greenway' as const, x: 0, z: -15, r: 1.5, arrive: { ...zoneDef('greenway').spawn }, open: true };
    const { url } = await start({ store, zones: { grove: { ...flatZone([]), exits: [exit] } } });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const travels = collect(a.room, 'travel');
    await walk(a.room, { x: 0, z: SPAWN.z }, { x: 0, z: -13.6 }, flat);
    await waitFor(() => sessionOf(a.room)?.travelling !== undefined);
    const room = serverRoom(a.room) as any;
    const w = worldOf(room.combat);
    killAdventurer(w, w.adventurers.get(me(a.room).eid)!, 1);
    await waitFor(() => sessionOf(a.room).dead === true);
    release();
    await waitFor(() => travels.length > 0);
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).zone === 'grove');
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 });
  });

  it('a failed re-save of a death during a travel is tried again until it is written', async () => {
    const base = createMemoryStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let failures = 1;
    const store: Store = Object.assign(Object.create(base), {
      saveAdventurer: async (a: any, expect?: any) => {
        if (a.zone === 'greenway') await gate;
        if (expect?.zone === 'greenway' && a.zone === 'grove' && failures > 0) { failures--; throw new Error('db blip'); }
        return base.saveAdventurer(a, expect);
      },
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = { to: 'greenway' as const, x: 0, z: -15, r: 1.5, arrive: { ...zoneDef('greenway').spawn }, open: true };
    const { url } = await start({ store, zones: { grove: { ...flatZone([]), exits: [exit] } }, respawnRetryMs: 50 });
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    await walk(a.room, { x: 0, z: SPAWN.z }, { x: 0, z: -13.6 }, flat);
    await waitFor(() => sessionOf(a.room)?.travelling !== undefined);
    const w = worldOf((serverRoom(a.room) as any).combat);
    killAdventurer(w, w.adventurers.get(me(a.room).eid)!, 1);
    await waitFor(() => sessionOf(a.room).dead === true);
    const travels = collect(a.room, 'travel');
    release();
    await waitFor(() => travels.length > 0); // sent only once the re-save is written
    expect(failures).toBe(0);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'grove', x: SPAWN.x, z: SPAWN.z, hp: 100 });
  });

  it('someone who died in the Greenway and relogs is admitted to a full grove', async () => {
    const clock = testClock(10);
    const { url, store } = await start({ zones: { greenway: flatZone([THORNLING]) }, combatClock: clock.now, maxPlayers: 1 });
    const a = await joinAt(url, store, 'Alice', 0, -18, { hp: 5 }, 'greenway');
    await waitFor(() => me(a.room).dead, 6000);
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).zone === 'grove');
    await a.room.leave();
    await joinAt(url, store, 'Bob', SPAWN.x, SPAWN.z); // the grove is full now
    const again = await joinZone(url, a.token, 'grove');
    expect(me(again.room)).toMatchObject({ dead: false, hp: 100, x: SPAWN.x, z: SPAWN.z });
  });

  it('hp is saved rounded down, so a relog never gains the fraction', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z, { hp: 50 });
    const room = serverRoom(a.room) as any;
    worldOf(room.combat).adventurers.get(me(a.room).eid)!.hp = 40.6;
    await waitFor(() => me(a.room).hp === 41); // shown rounded up
    await a.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(a.accountId)).hp === 40);
  });
});

describe('relog mid-fight (fix round 1)', () => {
  it('a relog in combat is still in combat (swap refused), and keeps its Bulwark', async () => {
    const { url, store } = await start(grove([DUMMY]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const dummy = await waitFor(() => enemyOf(a.room, 'dummy'));
    a.room.send('ability', { slot: 4, phase: 'press' }); // Bulwark
    await waitFor(() => me(a.room).shield === 25);
    a.room.send('target', { id: dummy.eid });
    await waitFor(() => enemyOf(a.room, 'dummy').hp < 40); // in combat
    await a.room.leave();
    const again = await joinZone(url, a.token, 'grove');
    const refused = collect(again.room, 'refused');
    expect(me(again.room).shield).toBe(25);
    again.room.send('swap', {});
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'swap', reason: 'in-combat' }]);
  });

  it('ageCarry runs every timer down and every "since" up', () => {
    const aged = ageCarry({
      cooldowns: { mend: 10 }, gcd: 0.3, dodgeCharges: 0, dodgeRefillIn: 2, momentum: 50,
      sinceCombat: 1, sinceHurt: 2, sinceDealt: 3, swapCd: 1.5, shield: 20, shieldLeft: 4, sprintLeft: 1,
    }, 3);
    expect(aged).toEqual({
      cooldowns: { mend: 7 }, gcd: 0, dodgeCharges: 1, dodgeRefillIn: 4, momentum: 20,
      sinceCombat: 4, sinceHurt: 5, sinceDealt: 6, swapCd: 0, shield: 20, shieldLeft: 1, sprintLeft: 0,
    });
    expect(ageCarry({ cooldowns: {}, gcd: 0, dodgeCharges: 2, dodgeRefillIn: 0, momentum: 0 }, 5)).toEqual({ cooldowns: {}, gcd: 0, dodgeCharges: 2, dodgeRefillIn: 0, momentum: 0 });
  });
});

describe('intent budget (fix round 1)', () => {
  it('held keys cannot starve moves: intents past 20 a second (bursts of 30) are refused as rate, moves still count', async () => {
    const { url, store } = await start(grove([]));
    const a = await joinAt(url, store, 'Alice', SPAWN.x, SPAWN.z);
    const refused = collect(a.room, 'refused');
    for (let i = 0; i < 60; i++) a.room.send('ability', { slot: 3, phase: 'press' });
    a.room.send('move', { ...pose(SPAWN.x + 0.3, SPAWN.z), moving: true });
    await waitFor(() => me(a.room).x === SPAWN.x + 0.3);
    await sleep(100);
    expect(refused.filter((r) => r.reason === 'rate')).toEqual([{ action: 'ability', reason: 'rate' }]); // once, not 30 times
  });
});
