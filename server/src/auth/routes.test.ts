import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
import { BAD_WORDS } from '@sg2/shared';
import { authRouter } from './routes';
import { signToken, verifyToken } from './tokens';

const SECRET = 'test-secret';
const servers: Server[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

// A fresh app per test, so each test starts with an empty store and rate limiter.
async function startApp(opts?: { ratePerMinute?: number }): Promise<{ url: string; store: Store }> {
  const store = createMemoryStore();
  const app = express();
  app.use('/api', authRouter(store, SECRET, opts));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  servers.push(server);
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store };
}

async function post(url: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(url + path, {
    method: 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('tokens', () => {
  it('round-trips an account id', () => {
    expect(verifyToken(signToken('acc-1', SECRET), SECRET)).toEqual({ accountId: 'acc-1' });
  });

  it('rejects a token signed with another secret or tampered with', () => {
    const token = signToken('acc-1', SECRET);
    expect(verifyToken(token, 'other-secret')).toBeNull();
    const [header, payload, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'acc-2', exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${header}.${forged}.${signature}`, SECRET)).toBeNull();
    expect(verifyToken(`${header}.${payload}.${signature!.slice(0, -2)}xx`, SECRET)).toBeNull();
    expect(verifyToken('not a token', SECRET)).toBeNull();
  });

  it('expires after 7 days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    const token = signToken('acc-1', SECRET);
    vi.setSystemTime(new Date('2026-11-18T11:59:00Z'));
    expect(verifyToken(token, SECRET)).toEqual({ accountId: 'acc-1' });
    vi.setSystemTime(new Date('2026-11-18T12:01:00Z'));
    expect(verifyToken(token, SECRET)).toBeNull();
  });
});

describe('POST /api/register', () => {
  it('creates an account and returns a token for it, with an adventurer still to be named', async () => {
    const { url, store } = await startApp();
    const res = await post(url, '/api/register', { username: 'Rowan', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String), name: null });
    const account = await store.findAccountByUsername('rowan');
    expect(account).not.toBeNull();
    expect(account!.passwordHash).toMatch(/^\$argon2/);
    expect(account!.isGuest).toBe(false);
    expect(verifyToken(res.body.token, SECRET)).toEqual({ accountId: account!.id });
  });

  it('rejects an invalid name or password with the validator message', async () => {
    const { url } = await startApp();
    expect(await post(url, '/api/register', { username: 'El', password: 'longenough' })).toEqual({
      status: 400,
      body: { error: 'Names are 3 to 16 letters, numbers or underscores.' },
    });
    expect(await post(url, '/api/register', { username: 'Rowan', password: 'short' })).toEqual({
      status: 400,
      body: { error: 'Passwords need at least 8 characters.' },
    });
    expect(await post(url, '/api/register', {})).toEqual({ status: 400, body: { error: 'Name is required.' } });
  });

  it('refuses offensive and reserved usernames', async () => {
    const { url, store } = await startApp();
    const word = BAD_WORDS.find((w) => w.length >= 4 && w.length <= 16)!;
    for (const username of [word, 'Admin', 'Guest_12']) {
      const res = await post(url, '/api/register', { username, password: 'longenough' });
      expect(res).toEqual({ status: 400, body: { error: 'That name is not allowed' } });
      expect(await store.findAccountByUsername(username)).toBeNull();
    }
  });

  it('rejects a taken name, ignoring case', async () => {
    const { url } = await startApp();
    expect((await post(url, '/api/register', { username: 'Rowan', password: 'longenough' })).status).toBe(200);
    expect(await post(url, '/api/register', { username: 'ROWAN', password: 'longenough' })).toEqual({
      status: 409,
      body: { error: 'That name is taken' },
    });
  });

  it('gives one 200 and one 409 for two simultaneous registers of the same name', async () => {
    const { url } = await startApp();
    const results = await Promise.all([
      post(url, '/api/register', { username: 'Rowan', password: 'longenough' }),
      post(url, '/api/register', { username: 'rowan', password: 'longenough' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('POST /api/login', () => {
  it('returns a token for the right password', async () => {
    const { url, store } = await startApp();
    await post(url, '/api/register', { username: 'Rowan', password: 'longenough' });
    const res = await post(url, '/api/login', { username: 'rOWan', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String), name: null });
    const account = await store.findAccountByUsername('Rowan');
    expect(verifyToken(res.body.token, SECRET)).toEqual({ accountId: account!.id });
  });

  it('gives the same 401 for a wrong password and an unknown name', async () => {
    const { url } = await startApp();
    await post(url, '/api/register', { username: 'Rowan', password: 'longenough' });
    const expected = { status: 401, body: { error: 'Wrong name or password' } };
    expect(await post(url, '/api/login', { username: 'Rowan', password: 'wrongpassword' })).toEqual(expected);
    expect(await post(url, '/api/login', { username: 'Nobody', password: 'longenough' })).toEqual(expected);
    expect(await post(url, '/api/login', {})).toEqual(expected);
  });

  it('refuses guest accounts', async () => {
    const { url } = await startApp();
    const guest = await post(url, '/api/guest');
    expect(await post(url, '/api/login', { username: guest.body.name, password: '' })).toEqual({
      status: 401,
      body: { error: 'Wrong name or password' },
    });
  });
});

describe('POST /api/guest', () => {
  it('creates a passwordless guest named Guest- and 6 digits, with an adventurer of the same name', async () => {
    const { url, store } = await startApp();
    const res = await post(url, '/api/guest');
    expect(res.status).toBe(200);
    expect(res.body.name).toMatch(/^Guest-\d{6}$/);
    const account = await store.findAccountByUsername(res.body.name);
    expect(account).toMatchObject({ isGuest: true, passwordHash: null });
    expect(verifyToken(res.body.token, SECRET)).toEqual({ accountId: account!.id });
    expect((await store.getOrCreateAdventurer(account!.id)).name).toBe(res.body.name);
  });

  it('picks another number when the name is taken', async () => {
    const { url, store } = await startApp();
    const random = vi.spyOn(Math, 'random');
    // The first pick is Guest-123456 (taken), the second Guest-567891.
    random.mockReturnValueOnce(0.123456).mockReturnValueOnce(0.567891);
    await store.createAccount({ username: 'Guest-123456', passwordHash: null, isGuest: true });
    try {
      const first = await post(url, '/api/guest');
      expect(first.body.name).toBe('Guest-567891');
    } finally {
      random.mockRestore();
    }
  });
});

describe('POST /api/name', () => {
  async function nameAs(url: string, token: string | undefined, body: unknown) {
    const res = await fetch(url + '/api/name', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  }

  it('names the adventurer once; login then returns the name', async () => {
    const { url, store } = await startApp();
    const { token } = (await post(url, '/api/register', { username: 'Rowan', password: 'longenough' })).body;
    expect(await nameAs(url, token, { name: "Mary-Ann O'Neil" })).toEqual({ status: 200, body: { name: "Mary-Ann O'Neil" } });
    const account = await store.findAccountByUsername('Rowan');
    expect((await store.getOrCreateAdventurer(account!.id)).name).toBe("Mary-Ann O'Neil");
    expect((await post(url, '/api/login', { username: 'Rowan', password: 'longenough' })).body.name).toBe("Mary-Ann O'Neil");
    expect(await nameAs(url, token, { name: 'Elowen' })).toEqual({
      status: 409,
      body: { error: 'Your adventurer already has a name' },
    });
  });

  it('answers a bad name with the validator message', async () => {
    const { url } = await startApp();
    const { token } = (await post(url, '/api/register', { username: 'Rowan', password: 'longenough' })).body;
    expect(await nameAs(url, token, { name: 'Al' })).toEqual({ status: 400, body: { error: 'Names are 3 to 16 letters' } });
    expect(await nameAs(url, token, { name: 'Felix' })).toEqual({ status: 400, body: { error: 'That name is not allowed' } });
    const word = BAD_WORDS.find((w) => w.length >= 4 && w.length <= 16)!;
    expect(await nameAs(url, token, { name: word })).toEqual({ status: 400, body: { error: 'That name is not allowed' } });
    expect((await nameAs(url, token, {})).status).toBe(400);
  });

  it('answers a name another adventurer has, ignoring case, with 409', async () => {
    const { url } = await startApp();
    const a = (await post(url, '/api/register', { username: 'Rowan', password: 'longenough' })).body.token;
    const b = (await post(url, '/api/register', { username: 'Hazel', password: 'longenough' })).body.token;
    expect((await nameAs(url, a, { name: 'Elowen' })).status).toBe(200);
    expect(await nameAs(url, b, { name: 'ELOWEN' })).toEqual({ status: 409, body: { error: 'That name is taken' } });
  });

  it('refuses a guest, whose adventurer is already named', async () => {
    const { url } = await startApp();
    const guest = (await post(url, '/api/guest')).body;
    expect(await nameAs(url, guest.token, { name: 'Elowen' })).toEqual({
      status: 409,
      body: { error: 'Your adventurer already has a name' },
    });
  });

  it('answers a missing, bad or unknown-account token with 401', async () => {
    const { url } = await startApp();
    for (const token of [undefined, 'not-a-token', signToken('acc-1', 'other-secret'), signToken('no-such-account', SECRET)]) {
      const res = await nameAs(url, token, { name: 'Elowen' });
      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe('string');
    }
  });
});

describe('GET /api/zone', () => {
  async function zoneAs(url: string, authorization?: string) {
    const res = await fetch(url + '/api/zone', { headers: authorization === undefined ? {} : { authorization } });
    return { status: res.status, body: (await res.json()) as any };
  }

  it("answers the zone the account's adventurer is saved in", async () => {
    const { url, store } = await startApp();
    const { token } = (await post(url, '/api/guest')).body;
    expect(await zoneAs(url, `Bearer ${token}`)).toEqual({ status: 200, body: { zone: 'grove' } });
    const account = (await store.findAccountById(verifyToken(token, SECRET)!.accountId))!;
    const a = await store.getOrCreateAdventurer(account.id);
    await store.saveAdventurer({ id: a.id, x: 8, z: 3, facing: 0, zone: 'greenway', hp: a.hp, loadout: a.loadout });
    expect(await zoneAs(url, `Bearer ${token}`)).toEqual({ status: 200, body: { zone: 'greenway' } });
  });

  it('answers a missing, bad or unknown-account token with 401', async () => {
    const { url } = await startApp();
    for (const auth of [undefined, 'Bearer not-a-token', `Bearer ${signToken('acc-1', 'other-secret')}`, `Bearer ${signToken('no-such-account', SECRET)}`, 'Basic abc']) {
      const res = await zoneAs(url, auth);
      expect(res.status).toBe(401);
      expect(typeof res.body.error).toBe('string');
    }
  });

  it('does not count toward the login limit', async () => {
    const { url } = await startApp({ ratePerMinute: 2 });
    const { token } = (await post(url, '/api/guest')).body;
    for (let i = 0; i < 20; i++) expect((await zoneAs(url, `Bearer ${token}`)).status).toBe(200);
    for (let i = 0; i < 20; i++) expect((await zoneAs(url)).status).toBe(401);
    expect((await post(url, '/api/guest')).status).toBe(200); // the second of two
    expect((await post(url, '/api/guest')).status).toBe(429);
  });

  it('has its own, more generous limit of 60 a minute from one address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    const { url } = await startApp();
    const { token } = (await post(url, '/api/guest')).body;
    for (let i = 0; i < 60; i++) expect((await zoneAs(url, `Bearer ${token}`)).status).toBe(200);
    expect(await zoneAs(url, `Bearer ${token}`)).toEqual({ status: 429, body: { error: 'Too many requests, wait a minute' } });
    expect((await post(url, '/api/guest')).status).toBe(200); // the login limit is its own
    vi.setSystemTime(new Date('2026-11-11T12:01:01Z'));
    expect((await zoneAs(url, `Bearer ${token}`)).status).toBe(200);
  });
});

describe('limits', () => {
  it('answers the 11th request in a minute from one address with 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    const { url } = await startApp();
    const paths = ['/api/register', '/api/login', '/api/guest', '/api/name'];
    for (let i = 0; i < 10; i++) {
      const res = await post(url, paths[i % 4]!, { username: 'Nobody', password: 'x' });
      expect(res.status).not.toBe(429);
    }
    expect(await post(url, '/api/guest')).toEqual({ status: 429, body: { error: 'Too many attempts, wait a minute' } });

    vi.setSystemTime(new Date('2026-11-11T12:01:01Z'));
    expect((await post(url, '/api/guest')).status).toBe(200);
  });

  it('lets the limit be raised', async () => {
    const { url } = await startApp({ ratePerMinute: 100 });
    for (let i = 0; i < 20; i++) expect((await post(url, '/api/guest')).status).toBe(200);
  });

  it('answers malformed JSON with 400', async () => {
    const { url } = await startApp();
    expect(await post(url, '/api/login', '{not json')).toEqual({ status: 400, body: { error: 'Bad request' } });
  });

  it('rejects bodies over 2 KB with 413', async () => {
    const { url } = await startApp();
    const res = await post(url, '/api/register', { username: 'Rowan', password: 'x'.repeat(2100) });
    expect(res.status).toBe(413);
    // Also when the body is not declared as JSON.
    const plain = await fetch(url + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'x'.repeat(2100),
    });
    expect(plain.status).toBe(413);
  });
});
