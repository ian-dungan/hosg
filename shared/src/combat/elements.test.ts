import { describe, expect, it } from 'vitest';
import type { Loadout } from './abilities';
import { RUN_SPEED } from '../constants';
import {
  BEDROCK_S, BEDROCK_SHIELD, BLAST_COEF, BLAST_SPLASH_FRAC, COMBO_COEF, CONDUCT_STUN_S, ELEMENT_RESIST_MULT, ELEMENT_WEAK_MULT,
  OVERFLOW_MULT, ROOTED_SPEED_SCALE, STEAM_HEAL,
} from './constants';
import type { EnemyState } from './engine';
import { SURGE_SCALE } from './enemyAi';
import { hitDamage } from './stats';
import { Rig, camp } from './testRig';

// slots: cinder_dart, skyfall_arc, hearthfall, rootbreak, stormcage
const BLACK: Loadout = { job: 'black_mage', picks: ['rootbreak', 'stormcage'] };
// slots: tidelash, lantern_flare, wellspring, soft_rain, mistveil
const WHITE: Loadout = { job: 'white_mage', picks: ['soft_rain', 'mistveil'] };
const RANGER: Loadout = { job: 'ranger', picks: ['barbed_rain', 'sprint'] };
const POWER = 10;
/** A Thornling (defence 6) hit of `coef` × `mult`. */
const th = (coef: number, mult = 1) => hitDamage(coef, POWER, 6, mult);

function setup(camps = [camp('thornling', 0, 0)]) {
  const r = new Rig(camps);
  const e = r.enemy(camps[0].kind);
  const en = (id = e) => r.w.enemies.get(id)!;
  return { r, e, en };
}
const aim = (r: Rig, id: number, e: number) => expect(r.i(id, { t: 'target', id: e })).toBeNull();
/** A live wind-up (no telegraph) that will not resolve during the test. */
const windup = (e: EnemyState, attack: 'thorn_burst' | 'thorn_hail', interruptible: boolean, now: number) => {
  e.act = ''; e.actUntil = -Infinity;
  e.windup = { attack, startedAt: now, endsAt: now + 30, interruptible, telegraphId: null };
};

describe('primers and reactions', () => {
  it('primer sets Soaked without detonating Marked', () => {
    const { r, e, en } = setup();
    const wm = r.add(0, -10, WHITE);
    aim(r, wm, e);
    en().marks.marked = r.now + 8;
    expect(r.press(wm, 0)).toBeNull(); // Tidelash
    const hit = r.hits(wm).find((h) => h.by === 'tidelash')!;
    expect(hit.combo).toBeUndefined();
    expect(hit.amount).toBe(th(1.4, ELEMENT_RESIST_MULT));
    expect(hit.element).toBe('water');
    expect(Object.keys(en().marks).sort()).toEqual(['marked', 'soaked']);
    expect(en().markBy.soaked).toBe(wm);
    expect(r.fx('mark')).toEqual([{ at: 0, t: 'mark', dst: e, mark: 'soaked', on: true }]);
    expect(r.fx('react')).toEqual([]);
  });

  it('Tidelash then Skyfall Arc on a Thornling: conduct, stun 1.5 s, the wind-up cancelled, react fx, soaked consumed', () => {
    const { r, e, en } = setup();
    const wm = r.add(0, -10, WHITE), bm = r.add(3, -17.5, BLACK); // the Black Mage beyond its auto range
    aim(r, wm, e); aim(r, bm, e);
    expect(r.press(wm, 0)).toBeNull();
    windup(en(), 'thorn_burst', false, r.now);
    r.ready(bm, 60);
    expect(r.press(bm, 1)).toBeNull(); // Skyfall Arc, 1.2 s
    r.until('castEnd');
    const done = r.now - 1 / 15;
    const hit = r.hits(bm).find((h) => h.by === 'skyfall_arc')!;
    expect(hit.amount).toBe(th(4.0, OVERFLOW_MULT) + th(COMBO_COEF, OVERFLOW_MULT));
    expect(hit.element).toBe('lightning');
    expect(r.fx('react')).toEqual([{ at: hit.at, t: 'react', src: bm, dst: e, reaction: 'conduct' }]);
    expect(r.fx('mark').filter((m) => m.at === hit.at).map((m) => [m.mark, m.on])).toEqual([['soaked', false], ['dazed', true]]);
    expect(en().marks.soaked).toBeUndefined();
    expect(en().windup).toBeNull();
    expect(en().act).toBe('stun');
    expect(en().actUntil).toBeCloseTo(done + CONDUCT_STUN_S, 6);
    expect(r.c.self(bm)!.momentum).toBe(10 + 10); // 60 − 50, then Overflow's +10 for the finished cast
  });

  it('conduct on the Mossback: +45 stagger total and Thorn Hail interrupted', () => {
    const run = (soaked: boolean) => {
      const { r, e, en } = setup([camp('mossback', 0, 0)]);
      const wm = r.add(0, -10, WHITE), bm = r.add(3, -10, BLACK);
      aim(r, wm, e); aim(r, bm, e);
      if (soaked) expect(r.press(wm, 0)).toBeNull();
      windup(en(), 'thorn_hail', true, r.now);
      r.ready(bm, 60);
      expect(r.press(bm, 1)).toBeNull();
      r.until('castEnd');
      return { stagger: en().stagger.value, windup: en().windup, interrupts: r.fx('interrupt').length, act: en().act, reacts: r.fx('react').length };
    };
    const plain = run(false), conduct = run(true);
    expect(plain).toMatchObject({ windup: null, interrupts: 1, reacts: 0 }); // Skyfall Arc interrupts by itself
    expect(conduct).toMatchObject({ windup: null, interrupts: 1, reacts: 1 });
    expect(conduct.stagger - plain.stagger).toBe(45); // COMBO_STAGGER + CONDUCT_STAGGER
  });

  it('Cinder Dart on Marked: blast hitDamage(4.5) plus half to an enemy 2.5 m away, none to one 3.5 m away', () => {
    // "away": to the edge of the other Thornling (radius 0.5)
    const { r, e, en } = setup([camp('thornling', 0, 0), camp('thornling', 3, 0), camp('thornling', 0, 4)]);
    const [, near, far] = [...r.w.enemies.keys()];
    const bm = r.add(0, -10, BLACK);
    aim(r, bm, e);
    en().marks.marked = r.now + 8;
    expect(r.press(bm, 0)).toBeNull();
    const mult = ELEMENT_WEAK_MULT * OVERFLOW_MULT;
    const blast = th(BLAST_COEF, mult);
    const hits = r.hits(bm);
    expect(hits.find((h) => h.dst === e)!.amount).toBe(th(1.5, mult) + blast);
    expect(hits.filter((h) => h.dst === near).map((h) => h.amount)).toEqual([Math.round(blast * BLAST_SPLASH_FRAC)]);
    expect(hits.filter((h) => h.dst === far)).toEqual([]);
    expect(r.fx('react').map((x) => x.reaction)).toEqual(['blast']);
    expect(en().marks.marked).toBeUndefined();
  });

  it('Tidelash on Burning: steam heals adventurers within 6 m by 12, ends the Burning DoT', () => {
    const { r, e, en } = setup();
    const wm = r.add(0, -10, WHITE, 50), close = r.add(0, -3, undefined, 50), away = r.add(0, -8, undefined, 50);
    aim(r, wm, e);
    en().marks.burning = r.now + 8;
    en().burning = { src: close, power: POWER, nextAt: r.now + 1 };
    expect(r.press(wm, 0)).toBeNull();
    expect(r.hits(wm)[0].amount).toBe(th(1.4, ELEMENT_RESIST_MULT) + th(COMBO_COEF, ELEMENT_RESIST_MULT));
    expect(r.fx('react').map((x) => x.reaction)).toEqual(['steam']);
    expect(r.fx('heal').map((h) => [h.src, h.dst, h.amount])).toEqual([[wm, close, STEAM_HEAL]]);
    expect([r.c.get(close)!.hp, r.c.get(away)!.hp, r.c.get(wm)!.hp]).toEqual([62, 50, 50]);
    expect(en().burning).toBeNull();
    r.at(4);
    expect(r.fx('hit').filter((h) => h.by === 'burning')).toEqual([]);
  });

  it('Rootbreak on Dazed: bedrock shields 15 for 6 s', () => {
    const { r, e, en } = setup();
    const bm = r.add(0, -10, BLACK), close = r.add(0, -3);
    aim(r, bm, e);
    en().marks.dazed = r.now + 8;
    expect(r.press(bm, 3)).toBeNull(); // Rootbreak, cast 1 s
    r.until('react');
    const at = r.now - 1 / 15;
    expect(r.fx('react').map((x) => x.reaction)).toEqual(['bedrock']);
    expect(r.fx('shield').map((s) => [s.src, s.dst, s.amount])).toEqual([[bm, close, BEDROCK_SHIELD]]);
    expect([r.c.get(close)!.shield, r.c.get(bm)!.shield]).toEqual([BEDROCK_SHIELD, 0]);
    expect(Object.keys(en().marks)).toEqual(['rooted']);
    r.at(at + BEDROCK_S - 0.1);
    expect(r.c.get(close)!.shield).toBe(BEDROCK_SHIELD);
    r.at(at + BEDROCK_S + 0.1);
    expect(r.c.get(close)!.shield).toBe(0);
  });

  it('a finisher reacts with one mark and detonates the others as plain combos', () => {
    const { r, e, en } = setup();
    const bm = r.add(0, -10, BLACK);
    aim(r, bm, e);
    for (const m of ['soaked', 'burning', 'marked'] as const) en().marks[m] = r.now + 8;
    r.ready(bm, 60);
    expect(r.press(bm, 1)).toBeNull();
    r.until('castEnd');
    const hit = r.hits(bm).find((h) => h.by === 'skyfall_arc')!;
    expect(hit.combo).toEqual(['burning', 'marked']);
    expect(hit.amount).toBe(th(4.0, OVERFLOW_MULT) + 3 * th(COMBO_COEF, OVERFLOW_MULT)); // conduct + two combos
    expect(r.fx('react').map((x) => x.reaction)).toEqual(['conduct']);
    expect(Object.keys(en().marks)).toEqual(['dazed']);
  });

  it('fire on a Thornling ×1.25, water ×0.75; the Light finisher has no element multiplier', () => {
    const { r, e } = setup();
    const bm = r.add(0, -10, BLACK), wm = r.add(3, -10, WHITE);
    aim(r, bm, e); aim(r, wm, e);
    expect(r.press(bm, 0)).toBeNull();
    expect(r.press(wm, 0)).toBeNull();
    r.ready(wm, 60);
    r.w.enemies.get(e)!.marks = {};
    expect(r.press(wm, 1)).toBeNull(); // Lantern Flare, 1 s
    r.until('castEnd');
    const by = (id: string) => r.hits().find((h) => h.by === id)!;
    expect(by('cinder_dart').amount).toBe(th(1.5, ELEMENT_WEAK_MULT * OVERFLOW_MULT));
    expect(by('tidelash').amount).toBe(th(1.4, ELEMENT_RESIST_MULT));
    expect(by('lantern_flare').amount).toBe(th(3.6));
    expect(by('lantern_flare').element).toBeUndefined();
  });

  it('Rooted Thornling chases at 0.6×', () => {
    const run = (rooted: boolean, surging: boolean) => {
      const r = new Rig([camp('thornling', 0, 0)], { liveEnemies: true });
      const e = r.enemy('thornling');
      const a = r.add(0, -40, undefined, 100);
      r.engage(a, e);
      r.tick();
      const en = r.w.enemies.get(e)!;
      en.surging = surging;
      if (rooted) en.marks.rooted = r.now + 8;
      const z0 = en.z;
      for (let k = 0; k < 15; k++) r.tick();
      return z0 - en.z;
    };
    expect(run(false, false)).toBeCloseTo(5.0, 1);
    expect(run(true, false)).toBeCloseTo(5.0 * ROOTED_SPEED_SCALE, 1);
    expect(run(true, true)).toBeCloseTo(SURGE_SCALE * RUN_SPEED * ROOTED_SPEED_SCALE, 1);
  });

  it('Hearthfall splash: half to enemies within 4 m, no marks', () => {
    const { r, e } = setup([camp('thornling', 0, 0), camp('thornling', 4, 0), camp('thornling', -5, 0)]);
    const [, near, far] = [...r.w.enemies.keys()];
    const bm = r.add(0, -10, BLACK);
    aim(r, bm, e);
    expect(r.press(bm, 2)).toBeNull(); // 2.5 s
    r.until('castEnd');
    const plain = th(5.5, ELEMENT_WEAK_MULT * OVERFLOW_MULT);
    const hits = r.hits(bm);
    expect(hits.find((h) => h.dst === e)!.amount).toBe(plain);
    expect(hits.filter((h) => h.dst === near).map((h) => h.amount)).toEqual([Math.round(plain * 0.5)]);
    expect(hits.filter((h) => h.dst === far)).toEqual([]);
    for (const x of r.w.enemies.values()) expect(x.marks).toEqual({});
  });

  it('Barbed Rain: full damage to enemies within 3 m of the target', () => {
    const { r, e } = setup([camp('thornling', 0, 0), camp('thornling', 3, 0), camp('thornling', -4, 0)]);
    const [, near, far] = [...r.w.enemies.keys()];
    const ra = r.add(0, -10, RANGER);
    aim(r, ra, e);
    expect(r.press(ra, 3)).toBeNull();
    const hits = r.hits(ra);
    expect(hits.find((h) => h.dst === e)!.amount).toBe(th(1.4));
    expect(hits.filter((h) => h.dst === near).map((h) => h.amount)).toEqual([th(1.4)]);
    expect(hits.filter((h) => h.dst === far)).toEqual([]);
  });
});
