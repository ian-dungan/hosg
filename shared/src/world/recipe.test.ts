import { describe, expect, it } from 'vitest';
import { MAX_ENEMIES_PER_ZONE } from '../combat/constants';
import { findPath, withClearance } from '../path';
import { GREENWAY_RECIPE, generateZone, noise2, prng, type ZoneLayout } from './recipe';
import { ZoneWalk } from './zoneWalk';


const zone = generateZone(GREENWAY_RECIPE);
const R = GREENWAY_RECIPE;
const groundOk = (z: ZoneLayout) => (x: number, zz: number) => z.walk.groundAt(x, zz) !== null;

/** FNV-1a (32-bit) over a string. */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
const q = (v: number) => Math.round(v * 1e6);
function digest(z: ZoneLayout): string {
  const parts: string[] = [];
  for (const t of z.trees) parts.push(`t${q(t.x)},${q(t.z)},${q(t.s)},${t.kind}`);
  for (const r of z.rocks) parts.push(`r${q(r.x)},${q(r.z)},${q(r.r)},${q(r.h)},${r.top === null ? 'w' : q(r.top)}`);
  for (const c of z.camps) {
    parts.push(`c${q(c.x)},${q(c.z)},${q(c.r)}`);
    for (const s of c.spawns) parts.push(`s${s.kind},${q(s.x)},${q(s.z)},${q(s.facing)}`);
  }
  for (let x = 0; x <= R.width; x += 2) parts.push(`p${q(z.roadZ(x))},${q(z.height(x, z.roadZ(x) + 20))}`);
  return fnv1a(parts.join(';'));
}

describe('prng and noise2', () => {
  it('prng is mulberry32: repeatable, in [0, 1)', () => {
    const a = prng(42), b = prng(42);
    for (let i = 0; i < 1000; i++) { const v = a(); expect(v).toBe(b()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    // mulberry32(1)'s first output, as published
    expect(prng(1)()).toBeCloseTo(0.6270739405881613, 15);
  });
  it('noise2 is in [0, 1], continuous, and changes with the seed', () => {
    let diff = 0;
    for (let i = 0; i < 400; i++) {
      const x = i * 0.37 - 50, z = i * 0.23 - 30;
      const v = noise2(5, x, z);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(noise2(5, x + 1e-4, z) - v)).toBeLessThan(1e-3);
      diff += Math.abs(noise2(6, x, z) - v);
    }
    expect(diff).toBeGreaterThan(20);
  });
});

describe('generateZone(GREENWAY_RECIPE)', () => {
  it('stable output: deep-equal on a second call; another seed changes the trees; digest snapshot', () => {
    const again = generateZone(GREENWAY_RECIPE);
    const strip = (z: ZoneLayout) => ({ trees: z.trees, rocks: z.rocks, camps: z.camps, obstacles: z.obstacles, entry: z.entry, westGate: z.westGate });
    expect(strip(again)).toEqual(strip(zone));
    expect(digest(again)).toBe(digest(zone));
    const other = generateZone({ ...GREENWAY_RECIPE, seed: 7332 });
    expect(other.trees).not.toEqual(zone.trees);
    expect(digest(zone)).toMatchSnapshot();
  });

  it('source scan: no inexact maths and no ** in recipe.ts or zoneWalk.ts', async () => {
    // shared/ has no Node typings: a string-typed specifier keeps tsc out of node:fs
    const fs: { readFileSync(p: string, enc: 'utf8'): string } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const bad = /Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|hypot|cbrt|random)\b|\*\*/;
    for (const f of ['recipe.ts', 'zoneWalk.ts']) {
      const src = fs.readFileSync(here + f, 'utf8');
      expect(src.length, f).toBeGreaterThan(1000);
      expect(src.match(bad)?.[0] ?? null, f).toBeNull();
    }
  });

  it('counts: trees, rocks, and six camps whose spawns match the groups exactly', () => {
    expect(zone.trees.length).toBeGreaterThanOrEqual(304); expect(zone.trees.length).toBeLessThanOrEqual(380);
    expect(zone.rocks.length).toBeGreaterThanOrEqual(38); expect(zone.rocks.length).toBeLessThanOrEqual(48);
    expect(zone.camps).toHaveLength(6);
    zone.camps.forEach((c, i) => {
      const got: Record<string, number> = {};
      for (const s of c.spawns) got[s.kind] = (got[s.kind] ?? 0) + 1;
      expect(got).toEqual(R.camps.groups[i]);
    });
    const all = zone.camps.flatMap(c => c.spawns);
    expect(all).toHaveLength(21);
    expect(all.filter(s => s.kind === 'mossback')).toHaveLength(2);
    expect(all.length).toBeLessThanOrEqual(MAX_ENEMIES_PER_ZONE);
    // elites stand at their camp's centre
    for (const c of zone.camps) for (const s of c.spawns) if (s.kind === 'mossback') expect([s.x, s.z]).toEqual([c.x, c.z]);
    // obstacles: one per tree and rock, circles only
    expect(zone.obstacles).toHaveLength(zone.trees.length + zone.rocks.length);
    expect(zone.obstacles.every(o => o.kind === 'c')).toBe(true);
  });

  it('the road is clear: every 1 m in x, points within width/2 + 0.5 of roadZ have ground', () => {
    const half = R.road.width / 2 + 0.5;
    for (let x = 1; x <= R.width - 3; x += 1) {
      const rz = zone.roadZ(x);
      for (let dz = -half; dz <= half + 1e-9; dz += 0.25) expect(zone.walk.groundAt(x, rz + dz), `x ${x} dz ${dz}`).not.toBeNull();
    }
  });

  it('the road is walkable end to end from the gate (a path with 0.3 m clearance; no step up along the road)', () => {
    const end = { x: R.width - 4, z: zone.roadZ(R.width - 4) };
    const path = findPath(zone.entry, end, withClearance(groundOk(zone), 0.3), { maxNodes: 60000 });
    expect(path).not.toBeNull();
    expect(path!.at(-1)!.x).toBeCloseTo(end.x, 0);
    // and straight along the road in 0.25 m steps there is never a step up more than STEP_UP (0.35 m)
    let prev = zone.walk.surfaceAt(zone.westGate.x, zone.westGate.z)!;
    for (let x = zone.westGate.x; x <= R.width - 3; x += 0.25) {
      const h = zone.walk.surfaceAt(x, zone.roadZ(x))!;
      expect(Math.abs(h - prev)).toBeLessThan(0.35);
      prev = h;
    }
  });

  it('no tree or rock touches the road band, the entry or the west gate', () => {
    for (const o of zone.obstacles) {
      for (let x = Math.max(0, o.x - 30); x <= o.x + 30; x += 0.25) {
        const dx = x - o.x, dz = zone.roadZ(x) - o.z;
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan((o as { r: number }).r + R.road.width / 2);
      }
      for (const p of [zone.entry, zone.westGate]) {
        const dx = p.x - o.x, dz = p.z - o.z;
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan((o as { r: number }).r + 3);
      }
    }
  });

  it('spawns: standable with 0.6 m clearance, at least spacing apart, inside no obstacle; camps spread out', () => {
    const clear = withClearance(groundOk(zone), 0.6);
    const all = zone.camps.flatMap(c => c.spawns);
    for (const s of all) {
      expect(clear(s.x, s.z), `${s.kind} at ${s.x},${s.z}`).toBe(true);
      expect(Number.isFinite(s.facing)).toBe(true);
      for (const o of zone.obstacles) {
        const dx = s.x - o.x, dz = s.z - o.z;
        expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThan((o as { r: number }).r + 0.6);
      }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const dx = all[i].x - all[j].x, dz = all[i].z - all[j].z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThanOrEqual(R.camps.spacing);
    }
    for (const c of zone.camps) for (const s of c.spawns) {
      const dx = s.x - c.x, dz = s.z - c.z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeLessThanOrEqual(c.r - 1 + 1e-9);
    }
    const cs = zone.camps;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const dx = cs[i].x - cs[j].x, dz = cs[i].z - cs[j].z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThanOrEqual(34);
    }
    for (const c of cs) {
      const dx = c.x - zone.entry.x, dz = c.z - zone.entry.z;
      expect(Math.sqrt(dx * dx + dz * dz)).toBeGreaterThanOrEqual(35);
    }
    // the deep camp is well off the road
    const deep = cs[R.camps.deep[0]];
    expect(Math.abs(deep.z - zone.roadZ(deep.x))).toBeGreaterThanOrEqual(R.camps.deepOffset[0]);
  });

  it('reachability: a path from the entry to every camp centre and every spawn (0.3 m clearance)', () => {
    const passable = withClearance(groundOk(zone), 0.3);
    for (const c of zone.camps) {
      const p = findPath(zone.entry, { x: c.x, z: c.z }, passable);
      expect(p, `camp at ${c.x},${c.z}`).not.toBeNull();
      const last = p!.at(-1)!;
      expect(Math.abs(last.x - c.x) + Math.abs(last.z - c.z)).toBeLessThan(1);
      for (const s of c.spawns) expect(findPath(last, s, passable), `${s.kind}`).not.toBeNull();
    }
  });

  it('rocks: platform tops stand 0.45–1.05 m above the terrain; walls give surfaceAt null', () => {
    const plats = zone.rocks.filter(r => r.top !== null), walls = zone.rocks.filter(r => r.top === null);
    expect(plats.length).toBeGreaterThan(0); expect(walls.length).toBeGreaterThan(0);
    for (const r of plats) {
      const above = r.top! - zone.height(r.x, r.z);
      expect(above).toBeGreaterThanOrEqual(0.45); expect(above).toBeLessThanOrEqual(1.05);
      expect(zone.walk.surfaceAt(r.x, r.z)).toBe(r.top);
      expect(zone.walk.groundAt(r.x, r.z)).toBeNull();
    }
    for (const r of walls) expect(zone.walk.surfaceAt(r.x, r.z)).toBeNull();
    for (const r of zone.rocks) { expect(r.r).toBeGreaterThanOrEqual(0.6); expect(r.r).toBeLessThanOrEqual(2); }
  });

  it('entry and gate: entry on the road facing east, the gate at the west end; bounds are enforced', () => {
    expect(zone.entry).toEqual({ x: 8, z: zone.roadZ(8), facing: Math.PI / 2 });
    expect(zone.westGate).toEqual({ x: 2, z: zone.roadZ(2) });
    expect(zone.roadZ(0)).toBe(0);
    expect(zone.walk.groundAt(0.4, 0)).toBeNull();
    expect(zone.walk.groundAt(R.width - 1.9, zone.roadZ(R.width - 1.9))).toBeNull();
    expect(zone.walk.groundAt(100, R.depth / 2 - 0.9)).toBeNull();
    expect(zone.walk.groundAt(100, -R.depth / 2 + 0.9)).toBeNull();
    // the terrain is flat on the road and rises at the bounds
    expect(Math.abs(zone.height(130, zone.roadZ(130)))).toBeLessThan(1e-9);
    expect(zone.height(130, R.depth / 2)).toBeGreaterThan(2);
  });

  it('speed: generateZone finishes in under 500 ms', () => {
    const t0 = Date.now();
    generateZone(GREENWAY_RECIPE);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('ZoneWalk', () => {
  const w = new ZoneWalk({ x0: 0, x1: 20, z0: -10, z1: 10 }, (x) => x * 0.1, [
    { kind: 'c', x: 5, z: 0, r: 1 }, { kind: 'c', x: 10, z: 0, r: 1, top: 3 }, { kind: 'c', x: 10.5, z: 0, r: 0.4, top: 4 },
  ]);
  it('terrain inside the bounds, null outside', () => {
    expect(w.groundAt(2, 2)).toBeCloseTo(0.2, 12);
    expect(w.surfaceAt(2, 2)).toBeCloseTo(0.2, 12);
    expect(w.groundAt(-0.1, 0)).toBeNull(); expect(w.groundAt(20.1, 0)).toBeNull(); expect(w.surfaceAt(3, 10.1)).toBeNull();
  });
  it('walls: both null; platforms: groundAt null, surfaceAt the highest top', () => {
    expect(w.groundAt(5, 0)).toBeNull(); expect(w.surfaceAt(5, 0)).toBeNull();
    expect(w.groundAt(9.5, 0)).toBeNull(); expect(w.surfaceAt(9.5, 0)).toBe(3);
    expect(w.surfaceAt(10.5, 0)).toBe(4);
  });
});
