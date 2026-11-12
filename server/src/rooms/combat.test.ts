// Combat in the zone room: the engine's enemies and fights mirrored to clients, intents and their
// refusals, server-stamped dodges and knockbacks, death and respawn, relogging, fx interest, and a
// room that survives nonsense. Timers run on an injected combat clock (testClock), never real time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { DODGE_DISTANCE, SPAWN, TICK_HZ, fallDamage, worldOf, type CampSpawn, type Surface, type ZoneDef, type ZoneId } from '@sg2/shared';
import type { Store } from '../store/types';
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
    expect(me(a.room)).toMatchObject({ weapon: 'blade', momentum: 0, target: -1, dead: false, act: '', shield: 0, hp: 100 });
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
      expect(health.zones[zone].tickMs).toBeLessThan(15);
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
    expect(clock.now() - diedAt).toBeGreaterThanOrEqual(5);
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
    expect(refused.every((r) => r.action === 'ability' && (r.reason === 'cooldown' || r.reason === 'busy'))).toBe(true);

    refused.length = 0;
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
    a.room.send('dodge', { ...pose(d.to.x + 20, d.to.z, 1), dx: 1, dz: 0 });
    await waitFor(() => refused.length > 0);
    expect(refused).toEqual([{ action: 'dodge', reason: 'stale' }]);
    expect(corrections).toEqual([{ x: d.to.x + 0.4, z: d.to.z, y: 0 }]);
    // a dodge with an old ack is refused as stale too, with no correction
    a.room.send('dodge', { ...pose(d.to.x + 0.4, d.to.z, 0), dx: 1, dz: 0 });
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
