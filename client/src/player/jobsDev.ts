// Viewer for the job looks and the spell visuals (dev/jobs.html, under `npm run dev`; not part of any build). The
// adventurers stand on the Greenway's road in its real light, seen from the gameplay camera's distance.
// URL:
//   ?view=lineup  (default) the seven jobs side by side, in JOB_IDS order
//       &pose=drawn|sheathed|attack|cast|run   (default drawn)
//   ?view=spells  every spell, support and reaction visual in a grid of cells (caster → Thornling), replayed in a loop
//       &only=blast,conduct   just these cells (a row)
//   ?view=crowd&n=20  n adventurers of every job casting at four Thornlings (draw-call budgets; n=0 for the bare scene)
//   &nospells=1   draw no spell visuals (to count what they add)
//   &q=low|med|high   the quality tier (spell particle caps follow it);   &cam=alpha,beta,radius
// window.__jobs: { at(t) } replays every cell's visual and holds it t seconds in (for screenshots), and counters.
import { Engine, Scene, ArcRotateCamera, Vector3, Matrix, SceneInstrumentation } from '@babylonjs/core';
import { JOBS, JOB_IDS, greenwayLayout, type JobId } from '@sg2/shared';
import type { CharacterView, Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { makeEnemy, type EnemyView } from '../combat/enemies';
import { createSpells, staffTint, type Tone, type VisualKind, type VisualSpec } from '../combat/spells';
import { makeCharacter, characterStats, capeFor } from './character';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const world = buildGreenway(scene);
const layout = greenwayLayout();
const instr = new SceneInstrumentation(scene);
const quality = ((qs.get('q') as Quality) || 'med');
const view = qs.get('view') ?? 'lineup';
const noSpells = qs.has('nospells');
const x0 = 30, zc = layout.roadZ(40);
const ground = (x: number, z: number) => world.groundAt(x, z) ?? layout.height(x, z);

// ── who stands where (engine-id style: adventurers 1.., enemies 1000..) ──
const heroes = new Map<number, CharacterView>();
const foes = new Map<number, EnemyView>();
const labels: { el: HTMLElement; at: Vector3 }[] = [];
const label = (text: string, at: Vector3) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.appendChild(el); labels.push({ el, at }); };
const hero = (id: number, job: JobId, x: number, z: number, facing: number) => {
  const v = makeCharacter(scene, { kind: 'player' });
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = facing;
  v.setWeapon(JOBS[job].weapon, staffTint(job));
  v.setCape(capeFor(job));
  world.addShadowCaster(v.root);
  heroes.set(id, v);
  return v;
};
const foe = (id: number, x: number, z: number, facing: number) => {
  const v = makeEnemy(scene, 'thornling');
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = facing;
  world.addShadowCaster(v.root);
  foes.set(id, v);
  return v;
};

const spells = createSpells(scene, {
  quality: () => quality,
  locate(eid, out) {
    const v = heroes.get(eid) ?? foes.get(eid);
    if (!v) return false;
    out.x = v.root.position.x; out.y = v.root.position.y; out.z = v.root.position.z; out.h = v.height;
    return true;
  },
});

// ── the line-up ──
const pose = qs.get('pose') ?? 'drawn';
let target = new Vector3(x0 + 5, 1.2, zc);
let alpha = Math.PI / 2 + 0.25, beta = 1.2, radius = 13;
interface Cell { kind: VisualKind | `cast:${Tone}` | 'marks'; caster: number; dst: number; job: JobId; label: string; extra?: Partial<VisualSpec>; every: number }
const cells: Cell[] = [];
if (view === 'lineup') {
  JOB_IDS.forEach((j, i) => {
    const v = hero(1 + i, j, x0 + i * 1.7, zc, 0);
    label(JOBS[j].name, v.root.position);
    if (pose !== 'sheathed') { v.setPose('attack'); for (let k = 0; k < 60; k++) v.update(1 / 60); }
    if (pose === 'run') v.setPose('run');
    if (pose === 'cast') v.setCasting(true);
    console.log(`${j} triangles ${characterStats.lastTriangles}`);
  });
  target = new Vector3(x0 + 5.1, 1.1, zc); alpha = Math.PI / 2 + 0.0; beta = 1.38; radius = 11.5;
  const at = qs.get('at');   // &at=N: close on job N
  if (at !== null) { target = new Vector3(x0 + Number(at) * 1.7, ground(x0 + Number(at) * 1.7, zc) + 1.0, zc); radius = 4.5; }
} else if (view === 'crowd') {
  // n adventurers in a loose crowd (every job), all casting, each firing its element at one of four Thornlings
  const n = Number(qs.get('n') ?? 20);
  const tones: VisualKind[] = ['fire', 'water', 'lightning', 'earth', 'light'];
  for (let k = 0; k < 4; k++) foe(1000 + k, x0 + 4 + k * 2.5, zc + 6, Math.PI);
  for (let i = 0; i < n; i++) {
    const job = JOB_IDS[i % JOB_IDS.length];
    hero(1 + i, job, x0 + (i % 5) * 2.2, zc - 2 - Math.floor(i / 5) * 2.2, 0);
    cells.push({ kind: i % 3 === 0 ? (`cast:${['fire', 'water', 'lightning', 'earth', 'light'][i % 5]}` as Cell['kind']) : tones[i % 5], caster: 1 + i, dst: 1000 + (i % 4), job, label: '', every: 1.2 + (i % 4) * 0.2 });
  }
  target = new Vector3(x0 + 5, 1, zc); alpha = -Math.PI / 2; beta = 1.05; radius = 20;
} else {
  const all: Omit<Cell, 'caster' | 'dst'>[] = [
    { kind: 'fire', job: 'black_mage', label: 'Fire · Cinder Dart', every: 1.6, extra: { ability: 'cinder_dart' } },
    { kind: 'fire', job: 'black_mage', label: 'Fire · Hearthfall', every: 2, extra: { ability: 'hearthfall', big: true } },
    { kind: 'water', job: 'white_mage', label: 'Water · Tidelash', every: 1.6, extra: { ability: 'tidelash' } },
    { kind: 'lightning', job: 'black_mage', label: 'Lightning · Skyfall Arc', every: 1.4, extra: { ability: 'skyfall_arc', big: true } },
    { kind: 'earth', job: 'black_mage', label: 'Earth · Rootbreak', every: 1.6, extra: { ability: 'rootbreak' } },
    { kind: 'light', job: 'white_mage', label: 'Light · Lantern Flare', every: 1.4, extra: { ability: 'lantern_flare', big: true } },
    { kind: 'blast', job: 'black_mage', label: 'Blast (fire + Marked)', every: 2 },
    { kind: 'conduct', job: 'black_mage', label: 'Conduct (lightning + Soaked)', every: 2 },
    { kind: 'steam', job: 'white_mage', label: 'Steam (water + Burning)', every: 2 },
    { kind: 'bedrock', job: 'black_mage', label: 'Bedrock (earth + Dazed)', every: 2 },
    { kind: 'heal', job: 'white_mage', label: 'Heal', every: 1.5, extra: { big: true } },
    { kind: 'shield', job: 'white_mage', label: 'Shield (Mistveil)', every: 2 },
    { kind: 'revive', job: 'white_mage', label: 'Revive (Second Dawn)', every: 2.2 },
    { kind: 'roar', job: 'warrior', label: 'Rallying Roar', every: 1.6 },
    { kind: 'aegis', job: 'paladin', label: 'Aegis', every: 2 },
    { kind: 'sheltered', job: 'paladin', label: 'Shelter', every: 2 },
    { kind: 'taunt', job: 'paladin', label: 'Taunt', every: 1.4 },
    { kind: 'rain', job: 'white_mage', label: 'Soft Rain', every: 6 },
    { kind: 'mist', job: 'ninja', label: 'Mist Form', every: 1.6 },
    { kind: 'pact', job: 'dark_knight', label: 'Crimson Pact', every: 1.6 },
    { kind: 'gift', job: 'black_mage', label: 'Kindred Spark', every: 1.6 },
    { kind: 'blinded', job: 'ninja', label: 'Ashcloud · Blinded', every: 1.6 },
    { kind: 'weakpoint', job: 'ninja', label: 'Weak Point', every: 1.6 },
    { kind: 'staffBolt', job: 'white_mage', label: 'Staff auto (white)', every: 1, extra: { tint: 'white' } },
    { kind: 'staffBolt', job: 'black_mage', label: 'Staff auto (black)', every: 1, extra: { tint: 'black' } },
    { kind: 'cast:fire', job: 'black_mage', label: 'Casting · fire', every: 9 },
    { kind: 'cast:water', job: 'white_mage', label: 'Casting · water', every: 9 },
    { kind: 'cast:lightning', job: 'black_mage', label: 'Casting · lightning', every: 9 },
    { kind: 'cast:earth', job: 'black_mage', label: 'Casting · earth', every: 9 },
    { kind: 'cast:light', job: 'white_mage', label: 'Casting · light', every: 9 },
    { kind: 'marks', job: 'black_mage', label: 'Marks: Soaked Burning Rooted Dazed', every: 9 },
    { kind: 'fizzle', job: 'black_mage', label: 'Interrupted (fizzle)', every: 1.2 },
  ];
  const only = qs.get('only')?.split(',');
  const pick = only ? all.filter((c) => only.some((o) => c.label.toLowerCase().includes(o.toLowerCase()) || c.kind === o)) : all;
  const cols = only ? pick.length : 6;
  pick.forEach((c, i) => {
    const cx = x0 + (i % cols) * 8, cz = zc - 14 + Math.floor(i / cols) * 9;
    const caster = 1 + i, dst = 1000 + i;
    hero(caster, c.job, cx, cz - 2.2, 0);
    // a second adventurer stands in for ally-aimed visuals; a Thornling for the rest
    const allyKinds: string[] = ['heal', 'shield', 'revive', 'sheltered', 'gift', 'mist', 'pact'];
    if (allyKinds.includes(c.kind)) hero(dst, 'warrior', cx + 0.4, cz + 1.8, Math.PI);
    else foe(dst, cx, cz + 2.2, Math.PI);
    if (c.kind === 'revive') heroes.get(dst)!.setPose('dead');
    if (c.kind === 'bedrock') { hero(500 + i, 'paladin', cx - 2.2, cz - 0.5, 0.6); }
    label(c.label, new Vector3(cx, ground(cx, cz - 3.4), cz - 3.4));
    cells.push({ ...c, caster, dst });
  });
  const rows = Math.ceil(pick.length / cols);
  target = new Vector3(x0 + (cols - 1) * 4, 1, zc - 14 + (rows - 1) * 4.5);
  alpha = -Math.PI / 2; beta = 0.9; radius = only ? Math.max(14, cols * 6) : 62;
}
const cam = new ArcRotateCamera('jobscam', alpha, beta, radius, target, scene);
cam.minZ = 0.3; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
const camQ = qs.get('cam');
if (camQ) { const [a, b, r] = camQ.split(',').map(Number); cam.alpha = a; cam.beta = b; cam.radius = r; }
world.attachCamera(cam);
world.setQuality(quality);

// ── playing the cells ──
let clock = 0;
const timers = cells.map(() => 0);
const fire = (c: Cell) => {
  if (c.kind.startsWith('cast:') || c.kind === 'marks') return;
  const kind = c.kind as VisualKind;
  const self = kind === 'shield' || kind === 'revive' || kind === 'mist' || kind === 'pact' || kind === 'aegis' ? c.dst : -1;
  const src = kind === 'rain' || kind === 'roar' || kind === 'aegis' || kind === 'fizzle' ? c.caster : c.caster;
  const dst = kind === 'rain' || kind === 'roar' || kind === 'fizzle' ? c.caster : kind === 'aegis' ? c.caster : self >= 0 ? self : c.dst;
  heroes.get(c.caster)?.setPose(kind === 'heal' || kind === 'shield' || kind === 'revive' || kind === 'gift' ? 'cast' : 'attack');
  spells.play({ kind, src, dst, big: kind === 'revive' || ['blast', 'conduct', 'steam', 'bedrock'].includes(kind), ...c.extra, ...durOf(kind) });
  if (kind === 'bedrock') for (const id of [c.caster, 500 + cells.indexOf(c)]) spells.play({ kind: 'bedrockRing', src: id, dst: id, dur: 1.5 });
  if (kind === 'revive') window.setTimeout(() => heroes.get(c.dst)?.setPose('idle'), 1200);
};
const DURS: Partial<Record<VisualKind, number>> = { fire: 0.6, water: 0.6, lightning: 0.5, earth: 0.95, light: 0.55, heal: 1.1, shield: 0.45, roar: 0.75, aegis: 0.5, sheltered: 0.6, rain: 6, mist: 0.7, pact: 0.9, blinded: 0.8, weakpoint: 0.5, gift: 0.95, revive: 1.6, blast: 1.05, conduct: 1.5, steam: 1.5, bedrock: 1.05, taunt: 0.65, fizzle: 0.5, staffBolt: 0.3 };
const durOf = (k: VisualKind) => ({ dur: DURS[k] ?? 0.6 });
/** The lasting (state-driven) looks for a cell. */
const lasting = (c: Cell, t: number) => {
  const a = heroes.get(c.caster)!, p = a.root.position;
  if (c.kind.startsWith('cast:')) { a.setCasting(true); spells.caster(p.x, p.y, p.z, c.kind.slice(5) as Tone, t); }
  const d = heroes.get(c.dst) ?? foes.get(c.dst)!, q = d.root.position;
  if (c.kind === 'shield') spells.shield(q.x, q.y, q.z, d.height, t);
  if (c.kind === 'aegis') { spells.aegis(p.x, p.y, p.z, true, t); }
  if (c.kind === 'sheltered') spells.tether(p.x, p.y, p.z, q.x, q.y, q.z, t);
  if (c.kind === 'pact') spells.aura(q.x, q.y, q.z, d.height, 16 | 1, t);
  if (c.kind === 'marks') spells.enemy(q.x, q.y, q.z, d.height, 1 | 2 | 8 | 16, 0, t);
  if (c.kind === 'blinded') spells.enemy(q.x, q.y, q.z, d.height, 0, 1, t);
  if (c.kind === 'weakpoint') spells.enemy(q.x, q.y, q.z, d.height, 0, 2, t);
  if (c.kind === 'mist') heroes.get(c.dst)?.setFade(0.5);
};
let held = false;
const frame = (dt: number) => {
  clock += dt;
  if (!held) cells.forEach((c, i) => { timers[i] -= dt; if (timers[i] <= 0) { timers[i] = c.every; fire(c); } });
  for (const v of heroes.values()) v.update(dt);
  for (const v of foes.values()) v.update(dt);
  if (!noSpells) {
    spells.begin();
    for (const c of cells) lasting(c, clock);
    spells.update(dt);
  }
  world.update(dt);
};

const info = document.getElementById('info')!;
let frames = 0;
engine.runRenderLoop(() => {
  if (!held) frame(Math.min(0.1, engine.getDeltaTime() / 1000));
  scene.render();
  const w = canvas.clientWidth, h = canvas.clientHeight, vp = cam.viewport.toGlobal(w, h);
  for (const l of labels) {
    const q = Vector3.Project(l.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
    l.el.style.left = `${q.x}px`; l.el.style.top = `${q.y + 6}px`;
  }
  if (++frames % 10 === 0) {
    const act = scene.getActiveMeshes();
    let tris = 0; for (let i = 0; i < act.length; i++) tris += act.data[i].getTotalIndices() / 3;
    info.textContent = `${view}  q=${quality}  draw calls ${instr.drawCallsCounter.current}  active meshes ${act.length}  triangles ${Math.round(tris)}  spells live ${spells.live} drawn ${spells.drawn}`;
  }
});
window.addEventListener('resize', () => engine.resize());
(window as unknown as Record<string, unknown>).__jobs = {
  scene, engine, instr, cam, heroes, foes, spells,
  /** Replays every cell from its start and holds the frame `t` seconds in. */
  at(t: number) {
    held = true;
    spells.clear();
    cells.forEach((c) => fire(c));
    const n = Math.max(1, Math.round(t / (1 / 60)));
    for (let i = 0; i < n; i++) frame(t / n);
  },
  resume() { held = false; },
  hideUi() { info.style.display = 'none'; },
};
