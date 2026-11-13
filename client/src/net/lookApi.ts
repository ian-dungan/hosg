// The character creator's HTTP route (server/src/routes/look.ts): GET /api/look says whether the one free creator visit
// is still unused (new and existing adventurers alike) and gives the stored look and name; POST /api/look spends it.
import { defaultLook, parseLook, type Look } from '@sg2/shared';
import { UNREACHABLE, withTimeout } from './session';

export interface LookInfo { look: Look | null; free: boolean; name: string | null; guest: boolean }
export type LookInfoResult = { kind: 'ok'; info: LookInfo } | { kind: 'signIn'; error: string } | { kind: 'error'; error: string };

/** What a GET /api/look answer means (a malformed one is an error; a bad stored look reads as none). */
export function lookInfoResult(status: number, body: unknown): LookInfoResult {
  const b = body as Record<string, unknown> | null;
  const error = typeof b?.error === 'string' ? b.error : null;
  if (status === 401) return { kind: 'signIn', error: error ?? 'Please sign in again' };
  if (status < 200 || status >= 300 || !b || typeof b.free !== 'boolean') return { kind: 'error', error: error ?? `The server could not load your look (${status})` };
  const name = typeof b.name === 'string' ? b.name : null;
  return { kind: 'ok', info: { look: parseLook(b.look), free: b.free, name, guest: b.guest === true } };
}

export type SaveLookResult =
  | { kind: 'saved'; info: LookInfo }
  /** The name was refused (taken, or not allowed): the creator reopens on its Name tab with this line. */
  | { kind: 'name'; error: string }
  /** The free visit was already spent (another tab): carry on into the game. */
  | { kind: 'notFree'; error: string }
  | { kind: 'signIn'; error: string }
  | { kind: 'retry'; error: string };

const NOT_FREE = 'Visit the Barber in Shady Grove to change your look';
/** What a POST /api/look answer means. `sentName`: whether the request carried a name. */
export function saveLookResult(status: number, body: unknown, sentName: boolean): SaveLookResult {
  const b = body as Record<string, unknown> | null;
  const error = typeof b?.error === 'string' ? b.error : null;
  if (status >= 200 && status < 300) {
    const r = lookInfoResult(status, body);
    return r.kind === 'ok' ? { kind: 'saved', info: r.info } : { kind: 'retry', error: r.error };
  }
  if (status === 401) return { kind: 'signIn', error: error ?? 'Please sign in again' };
  if (status === 409 && error === NOT_FREE) return { kind: 'notFree', error };
  if (sentName && (status === 409 || (status === 400 && error !== 'That look is not possible' && error !== 'Bad request'))) return { kind: 'name', error: error ?? 'That name cannot be used' };
  return { kind: 'retry', error: error ?? `The server could not save your look (${status})` };
}

/** The account id inside a sign-in token (its `sub`), used to seed a default look; the token itself when unreadable. */
export function accountIdOf(token: string): string {
  try {
    const part = token.split('.')[1] ?? '';
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof json?.sub === 'string') return json.sub;
  } catch { /* not a JWT */ }
  return token;
}

/** The look the creator starts from: the stored one, else the account's default look. */
export const startingLook = (info: LookInfo, token: string): Look => info.look ?? defaultLook(accountIdOf(token));

/** One call to /api/look, within the session's timeout (a half-open server: "Cannot reach the server", never a blank page). */
async function call(method: 'GET' | 'POST', token: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  try {
    const res = await withTimeout(fetch('/api/look', {
      method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    }), UNREACHABLE);
    return { status: res.status, body: await withTimeout(res.json(), UNREACHABLE).catch(() => null) };
  } catch {
    controller.abort();
    throw new Error(UNREACHABLE);
  }
}
export async function fetchLookInfo(token: string): Promise<LookInfoResult> {
  try { const r = await call('GET', token); return lookInfoResult(r.status, r.body); }
  catch (err) { return { kind: 'error', error: err instanceof Error ? err.message : 'The server cannot be reached' }; }
}
export async function saveLook(token: string, look: Look, name?: string): Promise<SaveLookResult> {
  try { const r = await call('POST', token, name === undefined ? { look } : { look, name }); return saveLookResult(r.status, r.body, name !== undefined); }
  catch (err) { return { kind: 'retry', error: err instanceof Error ? err.message : 'The server cannot be reached' }; }
}
