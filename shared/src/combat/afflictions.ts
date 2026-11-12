// Afflictions: stacking harms a boss lays on adventurers. Searing comes from the Fallen Warden's autos:
// each landed auto adds a stack (to maxStacks) and refreshes its expiry to now + s; each stack makes the
// adventurer take (1 + takenPerStack × stacks) enemy damage, after its other taken multipliers.
import { deepFreeze } from './freeze';

export type AfflictionId = 'searing';
export interface AfflictionData {
  readonly id: AfflictionId; readonly name: string;
  readonly maxStacks: number;
  /** Seconds a stack lasts after the last one landed. */
  readonly s: number;
  /** Extra enemy damage taken per stack. */
  readonly takenPerStack: number;
  /** Its bit in an adventurer's view (`afflictionBits`). */
  readonly bit: number;
}

export const AFFLICTIONS: Readonly<Record<AfflictionId, AfflictionData>> = deepFreeze({
  searing: { id: 'searing', name: 'Searing', maxStacks: 5, s: 8, takenPerStack: 0.10, bit: 1 },
});

export const AFFLICTION_IDS: readonly AfflictionId[] = deepFreeze(['searing']);

/** The bits of the afflictions with at least one stack (missing or bad counts are none). */
export function afflictionBits(stacks: Readonly<Partial<Record<AfflictionId, number>>>): number {
  let bits = 0;
  for (const id of AFFLICTION_IDS) {
    const n = stacks[id];
    if (typeof n === 'number' && n > 0) bits |= AFFLICTIONS[id].bit;
  }
  return bits;
}
