import { describe, expect, it } from 'vitest';
import { QUESTS, QUEST_IDS, applyQuestAct, applyQuestEvents, newQuestSave, questsView, type QuestEvent, type QuestId, type QuestSave, type QuestsView } from '../quests';
import { GUILD_BOARD, zoneDef, type ZoneId } from '../world/zones';
import { STORY_NPCS, STORY_PROPS } from './spots';
import { questGoal, type QuestGoal, type QuestHere } from './questBot';

const DAY = '2026-11-13';
const at = (zone: ZoneId, x: number, z: number, index = 1, inParty = false): QuestHere => ({ zone, x, z, job: 'warrior', inParty, index });
/** A view with quest `id` active at step `step` (nothing counted), the main quest done unless it is the main quest. */
function viewAt(id: QuestId, step: number, offers: QuestId[] = []): QuestsView {
  const counts = QUESTS[id].steps[step]!.objectives.map(() => 0);
  return { active: [{ id, step, counts }], done: id === 'solstice_crossing' ? [] : [{ id: 'solstice_crossing', times: 1, today: true }], offers, skipped: [] };
}
/** Where a goal's own target stands (to ask again from there). */
function spotOf(g: QuestGoal): QuestHere | null {
  return g.g === 'goto' ? at(g.zone, g.x, g.z) : null;
}

describe('questGoal: every step of every quest', () => {
  it('the main quest, step by step, from far away and from the spot', () => {
    const far = at('grove', 60, 60);
    const expected: Record<string, QuestGoal['g'][]> = {
      marrow: ['goto', 'talk'], pim_find: ['goto', 'idle'], pim_hop: ['jump'], pim: ['goto', 'talk'], plaque: ['goto', 'use'],
      board: ['goto', 'job'], gate: ['goto', 'idle'], nell: ['goto', 'talk'], first_fight: ['goto', 'fight'], picks: ['goto', 'fight'],
      duo: ['skip'], nell_report: ['goto', 'talk'], equip: ['equip'], crater: ['goto', 'use'],
    };
    QUESTS.solstice_crossing.steps.forEach((s, k) => {
      const v = viewAt('solstice_crossing', k);
      const g1 = questGoal(v, far);
      const there = spotOf(g1);
      const got = there ? [g1.g, questGoal(v, there).g] : [g1.g];
      expect(got, s.id).toEqual(expected[s.id]);
    });
  });

  it('talks to the right people with the right choice, and takes the job it has at the board', () => {
    const v = viewAt('solstice_crossing', QUESTS.solstice_crossing.steps.findIndex(s => s.id === 'nell_report'));
    const nell = STORY_NPCS.nell;
    for (const index of [0, 1, 2, 3, 4, 5]) expect(questGoal(v, at(nell.zone, nell.x, nell.z, index))).toEqual({ g: 'talk', npc: 'nell', choice: index % 3 });
    expect(questGoal(viewAt('solstice_crossing', 0), at('grove', STORY_NPCS.marrow.x, STORY_NPCS.marrow.z))).toEqual({ g: 'talk', npc: 'marrow' });
    const board = viewAt('solstice_crossing', QUESTS.solstice_crossing.steps.findIndex(s => s.id === 'board'));
    expect(questGoal(board, { ...at('grove', GUILD_BOARD.x, GUILD_BOARD.z), job: 'ninja' })).toEqual({ g: 'job', job: 'ninja' });
  });

  it('first_fight: Thornlings and the acts still missing; in the grove it walks to a Thornling camp first', () => {
    const k = QUESTS.solstice_crossing.steps.findIndex(s => s.id === 'first_fight');
    const v = viewAt('solstice_crossing', k);
    const g = questGoal(v, at('grove', 0, 0));
    expect(g.g).toBe('goto');
    expect(g.g === 'goto' && g.zone).toBe('greenway');
    expect(questGoal(v, at('greenway', 0, 0))).toEqual({ g: 'fight', kinds: ['thornling'], acts: ['finisher', 'combo', 'dodge'] });
    v.active[0]!.counts = [3, 1, 0, 1];
    expect(questGoal(v, at('greenway', 0, 0))).toEqual({ g: 'fight', kinds: 'any', acts: ['combo'] });
  });

  it('duo: a party fights together, every fourth goes for a Mossback, the rest skip', () => {
    const v = viewAt('solstice_crossing', QUESTS.solstice_crossing.steps.findIndex(s => s.id === 'duo'));
    expect(questGoal(v, at('greenway', 0, 0, 1, true))).toEqual({ g: 'fight', kinds: 'any', acts: [] });
    expect(questGoal(v, at('greenway', 0, 0, 4))).toEqual({ g: 'fight', kinds: ['mossback'], acts: [] });
    expect(questGoal(v, at('greenway', 0, 0, 5))).toEqual({ g: 'skip', quest: 'solstice_crossing' });
    expect(questGoal(v, at('grove', 0, 0, 8)).g).toBe('goto');
  });

  it('the side quests, the daily and the epilogue, every step', () => {
    const bram = STORY_NPCS.bram, tamsin = STORY_NPCS.tamsin;
    expect(questGoal(viewAt('bristle_bounty', 0), at('greenway', 0, 0))).toEqual({ g: 'fight', kinds: ['boar'], acts: [] });
    const b1 = questGoal(viewAt('bristle_bounty', 1), at('greenway', 0, 0));
    expect(b1.g === 'goto' && b1.zone).toBe(bram.zone);
    expect(questGoal(viewAt('bristle_bounty', 1), at(bram.zone, bram.x, bram.z))).toEqual({ g: 'talk', npc: 'bram' });
    const w = viewAt('grans_waymarks', 0);
    for (const [i, id] of (['waymark_1', 'waymark_2', 'waymark_3'] as const).entries()) {
      const p = STORY_PROPS[id];
      expect(questGoal(w, at(p.zone, p.x, p.z))).toEqual({ g: 'use', prop: id });
      w.active[0]!.counts[i] = 1;
    }
    expect(questGoal(viewAt('grans_waymarks', 1), at(tamsin.zone, tamsin.x, tamsin.z))).toEqual({ g: 'talk', npc: 'tamsin' });
    for (let k = 0; k < QUESTS.keepers_lamp.steps.length; k++) expect(questGoal(viewAt('keepers_lamp', k), at('greenway', 0, 0, 10))).toEqual({ g: 'abandon', quest: 'keepers_lamp' });
  });

  it('after the main quest: every third accepts the Bounty, every fifth the Waymarks, every tenth the epilogue (once)', () => {
    const done: QuestsView = { active: [], done: [{ id: 'solstice_crossing', times: 1, today: true }], offers: ['keepers_lamp', 'bristle_bounty', 'grans_waymarks'], skipped: [] };
    const bram = STORY_NPCS.bram, tamsin = STORY_NPCS.tamsin;
    expect(questGoal(done, at(bram.zone, bram.x, bram.z, 3))).toEqual({ g: 'accept', quest: 'bristle_bounty' });
    expect(questGoal(done, at(tamsin.zone, tamsin.x, tamsin.z, 5))).toEqual({ g: 'accept', quest: 'grans_waymarks' });
    expect(questGoal(done, at('greenway', 0, 0, 10)).g).toBe('goto'); // index 10 is a fifth too: Tamsin first
    expect(questGoal({ ...done, offers: ['keepers_lamp'] }, at('greenway', 0, 0, 10))).toEqual({ g: 'accept', quest: 'keepers_lamp' });
    expect(questGoal({ ...done, offers: ['keepers_lamp'] }, { ...at('greenway', 0, 0, 10), dropped: ['keepers_lamp'] })).toEqual({ g: 'idle' });
    expect(questGoal(done, at('greenway', 0, 0, 7))).toEqual({ g: 'idle' });
    for (const q of QUEST_IDS) expect(QUESTS[q]).toBeTruthy();
  });
});

describe('questGoal: a fake run on the real rules', () => {
  /** Feeds the follower the views of its own simulated save (applyQuestAct / applyQuestEvents) until it idles. */
  function run(index: number, inParty: boolean): { save: QuestSave; goals: string[] } {
    let save = newQuestSave(DAY);
    let here: QuestHere = { ...at('grove', zoneDef('grove').spawn.x, zoneDef('grove').spawn.z, index, inParty), dropped: [] };
    const goals: string[] = [];
    let n = 0;
    const ev = (evs: QuestEvent[]) => { save = applyQuestEvents(save, evs, DAY).save; };
    const act = (a: Parameters<typeof applyQuestAct>[1]) => {
      const r = applyQuestAct(save, a, { zone: here.zone, x: here.x, z: here.z, day: DAY, dead: false, busy: false, bagFree: 10 });
      if ('refusal' in r) throw new Error(`${JSON.stringify(a)} refused ${r.refusal}`);
      if ('save' in r) save = r.save;
    };
    for (;;) {
      if (++n > 200) throw new Error(`no end: ${goals.slice(-5).join(' ')}`);
      const g = questGoal(questsView(save, DAY), here);
      goals.push(g.g);
      switch (g.g) {
        case 'goto': {
          const zoneChange = g.zone !== here.zone;
          here = { ...here, zone: g.zone, x: g.x, z: g.z };
          if (zoneChange) ev([{ e: 'reach', zone: g.zone, x: g.x, z: g.z }]);
          ev([{ e: 'reach', zone: g.zone, x: g.x, z: g.z }]);
          break;
        }
        case 'talk': act(g.choice === undefined ? { act: 'talk', npc: g.npc } : { act: 'talk', npc: g.npc, choice: g.choice }); break;
        case 'use': act({ act: 'use', prop: g.prop }); break;
        case 'jump': ev([{ e: 'jump' }]); break;
        case 'job': ev([{ e: 'job' }]); break;
        case 'fight': {
          const kind = g.kinds === 'any' ? 'thornling' : g.kinds[0]!;
          ev([{ e: 'kill', kind, key: `k${n}`, party: inParty }, ...g.acts.map(what => ({ e: 'act' as const, what }))]);
          break;
        }
        case 'equip': ev([{ e: 'equip', slot: g.slot, item: QUESTS.solstice_crossing.steps.find(s => s.id === 'nell_report')!.reward!.choice![index % 3]! }]); break;
        case 'skip': case 'accept': act({ act: g.g, quest: g.quest }); break;
        case 'abandon': act({ act: 'abandon', quest: g.quest }); here = { ...here, dropped: [...(here.dropped ?? []), g.quest] }; break;
        case 'idle': return { save, goals };
      }
    }
  }

  it('reaches the end of the main quest (a lone bot that skips the duo step)', () => {
    const { save, goals } = run(1, false);
    expect(save.done.solstice_crossing?.times).toBe(1);
    expect(save.done.solstice_crossing?.choice).toBe(1);
    expect(save.skipped).toContain('solstice_crossing:duo');
    expect(goals).toContain('jump');
    expect(goals).toContain('equip');
  });

  it('a party bot does the duo step; a fourth hunts a Mossback; the tenth takes and drops the epilogue and does both side quests', () => {
    expect(run(1, true).save.skipped).toEqual([]);
    expect(run(4, false).save.skipped).toEqual([]);
    const ten = run(30, false); // a third, a fifth and a tenth
    expect(ten.save.done.solstice_crossing?.times).toBe(1);
    expect(ten.save.done.bristle_bounty?.times).toBe(1);
    expect(ten.save.done.grans_waymarks?.times).toBe(1);
    expect(ten.goals).toContain('abandon');
    expect(ten.save.active).toEqual([]);
  });
});
