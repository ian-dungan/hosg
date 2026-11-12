import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGN_IN_AGAIN, UNREACHABLE, forgetToken, login, nameResult, poseWorthSending, rememberName, savedAccount, savedToken, serverUrl, zoneFor } from './session';

const page = (search: string) => ({ origin: 'http://game.example:2570', search });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A sessionStorage stand-in (vitest runs these tests in Node, which has none). */
function stubStorage(): Map<string, string> {
  const items = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  return items;
}

/** fetch answering every request with `body`. */
function stubFetch(body: unknown): void {
  vi.stubGlobal('window', globalThis); // for window.setTimeout
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status: 200 }));
}

describe('serverUrl', () => {
  it('uses the page origin when there is no override', () => {
    vi.stubEnv('DEV', true);
    expect(serverUrl(page(''))).toBe('http://game.example:2570');
    vi.stubEnv('DEV', false);
    expect(serverUrl(page(''))).toBe('http://game.example:2570');
  });

  it('honours ?server= in a development build', () => {
    vi.stubEnv('DEV', true);
    expect(serverUrl(page('?server=http://localhost:2571/x'))).toBe('http://localhost:2571');
    expect(serverUrl(page('?server=javascript:alert(1)'))).toBe('http://game.example:2570');
    expect(serverUrl(page('?server=not a url'))).toBe('http://game.example:2570');
  });

  it('ignores ?server= in a production build', () => {
    vi.stubEnv('DEV', false);
    expect(serverUrl(page('?server=http://attacker.example'))).toBe('http://game.example:2570');
  });
});

describe('nameResult', () => {
  it('is done when the server stored the name', () => {
    expect(nameResult(200, { name: 'Elowen' })).toEqual({ kind: 'named', name: 'Elowen' });
  });

  it('is done too when the adventurer was named meanwhile elsewhere', () => {
    expect(nameResult(409, { error: 'Your adventurer already has a name' })).toEqual({ kind: 'alreadyNamed' });
  });

  it('sends the player back to sign in when the token is no good', () => {
    expect(nameResult(401, { error: 'Please sign in again' })).toEqual({ kind: 'signIn', error: 'Please sign in again' });
    expect(nameResult(401, null)).toEqual({ kind: 'signIn', error: 'Please sign in again' });
  });

  it('lets the player try again after any other refusal', () => {
    expect(nameResult(409, { error: 'That name is taken' })).toEqual({ kind: 'retry', error: 'That name is taken' });
    expect(nameResult(400, { error: 'That name is not allowed' })).toEqual({ kind: 'retry', error: 'That name is not allowed' });
    expect(nameResult(429, { error: 'Too many attempts, wait a minute' })).toEqual({
      kind: 'retry',
      error: 'Too many attempts, wait a minute',
    });
    expect(nameResult(500, null)).toEqual({ kind: 'retry', error: 'The server could not save the name (500)' });
    expect(nameResult(200, {})).toEqual({ kind: 'retry', error: 'The server could not save the name (200)' });
  });
});

describe('the saved account ("Continue as")', () => {
  it('keeps a guest\'s token and adventurer name together', async () => {
    stubStorage();
    stubFetch({ token: 'guest-token', name: 'Guest-123456' });
    await login('guest');
    expect(savedAccount()).toEqual({ token: 'guest-token', name: 'Guest-123456' });
  });

  it('never pairs a new token with an older account\'s name', async () => {
    stubStorage();
    stubFetch({ token: 'old', name: 'Guest-123456' });
    await login('guest');
    stubFetch({ token: 'new', name: null }); // registered, adventurer still to be named
    await login('register', 'rowan_88', 'longenough');
    expect(savedToken()).toBe('new');
    expect(savedAccount()).toBeNull();
    rememberName('Elowen'); // the room showed the adventurer
    expect(savedAccount()).toEqual({ token: 'new', name: 'Elowen' });
  });

  it('remembers a name only alongside a token, and forgets both together', () => {
    stubStorage();
    rememberName('Elowen');
    expect(savedAccount()).toBeNull();
    sessionStorage.setItem('sg2.token', 't');
    rememberName('Elowen');
    expect(savedAccount()).toEqual({ token: 't', name: 'Elowen' });
    forgetToken();
    expect(savedAccount()).toBeNull();
    expect(savedToken()).toBeNull();
  });

  it('is simply absent when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(savedAccount()).toBeNull();
  });
});

describe('poseWorthSending', () => {
  const last = { x: 3, z: -4, y: 0.2, facing: 1, moving: false };
  it('skips a pose that has not changed (the rig\'s slow-down never quite reaches zero)', () => {
    expect(poseWorthSending({ ...last, x: 3.0004 }, last)).toBe(false);
  });
  it('sends a standing jump, a fall and the landing: a change of height alone', () => {
    expect(poseWorthSending({ ...last, y: 0.9 }, last)).toBe(true); // rising in place
    expect(poseWorthSending({ ...last, y: 0.2 }, { ...last, y: 0.25 })).toBe(true); // the landing pose
  });
  it('sends a change of position, facing or moving', () => {
    expect(poseWorthSending({ ...last, z: -4.01 }, last)).toBe(true);
    expect(poseWorthSending({ ...last, facing: 1.01 }, last)).toBe(true);
    expect(poseWorthSending({ ...last, moving: true }, last)).toBe(true);
  });
  it('always sends when nothing has been sent yet (NaN)', () => {
    expect(poseWorthSending(last, { x: NaN, z: NaN, y: NaN, facing: NaN, moving: false })).toBe(true);
  });
});

describe('zoneFor', () => {
  const answer = (status: number, body: unknown, seen?: { url?: string; auth?: string | null }) => {
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (seen) { seen.url = url; seen.auth = new Headers(init?.headers).get('Authorization'); }
      return new Response(JSON.stringify(body), { status });
    });
  };

  it('asks GET /api/zone with the token and answers the zone', async () => {
    const seen: { url?: string; auth?: string | null } = {};
    answer(200, { zone: 'greenway' }, seen);
    await expect(zoneFor('tok')).resolves.toBe('greenway');
    expect(seen).toEqual({ url: '/api/zone', auth: 'Bearer tok' });
    answer(200, { zone: 'grove' });
    await expect(zoneFor('tok')).resolves.toBe('grove');
  });

  it('a refused token means signing in again; anything else is an unreachable server', async () => {
    answer(401, { error: 'Please sign in again' });
    await expect(zoneFor('bad')).rejects.toThrow(SIGN_IN_AGAIN);
    answer(200, { zone: 'narnia' });
    await expect(zoneFor('tok')).rejects.toThrow(UNREACHABLE);
    answer(500, { error: 'boom' });
    await expect(zoneFor('tok')).rejects.toThrow(UNREACHABLE);
    vi.stubGlobal('fetch', async () => { throw new TypeError('Failed to fetch'); });
    await expect(zoneFor('tok')).rejects.toThrow(UNREACHABLE);
  });
});
