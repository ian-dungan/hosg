# Shady Grove 2 — Plan 5: Progression, Gear and Character Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adventurers grow and look like themselves. Each job levels from 1 to 10 on a real curve. A level gives stats and, at levels 4, 7 and 10, a talent row: one choice of three that changes how the job plays. Gear matters. There are eight visible slots, three armour types, three tiers with nine named sets, set bonuses at three and five pieces, and named weapons with their own effects. Each job wears its own gear set, so switching jobs switches gear. Loot is personal and rolled by the server: each adventurer rolls its own drops, so a duo never argues over loot. Warden's Seals buy top-tier pieces at a vendor, so bad luck never starves a duo. Gold comes from kills and sales. It is spent at the Smithy, the Tailor (costumes and dyes), the Barber and on talent retraining. Character creation is in-depth: four peoples that differ in looks only, six body sliders, seven face options, 20 hair styles, facial hair, free colour pickers, a stance, a walk and six emotes. The result is code-built, readable on a phone, and seen by everyone. Costumes are worn over gear and bought only with gold, or given at GM events. GM tools let a game master announce, grant, teleport and kick. Every GM command is audited, and the role can only be set from the server's shell. The server decides everything, and the shared simulation proves that gear moves the difficulty bands the way the spec asks.

**Architecture:** This plan adds to Plans 3–4. It replaces only the 3b XP stub curve, the plain-text name blocklist and the "every adventurer has `STARTER_STATS`" rule.
- `@sg2/shared` gains:
  - the level curve, per-level base stats, talents and the `Mod` vocabulary (`progression.ts`, `talents.ts`, `mods.ts`);
  - items, slots, armour types, sets, weapons, costumes, dyes, loot tables, vendors and the pure inventory rules (`items.ts`, `loot.ts`, `inventory.ts`);
  - looks: peoples, `Look`, compact look and gear codes, varied default looks (`look.ts`);
  - a hashed name blocklist (`badwords.ts` holds hashes only);
  - kits in the combat engine: `setKit` applies a job's stats and mods (Focus, Flow, Guard, set bonuses, named weapons, talents), and kill credit follows a minimum-contribution rule;
  - the simulation with levels, gear and talents, and the gear bands.
- The server gains:
  - migration 006: inventory, look, the free creator visit, the inventory version used for compare-and-set, and the GM audit log;
  - the inventory and shop rules in `ZoneRoom`, applied through a per-session operation queue with one atomic store write per change;
  - personal loot rolled by a seeded generator per kill, and gold;
  - the real xp curve, catch-up, dungeon clear xp, level-ups and talents;
  - the Barber, `/api/look` and emotes;
  - GM tools: chat commands parsed only on the server, a role CLI, an audit log and rate limits.
- The client gains:
  - a look-driven adventurer model (peoples, sliders, faces, hair, colours, stance, walk, emotes);
  - the character creator and the Barber screen;
  - gear and costumes on the model, per slot and tier, with dyes;
  - inventory and equipment, vendor, wardrobe, talent and bank screens, all phone-first;
  - town stalls, loot feedback and the level-up moment.

**Tech Stack:** as Plans 1–4: TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, PostgreSQL 16 / memory store, Playwright (pre-installed; never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md`. This plan implements:
- section 9 **Progression**:
  - levels 1 to 10 and three gear tiers;
  - visible gear in the slots head, chest, legs, feet, hands, back, main weapon and off-hand;
  - armour types: cloth, light and heavy, each with its own special stat;
  - "stats are few and visible", and large tier gaps ("a boss tuned for three players is soloable only in the top tier");
  - set bonuses at three and five pieces, and nine sets (one per armour type per tier);
  - weapons with their own looks, and named weapons with unique effects;
  - costumes: a separate slot, gold only or GM events;
  - character creation: four peoples (looks only), sliders, hair and facial hair, free colour pickers, stance, walk and emotes, dye slots on armour, and a Barber;
  - GM tools: start an event, announce it, award a costume or item;
- section 6 **Jobs**: "Each job remembers its own outfit", and "a small talent tree … with real choices; retraining costs gold";
- section 10 **Online**: names "no bad words, no impersonating staff or the heroes" (the filter is rebuilt so no plain-text slur list ships); "Death returns you to the statue with no item loss" (unchanged: nothing is ever lost on death);
- Plan 4's hand-off: Warden's Seals become gear, and loot (its "shared loot rolls" become personal loot, see Decisions).

**Boundary with other plans** (stated so no worker builds it):
- **Still being built while this plan is written:**
  - Plan 3b Tasks 8–10: weapon and spell effects, mixed-job bots and docs;
  - Plan 4 Tasks 8–11: client party UI, the Lampfall's look, party and dungeon bots, and docs.

  Where a task here depends on them, it names the interface it assumes. If the built interface differs, the task adapts to what was built and records it in its report.
- **Plan 6 owns** quests and story: quest xp (it calls this plan's `addJobXp`), quest-unlocked abilities and jobs, and quest reward items (`ITEMS` is open for them).
- **Plan 7 owns** the general world generator. Town stalls are markers in `zones.ts`, like the Guild Board.
- **Plan 8 owns** homes: the rested bonus, storage chests and the gear mannequin. This plan has a bank (the Vault) and no rested xp.
- **Plan 9 owns** neighbourhoods.
- **Later:**
  - trading and mail between adventurers;
  - hard-mode rewards, sky-folk (a data hook only), crafting, durability and repairs;
  - ability unlocks by level, and voice.

## Global Constraints

- **One combat system (Plans 3, 3b and 4, unchanged):** tap-target and auto-attack, one Momentum bar (0–100, finishers cost 50 unless a mod says otherwise, never below 30), five buttons per job, no borrowed abilities, a dodge roll with charges, marks and combos, element reactions, stagger and Breaks, telegraphs with wind-ups of at least 1.0 s. Gear and talents add **no new button, no new resource and no new random roll in the engine**: there are no critical hits and no random stat rolls.
- **Jobs change only where `CombatZone.jobSwitch(x, z)` is true** (unchanged). Talent choices and retraining follow the same rule. Gear can be changed anywhere while out of combat, alive and not casting or charging.
- **Server-authoritative:**
  - clients send ids only: item uids, item ids, stall ids, costume ids, dye ids, talent rows and choices, and a `Look`;
  - the server owns every item, price, roll, stat and gold or Seal amount, and recomputes all of them;
  - a malformed or impossible request is refused with a reason and changes nothing;
  - GM commands are parsed and run only on the server, and their code never ships to clients.
- **Never lose, never duplicate:**
  - every inventory, gold, Seal, look and talent change is one atomic store write, guarded by a version check (compare-and-set on `inv_version`), and applied through one queue per session;
  - gold and Seals are written as checked deltas (never below 0), so a Seal awarded during a purchase is never lost;
  - a kill is rewarded at most once per adventurer (`recentKills` keys);
  - nothing is ever lost on death or disconnect.
- **Determinism:**
  - the engine stays pure and seeded: kits are inputs, and mods are applied deterministically;
  - loot is rolled outside the engine by `rollLoot` with its own seeded generator, keyed by (server seed, room id, enemy id, kill counter, account id), so the same kill always rolls the same thing for the same adventurer.
- **Scale and bandwidth:**
  - 100 adventurers, `TICK_HZ = 15`, room step p95 ≤ 15 ms, instances ≤ 3 ms, peak RSS ≤ 400 MB (Plan 4);
  - `PlayerState` gains `look` and `gear`: short strings, sent when an adventurer enters a client's view and when they change, never per patch;
  - per-client receive stays ≤ 11.5 KiB/s in the clustered 100-walker grove run, and no more than +0.5 KiB/s over the latest numbers in `docs/load-test.md` for the same runs.
- **Phone-first:**
  - every touch control is at least 48 px (ability buttons 64 px);
  - every sheet (creator, bag, vendor, wardrobe, talents, bank) is full-screen on phones in portrait and landscape, and a panel of at most 420 px on desktop;
  - sliders are 48 px tall with 44 px thumbs; colour pickers are tap-first (a swatch row plus a hue and lightness strip, no drag-only control);
  - no text under 14 px;
  - gear reads at phone size: each tier and armour type has a distinct silhouette (shape), not only a colour.
- **Desktop keys:** as Plan 4, plus `I` (bag and equipment), `C` (character and stats, the same sheet on its stats tab), `O` (wardrobe), `T` (talents, in town or a sanctuary), `E` (talk to the nearest stall within reach), and `Esc` (close).
- **Names:**
  - every people, set, item, weapon, costume, dye, stall, NPC and talent name in this plan is original; workers keep them exactly as written, and new names need the same care (not lifted from well-known games);
  - job names come only from `JOBS[id].name`;
  - "Warden's Seal" is Plan 4's.
- **Chat is unfiltered for now** (owner decision), always cleaned (`cleanChat`) and shown as plain text. Adventurer names are filtered (`validateAdventurerName`).
- **Art:** everything is built in code, flat-shaded low-poly with toon lighting, in `PALETTE`-derived colours (dyes and free colours are the only exceptions), with no asset files. An adventurer stays **one skinned mesh plus at most one emissive mesh**: gear and costumes are merged in.
- **Persistence:** inventory, gold, Seals, looks, wardrobe, outfits, talents and job xp are saved (migration 006). Parties and instances stay memory-only (Plan 4).
- **Everything from Plans 1–4 keeps working:**
  - accounts, travel, reconnect and relog carry, death and respawn, interest views, jobs, parties, instances, Seals, titles, the leaderboard and Docker packaging;
  - root `npm test` stays green with pristine output;
  - `npm run build` (the offline demo) stays the combat-free town with the default look and no shops;
  - `npm run build:online` gets everything.
- **Out of scope** (design so it slots in, do not build):
  - trading, mail and auctions;
  - crafting, durability and repairs;
  - random affixes and critical hits;
  - rested xp (Plan 8);
  - ability unlocks by level;
  - hard-mode loot;
  - sky-folk (data hook only);
  - a GM web panel;
  - voice.
- **Environment:**
  - no secrets in the repository;
  - never touch anything outside the repository: no global installs, no system services, no killing processes the task did not start;
  - Playwright is pre-installed, so never install it.
- **Browser checks:**
  - headless WebGL runs at about 1 fps, so measure game time, not wall time;
  - open pages with `?lockq`;
  - Tasks 8, 9, 10 and 11 are browser-heavy, and only one of them may run at a time (also never at the same time as a browser-heavy Plan 3b or Plan 4 task);
  - local test servers use ports 2571–2579 with `SG2_STORE=memory`, are started in the background with their PID recorded, and are stopped with `kill <pid>`. Never use `fuser` or kill by name. Smoke scripts get `--kill "kill <pid>"`;
  - the standard local server command (fill in the port) is:
    ```
    SG2_STORE=memory SG2_AUTH_RATE_PER_MIN=1000 SG2_PORT=<port> SG2_JWT_SECRET=local-test-secret-0123456789abcdef npx tsx server/src/index.ts
    ```
- **Scratch files** (measurement scripts, screenshots) go only in a new sub-directory of the session scratchpad, never in the repository.
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
| 1 Shared progression data: level curve and xp migration, base stats, `Mod`, `Kit`, talents | — | 2 (after its types land), 3 | no |
| 2 Shared gear data: slots, items, sets, weapons, costumes, dyes, loot tables, vendors and stalls, pure inventory rules, `kitFor` | 1 (types) | 3 | no |
| 3 Shared looks and names: peoples, `Look`, look and gear codes, default looks, the hashed blocklist | — | 1, 2 | no |
| 4 Engine: kits, Focus, Flow and Guard, mods, set bonuses, named weapons, minimum-contribution credit | 1, 2 | 3, 8 | no |
| 5 Simulation with levels, gear and talents; the gear bands and tuning | 4 | 6, 7, 8 | no |
| 6 Server I: migration 006, store, inventory queue and shops, loot and gold, xp and talents, looks and the Barber, emotes, state | 2, 3, 4 | 5, 8 | no |
| 7 Server II: GM tools (role CLI, commands, announce, grants, teleport, kick, events, audit, rate limits) | 6 | 5, 8, 9 | no |
| 8 Client I: the look-driven adventurer, the character creator, the Barber, stance, walk and emotes | 3 (and 6 for its live check) | 4, 5, 6, 7 | **yes** |
| 9 Client II: gear and costumes on the model, weapons per item, dyes | 2, 8 (and Plan 3b Task 8) | 5, 6, 7 | **yes** |
| 10 Client III: bag and equipment, stats, vendors, wardrobe, talents, bank, stalls, loot feedback, level-up | 6, 9 (and Plan 4 Task 8) | 5, 7 | **yes** |
| 11 Bots with looks and gear, the gear smoke test, the load runs, scripted Warden runs in gear | 5, 6, 7, 10 (and Plan 4 Task 10) | — | **yes** (smoke) |
| 12 Docs: outcome placeholder, roadmap, verification list | 11 | — | no |

Browser-heavy tasks (8, 9, 10, 11's smoke step) never run at the same time as each other. Their pure and unit-test steps may run alongside other tasks.

Task 1 lands its types first: `Mod`, `Kit` and `ProgressionStats` in `mods.ts` and `progression.ts`, committed as soon as they compile. Task 2 may start once they are on the branch.

**Only Task 5 may change the numbers marked "tunable" below**, and only under the Tuning rule. Every other task implements the numbers exactly. They report numbers but do not tune. No task changes a Plan 3, 3b or 4 number, the starter kit, or `baseStats(10)`.

## Numbers

New constants live in the files named. Combat-side constants go in `shared/src/combat/constants.ts` under a section headed `// ───────── gear and progression ─────────`.

### Levels and xp (`shared/src/progression.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `JOB_LEVEL_CAP` | 10 | unchanged (spec: levels 1 to 10) |
| `XP_TO_NEXT` | `[100, 140, 190, 250, 320, 400, 490, 590, 700]` | xp from level L to L+1 (index L − 1); 3180 xp from 1 to 10 |
| `XP_CURVE_VERSION` | 2 | `JobsSave.curve`: absent means the 3b stub |
| `CATCH_UP_MULT` | 1.5 | kill and clear xp for a job whose level is below the adventurer's highest job level |
| `CLEAR_XP` | 30 | each Lampfall pack encounter cleared: to every credited adventurer (each pack enemy's `KILL_XP` still counts) |
| `MIN_CREDIT_FRAC` | 0.1 | kill credit needs at least this share of the top threat on the enemy when it dies (constants.ts) |
| `TALENT_LEVELS` | `[4, 7, 10]` | talent rows unlock at these job levels |

- `levelForXp(xp)` and `xpToNext(xp)` use `XP_TO_NEXT`. `addJobXp` keeps its signature, now on the new curve.
- **Migration of 3b progress** (`migrateStubXp(xp)`): old level `Lo = min(10, 1 + floor(xp / 100))` and progress `p = (xp mod 100) / 100`. The new xp is `totalTo(Lo) + floor(p × XP_TO_NEXT[Lo − 1])`, or `totalTo(10)` at the cap. No job loses a level.
  - Worked examples: 0 → 0, 50 → 50, 450 (level 5, half way) → totalTo(5) + 160 = 680 + 160 = **840** (still level 5; an earlier draft said 1000 + 160, which would be level 6 — corrected in Task 1, coordinator ruling), 900 → 3180, 5000 → 3180.
  - `parseJobsSave` converts every record once, when `curve` is absent, and sets `curve: 2`.
  - Such a save is "repaired", so Plan 3b's `jobsRepaired` write-back stores it on the first join.
- Each credited adventurer's **current** job gains the kill's xp (Plan 3b), × `CATCH_UP_MULT` when it applies, floored.
- `KILL_XP` is unchanged (Plans 3b and 4).
- No rested xp (Plan 8).
- The adventurer row's `level` column is written by every save as the highest job level (for queries; nothing reads it in play). The `xp` column stays unused.

**Base stats by level** (`baseStats(level)`, fixed except where marked tunable):

| | level 1 | per level | level 10 |
|---|---|---|---|
| power | 6 (tunable 5–7) | (9 − L1) / 9, rounded down per level (6 6 6 7 7 7 8 8 8 9) | **9** |
| defence | 5 (tunable 4–6) | (8 − L1) / 9, rounded down per level (5 5 5 6 6 6 7 7 7 8) | **8** |
| maxHp | 72 (tunable 64–80) | (90 − L1) / 9, rounded down per level | **90** |

**Whole numbers (owner rule):** every base stat, every stat an item gives and every kit total is a whole number; an item that gives a stat gives at least 1. Power and defence rise at levels 4, 7 and 10 (the talent levels). Level 1 in the starter kit is 7 / 7 / 82.

Level 10 is fixed, so that level 10 plus the starter kit is exactly `STARTER_STATS` (10, 10, 100). **A fresh level-10 adventurer in starter gear is the adventurer every Plan 3b and Plan 4 band was tuned for.** This is the parity rule P1.

**What a level gives:** base stats (above), and talent rows at 4, 7 and 10. The whole job bar and pool stay available from level 1 (Decisions).

### Stats the engine honours (`shared/src/combat/stats.ts`)

`Stats` becomes `{ power; defence; maxHp; focus?: number; flow?: number; guard?: number }`. Absent means 0. `STARTER_STATS` is unchanged and has no specials.

| stat | from | effect (per point) | cap |
|---|---|---|---|
| Power | weapons, off-hands, level | Plan 3's `hitDamage` power | — |
| Defence | armour, level | Plan 3's `mitigation` | — |
| Health (maxHp) | armour, level | max hp | — |
| **Focus** (cloth) | cloth pieces | +1% to the adventurer's **ability** damage coefficients, heal amounts and shield amounts (not autos, not Burning ticks) | 40 |
| **Flow** (light) | light pieces | +1% to every positive Momentum gain (each gain rounded down) | 40 |
| **Guard** (heavy) | heavy pieces | +1% to all threat it adds, and −1% to knockback speed taken (at most −50%) | 40 |

### Gear (`shared/src/items.ts`)

**Slots:** `GearSlot = 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'back' | 'weapon' | 'offhand'` (the spec's eight). There are no trinkets.

**Armour types:** `ArmourType = 'cloth' | 'light' | 'heavy' | 'plain'`. Plain is the starter kit only: it has no special stat and belongs to no set.

**Off-hands** by weapon:

| weapon | off-hand kind | power share |
|---|---|---|
| blade | buckler | off-hand round(0.25 × kit power), at least 1 (0 for the starter); weapon the rest |
| bow | quiver | as blade |
| sword | shield | as blade |
| staff | tome | as blade |
| greatsword | none (two-handed) | weapon 1.0 |
| daggers | none (a pair) | weapon 1.0 |

A weapon fits every job whose `JOBS[job].weapon` is its `WeaponId`, so a staff fits both mages. An off-hand fits the jobs whose weapon takes its kind. Armour fits every job.

**Tiers and the power budget per item level.** Every item of an id has fixed stats; nothing is rolled. A full kit's bonus over `baseStats(10)`, for light armour (the reference type), is:

| tier | item level | where from | power | defence | health | special |
|---|---|---|---|---|---|---|
| starter (`plain`) | 1 | everyone owns it | 1 | 2 | 10 | 0 |
| T1 Greenway | 4 | Greenway drops, the Smithy | **3** (was 2.5: whole numbers; tunable ±25%) | 4 (±25%) | 22 (±25%) | 6 (±30%) |
| T2 Lampfall | 7 | Lampfall packs and the Wickhound | 4 (±25%) | 6 (±25%) | 40 (±25%) | 12 (±30%) |
| T3 Warden | 10 | the Fallen Warden and the Lampwright (Seals) | **9** (was 11, then 8.3; whole numbers and the ±25% floor of 8.25) | **12** (was 16, ±25%) | **68** (was 90, ±25%) | **14** (was 20, ±30%) |

At level 10, a full kit gives these totals:
- starter: 10 / 10 / 100, which is Plan 3b's `STARTER_STATS`;
- T2: 13 / 14 / 130, which is Plan 4's G1 mid-tier stand-in;
- T1: 12 / 12 / 112;
- T3: 18 / 20 / 158 (Task 5 tuning, in whole numbers; was 20 / 24 / 180, Plan 4's G1 top-tier stand-in), before set bonuses and specials. At 20 / 24 / 180 sloppy duos killed the Warden in 105–124 s with no deaths and careful solo won 108 of 140; every T3 number is now at the bottom of its range (see Task 5's Outcome).

**Spreading a kit over the pieces:**
- Power is split between the weapon and the off-hand only, by the off-hand table.
- Defence, health and the special stat are split over the six armour pieces by slot weight:

  | slot | weight |
  |---|---|
  | chest | 0.25 |
  | legs | 0.20 |
  | head | 0.17 |
  | hands | 0.13 |
  | feet | 0.13 |
  | back | 0.12 |

- Each armour piece then applies its own type's multipliers:

  | type | defence | health | special |
  |---|---|---|---|
  | heavy | × 1.5 (tunable 1.3–1.7) | × 1.2 (1.1–1.3) | Guard |
  | light | × 1 | × 1 | Flow |
  | cloth | × **0.5** (was 0.6; tunable 0.5–0.8) | × **0.75** (was 0.85; 0.75–0.95) | Focus |
  | plain | × 1 | × 1 | none |

- Rounding (whole numbers, owner rule): each armour type's kit totals are rounded first (defence = round(table × type defence), health = round(table × type health)), then split over the pieces by slot weight with the largest remainder, so every piece's stats are whole and a full kit sums exactly to its type's totals. Power: weapon + off-hand = the table's power. A piece of a higher tier is never worse than a lower tier's in a stat they share (tested).
- Weapon and off-hand power per tier: starter 1 + 0, T1 2 + 1, T2 3 + 1, T3 7 + 2 (a two-handed weapon or a pair: 1, 3, 4, 9).
- Full-kit totals at level 10 (power / defence / health / special):

  | tier | light | heavy | cloth |
  |---|---|---|---|
  | starter (plain) | 10 / 10 / 100 / 0 | — | — |
  | T1 | 12 / 12 / 112 / 6 | 12 / 14 / 116 / 6 | 12 / 10 / 107 / 6 |
  | T2 | 13 / 14 / 130 / 12 | 13 / 17 / 138 / 12 | 13 / 11 / 120 / 12 |
  | T3 | 18 / 20 / 158 / 14 | 18 / 26 / 172 / 14 | 18 / 14 / 141 / 14 |
- `itemStats(id)` computes a piece's stats from the tables, so tuning a row retunes every piece.

**Sets** (`SETS`). Each set has six armour pieces. Piece ids are `<set>_<slot>`, and piece names are `<set name> <noun>`.

| set id | name | tier | type | 3 pieces | 5 pieces |
|---|---|---|---|---|---|
| `plain` | Grove-Spun | starter | plain | — | — |
| `mossweave` | Mossweave | T1 | cloth | heals and shields you give × 1.1 (`given`; ruling P5-b, was: heals you give also shield 15% of the amount healed, cap 15, 6 s) | your casts take 10% less time |
| `thornrunner` | Thornrunner | T1 | light | a perfect dodge gives +10 Momentum | dodge charges refill 20% faster |
| `rootbound` | Rootbound | T1 | heavy | +3 Momentum when an enemy hit lands on you (at most once a second) | falling below 35% hp shields you for 15% of max hp (6 s; once every 30 s) |
| `wickthread` | Wickthread | T2 | cloth | a completed cast takes 0.5 s off your other cooldowns | interrupting a wind-up, a cleanse or a revive gives +20 Momentum; the cleanse pays on a cleanse cast (an affliction removed or not) at most once every 10 s (ruling P5-g, `everyS: 10`) (ruling P5-b, was: interrupting only) |
| `cinderstep` | Cinderstep | T2 | light | a finisher that detonates a mark refunds 10 Momentum | for 2 s after a dodge, your next ability deals ×1.2 |
| `brassbound` | Brassbound | T2 | heavy | your taunts also shield you for 15 (6 s) | the stagger you deal × 1.2 |
| `lenslight` | Lenslight | T3 | cloth | heals and shields you give × **1.105** (Task 5, was × 1.15) (`given`; ruling P5-b, was: overhealing you give becomes a shield, 30% of the overheal, cap 20, 6 s) | your finishers cost **7** less Momentum (Task 5, was 10) |
| `tollwind` | Tollwind | T3 | light | dodge charges refill 25% faster (ruling P5-b, was: +1 dodge charge, which Fourth Roll could not add to) | a perfect dodge resets your quick ability's cooldown |
| `beaconstone` | Beaconstone | T3 | heavy | party members within 8 m take × 0.95 enemy damage | once every 90 s, a blow that would kill leaves you at 1 hp with 2 s of i-frames |

Bonus magnitudes are tunable ±30%. The piece nouns:

| slot | cloth | light | heavy | plain |
|---|---|---|---|---|
| head | Hood | Cap | Helm | Cap |
| chest | Robe | Jerkin | Hauberk | Tunic |
| legs | Breeches | Leggings | Greaves | Trousers |
| hands | Wraps | Gloves | Gauntlets | Mitts |
| feet | Slippers | Boots | Sabatons | Shoes |
| back | Shawl | Cloak | Mantle | Scarf |

**Weapons and off-hands** (`ITEMS`; ids as listed; T3 weapons are **named**, with a unique effect; every non-starter weapon has its own model):

| weapon | starter (ilvl 1) | T1 (ilvl 4) | T2 (ilvl 7) | T3 named (ilvl 10) |
|---|---|---|---|---|
| blade | `grove_blade` Grove Blade | `hedgecutter` Hedgecutter | `wickfang_sabre` Wickfang Sabre | `last_bell` **Last Bell**: a parry gives +25 Momentum; Sunder's cooldown −1 s |
| bow | `grove_bow` Grove Bow | `ashwood_longbow` Ashwood Longbow | `cinderstring` Cinderstring | `longwatch` **Longwatch**: Charged Shot × 1.2; interrupting gives +15 Momentum |
| sword | `grove_sword` Grove Sword | `millward_sword` Millward Sword | `cogtooth_blade` Cogtooth Blade | `lampwardens_oath` **Lampwarden's Oath**: your taunts shield you for 25 (6 s); Dawn Ward × 1.2 |
| greatsword | `grove_greatsword` Grove Greatsword | `woodsmans_cleaver` Woodsman's Cleaver | `furnace_edge` Furnace Edge | `grief_of_brass` **Grief of Brass**: Crimson Pact's hp cost × 0.5 (ruling P5-b, was: costs no hp, which left Pact of Ash nothing to do); Nightfall × 1.1 |
| daggers | `grove_knives` Grove Knives | `thornpick_pair` Thornpick Pair | `twin_sparks` Twin Sparks | `twin_wicks` **Twin Wicks**: a hit from behind +5 Momentum, at most once a second (ruling P5-f: was unthrottled, so every auto from behind paid; the engine throttles `behind` at ≥ 1 s, `MOD_LIMITS.behindMinEveryS`); Ghost Edge × 1.15 (ruling P5-b, was: a perfect dodge resets your quick ability, which Tollwind's 5 pieces already do, and for 2 s after a dodge your next ability × 1.15, which Cinderstep's ×1.2 hid) |
| staff | `grove_staff` Grove Staff | `rowan_staff` Rowan Staff | `lampglass_rod` Lampglass Rod | `dawnlantern` **Dawnlantern**: Second Dawn's cast × 0.6; heals you give also shield 15% (cap 15) — and `ember_lens` **Ember Lens**: Hearthfall's cast × 0.75; a reaction you trigger gives +10 Momentum |

| off-hand | starter | T1 | T2 | T3 |
|---|---|---|---|---|
| buckler | `grove_buckler` Grove Buckler | `hedge_buckler` Hedge Buckler | `cog_buckler` Cog Buckler | `toll_buckler` Toll Buckler |
| quiver | `grove_quiver` Grove Quiver | `fletchers_quiver` Fletcher's Quiver | `ember_quiver` Ember Quiver | `lens_quiver` Lens Quiver |
| shield | `grove_shield` Grove Shield | `millward_shield` Millward Shield | `brass_kite` Brass Kite Shield | `beacon_shield` Beacon Shield |
| tome | `grove_tome` Grove Tome | `herbal_tome` Herbal Tome | `wickbound_tome` Wick-Bound Tome | `keepers_logbook` Keeper's Logbook |

That makes 25 weapons, 16 off-hands and 60 armour pieces: 101 items in all. Named effects are tunable ±30%.

**Item data:**

```ts
export interface ItemData {
  id: ItemId; name: string; slot: GearSlot; tier: 0 | 1 | 2 | 3; ilvl: 1 | 4 | 7 | 10;
  type?: ArmourType; set?: SetId; weapon?: WeaponId; offhand?: OffhandKind;
  named?: { line: string; mods: readonly Mod[] };
  model: number;                        // 0..255, the visual the client builds (unique per item except starter weapons may share)
  price?: number;                       // gold at the Smithy (T1 and only T1)
  seals?: number;                       // Warden's Seals at the Lampwright (T3 and only T3)
  sell: number;                         // gold the Smithy pays; 0 = cannot be sold (starter)
  rarity: 'starter' | 'common' | 'set' | 'named';   // colours: grey, white, green (T1) / blue (T2) / violet (T3), gold
}
```

- **Smithy prices (T1):** weapon 120, off-hand 50, chest 80, legs 65, head 55, hands 40, feet 40, back 35.
- **Sell values:** T1 20% of the price (rounded down); T2 armour 40, T2 weapon or off-hand 60; T3 armour 80, T3 off-hand 100, named 150; starter 0 (refused `'starter'`).
- **Lampwright (Seals, T3):** chest 4, legs 3, head 3, hands 2, feet 2, back 2, weapon 5, off-hand 2. A full kit is 23 Seals.

### Inventory (`shared/src/inventory.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `BAG_SLOTS` | 30 | unworn items in the bag |
| `BANK_SLOTS` | 60 | items in the Vault (only at its stall) |
| `GOLD_MAX` | 1 000 000 | gold never exceeds this (extra is dropped, with a notice) |
| `RECENT_KILLS` | 64 | kill keys remembered per adventurer for de-duplication |
| `STALL_REACH` | 3.5 m | stall operations need the adventurer within this of the stall, in the grove |
| `INV_OPS_PER_S` | 8 | operations per session (a token bucket of 8, refilling 8 a second; more → `'rate'`) |

```ts
export interface ItemInst { uid: number; item: ItemId; dye: [DyeId, DyeId] }
export interface InventorySave {
  v: 1; nextUid: number;
  bag: ItemInst[]; bank: ItemInst[];
  /** Per job: slot → the uid of a bag item. One item may be worn by several jobs; a worn item takes no bag slot. */
  gear: Partial<Record<JobId, Partial<Record<GearSlot, number>>>>;
  wardrobe: CostumeId[]; costumeDyes: Partial<Record<CostumeId, [DyeId, DyeId]>>;
  lootDays: { wickhound: string | null; fallen_warden: string | null };   // UTC day of the guaranteed drop
  recentKills: string[]; freeRespecUsed: JobId[];
}
```

- **The starter kit:** a new or migrated inventory holds:
  - the six `plain_*` pieces, worn by all seven jobs;
  - one starter weapon per weapon type, each worn by its jobs;
  - the four starter off-hands, each worn by its jobs.

  That is 16 items, uids 1–16, all dyed with the creator's two outfit dyes.
- **Repair on read** (`parseInventory`, never throws):
  - unknown item ids are dropped;
  - duplicate uids are dropped (the later one);
  - a gear ref to a missing uid, or to an item that does not fit, is dropped, and the slot falls back to the starter piece for that slot and job;
  - a job missing a weapon gets its starter weapon back (a new uid if it was sold, which cannot happen, or lost);
  - `nextUid` is above every uid;
  - lists are capped at their sizes. Overflow moves to the bank, then is dropped with `repaired: true`, logged once.
- **Operations** (`InvOp`), each pure in `applyInvOp(state, op, ctx) → { state, gold, seals } | { refusal }`:

| op | fields | where | rule |
|---|---|---|---|
| `equip` | `uid, slot` | anywhere | the bag item fits the slot and the **current** job; replaces that job's slot (the old item stays in the bag; if that makes the bag exceed `BAG_SLOTS` → `'bag-full'`) |
| `unequip` | `slot` | anywhere | head, chest, legs, hands, feet and back go back to the starter piece; weapon and off-hand cannot be emptied (`'fit'`) |
| `bank` / `unbank` | `uid` | the Vault | a worn item cannot be banked (`'worn'`); nor can a starter piece (`'starter'`: an unequip would mint another) |
| `sell` | `uid` | the Smithy | not worn, not starter; refused `'purse-full'` when the gold would pass `GOLD_MAX` |
| `buy` | `stall, item` | that stall | the Smithy sells T1 for gold; the Lampwright sells T3 for Seals; the bag needs room |
| `buyCostume` | `costume` | the Tailor | not owned (`'owned'`); not event-only (`'unknown'`) |
| `wear` | `slot: CostumeSlot, costume: CostumeId \| null` | anywhere | the current job's outfit; owned only |
| `hideHead` | `hide` | anywhere | hide the head piece and the head costume for the current job |
| `dye` | `uid, ch, dye` | the Tailor | `DYE_PRICE = 5` gold per change; same dye → no charge, no change |
| `dyeCostume` | `costume, ch, dye` | the Tailor | as `dye`, for an owned costume |
| `talent` | `row, choice` | town or sanctuary (`jobSwitch`) | the row is unlocked (`TALENT_LEVELS`) and empty (`'taken'`) |
| `respec` | — | the Guild Board (town only) | clears the current job's talents; the first per job is free, then `RESPEC_PRICE = 25` gold × rows chosen |

- Every op also needs: alive, out of combat (`'combat'`), not casting or charging (`'busy'`), not travelling.
- **Operation ids** (ruling P5-e): an `id` is a random string of 12–40 characters (`[A-Za-z0-9_-]`; shorter is refused); `buy`, `buyCostume` (gold), Seal purchases and bank moves without one are refused `'no-id'`; applied ops are remembered as `${op}:${id}`, the last `RECENT_OPS = 64`.
- **Uids:** when no uid is left to mint (`nextUid` past 2³¹ − 1), `buy` and a minting `unequip` are refused `'uids'`, and a loot drop is sold at once (never lost).
- **Refusals:** `InvRefusal = 'where' | 'combat' | 'busy' | 'dead' | 'unknown' | 'fit' | 'worn' | 'starter' | 'bag-full' | 'bank-full' | 'gold' | 'seals' | 'owned' | 'level' | 'taken' | 'rate' | 'no-id' | 'purse-full' | 'uids'`. Each has a fixed English line in `INV_TEXT`.
- Talents and outfits live in each job's `JobRecord`, gear in the inventory. The store writes inventory, gold, Seals, look and jobs together (Task 6), so a paid respec and its cleared talents land in one write.

### Stalls (`shared/src/world/zones.ts`)

`StallId = 'smithy' | 'tailor' | 'barber' | 'lampwright' | 'vault'`. `TOWN_STALLS: Record<StallId, { x; z; facing; keeper: string; name: string }>` stand in the grove around the Plaza of the Two:

| id | name | keeper | sells |
|---|---|---|---|
| `smithy` | Kettleworth Smithy | Hob Kettleworth | T1 gear for gold; buys any sellable item |
| `tailor` | Bobbin & Thimble | Wren Bobbin | costumes, dyes |
| `barber` | The Trimmed Hedge | Old Sorrel | looks |
| `lampwright` | The Lampwright | Ottilie Brasswick | T3 gear for Warden's Seals |
| `vault` | The Grove Vault | Clerk Amsel | the bank |

Placement rule (deterministic, tested):
- each stall stands on grove ground at radius 12–20 m from the statue;
- at least 4 m from the Guild Board, the statue's base, every obstacle and every other stall;
- at least 3 m off the plaza's walking lines to the exits (the straight lines from `SPAWN` to each exit);
- facing the statue.

The task searches angles in 15° steps from 30° in table order and records the chosen spots in the snapshot.

### Loot (`shared/src/loot.ts`)

Loot is **personal**: at a kill, every adventurer the server credits (the engine's credit after `MIN_CREDIT_FRAC`, plus Plan 4's party share) rolls its own loot. Items go straight into the bag. There are no ground drops, nothing to pick up and nothing to steal.

| source | gold | item chance | tier | notes |
|---|---|---|---|---|
| thornling, boar, archer (any zone but the Lampfall) | 1–3 | 6% | T1 | |
| mossback (outside the Lampfall) | 6–10 | 30% | T1 | |
| ordinary kinds in the Lampfall | 2–4 | 8% | T2 | |
| mossback in the Lampfall | 8–12 | 25% | T2 | |
| each pack encounter cleared | 10 | — | — | plus `CLEAR_XP` |
| wickhound | 25 | 100% on the adventurer's first kill each UTC day (`lootDays.wickhound`), else 25% | T2 | |
| fallen_warden | 60 | 100% on the first kill each UTC day (`lootDays.fallen_warden`), else 10% | T3 | plus Plan 4's Seal |
| lens_shard, dummy | 0 | 0 | — | |

Item chances are tunable ±50%, gold ±50%. Neither is tuned by Task 5: they are economy numbers, and Task 11 may report them.

**Which item:**
- the slot is a weapon or off-hand for the current job with chance 0.25 (an off-hand only if the weapon takes one, half of that 0.25), else an armour slot chosen uniformly;
- the armour type is the current job's `JOB_ARMOUR` with chance 0.6, else one of the other two;
- **no duplicates while new pieces remain:** if the adventurer already owns that item id (bag, bank or worn), re-roll the slot and type up to 3 times; after that the duplicate stands.

`JOB_ARMOUR`:

| job | armour |
|---|---|
| warrior, ranger, ninja | light |
| paladin, dark_knight | heavy |
| white_mage, black_mage | cloth |

**Bag full:** the item is sold at once for its sell value, with the notice "Your bag is full: <item> was sold for <n> gold".

**The roll** (`rollLoot(src, ctx, seedParts) → { gold; item: ItemId | null }`):
- mulberry32 seeded with cyrb53 of `serverSeed|roomId|enemyEid|killCounter|accountId`;
- `serverSeed` is a random 32-bit value made at process start (not the engine seed), so loot is unpredictable to clients but each kill rolls once.

### Costumes and dyes (`shared/src/items.ts`)

`CostumeSlot = 'body' | 'head' | 'back'`.
- A body costume hides chest, legs, hands and feet.
- A head costume hides the head piece.
- A back costume hides the back piece.

The weapon and off-hand always show.

| id | name | slot | price (gold) |
|---|---|---|---|
| `lamplighter_coat` | Lamplighter's Coat | body | 400 |
| `solstice_finery` | Solstice Finery | body | 1200 |
| `orchard_smock` | Orchard Smock | body | 300 |
| `harbour_oilskin` | Harbour Oilskin | body | 500 |
| `mothsilk_gown` | Moth-Silk Gown | body | 900 |
| `ploughmans_weeds` | Ploughman's Weeds | body | 300 |
| `straw_sunhat` | Straw Sunhat | head | 150 |
| `brass_goggles` | Brass Goggles | head | 400 |
| `owlfeather_circlet` | Owl-Feather Circlet | head | 350 |
| `patchwork_cape` | Patchwork Cape | back | 200 |
| `kitewing_mantle` | Kite-Wing Mantle | back | 600 |
| `mapmakers_satchel` | Mapmaker's Satchel | back | 250 |
| `starfall_regalia` | Starfall Regalia | body | event only (GM grant) |
| `beacon_halo` | Beacon Halo | head | event only (GM grant) |

- Costumes are never items: they live in the wardrobe and cannot be sold, banked or lost. There is never a real-money price.
- `DyeId` is 0–31. `DYES[0]` is "Undyed" (the piece's own colours); 1–31 are named colours (Task 2 lists them: original names such as Hearth Red, Moss, Beacon Gold, Dusk Violet, Ash, Chalk, Kingfisher, Rust).
- Every armour piece and costume has two dye channels.

### Talents (`shared/src/talents.ts`)

Each job has three rows. A row unlocks at its job level (4, 7, 10). The adventurer chooses one of three in each row. Talents are **sidegrades**: they change how a job plays, not how strong it is (band P2). Ids are `<job>_<row><a|b|c>` (row 1–3), and every effect is a `Mod`. Magnitudes are tunable ±30%.

| job | row 1 (level 4) | row 2 (level 7) | row 3 (level 10) |
|---|---|---|---|
| warrior | a Keen Edge: Slash ×1.15, cd +0.5 s · b Heavy Swing: Sunder ×1.12 · c Riposte: a parry gives +15 Momentum | a Long Cry: Rallying Roar +3 s · b Ringing Blow: Skullringer cd −3 s · c Second Wind: Mend ×1.3 | a Unbroken: Bulwark ×1.4 · b Blade Rhythm: a perfect dodge +10 Momentum · c Executioner: Sunder stagger +10 |
| ranger | a Quick Nock: Snap Shot cd −1 s · b Wildfire Tips: Pitch Arrow ×1.15 · c Drawn Breath: Charged Shot ×1.12 | a Field Medic: Field Dressing ×1.3 · b Pinned Fast: Pinning Shot cd −2 s · c Light Feet: Sprint +2 s, dodge refill ×0.85 | a Hailstorm: Barbed Rain ×1.25 · b Steady Aim: interrupting +20 Momentum · c Hunter's Patience: Charged Shot cd −2 s |
| paladin | a Ringing Rap: Shield Rap ×1.2 · b Verdict's Weight: Bright Verdict ×1.12 · c Stand Firm: +2 Momentum per hit taken (once a second) | a Long Shelter: Shelter +4 s · b Warm Kindle: Kindle ×1.25 · c Wide Ward: Dawn Ward ×1.25 | a Lasting Aegis: Aegis +1 s · b Stern Gaze: Taunt cd −3 s · c Mercy: heals you give also shield 20% (cap 15) |
| dark_knight | a Thirsting Rend: Grim Rend hp cost ×0.5 · b Long Night: Nightfall ×1.12 · c Pain Engine: +2 Momentum per hit taken (once a second) | a Shared Vein: Bloodbond +3 s · b Howling Dark: Dread Howl cd −5 s · c Deep Brand: Umbral Brand ×1.25 | a Pact of Ash: Crimson Pact hp cost ×0.5 · b Grave Bulwark: Grave Ward ×1.3 · c Unending: Crimson Pact +2 s |
| ninja | a Fang Flurry: Crossed Fangs cd −0.5 s · b Hobble: Hamstring ×1.12 · c Ghost Step: Ghost Edge cd −2 s | a Thick Smoke: Ashcloud cd −4 s · b Exposed: Weak Point +3 s · c Quick Hands: Quickstep cd −3 s | a Veil of Mist: Mist Form +1.5 s · b Shadow Tempo: a perfect dodge +10 Momentum · c Fourth Roll: +1 dodge charge |
| white_mage | a Tidecall: Tidelash ×1.15 · b Bright Flare: Lantern Flare's heal ×1.3 · c Swift Spring: Wellspring cast ×0.8 | a Dawn Haste: Second Dawn cast ×0.75 · b Long Rain: Soft Rain +2 s · c Thick Veil: Mistveil ×1.25 | a Mote Swarm: Sun Mote ×1.2 · b Calm Font: heals you give also shield 15% (cap 15) · c Deep Well: Wellspring ×1.2 |
| black_mage | a Hot Coals: Cinder Dart ×1.15 · b Quick Arc: Skyfall Arc cast ×0.8 · c Banked Fire: Hearthfall cast ×0.8 | a Kinship: Kindred Spark cd −5 s · b Bedrock Ward: Bastion Stone ×1.25 · c Cage Snap: Stormcage cd −3 s | a Deep Roots: Rootbreak ×1.25 · b Live Wire: a reaction you trigger +10 Momentum · c Wildfire: Hearthfall ×1.12 |

"×" on an ability means `coef` for damage abilities and `amount` for heal and shield abilities. "+n s" means `buffS`.

**Rules:**
- Choosing a talent is free.
- Retraining (`respec`) clears all three rows: the first time per job is free, then 25 gold per chosen row.
- `JobRecord.talents` holds the chosen ids. Only ids of that job, one per row, with the row unlocked at the record's level, are kept by `parseJobsSave`; others are dropped (repaired).
- `SIM_TALENTS[job]` is the simulation's default build, one per row, each acting on the job's bar or duo picks (Task 5; was `['<job>_1a', '<job>_2a', '<job>_3a']`, 7 of which did nothing with the duo picks): warrior 1a 2c 3b; ranger 1a 2b 3b; paladin 1a 2c 3a; dark_knight 1a 2a 3a; ninja 1a 2a 3b; white_mage 1a 2b 3c; black_mage 1a 2b 3a.

### Mods (`shared/src/mods.ts`), the one vocabulary for sets, named weapons and talents

```ts
export type ModSlot = 'quick' | 'finisher' | 'signature';
export type MomentumEvent = 'parry' | 'perfectDodge' | 'interrupt' | 'hitTaken' | 'detonate' | 'react' | 'castDone'
  | 'cleanse' | 'revive' | 'behind';   // ruling P5-b: an ability's cleanse lands; a revive lands; a hit counts as from behind
export type Mod =
  | { k: 'coef'; ability: AbilityId; mult: number }                 // its damage effects' coef
  | { k: 'amount'; ability: AbilityId; mult: number }               // its heal and shield amounts
  | { k: 'cd'; ability: AbilityId; add: number }                    // cooldown, never below 1 s
  | { k: 'cast'; ability: AbilityId | 'all'; mult: number }         // cast time, never below 0.3 s (instants stay instant)
  | { k: 'buffS'; ability: AbilityId; add: number }                 // its buff, debuff and shield durations
  | { k: 'given'; mult: number }                                    // ruling P5-b: × every ability heal and shield amount it gives (not Soft Rain ticks, not kit shields)
  | { k: 'hpCost'; ability: AbilityId; mult: number }               // its hp-cost (0 allowed)
  | { k: 'stagger'; ability: AbilityId; add: number }
  | { k: 'finisherCost'; add: number }                              // finishers' cost, never below 30
  | { k: 'momentumOn'; on: MomentumEvent; amount: number; everyS?: number }
  | { k: 'dodge'; charges?: number; refillMult?: number }           // charges: at most +1 in total over the job's own
  | { k: 'healShield'; frac: number; cap: number; overhealOnly?: true }   // heals given also shield the healed (6 s)
  | { k: 'cdOnCast'; s: number }                                    // a completed cast: other cooldowns −s
  | { k: 'afterDodge'; mult: number; s: number }                    // the next ability within s of a dodge's start
  | { k: 'staggerMult'; mult: number }
  | { k: 'lowHpShield'; frac: number; below: number; everyS: number }
  | { k: 'auraTaken'; mult: number; r: number }                     // allied adventurers (not self) within r
  | { k: 'lastStand'; everyS: number; iframesS: number }
  | { k: 'resetOn'; on: 'perfectDodge'; slot: 'quick' }
  | { k: 'shieldOn'; on: 'taunt'; amount: number; s: number };
export interface Kit { stats: Stats; mods: readonly Mod[] }
export function parseMods(v: unknown): Mod[];   // strict; drops unknown kinds, bad ids, non-finite numbers
```

**Stacking:**
- `mult` values of the same kind and ability multiply, and `add` values sum;
- `momentumOn` entries for the same event sum, and the smallest `everyS` wins;
- `healShield` entries sum their `frac`, and the largest `cap` wins;
- `auraTaken` uses the strongest single aura on the receiver (no stacking across sources);
- `resetOn` is idempotent;
- `lastStand` and `lowHpShield` use the shortest `everyS`;
- `given` multiplies like any `mult`, except that two sources of it follow ruling P5-a (the larger applies);
- ranges (Task 2 review): `lastStand.everyS` is at least 30, and a `momentumOn.everyS`, when given, is above 0.

## Looks (`shared/src/look.ts`)

```ts
export type PeopleId = 'human' | 'larchfolk' | 'knollfolk' | 'brindlekin';
export type FuturePeopleId = 'skyfolk';                // a data hook only
export interface Look {
  v: 1; people: PeopleId;
  body: { height: number; build: number; shoulders: number; hips: number; legs: number; head: number };   // integers 0..20, 10 = the people's average
  face: { shape: number; eyes: number; brows: number; nose: number; mouth: number; ears: number; marks: number };
  hair: { style: number; facial: number };
  colours: { skin: number; hair: number; facial: number; eyes: number; marks: number };   // 0xRRGGBB
  fur: { pattern: number; colour: number; tail: number } | null;   // brindlekin only (null for the others)
  style: { stance: number; walk: number };
  outfit: { dye1: DyeId; dye2: DyeId };                            // the starter kit's colours
}
```

| field | range | meaning |
|---|---|---|
| `face.shape` | 0–5 | round, oval, square, heart, long, soft |
| `face.eyes` | 0–7 | shapes, from round to narrow, with lids |
| `face.brows` | 0–7 | none to heavy, flat to arched |
| `face.nose` | 0–7 | button to long; brindlekin: the muzzle's shape |
| `face.mouth` | 0–5 | |
| `face.ears` | 0–3 (brindlekin 0–5) | brindlekin: pointed, round, long, folded, tufted, lop |
| `face.marks` | 0–7 | none, freckles, left scar, right scar, cheek paint bands, beauty mark, dot tattoos, brow paint |
| `hair.style` | 0–19 | 20 hair styles, shared by every people (including bald and a hood of braids) |
| `hair.facial` | 0–7 | none, stubble, short beard, full beard, braided beard, moustache, sideburns, goatee |
| `fur.pattern` | 0–3 | solid, striped, spotted, masked |
| `fur.tail` | 0–3 | short, brush, long, ringed |
| `style.stance` | 0–3 | easy, proud, guarded, sprightly |
| `style.walk` | 0–3 | stride, stroll, bounce, prowl |

**Peoples** (`PEOPLES`; looks only, no stat differences; each has a base height, proportions and default colour ranges; any colour is allowed):

| id | name | height (m, at 10) | slider span | shape |
|---|---|---|---|---|
| `human` | Humans | 1.75 | ±10% | as now |
| `larchfolk` | Larchfolk | 1.98 | ±8% | tall and long-limbed, narrow shoulders, long pointed ears (ears picks the length), bark-flecked skin markings allowed |
| `knollfolk` | Knollfolk | 1.30 | ±8% | small and sturdy, broad hands and feet, a big head (×1.15), round ears |
| `brindlekin` | Brindlekin | 1.70 | ±10% | beast-folk: fur instead of skin (the `skin` colour is the fur's base), a muzzle, animal ears and a tail, padded hands |

Other parts of the look:
- **Emotes** (`EMOTES`): `wave`, `bow`, `cheer`, `laugh`, `sit` and `point`, available to everyone (no unlock).
- **Codes:**
  - `encodeLook(look) → string`: base64url of a fixed 28-byte layout, ≤ 38 characters;
  - `decodeLook(s) → Look | null`, strict;
  - `encodeGearLook(g) → string`: per visible slot, the model (1 byte) and two dyes (5 bits each), plus a costume flag byte, ≤ 40 characters;
  - `GearLook = Record<GearSlot, { model: number; dye: [DyeId, DyeId] } | null> & { hideHead: boolean }`, already resolved for costumes (a costumed slot carries the costume's model, which lives in a separate 200–255 model range).
- **`parseLook(v)`:** strict. Exact keys, integers in range, colours 0..0xFFFFFF, `fur` non-null exactly for brindlekin. Anything else gives null.
- **`defaultLook(seed: string)`:** a varied, valid look derived from cyrb53 of the seed (the account id). People, sliders, face, hair and colours are all spread, and colours are drawn from each people's default ranges. Every existing adventurer and every bot gets one.
- **`randomLook(rng)`:** the creator's "Surprise me" and the bots.
- **`barberCost(old, new)`:** 0 if equal; 200 if `people` changed; else 40.

**Names** (`shared/src/names.ts`, `shared/src/badwords.ts`): the filter's behaviour is unchanged (every case in `names.test.ts`), but no plain-text slur list ships.
- `badwords.ts` holds `BAD_WORD_HASHES: readonly string[]`, the cyrb53 base-36 hash (seed `0x5e2`) of each long entry in normalised, repeat-collapsed form, plus `BAD_WORD_LENGTHS`, the distinct entry lengths.
- It also holds `SHORT_BAD_HASHES: readonly { h: string; runs: string }[]`: the hash of each short entry's collapsed letters, and its minimum run lengths (for "ass", letters "as" and runs `'12'`).
- `holdsBlocked` searches every window of the collapsed text whose length is in `BAD_WORD_LENGTHS` and checks its hash. The exempt-range logic is unchanged.
- Short words are matched by hashing each candidate word's collapsed letters (as is, without a final "s", and without a final "es") and checking the run lengths.
- `ALLOWED_WORDS`, `RESERVED_WORDS` and `RESERVED_NAMES` stay in plain text (they are innocent words and staff or hero names).
- The test fixture `shared/src/names.fixture.ts` holds the long and short lists **ROT13-encoded** (tests only; never imported by `index.ts`), so the tests still try every entry.
- The maintainer script `shared/scripts/blocklist-hash.ts` reads a plain list on stdin (never committed) and prints the hash arrays and the ROT13 fixture.

## Tuning and the bands

**Skill levels** (Plans 3b and 4; `skilled` is being added by a parallel worker):
- `Skill = 'careful' | 'skilled' | 'sloppy' | 'careless'`;
- careful misses nothing; skilled misses a seeded 10% (`SKILLED_MISS = 0.1`); sloppy misses 30% (`SLOPPY_MISS`); careless never dodges.

If `'skilled'` is not on the branch when Task 5 starts, Task 5 adds it to `sim.ts` exactly so: a sloppy-style miss rate of 0.1 with the same seeding.

**Band definition:** every band is a rate over at least 20 seeds per party (seeds 1–20 in the committed test). The committed threshold must leave **at least 3 standard deviations of headroom**, both on seeds 1–20 and on a held-out run on seeds 1001–1020 (scratch script, not committed). For a measured count k of n runs, with p̂ = k / n:
- a lower bound t needs k − t ≥ 3·√(n·p̂·(1 − p̂));
- an upper bound needs t − k ≥ 3·√(n·p̂·(1 − p̂)).

If p̂ is 0 or 1, use p̂ = 0.5/n (or 1 − 0.5/n). When the headroom is short, tune (Task 5), never loosen the threshold below what the band means.

**Party sets:**
- `GEAR_PAIRS` = `[paladin, black_mage]`, `[warrior, white_mage]`, `[ninja, white_mage]` and `[dark_knight, ranger]` (four of Plan 4's `STRONG_PAIRS`; 80 runs over 20 seeds);
- `SOLO_JOBS` = all seven.

**Kits:**
- "starter" is the starter kit;
- "Tn" is a full Tn kit in each job's `JOB_ARMOUR` set (5-piece bonus active, the sixth piece of the same set) with the Tn weapon and off-hand. The staff for T3 is `dawnlantern` for the White Mage and `ember_lens` for the Black Mage;
- level 10 and `SIM_TALENTS` unless stated.

| id | band | runs | threshold (committed) | target when tuning |
|---|---|---|---|---|
| **P1** | parity: `kitFor` at level 10 with the starter kit and no talents gives exactly `STARTER_STATS` and no mods, for every job; Plan 4's W1–W6, E1–E5 and G1 still pass unchanged | unit + existing | exact | — |
| **P2** | talents are sidegrades: GEAR_PAIRS skilled, starter kit, `SIM_TALENTS` vs no talents, against the Warden | 80 + 80 | \|wins(talents) − wins(none)\| ≤ 3 SD of the no-talent count | equal within noise |
| **P3** | no talent is a trap or a must: each of the 63 talents alone, its job solo careful at level 10 in starter gear vs the Mossback | 20 each | mean TTK within ±15% of that job's no-talent mean; wins ≥ no-talent wins − 2 | ±8% |
| **G2** | dungeon gear turns an average duo into a winner: GEAR_PAIRS sloppy in T2 vs the Warden; the same pairs sloppy in starter | 80 + 80 | T2 wins ≥ 48 of 80 and each pair ≥ 10 of 20; starter wins ≤ 40 of 80 | T2 ≈ 75%, starter ≈ 25% |
| **G3** | T1 is a real but small step: GEAR_PAIRS sloppy in T1 | 80 | starter wins ≤ T1 wins ≤ T2 wins (counts from G2's runs, same seeds) | between |
| **G4** | T2 is not top gear: SOLO_JOBS careful solo in T2 vs the Warden | 140 | ≤ 14 of 140 | ≈ 3% |
| **G5** | top tier makes a solo kill possible, for strong play only: SOLO_JOBS careful solo in T3; SOLO_JOBS sloppy solo in T3 | 140 + 140 | careful: ≥ 28 of 140, and at least 3 jobs ≥ 6 of 20; sloppy: ≤ 28 of 140 | careful ≈ 35%, sloppy ≈ 8% |
| **G6** | a skilled duo in starter gear can win (the Warden is hard, not a wall) | 80 | ≥ 32 of 80 | ≈ 60% |
| **L1** | level 1 is playable: SOLO_JOBS careful at level 1 in starter gear vs a Thornling | 20 each | each job ≥ 19 of 20, mean TTK ≤ 20 s | ≈ 15 s |
| **L2** | elites are an early wall but a mid-level goal: SOLO_JOBS careful vs the Mossback at level 1 starter, and at level 5 in T1 | 140 + 140 | level 1: ≤ 105 of 140; level 5 T1: ≥ 98 of 140 | ≈ 50% and ≈ 90% |
| **F1** | top gear does not trivialise the Greenway: SOLO_JOBS careful at level 10 in T3 vs a Thornling and vs the Mossback | 20 each | every job: Thornling mean TTK ≥ 4.0 s; Mossback mean TTK ≥ 14 s | ≈ 5.5 s and ≈ 20 s |
| **F2** | careless play still dies in top gear: GEAR_PAIRS careless in T3 vs the Warden | 80 | ≤ 64 of 80 | ≈ 50% |
| **G2b** (Task 5) | T2 clearly beats the starter kit: GEAR_PAIRS sloppy, T2 vs starter | 80 + 80 | T2 − starter wins > 3 SD of the difference | — |
| **G7** (Task 5) | top gear usually wins for an average duo: GEAR_PAIRS sloppy in T3 | 80 | ≥ 64 of 80 | — |

**Tuned by Task 5** (two passes; every value at its new place in the tables above):
- KIT_TABLE T3: power 11 → 8.3 (then 9 and T1 2.5 → 3 for whole numbers), defence 16 → 12, health 90 → 68, special 20 → 14 (the bottom of each range). At the old values sloppy duos beat the Warden in 105–124 s with no deaths, careful solo won 108 of 140 and a T3 Black Mage or White Mage killed a Thornling in 2–3 s.
- Cloth `TYPE_MULT`: defence 0.6 → 0.5, health 0.85 → 0.75; Lenslight `given` × 1.15 → × 1.105 and `finisherCost` −10 → −7. Lenslight was the fastest set for every job in every scenario (Focus); it still is for six jobs by about 5% (see Task 5's report: a ruling on Focus is needed).
- `SIM_TALENTS`: see Talents (every pick now acts on the duo picks).
- Not met after tuning, `it.skip` with the measured numbers (deferred to live tuning): G2's starter ceiling (51 and 55 of 80, P1 makes it Plan 4's number), G5 sloppy (52 of 140: self-healing jobs win alone sloppy or careful), F1's Thornling floor (the Ranger 2.9 s). Passing with less than 3 SD headroom on seeds 1–20: G2's per-pair floor (Dark Knight + Ranger 12 of 20) and L2's level-1 ceiling (100 of 140; Greenway outcomes are per job, not random).
- T3 makes the Warden a formality for duos of any skill but careless (80 of 80, 0 deaths, 120–150 s). A harder mode is proposed in Task 5's report, not applied.

The Greenway is **not** scaled down for high levels or gear (F1 accepts the speed-up). A player who outgrows it has the Lampfall.

**Speed:**
- each new band file runs in ≤ 60 s on this machine;
- the whole combat suite runs in ≤ 180 s, with Vitest running files in parallel;
- profile before cutting runs; a band's seed count never drops below 20.

**Tuning rule (Task 5 only).** If a band fails or lacks headroom, change only these, each within the range given. Record every change (before → after) in the task report and in Task 12's Outcome.
- The T1, T2 and T3 rows of the kit table (each value ±25%, specials ±30%). Never the starter row.
- The armour type multipliers, within the ranges in the table.
- `baseStats(1)` within the ranges shown. Never `baseStats(10)`.
- Set bonus, named weapon and talent magnitudes (each number ±30%; caps and durations included; never a kind).
- `SIM_TALENTS` letters.

Never change:
- Plan 3, 3b or 4 numbers, formulas, abilities, enemies or bosses;
- `MIN_CREDIT_FRAC`;
- the xp curve, loot, gold or prices;
- `STARTER_STATS` or the starter kit.

If a band cannot pass within the ranges, report it with the measured table and stop: the band is wrong or the design is, and that is a ruling for the owner.

### Why these numbers give the bands

- **Parity (P1):** level 10 + the starter kit is 9 + 1 power, 8 + 2 defence and 90 + 10 hp, which equals `STARTER_STATS`. Plan 4's bands were measured there, so a fresh cap adventurer in starter gear faces exactly Plan 4's Warden.
- **G2:** T2 at level 10 is Plan 4's G1 mid-tier stand-in (13 / 14 / 130). Plan 4 measured it as at least 15% faster for careful duos.
  - For sloppy duos, +30% damage shortens the fight by about 23%. That brings the 300 s enrage within reach: Plan 4's sloppy duos mostly lost to the enrage or to the extra hits.
  - Defence 14 cuts each hit by about 9%, and hp 130 survives about 1.3 more uncured hits. Set bonuses and Flow or Focus add about 5–10% on top.
  - The expected result moves Plan 4's W3 (wins in [3, 30] of 60) to about 70–80%.
- **G4 and G5:** solo at T2 is still about 13 × 1.1 against 7800 hp: about 450 s, past the enrage. At T3 (20 power, 24 defence, 180 hp, the five-piece bonus and the named weapon), solo damage is about 2× starter, so the fight takes about 290 s for the fastest jobs. That is just inside the enrage, with no room for mistakes: "soloable only in the top tier" and "near-perfect play".
- **F1:** a Thornling (Plan 3b median 11.2 s at power 10) takes about 5.6 s at power 20. That is fast, and still more than a single button press. The Mossback (50.8 s) takes about 25 s.
- **L1:** level 1 in starter gear is 7 / 7 / 82: about 70% of the damage, so a Thornling takes about 16 s, and about 18% less hp. That is comfortable for ordinary enemies; the Mossback is a wall until about level 5 in T1 (L2).

### Gold and time to gear (for the owner; not tuned)

- Greenway solo earns about 2 gold and 10 xp per 15–20 s kill: about 6–8 gold a minute.
- A T1 kit (armour, weapon and off-hand) is 485 gold by the Smithy prices (435 for the Dark Knight and Ninja, who use no off-hand). Measured in `economy.test.ts` (Task 2; the owner accepted it): about 106 Thornling kills, which is about 30 minutes, keeping or selling drops (88 kills and about 25 minutes without an off-hand).
- A Lampfall run (about 15 minutes) gives about 640 xp, about 120 gold and about 1.5 T2 pieces.
- T3 takes 23 Seals (21 without an off-hand; one a UTC day) minus daily T3 drops. Measured in `economy.test.ts` (Task 2; the owner accepted it): **a full T3 kit is about 9 Warden days**, ranging from 5 to 14 days over 20 accounts per job. That is faster than first estimated, because the guaranteed daily T3 drop arrives alongside each day's Seal.
- Costumes cost 150–1200 gold. The Barber costs 40 (200 to change people). A respec costs 25 gold per row after the first, which is free.
- Level 1 to 10 takes about 3180 xp per job: about 2 hours of Greenway play, or 5 Lampfall runs, faster with catch-up.

## Review Focus

1. **Duplication and races.** Each of these ends with item uids unique across bag, bank and gear, gold and Seals conserved (Δ = loot + sales − purchases), and nothing lost. → Tasks 2, 6.
   - 50 concurrent `equip`/`unequip`/`sell`/`buy` messages in one tick;
   - selling while equipping the same uid;
   - buying with exactly enough gold twice at once;
   - a disconnect after `buy` is sent (the write lands once or not at all, and the next join shows the truth);
   - a relog from a second tab mid-queue (Plan 1's single-session rule);
   - a kill processed twice (`recentKills`);
   - a Seal awarded while a Seal purchase is in flight;
   - a full bag at a loot roll (sold, with a notice);
   - a stale `inv_version` (a retry once, then the stored truth).
2. **Never trust the client.** Each is refused with the right `InvRefusal` and no change. → Tasks 2, 6.
   - forged uids, item ids, stall ids, costume ids, dye ids, rows or choices, including junk types, NaN, negative numbers and long strings;
   - buying away from the stall or in the Greenway; buying T3 at the Smithy; buying an event costume;
   - equipping a bow on a Paladin, or a shield on a Ninja;
   - equipping in combat, dead, casting, charging or during travel;
   - choosing a talent above the job's level or outside a town or sanctuary;
   - a `look` with an out-of-range slider, or fur on a Human;
   - 30 operations a second (`'rate'`).
3. **Names.** Every listed word (from the ROT13 fixture), spaced, doubled and with look-alikes, is refused; every innocent case still passes. No source file, built client bundle or server bundle contains a plain blocklist entry (checked by a test that ROT13-decodes the fixture and greps `client/dist-online` and `server/dist` when they exist). → Task 3.
4. **GM tools.** → Task 7.
   - A non-GM's `/gm …` is dropped silently: no broadcast, no reply, no audit row beyond a refused one.
   - No client message, route or field can set `isGm`; the role changes only through the CLI.
   - Every GM command, success or refusal, writes one audit row.
   - Rate limits and amount caps hold.
   - The client bundle has no GM command list.
   - Offline grants land exactly once.
5. **Parity and determinism.** P1 holds. Two engines with the same seed, kits and intents give identical TickOut streams through a Warden fight with every set bonus and named weapon. → Tasks 4, 5.
6. **Bandwidth.** `look` and `gear` are sent on view entry and on change only. The clustered 100-walker grove run stays ≤ 11.5 KiB/s per client, with varied looks and gear. → Tasks 6, 11.
7. **Migration.** These all load with no lost level and no lost Seals: a 3b save at xp 450 (level 5, 50% through) and at 900 (the cap); a Plan 4 row with Seals and titles; a guest; garbage `inventory` JSON. Each gets the starter kit worn, a default look and one free creator visit. → Tasks 1, 6.

---

### Task 1: Shared progression data: the level curve and xp migration, base stats, `Mod`, `Kit` and talents

**Files:**
- Create:
  - `shared/src/progression.ts`;
  - `shared/src/mods.ts`;
  - `shared/src/talents.ts`;
  - `shared/src/progression.test.ts`, `shared/src/talents.test.ts`.
- Modify:
  - `shared/src/combat/jobXp.ts`: the curve; re-export from `progression.ts`, keeping `XP_PER_LEVEL` exported as a deprecated alias of `XP_TO_NEXT[0]` for any reader;
  - `shared/src/combat/jobs.ts`: `JobRecord.outfit`, `JobsSave.curve`, the talent and curve repair in `parseJobsSave`, and `isJobsSave`;
  - `shared/src/combat/stats.ts`: optional `focus`, `flow`, `guard`;
  - `shared/src/combat/constants.ts`: `MIN_CREDIT_FRAC` in the new section;
  - `shared/src/combat/jobs.test.ts`: the 3b repair cases keep passing; new cases added;
  - `shared/src/index.ts`, `shared/src/combat/index.ts`: exports.

**Interfaces:**
- Produces:
```ts
// progression.ts
export const XP_TO_NEXT: readonly number[];          // 9 entries
export const XP_CURVE_VERSION = 2; export const CATCH_UP_MULT = 1.5; export const CLEAR_XP = 30;
export const TALENT_LEVELS: readonly [4, 7, 10];
export function totalTo(level: number): number;       // xp from level 1 to `level`
export function migrateStubXp(xp: number): number;
export function baseStats(level: number): Stats;      // levels outside 1..10 clamp
export function catchUp(s: JobsSave, job: JobId): number;   // CATCH_UP_MULT or 1
// mods.ts: Mod, ModSlot, MomentumEvent, Kit, parseMods (as under Numbers)
// talents.ts
export type TalentId = `${JobId}_${1 | 2 | 3}${'a' | 'b' | 'c'}`;
export interface TalentData { id: TalentId; job: JobId; row: 0 | 1 | 2; choice: 0 | 1 | 2; name: string; desc: string; mods: readonly Mod[] }
export const TALENTS: Readonly<Record<TalentId, TalentData>>;
export function talentsFor(job: JobId): readonly (readonly [TalentData, TalentData, TalentData])[];   // 3 rows
export function talentMods(job: JobId, level: number, ids: readonly string[]): Mod[];   // unlocked ones only
export const SIM_TALENTS: Readonly<Record<JobId, readonly TalentId[]>>;
// jobs.ts
export interface JobOutfit { body: CostumeId | null; head: CostumeId | null; back: CostumeId | null; hideHead: boolean }
export interface JobRecord { level: number; xp: number; picks: [AbilityId, AbilityId]; talents: string[]; outfit: JobOutfit | null }
export interface JobsSave { current: JobId; jobs: Partial<Record<JobId | FutureJobId, JobRecord>>; curve?: 2 }
// CostumeId is declared in items.ts (Task 2); until it lands, jobs.ts declares `type CostumeId = string` locally and Task 2 replaces it.
```
- **Rules:**
  - `parseJobsSave` converts `xp` with `migrateStubXp` exactly once, when `curve` is absent, and returns `curve: 2`. A save that needed it is not `isJobsSave` as stored, so the room's repair write-back stores it.
  - `talents` keeps only valid ids of that job, one per row, with the row unlocked at the record's level. `outfit` keeps a `JobOutfit` with string-or-null slots (ownership is checked by the server against the wardrobe).
  - `newJobsSave` returns `curve: 2`.
  - `addJobXp` caps at `totalTo(10)`.
  - `XP_TO_NEXT` and the talent table are exactly as under Numbers; descriptions are one plain sentence each.

- [ ] **Step 1: Write the failing tests.**
  - `progression.test.ts`:
    - `it('the curve: 100 to level 2, 3180 to level 10, levelForXp and xpToNext agree at every boundary')`;
    - `it('migrateStubXp keeps every stub level and its share of progress: 0→0, 50→50, 450→680+160, 900→3180, 5000→3180')`;
    - `it('baseStats(10) is 9 / 8 / 90; baseStats(1) is 6 / 5 / 72; every step rises')`;
    - `it('catchUp is 1.5 below the highest job level, 1 otherwise')`;
    - `it('parseMods refuses unknown kinds, unknown abilities and non-finite numbers')`.
  - `talents.test.ts`:
    - `it('every job has 3 rows of 3; ids, rows and names are unique; every mod names an ability of its own job')`;
    - `it('talentMods keeps only unlocked rows at the job level')`;
    - `it('SIM_TALENTS names one per row')`.
  - `jobs.test.ts`:
    - `it('a 3b save converts once: curve absent → curve 2 and levels kept; a curve-2 save is untouched')`;
    - `it('talents of another job, two in one row, or above the level are dropped; outfit garbage → null')`.
- [ ] **Step 2: Run `npx vitest run shared/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Commit the types (`mods.ts`, the `Stats` and `JobRecord` changes, and `progression.ts` signatures) as soon as `npm run typecheck` is clean, so Task 2 can start: `feat: progression types (curve, mods, kits)`. Then finish the data.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
  - A server test that reads `XP_PER_LEVEL` levels keeps passing through the alias, or is updated to the curve (only the number, keeping its intent).
  - `server/src/store/*` must still accept new and old saves: `isJobsSave` now expects `curve: 2`. Old rows are repaired on read.
- [ ] **Step 5: Commit**: `feat: the job level curve with 3b progress migration, base stats by level, mods and talents`.

### Task 2: Shared gear data: slots, items, sets, weapons, costumes, dyes, loot, vendors and stalls, inventory rules, `kitFor`

**Files:**
- Create:
  - `shared/src/items.ts`, `shared/src/loot.ts`, `shared/src/inventory.ts`;
  - `shared/src/kit.ts` (`kitFor`);
  - `shared/src/items.test.ts`, `shared/src/loot.test.ts`, `shared/src/inventory.test.ts`.
- Modify:
  - `shared/src/world/zones.ts` (`StallId`, `TOWN_STALLS`, `STALL_REACH`, `stallAt(x, z)`);
  - `shared/src/world/zones.test.ts`, `shared/src/world/__snapshots__/*` (stall spots; a deliberate snapshot change);
  - `shared/src/combat/jobs.ts` (replace the local `CostumeId` with the import);
  - `shared/src/index.ts`.

**Interfaces:**
- Consumes: Task 1 (`Mod`, `Kit`, `baseStats`, `talentMods`).
- Produces:
```ts
// items.ts
export type GearSlot = 'head' | 'chest' | 'legs' | 'hands' | 'feet' | 'back' | 'weapon' | 'offhand';
export const GEAR_SLOTS: readonly GearSlot[]; export const ARMOUR_SLOTS: readonly GearSlot[];
export type ArmourType = 'cloth' | 'light' | 'heavy' | 'plain';
export type OffhandKind = 'buckler' | 'quiver' | 'shield' | 'tome';
export const OFFHAND_FOR: Readonly<Record<WeaponId, OffhandKind | null>>;
export type SetId = 'plain' | 'mossweave' | 'thornrunner' | 'rootbound' | 'wickthread' | 'cinderstep' | 'brassbound' | 'lenslight' | 'tollwind' | 'beaconstone';
export interface SetData { id: SetId; name: string; tier: 0 | 1 | 2 | 3; type: ArmourType; bonus3: readonly Mod[]; bonus5: readonly Mod[]; desc3: string; desc5: string }
export const SETS: Readonly<Record<SetId, SetData>>;
export type ItemId = string;                       // the ids under Numbers; isItemId narrows
export interface ItemData { /* as under Numbers */ }
export const ITEMS: Readonly<Record<ItemId, ItemData>>; export function isItemId(v: unknown): v is ItemId;
export const KIT_TABLE: Readonly<Record<0 | 1 | 2 | 3, { power: number; defence: number; maxHp: number; special: number }>>;
export const TYPE_MULT: Readonly<Record<ArmourType, { defence: number; maxHp: number }>>;
export const SLOT_WEIGHT: Readonly<Record<Exclude<GearSlot, 'weapon' | 'offhand'>, number>>;
export function itemStats(id: ItemId): Required<Stats>;      // the piece's own contribution (no base)
export function fits(id: ItemId, slot: GearSlot, job: JobId): boolean;
export const JOB_ARMOUR: Readonly<Record<JobId, Exclude<ArmourType, 'plain'>>>;
export function starterItems(): readonly ItemId[];           // the 16, uid order
export function kitItems(tier: 1 | 2 | 3, job: JobId): Record<GearSlot, ItemId | null>;   // the sim's full kits
export type CostumeSlot = 'body' | 'head' | 'back';
export type CostumeId = 'lamplighter_coat' | 'solstice_finery' | 'orchard_smock' | 'harbour_oilskin' | 'mothsilk_gown' | 'ploughmans_weeds'
  | 'straw_sunhat' | 'brass_goggles' | 'owlfeather_circlet' | 'patchwork_cape' | 'kitewing_mantle' | 'mapmakers_satchel' | 'starfall_regalia' | 'beacon_halo';
export interface CostumeData { id: CostumeId; name: string; slot: CostumeSlot; price: number | null /* null: event only */; model: number /* 200..255 */ }
export const COSTUMES: Readonly<Record<CostumeId, CostumeData>>;
export type DyeId = number;                                  // 0..31
export const DYES: readonly { name: string; hex: string }[]; // 32, [0] = Undyed
// kit.ts
export function kitFor(o: { job: JobId; level: number; gear: Partial<Record<GearSlot, ItemId>>; talents: readonly string[] }): Kit;
export function setCounts(gear: Partial<Record<GearSlot, ItemId>>): Partial<Record<SetId, number>>;
// loot.ts
export type LootSource = { kind: EnemyKindId; zone: ZoneId } | { clear: EncounterId };
export interface LootCtx { job: JobId; owned: ReadonlySet<ItemId>; day: string; lootDays: InventorySave['lootDays'] }
export function lootTable(src: LootSource): { gold: [number, number]; chance: number; tier: 1 | 2 | 3 | null; daily?: 'wickhound' | 'fallen_warden' };
export function rollLoot(src: LootSource, ctx: LootCtx, seedParts: readonly (string | number)[]): { gold: number; item: ItemId | null; daily: boolean };
export function cyrb53(s: string, seed?: number): number;     // shared with names.ts and look.ts
// inventory.ts
export const BAG_SLOTS = 30; export const BANK_SLOTS = 60; export const GOLD_MAX = 1_000_000; export const RECENT_KILLS = 64;
export const DYE_PRICE = 5; export const RESPEC_PRICE = 25; export const INV_OPS_PER_S = 8;
export interface ItemInst { /* … */ } export interface InventorySave { /* … */ }
export type InvOp = /* the table under Numbers, discriminated by op */;
export type InvRefusal = /* as under Numbers */; export const INV_TEXT: Readonly<Record<InvRefusal, string>>;
export function parseInvOp(v: unknown): InvOp | null;                 // strict: types, ranges, string lengths ≤ 40
export function newInventory(dyes: [DyeId, DyeId]): InventorySave;     // the starter kit, worn by every job
export function parseInventory(v: unknown): { inv: InventorySave; repaired: boolean };
export interface InvState { inv: InventorySave; gold: number; seals: number; jobs: JobsSave }
export interface InvCtx { stall: StallId | null; jobSwitch: boolean; townBoard: boolean; inCombat: boolean; dead: boolean; busy: boolean }
export function applyInvOp(s: InvState, op: InvOp, ctx: InvCtx): { state: InvState; dGold: number; dSeals: number } | { refusal: InvRefusal };
export function addLoot(s: InvState, item: ItemId | null, gold: number, killKey: string): { state: InvState; dGold: number; soldFor: number | null; dup: boolean };
export function wornBy(inv: InventorySave, uid: number): JobId[];
export function gearItems(inv: InventorySave, job: JobId): Partial<Record<GearSlot, ItemId>>;
export interface InventoryView { bag: (ItemInst & { worn: JobId[] })[]; bank: ItemInst[]; gear: InventorySave['gear']; wardrobe: CostumeId[];
  costumeDyes: InventorySave['costumeDyes']; gold: number; seals: number; stats: Required<Stats>; sets: { set: SetId; pieces: number }[]; freeRespec: boolean }
export function inventoryView(s: InvState): InventoryView;
// zones.ts
export type StallId = 'smithy' | 'tailor' | 'barber' | 'lampwright' | 'vault';
export const TOWN_STALLS: Readonly<Record<StallId, { x: number; z: number; facing: number; name: string; keeper: string }>>;
export const STALL_REACH = 3.5; export function stallAt(zone: ZoneId, x: number, z: number): StallId | null;
```
- **Rules**, exactly as under Numbers → Gear, Inventory, Stalls, Loot and Costumes:
  - `kitFor` = `baseStats(level)` + Σ `itemStats` of the job's gear, specials summed per type and capped at 40;
  - its mods are, in order: set bonuses (3 at ≥ 3 pieces, 5 at ≥ 5), the named weapon's mods, then `talentMods`;
  - `kitFor({ level: 10, gear: starter, talents: [] })` equals `STARTER_STATS` with `focus: 0, flow: 0, guard: 0` and no mods (P1);
  - `applyInvOp` never mutates its input;
  - `addLoot` is idempotent by `killKey`: a key already in `recentKills` gives no change and `dup: true`;
  - dyes on loot are 0;
  - the gold cap clamps.
  - `DYES`: 32 original names and colours. 1–8 are warm, 9–16 greens and blues, 17–24 violets and pinks, and 25–31 neutrals and metals (Chalk, Ash, Soot, Pewter, Brass, Copper, Beacon Gold).

- [ ] **Step 1: Write the failing tests.**
  - `items.test.ts`:
    - `it('101 items: 60 armour (10 sets × 6), 25 weapons, 16 off-hands; ids unique; models unique except where the table allows sharing')`;
    - `it('full kits sum to the KIT_TABLE within rounding, per tier and armour type')`;
    - `it('fits: a staff on both mages, a shield only on the Paladin, nothing in the off-hand for greatsword or daggers')`;
    - `it('Smithy prices only on T1, Seals only on T3, starter sells for 0, named for 150')`;
    - `it('every set and named weapon mod passes parseMods and names abilities that exist')`;
    - `it('costumes: twelve priced, two event-only, models in 200..255; 32 dyes, [0] Undyed')`.
  - `kit.test.ts` cases inside `items.test.ts`:
    - `it('P1: kitFor at level 10 in starter gear with no talents is STARTER_STATS and no mods, for every job')`;
    - `it('T2 at level 10 is 13 / 14 / 130 for light; heavy and cloth follow TYPE_MULT; 5 Mossweave pieces give both bonuses')`;
    - `it('specials are capped at 40; mixing types sums each type's own special')`.
  - `loot.test.ts`:
    - `it('the same seed parts roll the same; different accounts roll independently')`;
    - `it('rates over 10 000 rolls match the table within 1.5 percentage points')`;
    - `it('the first Wickhound and Warden kill of a UTC day always drops; the second that day uses the low chance')`;
    - `it('owned items are re-rolled up to 3 times; armour type follows JOB_ARMOUR 60%')`;
    - `it('Lampfall kinds roll T2, the Greenway T1, lens_shard and dummy nothing')`.
  - `inventory.test.ts`:
    - `it('newInventory: 16 items, every job wears a full kit with its own starter weapon')`;
    - `it('each op succeeds where allowed and refuses with the listed InvRefusal otherwise (table-driven, one case per refusal)')`;
    - `it('a worn item cannot be sold or banked; a costume cannot be bought twice; event costumes cannot be bought')`;
    - `it('equip with a full bag swaps when the old item fits; refuses bag-full when it does not')`;
    - `it('1000 random op sequences: uids unique, no item in two places, gold and Seals never negative, gold Δ = sales − buys')` (fixed seed);
    - `it('addLoot is idempotent by kill key; a full bag sells the item and reports the gold')`;
    - `it('parseInventory repairs garbage, unknown ids, duplicate uids, dangling gear refs and missing weapons')`;
    - `it('parseInvOp refuses junk, NaN, negative uids, unknown ops and long strings')`.
  - `zones.test.ts`:
    - `it('TOWN_STALLS stand on grove ground 12–20 m from the statue, 4 m clear of each other, the Guild Board and obstacles, off the walking lines to the exits')`;
    - `it('stallAt finds a stall within STALL_REACH in the grove only')`.
- [ ] **Step 2: Run `npx vitest run shared/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Data and pure rules only. No engine, server or client change beyond the exports.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: gear, sets, named weapons, costumes, dyes, personal loot tables, town stalls and the inventory rules`.

### Task 3: Shared looks and names: peoples, `Look`, look and gear codes, default looks, the hashed blocklist

**Files:**
- Create:
  - `shared/src/look.ts`, `shared/src/look.test.ts`;
  - `shared/src/names.fixture.ts` (ROT13 lists, tests only);
  - `shared/scripts/blocklist-hash.ts` (maintainer tool; a plain list on stdin, the arrays and the fixture on stdout).
- Modify:
  - `shared/src/badwords.ts` (hashes only);
  - `shared/src/names.ts` (hash windows; behaviour unchanged);
  - `shared/src/names.test.ts` (reads the fixture through `rot13`; every existing case kept);
  - `shared/src/index.ts` (exports; the fixture is never exported);
  - `server/src/auth/routes.test.ts` (only if it imports `BAD_WORDS`: switch to the fixture).

**Interfaces:**
- Produces, exactly as under Numbers → Looks:
```ts
export type PeopleId = 'human' | 'larchfolk' | 'knollfolk' | 'brindlekin'; export type FuturePeopleId = 'skyfolk';
export interface PeopleData { id: PeopleId; name: string; heightM: number; span: number; earsMax: number; furred: boolean;
  skinRange: readonly [string, string][]; hairRange: readonly [string, string][]; blurb: string }
export const PEOPLES: Readonly<Record<PeopleId, PeopleData>>; export const PEOPLE_IDS: readonly PeopleId[];
export interface Look { /* … */ }
export const LOOK_LIMITS: { readonly [path: string]: readonly [number, number] };   // 'face.eyes': [0, 7], …
export type EmoteId = 'wave' | 'bow' | 'cheer' | 'laugh' | 'sit' | 'point'; export const EMOTES: readonly EmoteId[];
export const STANCES: readonly string[]; export const WALKS: readonly string[];      // names for the creator
export function parseLook(v: unknown): Look | null;
export function encodeLook(l: Look): string; export function decodeLook(s: string): Look | null;
export interface GearLookSlot { model: number; dye: [DyeId, DyeId] }
export type GearLook = Record<GearSlot, GearLookSlot | null> & { hideHead: boolean };
export function gearLookOf(inv: InventorySave, job: JobId, outfit: JobOutfit | null): GearLook;   // costumes resolved
export function encodeGearLook(g: GearLook): string; export function decodeGearLook(s: string): GearLook | null;
export function defaultLook(seed: string): Look; export function randomLook(rng: () => number): Look;
export function barberCost(from: Look, to: Look): number;
// badwords.ts
export const BAD_WORD_HASHES: readonly string[]; export const BAD_WORD_LENGTHS: readonly number[];
export const SHORT_BAD_HASHES: readonly { h: string; runs: string }[];
```
- **Rules:**
  - `encodeLook` and `decodeLook` round-trip every valid look, and `decodeLook` refuses any byte out of range;
  - `defaultLook` is deterministic per seed; over 1000 seeds, every people appears at least 150 times, and two looks are identical in at most 1 pair;
  - names keep every `names.test.ts` case;
  - the hashes use `cyrb53` (`loot.ts`) with seed `0x5e2`, written in base 36.

- [ ] **Step 1: Write the failing tests.**
  - `look.test.ts`:
    - `it('parseLook accepts the limits and refuses one-off values, wrong keys, fur on a Human and no fur on Brindlekin')`;
    - `it('encodeLook ↔ decodeLook round-trips 1000 random looks; at most 38 characters')`;
    - `it('encodeGearLook ↔ decodeGearLook round-trips; costumes replace their slots; hideHead clears the head; at most 40 characters')`;
    - `it('defaultLook spreads peoples and features: 1000 seeds, each people ≥ 150, at most one identical pair')`;
    - `it('barberCost: 0, 40, 200')`.
  - `names.test.ts` (rewritten to the fixture, same cases):
    - `it('badwords.ts holds no fixture word in plain text')`: decode the fixture and check that no entry of length ≥ 3 occurs in `badwords.ts`'s source text;
    - `it('the hashed filter refuses exactly what the plain filter refused')`: for the fixture words and the existing innocent list, compare against a test-local copy of the old plain algorithm.
- [ ] **Step 2: Run `npx vitest run shared/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
  - Generate the arrays with `shared/scripts/blocklist-hash.ts` from the old list. Pipe it from `git show HEAD:shared/src/badwords.ts` through a scratch extractor in the scratchpad (never written to the repo).
  - The plain list remains in git history. Say so in the commit body: the slice ships no plain list from now on.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** Run `npm run build:online -w client` and check that the bundle has no fixture word, using a scratch script that decodes the fixture in memory.
- [ ] **Step 5: Commit**: `feat: peoples and looks with compact codes and varied defaults; the name blocklist ships as hashes only`.

### Task 4: Engine: kits, Focus, Flow and Guard, mods, set bonuses, named weapons, minimum-contribution credit

**Files:**
- Create: `shared/src/combat/kit.test.ts`, `shared/src/combat/mods.test.ts`.
- Modify:
  - `shared/src/combat/engine.ts`: `setKit`, `addAdventurer` with `kit`, views `level`;
  - `shared/src/combat/adventurer.ts`: kit and mod state, `lastStand`, `lowHpShield`, the credit filter;
  - `shared/src/combat/effects.ts`: Focus on amounts, `healShield`, `auraTaken`, Guard threat, `shieldOn taunt`;
  - `shared/src/combat/casting.ts`: `cast` mods, `cdOnCast`, `castDone` Momentum;
  - `shared/src/combat/momentum.ts`: Flow (a `gainFor(a, n)` helper that every positive gain goes through);
  - `shared/src/combat/displace.ts`: Guard knockback;
  - `shared/src/combat/enemyAi.ts`: `hitTaken` hooks, `auraTaken` in `takenMult`;
  - `shared/src/combat/elements.ts`: `react` Momentum;
  - `shared/src/combat/stagger.ts`: `staggerMult`, `stagger` mods;
  - `shared/src/combat/index.ts`.

**Interfaces:**
- Consumes: Tasks 1 and 2 (`Kit`, `Mod`; set and named data are only data here — the engine never imports `items.ts`).
- Produces:
```ts
// engine.ts
export interface Combat { /* Plan 4, plus: */
  /**
   * The adventurer's stats and mods (kitFor). Allowed any time (a level-up mid-fight); keeps the hp fraction
   * (rounded, at least 1 when alive), clamps the shield, keeps cooldowns and Momentum. The server calls it on join,
   * job change, equip, talent and level-up; never from a client value.
   */
  setKit(id: number, kit: Kit): void;
  addAdventurer(a: { /* Plan 4 */; kit?: Kit }, nowS: number): number;   // kit wins over stats when both are given
}
// AdventurerState gains: kit: Kit; modIndex: ModIndex (precomputed per ability and event); modTimers: { lastStandAt: number; lowHpAt: number; hitTakenAt: number; afterDodgeUntil: number }
export interface ModIndex { coef: Map<AbilityId, number>; amount: Map<AbilityId, number>; cd: Map<AbilityId, number>; cast: Map<AbilityId | 'all', number>;
  buffS: Map<AbilityId, number>; hpCost: Map<AbilityId, number>; stagger: Map<AbilityId, number>; finisherCost: number;
  momentumOn: Map<MomentumEvent, { amount: number; everyS: number }>; dodgeCharges: number; dodgeRefillMult: number;
  healShield: { frac: number; cap: number; overhealOnly: boolean } | null; cdOnCast: number; afterDodge: { mult: number; s: number } | null;
  staggerMult: number; lowHpShield: { frac: number; below: number; everyS: number } | null; aura: { mult: number; r: number } | null;
  lastStand: { everyS: number; iframesS: number } | null; resetQuickOnPerfect: boolean; shieldOnTaunt: { amount: number; s: number } | null }
export function indexMods(mods: readonly Mod[]): ModIndex;
```
- **Where each takes effect** (exactly):
  - **Focus:** × (1 + focus/100) on the `coef` of an ability's `damage` effects (splash included), and on its `heal` and `shield` amounts. Not on autos, Burning ticks, reactions or Rain ticks.
  - **Flow:** × (1 + flow/100) on every positive Momentum gain, floored per gain. This covers autos, traits, abilities, set mods and gifts received.
  - **Guard:** × (1 + guard/100) on all threat the adventurer adds (after `threatMult`), and knockback speed taken × (1 − min(0.5, guard/100)).
  - **Ability mods:**
    - `coef` and `amount` multiply with Focus;
    - `cd` sets the cooldown started to `max(1, cooldown + add)`;
    - `cast` makes the cast time `max(0.3, cast × mult)` for spells only;
    - `buffS` adds to that ability's buff, debuff and shield durations;
    - `hpCost` rounds `hp-cost × mult`;
    - `stagger` adds to the ability's stagger before `staggerMult`;
    - `finisherCost` makes the cost of `role: 'finisher'` abilities `max(30, cost + add)`, and the AI and HUD read the effective cost through `effectiveCost(a, ab)`.
  - **`momentumOn`:**
    - `parry`: a parry that lands;
    - `perfectDodge`: Plan 3's perfect dodge;
    - `interrupt`: this adventurer's hit interrupts a wind-up;
    - `hitTaken`: an enemy hit or field tick that lands on hp or shield (throttled by `everyS`);
    - `detonate`: a finisher that detonated at least one mark (reactions included);
    - `react`: this adventurer's hit triggered a reaction;
    - `castDone`: a completed cast.
  - **`dodge`:** max charges = the job's charges + min(1, Σ charges); refill time × `refillMult` (product).
  - **`healShield`:** after any heal this adventurer gives (any source but regen), the healed adventurer gets a shield of `floor(frac × healed)` (or `floor(frac × overheal)` with `overhealOnly`), capped at `cap`, for 6 s, through `applyShield`'s replace rule.
  - **`cdOnCast`:** on `castEnd { ok: true }`, every other running cooldown of the caster drops by `s` (not below 0).
  - **`afterDodge`:** from a dodge's start, for `s` seconds, the next ability that deals damage deals × `mult` (consumed on use).
  - **`staggerMult`:** × on all stagger this adventurer adds (parries, perfect dodges, combos and reactions included).
  - **`lowHpShield`:** when a hit takes hp from ≥ `below × maxHp` to under it, shield `floor(frac × maxHp)` for 6 s, if `everyS` has passed since the last one.
  - **`auraTaken`:** an allied adventurer (Plan 4's `allied`, self excluded) within `r` of a live wearer takes × `mult` enemy and field damage. The strongest single aura applies.
  - **`lastStand`:** a hit that would kill leaves 1 hp and gives `iframesS` of i-frames (fields included), if `everyS` has passed. A `lastStand` fx is sent.
  - **`resetOn perfectDodge quick`:** a perfect dodge sets the job's quick ability's cooldown to 0.
  - **`shieldOn taunt`:** using any ability with a `taunt` effect shields self `amount` for `s`.
- **Credit (minimum contribution):** a dying enemy's `TickOut.kills[].credit` lists only the adventurers whose threat on it is ≥ `MIN_CREDIT_FRAC × max threat` on it. The top-threat adventurer always qualifies. Plan 4's party share is added by the server afterwards (unchanged).
- New fx: `{ t: 'lastStand'; src: number }`, and `{ t: 'kitShield'; src: number; dst: number; amount: number }` (sent for healShield, lowHpShield and shieldOn, for the HUD's floating numbers).

- [ ] **Step 1: Write the failing tests.**
  - `kit.test.ts`:
    - `it('setKit raises max hp keeping the fraction, keeps cooldowns and Momentum, and clamps a shield')`;
    - `it('Focus scales ability damage, heals and shields, not autos, Burning, reactions or Rain ticks')`;
    - `it('Flow scales every positive Momentum gain, floored; spending is unchanged')`;
    - `it('Guard raises threat and cuts knockback speed, capped at 50%')`;
    - `it('P1 in the engine: addAdventurer with kitFor(level 10, starter) gives the same TickOut stream as with no kit over 120 s of a Mossback fight')`.
  - `mods.test.ts`: one test per mod kind, each named after it:
    - `it('coef', …)`, `it('amount', …)`, `it('cd never below 1 s', …)`, `it('cast never below 0.3 s; instants stay instant', …)`, `it('buffS', …)`, `it('hpCost 0 allowed', …)`, `it('stagger and staggerMult', …)`, `it('finisherCost never below 30; effectiveCost agrees', …)`;
    - `it('momentumOn for each event, with everyS throttling hitTaken', …)`;
    - `it('dodge: +1 charge at most, refill faster', …)`, `it('healShield and overhealOnly', …)`, `it('cdOnCast', …)`, `it('afterDodge consumed once', …)`, `it('lowHpShield once per everyS', …)`;
    - `it('auraTaken: allied only, strongest wins', …)`, `it('lastStand: 1 hp, i-frames, once per everyS', …)`, `it('resetOn perfectDodge quick', …)`, `it('shieldOn taunt for Taunt and Dread Howl', …)`;
    - `it('credit: a stranger with 5% of the top threat gets no credit; 10% does; the top always does')`;
    - `it('determinism: two engines, same seed, kits and intents, identical TickOut streams over a 400 s Warden fight with Beaconstone, Tollwind, Lenslight and two named weapons')`;
    - `it('budget: a Warden tick with 4 kitted adventurers stays under 0.35 ms on average')`.
  - Plan 3, 3b and 4 tests stay green. A test that relied on a tiny contributor being credited gets the contributor's share raised or is put in a party, keeping its intent; list each in the report.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Precompute `ModIndex` in `setKit` and `addAdventurer`, so a tick never scans mod lists.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: kits in the combat engine: Focus, Flow and Guard, mods for sets, named weapons and talents, and minimum-contribution credit`.

### Task 5: Simulation with levels, gear and talents; the gear bands and tuning

**Files:**
- Modify:
  - `shared/src/combat/sim.ts`: `EncounterMember` gains `level?`, `kit?`, `gear?`, `talents?`; `PartyMember` the same; `skilled` if missing;
  - `shared/src/combat/brain.ts`: reads `effectiveCost`, extra dodge charges, the cast-time mods;
  - `shared/src/combat/brain.test.ts`.
- Create:
  - `shared/src/combat/sim.gear.duo.test.ts` (G2, G3, G6, F2);
  - `shared/src/combat/sim.gear.solo.test.ts` (G4, G5);
  - `shared/src/combat/sim.levels.test.ts` (L1, L2, F1);
  - `shared/src/combat/sim.talents.test.ts` (P2, P3);
  - `shared/src/combat/simKits.ts` (`SIM_KITS`: build a member's kit from `{ job, level, tier: 'starter' | 1 | 2 | 3, talents }` with `kitFor` and `kitItems`).
- Modify, only under the Tuning rule:
  - `shared/src/items.ts` (`KIT_TABLE` T1–T3, `TYPE_MULT`, set and named magnitudes);
  - `shared/src/progression.ts` (`baseStats(1)` values);
  - `shared/src/talents.ts` (magnitudes, `SIM_TALENTS`).

**Interfaces:**
- Consumes: Task 4; Plan 4's `simulateEncounter`, `STRONG_PAIRS` and brain.
- Produces:
```ts
// sim.ts
export type Skill = 'careful' | 'skilled' | 'sloppy' | 'careless';
export const SKILLED_MISS = 0.1;
export interface EncounterMember { job: JobId; skill: Skill; picks?: [AbilityId, AbilityId]; stats?: Stats; kit?: Kit; level?: number;
  gear?: 'starter' | 1 | 2 | 3; talents?: readonly string[] | 'sim' }   // kit wins; else gear/level/talents → kitFor; else stats; else Plan 4's
// simKits.ts
export function simKit(o: { job: JobId; level?: number; gear?: 'starter' | 1 | 2 | 3; talents?: readonly string[] | 'sim' }): Kit;
export const GEAR_PAIRS: readonly (readonly [JobId, JobId])[];
export function headroom(k: number, n: number, t: number, dir: 'atLeast' | 'atMost'): number;   // (k − t) or (t − k) over 3·SD; ≥ 1 passes
```
- **Bands:** exactly the table under Tuning and the bands, with the thresholds as committed numbers. On failure, each test prints one line per party with wins, mean TTK, deaths, phase reached and enrage share. Nothing is printed on success.
- `brain.test.ts`: a careful brain spends a finisher at the reduced `effectiveCost`; uses a fourth dodge charge (Fourth Roll); waits out a shortened cast.

- [ ] **Step 1: Write the failing tests** above.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement, then tune only by the Tuning rule until every band passes with ≥ 3 SD headroom on seeds 1–20 and on the held-out seeds 1001–1020.** Write a scratch script in a new sub-directory of the scratchpad (not committed). It prints, per band, the counts, the headroom on both seed sets, mean TTK, deaths and enrage share. Paste the final tables into the task report.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** Plan 3b and Plan 4 band files pass unchanged (P1).
- [ ] **Step 5: Commit**: `feat: levels, gear and talents in the simulation, and the gear bands`, listing every tuning change in the commit body.

### Task 6: Server I: migration 006, store, the inventory queue and shops, loot and gold, xp and talents, looks and the Barber, emotes, state

**Files:**
- Create:
  - `server/migrations/006_progression_gear_looks.sql`;
  - `server/src/rooms/inventoryQueue.ts` (one queue per session), `server/src/rooms/rewards.ts` (kill and clear rewards);
  - `server/src/rooms/gear.test.ts`, `server/src/rooms/loot.test.ts`, `server/src/rooms/dupes.test.ts`, `server/src/rooms/looks.test.ts`;
  - `server/src/routes/look.ts` and `server/src/routes/look.test.ts`.
- Modify:
  - `server/src/store/types.ts`, `server/src/store/memory.ts`, `server/src/store/pg.ts`, `server/src/store/store.test.ts`;
  - `server/src/rooms/ZoneRoom.ts`: kits, inventory and shop messages, loot, xp curve and catch-up, clear xp, level-ups, talents, Barber, emotes, state fields;
  - `server/src/rooms/state.ts`;
  - `server/src/rooms/testHelpers.ts`;
  - `server/src/app.ts` (routes; `serverSeed`);
  - `server/src/index.ts` and `server/src/index.test.ts` (test-only switches);
  - `shared/src/messages.ts` (new message shapes, below).

**Interfaces:**
- Consumes: Tasks 1–4.
- **Migration `006_progression_gear_looks.sql`** (safe to run again):
```sql
-- Plan 5: inventory and equipment (one jsonb, versioned for compare-and-set), looks, the free creator visit, and the GM audit log.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS inventory jsonb;          -- NULL: the reader gives the starter kit (repaired, written back on first join)
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS inv_version integer NOT NULL DEFAULT 0;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS look jsonb;               -- NULL: defaultLook(account id) until the creator is used
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS look_free boolean NOT NULL DEFAULT true;   -- every adventurer gets one free creator visit
ALTER TABLE adventurers ADD CONSTRAINT adventurers_gold_nonneg CHECK (gold >= 0) NOT VALID;
ALTER TABLE adventurers ADD CONSTRAINT adventurers_seals_nonneg CHECK (seals >= 0) NOT VALID;
CREATE TABLE IF NOT EXISTS gm_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  gm_account uuid NULL,          -- NULL: the role CLI
  command text NOT NULL,
  target text NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok boolean NOT NULL,
  result text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS gm_audit_at ON gm_audit (at);
```
  The `ADD CONSTRAINT` lines are wrapped so a re-run is a no-op: `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$;`.
- **Store:**
```ts
// types.ts
export interface Adventurer { /* Plan 4 */; inventory: InventorySave; invVersion: number; inventoryRepaired?: true;
  look: Look | null; lookFree: boolean }
export interface InvWrite { inventory: InventorySave; jobs: JobsSave; dGold: number; dSeals: number; look?: Look; lookFree?: false }
export interface Store { /* Plan 4, plus: */
  /**
   * Atomic compare-and-set: writes inventory, jobs (and look) and adds dGold/dSeals only while inv_version = expect
   * and gold + dGold ≥ 0 and seals + dSeals ≥ 0 (gold clamped to GOLD_MAX); bumps inv_version. Resolves the new
   * { version, gold, seals } or null when the check failed (nothing written). Validates with parseInventory/isJobsSave/parseLook (TypeError).
   */
  writeInventory(adventurerId: string, expect: number, w: InvWrite): Promise<{ version: number; gold: number; seals: number } | null>;
  /** The creator's free visit: sets look and look_free = false only while look_free is true. */
  useFreeLook(accountId: string, look: Look): Promise<boolean>;
  /** GM audit (Task 7 writes rows; created here so the migration and both stores are in one place). */
  logGm(e: { gmAccount: string | null; command: string; target: string | null; args: unknown; ok: boolean; result: string }): Promise<void>;
  gmAudit(limit?: number): Promise<{ at: string; gmAccount: string | null; command: string; target: string | null; ok: boolean; result: string }[]>;
}
```
  - `awardSeal` keeps Plan 4's semantics and also bumps `inv_version` (so a stale write retries rather than overwriting).
  - `saveAdventurer` also writes `level` (the highest job level) and never touches inventory, gold or Seals.
  - Reads use `parseInventory` (`inventoryRepaired` when repaired: the room writes it back once on join, like `jobsRepaired`).
- **Messages** (`shared/src/messages.ts`):
```ts
C2S: inv: InvOp; look: { look: Look };                     // look: the Barber (in reach of its stall)
     emote: { emote: EmoteId };
S2C: inventory: InventoryView;                             // on join (a step after, like jobs) and after every change
     invRefused: { op: InvOp['op'] | 'look'; reason: InvRefusal; text: string };
     loot: { items: { item: ItemId; uid: number }[]; gold: number; soldFor: number; x: number; z: number };   // one per kill or clear, to the looter only
     levelUp: { job: JobId; level: number; talentRow: 0 | 1 | 2 | null };
     lookFree: { free: boolean };
// JobView gains talents: string[]; outfit: JobOutfit | null
```
- **State** (`state.ts`):
  - `PlayerState` gains `look: t.string()` (`encodeLook`), `gear: t.string()` (`encodeGearLook`), `level: t.uint8()` (current job), `lvlAt: t.uint32()` (clock step of the last level-up; others play the effect when it changes), `emote: t.string()` and `emoteAt: t.uint32()`.
  - All of these change only on events.
- **Room rules:**
  - **Join:**
    - load the inventory and look; the look is `look ?? defaultLook(accountId)`;
    - add the adventurer with `kit = kitFor({ job, level, gear: gearItems(inv, job), talents })`;
    - set `look`, `gear` and `level`;
    - send `inventory` and `lookFree` one step after join;
    - write back a repaired inventory once.
  - **The queue** (`InventoryQueue`, per session):
    - every `inv`, `look`, loot and GM grant goes through it, one at a time;
    - each op runs `applyInvOp` (or `addLoot`) on the session's in-memory state, then `writeInventory(expect = version)`;
    - on success it swaps in the new state and version, refreshes the kit (`setKit`) and the `gear` field, and sends `inventory`;
    - on `null` (stale) it reloads from the store and retries once, then sends `invRefused` with the stored truth;
    - while a write is in flight, later ops wait;
    - a disconnect lets the in-flight write finish (it is atomic) and drops the rest;
    - `INV_OPS_PER_S` token bucket: more → `'rate'`.
  - **Context:** `stall = stallAt(zone, x, z)` (grove only); `jobSwitch = def.jobSwitch(x, z)`; `townBoard` = within the Guild Board's reach in the grove; `inCombat`, `dead` and `busy` from the engine's self view; travel in progress → `'busy'`.
  - **Kits:** refreshed (`setKit`) on join, job change, equip and unequip, talent choice and respec, and level-up. The `gear` field updates on job change, equip and unequip, wear, hideHead and dye.
  - **Kills** (`rewards.ts`):
    - for each kill, the credited sessions are the engine's credit plus Plan 4's party share;
    - each gets `KILL_XP × catchUp` to its current job, then `rollLoot` with `seedParts = [serverSeed, roomId, enemyEid, killCounter, accountId]`;
    - `addLoot` runs with `killKey = roomId:enemyEid:killCounter` through the queue, coalesced per session per room step into one write;
    - a `loot` message goes to that session only;
    - for a pack encounter cleared in an instance (every spawn of the encounter dead), each credited adventurer in the instance gets `CLEAR_XP × catchUp` and its clear loot;
    - for the Warden, Plan 4's `awardSeal` runs unchanged, and the daily guaranteed item uses `lootDays`.
  - **Level-up:** `addJobXp` reports `levelUp`. The room sets the kit, `level` and `lvlAt`, and sends `levelUp`, with `talentRow` when the new level is in `TALENT_LEVELS`. Plan 3b's `jobXp` message is unchanged.
  - **Talents and respec:** `inv { op: 'talent' | 'respec' }` change the current job's `JobRecord.talents` in the same write. Outfits (`wear`, `hideHead`) change `JobRecord.outfit` in the same write; only costumes in the wardrobe are allowed.
  - **Barber:**
    - `look { look }` requires the Barber's stall in reach and `parseLook`;
    - the cost is `barberCost(current, new)`, so an unchanged look is free and does nothing;
    - it writes through the queue with `dGold = −cost`, and the `look` field updates;
    - `lookFree` sessions pay 0 (that visit is the free one).
  - **Emotes:** `emote { emote }`, at most one per 2 s, alive and not in combat. It sets `emote` and `emoteAt`. A move cancels it on clients (no server state beyond the field).
  - **`/api/look`** (`routes/look.ts`, bearer auth, the auth rate limit):
    - `GET` → `{ look: Look | null, free: boolean, name: string | null, guest: boolean }`;
    - `POST { look, name? }`: while `lookFree`, `useFreeLook` (the name, when given and the adventurer has none, goes through Plan 1's `nameAdventurer` validation first). It also sets the starter kit's dyes from `look.outfit` when the inventory is untouched (`nextUid === 17`);
    - when not free → 409 `{ error: 'Visit the Barber in Shady Grove to change your look' }`;
    - a bad look → 400.
  - **Test-only switches** (like `SG2_START_AT`; never in Docker or `docker-compose.yml`; `index.test.ts` checks they are off by default):
    - `SG2_TEST_START_GOLD=<n>`: new adventurers start with n gold;
    - `SG2_TEST_LOOT=always`: every credited kill drops an item (the roll still picks which);
    - `SG2_TEST_KIT=t1|t2|t3`: new adventurers get that tier's full kit for every job, worn.

- [ ] **Step 1: Write the failing tests.**
  - `store.test.ts` (memory; pg when `TEST_DATABASE_URL` is set):
    - `it('writeInventory is compare-and-set: a stale version writes nothing and returns null')`;
    - `it('gold and Seals are deltas: a Seal awarded between read and write survives the write')`;
    - `it('writeInventory refuses to take gold or Seals below 0 and clamps gold at GOLD_MAX')`;
    - `it('garbage inventory reads as the starter kit, repaired')`;
    - `it('useFreeLook once')`;
    - `it('logGm rows')`;
    - `it('migration 006 is safe to run twice, and a Plan 4 row reads with Seals, titles and progress intact')` (pg).
  - `gear.test.ts` (rooms; memory store; fixed seed):
    - `it('equip a T1 chest: the kit's defence and max hp rise, the gear field changes, others in view see it once')`;
    - `it('switching job switches the gear set and the gear field')`;
    - `it('buy at the Smithy in reach; refused away from it, in the Greenway, without gold, with a full bag')`;
    - `it('sell refuses worn and starter items; bank only at the Vault')`;
    - `it('Seals buy T3 at the Lampwright; not enough Seals → seals')`;
    - `it('talent choice in the grove at level 4, refused at level 3 or in the Greenway; respec free once, then 25 per row')`;
    - `it('wear an owned costume per job; an unowned one is refused')`;
    - `it('equip refused in combat, dead, casting, charging, travelling')`.
  - `loot.test.ts`:
    - `it('two adventurers credited for one kill each roll their own loot; a 2% tagger gets nothing')`;
    - `it('a party member 30 m away gets party-share loot; a stranger does not')`;
    - `it('loot lands in the bag with a loot message to that adventurer only')`;
    - `it('a full bag sells the drop and says so')`;
    - `it('the first Wickhound kill of a UTC day drops; the second that day may not')`;
    - `it('pack clears give CLEAR_XP and gold to credited members in the instance')`;
    - `it('catch-up: a level 2 job beside a level 6 job gains 1.5×')`;
    - `it('a level-up refreshes max hp and sends levelUp with the talent row at 4, 7 and 10')`.
  - `dupes.test.ts` (Review Focus 1):
    - `it('50 concurrent mixed ops: uids unique, gold conserved')`;
    - `it('sell while equipping the same uid: one wins, the other is refused')`;
    - `it('two buys with gold for one: exactly one lands')`;
    - `it('a disconnect right after buy: after rejoin the store and the view agree, and the gold left matches')`;
    - `it('a second tab mid-queue: the old session's queued ops are dropped, the in-flight one lands once')`;
    - `it('the same kill handled twice gives one reward')`;
    - `it('a stale version from a GM write in between: retried once, nothing lost')`;
    - `it('30 ops a second: rate after 8')`.
  - `looks.test.ts`:
    - `it('look and gear go to a client when an adventurer enters its view and when they change, never in other patches')`: count the patches that carry them;
    - `it('the Barber: in reach, gold taken, look field changes; unchanged look costs nothing; a bad look refused')`;
    - `it('emote at most every 2 s, not in combat')`.
  - `look.test.ts` (route): `GET`, the free `POST` with and without a name, the second `POST` → 409, a bad look → 400, no token → 401.
  - All earlier room tests pass.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep every room test under 10 s of real time.
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.** Then on port 2571:
  - the grove bot run (`--count 100 --seconds 30`), then the clustered one (`--cluster 15`): exit 0, ≥ 14 Hz, 0 corrections, KiB/s within the Global Constraints (the bots join with default looks);
  - the Greenway fight run (`SG2_START_ZONE=greenway`, `--fight --count 100 --seconds 60`): PASS.

  Stop by PID.
- [ ] **Step 5: Commit**: `feat: inventory, shops, personal loot and gold, the real xp curve and talents, looks and the Barber, emotes; migration 006`.

### Task 7: Server II: GM tools

**Files:**
- Create:
  - `server/src/gm/commands.ts` (parser and runner; **server only**, never imported by `shared/` or `client/`);
  - `server/src/gm/commands.test.ts`, `server/src/rooms/gm.test.ts`;
  - `server/scripts/gm.ts` (the role CLI).
- Modify:
  - `server/src/rooms/ZoneRoom.ts` (`/gm` in `onChat`; `grantTo(session, grant)`; announce; kick; teleport);
  - `server/src/app.ts` (a process-wide `announce` to every room and instance; the GM rate limiter);
  - `server/src/store/memory.ts` and `server/src/store/pg.ts` (`setGm(username, on)`, `grantOffline(name, grant)`);
  - `server/src/store/types.ts`, `server/src/store/store.test.ts`;
  - `server/src/index.ts` and `server/src/index.test.ts` (`SG2_TEST_GMS`);
  - `server/package.json` (`"gm": "tsx scripts/gm.ts"`);
  - `shared/src/messages.ts` (`announce`, `chat.gm`).

**Interfaces:**
- Consumes: Task 6 (the queue, `logGm`, presence).
- Produces:
```ts
// commands.ts
export type GmCommand =
  | { cmd: 'announce'; text: string }                                        // 1..200 chars after cleanChat
  | { cmd: 'grant'; what: 'gold'; amount: number; name: string }             // 1..10 000
  | { cmd: 'grant'; what: 'item'; item: ItemId; name: string }
  | { cmd: 'grant'; what: 'costume'; costume: CostumeId; name: string }      // event-only costumes included
  | { cmd: 'tp'; name: string } | { cmd: 'tp'; x: number; z: number }       // the GM moves (same room only)
  | { cmd: 'kick'; name: string; reason: string }
  | { cmd: 'event'; op: 'start'; title: string } | { cmd: 'event'; op: 'end' }
  | { cmd: 'event'; op: 'award'; costume: CostumeId; names: string[] };      // ≤ 20 names
export function parseGmCommand(text: string): GmCommand | { error: string } | null;   // null: not a /gm line
export const GM_PER_MIN = 20; export const GM_ANNOUNCE_EVERY_S = 30; export const GM_GOLD_PER_DAY = 100_000;
// store
setGm(username: string, on: boolean): Promise<boolean>;
grantOffline(name: string, g: { gold?: number; item?: ItemId; costume?: CostumeId }): Promise<'done' | 'unknown' | 'owned' | 'bag-full'>;   // CAS loop, at most 5 tries
// messages.ts
S2C: announce: { text: string; event: string | null };      // a banner for 8 s and a chat line
     chat gains gm?: true                                   // lines from GM accounts carry a GM badge
```
- **Rules:**
  - The role is `Account.isGm` (column `is_gm`, Plan 1). It is set **only** by `npm run gm -w server -- grant|revoke|list <username>`, which needs `DATABASE_URL`, runs `setGm` and writes an audit row (`gm_account` null, `command 'role'`). There is no route or message for it.
  - With the memory store, `SG2_TEST_GMS=alice,bob` (test-only, off by default, never in Docker) marks those usernames as GMs when they register.
  - A session reads `isGm` at join. A change takes effect on the next join.
  - **`/gm` lines** (case-insensitive prefix `/gm `) are never broadcast. From a non-GM they are dropped silently: no reply, and no audit row (so the command list cannot be probed).
  - From a GM, every line writes one audit row, refused or done: `ok`, the `result` text, and args with names as typed. The GM gets a `notice` with the result.
  - Limits: `GM_PER_MIN` per GM (more → refused `'rate'`, audited); announce at most every `GM_ANNOUNCE_EVERY_S`; gold grants at most `GM_GOLD_PER_DAY` per GM per UTC day (summed from that day's audit rows).
  - **Grants:**
    - to an online adventurer: through its session's queue (Task 6) in its room, found through `presence`;
    - offline: `grantOffline` (CAS);
    - an item to a full bag → `'bag-full'` (the GM retries later; nothing is lost);
    - a costume already owned → `'owned'`;
    - the target gets a `notice`: "A game master gave you <thing>".
  - **`tp`:** the GM's own session is placed (a server `correct`) at the target's ground position, or at x, z if on this room's ground. Another room → refused "not here".
  - **`kick`:** the target's session gets `notice` "Removed by a game master: <reason>" and is disconnected (code 4003). The client shows the login screen with that line. The adventurer is saved as usual. The target may sign in again.
  - **Events:** `start` sets the process-wide event title (shown in `announce.event` and `/healthz` as `event`) and announces "Event: <title>". `end` clears it. `award` grants the costume to each named adventurer (as `grant costume`), one audit row per name.
  - The client bundle contains no `/gm` command list. The chat box sends `/gm …` lines as ordinary chat text, which the server intercepts.

- [ ] **Step 1: Write the failing tests.**
  - `commands.test.ts`:
    - `it('parses every command; refuses junk, huge amounts, unknown items and costumes, more than 20 names')`;
    - `it('returns null for chat that is not /gm')`.
  - `gm.test.ts` (rooms; memory store; `SG2_TEST_GMS`-style option):
    - `it('a non-GM /gm line reaches nobody, gets no reply and writes no audit row')`;
    - `it('a GM announce reaches every room and instance; a second within 30 s is refused and audited')`;
    - `it('grant gold, item and costume to an online adventurer in another zone: one queue write each, a notice, an audit row')`;
    - `it('grant to an offline adventurer lands once even when two grants race')`;
    - `it('event award gives an event costume that cannot be bought')`;
    - `it('tp moves the GM; tp to someone in another zone is refused')`;
    - `it('kick disconnects with the notice and saves')`;
    - `it('21 commands in a minute: the 21st is refused rate')`;
    - `it('gold beyond 100 000 a day is refused')`;
    - `it('no client message can make an account a GM')`: send `{ isGm: true }` in every message type; `isGm` is unchanged.
  - `store.test.ts`: `setGm` and the CLI path (memory; pg when available), audit rows in order.
  - `index.test.ts`: `SG2_TEST_GMS` is off by default.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.** Then grep `client/dist-online` (after `npm run build:online -w client`) for `announce`'s command words (`grant gold`, `event award`) and check there are none.
- [ ] **Step 5: Commit**: `feat: GM tools: a shell-only role, announce, grants, teleport, kick and events, with an audit log and rate limits`.

### Task 8: Client I: the look-driven adventurer, the character creator, the Barber, stance, walk and emotes (browser-heavy)

**Files:**
- Create:
  - `client/src/player/look.ts` (pure: `Look` → body parameters, part choices and colours), `client/src/player/look.test.ts`;
  - `client/src/player/hair.ts` (20 hair styles and 8 facial-hair builders, code-built), `client/src/player/faces.ts` (faces, ears, muzzles, tails, marks);
  - `client/src/hud/creator.ts` (the creator and the Barber screen), `client/src/hud/creator.test.ts`;
  - `client/dev/looks.html` and `client/src/player/looksDev.ts` (a viewer, not part of the build).
- Modify:
  - `client/src/player/character.ts`: `look` in `CharacterOpts`; peoples, sliders, faces, hair and colours in the one skinned mesh; stance and walk in the pose layer; emote poses;
  - `client/src/player/rig.ts` (the local stance and walk);
  - `client/src/core/contracts.ts`;
  - `client/src/net/remotes.ts` (build remotes from `PlayerState.look`; rebuild on change);
  - `client/src/online.ts` (the login → `GET /api/look` → creator flow; `__sg2net` additions);
  - `client/src/net/loginScreen.ts` and `client/src/net/nameScreen.ts` (the name step moves into the creator for named accounts);
  - `client/src/hud/index.ts`, `client/src/hud/style.ts`.

**Interfaces:**
- Consumes: Task 3 (`Look`, `PEOPLES`, `decodeLook`, `randomLook`, `barberCost`, `EMOTES`); Task 6's `/api/look`, `look` message, `PlayerState.look`, `emote` and `emoteAt` (the dev page and unit tests need no server).
- Produces:
```ts
// contracts.ts
export interface CharacterOpts { /* … */; look?: Look; gear?: GearLook }   // look absent: today's default adventurer (the offline demo)
export interface CharacterView { /* … */
  /** Rebuilds the mesh for a new look and/or gear (queued: at most 2 rebuilds per frame, each ≤ 8 ms on desktop). */
  setAppearance(look: Look, gear: GearLook | null): void;
  emote(id: EmoteId | null): void;          // a one-shot or looping (sit) emote; a move ends it
}
export interface HudApi { /* … */
  creator(o: { look: Look; mode: 'create' | 'barber'; needsName: boolean; gold: number; free: boolean;
    validateName: (s: string) => string | null }): Promise<{ look: Look; name?: string } | null>;
  emoteWheel(): Promise<EmoteId | null>;
}
// look.ts
export interface BodyParams { height: number; limb: number; shoulder: number; hip: number; headScale: number; bulk: number; earLen: number; tail: number | null; muzzle: number | null; fur: boolean }
export function bodyParams(l: Look): BodyParams;
export function lookColours(l: Look): { skin: Color3; hair: Color3; facial: Color3; eyes: Color3; marks: Color3; fur2: Color3 | null };   // fur2: pattern
```
- **The model:**
  - **Peoples:** the Larchfolk are tall and long-limbed, with long pointed ears (up to 4 lengths); the Knollfolk are small and broad, with a big head, big hands and feet, and round ears; the Brindlekin have fur (the pattern painted per vertex: stripes, spots or a mask), a muzzle, one of six animal ears, a tail on its own bone chain (spring-driven like the cape), and padded hands; Humans are as now.
  - **Sliders:** height scales the root (within the people's span); build is bulk (girth of limbs and torso); shoulders, hips, legs (leg length vs torso) and head size. All are blended into the same rig: no bone count change, so animation is shared.
  - **Faces:** six head shapes, eight eye shapes (with blink), eight brows, eight noses or muzzles, six mouths and eight marks, built as per-vertex paint plus small geometry (nose, brows, ears).
  - **Hair:** 20 styles, from short crop and long loose to braids, topknot, curls, shaved sides and bald, and 8 facial hair options. Long styles get the spring secondary motion that capes have.
  - **Colours:** free colours apply to skin or fur, hair, facial hair, eyes and marks. Shading keeps the toon look: colours are lit by the same ramp, not unlit.
  - **Budget:** an adventurer without gear ≤ 2.2k triangles at med, ≤ 1.2k at low. Still one skinned mesh plus at most one emissive mesh.
  - **Stance and walk:** four idle stances (offsets on spine and arms and the weight shift) and four walk styles (stride length, bounce and arm swing). Both are layered on the existing poses.
  - **Emotes:** wave, bow, cheer, laugh, sit (loops until a move) and point, each about 1.5 s. `emoteAt` changes play them on remotes.
- **The creator** (`creator.ts`; phone-first):
  - **Layout:** on phones in portrait, the 3D preview fills the top 45% (drag to turn it, pinch or the wheel to zoom face and body) and tabs sit at the bottom; in landscape the preview is left and the tabs right; on desktop the preview is centred with a 420 px panel.
  - **Tabs:** People (four cards with a one-line blurb), Body (six sliders), Face (seven pickers with left and right arrows and a strip of thumbnails), Hair (20 styles and 8 facial hair), Colours (skin or fur, hair, facial hair, eyes, marks and, for Brindlekin, the fur pattern colour and tail), Style (stance and walk previews, playing on the model), Outfit (the starter kit's two dyes, from the 32 dyes) and Name (only when `needsName`).
  - **Colour pickers:** a 12-swatch row of the people's suggested colours, then a hue strip and a lightness strip (each 48 px tall, tap or drag), and a preview chip.
  - **Buttons:** "Surprise me" (`randomLook`), "Undo" (the last 20 changes) and "Done" (the Barber shows its price: "Change look — 40 gold", or free on the free visit).
  - The name field validates live with `validateAdventurerName` and shows the error text.
- **Flow:**
  - after login, `GET /api/look`: when `free` (new and existing adventurers alike, once), the creator opens with `look ?? defaultLook(accountId)` and `needsName` when `name` is null and not a guest; Done → `POST /api/look`, then the usual join;
  - when not free, the game starts at once;
  - the Barber stall (Task 10's stall tap) opens `creator({ mode: 'barber' })` and sends `look`;
  - the offline demo (`npm run build`) never shows the creator and uses the default adventurer.
- **`window.__sg2net`** adds: `look: string` (own code), `lookFree: boolean`, `creatorOpen: boolean`, `remoteLooks: Record<number, string>` (eid → code).

- [ ] **Step 1: Write the failing tests.**
  - `look.test.ts`: `bodyParams` heights per people at sliders 0, 10 and 20 within spans; Brindlekin always has a tail and muzzle, the others never; colours map exactly.
  - `creator.test.ts` (DOM, jsdom): each tab's controls are at least 48 px with no overlap at 390 × 844 and 844 × 390; Undo restores; the name error shows; Done resolves the look; the Barber shows the price and "free" on a free visit.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` (the offline demo unchanged) and `npm run build:online`. Then the browser check:**
  - `client/dev/looks.html` under `npm run dev`, desktop and `devices['iPhone 13']`: a grid of 24 `defaultLook` adventurers at med and low (screenshots); each people at sliders 0, 10 and 20; all 20 hair styles; each emote mid-pose; triangles per adventurer recorded (within budget);
  - start the server on port 2575 in the background (note the PID); on the iPhone, register, then use the creator: choose Knollfolk, move three sliders, pick hair 7, set a free hair colour, pick two dyes, name it, Done (screenshot of each tab and of the result in the grove); a second page (desktop) sees that adventurer with the same look (compare `remoteLooks` with `look`); reload: the creator does not open again; `kill <pid>`;
  - no page errors.
- [ ] **Step 5: Commit**: `feat: peoples, sliders, faces, hair and colours on the adventurer, stance, walk and emotes; the character creator and the Barber screen`.

### Task 9: Client II: gear and costumes on the model, weapons per item, dyes (browser-heavy)

**Files:**
- Create:
  - `client/src/player/gearModels.ts` (piece builders per slot, armour type and tier; costume builders), `client/src/player/gearModels.test.ts`;
  - `client/src/player/weaponModels.ts` (a model per weapon `model` id, extending Plan 3b's weapons);
  - `client/dev/gear.html` and `client/src/player/gearDev.ts`.
- Modify:
  - `client/src/player/character.ts` (merge gear into the skinned mesh; named glow into the emissive mesh; `setAppearance` with gear);
  - `client/src/net/remotes.ts` (rebuild on `PlayerState.gear` changes);
  - `client/src/online.ts` (own `gear` code into the rig);
  - `client/src/core/contracts.ts` (only if a type needs it).

**Interfaces:**
- Consumes: Task 2 (`ITEMS[*].model`, `COSTUMES[*].model`, `DYES`), Task 3 (`GearLook`, `decodeGearLook`) and Task 8 (`setAppearance`). **Plan 3b Task 8 (assumed built):** `CharacterView.setWeapon(w, tint)` and the weapon builders in `character.ts`. This task replaces the per-`WeaponId` look with a per-item `model` look, and keeps `setWeapon` for the offline demo and enemies. If Plan 3b's builders differ, extend what was built and say so.
- Produces:
```ts
export interface PieceBuild { slot: GearSlot | 'costume'; verts: VertexData; colours: Float32Array; bones: …; emissive?: VertexData }
export function buildPiece(model: number, slot: GearSlot, body: BodyParams, dye: [DyeId, DyeId]): PieceBuild | null;
export function gearTriangles(g: GearLook, body: BodyParams): number;     // for the budget test
```
- **The look of gear** (readable at phone size; silhouettes differ, not only colours):
  - **cloth:** long robe hems and sleeves, hoods, soft wraps; Mossweave has leaf-edged hems, Wickthread has a lantern-wick braid trim with ember stitching, Lenslight has glassy shoulder disks with a faint glow (emissive at T3);
  - **light:** fitted jerkins, short cloaks, laced boots; Thornrunner has thorn-spike shoulder tabs, Cinderstep has scorched fringe and ember buckles, Tollwind has wind-swept long tails and bell charms;
  - **heavy:** plates, wide pauldrons, tall helms; Rootbound has bark-like plates with root straps, Brassbound has brass bands with rivets and cog shoulder plates, Beaconstone has stone-and-brass plates with a lit crest (emissive);
  - **plain:** the Grove-Spun kit (today's adventurer clothes, in the dyes);
  - each tier adds detail and silhouette, so T1 → T3 reads at 20 m on a phone.
- **Weapons:** every non-starter weapon and off-hand has its own model (19 + 12). Named T3 weapons have a glow or trail in the emissive mesh: Last Bell rings a small brass bell on the guard; Longwatch carries a spyglass-like sight; Lampwarden's Oath has a lamp in the pommel; Grief of Brass has a cracked brass edge glowing; Twin Wicks have flame-tip quads; Dawnlantern has a lantern head; Ember Lens has a lens with an ember core.
- **Costumes:** 14 outfits built the same way, covering their slots.
- **Dyes:** channel 1 is the main cloth or plate colour, channel 2 the trim. Undyed keeps the piece's own palette-derived colours.
- **Budget:** gear adds ≤ 900 triangles at med and ≤ 450 at low to an adventurer (≤ 3.1k med in all). Still one skinned mesh plus at most one emissive mesh. Rebuilds are cached by `look + gear` code (an LRU of 64).

- [ ] **Step 1: Write the failing tests** in `gearModels.test.ts`: every item and costume model builds for all four peoples at sliders 0 and 20 with no NaN vertices; the triangle budget holds for every T3 set + named weapon at med and low; dyes change only their channel's vertices; a body costume hides chest, legs, hands and feet pieces, and `hideHead` hides the head.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` and `npm run build:online`. Then the browser check:**
  - `client/dev/gear.html`, desktop and iPhone 13: each of the 10 sets on each people (screenshots); every weapon and off-hand in hand and sheathed; the 14 costumes; dye swatches; a phone-size readability shot at 20 m of starter, T1, T2 and T3 heavy side by side; record triangles and draw calls;
  - live (port 2576, `SG2_TEST_KIT=t3`, PID noted): two pages see each other's T3 gear and named weapon glow; `kill <pid>`;
  - no page errors.
- [ ] **Step 5: Commit**: `feat: visible gear, named weapons, costumes and dyes on the adventurer`.

### Task 10: Client III: bag and equipment, stats, vendors, wardrobe, talents, bank, stalls, loot feedback, level-up (browser-heavy)

**Files:**
- Create:
  - `client/src/net/inventory.ts` (pure: client inventory state from `inventory`, `loot`, `invRefused`, `levelUp`), `client/src/net/inventory.test.ts`;
  - `client/src/hud/bag.ts` (the bag, the equipment doll and stats on one sheet with tabs Bag, Character and Bank), `client/src/hud/vendor.ts`, `client/src/hud/wardrobe.ts`, `client/src/hud/talents.ts`;
  - `client/src/hud/gear.test.ts`;
  - `client/src/world/stalls.ts` (the five stalls and keepers in the grove).
- Modify:
  - `client/src/hud/{index,frames,overlays,style,dev,sheets}.ts`: buttons, the level on frames, the job board's talent and respec entry;
  - `client/src/core/contracts.ts`;
  - `client/src/combat/controller.ts` (stall taps and `E`, the same walk-and-open as the Guild Board);
  - `client/src/combat/effects.ts` (loot sparkles, the level-up column, `kitShield` and `lastStand` floaters);
  - `client/src/online.ts` (messages; `__sg2net` additions);
  - `client/src/world/town.ts` or `client/src/world/index.ts` (place the stalls).

**Interfaces:**
- Consumes: Task 6's messages and state; Task 2's data; Task 9's model. **Plan 4 Task 8 (assumed built):** the party sheet and HUD layout rules (frames, the boss frame, `HudApi.partySheet`); the bag and party buttons share the button row. Plan 3b's job board sheet (`sheets.ts`) gains a "Talents" tab.
- Produces:
```ts
export interface HudApi { /* … */
  bag(view: BagView): Promise<InvOp | null>;          // resolves with the op the player chose (or null on close); re-opened after each inventory
  vendor(view: VendorView): Promise<InvOp | null>;    // smithy, lampwright, tailor (costumes and dyes), vault
  wardrobe(view: WardrobeView): Promise<InvOp | null>;
  talents(view: TalentsView): Promise<InvOp | null>;
  loot(items: { name: string; rarity: string }[], gold: number, soldFor: number): void;   // toast stack
  levelUp(job: string, level: number, talentRow: number | null): void;                  // banner
}
// BagView, VendorView, WardrobeView, TalentsView: plain data built by net/inventory.ts from InventoryView + ITEMS/SETS/COSTUMES/TALENTS
```
- **The bag sheet** (`I`, or the bag button; tabs Bag, Character and Bank):
  - **Bag:** a 6 × 5 grid of 64 px tiles with item icons. Icons are code-drawn on a canvas from the model's silhouette and the tier colour, with a rarity border. A worn item shows the job glyphs that wear it.
  - Tapping an item opens a detail card: name, tier and item level, set name and progress (for example "Wickthread 3/5" with both bonus lines, lit when active), stats, and a **comparison with the current job's piece in that slot** (green and red differences for Power, Defence, Health and the special, and the change to the full kit's totals). Buttons: Equip, Dye (at the Tailor only), Sell (at the Smithy only, with the price), Bank (at the Vault only).
  - **Character:** the equipment doll (eight slots around a live preview of the adventurer), with Power, Defence, Health, Focus, Flow and Guard as numbers, the active set bonuses as lines, and the job and level with an xp bar.
  - **Bank:** only at the Vault; a 6 × 10 grid.
  - On phones the sheet is full-screen; on desktop it is a 420 px panel.
- **Vendors** (a tap on a stall, or `E` in reach):
  - **the Smithy:** a list of T1 pieces with type filters (cloth, light, heavy, weapons for your jobs), each with the comparison and the price; and Sell from the bag;
  - **the Lampwright:** T3 pieces for Seals, with the Seal count;
  - **the Tailor:** costumes with a live preview on the model, prices, "Owned", and dyeing (pick a piece or costume, a channel and a dye; the price is shown);
  - **the Vault:** opens the bag on its Bank tab;
  - **the Barber:** Task 8's creator in Barber mode.
- **Wardrobe** (`O`): costume slots body, head and back for the current job, the owned list with previews, "None", and a Hide head toggle. Event costumes carry a star badge.
- **Talents** (`T`, or the job board's Talents tab, in a town or sanctuary): three rows of three cards per job, locked rows showing "Level 4", the chosen card lit, and Retrain (at the Guild Board only: free the first time, then the price). The descriptions come from `TALENTS[*].desc`.
- **Stalls** (`stalls.ts`): each is a small code-built booth (awning in its own colour, sign glyph, counter and goods: anvil, bolts of cloth, barber chair, lamp rack, strongbox) with its keeper (`makeCharacter` with a `defaultLook` from the keeper's name). The name shows over the booth within 12 m. Budget: ≤ 6k triangles and ≤ 6 draw calls for all five, merged per material.
- **Loot feedback:**
  - a sparkle at the kill's spot (in the item's rarity colour) and a toast per item, "+ Wickthread Hood" with a rarity border, and "+12 gold";
  - several drops stack into one toast group;
  - a named item gets a gold burst and a longer toast;
  - "Bag full: sold for 40 gold" when it applies.
- **Level-up:** a banner ("Ranger — level 7"), a rising light column on the adventurer (seen by others through `lvlAt`), the new stats in the Character tab, and at talent levels a "New talent row" button in the banner that opens Talents when allowed (else "Visit a town or sanctuary").
- **Frames:** the player frame and the focus frame show the level; party frames already show it (Plan 4).
- **Refusals:** `invRefused` toasts `text`.
- **`window.__sg2net`** adds: `inventory: InventoryView | null`, `lastLoot: { items: string[]; gold: number } | null`, `invRefusals: string[]` (last 20), `stats: Required<Stats> | null`, `levelUps: { job: string; level: number }[]`, `stall: string | null` (the open sheet).

- [ ] **Step 1: Write the failing tests.**
  - `inventory.test.ts`: the state follows `inventory`, `loot` and `levelUp`; `compare(view, uid, job)` gives the right differences and kit totals; set progress counts per set.
  - `gear.test.ts` (DOM): bag tiles are 64 px and every control is ≥ 48 px at 390 × 844 and 844 × 390; no overlap with the joystick zone or the ability arc (the sheets are modal); the detail card shows the comparison; locked talent rows cannot be chosen; vendor price and "Owned" states.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` (the offline demo: no stalls, no bag) and `npm run build:online`. Then the browser check:**
  - start the server on port 2577 with `SG2_TEST_START_GOLD=2000` and `SG2_TEST_LOOT=always` in the background (note the PID);
  - on the iPhone 13 (`?lockq`, game time), as a guest:
    - walk to the Smithy, buy a T1 light chest, equip it: Defence and Health rise in the Character tab (screenshot before and after);
    - buy a costume at the Tailor and wear it (screenshot);
    - dye a piece;
    - choose a talent at the Guild Board (with `SG2_TEST_KIT=t1`, or by reaching level 4 through the dev-only xp hook if present; else record that the talent screen was checked on the HUD dev page);
  - a second page sees the costume;
  - travel to the Greenway, kill a Thornling: the loot toast and the sparkle appear and the item is in the bag (screenshot);
  - on desktop: `I`, `C`, `O` and `T` open their sheets; Esc closes;
  - the HUD dev page (`client/dev/hud.html`): screenshots of each sheet at desktop and iPhone sizes, including a named item card, a full set's bonus lines and the level-up banner;
  - no page errors; `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: bag, equipment and stats, vendors, wardrobe, talents and bank screens, town stalls, loot feedback and the level-up moment`.

### Task 11: Bots with looks and gear, the gear smoke test, the load runs and scripted Warden runs in gear (browser-heavy: the smoke test)

**Files:**
- Modify: `server/scripts/bots.ts`, `docs/load-test.md`.
- Create: `server/scripts/smoke-gear.mjs` (the existing smoke scripts are left as Plans 3b and 4 leave them).

**Interfaces:**
- Consumes: Tasks 5–10. **Plan 4 Task 10 (assumed built):** `bots.ts --dungeon <n>` and `--warden <spec>`, and `smoke-party.mjs`.
- Produces:
  - **`bots.ts --looks`:** each bot `POST`s `/api/look` with `randomLook(seeded by its index)` before joining. The run prints how many distinct look codes were seen by bot 0 (it must be ≥ 90% of the bots in its view).
  - **`bots.ts --gear`** (with `--fight`):
    - bots in the grove first walk to the Smithy (`findPath`) and buy and equip one T1 piece (the server must have `SG2_TEST_START_GOLD` ≥ 200), then go on as before;
    - every 60 s each fighting bot unequips and re-equips a piece (out of combat) and sells one unworn drop when it next passes the Smithy (grove bots only);
    - each bot keeps its own ledger from the messages: gold Δ = loot gold + sales − purchases, and item uids unique.
  - The run prints: purchases, sales, equips, drops, gold earned, refusals by reason, the inventory writes per second (from `/healthz`, Task 6 adds `invWritesPerS`), and the ledger check.
  - **It passes** only if:
    - Plan 4's gates hold;
    - there are 0 refusals other than `'combat'`, `'busy'` and `'rate'` (and 0 `'rate'` at the bots' pace);
    - every bot's ledger matches its last `inventory` view;
    - no uid repeats;
    - `invWritesPerS` p95 ≤ 40;
    - the zone room step p95 ≤ 15 ms.
  - **`--warden <spec>` gains a kit per party:** `job+job:skill@t2`. It prints the outcome beside the G2 and G5 bands. It never gates on the outcome.
  - **`smoke-gear.mjs <url> --kill "kill <pid>"`** (server with `SG2_TEST_START_GOLD=1000`, `SG2_TEST_LOOT=always`): page A (iPhone 13) and page B (desktop):
    - A registers a new account;
    - the creator opens: Brindlekin, three sliders, hair style 12, a free fur colour, a name; Done;
    - both pages show A's look (B's `remoteLooks[A]` equals A's `look`);
    - A walks to the Tailor and buys and wears a costume (A's `gear` code changes on B);
    - A travels to the Greenway, targets and kills a Thornling; `lastLoot` has an item;
    - A opens the bag and equips the item: `__sg2net.stats` changes the way the item's stats say;
    - A sends a non-GM `/gm announce hi`: nobody sees it;
    - killing the server shows "Connection lost".

    Any page error fails it.

- [ ] **Step 1: Run the scripts against the current server to watch them fail** (bots: `--looks` unknown; smoke: the creator step).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run root `npm test` (PASS, pristine). Then the load runs**, each on a fresh server on port 2578 (PID noted, `kill <pid>` after each):
  - grove, `--count 100 --seconds 30 --looks`, then `--cluster 15 --looks`: PASS, KiB/s within the Global Constraints (≤ 11.5, and ≤ +0.5 over the previous recorded numbers);
  - `SG2_TEST_START_GOLD=500`: `--count 100 --seconds 240 --fight --jobs mixed --looks --gear --dungeon 13`: PASS.

  If one fails, profile and fix the server, never the thresholds. Likely fixes, in order: coalescing loot writes per step; not re-encoding `gear` when unchanged; the queue's reload path.
- [ ] **Step 4: Run the scripted Warden runs** on port 2579 (`SG2_TEST_INSTANCE_START=landing`, PID noted):
  - `--warden "paladin+black_mage:sloppy@starter,paladin+black_mage:sloppy@t2,dark_knight:careful@t3" --seconds 420`;
  - record each outcome next to its band (G2, G5); a disagreement is reported, not tuned here;
  - `kill <pid>`.
- [ ] **Step 5: Run the smoke test:** a fresh server on port 2579 with the switches above (PID noted); `node server/scripts/smoke-gear.mjs http://localhost:2579 --kill "kill <pid>"` → PASS. Also re-run `smoke-party.mjs` (Plan 4) and Plan 3b's `smoke.mjs` against fresh servers as they need → still PASS.
- [ ] **Step 6: Record every run's printed numbers in `docs/load-test.md`** (date, machine, switches, purchases, drops, writes per second, KiB/s). **Commit**: `test: bots with varied looks and gear, the gear smoke test, the load runs and scripted Warden runs in gear`.

### Task 12: Docs: outcome placeholder, roadmap and verification list

**Files:**
- Modify:
  - this plan, `docs/superpowers/plans/2026-11-12-sg2-plan-5-progression-gear-and-characters.md` (fill `## Outcome`);
  - `docs/superpowers/plans/2026-11-11-sg2-plan-1-online-foundation.md` (the roadmap line for Plan 5).

**Interfaces:**
- **Roadmap 5** becomes:

  > **Progression, gear and character creation** — per-job levels 1–10 on a real curve (3b progress kept), talent rows at 4, 7 and 10 with retraining for gold; eight visible slots, three armour types with Focus, Flow and Guard, nine named sets with three- and five-piece bonuses, named Warden weapons; personal loot rolled by the server, gold, the Smithy, the Lampwright (Warden's Seals), the Tailor (costumes and dyes, gold only), the Barber and the Vault; four peoples with in-depth looks, stance, walk and emotes, and the character creator; GM tools with a shell-only role and an audit log. Done (`2026-11-12-sg2-plan-5-progression-gear-and-characters.md`).

- [ ] **Step 1: Run the verification list below. Record each result, with numbers, in `## Outcome`:**
  1. Root `npm test`: the pass and skip counts, pristine.
  2. `npm run typecheck`: clean.
  3. `npm run build` and `npm run build:online` in `client/`: both succeed. The offline demo has no creator, stalls or bag.
     Then build the server bundle (`npm run build` in `server/`) and run `SG2_REQUIRE_BUNDLE_SCAN=1 npx vitest run shared/src/names.test.ts`: the bundle scan must scan all three bundles (`client/dist`, `client/dist-online`, `server/dist`), none stale, and find no blocklist entry.
  4. Task 5's band tables (final numbers, headroom on both seed sets) and every tuning change.
  5. The load runs (port 2579, after fresh starts): the grove and clustered KiB/s with `--looks`; the 240 s `--gear --dungeon 13` run: Hz, corrections, purchases, drops, writes per second, step p95 and RSS.
  6. `smoke-gear.mjs`, `smoke-party.mjs` and `smoke.mjs` against fresh servers on port 2579: PASS.
  7. The scripted Warden runs beside their bands.
  8. Review Focus 1–7: for each, the test names that cover it.
  9. Grep the repository's tracked files and both bundles for any ROT13-decoded fixture entry (a scratch script): none outside git history. Grep the client bundle for `/gm` command words: none.
  10. Grep for secrets (`SG2_JWT_SECRET=` with a value outside docs and the local test command): none. Grep `docker-compose.yml` and the Dockerfile for `SG2_TEST_START_GOLD`, `SG2_TEST_LOOT`, `SG2_TEST_KIT` and `SG2_TEST_GMS`: none.
  11. Migration check (pg, if available): a dump of a Plan 4 database migrates and every adventurer keeps job levels, Seals and titles, with the starter kit worn and a free creator visit.
- [ ] **Step 2: Write `## Outcome (date)`** in Plan 4's style: status, numbers, rulings made during the build, deferred items, and "For Plans 6 and 8" notes (quest xp and rewards through `addJobXp` and `ITEMS`; the rested bonus and mannequins).
- [ ] **Step 3: Commit**: `docs: Plan 5 outcome and roadmap`.

## Decisions this plan makes that the spec leaves open

These are recorded so that reviewers can check the tasks against them.

**Levels and talents**
- The cap is the spec's 10 (not 20). The curve is `XP_TO_NEXT` (3180 xp to the cap). 3b progress is migrated level-for-level, with its share of progress kept.
- **Level 10 in the starter kit is exactly Plan 3b's `STARTER_STATS`**, so every earlier band describes a fresh cap adventurer (parity, P1). Lower levels are weaker (level 1: 7 / 7 / 82 with the kit).
- Xp sources:
  - kills, credited only with at least 10% of the top threat (no tagging), plus Plan 4's party share;
  - Lampfall pack clears (+30 each);
  - bosses (Plan 4's `KILL_XP`);
  - quests later, through `addJobXp`.
- Catch-up: × 1.5 for a job below the adventurer's highest job level. No rested xp (Plan 8 owns it).
- A level gives base stats, and talent rows at 4, 7 and 10. **There are no ability unlocks by level in this slice.** Every job's whole bar and pool stay open from level 1, because the duo design and every band rely on them (the spec's "abilities unlocked by level and quest" becomes "talents by level, abilities and jobs by quest", Plan 6).
- Talents: three rows of three per job (63 in all), not a ten-point tree. Each is a sidegrade made of `Mod`s. Choosing is free in a town or sanctuary; retraining is at the Guild Board, free the first time per job, then 25 gold per row.
- The adventurer row's `level` column becomes the highest job level (written on save; nothing reads it in play). `xp` stays unused.

**Gear**
- Slots are the spec's eight (no trinkets). The off-hand is a buckler, quiver, shield or tome by weapon. The greatsword and daggers take none, and their weapon carries all the power.
- **Gear sets are per job.** Each job wears its own set, so switching jobs switches gear. One item may be worn by several jobs at once and then takes no bag slot.
- Gear can be changed anywhere while out of combat. Jobs and talents only in towns and sanctuaries.
- The special stat per armour type: cloth **Focus** (stronger abilities: damage, heals and shields), light **Flow** (faster Momentum; critical hits left out, because the engine has no random hits), heavy **Guard** (more threat, less knockback: the engine's form of "stagger resistance" and "enemies prefer the wearer").
- Fixed stats per item: no random rolls or affixes. "Rarity" is starter, common, set and named, shown by colour.
- The tier budget: T2 at level 10 is Plan 4's mid stand-in (13 / 14 / 130), and T3 is its top stand-in (20 / 24 / 180), so Plan 4's G1 proof becomes real gear. T3 is a deliberately large step (spec: large tier gaps; a solo kill only in the top tier).
- Nine sets (one per type per tier), each with a 3- and a 5-piece bonus that changes play. Seven named Warden weapons (two staves, one per mage), each with a unique effect. The other weapons have unique models, and only starter weapons share.
- **Personal loot**, replacing the spec's "shared loot rolls": every credited adventurer rolls its own drops on the server, straight into the bag, so duos never compete. The roll is seeded per kill and adventurer and remembered, so it can never be claimed twice.
- Bad-luck protection:
  - a guaranteed Wickhound (T2) and Warden (T3) piece on the first kill each UTC day;
  - duplicates re-rolled while new pieces remain;
  - the Lampwright sells T3 for Warden's Seals (23 for a full kit).
- T1 is bought at the Smithy for gold or dropped in the Greenway. T2 only drops in the Lampfall.
- Bag 30 slots, Vault 60. A full bag sells a drop at once, with a notice. Nothing is ever lost on death.
- **No trading, mail or gifting in this slice.** Items and gold stay with their adventurer, which also closes the usual duplication routes.
- Gold sources: kills, clears, sales and GM grants. Sinks: the Smithy, the Tailor (costumes and dyes), the Barber and retraining. Gold is capped at 1 000 000. No durability or repairs.

**Looks**
- The four peoples are original names, looks only:
  - Humans;
  - the **Larchfolk** (tall woodland folk);
  - the **Knollfolk** (small sturdy folk);
  - the **Brindlekin** (beast-folk).

  Sky-folk is a data hook only.
- The look has six body sliders, seven face options, 20 hair styles, 8 facial hair options, free colours, Brindlekin fur patterns and tails, four stances, four walks, six emotes, and two outfit dyes, encoded in ≤ 38 characters.
- The look and gear codes are sent on view entry and on change only.
- Existing and new adventurers get a varied `defaultLook` from their account id and **one free creator visit**. After that, the Barber charges 40 gold (200 to change people).
- Dyes: 32 named dyes, two channels per armour piece and costume, 5 gold per change at the Tailor. Free colour pickers are for the body (skin or fur, hair, eyes, marks).
- Costumes: body, head and back slots over gear, remembered per job (the spec's "each job remembers its own outfit" is its gear set plus its costume choice). Bought only with gold at the Tailor, or GM-granted event costumes. Never sold or lost.

**Names**
- The blocklist ships as hashes (cyrb53, searched by window lengths) with the same behaviour. Tests read a ROT13 fixture. A maintainer script hashes a plain list from stdin. The old plain list remains in git history only.

**GM tools**
- The role is the existing `is_gm` column, set only by a server-shell CLI. There is no route or message to set it, and changes apply on the next join.
- Commands are `/gm` chat lines parsed only on the server: announce, grant gold, item or costume (online or offline), teleport, kick, and events (start, end, award costume).
- Every GM command is audited. Non-GM `/gm` lines vanish silently.
- Limits: 20 commands a minute, one announce per 30 s, 100 000 gold a day per GM. GM chat lines carry a GM badge.

**Testing and tooling**
- Bands use the four skill levels (careful, skilled 10%, sloppy 30%, careless), ≥ 20 seeds, and ≥ 3 SD of headroom on two seed sets. Only Task 5 tunes, under a written rule.
- The Greenway is not scaled down for high levels: F1 sets a floor on how fast top gear clears it.
- New test-only server switches: `SG2_TEST_START_GOLD`, `SG2_TEST_LOOT=always`, `SG2_TEST_KIT` and `SG2_TEST_GMS`. They are never set in Docker.
- The gear smoke test is its own script (`smoke-gear.mjs`).

## Outcome

Built by subagent-driven development: Tasks 1–7 (shared and server) each implemented and independently reviewed with a fix round (Task 5's review was folded into the whole-branch review); Tasks 8–10 (client) built in parallel worktrees; Task 11 (bots and the live pass) together with Plan 6 Task 7; one whole-branch review and one fix wave. This section (Task 12) was written by the coordinator.

**What exists**
- Levels 1–10 per job on a real curve (3180 xp), with old xp migrated without losing a level; talents: three rows of three per job at levels 4, 7 and 10, first retrain free.
- Gear: eight slots, three tiers, nine sets, seven named Warden weapons, each job with its own gear; personal server-rolled loot; Seals buy T3; bag 30, Vault 60; no trading. **All stats are whole numbers of at least 1** (user rule; `wholeStats.test.ts`).
- Character creation: four peoples (Humans, Larchfolk, Knollfolk, Brindlekin — looks only), sliders, faces, hair, colours; the Barber; a hashed name blocklist.
- Gear, weapons, costumes and dyes on the model, with each job's cue kept over any set.
- Bag, equipment with before → after comparison, vendors, wardrobe, talents and Vault screens; loot and level-up feedback.
- GM tools: role granted only from the server shell; `/gm` commands; an append-only audit log.

**Verified by the coordinator on the final code (`e266db9`), machine quiet:** root `npm test` 1773 passed, 6 skipped; `npm run typecheck` clean; the offline and online client builds and the server build pass; the bundle scan with `SG2_REQUIRE_BUNDLE_SCAN=1` passes; the browser smoke tests are listed in Plan 6's outcome. Load numbers were measured by workers on a quiet machine (docs/load-test.md): walkers, clustered walkers, fight, cycle, dungeon and twelve Warden fights at once hold 15.0–15.2 Hz; clustered bandwidth is 10.7 KiB/s plain and 11.0 with looks, parties and T3 gear (the limit, no headroom). The pg store suite passed 550 tests on Postgres 16 (worker run).

**Rulings**
- P5-a Same-kind bonuses from different sources do not stack (the larger applies). P5-b No dead bonuses in a job's own sets or weapon (retunes). P5-c Heal shields trigger on ability heals, not lifesteal. P5-d Taunt triggers include Dread Howl.
- P5-e Inventory operation ids are random, 12–40 characters, required for purchases and Vault moves. P5-f Twin Wicks' Momentum once a second. P5-g Wickthread's cleanse trigger once per 10 s. P5-h No gear, talent or pick changes inside a sealed arena.
- Looks and gear codes travel in a `looks` message, once per adventurer per client.
- Migration 006 never stamps `curve: 2` on old rows; there is no downgrade.

**Deferred to tuning with real players**
- In T3 the Warden is a formality for any duo that dodges; a hard mode is proposed, not built.
- Four named weapons and twelve talents show little measurable effect in the simulation.
- Lenslight is about 5% better for six of seven jobs.
- Support picks make no difference in T3.
- Skipped bands: G2 starter ceiling, G5 sloppy solo in T3, the Ranger's Thornling time.
- Budgets missed: a low-quality body is about 1.75k triangles (target 1.2k); a look rebuild takes 15–50 ms (queued two per frame).
- Clustered bandwidth is at its limit with looks, parties and T3 gear.
- The append-only audit rule is a trigger and the shipped database role is a superuser (deploy/README.md, Known limits).
- Not verified live: a talent's effect on an ability.
- Never tested on a real phone.
