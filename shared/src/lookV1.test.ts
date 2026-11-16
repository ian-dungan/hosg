// Look v1 (kept for stored looks and old codes) and the peoples: the strict parser, the code, the varied defaults.
import { describe, expect, it } from 'vitest';
import { BRINDLE_EARS, EMOTES, FUR_PATTERNS, PEOPLE_IDS, PEOPLES, STANCES, TAILS, WALKS } from './lookCommon';
import {
  FACE_MARKS_V1, FACE_SHAPES_V1, FACIAL_HAIR_V1, HAIR_STYLES_V1, LOOK_LIMITS_V1, decodeLookV1, defaultLookV1, encodeLookV1, parseLookV1,
  randomLookV1, type LookV1,
} from './lookV1';
import { prng } from './world/recipe';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** encodeLookV1(defaultLookV1('account-1')) since Plan 5: v1 defaults are unchanged (look.ts defaultLook upgrades them). */
const DEFAULT_LOOK_1 = 'Ar8yr9nUliHwoAAAAC8cE7dPJyAYFIiUnCUiKw';

/** Reads or writes a dotted path ('face.eyes') of a look. */
function setPath(l: LookV1, path: string, value: unknown): LookV1 {
  const out = clone(l) as unknown as Record<string, Record<string, unknown>>;
  const [group, key] = path.split('.') as [string, string];
  out[group]![key] = value;
  return out as unknown as LookV1;
}

const human = (): LookV1 => ({ ...defaultLookFor('human') });
const brindle = (): LookV1 => ({ ...defaultLookFor('brindlekin') });
function defaultLookFor(people: LookV1['people']): LookV1 {
  for (let i = 0; ; i++) {
    const l = defaultLookV1(`seed-${people}-${i}`);
    if (l.people === people) return l;
  }
}

describe('peoples', () => {
  it('four peoples with their heights and spans, fur only on the Brindlekin, and colour ranges', () => {
    expect(PEOPLE_IDS).toEqual(['human', 'larchfolk', 'knollfolk', 'brindlekin']);
    expect(PEOPLE_IDS.map((p) => [PEOPLES[p].name, PEOPLES[p].heightM, PEOPLES[p].span])).toEqual([
      ['Humans', 1.75, 0.1], ['Larchfolk', 1.98, 0.08], ['Knollfolk', 1.3, 0.08], ['Brindlekin', 1.7, 0.1],
    ]);
    expect(PEOPLE_IDS.filter((p) => PEOPLES[p].furred)).toEqual(['brindlekin']);
    expect(PEOPLE_IDS.map((p) => PEOPLES[p].earsMax)).toEqual([3, 3, 3, 5]);
    for (const p of PEOPLE_IDS) {
      expect(PEOPLES[p].id).toBe(p);
      expect(PEOPLES[p].blurb.length).toBeGreaterThan(20);
      for (const [a, b] of [...PEOPLES[p].skinRange, ...PEOPLES[p].hairRange]) {
        expect(a).toMatch(/^#[0-9a-f]{6}$/);
        expect(b).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(PEOPLES[p].skinRange.length).toBeGreaterThanOrEqual(3);
      expect(PEOPLES[p].hairRange.length).toBeGreaterThanOrEqual(3);
    }
    expect(Object.isFrozen(PEOPLES) && Object.isFrozen(PEOPLES.human) && Object.isFrozen(LOOK_LIMITS_V1)).toBe(true);
  });

  it('names every choice the creator offers, one per value', () => {
    expect(EMOTES).toEqual(['wave', 'bow', 'cheer', 'laugh', 'sit', 'point']);
    expect(STANCES.length).toBe(LOOK_LIMITS_V1['style.stance']![1] + 1);
    expect(WALKS.length).toBe(LOOK_LIMITS_V1['style.walk']![1] + 1);
    expect(FACE_SHAPES_V1.length).toBe(LOOK_LIMITS_V1['face.shape']![1] + 1);
    expect(FACE_MARKS_V1.length).toBe(LOOK_LIMITS_V1['face.marks']![1] + 1);
    expect(HAIR_STYLES_V1.length).toBe(20);
    expect(FACIAL_HAIR_V1.length).toBe(LOOK_LIMITS_V1['hair.facial']![1] + 1);
    expect(FUR_PATTERNS.length).toBe(LOOK_LIMITS_V1['fur.pattern']![1] + 1);
    expect(TAILS.length).toBe(LOOK_LIMITS_V1['fur.tail']![1] + 1);
    expect(BRINDLE_EARS.length).toBe(PEOPLES.brindlekin.earsMax + 1);
    for (const list of [STANCES, WALKS, FACE_SHAPES_V1, FACE_MARKS_V1, HAIR_STYLES_V1, FACIAL_HAIR_V1, FUR_PATTERNS, TAILS, BRINDLE_EARS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('parseLookV1', () => {
  it('parseLookV1 accepts the limits and refuses one-off values, wrong keys, fur on a Human and no fur on Brindlekin', () => {
    const h = human();
    const b = brindle();
    expect(parseLookV1(h)).toEqual(h);
    expect(parseLookV1(b)).toEqual(b);
    let checked = 0;
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS_V1)) {
      const base = path.startsWith('fur.') || path === 'face.ears' ? b : h;
      expect(parseLookV1(setPath(base, path, lo)), `${path} = ${lo}`).not.toBeNull();
      expect(parseLookV1(setPath(base, path, hi)), `${path} = ${hi}`).not.toBeNull();
      for (const bad of [lo - 1, hi + 1, lo + 0.5, Number.NaN, Infinity, String(lo), null, undefined, true]) {
        expect(parseLookV1(setPath(base, path, bad)), `${path} = ${String(bad)}`).toBeNull();
      }
      checked++;
    }
    expect(checked).toBe(Object.keys(LOOK_LIMITS_V1).length);
    expect(checked).toBe(27);
    // Ears: up to 3 for most peoples, up to 5 for the Brindlekin.
    expect(parseLookV1(setPath(h, 'face.ears', 3))).not.toBeNull();
    expect(parseLookV1(setPath(h, 'face.ears', 4))).toBeNull();
    expect(parseLookV1(setPath(b, 'face.ears', 5))).not.toBeNull();
    // Fur exactly for the Brindlekin.
    expect(parseLookV1({ ...h, fur: { pattern: 0, colour: 0, tail: 0 } })).toBeNull();
    expect(parseLookV1({ ...b, fur: null })).toBeNull();
    expect(parseLookV1({ ...b, people: 'human' })).toBeNull();
    expect(parseLookV1({ ...h, people: 'brindlekin' })).toBeNull();
    // Keys exactly.
    expect(parseLookV1({ ...h, extra: 1 })).toBeNull();
    expect(parseLookV1({ ...h, body: { ...h.body, wings: 3 } })).toBeNull();
    const { mouth: _, ...noMouth } = h.face;
    expect(parseLookV1({ ...h, face: noMouth })).toBeNull();
    const { style: __, ...noStyle } = h;
    expect(parseLookV1(noStyle)).toBeNull();
    expect(parseLookV1({ ...h, v: 2 })).toBeNull();
    expect(parseLookV1({ ...h, people: 'skyfolk' })).toBeNull();
    expect(parseLookV1({ ...h, people: 'toString' })).toBeNull();
    for (const junk of [null, undefined, 0, 'look', [], [h], { ...h, body: [] }, { ...h, colours: null }]) expect(parseLookV1(junk)).toBeNull();
    // A fresh copy, not the input.
    const parsed = parseLookV1(h)!;
    expect(parsed).not.toBe(h);
    expect(parsed.body).not.toBe(h.body);
  });
});

describe('look codes', () => {
  it('encodeLookV1 ↔ decodeLookV1 round-trips 1000 random looks; at most 38 characters', () => {
    const rng = prng(7);
    for (let i = 0; i < 1000; i++) {
      const l = randomLookV1(rng);
      expect(parseLookV1(l), `look ${i}`).not.toBeNull();
      const code = encodeLookV1(l);
      expect(code.length).toBeLessThanOrEqual(38);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeLookV1(code)).toEqual(l);
    }
    // The extremes of every field round-trip too.
    for (const people of PEOPLE_IDS) {
      const fur = PEOPLES[people].furred;
      const corner = (pick: 0 | 1): LookV1 => {
        let l = setPath(defaultLookFor(people), 'face.ears', pick ? PEOPLES[people].earsMax : 0);
        for (const [path, range] of Object.entries(LOOK_LIMITS_V1)) {
          if (path === 'face.ears' || (path.startsWith('fur.') && !fur)) continue;
          l = setPath(l, path, range[pick]);
        }
        return l;
      };
      for (const l of [corner(0), corner(1)]) {
        expect(parseLookV1(l)).not.toBeNull();
        expect(decodeLookV1(encodeLookV1(l))).toEqual(l);
      }
    }
    expect(() => encodeLookV1({ ...human(), people: 'skyfolk' } as unknown as LookV1)).toThrow();
  });

  it('decodeLookV1 is strict: one character changed either decodes to a look that encodes to it, or is refused', () => {
    const rng = prng(11);
    let refused = 0;
    let accepted = 0;
    for (let n = 0; n < 6; n++) {
      const code = encodeLookV1(randomLookV1(rng));
      for (let i = 0; i < code.length; i++) {
        for (const c of BASE64URL) {
          if (c === code[i]) continue;
          const s = code.slice(0, i) + c + code.slice(i + 1);
          const l = decodeLookV1(s);
          if (l === null) refused++;
          else {
            accepted++;
            expect(parseLookV1(l)).toEqual(l);
            expect(encodeLookV1(l)).toBe(s);
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(100);
    expect(accepted).toBeGreaterThan(100);
    const code = encodeLookV1(human());
    for (const bad of ['', code.slice(1), code + 'A', code.replace(/.$/, '='), code.replace(/^./, '+'), '_'.repeat(38), 'A'.repeat(38)]) {
      expect(decodeLookV1(bad), bad).toBeNull();
    }
    expect(decodeLookV1(42 as unknown as string)).toBeNull();
  });
});

describe('defaultLookV1 and randomLookV1', () => {
  it('defaultLookV1 spreads peoples and features: 1000 seeds, each people ≥ 150, at most one identical pair', () => {
    const looks = Array.from({ length: 1000 }, (_, i) => defaultLookV1(`account-${i}`));
    expect(defaultLookV1('account-7')).toEqual(looks[7]);
    for (const l of looks) expect(parseLookV1(l)).toEqual(l);
    for (const p of PEOPLE_IDS) expect(looks.filter((l) => l.people === p).length, p).toBeGreaterThanOrEqual(150);
    const codes = looks.map(encodeLookV1);
    expect(1000 - new Set(codes).size).toBeLessThanOrEqual(1);
    // Ignoring free colours too, almost no two adventurers share every choice.
    const shapes = looks.map((l) => JSON.stringify({ ...l, colours: null, fur: l.fur && { ...l.fur, colour: 0 } }));
    expect(1000 - new Set(shapes).size).toBeLessThanOrEqual(1);
    // Every value of every field turns up.
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS_V1)) {
      if (hi > 31) continue; // colours
      const [g, k] = path.split('.') as [string, string];
      const seen = new Set(looks.map((l) => (l as unknown as Record<string, Record<string, number> | null>)[g]?.[k]).filter((v) => v !== undefined));
      expect(seen.size, path).toBe(hi - lo + 1);
    }
    // Skin is drawn from the people's own ranges.
    for (const l of looks) {
      const inRange = PEOPLES[l.people].skinRange.some(([a, b]) => between(l.colours.skin, a, b));
      expect(inRange, encodeLookV1(l)).toBe(true);
    }
  });

  it('keeps the Plan 5 default looks', () => {
    expect(encodeLookV1(defaultLookV1('account-1'))).toBe(DEFAULT_LOOK_1);
  });

  it('randomLookV1 is deterministic for a seeded generator and always valid', () => {
    const a = prng(99);
    const b = prng(99);
    for (let i = 0; i < 200; i++) {
      const l = randomLookV1(a);
      expect(randomLookV1(b)).toEqual(l);
      expect(parseLookV1(l)).toEqual(l);
    }
  });
});

/** Whether colour `c` lies channel by channel between the two hex colours. */
function between(c: number, a: string, b: string): boolean {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  return [16, 8, 0].every((s) => {
    const [v, p, q] = [(c >> s) & 255, (x >> s) & 255, (y >> s) & 255];
    return v >= Math.min(p, q) && v <= Math.max(p, q);
  });
}
