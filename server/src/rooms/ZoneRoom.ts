// The grove zone room: validated movement, periodic saving, reconnect window, one session per account.
import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import { MAX_PLAYERS, SPAWN, TICK_HZ, checkStep, groveTownWalkable, parsePose, type S2C } from '@sg2/shared';
import { verifyToken } from '../auth/tokens';
import type { Store } from '../store/types';
import { PlayerState, ZoneState } from './state';

export interface ZoneRoomOptions {
  store: Store;
  reconnectSeconds: number;
  saveSeconds: number;
  /** Live rooms, so the app can count adventurers online. */
  live: Set<ZoneRoom>;
}

/** One adventurer in the room. */
interface Session {
  client: Client;
  accountId: string;
  adventurerId: string;
  player: PlayerState;
  /** Last accepted position, and when it was accepted (ms). */
  lastGood: { x: number; z: number };
  lastMoveAt: number;
  /** Set while the client is away and may reconnect. */
  reconnection?: Deferred<Client>;
}

/** What a successful onAuth attaches to the client (`client.auth`). */
interface JoinAuth {
  accountId: string;
  username: string;
}

/** The account for a join's `{ token }` option, or false (missing or invalid token, unknown account). */
async function authenticate(store: Store, jwtSecret: string, options: unknown): Promise<JoinAuth | false> {
  const token = (options as { token?: unknown } | undefined)?.token;
  const verified = typeof token === 'string' ? verifyToken(token, jwtSecret) : null;
  const account = verified && (await store.findAccountById(verified.accountId));
  return account ? { accountId: account.id, username: account.username } : false;
}

const KICK_REASON = 'Signed in somewhere else';

export class ZoneRoom extends Room<{ state: ZoneState }> {
  maxClients = MAX_PLAYERS;
  state = new ZoneState();

  private store!: Store;
  private reconnectSeconds!: number;
  private live!: Set<ZoneRoom>;
  private sessions = new Map<string, Session>(); // key: sessionId
  private sessionByAccount = new Map<string, string>(); // accountId -> sessionId

  onCreate(options: ZoneRoomOptions) {
    this.store = options.store;
    this.reconnectSeconds = options.reconnectSeconds;
    this.live = options.live;
    this.live.add(this);
    this.setPatchRate(1000 / TICK_HZ);

    this.onMessage('move', this.guard('move', (client, message) => this.onMove(client, message)));
    this.clock.setInterval(() => void this.saveAll(), options.saveSeconds * 1000);
  }

  async onJoin(client: Client) {
    const { accountId, username } = client.auth as JoinAuth;
    // Claim the account before any await, so a third join of the same account kicks this one.
    const previous = this.sessionByAccount.get(accountId);
    this.sessionByAccount.set(accountId, client.sessionId);
    if (previous) await this.kick(previous);

    let adventurer;
    try {
      adventurer = await this.store.getOrCreateAdventurer(accountId, username);
    } catch (err) {
      if (this.sessionByAccount.get(accountId) === client.sessionId) this.sessionByAccount.delete(accountId);
      throw err;
    }
    // The same account joined again while this join was loading: the newer one wins.
    if (this.sessionByAccount.get(accountId) !== client.sessionId) {
      throw new ServerError(ErrorCode.APPLICATION_ERROR, KICK_REASON);
    }

    const start = groveTownWalkable(adventurer.x, adventurer.z) ? adventurer : SPAWN;
    const player = new PlayerState({ name: adventurer.name, x: start.x, z: start.z, facing: start.facing, moving: false });
    this.sessions.set(client.sessionId, {
      client,
      accountId,
      adventurerId: adventurer.id,
      player,
      lastGood: { x: start.x, z: start.z },
      lastMoveAt: Date.now(),
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
    session.lastMoveAt = Date.now();
  }

  async onLeave(client: Client) {
    await this.removeSession(client.sessionId);
  }

  async onDispose() {
    this.live.delete(this);
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.removeSession(sessionId)));
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
    if (checkStep(session.lastGood, pose, (now - session.lastMoveAt) / 1000, groveTownWalkable) !== 'ok') {
      this.sendTo(client, 'correct', { ...session.lastGood });
      return;
    }
    session.lastGood = { x: pose.x, z: pose.z };
    session.lastMoveAt = now;
    Object.assign(session.player, pose);
  }

  /** Disconnects an account's older session (or ends its reconnect window); it is saved and removed at once. */
  private async kick(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    await this.removeSession(sessionId);
    if (session.reconnection) {
      session.reconnection.reject(new Error(KICK_REASON));
    } else {
      this.sendTo(session.client, 'kicked', { reason: KICK_REASON });
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

  /** Wraps a message handler so a throw is logged and the room carries on. */
  private guard(type: string, handler: (client: Client, message: unknown) => void) {
    return (client: Client, message: unknown) => {
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
 * token is refused over HTTP before any seat or socket is opened.
 */
export function zoneRoomFor(store: Store, jwtSecret: string): typeof ZoneRoom {
  return class GroveRoom extends ZoneRoom {
    static async onAuth(_token: string, options: unknown, _context: AuthContext) {
      return authenticate(store, jwtSecret, options);
    }
  };
}
