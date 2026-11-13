// Viewer for gear on the adventurer (dev/gearModels.html, under `npm run dev`; not part of any build): a job through the
// tiers, the nine sets on their natural jobs, the named weapons close up, every weapon and off-hand, the costumes,
// a dye sheet, the four peoples in one set, the seven jobs side by side, a phone-distance readability row, and a
// crowd in mixed gear for the budgets. Adventurers stand on the Greenway's road in its real light.
// URL:
//   ?view=tiers&job=paladin        starter, T1, T2, T3 of a job (&back=1: from behind; &drawn=1: weapons out)
//   ?view=sets                     the nine sets, each on its natural job
//   ?view=named                    the seven named Warden weapons, close up on stands (&all=1: every weapon and off-hand)
//   ?view=costumes                 the fourteen costumes (head and back costumes over the starter kit)
//   ?view=dyes&set=tollwind        a set in 32 dye pairs (channel 1 = i, channel 2 = 31 − i; 0 = own colours)
//   ?view=peoples&set=beaconstone  the four peoples in one set
//   ?view=lineup&tier=0            the seven jobs from the front in one tier (the phone line-up)
//   ?view=far                      starter, T1, T2, T3 heavy at 20 m, phone-sized
//   ?view=crowd&n=50               n adventurers in mixed gear, tiers, dyes and costumes (budgets at &q=low|med)
//   &q=low|med|high   &cam=alpha,beta,radius   &people=…   &seed=n
// window.__gear: { ready, stats(): triangles, emissive triangles and draw calls }.
import { Engine, Scene, ArcRotateCamera, Matrix, Vector3, SceneInstrumentation, Mesh, VertexData, StandardMaterial, Color3 } from '@babylonjs/core';
import {
  COSTUMES, COSTUME_IDS, DYES, ITEMS, ITEM_IDS, JOBS, JOB_IDS, PEOPLES, PEOPLE_IDS, SETS, SET_IDS, greenwayLayout, parseLook, prng, randomLook, resolveGearLook,
  type GearLook, type JobId, type Look as AdventurerLook, type PeopleId, type SetId,
} from '@sg2/shared';
import type { CharacterView, Quality } from '../core/contracts';
import { buildGreenway } from '../world/greenway';
import { staffTint } from '../combat/spells';
import { makeCharacter, characterStats, capeFor, setCharacterDetail, setGearBuilder, pieceKit } from './character';
import { gearHooks, kitGear, modelInfo, setGear } from './gearModels';
import { buildWeaponIn } from './weaponModels';

setGearBuilder(gearHooks);
const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const world = buildGreenway(scene);
const layout = greenwayLayout();
const instr = new SceneInstrumentation(scene);
const quality = ((qs.get('q') as Quality) || 'med');
setCharacterDetail(quality);
const view = qs.get('view') ?? 'tiers';
const seed = Number(qs.get('seed') ?? 1);
const pinPeople = qs.get('people') as PeopleId | null;
const x0 = 30, zc = layout.roadZ(40) + 9;
const ground = (x: number, z: number) => world.groundAt(x, z) ?? layout.height(x, z);
const facing = qs.has('back') ? 0 : Math.PI;
const drawnWeapons = qs.has('drawn');

const views: CharacterView[] = [];
const labels: { el: HTMLElement; at: Vector3 }[] = [];
const label = (text: string, at: Vector3) => { const el = document.createElement('div'); el.className = 'lbl'; el.textContent = text; document.body.appendChild(el); labels.push({ el, at }); };
const tris: number[] = [], glows: number[] = [];
const ofPeople = (l: AdventurerLook, p: PeopleId): AdventurerLook => {
  const fur = PEOPLES[p].furred ? l.fur ?? { pattern: 1, colour: 0x3a2a20, tail: 1 } : null;
  return parseLook({ ...l, people: p, fur, face: { ...l.face, ears: Math.min(l.face.ears, PEOPLES[p].earsMax) } })!;
};
const at10 = (l: AdventurerLook): AdventurerLook => ({ ...l, body: { height: 10, build: 10, shoulders: 10, hips: 10, legs: 10, head: 10 } });
const baseLook = (i = 0) => { const l = at10(randomLook(prng(seed * 7919 + i * 104729))); return pinPeople ? ofPeople(l, pinPeople) : ofPeople(l, 'human'); };
const put = (look: AdventurerLook, gear: GearLook | null, job: JobId, x: number, z: number, face = facing, name = '') => {
  const v = makeCharacter(scene, { kind: 'player', look, gear });
  v.root.position.set(x, ground(x, z), z); v.root.rotation.y = face;
  v.setWeapon(JOBS[job].weapon, staffTint(job)); v.setCape(capeFor(job));
  if (drawnWeapons) v.setPose('attack');
  world.addShadowCaster(v.root);
  views.push(v);
  tris.push(characterStats.lastActiveTriangles); glows.push(characterStats.lastGlowTriangles);
  if (name) label(name, new Vector3(x, ground(x, z) - 0.12, z + 0.9));
  return v;
};
let target = new Vector3(x0, 1, zc), alpha = -Math.PI / 2, beta = 1.38, radius = 9;
const NATURAL: Record<SetId, JobId> = {
  plain: 'warrior', mossweave: 'white_mage', wickthread: 'black_mage', lenslight: 'white_mage', thornrunner: 'ranger', cinderstep: 'ninja',
  tollwind: 'warrior', rootbound: 'paladin', brassbound: 'dark_knight', beaconstone: 'paladin',
};
const TIER_NAME = ['Starter', 'T1', 'T2', 'T3'];

if (view === 'tiers') {
  const job = (qs.get('job') as JobId) || 'paladin';
  [0, 1, 2, 3].forEach((t, i) => put(baseLook(), kitGear(t as 0, job), job, x0 + (i - 1.5) * 1.3, zc, facing, `${JOBS[job].name} ${TIER_NAME[t]}`));
  target = new Vector3(x0, 1.0, zc); radius = 6.4;
} else if (view === 'sets') {
  const sets = SET_IDS.filter((s) => s !== 'plain');
  sets.forEach((s, i) => put(baseLook(i), setGear(s, NATURAL[s]), NATURAL[s], x0 + (i - 4) * 1.2, zc, facing, SETS[s].name));
  target = new Vector3(x0, 1.0, zc); radius = 9.6; beta = 1.45;
} else if (view === 'peoples') {
  const set = (qs.get('set') as SetId) || 'beaconstone';
  PEOPLE_IDS.forEach((p, i) => put(ofPeople(baseLook(i), p), setGear(set, NATURAL[set]), NATURAL[set], x0 + (i - 1.5) * 1.35, zc, facing, `${PEOPLES[p].name}`));
  target = new Vector3(x0, 1.0, zc); radius = 6.6;
} else if (view === 'lineup') {
  const tier = Number(qs.get('tier') ?? 0) as 0 | 1 | 2 | 3;
  // portrait (a phone): two staggered rows, 4 in front and 3 behind
  const portrait = innerHeight > innerWidth;
  JOB_IDS.forEach((j, i) => {
    const back = portrait && i >= 4, k = portrait ? (back ? i - 4 - 1 : i - 1.5) : i - 3;
    put(baseLook(i), kitGear(tier, j), j, x0 + k * (portrait ? 1.0 : 1.15), zc + (back ? 1.6 : 0), facing, JOBS[j].name.split(' ').pop()!);
  });
  target = new Vector3(x0, 1.1, zc + (portrait ? 0.8 : 0)); radius = portrait ? 10.5 : 12;
} else if (view === 'far') {
  [0, 1, 2, 3].forEach((t, i) => put(baseLook(), kitGear(t as 0, 'paladin'), 'paladin', x0 + (i - 1.5) * 1.4, zc, facing, TIER_NAME[t]));
  target = new Vector3(x0, 1.0, zc); radius = 20; beta = 1.42;
} else if (view === 'costumes') {
  // &part=body: the seven body costumes; &part=other: head costumes from the front, back costumes turned away
  const body = qs.get('part') !== 'other';
  COSTUME_IDS.filter((c) => (COSTUMES[c].slot === 'body') === body).forEach((c, i) => {
    const job = JOB_IDS[(i + 2) % JOB_IDS.length]!, d = COSTUMES[c];
    const slot = { model: d.model, dye: [0, 0] as [number, number] };
    const g = resolveGearLook(kitGear(0, job), { [d.slot]: slot }, d.slot !== 'head' && !qs.has('helm'));
    put(baseLook(i), g, job, x0 + (i - 3) * 1.25, zc, d.slot === 'back' ? (facing + Math.PI + 0.5) : facing, d.name);
  });
  target = new Vector3(x0, 1.05, zc); radius = 9.6; beta = 1.42;
} else if (view === 'dyes') {
  const set = (qs.get('set') as SetId) || 'tollwind';
  for (let i = 0; i < 32; i++) {
    const col = i % 8, row = Math.floor(i / 8);
    put(baseLook(), setGear(set, NATURAL[set], [i, 31 - i]), NATURAL[set], x0 + (col - 3.5) * 1.15, zc + row * 2.0, facing, `${i}·${31 - i}`);
  }
  target = new Vector3(x0, 1.0, zc + 3); radius = 15; beta = 1.2;
} else if (view === 'crowd') {
  const n = Number(qs.get('n') ?? 50), r = prng(seed);
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996, rr = 1.2 * Math.sqrt(i + 1);
    const job = JOB_IDS[i % JOB_IDS.length]!, tier = Math.floor(r() * 4) as 0 | 1 | 2 | 3;
    const costumes: Parameters<typeof kitGear>[3] = {};
    if (r() < 0.25) { const c = COSTUME_IDS[Math.floor(r() * COSTUME_IDS.length)]!; costumes[COSTUMES[c].slot] = { model: COSTUMES[c].model, dye: [Math.floor(r() * 32), Math.floor(r() * 32)] }; }
    const g = kitGear(tier, job, [Math.floor(r() * 32), Math.floor(r() * 32)], costumes);
    put(randomLook(prng(seed * 31 + i)), g, job, x0 + Math.cos(a) * rr, zc + 6 + Math.sin(a) * rr, r() * 6.28);
  }
  target = new Vector3(x0, 1, zc + 6); radius = 30; beta = 1.0;
} else if (view === 'named') {
  // weapons alone on stands, built through the same piece kit as on the body (standalone meshes, unlit glows)
  const ids = qs.has('all') ? ITEM_IDS.filter((id) => ITEMS[id]!.slot === 'weapon' || ITEMS[id]!.slot === 'offhand') : ITEM_IDS.filter((id) => ITEMS[id]!.named);
  const mat = new StandardMaterial('wpn', scene); mat.diffuseColor = Color3.White(); mat.specularColor = Color3.Black(); mat.emissiveColor = new Color3(0.12, 0.1, 0.1); mat.backFaceCulling = false;
  const gmat = new StandardMaterial('wpnGlow', scene); gmat.disableLighting = true; gmat.emissiveColor = Color3.White();
  const cols = qs.has('all') ? 10 : 7;
  ids.forEach((id, i) => {
    const info = modelInfo(ITEMS[id]!.model)!;
    if (info.kind !== 'weapon' && info.kind !== 'offhand') return;
    const col = i % cols, row = Math.floor(i / cols);
    const all = qs.has('all');
    const gx = x0 + (col - (cols - 1) / 2) * (all ? 0.62 : 0.9), gz = zc;
    const gy = ground(x0, zc) + (all ? 3.3 - row * 0.95 : 0.25);
    // upright on a stand: y up, x across, z (the blade's flat or the shield's face) toward the camera
    const long = info.kind === 'weapon' && (info.weapon === 'staff' || info.weapon === 'bow' || info.weapon === 'greatsword');
    const sc = (long ? 0.85 : 1) * (all ? 0.62 : 1);
    const base = info.kind === 'weapon' ? (info.weapon === 'staff' ? 0.6 : info.weapon === 'bow' ? 0.65 : info.weapon === 'greatsword' ? 0.35 : 0.25) : 0.6;
    // (a bow turns side-on, so its curve and the Longwatch's sight show)
    const bow = info.kind === 'weapon' && info.weapon === 'bow';
    const f = (x: number, y: number, z: number): [number, number, number] => bow ? [gx + z * sc, gy + (base + y) * sc, gz + x * sc] : [gx + x * sc, gy + (base + y) * sc, gz - z * sc];
    const pk = pieceKit(1, null);
    buildWeaponIn(pk.k, 'base', f, info.kind === 'weapon' ? { weapon: info.weapon, tier: info.tier, second: info.second } : { offhand: info.offhand, tier: info.tier });
    const r = pk.read();
    const mk = (pos: Float32Array, nrm: Float32Array, colr: Float32Array, idx: Uint32Array, m: StandardMaterial) => {
      if (!idx.length) return null;
      const mesh = new Mesh(`w_${id}_${m.name}`, scene), vd = new VertexData();
      vd.positions = pos; vd.normals = nrm; vd.colors = colr; vd.indices = idx; vd.applyToMesh(mesh); mesh.material = m;
      return mesh;
    };
    const body = mk(r.positions, r.normals, r.colours, r.indices, mat);
    mk(r.glowPositions, r.glowNormals, r.glowColours, r.glowIndices, gmat);
    if (body) world.addShadowCaster(body);
    label(ITEMS[id]!.name, new Vector3(gx, gy - (all ? 0.02 : 0.08), gz));
  });
  target = new Vector3(x0, ground(x0, zc) + (qs.has('all') ? 1.8 : 0.85), zc); radius = qs.has('all') ? 7.6 : 5.2; beta = 1.52;
}

const cam = new ArcRotateCamera('gearcam', alpha, beta, radius, target, scene);
cam.minZ = 0.2; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
const camQ = qs.get('cam');
if (camQ) { const [a, b, r] = camQ.split(',').map(Number); cam.alpha = a!; cam.beta = b!; cam.radius = r!; }
world.attachCamera(cam);
world.setQuality(quality);

const info = document.getElementById('info')!;
let frame = 0;
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  for (const v of views) v.update(dt);
  world.update(dt);
  scene.render();
  if (++frame % 10 === 1) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const l of labels) {
      const p = Vector3.Project(l.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      l.el.style.left = `${p.x}px`; l.el.style.top = `${p.y}px`;
    }
    const mean = tris.length ? Math.round(tris.reduce((a, b) => a + b, 0) / tris.length) : 0;
    const gmean = glows.length ? Math.round(glows.reduce((a, b) => a + b, 0) / glows.length) : 0;
    info.textContent = qs.has('noinfo') ? '' : `${view}  q=${quality}  adventurers ${views.length}  tris/adventurer ${mean} (+${gmean} glow, max ${Math.max(0, ...tris)})  draw calls ${instr.drawCallsCounter.current}  build ${characterStats.lastBuildMs.toFixed(1)} ms`;
  }
});
(window as unknown as Record<string, unknown>).__gear = {
  ready: true,
  stats: () => ({ adventurers: views.length, tris: [...tris], glows: [...glows], drawCalls: instr.drawCallsCounter.current, buildMs: characterStats.lastBuildMs }),
  dyes: DYES.length,
};
