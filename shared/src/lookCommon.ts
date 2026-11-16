// Shared by both look versions (lookV1.ts, look.ts): the four peoples, frozen tables, strict-key helpers and
// base64url without padding. Pure; no imports.

export const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
    Object.freeze(v);
  }
  return v;
};

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

export const isPeopleId = (v: unknown): v is PeopleId => typeof v === 'string' && (PEOPLE_IDS as readonly string[]).includes(v);

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Whether `o` has exactly `keys` as its own keys. */
export function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

export const isIntIn = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

export const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX: Readonly<Record<string, number>> = Object.freeze(Object.fromEntries([...B64].map((c, i) => [c, i])));

/** Base64url without padding. */
export function toBase64Url(bytes: readonly number[]): string {
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
export function fromBase64Url(s: string, bytes: number): number[] | null {
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

const hex = (s: string) => parseInt(s.slice(1), 16);

/** A colour channel by channel between `a` and `b` at t in [0, 1). */
export function lerpColour(a: string, b: string, t: number): number {
  const [x, y] = [hex(a), hex(b)];
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const [p, q] = [(x >> shift) & 255, (y >> shift) & 255];
    out |= Math.min(255, Math.max(0, p + Math.round((q - p) * t))) << shift;
  }
  return out;
}

// ───────── names shared by both versions (index = value) ─────────

export type EmoteId = 'wave' | 'bow' | 'cheer' | 'laugh' | 'sit' | 'point';
export const EMOTES: readonly EmoteId[] = Object.freeze(['wave', 'bow', 'cheer', 'laugh', 'sit', 'point']);
export const STANCES: readonly string[] = Object.freeze(['Easy', 'Proud', 'Guarded', 'Sprightly']);
export const WALKS: readonly string[] = Object.freeze(['Stride', 'Stroll', 'Bounce', 'Prowl']);
export const FUR_PATTERNS: readonly string[] = Object.freeze(['Solid', 'Striped', 'Spotted', 'Masked']);
export const TAILS: readonly string[] = Object.freeze(['Short', 'Brush', 'Long', 'Ringed']);
/** `face.ears` for the Brindlekin, 0..5. (The others' ears 0..3 are lengths: Larchfolk ears are long and pointed, Knollfolk round.) */
export const BRINDLE_EARS: readonly string[] = Object.freeze(['Pointed', 'Round', 'Long', 'Folded', 'Tufted', 'Lop']);
