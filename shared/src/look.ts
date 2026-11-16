// Look v2: what an adventurer looks like. A base body ('male' | 'female', looks only), body sliders, a shaped
// face (head, eyes, brows, nose, mouth, ears, age), skin with freckles, moles, scars, blush and optional make-up,
// hair (44 styles, hairline, two colours, grey), facial hair, face paint and the peoples' features (ears, fur,
// tail, muzzle). Also: the strict parser, the compact versioned code (v1 codes still decode, upgraded), named
// presets, random looks sampled around the presets, the v1 view for the pre-v2 client, and the Barber's price.
// Looks only: nothing in combat, movement or kits reads a look (look.test.ts checks the imports).
// Pure and deterministic: integer maths, seeded generators, frozen tables. See docs/superpowers/specs/2026-11-16-look-v2.md.
import { cyrb53 } from './hash';
import {
  PEOPLES, PEOPLE_IDS, deepFreeze, exactKeys, fromBase64Url, isIntIn, isPeopleId, isRecord, lerpColour, toBase64Url, type PeopleId,
} from './lookCommon';
import { decodeLookV1, defaultLookV1, parseLookV1, type LookV1 } from './lookV1';
import { seededRng } from './rng';

export * from './lookCommon';
export * from './lookV1';
export * from './gearLook';

// ───────── the look ─────────

export type BodyType = 'male' | 'female';
export const BODY_TYPES: readonly BodyType[] = Object.freeze(['male', 'female']);

/** A dye id, 0..31 (0 = undyed). The same numbers as `DyeId` in items.ts. */
type Dye = number;
/** 0xRRGGBB within the lightness clamp (clampLookColour). */
type Colour = number;

/** Body sliders, integers 0..20; 10 is the body's and people's average. */
export interface LookBuild {
  readonly height: number; readonly shoulders: number; readonly chest: number; readonly waist: number; readonly hips: number;
  readonly arms: number; readonly legs: number; readonly muscle: number; readonly weight: number; readonly neck: number; readonly head: number;
}

export interface Look {
  readonly v: 2;
  readonly people: PeopleId;
  /** The base body shape; every slider and choice is open to both. Looks only. */
  readonly body: BodyType;
  readonly build: LookBuild;
  /** Head shape sliders 0..10 (5 = average); `age` 0..4 (lines at the eyes, brow and mouth; 0 = none). */
  readonly face: {
    readonly width: number; readonly length: number; readonly forehead: number; readonly cheekbones: number;
    readonly jawWidth: number; readonly chinLength: number; readonly chinWidth: number; readonly age: number;
  };
  /** `shape` indexes EYE_SHAPES; sliders 0..10; `colour2` is the other (left) eye's colour, null = the same. */
  readonly eyes: {
    readonly shape: number; readonly size: number; readonly spacing: number; readonly height: number; readonly tilt: number;
    readonly openness: number; readonly colour: Colour; readonly colour2: Colour | null;
  };
  /** `shape` indexes BROW_SHAPES; `colour` null = follows the hair colour. */
  readonly brows: { readonly shape: number; readonly thickness: number; readonly height: number; readonly tilt: number; readonly colour: Colour | null };
  readonly nose: { readonly length: number; readonly width: number; readonly bridge: number; readonly tip: number };
  readonly mouth: { readonly width: number; readonly upperLip: number; readonly lowerLip: number; readonly height: number };
  /** `style` is the people's ear (v1 `face.ears`: 0..PEOPLES[p].earsMax; BRINDLE_EARS for the Brindlekin). */
  readonly ears: { readonly size: number; readonly angle: number; readonly style: number };
  /** For the Brindlekin, `colour` is the fur's base colour. `moles` is a bit set over MOLE_SPOTS; `scar` indexes SCARS. */
  readonly skin: { readonly colour: Colour; readonly freckles: number; readonly moles: number; readonly scar: number; readonly blush: number };
  /** 0 = none, k = the palette's entry k − 1 (LIP_COLOURS, SHADOW_COLOURS, LINER_COLOURS). */
  readonly makeup: { readonly lips: number; readonly shadow: number; readonly liner: number };
  /** `style` indexes HAIR_STYLES, `hairline` HAIRLINES, `facial` FACIAL_HAIR (any body); `colour2` tips/streaks, null = none; `grey` 0..4. */
  readonly hair: {
    readonly style: number; readonly hairline: number; readonly colour: Colour; readonly colour2: Colour | null; readonly grey: number;
    readonly facial: number; readonly facialColour: Colour;
  };
  /** Face paint or tattoo: `style` indexes FACE_PAINTS (0 = none). */
  readonly paint: { readonly style: number; readonly colour: Colour };
  /** Furred peoples only (null for the others): FUR_PATTERNS, the pattern's colour, TAILS, and the muzzle 0..7. */
  readonly fur: { readonly pattern: number; readonly colour: Colour; readonly tail: number; readonly muzzle: number } | null;
  /** STANCES and WALKS. */
  readonly style: { readonly stance: number; readonly walk: number };
  /** The starter kit's two dyes. */
  readonly outfit: { readonly dye1: Dye; readonly dye2: Dye };
}

const COLOUR_MAX = 0xffffff;
type Kind = 'int' | 'colour' | 'colour?';
type GroupName = Exclude<keyof Look, 'v' | 'people' | 'body'>;

/** Every field of every group, in `Look` order: [key, kind, hi] (lo is always 0). */
const SCHEMA: Readonly<Record<GroupName, readonly (readonly [string, Kind, number])[]>> = deepFreeze({
  build: ['height', 'shoulders', 'chest', 'waist', 'hips', 'arms', 'legs', 'muscle', 'weight', 'neck', 'head'].map((k) => [k, 'int', 20] as const),
  face: [...['width', 'length', 'forehead', 'cheekbones', 'jawWidth', 'chinLength', 'chinWidth'].map((k) => [k, 'int', 10] as const), ['age', 'int', 4]],
  eyes: [['shape', 'int', 11], ...['size', 'spacing', 'height', 'tilt', 'openness'].map((k) => [k, 'int', 10] as const), ['colour', 'colour', COLOUR_MAX], ['colour2', 'colour?', COLOUR_MAX]],
  brows: [['shape', 'int', 9], ...['thickness', 'height', 'tilt'].map((k) => [k, 'int', 10] as const), ['colour', 'colour?', COLOUR_MAX]],
  nose: ['length', 'width', 'bridge', 'tip'].map((k) => [k, 'int', 10] as const),
  mouth: ['width', 'upperLip', 'lowerLip', 'height'].map((k) => [k, 'int', 10] as const),
  ears: [['size', 'int', 10], ['angle', 'int', 10], ['style', 'int', 5]],
  skin: [['colour', 'colour', COLOUR_MAX], ['freckles', 'int', 4], ['moles', 'int', 63], ['scar', 'int', 7], ['blush', 'int', 4]],
  makeup: [['lips', 'int', 12], ['shadow', 'int', 12], ['liner', 'int', 6]],
  hair: [['style', 'int', 43], ['hairline', 'int', 4], ['colour', 'colour', COLOUR_MAX], ['colour2', 'colour?', COLOUR_MAX], ['grey', 'int', 4], ['facial', 'int', 13], ['facialColour', 'colour', COLOUR_MAX]],
  paint: [['style', 'int', 7], ['colour', 'colour', COLOUR_MAX]],
  fur: [['pattern', 'int', 3], ['colour', 'colour', COLOUR_MAX], ['tail', 'int', 3], ['muzzle', 'int', 7]],
  style: [['stance', 'int', 3], ['walk', 'int', 3]],
  outfit: [['dye1', 'int', 31], ['dye2', 'int', 31]],
} satisfies Record<GroupName, readonly (readonly [string, Kind, number])[]>);

const GROUP_NAMES = Object.freeze(Object.keys(SCHEMA) as GroupName[]);
/** Each group's keys in `Look` order (for the creator). */
export const LOOK_GROUPS: Readonly<Record<GroupName, readonly string[]>> = deepFreeze(
  Object.fromEntries(GROUP_NAMES.map((g) => [g, SCHEMA[g].map(([k]) => k)])) as Record<GroupName, string[]>,
);
const LOOK_KEYS = Object.freeze(['v', 'people', 'body', ...GROUP_NAMES]);

/** Every numeric field by path ('eyes.size') with its inclusive range. `ears.style` is further capped by PEOPLES[p].earsMax; colours by the clamp. */
export const LOOK_LIMITS: { readonly [path: string]: readonly [number, number] } = deepFreeze(
  Object.fromEntries(GROUP_NAMES.flatMap((g) => SCHEMA[g].map(([k, , hi]) => [`${g}.${k}`, [0, hi]]))) as Record<string, [number, number]>,
);
/** The colour paths that may be null (eyes.colour2: same as the other eye; brows.colour: follows the hair; hair.colour2: none). */
export const LOOK_OPTIONAL_COLOURS: readonly string[] = Object.freeze(
  GROUP_NAMES.flatMap((g) => SCHEMA[g].filter(([, kind]) => kind === 'colour?').map(([k]) => `${g}.${k}`)),
);

// ───────── the lightness clamp ─────────

/** Luma bounds (Rec. 601 weights, 0..255) every look colour stays within, so no part of a character can vanish into black or white. */
export const LUMA_MIN = 16;
export const LUMA_MAX = 250;
const lumaSum = (c: number) => 299 * ((c >> 16) & 255) + 587 * ((c >> 8) & 255) + 114 * (c & 255);
/** A colour's luma, 0..255 (0.299 R + 0.587 G + 0.114 B). */
export const lookLuma = (c: number): number => lumaSum(c) / 1000;

/** The colour moved channel by channel (equally, capped at 0 and 255) until its luma is within [LUMA_MIN, LUMA_MAX]; unchanged if already inside. */
export function clampLookColour(c: number): number {
  let [r, g, b] = [(c >> 16) & 255, (c >> 8) & 255, c & 255];
  for (;;) {
    const s = 299 * r + 587 * g + 114 * b;
    if (s < LUMA_MIN * 1000) {
      const d = Math.ceil((LUMA_MIN * 1000 - s) / 1000);
      [r, g, b] = [Math.min(255, r + d), Math.min(255, g + d), Math.min(255, b + d)];
    } else if (s > LUMA_MAX * 1000) {
      const d = Math.ceil((s - LUMA_MAX * 1000) / 1000);
      [r, g, b] = [Math.max(0, r - d), Math.max(0, g - d), Math.max(0, b - d)];
    } else return (r << 16) | (g << 8) | b;
  }
}
const isColour = (x: unknown): x is number => isIntIn(x, 0, COLOUR_MAX) && lumaSum(x) >= LUMA_MIN * 1000 && lumaSum(x) <= LUMA_MAX * 1000;

// ───────── names and palettes (index = value) ─────────

export interface NamedColour { readonly name: string; readonly colour: number }
export type Undertone = 'warm' | 'neutral' | 'cool' | 'olive';
export interface SkinTone extends NamedColour { readonly undertone: Undertone }

const hex = (s: string) => parseInt(s.slice(1), 16);
const named = (list: readonly (readonly [string, string])[]): readonly NamedColour[] => deepFreeze(list.map(([name, c]) => ({ name, colour: hex(c) })));

/** Natural skin tones, lightest first, evenly spread (no luma gap over 16), warm, neutral, cool and olive. Any free colour is also allowed. */
export const SKIN_TONES: readonly SkinTone[] = deepFreeze(([
  ['Porcelain', '#f7e7df', 'cool'], ['Ivory', '#f5dfd0', 'neutral'], ['Shell', '#f1d6c3', 'warm'], ['Cream', '#efd0b6', 'warm'],
  ['Rosewood light', '#eac6ac', 'cool'], ['Sand', '#e6bf9f', 'neutral'], ['Wheat', '#e0b591', 'warm'], ['Honey', '#d9ab87', 'warm'],
  ['Almond', '#d3a27c', 'neutral'], ['Fawn', '#cc9a72', 'cool'], ['Caramel', '#c79469', 'warm'], ['Toffee', '#c08a62', 'neutral'],
  ['Amber', '#b98158', 'warm'], ['Cinnamon', '#b47c52', 'warm'], ['Olive', '#a08156', 'olive'], ['Bronze', '#a8724c', 'neutral'],
  ['Copper', '#9a6745', 'warm'], ['Olive deep', '#86653f', 'olive'], ['Chestnut', '#8d5c3e', 'cool'], ['Hazelnut', '#7d5237', 'neutral'],
  ['Walnut', '#714a31', 'warm'], ['Mahogany', '#66412c', 'cool'], ['Cocoa', '#5c3a27', 'neutral'], ['Umber', '#523323', 'warm'],
  ['Espresso', '#482d1f', 'cool'], ['Ebony', '#3f281c', 'neutral'], ['Night oak', '#372218', 'warm'], ['Deep ebony', '#2f1d15', 'cool'],
  ['Midnight', '#271812', 'neutral'],
] as const).map(([name, c, undertone]) => ({ name, colour: hex(c), undertone })));

export const HAIR_COLOURS: readonly NamedColour[] = named([
  ['Jet black', '#16110f'], ['Soft black', '#2a211c'], ['Blue black', '#1b1e2a'], ['Dark brown', '#3e2c21'], ['Chestnut', '#5a3a24'],
  ['Mid brown', '#6e4427'], ['Light brown', '#8b5e3c'], ['Ash brown', '#7a6a5a'], ['Dark blonde', '#a8763d'], ['Honey blonde', '#c9974f'],
  ['Golden blonde', '#d2aa62'], ['Ash blonde', '#c8bb9c'], ['Platinum', '#ecdfb8'], ['Strawberry', '#c4703f'], ['Copper', '#b5532a'],
  ['Auburn', '#8c2e1b'], ['Deep red', '#6e1f17'], ['Salt and pepper', '#6f6b67'], ['Grey', '#8d8a86'], ['Silver', '#a9a7a3'],
  ['White', '#e4e2dc'], ['Moss', '#6c7849'], ['Frost', '#cbc4aa'], ['Slate', '#3d4a52'],
]);

export const EYE_COLOURS: readonly NamedColour[] = named([
  ['Near black', '#20160f'], ['Dark brown', '#3b2416'], ['Brown', '#5a3a22'], ['Light brown', '#6e4527'], ['Hazel', '#7a5a2e'],
  ['Green hazel', '#6b6a35'], ['Green', '#4f6b3a'], ['Light green', '#7f9a55'], ['Grey', '#5f6b73'], ['Light grey', '#9aa6ad'],
  ['Blue grey', '#5d7a8c'], ['Blue', '#2f5d8a'], ['Light blue', '#6d9ccc'], ['Violet grey', '#6a5d7a'], ['Amber', '#b07a1c'], ['Gold', '#e0a93a'],
]);

export const LIP_COLOURS: readonly NamedColour[] = named([
  ['Nude', '#b9806e'], ['Rose', '#b4545e'], ['Pink', '#d4707f'], ['Coral', '#e06a4f'], ['Red', '#b3202a'], ['Berry', '#7c2240'],
  ['Plum', '#5e2a43'], ['Brown', '#6e3b2e'], ['Mauve', '#9a6276'], ['Peach', '#e39a7c'], ['Wine', '#5a1a24'], ['Gloss', '#e8b0a8'],
]);
export const SHADOW_COLOURS: readonly NamedColour[] = named([
  ['Taupe', '#8a7466'], ['Bronze', '#9a6a3a'], ['Gold', '#c9a24a'], ['Smoke', '#4a4550'], ['Plum', '#6a3a5e'], ['Rose', '#c07a86'],
  ['Moss', '#5e6a3a'], ['Teal', '#2f6a6e'], ['Navy', '#2a3a6a'], ['Copper', '#a8552a'], ['Silver', '#b6b6be'], ['Lilac', '#9a86c0'],
]);
export const LINER_COLOURS: readonly NamedColour[] = named([
  ['Black', '#1a1616'], ['Brown', '#3e2a1e'], ['Navy', '#1e2a4e'], ['Green', '#24402a'], ['Plum', '#3e1e3a'], ['Grey', '#4a4a4e'],
]);
/** Suggested face-paint colours (any free colour is allowed). */
export const PAINT_COLOURS: readonly NamedColour[] = named([
  ['Scar pink', '#d4a097'], ['Ochre', '#c99a3b'], ['Blood red', '#a8352a'], ['Woad', '#33578a'], ['Ink', '#2b2830'], ['Chalk', '#ece6da'], ['Leaf', '#4f7a3a'], ['Ember', '#d8642a'],
]);

export type HairLength = 'bald' | 'shaved' | 'short' | 'medium' | 'long';
export type HairForm = 'loose' | 'tied' | 'braided';
export type HairTexture = 'none' | 'straight' | 'wavy' | 'curly' | 'coiled';
/** A hair style and hints for the model: its length class, whether it is tied or braided, its texture, and the nearest v1 style (lookV1View). */
export interface HairStyleInfo { readonly name: string; readonly length: HairLength; readonly form: HairForm; readonly texture: HairTexture; readonly v1: number }

const HS = (name: string, length: HairLength, form: HairForm, texture: HairTexture, v1: number) => ({ name, length, form, texture, v1 });
/** `hair.style` 0..43: the twenty v1 styles first (same numbers), then twenty-four more. */
export const HAIR_STYLE_INFO: readonly HairStyleInfo[] = deepFreeze([
  HS('Bald', 'bald', 'loose', 'none', 0), HS('Close crop', 'short', 'loose', 'straight', 1), HS('Tousled', 'short', 'loose', 'wavy', 2),
  HS('Side part', 'short', 'loose', 'straight', 3), HS('Swept back', 'medium', 'loose', 'straight', 4), HS('Shaggy', 'medium', 'loose', 'wavy', 5),
  HS('Long loose', 'long', 'loose', 'straight', 6), HS('Low tail', 'long', 'tied', 'straight', 7), HS('High tail', 'long', 'tied', 'straight', 8),
  HS('Topknot', 'medium', 'tied', 'straight', 9), HS('Twin buns', 'medium', 'tied', 'straight', 10), HS('Single braid', 'long', 'braided', 'straight', 11),
  HS('Twin braids', 'long', 'braided', 'straight', 12), HS('Braid hood', 'medium', 'braided', 'straight', 13), HS('Curls', 'medium', 'loose', 'curly', 14),
  HS('Coils', 'medium', 'loose', 'coiled', 15), HS('Shaved sides', 'short', 'loose', 'straight', 16), HS('Crest', 'short', 'loose', 'straight', 17),
  HS('Bob', 'medium', 'loose', 'straight', 18), HS('Windswept', 'medium', 'loose', 'wavy', 19),
  HS('Buzz cut', 'shaved', 'loose', 'none', 1), HS('Shaved', 'shaved', 'loose', 'none', 1), HS('Crew cut', 'short', 'loose', 'straight', 1),
  HS('Undercut', 'short', 'loose', 'straight', 16), HS('Pompadour', 'short', 'loose', 'wavy', 4), HS('Curtains', 'medium', 'loose', 'straight', 3),
  HS('Pixie', 'short', 'loose', 'straight', 2), HS('Long bob', 'medium', 'loose', 'wavy', 18), HS('Shoulder waves', 'medium', 'loose', 'wavy', 5),
  HS('Very long', 'long', 'loose', 'straight', 6), HS('Long waves', 'long', 'loose', 'wavy', 6), HS('Long curls', 'long', 'loose', 'curly', 14),
  HS('Curly tail', 'long', 'tied', 'curly', 7), HS('Crown braid', 'long', 'braided', 'wavy', 11), HS('Cornrows', 'short', 'braided', 'coiled', 13),
  HS('Box braids', 'long', 'braided', 'coiled', 12), HS('Rounded afro', 'medium', 'loose', 'coiled', 15), HS('Twin puffs', 'medium', 'tied', 'coiled', 10),
  HS('Locs', 'long', 'loose', 'coiled', 6), HS('Short twists', 'short', 'loose', 'coiled', 15), HS('Knot crown', 'short', 'tied', 'coiled', 10),
  HS('Tapered coils', 'short', 'loose', 'coiled', 15), HS('Ridge cut', 'short', 'loose', 'straight', 17), HS('Half up', 'long', 'tied', 'wavy', 7),
]);
export const HAIR_STYLES: readonly string[] = Object.freeze(HAIR_STYLE_INFO.map((h) => h.name));
export const HAIRLINES: readonly string[] = Object.freeze(['Natural', 'Straight', "Widow's peak", 'Receding', 'High']);
/** `hair.facial` 0..13, open to either body: the eight v1 choices first, then six more. */
export const FACIAL_HAIR: readonly string[] = Object.freeze([
  'None', 'Stubble', 'Short beard', 'Full beard', 'Braided beard', 'Moustache', 'Sideburns', 'Goatee',
  'Chin strap', 'Mutton chops', 'Handlebar', 'Soul patch', 'Long beard', 'Forked beard',
]);
const FACIAL_V1: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 2, 6, 5, 7, 3, 4]);
/** `eyes.shape` 0..11 (the eight v1 eyes first, same numbers). */
export const EYE_SHAPES: readonly string[] = Object.freeze([
  'Almond', 'Round', 'Hooded', 'Monolid', 'Upturned', 'Downturned', 'Deep set', 'Bright', 'Heavy lid', 'Narrow', 'Sleepy', 'Cat',
]);
const EYES_V1: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 2, 3, 5, 4]);
/** `brows.shape` 0..9 (the eight v1 brows first). */
export const BROW_SHAPES: readonly string[] = Object.freeze(['Straight', 'Soft arch', 'High arch', 'Angled', 'Rounded', 'Flat', 'Bushy', 'Thin', 'S-curve', 'Tapered']);
const BROWS_V1: readonly number[] = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 2, 7]);
export const SCARS: readonly string[] = Object.freeze(['None', 'Left cheek', 'Right cheek', 'Brow nick', 'Lip nick', 'Nose bridge', 'Jaw line', 'Eye slash']);
/**
 * Mole spots for `skin.moles` (bit i = spot i). Positions are on the front of the head in unit face space:
 * x −1 (the adventurer's right) … +1 (their left), y −1 (chin) … +1 (top of the brow).
 */
export const MOLE_SPOTS: readonly { readonly name: string; readonly x: number; readonly y: number }[] = deepFreeze([
  { name: 'Left cheek', x: 0.45, y: -0.1 }, { name: 'Right cheek', x: -0.5, y: -0.05 }, { name: 'Upper lip', x: 0.22, y: -0.42 },
  { name: 'Chin', x: -0.12, y: -0.82 }, { name: 'Left brow', x: 0.48, y: 0.5 }, { name: 'Right temple', x: -0.78, y: 0.35 },
]);
export const FACE_PAINTS: readonly string[] = Object.freeze(['None', 'Cheek bands', 'Dot tattoos', 'Brow paint', 'Chin stripe', 'Eye mask', 'Forehead mark', 'Tear lines']);

/** The six v1 face shapes as head sliders [width, length, forehead, cheekbones, jawWidth, chinLength, chinWidth]. */
export const FACE_SHAPE_PRESETS: readonly (readonly number[])[] = deepFreeze([
  [7, 4, 5, 5, 6, 4, 6], [5, 6, 5, 6, 4, 5, 4], [6, 5, 5, 5, 8, 5, 7], [6, 5, 7, 7, 3, 6, 2], [4, 8, 6, 5, 4, 7, 4], [5, 5, 5, 4, 5, 5, 5],
]);
/** The eight v1 noses as [length, width, bridge, tip]. */
export const NOSE_PRESETS: readonly (readonly number[])[] = deepFreeze([
  [5, 5, 5, 5], [3, 4, 4, 6], [7, 4, 7, 4], [5, 7, 4, 5], [4, 3, 6, 7], [6, 6, 3, 3], [8, 5, 8, 2], [3, 6, 2, 6],
]);
/** The six v1 mouths as [width, upperLip, lowerLip, height]. */
export const MOUTH_PRESETS: readonly (readonly number[])[] = deepFreeze([
  [5, 5, 5, 5], [3, 4, 6, 5], [7, 4, 5, 5], [5, 7, 7, 5], [4, 3, 3, 6], [6, 5, 4, 4],
]);
const FACE_KEYS = ['width', 'length', 'forehead', 'cheekbones', 'jawWidth', 'chinLength', 'chinWidth'] as const;
const NOSE_KEYS = ['length', 'width', 'bridge', 'tip'] as const;
const MOUTH_KEYS = ['width', 'upperLip', 'lowerLip', 'height'] as const;
const fromPreset = <K extends string>(keys: readonly K[], p: readonly number[]) => Object.fromEntries(keys.map((k, i) => [k, p[i]!])) as Record<K, number>;
function nearest(presets: readonly (readonly number[])[], o: Readonly<Record<string, number>>, keys: readonly string[]): number {
  let best = 0;
  let bestD = Infinity;
  presets.forEach((p, i) => {
    const d = keys.reduce((s, k, j) => s + (o[k]! - p[j]!) ** 2, 0);
    if (d < bestD) [best, bestD] = [i, d];
  });
  return best;
}

// ───────── parseLook ─────────

/** The group as a fresh object in `Look` key order when every field is valid, else null. */
function readGroup(v: unknown, g: GroupName, people: PeopleId): Record<string, number | null> | null {
  const spec = SCHEMA[g];
  if (!isRecord(v) || !exactKeys(v, spec.map(([k]) => k))) return null;
  const out: Record<string, number | null> = {};
  for (const [k, kind, limit] of spec) {
    const x = v[k];
    if (kind === 'int') {
      const hi = g === 'ears' && k === 'style' ? PEOPLES[people].earsMax : limit;
      if (!isIntIn(x, 0, hi)) return null;
    } else if (!(isColour(x) || (kind === 'colour?' && x === null))) return null;
    out[k] = x as number | null;
  }
  return out;
}

function parseStrict(v: unknown): Look | null {
  if (!isRecord(v) || !exactKeys(v, LOOK_KEYS) || v.v !== 2 || !isPeopleId(v.people)) return null;
  if (v.body !== 'male' && v.body !== 'female') return null;
  const people = v.people;
  const out: Record<string, unknown> = { v: 2, people, body: v.body };
  for (const g of GROUP_NAMES) {
    if (g === 'fur' && !PEOPLES[people].furred) {
      if (v.fur !== null) return null;
      out.fur = null;
      continue;
    }
    const grp = readGroup(v[g], g, people);
    if (!grp) return null;
    out[g] = grp;
  }
  return out as unknown as Look;
}

/**
 * A strict, fresh copy of `v` as a v2 `Look`: exact keys, integers in range, colours within the lightness clamp,
 * fur exactly for a furred people, ears within the people's. Anything else (and anything that throws while being
 * read, such as a getter or a proxy) gives null: it never throws. No free text is part of a look.
 */
export function parseLook(v: unknown): Look | null {
  try {
    return parseStrict(v);
  } catch {
    return null;
  }
}

/** A stored or sent look as v2: a v2 look as parseLook reads it, or a valid v1 look upgraded (upgradeLookV1). Never throws. */
export function readLook(v: unknown): Look | null {
  try {
    if (isRecord(v) && v.v === 1) {
      const l1 = parseLookV1(v);
      return l1 && upgradeLookV1(l1);
    }
    return parseStrict(v);
  } catch {
    return null;
  }
}

/**
 * Whether a stored look is a v1 look (`v` is 1): its adventurer gets one free visit to the v2 creator until a v2
 * look is saved (the stores' on-read rule; PgStore's SQL tests `look->>'v' = '1'` the same way). Never throws.
 */
export function storedLookIsV1(v: unknown): boolean {
  try {
    return isRecord(v) && v.v === 1;
  } catch {
    return false;
  }
}

// ───────── v1 ↔ v2 ─────────

const V1_MARK_TO_PAINT: Readonly<Record<number, number>> = Object.freeze({ 4: 1, 6: 2, 7: 3 });
const PAINT_TO_V1_MARK: readonly number[] = Object.freeze([0, 4, 6, 7, 4, 4, 7, 4]);
const UPPER_LIP_MOLE = 1 << 2;

/**
 * The v2 look closest to a v1 look: the same people, sliders (v1 `build` → `weight`), ears, hair and facial hair
 * styles (the v1 numbers are the first v2 entries), eyes and brows (likewise), stance, walk and dyes; the v1 face
 * shape, nose and mouth become their head, nose and mouth sliders (FACE_SHAPE_PRESETS, NOSE_PRESETS, MOUTH_PRESETS);
 * the v1 mark becomes freckles, a scar, the upper-lip mole or face paint; colours are kept, lightness-clamped; the
 * new choices sit at their middle or none; age 0. `body` is 'female' only when the v1 look has no facial hair and
 * hips at least 4 steps wider than shoulders, else 'male'. lookV1View(upgradeLookV1(l)) gives l back (colours clamped).
 */
export function upgradeLookV1(l: LookV1): Look {
  const c = clampLookColour;
  const b = l.body;
  const m = l.face.marks;
  return {
    v: 2, people: l.people,
    body: l.hair.facial === 0 && b.hips - b.shoulders >= 4 ? 'female' : 'male',
    build: { height: b.height, shoulders: b.shoulders, chest: 10, waist: 10, hips: b.hips, arms: 10, legs: b.legs, muscle: 10, weight: b.build, neck: 10, head: b.head },
    face: { ...fromPreset(FACE_KEYS, FACE_SHAPE_PRESETS[l.face.shape]!), age: 0 },
    eyes: { shape: l.face.eyes, size: 5, spacing: 5, height: 5, tilt: 5, openness: 5, colour: c(l.colours.eyes), colour2: null },
    brows: { shape: l.face.brows, thickness: 5, height: 5, tilt: 5, colour: null },
    nose: fromPreset(NOSE_KEYS, NOSE_PRESETS[l.face.nose]!),
    mouth: fromPreset(MOUTH_KEYS, MOUTH_PRESETS[l.face.mouth]!),
    ears: { size: 5, angle: 5, style: l.face.ears },
    skin: { colour: c(l.colours.skin), freckles: m === 1 ? 2 : 0, moles: m === 5 ? UPPER_LIP_MOLE : 0, scar: m === 2 ? 1 : m === 3 ? 2 : 0, blush: 0 },
    makeup: { lips: 0, shadow: 0, liner: 0 },
    hair: { style: l.hair.style, hairline: 0, colour: c(l.colours.hair), colour2: null, grey: 0, facial: l.hair.facial, facialColour: c(l.colours.facial) },
    paint: { style: V1_MARK_TO_PAINT[m] ?? 0, colour: c(l.colours.marks) },
    fur: l.fur && { pattern: l.fur.pattern, colour: c(l.fur.colour), tail: l.fur.tail, muzzle: l.face.nose },
    style: { stance: l.style.stance, walk: l.style.walk },
    outfit: { dye1: l.outfit.dye1, dye2: l.outfit.dye2 },
  };
}

/**
 * The v1 look the pre-v2 client draws a v2 look with (until the client is rebuilt): nearest v1 face shape, nose
 * and mouth; eyes, brows, hair and facial hair through their v1 fallbacks; one v1 mark (paint, then scar, then a
 * mole, then freckles); `weight` as v1 `build`. Always a valid v1 look.
 */
export function lookV1View(l: Look): LookV1 {
  const s = l.skin;
  const marks = l.paint.style > 0 ? PAINT_TO_V1_MARK[l.paint.style]! : s.scar > 0 ? (s.scar === 2 ? 3 : 2) : s.moles > 0 ? 5 : s.freckles > 0 ? 1 : 0;
  return {
    v: 1, people: l.people,
    body: { height: l.build.height, build: l.build.weight, shoulders: l.build.shoulders, hips: l.build.hips, legs: l.build.legs, head: l.build.head },
    face: {
      shape: nearest(FACE_SHAPE_PRESETS, l.face, FACE_KEYS), eyes: EYES_V1[l.eyes.shape]!, brows: BROWS_V1[l.brows.shape]!,
      nose: l.fur ? l.fur.muzzle : nearest(NOSE_PRESETS, l.nose, NOSE_KEYS), mouth: nearest(MOUTH_PRESETS, l.mouth, MOUTH_KEYS),
      ears: l.ears.style, marks,
    },
    hair: { style: HAIR_STYLE_INFO[l.hair.style]!.v1, facial: FACIAL_V1[l.hair.facial]! },
    colours: { skin: s.colour, hair: l.hair.colour, facial: l.hair.facialColour, eyes: l.eyes.colour, marks: l.paint.colour },
    fur: l.fur && { pattern: l.fur.pattern, colour: l.fur.colour, tail: l.fur.tail },
    style: { stance: l.style.stance, walk: l.style.walk },
    outfit: { dye1: l.outfit.dye1, dye2: l.outfit.dye2 },
  };
}

/**
 * A look sent by the pre-v2 creator (a v1 look, `v` unknown until parsed) applied onto the current v2 look: only
 * what differs from lookV1View(current) changes (each v1 field to its v2 fields, as upgradeLookV1 maps them), so
 * the body and every v2-only detail are kept. A new people takes the whole upgrade, keeping the body. Null for an
 * invalid v1 look. Never throws. (The interim path: the server takes v1 looks this way until the client sends v2.)
 */
export function mergeLookV1(current: Look, v: unknown): Look | null {
  try {
    const l1 = parseLookV1(v);
    if (!l1) return null;
    const up = upgradeLookV1(l1);
    if (l1.people !== current.people) return parseLook({ ...up, body: current.body });
    const was = lookV1View(current);
    const out = JSON.parse(JSON.stringify(current)) as Record<string, Record<string, unknown> | null>;
    const take = (g: GroupName, keys: readonly string[]) => {
      for (const k of keys) out[g]![k] = (up[g] as unknown as Record<string, unknown>)[k];
    };
    const diff = <G extends 'body' | 'face' | 'hair' | 'colours' | 'style' | 'outfit'>(g: G, k: keyof LookV1[G]) => l1[g][k] !== was[g][k];
    const BODY: readonly [keyof LookV1['body'], keyof LookBuild][] = [['height', 'height'], ['build', 'weight'], ['shoulders', 'shoulders'], ['hips', 'hips'], ['legs', 'legs'], ['head', 'head']];
    for (const [a, b] of BODY) if (diff('body', a)) take('build', [b]);
    if (diff('face', 'shape')) take('face', FACE_KEYS);
    if (diff('face', 'eyes')) take('eyes', ['shape']);
    if (diff('face', 'brows')) take('brows', ['shape']);
    if (diff('face', 'nose')) {
      take('nose', NOSE_KEYS);
      if (out.fur) take('fur', ['muzzle']);
    }
    if (diff('face', 'mouth')) take('mouth', MOUTH_KEYS);
    if (diff('face', 'ears')) take('ears', ['style']);
    if (diff('face', 'marks')) {
      take('skin', ['freckles', 'moles', 'scar']);
      take('paint', ['style']);
    }
    if (diff('hair', 'style')) take('hair', ['style']);
    if (diff('hair', 'facial')) take('hair', ['facial']);
    if (diff('colours', 'skin')) take('skin', ['colour']);
    if (diff('colours', 'hair')) take('hair', ['colour']);
    if (diff('colours', 'facial')) take('hair', ['facialColour']);
    if (diff('colours', 'eyes')) take('eyes', ['colour']);
    if (diff('colours', 'marks')) take('paint', ['colour']);
    if (l1.fur && was.fur) for (const k of ['pattern', 'colour', 'tail'] as const) if (l1.fur[k] !== was.fur[k]) take('fur', [k]);
    for (const k of ['stance', 'walk'] as const) if (diff('style', k)) take('style', [k]);
    for (const k of ['dye1', 'dye2'] as const) if (diff('outfit', k)) take('outfit', [k]);
    return parseLook(out);
  } catch {
    return null;
  }
}

// ───────── the look code ─────────
// v2: every field is one digit of a mixed-radix number, most significant first: the version (radix 16, = 2),
// the people (4), the body (2), then every group's fields in SCHEMA order (an integer's radix is its range;
// a colour's 2^24; an optional colour's 2^24 + 1, 0 = null). Fur digits are 0 for peoples without fur. The
// number is written as LOOK_CODE_BYTES big-endian bytes, then base64url without padding (LOOK_CODE_CHARS).
// Decoding is strict (the code must be exactly what encodeLook writes for a valid look). A v1 code is 38
// characters, a v2 code LOOK_CODE_CHARS: decodeLook tells them apart by length and upgrades v1.

const SKIN_V = 2;
const radixOf = (kind: Kind, hi: number) => (kind === 'int' ? hi + 1 : kind === 'colour' ? 0x1000000 : 0x1000001);
const DIGITS: readonly (readonly [GroupName, string, Kind, number])[] = Object.freeze(
  GROUP_NAMES.flatMap((g) => SCHEMA[g].map(([k, kind, hi]) => [g, k, kind, radixOf(kind, hi)] as const)),
);
/** The v2 code's size: 54 bytes, 72 base64url characters (the digits need about 432 of its 432 bits; see the spec's Numbers). */
export const LOOK_CODE_BYTES = 54;
export const LOOK_CODE_CHARS = Math.ceil((LOOK_CODE_BYTES * 8) / 6);
const V1_CODE_CHARS = 38;
{
  let max = 16n * 4n * 2n;
  for (const [, , , r] of DIGITS) max *= BigInt(r);
  if (max > 1n << BigInt(LOOK_CODE_BYTES * 8)) throw new Error('look.ts: the v2 code does not fit LOOK_CODE_BYTES');
}

/** The look's compact code: 54 bytes, 72 base64url characters. Throws on an invalid look. */
export function encodeLook(l: Look): string {
  const look = parseLook(l);
  if (!look) throw new RangeError('encodeLook: not a valid look');
  let n = BigInt(SKIN_V);
  n = n * 4n + BigInt(PEOPLE_IDS.indexOf(look.people));
  n = n * 2n + BigInt(BODY_TYPES.indexOf(look.body));
  for (const [g, k, kind, radix] of DIGITS) {
    const grp = look[g] as Record<string, number | null> | null;
    const x = grp ? grp[k]! : 0;
    n = n * BigInt(radix) + BigInt(kind === 'colour?' ? (x === null ? 0 : x + 1) : x);
  }
  const bytes: number[] = new Array<number>(LOOK_CODE_BYTES).fill(0);
  for (let i = LOOK_CODE_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(n & 255n);
    n >>= 8n;
  }
  return toBase64Url(bytes);
}

function decodeV2(s: string): Look | null {
  const bytes = fromBase64Url(s, LOOK_CODE_BYTES);
  if (!bytes) return null;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const digits: number[] = [];
  for (let i = DIGITS.length - 1; i >= 0; i--) {
    const radix = BigInt(DIGITS[i]![3]);
    digits[i] = Number(n % radix);
    n /= radix;
  }
  const body = BODY_TYPES[Number(n % 2n)]!;
  n /= 2n;
  const people = PEOPLE_IDS[Number(n % 4n)]!;
  n /= 4n;
  if (n !== BigInt(SKIN_V)) return null; // the version, and nothing above it
  const draft: Record<string, unknown> = { v: 2, people, body };
  for (const g of GROUP_NAMES) draft[g] = {};
  DIGITS.forEach(([g, k, kind], i) => {
    const d = digits[i]!;
    (draft[g] as Record<string, number | null>)[k] = kind === 'colour?' ? (d === 0 ? null : d - 1) : d;
  });
  if (!PEOPLES[people].furred) {
    if (Object.values(draft.fur as Record<string, number>).some((d) => d !== 0)) return null;
    draft.fur = null;
  }
  const look = parseLook(draft);
  return look && encodeLook(look) === s ? look : null;
}

/** The v2 look a code describes (a v1 code is decoded and upgraded), or null unless the code is exactly what an encoder writes for a valid look. */
export function decodeLook(s: string): Look | null {
  if (typeof s !== 'string') return null;
  if (s.length === V1_CODE_CHARS) {
    const l1 = decodeLookV1(s);
    return l1 && upgradeLookV1(l1);
  }
  return s.length === LOOK_CODE_CHARS ? decodeV2(s) : null;
}

// ───────── presets ─────────

export interface LookPreset { readonly id: string; readonly name: string; readonly look: Look }

interface PresetSpec {
  people: PeopleId; body: BodyType; age: number; skin: string; hair: [style: number, colour: string, facial?: number];
  eyes: [shape: number, colour: string]; face?: number; nose?: number; mouth?: number; brows?: number; ears?: number;
  build?: Partial<Record<keyof LookBuild, number>>; makeup?: [number, number, number]; marks?: Partial<Look['skin']>; paint?: [number, string];
  fur?: [pattern: number, colour: string, tail: number, muzzle: number]; grey?: number; hairline?: number; colour2?: string;
}

function makePreset(s: PresetSpec): Look {
  const c = (h: string) => clampLookColour(hex(h));
  const fem = s.body === 'female';
  return {
    v: 2, people: s.people, body: s.body,
    build: {
      height: 10, shoulders: 10, chest: 10, waist: 10, hips: 10, arms: 10, legs: 10, muscle: fem ? 9 : 11, weight: 10, neck: 10, head: 10, ...s.build,
    },
    face: { ...fromPreset(FACE_KEYS, FACE_SHAPE_PRESETS[s.face ?? 1]!), age: s.age },
    eyes: { shape: s.eyes[0], size: fem ? 6 : 5, spacing: 5, height: 5, tilt: 5, openness: 5, colour: c(s.eyes[1]), colour2: null },
    brows: { shape: s.brows ?? (fem ? 1 : 0), thickness: fem ? 4 : 6, height: 5, tilt: 5, colour: null },
    nose: fromPreset(NOSE_KEYS, NOSE_PRESETS[s.nose ?? 0]!),
    mouth: fromPreset(MOUTH_KEYS, MOUTH_PRESETS[s.mouth ?? 0]!),
    ears: { size: 5, angle: 5, style: s.ears ?? 1 },
    skin: { colour: c(s.skin), freckles: 0, moles: 0, scar: 0, blush: fem ? 1 : 0, ...s.marks },
    makeup: { lips: s.makeup?.[0] ?? 0, shadow: s.makeup?.[1] ?? 0, liner: s.makeup?.[2] ?? 0 },
    hair: {
      style: s.hair[0], hairline: s.hairline ?? 0, colour: c(s.hair[1]), colour2: s.colour2 ? c(s.colour2) : null,
      grey: s.grey ?? Math.max(0, s.age - 1), facial: s.hair[2] ?? 0, facialColour: c(s.hair[1]),
    },
    paint: { style: s.paint?.[0] ?? 0, colour: c(s.paint?.[1] ?? '#c99a3b') },
    fur: s.fur ? { pattern: s.fur[0], colour: c(s.fur[1]), tail: s.fur[2], muzzle: s.fur[3] } : null,
    style: { stance: 0, walk: 0 },
    outfit: { dye1: 0, dye2: 0 },
  };
}

const P = (id: string, name: string, s: PresetSpec): LookPreset => ({ id, name, look: makePreset(s) });
/** Named starting faces over both bodies, every people, every age and light to dark skin (data only). */
export const LOOK_PRESETS: readonly LookPreset[] = deepFreeze([
  P('harbour_pilot', 'Harbour Pilot', { people: 'human', body: 'male', age: 2, skin: '#8d5c3e', hair: [1, '#2a211c', 2], eyes: [0, '#3b2416'], face: 2, nose: 3, build: { shoulders: 12, chest: 12 } }),
  P('orchard_keeper', 'Orchard Keeper', { people: 'human', body: 'female', age: 3, skin: '#efd0b6', hair: [7, '#8b5e3c'], eyes: [5, '#5d7a8c'], face: 5, grey: 2, marks: { freckles: 2 } }),
  P('lane_runner', 'Lane Runner', { people: 'human', body: 'female', age: 0, skin: '#3f281c', hair: [37, '#16110f'], eyes: [1, '#2c1a10'], face: 0, mouth: 3, build: { height: 9, legs: 12 }, makeup: [1, 0, 1] }),
  P('smithy_hand', 'Smithy Hand', { people: 'human', body: 'male', age: 1, skin: '#c79469', hair: [16, '#3e2c21', 1], eyes: [6, '#5a3a22'], face: 2, nose: 5, build: { muscle: 15, arms: 13, neck: 13 }, marks: { scar: 1 } }),
  P('dune_trader', 'Dune Trader', { people: 'human', body: 'male', age: 4, skin: '#a08156', hair: [0, '#e4e2dc', 12], eyes: [8, '#6b6a35'], face: 4, nose: 6, grey: 4, build: { weight: 12 } }),
  P('reading_room', 'Reading Room', { people: 'human', body: 'female', age: 1, skin: '#d9ab87', hair: [18, '#2a211c'], eyes: [3, '#3b2416'], face: 1, nose: 1, makeup: [2, 1, 1], marks: { moles: 4 } }),
  P('fen_fisher', 'Fen Fisher', { people: 'human', body: 'male', age: 0, skin: '#271812', hair: [38, '#1b1e2a', 0], eyes: [7, '#3b2416'], face: 1, mouth: 2, build: { height: 12 } }),
  P('bark_warden', 'Bark Warden', { people: 'larchfolk', body: 'male', age: 3, skin: '#bba98d', hair: [11, '#4e4934', 3], eyes: [9, '#4f6b3a'], face: 4, nose: 2, brows: 3, ears: 2 }),
  P('canopy_singer', 'Canopy Singer', { people: 'larchfolk', body: 'female', age: 0, skin: '#ece2d0', hair: [29, '#cbc4aa'], eyes: [4, '#7f9a55'], face: 3, ears: 3, makeup: [9, 11, 0] }),
  P('larch_elder', 'Larch Elder', { people: 'larchfolk', body: 'female', age: 4, skin: '#8c6e57', hair: [33, '#e4e2dc'], eyes: [10, '#9aa6ad'], face: 4, grey: 4, ears: 2 }),
  P('ridge_scout', 'Ridge Scout', { people: 'larchfolk', body: 'male', age: 1, skin: '#aeb79e', hair: [8, '#6c7849'], eyes: [11, '#6b6a35'], face: 1, ears: 3, paint: [1, '#4f7a3a'] }),
  P('moss_weaver', 'Moss Weaver', { people: 'larchfolk', body: 'female', age: 2, skin: '#7f8c6f', hair: [12, '#3d4a52'], eyes: [2, '#5f6b73'], face: 5, ears: 1, colour2: '#6c7849' }),
  P('pine_archer', 'Pine Archer', { people: 'larchfolk', body: 'male', age: 0, skin: '#cdb99c', hair: [4, '#7b3e25'], eyes: [0, '#4f6b3a'], face: 2, ears: 2, build: { arms: 12 } }),
  P('resin_healer', 'Resin Healer', { people: 'larchfolk', body: 'female', age: 1, skin: '#5f4838', hair: [43, '#2a2920'], eyes: [6, '#7a5a2e'], face: 1, ears: 0, paint: [2, '#c99a3b'] }),
  P('burrow_cook', 'Burrow Cook', { people: 'knollfolk', body: 'female', age: 2, skin: '#e4ab8b', hair: [10, '#b6652c'], eyes: [1, '#5a3a22'], face: 0, mouth: 3, build: { weight: 13 }, marks: { freckles: 3, blush: 3 } }),
  P('lamp_tinker', 'Lamp Tinker', { people: 'knollfolk', body: 'male', age: 1, skin: '#cb8d66', hair: [2, '#3b2617', 5], eyes: [7, '#6e4527'], face: 0, nose: 4 }),
  P('hill_grandmother', 'Hill Grandmother', { people: 'knollfolk', body: 'female', age: 4, skin: '#f4d2b6', hair: [9, '#f6f6f1'], eyes: [10, '#2f5d8a'], face: 5, grey: 4, marks: { moles: 8 } }),
  P('tunnel_miner', 'Tunnel Miner', { people: 'knollfolk', body: 'male', age: 3, skin: '#7e5036', hair: [22, '#3b2617', 4], eyes: [8, '#3b2416'], face: 2, nose: 5, build: { muscle: 15, shoulders: 13 }, marks: { scar: 3 } }),
  P('bramble_kid', 'Bramble Kid', { people: 'knollfolk', body: 'female', age: 0, skin: '#5b3827', hair: [15, '#6c4527'], eyes: [4, '#7a5a2e'], face: 0, build: { height: 8 } }),
  P('cellar_brewer', 'Cellar Brewer', { people: 'knollfolk', body: 'male', age: 2, skin: '#9b6343', hair: [21, '#e19149', 3], eyes: [0, '#4f6b3a'], face: 0, build: { weight: 14 } }),
  P('russet_prowler', 'Russet Prowler', { people: 'brindlekin', body: 'male', age: 1, skin: '#b55b2b', hair: [17, '#2b221c'], eyes: [11, '#e0a93a'], ears: 0, fur: [3, '#f1e9db', 1, 4] }),
  P('snowpelt', 'Snowpelt', { people: 'brindlekin', body: 'female', age: 0, skin: '#f3efe7', hair: [6, '#dad3c5'], eyes: [4, '#6d9ccc'], ears: 4, fur: [0, '#dad3c5', 1, 2] }),
  P('old_greymuzzle', 'Old Greymuzzle', { people: 'brindlekin', body: 'male', age: 4, skin: '#6f6963', hair: [20, '#8b8680'], eyes: [8, '#b07a1c'], ears: 3, grey: 4, fur: [3, '#dad3c5', 2, 6], marks: { scar: 7 } }),
  P('tawny_courier', 'Tawny Courier', { people: 'brindlekin', body: 'female', age: 1, skin: '#c98a4b', hair: [7, '#4e3d31'], eyes: [0, '#b07a1c'], ears: 1, fur: [2, '#6c4b33', 3, 3] }),
  P('dusk_stripe', 'Dusk Stripe', { people: 'brindlekin', body: 'male', age: 2, skin: '#4b4541', hair: [23, '#2b221c'], eyes: [11, '#e0a93a'], ears: 5, fur: [1, '#2b221c', 0, 5], paint: [7, '#ece6da'] }),
  P('spotted_dancer', 'Spotted Dancer', { people: 'brindlekin', body: 'female', age: 3, skin: '#e1b17b', hair: [12, '#8b5b35'], eyes: [4, '#7a5a2e'], ears: 2, fur: [2, '#4e3d31', 2, 1], makeup: [0, 3, 1] }),
].map((p) => {
  const look = parseLook(p.look);
  if (!look) throw new Error(`look.ts: preset ${p.id} is not a valid look`);
  return { ...p, look };
}));

// ───────── random and default looks ─────────

/**
 * A random, plausible look from a seeded generator (the creator's "Surprise me", the bots): a random people and
 * body, then one of that people's presets for that body, varied around it (sliders by a small spread and
 * sometimes anywhere, choices kept or redrawn, colours from the palettes and the people's ranges). Always valid.
 */
export function randomLook(rng: () => number): Look {
  const int = (n: number) => Math.min(n - 1, Math.floor(rng() * n));
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const people = pick(PEOPLE_IDS);
  const body = pick(BODY_TYPES);
  const p = PEOPLES[people];
  const base = pick(LOOK_PRESETS.filter((x) => x.look.people === people && x.look.body === body)).look;
  const clampTo = (x: number, hi: number) => Math.max(0, Math.min(hi, x));
  /** Near v (a spread of about `sd` steps), or anywhere in 0..hi with probability `free`. */
  const near = (v: number, hi: number, sd: number, free: number) =>
    rng() < free ? int(hi + 1) : clampTo(Math.round(v + (rng() + rng() + rng() - 1.5) * 2 * sd), hi);
  const keepOr = (v: number, n: number, keep: number) => (rng() < keep ? v : int(n));
  const range = (ranges: readonly (readonly [string, string])[]) => {
    const [a, b] = pick(ranges);
    return clampLookColour(lerpColour(a, b, rng()));
  };
  const palette = (xs: readonly NamedColour[]) => pick(xs).colour;
  const sliders = <T extends object>(o: T, hi: number, sd: number, free: number): T =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, near(v as number, hi, sd, free)])) as T;

  const fem = body === 'female';
  const age = keepOr(base.face.age, 5, 0.6);
  let skin: number;
  if (people === 'human') {
    const at = SKIN_TONES.findIndex((t) => t.colour === base.skin.colour);
    const i = clampTo((at < 0 ? int(SKIN_TONES.length) : at) + Math.round((rng() - 0.5) * 8), SKIN_TONES.length - 1);
    skin = rng() < 0.85 ? SKIN_TONES[i]!.colour : clampLookColour(lerpColour(`#${SKIN_TONES[i]!.colour.toString(16).padStart(6, '0')}`, `#${SKIN_TONES[clampTo(i + 1, SKIN_TONES.length - 1)]!.colour.toString(16).padStart(6, '0')}`, rng()));
  } else skin = rng() < 0.4 ? base.skin.colour : range(p.skinRange);
  const hairColour = rng() < 0.5 ? base.hair.colour : rng() < 0.5 ? range(p.hairRange) : palette(HAIR_COLOURS);
  const eyeColour = p.furred && rng() < 0.5 ? palette(EYE_COLOURS.slice(-2)) : rng() < 0.3 ? base.eyes.colour : palette(EYE_COLOURS);
  const facial = fem ? (rng() < 0.97 ? 0 : int(FACIAL_HAIR.length)) : rng() < 0.5 ? base.hair.facial : int(FACIAL_HAIR.length);
  const makeup = (chance: number, n: number) => (rng() < chance ? 1 + int(n) : 0);
  const look: Look = {
    v: 2, people, body,
    build: sliders(base.build, 20, 2, 0.2),
    face: { ...sliders(fromPreset(FACE_KEYS, FACE_KEYS.map((k) => base.face[k])), 10, 1.2, 0.15), age },
    eyes: {
      ...sliders({ size: base.eyes.size, spacing: base.eyes.spacing, height: base.eyes.height, tilt: base.eyes.tilt, openness: base.eyes.openness }, 10, 1.2, 0.15),
      shape: keepOr(base.eyes.shape, EYE_SHAPES.length, 0.6), colour: eyeColour, colour2: rng() < 0.03 ? palette(EYE_COLOURS) : null,
    },
    brows: {
      ...sliders({ thickness: base.brows.thickness, height: base.brows.height, tilt: base.brows.tilt }, 10, 1.2, 0.15),
      shape: keepOr(base.brows.shape, BROW_SHAPES.length, 0.6), colour: rng() < 0.85 ? null : palette(HAIR_COLOURS),
    },
    nose: sliders(base.nose, 10, 1.2, 0.15),
    mouth: sliders(base.mouth, 10, 1.2, 0.15),
    ears: { size: near(base.ears.size, 10, 1.2, 0.15), angle: near(base.ears.angle, 10, 1.2, 0.15), style: int(p.earsMax + 1) },
    skin: {
      colour: skin, freckles: rng() < 0.75 ? 0 : 1 + int(4), moles: rng() < 0.7 ? 0 : 1 << int(MOLE_SPOTS.length),
      scar: rng() < 0.85 ? 0 : 1 + int(SCARS.length - 1), blush: rng() < 0.6 ? 0 : 1 + int(4),
    },
    makeup: fem
      ? { lips: makeup(0.4, LIP_COLOURS.length), shadow: makeup(0.3, SHADOW_COLOURS.length), liner: makeup(0.25, LINER_COLOURS.length) }
      : { lips: makeup(0.04, LIP_COLOURS.length), shadow: makeup(0.04, SHADOW_COLOURS.length), liner: makeup(0.06, LINER_COLOURS.length) },
    hair: {
      style: keepOr(base.hair.style, HAIR_STYLES.length, 0.55), hairline: keepOr(base.hair.hairline, HAIRLINES.length, 0.7), colour: hairColour,
      colour2: rng() < 0.1 ? palette(HAIR_COLOURS) : null, grey: clampTo(age - 1 + int(3) - 1 + (rng() < 0.1 ? int(5) : 0), 4),
      facial, facialColour: rng() < 0.75 ? hairColour : palette(HAIR_COLOURS),
    },
    paint: { style: rng() < 0.8 ? 0 : 1 + int(FACE_PAINTS.length - 1), colour: palette(PAINT_COLOURS) },
    fur: p.furred && base.fur
      ? { pattern: keepOr(base.fur.pattern, 4, 0.5), colour: range(p.hairRange), tail: keepOr(base.fur.tail, 4, 0.5), muzzle: near(base.fur.muzzle, 7, 1.2, 0.2) }
      : null,
    style: { stance: int(4), walk: int(4) },
    outfit: { dye1: int(32), dye2: int(32) },
  };
  const ok = parseLook(look);
  if (!ok) throw new Error('randomLook: produced an invalid look'); // a bug, never data
  return ok;
}

/**
 * The look of an adventurer who has not used the creator: the Plan 5 default (lookV1.ts defaultLookV1) upgraded,
 * so nobody's adventurer changes unasked. The same for the same seed.
 */
export function defaultLook(seed: string): Look {
  return upgradeLookV1(defaultLookV1(seed));
}

/** A seeded random look from a string (a stable "Surprise me" per name; unused by the server). */
export const seededLook = (seed: string): Look => randomLook(seededRng(cyrb53(seed, 0x200c)));

// ───────── the Barber ─────────

export const BARBER_PRICE = 40;
export const BARBER_PEOPLE_PRICE = 200;
/** Changing the base body costs the same as changing people. */
export const BARBER_BODY_PRICE = 200;

/** Gold the Barber asks: 0 if the codes are equal, 200 if the people or the body changes, else 40. */
export function barberCost(from: Look, to: Look): number {
  if (from.people !== to.people) return BARBER_PEOPLE_PRICE;
  if (from.body !== to.body) return BARBER_BODY_PRICE;
  return encodeLook(from) === encodeLook(to) ? 0 : BARBER_PRICE;
}

// ───────── how many looks ─────────

/** The number of distinct looks: per people without free colours and dyes, and in all with them (approximate, a float). */
export const LOOK_COMBINATIONS: { readonly discrete: Readonly<Record<PeopleId, number>>; readonly withColours: number } = deepFreeze(
  (() => {
    const discrete = {} as Record<PeopleId, number>;
    let withColours = 0;
    for (const id of PEOPLE_IDS) {
      let n = BODY_TYPES.length;
      let colours = 1;
      for (const [g, k, kind, radix] of DIGITS) {
        if (g === 'fur' && !PEOPLES[id].furred) continue;
        if (g === 'outfit') continue;
        if (kind !== 'int') colours *= radix;
        else n *= g === 'ears' && k === 'style' ? PEOPLES[id].earsMax + 1 : radix;
      }
      discrete[id] = n;
      withColours += n * colours * 32 * 32;
    }
    return { discrete, withColours };
  })(),
);
