// Shared helpers for the room tests: boot an app on a free port and connect SDK clients to it.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { LAMPFALL_MOUTH, TICK_HZ, groveTownSurface, worldOf as worldOfCombat, zoneDef, type InvOp, type Surface, type ZoneId } from '@sg2/shared';
import { killEnemy } from '../../../shared/src/combat/adventurer';
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

/**
 * Starts an app on a free port; the caller must `app.close()` it. Kits are off unless `kits: true`: the room
 * tests written before Plan 5 describe an adventurer on STARTER_STATS (a level 10 adventurer in the starter
 * kit, parity P1), so they run every adventurer so; Plan 5's tests turn kits on.
 */
export async function startServer(
  opts: Partial<Omit<AppOptions, 'jwtSecret'>> = {},
): Promise<TestServer> {
  const store = opts.store ?? createMemoryStore();
  const app = createApp({ ...opts, kits: opts.kits ?? false, store, jwtSecret: SECRET });
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
  return tracked(client, room);
}

/** Joins a Lampfall instance by its room id and waits until the client sees itself in the state. */
export async function joinInstance(url: string, token: string, roomId: string): Promise<{ client: Client; room: Room<any, any> }> {
  const client = new Client(url);
  const room = await client.joinById(roomId, { token });
  return tracked(client, room);
}

async function tracked(client: Client, room: Room<any, any>): Promise<{ client: Client; room: Room<any, any> }> {
  room.reconnection.enabled = false;
  // Messages a test does not collect (fx, self, ...) are kept for collectFromJoin, else dropped quietly.
  const early = new Map<string, any[]>();
  earlyMessages.set(room, early);
  room.onMessage('*', (type: string | number, message: any) => {
    const list = early.get(String(type)) ?? [];
    if (list.length < 200) list.push(message);
    early.set(String(type), list);
  });
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

const earlyMessages = new WeakMap<Room<any, any>, Map<string, any[]>>();

/**
 * Every message of `type` the room received since it joined (while no handler took that type) and
 * from now on: for messages a room sends right after a join (`jobs`).
 */
export function collectFromJoin(room: Room<any, any>, type: string): any[] {
  const seen = collect(room, type);
  seen.push(...(earlyMessages.get(room)?.get(type) ?? []));
  return seen;
}

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
  ack = 0,
): Promise<void> {
  const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / 0.4);
  for (let i = 1; i <= steps; i++) {
    const x = i === steps ? to.x : from.x + ((to.x - from.x) * i) / steps;
    const z = i === steps ? to.z : from.z + ((to.z - from.z) * i) / steps;
    room.send('move', { x, z, y: surface(x, z) ?? 0, facing: 0, moving: i < steps, ack });
    await sleep(1000 / TICK_HZ);
  }
}

/** Saves the account's adventurer with these changes (position, zone, hp, jobs) before it joins. */
export async function saveAs(
  store: Store,
  accountId: string,
  changes: Partial<Pick<Adventurer, 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'jobs'>>,
): Promise<void> {
  const { id, x, z, facing, zone, hp, jobs } = await store.getOrCreateAdventurer(accountId);
  await store.saveAdventurer({ id, x, z, facing, zone, hp, jobs, ...changes });
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

/**
 * `leader` invites `member` by name and `member` accepts: resolves with the party id once `member`
 * has the party view with itself in it.
 */
export async function partyUp(leader: Room<any, any>, member: Room<any, any>, memberName: string): Promise<string> {
  const invites = collect(member, 'partyInvite');
  const views = collect(member, 'party');
  leader.send('party', { op: 'invite', name: memberName });
  const invite = await waitFor(() => invites[0], 3000);
  member.send('party', { op: 'accept', partyId: invite.partyId });
  await waitFor(() => views.some((v) => v.party?.members.some((m: any) => m.name.toLowerCase() === memberName.toLowerCase())), 3000);
  return invite.partyId;
}

/** The party the engine of the room behind `room` has for that client's adventurer (null: none). */
export function engineParty(room: Room<any, any>): string | null | undefined {
  const server = serverRoom(room) as any;
  const eid = room.state.players.get(room.sessionId)?.eid;
  const adventurer = server?.combat ? worldOfCombat(server.combat).adventurers.get(eid) : undefined;
  return adventurer ? adventurer.party : undefined;
}

/**
 * The account's adventurer saved in the Greenway at the crater mouth's arrival point, joined there, walked
 * into the mouth, and joined into the instance it is sent to: the instance room, its id, and the
 * Greenway room it left (`greenway`, already left).
 */
export async function intoLampfall(url: string, store: Store, account: { accountId: string; token: string }, opts: { saved?: boolean } = {}) {
  if (opts.saved !== false) await saveAs(store, account.accountId, { zone: 'greenway', ...LAMPFALL_MOUTH.arrive });
  const greenway = await joinZone(url, account.token, 'greenway');
  const travels = collect(greenway.room, 'travel');
  await walk(greenway.room, LAMPFALL_MOUTH.arrive, { x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z }, zoneDef('greenway').surface);
  const travel = await waitFor(() => travels[0], 4000);
  const joined = await joinInstance(url, account.token, travel.instance);
  return { ...joined, roomId: travel.instance as string, greenway, travel };
}

/** Test-only: puts the client's adventurer at (x, z) on the server (a `displaced` resync); the ack its moves must carry from now on. */
export function place(room: Room<any, any>, x: number, z: number): number {
  const server = serverRoom(room) as unknown as { testPlace(sessionId: string, x: number, z: number): number };
  return server.testPlace(room.sessionId, x, z);
}

// ───────── Plan 5 ─────────

/** A fresh operation id (ruling P5-e: random, 16 characters of base64url). */
export const opId = (): string => randomBytes(12).toString('base64url');

/** Sends an inventory operation with a fresh op id (unless it carries one, or `id: null` asks for none). */
export function sendInv(room: Room<any, any>, op: InvOp | (Record<string, unknown> & { op: string }), id: string | null = opId()): string | null {
  room.send('inv', id === null || 'id' in op ? op : { ...op, id });
  return id === null ? null : ((op as { id?: string }).id ?? id);
}

/**
 * Kills an enemy of the room behind `room` (its engine id) with each `credit` room's adventurer on its threat
 * table at the given threat (default 50 each): the kill and its credit reach the room on its next tick (with
 * foughtMs 0 the kill is made at once, before the call returns).
 */
export async function killFor(room: Room<any, any>, enemyEid: number, credit: { room: Room<any, any>; threat?: number }[], foughtMs = 0): Promise<void> {
  const w = worldOfCombat(serverRoom(room).combat);
  const e = w.enemies.get(enemyEid);
  if (!e) throw new Error(`no enemy ${enemyEid}`);
  for (const c of credit) e.threat.set(c.room.state.players.get(c.room.sessionId).eid, c.threat ?? 50);
  // (foughtMs: the threat stands for a few steps first, as in a real fight)
  if (foughtMs > 0) await sleep(foughtMs);
  killEnemy(w, e, w.now);
}

/** Every state patch the client receives from now on, as raw bytes (look and gear codes are searched for in them). */
export function patchLog(room: Room<any, any>): Uint8Array[] {
  const serializer = (room as unknown as { serializer: { patch(bytes: Uint8Array, it: { offset: number }): unknown } }).serializer;
  const patch = serializer.patch.bind(serializer);
  const log: Uint8Array[] = [];
  serializer.patch = (bytes, it) => {
    log.push(Uint8Array.from(bytes.subarray(it.offset)));
    return patch(bytes, it);
  };
  return log;
}

/** The patches that carry `text` (a look or gear code: plain ASCII on the wire). */
export const carrying = (log: readonly Uint8Array[], text: string): number => log.filter((p) => Buffer.from(p).includes(Buffer.from(text, 'latin1'))).length;

/** Every `looks` message the room gets from its join on, and the codes it holds by engine id. */
export function trackLooks(room: Room<any, any>): { messages: any[]; look(eid: number): string | undefined; gear(eid: number): string | undefined } {
  const messages = collectFromJoin(room, 'looks');
  const latest = (eid: number) => {
    let found: [number, string, string] | undefined;
    for (const m of messages) for (const e of m.a as [number, string, string][]) if (e[0] === eid) found = e;
    return found;
  };
  return { messages, look: (eid) => latest(eid)?.[1], gear: (eid) => latest(eid)?.[2] };
}
