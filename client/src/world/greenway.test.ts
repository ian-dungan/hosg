// The Greenway's generated placements and ground. The ground guard works like the grove's obstacle drift
// guard: the terrain and road the client draws must agree with the shared ZoneWalk (what the server and the
// character controller stand the adventurer on), so feet never float above or sink into the drawn ground.
import { describe, expect, it } from 'vitest';
import { ENEMY_KINDS, greenwayLayout } from '@sg2/shared';
import {
  greenwayPlacements, greenwayRoad, greenwayTerrain, roadDistance, rockShape, splitTerrain, tileDetail, hash,
  LOW_TERRAIN, PROP_ROAD_CLEAR, PROP_SPAWN_CLEAR, PROP_TREE_CLEAR, PROP_ROCK_K,
} from './greenway';

const layout = greenwayLayout();
const plan = greenwayPlacements(layout);

describe('greenwayPlacements', () => {
  it('places one tree per layout tree and one rock per layout rock, where the layout says', () => {
    expect(plan.trees).toHaveLength(layout.trees.length);
    expect(plan.rocks).toHaveLength(layout.rocks.length);
    plan.trees.forEach((t, i) => {
      expect(t.x).toBe(layout.trees[i].x); expect(t.z).toBe(layout.trees[i].z); expect(t.s).toBe(layout.trees[i].s);
      expect(t.y).toBe(layout.height(t.x, t.z));
    });
    plan.rocks.forEach((r, i) => { expect(r).toMatchObject({ x: layout.rocks[i].x, z: layout.rocks[i].z, r: layout.rocks[i].r, top: layout.rocks[i].top }); });
    // the shapes are varied: more than the three layout kinds
    expect(new Set(plan.trees.map(t => t.kind)).size).toBeGreaterThanOrEqual(4);
  });

  it('gives every camp props, the same every time', () => {
    expect(plan.camps).toHaveLength(layout.camps.length);
    for (const c of plan.camps) {
      expect(c.props.length).toBeGreaterThanOrEqual(4);
      expect(c.props.some(p => p.kind === 'firepit')).toBe(true);
      expect(c.props.some(p => p.kind === 'leanto' || p.kind === 'totem')).toBe(true); // something tall, seen from afar
    }
    expect(greenwayPlacements(layout)).toEqual(plan);
  });

  it('stands the gate arch within 3 m of the west gate, and the barricade at the east end', () => {
    expect(Math.hypot(plan.gate.x - layout.westGate.x, plan.gate.z - layout.westGate.z)).toBeLessThanOrEqual(3);
    expect(plan.barricade.x).toBeGreaterThan(layout.recipe.width - 6);
    expect(Math.abs(plan.barricade.z - layout.roadZ(plan.barricade.x))).toBeLessThan(1);
  });

  it('keeps every prop off the road band and clear of every spawn', () => {
    const halfRoad = layout.recipe.road.width / 2;
    let checked = 0;
    for (const c of plan.camps) for (const p of c.props) {
      expect(roadDistance(layout, p.x, p.z)).toBeGreaterThan(halfRoad + PROP_ROAD_CLEAR + p.r);
      for (const camp of layout.camps) for (const s of camp.spawns) {
        expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(p.r + ENEMY_KINDS[s.kind].radius + PROP_SPAWN_CLEAR);
      }
      for (const q of c.props) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(p.r + q.r);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
    // the road's own furniture stands beside the verge, never on the road or in a camp
    expect(plan.roadside.length).toBeGreaterThan(5);
    for (const p of plan.roadside) {
      expect(roadDistance(layout, p.x, p.z)).toBeGreaterThan(halfRoad + 1 + p.r);
      for (const c of layout.camps) expect(Math.hypot(p.x - c.x, p.z - c.z)).toBeGreaterThan(c.r + 4);
    }
  });

  it('props never stand in a tree trunk or a rock', () => {
    const props = [...plan.camps.flatMap(c => c.props), ...plan.roadside];
    for (const p of props) {
      for (const t of layout.trees) expect(Math.hypot(p.x - t.x, p.z - t.z)).toBeGreaterThan(p.r + PROP_TREE_CLEAR);
      for (const r of layout.rocks) expect(Math.hypot(p.x - r.x, p.z - r.z)).toBeGreaterThan(p.r + r.r * PROP_ROCK_K);
    }
  });

  it('variety comes from an integer hash: the same values in every browser', () => {
    expect(hash(0, 0)).toBe(0);
    expect(hash(1.5, -2.25)).toBeCloseTo(hash(1.5, -2.25), 15);
    const vals = Array.from({ length: 2000 }, (_, i) => hash(i * 0.37, i * 1.13));
    for (const v of vals) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.03);
  });

  it('rocks you can climb have a flat top exactly at the platform height that covers the whole platform', () => {
    let platforms = 0;
    for (const r of plan.rocks) {
      const s = rockShape(r);
      if (r.top === null) { expect(s.capY).toBeNull(); continue; }
      platforms++;
      expect(s.capY).toBe(r.top);
      // the cap polygon is convex, wound one way, and every edge keeps the walk circle inside
      const n = s.top.length;
      let sign = 0;
      for (let i = 0; i < n; i++) {
        const [ax, az] = s.top[i], [bx, bz] = s.top[(i + 1) % n];
        const cross = (ax - r.x) * (bz - r.z) - (az - r.z) * (bx - r.x);
        if (sign === 0) sign = Math.sign(cross);
        expect(Math.sign(cross)).toBe(sign);
        expect(Math.abs(cross) / Math.hypot(bx - ax, bz - az)).toBeGreaterThanOrEqual(r.r);
      }
    }
    expect(platforms).toBeGreaterThan(5);
  });
});

/** Height of the topmost triangle over (x, z) in an indexed mesh, or null; found independently of how the mesh was built. */
function sampler(pos: Float32Array, idx: Uint32Array, nTris = idx.length / 3) {
  const CELL = 2, buckets = new Map<number, number[]>();
  const key = (i: number, j: number) => i * 100003 + j;
  for (let t = 0; t < nTris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const x0 = Math.min(pos[a], pos[b], pos[c]), x1 = Math.max(pos[a], pos[b], pos[c]);
    const z0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), z1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
      let l = buckets.get(key(i, j)); if (!l) buckets.set(key(i, j), l = []); l.push(t);
    }
  }
  return (x: number, z: number): number | null => {
    let best: number | null = null;
    for (const t of buckets.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue; // degenerate in plan view
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w = 1 - u - v;
      const e = -1e-9;
      if (u < e || v < e || w < e) continue;
      const y = u * pos[a + 1] + v * pos[b + 1] + w * pos[c + 1];
      if (best === null || y > best) best = y;
    }
    return best;
  };
}

describe('the drawn ground matches the shared ZoneWalk', () => {
  const terrain = greenwayTerrain(layout, plan);
  const ground = sampler(terrain.positions, terrain.indices, terrain.topTriangles);
  const b = layout.walk.bounds;

  it('terrain: within 2.5 cm of groundAt everywhere an adventurer can stand, and within 1.5 cm nearly everywhere', () => {
    let n = 0, worst = 0, over = 0;
    for (let x = b.x0; x <= b.x1; x += 0.43) for (let z = b.z0; z <= b.z1; z += 0.47) {
      const g = layout.walk.groundAt(x, z);
      if (g === null) continue;
      const m = ground(x, z);
      expect(m).not.toBeNull();
      const e = Math.abs(m! - g);
      worst = Math.max(worst, e);
      if (e > 0.015) over++;
      n++;
    }
    expect(n).toBeGreaterThan(150_000);
    expect(worst).toBeLessThanOrEqual(0.025);
    expect(over / n).toBeLessThan(0.001);
  });

  it('the terrain is a single cover with no holes along the edges of the walkable bounds', () => {
    for (let x = b.x0 - 6; x <= b.x1 + 6; x += 1.3) for (const z of [b.z0 - 4, b.z0, b.z1, b.z1 + 4]) expect(ground(x, z)).not.toBeNull();
  });

  it('road: never below the ground and at most 2 cm above it', () => {
    const road = greenwayRoad(layout);
    const top = sampler(road.positions, road.indices);
    let n = 0;
    for (let x = b.x0; x <= b.x1; x += 0.29) for (let dz = -2.4; dz <= 2.4; dz += 0.3) {
      const z = layout.roadZ(x) + dz, g = layout.walk.groundAt(x, z), y = top(x, z);
      if (g === null || y === null) continue;
      expect(y - g).toBeGreaterThanOrEqual(0);
      expect(y - g).toBeLessThanOrEqual(0.02);
      n++;
    }
    expect(n).toBeGreaterThan(10_000);
  });
});

describe('terrain tiles and tiers', () => {
  const b = layout.walk.bounds;
  it('the coarse terrain (far tiles, low tier) covers the walkable area without holes, within 7 cm of groundAt', () => {
    const t = greenwayTerrain(layout, plan, LOW_TERRAIN);
    const ground = sampler(t.positions, t.indices, t.topTriangles);
    let worst = 0;
    for (let x = b.x0 - 6; x <= b.x1 + 6; x += 0.9) for (let z = b.z0 - 6; z <= b.z1 + 6; z += 0.97) {
      const m = ground(x, z);
      expect(m).not.toBeNull();
      const g = layout.walk.groundAt(x, z);
      if (g !== null) worst = Math.max(worst, Math.abs(m! - g));
    }
    expect(worst).toBeLessThanOrEqual(0.07);
    expect(t.topTriangles).toBeLessThan(greenwayTerrain(layout, plan).topTriangles * 0.5);
  });

  it('splitTerrain keeps every triangle once, in the tile of its centroid, plus skirts under the tile edges', () => {
    const t = greenwayTerrain(layout, plan, LOW_TERRAIN);
    const tileOf = (x: number, z: number) => (x < 100 ? 0 : 1) + (z < 0 ? 0 : 2);
    const tiles = splitTerrain(t, tileOf, 4);
    let top = 0;
    for (const tile of tiles) {
      expect(tile).not.toBeNull();
      const P = tile!.positions, I = tile!.indices;
      for (let k = 0; k < I.length; k += 3) {
        const ys = [P[I[k] * 3 + 1], P[I[k + 1] * 3 + 1], P[I[k + 2] * 3 + 1]];
        const xs = [P[I[k] * 3], P[I[k + 1] * 3], P[I[k + 2] * 3]];
        // top triangles (no lowered skirt vertex): count them
        const skirt = I[k] >= 0 && ys.some((y, q) => { const g = layout.height(xs[q], P[[I[k], I[k + 1], I[k + 2]][q] * 3 + 2]); return y < g - 0.2; });
        if (!skirt) top++;
      }
      expect(tile!.normals.length).toBe(P.length);
    }
    expect(top).toBe(t.topTriangles);
  });

  it('tileDetail: near tiles draw the fine ground and full trees; far tiles and the low tier the cheap ones', () => {
    expect(tileDetail(0, 'high')).toEqual({ fine: true, detail: true, under: true, grassA: true, grassB: true });
    expect(tileDetail(0, 'med')).toMatchObject({ fine: true, detail: true, under: true, grassA: true, grassB: false });
    expect(tileDetail(200, 'high')).toEqual({ fine: false, detail: false, under: false, grassA: false, grassB: false });
    expect(tileDetail(0, 'low')).toEqual({ fine: false, detail: false, under: false, grassA: false, grassB: false });
    for (const d of [0, 10, 30, 60, 100]) {
      const m = tileDetail(d, 'med'), h = tileDetail(d, 'high');
      for (const k of ['fine', 'detail', 'under', 'grassA', 'grassB'] as const) if (m[k]) expect(h[k]).toBe(true); // high draws at least what med does
    }
  });
});
