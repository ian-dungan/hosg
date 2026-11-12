// Weapons, abilities and loadouts.
import { MELEE_REACH } from './constants';
import type { MarkId } from './marks';

export type WeaponId = 'blade' | 'bow';
export type AbilityId = 'slash' | 'sunder' | 'parry' | 'snap_shot' | 'pitch_arrow' | 'charged_shot' | 'mend' | 'taunt' | 'bulwark' | 'sprint';
export interface AbilityData {
  id: AbilityId; name: string; glyph: string; desc: string; weapon: WeaponId | 'any';
  role: 'quick' | 'finisher' | 'signature' | 'free'; kind: 'damage' | 'heal' | 'defence' | 'utility';
  /** range: 0 = self, MELEE_REACH = melee (to the edge of the target's radius). */
  cooldown: number; range: number; needsTarget: boolean;
  coef?: number; momentum?: number; cost?: number; mark?: MarkId; stagger?: number; interrupts?: boolean;
}

// ───────── effect numbers the table rows describe ─────────
/** How long a Parry waits for a parryable melee hit. */
export const PARRY_WINDOW_S = 0.6;
/** Health Mend restores at once. */
export const MEND_HEAL = 30;
/** Damage a Bulwark shield absorbs, and how long it lasts. */
export const BULWARK_ABSORB = 25;
export const BULWARK_S = 6;
/** Sprint's run-speed scale, and how long it lasts. */
export const SPRINT_SCALE = 1.4;
export const SPRINT_S = 4;
/** Taunt's range (the taunt itself: TAUNT_S, TAUNT_MULT, TAUNT_BONUS). */
export const TAUNT_RANGE = 15;
/** Charged Shot: full charge after CHARGE_FULL_S, released by itself at CHARGE_MAX_S; moving at CHARGE_MOVE_SCALE while charging. */
export const CHARGE_FULL_S = 1.5;
export const CHARGE_MAX_S = 2.5;
export const CHARGE_MOVE_SCALE = 0.4;
/** Charged Shot interrupts at this charge fraction or more. */
export const CHARGE_INTERRUPT_FRAC = 0.8;

/**
 * What a Charged Shot released after `heldS` seconds does: frac = heldS / CHARGE_FULL_S, capped at 1.
 * It interrupts at frac ≥ CHARGE_INTERRUPT_FRAC, with 1e-9 of rounding slack (1.2 / 1.5 is 0.7999…).
 */
export function chargedShot(heldS: number): { frac: number; coef: number; stagger: number; momentum: number; interrupts: boolean } {
  const frac = Number.isFinite(heldS) ? Math.min(1, Math.max(0, heldS / CHARGE_FULL_S)) : 0;
  return { frac, coef: 1.5 + 3.0 * frac, stagger: 10 + 20 * frac, momentum: 15 * frac, interrupts: frac >= CHARGE_INTERRUPT_FRAC - 1e-9 };
}

export const ABILITIES: Record<AbilityId, AbilityData> = {
  slash: {
    id: 'slash', name: 'Slash', glyph: '⟋', desc: 'A quick cut that builds 20 Momentum.', weapon: 'blade',
    role: 'quick', kind: 'damage', cooldown: 4, range: MELEE_REACH, needsTarget: true, coef: 1.8, momentum: 20,
  },
  sunder: {
    id: 'sunder', name: 'Sunder', glyph: '✦', desc: 'Spends 50 Momentum on a heavy blow that leaves the target Marked and interrupts.', weapon: 'blade',
    role: 'finisher', kind: 'damage', cooldown: 6, range: MELEE_REACH, needsTarget: true, coef: 4.0, cost: 50, mark: 'marked', stagger: 10, interrupts: true,
  },
  parry: {
    id: 'parry', name: 'Parry', glyph: '◈', desc: 'Turns aside the next melee hit within 0.6 s: +20 Momentum, and the attacker reels.', weapon: 'blade',
    role: 'signature', kind: 'defence', cooldown: 8, range: 0, needsTarget: false,
  },
  snap_shot: {
    id: 'snap_shot', name: 'Snap Shot', glyph: '↣', desc: 'A quick arrow that builds 20 Momentum.', weapon: 'bow',
    role: 'quick', kind: 'damage', cooldown: 5, range: 18, needsTarget: true, coef: 2.0, momentum: 20,
  },
  pitch_arrow: {
    id: 'pitch_arrow', name: 'Pitch Arrow', glyph: '✷', desc: 'Spends 50 Momentum on a blazing arrow that leaves the target Burning.', weapon: 'bow',
    role: 'finisher', kind: 'damage', cooldown: 6, range: 18, needsTarget: true, coef: 3.2, cost: 50, mark: 'burning', stagger: 10,
  },
  charged_shot: {
    id: 'charged_shot', name: 'Charged Shot', glyph: '⇶', desc: 'Hold to draw, release to loose: stronger the longer you hold, up to 1.5 s.', weapon: 'bow',
    role: 'signature', kind: 'damage', cooldown: 7, range: 22, needsTarget: true, coef: 1.5, stagger: 10,
  },
  mend: {
    id: 'mend', name: 'Mend', glyph: '+', desc: 'Heals 30 health at once.', weapon: 'any',
    role: 'free', kind: 'heal', cooldown: 20, range: 0, needsTarget: false,
  },
  taunt: {
    id: 'taunt', name: 'Taunt', glyph: '!', desc: 'Makes the target attack you for 4 s.', weapon: 'any',
    role: 'free', kind: 'utility', cooldown: 12, range: TAUNT_RANGE, needsTarget: true,
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', glyph: '◆', desc: 'A shield that absorbs 25 damage for 6 s.', weapon: 'any',
    role: 'free', kind: 'defence', cooldown: 18, range: 0, needsTarget: false,
  },
  sprint: {
    id: 'sprint', name: 'Sprint', glyph: '»', desc: 'Run 40% faster for 4 s.', weapon: 'any',
    role: 'free', kind: 'utility', cooldown: 20, range: 0, needsTarget: false,
  },
};

export interface WeaponData { id: WeaponId; name: string; autoEvery: number; autoCoef: number; autoRange: number; bar: [AbilityId, AbilityId, AbilityId] }
export const WEAPONS: Record<WeaponId, WeaponData> = {
  blade: { id: 'blade', name: 'Blade', autoEvery: 1.2, autoCoef: 1.0, autoRange: MELEE_REACH, bar: ['slash', 'sunder', 'parry'] },
  bow: { id: 'bow', name: 'Bow', autoEvery: 1.5, autoCoef: 1.1, autoRange: 18, bar: ['snap_shot', 'pitch_arrow', 'charged_shot'] },
};

export const FREE_POOL: readonly AbilityId[] = ['mend', 'taunt', 'bulwark', 'sprint'];

export interface Loadout { weapon: WeaponId; free: [AbilityId, AbilityId] }
/** Treat as read-only: copy it (parseLoadout or a spread with a new `free`) before changing anything. */
export const DEFAULT_LOADOUT: Loadout = { weapon: 'blade', free: ['mend', 'bulwark'] };

/** The five slots: the weapon's quick, finisher and signature, then the two free picks. */
export function slotsFor(l: Loadout): AbilityId[] {
  return [...WEAPONS[l.weapon].bar, l.free[0], l.free[1]];
}

const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);

/** A fresh, clean Loadout, or null unless weapon is a weapon and free is two distinct FREE_POOL ids. */
export function parseLoadout(v: unknown): Loadout | null {
  if (typeof v !== 'object' || v === null) return null;
  const { weapon, free } = v as Record<string, unknown>;
  if (!own(WEAPONS, weapon) || !Array.isArray(free) || free.length !== 2) return null;
  const [a, b] = free as unknown[];
  if (!FREE_POOL.includes(a as AbilityId) || !FREE_POOL.includes(b as AbilityId) || a === b) return null;
  return { weapon: weapon as WeaponId, free: [a as AbilityId, b as AbilityId] };
}
