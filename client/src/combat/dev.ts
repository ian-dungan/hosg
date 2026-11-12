// Viewer for the enemy models (dev/enemies.html, under `npm run dev`; not part of any build). The models stand on
// the Greenway's road in its real light, seen from the gameplay camera distance.
// URL:
//   ?view=lineup   (default) back row: the five kinds; front row: each wind-up (the Mossback has two)
//   ?view=camp&camp=N   every camp's enemies at their spawns, the camera on camp N as in play
//   ?view=entry    the same enemies, the camera where play starts (for draw-call counts)
//   &t=0.25        freeze the wind-ups this many seconds in (otherwise they loop: wind-up, strike, rest)
//   &mode=idle|run|stunned|dead|hit   what the back row (or the camp) does;   &q=low|med|high;   &cam=alpha,beta,radius
//   &rock=N        look at the layout's rock N up close
import { Engine, Scene, ArcRotateCamera, Vector3, Matrix, SceneInstrumentation } from '@babylonjs/core';
import { ENEMY_ATTACKS, greenwayLayout, type EnemyAttackId, type EnemyKindId } from '@sg2/shared';
import type { Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { makeEnemy, enemyStats, type EnemyMode, type EnemyView } from './enemies';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const world = buildGreenway(scene);
const layout = greenwayLayout();
const instr = new SceneInstrumentation(scene);
instr.captureFrameTime = true;

interface Actor { view: EnemyView; attack: EnemyAttackId | null; label: string; windup: boolean; tris: number }
const actors: Actor[] = [];
const place = (kind: EnemyKindId, x: number, z: number, facing: number, attack: EnemyAttackId | null, windup: boolean, label: string) => {
  const view = makeEnemy(scene, kind);
  view.root.position.set(x, world.groundAt(x, z) ?? layout.height(x, z), z);
  view.root.rotation.y = facing;
  world.addShadowCaster(view.root);
  actors.push({ view, attack, label, windup, tris: enemyStats.lastTriangles });
  return view;
};

const view = qs.get('view') ?? 'lineup';
const backMode = (qs.get('mode') ?? 'idle') as EnemyMode | 'hit';
let target: Vector3;
let alpha = Math.PI / 2, beta = (62 * Math.PI) / 180, radius = 20;
if (view === 'entry') {
  // play's opening view: every camp's enemies at their spawns, the camera behind an adventurer at the entry
  layout.camps.forEach((c) => c.spawns.forEach((s) => place(s.kind, s.x, s.z, s.facing, null, false, s.kind)));
  const e = layout.entry;
  target = new Vector3(e.x, layout.height(e.x, e.z) + 1.8, e.z);
  alpha = Math.atan2(-Math.cos(e.facing), -Math.sin(e.facing));
} else if (view === 'camp') {
  layout.camps.forEach((c) => c.spawns.forEach((s) => place(s.kind, s.x, s.z, s.facing, null, false, s.kind)));
  const c = layout.camps[Number(qs.get('camp') ?? 0)];
  target = new Vector3(c.x, layout.height(c.x, c.z) + 1.2, c.z);
  // look at the camp from the road, as an adventurer arriving would
  alpha = Math.atan2(layout.roadZ(c.x) - c.z, 0);
} else {
  const x0 = 34, zc = layout.roadZ(40);
  const kinds: EnemyKindId[] = ['thornling', 'boar', 'archer', 'mossback', 'dummy'];
  const gap = [0, 3.2, 6.6, 10.8, 15.2];
  kinds.forEach((k, i) => place(k, x0 + gap[i], zc - 6, 0, null, false, k));
  const wind: [EnemyKindId, EnemyAttackId | null, string][] = [['thornling', 'thorn_burst', 'Thorn Burst'], ['boar', 'gore_charge', 'Gore Charge'], ['archer', 'briar_volley', 'Briar Volley'], ['mossback', 'ground_slam', 'Ground Slam'], ['mossback', 'thorn_hail', 'Thorn Hail'], ['dummy', null, 'hit']];
  const gap2 = [-1.2, 2.0, 5.4, 9.2, 14.6, 19.0];
  wind.forEach(([k, atk, label], i) => place(k, x0 + gap2[i], zc + 2.6, 0, atk, true, label));
  target = new Vector3(x0 + 8.5, 1.4, zc - 1.5);
  radius = 22; beta = 0.95;
}
const cam = new ArcRotateCamera('enemycam', alpha, beta, radius, target, scene);
cam.minZ = 0.3; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
// ?rock=N looks at layout rock N instead (to check the rocks up close)
const rockQ = qs.get('rock');
if (rockQ !== null) { const r = layout.rocks[Number(rockQ)]; cam.target.set(r.x, layout.height(r.x, r.z) + 1, r.z); cam.radius = 9; }
const camQ = qs.get('cam');
if (camQ) { const [a, b, r] = camQ.split(',').map(Number); cam.alpha = a; cam.beta = b; cam.radius = r; }
world.attachCamera(cam);
world.setQuality((qs.get('q') as Quality) || 'high');

// labels
const labels = actors.map((a) => { const d = document.createElement('div'); d.className = 'lbl'; d.textContent = a.label; document.body.appendChild(d); return d; });

// back row / camp mode
const applyBack = (a: Actor) => {
  if (backMode === 'hit') { a.view.hit(); a.view.flash(); return; }
  a.view.setMode(backMode as EnemyMode);
};
for (const a of actors) if (!a.windup) applyBack(a);

const tFixed = qs.get('t');
const step = (dt: number) => { for (const a of actors) a.view.update(dt); world.update(dt); };
const startWindups = () => { for (const a of actors) if (a.windup) { if (a.attack) a.view.setMode('windup', a.attack); else { a.view.hit(); a.view.flash(); } } };
let cycle = 0;
if (tFixed !== null) {
  startWindups();
  for (let t = 0; t < Number(tFixed); t += 1 / 60) step(1 / 60);
} else startWindups();

const info = document.getElementById('info')!;
let frames = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.1, engine.getDeltaTime() / 1000);
  if (tFixed === null) {
    cycle += dt;
    for (const a of actors) {
      if (!a.windup || !a.attack) continue;
      const w = ENEMY_ATTACKS[a.attack].windup;
      if (cycle >= w && cycle - dt < w) { a.view.strike(); a.view.setMode('idle'); }
    }
    if (cycle > 3.2) { cycle = 0; startWindups(); for (const a of actors) if (!a.windup && backMode === 'hit') applyBack(a); }
    step(dt);
  } else world.update(0);
  scene.render();
  // labels under the feet
  const w = canvas.clientWidth, h = canvas.clientHeight, vp = cam.viewport.toGlobal(w, h);
  actors.forEach((a, i) => {
    const q = Vector3.Project(a.view.root.position, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    labels[i].style.left = `${q.x}px`; labels[i].style.top = `${q.y + 6}px`;
    labels[i].style.display = view === 'lineup' ? '' : 'none';
  });
  if (++frames % 10 === 0) {
    const each = actors.map((a) => `${a.label} ${a.tris}`).join(', ');
    const act = scene.getActiveMeshes();
    let tris = 0; for (let i = 0; i < act.length; i++) tris += act.data[i].getTotalIndices() / 3;
    info.textContent = `${view}  q=${qs.get('q') || 'high'}  fps ${engine.getFps().toFixed(0)}  draw calls ${instr.drawCallsCounter.current}  active meshes ${act.length}  active triangles ${Math.round(tris)}\nmeshes ${scene.meshes.length}  materials ${scene.materials.length}  textures ${scene.textures.length}\nenemy triangles: ${each}`;
  }
});
window.addEventListener('resize', () => engine.resize());
(window as unknown as Record<string, unknown>).__enemies = { scene, engine, actors, instr, cam };
