import { describe, expect, it } from 'vitest';
import {
  ABILITIES, CATCH_UP_MULT, CLEAR_XP, JOB_LEVEL_CAP, MIN_CREDIT_FRAC, STARTER_STATS, TALENT_LEVELS, XP_CURVE_VERSION, XP_PER_LEVEL, XP_TO_NEXT,
  baseStats, catchUp, levelForXp, migrateStubXp, newJobsSave, parseMods, totalTo, xpToNext, type JobsSave,
} from './index';

describe('the level curve', () => {
  it('the curve: 100 to level 2, 3180 to level 10, levelForXp and xpToNext agree at every boundary', () => {
    expect(XP_TO_NEXT).toEqual([100, 140, 190, 250, 320, 400, 490, 590, 700]);
    expect(Object.isFrozen(XP_TO_NEXT)).toBe(true);
    expect([JOB_LEVEL_CAP, XP_CURVE_VERSION, CATCH_UP_MULT, CLEAR_XP, MIN_CREDIT_FRAC]).toEqual([10, 2, 1.5, 30, 0.1]);
    expect(TALENT_LEVELS).toEqual([4, 7, 10]);
    expect(XP_PER_LEVEL).toBe(XP_TO_NEXT[0]);
    expect(totalTo(1)).toBe(0);
    expect(totalTo(2)).toBe(100);
    expect(totalTo(10)).toBe(3180);
    expect([totalTo(0), totalTo(-3), totalTo(11), totalTo(NaN)]).toEqual([0, 0, 3180, 0]);
    for (let l = 1; l < JOB_LEVEL_CAP; l++) {
      const at = totalTo(l), next = totalTo(l + 1);
      expect(next - at).toBe(XP_TO_NEXT[l - 1]);
      expect(levelForXp(at)).toBe(l);
      expect(levelForXp(next - 1)).toBe(l);
      expect(levelForXp(next)).toBe(l + 1);
      expect(xpToNext(at)).toBe(XP_TO_NEXT[l - 1]);
      expect(xpToNext(next - 1)).toBe(1);
    }
    expect(levelForXp(3180)).toBe(10);
    expect(levelForXp(1e9)).toBe(10);
    expect(xpToNext(3180)).toBe(0);
    for (const bad of [-5, NaN, Infinity, -Infinity]) expect(levelForXp(bad)).toBe(1);
  });

  it('migrateStubXp keeps every stub level and its share of progress: 0→0, 50→50, 450→680+160, 900→3180, 5000→3180', () => {
    expect(migrateStubXp(0)).toBe(0);
    expect(migrateStubXp(50)).toBe(50);
    expect(migrateStubXp(450)).toBe(680 + 160);   // stub level 5, half way to 6: totalTo(5) + 320 / 2
    expect(migrateStubXp(900)).toBe(3180);
    expect(migrateStubXp(5000)).toBe(3180);
    expect([migrateStubXp(-1), migrateStubXp(NaN)]).toEqual([0, 0]);
    for (let xp = 0; xp <= 1000; xp++) {
      const stubLevel = Math.min(10, 1 + Math.floor(xp / 100));
      expect(levelForXp(migrateStubXp(xp)), `xp ${xp}`).toBe(stubLevel);
    }
  });

  it('baseStats(10) is 9 / 8 / 90; baseStats(1) is 6 / 5 / 72; every step rises', () => {
    expect(baseStats(10)).toEqual({ power: 9, defence: 8, maxHp: 90 });
    expect(baseStats(1)).toEqual({ power: 6, defence: 5, maxHp: 72 });
    for (let l = 1; l < 10; l++) {
      const a = baseStats(l), b = baseStats(l + 1);
      expect(b.power).toBeGreaterThan(a.power);
      expect(b.defence).toBeGreaterThan(a.defence);
      expect(b.maxHp).toBeGreaterThan(a.maxHp);
      expect(Number.isInteger(a.maxHp)).toBe(true);
    }
    expect(baseStats(0)).toEqual(baseStats(1));
    expect(baseStats(NaN)).toEqual(baseStats(1));
    expect(baseStats(99)).toEqual(baseStats(10));
    // Level 10 plus the starter kit (1 / 2 / 10) is STARTER_STATS.
    const b = baseStats(10);
    expect({ power: b.power + 1, defence: b.defence + 2, maxHp: b.maxHp + 10 }).toEqual(STARTER_STATS);
    // A fresh object each time.
    const c = baseStats(5);
    c.power = 0;
    expect(baseStats(5).power).toBeGreaterThan(0);
  });

  it('catchUp is 1.5 below the highest job level, 1 otherwise', () => {
    const rec = (xp: number) => ({ level: levelForXp(xp), xp, picks: ['mend', 'bulwark'] as const, talents: [], outfit: null });
    const s = {
      current: 'warrior', curve: 2,
      jobs: { warrior: rec(totalTo(5)), ranger: { ...rec(totalTo(3)), picks: ['sprint', 'barbed_rain'] }, ninja: { ...rec(totalTo(5) + 10), picks: ['mist_form', 'ashcloud'] } },
    } as unknown as JobsSave;
    expect(catchUp(s, 'warrior')).toBe(1);
    expect(catchUp(s, 'ninja')).toBe(1);
    expect(catchUp(s, 'ranger')).toBe(1.5);
    expect(catchUp(s, 'paladin')).toBe(1.5);   // no record yet: level 1
    expect(catchUp(newJobsSave(), 'warrior')).toBe(1);
    expect(catchUp(newJobsSave(), 'ranger')).toBe(1);   // everyone at level 1
  });
});

describe('mods', () => {
  it('parseMods refuses unknown kinds, unknown abilities and non-finite numbers', () => {
    const good = [
      { k: 'coef', ability: 'slash', mult: 1.15 },
      { k: 'amount', ability: 'mend', mult: 1.3 },
      { k: 'cd', ability: 'slash', add: 0.5 },
      { k: 'cast', ability: 'all', mult: 0.9 },
      { k: 'cast', ability: 'hearthfall', mult: 0.75 },
      { k: 'buffS', ability: 'aegis', add: 1 },
      { k: 'hpCost', ability: 'crimson_pact', mult: 0 },
      { k: 'stagger', ability: 'sunder', add: 10 },
      { k: 'finisherCost', add: -10 },
      { k: 'momentumOn', on: 'parry', amount: 15 },
      { k: 'momentumOn', on: 'hitTaken', amount: 2, everyS: 1 },
      { k: 'dodge', charges: 1 },
      { k: 'dodge', refillMult: 0.8 },
      { k: 'healShield', frac: 0.3, cap: 20, overhealOnly: true },
      { k: 'cdOnCast', s: 0.5 },
      { k: 'afterDodge', mult: 1.2, s: 2 },
      { k: 'staggerMult', mult: 1.2 },
      { k: 'lowHpShield', frac: 0.15, below: 0.35, everyS: 30 },
      { k: 'auraTaken', mult: 0.95, r: 8 },
      { k: 'lastStand', everyS: 90, iframesS: 2 },
      { k: 'resetOn', on: 'perfectDodge', slot: 'quick' },
      { k: 'shieldOn', on: 'taunt', amount: 15, s: 6 },
    ];
    const parsed = parseMods(good);
    expect(parsed).toEqual(good);
    expect(parsed[0]).not.toBe(good[0]);
    const bad: unknown[] = [
      null, 3, 'coef', [], {},
      { k: 'crit', mult: 2 },                                   // unknown kind
      { k: 'toString', mult: 2 },
      { k: 'coef', ability: 'fireball', mult: 1.2 },           // unknown ability
      { k: 'coef', ability: 'constructor', mult: 1.2 },
      { k: 'cd', ability: 'all', add: -1 },                     // 'all' only for cast
      { k: 'coef', ability: 'slash', mult: NaN },               // non-finite
      { k: 'coef', ability: 'slash', mult: Infinity },
      { k: 'coef', ability: 'slash', mult: '1.2' },
      { k: 'coef', ability: 'slash' },                          // missing field
      { k: 'coef', ability: 'slash', mult: 1.2, extra: 1 },     // extra field
      { k: 'momentumOn', on: 'sneeze', amount: 5 },             // unknown event
      { k: 'momentumOn', on: 'parry', amount: 5, everyS: -Infinity },
      { k: 'dodge' },                                           // nothing to change
      { k: 'healShield', frac: 0.2, cap: 15, overhealOnly: false },
      { k: 'resetOn', on: 'parry', slot: 'quick' },
      { k: 'shieldOn', on: 'heal', amount: 15, s: 6 },
    ];
    for (const b of bad) expect(parseMods([b]), JSON.stringify(b)).toEqual([]);
    expect(parseMods([bad[5], good[0], bad[7]])).toEqual([good[0]]);
    for (const v of [null, undefined, 'x', {}, 5]) expect(parseMods(v)).toEqual([]);
    expect(Object.keys(ABILITIES)).toContain('slash');
  });
});
