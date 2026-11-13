// Who answers a tap on the 3D view when several things are under the finger, in this order: an enemy (combat), a
// story NPC or prop (the quest's talk flow), a town booth (the gear screens), then the rest (an adventurer, the
// ground: the combat controller and tap-to-walk). Pure, so the order is tested.
import type { TapInfo } from '../core/contracts';

export type TapRoute = 'enemy' | 'story' | 'booth' | 'rest';

export function routeTap(
  tap: TapInfo,
  is: { enemy: (eid: number) => boolean; story: (eid: number) => boolean; booth: (eid: number) => boolean },
): TapRoute {
  const ids = tap.entityIds ?? (tap.entityId === null ? [] : [tap.entityId]);
  let story = false, booth = false;
  for (const e of ids) {
    if (is.enemy(e)) return 'enemy';
    if (is.story(e)) story = true;
    else if (is.booth(e)) booth = true;
  }
  return story ? 'story' : booth ? 'booth' : 'rest';
}

/** The first booth entity under a tap, or null. */
export function firstOf(tap: TapInfo, pick: (eid: number) => boolean): number | null {
  const ids = tap.entityIds ?? (tap.entityId === null ? [] : [tap.entityId]);
  for (const e of ids) if (pick(e)) return e;
  return null;
}

/**
 * The story spot a tap routed to the story (routeTap) is about: the first one in the hit list, whatever stands in
 * front of it (an adventurer in the crowd round an NPC, your own body; an enemy in front already routed to combat).
 */
export function storyOfTap<T>(tap: TapInfo, idOf: (eid: number) => T | null): T | null {
  const ids = tap.entityIds ?? (tap.entityId === null ? [] : [tap.entityId]);
  for (const e of ids) { const id = idOf(e); if (id !== null) return id; }
  return null;
}
