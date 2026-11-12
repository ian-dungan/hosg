// Boss scripts: phases, rotations, fields, adds, wards, enrage and party scaling. Data only: the engine
// (Plan 4 Task 4) runs it. The kinds carry their script as `ENEMY_KINDS[id].boss`.
import { BOSS_SCALE_CAP, ELITE_SCALE_CAP, ELITE_SCALE_PER } from './constants';
import { deepFreeze } from './freeze';
import type { EnemyAttackId, EnemyKindData, EnemyKindId } from './enemies';
import type { Shape } from './shapes';

/** A rotation entry that cannot start (no target within its useRange, or no line of sight) waits this long, then is skipped. */
export const ROTATION_SKIP_S = 4;

export type FieldId = 'lampfire' | 'lampfire_deep';
/**
 * A standing hazard. Each whole second after it starts, every live adventurer inside (ground x/z) takes
 * enemyHit(raw, defence, takenMult) through its shield; it ignores i-frames, breaks no cast, knocks
 * nothing and adds no Searing.
 */
export interface FieldDef {
  readonly id: FieldId;
  /** Relative to the boss's camp: x, z are offsets from it (dir unused: 0). */
  readonly shape: Shape;
  readonly raw: number;
}

export interface BossPhase {
  /** The phase's position in `phases` (0 = the first). */
  readonly index: number; readonly name: string;
  /** The phase lasts while hp > untilFrac × maxHp (the last phase: 0). */
  readonly untilFrac: number;
  /** Attacks in order, cycling. After a wind-up resolves, the next starts `gap` s later (autos carry on meanwhile). */
  readonly rotation: readonly EnemyAttackId[]; readonly gap: number;
  /** Overrides the kind's auto interval in this phase. */
  readonly autoEvery?: number;
  /** Walks to its camp spot and stays there (it still turns and autos in reach). */
  readonly anchor?: boolean;
  readonly onEnter?: {
    readonly fields?: readonly FieldDef[];
    readonly clearFields?: boolean;
    readonly adds?: readonly { readonly kind: EnemyKindId; readonly dx: number; readonly dz: number }[];
    /** While any of these adds lives, the boss takes × wardMult damage. */
    readonly wardMult?: number;
  };
}

export interface BossData {
  readonly phases: readonly BossPhase[];
  /** Max hp and stagger bar factor by the distinct live adventurers engaged (1..4); never below 1. */
  readonly scale: readonly [number, number, number, number];
  /** Invulnerable and still for this long between phases (telegraphs cancelled; a `phase` fx; a banner on clients). */
  readonly transitionS: number;
  /** Break stun for this boss (else BREAK_STUN_S). */
  readonly breakS?: number;
  readonly enrage?: { readonly s: number; readonly attack: EnemyAttackId; readonly every: number };
  /** Lines the client shows: the phase banners (one per phase) and the victory line. */
  readonly lore: { readonly phases: readonly string[]; readonly victory: string };
}

export type BossKindId = 'wickhound' | 'fallen_warden';

export const BOSSES: Readonly<Record<BossKindId, BossData>> = deepFreeze({
  /** The Warden's lamp-hound: a brass hound whose wick-mane still burns. */
  wickhound: {
    phases: [
      { index: 0, name: 'Brass Hound', untilFrac: 0.5, rotation: ['wick_lunge', 'ember_breath'], gap: 2.6 },
      { index: 1, name: 'Wick Unbound', untilFrac: 0, rotation: ['wick_lunge', 'cinder_ring', 'ember_breath'], gap: 2.2, autoEvery: 1.8 },
    ],
    scale: [1, 1, 1.5, 2.0],
    transitionS: 2,
    lore: {
      phases: ['Brass Hound', 'Wick Unbound'],
      victory: 'The wick-mane gutters out, and the brass hound lies down by its empty lamp.',
    },
  },
  /**
   * The Beacon lighthouse's stone-and-brass keeper, knocked loose when the Beacon rose and fallen into the
   * woods. It still tends a lamp with nowhere to shine; the small "F." on its collar is Felix's mark.
   */
  fallen_warden: {
    phases: [
      { index: 0, name: 'The Keeper Wakes', untilFrac: 0.7, rotation: ['lamp_sweep', 'brass_fall', 'lamp_sweep', 'keepers_toll'], gap: 3.0 },
      {
        index: 1, name: 'The Lamp Kindles', untilFrac: 0.35, rotation: ['beacon_lance', 'lamp_sweep', 'keepers_toll', 'brass_fall'], gap: 2.6,
        onEnter: {
          fields: [{ id: 'lampfire', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 15, r: 40 }, raw: 8 }],
          adds: [{ kind: 'lens_shard', dx: -10, dz: 0 }, { kind: 'lens_shard', dx: 10, dz: 0 }],
          wardMult: 0.4,
        },
      },
      {
        index: 2, name: 'The Lens Falls', untilFrac: 0,
        rotation: ['turning_light', 'brass_fall', 'lamp_sweep', 'keepers_toll', 'beacon_lance'], gap: 2.4, autoEvery: 2.4, anchor: true,
        onEnter: { clearFields: true, fields: [{ id: 'lampfire_deep', shape: { kind: 'ring', x: 0, z: 0, dir: 0, inner: 12, r: 40 }, raw: 10 }] },
      },
    ],
    scale: [1, 1, 1.1, 1.9],
    transitionS: 4,
    breakS: 5,
    enrage: { s: 330, attack: 'last_light', every: 4 },
    lore: {
      phases: ['The Keeper Wakes', 'The Lamp Kindles', 'The Lens Falls'],
      victory: "The Warden's lamp steadies, and for a moment its beam points the same way as Ellie's arm.",
    },
  },
} satisfies Record<BossKindId, BossData>);

/**
 * The factor on max hp and the stagger bar for n distinct live adventurers engaged: a boss reads its own
 * table (scale[min(4, max(1, n)) − 1]); a Plan 3 elite 1 + ELITE_SCALE_PER × (min(ELITE_SCALE_CAP, n) − 1);
 * anything else 1. A bad or fractional n counts down to a whole number, at least 1.
 */
export function scaleFactor(kind: EnemyKindData, n: number): number {
  const k = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  if (kind.boss) return kind.boss.scale[Math.min(BOSS_SCALE_CAP, k) - 1];
  if (kind.elite) return 1 + ELITE_SCALE_PER * (Math.min(ELITE_SCALE_CAP, k) - 1);
  return 1;
}
