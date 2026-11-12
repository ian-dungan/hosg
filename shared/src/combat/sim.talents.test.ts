// Plan 5 talent bands (Task 5): SIM_TALENTS act on the duo picks, P2 (the default build is a sidegrade),
// P3 (no talent is a trap or a must) and G6 (a skilled duo in starter gear can win; it shares P2's runs).
import { describe, expect, it } from 'vitest';
import { JOBS, JOB_IDS } from './jobs';
import { SIM_TALENTS, TALENTS, talentsFor, type TalentId } from '../talents';
import { GEAR_PAIRS, S20, fightRuns, meanTtk, picksFor, table, talentAbilities, wardenRuns, wins } from './gearRig';

const skilled = (talents: 'sim' | []) => GEAR_PAIRS.map((p) => [`${p.join(' + ')} ${talents === 'sim' ? 'SIM_TALENTS' : 'none'}`, wardenRuns(p, 'skilled', S20, { talents })] as [string, ReturnType<typeof wardenRuns>]);
const total = (rows: ReturnType<typeof skilled>) => rows.reduce((s, [, rs]) => s + wins(rs), 0);

describe('talents in the simulation', { timeout: 240_000 }, () => {
  it('every SIM_TALENTS pick does something with the duo picks: its ability is on the bar or in the duo picks, or it acts on an event', () => {
    for (const job of JOB_IDS) {
      const have = [...JOBS[job].bar, ...JOBS[job].picks.duo];
      expect(SIM_TALENTS[job].map((id) => TALENTS[id].row), job).toEqual([0, 1, 2]);
      for (const id of SIM_TALENTS[job]) for (const ab of talentAbilities(id)) expect(have, `${id}: ${ab}`).toContain(ab);
    }
  });
  it('P2: talents are sidegrades: skilled GEAR_PAIRS in starter gear win the same with SIM_TALENTS as with none, within 3 SD', () => {
    const t = skilled('sim'), none = skilled([]);
    const n = 20 * GEAR_PAIRS.length, k = total(none), p = k / n;
    expect(Math.abs(total(t) - k), table([...none, ...t])).toBeLessThanOrEqual(3 * Math.sqrt(n * p * (1 - p)));
  });
  it('G6: a skilled duo in starter gear can win (the Warden is hard, not a wall): at least 32 of 80', () => {
    const t = skilled('sim');
    expect(total(t), table(t)).toBeGreaterThanOrEqual(32);
  });
  it('P3: no talent is a trap or a must: each alone (on picks that hold its ability), solo careful in starter gear vs the Mossback, keeps the TTK within ±15% and the wins within 2', () => {
    const lines: string[] = [];
    let ok = true;
    for (const job of JOB_IDS) for (const row of talentsFor(job)) for (const t of row) {
      // the first candidate pick set the job survives the Mossback with (at least 10 of 20) without the talent
      const cands = picksFor(t.id as TalentId, JOBS[job].picks.solo);
      const picks = cands.find((p) => wins(fightRuns(job, 'mossback', S20, { picks: p })) >= 10) ?? cands[0];
      const base = fightRuns(job, 'mossback', S20, { picks }), withT = fightRuns(job, 'mossback', S20, { picks, talents: [t.id] });
      const r = meanTtk(withT) / meanTtk(base);
      const good = Math.abs(r - 1) <= 0.15 && wins(withT) >= wins(base) - 2;
      ok &&= good;
      lines.push(`${t.id.padEnd(16)} [${picks.join(', ')}] ttk ×${r.toFixed(3)} wins ${wins(withT)} vs ${wins(base)}${good ? '' : '  <-- out'}`);
    }
    expect(ok, '\n' + lines.join('\n')).toBe(true);
  });
});
