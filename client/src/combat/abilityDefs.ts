// The shared ability data (@sg2/shared ABILITIES) as the HUD's AbilityDef: the button glyph, name, tooltip,
// cooldown, range and kind come from the one table the server uses.
import { ABILITIES, CHARGE_FULL_S, WEAPON_BARS, type AbilityData, type AbilityId } from '@sg2/shared';
import type { AbilityDef } from '../core/contracts';

/**
 * @deprecated Until Task 7: the Plan 3 weapon an ability is shown with (the Blade or Bow bar, else
 * 'any'), since the shared data now gives each ability a job instead.
 */
export function plan3WeaponOf(id: AbilityId): AbilityDef['weapon'] {
  if (WEAPON_BARS.blade.includes(id)) return 'blade';
  if (WEAPON_BARS.bow.includes(id)) return 'bow';
  return 'any';
}

/** One ability as the HUD shows it. */
export function abilityDef(a: AbilityData): AbilityDef {
  return {
    id: a.id, name: a.name, glyph: a.glyph, desc: a.desc,
    cooldown: a.cooldown, range: a.range,
    // Charged Shot is held: its "cast" is the time to a full charge
    castTime: a.id === 'charged_shot' ? CHARGE_FULL_S : 0,
    weapon: plan3WeaponOf(a.id), kind: a.kind,
  };
}

/** Every ability, by id. */
export const ABILITY_DEFS: Readonly<Record<AbilityId, AbilityDef>> = Object.fromEntries(
  (Object.keys(ABILITIES) as AbilityId[]).map((id) => [id, abilityDef(ABILITIES[id])]),
) as Record<AbilityId, AbilityDef>;
