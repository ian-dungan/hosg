// Viewer for Look v2 adventurers (dev/looks.html, under `npm run dev`; not part of any build). By default a plain
// studio (fast, even light, for contact sheets); &world=1 stands them on the Greenway's road in its real light.
// URL:
//   ?view=bodies                 male and female at every slider's middle, front and side
//   ?view=peoples                the four peoples × two bodies
//   ?view=grid&n=24&seed=1       random looks (randomLook)
//   ?view=slider&field=build.height   one look at the field's low, middle and high (&close=1: the faces)
//   ?view=pick&field=hair.style&from=0&to=10   every value of a field (&side=1 from the side, &back=1 from behind)
//   ?view=lineup                 the five likeness people (&close=1: their faces)
//   ?view=presets&from=0&to=12   the presets
//   ?view=jobs&body=male|female  the seven jobs in their gear on one body (&gear=1: each job's starter gear)
//   ?view=poses                  walk, run, attack, cast, hurt and dead
//   ?view=emotes                 the six emotes, held &t=0.7 s in
//   ?view=crowd&n=50&q=low       n random adventurers (budgets: triangles and draw calls)
//   &q=low|med|high   &cam=alpha,beta,radius   &people=…  &body=male|female
// window.__looks: { ready, frames, step(dt, n), stats() }.
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Matrix, MeshBuilder, Scene, SceneInstrumentation, StandardMaterial, Vector3 } from '@babylonjs/core';
import {
  EMOTES, JOBS, JOB_IDS, LOOK_LIMITS, LOOK_PRESETS, PEOPLES, PEOPLE_IDS, greenwayLayout, parseLook, prng, randomLook,
  type BodyType, type EmoteId, type JobId, type Look, type PeopleId,
} from '@sg2/shared';
import type { CharacterView, Pose, Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { staffTint } from '../combat/spells';
import { makeCharacter, characterStats, capeFor, characterDev, setCharacterDetail, setGearBuilder } from './character';
import { gearHooks, kitGear } from './gearModels';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const useWorld = qs.get('world') === '1';
const layout = greenwayLayout();
const world = useWorld ? buildGreenway(scene) : null;
if (!world) {
  scene.clearColor = new Color4(0.78, 0.8, 0.84, 1);
  scene.ambientColor = new Color3(0.5, 0.5, 0.55);
  const hemi = new HemisphericLight('h', new Vector3(0.1, 1, -0.4), scene);
  hemi.intensity = 0.72; hemi.diffuse = new Color3(1, 0.97, 0.92); hemi.groundColor = new Color3(0.42, 0.4, 0.48);
  const key = new DirectionalLight('k', new Vector3(-0.45, -0.75, 0.55), scene);
  key.intensity = 0.85; key.diffuse = new Color3(1, 0.93, 0.84);
  const g = MeshBuilder.CreateGround('g', { width: 80, height: 80 }, scene);
  const gm = new StandardMaterial('gm', scene); gm.diffuseColor = new Color3(0.62, 0.62, 0.6); gm.specularColor = Color3.Black(); g.material = gm;
}
const instr = new SceneInstrumentation(scene);
const quality = ((qs.get('q') as Quality) || 'high');
characterDev.plain = qs.get('plain') === '1';
if (qs.has('farm')) characterDev.farM = Number(qs.get('farm'));   // &farm=0: every adventurer far (the far build); &farm=999: never
setCharacterDetail(quality);
if (qs.get('gear') === '1') setGearBuilder(gearHooks);
const view = qs.get('view') ?? 'bodies';
const seed = Number(qs.get('seed') ?? 1);
const pinPeople = qs.get('people') as PeopleId | null;
const pinBody = qs.get('body') as BodyType | null;
const x0 = useWorld ? 30 : 0, zc = useWorld ? layout.roadZ(40) + 9 : 0;
const ground = (x: number, z: number) => (world ? world.groundAt(x, z) ?? layout.height(x, z) : 0);

const views: CharacterView[] = [];
const labels: { el: HTMLElement; at: Vector3 }[] = [];
const label = (text: string, at: Vector3) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.appendChild(el); labels.push({ el, at }); };
const tris: number[] = [];
const put = (look: Look, x: number, z: number, facing: number, job: JobId | null = null, name = '') => {
  const gear = job && qs.get('gear') === '1' ? kitGear(Number(qs.get('tier') ?? 0) as 0, job) : null;
  const v = makeCharacter(scene, { kind: 'player', look, gear });
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = facing;
  v.update(0); // (it was made at the origin: placed, not moved there)
  if (job) { v.setWeapon(JOBS[job].weapon, staffTint(job)); v.setCape(capeFor(job)); }
  else v.setWeapon('none');
  world?.addShadowCaster(v.root);
  views.push(v);
  tris.push(characterStats.lastActiveTriangles);
  if (name) label(name, new Vector3(x, ground(x, z) - 0.12, z));
  return v;
};
const mid = (l: Look): Look => {
  const o = JSON.parse(JSON.stringify(l)) as Record<string, Record<string, number>>;
  for (const k of Object.keys(o.build!)) o.build![k] = 10;
  for (const g of ['face', 'eyes', 'brows', 'nose', 'mouth'] as const) for (const k of Object.keys(o[g]!)) if (typeof o[g]![k] === 'number' && !['shape', 'age'].includes(k) && !k.startsWith('colour')) o[g]![k] = 5;
  o.ears!.size = 5; o.ears!.angle = 5;
  return parseLook(o)!;
};
/** A look with the people (and body) pinned: fur set or cleared to fit, ears within the people's. */
const ofPeople = (l: Look, p: PeopleId, body?: BodyType): Look => {
  const fur = PEOPLES[p].furred ? l.fur ?? { pattern: 1, colour: 0x3a2a20, tail: 1, muzzle: 3 } : null;
  return parseLook({ ...l, people: p, body: body ?? l.body, fur, ears: { ...l.ears, style: Math.min(l.ears.style, PEOPLES[p].earsMax) } })!;
};
const rnd = (i: number) => randomLook(prng(seed * 7919 + i * 104729));
const set = (l: Look, path: string, v: number | null): Look | null => {
  const [g, k] = path.split('.') as [keyof Look, string];
  const grp = l[g];
  if (!grp || typeof grp !== 'object') return null;
  return parseLook({ ...l, [g]: { ...(grp as Record<string, number>), [k]: v } });
};
const tweak = (l: Look, o: Record<string, Record<string, unknown> | string>): Look => {
  const out: Record<string, unknown> = { ...l };
  for (const [g, v] of Object.entries(o)) out[g] = typeof v === 'object' ? { ...(l as unknown as Record<string, object>)[g], ...v } : v;
  const r = parseLook(out);
  if (!r) throw new Error(`looksDev: bad tweak ${JSON.stringify(o)}`);
  return r;
};
const preset = (id: string) => LOOK_PRESETS.find((p) => p.id === id)!.look;
const front = qs.has('back') ? 0 : qs.has('side') ? Math.PI / 2 : Math.PI;   // the camera looks from −z: Math.PI faces it
let target = new Vector3(x0, 1, zc), alpha = -Math.PI / 2, beta = 1.45, radius = 9;
/** When set, the camera's distance frames this width and height (m) round the target. */
let fitW = 0, fitH = 0;
const close = qs.get('close') === '1';

/** The five likeness test people (the brief's: built only from presets and sliders). */
export const LINEUP: { name: string; look: Look }[] = [
  { name: 'Older, heavy-set, bearded', look: tweak(mid(preset('harbour_pilot')), {
    build: { height: 10, weight: 18, waist: 17, chest: 13, muscle: 9, neck: 13, shoulders: 12 }, face: { age: 4, width: 7, jawWidth: 7, cheekbones: 4, chinLength: 4 },
    hair: { style: 22, hairline: 3, colour: 0x4a3a30, grey: 3, facial: 3, facialColour: 0x5a4a40 }, brows: { shape: 6, thickness: 8, tilt: 4 },
    eyes: { shape: 8, size: 4, colour: 0x3b2416, openness: 4 }, nose: { length: 6, width: 8, bridge: 4, tip: 3 }, skin: { colour: 0xd9ab87, moles: 1 } }) },
  { name: 'Young woman, coils, freckles', look: tweak(mid(preset('lane_runner')), {
    face: { age: 0, width: 4, length: 5, cheekbones: 7, jawWidth: 3, chinWidth: 4 }, build: { height: 9, legs: 12, hips: 12, waist: 8 },
    hair: { style: 36, colour: 0x2a1a12, grey: 0 }, skin: { colour: 0x7d5237, freckles: 3, blush: 1 }, eyes: { shape: 1, size: 7, colour: 0x3b2416, openness: 7 },
    makeup: { lips: 1, shadow: 0, liner: 1 }, nose: { width: 6, bridge: 3, tip: 6 }, mouth: { upperLip: 7, lowerLip: 8, width: 6 } }) },
  { name: 'Tall, thin elder', look: tweak(mid(preset('dune_trader')), {
    build: { height: 20, weight: 2, shoulders: 8, muscle: 5, neck: 14, chest: 7, waist: 7 }, face: { age: 4, width: 2, length: 9, cheekbones: 8, jawWidth: 3, chinLength: 7 },
    hair: { style: 0, hairline: 3, colour: 0xe4e2dc, grey: 4, facial: 7, facialColour: 0xe4e2dc }, eyes: { shape: 6, size: 4, colour: 0x5f6b73 },
    brows: { shape: 9, thickness: 4, colour: 0xd8d6d0 }, nose: { length: 9, width: 3, bridge: 9, tip: 1 }, ears: { size: 7 }, skin: { colour: 0xa08156 } }) },
  { name: 'Broad-shouldered woman, scar', look: tweak(mid(preset('reading_room')), {
    build: { shoulders: 19, muscle: 17, chest: 12, arms: 12, neck: 13, waist: 11, height: 12 }, face: { age: 1, jawWidth: 8, chinWidth: 7, cheekbones: 6, width: 6 },
    hair: { style: 23, colour: 0xb5532a, grey: 0 }, skin: { colour: 0xefd0b6, scar: 7, freckles: 1, moles: 0 }, eyes: { shape: 9, colour: 0x4f6b3a, tilt: 4 },
    brows: { shape: 3, thickness: 6, tilt: 3 }, makeup: { lips: 0, shadow: 0, liner: 0 }, nose: { length: 5, bridge: 6 } }) },
  { name: 'Round-faced, youthful', look: tweak(mid(preset('fen_fisher')), {
    build: { height: 7, head: 13, weight: 13, shoulders: 9, muscle: 8 }, face: { width: 8, length: 2, cheekbones: 4, jawWidth: 7, chinLength: 2, chinWidth: 7, age: 0, forehead: 6 },
    hair: { style: 26, colour: 0x3e2c21 }, eyes: { shape: 1, size: 8, openness: 7, colour: 0x5a3a22 }, skin: { colour: 0xe0b591, blush: 2 },
    nose: { length: 2, width: 5, bridge: 2, tip: 8 }, mouth: { width: 4, upperLip: 6, lowerLip: 7 }, brows: { shape: 4, thickness: 4 } }) },
];

if (view === 'bodies') {
  const base = mid(preset('harbour_pilot'));
  const m = tweak(base, { hair: { style: 1, facial: 0 }, face: { age: 0 }, skin: { colour: 0xd3a27c, freckles: 0, scar: 0 } });
  const f = tweak(mid(preset('reading_room')), { hair: { style: 7 }, skin: { colour: 0xd3a27c, moles: 0 }, makeup: { lips: 0, shadow: 0, liner: 0 }, face: { age: 0 } });
  [[m, 'Male'], [f, 'Female']].forEach(([l, n], i) => {
    put(l as Look, x0 + (i - 0.5) * 1.6 - 0.4, zc, front, null, `${n as string} · front`);
    put(l as Look, x0 + (i - 0.5) * 1.6 + 0.4, zc, Math.PI / 2, null, 'side');
  });
  target = new Vector3(x0, 0.95, zc); radius = 4.6; beta = 1.5;
} else if (view === 'peoples') {
  PEOPLE_IDS.forEach((p, i) => (['male', 'female'] as const).forEach((b, j) => {
    const ps = LOOK_PRESETS.filter((x) => x.look.people === p && x.look.body === b);
    const l = mid(ps[0]!.look);
    put(l, x0 + (i - 1.5) * 1.5 + (j - 0.5) * 0.7, zc, front, null, j === 0 ? PEOPLES[p].name : '');
  }));
  target = new Vector3(x0, 1.0, zc); radius = 7.2; beta = 1.5;
} else if (view === 'grid') {
  const n = Number(qs.get('n') ?? 24), cols = Math.min(8, n);
  for (let i = 0; i < n; i++) {
    let l = rnd(i);
    if (pinPeople) l = ofPeople(l, pinPeople, pinBody ?? undefined);
    const c = i % cols, r = Math.floor(i / cols);
    put(l, x0 + (c - (cols - 1) / 2) * 0.85 + (r % 2) * 0.42, zc + r * 1.4, front);
  }
  const rows = Math.ceil(n / cols);
  target = new Vector3(x0, 0.8, zc + (rows - 1) * 0.7); radius = 4 + cols * 0.95; beta = 1.25;
} else if (view === 'slider' || view === 'pick') {
  const field = qs.get('field') ?? 'build.height';
  const [lo, hi0] = LOOK_LIMITS[field] ?? [0, 0];
  let p = pinPeople ?? (field.startsWith('fur') ? 'brindlekin' : 'human');
  if (field === 'ears.style' && !pinPeople) p = 'brindlekin';
  const hi = field === 'ears.style' ? PEOPLES[p].earsMax : hi0;
  const vals = view === 'slider' ? [lo, Math.round((lo + hi) / 2), hi] : Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const from = Number(qs.get('from') ?? 0), to = Number(qs.get('to') ?? vals.length - 1);
  const shown = vals.slice(from, to + 1);
  const presetBase = pinBody === 'female' ? preset('reading_room') : preset('harbour_pilot');
  let base = ofPeople(mid(field.startsWith('hair.style') || field.startsWith('hair.hairline') ? tweak(presetBase, { hair: { facial: 0 } }) : presetBase), p, pinBody ?? undefined);
  if (field === 'hair.facial') base = tweak(base, { hair: { style: 1 } });
  if (close && !field.startsWith('hair')) base = tweak(base, { hair: { facial: 0, style: 1 }, skin: { colour: 0xd9ab87 } });
  if (field.startsWith('makeup') || field.startsWith('skin.')) base = tweak(base, { skin: { freckles: 0, moles: 0, scar: 0 }, makeup: { lips: 0, shadow: 0, liner: 0 } });
  const gap = close ? 0.34 : 0.95;
  shown.forEach((v, i) => {
    const l = set(base, field, v) ?? base;
    put(l, x0 + (i - (shown.length - 1) / 2) * gap, zc, front, null, close ? '' : String(v));
  });
  beta = 1.5;
  if (close) { const h = views[0]!.height; target = new Vector3(x0, h * 0.9, zc); fitW = shown.length * gap; fitH = 0.36; }
  else { target = new Vector3(x0, 0.95, zc); fitW = shown.length * gap + 0.3; fitH = 2.1; }
  label(field + (view === 'slider' ? `: ${shown.join(' · ')}` : ''), new Vector3(x0, close ? target.y - 0.32 : -0.25, zc));
} else if (view === 'lineup') {
  LINEUP.forEach((p, i) => put(p.look, x0 + (i - 2) * (close ? 0.5 : 1.05), zc, front, null, close ? '' : p.name));
  beta = 1.52;
  if (close) { target = new Vector3(x0, views[2]!.height * 0.88, zc); fitW = 2.5; fitH = 0.75; }
  else { target = new Vector3(x0, 1.0, zc); fitW = 5.4; fitH = 2.3; }
} else if (view === 'presets') {
  const from = Number(qs.get('from') ?? 0), to = Number(qs.get('to') ?? 12);
  const ps = LOOK_PRESETS.slice(from, to + 1);
  ps.forEach((p, i) => put(p.look, x0 + (i - (ps.length - 1) / 2) * (close ? 0.5 : 0.9), zc, front, null, close ? '' : p.name));
  if (close) { target = new Vector3(x0, 1.55, zc); radius = 0.8 + ps.length * 0.33; beta = 1.53; }
  else { target = new Vector3(x0, 0.95, zc); radius = 2.5 + ps.length * 0.6; beta = 1.48; }
} else if (view === 'jobs') {
  const b = pinBody ?? 'male';
  const l = b === 'female' ? mid(preset('reading_room')) : mid(preset('smithy_hand'));
  JOB_IDS.forEach((j, i) => put(l, x0 + (i - 3) * 1.15, zc, front, j, JOBS[j].name));
  target = new Vector3(x0, 1.0, zc); radius = 9.6; beta = 1.47;
} else if (view === 'poses') {
  const l = mid(preset('smithy_hand'));
  const poses: [Pose, string, JobId][] = [['run', 'walk', 'warrior'], ['run', 'run', 'ranger'], ['attack', 'attack', 'warrior'], ['cast', 'cast', 'black_mage'], ['hit', 'hurt', 'paladin'], ['dead', 'dead', 'ninja']];
  poses.forEach(([pose, n, job], i) => { const v = put(l, x0 + (i - 2.5) * 1.15, zc, front - 0.5, job, n); v.setPose(pose); });
  target = new Vector3(x0, 0.95, zc); radius = 8.5; beta = 1.42;
} else if (view === 'emotes') {
  const l = mid(preset('reading_room'));
  EMOTES.forEach((e, i) => { put(l, x0 + (i - 2.5) * 1.15, zc, front - 0.35, null, e); });
  target = new Vector3(x0, 1.0, zc); radius = 8.5;
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
cam.minZ = 0.05; cam.maxZ = 8000; cam.fov = close ? 0.5 : 0.7; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
if (fitW > 0) {
  const asp = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()), t = Math.tan(cam.fov / 2);
  cam.radius = 1.08 * Math.max(fitW / 2 / (t * asp), fitH / 2 / t);
}
const camQ = qs.get('cam');
if (camQ) { const [a, b, r] = camQ.split(',').map(Number); cam.alpha = a!; cam.beta = b!; cam.radius = r!; }
world?.attachCamera(cam);
world?.setQuality(quality);

let paused = qs.has('t');
const holdT = Number(qs.get('t') ?? 0.7);
if (view === 'emotes') views.forEach((v, i) => v.emote(EMOTES[i] as EmoteId));
const walkers = view === 'poses' ? [0, 1] : [];
const step = (dt: number, n: number) => {
  for (let k = 0; k < n; k++) {
    for (const i of walkers) { const v = views[i]!; const sp = i === 0 ? 1.6 : 5.5; v.root.position.x += Math.sin(v.root.rotation.y) * sp * dt; v.root.position.z += Math.cos(v.root.rotation.y) * sp * dt; }
    for (const v of views) v.update(dt);
  }
};
if (paused) step(holdT / 20, 20);
const info = document.getElementById('info')!;
let frame = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  if (!paused) for (const v of views) v.update(dt);
  world?.update(dt);
  scene.render();
  frame++;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of labels) {
    const p = Vector3.Project(l.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    l.el.style.left = `${p.x}px`; l.el.style.top = `${p.y}px`;
  }
  if (frame % 10 === 1) {
    const mean = tris.length ? Math.round(tris.reduce((a, b) => a + b, 0) / tris.length) : 0;
    info.textContent = qs.get('info') === '0' ? '' : `${view}  q=${quality}  adventurers ${views.length}  tris/adventurer ${mean} (max ${Math.max(0, ...tris)})  draw calls ${instr.drawCallsCounter.current}  build ${characterStats.lastBuildMs.toFixed(1)} ms`;
  }
});
(window as unknown as Record<string, unknown>).__looks = {
  ready: true,
  get frames() { return frame; },
  step: (dt: number, n: number) => step(dt, n),
  pause: (on: boolean) => { paused = on; },
  stats: () => ({ adventurers: views.length, tris: [...tris], drawCalls: instr.drawCallsCounter.current, buildMs: characterStats.lastBuildMs }),
};
