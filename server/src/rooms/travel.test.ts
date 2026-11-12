// A room per zone: travel through exits, refusals at the door, one session per account across rooms,
// and health, zone and jobs kept with the adventurer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloseCode, matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import {
  newJobsSave,
  REASON_ELSEWHERE,
  REASON_TRAVEL_FAILED,
  SPAWN,
  fallDamage,
  groveTownSurface,
  zoneDef,
  zoneFullReason,
  type JobsSave,
  type Surface,
  type ZoneExit,
  type ZoneId,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { accountFor, collect, joinGrove, joinZone, saveAs, shown, sleep, startServer, sx, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

async function start(opts?: Parameters<typeof startServer>[0]): Promise<TestServer> {
  server = await startServer(opts);
  return server;
}

const GREENWAY = zoneDef('greenway');
const ENTRY = GREENWAY.spawn;
/** A test exit on the plaza, 4 m south of SPAWN. */
const TEST_EXIT: ZoneExit = { to: 'greenway', x: 0, z: -15, r: 1.5, arrive: { ...ENTRY }, open: true };
/** Walking south from SPAWN in 0.4 m steps, this is the first point inside TEST_EXIT (1.4 m from its centre). */
const INTO_EXIT = { x: 0, z: -13.6 };
const withExit = (open = true) => ({ zones: { grove: { exits: [{ ...TEST_EXIT, open }] } } });

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const leftWith = (room: Room<any, any>) => new Promise<number>((resolve) => room.onLeave((code: number) => resolve(code)));

async function zoneOf(url: string, token: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${url}/api/zone`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: await res.json() };
}

async function health(url: string): Promise<any> {
  return (await fetch(`${url}/healthz`)).json();
}

/** Joins `zone`, expecting a refusal; the refusal's message. */
async function refusal(url: string, token: string, zone: ZoneId): Promise<string> {
  try {
    const room = await new Client(url).joinOrCreate(zone, { token });
    await room.leave();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error(`joining ${zone} was not refused`);
}

describe('travel through an open exit', () => {
  it('saves the adventurer in the next zone, says so, and ends the session; the next zone takes it in at its entry', async () => {
    const { url, store } = await start(withExit());
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const travels = collect(a.room, 'travel');
    const left = leftWith(a.room);
    await walk(a.room, SPAWN, INTO_EXIT);
    expect(await left).toBe(CloseCode.CONSENTED);
    expect(travels).toEqual([{ zone: 'greenway' }]);

    expect(await store.getOrCreateAdventurer(alice.accountId)).toMatchObject({
      zone: 'greenway', x: ENTRY.x, z: ENTRY.z, facing: ENTRY.facing, hp: 100, jobs: newJobsSave(),
    });
    expect(await zoneOf(url, alice.token)).toEqual({ status: 200, body: { zone: 'greenway' } });
    expect(await refusal(url, alice.token, 'grove')).toBe(REASON_ELSEWHERE);

    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room)).toMatchObject(shown({ name: 'Alice', x: ENTRY.x, z: ENTRY.z, y: GREENWAY.surface(ENTRY.x, ENTRY.z)!, facing: ENTRY.facing, hp: 100 }));
    const report = await health(url);
    expect(report.zones.greenway.players).toBe(1);
    expect(report.zones.grove.players).toBe(0);
    expect(report.players).toBe(1);
    // The greenway room moves it over the greenway's ground.
    const next = { x: ENTRY.x + 0.4, z: ENTRY.z };
    b.room.send('move', { ...next, y: GREENWAY.surface(next.x, next.z), facing: 0, moving: true });
    await waitFor(() => me(b.room).x === sx(next.x));
  });

  it('a closed exit does nothing', async () => {
    const { url, store } = await start(withExit(false));
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const travels = collect(a.room, 'travel');
    const notices = collect(a.room, 'notice');
    const corrections = collect(a.room, 'correct');
    await walk(a.room, SPAWN, { x: 0, z: -15 }); // right to its centre
    await waitFor(() => me(a.room).z === -15);
    await sleep(100);
    expect([travels, notices, corrections]).toEqual([[], [], []]);
    expect((await store.getOrCreateAdventurer(alice.accountId)).zone).toBe('grove');
  });

  it('the server opens and shuts exits at run time (a test zone whose east gate starts shut)', async () => {
    const { url, store, app } = await start(withExit(false));
    expect(app.isExitOpen('grove', 'greenway')).toBe(false);
    expect(app.isExitOpen('greenway', 'grove')).toBe(true);
    app.setExitOpen('grove', 'greenway', true);
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const travels = collect(a.room, 'travel');
    await walk(a.room, SPAWN, INTO_EXIT);
    await waitFor(() => travels.length === 1);
    expect(travels).toEqual([{ zone: 'greenway' }]);
  });

  it('the real east gate is open by default (Plan 3 Task 8), and openExits keeps it open', async () => {
    const shut = await start();
    expect(shut.app.isExitOpen('grove', 'greenway')).toBe(true);
    await shut.app.close();
    const open = await start({ openExits: { grove: ['greenway'] } });
    expect(open.app.isExitOpen('grove', 'greenway')).toBe(true);
  });

  it("walking into the greenway's west exit goes back to the grove, at its arrival point", async () => {
    const { url, store } = await start();
    const alice = await accountFor(store, 'Alice');
    await saveAs(store, alice.accountId, { zone: 'greenway', ...ENTRY });
    const a = await joinZone(url, alice.token, 'greenway');
    const travels = collect(a.room, 'travel');
    const left = leftWith(a.room);
    const gate = GREENWAY.exits[0]!;
    // Stop 2 m short of the gate's centre, on the line from the entry: inside its 2.5 m circle.
    const d = Math.hypot(ENTRY.x - gate.x, ENTRY.z - gate.z);
    const inside = { x: gate.x + ((ENTRY.x - gate.x) * 2) / d, z: gate.z + ((ENTRY.z - gate.z) * 2) / d };
    await walk(a.room, ENTRY, inside, GREENWAY.surface);
    expect(await left).toBe(CloseCode.CONSENTED);
    expect(travels).toEqual([{ zone: 'grove' }]);

    const b = await joinGrove(url, alice.token);
    expect(me(b.room)).toMatchObject(shown({ x: gate.arrive.x, z: gate.arrive.z, facing: gate.arrive.facing, y: groveTownSurface(gate.arrive.x, gate.arrive.z)! + 0 }));
  });

  it('refuses the move and says why when the next zone is full; the adventurer stays', async () => {
    const { url, store } = await start({ ...withExit(), maxPlayers: 1 });
    const bob = await accountFor(store, 'Bob');
    await saveAs(store, bob.accountId, { zone: 'greenway', ...ENTRY });
    await joinZone(url, bob.token, 'greenway');
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const notices = collect(a.room, 'notice');
    const corrections = collect(a.room, 'correct');
    const travels = collect(a.room, 'travel');
    await walk(a.room, SPAWN, INTO_EXIT);
    await waitFor(() => notices.length > 0);
    expect(notices).toEqual([{ text: zoneFullReason('greenway') }]);
    expect(notices[0].text).toBe('The Greenway is full, try again soon');
    await waitFor(() => corrections.length > 0);
    expect(corrections[0].z).toBeGreaterThan(INTO_EXIT.z); // back to the last step outside
    await sleep(100);
    expect(travels).toEqual([]);
    expect(me(a.room).z).toBe(sx(corrections[0].z));
    expect((await store.getOrCreateAdventurer(alice.accountId)).zone).toBe('grove');
  });

  it('holds a seat in the next zone for the traveller, so a full zone cannot shut it out on the way', async () => {
    const { url, store } = await start({ ...withExit(), maxPlayers: 1 });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    const travels = collect(a.room, 'travel');
    const left = leftWith(a.room);
    await walk(a.room, SPAWN, INTO_EXIT);
    await left;
    expect(travels).toEqual([{ zone: 'greenway' }]);
    const bob = await accountFor(store, 'Bob');
    await saveAs(store, bob.accountId, { zone: 'greenway', ...ENTRY });
    expect(await refusal(url, bob.token, 'greenway')).toBe(zoneFullReason('greenway'));
    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room).name).toBe('Alice');
  });

  it('a travel that cannot be saved leaves the adventurer where it was, with a notice', async () => {
    const memory = createMemoryStore();
    const failing: Store = {
      ...memory,
      saveAdventurer: async (a, only) => (a.zone === 'greenway' ? Promise.reject(new Error('database down')) : memory.saveAdventurer(a, only)),
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({ ...withExit(), store: failing });
    const alice = await accountFor(failing, 'Alice');
    const a = await joinGrove(url, alice.token);
    const notices = collect(a.room, 'notice');
    const corrections = collect(a.room, 'correct');
    await walk(a.room, SPAWN, INTO_EXIT);
    await waitFor(() => notices.length > 0);
    expect(notices).toEqual([{ text: REASON_TRAVEL_FAILED }]);
    await waitFor(() => corrections.length > 0);
    expect(logged).toHaveBeenCalled();
    expect((await failing.getOrCreateAdventurer(alice.accountId)).zone).toBe('grove');
    // Still here and moving.
    const back = { x: 0.4, z: corrections[0].z };
    a.room.send('move', { ...back, y: groveTownSurface(back.x, back.z)! + 0, facing: 0, moving: true });
    await waitFor(() => me(a.room).x === sx(0.4));
  });

  it('a second sign-in while the travel is being saved waits for it, then is sent to the right zone', async () => {
    const memory = createMemoryStore();
    let travelSaving!: () => void;
    const saving = new Promise<void>((resolve) => (travelSaving = resolve));
    const slow: Store = {
      ...memory,
      saveAdventurer: async (a, only) => {
        if (a.zone === 'greenway') {
          travelSaving();
          await sleep(300);
        }
        return memory.saveAdventurer(a, only);
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the refused join is logged by Colyseus and the SDK
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { url } = await start({ ...withExit(), store: slow });
    const alice = await accountFor(slow, 'Alice');
    const a = await joinGrove(url, alice.token);
    const travels = collect(a.room, 'travel');
    const kicked = collect(a.room, 'kicked');
    void walk(a.room, SPAWN, INTO_EXIT);
    await saving;
    await expect(new Client(url).joinOrCreate('grove', { token: alice.token })).rejects.toThrow(REASON_ELSEWHERE);
    expect(kicked).toEqual([{ reason: 'Signed in somewhere else' }]);
    expect(travels).toEqual([]);
    expect(await slow.getOrCreateAdventurer(alice.accountId)).toMatchObject({ zone: 'greenway', x: ENTRY.x, z: ENTRY.z });
    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room)).toMatchObject(shown({ x: ENTRY.x, z: ENTRY.z }));
  });
});

describe('one adventurer, one room', () => {
  it('a sign-in in another zone kicks the older session there, and exactly one is online', async () => {
    const { url, store, app } = await start();
    const alice = await accountFor(store, 'Alice');
    const first = await joinGrove(url, alice.token);
    const kicked = collect(first.room, 'kicked');
    const left = leftWith(first.room);
    await saveAs(store, alice.accountId, { zone: 'greenway', ...ENTRY });
    const second = await joinZone(url, alice.token, 'greenway');
    expect(await left).toBeGreaterThan(0);
    expect(kicked).toEqual([{ reason: 'Signed in somewhere else' }]);
    await waitFor(() => app.stats().zones.grove.players === 0);
    expect(app.stats()).toMatchObject({ players: 1, zones: { grove: { players: 0 }, greenway: { players: 1 } } });
    expect(me(second.room)).toMatchObject(shown({ name: 'Alice', x: ENTRY.x, z: ENTRY.z }));
    // The kicked grove session did not write its zone back over the greenway.
    await sleep(50);
    expect((await store.getOrCreateAdventurer(alice.accountId)).zone).toBe('greenway');
  });

  it('a join is refused in a zone the adventurer is not saved in', async () => {
    const { url, store } = await start();
    const alice = await accountFor(store, 'Alice');
    expect(await refusal(url, alice.token, 'greenway')).toBe(REASON_ELSEWHERE);
    expect(await matchMaker.query({ name: 'greenway' })).toHaveLength(1);
  });
});

describe('saved with the adventurer', () => {
  /** Flat ground with a ramp along z = RAMP_Z up to 5 m at x = 6.25, ending in a sheer drop. */
  const RAMP_Z = -20;
  const rampSurface: Surface = (x, z) => (Math.abs(z - RAMP_Z) < 1.5 && x > 0 && x <= 6.25 ? 0.8 * x : 0);

  it('health: a fall to 80 hp, leaving and joining again still gives 80 hp (no healing by relogging)', async () => {
    const { url, store } = await start({ zones: { grove: { surface: rampSurface } } });
    const alice = await accountFor(store, 'Alice');
    await saveAs(store, alice.accountId, { x: 0, z: RAMP_Z });
    const a = await joinGrove(url, alice.token);
    const hurts = collect(a.room, 'hurt');
    expect(fallDamage(5)).toBe(20);
    await walk(a.room, { x: 0, z: RAMP_Z }, { x: 6.25, z: RAMP_Z }, rampSurface);
    await walk(a.room, { x: 6.25, z: RAMP_Z }, { x: 6.6, z: RAMP_Z }, rampSurface);
    await waitFor(() => hurts.length > 0);
    expect(hurts).toEqual([{ amount: 20, cause: 'fall' }]);
    await waitFor(() => me(a.room).hp === 80);
    await a.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(alice.accountId)).hp === 80);

    const again = await joinGrove(url, alice.token);
    expect(me(again.room)).toMatchObject({ hp: 80, maxHp: 100 });
    // And it waits out the regen delay again, rather than healing at once.
    await sleep(700);
    expect(me(again.room).hp).toBe(80);
  });

  it('a saved hp outside 1..maxHp is brought inside it on joining', async () => {
    const { url, store } = await start();
    const alice = await accountFor(store, 'Alice');
    await saveAs(store, alice.accountId, { hp: 0 });
    const a = await joinGrove(url, alice.token);
    expect(me(a.room).hp).toBe(1);
    await a.room.leave();
    await waitFor(async () => (await store.getOrCreateAdventurer(alice.accountId)).hp === 1);
    await saveAs(store, alice.accountId, { hp: 250 });
    const b = await joinGrove(url, alice.token);
    expect(me(b.room).hp).toBe(100);
  });

  it('the jobs are kept through a session and a travel', async () => {
    const { url, store } = await start(withExit());
    const alice = await accountFor(store, 'Alice');
    const jobs: JobsSave = {
      current: 'warrior',
      jobs: {
        warrior: { level: 2, xp: 120, picks: ['bulwark', 'mend'], talents: [], outfit: null },
        ranger: { level: 1, xp: 50, picks: ['sprint', 'barbed_rain'], talents: [], outfit: null },
      },
    };
    await saveAs(store, alice.accountId, { jobs });
    const a = await joinGrove(url, alice.token);
    collect(a.room, 'travel');
    const left = leftWith(a.room);
    await walk(a.room, SPAWN, INTO_EXIT);
    await left;
    expect(await store.getOrCreateAdventurer(alice.accountId)).toMatchObject({ zone: 'greenway', jobs });
  });

  it('a join where the zone has no ground stands at the zone\'s spawn', async () => {
    const { url, store } = await start();
    const alice = await accountFor(store, 'Alice');
    await saveAs(store, alice.accountId, { zone: 'greenway', x: -50, z: 0 }); // outside the greenway
    const a = await joinZone(url, alice.token, 'greenway');
    expect(me(a.room)).toMatchObject(shown({ x: ENTRY.x, z: ENTRY.z, facing: ENTRY.facing }));
  });
});

describe('stats', () => {
  it('reports each zone, and the lowest patch rate among zones with adventurers', async () => {
    const { url, store, app } = await start();
    expect(app.stats()).toMatchObject({ players: 0, zones: { grove: { players: 0 }, greenway: { players: 0 } } });
    await joinGrove(url, (await accountFor(store, 'Alice')).token);
    await sleep(1000);
    const stats = app.stats();
    expect(stats.zones.grove.players).toBe(1);
    expect(stats.tickHz).toBe(stats.zones.grove.tickHz);
    expect(stats.tickHz).toBeGreaterThan(12);
    expect((await health(url)).zones.grove.players).toBe(1);
  });
});

describe('travel edge cases', () => {
  /** A store whose travel saves (zone greenway) wait for `release()` before they are written. */
  function gatedStore() {
    const memory = createMemoryStore();
    let started!: () => void;
    const saving = new Promise<void>((resolve) => (started = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const store: Store = {
      ...memory,
      saveAdventurer: async (a, only) => {
        if (a.zone === 'greenway') {
          started();
          await gate;
        }
        return memory.saveAdventurer(a, only);
      },
    };
    return { store, saving, release };
  }

  it('a session left behind by a travel saved despite an error is sent on, not left unsaved', async () => {
    const memory = createMemoryStore();
    // The travel save is written, but the call fails (say a database timeout after the commit).
    const flaky: Store = {
      ...memory,
      saveAdventurer: async (a, only) => {
        const written = await memory.saveAdventurer(a, only);
        if (a.zone === 'greenway') throw new Error('timeout after commit');
        return written;
      },
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { url } = await start({ ...withExit(), store: flaky, saveSeconds: 0.2 });
    const alice = await accountFor(flaky, 'Alice');
    const a = await joinGrove(url, alice.token);
    const notices = collect(a.room, 'notice');
    const kicked = collect(a.room, 'kicked');
    const left = leftWith(a.room);
    await walk(a.room, SPAWN, INTO_EXIT);
    await waitFor(() => notices.length > 0);
    expect(notices[0]).toEqual({ text: REASON_TRAVEL_FAILED });
    // The next periodic save is refused (the store says greenway): the session is ended, with a reason.
    expect(await left).toBe(CloseCode.CONSENTED);
    expect(kicked).toEqual([{ reason: REASON_ELSEWHERE }]);
    expect(notices.at(-1)).toEqual({ text: REASON_ELSEWHERE });
    expect(await zoneOf(url, alice.token)).toEqual({ status: 200, body: { zone: 'greenway' } });
    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room)).toMatchObject(shown({ x: ENTRY.x, z: ENTRY.z }));
  });

  it('leaving while the travel is saved keeps the account held until the save settles', async () => {
    const { store, saving, release } = gatedStore();
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the refused join is logged by Colyseus and the SDK
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { url } = await start({ ...withExit(), store });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    void walk(a.room, SPAWN, INTO_EXIT);
    await saving;
    await a.room.leave(); // consented, mid-travel
    // A sign-in now (onAuth still sees the grove) must wait for the travel, then go to the greenway.
    const again = new Client(url).joinOrCreate('grove', { token: alice.token });
    let settled = false;
    again.then(() => (settled = true), () => (settled = true));
    await sleep(150);
    expect(settled).toBe(false);
    release();
    await expect(again).rejects.toThrow(REASON_ELSEWHERE);
    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room)).toMatchObject(shown({ x: ENTRY.x, z: ENTRY.z }));
  });

  it('a travel saved while the client is in its reconnect window ends the window; the client then finds the next zone', async () => {
    const { store, saving, release } = gatedStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { url } = await start({ ...withExit(), store, reconnectSeconds: 30 });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    void walk(a.room, SPAWN, INTO_EXIT);
    await saving;
    a.room.connection.close(); // dropped without consent: the server opens a reconnect window
    await sleep(150);
    release();
    await waitFor(async () => (await store.getOrCreateAdventurer(alice.accountId)).zone === 'greenway');
    await sleep(100);
    await expect(a.client.reconnect(a.room.reconnectionToken)).rejects.toThrow();
    expect(server!.app.stats().zones.grove.players).toBe(0);
    expect(await zoneOf(url, alice.token)).toEqual({ status: 200, body: { zone: 'greenway' } });
    const b = await joinZone(url, alice.token, 'greenway');
    expect(me(b.room)).toMatchObject(shown({ x: ENTRY.x, z: ENTRY.z }));
  });

  it('the seat kept for a traveller lasts the reconnect window, then is freed; the traveller can still join while there is room', async () => {
    const { url, store } = await start({ ...withExit(), maxPlayers: 1, reconnectSeconds: 0.4 });
    const alice = await accountFor(store, 'Alice');
    const a = await joinGrove(url, alice.token);
    collect(a.room, 'travel');
    const left = leftWith(a.room);
    await walk(a.room, SPAWN, INTO_EXIT);
    await left;
    const bob = await accountFor(store, 'Bob');
    await saveAs(store, bob.accountId, { zone: 'greenway', ...ENTRY });
    expect(await refusal(url, bob.token, 'greenway')).toBe(zoneFullReason('greenway')); // still held
    await sleep(500);
    const b = await joinZone(url, bob.token, 'greenway'); // the hold ran out: the seat is free
    await b.room.leave();
    await waitFor(() => server!.app.stats().zones.greenway.players === 0);
    const late = await joinZone(url, alice.token, 'greenway');
    expect(me(late.room)).toMatchObject(shown({ name: 'Alice', x: ENTRY.x, z: ENTRY.z }));
  });
});
