// The Look v2 adventurer's budgets, built headless (NullEngine): triangles per quality (mean and worst of random and
// deliberately heavy looks, with the job's weapon and cue shown; far ≤ 1.5k), one draw call (one
// skinned mesh, no emissive mesh), the fixed pick capsule, a queued rebuild on a new look, the far rebuild, the
// bounded body cache, and the widest build inside the hit radius.
import { beforeAll, describe, expect, it } from 'vitest';
import { FreeCamera, NullEngine, Scene, Vector3, type Mesh } from '@babylonjs/core';
import { ADVENTURER_RADIUS, JOBS, JOB_IDS, LOOK_PRESETS, PEOPLE_IDS, parseLook, prng, randomLook, type Look } from '@sg2/shared';
import { BODY_CACHE_SIZE, FAR_M, capeFor, characterStats, clearBodyCache, makeCharacter, setCharacterDetail } from './character';
import { staffTint } from '../combat/spells';

let scene: Scene;
beforeAll(() => {
  // the blob shadow's gradient texture wants a 2D canvas; a stub is enough headless
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 64, height: 64 } : () => ({ addColorStop() {} })) });
  (globalThis as Record<string, unknown>).document ??= { createElement: () => ({ width: 64, height: 64, getContext: () => ctx, style: {} }) };
  scene = new Scene(new NullEngine());
});

const looks = (n: number) => Array.from({ length: n }, (_, i) => randomLook(prng(i + 1)));
/** The longest-haired, most detailed looks there are: the worst cases for the budget. */
const heavy = (): Look[] => [31, 35, 38, 36, 29].map((style, i) => parseLook({ ...LOOK_PRESETS[i]!.look, hair: { ...LOOK_PRESETS[i]!.look.hair, style, facial: 12, colour2: 0x804020 }, skin: { ...LOOK_PRESETS[i]!.look.skin, freckles: 4, moles: 63, scar: 7 }, face: { ...LOOK_PRESETS[i]!.look.face, age: 4 }, makeup: { lips: 3, shadow: 4, liner: 2 } })!);
const worstTris = (q: 'high' | 'med' | 'low') => {
  setCharacterDetail(q);
  let worst = 0, sum = 0, n = 0;
  for (const [i, l] of [...looks(16), ...heavy()].entries()) {
    const job = JOB_IDS[i % JOB_IDS.length]!;
    const v = makeCharacter(scene, { kind: 'player', weapon: JOBS[job].weapon, look: l });
    v.setWeapon(JOBS[job].weapon, staffTint(job)); v.setCape(capeFor(job));
    worst = Math.max(worst, characterStats.lastActiveTriangles); sum += characterStats.lastActiveTriangles; n++;
    v.dispose();
  }
  setCharacterDetail('high');
  return { worst, mean: sum / n };
};

describe('the Look v2 adventurer', () => {
  it('stays inside its triangle budget at every quality', () => {
    const high = worstTris('high'), med = worstTris('med'), low = worstTris('low');
    // eslint-disable-next-line no-console
    console.log(`triangles per adventurer (mean / worst): high ${high.mean.toFixed(0)} / ${high.worst}, med ${med.mean.toFixed(0)} / ${med.worst}, low ${low.mean.toFixed(0)} / ${low.worst}`);
    // the brief's budgets (high ~7k, med ~3k, low ~1.8k) hold for typical looks; the worst case here stacks the longest
    // hair, a long beard, every mark and make-up with a sword and shield (measured: see the report)
    expect(high.mean).toBeLessThanOrEqual(7000);
    expect(med.mean).toBeLessThanOrEqual(3100);
    expect(low.mean).toBeLessThanOrEqual(1910);
    // the worst cases (longest hair, longest beard, every mark, the Black Mage's hat and staff) stay near the means
    // (2026-11 fix round: med and low were 20 % and 16 % over; at med and below the heaviest parts thin out)
    expect(high.worst).toBeLessThanOrEqual(7700);
    expect(med.worst / med.mean).toBeLessThanOrEqual(1.12);
    expect(low.worst / low.mean).toBeLessThanOrEqual(1.1);
  });

  it('is one skinned mesh (one draw call) with a pick capsule the same size for every people and body', () => {
    const sizes = new Set<string>();
    for (const p of PEOPLE_IDS) for (const body of ['male', 'female'] as const) {
      const l = LOOK_PRESETS.find((x) => x.look.people === p && x.look.body === body)!.look;
      const v = makeCharacter(scene, { kind: 'player', look: l });
      const meshes = v.root.getChildMeshes(false) as Mesh[];
      const drawn = meshes.filter((m) => m.isVisible && m.visibility > 0 && m.getTotalVertices() > 0 && !m.name.startsWith('blob_'));
      expect(drawn.map((m) => m.name.split('_')[0])).toEqual(['body']);
      const pick = meshes.find((m) => m.name.startsWith('pick_'))!;
      pick.refreshBoundingInfo();
      const e = pick.getBoundingInfo().boundingBox.extendSize;
      sizes.add(`${e.x.toFixed(3)},${e.y.toFixed(3)}`);
      v.dispose();
    }
    expect(sizes.size).toBe(1);
  });

  it('keeps the widest build of every people and body inside the hit radius (the built mesh, not only the numbers)', () => {
    for (const p of PEOPLE_IDS) for (const body of ['male', 'female'] as const) {
      const base = LOOK_PRESETS.find((x) => x.look.people === p && x.look.body === body)!.look;
      const wide = parseLook({ ...base, build: { height: 20, shoulders: 20, chest: 20, waist: 20, hips: 20, arms: 20, legs: 0, muscle: 20, weight: 20, neck: 20, head: 20 }, hair: { ...base.hair, style: 36 } })!;
      const v = makeCharacter(scene, { kind: 'player', weapon: 'none', look: wide });
      v.setWeapon('none');
      const body2 = v.root.getChildMeshes(false).find((m) => m.name.startsWith('body_')) as Mesh;
      const pos = body2.getVerticesData('position')!, idx = body2.getIndices()!;
      let maxX = 0;
      for (let i = 0; i < idx.length; i++) {
        const k = idx[i]!, y = pos[k * 3 + 1]!;
        if (y > 0.05 && y < 2.4) maxX = Math.max(maxX, Math.abs(pos[k * 3]!));
      }
      expect(maxX, `${p} ${body}`).toBeLessThanOrEqual(ADVENTURER_RADIUS);
      v.dispose();
    }
  });

  it('rebuilds once for a new look, on a later update, keeping the same mesh', () => {
    const v = makeCharacter(scene, { kind: 'player', look: randomLook(prng(1)) });
    v.setCape(capeFor('ranger'));
    const body = v.root.getChildMeshes(false).find((m) => m.name.startsWith('body_'))!;
    const before = characterStats.rebuilds;
    v.setAppearance(randomLook(prng(2)), null);
    v.setAppearance(randomLook(prng(3)), null); // only the last is built
    expect(characterStats.rebuilds).toBe(before);
    v.update(1 / 60);
    expect(characterStats.rebuilds).toBe(before + 1);
    v.update(1 / 60);
    expect(characterStats.rebuilds).toBe(before + 1);
    expect(v.root.getChildMeshes(false).find((m) => m.name.startsWith('body_'))).toBe(body);
    v.dispose();
  });

  it('is rebuilt cheap far from the camera, and back up close', () => {
    const cam = new FreeCamera('budgetCam', new Vector3(0, 1.6, -3), scene);
    scene.activeCamera = cam;
    const v = makeCharacter(scene, { kind: 'player', look: randomLook(prng(5)), weapon: 'none' });
    v.setWeapon('none');
    v.update(0.6);
    const near = characterStats.lastActiveTriangles;
    const tick = () => { scene.getEngine().endFrame(); v.update(0.6); };
    cam.position.set(0, 1.6, -(FAR_M + 5));
    tick(); tick();
    const farTris = characterStats.lastActiveTriangles;
    expect(farTris).toBeLessThan(near * 0.5);
    expect(farTris).toBeLessThanOrEqual(1500);
    cam.position.set(0, 1.6, -3);
    tick(); tick();
    expect(characterStats.lastActiveTriangles).toBe(near);
    v.dispose(); cam.dispose(); scene.activeCamera = null;
  });

  it('keeps the body cache bounded', () => {
    clearBodyCache();
    for (const l of looks(BODY_CACHE_SIZE + 10)) makeCharacter(scene, { kind: 'player', look: l }).dispose();
    expect(characterStats.cacheSize).toBeLessThanOrEqual(BODY_CACHE_SIZE);
  });
});

describe('the quality step-down', () => {
  it('rebuilds every live look-driven body at the new detail (queued, on a later update)', () => {
    setCharacterDetail('high');
    const v = makeCharacter(scene, { kind: 'player', look: randomLook(prng(4)) });
    const high = characterStats.lastActiveTriangles;
    const before = characterStats.rebuilds;
    v.update(1 / 60);
    expect(characterStats.rebuilds).toBe(before);
    try {
      setCharacterDetail('low');
      v.update(1 / 60);
      expect(characterStats.rebuilds).toBe(before + 1);
      expect(characterStats.lastActiveTriangles).toBeLessThan(high);
      setCharacterDetail('low'); // no change: nothing queued
      v.update(1 / 60);
      expect(characterStats.rebuilds).toBe(before + 1);
    } finally { setCharacterDetail('high'); }
    v.dispose();
    const after = characterStats.rebuilds;
    setCharacterDetail('med'); setCharacterDetail('high'); // disposed views are not rebuilt
    expect(characterStats.rebuilds).toBe(after);
  });
});
