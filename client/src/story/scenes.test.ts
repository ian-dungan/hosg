// The scenes give the camera back as they found it: its lens (fov) and how far up it may look (upperBetaLimit),
// whether a scene ends, is cut short, or is disposed half way (a zone change, a logout). Headless (NullEngine).
import { describe, expect, it } from 'vitest';
import { ArcRotateCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import type { PlayerRig, WorldApi } from '../core/contracts';
import { createStoryScenes } from './scenes';

function setup() {
  const scene = new Scene(new NullEngine());
  const camera = new ArcRotateCamera('cam', 1, 1.1, 12, new Vector3(0, 1, 0), scene);
  camera.fov = 0.9;
  camera.upperBetaLimit = 1.45;
  const rig = { camera, position: new Vector3(0, 0, 0), setCinematic() {} } as unknown as PlayerRig;
  const world = { raiseBeacon: () => Promise.resolve(), fallingStar: () => new Promise<void>(() => {}) } as unknown as WorldApi;
  const scenes = createStoryScenes({ scene, world, rig, zone: 'grove', hudVisible() {}, interrupted: () => false });
  const run = async (s: number) => { for (let i = 0; i < s * 10; i++) { scenes.update(0.1); await Promise.resolve(); await Promise.resolve(); } };
  return { camera, scenes, run };
}

describe('story scenes restore the camera', () => {
  it('a crater scene that ends puts the upper beta limit back', async () => {
    const { camera, scenes, run } = setup();
    const done = scenes.crater({ x: 10, z: 10 });
    await run(0.5);
    expect(scenes.holding).toBe(true);
    expect(camera.upperBetaLimit).toBe(Math.PI);
    await run(6);
    await done;
    expect(scenes.holding).toBe(false);
    expect(camera.upperBetaLimit).toBe(1.45);
  });

  it('disposing mid-scene (the star sweep, its wide lens) puts the fov and the limit back', async () => {
    const { camera, scenes, run } = setup();
    void scenes.beacon();
    for (let i = 0; i < 100 && scenes.phase !== 'star'; i++) await run(0.1);
    expect(scenes.phase).toBe('star');
    await run(0.6);
    expect(camera.fov).not.toBeCloseTo(0.9, 3);
    scenes.dispose();
    expect(camera.fov).toBeCloseTo(0.9, 6);
    expect(camera.upperBetaLimit).toBe(1.45);
  });
});
