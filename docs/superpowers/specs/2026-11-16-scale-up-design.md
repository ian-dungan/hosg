# Shady Grove 2: scaling up to level 50 in a connected world (design)

Date: 2026-11-16. Status: design for the owner. Every decision below is made so building can start; the
owner can overturn any of them (§12 lists the ones most worth a look).

Owner direction (binding): "Okay scale this all up. Think World of Warcraft or Final Fantasy XI or
EverQuest. Level 50 at least; can raise level cap later to expand." "I expected a larger interconnected
world." "Characters and their gear and costumes they win will be very important." "I really want gear to
matter." "Some fights to be difficult." "We need several hundreds more item possibilities with compelling
stats that lend to gear strategies. So some rare items have abilities that help in some way." Standing
rules kept: duo is the common way to play; parties up to 4; jobs levelled separately on one adventurer and
switched only in towns and sanctuaries; seven starting jobs plus Monk, Bard, Beastmaster and Sky Lancer
later, each with a strong reason to unlock; no borrowed abilities; whole-number stats; costumes only for
gold or GM events; Shady Grove first, Normandy the capital, the floating islands late; Ellie and Felix the
legendary heroes; zones built by a generator from recipes (only story landmarks authored); homes and
neighbourhoods out of scope.

Builds on: the first-slice spec, Plans 1–6 and their Outcomes, `2026-11-16-look-v2.md`,
`2026-11-16-wardrobe.md`, `docs/load-test.md`, and the code in `shared/src/world`, `shared/src/combat`,
`shared/src/{items,inventory,loot,quests,party,instance}.ts` and `server/src/rooms/ZoneRoom.ts`.

---

## 1. Vision and honest scope

### What "WoW / FFXI / EverQuest scale" can and cannot mean here

Those games were made by hundreds of people over many years: thousands of hand-placed quests, hand-sculpted
zones, voice and cinematics. Shady Grove 2 is built by AI workers from code and data, with all art built in
code. So it cannot match their **content volume**. It can match the **feel** that made them matter, and it
gets its scale from systems: recipes, templates, families and tables.

| feel that matters in those games | how this game gets it |
|---|---|
| a big connected world you travel through | 16 outdoor zones and 3 towns joined by roads and gates, with loops, about 25 minutes on foot from Shady Grove to Windlass; no teleport until you have relit a Waybeacon there |
| zones with identity and level ranges | each zone recipe has a biome, a level range, enemy families, a named landmark and a palette; level rises with distance from the road and from the zone's gate |
| danger off the road | camps near roads sit at the zone's lowest level; deep camps reach its top +2 with elites; enemies 6+ levels above you are marked with a skull and hit hard (§2.4) |
| named rare enemies | 3 named rares per zone (48 by 50), each with a signature item, a spawn window and a Wanted poster |
| dungeons | 6 instanced dungeons (one every 8 levels) with 2–3 bosses each, plus a hard mode |
| a long gear chase | about 860 named items by level 50, every one with its own look; rare and better items carry an item ability; 28 sets; personal loot with bad-luck protection |
| jobs to level | 7 jobs to 50, 4 more unlockable; about 50 hours to 50 for the first job |
| grouping that matters | duo-first tuning, party level sync, support that changes outcomes, bosses with mechanics a partner answers best |
| towns as hubs | Shady Grove, Normandy (capital) and Windlass; plus a generated outpost in every zone |

**What is generated and what is authored**

| generated (from recipes and tables) | authored (hand-written data or code) |
|---|---|
| zone terrain, roads, rivers, coasts, terraces, vegetation, rocks, camps, outposts, points of interest, rare-spawn sites | 3 town plans (Shady Grove exists; Normandy and Windlass use a town template plus authored landmarks) |
| enemy variants (levels, names, palettes, sizes) from family templates | 18 family templates (archetypes and attacks); 6 dungeon recipes; boss scripts |
| about 860 items from base types × tier × make, and their looks from a look grammar | about 60 legendary and signature item looks (code-built models); item-ability templates |
| side quests from generators: bounties, hunts, deliveries, surveys, lamp defences | the main story: 10 chapters, about 60 authored quests and their lines |
| quest text from phrase tables with zone and family names | story NPCs and story landmarks (statues, Waybeacons, the Beacon) |

**Explicitly not attempted:** a seamless world (zones are rooms with a short travel load), raids of more
than 4, player-versus-player, an auction house, gathering and professions, durability and repairs, random
stat rolls on drops, critical hits, flying mounts, voice and cinematics, hand-sculpted terrain, hundreds of
hand-written side quests, more than 100 players online, homes and neighbourhoods (§11 says where they sit).

### The player at level 1, 10, 25 and 50

| level | where | what they do | what they feel |
|---|---|---|---|
| 1 | Shady Grove, the Greenway | The Solstice Crossing; first camps; first job | a cosy town, a sky with a floating island in it, a road out |
| 10 | the Greenway's crater, Millbrook Downs | the Lampfall with a partner; first Heroic gear; a second job started; the road north opens | "the world is bigger than I thought": a map with gates leading off it |
| 25 | the Saltreach Coast, the Gloaming Wood | Normandy is home; bounties and hunts; the Wrecker's Grotto; Monk or Bard unlocked; mount; Waybeacons relit across the south | a capital full of adventurers, a build taking shape around a set and two rare items |
| 50 | the floating islands | the Beacon; hard modes; Ascendant dungeons; legendary weapons; collecting looks; levelling a third job | the long game: gear strategy, harder fights, a wardrobe that tells your story |

---

## 2. The level framework (built for 99, capped at 50)

### 2.1 Rules

- **One rule, two regimes.** Levels 1–10 keep every number from Plan 5 exactly (parity rule P1: level 10
  in the starter kit is 10 / 10 / 100). From level 10 up, everything grows by simple whole-number formulas
  that stay readable at 99.
- **`JOB_LEVEL_CAP` becomes `LEVEL_CAP`**, a server setting: 10 → 20 → 30 → 40 → 50 in phases (§11).
  Every table is defined to 99 from the first phase, so raising the cap is a data change.
- **The reference adventurer** `REF(L)`: base stats at level L plus a full kit of **Fine** gear of item
  level L. Every enemy, boss and band is authored against `REF(10)` = 10 / 10 / 100 (what exists today)
  and scaled by `REF(L) / REF(10)`. One table drives all scaling.

### 2.2 Base stats and the reference adventurer

| | levels 1–10 | from level 10 | 10 | 20 | 30 | 40 | 50 | 99 |
|---|---|---|---|---|---|---|---|---|
| base Power | Plan 5 (6 → 9) | L − 1 | 9 | 19 | 29 | 39 | 49 | 98 |
| base Defence | Plan 5 (5 → 8) | L − 2 | 8 | 18 | 28 | 38 | 48 | 97 |
| base Health | Plan 5 (72 → 90) | 10L − 10 | 90 | 190 | 290 | 390 | 490 | 980 |
| `REF` Power / Defence / Health | — | base + Fine kit | 10 / 10 / 100 | 29 / 31 / 268 | 45 / 48 / 410 | 60 / 66 / 551 | 76 / 83 / 692 | 152 / 168 / 1384 |

Between 10 and 20 the reference kit ramps linearly from the starter kit (1 / 2 / 10) to Fine, so there is
no jump at level 11.

- **Defence constant scales with level**: `DEFENCE_K(L) = 4 × REF(L).defence` of the attacker's level
  (40 at 10 and below, unchanged; 124 at 20; 332 at 50). An on-level adventurer in Fine gear always takes
  ×0.80 of an on-level enemy's raw damage, as a starter does today. Better armour does better; mitigation
  never collapses at 99.
- **Enemy stats** at level L: hp × `REF(L).power / 10`; raw damage × `REF(L).health / 100`; defence ×
  `REF(L).defence / 10`. A Thornling template (210 hp, auto 6) is 1596 hp with a 42 auto at level 50.
  Enemies at level 10 or below use their template unchanged (every current enemy and band is untouched).
- **Rating stats** (§8.2) convert at `R(L) = max(1, round(L / 10))` rating points per 1%: 1 up to level 14
  (so today's Focus, Flow and Guard keep 1 point = 1%), 3 at 30, 5 at 50, 10 at 99. The wearer's level is
  used (the synced level when synced).

### 2.3 XP curve and time

- Levels 1–10: `XP_TO_NEXT` unchanged (3180 xp).
- From level 10: `XP_TO_NEXT(L) = 11 × L²`, rounded to the nearest 10 (1100 at 10, 4400 at 20, 26 410 at 49).
- Kill xp: ordinary `KILL_XP(L) = 10` up to level 10, then `2L − 10` (30 at 20, 90 at 50). Elite ×4,
  boss ×12, mega boss ×30, named rare ×8. (The current table already follows this: Mossback 40, Wickhound
  120, Warden 300.)
- Party xp (new): each credited member gets kill xp × 1.0 solo, 0.75 in a duo, 0.6 in a trio, 0.5 in four.
  A duo kills about 1.8× as fast, so it levels about 1.35× as fast as solo; grouping pays without making
  solo pointless.
- Quests give about 40% of all xp (main story 10%, generated quests 30%).

| | cumulative xp | solo hours (cumulative) | duo hours | hours per level at the end of the band |
|---|---|---|---|---|
| 1 → 10 | 3 180 | 3 | 2.5 | 0.65 |
| → 20 | 27 215 | 10 | 8 | 0.9 |
| → 30 | 94 150 | 20 | 15 | 1.2 |
| → 40 | 225 985 | 34 | 25 | 1.5 |
| → 50 | 444 720 | **50** | **37** | 1.8 |
| → 99 (later) | 3 504 084 | 177 | 130 | 3.1 |

**Target: 45–55 hours to 50 for the first job** (solo pace; about 37 in a steady duo), measured by the
levelling bots (§10.4), not guessed. **Later jobs**: catch-up ×2.0 while a job is 10 or more levels below the
adventurer's highest, ×1.5 while below at all (today: ×1.5): a second job reaches 50 in about 25 hours.

### 2.4 Level difference (d = enemy level − your level)

No random misses: hits stay positional and deterministic. Level difference changes damage, stagger and xp.
Rows apply to your damage dealt to it, its damage to you, and kill xp.

| d | name colour | you deal | you take | stagger you deal | xp | other |
|---|---|---|---|---|---|---|
| ≤ −6 | grey | ×1 | ×1 | ×1 | 0 | ordinary enemies no longer aggro; no item drops, gold only |
| −5 to −3 | green | ×1 | ×1 | ×1 | ×(1 − 0.2 × (|d| − 2)) | — |
| −2 to +2 | white | ×1 | ×1 | ×1 | ×1 | — |
| +3 | yellow | ×0.9 | ×1.1 | ×0.9 | ×1.2 | — |
| +4 | orange | ×0.8 | ×1.2 | ×0.8 | ×1.3 | — |
| +5 | red | ×0.7 | ×1.35 | ×0.7 | ×1.4 | — |
| ≥ +6 | skull | ×0.6 | ×1.5 | ×0.5 | ×1.5 | your stuns and interrupts fail on its elites and bosses |

Greenway camps get levels 2–8 by the same rule; the L1 band is pinned to a level-2 Thornling, so no current
band moves.

### 2.5 Item levels, tiers and rarity

- **Item level (ilvl)** is the level the item is tuned for; it can be worn at ilvl − 2 or higher (so fresh
  drops fit at once). Legacy items keep their ilvl (1, 4, 7, 10) and their exact stats.
- **Tiers**: one every 5 levels (ilvl 15, 20, …, 50 are tiers 3–10; today's T1–T3 are the legacy tiers 1–2).
  Dungeon gear uses the dungeon's level (18, 26, 34, 42, 50).
- **Rarity** sets the item's share of the kit budget (§8.3) and what else it carries:

| rarity | budget share r | secondary lines | item ability | where from |
|---|---|---|---|---|
| Common | 0.40 | 0 | — | town and outpost vendors |
| Fine | 0.55 (= `REF`) | 1 | — | ordinary drops, quest rewards, bounty vendors |
| Rare | 0.75 | 1 | 1 passive (or active on weapon, off-hand, back) | elites, named rares, dungeon packs, hunt rewards, Pattern Book |
| Heroic | 1.00 | 2 | set bonus (set pieces) or 1 ability (weapons, non-set pieces) | dungeon bosses |
| Legendary | 1.00 | 2 | 1 unique ability that changes play | dungeon hard modes, final story chapter, legendary quest chains |
| Ascended (a version, not a rarity) | +5 ilvl | same | same | hard mode drops of the dungeon's Heroic items: same name and look, a glow trim and a star |

Today's T3 Lampfall gear is Heroic at ilvl 10 (its numbers already match r = 1.0); T1 and T2 are Fine.

### 2.6 Abilities across 50 levels

- **The bar stays five buttons** (3 from the job's weapon, 2 picks from the job's pool), plus dodge, jump
  and one small **gear button** for an attuned item active (§8.5). Phones first: no more buttons, ever.
- **Pool grows from 4 to 10 picks.** Existing picks unlock at 1, 1, 3 and 6 (each job's current solo
  defaults at 1); new picks at **12, 18, 24, 30, 38 and 46**: 6 new per job, 42 for the seven jobs. Each
  new pick is mostly support or utility (at least 3 of 6 reach a partner).
- **Ranks**: every ability gains rank II at 20, III at 35, IV at 50 (+10% magnitude per rank, built into
  `REF`). Bar abilities also gain one qualitative upgrade at rank III (data in each ability: for example
  Sunder also Dazes, Wellspring cleanses two allies). Ranks V–VII wait for 65, 80, 95.
- **Unlockable jobs** arrive with 7 abilities (3 bar, 4 pool) and get the same 6 new picks: 13 each, 52 in
  all. About **143 abilities** by 50.

### 2.7 Talents across 50 levels

- Rows of three, pick one per row: today at 4, 7, 10; new at **15, 20, 26, 32, 40** and a **capstone at 50**.
  9 rows; 6 new rows × 3 × 7 jobs = **126 new talents**. Later rows at 60, 70, 80, 90, 99.
- Talents stay sidegrades within a row (Plan 5's P2 and P3 bands, per row). The capstone row holds three
  build-defining talents per job (for example Warrior: *Unbroken*, Breaks last 1 s longer; *Tempest*, a
  finisher refunds 15 Momentum after a perfect dodge; *Bannerman*, Rallying Roar also gives +20 Momentum).
- Retraining costs gold as now (`10 × level`, the first free per new row).

### 2.8 Level sync

| rule | value |
|---|---|
| where | every dungeon syncs to its top level (the Lampfall to 10); outdoor zones never sync; party sync by choice |
| party sync | the leader sets *Partner Sync*: members above the lowest member's level + 2 are synced down to it, in every zone; off when the party ends |
| stats when synced | each stat × `REF(S) / REF(own level)`: gear keeps its relative edge; rating stats use `R(S)` |
| kit when synced | picks, ranks and talent rows above S are inactive (the bar falls back to the job's default picks); set bonuses stay; item abilities of items with ilvl > S + 5 are off |
| xp when synced | kills give the xp of an enemy at your real level ×0.5 (no farming low dungeons for full rate) |
| loot when synced | drops are the content's own items; personal loot unchanged |

### 2.9 Migration of existing characters and items (no loss)

| what | how |
|---|---|
| job xp | unchanged: levels 1–10 keep the same curve; level-10 jobs at 3180 xp start earning toward 11 when the cap rises. No curve version bump |
| talents | `talents` arrays pad from 3 to 9 with "none"; the first pick in each new row is free |
| abilities | everything learned stays learned; level-10 jobs already pass every L1–L6 unlock |
| items | the 101 legacy items keep their ids, stats and look ids 0–255; rarity labels added (T1/T2 Fine, T3 Heroic) |
| looks | collection bitset grows 32 → 512 bytes (look ids 0–4095), back-filled on read as now; gear code v3 (12-bit look ids) with v1/v2 still decoded |
| Warden's Seals | kept; also exchange at the Lampwright for Embers (§8.6) at 1 Seal = 20 Embers |
| zones | `SaveZoneId` widens; a save in a zone that no longer exists (none planned) loads at its town |
| xp rule | party xp shares apply from the phase that ships them; nothing retroactive |

---

## 3. The world

### 3.1 The continent: Ambermarch

The first game was a corner of a larger continent. Ambermarch runs from Shady Grove in the green south-west
to Windlass on the northern cliffs, with the floating islands above the north. Each region once had a
**Waybeacon** built by Felix; most are dark. Relighting them is the main story's spine and the fast-travel
network.

**Towns (authored landmarks on a town template)**

| town | level | role | landmark |
|---|---|---|---|
| Shady Grove | 1 | start, the statue, first stalls | the Plaza of the Two (exists) |
| Normandy | 15+ | the capital: every vendor, the Guild Hall (all jobs), the Tailor's Row, Fellowships, the Great Lantern, the Bard's quest, mount stables | the Great Lantern atop the Lamplighters' Hall |
| Windlass | 40+ | the cliff town at the foot of the sky-lift, last town before the islands | Felix's Winch, the half-built sky-lift |

**Outdoor zones (16)**

Sizes are walkable metres (x × z), inside the ±500 m limit. Crossing time is road length at run speed 6 m/s.

| # | zone | biome | levels | size m | gates to | identity in one line | enemy families | named landmark | dungeon |
|---|---|---|---|---|---|---|---|---|---|
| 1 | The Greenway | woodland road | 1–8 | 260 × 180 (exists; 2 gates added) | Shady Grove, Millbrook Downs, Hollowfen, (Lampfall) | the old road out of town, where the star fell | Thornkin, Bristlebacks, Hollowfolk | the crater rim | **the Lampfall** (10, exists) |
| 2 | Millbrook Downs | rolling farmland | 5–11 | 420 × 340 | Greenway, Kingsway Vale | windmills, hedgerows and a mill gone quiet | Bristlebacks, Ragged Company, Burrowers | the Seven Sails windmill | — |
| 3 | Hollowfen | reed marsh, rivers | 10–16 | 480 × 400 | Greenway, Kingsway Vale, Saltreach Coast | boardwalks through mist; lantern-lit stilt huts | Mirelings, Hollowfolk, Chitterlings | the Drowned Waybeacon | — |
| 4 | Kingsway Vale | river valley, royal road | 12–18 | 560 × 420 | Millbrook, Hollowfen, Normandy | the king's road to the capital, toll towers and bandit hills | Ragged Company, Duskhounds, Burrowers | the Toll Bridge of Seven Arches | — |
| 5 | Brackenridge | forested ridges, terraces | 16–22 | 520 × 460 | Normandy, Cairnmoor | logging terraces cut into steep hills | Duskhounds, Sporecaps, Ragged Company | the Felled Giant (a fallen tree you walk through) | — |
| 6 | Saltreach Coast | cliffs, beaches, sea stacks | 20–26 | 760 × 300 | Hollowfen, Gloaming Wood | a long wild coast of wrecks and false lights | Tideclaws, Galeplumes, Ragged Company | the Wreckers' Lamp | **the Wrecker's Grotto** (26) |
| 7 | Gloaming Wood | deep dark forest | 23–29 | 600 × 560 | Normandy, Saltreach, Glasswater | a forest where the light never quite reaches the ground | Sporecaps, Duskhounds, Barrowshades | the Pale Stag's Ring | — |
| 8 | Cairnmoor | moorland, standing stones | 27–33 | 640 × 520 | Brackenridge, Glasswater, Emberfall | heather and barrows; stones that replay old echoes | Cairnlings, Barrowshades, Burrowers | the Echo Stones | — |
| 9 | Glasswater Lakes | lakes, islets, bridges | 30–35 | 700 × 640 | Gloaming Wood, Cairnmoor, Rimewater | still mirror lakes joined by old stone bridges | Mirelings, Galeplumes, Cairnlings | the Mirror Causeway | — |
| 10 | Emberfall Highlands | volcanic uplands | 33–39 | 720 × 600 | Cairnmoor, Spirefall | ash fields, lava channels, the old foundries | Emberkin, Cairnlings, Lanternguard | the Great Kiln | **the Kiln of Ashgrave** (34) |
| 11 | Rimewater Steppe | cold plateau, frozen rivers | 36–42 | 800 × 640 | Glasswater, Spirefall | wind-swept grassland under snow, herds and hunters | Rimebacks, Duskhounds (winter), Ragged Company (raiders) | the Frozen Court's gate | **the Hoarfrost Vaults** (42) |
| 12 | Spirefall Canyons | red canyons, mesas | 40–45 | 760 × 720 | Emberfall, Rimewater, Windlass | narrow canyons and high mesas reached by switchback ramps | Chitterlings (giant), Galeplumes, Lanternguard | the Candle Spire | — |
| 13 | Galeward Heights | windy peaks | 43–47 | 640 × 640 | Windlass, (sky-lift to Driftmere) | the roof of the continent; updraft cliffs | Galeplumes, Rimebacks, Skywrought | the Kite-King's Eyrie | — |
| 14 | Driftmere | lower floating islands | 45–49 | 700 × 700 | Galeward (sky-lift), Highreef | grass islands tethered by chains and rope bridges | Skywrought, Galeplumes, Cloudkin | the Chain Anchor | — |
| 15 | Highreef | upper floating islands, coral of cloud | 48–50 | 760 × 760 | Driftmere, the Beacon | islands of white stone around the Beacon itself | Cloudkin, Skywrought, Lanternguard (Felix's own) | the Beacon's Foot | **the Beacon** (50) |
| 16 | The Lowmarch Barrows | sunken ruins, crypt fields (a side zone) | 18–24 | 440 × 440 | Kingsway Vale, Brackenridge | a ruined old kingdom's graves; good duo grinding | Barrowshades, Ragged Company, Cairnlings | the Hollow King's Seat | — (the Cistern Below is entered from Normandy) |

Loops: Greenway–Millbrook–Kingsway–Hollowfen; Normandy–Brackenridge–Cairnmoor–Glasswater–Gloaming;
Cairnmoor–Emberfall–Spirefall–Rimewater–Glasswater. Every level band has at least two zones, so a crowded
or disliked zone has an alternative.

### 3.2 Travel (decided)

| layer | when | rule |
|---|---|---|
| roads and gates | always | every zone joins its neighbours by gates on its edges; gate positions come from the world map, so both sides agree. Travel loads the next zone room (as the Greenway does today) |
| Waybeacons | from chapter 3 (level 12) | each town and each zone outpost has one; a lit beacon (story or a lamp-defence quest) is yours for good; travel between lit beacons for `2 × level` gold, out of combat, from a sanctuary |
| mount | level 20, Normandy quest *A Horse of Brass* | a code-built stridehorse (or a later-unlocked mount look): ×1.6 run speed out of combat; any damage or aggro dismounts; not in dungeons or towns' plazas |
| sky-lift | chapter 9 (level 44) | Windlass to Driftmere; a scripted ride (server-driven displacement), 40 s |
| gliding | Driftmere on (level 45) | glide between islands from marked launch rocks: falling ×0.25 with forward drift, never in combat; uses the movement code's fall rules (no new trust in client height) |

On foot, Shady Grove to Windlass is about 25 minutes; mounted 16; by Waybeacon, one hop.

### 3.3 Zones from recipes: what the generator must gain (the old Phase 7)

`ZoneRecipe` grows from one road and camps into a recipe kind with these parts. Every part keeps
`recipe.ts`'s rule: exactly-rounded arithmetic only, the same result on every engine.

| part | what it does | constraint |
|---|---|---|
| world map | `WORLD` lists every zone's rectangle on the continent, its neighbours and the gate on each shared edge (edge + offset fraction); `zoneDef` reads its exits from here | both sides of a gate are derived from one entry |
| biome | palette, ground materials, 3 tree kinds, rock kinds, props, fog colour, enemy family weights | data table; the client draws from it |
| road network | roads join the zone's gates and its outpost: a graph routed along low slope, smoothed, flattened as today | every gate reachable by road |
| rivers and coast | channels cut by noise and a recipe line; deep water is wall, shallows walkable; bridges or fords wherever a road crosses; coast is a wall on one edge | no water cuts a gate off |
| verticality | terraces with ramps (slope at most the walk rule), ledges, plateaus, mesas, island tiers; only drops within the safe-fall rule beside paths; jumpable platforms ≤ 1.2 m | heights within −52..180 m (`limits.ts`) |
| danger gradient | camps get level `min + (max − min) × t`, where t grows with distance from the road and from the zone's low gate; elites only past t = 0.6; deep pockets at max + 2 | road-side camps never above min + 2 |
| outpost template | a sanctuary circle (job change), a Waybeacon, a bounty board, a vendor stall, a mailbox, 2–3 NPCs from a name table | one per zone, on a road, ≥ 80 m from any camp |
| points of interest | 8–14 per zone from a POI table: ruins, shrines, watchtowers, wrecks, caves, lamp posts, chests of the day, survey marks | each reachable; used by quest generators |
| rare spawn sites | 3 named rares on placeholder camps (§4.3) | not within 60 m of the outpost |
| landmark slot | the zone's named story landmark placed by rule (as `story/spots.ts`) | authored model, generated position |
| dungeon mouth | where a zone has one | road-side, clear circle |
| gathering | **never** (decided): no nodes. Reasons: bot farming, phone UX clutter, art cost, and no crafting depth to feed |

**Server budget on one 16 GB machine** (shared with the owner's other games):

| item | budget |
|---|---|
| `sg2-server` memory limit | 1 GB → **3 GB** (compose) |
| zone rooms | created on demand, disposed 5 minutes after the last adventurer leaves (enemies and rares reset). Towns stay open |
| memory per open zone room | ≤ 40 MB (layout, walk grid, path graph, up to 160 enemies) |
| open rooms at once | worst case all 19 = 760 MB; typical with 100 players spread: 8–12 |
| instances | `MAX_INSTANCES` per dungeon 12, at most 30 in all, ≤ 10 MB each |
| enemies per zone | `MAX_ENEMIES_PER_ZONE` 40 → 160; enemies with no adventurer within 90 m sleep (no tick) |
| tick budget | each room's step p95 ≤ 3 ms with ≤ 5 adventurers, ≤ 15 ms with 100; the whole process ≤ 40 ms per 66 ms step; past that, rooms split across 2 Node processes (Colyseus presence on Redis) — planned, not built until measured |
| players | 100 online in all, at most 100 in one zone room (unchanged) |

---

## 4. Enemies

### 4.1 Families are data

A **family** is a template list of archetypes on the existing AI (`enemyAi.ts`: autos, telegraph lists,
ranged keep-range, elite stagger, boss scripts). A **variant** is (family, archetype, level, palette,
scale, name, attack overrides). The same AI serves every family; new behaviour comes from a small set of AI
additions used by many families:

| AI addition | used by |
|---|---|
| `social`: pulls nearby same-family enemies within 8 m | packs (Duskhounds, Ragged Company) |
| `healer`: casts an interruptible heal on the lowest-hp ally | casters in 6 families (interrupts matter) |
| `swoop`: flies 4 m up, lands on a circle telegraph; hittable by everyone only while landed, by ranged jobs and the Sky Lancer at any time | Galeplumes, Cloudkin |
| `burrow`: sinks and resurfaces under a target with a ring telegraph | Burrowers, Chitterlings |
| `disarm`: an interruptible grab that disables the target's weapon abilities for 4 s (autos and picks still work; Monk immune) | Ragged Company elites, Hoarfrost bosses |
| `shield-ally`: shields an ally; Break removes it | Lanternguard, Skywrought |

Each family has 4 archetype variants (brute, skirmisher, ranged or caster, swarm or support), each appearing
at 3–5 levels across its range, 1 elite, and 1–3 named rares. Elemental weakness and resistance per
family (as today).

### 4.2 Families to 50 (18)

| family | look | levels | archetypes (variant examples) | elite | weak / resist | zones |
|---|---|---|---|---|---|---|
| Thornkin (exists) | living briar | 1–12 | Thornling, Thornling Brute, Briarcaster (healer), Thornseed swarm | Mossback (exists) | fire / water | Greenway, Millbrook |
| Bristlebacks (exists) | boars, badgers | 1–14 | Bramble Boar, Tusker, Bristle Sow (charges in pairs), Hog-Runt swarm | Old Bristle | water / earth | Greenway, Millbrook |
| Hollowfolk (exists) | bark people | 3–16 | Hollow Archer, Hollow Warder, Hollow Witch (caster), Twig-Sprites | Hollow Matron | lightning / — | Greenway, Hollowfen |
| Brassworks (exists) | the Warden's constructs | 8–10 | Lens Shard, Cog Crawler, Lampwick Sentinel | — | lightning / fire | the Lampfall |
| Ragged Company | bandits and raiders | 5–42 | Cutpurse, Bruiser, Crossbowman, Hedge-Priest (healer) | Captain (disarm) | — / — | Millbrook, Kingsway, Brackenridge, Saltreach, Rimewater |
| Burrowers | moles, sand-worms | 6–32 | Delver, Tunneler (burrow), Spitter, Pup swarm | Great Delver | water / earth | Millbrook, Kingsway, Cairnmoor |
| Mirelings | frog-folk and eels | 10–35 | Bogleaper, Reed-Spearer, Mire Shaman (healer), Eelings | Bogfather | lightning / water | Hollowfen, Glasswater |
| Chitterlings | beetles, mantises | 11–45 | Shellback, Mantis, Spitbug, Swarmlings (burrow at 40+) | Queen Carapace | fire / earth | Hollowfen, Spirefall |
| Duskhounds | wolves (winter coat at 36+) | 12–42 | Prowler, Packleader (social), Howler (buffs pack), Pups | Greymane | fire / — | Kingsway, Brackenridge, Gloaming, Rimewater |
| Sporecaps | mushroom folk | 16–29 | Puffcap, Stalker, Spore-Mother (fields), Sporelings | Elder Cap | fire / water | Brackenridge, Gloaming |
| Tideclaws | crabs, sea-things | 20–26 | Shorecrab, Reefcrusher, Saltspitter, Shellings | Old Tidewife | lightning / water | Saltreach |
| Galeplumes | harpies, giant birds | 20–48 | Gull-Diver (swoop), Talon, Storm-Caller (caster), Fledglings | Kite-King (rare) | earth / lightning | Saltreach, Glasswater, Spirefall, Galeward, Driftmere |
| Barrowshades | ghosts of old soldiers | 18–33 | Shade, Barrow-Guard, Wailer (interruptible fear: run 2 s), Wisps | Barrow-Reeve | light (Lantern Flare, Sun Mote ×1.25) / earth | Lowmarch, Gloaming, Cairnmoor |
| Cairnlings | living stone | 27–40 | Pebbler, Menhir (shield-ally), Rockslinger, Gravel swarm | Cairn-Lord | water / earth | Cairnmoor, Glasswater, Emberfall |
| Emberkin | salamanders, magma | 33–39 | Cinderling, Slagback, Ash-Caster, Sparks | Old Clinker (rare) | water / fire | Emberfall |
| Rimebacks | yetis, frost elk | 36–47 | Rimeback, Frost Elk (charge), Snow-Seer (healer), Kits | Greyhorn | fire / water | Rimewater, Galeward |
| Lanternguard | rogue lamp automatons | 33–50 | Wickwalker, Lampsentry (shield-ally), Arc-Lantern, Glowmites | Lantern Colossus | water / lightning | Emberfall, Spirefall, Highreef |
| Skywrought and Cloudkin | island constructs and cloud spirits | 43–50 | Skywright, Chain-Warden, Cloudkin (swoop), Mistlings | the Chain-Warden Prime | earth / lightning | Galeward, Driftmere, Highreef |

**About 18 families** (4 existing) give about 72 archetypes, about 250 placed variants, 18 elites and 48
named rares by 50. More families arrive only with new zones (to 99: about 8 more).

### 4.3 Named rares

- Each zone has 3. A rare sits on a placeholder spawn of its family: when the placeholder respawns, 1 in 6
  becomes the rare; at least 20 minutes and at most 2 hours between appearances (the 2-hour guarantee is
  bad-luck protection).
- Each has a unique model change (scale ×1.3, a prop, a palette), one extra attack, 6× hp, and a
  **signature item** (a Rare or Legendary, own look) that drops for every credited member once a day
  (daily-key rule, as the Wickhound's).
- A **Wanted poster** at the outpost gives a riddle-clue to its site; killing it completes a hunt quest.

### 4.4 Boss design rules

1. Bosses punish mistakes, not low numbers: 2–3 attacks per phase that must be dodged, interrupted, Broken
   or answered by position.
2. Every boss has one mechanic that a support answers best (unavoidable damage → shields and heals;
   afflictions → cleanse; a disarmed or stunned partner → a revive, a taunt swap or a shield), none that
   requires a particular job.
3. Wind-ups at least 1.0 s (phones and 150 ms of latency); unavoidable attacks are rare and always
   readable from a cast bar.
4. Health scale tables never below 1 (spec §8): solo is possible with Heroic gear and near-perfect play.
5. Every mega boss has an enrage; every boss has a reset rule and no-kiting surge (P4-l).
6. Each new boss adds at most one new AI behaviour, and only if two families can reuse it.
7. Bands per boss (simulation, 20 seeds, 3 SD headroom as Plan 5): careful duo in on-level Fine wins
   ≥ 60%; sloppy duo in Fine ≤ 40%; sloppy duo in Heroic ≥ 70%; careful solo in Heroic 10–35%; careless
   duo in Heroic ≤ 60%.

---

## 5. Dungeons and group content

All dungeons reuse the instance system as built (one instance per party, checkpoints, sealed arenas, wipes,
no lockout, daily boss rewards) and the dungeon generator (`dungeon.ts`: rooms, corridors, stairs, gates),
which gains room shapes (rectangles, rings, tiers), branches (an optional side room with a mini-boss),
and themed props per dungeon.

| dungeon | level (sync) | zone | idea | bosses (last is mega) | the final boss's twist |
|---|---|---|---|---|---|
| the Lampfall | 10 | Greenway | the crater where the Warden fell | the Wickhound; **the Fallen Warden** | phases, lens wards, the unavoidable Toll (exists) |
| the Cistern Below | 18 | Normandy's Low Ward | flooded cisterns under the capital where lamp-oil is stolen | Lamplighter Vessick (turned thief); **the Cistern King** (a rat-king swarm-crowned brute) | the water rises in phases (fields), the King splits into three swarms that must be cleaved together |
| the Wrecker's Grotto | 26 | Saltreach | sea caves of the false-light wreckers | the Tidewife; the Bosun; **Captain Bellweather** | a tide clock floods the low floor every 60 s; cannon lines; crew adds who disarm |
| the Kiln of Ashgrave | 34 | Emberfall | the forge where the Beacon's lens was cast | the Slag Twins (must die within 10 s of each other); **Ashgrave the Unkindled** | Heat stacks (affliction) shed only in steam clouds made by Water hits or Steam reactions |
| the Hoarfrost Vaults | 42 | Rimewater | a winter court that bargained with the Hush | the Glass Seneschal; the Frost Jester; **the Hoarfrost Regent** | encases one adventurer in ice: partners must Break the ice (stagger bar) before it shatters for unavoidable damage |
| the Beacon | 50 | Highreef | Felix's lighthouse, its lower lantern | the Lantern Choir (four constructs that sing in turn); the Keeper's Echo (a shade of the Warden); **the Lightless Lens** | light and shadow halves of the arena swap; the Hush dims the party's vision ring; Ellie's and Felix's echoes help at 20% |

**Difficulty targets** (normal mode): a skilled duo of on-level Fine adventurers clears in 35–50 minutes
with 0–2 wipes; bosses use per-party-size health tables like the Warden's (never below 1), tuned so 3–4
average players usually win. **Hard mode** (unlocked by a clear): boss hp ×1.8, damage ×1.4, one extra mechanic
per boss, Ascended drops (+5 ilvl) and the dungeon's Legendary weapons. **The Lampfall gets its hard mode
first** (*the Lampfall Kindled*, Phase S1), which also answers "the Warden is trivial in T3".

**The endgame loop at 50**

| activity | reward | cadence |
|---|---|---|
| the Beacon, normal and hard | ilvl 50 Heroic, Ascended 55, Legendary | daily boss reward, unlimited runs |
| **Ascendant** dungeons: two earlier dungeons each week synced to 50, enemies scaled to `REF(50)`, one affix (for example *Kindled*: fields linger; *Restless*: adds respawn) | an ilvl 50 Ascended version of that dungeon's Heroic items (same looks, glow trim) | weekly rotation |
| world rares at 50 (the Stormwhale, the Chain-Warden Prime) | signature Legendaries | 2-hour windows |
| legendary weapon chains (one per job, 6 steps across old zones) | a job's own Legendary | once |
| leaderboards per party size (exists) and solo titles per boss | titles | always |
| the appearance collection and costumes | looks | always |
| more jobs | — | always |

---

## 6. Jobs

### 6.1 The seven starting jobs to 50

| job | new picks (12 / 18 / 24 / 30 / 38 / 46) — names and one line each | capstone theme |
|---|---|---|
| Warrior | War Banner (party +10% stagger 10 s) / Shoulder Charge (gap close, interrupt) / Second Wind (self-heal over time) / Shatterpoint (Break → party damage) / Iron Shout (party knockback immunity 6 s) / Last Rally (revive a partner at 15% once a fight) | Breaks and Momentum |
| Ranger | Tracker's Mark (party sees telegraphs 0.3 s early on target) / Smoke Arrow (blind 3 s) / Tether Shot (root a swooper to the ground) / Healing Dart (ranged heal + cleanse) / Volley Line (line damage) / Overwatch (interrupt the next wind-up of the target automatically) | range and control |
| Paladin | Guardian's Step (dash to ally, shelter them) / Sanctify (ground circle: allies inside take −15%) / Oathbind (link: share 30% damage both ways) / Judgement (finisher variant: Breaks shields) / Bastion Wall (frontal block 3 s) / Martyr's Light (take a lethal blow for a partner) | protection |
| Dark Knight | Blood Tithe (convert 10% hp to 30 Momentum) / Soul Chain (pull an enemy) / Night Feast (lifesteal ×2 4 s, shared) / Abyssal Ward (shield from damage taken) / Grim Harvest (area drain) / Undying (cannot fall below 1 hp for 4 s, cd 120) | sustain and threat |
| Ninja | Caltrops (slow field) / Shadow Swap (swap places with partner, threat moves) / Smokestep (dodge leaves a decoy) / Venom Edge (DoT that Weak-Points) / Kunai Rain (area) / Vanish (drop all threat, 3 s invisibility) | from behind, evasion |
| White Mage | Purify (party cleanse) / Haven (cast circle: heal over time) / Renew (instant heal + shield) / Guardian Spirit (prevent next death 8 s) / Sanctuary Bell (party +20 Momentum) / Dawnfall (big area heal, long cast) | healing |
| Black Mage | Frostbind (Water-tagged root for BM; Earth primer) / Arc Chain (Lightning bounces 3) / Magma Pool (field) / Elemental Gift (give a partner your element for 8 s: their finishers trigger reactions) / Meteor (long cast) / Mana Spring (party +25 Momentum) | reactions and burst |

New picks are mostly support or utility by design (§6.3).

### 6.2 The four unlockable jobs

Rule (owner): each does something no starting job can, the game has moments where that matters, it is not
stronger overall, and no content requires it.

| job | unlock (quest chain) | starts at level | unique strength | where it matters | gear and title |
|---|---|---|---|---|---|
| Monk (fists) | level 15, *The Quiet Fist*, Greenway → Brackenridge | 1 | never disarmed; stagger dealt ×1.5; self-heals on Break | `disarm` enemies (Ragged captains, Hoarfrost); Break-check bosses (the Slag Twins, the Regent's ice) | wraps (cloth or light), "Unbroken" |
| Bard (lute) | level 20, *The Lamplighters' Song*, Normandy | 5 | songs: a party aura layer that stacks with every buff (other same-kind bonuses never stack, P5-a) | 3–4 player parties, hard modes and Ascendant affixes | instrument as off-hand look, "Voice of the Road" |
| Beastmaster (whip) | level 25, *First Taming*, Gloaming Wood | 10 | a tamed creature fights beside you (an enemy archetype reused as a pet); the strongest solo job; **taming is a collection game** (one beast per family archetype: 60+ to collect, each with a look) | solo players, named rare hunts | beast collars and saddles, "Friend of Beasts" |
| Sky Lancer (spear) | level 45, *Reach the Islands* (chapter 9) | 30 | hits `swoop` and flying enemies at any time; *Leap* crosses gaps up to 12 m (shortcuts, hidden island ledges, rare sites only it reaches — rewards duplicated elsewhere so nothing is required) | the islands; Galeplume and Cloudkin fights | lance looks, "Skybound" |

Start-level rule: an unlocked job starts at (unlock level − 15), at least 1. Unlocked jobs use the same
catch-up as any job. Pets and songs are bandwidth-checked (a pet is one more enemy-sized entity; songs are
buff bits).

### 6.3 Making support genuinely valuable (the known weak spot)

Measured today: duo picks are not clearly stronger than solo picks; support makes no difference in T3.

| change | detail |
|---|---|
| **Bond** (new rule) | when your support ability lands on a party member, you and they each gain +10 Momentum (once per 8 s per pair): support feeds the offence loop |
| support scales with the receiver | heals and shields as a share of the receiver's max hp (not flat numbers), so they never fall behind at 50 |
| support stats and items | Mending (§8.2), party auras on items, the Choir build (§8.4) |
| content asks for it | rule 2 of §4.4: every boss from the Cistern on has a mechanic a support answers best |
| new picks lean support | at least 3 of each job's 6 new picks reach a partner |
| a band that proves it | **S1**: at every dungeon boss from the Cistern on, skilled GEAR_PAIRS with duo picks win ≥ 15 points more than with solo picks (20 seeds, 3 SD). Failing it is a tuning failure, not a loosened band |

---

## 7. Quests and story

### 7.1 The main story: *The Waybeacons* (10 chapters, authored)

The Beacon rose at the Solstice and something fell. Felix built the Waybeacons across Ambermarch to hold
back **the Hush**, a silence that eats light and sound; Ellie led the adventurers who kept them lit. Now
they are going dark.

| # | chapter | levels | zones | paragraph |
|---|---|---|---|---|
| 1 | The Solstice Crossing | 1–4 | Shady Grove, Greenway | (exists) The statue's beam wakes the Beacon in the sky; a star falls into the woods. |
| 2 | The Keeper's Lamp | 6–10 | Greenway, the Lampfall | (exists) The fallen thing is the Beacon's keeper, the Warden, with Felix's "F." on its collar. Its lamp, steadied, points north. |
| 3 | The Dimming Road | 10–16 | Millbrook, Hollowfen | The road north is unlit and the birds have gone quiet. In Hollowfen the Drowned Waybeacon is choked with reeds and something that swallows sound. The player relights it and meets Brannoch Vey of the Lamplighters, who has been waiting for someone to come up the road for twenty years. |
| 4 | The Capital's Lantern | 15–20 | Kingsway, Normandy, the Cistern Below | Normandy's Great Lantern flickers. Lamp-oil is being stolen from below the city. In the Cistern a Lamplighter named Vessick has been feeding the oil to a crowned swarm-thing, believing it keeps the Hush away. The Lamplighters' archive opens: Felix's journals, half the pages cut out. |
| 5 | Salt and False Lights | 20–26 | Saltreach, Gloaming | Wreckers on the coast hang false lights to draw ships onto the rocks, and Captain Bellweather keeps a lens fragment as his lamp. It is a piece of Felix's Skyglass: he broke his own instrument into five and hid them. |
| 6 | The Stones that Remember | 26–32 | Cairnmoor, Lowmarch | The Echo Stones replay moments of Ellie's company crossing the moor (Wayglass echoes, playable as short scenes). The islands were lifted on purpose: Ellie and Felix raised them to carry the Beacon above the Hush. |
| 7 | Mirror Water | 30–35 | Glasswater | The lakes show the sky as it was. A drowned scribe's ledger names the five Skyglass hiding places and the one who has been gathering them first. |
| 8 | Ashes under the Mountain | 33–39 | Emberfall, the Kiln | The Kiln where the lens was cast is being re-lit cold: Ashgrave, a forge-spirit, has let the Hush into the fire. The player saves the fourth Skyglass and learns how the sky-lift was meant to run. |
| 9 | The Long Winter Court | 38–45 | Rimewater, Spirefall, the Hoarfrost Vaults | The Hoarfrost Regent bargained a winter that never ends for a Hush that spares his court. He holds the last Skyglass. With all five, Windlass can finish Felix's Winch. |
| 10 | The Beacon | 45–50 | Windlass, Galeward, Driftmere, Highreef, the Beacon | The sky-lift rises. On the islands, Felix's constructs still keep the paths. At the Beacon's lower lantern the Lightless Lens is the Hush given a shape. Beaten, the Beacon flares; through the glass, far higher, two figures — one pointing, one with a spyglass — and a road of light going up. (The cap-raise hook.) |

About 60 authored quests (6 per chapter), each relighting a Waybeacon or opening a gate. Felix's Spyglass
(a Legendary back piece) is chapter 10's reward.

### 7.2 Side-quest generators (every zone, without hand-writing hundreds)

Quest = template + zone + parameters + seed, stored as `{template, zone, seed, params}`. Text from phrase
tables (authored: about 40 lines per template) with zone, family, landmark and NPC names. `QUEST_ACTIVE_MAX`
6 → 12.

| template | what | where offered | xp and reward | refresh |
|---|---|---|---|---|
| Bounty | kill N (8–15) of a family archetype within a level window | outpost and town boards | 1.5 × on-level kill xp × N, gold, Standing | 4 per zone, daily |
| Hunt | kill a named rare (Wanted poster with a clue) | outposts | 20 kills' xp, signature item chance, title at 10 hunts per zone | while it lives |
| Delivery | carry a parcel from one outpost or town to another 1–2 zones away (no travel by Waybeacon while carrying) | mailboxes | travel xp, gold, Standing; bonus under a par time | 3 per zone, daily |
| Survey | visit 3–5 POIs and read them | outposts | small xp, map fill, a lore line | once per POI |
| Lamp Defence | hold a POI lamp for 90 s against 3 waves (a duo-sized event, scales ×1.25 per extra member) | lamps marked on the map | relights the zone's minor lamp: Waybeacon fare halved there | hourly per lamp |
| Rescue | find a lost NPC at a POI, defend, escort to road (no walk-speed escort: they follow at run speed) | outposts | xp, gold | 2 per zone, daily |

### 7.3 Standing (light reputation, decided)

No factions at war. Four **Standings**, 0–5: Shady Grove, Normandy, Windlass and the Lamplighters. Raised by
that region's generated quests and story; each step opens a vendor line (Rare patterns, costume pieces at
the Tailor's Row for gold, mount looks, titles). It keeps generated quests meaningful beyond xp.

---

## 8. Gear at scale and the economy

### 8.1 How about 860 items are made (and why none are rolled)

**Decided: every item is a fixed, named item with fixed stats and its own look id. Drops are never random
rolls.** Reasons: the owner dislikes generic looks; a fixed item can be looked up, compared and wanted by
name; every item can be tested in the simulation; whole numbers stay exact; there is no stat-roll grind.
The one variation is the **Ascended** version (hard mode: same item, +5 ilvl, glow trim), which is
recognisable and testable too.

Items are generated **at build time** (data, committed as a generated table and snapshot-tested), not at
drop time:

`item = base type (slot × armour class or weapon/off-hand kind) × tier/ilvl × rarity × make`

- **Base types**: 6 armour slots × 3 armour classes; 6 weapons (10 with the unlockable jobs); 4 off-hand
  kinds (5 with the lute).
- **Makes** are named, themed stat packages: a make chooses the secondary line(s) and the name and look
  family. Each zone has 3 makes (one per armour class) themed on its place and families (*Hollowfen
  Reed-woven*: Evasion; *Kingsway Wardens'*: Resolve; *Saltreach Corsair's*: Ferocity). About 60 makes.
- **Names**: `[make] [noun]` from the slot noun table (Hood, Cap, Helm…, extended with 6 nouns per slot
  per class so names do not repeat), or an authored name for Rare+ (`Fenlight Hood`, `Ratcrown Cleaver`).
- **Looks** come from a **look grammar**: per slot and class, about 16 silhouettes × 8 trims × the make's
  palette and motif (code-built parts). A distinctness test keeps every pair of looks in a slot apart by a
  feature distance. Legendary and boss weapons get authored code-built models (about 60).

**Counts by level 50** (seven starting jobs; legacy items included)

| per tier (ilvl 15, 20, … 50: 8 tiers) | Common | Fine | Rare | total |
|---|---|---|---|---|
| armour, per slot | 3 (one per class) | 3 (the band's zone makes) | 2 | 8 |
| weapons, per weapon type | 1 | 1 | ½ (alternating tiers) | 2.5 |
| off-hands, per kind | 1 | ½ | — | 1.5 |

| slot or kind | per-tier items × 8 | dungeon Heroic (5 new dungeons) | Legendary | named-rare signatures | legacy | **total at 50** |
|---|---|---|---|---|---|---|
| each armour slot (×6) | 64 | 15 (3 sets × 5) | 1–2 | 4 | 10 | **≈ 95** |
| each weapon type (×6) | 20 | 5 (staff 10: one per mage) | 5 (hard modes) + 1–2 | 2 | 4–5 | **≈ 37** |
| each off-hand kind (×4) | 12 | 5 | — | 1 | 4 | **≈ 22** |
| all | | | | | | **≈ 860** (≈ 760 new) |

| level band | new items | of which carry an item ability |
|---|---|---|
| 10–20 (tiers 15, 20; the Cistern) | ≈ 185 | ≈ 55 |
| 20–30 (25, 30; the Grotto) | ≈ 185 | ≈ 55 |
| 30–40 (35, 40; the Kiln) | ≈ 185 | ≈ 55 |
| 40–50 (45, 50; the Vaults, the Beacon) | ≈ 205 | ≈ 70 |

The four unlockable jobs add about 120 weapons and off-hands as they arrive (≈ 980 in all).

### 8.2 The stat list for the scaled game

**Primary budget stats** (scale with ilvl): Power (weapons and off-hands), Defence and Health (armour).
**Armour specials** (budget, one per armour class, 1 rating = 1% at ≤ 14, `R(L)` above): Focus (cloth),
Flow (light), Guard (heavy), cap 40% each (unchanged).
**Secondary stats** (rating → %; each item's lines come from its make). **Diminishing returns**: up to
half the cap a point counts in full, beyond it half (`pct = x ≤ c/2 ? x : c/2 + (x − c/2) / 2`, capped at c).
Shown as whole percent; the engine uses the exact value.

| stat | effect | cap | engine hook (exists or new) |
|---|---|---|---|
| Haste | ability cooldowns recover faster | 20% | new (cooldown clock scale) |
| Breaker | stagger dealt | 30% | exists (`staggerMult`) |
| Ferocity | damage against Broken or stunned enemies | 30% | new (outgoing mult, condition) |
| Mending | heals and shields you give (adds to Focus) | 25% | exists (`given`) |
| Leech | ability damage returned as hp (adds to the Dark Knight's own) | 8% | new for non-DK (lifesteal path exists) |
| Vigor | in combat: heal this % of max hp every 3 s | 1.5% | new (tick) |
| Evasion | dodge charges refill faster | 30% | exists (`dodge.refillMult`) |
| Resolve | affliction stacks and durations on you shorter; knockback speed taken lower (shares the −50% clamp with Guard) | 35% | new + exists |
| Subtlety | threat you add lower | 30% | exists (threat mult) |
| Stride | run speed **out of combat only** | 15% | new (movement check reads it; 0 in combat) |
| Fire / Water / Lightning / Earth Power | that element's damage and its reaction's effect (Blast damage, Steam heal, Conduct stun stagger, Bedrock shield) | 25% each | new (element mult) |
| Fire / Water / Lightning / Earth Ward | that element's damage taken (enemy attacks gain an element tag) | 40% each | new (attack tag + taken mult) |

**Critical hits: no (decided).** Damage stays deterministic: Breaks are the "big hit" windows, Ferocity is
the stat that rewards them, bands stay low-variance and whole numbers stay predictable.

### 8.3 Item budgets (the generator's formulas)

- Full-kit budget at ilvl i and rarity share r: Power `round(r × P(i))` (one-handed weapon 75%, off-hand
  25%; two-handers and pairs 100%); Defence (light) `round(1.33 × r × D(i))`, heavy ×1.5, cloth ×0.5;
  Health (light) `round(0.75 × r × H(i))`, heavy ×1.2, cloth ×0.75; special % `r × (6 + 0.5 i)`; secondary
  % `r × 0.4 i`; ratings = % × `R(i)`. Armour split by Plan 5's slot weights (chest 0.25 … back 0.12) with
  the largest-remainder rule; a weapon carries a chest's share of secondary, an off-hand half. Every stat a
  whole number ≥ 1. Two secondary lines split 60/40.
- An item ability is paid for by the rarity step (Rare over Fine), not by stats.

Reference rows (light chest: Def / HP / Flow / secondary rating; weapon: one-hander Power (+secondary);
from the formulas, which are authoritative):

| rarity | ilvl | light chest | heavy chest Def / HP | cloth chest Def / HP | one-hander | two-hander | off-hand | R |
|---|---|---|---|---|---|---|---|---|
| Rare | 20 | 4 / 27 / 6 / 3 | 7 / 32 | 2 / 20 | 11 (+3) | 14 | 3 (+1) | 2 |
| Rare | 30 | 7 / 41 / 12 / 7 | 10 / 49 | 3 / 31 | 17 (+7) | 22 | 5 (+3) | 3 |
| Rare | 40 | 9 / 55 / 20 / 12 | 14 / 66 | 5 / 41 | 22 (+12) | 29 | 7 (+6) | 4 |
| Rare | 50 | 12 / 69 / 29 / 19 | 18 / 83 | 6 / 52 | 28 (+19) | 37 | 9 (+9) | 5 |
| Heroic | 18 | 5 / 32 / 8 / 4 | 8 / 38 | 3 / 24 | 13 (+4) | 17 | 4 (+2) | 2 |
| Heroic | 34 | 11 / 62 / 17 / 10 | 16 / 74 | 5 / 46 | 25 (+10) | 33 | 8 (+5) | 3 |
| Heroic | 50 | 16 / 92 / 39 / 25 | 24 / 110 | 8 / 69 | 37 (+25) | 49 | 12 (+12) | 5 |
| Fine | 50 | 9 / 51 / 21 / 14 | 13 / 61 | 4 / 38 | 20 (+14) | 27 | 7 (+7) | 5 |
| Common | 50 | 6 / 37 / 16 / — | 10 / 44 | 3 / 28 | 15 | 20 | 5 | 5 |

At 50 a full kit gives about: Common 69 Power, Fine 76 (= `REF`), Rare 86, Heroic 98, before sets and
abilities. Heroic over Fine is about +29% damage, +40% defence and the build: gear matters.

### 8.4 Gear strategies (cross-job builds)

| build | stats | sets that enable it | key items (§8.5) | gives up | best on |
|---|---|---|---|---|---|
| **Breaker** | Breaker, Ferocity, Power | Anvilborn (Kiln, heavy), Wayfarer's (10–20) | Millbrook Thresher, Cairnmoor Gong-Shield, Kiln-Tongs Gauntlets, the Drowned Bell, Keeper's Lantern-Blade | sustain; defence (if light) | Warrior, Monk, Dark Knight, Paladin |
| **Elementalist** (reactions) | an element's Power, Haste, Focus | Emberwright (Kiln, cloth), Tidecaller (Grotto, cloth) | Tinker's Spark-Gloves, Hollowfen Reedbow, Highland Ember Cap, Heart of the Unkindled, Rimecall Staff, Highreef Hermit's Wraps | defence; Ward stats | mages, and Ranger, Warrior, Ninja via items that add elements |
| **Shadowstep** (perfect dodge) | Evasion, Flow, Haste | Cinderdancer (Kiln, light), Skystrider (Beacon, light) | Reedrunner Boots, Lakewarden Jerkin, Steppe-Runner Leggings, Galeward Featherweave, Driftmere Skysilk Wraps | Health and defence: a mistake hurts | Ninja, Ranger, Warrior |
| **Bastion** (shield tank) | Guard, Resolve, Health | Crownguard (Vaults, heavy), Lighthold (Beacon, heavy), Sluiceplate (Cistern, heavy) | Kingsway Warden's Mantle, Barrowstone Greaves, Crownguard Bulwark, Galeward Gale-Greaves, Beaconsteel Hauberk | damage | Paladin, Dark Knight, Warrior |
| **Bloodline** (sustain) | Leech, Vigor, Health | Sluiceplate (Cistern, heavy) | Ratcrown Cleaver, Gravecandle Greatsword, Rimewater Fur Mantle | group utility; damage in short fights | Dark Knight, Monk, solo Warrior |
| **Momentum Engine** | Flow, Haste | Ratrunner (Cistern, light), Corsair (Grotto, light) | Windlass Cogwork Buckler, Brackenridge Briarcoat, Echo-Glass Circlet | defence; Ward | Warrior, Ninja, Black Mage |
| **Choir** (support aura) | Mending, Haste, Focus | Gutterlight (Cistern, cloth), Dawnwoven (Beacon, cloth) | Fenlight Hood, Gutterlamp Tome, Glasswater Mirror-Tome, Tidecaller's Coral Staff, Lens of the Second Dawn, Felix's Spyglass | personal damage | White Mage, Paladin, Bard; any job as a partner's anchor |
| **Glass Cannon** | Power, Ferocity, an element's Power | Corsair (Grotto, light), Frostfang (Vaults, light) | Quillback Fangs, Stormwhale Rib Bow, Skyreef Duskblades, Bellweather's Last Broadside, Shatterglass Longbow | survival | Ranger, Ninja, Black Mage |
| **Spellward** (control) | Breaker, Haste, Resolve | Rimeweave (Vaults, cloth) | Tinker's Spark-Gloves, Cairnmoor Gong-Shield, Thornwall Oathblade | burst | Black Mage, Paladin, Ranger |
| **Wayfarer** (open world) | Stride, Vigor, Subtlety | Wildroad and Highpass field sets | Corsair's Grapnel Sash, Gloamwood Shroud | dungeon performance | anyone levelling or hunting rares |

### 8.5 Item abilities

**Rules**

| rule | value |
|---|---|
| who has one | every Rare, Legendary and non-set Heroic item; Heroic set pieces have set bonuses instead |
| kinds | **passive with a trigger** (on perfect dodge, parry, Break, interrupt, reaction, detonation, kill, heal given, cast done, taunt, shield broken, behind; while below/above an hp share; in a field) or **active** (its own cooldown) |
| where actives live | only on weapons, off-hands and back pieces (and Legendaries); out of combat you **attune** one equipped item; its active sits on the **gear button**, one small fixed button above dodge. Never more than one active button |
| templates | about 48 passive and 16 active templates, each a `Mod` kind (the vocabulary of `shared/src/mods.ts` grows); magnitudes scale with ilvl through `REF` (heals and shields as % of max hp; damage by coef × Power) |
| budget | a passive is worth about 3% of damage (or the matching sustain) in its build's scenario at Rare, 5% at Heroic, 8% at Legendary; actives with cooldown ≥ 45 s about twice that during their window |
| limits | internal cooldown on every damage, heal, shield or Momentum effect (≥ 1 s for Momentum, ≥ 4 s for damage, ≥ 6 s for heals and shields); the same ability id from two items never stacks (P5-a: the larger applies); Momentum from all item abilities ≤ 20 per second; damage ×mult from all items ≤ ×1.25; no item gives a dodge charge beyond the job's +1 cap; no item ability ignores *unavoidable* |
| testable | each template has a sim scenario where it moves its metric by ≥ 1% (no dead abilities: P5-b); for every slot and band the best item differs across at least 3 of the 10 build scenarios (nothing is best for every build) |

**Example rare, heroic and legendary items (44; stats from §8.3)**

| # | name | slot · class | ilvl | rarity | stats | item ability | from |
|---|---|---|---|---|---|---|---|
| 1 | Fenlight Hood | head · cloth | 15 | Rare | Def 1, HP 10, Focus 3, Mending 2 | Heal an ally below 50% hp: they also get a shield of 6% of your max hp, 6 s (ICD 10 s) | Hollowfen rare *Old Lanternjaw* |
| 2 | Reedrunner Boots | feet · light | 15 | Rare | Def 2, HP 10, Flow 3, Evasion 1 | Perfect dodge: +10 Momentum (ICD 3 s) | Hollowfen elites |
| 3 | Millbrook Thresher | greatsword | 15 | Rare | Pow 11, Breaker 2 | You Break an enemy: your next finisher within 6 s costs no Momentum (ICD 20 s) | Millbrook rare *Harrow-Tooth* |
| 4 | Brackenridge Briarcoat | chest · light | 20 | Rare | Def 4, HP 27, Flow 6, Ferocity 3 | Hit a Broken enemy from behind: +5 Momentum (ICD 1 s) | Brackenridge elites |
| 5 | Tinker's Spark-Gloves | hands · cloth | 20 | Rare | Def 1, HP 10, Focus 3, Lightning Power 2 | Your interrupts also deal a Lightning hit, coef 1.0 (ICD 8 s): Conduct on Soaked for any job | Normandy quest *The Clockmaker's Debt* |
| 6 | Hollowfen Reedbow | bow | 20 | Rare | Pow 11, Water Power 3 | A full Charged Shot applies Soaked (primer): a Ranger can set up Conduct | Hollowfen rare *the Reedmother* |
| 7 | Kingsway Warden's Mantle | back · heavy | 20 | Rare | Def 3, HP 15, Guard 3, Resolve 1 | **Active** *Hold the Road* (cd 60 s): taunt every enemy within 8 m; shield yourself 10% max hp for 6 s | Kingsway bounty vendor (Standing: Normandy 2) |
| 8 | Ratcrown Cleaver | greatsword | 18 | Heroic | Pow 17, Leech 2, Breaker 2 | A kill heals you 5% max hp (ICD 2 s) | Cistern Below: the Cistern King |
| 9 | Gutterlamp Tome | off-hand · tome | 18 | Heroic | Pow 4, Haste 1, Mending 1 | A cast of 1 s or longer that completes gives the lowest-hp ally within 18 m +6 Momentum (ICD 6 s) | Cistern Below: Lamplighter Vessick |
| 10 | The Drowned Bell | blade | 18 | Legendary | Pow 13, Breaker 2, Haste 2 | **Active** *Toll the Deep* (cd 90 s): ordinary enemies within 6 m stunned 2 s; elites and bosses +60 stagger and interrupted | Cistern Below hard: the Cistern King |
| 11 | Gloamwood Shroud | back · cloth | 25 | Rare | Def 1, HP 12, Focus 5, Subtlety 3 | An enemy turns to attack you: Mist for 2 s (its autos miss) (ICD 20 s) | Gloaming Wood rare *the Pale Stag* |
| 12 | Quillback Fangs | daggers | 25 | Rare | Pow 18, Ferocity 6 | Hit a Rooted enemy from behind: it is Marked (primer) (ICD 6 s) | Gloaming Wood elites |
| 13 | Corsair's Grapnel Sash | back · light | 25 | Rare | Def 3, HP 16, Flow 5, Stride 3 | **Active** *Grapnel* (cd 45 s): pull yourself to your target, up to 10 m (server-checked displacement) | Saltreach rare *Gull-Eye Merrow* |
| 14 | Tidecaller's Coral Staff | staff | 26 | Heroic | Pow 19, Water Power 5, Mending 3 | Steam you cause heals 50% more and cleanses one affliction from each ally it heals | Wrecker's Grotto: Captain Bellweather |
| 15 | Wrecker's Hook-Buckler | off-hand · buckler | 26 | Heroic | Pow 6, Breaker 2, Resolve 2 | A parry pulls the attacker 3 m toward you and Dazes it (primer) | Wrecker's Grotto: the Tidewife |
| 16 | Bellweather's Last Broadside | bow | 26 | Legendary | Pow 19, Fire Power 5, Haste 3 | **Active** *Broadside* (cd 75 s): three 20 m lines over 1.5 s, coef 2.0 each, Fire, leave Burning | Wrecker's Grotto hard |
| 17 | Barrowstone Greaves | legs · heavy | 30 | Rare | Def 8, HP 39, Guard 9, Resolve 5 | While above 70% hp, knockback speed on you is halved (inside the −50% clamp) | Cairnmoor rare *the Barrow-Reeve* |
| 18 | Cairnmoor Gong-Shield | off-hand · shield | 30 | Rare | Pow 5, Breaker 3 | **Active** *Gong* (cd 60 s): +40 stagger to every enemy within 4 m; interrupts | Cairnmoor elites |
| 19 | Echo-Glass Circlet | head · cloth | 30 | Rare | Def 2, HP 21, Focus 8, Haste 5 | Every fourth completed cast is instant (the counter is shown) | Glasswater rare *the Mirror Heron* |
| 20 | Lakewarden Jerkin | chest · light | 30 | Rare | Def 7, HP 41, Flow 12, Evasion 7 | Perfect dodge: shield 5% max hp for 3 s (ICD 6 s) | Glasswater bounty vendor |
| 21 | Highland Ember Cap | head · light | 35 | Rare | Def 6, HP 33, Flow 12, Fire Power 7 | Your finishers' detonations count as Fire: a Warrior or Ninja sets off Blast on Marked | Emberfall elites |
| 22 | Emberfall Slagwalkers | feet · heavy | 35 | Rare | Def 6, HP 30, Guard 9, Fire Ward 5 | Field damage (standing hazards) on you −30% | Emberfall rare *Old Clinker* |
| 23 | Kiln-Tongs Gauntlets | hands · heavy | 35 | Rare | Def 6, HP 30, Guard 9, Breaker 5 | You Break an enemy: it takes +10% damage from your party while Broken (does not stack with Weak Point: the larger applies) | Emberfall bounties |
| 24 | Glasswater Mirror-Tome | off-hand · tome | 35 | Rare | Pow 6, Mending 5 | A shield you gave breaks: the attacker takes a coef 0.8 hit from you (ICD 4 s) | Glasswater rare *the Drowned Scribe* |
| 25 | Thornwall Oathblade | sword | 35 | Rare | Pow 20, Guard 11 | Your Taunt also makes its target deal −10% damage to everyone else for 6 s | Rimewater elites |
| 26 | Cinderwake Fangs | daggers | 34 | Heroic | Pow 33, Fire Power 6, Flow 4 | Hamstring also applies Burning (two marks from one finisher) | Kiln of Ashgrave: the Slag Twins |
| 27 | Heart of the Unkindled | staff | 34 | Legendary | Pow 25, Fire Power 6, Haste 4 | Blast you cause leaves a 4 m fire field for 4 s (coef 0.4 a second to enemies only); your Fire ignores resistance | Kiln of Ashgrave hard |
| 28 | Rimewater Fur Mantle | back · light | 40 | Rare | Def 5, HP 26, Flow 9, Vigor 6 | **Active** *Hearthwarm* (cd 90 s): you and allies within 8 m heal 12% max hp over 6 s | Rimewater rare *Greyhorn the Elder* |
| 29 | Gravecandle Greatsword | greatsword | 40 | Rare | Pow 29, Leech 12 | Below 50% hp your lifesteal is ×1.5 | Spirefall rare *the Candle-Bearer* |
| 30 | Steppe-Runner Leggings | legs · light | 40 | Rare | Def 8, HP 44, Flow 16, Evasion 10 | The first perfect dodge of a fight resets your signature ability | Rimewater bounties |
| 31 | Rimecall Staff | staff | 42 | Heroic | Pow 31, Water Power 10, Haste 7 | Soaked you apply lasts 50% longer; Conduct you cause stuns 0.5 s longer | Hoarfrost Vaults: the Hoarfrost Regent |
| 32 | Crownguard Bulwark | off-hand · shield | 42 | Heroic | Pow 10, Guard 5, Resolve 3 | Damage Shelter moves to you is ×0.8 | Hoarfrost Vaults: the Glass Seneschal |
| 33 | Shatterglass Longbow | bow | 42 | Legendary | Pow 31, Ferocity 10, Breaker 7 | **Active** *Shatter* (cd 60 s): your next Charged Shot pierces in a 22 m line and detonates every mark it passes | Hoarfrost Vaults hard |
| 34 | Galeward Featherweave | back · cloth | 45 | Rare | Def 3, HP 22, Focus 13, Evasion 8 | **Active** *Updraft* (cd 45 s): an 8 m dash with 0.35 s i-frames (a third dodge on a long cooldown) | Galeward rare *the Kite-King* |
| 35 | Driftmere Skysilk Wraps | hands · cloth | 45 | Rare | Def 3, HP 24, Focus 14, Haste 9 | For 4 s after a perfect dodge you cast at full speed while moving | Driftmere elites |
| 36 | Windlass Cogwork Buckler | off-hand · buckler | 45 | Rare | Pow 8, Flow 8 | A parry stores a charge (max 2); your next quick ability spends them for +coef 1.0 each | Windlass quest *The Last Winch* |
| 37 | Galeward Gale-Greaves | legs · heavy | 45 | Rare | Def 13, HP 59, Guard 21, Resolve 14 | No knockback while your shield holds | Galeward bounties |
| 38 | Stormwhale Rib Bow | bow | 48 | Rare | Pow 26, Ferocity 18 | Autos and abilities from 15 m or farther deal +12% | Highreef world rare *the Stormwhale* |
| 39 | Beaconsteel Hauberk | chest · heavy | 50 | Rare | Def 18, HP 83, Guard 29, Resolve 19 | Unavoidable attacks deal −15% to you | Highreef elites |
| 40 | Highreef Hermit's Wraps | hands · cloth | 50 | Rare | Def 3, HP 27, Focus 15, Lightning Power 10 | A reaction you cause takes 2 s off your signature's cooldown (ICD 4 s) | Highreef rare *the Hermit of the Reef* |
| 41 | Skyreef Duskblades | daggers | 50 | Heroic | Pow 49, Ferocity 15, Flow 10 | Every fifth hit from behind applies Weak Point for 6 s | The Beacon: the Lantern Choir |
| 42 | Keeper's Lantern-Blade | blade | 50 | Legendary | Pow 37, Breaker 15, Haste 10 | A parry sends a light pulse: coef 1.5 to enemies within 6 m and 3% max hp heal to allies within 6 m (ICD 4 s) | The Beacon hard |
| 43 | Lens of the Second Dawn | staff | 50 | Legendary | Pow 37, Mending 15, Haste 10 | Second Dawn cd −15 s; the revived ally gets 3 s of safety and +50 Momentum | The Beacon hard |
| 44 | Felix's Spyglass | back · light | 50 | Legendary | Def 8, HP 44, Flow 19, Haste 7, Ferocity 5 | **Active** *Spot the Flaw* (cd 60 s): the target is Exposed 8 s: your party deals +12% to it | Main story chapter 10 (authored) |

Low-level secondaries are small numbers (2 rating = 1% at level 15–24): they grow readable with `R(L)`.

### 8.6 Sets, boss weapons, sources and loot

**Sets (28 by 50)**: legacy 9 (3/5-piece bonuses, unchanged); 15 dungeon sets (6 pieces, bonuses at
**2, 4 and 6**); 4 Rare field sets of 3 pieces (Wayfarer's 10–20, Wildroad 20–30, Highpass 30–40,
Skybound 40–50; any armour class, bonus at 3) from bounty vendors.

| dungeon | cloth | light | heavy |
|---|---|---|---|
| the Cistern Below (18) | Gutterlight: 2 Haste +3% / 4 casts −10% / 6 a completed long cast gives the party +5 Momentum | Ratrunner: 2 Flow +5 / 4 finishers cost −5 / 6 a finisher after a perfect dodge refunds 15 | Sluiceplate: 2 Health +5% / 4 Leech +3% / 6 below 35% hp heal 15% max hp (once per 45 s) |
| the Wrecker's Grotto (26) | Tidecaller: 2 Water Power +5% / 4 Steam heals ×1.3 / 6 heals you give cleanse one affliction (ICD 10 s) | Corsair: 2 Ferocity +5% / 4 Broken enemies take +10% from you / 6 a Break gives you 6 s of ×1.15 damage | Anchorbound: 2 Resolve +5% / 4 knockback immune while taunting / 6 taunts shield you 12% max hp |
| the Kiln of Ashgrave (34) | Emberwright: 2 element Power +5% / 4 reactions you cause give +15 Momentum / 6 reactions splash ×1.5 radius | Cinderdancer: 2 Evasion +8% / 4 perfect dodge resets quick / 6 for 3 s after a perfect dodge your hits deal ×1.2 | Anvilborn: 2 Breaker +8% / 4 Breaks last +1 s / 6 your Break stuns adds around it within 6 m 2 s |
| the Hoarfrost Vaults (42) | Rimeweave: 2 Haste +5% / 4 your interrupts add +20 stagger / 6 an interrupt gives the party ×1.1 damage 6 s | Frostfang: 2 Ferocity +5% / 4 from behind +8% / 6 every 6th hit from behind is a combo detonation | Crownguard: 2 Guard +8 / 4 Shelter share 0.5 → 0.6 with −10% taken / 6 party within 8 m take ×0.93 |
| the Beacon (50) | Dawnwoven: 2 Mending +5% / 4 Bond gives +15 instead of +10 / 6 revives are instant once per fight | Skystrider: 2 Flow +8 / 4 +1 dodge charge (within the cap) / 6 a perfect dodge gives the party +10 Momentum | Lighthold: 2 Defence +5% / 4 shields on you ×1.2 / 6 once per 90 s a killing blow on an ally within 8 m hits you instead |

**Named boss weapons**: each dungeon's last boss drops a Heroic weapon for every weapon type (two staves,
one per mage; unlockable jobs' types added when they arrive), each with its own authored model and an item
ability; its hard mode drops one Legendary per weapon type. Mid bosses drop off-hands and set pieces.

**Where items come from**

| source | rarities | rule |
|---|---|---|
| ordinary enemies | Common, Fine (the zone's makes, the drop's family biases the slot) | `chance` per kill as `loot.ts` (6–8%) |
| elites | Fine, Rare (the zone's Rare list) | 25–30% |
| named rares | the signature item (Rare or Legendary) | 35%; once a day per credited member; Pattern unlock on first kill |
| dungeon packs | Rare (the dungeon's list) | 10% per pack per member |
| dungeon bosses | Heroic set pieces, boss weapons | one item per member per boss, daily first kill; later kills: gold and Embers |
| hard modes | Ascended Heroic, Legendary | Legendary 8% per member per day, with bad-luck protection |
| quests | Fine and Rare, story Legendaries | fixed, choice of 2–3 |
| vendors | Common (towns and outposts), Fine (bounty vendors for Standing) | gold |
| Pattern Book (crafting-lite, below) | Fine, Rare you have seen | Embers + gold |

**Drop philosophy for duos**: personal loot stays (each member rolls their own, for their current job,
as `loot.ts`); party size never lowers anyone's chance. **Bad-luck protection**: every eligible kill that
does not drop a Heroic or Legendary item adds +1 to that boss's pity count; at 6 (Heroic) or 12 (Legendary)
the next kill gives a chosen item from its list. Pity is per adventurer per boss and saved.

**Crafting-lite (decided: small)**: *Salvage* any Fine or better item at a Smithy into **Embers**
(Fine 2, Rare 6, Heroic 15); the **Pattern Book** lists every Fine and Rare item whose look you own;
re-make one for Embers + gold (Rare 60 Embers + `20 × ilvl` gold). No gathering, no skill levels. It turns
every drop into progress and makes a wanted Rare reachable without luck.

**The appearance collection**: every item's look unlocks for good (wardrobe rules); with about 860 looks and
"show as" per slot, old gear stays worth collecting: a Collection screen per slot and per set, completion
counts per zone and dungeon, titles at 25 / 50 / 100% of a set family (for example *Lamplighter of
Ambermarch* for all dungeon sets), and the Ascended glow kept as a look variant. Costumes stay gold or
GM-event only.

### 8.7 Economy

| sources | sinks |
|---|---|
| kills (gold scales with level: `1–3 × level / 5`), bounties, deliveries, hunts, selling items | Waybeacon fares (`2 × level`), mount (Normandy, 2 000), talent retraining, Barber, dyes, costumes, Pattern Book re-makes, bag and Vault expansions (+10 slots: 500, 2 000, 8 000), Fellowship charter (1 000), outfit slots beyond 6 |

**Trading (decided)**: face-to-face trade of gold, Common and Fine items between two adventurers standing
together (a double-confirm window); Rare and better are bound when picked up. No auction house (revisit
above 500 players). Reasons: keeps the gear chase personal, limits gold-selling, small UI on phones.

---

## 9. Social scale

| topic | decision |
|---|---|
| zone population | 100 per zone room (unchanged); 100 online in all for now |
| channels | if a zone room passes 80, a second copy ("channel 2") opens for new arrivals; party members always join their leader's channel; channels close when empty. Rarely used at 100 online; ready for growth |
| Fellowships (linkshell-like) | yes, small: up to 64 members, a name (bad-word filter), a chat channel, a roster with online status and job; joinable by more than one per adventurer (up to 3, as linkshells); no bank, levels or halls (homes phase) |
| friends list | yes (100 names, online status, "join" puts you in their zone's channel) |
| looking for group | a board in Normandy and at outposts: "level, job, goal" posts that expire after 30 minutes |
| party | up to 4 (unchanged); Partner Sync (§2.8) |
| chat | zone, party, Fellowship, whisper; town and outpost "say" radius 30 m (bandwidth) |

---

## 10. Technical plan

### 10.1 Shared

| change | file(s) |
|---|---|
| `LEVEL_CAP`, curve to 99, `REF`, `R(L)`, level-difference table, party xp shares, sync maths | `progression.ts`, `combat/stats.ts` (`DEFENCE_K(L)`), new `combat/levels.ts` |
| enemy families, archetypes, variants, level scaling; AI additions | `combat/enemies.ts` (kinds become generated from `combat/families/*.ts`), `enemyAi.ts` |
| stats and DR; new `Mod` kinds (triggers, actives, element tags) | `combat/stats.ts`, `mods.ts`, `combat/engine.ts`, `effects.ts` |
| item generator (base × tier × rarity × make), legacy table, item abilities | `items.ts` → `items/{legacy,bases,makes,generate,abilities}.ts`; a generated, snapshot-tested `items.gen.ts` |
| look ids 12-bit, collection 512 bytes, gear code v3, look grammar ids | `wardrobe.ts`, `gearLook.ts` |
| world map, recipe v2 (biomes, road graph, water, terraces, outposts, POIs, rares, danger gradient), dungeon recipe v2 | `world/{map,recipe2,biomes,outpost,poi}.ts`, `dungeon.ts` |
| quest generators and Standing | `quests.ts` → `quests/{story,generated,standing}.ts` |
| abilities and talents data to 50 | `combat/abilities.ts`, `talents.ts` |

### 10.2 Server

| change | detail |
|---|---|
| rooms on demand | one `ZoneRoom` per zone (and per channel) created on first join or travel, `autoDispose` after 5 min empty; towns persistent; `/api/zone` resolves a room or creates it |
| enemy sleep | no adventurer within 90 m: enemy is not stepped or sent |
| instance families | `instance.ts` generalised from the Lampfall to a dungeon table (key per party per dungeon) |
| sync, party xp, level difference, pity, Standing, Embers, trade, Fellowships, friends, LFG | new handlers; stores and migrations |
| Waybeacon travel and the sky-lift | travel to a beacon's arrival point; server-driven displacement for the lift |
| process split (only if measured) | Colyseus presence on Redis, zones spread over 2 processes |

### 10.3 Bandwidth (at its limit today: 11.0 KiB/s clustered, 4.4 typical)

| cut or restructure | expected effect |
|---|---|
| distance tiers: full 15 Hz within 25 m; 5 Hz for 25–60 m (adventurers and enemies not engaged with you) | −30% clustered |
| once-per-entity `meta` message (name, level, family variant, nameplate colour, look code) instead of state fields | level and variant data cost nothing per patch |
| enemy hp as 1 byte (per 255) except your target and party targets | −5% fight |
| `INTEREST_MAX_ADVENTURERS` 50 → 40 (party always pinned) | −8% clustered |
| buff, song and pet bits packed (one u32 per entity) | keeps Bard and Beastmaster in budget |
| **Gate**: clustered ≤ 9.0 KiB/s per client with levels, looks, parties and Heroic gear; typical ≤ 5.0 | headroom 2 KiB/s |

### 10.4 Client

Terrain in 64 m chunks with three distance LODs and far impostor trees; biome materials; a zone map and a
continent map; the travel load screen; enemy family renderer from code-built parts with palette, scale and
prop per variant (2 draw calls per enemy kept); the look-grammar renderer; the gear button; level colours
and skulls on nameplates; boards (bounty, Wanted, LFG); Collection screen; trade window. Draw calls on
medium ≤ 150 in the densest zone (today about 132 in the Greenway).

### 10.5 Tests

| kind | what |
|---|---|
| bands parametrised by level | every Plan 3–5 band runs at levels 10, 20, 30, 40, 50 with `REF` gear and scaled enemies; ordinary TTK within ±25% of the level-10 median at every level |
| boss bands | §4.4 rule 7 per boss; support band S1 (§6.3) |
| item bands | per band: Fine kit ≈ `REF` (±3%); Rare/Heroic step sizes; every item ability moves its metric ≥ 1%; best-in-slot differs across ≥ 3 build scenarios; whole numbers ≥ 1 (`wholeStats.test.ts` over every generated item) |
| generated-content validity (every zone) | flood fill from the spawn reaches every gate, the outpost, every camp, POI, landmark and dungeon mouth; no walkable pocket that the flood fill misses (filled or removed); every road joins its gates; no slope or ledge past the movement rules; camps' level gradient; every point inside `limits.ts`; gates match their neighbour's; determinism snapshot (hash of the layout) |
| looks | every item has a unique look id; distinctness by feature distance per slot |
| levelling bots | headless engine (no network), time-compressed: a bot levels one job 1 → cap through the zones with bounties and story, solo and duo; gate: hours per band within ±20% of §2.3; no band with less than 120% of the xp it needs available |
| load | 100 bots spread over 10 zones (room churn, sleep) and 100 clustered in Normandy: 15 Hz, step p95 per §3.3, peak RSS ≤ 1.5 GB, bandwidth per §10.3 |
| migrations | save round-trips from every earlier save shape; a level-10 character loads with nothing lost |

### 10.6 Save migrations

`jobs` (talent arrays pad, curve unchanged), `inventory` (collection widens, rarity added by id, pity
counts, Embers, Pattern Book bits, outfits keep look ids), `quests` (v1 → v2: generated quests, 12 active,
Standing), `adventurers.zone` (wider id set), new tables (`fellowships`, `friends`, `waybeacons`). All
read-repair as today: no destructive migration, written back once on join.

---

## 11. Phased roadmap

Sizes are relative to Plan 5 (the largest phase built) = 1.0. The cap never rises before its band has
zones, a dungeon and quests.

| phase | goal | delivers to a player | depends on | size |
|---|---|---|---|---|
| **S1 Level framework** (first) | `REF`, curve and tables to 99 with the cap at 10; level difference; party xp shares; rating stats; Lampfall hard mode (*the Lampfall Kindled*) | enemy levels and colours, a real hard mode, Ascended Warden drops | — | 0.4 |
| S2 Rooms and bandwidth | rooms on demand, enemy sleep, distance tiers, `meta` message, the §10.3 gate | nothing visible; headroom | S1 | 0.5 |
| S3 World generator v2 (the old **Phase 7**) | world map, biomes, road graph, water, terraces, outposts, POIs, rare sites, danger gradient, validity tests; Greenway gains its north and east gates (a deterministic carve; story spots re-verified) | Millbrook Downs (5–11) as the first generated zone | S2 | 1.0 |
| S4 Item system v2 | stats and DR, item generator, item abilities, gear button, 12-bit looks, gear code v3, sets 2/4/6, Pattern Book and Embers, pity | new Rare items in Millbrook and the Lampfall; salvage | S1 | 1.0 |
| S5 Enemy families | family and variant data, the 6 AI additions, named rares and Wanted posters | rares in the Greenway and Millbrook | S1, S3 | 0.6 |
| **S6 Cap 20** | Hollowfen, Kingsway Vale, Normandy (town template), Lowmarch Barrows, the Cistern Below; chapters 3–4; bounties, hunts, deliveries, surveys; Waybeacons; Partner Sync; Standing | the road north, the capital, a second dungeon | S3–S5 | 1.4 |
| S7 Monk and Bard | two unlockable jobs and their chains; new picks at 12 and 18 for all jobs; talent rows 15 and 20 | new jobs | S6 | 0.9 |
| S8 Social | Fellowships, friends, LFG, trade, channels | grouping tools | S6 | 0.4 |
| **S9 Cap 30** | Brackenridge, Saltreach, Gloaming, Cairnmoor; the Wrecker's Grotto; chapters 5–6; mounts; Beastmaster | the coast, mounts, taming | S7 | 1.4 |
| (Homes, the old **Phase 8**) | owner's later phase; fits here if wanted, in Normandy's Low Ward | — | S9 | — |
| **S10 Cap 40** | Glasswater, Emberfall, Rimewater; the Kiln; chapters 7–8; picks at 30 and 38; rows 26, 32 | the highlands | S9 | 1.3 |
| **S11 Cap 50** | Spirefall, Windlass, Galeward, Driftmere, Highreef; the Vaults and the Beacon; chapters 9–10; the sky-lift and gliding; Sky Lancer; picks at 46; rows 40 and 50 | the floating islands | S10 | 1.8 |
| S12 Endgame | Ascendant rotation, world rares at 50, legendary chains, collection titles | the long game | S11 | 0.5 |
| (Neighbourhoods, the old **Phase 9**) | after homes, after S12 | — | homes | — |
| later: Cap 60 → 99 | new region per +10 levels (2–3 zones, 1 dungeon, 1 chapter); tables already exist | — | S12 | 1.2 each |

**Why S1 first**: it is pure shared code with parity tests (nothing a player has changes), every later phase
reads its tables (the generator's camp levels, item budgets, enemy scaling, sync), and it ships a real
player-facing win in the same phase: the Lampfall hard mode that answers "the Warden is trivial in T3".

---

## 12. Risks and open decisions for the owner

| # | risk or decision | recommended default (work continues on it) |
|---|---|---|
| 1 | Generated zones may feel samey | biome tables, 3 families per zone, named landmarks and POIs; a "zone review" screenshot pass per zone before its cap phase ships |
| 2 | Tuning volume: ~860 items, 18 families, 6 dungeons | everything from formulas and templates; bands per level; item-ability sim scenarios; tune templates, never single items |
| 3 | Phones with bigger zones | chunked terrain and LOD; draw-call and frame-time gates per zone; still never tested on a real phone — the owner's test on a phone should come before S6 ships |
| 4 | One Node process for many rooms | enemy sleep and on-demand rooms first; split processes only when measured |
| 5 | Continent name "Ambermarch" and all new names | keep; rename freely (data only) |
| 6 | No critical hits | keep (deterministic damage; Ferocity on Breaks) |
| 7 | Trading only Common/Fine face-to-face; no auction | keep until 500+ players |
| 8 | Party xp shares 1 / 0.75 / 0.6 / 0.5 | keep (duo levels about 1.35× faster than solo) |
| 9 | Unlocked jobs start at unlock level − 15 (Sky Lancer at 30) | keep |
| 10 | Mount at 20, Waybeacon fares, gliding only on the islands | keep |
| 11 | "White Mage" and "Black Mage" names | keep until before public release (spec) |
| 12 | Hours to 50 (target 45–55 solo) | keep; the levelling bots measure it each cap phase |
| 13 | Server memory for sg2 raised to 3 GB of the 16 GB machine | keep; confirm it fits beside the other games |
