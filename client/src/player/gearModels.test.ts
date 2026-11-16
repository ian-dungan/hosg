// Gear on the model: every item and costume piece model maps to a builder of its slot; the named weapons and the T3
// sets glow and nothing below T3 does (an emissive mesh is a second draw call); the plan keeps the job's cues where no
// piece covers them; v1 and v2 gear codes draw the same; budgets per quality (full T3 against the bare body: mean and
// worst, one skinned mesh plus at most one emissive mesh); the fitted-piece cache stays bounded; weapons scale with
// the wearer. Headless: NullEngine and the standalone builds.
import { beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene, type Mesh } from '@babylonjs/core';
import {
  COSTUME_PIECES, COSTUME_PIECE_IDS, ITEMS, ITEM_IDS, JOBS, JOB_IDS, LOOK_PRESETS, PEOPLE_IDS, PEOPLES, decodeGearLookV2, encodeGearLook, parseLook, prng, randomLook, resolveGearLook,
  type GearLookV2, type JobId, type Look, type PeopleId,
} from '@sg2/shared';
import { characterStats, capeFor, makeCharacter, setCharacterDetail, setGearBuilder, weaponScale } from './character';
import { GEAR_CACHE_SIZE, asV2, buildPiece, clearGearCache, fitGear, fitInputOf, gearCacheStats, gearHooks, kitGear, mixGear, modelInfo } from './gearModels';
import { bodyFrame } from './look';
import { staffTint } from '../combat/spells';

let scene: Scene;
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 64, height: 64 } : () => ({ addColorStop() {} })) });
  (globalThis as Record<string, unknown>).document ??= { createElement: () => ({ width: 64, height: 64, getContext: () => ctx, style: {} }) };
  scene = new Scene(new NullEngine());
  setGearBuilder(gearHooks);
});

const lookOf = (p: PeopleId, v: number, seed = 3): Look => {
  const l = randomLook(prng(seed));
  const fur = PEOPLES[p].furred ? l.fur ?? { pattern: 1, colour: 0x3a2a20, tail: 1, muzzle: 3 } : null;
  return parseLook({ ...l, people: p, fur, ears: { ...l.ears, style: Math.min(l.ears.style, PEOPLES[p].earsMax) },
    build: { height: v, shoulders: v, chest: v, waist: v, hips: v, arms: v, legs: v, muscle: v, weight: v, neck: v, head: v } })!;
};

describe('model ids', () => {
  it('maps every ITEMS model and every costume piece to a builder of its slot', () => {
    for (const id of ITEM_IDS) {
      const it2 = ITEMS[id]!, info = modelInfo(it2.model);
      expect(info?.slot, id).toBe(it2.slot);
      expect(info!.tier, id).toBe(it2.tier);
      expect(info!.named, id).toBe(!!it2.named);
      expect(buildPiece(it2.model, [0, 0, 0], 'low'), id).not.toBeNull();
    }
    for (const id of COSTUME_PIECE_IDS) {
      const p = COSTUME_PIECES[id]!, info = modelInfo(p.model);
      expect(info?.kind === 'costume' && info.costume, id).toBe(p.costume);
      expect(info!.slot, id).toBe(p.slot);
    }
    expect(modelInfo(0)).toBeNull();
    expect(modelInfo(199)).toBeNull();
    expect(modelInfo(255)).toBeNull();
  });

  it('lights the named weapons and the T3 lens, wind and beacon pieces and the two event costumes; nothing below T3', () => {
    const glows = (model: number) => buildPiece(model, [0, 0, 0], 'med')!.glowTriangles > 0;
    for (const id of ITEM_IDS) {
      const it2 = ITEMS[id]!;
      if (it2.named) expect(glows(it2.model), id).toBe(true);
      if (it2.tier < 3) expect(glows(it2.model), id).toBe(false);
    }
    expect(glows(ITEMS.lenslight_chest!.model)).toBe(true);
    expect(glows(ITEMS.beaconstone_head!.model)).toBe(true);
    expect(glows(COSTUME_PIECES.beacon_halo_head!.model)).toBe(true);
    expect(glows(COSTUME_PIECES.starfall_regalia_chest!.model)).toBe(true);
  });
});

describe('the plan', () => {
  it('keeps the job\'s cues under the starter kit, its accents over set pieces, none under a costume or a hidden head', () => {
    const look = lookOf('human', 10);
    for (const job of JOB_IDS) for (const tier of [0, 1, 2, 3] as const) {
      const p = gearHooks.plan(kitGear(tier, job), look);
      expect(p.headCue, `${job} T${tier}`).toBe(tier === 0);
      expect(p.shoulderCue, `${job} T${tier}`).toBe(tier === 0);
      expect(p.headAccent && p.shoulderAccent, `${job} T${tier}`).toBe(tier > 0);
      expect(p.replaces.length).toBeGreaterThan(0);
      expect(p.body?.noTabard, 'a chest piece brings its own tabard').toBe(true);
    }
    const coat = mixGear('paladin', 3, { chest: COSTUME_PIECES.lamplighter_coat_chest!.model });
    expect(gearHooks.plan(coat, look).shoulderAccent).toBe(false);
    const bare = kitGear(3, 'paladin');
    bare.head = null; bare.hidden.head = true;
    const bp = gearHooks.plan(bare, look);
    expect(bp.headCue).toBe(false);
    expect(bp.hair).toBe(true);
  });

  it('draws a v1 code as its v2 look (dyes [a, b, 0]) and costume pieces in any slot', () => {
    const v1 = resolveGearLook({ chest: { model: ITEMS.tollwind_chest!.model, dye: [3, 4] } }, {}, false);
    const v2 = decodeGearLookV2(encodeGearLook(v1))!;
    expect(v2.chest).toEqual({ model: ITEMS.tollwind_chest!.model, dye: [3, 4, 0] });
    expect(gearHooks.plan(asV2(v1), lookOf('human', 10))).toEqual(gearHooks.plan(v2, lookOf('human', 10)));
    const g = mixGear('ranger', 1, { legs: COSTUME_PIECES.orchard_smock_legs!.model, hands: COSTUME_PIECES.starfall_regalia_hands!.model });
    expect(gearHooks.pieces(g).map((p) => p.model)).toContain(COSTUME_PIECES.orchard_smock_legs!.model);
  });
});

describe('budgets', () => {
  const build = (look: Look, job: JobId, gear: GearLookV2 | null) => {
    const v = makeCharacter(scene, { kind: 'player', look, gear });
    v.setWeapon(JOBS[job].weapon, staffTint(job));
    v.setCape(capeFor(job));
    v.setPose('attack');
    const tris = characterStats.lastActiveTriangles;
    const meshes = (v.root.getChildMeshes(false) as Mesh[]).filter((m) => m.isEnabled() && m.getTotalVertices() > 0 && !m.name.startsWith('blob_') && !m.name.startsWith('pick_'));
    v.dispose();
    return { tris, meshes: meshes.map((m) => m.name.split('_')[0]) };
  };
  /** 16 random looks and the 7 jobs: full T3 against the same look with no gear. */
  const measure = (q: 'low' | 'med' | 'high') => {
    setCharacterDetail(q);
    let bare = 0, t3 = 0, worst = 0, n = 0, worstT3 = 0;
    try {
      for (let i = 0; i < 16; i++) {
        const look = randomLook(prng(100 + i)), job = JOB_IDS[i % JOB_IDS.length]!;
        const b = build(look, job, null), g = build(look, job, kitGear(3, job));
        expect(g.meshes.filter((m) => m === 'body').length).toBe(1);
        expect(g.meshes.length).toBeLessThanOrEqual(2);
        bare += b.tris; t3 += g.tris; n++;
        worst = Math.max(worst, g.tris / b.tris); worstT3 = Math.max(worstT3, g.tris);
      }
    } finally { setCharacterDetail('high'); }
    return { bare: bare / n, t3: t3 / n, ratio: t3 / bare, worst, worstT3 };
  };
  it('keeps full T3 near the bare body at every quality (one skinned mesh, at most one emissive)', () => {
    const r = { low: measure('low'), med: measure('med'), high: measure('high') };
    // eslint-disable-next-line no-console
    console.log(Object.entries(r).map(([q, v]) => `${q}: bare ${v.bare.toFixed(0)}, T3 ${v.t3.toFixed(0)} (×${v.ratio.toFixed(2)} mean, ×${v.worst.toFixed(2)} worst, ${v.worstT3} max)`).join(' · '));
    expect(r.med.ratio).toBeLessThanOrEqual(1.22);
    expect(r.med.worst).toBeLessThanOrEqual(1.4);
    expect(r.low.ratio).toBeLessThanOrEqual(1.3);
    expect(r.high.ratio).toBeLessThanOrEqual(1.3);
  });
  it('builds T2 kits without an emissive mesh, and the starter kit as one mesh', () => {
    const look = lookOf('human', 10, 5);
    for (const job of JOB_IDS) {
      expect(build(look, job, kitGear(2, job)).meshes, job).toEqual(['body']);
      expect(build(look, job, kitGear(0, job)).meshes, job).toEqual(['body']);
    }
  });
});

describe('the fitted-piece cache', () => {
  it('builds a piece once per body and stays bounded over a crowd of different bodies', () => {
    clearGearCache();
    const g = kitGear(3, 'paladin');
    const look = lookOf('human', 10);
    const inp = fitInputOf(look, 'med');
    fitGear(inp, g);
    const builds = gearCacheStats.builds;
    fitGear(inp, g);
    expect(gearCacheStats.builds).toBe(builds);                  // the same body and gear: all from the cache
    const dyed = kitGear(3, 'paladin', [4, 0, 0]);
    fitGear(inp, dyed);
    expect(gearCacheStats.builds).toBeGreaterThan(builds);        // a dye change refits only what changed
    for (let i = 0; i < 80; i++) fitGear(fitInputOf(randomLook(prng(500 + i)), 'med'), kitGear((i % 4) as 0, JOB_IDS[i % 7]!));
    expect(gearCacheStats.size).toBeLessThanOrEqual(GEAR_CACHE_SIZE);
  });
});

describe('weapons scale with the wearer', () => {
  it('a Knollfolk carries a smaller greatsword than a Larchfolk, in proportion to its height', () => {
    const small = LOOK_PRESETS.find((p) => p.look.people === 'knollfolk')!.look, large = LOOK_PRESETS.find((p) => p.look.people === 'larchfolk')!.look;
    const fs = bodyFrame(small), fl = bodyFrame(large);
    const ks = weaponScale(fs), kl = weaponScale(fl);
    expect(ks).toBeLessThan(kl);
    expect(ks / kl).toBeGreaterThan((fs.H / fl.H) * 0.9);
    expect(ks / kl).toBeLessThan((fs.H / fl.H) * 1.2);
    const len = (look: Look) => { const b = buildPiece(ITEMS.grief_of_brass!.model, [0, 0, 0], 'med', look)!; let lo = Infinity, hi = -Infinity; for (let i = 1; i < b.positions.length; i += 3) { lo = Math.min(lo, b.positions[i]!); hi = Math.max(hi, b.positions[i]!); } return hi - lo; };
    expect(len(small) / len(large)).toBeCloseTo(ks / kl, 1);
    void PEOPLE_IDS;
  });
});
