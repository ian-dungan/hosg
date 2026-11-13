// Dev viewer for the opening quest's people and places (dev/story.html; not part of either build).
// URL: ?zone=grove|greenway  ?q=low|med|high  ?shot=<npc or prop id>|beacon|star  ?d=close|play
//      ?markers=offer|talk|turnin|busy|mix|view  ?step=<main quest step id> (markers from a real quest view)
//      ?beacon=1 (risen)  ?adv=1 (an adventurer beside the subject, for scale and contrast)  ?info=1
// window.__story drives it from a browser check: shot(id, d), markers(kind), advance(s), star(), gfx(), tap(x, y).
import { ArcRotateCamera, Engine, Scene, SceneInstrumentation, Vector3, Matrix } from '@babylonjs/core';
import { NPC_IDS, QUESTS, STORY_NPCS, STORY_PROPS, newQuestSave, questsView, type QuestsView } from '@sg2/shared';
import type { Quality, WorldApi } from '../core/contracts';
import { buildWorld } from './index';
import { buildGreenway } from './greenway';
import { makeCharacter } from '../player/character';
import { GREENWAY_BEACON_DIR, createStoryWorld, type Marker, type StoryId, type StoryWorld } from './storyNpcs';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLElement;
const engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
const touch = matchMedia('(pointer: coarse)').matches;
engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
const scene = new Scene(engine);
const zone = qs.get('zone') === 'greenway' ? 'greenway' : 'grove';
const world: WorldApi = zone === 'greenway' ? buildGreenway(scene) : buildWorld(scene);
const quality = (qs.get('q') as Quality) || 'med';
world.setQuality(quality);

const cam = new ArcRotateCamera('storycam', -Math.PI / 2, 1.08, 20, new Vector3(0, 1.5, 0), scene);
cam.minZ = 0.3; cam.maxZ = 8000; cam.fov = 0.8; cam.wheelPrecision = 20;
cam.attachControl(canvas, true);
world.attachCamera(cam);

let story: StoryWorld = createStoryWorld(scene, world, zone, { quality, onTap: (id) => { lastTap = id; } });
let lastTap: StoryId | null = null;

/** A real quest view with the main quest at `step` (and the two side quests on offer when the step allows). */
function viewAt(step: string): QuestsView {
  const s = newQuestSave('2026-11-13');
  const ix = QUESTS.solstice_crossing.steps.findIndex((x) => x.id === step);
  const st = { ...s, active: [{ ...s.active[0], step: Math.max(0, ix), counts: QUESTS.solstice_crossing.steps[Math.max(0, ix)].objectives.map(() => 0) }] };
  return questsView(st, '2026-11-13');
}
const KINDS: Exclude<Marker, null>[] = ['talk', 'offer', 'turnin', 'busy'];
function markers(kind: string): void {
  if (kind === 'view') { story.setMarkers(null); return; }
  const m: Partial<Record<StoryId, Marker>> = {};
  story.spots.forEach((s, i) => { m[s.id] = kind === 'mix' ? KINDS[i % 4] : kind === 'none' ? null : (kind as Marker); });
  story.setMarkers(m);
}

// an adventurer beside the subject, for scale (and to check the NPCs read apart from adventurers)
const adv = qs.get('adv') ? makeCharacter(scene, { kind: 'player', weapon: 'sword' }) : null;
if (adv) { adv.setPose('idle'); world.addShadowCaster(adv.root); }

const spotOf = (id: string) => story.spots.find((s) => s.id === id);
/** Frames a subject: close (portrait) or at play distance (the rig's default 20 m, 28° down), from in front of it. */
function shot(id: string, d: 'close' | 'play' = 'play'): void {
  const s = spotOf(id);
  if (!s) return;
  const npc = (NPC_IDS as readonly string[]).includes(id) ? STORY_NPCS[id as keyof typeof STORY_NPCS] : null;
  // props face the road / the plaza (−z); Pim's spot faces the door, so the camera stands in the street
  const facing = npc ? npc.facing + (id === 'pim' ? Math.PI : 0) : id === 'crater_edge' ? 0.6 : Math.PI;
  const lift = id === 'pim' ? (d === 'close' ? 4.3 : 3) : id === 'plaque' ? 1.5 : 1.1;
  cam.target.set(s.x + (id === 'plaque' ? 0 : 0), s.y + lift, s.z + (id === 'plaque' ? -2.5 : 0));
  cam.alpha = Math.atan2(Math.cos(facing), Math.sin(facing));
  cam.beta = d === 'close' ? (id === 'pim' ? 1.45 : 1.38) : (62 * Math.PI) / 180;
  cam.radius = d === 'close' ? (id === 'pim' ? 9 : id === 'crater_edge' ? 5 : 4.6) : 20;
  if (adv) {
    const side = { x: Math.cos(facing), z: -Math.sin(facing) };
    const ax = s.x + side.x * 1.4 + Math.sin(facing) * 0.6, az = s.z + side.z * 1.4 + Math.cos(facing) * 0.6;
    adv.root.position.set(ax, world.groundAt(ax, az) ?? s.y, az);
    adv.root.rotation.y = facing;
  }
}
function sky(): void {
  if (zone === 'greenway') {
    // from the road near the gate, looking up toward the far Beacon (the cloud bank's direction)
    const d = GREENWAY_BEACON_DIR, e = story.spots[0];
    cam.target.set(e.x + d.x * 300, e.y + 2 + d.y * 300, e.z + d.z * 300);
    cam.alpha = Math.atan2(-d.z, -d.x); cam.beta = Math.acos(-d.y) - 0.12; cam.radius = 300; cam.fov = 0.9;
    return;
  }
  // the Beacon over the statue, from the plaza (the Beacon scene's own framing is Task 6's)
  const lens = world.statueLens;
  cam.target.set(lens.x, lens.y + 20, lens.z);
  const isl = scene.getMeshByName('world_beacon') ?? scene.getMeshByName('gw_beacon');
  const at = isl ? isl.getAbsolutePosition() : new Vector3(0, 100, 600);
  const dir = at.subtract(cam.target); dir.y = 0; dir.normalize();
  cam.alpha = Math.atan2(-dir.z, -dir.x); cam.beta = 1.5; cam.radius = 30;
}
function starView(): void {
  if (zone !== 'grove') { sky(); cam.fov = 1.1; return; }
  // from the plaza looking north: the Beacon at the left, the streak sweeping over to the east at the right
  cam.target.set(0, 28, 0); cam.alpha = -Math.PI / 2 - 0.12; cam.beta = 1.42; cam.radius = 30; cam.fov = 1.15;
}

let paused = false;
/** Steps the world and the story by `s` seconds of game time (headless WebGL is ~1 fps). */
function advance(s: number): void {
  const step = 1 / 30;
  for (let t = 0; t < s; t += step) { world.update(step); story.update(step); adv?.update(step); }
}
const instr = new SceneInstrumentation(scene);
/** Draw calls of the last frame, active meshes, triangles, the story's stats. */
function gfx() {
  const drawCalls = instr.drawCallsCounter.current;
  const act = scene.getActiveMeshes();
  let tris = 0;
  for (let i = 0; i < act.length; i++) tris += act.data[i].getTotalIndices() / 3;
  return { drawCalls, activeMeshes: act.length, tris: Math.round(tris), story: story.stats };
}
function rebuild(on: boolean): void {
  story.dispose();
  story = on ? createStoryWorld(scene, world, zone, { quality, onTap: (id) => { lastTap = id; } }) : createStoryWorld(scene, world, 'beacon');
}
/** Picks like the rig does, at CSS px (x, y): the story id hit, via handleTap. */
function tap(x: number, y: number): StoryId | null {
  const all = scene.multiPick(x, y, (m) => m.isPickable && m.isEnabled() && m.isVisible, cam) ?? [];
  const ids: number[] = [];
  for (const h of all) { let n: { metadata?: unknown; parent?: unknown } | null = h.pickedMesh; while (n) { const id = (n.metadata as { entityId?: number } | null)?.entityId; if (typeof id === 'number') { ids.push(id); break; } n = n.parent as typeof n; } }
  lastTap = null;
  return story.handleTap({ entityId: ids[0] ?? null, point: null, entityIds: ids }) ?? lastTap;
}
function screenOf(id: string) {
  const s = spotOf(id); if (!s) return null;
  const p = Vector3.Project(new Vector3(s.x, s.y + 1, s.z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(canvas.clientWidth, canvas.clientHeight));
  return { x: p.x, y: p.y };
}

/** Toward where the star comes down (east-north-east), for the flash. */
function flashView(): void {
  cam.target.set(0, 28, 0); cam.alpha = Math.PI + 0.3 + 0.07; cam.beta = 1.45; cam.radius = 30; cam.fov = 1.0;
}
(window as unknown as Record<string, unknown>).__story = {
  scene, world, cam, get story() { return story; }, shot, sky, starView, flashView, markers, advance, gfx, rebuild, tap, screenOf,
  view: (step: string) => { story.setMarkers(null); story.setView(viewAt(step)); },
  beacon: (on: boolean) => world.setBeaconRaised(on),
  star: () => { void world.fallingStar(); },
  pause: (on: boolean) => { paused = on; },
  spots: () => story.spots, props: STORY_PROPS,
};

if (qs.get('step')) story.setView(viewAt(qs.get('step')!));
if (qs.get('markers')) markers(qs.get('markers')!);
if (qs.get('beacon')) world.setBeaconRaised(qs.get('beacon') === '1');
const sh = qs.get('shot');
if (sh === 'beacon') sky(); else if (sh === 'star') starView(); else if (sh) shot(sh, (qs.get('d') as 'close' | 'play') || 'play');

let last = performance.now();
engine.runRenderLoop(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!paused) advance(dt);
  scene.render();
  if (qs.get('info')) info.textContent = JSON.stringify(gfx());
});
addEventListener('resize', () => engine.resize());
