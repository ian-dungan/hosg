// The entity ids a tap on each town booth reports (no engine id is negative; the Guild Board is -2). Kept apart from
// stalls.ts (Babylon) so the tap order can be tested without a scene.
import { STALL_IDS, type StallId } from '@sg2/shared';

export const STALL_EID: Readonly<Record<StallId, number>> = { smithy: -10, tailor: -11, barber: -12, lampwright: -13, vault: -14 };
export const stallOfEid = (eid: number | null): StallId | null => {
  for (const id of STALL_IDS) if (STALL_EID[id] === eid) return id;
  return null;
};
