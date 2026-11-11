// Load test: `count` guest adventurers join the grove, run about at TICK_HZ with the shared character
// controller (over the grove's height surface, jumping now and then) and chat every 20 s. Prints the patch rate the bots saw and the server's peak memory, and exits non-zero
// unless every bot stayed connected, the mean patch rate is at least 14 Hz and no legal step was
// corrected.
//   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60
// The server's auth limiter allows 10 logins per IP a minute by default: start it with a higher
// SG2_AUTH_RATE_PER_MIN (e.g. 1000) for a bot run.
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  RUN_SPEED,
  TICK_HZ,
  checkPose,
  groveTownSurface,
  makeAirTrack,
  makeBody,
  stepBody,
  type AirTrack,
  type Body,
} from '@sg2/shared';

const MIN_MEAN_HZ = 14;
const CHAT_EVERY_MS = 20_000;
const JOINS_AT_ONCE = 10;
/** Still time after joining, so the server's movement allowance (0.5 m for a new session) fills up first. */
const SETTLE_MS = 1200;
/** Time between the last join and the start of measuring. */
const WARMUP_MS = 2000;
/** Chance a grounded bot jumps on a given tick (about once every 4 s). */
const JUMP_CHANCE = 1 / 60;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:2570' },
    count: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
  },
});
const url = values.url.replace(/\/$/, '');
const count = Number(values.count);
const seconds = Number(values.seconds);
if (!Number.isInteger(count) || count < 1 || !(seconds > 0)) {
  console.error('Usage: npm run bots -w server -- --url <server> --count <n> --seconds <s>');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Health {
  players: number;
  tickHz: number;
  rssMb: number;
  peakRssMb: number;
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
  jumps = 0;
  chatsHeard = 0;
  disconnected: string | null = null;
  private body: Body = makeBody(0, 0, groveTownSurface);
  /** The server's view of this bot's height, so it only sends poses the server accepts. */
  private air: AirTrack = makeAirTrack(0);
  private heading = Math.random() * 2 * Math.PI;
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
    this.room = await new Client(url).joinOrCreate('grove', { token: body.token });
    this.room.reconnection.enabled = false; // a drop is a failure, not something to ride out
    this.room.onMessage('correct', () => this.corrections++);
    this.room.onMessage('chat', () => this.chatsHeard++);
    this.room.onMessage('kicked', (m: { reason: string }) => (this.disconnected ??= `kicked: ${m.reason}`));
    this.room.onDrop((code) => (this.disconnected ??= `dropped (code ${code})`));
    this.room.onLeave((code) => (this.disconnected ??= `left (code ${code})`));
    this.room.onStateChange(() => {
      if (this.patches !== null) this.patches++;
    });
    const deadline = Date.now() + 10_000;
    let me;
    while (!(me = this.room.state.players?.get(this.room.sessionId))) {
      if (Date.now() > deadline) throw new Error(`${this.name} never appeared in the room`);
      await sleep(20);
    }
    this.body = makeBody(me.x, me.z, groveTownSurface);
    this.air = makeAirTrack(this.body.y);
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
   * Turns away from walls, and from any step the server's own check would refuse.
   */
  private step() {
    const now = Date.now();
    for (let attempt = 0; attempt < 12; attempt++) {
      const heading = attempt === 0 ? this.heading + (Math.random() - 0.5) * 0.4 : Math.random() * 2 * Math.PI;
      const body = { ...this.body };
      const jump = attempt === 0 && Math.random() < JUMP_CHANCE;
      const stepped = stepBody(body, { vx: Math.sin(heading) * RUN_SPEED, vz: Math.cos(heading) * RUN_SPEED, jump }, 1 / TICK_HZ, groveTownSurface);
      const moved = Math.hypot(body.x - this.body.x, body.z - this.body.z);
      // stuck against something (in the air it carries on regardless, so its fall keeps up with the clock)
      if (body.grounded && moved < (RUN_SPEED / TICK_HZ) * 0.5) continue;
      const next = { x: body.x, z: body.z, y: body.y, facing: heading, moving: true };
      const air = { ...this.air };
      // running speed is well inside the server's allowance, so only the height check can refuse it
      if (checkPose(this.body, air, next, now, Infinity, groveTownSurface).result !== 'ok') continue;
      this.heading = heading;
      this.body = body;
      this.air = air;
      if (stepped.jumped) this.jumps++;
      this.room.send('move', next);
      return;
    }
  }

  private chat() {
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
console.log(`All ${count} joined; walking and chatting for ${seconds} s.`);
await sleep(WARMUP_MS);

const healthSamples: Health[] = [];
const sampler = setInterval(() => void health().then((h) => healthSamples.push(h), () => {}), 1000);
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
await Promise.all(bots.map((bot) => bot.stop()));

const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const min = Math.min(...rates);
const serverHz = healthSamples.map((h) => h.tickHz);
const peakRss = Math.max(final.peakRssMb, ...healthSamples.map((h) => h.peakRssMb));

console.log(`players: ${final.players}`);
console.log(`patch rate seen by bots: mean ${mean.toFixed(2)} Hz, min ${min.toFixed(2)} Hz (over ${measured.toFixed(1)} s)`);
if (serverHz.length) console.log(`server patch rate (/healthz, 5 s window): min ${Math.min(...serverHz)} Hz, max ${Math.max(...serverHz)} Hz`);
console.log(`server peak RSS: ${peakRss} MB`);
console.log(`corrections: ${corrections}; disconnected bots: ${lost.length}; chat lines heard: ${chatsHeard}; jumps: ${jumps}`);

const failures: string[] = [];
if (lost.length) failures.push(`${lost.length} bots disconnected (first: ${lost[0].name}, ${lost[0].disconnected})`);
if (!(mean >= MIN_MEAN_HZ)) failures.push(`mean patch rate ${mean.toFixed(2)} Hz is below ${MIN_MEAN_HZ} Hz`);
if (corrections) failures.push(`${corrections} legal steps were corrected`);
console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
