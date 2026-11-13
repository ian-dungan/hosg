import { describe, expect, it } from 'vitest';
import { inShape } from '@sg2/shared';
import { decalGrid, telegraphShape } from './telegraphs';
import type { TelegraphStateView } from '../net/session';

const tg = (o: Partial<TelegraphStateView>): TelegraphStateView => ({ id: 1, owner: 2, attack: 'cinder_ring', shape: 'ring', x: 10, z: -4, dir: 1.2, r: 9, width: 0, angle: 0, total: 1.6, ...o });

describe('ring telegraphs (the Cinder Ring: stand close)', () => {
  it('the state ring becomes the shared ring shape (inner radius kept, dir 0)', () => {
    expect(telegraphShape(tg({ inner: 3.5 }))).toEqual({ kind: 'ring', x: 10, z: -4, dir: 0, inner: 3.5, r: 9 });
    // an inner radius the server left unset is a full disc of a ring
    expect(telegraphShape(tg({}))).toMatchObject({ kind: 'ring', inner: 0 });
  });
  it('the decal covers the ring only: every vertex between the inner and outer edge, none in the safe middle', () => {
    const s = telegraphShape(tg({ inner: 3.5 }));
    const g = decalGrid(s);
    expect(g.xz.length / 2).toBeGreaterThan(100);
    for (let i = 0; i < g.xz.length; i += 2) {
      const d = Math.hypot(g.xz[i] - 10, g.xz[i + 1] + 4);
      expect(d).toBeGreaterThanOrEqual(3.5 - 1e-9);
      expect(d).toBeLessThanOrEqual(9 + 1e-9);
    }
    expect(inShape(s, 10, -4)).toBe(false);
    expect(inShape(s, 10 + 6, -4)).toBe(true);
    // the rim runs along both edges
    const vs = g.uv.filter((_, i) => i % 2 === 1);
    expect(Math.max(...vs)).toBe(1);
    expect(g.idx.every((k) => k < g.xz.length / 2)).toBe(true);
  });
});
