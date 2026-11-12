// Load test: `count` guest adventurers join `--zone` (the grove by default; the Greenway for a server
// started with SG2_START_ZONE=greenway), run about at TICK_HZ with the shared character
// controller (over that zone's height surface, jumping now and then) and chat every 20 s. With
// --stand they stand still instead (they still chat). Prints the patch rate the bots saw, the bytes a
// second each received (state patches and messages), the server's peak memory and step time (p95),
// and exits non-zero unless every bot stayed connected, the mean patch rate is at least 14 Hz, no
// legal step was corrected, no bot was ever left in the air without a pose it could send, and none
// was stuck for a second or more. The first few corrections are printed in full, with the pose the
// bot had sent. With --stand the patch rate is checked too: the state's `clock` changes every step, so
// even a room where nobody moves sends a patch each step. Bots do not fight; a knockback or a respawn
// only moves them (they adopt its ack), and one that dies stands still until it gets up.
// --warmup <s> waits that long after the last join before measuring (default 2), so walking bots
// have spread out over the zone; --cluster <m> keeps every bot within that many metres of where it
// joined (all join at the spawn: the worst case for interest management, everyone sees everyone).
// It also prints how many adventurers each bot had in its state (its view) and the online count field.
//
// --fight: bots that fight, with the shared brain (adventurerBrain, as the tuning simulation runs it).
// Each asks GET /api/zone (60 a minute per account) and joins that room; every 4th bot swaps to the Bow
// first, and every 5th (SPRINTERS) takes Sprint for its second free pick. In the
// Greenway, every tick it picks an enemy (its current one while it lives; else one attacking it; else the
// nearest live one within TARGET_RANGE that fewer than FIGHTERS_PER_ENEMY others in its view fight, one
// for an elite), or with none walks to the nearest camp it has not just visited (by findPath over the
// zone's ground) and waits just outside it. It builds a BrainInput from the state it sees (its interest
// view) and its last `self`, and does what the brain says: careful for 3 bots in 4, careless for the
// 4th; a few careless ones (ELITE_HUNTERS) go solo at a Mossback. Moves carry the ack of the latest
// `displaced`/`respawned` and are sent as the browser sends them: what its controller did, with no
// check of its own first (so any pose the server would wrongly refuse shows up as a correction).
// Most bots walk at WALK_SHARE of the allowed speed; sprinters walk at the full speed the browser uses
// (RUN_SPEED, ×SPRINT_SCALE from the moment Sprint's `use` arrives until SPRINT_EARLY_S before it ends,
// ×0.4 while charging) and press Sprint for long walks. A dodge waits for its `displaced` (or
// `refused`), and a displacement is played out (no poses) before it moves on from its end; PREDICTORS
// instead roll at once as the browser does (its own simulateDisplacement, rolled back on a refusal),
// see their `displaced`/`correct`/`refused`/`respawned` PREDICTOR_LAG_MS late (a slow downlink), and
// roll twice in a row when they have both charges: the second roll goes from the first's predicted
// end before the first's `displaced` has arrived, with the ack before it (the server's ownRollBefore).
// After a death it asks to respawn, wakes at the grove's statue, walks to the east gate and travels
// back. It passes only if every bot stayed connected, the mean patch rate is at least 14 Hz, no move
// was corrected (the `correct` that follows a dodge the engine refused is the protocol's rollback,
// counted apart by the refusal's reason, and only RACY_ROLLBACKS may cause one), no bot was stuck for
// TICK_HZ ticks in a row, credited kills >= 50, dodges >= 25, knockbacks >= 1, predicted second rolls
// sent early >= 1 and every one of them rolled, every bot that died is back in the Greenway or on its
// way, the zone step p95 <= 15 ms, peak RSS <= 400 MB, and no bot saw more than MAX_ENEMIES_PER_ZONE
// enemies.
// --cycle (implies --fight; for a 120 s run): also deaths >= 1 and at least one bot back in the
// Greenway after one (the whole death -> statue -> east gate -> Greenway cycle).
//   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60 [--zone greenway] [--stand] [--warmup 40] [--cluster 30] [--fight [--cycle]]
// The server's auth limiter allows 10 logins per IP a minute by default: start it with a higher
// SG2_AUTH_RATE_PER_MIN (e.g. 1000) for a bot run.
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  DEATH_MIN_S,
  DEFAULT_LOADOUT,
  DODGE_CHARGES,
  DODGE_MIN_GAP_S,
  ENEMY_ATTACKS,
  ENEMY_KINDS,
  GCD_S,
  GROVE_EAST_GATE,
  INTEREST_RADIUS,
  MAX_ENEMIES_PER_ZONE,
  RESPAWN_CLEAR_RADIUS,
  RUN_SPEED,
  SPRINT_S,
  SPRINT_SCALE,
  TARGET_RANGE,
  TICK_HZ,
  adventurerBrain,
  checkPose,
  dodgeDisplacement,
  findPath,
  greenwayLayout,
  inShape,
  isZoneId,
  makeAirTrack,
  makeBody,
  slotsFor,
  newBrainMemory,
  simulateDisplacement,
  stepBody,
  withClearance,
  zoneDef,
  type Act,
  type AirTrack,
  type Body,
  type BodyInput,
  type BodyStep,
  type BrainMemory,
  type CombatantView,
  type EnemyAttackId,
  type EnemyKindId,
  type S2C,
  type SelfView,
  type Shape,
  type Surface,
  type TelegraphView,
  type Vec2,
  type AbilityId,
  type WeaponId,
  type ZoneId,
} from '@sg2/shared';

const MIN_MEAN_HZ = 14;
const CHAT_EVERY_MS = 20_000;
const JOINS_AT_ONCE = 10;
/** Still time after joining, so the server's movement allowance (0.5 m for a new session) fills up first. */
const SETTLE_MS = 1200;
/** Chance a grounded bot jumps on a given tick (about once every 4 s). */
const JUMP_CHANCE = 1 / 60;
/** stepBody simulates at most 0.25 s a call: longer gaps between ticks are stepped in pieces of this. */
const BODY_STEP_MAX_S = 0.25;

// --fight
/** The fight run's pass marks. */
// (Ruling P3-i: the brief asked for dodges >= 100 and deaths >= 1 in 60 s, which 21 enemies on a 25 s
// respawn cannot give; deaths and the whole way back are gated by --cycle, on a 120 s run.)
const FIGHT_MIN = { kills: 50, dodges: 25, knocks: 1, earlyRolls: 1 };
/** With --cycle: at least this many deaths, and this many bots back in the Greenway after one. */
const CYCLE_MIN = { deaths: 1, returned: 1 };
/** Careless bots (by index) sent solo at a Mossback from the start, so that deaths happen. */
const ELITE_HUNTERS = [3, 7, 11];
const MAX_STEP_P95_MS = 15;
const MAX_PEAK_RSS_MB = 400;
/** Walking speed as a share of what the server allows (RUN_SPEED × its speed scale); sprinters walk at 1. */
const WALK_SHARE = 0.95;
/** Bots (by index mod 5) that walk at the browser's full speed and take Sprint (free picks Mend, Sprint). */
const SPRINTER = 0;
const SPRINTER_FREE: [AbilityId, AbilityId] = ['mend', 'sprint'];
/** The browser stops sprinting this long before Sprint ends (client/src/combat/controller.ts). */
const SPRINT_EARLY_S = 0.15;
/** A sprinter presses Sprint when its walk goal is farther than this. */
const SPRINT_FROM_M = 10;
/** Bots (by index mod 5) that predict their rolls as the browser does, with a slow downlink. */
const PREDICTOR = 2;
/** How late a predictor sees its `displaced`, `correct`, `refused` and `respawned` (by index: 450, 550, 650 ms). */
const predictorLagMs = (index: number) => 450 + (index % 3) * 100;
/**
 * Dodge refusals from the engine (after the server took the dodge's pose) that may follow a legal dodge,
 * so their rollback is no failure: only 'busy' (a knock landed between the press and the server). Any
 * other reason means the server took a dodge the engine then refused: a false rejection. ('dead' never
 * gets this far: the room refuses a dead adventurer's dodge itself, with no `correct`; 'air' cannot
 * follow a legal dodge from bots that never jump; 'charges' and 'cooldown' from the engine come with a
 * `correct` the bot counts as a correction, since the room's own check let the dodge through.)
 */
const RACY_ROLLBACKS = ['busy'];
/** Charged Shot slows to this from its press until it is released (the server: 0.4 from 0.25 s in). */
const CHARGE_WALK_SCALE = 0.4;
/** A dodge with no answer after this long is given up (the server resyncs a lost one after 1 s). */
const DODGE_WAIT_MS = 1500;
/** How many adventurers a bot lets fight one enemy (one elite) before it looks for another. */
const FIGHTERS_PER_ENEMY = 2;
const FIGHTERS_PER_ELITE = 1;
/** Path search settings for a bot's walks (camps, the grove's east gate): coarse, so cheap. */
const PATH_OPTS = { cell: 1, maxNodes: 60_000 };
/** Clearance kept from walls on a walk (as the browser's tap-to-walk). */
const PATH_CLEARANCE = 0.3;
/**
 * With nothing to fight, a bot waits CAMP_WAIT_MS at a spot this far outside a camp's edge, then moves
 * on; a camp it left is not walked to again for CAMP_REVISIT_MS.
 */
const CAMP_STANDOFF_M = 4;
const CAMP_WAIT_MS = 20_000;
const CAMP_REVISIT_MS = 30_000;
/** Ticks without a sendable step toward its goal before a bot searches a path around what blocks it. */
const STUCK_TICKS = 8;
/** A bot that died must have come this much nearer the Greenway in the last PROGRESS_MS to count as on its way. */
const PROGRESS_MS = 10_000;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:2570' },
    count: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
    stand: { type: 'boolean', default: false },
    zone: { type: 'string', default: 'grove' },
    warmup: { type: 'string', default: '2' },
    cluster: { type: 'string' },
    fight: { type: 'boolean', default: false },
    cycle: { type: 'boolean', default: false },
  },
});
if (!isZoneId(values.zone)) {
  console.error('--zone must be grove or greenway');
  process.exit(2);
}
const zoneId: ZoneId = values.zone;
const stand = values.stand;
const fight = values.fight || values.cycle;
const cycle = values.cycle;
const url = values.url.replace(/\/$/, '');
const count = Number(values.count);
const seconds = Number(values.seconds);
const warmupMs = Number(values.warmup) * 1000;
const cluster = values.cluster === undefined ? Infinity : Number(values.cluster);
if (!Number.isInteger(count) || count < 1 || !(seconds > 0) || !(warmupMs >= 0) || !(cluster > 0) || (fight && stand)) {
  console.error('Usage: npm run bots -w server -- --url <server> --count <n> --seconds <s> [--warmup <s>] [--cluster <m>] [--stand | --fight [--cycle]]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Health {
  players: number;
  tickHz: number;
  rssMb: number;
  peakRssMb: number;
  /** The server process's event-loop delay p99 over its last 5 s window (ms). */
  eventLoopP99Ms?: number;
  zones?: Record<string, { players: number; tickHz: number; tickMs?: number; patchMs?: number }>;
}

async function health(): Promise<Health> {
  const res = await fetch(`${url}/healthz`);
  if (!res.ok) throw new Error(`/healthz answered ${res.status}`);
  return (await res.json()) as Health;
}

/**
 * stepBody over any dt. One stepBody call simulates at most 0.25 s, so a timer that fires late (a busy
 * process) used to leave the body behind the clock: its jump arc then ran late against the server's
 * wall-clock ceiling and a legal pose was corrected. This steps the whole gap, in pieces. A jump is
 * pressed now, at the end of the gap (the last 1/TICK_HZ of it): the server takes an air phase to have
 * begun at most one send interval before its first pose in the air, so a take-off at the start of a long
 * gap would put the body further along its arc than the server's ceiling allows.
 */
function stepFor(b: Body, input: BodyInput, dt: number, surface: Surface): BodyStep {
  const out: BodyStep = { landed: false, drop: 0, jumped: false };
  let left = Math.min(Math.max(dt, 0), 5);
  const jumpAt = input.jump ? Math.min(left, 1 / TICK_HZ) : 0; // time left when the jump is pressed
  let jumpDone = !input.jump;
  while (left > 1e-9) {
    let h = Math.min(left, BODY_STEP_MAX_S);
    if (!jumpDone && left - h < jumpAt - 1e-9 && left > jumpAt + 1e-9) h = left - jumpAt; // stop where the jump is pressed
    const jump = !jumpDone && left <= jumpAt + 1e-9;
    if (jump) jumpDone = true;
    const s = stepBody(b, { ...input, jump }, h, surface);
    if (s.jumped) out.jumped = true;
    if (s.landed) { out.landed = true; out.drop = Math.max(out.drop, s.drop); }
    left -= h;
  }
  return out;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);


/** Where an adventurer may walk in a zone, with the tap-to-walk clearance (built once per zone). */
const walkable = new Map<ZoneId, (x: number, z: number) => boolean>();
function passableIn(zone: ZoneId) {
  let p = walkable.get(zone);
  if (!p) {
    const ground = zoneDef(zone).ground;
    p = withClearance((x, z) => ground(x, z) !== null, PATH_CLEARANCE);
    walkable.set(zone, p);
  }
  return p;
}

/** Every enemy any bot has seen (engine id → kind), and enemy deaths seen in fx (deduplicated across bots). */
const enemyKinds = new Map<number, string>();
const enemyDeathAt = new Map<number, number>();
let enemyDeaths = 0;
/** Kill credits by enemy kind. */
const killsByKind: Record<string, number> = {};
/** The most enemies one bot's state held at once. */
let mostEnemiesInView = 0;

/** The Greenway camps with an elite. */
let eliteCampList: number[] | null = null;
function eliteCamps(): number[] {
  return (eliteCampList ??= greenwayLayout().camps.flatMap((c, k) => (c.spawns.some((sp) => ENEMY_KINDS[sp.kind].elite) ? [k] : [])));
}

/** The shared Shape of a telegraph in the state (as the browser builds it). */
function telegraphShape(t: { shape: string; x: number; z: number; dir: number; r: number; width: number; angle: number }): Shape {
  if (t.shape === 'cone') return { kind: 'cone', x: t.x, z: t.z, dir: t.dir, r: t.r, angle: t.angle };
  if (t.shape === 'line') return { kind: 'line', x: t.x, z: t.z, dir: t.dir, length: t.r, width: t.width };
  return { kind: 'circle', x: t.x, z: t.z, r: t.r };
}

class Bot {
  room!: Room<any, any>;
  name = '';
  private token = '';
  /** Patches received while measuring (null: not measuring). */
  patches: number | null = null;
  corrections = 0;
  /** The first few corrections: what the bot last sent, and where the server put it. */
  correctionLog: string[] = [];
  jumps = 0;
  /** Health lost to falls, and how many falls cost any. */
  hurtHp = 0;
  hurts = 0;
  /** Ticks on which no step it tried would be accepted (it sent its first try anyway, as a client would). */
  stalledTicks = 0;
  /** Of those, ticks it was in the air: its check and the server's disagree with its own controller. */
  airStalls = 0;
  /** Longest run of stalled ticks in a row. */
  longestStall = 0;
  private stallRun = 0;
  private lastSent: unknown = null;
  /** The first stall in the air, in full: the body, the mirrored air track and why each try was refused. */
  airStallLog: string | null = null;
  private lastStepAt = 0;
  chatsHeard = 0;
  disconnected: string | null = null;
  /** Bytes received while measuring (patches and messages). */
  bytes = 0;
  displacements = 0;
  deaths = 0;
  /** Sent on to another zone (a respawn from the Greenway): not a failure. Without --fight it then stops. */
  travelled = false;
  zone: ZoneId = 'grove';
  private surface: Surface = zoneDef('grove').surface;
  /** The last displacement the server numbered: every pose carries it. */
  private ack = 0;
  private body: Body = makeBody(0, 0, this.surface);
  get position(): { x: number; z: number } { return this.body; }
  /** The server's view of this bot's height, so it only sends poses the server accepts. */
  private air: AirTrack = makeAirTrack(0);
  private heading = Math.random() * 2 * Math.PI;
  /** Where it joined: with --cluster it stays within that many metres of here. */
  private home = { x: 0, z: 0 };
  /** Sum and count of samples of how many adventurers its state held (its view), and of the online count. */
  viewSum = 0;
  onlineSum = 0;
  viewSamples = 0;
  private timers: NodeJS.Timeout[] = [];

  // --fight
  readonly careful: boolean;
  /** Sent solo at a Mossback (see ELITE_HUNTERS): it fights only an elite, and enemies that attack it. */
  readonly hunter: boolean;
  /** Times it was back in the Greenway after a death. */
  returned = 0;
  private memory: BrainMemory = newBrainMemory();
  private selfView: SelfView | null = null;
  private selfAt = 0;
  /** The target last sent (the state's lags a round trip behind). */
  private sentTarget: number | null = null;
  /** When it last pressed an ability (the GCD it starts is assumed until `self` shows it), and Charged Shot. */
  private pressedAt = -Infinity;
  private chargeSince: number | null = null;
  /** When it last sent a release: the charge counts as gone until a `self` sent after it arrives. */
  private releasedAt = -Infinity;
  /** What its last fight step walked at (for the correction log). */
  private lastScale = '';
  /** A dodge sent and not answered yet: no poses until its `displaced` or `refused`. */
  private dodgeSentAt: number | null = null;
  /** Playing a displacement out until then (performance.now ms): no poses. */
  private busyUntil = 0;
  /** A dodge the engine refused after taking its pose: the `correct` that follows is the rollback. */
  private rollbackDue = false;
  /** Not moving before this (a new session's movement allowance is still filling). */
  private settleUntil = 0;
  /** When each telegraph and each enemy's wind-up was first seen (performance.now ms), for `left`. */
  private telegraphSeen = new Map<number, number>();
  private windupSeen = new Map<number, { attack: string; at: number }>();
  /** The walk it is on (waypoints, the next one first) and where to. */
  private route: { goal: Vec2; points: Vec2[] } | null = null;
  private stuckTicks = 0;
  /** Camps visited (index → when), so a cleared camp is left alone until it can respawn. */
  private campVisited = new Map<number, number>();
  private campGoal: number | null = null;
  private campSpot: Vec2 | null = null;
  private campWaitFrom: number | null = null;
  /** Between rooms: the zone it is travelling to (it joins that room once this one has ended). */
  private switchingTo: ZoneId | null = null;
  private deadSince: number | null = null;
  private respawnAskedAt = 0;
  /** While it is on its way back after a death: when it was nearest the Greenway, and that progress. */
  diedAt: number | null = null;
  progressAt = 0;
  private bestProgress = Infinity;
  kills = 0;
  /** Telegraphs it stood inside at some tick. */
  inside = new Set<number>();
  dodgesSent = 0;
  dodgesRolled = 0;
  knocks = 0;
  resyncs = 0;
  rollbacks = 0;
  travels = 0;
  /** Displacements whose end the bot's own simulateDisplacement put more than 1 cm from the server's. */
  displaceMismatch = 0;
  refusals: Record<string, number> = {};
  fxEvents = 0;
  hpSeenMin = Infinity;

  /** Walks at the browser's full speed and has Sprint (SPRINTER). */
  readonly sprinter: boolean;
  /** Predicts its rolls, sees its displacements late and rolls twice (PREDICTOR). */
  readonly predictor: boolean;
  /** Its free picks. */
  private readonly free: [AbilityId, AbilityId];
  /** Sprinting (by the browser's rule: from Sprint's `use` fx) until then (performance.now ms). */
  private sprintUntil = -Infinity;
  /** A predictor's rolls sent and not answered yet, oldest first: where each went from and its predicted end. */
  private predictions: { from: { x: number; z: number; y: number }; end: { x: number; z: number; y: number }; early: boolean }[] = [];
  /** A predictor's second roll, due then (performance.now ms), in the first's direction. */
  private secondDodge: { at: number; dx: number; dz: number } | null = null;
  /** Second rolls sent before the first's `displaced` arrived (with the ack before it), and of those, rolled. */
  earlySent = 0;
  earlyRolled = 0;
  /** Sprints it used (by its `use` fx), and moves it sent while sprinting. */
  sprints = 0;
  sprintMoves = 0;
  /** What became of early second rolls that were not answered by their own `displaced` (for the log). */
  earlyLost: string[] = [];
  /** Drops the outstanding predictions (the server's displacement or correction wins), noting lost early rolls. */
  private dropPredictions(why: string) {
    for (const p of this.predictions) if (p.early) this.earlyLost.push(`${this.name}: ${why}`);
    this.predictions = [];
    this.secondDodge = null;
  }
  /** Rollbacks (a `correct` right after an engine refusal of a dodge) by the refusal's reason. */
  rollbacksByReason: Record<string, number> = {};
  private rollbackReason = '';
  /** The first time it was stuck for TICK_HZ ticks: where, and where to. */
  stallLog: string | null = null;

  constructor(readonly index: number) {
    this.careful = index % 4 !== 3;
    this.hunter = fight && ELITE_HUNTERS.includes(index);
    this.sprinter = fight && index % 5 === SPRINTER;
    this.predictor = fight && index % 5 === PREDICTOR;
    this.free = this.sprinter ? SPRINTER_FREE : [...DEFAULT_LOADOUT.free];
  }

  async join() {
    const res = await fetch(`${url}/api/guest`, { method: 'POST' });
    const body = (await res.json()) as { token?: string; name?: string; error?: string };
    if (!res.ok || !body.token) {
      const hint = res.status === 429 ? ' (start the server with a higher SG2_AUTH_RATE_PER_MIN)' : '';
      throw new Error(`guest login failed: ${res.status} ${body.error ?? ''}${hint}`);
    }
    this.name = body.name ?? `bot ${this.index}`;
    this.token = body.token;
    await this.connect(fight ? await this.askZone() : zoneId);
    // Loadout changes out of combat (saved with the adventurer, so they stay across travels): sprinters
    // take Sprint, and a quarter of the fighters use the Bow.
    if (this.sprinter) this.room.send('loadout', { free: this.free });
    if (fight && this.index % 4 === 1) this.room.send('swap', {});
  }

  /** GET /api/zone: the room to join (60 a minute per account, so every bot asks for itself). */
  private async askZone(): Promise<ZoneId> {
    const res = await fetch(`${url}/api/zone`, { headers: { authorization: `Bearer ${this.token}` } });
    const body = (await res.json()) as { zone?: unknown; error?: string };
    if (!res.ok || !isZoneId(body.zone)) throw new Error(`GET /api/zone failed: ${res.status} ${body.error ?? ''}`);
    return body.zone;
  }

  /** Joins `zone`'s room and waits until this adventurer is in its state. */
  private async connect(zone: ZoneId) {
    this.zone = zone;
    this.surface = zoneDef(this.zone).surface;
    this.ack = 0; // each session numbers its displacements from 0
    const room = await new Client(url).joinOrCreate(this.zone, { token: this.token });
    this.room = room;
    room.reconnection.enabled = false; // a drop is a failure, not something to ride out
    const connection = room.connection as unknown as { events: { onmessage?: (ev: { data: ArrayBuffer | string }) => void } };
    const onmessage = connection.events.onmessage;
    connection.events.onmessage = (ev) => {
      if (this.patches !== null) this.bytes += typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength;
      onmessage?.(ev);
    };
    room.onMessage('*', () => {});
    room.onMessage('self', (m: S2C['self']) => { this.selfView = m; this.selfAt = performance.now(); });
    room.onMessage('fx', (m: S2C['fx']) => this.onFx(m));
    room.onMessage('credit', (m: S2C['credit']) => { this.kills++; killsByKind[m.kind] = (killsByKind[m.kind] ?? 0) + 1; });
    // A predictor sees what moves it late (a slow downlink), all by the same lag, so in order.
    const lag = this.predictor ? predictorLagMs(this.index) : 0;
    const late = <T,>(fn: (m: T) => void) => (m: T) => {
      if (lag === 0) return fn(m);
      setTimeout(() => { if (this.room === room) fn(m); }, lag);
    };
    room.onMessage('refused', late((m: S2C['refused']) => this.onRefused(m)));
    const moved = (to: { x: number; z: number; y: number }, seq: number) => {
      this.ack = seq;
      this.body = makeBody(to.x, to.z, this.surface);
      this.body.y = to.y;
      this.air = makeAirTrack(to.y);
    };
    room.onMessage('displaced', late((m: S2C['displaced']) => {
      this.displacements++;
      if (m.kind === 'knock') this.knocks++;
      else if (m.kind === 'dodge') this.dodgesRolled++;
      else this.resyncs++;
      const predicted = m.kind === 'dodge' ? this.predictions.shift() : undefined;
      if (m.kind !== 'dodge') this.dropPredictions(`a ${m.kind} (seq ${m.seq}) came first`); // the server's displacement wins
      if (predicted) {
        // its own roll, already played: only the ack changes, unless the server's end is elsewhere
        if (predicted.early) this.earlyRolled++;
        this.ack = m.seq;
        const off = dist(predicted.end, m.to) > 0.01 || Math.abs(predicted.end.y - m.to.y) > 0.01;
        if (off) this.displaceMismatch++;
        if (this.predictions.length === 0) {
          this.dodgeSentAt = null;
          if (off) moved(m.to, m.seq);
        }
        return;
      }
      moved(m.to, m.seq);
      this.dodgeSentAt = null;
      if (m.kind !== 'resync') {
        // Played out (no poses) for as long as the push and any fall take; the end is the server's.
        const sim = simulateDisplacement(m.from, m.d, this.surface);
        if (dist(sim, m.to) > 0.01 || Math.abs(sim.y - m.to.y) > 0.01) this.displaceMismatch++;
        this.busyUntil = performance.now() + sim.seconds * 1000;
      }
    }));
    room.onMessage('respawned', late((m: S2C['respawned']) => { this.dropPredictions('respawned'); moved(m, m.seq); }));
    room.onMessage('travel', (m: S2C['travel']) => {
      if (!fight) { this.travelled = true; return; }
      this.switchingTo = m.zone;
      // The server ends the session itself; if it has not after 5 s, leave.
      this.timers.push(setTimeout(() => { if (this.room === room && this.switchingTo) void room.leave().catch(() => {}); }, 5000));
    });
    room.onMessage('correct', late((m: { x: number; z: number; y: number }) => {
      if (this.rollbackDue) {
        this.rollbackDue = false;
        this.rollbacks++;
        this.rollbacksByReason[this.rollbackReason] = (this.rollbacksByReason[this.rollbackReason] ?? 0) + 1;
      } else {
        this.corrections++;
        if (this.correctionLog.length < 5) this.correctionLog.push(`${this.name}: sent ${JSON.stringify(this.lastSent)}, corrected to ${JSON.stringify(m)}${fight ? ` (${this.lastScale})` : ''}`);
      }
      // go where the server says, standing, as the browser does
      this.dropPredictions(`corrected to ${JSON.stringify(m)}`);
      this.body = makeBody(m.x, m.z, this.surface);
      this.body.y = m.y;
      this.air = makeAirTrack(m.y);
    }));
    room.onMessage('hurt', (m: { amount: number }) => {
      this.hurts++;
      this.hurtHp += m.amount;
    });
    room.onMessage('chat', () => this.chatsHeard++);
    room.onMessage('kicked', (m: { reason: string }) => (this.disconnected ??= `kicked: ${m.reason}`));
    room.onDrop((code) => (this.disconnected ??= `dropped (code ${code})`));
    room.onLeave((code) => {
      if (this.room !== room) return;
      const next = this.switchingTo;
      if (next) {
        this.connect(next).then(
          () => { this.switchingTo = null; this.travels++; },
          (err) => { this.disconnected ??= `could not join ${next}: ${err instanceof Error ? err.message : err}`; },
        );
        return;
      }
      if (!this.travelled) this.disconnected ??= `left (code ${code})`;
    });
    let wasDead = false;
    room.onStateChange(() => {
      if (this.patches !== null) this.patches++;
      const me = room.state.players?.get(room.sessionId);
      const dead = me?.dead === true;
      if (dead && !wasDead) {
        this.deaths++;
        this.diedAt = performance.now();
        this.bestProgress = Infinity;
        this.progressAt = this.diedAt;
      }
      if (me && !dead) this.hpSeenMin = Math.min(this.hpSeenMin, me.hp);
      wasDead = dead;
    });
    const deadline = Date.now() + 10_000;
    let me;
    while (!(me = room.state.players?.get(room.sessionId))) {
      if (Date.now() > deadline) throw new Error(`${this.name} never appeared in the room`);
      await sleep(20);
    }
    // (Its start is read from the state: positions there are quantised, at most 0.8 cm from the server's.)
    this.body = makeBody(me.x, me.z, this.surface);
    this.air = makeAirTrack(this.body.y);
    this.home = { x: me.x, z: me.z };
    this.selfView = null;
    this.sentTarget = null;
    this.dodgeSentAt = null;
    this.busyUntil = 0;
    this.rollbackDue = false;
    this.predictions = [];
    this.secondDodge = null;
    this.sprintUntil = -Infinity;
    this.route = null;
    this.campGoal = null;
    this.deadSince = null;
    this.telegraphSeen.clear();
    this.windupSeen.clear();
    this.memory = newBrainMemory();
    this.settleUntil = performance.now() + SETTLE_MS;
    this.lastStepAt = 0;
    if (this.zone === 'greenway' && this.diedAt !== null) { this.returned++; this.diedAt = null; } // back where it fights
  }

  /** Samples how many adventurers its state holds (itself included) and the zone's online count. */
  sampleView() {
    const state = this.room.state;
    this.viewSum += state.players?.size ?? 0;
    this.onlineSum += typeof state.online === 'number' ? state.online : state.players?.size ?? 0;
    this.viewSamples++;
  }

  /** Between rooms (a travel): its room is ending or the next is being joined. */
  get switching(): boolean { return this.switchingTo !== null; }

  private get dead(): boolean {
    return this.room.state.players?.get(this.room.sessionId)?.dead === true;
  }

  start() {
    const tick = 1000 / TICK_HZ;
    // Random offsets, so the bots' messages are spread over the tick and the chat interval.
    this.timers.push(setTimeout(() => this.timers.push(setInterval(() => (fight ? this.fightStep() : this.step()), tick)), SETTLE_MS + Math.random() * tick));
    this.timers.push(
      setTimeout(() => {
        this.chat();
        this.timers.push(setInterval(() => this.chat(), CHAT_EVERY_MS));
      }, Math.random() * CHAT_EVERY_MS),
    );
  }

  /**
   * One tick of running in a wandering direction with the shared controller, jumping now and then.
   * Like a browser frame, it simulates the time that really passed since the last tick (timers run
   * late when the process is busy). Turns away from walls, and from any
   * step the server's own check would refuse; if every try is refused it sends the first anyway, as
   * a client would, and the server's correction puts it right.
   */
  private step() {
    if (stand || this.travelled || this.dead) return;
    const now = Date.now();
    const sinceLastStep = now - this.lastStepAt;
    const dt = this.lastStepAt ? sinceLastStep / 1000 : 1 / TICK_HZ;
    this.lastStepAt = now;
    const refusals: string[] = [];
    let first: { body: Body; next: { x: number; z: number; y: number; facing: number; moving: boolean; ack: number }; heading: number } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      // With --cluster, past 80% of the radius it heads back toward home (with the same wander).
      const fromHome = Math.hypot(this.body.x - this.home.x, this.body.z - this.home.z);
      const homeward = Math.atan2(this.home.x - this.body.x, this.home.z - this.body.z);
      const wander = fromHome > cluster * 0.8 ? homeward : this.heading;
      const heading = attempt === 0 ? wander + (Math.random() - 0.5) * 0.4 : Math.random() * 2 * Math.PI;
      const body = { ...this.body };
      const jump = attempt === 0 && Math.random() < JUMP_CHANCE;
      const stepped = stepFor(body, { vx: Math.sin(heading) * RUN_SPEED, vz: Math.cos(heading) * RUN_SPEED, jump }, dt, this.surface);
      const moved = Math.hypot(body.x - this.body.x, body.z - this.body.z);
      // stuck against something (in the air it carries on regardless, so its fall keeps up with the clock)
      if (body.grounded && moved < RUN_SPEED * Math.min(dt, 0.25) * 0.5) continue;
      // bots stay in their zone: they turn away from its exits as from walls
      if (this.nearExit(body)) continue;
      // and with --cluster, from the edge of their circle
      if (Math.hypot(body.x - this.home.x, body.z - this.home.z) > cluster && Math.hypot(body.x - this.home.x, body.z - this.home.z) > fromHome) continue;
      const next = { x: body.x, z: body.z, y: body.y, facing: heading, moving: true, ack: this.ack };
      first ??= { body, next, heading };
      const air = { ...this.air };
      // running speed is well inside the server's allowance, so only the height check can refuse it
      const checked = checkPose(this.body, air, next, now, Infinity, this.surface);
      if (checked.result !== 'ok') {
        refusals.push(`${checked.result} y ${body.y.toFixed(2)} surface ${this.surface(body.x, body.z)?.toFixed(2)}`);
        continue;
      }
      this.heading = heading;
      this.body = body;
      this.air = air;
      if (stepped.jumped) this.jumps++;
      this.room.send('move', next);
      this.lastSent = next;
      this.stallRun = 0;
      return;
    }
    this.stalledTicks++;
    if (!this.body.grounded) {
      this.airStalls++;
      this.airStallLog ??= `${this.name}: ${sinceLastStep} ms since the last tick, ${now - this.air.airStartMs} ms in the air; body ${JSON.stringify(this.body)}; track ${JSON.stringify(this.air)}; refused: ${refusals.join(' | ')}`;
    }
    this.longestStall = Math.max(this.longestStall, ++this.stallRun);
    if (first) {
      this.heading = first.heading;
      this.body = first.body;
      this.room.send('move', first.next);
      this.lastSent = first.next;
    }
  }

  private nearExit(p: { x: number; z: number }): boolean {
    return zoneDef(this.zone).exits.some((e) => Math.hypot(p.x - e.x, p.z - e.z) < e.r + 1.5);
  }

  // ───────── --fight ─────────

  private onFx(m: S2C['fx']) {
    this.fxEvents += m.events.length;
    const now = performance.now();
    const mine = this.room.state.players?.get(this.room.sessionId)?.eid;
    for (const e of m.events) {
      // the browser's rule: faster from Sprint's `use`, until a little before it ends
      if (e.t === 'use' && e.src === mine && e.ability === 'sprint') { this.sprintUntil = now + (SPRINT_S - SPRINT_EARLY_S) * 1000; this.sprints++; }
      if (e.t !== 'death' || !enemyKinds.has(e.dst)) continue;
      // every bot that sees it gets the event: count it once (an enemy waits at least 5 s to respawn)
      const last = enemyDeathAt.get(e.dst);
      if (last !== undefined && now - last < 5000) continue;
      enemyDeathAt.set(e.dst, now);
      enemyDeaths++;
    }
  }

  /** Rolls still waiting for their answer (at the end of a run: sent too late to hear back). */
  get predictionsLeft(): number { return this.predictions.filter((p) => p.early).length; }

  private onRefused(m: S2C['refused']) {
    const key = `${m.action} ${m.reason}`;
    this.refusals[key] = (this.refusals[key] ?? 0) + 1;
    if (m.action !== 'dodge') return;
    this.dodgeSentAt = null;
    // A predicted roll is undone, as the browser does: back where it was sent from (any later prediction
    // went from this one's end, so it goes too; its answer is taken as the server's own then).
    const undone = this.predictions.shift();
    if (undone) {
      if (undone.early) this.earlyLost.push(`${this.name}: refused ${m.reason}`);
      this.dropPredictions(`refused ${m.reason} (an earlier roll)`);
      this.body = makeBody(undone.from.x, undone.from.z, this.surface);
      this.body.y = undone.from.y;
      this.air = makeAirTrack(undone.from.y);
      this.busyUntil = 0;
    }
    // Refused by the engine after its pose was taken: a `correct` to that pose follows (the rollback).
    // 'stale', 'cooldown', 'charges', 'dead' (the room's own check) and 'rate' come alone (or after a
    // real correction). ('dead' from the engine also has a `correct`; the room's check comes first.)
    if (!['stale', 'cooldown', 'charges', 'dead', 'rate'].includes(m.reason)) {
      this.rollbackDue = true;
      this.rollbackReason = m.reason;
    }
  }

  /** Its own SelfView, its timers counted down from when it arrived (and the GCD of a press it sent since). */
  private agedSelf(now: number): SelfView | null {
    const s = this.selfView;
    if (!s) return null;
    const el = (now - this.selfAt) / 1000;
    const down = (v: number) => Math.max(0, v - el);
    const localGcd = Math.max(0, GCD_S - (now - this.pressedAt) / 1000);
    return {
      ...s, cd: s.cd.map(down), gcd: Math.max(down(s.gcd), localGcd), swapCd: down(s.swapCd), dodgeNextIn: down(s.dodgeNextIn),
      charge: s.charge === null || this.releasedAt + 150 >= this.selfAt ? null : s.charge + el,
    };
  }

  /** A fresh adventurer's own numbers (nothing used yet), with the weapon the state shows. */
  private freshSelf(weapon: string): SelfView {
    const w: WeaponId = weapon === 'bow' ? 'bow' : 'blade';
    const slots = slotsFor({ weapon: w, free: this.free });
    const localGcd = Math.max(0, GCD_S - (performance.now() - this.pressedAt) / 1000);
    return { momentum: 0, weapon: w, slots, cd: slots.map(() => 0), gcd: localGcd, swapCd: 0, swapLock: 0, dodgeCharges: DODGE_CHARGES, dodgeNextIn: 0, charge: null, inCombat: false };
  }

  /** The brain's view of an enemy in the state. */
  private enemyView(e: any, now: number): CombatantView {
    let windup: CombatantView['windup'] = null;
    if (e.windup) {
      const seen = this.windupSeen.get(e.eid);
      let at = seen && seen.attack === e.windup ? seen.at : null;
      if (at === null) {
        // a wind-up starts with the telegraph its enemy owns
        let el = 0;
        this.room.state.telegraphs?.forEach((t: any) => { if (t.owner === e.eid) el = Math.max(el, this.elapsedOf(t)); });
        this.windupSeen.set(e.eid, { attack: e.windup, at: (at = now - el * 1000) });
      }
      const attack = e.windup as EnemyAttackId;
      windup = { attack, total: e.windupTotal, left: Math.max(0, e.windupTotal - (now - at) / 1000), interruptible: ENEMY_ATTACKS[attack]?.interruptible ?? false };
    } else this.windupSeen.delete(e.eid);
    return {
      id: e.eid, team: 'enemy', kind: e.kind as EnemyKindId, x: e.x, z: e.z, y: e.y, facing: e.facing, hp: e.hp, maxHp: e.maxHp,
      alive: e.mode !== 'dead', shield: 0, marks: e.marks, stagger: e.stagger, maxStagger: e.maxStagger,
      targetId: e.target < 0 ? null : e.target, act: (e.mode === 'stunned' ? 'stun' : e.mode === 'return' ? 'return' : '') as Act,
      windup, surging: e.surging, staggerImmune: e.staggerImmune,
    };
  }

  /** How far along a telegraph is by the state's clock, in s (0 from a server without one). */
  private elapsedOf(t: { at?: number; total: number }): number {
    const clock = this.room.state.clock;
    if (typeof t.at !== 'number' || typeof clock !== 'number') return 0;
    return Math.max(0, Math.min(t.total, (clock - t.at) / TICK_HZ));
  }

  /** The live telegraphs it sees, each with the time left since it first saw it. */
  private telegraphs(now: number): TelegraphView[] {
    const out: TelegraphView[] = [];
    const live = new Set<number>();
    this.room.state.telegraphs?.forEach((t: any) => {
      live.add(t.id);
      let at = this.telegraphSeen.get(t.id);
      // its start by the server's clock (TelegraphState.at), so one first seen late is as far along as it really is
      if (at === undefined) this.telegraphSeen.set(t.id, (at = now - this.elapsedOf(t) * 1000));
      out.push({ id: t.id, owner: t.owner, attack: t.attack as EnemyAttackId, shape: telegraphShape(t), total: t.total, left: Math.max(0, t.total - (now - at) / 1000) });
    });
    for (const id of this.telegraphSeen.keys()) if (!live.has(id)) this.telegraphSeen.delete(id);
    return out;
  }

  /**
   * The enemy to fight: its current one while that lives within TARGET_RANGE + 5 m; else the nearest
   * live one (not walking home invulnerable) within TARGET_RANGE that fewer than FIGHTERS_PER_ENEMY
   * (FIGHTERS_PER_ELITE for an elite) other adventurers in its view already target, as players spread
   * over a camp. (100 bots on 21 enemies otherwise kill each one in about 2 s, before its first
   * telegraph: no dodging, no knockbacks, no deaths.) An enemy that targets it is fought whatever the count.
   */
  private chooseEnemy(): any {
    let best: any = null, bestD = TARGET_RANGE, current: any = null, attacker: any = null;
    const mine = this.room.state.players?.get(this.room.sessionId)?.eid;
    let n = 0;
    const claimed = new Map<number, number>();
    this.room.state.players?.forEach((p: any, id: string) => {
      if (id !== this.room.sessionId && !p.dead && p.target >= 0) claimed.set(p.target, (claimed.get(p.target) ?? 0) + 1);
    });
    this.room.state.enemies?.forEach((e: any) => {
      n++;
      if (!enemyKinds.has(e.eid)) enemyKinds.set(e.eid, e.kind);
      if (e.mode === 'dead' || e.mode === 'return') return;
      const d = dist(e, this.body);
      if (e.eid === this.sentTarget && d <= TARGET_RANGE + 5) current = e;
      if (e.target === mine && d <= TARGET_RANGE) attacker = e;
      const elite = ENEMY_KINDS[e.kind as EnemyKindId]?.elite === true;
      // a hunter takes only an elite (whoever else is on it); the others leave elites to one adventurer
      if (this.hunter ? !elite : (claimed.get(e.eid) ?? 0) >= (elite ? FIGHTERS_PER_ELITE : FIGHTERS_PER_ENEMY)) return;
      if (d <= bestD) { best = e; bestD = d; }
    });
    mostEnemiesInView = Math.max(mostEnemiesInView, n);
    return current ?? attacker ?? best;
  }

  /** One tick of a fighting bot (see the file comment). */
  private fightStep() {
    if (this.switching || this.disconnected) return;
    const now = performance.now();
    const dt = this.lastStepAt ? (now - this.lastStepAt) / 1000 : 1 / TICK_HZ;
    this.lastStepAt = now;
    const me = this.room.state.players?.get(this.room.sessionId);
    if (!me || now < this.settleUntil) return;
    if (me.dead) {
      this.deadSince ??= now;
      if (now - this.deadSince >= DEATH_MIN_S * 1000 + 300 && now - this.respawnAskedAt >= 1000) {
        this.respawnAskedAt = now;
        this.room.send('respawn', {});
      }
      return;
    }
    this.deadSince = null;
    // A predictor's second roll, due once the first (predicted) has played and the gap has passed: sent
    // from the first's predicted end, with whatever ack it has (the one before the first's, while that
    // `displaced` is still on its way).
    const second = this.secondDodge;
    if (second && now >= second.at && now >= this.busyUntil) {
      this.secondDodge = null;
      this.rollPredicted(second.dx, second.dz, now, this.predictions.length > 0);
      return;
    }
    if (this.dodgeSentAt !== null) {
      if (now - this.dodgeSentAt < DODGE_WAIT_MS) return;
      this.dodgeSentAt = null; // no answer: carry on (the server resyncs a lost one)
    }
    if (now < this.busyUntil) return;
    if (this.diedAt !== null) this.noteProgress(now);

    if (this.zone !== 'greenway') {
      // Back from a death (or started in the grove): to the east gate, and through it.
      this.maybeSprint(dist(GROVE_EAST_GATE, this.body), this.agedSelf(now) ?? this.freshSelf(me.weapon), now);
      this.walkRoute(GROVE_EAST_GATE, dt, now, 1, true);
      return;
    }

    const target = this.chooseEnemy();
    const targetId: number | null = target ? target.eid : null;
    if (targetId !== this.sentTarget) {
      this.sentTarget = targetId;
      this.room.send('target', { id: targetId });
    }
    // A `self` sent while the room was being joined can arrive before its handler is set (and the next
    // comes only when something changes): until one arrives it is a fresh adventurer.
    const sv = this.agedSelf(now) ?? this.freshSelf(me.weapon);
    const self: CombatantView & SelfView = {
      id: me.eid, team: 'adventurer', kind: 'adventurer', x: this.body.x, z: this.body.z, y: this.body.y, facing: this.heading,
      hp: me.hp, maxHp: me.maxHp, alive: !me.dead, shield: me.shield, marks: 0, stagger: 0, maxStagger: 0,
      targetId: me.target < 0 ? null : me.target, act: (me.act || '') as Act, windup: null, ...sv,
    };
    const telegraphs = this.telegraphs(now);
    for (const t of telegraphs) if (inShape(t.shape, this.body.x, this.body.z)) this.inside.add(t.id);
    const act = adventurerBrain({ nowS: now / 1000, careful: this.careful, self, target: target ? this.enemyView(target, now) : null, telegraphs }, this.memory);
    if (sv.charge === null && this.chargeSince !== null && now - this.chargeSince > 1000) this.chargeSince = null;
    const scale = this.chargeSince !== null || sv.charge !== null || me.act === 'charge' ? CHARGE_WALK_SCALE : 1;
    this.lastScale = `scale ${scale}, act '${me.act}', charge ${sv.charge}, pressed ${((now - this.pressedAt) / 1000).toFixed(2)} s ago, self ${((now - this.selfAt) / 1000).toFixed(2)} s old`;

    for (const i of act.intents) {
      if (i.t === 'ability') {
        if (i.phase === 'press') {
          this.pressedAt = now;
          if (sv.slots[i.slot] === 'charged_shot') this.chargeSince = now;
        } else this.releasedAt = now;
        this.room.send('ability', { slot: i.slot, phase: i.phase });
      } else if (i.t === 'dodge') {
        if (this.predictor) {
          // rolls at once (predicted), and again from its end after the gap when both charges are there
          this.rollPredicted(i.dx, i.dz, now, false);
          if (sv.dodgeCharges >= 2) this.secondDodge = { at: now + (DODGE_MIN_GAP_S + 0.03) * 1000, dx: i.dx, dz: i.dz };
          return;
        }
        // from where the body is (its last sent pose), with the latest ack; nothing more until it is answered
        this.dodgesSent++;
        this.dodgeSentAt = now;
        this.room.send('dodge', { x: this.body.x, z: this.body.z, y: this.body.y, facing: this.heading, moving: false, ack: this.ack, dx: i.dx, dz: i.dz });
        return;
      }
      // 'target' intents: it sends its own choice above
    }
    if (target) {
      this.route = null;
      this.campGoal = null;
      if (act.moveTo) {
        if (act.intents.length === 0) this.maybeSprint(dist(act.moveTo, this.body), sv, now);
        this.walkRoute(act.moveTo, dt, now, scale, false);
      }
      return;
    }
    // Nothing to fight in range: to the nearest camp not visited lately, where it waits a while at a
    // spot just outside it (clear of every spawn point, so it never holds a respawn up).
    const camps = greenwayLayout().camps;
    if (this.campGoal === null) {
      let best = -1, bestD = Infinity;
      camps.forEach((c, k) => {
        const visited = this.campVisited.get(k);
        if (visited !== undefined && now - visited < CAMP_REVISIT_MS) return;
        // the first walk spreads the bots over the camps; after that, the nearest
        // (a hunter: the Mossback camps only, the nearest first)
        const first = this.hunter ? (eliteCamps().includes(k) ? dist(c, this.body) : Infinity) : k === this.index % camps.length ? 0 : Infinity;
        const d = this.campVisited.size === 0 || this.hunter ? first : dist(c, this.body);
        if (d < bestD) { best = k; bestD = d; }
      });
      if (best < 0) { this.campVisited.clear(); return; }
      this.campGoal = best;
      this.campSpot = this.standOff(camps[best]);
      this.campWaitFrom = null;
    }
    const spot = this.campSpot!;
    if (dist(spot, this.body) < 1) {
      this.campWaitFrom ??= now;
      if (now - this.campWaitFrom >= CAMP_WAIT_MS) {
        this.campVisited.set(this.campGoal, now);
        this.campGoal = null;
        this.route = null;
      }
      return;
    }
    this.maybeSprint(dist(spot, this.body), sv, now);
    this.walkRoute(spot, dt, now, 1, false);
  }

  /** A sprinter presses Sprint for a walk longer than SPRINT_FROM_M, when it is ready (and not already on). */
  private maybeSprint(far: number, sv: SelfView, now: number) {
    if (!this.sprinter || far < SPRINT_FROM_M || now < this.sprintUntil) return;
    const slot = sv.slots.indexOf('sprint');
    if (slot < 0 || sv.gcd > 0 || sv.cd[slot] > 0 || now - this.pressedAt < 1000) return;
    this.pressedAt = now;
    this.room.send('ability', { slot, phase: 'press' });
  }

  /**
   * A predicted roll, as the browser rolls: sent from where the body is with its ack, and played at
   * once by its own simulateDisplacement (no poses until it is answered and has played). `early`: sent
   * while an earlier roll's `displaced` has not arrived.
   */
  private rollPredicted(dx: number, dz: number, now: number, early: boolean) {
    const from = { x: this.body.x, z: this.body.z, y: this.body.y };
    const sim = simulateDisplacement(from, dodgeDisplacement(dx, dz), this.surface);
    this.dodgesSent++;
    if (early) this.earlySent++;
    this.dodgeSentAt = now;
    this.room.send('dodge', { ...from, facing: Math.atan2(dx, dz), moving: true, ack: this.ack, dx, dz });
    const end = { x: sim.x, z: sim.z, y: sim.y };
    this.predictions.push({ from, end, early });
    this.body = makeBody(end.x, end.z, this.surface);
    this.body.y = end.y;
    this.air = makeAirTrack(end.y);
    this.busyUntil = now + sim.seconds * 1000;
  }

  /** A spot CAMP_STANDOFF_M from the camp's centre that it can stand on, at least RESPAWN_CLEAR_RADIUS + 1 m from every spawn point. */
  private standOff(c: { x: number; z: number; r: number }): Vec2 {
    const spawns = zoneDef('greenway').camps;
    const pass = passableIn('greenway');
    for (let k = 0; k < 24; k++) {
      const a = (this.index * 2.39996 + k * 0.7) % (2 * Math.PI);
      const p = { x: c.x + Math.sin(a) * (c.r + CAMP_STANDOFF_M), z: c.z + Math.cos(a) * (c.r + CAMP_STANDOFF_M) };
      if (pass(p.x, p.z) && !this.nearExit(p) && spawns.every((sp) => dist(sp, p) >= RESPAWN_CLEAR_RADIUS + 1)) return p;
    }
    return { x: c.x, z: c.z };
  }

  /**
   * One step toward `goal`: straight at it while that works, along a findPath route over the zone's
   * ground once it is stuck (or for a walk longer than a few metres). Sends the pose only if the
   * server's own check would take it (else it stays put). `intoExit`: it may walk into exit circles.
   */
  private walkRoute(goal: Vec2, dt: number, now: number, scale: number, intoExit: boolean) {
    if (this.route && dist(this.route.goal, goal) > 2) this.route = null;
    if (!this.route && (this.stuckTicks >= STUCK_TICKS || dist(goal, this.body) > 15)) {
      const points = findPath({ x: this.body.x, z: this.body.z }, goal, passableIn(this.zone), PATH_OPTS);
      this.route = { goal: { ...goal }, points: points ?? [] };
      this.stuckTicks = 0;
    }
    let to = goal;
    if (this.route) {
      while (this.route.points.length > 1 && dist(this.route.points[0], this.body) < 0.5) this.route.points.shift();
      to = this.route.points.length > 1 ? this.route.points[0] : goal;
    }
    const dx = to.x - this.body.x, dz = to.z - this.body.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    // the browser's speed: ×SPRINT_SCALE while it thinks Sprint is on (with any charge slow on top)
    const sprinting = now < this.sprintUntil ? SPRINT_SCALE : 1;
    const speed = Math.min(RUN_SPEED * scale * sprinting * (this.sprinter ? 1 : WALK_SHARE), d / Math.max(dt, 1e-3));
    // Straight at the next point; blocked (against a rock, say), it sidesteps as a player would, and
    // searches a new route from where that leaves it. No check of its own (as the browser): a pose the
    // server refuses is a correction, and fails the run. Nothing it can do moves it (or only into an
    // exit it should not take): a stall, and nothing is sent.
    const ahead = Math.atan2(dx, dz);
    let body: Body | null = null, facing = ahead;
    for (const turn of [0, 0.79, -0.79, 1.57, -1.57, 2.36, -2.36, 3.14]) {
      const h = ahead + turn;
      const b = { ...this.body };
      stepFor(b, { vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, jump: false }, dt, this.surface);
      if (dist(b, this.body) < speed * Math.min(dt, BODY_STEP_MAX_S) * 0.3 || (!intoExit && this.nearExit(b))) continue;
      body = b;
      facing = h;
      break;
    }
    if (!body) {
      this.stuckTicks++;
      this.stalledTicks++;
      this.longestStall = Math.max(this.longestStall, ++this.stallRun);
      if (this.stallRun === TICK_HZ) this.stallLog ??= `${this.name} in ${this.zone} at (${this.body.x.toFixed(1)}, ${this.body.z.toFixed(1)}) toward (${to.x.toFixed(1)}, ${to.z.toFixed(1)}), goal (${goal.x.toFixed(1)}, ${goal.z.toFixed(1)}), route ${this.route ? this.route.points.length : 'none'}`;
      if (this.stuckTicks >= STUCK_TICKS * 4) this.route = null; // the route itself is no good: search again
      return;
    }
    this.stallRun = 0;
    if (facing !== ahead) {
      // a sidestep: the way ahead is blocked, so after a few, a new route from here
      if (++this.stuckTicks >= STUCK_TICKS && this.stuckTicks % STUCK_TICKS === 0) this.route = null;
    } else this.stuckTicks = 0;
    const next = { x: body.x, z: body.z, y: body.y, facing, moving: true, ack: this.ack };
    this.heading = facing;
    this.body = body;
    if (sprinting > 1) this.sprintMoves++;
    this.room.send('move', next);
    this.lastSent = next;
  }

  /** For a bot on its way back after a death: how near the Greenway it is (grove: the gate; travelling counts as progress). */
  private noteProgress(now: number) {
    const left = this.zone === 'grove' ? dist(this.body, GROVE_EAST_GATE) : 0;
    if (left < this.bestProgress - 1) { this.bestProgress = left; this.progressAt = now; }
  }

  /** Died and is neither back in the Greenway nor getting nearer it (nor still lying dead, nor travelling). */
  stuckAfterDeath(now: number): boolean {
    if (this.diedAt === null || this.switching) return false;
    if (this.dead) return now - this.diedAt > 40_000; // it asks to respawn from 3 s on (the server wakes it at 30 s anyway)
    return now - this.progressAt > PROGRESS_MS;
  }

  private chat() {
    if (this.travelled || this.switching) return;
    this.room.send('chat', { text: `${this.name} says hello at ${new Date().toISOString().slice(11, 19)}` });
  }

  async stop() {
    for (const t of this.timers) clearTimeout(t);
    if (!this.disconnected) {
      this.disconnected = 'stopped';
      await this.room.leave().catch(() => {});
    }
  }
}

const bots = Array.from({ length: count }, (_, i) => new Bot(i));
console.log(`Joining ${count} bots to ${url} ...`);
try {
  for (let i = 0; i < count; i += JOINS_AT_ONCE) {
    await Promise.all(bots.slice(i, i + JOINS_AT_ONCE).map((bot) => bot.join()));
  }
} catch (err) {
  console.log(`FAIL: could not join all bots: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
bots.forEach((bot) => bot.start());
const zones = [...new Set(bots.map((bot) => bot.zone))].join(', ');
console.log(`All ${count} joined (${zones}); ${fight ? 'fighting' : stand ? 'standing' : 'walking'} and chatting for ${seconds} s.`);
await sleep(warmupMs);

const healthSamples: Health[] = [];
let nearSum = 0, nearSamples = 0;
/** Enemies alive that some bot sees, sampled every second (min, max). */
let aliveMin = Infinity, aliveMax = 0;
const sampler = setInterval(() => {
  void health().then((h) => healthSamples.push(h), () => {});
  const live = bots.filter((bot) => !bot.disconnected && !bot.travelled && !bot.switching);
  for (const bot of live) bot.sampleView();
  // How many other bots really are within INTEREST_RADIUS (by their own positions): what a view should hold.
  let pairs = 0;
  for (const a of live) for (const b of live) if (a !== b && a.zone === b.zone && Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= INTEREST_RADIUS) pairs++;
  if (live.length) { nearSum += pairs / live.length; nearSamples++; }
  if (fight) {
    const alive = new Set<number>();
    for (const bot of live) bot.room.state.enemies?.forEach((e: any) => { if (e.mode !== 'dead') alive.add(e.eid); });
    aliveMin = Math.min(aliveMin, alive.size);
    aliveMax = Math.max(aliveMax, alive.size);
  }
}, 1000);
for (const bot of bots) bot.patches = 0;
const measureStart = performance.now();
await sleep(seconds * 1000);
const measured = (performance.now() - measureStart) / 1000;
const rates = bots.map((bot) => (bot.patches ?? 0) / measured);
clearInterval(sampler);
const final = await health();
const endedAt = performance.now();

const lost = bots.filter((bot) => bot.disconnected);
const sum = (f: (bot: Bot) => number) => bots.reduce((n, bot) => n + f(bot), 0);
const corrections = sum((bot) => bot.corrections);
const chatsHeard = sum((bot) => bot.chatsHeard);
const jumps = sum((bot) => bot.jumps);
const stalledTicks = sum((bot) => bot.stalledTicks);
const airStalls = sum((bot) => bot.airStalls);
const longestStall = Math.max(...bots.map((bot) => bot.longestStall));
const hurts = sum((bot) => bot.hurts);
const hurtHp = sum((bot) => bot.hurtHp);
const byteRates = bots.map((bot) => bot.bytes / measured);
const displacements = sum((bot) => bot.displacements);
const deaths = sum((bot) => bot.deaths);
const travelled = bots.filter((bot) => bot.travelled).length;
const stuckAfterDeath = bots.filter((bot) => bot.stuckAfterDeath(endedAt));
const tickMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.tickMs ?? 0));
const tickSamples = healthSamples.map(tickMs);
const patchMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.patchMs ?? 0));
const patchSamples = healthSamples.map(patchMs);
const zoneNow = bots.reduce<Record<string, number>>((n, bot) => ((n[bot.switching ? 'travelling' : bot.zone] = (n[bot.switching ? 'travelling' : bot.zone] ?? 0) + 1), n), {});
await Promise.all(bots.map((bot) => bot.stop()));

const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const min = Math.min(...rates);
const serverHz = healthSamples.map((h) => h.tickHz);
const peakRss = Math.max(final.peakRssMb, ...healthSamples.map((h) => h.peakRssMb));
const maxStepP95 = tickSamples.length ? Math.max(...tickSamples) : tickMs(final);

console.log(`players: ${final.players}`);
console.log(`patch rate seen by bots: mean ${mean.toFixed(2)} Hz, min ${min.toFixed(2)} Hz (over ${measured.toFixed(1)} s)`);
if (serverHz.length) console.log(`server patch rate (/healthz, 5 s window): min ${Math.min(...serverHz)} Hz, max ${Math.max(...serverHz)} Hz`);
console.log(`server peak RSS: ${peakRss} MB`);
if (tickSamples.length) console.log(`server step time p95 (/healthz tickMs, 5 s window, worst zone): max ${Math.max(...tickSamples)} ms, last ${tickMs(final)} ms`);
const loopSamples = healthSamples.map((h) => h.eventLoopP99Ms ?? 0);
if (loopSamples.length) console.log(`server event-loop delay p99 (/healthz eventLoopP99Ms, 5 s window): max ${Math.max(...loopSamples)} ms, last ${final.eventLoopP99Ms ?? 0} ms`);
if (patchSamples.length) console.log(`server patch time p95 (/healthz patchMs, 5 s window): max ${Math.max(...patchSamples)} ms, last ${patchMs(final)} ms`);
const sortedBytes = [...byteRates].sort((a, b) => a - b);
console.log(`received per bot: mean ${(byteRates.reduce((a, b) => a + b, 0) / byteRates.length / 1024).toFixed(1)} KiB/s, p95 ${(sortedBytes[Math.floor(sortedBytes.length * 0.95)] / 1024).toFixed(1)} KiB/s, max ${(sortedBytes[sortedBytes.length - 1] / 1024).toFixed(1)} KiB/s`);
const sampled = bots.filter((bot) => bot.viewSamples > 0);
const viewMean = sampled.reduce((n, bot) => n + bot.viewSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
const onlineMean = sampled.reduce((n, bot) => n + bot.onlineSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
console.log(`adventurers in each bot's view (itself included): mean ${viewMean.toFixed(1)}; other bots really within ${INTEREST_RADIUS} m: mean ${(nearSum / Math.max(1, nearSamples)).toFixed(1)}; online count it read: mean ${onlineMean.toFixed(1)}`);
console.log(`displacements: ${displacements}; deaths: ${deaths}; sent on to another zone: ${fight ? sum((bot) => bot.travels) : travelled}`);
console.log(`corrections: ${corrections}; disconnected bots: ${lost.length}; chat lines heard: ${chatsHeard}; jumps: ${jumps}`);
console.log(`falls that hurt: ${hurts} (${hurtHp} hp in all)`);
console.log(`ticks with no sendable pose: ${stalledTicks} (${airStalls} in the air); longest run: ${longestStall} ticks`);
for (const line of bots.flatMap((bot) => bot.correctionLog).slice(0, 5)) console.log(`  correction: ${line}`);
for (const line of bots.flatMap((bot) => bot.airStallLog ?? []).slice(0, 5)) console.log(`  stalled in the air: ${line}`);
for (const line of bots.flatMap((bot) => bot.stallLog ?? []).slice(0, 5)) console.log(`  stuck for ${TICK_HZ} ticks: ${line}`);
for (const line of bots.flatMap((bot) => [...bot.earlyLost, ...(bot.predictionsLeft ? [`${bot.name}: ${bot.predictionsLeft} still unanswered at the end`] : [])]).slice(0, 5)) console.log(`  early second roll not rolled: ${line}`);

const kills = sum((bot) => bot.kills);
const dodges = sum((bot) => bot.dodgesRolled);
const knocks = sum((bot) => bot.knocks);
const returned = sum((bot) => bot.returned);
const rollbacksByReason: Record<string, number> = {};
for (const bot of bots) for (const [k, v] of Object.entries(bot.rollbacksByReason)) rollbacksByReason[k] = (rollbacksByReason[k] ?? 0) + v;
const falseRollbacks = Object.entries(rollbacksByReason).filter(([k]) => !RACY_ROLLBACKS.includes(k));
const earlySent = sum((bot) => bot.earlySent);
const earlyRolled = sum((bot) => bot.earlyRolled);
if (fight) {
  const refusals: Record<string, number> = {};
  for (const bot of bots) for (const [k, v] of Object.entries(bot.refusals)) refusals[k] = (refusals[k] ?? 0) + v;
  const carelessDeaths = sum((bot) => (bot.careful ? 0 : bot.deaths));
  console.log(`fight (over the whole run): kills credited ${kills} ${JSON.stringify(killsByKind)} (enemy deaths seen: ${enemyDeaths}); deaths ${deaths} (${carelessDeaths} careless, ${deaths - carelessDeaths} careful)`);
  console.log(`  dodges sent ${sum((bot) => bot.dodgesSent)}, rolled ${dodges}; knockbacks ${knocks}; resyncs ${sum((bot) => bot.resyncs)}; dodge rollbacks (correct after an engine refusal) ${sum((bot) => bot.rollbacks)} ${JSON.stringify(rollbacksByReason)}; displacement ends off the bot's own simulation ${sum((bot) => bot.displaceMismatch)}`);
  console.log(`  predictors (${bots.filter((bot) => bot.predictor).length}): second rolls sent before the first's displaced ${earlySent}, rolled ${earlyRolled}; sprinters: ${bots.filter((bot) => bot.sprinter).length} at full speed, ${sum((bot) => bot.sprints)} sprints, ${sum((bot) => bot.sprintMoves)} moves sent sprinting`);
  console.log(`  telegraphs a bot stood in: ${sum((bot) => bot.inside.size)} (careful bots: ${sum((bot) => (bot.careful ? bot.inside.size : 0))})`);
  console.log(`  back in the Greenway after a death (respawn at the statue, walk to the east gate, travel): ${returned}; hunters' deaths ${sum((bot) => (bot.hunter ? bot.deaths : 0))}`);
  console.log(`  travels ${sum((bot) => bot.travels)}; where the bots are at the end: ${JSON.stringify(zoneNow)}; died and not on their way back: ${stuckAfterDeath.length}`);
  console.log(`  refusals: ${Object.keys(refusals).length ? Object.entries(refusals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`);
  console.log(`  enemies alive (seen by some bot, sampled each second): min ${aliveMin === Infinity ? 0 : aliveMin}, max ${aliveMax}; enemies ever seen ${enemyKinds.size}; most in one bot's view ${mostEnemiesInView}`);
  console.log(`  fx events per bot a second: ${(sum((bot) => bot.fxEvents) / count / Math.max(1, measured + warmupMs / 1000)).toFixed(2)}; lowest hp a bot was seen alive at: ${Math.min(...bots.map((bot) => bot.hpSeenMin))}`);
}

const failures: string[] = [];
if (lost.length) failures.push(`${lost.length} bots disconnected (first: ${lost[0].name}, ${lost[0].disconnected})`);
// (Standing bots too: the state's `clock` changes every step, so a patch goes out every step.)
if (!(mean >= MIN_MEAN_HZ)) failures.push(`mean patch rate ${mean.toFixed(2)} Hz is below ${MIN_MEAN_HZ} Hz`);
if (corrections) failures.push(`${corrections} legal steps were corrected`);
if (airStalls) failures.push(`${airStalls} ticks in the air had no pose the server would accept`);
if (longestStall >= TICK_HZ) failures.push(`a bot was stuck for ${longestStall} ticks in a row`);
if (fight) {
  if (kills < FIGHT_MIN.kills) failures.push(`${kills} kills credited, fewer than ${FIGHT_MIN.kills}`);
  if (dodges < FIGHT_MIN.dodges) failures.push(`${dodges} dodges rolled, fewer than ${FIGHT_MIN.dodges}`);
  if (knocks < FIGHT_MIN.knocks) failures.push(`${knocks} knockbacks, fewer than ${FIGHT_MIN.knocks}`);
  if (falseRollbacks.length) failures.push(`dodge rollbacks for reasons that cannot follow a legal dodge: ${falseRollbacks.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (earlySent < FIGHT_MIN.earlyRolls) failures.push(`${earlySent} predicted second rolls sent before the first's displaced, fewer than ${FIGHT_MIN.earlyRolls}`);
  if (sum((bot) => bot.sprintMoves) < 1) failures.push('no move was sent at Sprint speed');
  if (earlyRolled < earlySent) failures.push(`${earlySent - earlyRolled} of ${earlySent} predicted second rolls were not rolled`);
  if (cycle && deaths < CYCLE_MIN.deaths) failures.push(`${deaths} deaths, fewer than ${CYCLE_MIN.deaths}`);
  if (cycle && returned < CYCLE_MIN.returned) failures.push(`${returned} bots back in the Greenway after a death, fewer than ${CYCLE_MIN.returned}`);
  if (stuckAfterDeath.length) failures.push(`${stuckAfterDeath.length} bots died and are not on their way back (first: ${stuckAfterDeath[0].name}, in ${stuckAfterDeath[0].zone})`);
  if (!(maxStepP95 <= MAX_STEP_P95_MS)) failures.push(`zone step p95 reached ${maxStepP95} ms (over ${MAX_STEP_P95_MS})`);
  if (!(peakRss <= MAX_PEAK_RSS_MB)) failures.push(`peak RSS ${peakRss} MB (over ${MAX_PEAK_RSS_MB})`);
  if (mostEnemiesInView > MAX_ENEMIES_PER_ZONE || enemyKinds.size > MAX_ENEMIES_PER_ZONE) failures.push(`more than ${MAX_ENEMIES_PER_ZONE} enemies (${Math.max(mostEnemiesInView, enemyKinds.size)})`);
}
console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
