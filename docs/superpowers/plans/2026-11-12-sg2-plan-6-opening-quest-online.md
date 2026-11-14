# Shady Grove 2 — Plan 6: The Opening Quest Online ("The Solstice Crossing") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new adventurer signs in, makes a character, and stands in the Plaza of the Two with a quest already in hand. **The Solstice Crossing** keeps the offline demo's beats: Old Marrow, Pim the figurehead, the plaque, the beam from Felix's spyglass, the Beacon rising in the sky, and something falling into the woods. Then it carries on into the Greenway, and on the way it teaches the game in order: walking and jumping, the Guild Board and a job, targeting, Momentum, a finisher, a combo, a dodge roll, the two picks, grouping up (optional, and completable solo), and equipping a piece of gear the quest gives. It ends at the rim of the Lampfall and points down into it without requiring it. The quest is saved per adventurer, advanced only by the server (kills by the existing kill credit with party share, places and props by the server's own pose, talk by reach), and rewarded exactly once through the inventory queue, in the same compare-and-set write that advances the step. Two side quests (one daily) and an optional epilogue (into the Lampfall) use the same small, data-driven system, which later quests extend. Quest state is private: it goes only to its owner, and nothing new is sent to everyone.

**Architecture:** This plan adds to Plans 1–5. It replaces nothing but the online client's empty quest tracker (`HudState.quest: null`).
- `@sg2/shared` gains:
  - the quest rules (`quests.ts`): quest, step, objective and reward data; the four quests; the save, its repair and its view; pure functions for events (kills, places, props, jumps, jobs, equips, combat acts) and player acts (talk, use, accept, abandon, skip); reward application through Plan 5's `addLoot` and `addJobXp`;
  - story landmarks (`story/spots.ts`): the quest NPCs and quest props as authored data, positioned from the grove's layout constants and the Greenway's generated layout by a deterministic, tested rule;
  - the story text (`story/lines.ts`): every line of dialogue, tracker line, hint and journal blurb;
  - a quest follower for bots (`story/questBot.ts`).
- The server gains:
  - migration 008 (`quests jsonb`), written only by `writeInventory` (so a step's advance and its reward land in one atomic write);
  - the `quest` message and quest events in `ZoneRoom`, coalesced per room step with the step's loot into one queue task;
  - the keepsake title and the Plan 8 home hook;
  - a test-only switch `SG2_TEST_QUEST`.
- The client gains:
  - code-built quest NPCs and props in the grove and the Greenway, with tap-to-talk and markers;
  - the dialogue flow on Plan 1's dialogue sheet, the tracker with counts, an edge-of-screen pointer, a journal, the completion moment, and the Beacon scene moved from the offline demo.

**Tech Stack:** as Plans 1–5: TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, PostgreSQL 16 / memory store, Playwright (pre-installed; never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md`. This plan implements:
- section In scope 2, **"The Solstice Crossing"**: "talk to Old Marrow, find Pim, read the plaque. The beam leaves the statue and a floating island, the Beacon, appears far off in the sky. Something falls from it into the woods.";
- section In scope 3: "a few side quests" in the Greenway (two here; more later);
- section 9 "abilities unlocked by level and quest": the quest side is a data hook only (Plan 5's ruling stands: no ability unlocks in this slice);
- section 10: "saved characters" now include quest progress;
- Plan 1 roadmap line 6: "The Solstice Crossing as a saved, per-adventurer quest".

**Boundary with other plans** (stated so no worker builds it):
- **Still being built while this plan is written:**
  - Plan 4 Tasks 8–11: client party UI (`client/src/hud/party.ts` exists in part), the Lampfall's look, party and dungeon bots, docs;
  - Plan 5 Tasks 8–12: the look-driven adventurer and the character creator (`HudApi.creator`, `GET /api/look`), gear on the model, the bag, vendor and talent screens (`HudApi.bag`, `HudApi.loot`), town stalls and keepers (`client/src/world/stalls.ts`), bots with looks and gear (`--looks`, `--gear`), docs.

  Where a task here depends on them, it names the interface it assumes. If the built interface differs, the task adapts to what was built and records it in its report. Where an assumed interface does not exist yet when a task runs, the task uses the fallback it names (never builds the other plan's feature).
- **Plan 7 owns** the general world generator. Quest props in the Greenway are story landmarks positioned from its generated layout by a rule here; Plan 7 may absorb the rule.
- **Plan 8 owns** homes. This plan only records the unlock `'home:starter_cottage'` when The Solstice Crossing is completed (`QuestSave.unlocks`); Plan 8 reads it and hands out the cottage.
- **Plan 9 owns** neighbourhoods.
- **Later:** more quests and chains (the Monk's Greenway quest, the Normandy road), quest-unlocked abilities and jobs (the `JobData.unlock: { kind: 'quest' }` hook already exists), voiced or animated cutscenes beyond the Beacon scene, a GM quest-reset command, shared party quest prompts, and quest-gated zones.

## Global Constraints

- **One combat system (Plans 3, 3b, 4 and 5, unchanged):** tap-target and auto-attack, one Momentum bar, five buttons per job, a dodge roll with charges, marks and combos, telegraphs, stagger and Breaks. **Quests add no ability, no button, no resource, no enemy kind and no combat number.** No band in `shared/src/combat` changes.
- **Jobs change only where `CombatZone.jobSwitch(x, z)` is true** (unchanged). The quest's job step is done in the grove.
- **Server-authoritative:**
  - clients send ids only: an NPC id, a prop id, a quest id, a choice index;
  - the server decides every objective from its own state: kills from the engine's credit (after `MIN_CREDIT_FRAC`) plus Plan 4's party share (`creditedFor`); places from the last accepted pose (`session.lastGood`); jumps from accepted poses; talk and props by distance from the last accepted pose; finishers, combos, picks and dodges from the engine's own `fx`; jobs from accepted `job` and `loadout` intents; equips from applied `inv` operations;
  - a malformed or impossible request is refused with a reason and changes nothing.
- **Never lose, never duplicate:**
  - quest progress, step advances and every quest reward land in **one atomic store write** (`writeInventory`, compare-and-set on `inv_version`), through the session's inventory queue (Plan 5);
  - a reward is granted only in the write that advances past its step; steps only move forward; a once-quest is never offered again after it is done; a daily quest pays at most once per UTC day;
  - quest items and gold go through Plan 5's `addLoot` with a quest key, so even a replayed task gives nothing twice; xp goes to the current job through `addJobXp`, and the session applies it from the write's `landed` hook (Task 3), so a save never drops it;
  - a kill counts for a quest at most once per adventurer (`QuestSave.seen` kill keys);
  - nothing is lost on death, disconnect, relog, travel or a second tab.
- **Scale and bandwidth:**
  - 100 adventurers, `TICK_HZ = 15`, zone room step p95 ≤ 15 ms, instances ≤ 3 ms, peak RSS ≤ 400 MB (Plans 4–5);
  - **nothing new in `ZoneState` or `PlayerState`.** Quest NPCs and props are static shared data, drawn by every client from `STORY_NPCS` and `STORY_PROPS`. Quest state, views, completions and refusals are messages to their owner only;
  - per-client receive in the clustered 100-walker grove run (`--cluster 15`) stays within **+0.1 KiB/s** of the latest recorded number in `docs/load-test.md` for the same run (it is ≈ 10.8–11.0 of the 11.0–11.5 limit), measured with and without `--quest` (Task 7);
  - inventory writes per second (`/healthz` `invWritesPerS`) p95 stays ≤ 40 in the 100-bot quest run;
  - every list kept per adventurer or per session is bounded (see Numbers).
- **Phone-first:**
  - every touch control is at least 48 px (ability buttons 64 px), no text under 14 px;
  - the tracker never covers the ability grid, the joystick zone, the target frame or the boss frame, at 390 × 844, 844 × 390, 768 × 1024 and 1280 × 800 (tested in DOM);
  - the dialogue sheet is Plan 1's (`hud.dialogue`), one line per page, at most `LINE_MAX = 140` characters;
  - the journal is full-screen on phones in portrait and landscape and a panel of at most 420 px on desktop.
- **Desktop keys:** as Plan 5, plus `Q` (the journal) and `E` (talk to, or use, the nearest NPC, prop, stall or board within reach: the nearest wins). `Esc` closes.
- **Names and writing:**
  - every NPC, prop, quest, step and title name, and every line of dialogue in this plan, is original. Workers keep them exactly as written; new text needs the same care (nothing lifted from other games, books or films);
  - Ellie and Felix appear only as legend: in what others say about them, the statue, the plaque and the marks they left. They never speak and are never met;
  - "adventurer" is the player's word, never "player" or "hero" in game text;
  - job names come only from `JOBS[id].name`, item names only from `ITEMS[id].name`.
- **Art:** everything is built in code, flat-shaded low-poly with toon lighting, in `PALETTE`-derived colours, with no asset files. Story landmarks (NPCs, the plaque, waymarks, the crater's edge marker) are authored as data; nothing else is hand-placed.
- **Chat is unfiltered** (owner decision), always cleaned (`cleanChat`) and shown as plain text. Quest text is set as text, never as HTML.
- **Persistence:** quest state is saved (migration 008). Parties and instances stay memory-only.
- **Everything from Plans 1–5 keeps working:**
  - accounts, travel, reconnect and relog carry, death and respawn, interest views, jobs, parties, instances, Seals, titles, the leaderboard, inventory and loot, looks, GM tools and Docker packaging;
  - root `npm test` stays green with pristine output;
  - `npm run build` (the offline demo) keeps its own quest in `client/src/main.ts` unchanged (it may read the shared story text, Task 6);
  - `npm run build:online` gets everything.
- **Out of scope** (design so it slots in, do not build): quest chains beyond these four quests, quest-unlocked abilities or jobs, homes (Plan 8; the unlock hook only), shared party quest prompts, GM quest commands, voice and voiced dialogue, branching story outcomes.
- **Environment:**
  - no secrets in the repository;
  - never touch anything outside the repository: no global installs, no system services, no killing processes the task did not start;
  - Playwright is pre-installed, so never install it;
  - never `chmod` `/tmp/claude-0`.
- **Browser checks:**
  - headless WebGL runs at about 1 fps, so measure game time, not wall time;
  - open pages with `?lockq`;
  - Tasks 5, 6 and 7 are browser-heavy, and only one of them may run at a time (also never at the same time as a browser-heavy Plan 4 or Plan 5 task: Plan 4 Tasks 8–10, Plan 5 Tasks 8–11);
  - local test servers use ports 2571–2579 with `SG2_STORE=memory`, are started in the background with their PID recorded, and are stopped with `kill <pid>`. Never use `fuser` or kill by name. Smoke scripts get `--kill "kill <pid>"`;
  - the standard local server command (fill in the port) is:
    ```
    SG2_STORE=memory SG2_AUTH_RATE_PER_MIN=1000 SG2_PORT=<port> SG2_JWT_SECRET=local-test-secret-0123456789abcdef npx tsx server/src/index.ts
    ```
- **Scratch files** (measurement scripts, screenshots) go only in a new sub-directory of the session scratchpad, never in the repository. A scratch worktree, when a task needs one, is made in a new sub-directory of the scratchpad and gets its own `npm ci`.
- **Git:**
  - TDD: write the failing test first;
  - stage explicit paths only (`git add <paths>`, never `-A` or `.`); never `git stash`;
  - other workers may be editing `shared/`, `client/` and `server/` at the same time: touch only the files your task lists;
  - every commit message ends with exactly these two lines:
    ```
    Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01YDaH79F8gHUx42PWzrB3f9
    ```
  - no model names anywhere else.

## Task order and parallelism

| Task | Depends on | May run in parallel with | Browser-heavy |
|---|---|---|---|
| 1 Shared quest rules: types, the four quests, save and repair, events and acts, rewards, views, messages; story spots | — | 2 (after its types land), 3 (after its types land) | no |
| 2 Shared story text: every dialogue line, tracker line, hint and journal blurb | 1 (types) | 1, 3, 4 | no |
| 3 Server I: migration 008, both stores, `InvWrite.quests`, the queue's snapshot and `landed` hook | 1 (types) | 2, 5 | no |
| 4 Server II: the `quest` message, quest events, rewards, title and home hook, views, `SG2_TEST_QUEST` | 1, 3 | 2, 5 | no |
| 5 Client I: quest NPCs and props in the world, markers over them, the Beacon's state and the falling star | 1 (and 2 for names) | 2, 3, 4 | **yes** |
| 6 Client II: quest state, talk and dialogue flow, tracker, edge pointer, journal, hints, reward choice, completion moment, the Beacon scene | 2, 4, 5 (and Plan 5 Tasks 8 and 10, Plan 4 Task 8) | — | **yes** |
| 7 Bots that run the quest, the quest smoke test, the load runs | 4, 6 (and Plan 5 Task 11, Plan 4 Task 10) | — | **yes** (smoke) |
| 8 Docs: outcome placeholder, roadmap, verification list | 7 | — | no |

Browser-heavy tasks (5, 6, 7's smoke step) never run at the same time as each other. Their pure and unit-test steps may run alongside other tasks.

Task 1 lands its types first: `QuestId`, `NpcId`, `PropId`, `Objective`, `QuestStep`, `QuestReward`, `QuestData`, `QuestSave`, `QuestsView`, `QuestAct`, `QuestEvent` and `QuestRefusal` in `shared/src/quests.ts`, with `parseQuests` and `newQuestSave` stubs, committed as soon as they compile (`feat: quest types`). Tasks 2 and 3 may start once they are on the branch.

No task changes a Plan 3, 3b, 4 or 5 number. The quest numbers below are economy numbers: Task 7 reports them, nobody tunes them in this plan.

## Numbers

Quest constants live in `shared/src/quests.ts`; story spots and their rule in `shared/src/story/spots.ts`.

### Limits (`shared/src/quests.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `QUEST_ACTIVE_MAX` | 6 | quests active at once (the four of this slice fit; more → `'full'`) |
| `QUEST_SEEN_MAX` | 32 | kill keys remembered per adventurer, so a kill counts once |
| `QUEST_SKIPPED_MAX` | 16 | optional steps remembered as skipped |
| `QUEST_UNLOCKS_MAX` | 16 | unlock strings held (each comes from quest data) |
| `QUEST_COUNT_MAX` | 99 | an objective's count never exceeds this (nor its own `n`) |
| `QUEST_OPS_PER_S` | 4 | `quest` messages per session: a token bucket of 4, refilling 4 a second (more → `'rate'`) |
| `QUEST_EVENTS_PER_STEP` | 32 | quest events a session may queue in one room step (more are dropped, never written) |
| `NPC_REACH` | 3.6 m | talk needs the last accepted pose within this of the NPC (the offline demo's `INTERACT_RANGE`) |
| `PROP_REACH` | 3.0 m | use needs the last accepted pose within this of the prop |
| `REACH_FUZZ` | 0.5 m | added on the server (latency) to both reaches |
| `JUMP_MIN_M` | 0.6 m | a jump counts when an accepted pose stands at least this above the zone's surface there |
| `LINE_MAX` | 140 | characters in one dialogue line (`story/lines.ts`, tested) |

### The save (`shared/src/quests.ts`)

```ts
export interface QuestProgress { id: QuestId; step: number; counts: number[]; since: string /* UTC day accepted */ }
export interface QuestSave {
  v: 1;
  active: QuestProgress[];                                                   // ≤ QUEST_ACTIVE_MAX, main quest first
  done: Partial<Record<QuestId, { day: string; times: number; choice?: number }>>;   // keys only from QUEST_IDS
  unlocks: string[];                                                         // ≤ QUEST_UNLOCKS_MAX, each from quest data
  seen: string[];                                                            // kill keys, ≤ QUEST_SEEN_MAX, oldest first
  skipped: string[];                                                         // `${quest}:${stepId}`, ≤ QUEST_SKIPPED_MAX
}
```
- `newQuestSave()` is `{ v: 1, active: [{ id: 'solstice_crossing', step: 0, counts: [0], since: <today> }], done: {}, unlocks: [], seen: [], skipped: [] }`. **A NULL or garbage `quests` column reads as `newQuestSave()`, with no write**: every adventurer, new or from Plans 1–5, has the main quest at its first step from its first join (Decisions).
- **Repair on read** (`parseQuests(v, today) → { save; repaired }`, never throws):
  - unknown quest ids, unknown `done` keys and duplicate actives are dropped;
  - `step` is clamped to the quest's steps; `counts` gets one entry per objective of that step, each an integer clamped to 0..`min(n, QUEST_COUNT_MAX)`;
  - a once-quest that is both done and active loses the active entry;
  - the main quest is always either active or done; if neither, it is added at step 0;
  - `unlocks` keeps only strings some quest's reward names; lists are capped (oldest dropped);
  - anything changed sets `repaired: true` (the room writes it back once on join, like `inventoryRepaired`).

### Story landmarks (`shared/src/story/spots.ts`)

`NpcId = 'marrow' | 'pim' | 'bram' | 'tamsin' | 'nell'`; `PropId = 'plaque' | 'waymark_1' | 'waymark_2' | 'waymark_3' | 'crater_edge'`.

| id | name (as shown) | zone | where (before the placement rule) | facing |
|---|---|---|---|---|
| `marrow` | Old Marrow | grove | (−3.3, −6.4), the offline demo's anchor | toward `SPAWN` |
| `pim` | Pim, the figurehead | grove | `pimGround()`: `TAVERN + fwd × (TAVERN.d / 2 + 2.6)`, `fwd = (sin TAVERN_YAW, cos TAVERN_YAW)`: the ground below the tavern door (the figurehead itself is the offline town's mesh above it) | `TAVERN_YAW + π` |
| `bram` | Bram, the tavern keeper | grove | `pimGround() + (2.2, 1.2)` | toward Pim's spot + π |
| `tamsin` | Tamsin, the ferrywoman | grove | `BEACON_DIR × (DOCK_START − 2) + (−BEACON_DIR.z, BEACON_DIR.x) × 2` (the landward end of the dock, on ground; layout.ts's unexported `PERP`) | `atan2(BEACON_DIR.x, BEACON_DIR.z)` |
| `nell` | Nell Thistlewood, the road-keeper | greenway | `entry + 6 m along entry.facing + 2.5 m to its left` | toward `entry` |

| id | name | zone | where (before the rule) |
|---|---|---|---|
| `plaque` | The plaque | grove | (0, −5.3), the offline demo's `statuePlinth` anchor |
| `waymark_1` | An old waymark | greenway | `x = westGate.x + 0.30 × (mouth.x − westGate.x)`, `z = roadZ(x) + 4` |
| `waymark_2` | An old waymark | greenway | the same at 0.55 |
| `waymark_3` | An old waymark | greenway | the same at 0.80 |
| `crater_edge` | The crater's edge | greenway | `x = mouth.x − 7`, `z = roadZ(x) − 3.5` |

**Placement rule** (deterministic, tested, recorded in a snapshot):
- each spot must stand on its zone's walkable ground (`zoneDef(zone).ground(x, z) !== null`), at least 1.0 m from every obstacle's edge;
- grove spots at least 3 m from the Guild Board, every stall in `TOWN_STALLS` and every other NPC or prop, and outside the statue's plinth (`PLINTH_R`) by 0.5 m;
- Greenway spots at least 12 m from every camp centre (camp r 9 + 3), at least 4 m outside the crater mouth's exit circle (`LAMPFALL_MOUTH.r`) and the west gate's, and at least 3 m from each other;
- a spot that fails is searched outward in rings of 0.5 m (up to 6 m), 16 directions per ring starting at +x and turning anticlockwise; the first spot that passes is used. A spot with none fails the test (a ruling, never a silent move).

`STORY_NPCS: Readonly<Record<NpcId, { id; name; zone: SaveZoneId; x; z; facing; giver: QuestId[] }>>` and `STORY_PROPS: Readonly<Record<PropId, { id; name; zone: SaveZoneId; x; z }>>` are computed lazily (the Greenway layout is generated on first use, like `LAMPFALL_MOUTH`) and deeply frozen. `npcAt(zone, x, z, fuzz)` and `propAt(zone, x, z, fuzz)` return the nearest within reach, or null.

### Objectives, steps and rewards (`shared/src/quests.ts`)

```ts
export type QuestId = 'solstice_crossing' | 'keepers_lamp' | 'bristle_bounty' | 'grans_waymarks';
export type QuestAction = 'finisher' | 'combo' | 'dodge' | 'pick';
export type Objective =
  | { k: 'talk'; npc: NpcId }                                   // a `quest { act: 'talk' }` in reach
  | { k: 'use'; prop: PropId }                                  // a `quest { act: 'use' }` in reach
  | { k: 'reach'; zone: ZoneId; x?: number; z?: number; r?: number }   // being in a zone, or in a circle of it
  | { k: 'jump' }                                               // an accepted pose ≥ JUMP_MIN_M above the surface
  | { k: 'job' }                                                // an accepted `job` (any job, the current one too) or `loadout`
  | { k: 'kill'; kinds: readonly EnemyKindId[] | 'any'; n: number; party?: true }   // party: only a kill that also credits a party member
  | { k: 'act'; what: QuestAction; n: number }                  // from the engine's fx (see Events)
  | { k: 'equip'; slot: GearSlot; tierMin: 1 | 2 | 3 };         // an applied equip of an item of at least that tier
export interface QuestReward {
  xp?: number;                     // to the current job (addJobXp; catch-up does not apply)
  gold?: number;
  item?: ItemId;                   // a fixed item
  choice?: readonly ItemId[];      // one of these, chosen by index in the talk that completes the step
  title?: string;                  // the keepsake title (Store.addTitle)
  unlock?: string;                 // e.g. 'home:starter_cottage' (Plan 8 reads it)
}
export interface QuestStep {
  id: string;                      // unique within its quest
  objectives: readonly Objective[];
  /** All objectives (default), or any one of them. */
  mode?: 'all' | 'any';
  optional?: true;                 // may be skipped from the journal (no reward then)
  reward?: QuestReward;            // given in the write that completes the step
  /** A scene the owner's client plays on completion. */
  scene?: 'beacon' | 'crater';
}
export interface QuestData {
  id: QuestId; name: string;
  kind: 'main' | 'side' | 'daily' | 'epilogue';
  /** Who offers it (accept in reach), or null: offered anywhere once its prerequisite is met. */
  giver: NpcId | null;
  /** Offered only once the main quest has reached this step (or is done). */
  after?: { quest: QuestId; step: string };
  steps: readonly QuestStep[];
}
export const QUESTS: Readonly<Record<QuestId, QuestData>>;
export const QUEST_IDS: readonly QuestId[];
```

**The Solstice Crossing** (`solstice_crossing`, main; active from the first join; cannot be abandoned):

| # | step id | objectives (mode) | reward | scene | teaches |
|---|---|---|---|---|---|
| 0 | `marrow` | talk `marrow` | 20 xp | — | walking (joystick, WASD, tap-to-walk) |
| 1 | `pim_find` | reach grove, circle `pimGround()` r 6 | — | — | finding a place |
| 2 | `pim_hop` | jump | — | — | jumping |
| 3 | `pim` | talk `pim` | 20 xp | — | talking |
| 4 | `plaque` | use `plaque` | 30 xp | `beacon` | props; the story beat |
| 5 | `board` | job | 20 xp | — | the Guild Board, choosing a job or its picks |
| 6 | `gate` | reach `greenway` | — | — | travel |
| 7 | `nell` | talk `nell` | 20 xp | — | — |
| 8 | `first_fight` | kill `['thornling']` n 3; act `finisher` n 1; act `combo` n 1; act `dodge` n 1 (all) | 60 xp, 10 gold | — | targets, Momentum, a finisher, a combo, a dodge roll |
| 9 | `picks` | act `pick` n 2 | 20 xp | — | the two picks |
| 10 | `duo` | kill `'any'` n 1 `party`; kill `['mossback']` n 1 (any); **optional** | 60 xp, 15 gold | — | grouping up (or an elite alone) |
| 11 | `nell_report` | talk `nell` | 40 xp, 40 gold, choice of `mossweave_chest`, `thornrunner_chest`, `rootbound_chest` | — | armour types |
| 12 | `equip` | equip `chest` tierMin 1 | 20 xp | — | gear |
| 13 | `crater` | use `crater_edge` | 40 xp, 30 gold, title **Witness of the Crossing**, unlock `home:starter_cottage` | `crater` | the Lampfall (pointed at, never required) |

Totals: **330 xp** (a level 1 job reaches level 3 and is a third of the way to 4, before kill xp), **95 gold** and a T1 chest piece (Smithy price 80). With the kills on the way (3 Thornlings, perhaps a Mossback: 30–70 xp), a new adventurer ends the quest at level 3–4, in time for Plan 5's band L2 ("the Mossback is a wall until about level 5 in T1").

**The Keeper's Lamp** (`keepers_lamp`, epilogue; `giver: null`, `after: solstice_crossing` done; offered on the completion sheet and in the journal; may be abandoned and taken again until done; once):

| # | step id | objectives | reward |
|---|---|---|---|
| 0 | `descend` | reach `lampfall` | — |
| 1 | `hound` | kill `['wickhound']` n 1 | 60 xp |
| 2 | `keeper` | kill `['fallen_warden']` n 1 | 100 xp, 50 gold |

(Plan 4's Seals, titles and Plan 5's loot for these kills are unchanged; the quest's reward comes on top.)

**Bristle Bounty** (`bristle_bounty`, daily; giver `bram`; `after: solstice_crossing` step `gate`):

| # | step id | objectives | reward |
|---|---|---|---|
| 0 | `boars` | kill `['boar']` n 6 | — |
| 1 | `bram` | talk `bram` | 50 xp, 20 gold |

Accepting it again is refused `'done-today'` on the UTC day it was last completed (`done.bristle_bounty.day`). It may be abandoned (progress lost) and taken again the same day if it was not completed that day.

**Gran's Waymarks** (`grans_waymarks`, side; giver `tamsin`; `after: solstice_crossing` step `gate`; once):

| # | step id | objectives | reward |
|---|---|---|---|
| 0 | `stones` | use `waymark_1`; use `waymark_2`; use `waymark_3` (all) | — |
| 1 | `tamsin` | talk `tamsin` | 60 xp, 25 gold |

### Events and acts

**Events** (`QuestEvent`, produced by the server only; applied by `applyQuestEvents(save, events, ctx)`):

```ts
export type QuestEvent =
  | { e: 'kill'; kind: EnemyKindId; key: string; party: boolean }    // key = Plan 5's killKey; party: a party member was also credited
  | { e: 'reach'; zone: ZoneId; x: number; z: number }
  | { e: 'jump' }
  | { e: 'job' }
  | { e: 'act'; what: QuestAction }
  | { e: 'equip'; slot: GearSlot; item: ItemId };
```
- Each event advances every matching objective of every active quest's **current step** (so one kill can count for the main quest and a side quest at once). A kill key already in `seen` is ignored; a counted kill's key is appended to `seen`.
- When a step's objectives are met (all, or any one in `'any'` mode), the step completes: its reward is collected, the quest moves to the next step with fresh counts, and an event never carries over into the next step (a fourth Thornling kill does not count toward `picks`).
- A completed last step completes the quest: it leaves `active`, and `done[id]` gets `{ day, times: times + 1, choice? }`.
- `questCares(save, ev)` is a cheap pure check (does any active current step have an objective this event could advance?). The room drops events it does not care about **before** queueing them, so irrelevant kills, jumps and dodges cost no write.
- **Where the acts come from** (Task 4): `finisher` = an fx `use` whose `src` is the adventurer and whose `ability` is `JOBS[current].bar[1]`; `pick` = an fx `use` whose ability is one of the current picks; `combo` = an fx `hit` with `src` the adventurer and a non-empty `combo`; `dodge` = an fx `dodge` with `src` the adventurer while its `SelfView.inCombat` is true. A pick or finisher used outside a fight still counts (the tracker asks for them in a fight; the server is lenient on purpose).

**Acts** (`QuestAct`, the client's `quest` message; applied by `applyQuestAct(save, act, ctx)`):

```ts
export type QuestAct =
  | { act: 'talk'; npc: NpcId; choice?: number }
  | { act: 'use'; prop: PropId }
  | { act: 'accept'; quest: QuestId }
  | { act: 'abandon'; quest: QuestId }
  | { act: 'skip'; quest: QuestId };           // the current step, only when it is optional
export type QuestRefusal = 'where' | 'busy' | 'dead' | 'unknown' | 'requires' | 'done' | 'done-today' | 'active' | 'full' | 'main' | 'not-optional' | 'choice' | 'bag-full' | 'rate';
export const QUEST_TEXT: Readonly<Record<QuestRefusal, string>>;   // one plain English line each (below)
export interface QuestCtx { zone: ZoneId; x: number; z: number; day: string; dead: boolean; busy: boolean; bagFree: number }
```
- `talk`: the NPC must be in `ctx.zone` within `NPC_REACH + REACH_FUZZ` (else `'where'`). It completes a `talk` objective for that NPC on any active quest's current step (main quest first, then in `active` order). When the step's reward has a `choice`, `choice` must be an integer index into it (else `'choice'`), and the bag needs a free slot (`ctx.bagFree ≥ 1`, else `'bag-full'`: a quest reward is never sold). A talk that completes nothing is not refused: it is `'none'` (the client shows the NPC's idle lines; nothing is written).
- `use`: as `talk`, with `PROP_REACH + REACH_FUZZ`.
- `accept`: the quest exists (`'unknown'`), is not active (`'active'`), is not a done once-quest (`'done'`), not a daily done today (`'done-today'`), its `after` is met (`'requires'`), the giver is in reach when it has one (`'where'`), and `active` has room (`'full'`).
- `abandon`: never the main quest (`'main'`); the quest must be active (`'unknown'`). Its progress is dropped. Nothing it already paid is taken back, and nothing is paid twice: rewards are only ever given by completing a step for the first time in a run, and once-quests are never offered again after they are done.
- `skip`: the current step must be optional (`'not-optional'`); it moves on with no reward and records `skipped`.
- Every act also needs: alive (`'dead'`), not travelling and not inside a sealed boss arena (`'busy'`). Talk, use and accept are allowed in combat (talking mid-fight is the player's own risk); abandon and skip too.

**Refusal lines** (`QUEST_TEXT`):

| reason | line |
|---|---|
| `where` | You need to be closer. |
| `busy` | Not right now. |
| `dead` | You can't do that while you're down. |
| `unknown` | That quest isn't here. |
| `requires` | You're not ready for that one yet. |
| `done` | You've already done that one. |
| `done-today` | Come back tomorrow for that one. |
| `active` | You're already on that quest. |
| `full` | Your journal is full: finish or drop a quest first. |
| `main` | The Solstice Crossing can't be dropped. |
| `not-optional` | That step can't be skipped. |
| `choice` | Pick one of the rewards first. |
| `bag-full` | Make room in your bag first. |
| `rate` | Slow down a little. |

### Rewards

`grantQuestRewards(s: InvState, quests: QuestSave, done: readonly StepDone[], job: JobId) → { state: InvState; dGold: number; xp: number; given: QuestGiven[] } | { refusal: 'bag-full' }`:
- `StepDone = { quest: QuestId; step: number; times: number; choice: number | null }`;
- for each completed step in order: gold and the item (fixed or chosen) go through Plan 5's `addLoot(state, item, gold, key)` with `key = q:${quest}:${step}:${times}` (so a replayed task is a dup and gives nothing); the bag needs room for an item, else the whole act is refused `'bag-full'` before anything is written (an event-completed step with an item never exists in this slice's data, and a test pins that);
- xp: the sum of the steps' xp, added with `addJobXp(state.jobs, job, xp)` into the write's `jobs`;
- titles and unlocks: collected into `given` (the title is added by the room after the write lands; the unlock is in the quest save itself).

`QuestGiven = { quest; step; stepId; xp; gold; item: ItemId | null; title: string | null; unlock: string | null; scene: 'beacon' | 'crater' | null; questDone: boolean }`.

### Messages (`shared/src/messages.ts`)

```ts
C2S: quest: QuestAct;
S2C: quests: QuestsView;               // to the owner only: a step after joining (like jobs and inventory), and after every quest change
     questDone: QuestGiven;            // to the owner only: one per completed step (the completion moment)
     questRefused: { act: QuestAct['act'] | null; reason: QuestRefusal | 'save'; text: string };
```
```ts
export interface QuestsView {
  active: { id: QuestId; step: number; counts: number[] }[];   // the data (QUESTS) gives names, objectives and n
  done: { id: QuestId; times: number; today: boolean }[];
  offers: QuestId[];                                            // accept-able now if in reach of the giver (prerequisites met, not active, not done / done today)
  skipped: string[];
}
export function questsView(s: QuestSave, day: string): QuestsView;
```
A `quests` view is under 300 bytes for this slice's four quests; it is sent only when it changed (the room compares the encoded view with the last one sent to that session).

### Gold and time (for the owner; not tuned)

- The main quest takes about **20–30 minutes** for a new player: about 6 in town (the walk to the tavern and back, the Beacon scene, the board), 2–3 on the road, 6–10 for the first fight and picks, 3–8 for the optional duo step, 2–3 for the report, the equip and the crater.
- It pays 95 gold and an 80-gold chest piece: together about a third of Plan 5's 485-gold T1 kit. Plan 5's Greenway rate is 6–8 gold a minute, so the quest pays about the same per minute as fighting, front-loaded so the first purchase comes sooner.
- The daily Bristle Bounty pays 20 gold and 50 xp for about 5 minutes; Gran's Waymarks 25 gold and 60 xp once.
- Nothing in the quests sells for more than its Plan 5 sell value, and no quest reward can be farmed (once-quests, a daily cap, kill keys).

## Story text (Task 2 writes it into `shared/src/story/lines.ts` exactly as below)

Tone: warm, a little wry, short lines that read well on a phone. Ellie and Felix are legend only. `{job}` is replaced by `JOBS[current].name`; `{item}` by `ITEMS[id].name`. Touch and desktop variants of a hint are marked (touch / desktop); the client picks by `matchMedia('(pointer: coarse)')`.

### Old Marrow (keeper of the statue; old, kind, fond of the Two)

`marrow` step (the quest's opening, also shown as the first dialogue after the creator):
1. "Ah, there you are. Mind the plinth, it has outlasted better boots than yours."
2. "Seventy years those two have pointed at that empty patch of sky. Every solstice I say: this is the year."
3. "Every solstice, nothing. Still. Fair winds to the Two."
4. "Today feels different, though. Pim has been muttering since dawn. Go and ask him why."
5. "He's the figurehead over the tavern door. Follow the street toward the river."

Hint on completion — touch: "Drag on the left of the screen to walk, or tap the ground to walk there." desktop: "Walk with WASD, or click the ground to walk there."

Idle menu (any time; choices "Who were Ellie and Felix?", "What is this place?", "What should I do now?", "Goodbye"):
- Ellie and Felix: "The greatest adventurers Shady Grove ever raised. Ellie found the way; Felix made it possible." / "She never went anywhere without a charcoal stick and a half-drawn map. He mended whatever she broke, and could talk a frightened town into courage." / "When the sky-lands tore loose and drifted off, they built a ship that could sail the wind and went up after them. Nobody here calls them lost."
- This place: "Shady Grove. The very same one. Those old trees were shading this square before either of them could walk." / "The east road runs all the way to Normandy, the capital, and the world is a hundred times wider than folk here think."
- What now: the current main step's hint line (below), spoken by Marrow; after the quest: "Go and see what's in that crater, if you must. Bring a friend back with you."

After the plaque (the `beacon` scene; Marrow speaks before and after it):
- before: "Wait. Look at the spyglass. The bronze is humming!"
- after: "Seventy years. They were pointing at something after all." / "And did you see that? Something fell from it. Out east, past the gate, into the Greenway." / "Don't go out there with empty hands. Visit the Guild Board first and choose a trade."

### Pim, the figurehead (the carved figurehead of the Two's old ship, over the tavern door; cheeky, proud)

On reaching the tavern (`pim_find` done; a client line, no server act): "Up here! No, higher. Give a hop, so I can see your face over the rail."

Hint for `pim_hop` — touch: "Tap Jump to hop." desktop: "Press Space to jump."

`pim` step:
1. "There you are. Psst. Don't tell Bram I can talk, he'll want rent."
2. "I sailed with them, you know. Ellie at the bow, Felix at the helm, me out front looking magnificent."
3. "Every solstice the sun slides behind Felix's spyglass. Every year, nothing happens."
4. "But the bronze has been warm since dawn. I can feel it in my varnish."
5. "Go and read their plaque. Something wants waking."

Idle, before the Beacon: "Go on, the plaque. I'd go myself, but I'm nailed to a tavern." After the Beacon: "They did it. They actually did it! Find us a ship. Ellie always hated being kept waiting."

### The plaque (narration)

`plaque` step: "ELLIE and FELIX. The Two." / "“She found the way. He made it possible.”" / "Raised by the grateful people of Shady Grove. Fair winds."

Idle (after the step): the same three lines.

### The Guild Board (`board` step; hints only, no speaker)

- On the step's start: "Every adventurer needs a trade. Tap the Guild Board by the statue to choose a job."
- In the job sheet's header while the step is active: "Choose a job, or keep your {job} and choose its two picks. Jobs change only in towns and safe camps."
- On completion: "Your trade is set. You can come back to the board whenever you're in town."

### The east gate (`gate` step)

- On the step's start: "The Greenway lies past the east gate. Follow the road out of town."

### Nell Thistlewood (keeps the Greenway road; practical, dry, quietly brave)

`nell` step:
1. "Hold there. You came out of Shady Grove at a run, so you saw it too."
2. "I'm Nell. I keep this road. Something came down through the trees at sunrise and left a hole the size of a barn."
3. "I'll show you where. But the Thornlings are stirred up, and I won't walk anyone past them who can't hold their own."
4. "Tap a Thornling to target it. Your blows build Momentum. Spend it on your finisher, the second button."
5. "A finisher leaves a mark. Set it off with a different one and you've got a combo."
6. "Some of their swings glow on the ground first. When it glows under you, roll out."

Hints for `first_fight` (one per objective, shown as the tracker's sub-line when tapped):
- kill: "Tap a Thornling, then stay close. You attack by yourself."
- finisher: "When your Momentum bar is half full, press your finisher (button 2, or key 2)."
- combo: "Finisher marks a foe; a second, different finisher on that mark is a combo."
- dodge — touch: "Tap Dodge, or double-tap a direction, to roll." desktop: "Press Shift to roll."

`picks` step start: "Buttons 4 and 5 are your picks. Use both in a fight. You can change them out of a fight from the job board." On completion: "Good. Pick what suits the fight; nobody here will judge you."

`duo` step start: "Two lanterns are brighter than one. Tap another adventurer and invite them, then fight together. Or, if you're bold, take down a Mossback alone." On completion: "Not bad. Not bad at all." Journal note on the Skip button: "Skip this step (no reward)".

`nell_report` step:
1. "You'll do. Better than do, even."
2. "Here. The smiths in town send me spares for anyone who's earned them. Pick what suits you."

Choices (labels; the server receives the index): "{item} — cloth: stronger abilities" (Mossweave Robe), "{item} — light: faster Momentum" (Thornrunner Jerkin), "{item} — heavy: they come for you, not your friends" (Rootbound Hauberk).

After the choice: "Put it on before we go any further. Gear in a bag protects nobody."

`equip` hint — touch: "Open your bag and tap the new piece, then Equip." desktop: "Press I for your bag, tap the new piece, then Equip." On completion: "That suits you. Now, the crater. Follow the road east."

Idle after the quest: "Whatever's down there was built to last. If you go, take a friend. I'd take two."

### The crater's edge (narration; `crater` step)

1. "The road ends in a raw scar of earth. Roots hang over the edge like torn rope."
2. "Far below, something glows: a lamp, still lit, swinging slowly in the dark."
3. "Once, very faintly, a bell tolls. Then again, as if it were counting ships that never come."

Completion banner: "Quest complete" / "The Solstice Crossing". Title toast: "New title: Witness of the Crossing". Then the epilogue offer card: "The Keeper's Lamp — Climb down into the Lampfall and find what fell. Best with friends." Buttons "Accept" and "Not now".

### The Keeper's Lamp (epilogue; tracker lines)

`descend` "Climb down into the Lampfall"; `hound` "Defeat the Wickhound"; `keeper` "Defeat the Fallen Warden". Completion line (narration): "The lamp steadies. For a moment its beam points the same way as Ellie's arm."

### Bram (the tavern keeper; hearty)

Idle: "Welcome to the Second Chance. Named for their ship, same as the figurehead over my door." / "Don't mind old Pim up there. Carved wood. Hasn't said a word in seventy years, whatever the children tell you."

Offer (Bristle Bounty; choices "I'll do it", "Not today"): "Bramble Boars have been rooting up my hop rows by the east road." / "Six of them, and I'll stand you a purse and a pie."

While active: "Six boars. I'm counting, and so are the hops."

`bram` turn-in: "Six! The hops thank you." / "The pie's in the purse. Don't ask how."

Done today: "Same again tomorrow? Those boars never learn."

### Tamsin (the ferrywoman; dry humour, misses her gran)

Idle before the Beacon: "No ferry today, friend. The river is running high, and the road to Normandy is a long one on foot." / "My gran swore there was land up where the statue points. In the sky! Gran also swore gulls could read."

Idle after the Beacon: "Well. There is an island. In the sky. I am going to need a much better boat."

Offer (Gran's Waymarks; choices "I'll find them", "Not now"): "Gran left marks along the old road. Stones with an arm carved on them, all pointing up." / "Would you find three for me? I'd like to know she was right."

Waymarks (narration): 1 "A mossy stone. Someone carved an arm into it, pointing at the sky. Under it, a single letter: T." 2 "Another arm, cut deeper. Beside it, a little boat with wings." 3 "The last stone. The arm points straight at the island you can see now. Beneath it: fair winds."

`tamsin` turn-in: "All pointing the same way. She knew. Of course she knew." / "Here, for your boots. Gran would have liked you."

### Tracker lines (`QUEST_LINES[quest][stepId]`; objectives in order)

| quest | step | line(s) |
|---|---|---|
| solstice_crossing | marrow | Speak with Old Marrow |
| | pim_find | Find the voice above the tavern |
| | pim_hop | Hop so Pim can see you |
| | pim | Talk to Pim |
| | plaque | Read the plaque on the statue |
| | board | Choose a job at the Guild Board |
| | gate | Leave by the east gate |
| | nell | Meet the road-keeper |
| | first_fight | Defeat Thornlings {c}/3 · Spend Momentum on a finisher · Land a combo · Dodge roll in a fight |
| | picks | Use your picks in a fight {c}/2 |
| | duo | Win a fight in a party · or defeat a Mossback (optional) |
| | nell_report | Report to Nell |
| | equip | Equip your new chest piece |
| | crater | Look into the crater |
| keepers_lamp | descend / hound / keeper | Climb down into the Lampfall · Defeat the Wickhound · Defeat the Fallen Warden |
| bristle_bounty | boars / bram | Defeat Bramble Boars {c}/6 · Tell Bram |
| grans_waymarks | stones / tamsin | Find the old waymarks {c}/3 · Tell Tamsin |

(For `stones`, `{c}` is the number of the three `use` objectives done.)

Journal blurbs (one line per quest): solstice_crossing "The Two have pointed at an empty sky for seventy years. Today, something answered."; keepers_lamp "Something fell from the Beacon into the Greenway. It is still burning."; bristle_bounty "Bram's hops are under siege. Bram would like them not to be."; grans_waymarks "Tamsin's gran left marks along the old road, all pointing up."

## Review Focus

1. **Duplication and races.** Each ends with every reward given exactly once and gold conserved (Δ = loot + sales − purchases + quest gold). → Tasks 1, 3, 4.
   - the same `talk` sent 20 times in one tick, and from two tabs (Plan 1's single-session rule);
   - a disconnect right after the completing talk (the write lands once or not at all; the next join shows the truth);
   - a relog between a step's last kill and its write;
   - a kill processed twice, and the same kill credited through the party share and the engine's credit at once (one count);
   - a stale `inv_version` (a Seal or a loot write in between): retried on the fresh truth, never written as computed;
   - abandon and retake a daily on the same day after completing it (refused `'done-today'`); abandon and retake the epilogue (no double reward: its rewards come only from completing steps);
   - completing a step while the bag is full (refused `'bag-full'`, nothing written);
   - xp: a kill landing between the reward task's run and its write: both xp amounts end up in the session's jobs and in the store.
2. **Never trust the client.** Each is refused with the right `QuestRefusal` and no change. → Tasks 1, 4.
   - forged NPC, prop and quest ids, junk types, NaN, negative or huge choice indexes, long strings, extra fields;
   - talking to Marrow from the Greenway or 10 m away; using the plaque from the tavern; accepting Bram's bounty from the Greenway;
   - a client that sends poses near Pim while the server corrected it elsewhere (the server uses `lastGood`, never the message);
   - a forged `jump` (there is no such message; only accepted poses count), a pose refused for being too high (does not count);
   - skipping a non-optional step; abandoning the main quest;
   - 30 `quest` messages a second (`'rate'` after 4).
3. **Party fairness.** A duo where only one deals the killing blow: both count the kill; a member 70 m away (beyond `PARTY_SHARE_R`) does not; a stranger who tagged for 2% does not (`MIN_CREDIT_FRAC`); members on different steps each count toward their own; the `duo` step completes for both members of a party on it. → Task 4.
4. **Bandwidth and interest.** No new `ZoneState`/`PlayerState` field. `quests` and `questDone` go only to their owner, `quests` only when changed. The clustered grove run stays within +0.1 KiB/s. → Tasks 4, 7.
5. **Migration.** A Plan 5 row (NULL `quests`) reads as the main quest at step 0 with no write; garbage `quests` JSON reads repaired and is written back once; a row with the quest done keeps it done and gets its title back if missing. → Tasks 1, 3, 4.
6. **Teaching order.** The main quest's steps run in the order the brief asks (move and jump, board and job, fight: target, Momentum, finisher, combo, dodge; picks; grouping; gear; the Lampfall pointed at). Every step is completable solo (the duo step is optional and has a solo route). → Tasks 1, 2, 7.
7. **Phone layout.** The tracker, pointer, journal and dialogue never cover the ability grid or the fight. → Task 6.

---

### Task 1: Shared quest rules: types, the four quests, save and repair, events and acts, rewards, views, messages; story spots

**Files:**
- Create:
  - `shared/src/quests.ts` (types, `QUESTS`, `QUEST_IDS`, limits, `newQuestSave`, `parseQuests`, `isQuestSave`, `questCares`, `applyQuestEvents`, `applyQuestAct`, `grantQuestRewards`, `questsView`, `parseQuestAct`, `QUEST_TEXT`, `questStepOf`);
  - `shared/src/story/spots.ts` (`NpcId`, `PropId`, `STORY_NPCS`, `STORY_PROPS`, `pimGround`, `npcAt`, `propAt`, `STORY_RULE`, `searchStorySpot`);
  - `shared/src/quests.test.ts`, `shared/src/story/spots.test.ts`, `shared/src/story/__snapshots__/` (spots).
- Modify:
  - `shared/src/messages.ts` (`quest`, `quests`, `questDone`, `questRefused`);
  - `shared/src/index.ts` (exports).

**Interfaces:**
- Consumes: Plan 5's `addLoot`, `bagUsed`, `BAG_SLOTS`, `ITEMS`, `isItemId`, `InvState`, `GearSlot`; Plan 3b/5's `addJobXp`, `JOBS`, `JobId`; `zoneDef`, `greenwayLayout`, `LAMPFALL_MOUTH`, `GUILD_BOARD`, `TOWN_STALLS`, `TAVERN`, `TAVERN_YAW`, `BEACON_DIR`, `DOCK_START`, `PLINTH_R`, `SPAWN`, `findPath` (the reachability test).
- Produces (all as under Numbers), plus:
```ts
// quests.ts
export function newQuestSave(day: string): QuestSave;
export function parseQuests(v: unknown, day: string): { save: QuestSave; repaired: boolean };
export function isQuestSave(v: unknown): v is QuestSave;          // parseQuests would change nothing
export function questCares(s: QuestSave, ev: QuestEvent): boolean;
export interface StepDone { quest: QuestId; step: number; times: number; choice: number | null }
export function applyQuestEvents(s: QuestSave, evs: readonly QuestEvent[], day: string): { save: QuestSave; done: StepDone[]; changed: boolean };
export type QuestActResult = { save: QuestSave; done: StepDone[]; changed: boolean } | { none: true } | { refusal: QuestRefusal };
export function applyQuestAct(s: QuestSave, act: QuestAct, ctx: QuestCtx): QuestActResult;
export function grantQuestRewards(s: InvState, done: readonly StepDone[], job: JobId): { state: InvState; dGold: number; xp: number; given: QuestGiven[] } | { refusal: 'bag-full' };
export function questsView(s: QuestSave, day: string): QuestsView;
export function parseQuestAct(v: unknown): QuestAct | null;      // strict: exact keys, known ids, a choice an integer 0..7
export function questStepOf(s: QuestSave, id: QuestId): QuestStep | null;   // the current step of an active quest
// spots.ts
export function pimGround(): { x: number; z: number };
export const STORY_RULE: { npcClear: 1; storyGap: 3; plinthPad: 0.5; campGap: 12; exitPad: 4; ring: 0.5; maxR: 6; dirs: 16 };
export function npcAt(zone: ZoneId, x: number, z: number, fuzz?: number): NpcId | null;
export function propAt(zone: ZoneId, x: number, z: number, fuzz?: number): PropId | null;
```
- **Rules:** as under Numbers. `applyQuestEvents` and `applyQuestAct` never change their inputs. `QUESTS` is deeply frozen; every `QuestStep.id` is unique within its quest; every `choice` item is a T1 chest (`ITEMS[id].slot === 'chest'`, tier 1); no event-completed step carries an item (pinned by a test, since `'bag-full'` is checked only on acts).
- **Day:** callers pass the UTC day (`'YYYY-MM-DD'`); nothing in `quests.ts` reads a clock.

- [ ] **Step 1: Write the failing tests.**
  - `quests.test.ts`:
    - `it('every quest: unique step ids, objectives name real NPCs, props, kinds and slots, choices are T1 chests, no event-completed step gives an item')`;
    - `it('the main quest teaches in order: move/talk, jump, talk, plaque, job, gate, fight acts, picks, optional duo, report with a choice, equip, crater')` (asserts the step id order and objective kinds);
    - `it('newQuestSave has the main quest at step 0; NULL and garbage read as it, repaired only for garbage')`;
    - `it('repair: unknown ids, duplicate actives, out-of-range steps and counts, oversize lists, a done once-quest still active')`;
    - `it('a kill counts once per key; a fourth Thornling does not carry into the next step; one kill counts for two quests')`;
    - `it('the duo step completes on a party kill or a Mossback alone, and can be skipped with no reward')`;
    - `it('talk out of reach → where; a talk that completes nothing → none; a choice step without a valid choice → choice; with a full bag → bag-full')`;
    - `it('accept: requires, active, done, done-today, full, where; abandon: main refused, side drops progress')`;
    - `it('the daily pays once per UTC day: complete, abandon-and-retake the same day is refused, the next day is accepted')`;
    - `it('grantQuestRewards: xp to the current job, gold and the chosen item through addLoot with the quest key; a replay is a dup and gives nothing')`;
    - `it('completing the last step: done with times and choice, the title and unlock in given, home:starter_cottage in unlocks')`;
    - `it('questCares is false for events no current step wants (a jump at step 0, a boar during first_fight)')`;
    - `it('parseQuestAct refuses junk: wrong types, NaN, -1, 8, 1e9, unknown ids, extra keys, long strings')`;
    - `it('questsView: offers follow prerequisites and the daily; the view of this slice is under 300 bytes as JSON')`.
  - `spots.test.ts`:
    - `it('pimGround matches the offline town\'s pim anchor to 1e-9')` (recomputes `town.ts`'s formula in the test from the shared constants);
    - `it('every NPC and prop passes the placement rule and is reachable from its zone\'s spawn by findPath')`;
    - `it('the chosen spots are stable')` (snapshot of every spot rounded to 0.01 m);
    - `it('npcAt and propAt: in reach, out of reach, the wrong zone, the nearest of two')`.
- [ ] **Step 2: Run `npx vitest run shared/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Commit the types and stubs first (`feat: quest types`) as soon as `npm run typecheck` is clean. Then the data, the rules and the spots.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: the quest rules: The Solstice Crossing, its epilogue and two side quests, saves, events, acts and rewards; story landmarks`.

### Task 2: Shared story text: every dialogue line, tracker line, hint and journal blurb

**Files:**
- Create: `shared/src/story/lines.ts`, `shared/src/story/lines.test.ts`.
- Modify: `shared/src/index.ts` (exports).

**Interfaces:**
- Consumes: Task 1's types (`QuestId`, `NpcId`, `PropId`, `QUESTS`).
- Produces:
```ts
export interface Say { speaker: string; lines: readonly string[]; choices?: readonly string[] }
export type Device = 'touch' | 'desktop';
export const NPC_NAMES: Readonly<Record<NpcId, string>>;            // as in the spots table
export const QUEST_NAMES: Readonly<Record<QuestId, string>>;        // The Solstice Crossing, The Keeper's Lamp, Bristle Bounty, Gran's Waymarks
export const QUEST_BLURBS: Readonly<Record<QuestId, string>>;
export const QUEST_LINES: Readonly<Record<QuestId, Readonly<Record<string, readonly string[]>>>>;   // step id → one line per objective
/** The lines an NPC says now, for this adventurer's quests: the step's talk, an offer, an in-progress line, a turn-in, or idle. */
export function npcSay(npc: NpcId, view: QuestsView, ctx: { beacon: boolean; job: string; device: Device }): Say;
export function propSay(prop: PropId, view: QuestsView): Say;
/** The current step's hint (and per-objective hints), with device variants resolved. */
export function stepHint(quest: QuestId, stepId: string, device: Device): { line: string | null; objectives: readonly (string | null)[] };
export const BEACON_LINES: { before: Say; after: Say };
export const CRATER_LINES: Say;
export const COMPLETE_TEXT: { banner: [string, string]; title: (t: string) => string; offer: Say };
export const LINE_MAX = 140;   // re-exported from quests.ts
```
- **Text:** exactly the "Story text" section of this plan. `npcSay` picks, in order: the current step's `talk` lines for that NPC; a turn-in; an offer (with its two choices) when the NPC gives an offered quest; the in-progress line; idle (with Marrow's menu). Marrow's "What should I do now?" answers with `stepHint` of the main quest's current step.

- [ ] **Step 1: Write the failing tests** in `lines.test.ts`:
  - `it('every step of every quest has tracker lines, one per objective')`;
  - `it('every talk step has lines for its NPC; every use step has lines for its prop; every offer has two choices')`;
  - `it('no line is longer than LINE_MAX or empty; no line has markup characters < > or a placeholder left unreplaced')`;
  - `it('Ellie and Felix never speak: no Say has either as its speaker')`;
  - `it('no game text says "player" or "hero"')`;
  - `it('npcSay follows the quest state: Marrow at step 0 gives the opening; Pim before and after the Beacon; Bram offers, counts and turns in; done-today')`.
- [ ] **Step 2: Run `npx vitest run shared/src/story`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Text and selection only.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: the story text of the opening quest, its epilogue and two side quests`.

### Task 3: Server I: migration 008, both stores, `InvWrite.quests`, the queue's snapshot and `landed` hook

**Files:**
- Create: `server/migrations/008_quests.sql`.
- Modify:
  - `server/src/store/types.ts` (`Adventurer.quests`, `questsRepaired`, `InvWrite.quests`, `checkedInvWrite`);
  - `server/src/store/memory.ts`, `server/src/store/pg.ts`, `server/src/store/store.test.ts`;
  - `server/src/rooms/inventoryQueue.ts` (`InvSnapshot.quests`, `TaskOutcome.next.quests`, `InvTask.landed`);
  - `server/src/rooms/ZoneRoom.ts` **only** where `makeQueue`'s `load` builds a snapshot and where existing tasks build `next` (pass `quests: s.quests` through unchanged);
  - `server/src/gm/grant.ts` only if `grantOffline` builds an `InvWrite` (it leaves `quests` absent).

**Interfaces:**
- Consumes: Task 1 (`QuestSave`, `parseQuests`, `isQuestSave`, `newQuestSave`).
- **Migration `008_quests.sql`** (safe to run again):
```sql
-- Plan 6: per-adventurer quest progress (one jsonb). Written only with the inventory (writeInventory, compare-and-set on
-- inv_version), so a quest step and its reward land in one write. NULL: the main quest at its first step (read, not written).
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS quests jsonb;
```
- **Store:**
```ts
export interface Adventurer { /* Plan 5 */; quests: QuestSave; questsRepaired?: true }
export interface InvWrite { /* Plan 5 */; quests?: QuestSave }   // absent: the stored quests are left as they are
```
  - Reads use `parseQuests(row.quests, utcDay(now))`: NULL gives `newQuestSave` **without** `questsRepaired`; anything that needed repair sets `questsRepaired: true`.
  - `writeInventory` writes `quests` when present, in the same statement as the inventory (pg: one `UPDATE … WHERE id = $1 AND inv_version = $2`), and bumps `inv_version` as before. `checkedInvWrite` refuses a `quests` that `isQuestSave` refuses (TypeError).
  - `saveAdventurer`, `awardSeal`, `useFreeLook`, `grantOffline` never touch `quests`.
- **Queue:**
  - `InvSnapshot` gains `quests: QuestSave`; `load` reads it; a landed write's snapshot takes `out.next.quests`;
  - `TaskOutcome`'s `next` becomes `InvState & { look: Look; lookFree: boolean; quests: QuestSave }`;
  - `InvTask` gains `landed?(): void`: called inside the write lock right after `deps.landed`, only when the write landed (also for a session that ended meanwhile), never on a stale or failed write. Task 4 uses it to apply quest xp to the session's live jobs.

- [ ] **Step 1: Write the failing tests** (`store.test.ts`, memory; pg when `TEST_DATABASE_URL` is set):
  - `it('a row with no quests reads as the main quest at step 0, not repaired')`;
  - `it('garbage quests JSON reads repaired')`;
  - `it('writeInventory writes quests in the same compare-and-set: a stale version writes neither inventory nor quests')`;
  - `it('a write without quests leaves the stored quests as they are')`;
  - `it('writeInventory refuses a quests value isQuestSave refuses')`;
  - `it('saveAdventurer, awardSeal, useFreeLook and grantOffline never change quests')`;
  - `it('migration 008 is safe to run twice, and a Plan 5 row reads with its inventory, Seals and look intact')` (pg);
  - in a new `server/src/rooms/inventoryQueue.test.ts` (or the existing queue tests if a file exists): `it('a task\'s landed hook runs once inside the lock when its write lands, before a waiting save; never on stale or failed')`.
  - All earlier store and room tests pass unchanged.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: quest progress saved with the inventory in one compare-and-set write; migration 008`.

### Task 4: Server II: the `quest` message, quest events, rewards, title and home hook, views, `SG2_TEST_QUEST`

**Files:**
- Create:
  - `server/src/rooms/quests.ts` (pure helpers the room calls: `questTask`, `actsFromFx`, `jumpCounts`, `placeEvents`);
  - `server/src/rooms/quests.test.ts` (room tests), `server/src/rooms/questDupes.test.ts`.
- Modify:
  - `server/src/rooms/ZoneRoom.ts`: the `quest` message, the session's quest fields, events from moves, kills, fx, jobs, loadouts, equips and zone entry; the per-step flush; join and reconnect sends; the title; repaired write-back;
  - `server/src/rooms/testHelpers.ts` (`sendQuest(room, act)`, `questsOf(room)`);
  - `server/src/index.ts` and `server/src/index.test.ts` (`SG2_TEST_QUEST`), `server/src/app.ts` (pass it through).

**Interfaces:**
- Consumes: Tasks 1 and 3; Plan 5's queue, `applyLoot`, `lootTask`, `flushLoot`, `settleInv`, `gainXpAmount`, `creditedFor`, `invCtx`, `inSealedArena`; Plan 4's `parties.partyOf`.
- **Session** gains: `questEvents: QuestEvent[]` (≤ `QUEST_EVENTS_PER_STEP`), `questBucket: TokenBucket(QUEST_OPS_PER_S)`, `questWatch: { place: boolean; jump: boolean; acts: boolean; equip: boolean }` (recomputed from the snapshot's quests after every quest change), `questSent: string` (the last `quests` view sent, as JSON), `jumpedAt: number`.
- **Room rules:**
  - **Join:** the snapshot's quests come with the inventory. One step after join (with `jobs` and `inventory`), send `quests`. A `questsRepaired` save is written back once (a task with `quests` only, like the inventory repair). If the main quest is done and the adventurer lacks the title `Witness of the Crossing`, `store.addTitle` (idempotent). Then a `{ e: 'reach', zone, x, z }` event for the room's zone at the join pose.
  - **Reconnect:** `quests` again (like `jobsDue`/`invDue`).
  - **Events** (each pushed only when `questCares`; at most `QUEST_EVENTS_PER_STEP` per step, the rest dropped):
    - **moves:** after a pose is accepted, if `questWatch.place`, a `reach` event when the pose is inside a current step's `reach` circle; if `questWatch.jump`, a `jump` event when `pose.y − zone.surface(x, z) ≥ JUMP_MIN_M` (at most one per 1 s per session);
    - **kills:** in `handle()`, for each credited session (the existing `creditedFor` set, after the boss-arena filter), `{ e: 'kill', kind, key: killKey, party }`, where `party` is true when another member of its party is in the same credited set;
    - **fx:** after each tick, only for sessions with `questWatch.acts`, `actsFromFx(out.fx, eid, job, picks, inCombat)` gives `finisher`, `pick`, `combo` and `dodge` acts as under Numbers;
    - **job:** after an accepted `job` or `loadout` intent, `{ e: 'job' }`;
    - **equip:** inside `onInv`'s task `run`, when the op is `equip` and applied, `applyQuestEvents` runs on `s.quests` with `{ e: 'equip', slot, item }` and its completion and rewards join **the same write** (no second write);
    - **zone:** on join, as above.
  - **The flush:** at the end of each room step, a session's loot awards and quest events go in **one** queue task (`flushLoot` becomes `flushRewards`): `applyLoot`, then `applyQuestEvents`, then `grantQuestRewards` for any completed steps, then one write `{ inventory, jobs, quests, dGold, dSeals: 0 }`. With no loot and no quest change it writes nothing.
  - **`quest` message** (`onQuest`): `parseQuestAct` (null → `questRefused { act: null, reason: 'unknown' }`), the bucket (`'rate'`), then a queue task (`retries: 1`, `recheck: ['bag-full']`): `applyQuestAct` with `QuestCtx` from the server (`zone`, `session.lastGood`, `day`, dead, busy = travelling or in a sealed arena or awaiting a displacement, `bagFree = BAG_SLOTS − bagUsed`), then `grantQuestRewards`, then one write. `{ none }` writes nothing and sends nothing.
  - **Settle** (for both task kinds): on `applied`, `quests` (if the view changed), one `questDone` per completed step (to the owner only), `inventory` when gold or items changed, and `notice`s for any sold or lost gold (Plan 5's texts); for a completed step with a `title`, `store.addTitle(adventurerId, title)` (best effort; the join check repairs it). On `refused`, `questRefused` with `QUEST_TEXT[reason]`. On `stale`/`failed`, `questRefused { reason: 'save', text: INV_SAVE_TEXT }` and the stored truth (`quests`, `inventory`). Plan 5's loot settle is unchanged.
  - **Xp:** the write's `jobs` hold `addJobXp(jobs, job, xp)` computed at run time; the task's `landed` hook calls `gainXpAmount(session, xp)` on the session's live jobs (so kill xp gained meanwhile is kept, and the next save carries both). `jobXp`, `jobs` and `levelUp` go out as for a kill.
  - **Watch sets** are flags on the session, cleared with it: nothing is kept per account in the room.
  - **`SG2_TEST_QUEST=<quest>:<step id>`** (test servers only; never in Docker; `index.test.ts` checks it is off by default and refuses an unknown quest or step): an adventurer whose stored `quests` is NULL starts with every earlier main-quest step done (no rewards) and that quest at that step. Used by the smoke test and bots (for example `solstice_crossing:first_fight` with `SG2_START_ZONE=greenway`).

- [ ] **Step 1: Write the failing tests.**
  - `quests.test.ts` (rooms; memory store; kits on; fixed seed):
    - `it('a new adventurer joins with the main quest at Marrow and gets quests once, a step after join')`;
    - `it('talk to Marrow in reach advances; 10 m away is refused where; from the Greenway is refused where')`;
    - `it('walking to the tavern completes pim_find; a pose the server corrected does not')`;
    - `it('a jump completes pim_hop: a pose 0.8 m above the surface counts, 0.4 m does not, standing on a crate does not')`;
    - `it('the plaque completes with 30 xp and questDone scene beacon, to the owner only')`;
    - `it('choosing the current job at the Guild Board completes board; a loadout change does too')`;
    - `it('travelling to the Greenway completes gate on join')`;
    - `it('first_fight: three Thornling kills, a finisher, a combo and a dodge in a fight, counted from the engine')` (scripted with `killFor` and engine-driven abilities as the combat tests do);
    - `it('a duo: one lands the kill, both count it; a member beyond PARTY_SHARE_R does not; a 2% tagger does not')`;
    - `it('members on different steps each advance their own (main and Bristle Bounty from one boar kill)')`;
    - `it('nell_report with choice 2 gives the Rootbound Hauberk, 40 gold and 40 xp in one write; no choice → choice; full bag → bag-full')`;
    - `it('equipping the chest completes equip in the same write as the equip')` (count `writeInventory` calls: one);
    - `it('the crater completes the quest: title added, unlock home:starter_cottage saved, The Keeper\'s Lamp offered')`;
    - `it('epilogue kills in a Lampfall instance count (Wickhound, Warden)')`;
    - `it('a done quest with the title missing gets it back on join')`;
    - `it('nothing new in the state: the encoded patches carry no quest data; quests messages only to their owner')`;
    - `it('irrelevant kills and jumps cause no extra writes')` (count writes with and without quests in a 50-kill run: equal).
  - `questDupes.test.ts` (Review Focus 1):
    - `it('the completing talk sent 20 times in one tick pays once')`;
    - `it('a second tab sends the same talk mid-queue: paid once')`;
    - `it('a disconnect right after the completing talk: after rejoin store and view agree, paid once')`;
    - `it('the same kill through the engine credit and the party share counts once')`;
    - `it('a stale version from a Seal in between: retried on the truth, paid once')`;
    - `it('a kill landing between the reward task\'s run and its write: both xp amounts end in the session and in the store')`;
    - `it('daily: complete, abandon, accept again the same day → done-today; next day accepted')` (test clock);
    - `it('30 quest messages a second: rate after 4')`.
  - `index.test.ts`: `SG2_TEST_QUEST` is off by default, refuses junk, and sets the start step.
  - All earlier room tests pass unchanged (the lazily-started quest writes nothing until it progresses).
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep every room test under 10 s of real time.
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.** Then on port 2572 (PID noted): the grove bot run (`--count 100 --seconds 30`), then the clustered one (`--cluster 15`): exit 0, ≥ 14 Hz, 0 corrections, KiB/s within +0.1 of the last recorded numbers; the Greenway fight run (`SG2_START_ZONE=greenway`, `--fight --count 100 --seconds 60`): PASS. `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: quests on the server: talk, props, places, jumps, jobs, kills with party share, combat acts and equips, rewarded once in the inventory write`.

### Task 5: Client I: quest NPCs and props in the world, markers over them, the Beacon's state and the falling star (browser-heavy)

**Files:**
- Create:
  - `client/src/world/storyNpcs.ts` (builds the NPCs and props for a zone; markers; entity ids);
  - `client/src/world/storyNpcs.test.ts` (pure parts: ids, marker choice, budgets);
  - `client/dev/story.html` and `client/src/world/storyDev.ts` (a viewer, not part of the build).
- Modify:
  - `client/src/world/index.ts` (`WorldApi.setBeaconRaised(on)`, `WorldApi.fallingStar(): Promise<void>`);
  - `client/src/core/contracts.ts` (the two `WorldApi` methods);
  - `client/src/world/town.ts` (use `pimGround()` from `@sg2/shared` instead of its own formula; the value is unchanged, Task 1's test pins it);
  - `client/src/online.ts` (build the story NPCs on zone load, like `createGuildBoard`).

**Interfaces:**
- Consumes: Task 1 (`STORY_NPCS`, `STORY_PROPS`, `QuestsView`, `QUESTS`), Task 2 (`NPC_NAMES`). **Plan 5 Task 8 (assumed built):** `makeCharacter(scene, { kind: 'npc', look })` with a `Look`; fallback: `makeCharacter(scene, { kind: 'npc', color })` with the offline demo's colours (Marrow default, Tamsin `#3FB0A6`, Bram `#EC6A4C`, Nell `#6E8B3D`).
- Produces:
```ts
export const STORY_EID_BASE = -100;                       // NPC eids -100..-104 (marrow, pim, bram, tamsin, nell), props -110..-114
export function storyEid(id: NpcId | PropId): number;
export function storyIdOf(eid: number): NpcId | PropId | null;
export type Marker = 'offer' | 'talk' | 'turnin' | 'busy' | null;   // gold "!", gold "◆", gold "?", grey "◆", none
export function markerFor(id: NpcId | PropId, view: QuestsView | null): Marker;
export interface StoryWorld {
  setView(view: QuestsView | null): void;                  // markers follow the view
  readonly spots: readonly { id: NpcId | PropId; x: number; y: number; z: number; eid: number }[];
  update(dt: number): void; dispose(): void;
}
export function createStoryWorld(scene: Scene, world: WorldApi, zone: ZoneId): StoryWorld;
// contracts.ts WorldApi
setBeaconRaised(on: boolean): void;      // shows or hides the Beacon at once (no rise): a returning adventurer past the plaque
fallingStar(): Promise<void>;            // a 3 s streak from the Beacon down past the grove's east edge, toward the Greenway, with a soft flash on the horizon
```
- **NPC looks** (authored story data; with Plan 5's looks): Old Marrow is an old human, stooped stance, white hair and beard, a long grey coat; Bram is a broad knollfolk with a leather apron; Tamsin is a tall larchfolk in an oilskin with a coiled rope at the hip; Nell is a brindlekin in a green hooded cloak with a staff-length walking pole. Each is a `Look` literal in `storyNpcs.ts`, checked with `parseLook` in the test. Pim is the offline town's figurehead mesh, already built; its talk spot is a pickable invisible cylinder under it (r 0.8, h 2.2) carrying its eid.
- **Props:** the plaque is the existing statue plinth face (a pickable thin box over it, its eid; a soft gold rim glow while it is a current objective); each waymark is a code-built leaning standing stone (≤ 120 triangles) with an arm carved as a raised strip pointing up toward the Beacon's direction; the crater edge marker is a ring of six short stakes with a frayed rope (≤ 200 triangles) at its spot.
- **Markers:** a floating gold "!" (an offer), "◆" (a current talk or use objective), "?" (a turn-in), a grey "◆" (a quest that is active but not at this NPC's step), drawn as flat code-built billboard meshes 2.4 m above the head, bobbing ±0.08 m, scale constant on screen between 8 and 40 m, one shared material. Budget for all markers and props in a zone: ≤ 1.5k triangles and ≤ 4 draw calls.
- **Beacon state:** on joining the grove, `setBeaconRaised(true)` when the main quest is past step `plaque` or done; else hidden. The Greenway's sky shows the Beacon the same way (its sky dome, if the Greenway build has one, else nothing).
- **The offline demo** (`npm run build`) does not import `storyNpcs.ts`: `main.ts` keeps its own NPCs.

- [ ] **Step 1: Write the failing tests** in `storyNpcs.test.ts`: eids unique and in range, `storyIdOf` inverts `storyEid`; `markerFor` for each quest state in the main quest (Marrow "◆" at step 0, nothing after; Bram "!" after `gate`, "?" when the boars are done; Tamsin likewise); the NPC looks parse; the triangle budget of every prop at med and low.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` (the offline demo unchanged) and `npm run build:online`. Then the browser check:**
  - `client/dev/story.html` under `npm run dev`, desktop and `devices['iPhone 13']`: every NPC and prop in its place in the grove and the Greenway (screenshots), each marker kind, `setBeaconRaised` and `fallingStar` mid-streak; draw calls and triangles recorded;
  - live (port 2575, PID noted): a guest in the grove sees Marrow with "◆"; a second page with `SG2_TEST_QUEST=solstice_crossing:board` (a separate server on port 2576, PID noted) sees the Beacon already raised; `kill <pid>` both;
  - no page errors.
- [ ] **Step 5: Commit**: `feat: the people and places of the opening quest in the grove and the Greenway, with quest markers and the Beacon's state`.

### Task 6: Client II: quest state, talk and dialogue flow, tracker, edge pointer, journal, hints, reward choice, completion moment, the Beacon scene (browser-heavy)

**Files:**
- Create:
  - `client/src/net/quests.ts` (pure: client quest state from `quests`, `questDone`, `questRefused`; the tracker lines with counts; the pointer's target), `client/src/net/quests.test.ts`;
  - `client/src/hud/journal.ts` (the journal sheet), `client/src/hud/questPointer.ts` (the edge pointer), `client/src/hud/journal.test.ts` (DOM);
  - `client/src/story/scenes.ts` (the Beacon scene moved from `main.ts`'s `solstice()`, and the crater scene).
- Modify:
  - `client/src/hud/quest.ts` (counts, a sub-line hint on tap, a "Journal" chevron; keeps its peek-on-change and done-flash);
  - `client/src/hud/index.ts`, `client/src/hud/style.ts`, `client/src/hud/dev.ts` (journal, pointer, `Q`);
  - `client/src/core/contracts.ts` (`HudState.quest` gains `quests` and `hint`; `HudApi.journal`, `HudApi.questDone`, `HudApi.pointer`);
  - `client/src/combat/controller.ts` (taps on story eids and `E`: walk over, then talk or use, the same walk-and-open as the Guild Board; the board's sheet shows the job-step hint);
  - `client/src/hud/jobs.ts` (the header hint line while the `board` step is active);
  - `client/src/online.ts` (messages; the new-player flow; `__sg2net` additions);
  - `client/src/main.ts` **only** to import the moved Beacon scene from `client/src/story/scenes.ts` and the shared lines that are word-for-word the same (the offline demo's behaviour is unchanged).

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5. **Plan 5 Task 8 (assumed built):** the login → `GET /api/look` → creator flow in `online.ts`; this task runs after it and adds nothing to it but the quest's first dialogue. **Plan 5 Task 10 (assumed built):** `HudApi.bag(view)` (the equip prompt's "Open bag" button calls it), `HudApi.loot(items, gold, soldFor)` (reward toasts); fallback: `hud.toast` lines. **Plan 4 Task 8 (assumed built):** tapping an adventurer offers "Invite" (the duo hint names it); party frames; fallback: the hint text alone.
- Produces:
```ts
// contracts.ts
export interface HudState { /* … */
  quest: { title: string; steps: { text: string; done: boolean }[]; hint?: string | null; more?: number /* other active quests */ } | null;
}
export interface HudApi { /* … */
  journal(view: JournalView): Promise<QuestAct | 'track' | null>;   // resolves with an act (accept, abandon, skip), a re-track, or null on close
  questDone(g: { title: string; step: string; xp: number; gold: number; item: string | null; title2: string | null; questDone: boolean }): void;   // the completion moment
  pointer(p: { x: number; y: number; label: string } | null): void;  // screen point of the target (off screen: clamped to the edge with an arrow)
}
// net/quests.ts
export interface ClientQuests { view: QuestsView | null; tracked: QuestId; history: QuestGiven[]; refusals: string[] }
export function trackerOf(q: ClientQuests, device: Device): HudState['quest'];
export function pointerTarget(q: ClientQuests, zone: ZoneId): { x: number; z: number; zone: ZoneId; label: string } | null;
// (a target in another zone points at that zone's exit: the grove's east gate for the Greenway; the Greenway's west gate for the grove)
```
- **Talk flow** (a tap on an NPC or prop eid, or `E` in reach):
  1. walk over (tap-to-walk, like the Guild Board) and face it;
  2. `npcSay`/`propSay` from Task 2 for the current view; play it on `hud.dialogue(speaker, lines, choices)`;
  3. when the lines belong to a current `talk`/`use` objective, send `quest { act: 'talk' | 'use', … }` **after the last page** (and with `choice` from the dialogue's choice for `nell_report`); an offer's "I'll do it" sends `accept`;
  4. the reply (`quests` / `questDone` / `questRefused`) drives what follows: a refusal toasts its text and nothing else happens.
- **The new-player flow:** first sign-in → (Plan 5) the creator → join the grove at `SPAWN`, facing the statue → the banner "The Plaza of the Two" → after 1.5 s, if the main quest is at `marrow`, a tracker peek and the pointer on Marrow, and a one-time hint (touch or desktop) "Tap Old Marrow to talk." Existing adventurers see the same tracker and pointer on their next join. Guests included.
- **Tracker** (`quest.ts`): the tracked quest (the main quest by default; the journal changes it), its current step's objective lines with counts (from `QUEST_LINES`), done lines struck through; a tap expands it and shows the step's hint; `more` shows "+2 more" opening the journal. Layout (CSS, phone-first):
  - portrait phones: top right, below the frames' row (`top: calc(var(--st) + var(--g) + 64px)`, the existing rule), collapsed to the title and the current line, max width min(62vw, 300px), its bottom never below 45% of the screen height; the existing 13 px step text is raised to 14 px (the no-text-under-14-px rule);
  - landscape phones, tablets and desktop: top right, as now;
  - with a target or boss frame, it moves down (the existing `.sg-has-target`/`.sg-has-boss` rules) and fades to 0.55 in combat (the existing rule);
  - it never overlaps `.sg-abilities`, the dodge and jump buttons, the joystick zone or the frames (DOM test at the four sizes).
- **Edge pointer** (`questPointer.ts`): a small gold arrow chip (48 × 48 px hit area) clamped to the screen edge, pointing at the current objective's target (an NPC, a prop, a `reach` circle, a zone exit, or for kill steps the nearest camp of that kind from `greenwayLayout().camps`); on screen it becomes a "◆" over the target; hidden in dialogue and sheets; tapping it starts tap-to-walk to the target when Tap to walk is on.
- **Journal** (`Q`, or the tracker's chevron): tabs Active, Offers and Done. Active: each quest with its steps (past ones struck, the current one with counts and its hint), its rewards (xp, gold, the item or "a chest piece of your choice"), "Track", "Drop quest" (not for the main quest; a confirm), and "Skip step" on an optional step (a confirm stating "no reward"). Offers: the offered quests with their giver ("Bram, at the tavern"); a `giver: null` offer has "Accept". Done: titles, times done and "today" for the daily. Phone: full screen; desktop: a 420 px panel. Controls ≥ 48 px.
- **Completion moment** (`questDone`): a gold banner for the step ("Step complete: Read the plaque") or the quest ("Quest complete" / "The Solstice Crossing"), a reward toast stack (xp, gold, item through `hud.loot` when present), a short rising chime-light ring on the adventurer (client-only, from the existing effects module), a title toast. For `scene: 'beacon'`: the Beacon scene (moved from the demo: Marrow's "before" line, the HUD hidden, the camera turning behind the statue and up along Ellie's arm, `world.raiseBeacon()`, then `world.fallingStar()`, 2.5 s hold, the HUD back, the banner "The Beacon" / "An island appears in the sky", Marrow's "after" lines). Movement is rooted (`rig.setMoveScale(0)`) during the scene; the server keeps the adventurer safe in town (no enemies in the grove). For `scene: 'crater'`: the HUD stays, the camera eases 30° down over the crater for 3 s, then the quest banner and the epilogue offer card (Accept → `quest { act: 'accept', quest: 'keepers_lamp' }`).
- **Reward choice:** `nell_report`'s three choices show each chest's name with its armour type and its special stat in one line (from Task 2), and on desktop a small stat comparison with the worn chest (Plan 5 Task 10's `compare` when present).
- **Equip prompt:** when the `equip` step starts, a toast with an "Open bag" button (`hud.bag` when present), and the bag's new item tile pulses until equipped.
- **`window.__sg2net`** adds: `quests: QuestsView | null`, `questDone: QuestGiven[]` (last 20), `questRefusals: string[]` (last 20), `tracker: { title: string; lines: string[] } | null`, `pointer: { label: string; onScreen: boolean } | null`, `dialogueOpen: boolean`, `beaconRaised: boolean`, `story: { id: string; eid: number; x: number; z: number }[]` (the zone's NPC and prop spots).

- [ ] **Step 1: Write the failing tests.**
  - `quests.test.ts` (client): the state follows `quests`, `questDone` and refusals; `trackerOf` gives counts ("Defeat Thornlings 2/3"); `pointerTarget` gives Marrow at step 0, the tavern circle at `pim_find`, the grove's east gate for `nell` while in the grove, the nearest Thornling camp for `first_fight` in the Greenway, the crater edge at `crater`.
  - `journal.test.ts` (DOM, jsdom): every control ≥ 48 px at 390 × 844 and 844 × 390; the tracker's rect never intersects `.sg-abilities`, the joystick zone or the frames at 390 × 844, 844 × 390, 768 × 1024, 1280 × 800; "Drop quest" absent for the main quest; "Skip step" only on the optional step and confirms "no reward"; the Offers tab lists Bram's bounty after `gate`.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` (the offline demo plays its own quest exactly as before: run its existing browser check if one exists, else a manual walk-through with screenshots) and `npm run build:online`. Then the browser check:**
  - start the server on port 2577 in the background (PID noted);
  - on the iPhone 13 (`?lockq`, game time), as a guest: the creator (Plan 5) then the grove; the tracker shows "Speak with Old Marrow" and the pointer chip points at him (screenshot); tap Marrow, read five pages (screenshot of a page); walk to the tavern by tapping the pointer; Pim's call; tap Jump; talk to Pim; read the plaque: the Beacon scene plays and the falling star crosses (screenshots mid-scene); the tracker shows "Choose a job at the Guild Board";
  - reload: the Beacon is raised at once and the tracker shows the same step;
  - with a second server on port 2578 started with `SG2_TEST_QUEST=solstice_crossing:nell_report` and `SG2_START_ZONE=greenway` (PID noted): talk to Nell, pick the Jerkin, open the bag, equip it; the tracker shows "Look into the crater"; walk there, use it: the crater scene, the quest banner, the title toast and the epilogue offer (screenshots);
  - on desktop: `Q` opens the journal, `E` talks to the nearest NPC, Esc closes;
  - the HUD dev page (`client/dev/hud.html`): screenshots of the tracker (collapsed and open), the journal's three tabs and the completion moment at desktop and iPhone sizes, in combat and out;
  - no page errors; `kill <pid>` both.
- [ ] **Step 5: Commit**: `feat: the opening quest on the client: talk and dialogue, the tracker and pointer, the journal, the reward choice, the completion moment and the Beacon scene`.

### Task 7: Bots that run the quest, the quest smoke test, the load runs (browser-heavy: the smoke test)

**Files:**
- Create:
  - `shared/src/story/questBot.ts` (the quest follower), `shared/src/story/questBot.test.ts`;
  - `server/scripts/smoke-quest.mjs`.
- Modify: `server/scripts/bots.ts`, `docs/load-test.md`.

**Interfaces:**
- Consumes: Tasks 1–6. **Plan 5 Task 11 (assumed built):** `bots.ts --looks` and `--gear`; **Plan 4 Task 10 (assumed built):** `--dungeon <n>` and parties for bots (`party` ops). This task adds `--quest` beside them.
- Produces:
```ts
// questBot.ts
export type QuestGoal =
  | { g: 'goto'; zone: ZoneId; x: number; z: number; within: number }     // walk (findPath), travelling through exits as needed
  | { g: 'talk'; npc: NpcId; choice?: number } | { g: 'use'; prop: PropId }
  | { g: 'jump' } | { g: 'job'; job: JobId }
  | { g: 'fight'; kinds: readonly EnemyKindId[] | 'any'; acts: readonly QuestAction[] }   // the shared brain fights; acts it should make sure to do
  | { g: 'equip'; slot: GearSlot } | { g: 'skip'; quest: QuestId } | { g: 'accept'; quest: QuestId } | { g: 'idle' };
export function questGoal(view: QuestsView, here: { zone: ZoneId; x: number; z: number; job: JobId; inParty: boolean; index: number }): QuestGoal;
```
  - Rules: main quest first; `choice = index % 3`; a bot keeps its job at the board (sends `job` with its current job) unless `--jobs mixed` gives it one; on `duo`, bots in a party fight together and others go after a Mossback when `index % 4 === 0`, else `skip`; after the main quest, every third bot accepts Bristle Bounty and every fifth Gran's Waymarks; the epilogue is accepted and abandoned by every tenth bot (an abandon path), never entered without `--dungeon`.
  - `fight` with acts: the brain's normal play does finishers and picks; `combo` and `dodge` are pursued by the brain's existing marks logic and dodges; if one is missing after 60 s of fighting, the follower nudges (a finisher right after another, a dodge when a telegraph is near).
- **`bots.ts --quest`** (with or without `--fight`; implies fighting in the Greenway when a step needs it): each bot follows `questGoal` from its `quests` view, sends `quest` acts and the poses, jumps, intents and `inv equip` the goals need, and keeps a ledger: quest gold and items from `questDone` match the `inventory` changes not explained by loot, sales or purchases.
  - It prints: bots per step (a histogram), main-quest completions, side and daily completions, quest writes per second (from `/healthz` `invWritesPerS`), `questRefused` by reason, and the ledger check.
  - **It passes** only if: Plan 4's and Plan 5's gates hold; there are 0 `questRefused` other than `'where'` (a bot that raced its own walk), `'busy'` and `'bag-full'` (and 0 `'rate'` at the bots' pace); every ledger matches; in a 420 s run started in the grove, ≥ 95% of bots get past `board` and ≥ 80% past `first_fight`, and ≥ 50% finish the main quest; `invWritesPerS` p95 ≤ 40; the zone room step p95 ≤ 15 ms.
- **`smoke-quest.mjs <url> --kill "kill <pid>"`** (a server with default switches): page A (iPhone 13) and page B (desktop):
  - A signs in as a guest; the creator (Plan 5) is completed with "Surprise me" and Done; A stands in the grove;
  - the tracker reads "Speak with Old Marrow"; A taps Marrow (`__sg2.screenOf` of its spot), walks over, pages through the dialogue; `__sg2net.quests` shows step `pim_find`;
  - A taps the pointer chip and arrives at the tavern; Pim's call shows; A taps Jump; step `pim`; A talks to Pim; step `plaque`;
  - A reloads: the same step; A reads the plaque: `questDone` with scene `beacon` arrives, `beaconRaised` becomes true;
  - B (in the grove) never receives a `quests` or `questDone` message for A, and B's patch bytes in the 20 s before and after A's plaque differ by less than 5%;
  - killing the server shows "Connection lost".

  Any page error fails it. (This covers the first three story beats of the spec: Marrow, Pim, the plaque.)

- [ ] **Step 1: Run the scripts against the current server to watch them fail** (bots: `--quest` unknown; smoke: no tracker).
- [ ] **Step 2: Write `questBot.test.ts`** (`questGoal` for every step of every quest; a fake run that feeds the follower its own simulated views from `applyQuestAct`/`applyQuestEvents` and reaches the end of the main quest) and **implement**.
- [ ] **Step 3: Run root `npm test` (PASS, pristine). Then the load runs**, each on a fresh server on port 2578 (PID noted, `kill <pid>` after each):
  - grove, `--count 100 --seconds 30`, then `--cluster 15`, each **with and without `--quest`**: PASS; KiB/s per bot within +0.1 of the previous recorded numbers, and the with/without difference ≤ 0.1;
  - `--count 100 --seconds 420 --quest --fight --looks --gear` (with `SG2_TEST_START_GOLD=200` for `--gear`): PASS with the gates above;
  - Greenway, `SG2_START_ZONE=greenway SG2_TEST_QUEST=solstice_crossing:first_fight`, `--count 100 --seconds 240 --quest --fight`: PASS, ≥ 80% past `first_fight`.

  If one fails, profile and fix the server or the bots, never the thresholds. Likely fixes, in order: coalescing quest events into the step's loot task; `questCares` filtering before queueing; the fx scan restricted to watched sessions.
- [ ] **Step 4: Run the smoke test:** a fresh server on port 2579 (PID noted); `node server/scripts/smoke-quest.mjs http://localhost:2579 --kill "kill <pid>"` → PASS. Also re-run `smoke.mjs` (Plan 3b), `smoke-party.mjs` (Plan 4) and `smoke-gear.mjs` (Plan 5), as far as they exist, against fresh servers as they need → still PASS.
- [ ] **Step 5: Record every run's printed numbers in `docs/load-test.md`** (date, machine, switches, steps histogram, completions, writes per second, KiB/s with and without `--quest`). **Commit**: `test: bots that run the opening quest, the quest smoke test and the load runs`.

### Task 8: Docs: outcome placeholder, roadmap and verification list

**Files:**
- Modify:
  - this plan, `docs/superpowers/plans/2026-11-12-sg2-plan-6-opening-quest-online.md` (fill `## Outcome`);
  - `docs/superpowers/plans/2026-11-11-sg2-plan-1-online-foundation.md` (the roadmap line for Plan 6).

**Interfaces:**
- **Roadmap 6** becomes:

  > **Opening quest online** — "The Solstice Crossing" as a saved, per-adventurer quest that starts at the statue for every adventurer: Old Marrow, Pim, the plaque, the Beacon rising and something falling into the woods, then the Guild Board, the Greenway road and Nell Thistlewood, a first fight that teaches targets, Momentum, finishers, combos, dodges and picks, an optional duo step with a solo route, a chest piece of the adventurer's choice, and the rim of the Lampfall; an optional epilogue into the Lampfall and two side quests (one daily); a small data-driven quest system with progress credited only by the server and rewards given once in the inventory's compare-and-set write (migration 008); code-built quest NPCs and props as story landmarks, markers, a tracker, an edge pointer and a journal; the starter-cottage unlock for Plan 8. Done (`2026-11-12-sg2-plan-6-opening-quest-online.md`).

- [ ] **Step 1: Run the verification list below. Record each result, with numbers, in `## Outcome`:**
  1. Root `npm test`: the pass and skip counts, pristine.
  2. `npm run typecheck`: clean.
  3. `npm run build` and `npm run build:online` in `client/`: both succeed. The offline demo plays its own quest exactly as before; the online build has the tracker, NPCs, journal and pointer. `npm run build` in `server/` succeeds.
  4. The load runs (port 2579, fresh starts): grove and clustered KiB/s with and without `--quest` beside the previous numbers; the 420 s `--quest` run: steps histogram, completions, writes per second, step p95, RSS; the Greenway `first_fight` run.
  5. `smoke-quest.mjs`, and the earlier smoke scripts that exist, against fresh servers on port 2579: PASS.
  6. Review Focus 1–7: for each, the test names that cover it.
  7. Grep `server/src/rooms/state.ts` and the shared state schema for any quest field: none. Grep `docker-compose.yml` and the Dockerfile for `SG2_TEST_QUEST`: none. Grep for secrets (`SG2_JWT_SECRET=` with a value outside docs and the local test command): none.
  8. Migration check (pg, if available): a Plan 5 database migrates with 008; every adventurer reads the main quest at Marrow with no write until it progresses.
  9. A read-through of every line in `shared/src/story/lines.ts` against this plan's Story text: identical.
- [ ] **Step 2: Write `## Outcome (date)`** in Plan 5's style: status, numbers, rulings made during the build, deferred items, and "For Plans 7 and 8" notes (Plan 7: the story-spot placement rule to absorb; Plan 8: `QuestSave.unlocks` holds `home:starter_cottage` after The Solstice Crossing).
- [ ] **Step 3: Commit**: `docs: Plan 6 outcome and roadmap`.

## Decisions this plan makes that the spec leaves open

These are recorded so that reviewers can check the tasks against them.

**The story**
- The online quest keeps the offline demo's three beats and its lines (Marrow, Pim, the plaque, the Beacon scene, Tamsin's and Bram's idle lines), and adds a second act in the Greenway with one new character, **Nell Thistlewood**, the road-keeper, who teaches fighting and gives the reward.
- "Something falls from it into the woods" is shown by a falling star at the end of the Beacon scene and made concrete at the end: the quest's last step is to look into the crater (the Lampfall's mouth), where a lamp still burns and a bell tolls. The Lampfall itself is an optional epilogue quest (**The Keeper's Lamp**), never required.
- The Beacon is part of each adventurer's own world: it appears in your sky once you have read the plaque (a client-side state from your own quest). Others who have not read it yet see an empty sky. No shared world state changes.
- Two side quests: **Bristle Bounty** (Bram; daily; six Bramble Boars) and **Gran's Waymarks** (Tamsin; once; three waymark stones on the Greenway road). Both open once the main quest reaches the east gate.

**The quest system**
- One small data-driven model: a quest is an ordered list of steps; a step has objectives (all, or any one), an optional flag, a reward and an optional client scene. Objective kinds are only those these quests need: talk, use a prop, reach a zone or circle, jump, choose a job or picks, kill (kinds or any, optionally with a party member), a combat act (finisher, combo, dodge, pick) and equip.
- **Every adventurer has the main quest from its first join after this plan**, new or existing, because a NULL `quests` column reads as the main quest at Marrow (no write until it progresses). There is no separate "start the quest" step; Old Marrow is the first step for everyone.
- The main quest can't be dropped or restarted; it can always be continued. Side quests and the epilogue can be dropped (progress lost) and taken again; once-quests are never offered again after they are done; the daily pays once per UTC day.
- Only one step is current per quest. Events never carry over into the next step.
- Quests are personal. In a party, every member counts every kill the server credits to them (the engine's credit with `MIN_CREDIT_FRAC` plus Plan 4's party share), each toward their own current steps, whatever step they are on. Talk, props, places, jumps and equips are personal. Nothing about one member's quest is sent to another.
- The duo step ("Two lanterns") is optional and completes on any kill that also credits a party member, or on a Mossback alone (the solo route); it can be skipped from the journal with no reward. Every other step is comfortable solo.
- The dodge objective counts any dodge roll the server accepts while in combat (not only one that avoids a telegraph): stepping out of a telegraph produces no engine event, and the step must never block a player who dodges by walking. The finisher and pick objectives count uses anywhere; the tracker asks for them in a fight.
- Choosing a job counts any accepted job change, including keeping the current job, or a change of picks: nobody is forced off the Warrior.

**Rewards and the economy**
- Rewards are xp to the current job (no catch-up multiplier), gold, and one item: a choice of three T1 chest pieces (Mossweave Robe, Thornrunner Jerkin, Rootbound Hauberk), which teaches the three armour types and is then equipped as a step. Totals: 330 xp, 95 gold and an 80-gold chest for the main quest (a new adventurer ends at level 3–4).
- **No costume or dye is given** (the owner's rule: costumes only for gold or GM events; dyes are not owned items in Plan 5). The keepsake is the title **Witness of the Crossing**, re-granted on join if ever missing.
- A quest reward is never sold for a full bag: the completing talk is refused "Make room in your bag first" instead.
- Rewards land in the same compare-and-set write that advances the step (quest state lives beside the inventory, migration 008); items and gold go through `addLoot` with a quest key as a second guard; xp is written with the step and applied to the session's live jobs from the write's `landed` hook.
- The Plan 8 hook: completing The Solstice Crossing stores the unlock `home:starter_cottage` in the quest save. Nothing else is built for homes.

**Server and bandwidth**
- Quest NPCs and props are static shared data (story landmarks), drawn by every client: nothing about them is in the room's state. Quest views, completions and refusals go to their owner only; a view is sent only when it changed. Quest events the save does not care about are dropped before they reach the queue, and the step's quest events share one write with the step's loot.
- Talk and props are checked against the server's last accepted pose, with a 0.5 m fuzz; NPCs are reached at 3.6 m (the offline demo's range), props at 3.0 m.
- NPC and prop spots come from layout constants (the grove) or the generated Greenway layout by a fixed nudge rule with a snapshot, so they never sit in a tree, a camp or an exit.
- A test-only switch `SG2_TEST_QUEST=<quest>:<step>` starts new adventurers at a step (for smoke tests and bots); never in Docker.

**Client**
- The tracker is the offline demo's tracker, extended with counts, a tap-to-show hint and a journal link; on portrait phones it stays top right under the frames, collapsed to one line, above 45% of the screen height, and fades in combat.
- An edge-of-screen pointer leads to the current objective (an NPC, a prop, a place, the next zone's exit, or the nearest camp of the kind to defeat); tapping it walks there.
- Markers over NPCs: gold "!" (an offer), gold "◆" (talk or use now), gold "?" (turn in), grey "◆" (on a quest, not here yet).
- The journal opens with `Q` or from the tracker: Active, Offers and Done tabs.
- Dialogue is text only, on the existing dialogue sheet, one line per page (≤ 140 characters), with choices only for the reward and quest offers (and Marrow's question menu).
- NPCs get authored looks through Plan 5's look system (an old human, a knollfolk, a larchfolk, a brindlekin), with colour-only fallbacks if it is not built.

## Outcome

Built by subagent-driven development: Tasks 1–4 (shared and server; the server independently reviewed with a fix round), Tasks 5–6 (client) in parallel worktrees, Task 7 (bots and the live pass) together with Plan 5 Task 11; one whole-branch review and one fix wave. This section (Task 8) was written by the coordinator.

**What exists**
- A small data-driven quest system: The Solstice Crossing (main), The Keeper's Lamp (optional epilogue into the Lampfall), Bristle Bounty (daily) and Gran's Waymarks (once).
- Quest state saved in the same write as the reward it pays; progress credited only from server events; quest messages go only to their owner.
- Old Marrow and Nell Thistlewood in the world, markers, the dialogue sheet, the tracker and pointer, the journal, hints, the reward choice and equip step, the Beacon rising and the falling star.
- Bots that run the quest; `smoke-quest.mjs` and `smoke-gear.mjs`.

**Verified by the coordinator on the final code (`e266db9`), machine quiet:** root `npm test` 1773 passed, 6 skipped; `npm run typecheck` clean; the offline and online client builds and the server build pass; the bundle scan with `SG2_REQUIRE_BUNDLE_SCAN=1` passes; the browser smoke tests are listed in Plan 6's outcome. Load numbers were measured by workers on a quiet machine (docs/load-test.md): walkers, clustered walkers, fight, cycle, dungeon and twelve Warden fights at once hold 15.0–15.2 Hz; clustered bandwidth is 10.7 KiB/s plain and 11.0 with looks, parties and T3 gear (the limit, no headroom). The pg store suite passed 550 tests on Postgres 16 (worker run).

**Browser smoke tests on the final code (coordinator run):** `smoke.mjs` PASS; the quest, gear and party tests: results recorded in the line below once run.

**Rulings and deviations**
- The save has a `paid` field and an optional `choice`; the main quest gives 350 xp (290 without the optional duo step); the worst-case quest view is 311 bytes.
- `questDone` is sent for every completed step; a hop must rise 0.6 m; the quest day never goes backwards and is capped at tomorrow.
- A full bag refuses the hand-in. The keepsake is the title Witness of the Crossing. The `home:starter_cottage` unlock is saved for Plan 8.
- Quest events dropped at session end are written offline; quest xp survives a write that commits and then throws.

**Deferred**
- The quest bot run on the grove passes its gates in 2 of 4 runs (bots without kills after holding a fight slot — not explained); the Greenway quest runs pass 3 of 3.
- The length of the main quest for a new player has not been measured (estimate 30–45 minutes).
- Never tested on a real phone; nothing is installed on the Hetzner server (deploy/README.md).
