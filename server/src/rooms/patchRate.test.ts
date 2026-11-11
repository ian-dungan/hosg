import { describe, expect, it } from 'vitest';
import { PatchRateMeter } from './patchRate';

describe('PatchRateMeter', () => {
  it('reports patches per second over the last 5 s', () => {
    const meter = new PatchRateMeter(0);
    for (let t = 100; t <= 10_000; t += 100) meter.record(t); // 10 a second for 10 s
    expect(meter.rate(10_000)).toBeCloseTo(10, 5);
  });

  it('forgets patches older than 5 s, so a stall shows up', () => {
    const meter = new PatchRateMeter(0);
    for (let t = 100; t <= 5_000; t += 100) meter.record(t); // 10 a second, then nothing for 2.5 s
    expect(meter.rate(7_500)).toBeCloseTo(5, 5);
    expect(meter.rate(20_000)).toBe(0);
  });

  it('measures over the time since it started while that is under 5 s', () => {
    const meter = new PatchRateMeter(1_000);
    for (let t = 1_050; t <= 3_000; t += 50) meter.record(t); // 20 a second for 2 s
    expect(meter.rate(3_000)).toBeCloseTo(20, 5);
    expect(meter.rate(1_000)).toBe(0);
  });
});
