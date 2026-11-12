import { describe, expect, it } from 'vitest';
import { createDoubleTap } from './doubleTap';

describe('createDoubleTap', () => {
  it('the same key twice within 250 ms is a dodge', () => {
    const d = createDoubleTap();
    expect(d.down('KeyA', 1000)).toBe(false);
    expect(d.down('KeyA', 1250)).toBe(true);
  });
  it('260 ms apart is not', () => {
    const d = createDoubleTap();
    expect(d.down('KeyA', 1000)).toBe(false);
    expect(d.down('KeyA', 1260)).toBe(false);
    expect(d.down('KeyA', 1400)).toBe(true); // that second press starts a new pair
  });
  it('holding a key (auto-repeat) never dodges, and another key in between breaks the pair', () => {
    const d = createDoubleTap();
    expect(d.down('KeyW', 0)).toBe(false);
    for (let t = 30; t < 600; t += 30) expect(d.down('KeyW', t, true)).toBe(false);
    expect(d.down('KeyD', 700)).toBe(false);
    expect(d.down('KeyW', 760)).toBe(false);
  });
  it('a triple tap dodges once', () => {
    const d = createDoubleTap();
    d.down('KeyS', 0);
    expect(d.down('KeyS', 100)).toBe(true);
    expect(d.down('KeyS', 200)).toBe(false);
  });
});
