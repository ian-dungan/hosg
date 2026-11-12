import { describe, expect, it } from 'vitest';
import { ABILITIES, JOB_IDS, SIM_TALENTS, TALENTS, TALENT_LEVELS, parseMods, talentMods, talentsFor, validTalents, type TalentId } from './index';

const all = () => Object.values(TALENTS);

describe('talents', () => {
  it('every job has 3 rows of 3; ids, rows and names are unique; every mod names an ability of its own job', () => {
    expect(all()).toHaveLength(63);
    expect(Object.isFrozen(TALENTS)).toBe(true);
    const names = new Set<string>();
    for (const job of JOB_IDS) {
      const rows = talentsFor(job);
      expect(rows).toHaveLength(3);
      rows.forEach((row, r) => {
        expect(row).toHaveLength(3);
        row.forEach((t, c) => {
          expect(t.id).toBe(`${job}_${r + 1}${'abc'[c]}`);
          expect(TALENTS[t.id]).toBe(t);
          expect([t.job, t.row, t.choice]).toEqual([job, r, c]);
          expect(names.has(t.name), t.name).toBe(false);
          names.add(t.name);
          expect(t.desc, t.id).toMatch(/^[A-Z][^.]*\.$/);   // one plain sentence
          expect(t.mods.length, t.id).toBeGreaterThan(0);
          expect(parseMods(t.mods), t.id).toEqual(t.mods);   // well-formed
          for (const m of t.mods) {
            if ('ability' in m && m.ability !== 'all') expect(ABILITIES[m.ability].job, `${t.id} ${m.ability}`).toBe(job);
          }
        });
      });
    }
    // A few rows spelt out exactly as the table gives them.
    expect(TALENTS.warrior_1a).toMatchObject({ name: 'Keen Edge', mods: [{ k: 'coef', ability: 'slash', mult: 1.15 }, { k: 'cd', ability: 'slash', add: 0.5 }] });
    expect(TALENTS.ranger_2c.mods).toEqual([{ k: 'buffS', ability: 'sprint', add: 2 }, { k: 'dodge', refillMult: 0.85 }]);
    expect(TALENTS.paladin_1c.mods).toEqual([{ k: 'momentumOn', on: 'hitTaken', amount: 2, everyS: 1 }]);
    expect(TALENTS.paladin_3c.mods).toEqual([{ k: 'healShield', frac: 0.2, cap: 15 }]);
    expect(TALENTS.dark_knight_3a.mods).toEqual([{ k: 'hpCost', ability: 'crimson_pact', mult: 0.5 }]);
    expect(TALENTS.ninja_3c.mods).toEqual([{ k: 'dodge', charges: 1 }]);
    expect(TALENTS.white_mage_2a.mods).toEqual([{ k: 'cast', ability: 'second_dawn', mult: 0.75 }]);
    expect(TALENTS.black_mage_3b.mods).toEqual([{ k: 'momentumOn', on: 'react', amount: 10 }]);
  });

  it('talentMods keeps only unlocked rows at the job level', () => {
    const ids = ['warrior_1b', 'warrior_2c', 'warrior_3a'];
    expect(talentMods('warrior', 1, ids)).toEqual([]);
    expect(talentMods('warrior', 3, ids)).toEqual([]);
    expect(talentMods('warrior', TALENT_LEVELS[0], ids)).toEqual([...TALENTS.warrior_1b.mods]);
    expect(talentMods('warrior', 7, ids)).toEqual([...TALENTS.warrior_1b.mods, ...TALENTS.warrior_2c.mods]);
    expect(talentMods('warrior', 10, ids)).toEqual([...TALENTS.warrior_1b.mods, ...TALENTS.warrior_2c.mods, ...TALENTS.warrior_3a.mods]);
    // another job's talents, a second pick in a row, and junk are ignored
    expect(talentMods('warrior', 10, ['ranger_1a', 'warrior_1a', 'warrior_1b', 'nope', 'toString'])).toEqual([...TALENTS.warrior_1a.mods]);
    expect(validTalents('warrior', 10, ['ranger_1a', 'warrior_3c', 'warrior_1a', 'warrior_1b', 3, null])).toEqual(['warrior_3c', 'warrior_1a']);
    expect(validTalents('monk', 10, ['warrior_1a'])).toEqual([]);
    expect(validTalents('warrior', NaN, ['warrior_1a'])).toEqual([]);
  });

  it('SIM_TALENTS names one per row', () => {
    for (const job of JOB_IDS) {
      const ids = SIM_TALENTS[job];
      // Task 5 chose the letters (they act on the duo picks; sim.talents.test.ts)
      expect(ids.every((id: TalentId) => id.startsWith(`${job}_`))).toBe(true);
      expect(validTalents(job, 10, ids)).toEqual(ids);
      expect(ids.map((id: TalentId) => TALENTS[id].row)).toEqual([0, 1, 2]);
    }
    expect(Object.isFrozen(SIM_TALENTS.warrior)).toBe(true);
  });
});
