import { describe, expect, it } from 'vitest';
import { BEACON_LINES, QUESTS, type QuestAct, type QuestGiven, type QuestId, type QuestsView } from '@sg2/shared';
import type { DialogueOpts, JournalAnswer, QuestCardOpts, QuestMoment } from '../core/contracts';
import { ANSWER_WAIT_MS, BAG_FULL_HELP, FIGHT_FIRST, FIRST_HINT, JOIN_HINT_MS, NOT_CONNECTED, TALK_LEAVE_M, createQuestFlow, type FlowCtx } from './questFlow';
import { trackerOf } from './quests';
import type { StoryId } from './quests';

const idx = (q: QuestId, id: string) => QUESTS[q].steps.findIndex((s) => s.id === id);
function viewAt(step: string, counts?: number[], o: Partial<QuestsView> = {}): QuestsView {
  const i = idx('solstice_crossing', step);
  return { active: [{ id: 'solstice_crossing', step: i, counts: counts ?? QUESTS.solstice_crossing.steps[i]!.objectives.map(() => 0) }], done: [], offers: [], skipped: [], ...o };
}
const given = (stepId: string, o: Partial<QuestGiven> = {}): QuestGiven => ({
  quest: 'solstice_crossing', step: idx('solstice_crossing', stepId), stepId, xp: 20, gold: 0, item: null, title: null, unlock: null, scene: null, questDone: false, ...o,
});
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };

/** A fake HUD: dialogues wait for the test to answer them (page by page), everything else is recorded. */
function rig() {
  const log: string[] = [];
  const dialogs: { speaker: string; lines: string[]; choices?: string[]; opts?: DialogueOpts; answer: (i: number) => void }[] = [];
  const cards: { card: QuestCardOpts; answer: (i: number) => void }[] = [];
  const moments: QuestMoment[] = [];
  const hints: string[] = [];
  const toasts: string[] = [];
  const sent: QuestAct[] = [];
  let connected = true;
  let now = 0;
  let journalAnswer: JournalAnswer | null = null;
  const learned = new Set<string>();
  const c: FlowCtx = { beacon: false, job: 'warrior', inCombat: false, dead: false, momentum: 0, inDanger: false, hasTarget: false, distanceTo: () => 1 };
  const scenes = { beacon: 0, crater: 0, ring: 0 };
  let beaconDone: () => void = () => {};
  const flow = createQuestFlow({
    hud: {
      dialogue(speaker, lines, choices, opts) {
        log.push(`dialogue:${speaker}`);
        return new Promise((answer) => { dialogs.push({ speaker, lines, choices, opts, answer }); });
      },
      closeDialogue() { log.push('closeDialogue'); const d = dialogs.shift(); d?.answer(-1); },
      toast(t) { toasts.push(t); log.push(`toast:${t}`); },
      banner(t, s) { log.push(`banner:${t}/${s}`); },
      questDone(g) { moments.push(g); log.push(`done:${g.step}`); },
      questHint(t) { if (t) { hints.push(t); log.push(`hint:${t}`); } return Promise.resolve(false); },
      questCard(card) { log.push(`card:${card.title}`); return new Promise((answer) => cards.push({ card, answer })); },
      closeQuestCard() { log.push('closeCard'); const k = cards.shift(); k?.answer(-1); },
      journal() { return Promise.resolve(journalAnswer); },
    },
    send(act) { if (!connected) return false; sent.push(act); return true; },
    device: 'touch',
    ctx: () => c,
    scenes: {
      beacon() { scenes.beacon++; log.push('scene:beacon'); return new Promise<void>((r) => { beaconDone = r; }); },
      crater() { scenes.crater++; log.push('scene:crater'); return Promise.resolve(); },
      ring() { scenes.ring++; },
    },
    learned: { has: (id) => learned.has(id), add: (id) => { learned.add(id); } },
    equipNow: (uid) => { sent.push({ act: 'use', prop: `equip:${uid}` } as unknown as QuestAct); return true; },
    now: () => now,
    wait: () => Promise.resolve(),
  });
  /** Answers the open dialogue (its first in the queue) with `i`, then lets the flow run on. */
  const answer = async (i = 0) => { await settle(); const d = dialogs.shift(); expect(d, 'a dialogue is open').toBeDefined(); d!.answer(i); await settle(); return d!; };
  return {
    flow, log, dialogs, cards, moments, hints, toasts, sent, c, scenes, learned, answer,
    setNow: (t: number) => { now = t; }, setConnected: (on: boolean) => { connected = on; }, setJournal: (a: JournalAnswer | null) => { journalAnswer = a; },
    finishBeacon: () => beaconDone(),
  };
}

describe('quest flow: talk and dialogue', () => {
  it('Marrow at step 0: five pages, the talk is sent only after the last page; nothing moves until the server says so', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('marrow'));
    const p = t.flow.talk('marrow');
    await settle();
    expect(t.dialogs[0]!.lines).toHaveLength(5);
    expect(t.dialogs[0]!.opts?.closable).toBe(true);
    expect(t.sent).toEqual([]);
    await t.answer(0);
    await p;
    expect(t.sent).toEqual([{ act: 'talk', npc: 'marrow' }]);
    // no optimistic progress: the tracker still says Marrow until the view changes
    expect(trackerOf(t.flow.quests, 'touch')!.steps[0]!.text).toBe('Speak with Old Marrow');
    // the server's order: questDone, then quests
    t.flow.message('questDone', given('marrow'));
    t.flow.message('quests', viewAt('pim_find'));
    await settle();
    expect(t.moments[0]).toMatchObject({ title: 'The Solstice Crossing', step: 'Speak with Old Marrow', xp: 20 });
    expect(t.scenes.ring).toBe(1);
    expect(trackerOf(t.flow.quests, 'touch')!.steps[0]!.text).toBe('Find the voice above the tavern');
    // the walking hint (the step's completion line, narration): shown once as a hint, never twice
    expect(t.hints.filter((h) => h.startsWith('Drag on the left'))).toHaveLength(1);
  });

  it('a talk that completes nothing is never sent: the idle lines play (the server would stay silent)', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('board'));
    const p = t.flow.talk('pim');
    await t.answer(0);
    await p;
    expect(t.dialogs).toHaveLength(0);
    expect(t.sent).toEqual([]);
    expect(t.log).toContain('dialogue:Pim, the figurehead');
  });

  it('silence after a completing act: the flow stops waiting and shows nothing it was not told', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('pim'));
    const p = t.flow.talk('pim');
    await t.answer(0); await p;
    expect(t.sent).toEqual([{ act: 'talk', npc: 'pim' }]);
    t.setNow(ANSWER_WAIT_MS + 1);
    t.flow.update();
    expect(t.flow.debug.silent).toBe(1);
    expect(t.moments).toEqual([]);
    expect(trackerOf(t.flow.quests, 'touch')!.steps[0]!.text).toBe('Talk to Pim');
  });

  it('a refusal toasts its line and changes nothing; a full bag is explained in plain words', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('nell_report'));
    const p = t.flow.talk('nell');
    const d = await t.answer(2);
    await p;
    expect(d.choices).toHaveLength(3);
    expect(t.sent).toEqual([{ act: 'talk', npc: 'nell', choice: 2 }]);
    t.flow.message('questRefused', { act: 'talk', reason: 'bag-full', text: 'Make room in your bag first.' });
    await settle();
    expect(t.toasts).toContain('Make room in your bag first.');
    expect(t.hints).toContain(BAG_FULL_HELP);
    expect(t.flow.quests.refusals).toEqual(['Make room in your bag first.']);
    expect(t.moments).toEqual([]);
  });

  it('a dialogue closed half way (by its button, a fight or a walk away) resumes at its page; a fight never shows under a dialogue', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('nell'));
    let p = t.flow.talk('nell');
    await settle();
    t.dialogs[0]!.opts!.onPage!(3);
    t.c.inCombat = true;
    t.flow.update(); // the fight closes it
    await p;
    expect(t.log).toContain('closeDialogue');
    expect(t.sent).toEqual([]);
    // while fighting no new dialogue opens
    await t.flow.talk('nell');
    expect(t.toasts).toContain(FIGHT_FIRST);
    t.c.inCombat = false;
    p = t.flow.talk('nell');
    await settle();
    expect(t.dialogs[0]!.opts!.start).toBe(3); // resumed
    t.c.distanceTo = () => TALK_LEAVE_M + 1;
    t.flow.update(); // walked away: closed again
    await p;
    t.c.distanceTo = () => 1;
    p = t.flow.talk('nell');
    await t.answer(0); await p;
    expect(t.sent).toEqual([{ act: 'talk', npc: 'nell' }]);
  });

  it('not connected at the last page: nothing is sent, and the next talk plays from that page and sends', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('pim'));
    t.setConnected(false);
    let p = t.flow.talk('pim');
    await settle();
    t.dialogs[0]!.opts!.onPage!(4);
    await t.answer(0); await p;
    expect(t.toasts).toContain(NOT_CONNECTED);
    expect(t.sent).toEqual([]);
    t.setConnected(true);
    // a reconnect resends the same view: nothing starts again
    t.flow.message('quests', viewAt('pim'));
    p = t.flow.talk('pim');
    await settle();
    expect(t.dialogs[0]!.opts!.start).toBe(4);
    await t.answer(0); await p;
    expect(t.sent).toEqual([{ act: 'talk', npc: 'pim' }]);
  });

  it('offers: "I\'ll do it" accepts; "Not today" sends nothing; Marrow\'s menu answers and returns to the menu', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('nell', [0], { offers: ['bristle_bounty'] }));
    let p = t.flow.talk('bram');
    await t.answer(1); await p;
    expect(t.sent).toEqual([]);
    p = t.flow.talk('bram');
    await t.answer(0); await p;
    expect(t.sent).toEqual([{ act: 'accept', quest: 'bristle_bounty' }]);
    p = t.flow.talk('marrow');
    await settle();
    expect(t.dialogs[0]!.choices).toEqual(['Who were Ellie and Felix?', 'What is this place?', 'What should I do now?', 'Goodbye']);
    await t.answer(2); // "What should I do now?"
    expect(t.dialogs[0]!.lines).toEqual(['Meet the road-keeper']);
    await t.answer(0);
    await t.answer(3); // Goodbye
    await p;
    expect(t.dialogs).toHaveLength(0);
  });
});

describe('quest flow: completion moments and scenes', () => {
  it('the plaque: Marrow before, the Beacon scene (held), the banner, Marrow after, in that order', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('plaque'));
    const p = t.flow.talk('plaque');
    await t.answer(0); await p;
    expect(t.sent).toEqual([{ act: 'use', prop: 'plaque' }]);
    t.flow.message('questDone', given('plaque', { xp: 30, scene: 'beacon' }));
    t.flow.message('quests', viewAt('board'));
    await settle();
    expect(t.dialogs[0]!.lines).toEqual([...BEACON_LINES.before.lines]);
    await t.answer(0);
    expect(t.flow.sceneOn).toBe(true);
    expect(t.log.filter((l) => l.startsWith('banner'))).toEqual([]);
    t.finishBeacon();
    await settle();
    expect(t.flow.sceneOn).toBe(false);
    expect(t.log).toContain('banner:The Beacon/An island appears in the sky');
    expect(t.dialogs[0]!.lines).toEqual([...BEACON_LINES.after.lines]);
    await t.answer(0);
    const order = t.log.filter((l) => /^(scene|banner|dialogue)/.test(l));
    expect(order).toEqual(['dialogue:The plaque', 'dialogue:Old Marrow', 'scene:beacon', 'banner:The Beacon/An island appears in the sky', 'dialogue:Old Marrow']);
    // the board step's hint came with the new step
    expect(t.hints).toContain('Every adventurer needs a trade. Tap the Guild Board by the statue to choose a job.');
  });

  it('the crater: the scene, the quest banner, the title toast, the epilogue offer card (Accept sends accept)', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('crater'));
    const p = t.flow.talk('crater_edge');
    await t.answer(0); await p;
    t.flow.message('questDone', given('crater', { xp: 40, gold: 30, title: 'Witness of the Crossing', unlock: 'home:starter_cottage', scene: 'crater', questDone: true }));
    t.flow.message('quests', { active: [], done: [{ id: 'solstice_crossing', times: 1, today: true }], offers: ['keepers_lamp', 'bristle_bounty'], skipped: [] });
    await settle();
    expect(t.moments[0]).toMatchObject({ xp: 40, gold: 30, title2: 'Witness of the Crossing', questDone: true });
    expect(t.log).toContain('scene:crater');
    expect(t.log).toContain('banner:The Solstice Crossing/Quest complete');
    expect(t.toasts).toContain('New title: Witness of the Crossing');
    expect(t.cards[0]!.card).toMatchObject({ title: "The Keeper's Lamp", buttons: ['Accept', 'Not now'] });
    t.cards.shift()!.answer(0);
    await settle();
    expect(t.sent.at(-1)).toEqual({ act: 'accept', quest: 'keepers_lamp' });
  });

  it('the equip step: a card offers to equip the new piece from the inventory view', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('nell_report'));
    t.flow.message('questDone', given('nell_report', { xp: 40, gold: 40, item: 'thornrunner_chest' }));
    t.flow.message('quests', viewAt('equip'));
    t.flow.message('inventory', { bag: [{ uid: 4, item: 'starter_chest', worn: ['warrior'] }, { uid: 9, item: 'thornrunner_chest', worn: [] }] });
    await settle();
    expect(t.moments[0]).toMatchObject({ item: 'Thornrunner Jerkin', gold: 40 });
    expect(t.cards[0]!.card.buttons).toEqual(['Equip now', 'Later']);
    t.cards.shift()!.answer(0);
    await settle();
    expect(t.sent.at(-1)).toEqual({ act: 'use', prop: 'equip:9' });
    t.flow.message('questDone', given('equip'));
    expect(t.learned.has('equip-card')).toBe(true);
  });

  it('the new-player flow: a moment after joining, the first hint once; then never again once learned', () => {
    const t = rig();
    t.flow.entered();
    t.flow.update();
    expect(t.hints).toEqual([]); // no view yet
    t.flow.message('quests', viewAt('marrow'));
    t.setNow(JOIN_HINT_MS - 1); t.flow.update();
    expect(t.hints).toEqual([]);
    t.setNow(JOIN_HINT_MS); t.flow.update();
    expect(t.hints).toEqual([FIRST_HINT.touch]);
    t.flow.entered(); t.setNow(JOIN_HINT_MS * 3); t.flow.update();
    expect(t.hints).toEqual([FIRST_HINT.touch]); // once a session
    t.flow.message('questDone', given('marrow'));
    expect(t.learned.has('first')).toBe(true);
  });

  it('the first fight teaches as it goes: the finisher at half Momentum, the combo after it, the roll in a telegraph', () => {
    const t = rig();
    t.flow.message('quests', viewAt('nell'));
    t.flow.message('quests', viewAt('first_fight'));
    expect(t.hints).toContain('Tap a Thornling, then stay close. You attack by yourself.');
    t.c.inCombat = true; t.c.momentum = 60; t.flow.update();
    expect(t.hints.at(-1)).toMatch(/finisher/);
    t.flow.message('quests', viewAt('first_fight', [1, 1, 0, 0]));
    t.flow.update();
    expect(t.hints.at(-1)).toMatch(/combo/);
    t.c.inDanger = true; t.flow.update();
    expect(t.hints.at(-1)).toBe('Tap Dodge, or double-tap a direction, to roll.');
    const n = t.hints.length;
    t.flow.update(); t.flow.update();
    expect(t.hints).toHaveLength(n); // never repeated
  });

  it('the journal: Track changes the tracker; Drop and Skip go to the server as acts', async () => {
    const t = rig();
    t.flow.message('quests', { ...viewAt('duo'), active: [...viewAt('duo').active, { id: 'bristle_bounty', step: 0, counts: [1] }] });
    t.setJournal({ act: 'track', quest: 'bristle_bounty' });
    await t.flow.openJournal();
    expect(t.flow.quests.tracked).toBe('bristle_bounty');
    expect(t.sent).toEqual([]);
    t.setJournal({ act: 'skip', quest: 'solstice_crossing' });
    await t.flow.openJournal();
    t.setJournal({ act: 'abandon', quest: 'bristle_bounty' });
    await t.flow.openJournal();
    expect(t.sent).toEqual([{ act: 'skip', quest: 'solstice_crossing' }, { act: 'abandon', quest: 'bristle_bounty' }]);
  });

  it('dispose (a zone change, a logout) closes the dialogue and the card, and nothing is sent after', async () => {
    const t = rig();
    t.flow.message('quests', viewAt('marrow'));
    const p = t.flow.talk('marrow' as StoryId);
    await settle();
    t.flow.dispose();
    await p;
    expect(t.log).toContain('closeDialogue');
    expect(t.log).toContain('closeCard');
    t.flow.message('quests', viewAt('pim'));
    await t.flow.talk('pim');
    expect(t.sent).toEqual([]);
  });
});
