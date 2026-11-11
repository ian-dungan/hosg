# Shady Grove 2 — Plan 2: Movement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give adventurers real physical movement — jumping, gravity, falling, things to jump onto and drop from, fall damage — checked by the server, plus tap-to-walk that finds its way around obstacles and can be switched off.

**Architecture:** One small character controller in `@sg2/shared` (`stepBody`) moves a body over a height surface; the client rig runs it for the local adventurer, and the server validates each reported pose against the same surface with an upper-bound jump envelope, so the two can never disagree about where it is possible to stand. Obstacles gain an optional top height: an obstacle with a top is a platform you can land on; one without is a wall. Path-finding is a pure A* module in shared, used only by the client.

**Tech Stack:** as Plan 1 (TypeScript, Vitest, Babylon.js 9 + Vite 8, Colyseus 0.18 + `@colyseus/sdk`, Playwright pre-installed — never install it).

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md` — item 5 "Physical movement" (except knockback and launches, which arrive with combat in Plan 3), the tap-to-walk line of item 4 "Controls", and "The server rejects impossible inputs".

## Global Constraints

- Jumping: Space on a computer, a jump button on touch. Gravity and falling, with ledges you can drop from and low obstacles you can hop over.
- Short falls are free; long falls cost some health but never kill outright.
- Simple character physics that the server checks, not a full physics engine. Gliding is not built.
- Tap-to-walk: tap or click the ground to walk there, or a person to walk over and talk, with path-finding around obstacles. It works alongside the joystick and keys, and a "Tap to walk" switch in Settings turns it off.
- The server owns all game state and rejects impossible inputs; 15 updates per second (`TICK_HZ`); 100 players in the one grove room.
- Runs in a browser on phones, tablets and computers. Player characters are called adventurers. Game name: "Shady Grove 2".
- Everything from Plan 1 keeps working: accounts, naming, chat, reconnect, duplicate-login kick, the one-room rule, the speed allowance, the message throttle, Docker packaging. Root `npm test` stays green with pristine output.
- Both client builds keep working: `npm run build` (offline single-file demo; it gets the new movement too) and `npm run build:online`.
- No secrets in the repository.
- Shared numbers (exact): `GRAVITY = 22` m/s², `JUMP_SPEED = 8` m/s (apex ≈ 1.45 m), `STEP_UP = 0.35` m, `SAFE_FALL = 3` m, `FALL_DAMAGE_PER_M = 10`, `MAX_HP = 100`, `HP_REGEN_PER_S = 2`, `HP_REGEN_DELAY_S = 6`.

## Review Focus

1. **Holding or mashing Space**: exactly one jump per landing; no double jump, no climbing by spamming. → Tasks 1, 3.
2. **A hacked client reports hovering, flying upward, or a teleport onto a high platform**: the server corrects it and the adventurer is put back at the last good position. → Task 3.
3. **Dodging fall damage**: disconnecting, stalling the connection or going silent in mid-air and then reporting a pose on the ground still costs the health for the real drop. → Task 3.
4. **Tapping somewhere unreachable** (across the river, inside a house, on a rooftop, out of bounds): a short message, no freeze, no walking into a wall for ever; the search is bounded in time. → Task 5.
5. **A slow device** (frames 100 ms apart): the adventurer never falls through a platform or the ground and never passes through a low wall. → Task 1.

---

### Task 1: Shared surface and character controller

**Files:**
- Modify: `shared/src/world/layout.ts` (the `Circle`/`Rect` obstacle types and `Walk`), `shared/src/constants.ts`, `shared/src/index.ts`
- Create: `shared/src/body.ts`
- Test: `shared/src/body.test.ts`, additions to the layout tests in `shared/src/movement.test.ts` or a new `shared/src/world/layout.test.ts`

**Interfaces:**
- Produces:
  - Constants in `constants.ts` exactly as listed under Global Constraints.
  - Obstacles: both `Circle` and `Rect` gain `top?: number` — the obstacle's top height in world Y. No `top` = a wall (never enterable). With `top` = a platform.
  - `Walk.surfaceAt(x: number, z: number): number | null` — null where `groundAt` is null for reasons other than a platform (out of bounds, water, a wall); otherwise the higher of the terrain height and the highest platform top covering the point. `Walk.groundAt` keeps its current meaning and results (a platform still makes `groundAt` null), so Plan 1 callers are unaffected.
  - `groveSurface(x: number, z: number): number | null` (default walk) and `groveTownSurface(x, z)` (null outside the town radius used by `groveTownWalkable`).
  - `body.ts`:
```ts
export type Surface = (x: number, z: number) => number | null;
export interface Body { x: number; z: number; y: number; vy: number; grounded: boolean; /** highest y since leaving the ground */ peakY: number }
export interface BodyInput { vx: number; vz: number; jump: boolean }   // desired horizontal velocity in m/s; jump = pressed this step
export interface BodyStep { landed: boolean; drop: number; jumped: boolean }  // drop = peakY - landing y (0 unless landed)
export function makeBody(x: number, z: number, surface: Surface): Body;      // standing on the surface (y = surface or 0)
export function canEnter(surface: Surface, x: number, z: number, y: number): boolean; // surface !== null && surface <= y + STEP_UP
export function stepBody(b: Body, input: BodyInput, dt: number, surface: Surface): BodyStep; // mutates b
export function fallDamage(drop: number): number;   // 0 up to SAFE_FALL, else Math.round((drop - SAFE_FALL) * FALL_DAMAGE_PER_M)
```
  - `stepBody` rules: it sub-steps so no step is longer than 1/60 s (`dt` is capped at 0.25 s in total). Horizontal: try the full move, then x only, then z only, each only if `canEnter` at the new point with the current `y` (this is the existing sliding behaviour). Vertical: grounded + `jump` → `vy = JUMP_SPEED`, leaves the ground, `jumped = true`. In the air: `vy -= GRAVITY·dt`, `y += vy·dt`, `peakY = max(peakY, y)`; when `y` reaches the surface under the body it lands (`y = surface`, `vy = 0`, `grounded = true`, `landed = true`, `drop = peakY - y`). Grounded: if the surface under the body is more than `STEP_UP` below `y`, it leaves the ground with `vy = 0` (walks off a ledge) and `peakY = y`; otherwise `y` snaps to the surface (steps up or down).

- [ ] **Step 1: Write the failing tests**

```ts
// body.test.ts — synthetic surfaces
const flat: Surface = () => 0;
const box: Surface = (x, z) => (Math.abs(x - 5) <= 1 && Math.abs(z) <= 1 ? 0.8 : 0);          // 0.8 m crate at x 4..6
const wall: Surface = (x, z) => (Math.abs(x - 5) <= 0.15 ? null : 0);                         // thin wall
const ledge: Surface = (x) => (x < 0 ? 5 : 0);                                                // 5 m cliff
// walks at the commanded speed on flat ground
// cannot walk onto the 0.8 m crate (stops at x < 4), CAN jump onto it and stand at y = 0.8, CAN jump over a 0.3 m-wide 0.8 m wall-top
// never enters the thin wall, including with dt = 0.1 at 6 m/s (Review Focus 5)
// holding jump = true for 3 s gives jumps only on landing: count of jumped === true steps equals count of landings + 1, and y never exceeds 1.5 (Review Focus 1)
// jump apex is between 1.40 and 1.50
// walking off the 5 m ledge: lands with drop between 4.95 and 5.05, grounded, y = 0; fallDamage(drop) === 20
// with dt = 0.1 steps the body never ends a step below the surface (Review Focus 5)
// a 0.3 m step up is walked onto without jumping; a 0.4 m step is not
expect(fallDamage(3)).toBe(0); expect(fallDamage(2)).toBe(0); expect(fallDamage(4.5)).toBe(15);
// layout: a Walk built with one Rect {top: 0.6} → surfaceAt inside it === 0.6 (on flat terrain), groundAt inside it === null;
// a Rect without top → surfaceAt === null; every point where the existing groundAt is non-null has surfaceAt === groundAt.
```
- [ ] **Step 2: Run `npx vitest run shared` — expected: FAIL (module missing).**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npx vitest run` at the root — PASS; `npx tsc --noEmit` in `client/` and `server/` — clean.**
- [ ] **Step 5: Commit** — `feat: height surface and shared character controller`.

### Task 2: The local adventurer uses the controller, and the town gets things to jump on

**Files:**
- Modify: `client/src/player/rig.ts` (drive position from `stepBody`; remove the cosmetic jump arc), `client/src/core/contracts.ts` (`WorldApi.surfaceAt`, `PlayerRig.body`), `client/src/world/index.ts`, `client/src/world/town.ts` (and other builders that register obstacles), `client/src/boot.ts` if needed
- Create: `client/src/world/lookout.ts`
- Regenerate: `shared/src/world/obstacles.ts` via the drift-guard test (`npx vitest run src/world/obstacles.test.ts -u` in `client/`)
- Test: `client/src/world/obstacles.test.ts` (existing guard, extended to compare `surfaceAt`), `client/src/world/lookout.test.ts`

**Interfaces:**
- Consumes: `stepBody`, `makeBody`, `Body`, `Surface`, `Walk.surfaceAt`, constants.
- Produces:
  - `WorldApi.surfaceAt(x: number, z: number): number | null` (from the shared walk); `WorldApi.groundAt` unchanged.
  - `PlayerRig.body: Readonly<Body>` — the live body; `PlayerRig.position.y` is the body's `y` (smoothed only for display on small steps). `PlayerRig.jump()` requests a jump on the next step. New optional rig option `onLand?: (drop: number) => void`.
  - Platforms (obstacles with `top`, standing on the terrain height at their spot): the plaza benches (+0.5 m), market crates and planters (+0.5 to +0.8 m), the well rim (+0.9 m), the low plinth steps of the statue (the first step only, +0.4 m), and the jetty deck if it is currently an obstacle. Houses, trees, lamp posts, stalls' canopies, the statue itself and hedges stay walls.
  - **The Old Lookout**: a new landmark at the edge of the grove knoll, away from the plaza — a weathered stone outcrop with a ruined watch platform, built as 5 stacked stone tiers, each 0.9 m higher than the last (tops at +0.9, +1.8, +2.7, +3.6, +4.5 m above the terrain there), each tier at least 2.4 m deep so it can be landed on, with a small flat top (about 4 × 4 m) holding a bench and a flag. It is climbed only by jumping tier to tier; from the top the drop to the ground is 4.5 m. Low-poly, in the town's style and palette; registered as `Rect`/`Circle` obstacles with `top`.
  - `lookout.ts` exports `LOOKOUT = { x, z, tiers: [{ x, z, hw, hd, yaw, top }, …] }` used by both the mesh and the obstacles.

- [ ] **Step 1: Write the failing test** `lookout.test.ts`: every tier's top is exactly 0.9 m above the previous (first above terrain, ±0.05); using `stepBody` with `createGroveWalk().surfaceAt`, a scripted bot can go from the ground to the top tier by walking and jumping (search simple run-and-jump approaches per tier; assert it reaches `y ≥ top − 0.05` on the top tier), cannot get onto tier 1 without jumping, and walking off the top lands with a drop of 4.5 ± 0.1 m. Extend the drift guard so the baked file must reproduce `surfaceAt` (not just `groundAt`) over the grid.
- [ ] **Step 2: Run `npx vitest run client` — FAIL.**
- [ ] **Step 3: Implement** the rig change, the platform tops, the lookout, and regenerate the baked obstacles.
- [ ] **Step 4: Run root `npm test` (PASS), `npx tsc --noEmit`, `npm run build`, `npm run build:online` in `client/`. Then, in the offline demo with Playwright at desktop size and `devices['iPhone 13']`, open screenshots showing: the adventurer standing on a bench; standing on the top of the Old Lookout; mid-air in a jump; and that walking still feels the same on flat ground (position after 2 s of W matches RUN_SPEED within 10%). No page errors.**
- [ ] **Step 5: Commit** — `feat: real jumping and falling, platforms in town, the Old Lookout`.

### Task 3: The server checks height, and falls cost health

**Files:**
- Modify: `shared/src/movement.ts` (pose and vertical check), `shared/src/messages.ts`, `server/src/rooms/state.ts`, `server/src/rooms/ZoneRoom.ts`, `server/src/rooms/testHelpers.ts`, `server/scripts/bots.ts`
- Test: `shared/src/movement.test.ts`, `server/src/rooms/ZoneRoom.test.ts` (new `describe('height')`)

**Interfaces:**
- Consumes: `Surface`, `groveTownSurface`, constants, the existing allowance (`refillAllowance`, `checkMove`).
- Produces:
  - `Pose` becomes `{ x, z, y, facing, moving }`; `parsePose` requires a finite `y`.
  - `PlayerState` gains `y: float64`, `hp: number`, `maxHp: number` (both start at `MAX_HP`).
  - `S2C.correct` becomes `{ x, z, y }`; new `S2C.hurt: { amount: number; cause: 'fall' }`.
  - In `movement.ts`:
```ts
export interface AirTrack { grounded: boolean; airStartMs: number; airStartY: number; peakY: number; y: number }
export function makeAirTrack(y: number): AirTrack;
/** Highest y a body may have t seconds after leaving the ground at y0: y0 + JUMP_SPEED·t − ½·GRAVITY·t² + 0.3 while rising or near the apex, never above y0 + 1.75. */
export function jumpCeiling(y0: number, tSeconds: number): number;
/** Horizontal + vertical check of one reported pose. Mutates `track` only when the result is 'ok'. */
export function checkPose(
  from: { x: number; z: number }, track: AirTrack, to: Pose, nowMs: number,
  allowance: number, surface: Surface,
): { result: 'ok' | 'too-fast' | 'blocked' | 'floating'; landedDrop: number };
```
  - `checkPose` rules: horizontal distance against `allowance` exactly as `checkMove` does. Sample the segment every 0.25 m (including the end): the surface at each sample must be non-null and at most `STEP_UP` above the body's interpolated height there, else `'blocked'`. At the end point: `to.y` below `surface − 0.05` → `'blocked'`. `to.y` within 0.05 of the surface → grounded; if the track was in the air, `landedDrop = max(track.peakY, track.airStartY) − to.y` (0 if negative). `to.y` more than 0.05 above the surface → in the air: if the track was grounded, the air phase starts at `nowMs − 1000/TICK_HZ` from `track.y`; `to.y` above `jumpCeiling(airStartY, t)` → `'floating'`. A grounded-to-grounded move whose height rises by more than `STEP_UP` → `'blocked'` (you must have reported being in the air to get up there).
  - `ZoneRoom`: uses `checkPose` with `groveTownSurface`; on anything but `'ok'` replies `correct {x, z, y}` with the last good pose; on a landing with `fallDamage(landedDrop) > 0` reduces `hp` (never below 1) and sends that client `hurt`. Health regenerates `HP_REGEN_PER_S` per second once `HP_REGEN_DELAY_S` have passed since the last damage. A join places the adventurer at `surface(x, z)`; a saved spot with a null surface falls back to `SPAWN`. The air track is kept per account next to the movement allowance, so re-joining or reconnecting mid-air does not reset it.
  - `bots.ts` and `testHelpers.ts` send `y` (the surface height under each step).

- [ ] **Step 1: Write failing tests**, shared: `jumpCeiling(0, 0.36)` is between 1.45 and 1.80 and `jumpCeiling(0, 2)` is below 0; `checkPose` accepts a recorded legal jump (generate the poses by running `stepBody` at 15 Hz with a jump onto a 0.8 m platform), rejects `y = 3` from the ground as `'floating'`, rejects hovering (same `y = 1` for 2 s) as `'floating'`, rejects a grounded pose at a platform's top 0.9 m up reached without any airborne pose as `'blocked'`, rejects `y` below the surface as `'blocked'`, and reports `landedDrop` ≈ 4.5 when a track that was grounded at 4.5 m next reports the ground at 0 (**even if the airborne poses in between were never sent** — Review Focus 3). Room tests: a legal recorded jump is reflected in other clients' `y`; a `y = 50` pose gets `correct` and leaves state unchanged (Review Focus 2); climbing a tall test platform by legal jumps then stepping off costs `fallDamage(drop)` hp, sends `hurt`, and never takes hp below 1 even from repeated falls; hp regenerates after the delay (use a test-only option to shorten it); dropping the socket in mid-air and reconnecting on the ground still costs the health (Review Focus 3); mashing jump poses cannot gain height step by step — a sequence of airborne poses each 1 m above the last is rejected (Review Focus 1). All Plan 1 room tests still pass with `y` added.
- [ ] **Step 2: Run `npx vitest run shared server` — FAIL.**
- [ ] **Step 3: Implement.** Give `createApp`/the room a test-only `surface` override so tests can use a synthetic surface with a tall platform.
- [ ] **Step 4: Run root `npm test` — PASS, pristine. Start the server with the memory store and run `npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 30` — exit 0, mean ≥ 14 Hz, no corrections. Stop the server.**
- [ ] **Step 5: Commit** — `feat: server-checked height and fall damage`.

### Task 4: Online client — height, health, and seeing others jump

**Files:**
- Modify: `client/src/online.ts`, `client/src/net/remotes.ts`, `client/src/net/interp.ts`, `client/src/boot.ts` if needed, `server/scripts/smoke.mjs`
- Test: `client/src/net/interp.test.ts`

**Interfaces:**
- Consumes: `Pose` with `y`, `PlayerState.y/hp/maxHp`, `S2C.correct {x,z,y}`, `S2C.hurt`, `PlayerRig.body`, `HudApi.floatText`, `HudState.player.hp/maxHp`.
- Produces: `PoseBuffer.push(tMs, x, z, facing, y?)` and `sample` returning `y` (linear; 0 when never pushed); remote adventurers are drawn at their interpolated `y`; the local `move` message carries the body's `y`; the HUD health bar shows the server's `hp`/`maxHp`; `hurt` shows a floating "−n" in the HUD's `hurt` style near the adventurer and a brief red edge flash; `correct` teleports to `{x, z, y}` (and no longer swings the camera — keep the current camera angle). `window.__sg2net.remotes` entries gain `y`.

- [ ] **Step 1: Write the failing test**: `PoseBuffer` interpolates `y` linearly between samples and holds the last `y`; old 4-argument pushes still work.
- [ ] **Step 2: Run `npx vitest run client/src/net` — FAIL.**
- [ ] **Step 3: Implement.** Extend `smoke.mjs`: page A jumps (Space) and page B's remote for A reports `y > 0.5` at some sample within 20 s.
- [ ] **Step 4: Root `npm test`, client `tsc`, both builds. Start the server (memory store) and run `node server/scripts/smoke.mjs http://localhost:2570` — PASS. With Playwright at desktop size and `devices['iPhone 13']`, open screenshots showing: a second player's adventurer standing on the Old Lookout as seen by the first; the health bar reduced and the "−n" text after jumping off the top; health back at 100 after waiting. No page errors. Stop the server.**
- [ ] **Step 5: Commit** — `feat: online height, health bar and fall damage feedback`.

### Task 5: Tap-to-walk path-finding and the Settings switch

**Files:**
- Create: `shared/src/path.ts`, `client/src/hud/settings.ts`
- Modify: `shared/src/index.ts`, `client/src/boot.ts` (the tap-to-walk follower), `client/src/hud/index.ts` and `client/src/core/contracts.ts` (settings button and API), `client/src/hud/overlays.ts` (controls hint text if it mentions tapping)
- Test: `shared/src/path.test.ts`

**Interfaces:**
- Produces:
```ts
export interface PathOpts { cell?: number; maxNodes?: number; snap?: number }   // defaults 0.5 m, 20000, 2 m
/** Ground-level route from `from` to as near `to` as can be stood on. `passable(x,z)` = may an adventurer walk here without jumping. Returns waypoints (excluding `from`, ending at the reached point) or null if there is no route within the limits. */
export function findPath(from: Vec2, to: Vec2, passable: (x: number, z: number) => boolean, opts?: PathOpts): Vec2[] | null;
```
  - A* on a square grid with 8 neighbours, no cutting corners between two blocked cells; the goal snaps to the nearest passable cell within `snap`; the result is smoothed by dropping waypoints whose neighbours can see each other along a straight line sampled every 0.25 m.
  - Client `passable` = `surfaceAt(x, z) !== null` and within `STEP_UP` of the terrain there (platforms count as blocked for walking routes).
  - The follower in `boot.ts`: a ground tap computes a path and walks waypoint to waypoint (the marker sits at the final point); a tap on a person paths to the nearest point within talk range and then talks; the joystick, a movement key or a new tap cancels; if `findPath` returns null the HUD toasts `"Can't get there"` and nothing moves; if the adventurer makes no progress for 0.8 s the walk is cancelled.
  - `HudApi` gains `settings: { tapToWalk: boolean }` (live values) and a gear button that opens a small Settings panel with one switch, "Tap to walk" (default on), saved under `localStorage['sg2.tapToWalk']` inside try/catch. When off, a ground tap does nothing and a tap on a person only talks if already in range. Keyboard: `O` opens and closes Settings; `Esc` closes.

- [ ] **Step 1: Write the failing tests** `path.test.ts`: on an open map the path is one straight waypoint; around a wall with a gap it goes through the gap and every consecutive pair of waypoints is walkable along its whole length; a goal inside a blocked region snaps to the nearest passable cell within 2 m, and returns null when nothing passable is within 2 m; a walled-off goal returns null and stops within `maxNodes` (assert it returns in under 200 ms on a 400 × 400 cell map — Review Focus 4); on the real grove (`createGroveWalk().surfaceAt`), from `SPAWN` to a point behind the tavern a path exists, each segment is passable, and its length is under 1.6 × the straight-line distance; from `SPAWN` to a point across the river returns null.
- [ ] **Step 2: Run `npx vitest run shared` — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Root `npm test`, client `tsc`, both builds. In the offline demo with Playwright at desktop size and `devices['iPhone 13']`, open screenshots showing: a tap behind a house walks around it and arrives (final position within 0.6 m of the marker); a tap across the river shows "Can't get there"; the Settings panel with the switch; with the switch off a ground tap does not move the adventurer; a tap on Old Marrow from across the plaza walks over and opens his dialogue. No page errors.**
- [ ] **Step 5: Commit** — `feat: tap-to-walk finds its way around obstacles; Settings switch`.
