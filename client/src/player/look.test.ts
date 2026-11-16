import { describe, expect, it } from 'vitest';
import { LOOK_LIMITS, LOOK_OPTIONAL_COLOURS, LOOK_PRESETS, PEOPLES, PEOPLE_IDS, parseLook, prng, randomLook, type Look } from '@sg2/shared';
import { CANON, LIGHTNESS, MAX_HALF_WIDTH, bodyFrame, halfWidth, lookColours, makeAttachWarp, modelParams, renderColour } from './look';

const preset = (p: Look['people'], b: Look['body']) => LOOK_PRESETS.find((x) => x.look.people === p && x.look.body === b)!.look;
const withPath = (l: Look, path: string, v: number | null): Look | null => {
  const [g, k] = path.split('.') as [keyof Look, string];
  const grp = l[g];
  if (!grp || typeof grp !== 'object') return null;
  return parseLook({ ...l, [g]: { ...(grp as Record<string, number>), [k]: v } });
};
const mid = (l: Look): Look => {
  const o = JSON.parse(JSON.stringify(l)) as Record<string, Record<string, number>>;
  for (const k of Object.keys(o.build!)) o.build![k] = 10;
  return parseLook(o)!;
};

describe('modelParams: every field of a look changes the model', () => {
  it('each numeric field, moved, changes something the model is built from (both bodies, every people)', () => {
    for (const p of PEOPLE_IDS) for (const b of ['male', 'female'] as const) {
      const base = preset(p, b);
      const before = JSON.stringify(modelParams(base));
      for (const [path, [lo, hi]] of Object.entries(LOOK_LIMITS)) {
        if (path.startsWith('fur.') && !PEOPLES[p].furred) continue;
        const cur = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], base) as number;
        const cands = path.endsWith('olour') || path.endsWith('olour2') ? [0x3366aa, 0xaa6633] : [lo, hi, Math.round((lo + hi) / 2), lo + 1];
        const top = path === 'ears.style' ? PEOPLES[p].earsMax : hi;
        const changed = cands.filter((v) => v !== cur && v <= Math.max(top, 0xffffff * +(path.endsWith('olour') || path.endsWith('olour2')))).some((v) => {
          const l = withPath(base, path, v);
          return l !== null && JSON.stringify(modelParams(l)) !== before;
        });
        expect(changed, `${p} ${b}: ${path}`).toBe(true);
      }
      for (const path of LOOK_OPTIONAL_COLOURS) {
        const l = withPath(base, path, 0x55aa33)!;
        expect(JSON.stringify(modelParams(l)) !== before, `${p} ${b}: ${path}`).toBe(true);
      }
      // the body and the people
      expect(JSON.stringify(modelParams({ ...base, body: b === 'male' ? 'female' : 'male' }))).not.toBe(before);
    }
  });

  it('every body slider visibly moves the body frame (by at least a centimetre or 4 %)', () => {
    for (const b of ['male', 'female'] as const) {
      const base = mid(preset('human', b));
      for (const k of Object.keys(base.build)) {
        const lo = bodyFrame(withPath(base, `build.${k}`, 0)!), hi = bodyFrame(withPath(base, `build.${k}`, 20)!);
        const moved = Object.keys(lo).some((f) => {
          const a = (lo as unknown as Record<string, number>)[f]!, c = (hi as unknown as Record<string, number>)[f]!;
          return typeof a === 'number' && (Math.abs(a - c) >= 0.01 || Math.abs(a - c) / Math.max(1e-6, Math.abs(a)) >= 0.04);
        });
        expect(moved, `${b} build.${k}`).toBe(true);
      }
    }
  });
});

describe('bodyFrame', () => {
  it('gives each people its height at sliders 0, 10 and 20 (female 6 % shorter), within its span', () => {
    for (const p of PEOPLE_IDS) {
      const d = PEOPLES[p];
      for (const [b, k] of [['male', 1], ['female', 0.94]] as const) {
        const at = (h: number) => bodyFrame(withPath(mid(preset(p, b)), 'build.height', h)!).H;
        expect(at(10)).toBeCloseTo(d.heightM * k, 6);
        expect(at(0)).toBeCloseTo(d.heightM * k * (1 - d.span), 6);
        expect(at(20)).toBeCloseTo(d.heightM * k * (1 + d.span), 6);
      }
    }
  });

  it('has natural proportions: about seven heads for Humans, more for Larchfolk, about five for Knollfolk', () => {
    const heads = (p: Look['people']) => { const f = bodyFrame(mid(preset(p, 'male'))); return f.H / f.headH; };
    expect(heads('human')).toBeGreaterThan(6.8); expect(heads('human')).toBeLessThan(7.6);
    expect(heads('larchfolk')).toBeGreaterThan(heads('human'));
    expect(heads('knollfolk')).toBeLessThan(5.5);
    const f = bodyFrame(mid(preset('human', 'male')));
    expect(f.hipY / f.H).toBeGreaterThan(0.48); expect(f.hipY / f.H).toBeLessThan(0.55);   // legs about half the height
    expect(f.chinY).toBeGreaterThan(f.shTopY);
    expect(f.wristY).toBeLessThan(f.hipY); expect(f.wristY).toBeGreaterThan(f.kneeY);
  });

  it('makes male and female two base shapes (shoulders, waist, hips, bust)', () => {
    const m = bodyFrame(mid(preset('human', 'male'))), w = bodyFrame(mid(preset('human', 'female')));
    expect(m.shX).toBeGreaterThan(w.shX);
    expect(w.hipW / w.waistW).toBeGreaterThan(m.hipW / m.waistW);
    expect(w.bust).toBeGreaterThan(m.bust);
  });

  it('keeps the widest build of every people and body inside the hit radius', () => {
    for (const p of PEOPLE_IDS) for (const b of ['male', 'female'] as const) {
      const base = preset(p, b);
      const wide = parseLook({ ...base, build: { height: 20, shoulders: 20, chest: 20, waist: 20, hips: 20, arms: 20, legs: 0, muscle: 20, weight: 20, neck: 20, head: 20 }, face: { ...base.face, width: 10 } })!;
      expect(halfWidth(bodyFrame(wide)), `${p} ${b}`).toBeLessThanOrEqual(MAX_HALF_WIDTH + 1e-9);
    }
    for (let i = 0; i < 200; i++) expect(halfWidth(bodyFrame(randomLook(prng(i + 1))))).toBeLessThanOrEqual(MAX_HALF_WIDTH + 1e-9);
  });
});

describe('makeAttachWarp: the old humanoid onto the new body', () => {
  it('maps the old landmarks onto this body (shoulder, elbow, wrist, hip, knee, ankle, head)', () => {
    for (const l of [preset('human', 'male'), preset('knollfolk', 'female'), preset('larchfolk', 'male')]) {
      const f = bodyFrame(l), w = makeAttachWarp(f);
      const at = (r: Parameters<typeof w.apply>[0], x: number, y: number, z = 0) => { const p = { x, y, z }; w.apply(r, p); return p; };
      expect(at('arm', CANON.shoulderX, CANON.shoulderY).y).toBeCloseTo(f.shY, 5);
      expect(at('arm', CANON.shoulderX, CANON.shoulderY).x).toBeCloseTo(f.shX, 5);
      expect(at('arm', CANON.shoulderX, CANON.elbow).y).toBeCloseTo(f.elbowY, 5);
      expect(at('arm', CANON.shoulderX, CANON.wrist).y).toBeCloseTo(f.wristY, 5);
      expect(at('leg', CANON.legX, CANON.hip).y).toBeCloseTo(f.hipY, 5);
      expect(at('leg', CANON.legX, CANON.knee).y).toBeCloseTo(f.kneeY, 5);
      expect(at('leg', CANON.legX, CANON.ankle).y).toBeCloseTo(f.ankleY, 5);
      expect(at('head', 0, CANON.headY).y).toBeCloseTo(f.headY, 5);
      // the old skull's side lands on the new skull's side
      expect(at('head', CANON.headR[0], CANON.headY).x).toBeCloseTo(f.headW, 5);
    }
  });
});

describe('colours', () => {
  it('clamps rendered lightness so no part vanishes (black and white move inside, ordinary colours are exact)', () => {
    const L = (c: { r: number; g: number; b: number }) => (Math.max(c.r, c.g, c.b) + Math.min(c.r, c.g, c.b)) / 2;
    expect(L(renderColour(0x000000))).toBeCloseTo(LIGHTNESS.min, 5);
    expect(L(renderColour(0xffffff))).toBeCloseTo(LIGHTNESS.max, 5);
    expect(renderColour(0x8040c0).toHexString().toLowerCase()).toBe('#8040c0');
    for (let i = 0; i < 100; i++) {
      const c = lookColours(randomLook(prng(i + 7)));
      for (const v of Object.values(c)) if (v) { expect(L(v)).toBeGreaterThanOrEqual(LIGHTNESS.min - 1e-6); expect(L(v)).toBeLessThanOrEqual(LIGHTNESS.max + 1e-6); }
    }
  });

  it('greys the hair with `grey`, and the second eye and the brows follow their own colour or the default', () => {
    const l = preset('human', 'female');
    const g0 = lookColours(withPath(l, 'hair.grey', 0)!).hair, g4 = lookColours(withPath(l, 'hair.grey', 4)!).hair;
    expect(g0.toHexString()).not.toBe(g4.toHexString());
    const same = lookColours(withPath(l, 'eyes.colour2', null)!);
    expect(same.eyes2.toHexString()).toBe(same.eyes.toHexString());
    expect(lookColours(withPath(l, 'brows.colour', null)!).brows.toHexString()).toBe(lookColours(l).hair.toHexString());
  });
});
