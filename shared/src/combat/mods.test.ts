import { describe, expect, it } from 'vitest';
import { JOBS, JOB_IDS, type JobId } from './jobs';
import { ITEMS, JOB_ARMOUR, SETS, SET_IDS, kitItems, type GearSlot, type ItemId } from '../items';
import { kitFor } from '../kit';
import { TALENTS, type TalentId } from '../talents';
import type { Kit, Mod } from '../mods';
import { STARTER_STATS } from './stats';
import { probe, addKitted, use, picksWith, ENEMY } from './kitRig';
import { Rig, camp } from './testRig';
import { hurtAdventurer, damageEnemy } from './adventurer';
import { resolveHit } from './enemyAi';
import { indexMods, effectiveCost } from './kitIndex';
import { ABILITIES } from './abilities';
import { CAST_FLOOR_S, CD_FLOOR_S, DODGE_REFILL_S, FINISHER_COST_FLOOR, MIN_CREDIT_FRAC } from './constants';
import { simulateEncounter } from './sim';
import { seededRng } from '../rng';
import { ITEM_IDS, fits, GEAR_SLOTS } from '../items';
import { talentsFor } from '../talents';
import { parseMods } from '../mods';
import { STAGGER_IMMUNE_S } from './stagger';
import { BREAK_STUN_S, MOD_LIMITS, REVIVE_IFRAMES_S, SPECIAL_CAP } from './constants';
import type { Combat } from './engine';

const gearOf = (tier: 1 | 2 | 3, job: JobId): Partial<Record<GearSlot, ItemId>> =>
  Object.fromEntries(Object.entries(kitItems(tier, job)).filter(([, v]) => v !== null)) as Partial<Record<GearSlot, ItemId>>;
const tierKit = (tier: 1 | 2 | 3, job: JobId): Kit => kitFor({ job, level: 10, gear: gearOf(tier, job), talents: [] });
const without = (k: Kit, gone: readonly Mod[]): Kit => ({ stats: k.stats, mods: k.mods.filter((m) => !gone.includes(m)) });
const STARTER: Kit = { stats: STARTER_STATS, mods: [] };

/** One data entry in one context: the kit with it, the same kit without it. */
interface Case { entry: string; job: JobId; ctx: string; mods: readonly Mod[]; withKit: Kit; withoutKit: Kit }
function cases(): Case[] {
  const out: Case[] = [];
  for (const job of JOB_IDS) {
    // each job in its OWN armour type's three sets (both bonuses), in that tier's full kit
    for (const set of SET_IDS) {
      const d = SETS[set];
      if (d.type !== JOB_ARMOUR[job]) continue;
      const k = tierKit(d.tier as 1 | 2 | 3, job);
      for (const [n, mods] of [[3, d.bonus3], [5, d.bonus5]] as const) out.push({ entry: `${set} ${n}`, job, ctx: `T${d.tier}`, mods, withKit: k, withoutKit: without(k, mods) });
    }
    // its named weapon, in its T3 kit
    const t3 = tierKit(3, job);
    const named = ITEMS[gearOf(3, job).weapon!]!;
    out.push({ entry: named.id, job, ctx: 'T3', mods: named.named!.mods, withKit: t3, withoutKit: without(t3, named.named!.mods) });
    // each talent, alone in starter gear and on top of the T3 kit
    for (const id of Object.keys(TALENTS) as TalentId[]) {
      const t = TALENTS[id];
      if (t.job !== job) continue;
      out.push({ entry: id, job, ctx: 'starter', mods: t.mods, withKit: { ...STARTER, mods: t.mods }, withoutKit: STARTER });
      out.push({ entry: id, job, ctx: 'T3', mods: t.mods, withKit: { stats: t3.stats, mods: [...t3.mods, ...t.mods] }, withoutKit: t3 });
    }
  }
  return out;
}

describe('every set bonus, named weapon and talent does something', () => {
  it('table: for each entry (each job in its own armour sets and named weapon; each talent in starter gear and in T3), each mod its job can use changes its probe, and every entry has one', () => {
    const dead: string[] = [];
    let probed = 0;
    for (const c of cases()) {
      let live = 0;
      for (const m of c.mods) {
        const a = probe(c.job, c.withKit, m), b = probe(c.job, c.withoutKit, m);
        if (a === null && b === null) continue; // the job has no means to use this mod (listed in the report)
        probed++;
        if (a === b) dead.push(`${c.entry} (${c.job}, ${c.ctx}): ${JSON.stringify(m)} → ${a}`);
        else live++;
      }
      if (live === 0) dead.push(`${c.entry} (${c.job}, ${c.ctx}): no mod the job can use`);
    }
    expect(dead).toEqual([]);
    expect(probed).toBeGreaterThanOrEqual(180);
  });
});


/** The probe of `m` for `job` with only `m` (and `extra`) on a starter kit, and without it. */
const both = (job: JobId, m: Mod, extra: Mod[] = [], stats = STARTER_STATS) =>
  [probe(job, { stats, mods: [...extra, m] }, m), probe(job, { stats, mods: extra }, m)] as const;
const kit = (mods: Mod[], stats = STARTER_STATS): Kit => ({ stats, mods });

describe('mods, one test per kind', () => {
  it('coef', () => {
    expect(both('warrior', { k: 'coef', ability: 'slash', mult: 1.5 })).toEqual(['[20]', '[13]']);
    // Drawn Breath and Longwatch ride on chargedShot()'s coef (they multiply)
    const [a] = both('ranger', { k: 'coef', ability: 'charged_shot', mult: 1.12 }, [{ k: 'coef', ability: 'charged_shot', mult: 1.2 }]);
    const [b] = both('ranger', { k: 'coef', ability: 'charged_shot', mult: 1.2 });
    expect(JSON.parse(a!)[0]).toBeGreaterThan(JSON.parse(b!)[0]);
    // splash included: Barbed Rain's second target takes the scaled hit too (enemy ids 1 and 2)
    const [e1, e2] = [1, 2];
    const run = (mods: Mod[]) => {
      const rr = new Rig([camp(ENEMY, 0, 0), camp(ENEMY, 2, 0)]);
      const a = addKitted(rr, 'ranger', picksWith('ranger', 'barbed_rain'), kit(mods));
      use(rr, a, 'barbed_rain', e1);
      return rr.hits(a).filter((h) => h.dst === e2).map((h) => h.amount);
    };
    expect(run([{ k: 'coef', ability: 'barbed_rain', mult: 1.25 }])[0]).toBeGreaterThan(run([])[0]);
  });

  it('amount', () => {
    expect(both('warrior', { k: 'amount', ability: 'mend', mult: 1.3 })).toEqual(['{"heals":[39],"shields":[]}', '{"heals":[30],"shields":[]}']);
    expect(both('warrior', { k: 'amount', ability: 'bulwark', mult: 1.4 })).toEqual(['{"heals":[],"shields":[35]}', '{"heals":[],"shields":[25]}']);
    // given: every ability heal and shield it gives (a Black Mage's Bastion Stone too)
    expect(both('black_mage', { k: 'given', mult: 1.1 })).toEqual(['{"heals":[],"shields":[33]}', '{"heals":[],"shields":[30]}']);
    // both kinds: the clamp (MOD_LIMITS.mult) holds the product
    expect(indexMods([{ k: 'amount', ability: 'mend', mult: 3 }, { k: 'amount', ability: 'mend', mult: 3 }]).amount.get('mend')).toBe(2.5);
  });

  it('cd never below 1 s', () => {
    expect(both('warrior', { k: 'cd', ability: 'slash', add: 0.5 })).toEqual(['4.5', '4']);
    expect(both('warrior', { k: 'cd', ability: 'slash', add: -30 })[0]).toBe(String(CD_FLOOR_S));
    expect(both('ninja', { k: 'cd', ability: 'crossed_fangs', add: -3 })[0]).toBe('1');
  });

  it('cast never below 0.3 s; instants stay instant', () => {
    expect(both('black_mage', { k: 'cast', ability: 'hearthfall', mult: 0.8 })).toEqual(['2', '2.5']);
    expect(both('black_mage', { k: 'cast', ability: 'hearthfall', mult: 0.1 }, [{ k: 'cast', ability: 'all', mult: 0.1 }])[0]).toBe(String(CAST_FLOOR_S));
    // an instant with a cast mod stays instant: Slash lands at once
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const a = addKitted(r, 'warrior', picksWith('warrior'), kit([{ k: 'cast', ability: 'all', mult: 0.5 }, { k: 'cast', ability: 'slash', mult: 2 }]));
    use(r, a, 'slash', r.enemy(ENEMY), { finish: false });
    expect(r.c.self(a)!.cast).toBeNull();
    expect(r.fx('use').length).toBe(1);
  });

  it('buffS', () => {
    const [w, wo] = both('ninja', { k: 'buffS', ability: 'weak_point', add: 3 });
    expect(JSON.parse(w!).e.weakpoint).toBe(13);
    expect(JSON.parse(wo!).e.weakpoint).toBe(10);
    // Light Feet: Sprint's own `s` (carried note T4)
    expect(JSON.parse(both('ranger', { k: 'buffS', ability: 'sprint', add: 2 })[0]!).sprint).toBe(6);
    // a shield's duration, and the clamp: at most twice its own, never below 0
    expect(JSON.parse(both('warrior', { k: 'buffS', ability: 'bulwark', add: 30 })[0]!).shield).toBe(12);
    expect(JSON.parse(both('ninja', { k: 'buffS', ability: 'mist_form', add: -30 })[0]!).a).toEqual({});
  });

  it('hpCost 0 allowed', () => {
    expect(both('dark_knight', { k: 'hpCost', ability: 'crimson_pact', mult: 0 })).toEqual(['60', '45']);
    expect(both('dark_knight', { k: 'hpCost', ability: 'crimson_pact', mult: 0.5 })[0]).toBe('52');
  });

  it('stagger and staggerMult', () => {
    expect(both('warrior', { k: 'stagger', ability: 'sunder', add: 10 })).toEqual(['20', '10']);
    expect(both('warrior', { k: 'staggerMult', mult: 1.2 })).toEqual(['12', '10']);
    // staggerMult on parries and perfect dodges too
    const parry = (mods: Mod[]) => {
      const r = new Rig([camp(ENEMY, 0, 0)]);
      const e = r.enemy(ENEMY);
      const a = addKitted(r, 'warrior', picksWith('warrior'), kit(mods));
      use(r, a, 'parry', e);
      resolveHit(r.w, r.w.enemies.get(e)!, r.w.adventurers.get(a)!, 10, 'auto', true, null, r.now);
      return r.w.enemies.get(e)!.stagger.value;
    };
    expect(parry([{ k: 'staggerMult', mult: 1.2 }])).toBeCloseTo(parry([]) * 1.2, 9);
    // and Charged Shot's stagger mods ride on chargedShot()'s stagger
    expect(both('ranger', { k: 'stagger', ability: 'charged_shot', add: 5 })[0]).not.toBe(both('ranger', { k: 'stagger', ability: 'charged_shot', add: 5 })[1]);
  });

  it('finisherCost never below 30; effectiveCost agrees', () => {
    expect(both('warrior', { k: 'finisherCost', add: -10 })).toEqual(['null', '"momentum"']);
    const st = (mods: Mod[]) => ({ modIndex: indexMods(mods) });
    expect(effectiveCost(st([{ k: 'finisherCost', add: -10 }]), ABILITIES.sunder)).toBe(40);
    expect(effectiveCost(st([{ k: 'finisherCost', add: -30 }, { k: 'finisherCost', add: -30 }]), ABILITIES.sunder)).toBe(FINISHER_COST_FLOOR);
    expect(effectiveCost(st([{ k: 'finisherCost', add: -30 }]), ABILITIES.slash)).toBeUndefined();
    // the view carries it (for the AI and the HUD), only when a mod changes it
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const a = addKitted(r, 'white_mage', picksWith('white_mage'), kit([{ k: 'finisherCost', add: -10 }]));
    const b = addKitted(r, 'white_mage', picksWith('white_mage'), null, 3, 0);
    expect(r.c.self(a)!.finisherCost).toBe(40);
    expect(effectiveCost(r.c.self(a)!, ABILITIES.lantern_flare)).toBe(40);
    expect('finisherCost' in r.c.self(b)!).toBe(false);
    // a cast finisher is accepted at the effective cost and spends it at completion (no auto meanwhile)
    expect(use(r, a, 'lantern_flare', r.enemy(ENEMY), { momentum: 39, finish: false })).toBe('momentum');
    expect(use(r, a, 'lantern_flare', r.enemy(ENEMY), { momentum: 45, finish: false })).toBeNull();
    r.w.adventurers.get(a)!.targetId = null;
    r.until('castEnd');
    expect(r.w.adventurers.get(a)!.momentum).toBe(5);
  });

  it('momentumOn for each event, with everyS throttling hitTaken', () => {
    const ev = (job: JobId, on: Extract<Mod, { k: 'momentumOn' }>['on']) => both(job, { k: 'momentumOn', on, amount: 7 }).map((v) => Number(JSON.parse(v!)));
    for (const [job, on] of [['warrior', 'parry'], ['ninja', 'perfectDodge'], ['warrior', 'interrupt'], ['ranger', 'interrupt'], ['paladin', 'hitTaken'],
      ['warrior', 'detonate'], ['black_mage', 'react'], ['black_mage', 'castDone'], ['white_mage', 'cleanse'], ['white_mage', 'revive'], ['ninja', 'behind']] as const) {
      const [w, wo] = ev(job, on);
      // a Ninja's auto in the same tick is a hit from behind too
      if (on === 'behind') expect((w - wo) % 7 === 0 && w > wo, `${job} ${on}`).toBe(true);
      else expect(w - wo, `${job} ${on}`).toBe(7);
    }
    // everyS: a second hit within the window pays nothing; after it, again
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const a = addKitted(r, 'warrior', picksWith('warrior'), kit([{ k: 'momentumOn', on: 'hitTaken', amount: 3, everyS: 1 }]));
    const s = r.w.adventurers.get(a)!;
    // (no ticks in between: Momentum would decay; the hits carry their own times)
    const hit = (t: number, by: 'auto' | 'field' = 'auto', redirected = false) => hurtAdventurer(r.w, s, 1, e, by, t, redirected);
    hit(0); expect(s.momentum).toBe(3);
    hit(0.5); expect(s.momentum).toBe(3);
    hit(1.1); expect(s.momentum).toBe(6);
    // a field tick counts (hp or shield), a Shelter share does not
    hit(2.2, 'field'); expect(s.momentum).toBe(9);
    hit(3.3, 'auto', true); expect(s.momentum).toBe(9);
    // an unthrottled hitTaken is throttled at hitTakenMinEveryS anyway
    expect(indexMods([{ k: 'momentumOn', on: 'hitTaken', amount: 3 }]).momentumOn.get('hitTaken')!.everyS).toBe(0.5);
  });

  it('dodge: +1 charge at most, refill faster', () => {
    expect(both('ninja', { k: 'dodge', charges: 1 })).toEqual(['{"max":4,"next":5}', '{"max":3,"next":5}']);
    expect(indexMods([{ k: 'dodge', charges: 1 }, { k: 'dodge', charges: 1 }]).dodgeCharges).toBe(1);
    expect(both('ninja', { k: 'dodge', refillMult: 0.8 })[0]).toBe('{"max":3,"next":4}');
    // products multiply, clamped at half the refill time
    expect(indexMods([{ k: 'dodge', refillMult: 0.1 }, { k: 'dodge', refillMult: 0.1 }]).dodgeRefillMult).toBe(0.5);
    // the extra charge refills and is usable
    const r = new Rig([]);
    const a = addKitted(r, 'warrior', picksWith('warrior'), kit([{ k: 'dodge', charges: 1, refillMult: 0.8 }]), 0, 0);
    expect(r.c.self(a)!.dodgeCharges).toBe(3);
    for (let i = 0; i < 3; i++) {
      const p = r.c.get(a)!;
      expect(r.i(a, { t: 'dodge', dx: 1, dz: 0, from: { x: p.x, z: p.z, y: p.y }, grounded: true })).toBeNull();
      r.at(r.now + 0.6);
    }
    expect(r.c.self(a)!.dodgeCharges).toBe(0);
    r.at(r.now + DODGE_REFILL_S * 0.8 * 3 + 0.1);
    expect(r.c.self(a)!.dodgeCharges).toBe(3);
  });

  it('healShield and overhealOnly', () => {
    // Mercy on Kindle: 20% of 25 to the ally, 20% of 8 to self
    expect(both('paladin', { k: 'healShield', frac: 0.2, cap: 15 })).toEqual(['[["b",5],["a",1]]', '[]']);
    // overheal only: a full ally overhealed by Kindle's 25 gets 30% of it
    expect(both('paladin', { k: 'healShield', frac: 0.3, cap: 20, overhealOnly: true })[0]).toBe('[["b",7],["a",2]]');
    // the normal kind and the overheal kind are different effects: both apply (one shield, the sum)
    const ix = indexMods([{ k: 'healShield', frac: 0.15, cap: 15 }, { k: 'healShield', frac: 0.15, cap: 10 }, { k: 'healShield', frac: 0.3, cap: 20, overhealOnly: true }]);
    expect(ix.healShield).toEqual({ frac: 0.3, cap: 15, overhealOnly: false });
    expect(ix.overhealShield).toEqual({ frac: 0.3, cap: 20, overhealOnly: true });
    // Soft Rain's ticks are ability heals (ruling P5-c); lifesteal is not, Bloodbond's share is
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const dk = addKitted(r, 'dark_knight', picksWith('dark_knight', 'bloodbond'), kit([{ k: 'healShield', frac: 0.5, cap: 15 }]), 0, -1.8, 40);
    const ally = addKitted(r, 'warrior', ['mend', 'bulwark'], null, 2, -1.8, 40);
    use(r, dk, 'bloodbond', e);
    use(r, dk, 'grim_rend', e);
    const ks = r.fx('kitShield');
    expect(ks.some((f) => f.dst === ally)).toBe(true);
    expect(ks.some((f) => f.dst === dk)).toBe(false);
  });

  it('cdOnCast', () => {
    expect(both('black_mage', { k: 'cdOnCast', s: 0.5 })).toEqual(['-0.5', '0']);
    expect(indexMods([{ k: 'cdOnCast', s: 0.5 }, { k: 'cdOnCast', s: 9 }]).cdOnCast).toBe(1);
  });

  it('afterDodge consumed once', () => {
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const a = addKitted(r, 'ninja', picksWith('ninja'), kit([{ k: 'afterDodge', mult: 1.2, s: 2 }, { k: 'afterDodge', mult: 1.15, s: 2 }]));
    const p = r.c.get(a)!;
    r.i(a, { t: 'dodge', dx: 0, dz: 0.001, from: { x: p.x, z: p.z, y: p.y }, grounded: true });
    r.at(r.now + 0.6);
    use(r, a, 'crossed_fangs', e);
    use(r, a, 'crossed_fangs', e);
    const [first, second] = r.hits(a).filter((h) => h.by === 'crossed_fangs').map((h) => h.amount);
    expect(first).toBeGreaterThan(second);
    // ruling P5-a: the larger applies (×1.2)
    expect(indexMods([{ k: 'afterDodge', mult: 1.2, s: 2 }, { k: 'afterDodge', mult: 1.15, s: 2 }]).afterDodge).toEqual({ mult: 1.2, s: 2 });
    // past its window nothing
    const [late, plain] = (() => {
      const rr = new Rig([camp(ENEMY, 0, 0)]);
      const b = addKitted(rr, 'ninja', picksWith('ninja'), kit([{ k: 'afterDodge', mult: 1.2, s: 2 }]));
      const q = rr.c.get(b)!;
      rr.i(b, { t: 'dodge', dx: 0, dz: 0.001, from: { x: q.x, z: q.z, y: q.y }, grounded: true });
      rr.at(rr.now + 2.5);
      use(rr, b, 'crossed_fangs', rr.enemy(ENEMY));
      return [rr.hits(b).filter((h) => h.by === 'crossed_fangs')[0].amount, second];
    })();
    expect(late).toBe(plain);
  });

  it('lowHpShield once per everyS', () => {
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.enemy(ENEMY);
    const a = addKitted(r, 'paladin', picksWith('paladin'), kit([{ k: 'lowHpShield', frac: 0.15, below: 0.35, everyS: 30 }]));
    const s = r.w.adventurers.get(a)!;
    s.hp = 40; hurtAdventurer(r.w, s, 10, e, 'auto', r.now);
    expect(r.fx('kitShield').map((f) => f.amount)).toEqual([15]);
    expect(r.c.get(a)!.shield).toBe(15);
    r.at(r.now + 10); s.shield = 0; s.hp = 40; hurtAdventurer(r.w, s, 10, e, 'auto', r.now);
    expect(r.fx('kitShield').length).toBe(1);
    r.at(r.now + 21); s.hp = 40; hurtAdventurer(r.w, s, 10, e, 'auto', r.now);
    expect(r.fx('kitShield').length).toBe(2);
    // a hit that stays above the line gives nothing
    expect(both('paladin', { k: 'lowHpShield', frac: 0.15, below: 0.1, everyS: 30 })[0]).toBe('[]');
  });

  it('auraTaken: allied only, strongest wins', () => {
    const hitOn = (party: boolean, auras: Mod[][], self = false) => {
      const r = new Rig([camp(ENEMY, 0, 0)]);
      const e = r.w.enemies.get(r.enemy(ENEMY))!;
      const victim = addKitted(r, 'warrior', ['mend', 'bulwark'], self ? kit(auras[0]) : null, 0, -3);
      if (!party) r.c.setParty(victim, null);
      auras.forEach((m, i) => { if (!self) addKitted(r, 'paladin', picksWith('paladin'), kit(m), 2 + i, -3); });
      resolveHit(r.w, e, r.w.adventurers.get(victim)!, 60, 'auto', false, null, r.now);
      return r.w.adventurers.get(victim)!.hp;
    };
    const none = hitOn(true, []);
    expect(hitOn(true, [[{ k: 'auraTaken', mult: 0.9, r: 8 }]])).toBeGreaterThan(none);
    expect(hitOn(false, [[{ k: 'auraTaken', mult: 0.9, r: 8 }]])).toBe(none); // not allied
    expect(hitOn(true, [[{ k: 'auraTaken', mult: 0.9, r: 8 }]], true)).toBe(none); // self excluded
    const strongest = hitOn(true, [[{ k: 'auraTaken', mult: 0.9, r: 8 }], [{ k: 'auraTaken', mult: 0.8, r: 8 }]]);
    expect(strongest).toBe(hitOn(true, [[{ k: 'auraTaken', mult: 0.8, r: 8 }]]));
    expect(hitOn(true, [[{ k: 'auraTaken', mult: 0.9, r: 0.5 }]])).toBe(none); // out of range
  });

  it('lastStand: 1 hp, i-frames, once per everyS', () => {
    const r = new Rig([camp(ENEMY, 0, 0)]);
    const e = r.w.enemies.get(r.enemy(ENEMY))!;
    const a = addKitted(r, 'paladin', picksWith('paladin'), kit([{ k: 'lastStand', everyS: 90, iframesS: 2 }]));
    const s = r.w.adventurers.get(a)!;
    hurtAdventurer(r.w, s, 500, e.id, 'auto', r.now);
    expect([s.alive, s.hp]).toEqual([true, 1]);
    expect(r.fx('lastStand')).toEqual([{ at: r.now, t: 'lastStand', src: a }]);
    // i-frames: enemy hits and field ticks miss plainly for iframesS
    resolveHit(r.w, e, s, 50, 'auto', false, null, r.now);
    expect(s.alive).toBe(true);
    expect(r.fx('miss').at(-1)).toMatchObject({ dst: a, perfect: false });
    r.at(r.now + 2.1);
    s.hp = 5; hurtAdventurer(r.w, s, 500, e.id, 'auto', r.now);
    expect(s.alive).toBe(false); // not again within everyS
    expect(both('paladin', { k: 'lastStand', everyS: 30, iframesS: 2 })).toEqual(['{"alive":true,"hp":1}', '{"alive":false,"hp":0}']);
  });

  it('resetOn perfectDodge quick', () => {
    expect(both('ninja', { k: 'resetOn', on: 'perfectDodge', slot: 'quick' })).toEqual(['0', '3.5']);
  });

  it('shieldOn taunt for Taunt and Dread Howl', () => {
    expect(both('paladin', { k: 'shieldOn', on: 'taunt', amount: 25, s: 6 })).toEqual(['[25]', '[]']);
    expect(both('dark_knight', { k: 'shieldOn', on: 'taunt', amount: 15, s: 6 })).toEqual(['[15]', '[]']);
    // ruling P5-a: Brassbound 15 and Lampwarden's Oath 25 → 25 for 6 s
    expect(indexMods([{ k: 'shieldOn', on: 'taunt', amount: 15, s: 6 }, { k: 'shieldOn', on: 'taunt', amount: 25, s: 6 }]).shieldOnTaunt).toEqual({ amount: 25, s: 6 });
  });
});

describe('minimum-contribution credit', () => {
  it('credit: a stranger with 5% of the top threat gets no credit; 10% does; the top always does', () => {
    const run = (frac: number) => {
      const r = new Rig([camp('mossback', 0, 0)]);
      const e = r.w.enemies.get(r.enemy('mossback'))!;
      const top = addKitted(r, 'warrior', ['mend', 'bulwark'], null, 0, -2);
      const tagger = addKitted(r, 'ranger', picksWith('ranger'), null, 0, -8);
      r.c.setParty(tagger, null);
      damageEnemy(r.w, tagger, e, 600 * frac, 'auto', r.now);
      damageEnemy(r.w, top, e, e.hp, 'auto', r.now);
      return r.tick().kills[0].credit.sort((x, y) => x - y);
    };
    // top's threat is the killing blow: hp − the tagger's share
    expect(run(0.05 * 750 / 600 / 1.05)).toEqual([1 + 1]); // ids: enemy 1, top 2, tagger 3
    expect(run(0.12)).toEqual([2, 3]);
    expect(MIN_CREDIT_FRAC).toBe(0.1);
    // heal threat and taunt threat count: a tank that only taunted, and a healer who only healed it, are
    // credited beside the damage dealer (Plan 4's party share is the server's, on top)
    const r = new Rig([camp('mossback', 0, 0)]);
    const e = r.w.enemies.get(r.enemy('mossback'))!;
    const dps = addKitted(r, 'ranger', picksWith('ranger'), null, 0, -8);
    const tank = addKitted(r, 'paladin', picksWith('paladin', 'taunt'), null, 0, -2, 20);
    const healer = addKitted(r, 'white_mage', picksWith('white_mage'), null, 0, -8);
    r.w.adventurers.get(tank)!.targetId = null;
    damageEnemy(r.w, dps, e, 60, 'auto', r.now);
    use(r, tank, 'taunt', e.id);
    r.w.adventurers.get(tank)!.targetId = null;
    use(r, healer, 'wellspring', e.id, { ally: tank });
    r.w.adventurers.get(healer)!.targetId = null;
    expect(e.threat.get(healer)!).toBeGreaterThan(0);
    e.hp = 1;
    damageEnemy(r.w, dps, e, 1, 'auto', r.now);
    expect(r.tick().kills[0].credit.sort((x, y) => x - y)).toEqual([dps, tank, healer].sort((x, y) => x - y));
  });
});

/** A full T3 kit for `job` (its set, the 5-piece bonus, its named weapon) and SIM-like talents. */
const t3 = (job: JobId): Kit => kitFor({ job, level: 10, gear: gearOf(3, job), talents: [`${job}_1a`, `${job}_2b`, `${job}_3c`] });

/** A Warden fight (simulateEncounter) with kits set at its first tick; every TickOut, and the tick times. */
function wardenRun(seed: number, jobs: JobId[], kits: Kit[], maxS: number) {
  const outs: string[] = [];
  let kitted = false, ticks = 0, ms = 0;
  const r = simulateEncounter({
    seed, encounter: 'warden', maxS, party: jobs.map((job) => ({ job, skill: 'careful' as const })),
    trace: (out, _t, c: Combat) => {
      outs.push(JSON.stringify(out));
      if (kitted) return;
      kitted = true;
      const ids = [...c.all()].filter((v) => v.team === 'adventurer').map((v) => v.id);
      ids.forEach((id, i) => c.setKit(id, kits[i], 10));
      // time the engine's own tick from here on
      const tick = c.tick.bind(c);
      c.tick = (now: number) => { const t0 = performance.now(); const o = tick(now); ms += performance.now() - t0; ticks++; return o; };
    },
  });
  return { outs, r, perTickMs: ms / Math.max(1, ticks), ticks };
}

/** The test runtime's clock (shared/ has no DOM or Node typings). */
const performance = (globalThis as unknown as { performance: { now(): number } }).performance;

describe('kits over a whole fight', () => {
  const JOBS4: JobId[] = ['paladin', 'ranger', 'white_mage', 'ninja'];
  // Beaconstone (Paladin), Tollwind (Ranger, Ninja), Lenslight (White Mage); Lampwarden's Oath, Longwatch, Dawnlantern, Twin Wicks
  const KITS = JOBS4.map(t3);

  it('determinism: two engines, same seed, kits and intents, identical TickOut streams over a 400 s Warden fight with Beaconstone, Tollwind, Lenslight and two named weapons', () => {
    const sets = KITS.flatMap((k) => k.mods);
    expect(sets).toEqual(expect.arrayContaining([...SETS.beaconstone.bonus3, ...SETS.tollwind.bonus3, ...SETS.lenslight.bonus3, ...ITEMS.longwatch!.named!.mods, ...ITEMS.dawnlantern!.named!.mods]));
    const a = wardenRun(3, JOBS4, KITS, 400), b = wardenRun(3, JOBS4, KITS, 400);
    expect(a.outs.length).toBeGreaterThan(1000);
    expect(b.outs).toEqual(a.outs);
    expect(b.r).toEqual(a.r);
    // the kits did something: the stream differs from the same fight without them
    const plain = wardenRun(3, JOBS4, JOBS4.map(() => ({ stats: STARTER_STATS, mods: [] })), 400);
    expect(plain.outs).not.toEqual(a.outs);
  });

  it('budget: a Warden tick with 4 kitted adventurers stays under 0.35 ms on average', () => {
    // best of three runs (the machine may be busy with other suites)
    const best = Math.min(...[1, 2, 3].map((seed) => wardenRun(seed, JOBS4, KITS, 120).perTickMs));
    expect(best).toBeLessThan(0.35);
  });
});

/** A random legal kit: random fitting gear in every slot (any tier, or the starter), random talents, a random level. */
function randomKit(rng: () => number, job: JobId): Kit {
  const gear: Partial<Record<GearSlot, ItemId>> = {};
  for (const slot of GEAR_SLOTS) {
    const fitting = ITEM_IDS.filter((id) => fits(id, slot, job));
    if (fitting.length && rng() < 0.9) gear[slot] = fitting[Math.floor(rng() * fitting.length)];
  }
  const talents = talentsFor(job).map((row) => row[Math.floor(rng() * 3)].id);
  return kitFor({ job, level: 1 + Math.floor(rng() * 10), gear, talents });
}
/** Random mods at the edges of parseMods' ranges (forged kits: the clamps must hold them). */
function extremeMods(rng: () => number, job: JobId): Mod[] {
  const abs = [...JOBS[job].bar, ...JOBS[job].pool];
  const ab = () => abs[Math.floor(rng() * abs.length)];
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const raw: unknown[] = [];
  for (let i = 0; i < 24; i++) raw.push(pick<unknown>([
    { k: 'coef', ability: ab(), mult: 3 }, { k: 'amount', ability: ab(), mult: 3 }, { k: 'cd', ability: ab(), add: -30 }, { k: 'cast', ability: 'all', mult: 0.1 },
    { k: 'buffS', ability: ab(), add: 30 }, { k: 'hpCost', ability: ab(), mult: 0 }, { k: 'stagger', ability: ab(), add: 100 }, { k: 'finisherCost', add: -30 },
    { k: 'momentumOn', on: pick(['parry', 'perfectDodge', 'interrupt', 'hitTaken', 'detonate', 'react', 'castDone', 'cleanse', 'revive', 'behind']), amount: 100, everyS: 0.001 },
    { k: 'dodge', charges: 1, refillMult: 0.1 }, { k: 'healShield', frac: 1, cap: 1000 }, { k: 'healShield', frac: 1, cap: 1000, overhealOnly: true },
    { k: 'cdOnCast', s: 10 }, { k: 'afterDodge', mult: 3, s: 10 }, { k: 'staggerMult', mult: 3 }, { k: 'lowHpShield', frac: 1, below: 1, everyS: 1 },
    { k: 'auraTaken', mult: 0.1, r: 50 }, { k: 'lastStand', everyS: 30, iframesS: 10 }, { k: 'resetOn', on: 'perfectDodge', slot: 'quick' },
    { k: 'shieldOn', on: 'taunt', amount: 1000, s: 60 }, { k: 'given', mult: 3 },
  ]));
  return parseMods(raw);
}

describe('clamps', () => {
  it('fuzz: random legal kits (and forged extremes) never give zero cooldowns, endless safety, runaway Momentum, oversize shields or endless stagger', () => {
    const rng = seededRng(20261112);
    let fights = 0;
    for (let n = 0; n < 24; n++) {
      const jobs: JobId[] = [JOB_IDS[Math.floor(rng() * 7)], JOB_IDS[Math.floor(rng() * 7)]];
      const forged = n % 3 === 2;
      const kits = jobs.map((job) => (forged ? { stats: { power: 30, defence: 30, maxHp: 250, focus: 99, flow: 99, guard: 99 }, mods: extremeMods(rng, job) } : randomKit(rng, job)));
      const r = new Rig([camp('mossback', 0, 0)], { liveEnemies: true, seed: n + 1 });
      const e = r.enemy('mossback');
      const ids = jobs.map((job, i) => r.c.addAdventurer({ x: i * 2 - 1, z: -3, y: 0, facing: 0, hp: 999, loadout: { job, picks: [JOBS[job].pool[0], JOBS[job].pool[1]] }, kit: kits[i] }, 0));
      for (const id of ids) r.c.setParty(id, 'fuzz');
      const lastStands = new Map<number, number>();
      const breaks: number[] = [];
      const pr = seededRng(n * 7 + 3);
      for (let k = 0; k < 60 * 15; k++) {
        for (const id of ids) {
          const v = r.c.get(id)!;
          if (!v.alive) continue;
          r.i(id, { t: 'target', id: e });
          if (pr() < 0.05) r.i(id, { t: 'dodge', dx: pr() - 0.5, dz: pr() - 0.5, from: { x: v.x, z: v.z, y: v.y }, grounded: true });
          const slot = Math.floor(pr() * 5);
          const before = r.w.out.fx.length;
          if (pr() < 0.4) r.press(id, slot, ids[Math.floor(pr() * 2)]);
          if (r.c.self(id)!.charge !== null && r.c.self(id)!.charge! > 1.6) r.release(id, r.c.self(id)!.slots.indexOf('charged_shot'));
          // a use started now starts a cooldown of at least CD_FLOOR_S
          for (const f of r.w.out.fx.slice(before)) if (f.t === 'use' && f.src === id) {
            expect((r.w.adventurers.get(id)!.readyAt[f.ability] ?? 0) - r.now).toBeGreaterThanOrEqual(CD_FLOOR_S - 1e-9);
          }
        }
        const out = r.tick();
        for (const f of out.fx) {
          if (f.t === 'cast') expect(f.total).toBeGreaterThanOrEqual(CAST_FLOOR_S - 1e-9);
          if (f.t === 'use' && ids.includes(f.src)) expect((r.w.adventurers.get(f.src)!.readyAt[f.ability] ?? 0) - (r.now - 1 / 15)).toBeGreaterThanOrEqual(CD_FLOOR_S - 1e-6);
          if (f.t === 'lastStand') {
            const last = lastStands.get(f.src);
            if (last !== undefined) expect(r.now - last).toBeGreaterThanOrEqual(MOD_LIMITS.lastStandEveryS[0] - 1e-6);
            lastStands.set(f.src, r.now);
          }
          if (f.t === 'break' && f.dst === e) { if (breaks.length) expect(r.now - breaks.at(-1)!).toBeGreaterThanOrEqual(BREAK_STUN_S + STAGGER_IMMUNE_S - 1e-6); breaks.push(r.now); }
        }
        for (const id of ids) {
          const a = r.w.adventurers.get(id)!, v = r.c.self(id)!;
          expect(a.momentum).toBeGreaterThanOrEqual(0);
          expect(a.momentum).toBeLessThanOrEqual(100);
          expect(v.dodgeMax).toBeLessThanOrEqual(JOBS[a.job].dodgeCharges + 1);
          expect(a.modIndex.dodgeRefillMult).toBeGreaterThanOrEqual(MOD_LIMITS.refillMult[0]);
          expect(r.c.get(id)!.shield).toBeLessThanOrEqual(250 * MOD_LIMITS.lowHpFrac[1] + 30 * MOD_LIMITS.mult[1] * (1 + SPECIAL_CAP / 100) + 1);
          expect(a.reviveSafeUntil - r.now).toBeLessThanOrEqual(Math.max(REVIVE_IFRAMES_S, MOD_LIMITS.lastStandIframesS[1]) + 1e-6);
          for (const [, c] of a.modIndex.coef) expect(c).toBeLessThanOrEqual(MOD_LIMITS.mult[1]);
          if (v.finisherCost !== undefined) expect(v.finisherCost).toBeGreaterThanOrEqual(FINISHER_COST_FLOOR);
        }
      }
      // never permanent safety: steady lethal blows kill every adventurer within 10 s
      const t0 = r.now;
      while (ids.some((id) => r.c.get(id)!.alive) && r.now < t0 + 10) {
        for (const id of ids) { const a = r.w.adventurers.get(id)!; if (a.alive) resolveHit(r.w, r.w.enemies.get(e)!, a, 1e5, 'thorn_burst', false, null, r.now); }
        r.at(r.now + 0.5);
      }
      for (const id of ids) expect(r.c.get(id)!.alive, `fight ${n}`).toBe(false);
      fights++;
    }
    expect(fights).toBe(24);
  });
});
