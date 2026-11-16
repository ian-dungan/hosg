// The face's nose and lips as numbers: each slider moves its own part by a stated amount, in profile and from the
// front (live check: noses read as flat ridges, lips were small).
import { describe, expect, it } from 'vitest';
import { lipShape, noseStations } from './face2';

const N0 = { noseLen: 0, noseW: 0, bridge: 0, tip: 0 };
const nose = (o: Partial<typeof N0>) => noseStations({ ...N0, ...o }, 0.06);
const TIP = 4, RHINION = 2, NASION = 1, COLUMELLA = 5;

describe('noseStations', () => {
  it('has a real bridge, a tip that stands out further than the bridge, and wings either side of the tip', () => {
    const { st, wing } = nose({});
    expect(st[TIP]!.proj).toBeGreaterThan(st[RHINION]!.proj * 1.5);
    expect(st[TIP]!.proj).toBeGreaterThanOrEqual(0.018);                 // about 2 cm off the face: not a ridge
    expect(st[RHINION]!.round).toBeLessThan(st[TIP]!.round);              // a sharp bridge, a round tip
    expect(wing.x).toBeGreaterThan(st[TIP]!.hw * 0.8);
    expect(wing.y).toBeLessThan(st[TIP]!.y);
    for (let i = 1; i < st.length; i++) expect(st[i]!.y).toBeLessThan(st[i - 1]!.y);
  });
  it('length: the tip lower (front) and further out (profile)', () => {
    const a = nose({ noseLen: -1 }), b = nose({ noseLen: 1 });
    expect(a.st[TIP]!.y - b.st[TIP]!.y).toBeGreaterThanOrEqual(0.15);      // head units (~1.8 cm)
    expect(b.st[TIP]!.proj / a.st[TIP]!.proj).toBeGreaterThanOrEqual(1.35);
    expect(b.st[TIP]!.hw).toBeCloseTo(a.st[TIP]!.hw, 6);
  });
  it('width: the bridge, the tip and the wings wider (front)', () => {
    const a = nose({ noseW: -1 }), b = nose({ noseW: 1 });
    expect(b.st[TIP]!.hw / a.st[TIP]!.hw).toBeGreaterThanOrEqual(2.5);
    expect(b.wing.x / a.wing.x).toBeGreaterThanOrEqual(2);
    expect(b.st[TIP]!.proj).toBeCloseTo(a.st[TIP]!.proj, 6);
  });
  it('bridge: the ridge much higher in profile and narrower from the front', () => {
    const a = nose({ bridge: -1 }), b = nose({ bridge: 1 });
    expect(b.st[RHINION]!.proj / a.st[RHINION]!.proj).toBeGreaterThanOrEqual(2.5);
    expect(b.st[NASION]!.proj / a.st[NASION]!.proj).toBeGreaterThanOrEqual(3);
    expect(a.st[RHINION]!.hw / b.st[RHINION]!.hw).toBeGreaterThanOrEqual(1.25);
  });
  it('tip: up (higher, the columella shows) or down (drooping)', () => {
    const a = nose({ tip: -1 }), b = nose({ tip: 1 });
    expect(b.st[TIP]!.y - a.st[TIP]!.y).toBeGreaterThanOrEqual(0.07);
    expect(a.st[COLUMELLA]!.proj / b.st[COLUMELLA]!.proj).toBeGreaterThanOrEqual(1.4);
  });
});

const L0 = { mouthW: 0, upper: 0, lower2: 0, mouthY: 0, lipFull: 1 };
const lips = (o: Partial<typeof L0>) => lipShape({ ...L0, ...o });
describe('lipShape', () => {
  it('full lips by default: the upper about 6-7 mm, the lower about 8-9 mm, both standing out', () => {
    const l = lips({});
    expect(l.upperH).toBeGreaterThanOrEqual(0.006); expect(l.lowerH).toBeGreaterThan(l.upperH);
    expect(l.upperProj).toBeGreaterThanOrEqual(0.003); expect(l.lowerProj).toBeGreaterThanOrEqual(0.0035);
  });
  it('the upper and lower lip move separately, each by a wide margin', () => {
    const a = lips({ upper: -1 }), b = lips({ upper: 1 });
    expect(b.upperH / a.upperH).toBeGreaterThanOrEqual(2.5);
    expect(b.upperProj / a.upperProj).toBeGreaterThanOrEqual(2.5);
    expect(b.lowerH).toBe(a.lowerH);
    const c = lips({ lower2: -1 }), d = lips({ lower2: 1 });
    expect(d.lowerH / c.lowerH).toBeGreaterThanOrEqual(2.5);
    expect(d.upperH).toBe(c.upperH);
  });
  it('width and height move the corners and the line', () => {
    expect(lips({ mouthW: 1 }).hw / lips({ mouthW: -1 }).hw).toBeGreaterThanOrEqual(1.9);
    expect(lips({ mouthY: 1 }).y - lips({ mouthY: -1 }).y).toBeCloseTo(0.1, 6);
  });
  it('the female base has fuller lips', () => {
    expect(lips({ lipFull: 1.14 }).lowerH / lips({}).lowerH).toBeGreaterThanOrEqual(1.1);
  });
});
