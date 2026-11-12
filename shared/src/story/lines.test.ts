import { describe, expect, it } from 'vitest';
import {
  BEACON_LINES, COMPLETE_TEXT, CRATER_LINES, LINE_MAX, MARROW_MENU, NPC_NAMES, PIM_CALL, PROP_NAMES, QUEST_BLURBS, QUEST_LINES, QUEST_NAMES, SKIP_LABEL,
  allStoryText, boardHeader, marrowAnswer, npcSay, propSay, rewardChoices, stepDoneSay, stepHint, trackerLines, type Device, type Say,
} from './lines';
import { QUESTS, QUEST_IDS, newQuestSave, questsView, type QuestId, type QuestSave, type QuestsView } from '../quests';
import { NPC_IDS, PROP_IDS, STORY_NPCS, STORY_PROPS } from './spots';
import { isOffensive } from '../names';

const DAY = '2026-11-12';
const MAIN: QuestId = 'solstice_crossing';
const DEVICES: readonly Device[] = ['touch', 'desktop'];
const viewAt = (stepId: string, more: Partial<QuestSave> = {}): QuestsView => {
  const i = QUESTS[MAIN].steps.findIndex(s => s.id === stepId);
  return questsView({ ...newQuestSave(DAY), active: [{ id: MAIN, step: i, counts: QUESTS[MAIN].steps[i]!.objectives.map(() => 0), since: DAY }], ...more }, DAY);
};
const doneView = (more: Partial<QuestSave> = {}): QuestsView => questsView({ ...newQuestSave(DAY), active: [], done: { solstice_crossing: { day: DAY, times: 1, choice: 0 } }, ...more }, DAY);

/** Every Say reachable: each NPC and prop for every main step and a few side states, both devices, beacon on and off. */
function everySay(): Say[] {
  const views: QuestsView[] = [
    ...QUESTS[MAIN].steps.map(s => viewAt(s.id)), doneView(),
    viewAt('gate', { active: [{ id: MAIN, step: 6, counts: [0], since: DAY }, { id: 'bristle_bounty', step: 1, counts: [0], since: DAY }, { id: 'grans_waymarks', step: 1, counts: [0], since: DAY }] }),
    viewAt('gate', { active: [{ id: MAIN, step: 6, counts: [0], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [3], since: DAY }] }),
    doneView({ done: { solstice_crossing: { day: DAY, times: 1 }, bristle_bounty: { day: DAY, times: 1 } } }),
  ];
  const out: Say[] = [PIM_CALL, CRATER_LINES, BEACON_LINES.before, BEACON_LINES.after, COMPLETE_TEXT.offer];
  for (const v of views) for (const device of DEVICES) for (const beacon of [false, true]) {
    for (const n of NPC_IDS) out.push(npcSay(n, v, { beacon, job: 'warrior', device }));
    for (const p of PROP_IDS) out.push(propSay(p, v));
    for (let c = 0; c < 4; c++) { const a = marrowAnswer(c, v, device); if (a) out.push(a); }
  }
  for (const q of QUEST_IDS) for (const s of QUESTS[q].steps) for (const device of DEVICES) { const d = stepDoneSay(q, s.id, device); if (d) out.push(d); }
  return out;
}

describe('story text', () => {
  it('every step of every quest has tracker lines, one per objective', () => {
    for (const q of QUEST_IDS) {
      expect(Object.keys(QUEST_LINES[q]).sort()).toEqual(QUESTS[q].steps.map(s => s.id).sort());
      for (const s of QUESTS[q].steps) {
        expect(QUEST_LINES[q][s.id]!.length, `${q}:${s.id}`).toBe(s.objectives.length);
        expect(stepHint(q, s.id, 'touch').objectives.length).toBe(s.objectives.length);
      }
      expect(QUEST_NAMES[q]).toBe(QUESTS[q].name);
      expect(QUEST_BLURBS[q].length).toBeGreaterThan(0);
    }
    // counts fill in; the three waymarks share one line
    expect(trackerLines(MAIN, 'first_fight', [2, 1, 0, 0])).toEqual(['Defeat Thornlings 2/3', 'Spend Momentum on a finisher', 'Land a combo', 'Dodge roll in a fight']);
    expect(trackerLines('grans_waymarks', 'stones', [1, 0, 1])).toEqual(['Find the old waymarks 2/3']);
    expect(trackerLines('bristle_bounty', 'boars', [99])).toEqual(['Defeat Bramble Boars 6/6']);
    expect(trackerLines(MAIN, 'nope', [])).toEqual([]);
    // the names shown match the spots table
    for (const n of NPC_IDS) expect(NPC_NAMES[n]).toBe(STORY_NPCS[n].name);
    for (const p of PROP_IDS) expect(PROP_NAMES[p]).toBe(STORY_PROPS[p].name);
  });

  it('every talk step has lines for its NPC; every use step has lines for its prop; every offer has two choices', () => {
    for (const q of QUEST_IDS) {
      QUESTS[q].steps.forEach((s, i) => {
        const counts = s.objectives.map(() => 0);
        const save: QuestSave = { ...newQuestSave(DAY), active: [...(q === MAIN ? [] : [{ id: MAIN, step: 6, counts: [0], since: DAY }]), { id: q, step: i, counts, since: DAY }] };
        const v = questsView(save, DAY);
        for (const o of s.objectives) {
          if (o.k === 'talk') {
            const say = npcSay(o.npc, v, { beacon: true, job: 'warrior', device: 'touch' });
            expect(say.speaker).toBe(NPC_NAMES[o.npc]);
            expect(say.lines.length, `${q}:${s.id}`).toBeGreaterThan(0);
            expect(say.choices).toEqual(s.reward?.choice ? rewardChoices(q, s.id) : undefined); // a talk step: its lines, not the idle menu
          }
          if (o.k === 'use') expect(propSay(o.prop, v).lines.length).toBeGreaterThan(0);
        }
      });
      const giver = QUESTS[q].giver;
      if (giver) {
        const say = npcSay(giver, viewAt('gate'), { beacon: true, job: 'warrior', device: 'touch' });
        expect(say.choices?.length, q).toBe(2);
      }
    }
    expect(rewardChoices(MAIN, 'nell_report')).toEqual([
      'Mossweave Robe — cloth: stronger abilities', 'Thornrunner Jerkin — light: faster Momentum', 'Rootbound Hauberk — heavy: they come for you, not your friends',
    ]);
    expect(COMPLETE_TEXT.offer.choices).toEqual(['Accept', 'Not now']);
    expect(MARROW_MENU.length).toBe(4);
  });

  it('no line is longer than LINE_MAX or empty; no line has markup characters < > or a placeholder left unreplaced', () => {
    expect(LINE_MAX).toBe(140);
    const fixed = allStoryText();
    expect(fixed.length).toBeGreaterThan(80);
    for (const t of fixed) {
      expect(t.trim().length, JSON.stringify(t)).toBeGreaterThan(0);
      expect(t.length, t).toBeLessThanOrEqual(LINE_MAX);
      expect(t, t).not.toMatch(/[<>]/);
      for (const ph of t.match(/\{[^}]*\}/g) ?? []) expect(['{c}', '{item}', '{job}'], t).toContain(ph);
    }
    for (const say of everySay()) {
      for (const t of [...say.lines, ...(say.choices ?? [])]) {
        expect(t.trim().length).toBeGreaterThan(0);
        expect(t.length, t).toBeLessThanOrEqual(LINE_MAX);
        expect(t, t).not.toMatch(/[<>{}]/);
      }
    }
    for (const q of QUEST_IDS) for (const s of QUESTS[q].steps) for (const d of DEVICES) {
      const h = stepHint(q, s.id, d);
      for (const t of [h.line, ...h.objectives]) if (t !== null) { expect(t.length).toBeLessThanOrEqual(LINE_MAX); expect(t).not.toMatch(/[<>{}]/); }
      for (const t of trackerLines(q, s.id, s.objectives.map(() => 0))) expect(t).not.toMatch(/[<>{}]/);
    }
    expect(boardHeader('black_mage')).toContain('Black Mage');
    expect(boardHeader('black_mage')).not.toMatch(/[{}]/);
    // no blocked word, by the shared name blocklist, word by word
    const words = new Set(fixed.join(' ').split(/[^A-Za-z']+/).filter(Boolean));
    for (const w of words) expect(isOffensive(w), w).toBe(false);
  });

  it('Ellie and Felix never speak: no Say has either as its speaker', () => {
    for (const say of everySay()) expect(say.speaker).not.toMatch(/ellie|felix/i);
    for (const n of Object.values(NPC_NAMES)) expect(n).not.toMatch(/ellie|felix/i);
  });

  it('no game text says "player" or "hero"', () => {
    const all = [...allStoryText(), ...everySay().flatMap(s => [s.speaker, ...s.lines, ...(s.choices ?? [])])];
    for (const t of all) expect(t, t).not.toMatch(/\b(players?|heroe?s?)\b/i);
    expect(SKIP_LABEL).toBe('Skip this step (no reward)');
  });

  it('npcSay follows the quest state: Marrow at step 0 gives the opening; Pim before and after the Beacon; Bram offers, counts and turns in; done-today', () => {
    const ctx = { beacon: false, job: 'warrior', device: 'touch' as Device };
    const open = npcSay('marrow', viewAt('marrow'), ctx);
    expect(open.lines[0]).toBe('Ah, there you are. Mind the plinth, it has outlasted better boots than yours.');
    expect(open.lines.length).toBe(5);
    expect(open.choices).toBeUndefined();
    const idle = npcSay('marrow', viewAt('pim_find'), ctx);
    expect(idle.choices).toEqual(MARROW_MENU);
    // "What should I do now?" answers with the main step's hint, device by device; after the quest, the crater line
    expect(marrowAnswer(2, viewAt('pim_hop'), 'touch')!.lines).toEqual(['Tap Jump to hop.']);
    expect(marrowAnswer(2, viewAt('pim_hop'), 'desktop')!.lines).toEqual(['Press Space to jump.']);
    expect(marrowAnswer(2, viewAt('plaque'), 'touch')!.lines).toEqual(['Read the plaque on the statue']);
    expect(marrowAnswer(2, doneView(), 'touch')!.lines).toEqual(["Go and see what's in that crater, if you must. Bring a friend back with you."]);
    expect(marrowAnswer(0, viewAt('pim_find'), 'touch')!.lines.length).toBe(5);
    expect(marrowAnswer(3, viewAt('pim_find'), 'touch')).toBeNull();
    // Pim
    expect(npcSay('pim', viewAt('pim'), ctx).lines.length).toBe(5);
    expect(npcSay('pim', viewAt('plaque'), ctx).lines).toEqual(["Go on, the plaque. I'd go myself, but I'm nailed to a tavern."]);
    expect(npcSay('pim', viewAt('board'), { ...ctx, beacon: true }).lines[0]).toMatch(/^They did it/);
    // Bram: idle before the gate, the offer at the gate, counting, the turn-in, done today
    expect(npcSay('bram', viewAt('board'), ctx).lines[0]).toMatch(/^Welcome to the Second Chance/);
    const offer = npcSay('bram', viewAt('gate'), ctx);
    expect(offer.choices).toEqual(["I'll do it", 'Not today']);
    const counting = viewAt('gate', { active: [{ id: MAIN, step: 6, counts: [0], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [3], since: DAY }] });
    expect(npcSay('bram', counting, ctx).lines).toEqual(["Six boars. I'm counting, and so are the hops."]);
    const turnIn = viewAt('gate', { active: [{ id: MAIN, step: 6, counts: [0], since: DAY }, { id: 'bristle_bounty', step: 1, counts: [0], since: DAY }] });
    expect(npcSay('bram', turnIn, ctx).lines).toEqual(['Six! The hops thank you.', "The pie's in the purse. Don't ask how."]);
    const today = doneView({ done: { solstice_crossing: { day: DAY, times: 1 }, bristle_bounty: { day: DAY, times: 1 } } });
    expect(npcSay('bram', today, ctx).lines).toEqual(['Same again tomorrow? Those boars never learn.']);
    const tomorrow = doneView({ done: { solstice_crossing: { day: DAY, times: 1 }, bristle_bounty: { day: '2026-11-11', times: 1 } } });
    expect(npcSay('bram', tomorrow, ctx).choices).toEqual(["I'll do it", 'Not today']);
    // Tamsin and Nell
    expect(npcSay('tamsin', viewAt('board'), ctx).lines.length).toBe(2);
    expect(npcSay('tamsin', viewAt('board'), { ...ctx, beacon: true }).lines[0]).toMatch(/island/);
    expect(npcSay('tamsin', viewAt('gate'), ctx).choices).toEqual(["I'll find them", 'Not now']);
    expect(npcSay('nell', viewAt('nell'), ctx).lines.length).toBe(6);
    expect(npcSay('nell', viewAt('nell_report'), ctx).choices!.length).toBe(3);
    expect(npcSay('nell', viewAt('first_fight'), ctx).lines).toEqual(['Defeat Thornlings 0/3. Spend Momentum on a finisher. Land a combo. Dodge roll in a fight']);
    expect(npcSay('nell', doneView(), ctx).lines[0]).toMatch(/^Whatever's down there/);
    // narration and the completion moment
    expect(propSay('plaque', viewAt('plaque')).lines).toEqual(['ELLIE and FELIX. The Two.', '“She found the way. He made it possible.”', 'Raised by the grateful people of Shady Grove. Fair winds.']);
    expect(propSay('waymark_2', viewAt('gate')).lines[0]).toMatch(/boat with wings/);
    expect(COMPLETE_TEXT.title('Witness of the Crossing')).toBe('New title: Witness of the Crossing');
    expect(stepDoneSay(MAIN, 'pim_find', 'touch')).toBe(PIM_CALL);
    expect(stepDoneSay(MAIN, 'marrow', 'desktop')!.lines).toEqual(['Walk with WASD, or click the ground to walk there.']);
    expect(stepDoneSay('keepers_lamp', 'keeper', 'touch')!.lines[0]).toMatch(/^The lamp steadies/);
  });
});
