# Shady Grove 2 — Plan 4: Parties and the Fallen Warden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adventurers team up. A party holds up to four adventurers and stays together across zones and short disconnects. Party members are each other's allies: heals, shields and buffs go to them first, they share kill credit, they see each other on frames and edge markers, and they have their own chat channel. A party walks into **the Lampfall** (the crater in the Greenway where the thing from the Beacon came down) and gets its own private copy of it: a generated chain of cellars and halls with three packs, a mid boss (the Wickhound) tuned for a good duo, and at the bottom the **Fallen Warden**, a three-phase mega boss tuned for a strong duo or three average adventurers. The fight rewards the Plan 3b kit: interrupts, Breaks, marks and reactions, taunts, heals, shields, revives and dodges. The server decides everything, and the shared simulation proves the difficulty bands for parties of one to four.

**Architecture:** This plan adds to Plans 3 and 3b. It replaces nothing but the "any adventurer in the room is an ally" rule.
- `@sg2/shared` gains:
  - party and instance constants, views and message shapes (`party.ts`, `instance.ts`);
  - the ring telegraph shape, player afflictions (`afflictions.ts`), ground fields (`fields.ts`) and enemy spawning and despawning in the engine;
  - the party-aware ally rule in `effects.ts` (`allied`);
  - boss data and the boss script (`bosses.ts`, `bossAi.ts`): phases, rotations, transitions, adds, wards, enrage and party-size scaling;
  - the encounter table (`encounters.ts`), which both the dungeon generator and the simulation read;
  - the dungeon generator (`world/dungeon.ts`, `generateDungeon(LAMPFALL_RECIPE)`) and the `lampfall` zone definition, with the crater mouth placed in the Greenway by its recipe;
  - simulation of dungeon encounters for parties of one to four, at three skill levels.
- The server gains:
  - a process-wide party registry (`server/src/party/parties.ts`);
  - an instance registry (`server/src/rooms/instances.ts`). Each instance is one Colyseus room of the zone `lampfall`, one per party run, capped at `MAX_INSTANCES`;
  - instance rules in `ZoneRoom`: saves at the mouth, checkpoints, wipes, sealed boss arenas, a 120 s reconnect hold, and victory rewards;
  - migration 005: Warden's Seals, titles and boss kill records with a leaderboard endpoint.
- The client gains:
  - party frames, invites, a party sheet, party chat, edge markers;
  - instance entry and exit, wipe and victory screens, a boss frame with phases;
  - the code-built Lampfall, the crater mouth in the Greenway, the Wickhound, the Lens Shard and the upgraded Warden model;
  - the ring, "spread" and interruptible telegraph language, and ground fields.

**Tech Stack:** as Plans 1–3b: TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, PostgreSQL 16 / memory store, Playwright (pre-installed; never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md`. This plan implements:
- section 7 **Parties**: up to 4 players, invite by tapping a player, party health bars;
- section 8 **Mega boss: the Fallen Warden**: tuned for a strong duo or three average players, no weaker for fewer players, a 3rd and 4th player each add health, three phases that each change the arena, a private arena per party (or per solo player), no party-required gate, a solo kill title and a place on the boss leaderboard;
- section 6 **Difficult fights** for bosses: each has two or three attacks that must be dodged, interrupted or parried; the mega boss has an enrage timer;
- section 8's "ordinary bosses and dungeons are tuned for a good duo";
- Error handling: "Inside a boss arena a disconnected player's slot is held for 2 minutes";
- Testing: party smoke test, "a scripted solo run and a scripted 3-player run of the Fallen Warden to check tuning", and boss-scaling unit tests;
- Plan 3b's open hook: the White Mage's cleanse now has an affliction to clear.

**Boundary with other plans** (stated so no worker builds it):
- **Plan 3b is still being finished.** Its Tasks 7–10 (client job board and ally focus, weapon and spell effects, mixed-job bots, docs) are in progress while this plan is written. Where a task here depends on them, it says so and names the interface it assumes. If the built interface differs, the task adapts to what was built and records it.
- **Plan 5 owns:** gear, loot and loot rolls, items, the real level curve, talents, outfits. This plan gives a placeholder reward: job xp and a **Warden's Seal** count saved on the adventurer. Plan 5 turns Seals into gear (it decides the exchange). The spec's "shared loot rolls" moves to Plan 5 with the loot itself.
- **Plan 6 owns** quests and story scenes. This plan carries only the lore lines the boss frame, phase banners and victory screen show.
- **Plan 7 owns** the general world generator. The Lampfall's generator here is small and self-contained, written so Plan 7 can absorb it.
- **Later:** hard mode after the first kill, voice chat (tabled by the owner), a leaderboard page in the client (the endpoint is built here; the victory screen shows the rank).

## Global Constraints

- **One combat system (Plans 3 and 3b, unchanged):** tap-target and auto-attack, one Momentum bar (0–100, finishers cost 50), five buttons per job (three job abilities plus two picks from the job's own pool; no borrowed abilities), a dodge roll with charges, marks and combos, element reactions, stagger and Breaks, and ground telegraphs with wind-ups of **at least 1.0 s**. Bosses add no new resource and no new button.
- **Jobs change only where `CombatZone.jobSwitch(x, z)` is true** (a town, or inside a sanctuary circle). The Lampfall has two sanctuaries (the Crater Rim and the Keeper's Landing), so a party can re-job before the Warden; the Greenway still has none.
- **Server-authoritative:** clients send intents and requests only. The server decides party membership, invites, instance entry, allies, credit, wipes, seals, phases and rewards. Every party and instance message is validated and rate-limited; anything malformed is dropped.
- **Hits are decided by ground x/z only** (unchanged). Fields (standing hazards) tick by ground position too, and being in the air never avoids them.
- **Honest clients are never corrected** except where a rule says so (a sealed arena gate or a full instance cap corrects like a full zone's exit does, with a notice).
- **One shared rules package:** boss data and scripts, encounter data, the dungeon generator, the ally rule and the simulation live in `@sg2/shared`. The server, client and bots import them and never copy them.
- **Generated, never hand-placed:** the Lampfall comes from `generateDungeon(LAMPFALL_RECIPE)` and the crater mouth from the Greenway's recipe. Only exactly-rounded arithmetic in generator files (no `Math.sin/cos/exp/pow/hypot/random`, no `**`; `recipe.test.ts`'s scan applies to `dungeon.ts` too). Every zone fits ±`ZONE_XZ_MAX_M` (500 m) and heights `ZONE_Y_MIN_M`..`ZONE_Y_MAX_M` (−52..180 m), checked by `checkZoneLimits` and the generator.
- **Scale and bandwidth:**
  - 100 adventurers online in all, at `TICK_HZ = 15`;
  - at most `MAX_INSTANCES = 12` instances at once, each holding at most `PARTY_MAX = 4` adventurers;
  - each zone room's step p95 ≤ 15 ms; each instance's step p95 ≤ 3 ms;
  - peak RSS ≤ 400 MB;
  - per-client receive ≤ 11.5 KiB/s in the clustered 100-walker grove run, and no more than +0.5 KiB/s over Plan 3b's numbers in `docs/load-test.md` for the same runs;
  - party status travels at most `PARTY_STATUS_HZ = 2` times a second, only when it changed.
- **Phone-first:**
  - every touch control is at least 48 px (ability buttons 64 px);
  - party frames are 48 px rows; the invite card's buttons are 56 px; the party sheet is full-screen on phones;
  - inviting is a tap on an adventurer (the focus frame's "Invite" button) or `/invite Name`;
  - the boss frame sits at the top centre and never covers the joystick zone or the ability arc;
  - no ground aiming (unchanged).
- **Desktop keys:** as Plan 3b, plus `P` for the party sheet and `Enter` then `/p text` for party chat.
- **Names:** dungeon, room, boss, ability and affliction names are original (the Lampfall, the Wickhound, Keeper's Toll, Searing, ...). "The Fallen Warden" is the spec's name. Job names still come only from `JOBS[id].name`.
- **Chat is unfiltered for now** (owner decision), but always cleaned (`cleanChat`) and shown as plain text. Party chat follows the same rules.
- **Art:** everything is built in code, flat-shaded low-poly with toon lighting, in `PALETTE` colours, no asset files. The Lampfall is moody but readable on a phone: telegraphs and fields must stand out on its floors in every quality tier.
- **Persistence:**
  - parties live in server memory only (a restart dissolves them);
  - an adventurer inside an instance is always saved in the Greenway at the crater mouth (`LAMPFALL_MOUTH.arrive`), so a crash or restart puts it there, never inside a lost instance;
  - Seals, titles and boss kills are saved (migration 005).
- **Everything from Plans 1–3b keeps working:** accounts, travel, reconnect and relog carry, death and respawn, interest views, jobs, fall damage, tap-to-walk, Docker packaging. Root `npm test` stays green with pristine output. `npm run build` (the offline demo) stays the combat-free town; `npm run build:online` gets everything.
- **Out of scope** (design so it slots in, do not build): loot, items and loot rolls (Plan 5); hard mode; a client leaderboard page; voice chat; party persistence across server restarts; cross-party trading.
- **Environment:**
  - no secrets in the repository;
  - never touch anything outside the repository: no global installs, no system services, no killing processes the task did not start;
  - Playwright is pre-installed, so never install it.
- **Browser checks:**
  - headless WebGL runs at about 1 fps, so measure game time, not wall time;
  - open pages with `?lockq`;
  - Tasks 8, 9 and 10 are browser-heavy, and only one of them may run at a time (also never at the same time as a browser-heavy Plan 3b task);
  - local test servers use ports 2571–2579 with `SG2_STORE=memory`, are started in the background with their PID recorded, and are stopped with `kill <pid>`. Never use `fuser` or kill by name. Smoke scripts get `--kill "kill <pid>"`;
  - the standard local server command (fill in the port) is:
    ```
    SG2_STORE=memory SG2_AUTH_RATE_PER_MIN=1000 SG2_PORT=<port> SG2_JWT_SECRET=local-test-secret-0123456789abcdef npx tsx server/src/index.ts
    ```
- **Git:**
  - TDD: write the failing test first;
  - stage explicit paths only (`git add <paths>`, never `-A` or `.`); never `git stash`;
  - other workers may be editing `client/` and `server/` at the same time: touch only the files your task lists;
  - every commit message ends with exactly these two lines:
    ```
    Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01YDaH79F8gHUx42PWzrB3f9
    ```
  - no model names anywhere else.

## Task order and parallelism

| Task | Depends on | May run in parallel with | Browser-heavy |
|---|---|---|---|
| 1 Shared data: boss and add kinds, attacks, ring shape, afflictions, party and instance constants and messages | — | — | no |
| 2 The Lampfall generator, the `lampfall` zone and the crater mouth in the Greenway | 1 | 3, 4 | no |
| 3 Engine I: party allies, afflictions, fields, spawning and despawning | 1 | 2 | no |
| 4 Engine II: the boss script (phases, rotations, adds, wards, enrage, scaling) | 3 | 2, 6 | no |
| 5 Party simulation, the dungeon brain and the difficulty bands | 4 | 6, 7, 9 | no |
| 6 Server I: parties (registry, invites, chat channel, allies, pins, shared credit) | 3 | 4, 5 | no |
| 7 Server II: instances, checkpoints, wipes, seals, rewards, migration 005, `/api/zone` | 2, 4, 6 | 5, 9 | no |
| 8 Client I: party UI, party chat, edge markers, instance entry and exit, boss frame, wipe and victory screens | 7 (and Plan 3b Task 7) | 5 | **yes** |
| 9 Client II: the Lampfall's look, the crater mouth, boss and add models, telegraph language, fields | 2, 4 (and Plan 3b Task 8) | 5, 6, 7 | **yes** |
| 10 Bots in parties and instances, the party smoke test, the load runs, the scripted Warden runs | 5, 7, 8, 9 (and Plan 3b Task 9) | — | **yes** (smoke) |
| 11 Docs: outcome placeholder, roadmap, verification list | 10 | — | no |

Tasks 8 and 9 may not run at the same time (both browser-heavy). Task 9's dev-page work runs without a server; its live check waits until Task 8 is not running a browser.

Only Task 5 may change the new boss and encounter numbers after Task 1, and only under the Tuning rule. Tasks 3, 4, 6 and 7 implement the rules exactly as written. They report numbers but do not tune. No task changes a Plan 3 or Plan 3b number.

## Numbers

New combat constants live in `shared/src/combat/constants.ts` in a section headed `// ───────── parties and bosses ─────────`. Party constants live in `shared/src/party.ts`, instance constants in `shared/src/instance.ts`. Plan 3 and 3b constants are unchanged.

**Parties** (`shared/src/party.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `PARTY_MAX` | 4 | members, the leader included |
| `PARTY_INVITE_S` | 60 | an invite expires after this |
| `PARTY_REINVITE_S` | 60 | after a decline, the same inviter cannot invite the same adventurer again for this long (refused `'rate'`; ruling P4-d) |
| `PARTY_INVITES_PER_MIN` | 10 | invites one adventurer may send per minute (more → `'rate'`) |
| `PARTY_OFFLINE_KEEP_S` | 300 | a member signed out (no session anywhere) stays in the party this long |
| `PARTY_LEADER_AWAY_S` | 60 | an offline leader hands the lead on after this (to the longest-standing online member) |
| `PARTY_STATUS_HZ` | 2 | member status (hp, zone, job, dead) is relayed at most this often, only when changed |
| `PARTY_SHARE_R` | 60 m | party members in the same room within this of a kill share its credit |

- A party has an id (`'p' + a counter`), a leader and 1–4 members, in join order. A party of one dissolves (a leader alone after the others leave is not a party).
- **Only the leader invites, kicks and promotes.** Anyone may leave. When the leader leaves, the longest-standing remaining member leads.
- **Invite** by engine id (a tap on an adventurer in your room) or by name (exact, case-insensitive, any room; the target must be online). One pending invite per (party, invitee); a new invite from the same party refreshes it. An adventurer can hold invites from several parties and accepts one.
- **Refusals** (`PartyRefusal`): `'self'`, `'unknown'` (no such adventurer online), `'in-party'` (the invitee is in a party already), `'full'`, `'not-leader'`, `'expired'` (no live invite), `'rate'`, `'not-member'`, `'in-instance'` (kicks are allowed in an instance; an invitee standing in another party's instance cannot accept until it leaves). Each has a fixed English line in `PARTY_TEXT: Record<PartyRefusal, string>`.
- **Party chat:** a chat line with `channel: 'party'` goes to every online member in any room. Same `cleanChat`, `CHAT_MIN_INTERVAL_MS` and length rules as zone chat (the interval is shared across channels).

**The ally rule** (replaces Plan 3b's "every adventurer in the zone counts as an ally"):
- `allied(a, b) = a === b || (a.party !== null && a.party === b.party)`.
- **Automatic picks choose only allies:**
  - `ally` aim without an explicit id: the lowest-hp **allied** adventurer in range, self included;
  - `other-ally` and `dead-ally` without an explicit id: only allied adventurers (else `'no-ally'`);
  - `heal … on: 'lowest'` (Lantern Flare), Bloodbond's copy, Soft Rain, Dawn Ward, Aegis's `aegis_ally`, Rallying Roar and every other area effect on adventurers (`on: 'area' | 'others'`): allied only;
  - the reactions `steam` and `bedrock`: allied adventurers only.
- **An explicit `ally` id may name any live (or, for revives, dead) adventurer in range and sight, stranger or not.** Helping a stranger is always allowed, but only on purpose (a tap). Shelter on a stranger is allowed.
- Without a party, an adventurer's only ally is itself.
- Kill credit (`TickOut.kills[].credit`, Plan 3's threat-table rule) is unchanged in the engine. The server adds every party member of a credited adventurer who is in the same room within `PARTY_SHARE_R` of the enemy, alive or dead. Each credited adventurer gets the full `KILL_XP` (xp is not split).
- `pinnedAdventurers(session)` returns the session's party members in the same room: they are always in its view, whatever the radius or the cap.

**Instances** (`shared/src/instance.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `MAX_INSTANCES` | 12 | Lampfall instances open at once (48 adventurers at most) |
| `INSTANCE_EMPTY_S` | 120 | an instance closes this long after its last adventurer left (reconnect holds included); a cleared instance closes at once |
| `INSTANCE_MAX_S` | 5400 | hard lifetime (90 min); then everyone inside is sent to the mouth with a notice |
| `INSTANCE_RECONNECT_S` | 120 | a dropped adventurer's seat inside is held this long (spec: 2 minutes) |
| `INSTANCE_EVICT_S` | 10 | after leaving or being kicked from the party, an adventurer inside is sent to the mouth after this |
| `WIPE_DELAY_S` | 5 | after a wipe, everyone gets up at the checkpoint after this |
| `RELEASE_MIN_S` | 10 | a dead adventurer in an instance may release (get up at the checkpoint) after this |
| `AUTO_RELEASE_S` | 60 | ...and releases by itself after this |
| `SEAL_DELAY_S` | 3 | a boss arena's gate shuts this long after the boss wakes (stragglers at the door step in) |
| `SEAL_GATE_R` | 3.0 m | radius of the gate circle on the arena's entry corridor |

- **One instance per party.** The key is the party id, or `'solo:' + accountId` for an adventurer without a party (a solo run is a party of one: no party is required). The first member to walk into the crater mouth opens it; later members who walk in join the same instance while it is open and they are in the party.
- **Full:** when `MAX_INSTANCES` are open, walking into the mouth is corrected with the notice `REASON_INSTANCES_FULL = 'The Lampfall is crowded right now, try again in a minute'`.
- **Saving:** a session in an instance saves `{ zone: 'greenway', x, z, facing: LAMPFALL_MOUTH.arrive }` with its hp (a dead adventurer saves at full hp). `'lampfall'` is a `ZoneId` (it has a def and rooms) but never a saved zone: `SAVE_ZONE_IDS = ['grove', 'greenway']`, and `checkedSave` refuses anything else.
- **Reconnect:** a drop inside holds the seat `INSTANCE_RECONNECT_S`. A fresh sign-in within that time (another tab, a new phone) gets `GET /api/zone → { zone: 'lampfall', instance: <roomId> }` and joins the instance by id. After the hold, it gets `{ zone: 'greenway' }` and stands at the mouth.
- **Death inside:** no statue. A dead adventurer stays where it fell and can be revived (Second Dawn). After `RELEASE_MIN_S` it may `release` and get up at the instance's current checkpoint at full hp; it does so by itself after `AUTO_RELEASE_S`.
- **Wipe:** when every adventurer in the instance is dead at once (released ones count as dead until they stand up), it is a wipe. After `WIPE_DELAY_S` everyone gets up at the current checkpoint at full hp; every engaged enemy goes home and resets (Plan 3's return rule, which heals it; a boss resets its phase, adds and fields). Killed enemies stay dead: nothing respawns in an instance.
- **Checkpoints:** `rim` (the start) and `landing` (once the Wickhound is dead).
- **Sealed arenas:** the Wick Den and the Lens Pit each have a gate circle on their entry corridor. From `SEAL_DELAY_S` after the boss wakes until it dies or resets, a pose into the gate is corrected with `REASON_ARENA_SEALED = 'The lamp-gate is shut until the fight ends'`. A released adventurer therefore cannot rejoin a boss fight; reviving matters.
- **Leaving:** walking into the Crater Rim's exit stair travels to the Greenway at the mouth. After the Warden falls, a lamp-lift exit opens at the Lens Pit's centre (the same travel). The victory screen's "Leave the Lampfall" button sends `leaveInstance`.
- **No lockout:** a party may run again as often as it likes. A cleared instance closes when its last adventurer leaves, and the next entry opens a fresh one. Rewards are limited instead (Seals, below).

**Rewards** (placeholders until Plan 5)
- `KILL_XP` gains: `wickhound: 120`, `fallen_warden: 300`, `lens_shard: 0`. Credited as Plan 3b (each credited adventurer's current job).
- **Warden's Seal:** every adventurer credited with a Warden kill gets one Seal, at most once per UTC day (`sealDay`). Saved as `seals` (count) and `sealDay` (`'YYYY-MM-DD'` or null). Plan 5 exchanges Seals for gear.
- **Solo title:** a kill credited to exactly one adventurer, in an instance that never held more than one adventurer during the fight, grants the title `'Lampbreaker'` (saved in `titles`).
- **Leaderboard:** every Warden and Wickhound kill is recorded (`boss_kills`: boss, party size, seconds from wake to kill, names, time). `GET /api/leaderboard/:boss?size=n` returns the ten fastest. The victory screen shows the party's rank for its size.

**Shapes and afflictions**
- `Shape` gains `{ kind: 'ring'; x: number; z: number; inner: number; r: number }`: inside when `inner ≤ d ≤ r`. `escapeDir` for a ring points to the nearer boundary (inward when `d − inner < r − d`).
- `EnemyAttackData.shape` gains `'ring-self'` (a ring centred on the enemy) with `inner`.
- `AfflictionId = 'searing'`. `AFFLICTIONS.searing = { name: 'Searing', maxStacks: 5, s: 8, takenPerStack: 0.10, bit: 1 }`:
  - each Warden auto that lands (hp or shield) adds one stack and refreshes the expiry to now + 8 s;
  - each stack multiplies enemy damage taken by (1 + 0.10 × stacks), after Plan 3b's taken multipliers;
  - Wellspring's `cleanse` removes it (Plan 3b's hook, now real);
  - shed by: a taunt swap (the other adventurer takes the autos), Mist Form and Ashcloud's blind (autos miss), or 8 s out of the Warden's reach.
- **Fields** (standing hazards): `FieldDef = { id: FieldId; shape: Shape (relative to the boss's camp); raw: number }`. Each whole second after it starts, every live adventurer inside (ground x/z) takes `enemyHit(raw, defence, takenMult)` through its shield. Fields ignore i-frames, never break casts, never knock, and never add Searing. They are sent to clients as state (`ZoneState.fields`).

**Boss scaling** (extends Plan 3's elite rule, ruling P3-e)
- Plan 3 elites are unchanged: ×(1 + `ELITE_SCALE_PER` × (n − 1)), n = distinct live adventurers on the threat table, capped at `ELITE_SCALE_CAP` = 4, never down during a fight.
- A boss uses its own table instead, indexed by the same n: `scale: readonly [n1, n2, n3, n4]`, applied to max hp and the stagger bar, keeping the hp fraction, never down during a fight, back to base on a reset.

| boss | n = 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| `wickhound` | 1 | 1 | 1.5 | 2.0 |
| `fallen_warden` | 1 | 1 | 1.45 | 1.9 |

  The tables never go below 1: a boss is never weaker for fewer adventurers (spec §8). Adds a boss spawns take the boss's current factor.

**New enemy kinds** (`ENEMY_KINDS`, `shared/src/combat/enemies.ts`). `EnemyKindData` gains `tier: 'ordinary' | 'elite' | 'boss' | 'mega'` (Plan 3 kinds: thornling, boar, archer, dummy `'ordinary'`; mossback `'elite'`) and `boss?: BossData`. Bosses have `elite: true` (stagger bar; a parry staggers instead of stunning). Raw damage is before the adventurer's defence (×0.8 for a starter).

| kind | name | tier | hp | def | radius | speed | aggro (wake) | leash | auto (reach, every, raw) | attacks | weak / resist | stagger | respawn |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `wickhound` | the Wickhound | boss | 2600 | 15 | 1.4 | 4.5 | 10 | 14 (room r − 2) | melee 3.0 m, 2.2 s (1.8 s in phase 2), 10 | wick_lunge, ember_breath, cinder_ring | water / fire | 220 | never |
| `fallen_warden` | the Fallen Warden | mega | 6000 | 18 | 1.8 | 3.5 | 10 | 20 (room r − 2) | melee 3.2 m, 2.8 s (2.4 s in phase 3), 9, adds Searing | lamp_sweep, brass_fall, keepers_toll, beacon_lance, turning_light, last_light | water / fire | 300 | never |
| `lens_shard` | Lens Shard | ordinary (add) | 420 | 5 | 0.8 | 0 | 40 | — | none | focus_beam | lightning / — | 0 | never |

"never" is `respawn: Infinity`. A Lens Shard never moves; it is spawned engaged with every adventurer on the Warden's threat table.

**New attacks** (`ENEMY_ATTACKS`). `EnemyAttackData` gains `inner?`, `targets?: 'each'` (one telegraph per live adventurer on the threat table, each a `circle-target` on that adventurer), `aimAt?: 'target' | 'farthest'` (Plan 3's `AIM_FARTHEST` set becomes `aimAt: 'farthest'` on `thorn_hail`, same behaviour), `repeat?: { count: number; every: number; rotate: number }` (count telegraphs, the k-th starting k × every s after the first, each rotated by k × rotate rad from the first's direction), and `ramp?: number` (raw added per use while enraged).

| id | name | shape | wind-up s | raw | flags |
|---|---|---|---|---|---|
| `wick_lunge` | Wick Lunge | line 10 × 2.2 toward the target | 1.3 | 28 | knock 10 m/s 0.35 s vy 4; dashes to the line's end; useRange 9 |
| `ember_breath` | Ember Breath | cone 60°, r 9, toward the target | 1.8 | 30 | **interruptible**; useRange 8 |
| `cinder_ring` | Cinder Ring | ring-self, inner 3.5, r 9 | 1.6 | 26 | phase 2 only (stand close) |
| `lamp_sweep` | Lamp Sweep | cone 100°, r 12, toward the target | 1.6 | 28 | useRange 12 |
| `brass_fall` | Brass Fall | circle r 3 on **each** engaged adventurer | 2.0 | 24 | `targets: 'each'`: stacked adventurers take every circle they stand in |
| `keepers_toll` | Keeper's Toll | circle-self r 40 (the whole arena) | 3.0 | 34 | **interruptible**; a Break cancels it too |
| `beacon_lance` | Beacon Lance | line 30 × 3 toward the farthest engaged adventurer | 1.8 | 36 | knock 12 m/s 0.4 s vy 5 (into the fire ring) |
| `turning_light` | Turning Light | line 28 × 3.5 from the Warden | 1.4 each | 30 | `repeat: { count: 8, every: 0.6, rotate: π/4 }` |
| `last_light` | Last Light | circle-self r 40 | 1.0 | 15 | enrage only, every 4 s, `ramp: 5` (15, 20, 25, ...) |
| `focus_beam` | Focus Beam | line 20 × 1.6 toward the farthest engaged adventurer | 1.5 | 18 | **interruptible**; cooldown 7, first at 3 |

**The boss script** (`BossData`, `shared/src/combat/bosses.ts`):
```ts
export interface BossPhase {
  index: number; name: string;
  /** The phase lasts while hp > untilFrac × maxHp (the last phase: 0). */
  untilFrac: number;
  /** Attacks in order, cycling. After a wind-up resolves, the next starts `gap` s later (autos carry on meanwhile). */
  rotation: readonly EnemyAttackId[]; gap: number;
  autoEvery?: number;               // overrides the kind's auto interval in this phase
  anchor?: boolean;                 // walks to its camp spot and stays there (it still turns and autos in reach)
  onEnter?: { fields?: readonly FieldDef[]; clearFields?: boolean; adds?: readonly { kind: EnemyKindId; dx: number; dz: number }[]; wardMult?: number };
}
export interface BossData {
  phases: readonly BossPhase[];
  scale: readonly [number, number, number, number];
  /** Invulnerable and still for this long between phases (telegraphs cancelled; a `phase` fx; a banner on clients). */
  transitionS: number;
  /** Break stun for this boss (else BREAK_STUN_S). */
  breakS?: number;
  enrage?: { s: number; attack: EnemyAttackId; every: number };
  /** Lines the client shows: the phase banners and the victory line. */
  lore: { phases: readonly string[]; victory: string };
}
```
- A rotation entry that cannot start (no target within its useRange, or no line of sight) waits; after 4 s waiting (`ROTATION_SKIP_S = 4`) it is skipped.
- **No phase skipping:** while a phase is not the last, damage cannot take hp below `untilFrac × maxHp`. At that point the transition starts (invulnerable, `act: 'phase'`); the next phase begins after `transitionS`.
- **Ward:** while any add spawned by `onEnter.adds` with a `wardMult` lives, the boss takes × `wardMult` damage (`CombatantView.warded`).
- **Enrage:** `enrage.s` seconds after the boss woke, the rotation is replaced by `enrage.attack` every `enrage.every` s, its raw rising by `ramp` each use. `CombatantView.enrageIn` counts down (null without enrage). A phase transition that comes during the enrage pauses Last Light while it lasts (at most twice, `transitionS` each); a boss arena's enemy leashes to its arena (it goes home only when outside it), and its dashes stop at the arena's edge.
- **Reset:** when the boss goes home (no live target, leash, or a wipe), it resets to phase 1, its adds are despawned (no credit), its fields are removed, the enrage clock stops and its scale returns to base.
- **Wake:** a boss notices adventurers within its `aggro` (in sight), or anyone who damages it (Plan 3 rules).

**The Wickhound** (the Warden's lamp-hound: a brass hound whose wick-mane still burns):

| phase | name | until | rotation | gap s | other |
|---|---|---|---|---|---|
| 1 | Brass Hound | 50% | wick_lunge, ember_breath | 3.5 | — |
| 2 | Wick Unbound | 0 | wick_lunge, cinder_ring, ember_breath | 3.0 | autos every 1.8 s |

`transitionS: 2`, no enrage, `breakS` default (4).

**The Fallen Warden** (the Beacon lighthouse's stone-and-brass keeper, knocked loose when the Beacon rose and fallen into the woods; it still tends a lamp that has nowhere to shine, and tolls for ships that never come. A small "F." maker's mark on its brass collar is Felix's: he built the Beacon's keeper):

| phase | name (banner) | until | rotation | gap s | on enter |
|---|---|---|---|---|---|
| 1 | The Keeper Wakes | 70% | lamp_sweep, brass_fall, lamp_sweep, keepers_toll | 3.0 | — |
| 2 | The Lamp Kindles | 35% | beacon_lance, lamp_sweep, keepers_toll, brass_fall | 2.6 | field `lampfire`: ring inner 15, r 40, raw 8; adds: `lens_shard` at (−10, 0) and (10, 0), `wardMult: 0.4` |
| 3 | The Lens Falls | 0 | turning_light, brass_fall, lamp_sweep, keepers_toll, beacon_lance | 2.4 | `clearFields`; field `lampfire_deep`: ring inner 12, r 40, raw 10; `anchor: true`; autos every 2.4 s |

`transitionS: 4`, `breakS: 5`, `enrage: { s: 330, attack: 'last_light', every: 4 }`. The arena (the Lens Pit) is a flat circle of r 22, so phase 1 has the whole floor, phase 2 shrinks the safe floor to r 15 (and adds the shards inside it), and phase 3 to r 12 with the light turning from the anchored Warden: each phase changes the arena (spec §8). Victory line: "The Warden's lamp steadies, and for a moment its beam points the same way as Ellie's arm."

What each attack asks of the party:

| mechanic | answer from the Plan 3b kit |
|---|---|
| Keeper's Toll (the whole arena, 3.0 s, interruptible) | interrupt it (Sunder, Skullringer, Bright Verdict, Skyfall Arc, Stormcage, a full Charged Shot), or Break the Warden; else heal through it (Soft Rain, Dawn Ward, Bedrock, Aegis) |
| Brass Fall (a circle on each adventurer) | spread out and dodge; stacking doubles it |
| Beacon Lance (knocks into the fire) | dodge sideways; a knocked partner needs heals (the fire ticks) |
| Turning Light (eight lines, in sequence) | move around with the light; dodge charges and Quickstep |
| Lens Shards (×0.4 damage to the Warden while one lives; Focus Beam is interruptible) | switch targets; Lightning on Soaked (conduct) stuns a shard; Fire on Marked (blast) splashes |
| Searing stacks from autos | taunt swaps (Paladin's Taunt, Dark Knight's Dread Howl), Mist Form, Ashcloud, Wellspring's cleanse, or step out of reach |
| Breaks (stagger 300, 5 s at ×1.5) | parries, perfect dodges, interrupts, combos and reactions |
| Deaths (the arena is sealed) | Second Dawn; shields before Toll |
| Enrage at 330 s | damage: Rallying Roar, Weak Point, Crimson Pact, Kindred Spark, Breaks |

**Encounters** (`ENCOUNTERS`, `shared/src/combat/encounters.ts`; the dungeon generator places camps from it, the simulation fights it):

| id | room | room r m | spawns (kind at dx, dz from the room centre) |
|---|---|---|---|
| `root_cellar` | Root Cellar | 11 | thornling (−3, 2), thornling (3, 2), archer (0, 6) |
| `brass_gallery` | Brass Gallery | 13 | mossback (0, 2), thornling (−4, 5), thornling (4, 5) |
| `cog_hall` | Cog Hall | 12 | boar (−3, 1), boar (3, 1), archer (−4, 6), archer (4, 6) |
| `wickhound` | Wick Den | 16 | wickhound (0, 0) |
| `warden` | Lens Pit | 22 | fallen_warden (0, 0) |

The party enters each room from −z of its centre (the generator rotates spawns into the room's own entry direction).

### Why these numbers give the bands

Reference: Plan 3b's careful duos kill a 1275 hp Mossback (def 15, mitigation 0.727) in 28–45 s, about 32 damage a second for two adventurers.

- **The Wickhound** (2600 hp, def 15): two adventurers at about 32 per second, with about 80% uptime (lunges, breath dodges, ring repositioning) → about 100 s. Its Ember Breath rewards interrupts; its ring rewards staying close; its lunge knocks. A careful solo adventurer at about 16 per second needs about 200 s while taking every auto: a long, risky fight, possible for the sturdy jobs.
- **The Fallen Warden** (6000 hp, def 18, mitigation 0.690): a strong duo deals about 30 per second.
  - Phase 1 (1800 hp at 80% uptime): about 74 s.
  - Phase 2: the two shards (840 hp, def 5) take about 22 s; then 2100 hp at 70% uptime: about 99 s.
  - Phase 3 (2100 hp at 65% uptime under the Turning Light): about 106 s.
  - Two transitions (8 s), less about 15 s from three Breaks.
  - About 295 s in all, inside the 330 s enrage: a strong duo has about 35 s of slack, the length of one death that is not revived.
- **Damage taken:** autos (9 raw every 2.8 s, ×0.8, up to ×1.5 with Searing) are about 2.6–3.9 a second on the Warden's target; an uninterrupted Toll is about 27 to each adventurer every rotation (about 20 s). A careful duo heals and shields through that and interrupts most Tolls; a sloppy duo (30% of dodges missed) takes about nine extra 20–30 hp hits each over the fight, which a duo cannot heal through without losing the damage it needs before enrage.
- **Three average** adventurers face ×1.45 hp (8700) with 1.5× the damage of a duo, so about the same length of fight, but with a spare adventurer to revive and to cover a death before enrage: they should usually win.
- **Four** face ×1.9 hp (11400) with 2× the damage: about 10% faster than a duo, with the same mechanics and Brass Fall on four adventurers: not trivial for careless play.
- **Solo** at Plan 3b power faces the full 6000 hp at about 16 per second: about 590 s, far past the 330 s enrage. A solo kill needs Plan 5's top tier ("soloable only in the top tier", spec §9). The G1 band proves the room is there: a top-tier stand-in (power 20, defence 24, max hp 180) makes it possible.

**Tuning rule (Task 5 only):** if a band fails, change only these, each within the range given, and record every change (before → after) in the task report and in Task 11's Outcome:
- the new kinds' `hp` (±30%) and auto `raw` (±30%);
- the new attacks' `raw` (±30%), `gap` values (±30%) and wind-ups (±30%, never below 1.0 s);
- the Warden's `scale[2]` within [1.2, 1.7] and `scale[3]` within [1.5, 2.3]; the Wickhound's within [1.3, 1.8] and [1.6, 2.4];
- `enrage.s` within [300, 420]; `wardMult` within [0.25, 0.6]; field `raw` within [5, 12]; `takenPerStack` within [0.05, 0.15];
- the encounter spawn lists (swap one ordinary kind for another, or add or remove one ordinary enemy per pack).

Never change Plan 3 or Plan 3b numbers, formulas or abilities, `PARTY_MAX`, or any party or instance constant.

## Review Focus

1. **Party abuse.** Each is refused with the right `PartyRefusal`, with no state change: inviting yourself; inviting by an id in another room or an enemy id; inviting a name that is offline or does not exist; a fifth member; accepting an expired invite or one from a party that has since filled; a non-leader kicking or inviting; kicking someone not in the party; 30 invites a second (`'rate'` after 10 a minute); a party message with junk fields, NaN, huge strings or markup in names (shown as plain text). → Tasks 1, 6.
2. **The ally rule.** An automatic heal, shield, buff, rain, revive or reaction never lands on a stranger; an explicit tap does. In a party, area buffs reach party members only. Without a party, Field Dressing on nobody heals self. → Tasks 3, 6.
3. **Instance exploits.** Each fails safe: joining another party's instance by room id (onAuth refuses); staying in after leaving or being kicked from the party (sent to the mouth after `INSTANCE_EVICT_S`); two parties racing for the 12th instance (exactly one opens); walking or dodging into a sealed gate; releasing during a boss fight to dodge the seal; signing out inside (saved at the mouth, never in `lampfall`); a server restart (everyone at the mouth); reconnecting after the 120 s hold (the mouth). → Task 7.
4. **Phases and rewards.** A burst that would cross two thresholds stops at the first; damage during a transition does nothing; a wipe resets the boss completely (phase 1, adds gone, fields gone, enrage clock stopped); a second Warden kill on the same UTC day gives no second Seal; a party member outside the instance gets no credit; adds give 0 xp. → Tasks 4, 7.
5. **Determinism.** Two engines with the same seed, intents and parties give identical TickOut streams through a whole Warden fight (phases, adds, fields, enrage). → Task 4.
6. **Load.** 12 open instances with 36 bots inside and 64 fighting in the Greenway: every zone room's step p95 ≤ 15 ms, each instance's ≤ 3 ms, peak RSS ≤ 400 MB, 0 corrections; a 13th party gets the full notice. → Task 10.

---

### Task 1: Shared data: boss and add kinds, attacks, the ring shape, afflictions, party and instance constants and messages

**Files:**
- Create:
  - `shared/src/combat/bosses.ts` (`BossData`, `BossPhase`, `FieldDef`, `FieldId`, `BOSSES` (data only, attached to the kinds), `scaleFactor`, `ROTATION_SKIP_S`);
  - `shared/src/combat/afflictions.ts` (`AfflictionId`, `AFFLICTIONS`, `afflictionBits`);
  - `shared/src/combat/encounters.ts` (`EncounterId`, `ENCOUNTERS`, `ENCOUNTER_IDS`);
  - `shared/src/party.ts`;
  - `shared/src/instance.ts`;
  - `shared/src/combat/bosses.test.ts`, `shared/src/party.test.ts`.
- Modify:
  - `shared/src/combat/enemies.ts` (new kinds, attacks, `tier`, `boss`, the new attack fields; `thorn_hail` gets `aimAt: 'farthest'`);
  - `shared/src/combat/shapes.ts` (`ring`; `inShape`, `escapeDir`);
  - `shared/src/combat/jobXp.ts` (`KILL_XP` for the three new kinds);
  - `shared/src/combat/constants.ts` (the `// ───────── parties and bosses ─────────` section);
  - `shared/src/combat/fx.ts` (new events);
  - `shared/src/combat/index.ts`, `shared/src/index.ts` (exports);
  - `shared/src/messages.ts` (party, instance and chat-channel shapes);
  - `shared/src/combat/data.test.ts` (the new kinds keep its rules).

**Interfaces:**
- Produces, exactly as under Numbers:
```ts
// enemies.ts
export type EnemyKindId = 'thornling' | 'boar' | 'archer' | 'mossback' | 'dummy' | 'wickhound' | 'fallen_warden' | 'lens_shard';
export type EnemyAttackId = /* Plan 3's five */ | 'wick_lunge' | 'ember_breath' | 'cinder_ring' | 'lamp_sweep' | 'brass_fall'
  | 'keepers_toll' | 'beacon_lance' | 'turning_light' | 'last_light' | 'focus_beam';
export type EnemyTier = 'ordinary' | 'elite' | 'boss' | 'mega';
// EnemyAttackData: shape adds 'ring-self'; adds inner?, targets?: 'each', aimAt?: 'target' | 'farthest',
//   repeat?: { count: number; every: number; rotate: number }, ramp?: number
// EnemyKindData: adds tier: EnemyTier; boss?: BossData; auto gains afflict?: AfflictionId
// bosses.ts
export type FieldId = 'lampfire' | 'lampfire_deep';
export interface FieldDef { id: FieldId; shape: Shape; raw: number }     // shape relative to the boss's camp (x, z = offsets)
export interface BossPhase { /* as under Numbers */ }
export interface BossData { /* as under Numbers */ }
export const ROTATION_SKIP_S = 4;
export function scaleFactor(kind: EnemyKindData, n: number): number;  // boss: scale[min(4, max(1, n)) − 1]; elite: Plan 3's rule; else 1
// afflictions.ts
export type AfflictionId = 'searing';
export interface AfflictionData { id: AfflictionId; name: string; maxStacks: number; s: number; takenPerStack: number; bit: number }
export const AFFLICTIONS: Record<AfflictionId, AfflictionData>;
// encounters.ts
export type EncounterId = 'root_cellar' | 'brass_gallery' | 'cog_hall' | 'wickhound' | 'warden';
export interface EncounterData { id: EncounterId; room: string; roomR: number; spawns: readonly { kind: EnemyKindId; dx: number; dz: number }[]; boss?: EnemyKindId }
export const ENCOUNTERS: Record<EncounterId, EncounterData>; export const ENCOUNTER_IDS: readonly EncounterId[];
// shapes.ts
export type Shape = /* Plan 3 */ | { kind: 'ring'; x: number; z: number; inner: number; r: number };
// party.ts
export const PARTY_MAX = 4; /* and the other constants under Numbers */
export type PartyRefusal = 'self' | 'unknown' | 'in-party' | 'full' | 'not-leader' | 'expired' | 'rate' | 'not-member' | 'in-instance';
export const PARTY_TEXT: Record<PartyRefusal, string>;
export type PartyOp =
  | { op: 'invite'; eid: number } | { op: 'invite'; name: string }
  | { op: 'accept'; partyId: string } | { op: 'decline'; partyId: string }
  | { op: 'leave' } | { op: 'kick'; name: string } | { op: 'lead'; name: string };
export function parsePartyOp(v: unknown): PartyOp | null;    // strict: known op, right field types, names 1–16 chars, ids ≤ 32 chars, integer eids
export interface PartyMemberView {
  name: string; leader: boolean; online: boolean;
  zone: ZoneId | null;                // null while offline
  eid: number;                        // -1 unless in the receiver's room
  job: JobId; level: number; hp: number; maxHp: number; dead: boolean; searing: number;
}
export interface PartyView { id: string; members: PartyMemberView[] }   // join order
// instance.ts
export const MAX_INSTANCES = 12; /* and the other constants under Numbers */
export const REASON_INSTANCES_FULL = 'The Lampfall is crowded right now, try again in a minute';
export const REASON_ARENA_SEALED = 'The lamp-gate is shut until the fight ends';
export const REASON_INSTANCE_CLOSED = 'The Lampfall has gone quiet; you climb back out';
export const REASON_LEFT_PARTY = 'You left the party, so you climb back out of the Lampfall';
export type CheckpointId = 'rim' | 'landing';
export interface InstanceView {
  checkpoint: CheckpointId; cleared: EncounterId[];
  sealed: EncounterId | null;          // the boss room whose gate is shut
  wipeIn: number | null;               // seconds until everyone gets up, during a wipe
  releaseIn: number | null;            // seconds until this adventurer may release (dead only)
  partySize: number; startedAt: number; // wall ms
}
export interface VictoryView {
  boss: 'wickhound' | 'fallen_warden'; seconds: number; partySize: number;
  xp: number; seal: boolean; seals: number; title: string | null; rank: number | null; lore: string;
}
// messages.ts additions
C2S: party: PartyOp; chat: { text: string; channel?: 'zone' | 'party' }; release: Record<string, never>; leaveInstance: Record<string, never>;
S2C: chat: { from: string; text: string; channel: 'zone' | 'party' };
     party: { party: PartyView | null };       // after any change, and at most PARTY_STATUS_HZ for status
     partyInvite: { partyId: string; from: string; size: number };
     partyRefused: { reason: PartyRefusal; text: string };
     travel: { zone: ZoneId; instance?: string };   // instance: the room id to join by id
     instance: InstanceView;                    // on join and when it changes
     victory: VictoryView;
// fx.ts additions
  | { t: 'afflict'; src: number; dst: number; id: AfflictionId; stacks: number }   // stacks 0: gone
  | { t: 'phase'; src: number; phase: number }                                    // a transition begins (phase = the next index)
  | { t: 'enrage'; src: number }
  | { t: 'spawn'; src: number; dst: number }                                       // a boss spawned add dst
// 'hit' gains by: … | 'field'
```
- `ZoneId` is not changed in this task (Task 2 adds `'lampfall'`); `PartyMemberView.zone` is typed `ZoneId | null`.

- [ ] **Step 1: Write the failing tests.**
  - `bosses.test.ts`:
    - `it('the three new kinds have the Numbers table values')`;
    - `it('every wind-up is at least 1.0 s')` (all attacks, Plan 3's included);
    - `it('every boss phase rotation names only its own kind's attacks, and untilFrac falls to 0')`;
    - `it('scaleFactor: Plan 3 elites unchanged; the Warden 1, 1, 1.45, 1.9; never below 1; n above 4 counts as 4')`;
    - `it('turning_light covers a full turn (count × rotate = 2π) and last_light ramps')`;
    - `it('encounter spawns sit inside their room with the kind's radius + 1 m to spare, at least 3 m apart')`;
    - `it('KILL_XP has the new kinds; lens_shard gives 0')`;
    - `it('ring: inShape at inner, r and between; escapeDir points to the nearer edge')`.
  - `party.test.ts`:
    - `it('parsePartyOp accepts each op and refuses junk, NaN eids, long names, unknown ops, extra-long ids')`;
    - `it('PARTY_TEXT has a line for every refusal')`;
    - `it('REASON_* lines are distinct from every existing REASON_* line')`.
  - `data.test.ts`: the new kinds keep Plan 3's data rules (radius > 0, leash ≥ aggro for movers, every attack id exists).
- [ ] **Step 2: Run `npx vitest run shared/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Data only: no engine behaviour changes. `thorn_hail` gets `aimAt: 'farthest'` and the AI's `AIM_FARTHEST` set keeps working until Task 4 reads the field.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** A server or client `switch` on `EnemyKindId` or `Shape['kind']` that no longer compiles gets a minimal case (a ring decal may draw as its outer circle until Task 9; an unknown enemy kind may draw as a Mossback until Task 9). Touch only the lines that need it.
- [ ] **Step 5: Commit**: `feat: boss, add and encounter data, the ring shape, afflictions, party and instance shapes`.

### Task 2: The Lampfall generator, the `lampfall` zone and the crater mouth

**Files:**
- Create: `shared/src/world/dungeon.ts`, `shared/src/world/dungeon.test.ts`.
- Modify:
  - `shared/src/world/zones.ts` (`'lampfall'`, `SAVE_ZONE_IDS`, `isSaveZoneId`, `LAMPFALL_MOUTH`, the lampfall def, the Greenway's mouth exit);
  - `shared/src/world/recipe.ts` (the mouth landmark: step 8, and the clearing around it);
  - `shared/src/world/recipe.test.ts` (its generator scan also reads `dungeon.ts`), `shared/src/world/zones.test.ts`, `shared/src/world/__snapshots__/*` (the Greenway snapshot changes deliberately: say so in the commit body);
  - `server/src/store/types.ts` (`checkedSave` uses `isSaveZoneId`; one line), `server/src/app.ts` and `server/src/index.ts` (iterate and accept `SAVE_ZONE_IDS`; a few lines).

**Interfaces:**
- Consumes: Task 1 (`ENCOUNTERS`, kinds).
- Produces:
```ts
// dungeon.ts
export type RoomId = 'rim' | 'root_cellar' | 'brass_gallery' | 'cog_hall' | 'wick_den' | 'landing' | 'lens_pit';
export interface RoomSpec { id: RoomId; name: string; r: number; floorY: number; encounter?: EncounterId;
  pillars: number; platforms: number; sanctuary?: boolean; checkpoint?: CheckpointId; sealed?: boolean }
export interface DungeonRecipe { id: 'lampfall'; seed: number; rooms: readonly RoomSpec[]; corridor: { width: number; minLen: number; maxLen: number };
  stair: { between: [RoomId, RoomId]; stepRise: number; stepLen: number } }
export const LAMPFALL_RECIPE: DungeonRecipe;
export interface DungeonRoom { id: RoomId; name: string; x: number; z: number; r: number; floorY: number;
  entryDir: number;                       // yaw from the room centre toward the corridor it is entered by (as Pose.facing)
  gate: { x: number; z: number; r: number } | null;   // sealed rooms: the gate circle on their entry corridor
  spawns: CampSpawn[]; checkpoint?: CheckpointId; sanctuary?: Sanctuary }
export interface DungeonLayout {
  recipe: DungeonRecipe; rooms: DungeonRoom[];
  corridors: { from: RoomId; to: RoomId; ax: number; az: number; bx: number; bz: number; w: number; ay: number; by: number; steps: number }[];
  pillars: { x: number; z: number; r: number; h: number }[];              // walls (no top)
  rubble: { x: number; z: number; r: number; top: number }[];             // platforms
  exitStair: { x: number; z: number; r: number };                         // in the rim: back to the Greenway
  lampLift: { x: number; z: number; r: number };                          // the Lens Pit's centre (opens after the Warden)
  walk: DungeonWalk;
}
export class DungeonWalk { groundAt(x: number, z: number): number | null; surfaceAt(x: number, z: number): number | null }
export function generateDungeon(r: DungeonRecipe): DungeonLayout;
export function lampfallLayout(): DungeonLayout;   // cached generateDungeon(LAMPFALL_RECIPE)
// zones.ts
export type ZoneId = 'grove' | 'greenway' | 'lampfall'; export const ZONE_IDS: readonly ZoneId[];   // all three
export const SAVE_ZONE_IDS: readonly ('grove' | 'greenway')[]; export function isSaveZoneId(v: unknown): v is 'grove' | 'greenway';
export const LAMPFALL_MOUTH: { readonly x: number; readonly z: number; readonly r: number; readonly arrive: { x: number; z: number; facing: number } };
// ZoneDef gains: instanced: boolean (true only for lampfall); ZoneExit gains instance?: true (the Greenway's mouth exit)
```
- **The recipe** (`LAMPFALL_RECIPE`, seed 4404):

| order | id | name | r | floorY | encounter | pillars | platforms | other |
|---|---|---|---|---|---|---|---|---|
| 1 | `rim` | Crater Rim | 9 | 0 | — | 0 | 2 | checkpoint `rim`; sanctuary r 6; the exit stair |
| 2 | `root_cellar` | Root Cellar | 11 | −3 | root_cellar | 2 | 1 | — |
| 3 | `brass_gallery` | Brass Gallery | 13 | −6 | brass_gallery | 6 | 3 | — |
| 4 | `cog_hall` | Cog Hall | 12 | −9 | cog_hall | 4 | 2 | — |
| 5 | `wick_den` | Wick Den | 16 | −12 | wickhound | 0 | 0 | sealed |
| 6 | `landing` | Keeper's Landing | 8 | −15 | — | 0 | 1 | checkpoint `landing`; sanctuary r 6 |
| 7 | `lens_pit` | Lens Pit | 22 | −18 | warden | 0 | 0 | sealed; the lamp-lift |

  Corridors: width 5, length 12–18. The Wick Den → Keeper's Landing corridor is the **Wick Stair**: terraces with `stepRise 1.0` m every `stepLen 4` m.
- **Generation rules:**
  - rooms are placed in order, each at corridor length + both radii from the previous one, in a seeded direction within ±60° of +x, re-rolled (at most 20 times, then a deterministic throw) until every room is at least 6 m clear of every other room and corridor;
  - floors: a room's floor is flat at `floorY` (boss rooms and the arena must be flat); a corridor's floor runs linearly from one room's floor to the next (slope ≤ 0.25), except the Wick Stair, whose floor drops in flat terraces;
  - pillars (walls, r 0.8–1.4) and rubble (platforms, r 1–1.8, top = floor + 0.45..1.05) are rejection-sampled inside pack rooms only, at least 2.5 m from every spawn, the room's entry point and each other;
  - the floor mask is the union of room circles and corridor capsules; `DungeonWalk` returns null outside it, null on pillars, and platform tops for `surfaceAt` on rubble, the same meanings as `ZoneWalk`;
  - spawns are `ENCOUNTERS[id].spawns`, rotated so that the encounter's −z faces the room's entry direction (rotation by the entry's unit vector, sqrt only), each facing the entry;
  - the whole layout is shifted so that the rim's centre is at (20, 0), and must fit inside the zone limits (asserted).
- **Movement guarantees** (tested): every room centre is reachable from the rim's centre by `findPath` over `surfaceAt` with the adventurer's clearance; every height change along any corridor between two samples 0.4 m apart is ≤ `STEP_UP` (ramps) or, on the Wick Stair, a drop of ≤ 1.0 m (climbable back with a jump: the jump reaches 1.45 m) and never more than `SAFE_FALL`; every platform top is ≤ 1.1 m above the floor around it; no gap in the floor narrower than 0.8 m.
- **The lampfall zone def:** `id 'lampfall'`, name `'The Lampfall'`, banner `['The Lampfall', 'Where the Warden fell']`, surface `surfaceAt`, ground `groundAt`, sight = surface not null, camps = every room's spawns, spawn = the rim's centre facing into the dungeon, exits = `[{ to: 'greenway', x, z, r: exitStair.r, arrive: LAMPFALL_MOUTH.arrive, open: true }]` (the lamp-lift is a second exit, `open: false`: the server opens it per instance), `town: false`, `sanctuaries` = the rim's and the landing's, `instanced: true`. It passes `checkZoneLimits`.
- **The crater mouth in the Greenway** (recipe step 8, after trees):
  - its spot is x = width − 24 (236), z = roadZ(236); if any camp is within 30 m, it steps west along the road 4 m at a time until clear (deterministic);
  - rocks and trees within 10 m of it are not placed (checked in steps 4 and 5; this changes the Greenway's later rocks and trees but not its camps: the snapshot update is deliberate);
  - `ZoneLayout` gains `mouth: { x, z }`; the Greenway def gains the exit `{ to: 'lampfall', x, z, r: 2.5, arrive: lampfall spawn, open: true, instance: true }`;
  - `LAMPFALL_MOUTH = { x, z, r: 2.5, arrive: { x: mouth x − 5, z: roadZ(that x), facing: π/2 } }` (standing on the road just west of the mouth).

- [ ] **Step 1: Write the failing tests** in `dungeon.test.ts`:
  - `it('generates the same layout twice, and a snapshot of rooms, corridors and spawns')`;
  - `it('fits the zone limits, x and z and heights')`;
  - `it('every room is reachable from the rim')`;
  - `it('corridors climb by at most STEP_UP between samples; the Wick Stair drops 1.0 m steps; nothing drops more than SAFE_FALL')`;
  - `it('every platform is jumpable; boss rooms are flat and clear of pillars and rubble')`;
  - `it('spawns are the encounter table rotated to the room's entry, inside the floor, on ground')`;
  - `it('the sealed rooms have a gate circle on their entry corridor, outside the room')`;
  - `it('the generator scan forbids trig, pow, random and double stars in dungeon.ts')`.
  - `zones.test.ts`:
    - `it('lampfall is instanced, not a town, with sanctuaries at the rim and the landing only')`;
    - `it('SAVE_ZONE_IDS excludes lampfall; checkedSave refuses it')`;
    - `it('the Greenway has the mouth exit, clear of trees and rocks within 10 m and of camps within 30 m')`;
    - `it('LAMPFALL_MOUTH.arrive stands on the Greenway surface')`.
  - `recipe.test.ts`: the Greenway's camps are unchanged by the mouth step (compare positions with the old snapshot's camps).
- [ ] **Step 2: Run `npx vitest run shared/src/world`. Expected: FAIL.**
- [ ] **Step 3: Implement.** `ZONE_IDS` now holds all three zones, so the server must not open a normal room for `lampfall`: in `server/src/app.ts`, the zone map, the stats and the up-front room creation iterate `SAVE_ZONE_IDS` instead (those lines only; Task 7 adds instances). `SG2_START_ZONE` accepts only a saved zone.
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.** Then the plain Greenway bot run on port 2571 (`SG2_START_ZONE=greenway`; `npm run bots -w server -- --url http://localhost:2571 --count 100 --seconds 30 --zone greenway`): exit 0, mean ≥ 14 Hz, 0 corrections. Stop the server by PID.
- [ ] **Step 5: Commit**: `feat: the Lampfall generator, the lampfall zone and the crater mouth in the Greenway`.

### Task 3: Engine I: party allies, afflictions, fields, spawning and despawning

**Files:**
- Create: `shared/src/combat/fields.ts`, `shared/src/combat/party.test.ts`, `shared/src/combat/fields.test.ts`.
- Modify:
  - `shared/src/combat/engine.ts` (`setParty`, `fields()`, `stats` on `addAdventurer`, `TickOut.despawned`, views);
  - `shared/src/combat/adventurer.ts` (the `party` field, afflictions as a Map, `spawnEnemy`, `despawnEnemy`);
  - `shared/src/combat/effects.ts` (`allied`, `pickAlly`, `pickDead`, `adventurersNear`, `takenMult` with Searing, cleanse);
  - `shared/src/combat/enemyAi.ts` (autos with `afflict`; telegraph `ring-self` shape);
  - `shared/src/combat/elements.ts` (steam and bedrock reach allied adventurers only);
  - `shared/src/combat/index.ts`;
  - existing tests that read `afflictions` as a Set, or rely on strangers being allies: update to put the adventurers in one party (`setParty`), keeping each test's intent.

**Interfaces:**
- Consumes: Task 1.
- Produces:
```ts
// engine.ts
export interface Combat { /* Plan 3b, plus: */
  setParty(id: number, party: string | null): void;          // live buffs (Shelter included) stay as they are; only later picks change
  fields(): Iterable<FieldView>;
  addAdventurer(a: { /* Plan 3b */; stats?: Stats }, nowS: number): number;   // stats: simulation and tests only (the server never passes it)
}
export interface FieldView { id: number; owner: number; field: FieldId; shape: Shape; raw: number; startedAt: number }
export interface TickOut { /* Plan 3b */; despawned: number[] }
// CombatantView (adventurers): searing: number (stacks, 0 when none)
// AdventurerState: party: string | null; afflictions: Map<AfflictionId, { stacks: number; until: number; src: number }>
// CombatWorld: fields: Map<number, FieldState>; nextFieldId: number
// adventurer.ts
export function spawnEnemy(w: CombatWorld, c: CampSpawn, opts: { engageWith: readonly number[]; scale: number; nowS: number }): EnemyState;  // respawn Infinity; threat AGGRO_THREAT on each engageWith
export function despawnEnemy(w: CombatWorld, e: EnemyState): void;   // its telegraphs and fields go; no death fx, no credit; id pushed to out.despawned
// effects.ts
export function allied(a: AdventurerState, b: AdventurerState): boolean;
export function applyAffliction(w: CombatWorld, a: AdventurerState, id: AfflictionId, src: number, nowS: number): void; // +1 stack (capped), refresh, `afflict` fx
// fields.ts
export function addField(w: CombatWorld, owner: EnemyState, def: FieldDef, nowS: number): number;   // the def's shape moved to the owner's camp
export function removeFieldsOf(w: CombatWorld, owner: number): void;
export function tickFields(w: CombatWorld, nowS: number): void;    // engine.tick, after enemy status
```
- **Rules**, exactly as under Numbers → The ally rule, Shapes and afflictions:
  - `pickAlly(…, wanted, …)`: an explicit `wanted` qualifies whether allied or not; the automatic choice considers allied adventurers only;
  - `pickDead`: likewise;
  - every area effect on adventurers, `heal … on: 'lowest'`, Bloodbond's copy, steam and bedrock: allied only;
  - affliction expiry is checked each tick (`afflict … stacks: 0` fx);
  - Searing multiplies `takenMult`, so it raises both enemy hits and field ticks (fields never add stacks themselves);
  - a dead adventurer loses its afflictions; a revive starts with none; `carryOf` never carries afflictions;
  - `ring-self` telegraphs build a `ring` shape at the enemy.

- [ ] **Step 1: Write the failing tests.**
  - `party.test.ts`:
    - `it('Field Dressing with no party heals self, never a hurt stranger 5 m away')`;
    - `it('Field Dressing with an explicit stranger id heals the stranger')`;
    - `it('in a party, Field Dressing auto-picks the lowest party member, not a lower stranger')`;
    - `it('Rallying Roar, Dawn Ward, Soft Rain and Aegis reach party members within range, never strangers')`;
    - `it('Second Dawn auto-picks the nearest dead party member; an explicit dead stranger is revived')`;
    - `it('Shelter and Kindred Spark refuse no-ally with only strangers near, accept an explicit stranger')`;
    - `it('Bloodbond and Lantern Flare's heal skip strangers')`;
    - `it('steam and bedrock reach party members only')`;
    - `it('setParty(null) makes a member a stranger at once')`.
  - `fields.test.ts`:
    - `it('a ring field hits at each whole second inside it, by ground x/z, through shields, ignoring i-frames')`;
    - `it('a field never breaks a cast, never knocks, never adds Searing')`;
    - `it('removeFieldsOf removes only that owner's fields')`;
    - `it('Searing: +1 stack per landed auto up to 5, ×(1 + 0.1 × stacks) taken, expires 8 s after the last, gone on death')`;
    - `it('Wellspring cleanses Searing')`;
    - `it('spawnEnemy: an add engaged with the given adventurers, never respawning; despawnEnemy drops it, its telegraphs and fields, with no credit, listed in despawned')`;
    - `it('stats on addAdventurer set power, defence and maxHp')`;
    - `it('determinism with parties, fields and adds: identical TickOut streams over 60 s')`.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Plan 3b's duo bands (`sim.jobs.duo.test.ts`, `sim.jobs.synergy.test.ts`) must keep passing: `simulateParty` puts every member in one party (`setParty(id, 'sim')`). Task 5 rewrites the simulation; here make only that one change.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** The server still compiles: until Task 6 it calls nothing new, so on the server every adventurer is a stranger to every other. That changes live behaviour (ally effects need a tap) only between this task and Task 6; note it in the report.
- [ ] **Step 5: Commit**: `feat: party allies, afflictions, ground fields and enemy spawning in the combat engine`.

### Task 4: Engine II: the boss script

**Files:**
- Create: `shared/src/combat/bossAi.ts`, `shared/src/combat/bossAi.test.ts`.
- Modify:
  - `shared/src/combat/enemyAi.ts` (bosses step through `stepBoss`; `aimAt` replaces `AIM_FARTHEST`; `targets: 'each'`; `repeat`; scaling through `scaleFactor`);
  - `shared/src/combat/adventurer.ts` (the phase floor and transition invulnerability in `damageEnemy` and `enemyInvulnerable`; the ward multiplier; per-boss `breakS`);
  - `shared/src/combat/engine.ts` (views: `phase`, `warded`, `enrageIn`, `tier`; `Act` gains `'phase'`; `TickOut.boss`);
  - `shared/src/combat/bosses.ts` (behaviour helpers only if needed);
  - `shared/src/combat/index.ts`.

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
```ts
// engine.ts
export type Act = /* Plan 3b */ | 'phase';
// CombatantView (enemies): tier: EnemyTier; phase: number (0-based; 0 for non-bosses); warded: boolean; enrageIn: number | null
export interface BossEvent { enemy: number; kind: EnemyKindId; event: 'wake' | 'phase' | 'enrage' | 'reset'; phase?: number; atS: number }
export interface TickOut { /* … */; boss: BossEvent[] }
// bossAi.ts
export interface BossAi { phase: number; transitionUntil: number; wokeAt: number | null; next: number; nextAt: number;
  waitSince: number | null; adds: number[]; wardMult: number | null; enraged: boolean; enrageUses: number; anchored: boolean }
export function bossAiStateOf(e: EnemyState): BossAi | undefined;      // tests
export function stepBoss(w: CombatWorld, e: EnemyState, nowS: number, dt: number): 'handled' | 'chase';  // 'chase': run Plan 3's chase and auto for this tick
export function resetBoss(w: CombatWorld, e: EnemyState): void;       // from startReturn
```
- **Rules**, exactly as under Numbers → The boss script:
  - wake: on first engagement, `wokeAt = now`, `boss` event `'wake'`; attacks start after the first rotation's `gap`;
  - rotation: after a wind-up resolves (or a repeat sequence's last telegraph resolves), the next entry starts `gap` s later when it can (target in useRange and sight); an entry that cannot start for `ROTATION_SKIP_S` is skipped; autos run between wind-ups on the phase's `autoEvery`;
  - `targets: 'each'`: one telegraph per live adventurer on the threat table, all with the same wind-up, owned by the boss;
  - `repeat`: the k-th telegraph is placed k × `every` s after the first, rotated k × `rotate` from the first's direction; the boss stays rooted until the last resolves;
  - phases: the floor rule (hp never below `untilFrac × maxHp` before the next phase), then the transition: windups and the boss's telegraphs cancelled, `act 'phase'`, invulnerable (`targetFor` refuses `'no-target'`, damage over time does nothing), `phase` fx and event; after `transitionS`, `onEnter` applies (fields with `addField`, adds with `spawnEnemy` at the boss's camp + (dx, dz) with the boss's current scale, the ward), and the new rotation starts;
  - ward: while any add in `ai.adds` lives, the boss's incoming damage is × `wardMult` (applied in `damageEnemy`, after `outgoingMult`, once);
  - anchor: the boss walks to its camp spot (the arena centre), then stands; it turns to its target and autos whoever is in reach;
  - Break: `breakS` replaces `BREAK_STUN_S` for this boss; a Break cancels the current wind-up (Plan 3) and a repeat sequence's remaining telegraphs;
  - enrage: at `wokeAt + enrage.s`, `enrage` fx and event; the rotation is replaced by `enrage.attack` every `enrage.every` s, raw + `ramp` × uses;
  - scaling: `scaleFactor` with n as Plan 3 counts it, never down until a reset;
  - reset (`startReturn` on a boss): `resetBoss` despawns its adds, removes its fields, sets phase 0, clears enrage, `boss` event `'reset'`; walking home heals it (Plan 3);
  - a boss's death despawns its live adds (no credit) and removes its fields.

- [ ] **Step 1: Write the failing tests** in `bossAi.test.ts` (flat zones with a dummy-free camp of the boss; scripted adventurers placed by `setPose`):
  - `it('the Wickhound wakes within 10 m, runs its rotation with 3.5 s gaps, and switches at 50% to phase 2 with Cinder Ring and 1.8 s autos')`;
  - `it('a burst past 70% and 35% at once stops at 70%; damage during the transition does nothing; phase 2 starts after 4 s')`;
  - `it('phase 2 spawns two Lens Shards at ±10 m engaged with everyone; the Warden takes ×0.4 while one lives, ×1 after both die')`;
  - `it('the lampfire ring burns outside 15 m from phase 2, and outside 12 m in phase 3 only')`;
  - `it('Brass Fall puts one circle on each engaged adventurer; two stacked adventurers take two hits each')`;
  - `it('Keeper's Toll is interrupted by Sunder; a Break cancels it; otherwise it hits everyone in the arena')`;
  - `it('Turning Light places eight lines 0.6 s apart, 45° apart; a Break cancels the rest')`;
  - `it('phase 3 anchors the Warden at its camp spot')`;
  - `it('enrage at 330 s: Last Light every 4 s, 15 then 20 then 25')`;
  - `it('Searing from Warden autos only')`;
  - `it('scaling: a third adventurer joining raises max hp ×1.45 keeping the fraction; never down when one dies')`;
  - `it('a wipe resets: phase 0, adds gone (despawned, no credit), fields gone, enrage clock cleared, full hp at home')`;
  - `it('the Warden's death despawns live shards with no credit and removes fields')`;
  - `it('thorn_hail still aims at the farthest engaged adventurer (aimAt)')`;
  - `it('determinism: two engines, same seed and intents, identical TickOut streams over a 400 s Warden fight')`;
  - `it('budget: one tick of a Warden fight with 4 adventurers, 2 shards and 8 telegraphs averages under 0.3 ms')`.
  - Plan 3 and 3b tests stay green.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** A server `switch` on `Act` gets the `'phase'` case (enemy mode `'phase'`) only if the compiler needs it.
- [ ] **Step 5: Commit**: `feat: the boss script: phases, rotations, adds and wards, fields, enrage and party-size scaling`.

### Task 5: Party simulation, the dungeon brain and the difficulty bands

**Files:**
- Modify:
  - `shared/src/combat/sim.ts` (`simulateEncounter`, party in one party, `stats`, results);
  - `shared/src/combat/brain.ts` (fields, rings, spreading, add priority, Toll interrupts);
  - `shared/src/combat/brain.test.ts`.
- Create:
  - `shared/src/combat/sim.dungeon.test.ts` (packs and the Wickhound);
  - `shared/src/combat/sim.warden.duo.test.ts` (W1, W3);
  - `shared/src/combat/sim.warden.party.test.ts` (W2, W5, W6);
  - `shared/src/combat/sim.warden.solo.test.ts` (W4, G1).
- Modify, only under the Tuning rule: `shared/src/combat/enemies.ts`, `shared/src/combat/bosses.ts`, `shared/src/combat/afflictions.ts`, `shared/src/combat/encounters.ts`.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:
```ts
// sim.ts
export type Skill = 'careful' | 'sloppy' | 'careless';   // careful; careful with SLOPPY_MISS; careless (never dodges): Plan 3b's three levels
export interface EncounterMember { job: JobId; skill: Skill; picks?: [AbilityId, AbilityId]; stats?: Stats }
export interface EncounterResult {
  won: boolean; killedAt: number | null; firstHitAt: number | null; ttk: number | null;
  members: MemberResult[];           // Plan 3b's, per member
  bossHpFrac: number;                // the boss's (or the pack's total) hp fraction left at the end (0 on a win)
  phaseReached: number; enraged: boolean;
  interrupts: number;                // boss or add wind-ups interrupted by the party
  breaks: number; reactions: Record<ReactionId, number>; crossCombos: number;
}
export function simulateEncounter(o: { seed: number; party: EncounterMember[]; encounter: EncounterId; maxS?: number }): EncounterResult;
export const SIM_WARDEN_MAX_S = 480;
// brain.ts: BrainInput gains fields: FieldView[]; arena: { x: number; z: number; r: number } | null
```
- **The simulation:**
  - the field is the encounter's room: a flat disc of `roomR` (null outside) with the room's entry corridor stub (5 m wide, 12 m long) on −z where the party starts;
  - enemies at `ENCOUNTERS[id].spawns`; members start in the corridor stub, 3 m apart, and walk in;
  - all members are in one party; Plan 3b's alternating action order;
  - packs: every enemy must die; a boss encounter is won when the boss dies (adds despawn with it);
  - dead members stay dead unless revived (arenas are sealed; packs: no release in the sim);
  - it ends on a win, when every member is dead, or at `maxS` (default 240; `SIM_WARDEN_MAX_S` for the Warden);
  - the result fields above, counted from fx and `TickOut.boss`.
- **Brain additions** (careful only unless stated; Plan 3b's order otherwise kept):
  - **fields:** never move into a field; a member standing in one moves out of it (to the nearest safe point toward the arena centre) before anything else but dodging;
  - **rings:** `escapeDir` (Task 1) now handles rings, so dodging out of a Cinder Ring moves inward;
  - **spread:** while any `targets: 'each'` telegraph is live (or a boss in a phase that uses Brass Fall is winding up), keep at least 4 m from the nearest ally when moving;
  - **adds first:** when the boss is `warded`, target the nearest live add instead (ranged jobs) or the add nearest the boss (melee);
  - **interrupts:** the `interrupt` ai hint and Plan 3's interrupting-finisher hold also fire for an add's interruptible wind-up (Focus Beam) and for Keeper's Toll;
  - sloppy brains miss their seeded share as in Plan 3b; careless brains never dodge and stand in fields.
- **Bands** (rates over the seeds given; print nothing on success; `STRONG_PAIRS` = `[paladin, black_mage]`, `[warrior, white_mage]`, `[dark_knight, ranger]`, `[ninja, white_mage]`, `[paladin, ninja]`, `[black_mage, ranger]`; `TRIOS` = `[paladin, white_mage, black_mage]`, `[warrior, ranger, white_mage]`, `[dark_knight, ninja, black_mage]`; `QUADS` = `[paladin, white_mage, black_mage, ninja]`, `[warrior, dark_knight, ranger, white_mage]`; duo picks for parties, solo picks alone):
  - `sim.dungeon.test.ts`:
    - **E1** `it.each(STRONG_PAIRS)('%s + %s, careful, clear every pack')`: seeds 1–10 per pack; every run won; at most 2 deaths over the pair's 30 pack runs;
    - **E2** `it.each(STRONG_PAIRS)('%s + %s, careful, beat the Wickhound')`: seeds 1–10; at least 8 of 10 wins; mean TTK of wins in [70, 140] s;
    - **E3** `it('sloppy duos beat the Wickhound at least half the time')`: the six pairs × seeds 1–10, at least 30 of 60 wins;
    - **E4** `it('careless duos mostly lose to the Wickhound')`: the six pairs × seeds 1–10, at most 24 of 60 wins;
    - **E5** `it('the Wickhound is duo content: careful solo wins at most half')`: the seven jobs × seeds 1–2, at most 7 of 14 wins; and `it('careful solo clears the Root Cellar at least half the time')`: seven jobs × seeds 1–2, at least 7 of 14.
  - `sim.warden.duo.test.ts`:
    - **W1** `it('a strong duo beats the Warden')`: STRONG_PAIRS careful × seeds 1–10: at least 48 of 60 wins, every pair at least 6 of 10; mean TTK of wins in [220, 330] s; mean breaks per run ≥ 2; and for pairs with an interrupt in their bars or duo picks, mean Toll interrupts per run ≥ 1;
    - **W3** `it('an average duo usually loses or barely wins')`: STRONG_PAIRS sloppy × seeds 1–10: wins in [3, 30] of 60.
  - `sim.warden.party.test.ts`:
    - **W2** `it('three average adventurers beat the Warden')`: TRIOS sloppy × seeds 1–10: at least 21 of 30 wins, every trio at least 6 of 10;
    - **W5** `it('four is not trivial')`: QUADS sloppy × seeds 1–10: at least 16 of 20 wins, and (mean deaths per run ≥ 0.5 or mean TTK ≥ 180 s); and QUADS careless × seeds 1–5: at most 5 of 10 wins;
    - **W6** `it('careless trios lose')`: TRIOS careless × seeds 1–4 (12 runs): at most 2 wins.
  - `sim.warden.solo.test.ts`:
    - **W4** `it('solo at Plan 3b power cannot realistically win')`: the seven jobs careful × seeds 1–2: 0 of 14 wins; mean `bossHpFrac` ≥ 0.35;
    - **G1** `it('gear has room to matter')`: STRONG_PAIRS[0] and [1] careful with `stats { power: 13, defence: 14, maxHp: 130 }` × seeds 1–10: at least 19 of 20 wins with mean TTK at least 15% below their W1 mean; and paladin and dark_knight solo careful with `stats { power: 20, defence: 24, maxHp: 180 }` × seeds 1–5 each: at least 3 of 10 wins.
  - `brain.test.ts`: a careful brain walks out of a field; dodges inward out of a ring; spreads 4 m during Brass Fall; switches to a Lens Shard while the Warden is warded; holds Sunder for Keeper's Toll.
  - **Speed:** each Warden band file runs in ≤ 40 s on this machine, and the whole combat suite in ≤ 120 s (Vitest runs the files in parallel). If slower, profile the simulation first (cache the per-tick ally lists, skip brains of the dead); never lower a band's seed count below 10 per party (W6 and W5's careless half are the stated exceptions).
- **What "fast" must not change:** Plan 3b's bands (`sim.test.ts`, `sim.jobs.*.test.ts`) still pass unchanged.

- [ ] **Step 1: Write the failing tests** above.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement the simulation and the brain. Then tune only by the Tuning rule until every band passes.** Write a scratch script in the scratchpad (not committed) that prints, per band, wins, mean TTK, deaths, phase reached, enrage share, interrupts and breaks per party. Paste the final tables into the task report.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: dungeon encounters in the simulation, a dungeon-aware brain and the Warden's difficulty bands`, listing every tuning change in the commit body.

### Task 6: Server I: parties

**Files:**
- Create: `server/src/party/parties.ts`, `server/src/party/parties.test.ts`, `server/src/rooms/party.test.ts`.
- Modify:
  - `server/src/rooms/ZoneRoom.ts` (party messages, chat channel, `setParty`, `pinnedAdventurers`, shared credit, status relay, `deliver`);
  - `server/src/rooms/presence.ts` (names → account ids);
  - `server/src/app.ts` (one `Parties` per app, swept every 5 s, passed to every room);
  - `server/src/rooms/testHelpers.ts` (party helpers).

**Interfaces:**
- Consumes: Tasks 1 and 3 (`PartyOp`, `parsePartyOp`, `PartyView`, `PARTY_*`, `Combat.setParty`).
- Produces:
```ts
// parties.ts
export interface MemberStatus { zone: ZoneId; roomId: string; eid: number; job: JobId; level: number; hp: number; maxHp: number; dead: boolean; searing: number }
export interface Party { id: string; leader: string; members: { accountId: string; name: string; joinedAt: number; offlineSince: number | null; status: MemberStatus | null }[] }
export class Parties {
  constructor(opts?: { now?: () => number });
  partyOf(accountId: string): Party | undefined;
  invite(from: { accountId: string; name: string }, to: { accountId: string; name: string }): PartyRefusal | { partyId: string; size: number };
  accept(accountId: string, name: string, partyId: string): PartyRefusal | Party;
  decline(accountId: string, partyId: string): void;
  leave(accountId: string): Party | undefined;                       // the party as it is after (undefined if dissolved)
  kick(leader: string, name: string): PartyRefusal | { kicked: string; party: Party | undefined };
  lead(leader: string, name: string): PartyRefusal | Party;
  setStatus(accountId: string, s: MemberStatus | null): boolean;    // true if it changed
  setOnline(accountId: string, online: boolean): void;
  sweep(): void;                                                    // expired invites; members offline > PARTY_OFFLINE_KEEP_S; offline leaders > PARTY_LEADER_AWAY_S
  view(party: Party, forRoomId: string | null): PartyView;            // eid -1 for members in other rooms
  onChange(cb: (partyId: string, accountIds: readonly string[]) => void): void;   // every member of the party before and after
}
// presence.ts
export class Presence { /* … */ readonly names: Map<string, string> }    // lower-case adventurer name → accountId, kept by joins and leaves
// ZoneRoom.ts
public deliver<T extends keyof S2C>(sessionId: string, type: T, message: S2C[T]): void;   // to a session of this room, if connected
public partyChanged(accountId: string): void;   // re-sends `party`, re-runs setParty for its eid, refreshes pins
```
- **Messages:**
  - `party` (C2S): `parsePartyOp`, else dropped; it spends the message budget, and `invite` also counts against `PARTY_INVITES_PER_MIN`. An `invite` by `eid` resolves to a session in this room; by `name` through `presence.names`. Refusals go back as `partyRefused { reason, text: PARTY_TEXT[reason] }`. A valid invite sends `partyInvite` to the invitee wherever it is (`presence.get` → `room.deliver`).
  - `chat` (C2S) with `channel: 'party'`: to every online member's session through `deliver`, as `chat { …, channel: 'party' }`; without a party → `partyRefused 'not-member'`. Zone chat is unchanged and now carries `channel: 'zone'`.
  - `party` (S2C): sent on join (null or the view), on every change (`onChange`), and with status changes at most `PARTY_STATUS_HZ`.
- **Engine allies:** on join and on every change, `combat.setParty(eid, partyId)` for every session of a member in this room (null without a party).
- **Status:** each room step, every `TICK_HZ / PARTY_STATUS_HZ` steps, a session in a party calls `parties.setStatus`; a change notifies the party's members (the `party` message, coalesced per room step).
- **Pins:** `pinnedAdventurers(session)` returns the PlayerStates of the session's party members in this room.
- **Shared credit:** in `handle(out)`, for each kill: the credited sessions, plus every session of a party member of a credited one, in this room, within `PARTY_SHARE_R` of the enemy (alive or dead); deduplicated; each gets `credit` and `gainXp`.
- **Presence:** `names` is set on join (the adventurer's name, lower-cased) and removed when the account goes offline everywhere; `parties.setOnline` follows the presence.
- **Travel:** nothing changes for parties: the registry is process-wide; the next room re-sends the view on join.

- [ ] **Step 1: Write the failing tests.**
  - `parties.test.ts` (pure, with a fake clock): invite/accept/decline; a fifth refused `'full'`; non-leader `'not-leader'`; `'self'`; `'in-party'`; expiry after 60 s → `'expired'`; the eleventh invite in a minute `'rate'`; leader leaving hands the lead to the longest-standing; a party of one dissolves; offline 300 s → removed; offline leader 60 s → lead passes; `onChange` lists members before and after.
  - `party.test.ts` (rooms; memory store; fixed seed; the grove and a test Greenway with a dummy camp):
    - `it('A invites B by eid; B accepts; both get party views with each other; ids are engine ids in the same room')`;
    - `it('invite by name reaches B in another zone; B accepts there; the view shows each member's zone')`;
    - `it('party chat reaches members in both zones and nobody else; markup arrives as plain text')`;
    - `it('Field Dressing without an ally id heals the party member, never the nearer stranger')` (Review Focus 2);
    - `it('pinned: a party member 120 m away stays in the view; a stranger 120 m away does not')`;
    - `it('shared credit: B 20 m away gets credit and xp for A's kill; C (not in the party) does not; a member in another zone does not')`;
    - `it('status relay at most 2 Hz and only on change')`;
    - `it('a party survives travel and a reconnect inside the 30 s window')`;
    - `it('junk party messages are dropped; 30 invites a second end in rate')` (Review Focus 1).
  - All Plan 1–3b room tests pass.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep every room test under 10 s of real time.
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Then the bandwidth runs on port 2571** (grove `--count 100 --seconds 30`, then `--cluster 15`): exit 0, ≥ 14 Hz, 0 corrections, KiB/s within the Global Constraints. Stop by PID.
- [ ] **Step 5: Commit**: `feat: parties: invites, leaders, party chat, party allies in the engine, pinned views and shared credit`.

### Task 7: Server II: instances, checkpoints, wipes, sealed arenas, rewards, migration 005

**Files:**
- Create:
  - `server/src/rooms/instances.ts`, `server/src/rooms/instance.test.ts`, `server/src/rooms/boss.test.ts`;
  - `server/migrations/005_parties_and_warden.sql`;
  - `server/src/routes/leaderboard.ts` and its test.
- Modify:
  - `server/src/rooms/ZoneRoom.ts`, `server/src/rooms/state.ts`;
  - `server/src/app.ts` (define `lampfall` with instance options; normal zone rooms only for `SAVE_ZONE_IDS`; stats);
  - `server/src/auth/routes.ts` (`/zone` answers `instance`);
  - `server/src/store/types.ts`, `server/src/store/memory.ts`, `server/src/store/pg.ts`, `server/src/store/store.test.ts`;
  - `server/src/index.ts` (`SG2_START_AT`, `SG2_TEST_INSTANCE_START`), `server/src/index.test.ts`;
  - `server/src/rooms/testHelpers.ts`.

**Interfaces:**
- Consumes: Tasks 2, 4 and 6.
- Produces:
```ts
// instances.ts
export interface InstanceInfo { key: string; roomId: string; room: ZoneRoom | null; allowed: Set<string>; createdAt: number;
  emptySince: number | null; cleared: boolean; heldFor: Map<string, number> /* accountId → until ms */ }
export class Instances {
  constructor(opts: { max: number; emptyMs: number; maxMs: number; now?: () => number; open: (key: string) => Promise<string> /* matchMaker.createRoom('lampfall', { instanceKey }) → roomId */ });
  keyFor(accountId: string, parties: Parties): string;               // party id, or 'solo:' + accountId
  async enter(key: string, accountId: string): Promise<InstanceInfo | 'full'>;   // opens if needed (one at a time per key; the cap is checked atomically)
  byRoom(roomId: string): InstanceInfo | undefined;
  hold(accountId: string, roomId: string, ms: number): void;         // a drop or a travel in progress
  heldRoom(accountId: string): string | undefined;                   // for /api/zone
  release(accountId: string): void;
  get count(): number;
  sweep(): void;                                                     // closes empty, cleared-and-empty and expired instances (room.disconnect after sending everyone out)
}
// state.ts: ZoneState gains fields: t.map(FieldSchema) (not filtered), instance: t.string(), sealed: t.string() (encounter id or ''),
//   wipeAt: t.uint32() (clock step when everyone gets up, 0 none);
//   EnemyState gains phase: t.uint8(), warded: t.boolean(), enrageAt: t.uint32() (clock step, 0 none), tier: t.string();
//   PlayerState gains searing: t.uint8(); TelegraphState gains inner: t.float32() (rings only)
//   FieldSchema: { id: t.int32(), owner: t.int32(), field: t.string(), shape: t.string(), x, z, r, inner: t.float32(), raw: t.uint8(), at: t.uint32() }
// ZoneRoomOptions gains instance?: { key: string; registry: Instances; parties: Parties; startAt?: CheckpointId }
// store/types.ts
export interface Adventurer { /* … */; seals: number; sealDay: string | null; titles: string[] }
export interface BossKill { boss: 'wickhound' | 'fallen_warden'; partySize: number; seconds: number; names: string[]; at: Date }
export interface Store { /* … */
  awardSeal(adventurerId: string, dayUtc: string): Promise<{ awarded: boolean; seals: number }>;   // atomic: only when sealDay ≠ dayUtc
  addTitle(adventurerId: string, title: string): Promise<boolean>;                                  // false if already held
  recordBossKill(k: BossKill): Promise<{ rank: number }>;                                           // rank among the same boss and size, by seconds
  bossLeaderboard(boss: BossKill['boss'], partySize: number, limit?: number): Promise<{ names: string[]; seconds: number; at: string }[]>;
}
```
- **Migration `005_parties_and_warden.sql`** (safe to run again):
```sql
-- Plan 4: Warden's Seals (one a UTC day per adventurer), titles, and boss kills for the leaderboard.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS seals integer NOT NULL DEFAULT 0;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS seal_day date;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS titles jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS boss_kills (
  id bigserial PRIMARY KEY,
  boss text NOT NULL,
  party_size smallint NOT NULL CHECK (party_size BETWEEN 1 AND 4),
  seconds real NOT NULL CHECK (seconds > 0),
  names jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS boss_kills_board ON boss_kills (boss, party_size, seconds);
```
- **Rooms:**
  - `app.ts` defines `gameServer.define('lampfall', zoneRoomFor({ …, zone: zoneDef('lampfall'), instance }, …))` with `filterBy` none; instances are only opened by `Instances.enter` through `matchMaker.createRoom('lampfall', { instanceKey })`. The normal per-zone rooms are made for `SAVE_ZONE_IDS` only. An instance room never registers in `rooms`; its `autoDispose` stays false (the registry closes it).
  - **Entry:** a pose into the Greenway's mouth exit (`instance: true`) runs the usual checks, then `instances.enter(key, accountId)`; `'full'` → correct and `notice(REASON_INSTANCES_FULL)`; otherwise a travel: save `{ zone: 'greenway', LAMPFALL_MOUTH.arrive }` (the stored zone stays the Greenway), `hold(accountId, roomId, INSTANCE_RECONNECT_S)`, `travel { zone: 'lampfall', instance: roomId }`, leave consented. The instance's static `onAuth` admits only an account in `allowed` (the party at entry, and members who join the party later), refusing others with `REASON_ELSEWHERE`.
  - **Inside:** `reconnectSeconds = INSTANCE_RECONNECT_S`; joins start at the current checkpoint (`rim` centre, or `landing` once the Wickhound is dead); every save is the mouth save above (`expect: { zone: 'greenway' }`); the dead are not saved as respawned at the statue; `respawn` is refused (`'invalid'`) and `release` takes its place (Numbers → Instances); `instance` is sent on join and when it changes; `state.instance = roomId`.
  - **Sealed gates:** on `TickOut.boss` `'wake'` for the Wickhound or the Warden, `SEAL_DELAY_S` later `state.sealed` = its encounter id and the gate circle refuses poses (correct + `REASON_ARENA_SEALED`), dodges included (their start and end); on `'reset'` or the kill it opens.
  - **Wipe:** checked each step: every session in the room is dead (released ones count until they stand) and at least one enemy is engaged → `state.wipeAt` = now + `WIPE_DELAY_S`; then every dead session respawns at the checkpoint (a `respawned` message, as Plan 3's statue respawn, with a new ack) at full hp; the engine's bosses reset through their own return (no live targets).
  - **Kills:** the Wickhound's death moves the checkpoint to `landing`; the Warden's opens the lamp-lift exit for this instance and marks it `cleared`. Each boss kill: `recordBossKill`; for each credited session: xp (Task 6's shared credit), and for the Warden `awardSeal(adventurerId, today UTC)`, a solo title per Numbers → Rewards (`addTitle`), then `victory` with the rank.
  - **Party changes:** a member who leaves or is kicked while inside gets `notice(REASON_LEFT_PARTY)` and travels out after `INSTANCE_EVICT_S`; a new member is added to `allowed`.
  - **Leaving:** the exit stair, the lamp-lift and `leaveInstance` all travel to the Greenway room (the usual travel save at the mouth arrival). When the last session leaves (no holds), `emptySince` starts; `sweep` (every 5 s) closes it per `INSTANCE_EMPTY_S`, at once if cleared, and any instance past `INSTANCE_MAX_S` (`notice(REASON_INSTANCE_CLOSED)` and travel for everyone inside first).
  - **`/api/zone`:** `{ zone, instance? }`: `instance` = `instances.heldRoom(accountId)` when it is open and the account is allowed; then `zone` is `'lampfall'`.
  - **Stats and `/healthz`:** `instances: { open: number; players: number; tickMsP95Max: number }`.
  - **Leaderboard:** `GET /api/leaderboard/:boss?size=n` (boss `wickhound` or `fallen_warden`, size 1–4), rate-limited 60 a minute per address, answering `{ entries: [{ names, seconds, at }] }`; anything else → 400.
  - **Test-only switches** (like `SG2_START_ZONE`; never in Docker or `docker-compose.yml`; `index.test.ts` checks they are off by default):
    - `SG2_START_AT=lampfall-mouth`: new adventurers start in the Greenway at `LAMPFALL_MOUTH.arrive` (implies `SG2_START_ZONE=greenway`);
    - `SG2_TEST_INSTANCE_START=landing`: new instances start with the packs and the Wickhound already dead and the checkpoint at the landing (for the scripted Warden runs).

- [ ] **Step 1: Write the failing tests.**
  - `instance.test.ts` (memory store, fixed seed, short test-only timings through options):
    - `it('A and B in a party walk into the mouth: one instance, both inside, state.instance set, stored zone still greenway')`;
    - `it('a solo adventurer gets its own instance')`;
    - `it('the 13th party is refused with REASON_INSTANCES_FULL; two parties racing for the 12th: exactly one opens')` (Review Focus 3);
    - `it('joining an instance by room id without being allowed is refused')`;
    - `it('a drop inside holds the seat 120 s; /api/zone answers lampfall with the room; after the hold, the mouth')`;
    - `it('signing out inside saves at the mouth; a server restart puts everyone at the mouth')`;
    - `it('kicked from the party inside: notice, then out after 10 s')`;
    - `it('death inside: no statue; release refused before 10 s, then at the checkpoint; auto release at 60 s')`;
    - `it('a wipe: everyone gets up at the checkpoint after 5 s; killed packs stay dead; engaged enemies reset')`;
    - `it('the exit stair and leaveInstance take you to the mouth; an empty instance closes after 120 s, a cleared one at once')`;
    - `it('an instance past its hard lifetime sends everyone out and closes')`.
  - `boss.test.ts` (`SG2_TEST_INSTANCE_START`-style options; scripted sessions):
    - `it('the Wickhound's gate seals 3 s after it wakes and opens when it dies; poses and dodges into it are corrected with the notice')`;
    - `it('a released adventurer cannot walk back into a sealed fight')`;
    - `it('the Wickhound's death moves the checkpoint to the landing')`;
    - `it('the Warden's phases, fields, shards, warded and enrage show in state; fields are in every client's state')`;
    - `it('a Warden kill: xp, one Seal (none the second time the same UTC day), a boss_kills row, a victory with rank; a solo kill gets Lampbreaker')` (Review Focus 4);
    - `it('the lamp-lift opens after the kill and travels to the mouth')`.
  - `store.test.ts` (memory, and pg when `TEST_DATABASE_URL` is set): seals once a day, titles once, kills and the leaderboard order; `'lampfall'` refused by `checkedSave`; migration 005 safe to run twice (pg only).
  - The leaderboard route test: good and bad requests, the rate limit.
  - All earlier room tests pass.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Run `npm run typecheck`: clean.** Then on port 2572 (`SG2_START_AT=lampfall-mouth`), the existing bots (`--count 20 --seconds 30 --zone greenway`) still pass: they never walk into the mouth. Stop by PID.
- [ ] **Step 5: Commit**: `feat: Lampfall instances: entry, checkpoints, wipes, sealed arenas, Seals, titles and the boss leaderboard`.

### Task 8: Client I: party UI, party chat, edge markers, instance entry and exit, boss frame, wipe and victory screens (browser-heavy)

**Files:**
- Create:
  - `client/src/net/party.ts` (pure: the client's party state from `party`, `partyInvite`, `partyRefused`), `client/src/net/party.test.ts`;
  - `client/src/hud/party.ts` (party frames, the invite card, the party sheet), `client/src/hud/party.test.ts`;
  - `client/src/hud/boss.ts` (the boss frame), `client/src/hud/boss.test.ts`;
  - `client/src/combat/edgeMarkers.ts`, `client/src/combat/edgeMarkers.test.ts`.
- Modify:
  - `client/src/core/contracts.ts` (`HudState.party` becomes `PartyBar[]`, `HudState.boss`, `HudEvent`s, `HudApi` additions);
  - `client/src/hud/{index,frames,overlays,style,dev}.ts`;
  - `client/src/net/session.ts` (`zoneFor` answers `{ zone, instance }`; `connect(token, zone, instance?)` joins by id);
  - `client/src/net/chatBox.ts` (channels);
  - `client/src/online.ts` (party, instance and victory messages; travel by instance id; `window.__sg2net` additions);
  - `client/src/boot.ts` (`loadZone('lampfall')` builds Task 9's world; until Task 9 lands, a flat placeholder floor from `lampfallLayout()` is acceptable here).

**Interfaces:**
- Consumes: Tasks 6 and 7 (messages, state). **Plan 3b Task 7 (assumed built):** `createAllyFocus` / `AllyFocus` in `client/src/combat/allyFocus.ts`, `HudState.ally` and the `FocusFrame` in `client/src/hud/frames.ts`, `HudEvent 'cycleAlly' | 'clearAlly'`, `HudApi.endScreen`, `__sg2net.refusals`. If Plan 3b's names differ, use what was built and say so in the report.
- Produces:
```ts
// contracts.ts
export interface PartyBar extends HudBar { eid: number; dead: boolean; leader: boolean; online: boolean; zoneLabel: string | null /* null: here */;
  inRange: boolean; glyph: string; level: number; searing: number }
export interface BossBar { name: string; hp: number; maxHp: number; phase: number; phases: number; phaseMarks: number[] /* hp fractions */;
  phaseName: string; warded: boolean; enrageIn: number | null; stagger: number; maxStagger: number;
  cast: { name: string; frac: number; interruptible: boolean } | null; transition: boolean }
// HudState: party: PartyBar[] (other members, join order); boss?: BossBar | null
// HudEvent adds: { type: 'openParty' } (P key, the party button) | { type: 'invite'; eid: number } (the focus frame's Invite)
//   | { type: 'focusMember'; eid: number } (a tap on a party frame) | { type: 'release' } | { type: 'leaveInstance' }
// HudApi adds:
  partyInvite(from: string, size: number): Promise<boolean>;      // the invite card: Accept / Decline (56 px), times out with the invite
  partySheet(view: PartySheetView): Promise<PartyAction | null>;
export interface PartySheetView { members: { name: string; leader: boolean; online: boolean; zone: string | null; job: string; level: number }[]; amLeader: boolean }
export type PartyAction = { kind: 'invite'; name: string } | { kind: 'kick'; name: string } | { kind: 'lead'; name: string } | { kind: 'leave' };
```
- **Party frames:** under the player frame, one 48 px row per other member: job glyph disc, name, hp bar, a skull when dead, a dim row when offline or in another zone (with the zone's name), a crown for the leader, Searing stacks as small flames. A tap focuses that member (sets Plan 3b's ally focus to its eid when in this room). On phones in landscape they collapse to 36 px icons with hp rings when the screen is under 420 px tall (still 48 px touch targets).
- **Inviting:** the focus frame (Plan 3b) gains an "Invite" button (48 px) when the focused adventurer is not a party member and you lead a party or have none. `/invite Name` in chat and the party sheet's name field send `party { op: 'invite', name }`. Refusals toast `PARTY_TEXT[reason]`.
- **The invite card:** "Ellie_01 invites you to a party (2/4)" with Accept and Decline; it expires with the invite; several invites queue.
- **The party sheet (`P`, or a party button beside the chat button):** members with job, level and zone; for the leader: Kick and Make leader per member, and an invite-by-name field; Leave party for everyone. Full-screen on phones, a 380 px panel on desktop; Esc closes.
- **Party chat:** the chat box gains a channel toggle (Zone / Party, 48 px); `/p text` sends party chat from either; party lines are teal and tagged "[Party]". Without a party the toggle hides.
- **Edge markers** (`edgeMarkers.ts`, pure layout plus a small DOM layer): for each party member in this room off screen, an arrow at the screen edge pointing to them with their initial, 28 px, at most 3, never inside the joystick zone or the ability arc; on screen, a teal ring under party members (distinct from the green focus ring). `edgeMarkerLayout(cam, viewport, members, exclusions)` is the tested pure part.
- **Instance entry and exit:**
  - walking into the crater mouth shows a 0.6 s fade and "Entering the Lampfall…"; a `notice(REASON_INSTANCES_FULL)` shows as a toast and no fade;
  - `travel { zone: 'lampfall', instance }` joins by id (`connect(token, 'lampfall', instance)`); `GET /api/zone` with `instance` does the same after a reload;
  - the banner shows the zone's banner and the room name as the adventurer enters each room;
  - leaving travels back with the usual fade.
- **Boss frame** (`boss.ts`): at the top centre, `min(92vw, 520px)` wide, shown while the targeted enemy (or any engaged enemy of tier `boss` or `mega` in view) is a boss: name, a thick hp bar with phase marks at 70% and 35% (50% for the Wickhound), the phase name, a stagger bar, the cast bar (blue with a "!" when interruptible), "Warded" when warded, and an enrage countdown from 60 s before it (red at 0). While a boss frame shows, the ordinary target frame shows the boss only as a slim line (no duplicate bars). A phase change shows the phase banner from `BossData.lore.phases`.
- **Wipe and victory screens:**
  - death inside: the end screen "Fallen" with "Release in {s}" counting from `InstanceView.releaseIn`, then a Release button (sends `release`); the Plan 3 statue button does not show inside;
  - a wipe: "The light goes out…" with "Back to the {checkpoint} in {s}";
  - victory: the boss's lore line, time, party size, xp, "Warden's Seal +1" (or "Seal already earned today", with the total), the title if any, the rank for the party size, and buttons "Leave the Lampfall" (sends `leaveInstance`) and "Stay".
- **`window.__sg2net`** adds: `party: PartyView | null`, `invites: { partyId: string; from: string }[]`, `partyRefusals: string[]` (last 20), `instance: InstanceView | null`, `roomId: string`, `boss: { kind: string; phase: number; warded: boolean; enrageIn: number | null } | null`, `victory: VictoryView | null`, `chatLog: { from: string; text: string; channel: string }[]` (last 50).

- [ ] **Step 1: Write the failing tests.**
  - `party.test.ts` (net): the state follows `party` messages (members, leader, zones, eids), drops the party on null, queues and expires invites.
  - `party.test.ts` (hud): `partyBars(view, me, here)` rows in join order without self; offline and other-zone rows dim; leader crown; inRange from 18 m.
  - `boss.test.ts`: `bossBar(enemyState, data, clock)` phase marks for both bosses, phase names, warded, the enrage countdown only within 60 s, the transition flag.
  - `edgeMarkers.test.ts`: off-screen members get one marker each, clamped to the viewport minus exclusions; on-screen members get none; at most 3, nearest first.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test` (PASS), client `tsc`, `npm run build` (the offline demo unchanged: no party UI) and `npm run build:online`. Then the browser check:**
  - start the server on port 2573 with `SG2_START_AT=lampfall-mouth` in the background and note its PID;
  - with Playwright, page A at desktop size and page B as `devices['iPhone 13']`, `?lockq`, game time:
    - A taps B, the focus frame's Invite; B's invite card shows (screenshot); B accepts; both show a party frame for the other (screenshot on both);
    - A sends party chat; B sees it tagged; a third page C (not in the party) does not;
    - A walks away 70 m; B's screen shows A's edge marker (screenshot);
    - both walk into the mouth: both land in the same instance (`__sg2net.roomId` equal), the banner shows; C walking in alone gets a different instance;
    - a reload of B inside: B is back in the same instance;
    - the Lens Pit is not reachable yet, so check the boss frame and the victory screen with `client/dev/hud.html` (Plan 3b's HUD dev page) states: Wickhound mid-fight, Warden warded and enraging, the wipe screen, the victory screen (screenshots desktop and iPhone).
  - On the iPhone, measure every `.sg-ctl` and party row: at least 48 px, none intersecting the joystick zone, the ability arc or each other; the boss frame does not overlap the target frame or the party frames.
  - No page errors. `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: party frames, invites, party chat and edge markers; Lampfall entry and exit, boss frame, wipe and victory screens`.

### Task 9: Client II: the Lampfall's look, the crater mouth, boss and add models, telegraph language and fields (browser-heavy)

**Files:**
- Create:
  - `client/src/world/lampfall.ts` (the dungeon world from `lampfallLayout()`), `client/src/world/lampfall.test.ts`;
  - `client/src/world/mouth.ts` (the crater mouth in the Greenway);
  - `client/src/combat/bossModels.ts` (the Wickhound, the Lens Shard, the Warden upgrade);
  - `client/src/combat/fields.ts` (field decals from `state.fields`);
  - `client/dev/lampfall.html` and `client/src/world/lampfallDev.ts` (a viewer, not part of the build).
- Modify:
  - `client/src/world/greenway.ts` (place the mouth);
  - `client/src/world/index.ts` or `client/src/boot.ts` (the zone builder for `lampfall`; the dungeon's fog, light and sky);
  - `client/src/combat/telegraphs.ts` (ring decals; the "each", interruptible and enrage looks; repeat sequences);
  - `client/src/combat/enemies.ts` (`makeEnemy` for the three new kinds through `bossModels.ts`; the `'phase'` mode);
  - `client/src/combat/overheads.ts` (Searing flames over adventurers; "Warded" sigil over the Warden);
  - `client/src/player/character.ts` (only if the Warden upgrade reuses `buildWarden`).

**Interfaces:**
- Consumes: Tasks 2 and 4 (`lampfallLayout`, `LAMPFALL_MOUTH`, `ZoneLayout.mouth`, kinds, attacks, shapes, `FieldView`) and Task 7's state fields (`fields`, `phase`, `warded`, `enrageAt`, `searing`, `inner`). **Plan 3b Task 8 (assumed built):** the pooled spell visuals (`client/src/combat/spells.ts`, `spellVisualFor`) and the remote job looks; the boss attacks reuse its pool for flashes where they fit.
- Produces:
  - **The Lampfall look** (`lampfall.ts`):
    - floors: flat-shaded stone flags in `PALETTE.stone` shaded down 25–35%, per room a slightly different tint; corridor ramps and the Wick Stair's terraces with visible step edges (a lighter lip), so climbs read on a phone;
    - walls: extruded along each room circle and corridor edge, 4–6 m high, rough-cut (6–10 facets per 10 m), dark violet-grey from `PALETTE.rock`, open to the sky in the rim (the crater) and closing to a vault deeper down;
    - light: one hemispheric and one dim directional light, plus emissive lamp crystals (`PALETTE.gold`/`horizon`) on the walls every 8–12 m as warm pools; no dynamic point lights beyond two near the camera;
    - fog: denser than the Greenway, deep teal-violet, starting at 25 m; the floor stays light enough that telegraph decals and fields read on every quality tier (the check: decal-to-floor luminance contrast ≥ 3:1 measured in screenshots of each room on `?q=low` and `?q=high`);
    - props: pillars (cracked columns), rubble platforms (stacked blocks with a flat top, so they read as climbable), brass debris from the Beacon (gears, bent rails, lens fragments that glint), roots hanging from the rim's ceiling edge; all merged per material;
    - the Lens Pit: a round floor with a brass compass rose inlay (it shows the phase 2 and 3 field radii as faint rings so players learn the safe floor), the fallen lamp-head in the middle, and the lamp-lift as a brass cage that rises at the centre after the kill;
    - the sealed gates: a brass portcullis in each gate corridor that drops when `state.sealed` names its room and lifts when it clears;
    - the sanctuaries: a ring of small lanterns on the floor (the job board works there; the Guild Board model is not repeated);
  - **The crater mouth** (`mouth.ts`): a crater 14 m across where the road ends, broken earth and scorched grass around it, a stone stair going down into dark, brass debris, a faint warm glow from below; the exit circle sits on the top step.
  - **Budget:** the Lampfall at med ≤ 70k triangles and ≤ 70 draw calls (merged per material); at low ≤ 35k triangles and ≤ 45 draw calls; the mouth adds ≤ 4k triangles and ≤ 4 draw calls to the Greenway.
  - **Models** (`bossModels.ts`; flat-shaded, `PALETTE` colours, animated by the Plan 3 enemy rig's modes):
    - **the Fallen Warden** (≤ 3k triangles): the existing `buildWarden` look scaled to about 4.5 m: stone body, brass bands, the lamp-head glowing (gold, brighter during wind-ups, guttering during a Break), a cracked lens, a bent brass lantern-arm, and the "F." maker's mark plate on its collar; phase 3 shows the lens fallen (the head dark, the beam from its chest);
    - **the Wickhound** (≤ 2k triangles): a brass-and-stone hound about 2.2 m at the shoulder, built like the boar's quadruped but leaner, with a flickering wick-mane (a few emissive flame quads) that flares in phase 2;
    - **the Lens Shard** (≤ 300 triangles): a floating faceted crystal 1.6 m tall over a brass socket, slowly turning, glowing toward the Warden with a thin beam (shows the ward);
  - **Telegraph language** (`telegraphs.ts`):
    - every telegraph keeps Plan 3's warm-red base, inner fill and rim flash;
    - **ring:** the decal is the ring itself, with the safe inner circle outlined in white;
    - **interruptible:** a blue rim (`PALETTE.teal`-to-blue) and a "!" glyph at the origin, so interrupt chances read at a glance (Ember Breath, Keeper's Toll, Focus Beam);
    - **"each" (Brass Fall):** a purple tint on every circle and a small falling-gear icon in its centre, so "spread out" reads;
    - **repeat (Turning Light):** later lines in a sequence show as faint outlines until their own wind-up starts;
    - **the whole-arena Toll:** the decal is drawn as a thin bright edge along the arena wall plus a pulsing centre, not a giant red disc (the floor stays readable);
    - **enrage (Last Light):** the screen-edge danger glow pulses gold;
  - **Fields** (`fields.ts`): from `state.fields`; an animated ember shimmer in `PALETTE.roof`/`horizon` on the ground inside the field, with no rim flash (it is not a telegraph), and a slow warm fog lift at its edge; on `?q=low` a flat tinted decal only;
  - **Overheads:** Searing as 1–5 small flames over an adventurer; "Warded" as a crystal sigil over the Warden while warded.

- [ ] **Step 1: Write the failing tests** in `lampfall.test.ts`: the world builder (pure parts) places one floor piece per room and corridor, a wall run along every floor edge with no gap at corridor mouths, every pillar and rubble block at its layout spot, and the gate portcullises at the gate circles; and the triangle counts of the merged meshes stay within the budget at med and low (counted from the vertex data, no WebGL).
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` and `npm run build:online`. Then the browser check:**
  - `client/dev/lampfall.html` under `npm run dev`, at desktop size and on the iPhone 13: screenshots of every room on med and low; the three models idle and winding up; every telegraph kind (ring, interruptible, each, repeat, the Toll, enrage) on the Lens Pit floor; the lampfire fields of phases 2 and 3; draw calls and triangles per room recorded;
  - start the server on port 2574 with `SG2_START_AT=lampfall-mouth` and `SG2_TEST_INSTANCE_START=landing` in the background (note the PID); one page walks from the mouth into the Lampfall and down into the Lens Pit; screenshots of the mouth from the road, the landing sanctuary, the portcullis dropping when the Warden wakes, and phase 1 telegraphs; `kill <pid>`;
  - no page errors.
- [ ] **Step 5: Commit**: `feat: the Lampfall's look, the crater mouth, the Warden, the Wickhound and the Lens Shard, boss telegraphs and fields`.

### Task 10: Bots in parties and instances, the party smoke test, the load runs and the scripted Warden runs (browser-heavy: the smoke test)

**Files:**
- Modify: `server/scripts/bots.ts`, `docs/load-test.md`.
- Create: `server/scripts/smoke-party.mjs` (the existing `smoke.mjs` is left as Plan 3b leaves it).

**Interfaces:**
- Consumes: Task 5's brain and `simulateEncounter`-compatible inputs, Tasks 6 and 7's messages and state, Task 8's `__sg2net` additions. **Plan 3b Task 9 (assumed built):** `bots.ts --fight --jobs mixed` (job switching in the grove, duo picks with partner `i ^ 1`, ally ids).
- Produces:
  - **`bots.ts --dungeon <n>`** (with `--fight`): the first bots form `n` parties with sizes cycling 4, 3, 2 (a party's leader invites by name, the others accept), each member on `JOB_IDS[i % 7]` set in the grove as Plan 3b does, then all walk to the crater mouth (`findPath` over the Greenway's ground) and enter. Inside they walk room to room (`lampfallLayout()` room order), fight each pack with the dungeon brain (Task 5) and `allies` = party members, and carry on until the run ends. Every other bot fights in the Greenway as before. With `n = 13` the 13th party must get `notice(REASON_INSTANCES_FULL)` and stay in the Greenway fighting.
  - It prints everything from Plan 3b, plus: parties formed, invites sent and refused (by reason), instances opened, full notices, packs killed per instance, Wickhound kills, wipes, releases, party chat lines sent and received, and per-instance step p95 (from `/healthz`).
  - It **passes** only if: Plan 3b's gates over the whole run (0 corrections, ≥ 15 Hz, kills, knockbacks, dodges, every job ≥ 1 kill); parties formed === n; instances opened === min(n, 12); full notices === max(0, n − 12); every instance kills its first pack within 150 s of entry; party chat delivered === sent to members; every zone room's p95 `tickMs` ≤ 15; every instance's p95 ≤ 3; peak RSS ≤ 400 MB.
  - **`bots.ts --warden <spec>`** (a scripted Warden run, for a server with `SG2_TEST_INSTANCE_START=landing`): `spec` is a comma list of parties, each `job+job…:skill` (e.g. `paladin+black_mage:careful,warrior+ranger+white_mage:sloppy,paladin:careful`). Each party forms, enters, walks from the landing into the Lens Pit and fights to a kill, a wipe, or `--seconds`. It prints per party: outcome, seconds, phase reached, enrage reached, deaths, revives, interrupts, Breaks. It never gates on the outcome (the simulation bands do), only on: no correction, no crash, every party reached the Lens Pit, and the server stayed within the step and memory limits.
  - **`smoke-party.mjs <url> --kill "kill <pid>"`** (server started with `SG2_START_AT=lampfall-mouth`): page A (desktop) and page B (iPhone 13) play as guests; A taps B and invites; B accepts; both show the other in a party frame; A's party chat line (with markup) reaches B as plain text, tagged; both walk into the mouth and are in the same instance (`__sg2net.roomId`); both walk to the Root Cellar, target with Tab and fight; the first pack (two Thornlings and an Archer) is dead within 300 s of game time (each enemy dead in `__sg2net.enemies` or credited), with both still in the instance; B reloads and is back in the same instance; A presses `P`, leaves the party, and within 15 s is back in the Greenway at the mouth with `REASON_LEFT_PARTY` shown; killing the server shows "Connection lost". Any page error fails it.

- [ ] **Step 1: Run the scripts against the current server to watch them fail** (bots: `--dungeon` unknown; smoke: the invite step).
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run root `npm test` (PASS, pristine). Then the dungeon load run:**
  - start the server on port 2576 with the default start zone in the background (note the PID);
  - `npm run bots -w server -- --url http://localhost:2576 --count 100 --seconds 240 --fight --jobs mixed --dungeon 13` → PASS (12 instances with 36 bots inside, one full notice, 64 bots in the Greenway);
  - `kill <pid>`.

  If it fails, profile and fix the server, never the thresholds. Likely fixes, in order: party status relay coalescing; instance rooms' view updates (everyone sees everyone: skip the grid); field and telegraph mirroring only on change.
- [ ] **Step 4: Run the scripted Warden runs** on port 2577 (`SG2_TEST_INSTANCE_START=landing`, PID noted): `--warden "paladin+black_mage:careful,warrior+ranger+white_mage:sloppy,paladin:careful" --seconds 420`. Record each party's outcome next to its simulation band (W1, W2, W4). A disagreement with the band (for example the careful duo never reaching phase 3) is reported, not tuned here. `kill <pid>`.
- [ ] **Step 5: Run the smoke test:** start the server on port 2578 with `SG2_START_AT=lampfall-mouth` (note the PID); `node server/scripts/smoke-party.mjs http://localhost:2578 --kill "kill <pid>"` → PASS. Also re-run the plain grove bot run and the clustered one (`--cluster 15`) on port 2578 after a fresh start → PASS, KiB/s within the Global Constraints. Stop by PID.
- [ ] **Step 6: Record every run's printed numbers in `docs/load-test.md`** (date, machine, parties, instances, enemy counts, job mix). **Commit**: `test: bots in parties and instances, the party smoke test, the dungeon load run and scripted Warden runs`.

### Task 11: Docs: outcome placeholder, roadmap and verification list

**Files:**
- Modify:
  - this plan, `docs/superpowers/plans/2026-11-12-sg2-plan-4-parties-and-the-fallen-warden.md` (fill `## Outcome`);
  - `docs/superpowers/plans/2026-11-11-sg2-plan-1-online-foundation.md` (the roadmap line for Plan 4, and Plan 5's line).

**Interfaces:**
- **Roadmap 4** becomes:

  > **Parties and the Fallen Warden** — parties of 4 that last across zones and short disconnects, party allies, frames, edge markers and chat, shared kill credit; the Lampfall, a generated private dungeon per party (three packs, the Wickhound) under the Greenway's crater; the Fallen Warden, a three-phase mega boss with adds, fields and an enrage, scaled for parties of one to four; Warden's Seals, the solo title and the boss leaderboard endpoint. Done (`2026-11-12-sg2-plan-4-parties-and-the-fallen-warden.md`).

  Roadmap 5 gains: "loot and loot rolls (moved from Plan 4), turning Warden's Seals into gear, and hard-mode rewards".

- [ ] **Step 1: Run the verification list below. Record each result, with numbers, in `## Outcome`:**
  1. Root `npm test`: the pass and skip counts, pristine.
  2. `npm run typecheck`: clean.
  3. `npm run build` and `npm run build:online` in `client/`: both succeed. The offline demo has no party or dungeon UI.
  4. Task 5's band tables (final numbers) and every tuning change.
  5. The dungeon load run (port 2579, 240 s, 100 bots, `--dungeon 13`): Hz, corrections, instances, full notices, packs killed, zone and instance step p95, RSS.
  6. The clustered grove walk (port 2579, after a fresh start): KiB/s per bot.
  7. `node server/scripts/smoke-party.mjs` against a fresh server on port 2579: PASS. Plan 3b's `smoke.mjs` against a fresh `SG2_START_ZONE=greenway` server on port 2579: still PASS.
  8. The scripted Warden runs' outcomes beside their bands.
  9. Review Focus 1–6: for each, the test names that cover it.
  10. Grep for the old ally comment ("no parties before Plan 4") and the room-wide ally rule: none left outside docs.
  11. Grep the client bundle for model names, and the repository for secrets (`SG2_JWT_SECRET=` with a value outside docs and the local test command): none. Grep `docker-compose.yml` and the Dockerfile for `SG2_START_AT` and `SG2_TEST_INSTANCE_START`: none.
- [ ] **Step 2: Write `## Outcome (date)`** in Plan 3's style: status, numbers, rulings made during the build, deferred items, and "For Plan 5" notes (Seals, loot, hard mode, level-scaled bosses).
- [ ] **Step 3: Commit**: `docs: Plan 4 outcome and roadmap`.

## Decisions this plan makes that the spec leaves open

These are recorded so that reviewers can check the tasks against them.

**Parties**
- Only the leader invites, kicks and promotes; anyone leaves; the lead passes to the longest-standing member. A party of one dissolves.
- Invites go by a tap (the focus frame's Invite button, keeping Plan 3b's tap-to-focus) or by exact name, across zones. Invites last 60 s; 10 a minute per adventurer.
- Parties live in server memory only. A signed-out member stays 300 s; an offline leader hands over after 60 s.
- **Allies are party members.** Automatic picks and every area effect reach only the party (and self). An explicit tap may still heal, shield, shelter, gift or revive a stranger, so kindness to strangers is possible but never accidental.
- Party members in the same room within 60 m share kill credit, alive or dead, and each gets the full xp (no split).
- Party members in the same room are pinned in each other's views; members elsewhere show their zone on the frame.
- Party chat is a channel of the existing chat (same cleaning and rate rules), unfiltered for now.

**The dungeon**
- The spec's "mega boss arena where the thing from the sky landed" is the bottom of a short dungeon, **the Lampfall**: the crater at the Greenway road's east end, dropping into the buried cellars of an old watch-house.
- One instance per party (a solo adventurer is a party of one), a Colyseus room of the zone `lampfall`, at most 12 at once, with a clear "crowded" notice.
- No lockout. Re-running is free; rewards are limited instead (one Seal a UTC day).
- Inside, the adventurer is always saved at the crater mouth in the Greenway; `lampfall` is never a saved zone. A server restart or a long disconnect puts everyone at the mouth.
- A drop holds the seat for 120 s (the spec's 2 minutes for boss arenas, applied to the whole instance).
- No statue inside: the dead wait for a revive or release to the checkpoint after 10 s (automatically at 60 s). A wipe brings everyone back at the checkpoint after 5 s. Killed enemies never respawn in an instance.
- Boss rooms seal 3 s after the boss wakes, so released adventurers cannot rejoin a boss fight: reviving matters.
- Two sanctuaries inside (the Crater Rim, the Keeper's Landing): a party can re-job before the Warden.
- Three packs of Plan 3 enemies (no new ordinary kinds), a mid boss (the Wickhound), then the Warden. Only one new add kind (the Lens Shard).

**The Fallen Warden**
- Story: the Beacon lighthouse's stone-and-brass keeper, knocked loose when the solstice beam raised the Beacon, built by Felix (his maker's mark on its collar). It tolls and sweeps its lamp as if the crater were its lighthouse.
- Three phases at 70% and 35%, each changing the arena: the whole floor; a fire ring shrinking the floor to r 15 with two warding Lens Shards; a deeper ring to r 12 with the Warden anchored and the Turning Light. Phases cannot be skipped by burst.
- Enrage at 330 s: a ramping arena pulse.
- Party scaling: ×1, 1, 1.45, 1.9 for one to four adventurers (the Wickhound ×1, 1, 1.5, 2.0); never weaker for fewer.
- Gear headroom is proved by the simulation, not built: a mid-tier stand-in speeds a duo up by at least 15%, and a top-tier stand-in makes a solo kill possible.
- Searing is the first player affliction, so the White Mage's cleanse is now real; taunt swaps, Mist Form, Ashcloud and stepping away also shed it, so no tank or healer is required.
- Skill levels for the bands are Plan 3b's: strong = careful, average = sloppy (30% of dodges missed), careless = never dodges.

**Rewards and records**
- Placeholder rewards: job xp (the Wickhound 120, the Warden 300), and a Warden's Seal once per UTC day per adventurer, saved as a count. Plan 5 turns Seals into gear.
- Loot rolls move to Plan 5 with loot.
- Solo title "Lampbreaker" for a kill by an instance that only ever held one adventurer during the fight.
- Every Wickhound and Warden kill is recorded; `GET /api/leaderboard/:boss?size=n` serves the ten fastest per party size; the victory screen shows the rank. A leaderboard page is later.
- Hard mode is later; the kill records are kept so it can unlock from them.

**Testing and tooling**
- The simulation runs the real encounter data on a flat copy of each room, with every band as a rate over at least 10 seeds per party (two stated exceptions), split over four files so the suite stays fast.
- Only Task 5 tunes, under a written rule, and only the new numbers.
- New test-only server switches: `SG2_START_AT=lampfall-mouth` and `SG2_TEST_INSTANCE_START=landing`; never set in Docker.
- The party smoke test is its own script (`smoke-party.mjs`), so Plan 3b's smoke test stays as it is.

## Outcome

To be written by Task 11.
