// Dev harness for the quest on the client (dev/quest.html; not in either build): the grove or the Greenway, the
// story's people and props, and the online quest client against a stand-in server that runs the shared quest
// rules (applyQuestAct, applyQuestEvents, questsView) and answers in the server's order (questDone, then quests,
// then inventory; nothing at all for a talk that completes nothing). For layout checks and screenshots without a
// game server. ?zone=greenway, ?step=<main step id>, ?side=bristle_bounty,grans_waymarks, ?bagfull, ?done (the
// main quest done). window.__qdev drives it.
import { Vector3 } from '@babylonjs/core';
import {
  ITEMS, MAIN_QUEST, QUESTS, QUEST_TEXT, STORY_NPCS, STORY_PROPS, applyQuestAct, applyQuestEvents, newQuestSave, questsView,
  type QuestAct, type QuestEvent, type QuestGiven, type QuestId, type QuestSave, type StepDone, type ZoneId,
} from '@sg2/shared';
import { bootGame } from '../boot';
import type { HudState } from '../core/contracts';
import { createGuildBoard } from '../world/guildBoard';
import { beaconRaisedFor, createStoryWorld, type StoryWorld } from '../world/storyNpcs';
import { createClientQuests } from '../net/quests';
import { createQuestClient, storyPrompt, type QuestClient } from './questClient';
import type { HintStore } from '../net/questFlow';

const qs = new URLSearchParams(location.search);
const zone = (qs.get('zone') === 'greenway' ? 'greenway' : 'grove') as ZoneId;
const DAY = '2026-11-13';

// ── the stand-in server ──
let save: QuestSave = newQuestSave(DAY);
const at = (q: QuestId, id: string) => QUESTS[q].steps.findIndex((s) => s.id === id);
const counts = (q: QuestId, i: number) => QUESTS[q].steps[i]!.objectives.map(() => 0);
if (qs.has('done')) save = { ...save, active: [], done: { solstice_crossing: { day: DAY, times: 1, choice: 1 } } };
else if (qs.get('step')) { const i = Math.max(0, at(MAIN_QUEST, qs.get('step')!)); save = { ...save, active: [{ id: MAIN_QUEST, step: i, counts: counts(MAIN_QUEST, i), since: DAY }] }; }
for (const id of (qs.get('side') ?? '').split(',').filter(Boolean) as QuestId[]) save = { ...save, active: [...save.active, { id, step: 0, counts: counts(id, 0), since: DAY }] };
let bag: { uid: number; item: string; worn: string[] }[] = [{ uid: 1, item: 'starter_chest', worn: ['warrior'] }];
const bagFree = () => (qs.has('bagfull') ? 0 : 20);
let nextUid = 10;
const times = (q: QuestId) => (save.done[q]?.times ?? 0) + 1;
const outbox: [string, unknown][] = [];
const post = (type: string, m: unknown) => { outbox.push([type, m]); };
const sentLog: unknown[] = [];
let lastView = '';
const sendView = () => { const v = questsView(save, DAY); const s = JSON.stringify(v); if (s !== lastView) { lastView = s; post('quests', v); } };
const pay = (done: StepDone[]) => {
  for (const d of done) {
    const step = QUESTS[d.quest].steps[d.step]!, r = step.reward;
    const item = r?.item ?? (r?.choice && d.choice !== null ? r.choice[d.choice]! : null);
    if (item) bag = [...bag, { uid: nextUid++, item, worn: [] }];
    const g: QuestGiven = { quest: d.quest, step: d.step, stepId: step.id, xp: r?.xp ?? 0, gold: r?.gold ?? 0, item: item ?? null, title: r?.title ?? null,
      unlock: r?.unlock ?? null, scene: step.scene ?? null, questDone: d.step === QUESTS[d.quest].steps.length - 1 };
    post('questDone', g);
  }
  sendView();
  if (done.some((d) => QUESTS[d.quest].steps[d.step]!.reward?.gold || QUESTS[d.quest].steps[d.step]!.reward?.choice)) post('inventory', { bag, gold: 0 });
};
const serverAct = (act: QuestAct) => {
  sentLog.push(act);
  const p = game.rig.position;
  const r = applyQuestAct(save, act, { zone, x: p.x, z: p.z, day: DAY, dead: false, busy: false, bagFree: bagFree() });
  if ('refusal' in r) { post('questRefused', { act: act.act, reason: r.refusal, text: QUEST_TEXT[r.refusal] }); return; }
  if ('none' in r) return; // silence
  save = r.save;
  pay(r.done);
};
const serverEvents = (evs: QuestEvent[]) => {
  const r = applyQuestEvents(save, evs, DAY);
  if (!r.changed) return;
  save = r.save;
  pay(r.done);
};

// ── the game ──
let quest: QuestClient | null = null;
const game = bootGame({ zone, onTap: (tap) => quest?.onTap(tap) ?? false });
const { hud } = game;
if (zone === 'grove') createGuildBoard(game.scene, game.world);
const story: StoryWorld = createStoryWorld(game.scene, game.world, zone, { quality: game.quality });
const state: HudState = {
  player: { name: 'Wren', hp: 1000, maxHp: 1000, statuses: [], level: 1, weapon: 'blade', cast: null, momentum: 0, job: { id: 'warrior', name: 'Warrior', glyph: '⚔', level: 1 } },
  target: null, party: [], slots: [], quest: null, prompt: null, inCombat: false,
};
const memory = new Set<string>();
const learned: HintStore = qs.has('learned') ? { has: () => true, add: () => {} } : { has: (id) => memory.has(id), add: (id) => { memory.add(id); } };
quest = createQuestClient({
  game, hud, state, zone, quests: createClientQuests(), story: () => story, combat: () => null,
  send: (act) => { serverAct(act); return true; },
  sendInv: (op) => { if (op.op === 'equip') { bag = bag.map((b) => (b.uid === op.uid ? { ...b, worn: ['warrior'] } : b.item.endsWith('chest') ? { ...b, worn: [] } : b)); post('inventory', { bag, gold: 0 }); serverEvents([{ e: 'equip', slot: 'chest', item: (bag.find((b) => b.uid === op.uid)?.item ?? 'starter_chest') as never }]); } return true; },
  learned,
});
hud.on((e) => {
  if (e.type === 'openJournal') quest?.openJournal();
  else if (e.type === 'pointerTap') quest?.pointerTap();
  else if (e.type === 'interact') quest?.interact();
  else if (e.type === 'openJobs' && zone === 'grove') serverEvents([{ e: 'job' }]);
});
// the first view (a step after joining), and the Beacon's state from it
post('quests', questsView(save, DAY)); lastView = JSON.stringify(questsView(save, DAY));
game.world.setBeaconRaised(beaconRaisedFor(questsView(save, DAY)));
story.setView(questsView(save, DAY));
post('inventory', { bag, gold: 0 });
hud.setVisible(true);
quest.flow.entered();
if (zone === 'greenway') serverEvents([{ e: 'reach', zone: 'greenway', x: game.rig.position.x, z: game.rig.position.z }]);

let jumpAt = 0;
const deliver = () => {
  for (const [type, m] of outbox.splice(0)) { quest?.message(type, m); if (type === 'quests') story.setView(m as never); }
};
const frame = (dt: number) => {
  deliver();
  state.prompt = null; // (online the combat controller sets it afresh each frame)
  story.setInCombat(state.inCombat);
  story.update(dt);
  quest?.update(dt);
  if (quest?.holding) game.rig.setMoveScale(0); else game.rig.setMoveScale(1);
  // places and hops, as the server sees them from accepted poses
  const p = game.rig.position;
  const g = game.world.groundAt(p.x, p.z);
  if (g !== null && p.y - g >= 0.6 && performance.now() - jumpAt > 1000) { jumpAt = performance.now(); serverEvents([{ e: 'jump' }]); }
  const cur = save.active.find((a) => a.id === MAIN_QUEST);
  const step = cur ? QUESTS[MAIN_QUEST].steps[cur.step] : null;
  const reach = step?.objectives.find((o) => o.k === 'reach');
  if (reach && reach.k === 'reach' && reach.zone === zone && reach.x !== undefined && Math.hypot(p.x - reach.x, p.z - reach.z!) <= (reach.r ?? 0)) serverEvents([{ e: 'reach', zone, x: p.x, z: p.z }]);
  hud.render(state);
};
game.start(frame);

/** Puts the adventurer `d` m from a story spot, facing it. */
function near(id: string, d = 2.4, side = 0): void {
  const s = story.spots.find((x) => x.id === id)!;
  const n = (STORY_NPCS as Record<string, { facing: number } | undefined>)[id];
  const f = n ? n.facing : Math.atan2(-s.x, -s.z);
  const x = s.x + Math.sin(f + side) * d, z = s.z + Math.cos(f + side) * d;
  game.rig.teleport(new Vector3(x, game.world.groundAt(x, z) ?? s.y, z), Math.atan2(s.x - x, s.z - z));
}
(window as unknown as Record<string, unknown>).__qdev = {
  game, hud, state, story, get quest() { return quest; }, get save() { return save; }, sent: sentLog, ITEMS, STORY_PROPS, storyPrompt,
  near,
  talk: (id: string) => quest?.flow.talk(id as never),
  event: (e: QuestEvent) => serverEvents([e]),
  combat: (on: boolean) => { state.inCombat = on; },
  /** Steps the world, the story and the scenes by s seconds of game time (headless WebGL runs about 1 fps). */
  advance: (s: number) => { const step = 1 / 30; for (let t = 0; t < s; t += step) { game.rig.update(step); game.world.update(step); frame(step); } },
  setTouch: () => {},
};
