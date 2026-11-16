// The wardrobe: look ids per piece, the collection (unlocked forever), per-slot looks with three dyes and hiding,
// costume pieces, the v2 gear code; and that no appearance choice changes a stat.
import { describe, expect, it } from 'vitest';
import { JOB_IDS, newJobsSave, recordFor, type JobId, type JobsSave } from './combat/jobs';
import {
  COSTUMES, COSTUME_IDS, COSTUME_PIECES, COSTUME_PIECE_IDS, piecesOf, type CostumeId,
} from './costumes';
import {
  GEAR_CODE_V2_MAX_CHARS, GEAR_LOOK_SLOTS, HIDEABLE_SLOTS, decodeGearLook, decodeGearLookV2, encodeGearLook, encodeGearLookV2, gearLookV1View,
  resolveGearLook, upgradeGearLook, type GearLookV2,
} from './gearLook';
import {
  DYE_PRICE, OPS_NEEDING_ID, addLoot, applyInvOp as applyInvOpRaw, gearLookOf, gearLookV2Of, inventoryView, newInventory, parseInvOp, parseInventory,
  type InvCtx, type InvOp, type InvState, type InventorySave,
} from './inventory';
import { ARMOUR_SLOTS, GEAR_SLOTS, ITEMS, ITEM_IDS, kitItems, type GearSlot, type ItemId } from './items';
import { kitFor } from './kit';
import { totalTo } from './progression';
import {
  EMPTY_COLLECTION, LOOKS, LOOK_IDS, appearanceFromOutfit, collectionHas, collectionIds, collectionWith, lookFits, outfitFromAppearance, parseCollection,
} from './wardrobe';
import { prng } from './world/recipe';

let opSeq = 0;
const applyInvOp = (s: InvState, op: InvOp, ctx: InvCtx) =>
  applyInvOpRaw(s, op.id === undefined && OPS_NEEDING_ID.includes(op.op) ? { ...op, id: `wardrobe-op-${String(++opSeq).padStart(6, '0')}` } : op, ctx);
const CTX: InvCtx = { stall: null, jobSwitch: false, townBoard: false, inCombat: false, dead: false, busy: false };
const at = (stall: InvCtx['stall'], more: Partial<InvCtx> = {}): InvCtx => ({ ...CTX, stall, ...more });
const jobsAt = (job: JobId, level = 10): JobsSave => {
  const j = newJobsSave(job);
  j.jobs[job] = { ...j.jobs[job]!, xp: totalTo(level), level };
  return j;
};
const state = (over: Partial<InvState> = {}): InvState => ({ inv: newInventory([3, 7]), gold: 5000, seals: 30, jobs: jobsAt('warrior'), ...over });
const ok = (r: ReturnType<typeof applyInvOp>) => {
  if ('refusal' in r) throw new Error(`refused: ${r.refusal}`);
  return r;
};
const refusal = (r: ReturnType<typeof applyInvOp>) => ('refusal' in r ? r.refusal : null);
const withItem = (s: InvState, item: ItemId): InvState => addLoot(s, item, 0, `k-${item}-${s.inv.nextUid}`).state;
const model = (item: ItemId) => ITEMS[item]!.model;
const uidOf = (inv: InventorySave, item: ItemId) => inv.bag.find(i => i.item === item)!.uid;

describe('look ids', () => {
  it('every item and every costume piece has its own look id; each slot has as many looks as items and pieces', () => {
    expect(LOOK_IDS.length).toBe(ITEM_IDS.length + COSTUME_PIECE_IDS.length);
    expect(new Set(LOOK_IDS).size).toBe(LOOK_IDS.length);
    for (const id of ITEM_IDS) expect(LOOKS[ITEMS[id]!.model]!.source, id).toBe(id);
    for (const id of COSTUME_PIECE_IDS) expect(LOOKS[COSTUME_PIECES[id]!.model]!.source, id).toBe(id);
    for (const s of GEAR_SLOTS) {
      const items = ITEM_IDS.filter(i => ITEMS[i]!.slot === s).length;
      const pieces = COSTUME_PIECE_IDS.filter(p => COSTUME_PIECES[p]!.slot === s).length;
      const looks = LOOK_IDS.filter(id => LOOKS[id]!.slot === s);
      expect(new Set(looks).size, s).toBeGreaterThanOrEqual(items + pieces);
    }
    for (const id of LOOK_IDS) expect(id).toBeLessThanOrEqual(255);
    for (const id of COSTUME_PIECE_IDS) expect(COSTUME_PIECES[id]!.model).toBeGreaterThanOrEqual(200);
    expect(Object.isFrozen(LOOKS) && Object.isFrozen(COSTUME_PIECES)).toBe(true);
    // only heavy helms hide the silhouette cue
    expect(LOOK_IDS.filter(id => LOOKS[id]!.hidesCue).every(id => LOOKS[id]!.slot === 'head' && LOOKS[id]!.type === 'heavy')).toBe(true);
    expect(LOOK_IDS.some(id => LOOKS[id]!.hidesCue)).toBe(true);
  });

  it('costumes split into pieces: a body costume is chest, legs, hands and feet (prices summing to the old price), the chest keeps the model', () => {
    for (const c of COSTUME_IDS) {
      const d = COSTUMES[c];
      const ps = piecesOf(c);
      if (d.slot === 'body') {
        expect(ps.map(p => p.slot), c).toEqual(['chest', 'legs', 'hands', 'feet']);
        expect(ps[0]!.model).toBe(d.model);
      } else {
        expect(ps.map(p => p.slot), c).toEqual([d.slot]);
        expect(ps[0]!.model).toBe(d.model);
      }
      if (d.price === null) expect(ps.every(p => p.price === null)).toBe(true);
      else expect(ps.reduce((n, p) => n + p.price!, 0), c).toBe(d.price);
      for (const p of ps) if (p.price !== null) expect(Number.isInteger(p.price) && p.price > 0).toBe(true);
    }
    expect(COSTUME_PIECES.lamplighter_coat_chest!.price).toBe(160);
    expect(piecesOf('lamplighter_coat').map(p => p.price)).toEqual([160, 100, 60, 80]);
  });

  it('lookFits: armour looks cross armour types within a slot, weapons keep their weapon type, off-hands their kind, costume pieces their slot', () => {
    expect(lookFits(model('rootbound_chest'), 'chest', 'mossweave_chest')).toBe(true);
    expect(lookFits(model('rootbound_chest'), 'legs', 'mossweave_legs')).toBe(false);
    expect(lookFits(model('hedgecutter'), 'weapon', 'grove_blade')).toBe(true);
    expect(lookFits(model('ashwood_longbow'), 'weapon', 'grove_blade')).toBe(false);
    expect(lookFits(model('herbal_tome'), 'offhand', 'grove_buckler')).toBe(false);
    expect(lookFits(model('hedge_buckler'), 'offhand', 'grove_buckler')).toBe(true);
    expect(lookFits(COSTUME_PIECES.lamplighter_coat_hands!.model, 'hands', 'plain_hands')).toBe(true);
    expect(lookFits(COSTUME_PIECES.lamplighter_coat_hands!.model, 'feet', 'plain_feet')).toBe(false);
    expect(lookFits(COSTUME_PIECES.straw_sunhat_head!.model, 'weapon', 'grove_blade')).toBe(false);
    expect(lookFits(model('hedgecutter'), 'weapon', null)).toBe(false);
    expect(lookFits(250, 'chest', 'plain_chest')).toBe(false); // not a look
  });
});

describe('the collection', () => {
  it('a bit per look id: set, test, list; canonical; garbage is empty', () => {
    const c = collectionWith(EMPTY_COLLECTION, [1, 64, 200, 230, 999, -1, 63]);
    expect(c.length).toBe(43);
    expect(collectionIds(c)).toEqual([1, 64, 200, 230].filter(id => LOOKS[id]).concat().sort((a, b) => a - b));
    expect(collectionHas(c, 64)).toBe(true);
    expect(collectionHas(c, 65)).toBe(false);
    expect(parseCollection(c)).toBe(c);
    for (const junk of [null, 7, 'x', '_'.repeat(43), '_'.repeat(44)]) expect(collectionIds(parseCollection(junk)).every(id => LOOKS[id])).toBe(true);
    expect(parseCollection(null)).toBe(EMPTY_COLLECTION);
  });

  it('a new adventurer has the starter looks; loot, purchases and costumes unlock theirs for good, even once sold', () => {
    let s = state();
    const starters = new Set(newInventory([0, 0]).bag.map(i => ITEMS[i.item]!.model));
    expect(new Set(collectionIds(s.inv.looks))).toEqual(starters);
    s = withItem(s, 'hedgecutter');
    expect(collectionHas(s.inv.looks, model('hedgecutter'))).toBe(true);
    s = ok(applyInvOp(s, { op: 'sell', uid: uidOf(s.inv, 'hedgecutter') }, at('smithy'))).state;
    expect(s.inv.bag.some(i => i.item === 'hedgecutter')).toBe(false);
    expect(collectionHas(s.inv.looks, model('hedgecutter'))).toBe(true);
    s = ok(applyInvOp(s, { op: 'buy', stall: 'smithy', item: 'mossweave_head' }, at('smithy'))).state;
    expect(collectionHas(s.inv.looks, model('mossweave_head'))).toBe(true);
    s = ok(applyInvOp(s, { op: 'buyCostume', costume: 'lamplighter_coat' }, at('tailor'))).state;
    for (const p of piecesOf('lamplighter_coat')) expect(collectionHas(s.inv.looks, p.model)).toBe(true);
    expect(parseInventory(s.inv).repaired).toBe(false);
  });

  it('back-fills a pre-wardrobe inventory from its bag, Vault and costumes, once (idempotent)', () => {
    const s = withItem(withItem(state(), 'rowan_staff'), 'brassbound_head');
    const old = JSON.parse(JSON.stringify(s.inv)) as Record<string, unknown>;
    delete old.looks;
    delete old.appearance;
    (old as { wardrobe: CostumeId[] }).wardrobe = ['orchard_smock', 'straw_sunhat'];
    (old as { bank: unknown[] }).bank = [{ uid: 900, item: 'beacon_shield', dye: [0, 0] }];
    const first = parseInventory(old);
    expect(first.repaired).toBe(true);
    for (const m of [model('rowan_staff'), model('brassbound_head'), model('beacon_shield'), ...piecesOf('orchard_smock').map(p => p.model), COSTUME_PIECES.straw_sunhat_head!.model]) {
      expect(collectionHas(first.inv.looks, m), String(m)).toBe(true);
    }
    expect(first.inv.wardrobe).toEqual(['orchard_smock', 'straw_sunhat']);
    const again = parseInventory(JSON.parse(JSON.stringify(first.inv)));
    expect(again.repaired).toBe(false);
    expect(again.inv).toEqual(first.inv);
  });
});

describe('per-slot looks, dyes and hiding', () => {
  it('shows any unlocked look that fits the slot; refuses a locked one, one that does not fit, and a hide where hiding makes no sense', () => {
    let s = withItem(withItem(withItem(state(), 'rootbound_chest'), 'hedgecutter'), 'ashwood_longbow');
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'chest', look: model('brassbound_chest') }, CTX))).toBe('locked');
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'legs', look: model('rootbound_chest') }, CTX))).toBe('fit');
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'weapon', look: model('ashwood_longbow') }, CTX))).toBe('fit'); // a Warrior's blade
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'chest', look: 999 } as never, CTX))).toBe('unknown');
    expect(refusal(applyInvOp(s, { op: 'hide', slot: 'chest', hide: true } as never, CTX))).toBe('unknown');
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'chest', look: model('rootbound_chest') }, at(null, { inCombat: true })))).toBe('combat');
    s = ok(applyInvOp(s, { op: 'look', slot: 'chest', look: model('rootbound_chest') }, CTX)).state; // anywhere out of combat, free
    s = ok(applyInvOp(s, { op: 'look', slot: 'weapon', look: model('hedgecutter') }, CTX)).state;
    s = ok(applyInvOp(s, { op: 'hide', slot: 'head', hide: true }, CTX)).state;
    s = ok(applyInvOp(s, { op: 'hide', slot: 'back', hide: true }, CTX)).state;
    expect(s.gold).toBe(5000);
    const g = gearLookV2Of(s.inv, 'warrior', recordFor(s.jobs, 'warrior').outfit);
    expect(g.chest!.model).toBe(model('rootbound_chest'));
    expect(g.weapon!.model).toBe(model('hedgecutter'));
    expect([g.head, g.back, g.hidden]).toEqual([null, null, { head: true, back: true, offhand: false }]);
    // the real item is still worn: the stats are the plain kit's
    expect(inventoryView(s).stats).toEqual(inventoryView(state()).stats);
    // the old outfit view follows (an older client): the hidden head
    expect(recordFor(s.jobs, 'warrior').outfit).toEqual({ body: null, head: null, back: null, hideHead: true });
    // back to the worn piece's own look
    s = ok(applyInvOp(s, { op: 'look', slot: 'chest', look: null }, CTX)).state;
    expect(gearLookV2Of(s.inv, 'warrior', null).chest!.model).toBe(model('plain_chest'));
    expect(parseInventory(s.inv).repaired).toBe(false);
  });

  it('three dye channels per slot at the Tailor, 5 gold a change; the same dye is free; the piece keeps its look', () => {
    let s = state();
    expect(refusal(applyInvOp(s, { op: 'dyeSlot', slot: 'chest', ch: 2, dye: 9 }, CTX))).toBe('where');
    expect(refusal(applyInvOp(s, { op: 'dyeSlot', slot: 'chest', ch: 3, dye: 9 } as never, at('tailor')))).toBe('unknown');
    s = ok(applyInvOp(s, { op: 'dyeSlot', slot: 'chest', ch: 2, dye: 9 }, at('tailor'))).state;
    expect(s.gold).toBe(5000 - DYE_PRICE);
    // the other channels start from the piece's own dyes (the starter kit's 3 and 7)
    expect(gearLookV2Of(s.inv, 'warrior', null).chest!.dye).toEqual([3, 7, 9]);
    const same = ok(applyInvOp(s, { op: 'dyeSlot', slot: 'chest', ch: 0, dye: 3 }, at('tailor')));
    expect(same.dGold).toBe(0);
    s = ok(applyInvOp(s, { op: 'dyeSlot', slot: 'chest', ch: 0, dye: 31 }, at('tailor'))).state;
    expect(gearLookV2Of(s.inv, 'warrior', null).chest!.dye).toEqual([31, 7, 9]);
    expect(s.gold).toBe(5000 - 2 * DYE_PRICE);
    expect(refusal(applyInvOp({ ...s, gold: 4 }, { op: 'dyeSlot', slot: 'legs', ch: 1, dye: 2 }, at('tailor')))).toBe('gold');
  });

  it('costume pieces mix freely with gear looks; pieces are bought alone or whole; the legacy wear op still dresses the whole costume', () => {
    let s = state();
    expect(refusal(applyInvOp(s, { op: 'look', slot: 'hands', look: COSTUME_PIECES.lamplighter_coat_hands!.model }, CTX))).toBe('locked');
    s = ok(applyInvOp(s, { op: 'buyCostume', costume: 'lamplighter_coat_hands' }, at('tailor'))).state;
    expect(s.gold).toBe(5000 - 60);
    expect(s.inv.wardrobe).toEqual([]); // not the whole costume yet
    s = ok(applyInvOp(s, { op: 'look', slot: 'hands', look: COSTUME_PIECES.lamplighter_coat_hands!.model }, CTX)).state;
    expect(refusal(applyInvOp(s, { op: 'buyCostume', costume: 'lamplighter_coat_hands' }, at('tailor')))).toBe('owned');
    // the rest of the coat: the price of the pieces not yet owned
    s = ok(applyInvOp(s, { op: 'buyCostume', costume: 'lamplighter_coat' }, at('tailor'))).state;
    expect(s.gold).toBe(5000 - 400);
    expect(s.inv.wardrobe).toEqual(['lamplighter_coat']);
    expect(refusal(applyInvOp(s, { op: 'buyCostume', costume: 'starfall_regalia_chest' }, at('tailor')))).toBe('unknown'); // event only
    s = ok(applyInvOp(s, { op: 'buyCostume', costume: 'straw_sunhat' }, at('tailor'))).state;
    // a costume top with real trousers, a costume hat, real boots
    s = ok(applyInvOp(s, { op: 'look', slot: 'chest', look: COSTUMES.lamplighter_coat.model }, CTX)).state;
    s = ok(applyInvOp(s, { op: 'look', slot: 'head', look: COSTUMES.straw_sunhat.model }, CTX)).state;
    const g = gearLookV2Of(s.inv, 'warrior', recordFor(s.jobs, 'warrior').outfit);
    expect([g.chest!.model, g.legs!.model, g.hands!.model, g.feet!.model, g.head!.model]).toEqual([
      COSTUMES.lamplighter_coat.model, model('plain_legs'), COSTUME_PIECES.lamplighter_coat_hands!.model, model('plain_feet'), COSTUMES.straw_sunhat.model,
    ]);
    // the legacy op: the whole body costume on chest, legs, hands and feet
    s = ok(applyInvOp(s, { op: 'wear', slot: 'body', costume: 'lamplighter_coat' }, CTX)).state;
    const w = gearLookV2Of(s.inv, 'warrior', recordFor(s.jobs, 'warrior').outfit);
    expect([w.chest!.model, w.legs!.model, w.hands!.model, w.feet!.model]).toEqual(piecesOf('lamplighter_coat').map(p => p.model));
    expect(recordFor(s.jobs, 'warrior').outfit).toEqual({ body: 'lamplighter_coat', head: 'straw_sunhat', back: null, hideHead: false });
    expect(inventoryView(s).stats).toEqual(inventoryView(state()).stats);
  });

  it('a pre-wardrobe outfit reads as its pieces, and gearLookOf (the v1 view) is what it was', () => {
    const o = { body: 'orchard_smock' as CostumeId, head: 'brass_goggles' as CostumeId, back: null, hideHead: false };
    const a = appearanceFromOutfit(o);
    expect(Object.keys(a).sort()).toEqual(['chest', 'feet', 'hands', 'head', 'legs']);
    expect(outfitFromAppearance(a)).toEqual(o);
    let s = state();
    for (const c of ['orchard_smock', 'brass_goggles'] as const) s = ok(applyInvOp(s, { op: 'buyCostume', costume: c }, at('tailor'))).state;
    const v1 = gearLookOf(s.inv, 'warrior', o);
    expect(v1.chest!.model).toBe(COSTUMES.orchard_smock.model);
    expect([v1.legs, v1.hands, v1.feet]).toEqual([null, null, null]);
    expect(v1.head!.model).toBe(COSTUMES.brass_goggles.model);
    expect(() => encodeGearLook(v1)).not.toThrow();
  });

  it('no appearance choice ever changes kitFor: 300 random sequences of look, hide, dye and costume operations', () => {
    const rng = prng(13);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
    for (let n = 0; n < 300; n++) {
      const job = pick(JOB_IDS);
      let s: InvState = { ...state({ jobs: jobsAt(job) }) };
      for (const it of Object.values(kitItems(pick([1, 2, 3] as const), job))) if (it) s = withItem(s, it);
      const statsBefore = inventoryView(s).stats;
      const kitBefore = JSON.stringify(kitFor({ job, level: 10, gear: {}, talents: [] }));
      for (let k = 0; k < 12; k++) {
        const slot = pick(GEAR_SLOTS);
        const op: InvOp = pick<InvOp>([
          { op: 'look', slot, look: pick([null, ...LOOK_IDS]) },
          { op: 'hide', slot: pick(HIDEABLE_SLOTS), hide: rng() < 0.5 },
          { op: 'dyeSlot', slot, ch: pick([0, 1, 2] as const), dye: Math.floor(rng() * 32) },
          { op: 'buyCostume', costume: pick(COSTUME_PIECE_IDS) },
        ]);
        const r = applyInvOp(s, op, at(pick(['tailor', null] as const)));
        if (!('refusal' in r)) s = r.state;
      }
      expect(inventoryView(s).stats).toEqual(statsBefore);
      expect(JSON.stringify(kitFor({ job, level: 10, gear: {}, talents: [] }))).toBe(kitBefore);
      expect(parseInventory(s.inv).repaired).toBe(false);
      expect(() => encodeGearLookV2(gearLookV2Of(s.inv, job, recordFor(s.jobs, job).outfit))).not.toThrow();
    }
  });

  it('parses the new operations strictly', () => {
    expect(parseInvOp({ op: 'look', slot: 'chest', look: 5 })).toEqual({ op: 'look', slot: 'chest', look: 5 });
    expect(parseInvOp({ op: 'look', slot: 'chest', look: null })).not.toBeNull();
    expect(parseInvOp({ op: 'dyeSlot', slot: 'feet', ch: 2, dye: 31 })).not.toBeNull();
    expect(parseInvOp({ op: 'hide', slot: 'offhand', hide: false })).not.toBeNull();
    for (const bad of [
      { op: 'look', slot: 'chest', look: 256 }, { op: 'look', slot: 'chest', look: 1.5 }, { op: 'look', slot: 'arm', look: 1 }, { op: 'look', slot: 'chest' },
      { op: 'hide', slot: 'legs', hide: true }, { op: 'hide', slot: 'head', hide: 1 }, { op: 'dyeSlot', slot: 'feet', ch: 3, dye: 1 }, { op: 'dyeSlot', slot: 'feet', ch: 0, dye: 32 },
      { op: 'look', slot: 'chest', look: 1, extra: 1 },
    ]) expect(parseInvOp(bad), JSON.stringify(bad)).toBeNull();
  });

  it('the view carries the collection and the current job appearance', () => {
    let s = withItem(state(), 'rootbound_chest');
    s = ok(applyInvOp(s, { op: 'look', slot: 'chest', look: model('rootbound_chest') }, CTX)).state;
    const v = inventoryView(s);
    expect(v.looks).toEqual(collectionIds(s.inv.looks));
    expect(v.appearance.chest).toEqual({ look: model('rootbound_chest'), dyes: null, hide: false });
    expect(v.appearance.legs).toEqual({ look: null, dyes: null, hide: false });
  });
});

describe('the gear code v2', () => {
  const rngLook = (rng: () => number): GearLookV2 => {
    const out = { hidden: { head: false, back: false, offhand: false }, cueHidden: rng() < 0.3 } as GearLookV2;
    for (const s of GEAR_LOOK_SLOTS) {
      const hideable = (HIDEABLE_SLOTS as readonly string[]).includes(s);
      if (hideable && rng() < 0.2) { out.hidden[s as 'head'] = true; out[s] = null; continue; }
      const armour = (ARMOUR_SLOTS as readonly string[]).includes(s);
      out[s] = rng() < 0.1 ? null : { model: Math.floor(rng() * (armour ? 256 : 200)), dye: [Math.floor(rng() * 32), Math.floor(rng() * 32), Math.floor(rng() * 32)] };
    }
    return out;
  };

  it(`round-trips 2000 random gear looks in at most ${GEAR_CODE_V2_MAX_CHARS} characters; v1 codes decode upgraded; the v1 view is a valid v1 look`, () => {
    expect(GEAR_CODE_V2_MAX_CHARS).toBe(34);
    const rng = prng(17);
    for (let i = 0; i < 2000; i++) {
      const g = rngLook(rng);
      const code = encodeGearLookV2(g);
      expect(code.length).toBeLessThanOrEqual(34);
      expect(decodeGearLookV2(code)).toEqual(g);
      const v1 = decodeGearLook(code)!;
      expect(v1).toEqual(gearLookV1View(g));
      expect(decodeGearLook(encodeGearLook(v1))).toEqual(v1);
    }
    const plain = (model: number, d1 = 0, d2 = 0) => ({ model, dye: [d1, d2] as [number, number] });
    const v1 = resolveGearLook({ head: plain(10, 3, 4), chest: plain(11) }, { body: plain(201, 2, 3) }, true);
    expect(decodeGearLookV2(encodeGearLook(v1))).toEqual(upgradeGearLook(v1));
    // refused: a costume look in the weapon slot, a hidden slot shown, a fourth dye
    const g = rngLook(prng(1));
    expect(() => encodeGearLookV2({ ...g, weapon: { model: 220, dye: [0, 0, 0] } })).toThrow();
    expect(() => encodeGearLookV2({ ...g, head: { model: 1, dye: [0, 0, 0] }, hidden: { ...g.hidden, head: true } })).toThrow();
    expect(() => encodeGearLookV2({ ...g, chest: { model: 1, dye: [0, 0, 0, 0] } } as never)).toThrow();
  });

  it('is strict: one character changed decodes to what it encodes, or is refused', () => {
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const code = encodeGearLookV2(rngLook(prng(23)));
    for (let i = 0; i < code.length; i++) {
      for (const c of B) {
        const s = code.slice(0, i) + c + code.slice(i + 1);
        const g = decodeGearLookV2(s);
        if (g === null || s === code) continue;
        const v1 = decodeGearLook(s);
        expect(encodeGearLookV2(g) === s || (v1 !== null && encodeGearLook(v1) === s)).toBe(true);
      }
    }
    for (const bad of ['', 'A', '_'.repeat(40), code + 'A']) expect(decodeGearLookV2(bad)).toBeNull();
  });

  it('the cue flag: a heavy helm hides the job cue, other head looks and a hidden head do not', () => {
    let s = withItem(state({ jobs: jobsAt('paladin') }), 'rootbound_head');
    s = ok(applyInvOp(s, { op: 'look', slot: 'head', look: model('rootbound_head') }, CTX)).state;
    expect(gearLookV2Of(s.inv, 'paladin', null).cueHidden).toBe(true);
    s = ok(applyInvOp(s, { op: 'hide', slot: 'head', hide: true }, CTX)).state;
    expect(gearLookV2Of(s.inv, 'paladin', null).cueHidden).toBe(false);
    expect(gearLookV2Of(state().inv, 'warrior', null).cueHidden).toBe(false);
  });
});

void (null as unknown as GearSlot);
