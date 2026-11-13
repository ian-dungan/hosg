// Viewer for adventurer looks (dev/looks.html, under `npm run dev`; not part of any build): the four peoples, slider
// extremes, every hair style and face part, random and default looks, the seven jobs on one look, emotes, and a crowd
// for the triangle and draw-call budgets. Adventurers stand on the Greenway's road in its real light.
// URL:
//   ?view=peoples            the four peoples at every slider 10 (&back=1: from behind)
//   ?view=grid&n=16&seed=1   random looks (randomLook); &default=1: defaultLook('account-<i>') instead
//   ?view=slider&field=body.height   each people (rows) at 0, 10 and 20 of a body slider (columns)
//   ?view=pick&field=hair.style      every value of a picker (hair.style, hair.facial, face.*, fur.*, style.*)
//   ?view=jobs&seed=3        the seven jobs on one look (&pose=drawn|sheathed)
//   ?view=emotes&seed=3      the six emotes, held &t=0.7 s in
//   ?view=crowd&n=50         n random adventurers (budgets: triangles and draw calls at &q=low|med|high)
//   &q=low|med|high   &cam=alpha,beta,radius   &people=human|larchfolk|knollfolk|brindlekin (pin the people)
// window.__looks: { step(dt, n) advances every adventurer n steps; stats(): triangles and draw calls; ready }.
import { Engine, Scene, ArcRotateCamera, Matrix, Vector3, SceneInstrumentation } from '@babylonjs/core';
import {
  EMOTES, JOBS, JOB_IDS, LOOK_LIMITS, PEOPLES, PEOPLE_IDS, defaultLook, greenwayLayout, parseLook, randomLook, prng,
  type EmoteId, type Look as AdventurerLook, type PeopleId,
} from '@sg2/shared';
import type { CharacterView, Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { staffTint } from '../combat/spells';
import { makeCharacter, characterStats, capeFor, setCharacterDetail } from './character';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const world = buildGreenway(scene);
const layout = greenwayLayout();
const instr = new SceneInstrumentation(scene);
const quality = ((qs.get('q') as Quality) || 'med');
setCharacterDetail(quality);
const view = qs.get('view') ?? 'peoples';
const seed = Number(qs.get('seed') ?? 1);
const pinPeople = qs.get('people') as PeopleId | null;
const x0 = 30, zc = layout.roadZ(40) + 9;
const ground = (x: number, z: number) => world.groundAt(x, z) ?? layout.height(x, z);

const views: CharacterView[] = [];
const labels: { el: HTMLElement; at: Vector3 }[] = [];
const label = (text: string, at: Vector3) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.appendChild(el); labels.push({ el, at }); };
const tris: number[] = [];
const put = (look: AdventurerLook, x: number, z: number, facing: number, job: string | null = null, name = '') => {
  const v = makeCharacter(scene, { kind: 'player', look });
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = facing;
  if (job && Object.prototype.hasOwnProperty.call(JOBS, job)) { v.setWeapon(JOBS[job as keyof typeof JOBS].weapon, staffTint(job as keyof typeof JOBS)); v.setCape(capeFor(job)); }
  else v.setWeapon('none');
  world.addShadowCaster(v.root);
  views.push(v);
  tris.push(characterStats.lastActiveTriangles);
  if (name) label(name, new Vector3(x, ground(x, z) - 0.15, z + 0.9));
  return v;
};
/** A look with the people pinned (fur set or cleared to fit). */
const ofPeople = (l: AdventurerLook, p: PeopleId): AdventurerLook => {
  const fur = PEOPLES[p].furred ? l.fur ?? { pattern: 1, colour: 0x3a2a20, tail: 1 } : null;
  return parseLook({ ...l, people: p, fur, face: { ...l.face, ears: Math.min(l.face.ears, PEOPLES[p].earsMax) } })!;
};
const rnd = (i: number) => randomLook(prng(seed * 7919 + i * 104729));
const at10 = (l: AdventurerLook): AdventurerLook => ({ ...l, body: { height: 10, build: 10, shoulders: 10, hips: 10, legs: 10, head: 10 } });
const set = (l: AdventurerLook, path: string, v: number): AdventurerLook | null => {
  const [g, k] = path.split('.') as [keyof AdventurerLook, string];
  const grp = l[g];
  if (!grp || typeof grp !== 'object') return null;
  return parseLook({ ...l, [g]: { ...(grp as Record<string, number>), [k]: v } });
};
const facing = qs.has('back') ? 0 : Math.PI;   // the camera looks from −z toward +z… (front: facing the camera)
let target = new Vector3(x0, 1, zc), alpha = -Math.PI / 2, beta = 1.38, radius = 9;

if (view === 'peoples') {
  const base = rnd(0);
  PEOPLE_IDS.forEach((p, i) => {
    const l = at10(ofPeople({ ...base, hair: { style: [19, 6, 9, 3][i]!, facial: [0, 0, 3, 0][i]! }, face: { ...base.face, marks: 0, ears: [1, 2, 1, 0][i]! } }, p));
    put(l, x0 + (i - 1.5) * 1.25, zc, facing, null, PEOPLES[p].name);
  });
  target = new Vector3(x0, 1.0, zc); radius = 5.6;
} else if (view === 'grid') {
  const n = Number(qs.get('n') ?? 16), cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    let l = qs.has('default') ? defaultLook(`account-${i + seed}`) : rnd(i);
    if (pinPeople) l = ofPeople(l, pinPeople);
    const c = i % cols, r = Math.floor(i / cols);
    put(l, x0 + (c - (cols - 1) / 2) * 1.3, zc + r * 1.7, facing);
  }
  const rows = Math.ceil(n / cols);
  target = new Vector3(x0, 1.0, zc + (rows - 1) * 0.85); radius = 2.6 + cols * 2.0; beta = 1.22;
} else if (view === 'slider') {
  const field = qs.get('field') ?? 'body.height';
  PEOPLE_IDS.forEach((p, r) => {
    [0, 10, 20].forEach((v, c) => {
      const l = set(at10(ofPeople(rnd(r), p)), field, v)!;
      put(l, x0 + (r - 1.5) * 3.7 + (c - 1) * 1.05, zc, facing, null, String(v));
    });
    label(PEOPLES[p].name, new Vector3(x0 + (r - 1.5) * 3.7, ground(x0, zc) + 2.45, zc));
  });
  label(`${field}: 0 · 10 · 20`, new Vector3(x0, ground(x0, zc) - 0.45, zc - 0.6));
  target = new Vector3(x0, 1.05, zc); radius = 12.5; beta = 1.42;
} else if (view === 'pick') {
  const field = qs.get('field') ?? 'hair.style';
  const [lo, hi0] = LOOK_LIMITS[field]!;
  const p = pinPeople ?? (field.startsWith('fur') || field === 'face.ears' ? 'brindlekin' : 'human');
  const hi = field === 'face.ears' ? PEOPLES[p].earsMax : hi0;
  const n = hi - lo + 1, cols = Math.min(10, n);
  const base = at10(ofPeople(rnd(2), p));
  for (let v = lo; v <= hi; v++) {
    const i = v - lo, c = i % cols, r = Math.floor(i / cols);
    const l = set(base, field, v)!;
    put(l, x0 + (c - (cols - 1) / 2) * 1.25, zc + r * 2.4, field.startsWith('hair') ? (qs.has('back') ? 0 : Math.PI + 0.5) : facing, null, String(v));
  }
  const rows = Math.ceil(n / cols);
  target = new Vector3(x0, 1.3, zc + (rows - 1) * 1.2); radius = 2.5 + cols * 1.35; beta = 1.35;
} else if (view === 'jobs') {
  const l = pinPeople ? ofPeople(rnd(3), pinPeople) : rnd(3);
  JOB_IDS.forEach((j, i) => put(l, x0 + (i - 3) * 1.45, zc, facing, j, JOBS[j].name));
  target = new Vector3(x0, 1.1, zc); radius = 11.5;
} else if (view === 'emotes') {
  const l = pinPeople ? ofPeople(rnd(4), pinPeople) : rnd(4);
  EMOTES.forEach((e, i) => { put(l, x0 + (i - 2.5) * 1.6, zc, facing - 0.35, null, e); });
  target = new Vector3(x0, 1.0, zc); radius = 10;
} else if (view === 'crowd') {
  const n = Number(qs.get('n') ?? 50);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, r = 1.2 * Math.sqrt(i + 1);
    const job = JOB_IDS[i % JOB_IDS.length]!;
    put(rnd(i), x0 + Math.cos(a) * r, zc + 6 + Math.sin(a) * r, Math.random() * 6.28, job);
  }
  target = new Vector3(x0, 1, zc + 6); radius = 30; beta = 1.0;
}

const cam = new ArcRotateCamera('lookscam', alpha, beta, radius, target, scene);
cam.minZ = 0.2; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
const camQ = qs.get('cam');
if (camQ) { const [a, b, r] = camQ.split(',').map(Number); cam.alpha = a!; cam.beta = b!; cam.radius = r!; }
world.attachCamera(cam);
world.setQuality(quality);

let paused = qs.has('t');
const holdT = Number(qs.get('t') ?? 0.7);
const startEmotes = () => { if (view === 'emotes') views.forEach((v, i) => v.emote(EMOTES[i] as EmoteId)); };
startEmotes();
const step = (dt: number, n: number) => { for (let k = 0; k < n; k++) for (const v of views) v.update(dt); };
if (paused) step(holdT / 20, 20);
const info = document.getElementById('info')!;
let frame = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  if (!paused) for (const v of views) v.update(dt);
  world.update(dt);
  scene.render();
  if (++frame % 10 === 1) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of labels) {
      const p = Vector3.Project(l.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      l.el.style.left = `${p.x}px`; l.el.style.top = `${p.y}px`;
    }
    const mean = tris.length ? Math.round(tris.reduce((a, b) => a + b, 0) / tris.length) : 0;
    info.textContent = `${view}  q=${quality}  adventurers ${views.length}  tris/adventurer ${mean} (max ${Math.max(0, ...tris)})  draw calls ${instr.drawCallsCounter.current}  build ${characterStats.lastBuildMs.toFixed(1)} ms`;
  }
});
(window as unknown as Record<string, unknown>).__looks = {
  ready: true,
  step: (dt: number, n: number) => step(dt, n),
  pause: (on: boolean) => { paused = on; },
  stats: () => ({ adventurers: views.length, tris: [...tris], drawCalls: instr.drawCallsCounter.current, buildMs: characterStats.lastBuildMs }),
};
