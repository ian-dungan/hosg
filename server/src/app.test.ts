// SG2_TRUST_PROXY: whose address the login limit counts.
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type TestServer } from './rooms/testHelpers';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

/** POST /api/guest as the client `forwardedFor` claims to be; the status. */
async function guestAs(url: string, forwardedFor: string): Promise<number> {
  const res = await fetch(`${url}/api/guest`, { method: 'POST', headers: { 'x-forwarded-for': forwardedFor } });
  await res.body?.cancel();
  return res.status;
}

describe('trust proxy', () => {
  it('ignores X-Forwarded-For by default: every request counts against the connection\'s address', async () => {
    server = await startServer({ authRatePerMinute: 2 });
    expect(await guestAs(server.url, '203.0.113.1')).toBe(200);
    expect(await guestAs(server.url, '203.0.113.2')).toBe(200);
    expect(await guestAs(server.url, '203.0.113.3')).toBe(429); // a forged address does not dodge the limit
  });

  it('with one trusted proxy, gives each forwarded client its own limit', async () => {
    server = await startServer({ authRatePerMinute: 2, trustProxy: 1 });
    for (const client of ['203.0.113.1', '203.0.113.2', '203.0.113.3']) {
      expect(await guestAs(server.url, client)).toBe(200);
      expect(await guestAs(server.url, client)).toBe(200);
      expect(await guestAs(server.url, client)).toBe(429);
    }
    // Only the hop the proxy added counts: an address the player put in front is not believed.
    expect(await guestAs(server.url, '198.51.100.9, 203.0.113.1')).toBe(429);
  });
});
