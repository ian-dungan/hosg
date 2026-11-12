// Costumes and dyes: appearance only. A costume never changes a stat or a mod (kitFor never reads this
// module), it is never an item (it lives in the wardrobe: it cannot be sold, banked or lost), and there is
// never a real-money price. Kept apart from items.ts so jobs.ts can check costume ids without a cycle.
// No runtime imports but deepFreeze.
import { deepFreeze } from './combat/freeze';

export type CostumeSlot = 'body' | 'head' | 'back';
export const COSTUME_SLOTS: readonly CostumeSlot[] = Object.freeze(['body', 'head', 'back']);

export type CostumeId =
  | 'lamplighter_coat' | 'solstice_finery' | 'orchard_smock' | 'harbour_oilskin' | 'mothsilk_gown' | 'ploughmans_weeds'
  | 'straw_sunhat' | 'brass_goggles' | 'owlfeather_circlet' | 'patchwork_cape' | 'kitewing_mantle' | 'mapmakers_satchel'
  | 'starfall_regalia' | 'beacon_halo';

/** price: gold at the Tailor, or null for an event-only costume (a GM grant). model: 200..255 (look.ts's costume range). */
export interface CostumeData { readonly id: CostumeId; readonly name: string; readonly slot: CostumeSlot; readonly price: number | null; readonly model: number }

const C = (id: CostumeId, name: string, slot: CostumeSlot, price: number | null, model: number): CostumeData => ({ id, name, slot, price, model });

export const COSTUMES: Readonly<Record<CostumeId, CostumeData>> = deepFreeze({
  lamplighter_coat: C('lamplighter_coat', "Lamplighter's Coat", 'body', 400, 200),
  solstice_finery: C('solstice_finery', 'Solstice Finery', 'body', 1200, 201),
  orchard_smock: C('orchard_smock', 'Orchard Smock', 'body', 300, 202),
  harbour_oilskin: C('harbour_oilskin', 'Harbour Oilskin', 'body', 500, 203),
  mothsilk_gown: C('mothsilk_gown', 'Moth-Silk Gown', 'body', 900, 204),
  ploughmans_weeds: C('ploughmans_weeds', "Ploughman's Weeds", 'body', 300, 205),
  straw_sunhat: C('straw_sunhat', 'Straw Sunhat', 'head', 150, 206),
  brass_goggles: C('brass_goggles', 'Brass Goggles', 'head', 400, 207),
  owlfeather_circlet: C('owlfeather_circlet', 'Owl-Feather Circlet', 'head', 350, 208),
  patchwork_cape: C('patchwork_cape', 'Patchwork Cape', 'back', 200, 209),
  kitewing_mantle: C('kitewing_mantle', 'Kite-Wing Mantle', 'back', 600, 210),
  mapmakers_satchel: C('mapmakers_satchel', "Mapmaker's Satchel", 'back', 250, 211),
  starfall_regalia: C('starfall_regalia', 'Starfall Regalia', 'body', null, 212),
  beacon_halo: C('beacon_halo', 'Beacon Halo', 'head', null, 213),
});

/** In table order. */
export const COSTUME_IDS: readonly CostumeId[] = Object.freeze(Object.keys(COSTUMES) as CostumeId[]);

const own = (o: object, k: unknown): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export function isCostumeId(v: unknown): v is CostumeId { return own(COSTUMES, v); }

/** A dye id, 0..31: 0 is Undyed (the piece's own colours). */
export type DyeId = number;
export const DYE_COUNT = 32;
export function isDyeId(v: unknown): v is DyeId { return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < DYE_COUNT; }

/** The 32 dyes: [0] Undyed; 1–8 warm, 9–16 greens and blues, 17–24 violets and pinks, 25–31 neutrals and metals. */
export const DYES: readonly { readonly name: string; readonly hex: string }[] = deepFreeze([
  { name: 'Undyed', hex: '#000000' },
  // warm
  { name: 'Hearth Red', hex: '#b8322a' }, { name: 'Ember Orange', hex: '#d8662a' }, { name: 'Lampflame', hex: '#e89a2e' }, { name: 'Marigold', hex: '#e8b83a' },
  { name: 'Rosehip', hex: '#c4504a' }, { name: 'Brick Dust', hex: '#9a4a36' }, { name: 'Apricot', hex: '#e8a070' }, { name: 'Rust', hex: '#8a3e1e' },
  // greens and blues
  { name: 'Moss', hex: '#5a7a32' }, { name: 'Fern', hex: '#3e8a4a' }, { name: 'Willow', hex: '#8aa860' }, { name: 'Pondweed', hex: '#2e5a44' },
  { name: 'Kingfisher', hex: '#1e7aa8' }, { name: 'River Slate', hex: '#46708a' }, { name: 'Harbour Blue', hex: '#284a7a' }, { name: 'Mistwater', hex: '#8ab4c4' },
  // violets and pinks
  { name: 'Dusk Violet', hex: '#5a3a7a' }, { name: 'Heather', hex: '#8a6aa0' }, { name: 'Plum', hex: '#6a2a4a' }, { name: 'Foxglove', hex: '#b0508a' },
  { name: 'Thistle', hex: '#b08ac0' }, { name: 'Blossom', hex: '#e8a8b8' }, { name: 'Mulberry', hex: '#7a2a5a' }, { name: 'Lilac Smoke', hex: '#a898b8' },
  // neutrals and metals
  { name: 'Chalk', hex: '#ece6d8' }, { name: 'Ash', hex: '#a8a49c' }, { name: 'Soot', hex: '#2a2826' }, { name: 'Pewter', hex: '#7a7e82' },
  { name: 'Brass', hex: '#b8963a' }, { name: 'Copper', hex: '#b06a3a' }, { name: 'Beacon Gold', hex: '#e8c040' },
]);
