// Show-as (appearance over gear), pure (no DOM, no Babylon). The equipped item keeps giving the stats; per slot the
// player may show another look they have unlocked (an item's look or a costume piece), hide the head, back or
// off-hand, dye three channels, and save or wear outfits. Everything here is built from the server's `inventory`
// (`looks`, `appearance`, `outfits`) and the shared look, costume, set and dye tables: no look is ever unlocked or
// shown before the server says so, and no stat is read or changed. It also holds the op queue that sends several
// ops (show a whole set, show my equipped gear) one at a time through the op gate, under the server's rate.
import {
  COSTUMES, COSTUME_IDS, DYES, DYE_PRICE, GEAR_SLOTS, ITEMS, LOOKS, LOOK_IDS, MAX_OUTFITS, OUTFIT_LABELS, SETS, TOWN_STALLS,
  isHideable, isItemId, lookFits, piecesOf,
  type GearSlot, type InvOp, type InventoryView, type ItemId, type LookInfo, type SlotLook, type StallId,
} from '@sg2/shared';
import type { AppearanceView, DyeChannel, LookOption, OutfitRow, ShowSetOption, SlotAppearance, TailorCostume } from '../core/lookViews';
import type { CharSheetView, IconSpec, LootShow, VendorView } from '../core/gearViews';
import { OP_GATE_MS, SLOT_LABEL, opKey, TIER_COLOUR, charSheetView, itemColour, sendGated, stateBlock, vendorView, wornOf, type GearCtx, type InvClient } from './inventory';

/** Costume pieces have no tier: they read in the costume colour (the Tailor's). */
export const COSTUME_COLOUR = '#ffe2a0';
export const DYE_CHANNELS = ['Primary', 'Secondary', 'Trim'] as const;
/** The pending key the set and clear-all buttons wait on while the op queue runs. */
export const QUEUE_KEY = 'queue:looks';
/** The gate's pending keys, plus QUEUE_KEY while the queue runs (a new set only then: called on events, not per frame). */
export function withQueueKey(keys: ReadonlySet<string>, busy: boolean): ReadonlySet<string> {
  if (!busy) return keys;
  const out = new Set(keys);
  out.add(QUEUE_KEY);
  return out;
}

const DEFAULT: Readonly<SlotLook> = Object.freeze({ look: null, dyes: null, hide: false });
/** A slot's appearance in the view (an older server sends none: every slot shows its item). */
const slotLook = (v: InventoryView, s: GearSlot): SlotLook => (v.appearance as Partial<Record<GearSlot, SlotLook>> | undefined)?.[s] ?? DEFAULT;
const unlockedSet = (v: InventoryView): ReadonlySet<number> => new Set(Array.isArray(v.looks) ? v.looks : []);

/** A look's colour: its item's tier colour, or the costume colour. */
export function lookColour(l: LookInfo): string {
  return l.kind === 'item' && isItemId(l.source) ? itemColour(l.source) : COSTUME_COLOUR;
}
/** Where a look comes from, in a few words. */
export function lookSource(l: LookInfo): string {
  if (l.kind === 'costume') return l.costume ? `Costume · ${COSTUMES[l.costume].name}` : 'Costume';
  const it = isItemId(l.source) ? ITEMS[l.source] : undefined;
  if (it?.named) return 'Named weapon';
  if (l.set && l.set !== 'plain') return `${SETS[l.set].name} set`;
  return it && it.tier === 0 ? 'Starter' : 'Gear';
}
function lookIcon(l: LookInfo): IconSpec {
  if (l.kind === 'item' && isItemId(l.source)) {
    const it = ITEMS[l.source]!;
    return { slot: it.slot, type: it.type ?? null, kind: it.weapon ?? it.offhand ?? null, tier: it.tier, named: !!it.named, colour: itemColour(l.source) };
  }
  // a costume piece: its slot's silhouette in the costume colour, drawn as cloth (no armour type of its own)
  return { slot: l.slot, type: 'cloth', kind: null, tier: 2, named: false, colour: COSTUME_COLOUR };
}
const isEvent = (l: LookInfo): boolean => l.kind === 'costume' && !!l.costume && COSTUMES[l.costume].price === null;

/** The dyes shown in a slot now (the server's rule: the slot's own, else the costume's or the worn item's two, trim 0). */
function shownDyes(v: InventoryView, s: GearSlot, l: SlotLook, worn: { item: ItemId; dye: [number, number] } | undefined): [number, number, number] {
  if (l.dyes) return [l.dyes[0], l.dyes[1], l.dyes[2]];
  const info = l.look === null ? undefined : LOOKS[l.look];
  if (info?.costume) { const d = v.costumeDyes?.[info.costume] ?? [0, 0]; return [d[0] ?? 0, d[1] ?? 0, 0]; }
  return [worn?.dye?.[0] ?? 0, worn?.dye?.[1] ?? 0, 0];
}
const dyeName = (id: number): string => DYES[id]?.name ?? DYES[0]!.name;
const dyeHex = (id: number): string | null => (id > 0 && DYES[id] ? DYES[id]!.hex : null);

/** Sort: gear looks by tier (best first), then costume pieces; by name within. */
const byTier = (a: LookInfo, b: LookInfo): number =>
  (a.kind === b.kind ? 0 : a.kind === 'item' ? -1 : 1) || (b.tier ?? 0) - (a.tier ?? 0) || a.name.localeCompare(b.name);

/** Every slot's appearance, the show-a-set options, clear-all, dyes and the outfits: all from the server's view. */
export function appearanceView(v: InventoryView, c: GearCtx): AppearanceView {
  const have = unlockedSet(v);
  const worn = wornOf(v, c.job);
  const why = stateBlock(c);
  const slots: SlotAppearance[] = [];
  const clearOps: InvOp[] = [];
  let changed = 0;
  for (const s of GEAR_SLOTS) {
    const inst = worn[s];
    const l = slotLook(v, s);
    const wornId = inst ? inst.item : null;
    const ownModel = wornId ? ITEMS[wornId]!.model : -1;
    const fit = wornId ? LOOK_IDS.filter((id) => lookFits(id, s, wornId)) : [];
    const unlocked = fit.filter((id) => have.has(id) || id === ownModel);
    const shownId = l.look !== null && l.look !== ownModel && LOOKS[l.look] ? l.look : null;
    const hidden = isHideable(s) && l.hide && !!inst;
    const shownInfo = shownId !== null ? LOOKS[shownId]! : null;
    const options: LookOption[] = unlocked.filter((id) => id !== ownModel).map((id) => LOOKS[id]!).sort(byTier).map((info) => ({
      id: info.id, name: info.name, colour: lookColour(info), source: lookSource(info), kind: info.kind, event: isEvent(info), icon: lookIcon(info),
      on: !hidden && shownId === info.id,
    }));
    const showOps: InvOp[] = [];
    if (l.look !== null) showOps.push({ op: 'look', slot: s, look: null });
    if (hidden) showOps.push({ op: 'hide', slot: s as 'head' | 'back' | 'offhand', hide: false });
    if (inst) for (const op of showOps) clearOps.push(op);
    const d = shownDyes(v, s, l, inst);
    const dyes: DyeChannel[] = [0, 1, 2].map((ch) => ({ ch: ch as 0 | 1 | 2, label: DYE_CHANNELS[ch]!, dye: d[ch]!, name: dyeName(d[ch]!), hex: dyeHex(d[ch]!) }));
    const line = !inst ? null : hidden ? 'Hidden' : shownInfo ? `Shown as: ${shownInfo.name}` : null;
    if (line) changed++;
    slots.push({
      slot: s, label: SLOT_LABEL[s],
      worn: wornId ? { name: ITEMS[wornId]!.name, colour: itemColour(wornId) } : null,
      shown: shownInfo ? { id: shownInfo.id, name: shownInfo.name, colour: lookColour(shownInfo), source: lookSource(shownInfo) } : null,
      hidden, canHide: isHideable(s) && !!inst,
      options, unlocked: unlocked.length, total: fit.length,
      dyes, own: l.dyes === null,
      showOps, hideOp: isHideable(s) && inst && !hidden ? { op: 'hide', slot: s, hide: true } : null,
      line,
    });
  }
  const here = c.stall === 'tailor';
  const short = DYE_PRICE - v.gold;
  return {
    slots, why, changed, sets: showSetOptions(v, c), clearOps,
    dye: {
      here, price: DYE_PRICE, gold: v.gold,
      why: !here ? `Dye at ${TOWN_STALLS.tailor.name}, the Tailor in Shady Grove` : why ?? (short > 0 ? `Need ${short} more gold` : null),
      palette: DYES.map((x, id) => ({ id, name: x.name, hex: id === 0 ? null : x.hex })),
    },
    outfits: outfitRows(v),
    labels: OUTFIT_LABELS,
  };
}

/** The ops that show `id` in slot `s` (null: the worn piece's own), unhiding the slot first when it is hidden. */
export function showOpsFor(a: SlotAppearance, id: number | null): InvOp[] {
  const cur = a.shown?.id ?? null;
  const out: InvOp[] = [];
  if (cur !== id) out.push({ op: 'look', slot: a.slot, look: id });
  if (a.hidden) out.push({ op: 'hide', slot: a.slot as 'head' | 'back' | 'offhand', hide: false });
  return out;
}

/**
 * "Show a whole set": every set (and costume) with an unlocked piece that fits what is worn now; each gives one op
 * per slot that changes (its piece, or the worn item's own look when that very piece is worn), and shows a hidden
 * slot it dresses. Slots without an unlocked piece are left as they are.
 */
export function showSetOptions(v: InventoryView, c: GearCtx): ShowSetOption[] {
  const have = unlockedSet(v);
  const worn = wornOf(v, c.job);
  const groups = new Map<string, { name: string; colour: string; kind: 'set' | 'costume'; all: number; tier: number; bySlot: Partial<Record<GearSlot, number>> }>();
  for (const id of LOOK_IDS) {
    const l = LOOKS[id]!;
    const key = l.kind === 'costume' && l.costume ? `costume:${l.costume}` : l.set ? `set:${l.set}` : null;
    if (!key) continue;
    let g = groups.get(key);
    if (!g) {
      g = l.kind === 'costume'
        ? { name: COSTUMES[l.costume!].name, colour: COSTUME_COLOUR, kind: 'costume', all: 0, tier: -1, bySlot: {} }
        : { name: SETS[l.set!].name, colour: SETS[l.set!].tier === 0 ? TIER_COLOUR.starter : TIER_COLOUR[SETS[l.set!].tier as 1 | 2 | 3], kind: 'set', all: 0, tier: SETS[l.set!].tier, bySlot: {} };
      groups.set(key, g);
    }
    g.all++;
    const w = worn[l.slot];
    const own = w ? ITEMS[w.item]!.model === id : false;
    if ((have.has(id) || own) && w && lookFits(id, l.slot, w.item) && g.bySlot[l.slot] === undefined) g.bySlot[l.slot] = id;
  }
  const out: ShowSetOption[] = [];
  for (const [key, g] of groups) {
    const slots = GEAR_SLOTS.filter((s) => g.bySlot[s] !== undefined);
    if (!slots.length) continue;
    const ops: InvOp[] = [];
    for (const s of slots) {
      const id = g.bySlot[s]!;
      const l = slotLook(v, s);
      const own = ITEMS[worn[s]!.item]!.model === id;
      const want = own ? null : id;
      const cur = l.look !== null && l.look !== ITEMS[worn[s]!.item]!.model ? l.look : null;
      if (cur !== want) ops.push({ op: 'look', slot: s, look: want });
      if (isHideable(s) && l.hide) ops.push({ op: 'hide', slot: s, hide: false });
    }
    out.push({ key, name: g.name, colour: g.colour, kind: g.kind, pieces: slots.length, of: g.all, slots: slots.map((s) => SLOT_LABEL[s]).join(', '), ops });
  }
  // the most complete first, then the best tier (costumes after sets), then by name; the starter set last
  const tierOf = (o: ShowSetOption) => (o.kind === 'set' ? SETS[o.key.slice(4) as keyof typeof SETS].tier : 0.5);
  const starter = (o: ShowSetOption) => (o.kind === 'set' && tierOf(o) === 0 ? 1 : 0);
  return out.sort((a, b) => starter(a) - starter(b) || b.pieces - a.pieces || tierOf(b) - tierOf(a) || a.name.localeCompare(b.name));
}

/** The six outfit places of the current job (the server's `outfits`), with what each shows and whether it is worn now. */
export function outfitRows(v: InventoryView): OutfitRow[] {
  const list = Array.isArray(v.outfits) ? v.outfits : [];
  const rows: OutfitRow[] = [];
  for (let i = 0; i < MAX_OUTFITS; i++) {
    const o = list[i] ?? null;
    if (!o || typeof o.label !== 'number' || !OUTFIT_LABELS[o.label]) { rows.push({ index: i, label: null, labelIndex: null, summary: '', wearing: false }); continue; }
    const parts: string[] = [];
    let wearing = true;
    for (const s of GEAR_SLOTS) {
      const l = o.slots?.[s] ?? DEFAULT;
      const now = slotLook(v, s);
      if (l.look !== now.look || l.hide !== now.hide || String(l.dyes) !== String(now.dyes)) wearing = false;
      if (l.hide) parts.push(`${SLOT_LABEL[s]} hidden`);
      else if (l.look !== null && LOOKS[l.look]) parts.push(LOOKS[l.look]!.name);
      else if (l.dyes) parts.push(`${SLOT_LABEL[s]} dyed`);
    }
    rows.push({ index: i, label: OUTFIT_LABELS[o.label]!, labelIndex: o.label, summary: parts.length ? parts.join(' · ') : 'Your equipped gear', wearing });
  }
  return rows;
}

/** The Tailor's costumes as pieces (each slot bought on its own, or the missing ones at once), with what is owned. */
export function tailorCostumes(v: InventoryView, c: GearCtx, here: boolean): TailorCostume[] {
  const have = unlockedSet(v);
  const block = here ? stateBlock(c) : `Walk up to ${TOWN_STALLS.tailor.name} to buy`;
  return COSTUME_IDS.map((id) => {
    const d = COSTUMES[id];
    const event = d.price === null;
    const pieces = piecesOf(id).map((p) => {
      const owned = have.has(p.model);
      const short = (p.price ?? 0) - v.gold;
      const why = owned ? null : event ? 'Event only' : block ?? (short > 0 ? `Need ${short} more gold` : null);
      return { id: p.id, slot: SLOT_LABEL[p.slot], name: p.name, price: p.price, owned, ok: !owned && !event && why === null, why };
    });
    const missing = pieces.filter((p) => !p.owned);
    const missingPrice = missing.reduce((n, p) => n + (p.price ?? 0), 0);
    const short = missingPrice - v.gold;
    const why = !missing.length ? null : event ? 'Event only: given at events' : block ?? (short > 0 ? `Need ${short} more gold` : null);
    return { id, name: d.name, event, pieces, missing: missing.length, missingPrice, ok: missing.length > 0 && why === null, why };
  });
}

/** The character sheet's view with the looks (the Gear tab's rows and cards, the Wardrobe tab's outfits). */
export function lookSheetView(v: InventoryView, c: GearCtx): CharSheetView {
  return { ...charSheetView(v, c), look: appearanceView(v, c) };
}
/** A stall's view; the Tailor's also gets its costume pieces and the slot dyes. */
export function lookVendorView(stall: StallId, v: InventoryView, c: GearCtx, at: { x: number; z: number }): VendorView {
  const out = vendorView(stall, v, c, at);
  if (stall !== 'tailor') return out;
  const here = out.here;
  const cc: GearCtx = { ...c, stall: here ? 'tailor' : c.stall };
  return { ...out, pieces: tailorCostumes(v, cc, here), look: appearanceView(v, cc) };
}

/**
 * Marks the loot toast's items whose look is new: the `loot` message comes before the `inventory` that unlocks
 * it, so a drop whose model is not among the view's unlocked looks is a new look (each look once per toast).
 */
export function markNewLooks(l: LootShow | null, m: unknown, v: InventoryView | null): LootShow | null {
  if (!l || !v || !Array.isArray(v.looks)) return l;
  const items = (m as { items?: { item?: unknown }[] } | null)?.items;
  if (!Array.isArray(items)) return l;
  const have = unlockedSet(v);
  const seen = new Set<number>();
  // lootShow keeps the known items in order: walk both together
  let k = 0;
  const out = l.items.map((x) => ({ ...x }));
  for (const e of items) {
    if (!isItemId(e?.item)) continue;
    const row = out[k++];
    if (!row) break;
    const model = ITEMS[e.item]!.model;
    if (!have.has(model) && !seen.has(model)) { row.newLook = true; seen.add(model); }
  }
  return { ...l, items: out };
}

/**
 * Several ops (show a whole set, show my equipped gear, a look on a hidden slot) sent one at a time: each through
 * the op gate (a fresh id, never twice for a double tap), the next when the server answers the last (or its gate
 * runs out), so the server's rate is never hit. A refusal drops the rest (the reason holds for them too).
 */
export class OpQueue {
  private q: InvOp[] = [];
  private inFlight = false;
  private flightKey = '';
  private at = 0;
  constructor(private inv: InvClient, private send: (op: InvOp) => boolean) {}
  /** Waiting or in flight: the set buttons show a wait. */
  get busy(): boolean { return this.inFlight || this.q.length > 0; }
  get left(): number { return this.q.length + (this.inFlight ? 1 : 0); }
  push(ops: readonly InvOp[], now: number): void {
    // a second tap of the same batch adds nothing: only ops not already waiting join the queue
    for (const op of ops) { const k = opKey(op); if (!(this.inFlight && k === this.flightKey) && !this.q.some((x) => opKey(x) === k)) this.q.push(op); }
    this.pump(now);
  }
  /** The server answered (an `inventory`): the next op goes. */
  answered(now: number): void { this.inFlight = false; this.pump(now); }
  /** A refusal: the rest is dropped. */
  refused(): void { this.inFlight = false; this.q.length = 0; }
  /** Call now and then: an op whose answer never came lets the next go after the gate's time. */
  tick(now: number): void { if (this.inFlight && now - this.at > OP_GATE_MS) { this.inFlight = false; this.pump(now); } }
  clear(): void { this.q.length = 0; this.inFlight = false; }
  private pump(now: number): void {
    if (this.inFlight) return;
    while (this.q.length) {
      const op = this.q.shift()!;
      if (sendGated(this.inv, op, this.send, now)) { this.inFlight = true; this.flightKey = opKey(op); this.at = now; return; }
      // the same op is already with the server (or no room): skip it
    }
  }
}
