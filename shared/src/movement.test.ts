import { describe, expect, it } from 'vitest';
import {
  parsePose, checkPose, jumpCeiling, landAirTrack, makeAirTrack, refillAllowance,
  MAX_MOVE_ALLOWANCE, MAX_MOVE_SPEED, type AirTrack, type Pose,
} from './movement';
import { makeBody, stepBody, fallDamage, type Body, type BodyInput, type BodyStep, type Surface } from './body';
import { groveSurface, groveTownSurface, groundHeight, BEACON_C, PLAZA_R, type Rect } from './world/layout';
import { GROVE_OBSTACLES } from './world/obstacles';
import { GRAVITY, JUMP_SPEED, RUN_SPEED, SPAWN, STEP_UP, TICK_HZ } from './constants';

describe('parsePose', () => {
  it('rejects non-finite or non-number fields', () => {
    expect(parsePose({ x: NaN, z: 0, y: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: Infinity, z: 0, y: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: '1', z: 0, y: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, y: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, y: 0, facing: 0, moving: 'yes' })).toBeNull();
    expect(parsePose(null)).toBeNull();
    expect(parsePose('pose')).toBeNull();
  });
  it('requires a finite height', () => {
    expect(parsePose({ x: 1, z: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, y: NaN, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, y: Infinity, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, y: '0', facing: 0, moving: true })).toBeNull();
  });
  it('returns a clean pose with only the known fields', () => {
    expect(parsePose({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: false })).toEqual({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: false, ack: 0 });
    expect(parsePose({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: true, extra: 'x' })).toEqual({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: true, ack: 0 });
  });
  it('keeps an integer displacement ack, defaults a missing one to 0, and rejects anything else', () => {
    const base = { x: 1, z: 2, y: 0, facing: 0, moving: true };
    expect(parsePose({ ...base, ack: 3 })?.ack).toBe(3);
    expect(parsePose({ ...base, ack: 0 })?.ack).toBe(0);
    expect(parsePose({ ...base, ack: 2 ** 31 - 1 })?.ack).toBe(2 ** 31 - 1);
    expect(parsePose(base)?.ack).toBe(0);
    for (const ack of [1.5, -1, '2', 2 ** 31, NaN, Infinity, null, true, {}]) expect(parsePose({ ...base, ack })).toBeNull();
  });
});

describe('movement allowance', () => {
  it('refills at MAX_MOVE_SPEED, capped at one second plus the slack', () => {
    expect(MAX_MOVE_ALLOWANCE).toBeCloseTo(6 * 1.3 + 0.5);
    expect(refillAllowance(0, 0.5)).toBeCloseTo(MAX_MOVE_SPEED * 0.5);
    expect(refillAllowance(0, 10)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(MAX_MOVE_ALLOWANCE - 0.1, 1)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(1, NaN)).toBe(1);
    expect(refillAllowance(1, -5)).toBe(1);
  });
  it('refills and caps scaled by a speed scale (sprint), never capping below the normal cap', () => {
    expect(refillAllowance(0, 1, 1.4)).toBeCloseTo(10.92, 9);
    expect(refillAllowance(0, 10, 1.4)).toBeCloseTo(MAX_MOVE_ALLOWANCE * 1.4, 9);
    expect(MAX_MOVE_ALLOWANCE * 1.4).toBeCloseTo(8.3 * 1.4, 9);
    expect(refillAllowance(0, 0.5, 0.4)).toBeCloseTo(MAX_MOVE_SPEED * 0.4 * 0.5, 9);
    expect(refillAllowance(0, 10, 0.4)).toBe(MAX_MOVE_ALLOWANCE); // a slow scale keeps the normal cap
    expect(refillAllowance(2, 0.5, 1)).toBe(refillAllowance(2, 0.5));
    expect(refillAllowance(0, 10, 1)).toBe(MAX_MOVE_ALLOWANCE);
  });
  it('a burst of small steps runs out of allowance', () => {
    let allowance = MAX_MOVE_ALLOWANCE;
    let at = { x: 0, z: 0 };
    let accepted = 0;
    for (let i = 1; i <= 40; i++) {
      const to = { x: i * 0.4, z: 0, y: 0, facing: 0, moving: true };
      if (checkPose(at, makeAirTrack(0), to, 1000, allowance, flat).result !== 'ok') break;
      allowance -= 0.4;
      at = to;
      accepted++;
    }
    expect(accepted).toBe(Math.floor(MAX_MOVE_ALLOWANCE / 0.4));
  });
});

describe('the grove surface the server checks against', () => {
  it('spawn has the terrain height; the statue and far away have no surface', () => {
    expect(groveTownSurface(SPAWN.x, SPAWN.z)).toBe(groundHeight(SPAWN.x, SPAWN.z));
    expect(groveTownSurface(0, 0)).toBeNull();
    expect(groveTownSurface(5000, 5000)).toBeNull();
  });
  it('is the town area only: the far Beacon clearing does not count', () => {
    expect(groveSurface(BEACON_C.x, BEACON_C.z)).not.toBeNull(); // standable for the client's anchors
    expect(groveTownSurface(BEACON_C.x, BEACON_C.z)).toBeNull();
  });
});

// ───────── height: jumpCeiling and checkPose ─────────

type Pt = { x: number; z: number };
const flat: Surface = () => 0;
const at = (x: number, z: number, y: number): Pose => ({ x, z, y, facing: 0, moving: true });

/**
 * A client as the browser runs it: the shared controller stepped every `dt` seconds, and its pose
 * sent at TICK_HZ (or every frame when frames are slower). `nowMs` is the send time.
 */
class SimClient {
  body: Body;
  ms = 0;
  sinceSend = 0;
  sent: { pose: Pose; ms: number }[] = [];
  steps: BodyStep[] = [];
  constructor(readonly surface: Surface, x: number, z: number, readonly dt: number) {
    this.body = makeBody(x, z, surface);
  }
  clone(): SimClient {
    const c = new SimClient(this.surface, this.body.x, this.body.z, this.dt);
    Object.assign(c, { body: { ...this.body }, ms: this.ms, sinceSend: this.sinceSend, sent: [...this.sent], steps: [...this.steps] });
    return c;
  }
  frame(input: BodyInput) {
    this.steps.push(stepBody(this.body, input, this.dt, this.surface));
    this.ms += this.dt * 1000;
    this.sinceSend += this.dt;
    if (this.sinceSend >= 1 / TICK_HZ - 1e-9) {
      this.sinceSend = 0;
      this.sent.push({ pose: at(this.body.x, this.body.z, this.body.y), ms: this.ms });
    }
  }
  /** Runs toward (tx, tz) at RUN_SPEED for at most `secs`, jumping once after `jumpAfter` metres (never if null). */
  run(tx: number, tz: number, jumpAfter: number | null, secs = 3, stopWithin = 0.25) {
    const sx = this.body.x, sz = this.body.z;
    let jumped = false;
    for (let t = 0; t < secs; t += this.dt) {
      const b = this.body, dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
      if (d < stopWithin && b.grounded) break;
      const jump = jumpAfter !== null && !jumped && Math.hypot(b.x - sx, b.z - sz) >= jumpAfter;
      if (jump) jumped = true;
      const v = d > 1e-6 ? Math.min(RUN_SPEED, d / this.dt) / d : 0;
      this.frame({ vx: dx * v, vz: dz * v, jump });
    }
  }
  /** Stands still for `secs`. */
  idle(secs: number) {
    for (let t = 0; t < secs; t += this.dt) this.frame({ vx: 0, vz: 0, jump: false });
  }
}

/** What the server makes of a client's sent poses, from its start point, with the running allowance. */
function replay(surface: Surface, start: Pt & { y: number }, sent: { pose: Pose; ms: number }[]) {
  const track = makeAirTrack(start.y);
  let from: Pt = { x: start.x, z: start.z };
  let allowance = MAX_MOVE_ALLOWANCE;
  let lastMs = 0;
  const results: { result: string; landedDrop: number }[] = [];
  for (const { pose, ms } of sent) {
    allowance = refillAllowance(allowance, (ms - lastMs) / 1000);
    lastMs = ms;
    const r = checkPose(from, track, pose, ms, allowance, surface);
    results.push(r);
    if (r.result === 'ok') {
      allowance -= Math.hypot(pose.x - from.x, pose.z - from.z);
      from = { x: pose.x, z: pose.z };
    }
  }
  return results;
}
const rejected = (rs: { result: string }[]) => rs.filter((r) => r.result !== 'ok').map((r) => r.result);
const DTS = [1 / 15, 1 / 30, 1 / 60];

describe('jumpCeiling', () => {
  it('lets a full jump (apex ≈ 1.45 m) through with room for rim riding, and falls away after', () => {
    expect(jumpCeiling(0, 0.36)).toBeGreaterThan(1.45 + STEP_UP);
    expect(jumpCeiling(0, 0.36)).toBeLessThanOrEqual(2.0);
    expect(jumpCeiling(0, 2)).toBeLessThan(0);
    expect(jumpCeiling(3, 0)).toBeCloseTo(3 + STEP_UP + 0.2);
  });
  it('never allows more than 2 m above the take-off point', () => {
    for (let t = 0; t < 1; t += 0.01) expect(jumpCeiling(1, t)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe('checkPose', () => {
  it('passes the horizontal limits through: too fast, and blocked by a wall along the way', () => {
    const wall: Surface = (x) => (x > 1.1 && x < 1.4 ? null : 0);
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(5, 0, 0), 1000, 1, flat).result).toBe('too-fast');
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(2, 0, 0), 1000, 5, wall).result).toBe('blocked');
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(1, 0, 0), 1000, 5, wall).result).toBe('ok');
  });

  for (const dt of DTS) {
    it(`accepts an honest flat jump (frames every ${(dt * 1000).toFixed(1)} ms)`, () => {
      const c = new SimClient(flat, 0, 0, dt);
      c.run(20, 0, 0.5, 1.5);
      expect(c.steps.some((s) => s.jumped) && c.steps.some((s) => s.landed)).toBe(true);
      expect(Math.max(...c.sent.map((s) => s.pose.y))).toBeGreaterThan(1.3);
      expect(rejected(replay(flat, { x: 0, z: 0, y: 0 }, c.sent))).toEqual([]);
    });

    it(`accepts a recorded jump onto a 0.8 m platform (frames every ${(dt * 1000).toFixed(1)} ms)`, () => {
      const crate: Surface = (x) => (x > 2 ? 0.8 : 0);
      const c = new SimClient(crate, 0, 0, dt);
      c.run(4, 0, 0.6, 2);
      expect(c.body.grounded).toBe(true);
      expect(c.body.y).toBeCloseTo(0.8);
      expect(rejected(replay(crate, { x: 0, z: 0, y: 0 }, c.sent))).toEqual([]);
    });

    it(`accepts riding the highest rim it can clear (frames every ${(dt * 1000).toFixed(1)} ms)`, () => {
      // Search for the tallest step the controller can jump onto, with every run-up; all are legal.
      let reach = 0;
      for (let h = 1.4; h <= 1.9; h += 0.01) {
        const step: Surface = (x) => (x > 2 ? h : 0);
        for (let jd = 0; jd <= 2; jd += 0.05) {
          const c = new SimClient(step, 0, 0, dt);
          c.run(4, 0, jd, 2);
          if (c.body.y < h - 1e-6) continue;
          reach = Math.max(reach, h);
          expect(rejected(replay(step, { x: 0, z: 0, y: 0 }, c.sent)), `step ${h.toFixed(2)}, jump after ${jd}`).toEqual([]);
        }
      }
      expect(reach).toBeGreaterThan(1.6);
      expect(jumpCeiling(0, JUMP_SPEED / GRAVITY)).toBeGreaterThanOrEqual(reach + 0.15);
    });
  }

  it('rejects y = 3 from the ground as floating', () => {
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(0.2, 0, 3), 1000, 5, flat).result).toBe('floating');
  });

  it('accepts holding 1 m up (within one jump of the ground, see the ruling above checkPose) but never 2.1 m', () => {
    const low = makeAirTrack(0), high = makeAirTrack(0);
    const lowResults: string[] = [], highResults: string[] = [];
    for (let i = 1; i <= 30; i++) {
      lowResults.push(checkPose({ x: 0, z: 0 }, low, at(0, 0, 1), 1000 + (i * 1000) / TICK_HZ, 5, flat).result);
      highResults.push(checkPose({ x: 0, z: 0 }, high, at(0, 0, 2.1), 1000 + (i * 1000) / TICK_HZ, 5, flat).result);
    }
    expect(lowResults.every((r) => r === 'ok')).toBe(true);
    expect(highResults.every((r) => r === 'floating')).toBe(true);
  });

  it('cannot gain height step by step: airborne poses each 1 m above the last are rejected', () => {
    const track = makeAirTrack(0);
    let y = 0;
    let best = 0;
    for (let i = 1; i <= 30; i++) {
      const r = checkPose({ x: 0, z: 0 }, track, at(0, 0, y + 1), 1000 + (i * 1000) / TICK_HZ, 5, flat);
      if (r.result === 'ok') y += 1;
      best = Math.max(best, track.y);
    }
    expect(best).toBeLessThanOrEqual(2); // never above one jump's reach, however the poses are sent
  });

  it('rejects landing on something higher than any jump reaches', () => {
    const tower: Surface = (x) => (x > 0.3 ? 3 : 0);
    const track = makeAirTrack(0);
    expect(checkPose({ x: 0, z: 0 }, track, at(0, 0, 0.8), 1000, 5, tower).result).toBe('ok');
    expect(checkPose({ x: 0, z: 0 }, track, at(0.4, 0, 3), 1000 + 1000 / TICK_HZ, 5, tower).result).toBe('floating');
  });

  it('rejects stepping onto a 0.9 m platform without ever being in the air', () => {
    const platform: Surface = (x) => (x > 0.3 ? 0.9 : 0);
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(0.4, 0, 0.9), 1000, 5, platform).result).toBe('blocked');
  });

  it('rejects a pose below the surface, and a grounded pose where there is no surface', () => {
    const hill: Surface = () => 2;
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(2), at(0.2, 0, 1.5), 1000, 5, hill).result).toBe('blocked');
    const pond: Surface = (x) => (x > 0.3 ? null : 0);
    expect(checkPose({ x: 0, z: 0 }, makeAirTrack(0), at(0.4, 0, 0), 1000, 5, pond).result).toBe('blocked');
  });

  it('leaves the track alone when it rejects a pose', () => {
    const track = makeAirTrack(0);
    const before = { ...track };
    checkPose({ x: 0, z: 0 }, track, at(0.2, 0, 3), 1000, 5, flat);
    checkPose({ x: 0, z: 0 }, track, at(5, 0, 0), 1000, 1, flat);
    expect(track).toEqual(before);
  });

  it('reports the whole drop when the ground 4.5 m below is reported straight after the ledge', () => {
    const ledge: Surface = (x) => (x < 1 ? 4.5 : 0);
    const track = makeAirTrack(4.5);
    const r = checkPose({ x: 0.8, z: 0 }, track, at(1.2, 0, 0), 1000, 5, ledge);
    expect(r.result).toBe('ok');
    expect(r.landedDrop).toBeCloseTo(4.5);
    expect(track.grounded).toBe(true);
  });

  it('measures a landing from the highest point of the jump, and never reports a negative drop', () => {
    const platform: Surface = (x) => (x > 1 ? 0.9 : 0);
    const track = makeAirTrack(0);
    checkPose({ x: 0, z: 0 }, track, at(0.4, 0, 0.5), 1000, 5, platform);
    checkPose({ x: 0.4, z: 0 }, track, at(0.8, 0, 1.2), 1067, 5, platform);
    const r = checkPose({ x: 0.8, z: 0 }, track, at(1.2, 0, 0.9), 1133, 5, platform);
    expect(r.result).toBe('ok');
    expect(r.landedDrop).toBeCloseTo(0.3);
    // rose and landed above its peak within one message: no negative drop
    const rim = makeAirTrack(0);
    checkPose({ x: 0, z: 0 }, rim, at(0.4, 0, 0.4), 1000, 5, platform);
    expect(checkPose({ x: 0.4, z: 0 }, rim, at(1.2, 0, 0.9), 1067, 5, platform).landedDrop).toBe(0);
  });
});

describe('checkPose once the arc is surely over (lag, reconnect, re-join)', () => {
  /** A track that left flat ground at 1000 ms and was last accepted at y (peak `peak`) in the air. */
  const airborne = (y: number, peak = y): AirTrack => ({ grounded: false, airStartMs: 1000, airStartY: 0, peakY: peak, y });

  it('accepts a landing whose poses arrive 400 ms late, and is not locked out afterwards', () => {
    const c = new SimClient(flat, 0, 0, 1 / 15);
    c.run(20, 0, 0.5, 2);
    // every pose from the third airborne one on arrives 400 ms late
    const firstAir = c.sent.findIndex((s) => s.pose.y > 0.05);
    const late = c.sent.map((s, i) => (i >= firstAir + 2 ? { ...s, ms: s.ms + 400 } : s));
    const results = replay(flat, { x: 0, z: 0, y: 0 }, late);
    const landing = results.findIndex((r, i) => i > firstAir && late[i].pose.y === 0 && r.result === 'ok');
    expect(landing).toBeGreaterThan(firstAir);
    expect(rejected(results.slice(landing))).toEqual([]);
  });

  it('accepts the ground 1.5 s after the last pose in the air, as a landing measured from the peak', () => {
    const track = airborne(1, 1.2);
    const r = checkPose({ x: 0, z: 0 }, track, at(0.4, 0, 0), 2500, 5, flat);
    expect(r).toEqual({ result: 'ok', landedDrop: 1.2 });
    expect(track.grounded).toBe(true);
    expect(checkPose({ x: 0.4, z: 0 }, track, at(0.8, 0, 0), 2567, 5, flat).result).toBe('ok');
  });

  it('charges the whole fall when it lands long after (a reconnect on the ground)', () => {
    const ledge: Surface = (x) => (x < 1 ? 10 : 0);
    const track: AirTrack = { grounded: false, airStartMs: 1000, airStartY: 10, peakY: 10, y: 9.9 };
    const r = checkPose({ x: 1.1, z: 0 }, track, at(1.4, 0, 0), 4000, 5, ledge);
    expect(r).toEqual({ result: 'ok', landedDrop: 10 });
  });

  it('an expired track stays within one jump of the ground, and cannot stand on something higher than it was', () => {
    // in the air: within one jump of the ground below is a jump again (see the ruling above checkPose)
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 1), 3000, 5, flat).result).toBe('ok');
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 2.1), 3000, 5, flat).result).toBe('floating');
    // "landing" on something higher than its last height
    const crate: Surface = (x) => (x > 0.1 ? 1.5 : 0);
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 1.5), 3000, 5, crate).result).toBe('floating');
  });
});

describe('checkPose with jump held (landing and jumping again between two poses)', () => {
  for (const dt of DTS) {
    it(`accepts bunny-hopping on flat ground with jump held for 4 s (frames every ${(dt * 1000).toFixed(1)} ms)`, () => {
      const c = new SimClient(flat, 0, 0, dt);
      for (let t = 0; t < 4; t += dt) c.frame({ vx: RUN_SPEED, vz: 0, jump: true });
      expect(c.steps.filter((s) => s.jumped).length).toBeGreaterThan(4);
      expect(rejected(replay(flat, { x: 0, z: 0, y: 0 }, c.sent))).toEqual([]);
    });
  }

  it('accepts jump held over hilly ground and up onto a platform', () => {
    const hills: Surface = (x, z) => (x > 6 && x < 9 ? 0.8 + 0.3 * Math.sin(z) : 0.5 * Math.sin(x * 0.7) + 0.3 * Math.cos(z * 0.5));
    for (const dt of DTS) {
      const c = new SimClient(hills, 0, 0, dt);
      for (let t = 0; t < 4; t += dt) c.frame({ vx: RUN_SPEED * 0.8, vz: RUN_SPEED * 0.3, jump: true });
      expect(rejected(replay(hills, { x: 0, z: 0, y: c.sent.length ? hills(0, 0)! : 0 }, c.sent)), `dt ${dt}`).toEqual([]);
    }
  });

  it('accepts coming down onto a 0.8 m platform from a jump and jumping again from it before the next pose', () => {
    // found by fuzzing: the step passes over the ground (0) and the platform (0.8); the new jump is from 0.8
    const crate: Surface = (x) => (x > 4.2 ? 0.8 : 0);
    for (const dt of DTS) for (let start = 0; start <= 0.6; start += 0.05) {
      const c = new SimClient(crate, start, 0, dt);
      for (let t = 0; t < 2; t += dt) c.frame({ vx: RUN_SPEED, vz: 0, jump: true });
      expect(rejected(replay(crate, { x: start, z: 0, y: 0 }, c.sent)), `dt ${dt}, start ${start}`).toEqual([]);
    }
  });

  it('still charges the fall when it lands from a 4.5 m ledge and jumps again before the next pose', () => {
    const ledge: Surface = (x) => (x < 1 ? 4.5 : 0);
    const c = new SimClient(ledge, 0, 0, 1 / 60);
    for (let t = 0; t < 2; t += 1 / 60) c.frame({ vx: RUN_SPEED, vz: 0, jump: c.body.y < 4 });
    const results = replay(ledge, { x: 0, z: 0, y: 4.5 }, c.sent);
    expect(rejected(results)).toEqual([]);
    expect(Math.max(...results.map((r) => r.landedDrop))).toBeGreaterThan(4.4);
  });

  it('cannot use a pretend landing to climb in the air above one jump', () => {
    // a jump, then poses claiming to be ever higher each tick
    const track = makeAirTrack(0);
    let best = 0;
    for (let i = 1; i <= 45; i++) {
      checkPose({ x: 0, z: 0 }, track, at(0, 0, best + 0.5), 1000 + (i * 1000) / TICK_HZ, 5, flat);
      best = Math.max(best, track.y);
    }
    expect(best).toBeLessThanOrEqual(2);
  });
});

describe('checkPose: the standing tolerance cannot be stacked into extra height', () => {
  /** Stands 0.05 m high at (0, 0), rides the jump ceiling towards a ledge at x > 4, then claims to land 0.05 m low on it. */
  function stackedLanding(L: number): string {
    const ledge: Surface = (x, z) => (Math.hypot(x, z) > 40 ? null : x > 4 && x < 8 && Math.abs(z) < 2 ? L : 0);
    const track = makeAirTrack(0);
    let from = { x: 0, z: 0 }, now = 1000;
    const send = (x: number, y: number) => {
      const r = checkPose(from, track, at(x, 0, y), now, MAX_MOVE_ALLOWANCE, ledge).result;
      if (r === 'ok') from = { x, z: 0 };
      return r;
    };
    send(0, 0.05); // standing, 5 cm up
    const t0 = now;
    for (let k = 1; k <= 6; k++) {
      now += (1000 / TICK_HZ) * (k === 6 ? 0.45 : 1);
      // just under the ceiling of a jump from the reported 5 cm (the reviewer's sequence)
      if (send((4.2 * k) / 7, jumpCeiling(0.05, (now - t0) / 1000) - 1e-6) !== 'ok') return `in the air at ${now - t0} ms`;
    }
    now += 67;
    return send(4.2, L - 0.05);
  }

  for (const L of [2.01, 2.06, 2.1, 2.14]) {
    it(`refuses standing high, riding the ceiling and landing low on a ${L} m ledge`, () => {
      expect(stackedLanding(L)).not.toBe('ok');
    });
  }

  it('a stand reported 5 cm high does not raise the next jump, and a fall is charged between the surfaces', () => {
    const track = makeAirTrack(0);
    expect(checkPose({ x: 0, z: 0 }, track, at(0.2, 0, 0.05), 1000, 5, flat).result).toBe('ok');
    expect(track.y).toBe(0); // the surface, not the reported height
    const ledge: Surface = (x) => (x < 1 ? 4.5 : 0);
    const high = makeAirTrack(4.5);
    expect(checkPose({ x: 0.5, z: 0 }, high, at(0.8, 0, 4.55), 1000, 5, ledge).result).toBe('ok');
    const r = checkPose({ x: 0.8, z: 0 }, high, at(1.2, 0, 0.05), 1067, 5, ledge);
    expect(r.result).toBe('ok');
    expect(r.landedDrop).toBeCloseTo(4.5, 9); // not 4.5 shaved by the tolerance
  });
});

// ───────── the ruling above checkPose: height and reach bounds hold against cheaters (G1–G3) ─────────

describe('checkPose bounds against cheaters (G1 height and ledges, G2 walls, G3 falls)', () => {
  let seed = 4242;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const inWorld = (x: number, z: number) => Math.hypot(x, z) < 40;
  const flatWorld: Surface = (x, z) => (inWorld(x, z) ? 0 : null);
  const hills: Surface = (x, z) => (inWorld(x, z) ? 0.6 * Math.sin(x * 0.4) + 0.5 * Math.cos(z * 0.3) : null);
  /** Worst height above the highest ground of the last 3 s of path seen over all runs (for the report). */
  let worstAbove = -Infinity;

  interface Scene { surface: Surface; start: Pt; target: Pt; ledge?: number; wallX?: number; cliff?: boolean }

  /** One cheater: any send rate 5–45/s with jitter, a height strategy, and corrections obeyed or ignored. */
  function cheat(scene: Scene, seconds = 8) {
    const { surface, start, target } = scene;
    const violations: string[] = [];
    const rate = 5 + rand() * 40;
    const strategy = (['constant', 'saw-tooth', 'random', 'highest', 'ground', 'stacked'] as const)[Math.floor(rand() * 6)];
    const c = rand() * 3, lo = rand() * 2, hi = lo + rand() * 1.5;
    const ignoreCorrections = rand() < 0.5;
    const speed = MAX_MOVE_SPEED * (0.3 + rand());
    const startY = surface(start.x, start.z)!;
    const track = makeAirTrack(startY);
    let lastGood = { ...start }, pos = { ...start }, allowance = MAX_MOVE_ALLOWANCE, now = 1000, lastMs = 1000, i = 0;
    const grounds: { ms: number; h: number }[] = [{ ms: now, h: startY }];
    const drops: number[] = [];
    let leftCliff = false;
    while (now < 1000 + seconds * 1000) {
      const dtMs = (1000 / rate) * (0.4 + rand() * 1.2);
      now += dtMs;
      i++;
      allowance = refillAllowance(allowance, (now - lastMs) / 1000);
      lastMs = now;
      const heading = Math.atan2(target.z - pos.z, target.x - pos.x) + (rand() - 0.5) * 2;
      const step = speed * (dtMs / 1000) * rand() * 1.5;
      const nx = pos.x + Math.cos(heading) * step, nz = pos.z + Math.sin(heading) * step;
      const g = surface(nx, nz) ?? 0;
      const tryY = (y: number) => checkPose(lastGood, { ...track }, at(nx, nz, y), now, allowance, surface).result === 'ok';
      let y: number;
      if (strategy === 'constant') y = c;
      else if (strategy === 'saw-tooth') y = g + (i % 2 ? hi : lo);
      else if (strategy === 'random') y = g + rand() * 3;
      else if (strategy === 'ground') y = g;
      // the standing tolerance stacked: stand 5 cm high, ride the ceiling, land 5 cm low on anything higher
      else if (strategy === 'stacked' && track.grounded) y = g + 0.049;
      else if (strategy === 'stacked' && g > track.y + STEP_UP) y = g - 0.049;
      else {
        let a = g - 0.05, b = g + 4; // the highest height it will accept here
        for (let k = 0; k < 16; k++) { const m = (a + b) / 2; if (tryY(m)) a = m; else b = m; }
        y = a;
      }
      const r = checkPose(lastGood, track, at(nx, nz, y), now, allowance, surface);
      if (r.result === 'ok') {
        allowance -= Math.hypot(nx - lastGood.x, nz - lastGood.z);
        let h = -Infinity; // highest ground along this step
        for (let k = 0; k <= 20; k++) {
          const s = surface(lastGood.x + ((nx - lastGood.x) * k) / 20, lastGood.z + ((nz - lastGood.z) * k) / 20);
          if (s !== null) h = Math.max(h, s);
        }
        grounds.push({ ms: now, h });
        lastGood = { x: nx, z: nz };
        pos = { x: nx, z: nz };
        drops.push(r.landedDrop);
        // G1: never more than one jump above the highest real ground of its recent path
        const recent = Math.max(...grounds.filter((e) => e.ms >= now - 3000).map((e) => e.h));
        worstAbove = Math.max(worstAbove, y - recent);
        if (y > recent + 2.05) violations.push(`G1 ${strategy}@${rate.toFixed(0)}/s: y ${y.toFixed(2)} with ground ${recent.toFixed(2)}`);
        // G1: never stands on, or jumps from, a ledge 2.1 m or more above its surroundings
        if (scene.ledge !== undefined && ((track.grounded && track.y >= scene.ledge) || track.airStartY >= scene.ledge)) {
          violations.push(`G1 ledge ${scene.ledge} reached by ${strategy}@${rate.toFixed(0)}/s`);
        }
        // G2: never across the wall
        if (scene.wallX !== undefined && nx > scene.wallX) violations.push(`G2 crossed the wall by ${strategy}`);
      } else {
        // the server lands an airborne adventurer under its last good pose and corrects it there
        if (!track.grounded) drops.push(landAirTrack(track, surface(lastGood.x, lastGood.z)!));
        if (!ignoreCorrections) pos = { ...lastGood };
      }
      // G3: coming down from the 4.5 m cliff onto the low ground always charges the fall
      if (scene.cliff && !leftCliff && track.grounded && track.y < 1) {
        leftCliff = true;
        if (!(Math.max(0, ...drops) >= 4.4)) violations.push(`G3 came down 4.5 m charged only ${Math.max(0, ...drops).toFixed(2)} by ${strategy}`);
      }
    }
    return violations;
  }

  const scenes: [string, Scene][] = [
    ['flat ground', { surface: flatWorld, start: { x: 0, z: 0 }, target: { x: 30, z: 5 } }],
    ['hills', { surface: hills, start: { x: 0, z: 0 }, target: { x: 25, z: -15 } }],
    ['beside platforms of 0.5 to 1.8 m', {
      surface: (x, z) => (!inWorld(x, z) ? null : Math.abs(z) < 1 && x > 3 && x < 15 ? 0.5 + 1.3 * Math.floor((x - 3) / 3) / 3 : 0),
      start: { x: 0, z: 0 }, target: { x: 15, z: 0 },
    }],
    ...[2.01, 2.05, 2.1, 2.3, 2.6, 3].map((L): [string, Scene] => [`a ${L} m ledge`, {
      surface: (x, z) => (!inWorld(x, z) ? null : x > 4 && x < 8 && Math.abs(z) < 2 ? L : 0), start: { x: 0, z: 0 }, target: { x: 6, z: 0 }, ledge: L,
    }]),
    ['a 0.4 m wall across the world', { surface: (x, z) => (!inWorld(x, z) || Math.abs(x - 3.2) < 0.2 ? null : 0), start: { x: 0, z: 0 }, target: { x: 10, z: 0 }, wallX: 3.4 }],
    ['the edge of a 4.5 m cliff', { surface: (x, z) => (!inWorld(x, z) ? null : x < 0 ? 4.5 : 0), start: { x: -3, z: 0 }, target: { x: 10, z: 0 }, cliff: true }],
    ['the Old Lookout', { surface: groveTownSurface, start: { x: 26, z: -22 }, target: { x: 35.7, z: -29 } }],
  ];
  for (const [name, scene] of scenes) {
    it(`holds the bounds for 40 random cheaters at ${name}`, () => {
      expect(scene.surface(scene.start.x, scene.start.z)).not.toBeNull();
      const violations: string[] = [];
      for (let run = 0; run < 40; run++) violations.push(...cheat(scene));
      expect(violations.slice(0, 5)).toEqual([]);
    });
  }

  it('the worst height reached is about one jump (2 m) above recent ground', () => {
    expect(worstAbove).toBeGreaterThan(1.9); // the cheaters did probe the limit
    expect(worstAbove).toBeLessThanOrEqual(2.05);
  });
});

// ───────── honest clients are never refused (G4) ─────────

describe('checkPose never refuses an honest client (G4)', () => {
  let seed = 99;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const hills: Surface = (x, z) => 0.6 * Math.sin(x * 0.4) + 0.5 * Math.cos(z * 0.3);

  /**
   * A browser-like client (frames at `fps`, one `hitchMs` frame every 2 s, poses at 15 Hz) whose poses
   * arrive 40 ms later plus up to `jitterMs`, held back during `spikeMs` every 3 s, in order and to
   * the whole millisecond (so several can share one). Returns how many the server refused.
   */
  function honest(o: { fps: number; hitchMs: number; jitterMs: number; spikeMs: number; surface: Surface; jump: boolean }) {
    const body = makeBody(0, 0, o.surface);
    const track = makeAirTrack(body.y);
    let lastGood = { x: 0, z: 0 }, allowance = MAX_MOVE_ALLOWANCE, lastMs = 0, lastArrival = 0, t = 0, since = 0, nextHitch = 1, refused = 0;
    const inFlight: { ms: number; pose: Pose }[] = [];
    let correction: { ms: number; x: number; z: number; y: number } | null = null;
    while (t < 20) {
      let dt = 1 / o.fps;
      if (o.hitchMs && t >= nextHitch) { dt = o.hitchMs / 1000; nextHitch += 2; }
      if (correction && t * 1000 >= correction.ms) {
        Object.assign(body, { x: correction.x, z: correction.z, y: correction.y, vy: 0, grounded: true, peakY: correction.y });
        correction = null;
      }
      stepBody(body, { vx: RUN_SPEED * Math.cos(t * 0.3), vz: RUN_SPEED * Math.sin(t * 0.3), jump: o.jump }, dt, o.surface);
      t += dt;
      since += dt;
      if (since >= 1 / TICK_HZ - 1e-9) {
        since = 0;
        let ms = t * 1000 + 40 + rand() * o.jitterMs;
        const phase = (t * 1000) % 3000;
        if (o.spikeMs && phase < o.spikeMs) ms = Math.max(ms, t * 1000 - phase + o.spikeMs + 40);
        lastArrival = Math.floor(Math.max(ms, lastArrival));
        inFlight.push({ ms: lastArrival, pose: at(body.x, body.z, body.y) });
      }
      while (inFlight.length && inFlight[0].ms <= t * 1000) {
        const { ms, pose } = inFlight.shift()!;
        allowance = refillAllowance(allowance, (ms - lastMs) / 1000);
        lastMs = ms;
        const r = checkPose(lastGood, track, pose, ms, allowance, o.surface);
        if (r.result === 'ok') {
          allowance -= Math.hypot(pose.x - lastGood.x, pose.z - lastGood.z);
          lastGood = { x: pose.x, z: pose.z };
        } else {
          refused++;
          if (!track.grounded) landAirTrack(track, o.surface(lastGood.x, lastGood.z)!);
          correction = { ms: ms + 40, ...lastGood, y: track.y };
        }
      }
    }
    return refused;
  }

  for (const [name, surface] of [['flat ground', flat], ['hills', hills]] as const) {
    for (const jump of [true, false]) {
      it(`${jump ? 'holding jump' : 'running'} on ${name}: 10–144 fps, frame hitches up to 400 ms, jitter up to 100 ms`, () => {
        const failures: string[] = [];
        for (const fps of [10, 30, 60, 144]) for (const hitchMs of [0, 200, 400]) for (const jitterMs of [0, 100]) {
          const n = honest({ fps, hitchMs, jitterMs, spikeMs: 0, surface, jump });
          if (n) failures.push(`${fps} fps, hitch ${hitchMs}, jitter ${jitterMs}: ${n}`);
        }
        expect(failures).toEqual([]);
      });
    }
    it(`holding jump on ${name} through network lag spikes of 200 and 400 ms every 3 s`, () => {
      const failures: string[] = [];
      for (const fps of [30, 60]) for (const spikeMs of [200, 400]) {
        const n = honest({ fps, hitchMs: 0, jitterMs: 10, spikeMs, surface, jump: true });
        if (n) failures.push(`${fps} fps, spike ${spikeMs}: ${n}`);
      }
      expect(failures).toEqual([]);
    });
  }
});

describe('checkPose when a body slides round an obstacle', () => {
  for (const r of [0.2, 0.5, 1.2]) {
    it(`accepts running into a post of radius ${r} m and sliding round it, on foot and in the air`, () => {
      const post: Surface = (x, z) => (Math.hypot(x - 3, z - 0.05) < r ? null : 0);
      for (const dt of DTS) for (const jumpAt of [null, 1.5, 2.2]) {
        const c = new SimClient(post, 0, 0, dt);
        let jumped = false;
        for (let t = 0; t < 3; t += dt) {
          const jump = jumpAt !== null && !jumped && c.body.x >= jumpAt;
          if (jump) jumped = true;
          c.frame({ vx: RUN_SPEED, vz: 0.8, jump }); // mostly head-on, so it slides along the post's edge
        }
        expect(c.body.x, `got past (dt ${dt}, jump ${jumpAt})`).toBeGreaterThan(3);
        expect(rejected(replay(post, { x: 0, z: 0, y: 0 }, c.sent)), `dt ${dt}, jump ${jumpAt}`).toEqual([]);
      }
    });
  }

  it('accepts sliding round the corner of a square block', () => {
    const block: Surface = (x, z) => (x > 2 && x < 4 && z > -2 && z < 0.1 ? null : 0);
    for (const dt of DTS) {
      const c = new SimClient(block, 0, 0, dt);
      for (let t = 0; t < 1.5; t += dt) c.frame({ vx: RUN_SPEED * 0.8, vz: RUN_SPEED * 0.6, jump: false });
      expect(c.body.x).toBeGreaterThan(3);
      expect(rejected(replay(block, { x: 0, z: 0, y: 0 }, c.sent)), `dt ${dt}`).toEqual([]);
    }
  });

  for (const deg of [30, 45, 60]) {
    it(`refuses crossing a 0.3 m thick wall at ${deg} degrees, at any offset along it`, () => {
      const c = Math.cos((deg * Math.PI) / 180), sn = Math.sin((deg * Math.PI) / 180);
      // a long wall through (1.5, 0), its normal at `deg` to the path's +x
      const wall: Surface = (x, z) => (Math.abs((x - 1.5) * c + z * sn) < 0.15 ? null : 0);
      for (const len of [0.4, 0.6, 1, 1.6]) for (let z0 = -0.3; z0 <= 0.3; z0 += 0.05) {
        const from = { x: 1.5 - len / 2, z: z0 }, to = at(1.5 + len / 2, z0, 0);
        if (wall(from.x, from.z) === null || wall(to.x, to.z) === null) continue;
        const side = (p: { x: number; z: number }) => Math.sign((p.x - 1.5) * c + p.z * sn);
        if (side(from) === side(to)) continue; // this step does not cross the wall
        expect(checkPose(from, makeAirTrack(0), to, 1000, 5, wall).result, `len ${len}, z ${z0.toFixed(2)}`).toBe('blocked');
      }
    });
  }

  it('still refuses a step through a wall 1 m long', () => {
    const wall: Surface = (x, z) => (x > 1.1 && x < 1.4 && Math.abs(z) < 0.5 ? null : 0);
    expect(checkPose({ x: 0.8, z: 0 }, makeAirTrack(0), at(1.7, 0, 0), 1000, 5, wall).result).toBe('blocked');
    expect(checkPose({ x: 0.8, z: 0.25 }, makeAirTrack(0), at(1.7, 0.25, 0), 1000, 5, wall).result).toBe('blocked');
    // clipping its end by a few centimetres is going round it
    expect(checkPose({ x: 0.8, z: 0.45 }, makeAirTrack(0), at(1.7, 0.45, 0), 1000, 5, wall).result).toBe('ok');
  });
});

describe('checkPose against honest clients wandering the grove', () => {
  it('accepts every pose of 24 seeded runs of 20 s: running, turning, tapping and holding jump', () => {
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const surface = groveTownSurface;
    const starts = [SPAWN, { x: 30, z: -24 }, { x: 12, z: 22 }, { x: -20, z: -30 }];
    for (let run = 0; run < 24; run++) {
      const dt = DTS[run % DTS.length];
      const st = starts[run % starts.length];
      expect(surface(st.x, st.z), `start ${run}`).not.toBeNull();
      const c = new SimClient(surface, st.x, st.z, dt);
      let heading = rand() * Math.PI * 2, hold = 0;
      for (let t = 0; t < 20; t += dt) {
        if (rand() < dt * 0.7) heading += (rand() - 0.5) * 2.5;
        if (hold <= 0 && rand() < dt * 0.5) hold = rand() < 0.5 ? dt : 0.5 + rand() * 2; // a tap, or jump held
        c.frame({ vx: Math.sin(heading) * RUN_SPEED, vz: Math.cos(heading) * RUN_SPEED, jump: hold > 0 });
        hold -= dt;
      }
      expect(c.steps.some((s) => s.jumped), `run ${run} jumps`).toBe(true);
      const results = replay(surface, { x: st.x, z: st.z, y: surface(st.x, st.z)! }, c.sent);
      expect(rejected(results), `run ${run} (dt ${dt.toFixed(4)})`).toEqual([]);
    }
  });
});

describe('landAirTrack', () => {
  it('puts a track on the ground and returns how far it fell from its highest point', () => {
    const track: AirTrack = { grounded: false, airStartMs: 1000, airStartY: 4.5, peakY: 5, y: 3 };
    expect(landAirTrack(track, 0)).toBe(5);
    expect(track).toEqual(makeAirTrack(0));
    expect(landAirTrack(makeAirTrack(2), 2)).toBe(0);
    expect(landAirTrack({ grounded: false, airStartMs: 0, airStartY: 0, peakY: 0.5, y: 0.4 }, 0.9)).toBe(0); // never negative
  });
});

describe('checkPose over the grove', () => {
  const surface = groveTownSurface;
  /** Platform rects of the baked grove whose top is `rise` above the terrain at their centre. */
  const platforms = (near: Pt, within: number) =>
    GROVE_OBSTACLES.filter((o): o is Rect => o.kind === 'r' && o.top !== undefined && Math.hypot(o.x - near.x, o.z - near.z) < within);
  /** World point from a rect's local coordinates. */
  const world = (o: Rect, lx: number, lz: number) => ({ x: o.x + o.c * lx + o.s * lz, z: o.z - o.s * lx + o.c * lz });
  const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

  it('accepts jumping onto a plaza bench', () => {
    const bench = platforms({ x: 0, z: 0 }, PLAZA_R).find((o) => Math.abs(o.top! - groundHeight(o.x, o.z) - 0.5) < 0.05)!;
    expect(bench).toBeDefined();
    for (const side of [-1, 1]) {
      const from = world(bench, 0, side * (bench.hd + 2.5));
      if (surface(from.x, from.z) === null) continue;
      const c = new SimClient(surface, from.x, from.z, 1 / 60);
      const y0 = c.body.y;
      let landed = false;
      for (let jd = 1; jd <= 2.4 && !landed; jd += 0.1) {
        const t = c.clone();
        t.run(bench.x, bench.z, jd, 2, 0.05);
        if (!t.body.grounded || !close(t.body.y, bench.top!)) continue;
        landed = true;
        expect(rejected(replay(surface, { x: from.x, z: from.z, y: y0 }, t.sent))).toEqual([]);
      }
      expect(landed).toBe(true);
      return;
    }
    throw new Error('no free side to jump onto the bench from');
  });

  it('accepts climbing every tier of the Old Lookout, then dropping 4.5 m off its sheer side', () => {
    const tiers = platforms({ x: 34, z: -27 }, 6).filter((o) => o.hw > 1.5).sort((a, b) => a.top! - b.top!);
    expect(tiers).toHaveLength(5);
    const ledge = (i: number) => {
      const t = tiers[i], out: Pt[] = [];
      for (let lx = -t.hw + 0.2; lx < t.hw; lx += 0.4) for (let lz = -t.hd + 0.2; lz < t.hd; lz += 0.4) {
        const p = world(t, lx, lz);
        if (close(surface(p.x, p.z), t.top!)) out.push(p);
      }
      return out;
    };
    const t0 = tiers[0];
    const start = [world(t0, -t0.hw - 2, 0), world(t0, t0.hw + 2, 0)].find((p) => {
      const s = surface(p.x, p.z);
      return s !== null && s < t0.top! - 0.5;
    })!;
    expect(start).toBeDefined();
    let c = new SimClient(surface, start.x, start.z, 1 / 60);
    const begin = { ...start, y: c.body.y };
    for (let i = 0; i < tiers.length; i++) {
      const goal = ledge(i);
      const gx = goal.reduce((s, p) => s + p.x, 0) / goal.length, gz = goal.reduce((s, p) => s + p.z, 0) / goal.length;
      const starts = i === 0 ? [{ x: c.body.x, z: c.body.z }] : ledge(i - 1);
      let made: SimClient | null = null;
      for (const st of starts) {
        const s = c.clone();
        s.run(st.x, st.z, null, 4, 0.05);
        for (let jd = 0; jd <= 3 && !made; jd += 0.25) {
          const t = s.clone();
          t.run(gx, gz, jd, 3);
          if (t.body.grounded && close(surface(t.body.x, t.body.z), tiers[i].top!)) made = t;
        }
        if (made) break;
      }
      expect(made, `reach tier ${i + 1}`).not.toBeNull();
      c = made!;
    }
    const top = tiers[4];
    c.run(top.x, top.z, null, 2, 0.05);
    c.idle(0.2);
    const far = world(top, top.hw + 4, 0); // the sheer side is local +X
    c.run(far.x, far.z, null, 3);
    c.idle(0.2);
    const land = c.steps.at(-1 - c.steps.slice().reverse().findIndex((s) => s.landed))!;
    expect(Math.abs(land.drop - 4.5)).toBeLessThanOrEqual(0.1);

    const results = replay(surface, begin, c.sent);
    expect(rejected(results)).toEqual([]);
    const fall = Math.max(...results.map((r) => r.landedDrop));
    expect(Math.abs(fall - 4.5)).toBeLessThanOrEqual(0.15);
    expect(fallDamage(fall)).toBe(15);
  });
});
