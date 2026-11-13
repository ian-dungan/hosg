import { describe, expect, it } from 'vitest';
import { BOSSES, ENEMY_ATTACKS, TICK_HZ } from '@sg2/shared';
import { UNAVOIDABLE_TEXT, bossBar, bossTitle, clockText, type BossStateView } from './boss';

const at = { windupFrac: 0, transitionLeftS: 0, targeted: false };
const e = (o: Partial<BossStateView>): BossStateView => ({ kind: 'wickhound', hp: 2000, maxHp: 3000, mode: 'fight', windup: '', ...o });

describe('bossBar', () => {
  it('is only for bosses and mega bosses', () => {
    expect(bossBar(e({ kind: 'mossback' }), 0, at)).toBeNull();
    expect(bossBar(e({ kind: 'lens_shard' }), 0, at)).toBeNull();
    expect(bossBar(e({ kind: 'thornling' }), 0, at)).toBeNull();
  });

  it('phase marks for both bosses: the Wickhound at 50%, the Warden at 70% and 35%', () => {
    expect(bossBar(e({}), 0, at)!.phaseMarks).toEqual([0.5]);
    const w = bossBar(e({ kind: 'fallen_warden' }), 0, at)!;
    expect(w.phaseMarks).toEqual([0.7, 0.35]);
    expect(w.phases).toBe(3);
    expect(w.name).toBe('The Fallen Warden');
  });

  it('phase names from lore.phases[phase] (0-based; during a transition already the next one)', () => {
    expect(bossBar(e({ phase: 0 }), 0, at)!.phaseName).toBe(BOSSES.wickhound.lore.phases[0]);
    const t = bossBar(e({ phase: 1 }), 0, { ...at, transitionLeftS: 1.2 })!;
    expect(t.phaseName).toBe(BOSSES.wickhound.lore.phases[1]);
    expect(t.transition).toBe(true);
    expect(bossBar(e({ phase: 1 }), 0, at)!.transition).toBe(false);
    expect(bossBar(e({ kind: 'fallen_warden', phase: 2 }), 0, at)!.phaseName).toBe('The Lens Falls');
    // a phase beyond the data stays on the last
    expect(bossBar(e({ phase: 9 }), 0, at)!.phase).toBe(1);
  });

  it('warded, and the enrage countdown only within 60 s of it (null while asleep or without one)', () => {
    const clock = 1000;
    expect(bossBar(e({ kind: 'fallen_warden', warded: true }), clock, at)!.warded).toBe(true);
    expect(bossBar(e({ kind: 'fallen_warden', enrageAt: 0 }), clock, at)!.enrageIn).toBeNull();
    expect(bossBar(e({ kind: 'fallen_warden', enrageAt: clock + 61 * TICK_HZ }), clock, at)!.enrageIn).toBeNull();
    expect(bossBar(e({ kind: 'fallen_warden', enrageAt: clock + 42 * TICK_HZ }), clock, at)!.enrageIn).toBeCloseTo(42);
    expect(bossBar(e({ kind: 'fallen_warden', enrageAt: clock - 5 * TICK_HZ }), clock, at)!.enrageIn).toBe(0);
    expect(bossBar(e({ kind: 'fallen_warden', enrageAt: 900 }), undefined, at)!.enrageIn).toBeNull();
  });

  it('the wind-up: interruptible, and the unavoidable flag on Keeper\'s Toll and Last Light', () => {
    const toll = bossBar(e({ kind: 'fallen_warden', windup: 'keepers_toll' }), 0, { ...at, windupFrac: 0.4 })!.cast!;
    expect(toll).toEqual({ name: ENEMY_ATTACKS.keepers_toll.name, frac: 0.4, interruptible: true, unavoidable: true });
    expect(bossBar(e({ kind: 'fallen_warden', windup: 'last_light' }), 0, at)!.cast!.unavoidable).toBe(true);
    const breath = bossBar(e({ windup: 'ember_breath' }), 0, { ...at, windupFrac: 2 })!.cast!;
    expect(breath).toMatchObject({ interruptible: true, unavoidable: false, frac: 1 });
    expect(bossBar(e({ windup: 'wick_lunge' }), 0, at)!.cast!.interruptible).toBe(false);
    expect(bossBar(e({}), 0, at)!.cast).toBeNull();
    expect(UNAVOIDABLE_TEXT).toBe('Cannot be dodged — shield, heal or Break it');
  });

  it('stagger and the Break window, the target flag, and the frame reused', () => {
    const out = bossBar(e({ stagger: 50, maxStagger: 220, mode: 'stunned', staggerImmune: 0 }), 0, { ...at, targeted: true })!;
    expect(out).toMatchObject({ stagger: 50, maxStagger: 220, broken: true, targeted: true });
    expect(bossBar(e({ kind: 'fallen_warden' }), 0, at, out)).toBe(out);
    expect(out.phaseMarks).toEqual([0.7, 0.35]);
    expect(out.broken).toBe(false);
  });

  it('titles and clocks', () => {
    expect(bossTitle('the Wickhound')).toBe('The Wickhound');
    expect(clockText(42.2)).toBe('0:43');
    expect(clockText(61)).toBe('1:01');
  });
});

describe('the victory screen', () => {
  it('lore, time and party, xp, the Seal (or already earned), the title and the rank', async () => {
    const { victoryLines } = await import('./boss');
    const base = { boss: 'fallen_warden' as const, seconds: 277, partySize: 2, xp: 300, seal: true, seals: 3, title: null, rank: 4, lore: 'The lamp steadies.' };
    expect(victoryLines(base)).toEqual(['The lamp steadies.', 'The Fallen Warden · 4:37 · party of 2', '+300 job xp', "Warden's Seal +1 (3 in all)", 'Rank 4 for a party of 2']);
    expect(victoryLines({ ...base, seal: false, rank: null, title: 'Lampbreaker', partySize: 1 })).toEqual(['The lamp steadies.', 'The Fallen Warden · 4:37 · party of 1', '+300 job xp', 'Seal already earned today (3 in all)', 'Title: Lampbreaker']);
    expect(victoryLines({ ...base, boss: 'wickhound', xp: 120 })[3]).toBe('Rank 4 for a party of 2');
  });
});
