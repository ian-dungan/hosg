// The grove zone room: validated movement, periodic saving, reconnect window, one session per account.
import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import {
  CHAT_MIN_INTERVAL_MS,
  REASON_GROVE_FULL,
  REASON_NAME_FIRST,
  REASON_SIGNED_IN_ELSEWHERE,
  SPAWN,
  STEP_SLACK,
  TICK_HZ,
  checkMove,
  cleanChat,
  groveTownWalkable,
  parsePose,
  refillAllowance,
  type S2C,
} from '@sg2/shared';
import { verifyToken } from '../auth/tokens';
import type { Adventurer, Store } from '../store/types';
import { PatchRateMeter } from './patchRate';
import { PlayerState, ZoneState } from './state';

export interface ZoneRoomOptions {
  store: Store;
  reconnectSeconds: number;
  saveSeconds: number;
  /** Most adventurers in the room (including ones inside their reconnect window). */
  maxPlayers: number;
  /** The live grove room (there is only ever one), so the app can count adventurers online. */
  live: Set<ZoneRoom>;
}

/** One adventurer in the room. */
interface Session {
  client: Client;
  accountId: string;
  adventurerId: string;
  player: PlayerState;
  /** Last accepted position. */
  lastGood: { x: number; z: number };
  /** The account's movement allowance (shared with its later sessions). */
  movement: Allowance;
  /** Message token bucket: tokens left, and when it was last refilled (ms). */
  tokens: number;
  tokensAt: number;
  /** When this adventurer's last chat line went out (ms), or -Infinity. */
  lastChatAt: number;
  /** Set while the client is away and may reconnect. */
  reconnection?: Deferred<Client>;
}

/** Metres an account may still move, and when that was last refilled (ms). */
interface Allowance {
  metres: number;
  at: number;
}

/** What a successful onAuth attaches to the client (`client.auth`). */
interface JoinAuth {
  accountId: string;
}

/** The account for a join's `{ token }` option, or false (missing or invalid token, unknown account). */
async function authenticate(store: Store, jwtSecret: string, options: unknown): Promise<JoinAuth | false> {
  const token = (options as { token?: unknown } | undefined)?.token;
  const verified = typeof token === 'string' ? verifyToken(token, jwtSecret) : null;
  const account = verified && (await store.findAccountById(verified.accountId));
  return account ? { accountId: account.id } : false;
}

/**
 * Per-client message budget (token bucket): refills at 3 * TICK_HZ a second and holds about 4 s of
 * normal traffic, so a catch-up burst after a stall is absorbed. Messages beyond it are dropped
 * silently; the client stays connected.
 */
const MESSAGE_RATE = 3 * TICK_HZ;
const MESSAGE_BURST = 4 * (TICK_HZ + 1);
/** How long after its last move an absent account's allowance is surely full again and can be forgotten. */
const ALLOWANCE_FORGET_MS = 2000;

export class ZoneRoom extends Room<{ state: ZoneState }> {
  state = new ZoneState();
  autoDispose = false; // the one grove room lives as long as the server

  private store!: Store;
  private reconnectSeconds!: number;
  private live!: Set<ZoneRoom>;
  private maxPlayers!: number;
  private sessions = new Map<string, Session>(); // key: sessionId
  private sessionByAccount = new Map<string, string>(); // accountId -> sessionId
  /** Movement allowances by account id, kept across kick and re-join so a new session gets no fresh budget. */
  private allowances = new Map<string, Allowance>();
  private patchMeter = new PatchRateMeter(Date.now());

  onCreate(options: ZoneRoomOptions) {
    if (options.live.size > 0) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_GROVE_FULL); // never a second grove
    this.store = options.store;
    this.maxPlayers = options.maxPlayers;
    // Admission is decided by canAdmit, so Colyseus must never see the room as full (it would open
    // a second one): leave room for an account's new session joining before its old one is kicked.
    this.maxClients = options.maxPlayers * 2;
    this.reconnectSeconds = options.reconnectSeconds;
    this.live = options.live;
    this.live.add(this);
    this.setPatchRate(1000 / TICK_HZ);

    this.onMessage('move', this.guard('move', (client, message) => this.onMove(client, message)));
    this.onMessage('chat', this.guard('chat', (client, message) => this.onChat(client, message)));
    this.clock.setInterval(() => {
      this.forgetIdleAllowances();
      void this.saveAll();
    }, options.saveSeconds * 1000);
  }

  async onJoin(client: Client) {
    const { accountId } = client.auth as JoinAuth;
    // Checked again here because two joins can pass onAuth at the same time.
    if (!this.canAdmit(accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_GROVE_FULL);
    // Claim the account before any await, so a third join of the same account kicks this one.
    const previous = this.sessionByAccount.get(accountId);
    this.sessionByAccount.set(accountId, client.sessionId);
    if (previous) await this.kick(previous);

    let adventurer: Adventurer;
    let name: string;
    try {
      adventurer = await this.store.getOrCreateAdventurer(accountId);
      // onAuth refused unnamed adventurers already; names are never taken away, so this is a safeguard.
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      name = adventurer.name;
    } catch (err) {
      if (this.sessionByAccount.get(accountId) === client.sessionId) this.sessionByAccount.delete(accountId);
      throw err;
    }
    // The same account joined again while this join was loading: the newer one wins.
    if (this.sessionByAccount.get(accountId) !== client.sessionId) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_SIGNED_IN_ELSEWHERE);
    }

    const start = groveTownWalkable(adventurer.x, adventurer.z) ? adventurer : SPAWN;
    const player = new PlayerState({ name, x: start.x, z: start.z, facing: start.facing, moving: false });
    this.sessions.set(client.sessionId, {
      client,
      accountId,
      adventurerId: adventurer.id,
      player,
      lastGood: { x: start.x, z: start.z },
      movement: this.allowanceFor(accountId),
      tokens: MESSAGE_BURST,
      tokensAt: Date.now(),
      lastChatAt: -Infinity,
    });
    this.state.players.set(client.sessionId, player);
  }

  onDrop(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.player.moving = false;
    session.reconnection = this.allowReconnection(client, this.reconnectSeconds);
    session.reconnection.catch(() => {}); // a window that runs out (or is cut short) ends in onLeave
  }

  onReconnect(client: Client) {
    const session = this.sessions.get(client.sessionId);
    if (!session) return;
    session.client = client;
    session.reconnection = undefined;
  }

  async onLeave(client: Client) {
    await this.removeSession(client.sessionId);
  }

  async onDispose() {
    this.live.delete(this);
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.removeSession(sessionId)));
  }

  /** Whether an account may join: it is already here (its old session will be kicked), or there is space. */
  canAdmit(accountId: string): boolean {
    return this.sessionByAccount.has(accountId) || this.sessionByAccount.size < this.maxPlayers;
  }

  /** State patches actually sent per second over the last 5 s (TICK_HZ when the server keeps up). */
  get measuredPatchHz(): number {
    return this.patchMeter.rate(Date.now());
  }

  broadcastPatch(): boolean {
    this.patchMeter.record(Date.now());
    return super.broadcastPatch();
  }

  /** Adventurers in this room, including ones inside their reconnect window. */
  get playerCount(): number {
    return this.state.players.size;
  }

  private onMove(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const pose = parsePose(message);
    if (!session || !pose) return;
    const now = Date.now();
    const movement = session.movement;
    movement.metres = refillAllowance(movement.metres, (now - movement.at) / 1000);
    movement.at = now;
    if (checkMove(session.lastGood, pose, movement.metres, groveTownWalkable) !== 'ok') {
      this.sendTo(client, 'correct', { ...session.lastGood });
      return;
    }
    movement.metres -= Math.hypot(pose.x - session.lastGood.x, pose.z - session.lastGood.z);
    session.lastGood = { x: pose.x, z: pose.z };
    Object.assign(session.player, pose);
  }

  /** Cleaned text goes to everyone, sender included; empty text and lines within CHAT_MIN_INTERVAL_MS are dropped. */
  private onChat(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const text = cleanChat((message as { text?: unknown } | null)?.text);
    if (!session || text === null) return;
    const now = Date.now();
    if (now - session.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
    session.lastChatAt = now;
    const chat: S2C['chat'] = { from: session.player.name, text };
    this.broadcast('chat', chat);
  }

  /** Ends an account's older session, connected or away; its adventurer is saved and removed at once. */
  private async kick(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    // Away: end the reconnect window at once, which frees its reserved seat (Colyseus counts reserved
    // seats toward maxClients, so a window left open would let one account fill the room). Ended
    // before the save, so a reconnection cannot slip in meanwhile; a client that comes back finds
    // its session gone ("Connection lost").
    if (session.reconnection) session.reconnection.reject(new Error(REASON_SIGNED_IN_ELSEWHERE));
    await this.removeSession(sessionId);
    if (!session.reconnection) {
      this.sendTo(session.client, 'kicked', { reason: REASON_SIGNED_IN_ELSEWHERE });
      session.client.leave(CloseCode.CONSENTED);
    }
  }

  /** Saves the adventurer and takes them out of the room; unknown sessions are ignored. */
  private async removeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (this.sessionByAccount.get(session.accountId) === sessionId) this.sessionByAccount.delete(session.accountId);
    this.state.players.delete(sessionId);
    await this.save(session);
  }

  private async saveAll() {
    await Promise.all([...this.sessions.values()].map((session) => this.save(session)));
  }

  private async save(session: Session) {
    const { x, z, facing } = session.player;
    try {
      await this.store.saveAdventurer({ id: session.adventurerId, x, z, facing });
    } catch (err) {
      console.error('Saving an adventurer failed:', err);
    }
  }

  private sendTo<K extends keyof S2C>(client: Client, type: K, message: S2C[K]) {
    client.send(type, message);
  }

  /** The account's allowance; a new one holds only the step slack, so joining never banks distance. */
  private allowanceFor(accountId: string): Allowance {
    let allowance = this.allowances.get(accountId);
    if (!allowance) {
      allowance = { metres: STEP_SLACK, at: Date.now() };
      this.allowances.set(accountId, allowance);
    }
    return allowance;
  }

  /** Drops allowances of accounts that are not here and have been still long enough to be full anyway. */
  private forgetIdleAllowances() {
    const now = Date.now();
    for (const [accountId, allowance] of this.allowances) {
      if (!this.sessionByAccount.has(accountId) && now - allowance.at > ALLOWANCE_FORGET_MS) this.allowances.delete(accountId);
    }
  }

  /** Takes one token from the client's message bucket; false (drop the message) when it is empty. */
  private takeToken(client: Client): boolean {
    const session = this.sessions.get(client.sessionId);
    if (!session) return true; // handlers ignore messages without a session anyway
    const now = Date.now();
    session.tokens = Math.min(MESSAGE_BURST, session.tokens + ((now - session.tokensAt) / 1000) * MESSAGE_RATE);
    session.tokensAt = now;
    if (session.tokens < 1) return false;
    session.tokens -= 1;
    return true;
  }

  /** Wraps a message handler: rate-limited per client, and a throw is logged while the room carries on. */
  private guard(type: string, handler: (client: Client, message: unknown) => void) {
    return (client: Client, message: unknown) => {
      if (!this.takeToken(client)) return;
      try {
        handler(client, message);
      } catch (err) {
        console.error(`The ${type} handler failed:`, err);
      }
    };
  }
}

/**
 * The grove room class for one app. Joins are checked during matchmaking (static onAuth), so a bad
 * token, an adventurer without a name or a full grove is refused over HTTP before any seat or socket is opened.
 */
export function zoneRoomFor(options: ZoneRoomOptions, jwtSecret: string): typeof ZoneRoom {
  return class GroveRoom extends ZoneRoom {
    static async onAuth(_token: string, joinOptions: unknown, _context: AuthContext) {
      const auth = await authenticate(options.store, jwtSecret, joinOptions);
      if (!auth) return false;
      if ((await options.store.getOrCreateAdventurer(auth.accountId)).name === null) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      }
      const [room] = options.live;
      if (room && !room.canAdmit(auth.accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_GROVE_FULL);
      return auth;
    }
  };
}
