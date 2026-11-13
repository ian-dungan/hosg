import { describe, expect, it } from 'vitest';
import {
  GROVE_EAST_GATE, GUILD_BOARD, QUESTS, STORY_NPCS, STORY_PROPS, greenwayLayout, pimGround,
  type QuestId, type QuestsView,
} from '@sg2/shared';
import {
  actWithChoice, createClientQuests, journalView, onQuestDone, onQuestRefused, onQuests, parseQuestsView, pointerTarget,
  rewardLine, talkPlan, track, trackerOf, QUEST_LOG_MAX,
} from './quests';

const stepIndex = (q: QuestId, id: string) => QUESTS[q].steps.findIndex((s) => s.id === id);
/** A view with the main quest at `step` (counts given or zeros), plus extras. */
function viewAt(step: string, counts?: number[], o: Partial<QuestsView> = {}): QuestsView {
  const i = stepIndex('solstice_crossing', step);
  const n = QUESTS.solstice_crossing.steps[i]!.objectives.length;
  return { active: [{ id: 'solstice_crossing', step: i, counts: counts ?? new Array(n).fill(0) }], done: [], offers: [], skipped: [], ...o };
}
const ctx = { beacon: false, job: 'warrior', device: 'touch' as const };

describe('client quest state', () => {
  it('follows `quests`: the view, the steps that start, and nothing new for the same view again (a reconnect, the midnight resend)', () => {
    const q = createClientQuests();
    expect(onQuests(q, viewAt('marrow')).started).toEqual([]); // the first view of a session starts nothing
    expect(q.view?.active[0]?.step).toBe(0);
    const r = onQuests(q, viewAt('pim_find'));
    expect(r.changed).toBe(true);
    expect(r.started).toEqual([{ quest: 'solstice_crossing', stepId: 'pim_find', index: 1 }]);
    expect(onQuests(q, viewAt('pim_find'))).toEqual({ changed: false, started: [] });
    // the midnight resend: a daily done yesterday is offered again; no step starts
    const yesterday = viewAt('gate', [0], { done: [{ id: 'bristle_bounty', times: 1, today: true }] });
    onQuests(q, yesterday);
    const midnight = onQuests(q, viewAt('gate', [0], { done: [{ id: 'bristle_bounty', times: 1, today: false }], offers: ['bristle_bounty'] }));
    expect(midnight.changed).toBe(true);
    expect(midnight.started).toEqual([]);
  });

  it('drops junk in a view (unknown ids, bad steps, duplicates) and ignores what is not a view', () => {
    const q = createClientQuests();
    expect(onQuests(q, 'nope').changed).toBe(false);
    expect(q.view).toBeNull();
    const v = parseQuestsView({ active: [{ id: 'solstice_crossing', step: 3, counts: [0] }, { id: 'solstice_crossing', step: 4, counts: [] }, { id: 'evil', step: 0, counts: [] }, { id: 'keepers_lamp', step: 99, counts: [] }],
      done: [{ id: 'x', times: 1 }], offers: ['bristle_bounty', 'nope'], skipped: [3] });
    expect(v).toEqual({ active: [{ id: 'solstice_crossing', step: 3, counts: [0] }], done: [], offers: ['bristle_bounty'], skipped: [] });
  });

  it('logs completions and refusals (the last 20), and refusals carry their plain line', () => {
    const q = createClientQuests();
    for (let i = 0; i < 25; i++) onQuestDone(q, { quest: 'solstice_crossing', step: 0, stepId: 'marrow', xp: 20, gold: 0, item: null, title: null, unlock: null, scene: null, questDone: false });
    expect(q.history).toHaveLength(QUEST_LOG_MAX);
    expect(onQuestDone(q, { quest: 'nope' })).toBeNull();
    const r = onQuestRefused(q, { act: 'talk', reason: 'where', text: 'You need to be closer.' });
    expect(r).toEqual({ act: 'talk', reason: 'where', text: 'You need to be closer.' });
    expect(q.refusals.at(-1)).toBe('You need to be closer.');
  });

  it('trackerOf gives the tracked step with counts, done lines marked, the hint and how many more', () => {
    const q = createClientQuests();
    onQuests(q, viewAt('first_fight', [2, 1, 0, 0], { active: [...viewAt('first_fight', [2, 1, 0, 0]).active, { id: 'bristle_bounty', step: 0, counts: [4] }] }));
    const t = trackerOf(q, 'touch')!;
    expect(t.title).toBe('The Solstice Crossing');
    expect(t.steps).toEqual([
      { text: 'Defeat Thornlings 2/3', done: false }, { text: 'Spend Momentum on a finisher', done: true },
      { text: 'Land a combo', done: false }, { text: 'Dodge roll in a fight', done: false },
    ]);
    expect(t.hint).toBe('Tap a Thornling, then stay close. You attack by yourself.');
    expect(t.more).toBe(1);
    expect(track(q, 'bristle_bounty')).toBe(true);
    expect(trackerOf(q, 'touch')!.steps).toEqual([{ text: 'Defeat Bramble Boars 4/6', done: false }]);
    expect(track(q, 'keepers_lamp')).toBe(false); // not active
    // the waymarks' shared line counts the stones found
    onQuests(q, { active: [{ id: 'grans_waymarks', step: 0, counts: [1, 0, 1] }], done: [{ id: 'solstice_crossing', times: 1, today: true }], offers: [], skipped: [] });
    expect(q.tracked).toBe('grans_waymarks'); // the main quest is done: the tracker follows what is active
    expect(trackerOf(q, 'desktop')!.steps).toEqual([{ text: 'Find the old waymarks 2/3', done: false }]);
  });

  it('pointerTarget: Marrow at step 0, the tavern circle at pim_find, the east gate for Nell from the grove, the nearest Thornling camp, the crater edge', () => {
    const q = createClientQuests();
    onQuests(q, viewAt('marrow'));
    expect(pointerTarget(q, 'grove')).toMatchObject({ x: STORY_NPCS.marrow.x, z: STORY_NPCS.marrow.z, label: 'Old Marrow' });
    onQuests(q, viewAt('pim_find'));
    expect(pointerTarget(q, 'grove')).toMatchObject({ x: pimGround().x, z: pimGround().z });
    onQuests(q, viewAt('pim_hop'));
    expect(pointerTarget(q, 'grove')).toBeNull(); // a jump: nothing to point at
    onQuests(q, viewAt('board'));
    expect(pointerTarget(q, 'grove')).toMatchObject({ x: GUILD_BOARD.x, z: GUILD_BOARD.z });
    onQuests(q, viewAt('nell'));
    expect(pointerTarget(q, 'grove')).toMatchObject({ x: GROVE_EAST_GATE.x, z: GROVE_EAST_GATE.z, label: 'East gate' });
    expect(pointerTarget(q, 'greenway')).toMatchObject({ x: STORY_NPCS.nell.x, z: STORY_NPCS.nell.z, label: 'Nell Thistlewood' });
    onQuests(q, viewAt('first_fight'));
    const from = { x: STORY_NPCS.nell.x, z: STORY_NPCS.nell.z };
    const thorn = greenwayLayout().camps.filter((c) => c.spawns.some((s) => s.kind === 'thornling'))
      .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z))[0]!;
    expect(pointerTarget(q, 'greenway', from)).toMatchObject({ x: thorn.x, z: thorn.z });
    onQuests(q, viewAt('crater'));
    expect(pointerTarget(q, 'greenway')).toMatchObject({ x: STORY_PROPS.crater_edge.x, z: STORY_PROPS.crater_edge.z });
    const gate = greenwayLayout().westGate;
    onQuests(q, viewAt('plaque'));
    expect(pointerTarget(q, 'greenway')).toMatchObject({ x: gate.x, z: gate.z });
    onQuests(q, viewAt('equip'));
    expect(pointerTarget(q, 'greenway')).toBeNull();
  });

  it('talkPlan: the step lines and their act, offers, Marrow\'s menu, Pim\'s call, idle lines (sent nothing)', () => {
    const m = talkPlan('marrow', viewAt('marrow'), ctx);
    expect(m.kind).toBe('step');
    expect(m.kind === 'step' && m.act).toEqual({ act: 'talk', npc: 'marrow' });
    expect(m.say.lines).toHaveLength(5);
    expect(talkPlan('marrow', viewAt('pim'), ctx).kind).toBe('menu');
    expect(talkPlan('pim', viewAt('pim_find'), ctx)).toMatchObject({ kind: 'idle', say: { lines: ['Up here! No, higher. Give a hop, so I can see your face over the rail.'] } });
    expect(talkPlan('pim', viewAt('pim'), ctx).kind).toBe('step');
    expect(talkPlan('plaque', viewAt('plaque'), ctx)).toMatchObject({ kind: 'step', act: { act: 'use', prop: 'plaque' } });
    expect(talkPlan('plaque', viewAt('board'), ctx).kind).toBe('idle');
    const bram = talkPlan('bram', viewAt('nell', [0], { offers: ['bristle_bounty', 'grans_waymarks'] }), ctx);
    expect(bram).toMatchObject({ kind: 'offer', quest: 'bristle_bounty' });
    expect(talkPlan('tamsin', viewAt('nell', [0], { offers: ['bristle_bounty', 'grans_waymarks'] }), ctx)).toMatchObject({ kind: 'offer', quest: 'grans_waymarks' });
    expect(talkPlan('bram', viewAt('marrow'), ctx).kind).toBe('idle');
    const nell = talkPlan('nell', viewAt('nell_report'), ctx);
    expect(nell.kind).toBe('step');
    expect(nell.say.choices).toEqual([
      'Mossweave Robe — cloth: stronger abilities', 'Thornrunner Jerkin — light: faster Momentum', 'Rootbound Hauberk — heavy: they come for you, not your friends',
    ].map((s) => expect.stringContaining(s.split(' — ')[1]!)));
    if (nell.kind === 'step') {
      expect(actWithChoice(nell, 1)).toEqual({ act: 'talk', npc: 'nell', choice: 1 });
      expect(actWithChoice(nell, -1)).toBeNull();
      expect(actWithChoice(nell, 3)).toBeNull();
    }
    if (m.kind === 'step') { expect(actWithChoice(m, 0)).toEqual({ act: 'talk', npc: 'marrow' }); expect(actWithChoice(m, -1)).toBeNull(); }
  });

  it('journalView: no Drop for the main quest, Skip only on the optional step, Bram\'s bounty offered after the gate with its giver', () => {
    const q = createClientQuests();
    onQuests(q, viewAt('duo', [0, 0], { offers: ['bristle_bounty', 'grans_waymarks'] }));
    let j = journalView(q, 'touch');
    expect(j.active[0]).toMatchObject({ id: 'solstice_crossing', canDrop: false, canSkip: true, tracked: true });
    expect(j.active[0]!.steps.at(-1)).toMatchObject({ state: 'current' });
    expect(j.active[0]!.steps[0]).toEqual({ text: 'Speak with Old Marrow', state: 'done' });
    expect(j.active[0]!.steps[8]).toEqual({ text: 'Defeat Thornlings', state: 'done' });
    expect(j.offers.map((o) => [o.id, o.giver, o.canAccept])).toEqual([['bristle_bounty', 'Bram, at the tavern', false], ['grans_waymarks', 'Tamsin, at the river dock', false]]);
    onQuests(q, viewAt('nell_report', [0], { skipped: ['solstice_crossing:duo'], active: [...viewAt('nell_report').active, { id: 'bristle_bounty', step: 0, counts: [2] }] }));
    j = journalView(q, 'touch');
    expect(j.active[0]!.canSkip).toBe(false);
    expect(j.active[0]!.steps[10]).toMatchObject({ state: 'skipped' });
    expect(j.active[1]).toMatchObject({ id: 'bristle_bounty', canDrop: true, canSkip: false, kind: 'daily' });
    expect(rewardLine('solstice_crossing')).toBe('350 xp · 95 gold · a chest piece of your choice · the title Witness of the Crossing');
    onQuests(q, { active: [], done: [{ id: 'solstice_crossing', times: 1, today: true }, { id: 'bristle_bounty', times: 3, today: true }], offers: ['keepers_lamp'], skipped: [] });
    j = journalView(q, 'touch');
    expect(j.offers[0]).toMatchObject({ id: 'keepers_lamp', giver: null, canAccept: true });
    expect(j.done).toEqual([
      { id: 'solstice_crossing', name: 'The Solstice Crossing', times: 1, today: true, daily: false, title: 'Witness of the Crossing' },
      { id: 'bristle_bounty', name: 'Bristle Bounty', times: 3, today: true, daily: true, title: null },
    ]);
    expect(trackerOf(q, 'touch')).toBeNull();
  });
});
