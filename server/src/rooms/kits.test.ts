// The real path with kits on (the pre-Plan-5 room tests run with kits off): a fight's kill, a death's
// respawn save, a travel keeping a kit's extra dodge charge, and a boss kill inside an instance.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { GUILD_BOARD, kitFor, lampfallArena, lampfallLayout, totalTo, worldOf, zoneDef, type CampSpawn, type JobId, type Surface, type ZoneDef } from '@sg2/shared';
import { killAdventurer } from '../../../shared/src/combat/adventurer';
import { createMemoryStore } from '../store/memory';
import { accountFor, collect, collectFromJoin, intoLampfall, joinZone, killFor, place, saveAs, serverRoom, startServer, waitFor, walk, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const THORNLINGS: CampSpawn[] = [{ kind: 'thornling', x: 0, z: -40, facing: 0 }];
const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);

describe('kits on: the real path', () => {
  it('a kill in a fight gives xp, on the level-1 kit', async () => {
    server = await startServer({ kits: true, combatSeed: 3, store: createMemoryStore(), zones: { grove: { surface: flat, ground: flat, sight: () => true, camps: THORNLINGS } as Partial<ZoneDef> } });
    const acc = await accountFor(server.store, 'Kit');
    await saveAs(server.store, acc.accountId, { x: 0, z: -36 });
    const j = await joinZone(server.url, acc.token, 'grove');
    const w = worldOf(serverRoom(j.room).combat);
    expect(w.adventurers.get(me(j.room).eid)!.stats).toEqual(kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats);
    expect(me(j.room).maxHp).toBe(kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats.maxHp);
    const xp = collect(j.room, 'jobXp');
    const e = [...w.enemies.values()].find((x) => x.kind === 'thornling')!;
    killFor(j.room, e.id, [{ room: j.room }]);
    await waitFor(() => xp.length > 0);
    expect(xp[0].gained).toBeGreaterThan(0);
  });

  it("a death is saved as respawned at the statue with the kit's full health", async () => {
    server = await startServer({ kits: true, combatSeed: 3, store: createMemoryStore() });
    const acc = await accountFor(server.store, 'Kit');
    const j = await joinZone(server.url, acc.token, 'grove');
    const w = worldOf(serverRoom(j.room).combat);
    killAdventurer(w, w.adventurers.get(me(j.room).eid)!, w.now);
    const full = kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats.maxHp;
    await waitFor(async () => (await server!.store.getOrCreateAdventurer(acc.accountId)).hp === full, 3000);
    expect(await server.store.getOrCreateAdventurer(acc.accountId)).toMatchObject({ zone: 'grove', x: zoneDef('grove').spawn.x, z: zoneDef('grove').spawn.z, hp: full });
  });

  it("a travel keeps the kit's extra dodge charge", async () => {
    server = await startServer({ kits: true, combatSeed: 3, store: createMemoryStore(), openExits: { grove: ['greenway'] } });
    const jobs = { curve: 2 as const, current: 'ninja' as JobId, jobs: { ninja: { level: 10, xp: totalTo(10), picks: ['quickstep', 'ashcloud'] as never, talents: ['ninja_3c'], outfit: null } } };
    const acc = await accountFor(server.store, 'Nina');
    await saveAs(server.store, acc.accountId, { jobs, x: GUILD_BOARD.x + 1, z: GUILD_BOARD.z });
    const j = await joinZone(server.url, acc.token, 'grove');
    const exit = zoneDef('grove').exits[0]!;
    const near = { x: exit.x - exit.r - 1.5, z: exit.z };
    const travels = collect(j.room, 'travel');
    const ack = place(j.room, near.x, near.z);
    await walk(j.room, near, { x: exit.x, z: exit.z }, zoneDef('grove').surface, ack);
    await waitFor(() => travels.length > 0, 4000);
    const g = await joinZone(server.url, acc.token, 'greenway');
    const selves = collectFromJoin(g.room, 'self');
    await waitFor(() => selves.length > 0);
    expect(selves[0]).toMatchObject({ dodgeMax: 4, dodgeCharges: 4 });
  }, 15_000);

  it('a boss kill inside an instance credits and rewards the kitted adventurer', async () => {
    server = await startServer({ kits: true, combatSeed: 3, serverSeed: 9, store: createMemoryStore(), instances: { startAt: 'landing' } });
    const acc = await accountFor(server.store, 'Kit');
    const i = await intoLampfall(server.url, server.store, acc);
    const w = worldOf(serverRoom(i.room).combat);
    const boss = [...w.enemies.values()].find((e) => e.kind === 'fallen_warden' && e.alive)!;
    expect(boss).toBeTruthy();
    // (a boss credits only those inside its arena)
    const arena = lampfallArena('warden'), room = serverRoom(i.room) as any;
    const spot = lampfallLayout().rooms.find((r: any) => arena(r.x, r.z) && room.zone.surface(r.x, r.z) !== null)!;
    place(i.room, spot.x, spot.z);
    const loot = collect(i.room, 'loot');
    killFor(i.room, boss.id, [{ room: i.room }]);
    await waitFor(() => loot.length > 0, 4000);
    expect(loot[0].gold).toBeGreaterThan(0);
    expect(loot[0].items).toHaveLength(1); // the first Warden kill of the day always drops
    const seals = (await server.store.getOrCreateAdventurer(acc.accountId)).seals;
    expect(seals).toBe(1);
  }, 20_000);
});
