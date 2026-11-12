// Peoples and looks: the strict parser, the compact codes, the varied defaults and the Barber's price.
import { describe, expect, it } from 'vitest';
import {
  BRINDLE_EARS, EMOTES, FACE_MARKS, FACE_SHAPES, FACIAL_HAIR, FUR_PATTERNS, GEAR_LOOK_SLOTS, HAIR_STYLES, LOOK_COMBINATIONS,
  LOOK_LIMITS, PEOPLE_IDS, PEOPLES, STANCES, TAILS, WALKS, barberCost, decodeGearLook, decodeLook, defaultLook, encodeGearLook,
  encodeLook, parseLook, randomLook, resolveGearLook, type GearLook, type Look,
} from './look';
import { seededRng } from './rng';
import { prng } from './world/recipe';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** encodeLook(defaultLook('account-1')) before the generator moved out of world/recipe: defaults are unchanged. */
const DEFAULT_LOOK_1 = 'Ar8yr9nUliHwoAAAAC8cE7dPJyAYFIiUnCUiKw';

/** Reads or writes a dotted path ('face.eyes') of a look. */
function setPath(l: Look, path: string, value: unknown): Look {
  const out = clone(l) as unknown as Record<string, Record<string, unknown>>;
  const [group, key] = path.split('.') as [string, string];
  out[group]![key] = value;
  return out as unknown as Look;
}

const human = (): Look => ({ ...defaultLookFor('human') });
const brindle = (): Look => ({ ...defaultLookFor('brindlekin') });
function defaultLookFor(people: Look['people']): Look {
  for (let i = 0; ; i++) {
    const l = defaultLook(`seed-${people}-${i}`);
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
    expect(Object.isFrozen(PEOPLES) && Object.isFrozen(PEOPLES.human) && Object.isFrozen(LOOK_LIMITS)).toBe(true);
  });

  it('names every choice the creator offers, one per value', () => {
    expect(EMOTES).toEqual(['wave', 'bow', 'cheer', 'laugh', 'sit', 'point']);
    expect(STANCES.length).toBe(LOOK_LIMITS['style.stance']![1] + 1);
    expect(WALKS.length).toBe(LOOK_LIMITS['style.walk']![1] + 1);
    expect(FACE_SHAPES.length).toBe(LOOK_LIMITS['face.shape']![1] + 1);
    expect(FACE_MARKS.length).toBe(LOOK_LIMITS['face.marks']![1] + 1);
    expect(HAIR_STYLES.length).toBe(20);
    expect(FACIAL_HAIR.length).toBe(LOOK_LIMITS['hair.facial']![1] + 1);
    expect(FUR_PATTERNS.length).toBe(LOOK_LIMITS['fur.pattern']![1] + 1);
    expect(TAILS.length).toBe(LOOK_LIMITS['fur.tail']![1] + 1);
    expect(BRINDLE_EARS.length).toBe(PEOPLES.brindlekin.earsMax + 1);
    for (const list of [STANCES, WALKS, FACE_SHAPES, FACE_MARKS, HAIR_STYLES, FACIAL_HAIR, FUR_PATTERNS, TAILS, BRINDLE_EARS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe('parseLook', () => {
  it('parseLook accepts the limits and refuses one-off values, wrong keys, fur on a Human and no fur on Brindlekin', () => {
    const h = human();
    const b = brindle();
    expect(parseLook(h)).toEqual(h);
    expect(parseLook(b)).toEqual(b);
    let checked = 0;
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
      const base = path.startsWith('fur.') || path === 'face.ears' ? b : h;
      expect(parseLook(setPath(base, path, lo)), `${path} = ${lo}`).not.toBeNull();
      expect(parseLook(setPath(base, path, hi)), `${path} = ${hi}`).not.toBeNull();
      for (const bad of [lo - 1, hi + 1, lo + 0.5, Number.NaN, Infinity, String(lo), null, undefined, true]) {
        expect(parseLook(setPath(base, path, bad)), `${path} = ${String(bad)}`).toBeNull();
      }
      checked++;
    }
    expect(checked).toBe(Object.keys(LOOK_LIMITS).length);
    expect(checked).toBe(27);
    // Ears: up to 3 for most peoples, up to 5 for the Brindlekin.
    expect(parseLook(setPath(h, 'face.ears', 3))).not.toBeNull();
    expect(parseLook(setPath(h, 'face.ears', 4))).toBeNull();
    expect(parseLook(setPath(b, 'face.ears', 5))).not.toBeNull();
    // Fur exactly for the Brindlekin.
    expect(parseLook({ ...h, fur: { pattern: 0, colour: 0, tail: 0 } })).toBeNull();
    expect(parseLook({ ...b, fur: null })).toBeNull();
    expect(parseLook({ ...b, people: 'human' })).toBeNull();
    expect(parseLook({ ...h, people: 'brindlekin' })).toBeNull();
    // Keys exactly.
    expect(parseLook({ ...h, extra: 1 })).toBeNull();
    expect(parseLook({ ...h, body: { ...h.body, wings: 3 } })).toBeNull();
    const { mouth: _, ...noMouth } = h.face;
    expect(parseLook({ ...h, face: noMouth })).toBeNull();
    const { style: __, ...noStyle } = h;
    expect(parseLook(noStyle)).toBeNull();
    expect(parseLook({ ...h, v: 2 })).toBeNull();
    expect(parseLook({ ...h, people: 'skyfolk' })).toBeNull();
    expect(parseLook({ ...h, people: 'toString' })).toBeNull();
    for (const junk of [null, undefined, 0, 'look', [], [h], { ...h, body: [] }, { ...h, colours: null }]) expect(parseLook(junk)).toBeNull();
    // A fresh copy, not the input.
    const parsed = parseLook(h)!;
    expect(parsed).not.toBe(h);
    expect(parsed.body).not.toBe(h.body);
  });
});

describe('look codes', () => {
  it('encodeLook ↔ decodeLook round-trips 1000 random looks; at most 38 characters', () => {
    const rng = prng(7);
    for (let i = 0; i < 1000; i++) {
      const l = randomLook(rng);
      expect(parseLook(l), `look ${i}`).not.toBeNull();
      const code = encodeLook(l);
      expect(code.length).toBeLessThanOrEqual(38);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeLook(code)).toEqual(l);
    }
    // The extremes of every field round-trip too.
    for (const people of PEOPLE_IDS) {
      const fur = PEOPLES[people].furred;
      const corner = (pick: 0 | 1): Look => {
        let l = setPath(defaultLookFor(people), 'face.ears', pick ? PEOPLES[people].earsMax : 0);
        for (const [path, range] of Object.entries(LOOK_LIMITS)) {
          if (path === 'face.ears' || (path.startsWith('fur.') && !fur)) continue;
          l = setPath(l, path, range[pick]);
        }
        return l;
      };
      for (const l of [corner(0), corner(1)]) {
        expect(parseLook(l)).not.toBeNull();
        expect(decodeLook(encodeLook(l))).toEqual(l);
      }
    }
    expect(() => encodeLook({ ...human(), people: 'skyfolk' } as unknown as Look)).toThrow();
  });

  it('decodeLook is strict: one character changed either decodes to a look that encodes to it, or is refused', () => {
    const rng = prng(11);
    let refused = 0;
    let accepted = 0;
    for (let n = 0; n < 6; n++) {
      const code = encodeLook(randomLook(rng));
      for (let i = 0; i < code.length; i++) {
        for (const c of BASE64URL) {
          if (c === code[i]) continue;
          const s = code.slice(0, i) + c + code.slice(i + 1);
          const l = decodeLook(s);
          if (l === null) refused++;
          else {
            accepted++;
            expect(parseLook(l)).toEqual(l);
            expect(encodeLook(l)).toBe(s);
          }
        }
      }
    }
    expect(refused).toBeGreaterThan(100);
    expect(accepted).toBeGreaterThan(100);
    const code = encodeLook(human());
    for (const bad of ['', code.slice(1), code + 'A', code.replace(/.$/, '='), code.replace(/^./, '+'), '_'.repeat(38), 'A'.repeat(38)]) {
      expect(decodeLook(bad), bad).toBeNull();
    }
    expect(decodeLook(42 as unknown as string)).toBeNull();
  });

  it('counts the combinations: well over a billion discrete looks per people before free colours', () => {
    for (const p of PEOPLE_IDS) expect(LOOK_COMBINATIONS.discrete[p]).toBeGreaterThan(1e15);
    expect(LOOK_COMBINATIONS.withColours).toBeGreaterThan(1e60);
  });
});

describe('gear codes', () => {
  const plain = (model: number, d1 = 0, d2 = 0) => ({ model, dye: [d1, d2] as [number, number] });
  const worn = {
    head: plain(10, 3, 4), chest: plain(11, 31, 0), legs: plain(12), hands: plain(13, 1, 2), feet: plain(14, 5, 6), back: plain(15, 7, 8),
    weapon: plain(40, 9, 10), offhand: plain(60, 11, 12),
  };

  it('encodeGearLook ↔ decodeGearLook round-trips; costumes replace their slots; hideHead clears the head; at most 40 characters', () => {
    const bare = resolveGearLook(worn, {}, false);
    expect(bare).toEqual({ ...worn, hideHead: false });
    const body = resolveGearLook(worn, { body: plain(201, 2, 3) }, false);
    expect([body.chest, body.legs, body.hands, body.feet]).toEqual([plain(201, 2, 3), null, null, null]);
    expect([body.head, body.back, body.weapon, body.offhand]).toEqual([worn.head, worn.back, worn.weapon, worn.offhand]);
    const head = resolveGearLook(worn, { head: plain(220, 1, 1), back: plain(240, 4, 4) }, false);
    expect([head.head, head.back, head.chest]).toEqual([plain(220, 1, 1), plain(240, 4, 4), worn.chest]);
    const hidden = resolveGearLook(worn, { head: plain(220) }, true);
    expect(hidden.head).toBeNull();
    expect(hidden.hideHead).toBe(true);
    expect(resolveGearLook(worn, {}, true).head).toBeNull();
    const twoHanded = resolveGearLook({ ...worn, offhand: undefined }, {}, false);
    expect(twoHanded.offhand).toBeNull();

    const all = resolveGearLook(worn, { body: plain(255, 31, 31), head: plain(200, 31, 31), back: plain(254, 31, 31) }, false);
    const looks: GearLook[] = [bare, body, head, hidden, twoHanded, all, { ...bare, weapon: plain(255 - 56, 31, 31) }];
    const rng = prng(3);
    for (let i = 0; i < 300; i++) {
      const pick = () => plain(Math.floor(rng() * 200), Math.floor(rng() * 32), Math.floor(rng() * 32));
      const w = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, rng() < 0.1 ? undefined : pick()]));
      const costume = () => (rng() < 0.4 ? plain(200 + Math.floor(rng() * 56), Math.floor(rng() * 32), Math.floor(rng() * 32)) : null);
      looks.push(resolveGearLook(w, { body: costume(), head: costume(), back: costume() }, rng() < 0.2));
    }
    for (const g of looks) {
      const code = encodeGearLook(g);
      expect(code.length).toBeLessThanOrEqual(40);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeGearLook(code)).toEqual(g);
    }
    // Refused: a costume model in an item slot, an item under a body costume, a head shown while hidden, junk.
    expect(() => encodeGearLook({ ...bare, legs: plain(210) })).toThrow();
    expect(() => encodeGearLook({ ...body, legs: plain(12) })).toThrow();
    expect(() => encodeGearLook({ ...bare, hideHead: true })).toThrow();
    expect(() => encodeGearLook({ ...bare, weapon: plain(256) })).toThrow();
    expect(() => encodeGearLook({ ...bare, weapon: plain(3, 32, 0) })).toThrow();
    for (const bad of ['', 'A', '_'.repeat(40), encodeGearLook(bare) + 'A', encodeGearLook(bare).slice(0, -1), 'AAA=']) {
      expect(decodeGearLook(bad), bad).toBeNull();
    }
    // Every one-character change decodes to what it encodes, or is refused.
    const code = encodeGearLook(all);
    for (let i = 0; i < code.length; i++) {
      for (const c of BASE64URL) {
        const s = code.slice(0, i) + c + code.slice(i + 1);
        const g = decodeGearLook(s);
        if (g !== null) expect(encodeGearLook(g)).toBe(s);
      }
    }
  });
});

describe('resolveGearLook with bad models', () => {
  const plain = (model: number, d1 = 0, d2 = 0) => ({ model, dye: [d1, d2] as [number, number] });
  const worn = {
    head: plain(10), chest: plain(11), legs: plain(12), hands: plain(13), feet: plain(14), back: plain(15), weapon: plain(40), offhand: plain(60),
  };

  it('drops a worn piece with a costume-range or invalid model, ignores a costume with an item-range model, and never throws', () => {
    const g = resolveGearLook({ ...worn, legs: plain(200), weapon: plain(256), feet: plain(-1), hands: plain(13, 32, 0) }, {}, false);
    expect([g.legs, g.weapon, g.feet, g.hands]).toEqual([null, null, null, null]);
    expect(g.chest).toEqual(worn.chest);
    const c = resolveGearLook(worn, { body: plain(150), head: plain(12), back: plain(256) }, false);
    expect(c).toEqual({ ...worn, hideHead: false });
    expect(() => encodeGearLook(c)).not.toThrow();
    // Junk of every kind still gives a gear look that encodes and decodes.
    const rng = prng(5);
    const junk = (): unknown => {
      const r = rng();
      if (r < 0.1) return null;
      if (r < 0.2) return 'x';
      if (r < 0.3) return { model: Number.NaN, dye: [0, 0] };
      if (r < 0.4) return { model: 3, dye: [1] };
      return plain(Math.floor(rng() * 300) - 20, Math.floor(rng() * 40) - 4, Math.floor(rng() * 40) - 4);
    };
    for (let i = 0; i < 500; i++) {
      const w = Object.fromEntries(GEAR_LOOK_SLOTS.map((s) => [s, junk()])) as Parameters<typeof resolveGearLook>[0];
      const cs = { body: junk(), head: junk(), back: junk() } as Parameters<typeof resolveGearLook>[1];
      const out = resolveGearLook(w, cs, rng() < 0.3);
      expect(decodeGearLook(encodeGearLook(out))).toEqual(out);
    }
    expect(() => resolveGearLook(null as never, null as never, 'yes' as never)).not.toThrow();
  });
});

describe('defaultLook and randomLook', () => {
  it('defaultLook spreads peoples and features: 1000 seeds, each people ≥ 150, at most one identical pair', () => {
    const looks = Array.from({ length: 1000 }, (_, i) => defaultLook(`account-${i}`));
    expect(defaultLook('account-7')).toEqual(looks[7]);
    for (const l of looks) expect(parseLook(l)).toEqual(l);
    for (const p of PEOPLE_IDS) expect(looks.filter((l) => l.people === p).length, p).toBeGreaterThanOrEqual(150);
    const codes = looks.map(encodeLook);
    expect(1000 - new Set(codes).size).toBeLessThanOrEqual(1);
    // Ignoring free colours too, almost no two adventurers share every choice.
    const shapes = looks.map((l) => JSON.stringify({ ...l, colours: null, fur: l.fur && { ...l.fur, colour: 0 } }));
    expect(1000 - new Set(shapes).size).toBeLessThanOrEqual(1);
    // Every value of every field turns up.
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
      if (hi > 31) continue; // colours
      const [g, k] = path.split('.') as [string, string];
      const seen = new Set(looks.map((l) => (l as unknown as Record<string, Record<string, number> | null>)[g]?.[k]).filter((v) => v !== undefined));
      expect(seen.size, path).toBe(hi - lo + 1);
    }
    // Skin is drawn from the people's own ranges.
    for (const l of looks) {
      const inRange = PEOPLES[l.people].skinRange.some(([a, b]) => between(l.colours.skin, a, b));
      expect(inRange, encodeLook(l)).toBe(true);
    }
  });

  it('randomLook is deterministic for a seeded generator and always valid', () => {
    const a = prng(99);
    const b = prng(99);
    for (let i = 0; i < 200; i++) {
      const l = randomLook(a);
      expect(randomLook(b)).toEqual(l);
      expect(parseLook(l)).toEqual(l);
    }
  });
});

describe('imports', () => {
  it('look.ts uses its own small generator (no world generation), with the same numbers as prng', async () => {
    const fs: { readFileSync(p: string, enc: 'utf8'): string } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const src = fs.readFileSync(here + 'look.ts', 'utf8');
    expect([...src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1])).toEqual(['./hash', './rng']);
    for (const seed of [0, 1, 0x100c, 0xffffffff, 123456789]) {
      const [a, b] = [seededRng(seed), prng(seed)];
      for (let i = 0; i < 50; i++) expect(a()).toBe(b());
    }
    expect(encodeLook(defaultLook('account-1'))).toBe(DEFAULT_LOOK_1);
  });
});

describe('barberCost', () => {
  it('barberCost: 0, 40, 200', () => {
    const h = human();
    expect(barberCost(h, clone(h))).toBe(0);
    expect(barberCost(h, setPath(h, 'hair.style', (h.hair.style + 1) % 20))).toBe(40);
    expect(barberCost(h, setPath(h, 'colours.eyes', (h.colours.eyes + 1) % 0x1000000))).toBe(40);
    expect(barberCost(h, brindle())).toBe(200);
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
