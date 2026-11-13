// The look-driven adventurer's budgets, built headless (NullEngine): triangles per quality against today's default
// body, one draw call (one skinned mesh, no emissive mesh), the fixed pick capsule, and a queued rebuild on a new look.
import { beforeAll, describe, expect, it } from 'vitest';
import { NullEngine, Scene, type Mesh } from '@babylonjs/core';
import { PEOPLE_IDS, prng, randomLook } from '@sg2/shared';
import { capeFor, characterStats, makeCharacter, setCharacterDetail } from './character';

let scene: Scene;
beforeAll(() => {
  // the blob shadow's gradient texture wants a 2D canvas; a stub is enough headless
  const ctx = new Proxy({}, { get: (_t, k) => (k === 'canvas' ? { width: 64, height: 64 } : () => ({ addColorStop() {} })) });
  (globalThis as Record<string, unknown>).document ??= { createElement: () => ({ width: 64, height: 64, getContext: () => ctx, style: {} }) };
  scene = new Scene(new NullEngine());
});

const meanTris = (q: 'high' | 'med' | 'low') => {
  setCharacterDetail(q);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = makeCharacter(scene, { kind: 'player', weapon: 'none', look: randomLook(prng(i + 1)) });
    sum += characterStats.lastActiveTriangles;
    v.dispose();
  }
  setCharacterDetail('high');
  return sum / 12;
};

describe('the look-driven adventurer', () => {
  it('costs no more than the default adventurer at high, and far less at med and low', () => {
    const d = makeCharacter(scene, { kind: 'player', weapon: 'none' });
    const today = characterStats.lastActiveTriangles;
    d.dispose();
    const high = meanTris('high'), med = meanTris('med'), low = meanTris('low');
    expect(high).toBeLessThanOrEqual(today * 1.08);
    expect(med).toBeLessThanOrEqual(2300);
    expect(low).toBeLessThanOrEqual(1850);
    expect(low).toBeLessThan(med);
  });

  it('is one skinned mesh (one draw call) with a pick capsule the same size for every people', () => {
    const sizes = new Set<string>();
    for (const p of PEOPLE_IDS) {
      let l = randomLook(prng(7));
      for (let i = 8; l.people !== p; i++) l = randomLook(prng(i));
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
});
