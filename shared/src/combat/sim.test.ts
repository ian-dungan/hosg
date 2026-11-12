import { describe, expect, it } from 'vitest';
import { simulateFight, simulateParty } from './sim';
import { adventurerBrain, newBrainMemory, type BrainInput } from './brain';
import type { CombatantView, SelfView, TelegraphView } from './engine';

const SEEDS = [1, 2, 3, 4, 5];
const ORDINARY = ['thornling', 'boar', 'archer'] as const;
const WEAPONS = ['blade', 'bow'] as const;

describe('seeded fight simulation: the bands', () => {
  for (const enemy of ORDINARY) for (const weapon of WEAPONS) {
    it(`${weapon} vs ${enemy}, careful: dies in 10–15 s and the adventurer survives`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, weapon, enemy, careful: true });
        expect(r.died, `seed ${seed}`).toBe(false);
        expect(r.ttk, `seed ${seed}`).not.toBeNull();
        expect(r.ttk!, `seed ${seed}`).toBeGreaterThanOrEqual(10);
        expect(r.ttk!, `seed ${seed}`).toBeLessThanOrEqual(15);
      }
    });
    it(`${weapon} vs ${enemy}, careless: the adventurer still survives`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, weapon, enemy, careful: false });
        expect(r.died, `seed ${seed}`).toBe(false);
        expect(r.killedAt, `seed ${seed}`).not.toBeNull();
      }
    });
  }

  for (const weapon of WEAPONS) {
    // Band floor: 40 s, but 36 s for the Bow (coordinator ruling, fix round 1: Charged Shot adds ~3.5 dps
    // and ~3 breaks, so the Bow's arithmetic is ~17.7 dps → 36–42 s).
    const floor = weapon === 'bow' ? 36 : 40;
    it(`${weapon} vs the Mossback, careful: wins with ≥ 25 hp in ${floor}–75 s`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, weapon, enemy: 'mossback', careful: true });
        expect(r.died, `seed ${seed}`).toBe(false);
        expect(r.hpLeft, `seed ${seed}`).toBeGreaterThanOrEqual(25);
        expect(r.ttk!, `seed ${seed}`).toBeGreaterThanOrEqual(floor);
        expect(r.ttk!, `seed ${seed}`).toBeLessThanOrEqual(75);
        expect(r.dodges, `seed ${seed}`).toBeGreaterThan(0);
      }
    });
    it(`${weapon} vs the Mossback, careless: dies before the kill`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, weapon, enemy: 'mossback', careful: false });
        expect(r.died, `seed ${seed}`).toBe(true);
        expect(r.killedAt, `seed ${seed}`).toBeNull();
      }
    });
  }

  it('a careful Blade + Bow duo kills the (scaled) Mossback in 30–50 s, faster than either alone, with no deaths and cross-player combos', () => {
    for (const seed of SEEDS) {
      const duo = simulateParty({ seed, party: [{ weapon: 'blade', careful: true }, { weapon: 'bow', careful: true }], enemy: 'mossback' });
      const solo = Math.min(...WEAPONS.map((weapon) => simulateFight({ seed, weapon, enemy: 'mossback', careful: true }).ttk!));
      expect(duo.ttk!, `seed ${seed}`).toBeGreaterThanOrEqual(30);
      expect(duo.ttk!, `seed ${seed}`).toBeLessThanOrEqual(50);
      expect(duo.ttk!, `seed ${seed}`).toBeLessThan(solo);
      expect(duo.members.every((m) => !m.died), `seed ${seed}`).toBe(true);
      expect(duo.combos, `seed ${seed}`).toBeGreaterThan(0);
    }
  });

  it('a careless Blade + Bow duo loses a member in at least 80% of seeds (measured 19/20 on seeds 1–20, 92/100 on 1–100)', () => {
    // Recorded, not a band: further elite tuning waits for live play-testing (coordinator decision, fix round 2).
    let lost = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = simulateParty({ seed, party: [{ weapon: 'blade', careful: false }, { weapon: 'bow', careful: false }], enemy: 'mossback' });
      if (r.members.some((m) => m.died)) lost++;
    }
    expect(lost).toBeGreaterThanOrEqual(16);
  });

  it('the chase surge rarely triggers in a stand-up fight: only a careful Bow vs the Mossback, under 2 s a fight', () => {
    for (const enemy of ['thornling', 'boar', 'archer', 'mossback'] as const) for (const weapon of WEAPONS) for (const careful of [true, false]) {
      const r = simulateParty({ seed: 1, party: [{ weapon, careful }], enemy });
      expect(r.surgeS, `${enemy} ${weapon} ${careful}`).toBeLessThan(2);
    }
  });

  it('is deterministic for a seed', () => {
    expect(simulateFight({ seed: 9, weapon: 'bow', enemy: 'mossback', careful: true })).toEqual(simulateFight({ seed: 9, weapon: 'bow', enemy: 'mossback', careful: true }));
  });
});


describe('adventurerBrain', () => {
  const self = (o: Partial<CombatantView & SelfView> = {}): CombatantView & SelfView => ({
    id: 2, team: 'adventurer', kind: 'adventurer', x: 0, z: -3, y: 0, facing: 0, hp: 100, maxHp: 100, alive: true, shield: 0,
    marks: 0, stagger: 0, maxStagger: 0, targetId: 1, act: '', windup: null,
    momentum: 0, weapon: 'blade', slots: ['slash', 'sunder', 'parry', 'mend', 'bulwark'], cd: [9, 9, 9, 9, 9], gcd: 0, swapCd: 0, swapLock: 0,
    dodgeCharges: 2, dodgeNextIn: 0, charge: null, inCombat: true, ...o,
  });
  const enemy: CombatantView = {
    id: 1, team: 'enemy', kind: 'mossback', x: 0, z: 0, y: 0, facing: Math.PI, hp: 750, maxHp: 750, alive: true, shield: 0,
    marks: 0, stagger: 0, maxStagger: 100, targetId: 2, act: '', windup: null,
  };
  const slam = (elapsed: number): TelegraphView => ({ id: 5, owner: 1, attack: 'ground_slam', shape: { kind: 'circle', x: 0, z: 0, r: 4.5 }, total: 1.6, left: 1.6 - elapsed });
  const input = (o: Partial<BrainInput>): BrainInput => ({ nowS: 10, careful: true, self: self(), target: enemy, telegraphs: [], ...o });

  it('a careful brain dodges a telegraph containing it once 0.4 s have passed, along escapeDir, once', () => {
    const m = newBrainMemory();
    expect(adventurerBrain(input({ telegraphs: [slam(0.3)] }), m).intents.filter((i) => i.t === 'dodge')).toEqual([]);
    const act = adventurerBrain(input({ telegraphs: [slam(0.4)] }), m);
    expect(act.intents).toEqual([{ t: 'dodge', dx: 0, dz: -1, from: { x: 0, z: -3, y: 0 }, grounded: true }]);
    expect(act.moveTo).toBeNull();
    expect(adventurerBrain(input({ telegraphs: [slam(0.5)] }), m).intents.filter((i) => i.t === 'dodge')).toEqual([]);
  });

  it('a careless brain never dodges; no brain ever swaps or parries', () => {
    const m = newBrainMemory();
    for (let k = 0; k < 30; k++) {
      const act = adventurerBrain(input({ careful: k % 2 === 0, nowS: k / 15, telegraphs: [slam(k / 20)], self: self({ cd: [0, 0, 0, 0, 0], momentum: 60 }) }), m);
      for (const i of act.intents) {
        expect(i.t).not.toBe('swap');
        if (i.t === 'ability') expect(i.slot).not.toBe(2);
        if (k % 2 === 1) expect(i.t).not.toBe('dodge');
      }
    }
  });

  it('abilities in order: Mend below half, Bulwark, the finisher, the quick skill', () => {
    const ready = { cd: [0, 0, 0, 0, 0], momentum: 60 };
    const slot = (o: Partial<CombatantView & SelfView>, careful = false) =>
      adventurerBrain(input({ careful, self: self(o) }), newBrainMemory()).intents.find((i) => i.t === 'ability');
    expect(slot({ ...ready, hp: 40 })).toMatchObject({ slot: 3 });
    expect(slot({ ...ready })).toMatchObject({ slot: 4 });
    expect(slot({ ...ready, cd: [0, 0, 0, 0, 9] })).toMatchObject({ slot: 1 });
    expect(slot({ ...ready, cd: [0, 0, 0, 0, 9], momentum: 10 })).toMatchObject({ slot: 0 });
  });

  it('a careful Blade holds Sunder up to 1 s for an interruptible wind-up', () => {
    const m = newBrainMemory();
    const s = self({ cd: [9, 0, 9, 9, 9], momentum: 60 });
    expect(adventurerBrain(input({ nowS: 10, self: s }), m).intents).toEqual([]);
    const hail = { ...enemy, windup: { attack: 'thorn_hail' as const, total: 2.2, left: 2, interruptible: true } };
    expect(adventurerBrain(input({ nowS: 10.3, self: s, target: hail }), m).intents).toEqual([{ t: 'ability', slot: 1, phase: 'press' }]);
    const m2 = newBrainMemory();
    adventurerBrain(input({ nowS: 10, self: s }), m2);
    expect(adventurerBrain(input({ nowS: 10.5, self: s }), m2).intents).toEqual([]);
    expect(adventurerBrain(input({ nowS: 11, self: s }), m2).intents).toEqual([{ t: 'ability', slot: 1, phase: 'press' }]);
  });
});

describe('adventurerBrain (fix round 1)', () => {
  const base = (o: Partial<CombatantView & SelfView> = {}): CombatantView & SelfView => ({
    id: 2, team: 'adventurer', kind: 'adventurer', x: 0, z: -7, y: 0, facing: 0, hp: 100, maxHp: 100, alive: true, shield: 0,
    marks: 0, stagger: 0, maxStagger: 0, targetId: 1, act: '', windup: null,
    momentum: 0, weapon: 'blade', slots: ['slash', 'sunder', 'parry', 'mend', 'bulwark'], cd: [9, 9, 9, 9, 9], gcd: 0, swapCd: 0, swapLock: 0,
    dodgeCharges: 2, dodgeNextIn: 0, charge: null, inCombat: true, ...o,
  });
  const boss: CombatantView = {
    id: 1, team: 'enemy', kind: 'mossback', x: 0, z: 0, y: 0, facing: Math.PI, hp: 750, maxHp: 750, alive: true, shield: 0,
    marks: 0, stagger: 0, maxStagger: 100, targetId: 2, act: '', windup: null,
  };
  const slam: TelegraphView = { id: 5, owner: 1, attack: 'ground_slam', shape: { kind: 'circle', x: 0, z: 0, r: 4.5 }, total: 1.6, left: 1 };

  it('a careful brain outside a telegraph does not walk back into it; a careless one does', () => {
    const careful = adventurerBrain({ nowS: 10, careful: true, self: base(), target: boss, telegraphs: [slam] }, newBrainMemory());
    expect(careful.moveTo).toBeNull();
    const careless = adventurerBrain({ nowS: 10, careful: false, self: base(), target: boss, telegraphs: [slam] }, newBrainMemory());
    expect(careless.moveTo).not.toBeNull();
    const clear = adventurerBrain({ nowS: 10, careful: true, self: base(), target: boss, telegraphs: [] }, newBrainMemory());
    expect(clear.moveTo).not.toBeNull();
  });

  it('a held Charged Shot of frac ≥ 0.8 is released before the dodge; a weaker one is not', () => {
    const bow = (charge: number) => base({ weapon: 'bow', slots: ['snap_shot', 'pitch_arrow', 'charged_shot', 'mend', 'bulwark'], z: -3, charge, act: 'charge' });
    const strong = adventurerBrain({ nowS: 10, careful: true, self: bow(1.3), target: boss, telegraphs: [{ ...slam, left: 1.1 }] }, newBrainMemory());
    expect(strong.intents.map((i) => i.t === 'ability' ? `${i.slot}:${i.phase}` : i.t)).toEqual(['2:release', 'dodge']);
    const weak = adventurerBrain({ nowS: 10, careful: true, self: bow(0.6), target: boss, telegraphs: [{ ...slam, left: 1.1 }] }, newBrainMemory());
    expect(weak.intents.map((i) => i.t)).toEqual(['dodge']);
  });
});

// ═════════ Plan 3b: the Plan 3 bands as jobs (the Plan 3 tests above stay as they were) ═════════
describe('the Plan 3 bands as the Warrior and the Ranger, with their solo picks', () => {
  const JOBS2 = ['warrior', 'ranger'] as const;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  for (const enemy of ORDINARY) for (const job of JOBS2) {
    // Ruling P3b-e: the Ranger's Pinning Shot combo puts it under Plan 3's 10 s floor; its band is a mean in [8.5, 15]
    it(`${job} vs ${enemy}, careful: ${job === 'warrior' ? 'dies in 10–15 s' : 'a mean of 8.5–15 s'} and the adventurer survives`, () => {
      const rs = SEEDS.map((seed) => simulateFight({ seed, job, enemy, careful: true }));
      rs.forEach((r, i) => {
        expect(r.died, `seed ${SEEDS[i]}`).toBe(false);
        expect(r.ttk, `seed ${SEEDS[i]}`).not.toBeNull();
        if (job === 'warrior') {
          expect(r.ttk!, `seed ${SEEDS[i]}`).toBeGreaterThanOrEqual(10);
          expect(r.ttk!, `seed ${SEEDS[i]}`).toBeLessThanOrEqual(15);
        }
      });
      if (job === 'ranger') {
        expect(avg(rs.map((r) => r.ttk!))).toBeGreaterThanOrEqual(8.5);
        expect(avg(rs.map((r) => r.ttk!))).toBeLessThanOrEqual(15);
      }
    });
    it(`${job} vs ${enemy}, careless: the adventurer still survives`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, job, enemy, careful: false });
        expect(r.died, `seed ${seed}`).toBe(false);
        expect(r.killedAt, `seed ${seed}`).not.toBeNull();
      }
    });
  }
  for (const job of JOBS2) {
    it(`${job} vs the Mossback, careful: wins with ≥ 25 hp in 36–75 s`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, job, enemy: 'mossback', careful: true });
        expect(r.died, `seed ${seed}`).toBe(false);
        expect(r.hpLeft, `seed ${seed}`).toBeGreaterThanOrEqual(25);
        expect(r.ttk!, `seed ${seed}`).toBeGreaterThanOrEqual(36);
        expect(r.ttk!, `seed ${seed}`).toBeLessThanOrEqual(75);
        expect(r.dodges, `seed ${seed}`).toBeGreaterThan(0);
      }
    });
    it(`${job} vs the Mossback, careless: dies before the kill`, () => {
      for (const seed of SEEDS) {
        const r = simulateFight({ seed, job, enemy: 'mossback', careful: false });
        expect(r.died, `seed ${seed}`).toBe(true);
        expect(r.killedAt, `seed ${seed}`).toBeNull();
      }
    });
  }
  it('is deterministic for a seed, and a Plan 3 Bow is not the Ranger job', () => {
    expect(simulateFight({ seed: 9, job: 'ranger', enemy: 'mossback', careful: true })).toEqual(simulateFight({ seed: 9, job: 'ranger', enemy: 'mossback', careful: true }));
    expect(simulateFight({ seed: 9, job: 'ranger', enemy: 'thornling', careful: true })).not.toEqual(simulateFight({ seed: 9, weapon: 'bow', enemy: 'thornling', careful: true }));
  });
});
