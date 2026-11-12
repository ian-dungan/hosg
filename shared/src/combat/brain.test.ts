// The job-aware brain (Plan 3b): the four rules the Task 4 brief names, each on hand-built views.
import { describe, expect, it } from 'vitest';
import { slotsFor, type AbilityId } from './abilities';
import { adventurerBrain, newBrainMemory, type BrainInput, type BrainSelf } from './brain';
import type { CombatantView, SelfView, TelegraphView } from './engine';
import { JOBS, type JobId } from './jobs';
import { WEAPONS } from './abilities';

const self = (job: JobId, picks: readonly [AbilityId, AbilityId], o: Partial<BrainSelf> = {}): BrainSelf => ({
  id: 2, team: 'adventurer', kind: 'adventurer', x: 0, z: -10, y: 0, facing: 0, hp: 100, maxHp: 100, alive: true, shield: 0,
  marks: 0, stagger: 0, maxStagger: 0, targetId: 1, act: '', windup: null, job, buffs: 0, debuffs: 0, cast: null,
  momentum: 0, weapon: JOBS[job].weapon, slots: slotsFor({ job, picks: [picks[0], picks[1]] }), cd: [0, 0, 0, 0, 0], gcd: 0, swapCd: 0, swapLock: 0,
  dodgeCharges: JOBS[job].dodgeCharges, dodgeMax: JOBS[job].dodgeCharges, dodgeNextIn: 0, charge: null, inCombat: true, ...o,
});
const enemy = (o: Partial<CombatantView> = {}): CombatantView => ({
  id: 1, team: 'enemy', kind: 'mossback', x: 0, z: 0, y: 0, facing: Math.PI, hp: 750, maxHp: 750, alive: true, shield: 0,
  marks: 0, stagger: 0, maxStagger: 100, targetId: 2, act: '', windup: null, ...o,
});
const partner = (o: Partial<CombatantView> = {}): CombatantView => ({
  id: 3, team: 'adventurer', kind: 'adventurer', x: 2, z: -3, y: 0, facing: 0, hp: 100, maxHp: 100, alive: true, shield: 0,
  marks: 0, stagger: 0, maxStagger: 0, targetId: 1, act: '', windup: null, job: 'warrior', buffs: 0, debuffs: 0, cast: null, ...o,
});
const input = (o: Partial<BrainInput>): BrainInput => ({ nowS: 10, careful: true, self: self('warrior', JOBS.warrior.picks.solo), target: enemy(), allies: [], telegraphs: [], ...o });
const ability = (b: BrainInput) => adventurerBrain(b, newBrainMemory()).intents.find((i) => i.t === 'ability');

describe('the job-aware brain', () => {
  it('a White Mage brain casts Second Dawn on a dead partner before anything else', () => {
    const wm = self('white_mage', ['second_dawn', 'soft_rain'], { hp: 30, momentum: 80 }); // hurt, finisher ready: still the revive first
    const dead = partner({ alive: false, hp: 0, x: 0, z: -4 });
    expect(ability(input({ self: wm, allies: [dead] }))).toEqual({ t: 'ability', slot: 3, phase: 'press', ally: 3 });
    // with nobody dead it heals itself instead (Wellspring below half)
    expect(ability(input({ self: wm, allies: [partner()] }))).toMatchObject({ slot: 2 });
  });

  it('a Paladin taunts only when the enemy targets the partner', () => {
    const pal = (o: Partial<BrainSelf> = {}) => self('paladin', ['taunt', 'shelter'], { z: -3, cd: [9, 9, 9, 0, 9], ...o });
    const p = partner();
    expect(ability(input({ self: pal(), target: enemy({ targetId: 3 }), allies: [p] }))).toMatchObject({ slot: 3 });
    expect(ability(input({ self: pal(), target: enemy({ targetId: 2 }), allies: [p] }))).toBeUndefined();
    expect(ability(input({ self: pal(), target: enemy({ targetId: null }), allies: [p] }))).toBeUndefined();
    expect(ability(input({ self: pal(), target: enemy({ targetId: 3 }), allies: [] }))).toBeUndefined();
  });

  it('a Ninja with a partner holding aggro moves behind the target', () => {
    const nj = self('ninja', ['weak_point', 'ashcloud'], { x: 0, z: -3 });
    const mossback = enemy({ facing: Math.PI, targetId: 3 }); // facing −z, toward the partner
    const act = adventurerBrain(input({ self: nj, target: mossback, allies: [partner()] }), newBrainMemory());
    const back = 1.3 + WEAPONS.daggers.autoRange - 0.6;
    expect(act.moveTo!.x).toBeCloseTo(0, 6);
    expect(act.moveTo!.z).toBeCloseTo(back, 6); // behind: +z
    // the Ninja itself held: it closes in from the front as usual
    const own = adventurerBrain(input({ self: { ...nj, z: -8 }, target: enemy({ targetId: 2 }), allies: [partner()] }), newBrainMemory());
    expect(own.moveTo!.z).toBeLessThan(0);
  });

  it('a careful Black Mage does not start Hearthfall inside a telegraph', () => {
    const bm = (o: Partial<BrainSelf> = {}) => self('black_mage', ['kindred_spark', 'rootbreak'], { z: -3, cd: [9, 9, 0, 9, 9], ...o });
    const slam: TelegraphView = { id: 5, owner: 1, attack: 'ground_slam', shape: { kind: 'circle', x: 0, z: 0, r: 4.5 }, total: 1.6, left: 1.5 };
    const m = newBrainMemory();
    const act = adventurerBrain(input({ self: bm(), telegraphs: [slam] }), m);
    expect(act.intents.find((i) => i.t === 'ability')).toBeUndefined();
    expect(ability(input({ self: bm(), telegraphs: [] }))).toMatchObject({ slot: 2 });
    // outside the telegraph it casts
    expect(ability(input({ self: bm({ z: -10 }), telegraphs: [slam] }))).toMatchObject({ slot: 2 });
  });
});

describe('the brain, review round 1', () => {
  const wm = (o: Partial<BrainSelf> = {}) => self('white_mage', ['second_dawn', 'soft_rain'], { cd: [9, 9, 9, 9, 9], ...o });
  it('the formation spot is on the camp side of the ally, and never past the leash', () => {
    const target = enemy({ x: 0, z: 0, targetId: 3 });
    const ally = partner({ x: 0, z: -2 });
    // the mage 15 m out on the far side: it closes on the ally from the camp side
    const act = adventurerBrain(input({ self: wm({ x: 15, z: -2 }), target, allies: [ally], home: { x: 0, z: 0, leash: 30 } }), newBrainMemory());
    expect(act.moveTo!.z).toBeGreaterThan(-2);
    expect(Math.hypot(act.moveTo!.x, act.moveTo!.z)).toBeLessThanOrEqual(30 - 3);
    // near the edge of the leash the fight is taken from the camp side
    const far = enemy({ x: 0, z: 27, targetId: 2 });
    const back = adventurerBrain(input({ self: wm({ x: 0, z: 40 }), target: far, allies: [], home: { x: 0, z: 0, leash: 30 } }), newBrainMemory());
    expect(back.moveTo!.z).toBeLessThan(27);
  });
  it('no primer before the finisher when its Momentum would spill past 100', () => {
    const ninja = (momentum: number) => self('ninja', ['ashcloud', 'mist_form'], { z: -2, momentum, cd: [0, 0, 9, 9, 9] });
    expect(ability(input({ self: ninja(60) }))).toMatchObject({ slot: 0 }); // Crossed Fangs (+20) primes first
    expect(ability(input({ self: ninja(90) }))).toMatchObject({ slot: 1 }); // 90 + 20 > 100: the finisher at once
  });
  it('a sloppy brain misses a seeded share of the telegraphs it would dodge, the same way for a seed', () => {
    const slam = (id: number): TelegraphView => ({ id, owner: 1, attack: 'ground_slam', shape: { kind: 'circle', x: 0, z: 0, r: 4.5 }, total: 1.6, left: 1 });
    const run = (seed: number) => {
      const m = newBrainMemory(0.4, { rate: 0.3, seed });
      let dodged = 0;
      for (let k = 0; k < 200; k++) if (adventurerBrain(input({ self: self('warrior', ['mend', 'bulwark'], { z: -2 }), telegraphs: [slam(k)] }), m).intents.some((i) => i.t === 'dodge')) dodged++;
      return dodged;
    };
    expect(run(5)).toBe(run(5));
    expect(run(5) / 200).toBeGreaterThan(0.6);
    expect(run(5) / 200).toBeLessThan(0.8);
  });
});
