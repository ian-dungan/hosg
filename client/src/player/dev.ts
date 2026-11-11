// Dev harness for characters + player rig (dev/player.html). Not used by the game.
// URL params:
//   ?world=real        use the real world module (lighting, shadows, post) instead of the flat test disc
//   ?view=lineup       fixed camera on the line-up
//   ?pose=run          freeze all line-up poses (otherwise they cycle)
//   ?only=player,npc   filter line-up kinds
//   ?q=low|med|high    world quality (real world only)
import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, MeshBuilder, StandardMaterial, ShadowGenerator,
  ImageProcessingConfiguration,
} from '@babylonjs/core';
import type { WorldApi, Pose, CharacterView, TapInfo, EntityKind, Quality } from '../core/contracts';
import { PALETTE } from '../core/contracts';
import { makeCharacter, characterStats } from './character';
import { createPlayerRig } from './rig';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);

// ── fake world: flat disc island radius 30, a few box obstacles, a ramp; lit like the real world ──
function fakeWorld(): WorldApi {
  const haze = Color3.FromHexString('#f2d9c2');
  scene.clearColor = new Color4(haze.r, haze.g, haze.b, 1);
  scene.ambientColor = new Color3(0, 0, 0);
  const toSun = new Vector3(-0.62, 0.52, -0.58).normalize();
  const sun = new DirectionalLight('sun', toSun.scale(-1), scene);
  sun.diffuse = Color3.FromHexString('#ffe2b8'); sun.intensity = 0.88; sun.specular = new Color3(0.3, 0.3, 0.3);
  sun.position = toSun.scale(40);
  const hemi = new HemisphericLight('hemi', new Vector3(0.1, 1, 0.2), scene);
  hemi.diffuse = Color3.FromHexString('#d2dcf2'); hemi.groundColor = Color3.FromHexString('#a7889f'); hemi.intensity = 0.78; hemi.specular = new Color3(0, 0, 0);
  const shadow = new ShadowGenerator(2048, sun);
  shadow.usePercentageCloserFiltering = true; shadow.bias = 0.004; shadow.normalBias = 0.025; shadow.darkness = 0.38;
  // same grading as src/world (tone mapping + curves + vignette)
  const c = scene.imageProcessingConfiguration;
  c.toneMappingEnabled = true; c.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  c.exposure = 1.08; c.contrast = 1.12; c.colorCurvesEnabled = true;
  const cc = c.colorCurves!; cc.globalSaturation = 14; cc.shadowsHue = 235; cc.shadowsDensity = 22; cc.shadowsSaturation = 20; cc.highlightsHue = 40; cc.highlightsDensity = 18; cc.highlightsSaturation = 15;
  c.vignetteEnabled = true; c.vignetteWeight = 1.25; c.vignetteStretch = 0.5; c.vignetteColor = new Color4(0.16, 0.1, 0.22, 0);
  const R = 30;
  const mat = (hexc: string) => { const m = new StandardMaterial('m' + hexc, scene); m.diffuseColor = Color3.FromHexString(hexc); m.specularColor = Color3.Black(); return m; };
  const ground = MeshBuilder.CreateDisc('ground', { radius: R, tessellation: 48 }, scene);
  ground.rotation.x = Math.PI / 2; ground.material = mat('#7fbf5a'); ground.receiveShadows = true;
  const plaza = MeshBuilder.CreateDisc('plaza', { radius: 9, tessellation: 32 }, scene);
  plaza.rotation.x = Math.PI / 2; plaza.position.y = 0.01; plaza.material = mat('#d9c8a8'); plaza.receiveShadows = true;
  const boxes = [{ x: -8, z: -6, w: 4, d: 3 }, { x: 6, z: -10, w: 3, d: 6 }, { x: -14, z: 6, w: 5, d: 2 }];
  for (const b of boxes) {
    const m = MeshBuilder.CreateBox('obst', { width: b.w, depth: b.d, height: 2.5 }, scene);
    m.position.set(b.x, 1.25, b.z); m.material = mat(PALETTE.roof); shadow.addShadowCaster(m); m.receiveShadows = true;
  }
  const rampH = (x: number) => (x < 14 ? 0 : x < 20 ? ((x - 14) / 6) * 1.5 : 1.5);
  const ramp = MeshBuilder.CreateBox('ramp', { width: 12, depth: 8, height: 0.2 }, scene);
  ramp.material = mat(PALETTE.teal); ramp.position.set(20, 0.75, 0); ramp.rotation.z = Math.atan2(1.5, 12);
  return {
    groundAt(x, z) {
      if (x * x + z * z > R * R) return null;
      for (const b of boxes) if (Math.abs(x - b.x) < b.w / 2 + 0.35 && Math.abs(z - b.z) < b.d / 2 + 0.35) return null;
      if (Math.abs(z) < 4 && x > 14) return rampH(x);
      return 0;
    },
    surfaceAt(x, z) { return this.groundAt(x, z); },
    anchor() { return { pos: new Vector3(0, 0, 0), facing: 0 }; },
    enemySpawns() { return []; },
    raiseBeacon() { return Promise.resolve(); },
    beaconRaised: false,
    setArenaPhase() {},
    statueLens: new Vector3(0, 5, 0),
    setQuality() {},
    addShadowCaster(root) { for (const m of root.getChildMeshes(false)) shadow.addShadowCaster(m, false); },
    attachCamera() {},
    update() {},
  };
}

const useReal = params.get('world') === 'real';
let world: WorldApi;
if (useReal) {
  // not statically analysable on purpose: keeps src/world out of this page's reload graph unless asked for
  const path = '../world/' + 'index';
  const mod = (await import(/* @vite-ignore */ path)) as { buildWorld: (s: Scene) => WorldApi };
  world = mod.buildWorld(scene);
  const q = params.get('q') as Quality | null;
  if (q) world.setQuality(q);
} else world = fakeWorld();

// ── line-up ──
type Spec = { kind: EntityKind | 'npc'; color?: string; label: string };
let specs: Spec[] = [
  { kind: 'player', label: 'player' },
  { kind: 'npc', label: 'Marrow' },
  { kind: 'npc', color: PALETTE.teal, label: 'Tamsin' },
  { kind: 'npc', color: PALETTE.roof, label: 'Bram' },
  { kind: 'companion', label: 'Wren' },
  { kind: 'npc', color: PALETTE.sky, label: 'npc sky' },
  { kind: 'npc', color: PALETTE.meadow, label: 'npc meadow' },
  { kind: 'npc', color: PALETTE.cliff, label: 'npc cliff' },
  { kind: 'npc', color: PALETTE.gold, label: 'npc gold' },
  { kind: 'npc', color: PALETTE.rock, label: 'npc rock' },
  { kind: 'grunt', label: 'grunt' },
  { kind: 'archer', label: 'archer' },
  { kind: 'brute', label: 'brute' },
  { kind: 'warden', label: 'warden' },
];
const only = params.get('only');
if (only) specs = specs.filter((s) => only.split(',').includes(s.kind) || only.split(',').includes(s.label));
const start = useReal ? world.anchor('playerStart') : { pos: new Vector3(0, 0, 0), facing: 0 };
const fwd = new Vector3(Math.sin(start.facing), 0, Math.cos(start.facing));
const right = new Vector3(fwd.z, 0, -fwd.x);
const lineC = start.pos.add(fwd.scale(useReal ? 5 : 12));
const chars: { spec: Spec; view: CharacterView; tris: number }[] = [];
let xCursor = -((specs.length - 1) * 1.5) / 2;
specs.forEach((spec, i) => {
  const view = makeCharacter(scene, { kind: spec.kind, color: spec.color });
  const tris = characterStats.lastTriangles;
  const w = spec.kind === 'warden' ? 3.5 : spec.kind === 'brute' ? 2.4 : 1.5;
  xCursor += i === 0 ? 0 : w / 2;
  const p = lineC.add(right.scale(xCursor));
  p.y = world.groundAt(p.x, p.z) ?? lineC.y;
  view.root.position.copyFrom(p);
  xCursor += w / 2;
  view.root.rotation.y = start.facing + Math.PI; // face back toward the start / default camera
  view.setEntityId(100 + i);
  world.addShadowCaster(view.root);
  chars.push({ spec, view, tris });
});
console.log('triangles per character: ' + chars.map((c) => `${c.spec.label}=${c.tris}`).join(' '));

const POSES: Pose[] = ['idle', 'run', 'attack', 'cast', 'hit', 'staggered', 'parry', 'charge', 'dead'];
const fixedPose = params.get('pose') as Pose | null;
let poseIdx = 0, poseClock = 0;
const applyAll = (p: Pose) => chars.forEach((c) => c.view.setPose(p));
if (fixedPose) applyAll(fixedPose);

// ── rig ──
const joy = { x: 0, y: 0 };
// A minimal stand-in for the HUD joystick (a DOM element over the canvas, like the real HUD).
{
  const pad = document.createElement('div');
  pad.id = 'joypad';
  pad.style.cssText = 'position:fixed;left:20px;bottom:20px;width:140px;height:140px;border-radius:50%;background:#fff3;border:2px solid #fff8;touch-action:none;';
  const knob = document.createElement('div');
  knob.style.cssText = 'position:absolute;left:45px;top:45px;width:50px;height:50px;border-radius:50%;background:#fffc;pointer-events:none;';
  pad.appendChild(knob); document.body.appendChild(pad);
  let pid = -1;
  const upd = (e: PointerEvent) => {
    const r = pad.getBoundingClientRect();
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), y = -(e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    joy.x = x; joy.y = y;
    knob.style.transform = `translate(${x * 45}px, ${-y * 45}px)`;
  };
  pad.addEventListener('pointerdown', (e) => { pid = e.pointerId; pad.setPointerCapture(e.pointerId); upd(e); });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) upd(e); });
  const end = (e: PointerEvent) => { if (e.pointerId !== pid) return; pid = -1; joy.x = joy.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
}
const taps: TapInfo[] = [];
const info = document.getElementById('info')!;
const rig = createPlayerRig(scene, {
  canvas, world,
  joystick: () => joy,
  onTap: (t) => {
    taps.push(t);
    for (const c of chars) c.view.setTargeted(false);
    const hit = chars.find((_, i) => 100 + i === t.entityId);
    hit?.view.setTargeted(true);
  },
});
scene.activeCamera = rig.camera;
world.addShadowCaster(rig.view.root);
world.attachCamera(rig.camera);
rig.teleport(start.pos.clone(), start.facing);
window.addEventListener('keydown', (e) => { if (e.code === 'Space') rig.jump(); });

if (params.get('view') === 'lineup') {
  rig.setCinematic(true);
  const cam = rig.camera;
  cam.target.copyFrom(lineC).addInPlaceFromFloats(0, 1.2, 0);
  cam.alpha = Math.atan2(-fwd.z, -fwd.x); cam.beta = 1.35; cam.radius = 17;
}

let frames = 0;
let paused = false;
let pose: Pose = 'idle';
scene.onBeforeRenderObservable.add(() => {
  const dt = engine.getDeltaTime() / 1000;
  frames++;
  if (!fixedPose) {
    poseClock += dt;
    if (poseClock > 2) { poseClock = 0; poseIdx = (poseIdx + 1) % POSES.length; pose = POSES[poseIdx]; applyAll(pose); }
  }
  if (!paused) for (const c of chars) c.view.update(dt);
  rig.update(dt);
  world.update(dt);
  const p = rig.position;
  info.textContent = `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  facing ${rig.facing.toFixed(2)}  moving ${rig.moving}\n` +
    `cam a ${rig.camera.alpha.toFixed(2)} b ${rig.camera.beta.toFixed(2)} r ${rig.camera.radius.toFixed(1)}  pose ${fixedPose ?? pose}\n` +
    `taps ${taps.length}  active meshes ${scene.getActiveMeshes().length}`;
});
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());

(window as unknown as { __dev: unknown }).__dev = {
  scene, engine, rig, chars, taps, joy, world, lineC, fwd, right,
  get frames() { return frames; },
  setPose: (p: Pose) => applyAll(p),
  /** Show every line-up character at time t into pose p, then hold still. */
  freezeAt(p: Pose, t: number) {
    paused = true;
    for (const c of chars) { c.view.setPose('idle'); c.view.update(1); c.view.setPose(p); for (let k = 0; k < Math.round(t / 0.02); k++) c.view.update(0.02); }
  },
  /** Advance the line-up by t seconds of animation in small steps, then hold. */
  advance(t: number) { paused = true; for (const c of chars) for (let k = 0; k < Math.round(t / 0.02); k++) c.view.update(0.02); },
  resume() { paused = false; },
  hideUi() { info.style.display = 'none'; document.getElementById('joypad')?.style.setProperty('display', 'none'); },
  /** Camera relative to the line-up centre: (offset along line, height of target, yaw from front, beta, radius). */
  look(along: number, ty: number, yaw: number, beta: number, radius: number) {
    rig.setCinematic(true);
    const t = lineC.add(right.scale(along)); t.y += ty;
    rig.camera.target.copyFrom(t);
    const a = Math.atan2(-fwd.z, -fwd.x) + yaw;
    rig.camera.alpha = a; rig.camera.beta = beta; rig.camera.radius = radius;
  },
  cam(alpha: number, beta: number, radius: number, x: number, y: number, z: number) {
    rig.setCinematic(true);
    rig.camera.alpha = alpha; rig.camera.beta = beta; rig.camera.radius = radius; rig.camera.target.set(x, y, z);
  },
};
