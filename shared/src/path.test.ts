import { describe, expect, it } from 'vitest';
import { findPath, withClearance, type Vec2 } from './path';
import { createGroveWalk, TAVERN, riverX, BEACON_C } from './world/layout';
import { SPAWN } from './constants';

type Passable = (x: number, z: number) => boolean;

/** Every point along a→b, sampled every 0.1 m, is passable. */
function segmentClear(a: Vec2, b: Vec2, passable: Passable): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / 0.1));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!passable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}
function routeClear(from: Vec2, path: Vec2[], passable: Passable): boolean {
  let p = from;
  for (const q of path) { if (!segmentClear(p, q, passable)) return false; p = q; }
  return true;
}
function routeLength(from: Vec2, path: Vec2[]): number {
  let p = from, len = 0;
  for (const q of path) { len += Math.hypot(q.x - p.x, q.z - p.z); p = q; }
  return len;
}

/** passable, counting how often it is asked (findPath asks once per grid cell, plus line-of-sight samples). */
function counted(p: Passable) {
  let n = 0;
  return { fn: ((x, z) => { n++; return p(x, z); }) as Passable, calls: () => n };
}

const open: Passable = (x, z) => Math.abs(x) < 50 && Math.abs(z) < 50;
// A wall along x = 0 from z = -20 to z = 20, with a 2 m gap at z in (8, 10).
const wallWithGap: Passable = (x, z) => open(x, z) && !(Math.abs(x) < 0.5 && Math.abs(z) < 20 && !(z > 8 && z < 10));

describe('findPath', () => {
  it('on an open map the path is one straight waypoint, ending exactly at the goal', () => {
    const path = findPath({ x: -10, z: -5 }, { x: 12, z: 7.3 }, open);
    expect(path).toEqual([{ x: 12, z: 7.3 }]);
  });

  it('goes through the gap in a wall, and every leg is walkable along its whole length', () => {
    const from = { x: -8, z: 0 }, to = { x: 8, z: 0 };
    const path = findPath(from, to, wallWithGap);
    expect(path).not.toBeNull();
    expect(path!.at(-1)).toEqual(to);
    expect(routeClear(from, path!, wallWithGap)).toBe(true);
    // it passes through the gap
    expect(path!.some((p, i) => {
      const a = i === 0 ? from : path![i - 1];
      return (a.x < 0) !== (p.x < 0) && Math.min(a.z, p.z) < 10 && Math.max(a.z, p.z) > 8;
    })).toBe(true);
    // few waypoints after smoothing (to the gap, through it, to the goal)
    expect(path!.length).toBeLessThanOrEqual(4);
  });

  it('a goal inside a blocked region snaps to the nearest passable point within 2 m', () => {
    // a 3 m blocked square centred at (10, 0): its edge is 1.5 m from the centre
    const square: Passable = (x, z) => open(x, z) && !(Math.abs(x - 10) < 1.5 && Math.abs(z) < 1.5);
    const from = { x: 0, z: 0 };
    const path = findPath(from, { x: 10, z: 0.2 }, square);
    expect(path).not.toBeNull();
    const end = path!.at(-1)!;
    expect(square(end.x, end.z)).toBe(true);
    expect(Math.hypot(end.x - 10, end.z - 0.2)).toBeLessThanOrEqual(2);
    expect(end.z).toBeGreaterThanOrEqual(1.5);            // the face nearest the goal point (1.3 m away), not the near side
    expect(Math.hypot(end.x - 10, end.z - 0.2)).toBeLessThan(1.5);
    expect(routeClear(from, path!, square)).toBe(true);
  });

  it('returns null when nothing passable is within 2 m of the goal', () => {
    const big: Passable = (x, z) => open(x, z) && !(Math.abs(x - 10) < 3 && Math.abs(z) < 3);
    expect(findPath({ x: 0, z: 0 }, { x: 10, z: 0 }, big)).toBeNull();
  });

  it('a walled-off region bigger than the pocket check: null after expanding at most maxNodes cells', () => {
    // 400 x 400 cells (200 m square at 0.5 m cells), goal inside a closed ring of radius 25 m (~7800 cells inside)
    const ring: Passable = (x, z) => {
      if (Math.abs(x) >= 100 || Math.abs(z) >= 100) return false;
      const r = Math.hypot(x - 60, z - 60);
      return !(r > 25 && r < 26);
    };
    const c = counted(ring);
    expect(findPath({ x: -60, z: -60 }, { x: 60, z: 60 }, c.fn, { maxNodes: 20000 })).toBeNull();
    // passable is asked once per cell: the pocket check (< 2000 cells) plus at most 8 new neighbours per expanded cell
    expect(c.calls()).toBeLessThan(2000 + 20000 * 8 + 1000);
  });

  it('a goal in a small walled-off pocket goes to the nearest reachable point instead, without a full search', () => {
    // a 1 m pocket at (10, 0) enclosed by a wall 0.5 m thick; outside the wall is open
    const pocket: Passable = (x, z) => {
      if (!open(x, z)) return false;
      const d = Math.max(Math.abs(x - 10), Math.abs(z));
      return d < 0.6 || d > 1.1;
    };
    const c = counted(pocket);
    const path = findPath({ x: 0, z: 0 }, { x: 10, z: 0.2 }, c.fn);
    expect(path).not.toBeNull();
    const end = path!.at(-1)!;
    expect(Math.max(Math.abs(end.x - 10), Math.abs(end.z))).toBeGreaterThan(1.1);   // outside the pocket
    expect(Math.hypot(end.x - 10, end.z - 0.2)).toBeLessThanOrEqual(2);
    expect(routeClear({ x: 0, z: 0 }, path!, pocket)).toBe(true);
    expect(c.calls()).toBeLessThan(5000);
  });

  it('a pocket the walk starts in is not left out: a goal inside it is reached', () => {
    const pocket: Passable = (x, z) => {
      if (!open(x, z)) return false;
      const d = Math.max(Math.abs(x - 10), Math.abs(z));
      return d < 1.6 || d > 2.1;
    };
    expect(findPath({ x: 9.5, z: -1 }, { x: 10.5, z: 1 }, pocket)).toEqual([{ x: 10.5, z: 1 }]);
  });

  it('the last leg to the tapped point is checked: a tapped point the goal cell cannot see is not used', () => {
    // a thin wall at x in (10.1, 10.2): the tapped point (10.3, 0) is passable but behind it from the goal side;
    // its own cell (10.5, 0) is inside a blocked strip, so the goal snaps to the near side of the wall
    const thin: Passable = (x, z) => open(x, z) && !(x > 10.1 && x < 10.2) && !(x > 10.4 && x < 10.6 && Math.abs(z) < 3) && x < 10.7;
    const path = findPath({ x: 0, z: 0 }, { x: 10.3, z: 0 }, thin);
    expect(path).not.toBeNull();
    expect(routeClear({ x: 0, z: 0 }, path!, thin)).toBe(true);
    expect(path!.at(-1)!.x).toBeLessThan(10.1);
  });

  it('starting on a blocked cell (on top of something) steps off to the nearest passable point first', () => {
    const square: Passable = (x, z) => open(x, z) && !(Math.abs(x) < 0.6 && Math.abs(z) < 0.6);
    const path = findPath({ x: 0.1, z: 0 }, { x: 10, z: 0 }, square);
    expect(path).not.toBeNull();
    expect(square(path![0].x, path![0].z)).toBe(true);
    expect(path!.at(-1)).toEqual({ x: 10, z: 0 });
  });

  it('withClearance keeps a margin from anything blocked', () => {
    const p = withClearance(wallWithGap, 0.3);
    expect(p(0.7, 0)).toBe(false);       // 0.2 m from the wall
    expect(p(0.9, 0)).toBe(true);        // 0.4 m from it
    expect(p(-5, 9)).toBe(true);
  });
});

describe('findPath on the real grove', () => {
  const walk = createGroveWalk();
  const ground = withClearance((x, z) => walk.groundAt(x, z) !== null, 0.3);
  const spawn = { x: SPAWN.x, z: SPAWN.z };

  it('from SPAWN to a point behind the tavern: a clear route, under 1.6 x the straight-line distance', () => {
    // a point beyond the tavern on the line from spawn, so the tavern stands in the way
    const dx = TAVERN.x - spawn.x, dz = TAVERN.z - spawn.z, d = Math.hypot(dx, dz);
    const goal = { x: TAVERN.x + (dx / d) * 7, z: TAVERN.z + (dz / d) * 7 };
    expect(ground(goal.x, goal.z)).toBe(true);
    expect(segmentClear(spawn, goal, ground)).toBe(false); // the straight line is blocked
    const c = counted(ground);
    const path = findPath(spawn, goal, c.fn);
    expect(path).not.toBeNull();
    expect(routeClear(spawn, path!, ground)).toBe(true);
    expect(path!.at(-1)).toEqual(goal);
    expect(routeLength(spawn, path!)).toBeLessThan(1.6 * Math.hypot(goal.x - spawn.x, goal.z - spawn.z));
    expect(c.calls()).toBeLessThan(10000);
  });

  it('a tap on the barrels by the tavern (a walled-off pocket behind them) walks up to the barrels', () => {
    const tap = { x: -32.6, z: 11.6 };
    const c = counted(ground);
    const path = findPath(spawn, tap, c.fn);
    expect(path).not.toBeNull();
    const end = path!.at(-1)!;
    expect(Math.hypot(end.x - tap.x, end.z - tap.z)).toBeLessThanOrEqual(2);
    expect(routeClear(spawn, path!, ground)).toBe(true);
    expect(c.calls()).toBeLessThan(10000);       // a normal across-town search, not the full 20000-node one
  });

  it('from SPAWN to a point across the river: null, after looking at only the cells round the goal', () => {
    const z = 0, goal = { x: riverX(z) - 10, z };
    expect(walk.surfaceAt(goal.x, goal.z)).toBeNull(); // the far bank is not walkable land at all here
    const c = counted(ground);
    expect(findPath(spawn, goal, c.fn)).toBeNull();
    expect(c.calls()).toBeLessThan(200);
  });

  it('worst case: a standable goal with no route (the out-of-play Beacon clearing) gives up after maxNodes', () => {
    const goal = { x: BEACON_C.x, z: BEACON_C.z + 10 };
    expect(ground(goal.x, goal.z)).toBe(true);
    const c = counted(ground);
    expect(findPath(spawn, goal, c.fn)).toBeNull();
    expect(c.calls()).toBeLessThan(2000 + 20000 * 8 + 1000);
  });
});
