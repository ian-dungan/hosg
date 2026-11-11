import { describe, expect, it } from 'vitest';
import {
  parsePose, checkStep, checkMove, checkPose, jumpCeiling, landAirTrack, makeAirTrack, refillAllowance,
  MAX_MOVE_ALLOWANCE, MAX_MOVE_SPEED, type AirTrack, type Pose,
} from './movement';
import { makeBody, stepBody, fallDamage, type Body, type BodyInput, type BodyStep, type Surface } from './body';
import { groveWalkable, groveTownWalkable, groveTownSurface, groveGroundY, groundHeight, BEACON_C, PLAZA_R, type Rect } from './world/layout';
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
    expect(parsePose({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: false })).toEqual({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: false });
    expect(parsePose({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: true, extra: 'x' })).toEqual({ x: 1, z: 2, y: 0.3, facing: 0.5, moving: true });
  });
});

describe('checkStep', () => {
  const open = () => true;
  it('allows a normal running step', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, y: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('ok');
  });
  it('rejects a step longer than RUN_SPEED * 1.3 * dt + 0.5', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 2000, z: 0, y: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 6 * 1.3 + 0.5 + 0.01, z: 0, y: 0, facing: 0, moving: true }, 1, open)).toBe('too-fast');
  });
  it('caps dt at 1 second', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 9, z: 0, y: 0, facing: 0, moving: true }, 10, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 8, z: 0, y: 0, facing: 0, moving: true }, 10, open)).toBe('ok');
  });
  it('treats a non-finite dt as no time at all', () => {
    const step = { x: 2, z: 0, y: 0, facing: 0, moving: true };
    expect(checkStep({ x: 0, z: 0 }, step, NaN, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, step, Infinity, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, y: 0, facing: 0, moving: true }, NaN, open)).toBe('ok');
  });
  it('reports blocked when the target is not walkable', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, y: 0, facing: 0, moving: true }, 1 / 15, () => false)).toBe('blocked');
  });
});

describe('checkStep along the segment', () => {
  it('is blocked by an obstacle thinner than the step, between from and to', () => {
    const fence = (x: number) => !(x > 1.1 && x < 1.4); // a 0.3 m strip
    expect(checkStep({ x: 0, z: 0 }, { x: 2, z: 0, y: 0, facing: 0, moving: true }, 1, fence)).toBe('blocked');
    expect(checkStep({ x: 0, z: 0 }, { x: 1, z: 0, y: 0, facing: 0, moving: true }, 1, fence)).toBe('ok');
    expect(checkStep({ x: 1.5, z: 0 }, { x: 3, z: 0, y: 0, facing: 0, moving: true }, 1, fence)).toBe('ok');
  });
});

describe('movement allowance', () => {
  const open = () => true;
  it('refills at MAX_MOVE_SPEED, capped at one second plus the slack', () => {
    expect(MAX_MOVE_ALLOWANCE).toBeCloseTo(6 * 1.3 + 0.5);
    expect(refillAllowance(0, 0.5)).toBeCloseTo(MAX_MOVE_SPEED * 0.5);
    expect(refillAllowance(0, 10)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(MAX_MOVE_ALLOWANCE - 0.1, 1)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(1, NaN)).toBe(1);
    expect(refillAllowance(1, -5)).toBe(1);
  });
  it('a burst of small steps runs out of allowance', () => {
    let allowance = MAX_MOVE_ALLOWANCE;
    let at = { x: 0, z: 0 };
    let accepted = 0;
    for (let i = 1; i <= 40; i++) {
      const to = { x: i * 0.4, z: 0, y: 0, facing: 0, moving: true };
      if (checkMove(at, to, allowance, open) !== 'ok') break;
      allowance -= 0.4;
      at = to;
      accepted++;
    }
    expect(accepted).toBe(Math.floor(MAX_MOVE_ALLOWANCE / 0.4));
  });
});

describe('grove walkability', () => {
  it('spawn is walkable, the statue plinth and far away are not', () => {
    expect(groveWalkable(SPAWN.x, SPAWN.z)).toBe(true);
    expect(groveWalkable(0, -11)).toBe(true);
    expect(groveWalkable(0, 0)).toBe(false);
    expect(groveWalkable(5000, 5000)).toBe(false);
  });
  it('groveTownWalkable is the town area only: the far Beacon clearing does not count', () => {
    expect(groveWalkable(BEACON_C.x, BEACON_C.z)).toBe(true); // standable for the client's anchors
    expect(groveTownWalkable(BEACON_C.x, BEACON_C.z)).toBe(false);
    expect(groveTownWalkable(SPAWN.x, SPAWN.z)).toBe(true);
    expect(groveTownWalkable(0, 0)).toBe(false);
    expect(groveTownWalkable(5000, 5000)).toBe(false);
  });
  it('groveGroundY gives terrain height where walkable and null elsewhere', () => {
    expect(groveGroundY(0, -11)).toBe(groundHeight(0, -11));
    expect(groveGroundY(0, 0)).toBeNull();
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

  it('rejects hovering at y = 1 for 2 s as floating', () => {
    const track = makeAirTrack(0);
    const results: string[] = [];
    for (let i = 1; i <= 30; i++) {
      const r = checkPose({ x: 0, z: 0 }, track, at(0, 0, 1), 1000 + (i * 1000) / TICK_HZ, 5, flat);
      results.push(r.result);
    }
    expect(results).toContain('floating');
    expect(results.at(-1)).toBe('floating');
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

  it('never lets an expired track rise or hover', () => {
    // in the air, at the same height or higher
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 1), 3000, 5, flat).result).toBe('floating');
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 0.5), 3000, 5, flat).result).toBe('floating');
    // "landing" on something higher than its last height
    const crate: Surface = (x) => (x > 0.1 ? 1.5 : 0);
    expect(checkPose({ x: 0, z: 0 }, airborne(1), at(0.2, 0, 1.5), 3000, 5, crate).result).toBe('floating');
    // hovering: the same airborne pose over and over is refused
    const track = airborne(1);
    const results = Array.from({ length: 10 }, (_, i) => checkPose({ x: 0, z: 0 }, track, at(0, 0, 1), 3000 + i * 67, 5, flat).result);
    expect(results.every((r) => r === 'floating')).toBe(true);
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
