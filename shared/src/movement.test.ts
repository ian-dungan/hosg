import { describe, expect, it } from 'vitest';
import { parsePose, checkStep } from './movement';
import { groveWalkable, groveGroundY, groundHeight } from './world/layout';
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
  it('reports blocked when the target is not walkable', () => {
    expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, 1 / 15, () => false)).toBe('blocked');
  });
});

describe('grove walkability', () => {
  it('spawn is walkable, the statue plinth and far away are not', () => {
    expect(groveWalkable(SPAWN.x, SPAWN.z)).toBe(true);
    expect(groveWalkable(0, -11)).toBe(true);
    expect(groveWalkable(0, 0)).toBe(false);
    expect(groveWalkable(5000, 5000)).toBe(false);
  });
  it('groveGroundY gives terrain height where walkable and null elsewhere', () => {
    expect(groveGroundY(0, -11)).toBe(groundHeight(0, -11));
    expect(groveGroundY(0, 0)).toBeNull();
  });
});
