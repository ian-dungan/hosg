import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createMemoryStore } from '../store/memory';
import type { Store } from '../store/types';
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
  it('creates an account and returns a token for it', async () => {
    const { url, store } = await startApp();
    const res = await post(url, '/api/register', { username: 'Ellie', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ellie');
    const account = await store.findAccountByUsername('ellie');
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
    expect(await post(url, '/api/register', { username: 'Ellie', password: 'short' })).toEqual({
      status: 400,
      body: { error: 'Passwords need at least 8 characters.' },
    });
    expect(await post(url, '/api/register', {})).toEqual({ status: 400, body: { error: 'Name is required.' } });
  });

  it('rejects a taken name, ignoring case', async () => {
    const { url } = await startApp();
    expect((await post(url, '/api/register', { username: 'Ellie', password: 'longenough' })).status).toBe(200);
    expect(await post(url, '/api/register', { username: 'ELLIE', password: 'longenough' })).toEqual({
      status: 409,
      body: { error: 'That name is taken' },
    });
  });

  it('gives one 200 and one 409 for two simultaneous registers of the same name', async () => {
    const { url } = await startApp();
    const results = await Promise.all([
      post(url, '/api/register', { username: 'Ellie', password: 'longenough' }),
      post(url, '/api/register', { username: 'ellie', password: 'longenough' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('POST /api/login', () => {
  it('returns a token for the right password', async () => {
    const { url, store } = await startApp();
    await post(url, '/api/register', { username: 'Ellie', password: 'longenough' });
    const res = await post(url, '/api/login', { username: 'eLLie', password: 'longenough' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Ellie');
    const account = await store.findAccountByUsername('Ellie');
    expect(verifyToken(res.body.token, SECRET)).toEqual({ accountId: account!.id });
  });

  it('gives the same 401 for a wrong password and an unknown name', async () => {
    const { url } = await startApp();
    await post(url, '/api/register', { username: 'Ellie', password: 'longenough' });
    const expected = { status: 401, body: { error: 'Wrong name or password' } };
    expect(await post(url, '/api/login', { username: 'Ellie', password: 'wrongpassword' })).toEqual(expected);
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
  it('creates a passwordless guest named Guest- and 4 digits', async () => {
    const { url, store } = await startApp();
    const res = await post(url, '/api/guest');
    expect(res.status).toBe(200);
    expect(res.body.name).toMatch(/^Guest-\d{4}$/);
    const account = await store.findAccountByUsername(res.body.name);
    expect(account).toMatchObject({ isGuest: true, passwordHash: null });
    expect(verifyToken(res.body.token, SECRET)).toEqual({ accountId: account!.id });
  });

  it('picks another number when the name is taken', async () => {
    const { url, store } = await startApp();
    const random = vi.spyOn(Math, 'random');
    // The first pick is Guest-1234 (taken), the second Guest-5678.
    random.mockReturnValueOnce(0.1234).mockReturnValueOnce(0.5678);
    await store.createAccount({ username: 'Guest-1234', passwordHash: null, isGuest: true });
    try {
      const first = await post(url, '/api/guest');
      expect(first.body.name).toBe('Guest-5678');
    } finally {
      random.mockRestore();
    }
  });
});

describe('limits', () => {
  it('answers the 11th request in a minute from one address with 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T12:00:00Z'));
    const { url } = await startApp();
    const paths = ['/api/register', '/api/login', '/api/guest'];
    for (let i = 0; i < 10; i++) {
      const res = await post(url, paths[i % 3]!, { username: 'Nobody', password: 'x' });
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
    const res = await post(url, '/api/register', { username: 'Ellie', password: 'x'.repeat(2100) });
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
