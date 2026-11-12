// buildWorld: Shady Grove (town, grove, statue) in its valley, with the final stylised look:
// painted materials, cascaded shadows, graded post, shader sky + river, grass, wind and life.
import {
  Vector3, Color3, Color4, StandardMaterial, DirectionalLight, HemisphericLight,
  Scene, MeshBuilder, DynamicTexture, type Mesh, type AbstractMesh, type ArcRotateCamera, type TransformNode,
} from '@babylonjs/core';
import type { BuildWorld, WorldApi, AnchorName, Anchor, Quality } from '../core/contracts';
import { ARENA_RADIUS } from '../core/contracts';
import { Builder, hex, type V3 } from './mesh';
import { Kit, windmillSails, CHIMNEYS } from './parts';
import { buildCountryside } from './countryside';
import { buildTown, onPath } from './town';
import { buildStatue, buildPlaque } from './statue';
import { createShaderSky, SUN_DIR, HAZE } from './sky';
import { buildArenaClearing, buildSkyIsland } from './beacon';
import { WorldFxPlugin, WFX, type WfxOpts } from './shading';
import { createRiver } from './water';
import { buildGrass } from './grass';
import { createLife, createCloudBank, dotTex } from './life';
import { createReveal } from './reveal';
import { createLook } from './look';
import {
  createGroveWalk, groundHeight, BEACON_DIR, BEACON_C, BEACON_U, BEACON_PERP, ARENA_C, ARENA_Y, BEACON_TOP, B_DOCK_U, B_DOCK_Y, SKY_ISLAND,
  DOCK_START, DOCK_LEN, DOCK_Y, PLAZA_R, ROAD_X0, roadZ, bandR,
} from './layout';

const C3 = (h: string) => { const c = hex(h); return new Color3(c[0], c[1], c[2]); };
const HIDDEN_Y = -110;
const RISE_TIME = 8;

export const buildWorld: BuildWorld = (scene: Scene): WorldApi => {
  CHIMNEYS.length = 0;
  // ───── atmosphere ─────
  const fogCol = C3(HAZE);
  scene.clearColor = new Color4(fogCol.r, fogCol.g, fogCol.b, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = fogCol;
  scene.fogStart = 60; scene.fogEnd = 1300;
  scene.ambientColor = new Color3(0, 0, 0);

  const sunDir = new Vector3(-SUN_DIR[0], -SUN_DIR[1], -SUN_DIR[2]);
  const sun = new DirectionalLight('world_sun', sunDir, scene);
  sun.diffuse = C3('#ffd9a8'); sun.specular = C3('#ffe7c4'); sun.intensity = 1.0;
  sun.position = new Vector3(SUN_DIR[0] * 120, SUN_DIR[1] * 120, SUN_DIR[2] * 120);
  const hemi = new HemisphericLight('world_fill', new Vector3(0.15, 1, 0.25), scene);
  hemi.diffuse = C3('#b9cdf2'); hemi.groundColor = C3('#9c8a8a'); hemi.specular = new Color3(0, 0, 0); hemi.intensity = 0.62;

  // ───── materials ─────
  const litMat = (name: string, fx: WfxOpts | null, emissive = 0) => {
    const m = new StandardMaterial(name, scene);
    m.diffuseColor = new Color3(1, 1, 1); m.specularColor = new Color3(0, 0, 0);
    m.emissiveColor = new Color3(emissive, emissive, emissive);
    if (fx) new WorldFxPlugin(m, fx);
    return m;
  };
  const mLit = litMat('world_lit', { noise: 0.2, rim: 0.22, cloudShadow: 0.16, fade: true, wind: true });
  const mTerrainMat = litMat('world_terrainmat', { noise: 0.34, cloudShadow: 0.18 }); mTerrainMat.diffuseColor = new Color3(0.93, 0.9, 0.78);
  const mGrass = litMat('world_grassmat', { noise: 0.25, cloudShadow: 0.18, wind: true }); mGrass.backFaceCulling = false; mGrass.diffuseColor = new Color3(0.94, 0.91, 0.8);
  const mCountry = litMat('world_countrymat', { noise: 0.22, cloudShadow: 0.18, wind: true });
  const mStatueMat = litMat('world_statuemat', { noise: 0.32, rim: 0.16, cloudShadow: 0.12 });
  mStatueMat.specularColor = C3('#2a251d'); mStatueMat.specularPower = 14; mStatueMat.diffuseColor = new Color3(0.93, 0.91, 0.88);
  const mBronze = litMat('world_bronzemat', { noise: 0.25, rim: 0.4 }); mBronze.specularColor = C3('#c8a060'); mBronze.specularPower = 40;
  const mGlow = new StandardMaterial('world_glow', scene);
  mGlow.disableLighting = true; mGlow.emissiveColor = new Color3(1, 1, 1);
  new WorldFxPlugin(mGlow, { flicker: true });
  const mFar = litMat('world_far', { noise: 0.15, rim: 0.3 }); mFar.fogEnabled = false; mFar.diffuseColor = new Color3(0.72, 0.74, 0.8); mFar.emissiveColor = C3('#6b5a66');
  const mFarGlow = new StandardMaterial('world_far_glow', scene); mFarGlow.disableLighting = true; mFarGlow.emissiveColor = new Color3(1, 1, 1); mFarGlow.fogEnabled = false;
  const mFarWater = litMat('world_far_water', null, 0.7); mFarWater.diffuseColor = new Color3(0.35, 0.35, 0.35); mFarWater.fogEnabled = false;
  const mMountMat = litMat('world_mount', { noise: 0.12 }); mMountMat.fogEnabled = false; mMountMat.diffuseColor = new Color3(0.42, 0.42, 0.46); mMountMat.emissiveColor = C3('#8d8aa0');

  // ───── build geometry ─────
  const aoGround = (p: V3) => { const h = p[1] - groundHeight(p[0], p[2]); return h > 0 && h < 0.09 ? 1 : 1 - 0.3 * Math.exp(-Math.max(0, h) / 0.55); };
  const town = new Kit(new Builder(11), new Builder(12));
  const props = new Kit(new Builder(13), town.g);
  town.b.aoFn = aoGround; props.b.aoFn = aoGround;
  const tOut = buildTown(town, props);
  town.b.aoFn = null; props.b.aoFn = null;
  const statueB = new Builder(21), bronzeB = new Builder(22);
  statueB.cj = 0.012; bronzeB.cj = 0.02;
  const lensArr = buildStatue(statueB, town.g, 0, 0.04, 0, bronzeB);
  statueB.smoothNormals(40); bronzeB.smoothNormals(40);
  const statueLens = new Vector3(lensArr[0], lensArr[1], lensArr[2]);

  const terrainB = new Builder(31);
  const band = new Kit(new Builder(32), town.g);
  band.b.aoFn = aoGround;
  const far = new Kit(new Builder(33), new Builder(34));
  const riverDummy = new Builder(35), mount = new Builder(36);
  buildCountryside(terrainB, band, far, riverDummy, mount);
  band.b.aoFn = null;

  const arenaB = new Builder(61), ringB = new Builder(63);
  buildArenaClearing(arenaB, ringB);
  const isl = new Kit(new Builder(65), new Builder(66)), islWater = new Builder(67);
  buildSkyIsland(isl, islWater);
  const sail = new Builder(71); windmillSails(sail);

  // Built from the baked copy of tOut/cOut obstacles that the server shares (see world/obstacles.test.ts).
  const walk = createGroveWalk();

  // grass: tier A (med+high) and tier B (high only)
  const gOk = (x: number, z: number) => {
    const r = Math.hypot(x, z); if (r < PLAZA_R + 0.6 || r > bandR(Math.atan2(z, x)) - 1.5) return false;
    if (onPath(x, z, 0.35)) return false;
    if (x > ROAD_X0 - 1 && Math.abs(z - roadZ(x)) < 2.9) return false;
    return walk.groundAt(x, z) !== null;
  };
  const sampleNear = (b: Builder) => (): [number, number] => {
    const rr = b.rng.next() < 0.72 ? Math.sqrt(b.rng.next()) * 58 : 58 + b.rng.next() * 44; const a = b.rng.r(0, 6.283);
    return [Math.cos(a) * rr, Math.sin(a) * rr];
  };
  const grassA = new Builder(81), grassB = new Builder(82);
  buildGrass(grassA, 4200, groundHeight, gOk, sampleNear(grassA));
  buildGrass(grassB, 7000, groundHeight, gOk, sampleNear(grassB));

  // soft volumes: smooth across shallow angles (canopies, hills), keep hard architectural edges
  for (const b of [town.b, props.b, band.b, far.b]) b.smoothNormals(62);
  terrainB.smoothNormals(40);
  const mk = (b: Builder, name: string, mat: StandardMaterial) => b.build(scene, name, mat);
  const mTerrain = mk(terrainB, 'world_terrain', mTerrainMat);
  const mTown = mk(town.b, 'world_town', mLit);
  const mProps = mk(props.b, 'world_props', mLit);
  const mStatue = mk(statueB, 'world_statue', mStatueMat);
  const mBronzeM = mk(bronzeB, 'world_statue_bronze', mBronze);
  const plaque = buildPlaque(scene, 0, 0.04, 0);
  const mBand = mk(band.b, 'world_band', mLit);
  const mTownGlow = mk(town.g, 'world_town_glow', mGlow);
  const mFarM = mk(far.b, 'world_country', mCountry);
  const mFarGlowM = mk(far.g, 'world_country_glow', mGlow);
  const mMount = mk(mount, 'world_mountains', mMountMat);
  const mArena = mk(arenaB, 'world_arena', mLit);
  const beaconRing = mk(ringB, 'world_arena_ring', mLit);
  const mGrassA = mk(grassA, 'world_grass_a', mGrass);
  const mGrassB = mk(grassB, 'world_grass_b', mGrass);
  const statics: Mesh[] = [mMount, mTerrain, mTown, mProps, mStatue, mBronzeM, mBand, mTownGlow, mFarM, mFarGlowM, mArena, beaconRing, mGrassA, mGrassB];
  for (const m of statics) { m.freezeWorldMatrix(); m.doNotSyncBoundingInfo = true; }
  for (const m of [mMount, mFarM, mTerrain]) m.isPickable = false;

  const islandPos = new Vector3(BEACON_DIR.x * SKY_ISLAND.dist, SKY_ISLAND.y, BEACON_DIR.z * SKY_ISLAND.dist);
  const sky = createShaderSky(scene, islandPos.subtract(new Vector3(0, 10, 0)));
  const river = createRiver(scene, scene.fogStart, scene.fogEnd, fogCol, new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]));

  // the floating Beacon in the sky (hidden until raiseBeacon)
  const beaconRoot = mk(isl.b, 'world_beacon', mFar);
  const beaconGlow = mk(isl.g, 'world_beacon_glow', mFarGlow);
  const beaconFall = mk(islWater, 'world_beacon_water', mFarWater);
  for (const m of [beaconGlow, beaconFall]) m.parent = beaconRoot;
  beaconRoot.position.copyFrom(islandPos).addInPlace(new Vector3(0, HIDDEN_Y, 0));
  beaconRoot.setEnabled(false); beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = 0;
  const bankYaw = Math.atan2(BEACON_DIR.x, BEACON_DIR.z);
  const bankSide = new Vector3(Math.cos(bankYaw), 0, -Math.sin(bankYaw));
  const bank = createCloudBank(scene, islandPos, bankSide, SKY_ISLAND.r);
  const dot = dotTex(scene);
  const reveal = createReveal(scene, statueLens, islandPos, new Vector3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]), dot);

  // animated bits
  const sails = mk(sail, 'world_windmill_sails', mLit);
  sails.position.set(tOut.windmillHub[0], tOut.windmillHub[1], tOut.windmillHub[2]);
  sails.rotation.y = tOut.windmillYaw;
  const life = createLife(scene, CHIMNEYS.map(c => new Vector3(c[0], c[1], c[2])));

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

  // ───── quality: shadows, glow, post (world/look.ts) ─────
  let quality: Quality = 'med';
  let cam: ArcRotateCamera | null = null;
  const casters: AbstractMesh[] = [mTown, mStatue, mBronzeM, mProps, mBand];
  const receivers: Mesh[] = [mTerrain, mTown, mStatue, mBronzeM, mProps, mBand, mGrassA, mGrassB];
  const look = createLook(scene, {
    prefix: 'world', sun, casters, receivers,
    shadow: { high: { maxZ: 170, cascades: 3, size: 2048 }, med: { maxZ: 110, cascades: 2, size: 1024 } },
    glowMeshes: () => [mTownGlow, mFarGlowM, beaconGlow, ...reveal.beamMeshes],
    glowColor: (mesh, result) => { if (reveal.beamMeshes.includes(mesh as Mesh)) result.set(1, 0.8, 0.4, 1); else result.set(1, 0.72, 0.36, 1); },
  });
  // blob shadows for characters on 'low' (no shadow maps there)
  const blobTex = new DynamicTexture('world_blob', { width: 64, height: 64 }, scene, false);
  { const g = blobTex.getContext() as unknown as CanvasRenderingContext2D; const r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, 'rgba(40,30,60,0.55)'); r.addColorStop(1, 'rgba(40,30,60,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); blobTex.hasAlpha = true; blobTex.update(); }
  const blobMat = new StandardMaterial('world_blobmat', scene); blobMat.diffuseTexture = blobTex; blobMat.useAlphaFromDiffuseTexture = true; blobMat.disableLighting = true; blobMat.emissiveColor = new Color3(1, 1, 1); blobMat.zOffset = -2;
  const blobs: { root: TransformNode; disc: Mesh }[] = [];
  const setQuality = (q: Quality) => {
    quality = q;
    mProps.setEnabled(q !== 'low');
    mFarGlowM.setEnabled(q !== 'low');
    mGrassA.setEnabled(q !== 'low');
    mGrassB.setEnabled(q === 'high');
    sky.setOctaves(q === 'low' ? 3 : q === 'med' ? 4 : 5);
    life.setLevel(q);
    for (const b of blobs) b.disc.setEnabled(q === 'low');
    look.setQuality(q);
  };
  setQuality('med');

  // ───── runtime ─────
  let time = 0;
  let raised = false;
  let afterRaise = -1;
  let rise: { t: number; resolve: () => void } | null = null;
  let phase: 1 | 2 | 3 = 1;
  const baseSun = sun.diffuse.clone(), baseHemi = hemi.diffuse.clone(), baseInt = sun.intensity;
  const tmpTarget = new Vector3();

  const api: WorldApi = {
    addShadowCaster: (root: TransformNode) => {
      for (const m of root.getChildMeshes(false)) {
        if (casters.includes(m)) continue;
        casters.push(m);
        look.addCaster(m);
      }
      if (!blobs.some(b => b.root === root)) {
        const disc = MeshBuilder.CreateGround('world_blob_' + blobs.length, { width: 1.3, height: 1.3 }, scene);
        disc.material = blobMat; disc.isPickable = false; disc.setEnabled(quality === 'low');
        blobs.push({ root, disc });
      }
    },
    attachCamera: (c: ArcRotateCamera) => { cam = c; look.attachCamera(c); },
    groundAt: (x, z) => walk.groundAt(x, z),
    surfaceAt: (x, z) => walk.surfaceAt(x, z),
    anchor: (name) => { const a = anchors[name]; return { pos: a.pos.clone(), facing: a.facing }; },
    enemySpawns: () => spawns.map(p => p.clone()),
    raiseBeacon: () => {
      if (raised) return Promise.resolve();
      if (rise) return new Promise(res => { const r0 = rise!.resolve; rise!.resolve = () => { r0(); res(); }; });
      beaconRoot.setEnabled(true);
      return new Promise<void>(resolve => { rise = { t: 0, resolve }; });
    },
    get beaconRaised() { return raised; },
    setArenaPhase: (p) => {
      phase = p;
      walk.arenaRadius = ARENA_RADIUS[p];
      beaconRing.setEnabled(p === 1);
      if (p === 3) { sun.diffuse = C3('#c9a6d8'); sun.intensity = baseInt * 0.7; hemi.diffuse = C3('#7d86b8'); scene.fogColor = C3('#9a8fb2'); sky.setStorm(1); }
      else { sun.diffuse = baseSun.clone(); sun.intensity = baseInt; hemi.diffuse = baseHemi.clone(); scene.fogColor = fogCol; sky.setStorm(0); }
    },
    statueLens,
    setQuality,
    update: (dt) => {
      time += dt;
      look.update();
      WFX.time = time;
      WFX.wind = 0.8 + 0.2 * Math.sin(time * 0.31);
      const ac = cam ?? (scene.activeCamera as ArcRotateCamera | null);
      if (ac && (ac as ArcRotateCamera).target) { tmpTarget.copyFrom((ac as ArcRotateCamera).target); WFX.target.copyFrom(tmpTarget); WFX.fadeRadius = 3.2; }
      const camPos = scene.activeCamera?.globalPosition ?? Vector3.Zero();
      sky.update(time);
      river.update(time, camPos, phase === 3 ? 1 : 0);
      life.update(dt, time, WFX.target);
      sails.rotation.z = time * 0.6;
      for (const b of blobs) { const p = b.root.position; b.disc.position.set(p.x, (walk.surfaceAt(p.x, p.z) ?? p.y) + 0.04, p.z); }
      if (rise) {
        rise.t += dt;
        const t = Math.min(1, rise.t / RISE_TIME);
        const part = Math.min(1, t / 0.6); const pe = part * part * (3 - 2 * part);
        bank.set(pe, 1 - 0.85 * pe);
        sky.setReveal(pe);
        const it = Math.max(0, Math.min(1, (t - 0.25) / 0.75)); const ie = it * it * (3 - 2 * it);
        beaconRoot.position.y = islandPos.y + HIDDEN_Y * (1 - ie);
        const vis = Math.min(1, it * 1.6);
        beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = vis;
        reveal.update(time, t, -1, camPos);
        if (t >= 1) {
          beaconRoot.position.y = islandPos.y;
          beaconRoot.visibility = beaconGlow.visibility = beaconFall.visibility = 1;
          raised = true; walk.beaconUp = true; afterRaise = 0;
          const r = rise; rise = null; r.resolve();
        }
      } else {
        if (afterRaise >= 0) afterRaise += dt;
        bank.set(raised ? 1 : 0, raised ? 0.15 : 1);
        reveal.update(time, null, afterRaise, camPos);
      }
    },
  };
  void plaque;
  return api;
};
