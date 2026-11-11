import { describe, expect, it } from 'vitest';
import { Walk, createGroveWalk, groveSurface, groveTownSurface, groveGroundY, BEACON_C, type Obstacle } from './layout';

// A 2 m x 2 m box on the flat plaza (the plaza is at terrain height 0).
const box = (top?: number): Obstacle => ({ kind: 'r', x: 6, z: -6, hw: 1, hd: 1, c: 1, s: 0, ...(top === undefined ? {} : { top }) });

describe('Walk.surfaceAt', () => {
  it('a platform (Rect with top) is standable at its top, but groundAt still reports it blocked', () => {
    const w = new Walk([box(0.6)]);
    expect(w.surfaceAt(6, -6)).toBe(0.6);
    expect(w.groundAt(6, -6)).toBeNull();
    expect(w.surfaceAt(6.9, -5.1)).toBe(0.6);
    expect(w.surfaceAt(8, -6)).toBe(0); // beside it: plain terrain
  });
  it('a platform circle works the same way', () => {
    const w = new Walk([{ kind: 'c', x: 6, z: -6, r: 1, top: 1.2 }]);
    expect(w.surfaceAt(6, -6)).toBe(1.2);
    expect(w.groundAt(6, -6)).toBeNull();
  });
  it('the highest platform covering a point wins; a wall overlapping a platform blocks', () => {
    const w = new Walk([box(0.6), { kind: 'c', x: 6, z: -6, r: 0.5, top: 2 }]);
    expect(w.surfaceAt(6, -6)).toBe(2);
    expect(w.surfaceAt(6.8, -6)).toBe(0.6);
    const ww = new Walk([box(0.6), { kind: 'c', x: 6, z: -6, r: 0.5 }]);
    expect(ww.surfaceAt(6, -6)).toBeNull();
    expect(ww.surfaceAt(6.8, -6)).toBe(0.6);
  });
  it('a platform below the terrain gives the terrain height', () => {
    const w = new Walk([box(-3)]);
    expect(w.surfaceAt(6, -6)).toBe(0);
  });
  it('a Rect without top is a wall: surfaceAt is null', () => {
    const w = new Walk([box()]);
    expect(w.surfaceAt(6, -6)).toBeNull();
    expect(w.groundAt(6, -6)).toBeNull();
  });
  it('with no platforms, surfaceAt equals groundAt everywhere (grove sample grid)', () => {
    const w = createGroveWalk();
    let nonNull = 0;
    for (let x = -130; x <= 130; x += 1.7) for (let z = -130; z <= 130; z += 1.7) {
      const g = w.groundAt(x, z);
      if (g !== null) { nonNull++; expect(w.surfaceAt(x, z)).toBe(g); }
      else expect(w.surfaceAt(x, z)).toBeNull(); // no obstacle has a top yet
    }
    expect(nonNull).toBeGreaterThan(1000);
    expect(w.surfaceAt(BEACON_C.x, BEACON_C.z)).toBe(w.groundAt(BEACON_C.x, BEACON_C.z));
  });
});

describe('groveSurface / groveTownSurface', () => {
  it('groveSurface is the default walk surface', () => {
    expect(groveSurface(0, -11)).toBe(groveGroundY(0, -11));
    expect(groveSurface(0, 0)).toBeNull(); // statue plinth (a wall)
    expect(groveSurface(BEACON_C.x, BEACON_C.z)).not.toBeNull();
  });
  it('groveTownSurface is null outside the town radius', () => {
    expect(groveTownSurface(0, -11)).toBe(groveGroundY(0, -11));
    expect(groveTownSurface(BEACON_C.x, BEACON_C.z)).toBeNull();
    expect(groveTownSurface(5000, 5000)).toBeNull();
  });
});
