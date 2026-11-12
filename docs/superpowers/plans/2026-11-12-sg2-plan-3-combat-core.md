# Shady Grove 2 — Plan 3: Combat Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real fights in a second zone: tap an enemy, auto-attack, build and spend Momentum, swap Blade and Bow, roll out of ground telegraphs, break elites, get knocked back, die and wake at the statue. The server decides all of it, and the Greenway (the woods beyond the east gate) is generated from a seed rather than placed by hand.

**Architecture:** All combat lives in `@sg2/shared/combat`. That covers the maths, the ability and enemy data, a deterministic combat engine (adventurers' actions and the enemies' AI) and a scripted "brain". The tuning simulation and the load-test bots both use the brain. Each zone room on the server runs one engine at `TICK_HZ`. The room feeds it the poses it has accepted and the players' intents. It mirrors the engine into the Colyseus state, sends combat events to clients near them, and stamps every dodge and knockback onto the movement checks, so `checkPose` never refuses an honest client. A small seeded recipe (`generateZone`) produces the Greenway's terrain, road, trees, rocks and enemy camps. The server and the client both run it, and every engine produces exactly the same result. The client swaps its Babylon scene when the server moves the adventurer to another zone room.

**Tech Stack:** as Plans 1–2: TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, PostgreSQL 16 / memory store, Playwright (pre-installed; never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md`. This plan implements:
- section 6 Combat, except Staff and magic, the four elements and their reactions, cast-time spells, weapon skill levels and talents (Plan 3b), and bosses (Plan 4);
- the knockback line of section 5;
- the Greenway's ordinary and elite enemies (section 3);
- "Death returns you to the statue with no item loss" (section 10);
- "The server rejects impossible inputs (speed, range, cooldowns)";
- the combat unit tests in Testing.

It also clears these items from Plan 2's Outcome: "Health is not saved" and "For Plan 3".

## Global Constraints

- **Core loop (spec §6):** tap an enemy to target it; the adventurer attacks automatically in range; attacks build **Momentum** (one bar, 0–100), which finishers spend; dangerous attacks are marked on the ground and dodged.
- **Five buttons:** slots 1–3 come from the equipped weapon: quick skill, finisher, signature. Blade's signature is **Parry** and Bow's is **Charged Shot**. Slots 4–5 are free picks from a shared pool of four: Mend (heal), Taunt, Bulwark (shield) and Sprint (speed). The **dodge roll** has its own button, with 2 charges that refill. Weapons swap mid-fight with a short lockout.
- **Left out on purpose:** long rotations, a required healer or tank, a second resource bar, split-second timing (every telegraph winds up for at least 1.0 s), standing wind mechanics.
- **Server-authoritative:** clients send intents only:
  - a target id;
  - an ability slot with press or release;
  - swap;
  - a dodge direction together with the pose it starts from;
  - the free picks;
  - respawn.
  The server decides hits, damage, heals, cooldowns, Momentum, marks, stagger, deaths, knockback and dodge end points.
- **Hits are decided by ground x/z only.** No combat rule reads `y`: being in the air never avoids a ground attack.
- **Honest clients are never corrected** by movement checks during or after a dodge or knockback. Three mechanisms make sure of this:
  - the displacement ack (`Pose.ack`);
  - `DISPLACE_FUZZ_M = 0.5` of extra allowance;
  - a speed-scale grace of 0.5 s.
  `RANGE_FUZZ = 1.0` m covers latency on ability ranges.
- **One shared rules package:** combat maths, data, the engine, the enemy AI, the brain and the zone generator live in `@sg2/shared`. The server and client import them and never copy them.
- **Scale:**
  - 100 adventurers per zone room at `TICK_HZ = 15` with combat active.
  - Enemy budget: at most `MAX_ENEMIES_PER_ZONE = 40` per room; the Greenway places 21 (19 ordinary + 2 elites).
  - At most 4 enemy path searches per tick, with at most 1500 nodes each.
  - Zone tick p95 ≤ 15 ms.
  - Server peak RSS ≤ 400 MB, on a 16 GB host shared with other services.
- **Phone-first:**
  - every touch control is at least 48 px: ability buttons 64 px, the dodge button 64 px, swap 56 px, jump 72 px;
  - the ability arc, dodge and jump sit under the right thumb;
  - none of them overlaps the joystick zone.
- **Desktop keys:** 1–5 abilities (hold 3 to charge the Charged Shot), Shift or double-tap a movement key to dodge, Q swap, Tab next target, Esc clear target.
- **"Tap to walk" setting:**
  - tapping an enemy always targets it;
  - walking into range happens only while the setting is on.
- **Art:** everything is built in code, flat-shaded low-poly with toon lighting, in `PALETTE` colours. No asset files.
- **Generated, never hand-placed:** `generateZone(GREENWAY_RECIPE)` makes the Greenway's terrain, road, trees, rocks, camps and spawn points. It uses only exactly-rounded arithmetic: no `Math.sin/cos/exp/pow/hypot/random`, and no `**`.
- **Zones:**
  - one room per zone, `grove` and `greenway`;
  - travel works by walking through the east gate or the Greenway's west gate;
  - the server saves the adventurer's zone, moves them, and the client switches scenes.
- **Persistence:** health, zone and loadout are saved with the adventurer. A dead adventurer is saved as respawned: at the statue, at full health.
- Everything from Plans 1–2 keeps working:
  - accounts, naming, chat, reconnect, duplicate-login kick (now across rooms);
  - the speed allowance, the message throttle, height checks, fall damage that never kills;
  - tap-to-walk and its setting, Docker packaging.
  Root `npm test` stays green with pristine output.
- **Both client builds keep working.** `npm run build` (the offline single-file demo) stays the combat-free walkable town. `npm run build:online` gets everything.
- **Out of scope** (design so it slots in, do not build): Staff, elements, reactions and Soaked sources, weapon skill levels and talents (3b); parties, loot, boss arenas, the Fallen Warden (4); levels, XP, gear stats, sets, inventory, costumes, GM tools (5); quests (6); the general world generator (7).
- **Environment:**
  - no secrets in the repository;
  - never touch anything outside the repository: no global installs, no system services, no killing processes the task did not start;
  - Playwright is pre-installed, so never install it.
- **Browser checks:**
  - headless WebGL runs at about 1 fps, so measure game time, not wall time;
  - open pages with `?lockq`;
  - Tasks 7, 8 and 9 are browser-heavy, and only one of them may run at a time;
  - local test servers use ports 2571–2579 with `SG2_STORE=memory`, are started in the background with their PID recorded, and are stopped with `kill <pid>`. Never use `fuser` or kill by name; `smoke.mjs` gets `--kill "kill <pid>"`.
- **Git:**
  - TDD: write the failing test first;
  - stage explicit paths only (`git add <paths>`, never `-A` or `.`);
  - every commit message ends with exactly these two lines:
    ```
    Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
    Claude-Session: https://claude.ai/code/session_01YDaH79F8gHUx42PWzrB3f9
    ```
  - no model names anywhere else.

## Numbers (all in `shared/src/combat/constants.ts` unless noted)

**Stats and damage**
- Starter stats: `STARTER_STATS = { power: 10, defence: 10, maxHp: 100 }` (fixed until Plan 5).
- `DEFENCE_K = 40`; `mitigation(d) = 40 / (40 + d)`.
- An adventurer's hit: `hitDamage(coef, power, def, mult) = max(1, round(coef·power·mitigation(def)·mult))`.
- An enemy's hit: `enemyHit(raw, def, mult) = max(1, round(raw·mitigation(def)·mult))`. Against starter defence 10 that is ×0.8.
- No critical hits until Plan 5.

**Momentum and global timers**

| Constant | Value |
|---|---|
| `MOMENTUM_MAX` | 100 |
| `AUTO_MOMENTUM` | 10 |
| `FINISHER_COST` | 50 |
| `PARRY_MOMENTUM` | 20 |
| `PERFECT_DODGE_MOMENTUM` | 10 |
| `MOMENTUM_DECAY_DELAY_S` | 6 (decay begins after 6 s without dealing damage) |
| `MOMENTUM_DECAY_PER_S` | 10 |
| `GCD_S` | 0.5 (between abilities; autos run on their own timer) |
| `SWAP_LOCKOUT_S` | 0.8 (no autos or abilities) |
| `SWAP_COOLDOWN_S` | 2 |
| `COMBAT_TIMEOUT_S` | 5 |

**Range and targeting**

| Constant | Value |
|---|---|
| `MELEE_REACH` | 2.5 m |
| `ADVENTURER_RADIUS` | 0.4 m |
| `TARGET_RANGE` | 40 m |
| `TARGET_DROP_RANGE` | 50 m |
| `RANGE_FUZZ` | 1.0 m |
| `LOS_STEP` | 0.5 m |
| `LOS_END_SKIP` | 1.0 m |

Reach is measured from the adventurer's position to the edge of the target's radius.

**Dodge and knockback**

| Constant | Value |
|---|---|
| `DODGE_CHARGES` | 2 |
| `DODGE_REFILL_S` | 5 (one charge at a time) |
| `DODGE_DISTANCE` | 4.5 m |
| `DODGE_S` | 0.3 (15 m/s) |
| `DODGE_IFRAME_S` | 0.35 |
| `DODGE_MIN_GAP_S` | 0.4 |
| `PERFECT_DODGE_WINDOW_S` | 0.6 |
| `PERFECT_DODGE_STAGGER` | 15 |
| `KNOCK_MAX_VY` | 6 m/s (≤ `JUMP_SPEED`, so the existing jump ceiling covers launches) |
| `KNOCK_RECOVER_S` | 0.2 |
| `DISPLACE_FUZZ_M` | 0.5 |
| `DISPLACE_SUBSTEP_M` | 0.1 (largest sub-step distance, so walls 0.25 m or thicker are never crossed at 15 m/s) |
| `DISPLACE_MAX_S` | 3 |

**Marks, stagger and threat**

| Constant | Value |
|---|---|
| `MARK_S` | 8 |
| `COMBO_COEF` | 3.0 |
| `COMBO_STAGGER` | 25 |
| `BURNING_COEF_PER_S` | 0.25 (ticks once a second) |
| `BREAK_STUN_S` | 4 |
| `BREAK_DAMAGE_MULT` | 1.5 |
| `STAGGER_DECAY_DELAY_S` | 4 |
| `STAGGER_DECAY_PER_S` | 5 |
| `INTERRUPT_STAGGER` | 25 |
| `PARRY_STAGGER` | 35 |
| `PARRY_STUN_S` | 1.0 (ordinary enemies) |
| `AGGRO_THREAT` | 1 |
| `THREAT_PER_DAMAGE` | 1 |
| `THREAT_PER_HEAL` | 0.5 |
| `TAUNT_S` | 4 |
| `TAUNT_MULT` | 1.1 |
| `TAUNT_BONUS` | 10 |
| `TARGET_SWITCH_MULT` | 1.1 |

**Death and respawn**

| Constant | Value |
|---|---|
| `DEATH_MIN_S` | 3 |
| `AUTO_RESPAWN_S` | 30 |
| `RESPAWN_CLEAR_RADIUS` | 6 m (an enemy waits to respawn while an adventurer stands this close) |

**Budgets and client timing**

| Constant | Value |
|---|---|
| `MAX_ENEMIES_PER_ZONE` | 40 |
| `ENEMY_PATH_NODES` | 1500 |
| `ENEMY_REPLAN_S` | 1.0 |
| `PATHS_PER_TICK` | 4 |
| `UNREACHABLE_S` | 3 |
| `FX_RADIUS` | 60 m |
| `CHARGE_SLOW_GRACE_S` | 0.25 |
| `SPEED_GRACE_S` | 0.5 |
| `TELEGRAPH_LEAD_S` | 0.15 (client only: decals fill this much early) |

**Weapons** (`shared/src/combat/abilities.ts`):
- Blade: auto every 1.2 s, coef 1.0, melee.
- Bow: auto every 1.5 s, coef 1.1, range 18 m.

**Abilities** (slot order: quick, finisher, signature, free, free)

| id | name | glyph | slot | cd s | effect |
|---|---|---|---|---|---|
| `slash` | Slash | ⟋ | Blade 1 | 4 | coef 1.8, +20 Momentum, melee |
| `sunder` | Sunder | ✦ | Blade 2 | 6 | costs 50; coef 4.0; leaves **Marked**; +10 stagger; interrupts; melee |
| `parry` | Parry | ◈ | Blade 3 | 8 | 0.6 s window. Negates the next parryable melee hit on you (an auto or a telegraph with `parryable`): +20 Momentum; the attacker takes +35 stagger if elite, else is stunned 1.0 s |
| `snap_shot` | Snap Shot | ↣ | Bow 1 | 5 | coef 2.0, +20 Momentum, 18 m |
| `pitch_arrow` | Pitch Arrow | ✷ | Bow 2 | 6 | costs 50; coef 3.2; leaves **Burning** (0.25 coef/s for 8 s); +10 stagger; 18 m |
| `charged_shot` | Charged Shot | ⇶ | Bow 3 | 7 | hold, then release (full charge at 1.5 s; auto-release at 2.5 s); frac = held/1.5 capped at 1 |
| `mend` | Mend | + | free | 20 | heals 30 instantly |
| `taunt` | Taunt | ! | free | 12 | 15 m; the target attacks you for 4 s; your threat becomes top × 1.1 + 10 |
| `bulwark` | Bulwark | ◆ | free | 18 | absorbs 25 damage for 6 s |
| `sprint` | Sprint | » | free | 20 | +40% run speed for 4 s |

Charged Shot in detail:
- damage coef 1.5 + 3.0·frac;
- stagger 10 + 20·frac;
- Momentum +15·frac;
- interrupts if frac ≥ 0.8;
- range 22 m;
- while charging: moving at 0.4×, no autos.

The default loadout is `{ weapon: 'blade', free: ['mend', 'bulwark'] }`.

**Combos:** when a finisher hits a target, every live mark other than its own detonates:
- `hitDamage(COMBO_COEF)` damage;
- `COMBO_STAGGER`;
- the mark is removed.

The finisher's own mark is then applied, or refreshed. Soaked is defined, but nothing applies it before 3b.

**Enemies** (`shared/src/combat/enemies.ts`). Raw damage is before the adventurer's defence; ×0.8 for a starter.

| kind | name | hp | def | radius | speed | aggro | leash | auto (reach, every, raw) | telegraphed attack | respawn s |
|---|---|---|---|---|---|---|---|---|---|---|
| `thornling` | Thornling | 210 | 6 | 0.5 | 5.0 | 7 | 25 | melee 1.8 m, 1.6 s, 6 | **Thorn Burst**: circle r 3 on itself; wind-up 1.0 s; raw 18; cd 7; first at 3 s; parryable | 25 |
| `boar` | Bramble Boar | 180 | 12 | 0.8 | 4.5 | 7 | 25 | melee 2.2 m, 2.0 s, 8 | **Gore Charge**: line 9 × 1.8 m from itself toward the target, used within 8 m; wind-up 1.3 s; raw 22; knock 10 m/s for 0.35 s, vy 4; then the boar dashes to the line's end; cd 8; first at 3 s | 25 |
| `archer` | Hollow Archer | 210 | 6 | 0.5 | 4.0 | 9 | 25 | ranged 14 m (stops at 12), 2.2 s, 7 | **Briar Volley**: circle r 2.5 at the target's position when the wind-up starts; wind-up 1.5 s; raw 20; cd 9; first at 3 s | 25 |
| `mossback` (elite, stagger 100) | Mossback | 750 | 15 | 1.3 | 4.0 | 9 | 30 | melee 2.8 m, 2.4 s, 7 | **Ground Slam**: circle r 4.5 on itself; wind-up 1.6 s; raw 40; knock 12 m/s for 0.4 s, vy 5; cd 9; first at 4 s; parryable; not interruptible. **Thorn Hail**: cone 70°, r 11, toward the target; wind-up 2.2 s; raw 30; cd 14; first at 7 s; **interruptible**. The Mossback slams if its target is within 4 m when both are ready, otherwise hails. | 90 |
| `dummy` | Training Dummy | 40 | 0 | 0.5 | 0 | 0 | — | none | none (tests only) | 5 |

### Why these numbers give the spec's bands

Time to kill an ordinary enemy (10–15 s), counted from the first hit, with no time lost:
- **Blade against a Thornling** (mitigation 40/46 = 0.870). Hits are: auto 9, Slash 16, Sunder 35.
  - Sustained damage is 9/1.2 + 16/4 + 35/6 = 17.3 per second.
  - Momentum reaches 50 at 3.6 s: four autos (40) plus a Slash (20) gives 60, so the first Sunder lands at 3.6 s.
  - The second Sunder lands at 9.6 s, with Momentum full at 100.
  - Cumulative damage is 208 at 10.8 s and 217 at 12.0 s, so a 210 hp Thornling dies at **12.0 s**.
- **Bow against a Thornling.** Hits are: auto 10, Snap 17, Pitch 28, Burning 2 a second.
  - Momentum reaches 50 at 3.0 s, so Pitch Arrow lands at 3.0 s and again at 9.0 s.
  - Cumulative damage is 203 at 11 s and 213 at 12 s, so it dies at **12.0 s**.
- **Against a Boar** (mitigation 0.769, 180 hp):
  - Blade hits 8 / 14 / 31: 176 at 9.6 s, 184 at 10.8 s, so **10.8 s**.
  - Bow hits 8 / 15 / 25 plus Burning 2: 175 at 11 s, 185 at 12 s, so **12.0 s**.
- **Against an Archer** (the same mitigation as a Thornling, 210 hp): **12.0 s** with either weapon.
- **Time lost:** dodging a telegraph costs about one auto (0.7 s). After a Gore Charge a Blade wielder walks back to the boar, about 2 s. One or two telegraphs per fight puts real kills at 12–14 s, inside the band.

The elite (Mossback, mitigation 40/55 = 0.727, 750 hp):
- **Damage dealt:**
  - Blade sustains 7/1.2 + 13/4 + 29/6 = 13.9 per second; Bow sustains 14.2.
  - About two breaks, each 4 s at ×1.5, take roughly 4 s off.
  - Expected kill: 50–58 s.
- **A careless starter** (never dodges or parries) takes:
  - autos 6 per 2.4 s = 2.5/s;
  - Slam 32 per 9 s = 3.6/s;
  - Hail 24 per 14 s = 1.7/s;
  - 7.8 per second in all.

  Mend (30 every 20 s) and Bulwark (25 every 18 s) give back about 2.9 per second. That is a net loss of about 4.9 per second, so a careless starter is dead in about 25 s, half the time the kill needs.
- **A careful starter** takes only the autos: 2.5/s × 55 s ≈ 138. Over the same 55 s, heals and shields offer about 160, so they finish with well over 25 hp.

**Tuning rule:** if a band in Task 3 fails, change only enemy `hp` (±20%), and elite `raw` values if needed. Never change the formula or the adventurer's numbers. Record every change in the task report.

## Review Focus

1. **Relogging to heal or to escape.** Logging out at 20 hp in a fight and back in still gives 20 hp, in the same zone. Enemies drop the leaver from their threat. A player who disconnects while dead comes back at the statue with full health. → Tasks 5, 6.
2. **Moves in flight during a knockback or a dodge.** The client keeps sending pre-knockback poses until the `displaced` message arrives. It is never corrected: stale moves are ignored by ack. The first poses from the end point are accepted. → Tasks 1, 6.
3. **Intent spam and nonsense:**
  - 50 ability messages a second;
  - repeated dodges;
  - targets that do not exist, are dead, are in another room or are 2 km away;
  - slot 9, NaN directions, a release without a press, respawn while alive.
  Each is refused or ignored with no state change, and the room stays up. → Task 6.
4. **The last-moment dodge.** A dodge the server accepts one tick before a telegraph resolves avoids it, because the end point counts at once and the i-frames start on receipt. Decals fill 0.15 s early, so what the player sees errs in their favour. → Tasks 3, 8.
5. **An adventurer the enemy cannot reach** (on a rock top, or across walls with no path). The enemy hits them if they are within horizontal reach. Otherwise it gives up after `UNREACHABLE_S` and returns to its camp, invulnerable and fully healed, instead of freezing or jittering. → Task 3.

---

### Task 1: Shared combat rules and data

**Files:**
- Create in `shared/src/combat/`: `constants.ts`, `stats.ts`, `momentum.ts`, `marks.ts`, `stagger.ts`, `threat.ts`, `shapes.ts`, `displace.ts`, `sight.ts`, `abilities.ts`, `enemies.ts`, `fx.ts`, `index.ts`
- Modify: `shared/src/index.ts` (`export * from './combat'`), `shared/src/movement.ts` (`refillAllowance` speed scale; `Pose.ack`)
- Test: `shared/src/combat/rules.test.ts`, `shared/src/combat/displace.test.ts`, `shared/src/combat/data.test.ts`, additions to `shared/src/movement.test.ts`

**Interfaces:**
- Produces: the constants under Numbers, exactly, and these:
```ts
// stats.ts
export interface Stats { power: number; defence: number; maxHp: number }
export const STARTER_STATS: Stats;
export function mitigation(defence: number): number;                         // DEFENCE_K / (DEFENCE_K + max(0, defence))
export function hitDamage(coef: number, power: number, defence: number, mult?: number): number; // 0 if coef <= 0, else max(1, round(...))
export function enemyHit(raw: number, defence: number, mult?: number): number;
// momentum.ts
export function gainMomentum(m: number, amount: number): number;             // clamped 0..MOMENTUM_MAX
export function decayMomentum(m: number, sinceDamageS: number, dt: number): number;
// marks.ts
export type MarkId = 'soaked' | 'burning' | 'marked';
export const MARK_BITS: Record<MarkId, number>;                               // soaked 1, burning 2, marked 4
export type Marks = Partial<Record<MarkId, number>>;                          // mark -> expiry (s)
export function applyFinisherMark(marks: Marks, mark: MarkId, nowS: number): MarkId[]; // returns detonated marks (removed); then sets mark
export function liveMarks(marks: Marks, nowS: number): MarkId[];
export function markBits(marks: Marks, nowS: number): number;
// stagger.ts
export interface StaggerBar { value: number; max: number; brokenUntil: number; lastGainAt: number }
export function addStagger(bar: StaggerBar, amount: number, nowS: number): boolean;  // true = broke (value 0, brokenUntil = now + BREAK_STUN_S); no gain while broken; max 0 = no bar
export function tickStagger(bar: StaggerBar, nowS: number, dt: number): void;
export function isBroken(bar: StaggerBar, nowS: number): boolean;
// threat.ts
export class ThreatTable {
  add(id: number, amount: number): void; remove(id: number): void; clear(): void; has(id: number): boolean; ids(): number[];
  taunt(id: number, nowS: number): void;          // threat = top·TAUNT_MULT + TAUNT_BONUS, forced for TAUNT_S
  /** Forced target while taunted; else the top, but leaves `current` only for one ≥ TARGET_SWITCH_MULT × current's. */
  choose(current: number | null, nowS: number, valid: (id: number) => boolean): number | null;
}
// shapes.ts — yaw convention as `facing`: dir 0 points +Z, positive turns toward +X
export type Shape =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'cone'; x: number; z: number; dir: number; r: number; angle: number }   // angle = full width (rad)
  | { kind: 'line'; x: number; z: number; dir: number; length: number; width: number };
export function inShape(s: Shape, x: number, z: number): boolean;            // ground x/z only, no y parameter
export function escapeDir(s: Shape, x: number, z: number): { x: number; z: number }; // unit vector toward the nearest boundary of s (circle: radial; cone: the nearer side edge, perpendicular to it, or the arc; line: sideways)
// displace.ts
export interface Displacement { vx: number; vz: number; vy: number; seconds: number }
export interface DisplaceResult { x: number; z: number; y: number; drop: number; seconds: number; path: { t: number; x: number; z: number; y: number }[] }
export function simulateDisplacement(start: { x: number; z: number; y: number }, d: Displacement, surface: Surface): DisplaceResult;
export function dodgeDisplacement(dx: number, dz: number): Displacement;   // normalises (dx,dz); speed DODGE_DISTANCE/DODGE_S, vy 0
export function knockDisplacement(from: { x: number; z: number }, at: { x: number; z: number }, k: Knock, lineDir?: number): Displacement; // away from `from` (along lineDir for lines), vy ≤ KNOCK_MAX_VY
// sight.ts
export function lineOfSight(sight: (x: number, z: number) => boolean, ax: number, az: number, bx: number, bz: number): boolean;
// abilities.ts
export type WeaponId = 'blade' | 'bow';
export type AbilityId = 'slash' | 'sunder' | 'parry' | 'snap_shot' | 'pitch_arrow' | 'charged_shot' | 'mend' | 'taunt' | 'bulwark' | 'sprint';
export interface AbilityData {
  id: AbilityId; name: string; glyph: string; desc: string; weapon: WeaponId | 'any';
  role: 'quick' | 'finisher' | 'signature' | 'free'; kind: 'damage' | 'heal' | 'defence' | 'utility';
  cooldown: number; range: number; /* 0 = self, MELEE_REACH = melee */ needsTarget: boolean;
  coef?: number; momentum?: number; cost?: number; mark?: MarkId; stagger?: number; interrupts?: boolean;
}
export const ABILITIES: Record<AbilityId, AbilityData>;
export interface WeaponData { id: WeaponId; name: string; autoEvery: number; autoCoef: number; autoRange: number; bar: [AbilityId, AbilityId, AbilityId] }
export const WEAPONS: Record<WeaponId, WeaponData>;
export const FREE_POOL: readonly AbilityId[];                                 // ['mend', 'taunt', 'bulwark', 'sprint']
export interface Loadout { weapon: WeaponId; free: [AbilityId, AbilityId] }
export const DEFAULT_LOADOUT: Loadout;
export function slotsFor(l: Loadout): AbilityId[];                           // 5 ids
export function parseLoadout(v: unknown): Loadout | null;                    // free: two distinct FREE_POOL ids
// enemies.ts
export type EnemyKindId = 'thornling' | 'boar' | 'archer' | 'mossback' | 'dummy';
export type EnemyAttackId = 'thorn_burst' | 'gore_charge' | 'briar_volley' | 'ground_slam' | 'thorn_hail';
export interface Knock { speed: number; seconds: number; vy: number }
export interface EnemyAttackData {
  id: EnemyAttackId; name: string; shape: 'circle-self' | 'circle-target' | 'cone' | 'line';
  r?: number; angle?: number; length?: number; width?: number;
  windup: number; raw: number; cooldown: number; firstAt: number; useRange: number;
  parryable: boolean; interruptible: boolean; knock?: Knock; dashToEnd?: boolean;
}
export interface EnemyKindData {
  id: EnemyKindId; name: string; elite: boolean; hp: number; defence: number; radius: number; speed: number;
  aggro: number; leash: number; respawn: number; stagger: number; // 0 = no bar
  auto: { reach: number; every: number; raw: number; ranged: boolean } | null; keepRange?: number;
  attacks: EnemyAttackId[];
}
export const ENEMY_KINDS: Record<EnemyKindId, EnemyKindData>;
export const ENEMY_ATTACKS: Record<EnemyAttackId, EnemyAttackData>;
// fx.ts — combat events the server sends; entity ids are engine ids (adventurers and enemies share one space)
export type FxEvent =
  | { t: 'hit'; src: number; dst: number; amount: number; absorbed: number; by: AbilityId | EnemyAttackId | 'auto' | 'burning'; combo?: MarkId[] }
  | { t: 'heal'; src: number; dst: number; amount: number }
  | { t: 'use'; src: number; ability: AbilityId; dst?: number; frac?: number }
  | { t: 'swing'; src: number; dst: number }
  | { t: 'miss'; src: number; dst: number; perfect: boolean }      // dst was invulnerable (dodging)
  | { t: 'mark'; dst: number; mark: MarkId; on: boolean }
  | { t: 'parry'; src: number; dst: number }
  | { t: 'break'; dst: number }
  | { t: 'interrupt'; dst: number }
  | { t: 'dodge'; src: number }
  | { t: 'death'; dst: number }
  | { t: 'spawn'; dst: number };
```
- `movement.ts`:
  - `refillAllowance(allowance, dtSeconds, scale = 1)` refills at `MAX_MOVE_SPEED·scale` and caps at `MAX_MOVE_ALLOWANCE·max(1, scale)`;
  - `Pose` gains `ack?: number`. `parsePose` keeps it when it is an integer from 0 to 2³¹−1, treats a missing one as 0, and returns null for anything else.
- `simulateDisplacement` rules:
  - the body starts at `start`, grounded if within 0.05 m of the surface;
  - `vy > 0` lifts it off the ground;
  - it steps the shared `stepBody` with horizontal input `(vx, vz)` for `seconds` and zero input afterwards, until grounded or `DISPLACE_MAX_S`;
  - each `stepBody` call is short enough that the body moves at most `DISPLACE_SUBSTEP_M`;
  - `path` is sampled every `1/TICK_HZ` and at the end;
  - `drop` is the landing's drop, as from `stepBody`.

- [ ] **Step 1: Write the failing tests**
```ts
// rules.test.ts
expect(mitigation(10)).toBe(0.8); expect(mitigation(15)).toBeCloseTo(0.7273, 4);
expect(hitDamage(1, 10, 10)).toBe(8); expect(hitDamage(4, 10, 6)).toBe(35); expect(hitDamage(0.01, 10, 10)).toBe(1); expect(hitDamage(0, 10, 10)).toBe(0);
expect(enemyHit(40, 10)).toBe(32); expect(enemyHit(7, 10)).toBe(6);
expect(gainMomentum(95, 10)).toBe(100); // decay: none before 6 s without damage, then 10/s, never below 0
// applyFinisherMark({}, 'marked') → []; then 'burning' → ['marked'] and only burning remains; 'burning' again → [] (refresh); an expired mark is not detonated
// addStagger to 100 → true, value 0; no gain while broken; decays 5/s only after 4 s without gain; max 0 never breaks
// ThreatTable: current 100 vs other 105 → stays; vs 111 → switches; taunt forces for exactly TAUNT_S, then back to the top
// inShape: circle edge (r − 0.01 in, r + 0.01 out); cone 70° r 11: in at 30° off-axis, out at 40°, out at 11.1 m; line 9 × 1.8: in at 4 m along and 0.85 m aside, out at 0.95 m aside and at 9.1 m along
// escapeDir: for every 0.25 m grid point inside each attack shape in ENEMY_ATTACKS (for circle-self, outside the owner's radius), moving DODGE_DISTANCE along it leaves the shape
// lineOfSight: a wall circle between two points blocks; a platform does not; obstacles within 1 m of either end are ignored
// displace.test.ts
// flat: a dodge travels 4.5 ± 0.05 m in 0.3 s and ends grounded; path length === ceil(0.3 * 15) + 1
// into a wall: stops before it; a 0.25 m-thick wall is never crossed at 15 m/s (thin walls)
// knocked off a 5 m ledge: drop 5 ± 0.1, fallDamage(drop) === 20
// a launch with vy 5: feeding every path sample at 15 Hz through checkPose (allowance Infinity) gives 'ok' each time
// the same input gives the same result, bit for bit
// movement.test.ts: refillAllowance(0, 1, 1.4) ≈ 10.92 and is capped at 8.3 * 1.4; default unchanged;
// parsePose keeps ack 3, defaults a missing ack to 0, returns null for ack 1.5, -1 or '2'
// data.test.ts
// every weapon bar is [quick, finisher, signature] of that weapon; quick: momentum > 0 and no cost; finisher: cost === FINISHER_COST and a mark
// FREE_POOL: 4 ids, weapon 'any'; glyphs are 1–2 characters, unique, none an emoji (no code point ≥ U+1F000, no U+FE0F)
// ENEMY_KINDS: exactly 3 ordinary kinds besides 'dummy', each with exactly 1 attack and stagger 0;
// exactly 1 elite with 2 attacks, exactly one of them interruptible, and stagger > 0
// every windup ≥ 1.0 s; every knock.vy ≤ KNOCK_MAX_VY ≤ JUMP_SPEED
// parseLoadout rejects duplicates, unknown ids and weapon abilities in free slots
```
- [ ] **Step 2: Run `npx vitest run shared`. Expected: FAIL (modules missing).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npx vitest run`: PASS. Run `npx tsc --noEmit` in `shared/`, `server/` and `client/`: clean.**
- [ ] **Step 5: Commit**: `feat: shared combat rules, abilities and enemy data`.

### Task 2: Combat engine I: adventurers

**Files:**
- Create: `shared/src/combat/engine.ts` (the world, tick, intents), `shared/src/combat/adventurer.ts` (actions, autos, abilities)
- Test: `shared/src/combat/engine.test.ts` (flat synthetic zones: `surface = ground = () => 0` inside a 100 m square, plus walls where a test needs one)

**Interfaces:**
- Consumes: everything from Task 1, `Surface`, `stepBody`, `HP_REGEN_PER_S`, `HP_REGEN_DELAY_S`, `MAX_HP`.
- Produces:
```ts
export interface CampSpawn { kind: EnemyKindId; x: number; z: number; facing: number }
export interface CombatZone { surface: Surface; ground: Surface; sight: (x: number, z: number) => boolean; camps: readonly CampSpawn[] }
export type Act = '' | 'charge' | 'dodge' | 'knock' | 'stun' | 'dead' | 'return';
export interface CombatantView {
  id: number; team: 'adventurer' | 'enemy'; kind: 'adventurer' | EnemyKindId;
  x: number; z: number; y: number; facing: number; hp: number; maxHp: number; alive: boolean; shield: number;
  marks: number; stagger: number; maxStagger: number; targetId: number | null; act: Act;
  windup: { attack: EnemyAttackId; total: number; left: number; interruptible: boolean } | null;
}
export interface SelfView {
  momentum: number; weapon: WeaponId; slots: AbilityId[]; cd: number[]; gcd: number; swapCd: number; swapLock: number;
  dodgeCharges: number; dodgeNextIn: number; charge: number | null; inCombat: boolean;
}
export interface TelegraphView { id: number; owner: number; attack: EnemyAttackId; shape: Shape; total: number; left: number }
export interface DisplaceOut { id: number; kind: 'dodge' | 'knock'; from: { x: number; z: number; y: number }; d: Displacement; result: DisplaceResult }
export interface TickOut { fx: FxEvent[]; displaced: DisplaceOut[]; died: number[]; kills: { enemy: number; kind: EnemyKindId; credit: number[] }[] }
export type Intent =
  | { t: 'target'; id: number | null }
  | { t: 'ability'; slot: number; phase: 'press' | 'release' }
  | { t: 'swap' }
  | { t: 'dodge'; dx: number; dz: number; from: { x: number; z: number; y: number }; grounded: boolean }
  | { t: 'loadout'; free: [AbilityId, AbilityId] };
export type Refusal = 'dead' | 'busy' | 'invalid' | 'cooldown' | 'momentum' | 'no-target' | 'range' | 'sight' | 'charges' | 'air' | 'in-combat';
export interface Combat {
  addAdventurer(a: { x: number; z: number; y: number; facing: number; hp: number; loadout: Loadout }, nowS: number): number;
  removeAdventurer(id: number): void;                          // also drops it from every threat table
  setPose(id: number, x: number, z: number, y: number, facing: number): void;
  intent(id: number, i: Intent, nowS: number): Refusal | null; // null = accepted
  damage(id: number, amount: number, nowS: number, cause: 'fall'): number; // never kills (leaves 1 hp), ignores i-frames; returns hp taken
  revive(id: number, at: { x: number; z: number; y: number }, nowS: number): void; // full hp, Momentum 0, cooldowns and charges reset, marks cleared
  tick(nowS: number): TickOut;
  get(id: number): CombatantView | undefined; self(id: number): SelfView | undefined;
  all(): Iterable<CombatantView>; telegraphs(): Iterable<TelegraphView>;
  speedScale(id: number, nowS: number): number;               // 1.4 while sprinting (+SPEED_GRACE_S), 0.4 from CHARGE_SLOW_GRACE_S into a charge, else 1
  loadout(id: number): Loadout | undefined;
}
export function createCombat(zone: CombatZone, opts: { seed: number; nowS: number }): Combat; // spawns every camp at once
```
- Rules (Task 2; enemies are passive until Task 3):
  - **Intent checks**, in this order:
    - dead → `'dead'`;
    - dodging, knocked, or in swap lockout → `'busy'`;
    - a bad slot or phase → `'invalid'`;
    - within the GCD or the ability's cooldown → `'cooldown'`;
    - Momentum below cost → `'momentum'`;
    - `needsTarget` without a live enemy target → `'no-target'`;
    - reach > `range + RANGE_FUZZ` → `'range'`;
    - no `lineOfSight(zone.sight)` → `'sight'`.
  - **Targeting:**
    - `target` requires a live enemy within `TARGET_RANGE`;
    - an unknown id → `'invalid'`;
    - a target that is too far, or beyond `TARGET_DROP_RANGE` later, is refused or dropped.
  - **Autos** run every tick:
    - only when alive, with a live enemy target within the weapon's range (no fuzz) and in sight, and not charging, dodging, knocked or in swap lockout;
    - each swing is `hitDamage(autoCoef)` plus `AUTO_MOMENTUM`;
    - the next swing comes `autoEvery` later;
    - out of range, the timer waits, so a swing comes at once on arrival.
  - **Abilities** apply as in the table:
    - damage gets ×`BREAK_DAMAGE_MULT` while the target is broken;
    - every hit adds `THREAT_PER_DAMAGE × damage` to the target's threat;
    - finishers spend exactly `FINISHER_COST` and detonate marks;
    - `interrupts` cancels an interruptible wind-up (Task 3 provides wind-ups).
  - **Charged Shot:**
    - `press` starts the charge (`act 'charge'`), and `release` fires it;
    - it releases itself at 2.5 s;
    - a dodge, knock, swap or death cancels it with no cooldown.
  - **Swap:**
    - changes `slots`;
    - cooldowns are kept per ability id;
    - Momentum is kept.
  - **Dodge:**
    - needs `grounded` (else `'air'`), a charge (else `'charges'`) and `DODGE_MIN_GAP_S` since the last dodge;
    - a zero direction uses the facing;
    - the position becomes the end of `simulateDisplacement`;
    - the adventurer is invulnerable for `DODGE_IFRAME_S`;
    - it emits a `DisplaceOut` of kind `'dodge'`.
  - **Mend** never heals above the maximum. **Bulwark** absorbs before hp.
  - **Burning** ticks every second.
  - **`loadout`** is refused with `'in-combat'` while in combat.
  - **In combat** means combat damage dealt or taken within `COMBAT_TIMEOUT_S`, or being on any live enemy's threat table.
  - **Regen:** out of combat, `HP_REGEN_PER_S` once `HP_REGEN_DELAY_S` has passed since the last damage.
  - **Momentum decay** as in Task 1.
  - **Deaths:** an adventurer whose hp reaches 0 from combat damage goes into `died` and becomes `act 'dead'`.
  - **Enemy deaths:** an enemy at 0 hp goes into `kills`, with credit to every adventurer on its threat table. It respawns at its camp spot after `respawn` s, waiting while any adventurer is within `RESPAWN_CLEAR_RADIUS` and retrying every 1 s.
  - **Randomness:** only the seeded generator (mulberry32) is used; no `Math.random`.

- [ ] **Step 1: Write the failing tests** in `engine.test.ts`:
  - **Autos:** a Blade adventurer standing in reach of a Thornling deals `hit` 9 at 0, 1.2, 2.4 and 3.6 s (ticks at 1/15 s), and reaches Momentum 40. Out of reach it deals nothing. Walking into reach brings a swing on the next tick.
  - **Slash:**
    - refused `'cooldown'` within 4 s;
    - refused `'range'` at reach 3.6, accepted at reach 3.4 (fuzz);
    - refused `'sight'` behind a wall circle.
  - **GCD:** a second ability within 0.5 s → `'cooldown'`.
  - **Sunder:**
    - at Momentum 40 → `'momentum'`;
    - at 60: deals 35, leaves Momentum 10, sets Marked (`mark` fx).
  - **Combo:**
    - Sunder, then swap: abilities within 0.8 s → `'busy'`; a second swap within 2 s → `'cooldown'`;
    - then Pitch Arrow: `hit` with `combo: ['marked']` and `hitDamage(3, …)` extra;
    - the marks are then burning only;
    - Burning ticks 2 a second against defence 6.
  - **Charged Shot:**
    - release after 0.75 s → frac 0.5, damage `hitDamage(3.0, 10, 6)` = 26;
    - with no release, it fires itself at 2.5 s with frac 1;
    - a dodge while charging cancels it with no cooldown;
    - `speedScale` is 0.4 from 0.25 s into the charge.
  - **Dodge:**
    - two dodges, then `'charges'`;
    - one charge back after 5 s, the second after 10 s;
    - the end point is 4.5 m away on flat ground;
    - `grounded: false` → `'air'`.
  - **Death:**
    - lethal combat damage → `died` and `act 'dead'`;
    - every intent → `'dead'`, and no autos;
    - `revive` restores full hp at the given point;
    - `damage(…, 'fall')` never takes the last hp.
  - **Regen:** none in combat; 2 a second after 6 s out of combat.
  - **Sprint:** `speedScale` 1.4 for 4.5 s.
  - **Kills:** a dummy killed → `kills` with credit `[adventurer]`. It respawns after 5 s, but not while an adventurer stands within 6 m.
  - **Loadout:** refused in combat; accepted after 5 s out of it.
  - **Determinism:** two engines with the same seed and the same intents produce identical `TickOut` streams over 60 s.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine.**
- [ ] **Step 5: Commit**: `feat: shared combat engine for adventurers`.

### Task 3: Combat engine II: enemies, the brain and the seeded fight simulation

**Files:**
- Create: `shared/src/combat/enemyAi.ts` (called from `engine.tick`), `shared/src/combat/brain.ts`, `shared/src/combat/sim.ts`
- Test: `shared/src/combat/enemyAi.test.ts`, `shared/src/combat/sim.test.ts`

**Interfaces:**
- Consumes: Task 2's engine, `findPath` and `withClearance` from `path.ts`, `inShape`, `escapeDir`, `knockDisplacement`, `ThreatTable`, `StaggerBar`.
- Produces:
```ts
// brain.ts — a scripted adventurer, shared by the tuning simulation and the load-test bots
export interface BrainInput {
  nowS: number; careful: boolean;
  self: CombatantView & SelfView;
  target: CombatantView | null;
  telegraphs: TelegraphView[];
}
export interface BrainAction { moveTo: { x: number; z: number } | null; intents: Intent[] }
export function adventurerBrain(b: BrainInput, memory: BrainMemory): BrainAction;
export interface BrainMemory { dodged: Set<number>; chargingSince: number | null }
export function newBrainMemory(): BrainMemory;
// sim.ts
export interface FightResult { firstHitAt: number | null; killedAt: number | null; ttk: number | null; died: boolean; hpLeft: number; dodges: number }
export function simulateFight(o: { seed: number; weapon: WeaponId; enemy: EnemyKindId; careful: boolean; maxS?: number }): FightResult;
```
- **Enemy AI rules**, each tick per live enemy:
  - **Aggro:** an idle enemy adds `AGGRO_THREAT` for an adventurer within `aggro` and in sight (y ignored). Being damaged also engages it.
  - **Target:** `ThreatTable.choose`, re-evaluated every 0.5 s. Dead or removed adventurers are dropped from the table.
  - **Leash:** more than `leash` from its spawn, or no valid target for 3 s → mode `'return'`:
    - it walks back at 1.5× speed and is invulnerable;
    - hp is full and threat clear on arrival.
  - **Chase:**
    - walks toward the target on `zone.ground`, in a straight line when it is clear;
    - otherwise follows `findPath` with `ENEMY_PATH_NODES` over `withClearance(ground, radius)`;
    - re-plans at most every `ENEMY_REPLAN_S`, and at most `PATHS_PER_TICK` searches run per tick across the zone;
    - an archer stops at `keepRange`;
    - enemies are pushed apart by their radii;
    - y follows the ground.
  - **Unreachable:** if there is no path, or no progress, for `UNREACHABLE_S` while out of reach → `'return'`. An adventurer within horizontal reach is attacked wherever their y is.
  - **Autos:** when in reach, every `auto.every`; melee autos are parryable.
  - **Telegraphs:**
    - when an attack's cooldown is ready (counting `firstAt` from engagement) and the target is within `useRange`, a telegraph is placed at that moment and fixed in place;
    - `circle-target` is centred on the target's position then;
    - the enemy is rooted and its facing locked for the wind-up;
    - at the end, every live adventurer for whom `inShape(x, z)` holds is hit.
  - **Resolving a hit**, in order:
    1. Invulnerable → `miss`. It is `perfect: true` if the adventurer is inside, or dodged from inside within `PERFECT_DODGE_WINDOW_S`. A perfect dodge gives the elite +15 stagger and the adventurer +10 Momentum.
    2. Parry window open and the attack is parryable → `parry` fx, nothing taken, +20 Momentum; the attacker takes +35 stagger if elite, else is stunned `PARRY_STUN_S`.
    3. Otherwise `enemyHit(raw, 10)`, absorbed by the shield first, then the knock: `DisplaceOut` of kind `'knock'`, the adventurer `act 'knock'` for the displacement plus `KNOCK_RECOVER_S`, and any charge cancelled.
  - **Gore Charge** then moves the boar along the line to its end. It moves in 0.25 m steps on `ground` and stops early where the ground ends.
  - **Elite:**
    - its stagger bar takes stagger from finishers, Charged Shot, perfect dodges, parries, interrupts and combos;
    - **break:** `break` fx, stunned for `BREAK_STUN_S` (no autos, no new telegraphs; an active wind-up is cancelled), damage ×1.5;
    - an interruptible wind-up hit by an interrupting ability is cancelled: `interrupt` fx, +`INTERRUPT_STAGGER`, and its cooldown restarts.
  - **Taunt** calls `ThreatTable.taunt`.
- **Brain rules:**
  - **Dodging** (careful only): for each telegraph containing self that is not yet in `memory.dodged`, once 0.4 s of it has passed (reaction time), dodge along `escapeDir`.
  - **Movement:** move toward the target while reach is more than the weapon's range minus 0.3. When the reach is fine, or during a dodge or a knock, don't move.
  - **Abilities**, each on a separate tick, in this order:
    1. Mend below 50% hp;
    2. Bulwark when in combat and ready;
    3. the finisher at Momentum ≥ 50. A careful brain prefers to hold it for an interruptible wind-up, but holds at most 1 s;
    4. the quick skill when ready;
    5. Charged Shot (Bow): press when ready and no telegraph contains self; release at frac 1.
  - The Blade brain does not parry. The parry rule is tested directly.
- **Simulation:**
  - a flat 80 × 80 m zone with one camp of the kind at (0, 0);
  - the adventurer starts at (0, −12) with `DEFAULT_LOADOUT` and the given weapon;
  - every 1/15 s: the brain runs, the adventurer moves toward `moveTo` with `stepBody` at `RUN_SPEED × speedScale` (zero while dodging or knocked), `setPose`, intents, `tick`;
  - displacements are applied to the simulated body;
  - `ttk = killedAt − firstHitAt`.

- [ ] **Step 1: Write the failing tests**
  - `enemyAi.test.ts`:
    - **Aggro:** at 6.9 m; not at 7.1 m; not through a wall.
    - **Chase:** reaches melee round a wall with a gap.
    - **Leash:** kiting 26 m from the spawn → `'return'`, no damage taken on the way, hp full and threat empty on arrival.
    - **Unreachable** (Review Focus 5): on a platform square that `ground` refuses and `surface` allows:
      - an adventurer within reach is attacked;
      - one 4 m in returns the enemy to its camp within `UNREACHABLE_S + 1` s;
      - the enemy never stands still with a target for more than 3 s.
    - **Telegraphs:**
      - stay fixed after placement;
      - an adventurer who walks out before the end is not hit;
      - an adventurer at y = 1.6 inside is hit (no air dodge);
      - a dodge accepted one tick before resolution is not hit, with `miss.perfect` and +15 elite stagger (Review Focus 4).
    - **Parry:**
      - inside the window it negates Ground Slam, with +35 stagger and +20 Momentum;
      - against a Thornling auto it stuns the Thornling for 1 s;
      - it does not negate Gore Charge.
    - **Gore Charge** produces a `'knock'` displacement of about 3.5 m along the line, with vy 4, and the boar ends at the line's end.
    - **Interrupts:**
      - Thorn Hail is interrupted by Sunder and by Charged Shot at frac 0.8;
      - not by Charged Shot at frac 0.5;
      - Ground Slam is never interrupted.
    - **Break:**
      - reaching 100 stagger → `break`;
      - no attacks for 4 s;
      - a Blade auto deals 11 (= round(7.27 × 1.5)).
    - **Threat:** two adventurers. The enemy switches only past 110%. Taunt holds it for exactly 4 s.
    - **Death:** a dead adventurer is dropped from threat, and an enemy with no targets left returns.
    - **Budget:** at most 4 path searches in any tick with 21 chasing enemies.
    - **Determinism** for a seed.
  - `sim.test.ts`, seeds 1–5:
    - **Ordinary:** every ordinary kind × {blade, bow}, careful → `ttk` in [10, 15], and the adventurer survives.
    - **Ordinary, careless:** the adventurer survives too (ordinary enemies are not deadly in one fight).
    - **Mossback, careful**, with either weapon → wins, `hpLeft ≥ 25`, `ttk` in [40, 75].
    - **Mossback, careless**, with either weapon → `died` before the kill.
    - Print nothing on success.
- [ ] **Step 2: Run `npx vitest run shared/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.** If a band fails, apply the Tuning rule and report the change.
- [ ] **Step 4: Run root `npx vitest run`: PASS, pristine; the simulation tests take under 20 s in all.**
- [ ] **Step 5: Commit**: `feat: enemy AI, scripted adventurer and seeded fight simulation`.

### Task 4: The Greenway recipe and the zone registry

**Files:**
- Create: `shared/src/world/recipe.ts` (`generateZone`, `prng`, `noise2`, `GREENWAY_RECIPE`), `shared/src/world/zoneWalk.ts`, `shared/src/world/zones.ts`
- Modify: `shared/src/index.ts`, `shared/package.json` (exports `./world/recipe`, `./world/zones`), `client/src/world/countryside.ts` (use `GROVE_EAST_GATE` for `gateX`; the meshes and the obstacle drift guard must not change)
- Test: `shared/src/world/recipe.test.ts`, `shared/src/world/zones.test.ts`

**Interfaces:**
- Produces:
```ts
// recipe.ts
export interface ZoneRecipe {
  id: string; seed: number; width: number; depth: number; hills: number;
  road: { wander: number; width: number };
  trees: { count: number; spacing: number };
  rocks: { count: number; platformShare: number };
  camps: { groups: Partial<Record<EnemyKindId, number>>[]; deep: number[]; offset: [number, number]; deepOffset: [number, number]; radius: number; spacing: number };
}
export const GREENWAY_RECIPE: ZoneRecipe; // seed 7331, 260 × 180 m, hills 2.5, road {wander 16, width 3.2}, trees {380, 3.6}, rocks {48, 0.4},
// camps.groups [{thornling:3}, {thornling:2,boar:2}, {archer:3,boar:1}, {thornling:2,archer:2,boar:1}, {mossback:1,thornling:2}, {mossback:1,boar:1}],
// deep [5], offset [16, 24], deepOffset [45, 55], radius 9, spacing 5
export interface ZoneLayout {
  recipe: ZoneRecipe; height(x: number, z: number): number; roadZ(x: number): number;
  trees: { x: number; z: number; s: number; kind: 0 | 1 | 2 }[];
  rocks: { x: number; z: number; r: number; h: number; top: number | null }[];
  camps: { x: number; z: number; r: number; spawns: CampSpawn[] }[];
  obstacles: Obstacle[]; entry: { x: number; z: number; facing: number }; westGate: { x: number; z: number }; walk: ZoneWalk;
}
export function generateZone(r: ZoneRecipe): ZoneLayout;
export function prng(seed: number): () => number;               // mulberry32, [0, 1)
export function noise2(seed: number, x: number, z: number): number; // value noise on an integer-hashed lattice, smoothstep, [0, 1]
// zoneWalk.ts
export class ZoneWalk {
  constructor(bounds: { x0: number; x1: number; z0: number; z1: number }, height: (x: number, z: number) => number, obstacles: readonly Obstacle[]);
  groundAt(x: number, z: number): number | null; surfaceAt(x: number, z: number): number | null; // same meanings as Walk's
}
// zones.ts
export type ZoneId = 'grove' | 'greenway';
export const ZONE_IDS: readonly ZoneId[];
export function isZoneId(v: unknown): v is ZoneId;
export interface ZoneExit { to: ZoneId; x: number; z: number; r: number; arrive: { x: number; z: number; facing: number }; open: boolean }
export interface ZoneDef extends CombatZone { id: ZoneId; name: string; banner: [string, string]; spawn: { x: number; z: number; facing: number }; exits: ZoneExit[] }
export function zoneDef(id: ZoneId): ZoneDef;                  // built once, cached
export const GROVE_EAST_GATE: { x: number; z: number };        // the farm gate across the east road (the loop countryside.ts uses)
export function zoneFullReason(id: ZoneId): string;            // grove: REASON_GROVE_FULL exactly; greenway: 'The Greenway is full, try again soon'
```
- **Recipe algorithm:** every random value comes from one `prng(seed)` stream, in this order.
  1. **Road.** Control points every 26 m from x = 0 to `width`. The first is at z = 0; the others are at z = (rng − 0.5)·2·wander. `roadZ` is a smoothstep blend between control points.
  2. **Height.** `hills·(2·noise2(seed, x/40, z/40) − 1) + 0.35·hills·(2·noise2(seed + 1, x/14, z/14) − 1)`. It is flattened toward 0 within 3–13 m of the road and within `radius + 4` of camps, and rises 4 m over the last 14 m to each bound.
  3. **Camps:**
     - camp i (not deep) sits at x = 40 + (width − 70)·i/(count − 1) ± 8 (rng), on the side rng picks, `offset` from the road;
     - deep camps sit at x = width·0.55 ± 10, `deepOffset` from the road;
     - re-roll up to 20 times if a camp is within 34 m of another, within 35 m of the entry, or within 15 m of a bound;
     - spawns are rejection-sampled within `radius − 1`, at least `spacing` apart, with elites at the centre.
  4. **Rocks:**
     - rejection-sampled, more than 5 m from the road centre and outside every camp's `radius + 3`;
     - r = 0.6 + 1.4·rng;
     - a `platformShare` of them are platforms with `top` = height at the rock + 0.45 + 0.6·rng; the rest are walls;
     - h = 1.5 + 1.6·rng (visual only).
  5. **Trees:**
     - rejection-sampled with `spacing`;
     - kept where `noise2(seed + 2, x/30, z/30) > 0.35` or within 20 m of a bound;
     - more than 6 m from the road, outside camps' `radius + 2`, and more than 10 m from the entry;
     - s = 1 + 0.8·rng, kind = floor(3·rng);
     - the obstacle is a circle of r = 0.25·s + 0.25;
     - at most `count × 30` attempts.
  6. **Bounds and gates.** Walkable within x ∈ [0.5, width − 2] and |z| ≤ depth/2 − 1. `entry` = (8, roadZ(8)), facing π/2. `westGate` = (2, roadZ(2)).
  7. **Obstacles** are circles only, so no trigonometry is needed.
- **Zone definitions:**
  - **grove:**
    - `surface` = `groveTownSurface`; `ground` = `groundAt` limited to the town;
    - `sight` = surface ≠ null; `spawn` = `SPAWN`; camps: none;
    - one exit: to greenway at `GROVE_EAST_GATE`, r 2.5, arriving at the Greenway's `entry`, **`open: false`** (Task 8 opens it).
  - **greenway:**
    - from `generateZone(GREENWAY_RECIPE)`; `spawn` = entry;
    - one exit: to grove at `westGate`, r 2.5, arriving at (gate.x − 5, roadZ(gate.x − 5)) facing −π/2, `open: true`.

- [ ] **Step 1: Write the failing tests**
  - `recipe.test.ts`:
    - **Stable output:** two calls are deep-equal. Seed 7332 changes the trees. An FNV-1a digest of the trees, rocks, camps and road samples (rounded to 1e-6) matches a committed snapshot (`toMatchSnapshot`).
    - **Source scan:** `recipe.ts` and `zoneWalk.ts` contain no match for `/Math\.(sin|cos|tan|asin|acos|atan2?|exp|expm1|log\w*|pow|hypot|cbrt|random)\b|\*\*/`.
    - **Counts:**
      - trees in [304, 380] and rocks in [38, 48];
      - 6 camps whose spawns match `groups` exactly: 21 enemies, 2 Mossbacks, ≤ `MAX_ENEMIES_PER_ZONE`.
    - **The road is clear:** every 1 m in x, points within width/2 + 0.5 of `roadZ` have ground.
    - **Spawns:** every spawn is standable with 0.6 m clearance and at least 5 m from the others. Camps are at least 34 m apart; the first is at least 35 m from the entry.
    - **Reachability:** `findPath(entry → every camp centre, withClearance(groundAt, 0.3))` is non-null.
    - **Rocks:** platform tops stand 0.45–1.05 m above the terrain; walls give `surfaceAt` null.
    - **Speed:** `generateZone` finishes in under 500 ms.
  - `zones.test.ts`:
    - `GROVE_EAST_GATE` equals the gate x that countryside's loop derives;
    - the grove has ground 2 m before the gate and none 2 m beyond it;
    - each exit circle contains a standable point;
    - each `arrive` is standable in the destination zone and outside every exit circle there (no ping-pong);
    - `zoneFullReason('grove') === REASON_GROVE_FULL`;
    - `zoneDef('grove').exits[0].open === false`.
- [ ] **Step 2: Run `npx vitest run shared/src/world`. Expected: FAIL.**
- [ ] **Step 3: Implement. Write the snapshot on the first green run and commit it.**
- [ ] **Step 4: Run root `npx vitest run` (PASS, including the client's obstacle drift guard, unchanged). Run `npx tsc --noEmit` in `client/`, and `npm run build` in `client/`.**
- [ ] **Step 5: Commit**: `feat: seeded Greenway recipe, zone walk and zone registry`.

### Task 5: Server: a room per zone, travel, and saved health, zone and loadout

**Files:**
- Create: `server/src/rooms/presence.ts`, `server/migrations/003_combat.sql`
- Modify:
  - `server/src/rooms/ZoneRoom.ts`, `server/src/app.ts`, `server/src/index.ts`;
  - `server/src/store/{types,memory,pg}.ts`, `server/src/auth/routes.ts`;
  - `server/src/rooms/testHelpers.ts`, `shared/src/messages.ts`.
- Test:
  - `server/src/rooms/travel.test.ts`, `server/src/rooms/presence.test.ts`;
  - additions to `server/src/store/store.test.ts` and `server/src/auth/routes.test.ts`;
  - updated `server/src/rooms/ZoneRoom.test.ts` and `server/src/app.test.ts`.

**Interfaces:**
- Consumes: `zoneDef`, `ZoneId`, `isZoneId`, `zoneFullReason`, `Loadout`, `DEFAULT_LOADOUT`, `parseLoadout`.
- Produces:
  - **Store:**
    - `Adventurer` gains `zone: ZoneId`, `hp: number` and `loadout: Loadout`;
    - `saveAdventurer(a: Pick<Adventurer, 'id' | 'x' | 'z' | 'facing' | 'zone' | 'hp' | 'loadout'>)`;
    - `createMemoryStore(opts?: { start?: StartSpot })` and `createPgStore(url, opts?: { start?: StartSpot })`, with `StartSpot = { zone: ZoneId; x: number; z: number; facing: number }`, default grove `SPAWN`;
    - new adventurers get hp `MAX_HP` and `DEFAULT_LOADOUT`;
    - a stored loadout that `parseLoadout` refuses reads as `DEFAULT_LOADOUT`.
  - **Migration `003_combat.sql`:** `hp int NOT NULL DEFAULT 100`, `loadout jsonb NOT NULL DEFAULT '{"weapon":"blade","free":["mend","bulwark"]}'`. Existing `zone` values stay `'grove'`.
  - **`GET /api/zone`** with `Authorization: Bearer <token>` → `200 { zone }`, or `401`. It does not count toward the login rate limit.
  - **Presence:**
```ts
export class Presence {
  get(accountId: string): { room: ZoneRoom; sessionId: string } | undefined;
  claim(accountId: string, room: ZoneRoom, sessionId: string): { room: ZoneRoom; sessionId: string } | undefined; // returns the previous claim
  release(accountId: string, sessionId: string): void;   // only if that session holds the claim
  readonly size: number;
}
```
  - **Room options:** `ZoneRoomOptions` replaces `surface` and `live` with `zone: ZoneDef`, `presence: Presence` and `rooms: Map<ZoneId, ZoneRoom>`. `ZoneRoom.kick(sessionId)` becomes public. A duplicate login kicks the older session in whichever room it is in.
  - **Join refusals:** `onAuth` for zone Z refuses an adventurer whose saved zone is not Z with `REASON_ELSEWHERE = 'Your adventurer is somewhere else'` (in `messages.ts`), and refuses with `zoneFullReason(Z)` when the room is full.
  - **Join placement:** a join stands at the saved spot. If the zone's surface there is null, it uses the zone's spawn. `hp` is the saved value clamped to [1, maxHp].
  - **Save** includes the room's zone, the hp and the loadout.
  - **Travel:**
    - an accepted move whose end lies inside an `open` exit circle checks the destination room's `canAdmit`;
    - if it may enter: save with `{ zone: to, x, z, facing: arrive, hp, loadout }`, send `travel { zone }`, remove the session without saving again, and `client.leave(CONSENTED)`;
    - if it is full: refuse the move (`correct`) and send `notice { text: zoneFullReason(to) }`.
  - **New messages:** `S2C.travel: { zone: ZoneId }` and `S2C.notice: { text: string }`.
  - **App options:**
    - `createApp` defines one room per `ZoneId` (room name = zone id) and creates each on `listen`;
    - test-only `AppOptions.zones?: Partial<Record<ZoneId, Partial<ZoneDef>>>` is merged over `zoneDef`; it replaces the old `surface` option.
  - **Stats:** `stats()` returns `{ players, tickHz, zones: Record<ZoneId, { players: number; tickHz: number }> }`. Its `tickHz` is the minimum over zones that have players (the grove's when none do). `/healthz` adds `zones`.
  - **`index.ts`** reads `SG2_START_ZONE` (`grove` by default, or `greenway`) and passes that zone's spawn to the store as `start`. It is meant for local test servers.
  - **`testHelpers`:** `joinZone(url, token, zone = 'grove')`; `joinGrove` stays as a wrapper.
  - **Bots** still join `grove`.

- [ ] **Step 1: Write the failing tests:**
  - **Presence:** `claim` returns the previous claim; `release` by a stale session does nothing.
  - **Store** (memory, and pg when `TEST_DATABASE_URL` is set):
    - zone, hp and loadout round-trip;
    - a new adventurer has hp 100, `DEFAULT_LOADOUT`, and the `start` spot when one is given.
  - **Routes:** `/api/zone` → 200 `'grove'`, and 401 without a token.
  - **Travel** (with `zones.grove.exits` overridden to an open exit at (0, −15), r 1.5, near `SPAWN`):
    - walking into it → `travel { zone: 'greenway' }` and a consented disconnect;
    - `/api/zone` is now `'greenway'`;
    - joining `grove` is refused with `REASON_ELSEWHERE`;
    - joining `greenway` stands at its entry;
    - `/healthz.zones.greenway.players === 1`.
  - **Closed exit:** walking into a closed exit does nothing.
  - **Back:** walking into the Greenway's west exit → back in the grove at the arrival point.
  - **Full destination:** `maxPlayers` 1 with someone already there → `notice` with the exact text, `correct`, and the adventurer stays.
  - **Cross-room duplicate login:**
    - account A is in the grove;
    - the test saves A's zone as greenway through the store;
    - a second session joins greenway;
    - the first gets `kicked` 'Signed in somewhere else';
    - exactly one A is online.
  - **Health persists** (Review Focus 1): a fall takes hp to 80 → leave → rejoin → hp 80.
  - **Plans 1–2:** all their room tests pass with the new options.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test` (PASS, pristine). Then run the bot load test:**
  - start `SG2_STORE=memory SG2_AUTH_RATE_PER_MIN=1000 SG2_PORT=2571 SG2_JWT_SECRET=<32+ chars> npx tsx server/src/index.ts` in the background and note its PID;
  - run `npm run bots -w server -- --url http://localhost:2571 --count 100 --seconds 30`;
  - expected: exit 0, mean ≥ 14 Hz, 0 corrections;
  - `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: a room per zone, travel through gates, saved health, zone and loadout`.

### Task 6: Server: combat in the zone room

**Files:**
- Create: `server/src/rooms/combatSync.ts` (engine → schema mirroring, fx interest, `self` messages)
- Modify: `server/src/rooms/ZoneRoom.ts`, `server/src/rooms/state.ts`, `shared/src/messages.ts`, `server/src/app.ts`, `server/src/rooms/testHelpers.ts`
- Test: `server/src/rooms/combat.test.ts`. Zone overrides put a `dummy` camp at (3, −11) and a `thornling` or `boar` camp at (0, −20) in the grove where a test needs one. Fixed `combatSeed`.

**Interfaces:**
- Consumes: `createCombat`, `Intent`, `Refusal`, `FxEvent`, `SelfView`, `Displacement`, `ZoneDef` (as `CombatZone`), `refillAllowance(…, scale)`, `Pose.ack`.
- Produces:
  - **State** (`state.ts`):
    - `PlayerState` gains `eid: int32`, `weapon: string`, `momentum: uint8`, `target: int32` (−1 = none), `dead: boolean`, `act: string`, `shield: uint8`.
    - `ZoneState` gains `enemies: MapSchema<EnemyState>`, keyed by `String(eid)`:
      `{ eid: int32, kind: string, x: float32, z: float32, y: float32, facing: float32, hp: uint16, maxHp: uint16, stagger: uint8, maxStagger: uint8, marks: uint8, mode: string, target: int32, windup: string, windupTotal: float32 }`.
      `mode` is one of `'idle' | 'fight' | 'windup' | 'stunned' | 'return' | 'dead'`.
    - `ZoneState` also gains `telegraphs: MapSchema<TelegraphState>`:
      `{ id: int32, owner: int32, attack: string, shape: string, x: float32, z: float32, dir: float32, r: float32, width: float32, angle: float32, total: float32 }`.
      These are immutable once added and deleted on resolution.
  - **Messages** (`messages.ts`):
```ts
C2S += {
  target: { id: number | null };
  ability: { slot: number; phase: 'press' | 'release' };
  swap: Record<string, never>;
  dodge: Pose & { dx: number; dz: number };       // the pose it starts from, plus a direction
  loadout: { free: [AbilityId, AbilityId] };
  respawn: Record<string, never>;
};
S2C += {
  fx: { events: FxEvent[] };                        // once per tick, only if non-empty, filtered per client
  displaced: { seq: number; kind: 'dodge' | 'knock'; from: { x: number; z: number; y: number }; d: Displacement; to: { x: number; z: number; y: number } };
  refused: { action: 'target' | 'ability' | 'swap' | 'dodge' | 'loadout' | 'respawn'; reason: Refusal | 'stale' };
  self: SelfView;                                   // to the owner, at most 5 times a second, only when changed
  credit: { kind: EnemyKindId };
  respawned: { x: number; z: number; y: number };   // revived in this room (the grove)
};
```
  - **Room loop:**
    - `setSimulationInterval(step, 1000 / TICK_HZ)`: `combat.tick(Date.now() / 1000)`, then mirror state, process displacements, deaths and kills, send fx, then `self`;
    - each room measures its step time, and `stats().zones[z]` gains `tickMs`, the p95 over 5 s;
    - **health lives in the engine:** the room's `regenerate()` is removed, and falls call `combat.damage(id, n, now, 'fall')` and then `hurt`.
  - **Movement and displacement:**
    - a `move` is ignored when the adventurer is dead, or when `pose.ack !== session.displaceSeq` (a stale or forged move: silent, with no correction);
    - the allowance refills with `combat.speedScale`;
    - for each `DisplaceOut`, the room stamps the movement checks: `displaceSeq++`, `lastGood = result end`, `air = makeAirTrack(end.y)`, `allowance.metres = min(metres, MAX_MOVE_ALLOWANCE) + DISPLACE_FUZZ_M`, and charges `fallDamage(result.drop)` through `combat.damage`;
    - it then sends `displaced` to that client, and animates `PlayerState` x, z and y along `result.path` over the next ticks for everyone else.
  - **Dodge intent:**
    - first checked as a move (`checkPose` from `lastGood` with the dodge's pose; ack must match);
    - if that fails: `correct` and `refused { action: 'dodge', reason: 'stale' }`;
    - otherwise `combat.intent(… { t: 'dodge', grounded: air.grounded })`.
  - **Refusals:** any refused intent → `refused`. Nonsense messages (wrong types, NaN, unknown slots) are dropped through the existing guard and token bucket.
  - **Death:**
    - `dead = true` and moves are ignored;
    - `respawn` is accepted from `DEATH_MIN_S` on;
    - automatic at `AUTO_RESPAWN_S` (test-only option `autoRespawnSeconds`);
    - respawn in the grove: `revive` at `SPAWN` and send `respawned`;
    - respawn elsewhere: save `{ zone: 'grove', SPAWN, hp: maxHp }` and travel;
    - a dead adventurer who is saved (leave, periodic save, travel) is saved respawned.
  - **Leaving:** `combat.removeAdventurer`.
  - **`loadout`:** saved with the adventurer.
  - **Kills:** send `credit` to every credited adventurer.
  - **fx interest:** a client gets an event if it involves its own adventurer, or if the event's `dst` (else `src`) is within `FX_RADIUS` of it.

- [ ] **Step 1: Write the failing tests** in `combat.test.ts`:
  - **State:** the grove state shows the dummy with kind, hp and maxHp.
  - **Kill:**
    - `target` the dummy and stand in reach: `fx` hits of 10 (Blade against defence 0);
    - dead within 5 s;
    - `credit { kind: 'dummy' }`;
    - back after 5 s once the adventurer steps 7 m away.
  - **Range:** `ability` slot 0 at 6 m → `refused { reason: 'range' }`.
  - **Spam** (Review Focus 3): 50 `ability` messages in 1 s give exactly 1 `use` fx. A list of junk is ignored or refused, and a legal `move` still works afterwards:
    - `target` with 'x' or 99999;
    - slot 9;
    - `dodge` with NaN;
    - `release` with no press;
    - `respawn` while alive.
  - **Death** (a thornling camp, with the adventurer standing in reach and not fighting):
    - `dead` becomes true within 60 s, and moves are ignored;
    - `respawn` at 1 s → `refused`; at 3 s → `respawned` at `SPAWN` with full hp;
    - with `autoRespawnSeconds: 2` it happens by itself.
  - **Dodge:**
    - `displaced` arrives with `to` 4.5 m away;
    - moves from `to` with the new ack are accepted (no `correct`);
    - a dodge from 20 m away → `correct` plus `refused`.
  - **Knockback** (Review Focus 2), with a boar camp:
    - Gore Charge hits an adventurer who keeps sending its old pose with the old ack for 500 ms: no `correct`;
    - after `displaced` it sends from `to` with the new ack: accepted;
    - other clients see the adventurer's `x` move along the path.
  - **Falls:** still cost hp, never kill, and the hp in state matches the engine.
  - **Relog** (Review Focus 1):
    - at 40 hp, leave and rejoin → 40, and the thornling's threat no longer has the adventurer;
    - disconnect while dead and rejoin → in the grove at `SPAWN` with full hp.
  - **Interest:** a client 100 m from a fight (zone override places it there) receives no `fx` for it.
  - **Earlier plans:** all room tests from Plans 1–2 and Task 5 still pass.
- [ ] **Step 2: Run `npx vitest run server`. Expected: FAIL.**
- [ ] **Step 3: Implement.** Keep each combat room test under 10 s of real time: shorten timers with test-only options, never with production constants.
- [ ] **Step 4: Run root `npm test` (PASS, pristine). Then the grove bot run on port 2572: 100 bots for 30 s → exit 0, mean ≥ 14 Hz, 0 corrections, and `/healthz` `tickMs` p95 printed and ≤ 15. Stop the server by PID.**
- [ ] **Step 5: Commit**: `feat: server-run combat in zone rooms, server-stamped dodges and knockback, death and respawn`.

### Task 7: Client: zone switching, the Greenway world and enemy models (browser-heavy)

**Files:**
- Create:
  - `client/src/world/greenway.ts` (`buildGreenway(scene): WorldApi` from `zoneDef('greenway')` and its layout);
  - `client/src/combat/enemies.ts` (`makeEnemy`);
  - `client/src/net/enemies.ts` (`createEnemies`);
  - `client/src/combat/dev.ts` and `client/dev/enemies.html` (a model viewer, not part of the build);
  - `client/src/world/greenway.test.ts`.
- Modify:
  - `client/src/boot.ts` (`loadZone`), `client/src/online.ts` (travel, joining by zone);
  - `client/src/net/session.ts` (`zoneFor`, `connect(token, zone)`), `client/src/net/remotes.ts` (spare pool per scene);
  - `client/src/core/contracts.ts` (`ZoneId` adds `'greenway'`).

**Interfaces:**
- Consumes: `zoneDef`, `generateZone`, `ZoneLayout`, `EnemyKindId`, `EnemyAttackId`, `ENEMY_KINDS`, `ENEMY_ATTACKS`, state `enemies`, `S2C.travel`, `REASON_ELSEWHERE`, `GET /api/zone`, `world/parts.ts` (`tree`, `Kit`, `PAL`), `world/mesh.ts` (`Builder`).
- Produces:
  - **`Game`:**
    - `scene`, `world`, `rig` and `zone` become getters;
    - `loadZone(zone: ZoneId): void` disposes the current scene and builds the zone's world, rig and camera in a new `Scene` on the same `Engine`, keeping the HUD, settings and tap-to-walk state;
    - `onZoneLoaded(cb: (zone: ZoneId) => void)`;
    - `bootGame(opts)` accepts `zone?: ZoneId` (default `'grove'`), and the offline demo is unchanged.
  - **Sessions:**
    - `session.zoneFor(token): Promise<ZoneId>` calls `/api/zone`;
    - `connect(token, zone)` joins room `zone`;
    - on `REASON_ELSEWHERE`, the client asks `zoneFor` again and retries once.
  - **Travel** (`online.ts`): `travel` → `hud.fade(true)` → the room ends → `game.loadZone(m.zone)` → join → `hud.fade(false)` → `hud.banner(...zoneDef(zone).banner)`. Banners: `['The Greenway', 'Beyond the east gate']` and `['The Plaza of the Two', 'Shady Grove']`.
  - **Greenway world:**
    - terrain: a 2 m grid mesh coloured like the countryside's `grassBase`, darker under trees;
    - the dirt road, in the countryside's style;
    - trees from `parts.tree` at the layout's positions and scales;
    - rocks: faceted prisms in the `rock` and `cliff` colours, flat-topped where `top` is set;
    - camps: bramble nests, stick piles and a ring of stones with a cold fire pit, all cosmetic;
    - a west gate arch with a lantern and a sign "Shady Grove";
    - a fallen-tree barricade at the east end;
    - a tree belt and far hills beyond the bounds;
    - the shader sky; grass on med and high.
    - **`WorldApi`:** grove-only anchors return the entry; `raiseBeacon` resolves at once; `enemySpawns()` returns the camps' spawns.
  - **Enemy models:**
```ts
export type EnemyMode = 'idle' | 'run' | 'windup' | 'stunned' | 'dead' | 'return';
export interface EnemyView {
  readonly root: TransformNode; readonly height: number; readonly radius: number;
  setEntityId(id: number): void;                     // metadata { entityId } on every pickable mesh
  setMode(mode: EnemyMode, attack?: EnemyAttackId, seconds?: number): void; // windup plays over `seconds`
  strike(): void; hit(): void; flash(): void; setTargeted(on: boolean): void; update(dt: number): void; dispose(): void;
}
export function makeEnemy(scene: Scene, kind: EnemyKindId): EnemyView;
```
    Each model is code-built and flat-shaded in `PALETTE` colours, with a silhouette distinct from the others:

    | Model | Size | Look | Wind-up | Other poses |
    |---|---|---|---|---|
    | **Thornling** | 0.9 m | a round bramble bulb in leaf greens; roof-red thorns; gold eyes; stubby legs | Thorn Burst: crouches while its thorns grow 1.6× and glow, shivering | — |
    | **Bramble Boar** | 1.2 m tall, 2 m long | cliff and rock body; bramble mane; cream tusks | Gore Charge: lowers its head, paws with its back legs, kicks up dust | — |
    | **Hollow Archer** | 1.7 m, slender | woodDark body; teal moss hood; lamp-glow hollow face; longbow | Briar Volley: raises the bow skyward and draws, the arrow tip glowing | — |
    | **Mossback** | 3.4 m, hunched | rock-purple and stone shell; meadow moss; gold bands; huge fists | Ground Slam: rears up with both fists overhead. Thorn Hail: its shell plates open and glowing roof-orange quills rise | stunned: slumps back with sparks |
    | **Dummy** | — | a straw post | — | — |

    Every wind-up shows clearly from the default camera within its first 0.3 s.
  - **`createEnemies(scene, world, room): { update(dt: number): void; get(eid: number): { view: EnemyView; x: number; z: number; y: number } | undefined; dispose(): void }`:** a `PoseBuffer` per enemy; `mode` and `windup` drive `setMode`.
  - **Remotes:** the spare-view pool is cleared when the scene changes.

- [ ] **Step 1: Write the failing test** `greenway.test.ts`, on a pure `greenwayPlacements(layout)` helper that the world builder uses:
  - one tree placement per `layout.trees` entry and one rock per `layout.rocks` entry;
  - every camp has props;
  - the gate arch is within 3 m of `westGate`;
  - no prop overlaps the road band or a spawn.
- [ ] **Step 2: Run `npx vitest run client/src/world`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test`, then client `tsc`, `npm run build` and `npm run build:online`. Then the browser check:**
  - start the server on port 2573 with `SG2_STORE=memory SG2_START_ZONE=greenway` in the background (note the PID);
  - with Playwright, at desktop size and `devices['iPhone 13']`, `?lockq`, open screenshots of:
    - arriving in the Greenway, with the road, trees, rocks and banner;
    - a camp with its enemies idle;
    - `client/dev/enemies.html` (under `npm run dev`) showing all five models side by side and each kind mid-wind-up;
    - walking west into the gate, then Shady Grove loaded at the east-gate arrival point with its banner.
    Time the travel in game time.
  - no page errors;
  - `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: the Greenway world, enemy models and zone travel in the client`.

### Task 8: Client: combat controls and feedback (browser-heavy)

**Files:**
- Create in `client/src/combat/`:
  - `controller.ts` (intents, targeting, auto-walk into range, dodge prediction, displaced playback, death screen);
  - `telegraphs.ts` (ground decals);
  - `overheads.ts` (bars and mark icons over heads);
  - `effects.ts` (fx → damage numbers, hit flashes, poses, arrows and slashes for everyone);
  - `abilityDefs.ts` (shared `AbilityData` → contract `AbilityDef`);
  - `doubleTap.ts`.
- Modify:
  - `client/src/core/contracts.ts`;
  - `client/src/hud/{index,abilities,frames,style,overlays}.ts`;
  - `client/src/player/rig.ts`, `client/src/player/character.ts` (`flash`);
  - `client/src/boot.ts` (follow a moving target);
  - `client/src/online.ts`;
  - `shared/src/world/zones.ts` (the grove exit becomes `open: true`), plus the zones test assertion.
- Test: `client/src/combat/controller.test.ts`, `client/src/combat/doubleTap.test.ts`

**Interfaces:**
- Consumes: Task 6's state and messages, `simulateDisplacement`, `dodgeDisplacement`, `ABILITIES`, `slotsFor`, `inShape`, `EnemyView`, `createEnemies`.
- Produces (contract changes):
  - **`HudState.player`** gains optional fields:
    - `momentum?: number`;
    - `dodge?: { charges: number; max: number; refill: number }` (refill: 0–1 progress of the next charge);
    - `dead?: boolean`.
    The offline demo leaves them undefined, which hides the Momentum bar and the dodge button.
  - **Marks** reach the target frame through `HudState.target.statuses` (the existing ids `marked`, `burning`, `soaked`).
  - **Enemy wind-ups** show as `HudState.target.cast = { name, frac, interruptible }`.
  - **Charged Shot** shows as `HudState.player.cast = { name: 'Charged Shot', frac }`.
  - **`HudEvent`** gains `{ type: 'abilityUp'; slot: number }`, `{ type: 'dodge'; dir: { x: number; y: number } | null }` (screen-space input direction) and `{ type: 'cycleTarget' }`.
  - **`HudApi`:**
    - `loadout(pool, current, weapon, count = 5)`; online uses count 2 over `FREE_POOL`;
    - `dismissEndScreen(): void`.
  - **Ability bar:**
    - ability buttons emit `abilityUp` on pointerup;
    - holding key 3 sends press, and keyup sends release;
    - a **Dodge** button (64 px, two charge pips, a refill ring) sits next to Jump on touch;
    - Shift, or a double-tap of W, A, S or D within 250 ms, dodges on desktop;
    - Tab → `cycleTarget`;
    - L opens the free-pick chooser, out of combat only (otherwise a toast "Not during a fight");
    - the finisher button shows as unusable below 50 Momentum.
  - **`PlayerFrame`** gets a Momentum bar (gold) under health. It pulses at 50 and at 100.
  - **`PlayerRig`:**
    - `setMoveScale(s)` clamps to [0, 1.5];
    - `displace(from: { x: number; z: number; y: number }, d: Displacement): void` replays `simulateDisplacement` from `from`, with input ignored meanwhile;
    - `readonly displacing: boolean`.
  - **`CharacterView`** gains `flash(): void`.
  - **The controller:**
    - **Taps:** tapping an enemy sends `target`. If tap-to-walk is on and the enemy is out of reach, it also walks to within the weapon's range minus 0.5, re-pathing every 0.5 s as the enemy moves. Tapping the ground keeps today's walking. With the setting off, a tap on an enemy only targets.
    - **Dodge:** predicted locally with `simulateDisplacement` from the body's pose, then `dodge` is sent with the pose and `ack`. No poses are sent until `displaced` (snap to `to` if more than 0.05 m off) or `refused` (snap back to `from`), or for 1 s.
    - **Every `displaced`:** cancels any tap-to-walk (re-pathing to a followed target afterwards), plays `rig.displace`, then sets `ack = seq`.
    - **Every `move`** carries `ack`.
    - **Speed:** `rig.setMoveScale` follows the server's view: 1.4 while sprinting (after its `use` fx), 0.4 while `self.charge` is not null, 0 while dead or displacing.
    - **Refusals** toast: range → "Out of range", cooldown → "Not ready", momentum → "Not enough Momentum", sight → "Can't see the target", no-target → "No target", charges → "No dodges left", air → "Can't dodge in the air", in-combat → "Not during a fight". Others are silent.
    - **Death:** `endScreen('defeat', ['You were defeated.', 'You will wake by the statue in Shady Grove.'], ['Return to the statue'])` → `respawn`. `dismissEndScreen` on `respawned`, on travel, or when `dead` clears.
    - **Auto-target:** if the adventurer has no target and is hit by an enemy, it targets that enemy.
  - **Telegraphs:**
    - one decal per `TelegraphState`, shaped as its circle, cone or line and conformed to the terrain;
    - a translucent warm-red base, with an inner fill that grows from the origin over `total − TELEGRAPH_LEAD_S`, measured from when the decal was first seen;
    - a brighter edge in the last 0.3 s;
    - removed on deletion.
  - **Overheads:**
    - an enemy name and hp bar while engaged, targeted or hurt within 5 s, and always for elites (which also get a stagger bar);
    - mark icons beside the bar;
    - other adventurers get an hp bar under their name label.
  - **Effects:**
    - floating numbers: your damage `'damage'`, combos `'combo'`, damage to you `'hurt'`, heals `'heal'`, "Dodged" / "Parried" `'info'`;
    - `flash()` on hit; `hit` poses;
    - `use` and `swing` → the attacker's `'attack'`, `'parry'` or `'charge'` pose;
    - bow arrows: pooled meshes flying at 40 m/s; blade swings: a short arc trail;
    - all of it shown for other adventurers' attacks too.
  - **`window.__sg2net`** adds `zone`, `enemies: [{ eid, kind, x, z, hp, mode }]`, `self: { hp, momentum, dead, target }` and `fxSeen: number`.

- [ ] **Step 1: Write the failing tests:**
  - `doubleTap.test.ts`: the same key twice within 250 ms → dodge; 260 ms apart → no dodge; holding a key does not repeat.
  - `controller.test.ts` (pure helpers):
    - `tapAction(tap, { tapToWalk }, enemyIds, reach, range)`:
      - an enemy tap → target, plus walk only when tap-to-walk is on and out of range;
      - a ground tap → walk only when tap-to-walk is on;
    - `abilityDefs` maps all ten abilities with their glyph, cooldown and kind;
    - `slotView(self, now)` turns `SelfView` into five `HudState.slots` with the right `usable` (the finisher below 50 is unusable);
    - `telegraphFill(firstSeenMs, nowMs, total)` reaches 1 at `total − 0.15` s.
- [ ] **Step 2: Run `npx vitest run client/src/combat`. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run root `npm test` (PASS), then client `tsc`, `npm run build` and `npm run build:online`. Then the browser check:**
  - start the server on port 2574 with `SG2_STORE=memory SG2_START_ZONE=greenway` in the background (note the PID);
  - with Playwright at desktop size and `devices['iPhone 13']`, `?lockq`, using game time, open screenshots of:
    - a Thornling targeted (ring, target frame, overhead bar), with tap-to-walk on so the adventurer walked into reach;
    - the ability bar mid-cooldown, with its sweep and seconds;
    - the Momentum bar part-filled;
    - a Thorn Burst decal mid-fill;
    - floating damage numbers;
    - the Marked icon after Sunder;
    - a second page seeing the first page's attacks (`fxSeen` rises and the remote plays `'attack'`);
    - with tap-to-walk off, an enemy tap targets without walking;
    - the death screen after standing in a camp without fighting, then "Return to the statue" → Shady Grove with full health;
    - from the grove's east-gate arrival point, walking east through the now-open gate into the Greenway;
    - `client/dev/hud.html` showing an elite target with its stagger bar and an interruptible cast.
  - On the iPhone, measure every `.sg-ctl` bounding box: all at least 48 px, with none intersecting the joystick zone or each other.
  - No page errors. `kill <pid>`.
- [ ] **Step 5: Commit**: `feat: combat controls, telegraphs, bars, damage numbers and death screen; open the east gate`.

### Task 9: Bots that fight, the smoke test and the 100-adventurer combat run (browser-heavy: the smoke test)

**Files:**
- Modify: `server/scripts/bots.ts`, `server/scripts/smoke.mjs`, `docs/load-test.md`
- Test: the scripts themselves, run against local servers.

**Interfaces:**
- Consumes: `adventurerBrain`, `newBrainMemory`, `zoneDef`, `findPath`, `withClearance`, `simulateDisplacement`, `dodgeDisplacement`, Task 6's state and messages, `/api/zone`, `/healthz.zones`.
- Produces:
  - **`bots.ts --fight`:**
    - each bot asks `/api/zone` and joins that room;
    - in the Greenway, every tick it targets the nearest live enemy within 40 m (otherwise it walks toward the nearest camp by `findPath` over the zone's ground), builds a `BrainInput` from the state and its last `self`, and runs `adventurerBrain`. The brain is careful for 3 bots in 4 and careless for the fourth, so deaths happen;
    - it moves toward `moveTo` with `stepBody` as today;
    - it sends intents, plays `displaced` (no poses until it is done) and sends `ack`;
    - after a death it sends `respawn`, arrives at the statue, paths to `GROVE_EAST_GATE` and travels back.
    - It prints:
      - kills, deaths, dodges, knockbacks, refusals by reason, travels and corrections;
      - the server's zone `tickMs` p95 and the patch rate seen by the bots;
      - peak RSS;
      - enemies alive (min and max).
    - It **passes** only if all of these hold:
      - all bots stay connected;
      - mean ≥ 14 Hz;
      - 0 corrections;
      - kills ≥ 50, dodges ≥ 100, knockbacks ≥ 1, deaths ≥ 1;
      - every dead bot is back in the Greenway before the end, or still on its way;
      - p95 `tickMs` ≤ 15;
      - peak RSS ≤ 400 MB;
      - never more than `MAX_ENEMIES_PER_ZONE` enemies.
    - Without `--fight`, the bots behave exactly as before.
  - **`smoke.mjs`** additions. The server runs with `SG2_START_ZONE=greenway`, and all existing steps run unchanged in the Greenway. After the chat step, page A:
    - targets the nearest Thornling with Tab, walks into reach by tap-to-walk, and kills it within 90 s of game time (a `credit` arrives, or `__sg2net.enemies` shows it dead);
    - has taken damage (`self.hp < 100` at some sample);
    - clears its target, stands at the next camp until "Defeated" shows (within 150 s), and clicks "Return to the statue";
    - then `__sg2net.zone === 'grove'` and `self.hp === 100`.
    The kill step uses `--kill "kill <pid>"`.

- [ ] **Step 1: Run the scripts against the current server to watch them fail** (smoke: the first new step; bots: `--fight` unknown).
- [ ] **Step 2: Implement both.**
- [ ] **Step 3: Run root `npm test` (PASS, pristine). Then run the combat load test:**
  - start the server on port 2575 with `SG2_STORE=memory SG2_START_ZONE=greenway SG2_AUTH_RATE_PER_MIN=1000` in the background (note the PID);
  - run `npm run bots -w server -- --url http://localhost:2575 --count 100 --seconds 60 --fight` → PASS;
  - `kill <pid>`.

  If it fails, profile and fix the server, never the thresholds. The likely fixes, in order: fx interest filtering, path-search budget, mirroring only changed fields.
- [ ] **Step 4: Run the smoke test:**
  - start the server on port 2576 the same way (note the PID);
  - run `node server/scripts/smoke.mjs http://localhost:2576 --kill "kill <pid>"` → PASS.
  - Also run the plain grove bot run (`--count 100 --seconds 30`, no `--fight`, default start zone) on port 2577 → PASS; stop it by PID.
- [ ] **Step 5: Record the printed numbers of all three runs in `docs/load-test.md`** (with the date, machine and enemy count 21). **Commit**: `test: bots that fight, combat smoke test and the 100-adventurer combat run`.

## Decisions this plan makes that the spec leaves open

These are recorded so that reviewers can check the tasks against them.

**Zones and travel**
- The Greenway is its own coordinate space and its own scene, reached through the grove's farm gate. It is not a continuation of the grove's far terrain.
- The grove → Greenway gate stays closed (`open: false`) until Task 8, so no player can enter the Greenway before its combat UI exists.
- `SG2_START_ZONE` is a server setting for local test servers and bots. Clients cannot affect it.

**Server authority**
- Knockback is forced on the client: until it acknowledges the server's `displaced` (`Pose.ack`), its moves are ignored without correction.
- Dodges are predicted by the client but validated and simulated by the server, from the pose the client sends.
- Neither dodges nor knockbacks widen the allowance for later poses. The server moves the "last good" pose to the end point, plus 0.5 m of fuzz.
- The combat engine, the enemy AI and the bots' brain are all in `shared`. The tuning simulation therefore runs the server's own code.
- Ability messages carry no aim point: no Plan 3 ability needs one. Plan 3b's ground spells add it.

**Abilities, marks and stagger**
- Marks: Blade's finisher leaves Marked and Bow's leaves Burning, so a solo player combos by swapping weapons. Soaked waits for the Staff.
- Interrupts in Plan 3 come from Sunder, a Charged Shot at frac 0.8 or more, and stagger breaks (Lightning arrives in 3b).
- Parry negates any parryable melee hit, whether an auto or a telegraph. Against ordinary enemies it stuns; against elites it adds stagger.
- No critical hits and no player stuns until Plan 5. Enemies have no social aggro.
- Mend is instant, not a cast.
- The free picks are saved per adventurer. They can be changed only out of combat.

**Death and kill credit**
- Death opens a screen with "Return to the statue", which also happens by itself after 30 s.
- A dead adventurer is always saved as respawned.
- Kill credit goes to every adventurer on the enemy's threat table, as a `credit` message only, with no XP.

**Network and persistence**
- Combat events are filtered per client by distance (60 m), and private numbers (cooldowns, dodge charges) go only to their owner, in `self`.
- Health regeneration moves from the room into the engine and runs only out of combat.
