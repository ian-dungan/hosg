// Looks in the zone room (Plan 5): the look and gear codes ride in the state only when an adventurer enters a
// client's view and when they change; the Barber; emotes.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  BARBER_PEOPLE_PRICE, BARBER_PRICE, INTEREST_RADIUS, TOWN_STALLS, defaultLook, encodeLook, randomLook, prng, worldOf,
  type CampSpawn, type Look, type Surface, type ZoneDef,
} from '@sg2/shared';
import { createMemoryStore } from '../store/memory';
import {
  accountFor, carrying, collect, collectFromJoin, joinZone, patchLog, place, saveAs, sendInv, serverRoom, sleep, startServer, trackLooks, waitFor, type TestServer,
} from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const flat: Surface = (x, z) => (Math.hypot(x, z) > 300 ? null : 0);
const flatZone = (camps: CampSpawn[] = []): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps });
const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);

async function join(name: string, more: Parameters<typeof saveAs>[2] = {}) {
  const account = await accountFor(server!.store, name);
  if (Object.keys(more).length) await saveAs(server!.store, account.accountId, more);
  const joined = await joinZone(server!.url, account.token, 'grove');
  const views = collectFromJoin(joined.room, 'inventory'), refusals = collect(joined.room, 'invRefused'), free = collectFromJoin(joined.room, 'lookFree');
  const looks = trackLooks(joined.room);
  await waitFor(() => views.length > 0 && free.length > 0);
  return { ...joined, ...account, views, refusals, free, looks, look: () => looks.look(joined.room.state.players.get(joined.room.sessionId).eid) };
}

describe('looks', () => {
  it('look and gear go to a client when an adventurer enters its view and when they change, never in other patches', async () => {
    server = await startServer({ kits: true, combatSeed: 2, store: createMemoryStore(), zones: { grove: flatZone() } });
    const far = INTEREST_RADIUS * 3;
    const watcher = await join('Watcher', { x: 0, z: 0 });
    const a = await join('Alice', { x: far, z: 0 });
    const seen = watcher.looks, own = a.looks;
    expect(watcher.room.state.players.get(a.room.sessionId)).toBeUndefined();
    const eid = me(a.room).eid;
    await waitFor(() => own.look(eid));
    const look = own.look(eid)!, gear = own.gear(eid)!;
    expect(look).toBe(encodeLook(defaultLook(a.accountId)));
    const log = patchLog(watcher.room);
    /** `looks` entries the watcher got for Alice. */
    const sent = () => seen.messages.flatMap((m) => m.a).filter((e: any) => e[0] === eid);
    expect(sent()).toEqual([]);
    // into view: once
    const ack = place(a.room, 5, 0);
    await waitFor(() => watcher.room.state.players.get(a.room.sessionId));
    await waitFor(() => sent().length > 0);
    // walking about in view for a second: patches every step, no codes in any
    for (let k = 1; k <= 15; k++) {
      a.room.send('move', { x: 5 + k * 0.3, z: 0, y: 0, facing: 0, moving: true, ack });
      await sleep(1000 / 15);
    }
    await sleep(200);
    expect(log.length).toBeGreaterThan(10);
    expect(sent()).toEqual([[eid, look, gear]]);
    // a change: the new code once
    sendInv(a.room, { op: 'hideHead', hide: true }, null);
    await waitFor(() => sent().length === 2);
    const gear2 = sent()[1][2];
    expect(gear2).not.toBe(gear);
    expect(own.gear(eid)).toBe(gear2);
    // out of view and back: nothing again (the client keeps what it was sent)
    place(a.room, far, 0);
    await waitFor(() => !watcher.room.state.players.get(a.room.sessionId));
    place(a.room, 5, 0);
    await waitFor(() => watcher.room.state.players.get(a.room.sessionId));
    await sleep(200);
    expect(sent()).toHaveLength(2);
    // and no state patch ever carried either code
    for (const code of [look, gear, gear2]) expect(carrying(log, code)).toBe(0);
  });

  it('the Barber: in reach, gold taken, look field changes; unchanged look costs nothing; a bad look refused', async () => {
    server = await startServer({ kits: true, combatSeed: 2, store: createMemoryStore({ newAdventurer: { gold: 500 } }) });
    const a = await join('Alice');
    expect(a.free[0]).toEqual({ free: true });
    const id = (await server.store.getOrCreateAdventurer(a.accountId)).id;
    const s = TOWN_STALLS.barber, d = Math.hypot(s.x, s.z);
    const current: Look = defaultLook(a.accountId);
    const other: Look = { ...current, hair: { ...current.hair, style: (current.hair.style + 1) % 20 } };
    // away from the stall
    a.room.send('look', { look: other });
    await waitFor(() => a.refusals.length > 0);
    expect(a.refusals[0]).toMatchObject({ op: 'look', reason: 'where' });
    place(a.room, s.x - s.x / d, s.z - s.z / d);
    // the free visit first: 0 gold
    await sleep(150);
    a.room.send('look', { look: other });
    await waitFor(() => a.look() === encodeLook(other));
    await waitFor(() => a.free.length > 1);
    expect(a.free.at(-1)).toEqual({ free: false });
    expect(await server.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ gold: 500, lookFree: false });
    // the same look again: nothing taken, nothing written
    const version = (await server.store.getOrCreateAdventurer(a.accountId)).invVersion;
    await sleep(150);
    const n = a.views.length;
    a.room.send('look', { look: other });
    await waitFor(() => a.views.length > n);
    expect(await server.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ gold: 500, invVersion: version });
    // a new hair style: 40; a new people: 200
    await sleep(150);
    a.room.send('look', { look: current });
    await waitFor(() => a.look() === encodeLook(current));
    await waitFor(() => a.views.at(-1).gold === 500 - BARBER_PRICE);
    const people = randomLook(prng(3));
    const otherPeople = people.people === current.people ? randomLook(prng(4)) : people;
    expect(otherPeople.people).not.toBe(current.people);
    await sleep(150);
    a.room.send('look', { look: otherPeople });
    await waitFor(() => a.views.at(-1).gold === 500 - BARBER_PRICE - BARBER_PEOPLE_PRICE);
    expect(await server.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ gold: 500 - BARBER_PRICE - BARBER_PEOPLE_PRICE });
    expect(encodeLook((await server.store.getOrCreateAdventurer(a.accountId)).look!)).toBe(encodeLook(otherPeople));
    // not enough gold (taken down behind the session's back: the refusal is checked on a fresh read)
    const now = await server.store.getOrCreateAdventurer(a.accountId);
    await server.store.writeInventory(now.id, now.invVersion, { inventory: now.inventory, jobs: now.jobs, dGold: 10 - now.gold, dSeals: 0 });
    await sleep(150);
    a.room.send('look', { look: current });
    await waitFor(() => a.refusals.length > 1);
    expect(a.refusals.at(-1)).toMatchObject({ reason: 'gold' });
    // bad looks: refused, never thrown on (an out-of-range slider, fur on a Human, junk)
    const human = { ...current, people: 'human', fur: { pattern: 0, colour: 0, tail: 0 } };
    for (const bad of [{ ...current, body: { ...current.body, height: 99 } }, human, 'x', null, { v: 1 }]) {
      await sleep(150);
      const r = a.refusals.length;
      a.room.send('look', { look: bad });
      await waitFor(() => a.refusals.length > r);
      expect(a.refusals.at(-1)).toMatchObject({ op: 'look', reason: 'unknown' });
    }
    expect(serverRoom(a.room).stepErrors).toBe(0);
    void id;
  }, 15_000);

  it('emote at most every 2 s, not in combat', async () => {
    server = await startServer({ kits: true, combatSeed: 2, store: createMemoryStore(), zones: { grove: flatZone() } });
    const a = await join('Alice', { x: 0, z: 0 });
    a.room.send('emote', { emote: 'wave' });
    await waitFor(() => me(a.room).emote === 'wave');
    const at = me(a.room).emoteAt;
    a.room.send('emote', { emote: 'bow' });
    a.room.send('emote', { emote: 'nonsense' });
    await sleep(500);
    expect(me(a.room)).toMatchObject({ emote: 'wave', emoteAt: at });
    await sleep(1600);
    const w = worldOf(serverRoom(a.room).combat), adv = w.adventurers.get(me(a.room).eid)!;
    adv.lastCombatAt = w.now;
    a.room.send('emote', { emote: 'cheer' });
    await sleep(300);
    expect(me(a.room).emote).toBe('wave');
    adv.lastCombatAt = -Infinity;
    a.room.send('emote', { emote: 'cheer' });
    await waitFor(() => me(a.room).emote === 'cheer');
    expect(me(a.room).emoteAt).toBeGreaterThan(at);
  }, 10_000);
});
