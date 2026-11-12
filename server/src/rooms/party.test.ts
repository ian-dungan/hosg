// Parties in the zone rooms: invites by tap and by name across zones, party views, party chat,
// the ally rule through the room (setParty on every way into the engine), pinned views, shared
// kill credit, the status relay's rate, travel and reconnects, and junk or spam refused.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  JOBS, KILL_XP, PARTY_TEXT, SPAWN, groveTownSurface, levelForXp, newJobsSave, slotsFor, worldOf, zoneDef,
  type CampSpawn, type JobId, type Surface, type ZoneDef, type ZoneExit, type ZoneId,
} from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import type { Store } from '../store/types';
import { accountFor, collect, collectFromJoin, engineParty, joinZone, partyUp, saveAs, serverRoom, sleep, startServer, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

/** Flat open ground within 200 m, all in sight. */
const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const flatZone = (camps: CampSpawn[], more: Partial<ZoneDef> = {}): Partial<ZoneDef> => ({ surface: flat, ground: flat, sight: () => true, camps, ...more });
const THORNLING: CampSpawn = { kind: 'thornling', x: 0, z: -40, facing: 0 };

async function start(opts: Parameters<typeof startServer>[0] = {}): Promise<TestServer> {
  server = await startServer({ combatSeed: 5, zones: { grove: flatZone([{ kind: 'dummy', x: 40, z: 40, facing: 0 }]), greenway: flatZone([{ kind: 'dummy', x: 0, z: -20, facing: 0 }]) }, ...opts });
  return server;
}

const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);
const events = (fx: any[]) => fx.flatMap((m) => m.events);
const lastParty = (views: any[]) => views.at(-1)?.party;

async function joinAt(url: string, store: Store, name: string, x: number, z: number, more: Parameters<typeof saveAs>[2] = {}, zone: ZoneId = 'grove') {
  const account = await accountFor(store, name);
  await saveAs(store, account.accountId, { x, z, facing: 0, zone, ...more });
  const joined = await joinZone(url, account.token, zone);
  return { ...joined, ...account, name };
}

describe('parties in the rooms', () => {
  it('A invites B by eid; B accepts; both get party views with each other; ids are engine ids in the same room', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5);
    const b = await joinAt(url, store, 'Bob', 3, -5);
    const aViews = collectFromJoin(a.room, 'party'), bViews = collectFromJoin(b.room, 'party');
    const invites = collect(b.room, 'partyInvite'), refusals = collect(a.room, 'partyRefused');
    await waitFor(() => a.room.state.players.has(b.room.sessionId) && aViews.length > 0 && bViews.length > 0);
    expect(aViews[0]).toEqual({ party: null }); // sent on join
    expect(engineParty(a.room)).toBeNull();
    // an enemy's id, and an id nobody has: unknown
    const dummy = [...serverRoom(a.room).combat.all()].find((v) => v.team === 'enemy')!;
    a.room.send('party', { op: 'invite', eid: dummy.id });
    a.room.send('party', { op: 'invite', eid: 99999 });
    a.room.send('party', { op: 'invite', eid: me(a.room).eid });
    await waitFor(() => refusals.length === 3);
    expect(refusals).toEqual([
      { reason: 'unknown', text: PARTY_TEXT.unknown }, { reason: 'unknown', text: PARTY_TEXT.unknown }, { reason: 'self', text: PARTY_TEXT.self },
    ]);
    a.room.send('party', { op: 'invite', eid: me(b.room).eid });
    const invite = await waitFor(() => invites[0]);
    expect(invite).toEqual({ partyId: expect.stringMatching(/^p\d+$/), from: 'Alice', size: 1 });
    b.room.send('party', { op: 'accept', partyId: invite.partyId });
    await waitFor(() => lastParty(aViews)?.members.length === 2 && lastParty(bViews)?.members.length === 2);
    const member = (name: string, leader: boolean, eid: number) => ({
      name, leader, online: true, zone: 'grove', eid, job: 'warrior', level: 1, hp: 100, maxHp: 100, dead: false, searing: 0,
    });
    const expected = { id: invite.partyId, members: [member('Alice', true, me(a.room).eid), member('Bob', false, me(b.room).eid)] };
    // (a new member's status follows within one status period)
    await waitFor(() => JSON.stringify(lastParty(aViews)) === JSON.stringify(expected) && JSON.stringify(lastParty(bViews)) === JSON.stringify(expected));
    expect(lastParty(aViews)).toEqual(expected);
    expect(engineParty(a.room)).toBe(invite.partyId);
    expect(engineParty(b.room)).toBe(invite.partyId);
    const health: any = await (await fetch(`${url}/healthz`)).json();
    expect(health.parties).toBe(1);
    // Bob is not the leader; Alice leaves and the party of one dissolves
    b.room.send('party', { op: 'kick', name: 'Alice' });
    const bRefusals = collect(b.room, 'partyRefused');
    await waitFor(() => bRefusals.length === 1);
    expect(bRefusals[0].reason).toBe('not-leader');
    a.room.send('party', { op: 'leave' });
    await waitFor(() => lastParty(aViews) === null && lastParty(bViews) === null);
    expect(engineParty(a.room)).toBeNull();
    expect(engineParty(b.room)).toBeNull();
    expect(((await (await fetch(`${url}/healthz`)).json()) as any).parties).toBe(0);
  });

  it("invite by name reaches B in another zone; B accepts there; the view shows each member's zone", async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5);
    const b = await joinAt(url, store, 'Bob', 0, -10, {}, 'greenway');
    const aViews = collect(a.room, 'party');
    await partyUp(a.room, b.room, 'bOB'); // any case
    await waitFor(() => lastParty(aViews)?.members.length === 2);
    await waitFor(() => lastParty(aViews).members[1].zone === 'greenway');
    expect(lastParty(aViews).members.map((m: any) => [m.name, m.zone, m.eid])).toEqual([['Alice', 'grove', me(a.room).eid], ['Bob', 'greenway', -1]]);
    expect(engineParty(b.room)).toBe(lastParty(aViews).id);
  });

  it('party chat reaches members in both zones and nobody else; markup arrives as plain text', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5);
    const b = await joinAt(url, store, 'Bob', 0, -10, {}, 'greenway');
    const c = await joinAt(url, store, 'Carol', 2, -5);
    const refusals = collect(c.room, 'partyRefused');
    c.room.send('chat', { text: 'hi party', channel: 'party' }); // not in one
    await waitFor(() => refusals.length === 1);
    expect(refusals[0]).toEqual({ reason: 'not-member', text: PARTY_TEXT['not-member'] });
    await partyUp(a.room, b.room, 'Bob');
    const heard = { a: collect(a.room, 'chat'), b: collect(b.room, 'chat'), c: collect(c.room, 'chat') };
    a.room.send('chat', { text: '<b>to the</b> den', channel: 'party' });
    await waitFor(() => heard.a.length === 1 && heard.b.length === 1);
    const line = { from: 'Alice', text: '<b>to the</b> den', channel: 'party' };
    expect(heard.a).toEqual([line]);
    expect(heard.b).toEqual([line]);
    await sleep(1100); // the interval is shared by the channels
    a.room.send('chat', { text: 'everyone', channel: 'zone' });
    a.room.send('chat', { text: 'junk', channel: 'shout' }); // dropped
    await waitFor(() => heard.c.length === 1);
    await sleep(100);
    expect(heard.c).toEqual([{ from: 'Alice', text: 'everyone', channel: 'zone' }]);
    expect(heard.b.length).toBe(1);
  });

  it('Field Dressing without an ally id heals the party member, never the nearer stranger', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5, { jobs: newJobsSave('ranger' as JobId) });
    const b = await joinAt(url, store, 'Bob', 6, -5, { hp: 60 });
    const c = await joinAt(url, store, 'Carol', 3, -5, { hp: 30 });
    await partyUp(a.room, b.room, 'Bob');
    const fx = collect(a.room, 'fx');
    const slot = slotsFor({ job: 'ranger', picks: [...JOBS.ranger.picks.solo] }).indexOf('field_dressing');
    a.room.send('ability', { slot, phase: 'press' });
    await waitFor(() => events(fx).some((e) => e.t === 'heal'));
    expect(events(fx).filter((e) => e.t === 'heal').map((e) => e.dst)).toEqual([me(b.room).eid]);
    await waitFor(() => me(b.room).hp > 60);
    expect(me(c.room).hp).toBe(30);
  });

  it('pinned: a party member 120 m away stays in the view; a stranger 120 m away does not', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, 60);
    const b = await joinAt(url, store, 'Bob', 0, -60);
    const c = await joinAt(url, store, 'Carol', 1, -60);
    await sleep(300);
    expect(a.room.state.players.has(b.room.sessionId)).toBe(false);
    await partyUp(a.room, b.room, 'Bob');
    await waitFor(() => a.room.state.players.has(b.room.sessionId) && b.room.state.players.has(a.room.sessionId));
    await sleep(400);
    expect(a.room.state.players.has(b.room.sessionId)).toBe(true);
    expect(a.room.state.players.has(c.room.sessionId)).toBe(false);
    // leaving the party unpins
    b.room.send('party', { op: 'leave' });
    await waitFor(() => !a.room.state.players.has(b.room.sessionId));
  });

  it("shared credit: B 20 m away gets credit and xp for A's kill; C (not in the party) does not; a member in another zone does not", async () => {
    // the fight is in the grove here (flat, a thornling); Dave stays in the Greenway
    const s = (server = await startServer({ combatSeed: 5, zones: { grove: flatZone([THORNLING]), greenway: flatZone([]) } }));
    const a = await joinAt(s.url, s.store, 'Alice', 0, -36);
    const b = await joinAt(s.url, s.store, 'Bob', 20, -36);
    const c = await joinAt(s.url, s.store, 'Carol', -20, -36);
    const d = await joinAt(s.url, s.store, 'Dave', 0, -10, {}, 'greenway');
    await partyUp(a.room, b.room, 'Bob');
    await partyUp(a.room, d.room, 'Dave');
    const credits = { a: collect(a.room, 'credit'), b: collect(b.room, 'credit'), c: collect(c.room, 'credit'), d: collect(d.room, 'credit') };
    const bXp = collect(b.room, 'jobXp');
    const thornling = await waitFor(() => [...a.room.state.enemies.values()].find((e: any) => e.kind === 'thornling'));
    a.room.send('target', { id: thornling.eid });
    const e = [...worldOf(serverRoom(a.room).combat).enemies.values()].find((x) => x.kind === 'thornling')!;
    await waitFor(() => e.threat.has(me(a.room).eid), 4000);
    expect(e.threat.has(me(b.room).eid)).toBe(false);
    e.hp = 1;
    await waitFor(() => credits.a.length > 0 && credits.b.length > 0, 5000);
    await sleep(200);
    expect(credits.b).toEqual([{ kind: 'thornling' }]);
    expect(bXp).toEqual([{ job: 'warrior', gained: KILL_XP.thornling, xp: KILL_XP.thornling, level: levelForXp(KILL_XP.thornling), levelUp: false }]);
    expect(credits.c).toEqual([]);
    expect(credits.d).toEqual([]);
  });

  it('status relay at most 2 Hz and only on change; a same-room member reads hp from the state instead', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5);
    const b = await joinAt(url, store, 'Bob', 0, -10, {}, 'greenway');
    const c = await joinAt(url, store, 'Carol', 3, -5);
    await partyUp(a.room, b.room, 'Bob');
    await partyUp(a.room, c.room, 'Carol');
    await sleep(700);
    const views = collect(b.room, 'party'), here = collect(c.room, 'party');
    await sleep(1200);
    expect(views.length).toBe(0); // nothing changed
    expect(here.length).toBe(0);
    const room = serverRoom(a.room);
    const eid = me(a.room).eid;
    const hurt = setInterval(() => room.combat.damage(eid, 1, worldOf(room.combat).now, 'fall'), 50);
    await sleep(2000);
    clearInterval(hurt);
    expect(views.length).toBeGreaterThanOrEqual(2);
    expect(views.length).toBeLessThanOrEqual(5); // 2 a second, plus one at the edges
    expect(views.at(-1).party.members[0].hp).toBeLessThan(100);
    expect(here.length).toBe(0);
    expect(c.room.state.players.get(a.room.sessionId).hp).toBeLessThan(100);
  });

  it('a party survives travel and a reconnect inside the 30 s window; every way back into an engine is in the party', async () => {
    const exit: ZoneExit = { to: 'greenway', x: 0, z: -15, r: 1.5, arrive: { ...zoneDef('greenway').spawn }, open: true };
    server = await startServer({ combatSeed: 5, reconnectSeconds: 30, autoRespawnSeconds: 60, zones: { grove: { exits: [exit] }, greenway: flatZone([]) } });
    const { url, store } = server;
    const a = await joinAt(url, store, 'Alice', SPAWN.x + 2, SPAWN.z);
    const b = await joinAt(url, store, 'Bob', SPAWN.x, SPAWN.z);
    const partyId = await partyUp(a.room, b.room, 'Bob');
    const aViews = collect(a.room, 'party');
    // travel: Bob walks into the exit and joins the Greenway
    await walk(b.room, SPAWN, { x: 0, z: -13.6 }, groveTownSurface);
    await waitFor(async () => (await store.getOrCreateAdventurer(b.accountId)).zone === 'greenway', 3000);
    const b2 = await joinZone(url, b.token, 'greenway');
    expect(engineParty(b2.room)).toBe(partyId);
    await waitFor(() => lastParty(aViews)?.members[1].zone === 'greenway');
    expect(lastParty(aViews).members[1]).toMatchObject({ name: 'Bob', online: true, eid: -1 });
    // a drop and a reconnect: the party view comes again, the engine still has the party
    const reconnectViews: any[] = [];
    a.room.connection.close();
    await sleep(300);
    const back = await a.client.reconnect(a.room.reconnectionToken);
    back.onMessage('party', (m: any) => reconnectViews.push(m));
    await waitFor(() => reconnectViews.length > 0);
    expect(reconnectViews[0].party.id).toBe(partyId);
    expect(engineParty(back)).toBe(partyId);
    // a relog (leave and join again)
    await back.leave();
    await sleep(200);
    const a2 = await joinZone(url, a.token, 'grove');
    expect(engineParty(a2.room)).toBe(partyId);
    // a respawn travel: Bob dies in the Greenway, respawns into the grove
    const room = serverRoom(b2.room);
    const w = worldOf(room.combat);
    killAdventurer(w, w.adventurers.get(me(b2.room).eid)!, w.now);
    await waitFor(() => me(b2.room).dead === true);
    await sleep(3100);
    b2.room.send('respawn', {});
    await waitFor(async () => (await store.getOrCreateAdventurer(b.accountId)).zone === 'grove', 3000);
    const b3 = await joinZone(url, b.token, 'grove');
    expect(engineParty(b3.room)).toBe(partyId);
  }, 15000);

  it('junk party messages are dropped; 30 invites a second end in rate', async () => {
    const { url, store } = await start();
    const a = await joinAt(url, store, 'Alice', 0, -5);
    const refusals = collect(a.room, 'partyRefused');
    for (const junk of [
      null, 'invite', 42, [], { op: 'invite' }, { op: 'invite', eid: NaN }, { op: 'invite', eid: -1 }, { op: 'invite', eid: 1.5 },
      { op: 'invite', name: 'x'.repeat(5000) }, { op: 'invite', name: '' }, { op: 'invite', eid: 1, name: 'Bob' }, { op: 'accept', partyId: 7 },
      { op: 'kick' }, { op: 'leave', extra: true }, { op: 'nonsense' }, { op: 'accept', partyId: 'p'.repeat(100) },
    ]) a.room.send('party', junk as never);
    await sleep(300);
    expect(refusals).toEqual([]);
    for (let i = 0; i < 30; i++) a.room.send('party', { op: 'invite', name: i % 2 ? '<b>Nobody</b>' : 'Nobody' });
    await waitFor(() => refusals.length === 30, 3000);
    expect(refusals.slice(0, 10).every((r) => r.reason === 'unknown')).toBe(true);
    expect(refusals.slice(10).every((r) => r.reason === 'rate')).toBe(true);
    // the room carries on
    a.room.send('chat', { text: 'still here' });
    const heard = collect(a.room, 'chat');
    await waitFor(() => heard.length === 1);
  });
});
