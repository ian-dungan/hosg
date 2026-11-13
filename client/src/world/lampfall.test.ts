import { describe, expect, it } from 'vitest';
import { NullEngine, Scene, Mesh } from '@babylonjs/core';
import { ENEMY_ATTACKS, GATE_PIT, GATE_WICK, inShape, lampfallGates, lampfallLayout, type EnemyAttackId, type Shape } from '@sg2/shared';
import { LAMPFALL_BUDGET, buildLampfall, lampfallGeometry, lampfallPlan, lampfallTriangles } from './lampfall';
import { ARENA_TELEGRAPH_R, TGlyph, TStyle, decalGrid, floorReach, telegraphLook } from '../combat/telegraphs';
import { fieldGrid } from '../combat/fields';
import { Model, type KindDef } from '../combat/enemies';
import { MOUTH_BUDGET, MOUTH_PIT, mouthGeometry } from './mouth';
import { greenwayLayout, LAMPFALL_MOUTH } from '@sg2/shared';
import { BOSS_DRAW, FALLEN_WARDEN, LENS_SHARD, WICKHOUND } from '../combat/bossModels';

const layout = lampfallLayout();
const plan = lampfallPlan(layout);
const geo = lampfallGeometry(plan);
const near = (ax: number, az: number, bx: number, bz: number, eps = 1e-6) => Math.hypot(ax - bx, az - bz) <= eps;

describe('the Lampfall plan (layout → placements)', () => {
  it('places one floor piece per room and per corridor', () => {
    expect(plan.floors.filter(f => f.kind === 'room').map(f => f.id)).toEqual(layout.rooms.map(r => r.id));
    expect(plan.floors.filter(f => f.kind === 'corridor')).toHaveLength(layout.corridors.length);
    expect(plan.floors).toHaveLength(layout.rooms.length + layout.corridors.length);
  });

  it('runs two walls along every corridor and closes every room, with no gap at the corridor mouths', () => {
    const sides = plan.walls.filter(w => w.kind === 'side');
    expect(sides).toHaveLength(layout.corridors.length * 2);
    const arcEnds = plan.walls.filter(w => w.kind === 'arc').flatMap(w => [w.pts[0], w.pts[w.pts.length - 1]]);
    // every corridor wall starts and ends exactly where a room's wall arc ends
    for (const s of sides) for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) {
      expect(arcEnds.some(q => near(p.x, p.z, q.x, q.z, 1e-6))).toBe(true);
    }
    // each room's arcs and mouths go all the way round (the rim's exit stair is its one extra notch)
    layout.rooms.forEach((r, i) => {
      const arcs = plan.walls.filter(w => w.kind === 'arc' && w.chunk === i);
      expect(arcs.length).toBeGreaterThan(0);
      for (const w of arcs) for (const p of w.pts) expect(Math.abs(Math.hypot(p.x - r.x, p.z - r.z) - r.r)).toBeLessThan(1e-6);
      const mouths = layout.corridors.filter(c => c.from === r.id || c.to === r.id).length + (i === 0 ? 1 : 0);
      expect(arcs).toHaveLength(mouths);
    });
    // walls stand on the floor: every corridor wall's foot is at the walk's floor just inside it
    for (const s of sides) for (const p of s.pts) expect(layout.walk.floor(p.x, p.z) ?? p.y).toBeCloseTo(p.y, 0);
  });

  it('cuts walls into 6–10 rough facets per 10 m', () => {
    for (const w of plan.walls) for (let k = 1; k < w.pts.length - 1; k++) {
      const d = Math.hypot(w.pts[k].x - w.pts[k - 1].x, w.pts[k].z - w.pts[k - 1].z);
      expect(d).toBeGreaterThan(0.95); expect(d).toBeLessThan(1.65);
    }
  });

  it('puts every pillar and rubble block at its layout spot, on the floor', () => {
    expect(plan.pillars.map(p => [p.x, p.z, p.r, p.h])).toEqual(layout.pillars.map(p => [p.x, p.z, p.r, p.h]));
    expect(plan.rubble.map(p => [p.x, p.z, p.r, p.top])).toEqual(layout.rubble.map(p => [p.x, p.z, p.r, p.top]));
    for (const p of plan.pillars) {
      // the drawn column rises at the spot to at least 80% of its visual height
      const b = geo.chunks[p.chunk].lit, P = b.pos;
      let top = -Infinity;
      for (let i = 0; i < P.length; i += 3) if (Math.hypot(P[i] - p.x, P[i + 2] - p.z) <= p.r * 1.15) top = Math.max(top, P[i + 1]);
      expect(top).toBeGreaterThan(p.y + 0.8 * p.h);
    }
    for (const p of plan.rubble) {
      // its flat top (up-facing, at the standing height) is drawn at the spot
      const b = geo.chunks[p.chunk].lit, P = b.pos, N = b.nor;
      let flat = 0;
      for (let i = 0; i < P.length; i += 3) if (N[i + 1] > 0.99 && Math.hypot(P[i] - p.x, P[i + 2] - p.z) <= p.r * 1.25 && Math.abs(P[i + 1] - p.top) < 0.03) flat++;
      expect(flat).toBeGreaterThanOrEqual(6);
    }
  });

  it('puts a portcullis at every gate circle, across its corridor', () => {
    const gs = lampfallGates();
    expect(plan.gates.map(g => [g.bit, g.x, g.z])).toEqual(gs.map(g => [g.bit, g.x, g.z]));
    for (const g of plan.gates) expect(g.y).toBe(layout.walk.floor(g.x, g.z));
  });

  it('draws the floor where the walk is: flags on the room floor, corridor ramps and terraces within 4 cm', () => {
    for (let c = 0; c < geo.chunks.length; c++) {
      const b = geo.chunks[c].lit, P = b.pos, N = b.nor;
      for (let i = 0; i < P.length; i += 3) {
        if (N[i + 1] < 0.999) continue; // walls, risers, fixtures
        const f = layout.walk.floor(P[i], P[i + 2]);
        if (f === null) continue;
        const dy = P[i + 1] - f;
        if (dy > 0.1) continue; // things standing on the floor (rubble tops, plinths)
        expect(dy).toBeGreaterThan(-0.04);
      }
    }
  });

  it('stays within the triangle budget on med and low (counted from the vertex data)', () => {
    const med = lampfallTriangles(geo, 'med'), low = lampfallTriangles(geo, 'low');
    expect(med).toBeLessThanOrEqual(LAMPFALL_BUDGET.med.tris);
    expect(low).toBeLessThanOrEqual(LAMPFALL_BUDGET.low.tris);
    expect(low).toBeLessThan(med);
  });
});

describe('the Lampfall world (NullEngine)', () => {
  it('builds merged meshes within the draw-call budget, drops the gates and raises the lift, and disposes all it made', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const before = { meshes: scene.meshes.length, mats: scene.materials.length };
    const w = buildLampfall(scene);
    const drawn = () => scene.meshes.filter(m => m.isEnabled() && (m as Mesh).getTotalIndices?.() > 0).length;
    w.setQuality('med');
    expect(drawn()).toBeLessThanOrEqual(LAMPFALL_BUDGET.med.draws);
    w.setQuality('low');
    expect(drawn()).toBeLessThanOrEqual(LAMPFALL_BUDGET.low.draws);
    // a shut gate is a wall to the world (prediction matches the server) and its portcullis drops
    const pit = lampfallGates().find(g => g.bit === GATE_PIT)!;
    expect(w.groundAt(pit.x, pit.z)).not.toBeNull();
    w.setGates(GATE_PIT | GATE_WICK);
    expect(w.groundAt(pit.x, pit.z)).toBeNull();
    for (let i = 0; i < 60; i++) w.update(1 / 30);
    const bars = scene.getMeshByName(`lf_gate_${GATE_PIT}`)!;
    expect(bars.position.y).toBeCloseTo(layout.walk.floor(pit.x, pit.z)!, 3);
    w.setGates(0);
    for (let i = 0; i < 200; i++) w.update(1 / 30);
    expect(bars.position.y).toBeGreaterThan(layout.walk.floor(pit.x, pit.z)! + 4);
    const lift = scene.getMeshByName('lf_lift')!;
    expect(lift.isEnabled()).toBe(false);
    w.setLift(true);
    for (let i = 0; i < 200; i++) w.update(1 / 30);
    expect(lift.isEnabled()).toBe(true);
    expect(lift.position.y).toBeCloseTo(plan.lift.y, 3);
    w.dispose();
    expect(scene.meshes.length).toBe(before.meshes);
    expect(scene.materials.length).toBe(before.mats);
    scene.dispose(); engine.dispose();
  });
});

describe("the Lampfall world with the room's live state", () => {
  it("predicts on the server's walk: a shut gate (live.gates) is a wall, and the portcullis and lift follow the state", () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    let gates = 0, lift = false;
    const w = buildLampfall(scene, { gates: () => gates, lift: () => lift });
    const g = lampfallGates().find(x => x.bit === GATE_WICK)!;
    expect(w.groundAt(g.x, g.z)).not.toBeNull();
    gates = GATE_WICK;
    expect(w.groundAt(g.x, g.z)).toBeNull();
    expect(w.surfaceAt(g.x, g.z)).toBeNull();
    lift = true;
    for (let i = 0; i < 120; i++) w.update(1 / 30);
    expect(scene.getMeshByName(`lf_gate_${GATE_WICK}`)!.position.y).toBeCloseTo(layout.walk.floor(g.x, g.z)!, 3);
    expect(scene.getMeshByName('lf_lift')!.isEnabled()).toBe(true);
    gates = 0;
    expect(w.groundAt(g.x, g.z)).not.toBeNull();
    w.dispose(); scene.dispose(); engine.dispose();
  });
});

describe('telegraph geometry and language', () => {
  const pit = layout.rooms.find(r => r.id === 'lens_pit')!;
  const world = { groundAt: (x: number, z: number) => layout.walk.groundAt(x, z), surfaceAt: (x: number, z: number) => layout.walk.surfaceAt(x, z) };

  it('draws a ring as the ring itself: every vertex between the inner and outer radius', () => {
    const s: Shape = { kind: 'ring', x: 3, z: -2, dir: 0, inner: 3.5, r: 9 };
    const g = decalGrid(s);
    for (let i = 0; i < g.xz.length; i += 2) {
      const d = Math.hypot(g.xz[i] - 3, g.xz[i + 1] + 2);
      expect(d).toBeGreaterThan(3.5 - 1e-6); expect(d).toBeLessThan(9 + 1e-6);
    }
    // the inner edge is marked (metres from it, for the white outline)
    expect(Math.min(...g.inn.filter((_, i) => i % 2 === 0))).toBeCloseTo(0, 6);
    expect(g.idx.length % 3).toBe(0);
    expect(Math.max(...g.idx)).toBeLessThan(g.xz.length / 2);
  });

  it('gives each attack its look', () => {
    const look = (id: EnemyAttackId, s: Shape) => telegraphLook(id, s);
    const circle = (r: number): Shape => ({ kind: 'circle', x: 0, z: 0, r });
    for (const id of ['ember_breath', 'focus_beam'] as const) expect(look(id, { kind: 'cone', x: 0, z: 0, dir: 0, r: 9, angle: 1 })).toMatchObject({ style: TStyle.Interrupt, glyph: TGlyph.Bang });
    expect(look('brass_fall', circle(3))).toMatchObject({ style: TStyle.Each, glyph: TGlyph.Gear, arena: false });
    expect(look('keepers_toll', circle(40))).toMatchObject({ style: TStyle.Interrupt, arena: true, unavoidable: true });
    expect(look('last_light', circle(40))).toMatchObject({ style: TStyle.Base, arena: true, unavoidable: true });
    expect(look('cinder_ring', { kind: 'ring', x: 0, z: 0, dir: 0, inner: 3.5, r: 9 })).toMatchObject({ ring: true, unavoidable: false });
    expect(look('lamp_sweep', { kind: 'cone', x: 0, z: 0, dir: 0, r: 12, angle: 1.7 })).toMatchObject({ style: TStyle.Base, glyph: TGlyph.None, arena: false });
    // the flags come from the shared attack data, never a copy
    expect(ENEMY_ATTACKS.keepers_toll.unavoidable && ENEMY_ATTACKS.keepers_toll.interruptible).toBe(true);
    expect((ENEMY_ATTACKS.keepers_toll.r ?? 0) >= ARENA_TELEGRAPH_R).toBe(true);
  });

  it('stops a whole-arena telegraph at the Lens Pit walls', () => {
    // straight back from the entry corridor: the far wall, 22 m
    expect(floorReach(world, pit.x, pit.z, Math.PI / 2, 40)).toBeGreaterThan(21);
    expect(floorReach(world, pit.x, pit.z, Math.PI / 2, 40)).toBeLessThanOrEqual(22);
    const g = decalGrid({ kind: 'circle', x: pit.x, z: pit.z, r: 40 }, (a) => floorReach(world, pit.x, pit.z, a, 40));
    for (let i = 0; i < g.xz.length; i += 2) expect(Math.hypot(g.xz[i] - pit.x, g.xz[i + 1] - pit.z)).toBeLessThan(25);
  });

  it('draws a fire-ring field on the floor outside its safe middle only', () => {
    const s: Shape = { kind: 'ring', x: pit.x, z: pit.z, dir: 0, inner: 15, r: 40 };
    const g = fieldGrid(s, (a) => floorReach(world, pit.x, pit.z, a, 40));
    for (let i = 0; i < g.xz.length; i += 2) {
      const x = g.xz[i], z = g.xz[i + 1];
      expect(inShape(s, x, z) || Math.abs(Math.hypot(x - pit.x, z - pit.z) - 15) < 1e-6).toBe(true);
      expect(Math.hypot(x - pit.x, z - pit.z)).toBeLessThan(25);
    }
  });
});

describe('boss models', () => {
  const tris = (k: KindDef) => { const m = new Model(77); k.build(m); return m.b.tris + m.g.tris; };
  it('stay within their triangle budgets', () => {
    expect(tris(FALLEN_WARDEN)).toBeLessThanOrEqual(3000);
    expect(tris(WICKHOUND)).toBeLessThanOrEqual(2000);
    expect(tris(LENS_SHARD)).toBeLessThanOrEqual(300);
  });
  it('are about the size the brief asks (the Warden 4.5 m, the Wickhound 2.2 m at the shoulder)', () => {
    const top = (k: KindDef) => { const m = new Model(5); k.build(m); let y = 0; for (let i = 1; i < m.b.pos.length; i += 3) y = Math.max(y, m.b.pos[i]); return y; };
    expect(top(FALLEN_WARDEN)).toBeGreaterThan(4.3); expect(top(FALLEN_WARDEN)).toBeLessThan(5.2);
    const m = new Model(5); WICKHOUND.build(m);
    let shoulder = 0; const P = m.b.pos, idx = m.bIdx, chest = m.index('chest');
    for (let i = 0; i < idx.length; i++) if (idx[i] === chest) shoulder = Math.max(shoulder, P[i * 3 + 1]);
    shoulder *= BOSS_DRAW.wickhound ?? 1;
    expect(shoulder).toBeGreaterThan(2.0); expect(shoulder).toBeLessThan(2.45);
  });
});

describe('the crater mouth', () => {
  it('stays within its budget, and its opening lies inside the exit circle across the road', () => {
    const g = mouthGeometry(greenwayLayout());
    expect(g.lit.tris + g.glow.tris + g.scorch.tris + g.mask.tris).toBeLessThanOrEqual(MOUTH_BUDGET.tris);
    // across the road the opening is narrower than the exit circle: walking onto it from the side travels at once
    expect(MOUTH_PIT.across).toBeLessThan(LAMPFALL_MOUTH.r);
    expect(Math.hypot(g.plan.x - LAMPFALL_MOUTH.x, g.plan.z - LAMPFALL_MOUTH.z)).toBeLessThan(1e-9);
  });
});
