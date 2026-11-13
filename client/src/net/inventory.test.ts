import { describe, expect, it } from 'vitest';
import {
  COSTUMES, DYE_PRICE, ITEMS, ITEM_IDS, JOBS, RESPEC_PRICE, SETS, TOWN_STALLS, inventoryView, itemStats, newInventory, newJobsSave, applyInvOp,
  type InvCtx, type InvOp, type InventorySave, type InventoryView, type JobId, type JobsSave, type JobsView,
} from '@sg2/shared';
import type { Comparison } from '../core/gearViews';
import {
  InvClient, OP_GATE_MS, charSheetView, compare, ctxFor, equipBlock, itemColour, levelShow, lootShow, newOpId, opKey, refusalLine,
  setProgress, talentsView, vendorView, type GearCtx,
} from './inventory';

const CTX: InvCtx = { stall: null, jobSwitch: true, townBoard: false, inCombat: false, dead: false, busy: false };
const SMITHY: InvCtx = { ...CTX, stall: 'smithy' };

/** A server-made view: the starter kit plus whatever ops are applied (the shared rules, as the server runs them). */
function serverState(job: JobId = 'ranger', gold = 2000, seals = 0, xp = 0) {
  const jobs: JobsSave = newJobsSave(job);
  jobs.jobs[job]!.xp = xp;
  let s = { inv: newInventory([0, 0]) as InventorySave, gold, seals, jobs };
  const apply = (op: InvOp, ctx: InvCtx = SMITHY) => {
    const r = applyInvOp(s, { ...op, id: newOpId() } as InvOp, ctx);
    if ('refusal' in r) throw new Error(`refused ${op.op}: ${r.refusal}`);
    s = r.state;
    return s;
  };
  const view = (): InventoryView => inventoryView(s);
  const jobsView = (): JobsView => {
    const out = {} as JobsView['jobs'];
    for (const id of Object.keys(JOBS) as JobId[]) {
      const r = s.jobs.jobs[id];
      const lv = r ? levelOf(r.xp) : 1;
      out[id] = { level: lv, xp: r?.xp ?? 0, next: 0, picks: r?.picks ?? [JOBS[id].picks.solo[0], JOBS[id].picks.solo[1]], talents: r?.talents ?? [], outfit: r?.outfit ?? null };
    }
    return { current: s.jobs.current, jobs: out };
  };
  return { apply, view, jobsView, get s() { return s; } };
}
const levelOf = (xp: number) => { let l = 1, need = [100, 140, 190, 250, 320, 400, 490, 590, 700], t = 0; for (const n of need) { if (xp >= t + n) { t += n; l++; } else break; } return l; };
const uidOf = (v: InventoryView, item: string) => v.bag.find((i) => i.item === item)!.uid;
const ctxOf = (st: ReturnType<typeof serverState>, extra: Partial<GearCtx> = {}): GearCtx => ({ ...ctxFor(st.jobsView(), { zone: 'grove', x: 0, z: 0, inCombat: false, dead: false, busy: false, sealed: false }), ...extra });

const STATS = ['power', 'defence', 'maxHp', 'focus', 'flow', 'guard'] as const;
const SHORT: Record<(typeof STATS)[number], string> = { power: 'Power', defence: 'Defence', maxHp: 'hp', focus: 'Focus', flow: 'Flow', guard: 'Guard' };
const d10 = (x: number) => Math.round(x * 10) / 10;
const sgn = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `\u2212${-d}` : '');
/** The summary the item data implies for swapping `from` for `to` (kit totals move by the items' own stats). */
function expectedSummary(from: string, to: string): string {
  const a = itemStats(from), b = itemStats(to);
  const parts = STATS.map((k) => [k, d10(b[k] - a[k])] as const).filter(([, d]) => d !== 0).map(([k, d]) => `${sgn(d)} ${SHORT[k]}`);
  return parts.length ? parts.join(', ') : 'No change to your stats';
}
/** Every line follows the data: a line for each stat that is not 0 on both sides; its delta and better/worse flag
 *  from the items' difference (null only when the stat does not change; never null when it does). */
function expectFollowsData(cmp: Comparison, v: InventoryView, from: string, to: string): void {
  const a = itemStats(from), b = itemStats(to);
  for (const k of STATS) {
    const d = d10(b[k] - a[k]);
    const line = cmp.lines.find((l) => l.key === k);
    const before = v.stats[k];
    if (before === 0 && before + d === 0) { expect(line, k).toBeUndefined(); continue; }
    expect(line, k).toBeDefined();
    expect(Number(line!.after) - Number(line!.before)).toBeCloseTo(d, 5);
    expect(line!.delta, k).toBe(sgn(d));
    expect(line!.up, k).toBe(d > 0 ? true : d < 0 ? false : null);
  }
  expect(cmp.summary).toBe(expectedSummary(from, to));
}

describe('InvClient follows the server', () => {
  it('takes inventory, loot, levelUp and refusals; ignores malformed messages', () => {
    const st = serverState();
    const c = new InvClient();
    expect(c.onInventory({ bag: 'nope' })).toBe(false);
    expect(c.view).toBeNull();
    expect(c.onInventory(st.view())).toBe(true);
    expect(c.view!.gold).toBe(2000);
    const loot = c.onLoot({ items: [{ item: 'cinderstep_chest', uid: 99 }, { item: 'nope', uid: 3 }], gold: 12, soldFor: 0, x: 1, z: 2 });
    expect(loot!.items.map((i) => i.name)).toEqual([ITEMS.cinderstep_chest.name]);
    expect(c.lastLoot).toEqual({ items: [ITEMS.cinderstep_chest.name], gold: 12 });
    expect(c.onLoot({ items: 3 })).toBeNull();
    c.onLevelUp({ job: 'ranger', level: 4, talentRow: 0 });
    c.onLevelUp({ job: 'nope', level: 4, talentRow: 0 });
    expect(c.levelUps).toEqual([{ job: 'ranger', level: 4 }]);
    for (let i = 0; i < 25; i++) c.onRefused({ op: 'buy', reason: 'gold', text: 'Not enough gold' });
    expect(c.refusals.length).toBe(20);
    // the bag never changes on its own: a loot message does not invent items (the next `inventory` brings them)
    expect(c.view!.bag.some((i) => i.uid === 99)).toBe(false);
  });

  it('gates ops: a second identical op waits for the answer; each op carries a fresh random id', () => {
    const c = new InvClient();
    const buy: InvOp = { op: 'buy', stall: 'smithy', item: 'thornrunner_chest' };
    const a = c.begin(buy, 0);
    expect(a && a.id && /^[A-Za-z0-9_-]{12,40}$/.test(a.id)).toBe(true);
    expect(c.begin(buy, 10)).toBeNull(); // the double tap
    expect(c.pendingKeys().has(opKey(buy))).toBe(true);
    c.onRefused({ op: 'buy', reason: 'gold', text: 'Not enough gold' });
    const b = c.begin(buy, 20);
    expect(b).not.toBeNull();
    expect(b!.id).not.toBe(a!.id);
    c.onInventory(serverState().view());
    expect(c.pendingKeys().size).toBe(0);
    // a lost answer frees the gate after a while
    c.begin(buy, 1000);
    expect(c.begin(buy, 1000 + OP_GATE_MS + 1)).not.toBeNull();
  });

  it('refusal lines say what to do', () => {
    expect(refusalLine('buy', 'where', 'x')).toMatch(/stall/i);
    expect(refusalLine('talent', 'where', 'x')).toMatch(/town|sanctuary/i);
    expect(refusalLine('respec', 'where', 'x')).toMatch(/Guild Board/);
    expect(refusalLine('equip', 'combat', 'Not while fighting')).toMatch(/fight/i);
    expect(refusalLine('buy', 'gold', 'Not enough gold')).toBe('Not enough gold');
  });
});

describe('comparison and sets', () => {
  it('compare: the chest swap shows exactly the differences the item data gives, and the kit totals', () => {
    const st = serverState('ranger');
    st.apply({ op: 'buy', stall: 'smithy', item: 'thornrunner_chest' });
    const v = st.view();
    const cmp = compare(v, uidOf(v, 'thornrunner_chest'), ctxOf(st))!;
    expect(cmp.replaces).toBe(ITEMS.plain_chest.name);
    expectFollowsData(cmp, v, 'plain_chest', 'thornrunner_chest');
    // before is the kit the server reports
    for (const l of cmp.lines) expect(Number(l.before)).toBeCloseTo(v.stats[l.key], 5);
  });

  it('compare: a worse piece shows red (minus) differences', () => {
    // a T1 chest that is worse than the heavy one worn in some stat (picked from the data, not by name)
    const worse = ITEM_IDS.find((id) => ITEMS[id]!.tier === 1 && ITEMS[id]!.slot === 'chest' && ITEMS[id]!.price !== undefined
      && STATS.some((k) => itemStats(id)[k] < itemStats('rootbound_chest')[k]))!;
    expect(worse).toBeDefined();
    const st = serverState('paladin');
    st.apply({ op: 'buy', stall: 'smithy', item: worse });
    st.apply({ op: 'buy', stall: 'smithy', item: 'rootbound_chest' });
    st.apply({ op: 'equip', uid: uidOf(st.view(), 'rootbound_chest'), slot: 'chest' });
    const v = st.view();
    const cmp = compare(v, uidOf(v, worse), ctxOf(st))!;
    expectFollowsData(cmp, v, 'rootbound_chest', worse);
    expect(cmp.lines.some((l) => l.up === false)).toBe(true);
    expect(cmp.summary).toMatch(/\u2212\d/);
  });

  it('compare: the same piece again changes nothing and says so', () => {
    const st = serverState('ranger');
    st.apply({ op: 'buy', stall: 'smithy', item: 'thornrunner_chest' });
    st.apply({ op: 'equip', uid: uidOf(st.view(), 'thornrunner_chest'), slot: 'chest' });
    st.apply({ op: 'buy', stall: 'smithy', item: 'thornrunner_chest' });
    const v = st.view();
    const spare = v.bag.find((i) => i.item === 'thornrunner_chest' && i.worn.length === 0)!;
    const cmp = compare(v, spare.uid, ctxOf(st))!;
    expect(cmp.summary).toBe('No change to your stats');
    expect(cmp.lines.every((l) => l.up === null && l.delta === '')).toBe(true);
  });

  it('set progress counts per set, with the bonus lines lit when active', () => {
    const st = serverState('ranger');
    for (const s of ['chest', 'legs', 'head'] as const) {
      st.apply({ op: 'buy', stall: 'smithy', item: `thornrunner_${s}` });
      st.apply({ op: 'equip', uid: uidOf(st.view(), `thornrunner_${s}`), slot: s });
    }
    const sets = setProgress(st.view(), 'ranger');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ name: SETS.thornrunner.name, pieces: 3, of: 6 });
    expect(sets[0].bonuses).toEqual([{ at: 3, text: SETS.thornrunner.desc3, on: true }, { at: 5, text: SETS.thornrunner.desc5, on: false }]);
    // the comparison names a set bonus the swap would add or lose
    st.apply({ op: 'buy', stall: 'smithy', item: 'mossweave_legs' });
    const v = st.view();
    const cmp = compare(v, uidOf(v, 'mossweave_legs'), ctxOf(st))!;
    expect(cmp.sets.join(' ')).toMatch(/Loses Thornrunner/);
  });

  it('equipBlock says why in plain words: job, slot, fight, sealed arena', () => {
    const st = serverState('paladin');
    st.apply({ op: 'buy', stall: 'smithy', item: 'ashwood_longbow' });
    const v = st.view();
    const bow = uidOf(v, 'ashwood_longbow');
    expect(equipBlock(v, bow, ctxOf(st))).toMatch(/Paladin/);
    expect(equipBlock(v, bow, ctxOf(st))).toMatch(/sword/i);
    st.apply({ op: 'buy', stall: 'smithy', item: 'millward_sword' });
    const v2 = st.view();
    const sword = uidOf(v2, 'millward_sword');
    expect(equipBlock(v2, sword, ctxOf(st))).toBeNull();
    expect(equipBlock(v2, sword, ctxOf(st, { inCombat: true }))).toMatch(/fight/i);
    expect(equipBlock(v2, sword, ctxOf(st, { sealed: true }))).toMatch(/sealed/i);
    expect(equipBlock(v2, sword, ctxOf(st, { busy: true }))).toMatch(/casting|charging/i);
    expect(equipBlock(v2, sword, ctxOf(st, { dead: true }))).toMatch(/knocked out/i);
  });

  it('tier colours: T3 off-hands read as T3, named gold, starter grey, never black for Undyed', () => {
    expect(itemColour('toll_buckler')).toBe(itemColour('tollwind_chest'));
    expect(itemColour('last_bell')).not.toBe(itemColour('toll_buckler'));
    expect(itemColour('grove_blade')).toBe(itemColour('plain_chest'));
    const st = serverState('ranger');
    const v = vendorView('tailor', st.view(), ctxOf(st), { x: TOWN_STALLS.tailor.x, z: TOWN_STALLS.tailor.z });
    expect(v.dyes[0]).toMatchObject({ id: 0, name: 'Undyed', hex: null });
  });
});

describe('sheets and stalls', () => {
  it('the character sheet: eight slots, bag of 30, the starter kit worn', () => {
    const st = serverState('dark_knight');
    const v = charSheetView(st.view(), ctxOf(st));
    expect(v.slots).toHaveLength(8);
    expect(v.slots.find((s) => s.slot === 'offhand')!.item).toBeNull(); // a greatsword takes no off-hand
    expect(v.slots.find((s) => s.slot === 'offhand')!.none).toMatch(/two-handed|greatsword/i);
    expect(v.bag).toHaveLength(0);
    expect(v.bagSlots).toBe(30);
    expect(v.stats.find((s) => s.key === 'power')!.value).toBe(String(st.view().stats.power));
  });

  it('the smithy: prices from the data, owned and affordable states, comparison for the job', () => {
    const st = serverState('ranger', 60);
    st.apply({ op: 'buy', stall: 'smithy', item: 'thornrunner_feet' }); // 40 gold: 20 left
    const at = { x: TOWN_STALLS.smithy.x, z: TOWN_STALLS.smithy.z };
    const v = vendorView('smithy', st.view(), ctxOf(st), at);
    expect(v.here).toBe(true);
    expect(v.defaultFilter).toBe('light');
    const light = v.rows.light;
    const feet = light.find((r) => r.item.item === 'thornrunner_feet')!;
    expect(feet.price).toBe(ITEMS.thornrunner_feet.price);
    expect(feet.owned).toBe(1);
    const chest = light.find((r) => r.item.item === 'thornrunner_chest')!;
    expect(chest.ok).toBe(false);
    expect(chest.why).toBe(`Need ${ITEMS.thornrunner_chest.price! - 20} more gold`);
    expect(chest.item.equip?.cmp?.summary).toBe(expectedSummary('plain_chest', 'thornrunner_chest'));
    const weapons = v.rows.weapons;
    expect(weapons.find((r) => r.item.item === 'ashwood_longbow')!.forMe).toBe(true);
    expect(weapons.find((r) => r.item.item === 'millward_sword')!.fitsLabel).toBe(JOBS.paladin.name);
    // away from the stall: listed, but buying says where to go
    const away = vendorView('smithy', st.view(), ctxOf(st), { x: 0, z: 0 });
    expect(away.here).toBe(false);
    expect(away.why).toMatch(/Kettleworth/);
    // selling: the bag's unworn sellable items with their price; tier 2+ asks first
    expect(v.sell.map((i) => i.item)).toEqual(['thornrunner_feet']);
    expect(v.sell[0].sell).toMatchObject({ price: ITEMS.thornrunner_feet.sell, confirm: false, ok: true });
  });

  it('the lampwright sells T3 for Seals; the tailor shows prices, Owned and event costumes', () => {
    const st = serverState('white_mage', 500, 3);
    const lw = vendorView('lampwright', st.view(), ctxOf(st), { x: TOWN_STALLS.lampwright.x, z: TOWN_STALLS.lampwright.z });
    expect(lw.defaultFilter).toBe('cloth');
    const hood = lw.rows.cloth.find((r) => r.item.item === 'lenslight_head')!;
    expect(hood).toMatchObject({ price: ITEMS.lenslight_head.seals, currency: 'seals', ok: true });
    expect(lw.rows.cloth.find((r) => r.item.item === 'lenslight_chest')!.why).toMatch(/Seal/);
    st.apply({ op: 'buyCostume', costume: 'straw_sunhat' }, { ...CTX, stall: 'tailor' });
    const t = vendorView('tailor', st.view(), ctxOf(st), { x: TOWN_STALLS.tailor.x, z: TOWN_STALLS.tailor.z });
    expect(t.costumes.find((c) => c.id === 'straw_sunhat')!.owned).toBe(true);
    const coat = t.costumes.find((c) => c.id === 'lamplighter_coat')!;
    expect(coat).toMatchObject({ price: COSTUMES.lamplighter_coat.price, owned: false, ok: false });
    expect(t.costumes.find((c) => c.id === 'beacon_halo')).toMatchObject({ event: true, price: null, ok: false });
    expect(t.dyePrice).toBe(DYE_PRICE);
    expect(t.dyeTargets.some((d) => d.kind === 'costume' && d.costume === 'straw_sunhat')).toBe(true);
  });

  it('talents: locked rows cannot be chosen; "needs X on your bar"; the retraining price', () => {
    // level 5: row 1 open, rows 2 and 3 locked
    const st = serverState('ranger', 100, 0, 700);
    const t = talentsView(st.view(), ctxOf(st));
    expect(t.rows.map((r) => r.unlocked)).toEqual([true, false, false]);
    expect(t.rows[1].level).toBe(7);
    // Light Feet changes Sprint, a pick the solo build does not carry
    const feet = t.rows[1].cards.find((c) => c.id === 'ranger_2c')!;
    expect(JOBS.ranger.picks.solo).not.toContain('sprint');
    expect(feet.needs).toBe('Needs Sprint on your bar');
    expect(t.rows[1].cards.find((c) => c.id === 'ranger_2b')!.needs).toBeNull(); // Pinning Shot is a solo pick
    expect(t.rows[0].cards.find((c) => c.id === 'ranger_1a')!.needs).toBeNull(); // Snap Shot is always on the bar
    expect(t.canChoose).toBe(true);
    expect(talentsView(st.view(), ctxOf(st, { jobSwitch: false })).chooseNote).toMatch(/town or sanctuary/);
    st.apply({ op: 'talent', row: 0, choice: 1 });
    const t2 = talentsView(st.view(), ctxOf(st, { townBoard: true }));
    expect(t2.rows[0].chosen).toBe(1);
    expect(t2.respec).toMatchObject({ price: 0, free: true, ok: true, rows: 1 });
    st.apply({ op: 'respec' }, { ...CTX, townBoard: true });
    st.apply({ op: 'talent', row: 0, choice: 0 });
    const t3 = talentsView(st.view(), ctxOf(st, { townBoard: false }));
    expect(t3.respec).toMatchObject({ price: RESPEC_PRICE, free: false, ok: false });
    expect(t3.respec.why).toMatch(/Guild Board/);
  });

  it('loot and level-up moments', () => {
    const l = lootShow({ items: [{ item: 'last_bell', uid: 5 }], gold: 60, soldFor: 0, x: 0, z: 0 })!;
    expect(l.items[0]).toMatchObject({ name: 'Last Bell', named: true });
    const lv = levelShow({ job: 'ranger', level: 7, talentRow: 1 }, ctxOf(serverState('ranger'), { jobSwitch: false }))!;
    expect(lv.jobName).toBe(JOBS.ranger.name);
    expect(lv.gains).toMatch(/Power/);
    expect(lv.talent).toMatchObject({ row: 1, ok: false });
    expect(lv.talent!.why).toMatch(/town or sanctuary/);
  });
});
