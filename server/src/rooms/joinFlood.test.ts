// Final review C1: one signed-in account must not be able to lock a zone by reserving seats over the
// matchmaking HTTP route (each reserved seat counts toward Colyseus's maxClients until it expires).
import { describe, expect, it } from 'vitest';
import { SEAT_RESERVATION_S } from '@sg2/shared';
import { accountFor, joinGrove, serverRoom, startServer } from './testHelpers';

/** POSTs a raw matchmake call, as a script would (no SDK, no socket opened afterwards). */
async function matchmake(url: string, token: string, headers: Record<string, string> = {}): Promise<number> {
  const res = await fetch(`${url}/matchmake/joinOrCreate/grove`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ token }),
  });
  await res.text();
  return res.status;
}

describe('matchmaking floods (final review C1)', () => {
  it('50 matchmake calls with one token reserve at most one seat; another account still joins', async () => {
    const { url, store, app } = await startServer({ maxPlayers: 2 });
    try {
      const a = await accountFor(store, 'Flooder');
      const b = await accountFor(store, 'Bystander');
      const statuses = await Promise.all(Array.from({ length: 50 }, () => matchmake(url, a.token)));
      expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(1);
      // a second wave while the first reservation is still pending: refused too
      const again = await Promise.all(Array.from({ length: 10 }, () => matchmake(url, a.token)));
      expect(again.filter((s) => s === 200).length).toBe(0);
      const { room } = await joinGrove(url, b.token);
      const grove = serverRoom(room);
      expect(Object.keys((grove as any)._reservedSeats).length).toBeLessThanOrEqual(2);
      await room.leave();
    } finally {
      await app.close();
    }
  }, 20_000);

  it('a zone room holds a reserved seat for SEAT_RESERVATION_S (5 s), and the account may try again after it', async () => {
    expect(SEAT_RESERVATION_S).toBe(5);
    const { url, store, app } = await startServer();
    try {
      const a = await accountFor(store, 'Slowpoke');
      expect(await matchmake(url, a.token)).toBe(200);
      expect(await matchmake(url, a.token)).not.toBe(200);
      const { room } = await joinGrove(url, (await accountFor(store, 'Other')).token);
      expect(serverRoom(room).seatReservationTimeout).toBe(SEAT_RESERVATION_S);
      await room.leave();
    } finally {
      await app.close();
    }
  }, 20_000);

  it('a joined account can join again at once (a reload): its pending mark is cleared by the join', async () => {
    const { url, store, app } = await startServer();
    try {
      const a = await accountFor(store, 'Reloader');
      const first = await joinGrove(url, a.token);
      const second = await joinGrove(url, a.token);
      expect(second.room.sessionId).not.toBe(first.room.sessionId);
      await second.room.leave();
    } finally {
      await app.close();
    }
  }, 20_000);

  it('matchmake calls are limited per address (joinRatePerMinute); X-Forwarded-For is not believed without trustProxy', async () => {
    const { url, store, app } = await startServer({ joinRatePerMinute: 5 });
    try {
      const tokens = await Promise.all(Array.from({ length: 7 }, (_, i) => accountFor(store, `Joiner${i}`).then((a) => a.token)));
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push(await matchmake(url, tokens[i]!, { 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.0.1.${i}` }));
      expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
      expect(statuses.slice(5)).toEqual([429, 429]);
    } finally {
      await app.close();
    }
  }, 20_000);

  it('behind trusted proxies, the limit counts the address the proxy forwards', async () => {
    const { url, store, app } = await startServer({ joinRatePerMinute: 2, trustProxy: 1 });
    try {
      const tokens = await Promise.all(Array.from({ length: 4 }, (_, i) => accountFor(store, `Proxied${i}`).then((a) => a.token)));
      // the client's own spoofed first hop is ignored: the proxy appended the real address last
      expect(await matchmake(url, tokens[0]!, { 'x-forwarded-for': '1.1.1.1, 203.0.113.7' })).toBe(200);
      expect(await matchmake(url, tokens[1]!, { 'x-forwarded-for': '2.2.2.2, 203.0.113.7' })).toBe(200);
      expect(await matchmake(url, tokens[2]!, { 'x-forwarded-for': '3.3.3.3, 203.0.113.7' })).toBe(429);
      expect(await matchmake(url, tokens[3]!, { 'x-forwarded-for': '203.0.113.8' })).toBe(200);
    } finally {
      await app.close();
    }
  }, 20_000);
});
