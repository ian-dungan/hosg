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
/** Combat events are sent to clients that have their focus in view: the interest radius. */
export const FX_RADIUS = INTEREST_RADIUS;
export const CHARGE_SLOW_GRACE_S = 0.25;
export const SPEED_GRACE_S = 0.5;
/** Client only: telegraph decals fill this much early. */
export const TELEGRAPH_LEAD_S = 0.15;
