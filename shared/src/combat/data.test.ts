import { describe, expect, it } from 'vitest';
import {
  ABILITIES, WEAPONS, DEFAULT_LOADOUT, slotsFor, parseLoadout, MEND_HEAL, BULWARK_ABSORB, BULWARK_S,
  ENEMY_KINDS, ENEMY_ATTACKS, FINISHER_COST, KNOCK_MAX_VY, MELEE_REACH, MAX_ENEMIES_PER_ZONE,
  chargedShot, type AbilityId,
} from './index';
import { JUMP_SPEED } from '../constants';

describe('weapons and abilities', () => {
  it('six weapons, each with an auto range', () => {
    expect(Object.keys(WEAPONS).sort()).toEqual(['blade', 'bow', 'daggers', 'greatsword', 'staff', 'sword']);
    for (const [k, w] of Object.entries(WEAPONS)) { expect(w.id).toBe(k); expect(w.autoRange).toBeGreaterThan(0); expect(w.autoEvery).toBeGreaterThan(0); }
  });
  it('weapon autos', () => {
    expect(WEAPONS.blade).toMatchObject({ autoEvery: 1.2, autoCoef: 1.0, autoRange: MELEE_REACH });
    expect(WEAPONS.bow).toMatchObject({ autoEvery: 1.5, autoCoef: 1.1, autoRange: 18 });
    expect(WEAPONS.sword).toMatchObject({ autoEvery: 1.4, autoCoef: 1.0, autoRange: MELEE_REACH });
    expect(WEAPONS.greatsword).toMatchObject({ autoEvery: 1.8, autoCoef: 1.05, autoRange: MELEE_REACH }); // Task 4 tuning: 1.2 → 1.05
    expect(WEAPONS.daggers).toMatchObject({ autoEvery: 0.9, autoCoef: 0.5, autoRange: MELEE_REACH }); // 0.6 → 0.5
    expect(WEAPONS.staff).toMatchObject({ autoEvery: 1.6, autoCoef: 0.85, autoRange: 16 }); // 1.0 → 0.85
  });
  it('ids match their keys; the Plan 3 table values', () => {
    for (const [k, a] of Object.entries(ABILITIES)) expect(a.id).toBe(k);
    const coef = (id: AbilityId) => ABILITIES[id].effects.find((e) => e.k === 'damage')?.coef;
    expect(ABILITIES.slash).toMatchObject({ cooldown: 4, momentum: 20, range: MELEE_REACH, needsTarget: true });
    expect(coef('slash')).toBe(1.8);
    expect(ABILITIES.sunder).toMatchObject({ cooldown: 6, cost: 50, mark: 'marked', stagger: 10, interrupts: true, range: MELEE_REACH });
    expect(coef('sunder')).toBe(4.0);
    expect(ABILITIES.parry).toMatchObject({ cooldown: 8, range: 0, needsTarget: false });
    expect(ABILITIES.snap_shot).toMatchObject({ cooldown: 5, momentum: 20, range: 18 });
    expect(coef('snap_shot')).toBe(2.0);
    expect(ABILITIES.pitch_arrow).toMatchObject({ cooldown: 6, cost: 50, mark: 'burning', stagger: 10, range: 18 });
    expect(coef('pitch_arrow')).toBe(3.2);
    expect(ABILITIES.charged_shot).toMatchObject({ cooldown: 7, range: 22, needsTarget: true });
    expect(ABILITIES.mend).toMatchObject({ cooldown: 20, kind: 'heal', range: 0 });
    expect(ABILITIES.mend.effects).toEqual([{ k: 'heal', amount: MEND_HEAL, on: 'self' }]);
    expect(ABILITIES.taunt).toMatchObject({ cooldown: 10, range: 15, needsTarget: true }); // ruling P3b-f: 12 → 10
    expect(ABILITIES.bulwark).toMatchObject({ cooldown: 18, kind: 'defence' });
    expect(ABILITIES.bulwark.effects).toEqual([{ k: 'shield', amount: BULWARK_ABSORB, s: BULWARK_S, on: 'self' }]);
    expect(ABILITIES.sprint).toMatchObject({ cooldown: 20, kind: 'utility' });
    // Plan 3's free picks are picks now, each in exactly one job's pool
    for (const id of ['mend', 'taunt', 'bulwark', 'sprint'] as const) expect(ABILITIES[id].role).toBe('pick');
    expect([ABILITIES.mend.job, ABILITIES.bulwark.job, ABILITIES.taunt.job, ABILITIES.sprint.job]).toEqual(['warrior', 'warrior', 'paladin', 'ranger']);
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
    expect(DEFAULT_LOADOUT).toEqual({ job: 'warrior', picks: ['mend', 'bulwark'] });
    expect(slotsFor(DEFAULT_LOADOUT)).toEqual(['slash', 'sunder', 'parry', 'mend', 'bulwark']);
    expect(slotsFor({ job: 'ranger', picks: ['sprint', 'pinning_shot'] })).toEqual(['snap_shot', 'pitch_arrow', 'charged_shot', 'sprint', 'pinning_shot']);
    expect(parseLoadout({ job: 'ranger', picks: ['sprint', 'barbed_rain'], extra: 1 })).toEqual({ job: 'ranger', picks: ['sprint', 'barbed_rain'] });
    const bad: unknown[] = [
      null, 'warrior', {}, { job: 'warrior' }, { job: 'staff', picks: ['mend', 'bulwark'] },
      { job: 'warrior', picks: ['mend', 'mend'] }, { job: 'warrior', picks: ['mend', 'fireball'] },
      { job: 'warrior', picks: ['mend', 'slash'] }, { job: 'warrior', picks: ['charged_shot', 'mend'] },
      { job: 'warrior', picks: ['mend'] }, { job: 'warrior', picks: ['mend', 'bulwark', 'skullringer'] },
      { job: 'warrior', picks: 'mend,bulwark' }, { job: 'toString', picks: ['mend', 'bulwark'] },
      { job: 'warrior', picks: ['constructor', 'mend'] }, { weapon: 'blade', free: ['mend', 'bulwark'] },
    ];
    for (const v of bad) expect(parseLoadout(v)).toBeNull();
    // a parsed loadout is a fresh copy
    const src = { job: 'warrior', picks: ['mend', 'skullringer'] as AbilityId[] };
    const out = parseLoadout(src)!;
    src.picks[0] = 'bulwark';
    expect(out.picks).toEqual(['mend', 'skullringer']);
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
    expect(Object.fromEntries(kinds.map((k) => [k.id, [k.weak ?? null, k.resist ?? null]]))).toEqual({
      thornling: ['fire', 'water'], boar: ['water', 'earth'], archer: ['lightning', null], mossback: ['fire', 'earth'], dummy: [null, null],
    });
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

// Task 4 review round 1: the player-facing text never drifts from the numbers.
import { AEGIS_ALLY_TAKEN, AEGIS_TAKEN, BLOODBOND_R, PACT_MULT, PARRY_MOMENTUM, ROAR_MULT, TAUNT_S, WEAKPOINT_MULT } from './constants';
import { CHARGE_FULL_S } from './abilities';
import { RAIN_HEAL } from './effects';
describe('ability descriptions', () => {
  const pct = (m: number) => Math.round(Math.abs(m - 1) * 100);
  /** Every number an ability's own data can put in its text. */
  const numbersOf = (id: AbilityId): Set<number> => {
    const ab = ABILITIES[id];
    const out = new Set<number>([ab.cast ?? NaN, ab.momentum ?? NaN, ab.cost ?? NaN]);
    for (const e of ab.effects) {
      for (const v of Object.values(e)) if (typeof v === 'number') out.add(v);
      if (e.k === 'revive') out.add(Math.round(e.frac * 100));
      if (e.k === 'sprint') out.add(pct(e.scale));
      if (e.k === 'damage' && e.splash) out.add(e.splash.r);
      if (e.k === 'parry') out.add(PARRY_MOMENTUM);
      if (e.k === 'taunt') out.add(TAUNT_S);
      if (e.k === 'charge') out.add(CHARGE_FULL_S);
      if (e.k === 'debuff' && e.debuff === 'weakpoint') out.add(pct(WEAKPOINT_MULT));
      if (e.k === 'buff') {
        if (e.buff === 'roar') out.add(pct(ROAR_MULT));
        if (e.buff === 'pact') out.add(pct(PACT_MULT));
        if (e.buff === 'aegis') out.add(pct(AEGIS_TAKEN));
        if (e.buff === 'aegis_ally') out.add(pct(AEGIS_ALLY_TAKEN));
        if (e.buff === 'rain') out.add(RAIN_HEAL);
        if (e.buff === 'bloodbond') out.add(BLOODBOND_R);
      }
    }
    return out;
  };
  it('every number in a desc is one of the ability\'s own numbers', () => {
    for (const id of Object.keys(ABILITIES) as AbilityId[]) {
      const nums = (ABILITIES[id].desc.match(/\d+(\.\d+)?/g) ?? []).map(Number);
      const own = numbersOf(id);
      for (const n of nums) expect(own.has(n), `${id}: ${n} in "${ABILITIES[id].desc}"`).toBe(true);
    }
  });
  it('a changed number is caught (the check is not vacuous)', () => {
    expect(numbersOf('kindle').has(10)).toBe(false);
    expect(numbersOf('mistveil').has(30)).toBe(true);
  });
});
