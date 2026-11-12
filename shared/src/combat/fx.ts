// Combat events the server sends. Entity ids are engine ids (adventurers and enemies share one space).
import type { AbilityId } from './abilities';
import type { EnemyAttackId } from './enemies';
import type { MarkId } from './marks';

export type FxEvent =
  | { t: 'hit'; src: number; dst: number; amount: number; absorbed: number; by: AbilityId | EnemyAttackId | 'auto' | 'burning'; combo?: MarkId[] }
  | { t: 'heal'; src: number; dst: number; amount: number }
  | { t: 'use'; src: number; ability: AbilityId; dst?: number; frac?: number }
  | { t: 'swing'; src: number; dst: number }
  /** dst was invulnerable (dodging). */
  | { t: 'miss'; src: number; dst: number; perfect: boolean }
  | { t: 'mark'; dst: number; mark: MarkId; on: boolean }
  | { t: 'parry'; src: number; dst: number }
  | { t: 'break'; dst: number }
  | { t: 'interrupt'; dst: number }
  | { t: 'dodge'; src: number }
  | { t: 'death'; dst: number }
  | { t: 'spawn'; dst: number };
