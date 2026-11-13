import { describe, expect, it } from 'vitest';
import { AFTERGLOW_S, LANDING_S, RUMBLE_DELAY_S, RUMBLE_S, landingAt } from './starLanding';

describe('the falling star\'s landing (flash, light pillar, rumble, afterglow)', () => {
  it('a white impact first, then the flash and the pillar, the rumble a beat later, an afterglow that lingers', () => {
    const at0 = landingAt(0.05);
    expect(at0.impact).toBeGreaterThan(0.5);
    expect(landingAt(0.6).impact).toBe(0);
    expect(landingAt(0.3).flash).toBeGreaterThan(0.5);
    expect(landingAt(0.5).pillar).toBeGreaterThan(0.4);
    expect(landingAt(RUMBLE_DELAY_S - 0.01).rumble).toBe(0);
    expect(landingAt(RUMBLE_DELAY_S + 0.15).rumble).toBeGreaterThan(0.5);
    expect(landingAt(RUMBLE_DELAY_S + RUMBLE_S + 0.01).rumble).toBe(0);
    expect(landingAt(4).afterglow).toBeGreaterThan(0.2);
    expect(landingAt(4).flash).toBe(0);
    expect(landingAt(AFTERGLOW_S + 0.01).afterglow).toBe(0);
    expect(LANDING_S).toBe(AFTERGLOW_S);
    for (let t = 0; t <= AFTERGLOW_S + 1; t += 0.05) {
      const l = landingAt(t);
      for (const v of [l.impact, l.flash, l.pillar, l.rumble, l.afterglow]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
});
