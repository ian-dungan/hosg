// Shady Grove 2: Windward — walkable town demo.
// Joins the world, the player rig, the NPCs and the HUD. No combat, no server.
import { Engine, Scene, Vector3 } from '@babylonjs/core';
import type { AnchorName, CharacterView, HudState, TapInfo } from './core/contracts';
import { buildWorld } from './world/index';
import { createPlayerRig } from './player/rig';
import { makeCharacter } from './player/character';
import { createHud } from './hud/index';

const INTERACT_RANGE = 3.6;

interface Interactable {
  id: number;
  label: string;          // prompt text
  pos: Vector3;
  view: CharacterView | null;
  talk: () => Promise<void>;
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const hudRoot = document.getElementById('hud') as HTMLElement;
  const touch = matchMedia('(pointer: coarse)').matches;

  const engine = new Engine(canvas, !touch, { stencil: true, powerPreference: 'high-performance' });
  // Cap render resolution so phones stay smooth.
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
  const scene = new Scene(engine);

  const world = buildWorld(scene);
  world.setQuality(touch ? 'med' : 'high');
  const hud = createHud(hudRoot);

  const interactables: Interactable[] = [];
  let busy = false;                     // true while a dialogue or cutscene runs
  const done = { marrow: false, plaque: false, pim: false, beacon: false };

  const rig = createPlayerRig(scene, {
    canvas,
    world,
    joystick: () => hud.joystick(),
    onTap: (tap: TapInfo) => {
      if (busy || tap.entityId === null) return;
      const it = interactables.find((i) => i.id === tap.entityId);
      if (!it) return;
      if (Vector3.Distance(it.pos, rig.position) <= INTERACT_RANGE + 1.5) void run(it);
      else hud.toast('Move closer');
    },
  });
  const start = world.anchor('playerStart');
  rig.teleport(start.pos, start.facing);

  // ── helpers ──
  const say = (speaker: string, lines: string[], choices?: string[]) => hud.dialogue(speaker, lines, choices);

  async function run(it: Interactable): Promise<void> {
    if (busy) return;
    busy = true;
    rig.setMoveScale(0);
    rig.faceTowards(it.pos.x, it.pos.z);
    if (it.view) {
      const dx = rig.position.x - it.pos.x, dz = rig.position.z - it.pos.z;
      it.view.root.rotation.y = Math.atan2(dx, dz);
    }
    try {
      await it.talk();
    } finally {
      rig.setMoveScale(1);
      busy = false;
    }
  }

  function addNpc(id: number, anchor: AnchorName, label: string, color: string | undefined, offset: Vector3, talk: () => Promise<void>): void {
    const a = world.anchor(anchor);
    const view = makeCharacter(scene, { kind: 'npc', color, weapon: 'none' });
    const x = a.pos.x + offset.x, z = a.pos.z + offset.z;
    const y = world.groundAt(x, z) ?? a.pos.y;
    view.root.position.set(x, y, z);
    view.root.rotation.y = a.facing;
    view.setEntityId(id);
    view.setPose('idle');
    interactables.push({ id, label, pos: view.root.position, view, talk });
  }
  function addSpot(id: number, anchor: AnchorName, label: string, talk: () => Promise<void>): void {
    interactables.push({ id, label, pos: world.anchor(anchor).pos, view: null, talk });
  }

  // ── the people of Shady Grove ──
  addNpc(1, 'marrow', 'Talk to Old Marrow', undefined, Vector3.Zero(), async () => {
    if (!done.marrow) {
      await say('Old Marrow', [
        'Ah, there you are. Mind the plinth, it has outlasted better boots than yours.',
        'Seventy years those two have pointed at that empty patch of sky. Every solstice I say: this is the year.',
        'Every solstice, nothing. Still. Fair winds to the Two.',
      ]);
      done.marrow = true;
    }
    for (;;) {
      const pick = await say('Old Marrow', ['What would you like to know?'], [
        'Who were Ellie and Felix?',
        'What is this place?',
        'Goodbye',
      ]);
      if (pick === 0) {
        await say('Old Marrow', [
          'The greatest adventurers Shady Grove ever raised. Ellie found the way; Felix made it possible.',
          'She never went anywhere without a charcoal stick and a half-drawn map. He mended whatever she broke, and could talk a frightened town into courage.',
          'When the sky-lands tore loose and drifted off, they built a ship that could sail the wind and went up after them. Nobody here calls them lost.',
        ]);
      } else if (pick === 1) {
        await say('Old Marrow', [
          'Shady Grove. The very same one. Those old trees were shading this square before either of them could walk.',
          'The east road runs all the way to Normandy, the capital, and the world is a hundred times wider than folk here think. For now it is a quiet town with a good statue.',
        ]);
      } else break;
    }
  });

  addNpc(2, 'groveDock', 'Talk to Tamsin', '#3FB0A6', new Vector3(1.5, 0, -1.5), async () => {
    await say('Tamsin, the ferrywoman', [
      'No ferry today, friend. The river is running high, and the road to Normandy is a long one on foot.',
      done.beacon
        ? 'Well. There is an island. In the sky. I am going to need a much better boat.'
        : 'My gran swore there was land up where the statue points. In the sky! Gran also swore gulls could read.',
    ]);
  });

  addNpc(3, 'pim', 'Talk to Bram', '#EC6A4C', new Vector3(2.2, 0, 1.2), async () => {
    await say('Bram, the tavern keeper', [
      'Welcome to the Second Chance. Named for their ship, same as the figurehead over my door.',
      'Don\'t mind old Pim up there. Carved wood. Hasn\'t said a word in seventy years, whatever the children tell you.',
    ]);
  });

  addSpot(10, 'statuePlinth', 'Read the plaque', async () => {
    await say('The plaque', [
      'ELLIE and FELIX. The Two.',
      '"She found the way. He made it possible."',
      'Raised by the grateful people of Shady Grove. Fair winds.',
    ]);
    done.plaque = true;
    if (done.marrow && done.pim && !done.beacon) await solstice();
  });

  addSpot(11, 'pim', 'Look up at the figurehead', async () => {
    await say('Pim, the figurehead', [
      '...',
      'Psst. You. Boot-scuffer. Yes, you. Don\'t tell Bram I can talk, he will want rent.',
      'I sailed with them, you know. Ellie at the bow, Felix at the helm, me out front looking magnificent.',
      done.beacon
        ? 'They did it. They actually did it! Find us a ship. Ellie always hated being kept waiting.'
        : 'Go and read their plaque when the sun is behind the spyglass. I have a feeling about today.',
    ]);
    done.pim = true;
  });

  async function solstice(): Promise<void> {
    await say('Old Marrow', ['Wait. Look at the spyglass. The bronze is humming!']);
    hud.setVisible(false);
    try {
      await world.raiseBeacon();
    } catch (e) {
      console.warn('raiseBeacon failed', e);
    }
    hud.setVisible(true);
    done.beacon = true;
    hud.banner('The Beacon', 'An island appears in the sky');
    await say('Old Marrow', [
      'Seventy years. They were pointing at something after all.',
      'That is the end of this little demo, wayfarer. The road, the wide world and, one day, the sky come next.',
    ]);
  }

  // ── HUD state ──
  const state: HudState = {
    player: { name: 'Wayfarer', hp: 100, maxHp: 100, statuses: [], level: 1, weapon: 'blade', cast: null },
    target: null,
    party: [],
    slots: [],
    quest: null,
    prompt: null,
    inCombat: false,
  };
  let nearest: Interactable | null = null;

  function refreshQuest(): void {
    state.quest = {
      title: 'The Solstice Crossing',
      steps: [
        { text: 'Speak with Old Marrow', done: done.marrow },
        { text: 'Find the voice above the tavern', done: done.pim },
        { text: 'Read the plaque on the statue', done: done.beacon || (done.plaque && !(done.marrow && done.pim)) },
        ...(done.beacon ? [{ text: 'Watch the Beacon rise', done: true }] : []),
      ],
    };
  }

  hud.on((e) => {
    if (e.type === 'interact' && nearest && !busy) void run(nearest);
  });

  let last = performance.now();
  engine.runRenderLoop(() => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    rig.update(dt);
    world.update(dt);

    nearest = null;
    let best = INTERACT_RANGE;
    for (const it of interactables) {
      it.view?.update(dt);
      const d = Vector3.Distance(it.pos, rig.position);
      if (d < best) { best = d; nearest = it; }
    }
    for (const it of interactables) it.view?.setTargeted(it === nearest && !busy);

    state.prompt = busy || !nearest ? null : nearest.label;
    refreshQuest();
    hud.render(state);
    scene.render();
  });
  window.addEventListener('resize', () => engine.resize());

  // Expose a few handles for automated playtests.
  (window as unknown as Record<string, unknown>).__sg2 = { rig, world, hud, interactables, done, scene, engine };

  await hud.titleScreen();
  hud.banner('The Plaza of the Two', 'Shady Grove');
}

void boot();
