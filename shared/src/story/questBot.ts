// The quest follower for the load bots (server/scripts/bots.ts --quest): from an adventurer's own `quests` view and
// where it stands, the one thing it should do next. Pure and deterministic: no clock, no randomness; the bot itself
// walks (findPath, through exits), talks, jumps, fights with the shared brain and equips as the goal says.
//
// Rules (Plan 6 Task 7):
// - the main quest first; a talk that completes a step with a reward choice takes choice index % 3;
// - at the Guild Board a bot sends `job` with its current job (bots.ts substitutes its --jobs mixed job);
// - the optional `duo` step: bots in a party fight together; the others go after a Mossback when index % 4 === 0,
//   else skip it;
// - after the main quest, every third bot accepts Bristle Bounty and every fifth Gran's Waymarks (at their givers);
//   every tenth accepts the epilogue (The Keeper's Lamp) and abandons it again (an abandon path): bots never enter
//   the Lampfall for it (only --dungeon does that);
// - `dropped`: quests this bot already abandoned (it does not accept them again).
import type { EnemyKindId } from '../combat/enemies';
import type { JobId } from '../combat/jobs';
import type { GearSlot } from '../items';
import { QUESTS, type Objective, type QuestAction, type QuestId, type QuestsView, objectiveTarget } from '../quests';
import { GUILD_BOARD, greenwayLayout, zoneDef, type ZoneId } from '../world/zones';
import { NPC_REACH, PROP_REACH, STORY_NPCS, STORY_PROPS, type NpcId, type PropId } from './spots';

export type QuestGoal =
  | { g: 'goto'; zone: ZoneId; x: number; z: number; within: number }
  | { g: 'talk'; npc: NpcId; choice?: number } | { g: 'use'; prop: PropId }
  | { g: 'jump' } | { g: 'job'; job: JobId }
  | { g: 'fight'; kinds: readonly EnemyKindId[] | 'any'; acts: readonly QuestAction[] }
  | { g: 'equip'; slot: GearSlot } | { g: 'skip'; quest: QuestId } | { g: 'accept'; quest: QuestId }
  | { g: 'abandon'; quest: QuestId } | { g: 'idle' };

export interface QuestHere {
  zone: ZoneId; x: number; z: number; job: JobId; inParty: boolean; index: number;
  /** Quests this bot has abandoned (never accepted again). */
  dropped?: readonly QuestId[];
}

/** How near a bot walks before it talks or uses (inside NPC_REACH / PROP_REACH, with room for its own drift). */
export const TALK_WITHIN = NPC_REACH - 1.1;
export const USE_WITHIN = PROP_REACH - 1;
/** How near the Guild Board a bot stands to take its job (the board's own reach is 3 m). */
export const BOARD_WITHIN = 2;

const d2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** A camp of one of `kinds` nearest to (x, z) in the Greenway (any camp for 'any'). */
function campFor(kinds: readonly EnemyKindId[] | 'any', x: number, z: number): { x: number; z: number; r: number } {
  const camps = greenwayLayout().camps.filter(c => kinds === 'any' || c.spawns.some(s => kinds.includes(s.kind)));
  const list = camps.length ? camps : greenwayLayout().camps;
  let best = list[0]!;
  for (const c of list) if (d2(c.x, c.z, x, z) < d2(best.x, best.z, x, z)) best = c;
  return best;
}

/** Walk to `zone` (x, z) unless already within `within` there. */
function near(here: QuestHere, zone: ZoneId, x: number, z: number, within: number): QuestGoal | null {
  return here.zone === zone && d2(here.x, here.z, x, z) <= within ? null : { g: 'goto', zone, x, z, within };
}

/** The goal for one quest's current step. */
function stepGoal(view: QuestsView, id: QuestId, here: QuestHere): QuestGoal {
  const p = view.active.find(a => a.id === id)!;
  const step = QUESTS[id].steps[p.step];
  if (!step) return { g: 'idle' };
  const open: { o: Objective; i: number }[] = step.objectives.map((o, i) => ({ o, i })).filter(({ o, i }) => (p.counts[i] ?? 0) < objectiveTarget(o));
  if (step.optional && id === 'solstice_crossing' && step.id === 'duo') {
    if (here.inParty) {
      const g = near(here, 'greenway', zoneDef('greenway').spawn.x, zoneDef('greenway').spawn.z, Infinity);
      return g ?? { g: 'fight', kinds: 'any', acts: [] };
    }
    if (here.index % 4 === 0) {
      if (here.zone !== 'greenway') { const c = campFor(['mossback'], here.x, here.z); return { g: 'goto', zone: 'greenway', x: c.x, z: c.z, within: c.r + 6 }; }
      return { g: 'fight', kinds: ['mossback'], acts: [] };
    }
    return { g: 'skip', quest: id };
  }
  const first = open[0];
  if (!first) return { g: 'idle' }; // (met, waiting for the server's step)
  const o = first.o;
  switch (o.k) {
    case 'talk': {
      const s = STORY_NPCS[o.npc];
      const g = near(here, s.zone, s.x, s.z, TALK_WITHIN);
      if (g) return g;
      return step.reward?.choice ? { g: 'talk', npc: o.npc, choice: here.index % step.reward.choice.length } : { g: 'talk', npc: o.npc };
    }
    case 'use': {
      const s = STORY_PROPS[o.prop];
      return near(here, s.zone, s.x, s.z, USE_WITHIN) ?? { g: 'use', prop: o.prop };
    }
    case 'reach': {
      if (o.x !== undefined && o.z !== undefined && o.r !== undefined) return near(here, o.zone, o.x, o.z, Math.max(1, o.r - 2)) ?? { g: 'idle' };
      const sp = zoneDef(o.zone).spawn;
      return here.zone === o.zone ? { g: 'idle' } : { g: 'goto', zone: o.zone, x: sp.x, z: sp.z, within: Infinity };
    }
    case 'jump': return { g: 'jump' };
    case 'job': return near(here, 'grove', GUILD_BOARD.x, GUILD_BOARD.z, BOARD_WITHIN) ?? { g: 'job', job: here.job };
    case 'equip': return { g: 'equip', slot: o.slot };
    case 'kill': case 'act': {
      const kills = open.filter(({ o: k }) => k.k === 'kill').map(({ o: k }) => k as Extract<Objective, { k: 'kill' }>);
      const kinds: readonly EnemyKindId[] | 'any' = kills.length === 0 || kills.some(k => k.kinds === 'any') ? 'any' : [...new Set(kills.flatMap(k => k.kinds as readonly EnemyKindId[]))];
      const acts = open.filter(({ o: a }) => a.k === 'act').map(({ o: a }) => (a as Extract<Objective, { k: 'act' }>).what);
      if (here.zone !== 'greenway') { const c = campFor(kinds, here.x, here.z); return { g: 'goto', zone: 'greenway', x: c.x, z: c.z, within: c.r + 6 }; }
      return { g: 'fight', kinds, acts };
    }
    default: return { g: 'idle' };
  }
}

/** The one thing to do next (see the file comment). */
export function questGoal(view: QuestsView, here: QuestHere): QuestGoal {
  const dropped = here.dropped ?? [];
  if (view.active.some(a => a.id === 'solstice_crossing')) return stepGoal(view, 'solstice_crossing', here);
  // the epilogue: taken and dropped again by every tenth bot (never entered without --dungeon)
  if (view.active.some(a => a.id === 'keepers_lamp')) return { g: 'abandon', quest: 'keepers_lamp' };
  for (const a of view.active) return stepGoal(view, a.id, here);
  const wants: QuestId[] = [];
  if (here.index % 3 === 0) wants.push('bristle_bounty');
  if (here.index % 5 === 0) wants.push('grans_waymarks');
  if (here.index % 10 === 0) wants.push('keepers_lamp');
  for (const q of wants) {
    if (!view.offers.includes(q) || dropped.includes(q)) continue;
    const giver = QUESTS[q].giver;
    if (giver) {
      const s = STORY_NPCS[giver];
      const g = near(here, s.zone, s.x, s.z, TALK_WITHIN);
      if (g) return g;
    }
    return { g: 'accept', quest: q };
  }
  return { g: 'idle' };
}
