import { describe, expect, it } from 'vitest';
import { cyrb53, lootRng, lootTable, rollLoot, pickLootItem, type LootCtx, type LootSource } from './loot';
import { cyrb53 as hashCyrb53 } from './hash';
import { ITEMS, JOB_ARMOUR, isArmourSlot, type ItemId } from './items';
import { JOB_IDS, type JobId } from './combat/jobs';

const ctx = (job: JobId = 'warrior', owned: ItemId[] = [], over: Partial<LootCtx> = {}): LootCtx =>
  ({ job, owned: new Set(owned), day: '2026-11-12', lootDays: { wickhound: '2026-11-12', fallen_warden: '2026-11-12' }, ...over });
const seeds = (n: number, acct = 'acct-1') => [12345, 'room-a', 7, n, acct] as const;

describe('loot', () => {
  it('the same seed parts roll the same; different accounts roll independently', () => {
    expect(cyrb53).toBe(hashCyrb53);
    const src: LootSource = { kind: 'mossback', zone: 'greenway' };
    for (let n = 0; n < 50; n++) expect(rollLoot(src, ctx(), seeds(n))).toEqual(rollLoot(src, ctx(), seeds(n)));
    // two accounts on the same kill: their rolls agree no more often than chance
    let sameGold = 0, bothItems = 0, aItems = 0, bItems = 0;
    const N = 4000;
    for (let n = 0; n < N; n++) {
      const a = rollLoot(src, ctx(), seeds(n, 'acct-a')), b = rollLoot(src, ctx(), seeds(n, 'acct-b'));
      if (a.gold === b.gold) sameGold++;
      if (a.item) aItems++;
      if (b.item) bItems++;
      if (a.item && b.item) bothItems++;
    }
    expect(sameGold / N).toBeGreaterThan(0.15); expect(sameGold / N).toBeLessThan(0.25);   // 5 values: ≈ 0.2
    expect(bothItems / N).toBeCloseTo((aItems / N) * (bItems / N), 1);
  });

  it('rates over 10 000 rolls match the table within 1.5 percentage points', () => {
    const cases: [LootSource, number, number, number][] = [
      [{ kind: 'thornling', zone: 'greenway' }, 0.06, 1, 3],
      [{ kind: 'archer', zone: 'greenway' }, 0.06, 1, 3],
      [{ kind: 'mossback', zone: 'greenway' }, 0.3, 6, 10],
      [{ kind: 'boar', zone: 'lampfall' }, 0.08, 2, 4],
      [{ kind: 'mossback', zone: 'lampfall' }, 0.25, 8, 12],
      [{ kind: 'wickhound', zone: 'lampfall' }, 0.25, 25, 25],
      [{ kind: 'fallen_warden', zone: 'lampfall' }, 0.1, 60, 60],
    ];
    for (const [src, chance, lo, hi] of cases) {
      const N = 10_000;
      let items = 0, gold = 0, minG = Infinity, maxG = -Infinity;
      for (let n = 0; n < N; n++) {
        const r = rollLoot(src, ctx(), seeds(n));
        if (r.item) items++;
        gold += r.gold; minG = Math.min(minG, r.gold); maxG = Math.max(maxG, r.gold);
        expect(r.daily).toBe(false);
      }
      expect(Math.abs(items / N - chance), JSON.stringify(src)).toBeLessThan(0.015);
      expect([minG, maxG]).toEqual([lo, hi]);
      expect(gold / N).toBeCloseTo((lo + hi) / 2, 0);
    }
    expect(lootTable({ clear: 'root_cellar' })).toEqual({ gold: [10, 10], chance: 0, tier: null });
    expect(rollLoot({ clear: 'cog_hall' }, ctx(), seeds(1))).toEqual({ gold: 10, item: null, daily: false });
    expect(lootTable({ clear: 'warden' })).toEqual({ gold: [0, 0], chance: 0, tier: null });
  });

  it('the first Wickhound and Warden kill of a UTC day always drops; the second that day uses the low chance', () => {
    for (const [kind, key, tier] of [['wickhound', 'wickhound', 2], ['fallen_warden', 'fallen_warden', 3]] as const) {
      expect(lootTable({ kind, zone: 'lampfall' }).daily).toBe(key);
      for (let n = 0; n < 200; n++) {
        const fresh = ctx('paladin', [], { lootDays: { wickhound: '2026-11-11', fallen_warden: null } });
        const r = rollLoot({ kind, zone: 'lampfall' }, fresh, seeds(n));
        expect(r.daily).toBe(true);
        expect(r.item).not.toBeNull();
        expect(ITEMS[r.item!]!.tier).toBe(tier);
      }
      // once today's day is recorded, the low chance applies
      let items = 0;
      for (let n = 0; n < 2000; n++) {
        const r = rollLoot({ kind, zone: 'lampfall' }, ctx('paladin'), seeds(n));
        expect(r.daily).toBe(false);
        if (r.item) items++;
      }
      expect(items / 2000).toBeLessThan(kind === 'wickhound' ? 0.3 : 0.14);
    }
  });

  it('owned items are re-rolled up to 3 times; armour type follows JOB_ARMOUR 60%', () => {
    for (const job of JOB_IDS) {
      let own = 0, armour = 0, weapons = 0;
      const N = 6000;
      for (let n = 0; n < N; n++) {
        const id = pickLootItem(2, job, new Set(), lootRng([n, job]));
        const it = ITEMS[id]!;
        expect(it.tier).toBe(2);
        if (isArmourSlot(it.slot)) { armour++; if (it.type === JOB_ARMOUR[job]) own++; } else weapons++;
      }
      expect(Math.abs(own / armour - 0.6), job).toBeLessThan(0.03);
      expect(Math.abs(weapons / N - 0.25), job).toBeLessThan(0.03);
    }
    // owning all but one T1 light piece: the re-rolls find the missing one far more often than chance
    const light = ['thornrunner_head', 'thornrunner_chest', 'thornrunner_legs', 'thornrunner_hands', 'thornrunner_feet'];
    const others = Object.keys(ITEMS).filter(id => ITEMS[id]!.tier === 1 && id !== 'thornrunner_back');
    let back = 0, dup = 0;
    for (let n = 0; n < 2000; n++) {
      const id = pickLootItem(1, 'warrior', new Set([...light, ...others]), lootRng([n]));
      if (id === 'thornrunner_back') back++; else dup++;
    }
    // a single draw finds it 0.75 × 0.6 / 6 = 7.5% of the time; with three re-rolls 1 − 0.925⁴ ≈ 27%
    expect(back / 2000).toBeGreaterThan(0.22); expect(back / 2000).toBeLessThan(0.32);
    expect(back + dup).toBe(2000);
    // nothing owned of the tier: every roll is new, so no re-roll is spent
    const owned = new Set<ItemId>();
    for (let n = 0; n < 200; n++) owned.add(pickLootItem(3, 'ninja', new Set(), lootRng([n])));
    expect(owned.size).toBeGreaterThan(5);
  });

  it('Lampfall kinds roll T2, the Greenway T1, lens_shard and dummy nothing', () => {
    for (const kind of ['thornling', 'boar', 'archer', 'mossback'] as const) {
      expect(lootTable({ kind, zone: 'greenway' }).tier).toBe(1);
      expect(lootTable({ kind, zone: 'grove' }).tier).toBe(1);
      expect(lootTable({ kind, zone: 'lampfall' }).tier).toBe(2);
    }
    for (const kind of ['lens_shard', 'dummy'] as const) for (const zone of ['greenway', 'lampfall'] as const) {
      expect(lootTable({ kind, zone })).toEqual({ gold: [0, 0], chance: 0, tier: null });
      for (let n = 0; n < 50; n++) expect(rollLoot({ kind, zone }, ctx(), seeds(n))).toEqual({ gold: 0, item: null, daily: false });
    }
    let t1 = 0;
    for (let n = 0; n < 3000; n++) {
      const r = rollLoot({ kind: 'mossback', zone: 'greenway' }, ctx(), seeds(n));
      if (r.item) { t1++; expect(ITEMS[r.item]!.tier).toBe(1); }
      const s = rollLoot({ kind: 'mossback', zone: 'lampfall' }, ctx(), seeds(n));
      if (s.item) expect(ITEMS[s.item]!.tier).toBe(2);
    }
    expect(t1).toBeGreaterThan(0);
    // a junk source rolls nothing (never throws)
    expect(rollLoot({ kind: 'nope' } as unknown as LootSource, ctx(), seeds(1))).toEqual({ gold: 0, item: null, daily: false });
  });
});
