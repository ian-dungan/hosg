// Looks: the four peoples, an adventurer's `Look` (sliders, face, hair, free colours, fur, stance, walk and
// the starter kit's dyes), its compact code, the resolved gear look and its code, varied default looks and
// the Barber's price. Peoples differ in looks only: proportions and features, never stats.
// Pure and deterministic: integer maths, seeded generators, frozen tables.
import { cyrb53 } from './hash';
import { prng } from './world/recipe';

// ───────── peoples ─────────

export type PeopleId = 'human' | 'larchfolk' | 'knollfolk' | 'brindlekin';
/** A data hook for a later plan; not a valid `Look.people`. */
export type FuturePeopleId = 'skyfolk';

export interface PeopleData {
  id: PeopleId;
  name: string;
  /** Standing height in metres with the height slider at 10. */
  heightM: number;
  /** The height slider's reach either side of `heightM` (0.1 = ±10% at 0 and 20). */
  span: number;
  /** The largest `face.ears` value (Brindlekin have six animal ears, the others four). */
  earsMax: number;
  /** Fur instead of skin: `colours.skin` is the fur's base colour and `Look.fur` is set. */
  furred: boolean;
  /** Suggested colour ranges ('#rrggbb' to '#rrggbb'); defaults are drawn from these, any colour is allowed. */
  skinRange: readonly [string, string][];
  hairRange: readonly [string, string][];
  blurb: string;
}

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
};

export const PEOPLES: Readonly<Record<PeopleId, PeopleData>> = deepFreeze({
  human: {
    id: 'human', name: 'Humans', heightM: 1.75, span: 0.1, earsMax: 3, furred: false,
    skinRange: [['#f7e0cc', '#ebbf9c'], ['#dcaa82', '#b07a52'], ['#94603f', '#5a3624'], ['#4a2c1e', '#2f1c13']],
    hairRange: [['#1a1411', '#3e2c21'], ['#6e4427', '#a8763d'], ['#d2aa62', '#f0dca6'], ['#8c2e1b', '#c4592b'], ['#8d8a86', '#e4e2dc']],
    blurb: 'Folk of the lanes, farms and harbours: every shape and shade, and as stubborn as old oak.',
  },
  larchfolk: {
    id: 'larchfolk', name: 'Larchfolk', heightM: 1.98, span: 0.08, earsMax: 3, furred: false,
    skinRange: [['#ece2d0', '#cdb99c'], ['#bba98d', '#8e7c60'], ['#aeb79e', '#7f8c6f'], ['#8c6e57', '#5f4838']],
    hairRange: [['#2a2920', '#4e4934'], ['#cbc4aa', '#f0ecdd'], ['#6c7849', '#9ba868'], ['#7b3e25', '#a65a31'], ['#3d4a52', '#6c7d86']],
    blurb: 'Tall, long-limbed folk of the high larch woods, with long pointed ears and bark-flecked skin.',
  },
  knollfolk: {
    id: 'knollfolk', name: 'Knollfolk', heightM: 1.3, span: 0.08, earsMax: 3, furred: false,
    skinRange: [['#f4d2b6', '#e4ab8b'], ['#cb8d66', '#9b6343'], ['#7e5036', '#5b3827']],
    hairRange: [['#3b2617', '#6c4527'], ['#b6652c', '#e19149'], ['#e9c37b', '#f6e3b1'], ['#d0d0cc', '#f6f6f1']],
    blurb: 'Small, sturdy hill-dwellers with big heads, broad hands and round ears, who never get lost underground.',
  },
  brindlekin: {
    id: 'brindlekin', name: 'Brindlekin', heightM: 1.7, span: 0.1, earsMax: 5, furred: true,
    skinRange: [['#c98a4b', '#e1b17b'], ['#6c4b33', '#946a4b'], ['#dad3c5', '#f3efe7'], ['#4b4541', '#6f6963'], ['#b55b2b', '#d87b3b']],
    hairRange: [['#2b221c', '#4e3d31'], ['#f1e9db', '#fffbf1'], ['#8b5b35', '#ba8653'], ['#5b5651', '#8b8680']],
    blurb: 'Furred beast-folk with keen muzzles, animal ears, padded hands and a tail that gives their mood away.',
  },
});

export const PEOPLE_IDS: readonly PeopleId[] = Object.freeze(['human', 'larchfolk', 'knollfolk', 'brindlekin']);

const isPeopleId = (v: unknown): v is PeopleId => typeof v === 'string' && (PEOPLE_IDS as readonly string[]).includes(v);

// ───────── the look ─────────

/** A dye id, 0..31 (0 = undyed). The same numbers as `DyeId` in items.ts. */
type Dye = number;

export interface Look {
  v: 1;
  people: PeopleId;
  /** Integers 0..20; 10 is the people's average. */
  body: { height: number; build: number; shoulders: number; hips: number; legs: number; head: number };
  face: { shape: number; eyes: number; brows: number; nose: number; mouth: number; ears: number; marks: number };
  hair: { style: number; facial: number };
  /** 0xRRGGBB. For the Brindlekin, `skin` is the fur's base colour. */
  colours: { skin: number; hair: number; facial: number; eyes: number; marks: number };
  /** Brindlekin only (null for the others): the pattern, its colour and the tail. */
  fur: { pattern: number; colour: number; tail: number } | null;
  style: { stance: number; walk: number };
  /** The starter kit's two dyes. */
  outfit: { dye1: Dye; dye2: Dye };
}

const COLOUR_MAX = 0xffffff;

/** Every numeric field of a look, by path, with its inclusive range. `face.ears` is further capped by `PEOPLES[p].earsMax`. */
export const LOOK_LIMITS: { readonly [path: string]: readonly [number, number] } = deepFreeze({
  'body.height': [0, 20], 'body.build': [0, 20], 'body.shoulders': [0, 20], 'body.hips': [0, 20], 'body.legs': [0, 20], 'body.head': [0, 20],
  'face.shape': [0, 5], 'face.eyes': [0, 7], 'face.brows': [0, 7], 'face.nose': [0, 7], 'face.mouth': [0, 5], 'face.ears': [0, 5], 'face.marks': [0, 7],
  'hair.style': [0, 19], 'hair.facial': [0, 7],
  'colours.skin': [0, COLOUR_MAX], 'colours.hair': [0, COLOUR_MAX], 'colours.facial': [0, COLOUR_MAX], 'colours.eyes': [0, COLOUR_MAX], 'colours.marks': [0, COLOUR_MAX],
  'fur.pattern': [0, 3], 'fur.colour': [0, COLOUR_MAX], 'fur.tail': [0, 3],
  'style.stance': [0, 3], 'style.walk': [0, 3],
  'outfit.dye1': [0, 31], 'outfit.dye2': [0, 31],
} satisfies Record<string, [number, number]>);

/** The key order of each group, as `Look` lists them. */
const GROUPS = {
  body: ['height', 'build', 'shoulders', 'hips', 'legs', 'head'],
  face: ['shape', 'eyes', 'brows', 'nose', 'mouth', 'ears', 'marks'],
  hair: ['style', 'facial'],
  colours: ['skin', 'hair', 'facial', 'eyes', 'marks'],
  fur: ['pattern', 'colour', 'tail'],
  style: ['stance', 'walk'],
  outfit: ['dye1', 'dye2'],
} as const;
type Group = keyof typeof GROUPS;
const LOOK_KEYS = ['v', 'people', ...Object.keys(GROUPS)];

// ───────── names for the creator (index = value) ─────────

export type EmoteId = 'wave' | 'bow' | 'cheer' | 'laugh' | 'sit' | 'point';
export const EMOTES: readonly EmoteId[] = Object.freeze(['wave', 'bow', 'cheer', 'laugh', 'sit', 'point']);
export const STANCES: readonly string[] = Object.freeze(['Easy', 'Proud', 'Guarded', 'Sprightly']);
export const WALKS: readonly string[] = Object.freeze(['Stride', 'Stroll', 'Bounce', 'Prowl']);
export const FACE_SHAPES: readonly string[] = Object.freeze(['Round', 'Oval', 'Square', 'Heart', 'Long', 'Soft']);
export const FACE_MARKS: readonly string[] = Object.freeze([
  'None', 'Freckles', 'Left scar', 'Right scar', 'Cheek bands', 'Beauty mark', 'Dot tattoos', 'Brow paint',
]);
/** `hair.style` 0..19, shared by every people. */
export const HAIR_STYLES: readonly string[] = Object.freeze([
  'Bald', 'Close crop', 'Tousled', 'Side part', 'Swept back', 'Shaggy', 'Long loose', 'Low tail', 'High tail', 'Topknot',
  'Twin buns', 'Single braid', 'Twin braids', 'Braid hood', 'Curls', 'Coils', 'Shaved sides', 'Crest', 'Bob', 'Windswept',
]);
export const FACIAL_HAIR: readonly string[] = Object.freeze([
  'None', 'Stubble', 'Short beard', 'Full beard', 'Braided beard', 'Moustache', 'Sideburns', 'Goatee',
]);
export const FUR_PATTERNS: readonly string[] = Object.freeze(['Solid', 'Striped', 'Spotted', 'Masked']);
export const TAILS: readonly string[] = Object.freeze(['Short', 'Brush', 'Long', 'Ringed']);
/** `face.ears` for the Brindlekin, 0..5. (The others' ears 0..3 are lengths: Larchfolk ears are long and pointed, Knollfolk round.) */
export const BRINDLE_EARS: readonly string[] = Object.freeze(['Pointed', 'Round', 'Long', 'Folded', 'Tufted', 'Lop']);

// ───────── parseLook ─────────

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `o` has exactly `keys` as its own keys. */
function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/** The group's fields as a fresh object when every one is an integer within its limit, else null. */
function readGroup(v: unknown, group: Group, people: PeopleId): Record<string, number> | null {
  if (!isRecord(v) || !exactKeys(v, GROUPS[group])) return null;
  const out: Record<string, number> = {};
  for (const key of GROUPS[group]) {
    const x = v[key];
    const [lo, limit] = LOOK_LIMITS[`${group}.${key}`]!;
    const hi = group === 'face' && key === 'ears' ? PEOPLES[people].earsMax : limit;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < lo || x > hi) return null;
    out[key] = x;
  }
  return out;
}

/** A strict copy of `v` as a `Look`: exact keys, integers in range, fur exactly for a furred people. Anything else gives null. */
export function parseLook(v: unknown): Look | null {
  if (!isRecord(v) || !exactKeys(v, LOOK_KEYS) || v.v !== 1 || !isPeopleId(v.people)) return null;
  const people = v.people;
  const out: Record<string, unknown> = { v: 1, people };
  for (const group of Object.keys(GROUPS) as Group[]) {
    if (group === 'fur' && !PEOPLES[people].furred) {
      if (v.fur !== null) return null;
      out.fur = null;
      continue;
    }
    const g = readGroup(v[group], group, people);
    if (!g) return null;
    out[group] = g;
  }
  return out as unknown as Look;
}

// ───────── the look code ─────────
// A fixed 28-byte layout: every field is one digit of a mixed-radix number (most significant first, in
// FIELDS order), written as 28 big-endian bytes and then base64url without padding (38 characters).
// The digits need log2(16 × 4 × 21^6 × 6·8·8·8·6·6·8 × 20·8 × 4·4 × 32·32 × 4·2^24·4 × 2^120) ≈ 221.4
// of the 224 bits, so every value of every field fits and no combination is lost. Fur digits are 0 for
// peoples without fur. Decoding is strict: it refuses any code that is not exactly what encodeLook
// writes for a valid look (wrong length or characters, a number past the last look, a version other
// than 1, ears past the people's, fur digits on a people without fur, or stray padding bits).

const LOOK_BYTES = 28;
const VERSION_RADIX = 16;
/** [group, key, radix] for every field after the version and the people, most significant first. */
const FIELDS: readonly (readonly [Group, string, number])[] = Object.freeze(
  [
    ...GROUPS.body.map((k) => ['body', k] as const),
    ...GROUPS.face.map((k) => ['face', k] as const),
    ...GROUPS.hair.map((k) => ['hair', k] as const),
    ...GROUPS.style.map((k) => ['style', k] as const),
    ...GROUPS.outfit.map((k) => ['outfit', k] as const),
    ['fur', 'pattern'] as const, ['fur', 'tail'] as const, ['fur', 'colour'] as const,
    ...GROUPS.colours.map((k) => ['colours', k] as const),
  ].map(([g, k]) => [g, k, LOOK_LIMITS[`${g}.${k}`]![1] + 1] as const),
);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries([...B64].map((c, i) => [c, i])));

/** Base64url without padding. */
function toBase64Url(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1] ?? 0, bytes[i + 2] ?? 0];
    const n = (a << 16) | (b << 8) | c;
    const chars = [B64[(n >> 18) & 63], B64[(n >> 12) & 63], B64[(n >> 6) & 63], B64[n & 63]];
    out += chars.slice(0, Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6))).join('');
  }
  return out;
}

/** The bytes of a base64url string without padding, or null for any other character or a stray length or bit. */
function fromBase64Url(s: string, bytes: number): number[] | null {
  if (s.length !== Math.ceil((bytes * 8) / 6)) return null;
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of s) {
    const v = B64_INDEX[c];
    if (v === undefined || !Object.prototype.hasOwnProperty.call(B64_INDEX, c)) return null;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  if (out.length !== bytes || (acc & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

/** The look's compact code: base64url of the fixed 28-byte layout, 38 characters. Throws on an invalid look. */
export function encodeLook(l: Look): string {
  const look = parseLook(l);
  if (!look) throw new RangeError('encodeLook: not a valid look');
  let n = BigInt(look.v);
  n = n * 4n + BigInt(PEOPLE_IDS.indexOf(look.people));
  for (const [g, k, radix] of FIELDS) {
    const group = look[g] as Record<string, number> | null;
    n = n * BigInt(radix) + BigInt(group ? group[k]! : 0);
  }
  const bytes: number[] = new Array<number>(LOOK_BYTES).fill(0);
  for (let i = LOOK_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  return toBase64Url(bytes);
}

/** The look a code describes, or null unless the code is exactly what `encodeLook` writes for a valid look. */
export function decodeLook(s: string): Look | null {
  if (typeof s !== 'string') return null;
  const bytes = fromBase64Url(s, LOOK_BYTES);
  if (!bytes) return null;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const digits: number[] = [];
  for (let i = FIELDS.length - 1; i >= 0; i--) {
    const radix = BigInt(FIELDS[i]![2]);
    digits[i] = Number(n % radix);
    n /= radix;
  }
  const people = PEOPLE_IDS[Number(n % 4n)]!;
  n /= 4n;
  if (n !== 1n) return null; // the version, and nothing above it
  const draft: Record<string, Record<string, number> | number | string | null> = { v: 1, people };
  for (const g of Object.keys(GROUPS)) draft[g] = {};
  FIELDS.forEach(([g, k], i) => ((draft[g] as Record<string, number>)[k] = digits[i]!));
  if (!PEOPLES[people].furred) {
    const fur = draft.fur as Record<string, number>;
    if (fur.pattern !== 0 || fur.tail !== 0 || fur.colour !== 0) return null;
    draft.fur = null;
  }
  // Re-order each group's keys as `Look` lists them, then validate (ears per people, and the rest).
  for (const g of Object.keys(GROUPS) as Group[]) {
    const v = draft[g];
    if (v && typeof v === 'object') draft[g] = Object.fromEntries(GROUPS[g].map((k) => [k, v[k]!]));
  }
  return parseLook(draft);
}

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

const copySlot = (s: GearLookSlot | null | undefined): GearLookSlot | null => (s ? { model: s.model, dye: [s.dye[0], s.dye[1]] } : null);

/**
 * The gear look from the worn items' models and dyes and the outfit's costumes: a body costume shows on
 * `chest` and hides legs, hands and feet; a head costume replaces the head piece; a back costume the back
 * piece; `hideHead` hides the head piece and the head costume. The weapon and off-hand always show.
 * (gearLookOf(inv, job, outfit) is this, fed from ITEMS[*].model, COSTUMES[*].model and the inventory.)
 */
export function resolveGearLook(
  worn: Partial<Record<GearLookSlotName, GearLookSlot | null | undefined>>,
  costumes: GearLookCostumes,
  hideHead: boolean,
): GearLook {
  const out = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, copySlot(worn[s])])) as unknown as GearLook;
  out.hideHead = hideHead;
  if (costumes.body) {
    out.chest = copySlot(costumes.body);
    for (const s of BODY_COVERS) out[s] = null;
  }
  if (costumes.head) out.head = copySlot(costumes.head);
  if (costumes.back) out.back = copySlot(costumes.back);
  if (hideHead) out.head = null;
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

/** The gear look a code describes, or null unless the code is exactly what `encodeGearLook` writes for a valid gear look. */
export function decodeGearLook(s: string): GearLook | null {
  if (typeof s !== 'string' || s.length < 3 || s.length > 27) return null;
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

// ───────── default and random looks ─────────

const hex = (s: string) => parseInt(s.slice(1), 16);

/** A colour channel by channel between `a` and `b` at t in [0, 1). */
function lerpColour(a: string, b: string, t: number): number {
  const [x, y] = [hex(a), hex(b)];
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const [p, q] = [(x >> shift) & 255, (y >> shift) & 255];
    out |= Math.min(255, Math.max(0, p + Math.round((q - p) * t))) << shift;
  }
  return out;
}

/** Eye colours: browns, hazels, greens, greys, blues and the Brindlekin's ambers. */
const EYE_RANGES: readonly [string, string][] = deepFreeze([
  ['#3b2416', '#6e4527'], ['#7a5a2e', '#a3863f'], ['#4f6b3a', '#7f9a55'], ['#5f6b73', '#9aa6ad'], ['#2f5d8a', '#6d9ccc'], ['#b07a1c', '#e0a93a'],
]);
/** Mark colours: scar pinks, paint reds and blues, ink and ochre. */
const MARK_RANGES: readonly [string, string][] = deepFreeze([
  ['#c98d86', '#e3b1a8'], ['#8e2a22', '#c2412f'], ['#28456e', '#3f6aa3'], ['#1d1b22', '#3a3542'], ['#b98a2c', '#dcb04a'], ['#e8e2d4', '#fbf8f0'],
]);

/**
 * A random valid look from a seeded generator (the creator's "Surprise me", the bots, default looks).
 * Sliders lean towards the people's average, colours come from the people's suggested ranges.
 */
export function randomLook(rng: () => number): Look {
  const int = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const pickRange = (ranges: readonly [string, string][]) => {
    const [a, b] = ranges[int(ranges.length)]!;
    return lerpColour(a, b, rng());
  };
  // Mostly near 10 (the sum of two draws), sometimes anywhere, so the extremes still turn up.
  const slider = () => (rng() < 0.3 ? int(21) : Math.min(20, Math.round((rng() + rng()) * 10)));
  const people = PEOPLE_IDS[int(PEOPLE_IDS.length)]!;
  const p = PEOPLES[people];
  const body = { height: slider(), build: slider(), shoulders: slider(), hips: slider(), legs: slider(), head: slider() };
  const face = {
    shape: int(6), eyes: int(8), brows: int(8), nose: int(8), mouth: int(6), ears: int(p.earsMax + 1),
    marks: rng() < 0.4 ? 0 : 1 + int(7),
  };
  const hair = { style: int(20), facial: rng() < 0.5 ? 0 : 1 + int(7) };
  const hairColour = pickRange(p.hairRange);
  const colours = {
    skin: pickRange(p.skinRange),
    hair: hairColour,
    // Facial hair usually matches the hair; sometimes it is its own shade.
    facial: rng() < 0.7 ? hairColour : pickRange(p.hairRange),
    eyes: pickRange(EYE_RANGES),
    marks: pickRange(MARK_RANGES),
  };
  const fur = p.furred ? { pattern: int(4), colour: pickRange(p.hairRange), tail: int(4) } : null;
  const style = { stance: int(4), walk: int(4) };
  const outfit = { dye1: int(32), dye2: int(32) };
  return { v: 1, people, body, face, hair, colours, fur, style, outfit };
}

/** The seed the default looks are drawn with (kept apart from other uses of the same account id). */
const DEFAULT_LOOK_SEED = 0x100c;

/** A varied, valid look for an account that has not used the creator yet: the same for the same seed. */
export function defaultLook(seed: string): Look {
  return randomLook(prng(cyrb53(seed, DEFAULT_LOOK_SEED)));
}

// ───────── the Barber ─────────

export const BARBER_PRICE = 40;
export const BARBER_PEOPLE_PRICE = 200;

/** Gold the Barber asks to go from one look to another: 0 if equal, 200 if the people changes, else 40. */
export function barberCost(from: Look, to: Look): number {
  if (from.people !== to.people) return BARBER_PEOPLE_PRICE;
  return encodeLook(from) === encodeLook(to) ? 0 : BARBER_PRICE;
}

// ───────── how many looks ─────────

/** The number of distinct looks: per people without colours and dyes, and in all with them (approximate, a float). */
export const LOOK_COMBINATIONS: { readonly discrete: Readonly<Record<PeopleId, number>>; readonly withColours: number } = deepFreeze(
  (() => {
    const discrete = {} as Record<PeopleId, number>;
    let withColours = 0;
    for (const id of PEOPLE_IDS) {
      let n = 1;
      for (const [g, k, radix] of FIELDS) {
        if (g === 'colours' || g === 'outfit' || (g === 'fur' && k === 'colour')) continue;
        if (g === 'fur' && !PEOPLES[id].furred) continue;
        n *= g === 'face' && k === 'ears' ? PEOPLES[id].earsMax + 1 : radix;
      }
      discrete[id] = n;
      let colours = 1;
      for (let i = 0; i < (PEOPLES[id].furred ? 6 : 5); i++) colours *= 16777216;
      withColours += n * colours * 32 * 32;
    }
    return { discrete, withColours };
  })(),
);
