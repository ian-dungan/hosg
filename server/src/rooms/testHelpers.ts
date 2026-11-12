// Shared helpers for the room tests: boot an app on a free port and connect SDK clients to it.
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { TICK_HZ, groveTownSurface, type Surface, type ZoneId } from '@sg2/shared';
import { createApp, type AppOptions } from '../app';
import { signToken } from '../auth/tokens';
import { createMemoryStore } from '../store/memory';
import type { Adventurer, Store } from '../store/types';
import type { ZoneRoom } from './ZoneRoom';
import { PlayerState } from './state';

export const SECRET = 'test-secret-that-is-at-least-32-characters';

export interface TestServer {
  url: string;
  store: Store;
  app: ReturnType<typeof createApp>;
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Starts an app on a free port; the caller must `app.close()` it. */
export async function startServer(
  opts: Partial<Omit<AppOptions, 'jwtSecret'>> = {},
): Promise<TestServer> {
  const store = opts.store ?? createMemoryStore();
  const app = createApp({ ...opts, store, jwtSecret: SECRET });
  const port = await freePort();
  await app.listen(port);
  return { url: `http://127.0.0.1:${port}`, store, app };
}

/** A guest account in the store, its adventurer named `username`, and a valid token for it. */
export async function accountFor(store: Store, username: string): Promise<{ accountId: string; token: string }> {
  const account = await store.createAccount({ username, passwordHash: null, isGuest: true });
  await store.nameAdventurer(account.id, username);
  return { accountId: account.id, token: signToken(account.id, SECRET) };
}

/** Joins the grove and waits until the client sees itself in the state. Automatic reconnection is off. */
export async function joinGrove(url: string, token: string): Promise<{ client: Client; room: Room<any, any> }> {
  return joinZone(url, token, 'grove');
}

/** Joins the room of `zone` and waits until the client sees itself in the state. Automatic reconnection is off. */
export async function joinZone(url: string, token: string, zone: ZoneId = 'grove'): Promise<{ client: Client; room: Room<any, any> }> {
  const client = new Client(url);
  const room = await client.joinOrCreate(zone, { token });
  room.reconnection.enabled = false;
  room.onMessage('*', () => {}); // messages a test does not collect (fx, self, ...) are dropped quietly
  await waitFor(() => room.state.players?.get(room.sessionId));
  return { client, room };
}

/** Polls until `check` returns something truthy, or fails after `ms`. */
export async function waitFor<T>(check: () => T | Promise<T>, ms = 2000): Promise<NonNullable<T>> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error(`waitFor timed out after ${ms} ms`);
    await sleep(10);
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Every message of `type` the room receives from now on. */
export function collect(room: Room<any, any>, type: string): any[] {
  const seen: any[] = [];
  room.onMessage(type, (message: any) => seen.push(message));
  return seen;
}

/**
 * Walks in a straight line from `from` to `to` at running speed: steps of at most 0.4 m, one per tick,
 * each standing on `surface` (default the grove town's).
 */
export async function walk(
  room: Room<any, any>,
  from: { x: number; z: number },
  to: { x: number; z: number },
  surface: Surface = groveTownSurface,
): Promise<void> {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.4);
  for (let i = 1; i <= steps; i++) {
    const x = i === steps ? to.x : from.x + ((to.x - from.x) * i) / steps;
    const z = i === steps ? to.z : from.z + ((to.z - from.z) * i) / steps;
    room.send('move', { x, z, y: surface(x, z) ?? 0, facing: 0, moving: i < steps });
    await sleep(1000 / TICK_HZ);
  }
}

/** Saves the account's adventurer with these changes (position, zone, hp, loadout) before it joins. */
export async function saveAs(
  store: Store,
  accountId: string,
  changes: Partial<Pick<Adventurer, 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'loadout'>>,
): Promise<void> {
  const { id, x, z, facing, zone, hp, loadout } = await store.getOrCreateAdventurer(accountId);
  await store.saveAdventurer({ id, x, z, facing, zone, hp, loadout, ...changes });
}

/**
 * A combat clock for tests (seconds, monotonic): runs at `rate` × real time, can be sped up or slowed
 * down with setRate, and jumped ahead with skip. Pass `now` as the app's `combatClock`.
 */
export function testClock(rate = 1) {
  let base = 0, from = performance.now(), r = rate;
  const now = () => base + ((performance.now() - from) / 1000) * r;
  return {
    now,
    setRate(k: number) { base = now(); from = performance.now(); r = k; },
    skip(seconds: number) { base += seconds; },
  };
}

/** The server-side room object behind a client's room (same process). */
export function serverRoom(room: Room<any, any>): ZoneRoom {
  return matchMaker.getLocalRoomById(room.roomId) as unknown as ZoneRoom;
}

const probe = new PlayerState();
/** What the state shows for an x or z the server took (positions are quantised on the wire: state.ts). */
export const sx = (v: number): number => ((probe.x = v), probe.x);
/** What the state shows for a feet height. */
export const sy = (v: number): number => ((probe.y = v), probe.y);
/** What the state shows for a facing (read back in [0, 2π)). */
export const sf = (v: number): number => ((probe.facing = v), probe.facing);
/** `pose` as the state shows it: x, z, y and facing quantised, everything else as it is. */
export function shown<T extends object>(pose: T): T {
  const out = { ...pose } as Record<string, unknown>;
  for (const [k, f] of [['x', sx], ['z', sx], ['y', sy], ['facing', sf]] as const) if (typeof out[k] === 'number') out[k] = f(out[k] as number);
  return out as T;
}
