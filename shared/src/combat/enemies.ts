// Enemy kinds and their telegraphed attacks. Raw damage is before the adventurer's defence.

export type EnemyKindId = 'thornling' | 'boar' | 'archer' | 'mossback' | 'dummy';
export type EnemyAttackId = 'thorn_burst' | 'gore_charge' | 'briar_volley' | 'ground_slam' | 'thorn_hail';
/** A knockback: `speed` m/s away for `seconds`, starting upward at vy. */
export interface Knock { speed: number; seconds: number; vy: number }
export interface EnemyAttackData {
  id: EnemyAttackId; name: string;
  /** circle-self: centred on the enemy; circle-target: on the target where the wind-up starts; cone and line: from the enemy toward the target. */
  shape: 'circle-self' | 'circle-target' | 'cone' | 'line';
  /** r: circle or cone radius; angle: cone full width (rad); length, width: line. */
  r?: number; angle?: number; length?: number; width?: number;
  /** useRange: the attack starts only with its target within this (horizontal distance between positions). */
  windup: number; raw: number; cooldown: number; firstAt: number; useRange: number;
  parryable: boolean; interruptible: boolean; knock?: Knock; dashToEnd?: boolean;
}
export interface EnemyKindData {
  id: EnemyKindId; name: string; elite: boolean; hp: number; defence: number; radius: number; speed: number;
  /** stagger: the stagger bar's max (0 = no bar). */
  aggro: number; leash: number; respawn: number; stagger: number;
  /** keepRange: a ranged enemy stops closing in at this distance. */
  auto: { reach: number; every: number; raw: number; ranged: boolean } | null; keepRange?: number;
  attacks: EnemyAttackId[];
}

export const ENEMY_ATTACKS: Record<EnemyAttackId, EnemyAttackData> = {
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
    windup: 2.2, raw: 30, cooldown: 14, firstAt: 7, useRange: 11, parryable: false, interruptible: true,
  },
};

export const ENEMY_KINDS: Record<EnemyKindId, EnemyKindData> = {
  thornling: {
    id: 'thornling', name: 'Thornling', elite: false, hp: 210, defence: 6, radius: 0.5, speed: 5.0,
    aggro: 7, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 1.8, every: 1.6, raw: 6, ranged: false }, attacks: ['thorn_burst'],
  },
  boar: {
    id: 'boar', name: 'Bramble Boar', elite: false, hp: 180, defence: 12, radius: 0.8, speed: 4.5,
    aggro: 7, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 2.2, every: 2.0, raw: 8, ranged: false }, attacks: ['gore_charge'],
  },
  archer: {
    id: 'archer', name: 'Hollow Archer', elite: false, hp: 210, defence: 6, radius: 0.5, speed: 4.0,
    aggro: 9, leash: 25, respawn: 25, stagger: 0,
    auto: { reach: 14, every: 2.2, raw: 7, ranged: true }, keepRange: 12, attacks: ['briar_volley'],
  },
  mossback: {
    id: 'mossback', name: 'Mossback', elite: true, hp: 750, defence: 15, radius: 1.3, speed: 4.0,
    aggro: 9, leash: 30, respawn: 90, stagger: 100,
    auto: { reach: 2.8, every: 2.4, raw: 7, ranged: false }, attacks: ['ground_slam', 'thorn_hail'],
  },
  /** For tests only: never moves, attacks or aggroes. */
  dummy: {
    id: 'dummy', name: 'Training Dummy', elite: false, hp: 40, defence: 0, radius: 0.5, speed: 0,
    aggro: 0, leash: 0, respawn: 5, stagger: 0, auto: null, attacks: [],
  },
};
