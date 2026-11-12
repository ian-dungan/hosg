import { describe, expect, it } from 'vitest';
import {
  ABILITIES, WEAPONS, FREE_POOL, DEFAULT_LOADOUT, slotsFor, parseLoadout,
  ENEMY_KINDS, ENEMY_ATTACKS, FINISHER_COST, KNOCK_MAX_VY, MELEE_REACH, MAX_ENEMIES_PER_ZONE,
  chargedShot, type AbilityId,
} from './index';
import { JUMP_SPEED } from '../constants';

describe('weapons and abilities', () => {
  it('every weapon bar is [quick, finisher, signature] of that weapon', () => {
    for (const w of Object.values(WEAPONS)) {
      expect(w.bar.map((id) => ABILITIES[id].role)).toEqual(['quick', 'finisher', 'signature']);
      for (const id of w.bar) expect(ABILITIES[id].weapon).toBe(w.id);
      const [quick, finisher] = w.bar.map((id) => ABILITIES[id]);
      expect(quick.momentum).toBeGreaterThan(0);
      expect(quick.cost ?? 0).toBe(0);
      expect(finisher.cost).toBe(FINISHER_COST);
      expect(finisher.mark).toBeDefined();
    }
    expect(WEAPONS.blade.bar).toEqual(['slash', 'sunder', 'parry']);
    expect(WEAPONS.bow.bar).toEqual(['snap_shot', 'pitch_arrow', 'charged_shot']);
  });
  it('weapon autos', () => {
    expect(WEAPONS.blade).toMatchObject({ autoEvery: 1.2, autoCoef: 1.0, autoRange: MELEE_REACH });
    expect(WEAPONS.bow).toMatchObject({ autoEvery: 1.5, autoCoef: 1.1, autoRange: 18 });
  });
  it('ids match their keys; the table values', () => {
    for (const [k, a] of Object.entries(ABILITIES)) expect(a.id).toBe(k);
    expect(ABILITIES.slash).toMatchObject({ cooldown: 4, coef: 1.8, momentum: 20, range: MELEE_REACH, needsTarget: true });
    expect(ABILITIES.sunder).toMatchObject({ cooldown: 6, cost: 50, coef: 4.0, mark: 'marked', stagger: 10, interrupts: true, range: MELEE_REACH });
    expect(ABILITIES.parry).toMatchObject({ cooldown: 8, range: 0, needsTarget: false });
    expect(ABILITIES.snap_shot).toMatchObject({ cooldown: 5, coef: 2.0, momentum: 20, range: 18 });
    expect(ABILITIES.pitch_arrow).toMatchObject({ cooldown: 6, cost: 50, coef: 3.2, mark: 'burning', stagger: 10, range: 18 });
    expect(ABILITIES.charged_shot).toMatchObject({ cooldown: 7, range: 22, needsTarget: true });
    expect(ABILITIES.mend).toMatchObject({ cooldown: 20, kind: 'heal', range: 0 });
    expect(ABILITIES.taunt).toMatchObject({ cooldown: 12, range: 15, needsTarget: true });
    expect(ABILITIES.bulwark).toMatchObject({ cooldown: 18, kind: 'defence' });
    expect(ABILITIES.sprint).toMatchObject({ cooldown: 20, kind: 'utility' });
  });
  it('Charged Shot scales with the time held', () => {
    expect(chargedShot(0)).toEqual({ frac: 0, coef: 1.5, stagger: 10, momentum: 0, interrupts: false });
    expect(chargedShot(0.75)).toMatchObject({ frac: 0.5, coef: 3.0, stagger: 20, momentum: 7.5, interrupts: false });
    expect(chargedShot(1.2).frac).toBeCloseTo(0.8, 12);
    expect(chargedShot(1.2).interrupts).toBe(true); // 1.2 / 1.5 is 0.7999… in floating point
    expect(chargedShot(1.19).interrupts).toBe(false);
    expect(chargedShot(18 / 15).interrupts).toBe(true); // released on the 18th tick at 15 Hz
    expect(chargedShot(5)).toEqual({ frac: 1, coef: 4.5, stagger: 30, momentum: 15, interrupts: true });
    expect(chargedShot(NaN).frac).toBe(0);
  });
  it('FREE_POOL: 4 ids usable with any weapon', () => {
    expect(FREE_POOL).toEqual(['mend', 'taunt', 'bulwark', 'sprint']);
    for (const id of FREE_POOL) { expect(ABILITIES[id].weapon).toBe('any'); expect(ABILITIES[id].role).toBe('free'); }
  });
  it('glyphs are 1–2 characters, unique, and none an emoji', () => {
    const glyphs = Object.values(ABILITIES).map((a) => a.glyph);
    expect(new Set(glyphs).size).toBe(glyphs.length);
    for (const g of glyphs) {
      const cps = [...g].map((c) => c.codePointAt(0)!);
      expect(cps.length).toBeGreaterThanOrEqual(1);
      expect(cps.length).toBeLessThanOrEqual(2);
      for (const cp of cps) { expect(cp).toBeLessThan(0x1f000); expect(cp).not.toBe(0xfe0f); }
    }
    for (const a of Object.values(ABILITIES)) { expect(a.name.length).toBeGreaterThan(0); expect(a.desc.length).toBeGreaterThan(0); }
  });
  it('loadouts', () => {
    expect(DEFAULT_LOADOUT).toEqual({ weapon: 'blade', free: ['mend', 'bulwark'] });
    expect(slotsFor(DEFAULT_LOADOUT)).toEqual(['slash', 'sunder', 'parry', 'mend', 'bulwark']);
    expect(slotsFor({ weapon: 'bow', free: ['taunt', 'sprint'] })).toEqual(['snap_shot', 'pitch_arrow', 'charged_shot', 'taunt', 'sprint']);
    expect(parseLoadout({ weapon: 'bow', free: ['sprint', 'mend'], extra: 1 })).toEqual({ weapon: 'bow', free: ['sprint', 'mend'] });
    const bad: unknown[] = [
      null, 'blade', {}, { weapon: 'blade' }, { weapon: 'staff', free: ['mend', 'bulwark'] },
      { weapon: 'blade', free: ['mend', 'mend'] }, { weapon: 'blade', free: ['mend', 'fireball'] },
      { weapon: 'blade', free: ['mend', 'slash'] }, { weapon: 'blade', free: ['charged_shot', 'mend'] },
      { weapon: 'blade', free: ['mend'] }, { weapon: 'blade', free: ['mend', 'bulwark', 'taunt'] },
      { weapon: 'blade', free: 'mend,bulwark' }, { weapon: 'toString', free: ['mend', 'bulwark'] },
      { weapon: 'blade', free: ['constructor', 'mend'] },
    ];
    for (const v of bad) expect(parseLoadout(v)).toBeNull();
    // a parsed loadout is a fresh copy
    const src = { weapon: 'blade', free: ['mend', 'taunt'] as AbilityId[] };
    const out = parseLoadout(src)!;
    src.free[0] = 'sprint';
    expect(out.free).toEqual(['mend', 'taunt']);
  });
});

describe('enemies', () => {
  const kinds = Object.values(ENEMY_KINDS);
  it('3 ordinary kinds besides the dummy, each with exactly 1 attack and no stagger bar', () => {
    const ordinary = kinds.filter((k) => !k.elite && k.id !== 'dummy');
    expect(ordinary.map((k) => k.id).sort()).toEqual(['archer', 'boar', 'thornling']);
    for (const k of ordinary) { expect(k.attacks.length).toBe(1); expect(k.stagger).toBe(0); }
  });
  it('exactly 1 elite with 2 attacks, exactly one of them interruptible, and a stagger bar', () => {
    const elites = kinds.filter((k) => k.elite);
    expect(elites.length).toBe(1);
    const [e] = elites;
    expect(e.attacks.length).toBe(2);
    expect(e.attacks.filter((a) => ENEMY_ATTACKS[a].interruptible).length).toBe(1);
    expect(e.stagger).toBeGreaterThan(0);
  });
  it('every wind-up is at least 1.0 s, and no knock lifts higher than a jump', () => {
    expect(KNOCK_MAX_VY).toBeLessThanOrEqual(JUMP_SPEED);
    for (const a of Object.values(ENEMY_ATTACKS)) {
      expect(a.windup).toBeGreaterThanOrEqual(1.0);
      if (a.knock) expect(a.knock.vy).toBeLessThanOrEqual(KNOCK_MAX_VY);
    }
  });
  it('ids match keys, attacks exist, and shapes have their sizes', () => {
    for (const [k, v] of Object.entries(ENEMY_KINDS)) { expect(v.id).toBe(k); for (const a of v.attacks) expect(ENEMY_ATTACKS[a]).toBeDefined(); }
    for (const [k, a] of Object.entries(ENEMY_ATTACKS)) {
      expect(a.id).toBe(k);
      if (a.shape === 'line') { expect(a.length).toBeGreaterThan(0); expect(a.width).toBeGreaterThan(0); }
      else expect(a.r).toBeGreaterThan(0);
      if (a.shape === 'cone') expect(a.angle).toBeGreaterThan(0);
    }
  });
  it('the table values', () => {
    expect(ENEMY_KINDS.thornling).toMatchObject({ hp: 210, defence: 6, radius: 0.5, speed: 5.0, aggro: 7, leash: 25, respawn: 25, auto: { reach: 1.8, every: 1.6, raw: 6, ranged: false } });
    expect(ENEMY_KINDS.boar).toMatchObject({ hp: 180, defence: 12, radius: 0.8, speed: 4.5, aggro: 7, leash: 25, respawn: 25, auto: { reach: 2.2, every: 2.0, raw: 8, ranged: false } });
    expect(ENEMY_KINDS.archer).toMatchObject({ hp: 210, defence: 6, radius: 0.5, speed: 4.0, aggro: 9, leash: 25, respawn: 25, keepRange: 12, auto: { reach: 14, every: 2.2, raw: 7, ranged: true } });
    expect(ENEMY_KINDS.mossback).toMatchObject({ elite: true, stagger: 100, hp: 750, defence: 15, radius: 1.3, speed: 4.0, aggro: 9, leash: 30, respawn: 90, auto: { reach: 2.8, every: 2.4, raw: 7, ranged: false } });
    expect(ENEMY_KINDS.dummy).toMatchObject({ hp: 40, defence: 0, radius: 0.5, speed: 0, aggro: 0, auto: null, attacks: [], respawn: 5 });
    expect(ENEMY_ATTACKS.thorn_burst).toMatchObject({ shape: 'circle-self', r: 3, windup: 1.0, raw: 18, cooldown: 7, firstAt: 3, parryable: true });
    expect(ENEMY_ATTACKS.gore_charge).toMatchObject({ shape: 'line', length: 9, width: 1.8, useRange: 8, windup: 1.3, raw: 22, knock: { speed: 10, seconds: 0.35, vy: 4 }, dashToEnd: true, cooldown: 8, firstAt: 3 });
    expect(ENEMY_ATTACKS.briar_volley).toMatchObject({ shape: 'circle-target', r: 2.5, windup: 1.5, raw: 20, cooldown: 9, firstAt: 3 });
    expect(ENEMY_ATTACKS.ground_slam).toMatchObject({ shape: 'circle-self', r: 4.5, useRange: 4, windup: 1.6, raw: 40, knock: { speed: 12, seconds: 0.4, vy: 5 }, cooldown: 9, firstAt: 4, parryable: true, interruptible: false });
    expect(ENEMY_ATTACKS.thorn_hail.angle).toBeCloseTo((70 * Math.PI) / 180, 12);
    expect(ENEMY_ATTACKS.thorn_hail).toMatchObject({ shape: 'cone', r: 11, windup: 2.2, raw: 30, cooldown: 14, firstAt: 7, interruptible: true });
  });
  it('the Greenway budget fits', () => {
    expect(MAX_ENEMIES_PER_ZONE).toBe(40);
  });
});
