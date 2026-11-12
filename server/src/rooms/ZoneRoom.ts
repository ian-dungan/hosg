// A zone room (one per zone): validated movement and height, fall damage, periodic saving, reconnect
// window, travel through open exits, one session per account across every room, and the zone's
// fight: the shared combat engine run on the room's tick, fed with validated intents, and mirrored
// to clients (state, per-client fx, `self`), with server-stamped dodges and knockbacks, death and respawn.
import { CloseCode, ErrorCode, Room, ServerError, type AuthContext, type Client, type Deferred } from '@colyseus/core';
import {
  ABILITIES,
  CHAT_MIN_INTERVAL_MS,
  DEATH_MIN_S,
  DISPLACE_FUZZ_M,
  DODGE_CHARGES,
  DODGE_REFILL_S,
  FX_RADIUS,
  MAX_HP,
  MAX_MOVE_ALLOWANCE,
  MOMENTUM_DECAY_PER_S,
  SPAWN,
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
  createCombat,
  zoneFullReason,
  type Carry,
  type Combat,
  type CombatantView,
  type DisplaceOut,
  type FxEvent,
  type Intent,
  type IntentAction,
  type Loadout,
  type Pose,
  type Refusal,
  type S2C,
  type SelfView,
  type TickOut,
  type ZoneDef,
  type ZoneExit,
  type ZoneId,
} from '@sg2/shared';
import { verifyToken } from '../auth/tokens';
import type { Adventurer, AdventurerSave, Store } from '../store/types';
import { PatchRateMeter } from './patchRate';
import type { Allowance, Presence } from './presence';
import { EnemyState as EnemySchema, PlayerState, TelegraphState as TelegraphSchema, ZoneState } from './state';

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
  /** Seed of the combat engine's generator. */
  combatSeed: number;
  /**
   * The combat clock, in seconds: monotonic and room-relative (never Date.now). Test-only; by default
   * each room uses performance.now() from its creation.
   */
  combatClock?: () => number;
  /** Seconds after a death before the adventurer gets up by itself (AUTO_RESPAWN_S; shorter in tests). */
  autoRespawnSeconds: number;
}

/** Where the dead get up again: the statue in this zone. */
const RESPAWN_ZONE: ZoneId = 'grove';
/** Most engine ticks one room step runs to catch its clock up (a stall, or a test clock running fast). */
const MAX_TICKS_PER_STEP = 16;
/** `self` goes to each owner every this many steps at most (TICK_HZ / 3 = 5 a second). */
const SELF_EVERY_STEPS = 3;
/** Window over which a room's step time p95 is measured (ms). */
const TICK_WINDOW_MS = 5000;
/** A failing step is logged at most this often (ms). */
const TICK_ERROR_LOG_MS = 60_000;
/**
 * How long a leaver's combat state (cooldowns, dodge charges, Momentum) is kept for its next join, in
 * ms: the longest cooldown anything has, plus a margin. After that everything would be ready anyway.
 */
const CARRY_KEEP_MS = (Math.max(...Object.values(ABILITIES).map((a) => a.cooldown), DODGE_REFILL_S * DODGE_CHARGES) + 5) * 1000;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round2 = (v: number) => Math.round(v * 100) / 100;
const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** A carry `seconds` older: cooldowns and the GCD run down, dodge charges refill, Momentum decays. */
function ageCarry(c: Carry, seconds: number): Carry {
  const s = Math.max(0, seconds);
  const cooldowns: Carry['cooldowns'] = {};
  for (const [id, left] of Object.entries(c.cooldowns) as [keyof Carry['cooldowns'], number][]) if (left - s > 0) cooldowns[id] = left - s;
  let charges = c.dodgeCharges, refill = c.dodgeRefillIn, rest = s;
  while (charges < DODGE_CHARGES && rest >= refill) { rest -= refill; charges++; refill = DODGE_REFILL_S; }
  return {
    cooldowns, gcd: Math.max(0, c.gcd - s), dodgeCharges: charges, dodgeRefillIn: charges < DODGE_CHARGES ? refill - rest : 0,
    momentum: Math.max(0, c.momentum - MOMENTUM_DECAY_PER_S * s),
  };
}

/** The point an fx event is heard from: its target, else its source. */
const fxFocus = (e: FxEvent): number => ('dst' in e && e.dst !== undefined ? e.dst : (e as { src: number }).src);
const fxInvolves = (e: FxEvent, id: number) => ('src' in e && e.src === id) || ('dst' in e && e.dst === id);

function enemyMode(v: CombatantView): string {
  if (!v.alive) return 'dead';
  if (v.act === 'return') return 'return';
  if (v.act === 'stun') return 'stunned';
  if (v.windup) return 'windup';
  return v.targetId !== null ? 'fight' : 'idle';
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
  /** Its id in the combat engine. */
  eid: number;
  /** Displacements (dodges, knockbacks, respawns) issued to this session: a move must carry this as its ack. */
  displaceSeq: number;
  /** A dodge was accepted and its displacement is not stamped yet: moves are ignored until it is. */
  awaitingDisplace: boolean;
  /** The last message that set displaceSeq, sent again on a reconnect (the client may have missed it). */
  lastSeqMessage?: { type: 'displaced'; message: S2C['displaced'] } | { type: 'respawned'; message: S2C['respawned'] };
  /** Everyone else sees the body travel a displacement's path, one sample a step. */
  anim?: { path: { x: number; z: number; y: number }[]; i: number };
  /** Dead (the engine said so): moves are ignored, and it is saved as respawned. deadAt is on the combat clock. */
  dead: boolean;
  deadAt: number;
  /** The death has been saved as respawned (at the statue in RESPAWN_ZONE), settling with the save. */
  deathSave?: Promise<void>;
  respawnSaved: boolean;
  /** The last `self` sent, as JSON ('' = none yet). */
  lastSelf: string;
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
  /** The zone's fight (public for tests and in-process tools). */
  combat!: Combat;
  /** The combat clock (seconds, monotonic). */
  private clockS!: () => number;
  private autoRespawnSeconds!: number;
  private sessionByEid = new Map<number, Session>();
  private steps = 0;
  /** Step times (ms) over the last TICK_WINDOW_MS, oldest first. */
  private tickTimes: { at: number; ms: number }[] = [];
  private lastTickErrorAt = -Infinity;
  /** The combat clock at the engine's last tick. */
  private lastTickAt = 0;
  /** Enemy and telegraph state keys, by engine id. */
  private keys = new Map<number, string>();
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
    this.autoRespawnSeconds = options.autoRespawnSeconds;
    const createdAt = performance.now();
    this.clockS = options.combatClock ?? (() => (performance.now() - createdAt) / 1000);
    this.lastTickAt = this.clockS();
    this.combat = createCombat(this.zone, { seed: options.combatSeed, nowS: this.lastTickAt });
    this.mirrorZone();
    this.rooms.set(this.zone.id, this);
    this.setPatchRate(1000 / TICK_HZ);

    this.onMessage('move', this.guard('move', (client, message) => this.onMove(client, message)));
    this.onMessage('chat', this.guard('chat', (client, message) => this.onChat(client, message)));
    this.onMessage('target', this.guard('target', (client, message) => this.onTarget(client, message)));
    this.onMessage('ability', this.guard('ability', (client, message) => this.onAbility(client, message)));
    this.onMessage('swap', this.guard('swap', (client) => this.onSwap(client)));
    this.onMessage('dodge', this.guard('dodge', (client, message) => this.onDodge(client, message)));
    this.onMessage('loadout', this.guard('loadout', (client, message) => this.onLoadout(client, message)));
    this.onMessage('respawn', this.guard('respawn', (client) => this.onRespawn(client)));
    this.clock.setInterval(() => {
      this.forgetIdleAllowances();
      void this.saveAll();
    }, options.saveSeconds * 1000);
    this.setSimulationInterval(() => this.step(), 1000 / TICK_HZ);
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
    // Combat state a relog keeps (cooldowns, dodge charges, Momentum), from its last session anywhere.
    const carry = this.takeCarry(accountId);
    const now = this.nowS();
    // A hurt adventurer waits out the regen delay again after joining: relogging never heals sooner.
    // The engine starts that delay only on damage, so it joins one point up and loses it at once.
    const hurt = hp < MAX_HP;
    const eid = this.combat.addAdventurer({ x: start.x, z: start.z, y, facing: start.facing, hp: hurt ? hp + 1 : hp, loadout: adventurer.loadout, carry }, now);
    if (hurt) this.combat.damage(eid, 1, now, 'fall');
    const loadout = this.combat.loadout(eid)!;
    const player = new PlayerState({
      name, x: start.x, z: start.z, y, facing: start.facing, moving: false, hp, maxHp: MAX_HP,
      eid, weapon: loadout.weapon, momentum: 0, target: -1, dead: false, act: '', shield: 0,
    });
    const session: Session = {
      client,
      accountId,
      adventurerId: adventurer.id,
      player,
      loadout,
      lastGood: { x: start.x, z: start.z, y },
      movement,
      eid,
      displaceSeq: 0,
      awaitingDisplace: false,
      dead: false,
      deadAt: -Infinity,
      respawnSaved: false,
      lastSelf: '',
      tokens: MESSAGE_BURST,
      tokensAt: Date.now(),
      lastChatAt: -Infinity,
    };
    this.sessions.set(sessionId, session);
    this.sessionByEid.set(eid, session);
    this.mirrorPlayer(session);
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
    // It may have missed the message that set the ack its moves must carry, and its `self` is stale.
    if (session.lastSeqMessage) this.sendTo(client, session.lastSeqMessage.type, session.lastSeqMessage.message as never);
    session.lastSelf = '';
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

  /** A pose a client sent: ignored while dead, travelling or being displaced, or with any ack but the latest. */
  private onMove(client: Client, message: unknown) {
    const session = this.sessions.get(client.sessionId);
    const pose = parsePose(message);
    if (!session || !pose || session.travelling || session.dead || session.awaitingDisplace) return;
    if (pose.ack !== session.displaceSeq) return; // sent before a displacement it has not applied yet (or forged): silent
    this.acceptPose(session, pose, Date.now());
  }

  /**
   * Checks a pose from the last accepted one (allowance at the engine's speed scale, height, walls) and
   * takes it, with any fall's damage, or corrects the client; true if taken. A pose into an open exit
   * starts the travel there.
   */
  private acceptPose(session: Session, pose: Pose, now: number): boolean {
    const movement = session.movement;
    movement.metres = refillAllowance(movement.metres, (now - movement.at) / 1000, this.combat.speedScale(session.eid, this.nowS()));
    movement.at = now;
    const { result, landedDrop } = checkPose(session.lastGood, movement.air, pose, now, movement.metres, this.zone.surface);
    if (result !== 'ok') {
      this.correct(session, now);
      return false;
    }
    // Into an open exit (by the server's own, just-checked position): the move stands only if the
    // adventurer may go through.
    const exit = this.exitAt(pose.x, pose.z);
    const destination = exit && this.rooms.get(exit.to);
    if (exit && session.dead) {
      this.correct(session, now); // the dead never travel (a death is saved as respawned, at the statue)
      return false;
    }
    if (exit && !destination?.canAdmit(session.accountId)) {
      this.correct(session, now);
      this.notice(session, zoneFullReason(exit.to), now);
      return false;
    }
    const before = session.lastGood;
    movement.metres -= Math.hypot(pose.x - session.lastGood.x, pose.z - session.lastGood.z);
    session.lastGood = { x: pose.x, z: pose.z, y: pose.y };
    session.anim = undefined;
    Object.assign(session.player, { x: pose.x, z: pose.z, y: pose.y, facing: pose.facing, moving: pose.moving });
    this.combat.setPose(session.eid, pose.x, pose.z, pose.y, pose.facing);
    const damage = fallDamage(landedDrop);
    if (damage > 0) this.fall(session, damage);
    if (exit && destination) this.travel(session, { to: exit.to, arrive: exit.arrive }, destination, before);
    return true;
  }

  // ───────── intents ─────────

  /** The session of a client that may act now (not travelling), or undefined. */
  private actor(client: Client): Session | undefined {
    const session = this.sessions.get(client.sessionId);
    return session && !session.travelling ? session : undefined;
  }

  /** Passes an intent to the engine; a refusal goes back to the client. True if accepted. */
  private intent(session: Session, action: IntentAction, intent: Intent): boolean {
    const refusal = this.combat.intent(session.eid, intent, this.nowS());
    if (refusal) this.refuse(session, action, refusal);
    return refusal === null;
  }

  private refuse(session: Session, action: IntentAction, reason: Refusal | 'stale') {
    this.sendTo(session.client, 'refused', { action, reason });
  }

  private onTarget(client: Client, message: unknown) {
    const session = this.actor(client);
    const id = (message as { id?: unknown } | null)?.id;
    if (!session || (id !== null && !Number.isSafeInteger(id))) return;
    if (this.intent(session, 'target', { t: 'target', id: id as number | null })) this.mirrorPlayer(session);
  }

  private onAbility(client: Client, message: unknown) {
    const session = this.actor(client);
    const { slot, phase } = (typeof message === 'object' && message !== null ? message : {}) as { slot?: unknown; phase?: unknown };
    if (!session || !Number.isSafeInteger(slot) || (phase !== 'press' && phase !== 'release')) return;
    this.intent(session, 'ability', { t: 'ability', slot: slot as number, phase });
  }

  private onSwap(client: Client) {
    const session = this.actor(client);
    if (session && this.intent(session, 'swap', { t: 'swap' })) this.takeLoadout(session);
  }

  private onLoadout(client: Client, message: unknown) {
    const session = this.actor(client);
    const free = (message as { free?: unknown } | null)?.free;
    if (!session || !Array.isArray(free) || free.length !== 2 || !free.every((f) => typeof f === 'string')) return;
    if (this.intent(session, 'loadout', { t: 'loadout', free: [free[0], free[1]] as Loadout['free'] })) this.takeLoadout(session);
  }

  /** The engine's loadout becomes the one saved with the adventurer. */
  private takeLoadout(session: Session) {
    session.loadout = this.combat.loadout(session.eid)!;
    session.player.weapon = session.loadout.weapon;
  }

  /**
   * A dodge: its starting pose is checked like any move first (and must carry the latest ack); a
   * refused pose is corrected and the dodge refused as 'stale'. The engine then rolls from it; the
   * room stamps the result on the next step.
   */
  private onDodge(client: Client, message: unknown) {
    const session = this.actor(client);
    const pose = parsePose(message);
    const { dx, dz } = (typeof message === 'object' && message !== null ? message : {}) as { dx?: unknown; dz?: unknown };
    if (!session || !pose || !finite(dx) || !finite(dz) || Math.abs(dx) > 1e6 || Math.abs(dz) > 1e6) return;
    if (session.dead) return this.refuse(session, 'dodge', 'dead');
    if (session.awaitingDisplace || pose.ack !== session.displaceSeq) return this.refuse(session, 'dodge', 'stale');
    if (!this.acceptPose(session, pose, Date.now())) return this.refuse(session, 'dodge', 'stale');
    if (session.travelling) return;
    const from = { ...session.lastGood };
    if (this.intent(session, 'dodge', { t: 'dodge', dx, dz, from, grounded: session.movement.air.grounded })) session.awaitingDisplace = true;
  }

  private onRespawn(client: Client) {
    const session = this.actor(client);
    if (!session) return;
    if (!session.dead) return this.refuse(session, 'respawn', 'invalid');
    if (this.nowS() - session.deadAt < DEATH_MIN_S - 1e-6) return this.refuse(session, 'respawn', 'cooldown');
    this.respawn(session);
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
  private travel(session: Session, exit: Pick<ZoneExit, 'to' | 'arrive'>, destination: ZoneRoom, before: Session['lastGood'], respawn = false) {
    const sessionId = session.client.sessionId;
    const { x, z, facing } = exit.arrive;
    destination.holdArrival(session.accountId);
    const travelling = (async () => {
      // A respawn elsewhere: the death may have been saved as respawned already (that is this travel's save).
      if (respawn) await session.deathSave;
      const saved = (respawn && session.respawnSaved) || (await this.save(session, { zone: exit.to, x, z, facing })) === 'saved';
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
        if (!respawn) {
          session.lastGood = before;
          Object.assign(session.player, before, { moving: false });
          this.combat.setPose(session.eid, before.x, before.z, before.y, session.player.facing);
          this.correct(session, Date.now());
        }
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
      this.combat.setPose(session.eid, x, z, groundY, session.player.facing);
      if (damage > 0) this.fall(session, damage);
    }
    this.sendTo(session.client, 'correct', { ...session.lastGood });
  }

  /**
   * Fall damage through the engine (never the last point; it restarts the regen delay); the client is
   * told the health it sees lost (hp shows as Math.ceil of the engine's).
   */
  private fall(session: Session, damage: number) {
    const shown = () => Math.ceil(this.combat.get(session.eid)?.hp ?? 0);
    const before = shown();
    this.combat.damage(session.eid, damage, this.nowS(), 'fall');
    const amount = before - shown();
    this.mirrorPlayer(session);
    if (amount > 0) this.sendTo(session.client, 'hurt', { amount, cause: 'fall' });
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
    this.leaveFight(session);
    if (session.travelling) {
      // The account stays held until the travel's save settles, so a sign-in meanwhile (anywhere)
      // kicks this claim and waits for that save, then loads the adventurer where it really is.
      const release = () => this.accounts.release(session.accountId, sessionId);
      void session.travelling.then(release, release);
      return;
    }
    this.accounts.release(session.accountId, sessionId);
    if (opts.save !== false && !this.savedElsewhere(session)) await this.save(session);
  }

  /**
   * Out of the engine (enemies drop it from their threat tables). A live adventurer's cooldowns,
   * dodge charges and Momentum are kept for the account's next join, in any zone.
   */
  private leaveFight(session: Session) {
    if (!this.sessionByEid.delete(session.eid)) return;
    const carry = session.dead ? undefined : this.combat.carryOf(session.eid);
    if (carry) this.accounts.carries.set(session.accountId, { carry, at: Date.now() });
    this.combat.removeAdventurer(session.eid);
  }

  /** The account's kept combat state, aged by the time since it left; forgotten once taken or after CARRY_KEEP_MS. */
  private takeCarry(accountId: string): Carry | undefined {
    const kept = this.accounts.carries.get(accountId);
    if (!kept) return undefined;
    this.accounts.carries.delete(accountId);
    const ago = Date.now() - kept.at;
    return ago < CARRY_KEEP_MS ? ageCarry(kept.carry, ago / 1000) : undefined;
  }

  /** A dead adventurer already saved as respawned in another zone: this room must not save it again. */
  private savedElsewhere(session: Session): boolean {
    return session.dead && session.respawnSaved && this.zone.id !== RESPAWN_ZONE;
  }

  /**
   * Saves everyone here. A save the store refuses means the adventurer is no longer saved in this zone
   * (a travel that was written although the call failed): that session is sent on rather than left
   * playing unsaved; its client finds the right zone through GET /api/zone.
   */
  private async saveAll() {
    const here = [...this.sessions.values()].filter((session) => !session.travelling && !this.savedElsewhere(session));
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
    // The dead are always saved as respawned: at the statue, with full health.
    const as = session.dead ? { zone: RESPAWN_ZONE, ...this.respawnSpot(), hp: MAX_HP } : to;
    const values: AdventurerSave = { id: session.adventurerId, x, z, facing, zone: this.zone.id, hp, loadout: session.loadout, ...as };
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

  /** Where the dead get up: the statue (RESPAWN_ZONE's spawn). */
  private respawnSpot(): { x: number; z: number; facing: number } {
    const { x, z, facing } = this.rooms.get(RESPAWN_ZONE)?.zone.spawn ?? SPAWN;
    return { x, z, facing };
  }

  // ───────── death and respawn ─────────

  /** The engine killed this adventurer: moves stop, and the death is saved as respawned at once. */
  private died(session: Session) {
    session.dead = true;
    session.deadAt = this.nowS();
    session.awaitingDisplace = false;
    session.anim = undefined;
    session.player.moving = false;
    if (session.travelling) return; // the travel's save saves it respawned
    const sessionId = session.client.sessionId;
    session.deathSave = this.save(session).then((result) => {
      if (result === 'saved' && this.sessions.get(sessionId) === session && session.dead) session.respawnSaved = true;
    });
  }

  /** Up again at the statue: revived here in RESPAWN_ZONE; from anywhere else, a travel there (one save). */
  private respawn(session: Session) {
    if (this.zone.id !== RESPAWN_ZONE) {
      const destination = this.rooms.get(RESPAWN_ZONE);
      if (!destination) return; // every zone's room exists while the server runs
      this.travel(session, { to: RESPAWN_ZONE, arrive: this.respawnSpot() }, destination, session.lastGood, true);
      return;
    }
    const { x, z, facing } = this.zone.spawn;
    const y = (this.zone.surface(x, z) ?? 0) + 0; // + 0: never -0
    this.combat.revive(session.eid, { x, z, y }, this.nowS());
    this.combat.setPose(session.eid, x, z, y, facing);
    Object.assign(session, { dead: false, deadAt: -Infinity, respawnSaved: false, deathSave: undefined, anim: undefined, awaitingDisplace: false });
    session.lastGood = { x, z, y };
    session.movement.air = makeAirTrack(y);
    session.movement.zone = this.zone.id;
    Object.assign(session.player, { x, z, y, facing, moving: false });
    // Poses sent while it was dead are stale now: the respawn starts a new ack.
    const message: S2C['respawned'] = { x, z, y, seq: ++session.displaceSeq };
    session.lastSeqMessage = { type: 'respawned', message };
    this.mirrorPlayer(session);
    this.sendTo(session.client, 'respawned', message);
  }

  // ───────── the step ─────────

  /** The combat clock now (seconds). */
  private nowS(): number {
    return this.clockS();
  }

  /** p95 of the room's step time over the last 5 s, in ms (0 before any step). */
  get tickMsP95(): number {
    this.forgetTicks(Date.now());
    if (this.tickTimes.length === 0) return 0;
    const sorted = this.tickTimes.map((t) => t.ms).sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  }

  private forgetTicks(now: number) {
    let old = 0;
    while (old < this.tickTimes.length && this.tickTimes[old].at <= now - TICK_WINDOW_MS) old++;
    if (old > 0) this.tickTimes.splice(0, old);
  }

  /** One room step, timed; a throw is logged (at most once a minute) and the room carries on. */
  private step() {
    const started = performance.now();
    try {
      this.advance();
    } catch (err) {
      const now = Date.now();
      if (now - this.lastTickErrorAt >= TICK_ERROR_LOG_MS) {
        this.lastTickErrorAt = now;
        console.error(`The ${this.zone.id} room's step failed (logged at most once a minute):`, err);
      }
    }
    const now = Date.now();
    this.tickTimes.push({ at: now, ms: performance.now() - started });
    this.forgetTicks(now);
  }

  /**
   * Runs the engine up to the combat clock (one tick per 1/TICK_HZ, at most MAX_TICKS_PER_STEP),
   * handling each tick's displacements, deaths and kills; then moves displaced bodies along their
   * paths, respawns the long dead, mirrors the state, and sends fx and `self`.
   */
  private advance() {
    const w0 = this.lastTickAt;
    const target = Math.max(this.nowS(), w0);
    const n = Math.min(MAX_TICKS_PER_STEP, Math.max(1, Math.round((target - w0) * TICK_HZ)));
    const fx: FxEvent[] = [];
    for (let k = 1; k <= n; k++) {
      const out = this.combat.tick(w0 + ((target - w0) * k) / n);
      this.handle(out);
      for (const e of out.fx) fx.push(e);
    }
    this.lastTickAt = target;
    this.steps++;
    for (const session of this.sessions.values()) {
      if (session.anim) this.animate(session);
      if (session.dead && !session.travelling && target - session.deadAt >= this.autoRespawnSeconds) this.respawn(session);
    }
    this.mirrorZone();
    for (const session of this.sessions.values()) this.mirrorPlayer(session);
    if (fx.length > 0) this.sendFx(fx);
    if (this.steps % SELF_EVERY_STEPS === 0) for (const session of this.sessions.values()) this.sendSelf(session);
  }

  private handle(out: TickOut) {
    for (const d of out.displaced) {
      const session = this.sessionByEid.get(d.id);
      if (session) this.displace(session, d);
    }
    for (const id of out.died) {
      const session = this.sessionByEid.get(id);
      if (session && !session.dead) this.died(session);
    }
    for (const kill of out.kills) {
      for (const id of kill.credit) {
        const session = this.sessionByEid.get(id);
        if (session) this.sendTo(session.client, 'credit', { kind: kill.kind });
      }
    }
  }

  /**
   * Stamps a displacement on the movement checks: a new ack, the end as the last accepted pose,
   * standing there, an allowance of at most a full one plus DISPLACE_FUZZ_M, and the falls on the way
   * charged; then tells the client, and everyone else sees the body travel the path.
   */
  private displace(session: Session, d: DisplaceOut) {
    if (!d.result.grounded) return; // no displacement (the engine sends none like this)
    const end = { x: d.result.x, z: d.result.z, y: d.result.y + 0 };
    const seq = ++session.displaceSeq;
    session.awaitingDisplace = false;
    session.lastGood = end;
    const movement = session.movement;
    const now = Date.now();
    movement.air = makeAirTrack(end.y);
    movement.metres = Math.min(refillAllowance(movement.metres, (now - movement.at) / 1000), MAX_MOVE_ALLOWANCE) + DISPLACE_FUZZ_M;
    movement.at = now;
    if (d.result.fallHp > 0) this.fall(session, d.result.fallHp);
    session.anim = { path: d.result.path, i: 1 };
    session.player.moving = false;
    const message: S2C['displaced'] = { seq, kind: d.kind, from: { ...d.from }, d: { ...d.d }, to: end };
    session.lastSeqMessage = { type: 'displaced', message };
    if (!session.reconnection) this.sendTo(session.client, 'displaced', message);
  }

  /** One path sample further along a displacement (one a step: the samples are 1/TICK_HZ apart). */
  private animate(session: Session) {
    const anim = session.anim!;
    const p = anim.path[Math.min(anim.i, anim.path.length - 1)];
    Object.assign(session.player, { x: p.x, z: p.z, y: p.y + 0 });
    if (++anim.i >= anim.path.length) {
      Object.assign(session.player, session.lastGood);
      session.anim = undefined;
    }
  }

  /** Each client gets the events that involve its adventurer, or happen within FX_RADIUS of it. */
  private sendFx(events: FxEvent[]) {
    const focus = events.map((e) => this.combat.get(fxFocus(e)) ?? null);
    const r2 = FX_RADIUS * FX_RADIUS;
    for (const session of this.sessions.values()) {
      if (session.reconnection) continue;
      const { x, z } = session.player;
      const mine = events.filter((e, i) => {
        if (fxInvolves(e, session.eid)) return true;
        const at = focus[i];
        return at !== null && (at.x - x) * (at.x - x) + (at.z - z) * (at.z - z) <= r2;
      });
      if (mine.length > 0) this.sendTo(session.client, 'fx', { events: mine });
    }
  }

  /** The owner's own numbers, when they changed since the last `self`. */
  private sendSelf(session: Session) {
    if (session.reconnection) return;
    const view = this.combat.self(session.eid);
    if (!view) return;
    const self: SelfView = {
      ...view, momentum: round2(view.momentum), cd: view.cd.map(round2), gcd: round2(view.gcd), swapCd: round2(view.swapCd),
      dodgeNextIn: round2(view.dodgeNextIn), charge: view.charge === null ? null : round2(view.charge),
    };
    const json = JSON.stringify(self);
    if (json === session.lastSelf) return;
    session.lastSelf = json;
    this.sendTo(session.client, 'self', self);
  }

  /** The engine's view of an adventurer onto its PlayerState (only fields that changed are set). */
  private mirrorPlayer(session: Session) {
    const v = this.combat.get(session.eid);
    if (!v) return;
    const p = session.player;
    const hp = v.alive ? Math.max(1, Math.ceil(v.hp)) : 0;
    if (p.hp !== hp) p.hp = hp;
    const dead = !v.alive;
    if (p.dead !== dead) p.dead = dead;
    if (p.act !== v.act) p.act = v.act;
    const target = v.targetId ?? -1;
    if (p.target !== target) p.target = target;
    const shield = byte(v.shield);
    if (p.shield !== shield) p.shield = shield;
    const momentum = byte(this.combat.self(session.eid)?.momentum ?? 0);
    if (p.momentum !== momentum) p.momentum = momentum;
    if (p.weapon !== session.loadout.weapon) p.weapon = session.loadout.weapon;
  }

  /** Enemies and telegraphs onto the state: fields set only when changed; telegraphs added once and deleted when gone. */
  private mirrorZone() {
    for (const v of this.combat.all()) {
      if (v.team !== 'enemy') continue;
      const key = this.keyOf(v.id);
      let e = this.state.enemies.get(key);
      if (!e) {
        e = new EnemySchema({
          eid: v.id, kind: v.kind, x: v.x, z: v.z, y: v.y, facing: v.facing, hp: Math.ceil(v.hp), maxHp: v.maxHp, stagger: 0,
          maxStagger: byte(v.maxStagger), marks: 0, mode: 'idle', target: -1, windup: '', windupTotal: 0,
        });
        this.state.enemies.set(key, e);
      }
      const hp = Math.ceil(v.hp), stagger = byte(v.stagger), mode = enemyMode(v), target = v.targetId ?? -1;
      const windup = v.windup?.attack ?? '', windupTotal = v.windup?.total ?? 0;
      if (e.x !== v.x) e.x = v.x;
      if (e.z !== v.z) e.z = v.z;
      if (e.y !== v.y) e.y = v.y;
      if (e.facing !== v.facing) e.facing = v.facing;
      if (e.hp !== hp) e.hp = hp;
      if (e.stagger !== stagger) e.stagger = stagger;
      if (e.marks !== v.marks) e.marks = v.marks;
      if (e.mode !== mode) e.mode = mode;
      if (e.target !== target) e.target = target;
      if (e.windup !== windup) e.windup = windup;
      if (e.windupTotal !== windupTotal) e.windupTotal = windupTotal;
    }
    const live = new Set<string>();
    for (const t of this.combat.telegraphs()) {
      const key = this.keyOf(t.id);
      live.add(key);
      if (this.state.telegraphs.has(key)) continue;
      const s = t.shape;
      this.state.telegraphs.set(key, new TelegraphSchema({
        id: t.id, owner: t.owner, attack: t.attack, shape: s.kind, x: s.x, z: s.z,
        dir: s.kind === 'circle' ? 0 : s.dir, r: s.kind === 'line' ? s.length : s.r,
        width: s.kind === 'line' ? s.width : 0, angle: s.kind === 'cone' ? s.angle : 0, total: t.total,
      }));
    }
    for (const key of [...this.state.telegraphs.keys()]) if (!live.has(key)) this.state.telegraphs.delete(key);
  }

  private keyOf(id: number): string {
    let key = this.keys.get(id);
    if (key === undefined) this.keys.set(id, (key = String(id)));
    return key;
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
    for (const [accountId, kept] of this.accounts.carries) if (now - kept.at >= CARRY_KEEP_MS) this.accounts.carries.delete(accountId);
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
