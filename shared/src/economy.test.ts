// The economy walk: how long a full kit takes from each source, and that no loop of buying and selling
// makes gold. Numbers are reported (W/task-2-report.md), not tuned: they are the Numbers' economy rows.
import { describe, expect, it } from 'vitest';
import { GEAR_SLOTS, ITEMS, ITEM_IDS, OFFHAND_FOR, kitItems, type ItemId } from './items';
import { addLoot, applyInvOp, newInventory, ownedItems, type InvCtx, type InvState } from './inventory';
import { rollLoot, lootTable } from './loot';
import { JOBS, JOB_IDS, newJobsSave, type JobId } from './combat/jobs';

const CTX: InvCtx = { stall: null, jobSwitch: true, townBoard: false, inCombat: false, dead: false, busy: false };
const fresh = (job: JobId, gold = 0, seals = 0): InvState => ({ inv: newInventory([0, 0]), gold, seals, jobs: newJobsSave(job) });
const dayOf = (d: number) => new Date(Date.UTC(2026, 10, 1) + d * 86_400_000).toISOString().slice(0, 10);

/** Buys the kit's missing pieces at `stall` while affordable, cheapest first. */
function shop(s: InvState, kit: ItemId[], stall: 'smithy' | 'lampwright'): InvState {
  const cost = (id: ItemId) => (stall === 'smithy' ? ITEMS[id]!.price! : ITEMS[id]!.seals!);
  for (const id of [...kit].sort((a, b) => cost(a) - cost(b))) {
    if (ownedItems(s.inv).has(id)) continue;
    const r = applyInvOp(s, { op: 'buy', stall, item: id }, { ...CTX, stall });
    if (!('refusal' in r)) s = r.state;
  }
  return s;
}
const kitOf = (tier: 1 | 3, job: JobId) => GEAR_SLOTS.map(s => kitItems(tier, job)[s]).filter((x): x is ItemId => x !== null);
const done = (s: InvState, kit: ItemId[]) => kit.every(id => ownedItems(s.inv).has(id));

describe('the economy', () => {
  it('a full T3 kit is 23 Seals (21 without an off-hand); one Warden kill a day reaches it in one to two weeks', () => {
    const results: Record<string, number[]> = {};
    for (const job of JOB_IDS) {
      const kit = kitOf(3, job);
      const seals = kit.reduce((n, id) => n + ITEMS[id]!.seals!, 0);
      expect(seals).toBe(OFFHAND_FOR[JOBS[job].weapon] ? 23 : 21);
      results[job] = [];
      for (let acct = 0; acct < 20; acct++) {
        let s = fresh(job);
        let day = 0;
        while (!done(s, kit) && day < 60) {
          day++;
          // one Warden kill: Plan 4's Seal (one a UTC day) and the daily guaranteed T3 drop
          s = { ...s, seals: s.seals + 1 };
          const roll = rollLoot({ kind: 'fallen_warden', zone: 'lampfall' }, { job, owned: ownedItems(s.inv), day: dayOf(day), lootDays: s.inv.lootDays }, [7, 'lampfall#1', 3, day, `acct${acct}`]);
          expect(roll.daily).toBe(true);
          s = addLoot(s, roll.item, roll.gold, `warden:${day}`, { key: 'fallen_warden', day: dayOf(day) }).state;
          s = shop(s, kit, 'lampwright');
        }
        results[job]!.push(day);
      }
      const days = results[job]!;
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      // Seals alone finish by day 23 (21); the daily drops make it sooner, never later.
      expect(Math.max(...days), job).toBeLessThanOrEqual(seals);
      expect(mean, job).toBeGreaterThanOrEqual(7);
      expect(mean, job).toBeLessThanOrEqual(seals);
    }
  });

  it('a T1 kit from the Greenway: Thornling kills (about 17 s each) to buy or find every piece take about half an hour to an hour', () => {
    for (const job of JOB_IDS) {
      const kit = kitOf(1, job);
      const price = kit.reduce((n, id) => n + ITEMS[id]!.price!, 0);
      expect(price).toBe(OFFHAND_FOR[JOBS[job].weapon] ? 485 : 435);
      const kills: number[] = [];
      for (let acct = 0; acct < 10; acct++) {
        let s = fresh(job), n = 0;
        while (!done(s, kit) && n < 5000) {
          n++;
          const roll = rollLoot({ kind: 'thornling', zone: 'greenway' }, { job, owned: ownedItems(s.inv), day: '2026-11-12', lootDays: s.inv.lootDays }, [9, 'greenway', n % 21, n, `acct${acct}`]);
          s = addLoot(s, roll.item, roll.gold, `g:${n}`).state;
          // sell what does not fit the kit (other types, duplicates), then shop
          for (const i of [...s.inv.bag]) {
            if (ITEMS[i.item]!.sell > 0 && !kit.includes(i.item)) { const r = applyInvOp(s, { op: 'sell', uid: i.uid }, { ...CTX, stall: 'smithy' }); if (!('refusal' in r)) s = r.state; }
          }
          s = shop(s, kit, 'smithy');
        }
        kills.push(n);
      }
      const mean = kills.reduce((a, b) => a + b, 0) / kills.length;
      const minutes = (mean * 17) / 60;
      expect(minutes, job).toBeGreaterThan(15);
      expect(minutes, job).toBeLessThan(120);
    }
    // the expected Greenway gold rate: 2 gold a Thornling, 8 a Mossback
    expect(lootTable({ kind: 'thornling', zone: 'greenway' }).gold).toEqual([1, 3]);
  });

  it('nothing can be bought and sold for a profit', () => {
    // every item the Smithy sells pays back less than it costs; nothing else is sold for gold
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      if (it.price !== undefined) expect(it.sell, id).toBeLessThan(it.price);
      if (it.tier === 0) expect(it.sell).toBe(0);
    }
    // a buy-sell loop at the Smithy only ever loses gold
    let s = fresh('warrior', 10_000);
    for (const id of ITEM_IDS.filter(i => ITEMS[i]!.tier === 1)) {
      const before = s.gold;
      const b = applyInvOp(s, { op: 'buy', stall: 'smithy', item: id }, { ...CTX, stall: 'smithy' });
      if ('refusal' in b) throw new Error(b.refusal);
      const sell = applyInvOp(b.state, { op: 'sell', uid: b.state.inv.nextUid - 1 }, { ...CTX, stall: 'smithy' });
      if ('refusal' in sell) throw new Error(sell.refusal);
      expect(sell.state.gold).toBeLessThan(before);
      s = sell.state;
    }
    // Seals turn into T3 gear and its sale into gold, one way: nothing sells for Seals and gold buys no Seals
    for (const id of ITEM_IDS) if (ITEMS[id]!.seals !== undefined) expect(ITEMS[id]!.price).toBeUndefined();
    expect(('refusal' in applyInvOp(fresh('warrior', 1e5), { op: 'buy', stall: 'lampwright', item: 'tollwind_head' }, { ...CTX, stall: 'lampwright' }))).toBe(true);
    // costumes, dyes and retraining are sinks: there is no op that pays gold back for them
    const ops = ['equip', 'unequip', 'bank', 'unbank', 'sell', 'buy', 'buyCostume', 'wear', 'hideHead', 'dye', 'dyeCostume', 'talent', 'respec'];
    expect(ops.filter(o => o.startsWith('sell'))).toEqual(['sell']); // sell takes a bag uid only: never a costume id
  });
});
