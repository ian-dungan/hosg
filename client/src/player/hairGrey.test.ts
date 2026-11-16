// Greying reads as natural greying, not blotches (live check: an older man's grey beard looked patchy): the grey mixes
// in evenly by the slider, and the stubble painted under a beard stays at its line instead of a grey band on the cheeks.
import { describe, expect, it } from 'vitest';
import { LOOK_PRESETS, parseLook } from '@sg2/shared';
import { greyAmount } from './look';
import { stubblePaint } from './hair';

describe('greying', () => {
  it('turns evenly with the slider', () => {
    const g = [0, 1, 2, 3, 4].map(greyAmount);
    for (let i = 1; i < g.length; i++) expect(g[i]!).toBeGreaterThan(g[i - 1]!);
    expect(g[0]).toBe(0); expect(g[4]).toBeGreaterThan(0.85);
  });
  it('paints no stubble on the cheeks above a full beard (only round its line), and stubble alone where there is no beard', () => {
    const base = LOOK_PRESETS[0]!.look;
    const beard = stubblePaint(parseLook({ ...base, hair: { ...base.hair, facial: 3, grey: 4 } })!)!;
    const cheekHigh: [number, number, number] = [0.5, -0.15, 0.8], jaw: [number, number, number] = [0.6, -0.7, 0.5];
    expect(beard(cheekHigh)).toBe(0);
    expect(beard(jaw)).toBeGreaterThan(0.5);
    const stubble = stubblePaint(parseLook({ ...base, hair: { ...base.hair, facial: 1 } })!)!;
    expect(stubble(cheekHigh)).toBeGreaterThan(0);
  });
});
