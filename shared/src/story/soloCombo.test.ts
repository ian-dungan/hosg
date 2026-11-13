import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../combat/abilities';
import { JOBS, JOB_IDS } from '../combat/jobs';
import { stepHint } from './lines';

// Plan 6 constraint 6: every main-quest step is completable solo. first_fight asks for a combo: a finisher that sets off
// another live mark. A job whose new kit (its bar and solo picks) has no primer cannot combo alone, so the step's hint
// must say which pick to take (picks change out of a fight, anywhere; found by the --quest load bots: a lone Warrior
// never got past first_fight).
describe('a combo is possible solo, or the first_fight hint says how', () => {
  it('every job', () => {
    const hint = stepHint('solstice_crossing', 'first_fight', 'touch').objectives[2] ?? '';
    for (const job of JOB_IDS) {
      const kit = [...JOBS[job].bar, ...JOBS[job].picks.solo];
      if (kit.some((a) => ABILITIES[a]?.primer && ABILITIES[a]?.mark)) continue;
      const primer = JOBS[job].pool.find((a) => ABILITIES[a]?.primer && ABILITIES[a]?.mark);
      expect(primer, job).toBeTruthy();
      expect(hint, job).toContain(ABILITIES[primer!].name);
    }
  });
});
