// Combat events the server sends. Entity ids are engine ids (adventurers and enemies share one space).
import type { AbilityId, BuffId, DebuffId } from './abilities';
import type { AfflictionId } from './afflictions';
import type { ElementId, ReactionId } from './elements';
import type { EnemyAttackId } from './enemies';
import type { MarkId } from './marks';

export type FxEvent =
  | { t: 'hit'; src: number; dst: number; amount: number; absorbed: number; by: AbilityId | EnemyAttackId | 'auto' | 'burning' | 'field'; combo?: MarkId[]; element?: ElementId; behind?: true }
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
  /** dst (re)spawned; src: the boss that spawned add dst (absent for a camp's respawn). */
  | { t: 'spawn'; dst: number; src?: number }
  /** A cast started (total: its length in s), and how it ended. */
  | { t: 'cast'; src: number; ability: AbilityId; dst?: number; total: number }
  | { t: 'castEnd'; src: number; ability: AbilityId; ok: boolean; reason?: 'fizzle' | 'dodge' | 'interrupt' | 'cancel' }
  | { t: 'react'; src: number; dst: number; reaction: ReactionId }
  | { t: 'buff'; src: number; dst: number; buff: BuffId | DebuffId; on: boolean }
  | { t: 'shield'; src: number; dst: number; amount: number }
  | { t: 'gift'; src: number; dst: number; amount: number }
  | { t: 'revive'; src: number; dst: number; hp: number }
  /** dst's stacks of an affliction changed (stacks 0: gone). */
  | { t: 'afflict'; src: number; dst: number; id: AfflictionId; stacks: number }
  /** A boss's transition begins (phase = the next phase's index). */
  | { t: 'phase'; src: number; phase: number }
  | { t: 'enrage'; src: number }
  /** A kit's lastStand caught a killing blow: src is left at 1 hp with a few seconds of plain misses. */
  | { t: 'lastStand'; src: number }
  /** A kit shield landed (healShield, lowHpShield, shieldOn), beside its `shield` fx: for the HUD's floating numbers. */
  | { t: 'kitShield'; src: number; dst: number; amount: number };
