// buildWorld: Shady Grove (town, grove, statue), the sky vista, and the hidden Beacon.
import {
  Vector3, Color3, Color4, StandardMaterial, DirectionalLight, HemisphericLight, ShadowGenerator, GlowLayer,
  Scene, MeshBuilder, Matrix, Quaternion, type Mesh, type AbstractMesh,
  DefaultRenderingPipeline, SSAO2RenderingPipeline, ImageProcessingConfiguration, type ArcRotateCamera, type TransformNode,
} from '@babylonjs/core';
import type { BuildWorld, WorldApi, AnchorName, Anchor, Quality } from '../core/contracts';
import { ARENA_RADIUS } from '../core/contracts';
import { Builder, hex } from './mesh';
import { Kit, windmillSails } from './parts';
import { buildCountryside } from './countryside';
import { buildTown } from './town';
import { buildStatue } from './statue';
import { buildSkyDome, buildSkyClouds, SUN_DIR, HAZE } from './sky';
import { buildArenaClearing, buildSkyIsland, buildCloudBank } from './beacon';
import {
  Walk, groundHeight, BEACON_DIR, BEACON_C, BEACON_U, BEACON_PERP, ARENA_C, ARENA_Y, BEACON_TOP, B_DOCK_U, B_DOCK_Y, SKY_ISLAND,
  DOCK_START, DOCK_LEN, DOCK_Y,
} from './layout';

const C3 = (h: string) => { const c = hex(h); return new Color3(c[0], c[1], c[2]); };
const HIDDEN_Y = -110;
const RISE_TIME = 8;

export const buildWorld: BuildWorld = (scene: Scene): WorldApi => {
  // ───── atmosphere ─────
  const fogCol = C3(HAZE);
  scene.clearColor = new Color4(fogCol.r, fogCol.g, fogCol.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = fogCol;
  scene.fogStart = 140; scene.fogEnd = 1900;
  scene.ambientColor = new Color3(0, 0, 0);

  const sunDir = new Vector3(-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]);
  const sun = new DirectionalLight('world_sun', sunDir, scene);
  sun.diffuse = C3('#ffe2b8'); sun.specular = new Color3(0, 0, 0); sun.intensity = 0.88;
  sun.position = new Vector3(SUN_DIR[0] * 90, SUN_DIR[1] * 90, SUN_DIR[2] * 90);
  const hemi = new HemisphericLight('world_fill', new Vector3(0.1, 1, 0.2), scene);
  hemi.diffuse = C3('#d2dcf2'); hemi.groundColor = C3('#a7889f'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.78;

  // ───── materials ─────
  const litMat = (name: string, emissive = 0) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(emissive, emissive, emissive);
    return m;
  };
  const mLit = litMat('world_lit');
  const mCloud = litMat('world_cloud', 0.84); mCloud.diffuseColor = new Color3(0.24, 0.22, 0.24);
  const mWater = litMat('world_water', 0.65); mWater.diffuseColor = new Color3(0.4, 0.4, 0.4);
  const mGlow = new StandardMaterial('world_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1);
  const mSky = new StandardMaterial('world_sky', scene);
  mSky.disableLighting = true; mSky.emissiveColor = new Color3(1, 1, 1); mSky.fogEnabled = false; mSky.backFaceCulling = false;
  const mBeam = new StandardMaterial('world_beam', scene);
  mBeam.disableLighting = true; mBeam.emissiveColor = C3('#ffd56a'); mBeam.alpha = 0.0; mBeam.fogEnabled = false; mBeam.backFaceCulling = false;

  // fog-free variants for the sky (clouds, the floating Beacon) so they stay crisp
  const mFar = litMat('world_far', 0); mFar.fogEnabled = false; mFar.diffuseColor = new Color3(0.72, 0.74, 0.8); mFar.emissiveColor = C3('#6b5a66');
  const mFarGlow = mGlow.clone('world_far_glow'); mFarGlow.fogEnabled = false;
  const mFarWater = litMat('world_far_water', 0.7); mFarWater.diffuseColor = new Color3(0.35, 0.35, 0.35); mFarWater.fogEnabled = false;
  const mMountMat = litMat('world_mount', 0); mMountMat.fogEnabled = false; mMountMat.diffuseColor = new Color3(0.42, 0.42, 0.46); mMountMat.emissiveColor = C3('#8d8aa0');
  const mSkyCloud = litMat('world_skycloud', 0.82); mSkyCloud.diffuseColor = new Color3(0.26, 0.24, 0.26); mSkyCloud.fogEnabled = false;

  // ───── build geometry ─────
  const town = new Kit(new Builder(11), new Builder(12));
  const props = new Kit(new Builder(13), town.g);
  const tOut = buildTown(town, props);
  const statueB = new Builder(21);
  const lensArr = buildStatue(statueB, town.g, 0, 0.04, 0);
  const statueLens = new Vector3(lensArr[0], lensArr[1], lensArr[2]);

  const terrainB = new Builder(31);
  const band = new Kit(new Builder(32), town.g);
  const far = new Kit(new Builder(33), new Builder(34));
  const river = new Builder(35), mount = new Builder(36);
  const cOut = buildCountryside(terrainB, band, far, river, mount);

  const bdA = Math.atan2(BEACON_DIR.z, BEACON_DIR.x);
  const cloudsA = new Builder(41), cloudsB = new Builder(42);
  buildSkyClouds(cloudsA, cloudsB, bdA);
  const sky = new Builder(51); buildSkyDome(sky, 2400);

  const arenaB = new Builder(61), ringB = new Builder(63);
  buildArenaClearing(arenaB, ringB);
  const isl = new Kit(new Builder(65), new Builder(66)), islWater = new Builder(67);
  buildSkyIsland(isl, islWater);
  const bankL = new Builder(68), bankR = new Builder(69);
  buildCloudBank(bankL, bankR);

  const sail = new Builder(71); windmillSails(sail);

  const statics: Mesh[] = [];
  const mk = (b: Builder, name: string, mat: StandardMaterial) => b.build(scene, name, mat);
  const mTerrain = mk(terrainB, 'world_terrain', mLit);
  const mTown = mk(town.b, 'world_town', mLit);
  const mProps = mk(props.b, 'world_props', mLit);
  const mStatue = mk(statueB, 'world_statue', mLit);
  const mBand = mk(band.b, 'world_band', mLit);
  const mTownGlow = mk(town.g, 'world_town_glow', mGlow);
  const mFarM = mk(far.b, 'world_country', mLit);
  const mFarGlowM = mk(far.g, 'world_country_glow', mGlow);
  const mRiver = mk(river, 'world_river', mWater);
  const mMount = mk(mount, 'world_mountains', mMountMat);
  const mCloudA = mk(cloudsA, 'world_clouds', mSkyCloud);
  const mCloudB = mk(cloudsB, 'world_clouds_extra', mSkyCloud);
  const mSkyM = mk(sky, 'world_sky', mSky);
  mSkyM.infiniteDistance = true; mSkyM.applyFog = false;
  const mArena = mk(arenaB, 'world_arena', mLit);
  const beaconRing = mk(ringB, 'world_arena_ring', mLit);
  statics.push(mMount, mTerrain, mTown, mProps, mStatue, mBand, mTownGlow, mFarM, mFarGlowM, mRiver, mCloudA, mCloudB, mSkyM, mArena, beaconRing);
  for (const m of statics) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; }

  // the floating Beacon in the sky (hidden until raiseBeacon) and the cloud bank that parts for it
  const islandPos = new Vector3(BEACON_DIR.x * SKY_ISLAND.dist, SKY_ISLAND.y, BEACON_DIR.z * SKY_ISLAND.dist);
  const beaconRoot = mk(isl.b, 'world_beacon', mFar);
  const beaconGlow = mk(isl.g, 'world_beacon_glow', mFarGlow);
  const beaconFall = mk(islWater, 'world_beacon_water', mFarWater);
  for (const m of [beaconGlow, beaconFall]) m.parent = beaconRoot;
  beaconRoot.position.copyFrom(islandPos).addInPlace(new Vector3(0, HIDDEN_Y, 0));
  beaconRoot.setEnabled(false); beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = 0;
  const bankYaw = Math.atan2(BEACON_DIR.x, BEACON_DIR.z);
  const bankLM = mk(bankL, 'world_bank_l', mSkyCloud), bankRM = mk(bankR, 'world_bank_r', mSkyCloud);
  for (const m of [bankLM, bankRM]) { m.position.copyFrom(islandPos); m.rotation.y = bankYaw; }
  const bankSide = new Vector3(Math.cos(bankYaw), 0, -Math.sin(bankYaw)); // local +X in world

  // animated bits
  const sails = mk(sail, 'world_windmill_sails', mLit);
  sails.position.set(tOut.windmillHub[0], tOut.windmillHub[1], tOut.windmillHub[2]);
  sails.rotation.y = tOut.windmillYaw;

  // beam from the lens along Ellie's arm to the island
  const skyPoint = islandPos.add(new Vector3(0, -25, 0));
  const beamLen = Vector3.Distance(statueLens, skyPoint);
  const beam = MeshBuilder.CreateCylinder('world_beam', { height: beamLen, diameterTop: 14, diameterBottom: 0.3, tessellation: 8 }, scene);
  beam.bakeTransformIntoVertices(Matrix.Translation(0, beamLen / 2, 0));
  beam.material = mBeam; beam.isPickable = false; beam.setEnabled(false);
  beam.position.copyFrom(statueLens);
  {
    const d = skyPoint.subtract(statueLens).normalize();
    const axis = Vector3.Cross(Vector3.Up(), d).normalize();
    beam.rotationQuaternion = Quaternion.RotationAxis(axis, Math.acos(Vector3.Dot(Vector3.Up(), d)));
  }

  const walk = new Walk([...tOut.obstacles, ...cOut.obstacles]);

  // ───── anchors ─────
  const v = (x: number, z: number, y?: number) => new Vector3(x, y ?? groundHeight(x, z), z);
  const yawTo = (fx: number, fz: number, tx: number, tz: number) => Math.atan2(tx - fx, tz - fz);
  const bu = (u: number, s: number) => ({ x: BEACON_C.x + BEACON_U.x * u + BEACON_PERP.x * s, z: BEACON_C.z + BEACON_U.z * u + BEACON_PERP.z * s });
  const dockU = DOCK_START + DOCK_LEN - 1.5;
  const gate = { x: ARENA_C.x + BEACON_U.x * 17.5, z: ARENA_C.z + BEACON_U.z * 17.5 };
  const exitP = bu(9, 6);
  const towardBeacon = Math.atan2(BEACON_DIR.x, BEACON_DIR.z);
  const anchors: Record<AnchorName, Anchor> = {
    playerStart: { pos: v(0, -11), facing: 0 },
    statuePlinth: { pos: v(0, -5.3), facing: 0 },
    marrow: { pos: v(-3.3, -6.4), facing: yawTo(-3.3, -6.4, 0, -11) },
    pim: { pos: new Vector3(...tOut.pimGround), facing: tOut.pimFacing },
    groveDock: { pos: v(BEACON_DIR.x * dockU, BEACON_DIR.z * dockU, DOCK_Y), facing: towardBeacon },
    beaconDock: { pos: new Vector3(BEACON_C.x + BEACON_U.x * B_DOCK_U, B_DOCK_Y, BEACON_C.z + BEACON_U.z * B_DOCK_U), facing: Math.atan2(-BEACON_U.x, -BEACON_U.z) },
    arenaGate: { pos: new Vector3(gate.x, BEACON_TOP, gate.z), facing: Math.atan2(-BEACON_U.x, -BEACON_U.z) },
    arenaCenter: { pos: new Vector3(ARENA_C.x, ARENA_Y, ARENA_C.z), facing: Math.atan2(BEACON_U.x, BEACON_U.z) },
    arenaExit: { pos: new Vector3(exitP.x, BEACON_TOP, exitP.z), facing: yawTo(exitP.x, exitP.z, BEACON_C.x + BEACON_U.x * 40, BEACON_C.z + BEACON_U.z * 40) },
  };
  const spawns: Vector3[] = [];
  for (const [u, s] of [[28, -5], [27, 6], [22, -9], [21, 2], [16, 8], [15, -6], [11, -10], [10, 10]]) { const p = bu(u, s); spawns.push(new Vector3(p.x, BEACON_TOP, p.z)); }

  // ───── quality ─────
  let shadow: ShadowGenerator | null = null;
  let glow: GlowLayer | null = null;
  const casters: AbstractMesh[] = [mTown, mStatue, mProps, mBand];
  const setQuality = (q: Quality) => {
    mCloudB.setEnabled(q !== 'low');
    mProps.setEnabled(q !== 'low');
    mFarGlowM.setEnabled(q !== 'low');
    if (q === 'low') { shadow?.dispose(); shadow = null; }
    else {
      const size = q === 'high' ? 2048 : 1024;
      if (!shadow || shadow.getShadowMap()?.getSize().width !== size) {
        shadow?.dispose();
        shadow = new ShadowGenerator(size, sun);
        shadow.usePercentageCloserFiltering = true;
        shadow.filteringQuality = q === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
        shadow.bias = 0.006; shadow.normalBias = 0.05; shadow.darkness = 0.35;
        for (const c of casters) shadow.addShadowCaster(c, false);
        sun.autoCalcShadowZBounds = true;
        for (const m of [mTerrain, mTown, mStatue, mProps, mBand]) m.receiveShadows = true;
      }
    }
    if (q === 'high' && !glow) {
      glow = new GlowLayer('world_glowlayer', scene, { mainTextureRatio: 0.35, blurKernelSize: 24 });
      glow.intensity = 0.45;
      glow.addIncludedOnlyMesh(mTownGlow); glow.addIncludedOnlyMesh(beaconGlow); glow.addIncludedOnlyMesh(beam);
      glow.customEmissiveColorSelector = (mesh, _sub, _mat, result) => {
        if (mesh === beam) result.set(1, 0.8, 0.35, 1); else result.set(0.9, 0.7, 0.35, 1);
      };
    } else if (q !== 'high' && glow) { glow.dispose(); glow = null; }
  };
  // the sun shadow frustum should cover Shady Grove; keep it tight
  sun.shadowMinZ = 1; sun.shadowMaxZ = 400;
  setQuality('med');

  // ───── runtime ─────
  let time = 0;
  let raised = false;
  let rise: { t: number; resolve: () => void } | null = null;
  let phase: 1 | 2 | 3 = 1;
  const baseSun = sun.diffuse.clone(), baseHemi = hemi.diffuse.clone(), baseInt = sun.intensity;

  // ── post-processing (attached once the player camera exists) ──
  let quality: Quality = 'med';
  let cam: ArcRotateCamera | null = null;
  let pipe: DefaultRenderingPipeline | null = null;
  let ssao: SSAO2RenderingPipeline | null = null;
  const applyPost = () => {
    if (!cam) return;
    pipe?.dispose(); pipe = null;
    ssao?.dispose(); ssao = null;
    if (quality === 'low') return;
    pipe = new DefaultRenderingPipeline('world_post', true, scene, [cam]);
    pipe.fxaaEnabled = true;
    pipe.imageProcessingEnabled = true;
    const ip = pipe.imageProcessing;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.25; ip.contrast = 1.18;
    ip.vignetteEnabled = true; ip.vignetteWeight = 1.6; ip.vignetteStretch = 0.4;
    ip.vignetteColor = new Color4(0.12, 0.08, 0.2, 0);
    if (quality === 'high') {
      pipe.bloomEnabled = true; pipe.bloomThreshold = 0.78; pipe.bloomWeight = 0.35; pipe.bloomKernel = 48; pipe.bloomScale = 0.5;
      pipe.sharpenEnabled = true; pipe.sharpen.edgeAmount = 0.18;
      try {
        ssao = new SSAO2RenderingPipeline('world_ssao', scene, { ssaoRatio: 0.5, blurRatio: 1 }, [cam]);
        ssao.radius = 1.6; ssao.totalStrength = 1.0; ssao.base = 0.15; ssao.samples = 12; ssao.maxZ = 250; ssao.expensiveBlur = true;
      } catch (e) { console.warn('SSAO unavailable', e); ssao = null; }
    }
  };

  const api: WorldApi = {
    addShadowCaster: (root: TransformNode) => {
      for (const m of root.getChildMeshes(false)) {
        if (casters.includes(m)) continue;
        casters.push(m);
        shadow?.addShadowCaster(m, false);
      }
    },
    attachCamera: (c: ArcRotateCamera) => { cam = c; applyPost(); },
    groundAt: (x, z) => walk.groundAt(x, z),
    anchor: (name) => { const a = anchors[name]; return { pos: a.pos.clone(), facing: a.facing }; },
    enemySpawns: () => spawns.map(p => p.clone()),
    raiseBeacon: () => {
      if (raised) return Promise.resolve();
      if (rise) return new Promise(res => { const r0 = rise!.resolve; rise!.resolve = () => { r0(); res(); }; });
      beaconRoot.setEnabled(true); beam.setEnabled(true);
      return new Promise<void>(resolve => { rise = { t: 0, resolve }; });
    },
    get beaconRaised() { return raised; },
    setArenaPhase: (p) => {
      phase = p;
      walk.arenaRadius = ARENA_RADIUS[p];
      beaconRing.setEnabled(p === 1);
      if (p === 3) { sun.diffuse = C3('#c9a6d8'); sun.intensity = baseInt * 0.7; hemi.diffuse = C3('#7d86b8'); scene.fogColor = C3('#9a8fb2'); }
      else { sun.diffuse = baseSun.clone(); sun.intensity = baseInt; hemi.diffuse = baseHemi.clone(); scene.fogColor = fogCol; }
    },
    statueLens,
    setQuality: (q: Quality) => { quality = q; setQuality(q); applyPost(); },
    update: (dt) => {
      time += dt;
      sails.rotation.z = time * 0.6;
      if (rise) {
        rise.t += dt;
        const t = Math.min(1, rise.t / RISE_TIME);
        const e = t * t * (3 - 2 * t);
        // clouds part over the first 60%, the island emerges from 25% on
        const part = Math.min(1, t / 0.6); const pe = part * part * (3 - 2 * part);
        bankLM.position.copyFrom(islandPos).addInPlace(bankSide.scale(-110 * pe));
        bankRM.position.copyFrom(islandPos).addInPlace(bankSide.scale(110 * pe));
        bankLM.visibility = bankRM.visibility = 1 - 0.55 * pe;
        const it = Math.max(0, Math.min(1, (t - 0.25) / 0.75)); const ie = it * it * (3 - 2 * it);
        beaconRoot.position.y = islandPos.y + HIDDEN_Y * (1 - ie);
        const vis = Math.min(1, it * 1.6);
        beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = vis;
        mBeam.alpha = Math.min(1, rise.t * 2) * (t < 0.8 ? 0.8 : 0.8 * (1 - (t - 0.8) / 0.2));
        beam.scaling.set(1, Math.min(1, rise.t * 1.2), 1);
        void e;
        if (t >= 1) {
          beaconRoot.position.y = islandPos.y; beam.setEnabled(false);
          beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = 1;
          raised = true; walk.beaconUp = true;
          const r = rise; rise = null; r.resolve();
        }
      }
      void phase;
    },
  };
  void beamLen;
  return api;
};

