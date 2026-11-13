// Final review I2: an adventurer inside an instance with no pose change and no intent for INSTANCE_IDLE_S
// is sent out to the crater mouth with a notice (dead and idle counts as idle), never while engaged in a
// boss fight (inside an awake boss's arena). Short test-only timings through the app's options.
import { afterEach, describe, expect, it } from 'vitest';
import { INSTANCE_IDLE_S, REASON_INSTANCE_IDLE } from '@sg2/shared';
import { accountFor, collect, intoLampfall, serverRoom, sleep, startServer, waitFor, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const TIMINGS = { reconnectS: 2, evictS: 1, wipeS: 1, releaseMinS: 1, autoReleaseS: 3, sealS: 0.5, idleS: 1.5 };
async function start(): Promise<TestServer> {
  server = await startServer({ combatSeed: 3, reconnectSeconds: 2, instances: { emptyS: 1, sweepMs: 100, timings: TIMINGS } });
  return server;
}

describe('idle adventurers inside an instance (final review I2)', () => {
  it('INSTANCE_IDLE_S is 300', () => {
    expect(INSTANCE_IDLE_S).toBe(300);
  });

  it('one who stands still is sent to the crater mouth with the notice', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Sleepy');
    const ia = await intoLampfall(url, store, a);
    const notices = collect(ia.room, 'notice'), travels = collect(ia.room, 'travel');
    const t0 = Date.now();
    const travel = await waitFor(() => travels[0], 6000);
    expect(travel).toEqual({ zone: 'greenway' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1000);
    expect(notices.map((n) => n.text)).toContain(REASON_INSTANCE_IDLE);
  }, 20_000);

  it('one who keeps sending intents stays; it is sent out once it stops', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Busy');
    const ia = await intoLampfall(url, store, a);
    const travels = collect(ia.room, 'travel');
    for (let i = 0; i < 10; i++) {
      ia.room.send('target', { id: null });
      await sleep(300);
    }
    expect(travels).toEqual([]);
    await waitFor(() => travels[0], 6000);
  }, 20_000);

  it('one engaged in a boss fight (inside an awake boss arena) is never sent out', async () => {
    const { url, store } = await start();
    const a = await accountFor(store, 'Brave');
    const ia = await intoLampfall(url, store, a);
    const travels = collect(ia.room, 'travel');
    const inst = (serverRoom(ia.room) as any).inst;
    const boss = [...inst.bosses.values()][0];
    boss.wokeAt = 0; // awake
    inst.arenas[boss.encounter] = () => true; // and the adventurer stands in its arena
    await sleep(3000);
    expect(travels).toEqual([]);
  }, 20_000);
});
