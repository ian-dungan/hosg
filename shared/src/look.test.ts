// Look v2: the tables, the strict parser, the v2 code and the v1 upgrade, presets, random and default looks,
// the Barber's price, the v1 view for the pre-v2 client, and that no rule outside looks reads a look.
import { describe, expect, it } from 'vitest';
import {
  BARBER_BODY_PRICE, BARBER_PEOPLE_PRICE, BARBER_PRICE, BODY_TYPES, BROW_SHAPES, EYE_COLOURS, EYE_SHAPES, FACE_PAINTS, FACE_SHAPE_PRESETS,
  FACIAL_HAIR, HAIRLINES, HAIR_COLOURS, HAIR_STYLES, HAIR_STYLE_INFO, LINER_COLOURS, LIP_COLOURS, LOOK_CODE_BYTES, LOOK_CODE_CHARS,
  LOOK_COMBINATIONS, LOOK_LIMITS, LOOK_OPTIONAL_COLOURS, LOOK_PRESETS, LUMA_MAX, LUMA_MIN, MOLE_SPOTS, MOUTH_PRESETS, NOSE_PRESETS, SCARS,
  SHADOW_COLOURS, SKIN_TONES, barberCost, clampLookColour, decodeLook, defaultLook, encodeLook, lookLuma, lookV1View, parseLook, randomLook,
  mergeLookV1, readLook, storedLookIsV1, upgradeLookV1, type Look,
} from './look';
import { PEOPLE_IDS, PEOPLES } from './lookCommon';
import { FACIAL_HAIR_V1, HAIR_STYLES_V1, defaultLookV1, encodeLookV1, parseLookV1, randomLookV1, type LookV1 } from './lookV1';
import { prng } from './world/recipe';

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function setPath(l: Look, path: string, value: unknown): Look {
  const out = clone(l) as unknown as Record<string, Record<string, unknown>>;
  const [group, key] = path.split('.') as [string, string];
  out[group]![key] = value;
  return out as unknown as Look;
}
const getPath = (l: Look, path: string): unknown => {
  const [g, k] = path.split('.') as [string, string];
  return (l as unknown as Record<string, Record<string, unknown> | null>)[g]?.[k];
};
const presetOf = (people: Look['people']): Look => LOOK_PRESETS.find((p) => p.look.people === people)!.look;

describe('tables', () => {
  it('two bodies; wide, even skin tones from very light to very dark; palettes; frozen', () => {
    expect(BODY_TYPES).toEqual(['male', 'female']);
    expect(SKIN_TONES.length).toBeGreaterThanOrEqual(24);
    const lumas = SKIN_TONES.map((t) => lookLuma(t.colour));
    for (let i = 1; i < lumas.length; i++) expect(lumas[i]!, SKIN_TONES[i]!.name).toBeLessThan(lumas[i - 1]!);
    expect(lumas[0]).toBeGreaterThan(220);
    expect(lumas[lumas.length - 1]).toBeLessThan(40);
    // Even: no gap between neighbours wider than 16 luma steps.
    for (let i = 1; i < lumas.length; i++) expect(lumas[i - 1]! - lumas[i]!).toBeLessThanOrEqual(16);
    expect(new Set(SKIN_TONES.map((t) => t.undertone))).toEqual(new Set(['warm', 'neutral', 'cool', 'olive']));
    for (const list of [SKIN_TONES, HAIR_COLOURS, EYE_COLOURS, LIP_COLOURS, SHADOW_COLOURS, LINER_COLOURS]) {
      expect(new Set(list.map((c) => c.name)).size).toBe(list.length);
      for (const c of list) expect(clampLookColour(c.colour), c.name).toBe(c.colour);
    }
    expect(HAIR_COLOURS.length).toBeGreaterThanOrEqual(20);
    expect(EYE_COLOURS.length).toBeGreaterThanOrEqual(14);
    for (const t of [SKIN_TONES, HAIR_STYLES, HAIR_STYLE_INFO, LOOK_PRESETS, LOOK_LIMITS, FACE_SHAPE_PRESETS]) expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(LOOK_PRESETS[0]!.look) && Object.isFrozen(LOOK_PRESETS[0]!.look.build)).toBe(true);
  });

  it('at least 40 hair styles over every length and texture, v1 styles first; at least 12 facial hair; one name per value', () => {
    expect(HAIR_STYLES.length).toBeGreaterThanOrEqual(40);
    expect(HAIR_STYLES.slice(0, 20)).toEqual(HAIR_STYLES_V1);
    expect(FACIAL_HAIR.length).toBeGreaterThanOrEqual(12);
    expect(FACIAL_HAIR.slice(0, 8)).toEqual(FACIAL_HAIR_V1);
    expect(HAIR_STYLE_INFO.map((h) => h.name)).toEqual(HAIR_STYLES);
    const has = (f: (h: (typeof HAIR_STYLE_INFO)[number]) => boolean) => HAIR_STYLE_INFO.filter(f).length;
    for (const len of ['bald', 'shaved', 'short', 'medium', 'long'] as const) expect(has((h) => h.length === len), len).toBeGreaterThan(0);
    for (const tex of ['straight', 'wavy', 'curly', 'coiled'] as const) expect(has((h) => h.texture === tex), tex).toBeGreaterThanOrEqual(3);
    expect(has((h) => h.form === 'tied')).toBeGreaterThanOrEqual(5);
    expect(has((h) => h.form === 'braided')).toBeGreaterThanOrEqual(5);
    for (const h of HAIR_STYLE_INFO) expect(h.v1).toBeLessThan(20);
    HAIR_STYLE_INFO.slice(0, 20).forEach((h, i) => expect(h.v1).toBe(i));
    const lists: readonly (readonly string[])[] = [HAIR_STYLES, FACIAL_HAIR, EYE_SHAPES, BROW_SHAPES, SCARS, MOLE_SPOTS.map((m) => m.name), FACE_PAINTS, HAIRLINES];
    for (const list of lists) expect(new Set(list).size).toBe(list.length);
    expect(HAIR_STYLES.length).toBe(LOOK_LIMITS['hair.style']![1] + 1);
    expect(FACIAL_HAIR.length).toBe(LOOK_LIMITS['hair.facial']![1] + 1);
    expect(EYE_SHAPES.length).toBe(LOOK_LIMITS['eyes.shape']![1] + 1);
    expect(BROW_SHAPES.length).toBe(LOOK_LIMITS['brows.shape']![1] + 1);
    expect(SCARS.length).toBe(LOOK_LIMITS['skin.scar']![1] + 1);
    expect(FACE_PAINTS.length).toBe(LOOK_LIMITS['paint.style']![1] + 1);
    expect(HAIRLINES.length).toBe(LOOK_LIMITS['hair.hairline']![1] + 1);
    expect(LOOK_LIMITS['skin.moles']![1]).toBe(2 ** MOLE_SPOTS.length - 1);
    expect(LIP_COLOURS.length).toBe(LOOK_LIMITS['makeup.lips']![1]);
    expect(SHADOW_COLOURS.length).toBe(LOOK_LIMITS['makeup.shadow']![1]);
    expect(LINER_COLOURS.length).toBe(LOOK_LIMITS['makeup.liner']![1]);
    expect(LOOK_LIMITS['face.age']).toEqual([0, 4]);
    expect([FACE_SHAPE_PRESETS.length, NOSE_PRESETS.length, MOUTH_PRESETS.length]).toEqual([6, 8, 6]);
  });

  it('at least 24 named presets, all valid, over both bodies, every people, every age and light to dark skin', () => {
    expect(LOOK_PRESETS.length).toBeGreaterThanOrEqual(24);
    expect(new Set(LOOK_PRESETS.map((p) => p.id)).size).toBe(LOOK_PRESETS.length);
    expect(new Set(LOOK_PRESETS.map((p) => p.name)).size).toBe(LOOK_PRESETS.length);
    for (const p of LOOK_PRESETS) expect(parseLook(p.look), p.id).toEqual(p.look);
    for (const b of BODY_TYPES) expect(LOOK_PRESETS.filter((p) => p.look.body === b).length).toBeGreaterThanOrEqual(10);
    for (const people of PEOPLE_IDS) {
      expect(LOOK_PRESETS.filter((p) => p.look.people === people).length, people).toBeGreaterThanOrEqual(5);
      expect(new Set(LOOK_PRESETS.filter((p) => p.look.people === people).map((p) => p.look.body)).size, people).toBe(2);
    }
    expect(new Set(LOOK_PRESETS.map((p) => p.look.face.age))).toEqual(new Set([0, 1, 2, 3, 4]));
    const humanLumas = LOOK_PRESETS.filter((p) => p.look.people === 'human').map((p) => lookLuma(p.look.skin.colour));
    expect(Math.max(...humanLumas)).toBeGreaterThan(200);
    expect(Math.min(...humanLumas)).toBeLessThan(60);
  });
});

describe('colours', () => {
  it('clampLookColour keeps luma within [LUMA_MIN, LUMA_MAX], moves nothing already inside, and is idempotent', () => {
    expect([LUMA_MIN, LUMA_MAX]).toEqual([16, 250]);
    expect(lookLuma(0)).toBe(0);
    expect(lookLuma(0xffffff)).toBe(255);
    const rng = prng(4);
    for (let i = 0; i < 3000; i++) {
      const c = Math.floor(rng() * 0x1000000);
      const k = clampLookColour(c);
      expect(lookLuma(k)).toBeGreaterThanOrEqual(LUMA_MIN);
      expect(lookLuma(k)).toBeLessThanOrEqual(LUMA_MAX);
      if (lookLuma(c) >= LUMA_MIN && lookLuma(c) <= LUMA_MAX) expect(k).toBe(c);
      expect(clampLookColour(k)).toBe(k);
    }
    for (const c of [0, 0xffffff, 0x0000ff, 0xffff00]) expect(clampLookColour(clampLookColour(c))).toBe(clampLookColour(c));
  });
});

describe('parseLook', () => {
  const h = presetOf('human');
  const b = presetOf('brindlekin');

  it('accepts every limit and refuses one past, fractions, NaN, Infinity, strings, null where not optional, booleans', () => {
    let checked = 0;
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
      const base = path.startsWith('fur.') || path === 'ears.style' ? b : h;
      const colour = hi === 0xffffff;
      const okLo = colour ? clampLookColour(lo) : lo;
      const okHi = colour ? clampLookColour(hi) : hi;
      expect(parseLook(setPath(base, path, okLo)), `${path} = ${okLo}`).not.toBeNull();
      expect(parseLook(setPath(base, path, okHi)), `${path} = ${okHi}`).not.toBeNull();
      const bad: unknown[] = [lo - 1, hi + 1, lo + 0.5, Number.NaN, Infinity, -Infinity, String(lo), undefined, true, [lo], { v: lo }];
      if (!LOOK_OPTIONAL_COLOURS.includes(path)) bad.push(null);
      else expect(parseLook(setPath(base, path, null)), `${path} = null`).not.toBeNull();
      if (colour) bad.push(0, 0xffffff, 0x000008);
      for (const v of bad) expect(parseLook(setPath(base, path, v)), `${path} = ${String(v)}`).toBeNull();
      checked++;
    }
    expect(checked).toBe(Object.keys(LOOK_LIMITS).length);
    expect(checked).toBeGreaterThanOrEqual(60);
  });

  it('refuses unknown ids, wrong versions, extra or missing keys, oversize strings, fur rules and ears per people; never throws', () => {
    expect(parseLook(h)).toEqual(h);
    expect(parseLook(h)).not.toBe(h);
    expect(parseLook(setPath(h, 'ears.style', PEOPLES.human.earsMax + 1))).toBeNull();
    expect(parseLook(setPath(b, 'ears.style', PEOPLES.brindlekin.earsMax))).not.toBeNull();
    const table: [string, unknown][] = [
      ['v 1', { ...h, v: 1 }], ['v 3', { ...h, v: 3 }], ['v "2"', { ...h, v: '2' }],
      ['body other', { ...h, body: 'other' }], ['body Male', { ...h, body: 'Male' }], ['body null', { ...h, body: null }], ['body long', { ...h, body: 'male'.repeat(5000) }],
      ['people skyfolk', { ...h, people: 'skyfolk' }], ['people toString', { ...h, people: 'toString' }], ['people long', { ...h, people: 'x'.repeat(100000) }],
      ['extra top key', { ...h, name: 'Bob' }], ['extra group key', { ...h, eyes: { ...h.eyes, glow: 1 } }],
      ['missing group', (() => { const { mouth: _, ...r } = h; return r; })()],
      ['missing key', { ...h, nose: { length: 5, width: 5, bridge: 5 } }],
      ['fur on a human', { ...h, fur: { pattern: 0, colour: 0x808080, tail: 0, muzzle: 0 } }], ['no fur on Brindlekin', { ...b, fur: null }],
      ['group array', { ...h, build: [] }], ['group null', { ...h, skin: null }], ['proto key', JSON.parse(`{"__proto__":1,${JSON.stringify(h).slice(1)}`)],
    ];
    for (const [name, v] of table) expect(parseLook(v), name).toBeNull();
    for (const junk of [null, undefined, 0, 'look', [], [h], new Date(), () => h]) expect(parseLook(junk)).toBeNull();
    const trap = { ...h };
    Object.defineProperty(trap, 'eyes', { enumerable: true, get() { throw new Error('boom'); } });
    expect(() => parseLook(trap)).not.toThrow();
    expect(parseLook(trap)).toBeNull();
    const proxy = new Proxy(h, { ownKeys() { throw new Error('boom'); } });
    expect(parseLook(proxy)).toBeNull();
  });
});

describe('look codes v2', () => {
  it(`round-trips 5000 random looks; ${'≤'} 64 bytes and ${'≤'} 88 characters, base64url`, () => {
    expect(LOOK_CODE_BYTES).toBeLessThanOrEqual(64);
    expect(LOOK_CODE_CHARS).toBe(Math.ceil((LOOK_CODE_BYTES * 8) / 6));
    expect(LOOK_CODE_CHARS).toBeLessThanOrEqual(88);
    const rng = prng(21);
    for (let i = 0; i < 5000; i++) {
      const l = randomLook(rng);
      expect(parseLook(l), `look ${i}`).toEqual(l);
      const code = encodeLook(l);
      expect(code.length).toBe(LOOK_CODE_CHARS);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeLook(code)).toEqual(l);
    }
    for (const p of LOOK_PRESETS) expect(decodeLook(encodeLook(p.look))).toEqual(p.look);
    expect(() => encodeLook({ ...presetOf('human'), people: 'skyfolk' } as unknown as Look)).toThrow();
  });

  it('every field at both ends round-trips, per people', () => {
    for (const people of PEOPLE_IDS) {
      for (const pick of [0, 1] as const) {
        let l = presetOf(people);
        for (const [path, range] of Object.entries(LOOK_LIMITS)) {
          if (path.startsWith('fur.') && !PEOPLES[people].furred) continue;
          let v = path === 'ears.style' && pick ? PEOPLES[people].earsMax : range[pick];
          if (range[1] === 0xffffff) v = clampLookColour(v);
          l = setPath(l, path, v);
        }
        expect(parseLook(l), `${people} ${pick}`).not.toBeNull();
        expect(decodeLook(encodeLook(l))).toEqual(l);
        const nulls = LOOK_OPTIONAL_COLOURS.reduce((x, p) => setPath(x, p, null), l);
        expect(decodeLook(encodeLook(nulls))).toEqual(nulls);
        for (const body of BODY_TYPES) expect(decodeLook(encodeLook({ ...l, body }))!.body).toBe(body);
      }
    }
  });

  it('decodeLook is strict: one character changed decodes to a look that encodes to it, or is refused', () => {
    const rng = prng(12);
    let refused = 0;
    let accepted = 0;
    for (let n = 0; n < 3; n++) {
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
    expect(refused).toBeGreaterThan(50);
    expect(accepted).toBeGreaterThan(50);
    const code = encodeLook(presetOf('human'));
    for (const bad of ['', code.slice(1), code + 'A', code.replace(/.$/, '='), '_'.repeat(LOOK_CODE_CHARS), 'A'.repeat(LOOK_CODE_CHARS), 'A'.repeat(38), '_'.repeat(38), 'x'.repeat(5000)]) {
      expect(decodeLook(bad), bad.slice(0, 20)).toBeNull();
    }
    for (const junk of [42, null, undefined, {}, ['a']]) expect(decodeLook(junk as unknown as string)).toBeNull();
  });

  it('counts the combinations: well over 1e40 discrete looks per people before free colours', () => {
    for (const p of PEOPLE_IDS) expect(LOOK_COMBINATIONS.discrete[p], p).toBeGreaterThan(1e40);
    expect(LOOK_COMBINATIONS.withColours).toBeGreaterThan(1e100);
    expect(LOOK_COMBINATIONS.withColours).toBeLessThan(2 ** (LOOK_CODE_BYTES * 8));
  });
});

describe('the v1 upgrade', () => {
  /** A v1 look with its free colours clamped as the upgrade clamps them. */
  const clampedV1 = (l: LookV1): LookV1 => ({
    ...l,
    colours: {
      skin: clampLookColour(l.colours.skin), hair: clampLookColour(l.colours.hair), facial: clampLookColour(l.colours.facial),
      eyes: clampLookColour(l.colours.eyes), marks: clampLookColour(l.colours.marks),
    },
    fur: l.fur && { ...l.fur, colour: clampLookColour(l.fur.colour) },
  });

  it('5000 random v1 looks: v1 codes decode to their upgrade, which is valid, stable when re-encoded, and draws as the v1 look', () => {
    const rng = prng(31);
    let female = 0;
    for (let i = 0; i < 5000; i++) {
      const l1 = randomLookV1(rng);
      const up = upgradeLookV1(l1);
      expect(parseLook(up), `look ${i}`).toEqual(up);
      expect(decodeLook(encodeLookV1(l1))).toEqual(up);
      const code = encodeLook(up);
      expect(decodeLook(code)).toEqual(up);
      expect(encodeLook(decodeLook(code)!)).toBe(code);
      expect(lookV1View(up)).toEqual(clampedV1(l1));
      expect(readLook(clone(l1))).toEqual(up);
      expect(up.people).toBe(l1.people);
      expect([up.build.height, up.build.shoulders, up.build.hips, up.build.legs, up.build.head]).toEqual([l1.body.height, l1.body.shoulders, l1.body.hips, l1.body.legs, l1.body.head]);
      expect(up.hair.style).toBe(l1.hair.style);
      expect(up.hair.facial).toBe(l1.hair.facial);
      expect(up.face.age).toBe(0);
      if (up.body === 'female') female++;
    }
    // 'male' unless the v1 body implies otherwise: no facial hair and hips at least 4 steps wider than shoulders.
    expect(female).toBeGreaterThan(200);
    expect(female).toBeLessThan(2500);
  });

  it('the body rule, exactly', () => {
    const base = defaultLookV1('rule');
    const withBody = (hips: number, shoulders: number, facial: number) =>
      upgradeLookV1({ ...base, body: { ...base.body, hips, shoulders }, hair: { ...base.hair, facial } }).body;
    expect(withBody(14, 10, 0)).toBe('female');
    expect(withBody(13, 10, 0)).toBe('male');
    expect(withBody(20, 0, 1)).toBe('male');
  });

  it('lookV1View gives a valid v1 look for any v2 look (the pre-v2 client draws from it)', () => {
    const rng = prng(41);
    for (let i = 0; i < 5000; i++) {
      const v = lookV1View(randomLook(rng));
      expect(parseLookV1(v)).toEqual(v);
    }
    for (const p of LOOK_PRESETS) expect(parseLookV1(lookV1View(p.look))).not.toBeNull();
  });

  it('readLook reads v2 or v1 (upgraded) JSON and nothing else; storedLookIsV1 spots a stored v1 look', () => {
    const l = presetOf('knollfolk');
    expect(readLook(clone(l))).toEqual(l);
    expect(readLook({ ...l, v: 1 })).toBeNull();
    expect(readLook(null)).toBeNull();
    expect(readLook('x')).toBeNull();
    const l1 = defaultLookV1('stored');
    expect(storedLookIsV1(l1)).toBe(true);
    expect(storedLookIsV1(l)).toBe(false);
    expect(storedLookIsV1({ v: 1 })).toBe(true); // by its version alone, as the SQL reads it (it reads as no look)
    expect(storedLookIsV1({ v: '1' })).toBe(false);
    expect(storedLookIsV1(null)).toBe(false);
  });
});

describe('mergeLookV1 (a look sent by the pre-v2 creator)', () => {
  it('changes only what the v1 edit changed, keeps the body and every v2-only detail', () => {
    const rng = prng(51);
    for (let i = 0; i < 500; i++) {
      const cur = randomLook(rng);
      const view = lookV1View(cur);
      expect(mergeLookV1(cur, view), `look ${i}`).toEqual(cur);
      const styled = mergeLookV1(cur, { ...view, hair: { ...view.hair, style: (view.hair.style + 1) % 20 } });
      expect(styled).toEqual({ ...cur, hair: { ...cur.hair, style: (view.hair.style + 1) % 20 } });
      const taller = mergeLookV1(cur, { ...view, body: { ...view.body, height: (view.body.height + 3) % 21, hips: 20, shoulders: 0 } })!;
      expect(taller.body).toBe(cur.body);
      expect(taller.build).toEqual({ ...cur.build, height: (view.body.height + 3) % 21, hips: 20, shoulders: 0 });
      expect(taller.face).toEqual(cur.face);
      const other = PEOPLE_IDS[(PEOPLE_IDS.indexOf(cur.people) + 1) % 4]!;
      const l1 = randomLookV1(rng);
      const moved = mergeLookV1(cur, { ...l1, people: other, fur: PEOPLES[other].furred ? l1.fur ?? { pattern: 0, colour: 0x806040, tail: 0 } : null, face: { ...l1.face, ears: 0 } })!;
      expect(parseLook(moved)).toEqual(moved);
      expect([moved.people, moved.body]).toEqual([other, cur.body]);
    }
    expect(mergeLookV1(presetOf('human'), { v: 1 } as unknown as LookV1)).toBeNull();
  });
});

describe('randomLook and defaultLook', () => {
  it('randomLook is deterministic, always valid, varied and plausible (around the presets, not noise)', () => {
    const [a, b] = [prng(99), prng(99)];
    const looks: Look[] = [];
    for (let i = 0; i < 1000; i++) {
      const l = randomLook(a);
      expect(randomLook(b)).toEqual(l);
      looks.push(l);
    }
    for (const p of PEOPLE_IDS) expect(looks.filter((l) => l.people === p).length, p).toBeGreaterThanOrEqual(150);
    for (const body of BODY_TYPES) expect(looks.filter((l) => l.body === body).length, body).toBeGreaterThanOrEqual(350);
    expect(new Set(looks.map(encodeLook)).size).toBe(1000);
    // Every value of every small field turns up.
    for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
      if (hi >= 63) continue;
      const seen = new Set(looks.map((l) => getPath(l, path)).filter((v) => v !== undefined));
      expect(seen.size, path).toBe(hi - lo + 1);
    }
    // Plausible: most female bodies have no facial hair; most sliders sit near the middle; human skin is a palette tone.
    const fem = looks.filter((l) => l.body === 'female');
    expect(fem.filter((l) => l.hair.facial !== 0).length / fem.length).toBeLessThan(0.08);
    const heights = looks.map((l) => l.build.height);
    expect(heights.filter((h) => h >= 6 && h <= 14).length / heights.length).toBeGreaterThan(0.7);
    const tones = new Set(SKIN_TONES.map((t) => t.colour));
    const humans = looks.filter((l) => l.people === 'human');
    expect(humans.filter((l) => tones.has(l.skin.colour)).length / humans.length).toBeGreaterThan(0.6);
  });

  it('defaultLook is the upgraded Plan 5 default, so an adventurer who never used the creator keeps their look', () => {
    for (let i = 0; i < 200; i++) expect(defaultLook(`account-${i}`)).toEqual(upgradeLookV1(defaultLookV1(`account-${i}`)));
  });
});

describe('barberCost', () => {
  it('0 unchanged, 40 within a people and body, 200 for a new people or a new body', () => {
    const h = presetOf('human');
    expect([BARBER_PRICE, BARBER_PEOPLE_PRICE, BARBER_BODY_PRICE]).toEqual([40, 200, 200]);
    expect(barberCost(h, clone(h))).toBe(0);
    expect(barberCost(h, setPath(h, 'hair.style', (h.hair.style + 1) % HAIR_STYLES.length))).toBe(40);
    expect(barberCost(h, setPath(h, 'nose.tip', (h.nose.tip + 1) % 11))).toBe(40);
    expect(barberCost(h, { ...h, body: h.body === 'male' ? 'female' : 'male' })).toBe(200);
    expect(barberCost(h, presetOf('brindlekin'))).toBe(200);
  });
});

describe('imports', () => {
  it('no cycles among the look modules, and nothing in combat, movement, kit or progression reads a look', async () => {
    const fs: { readFileSync(p: string, enc: 'utf8'): string; readdirSync(p: string): string[] } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const imports = (f: string) => [...fs.readFileSync(here + f, 'utf8').matchAll(/^import\s+[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    expect(imports('look.ts').sort()).toEqual(['./hash', './lookCommon', './lookV1', './rng']);
    expect(imports('lookV1.ts').sort()).toEqual(['./hash', './lookCommon', './rng']);
    expect(imports('lookCommon.ts')).toEqual([]);
    expect(imports('gearLook.ts')).toEqual(['./lookCommon']);
    const rules = ['movement.ts', 'body.ts', 'kit.ts', 'progression.ts', 'talents.ts', 'items.ts', ...fs.readdirSync(here + 'combat').filter((f) => f.endsWith('.ts') && !f.includes('.test.')).map((f) => `combat/${f}`)];
    for (const f of rules) {
      for (const i of imports(f)) expect(i, f).not.toMatch(/\/look(V1|Common)?$/);
      expect(fs.readFileSync(here + f, 'utf8'), f).not.toMatch(/\bLook\b|\bparseLook\b/);
    }
  });
});
