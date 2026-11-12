// Weapons, abilities and loadouts. Every ability belongs to exactly one job (JOBS, jobs.ts): its bar
// (quick, finisher, signature) or its pool of four picks. `effects` is exactly what the ability does.
import { MELEE_REACH } from './constants';
import type { ElementId } from './elements';
import { JOBS, isJobId, type JobId } from './jobs';
import type { MarkId } from './marks';
import { deepFreeze } from './freeze';
// abilities.ts ⇄ jobs.ts import each other: neither may read the other's exports at the top level
// (only inside functions), or one of them would see the other uninitialised.

export type WeaponId = 'blade' | 'bow' | 'sword' | 'greatsword' | 'daggers' | 'staff';
export type AbilityId =
  // Warrior
  | 'slash' | 'sunder' | 'parry' | 'rallying_roar' | 'skullringer' | 'mend' | 'bulwark'
  // Ranger
  | 'snap_shot' | 'pitch_arrow' | 'charged_shot' | 'pinning_shot' | 'field_dressing' | 'sprint' | 'barbed_rain'
  // Paladin
  | 'shield_rap' | 'bright_verdict' | 'aegis' | 'taunt' | 'shelter' | 'kindle' | 'dawn_ward'
  // Dark Knight
  | 'grim_rend' | 'nightfall' | 'crimson_pact' | 'bloodbond' | 'dread_howl' | 'umbral_brand' | 'grave_ward'
  // Ninja
  | 'crossed_fangs' | 'hamstring' | 'ghost_edge' | 'ashcloud' | 'weak_point' | 'quickstep' | 'mist_form'
  // Black Mage
  | 'cinder_dart' | 'skyfall_arc' | 'hearthfall' | 'kindred_spark' | 'bastion_stone' | 'rootbreak' | 'stormcage'
  // White Mage
  | 'tidelash' | 'lantern_flare' | 'wellspring' | 'second_dawn' | 'soft_rain' | 'mistveil' | 'sun_mote';

/** How an ability's subject is found (resolveAim, effects.ts). */
export type Aim = 'enemy' | 'self' | 'ally' | 'other-ally' | 'dead-ally';
export type BuffId = 'roar' | 'aegis' | 'aegis_ally' | 'sheltered' | 'rain' | 'pact' | 'mist' | 'bloodbond';
export type DebuffId = 'blinded' | 'weakpoint';
/** Buff flags on adventurers: aegis and aegis_ally share a bit. */
export const BUFF_BITS: Readonly<Record<BuffId, number>> = deepFreeze({ roar: 1, aegis: 2, aegis_ally: 2, sheltered: 4, rain: 8, pact: 16, mist: 32, bloodbond: 64 });
export const DEBUFF_BITS: Readonly<Record<DebuffId, number>> = deepFreeze({ blinded: 1, weakpoint: 2 });

/** An area effect counts from the caster, includes it (except 'others'), and needs no sight: `r` is required. */
export type Effect =
  | { readonly k: 'damage'; readonly coef: number; readonly splash?: { readonly r: number; readonly frac: number }; readonly behind?: true }
  /** lowest: the lowest-hp adventurer within ALLY_RANGE, self included. */
  | { readonly k: 'heal'; readonly amount: number; readonly on: 'aim' | 'self' | 'lowest' }
  | { readonly k: 'shield'; readonly amount: number; readonly s: number; readonly on: 'aim' | 'self' }
  | { readonly k: 'shield'; readonly amount: number; readonly s: number; readonly on: 'area'; readonly r: number }
  | { readonly k: 'buff'; readonly buff: BuffId; readonly s: number; readonly on: 'aim' | 'self' }
  /** others: the area without the caster. */
  | { readonly k: 'buff'; readonly buff: BuffId; readonly s: number; readonly on: 'area' | 'others'; readonly r: number }
  | { readonly k: 'debuff'; readonly debuff: DebuffId; readonly s: number; readonly on: 'target' }
  /** area: live enemies within r of the caster. */
  | { readonly k: 'debuff'; readonly debuff: DebuffId; readonly s: number; readonly on: 'area'; readonly r: number }
  | { readonly k: 'momentum'; readonly amount: number; readonly on: 'aim' | 'self' }
  | { readonly k: 'taunt'; readonly on: 'target' }
  | { readonly k: 'taunt'; readonly on: 'area'; readonly r: number }
  | { readonly k: 'threat-drop'; readonly r: number }
  | { readonly k: 'revive'; readonly frac: number }
  | { readonly k: 'hp-cost'; readonly amount: number }
  | { readonly k: 'dodge-refill'; readonly charges: number }
  | { readonly k: 'parry'; readonly s: number }
  | { readonly k: 'sprint'; readonly scale: number; readonly s: number }
  | { readonly k: 'charge' }
  | { readonly k: 'cleanse' };

/** How the brain uses an ability. */
export type AiUse = 'damage' | 'finisher' | 'charge' | 'never' | 'selfHeal' | 'allyHeal' | 'allyBigHeal' | 'healParty'
  | 'shieldSelf' | 'shieldAlly' | 'shieldParty' | 'buffParty' | 'selfBuff' | 'aegis' | 'revive' | 'tauntIfNotMe'
  | 'interrupt' | 'threatDrop' | 'momentumGift' | 'debuff' | 'dodgeRefill' | 'mist' | 'shelter';

/**
 * Element, reactions, weakness and OVERFLOW_MULT apply only to an ability's `damage` effects: an
 * element on an ability that does no damage (Bastion Stone, Wellspring, Soft Rain, Mistveil) is cosmetic.
 */
export interface AbilityData {
  readonly id: AbilityId; readonly name: string; readonly glyph: string; readonly desc: string; readonly job: JobId;
  readonly role: 'quick' | 'finisher' | 'signature' | 'pick'; readonly kind: 'damage' | 'heal' | 'defence' | 'utility';
  /** needsTarget === (aim === 'enemy'). */
  readonly aim: Aim; readonly needsTarget: boolean;
  /** range: 0 = self, MELEE_REACH = melee (to the edge of the target's radius). */
  readonly cooldown: number; readonly range: number;
  /** cast: seconds (absent or 0 = instant). school: cosmetic only. */
  readonly cast?: number; readonly element?: ElementId; readonly school?: 'light';
  /** momentum: built on use; cost: spent; primer: sets or refreshes `mark` without detonating anything. */
  readonly momentum?: number; readonly cost?: number; readonly mark?: MarkId; readonly primer?: true; readonly stagger?: number; readonly interrupts?: boolean;
  readonly effects: readonly Effect[]; readonly support?: true; readonly ai: AiUse;
}

// ───────── effect numbers the Plan 3 rows describe ─────────
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

const M = MELEE_REACH;
export const ABILITIES: Readonly<Record<AbilityId, AbilityData>> = deepFreeze({
  // ───────── Warrior ─────────
  slash: {
    id: 'slash', name: 'Slash', glyph: '⟋', desc: 'A quick cut that builds 20 Momentum.', job: 'warrior',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 4, range: M, momentum: 20,
    effects: [{ k: 'damage', coef: 1.8 }], ai: 'damage',
  },
  sunder: {
    id: 'sunder', name: 'Sunder', glyph: '✦', desc: 'Spends 50 Momentum on a heavy blow that leaves the target Marked and interrupts.', job: 'warrior',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: M, cost: 50, mark: 'marked', stagger: 10, interrupts: true,
    effects: [{ k: 'damage', coef: 4.0 }], ai: 'finisher',
  },
  parry: {
    id: 'parry', name: 'Parry', glyph: '◈', desc: 'Turns aside the next melee hit within 0.6 s: +20 Momentum, and the attacker reels.', job: 'warrior',
    role: 'signature', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 8, range: 0,
    effects: [{ k: 'parry', s: PARRY_WINDOW_S }], ai: 'never',
  },
  rallying_roar: {
    id: 'rallying_roar', name: 'Rallying Roar', glyph: '⇑', desc: 'You and adventurers within 10 m deal 20% more damage for 8 s.', job: 'warrior',
    role: 'pick', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 30, range: 0,
    effects: [{ k: 'buff', buff: 'roar', s: 8, on: 'area', r: 10 }], support: true, ai: 'buffParty',
  },
  skullringer: {
    id: 'skullringer', name: 'Skullringer', glyph: '⊛', desc: 'A ringing blow that leaves the target Dazed, staggers hard and interrupts.', job: 'warrior',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 12, range: M, mark: 'dazed', primer: true, stagger: 30, interrupts: true,
    effects: [{ k: 'damage', coef: 1.5 }], support: true, ai: 'interrupt',
  },
  mend: {
    id: 'mend', name: 'Mend', glyph: '+', desc: 'Heals 30 health at once.', job: 'warrior',
    role: 'pick', kind: 'heal', aim: 'self', needsTarget: false, cooldown: 20, range: 0,
    effects: [{ k: 'heal', amount: MEND_HEAL, on: 'self' }], ai: 'selfHeal',
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', glyph: '◆', desc: 'A shield that absorbs 25 damage for 6 s.', job: 'warrior',
    role: 'pick', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 18, range: 0,
    effects: [{ k: 'shield', amount: BULWARK_ABSORB, s: BULWARK_S, on: 'self' }], ai: 'shieldSelf',
  },
  // ───────── Ranger ─────────
  snap_shot: {
    id: 'snap_shot', name: 'Snap Shot', glyph: '↣', desc: 'A quick arrow that builds 20 Momentum.', job: 'ranger',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 5, range: 18, momentum: 20,
    effects: [{ k: 'damage', coef: 2.0 }], ai: 'damage',
  },
  pitch_arrow: {
    id: 'pitch_arrow', name: 'Pitch Arrow', glyph: '✷', desc: 'Spends 50 Momentum on a blazing arrow that leaves the target Burning.', job: 'ranger',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: 18, cost: 50, mark: 'burning', stagger: 10,
    effects: [{ k: 'damage', coef: 3.2 }], ai: 'finisher',
  },
  charged_shot: {
    id: 'charged_shot', name: 'Charged Shot', glyph: '⇶', desc: 'Hold to draw, release to loose: stronger the longer you hold, up to 1.5 s.', job: 'ranger',
    role: 'signature', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 7, range: 22, stagger: 10,
    effects: [{ k: 'charge' }], ai: 'charge',
  },
  pinning_shot: {
    id: 'pinning_shot', name: 'Pinning Shot', glyph: '⤓', desc: 'An arrow that leaves the target Rooted, slowing it.', job: 'ranger',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 10, range: 18, mark: 'rooted', primer: true,
    effects: [{ k: 'damage', coef: 1.2 }], support: true, ai: 'damage',
  },
  field_dressing: {
    id: 'field_dressing', name: 'Field Dressing', glyph: '✚', desc: 'Heals 25 health on your focused ally, or the most hurt one nearby.', job: 'ranger',
    role: 'pick', kind: 'heal', aim: 'ally', needsTarget: false, cooldown: 18, range: 18,
    effects: [{ k: 'heal', amount: 25, on: 'aim' }], support: true, ai: 'allyHeal',
  },
  sprint: {
    id: 'sprint', name: 'Sprint', glyph: '»', desc: 'Run 40% faster for 4 s.', job: 'ranger',
    role: 'pick', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 20, range: 0,
    effects: [{ k: 'sprint', scale: SPRINT_SCALE, s: SPRINT_S }], ai: 'never',
  },
  barbed_rain: {
    id: 'barbed_rain', name: 'Barbed Rain', glyph: '⋮', desc: 'A volley that hits the target and every enemy within 3 m of it.', job: 'ranger',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 10, range: 18,
    effects: [{ k: 'damage', coef: 1.4, splash: { r: 3, frac: 1 } }], ai: 'damage',
  },
  // ───────── Paladin ─────────
  shield_rap: {
    id: 'shield_rap', name: 'Shield Rap', glyph: '◐', desc: 'A quick shield strike that builds 20 Momentum and leaves the target Marked.', job: 'paladin',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 5, range: M, momentum: 20, mark: 'marked', primer: true, stagger: 10,
    effects: [{ k: 'damage', coef: 1.3 }], ai: 'damage',
  },
  bright_verdict: {
    id: 'bright_verdict', name: 'Bright Verdict', glyph: '☼', desc: 'Spends 50 Momentum on a shining blow that leaves the target Dazed and interrupts.', job: 'paladin',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: M, cost: 50, mark: 'dazed', stagger: 10, interrupts: true,
    effects: [{ k: 'damage', coef: 3.4 }], ai: 'finisher',
  },
  aegis: {
    id: 'aegis', name: 'Aegis', glyph: '⬡', desc: 'For 4 s you take 60% less damage, and adventurers within 8 m take 30% less.', job: 'paladin',
    role: 'signature', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 16, range: 0,
    effects: [{ k: 'buff', buff: 'aegis', s: 4, on: 'self' }, { k: 'buff', buff: 'aegis_ally', s: 4, on: 'others', r: 8 }], ai: 'aegis',
  },
  taunt: {
    id: 'taunt', name: 'Taunt', glyph: '!', desc: 'Makes the target attack you for 4 s.', job: 'paladin',
    role: 'pick', kind: 'utility', aim: 'enemy', needsTarget: true, cooldown: 12, range: TAUNT_RANGE,
    effects: [{ k: 'taunt', on: 'target' }], support: true, ai: 'tauntIfNotMe',
  },
  shelter: {
    id: 'shelter', name: 'Shelter', glyph: '⌂', desc: 'For 8 s you take half of the damage your focused ally takes.', job: 'paladin',
    role: 'pick', kind: 'defence', aim: 'other-ally', needsTarget: false, cooldown: 20, range: 12,
    effects: [{ k: 'buff', buff: 'sheltered', s: 8, on: 'aim' }], support: true, ai: 'shelter',
  },
  kindle: {
    id: 'kindle', name: 'Kindle', glyph: '✧', desc: 'Heals 25 health on your focused ally, or the most hurt one nearby, then 10 on you.', job: 'paladin',
    role: 'pick', kind: 'heal', aim: 'ally', needsTarget: false, cooldown: 14, range: 18,
    effects: [{ k: 'heal', amount: 25, on: 'aim' }, { k: 'heal', amount: 10, on: 'self' }], support: true, ai: 'allyHeal',
  },
  dawn_ward: {
    id: 'dawn_ward', name: 'Dawn Ward', glyph: '◎', desc: 'You and adventurers within 8 m gain a shield of 20 for 6 s.', job: 'paladin',
    role: 'pick', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 22, range: 0,
    effects: [{ k: 'shield', amount: 20, s: 6, on: 'area', r: 8 }], support: true, ai: 'shieldParty',
  },
  // ───────── Dark Knight ─────────
  grim_rend: {
    id: 'grim_rend', name: 'Grim Rend', glyph: '⟍', desc: 'Costs 3 health: a quick cleave that builds 20 Momentum.', job: 'dark_knight',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 4, range: M, momentum: 20,
    effects: [{ k: 'hp-cost', amount: 3 }, { k: 'damage', coef: 1.6 }], ai: 'damage',
  },
  nightfall: {
    id: 'nightfall', name: 'Nightfall', glyph: '☾', desc: 'Spends 50 Momentum on a dark blow that leaves the target Burning.', job: 'dark_knight',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: M, cost: 50, mark: 'burning', stagger: 10,
    effects: [{ k: 'damage', coef: 3.8 }], ai: 'finisher',
  },
  crimson_pact: {
    id: 'crimson_pact', name: 'Crimson Pact', glyph: '⊗', desc: 'Costs 15 health: for 6 s you deal 20% more damage and your lifesteal doubles.', job: 'dark_knight',
    role: 'signature', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 24, range: 0,
    effects: [{ k: 'hp-cost', amount: 15 }, { k: 'buff', buff: 'pact', s: 6, on: 'self' }], ai: 'selfBuff',
  },
  bloodbond: {
    id: 'bloodbond', name: 'Bloodbond', glyph: '∞', desc: 'For 8 s each lifesteal heal also heals the most hurt adventurer within 15 m.', job: 'dark_knight',
    role: 'pick', kind: 'heal', aim: 'self', needsTarget: false, cooldown: 20, range: 0,
    effects: [{ k: 'buff', buff: 'bloodbond', s: 8, on: 'self' }], support: true, ai: 'buffParty',
  },
  dread_howl: {
    id: 'dread_howl', name: 'Dread Howl', glyph: '⁂', desc: 'Every enemy within 8 m attacks you for 4 s.', job: 'dark_knight',
    role: 'pick', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 20, range: 0,
    effects: [{ k: 'taunt', on: 'area', r: 8 }], support: true, ai: 'tauntIfNotMe',
  },
  umbral_brand: {
    id: 'umbral_brand', name: 'Umbral Brand', glyph: '⌖', desc: 'A brand that leaves the target Dazed.', job: 'dark_knight',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 10, range: M, mark: 'dazed', primer: true,
    effects: [{ k: 'damage', coef: 1.2 }], ai: 'damage',
  },
  grave_ward: {
    id: 'grave_ward', name: 'Grave Ward', glyph: '▣', desc: 'Costs 10 health: a shield that absorbs 30 damage for 6 s.', job: 'dark_knight',
    role: 'pick', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 18, range: 0,
    effects: [{ k: 'hp-cost', amount: 10 }, { k: 'shield', amount: 30, s: 6, on: 'self' }], ai: 'shieldSelf',
  },
  // ───────── Ninja ─────────
  crossed_fangs: {
    id: 'crossed_fangs', name: 'Crossed Fangs', glyph: '⋎', desc: 'A quick double cut that builds 20 Momentum and leaves the target Marked.', job: 'ninja',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 3.5, range: M, momentum: 20, mark: 'marked', primer: true,
    effects: [{ k: 'damage', coef: 1.3 }], ai: 'damage',
  },
  hamstring: {
    id: 'hamstring', name: 'Hamstring', glyph: '⊻', desc: 'Spends 50 Momentum on a crippling cut that leaves the target Rooted.', job: 'ninja',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: M, cost: 50, mark: 'rooted', stagger: 10,
    effects: [{ k: 'damage', coef: 3.2 }], ai: 'finisher',
  },
  ghost_edge: {
    id: 'ghost_edge', name: 'Ghost Edge', glyph: '⟁', desc: 'A strike that always counts as from behind; builds 15 Momentum.', job: 'ninja',
    role: 'signature', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 8, range: M, momentum: 15,
    effects: [{ k: 'damage', coef: 2.4, behind: true }], ai: 'damage',
  },
  ashcloud: {
    id: 'ashcloud', name: 'Ashcloud', glyph: '≈', desc: 'Enemies within 6 m forget you and are Blinded for 3 s.', job: 'ninja',
    role: 'pick', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 24, range: 0,
    effects: [{ k: 'threat-drop', r: 6 }, { k: 'debuff', debuff: 'blinded', s: 3, on: 'area', r: 6 }], support: true, ai: 'threatDrop',
  },
  weak_point: {
    id: 'weak_point', name: 'Weak Point', glyph: '⊙', desc: 'Everyone deals 15% more damage to the target for 8 s.', job: 'ninja',
    role: 'pick', kind: 'utility', aim: 'enemy', needsTarget: true, cooldown: 20, range: 12,
    effects: [{ k: 'debuff', debuff: 'weakpoint', s: 8, on: 'target' }], support: true, ai: 'debuff',
  },
  quickstep: {
    id: 'quickstep', name: 'Quickstep', glyph: '⇥', desc: 'Refills one dodge charge.', job: 'ninja',
    role: 'pick', kind: 'utility', aim: 'self', needsTarget: false, cooldown: 15, range: 0,
    effects: [{ k: 'dodge-refill', charges: 1 }], ai: 'dodgeRefill',
  },
  mist_form: {
    id: 'mist_form', name: 'Mist Form', glyph: '░', desc: 'For 5 s enemy auto-attacks miss you.', job: 'ninja',
    role: 'pick', kind: 'defence', aim: 'self', needsTarget: false, cooldown: 18, range: 0,
    effects: [{ k: 'buff', buff: 'mist', s: 5, on: 'self' }], ai: 'mist',
  },
  // ───────── Black Mage ─────────
  cinder_dart: {
    id: 'cinder_dart', name: 'Cinder Dart', glyph: '⟡', desc: 'A quick fire dart that builds 20 Momentum.', job: 'black_mage',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 4, range: 18, element: 'fire', momentum: 20,
    effects: [{ k: 'damage', coef: 1.5 }], ai: 'damage',
  },
  skyfall_arc: {
    id: 'skyfall_arc', name: 'Skyfall Arc', glyph: 'ϟ', desc: 'Cast 1.2 s, spends 50 Momentum: lightning that leaves the target Dazed and interrupts.', job: 'black_mage',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: 18, cast: 1.2, element: 'lightning',
    cost: 50, mark: 'dazed', stagger: 15, interrupts: true,
    effects: [{ k: 'damage', coef: 4.0 }], ai: 'finisher',
  },
  hearthfall: {
    id: 'hearthfall', name: 'Hearthfall', glyph: '⊚', desc: 'Cast 2.5 s: a falling fire that also burns every enemy within 4 m of the target.', job: 'black_mage',
    role: 'signature', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 15, range: 18, cast: 2.5, element: 'fire',
    effects: [{ k: 'damage', coef: 5.5, splash: { r: 4, frac: 0.5 } }], ai: 'damage',
  },
  kindred_spark: {
    id: 'kindred_spark', name: 'Kindred Spark', glyph: '✶', desc: 'Gives your focused ally 30 Momentum, and you 10.', job: 'black_mage',
    role: 'pick', kind: 'utility', aim: 'other-ally', needsTarget: false, cooldown: 20, range: 15,
    effects: [{ k: 'momentum', amount: 30, on: 'aim' }, { k: 'momentum', amount: 10, on: 'self' }], support: true, ai: 'momentumGift',
  },
  bastion_stone: {
    id: 'bastion_stone', name: 'Bastion Stone', glyph: '▲', desc: 'Cast 1 s: a stone shield of 30 for 8 s on your focused ally, or the most hurt one nearby.', job: 'black_mage',
    role: 'pick', kind: 'defence', aim: 'ally', needsTarget: false, cooldown: 18, range: 18, cast: 1.0, element: 'earth',
    effects: [{ k: 'shield', amount: 30, s: 8, on: 'aim' }], support: true, ai: 'shieldAlly',
  },
  rootbreak: {
    id: 'rootbreak', name: 'Rootbreak', glyph: '⌬', desc: 'Cast 1 s: earth that leaves the target Rooted.', job: 'black_mage',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 10, range: 18, cast: 1.0, element: 'earth', mark: 'rooted', primer: true,
    effects: [{ k: 'damage', coef: 1.6 }], support: true, ai: 'damage',
  },
  stormcage: {
    id: 'stormcage', name: 'Stormcage', glyph: '⌗', desc: 'A snap of lightning that staggers and interrupts.', job: 'black_mage',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 12, range: 18, element: 'lightning', stagger: 20, interrupts: true,
    effects: [{ k: 'damage', coef: 0.8 }], support: true, ai: 'interrupt',
  },
  // ───────── White Mage ─────────
  tidelash: {
    id: 'tidelash', name: 'Tidelash', glyph: '∿', desc: 'A quick lash of water that builds 20 Momentum and leaves the target Soaked.', job: 'white_mage',
    role: 'quick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 4, range: 18, element: 'water', momentum: 20, mark: 'soaked', primer: true,
    effects: [{ k: 'damage', coef: 1.4 }], ai: 'damage',
  },
  lantern_flare: {
    id: 'lantern_flare', name: 'Lantern Flare', glyph: '✺', desc: 'Cast 1 s, spends 50 Momentum: light that leaves the target Marked, then heals the most hurt adventurer 20.', job: 'white_mage',
    role: 'finisher', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 6, range: 18, cast: 1.0, school: 'light', cost: 50, mark: 'marked',
    effects: [{ k: 'damage', coef: 3.6 }, { k: 'heal', amount: 20, on: 'lowest' }], ai: 'finisher',
  },
  wellspring: {
    id: 'wellspring', name: 'Wellspring', glyph: '❂', desc: 'Cast 1.5 s: heals your focused ally, or the most hurt one nearby, 45 and cleanses them.', job: 'white_mage',
    role: 'signature', kind: 'heal', aim: 'ally', needsTarget: false, cooldown: 8, range: 18, cast: 1.5, element: 'water',
    effects: [{ k: 'heal', amount: 45, on: 'aim' }, { k: 'cleanse' }], ai: 'allyBigHeal',
  },
  second_dawn: {
    id: 'second_dawn', name: 'Second Dawn', glyph: '☥', desc: 'Cast 3 s: brings a fallen adventurer back with 40% health.', job: 'white_mage',
    role: 'pick', kind: 'heal', aim: 'dead-ally', needsTarget: false, cooldown: 60, range: 12, cast: 3.0, school: 'light',
    effects: [{ k: 'revive', frac: 0.4 }], support: true, ai: 'revive',
  },
  soft_rain: {
    id: 'soft_rain', name: 'Soft Rain', glyph: '⁘', desc: 'You and adventurers within 10 m heal 4 each second for 6 s.', job: 'white_mage',
    role: 'pick', kind: 'heal', aim: 'self', needsTarget: false, cooldown: 20, range: 0, element: 'water',
    effects: [{ k: 'buff', buff: 'rain', s: 6, on: 'area', r: 10 }], support: true, ai: 'healParty',
  },
  mistveil: {
    id: 'mistveil', name: 'Mistveil', glyph: '◌', desc: 'A shield of 25 for 6 s on your focused ally, or the most hurt one nearby.', job: 'white_mage',
    role: 'pick', kind: 'defence', aim: 'ally', needsTarget: false, cooldown: 15, range: 18, element: 'water',
    effects: [{ k: 'shield', amount: 25, s: 6, on: 'aim' }], support: true, ai: 'shieldAlly',
  },
  sun_mote: {
    id: 'sun_mote', name: 'Sun Mote', glyph: '✹', desc: 'Cast 0.8 s: a mote of light that builds 15 Momentum.', job: 'white_mage',
    role: 'pick', kind: 'damage', aim: 'enemy', needsTarget: true, cooldown: 8, range: 18, cast: 0.8, school: 'light', momentum: 15,
    effects: [{ k: 'damage', coef: 2.2 }], ai: 'damage',
  },
});

/** The bar belongs to the job (JOBS[id].bar). */
export interface WeaponData { readonly id: WeaponId; readonly name: string; readonly autoEvery: number; readonly autoCoef: number; readonly autoRange: number }
export const WEAPONS: Readonly<Record<WeaponId, WeaponData>> = deepFreeze({
  blade: { id: 'blade', name: 'Blade', autoEvery: 1.2, autoCoef: 1.0, autoRange: M },
  bow: { id: 'bow', name: 'Bow', autoEvery: 1.5, autoCoef: 1.1, autoRange: 18 },
  sword: { id: 'sword', name: 'Sword and Shield', autoEvery: 1.4, autoCoef: 1.0, autoRange: M },
  greatsword: { id: 'greatsword', name: 'Greatsword', autoEvery: 1.8, autoCoef: 1.2, autoRange: M },
  daggers: { id: 'daggers', name: 'Twin Daggers', autoEvery: 0.9, autoCoef: 0.6, autoRange: M },
  staff: { id: 'staff', name: 'Staff', autoEvery: 1.6, autoCoef: 1.0, autoRange: 16 },
});

/** The damage coefficient of an ability's `damage` effect (0 if it has none). */
export function damageCoef(ab: AbilityData): number {
  for (const e of ab.effects) if (e.k === 'damage') return e.coef;
  return 0;
}

// ───────── loadouts ─────────
export interface Loadout { job: JobId; picks: [AbilityId, AbilityId] }
/** Frozen: copy it (parseLoadout or a spread with new `picks`) to get one to change. */
export const DEFAULT_LOADOUT: Readonly<Loadout> = deepFreeze<Loadout>({ job: 'warrior', picks: ['mend', 'bulwark'] });

/** The five slots: the job's quick, finisher and signature, then the two picks. */
export function slotsFor(l: Readonly<Loadout>): AbilityId[] {
  return [...JOBS[l.job].bar, l.picks[0], l.picks[1]];
}

const own = (o: object, k: unknown): boolean => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const inPool = (job: JobId, id: unknown) => (JOBS[job].pool as readonly unknown[]).includes(id);

/** A fresh, clean Loadout, or null unless job is a JobId and picks is two distinct ids of that job's pool. */
export function parseLoadout(v: unknown): Loadout | null {
  if (typeof v !== 'object' || v === null) return null;
  const { job, picks } = v as Record<string, unknown>;
  if (!isJobId(job) || !Array.isArray(picks) || picks.length !== 2) return null;
  const [a, b] = picks as unknown[];
  if (!inPool(job, a) || !inPool(job, b) || a === b) return null;
  return { job, picks: [a as AbilityId, b as AbilityId] };
}

const LEGACY_JOB: Record<'blade' | 'bow', JobId> = { blade: 'warrior', bow: 'ranger' };
/**
 * A Plan 3 loadout `{ weapon, free }` as a job: blade → Warrior, bow → Ranger. `free` is kept if it is
 * two distinct ids of that job's pool, otherwise the job's solo picks. Null unless weapon is blade or bow.
 */
export function legacyLoadout(v: unknown): Loadout | null {
  if (typeof v !== 'object' || v === null) return null;
  const { weapon, free } = v as Record<string, unknown>;
  if (!own(LEGACY_JOB, weapon)) return null;
  const job = LEGACY_JOB[weapon as 'blade' | 'bow'];
  return parseLoadout({ job, picks: free }) ?? { job, picks: [JOBS[job].picks.solo[0], JOBS[job].picks.solo[1]] };
}

// ───────── transitional (Task 2 deletes all of this) ─────────
/** @deprecated The Warrior's and Ranger's bars, for callers that read Plan 3's WEAPONS[w].bar. */
export const WEAPON_BARS: Record<'blade' | 'bow', readonly AbilityId[]> = {
  blade: ['slash', 'sunder', 'parry'],
  bow: ['snap_shot', 'pitch_arrow', 'charged_shot'],
};
/**
 * @deprecated Plan 3's loadout, which the engine still runs on until Task 2: a Blade or Bow bar plus
 * two of Plan 3's four free picks (mend, taunt, bulwark, sprint), with any weapon.
 */
export interface Plan3Loadout { weapon: 'blade' | 'bow'; free: [AbilityId, AbilityId] }
/** @deprecated Plan 3's four free picks. */
export const PLAN3_FREE_POOL: readonly AbilityId[] = ['mend', 'taunt', 'bulwark', 'sprint'];
/** @deprecated Plan 3's default loadout. */
export const PLAN3_DEFAULT_LOADOUT: Plan3Loadout = { weapon: 'blade', free: ['mend', 'bulwark'] };
/** @deprecated Plan 3's parseLoadout: a fresh copy, or null unless weapon is blade/bow and free two distinct PLAN3_FREE_POOL ids. */
export function parsePlan3Loadout(v: unknown): Plan3Loadout | null {
  if (typeof v !== 'object' || v === null) return null;
  const { weapon, free } = v as Record<string, unknown>;
  if (!own(WEAPON_BARS, weapon) || !Array.isArray(free) || free.length !== 2) return null;
  const [a, b] = free as unknown[];
  if (!PLAN3_FREE_POOL.includes(a as AbilityId) || !PLAN3_FREE_POOL.includes(b as AbilityId) || a === b) return null;
  return { weapon: weapon as 'blade' | 'bow', free: [a as AbilityId, b as AbilityId] };
}
/** @deprecated Plan 3's slotsFor. */
export function plan3Slots(l: Plan3Loadout): AbilityId[] {
  return [...WEAPON_BARS[l.weapon], l.free[0], l.free[1]];
}
/**
 * @deprecated What the engine runs for a stored loadout until Task 2: a Plan 3 loadout as it is; a
 * Warrior or Ranger Loadout as its Plan 3 weapon (picks kept when both are Plan 3 free picks, else
 * Plan 3's defaults); anything else as PLAN3_DEFAULT_LOADOUT. Always a fresh copy.
 */
export function plan3LoadoutOf(v: unknown): Plan3Loadout {
  const p3 = parsePlan3Loadout(v);
  if (p3) return p3;
  const l = parseLoadout(v);
  const weapon = l?.job === 'ranger' ? 'bow' : 'blade';
  const free: [AbilityId, AbilityId] = l && (l.job === 'warrior' || l.job === 'ranger') && PLAN3_FREE_POOL.includes(l.picks[0]) && PLAN3_FREE_POOL.includes(l.picks[1])
    ? [l.picks[0], l.picks[1]] : [PLAN3_DEFAULT_LOADOUT.free[0], PLAN3_DEFAULT_LOADOUT.free[1]];
  return { weapon, free };
}
