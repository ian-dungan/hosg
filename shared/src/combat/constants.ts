// Combat numbers shared by the server's engine and the client. Times in seconds, distances in metres.

// ───────── stats and damage ─────────
/** Defence constant: mitigation(d) = DEFENCE_K / (DEFENCE_K + d). */
export const DEFENCE_K = 40;

// ───────── Momentum and global timers ─────────
export const MOMENTUM_MAX = 100;
/** Momentum from each auto-attack that hits. */
export const AUTO_MOMENTUM = 10;
/** Momentum a finisher spends. */
export const FINISHER_COST = 50;
export const PARRY_MOMENTUM = 20;
export const PERFECT_DODGE_MOMENTUM = 10;
/** Momentum starts to decay after this long without dealing damage. */
export const MOMENTUM_DECAY_DELAY_S = 6;
export const MOMENTUM_DECAY_PER_S = 10;
/** Global cooldown between abilities (autos run on their own timer). */
export const GCD_S = 0.5;
/** No autos or abilities for this long after a weapon swap. */
export const SWAP_LOCKOUT_S = 0.8;
export const SWAP_COOLDOWN_S = 2;
/** An adventurer leaves combat this long after the last damage dealt or taken. */
export const COMBAT_TIMEOUT_S = 5;

// ───────── range and targeting ─────────
/** Melee reach, from the adventurer's position to the edge of the target's radius. */
export const MELEE_REACH = 2.5;
export const ADVENTURER_RADIUS = 0.4;
export const TARGET_RANGE = 40;
export const TARGET_DROP_RANGE = 50;
/** Extra range allowed on abilities, for latency. */
export const RANGE_FUZZ = 1.0;
/** Distance between the points lineOfSight checks. */
export const LOS_STEP = 0.5;
/** lineOfSight ignores obstacles this close to either end. */
export const LOS_END_SKIP = 1.0;

// ───────── dodge and knockback ─────────
export const DODGE_CHARGES = 2;
/** One charge refills this long after it started refilling (one at a time). */
export const DODGE_REFILL_S = 5;
export const DODGE_DISTANCE = 4.5;
/** A dodge's travel time (DODGE_DISTANCE / DODGE_S = 15 m/s). */
export const DODGE_S = 0.3;
export const DODGE_IFRAME_S = 0.35;
export const DODGE_MIN_GAP_S = 0.4;
export const PERFECT_DODGE_WINDOW_S = 0.6;
export const PERFECT_DODGE_STAGGER = 15;
/** Highest upward speed a knock may give (≤ JUMP_SPEED, so the jump ceiling covers launches). */
export const KNOCK_MAX_VY = 6;
export const KNOCK_RECOVER_S = 0.2;
/** Extra movement allowance granted after a displacement. */
export const DISPLACE_FUZZ_M = 0.5;
/** Largest distance a displacement moves in one stepBody call (walls 0.25 m or thicker are never crossed at 15 m/s). */
export const DISPLACE_SUBSTEP_M = 0.1;
/** Longest a displacement is simulated. */
export const DISPLACE_MAX_S = 3;

// ───────── marks, stagger and threat ─────────
export const MARK_S = 8;
/** Coefficient of a combo detonation. */
export const COMBO_COEF = 3.0;
export const COMBO_STAGGER = 25;
/** Burning damage coefficient per second (ticks once a second). */
export const BURNING_COEF_PER_S = 0.25;
export const BREAK_STUN_S = 4;
export const BREAK_DAMAGE_MULT = 1.5;
export const STAGGER_DECAY_DELAY_S = 4;
export const STAGGER_DECAY_PER_S = 5;
export const INTERRUPT_STAGGER = 25;
export const PARRY_STAGGER = 35;
/** Stun a parry gives an ordinary enemy. */
export const PARRY_STUN_S = 1.0;
export const AGGRO_THREAT = 1;
export const THREAT_PER_DAMAGE = 1;
export const THREAT_PER_HEAL = 0.5;
export const TAUNT_S = 4;
export const TAUNT_MULT = 1.1;
export const TAUNT_BONUS = 10;
/** Elites scale with the adventurers engaged (on their threat table, alive): ×(1 + this × (n − 1))… */
export const ELITE_SCALE_PER = 0.7;
/** …counting at most this many. */
export const ELITE_SCALE_CAP = 4;
/** An enemy switches target only to one with at least this × its current target's threat. */
export const TARGET_SWITCH_MULT = 1.1;

// ───────── death and respawn ─────────
export const DEATH_MIN_S = 3;
export const AUTO_RESPAWN_S = 30;
/** An enemy waits to respawn while an adventurer stands this close. */
export const RESPAWN_CLEAR_RADIUS = 6;

// ───────── budgets and client timing ─────────
export const MAX_ENEMIES_PER_ZONE = 40;
export const ENEMY_PATH_NODES = 1500;
export const ENEMY_REPLAN_S = 1.0;
export const PATHS_PER_TICK = 4;
export const UNREACHABLE_S = 3;
/**
 * Interest radius (m): each client's state holds the adventurers, enemies and telegraphs within this
 * distance of it (the server's per-client views), and something in view leaves it only beyond
 * INTEREST_RADIUS + INTEREST_HYSTERESIS, so nothing flickers at the edge.
 */
export const INTEREST_RADIUS = 60;
export const INTEREST_HYSTERESIS = 10;
/**
 * At most this many other adventurers in a view, the nearest (a crowded plaza): one comes in at rank
 * INTEREST_MAX_ADVENTURERS or nearer and goes out only past INTEREST_MAX_ADVENTURERS +
 * INTEREST_RANK_HYSTERESIS. Enemies are not capped.
 */
export const INTEREST_MAX_ADVENTURERS = 50;
export const INTEREST_RANK_HYSTERESIS = 10;
/** Combat events are sent to clients that have their focus in view: the interest radius. */
export const FX_RADIUS = INTEREST_RADIUS;
export const CHARGE_SLOW_GRACE_S = 0.25;
export const SPEED_GRACE_S = 0.5;
/** Client only: telegraph decals fill this much early. */
export const TELEGRAPH_LEAD_S = 0.15;

// ───────── jobs and magic ─────────
/** Run-speed scale while casting, from CHARGE_SLOW_GRACE_S into the cast. */
export const CAST_MOVE_SCALE = 0.5;
/** Extra range at the end of a cast, beyond range + RANGE_FUZZ. */
export const CAST_RANGE_SLACK = 2;
/** Cooldown given to a spell whose cast was interrupted. */
export const CAST_BREAK_LOCK_S = 1.5;
/** Default range of ally-aimed abilities. */
export const ALLY_RANGE = 18;
/** A revived adventurer cannot be hit for this long (dodge i-frames: enemy hits miss). */
export const REVIVE_IFRAMES_S = 2;
/** An enemy carrying Rooted moves at this scale. */
export const ROOTED_SPEED_SCALE = 0.6;
/** After Rooted ends on an enemy, it cannot be Rooted again for this long (ruling P3b-c). */
export const ROOT_IMMUNE_S = 6;
/** Rooted on an elite lasts MARK_S × this. */
export const ELITE_ROOT_MULT = 0.5;
/** Elemental damage against a weakness, and against a resistance. */
export const ELEMENT_WEAK_MULT = 1.25;
export const ELEMENT_RESIST_MULT = 0.75;
/** Reactions: blast (fire on Marked). */
export const BLAST_COEF = 4.5;
export const BLAST_SPLASH_FRAC = 0.5;
export const BLAST_SPLASH_R = 3;
/** Reactions: conduct (lightning on Soaked). */
export const CONDUCT_STUN_S = 1.5;
export const CONDUCT_STAGGER = 20;
/** Reactions: steam (water on Burning). */
export const STEAM_R = 6;
export const STEAM_HEAL = 12;
/** Reactions: bedrock (earth on Dazed). */
export const BEDROCK_R = 6;
export const BEDROCK_SHIELD = 15;
export const BEDROCK_S = 6;
/** Outgoing damage multipliers. */
export const ROAR_MULT = 1.2;
export const PACT_MULT = 1.2;
/** Crimson Pact multiplies the Dark Knight's lifesteal by this. */
export const PACT_LIFESTEAL_MULT = 2;
export const WEAKPOINT_MULT = 1.15;
export const BEHIND_MULT = 1.25;
/** "Behind": dot(facingDir(enemy), unit(attacker − enemy)) < BEHIND_COS (110° off the enemy's front). */
export const BEHIND_COS = -0.342;
export const PINPOINT_MULT = 1.1;
export const OVERFLOW_MULT = 1.1;
/** Damage taken: Steadfast, and Aegis on the Paladin and on its allies (the lowest applies, never both). */
export const STEADFAST_TAKEN = 0.85;
export const AEGIS_TAKEN = 0.4;
export const AEGIS_ALLY_TAKEN = 0.7;
/** Sheltered: this share of each hit (floored) moves to the sheltering Paladin. */
export const SHELTER_SHARE = 0.5;
/** Bloodbond shares each lifesteal heal with the lowest-hp other adventurer within this. */
export const BLOODBOND_R = 15;
/** Traits. */
export const RHYTHM_AUTO_MOMENTUM = 15;
export const STEADFAST_THREAT = 1.5;
export const BLOCK_MOMENTUM = 5;
export const BLOOD_LIFESTEAL = 0.2;
export const BLOOD_MOMENTUM_PER_HP = 1 / 3;
export const NINJA_DODGE_CHARGES = 3;
export const EVASION_PERFECT_MOMENTUM = 25;
export const OVERFLOW_CAST_MOMENTUM = 10;
export const FONT_HEAL_MULT = 1.2;
export const FONT_MOMENTUM_PER_HP = 0.5;
export const FONT_MOMENTUM_CAP = 20;
export const FONT_THREAT_MULT = 0.5;

// ───────── parties and bosses ─────────
/** A boss's scale table is indexed by the distinct live adventurers on its threat table, counting at most this many. */
export const BOSS_SCALE_CAP = 4;
/** A standing field hits every live adventurer inside it once each whole second after it starts. */
export const FIELD_TICK_S = 1;
/** After a stall, at most this many of a field's (or a Soft Rain's) due ticks land in one engine tick; the rest are skipped. */
export const CATCH_UP_TICKS = 2;
