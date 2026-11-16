// Look v1 (Plan 5): the adventurer's look before Look v2, kept so stored v1 looks and v1 codes still read
// (look.ts upgradeLookV1 maps them to v2) and so the pre-v2 client can keep drawing (look.ts lookV1View).
// Unchanged from Plan 5 apart from the V1 names. Pure and deterministic.
import { cyrb53 } from './hash';
import { PEOPLES, PEOPLE_IDS, deepFreeze, exactKeys, fromBase64Url, isPeopleId, isRecord, lerpColour, toBase64Url, type PeopleId } from './lookCommon';
import { seededRng } from './rng';

// ───────── the look ─────────

/** A dye id, 0..31 (0 = undyed). The same numbers as `DyeId` in items.ts. */
type Dye = number;

export interface LookV1 {
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
export const LOOK_LIMITS_V1: { readonly [path: string]: readonly [number, number] } = deepFreeze({
  'body.height': [0, 20], 'body.build': [0, 20], 'body.shoulders': [0, 20], 'body.hips': [0, 20], 'body.legs': [0, 20], 'body.head': [0, 20],
  'face.shape': [0, 5], 'face.eyes': [0, 7], 'face.brows': [0, 7], 'face.nose': [0, 7], 'face.mouth': [0, 5], 'face.ears': [0, 5], 'face.marks': [0, 7],
  'hair.style': [0, 19], 'hair.facial': [0, 7],
  'colours.skin': [0, COLOUR_MAX], 'colours.hair': [0, COLOUR_MAX], 'colours.facial': [0, COLOUR_MAX], 'colours.eyes': [0, COLOUR_MAX], 'colours.marks': [0, COLOUR_MAX],
  'fur.pattern': [0, 3], 'fur.colour': [0, COLOUR_MAX], 'fur.tail': [0, 3],
  'style.stance': [0, 3], 'style.walk': [0, 3],
  'outfit.dye1': [0, 31], 'outfit.dye2': [0, 31],
} satisfies Record<string, [number, number]>);

/** The key order of each group, as `LookV1` lists them. */
const GROUPS_V1 = {
  body: ['height', 'build', 'shoulders', 'hips', 'legs', 'head'],
  face: ['shape', 'eyes', 'brows', 'nose', 'mouth', 'ears', 'marks'],
  hair: ['style', 'facial'],
  colours: ['skin', 'hair', 'facial', 'eyes', 'marks'],
  fur: ['pattern', 'colour', 'tail'],
  style: ['stance', 'walk'],
  outfit: ['dye1', 'dye2'],
} as const;
type Group = keyof typeof GROUPS_V1;
const LOOK_KEYS = ['v', 'people', ...Object.keys(GROUPS_V1)];


// ───────── names for the v1 creator (index = value) ─────────

export const FACE_SHAPES_V1: readonly string[] = Object.freeze(['Round', 'Oval', 'Square', 'Heart', 'Long', 'Soft']);
export const FACE_MARKS_V1: readonly string[] = Object.freeze([
  'None', 'Freckles', 'Left scar', 'Right scar', 'Cheek bands', 'Beauty mark', 'Dot tattoos', 'Brow paint',
]);
/** `hair.style` 0..19, shared by every people. */
export const HAIR_STYLES_V1: readonly string[] = Object.freeze([
  'Bald', 'Close crop', 'Tousled', 'Side part', 'Swept back', 'Shaggy', 'Long loose', 'Low tail', 'High tail', 'Topknot',
  'Twin buns', 'Single braid', 'Twin braids', 'Braid hood', 'Curls', 'Coils', 'Shaved sides', 'Crest', 'Bob', 'Windswept',
]);
export const FACIAL_HAIR_V1: readonly string[] = Object.freeze([
  'None', 'Stubble', 'Short beard', 'Full beard', 'Braided beard', 'Moustache', 'Sideburns', 'Goatee',
]);

// ───────── parseLookV1 ─────────

/** The group's fields as a fresh object when every one is an integer within its limit, else null. */
function readGroup(v: unknown, group: Group, people: PeopleId): Record<string, number> | null {
  if (!isRecord(v) || !exactKeys(v, GROUPS_V1[group])) return null;
  const out: Record<string, number> = {};
  for (const key of GROUPS_V1[group]) {
    const x = v[key];
    const [lo, limit] = LOOK_LIMITS_V1[`${group}.${key}`]!;
    const hi = group === 'face' && key === 'ears' ? PEOPLES[people].earsMax : limit;
    if (typeof x !== 'number' || !Number.isInteger(x) || x < lo || x > hi) return null;
    out[key] = x;
  }
  return out;
}

/** A strict copy of `v` as a `LookV1`: exact keys, integers in range, fur exactly for a furred people. Anything else gives null. */
export function parseLookV1(v: unknown): LookV1 | null {
  if (!isRecord(v) || !exactKeys(v, LOOK_KEYS) || v.v !== 1 || !isPeopleId(v.people)) return null;
  const people = v.people;
  const out: Record<string, unknown> = { v: 1, people };
  for (const group of Object.keys(GROUPS_V1) as Group[]) {
    if (group === 'fur' && !PEOPLES[people].furred) {
      if (v.fur !== null) return null;
      out.fur = null;
      continue;
    }
    const g = readGroup(v[group], group, people);
    if (!g) return null;
    out[group] = g;
  }
  return out as unknown as LookV1;
}

// ───────── the look code ─────────
// A fixed 28-byte layout: every field is one digit of a mixed-radix number (most significant first, in
// FIELDS_V1 order), written as 28 big-endian bytes and then base64url without padding (38 characters).
// The digits need log2(16 × 4 × 21^6 × 6·8·8·8·6·6·8 × 20·8 × 4·4 × 32·32 × 4·2^24·4 × 2^120) ≈ 221.4
// of the 224 bits, so every value of every field fits and no combination is lost. Fur digits are 0 for
// peoples without fur. Decoding is strict: it refuses any code that is not exactly what encodeLookV1
// writes for a valid look (wrong length or characters, a number past the last look, a version other
// than 1, ears past the people's, fur digits on a people without fur, or stray padding bits).
// Versions: the code has no room to grow, so a later look shape (v2) gets its own byte count and so its
// own code length; decoders tell versions apart by length first, and a 38-character code is always v1.

const LOOK_BYTES = 28;
/** [group, key, radix] for every field after the version and the people, most significant first. */
const FIELDS_V1: readonly (readonly [Group, string, number])[] = Object.freeze(
  [
    ...GROUPS_V1.body.map((k) => ['body', k] as const),
    ...GROUPS_V1.face.map((k) => ['face', k] as const),
    ...GROUPS_V1.hair.map((k) => ['hair', k] as const),
    ...GROUPS_V1.style.map((k) => ['style', k] as const),
    ...GROUPS_V1.outfit.map((k) => ['outfit', k] as const),
    ['fur', 'pattern'] as const, ['fur', 'tail'] as const, ['fur', 'colour'] as const,
    ...GROUPS_V1.colours.map((k) => ['colours', k] as const),
  ].map(([g, k]) => [g, k, LOOK_LIMITS_V1[`${g}.${k}`]![1] + 1] as const),
);

/** The look's compact code: base64url of the fixed 28-byte layout, 38 characters. Throws on an invalid look. */
export function encodeLookV1(l: LookV1): string {
  const look = parseLookV1(l);
  if (!look) throw new RangeError('encodeLookV1: not a valid look');
  let n = BigInt(look.v);
  n = n * 4n + BigInt(PEOPLE_IDS.indexOf(look.people));
  for (const [g, k, radix] of FIELDS_V1) {
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

/** The look a code describes, or null unless the code is exactly what `encodeLookV1` writes for a valid look. */
export function decodeLookV1(s: string): LookV1 | null {
  if (typeof s !== 'string') return null;
  const bytes = fromBase64Url(s, LOOK_BYTES);
  if (!bytes) return null;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const digits: number[] = [];
  for (let i = FIELDS_V1.length - 1; i >= 0; i--) {
    const radix = BigInt(FIELDS_V1[i]![2]);
    digits[i] = Number(n % radix);
    n /= radix;
  }
  const people = PEOPLE_IDS[Number(n % 4n)]!;
  n /= 4n;
  if (n !== 1n) return null; // the version, and nothing above it
  const draft: Record<string, Record<string, number> | number | string | null> = { v: 1, people };
  for (const g of Object.keys(GROUPS_V1)) draft[g] = {};
  FIELDS_V1.forEach(([g, k], i) => ((draft[g] as Record<string, number>)[k] = digits[i]!));
  if (!PEOPLES[people].furred) {
    const fur = draft.fur as Record<string, number>;
    if (fur.pattern !== 0 || fur.tail !== 0 || fur.colour !== 0) return null;
    draft.fur = null;
  }
  // Re-order each group's keys as `LookV1` lists them, then validate (ears per people, and the rest).
  for (const g of Object.keys(GROUPS_V1) as Group[]) {
    const v = draft[g];
    if (v && typeof v === 'object') draft[g] = Object.fromEntries(GROUPS_V1[g].map((k) => [k, v[k]!]));
  }
  return parseLookV1(draft);
}

// ───────── v1 random looks ─────────

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
export function randomLookV1(rng: () => number): LookV1 {
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
export function defaultLookV1(seed: string): LookV1 {
  return randomLookV1(seededRng(cyrb53(seed, DEFAULT_LOOK_SEED)));
}

/** The v1 Barber price (the pre-v2 creator shows it): 0 unchanged, 200 for a new people, else 40 — what the server charges for a v1 edit (look.ts mergeLookV1 keeps the body). */
export function barberCostV1(from: LookV1, to: LookV1): number {
  if (from.people !== to.people) return 200;
  return encodeLookV1(from) === encodeLookV1(to) ? 0 : 40;
}
