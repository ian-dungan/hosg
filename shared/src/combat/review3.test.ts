// Task 3 review round 1: revive safety, the Paladin's taunt, Font on steam, Rooted immunity, per-enemy
// splash, and elite conduct without an interrupt's stagger.
import { describe, expect, it } from 'vitest';
import { ABILITIES, damageCoef, type Loadout } from './abilities';
import {
  BREAK_DAMAGE_MULT, ELEMENT_WEAK_MULT, ELITE_ROOT_MULT, FONT_HEAL_MULT, INTERRUPT_STAGGER, MARK_S, OVERFLOW_MULT, ROOT_IMMUNE_S,
  STEADFAST_THREAT, STEAM_HEAL, TAUNT_BONUS, TAUNT_MULT,
} from './constants';
import { hurtAdventurer, strike } from './adventurer';
import { resolveHit } from './enemyAi';
import { hitDamage } from './stats';
import { Rig, camp } from './testRig';

const WM: Loadout = { job: 'white_mage', picks: ['second_dawn', 'soft_rain'] };
const BLACK: Loadout = { job: 'black_mage', picks: ['rootbreak', 'stormcage'] };
const kill = (r: Rig, id: number) => hurtAdventurer(r.w, r.w.adventurers.get(id)!, 1000, 0, 'auto', r.now);
const aim = (r: Rig, id: number, e: number) => expect(r.i(id, { t: 'target', id: e })).toBeNull();

describe('Task 3 review round 1', () => {
  it('revive safety is a plain miss, never a perfect dodge (no Momentum, no elite stagger)', () => {
    const r = new Rig([camp('mossback', 0, 0)]);
    const e = r.enemy('mossback');
    const wm = r.add(0, -10, WM), b = r.add(0, -2);
    kill(r, b);
    expect(r.press(wm, 3, b)).toBeNull();
    r.until('revive');
    const a = r.w.adventurers.get(b)!, en = r.w.enemies.get(e)!;
    expect(a.iframeUntil).toBe(-Infinity);
    const n = r.fx('miss').length;
    resolveHit(r.w, en, a, 40, 'ground_slam', true, null, r.now, { kind: 'circle', x: 0, z: 0, r: 4.5 });
    const miss = r.fx('miss').slice(n);
    expect(miss.map((m) => [m.dst, m.perfect])).toEqual([[b, false]]);
    expect(a.momentum).toBe(0);
    expect(en.stagger.value).toBe(0);
    expect(a.hp).toBe(40);
  });

  it('a Paladin taunt gets ×STEADFAST_THREAT after the taunt formula; a Plan 3 taunt does not', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const w = r.add(0, -4), pal = r.add(1, -2, { job: 'paladin', picks: ['taunt', 'shelter'] });
    const en = r.w.enemies.get(e)!;
    en.threat.add(w, 100);
    aim(r, pal, e);
    expect(r.press(pal, 3)).toBeNull();
    expect(en.threat.get(pal)).toBeCloseTo((100 * TAUNT_MULT + TAUNT_BONUS) * STEADFAST_THREAT, 6);
    const r2 = new Rig([camp('thornling', 0, 0)]);
    const e2 = r2.enemy('thornling');
    const w2 = r2.add(0, -4), p3 = r2.add(1, -2, { weapon: 'blade', free: ['taunt', 'mend'] });
    r2.w.enemies.get(e2)!.threat.add(w2, 100);
    aim(r2, p3, e2);
    expect(r2.press(p3, 3)).toBeNull();
    expect(r2.w.enemies.get(e2)!.threat.get(p3)).toBeCloseTo(100 * TAUNT_MULT + TAUNT_BONUS, 6);
  });

  it("steam is the White Mage's heal: Font ×1.2 on others", () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const wm = r.add(0, -10, WM, 50), close = r.add(0, -3, undefined, 50);
    const en = r.w.enemies.get(e)!;
    aim(r, wm, e);
    en.marks.burning = r.now + 8;
    en.burning = { src: close, power: 10, nextAt: r.now + 1 };
    expect(r.press(wm, 0)).toBeNull();
    expect(r.fx('heal').map((h) => [h.src, h.dst, h.amount])).toEqual([[wm, close, STEAM_HEAL * FONT_HEAL_MULT]]);
  });

  it('Rooted cannot be refreshed while it lives; after it ends the enemy is immune for ROOT_IMMUNE_S; an elite keeps it half as long', () => {
    const r = new Rig([camp('thornling', 0, 0), camp('mossback', 20, 0)]);
    const e = r.enemy('thornling'), m = r.enemy('mossback');
    const ra = r.add(0, -10, { job: 'ranger', picks: ['pinning_shot', 'field_dressing'] });
    const en = r.w.enemies.get(e)!, mb = r.w.enemies.get(m)!;
    const a = r.w.adventurers.get(ra)!;
    const pin = () => strike(r.w, a, en, { coef: 1.2, by: 'pinning_shot', mark: 'rooted', primer: true }, r.now);
    pin();
    const until = en.marks.rooted!;
    expect(until).toBeCloseTo(r.now + MARK_S, 6);
    r.at(3); pin();
    expect(en.marks.rooted).toBe(until); // not refreshed
    r.at(until + 0.2);
    expect(en.marks.rooted).toBeUndefined();
    pin();
    expect(en.marks.rooted).toBeUndefined(); // immune
    r.at(until + ROOT_IMMUNE_S + 0.2); pin();
    expect(en.marks.rooted).toBeCloseTo(r.now + MARK_S, 6);
    strike(r.w, a, mb, { coef: 1.2, by: 'pinning_shot', mark: 'rooted', primer: true }, r.now);
    expect(mb.marks.rooted).toBeCloseTo(r.now + MARK_S * ELITE_ROOT_MULT, 6);
  });

  it('a duo spamming every root keeps a Thornling rooted at most ~60% of the time', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const ra = r.add(0, -10, { job: 'ranger', picks: ['pinning_shot', 'field_dressing'] });
    const nj = r.add(0, -2, { job: 'ninja', picks: ['weak_point', 'ashcloud'] });
    const bm = r.add(3, -10, BLACK);
    const en = r.w.enemies.get(e)!;
    en.hp = en.maxHp = 1e9;
    for (const id of [ra, nj, bm]) aim(r, id, e);
    let rooted = 0, ticks = 0;
    for (let k = 0; k < 15 * 60; k++) {
      r.ready(ra); r.ready(nj, 60); r.ready(bm);
      r.press(ra, 3); r.press(nj, 1); r.press(bm, 3);
      r.tick();
      ticks++;
      if ((en.marks.rooted ?? -Infinity) > r.now) rooted++;
    }
    expect(rooted / ticks).toBeLessThanOrEqual(0.6);
    expect(rooted / ticks).toBeGreaterThan(0.4);
  });

  it('splash is computed per enemy: a broken Mossback beside a Thornling takes its own break, defence and weakness', () => {
    const r = new Rig([camp('thornling', 0, 0), camp('mossback', 2.5, 0)]);
    const t = r.enemy('thornling'), m = r.enemy('mossback');
    const mb = r.w.enemies.get(m)!;
    mb.stagger.brokenUntil = Infinity;
    const bm = r.add(0, -10, BLACK);
    aim(r, bm, t);
    expect(r.press(bm, 2)).toBeNull(); // Hearthfall
    r.until('castEnd');
    const hits = r.hits(bm);
    const mult = ELEMENT_WEAK_MULT * OVERFLOW_MULT; // both are weak to fire
    const coef = damageCoef(ABILITIES.hearthfall);
    expect(hits.find((h) => h.dst === t)!.amount).toBe(hitDamage(coef, 10, 6, mult));
    expect(hits.find((h) => h.dst === m)!.amount).toBe(hitDamage(coef * 0.5, 10, 15, mult * BREAK_DAMAGE_MULT));
  });

  it('elite conduct from a non-interrupting hit interrupts without INTERRUPT_STAGGER', () => {
    const r = new Rig([camp('mossback', 0, 0)]);
    const e = r.enemy('mossback');
    const bm = r.add(0, -10, BLACK);
    const en = r.w.enemies.get(e)!, a = r.w.adventurers.get(bm)!;
    en.marks.soaked = r.now + 8;
    en.windup = { attack: 'thorn_hail', startedAt: r.now, endsAt: r.now + 30, interruptible: true, telegraphId: null };
    en.act = ''; en.actUntil = -Infinity;
    strike(r.w, a, en, { coef: 1, by: 'auto', element: 'lightning' }, r.now);
    expect(en.windup).toBeNull();
    expect(en.stagger.value).toBe(25 + 20); // COMBO_STAGGER + CONDUCT_STAGGER, no INTERRUPT_STAGGER
    expect(INTERRUPT_STAGGER).toBeGreaterThan(0);
  });
});
