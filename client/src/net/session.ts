// Talking to the Shady Grove 2 server: the accounts API and joining the grove room.
// The server is the origin that served the page. In development builds only, `?server=http://host:port`
// points the room connection somewhere else (the /api requests stay on the page's origin, which the
// dev server proxies; see vite.config.ts). Production builds never read it: a crafted link must not
// send the player's token to another server.
import { Client, type Room } from '@colyseus/sdk';

/** One adventurer as the room state shows it (the server's PlayerState). */
export interface PlayerView {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly moving: boolean;
}

/** The grove room's synchronised state (the server's ZoneState), keyed by sessionId; `players` is missing until the first state arrives. */
export interface ZoneState {
  readonly players?: {
    get(sessionId: string): PlayerView | undefined;
    forEach(cb: (player: PlayerView, sessionId: string) => void): void;
    readonly size: number;
  };
}

export type GroveRoom = Room<ZoneState>;

const TOKEN_KEY = 'sg2.token';
/** Longest wait for the server to answer a login or a join, so the page never hangs on a dead server. */
const TIMEOUT_MS = 15_000;
const UNREACHABLE = 'Cannot reach the server';

/**
 * The room server: the page's own origin, or in a development build `?server=` when it is a valid
 * http(s) URL. `import.meta.env.DEV` is the constant false in production, so the bundler drops the
 * override branch entirely.
 */
export function serverUrl(page: { origin: string; search: string } = location): string {
  if (import.meta.env.DEV) {
    const override = new URLSearchParams(page.search).get('server');
    if (override) {
      try {
        const url = new URL(override);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
      } catch { /* not a URL: use the page's origin */ }
    }
  }
  return page.origin;
}

/** The token saved for this tab, so a reload resumes; null when there is none or storage is blocked. */
export function savedToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function forgetToken(): void {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}

function saveToken(token: string): void {
  try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* storage blocked: a reload asks again */ }
}

/** Rejects with `Error(message)` if `p` has not settled within TIMEOUT_MS. */
function withTimeout<T>(p: Promise<T>, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Registers, logs in or makes a guest account; throws an Error with the server's `error` text. */
export async function login(
  kind: 'register' | 'login' | 'guest',
  username?: string,
  password?: string,
): Promise<{ token: string; name: string }> {
  const controller = new AbortController();
  let res: Response;
  let body: { token?: unknown; name?: unknown; error?: unknown } | null = null;
  try {
    res = await withTimeout(fetch(`/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(kind === 'guest' ? {} : { username, password }),
      signal: controller.signal,
    }), UNREACHABLE);
    body = await withTimeout(res.json(), UNREACHABLE).catch(() => null);
  } catch {
    controller.abort();
    throw new Error(UNREACHABLE);
  }
  if (!res.ok || typeof body?.token !== 'string' || typeof body.name !== 'string') {
    throw new Error(typeof body?.error === 'string' ? body.error : `The server could not sign you in (${res.status})`);
  }
  saveToken(body.token);
  return { token: body.token, name: body.name };
}

/** Joins the grove with a token. Throws an Error with the server's reason if the join is refused. */
export async function connect(token: string): Promise<GroveRoom> {
  const client = new Client(serverUrl());
  for (let attempt = 1; ; attempt++) {
    const joining = client.joinOrCreate<ZoneState>('grove', { token });
    try {
      return await withTimeout(joining, UNREACHABLE);
    } catch (err) {
      // A join that completes after the timeout must not linger as a second, invisible session.
      joining.then((room) => room.leave(), () => {});
      const message = err instanceof Error && err.message ? err.message : UNREACHABLE;
      // A busy device can open the socket too late for its reserved seat; trying again usually fits.
      if (attempt < 3 && /seat reservation expired/i.test(message)) continue;
      throw new Error(/fetch|network|failed to|seat reservation/i.test(message) ? UNREACHABLE : message);
    }
  }
}
