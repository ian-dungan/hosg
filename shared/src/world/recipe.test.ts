import { describe, expect, it } from 'vitest';
import { MAX_ENEMIES_PER_ZONE } from '../combat/constants';
import { ENEMY_KINDS } from '../combat/enemies';
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
  parts.push(`m${q(z.mouth.x)},${q(z.mouth.z)}`);
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
    const strip = (z: ZoneLayout) => ({ trees: z.trees, rocks: z.rocks, camps: z.camps, obstacles: z.obstacles, entry: z.entry, westGate: z.westGate, mouth: z.mouth });
    expect(strip(again)).toEqual(strip(zone));
    expect(digest(again)).toBe(digest(zone));
    const other = generateZone({ ...GREENWAY_RECIPE, seed: 7332 });
    expect(other.trees).not.toEqual(zone.trees);
    expect(digest(zone)).toMatchSnapshot();
  });

  it('source scan: every generator module (and every non-data module they import) is free of inexact maths and **', async () => {
    // shared/ has no Node typings: a string-typed specifier keeps tsc out of node:fs
    const fs: { readFileSync(p: string, enc: 'utf8'): string } = await import('node:fs' as string);
    const here = expect.getState().testPath!.replace(/[^/\\]+$/, '');
    const bad = /Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|hypot|cbrt|random)\b|\*\*/;
    /** The generator's modules, relative to this folder. */
    const GENERATOR = ['./recipe', './zoneWalk', './limits', './dungeon'];
    /** Pure data tables the generator may read (no arithmetic that shapes the layout). */
    const DATA_TABLES = ['../combat/enemies', '../combat/encounters', '../instance'];
    let imports = 0;
    for (const m of GENERATOR) {
      const src = fs.readFileSync(here + m + '.ts', 'utf8');
      expect(src.length, m).toBeGreaterThan(1000);
      expect(src.match(bad)?.[0] ?? null, m).toBeNull();
      // a value import must be scanned too, or be a known data table (type-only imports carry no code)
      for (const [, spec] of src.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)) {
        expect([...GENERATOR, ...DATA_TABLES], `${m} imports ${spec}`).toContain(spec);
        imports++;
      }
    }
    expect(imports).toBeGreaterThanOrEqual(6); // recipe → zoneWalk, dungeon → recipe and the tables: the import check really runs
  });

  it('the crater mouth step leaves the camps exactly where they were before it (the same doubles)', () => {
    // FNV-1a of JSON.stringify of the camps ({ x, z, r, spawns }) as generated before the mouth existed (Plan 4 Task 2)
    const camps = zone.camps.map(c => ({ x: c.x, z: c.z, r: c.r, spawns: c.spawns }));
    expect(fnv1a(JSON.stringify(camps))).toBe('3b1b42d0');
    expect(zone.camps.flatMap(c => c.spawns)).toHaveLength(21);
  });

  it('the crater mouth: on the road near its east end, 20 m from every camp centre, out of every spawn\'s aggro, clear of rocks and trees by 10 m', () => {
    const { mouth } = zone;
    expect(mouth.z).toBe(zone.roadZ(mouth.x));
    expect(mouth.x).toBe(R.width - R.mouth.fromEast); // the first spot was clear
    for (const c of zone.camps) expect(Math.sqrt((c.x - mouth.x) * (c.x - mouth.x) + (c.z - mouth.z) * (c.z - mouth.z))).toBeGreaterThanOrEqual(R.mouth.campGap);
    for (const s of zone.camps.flatMap(c => c.spawns)) {
      // the mouth's circle (2.5 m) and the arrival spot 5 m west of it are beyond every enemy's aggro
      const ax = mouth.x - 5, az = zone.roadZ(ax);
      expect(Math.sqrt((s.x - mouth.x) * (s.x - mouth.x) + (s.z - mouth.z) * (s.z - mouth.z)) - 2.5).toBeGreaterThan(ENEMY_KINDS[s.kind].aggro);
      expect(Math.sqrt((s.x - ax) * (s.x - ax) + (s.z - az) * (s.z - az))).toBeGreaterThan(ENEMY_KINDS[s.kind].aggro);
    }
    for (const o of zone.obstacles) {
      const dx = o.x - mouth.x, dz = o.z - mouth.z;
      expect(Math.sqrt(dx * dx + dz * dz) - (o as { r: number }).r).toBeGreaterThanOrEqual(R.mouth.clear);
    }
    // a camp in the way pushes it west along the road, 4 m at a time
    const pushed = generateZone({ ...GREENWAY_RECIPE, mouth: { ...GREENWAY_RECIPE.mouth, campGap: 30 } });
    expect(pushed.mouth.x).toBeLessThan(mouth.x);
    expect((mouth.x - pushed.mouth.x) % 4).toBe(0);
    for (const c of pushed.camps) expect(Math.sqrt((c.x - pushed.mouth.x) * (c.x - pushed.mouth.x) + (c.z - pushed.mouth.z) * (c.z - pushed.mouth.z))).toBeGreaterThanOrEqual(30);
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

  it('the west gate is at road level: entry and gate within 0.5 m of each other, the first 15 m of road nearly flat', () => {
    expect(Math.abs(zone.height(zone.entry.x, zone.entry.z) - zone.height(zone.westGate.x, zone.westGate.z))).toBeLessThan(0.5);
    for (let x = 0.5; x < 15; x += 0.5) {
      const z0 = zone.roadZ(x), z1 = zone.roadZ(x + 0.5);
      const run = Math.sqrt(0.25 + (z1 - z0) * (z1 - z0));
      expect(Math.abs(zone.height(x + 0.5, z1) - zone.height(x, z0)) / run, `x ${x}`).toBeLessThan(0.15);
    }
  });

  it('other recipes: either every camp invariant holds or generateZone throws (never a silent bad layout); the Greenway never throws', () => {
    expect(() => generateZone(GREENWAY_RECIPE)).not.toThrow();
    let threw = 0, held = 0;
    for (const width of [140, 160, 200, 260]) for (let seed = 1; seed <= 12; seed++) {
      const rec = { ...GREENWAY_RECIPE, seed, width };
      let z: ZoneLayout;
      try { z = generateZone(rec); } catch (e) {
        expect(String((e as Error).message)).toMatch(/^generateZone\(greenway\): no (valid site for camp \d+|room for a \w+ in camp \d+|site for the crater mouth)$/);
        threw++; continue;
      }
      held++;
      const d = (ax: number, az: number, bx: number, bz: number) => Math.sqrt((ax - bx) * (ax - bx) + (az - bz) * (az - bz));
      z.camps.forEach((c, i) => {
        for (let j = 0; j < i; j++) expect(d(c.x, c.z, z.camps[j].x, z.camps[j].z)).toBeGreaterThanOrEqual(34);
        expect(d(c.x, c.z, z.entry.x, z.entry.z)).toBeGreaterThanOrEqual(35);
        expect(c.x).toBeGreaterThanOrEqual(15); expect(c.x).toBeLessThanOrEqual(width - 15);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(rec.depth / 2 - 15);
        for (let x = c.x - 13; x <= c.x + 13; x += 0.5) expect(d(c.x, c.z, x, z.roadZ(x))).toBeGreaterThan(c.r + 4 - 0.1);
      });
    }
    expect(threw).toBeGreaterThan(0); // the narrow widths really do run out of room
    expect(held).toBeGreaterThan(0);
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
