// Dodges and knockbacks over a slow, jittery network: a seeded fuzz over the room's own move, dodge,
// step and stamping code (its handlers called directly, its clocks virtual), with an honest client that
// predicts its rolls at 15, 30 and 60 frames a second, at round trips of 0 to 400 ms with ±60 ms of
// jitter each way. Honest clients are never corrected and no dodge of theirs is refused; a cheater
// playing ack games and spamming dodges moves no further than its rolls allow.
import { appendFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DISPLACE_FUZZ_M, DODGE_CHARGES, DODGE_DISTANCE, DODGE_MIN_GAP_S, DODGE_REFILL_S, MAX_MOVE_ALLOWANCE, MAX_MOVE_SPEED, RUN_SPEED, SPAWN, TICK_HZ,
  SPRINT_SCALE, SPRINT_S, dodgeDisplacement, makeBody, simulateDisplacement, stepBody, type Body, type CampSpawn, type JobsSave, type Surface,
} from '@sg2/shared';
import { accountFor, joinZone, saveAs, serverRoom, startServer, type TestServer } from './testHelpers';

let server: TestServer | undefined;
afterEach(async () => {
  await server?.app.close();
  server = undefined;
});

const flatGround: Surface = (x, z) => (Math.hypot(x, z) > 200 ? null : 0);
/** Flat ground with, east of x = 2, a 1:4 slope up to a 1 m shelf (x 6..9) that ends in a 1 m ledge. */
const ledgeGround: Surface = (x, z) => {
  if (Math.hypot(x, z) > 200) return null;
  if (x > 2 && x < 6) return (x - 2) * 0.25;
  if (x >= 6 && x < 9) return 1;
  return 0;
};
const BOAR: CampSpawn = { kind: 'boar', x: 0, z: -20, facing: 0 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Wire { at: number; type: string; msg: any }
/** An ordered channel (like a websocket): each message takes base ± jitter, never overtaking the one before. */
function channel(baseMs: number, jitterMs: number, r: () => number) {
  const queue: Wire[] = [];
  let last = 0;
  return {
    queue,
    push(now: number, type: string, msg: any) {
      const at = Math.max(last, now + Math.max(0, baseMs + (r() * 2 - 1) * jitterMs));
      last = at;
      queue.push({ at, type, msg: structuredClone(msg) });
    },
    due(now: number): Wire[] {
      let n = 0;
      while (n < queue.length && queue[n].at <= now) n++;
      return queue.splice(0, n);
    },
  };
}

interface Run {
  corrections: number;
  wrongRefusals: string[];
  /** Dodges refused in a knock's wake (the knock came first on the server: stale or busy, as it should be). */
  excusedRefusals: number;
  dodgesSent: number;
  /** Second dodges sent exactly DODGE_MIN_GAP_S after the first (by the client's clock). */
  doubles: number;
  dodgesRolled: number;
  /** Mash mode: presses sent while empty, and the rolls that came of them (held ones). */
  mashes: number;
  /** The highest speed scale the server gave it (sprint). */
  maxScale: number;
  mashRolls: number;
  knocks: number;
  /** Server-side accepted path (lastGood), and the virtual seconds run. */
  serverPath: number;
  seconds: number;
}

/**
 * One fuzz run: a room on virtual clocks (its own step timer stopped), a client wired to it through
 * two jittery channels. The honest client runs about at RUN_SPEED, jumps, dodges (sometimes twice at
 * the minimum gap) and predicts each roll; the cheater sends far moves and dodges with made-up acks.
 */
async function fuzz(o: {
  seed: number; fps: number; rttMs: number; jitterMs: number; seconds: number; boar: boolean; cheat?: boolean;
  /** The ground (flat by default). */
  surface?: Surface;
  /** Dodge on the first frame the client's own count allows (a charge back, the minimum gap passed). */
  eager?: boolean;
  /** While its own count says it is empty, press dodge every send tick anyway (without predicting a roll). */
  mash?: boolean;
  /** Sprint (free pick) once, a second in, running at RUN_SPEED × SPRINT_SCALE for SPRINT_S. */
  sprint?: boolean;
}): Promise<Run> {
  const clock = { ms: 0 };
  const flat = o.surface ?? flatGround;
  server = await startServer({
    combatSeed: o.seed, combatClock: () => clock.ms / 1000, wallClock: () => clock.ms,
    zones: { grove: { surface: flat, ground: flat, sight: () => true, camps: o.boar ? [BOAR] : [] } },
  });
  const { store, url } = server;
  const account = await accountFor(store, `Fuzz${o.seed}`);
  const start = { x: 0, z: -13 };
  await saveAs(store, account.accountId, { ...start, facing: 0, ...(o.sprint ? { jobs: { current: 'ranger', jobs: { ranger: { level: 1, xp: 0, picks: ['sprint', 'field_dressing'], talents: [], outfit: null } } } as JobsSave } : {}) });
  const { room: sdkRoom } = await joinZone(url, account.token, 'grove');
  const room = serverRoom(sdkRoom) as any;
  room.setSimulationInterval(undefined); // stepped by hand, on the virtual clock
  const session = room.sessions.get(sdkRoom.sessionId);
  const r = rng(o.seed);
  const up = channel(o.rttMs / 2, o.jitterMs, r), down = channel(o.rttMs / 2, o.jitterMs, r);
  // (`jobs`, sent a step after the join, means nothing to this client: kept off the channel, so it
  // draws no jitter from the run's generator and every seed plays out as before jobs existed)
  const client = { sessionId: sdkRoom.sessionId, send: (type: string, msg: any) => (type === 'jobs' ? undefined : down.push(clock.ms, type, msg)) };
  session.client = client;
  session.movement.metres = MAX_MOVE_ALLOWANCE; // as after standing a second

  const out: Run = { corrections: 0, wrongRefusals: [], excusedRefusals: 0, dodgesSent: 0, doubles: 0, dodgesRolled: 0, mashes: 0, mashRolls: 0, maxScale: 1, knocks: 0, serverPath: 0, seconds: o.seconds };
  let body: Body = makeBody(start.x, start.z, flat);
  let ack = 0, heading = r() * 2 * Math.PI;
  let rollUntil = -Infinity;
  let rollEnd = null as { x: number; z: number; y: number } | null;
  let charges = DODGE_CHARGES, refillAt: number | null = null, lastDodge = -Infinity, secondAt: number | null = null;
  let standing = false, phaseUntil = 0;
  let quietUntil = 0;
  let predicted = 0, nextMash = 0, sprintAt: number | null = null; // no dodges for a while after a knock (the server holds it 'knock' until it ends)
  const knockTimes: number[] = [];
  let last = { ...session.lastGood };
  const frameMs = 1000 / o.fps, stepMs = 1000 / TICK_HZ;
  let nextFrame = 0, nextStep = stepMs, nextSend = stepMs / 2;

  const dodgeNow = (t: number) => {
    const dir = r() * 2 * Math.PI;
    const from = { x: body.x, z: body.z, y: body.y };
    up.push(t, 'dodge', { ...from, facing: heading, moving: true, ack, dx: Math.sin(dir), dz: Math.cos(dir) });
    out.dodgesSent++;
    predicted++;
    const result = simulateDisplacement(from, dodgeDisplacement(Math.sin(dir), Math.cos(dir)), flat);
    rollUntil = t + result.seconds * 1000;
    rollEnd = { x: result.x, z: result.z, y: result.y };
    charges--;
    refillAt ??= t + DODGE_REFILL_S * 1000;
    lastDodge = t;
  };

  for (let t = 0; t <= o.seconds * 1000; t += 1) {
    clock.ms = t;
    // server → client
    for (const m of down.due(t)) {
      if (m.type === 'displaced') {
        ack = m.msg.seq;
        if (m.msg.kind === 'knock') {
          out.knocks++;
          knockTimes.push(t);
          body = makeBody(m.msg.to.x, m.msg.to.z, flat);
          rollUntil = -Infinity;
          rollEnd = null;
          secondAt = null;
          quietUntil = t + 1500;
          predicted = 0;
        } else if (m.msg.kind === 'dodge') {
          out.dodgesRolled++;
          if (predicted > 0) predicted--;
          else { out.mashRolls++; body = makeBody(m.msg.to.x, m.msg.to.z, flat); } // a roll it pressed for while empty: taken as it comes
        }
      } else if (m.type === 'correct') {
        out.corrections++;
        body = makeBody(m.msg.x, m.msg.z, flat);
        body.y = m.msg.y;
      } else if (m.type === 'refused' && m.msg.action === 'dodge') {
        const excused = knockTimes.some((k) => t - k < 2000) || session.dead || o.mash;
        if (!excused) out.wrongRefusals.push(`${m.msg.reason} at ${t} ms`);
        else out.excusedRefusals++;
      }
    }
    // client → server
    for (const m of up.due(t)) {
      if (m.type === 'move') room.onMove(client, m.msg);
      else if (m.type === 'ability') room.onAbility(client, m.msg);
      else room.onDodge(client, m.msg);
      const g = session.lastGood;
      out.serverPath += Math.hypot(g.x - last.x, g.z - last.z);
      last = { ...g };
    }
    if (t >= nextStep) {
      nextStep += stepMs;
      room.step();
      out.maxScale = Math.max(out.maxScale, room.combat.speedScale(session.eid, t / 1000));
      const g = session.lastGood;
      out.serverPath += Math.hypot(g.x - last.x, g.z - last.z);
      last = { ...g };
    }
    if (session.dead) continue;
    // the client's frame
    if (t >= nextFrame) {
      nextFrame += frameMs;
      while (refillAt !== null && t >= refillAt) { charges = Math.min(DODGE_CHARGES, charges + 1); refillAt = charges < DODGE_CHARGES ? refillAt + DODGE_REFILL_S * 1000 : null; }
      if (t < rollUntil) continue;
      if (rollEnd) { body = makeBody(rollEnd.x, rollEnd.z, flat); rollEnd = null; }
      if (o.cheat) {
        // far, fast poses with made-up acks, and a dodge every frame
        const d = 1 + r() * 3;
        heading += (r() - 0.5);
        const p = { x: body.x + Math.sin(heading) * d, z: body.z + Math.cos(heading) * d, y: 0, facing: heading, moving: true, ack: Math.floor(r() * (ack + 3)) };
        body = makeBody(p.x, p.z, flat);
        up.push(t, 'move', p);
        up.push(t, 'dodge', { ...p, ack: Math.floor(r() * (ack + 3)), dx: r() - 0.5, dz: r() - 0.5 });
        out.dodgesSent++;
        continue;
      }
      // phases of running about and of standing (jumping now and then), so charges sometimes connect
      if (t >= phaseUntil) { standing = r() < 0.5; phaseUntil = t + 1000 + r() * 2000; }
      const home = Math.hypot(body.x - start.x, body.z - start.z) > 10;
      heading = home ? Math.atan2(start.x - body.x, start.z - body.z) : heading + (r() - 0.5) * 0.3;
      const jump = body.grounded && r() < (standing ? 0.04 : 0.02);
      if (o.sprint && sprintAt === null && t >= 1000) { sprintAt = t; up.push(t, 'ability', { slot: 3, phase: 'press' }); }
      const sprinting = sprintAt !== null && t < sprintAt + SPRINT_S * 1000;
      if (sprinting) standing = false;
      const speed = standing ? 0 : RUN_SPEED * (sprinting ? SPRINT_SCALE : 1);
      stepBody(body, { vx: Math.sin(heading) * speed, vz: Math.cos(heading) * speed, jump }, frameMs / 1000, flat);
      const canDodge = body.grounded && charges > 0 && t - lastDodge >= DODGE_MIN_GAP_S * 1000 && t >= quietUntil && t < o.seconds * 1000 - 1500;
      if (secondAt !== null && t >= secondAt) {
        secondAt = null;
        if (canDodge) { dodgeNow(t); out.doubles++; continue; }
      }
      if (o.mash && charges === 0 && t >= nextMash && body.grounded && t < o.seconds * 1000 - 1500) {
        nextMash = t + stepMs; // pressed while empty: sent, not predicted
        up.push(t, 'dodge', { x: body.x, z: body.z, y: body.y, facing: heading, moving: true, ack, dx: 1, dz: 0 });
        out.mashes++;
      }
      if (canDodge && (o.eager || r() < frameMs / 1000)) { // about once a second (eager: at once), whenever a charge allows
        dodgeNow(t);
        if (charges > 0 && r() < 0.7) secondAt = t + DODGE_MIN_GAP_S * 1000; // the double dodge, at the minimum gap
        continue;
      }
    }
    if (!o.cheat && t >= nextSend) {
      nextSend += stepMs;
      if (t >= rollUntil && rollEnd === null) up.push(t, 'move', { x: body.x, z: body.z, y: body.y, facing: heading, moving: true, ack });
    }
  }
  await sdkRoom.leave();
  return out;
}

const totals = { doubles: 0, knocks: 0, dodges: 0 };

describe('dodges and knockbacks over a slow, jittery network', () => {
  const cases: { fps: number; rttMs: number; seed: number }[] = [];
  for (const fps of [15, 30, 60]) for (const rttMs of [0, 150, 400]) for (const seed of [1, 2]) cases.push({ fps, rttMs, seed });

  it.each(cases)('honest at $fps fps, $rttMs ms round trip (seed $seed): never corrected, no dodge refused', async ({ fps, rttMs, seed }) => {
    const run = await fuzz({ seed: seed * 100 + fps + rttMs, fps, rttMs, jitterMs: 60, seconds: 15, boar: true });
    expect(run.corrections).toBe(0);
    expect(run.wrongRefusals).toEqual([]);
    if (process.env.FUZZ_LOG) appendFileSync(process.env.FUZZ_LOG, `${fps} fps ${rttMs} ms seed ${seed}: ${JSON.stringify(run)}\n`);
    expect(run.dodgesSent).toBeGreaterThan(0);
    expect(run.dodgesRolled).toBe(run.dodgesSent - run.excusedRefusals);
    totals.doubles += run.doubles;
    totals.knocks += run.knocks;
    totals.dodges += run.dodgesSent;
  });

  it('the honest runs above include double dodges at the minimum gap and knockbacks while running and jumping', () => {
    expect(totals.dodges).toBeGreaterThan(50);
    expect(totals.doubles).toBeGreaterThan(10);
    expect(totals.knocks).toBeGreaterThan(5);
  });

  it.each([
    { name: 'a slope, a shelf and a ledge', surface: ledgeGround, fps: 30, rttMs: 0 },
    { name: 'a slope, a shelf and a ledge', surface: ledgeGround, fps: 30, rttMs: 400 },
    { name: 'a slope, a shelf and a ledge', surface: ledgeGround, fps: 60, rttMs: 150 },
    { name: 'sprinting', sprint: true, fps: 60, rttMs: 150 },
    { name: 'sprinting', sprint: true, fps: 15, rttMs: 400 },
    { name: 'dodging the first frame its own count allows', eager: true, fps: 15, rttMs: 0 },
    { name: 'dodging the first frame its own count allows', eager: true, fps: 60, rttMs: 400 },
    { name: 'dodging the first frame its own count allows', eager: true, fps: 30, rttMs: 150 },
  ])('honest, $name, at $fps fps and $rttMs ms: never corrected, no dodge refused', async (c) => {
    const run = await fuzz({ seed: 31 + c.fps + c.rttMs, jitterMs: 60, seconds: 15, boar: true, ...c });
    if (process.env.FUZZ_LOG) appendFileSync(process.env.FUZZ_LOG, `${c.name} ${c.fps} ${c.rttMs}: ${JSON.stringify(run)}\n`);
    expect(run.corrections).toBe(0);
    expect(run.wrongRefusals).toEqual([]);
    expect(run.dodgesRolled).toBe(run.dodgesSent - run.excusedRefusals);
    if (c.sprint) expect(run.maxScale).toBeGreaterThan(1.3); // it really sprinted, and ran faster
    if (c.eager) expect(run.dodgesSent).toBeGreaterThanOrEqual(DODGE_CHARGES + 2); // two at once, then each refill as it comes
  });

  it.each([0, 150, 400].flatMap((rttMs) => [1, 2, 3].map((seed) => ({ rttMs, seed }))))('mashing dodge while empty at $rttMs ms (seed $seed): at most one roll per charge, no corrections', async ({ rttMs, seed }) => {
    const run = await fuzz({ seed: 51 + rttMs + seed * 1000, fps: [15, 30, 60][seed - 1], rttMs, jitterMs: 60, seconds: 15, boar: false, eager: true, mash: true });
    if (process.env.FUZZ_LOG) appendFileSync(process.env.FUZZ_LOG, `mash ${rttMs}: ${JSON.stringify(run)}\n`);
    expect(run.corrections).toBe(0);
    expect(run.mashes).toBeGreaterThan(10);
    expect(run.dodgesRolled).toBeLessThanOrEqual(DODGE_CHARGES + Math.ceil(run.seconds / DODGE_REFILL_S));
    expect(run.dodgesRolled).toBeGreaterThanOrEqual(run.dodgesSent - run.mashRolls - 1);
  });

  it.each([0, 400])('a cheater (ack games, dodge spam, far moves) at %i ms gains no distance beyond its rolls', async (rttMs) => {
    const run = await fuzz({ seed: 7 + rttMs, fps: 60, rttMs, jitterMs: 60, seconds: 15, boar: false, cheat: true });
    const bound = MAX_MOVE_SPEED * run.seconds + MAX_MOVE_ALLOWANCE + run.dodgesRolled * (DODGE_DISTANCE + DISPLACE_FUZZ_M);
    if (process.env.FUZZ_LOG) appendFileSync(process.env.FUZZ_LOG, `cheat ${rttMs}: path ${run.serverPath.toFixed(1)} bound ${bound.toFixed(1)} ${JSON.stringify(run)}\n`);
    expect(run.serverPath).toBeLessThanOrEqual(bound);
    // and the rolls are the honest number: two charges, one back every 5 s
    expect(run.dodgesRolled).toBeLessThanOrEqual(DODGE_CHARGES + Math.ceil(run.seconds / DODGE_REFILL_S));
    expect(SPAWN).toBeDefined();
  });
});
