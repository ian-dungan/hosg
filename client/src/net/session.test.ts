import { afterEach, describe, expect, it, vi } from 'vitest';
import { serverUrl } from './session';

const page = (search: string) => ({ origin: 'http://game.example:2570', search });

afterEach(() => vi.unstubAllEnvs());

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
