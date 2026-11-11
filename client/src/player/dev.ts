// Dev harness for characters + player rig (dev/player.html). Not used by the game.
// URL params: ?view=lineup (fixed camera on the line-up), ?pose=run (freeze all line-up poses),
//             ?only=player,npc (filter line-up kinds)
import {
  Engine, Scene, Vector3, Color3, Color4, HemisphericLight, DirectionalLight, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';
import type { WorldApi, Pose, CharacterView, TapInfo, EntityKind } from '../core/contracts';
import { PALETTE } from '../core/contracts';
import { makeCharacter } from './character';
import { createPlayerRig } from './rig';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString(PALETTE.sky + 'ff');
scene.ambientColor = new Color3(0.6, 0.55, 0.6);

const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.1), scene);
hemi.intensity = 0.6;
hemi.diffuse = Color3.FromHexString(PALETTE.cloud);
hemi.groundColor = Color3.FromHexString(PALETTE.rock).scale(0.9);
const sun = new DirectionalLight('sun', new Vector3(-0.5, -1, 0.6), scene);
sun.intensity = 0.7;
sun.diffuse = Color3.FromHexString(PALETTE.horizon);

// ── fake world: flat disc island radius 30, a few box obstacles, a ramp ──
const R = 30;
const ground = MeshBuilder.CreateDisc('ground', { radius: R, tessellation: 48 }, scene);
ground.rotation.x = Math.PI / 2;
const gm = new StandardMaterial('gm', scene); gm.diffuseColor = Color3.FromHexString(PALETTE.meadow); gm.specularColor = Color3.Black();
ground.material = gm;
const plaza = MeshBuilder.CreateDisc('plaza', { radius: 9, tessellation: 32 }, scene);
plaza.rotation.x = Math.PI / 2; plaza.position.y = 0.01;
const pm = new StandardMaterial('pm', scene); pm.diffuseColor = Color3.FromHexString(PALETTE.stone); pm.specularColor = Color3.Black();
plaza.material = pm;
const boxes = [
  { x: -8, z: -6, w: 4, d: 3 }, { x: 6, z: -10, w: 3, d: 6 }, { x: -14, z: 6, w: 5, d: 2 },
];
const bm = new StandardMaterial('bm', scene); bm.diffuseColor = Color3.FromHexString(PALETTE.roof); bm.specularColor = Color3.Black();
for (const b of boxes) {
  const m = MeshBuilder.CreateBox('obst', { width: b.w, depth: b.d, height: 2.5 }, scene);
  m.position.set(b.x, 1.25, b.z); m.material = bm;
}
// ramp up to a platform: x 14..20 rises 0..1.5, platform 20..26 at 1.5, z -4..4
const rampH = (x: number) => (x < 14 ? 0 : x < 20 ? ((x - 14) / 6) * 1.5 : 1.5);
const ramp = MeshBuilder.CreateBox('ramp', { width: 12, depth: 8, height: 0.2 }, scene);
const rm = new StandardMaterial('rm', scene); rm.diffuseColor = Color3.FromHexString(PALETTE.teal); rm.specularColor = Color3.Black();
ramp.material = rm; ramp.position.set(20, 0.75, 0); ramp.rotation.z = Math.atan2(1.5, 12);

const world: WorldApi = {
  groundAt(x, z) {
    if (x * x + z * z > R * R) return null;
    for (const b of boxes) if (Math.abs(x - b.x) < b.w / 2 + 0.35 && Math.abs(z - b.z) < b.d / 2 + 0.35) return null;
    if (Math.abs(z) < 4 && x > 14) return rampH(x);
    return 0;
  },
  anchor() { return { pos: new Vector3(0, 0, 0), facing: 0 }; },
  enemySpawns() { return []; },
  raiseBeacon() { return Promise.resolve(); },
  beaconRaised: false,
  setArenaPhase() {},
  statueLens: new Vector3(0, 5, 0),
  setQuality() {},
  update() {},
};

// ── line-up ──
type Spec = { kind: EntityKind | 'npc'; color?: string; label: string };
let specs: Spec[] = [
  { kind: 'player', label: 'player' },
  { kind: 'companion', label: 'Wren' },
  { kind: 'npc', label: 'elder' },
  { kind: 'npc', color: PALETTE.roof, label: 'npc roof' },
  { kind: 'npc', color: PALETTE.sky, label: 'npc sky' },
  { kind: 'npc', color: PALETTE.meadow, label: 'npc meadow' },
  { kind: 'npc', color: PALETTE.cliff, label: 'npc cliff' },
  { kind: 'npc', color: PALETTE.gold, label: 'npc gold' },
  { kind: 'grunt', label: 'grunt' },
  { kind: 'archer', label: 'archer' },
  { kind: 'brute', label: 'brute' },
  { kind: 'warden', label: 'warden' },
];
const only = params.get('only');
if (only) specs = specs.filter((s) => only.split(',').includes(s.kind));
const chars: { spec: Spec; view: CharacterView }[] = [];
let xCursor = -((specs.length - 1) * 1.6) / 2;
specs.forEach((spec, i) => {
  const view = makeCharacter(scene, { kind: spec.kind, color: spec.color });
  const w = spec.kind === 'warden' ? 3.5 : spec.kind === 'brute' ? 2.4 : 1.6;
  xCursor += i === 0 ? 0 : w / 2;
  view.root.position.set(xCursor, 0, 12);
  xCursor += w / 2;
  view.root.rotation.y = Math.PI; // face the default camera (-Z)
  view.setEntityId(100 + i);
  chars.push({ spec, view });
});

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
rig.teleport(new Vector3(0, 0, 0), 0);

if (params.get('view') === 'lineup') {
  rig.setCinematic(true);
  const cam = rig.camera;
  cam.target.set(0, 1.4, 12);
  cam.alpha = -Math.PI / 2; cam.beta = 1.35; cam.radius = 17;
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
  const p = rig.position;
  info.textContent = `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}  facing ${rig.facing.toFixed(2)}  moving ${rig.moving}\n` +
    `cam a ${rig.camera.alpha.toFixed(2)} b ${rig.camera.beta.toFixed(2)} r ${rig.camera.radius.toFixed(1)}  pose ${fixedPose ?? pose}\n` +
    `taps ${taps.length} last ${JSON.stringify(taps[taps.length - 1] ?? null, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}  active meshes ${scene.getActiveMeshes().length}`;
});
engine.runRenderLoop(() => scene.render());
window.addEventListener('resize', () => engine.resize());

(window as unknown as { __dev: unknown }).__dev = {
  scene, engine, rig, chars, taps, joy, world,
  get frames() { return frames; },
  setPose: (p: Pose) => applyAll(p),
  /** Show every line-up character at time t into pose p, then hold still. */
  freezeAt(p: Pose, t: number) {
    paused = true;
    for (const c of chars) { c.view.setPose('idle'); c.view.update(1); c.view.setPose(p); for (let k = 0; k < Math.round(t / 0.02); k++) c.view.update(0.02); }
  },
  resume() { paused = false; },
  cam(alpha: number, beta: number, radius: number, x: number, y: number, z: number) {
    rig.setCinematic(true);
    rig.camera.alpha = alpha; rig.camera.beta = beta; rig.camera.radius = radius; rig.camera.target.set(x, y, z);
  },
};
