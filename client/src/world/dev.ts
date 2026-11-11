// Dev harness for the world: free camera + debug keys. Open /dev/world.html.
// Keys: B raise Beacon, 1/2/3 arena phase, G walkability overlay, L/M/H quality.
// URL: ?cam=alpha,beta,radius,tx,ty,tz&q=low|med|high&beacon=1&phase=2&grid=1
import { SceneInstrumentation, TransformNode, MeshBuilder, Engine, Scene, ArcRotateCamera, Vector3, Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core';
import { buildWorld } from './index';
import type { Quality } from '../core/contracts';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
if (new URLSearchParams(location.search).get('phone')) engine.setHardwareScalingLevel(1 / 1.5);
const scene = new Scene(engine);
const world = buildWorld(scene);
const instr = new SceneInstrumentation(scene); instr.captureFrameTime = false;
const qs = new URLSearchParams(location.search);

const start = world.anchor('playerStart');
const cam = new ArcRotateCamera('devcam', -Math.PI / 2, 1.08, 20, start.pos.add(new Vector3(0, 1, 0)), scene);
cam.minZ = 0.3; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20; cam.panningSensibility = 60;
cam.attachControl(canvas, true);
const c = qs.get('cam');
if (c) { const [a, b, r, x, y, z] = c.split(',').map(Number); cam.alpha = a; cam.beta = b; cam.radius = r; cam.target.set(x, y, z); }
if (qs.get('fov')) cam.fov = Number(qs.get('fov'));

let q: Quality = (qs.get('q') as Quality) || 'med';
world.setQuality(q);
world.attachCamera(cam);
// stand-in character at the camera target (to check shadows + occlusion fade)
{
  const root = new TransformNode('devplayer', scene);
  const body = MeshBuilder.CreateCapsule('devbody', { height: 1.7, radius: 0.32 }, scene); body.parent = root; body.position.y = 0.85;
  const bm = new StandardMaterial('devbm', scene); bm.diffuseColor = new Color3(0.9, 0.35, 0.25); body.material = bm;
  const t = cam.target; root.position.set(t.x, world.groundAt(t.x, t.z) ?? 0, t.z);
  world.addShadowCaster(root);
}

let overlay: Mesh | null = null;
function toggleGrid() {
  if (overlay) { overlay.dispose(); overlay = null; return; }
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const add = (x0: number, x1: number, z0: number, z1: number) => {
    for (let x = x0; x < x1; x += 1) for (let z = z0; z < z1; z += 1) {
      const h = world.groundAt(x + 0.5, z + 0.5);
      const y = h === null ? 0.3 : h + 0.12; const ok = h !== null;
      if (!ok && Math.hypot(x, z) > 112) continue;
      const n = pos.length / 3; const s = 0.42;
      pos.push(x + 0.5 - s, y, z + 0.5 - s, x + 0.5 + s, y, z + 0.5 - s, x + 0.5 + s, y, z + 0.5 + s, x + 0.5 - s, y, z + 0.5 + s);
      for (let i = 0; i < 4; i++) col.push(ok ? 0.1 : 1, ok ? 0.9 : 0.1, 0.2, 1);
      idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
    }
  };
  add(-116, 116, -116, 116);
  if (world.beaconRaised) { const c = world.anchor('arenaCenter').pos; add(Math.round(c.x) - 45, Math.round(c.x) + 45, Math.round(c.z) - 45, Math.round(c.z) + 45); }
  overlay = new Mesh('grid', scene);
  const vd = new VertexData(); vd.positions = pos; vd.colors = col; vd.indices = idx; vd.applyToMesh(overlay);
  const m = new StandardMaterial('gridm', scene); m.disableLighting = true; m.emissiveColor = new Color3(1, 1, 1); m.alpha = 0.55; m.backFaceCulling = false;
  overlay.material = m;
}

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (k === 'b') world.raiseBeacon().then(() => console.log('beacon raised'));
  if (k === '1' || k === '2' || k === '3') world.setArenaPhase(Number(k) as 1 | 2 | 3);
  if (k === 'g') toggleGrid();
  if (k === 'l' || k === 'm' || k === 'h') { q = k === 'l' ? 'low' : k === 'm' ? 'med' : 'high'; world.setQuality(q); }
});

const info = document.getElementById('info')!;
let fastForward = 0;
if (qs.get('beacon')) { world.raiseBeacon(); fastForward = Number(qs.get('beacon')) || 9; }
if (qs.get('phase')) world.setArenaPhase(Number(qs.get('phase')) as 1 | 2 | 3);
if (qs.get('grid')) setTimeout(toggleGrid, fastForward ? 50 : 0);
let frames = 0;
engine.runRenderLoop(() => {
  const dt = engine.getDeltaTime() / 1000;
  if (fastForward > 0) { for (let i = 0; i < fastForward * 10; i++) world.update(0.1); fastForward = 0; }
  world.update(Math.min(dt, 0.1));
  scene.render();
  if (++frames % 15 === 0) {
    const active = scene.getActiveMeshes();
    let tris = 0; for (let i = 0; i < active.length; i++) tris += active.data[i].getTotalIndices() / 3;
    const st = { fps: Math.round(engine.getFps()), draws: instr.drawCallsCounter.current, activeMeshes: active.length, tris: Math.round(tris), q };
    (window as any).__stats = st;
    info.textContent = `fps ${st.fps}  meshes ${st.activeMeshes}  tris ${st.tris}  q ${q}\nB beacon  1/2/3 phase  G grid  L/M/H quality\ncam ${cam.alpha.toFixed(2)},${cam.beta.toFixed(2)},${cam.radius.toFixed(1)},${cam.target.x.toFixed(1)},${cam.target.y.toFixed(1)},${cam.target.z.toFixed(1)}`;
  }
  (window as any).__frames = frames;
});
(window as any).__world = world;
(window as any).__totals = () => { let t = 0; for (const m of scene.meshes) if (m.isEnabled() && m.name !== 'grid') t += m.getTotalIndices() / 3; return { meshes: scene.meshes.filter(m => m.isEnabled()).length, tris: Math.round(t) }; };
(window as any).__scene = scene;
window.addEventListener('resize', () => engine.resize());
