# Load test: 100 adventurers in a zone

`server/scripts/bots.ts` signs in `--count` guest adventurers into one zone, has each walk in random
legal steps at the server's update rate (15 a second, at running speed, jumping now and then) and say
a chat line every 20 seconds, then prints what it measured. It exits with status 1 unless every bot
stayed connected, the mean state-update rate the bots saw was at least 14 a second, and no bot had a
step corrected. Bots do not fight; a knockback or a respawn only moves them.

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
   | `--stand` | off | stand still (still chat); the patch rate is not checked then, since an unchanged state sends no patches |
   | `--warmup <s>` | 2 | wait this long after the last join before measuring: with 40 the bots have spread out over the zone |
   | `--cluster <m>` | none | keep every bot within this many metres of where it joined (all join at the spawn): with 15, all 100 are within 30 m of each other, the worst case for interest management |

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
