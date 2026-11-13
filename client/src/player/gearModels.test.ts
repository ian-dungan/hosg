// Gear on the model (Plan 5 Task 9): every item and costume model has a builder that builds for every people at the
// slider extremes, dyes touch only their own channel (and Undyed is the piece's own colours, never black), costumes
// hide what they cover, silhouettes stay inside the hit radius, and the budgets hold (triangles per quality, one
// skinned mesh plus at most one emissive mesh). Headless: NullEngine and the standalone piece kit.
import { beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene, type Mesh } from '@babylonjs/core';
import {
  ADVENTURER_RADIUS, COSTUMES, COSTUME_IDS, DYES, ITEMS, ITEM_IDS, JOBS, JOB_IDS, PEOPLE_IDS, PEOPLES, SETS, SET_IDS,
  decodeGearLook, encodeGearLook, parseLook, prng, randomLook, resolveGearLook,
  type GearLook, type JobId, type Look, type PeopleId,
} from '@sg2/shared';
import { characterStats, capeFor, makeCharacter, setCharacterDetail, setGearBuilder } from './character';
import { buildPiece, dyeColour, gearHooks, gearTriangles, kitGear, modelInfo, setGear, OWN } from './gearModels';
import { staffTint } from '../combat/spells';

let scene: Scene;
beforeAll(() => {
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 64, height: 64 } : () => ({ addColorStop() {} })) });
  (globalThis as Record<string, unknown>).document ??= { createElement: () => ({ width: 64, height: 64, getContext: () => ctx, style: {} }) };
  scene = new Scene(new NullEngine());
  setGearBuilder(gearHooks);
});

/** A look of a people with every body slider at `v`. */
const lookOf = (p: PeopleId, v: number, seed = 3): Look => {
  const l = randomLook(prng(seed));
  const fur = PEOPLES[p].furred ? l.fur ?? { pattern: 1, colour: 0x3a2a20, tail: 1 } : null;
  return parseLook({ ...l, people: p, fur, face: { ...l.face, ears: Math.min(l.face.ears, PEOPLES[p].earsMax) },
    body: { height: v, build: v, shoulders: v, hips: v, legs: v, head: v } })!;
};
const MODELS = [...ITEM_IDS.map((id) => ({ name: id, model: ITEMS[id]!.model, slot: ITEMS[id]!.slot as string })),
  ...COSTUME_IDS.map((id) => ({ name: id, model: COSTUMES[id].model, slot: 'costume' }))];

describe('item and costume models', () => {
  it('every ITEMS and COSTUMES model maps to a builder of the right slot', () => {
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!, info = modelInfo(it.model);
      expect(info, id).not.toBeNull();
      expect(info!.slot, id).toBe(it.slot);
      if (it.set) expect(info!.kind === 'armour' && info!.set, id).toBe(it.set);
      if (it.weapon) expect(info!.kind === 'weapon' && info!.weapon, id).toBe(it.weapon);
      if (it.offhand) expect(info!.kind === 'offhand' && info!.offhand, id).toBe(it.offhand);
      expect(info!.tier, id).toBe(it.tier);
      expect(info!.named, id).toBe(!!it.named);
    }
    for (const id of COSTUME_IDS) {
      const info = modelInfo(COSTUMES[id].model);
      expect(info?.kind === 'costume' && info.costume, id).toBe(id);
    }
    expect(modelInfo(0)).toBeNull();
    expect(modelInfo(199)).toBeNull();
    expect(modelInfo(255)).toBeNull();
  });

  it('every model builds for all four peoples at sliders 0 and 20 with no NaN vertex', () => {
    for (const p of PEOPLE_IDS) for (const v of [0, 20]) {
      const look = lookOf(p, v);
      for (const m of MODELS) {
        const b = buildPiece(m.model, [0, 0], 'med', look);
        expect(b, m.name).not.toBeNull();
        for (const arr of [b!.positions, b!.glowPositions]) for (const x of arr) if (!Number.isFinite(x)) throw new Error(`${m.name} ${p} ${v}: NaN`);
        // every non-starter model has geometry of its own (the plain set is the body's own clothes)
        const plain = m.slot !== 'costume' && (ITEMS[m.name]!.set === 'plain');
        if (!plain) expect(b!.triangles + b!.glowTriangles, m.name).toBeGreaterThan(0);
      }
    }
  });

  it('the seven named weapons, the T3 lens and beacon sets and the two event costumes glow; nothing below T3 does', () => {
    const glows = (model: number) => buildPiece(model, [0, 0], 'med', null)!.glowTriangles > 0;
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      if (it.named) expect(glows(it.model), id).toBe(true);
      if (it.tier < 3) expect(glows(it.model), id).toBe(false);
    }
    expect(glows(ITEMS['lenslight_back']!.model) || glows(ITEMS['lenslight_chest']!.model)).toBe(true);
    expect(glows(ITEMS['beaconstone_head']!.model)).toBe(true);
    expect(glows(COSTUMES.beacon_halo.model)).toBe(true);
    expect(glows(COSTUMES.starfall_regalia.model)).toBe(true);
  });

  it('armour and costumes keep the silhouette half width inside the hit radius for every people at the slider extremes', () => {
    for (const p of PEOPLE_IDS) for (const v of [0, 20]) {
      const look = lookOf(p, v);
      for (const m of MODELS) {
        if (m.slot === 'weapon' || m.slot === 'offhand') continue;
        const b = buildPiece(m.model, [0, 0], 'low', look)!;
        let r = 0;
        // (as look.ts halfWidth: the width seen from the front; capes may trail behind, as the body's own cape does)
        for (const arr of [b.positions, b.glowPositions]) for (let i = 0; i < arr.length; i += 3) r = Math.max(r, Math.abs(arr[i]!));
        // armour and costumes alike stay inside the hit radius
        expect(r, `${m.name} ${p} ${v}`).toBeLessThanOrEqual(ADVENTURER_RADIUS);
      }
    }
  });
});

describe('dyes', () => {
  it('Undyed (DYES[0], #000000) is the piece\'s own colour, never black; a dye is its own colour', () => {
    expect(DYES[0]!.hex).toBe('#000000');
    const own = OWN.mossweave.main;
    expect(dyeColour(0, own)).toBe(own);
    expect(dyeColour(13, own).toHexString().toLowerCase()).toBe(DYES[13]!.hex.toLowerCase());
    // the starter clothes: undyed is today's teal tunic, a dye replaces it
    const plain = setGear('plain', 'warrior', [0, 0]);
    const body = gearHooks.plan(plain, lookOf('human', 10)).body!;
    expect(body.top!.toHexString()).not.toBe('#000000');
    const dyed = gearHooks.plan(setGear('plain', 'warrior', [1, 0]), lookOf('human', 10)).body!;
    expect(dyed.top!.toHexString().toLowerCase()).toBe(DYES[1]!.hex.toLowerCase());
    // a soot-black dye is still readable (lightness clamp)
    const soot = DYES.findIndex((d) => d.name === 'Soot');
    const c = dyeColour(soot, own);
    expect(Math.max(c.r, c.g, c.b)).toBeGreaterThan(0.06);
  });

  it('each dye channel changes only its own vertices (channel 1 the main cloth or plate, channel 2 the trim)', () => {
    for (const m of MODELS) {
      if (m.slot === 'weapon' || m.slot === 'offhand') continue;
      if (m.slot !== 'costume' && ITEMS[m.name]!.set === 'plain') continue;
      const base = buildPiece(m.model, [0, 0], 'low', null)!.colours;
      const changed = (d: [number, number]) => {
        const c = buildPiece(m.model, d, 'low', null)!.colours, out = new Set<number>();
        for (let i = 0; i < c.length; i += 4) if (Math.abs(c[i]! - base[i]!) + Math.abs(c[i + 1]! - base[i + 1]!) + Math.abs(c[i + 2]! - base[i + 2]!) > 1e-6) out.add(i / 4);
        return out;
      };
      const a = changed([2, 0]), b = changed([0, 14]);
      expect(a.size, `${m.name} channel 1`).toBeGreaterThan(0);
      expect(b.size, `${m.name} channel 2`).toBeGreaterThan(0);
      for (const i of a) expect(b.has(i), `${m.name}: vertex ${i} in both channels`).toBe(false);
    }
  });

  it('weapons and off-hands ignore dyes', () => {
    for (const id of ITEM_IDS) {
      const it = ITEMS[id]!;
      if (it.slot !== 'weapon' && it.slot !== 'offhand') continue;
      expect(buildPiece(it.model, [5, 9], 'low', null)!.colours).toEqual(buildPiece(it.model, [0, 0], 'low', null)!.colours);
    }
  });
});

describe('gear codes to pieces', () => {
  it('a gear code decodes to the plan the pieces need', () => {
    for (const job of JOB_IDS) for (const tier of [0, 1, 2, 3] as const) {
      const g = kitGear(tier, job);
      const back = decodeGearLook(encodeGearLook(g))!;
      expect(back).toEqual(g);
      const plan = gearHooks.plan(back, lookOf('human', 10));
      const off = JOBS[job].weapon === 'blade' ? 'buckler' : JOBS[job].weapon === 'bow' ? 'quiver' : JOBS[job].weapon === 'sword' ? 'shield' : JOBS[job].weapon === 'staff' ? 'tome' : null;
      expect(plan.offhand, `${job} T${tier}`).toBe(off);
      expect(plan.replaces.length, `${job} T${tier}`).toBeGreaterThan(0);
      // a starter kit keeps the job's own cues; a set piece covers them
      expect(plan.headCue, `${job} T${tier}`).toBe(tier === 0);
      expect(plan.shoulderCue, `${job} T${tier}`).toBe(tier === 0);
    }
  });

  it('a body costume hides chest, legs, hands and feet pieces; a head costume the head; hideHead hides the head', () => {
    const worn = kitGear(3, 'paladin');
    const body = { model: COSTUMES.lamplighter_coat.model, dye: [0, 0] as [number, number] };
    const g = resolveGearLook(worn, { body }, false);
    const pieces = gearHooks.pieces(g);
    expect(pieces.map((p) => p.slot).sort()).toEqual(['back', 'chest', 'head', 'offhand', 'weapon']);
    expect(pieces.find((p) => p.slot === 'chest')!.model).toBe(COSTUMES.lamplighter_coat.model);
    const plan = gearHooks.plan(g, lookOf('human', 10));
    expect(plan.body?.noTabard).toBe(true);
    const hat = resolveGearLook(worn, { head: { model: COSTUMES.straw_sunhat.model, dye: [0, 0] } }, false);
    expect(gearHooks.pieces(hat).find((p) => p.slot === 'head')!.model).toBe(COSTUMES.straw_sunhat.model);
    const bare = resolveGearLook(worn, {}, true);
    expect(gearHooks.pieces(bare).some((p) => p.slot === 'head')).toBe(false);
    const bp = gearHooks.plan(bare, lookOf('human', 10));
    expect(bp.headCue).toBe(false);
    expect(bp.hair).toBe(true);
  });
});

describe('budgets', () => {
  const build = (look: Look, job: JobId, gear: GearLook | null) => {
    const v = makeCharacter(scene, { kind: 'player', look, gear });
    v.setWeapon(JOBS[job].weapon, staffTint(job));
    v.setCape(capeFor(job));
    v.setPose('attack'); // weapons drawn (the larger of the two)
    const tris = characterStats.lastActiveTriangles, glow = characterStats.lastGlowTriangles;
    const meshes = (v.root.getChildMeshes(false) as Mesh[]).filter((m) => m.isEnabled() && m.getTotalVertices() > 0 && !m.name.startsWith('blob_') && !m.name.startsWith('pick_'));
    v.dispose();
    return { tris, glow, meshes: meshes.map((m) => m.name.split('_')[0]) };
  };

  for (const q of ['med', 'low'] as const) {
    it(`a full T3 kit with its named weapon adds at most ${q === 'med' ? 900 : 450} triangles at ${q}, and stays near the starter adventurer`, () => {
      setCharacterDetail(q);
      try {
        for (const job of JOB_IDS) {
          const look = lookOf('human', 10, 5);
          const bare = build(look, job, null), starter = build(look, job, kitGear(0, job)), t3 = build(look, job, kitGear(3, job));
          const added = t3.tris + t3.glow - bare.tris;
          expect(added, `${job} at ${q}: +${added} over ${bare.tris}`).toBeLessThanOrEqual(q === 'med' ? 900 : 450);
          expect(t3.tris + t3.glow, `${job} at ${q} vs starter ${starter.tris}`).toBeLessThanOrEqual(starter.tris * 1.2);
          if (q === 'med') expect(t3.tris + t3.glow, job).toBeLessThanOrEqual(3100);
          expect(t3.meshes.filter((m) => m === 'body').length).toBe(1);
          expect(t3.meshes.length).toBeLessThanOrEqual(2);
          expect(starter.meshes).toEqual(['body']);
          expect(build(look, job, kitGear(2, job)).meshes, `${job} T2: no emissive mesh`).toEqual(['body']);
        }
      } finally { setCharacterDetail('high'); }
    });
  }

  it('gearTriangles counts what the pieces add', () => {
    const look = lookOf('human', 10);
    expect(gearTriangles(kitGear(3, 'paladin'), look, 'med')).toBeGreaterThan(gearTriangles(kitGear(1, 'paladin'), look, 'med'));
    expect(gearTriangles(kitGear(0, 'paladin'), look, 'med')).toBeLessThan(gearTriangles(kitGear(1, 'paladin'), look, 'med'));
  });

  it('every set builds on its natural job and the nine set looks differ from each other', () => {
    const look = lookOf('human', 10);
    const keys = new Set<number>();
    for (const set of SET_IDS) {
      if (set === 'plain') continue;
      const job = (Object.keys(JOBS) as JobId[]).find((j) => ({ cloth: 'white_mage', light: 'ranger', heavy: 'paladin' } as const)[SETS[set].type as 'cloth'] === j)!;
      keys.add(gearTriangles(setGear(set, job, [0, 0]), look, 'med'));
    }
    expect(keys.size).toBeGreaterThanOrEqual(8);
  });
});
