import { describe, expect, it } from 'vitest';
import { parsePose, checkStep, checkMove, refillAllowance, MAX_MOVE_ALLOWANCE, MAX_MOVE_SPEED } from './movement';
import { groveWalkable, groveTownWalkable, groveGroundY, groundHeight, BEACON_C } from './world/layout';
import { SPAWN } from './constants';

describe('parsePose', () => {
  it('rejects non-finite or non-number fields', () => {
    expect(parsePose({ x: NaN, z: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: Infinity, z: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: '1', z: 0, facing: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, moving: true })).toBeNull();
    expect(parsePose({ x: 1, z: 0, facing: 0, moving: 'yes' })).toBeNull();
    expect(parsePose(null)).toBeNull();
    expect(parsePose('pose')).toBeNull();
  });
  it('returns a clean pose with only the known fields', () => {
    expect(parsePose({ x: 1, z: 2, facing: 0.5, moving: false })).toEqual({ x: 1, z: 2, facing: 0.5, moving: false });
    expect(parsePose({ x: 1, z: 2, facing: 0.5, moving: true, extra: 'x' })).toEqual({ x: 1, z: 2, facing: 0.5, moving: true });
  });
});

describe('checkStep', () => {
  const open = () => true;
  it('allows a normal running step', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('ok');
  });
  it('rejects a step longer than RUN_SPEED * 1.3 * dt + 0.5', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 2000, z: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 6 * 1.3 + 0.5 + 0.01, z: 0, facing: 0, moving: true }, 1, open)).toBe('too-fast');
  });
  it('caps dt at 1 second', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 9, z: 0, facing: 0, moving: true }, 10, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 8, z: 0, facing: 0, moving: true }, 10, open)).toBe('ok');
  });
  it('treats a non-finite dt as no time at all', () => {
    const step = { x: 2, z: 0, facing: 0, moving: true };
    expect(checkStep({ x: 0, z: 0 }, step, NaN, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, step, Infinity, open)).toBe('too-fast');
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, NaN, open)).toBe('ok');
  });
  it('reports blocked when the target is not walkable', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, 1 / 15, () => false)).toBe('blocked');
  });
});

describe('checkStep along the segment', () => {
  it('is blocked by an obstacle thinner than the step, between from and to', () => {
    const fence = (x: number) => !(x > 1.1 && x < 1.4); // a 0.3 m strip
    expect(checkStep({ x: 0, z: 0 }, { x: 2, z: 0, facing: 0, moving: true }, 1, fence)).toBe('blocked');
    expect(checkStep({ x: 0, z: 0 }, { x: 1, z: 0, facing: 0, moving: true }, 1, fence)).toBe('ok');
    expect(checkStep({ x: 1.5, z: 0 }, { x: 3, z: 0, facing: 0, moving: true }, 1, fence)).toBe('ok');
  });
});

describe('movement allowance', () => {
  const open = () => true;
  it('refills at MAX_MOVE_SPEED, capped at one second plus the slack', () => {
    expect(MAX_MOVE_ALLOWANCE).toBeCloseTo(6 * 1.3 + 0.5);
    expect(refillAllowance(0, 0.5)).toBeCloseTo(MAX_MOVE_SPEED * 0.5);
    expect(refillAllowance(0, 10)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(MAX_MOVE_ALLOWANCE - 0.1, 1)).toBe(MAX_MOVE_ALLOWANCE);
    expect(refillAllowance(1, NaN)).toBe(1);
    expect(refillAllowance(1, -5)).toBe(1);
  });
  it('a burst of small steps runs out of allowance', () => {
    let allowance = MAX_MOVE_ALLOWANCE;
    let at = { x: 0, z: 0 };
    let accepted = 0;
    for (let i = 1; i <= 40; i++) {
      const to = { x: i * 0.4, z: 0, facing: 0, moving: true };
      if (checkMove(at, to, allowance, open) !== 'ok') break;
      allowance -= 0.4;
      at = to;
      accepted++;
    }
    expect(accepted).toBe(Math.floor(MAX_MOVE_ALLOWANCE / 0.4));
  });
});

describe('grove walkability', () => {
  it('spawn is walkable, the statue plinth and far away are not', () => {
    expect(groveWalkable(SPAWN.x, SPAWN.z)).toBe(true);
    expect(groveWalkable(0, -11)).toBe(true);
    expect(groveWalkable(0, 0)).toBe(false);
    expect(groveWalkable(5000, 5000)).toBe(false);
  });
  it('groveTownWalkable is the town area only: the far Beacon clearing does not count', () => {
    expect(groveWalkable(BEACON_C.x, BEACON_C.z)).toBe(true); // standable for the client's anchors
    expect(groveTownWalkable(BEACON_C.x, BEACON_C.z)).toBe(false);
    expect(groveTownWalkable(SPAWN.x, SPAWN.z)).toBe(true);
    expect(groveTownWalkable(0, 0)).toBe(false);
    expect(groveTownWalkable(5000, 5000)).toBe(false);
  });
  it('groveGroundY gives terrain height where walkable and null elsewhere', () => {
    expect(groveGroundY(0, -11)).toBe(groundHeight(0, -11));
    expect(groveGroundY(0, 0)).toBeNull();
  });
});
