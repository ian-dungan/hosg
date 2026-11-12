import { describe, expect, it } from 'vitest';
import { simulateDisplacement, dodgeDisplacement, knockDisplacement, DODGE_DISTANCE, DODGE_S, KNOCK_MAX_VY, ENEMY_ATTACKS } from './index';
import { fallDamage, type Surface } from '../body';
import { checkPose, makeAirTrack } from '../movement';
import { TICK_HZ } from '../constants';
import { groveTownSurface } from '../world/layout';

const flat: Surface = () => 0;

describe('dodgeDisplacement and knockDisplacement', () => {
  it('a dodge is DODGE_DISTANCE over DODGE_S along the normalised direction, with no lift', () => {
    const d = dodgeDisplacement(3, 4);
    expect(d.vx).toBeCloseTo(0.6 * DODGE_DISTANCE / DODGE_S, 9);
    expect(d.vz).toBeCloseTo(0.8 * DODGE_DISTANCE / DODGE_S, 9);
    expect(Math.hypot(d.vx, d.vz)).toBeCloseTo(15, 9);
    expect(d.vy).toBe(0);
    expect(d.seconds).toBe(DODGE_S);
  });
  it('a knock pushes away from its source, or along the line, and caps the lift', () => {
    const k = knockDisplacement({ x: 0, z: 0 }, { x: 0, z: -2 }, { speed: 10, seconds: 0.35, vy: 4 });
    expect(k.vx).toBeCloseTo(0, 9); expect(k.vz).toBeCloseTo(-10, 9); expect(k.vy).toBe(4); expect(k.seconds).toBe(0.35);
    const l = knockDisplacement({ x: 0, z: 0 }, { x: 0, z: -2 }, { speed: 10, seconds: 0.35, vy: 4 }, Math.PI / 2);
    expect(l.vx).toBeCloseTo(10, 9); expect(l.vz).toBeCloseTo(0, 9);
    expect(knockDisplacement({ x: 0, z: 0 }, { x: 1, z: 0 }, { speed: 1, seconds: 1, vy: 50 }).vy).toBe(KNOCK_MAX_VY);
    expect(Math.hypot(...(() => { const z = knockDisplacement({ x: 1, z: 1 }, { x: 1, z: 1 }, { speed: 10, seconds: 0.3, vy: 0 }); return [z.vx, z.vz]; })())).toBeCloseTo(10, 9);
  });
});

describe('simulateDisplacement', () => {
  it('on flat ground a dodge travels 4.5 m in 0.3 s and ends grounded, sampled at TICK_HZ and at the end', () => {
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), flat);
    expect(r.x).toBeCloseTo(4.5, 1);
    expect(Math.abs(r.x - 4.5)).toBeLessThanOrEqual(0.05);
    expect(r.z).toBeCloseTo(0, 9);
    expect(r.y).toBe(0);
    expect(r.drop).toBe(0);
    expect(r.seconds).toBeCloseTo(0.3, 9);
    expect(r.path.length).toBe(Math.ceil(0.3 * 15) + 1);
    expect(r.path[0]).toEqual({ t: 0, x: 0, z: 0, y: 0 });
    for (let i = 1; i < r.path.length - 1; i++) expect(r.path[i].t).toBeCloseTo(i / TICK_HZ, 9);
    expect(r.path[r.path.length - 1]).toEqual({ t: r.seconds, x: r.x, z: r.z, y: r.y });
  });
  it('stops before a wall', () => {
    const wall: Surface = (x) => (x >= 3 && x <= 4 ? null : 0);
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), wall);
    expect(r.x).toBeLessThan(3);
    expect(r.x).toBeGreaterThan(2.85);
  });
  it('never crosses a 0.25 m-thick wall at 15 m/s, wherever it starts and at any angle', () => {
    for (let off = 0; off < 1; off += 0.013) {
      for (const deg of [0, 20, 45, 70]) {
        const w0 = 2 + off;
        const wall: Surface = (x) => (x >= w0 && x <= w0 + 0.25 ? null : 0);
        const a = (deg * Math.PI) / 180;
        const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(Math.cos(a), Math.sin(a)), wall);
        expect(r.x).toBeLessThan(w0);
        for (const p of r.path) expect(p.x).toBeLessThan(w0);
      }
    }
  });
  it('knocked off a 5 m ledge: drop 5, and the fall damage that brings', () => {
    const ledge: Surface = (x) => (x < 2 ? 5 : 0);
    const r = simulateDisplacement({ x: 0, z: 0, y: 5 }, dodgeDisplacement(1, 0), ledge);
    expect(Math.abs(r.drop - 5)).toBeLessThanOrEqual(0.1);
    expect(fallDamage(r.drop)).toBe(20);
    expect(r.y).toBe(0);
    expect(r.seconds).toBeGreaterThan(0.3); // kept falling after the push ended
    const k = knockDisplacement({ x: -1, z: 0 }, { x: 0, z: 0 }, { speed: 10, seconds: 0.35, vy: 0 });
    const r2 = simulateDisplacement({ x: 0, z: 0, y: 5 }, k, ledge);
    expect(Math.abs(r2.drop - 5)).toBeLessThanOrEqual(0.1);
  });
  it('a launch lifts off the ground and lands again', () => {
    const g = ENEMY_ATTACKS.ground_slam.knock!;
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, knockDisplacement({ x: -1, z: 0 }, { x: 0, z: 0 }, g), flat);
    expect(Math.max(...r.path.map((p) => p.y))).toBeGreaterThan(0.3);
    expect(r.y).toBe(0);
    expect(r.x).toBeCloseTo(12 * 0.4, 1);
    expect(r.seconds).toBeGreaterThanOrEqual(0.4);
  });
  it('a launch with vy 5: every path sample, fed through checkPose at 15 Hz, is accepted', () => {
    const d = knockDisplacement({ x: 0, z: -1 }, { x: 0, z: 0 }, { speed: 12, seconds: 0.4, vy: 5 });
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, d, flat);
    const track = makeAirTrack(0);
    let from = { x: 0, z: 0 };
    const t0 = 10_000;
    for (const p of r.path.slice(1)) {
      const out = checkPose(from, track, { x: p.x, z: p.z, y: p.y, facing: 0, moving: true }, t0 + p.t * 1000, Infinity, flat);
      expect(out.result).toBe('ok');
      from = { x: p.x, z: p.z };
    }
    expect(track.grounded).toBe(true);
  });
  it('ends at DISPLACE_MAX_S over a bottomless drop', () => {
    const pit: Surface = (x) => (x < 1 ? 0 : -1000);
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), pit);
    expect(r.seconds).toBeCloseTo(3, 9);
    expect(r.path[r.path.length - 1].t).toBeCloseTo(3, 9);
  });
  it('the same input gives the same result, bit for bit', () => {
    const s: Surface = (x, z) => (Math.abs(x - 3) < 0.4 ? 1.2 : 0.1 * Math.floor(z));
    const d = knockDisplacement({ x: 0, z: 0 }, { x: 0.3, z: 0.7 }, { speed: 12, seconds: 0.4, vy: 5 });
    const a = simulateDisplacement({ x: 0.3, z: 0.7, y: 0 }, d, s);
    const b = simulateDisplacement({ x: 0.3, z: 0.7, y: 0 }, d, s);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z)).toBe(true);
  });
});

// ───────── fix round 1: a displacement never adds reachable height, never climbs what walking cannot ─────────

/** What one honest jump from the ground reaches: its apex plus a rim it can ride (≈ 1.80 m). */
const JUMP_REACH = (8 * 8) / (2 * 22) + 0.35;
const slam = ENEMY_ATTACKS.ground_slam.knock!;
const gore = ENEMY_ATTACKS.gore_charge.knock!;
const knockX = (k: { speed: number; seconds: number; vy: number }) => knockDisplacement({ x: -1, z: 0 }, { x: 0, z: 0 }, k);
const onTop = (r: { path: { x: number; y: number }[] }, edge: number, h: number) => r.path.some((p) => p.x >= edge && p.y >= h - 0.05);

/** Feeds every path sample through checkPose (allowance Infinity) from the start's track; returns the results. */
function replayPath(r: ReturnType<typeof simulateDisplacement>, surface: Surface, start: { x: number; z: number; y: number }) {
  const g0 = surface(start.x, start.z)!;
  const track = start.y <= g0 + 0.05 ? makeAirTrack(g0)
    : { grounded: false, airStartMs: -(8 / 22) * 1000, airStartY: g0, peakY: r.path[0].y, y: r.path[0].y };
  let from = { x: r.path[0].x, z: r.path[0].z };
  return r.path.slice(1).map((p) => {
    const out = checkPose(from, track, { x: p.x, z: p.z, y: p.y, facing: 0, moving: true }, p.t * 1000, Infinity, surface);
    if (out.result === 'ok') from = { x: p.x, z: p.z };
    return out.result;
  });
}

describe('simulateDisplacement never adds reachable height', () => {
  for (const H of [2.1, 2.3, 2.9]) {
    it(`a knock at the top of an honest jump (y 1.45) never lands on a ${H} m ledge`, () => {
      const s: Surface = (x) => (x >= 1 ? H : 0);
      for (const k of [slam, gore, { speed: 12, seconds: 0.4, vy: 6 }]) {
        const r = simulateDisplacement({ x: 0, z: 0, y: 1.45 }, knockX(k), s);
        expect(onTop(r, 1, H)).toBe(false);
        expect(r.grounded).toBe(true);
        expect(r.y).toBe(0);
        expect(Math.max(...r.path.map((p) => p.y))).toBeLessThanOrEqual(1.45);
      }
    });
    it(`from a 2.0 m hover neither a dodge nor a knock lands on a ${H} m ledge`, () => {
      const s: Surface = (x) => (x >= 2 ? H : 0);
      for (const sx of [0, 1, 1.95]) {
        expect(onTop(simulateDisplacement({ x: sx, z: 0, y: 2.0 }, dodgeDisplacement(1, 0), s), 2, H)).toBe(false);
        expect(onTop(simulateDisplacement({ x: sx, z: 0, y: 2.0 }, knockX(slam), s), 2, H)).toBe(false);
      }
    });
  }
  it('an airborne start gets no lift, and one above one jump is brought down to 2 m first', () => {
    const r = simulateDisplacement({ x: 0, z: 0, y: 1.0 }, knockX(slam), flat);
    expect(Math.max(...r.path.map((p) => p.y))).toBeLessThanOrEqual(1.0);
    const hi = simulateDisplacement({ x: 0, z: 0, y: 7 }, dodgeDisplacement(1, 0), flat);
    expect(hi.path[0].y).toBe(2);
    expect(Math.max(...hi.path.map((p) => p.y))).toBeLessThanOrEqual(2);
  });
  it('a grounded knock still lifts, and lands only on rims within its own arc', () => {
    for (const H of [0.6, 0.9, 1.2, 1.5]) {
      const s: Surface = (x) => (x >= 1 ? H : 0);
      const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, knockX(slam), s);
      const reach = (5 * 5) / 44 + 0.35; // vy 5
      expect(onTop(r, 1, H)).toBe(H <= reach);
    }
  });
});

describe('simulateDisplacement climbs only what walking can', () => {
  const slope = (g: number) => (x: number) => Math.max(0, Math.min(6, x * g));
  for (const g of [3, 2]) {
    it(`a grounded dodge stops on a ${g}:1 slope`, () => {
      const s = slope(g);
      for (const sx of [-1, -0.5, -0.1, 0]) {
        const r = simulateDisplacement({ x: sx, z: 0, y: 0 }, dodgeDisplacement(1, 0), s);
        expect(r.y).toBeLessThanOrEqual(0.35 + 1e-9);
        expect(r.grounded).toBe(true);
        expect(replayPath(r, s, { x: sx, z: 0, y: 0 }).every((v) => v === 'ok')).toBe(true);
      }
    });
  }
  it('a grounded dodge runs up a 1:1 slope', () => {
    const s = slope(1);
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), s);
    expect(r.x).toBeCloseTo(4.5, 1);
    expect(r.y).toBeCloseTo(4.5, 1);
    expect(replayPath(r, s, { x: 0, z: 0, y: 0 }).every((v) => v === 'ok')).toBe(true);
  });
});

describe('simulateDisplacement results', () => {
  it('charges every landing: drops lists each, fallHp sums their damage, drop is the largest', () => {
    const terr: Surface = (x) => (x < 1 ? 8 : x < 5 ? 4 : 0);
    const r = simulateDisplacement({ x: 0, z: 0, y: 8 }, knockX({ speed: 4, seconds: 1.5, vy: 0 }), terr);
    expect(r.drops.length).toBe(2);
    expect(r.drops[0]).toBeCloseTo(4, 6);
    expect(r.drops[1]).toBeCloseTo(4, 6);
    expect(r.drop).toBeCloseTo(4, 6);
    expect(r.fallHp).toBe(fallDamage(r.drops[0]) + fallDamage(r.drops[1]));
    expect(r.fallHp).toBe(20);
    const f = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), flat);
    expect(f.drops).toEqual([]);
    expect(f.fallHp).toBe(0);
  });
  it('reports grounded: false when it times out in the air over a pit', () => {
    const pit: Surface = (x) => (x < 1 ? 0 : -1000);
    const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), pit);
    expect(r.grounded).toBe(false);
    expect(simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), flat).grounded).toBe(true);
  });
  it('refuses nonsense without looping: non-finite or absurd speeds, durations and starts', () => {
    // "without looping" is counted in ground probes (deterministic), not in wall-clock time (a busy machine is slow)
    let probes = 0;
    const flatCounted: Surface = (x, z) => { probes++; return flat(x, z); };
    const cases = [
      { vx: NaN, vz: 0, vy: 0, seconds: 0.3 }, { vx: Infinity, vz: 0, vy: 0, seconds: 0.3 }, { vx: 1e12, vz: 0, vy: 0, seconds: 3 },
      { vx: 1, vz: 0, vy: NaN, seconds: 0.3 }, { vx: 1, vz: 0, vy: 1e9, seconds: 0.3 }, { vx: 1, vz: 0, vy: 0, seconds: Infinity },
      { vx: 1, vz: 0, vy: 0, seconds: NaN }, { vx: 1, vz: 0, vy: 0, seconds: -5 },
    ];
    for (const d of cases) {
      const r = simulateDisplacement({ x: 0, z: 0, y: 0 }, d, flatCounted);
      for (const v of [r.x, r.y, r.z, r.seconds, r.drop, r.fallHp]) expect(Number.isFinite(v)).toBe(true);
      expect(r.seconds).toBeLessThanOrEqual(3);
      expect(Math.max(...r.path.map((p) => p.y))).toBeLessThanOrEqual(KNOCK_MAX_VY ** 2 / 44 + 1e-9);
    }
    expect(simulateDisplacement({ x: 0, z: 0, y: 0 }, { vx: 1e12, vz: 0, vy: 0, seconds: 3 }, flatCounted).x).toBe(0);
    const bad = simulateDisplacement({ x: NaN, z: 0, y: 0 }, dodgeDisplacement(1, 0), flatCounted);
    expect(bad.grounded).toBe(false);
    expect(bad.seconds).toBe(0);
    const nowhere = simulateDisplacement({ x: 0, z: 0, y: 0 }, dodgeDisplacement(1, 0), () => null);
    expect(nowhere).toMatchObject({ x: 0, z: 0, y: 0, seconds: 0, grounded: false });
    expect(probes).toBeLessThan(5000); // 153 when written: every case ends after a few probes
  });
});

// ───────── seeded fuzz of the guarantee ─────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
type Disp = Parameters<typeof simulateDisplacement>[1];
function randomDisp(r: () => number): Disp {
  const a = r() * 2 * Math.PI;
  if (r() < 0.5) return dodgeDisplacement(Math.sin(a), Math.cos(a));
  return knockDisplacement({ x: 0, z: 0 }, { x: Math.sin(a), z: Math.cos(a) }, { speed: 4 + r() * 11, seconds: 0.1 + r() * 0.5, vy: r() < 0.3 ? 0 : r() * 6 });
}
/**
 * The guarantee, checked from outside: every sample is over a surface; checkPose accepts each step
 * from the start's track; no sample is more than 2 m, and no ground stood on more than JUMP_REACH,
 * above the highest ground stood on at an earlier sample (the start's ground included), plus what
 * walking could climb since that sample. The scene checks below are exact.
 */
function checkGuarantee(res: ReturnType<typeof simulateDisplacement>, surface: Surface, start: { x: number; z: number; y: number }) {
  const g0 = surface(start.x, start.z)!;
  // checkPose accepts every step, except a straight-down fall at the end (after a cut)
  const results = replayPath(res, surface, start);
  const firstRefused = results.findIndex((v) => v !== 'ok');
  if (firstRefused >= 0) {
    for (let i = firstRefused + 1; i < res.path.length; i++) {
      expect(res.path[i].x).toBe(res.path[firstRefused].x);
      expect(res.path[i].z).toBe(res.path[firstRefused].z);
    }
  }
  // always ends standing on the real surface (no bottomless drops in these scenes)
  expect(res.grounded).toBe(true);
  expect(Math.abs(res.y - surface(res.x, res.z)!)).toBeLessThanOrEqual(1e-9);
  let ground = g0, prev = res.path[0], walkedRise = 0, prevGrounded = true;
  for (const p of res.path) {
    const s = surface(p.x, p.z);
    expect(s).not.toBeNull();
    const grounded = p.y <= s! + 0.05;
    const step = Math.hypot(p.x - prev.x, p.z - prev.z);
    // legal walking: a grounded-to-grounded stretch rising at most STEP_UP per 0.25 m
    if (grounded && prevGrounded && p !== prev && p.y - prev.y <= 0.35 * Math.ceil(step / 0.25 - 1e-9) + 1e-9) walkedRise += Math.max(0, p.y - prev.y);
    // the absolute bound: never more than 2 m above the ground under the start, except by legal walking
    expect(p.y).toBeLessThanOrEqual(g0 + 2.0 + walkedRise + 1e-9);
    // between two samples the body may land and then walk up (at most STEP_UP per 0.25 m)
    const walked = (0.35 * step) / 0.25;
    expect(p.y).toBeLessThanOrEqual(ground + 2.0 + walked + 1e-9);
    if (grounded) {
      // a landing is at most 1.65 m (AIR_CAP − STEP_UP) above that ground, and a short walk adds STEP_UP
      expect(s!).toBeLessThanOrEqual(ground + 2.0 + walked + 1e-9);
      ground = Math.max(ground, s!);
    }
    prev = p; prevGrounded = grounded;
  }
}

describe('simulateDisplacement guarantee (seeded fuzz)', () => {
  it('on random ledge, wall and slope scenes', () => {
    const r = rng(12345);
    for (let n = 0; n < 1500; n++) {
      const H = r() * 4, L = 0.5 + r() * 3, W = -3 - r() * 2, T = 0.25 + r() * 0.5, g = r() * 4;
      const kind = Math.floor(r() * 4);
      const steep = [4, 6, 1.6, 2.56][Math.floor(r() * 4)];
      const surface: Surface = (x) => {
        if (x >= W - T && x <= W) return null; // a wall behind
        if (kind === 0) return x >= L ? H : 0; // a cliff ahead
        if (kind === 1) return x >= L ? Math.min(6, (x - L) * g) : 0; // a slope ahead
        if (kind === 3) return x >= L ? Math.min(5, (x - L) * steep) : 0; // a steep ramp ahead (4:1, 6:1, ...)
        return x >= L && x <= L + T ? null : 0; // a thin wall ahead
      };
      const sx = W + 0.3 + r() * (L - W - 0.3), sz = r() * 4 - 2;
      const airborne = r() < 0.5;
      const start = { x: sx, z: sz, y: airborne ? r() * 3 : 0 };
      const d = randomDisp(r);
      const res = simulateDisplacement(start, d, surface);
      checkGuarantee(res, surface, start);
      for (let i = 1; i < res.path.length; i++) {
        const a = res.path[i - 1], b = res.path[i];
        // walls of 0.25 m or more are never crossed
        expect((a.x < W - T && b.x > W) || (a.x > W && b.x < W - T)).toBe(false);
        if (kind === 2) expect((a.x < L && b.x > L + T) || (a.x > L + T && b.x < L)).toBe(false);
      }
      if (kind === 0 && H > JUMP_REACH) expect(onTop(res, L, H)).toBe(false);
      // a steep ramp: the flight stays within 2 m; any height above that is legal walking (sliding
      // along the ramp in short level steps and stairs), which checkGuarantee accounts for
      if (kind === 3) checkFlight(res, surface, start);
      // pushed straight at the ramp there is no sliding, so nothing climbs past 2 m at all
      if (kind === 3 && d.vz === 0) for (const p of res.path) expect(p.y).toBeLessThanOrEqual(2.0 + 1e-9);
      if (kind === 1 && (g * Math.abs(d.vx)) / Math.hypot(d.vx, d.vz) >= 1.45 && !airborne && d.vy === 0) { // too steep along the push
        for (const p of res.path) if (p.x >= L) expect(p.y).toBeLessThanOrEqual(0.35 + 0.01); // the slope window interpolates between 0.1 m steps across the foot
      }
    }
  });
  it('on the grove', () => {
    const r = rng(777);
    let tried = 0;
    while (tried < 600) {
      const x = -60 + r() * 120, z = -60 + r() * 120;
      const g0 = groveTownSurface(x, z);
      if (g0 === null) continue;
      tried++;
      const start = { x, z, y: r() < 0.5 ? g0 : g0 + r() * 2.5 };
      checkGuarantee(simulateDisplacement(start, randomDisp(r), groveTownSurface), groveTownSurface, start);
    }
  });
});

// ───────── fix round 2: launches riding up steep ramps; falls the movement checks would refuse ─────────

/** Up to its first grounded sample, a displacement is never more than 2 m above the start's ground. */
function checkFlight(res: ReturnType<typeof simulateDisplacement>, surface: Surface, start: { x: number; z: number; y: number }) {
  const g0 = surface(start.x, start.z)!;
  for (const p of res.path.slice(1)) {
    expect(p.y).toBeLessThanOrEqual(g0 + 2.0 + 1e-9);
    if (p.y <= surface(p.x, p.z)! + 0.05) break;
  }
}

describe('simulateDisplacement on steep ramps (rotated, every start before the foot)', () => {
  const knocks = [ENEMY_ATTACKS.gore_charge.knock!, ENEMY_ATTACKS.ground_slam.knock!, { speed: 15, seconds: 0.5, vy: 6 }];
  it('standing at the foot of a 4:1 ramp, a Ground Slam does not carry the body more than 2 m up', () => {
    const ramp: Surface = (x) => Math.max(0, Math.min(5, x * 4));
    for (const sx of [-2, -1.5, -1, -0.8, -0.5, -0.3, -0.1, 0]) {
      const r = simulateDisplacement({ x: sx, z: 0, y: 0 }, knockDisplacement({ x: sx - 1, z: 0 }, { x: sx, z: 0 }, slam), ramp);
      for (const p of r.path) expect(p.y).toBeLessThanOrEqual(2.0 + 1e-9);
      expect(r.grounded).toBe(true);
    }
  });
  it('sweep: 1.6:1 to 6:1 ramps at 24 rotations, knocks toward them from 0–6 m away (the review’s grid)', () => {
    let runs = 0;
    for (const slope of [1.6, 2, 2.56, 3, 4, 6]) {
      for (let ri = 0; ri < 24; ri++) {
        const rot = (ri * Math.PI) / 12 + 0.07, c = Math.cos(rot), s = Math.sin(rot);
        const surf: Surface = (X, Z) => { const x = X * c + Z * s; return Math.abs(x) > 14 ? null : Math.max(0, Math.min(5, x * slope)); };
        for (let i = -60; i <= 0; i++) {
          const sx = i * 0.1, x = sx * c, z = sx * s;
          for (const k of knocks) {
            const start = { x, z, y: 0 };
            const r = simulateDisplacement(start, knockDisplacement({ x: x - c, z: z - s }, { x, z }, k), surf);
            // a rotated ramp can be walked up sideways (sliding along it is shallow enough): that
            // climb is legal walking, checked by checkGuarantee; the flight itself stays within 2 m
            checkGuarantee(r, surf, start);
            checkFlight(r, surf, start);
            runs++;
          }
        }
      }
    }
    expect(runs).toBe(6 * 24 * 61 * 3);
  });
});

describe('simulateDisplacement always ends on the real surface', () => {
  it('a hover start off the Old Lookout falls all the way down, charged for the fall', () => {
    const x = 35.13, z = -26.25, s0 = groveTownSurface(x, z)!;
    const knocks = [ENEMY_ATTACKS.gore_charge.knock!, slam, { speed: 15, seconds: 0.5, vy: 6 }];
    for (let a = 0; a < 16; a++) {
      const c = Math.cos((a * Math.PI) / 8), s = Math.sin((a * Math.PI) / 8);
      for (const d of [dodgeDisplacement(c, s), ...knocks.map((k) => knockDisplacement({ x: x - c, z: z - s }, { x, z }, k))]) {
        for (const dy of [0, 1.45, 2.0, 2.6]) {
          const start = { x, z, y: s0 + dy };
          const r = simulateDisplacement(start, d, groveTownSurface);
          expect(r.grounded).toBe(true);
          expect(r.y).toBe(groveTownSurface(r.x, r.z));
          expect(r.fallHp).toBe(r.drops.reduce((sum, v) => sum + fallDamage(v), 0));
          checkGuarantee(r, groveTownSurface, start);
        }
      }
    }
  });
  it('a cut fall lands below the cut point and its drop is charged', () => {
    // a 2 m hover over a 4.5 m ledge's top: falling off the edge outlasts the start arc's ceiling
    const ledge: Surface = (x) => (x < 1 ? 4.5 : 0);
    const r = simulateDisplacement({ x: 0, z: 0, y: 6.5 }, dodgeDisplacement(1, 0), ledge);
    expect(r.grounded).toBe(true);
    expect(r.y).toBe(ledge(r.x, r.z));
    expect(r.drops.length).toBe(1);
    expect(r.drop).toBeGreaterThan(4.5);
    expect(r.fallHp).toBe(fallDamage(r.drop));
    const last = r.path[r.path.length - 1];
    expect(last).toEqual({ t: r.seconds, x: r.x, z: r.z, y: r.y });
  });
});
