# Load test: 100 adventurers in a zone

`server/scripts/bots.ts` signs in `--count` guest adventurers into one zone, has each walk in random
legal steps at the server's update rate (15 a second, at running speed, jumping now and then) and say
a chat line every 20 seconds, then prints what it measured. It exits with status 1 unless every bot
stayed connected, the mean state-update rate the bots saw was at least 14 a second, no bot had a
step corrected, and no bot was stuck for a second (15 ticks) or more. Without `--fight` the bots do not fight; a knockback or a respawn only moves them.
With `--fight` they fight in the Greenway with the shared brain (see "Fighting bots" below).

## How to run it

1. Start a server. For this test only, raise the login limit: by default the server allows 10
   logins per IP address a minute, and all bots sign in from the same address. For a run in the
   Greenway, also make it the zone new adventurers start in:

   ```sh
   SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 npm start -w server
   # the Greenway instead:
   SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_ZONE=greenway npm start -w server
   ```

   (`SG2_PORT` picks another port than 2570.) With Docker (`docker-compose.yml`), start the stack
   with the raised limit for the test, and restart it without afterwards:

   ```sh
   SG2_AUTH_RATE_PER_MIN=1000 docker compose up -d   # for the bot run only
   docker compose up -d                              # afterwards: back to 10 a minute
   ```

   Do not leave `SG2_AUTH_RATE_PER_MIN` raised on a public server: the limit is what slows down
   password guessing.

2. In a second terminal:

   ```sh
   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60
   ```

   | flag | default | what it does |
   |---|---|---|
   | `--url` | `http://localhost:2570` | the server |
   | `--count` | 100 | bots |
   | `--seconds` | 60 | how long to measure |
   | `--zone grove\|greenway` | grove | the room to join; must be the server's start zone (`SG2_START_ZONE`) |
   | `--stand` | off | stand still (still chat); the patch rate is still checked: the state's `clock` changes every step, so a room where nobody moves still sends a patch each step |
   | `--warmup <s>` | 2 | wait this long after the last join before measuring: with 40 the bots have spread out over the zone |
   | `--cluster <m>` | none | keep every bot within this many metres of where it joined (all join at the spawn): with 15, all 100 are within 30 m of each other, the worst case for interest management |
   | `--fight` | off | bots that fight (below); each asks `GET /api/zone` which room to join, so `--zone` is not needed (start the server with `SG2_START_ZONE=greenway`) |
   | `--cycle` | off | implies `--fight`; also requires deaths and a bot back in the Greenway after one (the death → statue → east gate → Greenway cycle). For a run of 120 s or more |

The bots stand still for a little over a second after joining (a new session starts with only 0.5 m
of movement banked), then measure for `--seconds` after the warmup. It prints:

- the patch rate the bots saw, and the server's own (`/healthz` `tickHz`, 5 s window);
- the server's peak memory (`/healthz` `peakRssMb`) and its event-loop delay p99 (`eventLoopP99Ms`,
  over 5 s windows: everything shares the loop, steps, patches and sockets);
- the server's room step time p95 (`tickMs`: the engine, movement, views, fx) and patch time p95
  (`patchMs`: encoding and sending the state, one encode per client's view), both over 5 s windows;
- bytes received per bot a second (state patches and messages), mean, p95 and max;
- how many adventurers each bot's state held (itself included), how many other bots really were
  within the interest radius by their own positions, and the `online` count it read;
- corrections, disconnections, chat lines heard, jumps, falls, stalls.

## Fighting bots (`--fight`)

```sh
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_ZONE=greenway npm start -w server
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60 --fight
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 120 --cycle
```

Each bot asks `GET /api/zone` which room to join. That endpoint allows 60 requests a minute per
account (and 600 per address, a loose ceiling), so every bot asks for itself. Every 4th bot swaps to
the Bow before it fights, and every 5th (by index mod 5 = 0, the sprinters) takes Sprint as its
second free pick. Every 5th from index 2 is a predictor (below). Every tick a bot in the Greenway:

- picks an enemy:
  - its current one while it lives within 45 m;
  - else one that is attacking it;
  - else the nearest live one within 40 m that fewer than 2 other adventurers in its view are
    fighting (1 for a Mossback).

  Players spread out like this too. 100 bots on 21 enemies otherwise kill each enemy in about 2 s,
  before its first telegraph, so there would be no dodging, knockbacks or deaths.
- with nothing to fight, walks (by `findPath` over the zone's ground) to the nearest camp it has not
  just left, and waits 20 s at a spot just outside it, clear of every spawn point, so it never holds
  a respawn up;
- builds a `BrainInput`:
  - from the state it sees: its own interest view, and the telegraphs' start from `TelegraphState.at`
    on the zone `clock`;
  - and from its last `self`, with the timers counted down since it arrived.

  It then runs the shared `adventurerBrain`, careful for 3 bots in 4 and careless for the 4th. Three
  careless bots go solo at a Mossback, so deaths happen.
- walks toward the brain's `moveTo` with the shared controller, and sends each pose as the browser
  does: what its controller did, with no check of its own first, so a pose the server wrongly refuses
  shows up as a correction:
  - most bots at 95% of run speed, at 0.4× while charging;
  - sprinters at the browser's full speed: run speed, ×1.4 from the moment Sprint's `use` fx arrives
    until 0.15 s before it ends, ×0.4 while charging; they press Sprint for walks longer than 10 m.
- sends the brain's intents:
  - a dodge carries the pose it starts from and the latest ack, and nothing more is sent until its
  `displaced` or `refused`;
  - a `displaced` (dodge, knock or resync) gives the new ack, and is played out for as long as the
    bot's own `simulateDisplacement` of it takes, with no poses meanwhile.
  - predictors roll as the browser does instead: at once, by their own `simulateDisplacement`, rolled
    back to the start on a refusal. They see their `displaced`, `correct`, `refused` and `respawned`
    450–650 ms late (a slow downlink), and roll twice in a row when both charges are there: the second
    roll goes 0.43 s after the first, from its predicted end, before the first's `displaced` has
    arrived, so it carries the ack before it (the server takes that from a client's own roll).

After a death a bot asks to respawn after 3 s, wakes at the grove's statue, walks to the east gate
and travels back. A `correct` that follows a dodge the engine refused is the protocol's rollback and
is counted apart, by the refusal's reason. Only `busy` (a knock landed between the press and the
server) can follow a legal dodge; a rollback for any other reason is a failure (the room took a dodge
the engine then refused). Every other `correct` is a failure.

A fight run passes only if all of these hold:
- every bot stayed connected;
- the mean patch rate is at least 14 Hz;
- 0 corrections, and no dodge rollback for a reason other than `busy`;
- no bot stuck (no move it could make) for 15 ticks in a row;
- credited kills ≥ 50, dodges ≥ 25 and knockbacks ≥ 1;
- at least one predicted second roll sent before the first's `displaced`, and every such roll rolled;
- at least one move sent at Sprint speed;
- every bot that died is back in the Greenway or on its way;
- the zone step p95 ≤ 15 ms;
- peak RSS ≤ 400 MB;
- no bot ever saw more than `MAX_ENEMIES_PER_ZONE` enemies.

`--cycle` adds deaths ≥ 1 and at least one bot back in the Greenway after a death.

Why not the plan's "dodges ≥ 100, deaths ≥ 1" in 60 s (coordinator ruling P3-i): the Greenway has 21
enemies on a 25 s respawn, and its camps are 37–218 m from the entry, so a 60 s run sees about 30
enemy deaths. A fight puts a bot inside about 2 telegraphs, and careful bots dodge about 90% of them.
Six tuned runs gave 28–54 dodges, and deaths of 0 or 1. The 60 s run is therefore gated at 25 dodges,
and deaths are gated on the 120 s `--cycle` run.

It prints, beside the usual numbers:
- kills credited (by kind) and the enemy deaths seen;
- deaths (careless and careful), dodges sent and rolled, knockbacks, resyncs and dodge rollbacks (by
  reason);
- predicted second rolls sent early and rolled; sprints and moves sent sprinting;
- displacements whose end differed from the bot's own simulation;
- telegraphs a bot stood in;
- bots back after a death, travels, and where the bots are at the end;
- refusals by reason;
- enemies alive (min and max, as some bot sees them);
- fx events a second.

## What a client receives (interest management)

Each client's room state is its own view (a Colyseus `StateView` per client, `server/src/rooms/interest.ts`):

- itself, always;
- adventurers and enemies within `INTEREST_RADIUS` = 60 m, which leave only beyond 70 m
  (`INTEREST_HYSTERESIS` = 10 m), so nothing flickers at the edge; checked 7.5 times a second from a
  grid of 70 m cells (each check reads the 3 × 3 cells around the client, not the whole zone);
- at most the 50 nearest other adventurers (`INTEREST_MAX_ADVENTURERS`): one comes in at rank 50 or
  nearer and leaves only past rank 60 (`INTEREST_RANK_HYSTERESIS` = 10); enemies are not capped;
- whatever the distance or the cap: the enemy it targets, enemies targeting it, and the owner of any
  telegraph it sees (parties, later); a telegraph is seen as soon as any part of it reaches within
  60 m (checked every step, so it arrives in the same patch it appears in);
- `online`: the zone's true head count (the HUD's "Adventurers online" should read it).

Combat fx go to clients that see the event's focus (`FX_RADIUS` is the interest radius). Chat is
zone-wide. Positions and facings are quantised on the wire (x/z 1/64 m, y 1/256 m, facing 1.4°,
`server/src/rooms/state.ts`); clients decode them to plain numbers. The ranges wrap, so every zone
must fit within ±500 m and heights −52..180 m (`shared/src/world/limits.ts`; the zone registry and
the generator throw otherwise).

## Results

### 2026-11-12: stricter bots (Plan 3 final review)

Same machine and settings as below, port 2576. The bots now send their poses unchecked, a fifth of
them at the browser's full speed with Sprint, a fifth predicting their rolls with a slow downlink and
double rolls; stalls and rollback reasons are gated. No server false rejection showed up in any run:
0 corrections, 0 rollbacks, every early second roll (`ack` before its first roll's) rolled, every
displacement's end matched the bot's own simulation. GET /api/zone is now limited per account, so
every bot asked for itself. The final bots (with the sidestep around obstacles, below) gave:

| run | result | bot Hz | KiB/s per bot (mean / p95) | step p95 | patch p95 | event-loop p99 | peak RSS |
|---|---|---|---|---|---|---|---|
| `--fight`, 100 bots, 60 s, 2 runs | PASS ×2 | 15.12–15.18 | 5.5–5.6 / 6.7–6.8 | 6.4–6.9 ms | 3.0–3.4 ms | 15.5–16.2 ms | 150–160 MB |
| `--cycle`, 100 bots, 120 s, 2 runs | PASS, FAIL (0 deaths) | 15.14–15.16 | 4.6–4.7 / 5.4 | 6.8 ms | 3.0–3.7 ms | 16.5–16.7 ms | 150 MB |
| grove, 100 walking bots, 30 s | PASS | 15.10 | 9.1 / 10.6 | 6.16 ms | 9.62 ms | 25.4 ms | 154 MB |
| grove, clustered (`--cluster 15`), 30 s | PASS | 15.10 | 10.5 / 10.6 | 5.71 ms | 10.21 ms | 21.5 ms | 154 MB |

| fight run | kills credited | deaths | back after a death | dodges rolled | knockbacks | early second rolls (sent / rolled) | sprints (moves sprinting) | longest stall |
|---|---|---|---|---|---|---|---|---|
| 60 s (2 runs) | 164–176 | 1 | 0 (on their way) | 31–38 | 12–13 | 3–5 / all | 56 (2187–2201) | 0 ticks |
| 120 s, PASS | 463 | 3 (the Mossback hunters) | 3 | 55 | 20 | 8 / 8 | 94 (3422) | 0 ticks |
| 120 s, FAIL | 483 (6 Mossback kill credits) | 0 | 0 | 55 | 15 | 4 / 4 | 89 (3585) | 0 ticks |

Earlier runs of the same bots before the sidestep: 60 s ×5 gave 23–42 dodges (one run FAILed at 23 <
25) and one FAILed with a bot stuck 32 ticks against a rock at (175, 28) in the Greenway (its path
started inside the clearance margin): the bots now sidestep a blocked step as a player would and
search a new route after 8 sidesteps. A 120 s cycle run then PASSed (3 deaths, 3 back). The deaths
gate depends on the three careless hunters losing to a Mossback; in the failing run the Mossbacks
died 6 times instead (other bots joined in), so the gate is not deterministic. The clustered case
with the state `clock` (ruling P3-g accepted ≤ ~11 KiB/s): 10.5 KiB/s, as before the clock. A 10-bot
`--stand` run saw 15.00 Hz.

### 2026-11-12: fighting bots, the smoke test (Plan 3 Task 9)

Run on the development sandbox (4 CPU cores, 16 GB RAM, Node 22), with server and bots on the same
machine. The server was started with `tsx server/src/index.ts`, `SG2_STORE=memory`,
`SG2_AUTH_RATE_PER_MIN=1000` and `SG2_START_ZONE=greenway` (the grove run used the default start
zone), on port 2574, and stopped by its process group. The Greenway has 21 enemies (19 ordinary and
2 Mossbacks). Every run had 0 corrections and 0 disconnections, the server held 15–15.2 Hz in every
5 s window, and the step and event-loop figures are the worst 5 s window.

| run | result | bot Hz | KiB/s per bot (mean / p95) | step p95 | patch p95 | event-loop p99 | peak RSS |
|---|---|---|---|---|---|---|---|
| `--fight`, 100 bots, 60 s | PASS | 15.17 | 5.3 / 6.3 | 7.45 ms | 3.43 ms | 17.5 ms | 148 MB |
| `--cycle`, 100 bots, 120 s | PASS | 15.15 | 4.6 / 5.4 | 6.29 ms | 3.35 ms | 14.1 ms | 151 MB |
| grove, 100 walking bots, 30 s (no `--fight`), 3 runs | PASS ×3 | 15.10–15.13 | 9.0–9.2 / 10.3–10.8 | 3.46–4.61 ms | – | 14.0–15.3 ms | 133–148 MB |

| fight run | kills credited (Thornling / Boar / Archer / Mossback) | enemy deaths seen | deaths | back after a death | dodges | knockbacks | dodge rollbacks | refusals (most) | enemies alive (min–max seen) |
|---|---|---|---|---|---|---|---|---|---|
| 60 s | 156 (90 / 36 / 30 / 0) | 30 | 1 (careless) | 0 (still on its way) | 33 | 16 | 0 | ability no-target 42, sight 16 | 2–11 of 21 |
| 120 s | 490 (229 / 104 / 155 / 2) | 72 | 3 (careless, the Mossback hunters) | 3 | 48 | 19 | 0 | ability no-target 126, cooldown 26 | 2–10 of 21 |

The bots used to step at most 0.25 s per tick, which is stepBody's own cap. A timer that fired late
therefore left the body behind the clock, and its jump arc ran late against the server's
wall-clock ceiling: the known flake. The bots now step the whole gap (`stepFor` in bots.ts).

The first grove run after that change still failed, with 1 correction and 1 tick in the air with no
pose the server would take: a jump 0.13 s old was already 2.1 m up. The most likely cause is a jump
taken at the start of a tick's whole gap, which puts the first pose in the air further along the arc
than the server allows: it assumes a take-off at most one send interval before that pose. The bots now
press a jump at the end of the gap, and all three runs above came after that. This edge case is rare,
so three clean runs do not prove the fix.

Every displacement's end matched the bot's own `simulateDisplacement` of it. The fighting bots
receive 4.6–5.3 KiB/s each: half of the walking bots' 9.1, because a bot that fights stands still
most of the time. Earlier tuning runs (same settings, 60 s) gave 28–54 dodges, 2–25 knockbacks,
0–1 deaths, step p95 5.6–8.5 ms, event-loop p99 14–21 ms and 147–152 MB peak RSS. Ruling P3-i set
the gates from these ranges (see "Fighting bots" above).

Browser smoke test: `node server/scripts/smoke.mjs http://localhost:2574 --kill "kill -- -<pid>"`,
run against a server started with `SG2_START_ZONE=greenway` and `SG2_CLIENT_DIR=client/dist-online`.
Result: PASS. The combat steps took:
- 26 s to kill the Thornling (Tab, a tap, walking 35 m into reach);
- 22 s from standing at the next camp to "Defeated", returning to the statue and being in the
  grove at 100 hp.

On this machine a starved page can miss the client's 15 s join timeout while three pages build the
Greenway at once. The script then presses "Continue as" again; one of three pages needed this in 2
of 3 runs.


### 2026-11-12: interest management (Task 10), walking bots

2026-11-12, development sandbox (4 CPU cores, 16 GB RAM), server and bots on the same machine,
`SG2_STORE=memory`, `SG2_AUTH_RATE_PER_MIN=1000`, port 2571, server run with
`tsx server/src/index.ts`, 100 walking bots, 30 s measured. "Before" is commit 4299dae (every
adventurer to everyone, positions as float64); "views" adds the interest radius and quantised
positions; "capped" adds the 50-nearest cap (the current code). Every run: 0 corrections, 0
disconnections, PASS, bot patch rate 15.10–15.13 Hz.

KiB/s received per bot (mean, p95 in brackets), and adventurers in view (itself included; other bots
really within 60 m in brackets):

| zone, bots | before | views | capped | in view, capped |
|---|---|---|---|---|
| grove, from the spawn (`--warmup 2`) | 54.5 | 11.2 (13.4) | **9.2** (10.7) | 49 (58) |
| grove, spread out (`--warmup 40`) | 55.5 | 6.9 (8.6) | – | 35 (30), views run |
| grove, clustered (`--cluster 15`) | 49.6 | 16.5 | **10.5** (10.6) | 56 (99) |
| Greenway, from the entry | 55.6 | 12.1 (14.6) | **9.3** (10.9) | 47 (55) |
| Greenway, spread out (`--warmup 40`) | 58.2 | 6.4 (8.9) | – | 30 (25), views run |
| Greenway, clustered (`--cluster 15`) | 52.8 | 17.6 | **10.9** (11.1) | 56 (99) |

Server, capped runs (worst 5 s window): room step p95 4.3–6.4 ms (before: 3.4–5.4), patch p95
4.0–6.0 ms, event-loop delay p99 14.6–18.0 ms, peak RSS 142–147 MB (before: 127–151). The spread-out
runs were not repeated with the cap: fewer than 50 are in range there, so the cap does not act.

Where the bytes go: a walking adventurer's update cost 38 bytes per patch before (x, z, y and facing
as float64, 9 bytes each with the field index, plus about 2 bytes to address the entry) and costs
about 11.5 now (3 + 3 + 3 + 2, plus 2). Without the cap, 100 adventurers in sight of each other cost
99 × 15 a second × 11.5 bytes ≈ 17 KB/s; with it, 50–60 of them plus the cost of the ones swapping in
and out at the rank edge (each arrives whole, about 25 bytes).
The bots turn their facing by up to ±0.2 rad every tick, so they cost a little more than players do.

Fighting: 100 brain-driven adventurers at the Greenway's 21 camps (the Task 6 scratch driver) receive
0.5 KiB/s each (was 2.0); room step p95 3.4–3.6 ms over 60 s, 0 corrections.

A view's own memory is small: 100 views that each see 100 adventurers and 21 enemies take about
650 KiB in all (6.5 KiB each).

### Earlier: 2026-11-11, before combat (Plan 2)

```
players: 100
patch rate seen by bots: mean 15.12 Hz, min 15.12 Hz (over 60.0 s)
server patch rate (/healthz, 5 s window): min 15 Hz, max 15.2 Hz
server peak RSS: 117 MB
corrections: 0; disconnected bots: 0; chat lines heard: 30800
PASS
```

The same run against the Docker image (`docker compose up -d` with `SG2_AUTH_RATE_PER_MIN=1000`,
server bundle `node server/dist/index.js`, PostgreSQL 16 store) passed with a peak RSS of 91 MB;
`docker stats` showed `sg2-server` at 46 MiB of 1 GiB and `sg2-db` at 61 MiB of 512 MiB.
