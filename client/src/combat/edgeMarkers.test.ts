import { describe, expect, it } from 'vitest';
import { EDGE_MAX, EDGE_SIZE, edgeMarkerLayout, type EdgeCam, type EdgeMember, type EdgeRect } from './edgeMarkers';

/** A camera looking straight down at (0, 0): 10 px a metre, screen centre (200, 200), +z up the screen. */
const cam: EdgeCam = {
  x: 0, z: 0,
  project(x, _y, z, out) { out.x = 200 + x * 10; out.y = 200 - z * 10; out.front = true; },
};
const vp = { w: 400, h: 400 };
const m = (id: number, x: number, z: number): EdgeMember => ({ id, x, y: 0, z, initial: String.fromCharCode(64 + id) });
const margin = EDGE_SIZE / 2 + 6;

describe('edgeMarkerLayout', () => {
  it('on-screen members get none; an off-screen one gets one marker on the edge, pointing at it', () => {
    expect(edgeMarkerLayout(cam, vp, [m(1, 5, 5), m(2, -10, 0)], [])).toEqual([]);
    const [k] = edgeMarkerLayout(cam, vp, [m(1, 60, 0)], []);
    expect(k).toMatchObject({ id: 1, initial: 'A' });
    expect(k.x).toBeCloseTo(400 - margin);
    expect(k.y).toBeCloseTo(200);
    expect(k.angle).toBeCloseTo(0);
    // up and to the left: the top edge, pointing up-left
    const [u] = edgeMarkerLayout(cam, vp, [m(2, -10, 70)], []);
    expect(u.y).toBeCloseTo(margin);
    expect(u.x).toBeGreaterThan(margin);
    expect(u.x).toBeLessThan(200);
    expect(u.angle).toBeLessThan(-Math.PI / 2);
  });

  it('a member behind the camera points the other way (the projection is mirrored)', () => {
    const behind: EdgeCam = { x: 0, z: 0, project(x, _y, z, out) { out.x = 200 - x * 10; out.y = 200 + z * 10; out.front = false; } };
    const [k] = edgeMarkerLayout(behind, vp, [m(1, 3, 0)], []);
    expect(k.x).toBeCloseTo(400 - margin); // even though it projects onto the screen at x = 170
  });

  it('every marker is clamped inside the viewport and moved out of the exclusions along its edge', () => {
    // the ability cluster in the bottom-right corner, the joystick in the bottom-left
    const ex: EdgeRect[] = [{ x0: 260, y0: 260, x1: 400, y1: 400 }, { x0: 0, y0: 280, x1: 140, y1: 400 }];
    const list = edgeMarkerLayout(cam, vp, [m(1, 80, -12), m(2, -60, -14), m(3, 4, -90)], ex);
    expect(list.length).toBe(3);
    for (const k of list) {
      expect(k.x).toBeGreaterThanOrEqual(margin - 1e-9); expect(k.x).toBeLessThanOrEqual(400 - margin + 1e-9);
      expect(k.y).toBeGreaterThanOrEqual(margin - 1e-9); expect(k.y).toBeLessThanOrEqual(400 - margin + 1e-9);
      for (const r of ex) {
        const hit = k.x > r.x0 - EDGE_SIZE / 2 && k.x < r.x1 + EDGE_SIZE / 2 && k.y > r.y0 - EDGE_SIZE / 2 && k.y < r.y1 + EDGE_SIZE / 2;
        expect(hit, `marker ${k.id} at ${k.x},${k.y}`).toBe(false);
      }
    }
    // the right-hand one slid up the right edge, above the cluster
    const right = list.find((k) => k.id === 1)!;
    expect(right.x).toBeCloseTo(400 - margin);
    expect(right.y).toBeLessThan(260 - EDGE_SIZE / 2);
  });

  it('at most three, nearest first', () => {
    const list = edgeMarkerLayout(cam, vp, [m(1, 200, 0), m(2, 0, 60), m(3, -90, 0), m(4, 0, -40)], []);
    expect(list.length).toBe(EDGE_MAX);
    expect(list.map((k) => k.id)).toEqual([4, 2, 3]);
  });

  it('reuses its output entries', () => {
    const out = edgeMarkerLayout(cam, vp, [m(1, 60, 0)], []);
    const first = out[0];
    expect(edgeMarkerLayout(cam, vp, [m(2, -60, 0)], [], out)[0]).toBe(first);
  });
});
