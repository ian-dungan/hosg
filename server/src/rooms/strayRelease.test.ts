// A Charged Shot `release` the server has no charge for is ignored: the client always sends the release on
// key-up (its view of whether the charge is still held can lag a round trip), so a release after the shot was
// already loosed, or one with no press at all, must change nothing: no second shot, no new charge.
import { afterEach, describe, expect, it } from 'vitest';
import type { Room } from '@colyseus/sdk';
import { SPAWN, newJobsSave, type CampSpawn, type Surface } from '@sg2/shared';
import { accountFor, collect, joinZone, saveAs, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => { await server?.app.close(); server = undefined; });

const flat: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
const DUMMY: CampSpawn = { kind: 'dummy', x: 3, z: -11, facing: 0 };
const me = (room: Room<any, any>) => room.state.players.get(room.sessionId);

describe('a stray Charged Shot release', () => {
  it('after the shot was loosed, or with no press, is ignored: no second shot, no charge, no refusal at all', async () => {
    server = await startServer({ combatSeed: 7, zones: { grove: { surface: flat, ground: flat, sight: () => true, camps: [DUMMY] } } });
    const { url, store } = server;
    const account = await accountFor(store, 'Alice');
    await saveAs(store, account.accountId, { x: SPAWN.x, z: SPAWN.z, facing: 0, zone: 'grove', jobs: newJobsSave('ranger') });
    const { room } = await joinZone(url, account.token, 'grove');
    const fx = collect(room, 'fx'), refused = collect(room, 'refused'), selves = collect(room, 'self');
    const dummy = await waitFor(() => [...room.state.enemies.values()].find((e: any) => e.kind === 'dummy'));
    room.send('target', { id: dummy.eid });
    await waitFor(() => me(room).target === dummy.eid);
    const shots = () => fx.flatMap((m) => m.events).filter((e: any) => e.t === 'use' && e.ability === 'charged_shot').length;

    room.send('ability', { slot: 2, phase: 'release' }); // no press at all
    room.send('ability', { slot: 2, phase: 'press' });
    await sleep(400);
    room.send('ability', { slot: 2, phase: 'release' });
    await waitFor(() => shots() === 1);
    await waitFor(() => selves.at(-1)?.charge === null);
    room.send('ability', { slot: 2, phase: 'release' }); // the shot is already loosed
    room.send('ability', { slot: 2, phase: 'release' });
    await sleep(500);
    expect(shots()).toBe(1);
    expect(selves.at(-1)?.charge).toBeNull();
    expect(me(room).act).not.toBe('charge');
    expect(refused).toEqual([]); // dropped silently: the client sends a release on every key-up
  });
});
