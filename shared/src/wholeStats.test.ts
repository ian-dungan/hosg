// Owner rule (Plan 5): stats are whole numbers. Every stat an item gives, every base stat per level and
// every kitFor total over the legal single-set kits per job is an integer, at least 1 where it is given;
// a higher tier's piece is never worse than a lower tier's in any stat they share.
import { describe, expect, it } from 'vitest';
import { JOB_IDS } from './combat/jobs';
import { STARTER_STATS } from './combat/stats';
import { ARMOUR_SLOTS, ITEMS, ITEM_IDS, SETS, SET_IDS, fits, itemStats, kitItems, tierWeapon, type GearSlot, type ItemId } from './items';
import { kitFor } from './kit';
import { baseStats } from './progression';
import type { Mod } from './mods';

const STAT_KEYS = ['power', 'defence', 'maxHp', 'focus', 'flow', 'guard'] as const;
const whole = (v: number) => Number.isInteger(v) && v >= 0;

describe('whole-number stats', () => {
  it('every item gives whole numbers, at least 1 of each stat it gives', () => {
    for (const id of ITEM_IDS) {
      const st = itemStats(id);
      for (const k of STAT_KEYS) expect(whole(st[k]), `${id} ${k} ${st[k]}`).toBe(true);
      expect(STAT_KEYS.some((k) => st[k] >= 1), `${id} gives something`).toBe(ITEMS[id]!.tier > 0 || st.maxHp > 0 || ITEMS[id]!.slot === 'weapon' ? true : false);
    }
  });
  it('flat amounts in set and named-weapon mods are whole numbers (percents and durations may be fractional)', () => {
    const mods: Mod[] = [...SET_IDS.flatMap((s) => [...SETS[s].bonus3, ...SETS[s].bonus5]), ...ITEM_IDS.flatMap((id) => [...(ITEMS[id]!.named?.mods ?? [])])];
    for (const m of mods) {
      if (m.k === 'momentumOn' || m.k === 'shieldOn') expect(Number.isInteger(m.amount), JSON.stringify(m)).toBe(true);
      if (m.k === 'healShield') expect(Number.isInteger(m.cap), JSON.stringify(m)).toBe(true);
      if (m.k === 'finisherCost') expect(Number.isInteger(m.add), JSON.stringify(m)).toBe(true);
      if (m.k === 'dodge' && m.charges !== undefined) expect(Number.isInteger(m.charges)).toBe(true);
    }
  });
  it('base stats are whole at every level; level 1 and 10 in the starter kit are 7 / 7 / 82 and STARTER_STATS', () => {
    for (let l = 1; l <= 10; l++) for (const k of ['power', 'defence', 'maxHp'] as const) expect(whole(baseStats(l)[k]), `level ${l} ${k}`).toBe(true);
    for (let l = 2; l <= 10; l++) for (const k of ['power', 'defence', 'maxHp'] as const) expect(baseStats(l)[k]).toBeGreaterThanOrEqual(baseStats(l - 1)[k]);
    expect(kitFor({ job: 'warrior', level: 1, gear: {}, talents: [] }).stats).toEqual({ power: 7, defence: 7, maxHp: 82, focus: 0, flow: 0, guard: 0 });
    expect(kitFor({ job: 'warrior', level: 10, gear: {}, talents: [] }).stats).toEqual({ ...STARTER_STATS, focus: 0, flow: 0, guard: 0 });
  });
  it('kitFor totals are whole for every job, level and single-set kit (any tier weapon)', () => {
    for (const job of JOB_IDS) for (const set of SET_IDS) for (const wt of [0, 1, 2, 3] as const) for (const level of [1, 4, 7, 10]) {
      const gear: Partial<Record<GearSlot, ItemId>> = {};
      for (const s of ARMOUR_SLOTS) gear[s] = `${set}_${s}`;
      const w = tierWeapon(wt, job, 'weapon'), o = tierWeapon(wt, job, 'offhand');
      if (w) gear.weapon = w;
      if (o) gear.offhand = o;
      const st = kitFor({ job, level, gear, talents: [] }).stats;
      for (const k of STAT_KEYS) expect(whole(st[k] ?? 0), `${job} ${set} T${wt} L${level} ${k} ${st[k]}`).toBe(true);
    }
  });
  it('a higher tier piece is never worse than a lower tier piece of the same slot and type (or the starter piece) in a stat they share', () => {
    for (const a of ITEM_IDS) for (const b of ITEM_IDS) {
      const A = ITEMS[a]!, B = ITEMS[b]!;
      if (A.slot !== B.slot || A.tier >= B.tier) continue;
      const sameKind = A.slot === 'weapon' ? A.weapon === B.weapon : A.slot === 'offhand' ? A.offhand === B.offhand : A.type === B.type || A.tier === 0;
      if (!sameKind) continue;
      const sa = itemStats(a), sb = itemStats(b);
      for (const k of STAT_KEYS) if (sa[k] > 0 && sb[k] > 0) expect(sb[k], `${b} vs ${a} ${k}`).toBeGreaterThanOrEqual(sa[k]);
    }
  });
  it('full kits per armour type at level 10 (the totals the plan doc lists)', () => {
    const t = (job: 'warrior' | 'paladin' | 'white_mage', tier: 1 | 2 | 3) => {
      const g = kitItems(tier, job), gear: Partial<Record<GearSlot, ItemId>> = {};
      for (const [s, id] of Object.entries(g)) if (id && fits(id, s as GearSlot, job)) gear[s as GearSlot] = id;
      const st = kitFor({ job, level: 10, gear, talents: [] }).stats;
      return [st.power, st.defence, st.maxHp, (st.focus ?? 0) + (st.flow ?? 0) + (st.guard ?? 0)];
    };
    expect([t('warrior', 1), t('warrior', 2), t('warrior', 3)]).toEqual([[12, 12, 112, 6], [13, 14, 130, 12], [18, 20, 158, 14]]);
    expect([t('paladin', 1), t('paladin', 2), t('paladin', 3)]).toEqual([[12, 14, 116, 6], [13, 17, 138, 12], [18, 26, 172, 14]]);
    expect([t('white_mage', 1), t('white_mage', 2), t('white_mage', 3)]).toEqual([[12, 10, 107, 6], [13, 11, 120, 12], [18, 14, 141, 14]]);
  });
});
