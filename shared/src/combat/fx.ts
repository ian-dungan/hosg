// Combat events the server sends. Entity ids are engine ids (adventurers and enemies share one space).
import type { AbilityId, BuffId, DebuffId } from './abilities';
import type { ElementId, ReactionId } from './elements';
import type { EnemyAttackId } from './enemies';
import type { MarkId } from './marks';

export type FxEvent =
  | { t: 'hit'; src: number; dst: number; amount: number; absorbed: number; by: AbilityId | EnemyAttackId | 'auto' | 'burning'; combo?: MarkId[]; element?: ElementId; behind?: true }
  | { t: 'heal'; src: number; dst: number; amount: number }
  | { t: 'use'; src: number; ability: AbilityId; dst?: number; frac?: number }
  | { t: 'swing'; src: number; dst: number }
  /** dst was invulnerable (dodging), in Mist Form, or src was Blinded. */
  | { t: 'miss'; src: number; dst: number; perfect: boolean; why?: 'dodge' | 'mist' | 'blind' }
  | { t: 'mark'; dst: number; mark: MarkId; on: boolean }
  | { t: 'parry'; src: number; dst: number }
  | { t: 'break'; dst: number }
  | { t: 'interrupt'; dst: number }
  | { t: 'dodge'; src: number }
  | { t: 'death'; dst: number }
  | { t: 'spawn'; dst: number }
  /** A cast started (total: its length in s), and how it ended. */
  | { t: 'cast'; src: number; ability: AbilityId; dst?: number; total: number }
  | { t: 'castEnd'; src: number; ability: AbilityId; ok: boolean; reason?: 'fizzle' | 'dodge' | 'interrupt' | 'cancel' }
  | { t: 'react'; src: number; dst: number; reaction: ReactionId }
  | { t: 'buff'; src: number; dst: number; buff: BuffId | DebuffId; on: boolean }
  | { t: 'shield'; src: number; dst: number; amount: number }
  | { t: 'gift'; src: number; dst: number; amount: number }
  | { t: 'revive'; src: number; dst: number; hp: number };
