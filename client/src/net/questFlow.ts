// The quest flow on the client (Plan 6 Task 6): talking to the story's people and props, the dialogue that
// follows from the server's view, the completion moments, the scenes, the teaching hints and the journal's
// answers. No Babylon and no DOM here (the HUD, the scenes and the room come in as deps), so the whole flow is
// unit-tested against the protocol with fake messages.
//
// The protocol (server Task 4): the client sends `quest` acts (ids only); the server answers a completing act
// with jobXp/jobs/levelUp, then one `questDone` per completed step, then `quests` (only when changed), then
// `inventory`. A talk or use that completes nothing gets no answer at all, so the client sends one only when
// its view says it completes something, and otherwise plays the spot's idle lines itself. Nothing moves before
// the server says so: the tracker and the markers change on `quests` only.
import {
  BEACON_LINES, COMPLETE_TEXT, ITEMS, MAIN_QUEST, NPC_NAMES, QUEST_LINES, QUEST_NAMES, QUESTS, isItemId, isNpcId, marrowAnswer, stepDoneSay, stepHint,
  type Device, type ItemId, type JobId, type QuestAct, type QuestGiven, type QuestId, type Say,
} from '@sg2/shared';
import type { DialogueOpts, JournalAnswer, JournalView, QuestCardOpts, QuestMoment } from '../core/contracts';
import {
  createClientQuests, currentStep, journalView, onQuestDone, onQuestRefused, onQuests, talkPlan, actWithChoice, track, objectiveDone,
  type ClientQuests, type StepStarted, type StoryId,
} from './quests';

/** The HUD calls the flow uses (HudApi's). */
export interface FlowHud {
  dialogue(speaker: string, lines: string[], choices?: string[], opts?: DialogueOpts): Promise<number>;
  closeDialogue(): void;
  toast(text: string): void;
  banner(title: string, subtitle: string): void;
  questDone(g: QuestMoment): void;
  questHint(text: string | null, seconds?: number): Promise<boolean>;
  questCard(card: QuestCardOpts): Promise<number>;
  closeQuestCard(): void;
  journal(view: JournalView): Promise<JournalAnswer | null>;
}
/** The scenes (story/scenes.ts in the game; fakes in tests). */
export interface FlowScenes {
  /** The Beacon: the camera along Ellie's arm, the rise, the falling star; resolves when the HUD is back. */
  beacon(): Promise<void>;
  /** The crater: the camera eases down over it; resolves when it is done. */
  crater(): Promise<void>;
  /** A short rising ring of light on the adventurer (every completed step). */
  ring(): void;
}
/** What the flow reads from the game each time it needs it. */
export interface FlowCtx {
  beacon: boolean; job: JobId; inCombat: boolean; dead: boolean;
  /** Momentum 0..100; standing in a telegraph; whether an enemy is targeted (the fight's hints). */
  momentum: number; inDanger: boolean; hasTarget: boolean;
  /** Metres from the adventurer to a story spot of this zone (Infinity: not in this zone). */
  distanceTo(id: StoryId): number;
}
/** Hints already learned (kept in this browser by the game). */
export interface HintStore { has(id: string): boolean; add(id: string): void }

export interface QuestFlowDeps {
  hud: FlowHud;
  /** Sends a `quest` act; false when not connected (nothing was sent). */
  send(act: QuestAct): boolean;
  device: Device;
  ctx(): FlowCtx;
  scenes: FlowScenes;
  learned: HintStore;
  /** Called as a talk opens (the spot) and closes (null): the camera frames the speaker, the NPC turns. */
  onTalk?(id: StoryId | null): void;
  /** The equip prompt: "Equip now" (an `inv` equip of the bag item `uid`), and "Open bag" (null: no bag sheet yet). */
  equipNow?(uid: number): boolean;
  openBag?: (() => boolean) | null;
  /** The new chest piece's bag uid while the equip step is on (the bag sheet pulses its tile), null after. */
  highlight?(uid: number | null): void;
  /** performance.now(), in ms. */
  now(): number;
  /** Waits ms (a timer; tests pass one that resolves at once). */
  wait?(ms: number): Promise<void>;
}

/** How far (m) the adventurer may walk from the spot before the dialogue closes (it resumes at its page). */
export const TALK_LEAVE_M = 6.5;
/** How long a closed dialogue may be resumed at its page, in ms. */
export const RESUME_MS = 90_000;
/** After this long with no answer to a completing act, the flow stops waiting (the next view shows the truth). */
export const ANSWER_WAIT_MS = 3000;
/** The new-player flow waits this long after joining before its tracker peek, pointer and first hint. */
export const JOIN_HINT_MS = 1500;
/** How long the Beacon's banner has the screen before Marrow speaks again, in ms. */
export const BANNER_MS = 2600;
/** How long an NPC's spoken completion line is played as dialogue rather than a hint: within this many metres of them. */
const SPEAK_NEAR_M = 9;

/** The first hint of a new adventurer (the brief's line; the touch and desktop forms). */
export const FIRST_HINT: Readonly<Record<Device, string>> = Object.freeze({ touch: 'Tap Old Marrow to talk.', desktop: 'Click Old Marrow to talk, or walk up and press E.' });
/** A fight already under way: no new dialogue opens (fights are never hidden). */
export const FIGHT_FIRST = 'Finish the fight first.';
/** Sent while the connection is down: nothing was sent (the dialogue may be played again). */
export const NOT_CONNECTED = 'Not connected right now';
/** A full bag at Nell's reward, in plain words (the server's line comes first as a toast). */
export const BAG_FULL_HELP = 'Your bag is full, so Nell keeps the reward for now. Sell or bank something in town, then talk to her again.';
/** The equip prompt's title. */
export const EQUIP_TITLE = 'Put on your new chest piece';
/** The equip prompt's line while there is no bag sheet to open (Equip now is the way). */
export const EQUIP_LINE = 'Wear it now, or later from your bag.';

export interface QuestFlow {
  readonly quests: ClientQuests;
  /** The story spot being talked to (null: none). */
  readonly talking: StoryId | null;
  /** A scene is playing (the Beacon, the crater): the adventurer is held still. */
  readonly sceneOn: boolean;
  /** Counters for playtests: acts sent, answers waited for in vain. */
  readonly debug: { sent: QuestAct[]; silent: number; hints: string[] };
  /** A room message: 'quests', 'questDone', 'questRefused', 'inventory'. */
  message(type: string, m: unknown): void;
  /** Talks to (or uses) a story spot the adventurer is in reach of. */
  talk(id: StoryId): Promise<void>;
  /** The adventurer has entered the room (the new-player flow runs once the first view is in). */
  entered(): void;
  /** Opens the journal (Q, the tracker). */
  openJournal(): Promise<void>;
  /** Per frame: a fight or a walk away closes the dialogue; the fight's hints; the wait for an answer. */
  update(): void;
  /** The room ends (a zone change, a logout): open dialogue, cards and hints close; nothing is sent after this. */
  dispose(): void;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function createQuestFlow(deps: QuestFlowDeps, shared?: ClientQuests): QuestFlow {
  const { hud } = deps;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const q = shared ?? createClientQuests();
  const debug = { sent: [] as QuestAct[], silent: 0, hints: [] as string[] };
  let disposed = false;
  let talking: StoryId | null = null;
  let sceneOn = false;
  /** A dialogue closed before its end: the next talk to the same spot starts at that page. */
  let resume: { id: StoryId; page: number; at: number } | null = null;
  let page = 0;
  /** A completing act sent, waiting for its answer. */
  let awaiting: { act: QuestAct; at: number } | null = null;
  /** The moments (scenes and their lines) play one after the other. */
  let chain: Promise<void> = Promise.resolve();
  let enteredAt: number | null = null;
  let wasFighting = false;
  /** A quest card is up (the equip prompt), and one a fight put away is due again. */
  let cardUp = false, equipAgain = false;
  /** Hints shown in this session (a hint is shown at most once a session, and never again once learned). */
  const shownNow = new Set<string>();
  /** The bag as the last `inventory` said (the equip prompt finds the new piece in it). */
  let bag: { uid: number; item: string; worn: string[] }[] = [];

  const enqueue = (f: () => Promise<void>) => {
    chain = chain.then(() => (disposed ? undefined : f())).catch((e) => { console.warn('quest moment failed', e); });
    return chain;
  };
  const send = (act: QuestAct): boolean => {
    if (disposed) return false;
    if (!deps.send(act)) { hud.toast(NOT_CONNECTED); return false; }
    debug.sent.push(act);
    if (debug.sent.length > 50) debug.sent.shift();
    return true;
  };

  // ── hints ──
  const hint = (id: string, text: string | null, seconds?: number) => {
    // (the same words under two ids, the walking hint after Marrow and at pim_find, show once)
    if (!text || disposed || deps.learned.has(id) || shownNow.has(id) || shownNow.has(text)) return;
    shownNow.add(id); shownNow.add(text);
    debug.hints.push(id);
    if (debug.hints.length > 50) debug.hints.shift();
    void hud.questHint(text, seconds).then((dismissed) => { if (dismissed) deps.learned.add(id); });
  };
  const learn = (id: string) => deps.learned.add(id);
  const hintId = (quest: QuestId, stepId: string, part: string | number) => `${quest}:${stepId}:${part}`;

  /** A step became current: its start hint (or the equip prompt). */
  const stepStarted = (s: StepStarted) => {
    if (s.quest === MAIN_QUEST && s.stepId === 'equip') { void equipPrompt(); return; }
    const h = stepHint(s.quest, s.stepId, deps.device);
    if (h.line) hint(hintId(s.quest, s.stepId, 'start'), h.line);
    // the first fight: the kill hint at once (the others come as the fight gets there)
    if (s.quest === MAIN_QUEST && s.stepId === 'first_fight' && h.objectives[0]) hint(hintId(s.quest, s.stepId, 0), h.objectives[0]);
  };

  // ── the equip prompt ──
  const newPiece = (): { uid: number; item: ItemId } | null => {
    const got = [...q.history].reverse().find((g) => g.quest === MAIN_QUEST && g.stepId === 'nell_report' && g.item);
    const job = deps.ctx().job;
    for (const it of bag) if ((!got || it.item === got.item) && isItemId(it.item) && ITEMS[it.item].slot === 'chest' && !it.worn.includes(job)) return { uid: it.uid, item: it.item };
    return null;
  };
  const equipPrompt = async () => {
    if (disposed || deps.learned.has('equip-card')) return;
    const p = newPiece();
    deps.highlight?.(p?.uid ?? null);
    // its name from the reward itself (the `inventory` with it comes after the view that starts this step)
    const got = [...q.history].reverse().find((g) => g.quest === MAIN_QUEST && g.stepId === 'nell_report' && g.item);
    const item = p?.item ?? (got?.item && isItemId(got.item) ? got.item : null);
    const name = item ? ITEMS[item].name : 'Your new chest piece';
    const buttons = deps.openBag ? ['Equip now', 'Open bag'] : ['Equip now', 'Later'];
    cardUp = true;
    const i = await hud.questCard({ kicker: 'Gear', title: EQUIP_TITLE, text: deps.openBag ? `${name}. ${stepHint(MAIN_QUEST, 'equip', deps.device).line ?? ''}` : `${name}. ${EQUIP_LINE}`, buttons });
    cardUp = false;
    if (disposed) return;
    if (i === 0) {
      const piece = newPiece();
      if (!piece) { hud.toast('Your new piece is not in your bag yet'); return; }
      if (!deps.equipNow?.(piece.uid)) hud.toast(NOT_CONNECTED);
    } else if (i === 1 && deps.openBag) deps.openBag();
  };

  // ── messages ──
  const onDone = (g: QuestGiven) => {
    deps.scenes.ring();
    const step = QUESTS[g.quest].steps[g.step];
    const line = (QUEST_LINES[g.quest]?.[g.stepId] ?? [''])[0]!.replace(/\s*\{c\}\/\d+/, '');
    hud.questDone({
      title: QUEST_NAMES[g.quest], step: line, xp: g.xp, gold: g.gold,
      item: g.item && isItemId(g.item) ? ITEMS[g.item].name : null, title2: g.title, questDone: g.questDone,
    });
    if (awaiting) awaiting = null;
    // what the step taught is learned now: its hints are never shown again
    if (step) { learn(hintId(g.quest, g.stepId, 'start')); step.objectives.forEach((_, i) => learn(hintId(g.quest, g.stepId, i))); }
    if (g.quest === MAIN_QUEST && g.stepId === 'marrow') learn('first');
    if (g.quest === MAIN_QUEST && g.stepId === 'equip') { learn('equip-card'); hud.closeQuestCard(); deps.highlight?.(null); }
    if (g.scene === 'beacon') { enqueue(beaconMoment); return; }
    if (g.scene === 'crater') { enqueue(() => craterMoment(g)); return; }
    if (g.questDone) enqueue(async () => { hud.banner('Quest complete', QUEST_NAMES[g.quest]); });
    const say = stepDoneSay(g.quest, g.stepId, deps.device);
    if (say) enqueue(() => doneLine(say, g));
  };
  /** A step's completion line: an NPC nearby speaks it (a short dialogue), anything else is a hint. */
  const doneLine = async (say: Say, g: QuestGiven) => {
    const npc = (Object.keys(NPC_NAMES) as (keyof typeof NPC_NAMES)[]).find((n) => NPC_NAMES[n] === say.speaker);
    const c = deps.ctx();
    if (npc && !c.inCombat && c.distanceTo(npc) <= SPEAK_NEAR_M) {
      await hud.dialogue(say.speaker, [...say.lines], undefined, { closable: true });
      return;
    }
    hint(hintId(g.quest, g.stepId, 'done'), npc ? `${say.speaker.split(',')[0]}: ${say.lines.join(' ')}` : say.lines.join(' '));
  };
  /** Marrow speaks round the Beacon scene (the camera stays where it is: the statue stands between him and the plaque). */
  const marrowSays = async (say: Say) => { await hud.dialogue(say.speaker, [...say.lines], undefined, { closable: true }); };
  const beaconMoment = async () => {
    await marrowSays(BEACON_LINES.before);
    if (disposed) return;
    sceneOn = true;
    try { await deps.scenes.beacon(); } finally { sceneOn = false; }
    if (disposed) return;
    // the banner has the screen to itself for a moment (a dialogue hides it)
    hud.banner('The Beacon', 'An island appears in the sky');
    await wait(BANNER_MS);
    if (disposed) return;
    await marrowSays(BEACON_LINES.after);
  };
  const craterMoment = async (g: QuestGiven) => {
    sceneOn = true;
    try { await deps.scenes.crater(); } finally { sceneOn = false; }
    if (disposed) return;
    const [kicker, title] = COMPLETE_TEXT.banner;
    hud.banner(title, kicker);
    if (g.title) hud.toast(COMPLETE_TEXT.title(g.title));
    // the epilogue's offer: only while the view offers it (Accept sends `accept`; the server decides)
    if (!q.view?.offers.includes('keepers_lamp') && q.view) return;
    const [cardTitle, cardText] = COMPLETE_TEXT.offer.lines[0]!.split(' — ');
    const i = await hud.questCard({ kicker: 'New quest', title: cardTitle ?? QUEST_NAMES.keepers_lamp, text: cardText ?? '', buttons: [...(COMPLETE_TEXT.offer.choices ?? ['Accept', 'Not now'])] });
    if (i === 0 && !disposed) send({ act: 'accept', quest: 'keepers_lamp' });
  };

  const message = (type: string, m: unknown) => {
    if (disposed) return;
    if (type === 'quests') {
      const { started } = onQuests(q, m);
      for (const s of started) stepStarted(s);
      if (awaiting && started.length) awaiting = null;
    } else if (type === 'questDone') {
      const g = onQuestDone(q, m);
      if (g) onDone(g);
    } else if (type === 'questRefused') {
      const r = onQuestRefused(q, m);
      awaiting = null;
      hud.toast(r.text);
      if (r.reason === 'bag-full') void hud.questHint(BAG_FULL_HELP, 9);
    } else if (type === 'inventory') {
      if (isObj(m) && Array.isArray(m.bag)) {
        bag = (m.bag as unknown[]).filter(isObj).map((i) => ({ uid: Number(i.uid), item: String(i.item), worn: Array.isArray(i.worn) ? (i.worn as unknown[]).map(String) : [] }));
      }
    }
  };

  // ── talking ──
  const talk = async (id: StoryId): Promise<void> => {
    if (disposed || talking || sceneOn) return;
    const c = deps.ctx();
    if (c.dead) return;
    if (c.inCombat) { hud.toast(FIGHT_FIRST); return; }
    const plan = talkPlan(id, q.view, { beacon: c.beacon, job: c.job, device: deps.device });
    const now = deps.now();
    const start = resume && resume.id === id && now - resume.at < RESUME_MS ? Math.min(resume.page, plan.say.lines.length - 1) : 0;
    resume = null;
    talking = id;
    deps.onTalk?.(id);
    const play = (say: Say, choices?: readonly string[], from = 0) => {
      page = from;
      return hud.dialogue(say.speaker, [...say.lines], choices ? [...choices] : undefined, { closable: true, start: from, onPage: (p) => { page = p; } });
    };
    const closed = () => { resume = { id, page, at: deps.now() }; };
    try {
      switch (plan.kind) {
        case 'step': {
          const r = await play(plan.say, plan.say.choices, start);
          if (r < 0) { closed(); return; }
          const act = actWithChoice(plan, r);
          if (!act) return;
          if (send(act)) awaiting = { act, at: deps.now() };
          else closed(); // not connected: the next talk plays from the last page and sends again
          return;
        }
        case 'offer': {
          const r = await play(plan.say, plan.say.choices, start);
          if (r < 0) { closed(); return; }
          if (r === 0) send({ act: 'accept', quest: plan.quest });
          return;
        }
        case 'menu': {
          for (let guard = 0; guard < 12 && !disposed; guard++) {
            const r = await play(plan.say, plan.say.choices);
            if (r < 0) return;
            const ans = q.view ? marrowAnswer(r, q.view, deps.device) : null;
            if (!ans) return;
            if ((await play(ans)) < 0) return;
          }
          return;
        }
        case 'idle': {
          const r = await play(plan.say, undefined, start);
          if (r < 0) closed();
          return;
        }
      }
    } finally {
      talking = null;
      deps.onTalk?.(null);
    }
  };

  const openJournal = async () => {
    if (disposed) return;
    const a = await hud.journal(journalView(q, deps.device));
    if (!a || disposed) return;
    if (a.act === 'track') { track(q, a.quest); return; }
    send({ act: a.act, quest: a.quest });
  };

  // ── per frame ──
  const update = () => {
    if (disposed) return;
    const now = deps.now();
    if (awaiting && now - awaiting.at > ANSWER_WAIT_MS) { awaiting = null; debug.silent++; }
    const c = deps.ctx();
    // a fight closes the dialogue at once (fights are never hidden); so does walking away. Both resume at the page.
    if (talking && (c.inCombat || c.dead || c.distanceTo(talking) > TALK_LEAVE_M)) hud.closeDialogue();
    if (c.inCombat && !wasFighting && cardUp) { cardUp = false; equipAgain = true; hud.closeQuestCard(); }
    // the equip prompt a fight put away comes back once the fight is over (while the step is still on)
    if (!c.inCombat && wasFighting && equipAgain) { equipAgain = false; if (currentStep(q.view, MAIN_QUEST)?.step.id === 'equip') void equipPrompt(); }
    wasFighting = c.inCombat;
    // the new-player flow: once the first view is in, a moment after joining
    if (enteredAt !== null && q.view && now - enteredAt >= JOIN_HINT_MS) {
      enteredAt = null;
      const main = currentStep(q.view, MAIN_QUEST);
      if (main?.step.id === 'marrow') hint('first', FIRST_HINT[deps.device]);
      else if (main) { const h = stepHint(MAIN_QUEST, main.step.id, deps.device); if (h.line) hint(hintId(MAIN_QUEST, main.step.id, 'start'), h.line); if (main.step.id === 'equip') void equipPrompt(); }
    }
    // the first fight's hints, as the fight gets to them
    const ff = currentStep(q.view, MAIN_QUEST);
    if (ff?.step.id === 'first_fight') {
      const h = stepHint(MAIN_QUEST, 'first_fight', deps.device).objectives;
      const done = (i: number) => objectiveDone(ff.step.objectives[i]!, ff.counts[i]);
      if (c.inCombat && c.momentum >= 50 && !done(1)) hint(hintId(MAIN_QUEST, 'first_fight', 1), h[1] ?? null, 7);
      else if (c.inCombat && done(1) && !done(2)) hint(hintId(MAIN_QUEST, 'first_fight', 2), h[2] ?? null, 7);
      if (c.inDanger && !done(3)) hint(hintId(MAIN_QUEST, 'first_fight', 3), h[3] ?? null, 5);
    }
  };

  return {
    quests: q,
    get talking() { return talking; },
    get sceneOn() { return sceneOn; },
    debug,
    message,
    talk,
    entered() { enteredAt = deps.now(); },
    openJournal,
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      hud.closeDialogue();
      hud.closeQuestCard();
      void hud.questHint(null);
    },
  };
}

/** Is `id` a person (an NPC) rather than a prop? */
export const isPerson = (id: StoryId): boolean => isNpcId(id);
