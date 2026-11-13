// The pure parts of the story world: entity ids, which marker shows over whom, the NPC looks and the prop budgets.
import { describe, expect, it } from 'vitest';
import {
  NPC_IDS, PROP_IDS, PEOPLES, QUESTS, newQuestSave, parseLook, questsView,
  type NpcId, type PropId, type QuestId, type QuestSave, type QuestsView,
} from '@sg2/shared';
import { GUILD_BOARD_EID } from './guildBoard';
import {
  STORY_EID_BASE, STORY_LOOKS, STORY_NPC_COLOR, beaconRaisedFor, markerFor, propTriangles, storyEid, storyIdOf,
  zoneStoryTriangles, MARKER_TRIANGLES, markerHeight,
} from './storyNpcs';

const DAY = '2026-11-13';
const ALL: (NpcId | PropId)[] = [...NPC_IDS, ...PROP_IDS];
const stepIx = (q: QuestId, id: string) => QUESTS[q].steps.findIndex((s) => s.id === id);

/** A save with the main quest at `step` (or done), and the side quests as given. */
function save(main: string | 'done', side: { id: QuestId; step: string; counts?: number[] }[] = [], done: Partial<Record<QuestId, string>> = {}): QuestSave {
  const s = newQuestSave(DAY);
  const active = main === 'done' ? [] : [{ ...s.active[0], step: stepIx('solstice_crossing', main), counts: QUESTS.solstice_crossing.steps[stepIx('solstice_crossing', main)].objectives.map(() => 0) }];
  for (const q of side) {
    const ix = stepIx(q.id, q.step);
    active.push({ id: q.id, step: ix, counts: q.counts ?? QUESTS[q.id].steps[ix].objectives.map(() => 0), since: DAY });
  }
  const d: { -readonly [K in QuestId]?: { day: string; times: number } } = {};
  if (main === 'done') d.solstice_crossing = { day: DAY, times: 1 };
  for (const [q, day] of Object.entries(done)) d[q as QuestId] = { day: day!, times: 1 };
  return { ...s, active, done: d };
}
const view = (s: QuestSave, day = DAY): QuestsView => questsView(s, day);
const markers = (v: QuestsView | null) => Object.fromEntries(ALL.map((id) => [id, markerFor(id, v)]));

describe('story entity ids', () => {
  it('are unique, negative, in their ranges and invert', () => {
    const eids = ALL.map(storyEid);
    expect(new Set(eids).size).toBe(ALL.length);
    NPC_IDS.forEach((id, i) => expect(storyEid(id)).toBe(STORY_EID_BASE - i));
    PROP_IDS.forEach((id, i) => expect(storyEid(id)).toBe(STORY_EID_BASE - 10 - i));
    for (const id of ALL) expect(storyIdOf(storyEid(id))).toBe(id);
    expect(STORY_EID_BASE).toBe(-100);
    expect(eids).not.toContain(GUILD_BOARD_EID);
    for (const e of [GUILD_BOARD_EID, 0, 5, -1, -99, -105, -109, -115, NaN, 1.5]) expect(storyIdOf(e)).toBeNull();
  });
});

describe('markerFor', () => {
  it('shows nothing without a view', () => {
    for (const id of ALL) expect(markerFor(id, null)).toBeNull();
  });

  it('follows the main quest: Marrow, Pim, the plaque, Nell, the crater', () => {
    let m = markers(view(save('marrow')));
    expect(m.marrow).toBe('talk');
    for (const id of ALL) if (id !== 'marrow') expect(m[id]).toBeNull();
    for (const step of ['pim_find', 'pim_hop', 'plaque', 'board', 'gate', 'first_fight', 'crater']) expect(markerFor('marrow', view(save(step)))).toBeNull();
    expect(markerFor('pim', view(save('pim_find')))).toBeNull(); // the voice is to be found, not shown
    expect(markerFor('pim', view(save('pim')))).toBe('talk');
    expect(markerFor('pim', view(save('plaque')))).toBeNull();
    m = markers(view(save('plaque')));
    expect(m.plaque).toBe('talk');
    expect(markers(view(save('board'))).plaque).toBeNull();
    // Nell: met first (◆), then waits while the fight goes on (grey), then the report is a turn-in (?)
    expect(markerFor('nell', view(save('gate')))).toBeNull();
    expect(markerFor('nell', view(save('nell')))).toBe('talk');
    for (const step of ['first_fight', 'picks', 'duo']) expect(markerFor('nell', view(save(step)))).toBe('busy');
    expect(markerFor('nell', view(save('nell_report')))).toBe('turnin');
    expect(markerFor('nell', view(save('equip')))).toBeNull();
    expect(markerFor('crater_edge', view(save('equip')))).toBeNull();
    expect(markerFor('crater_edge', view(save('crater')))).toBe('talk');
    m = markers(view(save('done')));
    for (const id of ['marrow', 'pim', 'nell', 'plaque', 'crater_edge'] as const) expect(m[id]).toBeNull();
  });

  it('Bram: nothing before the gate, "!" after it, grey while the boars run, "?" when they are done, nothing done today', () => {
    expect(markerFor('bram', view(save('board')))).toBeNull();
    expect(markerFor('bram', view(save('gate')))).toBe('offer'); // offered from the gate step on
    expect(markerFor('bram', view(save('nell')))).toBe('offer');
    expect(markerFor('bram', view(save('done')))).toBe('offer');
    expect(markerFor('bram', view(save('nell', [{ id: 'bristle_bounty', step: 'boars', counts: [5] }])))).toBe('busy');
    expect(markerFor('bram', view(save('nell', [{ id: 'bristle_bounty', step: 'bram' }])))).toBe('turnin');
    expect(markerFor('bram', view(save('done', [], { bristle_bounty: DAY })))).toBeNull();
    // a new day: offered again
    expect(markerFor('bram', view(save('done', [], { bristle_bounty: DAY }), '2026-11-14'))).toBe('offer');
  });

  it("Tamsin and Gran's waymarks: each stone shows until it is read", () => {
    expect(markerFor('tamsin', view(save('pim')))).toBeNull();
    expect(markerFor('tamsin', view(save('first_fight')))).toBe('offer');
    for (const w of ['waymark_1', 'waymark_2', 'waymark_3'] as const) expect(markerFor(w, view(save('first_fight')))).toBeNull();
    let v = view(save('first_fight', [{ id: 'grans_waymarks', step: 'stones', counts: [1, 0, 0] }]));
    expect(markerFor('tamsin', v)).toBe('busy');
    expect(markerFor('waymark_1', v)).toBeNull();
    expect(markerFor('waymark_2', v)).toBe('talk');
    expect(markerFor('waymark_3', v)).toBe('talk');
    v = view(save('first_fight', [{ id: 'grans_waymarks', step: 'tamsin' }]));
    expect(markerFor('tamsin', v)).toBe('turnin');
    for (const w of ['waymark_1', 'waymark_2', 'waymark_3'] as const) expect(markerFor(w, v)).toBeNull();
    expect(markerFor('tamsin', view(save('done', [], { grans_waymarks: '2026-01-01' })))).toBeNull();
  });

  it('an open objective outranks an offer at the same NPC', () => {
    // the main quest talks to Nell while Bram and Tamsin offer: each keeps its own marker
    const m = markers(view(save('nell')));
    expect([m.nell, m.bram, m.tamsin]).toEqual(['talk', 'offer', 'offer']);
  });

  it('ignores junk in a view (unknown quests, short counts)', () => {
    const v = { active: [{ id: 'nope', step: 0, counts: [] }, { id: 'grans_waymarks', step: 0, counts: [] }], done: [], offers: ['nope'], skipped: [] } as unknown as QuestsView;
    expect(markerFor('waymark_1', v)).toBe('talk');
    expect(markerFor('marrow', v)).toBeNull();
  });
});

describe('the Beacon state', () => {
  it('is raised once the plaque is read, or the quest is done', () => {
    expect(beaconRaisedFor(null)).toBe(false);
    for (const step of ['marrow', 'pim_find', 'pim_hop', 'pim', 'plaque']) expect(beaconRaisedFor(view(save(step)))).toBe(false);
    for (const step of ['board', 'gate', 'nell', 'first_fight', 'crater']) expect(beaconRaisedFor(view(save(step)))).toBe(true);
    expect(beaconRaisedFor(view(save('done')))).toBe(true);
  });
});

describe('NPC looks', () => {
  it('parse, and are the peoples the story names', () => {
    const want: Record<keyof typeof STORY_LOOKS, string> = { marrow: 'human', bram: 'knollfolk', tamsin: 'larchfolk', nell: 'brindlekin' };
    for (const [id, people] of Object.entries(want)) {
      const look = STORY_LOOKS[id as keyof typeof STORY_LOOKS];
      expect(parseLook(look), id).toEqual(look);
      expect(look.people).toBe(people);
      expect(PEOPLES[look.people]).toBeDefined();
    }
    // the fallback colours (until characters take a Look) are the offline demo's, and all differ
    expect(STORY_NPC_COLOR).toEqual({ marrow: undefined, tamsin: '#3FB0A6', bram: '#EC6A4C', nell: '#6E8B3D' });
  });
});

describe('budgets', () => {
  it('each prop stays under its triangle cap, on med and low', () => {
    for (const q of ['med', 'low'] as const) {
      for (const w of ['waymark_1', 'waymark_2', 'waymark_3'] as const) expect(propTriangles(w, q)).toBeLessThanOrEqual(120);
      expect(propTriangles('crater_edge', q)).toBeLessThanOrEqual(200);
      expect(propTriangles('plaque', q)).toBeLessThanOrEqual(40);
      expect(propTriangles('waymark_1', 'low')).toBeLessThanOrEqual(propTriangles('waymark_1', 'med'));
    }
  });
  it('markers and props of a zone stay under 1.5k triangles', () => {
    expect(MARKER_TRIANGLES).toBeGreaterThan(0);
    for (const z of ['grove', 'greenway'] as const) for (const q of ['med', 'low', 'high'] as const) {
      expect(zoneStoryTriangles(z, q)).toBeLessThanOrEqual(1500);
    }
  });
  it('markers hold a constant on-screen size between 8 and 40 m', () => {
    expect(markerHeight(8) / 8).toBeCloseTo(markerHeight(40) / 40, 6);
    expect(markerHeight(4)).toBe(markerHeight(8));
    expect(markerHeight(80)).toBe(markerHeight(40));
  });
});
