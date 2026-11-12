import { describe, expect, it } from 'vitest';
import { ABILITIES, FUTURE_JOBS, JOBS, JOB_IDS, REASON_JOB_NOT_HERE, XP_PER_LEVEL, levelForXp, type JobId, type JobsView } from '@sg2/shared';
import { article, jobBoardView } from './jobs';

const view = (over: Partial<Record<JobId, { xp: number }>> = {}, current: JobId = 'warrior'): JobsView => ({
  current,
  jobs: Object.fromEntries(JOB_IDS.map((id) => {
    const xp = over[id]?.xp ?? 0;
    return [id, { level: levelForXp(xp), xp, next: 0, picks: [...JOBS[id].picks.solo] }];
  })) as JobsView['jobs'],
});

describe('jobBoardView', () => {
  it('seven rows in JOB_IDS order, with the bar and the pool from the job data', () => {
    const v = jobBoardView(view(), 'grove');
    expect(v.rows.map((r) => r.id)).toEqual([...JOB_IDS]);
    for (const r of v.rows) {
      const j = JOBS[r.id];
      expect(r).toMatchObject({ name: j.name, glyph: j.glyph, trait: j.trait.desc, traitName: j.trait.name });
      expect(r.bar.map((a) => a.id)).toEqual([...j.bar]);
      expect(r.picks.map((a) => a.id)).toEqual([...j.pool]);
      expect(r.chosen).toEqual([...j.picks.solo]);
      for (const a of [...r.bar, ...r.picks]) expect(a.desc).toBe(ABILITIES[a.id as keyof typeof ABILITIES].desc);
    }
    expect(v.current).toBe('warrior');
    expect(v.locked.map((f) => f.id)).toEqual(Object.keys(FUTURE_JOBS));
    expect(v.locked.every((f) => f.glyph === FUTURE_JOBS[f.id].glyph && f.unique === FUTURE_JOBS[f.id].unique)).toBe(true);
  });
  it('levels and xp fractions come from xp', () => {
    const v = jobBoardView(view({ ninja: { xp: XP_PER_LEVEL * 2 + XP_PER_LEVEL / 4 }, ranger: { xp: 99999 } }, 'ninja'), 'grove');
    const ninja = v.rows.find((r) => r.id === 'ninja')!;
    expect(ninja.level).toBe(3);
    expect(ninja.xpFrac).toBeCloseTo(0.25);
    const ranger = v.rows.find((r) => r.id === 'ranger')!;
    expect(ranger.xpFrac).toBe(1); // at the cap
    expect(v.current).toBe('ninja');
  });
  it('the note is null in the grove (a town) and the reason in the Greenway; switching is left to the server', () => {
    expect(jobBoardView(view(), 'grove')).toMatchObject({ canSwitch: true, note: null });
    expect(jobBoardView(view(), 'greenway')).toMatchObject({ canSwitch: false, note: REASON_JOB_NOT_HERE });
  });
  it('job names come only from the job data', () => {
    const renamed = { ...JOBS, white_mage: { ...JOBS.white_mage, name: 'Lightcaller' } };
    const row = jobBoardView(view(), 'grove', { jobs: renamed }).rows.find((r) => r.id === 'white_mage')!;
    expect(row.name).toBe('Lightcaller');
    expect(article('Ninja')).toBe('a Ninja');
    expect(article('Archer')).toBe('an Archer');
  });
  it('before the jobs message arrives: every job at level 1, the current one from the given fallback', () => {
    const v = jobBoardView(null, 'grove', { current: 'paladin' });
    expect(v.current).toBe('paladin');
    expect(v.rows.every((r) => r.level === 1 && r.xpFrac === 0)).toBe(true);
  });
});
