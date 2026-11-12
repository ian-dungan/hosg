// The story text of the opening quest, its epilogue and its two side quests: every line of dialogue, the
// tracker lines, the hints and the journal blurbs, as plain text (clients set it as text, never as HTML),
// and the small rules that pick what an NPC says now from the adventurer's own quest view.
//
// Placeholders, filled here or by the client: {job} → JOBS[current].name, {item} → ITEMS[id].name, {c} → a
// tracker count. Ellie and Felix are legend only: they never speak. The adventurer is never "player" or
// "hero". One dialogue line is at most LINE_MAX characters (tested).
import { JOBS, isJobId } from '../combat/jobs';
import { deepFreeze } from '../combat/freeze';
import { ITEMS } from '../items';
import { LINE_MAX, QUESTS, objectiveTarget, type QuestId, type QuestsView } from '../quests';
import type { NpcId, PropId } from './spots';

export { LINE_MAX };

export interface Say { speaker: string; lines: readonly string[]; choices?: readonly string[] }
export type Device = 'touch' | 'desktop';
/** A hint with a touch and a desktop form, or one form for both. */
type Variant = string | { readonly touch: string; readonly desktop: string };
const pickV = (v: Variant, device: Device): string => (typeof v === 'string' ? v : v[device]);

/** The names shown for the quest NPCs (as in spots.ts's STORY_NPCS; a test keeps them in step). */
export const NPC_NAMES: Readonly<Record<NpcId, string>> = deepFreeze({
  marrow: 'Old Marrow', pim: 'Pim, the figurehead', bram: 'Bram, the tavern keeper', tamsin: 'Tamsin, the ferrywoman', nell: 'Nell Thistlewood, the road-keeper',
});
/** The names shown for the quest props (as in STORY_PROPS). */
export const PROP_NAMES: Readonly<Record<PropId, string>> = deepFreeze({
  plaque: 'The plaque', waymark_1: 'An old waymark', waymark_2: 'An old waymark', waymark_3: 'An old waymark', crater_edge: "The crater's edge",
});

export const QUEST_NAMES: Readonly<Record<QuestId, string>> = deepFreeze({
  solstice_crossing: 'The Solstice Crossing', keepers_lamp: "The Keeper's Lamp", bristle_bounty: 'Bristle Bounty', grans_waymarks: "Gran's Waymarks",
});

/** The journal's one line per quest. */
export const QUEST_BLURBS: Readonly<Record<QuestId, string>> = deepFreeze({
  solstice_crossing: 'The Two have pointed at an empty sky for seventy years. Today, something answered.',
  keepers_lamp: 'Something fell from the Beacon into the Greenway. It is still burning.',
  bristle_bounty: "Bram's hops are under siege. Bram would like them not to be.",
  grans_waymarks: "Tamsin's gran left marks along the old road, all pointing up.",
});

/**
 * The tracker: step id → one line per objective, in order. {c} is the objective's count (out of its n);
 * objectives sharing one line (the three waymarks) count together, and trackerLines shows that line once.
 */
export const QUEST_LINES: Readonly<Record<QuestId, Readonly<Record<string, readonly string[]>>>> = deepFreeze({
  solstice_crossing: {
    marrow: ['Speak with Old Marrow'],
    pim_find: ['Find the voice above the tavern'],
    pim_hop: ['Hop so Pim can see you'],
    pim: ['Talk to Pim'],
    plaque: ['Read the plaque on the statue'],
    board: ['Choose a job at the Guild Board'],
    gate: ['Leave by the east gate'],
    nell: ['Meet the road-keeper'],
    first_fight: ['Defeat Thornlings {c}/3', 'Spend Momentum on a finisher', 'Land a combo', 'Dodge roll in a fight'],
    picks: ['Use your picks in a fight {c}/2'],
    duo: ['Win a fight in a party', 'or defeat a Mossback (optional)'],
    nell_report: ['Report to Nell'],
    equip: ['Equip your new chest piece'],
    crater: ['Look into the crater'],
  },
  keepers_lamp: { descend: ['Climb down into the Lampfall'], hound: ['Defeat the Wickhound'], keeper: ['Defeat the Fallen Warden'] },
  bristle_bounty: { boars: ['Defeat Bramble Boars {c}/6'], bram: ['Tell Bram'] },
  grans_waymarks: { stones: ['Find the old waymarks {c}/3', 'Find the old waymarks {c}/3', 'Find the old waymarks {c}/3'], tamsin: ['Tell Tamsin'] },
});

/**
 * The tracker's lines for a step with its counts: {c} filled in, a line shared by several objectives shown
 * once (its {c} the number of them done). Unknown quest or step: [].
 */
export function trackerLines(quest: QuestId, stepId: string, counts: readonly number[]): string[] {
  const step = QUESTS[quest]?.steps.find(s => s.id === stepId);
  const lines = QUEST_LINES[quest]?.[stepId];
  if (!step || !lines) return [];
  const out: string[] = [];
  lines.forEach((t, i) => {
    if (i > 0 && lines[i - 1] === t) return;
    const same = lines.map((u, k) => (u === t ? k : -1)).filter(k => k >= 0);
    const o = step.objectives[i]!;
    const c = same.length > 1
      ? same.filter(k => (counts[k] ?? 0) >= objectiveTarget(step.objectives[k]!)).length
      : Math.min(counts[i] ?? 0, objectiveTarget(o));
    out.push(t.replace('{c}', String(c)));
  });
  return out;
}

// ───────── hints ─────────
interface StepText {
  /** Shown when the step starts (and as Marrow's answer to "What should I do now?"). */
  readonly start?: Variant;
  /** One per objective (the tracker's sub-line when tapped), or null. */
  readonly objectives?: readonly (Variant | null)[];
}
const WALK_HINT: Variant = { touch: 'Drag on the left of the screen to walk, or tap the ground to walk there.', desktop: 'Walk with WASD, or click the ground to walk there.' };
const STEP_TEXT: Readonly<Record<QuestId, Readonly<Record<string, StepText>>>> = deepFreeze({
  solstice_crossing: {
    pim_find: { start: WALK_HINT },
    pim_hop: { start: { touch: 'Tap Jump to hop.', desktop: 'Press Space to jump.' } },
    board: { start: 'Every adventurer needs a trade. Tap the Guild Board by the statue to choose a job.' },
    gate: { start: 'The Greenway lies past the east gate. Follow the road out of town.' },
    first_fight: {
      objectives: [
        'Tap a Thornling, then stay close. You attack by yourself.',
        'When your Momentum bar is half full, press your finisher (button 2, or key 2).',
        'Finisher marks a foe; a second, different finisher on that mark is a combo.',
        { touch: 'Tap Dodge, or double-tap a direction, to roll.', desktop: 'Press Shift to roll.' },
      ],
    },
    picks: { start: 'Buttons 4 and 5 are your picks. Use both in a fight. You can change them out of a fight from the job board.' },
    // the plan's line is 144 characters; tightened to fit LINE_MAX (same words, "and invite them, then" → ", invite them and")
    duo: { start: "Two lanterns are brighter than one. Tap another adventurer, invite them and fight together. Or, if you're bold, take down a Mossback alone." },
    equip: { start: { touch: 'Open your bag and tap the new piece, then Equip.', desktop: 'Press I for your bag, tap the new piece, then Equip.' } },
  },
  keepers_lamp: {}, bristle_bounty: {}, grans_waymarks: {},
});

/** The current step's hint (and per-objective hints), with device variants resolved. Unknown step: nulls. */
export function stepHint(quest: QuestId, stepId: string, device: Device): { line: string | null; objectives: readonly (string | null)[] } {
  const step = QUESTS[quest]?.steps.find(s => s.id === stepId);
  if (!step) return { line: null, objectives: [] };
  const t = STEP_TEXT[quest]?.[stepId];
  return {
    line: t?.start !== undefined ? pickV(t.start, device) : null,
    objectives: step.objectives.map((_, i) => { const v = t?.objectives?.[i]; return v ? pickV(v, device) : null; }),
  };
}

/** The job sheet's header while the `board` step is active ({job}: the current job's name). */
export function boardHeader(job: string): string {
  return 'Choose a job, or keep your {job} and choose its two picks. Jobs change only in towns and safe camps.'.replace('{job}', jobName(job));
}
const jobName = (job: string): string => (isJobId(job) ? JOBS[job].name : job);

/** The Skip button's label on an optional step in the journal. */
export const SKIP_LABEL = 'Skip this step (no reward)';

/**
 * What is shown when a step completes (a line, a hint or narration), or null: Pim's call on reaching the
 * tavern, the walking hint after Marrow, the board, the picks, the duo, Nell's word after the reward, the
 * equip, and the lamp at the end of the epilogue.
 */
export function stepDoneSay(quest: QuestId, stepId: string, device: Device): Say | null {
  if (quest === 'solstice_crossing' && stepId === 'marrow') return { speaker: '', lines: [pickV(WALK_HINT, device)] };
  if (quest === 'solstice_crossing' && stepId === 'pim_find') return PIM_CALL;
  return DONE_TEXT[quest]?.[stepId] ?? null;
}
const DONE_TEXT: Readonly<Partial<Record<QuestId, Readonly<Record<string, Say>>>>> = deepFreeze({
  solstice_crossing: {
    board: { speaker: '', lines: ["Your trade is set. You can come back to the board whenever you're in town."] },
    picks: { speaker: '', lines: ['Good. Pick what suits the fight; nobody here will judge you.'] },
    duo: { speaker: NPC_NAMES.nell, lines: ['Not bad. Not bad at all.'] },
    nell_report: { speaker: NPC_NAMES.nell, lines: ['Put it on before we go any further. Gear in a bag protects nobody.'] },
    equip: { speaker: NPC_NAMES.nell, lines: ['That suits you. Now, the crater. Follow the road east.'] },
  },
  keepers_lamp: { keeper: { speaker: '', lines: ["The lamp steadies. For a moment its beam points the same way as Ellie's arm."] } },
});

// ───────── dialogue ─────────
/** Pim's call when the adventurer reaches the tavern (a client line; no server act). */
export const PIM_CALL: Say = deepFreeze({ speaker: NPC_NAMES.pim, lines: ['Up here! No, higher. Give a hop, so I can see your face over the rail.'] });

/** The talk lines of each talk step, by quest and step id (the NPC is the step's own). */
const TALK: Readonly<Partial<Record<QuestId, Readonly<Record<string, readonly string[]>>>>> = deepFreeze({
  solstice_crossing: {
    marrow: [
      'Ah, there you are. Mind the plinth, it has outlasted better boots than yours.',
      'Seventy years those two have pointed at that empty patch of sky. Every solstice I say: this is the year.',
      'Every solstice, nothing. Still. Fair winds to the Two.',
      'Today feels different, though. Pim has been muttering since dawn. Go and ask him why.',
      "He's the figurehead over the tavern door. Follow the street toward the river.",
    ],
    pim: [
      "There you are. Psst. Don't tell Bram I can talk, he'll want rent.",
      'I sailed with them, you know. Ellie at the bow, Felix at the helm, me out front looking magnificent.',
      "Every solstice the sun slides behind Felix's spyglass. Every year, nothing happens.",
      'But the bronze has been warm since dawn. I can feel it in my varnish.',
      'Go and read their plaque. Something wants waking.',
    ],
    nell: [
      'Hold there. You came out of Shady Grove at a run, so you saw it too.',
      "I'm Nell. I keep this road. Something came down through the trees at sunrise and left a hole the size of a barn.",
      "I'll show you where. But the Thornlings are stirred up, and I won't walk anyone past them who can't hold their own.",
      'Tap a Thornling to target it. Your blows build Momentum. Spend it on your finisher, the second button.',
      "A finisher leaves a mark. Set it off with a different one and you've got a combo.",
      'Some of their swings glow on the ground first. When it glows under you, roll out.',
    ],
    nell_report: [
      "You'll do. Better than do, even.",
      'Here. The smiths in town send me spares for anyone who\'s earned them. Pick what suits you.',
    ],
  },
  bristle_bounty: { bram: ['Six! The hops thank you.', "The pie's in the purse. Don't ask how."] },
  grans_waymarks: { tamsin: ['All pointing the same way. She knew. Of course she knew.', 'Here, for your boots. Gran would have liked you.'] },
});

/** The labels of a step's reward choices ({item}: the item's name), in the data's order. */
const CHOICE_TAILS: Readonly<Record<string, string>> = deepFreeze({
  mossweave_chest: '{item} — cloth: stronger abilities',
  thornrunner_chest: '{item} — light: faster Momentum',
  rootbound_chest: '{item} — heavy: they come for you, not your friends',
});
/** The reward choice labels of a quest step (empty when it has no choice). */
export function rewardChoices(quest: QuestId, stepId: string): string[] {
  const step = QUESTS[quest]?.steps.find(s => s.id === stepId);
  return (step?.reward?.choice ?? []).map(id => (CHOICE_TAILS[id] ?? '{item}').replace('{item}', ITEMS[id]?.name ?? id));
}

/** An NPC's quest offers: the lines and the two choices (accept, decline). */
const OFFERS: Readonly<Partial<Record<QuestId, { readonly lines: readonly string[]; readonly choices: readonly [string, string] }>>> = deepFreeze({
  bristle_bounty: {
    lines: ['Bramble Boars have been rooting up my hop rows by the east road.', "Six of them, and I'll stand you a purse and a pie."],
    choices: ["I'll do it", 'Not today'],
  },
  grans_waymarks: {
    lines: ['Gran left marks along the old road. Stones with an arm carved on them, all pointing up.', "Would you find three for me? I'd like to know she was right."],
    choices: ["I'll find them", 'Not now'],
  },
});

/** Marrow's question menu (always offered when there is nothing else to say). */
export const MARROW_MENU: readonly string[] = deepFreeze(['Who were Ellie and Felix?', 'What is this place?', 'What should I do now?', 'Goodbye']);
const MARROW_IDLE = 'Back again? Ask away. I have nothing but time and a statue to dust.';
// The plan's second and third lines are 147 and 142 characters: each is split at its sentence break into two
// pages (one line per page, at most LINE_MAX), word for word.
const MARROW_ELLIE: readonly string[] = deepFreeze([
  'The greatest adventurers Shady Grove ever raised. Ellie found the way; Felix made it possible.',
  'She never went anywhere without a charcoal stick and a half-drawn map.',
  'He mended whatever she broke, and could talk a frightened town into courage.',
  'When the sky-lands tore loose and drifted off, they built a ship that could sail the wind and went up after them.',
  'Nobody here calls them lost.',
]);
const MARROW_PLACE: readonly string[] = deepFreeze([
  'Shady Grove. The very same one. Those old trees were shading this square before either of them could walk.',
  'The east road runs all the way to Normandy, the capital, and the world is a hundred times wider than folk here think.',
]);
const MARROW_AFTER = "Go and see what's in that crater, if you must. Bring a friend back with you.";

/** What the adventurer should do next on the main quest, in one line: the step's hint, else its tracker line. */
function nowLine(view: QuestsView, device: Device): string {
  const p = view.active.find(a => a.id === 'solstice_crossing');
  if (!p) return MARROW_AFTER;
  const step = QUESTS.solstice_crossing.steps[p.step];
  if (!step) return MARROW_AFTER;
  return stepHint('solstice_crossing', step.id, device).line ?? trackerLines('solstice_crossing', step.id, p.counts).join('. ');
}

/** Marrow's answer to a menu choice (MARROW_MENU's index), or null for Goodbye (or anything else). */
export function marrowAnswer(choice: number, view: QuestsView, device: Device): Say | null {
  const speaker = NPC_NAMES.marrow;
  if (choice === 0) return { speaker, lines: MARROW_ELLIE };
  if (choice === 1) return { speaker, lines: MARROW_PLACE };
  if (choice === 2) return { speaker, lines: [nowLine(view, device)] };
  return null;
}

/** Lines the NPCs say when no step, offer or turn-in is theirs. */
const IDLE = deepFreeze({
  pimBefore: "Go on, the plaque. I'd go myself, but I'm nailed to a tavern.",
  pimAfter: 'They did it. They actually did it! Find us a ship. Ellie always hated being kept waiting.',
  bramActive: "Six boars. I'm counting, and so are the hops.",
  bramToday: 'Same again tomorrow? Those boars never learn.',
  bram: [
    'Welcome to the Second Chance. Named for their ship, same as the figurehead over my door.',
    "Don't mind old Pim up there. Carved wood. Hasn't said a word in seventy years, whatever the children tell you.",
  ],
  tamsinBefore: ['No ferry today, friend. The river is running high, and the road to Normandy is a long one on foot.', 'My gran swore there was land up where the statue points. In the sky! Gran also swore gulls could read.'],
  tamsinAfter: 'Well. There is an island. In the sky. I am going to need a much better boat.',
  nellAfter: "Whatever's down there was built to last. If you go, take a friend. I'd take two.",
});

/** Whether `npc`'s talk objective is open on some active quest's current step: [quest, step id]. */
function talkStep(npc: NpcId, view: QuestsView): [QuestId, string] | null {
  for (const p of view.active) {
    const step = QUESTS[p.id]?.steps[p.step];
    if (!step) continue;
    if (step.objectives.some((o, i) => o.k === 'talk' && o.npc === npc && (p.counts[i] ?? 0) < 1)) return [p.id, step.id];
  }
  return null;
}
const fill = (s: string, ctx: { job: string }) => s.replace('{job}', jobName(ctx.job));

/**
 * The lines an NPC says now, for this adventurer's quests, in this order: the current step's talk (a turn-in
 * included), an offer (with its two choices) when the NPC gives an offered quest, the in-progress line, and
 * idle (Marrow's with his question menu; Pim's and Tamsin's change once the Beacon is up).
 */
export function npcSay(npc: NpcId, view: QuestsView, ctx: { beacon: boolean; job: string; device: Device }): Say {
  const speaker = NPC_NAMES[npc];
  const say = (lines: readonly string[], choices?: readonly string[]): Say => (choices ? { speaker, lines: lines.map(l => fill(l, ctx)), choices } : { speaker, lines: lines.map(l => fill(l, ctx)) });
  const t = talkStep(npc, view);
  if (t) {
    const lines = TALK[t[0]]?.[t[1]];
    if (lines) {
      const choices = rewardChoices(t[0], t[1]);
      return say(lines, choices.length ? choices : undefined);
    }
  }
  for (const q of Object.keys(OFFERS) as QuestId[]) {
    if (QUESTS[q].giver === npc && view.offers.includes(q)) { const o = OFFERS[q]!; return say(o.lines, o.choices); }
  }
  switch (npc) {
    case 'marrow': return say([MARROW_IDLE], MARROW_MENU);
    case 'pim': return say([ctx.beacon ? IDLE.pimAfter : IDLE.pimBefore]);
    case 'bram': {
      if (view.active.some(p => p.id === 'bristle_bounty')) return say([IDLE.bramActive]);
      if (view.done.some(d => d.id === 'bristle_bounty' && d.today)) return say([IDLE.bramToday]);
      return say(IDLE.bram);
    }
    case 'tamsin': return say(ctx.beacon ? [IDLE.tamsinAfter] : IDLE.tamsinBefore);
    case 'nell': return say([view.active.some(p => p.id === 'solstice_crossing') ? nowLine(view, ctx.device) : IDLE.nellAfter]);
  }
}

const PLAQUE: readonly string[] = deepFreeze(['ELLIE and FELIX. The Two.', '“She found the way. He made it possible.”', 'Raised by the grateful people of Shady Grove. Fair winds.']);
const WAYMARKS: Readonly<Record<'waymark_1' | 'waymark_2' | 'waymark_3', string>> = deepFreeze({
  waymark_1: 'A mossy stone. Someone carved an arm into it, pointing at the sky. Under it, a single letter: T.',
  waymark_2: 'Another arm, cut deeper. Beside it, a little boat with wings.',
  waymark_3: 'The last stone. The arm points straight at the island you can see now. Beneath it: fair winds.',
});

/** The crater's edge (narration; the `crater` step). */
export const CRATER_LINES: Say = deepFreeze({
  speaker: PROP_NAMES.crater_edge,
  lines: [
    'The road ends in a raw scar of earth. Roots hang over the edge like torn rope.',
    'Far below, something glows: a lamp, still lit, swinging slowly in the dark.',
    'Once, very faintly, a bell tolls. Then again, as if it were counting ships that never come.',
  ],
});

/** What a prop reads (the same at its step and after: narration). */
export function propSay(prop: PropId, view: QuestsView): Say {
  void view; // the props read the same whatever the quest state; kept for later props that do not
  if (prop === 'plaque') return { speaker: PROP_NAMES.plaque, lines: PLAQUE };
  if (prop === 'crater_edge') return CRATER_LINES;
  return { speaker: PROP_NAMES[prop], lines: [WAYMARKS[prop]] };
}

/** Marrow before and after the Beacon scene (the plaque's completion). */
export const BEACON_LINES: { readonly before: Say; readonly after: Say } = deepFreeze({
  before: { speaker: NPC_NAMES.marrow, lines: ['Wait. Look at the spyglass. The bronze is humming!'] },
  after: {
    speaker: NPC_NAMES.marrow,
    lines: [
      'Seventy years. They were pointing at something after all.',
      'And did you see that? Something fell from it. Out east, past the gate, into the Greenway.',
      "Don't go out there with empty hands. Visit the Guild Board first and choose a trade.",
    ],
  },
});

/** The main quest's completion: the banner, the title toast, and the epilogue's offer card. */
export const COMPLETE_TEXT: { readonly banner: readonly [string, string]; readonly title: (t: string) => string; readonly offer: Say } = Object.freeze({
  banner: Object.freeze(['Quest complete', 'The Solstice Crossing'] as const),
  title: (t: string) => `New title: ${t}`,
  offer: deepFreeze({ speaker: '', lines: ["The Keeper's Lamp — Climb down into the Lampfall and find what fell. Best with friends."], choices: ['Accept', 'Not now'] }),
});

/** Every fixed line of game text in this module (for the tests' checks). */
export function allStoryText(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') { if (v !== '') out.push(v); } // '' is a hint's or narration's empty speaker
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk([NPC_NAMES, PROP_NAMES, QUEST_NAMES, QUEST_BLURBS, QUEST_LINES, STEP_TEXT, DONE_TEXT, IDLE, TALK, CHOICE_TAILS, OFFERS, MARROW_MENU, MARROW_IDLE, MARROW_ELLIE, MARROW_PLACE, MARROW_AFTER, PIM_CALL, PLAQUE, WAYMARKS, CRATER_LINES, BEACON_LINES, COMPLETE_TEXT, SKIP_LABEL, boardHeader('warrior')]);
  out.push(COMPLETE_TEXT.title('Witness of the Crossing'));
  return out;
}
