// Casts: an ability with `cast` > 0 is checked when it starts (cooldown, GCD, Momentum, aim, range,
// sight; the GCD starts then) and lands when it completes. It ends one of five ways: completion,
// fizzle (the re-check failed: no cost, no cooldown), the caster's own dodge (no cooldown), an
// interrupt (CAST_BREAK_LOCK_S of cooldown) or death. Autos pause for the whole cast.
import { ABILITIES, type AbilityId } from './abilities';
import { CAST_BREAK_LOCK_S, CAST_RANGE_SLACK, OVERFLOW_CAST_MOMENTUM } from './constants';
import type { AdventurerState, CombatWorld } from './engine';
import { applyEffects, resolveAim, traitOf, type Subject } from './effects';
import { TIME_EPS } from './adventurer';
import { gainMomentum } from './momentum';

/** targetId: the enemy the cast was aimed at (a `target` intent mid-cast does not change it); allyId: the adventurer. */
export interface CastState { id: AbilityId; slot: number; startedAt: number; endsAt: number; targetId: number | null; allyId: number | null }
export type CastBreak = 'dodge' | 'interrupt' | 'cancel';

/** Starts the cast of slot `slot` on `subject` (already checked; the caller started the GCD). */
export function startCast(w: CombatWorld, a: AdventurerState, slot: number, id: AbilityId, subject: Subject, nowS: number): void {
  const total = ABILITIES[id].cast!;
  const dst = subject.enemy?.id ?? (subject.ally !== a ? subject.ally?.id : undefined);
  a.cast = { id, slot, startedAt: nowS, endsAt: nowS + total, targetId: subject.enemy?.id ?? null, allyId: subject.ally ? subject.ally.id : null };
  w.out.fx.push(dst === undefined ? { t: 'cast', src: a.id, ability: id, total } : { t: 'cast', src: a.id, ability: id, dst, total });
}

/** Ends a cast early: 'interrupt' gives the spell CAST_BREAK_LOCK_S of cooldown; 'dodge' and 'cancel' none. Exported for the enemy AI. */
export function breakCast(w: CombatWorld, a: AdventurerState, reason: CastBreak, nowS: number): void {
  const c = a.cast;
  if (!c) return;
  a.cast = null;
  if (reason === 'interrupt') a.readyAt[c.id] = Math.max(a.readyAt[c.id] ?? -Infinity, nowS + CAST_BREAK_LOCK_S);
  w.out.fx.push({ t: 'castEnd', src: a.id, ability: c.id, ok: false, reason });
}

/**
 * At the first tick with nowS ≥ endsAt: the subject is re-checked (alive, within range + RANGE_FUZZ +
 * CAST_RANGE_SLACK, in sight; an aimed ally who is gone is re-picked by the aim rule). On a pass: the
 * cost is spent, the cooldown starts, a `use` fx, the effects, then `castEnd { ok: true }`. On a
 * failure: a fizzle. Returns true when a cast ended.
 */
export function tickCast(w: CombatWorld, a: AdventurerState, nowS: number): boolean {
  const c = a.cast;
  if (!c || nowS < c.endsAt - TIME_EPS) return false;
  a.cast = null;
  const ab = ABILITIES[c.id];
  const subject = resolveAim(w, a, ab, c.targetId, c.allyId, CAST_RANGE_SLACK);
  if (typeof subject === 'string') {
    w.out.fx.push({ t: 'castEnd', src: a.id, ability: c.id, ok: false, reason: 'fizzle' });
    return true;
  }
  if (ab.cost !== undefined) a.momentum = gainMomentum(a.momentum, -ab.cost);
  a.readyAt[c.id] = nowS + ab.cooldown;
  const dst = subject.enemy?.id ?? (subject.ally !== a ? subject.ally?.id : undefined);
  w.out.fx.push(dst === undefined ? { t: 'use', src: a.id, ability: c.id } : { t: 'use', src: a.id, ability: c.id, dst });
  applyEffects(w, a, c.id, subject, nowS);
  // Overflow: a Black Mage's finished cast builds OVERFLOW_CAST_MOMENTUM
  if (a.alive && traitOf(a) === 'overflow') a.momentum = gainMomentum(a.momentum, OVERFLOW_CAST_MOMENTUM);
  w.out.fx.push({ t: 'castEnd', src: a.id, ability: c.id, ok: true });
  return true;
}

/** The cast as views show it, or null. */
export function castView(a: AdventurerState, nowS: number): { ability: AbilityId; total: number; left: number } | null {
  const c = a.cast;
  if (!c) return null;
  const total = ABILITIES[c.id].cast!;
  return { ability: c.id, total, left: Math.max(0, total - (nowS - c.startedAt)) };
}
