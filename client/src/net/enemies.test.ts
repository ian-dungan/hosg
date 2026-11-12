import { describe, expect, it } from 'vitest';
import { viewMode } from './enemies';

describe('viewMode', () => {
  it('runs while fighting or going home and moving, stands otherwise', () => {
    expect(viewMode('fight', true)).toBe('run');
    expect(viewMode('fight', false)).toBe('idle');
    expect(viewMode('idle', true)).toBe('run');
    expect(viewMode('idle', false)).toBe('idle');
    expect(viewMode('return', true)).toBe('return');
    expect(viewMode('return', false)).toBe('idle');
  });
  it('wind-ups, stuns and deaths map straight across', () => {
    expect(viewMode('windup', false)).toBe('windup');
    expect(viewMode('stunned', true)).toBe('stunned');
    expect(viewMode('dead', true)).toBe('dead');
  });
});
