// Viewer for the Lampfall, its bosses, telegraphs and fields, and the crater mouth (dev/lampfall.html, under
// `npm run dev`; not part of any build). No game server: the room state the telegraphs, fields and overheads read
// is faked here, and the clock is frozen so a screenshot shows a wind-up exactly `t` of the way through.
// URL:
//   ?view=room&room=<RoomId>   a room from the gameplay camera (its enemies at their spawns)   (default: rim)
//   ?view=pit | den            the Lens Pit with the Warden / the Wick Den with the Wickhound
//       &phase=0|1|2           the boss's phase (its look; the Warden's fields and shards follow)
//       &mode=idle|windup|stunned|phase|run|dead   &atk=<attack>   &t=0.6 (how far through the wind-up, 0..1)
//       &close=1               the boss up close
//       &tg=<attack,...>       telegraphs on the floor (each from the boss toward the adventurers)
//       &field=lampfire|lampfire_deep   &sear=0..5 (Searing over the adventurers)
//   ?view=models               the three models side by side (&mode, &atk, &phase as above)
//   ?view=gate&bit=1|2|4&shut=0|1     a lamp-gate, open or shut
//   ?view=lift&open=0|1        the lamp-lift at the Lens Pit's centre
//   ?view=overview             the whole dungeon from above
//   ?view=mouth                the crater mouth in the Greenway, from the road
//   &q=low|med|high   &cam=alpha,beta,radius[,tx,ty,tz]   &enrage=1
import { Engine, Scene, ArcRotateCamera, Vector3, Matrix, SceneInstrumentation } from '@babylonjs/core';
import {
  ENEMY_ATTACKS, ENEMY_KINDS, lampfallGates, lampfallLayout, greenwayLayout, TICK_HZ,
  type EnemyAttackId, type EnemyKindId, type RoomId,
} from '@sg2/shared';
import type { Quality, WorldApi } from '../core/contracts';
import { buildLampfall, type LampfallWorld } from './lampfall';
import { buildGreenway } from './greenway';
import { makeEnemy, enemyStats, type EnemyMode, type EnemyView } from '../combat/enemies';
import { createTelegraphs } from '../combat/telegraphs';
import { createOverheads } from '../combat/overheads';
import { makeCharacter } from '../player/character';
import type { ZoneRoom } from '../net/session';
import type { Enemies } from '../net/enemies';

const qs = new URLSearchParams(location.search);
const view = qs.get('view') ?? 'room';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const scene = new Scene(engine);
const mouthView = view === 'mouth';
const world: WorldApi = mouthView ? buildGreenway(scene) : buildLampfall(scene);
const lf = mouthView ? null : (world as LampfallWorld);
const L = lampfallLayout();
const instr = new SceneInstrumentation(scene);
instr.captureFrameTime = true;
const q = (qs.get('q') as Quality) || 'med';

// ───── fake room state ─────
class FakeMap<T> { m = new Map<string, T>(); get(k: string) { return this.m.get(k); } forEach(cb: (v: T, k: string) => void) { this.m.forEach(cb); } get size() { return this.m.size; } set(k: string, v: T) { this.m.set(k, v); } }
const state = {
  telegraphs: new FakeMap<Record<string, unknown>>(), enemies: new FakeMap<Record<string, unknown>>(), fields: new FakeMap<Record<string, unknown>>(),
  players: new FakeMap<Record<string, unknown>>(), clock: 100000, gates: 0, lift: false,
};
const room = { state, onStateChange: Object.assign(() => {}, { remove() {} }) } as unknown as ZoneRoom;

// ───── what stands where ─────
const roomOf = (id: RoomId) => L.rooms.find(r => r.id === id)!;
interface Actor { view: EnemyView; kind: EnemyKindId; eid: number; x: number; z: number; y: number; label: string }
const actors: Actor[] = [];
let nextEid = 1;
const place = (kind: EnemyKindId, x: number, z: number, facing: number, label = ENEMY_KINDS[kind].name) => {
  const v = makeEnemy(scene, kind);
  const y = world.groundAt(x, z) ?? 0;
  v.root.position.set(x, y, z); v.root.rotation.y = facing;
  world.addShadowCaster(v.root);
  const eid = nextEid++;
  v.setEntityId(eid);
  actors.push({ view: v, kind, eid, x, z, y, label });
  state.enemies.set(String(eid), { eid, kind, x, z, y, facing, hp: ENEMY_KINDS[kind].hp, maxHp: ENEMY_KINDS[kind].hp, mode: 'fight', target: -1, windup: '', windupTotal: 0, stagger: 80, maxStagger: ENEMY_KINDS[kind].stagger, marks: 0, tier: ENEMY_KINDS[kind].tier, phase: 0, warded: false, enrageAt: 0 });
  return v;
};
const adventurers: { x: number; z: number }[] = [];
const advModels: ReturnType<typeof makeCharacter>[] = [];
const addAdventurer = (x: number, z: number, facing: number, sear: number) => {
  const c = makeCharacter(scene, { kind: 'player' });
  const y = world.groundAt(x, z) ?? 0;
  c.root.position.set(x, y, z); c.root.rotation.y = facing; world.addShadowCaster(c.root);
  adventurers.push({ x, z }); advModels.push(c);
  state.players.set('p' + adventurers.length, { name: 'A' + adventurers.length, x, z, y, facing, moving: false, hp: 100, maxHp: 100, searing: sear });
};

const phase = Number(qs.get('phase') ?? 0);
const mode = (qs.get('mode') ?? 'idle') as EnemyMode;
const atkQ = qs.get('atk') as EnemyAttackId | null;
const tFrac = Number(qs.get('t') ?? 0.6);
const sear = Number(qs.get('sear') ?? 0);
const yaw = (dx: number, dz: number) => Math.atan2(dx, dz);

let target = new Vector3(0, 0, 0);
let alpha = -Math.PI / 2, beta = (62 * Math.PI) / 180, radius = 20;
let boss: Actor | null = null;
const facingIn = (r: { entryDir: number }) => r.entryDir; // the boss faces the way the party comes in

if (view === 'pit' || view === 'den' || view === 'models') {
  const r = roomOf(view === 'den' ? 'wick_den' : 'lens_pit');
  const f = facingIn(r);
  const fx = Math.sin(f), fz = Math.cos(f);
  if (view === 'models') {
    place('lens_shard', r.x - fz * 5 + fx * 2, r.z + fx * 5 + fz * 2, f);
    place('fallen_warden', r.x, r.z, f);
    place('wickhound', r.x + fz * 6.5 + fx * 1, r.z - fx * 6.5 + fz * 1, f);
    target.set(r.x + fx * 1, r.floorY + 2.2, r.z + fz * 1);
    radius = 17; beta = 1.25;
  } else {
    place(view === 'den' ? 'wickhound' : 'fallen_warden', r.x, r.z, f);
    boss = actors[actors.length - 1];
    // the party, spread in front of the boss
    const spots = view === 'den' ? [[0, 6.5], [-4, 5.5], [4.5, 5]] : [[0, 9], [-6, 8], [6.5, 7.5]];
    for (const [s, d] of spots) addAdventurer(r.x + fx * d + fz * s, r.z + fz * d - fx * s, f + Math.PI, sear);
    if (view === 'pit' && phase === 1) for (const dx of [-10, 10]) place('lens_shard', r.x + fz * dx, r.z - fx * dx, f);
    target.set(r.x + fx * 4, r.floorY + 1.8, r.z + fz * 4);
    radius = view === 'pit' ? 30 : 24; beta = 0.95;
    // &close=1: the boss up close (its look per phase and mode)
    if (qs.get('close') === '1') { target.set(r.x, r.floorY + (view === 'pit' ? 2.6 : 1.8), r.z); radius = view === 'pit' ? 12 : 9; beta = 1.2; }
  }
  // the camera behind the party, looking at the boss
  alpha = Math.atan2(fz, fx);
} else if (view === 'gate') {
  const bit = Number(qs.get('bit') ?? 4);
  const g = lampfallGates().find(x => x.bit === bit)!;
  lf!.setGates(qs.get('shut') === '1' ? bit : 0);
  target.set(g.x - g.ux * 2, (world.groundAt(g.x - g.ux * 4, g.z - g.uz * 4) ?? 0) + 1.5, g.z - g.uz * 2);
  alpha = Math.atan2(-g.uz, -g.ux); radius = 14; beta = 1.05;
} else if (view === 'lift') {
  lf!.setLift(qs.get('open') !== '0');
  for (let i = 0; i < 80; i++) world.update(0.05); // risen
  const r = roomOf('lens_pit');
  target.set(r.x, r.floorY + 1.5, r.z); radius = 16; beta = 1.0; alpha = Math.atan2(Math.cos(r.entryDir), Math.sin(r.entryDir));
} else if (view === 'overview') {
  target.set(125, -9, -40); radius = 190; beta = 0.35; alpha = -Math.PI / 2;
} else if (mouthView) {
  const g = greenwayLayout(), m = g.mouth;
  target.set(m.x, g.height(m.x, m.z) + 1.2, m.z); radius = 15; beta = 1.02; alpha = Math.PI + 0.35;
} else {
  const id = (qs.get('room') ?? 'rim') as RoomId;
  const r = roomOf(id);
  for (const s of r.spawns) place(s.kind, s.x, s.z, s.facing);
  // stand an adventurer at the way in and look past it into the room, as play does
  const f = r.entryDir, fx = Math.sin(f), fz = Math.cos(f);
  const ax = r.x + fx * (r.r * 0.55), az = r.z + fz * (r.r * 0.55);
  addAdventurer(ax, az, f + Math.PI, sear);
  target.set(ax, r.floorY + 1.8, az);
  alpha = Math.atan2(fz, fx);
}
const cam = new ArcRotateCamera('lfcam', alpha, beta, radius, target, scene);
cam.minZ = 0.3; cam.maxZ = 3000; cam.fov = 0.8; cam.wheelPrecision = 20; cam.panningSensibility = 60;
cam.attachControl(canvas, true);
const camQ = qs.get('cam');
if (camQ) { const [a, b, r, x, y, z] = camQ.split(',').map(Number); cam.alpha = a; cam.beta = b; cam.radius = r; if (z !== undefined && !Number.isNaN(z)) cam.target.set(x, y, z); }
world.attachCamera(cam);
world.setQuality(q);

// ───── the boss: phase, mode, wind-up, telegraphs, fields ─────
const T0 = 1_000_000;
if (boss) {
  const e = state.enemies.get(String(boss.eid))!;
  e.phase = phase;
  boss.view.setBoss(phase, view === 'pit' && phase === 1, qs.get('enrage') === '1');
  e.warded = view === 'pit' && phase === 1;
  if (qs.get('enrage') === '1') e.enrageAt = state.clock - 10;
}
const applyMode = (a: Actor) => {
  if (mode === 'windup') {
    const atk = atkQ ?? ENEMY_KINDS[a.kind].attacks[0];
    if (!ENEMY_KINDS[a.kind].attacks.includes(atk)) { a.view.setMode('idle'); return; }
    const w = ENEMY_ATTACKS[atk].windup;
    // start 0.3 s early and play those 0.3 s at once: the pose has blended in when the clock freezes
    a.view.setMode('windup', atk, w, Math.max(0, w * tFrac - 0.3));
    a.view.update(0.3);
  } else a.view.setMode(mode);
};
for (const a of actors) applyMode(a);
if (boss) for (const a of actors) if (a.kind === 'lens_shard') a.view.setTether({ x: boss.x, y: boss.y + 2.6, z: boss.z });

let tgId = 1;
const addTelegraph = (owner: Actor, atk: EnemyAttackId) => {
  const d = ENEMY_ATTACKS[atk];
  const tgt = adventurers[0] ?? { x: owner.x + 5, z: owner.z };
  const far = adventurers.reduce((b, p) => (Math.hypot(p.x - owner.x, p.z - owner.z) > Math.hypot(b.x - owner.x, b.z - owner.z) ? p : b), tgt);
  const aim = d.aimAt === 'farthest' ? far : tgt;
  const dir = yaw(aim.x - owner.x, aim.z - owner.z);
  const total = d.windup;
  const base = { owner: owner.eid, attack: atk, total, at: state.clock - Math.round(total * tFrac * TICK_HZ), dir: 0, width: 0, angle: 0, inner: 0 };
  const add = (t: Record<string, unknown>) => { const id = tgId++; state.telegraphs.set(String(id), { ...base, id, ...t }); };
  if (d.targets === 'each') { for (const p of adventurers) add({ shape: 'circle', x: p.x, z: p.z, r: d.r }); return; }
  if (d.shape === 'circle-self') add({ shape: 'circle', x: owner.x, z: owner.z, r: d.r });
  else if (d.shape === 'circle-target') add({ shape: 'circle', x: aim.x, z: aim.z, r: d.r });
  else if (d.shape === 'ring-self') add({ shape: 'ring', x: owner.x, z: owner.z, r: d.r, inner: d.inner });
  else if (d.shape === 'cone') add({ shape: 'cone', x: owner.x, z: owner.z, dir, r: d.r, angle: d.angle });
  else add({ shape: 'line', x: owner.x, z: owner.z, dir, r: d.length, width: d.width });
};
const tgQ = qs.get('tg');
if (tgQ) for (const atk of tgQ.split(',') as EnemyAttackId[]) {
  const owner = actors.find(a => ENEMY_KINDS[a.kind].attacks.includes(atk)) ?? boss;
  if (owner) addTelegraph(owner, atk);
}
// &probe=1 (room views): a plain circle telegraph 4 m ahead of the adventurer, for the decal-to-floor contrast check
let probe: { x: number; z: number; r: number; dirx: number; dirz: number } | null = null;
if (qs.get('probe') === '1' && adventurers.length) {
  const a0 = adventurers[0], r = view === 'room' ? roomOf((qs.get('room') ?? 'rim') as RoomId) : roomOf('lens_pit');
  const dx = r.x - a0.x, dz = r.z - a0.z, d = Math.hypot(dx, dz) || 1;
  // ahead, nudged sideways off the room's centre inlays
  probe = { x: a0.x + (dx / d) * 4 + (dz / d) * 2.2, z: a0.z + (dz / d) * 4 - (dx / d) * 2.2, r: 2.2, dirx: dz / d, dirz: -dx / d };
  const id = tgId++;
  state.telegraphs.set(String(id), { id, owner: 999, attack: 'ground_slam', shape: 'circle', x: probe.x, z: probe.z, r: probe.r, dir: 0, width: 0, angle: 0, inner: 0, total: 2, at: state.clock - Math.round(2 * 0.6 * TICK_HZ) });
}
const fieldQ = qs.get('field');
if (fieldQ && boss) {
  const inner = fieldQ === 'lampfire_deep' ? 12 : 15;
  state.fields.set('1', { id: 1, owner: boss.eid, field: fieldQ, shape: 'ring', x: boss.x, z: boss.z, r: 40, inner, raw: 8, at: state.clock - 600 });
}

const telegraphs = createTelegraphs(scene, world, room);
const fakeEnemies: Enemies = {
  update() {}, get: (eid) => { const a = actors.find(x => x.eid === eid); return a ? { view: a.view, x: a.x, z: a.z, y: a.y } : undefined; },
  forEach: (cb) => { for (const a of actors) cb(a.eid, { view: a.view, x: a.x, z: a.z, y: a.y, kind: a.kind }); }, dispose() {},
};
const overheads = createOverheads(scene, room, fakeEnemies);

// labels (models view)
const labels = view === 'models' ? actors.map((a) => { const d = document.createElement('div'); d.className = 'lbl'; d.textContent = a.label; document.body.appendChild(d); return d; }) : [];

const info = document.getElementById('info')!;
let frames = 0, simT = 0;
const tris = { lastEnemy: enemyStats.lastTriangles };
const readout = { drawCalls: 0, activeTriangles: 0, activeMeshes: 0 };
engine.runRenderLoop(() => {
  const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
  simT += dt;
  // frozen wind-ups (t): only idle loops animate; ?anim=1 lets everything run
  const step = qs.get('anim') === '1' || mode !== 'windup' ? dt : 0;
  for (const a of actors) a.view.update(step);
  for (const c of advModels) c.update(dt);
  world.update(dt);
  telegraphs.update(qs.get('anim') === '1' ? performance.now() : T0, adventurers[0]?.x ?? -9999, adventurers[0]?.z ?? -9999);
  overheads.update({ target: null, hurtAt: new Map(), now: performance.now(), me: -1 });
  scene.render();
  if (labels.length) {
    const w = canvas.clientWidth, h = canvas.clientHeight, vp = cam.viewport.toGlobal(w, h);
    actors.forEach((a, i) => {
      const p = Vector3.Project(a.view.root.position, Matrix.IdentityReadOnly, scene.getTransformMatrix(), vp);
      labels[i].style.left = `${p.x}px`; labels[i].style.top = `${p.y + 6}px`;
    });
  }
  if (probe) {
    const w = canvas.clientWidth, h = canvas.clientHeight, vp = cam.viewport.toGlobal(w, h), tm = scene.getTransformMatrix();
    const pt = (x: number, z: number) => { const v = Vector3.Project(new Vector3(x, world.groundAt(x, z) ?? 0, z), Matrix.IdentityReadOnly, tm, vp); return [Math.round(v.x), Math.round(v.y)]; };
    (window as unknown as Record<string, unknown>).__probe = {
      fill: pt(probe.x - probe.dirx * 0.6, probe.z - probe.dirz * 0.6), rim: pt(probe.x + probe.dirx * (probe.r - 0.12), probe.z + probe.dirz * (probe.r - 0.12)),
      floor: pt(probe.x + probe.dirx * (probe.r + 0.9), probe.z + probe.dirz * (probe.r + 0.9)), dpr: devicePixelRatio,
    };
  }
  if (++frames % 5 === 0) {
    const act = scene.getActiveMeshes();
    let t = 0; for (let i = 0; i < act.length; i++) t += act.data[i].getTotalIndices() / 3;
    readout.drawCalls = instr.drawCallsCounter.current; readout.activeTriangles = Math.round(t); readout.activeMeshes = act.length;
    info.textContent = `${view} ${qs.get('room') ?? ''} q=${q} fps ${engine.getFps().toFixed(0)}  draw calls ${readout.drawCalls}  active meshes ${act.length}  active triangles ${readout.activeTriangles}\n` +
      `built: med ${lf?.triangles.med ?? '-'} low ${lf?.triangles.low ?? '-'}  meshes ${scene.meshes.length} materials ${scene.materials.length}  telegraphs ${telegraphs.count}  enemy tris ${tris.lastEnemy}`;
  }
});
window.addEventListener('resize', () => engine.resize());
(window as unknown as Record<string, unknown>).__lf = { scene, engine, world, cam, actors, readout, state, simT: () => simT };
