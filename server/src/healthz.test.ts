// Final review M2: on a public server, /healthz tells the internet only {ok, players, tickHz}; the full
// detail goes to loopback callers (the Docker healthcheck, the load scripts on the same machine).
import { describe, expect, it } from 'vitest';
import { isLoopbackRequest } from './app';
import { startServer } from './rooms/testHelpers';

describe('/healthz detail (final review M2)', () => {
  it('loopback means a loopback socket with no forwarded-for header (Caddy on loopback forwards the internet)', () => {
    expect(isLoopbackRequest('127.0.0.1', undefined)).toBe(true);
    expect(isLoopbackRequest('::1', undefined)).toBe(true);
    expect(isLoopbackRequest('::ffff:127.0.0.1', undefined)).toBe(true);
    expect(isLoopbackRequest('127.0.0.1', '203.0.113.7')).toBe(false);
    expect(isLoopbackRequest('172.17.0.1', undefined)).toBe(false);
    expect(isLoopbackRequest('203.0.113.7', undefined)).toBe(false);
    expect(isLoopbackRequest(undefined, undefined)).toBe(false);
  });

  it("with healthDetail 'loopback' (production), a forwarded caller sees only ok, players and tickHz; a loopback one everything", async () => {
    const { url, app } = await startServer({ healthDetail: 'loopback' });
    try {
      const outside = await (await fetch(`${url}/healthz`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).json() as any;
      expect(Object.keys(outside).sort()).toEqual(['ok', 'players', 'tickHz']);
      expect(outside.ok).toBe(true);
      const local = await (await fetch(`${url}/healthz`)).json() as any;
      expect(local).toHaveProperty('zones');
      expect(local).toHaveProperty('peakRssMb');
    } finally {
      await app.close();
    }
  }, 20_000);

  it('by default (development, tests, SG2_HEALTHZ_DETAIL=all) everyone gets the full detail', async () => {
    const { url, app } = await startServer();
    try {
      const outside = await (await fetch(`${url}/healthz`, { headers: { 'x-forwarded-for': '203.0.113.7' } })).json() as any;
      expect(outside).toHaveProperty('zones');
    } finally {
      await app.close();
    }
  }, 20_000);
});
