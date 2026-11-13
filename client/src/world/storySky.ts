// The sky's two story beats (online): the falling star that drops from the Beacon toward the Greenway once the
// plaque is read, and the far Beacon a Greenway sky shows once it has risen. Built in code; additive, depth-tested
// and far away, so nothing here can hide a telegraph on the ground. No per-frame allocations.
import {
  Color3, Color4, Mesh, MeshBuilder, ParticleSystem, StandardMaterial, Vector3, VertexBuffer, VertexData,
  type Scene, type Texture,
} from '@babylonjs/core';
import { Builder } from './mesh';
import { Kit } from './parts';
import { buildSkyIsland } from './beacon';
import { dotTex } from './life';
import { BEACON_DIR } from './layout';
import { GROVE_EAST_GATE, LAMPFALL_MOUTH } from '@sg2/shared';

/** How long the streak takes, in s (the flash on the horizon follows and fades over FLASH_S). */
export const STAR_S = 3;
export const FLASH_S = 1.6;
const TRAIL_N = 40;
/** The trail's length, as a fraction of the flight. */
const TRAIL_FRAC = 0.32;

/** Where the streak goes: from the Beacon (`from`) over `over` (a high control point) down to `to`, just past the horizon. */
export interface StarPath { from: Vector3; over: Vector3; to: Vector3 }

export interface FallingStar {
  /** Plays the streak; resolves when it lands (the flash is still fading). A second call while one plays joins it. */
  play(path: StarPath): Promise<void>;
  readonly playing: boolean;
  update(dt: number, cam: Vector3): void;
  dispose(): void;
}

/** A unit-free ease for the fall: slow off the Beacon, quicker toward the ground. */
const fallEase = (u: number) => u * u * (2.2 - 1.2 * u);

/** Quadratic Bézier, into `out`. */
function bez(p: StarPath, u: number, out: Vector3): Vector3 {
  const a = (1 - u) * (1 - u), b = 2 * u * (1 - u), c = u * u;
  out.set(p.from.x * a + p.over.x * b + p.to.x * c, p.from.y * a + p.over.y * b + p.to.y * c, p.from.z * a + p.over.z * b + p.to.z * c);
  return out;
}

export function createFallingStar(scene: Scene, prefix: string): FallingStar {
  const dot: Texture = dotTex(scene);
  const addMat = (name: string, tex: Texture | null) => {
    const m = new StandardMaterial(`${prefix}_${name}`, scene);
    m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); m.specularColor = Color3.Black();
    if (tex) { m.diffuseTexture = tex; m.opacityTexture = tex; }
    m.alphaMode = 1; /* ALPHA_ADD */ m.disableDepthWrite = true; m.backFaceCulling = false; m.fogEnabled = false;
    return m;
  };
  // the trail: a camera-facing ribbon of TRAIL_N points behind the head, white-gold to ember to nothing
  const trail = new Mesh(`${prefix}_star_trail`, scene);
  const tPos = new Float32Array(TRAIL_N * 2 * 3), tCol = new Float32Array(TRAIL_N * 2 * 4);
  const tUv = new Float32Array(TRAIL_N * 2 * 2), tIdx: number[] = [];
  for (let i = 0; i < TRAIL_N; i++) {
    const k = i / (TRAIL_N - 1);
    const c = k < 0.12 ? [1, 0.95, 0.8] : k < 0.5 ? [1, 0.8 - (k - 0.12) * 0.55, 0.46 - (k - 0.12) * 0.5] : [0.95, 0.52, 0.32];
    const a = 0.85 * (1 - k) ** 1.8;
    for (let s = 0; s < 2; s++) { tCol.set([c[0] * a, c[1] * a, c[2] * a, 1], (i * 2 + s) * 4); tUv.set([s, k], (i * 2 + s) * 2); }
    if (i < TRAIL_N - 1) { const v = i * 2; tIdx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
  }
  const vd = new VertexData(); vd.positions = tPos; vd.colors = tCol; vd.uvs = tUv; vd.indices = tIdx;
  vd.applyToMesh(trail, true);
  trail.material = addMat('star_trailmat', null);
  trail.material.alpha = 0.99;   // (blended: the vertex colours fade to nothing along the tail)
  trail.alwaysSelectAsActiveMesh = true; trail.isPickable = false; trail.setEnabled(false);
  // the head (a hot core in a soft halo) and the flash on the horizon: camera-facing quads
  const quad = (name: string, size: number, col: Color3) => {
    const m = MeshBuilder.CreatePlane(`${prefix}_${name}`, { size }, scene);
    const mat = addMat(name + 'mat', dot); mat.emissiveColor = col; m.material = mat;
    m.billboardMode = Mesh.BILLBOARDMODE_ALL; m.isPickable = false; m.setEnabled(false);
    return { m, mat };
  };
  const core = quad('star_core', 1, new Color3(1, 0.98, 0.9));
  const halo = quad('star_halo', 1, new Color3(1, 0.72, 0.4));
  const flash = quad('star_flash', 1, new Color3(1, 0.8, 0.52));
  const band = quad('star_band', 1, new Color3(1, 0.62, 0.42));
  const pop = quad('star_pop', 1, new Color3(1, 0.9, 0.62));
  // sparks shed along the way
  const sparks = new ParticleSystem(`${prefix}_star_sparks`, 160, scene);
  sparks.particleTexture = dot; sparks.emitter = new Vector3();
  sparks.color1 = new Color4(1, 0.95, 0.75, 1); sparks.color2 = new Color4(1, 0.7, 0.4, 1); sparks.colorDead = new Color4(0.9, 0.4, 0.3, 0);
  sparks.minSize = 2.5; sparks.maxSize = 7; sparks.minLifeTime = 0.4; sparks.maxLifeTime = 1.1; sparks.emitRate = 0;
  sparks.blendMode = ParticleSystem.BLENDMODE_ADD; sparks.minEmitPower = 2; sparks.maxEmitPower = 9;
  sparks.gravity = new Vector3(0, -14, 0); sparks.minEmitBox = new Vector3(-2, -2, -2); sparks.maxEmitBox = new Vector3(2, 2, 2);
  sparks.direction1 = new Vector3(-1, -0.5, -1); sparks.direction2 = new Vector3(1, 1, 1);
  sparks.start();

  let path: StarPath | null = null;
  let t = -1, flashT = -1, scale = 1;
  let done: (() => void)[] = [];
  const head = new Vector3(), tmp = new Vector3(), tan = new Vector3(), toCam = new Vector3(), side = new Vector3();
  const em = sparks.emitter as Vector3;

  const api: FallingStar = {
    get playing() { return t >= 0; },
    play(p) {
      if (t >= 0) return new Promise<void>((res) => done.push(res));
      path = { from: p.from.clone(), over: p.over.clone(), to: p.to.clone() };
      // sizes follow how far the path is from where it starts (a far Beacon gets a bigger star)
      scale = Math.max(0.6, Vector3.Distance(p.from, p.to) / 900);
      t = 0; flashT = -1;
      trail.setEnabled(true); core.m.setEnabled(true); halo.m.setEnabled(true); pop.m.setEnabled(true);
      pop.m.position.copyFrom(p.from);
      return new Promise<void>((res) => done.push(res));
    },
    update(dt, cam) {
      if (flashT >= 0) {
        flashT += dt;
        const f = flashT / FLASH_S;
        if (f >= 1) { flashT = -1; flash.m.setEnabled(false); band.m.setEnabled(false); }
        else {
          const up = Math.min(1, flashT / 0.18), a = up * (1 - f) ** 1.5;
          flash.mat.alpha = a; band.mat.alpha = a;
          flash.m.scaling.setAll((110 + 150 * Math.sqrt(f)) * scale);
          band.m.scaling.set((420 + 380 * f) * scale, (26 + 20 * f) * scale, 1);
        }
      }
      if (t < 0 || !path) return;
      t += dt;
      const u = Math.min(1, t / STAR_S);
      // the pop where it leaves the Beacon
      const pu = Math.min(1, t / 0.7);
      pop.mat.alpha = Math.sin(pu * Math.PI) * 0.9; pop.m.scaling.setAll((40 + 60 * pu) * scale);
      if (pu >= 1) pop.m.setEnabled(false);
      bez(path, fallEase(u), head);
      core.m.position.copyFrom(head); halo.m.position.copyFrom(head);
      const flick = 1 + 0.12 * Math.sin(t * 41) + 0.06 * Math.sin(t * 17);
      core.m.scaling.setAll(16 * scale * flick); halo.m.scaling.setAll(46 * scale * flick);
      core.mat.alpha = 1; halo.mat.alpha = 0.55;
      em.copyFrom(head); sparks.emitRate = u < 0.97 ? 70 : 0;
      sparks.minSize = 2.5 * scale; sparks.maxSize = 7 * scale;
      // the trail: points back along the path, a camera-facing ribbon tapering to nothing
      for (let i = 0; i < TRAIL_N; i++) {
        const k = i / (TRAIL_N - 1);
        const ui = Math.max(0, u - k * TRAIL_FRAC * Math.min(1, u * 3 + 0.2));
        bez(path, fallEase(ui), tmp);
        bez(path, fallEase(Math.min(1, ui + 0.01)), tan);
        tan.subtractInPlace(tmp);
        toCam.copyFrom(cam).subtractInPlace(tmp);
        Vector3.CrossToRef(tan, toCam, side);
        const l = side.length() || 1;
        const w = (7 * (1 - k) ** 0.8 + 0.6) * scale / l;
        tPos[i * 6] = tmp.x + side.x * w; tPos[i * 6 + 1] = tmp.y + side.y * w; tPos[i * 6 + 2] = tmp.z + side.z * w;
        tPos[i * 6 + 3] = tmp.x - side.x * w; tPos[i * 6 + 4] = tmp.y - side.y * w; tPos[i * 6 + 5] = tmp.z - side.z * w;
      }
      trail.updateVerticesData(VertexBuffer.PositionKind, tPos);
      if (u >= 1) {
        t = -1;
        trail.setEnabled(false); core.m.setEnabled(false); halo.m.setEnabled(false); pop.m.setEnabled(false);
        sparks.emitRate = 0;
        // the soft flash where it came down, and a warm band along the horizon
        flashT = 0;
        flash.m.position.copyFrom(path.to); band.m.position.copyFrom(path.to);
        flash.m.position.y += 45 * scale; band.m.position.y += 22 * scale;
        flash.m.setEnabled(true); band.m.setEnabled(true);
        const d = done; done = [];
        for (const r of d) r();
      }
    },
    dispose() {
      sparks.dispose(false);
      for (const m of [trail, core.m, halo.m, flash.m, band.m, pop.m]) { m.material?.dispose(); m.dispose(); }
      const d = done; done = []; for (const r of d) r();
    },
  };
  return api;
}

/**
 * The Beacon as a distant zone's sky shows it (the Greenway): the same island, small and far, without its waterfalls,
 * in a fog-free far material; hidden until shown. Two meshes (land, glow), built on first show.
 */
export function createFarBeacon(scene: Scene, prefix: string, at: Vector3, scale: number): { setShown(on: boolean): void; readonly shown: boolean; dispose(): void } {
  let meshes: Mesh[] | null = null;
  let shown = false;
  const build = () => {
    const isl = new Kit(new Builder(65), new Builder(66));
    buildSkyIsland(isl, new Builder(67));
    const far = new StandardMaterial(`${prefix}_beacon_far`, scene);
    far.specularColor = Color3.Black(); far.fogEnabled = false; far.diffuseColor = new Color3(0.72, 0.74, 0.8); far.emissiveColor = Color3.FromHexString('#6b5a66');
    const glow = new StandardMaterial(`${prefix}_beacon_glow`, scene);
    glow.disableLighting = true; glow.emissiveColor = new Color3(1, 1, 1); glow.fogEnabled = false;
    const land = isl.b.build(scene, `${prefix}_beacon`, far);
    const lit = isl.g.build(scene, `${prefix}_beacon_lights`, glow);
    lit.parent = land;
    land.position.copyFrom(at); land.scaling.setAll(scale);
    for (const m of [land, lit]) { m.isPickable = false; m.applyFog = false; }
    meshes = [land, lit];
  };
  return {
    get shown() { return shown; },
    setShown(on) {
      shown = on;
      if (on && !meshes) build();
      meshes?.[0].setEnabled(on);
    },
    dispose() { if (meshes) for (const m of meshes) { m.material?.dispose(); m.dispose(); } meshes = null; },
  };
}

/** The Beacon's direction as the Greenway's sky has it (its cloud bank, world/greenway.ts). */
export const GREENWAY_BEACON_DIR: Readonly<{ x: number; y: number; z: number }> = (() => {
  const l = Math.hypot(-0.4, 0.5, 0.75); return Object.freeze({ x: -0.4 / l, y: 0.5 / l, z: 0.75 / l });
})();

/** The falling star's path in the grove: from the Beacon, over the town, down past the east gate toward the Greenway. */
export function groveStarPath(island: Vector3): { from: Vector3; over: Vector3; to: Vector3 } {
  // The Beacon is west-north-west and the gate east, so the streak crosses the whole sky: it arcs over the north side of
  // the town (a camera at the plaza looking north sees it sweep from left to right) and comes down east-north-east.
  const ex = GROVE_EAST_GATE.x, ez = GROVE_EAST_GATE.z, el = Math.hypot(ex, ez) || 1;
  const a = 0.3, dx = ex / el, dz = ez / el;
  const from = island.add(new Vector3(BEACON_DIR.x * -20, -14, BEACON_DIR.z * -20));
  const to = new Vector3((dx * Math.cos(a) - dz * Math.sin(a)) * 760, 6, (dz * Math.cos(a) + dx * Math.sin(a)) * 760);
  const over = new Vector3((from.x + to.x) * 0.5, 300, Math.max(from.z, to.z) + 260);
  return { from, over, to };
}
/** The Greenway's: from its far Beacon down into the crater mouth. */
export function greenwayStarPath(island: Vector3, mouthY: number): { from: Vector3; over: Vector3; to: Vector3 } {
  const to = new Vector3(LAMPFALL_MOUTH.x, mouthY, LAMPFALL_MOUTH.z);
  const from = island.clone();
  const over = from.add(to).scale(0.5).add(new Vector3(0, 220, 0));
  return { from, over, to };
}
