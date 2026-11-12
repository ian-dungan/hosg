import { describe, expect, it } from 'vitest';
import { ABILITIES, WEAPONS, damageCoef, type AbilityId, type Loadout } from './abilities';
import { hurtAdventurer, damageEnemy, killEnemy } from './adventurer';
import {
  AEGIS_ALLY_TAKEN, AEGIS_TAKEN, AUTO_MOMENTUM, BEHIND_MULT, BLOOD_LIFESTEAL, CAST_BREAK_LOCK_S, FONT_HEAL_MULT, PACT_MULT, PINPOINT_MULT,
  RHYTHM_AUTO_MOMENTUM, STEADFAST_TAKEN, THREAT_PER_HEAL, WEAKPOINT_MULT,
} from './constants';
import { applyBuff } from './effects';
import { resolveHit } from './enemyAi';
import { enemyHit, hitDamage } from './stats';
import { Rig, camp } from './testRig';

const WARRIOR: Loadout = { job: 'warrior', picks: ['mend', 'bulwark'] };
const RANGER: Loadout = { job: 'ranger', picks: ['field_dressing', 'pinning_shot'] };
const PALADIN: Loadout = { job: 'paladin', picks: ['shelter', 'kindle'] }; // shield_rap, bright_verdict, aegis, shelter, kindle
const DARK: Loadout = { job: 'dark_knight', picks: ['bloodbond', 'umbral_brand'] }; // grim_rend, nightfall, crimson_pact, bloodbond, umbral_brand
const NINJA: Loadout = { job: 'ninja', picks: ['mist_form', 'ashcloud'] }; // crossed_fangs, hamstring, ghost_edge, mist_form, ashcloud
const BLACK: Loadout = { job: 'black_mage', picks: ['rootbreak', 'stormcage'] };
const WHITE: Loadout = { job: 'white_mage', picks: ['soft_rain', 'mistveil'] }; // tidelash, lantern_flare, wellspring, soft_rain, mistveil
const th = (coef: number, mult = 1) => hitDamage(coef, 10, 6, mult);
const taken = (raw: number, mult = 1) => enemyHit(raw, 10, mult);
/** Numbers from the data (Task 4 tunes them): a damage coefficient, and the k-th heal amount. */
const c = (id: AbilityId) => damageCoef(ABILITIES[id]);
const healOf = (id: AbilityId, k = 0) => (ABILITIES[id].effects.filter((e) => e.k === 'heal')[k] as { amount: number }).amount;

function setup(kind: 'thornling' | 'mossback' = 'thornling') {
  const r = new Rig([camp(kind, 0, 0)]);
  const e = r.enemy(kind);
  const en = () => r.w.enemies.get(e)!;
  const st = (id: number) => r.w.adventurers.get(id)!;
  /** An enemy hit on `id` (an auto, or a telegraphed attack). */
  const hit = (id: number, raw: number, by: 'auto' | 'thorn_burst' = 'thorn_burst') => resolveHit(r.w, en(), st(id), raw, by, false, null, r.now);
  const aim = (id: number) => expect(r.i(id, { t: 'target', id: e })).toBeNull();
  return { r, e, en, st, hit, aim };
}

describe('job traits', () => {
  it('Warrior autos build 15 Momentum', () => {
    const { r, aim } = setup();
    const a = r.add(0, -1.5, WARRIOR), p3 = r.add(1, -1.5, { weapon: 'blade', free: ['mend', 'bulwark'] });
    aim(a); aim(p3);
    r.until('hit');
    const autos = r.hits().filter((h) => h.by === 'auto');
    expect(autos.map((h) => h.src).sort()).toEqual([a, p3].sort());
    expect(r.c.self(a)!.momentum).toBe(RHYTHM_AUTO_MOMENTUM);
    expect(r.c.self(p3)!.momentum).toBe(AUTO_MOMENTUM); // a Plan 3 loadout runs Plan 3's rules
  });

  it('Ranger +10% only when the target is attacking someone else', () => {
    const { r, en, aim } = setup();
    const ra = r.add(0, -10, RANGER), other = r.add(5, 5);
    aim(ra);
    const shot = (targetId: number | null) => {
      en().targetId = targetId;
      r.ready(ra);
      const n = r.hits(ra).length;
      expect(r.press(ra, 0)).toBeNull(); // Snap Shot
      return r.hits(ra)[n].amount;
    };
    expect(shot(null)).toBe(th(2.0));
    expect(shot(ra)).toBe(th(2.0));
    expect(shot(other)).toBe(th(2.0, PINPOINT_MULT));
  });

  it('Paladin takes ×0.85; Aegis ×0.4 on self, ×0.7 on an ally 7 m away; they never stack below 0.4', () => {
    const { r, st, hit } = setup();
    const pal = r.add(0, -5, PALADIN, 100), ally = r.add(7, -5, WARRIOR), far = r.add(-9, -5, WARRIOR);
    const lost = (id: number, raw: number) => { const hp = st(id).hp; hit(id, raw); return hp - st(id).hp; };
    expect(lost(pal, 40)).toBe(taken(40, STEADFAST_TAKEN));
    expect(lost(ally, 40)).toBe(taken(40));
    expect(r.press(pal, 2)).toBeNull(); // Aegis
    expect(lost(pal, 40)).toBe(taken(40, STEADFAST_TAKEN * AEGIS_TAKEN));
    expect(lost(ally, 40)).toBe(taken(40, AEGIS_ALLY_TAKEN));
    expect(lost(far, 40)).toBe(taken(40));
    applyBuff(r.w, st(pal), st(far), 'aegis', 4, r.now);
    applyBuff(r.w, st(pal), st(far), 'aegis_ally', 4, r.now);
    expect(lost(far, 40)).toBe(taken(40, AEGIS_TAKEN));
  });

  it('Paladin threat ×1.5 (a duo partner with equal damage cannot pull the enemy)', () => {
    const { r, en, st } = setup();
    const war = r.add(0, -3, WARRIOR), pal = r.add(1, -3, PALADIN, 50);
    damageEnemy(r.w, war, en(), 20, 'auto', r.now);
    damageEnemy(r.w, pal, en(), 20, 'auto', r.now);
    expect([en().threat.get(war), en().threat.get(pal)]).toEqual([20, 30]);
    expect(en().threat.choose(war, r.now, () => true)).toBe(pal); // 30 ≥ 20 × TARGET_SWITCH_MULT
    expect(en().threat.choose(pal, r.now, () => true)).toBe(pal);
    // heal threat too: Kindle heals the Paladin's ally, then itself
    st(war).hp = 50;
    expect(r.press(pal, 4, war)).toBeNull();
    expect(en().threat.get(pal)).toBeCloseTo(30 + (healOf('kindle', 0) + healOf('kindle', 1)) * THREAT_PER_HEAL * 1.5, 9);
  });

  it('Paladin +5 Momentum per hit taken, shield-absorbed hits included', () => {
    const { r, st, hit } = setup();
    const pal = r.add(0, -5, PALADIN), war = r.add(3, -5, WARRIOR);
    hit(pal, 20);
    expect(st(pal).momentum).toBe(5);
    st(pal).shield = 100; st(pal).shieldUntil = r.now + 10;
    hit(pal, 20, 'auto');
    expect(st(pal).hp).toBe(100 - taken(20, STEADFAST_TAKEN));
    expect(st(pal).momentum).toBe(10);
    hit(war, 20);
    expect(st(war).momentum).toBe(0);
  });

  it('Shelter: the ally takes final − floor(final/2); the Paladin takes the rest ×0.85; stops at once when the Paladin dies', () => {
    const { r, st, hit } = setup();
    const pal = r.add(0, -5, PALADIN), ally = r.add(5, -5, WARRIOR);
    expect(r.press(pal, 3, pal)).toBeNull(); // Shelter is other-ally: the ally given is ignored for the caster
    expect(st(ally).buffs.sheltered?.src).toBe(pal);
    expect(st(pal).buffs.sheltered).toBeUndefined();
    const final = taken(45);
    const moved = Math.floor(final / 2);
    st(pal).iframeUntil = r.now + 1; // redirected damage ignores the Paladin's i-frames
    hit(ally, 45);
    expect([100 - st(ally).hp, 100 - st(pal).hp]).toEqual([final - moved, Math.round(moved * STEADFAST_TAKEN)]);
    expect(st(pal).momentum).toBe(0); // a redirected share is not a hit on the Paladin
    hurtAdventurer(r.w, st(pal), 1000, 0, 'auto', r.now);
    const hp = st(ally).hp;
    hit(ally, 45);
    expect(hp - st(ally).hp).toBe(final);
  });

  it('Dark Knight heals 20% of ability damage, not autos; pact doubles it; Bloodbond copies it to the lowest other ally within 15 m', () => {
    const { r, st, aim } = setup();
    const dk = r.add(0, -1.5, DARK, 50), low = r.add(5, -5, WARRIOR, 40), lower = r.add(0, -20, WARRIOR, 10), high = r.add(-5, -5, WARRIOR, 80);
    aim(dk);
    const heals = () => r.fx('heal').filter((h) => h.src === dk);
    expect(r.press(dk, 0)).toBeNull(); // Grim Rend: hp-cost 3, damage from the data
    const rend = th(c('grim_rend'));
    expect(heals().map((h) => [h.dst, h.amount])).toEqual([[dk, rend * BLOOD_LIFESTEAL]]);
    expect(st(dk).hp).toBeCloseTo(50 - 3 + rend * BLOOD_LIFESTEAL, 9);
    r.until('hit'); // an auto
    expect(r.hits(dk).at(-1)!.by).toBe('auto');
    expect(heals().length).toBe(1);
    r.ready(dk);
    expect(r.press(dk, 2)).toBeNull(); // Crimson Pact
    r.ready(dk);
    expect(r.press(dk, 3)).toBeNull(); // Bloodbond
    r.ready(dk);
    const before = heals().length;
    expect(r.press(dk, 0)).toBeNull();
    const pactRend = th(c('grim_rend'), PACT_MULT);
    const ls = pactRend * BLOOD_LIFESTEAL * 2;
    expect(heals().slice(before).map((h) => [h.dst, h.amount])).toEqual([[dk, ls], [low, ls]]);
    expect([st(lower).hp, st(high).hp]).toEqual([10, 80]);
  });

  it('Dark Knight +1 Momentum per 3 hp taken', () => {
    const { r, st, hit } = setup();
    const dk = r.add(0, -5, DARK);
    hit(dk, 40); // 32 taken
    expect(st(dk).momentum).toBe(Math.floor(taken(40) / 3));
    st(dk).momentum = 0;
    st(dk).shield = 30; st(dk).shieldUntil = r.now + 5;
    hit(dk, 40); // 30 absorbed, 2 taken
    expect(st(dk).momentum).toBe(0);
    hit(dk, 4); // 3 taken
    expect(st(dk).momentum).toBe(1);
  });

  it('Ninja behind ×1.25 (115° off the front yes, 100° no); Ghost Edge always counts as behind', () => {
    // the Thornling faces +z; the Ninja stands 1.5 m from its centre at the given angle off its front
    const at = (deg: number) => {
      const { r, aim } = setup();
      const rad = (deg * Math.PI) / 180;
      const n = r.add(1.5 * Math.sin(rad), 1.5 * Math.cos(rad), NINJA);
      aim(n);
      expect(r.press(n, 0)).toBeNull(); // Crossed Fangs
      return r.hits(n)[0];
    };
    expect(at(115)).toMatchObject({ amount: th(c('crossed_fangs'), BEHIND_MULT), behind: true });
    expect(at(-115)).toMatchObject({ amount: th(c('crossed_fangs'), BEHIND_MULT), behind: true });
    const front = at(100);
    expect(front.amount).toBe(th(c('crossed_fangs')));
    expect(front.behind).toBeUndefined();
    const { r, aim } = setup();
    const n = r.add(0, 1.5, NINJA);
    aim(n);
    expect(r.press(n, 2)).toBeNull(); // Ghost Edge, from the front
    expect(r.hits(n)[0]).toMatchObject({ by: 'ghost_edge', amount: th(c('ghost_edge'), BEHIND_MULT), behind: true });
    // autos too
    const r2 = setup();
    const n2 = r2.r.add(0, -1.5, NINJA);
    r2.aim(n2);
    r2.r.until('hit');
    expect(r2.r.hits(n2)[0]).toMatchObject({ by: 'auto', amount: th(WEAPONS.daggers.autoCoef, BEHIND_MULT), behind: true });
  });

  it('Ninja perfect dodge +25 Momentum', () => {
    const { r, en, st } = setup();
    const n = r.add(0, -2, NINJA), w = r.add(2, -2, WARRIOR);
    for (const id of [n, w]) {
      st(id).iframeUntil = r.now + 0.5;
      const a = st(id);
      resolveHit(r.w, en(), a, 20, 'thorn_burst', false, null, r.now, { kind: 'circle', x: a.x, z: a.z, r: 1 });
    }
    expect([st(n).momentum, st(w).momentum]).toEqual([25, 10]);
    expect(r.fx('miss').map((m) => m.perfect)).toEqual([true, true]);
  });

  it('Mist Form: Thornling autos miss for 5 s, Thorn Burst still hits', () => {
    const { r, e, st, hit } = setup();
    const n = r.add(0, -2, NINJA);
    expect(r.press(n, 3)).toBeNull();
    hit(n, 20, 'auto');
    expect(st(n).hp).toBe(100);
    expect(r.fx('miss')).toEqual([{ at: 0, t: 'miss', src: e, dst: n, perfect: false, why: 'mist' }]);
    hit(n, 20);
    expect(st(n).hp).toBe(100 - taken(20));
    r.at(4.9);
    hit(n, 20, 'auto');
    expect(st(n).hp).toBe(100 - taken(20));
    r.at(5.1);
    hit(n, 20, 'auto');
    expect(st(n).hp).toBe(100 - 2 * taken(20));
  });

  it('Ashcloud blind: autos miss for 3 s', () => {
    const { r, e, st, hit } = setup();
    const n = r.add(0, -4, NINJA), war = r.add(0, -2, WARRIOR);
    expect(r.press(n, 4)).toBeNull();
    hit(war, 20, 'auto');
    expect(st(war).hp).toBe(100);
    expect(r.fx('miss').map((m) => [m.src, m.dst, m.why])).toEqual([[e, war, 'blind']]);
    hit(war, 20);
    expect(st(war).hp).toBe(100 - taken(20));
    r.at(3.1);
    hit(war, 20, 'auto');
    expect(st(war).hp).toBe(100 - 2 * taken(20));
  });

  it('Weak Point ×1.15 for every attacker', () => {
    const { r, aim } = setup();
    const n = r.add(0, -3, { job: 'ninja', picks: ['weak_point', 'ashcloud'] }), war = r.add(0, -1.5, WARRIOR), ra = r.add(0, -10, RANGER);
    aim(n); aim(war); aim(ra);
    expect(r.press(n, 3)).toBeNull();
    expect(r.press(war, 0)).toBeNull();
    expect(r.press(ra, 0)).toBeNull();
    expect(r.hits(war)[0].amount).toBe(th(1.8, WEAKPOINT_MULT));
    expect(r.hits(ra)[0].amount).toBe(th(2.0, WEAKPOINT_MULT));
  });

  it('White Mage heals others ×1.2, self ×1; +1 Momentum per 2 hp healed, at most 20', () => {
    const r = new Rig([camp('dummy', 30, 0)]);
    const wm = r.add(0, 0, WHITE, 40), ally = r.add(5, 0, WARRIOR, 30);
    for (const id of [wm, ally]) r.engage(id, r.enemy('dummy')); // in combat: no regen
    const cast = (to: number) => {
      r.ready(wm, 0);
      expect(r.press(wm, 2, to)).toBeNull(); // Wellspring, 1.5 s
      r.until('castEnd');
      return r.fx('heal').at(-1)!;
    };
    expect(cast(ally)).toMatchObject({ dst: ally, amount: healOf('wellspring') * FONT_HEAL_MULT });
    expect(r.c.self(wm)!.momentum).toBe(20); // 27, capped
    expect(cast(wm)).toMatchObject({ dst: wm, amount: healOf('wellspring') });
    expect(r.c.self(wm)!.momentum).toBe(Math.min(20, healOf('wellspring') * 0.5));
    r.w.adventurers.get(ally)!.hp = 95;
    expect(cast(ally)).toMatchObject({ dst: ally, amount: 5 });
    expect(r.c.self(wm)!.momentum).toBe(2.5);
  });

  it('White Mage heal threat is half', () => {
    const { r, en, st } = setup();
    const war = r.add(0, -3, WARRIOR, 50), wm = r.add(0, -8, WHITE), ra = r.add(3, -8, RANGER);
    en().threat.add(war, 1);
    expect(r.press(wm, 4, war)).toBeNull(); // Mistveil: a shield, no threat
    expect(en().threat.has(wm)).toBe(false);
    r.ready(wm);
    expect(r.press(ra, 3, war)).toBeNull(); // Field Dressing 25
    expect(en().threat.get(ra)).toBe(25 * THREAT_PER_HEAL);
    st(war).hp = 30;
    expect(r.press(wm, 2, war)).toBeNull();
    r.until('castEnd');
    expect(en().threat.get(wm)).toBe(healOf('wellspring') * FONT_HEAL_MULT * THREAT_PER_HEAL * 0.5);
  });

  it('Black Mage +10 Momentum per completed cast, none on fizzle', () => {
    const { r, en, aim } = setup();
    const bm = r.add(0, -17.5, BLACK); // beyond the Staff's auto range
    aim(bm);
    expect(r.press(bm, 3)).toBeNull(); // Rootbreak, 1 s
    r.until('castEnd');
    expect(r.c.self(bm)!.momentum).toBe(10);
    r.ready(bm, 0);
    expect(r.press(bm, 3)).toBeNull();
    killEnemy(r.w, en(), r.now);
    r.until('castEnd');
    expect(r.fx('castEnd').at(-1)).toMatchObject({ ok: false, reason: 'fizzle' });
    expect(r.c.self(bm)!.momentum).toBe(0);
  });

  it('a telegraph hit interrupts a cast (CAST_BREAK_LOCK_S); an auto does not; a miss does not', () => {
    const { r, en, st, hit, aim } = setup();
    const bm = r.add(0, -10, BLACK);
    aim(bm);
    expect(r.press(bm, 2)).toBeNull(); // Hearthfall, 2.5 s
    r.at(0.5);
    hit(bm, 10, 'auto');
    expect(st(bm).cast).not.toBeNull();
    st(bm).iframeUntil = r.now + 0.3;
    resolveHit(r.w, en(), st(bm), 10, 'thorn_burst', false, null, r.now, { kind: 'circle', x: st(bm).x, z: st(bm).z, r: 1 });
    expect(st(bm).cast).not.toBeNull();
    st(bm).iframeUntil = -Infinity;
    hit(bm, 10);
    expect(st(bm).cast).toBeNull();
    expect(r.fx('castEnd')).toMatchObject([{ ability: 'hearthfall', ok: false, reason: 'interrupt' }]);
    expect(st(bm).readyAt.hearthfall).toBeCloseTo(r.now + CAST_BREAK_LOCK_S, 6);
    expect(st(bm).momentum).toBe(10); // only the perfect dodge's
  });
});
