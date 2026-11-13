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
   SG2_AUTH_RATE_PER_MIN=1000 SG2_HEALTHZ_DETAIL=all docker compose up -d   # for the bot run only
   docker compose up -d                              # afterwards: back to 10 a minute
   ```

   (The image runs with `NODE_ENV=production`, where `/healthz` gives callers outside the container
   only `ok`, `players` and `tickHz`; the bots read the rest, so `SG2_HEALTHZ_DETAIL=all` for the run.
   A server started with `npm start` without `NODE_ENV=production` always gives everything.)

   Do not leave `SG2_AUTH_RATE_PER_MIN` raised on a public server: the limit is what slows down
   password guessing.

   Joins (every matchmake call: a sign-in's first join, each travel, each instance entry) are
   limited too, per address: `SG2_JOIN_RATE_PER_MIN`, 600 a minute by default, which covers 100
   bots joining at once and travelling. A larger or longer bot run from one address that sees
   `Too many joins from your address` raises it (for example `SG2_JOIN_RATE_PER_MIN=5000`).
   Separately, an account may have only one join pending (matchmade, socket not yet open) at a
   time; a seat reserved by matchmaking is held 5 s (`SEAT_RESERVATION_S`).

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
   | `--jobs mixed` | off | only with `--fight`/`--cycle`: all seven jobs, in duos, chosen at the Guild Board (below); start the server with the default start zone (the grove) |
   | `--assist <name>` | off | the browser smoke test's two helpers (a Black Mage and a White Mage) for the adventurer called `<name>` (below); no pass marks |
   | `--dungeon <n>` | off | with `--fight` (and usually `--jobs mixed`): the first bots form `n` parties and run the Lampfall (below, "Parties and the Lampfall") |
   | `--warden <spec>` | off | scripted Warden runs, for a server with `SG2_START_AT=lampfall-mouth SG2_TEST_INSTANCE_START=landing` (below); sets `--count` itself |
   | `--join <name>` `[--count 1-3] [--skill s]` | off | the party smoke test's helpers: bots that join `<name>`'s party and run the Lampfall with it (below); no pass marks |
   | `--looks` | off | each bot spends its free creator visit on a random look (`randomLook(prng(index + 1))`, `POST /api/look`) before joining; prints how many distinct looks bot 0 sees (below, "Looks, gear and the opening quest") |
   | `--gear` | off | with `--fight`: the Smithy, the Tailor, a worn piece taken off and put on every 60 s, drops sold, talents, and a gold and item ledger per bot (below); start the server with `SG2_TEST_START_GOLD` ≥ 200 |
   | `--parties` | off | walkers in parties of four (bot 4k invites the next three): the party status lines in the walkers' bandwidth |
   | `--quest` | off | with `--fight`: bots follow the opening quest (`questGoal`, below); without `--fight`: walkers that carry quest state |

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
- credited kills ≥ 50, dodges ≥ 20 (ruling P3-j) and knockbacks ≥ 1;
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
Six tuned runs gave 28–54 dodges, and deaths of 0 or 1. The 60 s run was therefore gated at 25 dodges,
and deaths are gated on the 120 s `--cycle` run. The stricter bots of the final review (sprinters and
predictors, which reach and kill enemies sooner) rolled 23–42 in 60 s over 8 runs, so ruling P3-j set
the gate at 20. The three careless hunters fight their Mossback strictly alone: no other bot engages
an elite a hunter is on, so the hunters die and `--cycle`'s deaths gate holds.

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

## Mixed jobs (`--fight --jobs mixed`, Plan 3b)

```sh
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 npm start -w server   # the grove start
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60 --fight --jobs mixed
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 120 --cycle --jobs mixed
```

Bot i is a `JOB_IDS[i % 7]` (all seven jobs, 14–15 bots each). Each:
1. joins the grove (a town), walks to the Guild Board, sends `job` for its job (its own job too, for the Warriors)
   and waits for the `jobs` that confirms it, then sends `loadout`: the job's duo picks when it has a bot partner
   (i ^ 1), its solo picks otherwise;
2. walks to the east gate and into the Greenway, and there sends one `job` for `JOB_IDS[(i + 1) % 7]`, which must
   come back `refused { action: 'job', reason: 'not-here' }`;
3. fights with the shared brain, passing every other adventurer its state holds within `ALLY_VIEW_R` (30 m, dead
   ones included) as `allies`, and its own `self` (job, `dodgeMax`, cast) as the server sends it.

Ally-aimed presses (heals, shields, Kindred Spark, revives) carry the brain's explicit `ally` id. Since Plan 4 the
engine's automatic pick (and area supports such as Soft Rain or a Bedrock shield) reach only the caster's party,
and these bots are in no party (party bots are Plan 4 Task 10's), so a heal or a revive reaches another bot only
by its id: the run counts presses that carried one. Casting bots walk at `CAST_MOVE_SCALE` from the press until
the cast's `castEnd`.

Camps are fought by several adventurers again (Task 6 had lowered this to one each): up to 2 on an ordinary
enemy and 2 on a Mossback, and the odd bot of a duo takes its leader's target and follows it between fights, so
duos form and shared kill credit, threat from two attackers, ally heals and cross-job reactions run under load.
Five careless hunters fight the two Mossbacks, each keeping to one camp:
- at the farther Mossback, together, three with a medic: a Dark Knight and a Warrior with picks that have no heal,
  shield or evasion of their own (they hold it in its Ground Slams and fall), and a Black Mage with Stormcage and
  Rootbreak (its lightning on the Soaked Mossback is Conduct). Each is followed by a White Mage with Second Dawn,
  its medic, which only soaks the hunter's target with Tidelash and revives it (no heals, no shields); a dead hunter
  whose medic is near and ready waits up to 20 s for its revive before it asks to respawn;
- at the nearer Mossback, one at a time, two with no medic that only auto-attack (they press nothing and never
  dodge: a player who never touches a button), so that a death with no revive ends in the respawn and the walk back
  inside a 120 s run.

A White Mage leading a Black Mage (the duos of bots 14k+12 and 14k+13) takes the toughest ordinary enemy in
reach, not the nearest, and never spends its partner's Soaked on its own finisher: a fight long enough, and a
Soaked mark left, for the Black Mage's Skyfall Arc (Conduct).

It prints, beside the fight run's numbers: bots by job, duos, job switches accepted at the board, `not-here`
refusals, casts and cast breaks by reason, reactions by kind, revives (fx and `revived` messages), ally heals
(count and hp), self heals, ally shields, Momentum gifts, presses with an explicit ally id, kills by job and xp
gained by job. Each bot counts only its own events, so nothing is counted twice.

A mixed run passes only if the fight run's gates hold (with the dodge gate below in place of 20) and:
- job switches accepted at the board = `--count`, and `not-here` refusals = `--count`;
- every job has at least one kill;
- per 95 s of fighting (a 120 s run; the bots spend about 25 s on their jobs and the walk, and a 60 s run is
  scaled to its 35 s): dodges ≥ 30, casts ≥ 50, reactions ≥ 5;
- `--cycle`: reactions of at least 2 kinds, besides the deaths and the bot back in the Greenway (ruling P3b-j:
  until Plan 4 it needed one of each kind and a revive, which about half the runs missed; the party bots of
  `--dungeon` now carry those gates);
- every `self` carries `job`, `dodgeMax` and `cast`;
- a predicted second roll that a knock replaced (the server sent the knock first) is counted apart, not as a
  roll that failed.

Why these marks and not the brief's (casts ≥ 100, dodges ≥ 25): with two fighters to an enemy, about 60% of casts
fizzle because the target dies first, and the mages are 28 bots of 100; measured 120 s runs gave 71–111 casts
(mostly 78–98) and 44–58 dodges, and the 60 s runs 27 casts and 16 dodges. The gates sit below the lowest
measured, with headroom. With three fighters to an enemy the casts rose to about 90–110, but dodges fell to
34–39 per 120 s and Conduct was missing from one run; with four, a 60 s run rolled 6 dodges.

### The smoke test's helpers (`--assist <name>`)

Two bots, a Black Mage (Bastion Stone, Rootbreak) and a White Mage (Second Dawn, Soft Rain), take their jobs at
the Guild Board, come to the adventurer named `<name>` (from the grove, or from the Greenway through its west
gate), fight its target (and whatever attacks them) and revive it when it falls. They never heal or shield it,
so it still falls. A line `hold` on their stdin stops them fighting (they only follow and revive), `fight` lets
them fight again. They print `assist: ready`, and `assist: <fx>` for each reaction and revive they see. They leave
their rooms on SIGTERM.

## Parties and the Lampfall (`--dungeon`, `--warden`, `--join`, Plan 4)

```sh
# the dungeon load run: the default start zone (the grove)
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 npm start -w server
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 240 --fight --jobs mixed --dungeon 13
# the scripted Warden runs (test switches: never on a real server)
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_AT=lampfall-mouth SG2_TEST_INSTANCE_START=landing npm start -w server
npm run bots -w server -- --url http://localhost:2570 --seconds 420 --warden "paladin+black_mage:careful,warrior+ranger+white_mage:sloppy,paladin:careful"
```

**`--dungeon <n>`.** The first bots form `n` parties, of sizes 4, 3, 2, 4, 3, 2, ... (`--dungeon 13`: 40 bots,
the first 12 parties 36 of them). Member i is a `JOB_IDS[i % 7]` with its duo picks, taken at the Guild Board as the
mixed bots do. The leader invites each member by name (`party {op: 'invite', name}`) once everyone has joined, and
again every 20 s for anyone not yet in (9 invites a minute at most, under the limit of 10); a member accepts only its
own leader's invite. In a party with a White Mage one other member is careless (it never dodges), so the White Mage
has someone to revive. The party walks to a gather spot on the road 10 m short of the crater mouth (`findPath`
over the Greenway's ground), and once the party is whole, every member is there and none is in combat, they all walk
into the mouth: the first opens the party's instance (`travel {zone: 'lampfall', instance}`), the others join it by
id (`joinById`). On the way they only fight back. Inside, each member:
- predicts the shut lamp-gates as walls (`gatedSurface` over the state's `gates`, for its body and its paths);
- goes room by room in `lampfallLayout()` order to the first room whose encounter is not in the `instance` message's
  `cleared`, first to a gather spot 8 m back along that room's entry corridor (outside any gate circle), and walks in
  once every live member of its party in the instance is there (or after 30 s);
- fights with the dungeon brain (`dungeonBrain`), with every required input filled from what it sees: `allies` its
  party members (dead ones included), `arena` the room (a disc), `fields` the state's fields, `enemies` the live
  enemies in its view, `home` the enemy's own spawn in its room (a Lens Shard: the Warden's) with its leash. Its
  target is the boss while it lives, else the pack's live enemy with the least hp (the simulation's rule, so a
  party focuses); the brain's own target intents (a warded boss's Lens Shard first) are sent as it says;
- dead, it lies while a White Mage of its party with Second Dawn ready is within 30 m (up to 20 s); inside a sealed
  fight it lies (a revive, the wipe or the 60 s auto release); otherwise it sends `release` once it may (10 s);
- after a wipe everyone is up at the checkpoint and the party gathers and walks in again.
Inside, the leader says a party chat line every 15 s (with markup), only while every member is in its instance;
party bots say no zone chat there. Bots that are not in a party fight in the Greenway as before; their roles
(duo partners, hunters, medics, sprinters, predictors) count from the first bot after the parties, so they are the
same as in a plain mixed run of that many bots. The party that reaches the mouth 13th (not always party 12: the duos
walk slower to the gather spot) is told `REASON_INSTANCES_FULL` (the `correct`
and the notice the rule gives: not counted as a correction) stays in the Greenway and fights there.

It prints, beside everything above: parties planned and formed, invites sent, accepted and refused (by reason),
instances opened (and the most open at once), parties told the Lampfall is full, mouth refusals in combat, per
instance its first pack's time after entry, packs, Wickhound and Warden kills and wipes; deaths inside, releases,
revives inside; the party bots' reactions, revives, interrupts and Breaks; party chat lines sent, deliveries due
(each line × the other members) and received; the instances' worst step p95 (`/healthz` `instances.tickMsP95Max`).

A `--dungeon` run passes only if the fight run's and the mixed run's gates hold and:
- parties formed = the parties planned; instances opened = min(n, 12); full notices = max(0, n − 12) parties; at the
  end every party is whole in one instance, or wholly in the Greenway after the full notice;
- every instance kills its first pack within 150 s of its first member's arrival;
- party chat received = deliveries due (and at least one line sent);
- the party bots show every reaction kind (Blast, Conduct, Steam, Bedrock) at least once (ruling P3b-j moved this
  from the Greenway's `--cycle` gate here; `--cycle` now needs reactions ≥ 5 of at least 2 kinds). Revives are
  printed, not gated: careful parties at the packs lose 0–4 members a 240 s run and a White Mage is near for only
  some of those (measured 0–1 revives a run); the Warden runs and the live checks show them (below);
- every zone room's step p95 ≤ 15 ms, every instance's ≤ 3 ms, peak RSS ≤ 400 MB.

**`--warden <spec>`.** `spec` is a comma list of parties, each `job+job…:skill` (skills as the simulation's:
`careful`, `skilled` and `sloppy` miss 0%, 10% and 30% of the telegraphs they would answer, `careless` never
dodges). The bots start at the mouth, form each party, walk in (the test start puts the instance at the Keeper's
Landing with the packs and the Wickhound dead), take their jobs and picks at the landing's sanctuary (duo picks in
a party, solo picks alone), gather before the Lens Pit and walk in together, and fight to a kill, a wipe or
`--seconds` (the run ends early once every party is done). It prints per party: the outcome, seconds from the
Warden's wake to the end, the phase reached, whether it enraged, deaths, revives, interrupts and Breaks. It never
gates on the outcome (the simulation's bands do), only on: no correction, no disconnection, every party reached the
Lens Pit, the bots' patch rate ≥ 14.5 Hz, every zone step p95 ≤ 15 ms and instance step p95 ≤ 3 ms, peak RSS ≤
400 MB, and the event-loop delay p99 ≤ 50 ms (provisional: Plan 4 Task 7 measured 19.9 ms for 12 instances of
walkers on a quiet machine).

**`--join <name>`.** For the party smoke test (a server with `SG2_START_AT=lampfall-mouth`): `--count` 1–3 bots (a
White Mage with Second Dawn, a Black Mage, a Warrior) accept the invites of the adventurer called `<name>` (it
invites them by name: they print `join: names a,b`), walk into the mouth once it is inside, take their jobs at the
rim's sanctuary and run the Lampfall as the party bots do (they do not wait for the adventurer). `hold` on stdin
makes them stand once inside (they still fight back and revive), `go` lets them carry on. No pass marks.

### The party smoke test (`smoke-party.mjs`)

```sh
(cd client && npm run build:online)
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_AT=lampfall-mouth SG2_CLIENT_DIR=client/dist-online npm start -w server
node server/scripts/smoke-party.mjs http://localhost:2570 --kill "kill <pid>" [--shots <dir>] [--helpers]
```

Page A (desktop) and page B (iPhone 13) play as guests, each through the character creator (its default look,
Done: a guest is already named); A taps B and invites it from the focus frame, B accepts on its card, each shows
the other in a party frame; A's party chat line with markup reaches B as plain text, tagged; both walk into the
mouth and are in the same instance; both walk to the Root Cellar, target with Tab and fight; the first pack (two
Thornlings and an Archer) is dead within 300 s of game time (the instance lists `root_cellar` as cleared and each of
the three was seen dead), both still inside; B reloads and is back in the same instance and party; A presses P and
leaves the party, is told why within 15 s and sent to the Greenway, where it stands at the mouth; killing the
server shows "Connection lost". Any page error fails it. `--helpers` adds two `--join` bots to the party first.

## Looks, gear and the opening quest (`--looks`, `--gear`, `--quest`, Plans 5 and 6)

```sh
# gear and quests in one run (test switch: never on a real server)
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_TEST_START_GOLD=200 npm start -w server
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 420 --quest --fight --looks --gear
# the quest from its first fight, in the Greenway
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_ZONE=greenway SG2_TEST_QUEST=solstice_crossing:first_fight npm start -w server
npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 240 --quest --fight
# the Warden in gear: one tier a server (SG2_TEST_KIT); the kit named in the spec is printed beside the band
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_AUTH_RATE_PER_MIN=1000 SG2_START_AT=lampfall-mouth SG2_TEST_INSTANCE_START=landing SG2_TEST_KIT=t2 npm start -w server
npm run bots -w server -- --url http://localhost:2570 --seconds 420 --warden "paladin+black_mage:sloppy@t2"
```

**`--looks`.** Before joining, each bot `POST`s `/api/look` with `randomLook(prng(index + 1))` (its one free creator
visit; a guest has no name to give). At the end it prints how many adventurers bot 0's view holds, how many have a
look code from its `looks` messages, and how many of those codes differ; the run fails unless the distinct codes are
at least 90% of the adventurers in its view.

**`--gear`** (with `--fight`; the server needs `SG2_TEST_START_GOLD` ≥ 200).
- In the grove, once it has its job, a bot walks to the Smithy, buys its job's T1 chest (`buy` with a random op id,
  the same id if it has to ask again, so a resend is a dup and never a second purchase) and equips it; with 150 gold
  left it buys the Straw Sunhat at the Tailor and wears it; then it goes on as before.
- In the Greenway, every 60 s, out of combat, it takes the chest off and puts it on again (`unequip`, `equip`).
- Back in the grove after a death it sells one unworn drop at the Smithy on its way to the gate.
- A `levelUp` with a talent row queues a `talent` pick (choice index % 3), sent the next time it is in a town.
- **The ledger.** Every `inventory` is checked against the one before: gold moves by exactly the `loot` gold (with
  drops a full bag sold) and the `questDone` gold since then, plus sales (each sold uid's sell price) minus
  purchases (each new uid that was no drop and no quest item: its Smithy price) minus new costumes; every new uid is
  a drop, a quest item, a purchase or a starter piece minted by an unequip; every uid that went was sold; and no uid
  ever comes back. The first view after joining a room after a travel may carry loot written while the bot was
  between rooms (no `loot` message reaches it): that view resyncs the ledger and is counted apart.
- It prints purchases, costumes, sales, equips, swaps, talents, drops, loot gold, refusals by reason, the server's
  inventory writes a second (`/healthz` `invWritesPerS`, p95 and max) and the ledger.
- **It passes** only if the fight run's gates (and Plan 4's with `--dungeon`) hold and: every inventory refusal is
  `'combat'` or `'busy'` (none `'rate'`); every ledger matches; no uid repeats; at least one purchase;
  `invWritesPerS` p95 ≤ 40; every zone step p95 ≤ 15 ms.

**`--quest`** (with `--fight`). Each bot follows `questGoal(view, here)` (`shared/src/story/questBot.ts`) on its own
`quests` view: the main quest first; it walks (`findPath`, through the grove's east gate or the Greenway's west gate)
to talk (`quest {act: 'talk'}`, a reward choice index % 3), use, accept and skip; hops in place for `pim_hop` (a real
rise of about 1.45 m, at most one every 1.2 s); sends `job` with its job at the Guild Board; fights with the shared
brain for kills and acts (kinds filter its targets and camps); equips the chest piece for `equip`. When a combo is
still missing and its kit has no mark to set off (a new Warrior), it takes the marking pick of its pool
(Skullringer), as the step's hint says; a pick, finisher or dodge still missing after 30 s of fighting gets a nudge.
The optional `duo` step: every eighth bot (role index 1 mod 8) invites the next to a party there and they fight
together (the partner takes the leader's target); bots with index % 4 = 0 hunt a Mossback; the rest skip; any of
them skips after 60 s at the step. After the main quest every third bot takes Bristle Bounty and every fifth Gran's
Waymarks; every tenth takes the epilogue and abandons it. Without `--fight` the bots are walkers that carry quest
state (a talk, use or hop only where they happen to stand): the walkers' bandwidth with quests on.

It prints the bots by main-quest step at the end, how many are past `board` and `first_fight` and done, quests
completed, steps done (`questDone`), scenes, what the bots still at a fighting step lack, acts sent, `questRefused`
by reason, quest gold and items, nudges and pick swaps.

**`first_fight` slots.** The step asks every bot for three Thornlings, and the Greenway has nine (a 25 s respawn; up
to four adventurers are credited with each kill): with 100 bots on them at once, 65–76% got past the step in a run,
every bot still there short of kills. That is the test's crowding, not the quest, so at most `QUEST_FIGHT_SLOTS` bots
(four a Thornling: 36) fight at the step at once; the others wait where they stand (fighting back if attacked) and
take a slot as one frees. The run prints the slots, how many bots waited, and of the bots that held a slot at least
150 s before the end (`QUEST_SLOT_GATE_MS`; a slotted bot needs about 100 s for its three kills, its finisher, combo
and dodge) how many are past the step. The whole zone's Thornling supply (about one credited kill a second) is a
property of the Greenway, printed, not gated.

**It passes** only if the gates above hold (the ledger includes quest gold and items) and: every `questRefused` is
`'where'`, `'busy'` or `'bag-full'`; at least 36 bots (the slots) held a `first_fight` slot 150 s before the end and
≥ 80% of them are past the step (a run of at least 400 s started in the grove, or of at least 200 s started
elsewhere); and in a run of at least 400 s started in the grove ≥ 95% of the bots are past `board` and ≥ 50% have
finished the main quest.

**`--warden` kits.** A party may name its kit: `job+job:skill@kit` (`starter`, `t1`, `t2`, `t3`). The server gives
every new adventurer one tier (`SG2_TEST_KIT`), so each kit is its own run; the tiers each party really wore (from
its last `inventory`) and its level are printed beside the outcome and its band (G2–G5). It never gates on the outcome.

### The gear and quest smoke tests (`smoke-gear.mjs`, `smoke-quest.mjs`)

```sh
(cd client && npm run build:online)
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_TEST_START_GOLD=1000 SG2_TEST_LOOT=always SG2_CLIENT_DIR=client/dist-online npm start -w server
node server/scripts/smoke-gear.mjs http://localhost:2570 --kill "kill <pid>" [--shots <dir>]
SG2_STORE=memory SG2_JWT_SECRET=$(openssl rand -hex 32) SG2_CLIENT_DIR=client/dist-online npm start -w server
node server/scripts/smoke-quest.mjs http://localhost:2570 --kill "kill <pid>" [--shots <dir>]
```

`smoke-gear.mjs`: page A (iPhone 13) registers; the creator opens and A picks Brindlekin, moves three body sliders,
hair style 12, a free fur colour (the hue strip) and a name, Done; A's look code says so (people, sliders, hair) and
A has that name; page B (desktop, a guest through the creator) holds A's look code among those its room sent; A buys
the Straw Sunhat at the Tailor and wears it, and A's gear code on B changes; A walks out to the Greenway and fights
Thornlings until a `loot` holds an item; A opens the bag and equips it, and `__sg2net.stats` before and after are
what the shared kit rules (`kitFor`) give for the gear worn; A (no game master) sends `/gm announce hi` and no
announcement reaches A or a fresh B; killing the server shows "Connection lost". Any page error fails it.

`smoke-quest.mjs`: page A (iPhone 13) and page B (desktop), guests; A takes "Surprise me" in the creator; the
tracker reads "Speak with Old Marrow"; A taps Old Marrow where `__sg2.screenOf` puts him, walks over and pages
through: step `pim_find`; A taps the pointer chip, is walked to the tavern, Pim's call shows (a dialogue by Pim),
A taps Jump: step `pim`; A taps Pim and pages through: step `plaque`; A reloads: still `plaque`; A reads the plaque:
a `questDone` with scene `beacon` and `beaconRaised`; B's quest state never moved (no `questDone`, still at
Marrow) and its websocket bytes in the 20 s before and after A's plaque differ by under 5%; killing the server
shows "Connection lost". Any page error fails it.

The smoke tests open the page with `?checks` in its URL: the `window.__sg2` and `window.__sg2barber` hooks they
drive the game with exist only in development or with that flag (`window.__sg2net`, read-only, is always there).
A playtest by hand in a browser adds `?checks` the same way.

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

### 2026-11-13: looks, gear, the opening quest; every run again on a quiet machine (Plan 5 Task 11, Plan 6 Task 7)

Development sandbox (4 CPU cores, Node 22), server and bots on the same machine, port 2574, `SG2_STORE=memory`,
`SG2_AUTH_RATE_PER_MIN=100000 SG2_JOIN_RATE_PER_MIN=100000`, server `node --import tsx server/src/index.ts` from the
branch at the final-review server fixes (71e3275) plus the seat-hold fix (44fe36c), a fresh server per run, stopped by
PID. Nothing else ran on the machine (1-minute load average per run in the table). **These numbers replace the
provisional ones below.** Gates are each run's own (above); a FAIL names what failed.

| run | load | result | bot Hz | zone step p95 max | instance step p95 max | event-loop p99 max | peak RSS | KiB/s per bot (mean / p95) | corrections |
|---|---|---|---|---|---|---|---|---|---|
| grove, 100 walkers, 30 s | 1.99 | PASS | 15.12 | 9.14 ms | - | 19.12 ms | 161 MB | 8.8 / 10.3 | 0 |
| grove, 100 walkers, 30 s (again) | 0.89 | PASS | 15.10 | 8.92 ms | - | 22.23 ms | 162 MB | 9.0 / 10.5 | 0 |
| grove `--cluster 15` | 1.55 | PASS | 15.12 | 9.1 ms | - | 22.77 ms | 164 MB | 10.7 / 11.0 | 0 |
| grove `--looks` | 1.13 | PASS | 15.09 | 8.18 ms | - | 24.99 ms | 166 MB | 9.0 / 10.7 | 0 |
| grove `--cluster 15 --looks` | 0.86 | PASS | 15.09 | 11.54 ms | - | 26.59 ms | 163 MB | 10.8 / 10.9 | 0 |
| grove `--cluster 15 --looks --parties` | 0.90 | PASS | 15.12 | 8.24 ms | - | 22.09 ms | 158 MB | 11.0 / 11.1 | 0 |
| grove `--cluster 15 --looks`, `SG2_TEST_KIT=t3` | 0.77 | PASS | 15.09 | 7.89 ms | - | 25.67 ms | 163 MB | 11.0 / 11.2 | 0 |
| grove `--quest` (walkers) | 0.97 | PASS | 15.12 | 10.44 ms | - | 23.27 ms | 161 MB | 9.1 / 10.5 | 0 |
| grove `--quest` (walkers, again) | 0.68 | PASS | 15.11 | 10.13 ms | - | 20.46 ms | 165 MB | 9.0 / 10.6 | 0 |
| grove `--cluster 15 --quest` | 0.72 | PASS | 15.09 | 9.36 ms | - | 18.4 ms | 166 MB | 10.8 / 11.0 | 0 |
| Greenway `--fight`, 60 s | 1.08 | PASS | 15.04 | 11.24 ms | - | 23.15 ms | 166 MB | 5.9 / 6.9 | 0 |
| `--cycle --jobs mixed`, 120 s | 0.88 | PASS | 15.13 | 10.41 ms | - | 20.61 ms | 169 MB | 5.4 / 6.5 | 0 |
| `--fight --jobs mixed --dungeon 13`, 240 s | 0.61 | PASS | 15.21 | 9.08 ms | 2.05 ms | 21.69 ms | 170 MB | 4.0 / 5.0 | 0 |
| `--fight --jobs mixed --looks --gear --dungeon 13`, 240 s, gold 500 (a) | 0.56 | FAIL: instance step p95 reached 3.08 ms (over 3) | 15.09 | 10.67 ms | 3.08 ms | 23.35 ms | 173 MB | 4.2 / 5.3 | 0 |
| the same (b) | 0.48 | FAIL: inventory refusals other than combat, busy: unequip dead 1, equip dead 1 | 15.10 | 13.24 ms | 2.28 ms | 21.41 ms | 175 MB | 4.2 / 5.2 | 0 |
| the same (c, bots swap only at full health) | 0.41 | FAIL: 29 legal steps were corrected; inventory refusals other than combat, busy: buyCostume where 3 | 15.11 | 11.22 ms | 2.13 ms | 24.95 ms | 178 MB | 4.2 / 5.1 | 29 |
| `--quest --fight --looks --gear`, 420 s, gold 200 (a) | 1.05 | FAIL: 65 of 100 past first_fight (under 80%) | 15.12 | 11.74 ms | - | 24.64 ms | 189 MB | 4.2 / 5.1 | 0 |
| the same (b, up to 4 bots on a quest kind) | 0.68 | FAIL: 72 of 100 past first_fight (under 80%) | 15.11 | 10.49 ms | - | 22.02 ms | 174 MB | 4.2 / 5.0 | 0 |
| Greenway from `first_fight`, `--quest --fight`, 240 s (a) | 0.66 | FAIL: 52 of 100 past first_fight (under 80%) | 15.10 | 14.74 ms | - | 22.09 ms | 171 MB | 3.5 / 4.7 | 0 |
| the same (b, up to 4 bots on a quest kind) | 0.00 | FAIL: 1 legal steps were corrected; questRefused other than where, busy, bag-full: skip dead 1; 76 of 100 past first_fight (under 80%) | 15.11 | 11.02 ms | - | 21.17 ms | 177 MB | 4.8 / 5.7 | 1 |
| `--warden` 12 parties (4 × the Plan 4 spec), 420 s | 0.67 | PASS | 15.06 | 11.1 ms | 2.69 ms | 18.97 ms | 152 MB | 1.4 / 1.8 | 0 |
| `--warden` 4 × `paladin+black_mage:sloppy@t2`, `SG2_TEST_KIT=t2` | 0.26 | FAIL: instance step p95 reached 3.01 ms (over 3) | 15.07 | 9.81 ms | 3.01 ms | 14.7 ms | 144 MB | 1.5 / 1.9 | 0 |
| `--warden` 4 × `paladin+black_mage:sloppy@starter` | 0.02 | FAIL: instance step p95 reached 3.13 ms (over 3) | 15.05 | 8.38 ms | 3.13 ms | 14.4 ms | 143 MB | 1.0 / 1.8 | 0 |
| `--warden` 3 × `dark_knight:careful@t3` + 3 × `:sloppy@t3`, `SG2_TEST_KIT=t3` | 0.09 | FAIL: instance step p95 reached 4.01 ms (over 3) | 15.04 | 9.41 ms | 4.01 ms | 17.02 ms | 145 MB | 1.3 / 1.6 | 0 |

**Bandwidth.** Clustered walkers: 10.7 KiB/s plain, 10.8 with random looks, 11.0 with looks and parties of four (the
party status lines), 11.0 with looks and every adventurer in T3 gear; 10.8 with `--quest` (walkers carrying quest
state: one `quests` view per join). All at or under the 11.0 limit; the looks cost +0.1 and the party status lines
or T3 gear codes about +0.2 each. Spread-out walkers: 8.8–9.0 plain, 9.0 with looks, 9.0–9.1 with `--quest` (the two
plain runs differ by 0.2 from run to run). The cheapest cut, if a later feature needs room: the party status lines
(+0.2) can go out at half the rate for members off screen.

**Gear** (`--gear`, with `--dungeon 13`): 100 purchases, 100 costumes bought and worn, 253–254 swaps, 72 drops,
3710–3807 loot gold; every ledger matched (0 mismatches, 0 uids seen again, 0 resyncs); inventory writes p95
34.6–35 a second (max 76.6–79.2). Run (a) failed only on one instance-step sample (3.08 ms; median 0.60, p90 1.14);
(b) on an equip and an unequip refused 'dead' (sent in the moment of a death: the bots now swap at full health only);
(c) on 29 corrections of 4 bots on their walk from the Smithy to the Tailor (the server held their last good pose at
the Smithy for about 9 m of walking, then corrected; 3 `buyCostume` refused 'where' follow from that) — explained and
fixed since (the bots' own process stalled about a second and each bot then sent the whole gap as one pose: see
"2026-11-13 (the last fixes)" above). The 420 s quest runs: 100
purchases, 548 swaps, 13 talents chosen (level 4 reached), ledgers all matched, inventory writes p95 33.6–38.4.

**The opening quest** (`--quest --fight --looks --gear`, 420 s from the grove): 100 of 100 past `board` (the Beacon
scene for all 100), 65 then 72 past `first_fight` (gate 80%), 56 finished the main quest both times (gate 50%), 0
`questRefused`; side quests 7–9 Gran's Waymarks, 1 Bristle Bounty. From `first_fight` in the Greenway (240 s): 52, then
76 past it (gate 80%). The bots still at `first_fight` lack (run b) kills 28, finisher 27, combo 27, dodge 26 of 28:
100 bots crowd 21 enemies, and the Thornlings they need respawn every 25 s. Raising how many bots may fight one
Thornling (1 → 4: everyone with a tenth of the damage is credited) took the Greenway run from 52 to 76. A new
Warrior's kit has no mark of its own, so it cannot combo alone; the step's hint now names Skullringer, and the bots
take it (80 swaps a run).

**The Warden in gear.** The test kit is a tier's full set at level 1 (no level switch): the bands assume level 10.

| party | kit (worn) | outcomes | band |
|---|---|---|---|
| paladin + black_mage, sloppy | T2 (t2) | 3 kills, 1 wipe | G2 T2 sloppy duos ≈ 75%: agrees |
| paladin + black_mage, sloppy | starter | 4 wipes (phase 2–3) | G2 starter ≈ 25%: agrees |
| dark_knight, careful | T3 (t3) | 3 kills of 3 | G5 careful T3 solo ≈ 35%: more (level 1, 3 runs) |
| dark_knight, sloppy | T3 (t3) | 3 wipes | G5 sloppy T3 solo ≈ 8%: agrees |
| paladin + black_mage, careful | starter | 4 wipes (enrage) | W1 (≥ 95%): disagrees, as in Plan 4 |
| warrior + ranger + white_mage, sloppy | starter | 4 kills | W2: agrees |
| paladin, careful | starter | 4 wipes | W4: agrees |

The instance step p95 gate (3 ms) failed in three of the four Warden runs on single samples (3.01–4.01 ms) while the
median (0.37–0.53 ms) and p90 (0.5–0.67 ms) match Plan 4's quiet runs; the 12-party run passed (2.69 ms).

### 2026-11-13: parties and the Lampfall (Plan 4 Task 10) — PROVISIONAL (superseded by the quiet-machine runs above)

Development sandbox (4 CPU cores, Node 22), server and bots on the same machine, ports 2574–2575, `SG2_STORE=memory`,
`SG2_AUTH_RATE_PER_MIN=1000`, server `node --import tsx server/src/index.ts` from the main checkout at this task's
commits, a fresh server per run, stopped by PID. Other workers' headless browsers and test suites ran on the machine
for most of the day; the load average (`uptime`, 1 min) is given per run. **The timing numbers (Hz, step p95,
event-loop p99) are provisional: to be re-measured on a quiet machine.** The runs marked "quiet" ran with nothing else
on the machine (load 0.0–0.8). Greenway: 21 enemies; the Lampfall per instance: 3 packs (10 enemies), the Wickhound,
the Warden (2 Lens Shards in its phase 2). Every run: 0 corrections, 0 disconnections, 0 dodge rollbacks.

| run | load | result | bot Hz | zone step p95 max | instance step p95 max (median / p90 of 1 s samples) | event-loop p99 max | peak RSS | KiB/s per bot (mean / p95) |
|---|---|---|---|---|---|---|---|---|
| `--dungeon 13`, 100 bots, 240 s (a) | 2.8 → 12 | FAIL (timing; a stuck bot by the mouth, fixed) | 14.65 | 16.3 ms | 22.5 ms | 61.6 ms | 196 MB | 3.8 / 4.8 |
| `--dungeon 13`, 100 bots, 240 s (b) | ~1 | FAIL (instance p95; revives 0, no longer gated) | 15.1 | 9.19 ms | 4.45 ms | 17.4 ms | — | 4.0 / 4.7 |
| `--dungeon 13`, 100 bots, 240 s (c), quiet | 0.2 | PASS | 15.13 | 9.09 ms | 2.27 ms (0.49 / 0.98) | 19.9 ms | 167 MB | 4.0 / 5.1 |
| `--dungeon 13`, 100 bots, 240 s (d), quiet | 0.3 | PASS | 15.15 | 9.73 ms | 2.07 ms (0.48 / 0.96) | 18.4 ms | 169 MB | 4.0 / 5.1 |
| `--warden` (3 parties), 420 s | ~8 | FAIL (instance p95 only) | — | 2.1 ms | 5.94 ms | 43.4 ms | — | — |
| `--warden` (3 parties), 420 s, quiet | 0.2 | PASS | 15.07 | 1.86 ms | 2.34 ms (0.42 / 0.59) | 12.2 ms | 143 MB | — |
| `--warden` (12 parties, 24 bots), 420 s, CPU profile on | 11.5 | FAIL (instance p95, loop p99) | 14.84 | 10.6 ms | 4.04 ms | 113.9 ms | 164 MB | 1.2 / 1.6 |
| `--warden` (12 parties, 24 bots), 420 s, quiet | 0.0 | PASS | 15.06 | 3.2 ms | 2.01 ms (0.35 / 0.45) | 13.3 ms | 152 MB | — |
| grove, 100 walkers, 30 s, quiet | 0.3 | PASS | 15.13 | 7.97 ms | — | 18.1 ms | 165 MB | 8.9 / 10.4 |
| grove, `--cluster 15`, 30 s, quiet | 0.2 | PASS | 15.12 | 6.42 ms | — | 17.9 ms | 165 MB | **10.8** / 10.9 |
| `--cycle --jobs mixed`, 120 s, quiet | 0.8 | PASS | 15.25 | 7.71 ms | — | 15.8 ms | 176 MB | 5.7 / 6.4 |

The dungeon runs (c, d): 13 parties formed (27 invites, 27 accepted, none refused); 12 instances; one party told
the Lampfall is full (its 2–4 members stayed in the Greenway); first packs 16–34 s after entry; 33–35 of 36 packs
killed in 240 s (no party reaches the Wickhound in a 240 s run: the walk from the grove takes about 70 s); party chat
144 lines, every delivery received (300–312); party bots' reactions Blast 62–75, Conduct 19–20, Steam 11–23, Bedrock
10–21; deaths inside 2–4, releases 1–2, revives 0–1, one wipe in (d); interrupts 55–68, Breaks 55–60. The Greenway
bots: 962–1037 kills, 434–484 dodges, 41–90 knockbacks, every job with kills. A 240 s CPU profile of the 12 Warden
fights (busy machine) showed the server 96% idle and every room's step together at 1.3% of one core (about 0.07 ms
a step on average): the instance p95 spikes over 3 ms on the busy machine are scheduling (the process waiting for a
core), not work, and the quiet runs stay at 2.0–2.3 ms.

The scripted Warden runs (`paladin+black_mage:careful, warrior+ranger+white_mage:sloppy, paladin:careful`; the same
outcomes over 10 runs of each: two 3-party runs and the four copies in each of two 12-party runs), next to the
simulation's bands:

| party | outcome | seconds from the wake | phase | enrage | deaths | revives | interrupts | Breaks | band (Task 5) |
|---|---|---|---|---|---|---|---|---|---|
| paladin + black_mage, careful | 8 wipes, 1 kill, 1 out of time (420 s) | 347–412 | 3 | yes | 2 | 0 | 4–14 | 11–15 | W1 careful duos ≥ 95% win: **disagrees** |
| warrior + ranger + white_mage, sloppy | 10 kills | 206–213 | 3 | no | 0–1 | 0–1 | 2–8 | 9–10 | W2 sloppy trios ≥ 70% win: agrees |
| paladin, careful | 10 wipes | 343–349 | 2 | yes | 1 | 0 | 2–9 | 11–14 | W4 solo 0 wins: agrees |

The careful Paladin + Black Mage duo runs out of time (it reaches phase 3 and the enrage, then falls to Last Light).
The live server gives level-1 adventurers their kits (82 hp, Plan 5), which the simulation's bands were not tuned
against; this is reported, not tuned here.

Live checks (`smoke-party.mjs` and scratch scripts, `?lockq`, headless): the party smoke test PASSES (with
`--helpers`: the two pages alone, auto-attacking at about 1 fps, fell to the first pack in two runs); a Second Dawn
revive in an instance (a `--join` White Mage revived page A where it fell); the wipe screen ("The light goes out…",
up at the Keeper's Landing at full health 5 s later); walking and then rolling twice into the shut Lens Pit gate (B
stopped at its edge, 0 corrections, 0 refusals); a Bedrock drawn over the Warden's telegraph (no hole in the decal);
the Wickhound waking (boss frame); and a page following two `--join` bots from the crater mouth through every room
to the Lens Pit (18 min of wall time, 0 corrections, no page errors).

### 2026-11-12: mixed jobs, the job smoke steps (Plan 3b Task 9)

Development sandbox (4 CPU cores, Node 22), server and bots on the same machine, port 2574, `SG2_STORE=memory`,
`SG2_AUTH_RATE_PER_MIN=1000`, server `tsx server/src/index.ts` from a scratch worktree at `de7da07` plus this task's
files, a fresh server per run, stopped by PID. Default start zone (the grove) for the walkers and the mixed runs;
`SG2_START_ZONE=greenway` for the Plan 3 fight run. Greenway: 21 enemies (19 ordinary, 2 Mossbacks). Job mix: 14–15
bots of each of the seven jobs, 41–44 duos. Another worker's test suite ran on the machine during some runs.
Every run: 0 corrections, 0 disconnections, 0 dodge rollbacks, every displacement's end matched the bot's own
simulation, the server at 15–15.2 Hz in every 5 s window.

| run | result | bot Hz | KiB/s per bot (mean / p95) | step p95 | patch p95 | event-loop p99 | peak RSS |
|---|---|---|---|---|---|---|---|
| grove, 100 walkers, 30 s | PASS | 15.13 | 9.0 / 10.5 | 6.28 ms | 5.81 ms | 18.0 ms | 156 MB |
| grove, `--cluster 15`, 30 s | PASS | 15.13 | **10.8** / 11.0 | 7.18 ms | 6.24 ms | 16.7 ms | 164 MB |
| `--fight --jobs mixed`, 60 s | FAIL (1 early roll unanswered at the end: no longer a failure, see below) | 15.14 | 7.7 / 8.6 | 9.6 ms | 5.19 ms | 25.0 ms | 160 MB |
| `--cycle --jobs mixed`, 120 s (a) | FAIL (0 revives) | 15.13 | 5.6 / 6.5 | 8.57 ms | 5.57 ms | 18.6 ms | 172 MB |
| `--cycle --jobs mixed`, 120 s (b) | FAIL (no Conduct) | 15.17 | 5.9 / 6.9 | 9.62 ms | 5.42 ms | 15.9 ms | 162 MB |
| `--fight` (Plan 3 bots, Warriors and Rangers), 60 s | PASS | 15.06 | 6.0 / 7.2 | 8.38 ms | 4.03 ms | 23.4 ms | 165 MB |

| mixed run | kills (Thornling / Boar / Archer / Mossback) | kills by job (W / R / P / DK / N / WM / BM) | deaths / back / revived | dodges | knockbacks | casts (fizzled) | reactions (Blast / Conduct / Steam / Bedrock) | revives | ally heals (hp) / ally shields | presses with an ally id |
|---|---|---|---|---|---|---|---|---|---|---|
| 60 s | 100 (67/15/18/0) | 8/25/9/7/10/19/22 | 1/0/1 | 26 | 2 | 32 (17) | 4/2/1/0 | 1 | 3 (57) / 4 | 14 |
| 120 s (a) | 329 (162/73/78/16) | 29/74/49/33/37/48/59 | 3/3/0 | 49 | 25 | 114 (52) | 14/3/2/3 | 0 | 22 (559) / 16 | 48 |
| 120 s (b) | 353 (175/82/80/16) | 44/79/44/29/35/51/71 | 5/3/2 | 46 | 19 | 139 (62) | 15/0/2/5 | 2 | 15 (418) / 19 | 47 |

Every mixed run: 100 of 100 job switches accepted at the Guild Board, 100 of 100 Greenway switches refused
`not-here`, every job with kills, xp by job matching its kills. Clustered bandwidth: 10.8 KiB/s (Plan 3b Task 6:
10.7; the cap is 11.5).

Over the tuning of the mixed bots (about 30 runs of 120 s on the same machine and settings, with the bots' own code
changing between them) the numbers ranged: dodges 24–58, knockbacks 12–27, casts 71–139 (45–65% fizzle: the target
died first), Blast 1–15, Conduct 0–6, Steam 0–5, Bedrock 1–6 a run; deaths 0–6, revives 0–3. In the final
configuration (the last 7 runs) a 120 s cycle run passed 1 time in 3 to 1 in 2: Conduct (missing in about 1 run in
4) and a revive (missing in about 1 in 4) are each a handful of events per run, decided by which bots meet which
enemies, and the zone step p95 went over 15 ms (15.5–32.6 ms, one 5 s window) in 4 of about 30 runs. See the task
report's concerns. A predicted second roll sent in the last moments of a run, unanswered when the bots stop, failed
the 60 s run above; it is now counted apart (as one a knock replaced is).

Browser smoke test (`node server/scripts/smoke.mjs http://localhost:2574 --kill "kill <pid>" --shots <dir>`, a
server started with `SG2_START_ZONE=greenway` and `SG2_CLIENT_DIR=client/dist-online`): PASS. Its new steps took:
the job board in the Greenway, its note and the refused Ninja 9–11 s; the helpers' jobs and walk to A 41 s; the
first Thornling 9–10 s (with the helpers); a reaction drawn on A's screen 3–4 s (Conduct, in each of 3 runs); A
Defeated, revived by Second Dawn (drawn), Defeated again and back in the grove 47–49 s; the Guild Board in the
grove, White Mage, badge and Tidelash's tooltip 16 s; the walk to the east gate and into the Greenway 39 s; the new
sign-in a White Mage.

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

After ruling P3-j (dodges ≥ 20) and strictly solo hunters, every run passed:

| run | result | bot Hz | KiB/s per bot (mean / p95) | step p95 | peak RSS | kills | deaths / back | dodges | knockbacks | early rolls (sent / rolled) |
|---|---|---|---|---|---|---|---|---|---|---|
| `--cycle` 120 s, 3 runs | PASS ×3 | 15.15 | 4.4–4.6 / 5.1–5.3 | 5.8–7.8 ms | 149–160 MB | 480–518 | 3/3, 3/3, 1/1 | 48–69 | 13–19 | 4–10 / all |
| `--fight` 60 s, 2 runs | PASS ×2 | 15.18–15.19 | 5.4–5.5 / 6.5–6.6 | 8.8–9.5 ms | 150–151 MB | 162–177 | 1 / 0 (on its way) | 31–48 | 11–13 | 3–6 / all |

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
