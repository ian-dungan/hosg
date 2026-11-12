import { describe, expect, it } from 'vitest';
import { hurtAdventurer } from './adventurer';
import type { Loadout } from './abilities';
import { ABILITIES, BUFF_BITS, DEBUFF_BITS, damageCoef } from './abilities';
import { hitDamage } from './stats';
import { RAIN_HEAL } from './effects';
import { DODGE_REFILL_S, REVIVE_IFRAMES_S } from './constants';
import type { Intent } from './engine';
import { Rig, camp } from './testRig';

const WARRIOR: Loadout = { job: 'warrior', picks: ['mend', 'bulwark'] };
const NINJA: Loadout = { job: 'ninja', picks: ['mist_form', 'ashcloud'] };
const dodge = (r: Rig, id: number): Intent => {
  const v = r.c.get(id)!;
  return { t: 'dodge', dx: 1, dz: 0, from: { x: v.x, z: v.z, y: v.y }, grounded: true };
};
const job = (j: Loadout['job'], picks: Loadout['picks']): Intent => ({ t: 'job', job: j, picks });
const kill = (r: Rig, id: number) => hurtAdventurer(r.w, r.w.adventurers.get(id)!, 1000, 0, 'auto', r.now);

describe('job intent', () => {
  it('switches warrior → ninja: slots, 3 dodges, Momentum 0, cooldowns kept by id', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, WARRIOR);
    expect(r.c.self(a)).toMatchObject({ job: 'warrior', dodgeMax: 2, dodgeCharges: 2, slots: ['slash', 'sunder', 'parry', 'mend', 'bulwark'] });
    expect(r.press(a, 3)).toBeNull(); // Mend: 20 s
    r.w.adventurers.get(a)!.momentum = 40;
    r.at(2);
    const target = r.c.get(a)!.targetId;
    expect(r.i(a, job('ninja', ['mist_form', 'ashcloud']))).toBeNull();
    const s = r.c.self(a)!;
    expect(s).toMatchObject({ job: 'ninja', momentum: 0, dodgeMax: 3, dodgeCharges: 2, slots: ['crossed_fangs', 'hamstring', 'ghost_edge', 'mist_form', 'ashcloud'] });
    expect(s.dodgeNextIn).toBeCloseTo(DODGE_REFILL_S, 6); // refilling toward the new maximum
    expect(r.c.get(a)!.job).toBe('ninja');
    expect(r.c.get(a)!.targetId).toBe(target);
    expect(r.c.jobLoadout(a)).toEqual({ job: 'ninja', picks: ['mist_form', 'ashcloud'] });
    expect(r.fx('use').length).toBe(1); // only the Mend: a job change sends no fx
    r.at(8);
    expect(r.c.self(a)!.dodgeCharges).toBe(3);
    expect(r.i(a, job('warrior', ['bulwark', 'mend']))).toBeNull();
    const back = r.c.self(a)!;
    expect(back).toMatchObject({ job: 'warrior', dodgeCharges: 2, dodgeMax: 2, dodgeNextIn: 0, slots: ['slash', 'sunder', 'parry', 'bulwark', 'mend'] });
    expect(back.cd[4]).toBeCloseTo(12, 6); // Mend's cooldown, kept by id
  });

  it('refuses not-here where jobSwitch is false or absent', () => {
    for (const jobSwitch of [() => false, null]) {
      const r = new Rig([], { jobSwitch });
      const a = r.add(0, 0);
      const before = r.c.self(a);
      expect(r.i(a, job('ninja', ['mist_form', 'ashcloud']))).toBe('not-here');
      expect(r.c.self(a)).toEqual(before);
    }
    const r = new Rig([], { jobSwitch: (x) => x < 10 });
    const a = r.add(12, 0);
    expect(r.i(a, job('ranger', ['sprint', 'barbed_rain']))).toBe('not-here');
    r.move(a, 5, 0);
    expect(r.i(a, job('ranger', ['sprint', 'barbed_rain']))).toBeNull();
  });

  it('refuses in-combat, dead, busy (casting, charging, dodging), invalid (future job, wrong picks)', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const go = job('paladin', ['taunt', 'kindle']);
    const unchanged = (id: number, i: Intent, why: string) => {
      const before = r.c.self(id);
      expect(r.i(id, i), why).toBe(why);
      expect(r.c.self(id)).toEqual(before);
    };
    const fighter = r.add(0, -2, WARRIOR);
    r.engage(fighter, e);
    unchanged(fighter, go, 'in-combat');
    const dead = r.add(5, 5, WARRIOR);
    kill(r, dead);
    unchanged(dead, go, 'dead');
    const caster = r.add(0, -10, { job: 'black_mage', picks: ['rootbreak', 'bastion_stone'] });
    r.i(caster, { t: 'target', id: e });
    expect(r.press(caster, 2)).toBeNull(); // Hearthfall: 2.5 s
    unchanged(caster, go, 'busy');
    const archer = r.add(3, -10, { job: 'ranger', picks: ['sprint', 'barbed_rain'] });
    r.i(archer, { t: 'target', id: e });
    expect(r.press(archer, 2)).toBeNull(); // Charged Shot
    unchanged(archer, go, 'busy');
    const roller = r.add(-5, -10, WARRIOR);
    expect(r.i(roller, dodge(r, roller))).toBeNull();
    unchanged(roller, go, 'busy');
    const idle = r.add(-20, -20, WARRIOR);
    unchanged(idle, { t: 'job', job: 'monk', picks: ['mend', 'bulwark'] } as unknown as Intent, 'invalid');
    unchanged(idle, job('paladin', ['taunt', 'mend']), 'invalid'); // another job's ability
    unchanged(idle, job('paladin', ['taunt', 'taunt']), 'invalid');
    unchanged(idle, job('paladin', ['taunt', 'aegis']), 'invalid'); // a bar ability
    unchanged(idle, { t: 'job', job: 'paladin', picks: ['taunt', 'nope'] } as unknown as Intent, 'invalid');
    unchanged(idle, { t: 'job', job: 'paladin' } as unknown as Intent, 'invalid');
    // order: busy before invalid, invalid before in-combat
    expect(r.i(caster, { t: 'job', job: 'monk', picks: [] } as unknown as Intent)).toBe('busy');
    expect(r.i(fighter, { t: 'job', job: 'monk', picks: [] } as unknown as Intent)).toBe('invalid');
  });

  it('loadout picks change anywhere out of combat, only from the current pool', () => {
    const r = new Rig([camp('dummy', 20, 0)], { jobSwitch: () => false });
    const a = r.add(0, 0, WARRIOR);
    expect(r.i(a, { t: 'loadout', picks: ['rallying_roar', 'skullringer'] })).toBeNull();
    expect(r.c.self(a)!.slots).toEqual(['slash', 'sunder', 'parry', 'rallying_roar', 'skullringer']);
    expect(r.c.jobLoadout(a)).toEqual({ job: 'warrior', picks: ['rallying_roar', 'skullringer'] });
    expect(r.i(a, { t: 'loadout', picks: ['taunt', 'mend'] })).toBe('invalid');
    expect(r.i(a, { t: 'loadout', picks: ['mend', 'mend'] })).toBe('invalid');
    expect(r.i(a, { t: 'loadout', picks: ['slash', 'mend'] })).toBe('invalid');
    r.engage(a, r.enemy('dummy'));
    expect(r.i(a, { t: 'loadout', picks: ['mend', 'bulwark'] })).toBe('in-combat');
    expect(r.c.self(a)!.slots[3]).toBe('rallying_roar');
  });
});

describe('aims', () => {
  const RANGER: Loadout = { job: 'ranger', picks: ['field_dressing', 'pinning_shot'] };
  it('Field Dressing heals the lowest-hp adventurer in range, self on a tie', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, RANGER, 80), b = r.add(10, 0, WARRIOR, 50), far = r.add(30, 0, WARRIOR, 10);
    expect(r.press(a, 3)).toBeNull();
    expect(r.fx('heal').map((h) => [h.src, h.dst, h.amount])).toEqual([[a, b, 25]]);
    expect(r.c.get(far)!.hp).toBe(10);
    const r2 = new Rig([]);
    const s = r2.add(0, 0, RANGER, 50), o = r2.add(5, 0, WARRIOR, 50);
    void o;
    r2.press(s, 3);
    expect(r2.fx('heal').map((h) => h.dst)).toEqual([s]);
    const r3 = new Rig([]);
    const c = r3.add(0, 0, RANGER, 90), lo = r3.add(5, 0, WARRIOR, 40), hi = r3.add(6, 0, WARRIOR, 40);
    void hi;
    r3.press(c, 3);
    expect(r3.fx('heal').map((h) => h.dst)).toEqual([lo]); // a tie between others: the lower id
  });

  it('an explicit ally id wins when valid, and is ignored when out of range or dead', () => {
    const r = new Rig([camp('dummy', 40, 40)]);
    const a = r.add(0, 0, RANGER), b = r.add(5, 0, WARRIOR, 90), c = r.add(-5, 0, WARRIOR, 10), far = r.add(0, 25, WARRIOR, 5);
    for (const id of [a, b, c, far]) r.engage(id, r.enemy('dummy')); // in combat: no regen
    const dead = r.add(3, 3, WARRIOR);
    kill(r, dead);
    expect(r.press(a, 3, b)).toBeNull();
    expect(r.fx('heal').map((h) => [h.dst, h.amount])).toEqual([[b, 10]]);
    r.at(20);
    r.press(a, 3, far);
    r.at(40);
    r.press(a, 3, dead);
    r.at(60);
    r.press(a, 3, 99999);
    expect(r.fx('heal').map((h) => h.dst)).toEqual([b, c, c, c]);
  });

  it('Shelter and Kindred Spark refuse no-ally alone', () => {
    const r = new Rig([]);
    const pal = r.add(0, 0, { job: 'paladin', picks: ['shelter', 'taunt'] });
    const mage = r.add(30, 30, { job: 'black_mage', picks: ['kindred_spark', 'rootbreak'] });
    expect(r.press(pal, 3)).toBe('no-ally');
    expect(r.press(pal, 3, pal)).toBe('no-ally'); // never on yourself
    expect(r.press(mage, 3)).toBe('no-ally');
    expect(r.c.self(pal)!.cd[3]).toBe(0);
    expect(r.c.self(pal)!.gcd).toBe(0);
    const friend = r.add(5, 0, WARRIOR);
    expect(r.press(pal, 3, pal)).toBeNull();
    expect(r.c.get(friend)!.buffs).toBe(BUFF_BITS.sheltered);
    expect(r.c.get(pal)!.buffs).toBe(0);
  });

  it('Second Dawn needs a dead adventurer within 12 m', () => {
    const r = new Rig([]);
    const wm = r.add(0, 0, { job: 'white_mage', picks: ['second_dawn', 'soft_rain'] });
    expect(r.press(wm, 3)).toBe('no-ally');
    const alive = r.add(3, 0, WARRIOR);
    void alive;
    expect(r.press(wm, 3)).toBe('no-ally');
    const far = r.add(0, 13.5, WARRIOR);
    kill(r, far);
    expect(r.press(wm, 3)).toBe('no-ally'); // 13.5 > 12 + RANGE_FUZZ
    const near = r.add(0, -12.5, WARRIOR);
    kill(r, near);
    expect(r.press(wm, 3)).toBeNull();
    expect(r.fx('cast').map((c) => [c.ability, c.dst, c.total])).toEqual([['second_dawn', near, 3]]);
  });
});

describe('effects', () => {
  it('Rallying Roar buffs self and an adventurer 9 m away, not one 11 m away, for 8 s', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, { job: 'warrior', picks: ['rallying_roar', 'skullringer'] }), b = r.add(9, 0), c = r.add(0, 11);
    expect(r.press(a, 3)).toBeNull();
    r.tick();
    expect([a, b, c].map((id) => r.c.get(id)!.buffs)).toEqual([BUFF_BITS.roar, BUFF_BITS.roar, 0]);
    expect(r.fx('buff').map((f) => [f.src, f.dst, f.buff, f.on])).toEqual([[a, a, 'roar', true], [a, b, 'roar', true]]);
    r.at(7.9);
    expect(r.c.get(b)!.buffs).toBe(BUFF_BITS.roar);
    r.at(8.1);
    expect(r.c.get(b)!.buffs).toBe(0);
    expect(r.fx('buff').filter((f) => !f.on).map((f) => [f.dst, f.at])).toEqual([[a, 8], [b, 8]]);
  });

  it('Dawn Ward replaces a smaller shield and not a larger one', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, { job: 'paladin', picks: ['dawn_ward', 'kindle'] }), b = r.add(5, 0), c = r.add(0, 5);
    const w = r.w;
    Object.assign(w.adventurers.get(b)!, { shield: 15, shieldUntil: 20 });
    Object.assign(w.adventurers.get(c)!, { shield: 25, shieldUntil: 3 });
    expect(r.press(a, 3)).toBeNull();
    const dw = (ABILITIES.dawn_ward.effects[0] as { amount: number }).amount; // 16 after the Task 4 tuning (> 15, < 25)
    expect([a, b, c].map((id) => r.c.get(id)!.shield)).toEqual([dw, dw, 25]);
    expect(r.fx('shield').map((f) => [f.src, f.dst, f.amount])).toEqual([[a, a, dw], [a, b, dw]]);
    r.at(3.1);
    expect(r.c.get(c)!.shield).toBe(0); // its own expiry
    r.at(6.1);
    expect(r.c.get(b)!.shield).toBe(0); // the new 6 s, not the old 20
  });

  it('Soft Rain heals RAIN_HEAL a second, 6 times, from its source', () => {
    const r = new Rig([camp('dummy', 30, 0)]);
    const d = r.enemy('dummy');
    const a = r.add(0, 0, { job: 'white_mage', picks: ['soft_rain', 'sun_mote'] }, 50), b = r.add(6, 0, WARRIOR, 50);
    r.engage(a, d); r.engage(b, d); // in combat: no regen
    expect(r.press(a, 3)).toBeNull();
    r.at(10);
    const heals = r.fx('heal');
    expect(heals.filter((h) => h.dst === a).map((h) => [h.at, h.src, h.amount])).toEqual([1, 2, 3, 4, 5, 6].map((t) => [t, a, RAIN_HEAL]));
    expect(heals.filter((h) => h.dst === b).length).toBe(6);
    expect(r.c.get(b)!.hp).toBeCloseTo(50 + 6 * RAIN_HEAL * 1.2, 9); // Font: ×1.2 on others
    expect(r.c.get(a)!.buffs).toBe(0);
  });

  it('Grave Ward and Grim Rend never take the last hp, and are not combat damage', () => {
    const r = new Rig([camp('dummy', 0, 0)]);
    const d = r.enemy('dummy');
    const a = r.add(0, -2, { job: 'dark_knight', picks: ['grave_ward', 'umbral_brand'] }, 5);
    expect(r.press(a, 3)).toBeNull();
    expect(r.c.get(a)!.hp).toBe(1);
    expect(r.c.get(a)!.shield).toBe(30);
    expect(r.c.self(a)!.inCombat).toBe(false);
    expect(r.hits().filter((h) => h.dst === a)).toEqual([]);
    r.i(a, { t: 'target', id: d });
    r.at(1);
    expect(r.press(a, 0)).toBeNull(); // Grim Rend at 1 hp: the cost takes nothing; Crimson Tithe heals 20% of the hit
    const rend = r.hits(a).find((h) => h.by === 'grim_rend')!.amount;
    expect(rend).toBe(hitDamage(damageCoef(ABILITIES.grim_rend), 10, 0));
    expect(r.c.get(a)!.hp).toBeCloseTo(1 + 0.2 * rend, 9);
    expect(r.hits(a).some((h) => h.by === 'grim_rend' && h.dst === d)).toBe(true);
    expect(r.c.get(a)!.alive).toBe(true);
  });

  it('Quickstep refills one dodge, capped at 3', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, { job: 'ninja', picks: ['quickstep', 'mist_form'] });
    for (let k = 0; k < 3; k++) { expect(r.i(a, dodge(r, a))).toBeNull(); r.at(r.now + 0.5); }
    expect(r.c.self(a)!.dodgeCharges).toBe(0);
    expect(r.press(a, 3)).toBeNull();
    expect(r.c.self(a)!.dodgeCharges).toBe(1);
    const b = r.add(10, 10, { job: 'ninja', picks: ['quickstep', 'mist_form'] });
    expect(r.press(b, 3)).toBeNull();
    expect(r.c.self(b)).toMatchObject({ dodgeCharges: 3, dodgeNextIn: 0 });
  });

  it('Ashcloud sets the ninja\'s threat to 0 on enemies within 6 m and keeps the entry', () => {
    const r = new Rig([camp('thornling', 0, 5), camp('dummy', 0, -7.6)]);
    const t = r.enemy('thornling'), d = r.enemy('dummy');
    const n = r.add(0, 0, { job: 'ninja', picks: ['ashcloud', 'mist_form'] }), o = r.add(20, 0);
    for (const e of [t, d]) { r.w.enemies.get(e)!.threat.add(n, 50); r.w.enemies.get(e)!.threat.add(o, 5); }
    expect(r.press(n, 3)).toBeNull();
    const tt = r.w.enemies.get(t)!.threat, dt = r.w.enemies.get(d)!.threat;
    expect([tt.has(n), tt.get(n), tt.get(o)]).toEqual([true, 0, 5]);
    expect(dt.get(n)).toBe(50); // reach 7.1
    expect(r.c.get(t)!.debuffs).toBe(DEBUFF_BITS.blinded);
    expect(r.c.get(d)!.debuffs).toBe(0);
    r.at(3.1);
    expect(r.c.get(t)!.debuffs).toBe(0);
    expect(r.fx('buff').map((f) => [f.dst, f.buff, f.on])).toEqual([[t, 'blinded', true], [t, 'blinded', false]]);
  });

  it('Kindred Spark gives +37 to the partner, +10 to self, with gift fx', () => {
    const r = new Rig([]);
    const m = r.add(0, 0, { job: 'black_mage', picks: ['kindred_spark', 'rootbreak'] }), p = r.add(10, 0);
    expect(r.press(m, 3)).toBeNull();
    expect([r.c.self(p)!.momentum, r.c.self(m)!.momentum]).toEqual([37, 10]);
    expect(r.fx('gift').map((g) => [g.src, g.dst, g.amount])).toEqual([[m, p, 37], [m, m, 10]]);
  });

  it('revive: hp 40, act cleared, cooldowns kept, revived in TickOut', () => {
    const r = new Rig([]);
    const wm = r.add(0, 0, { job: 'white_mage', picks: ['second_dawn', 'soft_rain'] }), b = r.add(5, 0);
    r.press(b, 3); // Mend: 20 s
    r.w.adventurers.get(b)!.momentum = 70;
    r.at(1);
    kill(r, b);
    expect(r.c.get(b)!.act).toBe('dead');
    expect(r.press(wm, 3)).toBeNull();
    r.at(4.1);
    const revived = r.outs.flatMap((o) => o.revived ?? []);
    expect(revived).toEqual([{ id: b, by: wm, hp: 40 }]);
    expect(r.fx('revive').map((f) => [f.src, f.dst, f.hp])).toEqual([[wm, b, 40]]);
    expect(r.c.get(b)).toMatchObject({ alive: true, hp: 40, act: '' });
    expect(r.c.self(b)!.momentum).toBe(0);
    expect(r.c.self(b)!.cd[3]).toBeGreaterThan(15);
    expect(r.press(b, 4)).toBeNull(); // Bulwark: it can act again
  });
});

describe('relog', () => {
  it('carry keeps per-id cooldowns across a job change', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, WARRIOR);
    r.press(a, 3); // Mend
    r.at(1);
    r.i(a, job('ninja', ['mist_form', 'ashcloud']));
    const carry = r.c.carryOf(a)!;
    expect(carry.cooldowns.mend).toBeCloseTo(19, 6);
    r.c.removeAdventurer(a);
    const b = r.c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: NINJA, carry }, r.now);
    expect(r.c.self(b)!.job).toBe('ninja');
    expect(r.i(b, job('warrior', ['mend', 'bulwark']))).toBeNull();
    expect(r.c.self(b)!.cd[3]).toBeCloseTo(19, 6);
    expect(r.press(b, 3)).toBe('cooldown');
  });

  it('carry never holds a cast', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const a = r.add(0, -10, { job: 'black_mage', picks: ['rootbreak', 'bastion_stone'] });
    r.i(a, { t: 'target', id: e });
    expect(r.press(a, 2)).toBeNull();
    expect(r.c.self(a)!.cast).not.toBeNull();
    const carry = r.c.carryOf(a)!;
    expect(JSON.stringify(carry)).not.toContain('cast');
    expect(carry.cooldowns.hearthfall).toBeUndefined();
    r.c.removeAdventurer(a);
    const b = r.c.addAdventurer({ x: 0, z: -10, y: 0, facing: 0, hp: 100, loadout: { job: 'black_mage', picks: ['rootbreak', 'bastion_stone'] }, carry }, r.now);
    expect(r.c.self(b)!.cast).toBeNull();
    expect(r.c.get(b)!.act).toBe('');
    r.at(4);
    expect(r.hits().filter((h) => h.by === 'hearthfall')).toEqual([]);
    expect(r.fx('castEnd')).toEqual([]);
  });
});

describe('Plan 3 loadouts (deprecated, until Tasks 5–7)', () => {
  it('a Plan 3 loadout runs as Warrior or Ranger with its Plan 3 slots; swap and free picks still work', () => {
    const r = new Rig([]);
    const a = r.c.addAdventurer({ x: 0, z: 0, y: 0, facing: 0, hp: 100, loadout: { weapon: 'bow', free: ['taunt', 'sprint'] } }, 0);
    expect(r.c.self(a)).toMatchObject({ job: 'ranger', weapon: 'bow', slots: ['snap_shot', 'pitch_arrow', 'charged_shot', 'taunt', 'sprint'] });
    expect(r.c.loadout(a)).toEqual({ weapon: 'bow', free: ['taunt', 'sprint'] });
    expect(r.c.jobLoadout(a)).toEqual({ job: 'ranger', picks: ['field_dressing', 'pinning_shot'] });
    expect(r.i(a, { t: 'swap' })).toBeNull();
    expect(r.c.self(a)).toMatchObject({ job: 'warrior', weapon: 'blade', slots: ['slash', 'sunder', 'parry', 'taunt', 'sprint'], swapCd: 2 });
    expect(r.i(a, { t: 'loadout', free: ['mend', 'taunt'] })).toBeNull();
    expect(r.c.loadout(a)).toEqual({ weapon: 'blade', free: ['mend', 'taunt'] });
    // a job intent leaves the Plan 3 shape for good
    expect(r.i(a, job('paladin', ['taunt', 'kindle']))).toBeNull();
    expect(r.i(a, { t: 'swap' })).toBe('invalid');
    expect(r.i(a, { t: 'loadout', free: ['mend', 'taunt'] })).toBe('invalid');
    expect(r.c.loadout(a)).toEqual({ weapon: 'blade', free: ['mend', 'bulwark'] });
    const b = r.add(5, 5, WARRIOR);
    expect(r.i(b, { t: 'swap' })).toBe('invalid');
  });
});

describe('Task 2 review round 1', () => {
  const WM: Loadout = { job: 'white_mage', picks: ['second_dawn', 'soft_rain'] };
  const onTables = (r: Rig, id: number) => [...r.w.enemies.values()].some((e) => e.threat.has(id));

  it('a dead healer is on no threat table while its Soft Rain keeps ticking; a revive does not put it back', () => {
    const r = new Rig([camp('dummy', 30, 0)]);
    const d = r.enemy('dummy');
    const wm = r.add(0, 0, WM, 50), b = r.add(6, 0, WARRIOR, 50), wm2 = r.add(-3, 0, WM);
    r.engage(b, d);
    expect(r.press(wm, 4)).toBeNull(); // Soft Rain
    r.at(1.1);
    expect(r.w.enemies.get(d)!.threat.get(wm)).toBeCloseTo(RAIN_HEAL * 1.2 * 0.5 * 0.5, 9); // heal threat while alive (Font: ×1.2 heal, ×0.5 threat)
    kill(r, wm);
    expect(onTables(r, wm)).toBe(false);
    r.at(2.1);
    expect(r.fx('heal').filter((h) => h.dst === b && h.at === 2).map((h) => h.src)).toEqual([wm]); // still heals
    expect(onTables(r, wm)).toBe(false);
    expect(r.press(wm2, 3, wm)).toBeNull(); // Second Dawn, 3 s
    r.at(5.5);
    expect(r.c.get(wm)!.alive).toBe(true);
    expect(r.fx('heal').filter((h) => h.dst === b && h.at === 5).length).toBe(1);
    expect(onTables(r, wm)).toBe(false);
  });

  it('Momentum decay pauses while casting', () => {
    const r = new Rig([camp('thornling', 0, 0)]);
    const e = r.enemy('thornling');
    const bm = r.add(0, -17.5, { job: 'black_mage', picks: ['rootbreak', 'stormcage'] }); // beyond the Staff's auto range
    r.i(bm, { t: 'target', id: e });
    r.w.adventurers.get(bm)!.momentum = 55; // never dealt damage: decaying
    r.tick(); r.tick();
    const m0 = r.c.self(bm)!.momentum;
    expect(m0).toBeLessThan(55);
    expect(r.press(bm, 1)).toBeNull(); // Skyfall Arc 1.2 s
    r.at(1.1);
    expect(r.c.self(bm)!.momentum).toBe(m0);
    r.until('castEnd');
    expect(r.fx('castEnd')[0].ok).toBe(true);
  });

  it('Second Dawn needs sight of the dead ally', () => {
    const r = new Rig([], { walls: [{ x: 0, z: 4, r: 1 }] });
    const wm = r.add(0, 0, WM), b = r.add(0, 8), c = r.add(8, 0);
    kill(r, b); kill(r, c);
    expect(r.press(wm, 3, b)).toBeNull(); // b is behind the wall: the nearest dead one in sight, c
    expect(r.w.adventurers.get(wm)!.cast!.allyId).toBe(c);
    const r2 = new Rig([], { walls: [{ x: 0, z: 4, r: 1 }] });
    const wm2 = r2.add(0, 0, WM), b2 = r2.add(0, 8);
    kill(r2, b2);
    expect(r2.press(wm2, 3, b2)).toBe('no-ally');
  });

  it('a revive gives REVIVE_IFRAMES_S of revive safety (not dodge i-frames: review 3)', () => {
    const r = new Rig([]);
    const wm = r.add(0, 0, WM), b = r.add(5, 0);
    kill(r, b);
    expect(r.press(wm, 3, b)).toBeNull();
    r.until('revive');
    const at = r.now - 1 / 15;
    expect(r.w.adventurers.get(b)!.reviveSafeUntil).toBeCloseTo(at + REVIVE_IFRAMES_S, 6);
    expect(r.w.adventurers.get(b)!.iframeUntil).toBe(-Infinity);
  });

  it('no heal fx with amount 0', () => {
    const r = new Rig([]);
    const a = r.add(0, 0, WARRIOR);
    expect(r.press(a, 3)).toBeNull(); // Mend at full hp
    expect(r.fx('heal')).toEqual([]);
  });
});
