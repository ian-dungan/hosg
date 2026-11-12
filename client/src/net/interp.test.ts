import { describe, expect, it } from 'vitest';
import { INTERP_DELAY_MS, PoseBuffer } from './interp';

describe('PoseBuffer', () => {
  it('renders INTERP_DELAY_MS in the past, linear in position', () => {
    expect(INTERP_DELAY_MS).toBe(133);
    const b = new PoseBuffer();
    b.push(0, 0, 5, 0);
    b.push(66, 1, 5, 0);
    const s = b.sample(133 + 33);
    expect(s?.x).toBeCloseTo(0.5, 5);
    expect(s?.z).toBeCloseTo(5, 5);
  });

  it('holds the oldest pose before the buffer starts', () => {
    const b = new PoseBuffer();
    b.push(1000, 2, 3, 0.5);
    b.push(1066, 4, 3, 0.5);
    expect(b.sample(1000)).toEqual({ x: 2, z: 3, y: 0, facing: 0.5 });
  });

  it('holds the last pose when the buffer runs dry', () => {
    const b = new PoseBuffer();
    b.push(0, 0, 0, 0);
    b.push(66, 1, 2, 0.3);
    expect(b.sample(100_000)).toEqual({ x: 1, z: 2, y: 0, facing: 0.3 });
  });

  it('turns the short way round, through pi rather than 0', () => {
    const b = new PoseBuffer();
    b.push(0, 0, 0, 3.1);
    b.push(66, 0, 0, -3.1);
    const f = b.sample(133 + 33)!.facing;
    // Halfway along the short arc is +-pi; the long way round would pass through 0.
    expect(Math.abs(Math.abs(f) - Math.PI)).toBeLessThan(0.01);
  });

  it('returns null while empty', () => {
    expect(new PoseBuffer().sample(0)).toBeNull();
  });
});

describe('PoseBuffer after a pause', () => {
  it('starts moving again from where the adventurer stood, not with a slow slide across the pause', () => {
    const b = new PoseBuffer();
    b.push(0, 0, 0, 0);
    b.push(5000, 0.4, 0, 0); // stood still for 5 s, then one step
    // Just before the step's update would be shown, they are still (nearly) at the start.
    expect(b.sample(5000 + INTERP_DELAY_MS - 67)!.x).toBeLessThan(0.01);
    expect(b.sample(5000 + INTERP_DELAY_MS)!.x).toBeCloseTo(0.4, 5);
  });
});

describe('PoseBuffer height', () => {
  it('interpolates y linearly between updates', () => {
    const b = new PoseBuffer();
    b.push(0, 0, 0, 0, 0.5);
    b.push(66, 0, 0, 0, 1.5);
    expect(b.sample(133 + 33)!.y).toBeCloseTo(1, 5);
    expect(b.sample(133 + 16.5)!.y).toBeCloseTo(0.75, 5);
  });

  it('holds the first and the last y at the ends of the buffer', () => {
    const b = new PoseBuffer();
    b.push(1000, 0, 0, 0, 4.5);
    b.push(1066, 1, 0, 0, 2);
    expect(b.sample(1000)!.y).toBe(4.5);
    expect(b.sample(100_000)!.y).toBe(2);
  });

  it('keeps the height across a pause, then moves on from it', () => {
    const b = new PoseBuffer();
    b.push(0, 0, 0, 0, 5);
    b.push(5000, 0.4, 0, 0, 3); // stood on the Lookout for 5 s, then dropped
    expect(b.sample(5000 + INTERP_DELAY_MS - 67)!.y).toBeCloseTo(5, 2);
    expect(b.sample(5000 + INTERP_DELAY_MS)!.y).toBeCloseTo(3, 5);
  });

  it('reads 0 when pushes never gave a height (the old four-argument push)', () => {
    const b = new PoseBuffer();
    b.push(0, 1, 2, 0);
    b.push(66, 3, 2, 0);
    const s = b.sample(133 + 33)!;
    expect(s.x).toBeCloseTo(2, 5);
    expect(s.y).toBe(0);
  });
});
