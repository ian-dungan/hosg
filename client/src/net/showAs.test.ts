// Show-as against the protocol, without a game server: the views are built from `inventory` messages that the shared
// rules (applyInvOp, as the server runs them) produce, and the op queue is driven with fake answers.
import { describe, expect, it } from 'vitest';
import {
  COSTUME_PIECES, DYE_PRICE, INV_TEXT, ITEMS, JOBS, LOOKS, LOOK_IDS, OUTFIT_LABELS, applyInvOp, inventoryView, lookFits, newInventory, newJobsSave, piecesOf,
  withCollection, type InvCtx, type InvOp, type InventorySave, type InventoryView, type JobId, type JobsSave, type JobsView,
} from '@sg2/shared';
import { InvClient, OP_GATE_MS, ctxFor, newOpId, opKey, refusalLine, lootShow, type GearCtx } from './inventory';
import { OpQueue, appearanceView, lookSheetView, lookVendorView, markNewLooks, outfitRows, showOpsFor, showSetOptions, tailorCostumes } from './showAs';

const CTX: InvCtx = { stall: null, jobSwitch: true, townBoard: false, inCombat: false, dead: false, busy: false };
const SMITHY: InvCtx = { ...CTX, stall: 'smithy' };
const TAILOR: InvCtx = { ...CTX, stall: 'tailor' };

function server(job: JobId = 'ranger', gold = 5000) {
  const jobs: JobsSave = newJobsSave(job);
  let s = { inv: newInventory([0, 0]) as InventorySave, gold, seals: 0, jobs };
  const tryOp = (op: InvOp, ctx: InvCtx = CTX) => {
    const r = applyInvOp(s, { ...op, id: newOpId() } as InvOp, ctx);
    if ('refusal' in r) return r.refusal;
    s = r.state;
    return null;
  };
  const apply = (op: InvOp, ctx: InvCtx = CTX) => { const r = tryOp(op, ctx); if (r) throw new Error(`refused ${op.op}: ${r}`); };
  const give = (item: string) => { s = { ...s, inv: withCollection({ ...s.inv, bag: [...s.inv.bag, { uid: s.inv.nextUid, item, dye: [0, 0] }], nextUid: s.inv.nextUid + 1 }) }; };
  const equip = (item: string) => { const i = s.inv.bag.find((x) => x.item === item)!; apply({ op: 'equip', uid: i.uid, slot: ITEMS[item]!.slot }); };
  const view = (): InventoryView => inventoryView(s);
  const jobsView = (): JobsView => {
    const out = {} as JobsView['jobs'];
    for (const id of Object.keys(JOBS) as JobId[]) {
      const r = s.jobs.jobs[id];
      out[id] = { level: 5, xp: r?.xp ?? 0, next: 0, picks: r?.picks ?? [JOBS[id].picks.solo[0], JOBS[id].picks.solo[1]], talents: r?.talents ?? [], outfit: r?.outfit ?? null };
    }
    return { current: s.jobs.current, jobs: out };
  };
  const ctx = (extra: Partial<GearCtx> = {}): GearCtx => ({ ...ctxFor(jobsView(), { zone: 'grove', x: 0, z: 0, inCombat: false, dead: false, busy: false, sealed: false }), ...extra });
  return { apply, tryOp, give, equip, view, ctx, get s() { return s; } };
}
const model = (item: string) => ITEMS[item]!.model;
const slotOf = (st: ReturnType<typeof server>, slot: string, extra: Partial<GearCtx> = {}) => appearanceView(st.view(), st.ctx(extra)).slots.find((x) => x.slot === slot)!;

/** A ranger in Thornrunner (head, chest, legs) with Mossweave and Rootbound pieces collected and one costume piece bought. */
function dressed() {
  const st = server();
  for (const id of ['thornrunner_head', 'thornrunner_chest', 'thornrunner_legs', 'mossweave_chest', 'mossweave_head', 'rootbound_feet']) st.apply({ op: 'buy', stall: 'smithy', item: id }, SMITHY);
  st.equip('thornrunner_head'); st.equip('thornrunner_chest'); st.equip('thornrunner_legs');
  st.apply({ op: 'buyCostume', costume: 'straw_sunhat_head' }, TAILOR);
  return st;
}

describe('per-slot looks (show as)', () => {
  it('a slot shows its item by default; the options are every unlocked look that fits, but its own', () => {
    const st = dressed();
    const head = slotOf(st, 'head');
    expect(head.worn?.name).toBe(ITEMS.thornrunner_head!.name);
    expect(head.shown).toBeNull();
    expect(head.line).toBeNull();
    const ids = head.options.map((o) => o.id);
    expect(ids).toContain(model('mossweave_head'));          // collected gear look
    expect(ids).toContain(COSTUME_PIECES.straw_sunhat_head!.model); // costume piece, together with gear looks
    expect(ids).toContain(model('plain_head'));               // the starter look (held)
    expect(ids).not.toContain(model('thornrunner_head'));     // its own is "Show equipped item"
    expect(ids).not.toContain(COSTUME_PIECES.brass_goggles_head!.model); // locked looks are not listed
    // the counts: unlocked of every look that fits over the worn item
    const fit = LOOK_IDS.filter((id) => lookFits(id, 'head', 'thornrunner_head'));
    expect(head.total).toBe(fit.length);
    expect(head.unlocked).toBe(ids.length + 1);
    // gear looks first (best tier first), then costume pieces; each with its name, colour and source
    const sun = head.options.find((o) => o.kind === 'costume')!;
    expect(head.options.indexOf(sun)).toBe(head.options.length - 1);
    expect(sun.source).toMatch(/^Costume · /);
    expect(head.options.find((o) => o.id === model('mossweave_head'))!.source).toBe('Mossweave set');
  });

  it('an override shows "Shown as" and lights its option; stats come from the worn item', () => {
    const st = dressed();
    const before = st.view().stats;
    st.apply({ op: 'look', slot: 'chest', look: model('mossweave_chest') });
    const chest = slotOf(st, 'chest');
    expect(chest.line).toBe(`Shown as: ${ITEMS.mossweave_chest!.name}`);
    expect(chest.worn?.name).toBe(ITEMS.thornrunner_chest!.name);
    expect(chest.options.find((o) => o.on)?.id).toBe(model('mossweave_chest'));
    expect(chest.showOps).toEqual([{ op: 'look', slot: 'chest', look: null }]);
    expect(st.view().stats).toEqual(before);
  });

  it('hide: head, back and off-hand only; a hidden slot says so and showing a look unhides it', () => {
    const st = dressed();
    expect(slotOf(st, 'chest').hideOp).toBeNull();
    expect(slotOf(st, 'head').hideOp).toEqual({ op: 'hide', slot: 'head', hide: true });
    st.apply({ op: 'hide', slot: 'head', hide: true });
    const head = slotOf(st, 'head');
    expect(head.hidden).toBe(true);
    expect(head.line).toBe('Hidden');
    expect(head.hideOp).toBeNull();
    expect(head.showOps).toEqual([{ op: 'hide', slot: 'head', hide: false }]);
    expect(showOpsFor(head, model('mossweave_head'))).toEqual([{ op: 'look', slot: 'head', look: model('mossweave_head') }, { op: 'hide', slot: 'head', hide: false }]);
    expect(showOpsFor(slotOf(st, 'chest'), null)).toEqual([]); // already showing its item: nothing to send
  });

  it('show a whole set: one op per slot with an unlocked piece; other slots stay; then nothing left to send', () => {
    const st = dressed();
    st.apply({ op: 'look', slot: 'legs', look: model('plain_legs') });
    const sets = showSetOptions(st.view(), st.ctx());
    const moss = sets.find((x) => x.key === 'set:mossweave')!;
    expect(moss.pieces).toBe(2);
    expect(moss.slots).toBe('Head, Chest');
    expect(moss.ops).toEqual([{ op: 'look', slot: 'head', look: model('mossweave_head') }, { op: 'look', slot: 'chest', look: model('mossweave_chest') }]);
    // the worn set: its own pieces mean "the item's own look" (clears the legs override)
    const thorn = sets.find((x) => x.key === 'set:thornrunner')!;
    expect(thorn.ops).toEqual([{ op: 'look', slot: 'legs', look: null }]);
    const sun = sets.find((x) => x.key === 'costume:straw_sunhat')!;
    expect(sun.kind).toBe('costume');
    for (const op of moss.ops) st.apply(op);
    expect(slotOf(st, 'legs').line).toBe(`Shown as: ${ITEMS.plain_legs!.name}`); // left as it was
    expect(showSetOptions(st.view(), st.ctx()).find((x) => x.key === 'set:mossweave')!.ops).toEqual([]);
    // a set none of whose pieces is unlocked is not offered
    expect(sets.find((x) => x.key === 'set:beaconstone')).toBeUndefined();
  });

  it('show my equipped gear: clears every look and hide (dyes stay), and then there is nothing to clear', () => {
    const st = dressed();
    st.apply({ op: 'look', slot: 'chest', look: model('mossweave_chest') });
    st.apply({ op: 'hide', slot: 'head', hide: true });
    st.apply({ op: 'dyeSlot', slot: 'legs', ch: 0, dye: 9 }, TAILOR);
    const a = appearanceView(st.view(), st.ctx());
    expect(a.changed).toBe(2);
    expect(a.clearOps).toEqual([{ op: 'hide', slot: 'head', hide: false }, { op: 'look', slot: 'chest', look: null }]);
    for (const op of a.clearOps) st.apply(op);
    const b = appearanceView(st.view(), st.ctx());
    expect(b.changed).toBe(0);
    expect(b.clearOps).toEqual([]);
    expect(b.slots.find((x) => x.slot === 'legs')!.dyes[0]!.dye).toBe(9);
  });

  it('dyes: three channels as shown, own colours by default, the price, and only at the Tailor', () => {
    const st = dressed();
    const legs = slotOf(st, 'legs');
    expect(legs.dyes.map((d) => d.label)).toEqual(['Primary', 'Secondary', 'Trim']);
    expect(legs.own).toBe(true);
    expect(legs.dyes.every((d) => d.dye === 0 && d.hex === null)).toBe(true);
    const away = appearanceView(st.view(), st.ctx());
    expect(away.dye.here).toBe(false);
    expect(away.dye.why).toMatch(/Tailor/);
    expect(away.dye.price).toBe(DYE_PRICE);
    expect(away.dye.palette[0]!.hex).toBeNull();
    const gold = st.s.gold;
    st.apply({ op: 'dyeSlot', slot: 'legs', ch: 2, dye: 30 }, TAILOR);
    expect(st.s.gold).toBe(gold - DYE_PRICE);
    const at = appearanceView(st.view(), st.ctx({ stall: 'tailor' }));
    expect(at.dye.here).toBe(true);
    expect(at.dye.why).toBeNull();
    const l2 = at.slots.find((x) => x.slot === 'legs')!;
    expect(l2.own).toBe(false);
    expect(l2.dyes[2]).toMatchObject({ dye: 30, hex: expect.stringMatching(/^#/) });
    expect(appearanceView(st.view(), st.ctx({ stall: 'tailor', inCombat: true })).dye.why).toBe('Not while fighting');
  });

  it('outfits: six places with fixed labels; save, wear and overwrite through the protocol', () => {
    const st = dressed();
    expect(outfitRows(st.view())).toHaveLength(6);
    expect(outfitRows(st.view()).every((r) => r.label === null)).toBe(true);
    st.apply({ op: 'look', slot: 'head', look: COSTUME_PIECES.straw_sunhat_head!.model });
    st.apply({ op: 'saveOutfit', index: 2, label: 3 });
    let rows = outfitRows(st.view());
    expect(rows[2]).toMatchObject({ label: OUTFIT_LABELS[3], labelIndex: 3, wearing: true });
    expect(rows[2]!.summary).toContain(COSTUME_PIECES.straw_sunhat_head!.name);
    st.apply({ op: 'look', slot: 'head', look: null });
    expect(outfitRows(st.view())[2]!.wearing).toBe(false);
    st.apply({ op: 'wearOutfit', index: 2 });
    expect(outfitRows(st.view())[2]!.wearing).toBe(true);
    expect(slotOf(st, 'head').shown?.id).toBe(COSTUME_PIECES.straw_sunhat_head!.model);
    // overwrite: same place, another label and the current look
    st.apply({ op: 'look', slot: 'head', look: null });
    st.apply({ op: 'saveOutfit', index: 2, label: 0 });
    rows = outfitRows(st.view());
    expect(rows[2]).toMatchObject({ label: OUTFIT_LABELS[0], summary: 'Your equipped gear', wearing: true });
    expect(st.tryOp({ op: 'wearOutfit', index: 4 })).toBe('unknown'); // an empty place
  });

  it('refusals read clearly: in combat or a sealed arena, not unlocked, wrong slot, dyes away from the Tailor', () => {
    const st = dressed();
    expect(st.tryOp({ op: 'look', slot: 'head', look: COSTUME_PIECES.brass_goggles_head!.model })).toBe('locked');
    expect(refusalLine('look', 'locked', '')).toBe(INV_TEXT.locked);
    expect(st.tryOp({ op: 'look', slot: 'head', look: model('mossweave_chest') })).toBe('fit');
    expect(refusalLine('look', 'fit', '')).toMatch(/doesn't fit/);
    expect(st.tryOp({ op: 'look', slot: 'head', look: null }, { ...CTX, inCombat: true })).toBe('combat');
    for (const op of ['look', 'hide', 'wearOutfit']) expect(refusalLine(op, 'combat', 'Not while fighting')).toBe('Not while fighting, or inside a sealed boss arena');
    expect(st.tryOp({ op: 'dyeSlot', slot: 'legs', ch: 0, dye: 3 })).toBe('where');
    expect(refusalLine('dyeSlot', 'where', '')).toBe('Stand at the stall to do that');
    // the view says why before a tap: fighting, a sealed arena
    expect(appearanceView(st.view(), st.ctx({ inCombat: true })).why).toBe('Not while fighting');
    expect(appearanceView(st.view(), st.ctx({ sealed: true })).why).toBe('Not inside a sealed boss arena');
  });

  it('nothing is unlocked or shown before the server says so: a refusal leaves the view as it was', () => {
    const st = dressed();
    const inv = new InvClient();
    inv.onInventory(st.view());
    const before = JSON.stringify(appearanceView(inv.view!, st.ctx()));
    expect(st.tryOp({ op: 'look', slot: 'head', look: COSTUME_PIECES.brass_goggles_head!.model })).toBe('locked');
    inv.onRefused({ op: 'look', reason: 'locked', text: INV_TEXT.locked });
    expect(JSON.stringify(appearanceView(inv.view!, st.ctx()))).toBe(before);
  });

  it('an older server (no looks, appearance or outfits) shows every slot as its item and nothing to pick', () => {
    const st = dressed();
    const v = st.view() as Partial<InventoryView>;
    delete v.looks; delete v.appearance; delete v.outfits;
    const a = appearanceView(v as InventoryView, st.ctx());
    expect(a.changed).toBe(0);
    expect(a.slots.find((x) => x.slot === 'chest')!.options).toEqual([]);
    expect(a.outfits.every((o) => o.label === null)).toBe(true);
  });
});

describe('the Tailor sells costume pieces per slot', () => {
  it('each piece with its price from the shared data and its owned state; the missing ones at once', () => {
    const st = dressed();
    st.apply({ op: 'buyCostume', costume: 'lamplighter_coat_legs' }, TAILOR);
    const c = tailorCostumes(st.view(), st.ctx({ stall: 'tailor' }), true).find((x) => x.id === 'lamplighter_coat')!;
    const pieces = piecesOf('lamplighter_coat');
    expect(c.pieces.map((p) => p.price)).toEqual(pieces.map((p) => p.price));
    expect(c.pieces.map((p) => p.owned)).toEqual(pieces.map((p) => p.slot === 'legs'));
    expect(c.missing).toBe(3);
    expect(c.missingPrice).toBe(pieces.filter((p) => p.slot !== 'legs').reduce((n, p) => n + p.price!, 0));
    expect(c.ok).toBe(true);
    const ev = tailorCostumes(st.view(), st.ctx({ stall: 'tailor' }), true).find((x) => x.event)!;
    expect(ev.ok).toBe(false);
    expect(ev.pieces.every((p) => !p.ok)).toBe(true);
    // away from the stall: say where to go
    expect(tailorCostumes(st.view(), st.ctx(), false)[0]!.why).toMatch(/Walk up to/);
    // the bought piece is a look for the legs at once (after the server's answer)
    expect(slotOf(st, 'legs').options.some((o) => o.id === COSTUME_PIECES.lamplighter_coat_legs!.model)).toBe(true);
  });
  it('a poor adventurer is told how much more gold', () => {
    const st = server('ranger', 10);
    const c = tailorCostumes(st.view(), st.ctx({ stall: 'tailor' }), true).find((x) => x.id === 'straw_sunhat')!;
    expect(c.pieces[0]!.why).toMatch(/^Need \d+ more gold$/);
  });
  it('the Tailor view carries the pieces and the slot dyes; other stalls do not', () => {
    const st = dressed();
    const t = lookVendorView('tailor', st.view(), st.ctx(), { x: 0, z: 0 });
    expect(t.pieces?.length).toBeGreaterThan(0);
    expect(t.look?.slots).toHaveLength(8);
    expect(lookVendorView('smithy', st.view(), st.ctx(), { x: 0, z: 0 }).pieces).toBeUndefined();
  });
});

describe('the "New look unlocked" loot toast', () => {
  it('marks a drop whose look is not yet unlocked, once; a known look is not new', () => {
    const st = dressed();
    const v = st.view();
    const m = { items: [{ item: 'wickthread_head', uid: 1 }, { item: 'wickthread_head', uid: 2 }, { item: 'mossweave_head', uid: 3 }], gold: 4, soldFor: 0, x: 0, z: 0 };
    const l = markNewLooks(lootShow(m), m, v)!;
    expect(l.items.map((i) => !!i.newLook)).toEqual([true, false, false]);
    expect(v.looks).not.toContain(model('wickthread_head'));
    // an unknown item in the message does not shift the marks
    const m2 = { items: [{ item: 'no_such_thing' }, { item: 'wickthread_head' }], gold: 0, soldFor: 0 };
    expect(markNewLooks(lootShow(m2), m2, v)!.items.map((i) => !!i.newLook)).toEqual([true]);
    expect(markNewLooks(lootShow(m), m, null)).toEqual(lootShow(m));
  });
});

describe('the op queue (several ops through the gate, one at a time)', () => {
  const fake = () => {
    const inv = new InvClient();
    const sent: InvOp[] = [];
    const q = new OpQueue(inv, (op) => { sent.push(op); return true; });
    return { inv, sent, q };
  };
  const ops: InvOp[] = [{ op: 'look', slot: 'head', look: 7 }, { op: 'look', slot: 'chest', look: 8 }, { op: 'hide', slot: 'back', hide: false }];
  it('sends one, the next on each answer, each with a fresh id', () => {
    const { inv, sent, q } = fake();
    q.push(ops, 0);
    expect(sent).toHaveLength(1);
    expect(q.busy).toBe(true);
    inv.onInventory({ bag: [], bank: [], gold: 0, seals: 0, stats: {}, gear: {}, wardrobe: [], sets: [], freeRespec: true }); q.answered(10);
    inv.onInventory({ bag: [], bank: [], gold: 0, seals: 0, stats: {}, gear: {}, wardrobe: [], sets: [], freeRespec: true }); q.answered(20);
    expect(sent.map(opKey)).toEqual(ops.map(opKey));
    const ids = sent.map((o) => o.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{16}$/);
    q.answered(30);
    expect(q.busy).toBe(false);
  });
  it('a double tap adds nothing: the same ops are not queued twice, nor sent twice', () => {
    const { sent, q } = fake();
    q.push(ops, 0); q.push(ops, 1);
    expect(q.left).toBe(3);
    q.answered(5); q.answered(6); q.answered(7); q.answered(8);
    expect(sent).toHaveLength(3);
  });
  it('a refusal drops the rest', () => {
    const { sent, q } = fake();
    q.push(ops, 0);
    q.refused();
    q.answered(50);
    expect(sent).toHaveLength(1);
    expect(q.busy).toBe(false);
  });
  it('an answer that never comes lets the next go after the gate time', () => {
    const { sent, q } = fake();
    q.push(ops, 0);
    q.tick(OP_GATE_MS - 1);
    expect(sent).toHaveLength(1);
    q.tick(OP_GATE_MS + 1);
    expect(sent).toHaveLength(2);
  });
  it('an op already with the server (a single tap) is skipped, not sent twice', () => {
    const { inv, sent, q } = fake();
    expect(inv.begin(ops[0]!, 0)).not.toBeNull();
    q.push(ops, 1);
    expect(sent.map(opKey)).toEqual([opKey(ops[1]!)]);
  });
  it('nothing goes when sending fails (no room): the gate is taken back', () => {
    const inv = new InvClient();
    const q = new OpQueue(inv, () => false);
    q.push(ops, 0);
    expect(q.busy).toBe(false);
    expect(inv.pendingKeys().size).toBe(0);
  });
});

describe('appearance never changes a stat', () => {
  /** The sheet without its appearance parts (the looks, and the pre-wardrobe costume list): stats, slots, comparisons, sets, bag. */
  const statPart = (st: ReturnType<typeof server>) => { const { look: _l, wardrobe: _w, ...rest } = lookSheetView(st.view(), st.ctx()); return rest; };
  it('the stat panel and every comparison are identical with and without overrides, hides, dyes and outfits', () => {
    const st = dressed();
    for (const id of ['cinderstep_chest', 'wickthread_head']) st.give(id);
    const plain = statPart(st);
    st.apply({ op: 'look', slot: 'chest', look: model('mossweave_chest') });
    st.apply({ op: 'look', slot: 'head', look: COSTUME_PIECES.straw_sunhat_head!.model });
    st.apply({ op: 'hide', slot: 'back', hide: true });
    st.apply({ op: 'dyeSlot', slot: 'legs', ch: 1, dye: 12 }, TAILOR);
    st.apply({ op: 'saveOutfit', index: 0, label: 1 });
    const dressedUp = statPart(st);
    // the dye cost gold: the purse moves, nothing else
    expect({ ...dressedUp, gold: 0 }).toEqual({ ...plain, gold: 0 });
    expect(dressedUp.stats).toEqual(plain.stats);
    expect(dressedUp.slots).toEqual(plain.slots);
    expect(dressedUp.bag.map((b) => b.equip?.cmp)).toEqual(plain.bag.map((b) => b.equip?.cmp));
    expect(dressedUp.bag.some((b) => b.equip?.cmp)).toBe(true);
    expect(LOOKS[COSTUME_PIECES.straw_sunhat_head!.model]).toBeDefined();
  });
});
