// The wardrobe's data: every look id (each item's and each costume piece's own model), which slot each look
// fits, the appearance collection (one bit per look id, unlocked forever), per-slot appearance choices and how
// they relate to the pre-wardrobe job outfit. Appearance only: kitFor never reads this module, and stats always
// come from the item really worn. Pure; frozen tables. (inventory.ts applies the operations.)
import type { WeaponId } from './combat/abilities';
import { deepFreeze } from './combat/freeze';
import type { JobOutfit } from './combat/jobs';
import { COSTUMES, COSTUME_IDS, COSTUME_PIECES, COSTUME_PIECE_IDS, isDyeId, piecesOf, type CostumeId, type CostumePieceId, type DyeId } from './costumes';
import { HIDEABLE_SLOTS, type HideableSlot } from './gearLook';
import { GEAR_SLOTS, ITEMS, ITEM_IDS, type ArmourType, type GearSlot, type ItemId, type OffhandKind, type SetId, type Tier } from './items';

// ───────── look ids ─────────

/** Look ids are 0..255: items' models 0..199, costume pieces' 200..255 (the gear code's 8 bits). */
export const LOOK_ID_MAX = 255;

export interface LookInfo {
  /** The look id (= the item's or piece's model). */
  readonly id: number;
  readonly kind: 'item' | 'costume';
  /** The item id or the costume piece id. */
  readonly source: ItemId | CostumePieceId;
  readonly name: string;
  readonly slot: GearSlot;
  readonly tier: Tier | null;
  readonly type: ArmourType | null;
  readonly set: SetId | null;
  readonly weapon: WeaponId | null;
  readonly offhand: OffhandKind | null;
  readonly costume: CostumeId | null;
  /** A head look that covers the job's silhouette cue (data only; the client decides how to draw it). */
  readonly hidesCue: boolean;
}

function buildLooks(): Record<number, LookInfo> {
  const out: Record<number, LookInfo> = {};
  const add = (l: LookInfo) => {
    if (out[l.id]) throw new Error(`wardrobe.ts: look id ${l.id} is used twice (${out[l.id]!.source}, ${l.source})`);
    out[l.id] = l;
  };
  for (const id of ITEM_IDS) {
    const it = ITEMS[id]!;
    add({
      id: it.model, kind: 'item', source: id, name: it.name, slot: it.slot, tier: it.tier, type: it.type ?? null, set: it.set ?? null,
      weapon: it.weapon ?? null, offhand: it.offhand ?? null, costume: null, hidesCue: it.slot === 'head' && it.type === 'heavy',
    });
  }
  for (const id of COSTUME_PIECE_IDS) {
    const p = COSTUME_PIECES[id]!;
    add({ id: p.model, kind: 'costume', source: id, name: p.name, slot: p.slot, tier: null, type: null, set: null, weapon: null, offhand: null, costume: p.costume, hidesCue: false });
  }
  return out;
}

/** Every look, by look id. */
export const LOOKS: Readonly<Record<number, LookInfo>> = deepFreeze(buildLooks());
/** Every look id, ascending. */
export const LOOK_IDS: readonly number[] = Object.freeze(Object.keys(LOOKS).map(Number).sort((a, b) => a - b));
const isLookId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && Object.prototype.hasOwnProperty.call(LOOKS, v);

/**
 * Whether look `id` may be shown in `slot` over the item really worn there (`worn`; null: nothing is worn and
 * nothing is shown): an armour slot takes any item look of that slot (any armour type) or a costume piece of
 * that slot; the weapon slot a weapon look of the worn weapon's type; the off-hand an off-hand look of its kind.
 */
export function lookFits(id: number, slot: GearSlot, worn: ItemId | null): boolean {
  if (!isLookId(id) || worn === null || !Object.prototype.hasOwnProperty.call(ITEMS, worn)) return false;
  const l = LOOKS[id]!;
  const w = ITEMS[worn]!;
  if (l.slot !== slot || w.slot !== slot) return false;
  if (slot === 'weapon') return l.weapon !== null && l.weapon === w.weapon;
  if (slot === 'offhand') return l.offhand !== null && l.offhand === w.offhand;
  return true;
}

// ───────── the collection ─────────
// One bit per look id (bit i of byte i >> 3, most significant first), 32 bytes, kept as base64url (43 characters).

export const COLLECTION_BYTES = 32;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const toBytes = (s: string): number[] | null => {
  if (typeof s !== 'string' || s.length !== Math.ceil((COLLECTION_BYTES * 8) / 6)) return null;
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const c of s) {
    const v = B64.indexOf(c);
    if (v < 0) return null;
    acc = ((acc << 6) | v) & 0xffff;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
  }
  return out.length === COLLECTION_BYTES && (acc & ((1 << bits) - 1)) === 0 ? out : null;
};
const fromBytes = (b: readonly number[]): string => {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    const chars = [B64[(n >> 18) & 63], B64[(n >> 12) & 63], B64[(n >> 6) & 63], B64[n & 63]];
    out += chars.slice(0, Math.min(4, Math.ceil(((b.length - i) * 8) / 6))).join('');
  }
  return out;
};

/** The collection with these look ids unlocked (ids that are not looks are ignored). Never throws. */
export function collectionWith(c: string, ids: Iterable<number>): string {
  const b = toBytes(c) ?? new Array<number>(COLLECTION_BYTES).fill(0);
  for (const id of ids) if (isLookId(id)) b[id >> 3]! |= 0x80 >> (id & 7);
  // only real look ids may be set
  for (let id = 0; id <= LOOK_ID_MAX; id++) if (!isLookId(id)) b[id >> 3]! &= ~(0x80 >> (id & 7)) & 255;
  return fromBytes(b);
}
export const EMPTY_COLLECTION = collectionWith('', []);
/** A stored collection, canonical (garbage: empty; bits for ids that are not looks cleared). */
export const parseCollection = (v: unknown): string => collectionWith(typeof v === 'string' ? v : '', []);
export function collectionHas(c: string, id: number): boolean {
  const b = toBytes(c);
  return !!b && isLookId(id) && (b[id >> 3]! & (0x80 >> (id & 7))) !== 0;
}
/** The unlocked look ids, ascending. */
export const collectionIds = (c: string): number[] => LOOK_IDS.filter(id => collectionHas(c, id));
/** The look ids an item list and a list of whole costumes unlock. */
export function lookIdsOf(items: Iterable<ItemId>, costumes: Iterable<CostumeId>): number[] {
  const out: number[] = [];
  for (const i of items) if (Object.prototype.hasOwnProperty.call(ITEMS, i)) out.push(ITEMS[i]!.model);
  for (const c of costumes) if (Object.prototype.hasOwnProperty.call(COSTUMES, c)) for (const p of piecesOf(c)) out.push(p.model);
  return out;
}
/** The costumes every piece of which is unlocked, in table order. */
export const wholeCostumes = (c: string): CostumeId[] => COSTUME_IDS.filter(id => piecesOf(id).every(p => collectionHas(c, p.model)));
/** Whether any piece of the costume is unlocked. */
export const ownsAnyPiece = (c: string, id: CostumeId): boolean => piecesOf(id).some(p => collectionHas(c, p.model));

// ───────── per-slot appearance ─────────

/** One slot's appearance: the look shown (null: the worn piece's own), its three dyes (null: the piece's own), hidden (head, back, off-hand only). */
export interface SlotLook { look: number | null; dyes: [DyeId, DyeId, DyeId] | null; hide: boolean }
/** A job's appearance: only the slots that differ from the default are stored. */
export type AppearanceSave = Partial<Record<GearSlot, SlotLook>>;
export const DEFAULT_SLOT_LOOK: Readonly<SlotLook> = Object.freeze({ look: null, dyes: null, hide: false });
export const isHideable = (s: GearSlot): s is HideableSlot => (HIDEABLE_SLOTS as readonly string[]).includes(s);
const isDefault = (l: SlotLook) => l.look === null && l.dyes === null && !l.hide;

/**
 * A stored appearance, canonical: known slots, a look id (or null), three dyes (or null), hide only where a
 * slot may hide; `keep(slot, id)` says whether a look id may stay (unlocked and fitting); default slots dropped.
 */
export function parseAppearance(v: unknown, keep: (slot: GearSlot, id: number) => boolean): AppearanceSave {
  const out: AppearanceSave = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  const r = v as Record<string, unknown>;
  for (const s of GEAR_SLOTS) {
    const e = r[s];
    if (typeof e !== 'object' || e === null || Array.isArray(e)) continue;
    const x = e as Record<string, unknown>;
    const look = isLookId(x.look) && keep(s, x.look) ? x.look : null;
    const dyes = Array.isArray(x.dyes) && x.dyes.length === 3 && x.dyes.every(isDyeId) ? [x.dyes[0], x.dyes[1], x.dyes[2]] as [DyeId, DyeId, DyeId] : null;
    const l: SlotLook = { look, dyes, hide: isHideable(s) && x.hide === true };
    if (!isDefault(l)) out[s] = l;
  }
  return out;
}

export const cloneAppearance = (a: AppearanceSave): AppearanceSave =>
  Object.fromEntries(Object.entries(a).map(([k, l]) => [k, { look: l!.look, dyes: l!.dyes && [l!.dyes[0], l!.dyes[1], l!.dyes[2]], hide: l!.hide }])) as AppearanceSave;

/** `a` with slot `s` changed by `f`; a slot back at its default is dropped. */
export function withSlot(a: AppearanceSave, s: GearSlot, f: (l: SlotLook) => void): AppearanceSave {
  const out = cloneAppearance(a);
  const l: SlotLook = out[s] ? out[s]! : { look: null, dyes: null, hide: false };
  f(l);
  if (isDefault(l)) delete out[s];
  else out[s] = l;
  return out;
}

const BODY_PIECE_SLOTS: readonly GearSlot[] = Object.freeze(['chest', 'legs', 'hands', 'feet']);

/** The appearance a pre-wardrobe job outfit means: a body costume's four pieces, the head and back costume, the hidden head. */
export function appearanceFromOutfit(o: JobOutfit | null | undefined): AppearanceSave {
  let a: AppearanceSave = {};
  if (!o) return a;
  for (const c of [o.body, o.head, o.back]) {
    if (c === null || !Object.prototype.hasOwnProperty.call(COSTUMES, c)) continue;
    for (const p of piecesOf(c)) a = withSlot(a, p.slot, l => { l.look = p.model; });
  }
  if (o.hideHead) a = withSlot(a, 'head', l => { l.hide = true; });
  return a;
}

/** The pre-wardrobe job outfit closest to an appearance (what an older client reads): whole costumes only. */
export function outfitFromAppearance(a: AppearanceSave): JobOutfit | null {
  const costumeAt = (s: GearSlot): CostumeId | null => {
    const id = a[s]?.look;
    const l = id === null || id === undefined ? undefined : LOOKS[id];
    return l?.costume ?? null;
  };
  const chest = costumeAt('chest');
  const body = chest !== null && COSTUMES[chest].slot === 'body' && BODY_PIECE_SLOTS.every(s => costumeAt(s) === chest) ? chest : null;
  const head = costumeAt('head');
  const back = costumeAt('back');
  const o: JobOutfit = { body, head, back, hideHead: a.head?.hide === true };
  return o.body === null && o.head === null && o.back === null && !o.hideHead ? null : o;
}
