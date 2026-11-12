// Enemy kinds and their telegraphed attacks. Raw damage is before the adventurer's defence.
import type { AfflictionId } from './afflictions';
import { BOSSES, type BossData } from './bosses';
import type { ElementId } from './elements';
import { deepFreeze } from './freeze';

export type EnemyKindId = 'thornling' | 'boar' | 'archer' | 'mossback' | 'dummy' | 'wickhound' | 'fallen_warden' | 'lens_shard';
export type EnemyAttackId =
  | 'thorn_burst' | 'gore_charge' | 'briar_volley' | 'ground_slam' | 'thorn_hail'
  | 'wick_lunge' | 'ember_breath' | 'cinder_ring' | 'lamp_sweep' | 'brass_fall'
  | 'keepers_toll' | 'beacon_lance' | 'turning_light' | 'last_light' | 'focus_beam';
/** ordinary (adds included), elite (Plan 3's Mossback), boss, mega (a dungeon's last boss). */
export type EnemyTier = 'ordinary' | 'elite' | 'boss' | 'mega';
/** A knockback: `speed` m/s away for `seconds`, starting upward at vy. */
export interface Knock { readonly speed: number; readonly seconds: number; readonly vy: number }
export interface EnemyAttackData {
  readonly id: EnemyAttackId; readonly name: string;
  /**
   * circle-self: centred on the enemy; circle-target: on the target where the wind-up starts; cone and line:
   * from the enemy toward the target; ring-self: a ring centred on the enemy (inner ≤ d ≤ r).
   */
  readonly shape: 'circle-self' | 'circle-target' | 'cone' | 'line' | 'ring-self';
  /** r: circle, cone or ring radius; inner: a ring's hole; angle: cone full width (rad); length, width: line. */
  readonly r?: number; readonly inner?: number; readonly angle?: number; readonly length?: number; readonly width?: number;
  /**
   * useRange: the attack starts only with its target within this (horizontal distance between positions).
   * A boss's rotation attacks run on its rotation, not on cooldown and firstAt (0 for them).
   */
  readonly windup: number; readonly raw: number; readonly cooldown: number; readonly firstAt: number; readonly useRange: number;
  readonly parryable: boolean; readonly interruptible: boolean; readonly knock?: Knock; readonly dashToEnd?: boolean;
  /** 'each': one telegraph per live adventurer on the threat table, each a circle-target on that adventurer. */
  readonly targets?: 'each';
  /** Who it is aimed at: the threat target (the default), or the farthest engaged adventurer within useRange. */
  readonly aimAt?: 'target' | 'farthest';
  /** count telegraphs, the k-th starting k × every s after the first, rotated by k × rotate rad from the first's direction. */
  readonly repeat?: { readonly count: number; readonly every: number; readonly rotate: number };
  /** Raw added per use while enraged. */
  readonly ramp?: number;
}
export interface EnemyKindData {
  readonly id: EnemyKindId; readonly name: string; readonly elite: boolean; readonly tier: EnemyTier; readonly hp: number; readonly defence: number;
  readonly radius: number; readonly speed: number;
  /** stagger: the stagger bar's max (0 = no bar). respawn: Infinity = never. */
  readonly aggro: number; readonly leash: number; readonly respawn: number; readonly stagger: number;
  /** keepRange: a ranged enemy stops closing in at this distance. afflict: each auto that lands adds a stack. */
  readonly auto: { readonly reach: number; readonly every: number; readonly raw: number; readonly ranged: boolean; readonly afflict?: AfflictionId } | null;
  readonly keepRange?: number;
  readonly attacks: readonly EnemyAttackId[];
  /** Elemental damage of `weak` deals ELEMENT_WEAK_MULT, of `resist` ELEMENT_RESIST_MULT. */
  readonly weak?: ElementId; readonly resist?: ElementId;
  /** A boss's script (tiers boss and mega). */
  readonly boss?: BossData;
}

const DEG = Math.PI / 180;

export const ENEMY_ATTACKS: Readonly<Record<EnemyAttackId, EnemyAttackData>> = deepFreeze({
  thorn_burst: {
    id: 'thorn_burst', name: 'Thorn Burst', shape: 'circle-self', r: 3,
    windup: 1.0, raw: 18, cooldown: 7, firstAt: 3, useRange: 3, parryable: true, interruptible: false,
  },
  gore_charge: {
    id: 'gore_charge', name: 'Gore Charge', shape: 'line', length: 9, width: 1.8,
    windup: 1.3, raw: 22, cooldown: 8, firstAt: 3, useRange: 8, parryable: false, interruptible: false,
    knock: { speed: 10, seconds: 0.35, vy: 4 }, dashToEnd: true,
  },
  briar_volley: {
    id: 'briar_volley', name: 'Briar Volley', shape: 'circle-target', r: 2.5,
    windup: 1.5, raw: 20, cooldown: 9, firstAt: 3, useRange: 14, parryable: false, interruptible: false,
  },
  ground_slam: {
    id: 'ground_slam', name: 'Ground Slam', shape: 'circle-self', r: 4.5,
    windup: 1.6, raw: 40, cooldown: 9, firstAt: 4, useRange: 4, parryable: true, interruptible: false,
    knock: { speed: 12, seconds: 0.4, vy: 5 },
  },
  thorn_hail: {
    id: 'thorn_hail', name: 'Thorn Hail', shape: 'cone', r: 11, angle: (70 * Math.PI) / 180,
    windup: 2.2, raw: 30, cooldown: 14, firstAt: 7, useRange: 11, parryable: false, interruptible: true, aimAt: 'farthest',
  },
  // ───── the Wickhound ─────
  wick_lunge: {
    id: 'wick_lunge', name: 'Wick Lunge', shape: 'line', length: 10, width: 2.2,
    windup: 1.3, raw: 36, cooldown: 0, firstAt: 0, useRange: 9, parryable: false, interruptible: false,
    knock: { speed: 10, seconds: 0.35, vy: 4 }, dashToEnd: true,
  },
  ember_breath: {
    id: 'ember_breath', name: 'Ember Breath', shape: 'cone', r: 9, angle: 60 * DEG,
    windup: 1.8, raw: 39, cooldown: 0, firstAt: 0, useRange: 8, parryable: false, interruptible: true,
  },
  /** Phase 2 only: stand close. */
  cinder_ring: {
    id: 'cinder_ring', name: 'Cinder Ring', shape: 'ring-self', inner: 3.5, r: 9,
    windup: 1.6, raw: 33, cooldown: 0, firstAt: 0, useRange: 9, parryable: false, interruptible: false,
  },
  // ───── the Fallen Warden ─────
  lamp_sweep: {
    id: 'lamp_sweep', name: 'Lamp Sweep', shape: 'cone', r: 12, angle: 100 * DEG,
    windup: 1.6, raw: 36, cooldown: 0, firstAt: 0, useRange: 12, parryable: false, interruptible: false,
  },
  /** A circle on each engaged adventurer: stacked adventurers take every circle they stand in. */
  brass_fall: {
    id: 'brass_fall', name: 'Brass Fall', shape: 'circle-target', r: 3, targets: 'each',
    windup: 2.0, raw: 31, cooldown: 0, firstAt: 0, useRange: 40, parryable: false, interruptible: false,
  },
  /** The whole arena. A Break cancels it too. */
  keepers_toll: {
    id: 'keepers_toll', name: "Keeper's Toll", shape: 'circle-self', r: 40,
    windup: 3.0, raw: 44, cooldown: 0, firstAt: 0, useRange: 40, parryable: false, interruptible: true,
  },
  /** Knocks into the fire ring. */
  beacon_lance: {
    id: 'beacon_lance', name: 'Beacon Lance', shape: 'line', length: 30, width: 3, aimAt: 'farthest',
    windup: 1.8, raw: 46, cooldown: 0, firstAt: 0, useRange: 30, parryable: false, interruptible: false,
    knock: { speed: 12, seconds: 0.4, vy: 5 },
  },
  /** Eight lines from the Warden in sequence, a full turn. */
  turning_light: {
    id: 'turning_light', name: 'Turning Light', shape: 'line', length: 28, width: 3.5,
    windup: 1.4, raw: 39, cooldown: 0, firstAt: 0, useRange: 40, parryable: false, interruptible: false,
    repeat: { count: 8, every: 0.6, rotate: Math.PI / 4 },
  },
  /** Enrage only, every 4 s: 15, 20, 25, ... */
  last_light: {
    id: 'last_light', name: 'Last Light', shape: 'circle-self', r: 40,
    windup: 1.0, raw: 19, cooldown: 0, firstAt: 0, useRange: 40, parryable: false, interruptible: false, ramp: 5,
  },
  // ───── the Lens Shard ─────
  focus_beam: {
    id: 'focus_beam', name: 'Focus Beam', shape: 'line', length: 20, width: 1.6, aimAt: 'farthest',
    windup: 1.5, raw: 18, cooldown: 7, firstAt: 3, useRange: 20, parryable: false, interruptible: true,
  },
});

export const ENEMY_KINDS: Readonly<Record<EnemyKindId, EnemyKindData>> = deepFreeze({
  thornling: {
    id: 'thornling', tier: 'ordinary', name: 'Thornling', elite: false, hp: 210, defence: 6, radius: 0.5, speed: 5.0,
    aggro: 7, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 1.8, every: 1.6, raw: 6, ranged: false }, attacks: ['thorn_burst'], weak: 'fire', resist: 'water',
  },
  boar: {
    id: 'boar', tier: 'ordinary', name: 'Bramble Boar', elite: false, hp: 180, defence: 12, radius: 0.8, speed: 4.5,
    aggro: 7, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 2.2, every: 2.0, raw: 8, ranged: false }, attacks: ['gore_charge'], weak: 'water', resist: 'earth',
  },
  archer: {
    id: 'archer', tier: 'ordinary', name: 'Hollow Archer', elite: false, hp: 210, defence: 6, radius: 0.5, speed: 4.0,
    aggro: 9, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 14, every: 2.2, raw: 7, ranged: true }, keepRange: 12, attacks: ['briar_volley'], weak: 'lightning',
  },
  mossback: {
    id: 'mossback', tier: 'elite', name: 'Mossback', elite: true, hp: 750, defence: 15, radius: 1.3, speed: 4.0,
    aggro: 9, leash: 30, respawn: 90, stagger: 100,
    auto: { reach: 2.8, every: 2.4, raw: 7, ranged: false }, attacks: ['ground_slam', 'thorn_hail'], weak: 'fire', resist: 'earth',
  },
  /** For tests only: never moves, attacks or aggroes. */
  dummy: {
    id: 'dummy', tier: 'ordinary', name: 'Training Dummy', elite: false, hp: 40, defence: 0, radius: 0.5, speed: 0,
    aggro: 0, leash: 0, respawn: 5, stagger: 0, auto: null, attacks: [],
  },
  /** The Warden's lamp-hound: a brass hound whose wick-mane still burns. Leash: the Wick Den's r − 2. */
  wickhound: {
    id: 'wickhound', tier: 'boss', name: 'the Wickhound', elite: true, hp: 3200, defence: 15, radius: 1.4, speed: 4.5,
    aggro: 10, leash: 14, respawn: Infinity, stagger: 220,
    auto: { reach: 3.0, every: 2.2, raw: 7, ranged: false }, attacks: ['wick_lunge', 'ember_breath', 'cinder_ring'],
    weak: 'water', resist: 'fire', boss: BOSSES.wickhound,
  },
  /** The Beacon's fallen keeper. Leash: the Lens Pit's r − 2. Its autos add Searing. */
  fallen_warden: {
    id: 'fallen_warden', tier: 'mega', name: 'the Fallen Warden', elite: true, hp: 7800, defence: 18, radius: 1.8, speed: 3.5,
    aggro: 10, leash: 20, respawn: Infinity, stagger: 300,
    auto: { reach: 3.2, every: 2.8, raw: 9, ranged: false, afflict: 'searing' },
    attacks: ['lamp_sweep', 'brass_fall', 'keepers_toll', 'beacon_lance', 'turning_light', 'last_light'],
    weak: 'water', resist: 'fire', boss: BOSSES.fallen_warden,
  },
  /** The Warden's add: never moves; spawned engaged with everyone on the Warden's threat table. */
  lens_shard: {
    id: 'lens_shard', tier: 'ordinary', name: 'Lens Shard', elite: false, hp: 420, defence: 5, radius: 0.8, speed: 0,
    aggro: 40, leash: 0, respawn: Infinity, stagger: 0, auto: null, attacks: ['focus_beam'], weak: 'lightning',
  },
});
