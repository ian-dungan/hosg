// The auto-fitting gear (gearFit.ts, gearDefs.ts): for a grid of bodies (male and female, the four peoples, every
// body slider at its extremes and two mixed extremes) × every armour and costume look, each piece's vertices stay
// outside the body it covers by a margin (no clipping) and, for shells that hug it, within a reach (no floating);
// every look id in shared data has its own, distinct definition; mixing pieces of any two sets leaves no uncovered
// band of the body; the hit radius holds; dyes work per channel. Headless (no scene): bareBody + the fitter.
import { describe, expect, it } from 'vitest';
import {
  ADVENTURER_RADIUS, ARMOUR_SLOTS, COSTUME_PIECES, COSTUME_PIECE_IDS, DYES, ITEMS, ITEM_IDS, LOOK_PRESETS, PEOPLE_IDS, PEOPLES, SET_IDS, parseLook, upgradeGearLook, resolveGearLook,
  type ArmourSlot, type GearLookV2, type Look, type PeopleId,
} from '@sg2/shared';
import { DETAIL, bareBody } from './character';
import { DEFS, buildPiece, defFor, dyeColour, fitGear, fitInputOf, gearHooks, modelInfo } from './gearModels';
import { defSignature, HEAD_COVER } from './gearDefs';
import type { FitMeta } from './gearFit';

// ───────── the bodies ─────────
type B = Look['build'];
const all = (v: number): B => ({ height: v, shoulders: v, chest: v, waist: v, hips: v, arms: v, legs: v, muscle: v, weight: v, neck: v, head: v });
const VARIANTS: Record<string, B> = {
  low: all(0), high: all(20),
  tallThin: { ...all(0), height: 20, arms: 20, legs: 20, neck: 20 },
  shortHeavy: { ...all(20), height: 0, arms: 0, legs: 0, neck: 0 },
};
const lookOf = (p: PeopleId, body: 'male' | 'female', b: B): Look => {
  const base = LOOK_PRESETS.find((x) => x.look.people === p && x.look.body === body)!.look;
  return parseLook({ ...base, build: b, ears: { ...base.ears, style: Math.min(base.ears.style, PEOPLES[p].earsMax) } })!;
};
const BODIES: { name: string; look: Look }[] = [];
for (const p of PEOPLE_IDS) for (const body of ['male', 'female'] as const) for (const v of ['low', 'high'] as const) BODIES.push({ name: `${p} ${body} ${v}`, look: lookOf(p, body, VARIANTS[v]!) });
for (const body of ['male', 'female'] as const) for (const v of ['tallThin', 'shortHeavy'] as const) BODIES.push({ name: `human ${body} ${v}`, look: lookOf('human', body, VARIANTS[v]!) });

/** Every armour and costume look id in shared data, with its slot. */
const ARMOUR_LOOKS: { id: number; slot: ArmourSlot; name: string }[] = [
  ...ITEM_IDS.filter((i) => (ARMOUR_SLOTS as readonly string[]).includes(ITEMS[i]!.slot)).map((i) => ({ id: ITEMS[i]!.model, slot: ITEMS[i]!.slot as ArmourSlot, name: i })),
  ...COSTUME_PIECE_IDS.map((i) => ({ id: COSTUME_PIECES[i]!.model, slot: COSTUME_PIECES[i]!.slot, name: i })),
];

// ───────── sections of the body's mesh ─────────
type Seg = [number, number, number, number];
/** The body mesh's section at height y through the triangles of `groups` (segments in xz). */
function sectionOf(body: ReturnType<typeof bareBody>, groups: ReadonlySet<string>, y: number): Seg[] {
  const { positions: P, indices: I, groups: G } = body, out: Seg[] = [];
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!;
    if (!groups.has(G[a]!)) continue;
    const pts: [number, number][] = [];
    for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
      const yu = P[u * 3 + 1]!, yv = P[v * 3 + 1]!;
      if ((yu - y) * (yv - y) < 0 || (yu === y && yv !== y)) {
        const s = (y - yu) / (yv - yu);
        pts.push([P[u * 3]! + (P[v * 3]! - P[u * 3]!) * s, P[u * 3 + 2]! + (P[v * 3 + 2]! - P[u * 3 + 2]!) * s]);
      }
    }
    if (pts.length >= 2) out.push([pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]]);
  }
  return out;
}
/** Signed distance of (x, z) from a section (negative inside: even-odd crossings), or null with no section there. */
function signedDist(segs: Seg[], x: number, z: number): number | null {
  if (!segs.length) return null;
  let inside = false, d = Infinity;
  for (const [x0, z0, x1, z1] of segs) {
    if ((z0 > z) !== (z1 > z) && x < x0 + ((z - z0) / (z1 - z0)) * (x1 - x0)) inside = !inside;
    const dx = x1 - x0, dz = z1 - z0, L = dx * dx + dz * dz, t = L > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L)) : 0;
    d = Math.min(d, Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)));
  }
  return inside ? -d : d;
}
/** The 3D distance to the nearest body vertex of `groups`. */
function nearest(body: ReturnType<typeof bareBody>, groups: ReadonlySet<string>, x: number, y: number, z: number): number {
  const P = body.positions;
  let d = Infinity;
  for (let i = 0; i < body.groups.length; i++) if (groups.has(body.groups[i]!)) d = Math.min(d, Math.hypot(P[i * 3]! - x, P[i * 3 + 1]! - y, P[i * 3 + 2]! - z));
  return d;
}
const GROUPS: Record<FitMeta['region'], (x: number) => string[]> = {
  torso: () => ['body'], neck: () => ['neck'], head: () => ['head', 'eyes'],
  arm: (x) => [x < 0 ? 'armL' : 'armR'], hand: (x) => [x < 0 ? 'armL' : 'armR'],
  leg: (x) => [x < 0 ? 'legL' : 'legR'], foot: (x) => [x < 0 ? 'legL' : 'legR'],
  cape: () => ['body', 'legL', 'legR'],
};

describe('every look id has its own piece', () => {
  it('maps every armour and costume look in shared data to a distinct definition of its slot', () => {
    const sigs = new Map<string, number>();
    for (const l of ARMOUR_LOOKS) {
      const d = defFor(l.slot, l.id);
      expect(d, `${l.name} (${l.id})`).not.toBeNull();
      const s = defSignature(d!);
      expect(sigs.get(s), `${l.name} shares its definition with look ${sigs.get(s)}`).toBeUndefined();
      sigs.set(s, l.id);
      expect(modelInfo(l.id)?.slot, l.name).toBe(l.slot);
    }
    expect(DEFS.size).toBe(ARMOUR_LOOKS.length);
    // weapons and off-hands: their own models (weaponModels.ts)
    for (const id of ITEM_IDS) { const it2 = ITEMS[id]!; if (it2.slot === 'weapon' || it2.slot === 'offhand') expect(modelInfo(it2.model)?.slot, id).toBe(it2.slot); }
  });
  it('builds every look into distinct geometry (not a generic look)', () => {
    for (const slot of ARMOUR_SLOTS) {
      const seen = new Map<string, string>();
      for (const l of ARMOUR_LOOKS.filter((x) => x.slot === slot)) {
        const b = buildPiece(l.id, [0, 0, 0], 'high')!;
        expect(b.triangles + b.glowTriangles, l.name).toBeGreaterThan(0);
        let h = 0;
        for (let i = 0; i < b.positions.length; i++) h = (h * 31 + Math.round(b.positions[i]! * 1000) + Math.round((b.colours[i] ?? 0) * 255)) | 0;
        const key = `${b.triangles}:${h}`;
        expect(seen.get(key), `${l.name} looks like ${seen.get(key)}`).toBeUndefined();
        seen.set(key, l.name);
      }
    }
  });
});

describe('the fit (no clipping, no floating)', () => {
  const MIN = 0.001, TIGHT = 0.08, LOOSE = 0.17;
  it(`keeps every piece outside the body by ${MIN * 1000} mm and hugging shells within ${TIGHT * 100} cm, on ${BODIES.length} bodies`, () => {
    const worst: string[] = [];
    const agg = new Map<string, { mm: number; n: number; at: string }>();
    let checked = 0;
    for (const b of BODIES) {
      const inp = fitInputOf(b.look, 'med');
      const kk = inp.frame.H / 1.75;
      const bodies = new Map<string, ReturnType<typeof bareBody>>();
      for (const l of ARMOUR_LOOKS) {
        const d = defFor(l.slot, l.id)!;
        const hc = l.slot === 'head' ? HEAD_COVER[d.tpl]! : null;
        const g = upgradeGearLook(resolveGearLook({}, {}, false));
        g[l.slot] = { model: l.id, dye: [0, 0, 0] };
        g.hidden.back = l.slot !== 'back';  // (alone: no job cape over it)
        const plan = gearHooks.plan(g, b.look);
        const mode = hc ? `${hc.hair}${hc.ears}` : 'full';
        let body = bodies.get(mode);
        if (!body) { body = bareBody(b.look, DETAIL.med, plan.body, hc ? { hair: hc.hair, ears: hc.ears } : undefined); bodies.set(mode, body); }
        const r = fitGear({ ...inp, bootTop: inp.bootTop }, g);
        const fp = l.slot === 'head' ? r.head(body.env) : r.pieces.find((p) => p.chunk.g.pos.length > 0) ?? null;
        expect(fp, `${l.name} on ${b.name}`).not.toBeNull();
        const pos = fp!.chunk.g.pos;
        const drawn = new Set(fp!.chunk.g.idx);   // (vertices no triangle uses, as in a hole's skipped quads, are not drawn)
        const cache = new Map<string, Seg[]>();
        for (const m of fp!.meta) {
          if (m.region === 'hand' || m.region === 'foot') continue;   // (gloves and boots replace the hand and foot: nothing under them)
          for (let v = m.from; v < m.to; v++) {
            if (!drawn.has(v)) continue;
            const x = pos[v * 3]!, y = pos[v * 3 + 1]!, z = pos[v * 3 + 2]!;
            const groups = m.cls === 'free' && m.region === 'torso' ? ['body', 'legL', 'legR'] : GROUPS[m.region](m.side ?? x);
            const key = `${groups.join()}|${y.toFixed(4)}`;
            let segs = cache.get(key);
            if (!segs) { segs = sectionOf(body, new Set(groups), y); cache.set(key, segs); }
            let sd = signedDist(segs, x, z);
            if (sd === null) continue;
            // (how far off: the nearer of the section's and the nearest body vertex in 3D — near a crown or a sole
            // a level section reads far while the surface is just under)
            if (sd > 0 && m.cls !== 'orn') sd = Math.min(sd, nearest(body, new Set(groups), x, y, z));
            checked++;
            const lo = m.cls === 'orn' ? -0.001 : MIN * kk;
            const hi = m.cls === 'tight' ? TIGHT * kk : m.cls === 'loose' ? LOOSE * kk : Infinity;
            if (sd < lo || sd > hi) {
              const k = `${l.name} ${m.cls} ${m.region} ${sd < lo ? 'in' : 'off'}`, w = agg.get(k);
              const e = sd < lo ? (sd - lo) * 1000 : (sd - hi) * 1000;
              if (!w || Math.abs(e) > Math.abs(w.mm)) agg.set(k, { mm: e, n: (w?.n ?? 0) + 1, at: `${b.name} y ${y.toFixed(2)}` }); else w.n++;
              worst.push(k);
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`fit: ${checked} vertices checked, ${worst.length} out of bounds`);
    const rep = [...agg.entries()].sort((a, b) => Math.abs(b[1].mm) - Math.abs(a[1].mm)).map(([k, v]) => `${k}: ${v.n} vertices, worst ${v.mm.toFixed(1)} mm past (${v.at})`);
    // eslint-disable-next-line no-console
    console.log(rep.join('\n'));
    expect(rep).toEqual([]);
  }, 600_000);
});

describe('mixing sets', () => {
  /** Rays out of the body's covered bands (every band a piece leaves out) must meet a piece: no hole. */
  it('leaves no uncovered band of the body for any two sets mixed (chest × legs, legs × feet, chest × hands)', () => {
    const look = lookOf('human', 'female', all(10));
    const inp = fitInputOf(look, 'med');
    const pairs: [ArmourSlot, ArmourSlot][] = [['chest', 'legs'], ['legs', 'feet'], ['chest', 'hands']];
    const holes: string[] = [];
    for (const [s1, s2] of pairs) for (const a of SET_IDS) for (const b of SET_IDS) {
      if (a === b) continue;
      const g = upgradeGearLook(resolveGearLook({}, {}, false));
      g[s1] = { model: ITEMS[`${a}_${s1}`]!.model, dye: [0, 0, 0] };
      g[s2] = { model: ITEMS[`${b}_${s2}`]!.model, dye: [0, 0, 0] };
      g.hidden.back = true;
      const r = fitGear(inp, g);
      const plan = gearHooks.plan(g, look);
      const full = bareBody(look, DETAIL.med, plan.body);
      const shown = bareBody(look, DETAIL.med, plan.body, r.cover);
      // a covered band: where the full body has triangles the shown one does not; cast from those triangles' centres
      const key = (P: Float32Array, I: Uint32Array, t: number) => `${P[I[t]! * 3]!.toFixed(4)},${P[I[t]! * 3 + 1]!.toFixed(4)},${P[I[t + 1]! * 3]!.toFixed(4)}`;
      const kept = new Set<string>();
      for (let t = 0; t < shown.indices.length; t += 3) kept.add(key(shown.positions, shown.indices, t));
      const tris: number[][] = [];
      for (const p of r.pieces) { const G = p.chunk.g; for (let t = 0; t < G.idx.length; t += 3) tris.push([G.idx[t]!, G.idx[t + 1]!, G.idx[t + 2]!].flatMap((i) => [G.pos[i * 3]!, G.pos[i * 3 + 1]!, G.pos[i * 3 + 2]!])); }
      const P = full.positions, I = full.indices;
      let misses = 0, cast = 0;
      for (let t = 0; t < I.length; t += 3 * 3) {
        if (kept.has(key(P, I, t))) continue;
        const g0 = full.groups[I[t]!]!;
        if (!['body', 'armL', 'armR', 'legL', 'legR'].includes(g0)) continue;
        const c = [0, 1, 2].map((k) => (P[I[t]! * 3 + k]! + P[I[t + 1]! * 3 + k]! + P[I[t + 2]! * 3 + k]!) / 3);
        // outward: away from the part's own axis, in the horizontal plane
        const ax = g0 === 'body' ? 0 : (g0.endsWith('L') ? -1 : 1) * (g0.startsWith('arm') ? inp.frame.shX : inp.frame.legX * 0.8);
        let dx = c[0]! - ax, dz = c[2]!;
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        cast++;
        if (!tris.some((T) => rayHits(c as [number, number, number], [dx, 0, dz], T))) misses++;
      }
      if (misses > Math.max(1, cast * 0.02)) holes.push(`${s1} ${a} × ${s2} ${b}: ${misses}/${cast} rays out of covered bands meet no piece`);
    }
    expect(holes).toEqual([]);
  }, 600_000);
});

/** Möller–Trumbore, two-sided, within 0.25 m. */
function rayHits(o: [number, number, number], d: [number, number, number], T: number[]): boolean {
  const e1 = [T[3]! - T[0]!, T[4]! - T[1]!, T[5]! - T[2]!], e2 = [T[6]! - T[0]!, T[7]! - T[1]!, T[8]! - T[2]!];
  const p = [d[1] * e2[2]! - d[2] * e2[1]!, d[2] * e2[0]! - d[0] * e2[2]!, d[0] * e2[1]! - d[1] * e2[0]!];
  const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det, tv = [o[0] - T[0]!, o[1] - T[1]!, o[2] - T[2]!];
  const u = (tv[0]! * p[0]! + tv[1]! * p[1]! + tv[2]! * p[2]!) * inv;
  if (u < 0 || u > 1) return false;
  const q = [tv[1]! * e1[2]! - tv[2]! * e1[1]!, tv[2]! * e1[0]! - tv[0]! * e1[2]!, tv[0]! * e1[1]! - tv[1]! * e1[0]!];
  const v = (d[0] * q[0]! + d[1] * q[1]! + d[2] * q[2]!) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) * inv;
  return t > -0.002 && t < 0.25;
}

describe('the hit radius', () => {
  it('keeps every piece inside ADVENTURER_RADIUS (|x|) on the widest bodies', () => {
    for (const p of PEOPLE_IDS) for (const body of ['male', 'female'] as const) {
      const look = lookOf(p, body, { ...all(20), legs: 0 });
      for (const l of ARMOUR_LOOKS) {
        const b = buildPiece(l.id, [0, 0, 0], 'low', look)!;
        let r = 0;
        for (const arr of [b.positions, b.glowPositions]) for (let i = 0; i < arr.length; i += 3) r = Math.max(r, Math.abs(arr[i]!));
        expect(r, `${l.name} ${p} ${body}`).toBeLessThanOrEqual(ADVENTURER_RADIUS);
      }
    }
  });
});

describe('dyes', () => {
  it('Undyed is the piece\'s own colours (never black); each of the three channels recolours only its own parts', () => {
    expect(DYES[0]!.hex).toBe('#000000');
    const bad: string[] = [];
    for (const l of ARMOUR_LOOKS) {
      const d = defFor(l.slot, l.id)!;
      expect(dyeColour(0, d.pal[0])).toBe(d.pal[0]);
      const base = buildPiece(l.id, [0, 0, 0], 'low')!.colours;
      const changed = (dy: [number, number, number]) => {
        const c = buildPiece(l.id, dy, 'low')!.colours, out = new Set<number>();
        for (let i = 0; i < c.length; i += 4) if (Math.abs(c[i]! - base[i]!) + Math.abs(c[i + 1]! - base[i + 1]!) + Math.abs(c[i + 2]! - base[i + 2]!) > 1e-6) out.add(i / 4);
        return out;
      };
      const a = changed([2, 0, 0]), b = changed([0, 14, 0]), c = changed([0, 0, 27]);
      // the primary always shows, and at least one of the other two channels
      if (!a.size) bad.push(`${l.name}: no primary`);
      if (!b.size && !c.size) bad.push(`${l.name}: neither secondary nor trim`);
      for (const i of a) if (b.has(i) || c.has(i)) { bad.push(`${l.name}: vertex ${i} in two channels`); break; }
    }
    expect(bad).toEqual([]);
  });
});
