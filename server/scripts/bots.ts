// Load test: `count` guest adventurers join `--zone` (the grove by default; the Greenway for a server
// started with SG2_START_ZONE=greenway; GET /api/zone allows only 60 a minute per address), run about at TICK_HZ with the shared character
// controller (over that zone's height surface, jumping now and then) and chat every 20 s. With
// --stand they stand still instead (they still chat). Prints the patch rate the bots saw, the bytes a
// second each received (state patches and messages), the server's peak memory and step time (p95),
// and exits non-zero unless every bot stayed connected, the mean patch rate is at least 14 Hz, no
// legal step was corrected, no bot was ever left in the air without a pose it could send, and none
// was stuck for a second or more. The first few corrections are printed in full, with the pose the
// bot had sent (with --stand the patch rate is not checked: an unchanged state sends none). Bots do not fight; a knockback or a respawn only moves them (they adopt its ack), and
// one that dies stands still until it gets up.
// --warmup <s> waits that long after the last join before measuring (default 2), so walking bots
// have spread out over the zone; --cluster <m> keeps every bot within that many metres of where it
// joined (all join at the spawn: the worst case for interest management, everyone sees everyone).
// It also prints how many adventurers each bot had in its state (its view) and the online count field.
//   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60 [--zone greenway] [--stand] [--warmup 40] [--cluster 30]
// The server's auth limiter allows 10 logins per IP a minute by default: start it with a higher
// SG2_AUTH_RATE_PER_MIN (e.g. 1000) for a bot run.
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  INTEREST_RADIUS,
  RUN_SPEED,
  TICK_HZ,
  checkPose,
  isZoneId,
  makeAirTrack,
  makeBody,
  stepBody,
  zoneDef,
  type AirTrack,
  type Body,
  type S2C,
  type Surface,
  type ZoneId,
} from '@sg2/shared';

const MIN_MEAN_HZ = 14;
const CHAT_EVERY_MS = 20_000;
const JOINS_AT_ONCE = 10;
/** Still time after joining, so the server's movement allowance (0.5 m for a new session) fills up first. */
const SETTLE_MS = 1200;
/** Chance a grounded bot jumps on a given tick (about once every 4 s). */
const JUMP_CHANCE = 1 / 60;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:2570' },
    count: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
    stand: { type: 'boolean', default: false },
    zone: { type: 'string', default: 'grove' },
    warmup: { type: 'string', default: '2' },
    cluster: { type: 'string' },
  },
});
if (!isZoneId(values.zone)) {
  console.error('--zone must be grove or greenway');
  process.exit(2);
}
const zoneId: ZoneId = values.zone;
const stand = values.stand;
const url = values.url.replace(/\/$/, '');
const count = Number(values.count);
const seconds = Number(values.seconds);
const warmupMs = Number(values.warmup) * 1000;
const cluster = values.cluster === undefined ? Infinity : Number(values.cluster);
if (!Number.isInteger(count) || count < 1 || !(seconds > 0) || !(warmupMs >= 0) || !(cluster > 0)) {
  console.error('Usage: npm run bots -w server -- --url <server> --count <n> --seconds <s> [--warmup <s>] [--cluster <m>]');
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

class Bot {
  room!: Room<any, any>;
  name = '';
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
  /** Sent on to another zone (a respawn from the Greenway): not a failure. */
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

  constructor(readonly index: number) {}

  async join() {
    const res = await fetch(`${url}/api/guest`, { method: 'POST' });
    const body = (await res.json()) as { token?: string; name?: string; error?: string };
    if (!res.ok || !body.token) {
      const hint = res.status === 429 ? ' (start the server with a higher SG2_AUTH_RATE_PER_MIN)' : '';
      throw new Error(`guest login failed: ${res.status} ${body.error ?? ''}${hint}`);
    }
    this.name = body.name ?? `bot ${this.index}`;
    this.zone = zoneId;
    this.surface = zoneDef(this.zone).surface;
    this.room = await new Client(url).joinOrCreate(this.zone, { token: body.token });
    this.room.reconnection.enabled = false; // a drop is a failure, not something to ride out
    const connection = this.room.connection as unknown as { events: { onmessage?: (ev: { data: ArrayBuffer | string }) => void } };
    const onmessage = connection.events.onmessage;
    connection.events.onmessage = (ev) => {
      if (this.patches !== null) this.bytes += typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength;
      onmessage?.(ev);
    };
    this.room.onMessage('*', () => {}); // fx, self, credit, refused: not used by bots
    const moved = (to: { x: number; z: number; y: number }, seq: number) => {
      this.ack = seq;
      this.body = makeBody(to.x, to.z, this.surface);
      this.body.y = to.y;
      this.air = makeAirTrack(to.y);
    };
    this.room.onMessage('displaced', (m: S2C['displaced']) => { this.displacements++; moved(m.to, m.seq); });
    this.room.onMessage('respawned', (m: S2C['respawned']) => moved(m, m.seq));
    this.room.onMessage('travel', () => { this.travelled = true; });
    this.room.onMessage('correct', (m: { x: number; z: number; y: number }) => {
      this.corrections++;
      if (this.correctionLog.length < 5) this.correctionLog.push(`${this.name}: sent ${JSON.stringify(this.lastSent)}, corrected to ${JSON.stringify(m)}`);
      // go where the server says, standing, as the browser does
      this.body = makeBody(m.x, m.z, this.surface);
      this.body.y = m.y;
      this.air = makeAirTrack(m.y);
    });
    this.room.onMessage('hurt', (m: { amount: number }) => {
      this.hurts++;
      this.hurtHp += m.amount;
    });
    this.room.onMessage('chat', () => this.chatsHeard++);
    this.room.onMessage('kicked', (m: { reason: string }) => (this.disconnected ??= `kicked: ${m.reason}`));
    this.room.onDrop((code) => (this.disconnected ??= `dropped (code ${code})`));
    this.room.onLeave((code) => { if (!this.travelled) this.disconnected ??= `left (code ${code})`; });
    let wasDead = false;
    this.room.onStateChange(() => {
      if (this.patches !== null) this.patches++;
      const dead = this.room.state.players?.get(this.room.sessionId)?.dead === true;
      if (dead && !wasDead) this.deaths++;
      wasDead = dead;
    });
    const deadline = Date.now() + 10_000;
    let me;
    while (!(me = this.room.state.players?.get(this.room.sessionId))) {
      if (Date.now() > deadline) throw new Error(`${this.name} never appeared in the room`);
      await sleep(20);
    }
    this.body = makeBody(me.x, me.z, this.surface);
    this.air = makeAirTrack(this.body.y);
    this.home = { x: me.x, z: me.z };
  }

  /** Samples how many adventurers its state holds (itself included) and the zone's online count. */
  sampleView() {
    const state = this.room.state;
    this.viewSum += state.players?.size ?? 0;
    this.onlineSum += typeof state.online === 'number' ? state.online : state.players?.size ?? 0;
    this.viewSamples++;
  }

  private get dead(): boolean {
    return this.room.state.players?.get(this.room.sessionId)?.dead === true;
  }

  start() {
    const tick = 1000 / TICK_HZ;
    // Random offsets, so the bots' messages are spread over the tick and the chat interval.
    this.timers.push(setTimeout(() => this.timers.push(setInterval(() => this.step(), tick)), SETTLE_MS + Math.random() * tick));
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
   * late when the process is busy), capped by the controller. Turns away from walls, and from any
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
      const stepped = stepBody(body, { vx: Math.sin(heading) * RUN_SPEED, vz: Math.cos(heading) * RUN_SPEED, jump }, dt, this.surface);
      const moved = Math.hypot(body.x - this.body.x, body.z - this.body.z);
      // stuck against something (in the air it carries on regardless, so its fall keeps up with the clock)
      if (body.grounded && moved < RUN_SPEED * Math.min(dt, 0.25) * 0.5) continue;
      // bots stay in their zone: they turn away from its exits as from walls
      if (zoneDef(this.zone).exits.some((e) => Math.hypot(body.x - e.x, body.z - e.z) < e.r + 1.5)) continue;
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

  private chat() {
    if (this.travelled) return;
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
console.log(`All ${count} joined (${zones}); ${stand ? 'standing' : 'walking'} and chatting for ${seconds} s.`);
await sleep(warmupMs);

const healthSamples: Health[] = [];
let nearSum = 0, nearSamples = 0;
const sampler = setInterval(() => {
  void health().then((h) => healthSamples.push(h), () => {});
  const live = bots.filter((bot) => !bot.disconnected && !bot.travelled);
  for (const bot of live) bot.sampleView();
  // How many other bots really are within INTEREST_RADIUS (by their own positions): what a view should hold.
  let pairs = 0;
  for (const a of live) for (const b of live) if (a !== b && Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= INTEREST_RADIUS) pairs++;
  if (live.length) { nearSum += pairs / live.length; nearSamples++; }
}, 1000);
for (const bot of bots) bot.patches = 0;
const measureStart = performance.now();
await sleep(seconds * 1000);
const measured = (performance.now() - measureStart) / 1000;
const rates = bots.map((bot) => (bot.patches ?? 0) / measured);
clearInterval(sampler);
const final = await health();

const lost = bots.filter((bot) => bot.disconnected);
const corrections = bots.reduce((n, bot) => n + bot.corrections, 0);
const chatsHeard = bots.reduce((n, bot) => n + bot.chatsHeard, 0);
const jumps = bots.reduce((n, bot) => n + bot.jumps, 0);
const stalledTicks = bots.reduce((n, bot) => n + bot.stalledTicks, 0);
const airStalls = bots.reduce((n, bot) => n + bot.airStalls, 0);
const longestStall = Math.max(...bots.map((bot) => bot.longestStall));
const hurts = bots.reduce((n, bot) => n + bot.hurts, 0);
const hurtHp = bots.reduce((n, bot) => n + bot.hurtHp, 0);
const byteRates = bots.map((bot) => bot.bytes / measured);
const displacements = bots.reduce((n, bot) => n + bot.displacements, 0);
const deaths = bots.reduce((n, bot) => n + bot.deaths, 0);
const travelled = bots.filter((bot) => bot.travelled).length;
const tickMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.tickMs ?? 0));
const tickSamples = healthSamples.map(tickMs);
const patchMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.patchMs ?? 0));
const patchSamples = healthSamples.map(patchMs);
await Promise.all(bots.map((bot) => bot.stop()));

const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const min = Math.min(...rates);
const serverHz = healthSamples.map((h) => h.tickHz);
const peakRss = Math.max(final.peakRssMb, ...healthSamples.map((h) => h.peakRssMb));

console.log(`players: ${final.players}`);
console.log(`patch rate seen by bots: mean ${mean.toFixed(2)} Hz, min ${min.toFixed(2)} Hz (over ${measured.toFixed(1)} s)`);
if (serverHz.length) console.log(`server patch rate (/healthz, 5 s window): min ${Math.min(...serverHz)} Hz, max ${Math.max(...serverHz)} Hz`);
console.log(`server peak RSS: ${peakRss} MB`);
if (tickSamples.length) console.log(`server step time p95 (/healthz tickMs, 5 s window): max ${Math.max(...tickSamples)} ms, last ${tickMs(final)} ms`);
const loopSamples = healthSamples.map((h) => h.eventLoopP99Ms ?? 0);
if (loopSamples.length) console.log(`server event-loop delay p99 (/healthz eventLoopP99Ms, 5 s window): max ${Math.max(...loopSamples)} ms, last ${final.eventLoopP99Ms ?? 0} ms`);
if (patchSamples.length) console.log(`server patch time p95 (/healthz patchMs, 5 s window): max ${Math.max(...patchSamples)} ms, last ${patchMs(final)} ms`);
const sortedBytes = [...byteRates].sort((a, b) => a - b);
console.log(`received per bot: mean ${(byteRates.reduce((a, b) => a + b, 0) / byteRates.length / 1024).toFixed(1)} KiB/s, p95 ${(sortedBytes[Math.floor(sortedBytes.length * 0.95)] / 1024).toFixed(1)} KiB/s, max ${(sortedBytes[sortedBytes.length - 1] / 1024).toFixed(1)} KiB/s`);
const sampled = bots.filter((bot) => bot.viewSamples > 0);
const viewMean = sampled.reduce((n, bot) => n + bot.viewSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
const onlineMean = sampled.reduce((n, bot) => n + bot.onlineSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
console.log(`adventurers in each bot's view (itself included): mean ${viewMean.toFixed(1)}; other bots really within ${INTEREST_RADIUS} m: mean ${(nearSum / Math.max(1, nearSamples)).toFixed(1)}; online count it read: mean ${onlineMean.toFixed(1)}`);
console.log(`displacements: ${displacements}; deaths: ${deaths}; sent on to another zone: ${travelled}`);
console.log(`corrections: ${corrections}; disconnected bots: ${lost.length}; chat lines heard: ${chatsHeard}; jumps: ${jumps}`);
console.log(`falls that hurt: ${hurts} (${hurtHp} hp in all)`);
console.log(`ticks with no sendable pose: ${stalledTicks} (${airStalls} in the air); longest run: ${longestStall} ticks`);
for (const line of bots.flatMap((bot) => bot.correctionLog).slice(0, 5)) console.log(`  correction: ${line}`);
for (const line of bots.flatMap((bot) => bot.airStallLog ?? []).slice(0, 5)) console.log(`  stalled in the air: ${line}`);

const failures: string[] = [];
if (lost.length) failures.push(`${lost.length} bots disconnected (first: ${lost[0].name}, ${lost[0].disconnected})`);
// Standing bots change nothing, and an unchanged state sends no patches: the rate means nothing then.
if (!stand && !(mean >= MIN_MEAN_HZ)) failures.push(`mean patch rate ${mean.toFixed(2)} Hz is below ${MIN_MEAN_HZ} Hz`);
if (corrections) failures.push(`${corrections} legal steps were corrected`);
if (airStalls) failures.push(`${airStalls} ticks in the air had no pose the server would accept`);
if (longestStall >= TICK_HZ) failures.push(`a bot was stuck for ${longestStall} ticks in a row`);
console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
