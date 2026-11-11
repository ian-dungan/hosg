import { describe, expect, it } from 'vitest';
import { makeBody, stepBody, canEnter, fallDamage, type Surface, type Body, type BodyInput } from './body';
import { RUN_SPEED, STEP_UP } from './constants';

const flat: Surface = () => 0;
const box: Surface = (x, z) => (Math.abs(x - 5) <= 1 && Math.abs(z) <= 1 ? 0.8 : 0); // 0.8 m crate at x 4..6
const wall: Surface = (x) => (Math.abs(x - 5) <= 0.15 ? null : 0); // thin wall
const wallTop: Surface = (x) => (Math.abs(x - 5) <= 0.15 ? 0.8 : 0); // 0.3 m-wide, 0.8 m-high wall you can hop
const ledge: Surface = (x) => (x < 0 ? 5 : 0); // 5 m cliff
const step = (h: number): Surface => (x) => (x >= 2 ? h : 0);

const run: BodyInput = { vx: RUN_SPEED, vz: 0, jump: false };
const DT = 1 / 60;

/** Steps the body for `seconds`, calling `each` after every step. */
function sim(b: Body, s: Surface, input: BodyInput | ((b: Body) => BodyInput), seconds: number, dt = DT, each?: (r: ReturnType<typeof stepBody>) => void) {
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    const r = stepBody(b, typeof input === 'function' ? input(b) : input, dt, s);
    each?.(r);
  }
}

describe('makeBody / canEnter', () => {
  it('stands on the surface, or at 0 where there is none', () => {
    expect(makeBody(5, 0, box)).toMatchObject({ x: 5, z: 0, y: 0.8, vy: 0, grounded: true, peakY: 0.8 });
    expect(makeBody(5, 0, wall)).toMatchObject({ y: 0, grounded: true });
  });
  it('canEnter: a surface no higher than STEP_UP above y', () => {
    expect(canEnter(flat, 1, 1, 0)).toBe(true);
    expect(canEnter(box, 5, 0, 0)).toBe(false);
    expect(canEnter(box, 5, 0, 0.8 - STEP_UP)).toBe(true);
    expect(canEnter(wall, 5, 0, 100)).toBe(false);
  });
});

describe('stepBody: walking', () => {
  it('walks at the commanded speed on flat ground', () => {
    const b = makeBody(0, 0, flat);
    sim(b, flat, { vx: 3, vz: 4, jump: false }, 1);
    expect(b.x).toBeCloseTo(3, 6);
    expect(b.z).toBeCloseTo(4, 6);
    expect(b.y).toBe(0);
    expect(b.grounded).toBe(true);
  });
  it('slides along a blocked axis (tries x only, then z only)', () => {
    const b = makeBody(4.7, -2, wall);
    sim(b, wall, { vx: 3, vz: 3, jump: false }, 1);
    expect(b.x).toBeLessThan(4.86);
    expect(wall(b.x, b.z)).not.toBeNull();
    expect(b.z).toBeCloseTo(1, 6);
  });
  it('cannot walk onto the 0.8 m crate', () => {
    const b = makeBody(0, 0, box);
    sim(b, box, run, 2);
    expect(b.x).toBeLessThan(4);
    expect(b.y).toBe(0);
  });
  it('walks up a 0.3 m step without jumping, but not a 0.4 m one', () => {
    const lo = makeBody(0, 0, step(0.3));
    sim(lo, step(0.3), run, 1);
    expect(lo.x).toBeGreaterThan(5);
    expect(lo.y).toBe(0.3);
    const hi = makeBody(0, 0, step(0.4));
    sim(hi, step(0.4), run, 1);
    expect(hi.x).toBeLessThan(2);
    expect(hi.y).toBe(0);
  });
  it('steps down a small drop without leaving the ground', () => {
    const s: Surface = (x) => (x >= 2 ? 0 : 0.3);
    const b = makeBody(0, 0, s);
    let left = false;
    sim(b, s, run, 1, DT, () => { if (!b.grounded) left = true; });
    expect(left).toBe(false);
    expect(b.y).toBe(0);
  });
  it('never enters the thin wall, even with dt = 0.1 at 6 m/s', () => {
    for (const dt of [DT, 0.1, 0.25, 1]) {
      const b = makeBody(0, 0, wall);
      sim(b, wall, run, 3, dt, () => expect(wall(b.x, b.z)).not.toBeNull());
      expect(b.x).toBeLessThan(4.85);
    }
    const j = makeBody(0, 0, wall); // jumping does not get over it either
    sim(j, wall, { ...run, jump: true }, 3, 0.1, () => expect(wall(j.x, j.z)).not.toBeNull());
    expect(j.x).toBeLessThan(4.85);
  });
});

describe('stepBody: jumping and falling', () => {
  it('jump apex is between 1.40 and 1.50', () => {
    const b = makeBody(0, 0, flat);
    const r = stepBody(b, { vx: 0, vz: 0, jump: true }, DT, flat);
    expect(r.jumped).toBe(true);
    let peak = b.y;
    sim(b, flat, { vx: 0, vz: 0, jump: false }, 1.5, DT, () => { peak = Math.max(peak, b.y); });
    expect(peak).toBeGreaterThan(1.4);
    expect(peak).toBeLessThan(1.5);
    expect(b.peakY).toBeCloseTo(peak, 9);
    expect(b.grounded).toBe(true);
    expect(b.y).toBe(0);
  });
  it('holding jump re-jumps only on landing, and never goes above 1.5 m', () => {
    const b = makeBody(0, 0, flat);
    let jumps = 0, landings = 0, maxY = 0;
    sim(b, flat, { vx: 0, vz: 0, jump: true }, 3, DT, (r) => {
      if (r.jumped) jumps++;
      if (r.landed) landings++;
      maxY = Math.max(maxY, b.y);
    });
    expect(landings).toBeGreaterThanOrEqual(3);
    expect(jumps).toBe(landings + 1);
    expect(maxY).toBeLessThanOrEqual(1.5);
  });
  it('can jump onto the crate and stand on it at y = 0.8', () => {
    const b = makeBody(2, 0, box);
    const input = (bb: Body): BodyInput => ({ vx: bb.x < 5 ? RUN_SPEED : 0, vz: 0, jump: bb.x > 3 && bb.x < 3.5 });
    sim(b, box, input, 2);
    expect(b.x).toBeGreaterThan(4);
    expect(b.x).toBeLessThan(6);
    expect(b.y).toBe(0.8);
    expect(b.grounded).toBe(true);
  });
  it('can jump over the 0.3 m-wide 0.8 m wall-top', () => {
    const b = makeBody(2, 0, wallTop);
    const input = (bb: Body): BodyInput => ({ ...run, jump: bb.x > 3.5 && bb.x < 4 });
    sim(b, wallTop, input, 1.5);
    expect(b.x).toBeGreaterThan(6);
    expect(b.grounded).toBe(true);
    expect(b.y).toBe(0);
  });
  it('walking off the 5 m ledge lands with a 5 m drop and 20 damage', () => {
    const b = makeBody(-1, 0, ledge);
    expect(b.y).toBe(5);
    let landing: ReturnType<typeof stepBody> | null = null;
    sim(b, ledge, run, 2, DT, (r) => { if (r.landed) landing = r; });
    expect(landing).not.toBeNull();
    const drop = landing!.drop;
    expect(drop).toBeGreaterThan(4.95);
    expect(drop).toBeLessThan(5.05);
    expect(b.grounded).toBe(true);
    expect(b.y).toBe(0);
    expect(fallDamage(drop)).toBe(20);
  });
  it('drop is 0 on steps that do not land', () => {
    const b = makeBody(0, 0, flat);
    const r = stepBody(b, { vx: 0, vz: 0, jump: true }, DT, flat);
    expect(r).toEqual({ landed: false, drop: 0, jumped: true });
  });
  it('with dt = 0.1 steps the body never ends a step below the surface', () => {
    for (const s of [flat, box, wallTop, ledge, step(0.3)]) {
      const b = makeBody(-1, 0, s);
      sim(b, s, (bb) => ({ vx: RUN_SPEED, vz: 0.5, jump: Math.floor(bb.x) % 2 === 0 }), 4, 0.1, () => {
        const h = s(b.x, b.z);
        expect(h).not.toBeNull();
        expect(b.y).toBeGreaterThanOrEqual(h! - 1e-9);
      });
    }
  });
  it('caps a huge dt at 0.25 s', () => {
    const b = makeBody(0, 0, flat);
    stepBody(b, { vx: 1, vz: 0, jump: false }, 10, flat);
    expect(b.x).toBeCloseTo(0.25, 9);
  });
});

describe('fallDamage', () => {
  it('is free up to SAFE_FALL, then 10 per metre, rounded', () => {
    expect(fallDamage(0)).toBe(0);
    expect(fallDamage(2)).toBe(0);
    expect(fallDamage(3)).toBe(0);
    expect(fallDamage(4.5)).toBe(15);
    expect(fallDamage(5)).toBe(20);
  });
});
