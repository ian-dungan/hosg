// Load test: `count` guest adventurers join `--zone` (the grove by default; the Greenway for a server
// started with SG2_START_ZONE=greenway), run about at TICK_HZ with the shared character
// controller (over that zone's height surface, jumping now and then) and chat every 20 s. With
// --stand they stand still instead (they still chat). Prints the patch rate the bots saw, the bytes a
// second each received (state patches and messages), the server's peak memory and step time (p95),
// and exits non-zero unless every bot stayed connected, the mean patch rate is at least 14 Hz, no
// legal step was corrected, no bot was ever left in the air without a pose it could send, and none
// was stuck for a second or more. The first few corrections are printed in full, with the pose the
// bot had sent. With --stand the patch rate is checked too: the state's `clock` changes every step, so
// even a room where nobody moves sends a patch each step. Bots do not fight; a knockback or a respawn
// only moves them (they adopt its ack), and one that dies stands still until it gets up.
// --warmup <s> waits that long after the last join before measuring (default 2), so walking bots
// have spread out over the zone; --cluster <m> keeps every bot within that many metres of where it
// joined (all join at the spawn: the worst case for interest management, everyone sees everyone).
// It also prints how many adventurers each bot had in its state (its view) and the online count field.
//
// --fight: bots that fight, with the shared brain (adventurerBrain, as the tuning simulation runs it).
// Each asks GET /api/zone (60 a minute per account) and joins that room. Most are Warriors (a new
// adventurer's job); every 4th is a Ranger (the Bow), and every 5th (SPRINTERS) a Ranger with Sprint
// for a pick. Jobs change only in a town, so a Ranger-to-be that starts in the Greenway first walks out
// through its west gate into the grove, changes job there and walks back through the east gate. In the
// Greenway, every tick it picks an enemy (its current one while it lives; else one attacking it; else the
// nearest live one within TARGET_RANGE that fewer than FIGHTERS_PER_ENEMY others in its view fight, one
// for an elite), or with none walks to the nearest camp it has not just visited (by findPath over the
// zone's ground) and waits just outside it. It builds a BrainInput from the state it sees (its interest
// view) and its last `self`, and does what the brain says: careful for 3 bots in 4, careless for the
// 4th; a few careless ones (ELITE_HUNTERS) go solo at a Mossback. Moves carry the ack of the latest
// `displaced`/`respawned` and are sent as the browser sends them: what its controller did, with no
// check of its own first (so any pose the server would wrongly refuse shows up as a correction).
// Most bots walk at WALK_SHARE of the allowed speed; sprinters walk at the full speed the browser uses
// (RUN_SPEED, ×SPRINT_SCALE from the moment Sprint's `use` arrives until SPRINT_EARLY_S before it ends,
// ×0.4 while charging) and press Sprint for long walks. A dodge waits for its `displaced` (or
// `refused`), and a displacement is played out (no poses) before it moves on from its end; PREDICTORS
// instead roll at once as the browser does (its own simulateDisplacement, rolled back on a refusal),
// see their `displaced`/`correct`/`refused`/`respawned` PREDICTOR_LAG_MS late (a slow downlink), and
// roll twice in a row when they have both charges: the second roll goes from the first's predicted
// end before the first's `displaced` has arrived, with the ack before it (the server's ownRollBefore).
// After a death it asks to respawn, wakes at the grove's statue, walks to the east gate and travels
// back. It passes only if every bot stayed connected, the mean patch rate is at least 14 Hz, no move
// was corrected (the `correct` that follows a dodge the engine refused is the protocol's rollback,
// counted apart by the refusal's reason, and only RACY_ROLLBACKS may cause one), no bot was stuck for
// TICK_HZ ticks in a row, credited kills >= 50, dodges >= 20, knockbacks >= 1, predicted second rolls
// sent early >= 1 and every one of them rolled, every bot that died is back in the Greenway or on its
// way, the zone step p95 <= 15 ms, peak RSS <= 400 MB, and no bot saw more than MAX_ENEMIES_PER_ZONE
// enemies.
// --cycle (implies --fight; for a 120 s run): also deaths >= 1 and at least one bot back in the
// Greenway after one (the whole death -> statue -> east gate -> Greenway cycle).
// --jobs mixed (with --fight; start the server in the grove, its default): bot i is a JOB_IDS[i % 7], takes its job
// at the Guild Board (and its duo picks with a partner i ^ 1, else its solo picks), walks to the Greenway, has one job
// change refused 'not-here' there, then fights in duos with the other bots in its view as the brain's allies (heals
// and revives carry their explicit ally id: no parties here). Hunters with medics, auto-only hunters and the
// White Mage + Black Mage duos are described at MIXED_MEDICS, AUTO_ONLY_HUNTERS and Bot.toughFirst; the extra
// pass marks at MIXED_MIN (docs/load-test.md, "Mixed jobs").
// --assist <name>: the browser smoke test's two helpers for the adventurer called <name> (see `assist` below).
//   npm run bots -w server -- --url http://localhost:2570 --count 100 --seconds 60 [--zone greenway] [--stand] [--warmup 40] [--cluster 30] [--fight [--cycle] [--jobs mixed]] [--assist <name>]
// The server's auth limiter allows 10 logins per IP a minute by default: start it with a higher
// SG2_AUTH_RATE_PER_MIN (e.g. 1000) for a bot run.
import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Client, type Room } from '@colyseus/sdk';
import {
  ABILITIES,
  ALLY_VIEW_R,
  CAST_MOVE_SCALE,
  DEATH_MIN_S,
  GUILD_BOARD,
  JOB_IDS,
  DODGE_MIN_GAP_S,
  ENEMY_ATTACKS,
  ENEMY_KINDS,
  GCD_S,
  GROVE_EAST_GATE,
  INTEREST_RADIUS,
  JOBS,
  MAX_ENEMIES_PER_ZONE,
  RESPAWN_CLEAR_RADIUS,
  RUN_SPEED,
  SPRINT_S,
  SPRINT_SCALE,
  TARGET_RANGE,
  TICK_HZ,
  adventurerBrain,
  checkPose,
  dodgeDisplacement,
  findPath,
  greenwayLayout,
  inShape,
  isZoneId,
  makeAirTrack,
  makeBody,
  newBrainMemory,
  simulateDisplacement,
  slotsFor,
  stepBody,
  withClearance,
  zoneDef,
  type Act,
  type AirTrack,
  type Body,
  type BodyInput,
  type BodyStep,
  type BrainMemory,
  type CastView,
  type CombatantView,
  type EnemyAttackId,
  type EnemyKindId,
  type S2C,
  type SelfView,
  type Shape,
  type Surface,
  type TelegraphView,
  type Vec2,
  type AbilityId,
  type JobId,
  type Loadout,
  type ZoneId,
  AUTO_RELEASE_S,
  REACTION_S,
  SKILLED_MISS,
  SLOPPY_MISS,
  LAMPFALL_MOUTH,
  MAX_INSTANCES,
  PARTY_MAX,
  REASON_IN_COMBAT,
  REASON_INSTANCES_FULL,
  RELEASE_MIN_S,
  WIPE_DELAY_S,
  dungeonBrain,
  gatedSurface,
  lampfallLayout,
  type BrainAction,
  type BrainInput,
  type DungeonBrainInput,
  type DungeonRoom,
  type FieldView,
  type InstanceView,
  type PartyView,
  type Skill,
  COSTUMES,
  ITEMS,
  QUESTS,
  STALL_REACH,
  TOWN_STALLS,
  fits,
  kitItems,
  prng,
  questGoal,
  randomLook,
  type CostumeId,
  type GearSlot,
  type InventoryView,
  type QuestGoal,
  type QuestId,
  type QuestsView,
  type StallId,
} from '@sg2/shared';

const MIN_MEAN_HZ = 14;
const CHAT_EVERY_MS = 20_000;
const JOINS_AT_ONCE = 10;
/** Still time after joining, so the server's movement allowance (0.5 m for a new session) fills up first. */
const SETTLE_MS = 1200;
/** Chance a grounded bot jumps on a given tick (about once every 4 s). */
const JUMP_CHANCE = 1 / 60;
/** stepBody simulates at most 0.25 s a call: longer gaps between ticks are stepped in pieces of this. */
const BODY_STEP_MAX_S = 0.25;

// --fight
/** The fight run's pass marks. */
// (Ruling P3-i: the brief asked for dodges >= 100 and deaths >= 1 in 60 s, which 21 enemies on a 25 s
// respawn cannot give; deaths and the whole way back are gated by --cycle, on a 120 s run. Ruling P3-j:
// dodges >= 20, as the stricter bots rolled 23-42 in 60 s.)
const FIGHT_MIN = { kills: 50, dodges: 20, knocks: 1, earlyRolls: 1 };
/** With --cycle: at least this many deaths, and this many bots back in the Greenway after one. */
const CYCLE_MIN = { deaths: 1, returned: 1 };
/** Careless bots (by index) sent solo at a Mossback from the start, so that deaths happen: no other bot engages an elite a hunter is on. */
const ELITE_HUNTERS = [3, 7, 11];
const MAX_STEP_P95_MS = 15;
const MAX_PEAK_RSS_MB = 400;
/** Walking speed as a share of what the server allows (RUN_SPEED × its speed scale); sprinters walk at 1. */
const WALK_SHARE = 0.95;
/** Bots (by index mod 5) that walk at the browser's full speed and take Sprint (Rangers with Sprint and Field Dressing). */
const SPRINTER = 0;
const SPRINTER_PICKS: [AbilityId, AbilityId] = ['sprint', 'field_dressing'];
/** A new adventurer's job and picks. */
const NEW_LOADOUT: Loadout = { job: 'warrior', picks: [JOBS.warrior.picks.solo[0], JOBS.warrior.picks.solo[1]] };
/** A job change not confirmed by `jobs` is asked again after this (ms). */
const JOB_RETRY_MS = 2000;
/** The browser stops sprinting this long before Sprint ends (client/src/combat/controller.ts). */
const SPRINT_EARLY_S = 0.15;
/** A sprinter presses Sprint when its walk goal is farther than this. */
const SPRINT_FROM_M = 10;
/** Bots (by index mod 5) that predict their rolls as the browser does, with a slow downlink. */
const PREDICTOR = 2;
/** How late a predictor sees its `displaced`, `correct`, `refused` and `respawned` (by index: 450, 550, 650 ms). */
const predictorLagMs = (index: number) => 450 + (index % 3) * 100;
/**
 * Dodge refusals from the engine (after the server took the dodge's pose) that may follow a legal dodge,
 * so their rollback is no failure: only 'busy' (a knock landed between the press and the server). Any
 * other reason means the server took a dodge the engine then refused: a false rejection. ('dead' never
 * gets this far: the room refuses a dead adventurer's dodge itself, with no `correct`; 'air' cannot
 * follow a legal dodge from bots that never jump; 'charges' and 'cooldown' from the engine come with a
 * `correct` the bot counts as a correction, since the room's own check let the dodge through.)
 */
const RACY_ROLLBACKS = ['busy'];
/** Charged Shot slows to this from its press until it is released (the server: 0.4 from 0.25 s in). */
const CHARGE_WALK_SCALE = 0.4;
/** A dodge with no answer after this long is given up (the server resyncs a lost one after 1 s). */
const DODGE_WAIT_MS = 1500;
/**
 * How many adventurers a bot lets fight one enemy (one elite) before it looks for another. (Was 2 in
 * Plan 3: with the jobs' traits, two Warriors kill a camp so fast that 60 s saw only 18-22 dodges
 * against the gate of 20; one each gives 23-31, and the 120 s cycle still passes.)
 */
const FIGHTERS_PER_ENEMY_PLAN3 = 1;
const FIGHTERS_PER_ELITE_PLAN3 = 1;
// --jobs mixed
/**
 * With --jobs mixed, camps are fought by several adventurers again (two duos on an ordinary enemy, one
 * duo on an elite), so shared kill credit, threat from several attackers, ally heals and cross-job
 * reactions all run under load.
 */
const FIGHTERS_PER_ENEMY_MIXED = 2;
const FIGHTERS_PER_ELITE_MIXED = 2;
/**
 * The mixed run's pass marks, on top of the fight run's (measured, with headroom: see docs/load-test.md).
 * dodges replaces FIGHT_MIN.dodges (multi-fighter camps kill faster, so fewer telegraphs come out).
 * reactions: in all (scaled, see perRun); with --cycle, of at least reactionKinds kinds (ruling P3b-j: every kind is
 * shown by the party runs instead, PARTY_MIN; revives by the Warden runs).
 */
const MIXED_MIN = { dodges: 20, casts: 50, reactions: 5, reactionKinds: 2 };
/**
 * --dungeon: the party bots' pass marks over the run (ruling P3b-j: every reaction kind shows up in parties). Revives are
 * not gated here: careful parties at the packs rarely lose anyone in 240 s (0–1 deaths inside a run); the scripted Warden
 * runs and the live checks show them (docs/load-test.md).
 */
const PARTY_MIN = { reactionKinds: 4 };
/**
 * MIXED_MIN's dodges, casts and reactions are per 95 s of fighting, which a 120 s run gives: the bots first spend
 * about MIXED_WALK_S getting their jobs at the Guild Board and walking to the Greenway. Scaled to --seconds by that.
 */
const MIXED_WALK_S = 25;
const perRun = (n: number) => Math.ceil((n * Math.max(0, seconds - MIXED_WALK_S)) / (120 - MIXED_WALK_S));
/**
 * With --jobs mixed three careless hunters with a medic share the farther Mossback: a Dark Knight and a Warrior
 * (picks with no heal, shield or evasion: they hold it in its Ground Slams and fall) and a Black Mage (Stormcage and
 * Rootbreak: its lightning on the Soaked Mossback is Conduct). Each is followed by a White Mage with Second Dawn, its
 * medic (hunter -> medic), which only soaks the hunter's target with Tidelash and revives it. Hunters, medics and
 * their duo partners fight without a partner of their own.
 */
const MIXED_MEDICS: Record<number, number> = { 3: 5, 7: 19, 27: 26 };
/**
 * Two more hunters, with no medic, only auto-attack (as a player who never presses a button: no skills, no dodges),
 * at the nearer Mossback, one at a time: a Dark Knight and a Warrior, whose deaths end in the respawn and the walk back.
 */
const AUTO_ONLY_HUNTERS = [31, 35];
const MIXED_HUNTERS = [...new Set([...Object.keys(MIXED_MEDICS).map(Number), ...AUTO_ONLY_HUNTERS])];
/**
 * The Greenway has two Mossbacks (90 s respawn): with --jobs mixed each hunter keeps to one camp (by the camp's index in
 * greenwayLayout): the auto-only hunters to the nearer (their respawn and walk back must fit in a 120 s run), one at
 * a time (the one with no medic, which falls and walks back); the hunters with a medic to the farther, together.
 */
const HUNTER_CAMP: Record<number, number> = { 3: 4, 7: 4, 27: 4, 31: 5, 35: 5 };
/**
 * A hunter's picks with --jobs mixed: no heal, shield or evasion of its own (glass cannons), so that careless solo
 * fights at a Mossback end in deaths often enough for the revive and the respawn cycle to be exercised.
 */
const HUNTER_PICKS: Partial<Record<JobId, readonly [AbilityId, AbilityId]>> = {
  dark_knight: ['dread_howl', 'umbral_brand'], warrior: ['rallying_roar', 'skullringer'], ninja: ['weak_point', 'quickstep'],
  black_mage: ['stormcage', 'rootbreak'],
};
/** A dead hunter whose medic (Second Dawn ready) is within ALLY_VIEW_R waits this long for a revive before it asks to respawn (ms). */
const REVIVE_WAIT_MS = 20_000;
/** A medic keeps within this of its hunter (Second Dawn reaches 12 m), in m. */
const MEDIC_FOLLOW_M = 8;
/** A follower (the odd bot of a duo) with nothing to fight walks to its leader once it is farther than this, in m. */
const DUO_FOLLOW_M = 6;
/** Path search settings for a bot's walks (camps, the grove's east gate): coarse, so cheap. */
const PATH_OPTS = { cell: 1, maxNodes: 60_000 };
/** Clearance kept from walls on a walk (as the browser's tap-to-walk). */
const PATH_CLEARANCE = 0.3;
/**
 * With nothing to fight, a bot waits CAMP_WAIT_MS at a spot this far outside a camp's edge, then moves
 * on; a camp it left is not walked to again for CAMP_REVISIT_MS.
 */
const CAMP_STANDOFF_M = 4;
const CAMP_WAIT_MS = 20_000;
const CAMP_REVISIT_MS = 30_000;
/** Ticks without a sendable step toward its goal before a bot searches a path around what blocks it. */
const STUCK_TICKS = 8;
/** A bot that died must have come this much nearer the Greenway in the last PROGRESS_MS to count as on its way. */
const PROGRESS_MS = 10_000;

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:2570' },
    count: { type: 'string', default: '100' },
    seconds: { type: 'string', default: '60' },
    stand: { type: 'boolean', default: false },
    zone: { type: 'string', default: 'grove' },
    warmup: { type: 'string', default: '2' },
    cluster: { type: 'string' },
    fight: { type: 'boolean', default: false },
    cycle: { type: 'boolean', default: false },
    jobs: { type: 'string' },
    assist: { type: 'string' },
    dungeon: { type: 'string' },
    warden: { type: 'string' },
    join: { type: 'string' },
    skill: { type: 'string' },
    looks: { type: 'boolean', default: false },
    gear: { type: 'boolean', default: false },
    quest: { type: 'boolean', default: false },
    parties: { type: 'boolean', default: false },
  },
});
// --quest with --fight: quest followers (they walk, talk, jump and fight in the Greenway as their steps need); --quest alone:
// walkers (or --cluster walkers) that carry quest state (their views) and do a step only where they happen to stand
// (talk, use, a hop): the walkers' bandwidth with quests on.
if (values.gear && !(values.fight || values.cycle)) {
  console.error('--gear runs with --fight (or --cycle, or --quest)');
  process.exit(2);
}
if (values.jobs !== undefined && (values.jobs !== 'mixed' || !(values.fight || values.cycle))) {
  console.error('--jobs takes only "mixed", and only with --fight (or --cycle)');
  process.exit(2);
}
/**
 * --assist <name> (for the browser smoke test): two bots, a Black Mage and a White Mage with Second Dawn, take their
 * jobs in the grove, then stay by the adventurer called <name>, fight its target and revive it when it falls. They print
 * `assist: ready` once both are by it, and `assist: <fx>` for each reaction and revive they see. No pass marks: it runs
 * for --seconds, or until it is stopped.
 */
const assist = values.assist ?? null;
/** --assist: `hold` on stdin makes the helpers stop fighting (they only follow and revive), `fight` lets them fight again. */
let assistHold = false;
if (assist !== null) { values.fight = true; values.jobs = 'mixed'; values.count = '2'; values.warmup = '0'; }

// ───────── parties (--dungeon, --warden) ─────────
/** A party the bots form: its members (bot indices, the leader first), each member's job, how well they play. */
interface PartyPlan { k: number; members: number[]; jobs: JobId[]; skill: Skill; careless: number[]; leaderName?: string; kit?: WardenKit }
/** --warden: the kit a party fights in (the server's SG2_TEST_KIT gives every new adventurer one tier: one tier a server). */
type WardenKit = 'starter' | 't1' | 't2' | 't3';
const WARDEN_KITS: readonly WardenKit[] = ['starter', 't1', 't2', 't3'];
const SKILLS: readonly Skill[] = ['careful', 'skilled', 'sloppy', 'careless'];
/** --dungeon: party sizes cycle through these. */
const DUNGEON_SIZES = [4, 3, 2];
const dungeonN = values.dungeon === undefined ? 0 : Number(values.dungeon);
const wardenMode = values.warden !== undefined;
const partyPlans: PartyPlan[] = [];
if (values.dungeon !== undefined) {
  if (!Number.isInteger(dungeonN) || dungeonN < 1 || !(values.fight || values.cycle) || wardenMode) {
    console.error('--dungeon <n> takes a whole number of parties >= 1, and only with --fight (not with --warden)');
    process.exit(2);
  }
  let at = 0;
  for (let k = 0; k < dungeonN; k++) {
    const size = DUNGEON_SIZES[k % DUNGEON_SIZES.length];
    const members = Array.from({ length: size }, (_, j) => at + j);
    const jobs = members.map((i) => JOB_IDS[i % JOB_IDS.length]);
    // a party with a White Mage has one careless member (no dodges), so that the White Mage has someone to revive
    const careless = jobs.includes('white_mage') ? [members[jobs.findIndex((j) => j !== 'white_mage')]] : [];
    partyPlans.push({ k, members, jobs, skill: 'careful', careless });
    at += size;
  }
}
if (wardenMode) {
  // `job+job…:skill`, comma separated: each a party that walks from the landing into the Lens Pit
  let at = 0;
  for (const [k, part0] of values.warden!.split(',').entries()) {
    const [part, kitText = 'starter'] = part0.trim().split('@');
    const kit = kitText.trim() as WardenKit;
    if (!WARDEN_KITS.includes(kit)) { console.error(`--warden: "${part0}" has kit "${kitText}" (kits ${WARDEN_KITS.join(', ')})`); process.exit(2); }
    const [jobsText, skillText = 'careful'] = part.trim().split(':');
    const jobs = jobsText.split('+').map((j) => j.trim()) as JobId[];
    const skill = skillText.trim() as Skill;
    if (jobs.length < 1 || jobs.length > PARTY_MAX || !jobs.every((j) => JOB_IDS.includes(j)) || !SKILLS.includes(skill)) {
      console.error(`--warden: "${part}" is not job+job…:skill (jobs ${JOB_IDS.join(', ')}; skills ${SKILLS.join(', ')}; at most ${PARTY_MAX} jobs)`);
      process.exit(2);
    }
    partyPlans.push({ k, members: jobs.map((_, j) => at + j), jobs, skill, careless: [], kit });
    at += jobs.length;
  }
  values.fight = true; values.count = String(at); values.warmup = '0';
  if (new Set(partyPlans.map((p) => p.kit)).size > 1) console.log('--warden: the parties name different kits; the server gives one (SG2_TEST_KIT): each party\'s worn tier is printed beside its outcome');
}
/**
 * --join <name> (for the party smoke test, a server with SG2_START_AT=lampfall-mouth): --count bots (1–3: a White Mage
 * with Second Dawn, a Black Mage, a Warrior) accept the invites of the adventurer called <name>, walk into the crater mouth
 * once it is inside, take their jobs at the Crater Rim's (or the landing's) sanctuary and run the Lampfall with it at
 * --skill (careful by default), as the party bots do. `hold` on stdin makes them stand once inside (they still fight
 * back and revive), `go` lets them carry on. They print `join: names <a>,<b>`, then `join: <event>` lines. No pass marks.
 */
const joinName = values.join ?? null;
if (joinName !== null) {
  if (wardenMode || values.dungeon !== undefined || assist !== null) { console.error('--join goes alone (not with --warden, --dungeon or --assist)'); process.exit(2); }
  const n = Number(values.count === '100' ? '2' : values.count);
  const skill = (values.skill ?? 'careful') as Skill;
  if (!(n >= 1 && n <= PARTY_MAX - 1) || !SKILLS.includes(skill)) { console.error(`--join takes --count 1..${PARTY_MAX - 1} and --skill ${SKILLS.join('|')}`); process.exit(2); }
  const jobs = (['white_mage', 'black_mage', 'warrior'] as JobId[]).slice(0, n);
  partyPlans.push({ k: 0, members: jobs.map((_, j) => j), jobs, skill, careless: [], leaderName: joinName });
  values.fight = true; values.count = String(n); values.warmup = '0';
}
/** Bots in parties (the first ones). */
const PARTY_BOTS = partyPlans.reduce((n, p) => n + p.members.length, 0);
const mixed = values.jobs === 'mixed';
const FIGHTERS_PER_ENEMY = mixed ? FIGHTERS_PER_ENEMY_MIXED : FIGHTERS_PER_ENEMY_PLAN3;
const FIGHTERS_PER_ELITE = mixed ? FIGHTERS_PER_ELITE_MIXED : FIGHTERS_PER_ELITE_PLAN3;
const HUNTERS = mixed ? MIXED_HUNTERS : ELITE_HUNTERS;
if (!isZoneId(values.zone)) {
  console.error('--zone must be grove or greenway');
  process.exit(2);
}
const zoneId: ZoneId = values.zone;
const stand = values.stand;
const fight = values.fight || values.cycle;
const cycle = values.cycle;
const url = values.url.replace(/\/$/, '');
const count = Number(values.count);
const seconds = Number(values.seconds);
const warmupMs = Number(values.warmup) * 1000;
const cluster = values.cluster === undefined ? Infinity : Number(values.cluster);
if (!Number.isInteger(count) || count < 1 || !(seconds > 0) || !(warmupMs >= 0) || !(cluster > 0) || (fight && stand)) {
  console.error('Usage: npm run bots -w server -- --url <server> --count <n> --seconds <s> [--warmup <s>] [--cluster <m>] [--stand | --fight [--cycle]]');
  process.exit(2);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Health {
  players: number;
  tickHz: number;
  rssMb: number;
  peakRssMb: number;
  /** The server process's event-loop delay p99 over its last 5 s window (ms). */
  eventLoopP99Ms?: number;
  zones?: Record<string, { players: number; tickHz: number; tickMs?: number; patchMs?: number }>;
  /** Lampfall instances: open now, adventurers inside, the worst instance's step p95 (ms). */
  instances?: { open: number; players: number; tickMsP95Max: number };
  /** Plan 5: inventory (and quest) writes a second over the last window. */
  invWritesPerS?: number;
}

async function health(): Promise<Health> {
  const res = await fetch(`${url}/healthz`);
  if (!res.ok) throw new Error(`/healthz answered ${res.status}`);
  return (await res.json()) as Health;
}

/**
 * stepBody over any dt. One stepBody call simulates at most 0.25 s, so a timer that fires late (a busy
 * process) used to leave the body behind the clock: its jump arc then ran late against the server's
 * wall-clock ceiling and a legal pose was corrected. This steps the whole gap, in pieces. A jump is
 * pressed now, at the end of the gap (the last 1/TICK_HZ of it): the server takes an air phase to have
 * begun at most one send interval before its first pose in the air, so a take-off at the start of a long
 * gap would put the body further along its arc than the server's ceiling allows.
 */
function stepFor(b: Body, input: BodyInput, dt: number, surface: Surface): BodyStep {
  const out: BodyStep = { landed: false, drop: 0, jumped: false };
  let left = Math.min(Math.max(dt, 0), 5);
  const jumpAt = input.jump ? Math.min(left, 1 / TICK_HZ) : 0; // time left when the jump is pressed
  let jumpDone = !input.jump;
  while (left > 1e-9) {
    let h = Math.min(left, BODY_STEP_MAX_S);
    if (!jumpDone && left - h < jumpAt - 1e-9 && left > jumpAt + 1e-9) h = left - jumpAt; // stop where the jump is pressed
    const jump = !jumpDone && left <= jumpAt + 1e-9;
    if (jump) jumpDone = true;
    const s = stepBody(b, { ...input, jump }, h, surface);
    if (s.jumped) out.jumped = true;
    if (s.landed) { out.landed = true; out.drop = Math.max(out.drop, s.drop); }
    left -= h;
  }
  return out;
}

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);


/** Where an adventurer may walk in a zone, with the tap-to-walk clearance (built once per zone). */
const walkable = new Map<string, (x: number, z: number) => boolean>();
/** In the Lampfall, by the shut lamp-gates (`gates`, the state's bits): a shut gate is a wall. */
function passableIn(zone: ZoneId, gates = 0) {
  const key = `${zone}:${gates}`;
  let p = walkable.get(key);
  if (!p) {
    const ground = zone === 'lampfall' ? gatedSurface(zoneDef(zone).ground, () => gates) : zoneDef(zone).ground;
    p = withClearance((x, z) => ground(x, z) !== null, PATH_CLEARANCE);
    walkable.set(key, p);
  }
  return p;
}

/** The hunters' adventurers (`zone:eid`), so other bots leave the elite a hunter is on alone. */
const hunterEids = new Set<string>();

/** Every enemy any bot has seen (engine id → kind), and enemy deaths seen in fx (deduplicated across bots). */
const enemyKinds = new Map<number, string>();
const enemyDeathAt = new Map<number, number>();
let enemyDeaths = 0;
/** Kill credits by enemy kind. */
const killsByKind: Record<string, number> = {};
/** --jobs mixed, counted by each bot from its own events (fx it caused, messages to it), so nothing twice. */
const mixedStats = {
  switches: 0, notHere: 0, casts: 0, castBreaks: {} as Record<string, number>, reactions: {} as Record<string, number>,
  revives: 0, revivedMsgs: 0, allyHeals: 0, allyHealHp: 0, selfHeals: 0, allyShields: 0, gifts: 0,
  killsByJob: {} as Record<string, number>, xpByJob: {} as Record<string, number>, abilityAlly: 0,
};
const bump = (r: Record<string, number>, k: string, n = 1) => { r[k] = (r[k] ?? 0) + n; };

// --dungeon, --warden
/** A leader re-invites members not yet in its party this often (3 members: 9 invites a minute, under PARTY_INVITES_PER_MIN). */
const INVITE_RETRY_MS = 20_000;
/** The leader's party chat line inside, this often (it starts with PARTY_CHAT_TAG, so receipts are told apart). */
const PARTY_CHAT_EVERY_MS = 15_000;
const PARTY_CHAT_TAG = 'pc ';
/** The gather spot before a room: this far back along its entry corridor from the room's edge (outside its gate circle). */
const GATHER_BACK_M = 8;
/** At the gather spot: within this, in m; a party waits at most GATHER_WAIT_MS for a member that does not come. */
const GATHER_R = 4;
const GATHER_WAIT_MS = 30_000;
/** Every instance kills its first pack within this of its first member's arrival (s). */
const FIRST_PACK_S = 150;
/** Each instance's step p95 (ms): the Global Constraints. */
const MAX_INSTANCE_STEP_P95_MS = 3;
/** --warden: the patch rate and the event-loop delay p99 the server must keep (twelve scripted Warden fights at once). */
const WARDEN_MIN_HZ = 14.5;
const WARDEN_MAX_LOOP_P99_MS = 50;
const partyStats = {
  formed: 0, invitesSent: 0, accepts: 0, refused: {} as Record<string, number>, notices: {} as Record<string, number>,
  inCombatRefusals: 0, chatSent: 0, chatExpected: 0, chatGot: 0, releasesSent: 0, releases: 0, revivedMsgs: 0,
  victories: {} as Record<string, number>, reactions: {} as Record<string, number>, revives: 0, interrupts: 0, breaks: 0,
};
/** Parties whose leader saw them whole, and parties told the Lampfall is full. */
const formedPlans = new Set<number>();
const fullPlans = new Set<number>();
/** Each instance a party entered (by room id): when its first member arrived, what it cleared and when, its wipes. */
interface InstanceRec { roomId: string; k: number; enteredAt: number; firstPackAt: number | null; cleared: Set<string>; wipes: number; lastWipeAt: number }
const instanceRecs = new Map<string, InstanceRec>();
function instanceRec(roomId: string, k: number): InstanceRec {
  let rec = instanceRecs.get(roomId);
  if (!rec) instanceRecs.set(roomId, (rec = { roomId, k, enteredAt: performance.now(), firstPackAt: null, cleared: new Set(), wipes: 0, lastWipeAt: -Infinity }));
  return rec;
}
/** An `instance` message to a member: its cleared encounters and wipes (each counted once per instance). */
function noteInstance(roomId: string, plan: PartyPlan, m: InstanceView) {
  const rec = instanceRec(roomId, plan.k), now = performance.now();
  for (const c of m.cleared) {
    if (rec.cleared.has(c)) continue;
    rec.cleared.add(c);
    if (c === 'root_cellar') rec.firstPackAt ??= now;
  }
  if (m.wipeIn !== null && now - rec.lastWipeAt > (WIPE_DELAY_S + 5) * 1000) { rec.wipes++; rec.lastWipeAt = now; }
}
/** A scripted Warden run, per party. */
interface WardenRec {
  plan: PartyPlan; outcome: 'kill' | 'wipe' | 'time'; done: boolean; reachedPit: boolean;
  wakeAt: number | null; endAt: number | null; phase: number; enraged: boolean; interrupts: number; breaks: number;
}
const wardenRecs = new Map<number, WardenRec>();
const PACKS = ['root_cellar', 'brass_gallery', 'cog_hall'];
/** Where a party gathers before the crater mouth (on the road, 10 m short of it). */
let mouthSpot: Vec2 | null = null;
function mouthGather(): Vec2 {
  if (mouthSpot) return mouthSpot;
  const pass = passableIn('greenway');
  const back = { x: LAMPFALL_MOUTH.x - 10, z: LAMPFALL_MOUTH.z };
  return (mouthSpot = pass(back.x, back.z) ? back : { x: LAMPFALL_MOUTH.arrive.x, z: LAMPFALL_MOUTH.arrive.z });
}
/** A Lampfall room's encounter (the recipe's), if it has one. */
function encounterOf(room: DungeonRoom): string | undefined {
  return lampfallLayout().recipe.rooms.find((r) => r.id === room.id)?.encounter;
}
function nearestOf<T extends { x: number; z: number }>(list: readonly T[], p: { x: number; z: number }): T | undefined {
  let best: T | undefined, bestD = Infinity;
  for (const q of list) { const d = dist(q, p); if (d < bestD) { best = q; bestD = d; } }
  return best;
}
/** The most enemies one bot's state held at once. */
let mostEnemiesInView = 0;
/** `self` messages without the job fields the server always sends (job, dodgeMax, cast). */
let selfFieldsMissing = 0;

/** The Greenway camps with an elite. */
let eliteCampList: number[] | null = null;
function eliteCamps(): number[] {
  return (eliteCampList ??= greenwayLayout().camps.flatMap((c, k) => (c.spawns.some((sp) => ENEMY_KINDS[sp.kind].elite) ? [k] : [])));
}

/** The shared Shape of a telegraph in the state (as the browser builds it). */
function telegraphShape(t: { shape: string; x: number; z: number; dir: number; r: number; width: number; angle: number; inner?: number }): Shape {
  if (t.shape === 'ring') return { kind: 'ring', x: t.x, z: t.z, dir: 0, inner: t.inner ?? 0, r: t.r };
  if (t.shape === 'cone') return { kind: 'cone', x: t.x, z: t.z, dir: t.dir, r: t.r, angle: t.angle };
  if (t.shape === 'line') return { kind: 'line', x: t.x, z: t.z, dir: t.dir, length: t.r, width: t.width };
  return { kind: 'circle', x: t.x, z: t.z, r: t.r };
}

/** The enemy with engine id `eid` in a room's state (its view), if it holds it. */
function findEnemy(room: Room<any, any>, eid: number): any {
  let found: any = null;
  room.state.enemies?.forEach((e: any) => { if (e.eid === eid) found = e; });
  return found;
}

// ───────── --looks, --gear, --quest (Plans 5 and 6) ─────────
const looksMode = values.looks;
const gearMode = values.gear;
const questMode = values.quest;
/** --parties (walkers): bots in parties of four (bot 4k invites the next three; they accept), for the party status lines' bandwidth. */
const walkParties = values.parties;
/** A random client operation id (OP_ID: 12–40 of A–Z a–z 0–9 _ -), new for every operation. */
const newOpId = () => randomBytes(15).toString('base64url');
/** --gear: every this long, a fighting bot (out of combat) takes a worn piece off and puts it on again. */
const GEAR_SWAP_MS = 60_000;
/** An operation or quest act with no answer is sent again (the same op id: a dup is answered with the truth) after this. */
const OP_RETRY_MS = 5000;
const QUEST_RETRY_MS = 3000;
/** The cheapest Tailor costume a --gear bot buys when it can (and wears). */
const BOT_COSTUME: CostumeId = 'straw_sunhat';
/** --quest: a duo leader gives up on its party kill (and skips the optional step) after this long at the step. */
const DUO_WAIT_MS = 60_000;
/** --quest: a fighting step whose acts are still missing after this long gets a nudge (a dodge in a fight, a finisher). */
const NUDGE_AFTER_MS = 30_000;
/** Refusals that are no failure: 'combat' and 'busy' (the bots try out of combat; a fight can start meanwhile). */
const GEAR_OK_REFUSALS = ['combat', 'busy'];
/** questRefused reasons that are no failure: a bot that raced its own walk, a busy moment, a full bag. */
const QUEST_OK_REFUSALS = ['where', 'busy', 'bag-full'];
const MAX_INV_WRITES_P95 = 40;
const gearStats = {
  purchases: 0, costumes: 0, wears: 0, sales: 0, equips: 0, unequips: 0, swaps: 0, talents: 0, drops: 0, lootGold: 0, saleGold: 0,
  refused: {} as Record<string, number>, gearCodeChanges: 0,
};
const questStats = { acts: 0, done: 0, scenes: {} as Record<string, number>, refused: {} as Record<string, number>, completed: {} as Record<string, number>, gold: 0, items: 0, nudges: 0, invites: 0, pickSwaps: 0 };
/** Where a bot stands to use a stall (in front of its booth, on walkable ground). */
function stallSpot(id: StallId): Vec2 {
  const s = TOWN_STALLS[id];
  const pass = passableIn('grove');
  for (const k of [1.6, 1.2, 2.2, 0.8, 0]) {
    const p = { x: s.x + Math.sin(s.facing) * k, z: s.z + Math.cos(s.facing) * k };
    if (pass(p.x, p.z)) return p;
  }
  return { x: s.x, z: s.z };
}

class Bot {
  room!: Room<any, any>;
  name = '';
  private token = '';
  /** Patches received while measuring (null: not measuring). */
  patches: number | null = null;
  corrections = 0;
  /** The first few corrections: what the bot last sent, and where the server put it. */
  correctionLog: string[] = [];
  jumps = 0;
  /** Health lost to falls, and how many falls cost any. */
  hurtHp = 0;
  hurts = 0;
  /** Ticks on which no step it tried would be accepted (it sent its first try anyway, as a client would). */
  stalledTicks = 0;
  /** Of those, ticks it was in the air: its check and the server's disagree with its own controller. */
  airStalls = 0;
  /** Longest run of stalled ticks in a row. */
  longestStall = 0;
  private stallRun = 0;
  private lastSent: unknown = null;
  /** The first stall in the air, in full: the body, the mirrored air track and why each try was refused. */
  airStallLog: string | null = null;
  private lastStepAt = 0;
  chatsHeard = 0;
  disconnected: string | null = null;
  /** Bytes received while measuring (patches and messages). */
  bytes = 0;
  displacements = 0;
  deaths = 0;
  /** Sent on to another zone (a respawn from the Greenway): not a failure. Without --fight it then stops. */
  travelled = false;
  zone: ZoneId = 'grove';
  private surface: Surface = zoneDef('grove').surface;
  /** The last displacement the server numbered: every pose carries it. */
  private ack = 0;
  private body: Body = makeBody(0, 0, this.surface);
  get position(): { x: number; z: number } { return this.body; }
  /** The server's view of this bot's height, so it only sends poses the server accepts. */
  private air: AirTrack = makeAirTrack(0);
  private heading = Math.random() * 2 * Math.PI;
  /** Where it joined: with --cluster it stays within that many metres of here. */
  private home = { x: 0, z: 0 };
  /** Sum and count of samples of how many adventurers its state held (its view), and of the online count. */
  viewSum = 0;
  onlineSum = 0;
  viewSamples = 0;
  private timers: NodeJS.Timeout[] = [];

  // --fight
  readonly careful: boolean;
  /** Sent solo at a Mossback (see ELITE_HUNTERS): it fights only an elite, and enemies that attack it. */
  readonly hunter: boolean;
  /** Times it was back in the Greenway after a death. */
  returned = 0;
  /** Times it was revived where it fell (Second Dawn) after a death. */
  revivedBack = 0;
  private memory: BrainMemory = newBrainMemory();
  private selfView: SelfView | null = null;
  private selfAt = 0;
  /** The target last sent (the state's lags a round trip behind). */
  private sentTarget: number | null = null;
  /** When it last pressed an ability (the GCD it starts is assumed until `self` shows it), and Charged Shot. */
  private pressedAt = -Infinity;
  private chargeSince: number | null = null;
  /** When it last sent a release: the charge counts as gone until a `self` sent after it arrives. */
  private releasedAt = -Infinity;
  /** What its last fight step walked at (for the correction log). */
  private lastScale = '';
  /** A dodge sent and not answered yet: no poses until its `displaced` or `refused`. */
  private dodgeSentAt: number | null = null;
  /** Playing a displacement out until then (performance.now ms): no poses. */
  private busyUntil = 0;
  /** A dodge the engine refused after taking its pose: the `correct` that follows is the rollback. */
  private rollbackDue = false;
  /** Not moving before this (a new session's movement allowance is still filling). */
  private settleUntil = 0;
  /** When each telegraph and each enemy's wind-up was first seen (performance.now ms), for `left`. */
  private telegraphSeen = new Map<number, number>();
  private windupSeen = new Map<number, { attack: string; at: number }>();
  /** The walk it is on (waypoints, the next one first) and where to. */
  private route: { goal: Vec2; points: Vec2[] } | null = null;
  private stuckTicks = 0;
  /** Camps visited (index → when), so a cleared camp is left alone until it can respawn. */
  private campVisited = new Map<number, number>();
  private campGoal: number | null = null;
  private campSpot: Vec2 | null = null;
  private campWaitFrom: number | null = null;
  /** Between rooms: the zone it is travelling to (it joins that room once this one has ended). */
  private switchingTo: ZoneId | null = null;
  private deadSince: number | null = null;
  private respawnAskedAt = 0;
  /** While it is on its way back after a death: when it was nearest the Greenway, and that progress. */
  diedAt: number | null = null;
  progressAt = 0;
  private bestProgress = Infinity;
  kills = 0;
  /** Telegraphs it stood inside at some tick. */
  inside = new Set<number>();
  dodgesSent = 0;
  dodgesRolled = 0;
  knocks = 0;
  resyncs = 0;
  rollbacks = 0;
  travels = 0;
  /** Displacements whose end the bot's own simulateDisplacement put more than 1 cm from the server's. */
  displaceMismatch = 0;
  refusals: Record<string, number> = {};
  fxEvents = 0;
  hpSeenMin = Infinity;

  /** Walks at the browser's full speed and has Sprint (SPRINTER). */
  readonly sprinter: boolean;
  /** Predicts its rolls, sees its displacements late and rolls twice (PREDICTOR). */
  readonly predictor: boolean;
  /** The job and picks it fights with (changed in the grove: see the file comment). */
  private loadout: Loadout;
  /** The job and picks the server last said it has (its `jobs`), and when it last asked for its own. */
  private jobNow: Loadout = NEW_LOADOUT;
  private jobAskedAt = -Infinity;
  /** It runs the job and picks it fights with. */
  private get jobReady(): boolean {
    return this.jobNow.job === this.loadout.job && this.jobNow.picks[0] === this.loadout.picks[0] && this.jobNow.picks[1] === this.loadout.picks[1]
      && (!(mixed || this.plan) || this.switchCounted); // mixed and party bots: every bot asks for its job, its own included
  }
  /** Sprinting (by the browser's rule: from Sprint's `use` fx) until then (performance.now ms). */
  private sprintUntil = -Infinity;
  /** A predictor's rolls sent and not answered yet, oldest first: where each went from and its predicted end. */
  private predictions: { from: { x: number; z: number; y: number }; end: { x: number; z: number; y: number }; early: boolean }[] = [];
  /** A predictor's second roll, due then (performance.now ms), in the first's direction. */
  private secondDodge: { at: number; dx: number; dz: number } | null = null;
  /** Second rolls sent before the first's `displaced` arrived (with the ack before it), and of those, rolled. */
  earlySent = 0;
  earlyRolled = 0;
  /** Sprints it used (by its `use` fx), and moves it sent while sprinting. */
  sprints = 0;
  sprintMoves = 0;
  /** What became of early second rolls that were not answered by their own `displaced` (for the log). */
  earlyLost: string[] = [];
  /** Early second rolls replaced by a knock or a respawn that the server sent first. */
  earlySuperseded = 0;
  /** Drops the outstanding predictions (the server's displacement or correction wins), noting lost early rolls. */
  private dropPredictions(why: string, superseded = false) {
    for (const p of this.predictions) {
      if (!p.early) continue;
      // a knock (or a respawn) the server sent before it answered the roll replaces it: no false refusal (counted apart)
      if (superseded) this.earlySuperseded++;
      else this.earlyLost.push(`${this.name}: ${why}`);
    }
    this.predictions = [];
    this.secondDodge = null;
  }
  /** Rollbacks (a `correct` right after an engine refusal of a dodge) by the refusal's reason. */
  rollbacksByReason: Record<string, number> = {};
  private rollbackReason = '';
  /** The first time it was stuck for TICK_HZ ticks: where, and where to. */
  stallLog: string | null = null;

  // --jobs mixed
  /** Its duo partner's index (index ^ 1), or null (none, or a hunter and its medic: see MIXED_HUNTERS). */
  readonly partner: number | null;
  /** The White Mage that follows a hunter to revive it (the hunter's index). */
  readonly medicOf: number | null;
  /** A White Mage leading a Black Mage: it picks the toughest enemy in reach rather than the nearest, and keeps its Soaked for its partner. */
  readonly toughFirst: boolean;
  /** It walked to the Guild Board, its job change was confirmed, its Greenway job change was refused. */
  private atBoard = false;
  private switchCounted = false;
  private notHereSent = false;
  private notHereCounted = false;
  /** --assist: in the Greenway with its job. */
  assistReady = false;
  /** When it pressed an ability with a cast (it walks at CAST_MOVE_SCALE until that cast ends). */
  private castSince: number | null = null;
  private castFor = 0;

  // --dungeon, --warden
  /** Its role index among the Greenway bots (index − PARTY_BOTS; negative for party bots). */
  readonly ri: number;
  /** The party it forms (null: a Greenway bot as in Plan 3b). */
  readonly plan: PartyPlan | null;
  /** Its party as the server last sent it, and the instance it is in (lampfall only). */
  partyView: PartyView | null = null;
  private instanceView: InstanceView | null = null;
  /** The instance room it is in ('' outside), and the one a `travel` sent it to. */
  roomId = '';
  private switchingInstance: string | null = null;
  /** Got REASON_INSTANCES_FULL at the mouth: it stays in the Greenway and fights there. */
  full = false;
  /** The last `correct` (performance.now ms): a mouth refusal's notice right after it means it was no correction. */
  private lastCorrectAt = -Infinity;
  /** The room (instance + room id) its party has the go for: it walks in from the gather spot. */
  private goRoom: string | null = null;
  private gatherSince: number | null = null;
  private releasePending = false;
  /** Deaths and revives inside the Lampfall (the Warden runs' table). */
  deathsInside = 0;
  revivedInside = 0;

  // --looks, --gear, --quest
  /** The look code and gear code the room sent for each engine id (its `looks` messages), this room only. */
  /** Its current job's level (from `jobs`). */
  level = 1;
  /** The zone it first joined. */
  startZone: ZoneId | null = null;
  seenLooks = new Map<number, string>();
  seenGear = new Map<number, string>();
  /** The last `inventory` view (kept across rooms), and the ledger checked against each new one. */
  inv: InventoryView | null = null;
  private ledgerLootGold = 0;
  private ledgerQuestGold = 0;
  private lootUids = new Set<number>();
  private questItems: string[] = [];
  private soldUids = new Set<number>();
  private unequipSent = false;
  private everUids = new Set<number>();
  /** Ledger mismatches (the first few in full), uids seen again after they went, resyncs after a travel (offline loot). */
  ledgerBad: string[] = [];
  uidRepeats = 0;
  ledgerResyncs = 0;
  private invSinceJoin = 0;
  /** --gear: what it shops for in the grove ('done': nothing more), the op in flight, the piece it bought. */
  private shop: 'smithy' | 'tailor' | 'done' = gearMode ? 'smithy' : 'done';
  private shopOp: { key: string; msg: Record<string, unknown>; at: number } | null = null;
  private boughtUid: number | null = null;
  private swapAt = 0;
  private opWaitUntil = 0;
  private talentRows: (0 | 1 | 2)[] = [];
  private talentAt = 0;
  /** --quest: the last `quests` view, the act in flight, quests it dropped, the fight it is on for a step. */
  quests: QuestsView | null = null;
  private questAct: { key: string; at: number } | null = null;
  private dropped: QuestId[] = [];
  private questKinds: readonly string[] | 'any' | null = null;
  private questFightSince: number | null = null;
  private questFightKey = '';
  private hopping = false;
  private lastHopAt = 0;
  private duoSince: number | null = null;
  private inviteAt = 0;
  /** --quest duo pairs: the leader (ri % 8 === 1) invites the next bot to a party at the optional duo step. */
  readonly questLead: boolean;
  readonly questFollow: boolean;
  get inParty(): boolean { return (this.partyView?.members.length ?? 0) >= 2; }

  constructor(readonly index: number) {
    // party bots come first (--dungeon, --warden); the Greenway bots' roles count from the first bot after them
    this.ri = index - PARTY_BOTS;
    this.plan = partyPlans.find((p) => p.members.includes(index)) ?? null;
    this.questLead = questMode && !this.plan && this.ri % 8 === 1 && index + 1 < count;
    this.questFollow = questMode && !this.plan && this.ri % 8 === 2;
    this.careful = this.plan ? this.plan.skill !== 'careless' && !this.plan.careless.includes(index) : this.ri % 4 !== 3;
    this.hunter = fight && !this.plan && HUNTERS.includes(this.ri);
    this.predictor = fight && !this.plan && this.ri % 5 === PREDICTOR;
    if (this.plan) {
      const job = this.plan.jobs[this.plan.members.indexOf(index)];
      const picks = this.plan.members.length > 1 ? JOBS[job].picks.duo : JOBS[job].picks.solo;
      this.sprinter = false; this.partner = null; this.medicOf = null; this.toughFirst = false;
      this.loadout = { job, picks: [picks[0], picks[1]] };
      return;
    }
    if (assist !== null) {
      const job: JobId = index === 0 ? 'black_mage' : 'white_mage';
      this.careful = true; this.hunter = false; this.predictor = false; this.sprinter = false;
      this.partner = null; this.medicOf = null; this.toughFirst = false;
      this.loadout = { job, picks: [JOBS[job].picks.duo[0], JOBS[job].picks.duo[1]] };
      return;
    }
    const ri = this.ri;
    if (mixed) {
      const job = JOB_IDS[ri % JOB_IDS.length];
      const hunted = MIXED_HUNTERS.find((h) => MIXED_MEDICS[h] === ri && h + PARTY_BOTS < count);
      this.medicOf = hunted === undefined ? null : hunted + PARTY_BOTS;
      const special = (k: number) => MIXED_HUNTERS.includes(k) || Object.values(MIXED_MEDICS).includes(k);
      this.partner = special(ri) || special(ri ^ 1) || (ri ^ 1) + PARTY_BOTS >= count ? null : (ri ^ 1) + PARTY_BOTS;
      this.sprinter = job === 'ranger' && ri % 5 === SPRINTER;
      const picks = this.sprinter ? SPRINTER_PICKS : this.hunter ? HUNTER_PICKS[job] ?? JOBS[job].picks.solo
        : this.partner !== null || this.medicOf !== null ? JOBS[job].picks.duo : JOBS[job].picks.solo;
      this.loadout = { job, picks: [picks[0], picks[1]] };
      this.toughFirst = job === 'white_mage' && this.partner !== null && JOB_IDS[(this.partner - PARTY_BOTS) % JOB_IDS.length] === 'black_mage';
      return;
    }
    this.partner = null;
    this.medicOf = null;
    this.toughFirst = false;
    this.sprinter = fight && ri % 5 === SPRINTER;
    this.loadout = this.sprinter ? { job: 'ranger', picks: SPRINTER_PICKS }
      : fight && ri % 4 === 1 ? { job: 'ranger', picks: [JOBS.ranger.picks.solo[0], JOBS.ranger.picks.solo[1]] } : NEW_LOADOUT;
  }

  /** The job it fights as (for kills and xp by job). */
  get job(): JobId { return this.jobNow.job; }
  /** The target it last sent (for its partner), and its engine id in its room. */
  get target(): number | null { return this.sentTarget; }
  get eid(): number | undefined { return this.room?.state.players?.get(this.room.sessionId)?.eid; }
  get isDead(): boolean { return this.room ? this.dead : false; }

  async join() {
    const res = await fetch(`${url}/api/guest`, { method: 'POST' });
    const body = (await res.json()) as { token?: string; name?: string; error?: string };
    if (!res.ok || !body.token) {
      const hint = res.status === 429 ? ' (start the server with a higher SG2_AUTH_RATE_PER_MIN)' : '';
      throw new Error(`guest login failed: ${res.status} ${body.error ?? ''}${hint}`);
    }
    this.name = body.name ?? `bot ${this.index}`;
    this.token = body.token;
    if (looksMode) {
      // the creator's one free visit, with a random look seeded by its index (a guest has no name to give)
      const look = randomLook(prng(this.index + 1));
      const r = await fetch(`${url}/api/look`, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ look }) });
      if (!r.ok) throw new Error(`POST /api/look failed: ${r.status} ${await r.text()}`);
    }
    await this.connect(fight ? await this.askZone() : zoneId);
  }

  /**
   * In a town: asks for its job and picks (saved with the adventurer, so they stay across travels),
   * again every JOB_RETRY_MS until `jobs` shows them.
   */
  private askJob(now: number) {
    if (this.jobReady || now - this.jobAskedAt < JOB_RETRY_MS) return;
    this.jobAskedAt = now;
    if (mixed || this.plan ? !this.switchCounted : this.jobNow.job !== this.loadout.job) this.room.send('job', { job: this.loadout.job });
    this.room.send('loadout', { picks: this.loadout.picks });
  }

  /** GET /api/zone: the room to join (60 a minute per account, so every bot asks for itself). */
  private async askZone(): Promise<ZoneId> {
    const res = await fetch(`${url}/api/zone`, { headers: { authorization: `Bearer ${this.token}` } });
    const body = (await res.json()) as { zone?: unknown; error?: string };
    if (!res.ok || !isZoneId(body.zone)) throw new Error(`GET /api/zone failed: ${res.status} ${body.error ?? ''}`);
    return body.zone;
  }

  /** Joins `zone`'s room and waits until this adventurer is in its state. */
  private async connect(zone: ZoneId, instance: string | null = null) {
    this.zone = zone;
    this.startZone ??= zone;
    // inside the Lampfall a shut lamp-gate is a wall, as the server's own surface has it (gatedSurface over the state's gates)
    this.surface = zone === 'lampfall' ? gatedSurface(zoneDef('lampfall').surface, () => (this.room?.state?.gates as number | undefined) ?? 0) : zoneDef(this.zone).surface;
    this.ack = 0; // each session numbers its displacements from 0
    const client = new Client(url);
    // a Lampfall instance is joined by its room id (the `travel` names it); every other zone by name
    const room = instance ? await client.joinById(instance, { token: this.token }) : await client.joinOrCreate(this.zone, { token: this.token });
    this.room = room;
    this.roomId = zone === 'lampfall' ? room.roomId : '';
    this.instanceView = null;
    if (zone === 'lampfall' && this.plan) instanceRec(room.roomId, this.plan.k);
    room.reconnection.enabled = false; // a drop is a failure, not something to ride out
    const connection = room.connection as unknown as { events: { onmessage?: (ev: { data: ArrayBuffer | string }) => void } };
    const onmessage = connection.events.onmessage;
    connection.events.onmessage = (ev) => {
      if (this.patches !== null) this.bytes += typeof ev.data === 'string' ? ev.data.length : ev.data.byteLength;
      onmessage?.(ev);
    };
    room.onMessage('*', () => {});
    room.onMessage('self', (m: S2C['self']) => { this.selfView = m; this.selfAt = performance.now(); });
    room.onMessage('jobs', (m: S2C['jobs']) => {
      this.jobNow = { job: m.current, picks: [m.jobs[m.current].picks[0], m.jobs[m.current].picks[1]] };
      this.level = m.jobs[m.current].level ?? this.level;
      // a job change it asked for (at the Guild Board), confirmed: counted once per bot
      if ((mixed || this.plan) && !this.switchCounted && this.jobAskedAt > -Infinity && m.current === this.loadout.job) { this.switchCounted = true; mixedStats.switches++; }
    });
    room.onMessage('fx', (m: S2C['fx']) => this.onFx(m));
    this.seenLooks = new Map();
    this.seenGear = new Map();
    this.invSinceJoin = 0;
    room.onMessage('looks', (m: S2C['looks']) => {
      for (const [eid, look, gearCode] of m.a) {
        const before = this.seenGear.get(eid);
        if (before !== undefined && before !== gearCode) gearStats.gearCodeChanges++;
        this.seenLooks.set(eid, look);
        this.seenGear.set(eid, gearCode);
      }
    });
    room.onMessage('loot', (m: S2C['loot']) => {
      gearStats.drops += m.items.length;
      gearStats.lootGold += m.gold + m.soldFor;
      this.ledgerLootGold += m.gold + m.soldFor;
      for (const it of m.items) this.lootUids.add(it.uid);
    });
    room.onMessage('inventory', (m: S2C['inventory']) => this.onInventory(m));
    room.onMessage('invRefused', (m: S2C['invRefused']) => {
      bump(gearStats.refused, `${m.op} ${m.reason}`);
      this.shopOp = null; // asked again later, with a new op id (the next inventory shows what is true)
      this.opWaitUntil = performance.now() + 2000;
    });
    room.onMessage('levelUp', (m: S2C['levelUp']) => { if (m.talentRow !== null && gearMode) this.talentRows.push(m.talentRow); });
    room.onMessage('quests', (m: S2C['quests']) => { this.quests = m; this.questAct = null; });
    room.onMessage('questDone', (m: S2C['questDone']) => {
      questStats.done++;
      if (m.scene) bump(questStats.scenes, m.scene);
      if (m.questDone) bump(questStats.completed, m.quest);
      questStats.gold += m.gold;
      this.ledgerQuestGold += m.gold;
      if (m.item) { questStats.items++; this.questItems.push(m.item); }
    });
    room.onMessage('questRefused', (m: S2C['questRefused']) => { bump(questStats.refused, `${m.act} ${m.reason}`); });
    room.onMessage('credit', (m: S2C['credit']) => {
      this.kills++;
      killsByKind[m.kind] = (killsByKind[m.kind] ?? 0) + 1;
      bump(mixedStats.killsByJob, this.jobNow.job);
    });
    room.onMessage('jobXp', (m: S2C['jobXp']) => bump(mixedStats.xpByJob, m.job, m.gained));
    room.onMessage('revived', () => {
      mixedStats.revivedMsgs++;
      if (this.zone === 'lampfall') { this.revivedInside++; partyStats.revivedMsgs++; }
      this.deadSince = null;
      if (this.diedAt !== null) { this.revivedBack++; this.diedAt = null; } // up again where it fell: not on its way back
    });
    // A predictor sees what moves it late (a slow downlink), all by the same lag, so in order.
    const lag = this.predictor ? predictorLagMs(this.index) : 0;
    const late = <T,>(fn: (m: T) => void) => (m: T) => {
      if (lag === 0) return fn(m);
      setTimeout(() => { if (this.room === room) fn(m); }, lag);
    };
    room.onMessage('refused', late((m: S2C['refused']) => this.onRefused(m)));
    const moved = (to: { x: number; z: number; y: number }, seq: number) => {
      this.ack = seq;
      this.body = makeBody(to.x, to.z, this.surface);
      this.body.y = to.y;
      this.air = makeAirTrack(to.y);
    };
    room.onMessage('displaced', late((m: S2C['displaced']) => {
      this.displacements++;
      if (m.kind === 'knock') this.knocks++;
      else if (m.kind === 'dodge') this.dodgesRolled++;
      else this.resyncs++;
      const predicted = m.kind === 'dodge' ? this.predictions.shift() : undefined;
      if (m.kind !== 'dodge') this.dropPredictions(`a ${m.kind} (seq ${m.seq}) came first`, m.kind === 'knock'); // the server's displacement wins
      if (predicted) {
        // its own roll, already played: only the ack changes, unless the server's end is elsewhere
        if (predicted.early) this.earlyRolled++;
        this.ack = m.seq;
        const off = dist(predicted.end, m.to) > 0.01 || Math.abs(predicted.end.y - m.to.y) > 0.01;
        if (off) this.displaceMismatch++;
        if (this.predictions.length === 0) {
          this.dodgeSentAt = null;
          if (off) moved(m.to, m.seq);
        }
        return;
      }
      moved(m.to, m.seq);
      this.dodgeSentAt = null;
      if (m.kind !== 'resync') {
        // Played out (no poses) for as long as the push and any fall take; the end is the server's.
        const sim = simulateDisplacement(m.from, m.d, this.surface);
        if (dist(sim, m.to) > 0.01 || Math.abs(sim.y - m.to.y) > 0.01) this.displaceMismatch++;
        this.busyUntil = performance.now() + sim.seconds * 1000;
      }
    }));
    room.onMessage('respawned', late((m: S2C['respawned']) => {
      this.dropPredictions('respawned', true);
      moved(m, m.seq);
      if (this.zone === 'lampfall') {
        // up at the checkpoint (a release, or everyone after a wipe): not on any way back; the party gathers again
        if (this.releasePending) partyStats.releases++;
        this.releasePending = false;
        this.diedAt = null;
        this.goRoom = null;
      }
    }));
    room.onMessage('travel', (m: S2C['travel']) => {
      if (!fight) { this.travelled = true; return; }
      this.switchingTo = m.zone;
      this.switchingInstance = m.instance ?? null;
      // The server ends the session itself; if it has not after 5 s, leave.
      this.timers.push(setTimeout(() => { if (this.room === room && this.switchingTo) void room.leave().catch(() => {}); }, 5000));
    });
    room.onMessage('correct', late((m: { x: number; z: number; y: number }) => {
      if (this.rollbackDue) {
        this.rollbackDue = false;
        this.rollbacks++;
        this.rollbacksByReason[this.rollbackReason] = (this.rollbacksByReason[this.rollbackReason] ?? 0) + 1;
      } else {
        this.corrections++;
        this.lastCorrectAt = performance.now();
        if (this.correctionLog.length < 5) this.correctionLog.push(`${this.name}: sent ${JSON.stringify(this.lastSent)}, corrected to ${JSON.stringify(m)}${fight ? ` (${this.lastScale})` : ''}`);
      }
      // go where the server says, standing, as the browser does
      this.dropPredictions(`corrected to ${JSON.stringify(m)}`);
      this.body = makeBody(m.x, m.z, this.surface);
      this.body.y = m.y;
      this.air = makeAirTrack(m.y);
    }));
    room.onMessage('hurt', (m: { amount: number }) => {
      this.hurts++;
      this.hurtHp += m.amount;
    });
    room.onMessage('chat', (m: S2C['chat']) => {
      this.chatsHeard++;
      if (m.channel === 'party' && m.from !== this.name && m.text.startsWith(PARTY_CHAT_TAG)) partyStats.chatGot++;
    });
    room.onMessage('party', (m: S2C['party']) => {
      this.partyView = m.party;
      const plan = this.plan;
      if (plan && plan.members[0] === this.index && m.party && m.party.members.length === plan.members.length && !formedPlans.has(plan.k)) {
        formedPlans.add(plan.k);
        partyStats.formed++;
      }
    });
    room.onMessage('partyInvite', (m: S2C['partyInvite']) => {
      // a member accepts its own leader's invite (and only that)
      const leader = this.plan?.leaderName ?? (this.plan && this.plan.members[0] !== this.index ? bots[this.plan.members[0]].name : null);
      if (walkParties && !this.plan && this.index % 4 !== 0 && m.from.toLowerCase() === bots[this.index - (this.index % 4)]?.name.toLowerCase()) {
        this.room.send('party', { op: 'accept', partyId: m.partyId });
        return;
      }
      if (this.questFollow && !this.plan && m.from.toLowerCase() === bots[this.index - 1]?.name.toLowerCase()) {
        this.room.send('party', { op: 'accept', partyId: m.partyId });
        return;
      }
      if (this.plan && leader !== null && m.from.toLowerCase() === leader.toLowerCase()) {
        if (joinName !== null) console.log(`join: accepted ${m.from}'s invite`);
        this.room.send('party', { op: 'accept', partyId: m.partyId });
        partyStats.accepts++;
      }
    });
    room.onMessage('partyRefused', (m: S2C['partyRefused']) => bump(partyStats.refused, m.reason));
    room.onMessage('instance', (m: S2C['instance']) => {
      this.instanceView = m;
      if (this.plan && this.zone === 'lampfall') {
        noteInstance(this.roomId, this.plan, m);
        // a wipe ends a Warden run (seen here too: dead members do not step)
        const rec = wardenRecs.get(this.plan.k);
        if (rec && !rec.done && rec.wakeAt !== null && m.wipeIn !== null) { rec.outcome = 'wipe'; rec.endAt = performance.now(); rec.done = true; }
      }
    });
    room.onMessage('victory', (m: S2C['victory']) => { if (this.plan) bump(partyStats.victories, m.boss); });
    room.onMessage('notice', (m: S2C['notice']) => {
      bump(partyStats.notices, m.text);
      // the mouth's refusals come as a `correct` and then this notice: the rule says so (no false correction)
      if ((m.text === REASON_INSTANCES_FULL || m.text === REASON_IN_COMBAT) && performance.now() - this.lastCorrectAt < 1000 && this.corrections > 0) {
        this.corrections--;
        this.correctionLog.pop();
        this.lastCorrectAt = -Infinity;
        if (m.text === REASON_INSTANCES_FULL && this.plan) {
          this.full = true;
          fullPlans.add(this.plan.k);
        } else partyStats.inCombatRefusals++;
      }
    });
    room.onMessage('kicked', (m: { reason: string }) => (this.disconnected ??= `kicked: ${m.reason}`));
    room.onDrop((code) => (this.disconnected ??= `dropped (code ${code})`));
    room.onLeave((code) => {
      if (this.room !== room) return;
      const next = this.switchingTo;
      if (next) {
        this.connect(next, this.switchingInstance).then(
          () => { this.switchingTo = null; this.travels++; },
          (err) => { this.disconnected ??= `could not join ${next}: ${err instanceof Error ? err.message : err}`; },
        );
        return;
      }
      if (!this.travelled) this.disconnected ??= `left (code ${code})`;
    });
    let wasDead = false;
    room.onStateChange(() => {
      if (this.patches !== null) this.patches++;
      const me = room.state.players?.get(room.sessionId);
      const dead = me?.dead === true;
      if (dead && !wasDead) {
        this.deaths++;
        if (this.zone === 'lampfall') this.deathsInside++;
        this.diedAt = performance.now();
        this.bestProgress = Infinity;
        this.progressAt = this.diedAt;
      }
      if (me && !dead) this.hpSeenMin = Math.min(this.hpSeenMin, me.hp);
      wasDead = dead;
    });
    const deadline = Date.now() + 10_000;
    let me;
    while (!(me = room.state.players?.get(room.sessionId))) {
      if (Date.now() > deadline) throw new Error(`${this.name} never appeared in the room`);
      await sleep(20);
    }
    // (Its start is read from the state: positions there are quantised, at most 0.8 cm from the server's.)
    this.body = makeBody(me.x, me.z, this.surface);
    this.air = makeAirTrack(this.body.y);
    this.home = { x: me.x, z: me.z };
    if (this.hunter) hunterEids.add(`${zone}:${me.eid}`);
    this.selfView = null;
    this.sentTarget = null;
    this.dodgeSentAt = null;
    this.busyUntil = 0;
    this.rollbackDue = false;
    this.predictions = [];
    this.secondDodge = null;
    this.sprintUntil = -Infinity;
    this.route = null;
    this.campGoal = null;
    this.deadSince = null;
    this.telegraphSeen.clear();
    this.windupSeen.clear();
    // a party bot plays at its party's skill (the simulation's: skilled and sloppy miss a seeded share of telegraphs)
    const slip = this.plan?.skill === 'sloppy' ? SLOPPY_MISS : this.plan?.skill === 'skilled' ? SKILLED_MISS : 0;
    this.memory = slip > 0 ? newBrainMemory(REACTION_S + Math.random() * 0.2, { rate: slip, seed: this.index * 104729 + 1 }) : newBrainMemory();
    this.castSince = null;
    this.settleUntil = performance.now() + SETTLE_MS;
    this.lastStepAt = 0;
    if (this.zone === 'greenway' && this.diedAt !== null) { this.returned++; this.diedAt = null; } // back where it fights
  }

  /** Samples how many adventurers its state holds (itself included) and the zone's online count. */
  sampleView() {
    const state = this.room.state;
    this.viewSum += state.players?.size ?? 0;
    this.onlineSum += typeof state.online === 'number' ? state.online : state.players?.size ?? 0;
    this.viewSamples++;
  }

  /** Between rooms (a travel): its room is ending or the next is being joined. */
  get switching(): boolean { return this.switchingTo !== null; }

  private get dead(): boolean {
    return this.room.state.players?.get(this.room.sessionId)?.dead === true;
  }

  start() {
    const tick = 1000 / TICK_HZ;
    // Random offsets, so the bots' messages are spread over the tick and the chat interval.
    this.timers.push(setTimeout(() => this.timers.push(setInterval(() => (fight ? this.fightStep() : this.step()), tick)), SETTLE_MS + Math.random() * tick));
    this.timers.push(
      setTimeout(() => {
        this.chat();
        this.timers.push(setInterval(() => this.chat(), CHAT_EVERY_MS));
      }, Math.random() * CHAT_EVERY_MS),
    );
    if (walkParties && !this.plan && this.index % 4 === 0) {
      // --parties: invite the next three (again every 20 s for anyone not in yet)
      const invite = () => {
        const inParty = new Set((this.partyView?.members ?? []).map((m) => m.name));
        for (let j = 1; j < 4; j++) {
          const mate = bots[this.index + j];
          if (mate?.name && !inParty.has(mate.name) && !this.disconnected) this.room.send('party', { op: 'invite', name: mate.name });
        }
      };
      this.timers.push(setTimeout(invite, SETTLE_MS + 500 + Math.random() * 2000));
      this.timers.push(setInterval(invite, INVITE_RETRY_MS));
    }
    if (this.plan && !this.plan.leaderName && this.plan.members[0] === this.index && this.plan.members.length > 1) {
      this.startInviting();
      this.timers.push(setInterval(() => this.partyChat(), PARTY_CHAT_EVERY_MS));
    }
  }

  /**
   * One tick of running in a wandering direction with the shared controller, jumping now and then.
   * Like a browser frame, it simulates the time that really passed since the last tick (timers run
   * late when the process is busy). Turns away from walls, and from any
   * step the server's own check would refuse; if every try is refused it sends the first anyway, as
   * a client would, and the server's correction puts it right.
   */
  private step() {
    if (stand || this.travelled || this.dead) return;
    if (questMode && this.quests && Date.now() - this.walkerQuestAt > 1000) {
      // a walker with quests: a talk, use or hop its step asks for, when it happens to be there (no walking for it)
      this.walkerQuestAt = Date.now();
      const g = questGoal(this.quests, { zone: this.zone, x: this.body.x, z: this.body.z, job: this.jobNow.job, inParty: false, index: this.index });
      if (g.g === 'talk' || g.g === 'use') this.sendQuest(g.g === 'talk' ? { act: 'talk', npc: g.npc } : { act: 'use', prop: g.prop }, performance.now());
    }
    const now = Date.now();
    const sinceLastStep = now - this.lastStepAt;
    const dt = this.lastStepAt ? sinceLastStep / 1000 : 1 / TICK_HZ;
    this.lastStepAt = now;
    const refusals: string[] = [];
    let first: { body: Body; next: { x: number; z: number; y: number; facing: number; moving: boolean; ack: number }; heading: number } | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      // With --cluster, past 80% of the radius it heads back toward home (with the same wander).
      const fromHome = Math.hypot(this.body.x - this.home.x, this.body.z - this.home.z);
      const homeward = Math.atan2(this.home.x - this.body.x, this.home.z - this.body.z);
      const wander = fromHome > cluster * 0.8 ? homeward : this.heading;
      const heading = attempt === 0 ? wander + (Math.random() - 0.5) * 0.4 : Math.random() * 2 * Math.PI;
      const body = { ...this.body };
      const jump = attempt === 0 && Math.random() < JUMP_CHANCE;
      const stepped = stepFor(body, { vx: Math.sin(heading) * RUN_SPEED, vz: Math.cos(heading) * RUN_SPEED, jump }, dt, this.surface);
      const moved = Math.hypot(body.x - this.body.x, body.z - this.body.z);
      // stuck against something (in the air it carries on regardless, so its fall keeps up with the clock)
      if (body.grounded && moved < RUN_SPEED * Math.min(dt, 0.25) * 0.5) continue;
      // bots stay in their zone: they turn away from its exits as from walls
      if (this.nearExit(body)) continue;
      // and with --cluster, from the edge of their circle
      if (Math.hypot(body.x - this.home.x, body.z - this.home.z) > cluster && Math.hypot(body.x - this.home.x, body.z - this.home.z) > fromHome) continue;
      const next = { x: body.x, z: body.z, y: body.y, facing: heading, moving: true, ack: this.ack };
      first ??= { body, next, heading };
      const air = { ...this.air };
      // running speed is well inside the server's allowance, so only the height check can refuse it
      const checked = checkPose(this.body, air, next, now, Infinity, this.surface);
      if (checked.result !== 'ok') {
        refusals.push(`${checked.result} y ${body.y.toFixed(2)} surface ${this.surface(body.x, body.z)?.toFixed(2)}`);
        continue;
      }
      this.heading = heading;
      this.body = body;
      this.air = air;
      if (stepped.jumped) this.jumps++;
      this.room.send('move', next);
      this.lastSent = next;
      this.stallRun = 0;
      return;
    }
    this.stalledTicks++;
    if (!this.body.grounded) {
      this.airStalls++;
      this.airStallLog ??= `${this.name}: ${sinceLastStep} ms since the last tick, ${now - this.air.airStartMs} ms in the air; body ${JSON.stringify(this.body)}; track ${JSON.stringify(this.air)}; refused: ${refusals.join(' | ')}`;
    }
    this.longestStall = Math.max(this.longestStall, ++this.stallRun);
    if (first) {
      this.heading = first.heading;
      this.body = first.body;
      this.room.send('move', first.next);
      this.lastSent = first.next;
    }
  }

  /** How far p is from the nearest exit circle's edge. */
  private exitGap(p: { x: number; z: number }): number {
    return Math.min(Infinity, ...zoneDef(this.zone).exits.map((e) => Math.hypot(p.x - e.x, p.z - e.z) - e.r));
  }

  private nearExit(p: { x: number; z: number }): boolean {
    return zoneDef(this.zone).exits.some((e) => Math.hypot(p.x - e.x, p.z - e.z) < e.r + 1.5);
  }

  // ───────── --fight ─────────

  private onFx(m: S2C['fx']) {
    this.fxEvents += m.events.length;
    const now = performance.now();
    const mine = this.room.state.players?.get(this.room.sessionId)?.eid;
    for (const e of m.events) {
      // the browser's rule: faster from Sprint's `use`, until a little before it ends
      if (e.t === 'use' && e.src === mine && e.ability === 'sprint') { this.sprintUntil = now + (SPRINT_S - SPRINT_EARLY_S) * 1000; this.sprints++; }
      if (assist !== null && this.index === 0 && (e.t === 'react' || e.t === 'revive')) console.log(`assist: ${JSON.stringify(e)}`);
      if (joinName !== null && this.index === 0 && (e.t === 'react' || e.t === 'revive' || e.t === 'phase')) console.log(`join: ${JSON.stringify(e)}`);
      if (mixed && mine !== undefined && 'src' in e && e.src === mine) {
        if (e.t === 'cast') mixedStats.casts++;
        else if (e.t === 'castEnd') {
          this.castSince = null;
          if (!e.ok) bump(mixedStats.castBreaks, e.reason ?? '?');
        } else if (e.t === 'react') bump(mixedStats.reactions, e.reaction);
        else if (e.t === 'revive') mixedStats.revives++;
        else if (e.t === 'heal') {
          if (e.dst === mine) mixedStats.selfHeals++;
          else { mixedStats.allyHeals++; mixedStats.allyHealHp += e.amount; }
        } else if (e.t === 'shield' && e.dst !== mine) mixedStats.allyShields++;
        else if (e.t === 'gift' && e.dst !== mine) mixedStats.gifts++;
      }
      if (this.plan && mine !== undefined && 'src' in e && e.src === mine) {
        if (e.t === 'react') bump(partyStats.reactions, e.reaction);
        else if (e.t === 'revive') partyStats.revives++;
      }
      // interrupts and Breaks inside, counted once a party (by its leader, which sees everything in its instance)
      if (this.plan && this.zone === 'lampfall' && this.plan.members[0] === this.index && (e.t === 'interrupt' || e.t === 'break')) {
        if (e.t === 'interrupt') partyStats.interrupts++; else partyStats.breaks++;
        const rec = wardenRecs.get(this.plan.k);
        if (rec && !rec.done) { if (e.t === 'interrupt') rec.interrupts++; else rec.breaks++; }
      }
      if (e.t !== 'death' || this.zone !== 'greenway' || !enemyKinds.has(e.dst)) continue;
      // every bot that sees it gets the event: count it once (an enemy waits at least 5 s to respawn)
      const last = enemyDeathAt.get(e.dst);
      if (last !== undefined && now - last < 5000) continue;
      enemyDeathAt.set(e.dst, now);
      enemyDeaths++;
    }
  }

  /** Rolls still waiting for their answer (at the end of a run: sent too late to hear back). */
  get predictionsLeft(): number { return this.predictions.filter((p) => p.early).length; }

  private onRefused(m: S2C['refused']) {
    const key = `${m.action} ${m.reason}`;
    this.refusals[key] = (this.refusals[key] ?? 0) + 1;
    if (m.action === 'job' && m.reason === 'not-here' && this.notHereSent && !this.notHereCounted) { this.notHereCounted = true; mixedStats.notHere++; }
    if (m.action !== 'dodge') return;
    this.dodgeSentAt = null;
    // A predicted roll is undone, as the browser does: back where it was sent from (any later prediction
    // went from this one's end, so it goes too; its answer is taken as the server's own then).
    const undone = this.predictions.shift();
    if (undone) {
      if (undone.early) this.earlyLost.push(`${this.name}: refused ${m.reason}`);
      this.dropPredictions(`refused ${m.reason} (an earlier roll)`);
      this.body = makeBody(undone.from.x, undone.from.z, this.surface);
      this.body.y = undone.from.y;
      this.air = makeAirTrack(undone.from.y);
      this.busyUntil = 0;
    }
    // Refused by the engine after its pose was taken: a `correct` to that pose follows (the rollback).
    // 'stale', 'cooldown', 'charges', 'dead' (the room's own check) and 'rate' come alone (or after a
    // real correction). ('dead' from the engine also has a `correct`; the room's check comes first.)
    if (!['stale', 'cooldown', 'charges', 'dead', 'rate'].includes(m.reason)) {
      this.rollbackDue = true;
      this.rollbackReason = m.reason;
    }
  }

  /** Its own SelfView, its timers counted down from when it arrived (and the GCD of a press it sent since). */
  private agedSelf(now: number): SelfView | null {
    const s = this.selfView;
    if (!s) return null;
    const el = (now - this.selfAt) / 1000;
    const down = (v: number) => Math.max(0, v - el);
    const localGcd = Math.max(0, GCD_S - (now - this.pressedAt) / 1000);
    return {
      ...s, cd: s.cd.map(down), gcd: Math.max(down(s.gcd), localGcd), dodgeNextIn: down(s.dodgeNextIn),
      charge: s.charge === null || this.releasedAt + 150 >= this.selfAt ? null : s.charge + el,
    };
  }

  /** A fresh adventurer's own numbers (nothing used yet), for the job and picks the server last said it has. */
  private freshSelf(): SelfView {
    const { job } = this.jobNow;
    const slots = slotsFor(this.jobNow);
    const localGcd = Math.max(0, GCD_S - (performance.now() - this.pressedAt) / 1000);
    const dodges = JOBS[job].dodgeCharges;
    return {
      momentum: 0, weapon: JOBS[job].weapon, slots, cd: slots.map(() => 0), gcd: localGcd, swapCd: 0, swapLock: 0, dodgeCharges: dodges, dodgeNextIn: 0,
      charge: null, inCombat: false, job, dodgeMax: dodges, cast: null,
    };
  }

  /** The brain's view of an enemy in the state. */
  private enemyView(e: any, now: number): CombatantView {
    let windup: CombatantView['windup'] = null;
    if (e.windup) {
      const seen = this.windupSeen.get(e.eid);
      let at = seen && seen.attack === e.windup ? seen.at : null;
      if (at === null) {
        // a wind-up starts with the telegraph its enemy owns
        let el = 0;
        this.room.state.telegraphs?.forEach((t: any) => { if (t.owner === e.eid) el = Math.max(el, this.elapsedOf(t)); });
        this.windupSeen.set(e.eid, { attack: e.windup, at: (at = now - el * 1000) });
      }
      const attack = e.windup as EnemyAttackId;
      windup = { attack, total: e.windupTotal, left: Math.max(0, e.windupTotal - (now - at) / 1000), interruptible: ENEMY_ATTACKS[attack]?.interruptible ?? false };
      if (ENEMY_ATTACKS[attack]?.unavoidable) windup.unavoidable = true;
    } else this.windupSeen.delete(e.eid);
    const clock = typeof this.room.state.clock === 'number' ? this.room.state.clock : 0;
    const enrageAt = typeof e.enrageAt === 'number' ? e.enrageAt : 0;
    return {
      id: e.eid, team: 'enemy', kind: e.kind as EnemyKindId, x: e.x, z: e.z, y: e.y, facing: e.facing, hp: e.hp, maxHp: e.maxHp,
      alive: e.mode !== 'dead', shield: 0, marks: e.marks, stagger: e.stagger, maxStagger: e.maxStagger,
      targetId: e.target < 0 ? null : e.target, act: (e.mode === 'stunned' ? 'stun' : e.mode === 'return' ? 'return' : '') as Act,
      windup, surging: e.surging, staggerImmune: e.staggerImmune, debuffs: e.debuffs ?? 0,
      // Plan 4: the boss fields the dungeon brain reads (the state's are unset for ordinary enemies)
      tier: ENEMY_KINDS[e.kind as EnemyKindId]?.tier ?? 'ordinary', phase: e.phase ?? 0, warded: e.warded === true,
      enrageIn: enrageAt > 0 ? Math.max(0, (enrageAt - clock) / TICK_HZ) : null,
    };
  }

  /** How far along a telegraph is by the state's clock, in s (0 from a server without one). */
  private elapsedOf(t: { at?: number; total: number }): number {
    const clock = this.room.state.clock;
    if (typeof t.at !== 'number' || typeof clock !== 'number') return 0;
    return Math.max(0, Math.min(t.total, (clock - t.at) / TICK_HZ));
  }

  /** The live telegraphs it sees, each with the time left since it first saw it. */
  private telegraphs(now: number): TelegraphView[] {
    const out: TelegraphView[] = [];
    const live = new Set<number>();
    this.room.state.telegraphs?.forEach((t: any) => {
      live.add(t.id);
      let at = this.telegraphSeen.get(t.id);
      // its start by the server's clock (TelegraphState.at), so one first seen late is as far along as it really is
      if (at === undefined) this.telegraphSeen.set(t.id, (at = now - this.elapsedOf(t) * 1000));
      const view: TelegraphView = { id: t.id, owner: t.owner, attack: t.attack as EnemyAttackId, shape: telegraphShape(t), total: t.total, left: Math.max(0, t.total - (now - at) / 1000) };
      if (ENEMY_ATTACKS[t.attack as EnemyAttackId]?.unavoidable) view.unavoidable = true;
      out.push(view);
    });
    for (const id of this.telegraphSeen.keys()) if (!live.has(id)) this.telegraphSeen.delete(id);
    return out;
  }

  /**
   * The enemy to fight: its current one while that lives within TARGET_RANGE + 5 m; else the nearest
   * live one (not walking home invulnerable) within TARGET_RANGE that fewer than FIGHTERS_PER_ENEMY
   * (FIGHTERS_PER_ELITE for an elite) other adventurers in its view already target, as players spread
   * over a camp. (100 bots on 21 enemies otherwise kill each one in about 2 s, before its first
   * telegraph: no dodging, no knockbacks, no deaths.) An enemy that targets it is fought whatever the count.
   */
  private chooseEnemy(): any {
    let best: any = null, bestD = TARGET_RANGE, current: any = null, attacker: any = null;
    const mine = this.room.state.players?.get(this.room.sessionId)?.eid;
    let n = 0;
    const claimed = new Map<number, number>();
    /** Enemies a hunter (another bot) is on: nobody else engages them, so its fight stays solo. */
    const hunted = new Set<number>();
    this.room.state.players?.forEach((p: any, id: string) => {
      if (id === this.room.sessionId || p.dead || p.target < 0) return;
      claimed.set(p.target, (claimed.get(p.target) ?? 0) + 1);
      if (hunterEids.has(`${this.zone}:${p.eid}`)) hunted.add(p.target);
    });
    this.room.state.enemies?.forEach((e: any) => {
      n++;
      if (!enemyKinds.has(e.eid)) enemyKinds.set(e.eid, e.kind);
      if (e.mode === 'dead' || e.mode === 'return') return;
      const elite = ENEMY_KINDS[e.kind as EnemyKindId]?.elite === true;
      // an elite a hunter is on is left to it: not kept, not fought back, not picked (it stays solo)
      if (!this.hunter && elite && hunted.has(e.eid)) return;
      // with --jobs mixed a hunter with no medic also leaves an elite another hunter is on (unless it is attacking this one), so its fight stays solo
      if (mixed && this.hunter && MIXED_MEDICS[this.ri] === undefined && elite && hunted.has(e.eid) && e.eid !== this.sentTarget && e.target !== mine) return;
      const d = dist(e, this.body);
      if (e.eid === this.sentTarget && d <= TARGET_RANGE + 5) current = e;
      if (e.target === mine && d <= TARGET_RANGE) attacker = e;
      // --quest: a step's kinds only (its current target and what attacks it whatever the kind)
      const qk = this.questKinds;
      if (qk && qk !== 'any' && !qk.includes(e.kind) && e.eid !== this.sentTarget && e.target !== mine) return;
      // a hunter takes only an elite (whoever else is on it); the others leave elites to one adventurer
      if (this.hunter ? !elite : (claimed.get(e.eid) ?? 0) >= (elite ? FIGHTERS_PER_ELITE : FIGHTERS_PER_ENEMY)) return;
      // a White Mage leading a Black Mage takes the toughest enemy in reach (its partner needs a fight long enough for
      // Skyfall Arc on its Soaked: Conduct); everyone else the nearest
      if (this.toughFirst && elite) return; // (it leaves elites to others)
      if (this.toughFirst ? !best || e.hp > best.hp || (e.hp === best.hp && d < bestD) : d <= bestD) { best = e; bestD = d; }
    });
    mostEnemiesInView = Math.max(mostEnemiesInView, n);
    // a party bot on its way to the crater mouth only fights back
    if (this.plan && !this.full) return attacker ?? current;
    if (assist !== null) {
      if (assistHold) return null;
      // the adventurer it assists: its target while that lives near, else whatever attacks the bot
      const p = this.assisted();
      const e = p && p.target >= 0 ? findEnemy(this.room, p.target) : null;
      return e && e.mode !== 'dead' && e.mode !== 'return' && dist(e, this.body) <= TARGET_RANGE + 5 ? e : attacker;
    }
    if (this.medicOf !== null) {
      // a medic soaks its hunter's target (for the hunter's lightning: Conduct), or fights back
      const h = bots[this.medicOf];
      const e = h && h.zone === this.zone && !h.isDead && h.target !== null ? findEnemy(this.room, h.target) : null;
      return e && e.mode !== 'dead' && e.mode !== 'return' && dist(e, this.body) <= TARGET_RANGE + 5 ? e : attacker;
    }
    // the odd bot of a duo takes its leader's target (the leader never follows, so they never chase each other's)
    // (--quest: a duo partner in its leader's party takes the leader's target, so their kills are shared)
    const leader = this.partner !== null && (this.ri & 1) === 1 ? bots[this.partner] : this.questFollow && this.inParty ? bots[this.index - 1] ?? null : null;
    if (leader && leader.zone === this.zone && !leader.switching && leader.target !== null) {
      const e = findEnemy(this.room, leader.target);
      if (e && e.mode !== 'dead' && e.mode !== 'return' && dist(e, this.body) <= TARGET_RANGE + 5) return e;
    }
    return current ?? attacker ?? best;
  }

  /** --assist: the adventurer it assists, as its state holds it (null: not in view, or no --assist). */
  private assisted(): any {
    if (assist === null) return null;
    let found: any = null;
    this.room.state.players?.forEach((p: any) => { if (typeof p.name === 'string' && p.name.toLowerCase() === assist.toLowerCase()) found = p; });
    return found;
  }

  /** The other adventurers its state holds within ALLY_VIEW_R (dead ones included), as the brain wants them. */
  private alliesInView(mine: number): CombatantView[] {
    const out: CombatantView[] = [];
    // a party bot's allies are its party members (the engine's ally rule), wherever it is
    const members = this.plan ? new Set((this.partyView?.members ?? []).map((m) => m.eid).filter((e) => e >= 0)) : null;
    this.room.state.players?.forEach((p: any) => {
      if (p.eid === mine || dist(p, this.body) > ALLY_VIEW_R) return;
      if (members && !members.has(p.eid)) return;
      if (assist !== null && !p.dead) return; // --assist: it revives, but never heals or shields (the smoke test's adventurer must fall)
      out.push({
        id: p.eid, team: 'adventurer', kind: 'adventurer', x: p.x, z: p.z, y: p.y, facing: p.facing, hp: p.hp, maxHp: p.maxHp,
        alive: !p.dead, shield: p.shield ?? 0, marks: 0, stagger: 0, maxStagger: 0, targetId: p.target < 0 ? null : p.target,
        act: (p.act || '') as Act, windup: null, job: p.job as JobId, buffs: p.buffs ?? 0,
      });
    });
    return out;
  }

  /** A live White Mage with Second Dawn ready (by its last `self`), in the room and not travelling. */
  get reviveReady(): boolean {
    if (this.switching || this.disconnected || !this.room || this.dead || this.jobNow.job !== 'white_mage') return false;
    const s = this.agedSelf(performance.now());
    const slot = s ? s.slots.indexOf('second_dawn') : -1;
    return s !== null && slot >= 0 && s.cd[slot] <= 0;
  }

  /** Its medic (a hunter's White Mage) is within ALLY_VIEW_R in its zone and could revive it now. */
  private mageNear(): boolean {
    return bots.some((b) => b.medicOf === this.index && b.zone === this.zone && b.reviveReady && dist(b.position, this.body) <= ALLY_VIEW_R);
  }

  /** One tick of a fighting bot (see the file comment). */
  private fightStep() {
    if (this.switching || this.disconnected) return;
    const now = performance.now();
    const dt = this.lastStepAt ? (now - this.lastStepAt) / 1000 : 1 / TICK_HZ;
    this.lastStepAt = now;
    const me = this.room.state.players?.get(this.room.sessionId);
    if (!me || now < this.settleUntil) return;
    if (me.dead) {
      this.deadSince ??= now;
      if (this.zone === 'lampfall') return this.deadInside(now);
      // with a White Mage near whose Second Dawn is ready (as far as it can tell), it lies a while for a revive
      const waitMs = mixed && now - this.deadSince < REVIVE_WAIT_MS && this.mageNear() ? REVIVE_WAIT_MS : DEATH_MIN_S * 1000 + 300;
      if (now - this.deadSince >= waitMs && now - this.respawnAskedAt >= 1000) {
        this.respawnAskedAt = now;
        this.room.send('respawn', {});
      }
      return;
    }
    this.deadSince = null;
    // A predictor's second roll, due once the first (predicted) has played and the gap has passed: sent
    // from the first's predicted end, with whatever ack it has (the one before the first's, while that
    // `displaced` is still on its way).
    const second = this.secondDodge;
    if (second && now >= second.at && now >= this.busyUntil) {
      this.secondDodge = null;
      this.rollPredicted(second.dx, second.dz, now, this.predictions.length > 0);
      return;
    }
    if (this.dodgeSentAt !== null) {
      if (now - this.dodgeSentAt < DODGE_WAIT_MS) return;
      this.dodgeSentAt = null; // no answer: carry on (the server resyncs a lost one)
    }
    if (now < this.busyUntil) return;
    if (this.diedAt !== null) this.noteProgress(now);

    if (this.zone === 'lampfall') return this.dungeonStep(me, now, dt);
    if (this.zone !== 'greenway') {
      // In the grove (a town) it takes its job first, standing; then (back from a death, or started in
      // the grove, or come for its job) to the east gate, and through it.
      if (mixed && !this.jobReady && !this.atBoard) {
        // to the Guild Board first, as a player would
        if (dist(GUILD_BOARD, this.body) > 2) return this.walkRoute(GUILD_BOARD, dt, now, 1, false);
        this.atBoard = true;
      }
      if (!this.jobReady) return this.askJob(now);
      // --gear: the Smithy and the Tailor first (and a sale on the way back from a death); --quest: its quest's steps
      if (this.gearInGrove(dt, now)) return;
      if (this.questStep(this.agedSelf(now) ?? this.freshSelf(), dt, now)) return;
      this.maybeSprint(dist(GROVE_EAST_GATE, this.body), this.agedSelf(now) ?? this.freshSelf(), now);
      this.walkRoute(GROVE_EAST_GATE, dt, now, 1, true);
      return;
    }
    if (!this.jobReady && this.diedAt === null && !(this.plan && (wardenMode || joinName !== null))) {
      // (Warden runs take their jobs at the Keeper's Landing, a sanctuary.)
      // Its job can only be taken in a town: out through the west gate into the grove first.
      this.walkRoute(greenwayLayout().westGate, dt, now, 1, true);
      return;
    }
    if (assist !== null && !this.assistReady && this.jobReady) {
      this.assistReady = true;
      if (bots.every((b) => b.assistReady)) console.log('assist: ready');
    }
    if (mixed && assist === null && !this.notHereSent) {
      // once, on its first arrival: the Greenway is no town, so this is refused 'not-here'
      this.notHereSent = true;
      this.room.send('job', { job: JOB_IDS[(this.index + 1) % JOB_IDS.length] });
    }

    if (questMode || gearMode) {
      const sv = this.agedSelf(now) ?? this.freshSelf();
      if (this.questStep(sv, dt, now)) return;
      this.gearSwap(sv, now);
    }
    const target = this.chooseEnemy();
    const targetId: number | null = target ? target.eid : null;
    if (targetId !== this.sentTarget) {
      this.sentTarget = targetId;
      this.room.send('target', { id: targetId });
    }
    if (this.questNudge && target && now - this.nudgeAt > 4000) {
      // --quest: a step's act still missing after a minute of fighting (a careless bot never dodges, say)
      const sv = this.agedSelf(now) ?? this.freshSelf();
      if (this.questNudge.includes('dodge') && sv.inCombat && sv.dodgeCharges > 0) {
        this.nudgeAt = now;
        questStats.nudges++;
        const a = Math.atan2(target.x - this.body.x, target.z - this.body.z) + Math.PI / 2;
        this.dodgesSent++;
        this.dodgeSentAt = now;
        this.room.send('dodge', { x: this.body.x, z: this.body.z, y: this.body.y, facing: this.heading, moving: false, ack: this.ack, dx: Math.sin(a), dz: Math.cos(a) });
        return;
      }
      // a pick (twice, at the picks step), or the primer that leaves the mark a combo sets off
      const pickSlot = [3, 4].find((k) => (sv.cd[k] ?? 1) <= 0 && (this.questNudge!.includes('pick') || (this.questNudge!.includes('combo') && ABILITIES[sv.slots[k]]?.primer)));
      if (pickSlot !== undefined && sv.gcd <= 0) {
        this.nudgeAt = now;
        questStats.nudges++;
        this.pressedAt = now;
        this.room.send('ability', { slot: pickSlot, phase: 'press' });
      } else if (this.questNudge.includes('finisher') && sv.gcd <= 0 && (sv.cd[1] ?? 1) <= 0) {
        this.nudgeAt = now;
        questStats.nudges++;
        this.pressedAt = now;
        this.room.send('ability', { slot: 1, phase: 'press' });
      }
    }
    const thought = this.think(me, now, target, null);
    if (!thought) return; // it rolled
    const { act, sv, scale } = thought;
    if (target) {
      this.route = null;
      this.campGoal = null;
      if (act.moveTo) {
        if (act.intents.length === 0) this.maybeSprint(dist(act.moveTo, this.body), sv, now);
        this.walkRoute(act.moveTo, dt, now, scale, false);
      }
      return;
    }
    // A party bot walks to the crater mouth with its party and in (until the Lampfall is full).
    if (this.plan && !this.full) return this.toMouth(sv, dt, now);
    // A medic stays near its hunter; the odd bot of a duo goes where its leader is.
    const leadBot = this.medicOf !== null ? bots[this.medicOf] : this.partner !== null && (this.ri & 1) === 1 ? bots[this.partner] : null;
    const assisted = this.assisted();
    const leadAt = assisted ? { x: assisted.x, z: assisted.z }
      : leadBot && leadBot.zone === this.zone && !leadBot.switching && !leadBot.disconnected ? leadBot.position : null;
    if (assist !== null && !leadAt) return; // not in view: it waits where it is
    if (leadAt) {
      const keep = this.medicOf !== null || (assist !== null && this.index === 1) ? MEDIC_FOLLOW_M : DUO_FOLLOW_M;
      const d = dist(leadAt, this.body);
      this.campGoal = null;
      if (d > keep) {
        const p = leadAt, k = (keep - 2) / d;
        let spot = { x: p.x + (this.body.x - p.x) * k, z: p.z + (this.body.z - p.z) * k };
        if (!passableIn(this.zone)(spot.x, spot.z)) spot = { x: p.x, z: p.z };
        this.maybeSprint(d, sv, now);
        this.walkRoute(spot, dt, now, scale, false);
      } else if (act.moveTo) this.walkRoute(act.moveTo, dt, now, scale, false);
      return;
    }
    // Nothing to fight in range: to the nearest camp not visited lately, where it waits a while at a
    // spot just outside it (clear of every spawn point, so it never holds a respawn up).
    const camps = greenwayLayout().camps;
    const qk = this.questKinds && this.questKinds !== 'any' ? this.questKinds : null;
    if (JSON.stringify(qk) !== this.campKinds) { this.campKinds = JSON.stringify(qk); this.campGoal = null; this.route = null; }
    if (this.campGoal === null) {
      let best = -1, bestD = Infinity;
      camps.forEach((c, k) => {
        if (qk && !c.spawns.some((sp) => qk.includes(sp.kind))) return; // --quest: a camp of the step's kinds
        const visited = this.campVisited.get(k);
        if (visited !== undefined && now - visited < CAMP_REVISIT_MS) return;
        // the first walk spreads the bots over the camps; after that, the nearest
        // (a hunter: the Mossback camps only, the nearest first)
        const mine = mixed ? HUNTER_CAMP[this.ri] : undefined;
        const first = this.hunter ? (mine !== undefined ? (k === mine ? 0 : Infinity) : eliteCamps().includes(k) ? dist(c, this.body) : Infinity)
          : k === ((((mixed ? this.ri >> 1 : this.ri) % camps.length) + camps.length) % camps.length) ? 0 : Infinity;
        const d = this.campVisited.size === 0 || this.hunter ? first : dist(c, this.body);
        if (d < bestD) { best = k; bestD = d; }
      });
      if (best < 0) { this.campVisited.clear(); return; }
      this.campGoal = best;
      this.campSpot = this.standOff(camps[best]);
      this.campWaitFrom = null;
    }
    const spot = this.campSpot!;
    if (dist(spot, this.body) < 1) {
      this.campWaitFrom ??= now;
      if (now - this.campWaitFrom >= CAMP_WAIT_MS) {
        this.campVisited.set(this.campGoal, now);
        this.campGoal = null;
        this.route = null;
      }
      return;
    }
    this.maybeSprint(dist(spot, this.body), sv, now);
    this.walkRoute(spot, dt, now, 1, false);
  }

  /**
   * The brain's tick: its own view (the last `self`, aged), the telegraphs, its allies; the brain's intents
   * sent (abilities, a dodge, and in the Lampfall its target). Null when it rolled (nothing more this tick).
   */
  private think(me: any, now: number, target: any, dungeon: Pick<DungeonBrainInput, 'fields' | 'arena' | 'enemies' | 'home'> | null): { act: BrainAction; sv: SelfView; scale: number } | null {
    // A `self` sent while the room was being joined can arrive before its handler is set (and the next
    // comes only when something changes): until one arrives it is a fresh adventurer.
    const sv = this.agedSelf(now) ?? this.freshSelf();
    const job = sv.job ?? this.jobNow.job;
    const self: CombatantView & SelfView & { job: JobId; dodgeMax: number; cast: CastView } = {
      id: me.eid, team: 'adventurer', kind: 'adventurer', x: this.body.x, z: this.body.z, y: this.body.y, facing: this.heading,
      hp: me.hp, maxHp: me.maxHp, alive: !me.dead, shield: me.shield, marks: 0, stagger: 0, maxStagger: 0,
      targetId: me.target < 0 ? null : me.target, act: (me.act || '') as Act, windup: null, ...sv,
      job, dodgeMax: sv.dodgeMax ?? JOBS[job].dodgeCharges, cast: sv.cast ?? null, searing: me.searing ?? 0,
    };
    // the server's `self` always carries job, dodgeMax and cast (Plan 3b Task 6): one without them is a protocol fault
    if (this.selfView && (this.selfView.dodgeMax === undefined || this.selfView.job === undefined || this.selfView.cast === undefined)) selfFieldsMissing++;
    const telegraphs = this.telegraphs(now);
    for (const t of telegraphs) if (inShape(t.shape, this.body.x, this.body.z)) this.inside.add(t.id);
    // Allies: the other adventurers in its view within ALLY_VIEW_R, dead ones included (Plan 3 bots fight
    // alone: none). Heals, shields and revives on them carry their id: the engine's automatic pick reaches
    // party members only (Plan 4), and these bots are in no party, so only an explicit ally id helps them.
    const allies = mixed || this.plan ? this.alliesInView(me.eid) : [];
    const input: BrainInput = { nowS: now / 1000, careful: this.careful, self, allies, target: target ? this.enemyView(target, now) : null, telegraphs };
    // in the Lampfall: the dungeon brain, with the room's fields, arena, enemies and the target's camp (its home)
    const act = dungeon ? dungeonBrain({ ...input, ...dungeon }, this.memory) : adventurerBrain(input, this.memory);
    // an auto-only hunter presses nothing and never dodges: it walks where the brain goes and lets its autos run
    if (mixed && assist === null && AUTO_ONLY_HUNTERS.includes(this.ri)) act.intents = act.intents.filter((i) => i.t === 'target');
    if (assistHold) act.intents = act.intents.filter((i) => i.t !== 'ability' || ABILITIES[sv.slots[i.slot]]?.ai === 'revive');
    // a medic presses only its quick skill (Tidelash: Soaked on the hunter's target) and its revive: no heals or
    // shields for the hunter, which is there to fall
    if (this.medicOf !== null) act.intents = act.intents.filter((i) => i.t !== 'ability' || ABILITIES[sv.slots[i.slot]]?.role === 'quick' || ABILITIES[sv.slots[i.slot]]?.ai === 'revive');
    // a White Mage leading a Black Mage keeps its Soaked for its partner's lightning (Conduct): it never spends it on
    // its own finisher, Lantern Flare (its other skills as the brain says)
    if (this.toughFirst) act.intents = act.intents.filter((i) => !(i.t === 'ability' && i.phase === 'press' && ABILITIES[sv.slots[i.slot]]?.role === 'finisher'));
    if (sv.charge === null && this.chargeSince !== null && now - this.chargeSince > 1000) this.chargeSince = null;
    // a cast slows it to CAST_MOVE_SCALE from the press (the server: from CHARGE_SLOW_GRACE_S in) until its castEnd
    if (this.castSince !== null && now - this.castSince > (this.castFor + 1.5) * 1000) this.castSince = null;
    const casting = this.castSince !== null || (sv.cast !== null && sv.cast !== undefined) || (me.cast ?? '') !== '';
    const scale = this.chargeSince !== null || sv.charge !== null || me.act === 'charge' ? CHARGE_WALK_SCALE : casting ? CAST_MOVE_SCALE : 1;
    this.lastScale = `scale ${scale}, act '${me.act}', charge ${sv.charge}, pressed ${((now - this.pressedAt) / 1000).toFixed(2)} s ago, self ${((now - this.selfAt) / 1000).toFixed(2)} s old`;

    for (const i of act.intents) {
      if (i.t === 'ability') {
        if (i.phase === 'press') {
          this.pressedAt = now;
          if (sv.slots[i.slot] === 'charged_shot') this.chargeSince = now;
          const castS = ABILITIES[sv.slots[i.slot]]?.cast ?? 0;
          if (castS > 0) { this.castSince = now; this.castFor = castS; }
        } else this.releasedAt = now;
        if (i.ally !== undefined) mixedStats.abilityAlly++;
        this.room.send('ability', i.ally === undefined ? { slot: i.slot, phase: i.phase } : { slot: i.slot, phase: i.phase, ally: i.ally });
      } else if (i.t === 'dodge') {
        if (this.predictor) {
          // rolls at once (predicted), and again from its end after the gap when both charges are there
          this.rollPredicted(i.dx, i.dz, now, false);
          if (sv.dodgeCharges >= 2) this.secondDodge = { at: now + (DODGE_MIN_GAP_S + 0.03) * 1000, dx: i.dx, dz: i.dz };
          return null;
        }
        // from where the body is (its last sent pose), with the latest ack; nothing more until it is answered
        this.dodgesSent++;
        this.dodgeSentAt = now;
        this.room.send('dodge', { x: this.body.x, z: this.body.z, y: this.body.y, facing: this.heading, moving: false, ack: this.ack, dx: i.dx, dz: i.dz });
        return null;
      } else if (dungeon && i.t === 'target' && i.id !== this.sentTarget) {
        // the dungeon brain picks its own target (a warded boss's add first): sent as it says
        this.sentTarget = i.id;
        this.room.send('target', { id: i.id });
      }
      // 'target' intents on open ground: it sends its own choice before thinking
    }
    return { act, sv, scale };
  }

  /** A sprinter presses Sprint for a walk longer than SPRINT_FROM_M, when it is ready (and not already on). */
  private maybeSprint(far: number, sv: SelfView, now: number) {
    if (!this.sprinter || far < SPRINT_FROM_M || now < this.sprintUntil) return;
    const slot = sv.slots.indexOf('sprint');
    if (slot < 0 || sv.gcd > 0 || sv.cd[slot] > 0 || now - this.pressedAt < 1000) return;
    this.pressedAt = now;
    this.room.send('ability', { slot, phase: 'press' });
  }

  /**
   * A predicted roll, as the browser rolls: sent from where the body is with its ack, and played at
   * once by its own simulateDisplacement (no poses until it is answered and has played). `early`: sent
   * while an earlier roll's `displaced` has not arrived.
   */
  private rollPredicted(dx: number, dz: number, now: number, early: boolean) {
    const from = { x: this.body.x, z: this.body.z, y: this.body.y };
    const sim = simulateDisplacement(from, dodgeDisplacement(dx, dz), this.surface);
    this.dodgesSent++;
    if (early) this.earlySent++;
    this.dodgeSentAt = now;
    this.room.send('dodge', { ...from, facing: Math.atan2(dx, dz), moving: true, ack: this.ack, dx, dz });
    const end = { x: sim.x, z: sim.z, y: sim.y };
    this.predictions.push({ from, end, early });
    this.body = makeBody(end.x, end.z, this.surface);
    this.body.y = end.y;
    this.air = makeAirTrack(end.y);
    this.busyUntil = now + sim.seconds * 1000;
  }

  /** A spot CAMP_STANDOFF_M from the camp's centre that it can stand on, at least RESPAWN_CLEAR_RADIUS + 1 m from every spawn point. */
  private standOff(c: { x: number; z: number; r: number }): Vec2 {
    const spawns = zoneDef('greenway').camps;
    const pass = passableIn('greenway');
    for (let k = 0; k < 24; k++) {
      const a = (this.index * 2.39996 + k * 0.7) % (2 * Math.PI);
      const p = { x: c.x + Math.sin(a) * (c.r + CAMP_STANDOFF_M), z: c.z + Math.cos(a) * (c.r + CAMP_STANDOFF_M) };
      if (pass(p.x, p.z) && !this.nearExit(p) && spawns.every((sp) => dist(sp, p) >= RESPAWN_CLEAR_RADIUS + 1)) return p;
    }
    return { x: c.x, z: c.z };
  }

  /**
   * One step toward `goal`: straight at it while that works, along a findPath route over the zone's
   * ground once it is stuck (or for a walk longer than a few metres). Sends the pose only if the
   * server's own check would take it (else it stays put). `intoExit`: it may walk into exit circles.
   */
  private walkRoute(goal: Vec2, dt: number, now: number, scale: number, intoExit: boolean) {
    if (this.route && dist(this.route.goal, goal) > 2) this.route = null;
    if (!this.route && (this.stuckTicks >= STUCK_TICKS || dist(goal, this.body) > 15)) {
      const points = findPath({ x: this.body.x, z: this.body.z }, goal, passableIn(this.zone, this.zone === 'lampfall' ? this.room.state.gates ?? 0 : 0), PATH_OPTS);
      this.route = { goal: { ...goal }, points: points ?? [] };
      this.stuckTicks = 0;
    }
    let to = goal;
    if (this.route) {
      while (this.route.points.length > 1 && dist(this.route.points[0], this.body) < 0.5) this.route.points.shift();
      to = this.route.points.length > 1 ? this.route.points[0] : goal;
    }
    const dx = to.x - this.body.x, dz = to.z - this.body.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    // the browser's speed: ×SPRINT_SCALE while it thinks Sprint is on (with any charge slow on top)
    const sprinting = now < this.sprintUntil ? SPRINT_SCALE : 1;
    const speed = Math.min(RUN_SPEED * scale * sprinting * (this.sprinter ? 1 : WALK_SHARE), d / Math.max(dt, 1e-3));
    // Straight at the next point; blocked (against a rock, say), it sidesteps as a player would, and
    // searches a new route from where that leaves it. No check of its own (as the browser): a pose the
    // server refuses is a correction, and fails the run. Nothing it can do moves it (or only into an
    // exit it should not take): a stall, and nothing is sent.
    const ahead = Math.atan2(dx, dz);
    let body: Body | null = null, facing = ahead;
    for (const turn of [0, 0.79, -0.79, 1.57, -1.57, 2.36, -2.36, 3.14]) {
      const h = ahead + turn;
      const b = { ...this.body };
      stepFor(b, { vx: Math.sin(h) * speed, vz: Math.cos(h) * speed, jump: false }, dt, this.surface);
      // (near an exit it may only step away from it: a party told the Lampfall is full stands right by the mouth)
      if (dist(b, this.body) < speed * Math.min(dt, BODY_STEP_MAX_S) * 0.3 || (!intoExit && this.nearExit(b) && this.exitGap(b) <= this.exitGap(this.body))) continue;
      body = b;
      facing = h;
      break;
    }
    if (!body) {
      this.stuckTicks++;
      this.stalledTicks++;
      this.longestStall = Math.max(this.longestStall, ++this.stallRun);
      if (this.stallRun === TICK_HZ) this.stallLog ??= `${this.name} in ${this.zone} at (${this.body.x.toFixed(1)}, ${this.body.z.toFixed(1)}) toward (${to.x.toFixed(1)}, ${to.z.toFixed(1)}), goal (${goal.x.toFixed(1)}, ${goal.z.toFixed(1)}), route ${this.route ? this.route.points.length : 'none'}`;
      if (this.stuckTicks >= STUCK_TICKS * 4) this.route = null; // the route itself is no good: search again
      return;
    }
    this.stallRun = 0;
    if (facing !== ahead) {
      // a sidestep: the way ahead is blocked, so after a few, a new route from here
      if (++this.stuckTicks >= STUCK_TICKS && this.stuckTicks % STUCK_TICKS === 0) this.route = null;
    } else this.stuckTicks = 0;
    const next = { x: body.x, z: body.z, y: body.y, facing, moving: true, ack: this.ack };
    this.heading = facing;
    this.body = body;
    if (sprinting > 1) this.sprintMoves++;
    this.room.send('move', next);
    this.lastSent = next;
  }

  /** For a bot on its way back after a death: how near the Greenway it is (grove: the gate; travelling counts as progress). */
  private noteProgress(now: number) {
    const left = this.zone === 'grove' ? dist(this.body, GROVE_EAST_GATE) : 0;
    if (left < this.bestProgress - 1) { this.bestProgress = left; this.progressAt = now; }
  }

  /** Died and is neither back in the Greenway nor getting nearer it (nor still lying dead, nor travelling). */
  stuckAfterDeath(now: number): boolean {
    if (this.diedAt === null || this.switching) return false;
    // it asks to respawn from 3 s on (the server wakes it at 30 s anyway); inside, it may lie until the auto release
    if (this.dead) return now - this.diedAt > (this.zone === 'lampfall' ? (AUTO_RELEASE_S + 15) * 1000 : 40_000);
    return now - this.progressAt > PROGRESS_MS;
  }

  // ───────── --gear, --quest ─────────

  /**
   * Each `inventory` against the last one: gold moves by loot (and drops the bag sold) + quest gold + sales − purchases,
   * every new uid is a drop, a quest item, a purchase or a re-minted starter piece, every uid that went was sold, and
   * no uid ever comes back. The first view after joining a room after a travel may hold loot written while it was
   * between rooms (no `loot` message reaches it): that one resyncs the ledger (counted).
   */
  private onInventory(m: InventoryView) {
    const prev = this.inv;
    this.inv = m;
    this.invSinceJoin++;
    this.shopOp = null; // its op was answered (or the truth came anyway: what to do next is read from this view)
    const now = new Map(m.bag.map((i) => [i.uid, i.item]));
    if (prev === null) {
      for (const uid of now.keys()) this.everUids.add(uid);
      this.ledgerLootGold = this.ledgerQuestGold = 0;
      return;
    }
    const before = new Map(prev.bag.map((i) => [i.uid, i.item]));
    let expect = prev.gold + this.ledgerLootGold + this.ledgerQuestGold;
    this.ledgerLootGold = this.ledgerQuestGold = 0;
    const odd: string[] = [];
    for (const [uid, item] of now) {
      if (before.has(uid)) continue;
      if (this.everUids.has(uid)) this.uidRepeats++;
      this.everUids.add(uid);
      const qi = this.questItems.indexOf(item);
      if (this.lootUids.delete(uid)) continue;
      if (qi >= 0) { this.questItems.splice(qi, 1); continue; }
      const it = ITEMS[item];
      if (it?.tier === 0 && this.unequipSent) continue; // a starter piece minted by an unequip
      if (it?.price !== undefined) { expect -= it.price; gearStats.purchases++; continue; }
      odd.push(`new uid ${uid} (${item})`);
    }
    for (const [uid, item] of before) {
      if (now.has(uid)) continue;
      if (this.soldUids.delete(uid)) { expect += ITEMS[item]?.sell ?? 0; gearStats.sales++; gearStats.saleGold += ITEMS[item]?.sell ?? 0; continue; }
      odd.push(`uid ${uid} (${item}) gone`);
    }
    for (const c of m.wardrobe) if (!prev.wardrobe.includes(c)) { expect -= COSTUMES[c]?.price ?? 0; gearStats.costumes++; }
    this.unequipSent = false;
    if (expect === m.gold && odd.length === 0) return;
    if (this.invSinceJoin === 1 && this.travels > 0) { this.ledgerResyncs++; return; } // offline loot (see above)
    if (this.ledgerBad.length < 50) this.ledgerBad.push(`${this.name}: gold ${m.gold}, expected ${expect}${odd.length ? `; ${odd.join(', ')}` : ''}`);
  }

  /** Sends an inventory operation (and remembers it to send again with the same op id if no answer comes). */
  private sendInv(msg: Record<string, unknown>, now: number) {
    const key = JSON.stringify({ ...msg, id: undefined });
    this.shopOp = { key, msg, at: now };
    this.room.send('inv', msg);
  }

  /** An op in flight (or just refused): wait. One with no answer for OP_RETRY_MS goes again with the same id. */
  private opBusy(now: number): boolean {
    if (now < this.opWaitUntil) return true;
    const op = this.shopOp;
    if (!op) return false;
    if (now - op.at < OP_RETRY_MS) return true;
    op.at = now;
    this.room.send('inv', op.msg);
    return true;
  }

  /** The worn uid in `slot` for its current job (null: none, or the starter piece). */
  private worn(slot: GearSlot): number | null {
    const uid = this.inv?.gear[this.jobNow.job]?.[slot];
    if (uid === undefined) return null;
    const it = this.inv!.bag.find((i) => i.uid === uid);
    return it && ITEMS[it.item]?.tier !== 0 ? uid : null;
  }

  /**
   * --gear in the grove (with its job): to the Smithy for one T1 piece (the chest of its job's kit) and on with it, to the
   * Tailor for a costume when the gold reaches, then the talents its levels gave (a town); later, on the way back from a
   * death, it sells one unworn drop at the Smithy. True while it is busy with this (the tick is used).
   */
  private gearInGrove(dt: number, now: number): boolean {
    if (!gearMode || !this.inv) return false;
    const sv = this.agedSelf(now) ?? this.freshSelf();
    if (sv.inCombat) return false;
    if (this.talentRows.length && now - this.talentAt > OP_RETRY_MS) {
      // a town: its talent for the row (choice by index); a row already chosen is refused 'taken' (counted)
      this.talentAt = now;
      const row = this.talentRows.shift()!;
      this.room.send('inv', { op: 'talent', row, choice: this.index % 3 });
      gearStats.talents++;
    }
    if (this.opBusy(now)) return true;
    const inv = this.inv;
    if (this.shop === 'smithy') {
      const piece = kitItems(1, this.jobNow.job).chest;
      const have = piece ? inv.bag.find((i) => i.item === piece) : undefined;
      if (!piece || (!have && inv.gold < (ITEMS[piece]?.price ?? Infinity))) { this.shop = 'tailor'; return false; }
      if (have) {
        if (inv.gear[this.jobNow.job]?.chest === have.uid) { this.boughtUid = have.uid; this.shop = 'tailor'; return false; }
        this.sendInv({ op: 'equip', uid: have.uid, slot: 'chest' }, now);
        gearStats.equips++;
        return true;
      }
      const spot = stallSpot('smithy');
      if (dist(spot, this.body) > 0.6) { this.walkRoute(spot, dt, now, 1, false); return true; }
      this.sendInv({ op: 'buy', stall: 'smithy', item: piece, id: this.opIdFor(`buy:${piece}`) }, now);
      return true;
    }
    if (this.shop === 'tailor') {
      const price = COSTUMES[BOT_COSTUME].price ?? Infinity;
      const owned = inv.wardrobe.includes(BOT_COSTUME);
      if (!owned && inv.gold < price) { this.shop = 'done'; return false; }
      if (owned) {
        const outfit = this.jobOutfitHead;
        if (outfit === BOT_COSTUME) { this.shop = 'done'; return false; }
        this.sendInv({ op: 'wear', slot: COSTUMES[BOT_COSTUME].slot, costume: BOT_COSTUME }, now);
        this.jobOutfitHead = BOT_COSTUME; // (the view carries no outfit: the `jobs` view does; worn once is enough)
        gearStats.wears++;
        return true;
      }
      const spot = stallSpot('tailor');
      if (dist(spot, this.body) > 0.6) { this.walkRoute(spot, dt, now, 1, false); return true; }
      this.sendInv({ op: 'buyCostume', costume: BOT_COSTUME, id: this.opIdFor(`costume:${BOT_COSTUME}`) }, now);
      return true;
    }
    // back from a death: one unworn drop sold at the Smithy on the way
    if (this.diedAt !== null || this.sellDue) {
      const drop = inv.bag.find((i) => i.worn.length === 0 && (ITEMS[i.item]?.sell ?? 0) > 0 && ITEMS[i.item]?.slot !== 'chest' && !this.soldUids.has(i.uid));
      if (!drop) { this.sellDue = false; return false; }
      this.sellDue = true;
      const spot = stallSpot('smithy');
      if (dist(spot, this.body) > 0.6) { this.walkRoute(spot, dt, now, 1, false); return true; }
      this.soldUids.add(drop.uid);
      this.sendInv({ op: 'sell', uid: drop.uid }, now);
      this.sellDue = false;
      return true;
    }
    return false;
  }
  private jobOutfitHead: CostumeId | null = null;
  /** One random op id per purchase it means to make: sent again (after any view) it is a dup, never a second purchase. */
  private opIds = new Map<string, string>();
  private opIdFor(what: string): string {
    let id = this.opIds.get(what);
    if (!id) this.opIds.set(what, (id = newOpId()));
    return id;
  }
  private sellDue = false;

  /** --gear in the Greenway: every GEAR_SWAP_MS, out of combat, the worn T1 piece off and on again. */
  private gearSwap(sv: SelfView, now: number) {
    if (!gearMode || !this.inv || sv.inCombat || sv.cast || sv.charge !== null || now - this.swapAt < GEAR_SWAP_MS || this.opBusy(now)) return;
    this.swapAt = now;
    const uid = this.worn('chest');
    if (uid === null) return;
    this.unequipSent = true;
    this.room.send('inv', { op: 'unequip', slot: 'chest' });
    this.sendInv({ op: 'equip', uid, slot: 'chest' }, now);
    gearStats.unequips++;
    gearStats.equips++;
    gearStats.swaps++;
  }

  /** Sends a quest act, again after QUEST_RETRY_MS while nothing has changed. */
  private sendQuest(act: Record<string, unknown>, now: number) {
    const key = JSON.stringify(act);
    if (this.questAct && this.questAct.key === key && now - this.questAct.at < QUEST_RETRY_MS) return;
    const me = this.room.state.players?.get(this.room.sessionId);
    if (!me || me.dead || me.hp <= 0) return; // (a dead adventurer's act is refused 'dead')
    this.questAct = { key, at: now };
    this.room.send('quest', act);
    questStats.acts++;
  }

  /** A jump in place (a real rise of about 1.45 m), at most one every 1.2 s: poses every tick until it lands. */
  private hop(dt: number, now: number) {
    if (!this.hopping && (!this.body.grounded || now - this.lastHopAt < 1200)) return;
    const b = { ...this.body };
    const s = stepFor(b, { vx: 0, vz: 0, jump: !this.hopping }, dt, this.surface);
    if (!this.hopping) { this.hopping = true; this.lastHopAt = now; this.jumps++; }
    else if (s.landed || b.grounded) this.hopping = false;
    this.body = b;
    const next = { x: b.x, z: b.z, y: b.y, facing: this.heading, moving: false, ack: this.ack };
    this.room.send('move', next);
    this.lastSent = next;
  }

  /**
   * --quest: one tick of its quest follower (questGoal on its own view). True when the tick is used; false lets the
   * bot go on as it would (fight in the Greenway, or walk out of the grove when its quests are done).
   */
  private questStep(sv: SelfView, dt: number, now: number): boolean {
    this.questKinds = null;
    if (!questMode || !this.quests || this.plan) return false;
    if (this.hopping) { this.hop(dt, now); return true; }
    const mainActive = this.quests.active.some((a) => a.id === 'solstice_crossing');
    let g: QuestGoal = questGoal(this.quests, { zone: this.zone, x: this.body.x, z: this.body.z, job: this.loadout.job, inParty: this.inParty, index: this.index, dropped: this.dropped });
    const main = this.quests.active.find((a) => a.id === 'solstice_crossing');
    const duo = main !== undefined && QUESTS.solstice_crossing.steps[main.step]?.id === 'duo';
    this.duoSince = duo ? this.duoSince ?? now : null;
    if (duo) {
      if (this.questLead && !this.inParty && now - this.inviteAt > INVITE_RETRY_MS) {
        // the duo: it invites its partner (the next bot), which accepts
        this.inviteAt = now;
        const mate = bots[this.index + 1];
        if (mate?.name) { this.room.send('party', { op: 'invite', name: mate.name }); questStats.invites++; }
      }
      if (this.questLead && !this.inParty && now - this.duoSince! < 30_000) g = { g: 'idle' }; // it waits for its partner a while
      if (now - this.duoSince! > DUO_WAIT_MS) g = { g: 'skip', quest: 'solstice_crossing' }; // (no party kill, no Mossback: skipped)
    }
    if (g.g === 'fight') {
      // a combo needs a mark to set off: a kit with none (a new Warrior) takes a pick that leaves one, as the hint says
      // (picks change anywhere out of a fight)
      if (g.acts.includes('combo') && !sv.inCombat && now - this.jobAskedAt > JOB_RETRY_MS) {
        const kit = [...JOBS[this.jobNow.job].bar, ...this.jobNow.picks];
        const primer = JOBS[this.jobNow.job].pool.find((a) => ABILITIES[a]?.primer && ABILITIES[a]?.mark);
        if (primer && !kit.some((a) => ABILITIES[a]?.primer && ABILITIES[a]?.mark)) {
          this.loadout = { job: this.jobNow.job, picks: [primer, this.jobNow.picks[0] === primer ? this.jobNow.picks[1] : this.jobNow.picks[0]] };
          this.jobAskedAt = now;
          this.room.send('loadout', { picks: this.loadout.picks });
          questStats.pickSwaps++;
          return true;
        }
      }
      const key = `${main?.step ?? 'x'}:${JSON.stringify(g)}`;
      if (key !== this.questFightKey) { this.questFightKey = key; this.questFightSince = now; }
      this.questKinds = g.kinds;
      // acts still missing after a minute of fighting: a nudge (a finisher; a dodge once in a fight)
      this.questNudge = g.acts.length && now - this.questFightSince! > NUDGE_AFTER_MS ? g.acts : null;
      return false;
    }
    this.questNudge = null;
    if (sv.inCombat && this.zone === 'greenway') return false; // finish the fight first
    switch (g.g) {
      case 'goto': {
        if (g.zone !== this.zone) {
          if (this.zone === 'lampfall') return false;
          const exit = this.zone === 'grove' ? GROVE_EAST_GATE : greenwayLayout().westGate;
          this.maybeSprint(dist(exit, this.body), sv, now);
          this.walkRoute(exit, dt, now, 1, true);
          return true;
        }
        this.maybeSprint(dist(g, this.body), sv, now);
        this.walkRoute({ x: g.x, z: g.z }, dt, now, 1, false);
        return true;
      }
      case 'talk': this.sendQuest(g.choice === undefined ? { act: 'talk', npc: g.npc } : { act: 'talk', npc: g.npc, choice: g.choice }, now); return true;
      case 'use': this.sendQuest({ act: 'use', prop: g.prop }, now); return true;
      case 'accept': case 'skip': this.sendQuest({ act: g.g, quest: g.quest }, now); return true;
      case 'abandon':
        this.sendQuest({ act: 'abandon', quest: g.quest }, now);
        if (!this.dropped.includes(g.quest)) this.dropped.push(g.quest);
        return true;
      case 'jump': this.hop(dt, now); return true;
      case 'job':
        if (!this.questAct || now - this.questAct.at >= QUEST_RETRY_MS) {
          this.questAct = { key: 'job', at: now };
          this.room.send('job', { job: this.loadout.job });
          questStats.acts++;
        }
        return true;
      case 'equip': {
        const inv = this.inv;
        if (!inv || this.opBusy(now)) return true;
        const item = inv.bag.find((i) => ITEMS[i.item]?.slot === g.slot && (ITEMS[i.item]?.tier ?? 0) >= 1 && fits(i.item, g.slot, this.jobNow.job) && inv.gear[this.jobNow.job]?.[g.slot] !== i.uid);
        const wornNow = inv.gear[this.jobNow.job]?.[g.slot];
        // (already worn: the step waits for the server's event; else equip one that fits)
        const target = item ?? inv.bag.find((i) => i.uid === wornNow && (ITEMS[i.item]?.tier ?? 0) >= 1);
        if (!target) return mainActive;
        this.sendInv({ op: 'equip', uid: target.uid, slot: g.slot }, now);
        gearStats.equips++;
        return true;
      }
      case 'idle': return mainActive && this.zone !== 'lampfall'; // (its step is met: the server's next view is on its way)
    }
    return false;
  }
  private questNudge: readonly string[] | null = null;
  private nudgeAt = 0;
  private walkerQuestAt = 0;
  private campKinds = '';

  // ───────── --dungeon, --warden ─────────

  /** The other members of its party in its instance, alive and not travelling. */
  private matesHere(): Bot[] {
    if (!this.plan) return [];
    return this.plan.members.map((i) => bots[i]).filter((b) => b !== this && b.zone === 'lampfall' && b.roomId === this.roomId && !b.switching && !b.disconnected && !b.isDead);
  }

  /** A White Mage of its party in its instance with Second Dawn ready, within ALLY_VIEW_R. */
  private partyMageNear(): boolean {
    return this.matesHere().some((b) => b.reviveReady && dist(b.position, this.body) <= ALLY_VIEW_R);
  }

  /** The leader invites its members by name, again every INVITE_RETRY_MS until the party is whole. */
  startInviting() {
    const plan = this.plan!;
    const invite = () => {
      if (formedPlans.has(plan.k) || this.disconnected) return;
      const inParty = new Set((this.partyView?.members ?? []).map((m) => m.name));
      plan.members.slice(1).forEach((i, j) => {
        const name = bots[i].name;
        if (inParty.has(name)) return;
        this.timers.push(setTimeout(() => {
          if (this.switching || this.disconnected || formedPlans.has(plan.k)) return;
          this.room.send('party', { op: 'invite', name });
          partyStats.invitesSent++;
        }, j * 300));
      });
    };
    this.timers.push(setTimeout(invite, SETTLE_MS + 500));
    this.timers.push(setInterval(invite, INVITE_RETRY_MS));
  }

  /**
   * In the Greenway on its way in: to the gather spot before the crater mouth, and once its party is whole and
   * every member there (or already in), out of combat, into the mouth.
   */
  private toMouth(sv: SelfView, dt: number, now: number) {
    const plan = this.plan!;
    const spot = mouthGather();
    if (plan.leaderName) {
      // --join: in once the adventurer it joined is inside (the party's instance is open then)
      const leader = this.partyView?.members.find((m) => m.name.toLowerCase() === plan.leaderName!.toLowerCase());
      if (leader?.zone === 'lampfall' && !sv.inCombat) return this.walkRoute(LAMPFALL_MOUTH, dt, now, 1, true);
      if (dist(spot, this.body) > 1) this.walkRoute(spot, dt, now, 1, false);
      return;
    }
    const formed = plan.members.length === 1 || (this.partyView?.members.length ?? 0) === plan.members.length;
    const mates = plan.members.map((i) => bots[i]).filter((b) => b !== this);
    const ready = formed && mates.every((b) => b.zone === 'lampfall' || b.switching || b.full || (b.zone === 'greenway' && dist(b.position, spot) < GATHER_R + 2));
    if (!ready || sv.inCombat) {
      if (dist(spot, this.body) > 1) this.walkRoute(spot, dt, now, 1, false);
      return;
    }
    this.walkRoute(LAMPFALL_MOUTH, dt, now, 1, true);
  }

  /** Dead inside: it lies for a revive (a party White Mage near with Second Dawn ready), else releases when it may. */
  private deadInside(now: number) {
    const inst = this.instanceView;
    if (inst && inst.wipeIn !== null) return; // a wipe: everyone gets up at the checkpoint
    if (this.partyMageNear() && now - this.deadSince! < REVIVE_WAIT_MS) return;
    // in a sealed fight a released adventurer could not come back in: it lies (a revive, a wipe or the auto release)
    if (this.room.state.sealed) return;
    if (now - this.deadSince! < RELEASE_MIN_S * 1000 + 500 || now - this.respawnAskedAt < 1000) return;
    this.respawnAskedAt = now;
    this.room.send('release', {});
    if (!this.releasePending) partyStats.releasesSent++;
    this.releasePending = true;
  }

  /**
   * Has its party the go for room `goal`? Each member gathers at `gather` (on the entry corridor, outside any gate);
   * once all the live members in the instance are there (or GATHER_WAIT_MS has passed), they walk in together.
   * Outside a room whose gate is shut there is no go (it waits at the gather spot until the fight ends).
   */
  private hasGo(goal: DungeonRoom, gather: Vec2, now: number): boolean {
    const key = `${this.roomId}:${goal.id}`;
    if (encounterOf(goal) && this.room.state.sealed === encounterOf(goal) && dist(this.body, goal) > goal.r - 0.5) { this.goRoom = null; return false; }
    if (this.goRoom === key) return true;
    const here = dist(this.body, gather) < GATHER_R;
    this.gatherSince = here ? this.gatherSince ?? now : null;
    if (here && (this.matesHere().every((b) => b.goRoom === key || dist(b.position, gather) < GATHER_R) || now - this.gatherSince! > GATHER_WAIT_MS)) this.goRoom = key;
    return this.goRoom === key;
  }

  /** Each enemy's camp spot (its spawn in its room, matched when first seen): the brain's `home`. */
  private homes = new Map<number, { x: number; z: number; leash: number }>();
  private jobReadyLogged = false;

  /**
   * One tick in the Lampfall: room by room in lampfallLayout() order, to each pack's (or boss's) room through its
   * gather spot, fighting with the dungeon brain: target the boss while it lives, else the pack's live enemy with
   * the least hp (the simulation's rule, so the party focuses); allies its party; the room as its arena; the fields
   * and enemies it sees. Warden runs end at a kill or a wipe (then it stands).
   */
  private dungeonStep(me: any, now: number, dt: number) {
    const L = lampfallLayout();
    const state = this.room.state;
    const cleared = new Set<string>(this.instanceView?.cleared ?? []);
    const goal = L.rooms.find((r) => encounterOf(r) !== undefined && !cleared.has(encounterOf(r)!)) ?? null;
    const rec = this.plan ? wardenRecs.get(this.plan.k) : undefined;
    if (rec) this.noteWarden(rec, cleared, now);
    const clearTarget = () => { if (this.sentTarget !== null) { this.sentTarget = null; this.room.send('target', { id: null }); } };
    if (rec?.done) return clearTarget(); // its run is over: it stands
    if (!this.jobReady) {
      // a Warden run takes its job at a sanctuary (the landing it starts at)
      if (zoneDef('lampfall').jobSwitch(this.body.x, this.body.z)) return this.askJob(now);
      const s = nearestOf(zoneDef('lampfall').sanctuaries ?? [], this.body);
      if (s) this.walkRoute(s, dt, now, 1, false);
      return;
    }
    if (joinName !== null && !this.jobReadyLogged) { this.jobReadyLogged = true; console.log(`join: ${this.name} ready as ${this.jobNow.job} in ${this.roomId}`); }
    const mine = me.eid;
    const enemies: any[] = [];
    state.enemies?.forEach((e: any) => { if (e.mode !== 'dead') enemies.push(e); });
    for (const e of enemies) {
      if (this.homes.has(e.eid)) continue;
      const room = L.rooms.find((r) => dist(e, r) <= r.r + 2);
      const spawns = room?.spawns ?? [];
      const own = ENEMY_KINDS[e.kind as EnemyKindId].speed > 0 ? nearestOf(spawns.filter((sp) => sp.kind === e.kind), e) : spawns.find((sp) => ENEMY_KINDS[sp.kind].boss);
      if (own) this.homes.set(e.eid, { x: own.x, z: own.z, leash: ENEMY_KINDS[own.kind].leash });
    }
    const attacker = enemies.find((e) => e.target === mine && e.mode !== 'return') ?? null;
    let target: any = null, go = false, gather: Vec2 | null = null;
    if (goal) {
      const corr = L.corridors.find((c) => c.to === goal.id)!;
      const len = Math.hypot(corr.ax - corr.bx, corr.az - corr.bz);
      const back = Math.min(GATHER_BACK_M, len - 1);
      gather = { x: corr.bx + ((corr.ax - corr.bx) / len) * back, z: corr.bz + ((corr.az - corr.bz) / len) * back };
      go = joinName !== null && assistHold ? false : this.hasGo(goal, gather, now);
      const pool = enemies.filter((e) => e.mode !== 'return' && dist(e, goal) <= goal.r + 2 && (go || e.mode !== 'idle'));
      target = pool.find((e) => ENEMY_KINDS[e.kind as EnemyKindId].boss) ?? null;
      if (!target) for (const e of pool) if (!target || e.hp < target.hp || (e.hp === target.hp && dist(e, this.body) < dist(target, this.body))) target = e;
    }
    target ??= attacker;
    if (!target) clearTarget();
    const fields: FieldView[] = [];
    state.fields?.forEach((f: any) => {
      const shape: Shape = f.shape === 'ring' ? { kind: 'ring', x: f.x, z: f.z, dir: 0, inner: f.inner, r: f.r } : { kind: 'circle', x: f.x, z: f.z, r: f.r };
      fields.push({ id: f.id, owner: f.owner, field: f.field, shape, raw: f.raw, startedAt: f.at / TICK_HZ });
    });
    const home = target ? this.homes.get(target.eid) : undefined;
    const thought = this.think(me, now, target, {
      fields, arena: goal ? { x: goal.x, z: goal.z, r: goal.r } : null, enemies: enemies.map((e) => this.enemyView(e, now)), ...(home ? { home } : {}),
    });
    if (!thought) return; // it rolled
    const { act, scale } = thought;
    if (act.moveTo) return this.walkRoute(act.moveTo, dt, now, scale, false);
    if (target || !goal || !gather || (joinName !== null && assistHold)) return;
    // nothing to fight: into the room once the party has the go, else to the gather spot
    if (go) return this.walkRoute({ x: goal.x, z: goal.z }, dt, now, 1, false);
    if (dist(gather, this.body) > 1) this.walkRoute(gather, dt, now, 1, false);
  }

  /** A Warden run's record, from what this member sees: the Lens Pit reached, the wake, phases, enrage, the end. */
  private noteWarden(rec: WardenRec, cleared: Set<string>, now: number) {
    if (rec.done) return;
    const pit = lampfallLayout().rooms.find((r) => r.id === 'lens_pit')!;
    if (dist(this.body, pit) <= pit.r) rec.reachedPit = true;
    const state = this.room.state;
    const clock = typeof state.clock === 'number' ? state.clock : 0;
    state.enemies?.forEach((e: any) => {
      if (e.kind !== 'fallen_warden') return;
      if (e.mode !== 'idle' && e.mode !== 'dead') rec.wakeAt ??= now;
      rec.phase = Math.max(rec.phase, e.phase ?? 0);
      if (e.enrageAt > 0 && clock >= e.enrageAt) rec.enraged = true;
    });
    if (cleared.has('warden')) { rec.outcome = 'kill'; rec.endAt = now; rec.done = true; }
    else if (rec.wakeAt !== null && this.instanceView && this.instanceView.wipeIn !== null) { rec.outcome = 'wipe'; rec.endAt = now; rec.done = true; }
  }

  private partyLines = 0;
  private lastChatAt = -Infinity;
  /** The leader's party chat inside (with markup, shown as plain text by clients): only while every member is in its instance. */
  partyChat() {
    const plan = this.plan;
    if (!plan || plan.members[0] !== this.index || plan.members.length < 2 || this.zone !== 'lampfall' || this.switching || this.disconnected) return;
    const mates = plan.members.slice(1).map((i) => bots[i]);
    if (!mates.every((b) => b.zone === 'lampfall' && b.roomId === this.roomId && !b.switching && !b.disconnected)) return;
    const now = performance.now();
    if (now - this.lastChatAt < 1500) return; // the chat interval is shared by both channels
    this.lastChatAt = now;
    this.room.send('chat', { text: `${PARTY_CHAT_TAG}${plan.k}:${++this.partyLines} <b>pull</b> & "go"`, channel: 'party' });
    partyStats.chatSent++;
    partyStats.chatExpected += mates.length;
  }

  private chat() {
    if (this.travelled || this.switching) return;
    if (this.zone === 'lampfall') return; // inside, party bots talk on the party channel only (partyChat)
    this.lastChatAt = performance.now();
    this.room.send('chat', { text: `${this.name} says hello at ${new Date().toISOString().slice(11, 19)}` });
  }

  async stop() {
    for (const t of this.timers) clearTimeout(t);
    if (!this.disconnected) {
      this.disconnected = 'stopped';
      await this.room.leave().catch(() => {});
    }
  }
}

if (PARTY_BOTS > count) {
  console.error(`--dungeon ${dungeonN} needs ${PARTY_BOTS} bots in parties, more than --count ${count}`);
  process.exit(2);
}
const bots = Array.from({ length: count }, (_, i) => new Bot(i));
if (wardenMode) {
  for (const plan of partyPlans) {
    wardenRecs.set(plan.k, { plan, outcome: 'time', done: false, reachedPit: false, wakeAt: null, endAt: null, phase: 0, enraged: false, interrupts: 0, breaks: 0 });
  }
}
console.log(`Joining ${count} bots to ${url} ...`);
try {
  for (let i = 0; i < count; i += JOINS_AT_ONCE) {
    await Promise.all(bots.slice(i, i + JOINS_AT_ONCE).map((bot) => bot.join()));
  }
} catch (err) {
  console.log(`FAIL: could not join all bots: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
bots.forEach((bot) => bot.start());
if (assist !== null || joinName !== null) {
  // the smoke test stops its helpers with SIGTERM: they leave their rooms first, so they are not left online
  process.on('SIGTERM', () => { void Promise.all(bots.map((bot) => bot.stop())).finally(() => process.exit(0)); });
  const tag = assist !== null ? 'assist' : 'join';
  process.stdin.setEncoding('utf8').on('data', (d: string) => {
    for (const line of d.split('\n').map((l) => l.trim())) {
      if (line === 'hold' || line === 'fight' || line === 'go') { assistHold = line === 'hold'; console.log(`${tag}: ${line}`); }
    }
  });
  if (joinName !== null) console.log(`join: names ${bots.map((b) => b.name).join(',')}`);
}
const zones = [...new Set(bots.map((bot) => bot.zone))].join(', ');
console.log(`All ${count} joined (${zones}); ${fight ? 'fighting' : stand ? 'standing' : 'walking'} and chatting for ${seconds} s.`);
await sleep(warmupMs);

const healthSamples: Health[] = [];
let nearSum = 0, nearSamples = 0;
/** Enemies alive that some bot sees, sampled every second (min, max). */
let aliveMin = Infinity, aliveMax = 0;
const sampler = setInterval(() => {
  void health().then((h) => healthSamples.push(h), () => {});
  const live = bots.filter((bot) => !bot.disconnected && !bot.travelled && !bot.switching);
  for (const bot of live) bot.sampleView();
  // How many other bots really are within INTEREST_RADIUS (by their own positions): what a view should hold.
  let pairs = 0;
  for (const a of live) for (const b of live) if (a !== b && a.zone === b.zone && Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) <= INTEREST_RADIUS) pairs++;
  if (live.length) { nearSum += pairs / live.length; nearSamples++; }
  if (fight) {
    const alive = new Set<number>();
    for (const bot of live) bot.room.state.enemies?.forEach((e: any) => { if (e.mode !== 'dead') alive.add(e.eid); });
    aliveMin = Math.min(aliveMin, alive.size);
    aliveMax = Math.max(aliveMax, alive.size);
  }
}, 1000);
for (const bot of bots) bot.patches = 0;
const measureStart = performance.now();
// (a Warden run ends early once every party's fight is over: a kill or a wipe)
for (let left = seconds * 1000; left > 0; left -= 1000) {
  await sleep(Math.min(1000, left));
  if (wardenMode && [...wardenRecs.values()].every((r) => r.done)) { await sleep(3000); break; }
}
const measured = (performance.now() - measureStart) / 1000;
const rates = bots.map((bot) => (bot.patches ?? 0) / measured);
clearInterval(sampler);
const final = await health();
const endedAt = performance.now();

const lost = bots.filter((bot) => bot.disconnected);
const sum = (f: (bot: Bot) => number) => bots.reduce((n, bot) => n + f(bot), 0);
const corrections = sum((bot) => bot.corrections);
const chatsHeard = sum((bot) => bot.chatsHeard);
const jumps = sum((bot) => bot.jumps);
const stalledTicks = sum((bot) => bot.stalledTicks);
const airStalls = sum((bot) => bot.airStalls);
const longestStall = Math.max(...bots.map((bot) => bot.longestStall));
const hurts = sum((bot) => bot.hurts);
const hurtHp = sum((bot) => bot.hurtHp);
const byteRates = bots.map((bot) => bot.bytes / measured);
const displacements = sum((bot) => bot.displacements);
const deaths = sum((bot) => bot.deaths);
const travelled = bots.filter((bot) => bot.travelled).length;
const stuckAfterDeath = bots.filter((bot) => bot.stuckAfterDeath(endedAt));
const tickMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.tickMs ?? 0));
const tickSamples = healthSamples.map(tickMs);
const patchMs = (h: Health) => Math.max(0, ...Object.values(h.zones ?? {}).map((z) => z.patchMs ?? 0));
const patchSamples = healthSamples.map(patchMs);
const zoneNow = bots.reduce<Record<string, number>>((n, bot) => ((n[bot.switching ? 'travelling' : bot.zone] = (n[bot.switching ? 'travelling' : bot.zone] ?? 0) + 1), n), {});
await Promise.all(bots.map((bot) => bot.stop()));

const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
const min = Math.min(...rates);
const serverHz = healthSamples.map((h) => h.tickHz);
const peakRss = Math.max(final.peakRssMb, ...healthSamples.map((h) => h.peakRssMb));
const maxStepP95 = tickSamples.length ? Math.max(...tickSamples) : tickMs(final);

console.log(`players: ${final.players}`);
console.log(`patch rate seen by bots: mean ${mean.toFixed(2)} Hz, min ${min.toFixed(2)} Hz (over ${measured.toFixed(1)} s)`);
if (serverHz.length) console.log(`server patch rate (/healthz, 5 s window): min ${Math.min(...serverHz)} Hz, max ${Math.max(...serverHz)} Hz`);
console.log(`server peak RSS: ${peakRss} MB`);
if (tickSamples.length) console.log(`server step time p95 (/healthz tickMs, 5 s window, worst zone): max ${Math.max(...tickSamples)} ms, last ${tickMs(final)} ms`);
const loopSamples = healthSamples.map((h) => h.eventLoopP99Ms ?? 0);
if (loopSamples.length) console.log(`server event-loop delay p99 (/healthz eventLoopP99Ms, 5 s window): max ${Math.max(...loopSamples)} ms, last ${final.eventLoopP99Ms ?? 0} ms`);
if (patchSamples.length) console.log(`server patch time p95 (/healthz patchMs, 5 s window): max ${Math.max(...patchSamples)} ms, last ${patchMs(final)} ms`);
const sortedBytes = [...byteRates].sort((a, b) => a - b);
console.log(`received per bot: mean ${(byteRates.reduce((a, b) => a + b, 0) / byteRates.length / 1024).toFixed(1)} KiB/s, p95 ${(sortedBytes[Math.floor(sortedBytes.length * 0.95)] / 1024).toFixed(1)} KiB/s, max ${(sortedBytes[sortedBytes.length - 1] / 1024).toFixed(1)} KiB/s`);
const sampled = bots.filter((bot) => bot.viewSamples > 0);
const viewMean = sampled.reduce((n, bot) => n + bot.viewSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
const onlineMean = sampled.reduce((n, bot) => n + bot.onlineSum / bot.viewSamples, 0) / Math.max(1, sampled.length);
console.log(`adventurers in each bot's view (itself included): mean ${viewMean.toFixed(1)}; other bots really within ${INTEREST_RADIUS} m: mean ${(nearSum / Math.max(1, nearSamples)).toFixed(1)}; online count it read: mean ${onlineMean.toFixed(1)}`);
console.log(`displacements: ${displacements}; deaths: ${deaths}; sent on to another zone: ${fight ? sum((bot) => bot.travels) : travelled}`);
console.log(`corrections: ${corrections}; disconnected bots: ${lost.length}; chat lines heard: ${chatsHeard}; jumps: ${jumps}`);
console.log(`falls that hurt: ${hurts} (${hurtHp} hp in all)`);
console.log(`ticks with no sendable pose: ${stalledTicks} (${airStalls} in the air); longest run: ${longestStall} ticks`);
for (const line of bots.flatMap((bot) => bot.correctionLog).slice(0, 5)) console.log(`  correction: ${line}`);
for (const line of bots.flatMap((bot) => bot.airStallLog ?? []).slice(0, 5)) console.log(`  stalled in the air: ${line}`);
for (const line of bots.flatMap((bot) => bot.stallLog ?? []).slice(0, 5)) console.log(`  stuck for ${TICK_HZ} ticks: ${line}`);
for (const line of bots.flatMap((bot) => [...bot.earlyLost, ...(bot.predictionsLeft ? [`${bot.name}: ${bot.predictionsLeft} still unanswered at the end`] : [])]).slice(0, 5)) console.log(`  early second roll not rolled: ${line}`);

const kills = sum((bot) => bot.kills);
const dodges = sum((bot) => bot.dodgesRolled);
const knocks = sum((bot) => bot.knocks);
const returned = sum((bot) => bot.returned);
const rollbacksByReason: Record<string, number> = {};
for (const bot of bots) for (const [k, v] of Object.entries(bot.rollbacksByReason)) rollbacksByReason[k] = (rollbacksByReason[k] ?? 0) + v;
const falseRollbacks = Object.entries(rollbacksByReason).filter(([k]) => !RACY_ROLLBACKS.includes(k));
const earlySent = sum((bot) => bot.earlySent);
const earlyRolled = sum((bot) => bot.earlyRolled);
const earlySuperseded = sum((bot) => bot.earlySuperseded);
if (fight) {
  const refusals: Record<string, number> = {};
  for (const bot of bots) for (const [k, v] of Object.entries(bot.refusals)) refusals[k] = (refusals[k] ?? 0) + v;
  const carelessDeaths = sum((bot) => (bot.careful ? 0 : bot.deaths));
  console.log(`fight (over the whole run): kills credited ${kills} ${JSON.stringify(killsByKind)} (enemy deaths seen: ${enemyDeaths}); deaths ${deaths} (${carelessDeaths} careless, ${deaths - carelessDeaths} careful)`);
  console.log(`  dodges sent ${sum((bot) => bot.dodgesSent)}, rolled ${dodges}; knockbacks ${knocks}; resyncs ${sum((bot) => bot.resyncs)}; dodge rollbacks (correct after an engine refusal) ${sum((bot) => bot.rollbacks)} ${JSON.stringify(rollbacksByReason)}; displacement ends off the bot's own simulation ${sum((bot) => bot.displaceMismatch)}`);
  console.log(`  predictors (${bots.filter((bot) => bot.predictor).length}): second rolls sent before the first's displaced ${earlySent}, rolled ${earlyRolled}, replaced by a knock ${earlySuperseded}; sprinters: ${bots.filter((bot) => bot.sprinter).length} at full speed, ${sum((bot) => bot.sprints)} sprints, ${sum((bot) => bot.sprintMoves)} moves sent sprinting`);
  console.log(`  telegraphs a bot stood in: ${sum((bot) => bot.inside.size)} (careful bots: ${sum((bot) => (bot.careful ? bot.inside.size : 0))})`);
  console.log(`  back in the Greenway after a death (respawn at the statue, walk to the east gate, travel): ${returned}; revived where they fell ${sum((bot) => bot.revivedBack)}; hunters' deaths ${sum((bot) => (bot.hunter ? bot.deaths : 0))}`);
  console.log(`  travels ${sum((bot) => bot.travels)}; where the bots are at the end: ${JSON.stringify(zoneNow)}; died and not on their way back: ${stuckAfterDeath.length}`);
  console.log(`  refusals: ${Object.keys(refusals).length ? Object.entries(refusals).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`);
  console.log(`  enemies alive (seen by some bot, sampled each second): min ${aliveMin === Infinity ? 0 : aliveMin}, max ${aliveMax}; enemies ever seen ${enemyKinds.size}; most in one bot's view ${mostEnemiesInView}`);
  if (mixed) {
    const m = mixedStats;
    const jobsOf = bots.reduce<Record<string, number>>((n, bot) => (bump(n, bot.job), n), {});
    const show = (r: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(r).sort()));
    console.log(`jobs (--jobs mixed): bots by job ${show(jobsOf)}; duos ${bots.filter((b) => b.partner !== null && (b.index & 1) === 0 && b.partner < count).length}, hunters ${bots.filter((b) => b.hunter).length} with medics ${bots.filter((b) => b.medicOf !== null).length}`);
    console.log(`  job switches accepted at the Guild Board ${m.switches} of ${count}; Greenway switches refused 'not-here' ${m.notHere} of ${count}`);
    console.log(`  casts ${m.casts}; cast breaks ${show(m.castBreaks)}; reactions ${show(m.reactions)}; revives ${m.revives} (revived messages ${m.revivedMsgs})`);
    console.log(`  ally heals ${m.allyHeals} (${m.allyHealHp} hp), self heals ${m.selfHeals}, ally shields ${m.allyShields}, Momentum gifts ${m.gifts}; presses with an explicit ally id ${m.abilityAlly}`);
    console.log(`  kills by job ${show(m.killsByJob)}; xp gained by job ${show(m.xpByJob)}`);
  }
  console.log(`  fx events per bot a second: ${(sum((bot) => bot.fxEvents) / count / Math.max(1, measured + warmupMs / 1000)).toFixed(2)}; lowest hp a bot was seen alive at: ${Math.min(...bots.map((bot) => bot.hpSeenMin))}`);
}

// ───────── --looks, --gear, --quest: what they saw ─────────
const invWrites = healthSamples.map((h) => h.invWritesPerS ?? 0).sort((a, b) => a - b);
const invWritesP95 = invWrites.length ? invWrites[Math.min(invWrites.length - 1, Math.floor(invWrites.length * 0.95))] : 0;
let looksDistinct = 0, looksInView = 0;
if (looksMode) {
  // bot 0: the look codes of the adventurers in its view at the end (its own included), and how many differ
  const b0 = bots[0];
  const eids: number[] = [];
  b0.room?.state.players?.forEach((p: any) => eids.push(p.eid));
  const codes = eids.map((e) => b0.seenLooks.get(e)).filter((c): c is string => c !== undefined);
  looksInView = eids.length;
  looksDistinct = new Set(codes).size;
  console.log(`looks (--looks): bot 0 sees ${looksInView} adventurers, ${codes.length} with a look code, ${looksDistinct} distinct; gear code changes seen ${gearStats.gearCodeChanges}`);
}
if (walkParties) console.log(`parties (--parties): bots in a party of 2 or more at the end ${bots.filter((b) => b.inParty).length} of ${count} (in a full party of 4: ${bots.filter((b) => (b.partyView?.members.length ?? 0) === 4).length})`);
const ledgerBad = bots.flatMap((b) => b.ledgerBad);
const uidRepeats = sum((b) => b.uidRepeats);
const invRefusalsBad = Object.entries(gearStats.refused).filter(([k]) => !GEAR_OK_REFUSALS.includes(k.split(' ')[1]));
if (gearMode || questMode) {
  const show = (r: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(r).sort()));
  console.log(`gear (${gearMode ? '--gear' : 'quest equips only'}): purchases ${gearStats.purchases}, costumes bought ${gearStats.costumes} (worn ${gearStats.wears}), sales ${gearStats.sales} (${gearStats.saleGold} gold), equips sent ${gearStats.equips}, unequip-and-equip swaps ${gearStats.swaps}, talents sent ${gearStats.talents}, drops ${gearStats.drops}, loot gold ${gearStats.lootGold} (with drops sold from a full bag)`);
  console.log(`  inventory refusals ${show(gearStats.refused)}; inventory writes a second (/healthz invWritesPerS): p95 ${invWritesP95}, max ${invWrites.length ? invWrites[invWrites.length - 1] : 0}`);
  console.log(`  ledgers: ${ledgerBad.length} mismatches${ledgerBad.length ? ` (first: ${ledgerBad[0]})` : ''}; uids seen again ${uidRepeats}; resynced after a travel (loot written between rooms) ${sum((b) => b.ledgerResyncs)}; worn T1 chests at the end ${bots.filter((b) => b.inv && b.inv.bag.some((i) => i.uid === b.inv!.gear[b.job]?.chest && (ITEMS[i.item]?.tier ?? 0) >= 1)).length} of ${count}`);
  for (const line of ledgerBad.slice(1, 5)) console.log(`  ledger: ${line}`);
}
const questBad = Object.entries(questStats.refused).filter(([k]) => !QUEST_OK_REFUSALS.includes(k.split(' ')[1]));
const mainIds = QUESTS.solstice_crossing.steps.map((st) => st.id);
const stepOf = (b: Bot): string => {
  if (!b.quests) return '?';
  const a = b.quests.active.find((q) => q.id === 'solstice_crossing');
  return a ? mainIds[a.step] ?? '?' : b.quests.done.some((d) => d.id === 'solstice_crossing') ? 'done' : '?';
};
const pastStep = (id: string) => bots.filter((b) => { const st = stepOf(b); return st === 'done' || mainIds.indexOf(st) > mainIds.indexOf(id); }).length;
const questBots = bots.filter((b) => !b.plan);
if (questMode) {
  const hist: Record<string, number> = {};
  for (const b of questBots) bump(hist, stepOf(b));
  const show = (r: Record<string, number>) => JSON.stringify(Object.fromEntries([...mainIds, 'done', '?'].filter((k) => r[k]).map((k) => [k, r[k]])));
  console.log(`quests (--quest): bots by main-quest step at the end ${show(hist)}`);
  console.log(`  past board ${pastStep('board')}, past first_fight ${pastStep('first_fight')}, main quest done ${hist.done ?? 0} of ${questBots.length}; quests completed ${JSON.stringify(questStats.completed)}; steps done (questDone) ${questStats.done}; scenes ${JSON.stringify(questStats.scenes)}`);
  // what the bots still at a fighting step lack (objective by objective, summed)
  for (const id of ['first_fight', 'picks']) {
    const k = mainIds.indexOf(id), objs = QUESTS.solstice_crossing.steps[k]!.objectives;
    const at = questBots.filter((b) => stepOf(b) === id);
    if (!at.length) continue;
    const lacking = objs.map((o, i) => `${o.k === 'act' ? o.what : o.k} ${at.filter((b) => (b.quests!.active.find((q) => q.id === 'solstice_crossing')!.counts[i] ?? 0) < (o.k === 'kill' || o.k === 'act' ? o.n : 1)).length}`);
    console.log(`  at ${id} (${at.length} bots), still lacking: ${lacking.join(', ')}`);
  }
  console.log(`  acts sent ${questStats.acts}; questRefused ${JSON.stringify(questStats.refused)}; quest gold ${questStats.gold}, items ${questStats.items}; nudges ${questStats.nudges}; pick swaps for a combo ${questStats.pickSwaps}; duo invites ${questStats.invites}`);
}

const instSamples = healthSamples.map((h) => h.instances?.tickMsP95Max ?? 0);
const maxInstanceP95 = Math.max(0, ...instSamples, final.instances?.tickMsP95Max ?? 0);
/** The /healthz samples of the worst instance's p95 while instances were open: median and 90th percentile (a spike or a trend). */
const instOpen = healthSamples.filter((h) => (h.instances?.open ?? 0) > 0).map((h) => h.instances!.tickMsP95Max).sort((x, y) => x - y);
const pct = (q: number) => (instOpen.length ? instOpen[Math.min(instOpen.length - 1, Math.floor(instOpen.length * q))] : 0);
const maxLoopP99 = Math.max(0, ...loopSamples);
const recs = [...instanceRecs.values()];
const splitParties: string[] = [];
const firstPackLate = recs.filter((r) => r.firstPackAt === null || r.firstPackAt - r.enteredAt > FIRST_PACK_S * 1000);
if (partyPlans.length) {
  const show = (r: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(r).sort()));
  const sizes = partyPlans.map((p) => p.members.length).join(',');
  console.log(`parties (${wardenMode ? '--warden' : `--dungeon ${dungeonN}`}): planned ${partyPlans.length} (sizes ${sizes}; ${PARTY_BOTS} bots), formed ${partyStats.formed}; invites sent ${partyStats.invitesSent}, accepted ${partyStats.accepts}, refused ${show(partyStats.refused)}`);
  console.log(`  instances opened ${recs.length} (most open at once, /healthz: ${Math.max(0, ...healthSamples.map((h) => h.instances?.open ?? 0))}); full notices: ${fullPlans.size} parties; mouth refusals in combat ${partyStats.inCombatRefusals}; instances open at the end ${final.instances?.open ?? '?'} with ${final.instances?.players ?? '?'} inside`);
  console.log(`  where the party bots are at the end: ${JSON.stringify(bots.filter((b) => b.plan).reduce<Record<string, number>>((n, b) => (bump(n, b.switching ? 'travelling' : b.zone), n), {}))}; instance step p95 max ${maxInstanceP95} ms (median ${pct(0.5)}, p90 ${pct(0.9)} of ${instOpen.length} one-second samples); zone step p95 max ${maxStepP95} ms; event-loop p99 max ${maxLoopP99} ms`);
  for (const r of recs) {
    const packs = PACKS.filter((c) => r.cleared.has(c)).length;
    const first = r.firstPackAt === null ? 'never' : `${((r.firstPackAt - r.enteredAt) / 1000).toFixed(0)} s`;
    console.log(`  instance ${r.roomId} (party ${r.k}, ${partyPlans[r.k].members.length} bots: ${partyPlans[r.k].jobs.join('+')}): first pack ${first} after entry; packs ${packs}; Wickhound ${r.cleared.has('wickhound') ? 'killed' : '-'}; Warden ${r.cleared.has('warden') ? 'killed' : '-'}; wipes ${r.wipes}`);
  }
  // where each party's members are at the end (a party is whole in one instance, or wholly told it is full)
  for (const p of partyPlans) {
    const at = p.members.map((i) => bots[i]).map((b) => (b.zone === 'lampfall' ? b.roomId : b.full ? 'full' : b.zone));
    if (new Set(at).size > 1) splitParties.push(`party ${p.k}: ${at.join(' ')}`);
  }
  for (const line of splitParties) console.log(`  split: ${line}`);
  for (const k of fullPlans) console.log(`  the party told the Lampfall is full (party ${k}): ${partyPlans[k].members.map((i) => bots[i]).map((b) => `${b.name} ${b.zone}${b.full ? ' (full)' : ''}`).join(', ')}`);
  const wick = recs.filter((r) => r.cleared.has('wickhound')).length;
  const partyDeaths = bots.reduce((n, b) => n + b.deathsInside, 0);
  console.log(`  packs killed ${recs.reduce((n, r) => n + PACKS.filter((c) => r.cleared.has(c)).length, 0)}; Wickhound kills ${wardenMode ? '- (the test start clears it)' : wick}; Warden kills ${recs.filter((r) => r.cleared.has('warden')).length}; wipes ${recs.reduce((n, r) => n + r.wipes, 0)}; deaths inside ${partyDeaths}; releases ${partyStats.releases} (sent ${partyStats.releasesSent}); revived inside ${partyStats.revivedMsgs}`);
  console.log(`  party bots: reactions ${show(partyStats.reactions)}; revives ${partyStats.revives}; interrupts ${partyStats.interrupts}; Breaks ${partyStats.breaks}; victories ${show(partyStats.victories)}`);
  console.log(`  party chat: lines sent ${partyStats.chatSent}, deliveries due ${partyStats.chatExpected}, received ${partyStats.chatGot}; notices ${show(partyStats.notices)}`);
  if (wardenMode) {
    console.log('  Warden runs (per party): outcome, seconds from the wake, phase reached (1-based), enrage, deaths, revives, interrupts, Breaks');
    for (const w of wardenRecs.values()) {
      const secs = w.wakeAt === null ? '-' : (((w.endAt ?? endedAt) - w.wakeAt) / 1000).toFixed(0);
      const members = w.plan.members.map((i) => bots[i]);
      // the kit it asked for and the tiers it wore (from its last inventory: its current job's worn pieces), beside its band
      const worn = [...new Set(members.map((b) => {
        const g = b.inv?.gear[b.job] ?? {};
        const tiers = Object.values(g).map((uid) => ITEMS[b.inv!.bag.find((i) => i.uid === uid)?.item ?? '']?.tier ?? 0);
        return tiers.length ? `t${Math.min(...tiers)}-t${Math.max(...tiers)}` : '?';
      }))].join('/');
      const band = w.plan.members.length >= 2 && w.plan.skill === 'sloppy' ? (w.plan.kit === 't2' ? 'G2: T2 sloppy duos win >= 60% (about 75%)' : w.plan.kit === 'starter' ? 'G2: starter sloppy duos win <= 50% (about 25%)' : w.plan.kit === 't1' ? 'G3: T1 between starter and T2' : '-')
        : w.plan.members.length === 1 && w.plan.kit === 't3' ? (w.plan.skill === 'careful' ? 'G5: T3 careful solo wins >= 20% (about 35%)' : w.plan.skill === 'sloppy' ? 'G5: T3 sloppy solo wins <= 20% (about 8%)' : '-')
        : w.plan.members.length === 1 && w.plan.kit === 't2' ? 'G4: T2 careful solo wins <= 10% (about 3%)' : '-';
      console.log(`    ${w.plan.jobs.join('+')}:${w.plan.skill}@${w.plan.kit ?? 'starter'} (worn ${worn}, level ${members.map((b) => b.level).join('/')}): band ${band}`);
      console.log(`    ${w.plan.jobs.join('+')}:${w.plan.skill}: ${w.outcome}, ${secs} s, phase ${w.phase + 1}, enrage ${w.enraged ? 'yes' : 'no'}, deaths ${members.reduce((n, b) => n + b.deathsInside, 0)}, revives ${members.reduce((n, b) => n + b.revivedInside, 0)}, interrupts ${w.interrupts}, Breaks ${w.breaks}${w.reachedPit ? '' : ' (never reached the Lens Pit)'}`);
    }
  }
}

if (assist !== null || joinName !== null) {
  // the smoke test's helpers have no pass marks of their own
  const tag = assist !== null ? 'assist' : 'join';
  console.log(lost.length ? `${tag}: ${lost.length} bots disconnected` : `${tag}: done`);
  process.exit(0);
}
const failures: string[] = [];
if (lost.length) failures.push(`${lost.length} bots disconnected (first: ${lost[0].name}, ${lost[0].disconnected})`);
// (Standing bots too: the state's `clock` changes every step, so a patch goes out every step.)
const minHz = wardenMode ? WARDEN_MIN_HZ : MIN_MEAN_HZ;
if (!(mean >= minHz)) failures.push(`mean patch rate ${mean.toFixed(2)} Hz is below ${minHz} Hz`);
if (corrections) failures.push(`${corrections} legal steps were corrected`);
if (airStalls) failures.push(`${airStalls} ticks in the air had no pose the server would accept`);
if (longestStall >= TICK_HZ) failures.push(`a bot was stuck for ${longestStall} ticks in a row`);
if (fight && !wardenMode) {
  if (kills < FIGHT_MIN.kills) failures.push(`${kills} kills credited, fewer than ${FIGHT_MIN.kills}`);
  const minDodges = mixed ? perRun(MIXED_MIN.dodges) : FIGHT_MIN.dodges;
  if (dodges < minDodges) failures.push(`${dodges} dodges rolled, fewer than ${minDodges}`);
  if (selfFieldsMissing) failures.push(`${selfFieldsMissing} self messages without job, dodgeMax or cast`);
  if (mixed) {
    const m = mixedStats;
    if (m.switches !== count) failures.push(`${m.switches} of ${count} job switches accepted at the Guild Board`);
    if (m.notHere !== count) failures.push(`${m.notHere} of ${count} Greenway job switches refused 'not-here'`);
    const noKills = JOB_IDS.filter((j) => !(m.killsByJob[j] > 0));
    if (noKills.length) failures.push(`no kills as ${noKills.join(', ')}`);
    if (m.casts < perRun(MIXED_MIN.casts)) failures.push(`${m.casts} casts, fewer than ${perRun(MIXED_MIN.casts)}`);
    const reactions = Object.values(m.reactions).reduce((a, b) => a + b, 0);
    if (reactions < perRun(MIXED_MIN.reactions)) failures.push(`${reactions} reactions, fewer than ${perRun(MIXED_MIN.reactions)}`);
    if (cycle) {
      // (ruling P3b-j: every kind is shown by the party runs, PARTY_MIN, and revives by the Warden runs; the Greenway's cycle needs two kinds)
      const kinds = Object.values(m.reactions).filter((v) => v > 0).length;
      if (kinds < MIXED_MIN.reactionKinds) failures.push(`reactions of ${kinds} kinds ${JSON.stringify(m.reactions)}, fewer than ${MIXED_MIN.reactionKinds}`);
    }
  }
  if (knocks < FIGHT_MIN.knocks) failures.push(`${knocks} knockbacks, fewer than ${FIGHT_MIN.knocks}`);
  if (falseRollbacks.length) failures.push(`dodge rollbacks for reasons that cannot follow a legal dodge: ${falseRollbacks.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (earlySent < FIGHT_MIN.earlyRolls) failures.push(`${earlySent} predicted second rolls sent before the first's displaced, fewer than ${FIGHT_MIN.earlyRolls}`);
  if (sum((bot) => bot.sprintMoves) < 1) failures.push('no move was sent at Sprint speed');
  // (a roll sent in the run's last moments has no answer yet when the bots stop: not a failure)
  const earlyLeft = sum((bot) => bot.predictionsLeft);
  if (earlyRolled + earlySuperseded + earlyLeft < earlySent) failures.push(`${earlySent - earlyRolled - earlySuperseded - earlyLeft} of ${earlySent} predicted second rolls were not rolled (nor replaced by a knock, nor sent too late to be answered)`);
  if (cycle && deaths < CYCLE_MIN.deaths) failures.push(`${deaths} deaths, fewer than ${CYCLE_MIN.deaths}`);
  if (cycle && returned < CYCLE_MIN.returned) failures.push(`${returned} bots back in the Greenway after a death, fewer than ${CYCLE_MIN.returned}`);
  if (stuckAfterDeath.length) failures.push(`${stuckAfterDeath.length} bots died and are not on their way back (first: ${stuckAfterDeath[0].name}, in ${stuckAfterDeath[0].zone})`);
  if (!(maxStepP95 <= MAX_STEP_P95_MS)) failures.push(`zone step p95 reached ${maxStepP95} ms (over ${MAX_STEP_P95_MS})`);
  if (!(peakRss <= MAX_PEAK_RSS_MB)) failures.push(`peak RSS ${peakRss} MB (over ${MAX_PEAK_RSS_MB})`);
  if (mostEnemiesInView > MAX_ENEMIES_PER_ZONE || enemyKinds.size > MAX_ENEMIES_PER_ZONE) failures.push(`more than ${MAX_ENEMIES_PER_ZONE} enemies (${Math.max(mostEnemiesInView, enemyKinds.size)})`);
}
if (partyPlans.length && !wardenMode) {
  const formedDue = partyPlans.filter((p) => p.members.length > 1).length;
  if (partyStats.formed !== formedDue) failures.push(`${partyStats.formed} of ${formedDue} parties formed`);
  if (splitParties.length) failures.push(`${splitParties.length} parties not together at the end (${splitParties[0]})`);
  if (recs.length !== Math.min(dungeonN, MAX_INSTANCES)) failures.push(`${recs.length} instances opened, not ${Math.min(dungeonN, MAX_INSTANCES)}`);
  if (fullPlans.size !== Math.max(0, dungeonN - MAX_INSTANCES)) failures.push(`${fullPlans.size} parties told the Lampfall is full, not ${Math.max(0, dungeonN - MAX_INSTANCES)}`);
  if (firstPackLate.length) failures.push(`${firstPackLate.length} instances did not kill their first pack within ${FIRST_PACK_S} s of entry`);
  if (partyStats.chatSent < 1 || partyStats.chatGot !== partyStats.chatExpected) failures.push(`party chat: ${partyStats.chatGot} received of ${partyStats.chatExpected} due (${partyStats.chatSent} lines sent)`);
  if (!(maxInstanceP95 <= MAX_INSTANCE_STEP_P95_MS)) failures.push(`instance step p95 reached ${maxInstanceP95} ms (over ${MAX_INSTANCE_STEP_P95_MS})`);
  const kinds = Object.values(partyStats.reactions).filter((v) => v > 0).length;
  if (kinds < PARTY_MIN.reactionKinds) failures.push(`party bots' reactions of ${kinds} kinds ${JSON.stringify(partyStats.reactions)}, fewer than ${PARTY_MIN.reactionKinds}`);
}
if (wardenMode) {
  const away = [...wardenRecs.values()].filter((w) => !w.reachedPit);
  if (away.length) failures.push(`${away.length} parties never reached the Lens Pit (first: ${away[0].plan.jobs.join('+')})`);
  if (!(maxStepP95 <= MAX_STEP_P95_MS)) failures.push(`zone step p95 reached ${maxStepP95} ms (over ${MAX_STEP_P95_MS})`);
  if (!(maxInstanceP95 <= MAX_INSTANCE_STEP_P95_MS)) failures.push(`instance step p95 reached ${maxInstanceP95} ms (over ${MAX_INSTANCE_STEP_P95_MS})`);
  if (!(peakRss <= MAX_PEAK_RSS_MB)) failures.push(`peak RSS ${peakRss} MB (over ${MAX_PEAK_RSS_MB})`);
  if (!(maxLoopP99 <= WARDEN_MAX_LOOP_P99_MS)) failures.push(`event-loop p99 reached ${maxLoopP99} ms (over ${WARDEN_MAX_LOOP_P99_MS})`);
}
if (looksMode && !(looksDistinct >= 0.9 * looksInView)) failures.push(`bot 0 saw ${looksDistinct} distinct looks among ${looksInView} adventurers in its view (under 90%)`);
if (gearMode || questMode) {
  if (invRefusalsBad.length) failures.push(`inventory refusals other than ${GEAR_OK_REFUSALS.join(', ')}: ${invRefusalsBad.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (ledgerBad.length) failures.push(`${ledgerBad.length} ledger mismatches (first: ${ledgerBad[0]})`);
  if (uidRepeats) failures.push(`${uidRepeats} item uids seen again`);
  if (!(invWritesP95 <= MAX_INV_WRITES_P95)) failures.push(`inventory writes p95 ${invWritesP95} a second (over ${MAX_INV_WRITES_P95})`);
  if (!(maxStepP95 <= MAX_STEP_P95_MS)) failures.push(`zone step p95 reached ${maxStepP95} ms (over ${MAX_STEP_P95_MS})`);
}
if (gearMode && gearStats.purchases < 1) failures.push('no purchase at the Smithy (start the server with SG2_TEST_START_GOLD >= 200)');
if (questMode) {
  if (questBad.length) failures.push(`questRefused other than ${QUEST_OK_REFUSALS.join(', ')}: ${questBad.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const n = questBots.length;
  // (the step marks: a run of 420 s started in the grove; a Greenway run started at first_fight needs >= 80% past it)
  const fromGrove = zoneId === 'grove' && bots.every((b) => b.startZone === 'grove');
  if (fromGrove && seconds >= 400) {
    if (pastStep('board') < 0.95 * n) failures.push(`${pastStep('board')} of ${n} past board (under 95%)`);
    if (pastStep('first_fight') < 0.8 * n) failures.push(`${pastStep('first_fight')} of ${n} past first_fight (under 80%)`);
    const done = questBots.filter((b) => stepOf(b) === 'done').length;
    if (done < 0.5 * n) failures.push(`${done} of ${n} finished the main quest (under 50%)`);
  } else if (!fromGrove && seconds >= 200 && pastStep('first_fight') < 0.8 * n) failures.push(`${pastStep('first_fight')} of ${n} past first_fight (under 80%)`);
}
console.log(failures.length ? `FAIL: ${failures.join('; ')}` : 'PASS');
process.exit(failures.length ? 1 : 0);
