// The shared ability data (@sg2/shared ABILITIES) as the HUD's AbilityDef: the button glyph, name, tooltip,
// cooldown, cast time, range, job and kind come from the one table the server uses.
import { ABILITIES, CHARGE_FULL_S, type AbilityData, type AbilityId } from '@sg2/shared';
import type { AbilityDef } from '../core/contracts';

/** One ability as the HUD shows it. */
export function abilityDef(a: AbilityData): AbilityDef {
  const d: AbilityDef = {
    id: a.id, name: a.name, glyph: a.glyph, desc: a.desc,
    cooldown: a.cooldown, range: a.range,
    // Charged Shot is held: its "cast" is the time to a full charge
    castTime: a.id === 'charged_shot' ? CHARGE_FULL_S : a.cast ?? 0,
    job: a.job, support: !!a.support, kind: a.kind,
  };
  if (a.element) d.element = a.element;
  return d;
}

/** Every ability, by id. */
export const ABILITY_DEFS: Readonly<Record<AbilityId, AbilityDef>> = Object.fromEntries(
  (Object.keys(ABILITIES) as AbilityId[]).map((id) => [id, abilityDef(ABILITIES[id])]),
) as Record<AbilityId, AbilityDef>;
