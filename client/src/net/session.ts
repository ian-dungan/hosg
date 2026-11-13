// Talking to the Shady Grove 2 server: the accounts API, asking which zone the adventurer is in, and joining
// that zone's room (one room per zone, named by the zone id).
// The server is the origin that served the page. In development builds only, `?server=http://host:port`
// points the room connection somewhere else (the /api requests stay on the page's origin, which the
// dev server proxies; see vite.config.ts). Production builds never read it: a crafted link must not
// send the player's token to another server.
import { Client, ErrorCode, type Room } from '@colyseus/sdk';
import { TICK_HZ, isZoneId, type ZoneId } from '@sg2/shared';

/** One adventurer as the room state shows it (the server's PlayerState). */
export interface PlayerView {
  readonly name: string;
  readonly x: number;
  readonly z: number;
  /** Height of the feet. */
  readonly y: number;
  readonly facing: number;
  readonly moving: boolean;
  /** Health, 1..maxHp (0 when dead). */
  readonly hp: number;
  readonly maxHp: number;
  /** Combat (Task 6): the engine id, weapon, target (−1 none), dead, act and shield. Missing on an older server. */
  readonly eid?: number;
  readonly weapon?: string;
  readonly target?: number;
  readonly dead?: boolean;
  /** '' | 'charge' | 'dodge' | 'knock' | 'dead'. */
  readonly act?: string;
  readonly shield?: number;
  /** Jobs (Plan 3b): the current job (a JobId). */
  readonly job?: string;
  /** Plan 5: the last emote (an EmoteId; unset until the first) and its `clock` step (a change plays it; a move ends it). */
  readonly emote?: string;
  readonly emoteAt?: number;
  /**
   * The ability being cast ('' none), its full cast time in s and when it began on the state's `clock`. Like
   * `buffs` (BUFF_BITS), unset until the adventurer's first cast (or buff): read them as '' and 0.
   */
  readonly cast?: string;
  readonly castTotal?: number;
  readonly castAt?: number;
  readonly buffs?: number;
  /** Plan 4: Searing stacks (0–5), unset until the first. Plan 5: the current job's level. */
  readonly searing?: number;
  readonly level?: number;
}

/** One enemy as the room state shows it (the server's EnemyState, from Task 6). */
export interface EnemyStateView {
  readonly eid: number;
  readonly kind: string;
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly facing: number;
  readonly hp: number;
  readonly maxHp: number;
  /** 'idle' | 'fight' | 'windup' | 'stunned' | 'return' | 'dead'. */
  readonly mode: string;
  /** The attack being wound up ('' when none) and its whole wind-up time in s. */
  readonly windup: string;
  readonly windupTotal: number;
  /** The engine id of its target, or −1. */
  readonly target?: number;
  readonly stagger?: number;
  readonly maxStagger?: number;
  /** Live marks as bits (MARK_BITS). */
  readonly marks?: number;
  /** The chase surge is on. */
  readonly surging?: boolean;
  /** Seconds until its stagger bar can fill again (0 = it can). */
  readonly staggerImmune?: number;
  /** Live debuffs as bits (DEBUFF_BITS); unset until its first debuff (read as 0). */
  readonly debuffs?: number;
  /** Plan 4: 'elite' | 'boss' | 'mega' (unset: ordinary); a boss's 0-based phase; warded; when it enrages on `clock` (0: no clock running). */
  readonly tier?: string;
  readonly phase?: number;
  readonly warded?: boolean;
  readonly enrageAt?: number;
}

/** A telegraph on the ground (the server's TelegraphState): immutable, deleted when it resolves or is cancelled. */
export interface TelegraphStateView {
  readonly id: number;
  /** The enemy's engine id. */
  readonly owner: number;
  readonly attack: string;
  /** 'circle' | 'cone' | 'line' | 'ring'. */
  readonly shape: string;
  readonly x: number;
  readonly z: number;
  /** Direction (cone, line), as `facing`. */
  readonly dir: number;
  /** Radius (circle, cone) or length (line). */
  readonly r: number;
  readonly width: number;
  /** A ring's inner radius (the safe middle); unset (0) for other shapes. */
  readonly inner?: number;
  /** Cone full width (rad). */
  readonly angle: number;
  /** Wind-up length in s. */
  readonly total: number;
  /** When the wind-up began, on the state's `clock` (steps of 1/TICK_HZ s). Missing from an older server. */
  readonly at?: number;
}

/** A synchronised map in the room state (a Colyseus MapSchema as the client sees it). */
export interface StateMap<T> {
  get(key: string): T | undefined;
  forEach(cb: (value: T, key: string) => void): void;
  readonly size: number;
}

/**
 * A zone room's synchronised state (the server's ZoneState): players keyed by sessionId, enemies keyed by
 * String(eid). Each is missing until the first state arrives (enemies until the server has combat).
 */
export interface ZoneState {
  readonly players?: StateMap<PlayerView>;
  readonly enemies?: StateMap<EnemyStateView>;
  readonly telegraphs?: StateMap<TelegraphStateView>;
  /** The zone's true head count (players holds only those within this client's interest radius). */
  readonly online?: number;
  /** The combat clock in steps of 1/TICK_HZ s (telegraphs' `at` is on it). */
  readonly clock?: number;
  /** Plan 4: standing hazards (every client gets every one). */
  readonly fields?: StateMap<FieldStateView>;
  /** A Lampfall instance's room id ('' in a shared zone room). */
  readonly instance?: string;
  /** The boss room whose gate is sealed ('wickhound' | 'warden' | ''). */
  readonly sealed?: string;
  /** Shut lamp-gates as bits (GATE_WICK, GATE_WICK_EXIT, GATE_PIT): each a wall, as on the server. */
  readonly gates?: number;
  /** During a wipe: the clock step when everyone gets up; 0 none. */
  readonly wipeAt?: number;
  /** The lamp-lift is open (the Warden has fallen here). */
  readonly lift?: boolean;
}

/** A standing hazard (the server's FieldState). */
export interface FieldStateView {
  readonly id: number; readonly owner: number; readonly field: string;
  /** 'ring' | 'circle'. */
  readonly shape: string;
  readonly x: number; readonly z: number; readonly r: number; readonly inner: number; readonly raw: number; readonly at: number;
}

/**
 * How far along a telegraph (and so its owner's wind-up) is, in s, by the state's clock: 0 when the
 * server sends no clock. A client that first sees one late (it came into view mid-wind-up) starts its
 * decal and the enemy's wind-up from here, not from 0.
 */
export function telegraphElapsedS(t: Pick<TelegraphStateView, 'at' | 'total'>, clock: number | undefined): number {
  if (typeof t.at !== 'number' || typeof clock !== 'number') return 0;
  return Math.max(0, Math.min(t.total, (clock - t.at) / TICK_HZ));
}

/** How far along enemy `eid`'s wind-up is, in s: from the telegraph it owns (every attack has one), else 0. */
export function windupElapsedS(state: Pick<ZoneState, 'telegraphs' | 'clock'>, eid: number): number {
  let el = 0;
  state.telegraphs?.forEach((t) => { if (t.owner === eid) el = Math.max(el, telegraphElapsedS(t, state.clock)); });
  return el;
}

export type ZoneRoom = Room<ZoneState>;
/** Kept for older callers: every zone room has the same state. */
export type GroveRoom = ZoneRoom;

/** Smallest pose change worth sending (m or rad); the rig's slow-down never quite reaches zero. */
const POSE_EPSILON = 1e-3;

/** The pose the client sends each tick: where the feet are, which way the adventurer faces, whether they are moving. */
export interface SentPose { x: number; z: number; y: number; facing: number; moving: boolean }

/** True if `pose` differs from the last one sent; a change of height alone counts (a standing jump, the landing). */
export function poseWorthSending(pose: SentPose, sent: SentPose): boolean {
  const same = (a: number, b: number) => Math.abs(a - b) < POSE_EPSILON; // false against NaN: nothing sent yet
  return !(same(pose.x, sent.x) && same(pose.z, sent.z) && same(pose.y, sent.y) && same(pose.facing, sent.facing)
    && pose.moving === sent.moving);
}

const TOKEN_KEY = 'sg2.token';
/** The saved token's adventurer name, once known, for the login screen's "Continue as". */
const NAME_KEY = 'sg2.name';
/** Longest wait for the server to answer a login or a join, so the page never hangs on a dead server. */
const TIMEOUT_MS = 15_000;
export const UNREACHABLE = 'Cannot reach the server';
/** A join refused because the token is no good (expired, or its account is gone). */
export const SIGN_IN_AGAIN = 'Please sign in again';

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

/** The saved token and its adventurer's name, when both are known: the login screen offers to continue with them. */
export function savedAccount(): { token: string; name: string } | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    const name = sessionStorage.getItem(NAME_KEY);
    return token && name ? { token, name } : null;
  } catch {
    return null;
  }
}

export function forgetToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(NAME_KEY);
  } catch { /* storage blocked */ }
}

/** Saves the token, and its adventurer's name if it has one (a new token never keeps an old name). */
function saveToken(token: string, name: string | null): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (name === null) sessionStorage.removeItem(NAME_KEY);
    else sessionStorage.setItem(NAME_KEY, name);
  } catch { /* storage blocked: a reload asks again */ }
}

/** Records the saved token's adventurer name (as the room shows it) for "Continue as". */
export function rememberName(name: string): void {
  try { if (sessionStorage.getItem(TOKEN_KEY)) sessionStorage.setItem(NAME_KEY, name); } catch { /* storage blocked */ }
}

/** Rejects with `Error(message)` if `p` has not settled within TIMEOUT_MS. */
function withTimeout<T>(p: Promise<T>, message: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), TIMEOUT_MS); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** POSTs JSON to the accounts API, within TIMEOUT_MS; resolves with the status and the parsed body (null if none). */
async function postApi(path: string, payload: unknown, headers: Record<string, string> = {}): Promise<{ res: Response; body: Record<string, unknown> | null }> {
  const controller = new AbortController();
  try {
    const res = await withTimeout(fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }), UNREACHABLE);
    const body = await withTimeout(res.json(), UNREACHABLE).catch(() => null);
    return { res, body: body && typeof body === 'object' ? body : null };
  } catch {
    controller.abort();
    throw new Error(UNREACHABLE);
  }
}

/**
 * Registers, logs in or makes a guest account; throws an Error with the server's `error` text.
 * `name` is the adventurer's name, or null while the player has still to choose it.
 */
export async function login(
  kind: 'register' | 'login' | 'guest',
  username?: string,
  password?: string,
): Promise<{ token: string; name: string | null }> {
  const { res, body } = await postApi(kind, kind === 'guest' ? {} : { username, password });
  const name = body?.name;
  if (!res.ok || typeof body?.token !== 'string' || (typeof name !== 'string' && name !== null)) {
    throw new Error(typeof body?.error === 'string' ? body.error : `The server could not sign you in (${res.status})`);
  }
  saveToken(body.token, name);
  return { token: body.token, name };
}

/** The server's answer when the adventurer was named meanwhile (another tab or device). */
const ALREADY_NAMED = 'Your adventurer already has a name';

/**
 * What an answer to POST /api/name means for the name screen:
 * - `named`: done, with the name the server stored;
 * - `alreadyNamed`: done too, the name was chosen elsewhere (the room will show it);
 * - `signIn`: the token is no good any more (401), so back to the login screen with `error`;
 * - `retry`: `error` is shown on the name screen and the player can try another name.
 */
export type NameResult =
  | { kind: 'named'; name: string }
  | { kind: 'alreadyNamed' }
  | { kind: 'signIn'; error: string }
  | { kind: 'retry'; error: string };

export function nameResult(status: number, body: Record<string, unknown> | null): NameResult {
  const error = typeof body?.error === 'string' ? body.error : null;
  if (status >= 200 && status < 300 && typeof body?.name === 'string') return { kind: 'named', name: body.name };
  if (status === 409 && error === ALREADY_NAMED) return { kind: 'alreadyNamed' };
  if (status === 401) return { kind: 'signIn', error: error ?? 'Please sign in again' };
  return { kind: 'retry', error: error ?? `The server could not save the name (${status})` };
}

/** Asks the server to give the account's adventurer its permanent name; an unreachable server is a `retry`. */
export async function nameAdventurer(token: string, name: string): Promise<NameResult> {
  try {
    const { res, body } = await postApi('name', { name }, { Authorization: `Bearer ${token}` });
    return nameResult(res.status, body);
  } catch (err) {
    return { kind: 'retry', error: err instanceof Error ? err.message : UNREACHABLE };
  }
}

/** Where an adventurer is: a zone, and inside the Lampfall the id of its instance's room. */
export interface ZonePlace { zone: ZoneId; instance?: string }

/** Longest instance room id accepted from the server. */
const INSTANCE_ID_MAX = 64;

/**
 * Which zone the token's adventurer is in (GET /api/zone): the room to join, with the instance's room id inside
 * the Lampfall (a seat held there: a reload, a new tab). Throws Error(SIGN_IN_AGAIN) when the token is no good,
 * else Error(UNREACHABLE) when the server cannot answer.
 */
export async function zoneFor(token: string): Promise<ZonePlace> {
  const controller = new AbortController();
  let res: Response, body: unknown;
  try {
    res = await withTimeout(fetch('/api/zone', { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal }), UNREACHABLE);
    body = await withTimeout(res.json(), UNREACHABLE).catch(() => null);
  } catch {
    controller.abort();
    throw new Error(UNREACHABLE);
  }
  if (res.status === 401) throw new Error(SIGN_IN_AGAIN);
  const zone = (body as { zone?: unknown } | null)?.zone;
  const instance = (body as { instance?: unknown } | null)?.instance;
  if (!res.ok || !isZoneId(zone)) throw new Error(UNREACHABLE);
  if (typeof instance === 'string' && instance.length > 0 && instance.length <= INSTANCE_ID_MAX) return { zone, instance };
  // the Lampfall is only ever joined by its instance's id
  if (zone === 'lampfall') throw new Error(UNREACHABLE);
  return { zone };
}

/**
 * Joins zone `zone`'s room with a token, or with `instance` the room with that id (a Lampfall instance). Throws an
 * Error with the server's reason if the join is refused.
 */
export async function connect(token: string, zone: ZoneId = 'grove', instance?: string): Promise<ZoneRoom> {
  const client = new Client(serverUrl());
  for (let attempt = 1; ; attempt++) {
    const joining = instance ? client.joinById<ZoneState>(instance, { token }) : client.joinOrCreate<ZoneState>(zone, { token });
    try {
      return await withTimeout(joining, UNREACHABLE);
    } catch (err) {
      // A join that completes after the timeout must not linger as a second, invisible session.
      joining.then((room) => room.leave(), () => {});
      if ((err as { code?: unknown } | null)?.code === ErrorCode.AUTH_FAILED) throw new Error(SIGN_IN_AGAIN);
      const message = err instanceof Error && err.message ? err.message : UNREACHABLE;
      if (retryJoin(message, attempt)) continue;
      throw new Error(/fetch|network|failed to|seat reservation/i.test(message) ? UNREACHABLE : message);
    }
  }
}

/**
 * Whether a failed join is tried again before its error is shown: a join that timed out once (a slow or busy device
 * can take longer than TIMEOUT_MS to open the room; the second try usually fits), and an expired seat reservation up
 * to twice (the device opened the socket too late for its reserved seat).
 */
export function retryJoin(message: string, attempt: number): boolean {
  if (message === UNREACHABLE) return attempt < 2;
  return attempt < 3 && /seat reservation expired/i.test(message);
}
