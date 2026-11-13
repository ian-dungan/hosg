// The client's quest state (Plan 6 Task 6), pure: no Babylon, no DOM. Everything follows the server's own
// messages: `quests` (the view), `questDone` (one per completed step) and `questRefused`. Nothing here moves a
// quest forward by itself (no optimistic progress): the tracker, the pointer and what an NPC says are all read
// from the last view. The text comes from the shared story lines (shared/src/story/lines.ts).
import {
  GROVE_EAST_GATE, GUILD_BOARD, LAMPFALL_MOUTH, MAIN_QUEST, QUESTS, QUEST_IDS, QUEST_LINES, QUEST_NAMES, NPC_NAMES, PIM_CALL, PROP_NAMES,
  STORY_NPCS, STORY_PROPS, greenwayLayout, isNpcId, isPropId, isQuestId, npcSay, objectiveTarget, propSay, stepHint,
  type Device, type NpcId, type Objective, type PropId, type QuestAct, type QuestGiven, type QuestId, type QuestStep,
  type QuestsView, type Say, type ZoneId, QUEST_BLURBS,
} from '@sg2/shared';
import type { HudState, JournalView } from '../core/contracts';

/** How many completions and refusals are remembered (window.__sg2net shows them). */
export const QUEST_LOG_MAX = 20;

export interface ClientQuests {
  /** The last `quests` view (null before the first one in this session). */
  view: QuestsView | null;
  /** The quest the tracker and the pointer follow (the main quest unless the journal tracks another). */
  tracked: QuestId;
  /** The last QUEST_LOG_MAX `questDone`s, oldest first. */
  history: QuestGiven[];
  /** The last QUEST_LOG_MAX refusal lines, oldest first. */
  refusals: string[];
}

export function createClientQuests(): ClientQuests {
  return { view: null, tracked: MAIN_QUEST, history: [], refusals: [] };
}

const isNat = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A `quests` message, checked (unknown ids and junk entries dropped); null when it is not a view at all. */
export function parseQuestsView(m: unknown): QuestsView | null {
  if (!isObj(m) || !Array.isArray(m.active) || !Array.isArray(m.done) || !Array.isArray(m.offers)) return null;
  const active: QuestsView['active'] = [];
  for (const a of m.active) {
    if (!isObj(a) || !isQuestId(a.id) || !isNat(a.step) || !Array.isArray(a.counts)) continue;
    if (!QUESTS[a.id].steps[a.step] || active.some((x) => x.id === a.id)) continue;
    active.push({ id: a.id, step: a.step, counts: a.counts.map((c) => (isNat(c) ? c : 0)) });
  }
  const done: QuestsView['done'] = [];
  for (const d of m.done) if (isObj(d) && isQuestId(d.id) && isNat(d.times)) done.push({ id: d.id, times: d.times, today: d.today === true });
  const offers = m.offers.filter(isQuestId);
  const skipped = Array.isArray(m.skipped) ? m.skipped.filter((s): s is string => typeof s === 'string') : [];
  return { active, done, offers, skipped };
}

/** The current step of an active quest in a view, or null. */
export function currentStep(view: QuestsView | null, id: QuestId): { step: QuestStep; index: number; counts: readonly number[] } | null {
  const p = view?.active.find((a) => a.id === id);
  const step = p ? QUESTS[p.id].steps[p.step] : undefined;
  return p && step ? { step, index: p.step, counts: p.counts } : null;
}

/** Is objective i of the step met by these counts? */
export const objectiveDone = (o: Objective, count: number | undefined): boolean => (count ?? 0) >= objectiveTarget(o);

/** A step that became current with this view (it was not current before): its hint is due. */
export interface StepStarted { quest: QuestId; stepId: string; index: number }

/**
 * Takes a `quests` view. Returns the steps that became current (each one's hint is due) and whether anything
 * changed. The same view again (a reconnect, the midnight resend) changes nothing and starts nothing.
 */
export function onQuests(q: ClientQuests, m: unknown): { changed: boolean; started: StepStarted[] } {
  const v = parseQuestsView(m);
  if (!v) return { changed: false, started: [] };
  const was = q.view;
  const changed = JSON.stringify(was) !== JSON.stringify(v);
  const started: StepStarted[] = [];
  for (const a of v.active) {
    const before = was?.active.find((b) => b.id === a.id);
    if (was && before && before.step === a.step) continue;
    if (!was) continue; // the first view of a session starts nothing new (the join's own flow shows what is due)
    started.push({ quest: a.id, stepId: QUESTS[a.id].steps[a.step]!.id, index: a.step });
  }
  q.view = v;
  // a tracked quest that is no longer active (done, dropped) gives the tracker back to the main quest (or the first active)
  if (!v.active.some((a) => a.id === q.tracked)) q.tracked = v.active.some((a) => a.id === MAIN_QUEST) ? MAIN_QUEST : (v.active[0]?.id ?? MAIN_QUEST);
  return { changed, started };
}

/** Takes a `questDone`: logged (the last QUEST_LOG_MAX), and returned when it is well formed. */
export function onQuestDone(q: ClientQuests, m: unknown): QuestGiven | null {
  if (!isObj(m) || !isQuestId(m.quest) || !isNat(m.step) || typeof m.stepId !== 'string') return null;
  const g: QuestGiven = {
    quest: m.quest, step: m.step, stepId: m.stepId,
    xp: isNat(m.xp) ? m.xp : 0, gold: isNat(m.gold) ? m.gold : 0,
    item: typeof m.item === 'string' ? (m.item as QuestGiven['item']) : null,
    title: typeof m.title === 'string' ? m.title : null, unlock: typeof m.unlock === 'string' ? m.unlock : null,
    scene: m.scene === 'beacon' || m.scene === 'crater' ? m.scene : null, questDone: m.questDone === true,
  };
  q.history.push(g);
  if (q.history.length > QUEST_LOG_MAX) q.history.splice(0, q.history.length - QUEST_LOG_MAX);
  return g;
}

/** Takes a `questRefused`: its plain line (logged), shown as is. */
export function onQuestRefused(q: ClientQuests, m: unknown): { act: QuestAct['act'] | null; reason: string; text: string } {
  const text = isObj(m) && typeof m.text === 'string' && m.text ? m.text : 'Not right now.';
  const reason = isObj(m) && typeof m.reason === 'string' ? m.reason : 'unknown';
  const act = isObj(m) && typeof m.act === 'string' ? (m.act as QuestAct['act']) : null;
  q.refusals.push(text);
  if (q.refusals.length > QUEST_LOG_MAX) q.refusals.splice(0, q.refusals.length - QUEST_LOG_MAX);
  return { act, reason, text };
}

/** Sets the tracked quest (the journal's Track): only an active quest. */
export function track(q: ClientQuests, id: QuestId): boolean {
  if (!q.view?.active.some((a) => a.id === id)) return false;
  q.tracked = id;
  return true;
}

// ───────── the tracker ─────────
/** A step's tracker lines with their done marks: {c} filled, a line several objectives share (the waymarks) shown once. */
export function stepLines(quest: QuestId, step: QuestStep, counts: readonly number[]): { text: string; done: boolean; objective: number }[] {
  const lines = QUEST_LINES[quest]?.[step.id] ?? [];
  const out: { text: string; done: boolean; objective: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0 && lines[i - 1] === lines[i]) continue;
    const same: number[] = [];
    for (let k = 0; k < lines.length; k++) if (lines[k] === lines[i]) same.push(k);
    const o = step.objectives[i];
    if (!o) continue;
    let c: number, done: boolean;
    if (same.length > 1) { c = same.filter((k) => objectiveDone(step.objectives[k]!, counts[k])).length; done = c === same.length; }
    else { c = Math.min(counts[i] ?? 0, objectiveTarget(o)); done = objectiveDone(o, counts[i]); }
    out.push({ text: lines[i]!.replace('{c}', String(c)), done, objective: i });
  }
  return out;
}

/** The hint for a step now: the first open objective's own hint, else the step's start line (device variants resolved). */
export function hintNow(quest: QuestId, step: QuestStep, counts: readonly number[], device: Device): string | null {
  const h = stepHint(quest, step.id, device);
  for (let i = 0; i < step.objectives.length; i++) if (!objectiveDone(step.objectives[i]!, counts[i]) && h.objectives[i]) return h.objectives[i]!;
  return h.line;
}

const KICKER: Readonly<Record<string, string>> = Object.freeze({ main: 'Main quest', side: 'Side quest', daily: 'Daily', epilogue: 'Epilogue' });
/** The tracker (HudState.quest) for the tracked quest, or null with nothing active. */
export function trackerOf(q: ClientQuests, device: Device): HudState['quest'] {
  const v = q.view;
  if (!v || v.active.length === 0) return null;
  const id = v.active.some((a) => a.id === q.tracked) ? q.tracked : v.active[0]!.id;
  const cur = currentStep(v, id);
  if (!cur) return null;
  const steps = stepLines(id, cur.step, cur.counts).map((l) => ({ text: l.text, done: l.done }));
  return { title: QUEST_NAMES[id], steps, hint: hintNow(id, cur.step, cur.counts, device), more: v.active.length - 1, kicker: KICKER[QUESTS[id].kind] };
}

// ───────── the pointer ─────────
export interface PointerTarget { x: number; z: number; zone: ZoneId; label: string }

/** The nearest Greenway camp holding one of these kinds ('any': any camp), from (x, z). */
function nearestCamp(kinds: readonly string[] | 'any', x: number, z: number): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null, bd = Infinity;
  for (const c of greenwayLayout().camps) {
    if (kinds !== 'any' && !c.spawns.some((s) => kinds.includes(s.kind))) continue;
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bd) { bd = d; best = { x: c.x, z: c.z }; }
  }
  return best;
}

/** Where an objective is (its zone and spot), or null (a jump, a job change in reach of nothing, an equip). */
function objectivePlace(o: Objective, from: { x: number; z: number }, step: QuestStep): { zone: ZoneId; x: number; z: number; label: string } | null {
  switch (o.k) {
    case 'talk': { const n = STORY_NPCS[o.npc]; return { zone: n.zone, x: n.x, z: n.z, label: shortName(NPC_NAMES[o.npc]) }; }
    case 'use': { const p = STORY_PROPS[o.prop]; return { zone: p.zone, x: p.x, z: p.z, label: PROP_NAMES[o.prop] }; }
    case 'reach': {
      if (o.x !== undefined && o.z !== undefined) return { zone: o.zone, x: o.x, z: o.z, label: o.zone === 'grove' ? 'The tavern' : 'There' };
      if (o.zone === 'greenway') return { zone: 'greenway', x: greenwayLayout().entry.x, z: greenwayLayout().entry.z, label: 'The Greenway' };
      if (o.zone === 'lampfall') return { zone: 'greenway', x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z, label: 'The crater' };
      return null;
    }
    case 'job': return { zone: 'grove', x: GUILD_BOARD.x, z: GUILD_BOARD.z, label: 'Guild Board' };
    case 'kill': {
      if (o.kinds !== 'any' && o.kinds.some((k) => k === 'wickhound' || k === 'fallen_warden')) return null; // inside the Lampfall
      const c = nearestCamp(o.kinds, from.x, from.z);
      return c ? { zone: 'greenway', x: c.x, z: c.z, label: 'Foes' } : null;
    }
    case 'act': {
      // the fight's own acts point where the fight is: the step's kill objective, else any camp
      const kill = step.objectives.find((x) => x.k === 'kill');
      const c = nearestCamp(kill && kill.k === 'kill' ? kill.kinds : 'any', from.x, from.z);
      return c ? { zone: 'greenway', x: c.x, z: c.z, label: 'Foes' } : null;
    }
    default: return null;
  }
}

/** "Pim, the figurehead" → "Pim": the pointer's label is short. */
export const shortName = (s: string): string => s.split(',')[0]!.trim();

/** Where `zone` leads to `to` (the exit to take when a target is in another zone), or null. */
function exitToward(zone: ZoneId, to: ZoneId): { x: number; z: number; label: string } | null {
  if (zone === to) return null;
  if (zone === 'grove' && (to === 'greenway' || to === 'lampfall')) return { x: GROVE_EAST_GATE.x, z: GROVE_EAST_GATE.z, label: 'East gate' };
  if (zone === 'greenway' && to === 'grove') { const g = greenwayLayout().westGate; return { x: g.x, z: g.z, label: 'To Shady Grove' }; }
  if (zone === 'greenway' && to === 'lampfall') return { x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z, label: 'The crater' };
  return null;
}

/**
 * What the edge pointer points at for the tracked quest: its current step's first open objective that has a
 * place. A target in another zone points at this zone's way there (the grove's east gate for the Greenway, the
 * Greenway's west gate for the grove). Null: nothing to point at (a jump, an equip, inside the Lampfall).
 */
export function pointerTarget(q: ClientQuests, zone: ZoneId, from: { x: number; z: number } = { x: 0, z: 0 }): PointerTarget | null {
  const v = q.view;
  if (!v) return null;
  const id = v.active.some((a) => a.id === q.tracked) ? q.tracked : v.active[0]?.id;
  const cur = id ? currentStep(v, id) : null;
  if (!cur || !id) return null;
  for (let i = 0; i < cur.step.objectives.length; i++) {
    const o = cur.step.objectives[i]!;
    if (objectiveDone(o, cur.counts[i])) continue;
    const at = objectivePlace(o, from, cur.step);
    if (!at) continue;
    if (at.zone === zone) return { x: at.x, z: at.z, zone, label: at.label };
    const ex = exitToward(zone, at.zone);
    if (ex) return { x: ex.x, z: ex.z, zone, label: ex.label };
  }
  return null;
}

// ───────── what a story spot says ─────────
export type StoryId = NpcId | PropId;
export type TalkPlan =
  /** The lines of an open talk/use objective: `act` goes to the server after the last page (with the choice). */
  | { kind: 'step'; say: Say; act: QuestAct; quest: QuestId; stepId: string }
  /** A quest on offer: its first choice accepts it. */
  | { kind: 'offer'; say: Say; quest: QuestId }
  /** Old Marrow's question menu. */
  | { kind: 'menu'; say: Say }
  /** Nothing to send: the spot's idle lines. */
  | { kind: 'idle'; say: Say };

/** The first active quest (main first, then the view's order) whose current step has an open objective matching `match`. */
function openObjective(view: QuestsView, match: (o: Objective) => boolean): { quest: QuestId; stepId: string } | null {
  const order = [...view.active].sort((a, b) => (a.id === MAIN_QUEST ? -1 : b.id === MAIN_QUEST ? 1 : 0));
  for (const p of order) {
    const step = QUESTS[p.id].steps[p.step];
    if (!step) continue;
    if (step.objectives.some((o, i) => match(o) && !objectiveDone(o, p.counts[i]))) return { quest: p.id, stepId: step.id };
  }
  return null;
}

/**
 * What tapping a story spot plays now, from the last view (the server decides what it completes; a talk that
 * completes nothing is never sent, and gets the spot's idle lines). Pim calls down from above the door until
 * the hop is done.
 */
export function talkPlan(id: StoryId, view: QuestsView | null, ctx: { beacon: boolean; job: string; device: Device }): TalkPlan {
  const v: QuestsView = view ?? { active: [], done: [], offers: [], skipped: [] };
  if (isNpcId(id)) {
    const open = openObjective(v, (o) => o.k === 'talk' && o.npc === id);
    const say = npcSay(id, v, ctx);
    if (open) return { kind: 'step', say, act: { act: 'talk', npc: id }, quest: open.quest, stepId: open.stepId };
    const main = currentStep(v, MAIN_QUEST);
    if (id === 'pim' && main && (main.step.id === 'pim_find' || main.step.id === 'pim_hop')) return { kind: 'idle', say: PIM_CALL };
    for (const q of QUEST_IDS) if (QUESTS[q].giver === id && v.offers.includes(q) && say.choices?.length === 2) return { kind: 'offer', say, quest: q };
    if (id === 'marrow' && say.choices?.length) return { kind: 'menu', say };
    return { kind: 'idle', say };
  }
  if (isPropId(id)) {
    const say = propSay(id, v);
    const open = openObjective(v, (o) => o.k === 'use' && o.prop === id);
    if (open) return { kind: 'step', say, act: { act: 'use', prop: id }, quest: open.quest, stepId: open.stepId };
    return { kind: 'idle', say };
  }
  return { kind: 'idle', say: { speaker: '', lines: [''] } };
}

/** The talk act with the dialogue's choice (a step with reward choices sends the index), or null when closed. */
export function actWithChoice(plan: Extract<TalkPlan, { kind: 'step' }>, choice: number): QuestAct | null {
  const n = plan.say.choices?.length ?? 0;
  if (n === 0) return choice < 0 ? null : plan.act;
  if (choice < 0 || choice >= n || plan.act.act !== 'talk') return null;
  return { act: 'talk', npc: plan.act.npc, choice };
}

// ───────── the journal ─────────
/** Where each quest giver stands, for the Offers tab ("Bram, at the tavern"). */
const GIVER_AT: Readonly<Record<NpcId, string>> = Object.freeze({
  marrow: 'by the statue', pim: 'over the tavern door', bram: 'at the tavern', tamsin: 'at the river dock', nell: 'on the Greenway road',
});

/** A quest's reward from step `fromStep` on, in one line: "350 xp · 95 gold · a chest piece of your choice · the title …". */
export function rewardLine(id: QuestId, fromStep = 0): string {
  let xp = 0, gold = 0;
  const extra: string[] = [];
  QUESTS[id].steps.forEach((s, i) => {
    if (i < fromStep || !s.reward) return;
    xp += s.reward.xp ?? 0; gold += s.reward.gold ?? 0;
    if (s.reward.choice?.length) extra.push(s.reward.choice.some((c) => c.endsWith('_chest')) ? 'a chest piece of your choice' : 'an item of your choice');
    if (s.reward.title) extra.push(`the title ${s.reward.title}`);
  });
  return [xp ? `${xp} xp` : '', gold ? `${gold} gold` : '', ...extra].filter(Boolean).join(' · ');
}

/** The journal sheet's view (HudApi.journal), from the last quests view. */
export function journalView(q: ClientQuests, device: Device, tab?: JournalView['tab']): JournalView {
  const v = q.view ?? { active: [], done: [], offers: [], skipped: [] };
  const active: JournalView['active'] = v.active.map((a) => {
    const data = QUESTS[a.id];
    const steps: JournalView['active'][number]['steps'] = [];
    for (let i = 0; i < a.step; i++) {
      const s = data.steps[i]!;
      const text = (QUEST_LINES[a.id]?.[s.id] ?? [s.id])[0]!.replace(/\s*\{c\}\/\d+/, '');
      steps.push({ text, state: v.skipped.includes(`${a.id}:${s.id}`) ? 'skipped' : 'done' });
    }
    const cur = data.steps[a.step]!;
    const lines = stepLines(a.id, cur, a.counts).map((l) => ({ text: l.text, done: l.done }));
    steps.push({ text: lines.map((l) => l.text).join(' · '), state: 'current', lines, hint: hintNow(a.id, cur, a.counts, device) });
    return {
      id: a.id, name: QUEST_NAMES[a.id], blurb: QUEST_BLURBS[a.id], kind: data.kind, tracked: a.id === q.tracked,
      steps, rewards: rewardLine(a.id, a.step), canDrop: data.kind !== 'main', canSkip: cur.optional === true,
    };
  });
  const offers: JournalView['offers'] = v.offers.map((id) => {
    const g = QUESTS[id].giver;
    return { id, name: QUEST_NAMES[id], blurb: QUEST_BLURBS[id], giver: g ? `${shortName(NPC_NAMES[g])}, ${GIVER_AT[g]}` : null, rewards: rewardLine(id), canAccept: g === null };
  });
  const done: JournalView['done'] = v.done.map((d) => {
    const data = QUESTS[d.id];
    const title = data.steps.find((s) => s.reward?.title)?.reward?.title ?? null;
    return { id: d.id, name: QUEST_NAMES[d.id], times: d.times, today: d.today, daily: data.kind === 'daily', title };
  });
  return { active, offers, done, ...(tab ? { tab } : {}) };
}
