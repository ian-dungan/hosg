// A zone room (one per zone): validated movement and height, fall damage, periodic saving, reconnect
// window, travel through open exits, and one session per account across every room.
import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import {
  CHAT_MIN_INTERVAL_MS,
  HP_REGEN_PER_S,
  MAX_HP,
  REASON_ELSEWHERE,
  REASON_NAME_FIRST,
  REASON_SIGNED_IN_ELSEWHERE,
  REASON_TRAVEL_FAILED,
  STEP_SLACK,
  TICK_HZ,
  checkPose,
  cleanChat,
  fallDamage,
  landAirTrack,
  makeAirTrack,
  parsePose,
  refillAllowance,
  zoneFullReason,
  type Loadout,
  type S2C,
  type ZoneDef,
  type ZoneExit,
  type ZoneId,
} from '@sg2/shared';
import { verifyToken } from '../auth/tokens';
import type { Adventurer, AdventurerSave, Store } from '../store/types';
import { PatchRateMeter } from './patchRate';
import type { Allowance, Presence } from './presence';
import { PlayerState, ZoneState } from './state';

export interface ZoneRoomOptions {
  store: Store;
  reconnectSeconds: number;
  saveSeconds: number;
  /** Most adventurers in the room (including ones inside their reconnect window, and travellers on their way in). */
  maxPlayers: number;
  /** The zone this room runs: where adventurers can stand (`surface`), its spawn and its exits. */
  zone: ZoneDef;
  /** Which session holds each account, across all rooms (and the accounts' movement allowances). */
  presence: Presence;
  /** The live room of each zone (one per zone): travel looks up the destination here. */
  rooms: Map<ZoneId, ZoneRoom>;
  /** Whether the exits from zone `from` to zone `to` are open now (gates are server state; ZoneExit.open is only the default). */
  isExitOpen: (from: ZoneId, to: ZoneId) => boolean;
  /** Seconds after the last damage before health starts coming back. */
  hpRegenDelaySeconds: number;
}

/** One adventurer in the room. */
interface Session {
  client: Client;
  accountId: string;
  adventurerId: string;
  player: PlayerState;
  /** The equipped weapon and free picks, saved with the adventurer (changed only out of combat, from Task 6). */
  loadout: Loadout;
  /** Last accepted position. */
  lastGood: { x: number; z: number; y: number };
  /** The account's movement allowance and air track (shared with its later sessions). */
  movement: Allowance;
  /** When this adventurer last lost health (ms), or -Infinity. */
  lastHurtAt: number;
  /** Message token bucket: tokens left, and when it was last refilled (ms). */
  tokens: number;
  tokensAt: number;
  /** When this adventurer's last chat line went out (ms), or -Infinity. */
  lastChatAt: number;
  /** Set while the client is away and may reconnect. */
  reconnection?: Deferred<Client>;
  /** Set while a travel is being saved: moves are ignored, and leaving does not save over it. Settles once the travel is done or refused. */
  travelling?: Promise<void>;
  /** The last notice sent, and when (ms): the same line is not repeated within NOTICE_REPEAT_MS. */
  lastNotice?: { text: string; at: number };
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
/** How often health is given back (ms). */
const REGEN_EVERY_MS = 500;
/** The same notice is not sent to one adventurer again within this (ms), however often it walks into a full gate. */
const NOTICE_REPEAT_MS = 2000;

const clampHp = (hp: number) => (Number.isFinite(hp) ? Math.min(MAX_HP, Math.max(1, Math.round(hp))) : MAX_HP);

export class ZoneRoom extends Room<{ state: ZoneState }> {
  state = new ZoneState();
  autoDispose = false; // a zone's one room lives as long as the server

  /** The zone this room runs. */
  zone!: ZoneDef;
  private store!: Store;
  private reconnectSeconds!: number;
  private accounts!: Presence;
  private rooms!: Map<ZoneId, ZoneRoom>;
  private isExitOpen!: (from: ZoneId, to: ZoneId) => boolean;
  private maxPlayers!: number;
  private hpRegenDelayMs!: number;
  private sessions = new Map<string, Session>(); // key: sessionId
  /** Accounts with a seat here (joining, in the room or away), by the session that holds it: accountId -> sessionId. */
  private sessionByAccount = new Map<string, string>();
  /**
   * Seats kept for travellers saved in this zone who have not joined yet: accountId -> until (ms). A
   * seat is kept for the reconnect window, which a slow phone loading the zone needs at most.
   */
  private arrivals = new Map<string, number>();
  /** Travels still being saved, by session id: they outlive the session if it is kicked or leaves meanwhile. */
  private travels = new Map<string, Promise<void>>();
  private patchMeter = new PatchRateMeter(Date.now());

  onCreate(options: ZoneRoomOptions) {
    // Never a second room for a zone (Colyseus would open one if it ever saw this one as full).
    if (options.rooms.has(options.zone.id)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(options.zone.id));
    this.zone = options.zone;
    this.store = options.store;
    this.maxPlayers = options.maxPlayers;
    // Admission is decided by canAdmit, so Colyseus must never see the room as full (it would open
    // a second one): leave room for an account's new session joining before its old one is kicked.
    this.maxClients = options.maxPlayers * 2;
    this.reconnectSeconds = options.reconnectSeconds;
    this.accounts = options.presence;
    this.rooms = options.rooms;
    this.isExitOpen = options.isExitOpen;
    this.hpRegenDelayMs = options.hpRegenDelaySeconds * 1000;
    this.rooms.set(this.zone.id, this);
    this.setPatchRate(1000 / TICK_HZ);

    this.onMessage('move', this.guard('move', (client, message) => this.onMove(client, message)));
    this.onMessage('chat', this.guard('chat', (client, message) => this.onChat(client, message)));
    this.clock.setInterval(() => {
      this.forgetIdleAllowances();
      void this.saveAll();
    }, options.saveSeconds * 1000);
    this.clock.setInterval(() => this.regenerate(), REGEN_EVERY_MS);
  }

  async onJoin(client: Client) {
    const { accountId } = client.auth as JoinAuth;
    const sessionId = client.sessionId;
    // Checked again here because two joins can pass onAuth at the same time.
    if (!this.canAdmit(accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(this.zone.id));
    // Claim the account before any await, in every room at once, so a later join of the same account
    // (here or in another zone) kicks this one; and kick the session that held it, wherever it is.
    const previous = this.accounts.claim(accountId, this, sessionId);
    this.sessionByAccount.set(accountId, sessionId);
    const giveUp = () => {
      this.accounts.release(accountId, sessionId);
      if (this.sessionByAccount.get(accountId) === sessionId) this.sessionByAccount.delete(accountId);
    };

    let adventurer: Adventurer;
    let name: string;
    try {
      // Saves the older session (unless it was travelling: then this waits for the travel's own save).
      if (previous) await previous.room.kick(previous.sessionId);
      adventurer = await this.store.getOrCreateAdventurer(accountId);
      // onAuth refused unnamed adventurers already; names are never taken away, so this is a safeguard.
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      name = adventurer.name;
      // The same account joined again while this join was loading: the newer one wins.
      if (this.accounts.get(accountId)?.sessionId !== sessionId) {
        throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_SIGNED_IN_ELSEWHERE);
      }
      // It travelled (or was moved) to another zone after onAuth looked: that zone's room takes it.
      if (adventurer.zone !== this.zone.id) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
    } catch (err) {
      giveUp();
      throw err;
    }
    this.arrivals.delete(accountId);

    // Standing on the surface at the saved spot (the zone's spawn if nobody can stand there now), unless
    // the account's air track says it is still falling there (a re-join mid-air in this zone): then it
    // carries on falling. An air track from another zone means nothing here.
    const surface = this.zone.surface;
    const savedY = surface(adventurer.x, adventurer.z);
    const start = savedY === null ? this.zone.spawn : adventurer;
    const movement = this.allowanceFor(accountId);
    if (savedY === null || movement.air.grounded || movement.zone !== this.zone.id) {
      movement.air = makeAirTrack(savedY ?? surface(start.x, start.z) ?? 0);
    }
    movement.zone = this.zone.id;
    const y = movement.air.y + 0; // + 0: never -0 (terrain height can be), which state and messages encode differently
    const hp = clampHp(adventurer.hp);
    const player = new PlayerState({ name, x: start.x, z: start.z, y, facing: start.facing, moving: false, hp, maxHp: MAX_HP });
    this.sessions.set(sessionId, {
      client,
      accountId,
      adventurerId: adventurer.id,
      player,
      loadout: adventurer.loadout,
      lastGood: { x: start.x, z: start.z, y },
      movement,
      // A hurt adventurer waits out the regen delay again after joining: relogging never heals sooner.
      lastHurtAt: hp < MAX_HP ? Date.now() : -Infinity,
      tokens: MESSAGE_BURST,
      tokensAt: Date.now(),
      lastChatAt: -Infinity,
    });
    this.state.players.set(sessionId, player);
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
    if (this.rooms.get(this.zone.id) === this) this.rooms.delete(this.zone.id);
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.removeSession(sessionId)));
  }

  /**
   * Whether an account may join: it already has a seat here (its old session will be kicked) or one
   * kept for it as a traveller, or there is space beside everyone here and every traveller on the way.
   */
  canAdmit(accountId: string): boolean {
    const now = Date.now();
    let held = 0;
    for (const [id, until] of this.arrivals) {
      if (until <= now) this.arrivals.delete(id);
      else if (!this.sessionByAccount.has(id)) held++;
    }
    if (this.sessionByAccount.has(accountId) || this.arrivals.has(accountId)) return true;
    return this.sessionByAccount.size + held < this.maxPlayers;
  }

  /** Keeps a seat for an account travelling here, for the reconnect window or until it joins. */
  holdArrival(accountId: string): void {
    this.arrivals.set(accountId, Date.now() + this.reconnectSeconds * 1000);
  }

  /** Gives back a seat kept by holdArrival (the travel did not happen). */
  releaseArrival(accountId: string): void {
    this.arrivals.delete(accountId);
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
    if (!session || !pose || session.travelling) return;
    const now = Date.now();
    const movement = session.movement;
    movement.metres = refillAllowance(movement.metres, (now - movement.at) / 1000);
    movement.at = now;
    const { result, landedDrop } = checkPose(session.lastGood, movement.air, pose, now, movement.metres, this.zone.surface);
    if (result !== 'ok') {
      this.correct(session, now);
      return;
    }
    // Into an open exit (by the server's own, just-checked position): the move stands only if the
    // adventurer may go through.
    const exit = this.exitAt(pose.x, pose.z);
    const destination = exit && this.rooms.get(exit.to);
    if (exit && session.player.hp <= 0) {
      // The dead never travel (from Task 6 a death is saved as respawned, at the statue, first).
      this.correct(session, now);
      return;
    }
    if (exit && !destination?.canAdmit(session.accountId)) {
      this.correct(session, now);
      this.notice(session, zoneFullReason(exit.to), now);
      return;
    }
    const before = session.lastGood;
    movement.metres -= Math.hypot(pose.x - session.lastGood.x, pose.z - session.lastGood.z);
    session.lastGood = { x: pose.x, z: pose.z, y: pose.y };
    Object.assign(session.player, pose);
    const damage = fallDamage(landedDrop);
    if (damage > 0) this.hurt(session, damage, now);
    if (exit && destination) this.travel(session, exit, destination, before);
  }

  /** The open exit whose circle holds (x, z), if any. */
  private exitAt(x: number, z: number): ZoneExit | undefined {
    return this.zone.exits.find((e) => (x - e.x) * (x - e.x) + (z - e.z) * (z - e.z) <= e.r * e.r && this.isExitOpen(this.zone.id, e.to));
  }

  /**
   * Takes the adventurer through `exit`: one save puts it in the next zone at the exit's arrival point
   * (written only while it is still saved here), then the client is told and the session ends without
   * saving again. Until then its moves are ignored and a seat is kept in the next zone. If the save
   * fails, it stays here, back at `before` (its last pose outside the exit), with a notice.
   */
  private travel(session: Session, exit: ZoneExit, destination: ZoneRoom, before: Session['lastGood']) {
    const sessionId = session.client.sessionId;
    const { x, z, facing } = exit.arrive;
    destination.holdArrival(session.accountId);
    const travelling = (async () => {
      const saved = (await this.save(session, { zone: exit.to, x, z, facing })) === 'saved';
      if (this.sessions.get(sessionId) !== session) {
        // Kicked or gone while saving: that ended the session already, without saving over the travel.
        // If the travel was not saved either, save it here as it is (kick waits for this).
        if (!saved) {
          destination.releaseArrival(session.accountId);
          await this.save(session);
        }
        return;
      }
      if (!saved) {
        destination.releaseArrival(session.accountId);
        session.travelling = undefined;
        session.lastGood = before;
        Object.assign(session.player, before, { moving: false });
        this.correct(session, Date.now());
        this.notice(session, REASON_TRAVEL_FAILED, Date.now());
        return;
      }
      // Its height here means nothing there: it arrives standing (the next room's join places it).
      session.movement.zone = exit.to;
      await this.removeSession(sessionId, { save: false });
      if (session.reconnection) {
        // Away while it was saved: there is no client to tell. Ending the window makes a reconnect
        // fail, and the client's fresh join then asks GET /api/zone and finds the next zone.
        session.reconnection.reject(new Error('travelled'));
      } else {
        this.sendTo(session.client, 'travel', { zone: exit.to });
        session.client.leave(CloseCode.CONSENTED);
      }
    })().finally(() => this.travels.delete(sessionId));
    session.travelling = travelling;
    this.travels.set(sessionId, travelling);
  }

  /** Sends a notice line, unless the same one went to this adventurer within NOTICE_REPEAT_MS. */
  private notice(session: Session, text: string, now: number) {
    if (session.lastNotice?.text === text && now - session.lastNotice.at < NOTICE_REPEAT_MS) return;
    session.lastNotice = { text, at: now };
    this.sendTo(session.client, 'notice', { text });
  }

  /**
   * Sends the client back to its last accepted pose. In the air, that pose would soon be refused
   * itself (the arc runs out), so the adventurer is first landed on the ground below it, with the
   * fall's damage: the corrected pose is then one the next move can start from.
   */
  private correct(session: Session, now: number) {
    const air = session.movement.air;
    if (!air.grounded) {
      const { x, z } = session.lastGood;
      const groundY = (this.zone.surface(x, z) ?? air.y) + 0; // + 0: never -0
      const damage = fallDamage(landAirTrack(air, groundY));
      session.lastGood = { x, z, y: groundY };
      session.player.y = groundY;
      session.player.moving = false;
      if (damage > 0) this.hurt(session, damage, now);
    }
    this.sendTo(session.client, 'correct', { ...session.lastGood });
  }

  /** Takes `damage` hp from the adventurer, never the last one, and tells its client what was lost. */
  private hurt(session: Session, damage: number, now: number) {
    const amount = Math.min(damage, session.player.hp - 1);
    session.lastHurtAt = now;
    if (amount <= 0) return;
    session.player.hp -= amount;
    this.sendTo(session.client, 'hurt', { amount, cause: 'fall' });
  }

  /** Gives health back at HP_REGEN_PER_S to adventurers who have not been hurt for the regen delay. */
  private regenerate() {
    const now = Date.now();
    for (const session of this.sessions.values()) {
      const player = session.player;
      if (player.hp >= player.maxHp || now - session.lastHurtAt < this.hpRegenDelayMs) continue;
      player.hp = Math.min(player.maxHp, player.hp + (HP_REGEN_PER_S * REGEN_EVERY_MS) / 1000);
    }
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

  /**
   * Ends an account's older session in this room, connected or away; its adventurer is saved and
   * removed at once. A session that is travelling is not saved again: this waits for its travel's own
   * save to settle instead, so whoever kicked it then loads the adventurer where it really is.
   */
  async kick(sessionId: string) {
    const session = this.sessions.get(sessionId);
    const travel = this.travels.get(sessionId); // also for a session that already left mid-travel
    if (!session) {
      await travel;
      return;
    }
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
    await travel;
  }

  /** Takes the adventurer out of the room and saves it (not when it is travelling, or `save` is false); unknown sessions are ignored. */
  private async removeSession(sessionId: string, opts: { save?: boolean } = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (this.sessionByAccount.get(session.accountId) === sessionId) this.sessionByAccount.delete(session.accountId);
    this.state.players.delete(sessionId);
    if (session.travelling) {
      // The account stays held until the travel's save settles, so a sign-in meanwhile (anywhere)
      // kicks this claim and waits for that save, then loads the adventurer where it really is.
      const release = () => this.accounts.release(session.accountId, sessionId);
      void session.travelling.then(release, release);
      return;
    }
    this.accounts.release(session.accountId, sessionId);
    if (opts.save !== false) await this.save(session);
  }

  /**
   * Saves everyone here. A save the store refuses means the adventurer is no longer saved in this zone
   * (a travel that was written although the call failed): that session is sent on rather than left
   * playing unsaved; its client finds the right zone through GET /api/zone.
   */
  private async saveAll() {
    const here = [...this.sessions.values()].filter((session) => !session.travelling);
    await Promise.all(
      here.map(async (session) => {
        if ((await this.save(session)) !== 'refused') return;
        if (this.sessions.get(session.client.sessionId) === session && !session.travelling) await this.sendOn(session);
      }),
    );
  }

  /** Ends a session whose adventurer is saved in another zone now, without saving, telling the client why. */
  private async sendOn(session: Session) {
    if (session.reconnection) session.reconnection.reject(new Error(REASON_ELSEWHERE));
    await this.removeSession(session.client.sessionId, { save: false });
    if (!session.reconnection) {
      this.sendTo(session.client, 'notice', { text: REASON_ELSEWHERE });
      this.sendTo(session.client, 'kicked', { reason: REASON_ELSEWHERE });
      session.client.leave(CloseCode.CONSENTED);
    }
  }

  /**
   * Saves the adventurer as it is in this room (or with `to`'s zone and spot, for a travel), only while
   * it is still saved in this zone: 'saved' if written, 'refused' if the store says it is not (saved
   * elsewhere, or unknown), 'failed' if the store threw (logged).
   */
  private async save(session: Session, to?: Pick<AdventurerSave, 'zone' | 'x' | 'z' | 'facing'>): Promise<'saved' | 'refused' | 'failed'> {
    const { x, z, facing, hp } = session.player;
    const values: AdventurerSave = { id: session.adventurerId, x, z, facing, zone: this.zone.id, hp, loadout: session.loadout, ...to };
    try {
      return (await this.store.saveAdventurer(values, { zone: this.zone.id })) ? 'saved' : 'refused';
    } catch (err) {
      console.error('Saving an adventurer failed:', err);
      return 'failed';
    }
  }

  private sendTo<K extends keyof S2C>(client: Client, type: K, message: S2C[K]) {
    client.send(type, message);
  }

  /**
   * The account's allowance, shared by every room; a new one holds only the step slack, so joining
   * never banks distance. A new one's air track is set by the join.
   */
  private allowanceFor(accountId: string): Allowance {
    let allowance = this.accounts.allowances.get(accountId);
    if (!allowance) {
      allowance = { metres: STEP_SLACK, at: Date.now(), air: makeAirTrack(0), zone: this.zone.id };
      this.accounts.allowances.set(accountId, allowance);
    }
    return allowance;
  }

  /** Drops allowances of accounts that are online nowhere and have been still long enough to be full anyway. */
  private forgetIdleAllowances() {
    const now = Date.now();
    for (const [accountId, allowance] of this.accounts.allowances) {
      if (!this.accounts.get(accountId) && now - allowance.at > ALLOWANCE_FORGET_MS) this.accounts.allowances.delete(accountId);
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
 * The room class for one zone of one app. Joins are checked during matchmaking (static onAuth), so a
 * bad token, an adventurer without a name, one saved in another zone, or a full zone is refused over
 * HTTP before any seat or socket is opened.
 */
export function zoneRoomFor(options: ZoneRoomOptions, jwtSecret: string): typeof ZoneRoom {
  const zone = options.zone.id;
  return class extends ZoneRoom {
    static async onAuth(_token: string, joinOptions: unknown, _context: AuthContext) {
      const auth = await authenticate(options.store, jwtSecret, joinOptions);
      if (!auth) return false;
      const adventurer = await options.store.getOrCreateAdventurer(auth.accountId);
      if (adventurer.name === null) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_NAME_FIRST);
      if (adventurer.zone !== zone) throw new ServerError(ErrorCode.APPLICATION_ERROR, REASON_ELSEWHERE);
      const room = options.rooms.get(zone);
      if (room && !room.canAdmit(auth.accountId)) throw new ServerError(ErrorCode.APPLICATION_ERROR, zoneFullReason(zone));
      return auth;
    }
  };
}
