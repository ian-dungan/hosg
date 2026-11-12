# Shady Grove 2 — Plan 1: Online Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single-player Shady Grove town demo into an online town: accounts, saved adventurers, up to 100 players walking around together and chatting, deployable to the owner's Hetzner server with Docker Compose.

**Architecture:** An npm-workspaces monorepo with three packages: `shared/` (pure TypeScript rules and data used by both sides), `server/` (Node + Colyseus + Express, owns all state), and the existing `client/` (Babylon.js + Vite). The client sends its position 15 times a second; the server validates each step against the same walkability code the client uses and broadcasts the room state. Storage sits behind a `Store` interface with an in-memory implementation for tests and a PostgreSQL one for production.

**Tech Stack:** TypeScript, Node 22, Colyseus (current stable `colyseus` + `@colyseus/schema` on the server, the matching Colyseus client SDK in the browser — record the installed versions in package.json), Express, `pg`, `argon2`, `jsonwebtoken`, Vitest, Babylon.js 9, Vite 8, Playwright (pre-installed; never install it), Docker Compose, PostgreSQL 16.

**Spec:** `docs/superpowers/specs/2026-11-11-shady-grove-2-first-slice-design.md` (this plan implements item 10 "Online", the Architecture, Hosting and Address sections, the connection parts of Error handling, and the 100-player test).

## Roadmap (one plan per subsystem; each ships working software)

1. **Online foundation** — this plan. Done.
2. **Movement** — server-checked jumping, gravity, falling and fall damage; tap-to-walk path-finding; the "Tap to walk" setting. Done (`2026-11-12-sg2-plan-2-movement.md`).
3. **Combat core** — shared combat rules, targeting and auto-attack, Momentum, Blade and Bow with their five-button bars, dodge roll, marks and combos, telegraphs, stagger, knockback, the Greenway zone with ordinary and elite enemies.
3b. **Jobs and magic** — seven starting jobs (Warrior, Paladin, Dark Knight, Ninja, White Mage, Black Mage, Ranger) levelled separately on one adventurer, changed only in towns and sanctuary zones; the Staff and four elements, cast times and interrupts, element reactions; free picks borrowed from other jobs; job talent trees and retraining; an outfit remembered per job.
4. **Parties and the Fallen Warden** — parties of 4, loot rolls, private boss arenas, three phases, solo title and leaderboard.
5. **Progression and gear** — levels 1–10, armour types and nine sets, unique weapons, visible gear, costumes and the gold costume shop, GM tools. Also in-depth character creation: four playable peoples (humans, a tall woodland folk, a small sturdy folk, beast-folk; looks only, no stat differences; a fifth, sky-folk, unlocked later), sliders for body and face, about 20 hair styles, free colour pickers, stance/walk/emote choices, dye slots on armour, and a barber in town to change it all for gold.
6. **Opening quest online** — "The Solstice Crossing" as a saved, per-adventurer quest.
7. **World generator** — areas are generated, never hand-placed. Each area is a short recipe (biome, size, seed, landmarks, town template, enemy families, boss arena) and the generator lays out terrain, vegetation, roads, buildings, enemy camps and points of interest from it, identically on the server and every client. Only story landmarks (such as the statue) are authored. This comes before the wider continent so the world can grow far past the first slice.
8. **Homes** — a private house per adventurer entered through a door in town: a starter cottage from a quest, larger homes bought with gold; furniture placed on a grid (crafted, bought, boss trophies); storage chest, rested bonus, gear mannequin, trophy board; invite a party or open to visitors.
9. **Neighbourhoods** — streets of about twelve houses, each its own small place; friends or a guild claim a street together, others are placed with active players; a shared green with a noticeboard, garden plot and street trophy.

Tabled by the owner for later (can be added at any time): party voice chat. It needs HTTPS, so it can only follow the move to `shadygrove2.mooo.com`.

## Global Constraints

- Player characters are called **adventurers** in all player-facing text.
- Runs in a web browser on phones, tablets and computers. No install.
- 100 players online at once in one zone room.
- The server owns all game state; it rejects impossible inputs (speed, position).
- 15 server updates per second (`TICK_HZ = 15`); the client smooths movement between them.
- Dropped connection: the client reconnects automatically and the adventurer stays in the world for 30 seconds.
- Adventurers are saved every 60 seconds and on logout.
- Passwords hashed with argon2. No secrets in the repository; secrets come from environment variables.
- Docker services and volumes are prefixed `sg2-` and must not touch the server's existing `ffxi-*`, `sg-*` or `ac-*` containers.
- First deployment is plain HTTP on the server's IP address and one port (`SG2_PORT`, default `2570`); nothing may depend on a domain name or HTTPS.
- The offline single-file demo (`npm run build` in `client/`) must keep working unchanged.
- Game name in all text: "Shady Grove 2".

## Review Focus

1. **The same account logs in twice** (two tabs, or phone and computer): the older session is disconnected with a clear message; the adventurer is never duplicated in the room. → Task 4.
2. **Hostile text in names and chat** (`<img onerror=…>`, control characters, 5,000-character messages): shown as plain text, trimmed, never executed. → Tasks 1 and 5 (server), Task 6 (client).
3. **Nonsense movement messages** (`NaN`, `Infinity`, strings, a position 2 km away): ignored or corrected; the server never crashes and never stores them. → Tasks 1 and 4.
4. **The server restarts while people are playing**: every client returns to the login screen with "Connection lost" instead of freezing; positions saved in the last 60 seconds are restored on next login. → Tasks 4 and 6.
5. **Two people register the same name at the same moment**: exactly one succeeds; the other gets "That name is taken". → Task 3.

---

### Task 1: Workspace and the shared package

**Files:**
- Create: `package.json` (root, `"workspaces": ["shared", "server", "client"]`), `tsconfig.base.json`
- Create: `shared/package.json` (name `@sg2/shared`, `"type": "module"`, exports `./src/index.ts`), `shared/tsconfig.json`
- Move: `client/src/world/layout.ts` → `shared/src/world/layout.ts`; leave `client/src/world/layout.ts` as `export * from '@sg2/shared/world/layout';`
- Create: `shared/src/constants.ts`, `shared/src/validate.ts`, `shared/src/movement.ts`, `shared/src/messages.ts`, `shared/src/index.ts`
- Test: `shared/src/validate.test.ts`, `shared/src/movement.test.ts`

**Interfaces:**
- Produces:
  - `constants.ts`: `TICK_HZ = 15`, `RUN_SPEED = 6` (m/s, must equal the rig's), `MAX_PLAYERS = 100`, `RECONNECT_SECONDS = 30`, `SAVE_SECONDS = 60`, `CHAT_MAX = 200`, `CHAT_MIN_INTERVAL_MS = 1000`, `SPAWN = { x: 0, z: -11, facing: 0 }`.
  - `validate.ts`: `validateUsername(s: unknown): string | null` (returns an error message or null; 3–16 chars of `[A-Za-z0-9_]`), `validatePassword(s: unknown): string | null` (8–72 chars), `cleanChat(s: unknown): string | null` (string only; strips control characters, collapses whitespace, trims, cuts to `CHAT_MAX`; null if empty).
  - `movement.ts`: `interface Pose { x: number; z: number; facing: number; moving: boolean }`, `parsePose(msg: unknown): Pose | null` (null unless all numbers are finite), `checkStep(from: {x:number;z:number}, to: Pose, dtSeconds: number, walkable: (x:number,z:number)=>boolean): 'ok' | 'too-fast' | 'blocked'` (allowed distance = `RUN_SPEED * 1.3 * dt + 0.5`; `dt` capped at 1 s).
  - `world/layout.ts`: unchanged exports, including the walkability class and `groundHeight`; add `export function groveWalkable(x: number, z: number): boolean` and `export function groveGroundY(x: number, z: number): number | null` built from the existing walk object the client world already constructs (move that construction here so both sides share one instance factory).
  - `messages.ts`: `type C2S = { move: Pose; chat: { text: string } }`, `type S2C = { chat: { from: string; text: string }; correct: { x: number; z: number }; kicked: { reason: string } }`.

- [ ] **Step 1: Write the failing tests**

```ts
// validate.test.ts
expect(validateUsername('ab')).not.toBeNull();
expect(validateUsername('Ellie_01')).toBeNull();
expect(validateUsername('<img src=x>')).not.toBeNull();
expect(validateUsername(42)).not.toBeNull();
expect(validatePassword('short')).not.toBeNull();
expect(validatePassword('x'.repeat(73))).not.toBeNull();
expect(cleanChat('  hi\u0000\n there ')).toBe('hi there');
expect(cleanChat('a'.repeat(5000))!.length).toBe(200);
expect(cleanChat('   ')).toBeNull();
expect(cleanChat({})).toBeNull();
// movement.test.ts
expect(parsePose({ x: NaN, z: 0, facing: 0, moving: true })).toBeNull();
expect(parsePose({ x: '1', z: 0, facing: 0, moving: true })).toBeNull();
expect(parsePose({ x: 1, z: 2, facing: 0.5, moving: false })).toEqual({ x: 1, z: 2, facing: 0.5, moving: false });
const open = () => true;
expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('ok');
expect(checkStep({ x: 0, z: 0 }, { x: 2000, z: 0, facing: 0, moving: true }, 1 / 15, open)).toBe('too-fast');
expect(checkStep({ x: 0, z: 0 }, { x: 0.4, z: 0, facing: 0, moving: true }, 1 / 15, () => false)).toBe('blocked');
expect(groveWalkable(0, -11)).toBe(true);     // spawn
expect(groveWalkable(0, 0)).toBe(false);      // inside the statue plinth
expect(groveWalkable(5000, 5000)).toBe(false);
```

- [ ] **Step 2: Run `npx vitest run shared` — expected: FAIL (modules missing).**
- [ ] **Step 3: Implement the files above.**
- [ ] **Step 4: Run `npx vitest run shared` (PASS), then in `client/`: `npx tsc --noEmit` and `npm run build` (both succeed; the offline demo still builds).**
- [ ] **Step 5: Commit** — `feat: workspace and shared rules package`.

### Task 2: Storage (`Store`, memory and PostgreSQL)

**Files:**
- Create: `server/package.json` (name `@sg2/server`), `server/tsconfig.json`
- Create: `server/src/store/types.ts`, `server/src/store/memory.ts`, `server/src/store/pg.ts`, `server/migrations/001_init.sql`
- Test: `server/src/store/store.test.ts` (one suite run against `MemoryStore` always, and against `PgStore` only when `TEST_DATABASE_URL` is set)

**Interfaces:**
- Produces:
```ts
export interface Account { id: string; username: string; passwordHash: string | null; isGuest: boolean; isGm: boolean }
export interface Adventurer { id: string; accountId: string; name: string; x: number; z: number; facing: number; zone: 'grove'; level: number; xp: number; gold: number }
export class NameTakenError extends Error {}
export interface Store {
  createAccount(a: { username: string; passwordHash: string | null; isGuest: boolean }): Promise<Account>; // throws NameTakenError (case-insensitive)
  findAccountByUsername(username: string): Promise<Account | null>;                                          // case-insensitive
  getOrCreateAdventurer(accountId: string, name: string): Promise<Adventurer>;                               // one per account; spawns at SPAWN, level 1, 0 xp, 0 gold
  saveAdventurer(a: Pick<Adventurer, 'id' | 'x' | 'z' | 'facing'>): Promise<void>;
  close(): Promise<void>;
}
export function createMemoryStore(): Store;
export function createPgStore(databaseUrl: string): Promise<Store>;   // runs migrations/*.sql in order, once each (table schema_migrations)
```
- `001_init.sql`: tables `accounts` (uuid pk, `username` text, unique index on `lower(username)`, `password_hash` text null, `is_guest` bool, `is_gm` bool default false, `created_at`) and `adventurers` (uuid pk, `account_id` unique fk, `name`, `x`, `z`, `facing` double precision, `zone` text, `level` int, `xp` int, `gold` int, `updated_at`).

- [ ] **Step 1: Write the failing suite** — for each store: create then find (`findAccountByUsername('ELLIE')` finds `Ellie`); a second `createAccount` with `ellie` rejects with `NameTakenError`; **20 concurrent `createAccount` calls with the same name yield exactly 1 success and 19 `NameTakenError`**; `getOrCreateAdventurer` twice returns the same id and the `SPAWN` position; `saveAdventurer` then `getOrCreateAdventurer` returns the saved `x`, `z`, `facing`.
- [ ] **Step 2: Run `npx vitest run server/src/store` — expected: FAIL.**
- [ ] **Step 3: Implement.** `PgStore` relies on the unique index for the race (map SQLSTATE `23505` to `NameTakenError`); use parameterised queries only.
- [ ] **Step 4: Run again — PASS.** If Docker is available, also run with `TEST_DATABASE_URL` pointing at a throwaway `postgres:16` container and confirm PASS; if not, say so in the task report.
- [ ] **Step 5: Commit** — `feat: account and adventurer storage`.

### Task 3: Accounts API

**Files:**
- Create: `server/src/auth/tokens.ts`, `server/src/auth/routes.ts`, `server/src/auth/rateLimit.ts`
- Test: `server/src/auth/routes.test.ts` (Express app + `MemoryStore`, requests via Node `fetch` against an ephemeral port)

**Interfaces:**
- Consumes: `Store`, `validateUsername`, `validatePassword`.
- Produces:
  - `signToken(accountId: string, secret: string): string` (JWT HS256, 7-day expiry), `verifyToken(token: string, secret: string): { accountId: string } | null`.
  - `authRouter(store: Store, secret: string): express.Router` mounted at `/api`:
    - `POST /api/register {username, password}` → `200 {token, name}`; `400 {error}` for invalid input (message from the validators); `409 {error: 'That name is taken'}`.
    - `POST /api/login {username, password}` → `200 {token, name}`; `401 {error: 'Wrong name or password'}` (same message for unknown user and wrong password).
    - `POST /api/guest` → `200 {token, name}` with name `Guest-` + 4 random digits (retry on collision); guest accounts have no password and cannot use `/api/login`.
    - Rate limit: 10 requests per IP per minute across the three routes → `429 {error: 'Too many attempts, wait a minute'}`.
  - Request bodies over 2 KB are rejected with `413`.

- [ ] **Step 1: Write failing tests** for each response above, plus: stored `passwordHash` starts with `$argon2`; a token from register passes `verifyToken`; a tampered token returns null; the 11th request in a minute returns 429; two simultaneous registers of the same name give one 200 and one 409.
- [ ] **Step 2: Run `npx vitest run server/src/auth` — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat: register, login and guest accounts`.

### Task 4: The zone room (movement sync, saving, reconnect)

**Files:**
- Create: `server/src/rooms/state.ts`, `server/src/rooms/ZoneRoom.ts`, `server/src/app.ts`, `server/src/index.ts`
- Test: `server/src/rooms/ZoneRoom.test.ts` (boot `createApp` on an ephemeral port with `MemoryStore`; connect with the Colyseus client SDK from Node)

**Interfaces:**
- Consumes: `Store`, `verifyToken`, `parsePose`, `checkStep`, `groveWalkable`, constants, `S2C`/`C2S`.
- Produces:
  - `state.ts`: `class PlayerState extends Schema { name: string; x: number; z: number; facing: number; moving: boolean }`, `class ZoneState extends Schema { players: MapSchema<PlayerState> }` (keyed by Colyseus `sessionId`).
  - `ZoneRoom` registered as room name `"grove"`, `maxClients = MAX_PLAYERS`, patch rate `1000 / TICK_HZ` ms. Join options: `{ token: string }`.
  - `createApp(opts: { store: Store; jwtSecret: string; clientDir?: string }): { listen(port: number): Promise<void>; close(): Promise<void>; stats(): { players: number; tickHz: number } }` — Express (`/api`, `GET /healthz` → `{ok:true, players}`, static files from `clientDir` when given) plus the Colyseus server on the same HTTP server.
  - `index.ts`: reads `SG2_PORT` (default 2570), `DATABASE_URL` (required), `SG2_JWT_SECRET` (required; exit with a clear message if missing or shorter than 32 chars), `SG2_CLIENT_DIR`.
- Behaviour:
  - `onAuth`: invalid or missing token → join rejected. On join, load the adventurer (`getOrCreateAdventurer(accountId, username)`); if its saved position is not walkable, use `SPAWN`.
  - **Duplicate login:** if the account already has a session in the room, send that older client `kicked {reason: 'Signed in somewhere else'}` and disconnect it before adding the new one.
  - `move`: `parsePose` null → ignore. `checkStep` (dt = time since that player's last accepted move) not `'ok'` → do not change state, reply `correct {x, z}` with the last good position. Otherwise update the player's state.
  - Save every `SAVE_SECONDS` and on leave. On an unexpected disconnect call `allowReconnection(client, RECONNECT_SECONDS)`; the player stays in state meanwhile; a consented leave removes them at once.
  - A message handler that throws must not take the room down (catch, log, continue).

- [ ] **Step 1: Write failing tests:**
  - join without a token is rejected; with a valid token the client sees itself in `state.players` at `SPAWN`;
  - two clients see each other; a legal `move` from A appears in B's state within 300 ms;
  - `move {x: 2000, z: 0, …}` leaves A's state unchanged and A receives `correct`;
  - `move {x: NaN}`, `move 'hello'`, `move null` are ignored and the room still accepts a following legal move;
  - a move into the plinth (`0, 0`) is corrected;
  - **same account joins twice → the first client receives `kicked` and is disconnected; `state.players.size === 1`**;
  - leave then rejoin restores the last position (via the store);
  - dropping A's socket without consent keeps A in `state.players`; reconnecting within the window resumes the same entry; after the window (use a test-only override of 1 s) the entry is gone and the position was saved;
  - `GET /healthz` returns `{ok: true, players: n}`.
- [ ] **Step 2: Run `npx vitest run server/src/rooms` — FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run — PASS. Run the whole suite: `npx vitest run` — PASS.**
- [ ] **Step 5: Commit** — `feat: grove zone room with validated movement`.

### Task 5: Chat

**Files:**
- Modify: `server/src/rooms/ZoneRoom.ts`
- Test: `server/src/rooms/chat.test.ts`

**Interfaces:**
- Consumes: `cleanChat`, `CHAT_MIN_INTERVAL_MS`.
- Produces: client message `chat {text}` → broadcast `chat {from: <adventurer name>, text: <cleaned>}` to everyone in the room, sender included.

- [ ] **Step 1: Write failing tests:** B receives A's `hello`; `'  hi\n\u0007 there '` arrives as `'hi there'`; a 5,000-character message arrives cut to 200; `'<img src=x onerror=alert(1)>'` arrives as that exact text (the server does not rewrite it — the client must render it as text); empty or non-string text is dropped; a second message within 1 s is dropped and the third after 1 s arrives.
- [ ] **Step 2: Run — FAIL.**  **Step 3: Implement.**  **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat: zone chat`.

### Task 6: Online client

**Files:**
- Create: `client/src/net/session.ts`, `client/src/net/interp.ts`, `client/src/net/remotes.ts`, `client/src/net/loginScreen.ts`, `client/src/net/chatBox.ts`, `client/src/online.ts`, `client/online.html`
- Modify: `client/vite.config.ts` (second build: `npm run build:online` → `client/dist-online/`, normal multi-file build, entry `online.html`), `client/package.json` (scripts `build:online`, `dev:online`)
- Do not change `client/src/main.ts` behaviour (the offline demo). Shared set-up it needs (engine, world, rig, HUD) may be extracted into `client/src/boot.ts` and used by both entries.
- Test: `client/src/net/interp.test.ts`; browser smoke test in Task 8.

**Interfaces:**
- Consumes: `/api/*`, room `"grove"`, `PlayerState`, `S2C`/`C2S`, `makeCharacter`, `PlayerRig`, `HudApi`, `WorldApi.addShadowCaster`.
- Produces:
  - `session.ts`: `login(kind: 'register' | 'login' | 'guest', username?: string, password?: string): Promise<{ token: string; name: string }>` (throws `Error` with the server's `error` text); `connect(token: string): Promise<Room<ZoneState>>`; the token is kept in `sessionStorage` (try/catch) so a page reload resumes.
  - `remotes.ts`: `createRemotes(scene, world, room, mySessionId): { update(dt: number): void; count(): number }` — one `makeCharacter({kind: 'player'})` per other player, a DOM name label above each head, and interpolation.
  - `interp.ts` (inside `net/`): `class PoseBuffer { push(tMs: number, x: number, z: number, facing: number): void; sample(tMs: number): { x: number; z: number; facing: number } | null }` rendering `INTERP_DELAY_MS = 133` in the past, linear in position, shortest-arc in facing, holding the last pose when the buffer runs dry.
  - `loginScreen.ts`: `showLogin(root: HTMLElement): Promise<{ token: string; name: string }>` — name and password fields, "Play", "Create account", "Play as guest", inline error text; matches the existing HUD style.
  - `chatBox.ts`: `createChat(root, send: (text: string) => void): { add(from: string, text: string): void }` — Enter focuses/sends on desktop, a chat button opens it on touch; keeps the last 50 lines.
- Behaviour:
  - The local adventurer moves exactly as offline; `online.ts` sends `move` at `TICK_HZ` only while the pose changed since the last send.
  - On `correct`, call `rig.teleport` to the corrected position.
  - **All names and chat lines are inserted with `textContent`, never `innerHTML`.**
  - `kicked` → back to the login screen showing the reason. Socket closed unexpectedly → try `reconnect` for up to `RECONNECT_SECONDS`; if that fails → login screen with "Connection lost". The page must never be left frozen.
  - While typing in chat or the login form, movement keys must not move the adventurer.
  - The HUD name plate shows the adventurer's name; a small "Adventurers online: n" line shows `players.size`.

- [ ] **Step 1: Write the failing test** `interp.test.ts`: with poses at t=0 (x=0) and t=66 (x=1), `sample(133 + 33)` gives x≈0.5; `sample` far in the future returns the last pose; facing from 3.1 to −3.1 rad interpolates through π, not through 0; empty buffer returns null.
- [ ] **Step 2: Run `npx vitest run client/src/net` — FAIL.**
- [ ] **Step 3: Implement the files above.**
- [ ] **Step 4: Run the test (PASS), `npx tsc --noEmit` in `client/`, `npm run build` and `npm run build:online` (both succeed).**
- [ ] **Step 5: Commit** — `feat: online client with login, other adventurers and chat`.

### Task 7: 100-adventurer load test

**Files:**
- Create: `server/scripts/bots.ts`, script `npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60`
- Modify: `server/src/app.ts` if needed so `stats().tickHz` reports the measured patch rate over the last 5 s.

**Interfaces:**
- Consumes: `/api/guest`, room `"grove"`, `groveWalkable`, `/healthz`.
- Produces: a script that logs in `count` guests, walks each in random legal steps at `TICK_HZ`, has each send a chat line every 20 s, and at the end prints `players`, mean and minimum measured state-patch rate seen by the bots, and the server process's peak RSS; exits non-zero unless all bots stayed connected, mean patch rate ≥ 14 Hz, and no bot received `correct` for a legal step.

- [ ] **Step 1: Start the server locally with `MemoryStore` (add `SG2_STORE=memory` for this) and run the script with `--count 100 --seconds 60`.**
- [ ] **Step 2: If it fails, profile and fix the server (not the thresholds).** Expected: exit 0, 100 players, mean ≥ 14 Hz.
- [ ] **Step 3: Record the printed numbers in `docs/load-test.md`.**
- [ ] **Step 4: Commit** — `test: 100-adventurer load test`.

### Task 8: Packaging, browser smoke test and deployment guide

**Files:**
- Create: `Dockerfile` (multi-stage: build shared, client `build:online`, server; final image runs `node server/dist/index.js` with `SG2_CLIENT_DIR` pointing at the built client), `docker-compose.yml`, `.env.example`, `.dockerignore`, `deploy/README.md`
- Create: `server/scripts/smoke.mjs` (Playwright)

**Interfaces:**
- `docker-compose.yml`: services `sg2-server` (ports `${SG2_PORT:-2570}:2570`, `mem_limit: 1g`, `restart: unless-stopped`, depends on a healthy `sg2-db`) and `sg2-db` (`postgres:16`, volume `sg2-pgdata`, `mem_limit: 512m`, not published to the host, healthcheck `pg_isready`). All secrets come from `.env` (`SG2_JWT_SECRET`, `POSTGRES_PASSWORD`); `.env` is git-ignored and `.env.example` holds placeholders only.
- `smoke.mjs <url>`: two desktop browser contexts and one `devices['iPhone 13']` context each play as guest; asserts that each sees "Adventurers online: 3"; context A walks (hold W for 2 s) and context B's remote for A moved more than 2 m (expose `window.__sg2net = { remotes: [{name, x, z}] }` in the online entry for this); A sends chat `hello <img src=x onerror=window.__pwned=1>` and B's chat shows that exact text while `window.__pwned` stays undefined; a second login of A's account in a new context makes the first show "Signed in somewhere else"; killing the server makes a client show "Connection lost" within 40 s. Zero page errors throughout.
- `deploy/README.md`: exact steps for the Ubuntu server — clone the repo, copy `.env.example` to `.env` and fill both secrets (with a one-line command to generate each), `docker compose up -d --build`, open `http://<server-ip>:2570`, how to update (`git pull && docker compose up -d --build`), how to back up (`docker compose exec sg2-db pg_dump …`), how to make an account a GM (one SQL line), and the later switch to `shadygrove2.mooo.com` with Caddy. States plainly that it only creates `sg2-*` containers.

- [ ] **Step 1: Write `smoke.mjs` and run it against a locally started server — expected: FAIL at the first unmet assertion.**
- [ ] **Step 2: Write the Dockerfile and compose file; fix whatever the smoke test finds.**
- [ ] **Step 3: If Docker works in this environment: `docker compose up -d --build`, run `smoke.mjs http://localhost:2570` (PASS) and `npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60` (exit 0), then `docker compose down`. If Docker cannot run here, run both against `node server/dist/index.js` with a local PostgreSQL or `SG2_STORE=memory`, and say exactly which was verified in the task report.**
- [ ] **Step 4: Write `deploy/README.md`.**
- [ ] **Step 5: Commit** — `feat: docker packaging, smoke test and deployment guide`.

### Task 9: Adventurer names chosen by the player

Added after the owner asked that players name their own characters, with no bad words.

**Files:**
- Create: `shared/src/names.ts`, `shared/src/badwords.ts`, `server/migrations/002_adventurer_names.sql`, `client/src/net/nameScreen.ts`
- Modify: `shared/src/index.ts`, `server/src/store/types.ts`, `server/src/store/memory.ts`, `server/src/store/pg.ts`, `server/src/auth/routes.ts`, `server/src/rooms/ZoneRoom.ts`, `client/src/net/session.ts`, `client/src/online.ts`
- Test: `shared/src/names.test.ts`, additions to `server/src/store/store.test.ts`, `server/src/auth/routes.test.ts`, `server/src/rooms/ZoneRoom.test.ts`

**Interfaces:**
- Produces:
  - `validateAdventurerName(s: unknown): string | null` — returns an error message or null. Rules: a string of 3–16 characters; letters A–Z/a–z only, optionally with single spaces, hyphens or apostrophes between letters (never leading, trailing or doubled); not offensive (`isOffensive`); not reserved.
  - `isOffensive(s: string): boolean` — case-insensitive; normalises before matching: strips spaces, hyphens, apostrophes, underscores and digits used as separators, maps common look-alikes (`0→o 1→i 3→e 4→a 5→s 7→t @→a $→s`), and collapses repeated letters; matches any entry of `BAD_WORDS` as a substring, except where the name is on a small `ALLOWED_WORDS` list of innocent words that contain one (for example "Scunthorpe", "Cassandra", "Dickens", "Essex").
  - `BAD_WORDS: readonly string[]` in `badwords.ts` — a built-in English list of profanity, slurs and sexual terms (lower-case, normalised form). `RESERVED_NAMES`: `admin`, `administrator`, `gm`, `gamemaster`, `moderator`, `mod`, `staff`, `system`, `server`, `ellie`, `felix`, `shadygrove`, and anything starting with `guest`.
  - Error texts: `'Names are 3 to 16 letters'`, `'Names can only use letters, with single spaces, hyphens or apostrophes between them'`, `'That name is not allowed'` (used for both offensive and reserved, so the filter is not a guessing game), `'That name is taken'`.
  - `validateUsername` also rejects offensive and reserved usernames with `'That name is not allowed'` (guest names are generated by the server and exempt).
  - `Store`: `Adventurer.name` is now `string | null` (null until chosen); `getOrCreateAdventurer(accountId)` no longer takes a name; new `nameAdventurer(accountId: string, name: string): Promise<Adventurer>` — throws `NameTakenError` if another adventurer has that name (case-insensitive, unique index on `lower(name)`), and throws `Error('already named')` if this adventurer already has a name. Migration `002` makes `adventurers.name` nullable, adds the unique index, and keeps existing names.
  - `POST /api/name {name}` with header `Authorization: Bearer <token>` → `200 {name}`; `400 {error}` (validator message); `401` (bad token); `409 {error: 'That name is taken'}`; `409 {error: 'Your adventurer already has a name'}`. Counts toward the auth rate limit.
  - `/api/register`, `/api/login`, `/api/guest` responses become `{token, name: string | null}` where `name` is the adventurer's name. Guests are named by the server: their adventurer is created with the generated `Guest-NNNNNN` name, so guests never see the naming screen.
  - `ZoneRoom`: a join for an adventurer whose name is null is refused with `'Name your adventurer first'`; the room shows the adventurer's name, not the username.
  - `nameScreen.ts`: `showNameScreen(root: HTMLElement, submit: (name: string) => Promise<string>): Promise<string>` — "Name your adventurer", one field, live rule hint, inline error, in the login screen's style; shown after login whenever `name` is null.

- [ ] **Step 1: Write the failing tests:**
```ts
// names.test.ts
expect(validateAdventurerName('Elowen')).toBeNull();
expect(validateAdventurerName("Mary-Ann O'Neil")).toBeNull();
expect(validateAdventurerName('Al')).toBe('Names are 3 to 16 letters');
expect(validateAdventurerName('A'.repeat(17))).toBe('Names are 3 to 16 letters');
expect(validateAdventurerName('Dr4gon')).toBe('Names can only use letters, with single spaces, hyphens or apostrophes between them');
expect(validateAdventurerName(' Rook')).not.toBeNull();
expect(validateAdventurerName('Ro  ok')).not.toBeNull();
expect(validateAdventurerName('<b>Rook</b>')).not.toBeNull();
expect(validateAdventurerName(42)).not.toBeNull();
for (const n of ['Felix', 'ELLIE', 'Admin', 'Game Master', 'Guestling']) expect(validateAdventurerName(n)).toBe('That name is not allowed');
expect(validateAdventurerName('Cassandra')).toBeNull();
expect(validateAdventurerName('Dickens')).toBeNull();
// every BAD_WORDS entry of 3–16 letters is rejected as-is, capitalised, spaced out with hyphens, and with letters doubled
// isOffensive sees through look-alikes: for a sample of BAD_WORDS, the 0/1/3/4/5/7/@/$ substituted form is offensive
```
  Server tests: `nameAdventurer` twice for one account rejects the second; two accounts racing for the same name (20 concurrent) give exactly one success; `/api/name` returns each status above; a registered account cannot join the room before naming and can after; the room state shows the chosen name; a guest joins without naming and shows `Guest-` + 6 digits; `/api/register` with an offensive username returns 400 `'That name is not allowed'`.
- [ ] **Step 2: Run `npx vitest run shared server` — expected: FAIL.**
- [ ] **Step 3: Implement.** The test file must not print the bad-word list on success.
- [ ] **Step 4: Run `npx vitest run` (PASS), `npx tsc --noEmit` and `npm run build` and `npm run build:online` in `client/` (succeed). Start the server and confirm in a browser screenshot (desktop and `devices['iPhone 13']`): register → "Name your adventurer" → an offensive name shows "That name is not allowed" → a good name enters the town and appears on the name plate and above the head for a second player.**
- [ ] **Step 5: Commit** — `feat: players name their adventurer, with a bad-word filter`.
