import { describe, expect, it } from 'vitest';
import { simulateDisplacement, dodgeDisplacement, knockDisplacement, DODGE_DISTANCE, DODGE_S, KNOCK_MAX_VY, ENEMY_ATTACKS } from './index';
import { fallDamage, type Surface } from '../body';
import { checkPose, makeAirTrack } from '../movement';
import { TICK_HZ } from '../constants';

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
