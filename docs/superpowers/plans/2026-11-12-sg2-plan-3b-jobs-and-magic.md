# Shady Grove 2 — Plan 3b: Jobs and Magic — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One adventurer, seven jobs. Each job has its own weapon, its own five-button bar (three job abilities plus two picks from the job's own pool), a trait, a role and a Momentum flavour. Each job levels separately, and the job is changed only in a town (the grove) or a sanctuary, never in the Greenway. The Staff brings magic: cast times, interrupts, and four elements (Fire, Water, Lightning, Earth) that react with marks. Every job brings something a partner wants, so any two jobs make a real duo. The server decides all of it, and the shared simulation proves the bands for every job alone and every pair together.

**Architecture:** This plan adds to Plan 3's combat package. It does not replace it.
- `@sg2/shared/combat` gains:
  - the job data (`jobs.ts`);
  - a data-driven effect list on every ability (`abilities.ts`), applied by one engine function (`effects.ts`);
  - casting (`casting.ts`);
  - elements, reactions and enemy weaknesses (`elements.ts`);
  - buffs on adventurers and debuffs on enemies;
  - per-job XP rules (`jobXp.ts`);
  - a job-aware brain (its hints come from the ability data);
  - a party simulation that runs every job and every pair.
- The engine learns two new intents: `job`, and `loadout` with picks. A job change is allowed only where `CombatZone.jobSwitch(x, z)` is true. The engine checks this, so the simulation, the server and the bots all share one rule.
- The server stores a `JobsSave` per adventurer: the current job, plus level, xp and picks for each job. A migration converts Plan 3 saves.
- The server mirrors a few new, rarely-changing fields into the state: job, cast, buffs and debuffs.
- The client gets:
  - a job board, opened at the Guild Board in the Plaza or with `J`;
  - a job badge and a cast bar on the HUD;
  - ally focus;
  - code-built weapon models for six weapons;
  - spell and support effects.

**Tech Stack:** as Plans 1–3: TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, PostgreSQL 16 / memory store, Playwright (pre-installed; never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md`. This plan implements:
- section 6 **Jobs**: the seven starting jobs, levelled separately, changed only in towns and sanctuaries, no abilities borrowed from other jobs, two or three strong support abilities per job, and solo combos inside a job's own abilities;
- section 6 **Weapons and Magic**: the Staff, the four elements, cast times, interrupts, element reactions through marks, and the Momentum bar as the only resource;
- section 6 **Combos**: the full mark set, and the "Lightning on Soaked stuns, Fire on Marked explodes" reactions;
- section 7: "No locked classes: any adventurer can level every job and picks the one the situation calls for before leaving town";
- the **data hooks** (only) for the unlockable jobs Monk, Bard, Beastmaster and Sky Lancer.

**Boundary with later plans** (stated so no worker builds it):
- **Plan 4 owns:** parties, party-only buffs, loot, boss arenas and the Fallen Warden. Until Plan 4, "ally" means any live adventurer in the same zone room.
- **Plan 5 owns:**
  - the real level curve (levels 1–10), and stats that grow with level;
  - abilities unlocked by level;
  - job talent trees (about ten points) and retraining for gold;
  - gear, armour types and sets;
  - each job's remembered outfit;
  - unique weapons and their models.

  Plan 3b stores, per job, `level`, `xp`, `picks`, `talents: []` and `outfit: null`. Level comes from a flat stub curve and changes nothing in combat. Plan 5 replaces the curve and fills `talents` and `outfit`.
- **The roadmap line for 3b** in Plan 1 promised "free picks borrowed from other jobs" and "talent trees". Both are overruled: the first by the owner ("no borrowed abilities"), the second by moving talents to Plan 5. Task 10 corrects the roadmap.

## Global Constraints

- **One combat system (Plan 3, unchanged):**
  - tap-target and auto-attack;
  - the Momentum bar (0–100), whose finishers cost 50;
  - five buttons;
  - a dodge roll with charges that refill (2, or 3 for the Ninja);
  - marks and combos, stagger and breaks, and ground telegraphs with wind-ups of at least 1.0 s.
- **No second resource bar:** spells cost Momentum and cooldowns. There is no mana.
- **Five buttons per job:** slots 1–3 are the job's quick skill, finisher and signature. Slots 4–5 are two **picks** from that job's own pool of four. There are no shared pools and no abilities borrowed from other jobs: every `AbilityId` belongs to exactly one job.
- **Jobs change only where `CombatZone.jobSwitch(x, z)` is true:**
  - the grove (a town) everywhere;
  - inside a sanctuary circle;
  - never the Greenway.
  The job also cannot change in combat, while dead, displaced, casting or charging.
- **Picks:**
  - they can change anywhere, but only out of combat;
  - each job remembers its own picks;
  - cooldowns are kept per ability id across a job change;
  - Momentum resets to 0 on a job change.
- **Server-authoritative:** clients send intents only:
  - target;
  - ability (slot, phase, and an optional `ally` engine id);
  - dodge (pose plus direction);
  - loadout (picks);
  - job;
  - respawn.

  The server decides:
  - casts, interrupts, heals, shields, buffs, revives and reactions;
  - who an ally-aimed ability lands on;
  - every refusal.

  Every ability press is validated against the current job's five slots.
- **Hits are decided by ground x/z only** (unchanged). Casting never makes anyone immune. Being in the air never avoids a ground effect, and that includes area heals and shields.
- **Honest clients are never corrected.** Casting slows movement to `CAST_MOVE_SCALE` through `speedScale`, exactly as Plan 3's charge slows it, with the same `CHARGE_SLOW_GRACE_S` and `SPEED_GRACE_S`.
- **One shared rules package:** job data, ability effects, the engine, the brain and the simulation live in `@sg2/shared`. The server, client and bots import them and never copy them.
- **Scale and bandwidth stay where Plan 3 left them:**
  - 100 adventurers per zone room at `TICK_HZ = 15`;
  - zone tick p95 ≤ 15 ms;
  - peak RSS ≤ 400 MB;
  - per-client receive ≤ 11.5 KiB/s with 100 walkers clustered within 15 m, and no more than +0.5 KiB/s over the Plan 3 numbers in `docs/load-test.md` for the same runs;
  - the new state fields change only on events (a job change, a cast start or end, a buff on or off).
- **Phone-first:**
  - every touch control is at least 48 px (ability buttons 64 px);
  - the job board is a full-screen sheet on phones, with 56 px job rows;
  - ally focus is a tap on another adventurer;
  - no ground aiming: every area effect centres on the caster or on the target.
- **Desktop keys:**
  - 1–5 for abilities;
  - `J` for the job board;
  - `L` for picks;
  - `F` to cycle ally focus;
  - Tab, Shift and Esc as in Plan 3.

  `Q` (the weapon swap) is removed.
- **Names:**
  - ability, trait and reaction names are original or plain English words;
  - "White Mage" and "Black Mage" are the owner's job names and stay for now, but they may be renamed before public release, so job names come only from `JOBS[id].name` and are never hard-coded in UI text;
  - glyphs are 1–2 characters, unique, and never emoji (no code point ≥ U+1F000, and no U+FE0F).
- **Art:**
  - everything is built in code, flat-shaded low-poly with toon lighting, in `PALETTE` colours;
  - no asset files;
  - a weapon model is recognisable at the default camera distance on a phone.
- **Persistence:**
  - `JobsSave` is saved with the adventurer, together with Plan 3's health, zone and position;
  - every Plan 3 save loads: a Blade loadout becomes the Warrior, and a Bow loadout becomes the Ranger.
- **Everything from Plans 1–3 keeps working:**
  - accounts, travel, reconnect and relog carry, death and respawn;
  - interest views, fall damage and tap-to-walk;
  - Docker packaging.

  Root `npm test` stays green with pristine output. `npm run build` (the offline demo) stays the combat-free town, and `npm run build:online` gets everything.
- **Out of scope** (design so it slots in, but do not build):
  - talents, outfits, gear, the level curve and level-gated abilities (Plan 5);
  - parties and party-only targeting (Plan 4);
  - the unlockable jobs, beyond their data hooks;
  - sanctuaries in the Greenway;
  - player debuffs from enemies. White Mage's cleanse is a hook on an empty set.
- **Environment:**
  - no secrets in the repository;
  - never touch anything outside the repository: no global installs, no system services, no killing processes the task did not start;
  - Playwright is pre-installed, so never install it.
- **Browser checks:**
  - headless WebGL runs at about 1 fps, so measure game time, not wall time;
  - open pages with `?lockq`;
  - Tasks 7, 8 and 9 are browser-heavy, and only one of them may run at a time;
  - local test servers use ports 2571–2579 with `SG2_STORE=memory`, are started in the background with their PID recorded, and are stopped with `kill <pid>`. Never use `fuser` or kill by name. `smoke.mjs` gets `--kill "kill <pid>"`;
  - the standard local server command (fill in the port) is:
    ```
    SG2_STORE=memory SG2_AUTH_RATE_PER_MIN=1000 SG2_PORT=<port> SG2_JWT_SECRET=local-test-secret-0123456789abcdef npx tsx server/src/index.ts
    ```
- **Git:**
  - TDD: write the failing test first;
  - stage explicit paths only (`git add <paths>`, never `-A` or `.`);
  - every commit message ends with exactly these two lines:
    ```
    Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01YDaH79F8gHUx42PWzrB3f9
    ```
  - no model names anywhere else.

## Task order and parallelism

| Task | Depends on | May run in parallel with | Browser-heavy |
|---|---|---|---|
| 1 Shared job, ability, element and XP data | — | — | no |
| 2 Engine I: effects, casting, allies, jobs | 1 | 5 | no |
| 3 Engine II: elements, reactions, enemy debuffs, traits on the enemy side | 2 | 5 | no |
| 4 Job-aware brain and the job/duo simulation bands | 3 | 6 | no |
| 5 Zones (town, sanctuaries, Guild Board spot), store, migration | 1 | 2, 3 | no |
| 6 Server: jobs in the room, saves, XP, messages, state | 3, 5 | 4 | no |
| 7 Client I: job board, HUD, ally focus, casting controls | 6 (and 4 for final numbers) | — | **yes** |
| 8 Client II: weapon models, spell and support effects | 7 | — | **yes** |
| 9 Bots with mixed jobs, the smoke test, the 100-adventurer runs | 4, 8 | — | **yes** (smoke) |
| 10 Docs: outcome placeholder, roadmap correction, verification list | 9 | — | no |

Only Task 4 may change balance numbers (ability coefficients, cooldowns, amounts, auto coefficients) after Task 1, and only under the Tuning rule. Task 2 and Task 3 implement the rules exactly as written. They report numbers but do not tune.

## Numbers

All new constants live in `shared/src/combat/constants.ts`, in a section headed `// ───────── jobs and magic ─────────`, unless a row says otherwise. Plan 3's constants are unchanged.

**Casting**

| Constant | Value | Meaning |
|---|---|---|
| `CAST_MOVE_SCALE` | 0.5 | run-speed scale while casting, from `CHARGE_SLOW_GRACE_S` into the cast |
| `CAST_RANGE_SLACK` | 2 m | extra range at the end of a cast (beyond `range + RANGE_FUZZ`) |
| `CAST_BREAK_LOCK_S` | 1.5 | cooldown given to a spell whose cast was interrupted |
| `ALLY_RANGE` | 18 m | default range of ally-aimed abilities |

A cast is checked when it starts: cooldown, GCD, Momentum ≥ cost, target or ally, range and sight. The GCD starts then. Autos pause for the whole cast. The cast ends one of five ways:
1. **Completion.** The target or ally is re-checked (alive, within `range + RANGE_FUZZ + CAST_RANGE_SLACK`, in sight). An aimed ally who is gone is re-picked by the aim rule. Then: the cost is spent, the cooldown starts, the effects apply, a `use` fx is sent, and a `castEnd { ok: true }`.
2. **Fizzle.** The re-check fails: no cost and no cooldown; `castEnd { ok: false, reason: 'fizzle' }`.
3. **Own dodge.** It cancels the cast with no cooldown; reason `'dodge'`.
4. **Interrupt.** A knockback, or an enemy **telegraph** hit that lands on hp or shield (not a miss or a parry, and not an enemy auto). The spell gets `CAST_BREAK_LOCK_S` of cooldown; reason `'interrupt'`.
5. **Death.** Reason `'cancel'`.

While casting:
- any ability press → `'busy'`;
- `target` intents are accepted, but do not change the cast's target.

Instant abilities (`cast` absent or 0) behave exactly as in Plan 3.

**Elements, marks and reactions**

- `ElementId = 'fire' | 'water' | 'lightning' | 'earth'`. Only Staff spells carry an element. White Mage's Light spells carry none (`school: 'light'`, cosmetic only).
- `MarkId` adds `'rooted'` and `'dazed'`. `MARK_BITS` becomes soaked 1, burning 2, marked 4, rooted 8, dazed 16.
  - **Rooted:** while it lives, the enemy moves at `ROOTED_SPEED_SCALE = 0.6`. Ruling P3b-c (no perma-kite): Rooted is never refreshed while it lives; once it ends (expiry or detonation) the enemy cannot be Rooted again for `ROOT_IMMUNE_S = 6`; on an elite it lasts `MARK_S × ELITE_ROOT_MULT` (`ELITE_ROOT_MULT = 0.5`). A Rooted hit on a blocked enemy still deals its damage, with no mark.
  - **Dazed:** no effect of its own; it exists to be detonated or reacted with.
- **Primers** (`primer: true`): a non-finisher that sets or refreshes its mark **without** detonating anything. Only finishers detonate (Plan 3 rule).
- **Weakness:**
  - `ELEMENT_WEAK_MULT = 1.25` and `ELEMENT_RESIST_MULT = 0.75` on elemental damage;
  - in `ENEMY_KINDS`, which gains `weak?` and `resist?`: thornling weak fire, resist water; boar weak water, resist earth; archer weak lightning; mossback weak fire, resist earth; dummy neither.
- **Reactions** (`shared/src/combat/elements.ts`): an elemental damage hit whose target carries a live reacting mark (other than the hit's own mark) consumes that mark and triggers the reaction. If the hit is a finisher, the reaction replaces the plain combo for that mark; the finisher's other marks still detonate as plain combos.

| element of the hit | on mark | reaction (`ReactionId`) | effect |
|---|---|---|---|
| fire | marked | `blast` | `hitDamage(BLAST_COEF = 4.5)` on the target, plus `hitDamage(BLAST_COEF × BLAST_SPLASH_FRAC = 0.5)` to other live enemies within `BLAST_SPLASH_R = 3` m (each with its own defence, break and multipliers: ruling P3b-d); +`COMBO_STAGGER` |
| lightning | soaked | `conduct` | ordinary enemy: stunned `CONDUCT_STUN_S = 1.5` (cancels its wind-up), as Plan 3's parry stun, with the same `PARRY_STUN_IMMUNE_S` immunity. Elite: +`CONDUCT_STAGGER = 20` on top of `COMBO_STAGGER`, and an interruptible wind-up is interrupted (with `INTERRUPT_STAGGER` only when the hit itself interrupts). Damage `hitDamage(COMBO_COEF)` |
| water | burning | `steam` | `hitDamage(COMBO_COEF)`; the Burning DoT ends; every live adventurer within `STEAM_R = 6` m of the target heals `STEAM_HEAL = 12` (a heal by the hitter: `healMult` and Font apply, heal threat as usual) |
| earth | dazed | `bedrock` | `hitDamage(COMBO_COEF)`; every live adventurer within `BEDROCK_R = 6` m of the target gets a `BEDROCK_SHIELD = 15` shield for `BEDROCK_S = 6` s |

Order inside one hit:
1. reaction;
2. the finisher's plain detonations;
3. its own mark (finisher or primer);
4. Momentum, stagger and interrupt (Plan 3).

Each reaction sends `react` fx, and a `mark … on: false` for the consumed mark.

Every reaction adds `COMBO_STAGGER` (it replaces the plain combo for its mark). Splash and area damage (Hearthfall, Barbed Rain, blast) is computed per enemy hit: each enemy's own defence, Break state and weakness or resistance, never the primary target's multiplier (ruling P3b-d).

**Buffs and debuffs**

- `BuffId` (on adventurers) and `BUFF_BITS`: roar 1, aegis 2 (`aegis` or `aegis_ally`), sheltered 4, rain 8, pact 16, mist 32, bloodbond 64.
- `DebuffId` (on enemies) and `DEBUFF_BITS`: blinded 1, weakpoint 2.
- Each buff or debuff has an expiry and a `src` (engine id). A new application of the same id refreshes it, taking the later expiry and the newer src.
- **Shields:** one per adventurer. A new shield replaces the live one when its amount is ≥ the live amount left (else it is ignored), with its own expiry. This covers Bulwark, Dawn Ward, Grave Ward, Mistveil, Bastion Stone and Bedrock.
- **Outgoing damage multiplier** (one product, rounded once by `hitDamage`):
  - ×`BREAK_DAMAGE_MULT` while broken;
  - ×1.2 with roar;
  - ×1.2 with pact;
  - ×`WEAKPOINT_MULT = 1.15` on a weakpoint target;
  - ×`BEHIND_MULT = 1.25` for a Ninja hitting from behind;
  - ×`PINPOINT_MULT = 1.1` for a Ranger hitting a target whose `targetId` is not the Ranger;
  - ×element weakness or resistance;
  - ×`OVERFLOW_MULT = 1.1` on a Black Mage's elemental damage.
  - "Behind" means `dot(facingDir(enemy), unit(attacker − enemy)) < BEHIND_COS = −0.342` (110° off the enemy's front).
- **Damage taken by an adventurer** (`enemyHit(raw, defence, mult)`):
  - `mult` = ×`STEADFAST_TAKEN = 0.85` (Paladin trait), × the lowest of aegis 0.4 or aegis_ally 0.7 (they do not stack);
  - **mist:** enemy autos against the adventurer miss (`miss`, `perfect: false`);
  - **blinded enemy:** its autos miss;
  - **sheltered**, with a live Paladin `src` in the same room: `moved = floor(final × SHELTER_SHARE)`, where `SHELTER_SHARE = 0.5`. The victim takes `final − moved`. The Paladin takes `round(moved × its own taken-mult)` through `hurtAdventurer`. Redirected damage ignores the Paladin's i-frames and never interrupts the Paladin's cast.

**Traits and Momentum flavours** (per job, constants named here)

| job | trait | numbers |
|---|---|---|
| Warrior | **Battle Rhythm**: autos build more Momentum | `RHYTHM_AUTO_MOMENTUM = 15` (instead of `AUTO_MOMENTUM`) |
| Ranger | **Pinpoint**: stronger against a target that is attacking someone else | `PINPOINT_MULT = 1.1` |
| Paladin | **Steadfast**: takes less damage, draws more attention; Momentum from blocking | `STEADFAST_TAKEN = 0.85`, `STEADFAST_THREAT = 1.5` (× all threat it adds; a taunt is Plan 3's formula, then × 1.5), `BLOCK_MOMENTUM = 5` per enemy hit landing on it (hp or shield) |
| Dark Knight | **Crimson Tithe**: ability damage heals; pain builds Momentum | `BLOOD_LIFESTEAL = 0.2` of ability damage dealt (not autos, not Burning) heals it; `BLOOD_MOMENTUM_PER_HP = 1/3` of enemy damage taken (after shields), floored per hit |
| Ninja | **Dusk Slip**: an extra dodge, strikes from behind, Momentum from close calls | `NINJA_DODGE_CHARGES = 3`; `BEHIND_MULT = 1.25` on autos and abilities; `EVASION_PERFECT_MOMENTUM = 25` per perfect dodge (instead of `PERFECT_DODGE_MOMENTUM`) |
| Black Mage | **Overflow**: elemental damage up; finished casts build Momentum | `OVERFLOW_MULT = 1.1`; `OVERFLOW_CAST_MOMENTUM = 10` per completed cast |
| White Mage | **Font**: stronger heals on others; healing builds Momentum; quieter heals | `FONT_HEAL_MULT = 1.2` on heals to others; `FONT_MOMENTUM_PER_HP = 0.5`, at most `FONT_MOMENTUM_CAP = 20` per heal event; heal threat × `FONT_THREAT_MULT = 0.5` |

**Weapons** (`WEAPONS`, `shared/src/combat/abilities.ts`). `WeaponData` loses `bar`; the bar now belongs to the job.

| `WeaponId` | name | job(s) | auto every s | auto coef | auto range |
|---|---|---|---|---|---|
| `blade` | Blade | Warrior | 1.2 | 1.0 | melee |
| `bow` | Bow | Ranger | 1.5 | 1.1 | 18 |
| `sword` | Sword and Shield | Paladin | 1.4 | 1.0 | melee |
| `greatsword` | Greatsword | Dark Knight | 1.8 | 1.05 (Task 4: was 1.2) | melee |
| `daggers` | Twin Daggers | Ninja | 0.9 | 0.5 (Task 4: was 0.6) | melee |
| `staff` | Staff | White Mage, Black Mage | 1.6 | 0.85 (Task 4: was 1.0) | 16 |

**Jobs** (`JOBS`, `shared/src/combat/jobs.ts`)

| `JobId` | name | role | weapon | bar (quick, finisher, signature) | pool (four picks) | solo picks (new-job default) | duo picks (simulation) | dodges | glyph |
|---|---|---|---|---|---|---|---|---|---|
| `warrior` | Warrior | damage | blade | slash, sunder, parry | rallying_roar, skullringer, mend, bulwark | mend, bulwark | skullringer, mend (P3b-h; was rallying_roar, skullringer) | 2 | ⚔ |
| `ranger` | Ranger | damage | bow | snap_shot, pitch_arrow, charged_shot | pinning_shot, field_dressing, sprint, barbed_rain | field_dressing, pinning_shot | pinning_shot, field_dressing | 2 | ➶ |
| `paladin` | Paladin | tank | sword | shield_rap, bright_verdict, aegis | taunt, shelter, kindle, dawn_ward | kindle, dawn_ward | dawn_ward, kindle (Plan 4 ruling P4-g; was shelter, kindle after P3b-h, taunt, shelter before) | 2 | ⛨ |
| `dark_knight` | Dark Knight | hybrid | greatsword | grim_rend, nightfall, crimson_pact | bloodbond, dread_howl, umbral_brand, grave_ward | grave_ward, umbral_brand | bloodbond, umbral_brand | 2 | ♆ |
| `ninja` | Ninja | damage | daggers | crossed_fangs, hamstring, ghost_edge | ashcloud, weak_point, quickstep, mist_form | mist_form, ashcloud | weak_point, ashcloud (Plan 4 ruling P4-g, Ninja part as amended by Task 5: Mist Form failed D5; was ashcloud, mist_form after P3b-h) | 3 | ✕ |
| `white_mage` | White Mage | healer | staff | tidelash, lantern_flare, wellspring | second_dawn, soft_rain, mistveil, sun_mote | soft_rain, sun_mote | second_dawn, soft_rain | 2 | ✙ |
| `black_mage` | Black Mage | damage | staff | cinder_dart, skyfall_arc, hearthfall | kindred_spark, bastion_stone, rootbreak, stormcage | bastion_stone, rootbreak | bastion_stone, rootbreak (P3b-h; was kindred_spark, rootbreak) | 2 | ✺ |

Task 1's data test checks the job glyphs. If one renders as an emoji on the target fonts, use the fallback set ⚔→`W`, ➶→`R`, ⛨→`P`, ♆→`D`, ✕→`N`, ✙→`+`, ✺→`*`. ⚔ is U+2694, which some fonts draw as emoji, so the test forbids U+FE0F after it and the client renders glyphs in a text font (`font-variant-emoji: text`).

**Abilities** (`ABILITIES`). Slot order is quick, finisher, signature, pick, pick. "cast" 0 = instant. Momentum "+n" builds it; "cost" spends it. "aim" is how its subject is found (see below). Every ability's `effects` list is exactly what the effect column says. Plan 3's ten abilities keep their numbers; only their `job` and the move from `role: 'free'` to `'pick'` change. "S" marks a support ability (`support: true`).

| id | name | glyph | job · slot | cast s | cd s | range | Momentum | element / mark | effect | `ai` |
|---|---|---|---|---|---|---|---|---|---|---|
| `slash` | Slash | ⟋ | Warrior 1 | 0 | 4 | melee | +20 | — | damage 1.8 | `damage` |
| `sunder` | Sunder | ✦ | Warrior 2 | 0 | 6 | melee | cost 50 | marked | damage 4.0; stagger 10; interrupts | `finisher` |
| `parry` | Parry | ◈ | Warrior 3 | 0 | 8 | self | — | — | Plan 3 parry (0.6 s) | `never` |
| `rallying_roar` S | Rallying Roar | ⇑ | Warrior pick | 0 | 30 | self | — | — | buff roar 8 s on self and adventurers within 10 m | `buffParty` |
| `skullringer` S | Skullringer | ⊛ | Warrior pick | 0 | 12 | melee | — | dazed (primer) | damage 1.5; stagger 30; interrupts | `interrupt` |
| `mend` | Mend | + | Warrior pick | 0 | 20 | self | — | — | heal self 30 | `selfHeal` |
| `bulwark` | Bulwark | ◆ | Warrior pick | 0 | 18 | self | — | — | shield self 25 for 6 s | `shieldSelf` |
| `snap_shot` | Snap Shot | ↣ | Ranger 1 | 0 | 5 | 18 | +20 | — | damage 2.0 | `damage` |
| `pitch_arrow` | Pitch Arrow | ✷ | Ranger 2 | 0 | 6 | 18 | cost 50 | burning | damage 3.2; stagger 10 | `finisher` |
| `charged_shot` | Charged Shot | ⇶ | Ranger 3 | hold | 7 | 22 | +15·frac | — | Plan 3 charged shot | `charge` |
| `pinning_shot` S | Pinning Shot | ⤓ | Ranger pick | 0 | 10 | 18 | — | rooted (primer) | damage 1.2 | `damage` |
| `field_dressing` S | Field Dressing | ✚ | Ranger pick | 0 | 18 | 18 | — | — | heal aim 25 (aim `ally`) | `allyHeal` |
| `sprint` | Sprint | » | Ranger pick | 0 | 20 | self | — | — | Plan 3 sprint (self, ×1.4 for 4 s) | `never` |
| `barbed_rain` | Barbed Rain | ⋮ | Ranger pick | 0 | 10 | 18 | — | — | damage 1.4 on target and every live enemy within 3 m of it | `damage` |
| `shield_rap` | Shield Rap | ◐ | Paladin 1 | 0 | 5 | melee | +20 | marked (primer) | damage 1.1 (Task 4: was 1.3); stagger 10 | `damage` |
| `bright_verdict` | Bright Verdict | ☼ | Paladin 2 | 0 | 6 | melee | cost 50 | dazed | damage 3.0 (Task 4: was 3.4); stagger 10; interrupts | `finisher` |
| `aegis` | Aegis | ⬡ | Paladin 3 | 0 | 16 | self | — | — | buff aegis 3 s on self (Task 4: was 4 s); buff aegis_ally 4 s on other adventurers within 8 m | `aegis` |
| `taunt` S | Taunt | ! | Paladin pick | 0 | 10 (P3b-f: was 12) | 15 | — | — | Plan 3 taunt on target | `tauntIfNotMe` |
| `shelter` S | Shelter | ⌂ | Paladin pick | 0 | 20 | 12 | — | — | buff sheltered 10 s (P3b-f: was 8 s) on aim (aim `other-ally`), src = Paladin | `shelter` |
| `kindle` S | Kindle | ✧ | Paladin pick | 0 | 14 | 18 | — | — | heal aim 25 (aim `ally`), then heal self 8 (P3b-f: was 10) | `allyHeal` |
| `dawn_ward` S | Dawn Ward | ◎ | Paladin pick | 0 | 22 | self | — | — | shield 20 for 6 s on self and adventurers within 8 m | `shieldParty` |
| `grim_rend` | Grim Rend | ⟍ | Dark Knight 1 | 0 | 4 | melee | +20 | — | hp-cost 3; damage 1.35 (Task 4: was 1.6) | `damage` |
| `nightfall` | Nightfall | ☾ | Dark Knight 2 | 0 | 6 | melee | cost 50 | burning | damage 3.2 (Task 4: was 3.8); stagger 10 | `finisher` |
| `crimson_pact` | Crimson Pact | ⊗ | Dark Knight 3 | 0 | 24 | self | — | — | hp-cost 15; buff pact 6 s on self (×1.2 damage, lifesteal ×2) | `selfBuff` |
| `bloodbond` S | Bloodbond | ∞ | Dark Knight pick | 0 | 20 | self | — | — | buff bloodbond 8 s on self: each lifesteal heal also heals the lowest-hp other adventurer within 15 m by the same amount | `buffParty` |
| `dread_howl` S | Dread Howl | ⁂ | Dark Knight pick | 0 | 20 | self | — | — | taunt every live enemy within 8 m | `tauntIfNotMe` |
| `umbral_brand` | Umbral Brand | ⌖ | Dark Knight pick | 0 | 10 | melee | — | dazed (primer) | damage 1.2 | `damage` |
| `grave_ward` | Grave Ward | ▣ | Dark Knight pick | 0 | 18 | self | — | — | hp-cost 10; shield self 30 for 6 s | `shieldSelf` |
| `crossed_fangs` | Crossed Fangs | ⋎ | Ninja 1 | 0 | 3.5 | melee | +20 | marked (primer) | damage 1.05 (Task 4: was 1.3) | `damage` |
| `hamstring` | Hamstring | ⊻ | Ninja 2 | 0 | 6 | melee | cost 50 | rooted | damage 3.2; stagger 10 | `finisher` |
| `ghost_edge` | Ghost Edge | ⟁ | Ninja 3 | 0 | 10 (Task 4: was 8) | melee | +15 | — | damage 1.8 (Task 4: was 2.4), always counts as from behind | `damage` |
| `ashcloud` S | Ashcloud | ≈ | Ninja pick | 0 | 24 | self | — | — | threat-drop r 6 (the Ninja's threat on each live enemy within 6 m becomes 0); debuff blinded 3 s on each of them | `threatDrop` |
| `weak_point` S | Weak Point | ⊙ | Ninja pick | 0 | 20 | 12 | — | — | debuff weakpoint 10 s (P3b-f: was 8 s) on target | `debuff` |
| `quickstep` | Quickstep | ⇥ | Ninja pick | 0 | 15 | self | — | — | dodge-refill 1 (capped at the job's charges) | `dodgeRefill` |
| `mist_form` | Mist Form | ░ | Ninja pick | 0 | 18 | self | — | — | buff mist 5 s on self | `mist` |
| `cinder_dart` | Cinder Dart | ⟡ | Black Mage 1 | 0 | 4 | 18 | +20 | fire / — | damage 1.2 (Task 4: was 1.5) | `damage` |
| `skyfall_arc` | Skyfall Arc | ϟ | Black Mage 2 | 1.2 | 6 | 18 | cost 50 | lightning / dazed | damage 4.0; stagger 15; interrupts (at completion) | `finisher` |
| `hearthfall` | Hearthfall | ⊚ | Black Mage 3 | 2.5 | 15 | 18 | — | fire / — | damage 4.9 (Task 4: was 5.5) on target, plus 0.5 of it to every other live enemy within 4 m | `damage` |
| `kindred_spark` S | Kindred Spark | ✶ | Black Mage pick | 0 | 20 | 15 | — | — | Momentum +37 (P3b-f: was +30) on aim (aim `other-ally`), +10 on self | `momentumGift` |
| `bastion_stone` S | Bastion Stone | ▲ | Black Mage pick | 1.0 | 18 | 18 | — | earth / — | shield aim 30 for 8 s (aim `ally`) | `shieldAlly` |
| `rootbreak` S | Rootbreak | ⌬ | Black Mage pick | 1.0 | 10 | 18 | — | earth / rooted (primer) | damage 1.3 (Task 4: was 1.6) | `damage` |
| `stormcage` S | Stormcage | ⌗ | Black Mage pick | 0 | 12 | 18 | — | lightning / — | damage 0.8; stagger 20; interrupts | `interrupt` |
| `tidelash` | Tidelash | ∿ | White Mage 1 | 0 | 4 | 18 | +20 | water / soaked (primer) | damage 1.2 (Task 4: was 1.4) | `damage` |
| `lantern_flare` | Lantern Flare | ✺ | White Mage 2 | 1.0 | 6 | 18 | cost 50 | light / marked | damage 3.0 (Task 4: was 3.6); then heal 20 on the lowest-hp adventurer within 18 m (self included) | `finisher` |
| `wellspring` | Wellspring | ❂ | White Mage 3 | 1.5 | 10 (Task 4: was 8) | 18 | — | water / — | heal aim 45 (aim `ally`); cleanse aim (clears `afflictions`, empty until Plan 4) | `allyBigHeal` |
| `second_dawn` S | Second Dawn | ☥ | White Mage pick | 3.0 | 45 (P3b-f: was 60) | 12 | — | light / — | revive aim at 0.4 × maxHp (aim `dead-ally`) | `revive` |
| `soft_rain` S | Soft Rain | ⁘ | White Mage pick | 0 | 20 | self | — | water / — | buff rain 6 s on self and adventurers within 10 m: heals `RAIN_HEAL = 5` (P3b-f: was 4) at each whole second after it starts | `healParty` |
| `mistveil` S | Mistveil | ◌ | White Mage pick | 0 | 15 | 18 | — | water / — | shield aim 30 (P3b-f: was 25) for 6 s (aim `ally`) | `shieldAlly` |
| `sun_mote` | Sun Mote | ✹ | White Mage pick | 0.8 | 10 (Task 4: was 8) | 18 | +15 | light / — | damage 1.8 (Task 4: was 2.2) | `damage` |

`✺` is used twice above: Black Mage's job glyph and Lantern Flare's. Job glyphs and ability glyphs are separate namespaces. The data test checks uniqueness within each.

**Aim rules** (`resolveAim`, `shared/src/combat/effects.ts`):
- `enemy`: Plan 3's `targetFor`. The live enemy target must be within `range + RANGE_FUZZ` and in sight.
- `self`: the caster.
- `ally`:
  - the intent's `ally` id, if it is a live adventurer within `range + RANGE_FUZZ` and in sight;
  - otherwise the live adventurer with the lowest hp/maxHp within range, self included;
  - ties go to self, then to the lower id.
- `other-ally`: as `ally`, with self excluded. If there is none → refusal `'no-ally'`.
- `dead-ally`: the intent's `ally` id, if it is a dead adventurer within `range + RANGE_FUZZ`; otherwise the nearest dead adventurer within range. If there is none → `'no-ally'`.
- **Area** effects (`on: 'area'`, with `r`) count from the caster, include the caster, and need no sight.
- Every adventurer in the zone counts as an ally (no parties before Plan 4).

**Per-job XP stub** (`shared/src/combat/jobXp.ts`):
- `XP_PER_LEVEL = 100` and `JOB_LEVEL_CAP = 10`;
- `levelForXp(xp) = min(JOB_LEVEL_CAP, 1 + floor(xp / XP_PER_LEVEL))`;
- `xpToNext(xp)` is the xp still needed for the next level (0 at the cap);
- `KILL_XP = { thornling: 10, boar: 10, archer: 10, mossback: 40, dummy: 0 }`.

Each credited adventurer's **current** job gains the kill's XP. In 3b, level changes nothing in combat. Plan 5 replaces this curve.

**Unlockable jobs** (data hooks only; `FUTURE_JOBS`, `shared/src/combat/jobs.ts`). Each entry holds an id, a name, a role, a weapon name, an `unlock` quest id, and a `unique` line giving the strong reason to unlock it:
- `monk`: weapon fists; "never disarmed; breaks stagger fastest"; quest `greenway_monk`.
- `bard`: weapon lute; "songs boost the whole party and stack with everything"; quest `normandy_bard`.
- `beastmaster`: weapon whip; "fights beside a tamed creature; the best solo job; taming is a collection game"; quest `first_taming`.
- `sky_lancer`: weapon spear; "reaches flying enemies and crosses gaps"; quest `reach_the_islands`.

None of them is a `JobId`. A `JobsSave` keeps a stored record under a future id unchanged, but such an id can never be `current`.

### Why these numbers give the bands

Reference: damage = `round(10 · coef · mitigation)`. Against a Thornling (mitigation 0.870), coef c deals about 8.7c. "cps" below is sustained coefficient per second, with each job's own solo combos and traits included.

| job (solo picks) | cps vs Thornling, roughly | expected TTK Thornling | expected TTK Mossback (careful) | sustain over a Mossback fight (≈ 2.5 hp/s of autos taken) |
|---|---|---|---|---|
| Warrior (mend, bulwark) | 1.95 + rhythm → finishers sooner | ≈ 11.5 s | ≈ 48 s | Mend + Bulwark ≈ 160 (Plan 3) |
| Ranger (field dressing, pinning) | ≈ 2.2 | ≈ 12.0 s (Plan 3) | ≈ 46 s | 25 every 18 s ≈ 70, plus Rooted slows the chase |
| Paladin (kindle, dawn ward) | 0.71 + 0.26 + 0.57 + combo 0.5 ≈ 2.04 | ≈ 13 s | ≈ 55 s | ×0.85 taken, Aegis 25% of the time, Kindle 35/14 s, Ward 20/22 s |
| Dark Knight (grave ward, brand) | 0.67 + 0.4 + 0.63 + Burning 0.2 + brand 0.12 + combo 0.3, ×1.05 pact ≈ 2.44 | ≈ 11 s | ≈ 46 s | lifesteal ≈ 2 hp/s − Rend 0.75 hp/s; Grave Ward nets +20 per 18 s |
| Ninja (mist form, ashcloud) | 0.67 + 0.37 + 0.53 + 0.3 + combo 0.5 ≈ 2.37 | ≈ 11 s | ≈ 46 s | Mist 5/18 s and Blind 3/24 s remove ≈ 40% of autos |
| Black Mage (bastion, rootbreak) | autos halved by casting ≈ 0.33 + 0.38 + 0.67 + 0.37 + 0.16 + combo 0.4, ×1.1 overflow (+ fire weakness on Thornlings) ≈ 2.5–2.7 | ≈ 10.5 s | ≈ 42 s | Bastion 30/18 s ≈ 80 |
| White Mage (soft rain, sun mote) | autos ≈ 0.40 + 0.35 + 0.6 + 0.28 + combo 0.5 ≈ 2.13 | ≈ 12.5 s | ≈ 52 s | Wellspring 45/8 s when hurt; Rain 24/20 s |

The median is about 11.5 s for a Thornling, so ±25% gives [8.6, 14.4]. For the Mossback it is about 46 s, giving [34.5, 57.5].

**Duos:**
- Each job's duo picks include a support that reaches the partner.
- Every job has a primer whose mark differs from its finisher's mark. So in every pair, mirror pairs included, each member's finisher always has a partner mark to detonate.
- Mages add reactions in mixed pairs:
  - White Mage's Tidelash (Soaked), then Black Mage's Skyfall Arc → **conduct**;
  - Black Mage's Cinder Dart on a Warrior's, Paladin's or Ninja's Marked → **blast**;
  - White Mage's Tidelash on Ranger's or Dark Knight's Burning → **steam** heals;
  - Black Mage's Rootbreak on Paladin's or Warrior's Dazed → **bedrock** shields.
- The Mossback scales ×1.7 hp for two engaged adventurers (Plan 3 ruling P3-e). Two jobs at about 2.2 cps each against mitigation 0.727 deal about 32 per second, which is about 40 s for 1275 hp.
- White Mage + White Mage at about 2.1 cps each is about 42–50 s: slow but viable.

What each job brings a partner:

| job | brings |
|---|---|
| Warrior | +20% damage (Roar); stagger and interrupts (Skullringer); fast Momentum, so many finisher detonations |
| Ranger | slows (Rooted); a ranged heal (Field Dressing); keeps hitting from range while the partner holds the enemy (Pinpoint) |
| Paladin | holds attention (Taunt, Steadfast ×1.5 threat); takes half the partner's hits (Shelter); party damage cut (Aegis); party shields (Dawn Ward) |
| Dark Knight | shares stolen health (Bloodbond); area taunt (Dread Howl); durable front line |
| Ninja | +15% damage for everyone on the target (Weak Point); blinds and sheds attention (Ashcloud); strikes from behind while the partner holds the front |
| Black Mage | +30 Momentum to the partner (Kindred Spark); interrupts (Stormcage); shields (Bastion Stone); slows (Rootbreak); reactions |
| White Mage | revive in the fight (Second Dawn); party heal over time (Soft Rain); big heals (Wellspring); shields (Mistveil); reactions (Soaked) |

**Task 4 measured bands, after review round 1** (careful unless stated; solo seeds 1–5, duo seeds 1–3, D3 and D5 seeds 1–10; full tables in the Task 4 report). Solo mean TTK, s:

| job | Thornling | Boar | Archer | Mossback |
|---|---|---|---|---|
| Warrior | 12.4 | 11.1 | 13.2 | 61.6 |
| Ranger | 8.9 | 8.8 | 8.9 | 38.6 |
| Paladin | 11.2 | 11.0 | 11.3 | 57.1 |
| Dark Knight | 10.6 | 10.1 | 9.7 | 46.7 |
| Ninja | 11.3 | 9.3 | 10.7 | 48.4 |
| White Mage | 12.3 | 9.7 | 12.3 | 55.8 |
| Black Mage | 10.4 | 10.5 | 11.4 | 50.8 |
| median of the five new jobs | 11.2 | 10.1 | 11.3 | 50.8 |

Careless Mossback, solo: Paladin and White Mage survive at a mean of 45 and 38 hp; every other job dies 5 of 5. Duos: all 28 pairs win every careful seed with no deaths; Mossback mean TTK 28–45 s, Paladin + Paladin 55.0 s, White Mage + White Mage 58.9 s. A careless duo loses 26 of 84 Mossback fights.

**Rulings:**
- **P3b-e (Ranger floor):** the Ranger's Pinning Shot primer gives Pitch Arrow a Plan 3 combo no allowed number removes, so the Ranger's ordinary bands are a mean in [8.5, 15] s. Plan 3's Bow tests are unchanged.
- **P3b-f:** support is not the lever for solo bands. Support numbers are restored and raised: Soft Rain 5 a second, Mistveil 30, Kindred Spark +37, Weak Point 10 s, Taunt cd 10, Shelter 10 s, Second Dawn cd 45. Kindle's self heal is cut 10 → 8. S3 for the White Mage and the Paladin is "dies, or ends at mean hp ≤ 60".
- **P3b-g:** the 25%-of-median rule (S1, S2) uses the median of the five new jobs. The Warrior and the Ranger are held to their Plan 3 bands (and P3b-e).
- **P3b-h:** duo picks are one team pick and one sustain pick. A job's only primer is kept where dropping it would leave a mirror pair with nothing to detonate: the Warrior's Skullringer, the Dark Knight's Umbral Brand and the Black Mage's Rootbreak.
- **P3b-i:** D5 gate (1) is "deaths ≤ solo picks, and wins ≥ solo picks − 3 of 280".

**D5, the synergy check:** each pair plays its duo picks, then its solo picks, both normally. The brain is careful but sloppy: it misses a seeded 30% of the telegraphs it would dodge. The fight is the Mossback plus two Thornlings, with killed enemies staying dead, over 10 seeds. Measured over the 28 pairs: 260 wins against 261 and 59 deaths against 63. No pair is more than 2 wins worse (Warrior + Ninja 7 against 9). On the median pair, careful play kills no slower on duo picks.

**The simulation alternates who acts first each tick** in job mode (simultaneous intents arrive in any order on a server). Without it, mirror pairs act in lockstep and always detonate their own marks. Plan 3 parties keep their fixed order.

**Deferred to live tuning:** duo picks are not yet clearly stronger than solo picks in survival, and the Ninja's and the Black Mage's duo defaults equal their solo defaults.

**Tuning rule (Task 4 only):** if a band fails, change only:
- the new jobs' ability `coef`, `cooldown`, heal or shield `amount` and buff duration, each within ±25% of the table;
- the new weapons' `autoCoef`, within ±20%;
- `ELEMENT_WEAK_MULT` and `ELEMENT_RESIST_MULT`, within ±0.1.

Never change:
- Plan 3 formulas or enemy numbers;
- the Warrior's and Ranger's bar abilities (Plan 3's Blade and Bow numbers anchor the bands);
- Plan 3 constants.

Record every change, with before and after, in the task report and in Task 10's Outcome.

## Review Focus

1. **Job switch outside a town.** Each of these is refused, with `refused { action: 'job', reason }`, and nothing changes (job, slots, Momentum, cooldowns, save):
   - a forged `job` message in the Greenway;
   - one in the grove while in combat, dead, casting, charging or mid-dodge;
   - one during travel;
   - one naming a future job or an unknown id;
   - 30 of them a second (the intent bucket).

   → Tasks 2, 6, 9.
2. **Abilities validated against the current job:**
   - after a job change, slot k is the new job's ability;
   - `loadout { picks }` naming another job's ability, a duplicate, a bar ability or an unknown id → `'invalid'`;
   - changing job and changing back never resets a cooldown (cooldowns are kept per id) and never keeps Momentum (reset to 0).

   → Tasks 2, 6.
3. **Cast exploits.** Each of these is handled with no cost, no cooldown and no stuck state (fizzle or `'busy'`):
   - starting a cast and then walking out of range or behind a wall;
   - the target dying mid-cast;
   - pressing during a cast;
   - `release` during a cast;
   - a relog mid-cast (the cast is dropped and costs nothing);
   - a job change mid-cast (refused `'busy'`).

   Movement while casting at 0.5× is never corrected.

   → Tasks 2, 6, 7.
4. **Support abuse.** Each is a fizzle or `'no-ally'`:
   - reviving yourself (the dead cannot cast);
   - reviving someone who has already respawned in the grove (gone from this room);
   - Shelter on yourself;
   - Shelter whose Paladin dies or leaves (it stops redirecting at once);
   - Kindred Spark with nobody near;
   - healing an enemy (impossible: aims never pick enemies).

   → Tasks 2, 3.
5. **Saves.** These all load without errors and keep their job choice:
   - Plan 3 rows with `{"weapon":"blade","free":["mend","bulwark"]}`;
   - `{"weapon":"bow","free":["taunt","sprint"]}`;
   - garbage JSON;
   - a `jobs` record with a picked ability from the wrong job.

   XP is per job, and a switch keeps each job's picks.

   → Tasks 1, 5, 6.
6. **Bandwidth.** The new state fields change only on events. The clustered 100-walker run is ≤ 11.5 KiB/s per client. → Tasks 6, 9.

---

### Task 1: Shared job, ability, element and XP data

**Files:**
- Create in `shared/src/combat/`:
  - `jobs.ts`;
  - `elements.ts`;
  - `jobXp.ts`;
  - `jobs.test.ts`.
- Modify:
  - `shared/src/combat/abilities.ts`;
  - `shared/src/combat/marks.ts`;
  - `shared/src/combat/enemies.ts` (`weak?`, `resist?`);
  - `shared/src/combat/constants.ts`;
  - `shared/src/combat/fx.ts`;
  - `shared/src/combat/index.ts`.
- Update to the new shapes (no behaviour change): `shared/src/combat/data.test.ts` and `shared/src/combat/rules.test.ts`.

**Interfaces:**
- Produces, exactly as under Numbers:
```ts
// abilities.ts
export type WeaponId = 'blade' | 'bow' | 'sword' | 'greatsword' | 'daggers' | 'staff';
export type AbilityId = /* the 49 ids of the Abilities table */;
export type Aim = 'enemy' | 'self' | 'ally' | 'other-ally' | 'dead-ally';
export type BuffId = 'roar' | 'aegis' | 'aegis_ally' | 'sheltered' | 'rain' | 'pact' | 'mist' | 'bloodbond';
export type DebuffId = 'blinded' | 'weakpoint';
export const BUFF_BITS: Record<BuffId, number>;      // aegis and aegis_ally both 2
export const DEBUFF_BITS: Record<DebuffId, number>;
export type Effect =
  | { k: 'damage'; coef: number; splash?: { r: number; frac: number }; behind?: true }
  | { k: 'heal'; amount: number; on: 'aim' | 'self' | 'lowest' }               // lowest: lowest-hp adventurer within ALLY_RANGE, self included
  | { k: 'shield'; amount: number; s: number; on: 'aim' | 'self' | 'area'; r?: number }
  | { k: 'buff'; buff: BuffId; s: number; on: 'aim' | 'self' | 'area' | 'others'; r?: number } // others: area without the caster
  | { k: 'debuff'; debuff: DebuffId; s: number; on: 'target' | 'area'; r?: number }   // area: live enemies within r of the caster
  | { k: 'momentum'; amount: number; on: 'aim' | 'self' }
  | { k: 'taunt'; on: 'target' | 'area'; r?: number }
  | { k: 'threat-drop'; r: number }
  | { k: 'revive'; frac: number }
  | { k: 'hp-cost'; amount: number }
  | { k: 'dodge-refill'; charges: number }
  | { k: 'parry'; s: number }
  | { k: 'sprint'; scale: number; s: number }
  | { k: 'charge' }
  | { k: 'cleanse' };
export type AiUse = 'damage' | 'finisher' | 'charge' | 'never' | 'selfHeal' | 'allyHeal' | 'allyBigHeal' | 'healParty'
  | 'shieldSelf' | 'shieldAlly' | 'shieldParty' | 'buffParty' | 'selfBuff' | 'aegis' | 'revive' | 'tauntIfNotMe'
  | 'interrupt' | 'threatDrop' | 'momentumGift' | 'debuff' | 'dodgeRefill' | 'mist' | 'shelter';
export interface AbilityData {
  id: AbilityId; name: string; glyph: string; desc: string; job: JobId;
  role: 'quick' | 'finisher' | 'signature' | 'pick'; kind: 'damage' | 'heal' | 'defence' | 'utility';
  aim: Aim; needsTarget: boolean;              // === (aim === 'enemy')
  cooldown: number; range: number;             // 0 = self, MELEE_REACH = melee
  cast?: number; element?: ElementId; school?: 'light';
  momentum?: number; cost?: number; mark?: MarkId; primer?: true; stagger?: number; interrupts?: boolean;
  effects: readonly Effect[]; support?: true; ai: AiUse;
}
export const ABILITIES: Record<AbilityId, AbilityData>;
export interface WeaponData { id: WeaponId; name: string; autoEvery: number; autoCoef: number; autoRange: number }
export const WEAPONS: Record<WeaponId, WeaponData>;
export interface Loadout { job: JobId; picks: [AbilityId, AbilityId] }
export const DEFAULT_LOADOUT: Loadout;                       // { job: 'warrior', picks: ['mend', 'bulwark'] }
export function slotsFor(l: Loadout): AbilityId[];           // [...JOBS[l.job].bar, ...l.picks]
export function parseLoadout(v: unknown): Loadout | null;    // the new shape: picks = 2 distinct ids of JOBS[job].pool
export function legacyLoadout(v: unknown): Loadout | null;   // Plan 3 { weapon, free }: blade → warrior, bow → ranger; free kept if both are in that job's pool, else the job's solo picks
// keep the Plan 3 exports PARRY_WINDOW_S, MEND_HEAL, BULWARK_ABSORB, BULWARK_S, SPRINT_SCALE, SPRINT_S, TAUNT_RANGE,
// CHARGE_FULL_S, CHARGE_MAX_S, CHARGE_MOVE_SCALE, CHARGE_INTERRUPT_FRAC, chargedShot; FREE_POOL is removed.
// jobs.ts
export type JobId = 'warrior' | 'ranger' | 'paladin' | 'dark_knight' | 'ninja' | 'white_mage' | 'black_mage';
export type FutureJobId = 'monk' | 'bard' | 'beastmaster' | 'sky_lancer';
export type RoleTag = 'damage' | 'tank' | 'healer' | 'hybrid';
export type TraitId = 'battle_rhythm' | 'pinpoint' | 'steadfast' | 'crimson_tithe' | 'dusk_slip' | 'overflow' | 'font';
export interface JobData {
  id: JobId; name: string; glyph: string; role: RoleTag; weapon: WeaponId;
  bar: readonly [AbilityId, AbilityId, AbilityId]; pool: readonly [AbilityId, AbilityId, AbilityId, AbilityId];
  picks: { solo: readonly [AbilityId, AbilityId]; duo: readonly [AbilityId, AbilityId] };
  trait: { id: TraitId; name: string; desc: string };
  dodgeCharges: number; brain: { flank: boolean };       // flank: Ninja moves behind a target that is attacking someone else
  unlock: { kind: 'start' } | { kind: 'quest'; quest: string };
}
export const JOBS: Record<JobId, JobData>;
export const JOB_IDS: readonly JobId[];                  // table order
export function isJobId(v: unknown): v is JobId;
export interface FutureJobData { id: FutureJobId; name: string; role: RoleTag; weaponName: string; unique: string; unlock: { kind: 'quest'; quest: string } }
export const FUTURE_JOBS: Record<FutureJobId, FutureJobData>;
export interface JobRecord { level: number; xp: number; picks: [AbilityId, AbilityId]; talents: string[]; outfit: null }
export interface JobsSave { current: JobId; jobs: Partial<Record<JobId | FutureJobId, JobRecord>> }
export function newJobsSave(job?: JobId): JobsSave;      // current job with a fresh record (level 1, xp 0, solo picks)
export function recordFor(s: JobsSave, job: JobId): JobRecord;          // the stored record, or a fresh one (not stored)
export function parseJobsSave(v: unknown, legacy?: unknown): JobsSave;  // never throws; see rules
export function isJobsSave(v: unknown): v is JobsSave;                  // strict: what saves must pass
export function loadoutOf(s: JobsSave): Loadout;                         // { job: current, picks: recordFor(...).picks }
// elements.ts
export type ElementId = 'fire' | 'water' | 'lightning' | 'earth';
export type ReactionId = 'blast' | 'conduct' | 'steam' | 'bedrock';
export const REACTIONS: Record<ElementId, { mark: MarkId; reaction: ReactionId }>;  // fire→marked blast, lightning→soaked conduct, water→burning steam, earth→dazed bedrock
export function reactionFor(element: ElementId | undefined, liveMarks: readonly MarkId[], ownMark?: MarkId): ReactionId | null;
export function elementMult(element: ElementId | undefined, kind: EnemyKindData): number;   // 1, ELEMENT_WEAK_MULT or ELEMENT_RESIST_MULT
// marks.ts
export type MarkId = 'soaked' | 'burning' | 'marked' | 'rooted' | 'dazed';
export function applyPrimerMark(marks: Marks, mark: MarkId, nowS: number): void;  // set/refresh, no detonation
// jobXp.ts
export const XP_PER_LEVEL = 100; export const JOB_LEVEL_CAP = 10;
export const KILL_XP: Record<EnemyKindId, number>;
export function levelForXp(xp: number): number; export function xpToNext(xp: number): number;
export function addJobXp(s: JobsSave, job: JobId, xp: number): { save: JobsSave; level: number; levelUp: boolean }; // pure, returns a copy
// fx.ts additions
  | { t: 'cast'; src: number; ability: AbilityId; dst?: number; total: number }
  | { t: 'castEnd'; src: number; ability: AbilityId; ok: boolean; reason?: 'fizzle' | 'dodge' | 'interrupt' | 'cancel' }
  | { t: 'react'; src: number; dst: number; reaction: ReactionId }
  | { t: 'buff'; src: number; dst: number; buff: BuffId | DebuffId; on: boolean }
  | { t: 'shield'; src: number; dst: number; amount: number }
  | { t: 'gift'; src: number; dst: number; amount: number }
  | { t: 'revive'; src: number; dst: number; hp: number }
// and 'hit' gains element?: ElementId, behind?: true; 'miss' gains why?: 'dodge' | 'mist' | 'blind'
```
- **`parseJobsSave` rules:**
  - with a valid `v`, keep each valid record; fix the bad parts per record:
    - non-integer, negative or non-finite xp → 0;
    - level = `levelForXp(xp)` always (level is derived, never trusted);
    - picks invalid for that job → its solo picks;
    - non-array talents → [];
    - outfit → null;
  - an unknown key → dropped; a future job key → kept;
  - an invalid `current` → `'warrior'`;
  - when `v` is not an object or has no valid current, and `legacy` passes `legacyLoadout`, build the save from it;
  - otherwise `newJobsSave()`.
- `isJobsSave` accepts exactly what `parseJobsSave` would return unchanged.

- [ ] **Step 1: Write the failing tests.**
  - In `jobs.test.ts`:
    - `describe('job data')`:
      - `it('has the seven starting jobs in table order')`;
      - `it('every ability belongs to exactly one job, in its bar or its pool')`: the union of bars and pools equals the keys of `ABILITIES`, with no id twice, and `ABILITIES[id].job` matches;
      - `it('every bar is quick, finisher, signature')`: quick has `momentum > 0` and no cost; finisher has `cost === FINISHER_COST`, a `mark` and no `primer`;
      - `it('every job has a primer whose mark differs from its finisher mark, in its bar or its duo picks')`;
      - `it('solo and duo picks are two distinct pool ids')`;
      - `it('each job has at least two support abilities, and its duo picks hold at least one')`;
      - `it('glyphs are 1–2 characters, unique per namespace, never emoji')`;
      - `it('only Staff jobs carry elements; every element has a reaction')`;
      - `it('Ninja has 3 dodge charges, all others 2')`;
      - `it('future jobs are data only')`: no `FutureJobId` is in `JOB_IDS`, and each has a non-empty `unique` and a quest;
    - `describe('loadouts')`:
      - `parseLoadout` accepts `{ job: 'ninja', picks: ['ashcloud', 'mist_form'] }` and rejects a pick from another job, a bar ability, duplicates, an unknown job and the old shape;
      - `legacyLoadout({ weapon: 'blade', free: ['mend', 'bulwark'] })` → warrior with `['mend', 'bulwark']`;
      - `legacyLoadout({ weapon: 'bow', free: ['taunt', 'sprint'] })` → ranger with `['field_dressing', 'pinning_shot']`;
      - `slotsFor(DEFAULT_LOADOUT)` → `['slash', 'sunder', 'parry', 'mend', 'bulwark']`;
    - `describe('jobs save')`:
      - garbage → `newJobsSave()`;
      - the legacy bow → current ranger;
      - a record with xp 250 and level 1 reads level 3;
      - wrong-job picks → solo picks;
      - a future-job record is kept, but `current: 'monk'` → `'warrior'`;
      - `isJobsSave(parseJobsSave(x))` holds for 200 seeded random inputs;
    - `describe('xp')`:
      - `levelForXp(0) === 1`, `(99) === 1`, `(100) === 2`, `(5000) === 10`;
      - `xpToNext(950) === 0`;
      - `addJobXp` returns `levelUp: true` crossing 100, and never mutates its input;
    - `describe('elements')`:
      - `reactionFor('fire', ['marked'])` → `'blast'`;
      - `reactionFor('fire', ['marked'], 'marked')` → null;
      - `reactionFor(undefined, ['soaked'])` → null;
      - `elementMult('fire', ENEMY_KINDS.thornling) === 1.25`, `('water', thornling) === 0.75`, `('fire', dummy) === 1`;
      - `MARK_BITS` holds rooted 8 and dazed 16, and `applyPrimerMark` never removes another mark.
  - Update `data.test.ts`, keeping its intent:
    - weapons: six weapons, each with `autoRange > 0`;
    - `ENEMY_KINDS` rules unchanged, plus the `weak` and `resist` values above;
    - remove the `FREE_POOL` and `weapon` assertions.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL** (modules and exports missing).
- [ ] **Step 3: Implement.**
  - Keep Plan 3 ability numbers byte-for-byte.
  - `adventurer.ts` and the client still import `FREE_POOL` and `WEAPONS[w].bar` until Tasks 2 and 7. For this task only, keep `export const FREE_POOL = JOBS.warrior.pool` and a deprecated `WEAPON_BARS: Record<'blade' | 'bow', readonly AbilityId[]>`, so that `tsc` stays clean; Task 2 deletes both.
  - `newAdventurer` keeps reading Plan 3 loadouts through `parseLoadout(v) ?? legacyLoadout(v)`.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: job, ability, element and job-xp data for the seven starting jobs`.

### Task 2: Engine I: effects, casting, allies and jobs

**Files:**
- Create:
  - `shared/src/combat/effects.ts` (`resolveAim`, `applyEffects`, shields, buffs, heals, revive, hp-cost);
  - `shared/src/combat/casting.ts` (start, complete, break, `castView`);
  - `shared/src/combat/jobsEngine.test.ts`;
  - `shared/src/combat/casting.test.ts`.
- Modify:
  - `shared/src/combat/engine.ts`;
  - `shared/src/combat/adventurer.ts`;
  - `shared/src/combat/index.ts`;
  - `shared/src/combat/engine.test.ts` and `shared/src/combat/engineReview.test.ts`: swap tests are removed; loadouts become `{ job, picks }`; everything else keeps its assertions.

**Interfaces:**
- Consumes: Task 1.
- Produces (changes to the Plan 3 engine API):
```ts
export interface CombatZone { surface; ground; sight; camps; jobSwitch?: (x: number, z: number) => boolean } // absent = never
export type Act = '' | 'charge' | 'cast' | 'dodge' | 'knock' | 'stun' | 'dead' | 'return';
export interface CombatantView { /* Plan 3 fields */ job?: JobId; buffs: number; debuffs: number;
  cast: { ability: AbilityId; total: number; left: number } | null }       // buffs: adventurers (BUFF_BITS); debuffs: enemies (DEBUFF_BITS)
export interface SelfView { /* Plan 3 fields minus swapCd and swapLock */ job: JobId; dodgeMax: number;
  cast: { ability: AbilityId; total: number; left: number } | null }
export type Intent =
  | { t: 'target'; id: number | null }
  | { t: 'ability'; slot: number; phase: 'press' | 'release'; ally?: number }
  | { t: 'dodge'; dx: number; dz: number; from: { x: number; z: number; y: number }; grounded: boolean }
  | { t: 'loadout'; picks: [AbilityId, AbilityId] }
  | { t: 'job'; job: JobId; picks: [AbilityId, AbilityId] };
export type Refusal = /* Plan 3 */ | 'not-here' | 'no-ally';
export interface TickOut { fx; displaced; died; kills; revived: { id: number; by: number; hp: number }[] }
export interface Combat { /* Plan 3, plus: */ loadout(id: number): Loadout | undefined /* new shape */ }
```
- **Job intent:** checks run in this order:
  1. dead → `'dead'`;
  2. displaced, casting or charging → `'busy'`;
  3. unknown job, or picks not two distinct ids of its pool → `'invalid'`;
  4. in combat → `'in-combat'`;
  5. `!zone.jobSwitch?.(a.x, a.z)` → `'not-here'`.

  On accept:
  - loadout and slots change;
  - Momentum becomes 0;
  - cooldowns are kept per id;
  - dodge charges become `min(charges, JOBS[job].dodgeCharges)`, refilling toward the new maximum;
  - the target is kept;
  - no fx.
- **Loadout intent:** as in Plan 3 (`'busy'`, `'invalid'`, `'in-combat'`), against the current job's pool. It has no zone check.
- **Abilities:**
  - `abilityIntent` resolves the aim (Numbers) after the cooldown and Momentum checks;
  - `'no-ally'` comes from the aim;
  - instant abilities apply `applyEffects` at once;
  - casts follow Numbers → Casting;
  - Charged Shot and Parry keep their Plan 3 behaviour through the `charge` and `parry` effects.
- **Effects** apply in list order:
  - `damage` goes through Plan 3's `strike` (Task 3 adds elements, reactions, primers and the multipliers). Splash hits other live enemies within `r` of the target for `frac` × the target's amount, with no marks and no detonation;
  - `heal` uses `healAdventurer` with Font's multiplier when it applies (Task 3 adds the trait hooks; in this task, implement the multiplier hook as identity);
  - `shield` follows the shield rule;
  - `buff`: expiry plus src, and `buff` fx when it starts;
  - `momentum` uses `gainMomentum`, with `gift` fx;
  - `taunt` uses `ThreatTable.taunt`;
  - `threat-drop` sets the caster's entry on each table within `r` to 0, keeping the entry (it adds the new `ThreatTable.set(id, v)`);
  - `revive`: the target becomes alive at `round(frac × maxHp)` hp, Momentum 0, act `''`, cooldowns kept; `revive` fx; `out.revived`;
  - `hp-cost` takes `min(amount, hp − 1)` from the caster: it never kills, adds no threat, and does not count as combat damage taken;
  - `dodge-refill` adds charges, capped;
  - `cleanse` clears `a.afflictions` (a `Set<string>`, always empty in 3b).
- **Buff ticks:**
  - rain heals `RAIN_HEAL` (5) at each whole second after its start (6 heals), from its src;
  - sheltered, aegis, roar, pact, mist and bloodbond are read by Task 3's hooks;
  - expired buffs send `buff … on: false`.
- **Casting** (`casting.ts`):
  - `a.cast = { id, slot, startedAt, endsAt, targetId, allyId }`;
  - `act 'cast'`, and autos pause;
  - `speedScaleOf` multiplies by `CAST_MOVE_SCALE` from `CHARGE_SLOW_GRACE_S` into the cast (and `SPEED_GRACE_S` after it ends, as for the charge);
  - completion happens in `tickAdventurer` at the first tick with `now ≥ endsAt − TIME_EPS`;
  - `breakCast(w, a, reason, nowS)` is exported for the enemy AI (Task 3);
  - a dodge calls it with `'dodge'`, `knockAdventurer` with `'interrupt'`, and `killAdventurer` with `'cancel'`;
  - `carryOf` never carries a cast.
- **Removed:** the `swap` intent, `swapIntent`, `SWAP_LOCKOUT_S`/`SWAP_COOLDOWN_S` usage, `Carry.swapCd` (its readers ignore it when present), the `FREE_POOL` and `WEAPON_BARS` shims.
- **Dodge charges:** `newAdventurer` gives `JOBS[job].dodgeCharges`.

- [ ] **Step 1: Write the failing tests.** All use flat synthetic zones, as in Plan 3's `engine.test.ts`, with `jobSwitch: () => true` unless a test says otherwise.
  - `jobsEngine.test.ts`:
    - `describe('job intent')`:
      - `it('switches warrior → ninja: slots, 3 dodges, Momentum 0, cooldowns kept by id')`;
      - `it('refuses not-here where jobSwitch is false or absent')`;
      - `it('refuses in-combat, dead, busy (casting, charging, dodging), invalid (future job, wrong picks)')`, each with no change to `self()`;
      - `it('loadout picks change anywhere out of combat, only from the current pool')`.
    - `describe('aims')`:
      - `it('Field Dressing heals the lowest-hp adventurer in range, self on a tie')`;
      - `it('an explicit ally id wins when valid, and is ignored when out of range or dead')`;
      - `it('Shelter and Kindred Spark refuse no-ally alone')`;
      - `it('Second Dawn needs a dead adventurer within 12 m')`.
    - `describe('effects')`:
      - `it('Rallying Roar buffs self and an adventurer 9 m away, not one 11 m away, for 8 s')`;
      - `it('Dawn Ward replaces a smaller shield and not a larger one')`;
      - `it('Soft Rain heals 4 a second, 6 times, from its source')`;
      - `it('Grave Ward and Grim Rend never take the last hp, and are not combat damage')`;
      - `it('Quickstep refills one dodge, capped at 3')`;
      - `it('Ashcloud sets the ninja's threat to 0 on enemies within 6 m and keeps the entry')`;
      - `it('Kindred Spark gives +30 to the partner, +10 to self, with gift fx')`;
      - `it('revive: hp 40, act cleared, cooldowns kept, revived in TickOut')`.
    - `describe('relog')`:
      - `it('carry keeps per-id cooldowns across a job change')`;
      - `it('carry never holds a cast')`.
  - `casting.test.ts`:
    - `it('Skyfall Arc: GCD at start, cost and cooldown at completion after 1.2 s, castEnd ok')`;
    - `it('autos pause while casting')`;
    - `it('speedScale is 0.5 from 0.25 s into a cast and 1 after SPEED_GRACE_S')`;
    - `it('pressing during a cast → busy; release → invalid')`;
    - `it('target dies mid-cast → fizzle: no cost, no cooldown')`;
    - `it('walking 3.1 m beyond range+fuzz → fizzle; 1.9 m beyond → lands (CAST_RANGE_SLACK)')`;
    - `it('a wall between at completion → fizzle')`;
    - `it('own dodge cancels with no cooldown')`;
    - `it('knock interrupts: CAST_BREAK_LOCK_S cooldown, Momentum unspent')`;
    - `it('death cancels')`;
    - `it('Second Dawn (3 s) on a dead ally revives at 40%')`;
    - `it('determinism: two engines, same intents, identical TickOut streams over 60 s with casts')`.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep every Plan 3 test passing once it has been converted to the new shapes. Damage multipliers, elements and enemy-side hooks are Task 3: leave clearly named hook functions (`outgoingMult`, `takenMult`, `onHealDone`, `onDamageTaken`) that return 1 or do nothing.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.** The server and client may need mechanical renames (`free` → `picks`, no `swap`): make only those, and leave behaviour to Tasks 6 and 7. A `swap` message from an old client now hits the unknown-message guard.
- [ ] **Step 5: Commit**: `feat: data-driven ability effects, casting, ally aims and the job intent in the combat engine`.

### Task 3: Engine II: elements, reactions, enemy debuffs and traits

**Files:**
- Modify:
  - `shared/src/combat/adventurer.ts` (`strike`, multipliers, primers, reactions, trait hooks);
  - `shared/src/combat/enemyAi.ts` (rooted speed, blinded and mist misses, sheltered redirect, aegis and steadfast taken, cast break on telegraph hits, block and blood Momentum, Ninja perfect-dodge Momentum);
  - `shared/src/combat/threat.ts` (`set`, and the `STEADFAST_THREAT` factor applied by the caller);
  - `shared/src/combat/effects.ts`.
- Test: `shared/src/combat/elements.test.ts`, `shared/src/combat/traits.test.ts`.

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `strike(w, a, e, s, nowS)` takes `{ coef, by, momentum?, mark?, primer?, finisher?, element?, behind?, stagger?, interrupts? }`. It follows the hit order in Numbers → Elements;
  - `EnemyState` gains `markBy: Partial<Record<MarkId, number>>` (who applied each live mark) and `debuffs: Partial<Record<DebuffId, { until: number; src: number }>>`;
  - `TickOut.fx` `hit` events carry `element` and `behind` when they apply.
- **Rules**, exactly as in Numbers:
  - outgoing and taken multipliers;
  - reactions;
  - rooted, which multiplies the enemy's speed, surge included;
  - blinded and mist, which turn enemy **autos** into `miss` (`why`) while telegraphs still hit;
  - Shelter;
  - the traits:
    - Paladin threat: every `threat.add` for a Paladin is × `STEADFAST_THREAT`, taunts included as Plan 3 computes them;
    - Dark Knight lifesteal: applied after each ability's damage, with Bloodbond copying it and pact doubling it;
    - White Mage Font: ×1.2 on heals to others, Momentum from healing, heal threat × 0.5;
    - Black Mage Overflow: ×1.1 elemental damage, +10 Momentum per completed cast;
    - Warrior Rhythm: 15 per auto;
    - Ninja: behind ×1.25, and 25 per perfect dodge;
  - **cast breaks:** in `resolveHit`, after a telegraph's damage lands on hp or shield, `breakCast(w, a, 'interrupt', nowS)`. Autos never break casts.

- [ ] **Step 1: Write the failing tests.**
  - `elements.test.ts`:
    - `it('primer sets Soaked without detonating Marked')`;
    - `it('Tidelash then Skyfall Arc on a Thornling: conduct, stun 1.5 s, the wind-up cancelled, react fx, soaked consumed')`;
    - `it('conduct on the Mossback: +45 stagger total and Thorn Hail interrupted')`;
    - `it('Cinder Dart on Marked: blast hitDamage(4.5) plus half to an enemy 2.5 m away, none to one 3.5 m away')`;
    - `it('Tidelash on Burning: steam heals adventurers within 6 m by 12, ends the Burning DoT')`;
    - `it('Rootbreak on Dazed: bedrock shields 15 for 6 s')`;
    - `it('a finisher reacts with one mark and detonates the others as plain combos')`;
    - `it('fire on a Thornling ×1.25, water ×0.75; the Light finisher has no element multiplier')`;
    - `it('Rooted Thornling chases at 0.6×')`;
    - `it('Hearthfall splash: half to enemies within 4 m, no marks')`;
    - `it('Barbed Rain: full damage to enemies within 3 m of the target')`.
  - `traits.test.ts`:
    - `it('Warrior autos build 15 Momentum')`;
    - `it('Ranger +10% only when the target is attacking someone else')`;
    - `it('Paladin takes ×0.85; Aegis ×0.4 on self, ×0.7 on an ally 7 m away; they never stack below 0.4')`;
    - `it('Paladin threat ×1.5 (a duo partner with equal damage cannot pull the enemy)')`;
    - `it('Paladin +5 Momentum per hit taken, shield-absorbed hits included')`;
    - `it('Shelter: the ally takes final − floor(final/2); the Paladin takes the rest ×0.85; stops at once when the Paladin dies')`;
    - `it('Dark Knight heals 20% of ability damage, not autos; pact doubles it; Bloodbond copies it to the lowest other ally within 15 m')`;
    - `it('Dark Knight +1 Momentum per 3 hp taken')`;
    - `it('Ninja behind ×1.25 (115° off the front yes, 100° no); Ghost Edge always counts as behind')`;
    - `it('Ninja perfect dodge +25 Momentum')`;
    - `it('Mist Form: Thornling autos miss for 5 s, Thorn Burst still hits')`;
    - `it('Ashcloud blind: autos miss for 3 s')`;
    - `it('Weak Point ×1.15 for every attacker')`;
    - `it('White Mage heals others ×1.2, self ×1; +1 Momentum per 2 hp healed, at most 20')`;
    - `it('White Mage heal threat is half')`;
    - `it('Black Mage +10 Momentum per completed cast, none on fizzle')`;
    - `it('a telegraph hit interrupts a cast (CAST_BREAK_LOCK_S); an auto does not; a miss does not')`.
  - Plan 3's `enemyAi.test.ts`, `engine.test.ts` and `sim.test.ts` stay green. Their Blade/Bow fights now run as warrior/ranger with picks `mend, bulwark` and `field_dressing, pinning_shot`. If a Plan 3 sim band moves because of the Warrior's Rhythm or the Ranger's new picks, update that one band to the job bands of Task 4 only in Task 4, and leave it skipped here with `it.todo` and a note naming Task 4.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean. Also print the room tick budget:** run the Plan 3 enemy-AI budget test (21 chasing enemies) with 20 casting adventurers added; one tick must stay under 2 ms on average on this machine.
- [ ] **Step 5: Commit**: `feat: elements, reactions, enemy debuffs and job traits in the combat engine`.

### Task 4: Job-aware brain and the job/duo simulation bands

**Files:**
- Modify: `shared/src/combat/brain.ts`, `shared/src/combat/sim.ts`, `shared/src/combat/sim.test.ts` (the Plan 3 bands rewritten as Warrior/Ranger bands).
- Create:
  - `shared/src/combat/sim.jobs.solo.test.ts`;
  - `shared/src/combat/sim.jobs.duo.test.ts` (two files, so Vitest runs them in parallel);
  - `shared/src/combat/brain.test.ts`.
- Modify, only under the Tuning rule: `shared/src/combat/abilities.ts`, `shared/src/combat/jobs.ts`, `shared/src/combat/constants.ts` (the element multipliers only).

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
```ts
// brain.ts
export interface BrainInput {
  nowS: number; careful: boolean;
  self: CombatantView & SelfView;
  target: CombatantView | null;
  allies: CombatantView[];          // other adventurers within 30 m, dead ones included
  telegraphs: TelegraphView[];
}
export function adventurerBrain(b: BrainInput, memory: BrainMemory): BrainAction; // as Plan 3, now job-aware
// sim.ts
export interface PartyMember { job: JobId; careful: boolean; picks?: [AbilityId, AbilityId] } // default: solo picks for a party of 1, else duo picks
export interface MemberResult { died: boolean; deaths: number; revived: number; hpLeft: number; dodges: number; damage: number;
  healedOthers: number; shieldedOthers: number; assists: number; casts: number; castBreaks: number }
export interface PartyResult { firstHitAt: number | null; killedAt: number | null; ttk: number | null; members: MemberResult[];
  combos: number; crossCombos: number; reactions: Record<ReactionId, number>; surgeS: number }
export function simulateParty(o: { seed: number; party: PartyMember[]; enemy: EnemyKindId; maxS?: number }): PartyResult;
export function simulateFight(o: { seed: number; job: JobId; enemy: EnemyKindId; careful: boolean; picks?: [AbilityId, AbilityId]; maxS?: number }): FightResult;
```
- **Brain rules**, in this order, one ability per tick (Plan 3 order and dodging kept):
  1. **Dodging** (careful only), as in Plan 3. A careful brain also dodges out of a telegraph while casting, which cancels the cast, and never starts a cast while a telegraph contains it.
  2. **Movement:**
     - toward the target, using the job's weapon range (Plan 3 rule);
     - a `flank` job, whose target's `targetId` is another adventurer, stands at the point behind the target: target position − its facing direction × (radius + range − 0.6);
     - casting does not stop movement: the brain keeps its `moveTo`, and the engine slows it.
  3. **Abilities**, by `ai` hint. The first that applies, is ready and is in range wins:
     1. `revive`: a dead ally in range;
     2. `allyBigHeal`: the lowest ally (self included) below 50%;
     3. `selfHeal`: self below 50%;
     4. `allyHeal`: the lowest below 65%;
     5. `healParty`: in combat, and anyone within 10 m below 80%;
     6. `shieldSelf`: in combat;
     7. `shieldAlly`: in combat, and the lowest below 85%;
     8. `shieldParty`: in combat;
     9. `aegis`: the target is in reach and is winding up, or targets self;
     10. `interrupt`: the target's wind-up is interruptible;
     11. `tauntIfNotMe`: an ally exists, and the target's `targetId` is neither self nor null;
     12. `shelter`: in combat, with an ally the target is attacking;
     13. `threatDrop`: the target targets self, and an ally exists or self is below 60%;
     14. `mist`: the target targets self and is in reach;
     15. `buffParty` and `selfBuff`: in combat, the target engaged;
     16. `momentumGift`: in combat, with an ally;
     17. `debuff`: in combat;
     18. `dodgeRefill`: below the job's maximum dodges;
     19. `finisher`: Plan 3's rules, including the careful hold for an interrupting finisher;
     20. `damage`: the quick skill first, then the others in slot order;
     21. `charge`: as in Plan 3.

     `never` abilities are skipped. Ally-aimed abilities send `ally` (the chosen ally's id).
- **Simulation:**
  - as Plan 3's `simulateParty`, with jobs;
  - the flat zone has `jobSwitch: () => false`;
  - members who die stay in the loop: a dead member's brain does nothing, and a revived one carries on;
  - the fight ends at the kill, when everyone is dead with no revive casting, or at `maxS`;
  - members are 3 m apart; the seed varies the approach, reactions and starts (Plan 3);
  - **`assists`** counts each support effect that took effect:
    - a heal or shield on another adventurer;
    - a buff landing on another adventurer;
    - Momentum given;
    - a revive;
    - a taunt;
    - a threat-drop;
    - a debuff;
    - an interrupt;
    - a primer placed by a `support` ability;
  - **`crossCombos`** counts detonations and reactions of a mark that another member applied (from `markBy`).
- **Bands** (seeds as given, careful unless stated; print nothing on success):
  - `sim.jobs.solo.test.ts`, seeds 1–5, each job with its solo picks:
    - **S1** `it.each(JOB_IDS)('%s solo beats every ordinary kind')`:
      - every seed wins against thornling, boar and archer;
      - the mean TTK per kind is in [9, 16];
      - then `it('no job is more than 25% off the median, per ordinary kind')` on the seven means.
    - **S2** `it.each(JOB_IDS)('%s solo beats the Mossback with care')`:
      - wins in at least 4 of 5 seeds, with `hpLeft ≥ 10` in each win;
      - the mean TTK is in [30, 80];
      - then `it('no job is more than 25% off the median against the Mossback')`.
    - **S3** `it('careless Mossback is deadly for damage jobs and costly for the sturdy')`:
      - warrior, ranger, ninja and black_mage die in at least 3 of 5 seeds;
      - paladin, dark_knight and white_mage die, or end with mean `hpLeft ≤ 50`.
  - `sim.jobs.duo.test.ts`, the 28 pairs (21 distinct plus 7 mirrors), seeds 1–3, duo picks:
    - **D1** `it.each(PAIRS)('%s + %s kill a Thornling fast')`: every seed wins, with TTK ≤ 10.
    - **D2** `it.each(PAIRS)('%s + %s beat the Mossback')`:
      - every seed wins (somebody alive at the kill);
      - mean TTK is in [18, 55], or ≤ 70 for white_mage + white_mage;
      - at most 1 death over the 3 seeds.
    - **D3** `it.each(PAIRS)('%s + %s are a real team')`, over the 3 Mossback seeds:
      - `crossCombos ≥ 2`;
      - every member has `assists ≥ 1`.
    - **D4** `it('mages react')`:
      - white_mage + black_mage has `reactions.conduct ≥ 1`;
      - black_mage + warrior has `reactions.blast ≥ 1`;
      - white_mage + ranger has `reactions.steam ≥ 1`;
      - black_mage + paladin has `reactions.bedrock ≥ 1`;
      - all summed over seeds 1–3 against the Mossback.
  - `sim.test.ts` (Plan 3 bands as jobs): warrior and ranger, with their solo picks, keep Plan 3's ordinary [10, 15] and Mossback careful [36, 75] bands, and careless death.
  - `brain.test.ts`:
    - a White Mage brain casts Second Dawn on a dead partner before anything else;
    - a Paladin taunts only when the enemy targets the partner;
    - a Ninja with a partner holding aggro moves behind the target;
    - a careful Black Mage does not start Hearthfall inside a telegraph.
  - The whole combat suite runs in under 60 s on this machine. If it is slower, lower the seeds for D1 to 1–2 and say so in the report. Never lower them for D2 or D3.

- [ ] **Step 1: Write the failing tests** above.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement the brain and the simulation. Then tune only by the Tuning rule until every band passes.** Write a scratch script, in the scratchpad and not committed, that prints a 7 × 4 solo table and a 28-row duo table (TTK, deaths, crossCombos, assists, reactions). Paste the final tables into the task report.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine. Run `npm run typecheck`: clean.**
- [ ] **Step 5: Commit**: `feat: job-aware brain and simulation bands for every job and every duo`, listing the tuning changes in the commit body.

### Task 5: Zones (towns, sanctuaries, the Guild Board), store and migration

**Files:**
- Modify:
  - `shared/src/world/zones.ts` and `shared/src/world/zones.test.ts`;
  - `server/src/store/types.ts`, `server/src/store/memory.ts`, `server/src/store/pg.ts`;
  - `server/src/store/store.test.ts`.
- Create: `server/migrations/004_jobs.sql`.

**Interfaces:**
- Consumes: Task 1 (`JobsSave`, `parseJobsSave`, `isJobsSave`, `newJobsSave`, `legacyLoadout`).
- Produces:
```ts
// zones.ts
export interface Sanctuary { readonly x: number; readonly z: number; readonly r: number; readonly name: string }
export interface ZoneDef extends CombatZone { /* Plan 3 */ readonly town: boolean; readonly sanctuaries: readonly Sanctuary[] }
export function jobSwitchAt(def: Pick<ZoneDef, 'town' | 'sanctuaries'>, x: number, z: number): boolean; // town || inside a sanctuary circle
// each ZoneDef's jobSwitch = (x, z) => jobSwitchAt(def, x, z)
export const GUILD_BOARD: { x: number; z: number; facing: number };   // in the grove's Plaza of the Two
export const REASON_JOB_NOT_HERE = 'Jobs can be changed only in a town or a sanctuary'; // re-exported from messages.ts by Task 6
```
  - grove: `town: true`, `sanctuaries: []`; greenway: `town: false`, `sanctuaries: []` (a data hook: later safe camps go here).
  - `GUILD_BOARD` is a point that the worker chooses and the test checks. It must be:
    - on the grove surface;
    - 2–6 m from `SPAWN`, and at least 3 m from the statue's centre;
    - outside every grove obstacle by at least 0.5 m;
    - facing `SPAWN`.

    It is **not** an obstacle: the obstacle list and the client's drift guard do not change.
  - **Store:**
    - `Adventurer.loadout` is replaced by `jobs: JobsSave`;
    - `AdventurerSave = Pick<Adventurer, 'id' | 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'jobs'>`;
    - `checkedSave` throws a TypeError unless `isJobsSave(a.jobs)`, and returns a deep copy;
    - new adventurers get `newJobsSave()`;
    - **read path (both stores):** `parseJobsSave(row.jobs, row.loadout)`, so a row the migration missed still loads;
    - the memory store keeps a `legacyLoadout` field per row only for the `seedLegacy` test helper (`createMemoryStore({ legacyRows })`);
    - the `loadout` column is no longer written.
  - **Migration `004_jobs.sql`** (safe to run again):
```sql
-- Jobs: one adventurer levels every job separately. Converts Plan 3's loadout (weapon + free picks):
-- Blade → Warrior (picks kept; the server's reader replaces picks outside the Warrior's pool), Bow → Ranger
-- (Ranger's solo picks). The loadout column is kept, unused, for rollback.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS jobs jsonb;
UPDATE adventurers SET jobs = CASE WHEN loadout->>'weapon' = 'bow'
  THEN '{"current":"ranger","jobs":{"ranger":{"level":1,"xp":0,"picks":["field_dressing","pinning_shot"],"talents":[],"outfit":null}}}'::jsonb
  ELSE jsonb_build_object('current', 'warrior', 'jobs', jsonb_build_object('warrior', jsonb_build_object(
    'level', 1, 'xp', 0, 'picks', COALESCE(loadout->'free', '["mend","bulwark"]'::jsonb), 'talents', '[]'::jsonb, 'outfit', 'null'::jsonb)))
  END
WHERE jobs IS NULL;
ALTER TABLE adventurers ALTER COLUMN jobs SET DEFAULT '{"current":"warrior","jobs":{"warrior":{"level":1,"xp":0,"picks":["mend","bulwark"],"talents":[],"outfit":null}}}'::jsonb;
ALTER TABLE adventurers ALTER COLUMN jobs SET NOT NULL;
```

- [ ] **Step 1: Write the failing tests.**
  - `zones.test.ts`:
    - `it('the grove is a town everywhere; the Greenway is not, anywhere')`: sample 500 seeded points on each surface with `zoneDef(z).jobSwitch`;
    - `it('a sanctuary circle allows job changes inside and not 0.1 m outside')`, on a test def built with `jobSwitchAt`;
    - `it('GUILD_BOARD stands on the plaza, near the spawn, clear of obstacles')`.
  - `store.test.ts` (memory, and pg when `TEST_DATABASE_URL` is set):
    - `it('jobs round-trip, with per-job xp and picks')`;
    - `it('a new adventurer is a level 1 Warrior with mend and bulwark')`;
    - `it('checkedSave refuses a jobs value isJobsSave refuses')`;
    - `it('legacy rows load: blade → warrior with picks kept, bow with taunt and sprint → ranger with its solo picks, garbage → new')`;
    - `it('migration 004 converts Plan 3 rows and is safe to run twice')` (pg only): insert rows with Plan 3 loadouts, run all migrations twice, and read them back.
- [ ] **Step 2: Run `npx vitest run shared/src/world server/src/store`. Expected: FAIL.**
- [ ] **Step 3: Implement.** The room still compiles against `loadout`, so add a temporary `loadoutOf(adventurer.jobs)` at its read sites and write `jobs` back unchanged; Task 6 does it properly. Keep `npm run typecheck` clean.
- [ ] **Step 4: Run root `npm test`: PASS, pristine. Then the plain grove bot run on port 2571** (`npm run bots -w server -- --url http://localhost:2571 --count 100 --seconds 30`): exit 0, mean ≥ 14 Hz, 0 corrections. Stop the server by PID.
- [ ] **Step 5: Commit**: `feat: towns and sanctuaries, the Guild Board spot, per-job saves and migration 004`.

### Task 6: Server: jobs in the zone room

**Files:**
- Modify:
  - `server/src/rooms/ZoneRoom.ts`, `server/src/rooms/state.ts`, `server/src/rooms/combatSync.ts`;
  - `server/src/rooms/testHelpers.ts`, `server/src/index.ts` (`SG2_TEST_DUMMY`);
  - `shared/src/messages.ts`.
- Test: create `server/src/rooms/jobs.test.ts`; add to `server/src/index.test.ts`; update `server/src/rooms/combat.test.ts` (swap → job, free → picks).

**Interfaces:**
- Consumes: Tasks 2, 3 and 5. The engine's `job` and `loadout` intents, `TickOut.revived`, the new views, `zoneDef(z).jobSwitch`, `JobsSave`, `addJobXp`, `KILL_XP`, `levelForXp`, `xpToNext`.
- Produces:
  - **Messages** (`messages.ts`):
```ts
C2S: ability: { slot: number; phase: 'press' | 'release'; ally?: number };
     loadout: { picks: [AbilityId, AbilityId] };
     job: { job: JobId };
     // swap removed
export type IntentAction = 'target' | 'ability' | 'dodge' | 'loadout' | 'job' | 'respawn';
export { REASON_JOB_NOT_HERE } from './world/zones';
export interface JobsView { current: JobId; jobs: Record<JobId, { level: number; xp: number; next: number; picks: [AbilityId, AbilityId] }> }
S2C: jobs: JobsView;                     // on join, after a job or loadout change, after xp
     jobXp: { job: JobId; gained: number; xp: number; level: number; levelUp: boolean };
     revived: { hp: number; by: number };  // revived where it lay (Second Dawn): no new ack, no displacement
```
  - **State** (`state.ts`): `PlayerState` gains:
    - `job: t.string()`;
    - `cast: t.string()` ('' = none);
    - `castTotal: t.float32()`;
    - `castAt: t.uint32()` (zone clock steps, as `TelegraphState.at`);
    - `buffs: t.uint8()`.

    `weapon` stays, now always `JOBS[job].weapon`. `EnemyState` gains `debuffs: t.uint8()`. Mirroring writes a field only when its value changes (Plan 3 rule).
  - **Session:** `jobs: JobsSave` replaces `loadout`. Saves write `jobs`.
  - **Join:** `combat.addAdventurer({ ..., loadout: loadoutOf(jobs) })`, then send `jobs`.
  - **`job` message:**
    - the guard checks `isJobId`;
    - picks = `recordFor(jobs, job).picks`;
    - `combat.intent(eid, { t: 'job', job, picks })`;
    - refused → `refused { action: 'job', reason }`;
    - accepted → `jobs.current = job`, store the record if it is new, `player.job` and `player.weapon`, send `jobs`, and save at once (best effort, as travel saves are).
    - A `job` message from a session that is travelling, or not yet entered → `refused { action: 'job', reason: 'busy' }`.
  - **`loadout` message:** the engine's `loadout` intent. Accepted → store the picks in the current job's record, send `jobs`.
  - **`ability`:** the `ally` field must be an integer when present (else the guard drops the message); it is passed through to the engine.
  - **Kills:**
    - for each credited session: `addJobXp(jobs, jobs.current, KILL_XP[kind])`;
    - send `credit` (Plan 3) plus `jobXp`;
    - if xp changed, also send `jobs`.
  - **Revived:**
    - `session.dead = false`; the death and auto-respawn timers are cleared;
    - `player.dead` false and hp set;
    - send `revived`;
    - moves are accepted again with the **current** ack (none was used up).
  - **Death save rule (Plan 3) is unchanged:** a dead adventurer is saved as respawned. A revive before a save keeps the adventurer where it is.
  - **fx interest:** unchanged rule. `react`, `buff`, `shield`, `gift`, `revive`, `cast` and `castEnd` use `dst`, else `src`.
  - **Self:** `self` includes `job`, `dodgeMax` and `cast`. It is still rate-limited to 5 Hz, sent only on change.
  - **`SG2_TEST_DUMMY=1`** (`server/src/index.ts`): a test-only env flag, like `SG2_START_ZONE`, that adds one `dummy` camp at (3, −11) to the grove's def passed to `createApp` (through `AppOptions.zones`). It is never set in Docker or `docker-compose.yml`. A test in `server/src/index.test.ts` checks that it is off by default.

- [ ] **Step 1: Write the failing tests** in `jobs.test.ts`. Zone overrides put a dummy camp in the grove (Plan 3 style), and a test-only greenway override with a dummy camp near its entry. Fixed `combatSeed`. Tests:
  - `it('join sends jobs; a new adventurer is a level 1 Warrior')`;
  - `it('job in the grove: slots, state.job, state.weapon change; jobs sent; saved at once; rejoin keeps it')`;
  - `it('job in the Greenway → refused not-here, nothing changes')` (Review Focus 1);
  - `it('job while in combat, dead, casting, travelling → refused with the right reason')`;
  - `it('job spam: 30 in a second → at most the intent budget reach the engine, rest refused rate')`;
  - `it('each job remembers its picks')`: set ninja picks, switch to warrior and back, and the ninja picks return;
  - `it('loadout with another job's ability → refused invalid')` (Review Focus 2);
  - `it('slot 1 after a switch is the new job's quick skill (a use fx names it)')`;
  - `it('kill credit gives job xp to the current job only; jobXp and jobs sent; persists across relog')`;
  - `it('a cast shows in state (cast, castTotal, castAt) and clears at its end')`;
  - `it('ally: Field Dressing with ally = the other session's eid heals that adventurer')`;
  - `it('Second Dawn revives a dead second session where it lay: revived, moves accepted, no auto respawn later')`;
  - `it('Plan 3 saves (memory legacyRows) join as warrior/ranger')` (Review Focus 5);
  - `it('relog mid-cast: no cost, cooldowns per id carried')` (Review Focus 3);
  - `it('state fields change only on events')`: record patch bytes for 10 s of two walking clients with no casts, before and after a job switch; the walking-only bytes equal Plan 3's within 2%.
  - All Plan 3 room tests pass.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep each room test under 10 s of real time, using test-only options, never production constants.
- [ ] **Step 4: Run root `npm test` (PASS, pristine). Then the bandwidth runs:**
  - start the server on port 2572 (default start zone) in the background and note its PID;
  - `npm run bots -w server -- --url http://localhost:2572 --count 100 --seconds 30` → exit 0, mean ≥ 14 Hz, 0 corrections, and the printed KiB/s per bot no more than +0.5 over `docs/load-test.md`'s "grove, from the spawn" capped number;
  - again with `--cluster 15` → ≤ 11.5 KiB/s per bot;
  - `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: jobs in the zone room: town-only switching, per-job picks and xp, casts and revives in state`.

### Task 7: Client I: job board, HUD, ally focus and casting controls (browser-heavy)

**Files:**
- Create:
  - `client/src/hud/jobs.ts` (the job board sheet);
  - `client/src/world/guildBoard.ts` (the Plaza notice board model);
  - `client/src/combat/allyFocus.ts`;
  - `client/src/combat/allyFocus.test.ts`;
  - `client/src/hud/jobs.test.ts`.
- Modify:
  - `client/src/core/contracts.ts`;
  - `client/src/combat/abilityDefs.ts`, `client/src/combat/controller.ts`, `client/src/combat/controller.test.ts`;
  - `client/src/hud/{index,abilities,frames,overlays,style,dom,dev}.ts`;
  - `client/src/world/town.ts` (place the board at `GUILD_BOARD`, online build only);
  - `client/src/online.ts`.

**Interfaces:**
- Consumes: Task 6's messages and state, `JOBS`, `ABILITIES`, `slotsFor`, `zoneDef(zone).town`, `GUILD_BOARD`, `REASON_JOB_NOT_HERE`.
- Produces (contract changes):
  - `WeaponId` in `contracts.ts` re-exports the shared `WeaponId`.
  - `AbilityDef` gains `job: JobId`, `element?: ElementId`, `support: boolean`; `castTime` is filled from `cast`. Its `weapon` field is removed: tooltips show the job name and "Instant" or "Cast n s".
  - `HudState.player`:
    - gains `job?: { id: JobId; name: string; glyph: string; level: number }`;
    - the existing `cast` shows spell casts as `{ name, frac }`;
    - `dodge.max` comes from `self.dodgeMax`.
  - `HudEvent`: `{ type: 'swapWeapon' }` is removed; `{ type: 'openJobs' }` and `{ type: 'cycleAlly' }` are added.
  - `HudApi`:
    - `loadout(pool: AbilityDef[], current: string[], title: string, count?: number): Promise<string[]>` (the title is the job name);
    - `jobs(view: JobBoardView): Promise<JobId | null>`, with:
      ```ts
      interface JobBoardView {
        current: JobId; canSwitch: boolean; note: string | null;
        rows: { id: JobId; name: string; glyph: string; role: string; level: number; xpFrac: number; weaponName: string; trait: string; bar: AbilityDef[]; picks: AbilityDef[] }[];
      }
      ```
  - **The job board sheet:**
    - one row per job: glyph, name, role, "Lv n", an xp bar, the weapon name;
    - tapping a row expands it: trait, the five buttons with tooltips, and a "Become a Ninja" button (the job name comes from data);
    - the current job is marked;
    - outside a town, `note = REASON_JOB_NOT_HERE`, shown at the top. The buttons stay enabled and the server decides;
    - on phones it is a full-screen sheet with 56 px rows; on desktop, a 420 px panel;
    - Esc closes it.
  - **Opening it:**
    - `J` (desktop);
    - a "Jobs" button that replaces the old swap button, in the same spot, with the same size and `.sg-ctl` class;
    - a tap on the Guild Board in the grove, which walks within 3 m with tap-to-walk, like talking to an NPC.

    The Guild Board is a code-built post-and-board with seven small job glyph plaques and a lantern: flat-shaded, in `PALETTE` colours, about 2.2 m tall. Its pickable meshes carry metadata `{ guildBoard: true }`.
  - **Choosing** a job sends `job`. The answers:
    - `jobs` → close the sheet, toast "You are now a Ninja", banner;
    - `refused` with reason `'not-here'` → toast `REASON_JOB_NOT_HERE`;
    - `'in-combat'` → "Not during a fight";
    - `'busy'` → "Finish what you are doing first".
  - **Ability bar:**
    - slots from `self.slots`;
    - icons are the ability glyphs on a job-coloured disc;
    - the cast bar uses `self.cast`;
    - a cast in progress dims the other buttons;
    - the finisher is unusable below 50 (Plan 3);
    - **Loadout (`L`)** opens the chooser over `JOBS[job].pool` with count 2, refused in combat (Plan 3).
  - **PlayerFrame:**
    - a round job badge (glyph and level) left of the name, with `title` = the job name;
    - a level-up flashes the badge, and the toast "Ninja reached level 2".
  - **Ally focus** (`allyFocus.ts`, pure helpers plus a small ring view):
    - tapping another adventurer sets the focus and shows a green ground ring under them; tapping them again clears it;
    - `F` cycles through adventurers within 18 m, nearest first;
    - the focus clears when they leave the view or after 30 s without use;
    - ally-aimed abilities send `ally: focus` when there is a focus;
    - `aimHint(ability, focus, me, others)` returns the id the server would most likely pick, used to flash its name label;
    - tap-to-walk never walks to an adventurer.
  - **Movement scale:** `rig.setMoveScale` adds 0.5 while `self.cast` is not null (the server's view).
  - **Refusal toasts:** `'no-ally'` → "Nobody to help here"; `'busy'` while casting → silent.
  - **Revived:** `dismissEndScreen`, toast "Back on your feet", and the hp from state.
  - **`window.__sg2net`** adds:
    - `self.job` and `self.cast`;
    - `jobs` (the last `JobsView`);
    - `refusals: { action: string; reason: string }[]` (the last 20);
    - `allyFocus: number | null`;
    - `guildBoard: { x: number; z: number }`.

- [ ] **Step 1: Write the failing tests:**
  - `jobs.test.ts`, on a pure `jobBoardView(jobsView, zone)`:
    - seven rows in `JOB_IDS` order;
    - levels and `xpFrac` from xp;
    - `note` null in the grove and `REASON_JOB_NOT_HERE` in the Greenway;
    - job names come only from `JOBS` (rename White Mage in a test copy, and the row follows).
  - `allyFocus.test.ts`:
    - tap toggles;
    - `F` cycles nearest-first within 18 m;
    - the focus expires after 30 s;
    - `aimHint` matches `resolveAim`'s pick on 50 seeded layouts.
  - `controller.test.ts`:
    - `slotView` for every job: five slots;
    - the finisher is unusable below 50;
    - a cast in progress → other slots `usable: false`;
    - `abilityDefs` maps all 49 abilities with glyph, cooldown, cast time and job.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Use the existing character models: Task 8 adds the weapons and effects.
- [ ] **Step 4: Run root `npm test` (PASS). Then client `tsc`, `npm run build` (the offline demo unchanged: no Guild Board, no jobs UI) and `npm run build:online`. Then the browser check:**
  - start the server on port 2574 (default start zone, the grove) in the background and note its PID;
  - with Playwright at desktop size and `devices['iPhone 13']`, `?lockq`, game time, take screenshots of:
    - the Guild Board in the Plaza, beside the statue;
    - a tap on it walking over and opening the job board;
    - the sheet on the iPhone, with seven rows and one expanded;
    - becoming a Black Mage: toast, badge, a new bar with staff glyphs, `__sg2net.self.job === 'black_mage'`;
    - the cast bar during Skyfall Arc against the grove test dummy. For this, start the server with `SG2_TEST_DUMMY=1` (Task 6);
    - the loadout chooser showing the Black Mage pool;
    - a second page: tapping the first page's adventurer shows the green focus ring;
    - Field Dressing as a Ranger heals the focused adventurer (that page's hp rises);
    - walking through the east gate, then pressing `J` in the Greenway: the note shows, and choosing Ninja shows the `REASON_JOB_NOT_HERE` toast, with `__sg2net.refusals` ending in `{ action: 'job', reason: 'not-here' }` and the job unchanged.
  - On the iPhone, measure every `.sg-ctl` bounding box: all at least 48 px, with none intersecting the joystick zone or each other, and the Jobs button in the old swap button's place.
  - No page errors. `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: job board, Guild Board, job badge, cast bar and ally focus`.

### Task 8: Client II: weapon models and spell and support effects (browser-heavy)

**Files:**
- Modify:
  - `client/src/player/character.ts` (weapons);
  - `client/src/player/rig.ts`;
  - `client/src/net/remotes.ts` (a remote shows `state.weapon` and `state.job` tint, and the cast pose from `cast`);
  - `client/src/combat/effects.ts`;
  - `client/src/combat/overheads.ts` (rooted and dazed mark icons, enemy debuff icons, a remote's thin cast bar).
- Create:
  - `client/src/combat/spells.ts` (pooled spell visuals);
  - `client/src/combat/spells.test.ts`;
  - `client/dev/jobs.html` and `client/src/player/jobsDev.ts` (a viewer, not part of the build).

**Interfaces:**
- Consumes: state `job`, `weapon`, `cast`, `castTotal`, `castAt`, `buffs`, `debuffs` and `marks`, plus the fx `cast`, `castEnd`, `use`, `hit` (`element`, `behind`), `heal`, `shield`, `buff`, `gift`, `revive`, `react` and `miss` (`why`).
- Produces:
  - **`CharacterView.setWeapon(w: WeaponId | 'none', tint?: 'white' | 'black')`.** Each weapon is built once per character as bone-scaled groups (Plan 3's one-draw-call approach), with a drawn and a sheathed (back or hip) variant:

    | weapon | look |
    |---|---|
    | `blade` | the existing one-handed sword, with **no** shield (the Warrior) |
    | `sword` | the existing sword and round shield (the Paladin) |
    | `greatsword` | a 1.4 m two-handed blade, dark steel with a red fuller; held in both hands, sheathed across the back |
    | `daggers` | two 0.35 m curved blades, one per hand; sheathed crossed at the lower back |
    | `staff` | a 1.6 m wooden staff with a faceted crystal head. `tint` white: a teal-white crystal with a pale ring. `tint` black: an ember-violet crystal with dark iron prongs |
    | `bow` | the existing bow |

    The tint comes from `JOBS[job].id` (white_mage → white, black_mage → black).
  - **Poses:**
    - `cast` loops while `cast` ≠ '': the staff is raised, the free hand forward, with a pulsing ring on the ground under the caster in the element colour (fire `roofOrange`, water `teal`, lightning `gold`, earth `rock`, light `cloud`);
    - greatsword and daggers get their own attack swings: an overhead cleave, and alternating stabs.
  - **Spell visuals** (`spells.ts`, pooled, at most 24 live; the oldest is recycled):

    | trigger | visual |
    |---|---|
    | fire projectile | an ember orb, 20 m/s, with a short trail |
    | water | a ribbon of three droplets |
    | lightning | a jagged 6-segment bolt from above the target, shown for 0.15 s, then a flash |
    | earth | three rock shards bursting up under the target |
    | light | a white-gold beam |
    | heal | rising green-gold motes on the healed |
    | shield | a translucent hex bubble for its duration (until `shield` reaches 0 in state) |
    | roar | a ring shockwave, 10 m |
    | aegis | a gold half-dome on the Paladin, and small sigils on allies |
    | sheltered | a thin gold tether from the Paladin to the ally |
    | rain | soft falling streaks within 10 m |
    | mist | the character at 50% alpha |
    | blinded | grey puffs over the enemy |
    | weakpoint | a red diamond over the enemy |
    | gift | a spark arcing from caster to ally |
    | revive | a column of light, 1.5 s |
    | blast | an orange burst plus a ring of 3 m |
    | conduct | a blue-white crackle cage for 1.5 s |
    | steam | a white puff column |
    | bedrock | a stone ring rising round the adventurers it shields |

    `spellVisualFor(ev: FxEvent): VisualSpec | null` is the pure mapping that the test covers.
  - **Overheads:**
    - rooted (a green root icon) and dazed (gold stars) join the mark icons;
    - enemy debuff icons;
    - a remote adventurer's thin cast bar while `cast` ≠ '', from `castAt`.
  - **Remotes:** a weapon change applies on the next frame after `state.weapon` or `state.job` changes. Spare views reset their weapon.
  - **Budget:**
    - all seven job looks on screen add ≤ 8 draw calls over Plan 3's med quality;
    - the spell pool adds ≤ 6 draw calls (thin instances or merged meshes);
    - `?q=low` shows projectiles and rings but no rain streaks and no crackle cage.

- [ ] **Step 1: Write the failing tests** in `spells.test.ts`:
  - every `ElementId` and every `ReactionId` maps to a visual;
  - every support buff maps to one;
  - `hit` with no element and no ability visual → null (Plan 3's arrows and slashes stay in `effects.ts`);
  - the pool never exceeds 24.
- [ ] **Step 2: Run `npx vitest run client/src`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, client `tsc`, `npm run build` and `npm run build:online`. Then the browser check:**
  - `client/dev/jobs.html` under `npm run dev`, at desktop size and on the iPhone 13: screenshots of all seven job looks side by side (idle and attack), and each spell visual and reaction in a grid;
  - start the server on port 2575 with the default start zone (the grove) in the background (note the PID). On two pages, A becomes a Black Mage and B a White Mage at the Guild Board, and both walk through the east gate into the Greenway. Then:
    - screenshot a Thornling hit by B's Tidelash, then A's Skyfall Arc (conduct crackle);
    - Soft Rain;
    - Mistveil's bubble on A;
    - A's staff tint as seen from B;
    - B's remote cast bar seen from A;
  - record the draw calls (`scene.getEngine()._drawCalls` or the inspector counter) with seven different jobs in view, on med and on low;
  - no page errors; `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: weapon models for six weapons, spell and support effects, remote job looks`.

### Task 9: Bots with mixed jobs, the smoke test and the 100-adventurer runs (browser-heavy: the smoke test)

**Files:**
- Modify: `server/scripts/bots.ts`, `server/scripts/smoke.mjs`, `docs/load-test.md`.
- Test: the scripts themselves, run against local servers.

**Interfaces:**
- Consumes:
  - Task 4's `adventurerBrain` with `allies`;
  - Task 6's messages and state;
  - `JOB_IDS`, `JOBS`, `recordFor`;
  - `GROVE_EAST_GATE`, `zoneDef`, `findPath` and `withClearance`.
- Produces:
  - **`bots.ts --jobs mixed`** (only with `--fight`). Bot i:
    1. joins its zone;
    2. if it is in the grove, sends `job { job: JOB_IDS[i % 7] }` and waits for `jobs` with that current job;
    3. sets that job's duo picks with `loadout` when it has a nearby bot partner index (i ^ 1), and solo picks otherwise;
    4. paths to `GROVE_EAST_GATE` and travels;
    5. in the Greenway, sends one `job` for `JOB_IDS[(i + 1) % 7]` and expects `refused { action: 'job', reason: 'not-here' }`;
    6. then fights with the job-aware brain, passing the other bots in its view as `allies`. Ally abilities send `ally`.

    Bots with partner i ^ 1 prefer that partner's target, so duos form.
  - It prints everything from Plan 3, plus:
    - switches accepted;
    - not-here refusals;
    - casts, cast breaks, reactions by id;
    - revives;
    - xp gained by job;
    - kills by job.
  - It **passes** only if all of these hold:
    - Plan 3's gates (ruling P3-i: 0 corrections, ≥ 15 Hz, kills ≥ 50, knockbacks ≥ 1, dodges ≥ 25), measured over the whole run;
    - switches === count;
    - not-here refusals === count;
    - every job has ≥ 1 kill;
    - casts ≥ 100;
    - reactions ≥ 5;
    - p95 `tickMs` ≤ 15;
    - peak RSS ≤ 400 MB.

    Without `--jobs`, bots behave exactly as in Plan 3 (as Warriors).
  - **`smoke.mjs` additions:**
    - The server runs with `SG2_START_ZONE=greenway`, as in Plan 3. All Plan 3 steps run unchanged.
    - **Before** the combat steps, page A presses `J` in the Greenway:
      - the board shows the `REASON_JOB_NOT_HERE` note;
      - choosing Ninja shows the toast;
      - `__sg2net.refusals` has `{ action: 'job', reason: 'not-here' }`;
      - `__sg2net.self.job === 'warrior'`.
    - **After** "Return to the statue" (A is in the grove):
      - A taps the Guild Board, walks over, and the board opens;
      - choosing White Mage → `__sg2net.self.job === 'white_mage'`, the HUD badge shows its glyph, and slot 1's tooltip is Tidelash;
      - A walks to the east gate and into the Greenway, and `__sg2net.self.job` is still `'white_mage'` after the travel;
      - then a sign-out and sign-in of A in a new context shows White Mage again (saved).
    - The kill step uses `--kill "kill <pid>"`.

- [ ] **Step 1: Run the scripts against the current server to watch them fail** (smoke: the first new step; bots: `--jobs` unknown).
- [ ] **Step 2: Implement both.**
- [ ] **Step 3: Run root `npm test` (PASS, pristine). Then the mixed-jobs fight run:**
  - start the server on port 2576 with the default start zone and `SG2_AUTH_RATE_PER_MIN=1000` in the background (note the PID);
  - run `npm run bots -w server -- --url http://localhost:2576 --count 100 --seconds 120 --fight --jobs mixed` → PASS;
  - `kill <pid>`.

  If it fails, profile and fix the server, never the thresholds. The likely fixes, in order:
  1. mirroring only changed fields;
  2. aim resolution cost (cache the adventurers per tick in a grid);
  3. buff ticking only for adventurers with buffs.
- [ ] **Step 4: Run the smoke test:**
  - start the server on port 2577 with `SG2_START_ZONE=greenway` (note the PID);
  - run `node server/scripts/smoke.mjs http://localhost:2577 --kill "kill <pid>"` → PASS.
  - Also run the plain grove bot run (`--count 100 --seconds 30`, no `--fight`) on port 2578, and the clustered one (`--cluster 15`) → PASS, with KiB/s within the Global Constraints. Stop it by PID.
- [ ] **Step 5: Record the printed numbers of all runs in `docs/load-test.md`** (with the date, machine, enemy count 21 and job mix). **Commit**: `test: mixed-job bots, job smoke steps and the 100-adventurer runs`.

### Task 10: Docs: outcome placeholder, roadmap correction and verification list

**Files:**
- Modify:
  - this plan, `docs/superpowers/plans/2026-11-12-sg2-plan-3b-jobs-and-magic.md` (fill `## Outcome`);
  - `docs/superpowers/plans/2026-11-11-sg2-plan-1-online-foundation.md` (the roadmap line for 3b, and line 5's scope).

**Interfaces:**
- **Roadmap 3b** becomes:

  > **Jobs and magic** — seven starting jobs (Warrior, Paladin, Dark Knight, Ninja, White Mage, Black Mage, Ranger) levelled separately on one adventurer, changed only in towns and sanctuary zones; each job's own bar and pick pool (no borrowed abilities), strong support abilities so any two jobs make a duo; the Staff and four elements, cast times and interrupts, element reactions; per-job xp (stub curve); data hooks for Monk, Bard, Beastmaster and Sky Lancer. Done (`2026-11-12-sg2-plan-3b-jobs-and-magic.md`).

  Roadmap 5 gains: "the job level curve and level-gated abilities, job talent trees (about ten points) and retraining for gold, each job's remembered outfit".

- [ ] **Step 1: Run the verification list below. Record each result, with numbers, in `## Outcome`:**
  1. Root `npm test`: the pass and skip counts, pristine.
  2. `npm run typecheck`: clean.
  3. `npm run build` and `npm run build:online` in `client/`: both succeed. The offline demo has no job UI.
  4. The solo and duo band tables from Task 4's report (final numbers), plus every tuning change.
  5. Mixed-job fight run (port 2579, 120 s, 100 bots): Hz, corrections, kills by job, casts, reactions, tick p95, RSS.
  6. The clustered grove walk (port 2579, after the fight run): KiB/s per bot.
  7. `node server/scripts/smoke.mjs` against a fresh server on port 2579: PASS.
  8. Review Focus 1–6: for each, the test names that cover it.
  9. Grep the repository for hard-coded "White Mage" and "Black Mage" outside `shared/src/combat/jobs.ts`, docs and tests: there should be none.
  10. Grep the client bundle for model names, and the repository for secrets (`SG2_JWT_SECRET=` with a value outside docs and the local test command): there should be none.
- [ ] **Step 2: Write `## Outcome (date)`**, in Plan 2's style: status, numbers, decisions made during the build, deferred items (minor), and "For Plan 4" and "For Plan 5" notes.
- [ ] **Step 3: Commit**: `docs: Plan 3b outcome and roadmap`.

## Decisions this plan makes that the spec leaves open

These are recorded so that reviewers can check the tasks against them.

**Jobs**
- The bar belongs to the job, not the weapon. Weapons give only the auto-attack and the model. White Mage and Black Mage share the Staff but have different bars and different crystal tints.
- There are six weapons:
  - Blade (Warrior; the Plan 3 sword without the shield);
  - Sword and Shield (Paladin);
  - Greatsword (Dark Knight);
  - Twin Daggers (Ninja);
  - Staff (both mages);
  - Bow (Ranger).
- Plan 3's four free picks are not a shared pool any more. Mend and Bulwark belong to the Warrior, Taunt to the Paladin, and Sprint to the Ranger, so a Plan 3 Blade save keeps its picks exactly.
- Each job has a pool of four picks. Each job has two pick presets: solo (the default for a new job record) and duo (used by the simulation and suggested on the board). There are no level gates on abilities in 3b.
- Every job has a primer (a non-finisher that sets a mark without detonating) whose mark differs from its finisher's mark. That gives solo combos inside the job, and cross-combos in every pair, mirrors included.
- Picks can change anywhere out of combat. Only the job itself is town-only.
- A job change resets Momentum to 0 and keeps per-ability cooldowns.
- The Ninja's extra dodge is a third charge.
- The grove is a town everywhere. The Greenway has no sanctuaries yet: the list is a data hook.
- The job board opens at a code-built Guild Board in the Plaza (decorative, not an obstacle), or with `J` / a Jobs button anywhere. Outside a town its buttons stay enabled, and the server refuses with a clear reason.
- The `Q` swap and the `swap` message are removed.

**Magic**
- There is no mana. Spells use Momentum costs and cooldowns.
- A cast checks at its start and spends at its end. A failed re-check fizzles with no cost.
- Casting allows walking at 0.5× and is never cancelled by movement, which suits phones. Casts break on the caster's own dodge (no penalty), on knockbacks, and on telegraph hits that land, with a 1.5 s lock; enemy autos do not break them.
- Only Staff spells have elements. Light is a cosmetic school with no reactions.
- Reactions happen when an elemental hit meets a reacting mark: Fire+Marked, Lightning+Soaked, Water+Burning, Earth+Dazed. Finishers still detonate the other marks as plain combos.
- Two new marks: Rooted (slows to 0.6×) and Dazed (detonation fodder).
- Enemies get small elemental weaknesses and resistances (×1.25 / ×0.75).
- There is no ground aiming. Area effects centre on the caster or the target.

**Support and duos**
- Ally aims pick the explicit tapped ally when valid, else the lowest-hp adventurer in range.
- Until Plan 4 every adventurer in the room counts as an ally.
- Second Dawn revives where the adventurer lies, at 40% hp, inside the 30 s respawn window. There is no new movement ack.
- Shelter moves half of each enemy hit from the ally to the Paladin.
- Shields don't stack: the larger one wins.
- White Mage's cleanse is a hook on an empty affliction set.

**Progression boundary**
- Per-job level and xp use a flat stub: 100 xp a level, cap 10. Kill XP is 10 for ordinary enemies and 40 for elites, credited to each credited adventurer's current job. Level has no combat effect in 3b.
- Talents (`[]`) and outfit (`null`) are stored per job for Plan 5.
- The adventurer-level `level`/`xp` columns are left unused.
- The `loadout` column is kept, unused, for rollback.

**Testing and tooling**
- The bands cover:
  - every job solo against each ordinary kind and the Mossback;
  - careless deaths;
  - all 28 pairs (21 distinct plus 7 mirrors) against the Thornling and the Mossback, with synergy (`crossCombos`, `assists`) and the four reactions asserted.
- Only one task (4) tunes numbers, under a written rule.
- New test-only server switch: `SG2_TEST_DUMMY=1` (a dummy camp in the grove), like `SG2_START_ZONE`; never set in Docker.
- The bots switch jobs in the grove and then prove a refusal in the Greenway.

## Outcome

To be written by Task 10.
