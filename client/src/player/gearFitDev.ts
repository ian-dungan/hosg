// Viewer for fitted gear (dev/gearfit.html, under `npm run dev`; not part of any build): the same pieces on very
// different bodies, every armour slot's ten looks, mixed outfits, costume pieces, tiers by class, weapons on small
// and large bodies and a dye sheet. A studio light by default; &world=1 on the Greenway's road in its real light.
// URL:
//   ?view=bodies&set=beaconstone&turn=front|side|back   one set on the seven test bodies
//   ?view=slot&slot=chest&body=male|female             the ten looks of an armour slot (plain + nine sets)
//   ?view=mix                                          three mixed outfits (pieces of three or more sets) × three bodies
//   ?view=costumes&part=body|other                     every costume (body pieces together; heads; backs)
//   ?view=pieces&slot=legs                             each costume piece of a slot alone over the starter kit
//   ?view=tiers&cls=cloth|light|heavy                  starter, T1, T2, T3 of a class side by side
//   ?view=weapons                                      each job's T3 kit on the smallest Knollfolk and the tallest Larchfolk
//   ?view=dyes&set=tollwind                            a set in 16 dye triples
//   ?view=bare                                         no gear, the starter kit and T3, on a man and a woman
//   &q=low|med|high   &cam=alpha,beta,radius   &job=…
// window.__gearfit: { ready, frames, stats() }.
import { ArcRotateCamera, Color3, Color4, DirectionalLight, Engine, HemisphericLight, Matrix, MeshBuilder, Scene, SceneInstrumentation, StandardMaterial, Vector3 } from '@babylonjs/core';
import {
  COSTUMES, COSTUME_IDS, COSTUME_PIECES, COSTUME_PIECE_IDS, ITEMS, JOBS, LOOK_PRESETS, SETS, SET_IDS, greenwayLayout, parseLook,
  type ArmourSlot, type GearLookV2, type JobId, type Look, type PeopleId, type SetId,
} from '@sg2/shared';
import type { CharacterView, Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { staffTint } from '../combat/spells';
import { makeCharacter, characterStats, capeFor, setCharacterDetail, setGearBuilder } from './character';
import { gearHooks, kitGear, mixGear, setGear } from './gearModels';

setGearBuilder(gearHooks);
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
setCharacterDetail(quality);
const view = qs.get('view') ?? 'bodies';
const x0 = useWorld ? 30 : 0, zc = useWorld ? layout.roadZ(40) + 9 : 0;
const ground = (x: number, z: number) => (world ? world.groundAt(x, z) ?? layout.height(x, z) : 0);
const turn = qs.get('turn') ?? 'front';
const facing = turn === 'back' ? 0 : turn === 'side' ? -Math.PI / 2 : Math.PI;

const views: CharacterView[] = [];
const labels: { el: HTMLElement; at: Vector3 }[] = [];
const label = (text: string, at: Vector3) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.appendChild(el); labels.push({ el, at }); };
const tris: number[] = [];
const put = (look: Look, gear: GearLookV2 | null, job: JobId, x: number, z: number, face = facing, name = '') => {
  const v = makeCharacter(scene, { kind: 'player', look, gear });
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = face;
  v.update(0);
  v.setWeapon(JOBS[job].weapon, staffTint(job)); v.setCape(capeFor(job));
  if (qs.has('drawn')) v.setPose('attack');
  world?.addShadowCaster(v.root);
  views.push(v);
  tris.push(characterStats.lastActiveTriangles);
  if (name) label(name, new Vector3(x, ground(x, z) - 0.12, z));
  return v;
};

// ───────── the test bodies ─────────
const preset = (p: PeopleId, body: 'male' | 'female') => LOOK_PRESETS.find((x) => x.look.people === p && x.look.body === body)!.look;
const withBuild = (l: Look, b: Partial<Look['build']>): Look => parseLook({ ...l, build: { ...l.build, ...b } })!;
const mid = { height: 10, shoulders: 10, chest: 10, waist: 10, hips: 10, arms: 10, legs: 10, muscle: 10, weight: 10, neck: 10, head: 10 };
const BODIES: { name: string; look: Look }[] = [
  { name: 'Knollfolk, smallest', look: withBuild(preset('knollfolk', 'male'), { ...mid, height: 0 }) },
  { name: 'Human man', look: withBuild(preset('human', 'male'), mid) },
  { name: 'Human woman', look: withBuild(preset('human', 'female'), mid) },
  { name: 'Larchfolk, tallest', look: withBuild(preset('larchfolk', 'male'), { ...mid, height: 20 }) },
  { name: 'Heavy-set', look: withBuild(preset('human', 'male'), { ...mid, weight: 20, waist: 20, chest: 18, muscle: 14, shoulders: 16, hips: 16 }) },
  { name: 'Very thin', look: withBuild(preset('human', 'female'), { ...mid, weight: 0, waist: 0, chest: 2, muscle: 0, shoulders: 4, hips: 4, arms: 14 }) },
  { name: 'Brindlekin', look: withBuild(preset('brindlekin', 'female'), mid) },
];
const NATURAL: Record<SetId, JobId> = {
  plain: 'warrior', mossweave: 'white_mage', wickthread: 'black_mage', lenslight: 'white_mage', thornrunner: 'ranger', cinderstep: 'ninja',
  tollwind: 'warrior', rootbound: 'paladin', brassbound: 'dark_knight', beaconstone: 'paladin',
};
const SLOTS: ArmourSlot[] = ['head', 'chest', 'legs', 'hands', 'feet', 'back'];
let target = new Vector3(x0, 1, zc), alpha = -Math.PI / 2, beta = 1.42, radius = 9;
const row = (n: number, gap: number, i: number) => x0 + (i - (n - 1) / 2) * gap;

if (view === 'bodies') {
  const set = (qs.get('set') as SetId) || 'beaconstone';
  BODIES.forEach((b, i) => put(b.look, setGear(set, NATURAL[set]), NATURAL[set], row(BODIES.length, 1.15, i), zc, facing, b.name));
  radius = 8.4; target = new Vector3(x0, 0.95, zc);
} else if (view === 'slot') {
  const slot = (qs.get('slot') as ArmourSlot) || 'chest', body = (qs.get('body') as 'male' | 'female') || 'male';
  const look = withBuild(preset('human', body), mid);
  SET_IDS.forEach((s, i) => {
    const job = NATURAL[s];
    const g = mixGear(job, 0, { head: null, chest: null, legs: null, hands: null, feet: null, back: null, [slot]: ITEMS[`${s}_${slot}`]!.model });
    put(look, g, job, row(10, 0.95, i), zc, slot === 'back' ? 0.3 : facing, SETS[s].name);
  });
  radius = slot === 'head' ? 6.2 : 9.2; target = new Vector3(x0, slot === 'head' ? 1.45 : slot === 'feet' ? 0.5 : slot === 'hands' ? 0.85 : 1.0, zc); beta = slot === 'head' ? 1.5 : 1.42;
  if (slot === 'head' || slot === 'feet' || slot === 'hands') radius = 6.6;
} else if (view === 'mix') {
  const mixes: Partial<Record<ArmourSlot, SetId>>[] = [
    { head: 'thornrunner', chest: 'brassbound', legs: 'mossweave', hands: 'cinderstep', feet: 'rootbound', back: 'lenslight' },
    { head: 'lenslight', chest: 'tollwind', legs: 'beaconstone', hands: 'wickthread', feet: 'thornrunner', back: 'cinderstep' },
    { head: 'brassbound', chest: 'mossweave', legs: 'cinderstep', hands: 'beaconstone', feet: 'lenslight', back: 'rootbound' },
  ];
  const bodies = [BODIES[1]!, BODIES[2]!, BODIES[0]!];
  mixes.forEach((m, i) => bodies.forEach((b, j) => {
    const looks = Object.fromEntries(SLOTS.map((s) => [s, ITEMS[`${m[s]}_${s}`]!.model]));
    put(b.look, mixGear('warrior', 2, looks), 'warrior', row(9, 1.05, i * 3 + j), zc, facing, j === 1 ? `mix ${i + 1}` : '');
  }));
  radius = 10.5;
} else if (view === 'costumes') {
  const body = qs.get('part') !== 'other';
  const look = withBuild(preset('human', qs.get('body') === 'male' ? 'male' : 'female'), mid);
  const list = COSTUME_IDS.filter((c) => (COSTUMES[c].slot === 'body') === body);
  list.forEach((c, i) => {
    const pieces = COSTUME_PIECE_IDS.map((id) => COSTUME_PIECES[id]!).filter((p) => p.costume === c);
    const g = mixGear('warrior', 0, Object.fromEntries(pieces.map((p) => [p.slot, p.model])));
    put(look, g, 'warrior', row(list.length, 1.05, i), zc, COSTUMES[c].slot === 'back' ? 0.4 : facing, COSTUMES[c].name);
  });
  radius = 8.6;
} else if (view === 'pieces') {
  const slot = (qs.get('slot') as ArmourSlot) || 'legs';
  const look = withBuild(preset('human', qs.get('body') === 'female' ? 'female' : 'male'), mid);
  const list = COSTUME_PIECE_IDS.map((id) => COSTUME_PIECES[id]!).filter((p) => p.slot === slot);
  list.forEach((p, i) => put(look, mixGear('warrior', 0, { head: null, chest: null, legs: null, hands: null, feet: null, back: null, [slot]: p.model }), 'warrior', row(list.length, 1.0, i), zc, slot === 'back' ? 0.4 : facing, p.name.replace(/:.*/, '')));
  radius = slot === 'hands' || slot === 'feet' ? 6.4 : 8.2; target = new Vector3(x0, slot === 'feet' ? 0.5 : slot === 'hands' ? 0.85 : 1, zc);
} else if (view === 'tiers') {
  const cls = (qs.get('cls') as 'cloth' | 'light' | 'heavy') || 'heavy';
  const sets = ['plain', ...SET_IDS.filter((s) => SETS[s].type === cls).sort((a, b) => SETS[a].tier - SETS[b].tier)] as SetId[];
  const both = [BODIES[1]!, BODIES[2]!];
  both.forEach((b, j) => sets.forEach((s, i) => put(b.look, setGear(s, NATURAL[sets[sets.length - 1]!]), NATURAL[sets[sets.length - 1]!], row(8, 1.0, j * 4 + i), zc, facing, j === 0 ? (i ? `T${SETS[s].tier}` : 'Starter') : '')));
  radius = 9.4;
} else if (view === 'weapons') {
  const jobs: JobId[] = ['warrior', 'paladin', 'dark_knight', 'ranger', 'ninja', 'black_mage'];
  const small = BODIES[0]!.look, large = BODIES[3]!.look;
  jobs.forEach((j, i) => {
    put(small, kitGear(3, j), j, row(12, 0.9, i * 2), zc, facing + 0.5, i === 0 ? 'small' : '');
    put(large, kitGear(3, j), j, row(12, 0.9, i * 2 + 1), zc, facing + 0.5, JOBS[j].name.split(' ').pop()!);
  });
  radius = 10.5;
} else if (view === 'dyes') {
  const set = (qs.get('set') as SetId) || 'tollwind';
  const look = withBuild(preset('human', 'male'), mid);
  for (let i = 0; i < 16; i++) {
    const col = i % 8, r = Math.floor(i / 8), d = [i * 2, (i * 2 + 9) % 32, (31 - i * 2 + 32) % 32];
    put(look, setGear(set, NATURAL[set], i === 0 ? [0, 0, 0] : d), NATURAL[set], x0 + (col - 3.5) * 1.05, zc + r * 2.0, facing, i === 0 ? 'own' : d.join('·'));
  }
  target = new Vector3(x0, 1.0, zc + 1); radius = 13; beta = 1.25;
} else if (view === 'bare') {
  const job = (qs.get('job') as JobId) || 'paladin';
  [BODIES[1]!, BODIES[2]!].forEach((b, j) => ([null, 0, 3] as const).forEach((t, i) => put(b.look, t === null ? null : kitGear(t, job), job, row(6, 1.0, j * 3 + i), zc, facing, j === 0 ? (t === null ? 'no gear' : t === 0 ? 'starter' : 'T3') : '')));
  radius = 7.6;
}

const cam = new ArcRotateCamera('cam', alpha, beta, radius, target, scene);
cam.minZ = 0.1; cam.maxZ = 8000; cam.fov = 0.8;
cam.attachControl(canvas, true);
const camQ = qs.get('cam');
if (camQ) { const [a, b, r, ty, tx] = camQ.split(",").map(Number); cam.alpha = a!; cam.beta = b!; cam.radius = r!; if (Number.isFinite(ty)) cam.target.y = ty!; if (Number.isFinite(tx)) cam.target.x = x0 + tx!; }
if (world) { world.attachCamera(cam); world.setQuality(quality); }

const info = document.getElementById('info')!;
let frames = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  for (const v of views) v.update(qs.has('still') ? 0 : dt);
  world?.update(dt);
  scene.render();
  frames++;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  for (const l of labels) {
    const p = Vector3.Project(l.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    l.el.style.left = `${p.x}px`; l.el.style.top = `${p.y}px`;
  }
  const mean = tris.length ? Math.round(tris.reduce((a, b) => a + b, 0) / tris.length) : 0;
  info.textContent = qs.has('noinfo') ? '' : `${view}  q=${quality}  n=${views.length}  tris/adventurer ${mean} (max ${Math.max(0, ...tris)})  draw calls ${instr.drawCallsCounter.current}`;
});
(window as unknown as Record<string, unknown>).__gearfit = { ready: true, get frames() { return frames; }, stats: () => ({ tris: [...tris], drawCalls: instr.drawCallsCounter.current }) };
