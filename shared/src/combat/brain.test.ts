// The job-aware brain (Plan 3b): the four rules the Task 4 brief names, each on hand-built views.
import { describe, expect, it } from 'vitest';
import { slotsFor, type AbilityId } from './abilities';
import { adventurerBrain, newBrainMemory, type BrainInput } from './brain';
import type { CombatantView, SelfView, TelegraphView } from './engine';
import { JOBS, type JobId } from './jobs';
import { WEAPONS } from './abilities';

const self = (job: JobId, picks: readonly [AbilityId, AbilityId], o: Partial<CombatantView & SelfView> = {}): CombatantView & SelfView => ({
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
    const pal = (o: Partial<CombatantView & SelfView> = {}) => self('paladin', ['taunt', 'shelter'], { z: -3, cd: [9, 9, 9, 0, 9], ...o });
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
    const bm = (o: Partial<CombatantView & SelfView> = {}) => self('black_mage', ['kindred_spark', 'rootbreak'], { z: -3, cd: [9, 9, 0, 9, 9], ...o });
    const slam: TelegraphView = { id: 5, owner: 1, attack: 'ground_slam', shape: { kind: 'circle', x: 0, z: 0, r: 4.5 }, total: 1.6, left: 1.5 };
    const m = newBrainMemory();
    const act = adventurerBrain(input({ self: bm(), telegraphs: [slam] }), m);
    expect(act.intents.find((i) => i.t === 'ability')).toBeUndefined();
    expect(ability(input({ self: bm(), telegraphs: [] }))).toMatchObject({ slot: 2 });
    // outside the telegraph it casts
    expect(ability(input({ self: bm({ z: -10 }), telegraphs: [slam] }))).toMatchObject({ slot: 2 });
  });
});
