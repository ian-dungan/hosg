import { describe, expect, it } from 'vitest';
import { LOOK_LIMITS, PEOPLES, PEOPLE_IDS, defaultLook, parseLook, randomLook, type Look } from '@sg2/shared';
import { CANON, LIGHTNESS, MAX_HALF_WIDTH, bodyParams, faceParams, halfWidth, lookColours, makeWarp, modelParams, renderColour } from './look';

const base = (people: Look['people']): Look => {
  const l = defaultLook(`base-${people}`);
  const fur = PEOPLES[people].furred ? { pattern: 1, colour: 0x332211, tail: 2 } : null;
  return parseLook({ ...l, people, fur, face: { ...l.face, ears: Math.min(l.face.ears, PEOPLES[people].earsMax) } })!;
};
const withBody = (l: Look, body: Partial<Look['body']>): Look => ({ ...l, body: { ...l.body, ...body } });

describe('bodyParams', () => {
  it('gives each people its height at sliders 0, 10 and 20, within its span', () => {
    for (const p of PEOPLE_IDS) {
      const d = PEOPLES[p];
      const at = (h: number) => bodyParams(withBody(base(p), { height: h })).height;
      expect(at(10)).toBeCloseTo(d.heightM, 6);
      expect(at(0)).toBeCloseTo(d.heightM * (1 - d.span), 6);
      expect(at(20)).toBeCloseTo(d.heightM * (1 + d.span), 6);
    }
    expect(bodyParams(withBody(base('knollfolk'), { height: 0 })).height).toBeCloseTo(1.196, 3);
    expect(bodyParams(withBody(base('larchfolk'), { height: 20 })).height).toBeCloseTo(2.138, 3);
  });

  it('gives the Brindlekin a tail, a muzzle and fur, and the others never', () => {
    for (const p of PEOPLE_IDS) {
      for (let i = 0; i < 20; i++) {
        let s = i * 7 + 1;
        const l = { ...randomLook(() => ((s = (s * 16807) % 2147483647) / 2147483647)) };
        if (l.people !== p) continue;
        const bp = bodyParams(l);
        if (p === 'brindlekin') { expect(bp.tail).not.toBeNull(); expect(bp.muzzle).not.toBeNull(); expect(bp.fur).toBe(true); }
        else { expect(bp.tail).toBeNull(); expect(bp.muzzle).toBeNull(); expect(bp.fur).toBe(false); }
      }
      const bp = bodyParams(base(p));
      expect(bp.fur).toBe(p === 'brindlekin');
      expect(bp.tail === null).toBe(p !== 'brindlekin');
    }
  });

  it('makes the four peoples different shapes (proportions, not only height)', () => {
    const [h, la, kn, br] = PEOPLE_IDS.map((p) => bodyParams(base(p)));
    expect(la!.limb).toBeGreaterThan(h!.limb);
    expect(la!.shoulder).toBeLessThan(h!.shoulder);
    expect(kn!.headScale).toBeCloseTo(1.15 * (1 + 0.1 * ((base('knollfolk').body.head - 10) / 10)), 6);
    expect(kn!.hand).toBeGreaterThan(1.25);
    expect(kn!.foot).toBeGreaterThan(1.25);
    expect(la!.ear).toBe('pointed');
    expect(kn!.ear).toBe('round');
    expect(typeof br!.ear).toBe('number');
  });

  it('keeps the widest build of every people inside the hit radius', () => {
    for (const p of PEOPLE_IDS) {
      for (const v of [0, 20]) {
        const l = withBody(base(p), { height: 20, build: v, shoulders: 20, hips: 20, head: 20, legs: v });
        expect(halfWidth(bodyParams(l))).toBeLessThanOrEqual(MAX_HALF_WIDTH + 1e-9);
      }
    }
  });
});

describe('makeWarp', () => {
  it('puts the skull top at the look height, and leaves the canonical human (all at 10) unchanged', () => {
    for (const p of PEOPLE_IDS) for (const v of [0, 10, 20]) {
      const bp = bodyParams(withBody(base(p), { height: v, legs: v, head: v }));
      const w = makeWarp(bp);
      const top = { x: 0, y: CANON.top, z: 0 };
      w.apply('head', top);
      expect(top.y * w.s).toBeCloseTo(bp.height, 6);
    }
    const human = bodyParams(withBody(base('human'), { height: 10, build: 10, shoulders: 10, hips: 10, legs: 10, head: 10 }));
    const w = makeWarp(human);
    for (const region of ['leg', 'torso', 'arm', 'head'] as const) {
      const pt = { x: 0.12, y: 0.9, z: 0.05 };
      w.apply(region, pt);
      expect(pt.x).toBeCloseTo(0.12, 9); expect(pt.y).toBeCloseTo(0.9, 9); expect(pt.z).toBeCloseTo(0.05, 9);
    }
  });

  it('is continuous at the hip, the neck, the wrist and the ankle (no tears)', () => {
    const w = makeWarp(bodyParams(withBody(base('knollfolk'), { legs: 20, build: 20 })));
    const a = { x: 0, y: CANON.hip - 1e-6, z: 0 }, b = { x: 0, y: CANON.hip + 1e-6, z: 0 };
    w.apply('torso', a); w.apply('torso', b);
    expect(Math.abs(a.y - b.y)).toBeLessThan(1e-4);
    const n1 = { x: 0, y: CANON.neck, z: 0 }, n2 = { x: 0, y: CANON.neck, z: 0 };
    w.apply('torso', n1); w.apply('head', n2);
    expect(Math.abs(n1.y - n2.y)).toBeLessThan(1e-9);
    for (const [region, y] of [['arm', CANON.wrist + 0.03], ['leg', CANON.ankle + 0.08]] as const) {
      const p = { x: 0.25, y: y + 1e-6, z: 0.02 }, q = { x: 0.25, y: y - 1e-6, z: 0.02 };
      w.apply(region, p); w.apply(region, q);
      expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeLessThan(1e-4);
    }
  });
});

describe('lookColours', () => {
  it('maps the free colours exactly (inside the lightness clamp)', () => {
    const l = base('brindlekin');
    const c = lookColours({ ...l, colours: { skin: 0xc98a4b, hair: 0x4e3d31, facial: 0x8b5b35, eyes: 0x2f5d8a, marks: 0xc2412f }, fur: { pattern: 2, colour: 0x6c4b33, tail: 1 } });
    expect(c.skin.toHexString()).toBe('#C98A4B');
    expect(c.hair.toHexString()).toBe('#4E3D31');
    expect(c.facial.toHexString()).toBe('#8B5B35');
    expect(c.eyes.toHexString()).toBe('#2F5D8A');
    expect(c.marks.toHexString()).toBe('#C2412F');
    expect(c.fur2!.toHexString()).toBe('#6C4B33');
    expect(lookColours(base('human')).fur2).toBeNull();
  });
  it('clamps pure black and pure white so the character stays readable, keeping the hue', () => {
    const lum = (c: { r: number; g: number; b: number }) => (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2;
    expect(lum(renderColour(0x000000))).toBeCloseTo(LIGHTNESS.min, 6);
    expect(lum(renderColour(0xffffff))).toBeCloseTo(LIGHTNESS.max, 6);
    const navy = renderColour(0x000008);
    expect(navy.b).toBeGreaterThan(navy.r);
  });
});

describe('modelParams', () => {
  it('every look field changes the model (no dead slider or picker)', () => {
    for (const people of PEOPLE_IDS) {
      const l = base(people);
      const before = modelParams(l);
      for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
        const [group, key] = path.split('.') as [keyof Look, string];
        if (group === 'fur' && !l.fur) continue;
        const max = group === 'face' && key === 'ears' ? PEOPLES[people].earsMax : hi;
        if (people !== 'brindlekin' && path === 'face.ears' && max === 3) { /* lengths, below */ }
        const g = l[group] as Record<string, number>;
        const next = g[key] === lo ? Math.min(max, lo + (path.startsWith('colours') || path === 'fur.colour' ? 0x40_40_40 : 1)) : lo;
        const changed = parseLook({ ...l, [group]: { ...g, [key]: next } })!;
        expect(changed, path).not.toBeNull();
        const after = modelParams(changed);
        expect(JSON.stringify(after), `${people} ${path}`).not.toBe(JSON.stringify(before));
      }
    }
  });
  it('gives each face picker value its own numbers', () => {
    const l = base('human');
    for (const key of ['shape', 'eyes', 'brows', 'nose', 'mouth'] as const) {
      const seen = new Set<string>();
      const n = LOOK_LIMITS[`face.${key}`]![1] + 1;
      for (let i = 0; i < n; i++) seen.add(JSON.stringify(faceParams({ ...l, face: { ...l.face, [key]: i } })));
      expect(seen.size, key).toBe(n);
    }
  });
  it('two random looks rarely come out alike', () => {
    let s = 99;
    const rng = () => ((s = (s * 48271) % 2147483647) / 2147483647);
    const keys = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const l = randomLook(rng);
      // what reads at a glance: people, hair, facial hair, face shape, marks, and the colours to a coarse step
      keys.add([l.people, l.hair.style, l.hair.facial, l.face.shape, l.face.marks, l.colours.hair >> 21, l.colours.skin >> 21].join(','));
    }
    expect(keys.size).toBeGreaterThan(395);
  });
});
