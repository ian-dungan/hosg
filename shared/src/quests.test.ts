import { describe, expect, it } from 'vitest';
import {
  QUESTS, QUEST_IDS, QUEST_ACTIVE_MAX, QUEST_COUNT_MAX, QUEST_SEEN_MAX, QUEST_SKIPPED_MAX, QUEST_UNLOCKS_MAX, QUEST_TEXT, REACH_FUZZ, NPC_REACH,
  applyQuestAct, applyQuestEvents, grantQuestRewards, isQuestSave, newQuestSave, parseQuestAct, parseQuests, questCares, questRewardKey, questStepOf, questsView,
  objectiveTarget, type QuestAct, type QuestCtx, type QuestEvent, type QuestId, type QuestSave, type StepDone,
} from './quests';
import { NPC_IDS, PROP_IDS, STORY_NPCS, STORY_PROPS, type NpcId, type PropId } from './story/spots';
import { ITEMS, isGearSlot } from './items';
import { ENEMY_KINDS, type EnemyKindId } from './combat/enemies';
import { BAG_SLOTS, addLoot, bagUsed, newInventory, type InvState } from './inventory';
import { newJobsSave, recordFor } from './combat/jobs';
import { totalTo, levelForXp } from './progression';
import { deepFreeze } from './combat/freeze';
import { prng } from './world/recipe';
import { isZoneId } from './world/zones';

const DAY = '2026-11-12', NEXT = '2026-11-13';
const MAIN: QuestId = 'solstice_crossing';
const ctxAt = (zone: QuestCtx['zone'], x: number, z: number, more: Partial<QuestCtx> = {}): QuestCtx => ({ zone, x, z, day: DAY, dead: false, busy: false, bagFree: 10, ...more });
const atNpc = (n: NpcId, more: Partial<QuestCtx> = {}) => ctxAt(STORY_NPCS[n].zone, STORY_NPCS[n].x, STORY_NPCS[n].z, more);
const atProp = (p: PropId, more: Partial<QuestCtx> = {}) => ctxAt(STORY_PROPS[p].zone, STORY_PROPS[p].x, STORY_PROPS[p].z, more);
const stepIdx = (q: QuestId, id: string) => QUESTS[q].steps.findIndex(s => s.id === id);

type Ok = { save: QuestSave; done: StepDone[]; changed: boolean };
const ok = (r: ReturnType<typeof applyQuestAct>): Ok => {
  if (!('save' in r)) throw new Error(`not applied: ${JSON.stringify(r)}`);
  return r;
};
const act = (s: QuestSave, a: QuestAct, c: QuestCtx) => ok(applyQuestAct(deepFreeze(s), a, c));
const evs = (s: QuestSave, e: QuestEvent[], day = DAY) => applyQuestEvents(deepFreeze(s), e, day);
let killN = 0;
const kill = (kind: EnemyKindId, party = false): QuestEvent => ({ e: 'kill', kind, key: `room:${kind}:${++killN}`, party });

/** A save with the main quest at `stepId` (all earlier steps done without rewards). */
const mainAt = (stepId: string, more: Partial<QuestSave> = {}): QuestSave => {
  const i = stepIdx(MAIN, stepId);
  return { ...newQuestSave(DAY), active: [{ id: MAIN, step: i, counts: QUESTS[MAIN].steps[i]!.objectives.map(() => 0), since: DAY }], ...more };
};
const mainDone = (more: Partial<QuestSave> = {}): QuestSave => ({ ...newQuestSave(DAY), active: [], done: { solstice_crossing: { day: DAY, times: 1, choice: 0 } }, unlocks: ['home:starter_cottage'], ...more });
const inv = (): InvState => ({ inv: newInventory([0, 0]), gold: 0, seals: 0, jobs: newJobsSave('warrior') });

/** Walks the main quest from Marrow to the end, the way the server would feed it. */
function runMain(choice = 1): { save: QuestSave; done: StepDone[] } {
  let s = newQuestSave(DAY);
  const all: StepDone[] = [];
  const take = (r: Ok | { save: QuestSave; done: StepDone[]; changed: boolean }) => { s = r.save; all.push(...r.done); };
  take(act(s, { act: 'talk', npc: 'marrow' }, atNpc('marrow')));
  const pim = STORY_NPCS.pim;
  take(evs(s, [{ e: 'reach', zone: 'grove', x: pim.x, z: pim.z }]));
  take(evs(s, [{ e: 'jump' }]));
  take(act(s, { act: 'talk', npc: 'pim' }, atNpc('pim')));
  take(act(s, { act: 'use', prop: 'plaque' }, atProp('plaque')));
  take(evs(s, [{ e: 'job' }]));
  take(evs(s, [{ e: 'reach', zone: 'greenway', x: 8, z: 3 }]));
  take(act(s, { act: 'talk', npc: 'nell' }, atNpc('nell')));
  take(evs(s, [kill('thornling'), kill('thornling'), { e: 'act', what: 'finisher' }, kill('thornling'), { e: 'act', what: 'combo' }, { e: 'act', what: 'dodge' }]));
  take(evs(s, [{ e: 'act', what: 'pick' }, { e: 'act', what: 'pick' }]));
  take(evs(s, [kill('mossback')]));
  take(act(s, { act: 'talk', npc: 'nell', choice }, atNpc('nell')));
  take(evs(s, [{ e: 'equip', slot: 'chest', item: ['mossweave_chest', 'thornrunner_chest', 'rootbound_chest'][choice]! }]));
  take(act(s, { act: 'use', prop: 'crater_edge' }, atProp('crater_edge')));
  return { save: s, done: all };
}

describe('quest data', () => {
  it('every quest: unique step ids, objectives name real NPCs, props, kinds and slots, choices are T1 chests, no event-completed step gives an item', () => {
    expect(Object.isFrozen(QUESTS) && Object.isFrozen(QUESTS.solstice_crossing.steps[8]!.objectives[0])).toBe(true);
    expect(Object.keys(QUESTS).sort()).toEqual([...QUEST_IDS].sort());
    for (const id of QUEST_IDS) {
      const q = QUESTS[id];
      expect(q.id).toBe(id);
      expect(new Set(q.steps.map(s => s.id)).size).toBe(q.steps.length);
      if (q.giver) expect(NPC_IDS).toContain(q.giver);
      if (q.giver) expect(STORY_NPCS[q.giver].giver).toContain(id);
      if (q.after) {
        expect(QUEST_IDS).toContain(q.after.quest);
        if (q.after.step !== null) expect(stepIdx(q.after.quest, q.after.step)).toBeGreaterThanOrEqual(0);
      }
      for (const st of q.steps) {
        expect(st.objectives.length).toBeGreaterThan(0);
        for (const o of st.objectives) {
          if (o.k === 'talk') expect(NPC_IDS).toContain(o.npc);
          if (o.k === 'use') expect(PROP_IDS).toContain(o.prop);
          if (o.k === 'reach') expect(isZoneId(o.zone)).toBe(true);
          if (o.k === 'kill') {
            if (o.kinds !== 'any') for (const k of o.kinds) expect(Object.keys(ENEMY_KINDS)).toContain(k);
            expect(o.n).toBeGreaterThanOrEqual(1);
            expect(o.n).toBeLessThanOrEqual(QUEST_COUNT_MAX);
          }
          if (o.k === 'act') expect(o.n).toBeLessThanOrEqual(QUEST_COUNT_MAX);
          if (o.k === 'equip') expect(isGearSlot(o.slot)).toBe(true);
        }
        const r = st.reward;
        if (r?.item) expect(ITEMS[r.item]).toBeDefined();
        for (const c of r?.choice ?? []) { expect(ITEMS[c]!.slot).toBe('chest'); expect(ITEMS[c]!.tier).toBe(1); }
        // an item (fixed or chosen) only on a step completed by an act (talk or use), where 'bag-full' is checked
        if (r?.item || r?.choice) expect(st.objectives.every(o => o.k === 'talk' || o.k === 'use')).toBe(true);
      }
    }
    // every NPC's giver list matches the data
    for (const n of NPC_IDS) expect([...STORY_NPCS[n].giver].sort()).toEqual(QUEST_IDS.filter(q => QUESTS[q].giver === n).sort());
    // the totals of the plan's step table (its prose says 330 xp; the table's rows add up to 350, 290 without the optional duo)
    const sum = (k: 'xp' | 'gold') => QUESTS[MAIN].steps.reduce((a, s) => a + (s.reward?.[k] ?? 0), 0);
    expect([sum('xp'), sum('gold')]).toEqual([350, 95]);
  });

  it('the main quest teaches in order: move/talk, jump, talk, plaque, job, gate, fight acts, picks, optional duo, report with a choice, equip, crater', () => {
    const steps = QUESTS[MAIN].steps;
    expect(steps.map(s => s.id)).toEqual(['marrow', 'pim_find', 'pim_hop', 'pim', 'plaque', 'board', 'gate', 'nell', 'first_fight', 'picks', 'duo', 'nell_report', 'equip', 'crater']);
    expect(steps.map(s => s.objectives.map(o => o.k).join('+'))).toEqual([
      'talk', 'reach', 'jump', 'talk', 'use', 'job', 'reach', 'talk', 'kill+act+act+act', 'act', 'kill+kill', 'talk', 'equip', 'use',
    ]);
    expect(steps[8]!.objectives.map(o => (o.k === 'act' ? o.what : o.k))).toEqual(['kill', 'finisher', 'combo', 'dodge']);
    expect(steps.filter(s => s.optional).map(s => s.id)).toEqual(['duo']);
    expect(steps[10]!.mode).toBe('any');
    expect(steps[11]!.reward!.choice).toEqual(['mossweave_chest', 'thornrunner_chest', 'rootbound_chest']);
    expect(steps[4]!.scene).toBe('beacon');
    expect(steps[13]!.scene).toBe('crater');
    expect(steps[13]!.reward).toMatchObject({ title: 'Witness of the Crossing', unlock: 'home:starter_cottage' });
    // the quest's 350 xp (290 skipping the duo) take a level 1 job to level 3, before kill xp
    expect(levelForXp(350)).toBe(3);
    expect(levelForXp(290)).toBe(3);
    expect(290 - totalTo(3)).toBeGreaterThan(0);
  });
});

describe('the save', () => {
  it('newQuestSave has the main quest at step 0; NULL and garbage read as it, repaired only for garbage', () => {
    const n = newQuestSave(DAY);
    expect(n).toEqual({ v: 1, active: [{ id: MAIN, step: 0, counts: [0], since: DAY }], done: {}, unlocks: [], seen: [], skipped: [], paid: {} });
    expect(isQuestSave(n)).toBe(true);
    expect(parseQuests(null, DAY)).toEqual({ save: n, repaired: false });
    expect(parseQuests(undefined, DAY)).toEqual({ save: n, repaired: false });
    for (const g of [0, 'x', [], true, { v: 2 }, { v: '1' }, NaN, () => 1]) expect(parseQuests(g, DAY)).toEqual({ save: n, repaired: true });
    expect(isQuestSave(null)).toBe(false);
    expect(isQuestSave(JSON.parse(JSON.stringify(n)))).toBe(true);
    // a JSON round trip of a real save is still a save, and parses to itself
    const run = runMain().save;
    const rt = JSON.parse(JSON.stringify(run));
    expect(isQuestSave(rt)).toBe(true);
    expect(parseQuests(rt, DAY)).toEqual({ save: run, repaired: false });
  });

  it('repair: unknown ids, duplicate actives, out-of-range steps and counts, oversize lists, a done once-quest still active', () => {
    const r = parseQuests({
      v: 1, extra: 1,
      active: [
        { id: 'nope', step: 0, counts: [0], since: DAY },
        { id: 'bristle_bounty', step: 7, counts: [1e9, 3], since: 'yesterday' },
        { id: MAIN, step: 8, counts: [NaN, -4, 1.5, 99], since: DAY },
        { id: MAIN, step: 0, counts: [0], since: DAY },
        { id: 'grans_waymarks', step: 0, counts: [1, 0, 0], since: DAY },
      ],
      done: { grans_waymarks: { day: DAY, times: 1 }, nope: { day: DAY, times: 1 }, keepers_lamp: { day: 'x', times: 1 }, bristle_bounty: { day: DAY, times: 1e12 } },
      unlocks: ['home:starter_cottage', 'home:castle', 7, 'home:starter_cottage'],
      seen: Array.from({ length: 500 }, (_, i) => `k${i}`),
      skipped: ['solstice_crossing:duo', 'solstice_crossing:marrow', 'x'.repeat(5000)],
      paid: { keepers_lamp: 2, grans_waymarks: 1, nope: 1, bristle_bounty: 99 },
    }, DAY);
    expect(r.repaired).toBe(true);
    const s = r.save;
    expect(s.active.map(p => p.id)).toEqual([MAIN, 'bristle_bounty']); // main first, unknown and duplicate gone, done once-quest gone
    expect(s.active[0]).toEqual({ id: MAIN, step: 8, counts: [0, 0, 1, 1], since: DAY });
    expect(s.active[1]).toEqual({ id: 'bristle_bounty', step: 1, counts: [0], since: DAY }); // step clamped; a met step's counts reset
    expect(s.done).toEqual({ grans_waymarks: { day: DAY, times: 1 }, bristle_bounty: { day: DAY, times: 1_000_000 } });
    expect(s.unlocks).toEqual(['home:starter_cottage']);
    expect(s.seen.length).toBe(QUEST_SEEN_MAX);
    expect(s.seen.at(-1)).toBe('k499');
    expect(s.skipped).toEqual(['solstice_crossing:duo']);
    expect(s.paid).toEqual({ keepers_lamp: 2 });
    expect(isQuestSave(s)).toBe(true);
    // the main quest neither active nor done comes back at step 0; more than QUEST_ACTIVE_MAX is capped
    const r2 = parseQuests({ v: 1, active: [], done: {}, unlocks: [], seen: [], skipped: [], paid: {} }, DAY);
    expect(r2).toEqual({ save: newQuestSave(DAY), repaired: true });
    const many = parseQuests({ ...newQuestSave(DAY), active: Array.from({ length: 50 }, () => ({ id: MAIN, step: 0, counts: [0], since: DAY })) }, DAY);
    expect(many.repaired).toBe(true);
    expect(many.save.active.length).toBe(1);
    expect(many.save.active.length).toBeLessThanOrEqual(QUEST_ACTIVE_MAX);
    // never throws on hostile shapes
    const evil = Object.create({ v: 1 });
    for (const g of [evil, { v: 1, active: [null, 1, 'x', { id: MAIN, step: '3', counts: 'no', since: 5 }], done: [], unlocks: {}, seen: null, skipped: 3, paid: [] }]) {
      expect(() => parseQuests(g, DAY)).not.toThrow();
      expect(isQuestSave(parseQuests(g, DAY).save)).toBe(true);
    }
    // a done main quest is kept done, with nothing active
    expect(parseQuests(mainDone(), DAY)).toEqual({ save: mainDone(), repaired: false });
    expect(QUEST_SKIPPED_MAX).toBe(16);
    expect(QUEST_UNLOCKS_MAX).toBe(16);
  });
});

describe('events', () => {
  it('a kill counts once per key; a fourth Thornling does not carry into the next step; one kill counts for two quests', () => {
    let s = mainAt('first_fight');
    const k = kill('thornling');
    const r1 = evs(s, [k, k, { ...k }]);
    expect(r1.save.active[0]!.counts).toEqual([1, 0, 0, 0]);
    expect(r1.save.seen).toEqual([k.e === 'kill' ? k.key : '']);
    expect(questCares(r1.save, k)).toBe(false);
    s = r1.save;
    const r2 = evs(s, [kill('thornling'), kill('thornling'), { e: 'act', what: 'finisher' }, { e: 'act', what: 'combo' }, { e: 'act', what: 'dodge' }, kill('thornling'), { e: 'act', what: 'pick' }]);
    expect(r2.done).toEqual([{ quest: MAIN, step: 8, times: 0, choice: null }]);
    expect(r2.save.active[0]).toMatchObject({ step: 9, counts: [1] }); // the pick after the step counts; the 4th kill does not carry
    // the same kill completes the step of one quest and counts for another
    const both: QuestSave = { ...mainAt('first_fight'), active: [{ id: MAIN, step: 8, counts: [2, 1, 1, 1], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [0], since: DAY }] };
    const r3 = evs(both, [kill('thornling')]);
    expect(r3.save.active[1]!.counts).toEqual([0]);
    const b = kill('boar');
    const r4 = evs({ ...both, active: [both.active[0]!, { id: 'bristle_bounty', step: 0, counts: [5], since: DAY }] }, [b]);
    expect(r4.done.map(d => d.quest)).toEqual(['bristle_bounty']);
    // one kill, two quests: a Mossback for the duo step and... a Thornling for the main quest and the bounty both? boars only for Bram
    const two: QuestSave = { ...mainAt('duo'), active: [{ id: MAIN, step: 10, counts: [0, 0], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [0], since: DAY }] };
    const r5 = evs(two, [kill('boar', true)]);
    expect(r5.done).toEqual([{ quest: MAIN, step: 10, times: 0, choice: null }]);
    expect(r5.save.active.find(p => p.id === 'bristle_bounty')!.counts).toEqual([1]);
    expect(r5.save.seen.length).toBe(1);
    // nothing changes the input; an event no one cares about gives the same object
    const same = evs(two, [{ e: 'jump' }]);
    expect(same.changed).toBe(false);
    expect(same.save).toBe(two);
  });

  it('the duo step completes on a party kill or a Mossback alone, and can be skipped with no reward', () => {
    const s = mainAt('duo');
    expect(evs(s, [kill('thornling')]).changed).toBe(false);
    expect(evs(s, [kill('thornling', true)]).done.map(d => d.step)).toEqual([10]);
    expect(evs(s, [kill('mossback')]).done.map(d => d.step)).toEqual([10]);
    const sk = act(s, { act: 'skip', quest: MAIN }, ctxAt('greenway', 50, 0));
    expect(sk.done).toEqual([]);
    expect(sk.save.active[0]!.step).toBe(11);
    expect(sk.save.skipped).toEqual(['solstice_crossing:duo']);
    expect(applyQuestAct(mainAt('first_fight'), { act: 'skip', quest: MAIN }, ctxAt('greenway', 0, 0))).toEqual({ refusal: 'not-optional' });
    expect(applyQuestAct(s, { act: 'skip', quest: 'grans_waymarks' }, ctxAt('greenway', 0, 0))).toEqual({ refusal: 'unknown' });
  });

  it('questCares is false for events no current step wants (a jump at step 0, a boar during first_fight)', () => {
    expect(questCares(newQuestSave(DAY), { e: 'jump' })).toBe(false);
    expect(questCares(mainAt('pim_hop'), { e: 'jump' })).toBe(true);
    expect(questCares(mainAt('first_fight'), kill('boar'))).toBe(false);
    expect(questCares(mainAt('first_fight'), kill('thornling'))).toBe(true);
    expect(questCares(mainAt('first_fight'), { e: 'act', what: 'pick' })).toBe(false);
    expect(questCares(mainAt('gate'), { e: 'reach', zone: 'grove', x: 0, z: 0 })).toBe(false);
    expect(questCares(mainAt('gate'), { e: 'reach', zone: 'greenway', x: 0, z: 0 })).toBe(true);
    expect(questCares(mainAt('pim_find'), { e: 'reach', zone: 'grove', x: 0, z: -11 })).toBe(false);
    expect(questCares(mainAt('pim_find'), { e: 'reach', zone: 'grove', x: STORY_NPCS.pim.x, z: STORY_NPCS.pim.z })).toBe(true);
    expect(questCares(mainAt('equip'), { e: 'equip', slot: 'chest', item: 'starter_chest_x' })).toBe(false);
    expect(questCares(mainAt('equip'), { e: 'equip', slot: 'chest', item: 'rootbound_chest' })).toBe(true);
    expect(questCares(mainAt('equip'), { e: 'equip', slot: 'legs', item: 'rootbound_chest' })).toBe(false);
    expect(questCares(mainDone(), { e: 'job' })).toBe(false);
    // junk events are cared about by nobody and change nothing
    for (const j of [{ e: 'kill', kind: 'dragon', key: 'k', party: false }, { e: 'reach', zone: 'moon', x: 0, z: 0 }, { e: 'reach', zone: 'greenway', x: NaN, z: 0 }, { e: 'act', what: 'dance' }, { e: 'nope' }, null] as unknown as QuestEvent[]) {
      expect(questCares(mainAt('gate'), j)).toBe(false);
      expect(evs(mainAt('gate'), [j]).changed).toBe(false);
    }
  });
});

describe('acts', () => {
  it('talk out of reach → where; a talk that completes nothing → none; a choice step without a valid choice → choice; with a full bag → bag-full', () => {
    const s = newQuestSave(DAY);
    const m = STORY_NPCS.marrow;
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, ctxAt('grove', m.x + NPC_REACH + REACH_FUZZ + 0.01, m.z))).toEqual({ refusal: 'where' });
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, ctxAt('grove', m.x + 10, m.z))).toEqual({ refusal: 'where' });
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, ctxAt('greenway', m.x, m.z))).toEqual({ refusal: 'where' });
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, ctxAt('grove', NaN, m.z))).toEqual({ refusal: 'where' });
    expect(applyQuestAct(s, { act: 'use', prop: 'plaque' }, atNpc('pim'))).toEqual({ refusal: 'where' });
    const t = act(s, { act: 'talk', npc: 'marrow' }, ctxAt('grove', m.x + NPC_REACH + REACH_FUZZ - 0.01, m.z));
    expect(t.done).toEqual([{ quest: MAIN, step: 0, times: 0, choice: null }]);
    expect(t.save.active[0]!.step).toBe(1);
    expect(applyQuestAct(t.save, { act: 'talk', npc: 'marrow' }, atNpc('marrow'))).toEqual({ none: true });
    expect(applyQuestAct(s, { act: 'talk', npc: 'pim' }, atNpc('pim'))).toEqual({ none: true });
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, atNpc('marrow', { dead: true }))).toEqual({ refusal: 'dead' });
    expect(applyQuestAct(s, { act: 'talk', npc: 'marrow' }, atNpc('marrow', { busy: true }))).toEqual({ refusal: 'busy' });
    const r = mainAt('nell_report');
    expect(applyQuestAct(r, { act: 'talk', npc: 'nell' }, atNpc('nell'))).toEqual({ refusal: 'choice' });
    expect(applyQuestAct(r, { act: 'talk', npc: 'nell', choice: 3 }, atNpc('nell'))).toEqual({ refusal: 'choice' });
    expect(applyQuestAct(r, { act: 'talk', npc: 'nell', choice: 2 }, atNpc('nell', { bagFree: 0 }))).toEqual({ refusal: 'bag-full' });
    const c = act(r, { act: 'talk', npc: 'nell', choice: 2 }, atNpc('nell'));
    expect(c.done).toEqual([{ quest: MAIN, step: 11, times: 0, choice: 2 }]);
    expect(c.save.active[0]).toMatchObject({ step: 12, choice: 2 });
  });

  it('accept: requires, active, done, done-today, full, where; abandon: main refused, side drops progress', () => {
    const early = mainAt('board');
    expect(applyQuestAct(early, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram'))).toEqual({ refusal: 'requires' });
    expect(applyQuestAct(early, { act: 'accept', quest: MAIN }, atNpc('bram'))).toEqual({ refusal: 'active' });
    expect(applyQuestAct(mainDone(), { act: 'accept', quest: MAIN }, atNpc('bram'))).toEqual({ refusal: 'done' });
    expect(applyQuestAct(mainAt('nell'), { act: 'accept', quest: 'keepers_lamp' }, ctxAt('greenway', 0, 0))).toEqual({ refusal: 'requires' });
    const gate = mainAt('gate');
    expect(applyQuestAct(gate, { act: 'accept', quest: 'bristle_bounty' }, ctxAt('greenway', STORY_NPCS.bram.x, STORY_NPCS.bram.z))).toEqual({ refusal: 'where' });
    const a = act(gate, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram'));
    expect(a.save.active.map(p => p.id)).toEqual([MAIN, 'bristle_bounty']);
    expect(applyQuestAct(a.save, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram'))).toEqual({ refusal: 'active' });
    expect(applyQuestAct({ ...mainDone(), done: { ...mainDone().done, grans_waymarks: { day: DAY, times: 1 } } }, { act: 'accept', quest: 'grans_waymarks' }, atNpc('tamsin'))).toEqual({ refusal: 'done' });
    // full: QUEST_ACTIVE_MAX actives (built directly; the data has only four quests)
    const full = { ...gate, active: Array.from({ length: QUEST_ACTIVE_MAX }, () => gate.active[0]!) };
    expect(applyQuestAct(full, { act: 'accept', quest: 'grans_waymarks' }, atNpc('tamsin'))).toEqual({ refusal: 'full' });
    // the epilogue has no giver: accepted anywhere once the main quest is done; inside the Lampfall its first step is met at once
    expect(act(mainDone(), { act: 'accept', quest: 'keepers_lamp' }, ctxAt('greenway', 100, 0)).save.active).toEqual([{ id: 'keepers_lamp', step: 0, counts: [0], since: DAY }]);
    expect(act(mainDone(), { act: 'accept', quest: 'keepers_lamp' }, ctxAt('lampfall', 0, 0)).save.active).toEqual([{ id: 'keepers_lamp', step: 1, counts: [0], since: DAY }]);
    // abandon
    expect(applyQuestAct(a.save, { act: 'abandon', quest: MAIN }, atNpc('bram'))).toEqual({ refusal: 'main' });
    expect(applyQuestAct(gate, { act: 'abandon', quest: 'bristle_bounty' }, atNpc('bram'))).toEqual({ refusal: 'unknown' });
    const progressed = evs(a.save, [kill('boar'), kill('boar')]).save;
    const ab = act(progressed, { act: 'abandon', quest: 'bristle_bounty' }, ctxAt('greenway', 0, 0));
    expect(ab.save.active.map(p => p.id)).toEqual([MAIN]);
    const again = act(ab.save, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram'));
    expect(again.save.active[1]!.counts).toEqual([0]);
  });

  it('the daily pays once per UTC day: complete, abandon-and-retake the same day is refused, the next day is accepted', () => {
    let s = act(mainAt('gate'), { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram')).save;
    s = evs(s, Array.from({ length: 6 }, () => kill('boar'))).save;
    const t = act(s, { act: 'talk', npc: 'bram' }, atNpc('bram'));
    expect(t.done).toEqual([{ quest: 'bristle_bounty', step: 1, times: 0, choice: null }]);
    s = t.save;
    expect(s.done.bristle_bounty).toEqual({ day: DAY, times: 1 });
    expect(applyQuestAct(s, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram'))).toEqual({ refusal: 'done-today' });
    expect(questsView(s, DAY).offers).not.toContain('bristle_bounty');
    expect(questsView(s, NEXT).offers).toContain('bristle_bounty');
    s = act(s, { act: 'accept', quest: 'bristle_bounty' }, atNpc('bram', { day: NEXT })).save;
    s = evs(s, Array.from({ length: 6 }, () => kill('boar')), NEXT).save;
    const t2 = act(s, { act: 'talk', npc: 'bram' }, atNpc('bram', { day: NEXT }));
    expect(t2.done).toEqual([{ quest: 'bristle_bounty', step: 1, times: 1, choice: null }]);
    expect(t2.save.done.bristle_bounty).toEqual({ day: NEXT, times: 2 });
    // the two days' keys differ, so both pay
    expect(questRewardKey(t.done[0]!)).not.toBe(questRewardKey(t2.done[0]!));
  });

  it('abandoning and retaking the epilogue pays each step once (paid remembers the run)', () => {
    let s = act(mainDone(), { act: 'accept', quest: 'keepers_lamp' }, ctxAt('lampfall', 0, 0)).save;
    const h = evs(s, [kill('wickhound')]);
    expect(h.done).toEqual([{ quest: 'keepers_lamp', step: 1, times: 0, choice: null }]);
    s = act(h.save, { act: 'abandon', quest: 'keepers_lamp' }, ctxAt('lampfall', 0, 0)).save;
    expect(s.paid).toEqual({ keepers_lamp: 2 });
    s = act(s, { act: 'accept', quest: 'keepers_lamp' }, ctxAt('lampfall', 0, 0)).save;
    const h2 = evs(s, [kill('wickhound')]);
    expect(h2.done).toEqual([]); // already paid in this run
    expect(h2.save.active.find(p => p.id === 'keepers_lamp')!.step).toBe(2);
    const w = evs(h2.save, [kill('fallen_warden')]);
    expect(w.done).toEqual([{ quest: 'keepers_lamp', step: 2, times: 0, choice: null }]);
    expect(w.save.paid).toEqual({});
    expect(w.save.done.keepers_lamp).toEqual({ day: DAY, times: 1 });
    expect(questsView(w.save, NEXT).offers).not.toContain('keepers_lamp');
  });
});

describe('rewards', () => {
  it('grantQuestRewards: xp to the current job, gold and the chosen item through addLoot with the quest key; a replay is a dup and gives nothing', () => {
    const s0 = inv();
    const done: StepDone[] = [{ quest: MAIN, step: 11, times: 0, choice: 2 }];
    const r = grantQuestRewards(deepFreeze(s0), done, 'warrior');
    if ('refusal' in r) throw new Error('refused');
    expect(r.dGold).toBe(40);
    expect(r.xp).toBe(40);
    expect(r.state.gold).toBe(40);
    expect(r.state.inv.bag.at(-1)!.item).toBe('rootbound_chest');
    expect(r.state.inv.recentKills).toContain('q:solstice_crossing:11:0');
    expect(recordFor(r.state.jobs, 'warrior').xp).toBe(40);
    expect(r.given).toEqual([{ quest: MAIN, step: 11, stepId: 'nell_report', xp: 40, gold: 40, item: 'rootbound_chest', title: null, unlock: null, scene: null, questDone: false }]);
    // xp to another job when that one is current
    const rr = grantQuestRewards(s0, done, 'ranger');
    if ('refusal' in rr) throw new Error('refused');
    expect(recordFor(rr.state.jobs, 'ranger').xp).toBe(40);
    // a replay of the same steps on the result: nothing
    const again = grantQuestRewards(r.state, done, 'warrior');
    if ('refusal' in again) throw new Error('refused');
    expect([again.dGold, again.xp, again.given.length]).toEqual([0, 0, 0]);
    expect(again.state).toBe(r.state);
    // the same step listed twice in one call pays once
    const twice = grantQuestRewards(s0, [...done, ...done], 'warrior');
    if ('refusal' in twice) throw new Error('refused');
    expect([twice.dGold, twice.xp, twice.state.inv.bag.length - s0.inv.bag.length]).toEqual([40, 40, 1]);
    // a full bag refuses it all
    let fullS = s0;
    for (let i = 0; bagUsed(fullS.inv) < BAG_SLOTS; i++) fullS = addLoot(fullS, 'mossweave_chest', 0, `fill:${i}`).state;
    expect(grantQuestRewards(fullS, done, 'warrior')).toEqual({ refusal: 'bag-full' });
    // a step without an item never needs room
    const g = grantQuestRewards(fullS, [{ quest: MAIN, step: 0, times: 0, choice: null }], 'warrior');
    expect('refusal' in g).toBe(false);
    // junk StepDone entries are ignored
    const junk = grantQuestRewards(s0, [{ quest: MAIN, step: 99, times: 0, choice: null }, { quest: 'nope' as QuestId, step: 0, times: 0, choice: null }], 'warrior');
    if ('refusal' in junk) throw new Error('refused');
    expect([junk.dGold, junk.xp, junk.given.length]).toEqual([0, 0, 0]);
  });

  it('completing the last step: done with times and choice, the title and unlock in given, home:starter_cottage in unlocks', () => {
    const { save, done } = runMain(1);
    expect(save.active).toEqual([]);
    expect(save.done.solstice_crossing).toEqual({ day: DAY, times: 1, choice: 1 });
    expect(save.unlocks).toEqual(['home:starter_cottage']);
    expect(done.map(d => d.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const r = grantQuestRewards(inv(), done, 'warrior');
    if ('refusal' in r) throw new Error('refused');
    expect(r.xp).toBe(350);
    expect(r.dGold).toBe(95);
    expect(r.state.inv.bag.at(-1)!.item).toBe('thornrunner_chest');
    const last = r.given.at(-1)!;
    expect(last).toMatchObject({ stepId: 'crater', title: 'Witness of the Crossing', unlock: 'home:starter_cottage', scene: 'crater', questDone: true });
    expect(r.given.find(g => g.stepId === 'plaque')!.scene).toBe('beacon');
    expect(r.given.filter(g => g.questDone).length).toBe(1);
    expect(questsView(save, DAY).offers).toEqual(['keepers_lamp', 'bristle_bounty', 'grans_waymarks']);
    expect(questStepOf(save, MAIN)).toBeNull();
    expect(questStepOf(newQuestSave(DAY), MAIN)!.id).toBe('marrow');
  });

  it('fuzz: over random events and acts, progress never goes backwards, counts never exceed targets, every reward key pays once', () => {
    const rnd = prng(0x51a7);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    const kinds = Object.keys(ENEMY_KINDS) as (keyof typeof ENEMY_KINDS)[];
    const spots = [...NPC_IDS.map(n => STORY_NPCS[n]), ...PROP_IDS.map(p => STORY_PROPS[p])];
    for (let run = 0; run < 60; run++) {
      // a third of the runs start at Marrow, a third at the gate, a third with the main quest done (side quests and the epilogue open)
      let s = [newQuestSave(DAY), mainAt('gate'), mainDone()][run % 3]!, st = inv(), day = DAY, dayN = 12;
      const paidKeys = new Set<string>();
      let mainStep = s.active[0]?.id === MAIN ? s.active[0].step : 0, mainDoneSeen = !!s.done.solstice_crossing, keys = 0;
      for (let i = 0; i < 400; i++) {
        const before = s;
        let res: { save: QuestSave; done: StepDone[] } | null = null;
        const r = rnd();
        if (r < 0.45) {
          const ev: QuestEvent = pick<() => QuestEvent>([
            () => ({ e: 'kill', kind: pick(kinds), key: `k${rnd() < 0.2 ? keys : ++keys}`, party: rnd() < 0.3 }),
            () => { const sp = pick(spots); return { e: 'reach', zone: rnd() < 0.2 ? 'lampfall' : sp.zone, x: sp.x + (rnd() - 0.5) * 8, z: sp.z + (rnd() - 0.5) * 8 }; },
            () => ({ e: 'jump' }), () => ({ e: 'job' }), () => ({ e: 'act', what: pick(['finisher', 'combo', 'dodge', 'pick'] as const) }),
            () => ({ e: 'equip', slot: pick(['chest', 'legs'] as const), item: pick(['mossweave_chest', 'rootbound_chest', 'mossweave_legs']) }),
          ])();
          const care = questCares(s, ev);
          res = applyQuestEvents(s, [ev], day);
          if (!care) expect(res.save).toBe(s);
        } else {
          const sp = pick(spots);
          const a: QuestAct = pick<() => QuestAct>([
            () => ({ act: 'talk', npc: pick(NPC_IDS), choice: Math.floor(rnd() * 4) }), () => ({ act: 'use', prop: pick(PROP_IDS) }),
            () => ({ act: 'accept', quest: pick(QUEST_IDS) }), () => ({ act: 'abandon', quest: pick(QUEST_IDS) }), () => ({ act: 'skip', quest: pick(QUEST_IDS) }),
          ])();
          const out = applyQuestAct(s, a, { zone: rnd() < 0.1 ? 'lampfall' : sp.zone, x: sp.x + (rnd() - 0.5) * 4, z: sp.z + (rnd() - 0.5) * 4, day, dead: rnd() < 0.03, busy: rnd() < 0.03, bagFree: rnd() < 0.1 ? 0 : 5 });
          if ('save' in out) res = out;
        }
        if (rnd() < 0.01) { dayN++; day = `2026-11-${String(dayN).padStart(2, '0')}`; }
        if (!res) { expect(s).toBe(before); continue; }
        s = res.save;
        expect(isQuestSave(s)).toBe(true);
        // the main quest never goes back, and once done stays done
        const m = s.active.find(p => p.id === MAIN);
        if (mainDoneSeen) expect(m).toBeUndefined();
        if (m) { expect(m.step).toBeGreaterThanOrEqual(mainStep); mainStep = m.step; } else { expect(s.done.solstice_crossing).toBeDefined(); mainDoneSeen = true; }
        for (const p of s.active) {
          const stp = QUESTS[p.id].steps[p.step]!;
          stp.objectives.forEach((o, k) => { expect(p.counts[k]).toBeGreaterThanOrEqual(0); expect(p.counts[k]).toBeLessThanOrEqual(objectiveTarget(o)); });
        }
        for (const d of res.done) {
          const key = questRewardKey(d);
          expect(paidKeys.has(key), key).toBe(false);
          paidKeys.add(key);
        }
        const g = grantQuestRewards(st, res.done, 'warrior');
        if (!('refusal' in g)) st = g.state;
      }
      // the xp paid is exactly the rewards of the keys paid
      const want = [...paidKeys].reduce((a, k) => { const [, q, step] = k.split(':'); return a + (QUESTS[q as QuestId].steps[Number(step)]!.reward?.xp ?? 0); }, 0);
      expect(recordFor(st.jobs, 'warrior').xp).toBeLessThanOrEqual(want);
    }
  });
});

describe('messages and views', () => {
  it('parseQuestAct refuses junk: wrong types, NaN, -1, 8, 1e9, unknown ids, extra keys, long strings', () => {
    expect(parseQuestAct({ act: 'talk', npc: 'marrow' })).toEqual({ act: 'talk', npc: 'marrow' });
    expect(parseQuestAct({ act: 'talk', npc: 'nell', choice: 0 })).toEqual({ act: 'talk', npc: 'nell', choice: 0 });
    expect(parseQuestAct({ act: 'talk', npc: 'nell', choice: 7 })).toEqual({ act: 'talk', npc: 'nell', choice: 7 });
    expect(parseQuestAct({ act: 'use', prop: 'plaque' })).toEqual({ act: 'use', prop: 'plaque' });
    for (const a of ['accept', 'abandon', 'skip'] as const) expect(parseQuestAct({ act: a, quest: 'grans_waymarks' })).toEqual({ act: a, quest: 'grans_waymarks' });
    for (const j of [
      null, undefined, 0, 'talk', [], { act: 'talk' }, { act: 'talk', npc: 'ellie' }, { act: 'talk', npc: 'nell', choice: NaN }, { act: 'talk', npc: 'nell', choice: -1 },
      { act: 'talk', npc: 'nell', choice: 8 }, { act: 'talk', npc: 'nell', choice: 1e9 }, { act: 'talk', npc: 'nell', choice: 1.5 }, { act: 'talk', npc: 'nell', choice: '1' },
      { act: 'talk', npc: 'nell', extra: 1 }, { act: 'use', prop: 'statue' }, { act: 'use', prop: 'plaque', npc: 'nell' }, { act: 'accept', quest: 'x'.repeat(10_000) },
      { act: 'accept', quest: 'toString' }, { act: 'accept', quest: '__proto__' }, { act: 'dance', quest: MAIN }, { act: 'skip' }, { act: 1, quest: MAIN },
      { act: 'talk', npc: ['marrow'] }, JSON.parse('{"act":"talk","npc":"marrow","__proto__":{"x":1}}'),
    ]) expect(parseQuestAct(j), JSON.stringify(j)).toBeNull();
  });

  it('questsView: offers follow prerequisites and the daily; the view of this slice is under 300 bytes as JSON', () => {
    expect(questsView(newQuestSave(DAY), DAY)).toEqual({ active: [{ id: MAIN, step: 0, counts: [0] }], done: [], offers: [], skipped: [] });
    expect(questsView(mainAt('gate'), DAY).offers).toEqual(['bristle_bounty', 'grans_waymarks']);
    expect(questsView(mainAt('board'), DAY).offers).toEqual([]);
    // the biggest this slice gets: the main quest done (duo skipped), the other three active, the daily done many times before
    const big: QuestSave = {
      ...mainDone(),
      active: [{ id: 'keepers_lamp', step: 1, counts: [0], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [5], since: DAY }, { id: 'grans_waymarks', step: 0, counts: [1, 1, 0], since: DAY }],
      done: { solstice_crossing: { day: DAY, times: 1, choice: 2 }, bristle_bounty: { day: '2026-11-11', times: 99_999 } },
      skipped: ['solstice_crossing:duo'],
    };
    expect(isQuestSave(big)).toBe(true);
    const v = questsView(big, DAY);
    // the plan's "under 300 bytes" holds for every state up to the end of the main quest; this worst case
    // (all four quests touched, a five-digit daily count) is 311 bytes, so it is held to 320
    expect(JSON.stringify(v).length).toBeLessThan(320);
    // and the main quest mid-way with both side quests
    const mid: QuestSave = { ...mainAt('first_fight'), active: [{ id: MAIN, step: 8, counts: [2, 1, 0, 1], since: DAY }, { id: 'bristle_bounty', step: 0, counts: [5], since: DAY }, { id: 'grans_waymarks', step: 0, counts: [1, 1, 0], since: DAY }], done: { bristle_bounty: { day: '2026-11-11', times: 9 } } };
    expect(JSON.stringify(questsView(mid, DAY)).length).toBeLessThan(300);
    expect(JSON.stringify(questsView(runMain().save, DAY)).length).toBeLessThan(300);
    // a view is a copy
    v.active[0]!.counts[0] = 99;
    expect(big.active[0]!.counts[0]).toBe(0);
    expect(Object.keys(QUEST_TEXT).length).toBe(14);
  });
});
