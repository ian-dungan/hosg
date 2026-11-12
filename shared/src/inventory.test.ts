import { describe, expect, it } from 'vitest';
import {
  BAG_SLOTS, BANK_SLOTS, DYE_PRICE, GOLD_MAX, INV_TEXT, RECENT_KILLS, RESPEC_PRICE, OPS_NEEDING_ID, addLoot, applyInvOp as applyInvOpRaw, bagUsed, gearItems, gearLookOf, inventoryView,
  newInventory, ownedItems, parseInvOp, parseInventory, wornBy, type InvCtx, type InvOp, type InvRefusal, type InvState, type InventorySave,
} from './inventory';
import { COSTUMES, COSTUME_IDS, GEAR_SLOTS, type CostumeId, ITEMS, ITEM_IDS, fits, kitItems, starterFor, starterItems, type GearSlot, type ItemId } from './items';
import { kitFor } from './kit';
import { JOB_IDS, newJobsSave, type JobId, type JobsSave } from './combat/jobs';
import { STARTER_STATS } from './combat/stats';
import { totalTo } from './progression';
import { decodeGearLook, encodeGearLook } from './look';
import { deepFreeze } from './combat/freeze';
import { prng } from './world/recipe';

/** Ruling P5-e: purchases and Vault moves need an operation id; these tests give each one a fresh id. */
let opSeq = 0;
const applyInvOp = (s: InvState, op: InvOp, ctx: InvCtx) =>
  applyInvOpRaw(s, op.id === undefined && OPS_NEEDING_ID.includes(op.op) ? { ...op, id: `test-op-${String(++opSeq).padStart(6, '0')}` } : op, ctx);
const CTX: InvCtx = { stall: null, jobSwitch: false, townBoard: false, inCombat: false, dead: false, busy: false };
const at = (stall: InvCtx['stall'], more: Partial<InvCtx> = {}): InvCtx => ({ ...CTX, stall, ...more });
const jobsAt = (job: JobId, level = 10, talents: string[] = []): JobsSave => {
  const j = newJobsSave(job);
  j.jobs[job] = { ...j.jobs[job]!, xp: totalTo(level), level, talents };
  return j;
};
const state = (over: Partial<InvState> = {}): InvState => ({ inv: newInventory([3, 7]), gold: 1000, seals: 30, jobs: jobsAt('warrior'), ...over });
const ok = (r: ReturnType<typeof applyInvOp>) => {
  if ('refusal' in r) throw new Error(`refused: ${r.refusal}`);
  return r;
};
const refusal = (r: ReturnType<typeof applyInvOp>) => ('refusal' in r ? r.refusal : null);
const uidOf = (inv: InventorySave, item: ItemId) => inv.bag.find(i => i.item === item)!.uid;
/** A state holding `item` in the bag (bought or looted). */
const withItem = (s: InvState, item: ItemId): InvState => addLoot(s, item, 0, `k-${item}-${s.inv.nextUid}`).state;

/** Every invariant the inventory keeps: what parseInventory repairs never needs repairing after an op. */
function invariants(s: InvState) {
  const uids = [...s.inv.bag, ...s.inv.bank].map(i => i.uid);
  expect(new Set(uids).size).toBe(uids.length);
  for (const u of uids) expect(u).toBeLessThan(s.inv.nextUid);
  const bagUids = new Set(s.inv.bag.map(i => i.uid));
  for (const job of JOB_IDS) for (const slot of GEAR_SLOTS) {
    const u = s.inv.gear[job]?.[slot];
    if (starterFor(job, slot) === null) { expect(u).toBeUndefined(); continue; }
    expect(u, `${job} ${slot}`).toBeDefined();
    expect(bagUids.has(u!)).toBe(true);
    expect(fits(s.inv.bag.find(i => i.uid === u)!.item, slot, job)).toBe(true);
  }
  expect(bagUsed(s.inv)).toBeLessThanOrEqual(BAG_SLOTS);
  expect(s.inv.bank.length).toBeLessThanOrEqual(BANK_SLOTS);
  expect(s.gold).toBeGreaterThanOrEqual(0); expect(s.gold).toBeLessThanOrEqual(GOLD_MAX);
  expect(s.seals).toBeGreaterThanOrEqual(0);
  expect(parseInventory(JSON.parse(JSON.stringify(s.inv))).repaired).toBe(false);
}

describe('inventory', () => {
  it('newInventory: 16 items, every job wears a full kit with its own starter weapon', () => {
    const inv = newInventory([3, 7]);
    expect(inv.bag.map(i => i.uid)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(inv.bag.map(i => i.item)).toEqual(starterItems());
    for (const i of inv.bag) expect(i.dye).toEqual([3, 7]);
    expect(inv.nextUid).toBe(17);
    expect(bagUsed(inv)).toBe(0); // all 16 are worn by someone
    for (const job of JOB_IDS) {
      const g = gearItems(inv, job);
      for (const slot of GEAR_SLOTS) expect(g[slot] ?? null, `${job} ${slot}`).toBe(starterFor(job, slot));
      expect(kitFor({ job, level: 10, gear: g, talents: [] }).stats).toEqual({ ...STARTER_STATS, focus: 0, flow: 0, guard: 0 });
    }
    expect(wornBy(inv, 1)).toEqual(JOB_IDS); // plain_head
    expect(wornBy(inv, inv.bag.find(i => i.item === 'grove_staff')!.uid)).toEqual(['white_mage', 'black_mage']);
    expect(newInventory([99, -1]).bag[0]!.dye).toEqual([0, 0]); // bad dyes read as undyed
    invariants(state());
  });

  it('each op succeeds where allowed and refuses with the listed InvRefusal otherwise (table-driven, one case per refusal)', () => {
    const base = state();
    const hedge = withItem(base, 'hedgecutter');
    const hedgeUid = uidOf(hedge.inv, 'hedgecutter');
    const banked = ok(applyInvOp(hedge, { op: 'bank', uid: hedgeUid }, at('vault'))).state;
    const fullBag = (() => { let s = base; for (let i = 0; i < BAG_SLOTS; i++) s = withItem(s, 'thornrunner_head'); return s; })();
    const fullBank = (() => { let s = base; for (let i = 0; i < BANK_SLOTS; i++) { s = withItem(s, 'rootbound_back'); s = ok(applyInvOp(s, { op: 'bank', uid: s.inv.nextUid - 1 }, at('vault'))).state; } return withItem(s, 'hedgecutter'); })();
    const cases: [string, InvState, InvOp, InvCtx, InvRefusal][] = [
      ['dead', hedge, { op: 'equip', uid: hedgeUid, slot: 'weapon' }, { ...CTX, dead: true }, 'dead'],
      ['in combat', hedge, { op: 'equip', uid: hedgeUid, slot: 'weapon' }, { ...CTX, inCombat: true }, 'combat'],
      ['casting or travelling', hedge, { op: 'equip', uid: hedgeUid, slot: 'weapon' }, { ...CTX, busy: true }, 'busy'],
      ['sell away from the Smithy', hedge, { op: 'sell', uid: hedgeUid }, at('tailor'), 'where'],
      ['buy at the wrong stall', base, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('lampwright'), 'where'],
      ['talent outside a town', base, { op: 'talent', row: 0, choice: 0 }, CTX, 'where'],
      ['respec away from the Guild Board', base, { op: 'respec' }, at(null, { jobSwitch: true }), 'where'],
      ['equip an unknown uid', base, { op: 'equip', uid: 999, slot: 'weapon' }, CTX, 'unknown'],
      ['buy T3 at the Smithy', base, { op: 'buy', stall: 'smithy', item: 'tollwind_head' }, at('smithy'), 'unknown'],
      ['buy an event costume', base, { op: 'buyCostume', costume: 'beacon_halo' }, at('tailor'), 'unknown'],
      ['wear an unowned costume', base, { op: 'wear', slot: 'body', costume: 'orchard_smock' }, CTX, 'unknown'],
      ['a bow on a Paladin', { ...withItem(base, 'ashwood_longbow'), jobs: jobsAt('paladin') }, { op: 'equip', uid: 17, slot: 'weapon' }, CTX, 'fit'],
      ['a shield on a Ninja', { ...withItem(base, 'millward_shield'), jobs: jobsAt('ninja') }, { op: 'equip', uid: 17, slot: 'offhand' }, CTX, 'fit'],
      ['empty the weapon slot', base, { op: 'unequip', slot: 'weapon' }, CTX, 'fit'],
      ['dye a weapon', base, { op: 'dye', uid: uidOf(base.inv, 'grove_blade'), ch: 0, dye: 4 }, at('tailor'), 'fit'],
      ['sell a worn item', hedge, { op: 'sell', uid: uidOf(hedge.inv, 'plain_chest') }, at('smithy'), 'worn'],
      ['bank a worn item', hedge, { op: 'bank', uid: uidOf(hedge.inv, 'plain_chest') }, at('vault'), 'worn'],
      ['sell a starter item (worn by nobody)', ok(applyInvOp(hedge, { op: 'equip', uid: hedgeUid, slot: 'weapon' }, CTX)).state, { op: 'sell', uid: uidOf(hedge.inv, 'grove_blade') }, at('smithy'), 'starter'],
      ['buy with a full bag', fullBag, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('smithy'), 'bag-full'],
      ['unbank into a full bag', (() => { let s = banked; for (let i = 0; i < BAG_SLOTS; i++) s = withItem(s, 'thornrunner_head'); return s; })(), { op: 'unbank', uid: hedgeUid }, at('vault'), 'bag-full'],
      ['bank into a full Vault', fullBank, { op: 'bank', uid: fullBank.inv.nextUid - 1 }, at('vault'), 'bank-full'],
      ['buy without gold', { ...base, gold: 119 }, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('smithy'), 'gold'],
      ['dye without gold', { ...base, gold: 4 }, { op: 'dye', uid: 1, ch: 0, dye: 9 }, at('tailor'), 'gold'],
      ['buy without Seals', { ...base, seals: 4 }, { op: 'buy', stall: 'lampwright', item: 'last_bell' }, at('lampwright'), 'seals'],
      ['a costume bought twice', ok(applyInvOp(base, { op: 'buyCostume', costume: 'orchard_smock' }, at('tailor'))).state, { op: 'buyCostume', costume: 'orchard_smock' }, at('tailor'), 'owned'],
      ['a talent above the level', { ...base, jobs: jobsAt('warrior', 6) }, { op: 'talent', row: 1, choice: 0 }, at(null, { jobSwitch: true }), 'level'],
      ['a row already chosen', { ...base, jobs: jobsAt('warrior', 10, ['warrior_1a']) }, { op: 'talent', row: 0, choice: 1 }, at(null, { jobSwitch: true }), 'taken'],
      // ruling P5-e: purchases and Vault moves carry an operation id
      ['buy without an operation id', base, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('smithy'), 'no-id'],
      // a sale whose gold would pass GOLD_MAX would destroy the item for nothing
      ['sell with a full purse', { ...hedge, gold: GOLD_MAX - 5 }, { op: 'sell', uid: hedgeUid }, at('smithy'), 'purse-full'],
      // no uid left to mint: refused, never a lost item
      ['buy with no uid left', { ...base, inv: { ...base.inv, nextUid: 2 ** 31 } }, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('smithy'), 'uids'],
    ];
    const seen = new Set<InvRefusal>();
    for (const [name, s, op, ctx, want] of cases) {
      deepFreeze(s);
      const apply = want === 'no-id' ? applyInvOpRaw : applyInvOp;
      expect(refusal(apply(s, op, ctx)), name).toBe(want);
      seen.add(want);
    }
    // 'rate' is the server's token bucket (INV_OPS_PER_S): never a rule outcome
    expect([...seen].sort()).toEqual((Object.keys(INV_TEXT) as InvRefusal[]).filter(r => r !== 'rate').sort());
    for (const r of Object.keys(INV_TEXT) as InvRefusal[]) expect(INV_TEXT[r].length).toBeGreaterThan(5);

    // …and the same ops succeed where allowed
    const pal = withItem({ ...base, jobs: jobsAt('paladin') }, 'millward_shield');
    expect(ok(applyInvOp(pal, { op: 'equip', uid: 17, slot: 'offhand' }, CTX)).state.inv.gear.paladin!.offhand).toBe(17);
    const bought = ok(applyInvOp(base, { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, at('smithy')));
    expect(bought.dGold).toBe(-120); expect(bought.state.gold).toBe(880);
    expect(bought.state.inv.bag.at(-1)).toEqual({ uid: 17, item: 'hedgecutter', dye: [0, 0] });
    const sold = ok(applyInvOp(bought.state, { op: 'sell', uid: 17 }, at('smithy')));
    expect(sold.dGold).toBe(24); expect(sold.state.inv.bag.some(i => i.uid === 17)).toBe(false);
    const t3 = ok(applyInvOp(base, { op: 'buy', stall: 'lampwright', item: 'last_bell' }, at('lampwright')));
    expect([t3.dGold, t3.dSeals, t3.state.seals]).toEqual([0, -5, 25]);
    const talent = ok(applyInvOp(base, { op: 'talent', row: 2, choice: 1 }, at(null, { jobSwitch: true })));
    expect(talent.state.jobs.jobs.warrior!.talents).toEqual(['warrior_3b']);
    const respec1 = ok(applyInvOp(talent.state, { op: 'respec' }, at(null, { townBoard: true })));
    expect(respec1.dGold).toBe(0); expect(respec1.state.jobs.jobs.warrior!.talents).toEqual([]);
    expect(respec1.state.inv.freeRespecUsed).toEqual(['warrior']);
    const two = { ...respec1.state, jobs: jobsAt('warrior', 10, ['warrior_1a', 'warrior_2b']) };
    const respec2 = ok(applyInvOp(two, { op: 'respec' }, at(null, { townBoard: true })));
    expect(respec2.dGold).toBe(-2 * RESPEC_PRICE);
    expect(refusal(applyInvOp({ ...two, gold: 49 }, { op: 'respec' }, at(null, { townBoard: true })))).toBe('gold');
    const dyed = ok(applyInvOp(base, { op: 'dye', uid: 2, ch: 1, dye: 31 }, at('tailor')));
    expect(dyed.dGold).toBe(-DYE_PRICE); expect(dyed.state.inv.bag[1]!.dye).toEqual([3, 31]);
    const same = ok(applyInvOp(base, { op: 'dye', uid: 2, ch: 1, dye: 7 }, at('tailor')));
    expect(same.dGold).toBe(0); expect(same.state).toEqual(base);
    const coat = ok(applyInvOp(base, { op: 'buyCostume', costume: 'lamplighter_coat' }, at('tailor')));
    expect(coat.dGold).toBe(-400); expect(coat.state.inv.wardrobe).toEqual(['lamplighter_coat']);
    const worn = ok(applyInvOp(coat.state, { op: 'wear', slot: 'body', costume: 'lamplighter_coat' }, CTX));
    expect(worn.state.jobs.jobs.warrior!.outfit).toEqual({ body: 'lamplighter_coat', head: null, back: null, hideHead: false });
    expect(refusal(applyInvOp(coat.state, { op: 'wear', slot: 'head', costume: 'lamplighter_coat' }, CTX))).toBe('fit');
    const hidden = ok(applyInvOp(worn.state, { op: 'hideHead', hide: true }, CTX));
    expect(hidden.state.jobs.jobs.warrior!.outfit!.hideHead).toBe(true);
    const cdyed = ok(applyInvOp(coat.state, { op: 'dyeCostume', costume: 'lamplighter_coat', ch: 0, dye: 12 }, at('tailor')));
    expect(cdyed.dGold).toBe(-DYE_PRICE); expect(cdyed.state.inv.costumeDyes.lamplighter_coat).toEqual([12, 0]);
    const off = ok(applyInvOp(worn.state, { op: 'wear', slot: 'body', costume: null }, CTX));
    expect(off.state.jobs.jobs.warrior!.outfit).toBeNull();
    for (const r of [bought, sold, t3, talent, respec1, respec2, dyed, coat, worn, hidden, cdyed, off]) invariants(r.state);
  });

  it('a worn item cannot be sold or banked; a costume cannot be bought twice; event costumes cannot be bought', () => {
    const s = withItem(state(), 'hedgecutter');
    const eq = ok(applyInvOp(s, { op: 'equip', uid: 17, slot: 'weapon' }, CTX)).state;
    expect(refusal(applyInvOp(eq, { op: 'sell', uid: 17 }, at('smithy')))).toBe('worn');
    expect(refusal(applyInvOp(eq, { op: 'bank', uid: 17 }, at('vault')))).toBe('worn');
    // the old starter blade is worn by nobody now, but starter gear is never banked (an unequip would mint
    // another one each time and fill the Vault)
    const blade = uidOf(eq.inv, 'grove_blade');
    expect(wornBy(eq.inv, blade)).toEqual([]);
    expect(refusal(applyInvOp(eq, { op: 'bank', uid: blade }, at('vault')))).toBe('starter');
    const banked = ok(applyInvOp(withItem(eq, 'rowan_staff'), { op: 'bank', uid: 18 }, at('vault'))).state;
    expect(banked.inv.bank.map(i => i.item)).toEqual(['rowan_staff']);
    const c = ok(applyInvOp(s, { op: 'buyCostume', costume: 'straw_sunhat' }, at('tailor'))).state;
    expect(refusal(applyInvOp(c, { op: 'buyCostume', costume: 'straw_sunhat' }, at('tailor')))).toBe('owned');
    for (const ev of COSTUME_IDS.filter(id => COSTUMES[id].price === null)) expect(refusal(applyInvOp(s, { op: 'buyCostume', costume: ev }, at('tailor')))).toBe('unknown');
    // an event costume granted by a GM (wardrobe write, Task 7) can be worn
    const granted = { ...s, inv: { ...s.inv, wardrobe: ['starfall_regalia' as const] } };
    expect(ok(applyInvOp(granted, { op: 'wear', slot: 'body', costume: 'starfall_regalia' }, CTX)).state.jobs.jobs.warrior!.outfit!.body).toBe('starfall_regalia');
  });

  it('equip with a full bag swaps when the old item fits; refuses bag-full when it does not', () => {
    // 30 unworn items in the bag, one of them a Thornrunner Cap
    let s = state();
    for (let i = 0; i < BAG_SLOTS; i++) s = withItem(s, i === 0 ? 'thornrunner_head' : 'rootbound_back');
    expect(bagUsed(s.inv)).toBe(BAG_SLOTS);
    const cap = uidOf(s.inv, 'thornrunner_head');
    // the Warrior swaps the plain cap (still worn by six other jobs: it takes no slot) for the new one
    const a = ok(applyInvOp(s, { op: 'equip', uid: cap, slot: 'head' }, CTX)).state;
    expect(bagUsed(a.inv)).toBe(BAG_SLOTS - 1);
    // a Rootbound Mantle goes on in place of the plain scarf (still worn by the other six jobs)
    const back = uidOf(a.inv, 'rootbound_back');
    const b = ok(applyInvOp(a, { op: 'equip', uid: back, slot: 'back' }, CTX)).state;
    expect(bagUsed(b.inv)).toBe(BAG_SLOTS - 2);
    // The overflow case: the Warrior wears a chest nobody else wears and swaps to one the Paladin already wears.
    let o = state();
    o = withItem(o, 'thornrunner_chest'); const c1 = o.inv.nextUid - 1;
    o = withItem(o, 'rootbound_chest'); const c2 = o.inv.nextUid - 1;
    o = ok(applyInvOp(o, { op: 'equip', uid: c1, slot: 'chest' }, CTX)).state;             // Warrior: c1
    o = ok(applyInvOp({ ...o, jobs: jobsAt('paladin') }, { op: 'equip', uid: c2, slot: 'chest' }, CTX)).state; // Paladin: c2
    while (bagUsed(o.inv) < BAG_SLOTS) o = withItem(o, 'rootbound_back');
    const ws = { ...o, jobs: jobsAt('warrior') };
    expect(refusal(applyInvOp(ws, { op: 'equip', uid: c2, slot: 'chest' }, CTX))).toBe('bag-full');   // c1 would need a slot
    expect(refusal(applyInvOp(ws, { op: 'unequip', slot: 'chest' }, CTX))).toBe('bag-full');           // so would unequipping it
    // with one slot free both work
    const room = ok(applyInvOp(ws, { op: 'sell', uid: ws.inv.nextUid - 1 }, at('smithy'))).state;
    invariants(ok(applyInvOp(room, { op: 'equip', uid: c2, slot: 'chest' }, CTX)).state);
  });

  it('1000 random op sequences: uids unique, no item in two places, gold and Seals never negative, gold Δ = sales − buys', () => {
    const r = prng(20261112);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
    const stalls = [null, 'smithy', 'tailor', 'barber', 'lampwright', 'vault'] as const;
    const someItems = [...ITEM_IDS.filter(id => ITEMS[id]!.tier === 1 || ITEMS[id]!.tier === 3), 'nope'];
    let applied = 0;
    for (let seq = 0; seq < 1000; seq++) {
      let s: InvState = { inv: newInventory([pick([0, 5, 31]), 2]), gold: Math.floor(r() * 800), seals: Math.floor(r() * 12), jobs: jobsAt(pick(JOB_IDS), 1 + Math.floor(r() * 10)) };
      let expectGold = s.gold, expectSeals = s.seals;
      const steps = 4 + Math.floor(r() * 12);
      for (let k = 0; k < steps; k++) {
        if (r() < 0.25) {
          const item = r() < 0.7 ? pick(ITEM_IDS.filter(id => ITEMS[id]!.tier > 0)) : null;
          const res = addLoot(s, item, Math.floor(r() * 30), `kill-${seq}-${Math.floor(r() * 6)}`);
          expect(res.state.gold - s.gold).toBe(res.dGold);
          expectGold += res.dGold;
          s = res.state;
          continue;
        }
        const uids = [...s.inv.bag, ...s.inv.bank].map(i => i.uid);
        const uid = r() < 0.9 && uids.length ? pick(uids) : pick([0, -1, 9999, 2.5]);
        const op = pick<InvOp>([
          { op: 'equip', uid, slot: pick(GEAR_SLOTS) }, { op: 'unequip', slot: pick(GEAR_SLOTS) }, { op: 'bank', uid }, { op: 'unbank', uid }, { op: 'sell', uid },
          { op: 'buy', stall: pick(['smithy', 'lampwright', 'tailor'] as const), item: pick(someItems) }, { op: 'buyCostume', costume: pick(COSTUME_IDS) },
          { op: 'wear', slot: pick(['body', 'head', 'back'] as const), costume: pick([...COSTUME_IDS, null]) }, { op: 'hideHead', hide: r() < 0.5 },
          { op: 'dye', uid, ch: pick([0, 1] as const), dye: Math.floor(r() * 32) }, { op: 'talent', row: pick([0, 1, 2] as const), choice: pick([0, 1, 2] as const) }, { op: 'respec' },
        ]);
        const ctx: InvCtx = { stall: pick(stalls), jobSwitch: r() < 0.5, townBoard: r() < 0.5, inCombat: r() < 0.05, dead: r() < 0.03, busy: r() < 0.03 };
        const before = JSON.stringify(s);
        const res = applyInvOp(deepFreeze(s), op, ctx);
        expect(JSON.stringify(s)).toBe(before); // never mutated
        if ('refusal' in res) continue;
        applied++;
        const { state: n, dGold, dSeals } = res;
        expect(n.gold - s.gold).toBe(dGold); expect(n.seals - s.seals).toBe(dSeals);
        // gold moves only by the op's own price or sale
        if (op.op === 'sell') expect(dGold).toBe(Math.min(GOLD_MAX - s.gold, ITEMS[s.inv.bag.find(i => i.uid === op.uid)!.item]!.sell));
        else if (op.op === 'buy') { if (op.stall === 'smithy') expect(dGold).toBe(-ITEMS[op.item]!.price!); else expect([dGold, dSeals]).toEqual([0, -ITEMS[op.item]!.seals!]); }
        else if (op.op === 'buyCostume') expect(dGold).toBe(-COSTUMES[op.costume].price!);
        else if (op.op === 'dye') expect([0, -DYE_PRICE]).toContain(dGold);
        else if (op.op === 'respec') expect(dGold % RESPEC_PRICE).toBe(0);
        else expect(dGold).toBe(0);
        if (op.op !== 'buy') expect(dSeals).toBe(0);
        expectGold += dGold; expectSeals += dSeals;
        s = n;
        invariants(s);
      }
      expect(s.gold).toBe(expectGold); expect(s.seals).toBe(expectSeals);
    }
    expect(applied).toBeGreaterThan(1000); // most sequences really change something
  });

  it('an op with a client operation id applies once: a resend is a no-op (dup), whatever the context', () => {
    const s = state();
    const op = { op: 'buy', stall: 'smithy', item: 'hedgecutter', id: 'tab1-00000042' } as const;
    const first = ok(applyInvOp(s, op, at('smithy')));
    expect(first.dGold).toBe(-120);
    const again = ok(applyInvOp(first.state, op, at('smithy')));
    expect(again).toEqual({ state: first.state, dGold: 0, dSeals: 0, dup: true });
    expect(again.state).toBe(first.state);
    // a different id buys again
    expect(ok(applyInvOp(first.state, { ...op, id: 'tab1-00000043' }, at('smithy'))).dGold).toBe(-120);
    // a refused op does not burn its id
    const poor = applyInvOp({ ...s, gold: 0 }, op, at('smithy'));
    expect(refusal(poor)).toBe('gold');
    // the ids survive a save and reload
    // stored as `${op}:${id}` (ruling P5-e), and they survive a save and reload
    expect(first.state.inv.recentOps).toEqual(['buy:tab1-00000042']);
    expect(parseInventory(JSON.parse(JSON.stringify(first.state.inv))).inv.recentOps).toEqual(['buy:tab1-00000042']);
    // the same id on another op is another operation
    const sell = ok(applyInvOp(first.state, { op: 'sell', uid: 17, id: 'tab1-00000042' }, at('smithy')));
    expect(sell.dGold).toBe(24);
    // a short id is refused (ids are random strings of at least 12 characters); junk keys are dropped on load
    expect(refusal(applyInvOp(s, { ...op, id: 'short-id-11' }, at('smithy')))).toBe('unknown');
    expect(parseInventory({ ...first.state.inv, recentOps: ['buy:tab1-00000042', 'tab1-00000042', 'nope:tab1-00000099', 'buy:short'] }).inv.recentOps).toEqual(['buy:tab1-00000042']);
  });

  it('addLoot is idempotent by kill key; a full bag sells the item and reports the gold', () => {
    const s = state({ gold: 10 });
    const a = addLoot(s, 'cinderstep_head', 25, 'room:7:1', { key: 'wickhound', day: '2026-11-12' });
    expect(a).toMatchObject({ dGold: 25, soldFor: null, dup: false, uid: 17 });
    expect(a.state.inv.bag.at(-1)).toEqual({ uid: 17, item: 'cinderstep_head', dye: [0, 0] });
    expect(a.state.inv.lootDays.wickhound).toBe('2026-11-12');
    expect(a.state.inv.recentKills).toEqual(['room:7:1']);
    const b = addLoot(a.state, 'cinderstep_head', 25, 'room:7:1');
    expect(b).toEqual({ state: a.state, dGold: 0, soldFor: null, dup: true, uid: null });
    // a full bag sells it at once
    let f = s;
    for (let i = 0; i < BAG_SLOTS; i++) f = addLoot(f, 'rootbound_back', 0, `f${i}`).state;
    const sold = addLoot(f, 'furnace_edge', 3, 'room:9:1');
    expect(sold).toMatchObject({ dGold: 63, soldFor: 60, uid: null, dup: false });
    // no uid left to mint: the drop is sold too (never lost), and an unequip that would mint is refused
    const noUid: InvState = { ...s, inv: { ...s.inv, nextUid: 2 ** 31 } };
    expect(addLoot(noUid, 'furnace_edge', 0, 'room:9:2')).toMatchObject({ soldFor: 60, uid: null, dGold: 60 });
    const bare: InvState = { ...noUid, inv: { ...noUid.inv, bag: noUid.inv.bag.filter(i => i.item !== 'plain_head') } };
    expect(refusal(applyInvOp(bare, { op: 'unequip', slot: 'head' }, CTX))).toBe('uids');
    expect(sold.state.inv.bag).toHaveLength(f.inv.bag.length);
    // the gold cap clamps
    const rich = addLoot(state({ gold: GOLD_MAX - 5 }), null, 60, 'k');
    expect([rich.dGold, rich.state.gold]).toEqual([5, GOLD_MAX]);
    // kill keys are remembered up to RECENT_KILLS
    let k = s;
    for (let i = 0; i < RECENT_KILLS + 5; i++) k = addLoot(k, null, 1, `key${i}`).state;
    expect(k.inv.recentKills).toHaveLength(RECENT_KILLS);
    expect(k.inv.recentKills[0]).toBe('key5');
    // unknown items are ignored, never stored
    expect(addLoot(s, 'nope', 0, 'z').state.inv.bag).toHaveLength(16);
    expect(ownedItems(a.state.inv).has('cinderstep_head')).toBe(true);
  });

  it('parseInventory repairs garbage, unknown ids, duplicate uids, dangling gear refs and missing weapons', () => {
    for (const g of [null, undefined, 3, 'x', [], {}, { v: 2 }]) {
      const p = parseInventory(g);
      expect(p.repaired).toBe(true);
      expect(p.inv).toEqual(newInventory([0, 0]));
    }
    expect(parseInventory(null, [4, 9]).inv).toEqual(newInventory([4, 9]));
    const good = withItem(state(), 'hedgecutter').inv;
    expect(parseInventory(JSON.parse(JSON.stringify(good)))).toEqual({ inv: good, repaired: false });
    const raw = JSON.parse(JSON.stringify(good)) as InventorySave & Record<string, unknown>;
    raw.bag.push({ uid: 17, item: 'last_bell', dye: [0, 0] });          // a duplicate uid: dropped (the later one)
    raw.bag.push({ uid: 40, item: 'excalibur', dye: [0, 0] });          // unknown id: dropped
    raw.bag.push({ uid: 41, item: 'tollwind_head', dye: [99, 'x'] as never }); // bad dyes → undyed
    raw.gear.warrior!.weapon = 999;                                      // dangling: back to the starter weapon
    raw.gear.paladin!.weapon = 1;                                        // plain_head does not fit: starter weapon
    delete raw.gear.ranger!.weapon;                                      // missing weapon
    raw.gear.ninja!.offhand = 13;                                        // daggers take no off-hand
    raw.bag = raw.bag.filter(i => i.item !== 'grove_bow');               // the bow is lost: a new one
    raw.wardrobe = ['orchard_smock', 'orchard_smock', 'gold_crown' as never];
    raw.nextUid = 3;
    raw.extra = 1;
    const p = parseInventory(raw);
    expect(p.repaired).toBe(true);
    const inv = p.inv;
    expect(inv.bag.filter(i => i.uid === 17)).toEqual([{ uid: 17, item: 'hedgecutter', dye: [0, 0] }]);
    expect(inv.bag.some(i => i.item === 'excalibur')).toBe(false);
    expect(inv.bag.find(i => i.uid === 41)!.dye).toEqual([0, 0]);
    const s: InvState = { inv, gold: 0, seals: 0, jobs: newJobsSave() };
    invariants(s);
    expect(gearItems(inv, 'warrior').weapon).toBe('grove_blade');
    expect(gearItems(inv, 'paladin').weapon).toBe('grove_sword');
    expect(gearItems(inv, 'ranger').weapon).toBe('grove_bow');
    expect(inv.bag.filter(i => i.item === 'grove_bow')).toHaveLength(1);
    expect(inv.gear.ninja!.offhand).toBeUndefined();
    expect(inv.wardrobe).toEqual(['orchard_smock']);
    expect(inv.nextUid).toBeGreaterThan(Math.max(...inv.bag.map(i => i.uid)));
    expect(parseInventory(JSON.parse(JSON.stringify(inv))).repaired).toBe(false);
    // overflow: 40 unworn items → 30 in the bag, the rest in the bank
    let big = state();
    for (let i = 0; i < 40; i++) big = { ...big, inv: { ...big.inv, nextUid: big.inv.nextUid + 1, bag: [...big.inv.bag, { uid: big.inv.nextUid, item: 'rootbound_back', dye: [0, 0] }] } };
    const q = parseInventory(JSON.parse(JSON.stringify(big.inv)));
    expect(q.repaired).toBe(true);
    expect(bagUsed(q.inv)).toBe(BAG_SLOTS);
    expect(q.inv.bank).toHaveLength(10);
  });

  it('parseInvOp refuses junk, NaN, negative uids, unknown ops and long strings', () => {
    const good: InvOp[] = [
      { op: 'equip', uid: 17, slot: 'head' }, { op: 'unequip', slot: 'back' }, { op: 'bank', uid: 3 }, { op: 'unbank', uid: 3 }, { op: 'sell', uid: 9 },
      { op: 'buy', stall: 'smithy', item: 'hedgecutter' }, { op: 'buyCostume', costume: 'orchard_smock' }, { op: 'wear', slot: 'body', costume: null },
      { op: 'wear', slot: 'head', costume: 'straw_sunhat' }, { op: 'hideHead', hide: true }, { op: 'dye', uid: 1, ch: 1, dye: 31 },
      { op: 'dyeCostume', costume: 'orchard_smock', ch: 0, dye: 0 }, { op: 'talent', row: 2, choice: 0 }, { op: 'respec' }, { op: 'respec', id: 'a-1_B-xyz-0001' },
    ];
    for (const g of good) expect(parseInvOp(g), JSON.stringify(g)).toEqual(g);
    const bad: unknown[] = [
      null, undefined, 3, 'equip', [], {}, { op: 'dupe' }, { op: 'toString' }, { op: '__proto__' },
      { op: 'equip', uid: NaN, slot: 'head' }, { op: 'equip', uid: -1, slot: 'head' }, { op: 'equip', uid: 0, slot: 'head' }, { op: 'equip', uid: 1.5, slot: 'head' },
      { op: 'equip', uid: 2 ** 40, slot: 'head' }, { op: 'equip', uid: '17', slot: 'head' }, { op: 'equip', uid: 17, slot: 'ring' }, { op: 'equip', uid: 17 },
      { op: 'equip', uid: 17, slot: 'head', extra: 1 }, { op: 'buy', stall: 'castle', item: 'hedgecutter' }, { op: 'buy', stall: 'smithy', item: 'x'.repeat(41) },
      { op: 'buy', stall: 'smithy', item: 7 }, { op: 'buyCostume', costume: 'y'.repeat(41) }, { op: 'wear', slot: 'feet', costume: null }, { op: 'wear', slot: 'body' },
      { op: 'hideHead', hide: 'yes' }, { op: 'dye', uid: 1, ch: 2, dye: 3 }, { op: 'dye', uid: 1, ch: 0, dye: 32 }, { op: 'dye', uid: 1, ch: 0, dye: -1 },
      { op: 'talent', row: 3, choice: 0 }, { op: 'talent', row: 0, choice: Infinity }, { op: 'respec', id: '' }, { op: 'respec', id: 'z'.repeat(41) }, { op: 'respec', id: 'has space here' }, { op: 'respec', id: 'elevenchars' },
      { op: 'respec', id: 5 },
    ];
    for (const b of bad) expect(parseInvOp(b), JSON.stringify(b)).toBeNull();
    // applyInvOp refuses anything parseInvOp would (never throws on junk)
    expect(refusal(applyInvOp(state(), { op: 'equip', uid: NaN, slot: 'head' } as InvOp, CTX))).toBe('unknown');
  });

  it('inventoryView and gearLookOf: worn lists, stats, sets; costumes and dyes change the look and never the stats', () => {
    let s = state({ jobs: jobsAt('white_mage') });
    for (const id of ['mossweave_head', 'mossweave_chest', 'mossweave_legs']) {
      s = withItem(s, id);
      s = ok(applyInvOp(s, { op: 'equip', uid: s.inv.nextUid - 1, slot: ITEMS[id]!.slot }, CTX)).state;
    }
    const v = inventoryView(s);
    expect(v.sets).toEqual([{ set: 'mossweave', pieces: 3 }]);
    expect(v.stats).toEqual(kitFor({ job: 'white_mage', level: 10, gear: gearItems(s.inv, 'white_mage'), talents: [] }).stats);
    expect(v.bag.find(i => i.item === 'mossweave_head')!.worn).toEqual(['white_mage']);
    expect(v.freeRespec).toBe(true);
    expect(v.gold).toBe(1000);
    // dress up: every priced costume bought and worn, dyes changed: the stats and kit stay the same
    let d = s;
    for (const c of COSTUME_IDS) if (COSTUMES[c].price !== null) d = ok(applyInvOp({ ...d, gold: 5000 }, { op: 'buyCostume', costume: c }, at('tailor'))).state;
    d = { ...d, inv: { ...d.inv, wardrobe: [...COSTUME_IDS] } }; // and the event ones (a GM grant)
    const kitBefore = kitFor({ job: 'white_mage', level: 10, gear: gearItems(d.inv, 'white_mage'), talents: [] });
    for (const c of COSTUME_IDS) {
      d = ok(applyInvOp(d, { op: 'wear', slot: COSTUMES[c].slot, costume: c }, CTX)).state;
      d = ok(applyInvOp({ ...d, gold: 100 }, { op: 'dyeCostume', costume: c, ch: 0, dye: 17 }, at('tailor'))).state;
      for (const u of d.inv.bag.map(i => i.uid)) { const r = applyInvOp({ ...d, gold: 100 }, { op: 'dye', uid: u, ch: 1, dye: 25 }, at('tailor')); if (!('refusal' in r)) d = r.state; }
      expect(kitFor({ job: 'white_mage', level: 10, gear: gearItems(d.inv, 'white_mage'), talents: [] })).toEqual(kitBefore);
      expect(inventoryView(d).stats).toEqual(v.stats);
      const look = gearLookOf(d.inv, 'white_mage', d.jobs.jobs.white_mage!.outfit);
      const code = encodeGearLook(look);
      expect(code.length).toBeLessThanOrEqual(27);
      expect(decodeGearLook(code)).toEqual(look);
    }
    const look = gearLookOf(d.inv, 'white_mage', d.jobs.jobs.white_mage!.outfit);
    expect(look.chest!.model).toBe(COSTUMES[d.jobs.jobs.white_mage!.outfit!.body! as CostumeId].model);
    expect(look.legs).toBeNull();
    expect(look.weapon!.model).toBe(ITEMS.grove_staff!.model);
    // no outfit: the worn items' models and dyes
    const plain = gearLookOf(s.inv, 'white_mage', null);
    expect(plain.head).toEqual({ model: ITEMS.mossweave_head!.model, dye: [0, 0] });
    expect(plain.feet).toEqual({ model: ITEMS.plain_feet!.model, dye: [3, 7] });
    expect(gearLookOf(s.inv, 'ninja', null).offhand).toBeNull();
    // never throws, even on junk
    expect(() => gearLookOf({} as InventorySave, 'warrior', { body: 'nope' as never, head: null, back: null, hideHead: false })).not.toThrow();
    // T3 kit per job: every model in range, the code round-trips
    for (const job of JOB_IDS) {
      let k = state({ jobs: jobsAt(job) });
      const items = kitItems(3, job);
      for (const slot of GEAR_SLOTS as readonly GearSlot[]) {
        const id = items[slot];
        if (!id) continue;
        k = withItem(k, id);
        k = ok(applyInvOp(k, { op: 'equip', uid: k.inv.nextUid - 1, slot }, CTX)).state;
      }
      const gl = gearLookOf(k.inv, job, null);
      expect(decodeGearLook(encodeGearLook(gl))).toEqual(gl);
      expect(kitFor({ job, level: 10, gear: gearItems(k.inv, job), talents: [] }).stats.power).toBe(20);
    }
  });
});
