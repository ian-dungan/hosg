// The job-aware brain (Plan 3b): the four rules the Task 4 brief names, each on hand-built views.
import { describe, expect, it } from 'vitest';
import { slotsFor, type AbilityId } from './abilities';
import { adventurerBrain, dungeonBrain, newBrainMemory, type BrainInput, type BrainSelf, type DungeonBrainInput } from './brain';
import type { CombatantView, FieldView, SelfView, TelegraphView } from './engine';
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
const ability = (b: BrainInput) => ('fields' in b ? dungeonBrain(b as DungeonBrainInput, newBrainMemory()) : adventurerBrain(b, newBrainMemory())).intents.find((i) => i.t === 'ability');

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

describe('the dungeon brain (Plan 4)', () => {
  const warden = (o: Partial<CombatantView> = {}): CombatantView => enemy({ id: 1, kind: 'fallen_warden', tier: 'mega', phase: 0, warded: false, enrageIn: 300, hp: 6000, maxHp: 6000, maxStagger: 300, ...o });
  const shard = (id: number, x: number): CombatantView => enemy({ id, kind: 'lens_shard', tier: 'ordinary', x, z: 0, hp: 420, maxHp: 420, maxStagger: 0, targetId: 2, facing: 0 });
  const lampfire: FieldView = { id: 1, owner: 1, field: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }, raw: 8, startedAt: 0 };
  const dIn = (o: Partial<DungeonBrainInput>): DungeonBrainInput => {
    const base = input(o);
    return { ...base, fields: [], arena: { x: 0, z: 0, r: 22 }, enemies: base.target ? [base.target] : [], ...o };
  };
  const think = (b: DungeonBrainInput, m = newBrainMemory()) => dungeonBrain(b, m);

  it('a careful brain walks out of a field toward the arena centre first, and never into one', () => {
    const bm = self('black_mage', JOBS.black_mage.picks.duo, { x: 0, z: -18, cd: [9, 9, 9, 9, 9] });
    const act = think(dIn({ self: bm, target: warden(), fields: [lampfire] }));
    expect(Math.hypot(act.moveTo!.x, act.moveTo!.z)).toBeLessThan(15);
    expect(act.moveTo!.z).toBeGreaterThan(-18);
    // walking up to a target standing on the ring's edge, it stops inside the safe floor
    const far = self('warrior', JOBS.warrior.picks.duo, { x: 0, z: -2 });
    const toward = think(dIn({ self: far, target: warden({ x: 0, z: -19 }), fields: [lampfire] }));
    expect(toward.moveTo === null || Math.hypot(toward.moveTo.x, toward.moveTo.z) < 15).toBe(true);
    // a careless brain stands in it
    expect(think(dIn({ careful: false, self: { ...bm, z: -17 }, target: warden(), fields: [lampfire] })).moveTo).toBeNull();
  });

  it('out of a Cinder Ring it goes inward: it runs when there is time, and dodges inward when there is not', () => {
    const ring = (left: number): TelegraphView => ({ id: 7, owner: 1, attack: 'cinder_ring', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 3.5, r: 9 }, total: 1.6, left });
    const hound = enemy({ id: 1, kind: 'wickhound', tier: 'boss', targetId: 2, maxStagger: 220 });
    const w = self('warrior', JOBS.warrior.picks.duo, { x: 0, z: -5, cd: [9, 9, 9, 9, 9] });
    const run = think(dIn({ self: w, target: hound, telegraphs: [ring(1.0)], arena: { x: 0, z: 0, r: 16 } }));
    expect(run.intents.some((i) => i.t === 'dodge')).toBe(false);
    expect(Math.hypot(run.moveTo!.x, run.moveTo!.z)).toBeLessThan(3.5);
    const dodge = think(dIn({ self: w, target: hound, telegraphs: [ring(0.4)], arena: { x: 0, z: 0, r: 16 } }));
    const d = dodge.intents.find((i) => i.t === 'dodge');
    expect(d).toBeDefined();
    if (d?.t === 'dodge') expect(d.dz).toBeGreaterThan(0.9); // inward, toward the hound at (0, 0)
  });

  it('an unavoidable Keeper\'s Toll is not rolled: the brain shields and heals for it', () => {
    const toll = (left: number): TelegraphView => ({ id: 9, owner: 1, attack: 'keepers_toll', shape: { kind: 'circle', x: 0, z: 0, r: 40 }, total: 3, left, unavoidable: true });
    const r = self('ranger', JOBS.ranger.picks.duo, { x: 0, z: -10, cd: [9, 9, 9, 9, 9] });
    for (const left of [1, 0.2]) expect(think(dIn({ self: r, target: warden(), telegraphs: [toll(left)] })).intents.some((i) => i.t === 'dodge')).toBe(false);
    // a Black Mage puts Bastion Stone (slot 3) on its hurt partner before the Toll lands
    const bm = self('black_mage', ['bastion_stone', 'rootbreak'], { x: 0, z: -8, cd: [9, 9, 9, 0, 9] });
    const hurt = partner({ x: 0, z: -4, hp: 90 });
    expect(think(dIn({ self: bm, target: warden({ targetId: 3 }), allies: [hurt], telegraphs: [toll(2.5)] })).intents).toContainEqual({ t: 'ability', slot: 3, phase: 'press', ally: 3 });
    // without the Toll it keeps it (the partner is above 85%)
    expect(think(dIn({ self: bm, target: warden({ targetId: 3 }), allies: [hurt] })).intents.some((i) => i.t === 'ability' && i.slot === 3)).toBe(false);
  });

  it('while the Warden uses Brass Fall it keeps 4 m from its partner', () => {
    const w = self('warrior', JOBS.warrior.picks.duo, { x: 0, z: -3.5, cd: [9, 9, 9, 9, 9] });
    const p = partner({ x: 1, z: -3.6 });
    const act = think(dIn({ self: w, target: warden({ targetId: 3 }), allies: [p] }));
    expect(act.moveTo).not.toBeNull();
    expect(Math.hypot(act.moveTo!.x - p.x, act.moveTo!.z - p.z)).toBeGreaterThanOrEqual(4);
    // the same spot with a Mossback (no attack on each adventurer): it stays put
    expect(adventurerBrain(input({ self: w, target: enemy({ targetId: 3 }), allies: [p] }), newBrainMemory()).moveTo).toBeNull();
  });

  it('switches to a Lens Shard while the Warden is warded: ranged the nearest, melee the one nearest the Warden', () => {
    const boss = warden({ warded: true, phase: 1 });
    const enemies = [boss, shard(11, -10), shard(12, 10)];
    const bm = self('black_mage', JOBS.black_mage.picks.duo, { x: 8, z: -10, targetId: 1 });
    expect(think(dIn({ self: bm, target: boss, enemies })).intents[0]).toEqual({ t: 'target', id: 12 });
    const wr = self('warrior', JOBS.warrior.picks.duo, { x: 8, z: -10, targetId: 1 });
    const near = [warden({ warded: true, phase: 1, x: -3 }), shard(11, -10), shard(12, 10)];
    expect(think(dIn({ self: wr, target: near[0], enemies: near })).intents[0]).toEqual({ t: 'target', id: 11 });
    // not warded: the Warden
    expect(think(dIn({ self: bm, target: warden(), enemies: [warden(), shard(11, -10)] })).intents.find((i) => i.t === 'target')).toBeUndefined();
  });

  it('holds Sunder for Keeper\'s Toll, and turns from a shard to interrupt it', () => {
    const w = (o: Partial<BrainSelf> = {}) => self('warrior', JOBS.warrior.picks.duo, { x: 0, z: -3.5, momentum: 60, cd: [9, 0, 9, 9, 9], ...o });
    const m = newBrainMemory();
    expect(ability(dIn({ self: w(), target: warden() }))).toBeUndefined(); // ready, but held for the Toll
    const tolling = warden({ windup: { attack: 'keepers_toll', total: 3, left: 2.5, interruptible: true } });
    expect(think(dIn({ self: w(), target: tolling }), m).intents).toContainEqual({ t: 'ability', slot: 1, phase: 'press' });
    // on a shard while the warded Warden tolls next to it
    const boss = { ...tolling, warded: true, phase: 1 };
    const s = shard(11, -2);
    const act = think(dIn({ self: w({ targetId: 11 }), target: boss, enemies: [boss, s] }));
    const k = act.intents.findIndex((i) => i.t === 'ability');
    expect(act.intents[k]).toEqual({ t: 'ability', slot: 1, phase: 'press' });
    expect(act.intents.slice(0, k).at(-1)).toEqual({ t: 'target', id: 1 });
  });

  it('a ranged adventurer in a boss fight stays near its healer or tank', () => {
    const bm = (o: Partial<BrainSelf> = {}) => self('black_mage', JOBS.black_mage.picks.duo, { x: 0, z: -5, cd: [9, 9, 9, 9, 9], ...o });
    // with a Paladin at the Warden, a Black Mage 16 m out comes within 10 m of it
    const pal = partner({ job: 'paladin', x: 0, z: -3.5 });
    const far = think(dIn({ self: bm({ z: -16 }), target: warden({ targetId: 3 }), allies: [pal] }));
    expect(Math.hypot(far.moveTo!.x - pal.x, far.moveTo!.z - pal.z)).toBeLessThanOrEqual(10);
  });

  it('P4-k: a Dark Knight (no interrupt) turns from a shard to put its finisher into a tolling Warden, to Break it', () => {
    const dk = self('dark_knight', JOBS.dark_knight.picks.duo, { x: 0, z: -3.5, momentum: 60, cd: [9, 0, 9, 9, 9], targetId: 11 });
    const boss = warden({ warded: true, phase: 1, windup: { attack: 'keepers_toll', total: 4, left: 3, interruptible: true, unavoidable: true } });
    const s = shard(11, -2);
    const act = think(dIn({ self: dk, target: boss, enemies: [boss, s] }));
    const k = act.intents.findIndex((i) => i.t === 'ability');
    expect(act.intents[k]).toEqual({ t: 'ability', slot: 1, phase: 'press' });
    expect(act.intents.slice(0, k).at(-1)).toEqual({ t: 'target', id: 1 });
  });
});
