// The quest rules: the four quests of the opening slice as data, the per-adventurer save (with repair on
// read), the server-fed events (kills, places, jumps, jobs, combat acts, equips), the adventurer's acts
// (talk, use, accept, abandon, skip), the rewards, the owner's view, and the `quest` message's parser.
//
// Pure and deterministic: nothing here reads a clock (callers pass the UTC day), nothing changes its inputs,
// and nothing trusts a client: acts carry ids only, and every place is checked from the server's own pose.
//
// Never lose, never duplicate, by construction:
// - progress only moves forward, and only through applyQuestEvents/applyQuestAct (abandon drops a side quest);
// - a step's reward is listed (StepDone) only by the change that completes it for the first time in its run,
//   and a once-quest abandoned part-way remembers which steps it already paid (`paid`), so taking it again
//   pays only the steps not paid yet;
// - grantQuestRewards pays each listed step through addLoot with the key `q:${quest}:${step}:${times}` (a
//   replay of the same task is a dup and pays nothing: no gold, no item and no xp);
// - the server writes the save, the inventory and the jobs in one compare-and-set write.
import { ENEMY_KINDS, type EnemyKindId } from './combat/enemies';
import { deepFreeze } from './combat/freeze';
import { addJobXp } from './combat/jobXp';
import type { JobId } from './combat/jobs';
import { BAG_SLOTS, addLoot, bagUsed, type InvState } from './inventory';
import { ITEMS, isGearSlot, isItemId, type GearSlot, type ItemId } from './items';
import { isZoneId, type ZoneId } from './world/zones';
import { NPC_REACH, PROP_REACH, isNpcId, isPropId, npcInReach, pimGround, propInReach, type NpcId, type PropId } from './story/spots';

export { NPC_REACH, PROP_REACH };

// ───────── limits ─────────
/** Quests active at once (more → 'full'). */
export const QUEST_ACTIVE_MAX = 6;
/** Kill keys remembered per adventurer, so a kill counts once. */
export const QUEST_SEEN_MAX = 32;
/** Optional steps remembered as skipped. */
export const QUEST_SKIPPED_MAX = 16;
/** Unlock strings held (each comes from quest data). */
export const QUEST_UNLOCKS_MAX = 16;
/** An objective's count never exceeds this (nor its own n). */
export const QUEST_COUNT_MAX = 99;
/** `quest` messages per session: a token bucket of 4, refilling 4 a second (more → 'rate'). */
export const QUEST_OPS_PER_S = 4;
/** Quest events a session may queue in one room step (more are dropped, never written). */
export const QUEST_EVENTS_PER_STEP = 32;
/** Added on the server (latency) to both reaches (m). */
export const REACH_FUZZ = 0.5;
/** A jump counts when an accepted pose stands at least this above the zone's surface there (m). */
export const JUMP_MIN_M = 0.6;
/** Characters in one dialogue line (story/lines.ts, tested). */
export const LINE_MAX = 140;
/** A quest's completion count never exceeds this (a daily for a few thousand years). */
export const QUEST_TIMES_MAX = 1_000_000;
/** The longest kill key or list string a save keeps. */
export const QUEST_KEY_MAX = 96;
/** A reward choice index is an integer 0..QUEST_CHOICE_MAX. */
export const QUEST_CHOICE_MAX = 7;

// ───────── data ─────────
export type QuestId = 'solstice_crossing' | 'keepers_lamp' | 'bristle_bounty' | 'grans_waymarks';
export type QuestAction = 'finisher' | 'combo' | 'dodge' | 'pick';
export type Objective =
  | { readonly k: 'talk'; readonly npc: NpcId }
  | { readonly k: 'use'; readonly prop: PropId }
  | { readonly k: 'reach'; readonly zone: ZoneId; readonly x?: number; readonly z?: number; readonly r?: number }
  | { readonly k: 'jump' }
  | { readonly k: 'job' }
  | { readonly k: 'kill'; readonly kinds: readonly EnemyKindId[] | 'any'; readonly n: number; readonly party?: true }
  | { readonly k: 'act'; readonly what: QuestAction; readonly n: number }
  | { readonly k: 'equip'; readonly slot: GearSlot; readonly tierMin: 1 | 2 | 3 };
export interface QuestReward {
  /** To the current job (addJobXp; catch-up does not apply). */
  readonly xp?: number;
  readonly gold?: number;
  /** A fixed item. */
  readonly item?: ItemId;
  /** One of these, chosen by index in the talk that completes the step. */
  readonly choice?: readonly ItemId[];
  /** The keepsake title (the room adds it with Store.addTitle). */
  readonly title?: string;
  /** e.g. 'home:starter_cottage' (Plan 8 reads it from QuestSave.unlocks). */
  readonly unlock?: string;
}
export interface QuestStep {
  /** Unique within its quest. */
  readonly id: string;
  readonly objectives: readonly Objective[];
  /** All objectives (default), or any one of them. */
  readonly mode?: 'all' | 'any';
  /** May be skipped from the journal (no reward then). */
  readonly optional?: true;
  /** Given in the write that completes the step. */
  readonly reward?: QuestReward;
  /** A scene the owner's client plays on completion. */
  readonly scene?: 'beacon' | 'crater';
}
export interface QuestData {
  readonly id: QuestId; readonly name: string;
  readonly kind: 'main' | 'side' | 'daily' | 'epilogue';
  /** Who offers it (accept in reach), or null: offered anywhere once its prerequisite is met. */
  readonly giver: NpcId | null;
  /** Offered only once `quest` has reached step `step` (or is done); step null: only once `quest` is done. */
  readonly after?: { readonly quest: QuestId; readonly step: string | null };
  readonly steps: readonly QuestStep[];
}

const MAIN: QuestId = 'solstice_crossing';
/** The main quest: active from the first join, never dropped. */
export const MAIN_QUEST: QuestId = MAIN;

/** The `pim_find` circle's centre: the ground below the tavern door (layout constants only; cheap). */
const PIM = pimGround();

export const QUESTS: Readonly<Record<QuestId, QuestData>> = deepFreeze<Record<QuestId, QuestData>>({
  solstice_crossing: {
    id: 'solstice_crossing', name: 'The Solstice Crossing', kind: 'main', giver: null,
    steps: [
      { id: 'marrow', objectives: [{ k: 'talk', npc: 'marrow' }], reward: { xp: 20 } },
      { id: 'pim_find', objectives: [{ k: 'reach', zone: 'grove', x: PIM.x, z: PIM.z, r: 6 }] },
      { id: 'pim_hop', objectives: [{ k: 'jump' }] },
      { id: 'pim', objectives: [{ k: 'talk', npc: 'pim' }], reward: { xp: 20 } },
      { id: 'plaque', objectives: [{ k: 'use', prop: 'plaque' }], reward: { xp: 30 }, scene: 'beacon' },
      { id: 'board', objectives: [{ k: 'job' }], reward: { xp: 20 } },
      { id: 'gate', objectives: [{ k: 'reach', zone: 'greenway' }] },
      { id: 'nell', objectives: [{ k: 'talk', npc: 'nell' }], reward: { xp: 20 } },
      {
        id: 'first_fight',
        objectives: [{ k: 'kill', kinds: ['thornling'], n: 3 }, { k: 'act', what: 'finisher', n: 1 }, { k: 'act', what: 'combo', n: 1 }, { k: 'act', what: 'dodge', n: 1 }],
        reward: { xp: 60, gold: 10 },
      },
      { id: 'picks', objectives: [{ k: 'act', what: 'pick', n: 2 }], reward: { xp: 20 } },
      { id: 'duo', objectives: [{ k: 'kill', kinds: 'any', n: 1, party: true }, { k: 'kill', kinds: ['mossback'], n: 1 }], mode: 'any', optional: true, reward: { xp: 60, gold: 15 } },
      { id: 'nell_report', objectives: [{ k: 'talk', npc: 'nell' }], reward: { xp: 40, gold: 40, choice: ['mossweave_chest', 'thornrunner_chest', 'rootbound_chest'] } },
      { id: 'equip', objectives: [{ k: 'equip', slot: 'chest', tierMin: 1 }], reward: { xp: 20 } },
      { id: 'crater', objectives: [{ k: 'use', prop: 'crater_edge' }], reward: { xp: 40, gold: 30, title: 'Witness of the Crossing', unlock: 'home:starter_cottage' }, scene: 'crater' },
    ],
  },
  keepers_lamp: {
    id: 'keepers_lamp', name: "The Keeper's Lamp", kind: 'epilogue', giver: null, after: { quest: 'solstice_crossing', step: null },
    steps: [
      { id: 'descend', objectives: [{ k: 'reach', zone: 'lampfall' }] },
      { id: 'hound', objectives: [{ k: 'kill', kinds: ['wickhound'], n: 1 }], reward: { xp: 60 } },
      { id: 'keeper', objectives: [{ k: 'kill', kinds: ['fallen_warden'], n: 1 }], reward: { xp: 100, gold: 50 } },
    ],
  },
  bristle_bounty: {
    id: 'bristle_bounty', name: 'Bristle Bounty', kind: 'daily', giver: 'bram', after: { quest: 'solstice_crossing', step: 'gate' },
    steps: [
      { id: 'boars', objectives: [{ k: 'kill', kinds: ['boar'], n: 6 }] },
      { id: 'bram', objectives: [{ k: 'talk', npc: 'bram' }], reward: { xp: 50, gold: 20 } },
    ],
  },
  grans_waymarks: {
    id: 'grans_waymarks', name: "Gran's Waymarks", kind: 'side', giver: 'tamsin', after: { quest: 'solstice_crossing', step: 'gate' },
    steps: [
      { id: 'stones', objectives: [{ k: 'use', prop: 'waymark_1' }, { k: 'use', prop: 'waymark_2' }, { k: 'use', prop: 'waymark_3' }] },
      { id: 'tamsin', objectives: [{ k: 'talk', npc: 'tamsin' }], reward: { xp: 60, gold: 25 } },
    ],
  },
});

export const QUEST_IDS: readonly QuestId[] = Object.freeze(['solstice_crossing', 'keepers_lamp', 'bristle_bounty', 'grans_waymarks']);
export function isQuestId(v: unknown): v is QuestId { return typeof v === 'string' && (QUEST_IDS as readonly string[]).includes(v); }

/** How many an objective needs: n for kills and acts, else 1. */
export function objectiveTarget(o: Objective): number {
  return o.k === 'kill' || o.k === 'act' ? Math.min(o.n, QUEST_COUNT_MAX) : 1;
}

/** Every unlock a quest reward names (the only strings QuestSave.unlocks may hold). */
const UNLOCKS: ReadonlySet<string> = new Set(QUEST_IDS.flatMap(q => QUESTS[q].steps.flatMap(s => (s.reward?.unlock ? [s.reward.unlock] : []))));
/** Every `${quest}:${stepId}` of an optional step. */
const OPTIONAL_KEYS: ReadonlySet<string> = new Set(QUEST_IDS.flatMap(q => QUESTS[q].steps.filter(s => s.optional).map(s => `${q}:${s.id}`)));

// ───────── the save ─────────
export interface QuestProgress {
  readonly id: QuestId; readonly step: number; readonly counts: readonly number[];
  /** The UTC day the quest was accepted. */
  readonly since: string;
  /** The reward index chosen in this run (kept until the quest is done, then in done[id].choice). */
  readonly choice?: number;
}
export interface QuestDoneRecord { readonly day: string; readonly times: number; readonly choice?: number }
export interface QuestSave {
  readonly v: 1;
  /** ≤ QUEST_ACTIVE_MAX, the main quest first. */
  readonly active: readonly QuestProgress[];
  /** Keys only from QUEST_IDS. */
  readonly done: Readonly<Partial<Record<QuestId, QuestDoneRecord>>>;
  /** ≤ QUEST_UNLOCKS_MAX, each from quest data. */
  readonly unlocks: readonly string[];
  /** Kill keys, ≤ QUEST_SEEN_MAX, oldest first. */
  readonly seen: readonly string[];
  /** `${quest}:${stepId}`, ≤ QUEST_SKIPPED_MAX. */
  readonly skipped: readonly string[];
  /**
   * For a quest dropped part-way: how many of its first steps were already paid in its current run (its
   * done.times). Taking it again pays only the steps from there on. Cleared when the quest is done.
   */
  readonly paid: Readonly<Partial<Record<QuestId, number>>>;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === 'string' && DAY.test(v);
const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const clampInt = (v: unknown, lo: number, hi: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : lo);
const keysExactly = (o: Record<string, unknown>, req: readonly string[], opt: readonly string[] = []): boolean => {
  const ks = Object.keys(o);
  return req.every(k => Object.prototype.hasOwnProperty.call(o, k)) && ks.every(k => req.includes(k) || opt.includes(k));
};
const zeros = (q: QuestId, step: number): number[] => QUESTS[q].steps[step]!.objectives.map(() => 0);

/** The save every adventurer starts with: the main quest at its first step (Old Marrow). */
export function newQuestSave(day: string): QuestSave {
  return { v: 1, active: [{ id: MAIN, step: 0, counts: [0], since: isDay(day) ? day : '1970-01-01' }], done: {}, unlocks: [], seen: [], skipped: [], paid: {} };
}

/** Whether the step's objectives are met by `counts`. */
function stepMet(q: QuestId, step: QuestStep, counts: readonly number[]): boolean {
  const met = step.objectives.map((_, i) => (counts[i] ?? 0) >= objectiveTarget(step.objectives[i]!));
  return step.mode === 'any' ? met.some(Boolean) : met.every(Boolean);
}

/**
 * Reads a stored `quests` value. NULL (or undefined) is the new save with repaired false (no write); anything
 * else that is not exactly a valid save is repaired: unknown ids and keys dropped, steps and counts clamped,
 * lists capped (oldest dropped), the main quest put back. Never throws.
 */
export function parseQuests(v: unknown, day: string): { save: QuestSave; repaired: boolean } {
  if (v === null || v === undefined) return { save: newQuestSave(day), repaired: false };
  if (!plain(v) || v.v !== 1) return { save: newQuestSave(day), repaired: true };
  let repaired = !keysExactly(v, ['v', 'active', 'done', 'unlocks', 'seen', 'skipped', 'paid']);
  const today = isDay(day) ? day : '1970-01-01';

  // done
  const done: Partial<Record<QuestId, QuestDoneRecord>> = {};
  if (plain(v.done)) {
    for (const [k, r] of Object.entries(v.done)) {
      if (!isQuestId(k) || !plain(r) || !keysExactly(r, ['day', 'times'], ['choice']) || !isDay(r.day)) { repaired = true; continue; }
      const times = clampInt(r.times, 1, QUEST_TIMES_MAX);
      if (times !== r.times) repaired = true;
      const rec: { day: string; times: number; choice?: number } = { day: r.day, times };
      if (r.choice !== undefined) {
        if (isInt(r.choice) && r.choice >= 0 && r.choice <= QUEST_CHOICE_MAX) rec.choice = r.choice;
        else repaired = true;
      }
      done[k] = rec;
    }
  } else repaired = true;

  // active
  const active: QuestProgress[] = [];
  if (Array.isArray(v.active)) {
    if (v.active.length > QUEST_ACTIVE_MAX) repaired = true;
    const seenIds = new Set<QuestId>();
    for (const p of v.active.slice(0, QUEST_ACTIVE_MAX * 2)) {
      if (!plain(p) || !isQuestId(p.id) || seenIds.has(p.id)) { repaired = true; continue; }
      const q = QUESTS[p.id];
      if (q.kind !== 'daily' && done[p.id]) { repaired = true; continue; } // a done once-quest is never active
      seenIds.add(p.id);
      if (!keysExactly(p, ['id', 'step', 'counts', 'since'], ['choice'])) repaired = true;
      const step = clampInt(p.step, 0, q.steps.length - 1);
      if (step !== p.step) repaired = true;
      const st = q.steps[step]!;
      const rawCounts = Array.isArray(p.counts) ? p.counts : [];
      if (!Array.isArray(p.counts) || rawCounts.length !== st.objectives.length) repaired = true;
      let counts = st.objectives.map((_, i) => {
        const c = clampInt(rawCounts[i], 0, objectiveTarget(st.objectives[i]!));
        if (c !== rawCounts[i]) repaired = true;
        return c;
      });
      if (stepMet(p.id, st, counts)) { counts = counts.map(() => 0); repaired = true; } // a met step would never advance
      const since = isDay(p.since) ? p.since : today;
      if (since !== p.since) repaired = true;
      const prog: { id: QuestId; step: number; counts: number[]; since: string; choice?: number } = { id: p.id, step, counts, since };
      if (p.choice !== undefined) {
        if (isInt(p.choice) && p.choice >= 0 && p.choice <= QUEST_CHOICE_MAX) prog.choice = p.choice;
        else repaired = true;
      }
      active.push(prog);
    }
  } else repaired = true;
  // the main quest is always either active (first) or done
  const mi = active.findIndex(p => p.id === MAIN);
  if (mi > 0) { active.unshift(active.splice(mi, 1)[0]!); repaired = true; }
  if (mi < 0 && !done[MAIN]) { active.unshift({ id: MAIN, step: 0, counts: [0], since: today }); repaired = true; }
  if (active.length > QUEST_ACTIVE_MAX) { active.length = QUEST_ACTIVE_MAX; repaired = true; }

  const strList = (raw: unknown, max: number, ok: (s: string) => boolean): string[] => {
    if (!Array.isArray(raw)) { repaired = true; return []; }
    const out: string[] = [];
    for (const s of raw.slice(-Math.max(max * 4, 64))) {
      if (typeof s !== 'string' || s.length > QUEST_KEY_MAX || !ok(s) || out.includes(s)) { repaired = true; continue; }
      out.push(s);
    }
    if (raw.length > Math.max(max * 4, 64)) repaired = true;
    if (out.length > max) { out.splice(0, out.length - max); repaired = true; }
    return out;
  };
  const unlocks = strList(v.unlocks, QUEST_UNLOCKS_MAX, s => UNLOCKS.has(s));
  const seen = strList(v.seen, QUEST_SEEN_MAX, s => s.length > 0);
  const skipped = strList(v.skipped, QUEST_SKIPPED_MAX, s => OPTIONAL_KEYS.has(s));

  const paid: Partial<Record<QuestId, number>> = {};
  if (plain(v.paid)) {
    for (const [k, n] of Object.entries(v.paid)) {
      if (!isQuestId(k) || !isInt(n) || n < 1 || n > QUESTS[k].steps.length - 1 || (QUESTS[k].kind !== 'daily' && done[k])) { repaired = true; continue; }
      paid[k] = n;
    }
  } else repaired = true;

  return { save: { v: 1, active, done, unlocks, seen, skipped, paid }, repaired };
}

/** True when `v` is a save parseQuests would leave exactly as it is (NULL is not a save). */
export function isQuestSave(v: unknown): v is QuestSave {
  if (!plain(v)) return false;
  return !parseQuests(v, '1970-01-01').repaired;
}

// ───────── events ─────────
export type QuestEvent =
  | { e: 'kill'; kind: EnemyKindId; key: string; party: boolean }
  | { e: 'reach'; zone: ZoneId; x: number; z: number }
  | { e: 'jump' }
  | { e: 'job' }
  | { e: 'act'; what: QuestAction }
  | { e: 'equip'; slot: GearSlot; item: ItemId };

const ACTIONS: readonly QuestAction[] = Object.freeze(['finisher', 'combo', 'dodge', 'pick']);
const validEvent = (ev: QuestEvent): boolean => {
  if (!plain(ev)) return false;
  switch (ev.e) {
    case 'kill': return Object.prototype.hasOwnProperty.call(ENEMY_KINDS, ev.kind) && typeof ev.key === 'string' && ev.key.length > 0 && ev.key.length <= QUEST_KEY_MAX && typeof ev.party === 'boolean';
    case 'reach': return isZoneId(ev.zone) && Number.isFinite(ev.x) && Number.isFinite(ev.z);
    case 'jump': case 'job': return true;
    case 'act': return ACTIONS.includes(ev.what);
    case 'equip': return isGearSlot(ev.slot) && isItemId(ev.item);
    default: return false;
  }
};

/** Whether event `ev` advances objective `o` (talk and use are acts, never events). */
function matches(o: Objective, ev: QuestEvent): boolean {
  switch (o.k) {
    case 'kill': return ev.e === 'kill' && (o.kinds === 'any' || o.kinds.includes(ev.kind)) && (!o.party || ev.party);
    case 'reach': {
      if (ev.e !== 'reach' || ev.zone !== o.zone) return false;
      if (o.r === undefined || o.x === undefined || o.z === undefined) return true;
      const dx = ev.x - o.x, dz = ev.z - o.z;
      return dx * dx + dz * dz <= o.r * o.r;
    }
    case 'jump': return ev.e === 'jump';
    case 'job': return ev.e === 'job';
    case 'act': return ev.e === 'act' && ev.what === o.what;
    case 'equip': {
      if (ev.e !== 'equip' || ev.slot !== o.slot) return false;
      const it = ITEMS[ev.item];
      return !!it && it.slot === o.slot && it.tier >= o.tierMin;
    }
    default: return false;
  }
}

/** Whether some active quest's current step has an unmet objective `ev` would advance (cheap; the room filters with it). */
export function questCares(s: QuestSave, ev: QuestEvent): boolean {
  if (!validEvent(ev)) return false;
  if (ev.e === 'kill' && s.seen.includes(ev.key)) return false;
  for (const p of s.active) {
    const step = QUESTS[p.id]?.steps[p.step];
    if (!step) continue;
    for (let i = 0; i < step.objectives.length; i++) {
      const o = step.objectives[i]!;
      if ((p.counts[i] ?? 0) < objectiveTarget(o) && matches(o, ev)) return true;
    }
  }
  return false;
}

/** A step completed (for the first time in its run, so it is to be paid): which, in which run, with which choice. */
export interface StepDone { quest: QuestId; step: number; times: number; choice: number | null }

/** A mutable working copy of a save. */
interface Work {
  active: { id: QuestId; step: number; counts: number[]; since: string; choice?: number }[];
  done: Partial<Record<QuestId, { day: string; times: number; choice?: number }>>;
  unlocks: string[]; seen: string[]; skipped: string[]; paid: Partial<Record<QuestId, number>>;
}
function work(s: QuestSave): Work {
  const done: Work['done'] = {};
  for (const id of QUEST_IDS) { const d = s.done[id]; if (d) done[id] = { ...d }; }
  const paid: Work['paid'] = {};
  for (const id of QUEST_IDS) { const n = s.paid?.[id]; if (n !== undefined) paid[id] = n; }
  return {
    active: s.active.map(p => ({ ...p, counts: [...p.counts] })), done,
    unlocks: [...s.unlocks], seen: [...s.seen], skipped: [...s.skipped], paid,
  };
}
const toSave = (w: Work): QuestSave => ({ v: 1, active: w.active, done: w.done, unlocks: w.unlocks, seen: w.seen, skipped: w.skipped, paid: w.paid });
const pushCapped = (list: string[], s: string, max: number) => {
  if (list.includes(s)) return;
  list.push(s);
  if (list.length > max) list.splice(0, list.length - max);
};

/**
 * Moves quest `p` past its current step. paidStep: whether the step's reward is due (not skipped, and not
 * already paid in this run). Returns the StepDone to pay, or null.
 */
function advance(w: Work, p: Work['active'][number], day: string, rewarded: boolean): StepDone | null {
  const q = QUESTS[p.id], step = q.steps[p.step]!;
  const times = w.done[p.id]?.times ?? 0;
  const due = rewarded && p.step >= (w.paid[p.id] ?? 0);
  const out: StepDone | null = due ? { quest: p.id, step: p.step, times, choice: step.reward?.choice ? (p.choice ?? null) : null } : null;
  if (due && step.reward?.unlock && UNLOCKS.has(step.reward.unlock)) pushCapped(w.unlocks, step.reward.unlock, QUEST_UNLOCKS_MAX);
  if (p.step + 1 >= q.steps.length) {
    w.active.splice(w.active.indexOf(p), 1);
    const rec: { day: string; times: number; choice?: number } = { day: isDay(day) ? day : p.since, times: Math.min(QUEST_TIMES_MAX, times + 1) };
    if (p.choice !== undefined) rec.choice = p.choice;
    w.done[p.id] = rec;
    delete w.paid[p.id];
  } else {
    p.step += 1;
    p.counts = zeros(p.id, p.step);
  }
  return out;
}

/** Applies one event to every active quest's current step (never carrying over into a next step). */
function applyEvent(w: Work, ev: QuestEvent, day: string, only: QuestId | null = null): { done: StepDone[]; changed: boolean } {
  const done: StepDone[] = [];
  if (!validEvent(ev)) return { done, changed: false };
  if (ev.e === 'kill' && w.seen.includes(ev.key)) return { done, changed: false };
  let changed = false, counted = false;
  for (const p of [...w.active]) {
    if (only && p.id !== only) continue;
    const step = QUESTS[p.id].steps[p.step]!;
    let hit = false;
    for (let i = 0; i < step.objectives.length; i++) {
      const o = step.objectives[i]!;
      if ((p.counts[i] ?? 0) < objectiveTarget(o) && matches(o, ev)) { p.counts[i] = (p.counts[i] ?? 0) + 1; hit = true; }
    }
    if (!hit) continue;
    changed = counted = true;
    if (stepMet(p.id, step, p.counts)) { const d = advance(w, p, day, true); if (d) done.push(d); }
  }
  if (counted && ev.e === 'kill') pushCapped(w.seen, ev.key, QUEST_SEEN_MAX);
  return { done, changed };
}

/** Applies server-made events in order. Never changes `s`; `changed` false means `save` is `s` itself. */
export function applyQuestEvents(s: QuestSave, evs: readonly QuestEvent[], day: string): { save: QuestSave; done: StepDone[]; changed: boolean } {
  const w = work(s);
  const done: StepDone[] = [];
  let changed = false;
  // the room queues at most QUEST_EVENTS_PER_STEP per step; anything far beyond that is a bug, not progress
  for (const ev of evs.slice(0, QUEST_EVENTS_PER_STEP * 4)) {
    const r = applyEvent(w, ev, day);
    if (r.changed) changed = true;
    done.push(...r.done);
  }
  return changed ? { save: toSave(w), done, changed } : { save: s, done, changed };
}

// ───────── acts ─────────
export type QuestAct =
  | { act: 'talk'; npc: NpcId; choice?: number }
  | { act: 'use'; prop: PropId }
  | { act: 'accept'; quest: QuestId }
  | { act: 'abandon'; quest: QuestId }
  | { act: 'skip'; quest: QuestId };
export type QuestRefusal = 'where' | 'busy' | 'dead' | 'unknown' | 'requires' | 'done' | 'done-today' | 'active' | 'full' | 'main' | 'not-optional' | 'choice' | 'bag-full' | 'rate';
export const QUEST_TEXT: Readonly<Record<QuestRefusal, string>> = Object.freeze({
  where: 'You need to be closer.',
  busy: 'Not right now.',
  dead: "You can't do that while you're down.",
  unknown: "That quest isn't here.",
  requires: "You're not ready for that one yet.",
  done: "You've already done that one.",
  'done-today': 'Come back tomorrow for that one.',
  active: "You're already on that quest.",
  full: 'Your journal is full: finish or drop a quest first.',
  main: "The Solstice Crossing can't be dropped.",
  'not-optional': "That step can't be skipped.",
  choice: 'Pick one of the rewards first.',
  'bag-full': 'Make room in your bag first.',
  rate: 'Slow down a little.',
});
/** Where and how the adventurer stands, from the server's own state (x, z: the last accepted pose). */
export interface QuestCtx { zone: ZoneId; x: number; z: number; day: string; dead: boolean; busy: boolean; bagFree: number }
export type QuestActResult = { save: QuestSave; done: StepDone[]; changed: boolean } | { none: true } | { refusal: QuestRefusal };

/** Whether quest `q`'s prerequisite is met in `w`. */
function afterMet(w: Pick<Work, 'active' | 'done'>, q: QuestData): boolean {
  if (!q.after) return true;
  if (w.done[q.after.quest]) return true;
  if (q.after.step === null) return false;
  const p = w.active.find(a => a.id === q.after!.quest);
  if (!p) return false;
  const at = QUESTS[q.after.quest].steps.findIndex(s => s.id === q.after!.step);
  return at >= 0 && p.step >= at;
}
/** Why quest `id` cannot be accepted now (ignoring the giver's reach and room), or null. */
function offerRefusal(w: Pick<Work, 'active' | 'done'>, id: QuestId, day: string): QuestRefusal | null {
  const q = QUESTS[id];
  if (w.active.some(p => p.id === id)) return 'active';
  const d = w.done[id];
  if (d && q.kind !== 'daily') return 'done';
  if (d && q.kind === 'daily' && d.day === day) return 'done-today';
  if (!afterMet(w, q)) return 'requires';
  return null;
}

/** An act from the adventurer (already parsed by parseQuestAct), checked against the server's ctx. Never changes `s`. */
export function applyQuestAct(s: QuestSave, act: QuestAct, ctx: QuestCtx): QuestActResult {
  if (ctx.dead) return { refusal: 'dead' };
  if (ctx.busy) return { refusal: 'busy' };
  const w = work(s);
  switch (act.act) {
    case 'talk': case 'use': {
      const isTalk = act.act === 'talk';
      const inReach = isTalk ? npcInReach(act.npc, ctx.zone, ctx.x, ctx.z, REACH_FUZZ) : propInReach(act.prop, ctx.zone, ctx.x, ctx.z, REACH_FUZZ);
      if (!inReach) return { refusal: 'where' };
      for (const p of w.active) {
        const step = QUESTS[p.id].steps[p.step]!;
        const i = step.objectives.findIndex((o, k) => (p.counts[k] ?? 0) < 1 && (isTalk ? o.k === 'talk' && o.npc === act.npc : o.k === 'use' && o.prop === (act as { prop: PropId }).prop));
        if (i < 0) continue;
        p.counts[i] = 1;
        if (stepMet(p.id, step, p.counts)) {
          const r = step.reward;
          const due = p.step >= (w.paid[p.id] ?? 0);
          if (r?.choice && due) {
            const c = isTalk ? (act as { choice?: number }).choice : undefined;
            if (!isInt(c) || c < 0 || c >= r.choice.length) return { refusal: 'choice' };
            p.choice = c;
          }
          if (due && (r?.item || r?.choice) && !(ctx.bagFree >= 1)) return { refusal: 'bag-full' };
          const d = advance(w, p, ctx.day, true);
          return { save: toSave(w), done: d ? [d] : [], changed: true };
        }
        return { save: toSave(w), done: [], changed: true };
      }
      return { none: true };
    }
    case 'accept': {
      if (!isQuestId(act.quest)) return { refusal: 'unknown' };
      const q = QUESTS[act.quest];
      const why = offerRefusal(w, act.quest, ctx.day);
      if (why) return { refusal: why };
      if (q.giver && !npcInReach(q.giver, ctx.zone, ctx.x, ctx.z, REACH_FUZZ)) return { refusal: 'where' };
      if (w.active.length >= QUEST_ACTIVE_MAX) return { refusal: 'full' };
      w.active.push({ id: act.quest, step: 0, counts: zeros(act.quest, 0), since: isDay(ctx.day) ? ctx.day : '1970-01-01' });
      // a first step met where the adventurer already stands (the epilogue taken inside the Lampfall)
      const r = applyEvent(w, { e: 'reach', zone: ctx.zone, x: ctx.x, z: ctx.z }, ctx.day, act.quest);
      return { save: toSave(w), done: r.done, changed: true };
    }
    case 'abandon': {
      if (!isQuestId(act.quest)) return { refusal: 'unknown' };
      if (act.quest === MAIN) return { refusal: 'main' };
      const i = w.active.findIndex(p => p.id === act.quest);
      if (i < 0) return { refusal: 'unknown' };
      const p = w.active[i]!;
      if (p.step > 0) w.paid[p.id] = Math.max(w.paid[p.id] ?? 0, p.step);
      w.active.splice(i, 1);
      return { save: toSave(w), done: [], changed: true };
    }
    case 'skip': {
      if (!isQuestId(act.quest)) return { refusal: 'unknown' };
      const p = w.active.find(a => a.id === act.quest);
      if (!p) return { refusal: 'unknown' };
      const step = QUESTS[p.id].steps[p.step]!;
      if (!step.optional) return { refusal: 'not-optional' };
      pushCapped(w.skipped, `${p.id}:${step.id}`, QUEST_SKIPPED_MAX);
      advance(w, p, ctx.day, false);
      return { save: toSave(w), done: [], changed: true };
    }
    default: return { refusal: 'unknown' };
  }
}

/** The current step of an active quest, or null. */
export function questStepOf(s: QuestSave, id: QuestId): QuestStep | null {
  const p = s.active.find(a => a.id === id);
  return p ? (QUESTS[p.id]?.steps[p.step] ?? null) : null;
}

// ───────── rewards ─────────
export interface QuestGiven {
  quest: QuestId; step: number; stepId: string; xp: number; gold: number; item: ItemId | null;
  title: string | null; unlock: string | null; scene: 'beacon' | 'crater' | null; questDone: boolean;
}
/** The addLoot key of a step's reward in a run: a replay of the same reward is a dup and pays nothing. */
export const questRewardKey = (d: Pick<StepDone, 'quest' | 'step' | 'times'>): string => `q:${d.quest}:${d.step}:${d.times}`;

/**
 * Pays completed steps (from applyQuestEvents/applyQuestAct) into the inventory state: gold and the item
 * (fixed, or the chosen one) through addLoot with questRewardKey, xp (summed) to `job` through addJobXp. A
 * step whose key addLoot already holds is a dup and pays nothing at all (and gives no QuestGiven). When the
 * items do not all fit the bag, nothing is paid: 'bag-full'. Never changes `s`.
 */
export function grantQuestRewards(s: InvState, done: readonly StepDone[], job: JobId): { state: InvState; dGold: number; xp: number; given: QuestGiven[] } | { refusal: 'bag-full' } {
  let state = s, dGold = 0, xp = 0, items = 0;
  const given: QuestGiven[] = [];
  const keys = new Set<string>();
  const plan: { d: StepDone; step: QuestStep; item: ItemId | null }[] = [];
  for (const d of done) {
    const q = QUESTS[d.quest], step = q?.steps[d.step];
    if (!step) continue;
    const key = questRewardKey(d);
    if (keys.has(key) || s.inv.recentKills.includes(key)) continue; // a dup: already paid
    keys.add(key);
    const r = step.reward;
    const item = r?.item && isItemId(r.item) ? r.item : r?.choice && d.choice !== null && isInt(d.choice) && r.choice[d.choice] !== undefined ? r.choice[d.choice]! : null;
    if (item) items++;
    plan.push({ d, step, item });
  }
  if (items > 0 && bagUsed(s.inv) + items > BAG_SLOTS) return { refusal: 'bag-full' };
  for (const { d, step, item } of plan) {
    const r = step.reward;
    const gold = r?.gold && Number.isFinite(r.gold) && r.gold > 0 ? Math.floor(r.gold) : 0;
    const out = addLoot(state, item, gold, questRewardKey(d));
    if (out.dup) continue;
    state = out.state;
    dGold += out.dGold;
    const x = r?.xp && Number.isFinite(r.xp) && r.xp > 0 ? Math.floor(r.xp) : 0;
    xp += x;
    given.push({
      quest: d.quest, step: d.step, stepId: step.id, xp: x, gold: out.dGold, item: out.uid !== null ? item : null,
      title: r?.title ?? null, unlock: r?.unlock ?? null, scene: step.scene ?? null, questDone: d.step === QUESTS[d.quest].steps.length - 1,
    });
  }
  if (xp > 0) state = { ...state, jobs: addJobXp(state.jobs, job, xp).save };
  return { state, dGold, xp, given };
}

// ───────── views ─────────
export interface QuestsView {
  active: { id: QuestId; step: number; counts: number[] }[];
  done: { id: QuestId; times: number; today: boolean }[];
  /** Accept-able now if in reach of the giver: prerequisites met, not active, not done (or done today). */
  offers: QuestId[];
  skipped: string[];
}
/** What the owner's client shows (copies only). The data (QUESTS) gives names, objectives and n. */
export function questsView(s: QuestSave, day: string): QuestsView {
  const w = work(s);
  return {
    active: w.active.map(p => ({ id: p.id, step: p.step, counts: [...p.counts] })),
    done: QUEST_IDS.flatMap(id => { const d = w.done[id]; return d ? [{ id, times: d.times, today: d.day === day }] : []; }),
    offers: QUEST_IDS.filter(id => offerRefusal(w, id, day) === null),
    skipped: [...w.skipped],
  };
}

// ───────── the `quest` message ─────────
/** The client's `quest` message, strictly: exact keys, known ids, a choice an integer 0..7; else null. */
export function parseQuestAct(v: unknown): QuestAct | null {
  if (!plain(v) || typeof v.act !== 'string') return null;
  switch (v.act) {
    case 'talk': {
      if (!keysExactly(v, ['act', 'npc'], ['choice']) || !isNpcId(v.npc)) return null;
      if (v.choice === undefined) return { act: 'talk', npc: v.npc };
      if (!isInt(v.choice) || v.choice < 0 || v.choice > QUEST_CHOICE_MAX) return null;
      return { act: 'talk', npc: v.npc, choice: v.choice };
    }
    case 'use':
      return keysExactly(v, ['act', 'prop']) && isPropId(v.prop) ? { act: 'use', prop: v.prop } : null;
    case 'accept': case 'abandon': case 'skip':
      return keysExactly(v, ['act', 'quest']) && isQuestId(v.quest) ? { act: v.act, quest: v.quest } : null;
    default: return null;
  }
}
