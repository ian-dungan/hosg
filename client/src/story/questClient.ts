// The quest in the online game (Plan 6 Task 6): one per room, made on entering it and disposed when it ends (a
// zone change, a logout), with its listeners and DOM. It joins the pure quest flow (net/questFlow.ts) to the
// game: taps on the story's people and props (walk over, then talk, like the Guild Board), E and the context
// prompt (the nearest wins, the board included), the tracker and the edge pointer, the board's quest line, the
// scenes (story/scenes.ts), and the adventurer held still while one plays. Per frame it allocates nothing:
// the tracker and the pointer's target are rebuilt only when the view changes (or twice a second as the
// adventurer walks), and the pointer's projection reuses its vectors.
import { Matrix, Vector3, type Viewport } from '@babylonjs/core';
import {
  GUILD_BOARD, LAMPFALL_MOUTH, MAIN_QUEST, NPC_REACH, PROP_REACH, NPC_NAMES, PROP_NAMES, QUEST_TEXT, boardHeader, isNpcId,
  type InvOp, type JobId, type QuestAct, type ZoneId,
} from '@sg2/shared';
import type { HudApi, HudState, TapInfo } from '../core/contracts';
import type { Game } from '../boot';
import type { CombatController } from '../combat/controller';
import { GUILD_BOARD_REACH } from '../world/guildBoard';
import { beaconRaisedFor, storyIdOf, type StoryWorld } from '../world/storyNpcs';
import { boardHint } from '../hud/jobs';
import { pointerLayout } from '../hud/questPointer';
import { TAVERN_YAW } from '../world/layout';
import { createQuestFlow, type HintStore, type QuestFlow } from '../net/questFlow';
import { currentStep, pointerTarget, shortName, trackerOf, type ClientQuests, type PointerTarget, type StoryId } from '../net/quests';
import { equipHook } from '../net/equipHook';
import { storyOfTap } from '../net/tapOrder';
import { newPieceHook } from '../net/questHooks';
import { createStoryScenes, type StoryScenes } from './scenes';

export interface QuestClientOpts {
  game: Game; hud: HudApi; state: HudState; zone: ZoneId;
  /** The quest state (kept across rooms: the tracked quest survives a zone change). */
  quests: ClientQuests;
  story: () => StoryWorld | null;
  combat: () => CombatController | null;
  send: (act: QuestAct) => boolean;
  sendInv: (op: InvOp) => boolean;
  learned: HintStore;
}
export interface QuestClient {
  readonly flow: QuestFlow;
  readonly scenes: StoryScenes;
  /** A scene holds the adventurer still (online.ts sets the move scale to 0 after the controller's). */
  readonly holding: boolean;
  /** A room message: quests, questDone, questRefused, inventory. */
  message(type: string, m: unknown): void;
  /** A tap on the 3D view: true when it was on a story person or prop (handled here). */
  onTap(tap: TapInfo): boolean;
  /** E or the prompt button: true when the prompt is a story spot's (handled here). */
  interact(): boolean;
  openJournal(): void;
  /** A tap on the pointer chip: walk toward the objective. */
  pointerTap(): void;
  /** Per frame, after the controller's update (the prompt, the tracker, the pointer, the scenes). */
  update(dt: number): void;
  readonly debug: { tracker: { title: string; lines: string[] } | null; pointer: { label: string; onScreen: boolean } | null };
  dispose(): void;
}

const VERB: Record<string, string> = { plaque: 'Read', crater_edge: 'Look', waymark_1: 'Look', waymark_2: 'Look', waymark_3: 'Look' };
/** The context prompt for a story spot: "Talk · Old Marrow", "Read · The plaque". */
export const storyPrompt = (id: StoryId): string => (isNpcId(id) ? `Talk · ${shortName(NPC_NAMES[id])}` : `${VERB[id] ?? 'Look'} · ${PROP_NAMES[id]}`);
const reachOf = (id: StoryId) => (isNpcId(id) ? NPC_REACH : PROP_REACH);
const PROMPTS = new Map<StoryId, string>();
const promptOf = (id: StoryId) => { let p = PROMPTS.get(id); if (!p) { p = storyPrompt(id); PROMPTS.set(id, p); } return p; };

export function createQuestClient(o: QuestClientOpts): QuestClient {
  const { game, hud, state, zone } = o;
  const device = game.touch ? 'touch' : 'desktop';
  let disposed = false;
  const spotOf = (id: StoryId) => o.story()?.spots.find((s) => s.id === id) ?? null;
  const distanceTo = (id: StoryId) => { const s = spotOf(id); return s ? Math.hypot(s.x - game.rig.position.x, s.z - game.rig.position.z) : Infinity; };
  const self = () => o.combat()?.debug.self ?? null;
  const ctx = {
    beacon: false, job: 'warrior' as JobId, inCombat: false, dead: false, momentum: 0, inDanger: false, hasTarget: false, distanceTo,
  };
  const readCtx = () => {
    ctx.beacon = beaconRaisedFor(o.quests.view);
    ctx.job = (self()?.job ?? 'warrior') as JobId;
    ctx.inCombat = state.inCombat; ctx.dead = !!state.player.dead;
    ctx.momentum = state.player.momentum ?? 0; ctx.inDanger = !!o.combat()?.debug.inDanger; ctx.hasTarget = state.target !== null;
    return ctx;
  };

  // ── the scenes: they hand control back when the adventurer moves, is hurt or a fight starts ──
  let sceneHp = Infinity, sceneMoveAt = 0;
  const scenes = createStoryScenes({
    scene: game.scene, world: game.world, rig: game.rig, zone,
    hudVisible: (on) => hud.setVisible(on),
    interrupted: () => {
      const j = hud.joystick();
      return Math.hypot(j.x, j.y) > 0.35 || game.walkOverriddenAt > sceneMoveAt || state.player.hp < sceneHp || state.inCombat;
    },
  });
  const sceneStart = () => { sceneHp = state.player.hp; sceneMoveAt = performance.now(); };

  let talkingId: StoryId | null = null;
  const flow = createQuestFlow({
    hud, device, learned: o.learned,
    send: (act) => !disposed && o.send(act),
    ctx: readCtx,
    scenes: {
      beacon: () => { sceneStart(); return scenes.beacon(); },
      crater: () => { sceneStart(); return scenes.crater({ x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z }); },
      ring: () => scenes.ring(),
    },
    onTalk: (id) => {
      const story = o.story();
      if (talkingId && isNpcId(talkingId)) story?.face(talkingId, null);
      talkingId = id;
      if (!id) { scenes.frameTalk(null); return; }
      const s = spotOf(id);
      if (!s) return;
      const p = game.rig.position;
      game.walkTo(null);
      game.rig.faceTowards(s.x, s.z);
      if (isNpcId(id)) story?.face(id, { x: p.x, z: p.z });
      scenes.frameTalk(id === 'pim' ? { x: s.x, z: s.z, lift: 5, facing: TAVERN_YAW } : { x: s.x, z: s.z, still: !isNpcId(id) });
    },
    equipNow: (uid) => o.sendInv({ op: 'equip', uid, slot: 'chest' }),
    // (read when the prompt opens: the bag sheet may fill its hook after this room began)
    get openBag() { return equipHook.open ? () => { equipHook.open?.(); return true; } : null; },
    highlight: (uid) => { newPieceHook.uid = uid; },
    now: () => performance.now(),
  }, o.quests);

  /** Talk to a spot now if in reach, else walk over first (Tap to walk on), else say to come closer. */
  const approach = (id: StoryId) => {
    const s = spotOf(id);
    if (!s || state.player.dead) return;
    const reach = reachOf(id);
    if (distanceTo(id) <= reach) { game.walkTo(null); void flow.talk(id); return; }
    if (!hud.settings.tapToWalk) { hud.toast(QUEST_TEXT.where); return; }
    const y = game.world.groundAt(s.x, s.z) ?? game.rig.position.y;
    if (!game.walkTo(new Vector3(s.x, y, s.z), { within: reach - 0.6, then: () => { if (!disposed) void flow.talk(id); } })) hud.toast(QUEST_TEXT.where);
  };

  // ── the prompt ──
  let promptId: StoryId | null = null;
  const updatePrompt = () => {
    promptId = null;
    const story = o.story();
    if (!story || state.player.dead || flow.talking || scenes.holding) return;
    const p = game.rig.position;
    let best: StoryId | null = null, bd = Infinity;
    for (const s of story.spots) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d <= reachOf(s.id) && d < bd) { bd = d; best = s.id; }
    }
    if (!best) return;
    // the nearest wins: the Guild Board's prompt stays when it is nearer; any other prompt (a revive) stays
    const boardPrompt = zone === 'grove' && Math.hypot(GUILD_BOARD.x - p.x, GUILD_BOARD.z - p.z) <= GUILD_BOARD_REACH;
    if (state.prompt && !(boardPrompt && Math.hypot(GUILD_BOARD.x - p.x, GUILD_BOARD.z - p.z) > bd)) return;
    promptId = best;
    state.prompt = promptOf(best);
  };

  // ── the tracker and the pointer (rebuilt on a new view or a re-track; the target twice a second) ──
  let seenView: unknown = undefined, seenTracked = '';
  let target: PointerTarget | null = null, targetAt = 0, targetIsSpot = false;
  const debug: QuestClient['debug'] = { tracker: null, pointer: null };
  const proj = new Vector3(), world = new Vector3();
  let viewport: Viewport | null = null, vpW = 0, vpH = 0;
  const layout = { x: 0, y: 0, angle: 0, onScreen: false };
  const pointer = { x: 0, y: 0, label: '', onScreen: false, angle: 0 };
  const dbgPointer = { label: '', onScreen: false };
  const refreshTracker = () => {
    state.quest = trackerOf(o.quests, device);
    debug.tracker = state.quest ? { title: state.quest.title, lines: state.quest.steps.map((s) => s.text) } : null;
    const main = currentStep(o.quests.view, MAIN_QUEST);
    boardHint.line = main?.step.id === 'board' ? boardHeader(ctx.job) : null;
  };
  const refreshTarget = () => {
    const p = game.rig.position;
    target = pointerTarget(o.quests, zone, { x: p.x, z: p.z });
    // a story spot has its own marker over it: the pointer shows only while it is off screen
    targetIsSpot = !!target && !!o.story()?.spots.some((s) => Math.abs(s.x - target!.x) < 0.01 && Math.abs(s.z - target!.z) < 0.01);
  };
  const updatePointer = () => {
    const cv = game.scene.getEngine().getRenderingCanvas(), cam = game.scene.activeCamera;
    if (!target || !cv || !cam || scenes.holding || flow.talking) { hud.pointer(null); debug.pointer = null; return; }
    const w = cv.clientWidth, hh = cv.clientHeight;
    if (!viewport || w !== vpW || hh !== vpH) { vpW = w; vpH = hh; viewport = cam.viewport.toGlobal(w, hh); }
    world.set(target.x, (game.world.groundAt(target.x, target.z) ?? game.rig.position.y) + 1.6, target.z);
    Vector3.ProjectToRef(world, Matrix.IdentityReadOnly, game.scene.getTransformMatrix(), viewport, proj);
    pointerLayout(proj.x, proj.y, proj.z > 0 && proj.z < 1, w, hh, hud.exclusions(), layout);
    if (layout.onScreen && targetIsSpot) { hud.pointer(null); debug.pointer = null; return; }
    pointer.x = layout.x; pointer.y = layout.y; pointer.angle = layout.angle; pointer.onScreen = layout.onScreen; pointer.label = target.label;
    hud.pointer(pointer);
    dbgPointer.label = target.label; dbgPointer.onScreen = layout.onScreen;
    debug.pointer = dbgPointer;
  };

  return {
    flow, scenes,
    get holding() { return scenes.holding; },
    message(type, m) { flow.message(type, m); },
    onTap(tap) {
      if (disposed) return false;
      // a story spot under the tap wins over the adventurers in front of it (an enemy in front: routeTap sent it to combat)
      const id = storyOfTap(tap, storyIdOf);
      if (!id || !spotOf(id)) return false;
      approach(id);
      return true;
    },
    interact() {
      if (!promptId || disposed) return false;
      void flow.talk(promptId);
      return true;
    },
    openJournal() { void flow.openJournal(); },
    pointerTap() {
      if (!target || disposed) return;
      const spot = o.story()?.spots.find((s) => Math.abs(s.x - target!.x) < 0.01 && Math.abs(s.z - target!.z) < 0.01);
      if (spot) { approach(spot.id); return; }
      if (!hud.settings.tapToWalk) return;
      const y = game.world.groundAt(target.x, target.z) ?? game.rig.position.y;
      game.walkTo(new Vector3(target.x, y, target.z), { within: 2.5, then: () => {} });
    },
    update(dt) {
      if (disposed) return;
      readCtx();
      scenes.update(dt);
      flow.update();
      if (o.quests.view !== seenView || o.quests.tracked !== seenTracked) {
        seenView = o.quests.view; seenTracked = o.quests.tracked;
        refreshTracker();
        refreshTarget(); targetAt = performance.now();
      } else if (performance.now() - targetAt > 500) { refreshTarget(); targetAt = performance.now(); }
      updatePrompt();
      updatePointer();
    },
    debug,
    dispose() {
      if (disposed) return;
      disposed = true;
      flow.dispose();
      scenes.dispose();
      if (talkingId && isNpcId(talkingId)) o.story()?.face(talkingId, null);
      hud.pointer(null);
      boardHint.line = null;
      newPieceHook.uid = null;
      state.quest = null;
    },
  };
}

/** Learned hints, kept in this browser (localStorage; a private window simply learns again). */
export function browserHintStore(key = 'sg2.questHints'): HintStore {
  let set: Set<string>;
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]'); set = new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(-80) : []); } catch { set = new Set(); }
  return {
    has: (id) => set.has(id),
    add: (id) => {
      if (set.has(id)) return;
      set.add(id);
      try { localStorage.setItem(key, JSON.stringify([...set].slice(-80))); } catch { /* storage off: learned for this page only */ }
    },
  };
}
