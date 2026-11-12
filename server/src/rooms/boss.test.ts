// The Lampfall's bosses through an instance room: the sealed gates (P4-a, P4-b), the checkpoint moving to
// the landing, the arena rule for the party (P4-c), the Warden's phases, fields, shards, ward and enrage
// in the state, the rewards (xp, one Seal a UTC day, the leaderboard, the solo title, the victory) and the
// lamp-lift. Adventurers are placed with the test-only `place` and kept alive with a large health pool
// where a fight must last; boss numbers are read from @sg2/shared, never written here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Room } from '@colyseus/sdk';
import {
  BOSSES, ENCOUNTERS, ENEMY_KINDS, GATE_PIT, GATE_WICK, GATE_WICK_EXIT, KILL_XP, LAMPFALL_MOUTH, REASON_ARENA_SEALED, lampfallGates, lampfallLayout, worldOf,
  zoneDef, type CheckpointId,
} from '@sg2/shared';
import { damageEnemy, killAdventurer, killEnemy } from '../../../shared/src/combat/adventurer';
import {
  accountFor, collect, collectFromJoin, engineParty, intoLampfall, joinZone, partyUp, place, saveAs, serverRoom, sleep, startServer, waitFor, walk, type TestServer,
} from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
  vi.restoreAllMocks();
});

const TIMINGS = { reconnectS: 2, evictS: 1, wipeS: 1, releaseMinS: 0.5, autoReleaseS: 30, sealS: 0.5 };
async function start(startAt?: CheckpointId): Promise<TestServer> {
  server = await startServer({ combatSeed: 3, reconnectSeconds: 2, instances: { emptyS: 1, sweepMs: 100, startAt, timings: TIMINGS } });
  return server;
}

const L = lampfallLayout();
const room = (id: string) => L.rooms.find((r) => r.id === id)!;
const den = room('wick_den'), pit = room('lens_pit'), landing = room('landing');
const [wickGate, wickExit, pitGate] = lampfallGates();
const lampfall = zoneDef('lampfall').surface;
const me = (r: Room<any, any>) => r.state.players.get(r.sessionId);
/** A point `along` m from gate g toward its room (negative: the corridor side). */
const by = (g: typeof wickGate, along: number) => ({ x: g.x + g.ux * along, z: g.z + g.uz * along });
const near = (a: { x: number; z: number }, b: { x: number; z: number }, d = 0.1) => Math.hypot(a.x - b.x, a.z - b.z) <= d;

/** Makes the adventurer of `r` hard to kill (a test-only health pool), so a fight can run its course. */
function sturdy(r: Room<any, any>) {
  const w = worldOf(serverRoom(r).combat), a = w.adventurers.get(me(r).eid)!;
  a.stats = { ...a.stats, maxHp: 100_000 };
  a.hp = 100_000;
}
const bossOf = (r: Room<any, any>, kind: string) => [...worldOf(serverRoom(r).combat).enemies.values()].find((e) => e.kind === kind)!;

/** Two party members in one instance: A and B (from the Greenway's crater mouth). */
async function duo(s: TestServer) {
  const a = await accountFor(s.store, 'Alice'), b = await accountFor(s.store, 'Bob');
  for (const x of [a, b]) await saveAs(s.store, x.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
  const ga = await joinZone(s.url, a.token, 'greenway'), gb = await joinZone(s.url, b.token, 'greenway');
  const partyId = await partyUp(ga.room, gb.room, 'Bob');
  await ga.room.leave();
  await gb.room.leave();
  const ia = await intoLampfall(s.url, s.store, a, { saved: false });
  const ib = await intoLampfall(s.url, s.store, b, { saved: false });
  return { a, b, ia, ib, partyId };
}

describe('Lampfall bosses', () => {
  it("the Wick Den's way on is shut from the start (P4-a): the landing cannot be reached without the kill", async () => {
    const s = await start();
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    expect(ia.room.state.gates).toBe(GATE_WICK_EXIT);
    // at the den's far side, walking out toward the landing (the Wickhound kept asleep for this check:
    // every spot in the den is within its notice, so its aggro is set to 0 on this engine)
    const hound = bossOf(ia.room, 'wickhound');
    hound.data = { ...hound.data, aggro: 0 } as never;
    const ack = place(ia.room, by(wickExit, 3.6).x, by(wickExit, 3.6).z);
    const notices = collect(ia.room, 'notice'), corrections = collect(ia.room, 'correct');
    await walk(ia.room, by(wickExit, 3.6), by(wickExit, -3.6), lampfall, ack);
    await waitFor(() => notices.some((n) => n.text === REASON_ARENA_SEALED));
    expect(corrections.length).toBeGreaterThan(0);
    expect(near(me(ia.room), by(wickExit, 3.6), 1)).toBe(true);
    const views = collectFromJoin(ia.room, 'instance');
    await waitFor(() => views.length > 0);
    expect(views.at(-1).checkpoint).toBe('rim');
  }, 20000);

  it("the Wickhound's gate seals SEAL_DELAY_S after it wakes and opens when it dies; poses into it are corrected with the notice, a dodge stops at it; the checkpoint moves to the landing", async () => {
    const s = await start();
    const { ia, ib, partyId } = await duo(s);
    sturdy(ia.room);
    sturdy(ib.room);
    // B waits in the corridor before the gate; A walks into the den and wakes the Wickhound
    const ackB = place(ib.room, by(wickGate, -4.5).x, by(wickGate, -4.5).z);
    place(ia.room, den.x - 3, den.z + 3);
    await waitFor(() => ia.room.state.sealed === 'wickhound', 4000);
    expect(ia.room.state.gates).toBe(GATE_WICK | GATE_WICK_EXIT);
    // B (outside) is no ally of A (inside) while sealed: P4-c; A keeps the party
    expect(engineParty(ib.room)).toBe(`${partyId}#out`);
    expect(engineParty(ia.room)).toBe(partyId);
    // B walks into the gate: corrected, with the notice
    const notices = collect(ib.room, 'notice'), corrections = collect(ib.room, 'correct'), refused = collect(ib.room, 'refused');
    await walk(ib.room, by(wickGate, -4.5), by(wickGate, 4), lampfall, ackB);
    await waitFor(() => notices.some((n) => n.text === REASON_ARENA_SEALED));
    expect(corrections.length).toBeGreaterThan(0);
    const bPos = me(ib.room);
    expect(Math.hypot(bPos.x - wickGate.x, bPos.z - wickGate.z)).toBeGreaterThan(wickGate.r);
    // a dodge into it rolls up to the wall and stops there (ruling: no refusal; the walled surface stops it)
    const from = { x: bPos.x, z: bPos.z };
    const rolls = collect(ib.room, 'displaced');
    ib.room.send('dodge', { ...from, y: lampfall(from.x, from.z)!, facing: 0, moving: false, ack: ackB, dx: wickGate.ux, dz: wickGate.uz });
    const roll = await waitFor(() => rolls.find((d) => d.kind === 'dodge'), 3000);
    expect(Math.hypot(roll.to.x - wickGate.x, roll.to.z - wickGate.z)).toBeGreaterThanOrEqual(wickGate.r - 1e-6);
    expect(Math.sign((roll.to.x - wickGate.x) * wickGate.ux + (roll.to.z - wickGate.z) * wickGate.uz)).toBe(-1);
    expect(refused.filter((r) => r.action === 'dodge')).toEqual([]);
    // the boss's arena rule is in the engine: its camp carries the arena (P4-c)
    const hound = bossOf(ia.room, 'wickhound');
    expect(hound.camp.arena?.(den.x, den.z)).toBe(true);
    expect(hound.camp.arena?.(from.x, from.z)).toBe(false);
    // the Wickhound dies: the gates open, the checkpoint is the landing, the den is cleared
    const views = collect(ia.room, 'instance'), victories = collect(ia.room, 'victory');
    const w = worldOf(serverRoom(ia.room).combat);
    killEnemy(w, hound, w.now);
    await waitFor(() => ia.room.state.gates === 0 && ia.room.state.sealed === '');
    await waitFor(() => views.some((v) => v.checkpoint === 'landing' && v.cleared.includes('wickhound')));
    await waitFor(() => engineParty(ib.room) === partyId);
    const v = await waitFor(() => victories[0], 3000);
    expect(v).toMatchObject({ boss: 'wickhound', xp: KILL_XP.wickhound, seal: false, title: null, rank: 1, lore: BOSSES.wickhound.lore.victory });
    expect(v.partySize).toBe(2);
    expect(await s.store.bossLeaderboard('wickhound', 2)).toHaveLength(1);
  }, 30000);

  it('a released adventurer cannot walk back into a sealed fight; someone standing in the gate when it shuts is put inside', async () => {
    const s = await start();
    const { ia, ib } = await duo(s);
    sturdy(ib.room);
    // B stands in the gate circle; A wakes the Wickhound; when the gate shuts B is moved to the room side
    place(ib.room, wickGate.x, wickGate.z);
    const displaced = collect(ib.room, 'displaced');
    place(ia.room, den.x - 3, den.z + 3);
    await waitFor(() => ia.room.state.sealed === 'wickhound', 4000);
    const moved = await waitFor(() => displaced.find((d) => d.kind === 'resync' && near(d.to, by(wickGate, wickGate.r + 0.5), 0.05)));
    expect(Math.hypot(moved.to.x - wickGate.x, moved.to.z - wickGate.z)).toBeGreaterThan(wickGate.r);
    place(ib.room, den.x + 2, den.z - 2); // B fights on beside the Wickhound
    // A dies and releases at the rim (B fights on); placed back at the gate, it cannot get in
    const w = worldOf(serverRoom(ia.room).combat);
    killAdventurer(w, w.adventurers.get(me(ia.room).eid)!, w.now);
    await waitFor(() => me(ia.room).dead);
    await sleep(600);
    const respawned = collect(ia.room, 'respawned');
    ia.room.send('release', {});
    await waitFor(() => respawned.length === 1);
    expect(near(respawned[0], L.rooms[0], 0.01)).toBe(true);
    const ack = place(ia.room, by(wickGate, -4.5).x, by(wickGate, -4.5).z);
    const notices = collect(ia.room, 'notice');
    await walk(ia.room, by(wickGate, -4.5), den, lampfall, ack);
    await waitFor(() => notices.some((n) => n.text === REASON_ARENA_SEALED));
    expect(ia.room.state.sealed).toBe('wickhound');
    expect(Math.hypot(me(ia.room).x - den.x, me(ia.room).z - den.z)).toBeGreaterThan(den.r);
  }, 30000);

  it("the Warden's phases, fields, shards, warded and enrage show in state; fields are in every client's state; telegraph rings carry inner", async () => {
    const s = await start('landing');
    const { ia, ib } = await duo(s);
    sturdy(ia.room);
    sturdy(ib.room);
    // the test start: packs and the Wickhound gone, the landing the checkpoint, the way on open
    expect(near(me(ia.room), landing, 0.05)).toBe(true);
    expect(ia.room.state.gates).toBe(0);
    expect([...ia.room.state.enemies.values()].map((e: any) => e.kind)).toEqual(['fallen_warden']);
    // A walks into the pit: the Warden wakes; B stays at the landing
    place(ia.room, pit.x - 8, pit.z);
    await waitFor(() => ia.room.state.sealed === 'warden', 4000);
    expect(ia.room.state.gates).toBe(GATE_PIT);
    const warden = () => [...ia.room.state.enemies.values()].find((e: any) => e.kind === 'fallen_warden') as any;
    expect(warden().tier).toBe('mega');
    expect(warden().phase ?? 0).toBe(0); // (unset reads as 0)
    expect(warden().warded ?? false).toBe(false);
    expect(warden().enrageAt).toBeGreaterThan(ia.room.state.clock);
    const enrageS = BOSSES.fallen_warden.enrage!.s;
    expect(Math.abs((warden().enrageAt - ia.room.state.clock) / 15 - enrageS)).toBeLessThan(2);
    // a burst to the first phase's floor: the transition, then phase 2 with its fire ring and two shards
    const w = worldOf(serverRoom(ia.room).combat), boss = bossOf(ia.room, 'fallen_warden');
    damageEnemy(w, me(ia.room).eid, boss, 1e6, 'auto' as never, w.now);
    await waitFor(() => warden().phase === 1, 3000);
    const phase2 = BOSSES.fallen_warden.phases[1];
    await waitFor(() => ia.room.state.fields.size > 0, 4000 + BOSSES.fallen_warden.transitionS * 1000);
    const field = [...ia.room.state.fields.values()][0] as any;
    expect(field).toMatchObject({ field: phase2.onEnter!.fields![0].id, shape: 'ring', raw: phase2.onEnter!.fields![0].raw });
    expect(field.inner).toBeGreaterThan(0);
    expect(field.inner).toBeLessThan(field.r);
    // in B's state too (fields are not filtered), though B is 45 m away at the landing
    await waitFor(() => ib.room.state.fields.size === ia.room.state.fields.size);
    await waitFor(() => [...ia.room.state.enemies.values()].filter((e: any) => e.kind === 'lens_shard').length === phase2.onEnter!.adds!.length);
    await waitFor(() => warden().warded === true);
    // every ring telegraph in the state carries its inner radius
    const rings = () => [...ia.room.state.telegraphs.values()].filter((t: any) => t.shape === 'ring');
    for (const t of rings()) expect((t as any).inner).toBeGreaterThan(0);
    // a shard killed: credited with 0 xp, and gone from the state (despawned after its kill)
    const shard = [...w.enemies.values()].find((e) => e.kind === 'lens_shard')!;
    const xp = collect(ia.room, 'jobXp');
    killEnemy(w, shard, w.now);
    await waitFor(() => xp.length > 0);
    expect(xp[0].gained).toBe(KILL_XP.lens_shard);
    expect(KILL_XP.lens_shard).toBe(0);
    await waitFor(() => !ia.room.state.enemies.has(String(shard.id)));
    expect(ENEMY_KINDS.lens_shard.tier).toBe('ordinary');
  }, 30000);

  it('a Warden kill: xp, one Seal (none the second time the same UTC day), a boss_kills row, a victory with rank; a solo kill gets Lampbreaker', async () => {
    const s = await start('landing');
    const a = await accountFor(s.store, 'Alice');
    const runOnce = async () => {
      const ia = await intoLampfall(s.url, s.store, a);
      sturdy(ia.room);
      place(ia.room, pit.x - 8, pit.z);
      await waitFor(() => ia.room.state.sealed === 'warden', 4000);
      const victories = collect(ia.room, 'victory'), xp = collect(ia.room, 'jobXp');
      const w = worldOf(serverRoom(ia.room).combat);
      killEnemy(w, bossOf(ia.room, 'fallen_warden'), w.now);
      const v = await waitFor(() => victories[0], 3000);
      expect(xp.some((x) => x.gained === KILL_XP.fallen_warden)).toBe(true);
      return { ia, v };
    };
    const first = await runOnce();
    expect(first.v).toMatchObject({ boss: 'fallen_warden', partySize: 1, xp: KILL_XP.fallen_warden, seal: true, seals: 1, title: 'Lampbreaker', rank: 1 });
    expect(first.v.seconds).toBeGreaterThan(0);
    expect(first.v.lore).toBe(BOSSES.fallen_warden.lore.victory);
    expect(await s.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ seals: 1, titles: ['Lampbreaker'] });
    // the lamp-lift is open now: it travels to the mouth; the cleared instance closes at once
    await waitFor(() => first.ia.room.state.lift === true);
    const travels = collect(first.ia.room, 'travel');
    const ack = place(first.ia.room, pit.x - 3, pit.z);
    await walk(first.ia.room, { x: pit.x - 3, z: pit.z }, L.lampLift, lampfall, ack);
    await waitFor(() => travels.length === 1);
    expect(travels[0]).toEqual({ zone: 'greenway' });
    await waitFor(() => s.app.instances.count === 0, 2000);
    // a second run the same UTC day: no second Seal, a second leaderboard row
    const second = await runOnce();
    expect(second.v).toMatchObject({ seal: false, seals: 1, title: 'Lampbreaker' });
    expect(await s.store.getOrCreateAdventurer(a.accountId)).toMatchObject({ seals: 1, titles: ['Lampbreaker'] });
    expect(await s.store.bossLeaderboard('fallen_warden', 1)).toHaveLength(2);
    expect(ENCOUNTERS.warden.spawns[0].kind).toBe('fallen_warden');
  }, 40000);

  it('the lamp-lift is shut until the Warden falls', async () => {
    const s = await start('landing');
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    const bossRoom = serverRoom(ia.room);
    const w = worldOf(bossRoom.combat);
    bossOf(ia.room, 'fallen_warden').data = { ...bossOf(ia.room, 'fallen_warden').data, aggro: 0 } as never;
    const ack = place(ia.room, pit.x - 3, pit.z);
    const travels = collect(ia.room, 'travel');
    await walk(ia.room, { x: pit.x - 3, z: pit.z }, L.lampLift, lampfall, ack);
    await sleep(500);
    expect(travels).toEqual([]);
    expect(ia.room.state.lift).toBe(false);
    expect(w.enemies.size).toBe(1);
  }, 20000);

  it('review: a boss kill credits only those inside its arena: a party member at the landing gets no xp, Seal or victory; a duo kill gives no title', async () => {
    const s = await start('landing');
    const { ia, ib } = await duo(s);
    sturdy(ia.room);
    sturdy(ib.room); // B stays at the landing (about 45 m from the Warden)
    place(ia.room, pit.x - 8, pit.z);
    await waitFor(() => ia.room.state.sealed === 'warden', 4000);
    const va = collect(ia.room, 'victory'), vb = collect(ib.room, 'victory'), xb = collect(ib.room, 'jobXp'), cb = collect(ib.room, 'credit');
    const w = worldOf(serverRoom(ia.room).combat);
    killEnemy(w, bossOf(ia.room, 'fallen_warden'), w.now);
    const v = await waitFor(() => va[0], 3000);
    await sleep(500);
    expect(vb).toEqual([]);
    expect(xb).toEqual([]);
    expect(cb).toEqual([]);
    expect(v.title).toBe(null); // two adventurers in the instance during the fight: no solo title
    expect(await s.store.getOrCreateAdventurer((await s.store.findAccountByUsername('Bob'))!.id)).toMatchObject({ seals: 0 });
  }, 30000);

  it('review: a duo kill inside gives both a Seal and no title; a partner who joined and left gives no title either', async () => {
    const s = await start('landing');
    const { ia, ib } = await duo(s);
    sturdy(ia.room);
    sturdy(ib.room);
    place(ib.room, pit.x - 6, pit.z + 3);
    place(ia.room, pit.x - 8, pit.z);
    await waitFor(() => ia.room.state.sealed === 'warden', 4000);
    const va = collect(ia.room, 'victory'), vb = collect(ib.room, 'victory');
    const w = worldOf(serverRoom(ia.room).combat);
    killEnemy(w, bossOf(ia.room, 'fallen_warden'), w.now);
    const [a1, b1] = [await waitFor(() => va[0], 3000), await waitFor(() => vb[0], 3000)];
    expect([a1.title, b1.title, a1.seal, b1.seal, a1.partySize]).toEqual([null, null, true, true, 2]);
    // a solo run where the partner walked in and out before the kill: no title
    const c = await accountFor(s.store, 'Carol'), d = await accountFor(s.store, 'Dave');
    for (const x of [c, d]) await saveAs(s.store, x.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
    const gc = await joinZone(s.url, c.token, 'greenway'), gd = await joinZone(s.url, d.token, 'greenway');
    await partyUp(gc.room, gd.room, 'Dave');
    await gc.room.leave();
    await gd.room.leave();
    const ic = await intoLampfall(s.url, s.store, c, { saved: false });
    sturdy(ic.room);
    place(ic.room, pit.x - 8, pit.z);
    await waitFor(() => ic.room.state.sealed === 'warden', 4000);
    const id = await intoLampfall(s.url, s.store, d, { saved: false });
    await waitFor(() => ic.room.state.players.size === 2);
    id.room.send('leaveInstance', {});
    await waitFor(() => ic.room.state.players.size === 1, 3000);
    const vc = collect(ic.room, 'victory');
    const w2 = worldOf(serverRoom(ic.room).combat);
    killEnemy(w2, bossOf(ic.room, 'fallen_warden'), w2.now);
    expect((await waitFor(() => vc[0], 3000)).title).toBe(null);
  }, 40000);

  it('review: a Seal whose first save answer was lost (it went through) is reported as won', async () => {
    const s = await start('landing');
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    sturdy(ia.room);
    place(ia.room, pit.x - 8, pit.z);
    await waitFor(() => ia.room.state.sealed === 'warden', 4000);
    const real = s.store.awardSeal.bind(s.store);
    vi.spyOn(s.store, 'awardSeal').mockImplementationOnce(async (...args) => {
      await real(...args);
      throw new Error('connection lost after the write');
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const va = collect(ia.room, 'victory');
    const w = worldOf(serverRoom(ia.room).combat);
    killEnemy(w, bossOf(ia.room, 'fallen_warden'), w.now);
    expect(await waitFor(() => va[0], 4000)).toMatchObject({ seal: true, seals: 1 });
    err.mockRestore();
  }, 30000);

  it('review: an honest dodge toward a shut gate rolls up to the wall: no refusal, no correction', async () => {
    const s = await start();
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    sturdy(ia.room);
    const at = by(wickExit, wickExit.r + 1.2);
    place(ia.room, den.x - 3, den.z + 3); // wake it
    await waitFor(() => ia.room.state.sealed === 'wickhound', 4000);
    const ack = place(ia.room, at.x, at.z);
    await sleep(200);
    const refused = collect(ia.room, 'refused'), corrections = collect(ia.room, 'correct'), displaced = collect(ia.room, 'displaced');
    ia.room.send('dodge', { ...at, y: lampfall(at.x, at.z)!, facing: 0, moving: false, ack, dx: -wickExit.ux, dz: -wickExit.uz });
    const d = await waitFor(() => displaced.find((m) => m.kind === 'dodge'), 3000);
    expect(Math.hypot(d.to.x - wickExit.x, d.to.z - wickExit.z)).toBeGreaterThanOrEqual(wickExit.r - 1e-6);
    expect(Math.hypot(d.to.x - at.x, d.to.z - at.z)).toBeLessThan(1.3);
    expect(refused.filter((r) => r.action === 'dodge')).toEqual([]);
    expect(corrections).toEqual([]);
  }, 20000);

  it('review: someone in the exit gate circle when the seal comes is put on the room side; a knock toward a shut gate stops at it', async () => {
    const s = await start();
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    sturdy(ia.room);
    place(ia.room, den.x - 3, den.z + 3); // wake it, then step (test-only) into the exit gate's wall before the seal
    const hound = bossOf(ia.room, 'wickhound');
    await waitFor(() => hound.targetId !== null, 3000);
    place(ia.room, wickExit.x, wickExit.z);
    const displaced = collect(ia.room, 'displaced');
    await waitFor(() => ia.room.state.sealed === 'wickhound', 4000);
    await waitFor(() => displaced.some((d) => d.kind === 'resync' && near(d.to, by(wickExit, wickExit.r + 0.5), 0.05)));
    // a knock from the room's side toward the gate: it ends against the wall, not across it
    const w = worldOf(serverRoom(ia.room).combat), me0 = w.adventurers.get(me(ia.room).eid)!;
    const { knockAdventurer } = await import('../../../shared/src/combat/adventurer');
    knockAdventurer(w, me0, { vx: -wickExit.ux * 12, vz: -wickExit.uz * 12, vy: 5, seconds: 0.4 }, w.now);
    const k = await waitFor(() => displaced.find((d) => d.kind === 'knock'), 3000);
    expect(Math.hypot(k.to.x - wickExit.x, k.to.z - wickExit.z)).toBeGreaterThanOrEqual(wickExit.r - 1e-6);
    expect(Math.sign((k.to.x - wickExit.x) * wickExit.ux + (k.to.z - wickExit.z) * wickExit.uz)).toBe(1);
  }, 20000);

  it('review: a boss wipe unseals the gate and resets the boss to phase 0', async () => {
    const s = await start();
    const a = await accountFor(s.store, 'Alice');
    const ia = await intoLampfall(s.url, s.store, a);
    sturdy(ia.room);
    place(ia.room, den.x - 3, den.z + 3);
    await waitFor(() => ia.room.state.sealed === 'wickhound', 4000);
    const w = worldOf(serverRoom(ia.room).combat), hound = bossOf(ia.room, 'wickhound');
    damageEnemy(w, me(ia.room).eid, hound, 1e6, 'auto' as never, w.now);
    const hs = () => [...ia.room.state.enemies.values()].find((e: any) => e.kind === 'wickhound') as any;
    await waitFor(() => hs().phase === 1, 3000);
    const respawned = collect(ia.room, 'respawned');
    killAdventurer(w, w.adventurers.get(me(ia.room).eid)!, w.now);
    await waitFor(() => respawned.length === 1, 4000);
    await waitFor(() => ia.room.state.sealed === '' && (ia.room.state.gates & GATE_WICK) === 0);
    await waitFor(() => (hs().phase ?? 0) === 0, 3000);
    expect(ia.room.state.gates).toBe(GATE_WICK_EXIT);
  }, 20000);
});
