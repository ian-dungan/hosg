// The gear look: what an adventurer shows per gear slot (resolved for costumes) and its compact code, sent in
// the `looks` message beside the look code. Pure; frozen tables.
import { exactKeys, fromBase64Url, isIntIn, isRecord, toBase64Url } from './lookCommon';

/** A dye id, 0..31 (0 = undyed). The same numbers as `DyeId` in items.ts. */
type Dye = number;

// ───────── the gear look ─────────

/** The eight gear slots in code order; the same names as `GearSlot` in items.ts. */
export const GEAR_LOOK_SLOTS = Object.freeze(['head', 'chest', 'legs', 'hands', 'feet', 'back', 'weapon', 'offhand'] as const);
export type GearLookSlotName = (typeof GEAR_LOOK_SLOTS)[number];
/** Item models are 0..199; costume models are 200..255. */
export const COSTUME_MODEL_MIN = 200;
const MODEL_MAX = 255;
const DYE_MAX = 31;

export interface GearLookSlot { model: number; dye: [Dye, Dye] }
/** What an adventurer shows, per slot, already resolved for costumes; null = nothing shown there. */
export type GearLook = Record<GearLookSlotName, GearLookSlot | null> & { hideHead: boolean };
/** The costumes of a job's outfit, as models and dyes. */
export interface GearLookCostumes { body?: GearLookSlot | null; head?: GearLookSlot | null; back?: GearLookSlot | null }

/** Slots a body costume covers (it shows on `chest`). */
const BODY_COVERS: readonly GearLookSlotName[] = Object.freeze(['legs', 'hands', 'feet']);

/** A copy of the slot when its model lies in [lo, hi] and both dyes are valid, else null (dropped, never thrown). */
function checkedSlot(s: unknown, lo: number, hi: number): GearLookSlot | null {
  if (!isRecord(s) || !Array.isArray(s.dye) || s.dye.length !== 2) return null;
  const [d1, d2] = s.dye as unknown[];
  if (!isIntIn(s.model, lo, hi) || !isIntIn(d1, 0, DYE_MAX) || !isIntIn(d2, 0, DYE_MAX)) return null;
  return { model: s.model, dye: [d1, d2] };
}

/**
 * The gear look from the worn items' models and dyes and the outfit's costumes: a body costume shows on
 * `chest` and hides legs, hands and feet; a head costume replaces the head piece; a back costume the back
 * piece; `hideHead` hides the head piece and the head costume. The weapon and off-hand always show.
 * Never throws, and its result always encodes: a worn piece whose model is outside the item range
 * (0..199) or whose dyes are out of range is dropped (shown as nothing), and a costume whose model is
 * outside the costume range (200..255) is ignored (the pieces under it show).
 * (gearLookOf(inv, job, outfit) is this, fed from ITEMS[*].model, COSTUMES[*].model and the inventory.)
 */
export function resolveGearLook(
  worn: Partial<Record<GearLookSlotName, GearLookSlot | null | undefined>>,
  costumes: GearLookCostumes,
  hideHead: boolean,
): GearLook {
  const w = (isRecord(worn) ? worn : {}) as Record<string, unknown>;
  const c = (isRecord(costumes) ? costumes : {}) as Record<string, unknown>;
  const out = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, checkedSlot(w[s], 0, COSTUME_MODEL_MIN - 1)])) as unknown as GearLook;
  out.hideHead = hideHead === true;
  const costume = (k: 'body' | 'head' | 'back') => checkedSlot(c[k], COSTUME_MODEL_MIN, MODEL_MAX);
  const body = costume('body');
  if (body) {
    out.chest = body;
    for (const s of BODY_COVERS) out[s] = null;
  }
  out.head = costume('head') ?? out.head;
  out.back = costume('back') ?? out.back;
  if (out.hideHead) out.head = null;
  return out;
}

const FLAG_HIDE_HEAD = 1;
const FLAG_BODY = 2;
const FLAG_HEAD = 4;
const FLAG_BACK = 8;

const isCostume = (s: GearLookSlot | null) => s !== null && s.model >= COSTUME_MODEL_MIN;

/** The flag byte for a valid gear look, or null when the look breaks a costume rule or a range. */
function gearFlags(g: GearLook): number | null {
  if (!isRecord(g) || typeof g.hideHead !== 'boolean' || !exactKeys(g, [...GEAR_LOOK_SLOTS, 'hideHead'])) return null;
  for (const s of GEAR_LOOK_SLOTS) {
    const v = g[s] as unknown;
    if (v === null) continue;
    if (!isRecord(v) || !exactKeys(v, ['model', 'dye']) || !Array.isArray(v.dye) || v.dye.length !== 2) return null;
    const ok = (x: unknown, hi: number) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= hi;
    if (!ok(v.model, MODEL_MAX) || !ok(v.dye[0], DYE_MAX) || !ok(v.dye[1], DYE_MAX)) return null;
  }
  for (const s of ['legs', 'hands', 'feet', 'weapon', 'offhand'] as const) if (isCostume(g[s])) return null;
  if (isCostume(g.chest) && BODY_COVERS.some((s) => g[s] !== null)) return null;
  if (g.hideHead && g.head !== null) return null;
  return (g.hideHead ? FLAG_HIDE_HEAD : 0) | (isCostume(g.chest) ? FLAG_BODY : 0) | (isCostume(g.head) ? FLAG_HEAD : 0) | (isCostume(g.back) ? FLAG_BACK : 0);
}

/**
 * The gear look's code: a byte of which slots show, a costume flag byte (hidden head, body, head and back
 * costumes), then per shown slot in GEAR_LOOK_SLOTS order the model (8 bits) and two dyes (5 bits each),
 * bit-packed and base64url without padding: at most 20 bytes, 27 characters. Throws on an invalid look.
 */
export function encodeGearLook(g: GearLook): string {
  const flags = gearFlags(g);
  if (flags === null) throw new RangeError('encodeGearLook: not a valid gear look');
  const bits: number[] = [];
  const put = (v: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1);
  };
  put(GEAR_LOOK_SLOTS.reduce((m, s, i) => (g[s] ? m | (1 << i) : m), 0), 8);
  put(flags, 8);
  for (const s of GEAR_LOOK_SLOTS) {
    const v = g[s];
    if (!v) continue;
    put(v.model, 8);
    put(v.dye[0], 5);
    put(v.dye[1], 5);
  }
  while (bits.length % 8 !== 0) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return toBase64Url(bytes);
}

/**
 * The gear look a code describes, or null unless the code is exactly what an encoder writes: a v1 code as it
 * is, a v2 code (encodeGearLookV2) as its v1 view (gearLookV1View: the pre-wardrobe client draws from it).
 */
export function decodeGearLook(s: string): GearLook | null {
  if (typeof s !== 'string') return null;
  const v1 = decodeGearLookV1Only(s);
  if (v1) return v1;
  const v2 = decodeV2Bits(s);
  return v2 && gearLookV1View(v2);
}

function decodeGearLookV1Only(s: string): GearLook | null {
  if (s.length < 3 || s.length > 27) return null;
  const nBytes = Math.floor((s.length * 6) / 8);
  const bytes = fromBase64Url(s, nBytes);
  if (!bytes) return null;
  let at = 0;
  const take = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = bytes[(at + i) >> 3] ?? 0;
      v = (v << 1) | ((byte >> (7 - ((at + i) & 7))) & 1);
    }
    at += n;
    return v;
  };
  const mask = take(8);
  const flags = take(8);
  const shown = GEAR_LOOK_SLOTS.filter((_, i) => mask & (1 << i)).length;
  if (nBytes !== Math.ceil((16 + shown * 18) / 8)) return null;
  const out = { hideHead: (flags & FLAG_HIDE_HEAD) !== 0 } as GearLook;
  GEAR_LOOK_SLOTS.forEach((slot, i) => {
    out[slot] = mask & (1 << i) ? { model: take(8), dye: [take(5), take(5)] } : null;
  });
  // Strict: the look must be valid, carry exactly its own flags, and re-encode to the same characters.
  if (gearFlags(out) !== flags) return null;
  return encodeGearLook(out) === s ? out : null;
}

// ───────── the gear look v2 (the wardrobe) ─────────
// Per slot: the look shown (any look id 0..255: an item's model, or a costume piece's 200..255 in an armour
// slot) and three dye channels (primary, secondary, trim); the head, back and off-hand may be hidden; and
// whether the head look hides the job's silhouette cue (data only: the client decides how to draw it).

/** Slots that may be hidden (the off-hand: sheathed). */
export const HIDEABLE_SLOTS = Object.freeze(['head', 'back', 'offhand'] as const);
export type HideableSlot = (typeof HIDEABLE_SLOTS)[number];
export interface GearLookSlotV2 { model: number; dye: [Dye, Dye, Dye] }
export type GearLookV2 = Record<GearLookSlotName, GearLookSlotV2 | null> & { hidden: Record<HideableSlot, boolean>; cueHidden: boolean };

const V2_FLAG = 0x80;
const HIDE_BIT: Readonly<Record<HideableSlot, number>> = Object.freeze({ head: 1, back: 2, offhand: 4 });
const CUE_BIT = 8;
const ARMOUR_LOOK_SLOTS: readonly GearLookSlotName[] = Object.freeze(['head', 'chest', 'legs', 'hands', 'feet', 'back']);

/** The flag byte for a valid v2 gear look, or null (a range, a costume look in the weapon or off-hand, a hidden slot shown, bad keys). */
function gearFlagsV2(g: GearLookV2): number | null {
  if (!isRecord(g) || !exactKeys(g, [...GEAR_LOOK_SLOTS, 'hidden', 'cueHidden']) || typeof g.cueHidden !== 'boolean') return null;
  if (!isRecord(g.hidden) || !exactKeys(g.hidden, HIDEABLE_SLOTS) || HIDEABLE_SLOTS.some(s => typeof g.hidden[s] !== 'boolean')) return null;
  for (const s of GEAR_LOOK_SLOTS) {
    const v = g[s] as unknown;
    if (v === null) continue;
    if (!isRecord(v) || !exactKeys(v, ['model', 'dye']) || !Array.isArray(v.dye) || v.dye.length !== 3) return null;
    if (!isIntIn(v.model, 0, MODEL_MAX) || !v.dye.every(d => isIntIn(d, 0, DYE_MAX))) return null;
    if (v.model >= COSTUME_MODEL_MIN && !ARMOUR_LOOK_SLOTS.includes(s)) return null;
  }
  let flags = V2_FLAG | (g.cueHidden ? CUE_BIT : 0);
  for (const s of HIDEABLE_SLOTS) {
    if (g.hidden[s] && g[s] !== null) return null;
    if (g.hidden[s]) flags |= HIDE_BIT[s];
  }
  return flags;
}

/**
 * The v2 gear code: a byte of which slots show, a flag byte (bit 7 set: v2; hidden head, back, off-hand; the
 * cue hidden), then per shown slot in GEAR_LOOK_SLOTS order the look id (8 bits) and three dyes (5 bits each),
 * bit-packed, base64url without padding: at most 2 + 23 = 25 bytes, 34 characters. Throws on an invalid look.
 */
export function encodeGearLookV2(g: GearLookV2): string {
  const flags = gearFlagsV2(g);
  if (flags === null) throw new RangeError('encodeGearLookV2: not a valid gear look');
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  put(GEAR_LOOK_SLOTS.reduce((m, s, i) => (g[s] ? m | (1 << i) : m), 0), 8);
  put(flags, 8);
  for (const s of GEAR_LOOK_SLOTS) {
    const v = g[s];
    if (!v) continue;
    put(v.model, 8);
    for (const d of v.dye) put(d, 5);
  }
  while (bits.length % 8 !== 0) bits.push(0);
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return toBase64Url(bytes);
}

/** The largest v2 gear code, in characters (every slot shown). */
export const GEAR_CODE_V2_MAX_CHARS = Math.ceil((Math.ceil((16 + 8 * 23) / 8) * 8) / 6);

function decodeV2Bits(s: string): GearLookV2 | null {
  if (s.length < 3 || s.length > GEAR_CODE_V2_MAX_CHARS) return null;
  const nBytes = Math.floor((s.length * 6) / 8);
  const bytes = fromBase64Url(s, nBytes);
  if (!bytes) return null;
  let at = 0;
  const take = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | (((bytes[(at + i) >> 3] ?? 0) >> (7 - ((at + i) & 7))) & 1);
    at += n;
    return v;
  };
  const mask = take(8);
  const flags = take(8);
  if (!(flags & V2_FLAG)) return null;
  const shown = GEAR_LOOK_SLOTS.filter((_, i) => mask & (1 << i)).length;
  if (nBytes !== Math.ceil((16 + shown * 23) / 8)) return null;
  const out = {
    hidden: { head: (flags & HIDE_BIT.head) !== 0, back: (flags & HIDE_BIT.back) !== 0, offhand: (flags & HIDE_BIT.offhand) !== 0 },
    cueHidden: (flags & CUE_BIT) !== 0,
  } as GearLookV2;
  GEAR_LOOK_SLOTS.forEach((slot, i) => { out[slot] = mask & (1 << i) ? { model: take(8), dye: [take(5), take(5), take(5)] } : null; });
  if (gearFlagsV2(out) !== flags) return null;
  return encodeGearLookV2(out) === s ? out : null;
}

/** A v1 gear look as v2: the same models, dyes [primary, secondary, 0], hideHead as the hidden head, nothing else hidden. */
export function upgradeGearLook(g: GearLook): GearLookV2 {
  const out = { hidden: { head: g.hideHead, back: false, offhand: false }, cueHidden: false } as GearLookV2;
  for (const s of GEAR_LOOK_SLOTS) { const v = g[s]; out[s] = v ? { model: v.model, dye: [v.dye[0], v.dye[1], 0] } : null; }
  return out;
}

/** The costume models a pre-wardrobe client draws as a whole body costume on the chest (the body costumes' models). */
const BODY_COSTUME_MODELS = Object.freeze(new Set([200, 201, 202, 203, 204, 205, 212]));

/**
 * A v2 gear look as a valid v1 gear look, for the pre-wardrobe client: two dyes; a hidden back or off-hand
 * shows nothing; a costume piece in the legs, hands or feet shows nothing (v1 cannot draw one there); a body
 * costume's top on the chest covers legs, hands and feet as the v1 body costume did.
 */
export function gearLookV1View(g: GearLookV2): GearLook {
  const out = { hideHead: g.hidden.head } as GearLook;
  for (const s of GEAR_LOOK_SLOTS) {
    const v = g[s];
    const costume = v !== null && v.model >= COSTUME_MODEL_MIN;
    const ok = v !== null && (!costume || s === 'chest' || s === 'head' || s === 'back');
    out[s] = ok ? { model: v!.model, dye: [v!.dye[0], v!.dye[1]] } : null;
  }
  if (out.chest && out.chest.model >= COSTUME_MODEL_MIN) {
    if (!BODY_COSTUME_MODELS.has(out.chest.model)) out.chest = null; // a lone top v1 cannot draw without its body
    else for (const s of BODY_COVERS) out[s] = null;
  }
  if (out.hideHead) out.head = null;
  return out;
}

/** The v2 gear look a code describes (a v1 code is decoded and upgraded), or null unless the code is exactly what an encoder writes. */
export function decodeGearLookV2(s: string): GearLookV2 | null {
  if (typeof s !== 'string') return null;
  const v1 = decodeGearLookV1Only(s);
  return v1 ? upgradeGearLook(v1) : decodeV2Bits(s);
}
