// GET /api/leaderboard/:boss?size=n: the ten fastest kills of a boss at a party size, nothing private,
// anything malformed a 400, and at most 60 requests a minute per address.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { leaderboardRouter } from './leaderboard';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

async function startApp(perMinute?: number): Promise<{ url: string; store: Store }> {
  const store = createMemoryStore();
  const app = express();
  app.use('/api/leaderboard', leaderboardRouter(store, perMinute === undefined ? {} : { perMinute }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
}

const get = async (url: string) => {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as any };
};

describe('GET /api/leaderboard/:boss', () => {
  it('answers the ten fastest of that boss and size, fastest first, names, seconds and time only', async () => {
    const { url, store } = await startApp();
    const at = new Date('2026-11-12T10:00:00Z');
    for (let i = 0; i < 12; i++) await store.recordBossKill({ boss: 'fallen_warden', partySize: 2, seconds: 300 - i, names: [`A${i}`, `B${i}`], at });
    await store.recordBossKill({ boss: 'fallen_warden', partySize: 3, seconds: 1, names: ['X', 'Y', 'Z'], at });
    await store.recordBossKill({ boss: 'wickhound', partySize: 2, seconds: 2, names: ['W', 'V'], at });
    const r = await get(`${url}/api/leaderboard/fallen_warden?size=2`);
    expect(r.status).toBe(200);
    expect(r.body.entries.length).toBe(10);
    expect(r.body.entries[0]).toEqual({ names: ['A11', 'B11'], seconds: 289, at: '2026-11-12T10:00:00.000Z' });
    expect(r.body.entries.map((e: any) => e.seconds)).toEqual([289, 290, 291, 292, 293, 294, 295, 296, 297, 298]);
    expect(Object.keys(r.body)).toEqual(['entries']);
    expect((await get(`${url}/api/leaderboard/wickhound?size=2`)).body.entries).toEqual([{ names: ['W', 'V'], seconds: 2, at: '2026-11-12T10:00:00.000Z' }]);
    expect((await get(`${url}/api/leaderboard/wickhound?size=4`)).body).toEqual({ entries: [] });
  });

  it('anything else is a 400', async () => {
    const { url } = await startApp();
    for (const path of ['moon?size=2', 'fallen_warden', 'fallen_warden?size=0', 'fallen_warden?size=5', 'fallen_warden?size=1.5', 'fallen_warden?size=abc',
      'fallen_warden?size=2&size=3', 'lens_shard?size=1', '__proto__?size=1', 'fallen_warden?size=%00']) {
      const r = await get(`${url}/api/leaderboard/${path}`);
      expect(r.status, path).toBe(400);
      expect(r.body, path).toEqual({ error: expect.any(String) });
    }
  });

  it('at most 60 a minute per address (429 after)', async () => {
    const { url } = await startApp();
    const codes: number[] = [];
    for (let i = 0; i < 62; i++) codes.push((await get(`${url}/api/leaderboard/wickhound?size=1`)).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    expect(codes.slice(60)).toEqual([429, 429]);
  });
});
