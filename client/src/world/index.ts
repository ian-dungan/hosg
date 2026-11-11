// buildWorld: Shady Grove (town, grove, statue), the sky vista, and the hidden Beacon.
import {
  Vector3, Color3, Color4, StandardMaterial, DirectionalLight, HemisphericLight, ShadowGenerator, GlowLayer,
  Scene, MeshBuilder, Matrix, Quaternion, type Mesh, type AbstractMesh,
} from '@babylonjs/core';
import type { BuildWorld, WorldApi, AnchorName, Anchor, Quality } from '../core/contracts';
import { ARENA_RADIUS } from '../core/contracts';
import { Builder, hex } from './mesh';
import { Kit, windmillSails, ship } from './parts';
import { buildTown } from './town';
import { buildStatue } from './statue';
import { buildSkyDome, buildClouds, buildVista, vistaShipPath, SUN_DIR } from './sky';
import { buildBeacon } from './beacon';
import {
  Walk, groveHeight, BEACON_DIR, BEACON_C, BEACON_U, BEACON_PERP, ARENA_C, ARENA_Y, BEACON_TOP, B_DOCK_START, B_DOCK_Y,
  DOCK_START, DOCK_LEN, DOCK_Y,
} from './layout';

const C3 = (h: string) => { const c = hex(h); return new Color3(c[0], c[1], c[2]); };
const HIDDEN_Y = -140;
const RISE_TIME = 8;

export const buildWorld: BuildWorld = (scene: Scene): WorldApi => {
  // ───── atmosphere ─────
  const fogCol = C3('#f6cfae');
  scene.clearColor = new Color4(fogCol.r, fogCol.g, fogCol.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = fogCol;
  scene.fogStart = 220; scene.fogEnd = 1250;
  scene.ambientColor = new Color3(0, 0, 0);

  const sunDir = new Vector3(-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]);
  const sun = new DirectionalLight('world_sun', sunDir, scene);
  sun.diffuse = C3('#ffe2b8'); sun.specular = new Color3(0, 0, 0); sun.intensity = 0.95;
  sun.position = new Vector3(SUN_DIR[0] * 90, SUN_DIR[1] * 90, SUN_DIR[2] * 90);
  const hemi = new HemisphericLight('world_fill', new Vector3(0.1, 1, 0.2), scene);
  hemi.diffuse = C3('#b9cdf0'); hemi.groundColor = C3('#8a6f9a'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.62;

  // ───── materials ─────
  const litMat = (name: string, emissive = 0) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(emissive, emissive, emissive);
    return m;
  };
  const mLit = litMat('world_lit');
  const mCloud = litMat('world_cloud', 0.5); mCloud.diffuseColor = new Color3(0.62, 0.6, 0.62);
  const mWater = litMat('world_water', 0.65); mWater.diffuseColor = new Color3(0.4, 0.4, 0.4);
  const mGlow = new StandardMaterial('world_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1);
  const mSky = new StandardMaterial('world_sky', scene);
  mSky.disableLighting = true; mSky.emissiveColor = new Color3(1, 1, 1); mSky.fogEnabled = false; mSky.backFaceCulling = false;
  const mBeam = new StandardMaterial('world_beam', scene);
  mBeam.disableLighting = true; mBeam.emissiveColor = C3('#ffd56a'); mBeam.alpha = 0.0; mBeam.fogEnabled = false; mBeam.backFaceCulling = false;

  // ───── build geometry ─────
  const town = new Kit(new Builder(11), new Builder(12));
  const props = new Kit(new Builder(13), town.g);
  const tOut = buildTown(town, props);
  const statueB = new Builder(21);
  const lensArr = buildStatue(statueB, town.g, 0, 0.04, 0);
  const statueLens = new Vector3(lensArr[0], lensArr[1], lensArr[2]);

  const vista = new Kit(new Builder(31), new Builder(32));
  const water = new Builder(33);
  buildVista(vista, water);
  const cloudsA = new Builder(41), cloudsB = new Builder(42);
  buildClouds(cloudsA, cloudsB);
  const sky = new Builder(51); buildSkyDome(sky, 2400);

  const beacon = new Kit(new Builder(61), new Builder(62));
  const ringB = new Builder(63), beaconWater = new Builder(64);
  buildBeacon(beacon, ringB, beaconWater);

  const sail = new Builder(71); windmillSails(sail);
  const shipKit = new Kit(new Builder(72), new Builder(73));
  ship(shipKit, 0, 0, 0, 0, 1.6, {});
  const ship2 = new Kit(new Builder(74), shipKit.g);
  ship(ship2, 0, 0, 0, 0, 2.6, { stripe: C3ToRgb('#3fb0a6'), wing: C3ToRgb('#ff9a6a') });

  const statics: Mesh[] = [];
  const mk = (b: Builder, name: string, mat: StandardMaterial) => { const m = b.build(scene, name, mat); return m; };
  const mTown = mk(town.b, 'world_town', mLit);
  const mProps = mk(props.b, 'world_props', mLit);
  const mStatue = mk(statueB, 'world_statue', mLit);
  const mTownGlow = mk(town.g, 'world_town_glow', mGlow);
  const mVista = mk(vista.b, 'world_vista', mLit);
  const mVistaGlow = mk(vista.g, 'world_vista_glow', mGlow);
  const mWaterM = mk(water, 'world_water', mWater);
  const mCloudA = mk(cloudsA, 'world_clouds', mCloud);
  const mCloudB = mk(cloudsB, 'world_clouds_extra', mCloud);
  const mSkyM = mk(sky, 'world_sky', mSky);
  mSkyM.infiniteDistance = true; mSkyM.applyFog = false;
  statics.push(mTown, mProps, mStatue, mTownGlow, mVista, mVistaGlow, mWaterM, mCloudA, mCloudB, mSkyM);
  for (const m of statics) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; }

  // beacon (moves while rising)
  const beaconRoot = mk(beacon.b, 'world_beacon', mLit);
  const beaconGlow = mk(beacon.g, 'world_beacon_glow', mGlow);
  const beaconRing = mk(ringB, 'world_beacon_ring', mLit);
  const beaconFall = mk(beaconWater, 'world_beacon_water', mWater);
  for (const m of [beaconGlow, beaconRing, beaconFall]) m.parent = beaconRoot;
  beaconRoot.position.set(BEACON_C.x, HIDDEN_Y, BEACON_C.z);
  beaconRoot.setEnabled(false);

  // animated bits
  const sails = mk(sail, 'world_windmill_sails', mLit);
  sails.position.set(tOut.windmillHub[0], tOut.windmillHub[1], tOut.windmillHub[2]);
  sails.rotation.y = tOut.windmillYaw;
  const shipA = mk(shipKit.b, 'world_ship_a', mLit), shipAG = mk(shipKit.g, 'world_ship_glow', mGlow);
  const shipB = mk(ship2.b, 'world_ship_b', mLit);
  shipAG.parent = shipA;

  // beam from the lens to the sky above the Beacon
  const skyPoint = new Vector3(BEACON_C.x, 70, BEACON_C.z);
  const beamLen = Vector3.Distance(statueLens, skyPoint);
  const beam = MeshBuilder.CreateCylinder('world_beam', { height: beamLen, diameterTop: 2.4, diameterBottom: 0.3, tessellation: 8 }, scene);
  beam.bakeTransformIntoVertices(Matrix.Translation(0, beamLen / 2, 0));
  beam.material = mBeam; beam.isPickable = false; beam.setEnabled(false);
  beam.position.copyFrom(statueLens);
  {
    const d = skyPoint.subtract(statueLens).normalize();
    const axis = Vector3.Cross(Vector3.Up(), d).normalize();
    beam.rotationQuaternion = Quaternion.RotationAxis(axis, Math.acos(Vector3.Dot(Vector3.Up(), d)));
  }

  const walk = new Walk(tOut.obstacles);

  // ───── anchors ─────
  const v = (x: number, z: number, y?: number) => new Vector3(x, y ?? groveHeight(x, z), z);
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
    beaconDock: { pos: new Vector3(BEACON_C.x + BEACON_U.x * (B_DOCK_START + 3), B_DOCK_Y, BEACON_C.z + BEACON_U.z * (B_DOCK_START + 3)), facing: towardBeacon },
    arenaGate: { pos: new Vector3(gate.x, BEACON_TOP, gate.z), facing: towardBeacon },
    arenaCenter: { pos: new Vector3(ARENA_C.x, ARENA_Y, ARENA_C.z), facing: towardBeacon + Math.PI },
    arenaExit: { pos: new Vector3(exitP.x, BEACON_TOP, exitP.z), facing: yawTo(exitP.x, exitP.z, BEACON_C.x + BEACON_U.x * 40, BEACON_C.z + BEACON_U.z * 40) },
  };
  const spawns: Vector3[] = [];
  for (const [u, s] of [[28, -5], [27, 6], [22, -9], [21, 2], [16, 8], [15, -6], [11, -10], [10, 10]]) { const p = bu(u, s); spawns.push(new Vector3(p.x, BEACON_TOP, p.z)); }

  // ───── quality ─────
  let shadow: ShadowGenerator | null = null;
  let glow: GlowLayer | null = null;
  const casters: AbstractMesh[] = [mTown, mStatue, mProps, beaconRoot];
  const setQuality = (q: Quality) => {
    mCloudB.setEnabled(q !== 'low');
    mProps.setEnabled(q !== 'low');
    mVistaGlow.setEnabled(q !== 'low');
    if (q === 'low') { shadow?.dispose(); shadow = null; }
    else {
      const size = q === 'high' ? 2048 : 1024;
      if (!shadow || shadow.getShadowMap()?.getSize().width !== size) {
        shadow?.dispose();
        shadow = new ShadowGenerator(size, sun);
        shadow.usePercentageCloserFiltering = true;
        shadow.filteringQuality = q === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW;
        shadow.bias = 0.002; shadow.normalBias = 0.02; shadow.darkness = 0.35;
        for (const c of casters) shadow.addShadowCaster(c, false);
        sun.autoCalcShadowZBounds = true;
        for (const m of [mTown, mStatue, mProps, beaconRoot, beaconRing]) m.receiveShadows = true;
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
  sun.shadowMinZ = 1; sun.shadowMaxZ = 260;
  setQuality('med');

  // ───── runtime ─────
  let time = 0;
  let raised = false;
  let rise: { t: number; resolve: () => void } | null = null;
  let phase: 1 | 2 | 3 = 1;
  const baseSun = sun.diffuse.clone(), baseHemi = hemi.diffuse.clone(), baseInt = sun.intensity;

  const api: WorldApi = {
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
    setQuality,
    update: (dt) => {
      time += dt;
      sails.rotation.z = time * 0.6;
      const pa = vistaShipPath(time, 0), pb = vistaShipPath(time, 1);
      shipA.position.set(pa.x, pa.y, pa.z); shipA.rotation.y = pa.yaw;
      shipB.position.set(pb.x, pb.y, pb.z); shipB.rotation.y = pb.yaw;
      if (rise) {
        rise.t += dt;
        const t = Math.min(1, rise.t / RISE_TIME);
        const e = t * t * (3 - 2 * t);
        beaconRoot.position.y = HIDDEN_Y * (1 - e) + Math.sin(t * Math.PI) * 1.5 * (1 - t);
        mBeam.alpha = Math.min(1, rise.t * 2) * (t < 0.85 ? 0.85 : 0.85 * (1 - (t - 0.85) / 0.15));
        beam.scaling.set(1, Math.min(1, rise.t * 1.5), 1);
        if (t >= 1) {
          beaconRoot.position.y = 0; beam.setEnabled(false);
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

function C3ToRgb(h: string): [number, number, number] { return hex(h); }
