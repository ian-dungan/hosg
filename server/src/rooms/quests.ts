// The quest helpers the zone room calls (server only, pure): which combat acts an fx stream holds for one
// adventurer, whether an accepted pose is a jump, the place events of a pose, which kinds of events an adventurer's
// current steps can use at all (so the room skips the work for everyone else), the quest day, the reward write a
// quest change makes, and the test-only start step (SG2_TEST_QUEST).
//
// Everything here works from the server's own state: the engine's fx, accepted poses and the stored quest save.
import {
  JOBS, JUMP_MIN_M, MAIN_QUEST, QUESTS, QUEST_IDS, grantQuestRewards, isQuestId, newQuestSave, objectiveTarget, questRewardKey,
  type AbilityId, type FxEvent, type InvState, type JobId, type QuestEvent, type QuestGiven, type QuestId, type QuestSave, type StepDone, type ZoneId,
} from '@sg2/shared';

/**
 * The combat acts in `fx` for adventurer `eid` (running `job` with `picks`): a `use` of the job's finisher
 * (`JOBS[job].bar[1]`) or of one of its picks, a `hit` it made with a non-empty combo, and its dodge rolls while it
 * is in a fight. A pick or finisher used outside a fight counts too (lenient on purpose).
 */
export function actsFromFx(fx: readonly FxEvent[], eid: number, job: JobId, picks: readonly AbilityId[], inCombat: boolean): QuestEvent[] {
  const out: QuestEvent[] = [];
  const finisher = JOBS[job]?.bar[1];
  for (const e of fx) {
    if (!('src' in e) || e.src !== eid) continue;
    if (e.t === 'use') {
      if (e.ability === finisher) out.push({ e: 'act', what: 'finisher' });
      else if (picks.includes(e.ability)) out.push({ e: 'act', what: 'pick' });
    } else if (e.t === 'hit') {
      if (Array.isArray(e.combo) && e.combo.length > 0) out.push({ e: 'act', what: 'combo' });
    } else if (e.t === 'dodge') {
      if (inCombat) out.push({ e: 'act', what: 'dodge' });
    }
  }
  return out;
}

/**
 * Whether an accepted pose at height `y` is a jump: at least JUMP_MIN_M above the zone's surface there, and risen at
 * least that far above where it left the ground (`airStartY`), so walking off a crate or a ledge is a fall, never a jump.
 */
export function jumpCounts(y: number, surfaceY: number | null, airStartY: number): boolean {
  return surfaceY !== null && Number.isFinite(y) && y - surfaceY >= JUMP_MIN_M - 1e-9 && y - airStartY >= JUMP_MIN_M - 1e-9;
}

/** The current step of each active quest, with its unmet objectives (index, objective). */
function* openObjectives(s: QuestSave) {
  for (const p of s.active) {
    const step = QUESTS[p.id]?.steps[p.step];
    if (!step) continue;
    for (let i = 0; i < step.objectives.length; i++) {
      const o = step.objectives[i]!;
      if ((p.counts[i] ?? 0) < objectiveTarget(o)) yield o;
    }
  }
}

/** A `reach` event when (x, z) in `zone` stands inside a circle an active quest's current step asks for (else none). */
export function placeEvents(s: QuestSave, zone: ZoneId, x: number, z: number): QuestEvent[] {
  for (const o of openObjectives(s)) {
    if (o.k !== 'reach' || o.zone !== zone || o.x === undefined || o.z === undefined || o.r === undefined) continue;
    if ((x - o.x) * (x - o.x) + (z - o.z) * (z - o.z) <= o.r * o.r) return [{ e: 'reach', zone, x, z }];
  }
  return [];
}

/** Which per-step work the room does for an adventurer: places, jumps, combat acts, equips (only what its current steps can use). */
export interface QuestWatch { place: boolean; jump: boolean; acts: boolean; equip: boolean }
export function questWatch(s: QuestSave): QuestWatch {
  const w: QuestWatch = { place: false, jump: false, acts: false, equip: false };
  for (const o of openObjectives(s)) {
    if (o.k === 'reach' && o.r !== undefined) w.place = true;
    else if (o.k === 'jump') w.jump = true;
    else if (o.k === 'act') w.acts = true;
    else if (o.k === 'equip') w.equip = true;
  }
  return w;
}
/** Either save's watch (a write in flight: the step it is moving to, and the one the store holds). */
export const watchEither = (a: QuestSave, b: QuestSave | undefined): QuestWatch => {
  const x = questWatch(a);
  if (!b || b === a) return x;
  const y = questWatch(b);
  return { place: x.place || y.place, jump: x.jump || y.jump, acts: x.acts || y.acts, equip: x.equip || y.equip };
};

/**
 * The UTC day quest rules use: today, but never before a day the save already holds (a clock stepped back can never
 * offer a daily again, or pay it twice, on a day it was already done: like Seals, `<` comparisons only).
 */
export function questDay(s: QuestSave, today: string): string {
  // (at most tomorrow: a day further ahead is a broken clock's or a forged save's, and would lock a daily for good)
  const t = Date.parse(`${today}T00:00:00Z`);
  const tomorrow = Number.isFinite(t) ? new Date(t + 86_400_000).toISOString().slice(0, 10) : today;
  let day = today;
  for (const id of QUEST_IDS) {
    const d = s.done[id]?.day;
    if (d && d > day && d <= tomorrow) day = d;
  }
  return day;
}

/** What a quest change pays: the inventory state after it, its gold, xp (to `job`) and what to tell the owner. */
export interface QuestPay {
  state: InvState; dGold: number; xp: number; job: JobId; given: QuestGiven[];
  /** The reward keys (questRewardKey) of the steps it paid: in the stored recentKills once its write landed. */
  keys: string[];
}

/**
 * Pays the steps a quest change completed (grantQuestRewards on `state`, xp to `job`): null when the bag cannot take
 * the items (nothing is paid then). With nothing to pay, the state as it is.
 */
export function payQuests(state: InvState, done: readonly StepDone[], job: JobId): QuestPay | null {
  if (done.length === 0) return { state, dGold: 0, xp: 0, job, given: [], keys: [] };
  const r = grantQuestRewards(state, done, job);
  if ('refusal' in r) return null;
  const keys = r.given.flatMap((g) => { const d = done.find((x) => x.quest === g.quest && x.step === g.step); return d ? [questRewardKey(d)] : []; });
  return { state: r.state, dGold: r.dGold, xp: r.xp, job, given: r.given, keys };
}

// ───────── SG2_TEST_QUEST (test servers only) ─────────

/** `<quest>:<step id>`, e.g. `solstice_crossing:first_fight`: null for anything else. */
export function parseTestQuest(raw: string): { quest: QuestId; step: number } | null {
  const m = /^([a-z_]+):([a-z0-9_]+)$/.exec(raw);
  if (!m || !isQuestId(m[1])) return null;
  const step = QUESTS[m[1]].steps.findIndex((s) => s.id === m[2]);
  return step < 0 ? null : { quest: m[1], step };
}

/**
 * The save an adventurer with no stored quests starts with under SG2_TEST_QUEST: every earlier main-quest step done
 * (nothing paid) and that quest at that step; for another quest, the main quest done and that quest at that step.
 */
export function testQuestSave(spec: { quest: QuestId; step: number }, day: string): QuestSave {
  const base = newQuestSave(day);
  const at = { id: spec.quest, step: spec.step, counts: QUESTS[spec.quest].steps[spec.step]!.objectives.map(() => 0), since: base.active[0]!.since };
  if (spec.quest === MAIN_QUEST) return { ...base, active: [at] };
  return { ...base, active: [at], done: { [MAIN_QUEST]: { day: at.since, times: 1 } } };
}
