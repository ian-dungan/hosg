// Lampfall instances through the rooms: one private instance per party (a solo adventurer is a party of
// one), the cap and its race, who may join, seats held for a drop, saving at the crater mouth, party
// changes inside, death and release, wipes, leaving, and closing (empty, cleared, expired), with every
// registry entry, room and seat gone afterwards. Short test-only timings through the app's options.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/sdk';
import {
  LAMPFALL_MOUTH, MAX_HP, MAX_INSTANCES, REASON_ELSEWHERE, REASON_INSTANCE_CLOSED, REASON_INSTANCES_FULL, REASON_LEFT_PARTY,
  lampfallLayout, worldOf, zoneDef,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { REASON_IN_COMBAT } from './instances';
import {
  accountFor, collect, collectFromJoin, engineParty, intoLampfall, joinInstance, joinZone, partyUp, place, saveAs, serverRoom, sleep, startServer, waitFor, walk,
  type TestServer,
} from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const TIMINGS = { reconnectS: 2, evictS: 1, wipeS: 1, releaseMinS: 1, autoReleaseS: 3, sealS: 0.5 };
async function start(over: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  server = await startServer({ combatSeed: 3, reconnectSeconds: 2, instances: { emptyS: 1, sweepMs: 100, timings: TIMINGS }, ...over });
  return server;
}

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const L = lampfallLayout();
const rim = L.rooms[0];
const lampfall = zoneDef('lampfall').surface;
const greenwaySurface = zoneDef('greenway').surface;
const health = async (url: string) => (await (await fetch(`${url}/healthz`)).json()) as any;
const zoneOf = async (url: string, token: string) => (await (await fetch(`${url}/api/zone`, { headers: { authorization: `Bearer ${token}` } })).json()) as any;
const near = (a: { x: number; z: number }, b: { x: number; z: number }, d = 0.1) => Math.hypot(a.x - b.x, a.z - b.z) <= d;

describe('Lampfall instances', () => {
  it('A and B in a party walk into the mouth: one instance, both inside, state.instance set, stored zone still greenway', async () => {
    const { url, store, app } = await start();
    const a = await accountFor(store, 'Alice'), b = await accountFor(store, 'Bob');
    for (const x of [a, b]) await saveAs(store, x.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    const ga = await joinZone(url, a.token, 'greenway'), gb = await joinZone(url, b.token, 'greenway');
    const partyId = await partyUp(ga.room, gb.room, 'Bob');
    await ga.room.leave();
    await gb.room.leave();
    const ia = await intoLampfall(url, store, a, { saved: false });
    expect(ia.travel).toEqual({ zone: 'lampfall', instance: ia.roomId });
    const ib = await intoLampfall(url, store, b, { saved: false });
    expect(ib.roomId).toBe(ia.roomId);
    expect(app.instances.count).toBe(1);
    await waitFor(() => ia.room.state.players.size === 2);
    expect(ia.room.state.instance).toBe(ia.roomId);
    // both stand at the rim (the first checkpoint), in the party in the engine (setParty after the instance's addAdventurer)
    expect(near(me(ia.room), rim, 0.05)).toBe(true);
    expect(engineParty(ia.room)).toBe(partyId);
    expect(engineParty(ib.room)).toBe(partyId);
    for (const x of [a, b]) expect(await store.getOrCreateAdventurer(x.accountId)).toMatchObject({ zone: 'greenway', x: LAMPFALL_MOUTH.arrive.x, z: LAMPFALL_MOUTH.arrive.z });
    // the instance view arrives on join
    const views = collectFromJoin(ia.room, 'instance');
    await waitFor(() => views.length > 0);
    expect(views.at(-1)).toMatchObject({ checkpoint: 'rim', cleared: [], sealed: null, wipeIn: null, releaseIn: null, partySize: 2 });
    expect((await health(url)).instances).toMatchObject({ open: 1, players: 2 });
  }, 20000);

  it('a solo adventurer gets its own instance; two parties never share one', async () => {
    const { url, store, app } = await start();
    const a = await accountFor(store, 'Alice'), c = await accountFor(store, 'Carol');
    const ia = await intoLampfall(url, store, a);
    const ic = await intoLampfall(url, store, c);
    expect(ic.roomId).not.toBe(ia.roomId);
    expect(app.instances.count).toBe(2);
    expect(app.instances.byRoom(ia.roomId)?.key).toBe(`solo:${a.accountId}`);
    expect(ia.room.state.players.size).toBe(1);
    expect(ic.room.state.players.size).toBe(1);
  }, 20000);

  it(`the ${MAX_INSTANCES + 1}th party is refused with REASON_INSTANCES_FULL; two parties racing for the ${MAX_INSTANCES}th: exactly one opens`, async () => {
    const { url, store, app } = await start();
    // eleven others are open already (straight through the registry: each opens a real instance room)
    for (let i = 0; i < MAX_INSTANCES - 1; i++) expect(await app.instances.enter(`solo:other${i}`, `other${i}`)).not.toBe('full');
    expect(app.instances.count).toBe(MAX_INSTANCES - 1);
    // two racing for the last: one gets it
    const race = await Promise.all([app.instances.enter('solo:x', 'x'), app.instances.enter('solo:y', 'y')]);
    expect(race.filter((r) => r === 'full').length).toBe(1);
    expect(app.instances.count).toBe(MAX_INSTANCES);
    // the next party walking into the mouth is corrected with the notice, and stays in the Greenway
    const d = await accountFor(store, 'Dave');
    await saveAs(store, d.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    const gd = await joinZone(url, d.token, 'greenway');
    const notices = collect(gd.room, 'notice'), corrections = collect(gd.room, 'correct'), travels = collect(gd.room, 'travel');
    await walk(gd.room, LAMPFALL_MOUTH.arrive, LAMPFALL_MOUTH, greenwaySurface);
    await waitFor(() => notices.some((n) => n.text === REASON_INSTANCES_FULL));
    expect(corrections.length).toBeGreaterThan(0);
    expect(travels).toEqual([]);
    expect(app.instances.count).toBe(MAX_INSTANCES);
    expect((await health(url)).instances.open).toBe(MAX_INSTANCES);
  }, 30000);

  it('joining an instance by room id without being allowed is refused; walking in mid-fight is refused', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Alice'), m = await accountFor(store, 'Mallory');
    const ia = await intoLampfall(url, store, a);
    await saveAs(store, m.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    await expect(joinInstance(url, m.token, ia.roomId)).rejects.toThrow(REASON_ELSEWHERE);
    expect(ia.room.state.players.size).toBe(1);
    // nobody opens an instance but the registry: a client's joinOrCreate or create of 'lampfall' is refused
    const { Client } = await import('@colyseus/sdk');
    await expect(new Client(url).joinOrCreate('lampfall', { token: m.token, instanceKey: 'solo:x' })).rejects.toThrow();
    await expect(new Client(url).create('lampfall', { token: m.token })).rejects.toThrow();
    expect((await matchMaker.query({ name: 'lampfall' })).length).toBe(1);
    // in combat at the mouth: corrected with the notice
    const gm = await joinZone(url, m.token, 'greenway');
    const room = serverRoom(gm.room);
    const own = room.combat.self.bind(room.combat);
    const self = vi.spyOn(room.combat, 'self').mockImplementation((id) => {
      const v = own(id);
      return v && { ...v, inCombat: true };
    });
    const notices = collect(gm.room, 'notice');
    await walk(gm.room, LAMPFALL_MOUTH.arrive, LAMPFALL_MOUTH, greenwaySurface);
    await waitFor(() => notices.some((n) => n.text === REASON_IN_COMBAT));
    self.mockRestore();
  }, 20000);

  it('a drop inside holds the seat; /api/zone answers lampfall with the room; a fresh sign-in rejoins it where it stood; after the hold, the mouth', async () => {
    const { url, store, app } = await start();
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    expect(await zoneOf(url, a.token)).toEqual({ zone: 'lampfall', instance: ia.roomId });
    // walk a little, then drop
    const spot = { x: rim.x + 3, z: rim.z };
    await walk(ia.room, rim, spot, lampfall);
    await waitFor(() => near(me(ia.room), spot, 0.05));
    ia.room.connection.close();
    await sleep(300);
    expect(await zoneOf(url, a.token)).toEqual({ zone: 'lampfall', instance: ia.roomId });
    // a fresh sign-in (another tab) within the hold: into the same instance, where it stood
    const again = await joinInstance(url, a.token, ia.roomId);
    expect(near(me(again.room), spot, 0.05)).toBe(true);
    expect(again.room.state.players.size).toBe(1);
    // a second drop, and nobody comes back: after the hold (2 s here) the seat is gone
    again.room.connection.close();
    await sleep(2600);
    expect(await zoneOf(url, a.token)).toEqual({ zone: 'greenway' });
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    // and the empty instance closes (1 s here) with nothing left of it
    await waitFor(() => app.instances.count === 0, 3000);
    await waitFor(() => !matchMaker.getLocalRoomById(ia.roomId), 3000);
    expect(app.instances.counts()).toEqual({ open: 0, opening: 0, early: 0, closing: 0, held: 0 });
    expect((await health(url)).instances).toEqual({ open: 0, players: 0, tickMsP95Max: 0 });
  }, 20000);

  it('signing out inside saves at the mouth; a server restart puts everyone at the mouth', async () => {
    const { url, store } = await start({ saveSeconds: 0.2 });
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    await walk(ia.room, rim, { x: rim.x + 4, z: rim.z }, lampfall);
    await sleep(500); // periodic saves while inside: still the mouth
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    await ia.room.leave();
    await sleep(200);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    // a restart (a fresh app on the same store): the adventurer joins the Greenway at the mouth
    const b = await accountFor(store, 'Bob');
    await intoLampfall(url, store, b);
    await server!.app.close();
    server = await startServer({ store, combatSeed: 3 });
    expect(await zoneOf(server.url, b.token)).toEqual({ zone: 'greenway' });
    const gb = await joinZone(server.url, b.token, 'greenway');
    expect(near(me(gb.room), LAMPFALL_MOUTH.arrive, 0.05)).toBe(true);
  }, 20000);

  it('kicked from the party inside: notice, then out after INSTANCE_EVICT_S; a member joining late gets in; a disbanded party keeps the instance for the one who stayed', async () => {
    const { url, store, app } = await start();
    const a = await accountFor(store, 'Alice'), b = await accountFor(store, 'Bob'), c = await accountFor(store, 'Carol');
    for (const x of [a, b, c]) await saveAs(store, x.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    const ga = await joinZone(url, a.token, 'greenway'), gb = await joinZone(url, b.token, 'greenway');
    const partyId = await partyUp(ga.room, gb.room, 'Bob');
    await ga.room.leave();
    await gb.room.leave();
    const ia = await intoLampfall(url, store, a, { saved: false });
    const ib = await intoLampfall(url, store, b, { saved: false });
    // Carol joins the party late (from the Greenway) and walks in: the same instance
    const gc = await joinZone(url, c.token, 'greenway');
    await partyUp(ia.room, gc.room, 'Carol');
    await gc.room.leave();
    const ic = await intoLampfall(url, store, c, { saved: false });
    expect(ic.roomId).toBe(ia.roomId);
    expect(engineParty(ic.room)).toBe(partyId);
    // Alice kicks Carol mid-run: a notice, then out to the mouth after 1 s (here)
    const notices = collect(ic.room, 'notice'), travels = collect(ic.room, 'travel');
    ia.room.send('party', { op: 'kick', name: 'Carol' });
    await waitFor(() => notices.some((n) => n.text === REASON_LEFT_PARTY));
    expect(travels).toEqual([]);
    await waitFor(() => travels.length === 1, 3000);
    expect(travels[0]).toEqual({ zone: 'greenway' });
    expect(app.instances.byRoom(ia.roomId)?.allowed.has(c.accountId)).toBe(false);
    await expect(joinInstance(url, c.token, ia.roomId)).rejects.toThrow(REASON_ELSEWHERE);
    // Bob leaves: the party dissolves; Bob is sent out, Alice keeps the instance (solo now)
    const bTravels = collect(ib.room, 'travel');
    ib.room.send('party', { op: 'leave' });
    await waitFor(() => bTravels.length === 1, 3000);
    expect(app.instances.byRoom(ia.roomId)?.key).toBe(`solo:${a.accountId}`);
    expect(me(ia.room)).toBeTruthy();
    expect(engineParty(ia.room)).toBe(null);
    await sleep(1200);
    expect(ia.room.state.players.size).toBe(1); // nobody sent Alice out
  }, 30000);

  it("an invitee standing in another party's instance cannot accept until it leaves ('in-instance')", async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Alice'), b = await accountFor(store, 'Bob');
    const ia = await intoLampfall(url, store, a);
    const ib = await intoLampfall(url, store, b);
    const refusals = collect(ib.room, 'partyRefused'), invites = collect(ib.room, 'partyInvite');
    ia.room.send('party', { op: 'invite', name: 'Bob' });
    const invite = await waitFor(() => invites[0]);
    ib.room.send('party', { op: 'accept', partyId: invite.partyId });
    await waitFor(() => refusals.length === 1);
    expect(refusals[0].reason).toBe('in-instance');
  }, 20000);

  it('death inside: no statue; respawn refused; release refused before RELEASE_MIN_S, then at the checkpoint; auto release later', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    const ack = place(ia.room, rim.x + 4, rim.z + 2);
    await waitFor(() => near(me(ia.room), { x: rim.x + 4, z: rim.z + 2 }));
    const room = serverRoom(ia.room), w = worldOf(room.combat);
    const refusals = collect(ia.room, 'refused'), respawned = collect(ia.room, 'respawned'), travels = collect(ia.room, 'travel');
    killAdventurer(w, w.adventurers.get(me(ia.room).eid)!, w.now);
    await waitFor(() => me(ia.room).dead === true);
    ia.room.send('respawn', {});
    ia.room.send('release', {});
    await waitFor(() => refusals.length === 2);
    expect(refusals).toEqual([{ action: 'respawn', reason: 'invalid' }, { action: 'respawn', reason: 'cooldown' }]);
    await sleep(1100);
    ia.room.send('release', {});
    await waitFor(() => respawned.length === 1);
    expect(near(respawned[0], rim, 0.01)).toBe(true);
    expect(respawned[0].seq).toBe(ack + 1);
    await waitFor(() => me(ia.room).dead === false && me(ia.room).hp === MAX_HP);
    expect(travels).toEqual([]); // never to the statue
    // dead again: it gets up by itself after AUTO_RELEASE_S (3 s here)
    killAdventurer(w, w.adventurers.get(me(ia.room).eid)!, w.now);
    await waitFor(() => me(ia.room).dead === true);
    await waitFor(() => respawned.length === 2, 4500);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'greenway' });
  }, 20000);

  it('a wipe: everyone gets up at the checkpoint after WIPE_DELAY_S; killed packs stay dead; engaged enemies reset', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    const room = serverRoom(ia.room), w = worldOf(room.combat);
    const cellar = L.rooms[1];
    const pack = [...w.enemies.values()].filter((e) => Math.hypot(e.camp.x - cellar.x, e.camp.z - cellar.z) <= cellar.r);
    expect(pack.length).toBe(3);
    // one of the pack dies (and must stay dead), the others engage Alice
    const { killEnemy } = await import('../../../shared/src/combat/adventurer');
    killEnemy(w, pack[0], w.now);
    place(ia.room, cellar.x - 4, cellar.z);
    await waitFor(() => pack[1].targetId !== null || pack[2].targetId !== null, 4000);
    const respawned = collect(ia.room, 'respawned'), views = collect(ia.room, 'instance');
    killAdventurer(w, w.adventurers.get(me(ia.room).eid)!, w.now);
    await waitFor(() => ia.room.state.wipeAt > 0);
    await waitFor(() => views.some((v) => v.wipeIn !== null));
    await waitFor(() => respawned.length === 1, 3000);
    expect(near(respawned[0], rim, 0.01)).toBe(true);
    await waitFor(() => ia.room.state.wipeAt === 0);
    // the engaged ones went home (and heal); the killed one never comes back
    await waitFor(() => pack.slice(1).every((e) => e.targetId === null), 3000);
    await sleep(1500);
    expect(pack[0].alive).toBe(false);
    expect(pack[0].respawnAt).toBe(Infinity);
  }, 20000);

  it('the exit stair and leaveInstance take you to the mouth; an empty instance closes after INSTANCE_EMPTY_S, a cleared one at once', async () => {
    const { url, store, app } = await start({ instances: { emptyS: 2, sweepMs: 100, timings: TIMINGS } });
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    const travels = collect(ia.room, 'travel');
    await walk(ia.room, rim, L.exitStair, lampfall);
    await waitFor(() => travels.length === 1);
    expect(travels[0]).toEqual({ zone: 'greenway' });
    const g = await joinZone(url, a.token, 'greenway');
    expect(near(me(g.room), LAMPFALL_MOUTH.arrive, 0.05)).toBe(true);
    await sleep(800);
    expect(app.instances.count).toBe(1); // not yet: empty for under 2 s
    await waitFor(() => app.instances.count === 0, 3000);
    await g.room.leave();
    // a second run: leaveInstance; it was cleared, so it closes at once
    const again = await intoLampfall(url, store, a);
    expect(again.roomId).not.toBe(ia.roomId);
    app.instances.markCleared(again.roomId);
    const out = collect(again.room, 'travel');
    again.room.send('leaveInstance', {});
    await waitFor(() => out.length === 1);
    await waitFor(() => app.instances.count === 0, 600);
    await waitFor(() => !matchMaker.getLocalRoomById(again.roomId), 2000);
  }, 20000);

  it('an instance past its hard lifetime sends everyone out with the notice and closes', async () => {
    const { url, store, app } = await start({ instances: { maxS: 1.5, emptyS: 60, sweepMs: 100, timings: TIMINGS } });
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    const notices = collect(ia.room, 'notice'), travels = collect(ia.room, 'travel');
    await waitFor(() => travels.length === 1, 3000);
    expect(notices.map((n) => n.text)).toContain(REASON_INSTANCE_CLOSED);
    expect(travels[0]).toEqual({ zone: 'greenway' });
    await waitFor(() => app.instances.count === 0 && !matchMaker.getLocalRoomById(ia.roomId), 2000);
    expect(await store.getOrCreateAdventurer(a.accountId)).toMatchObject({ zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
  }, 20000);

  it('signing in elsewhere mid-run (the Greenway) ends the instance session, saved at the mouth', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Alice');
    const ia = await intoLampfall(url, store, a);
    const kicked = collect(ia.room, 'kicked');
    const g = await joinZone(url, a.token, 'greenway');
    await waitFor(() => kicked.length === 1);
    expect(near(me(g.room), LAMPFALL_MOUTH.arrive, 0.05)).toBe(true);
    expect(await zoneOf(url, a.token)).toEqual({ zone: 'greenway' });
  }, 20000);
});
