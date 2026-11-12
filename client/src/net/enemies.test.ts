import { describe, expect, it } from 'vitest';
import { KindPool, viewMode, windupReleased } from './enemies';
import { applyMode } from '../combat/enemies';

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

describe('windupReleased', () => {
  it('a wind-up that ends in fighting or standing struck; going home, a stun or a death cancelled it', () => {
    expect(windupReleased('fight')).toBe(true);
    expect(windupReleased('idle')).toBe(true);
    expect(windupReleased('return')).toBe(false);
    expect(windupReleased('stunned')).toBe(false);
    expect(windupReleased('dead')).toBe(false);
  });
});

describe('KindPool', () => {
  it('reuses a parked view of the same kind before making a new one', () => {
    let made = 0;
    const parked: string[] = [], revived: string[] = [];
    const pool = new KindPool<string, string>((k) => `${k}#${++made}`, (v) => parked.push(v), (v) => revived.push(v));
    const a = pool.take('boar');
    pool.give('boar', a);
    expect(parked).toEqual([a]);
    expect(pool.take('thornling')).toBe('thornling#2'); // another kind is built
    expect(pool.take('boar')).toBe(a);                  // the parked boar comes back
    expect(revived).toEqual([a]);
    expect(made).toBe(2);
    expect(pool.size).toBe(0);
    pool.give('boar', a);
    expect(pool.drain()).toEqual([a]);
    expect(pool.size).toBe(0);
  });
});

describe('applyMode', () => {
  const fresh = () => ({ mode: 'idle' as const, attack: null, wT: 0, wDur: 1 });
  it('a wind-up starts `elapsed` in, clamped to its length', () => {
    const a = { ...fresh() } as Parameters<typeof applyMode>[0];
    expect(applyMode(a, 'windup', 'thorn_burst', 1.0, 0.4)).toBe(true);
    expect(a).toMatchObject({ mode: 'windup', attack: 'thorn_burst', wT: 0.4, wDur: 1.0 });
    expect(applyMode(a, 'windup', 'thorn_burst', 1.0, 0.9)).toBe(false); // the same wind-up again: no restart
    expect(a.wT).toBe(0.4);
    const b = { ...fresh() } as Parameters<typeof applyMode>[0];
    applyMode(b, 'windup', 'gore_charge', undefined, 99);
    expect(b.wDur).toBe(1.3);
    expect(b.wT).toBe(1.3);
    applyMode(b, 'windup', 'gore_charge', undefined, NaN);
    const c = { ...fresh() } as Parameters<typeof applyMode>[0];
    applyMode(c, 'windup', 'ground_slam', 1.6, NaN);
    expect(c.wT).toBe(0);
  });
  it('other modes clear the attack and report whether anything changed', () => {
    const a = { ...fresh() } as Parameters<typeof applyMode>[0];
    expect(applyMode(a, 'idle')).toBe(false);
    applyMode(a, 'windup', 'thorn_burst');
    expect(applyMode(a, 'fight' as never)).toBe(true);
    expect(a.attack).toBeNull();
  });
});
