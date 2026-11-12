// Elements and reactions. Only Staff spells carry an element. An elemental hit on a target carrying
// the element's reacting mark (other than the hit's own mark) consumes that mark and reacts.
import { ELEMENT_RESIST_MULT, ELEMENT_WEAK_MULT } from './constants';
import type { EnemyKindData } from './enemies';
import type { MarkId } from './marks';

export type ElementId = 'fire' | 'water' | 'lightning' | 'earth';
export type ReactionId = 'blast' | 'conduct' | 'steam' | 'bedrock';

/** Each element's reacting mark and the reaction it triggers. */
export const REACTIONS: Record<ElementId, { mark: MarkId; reaction: ReactionId }> = {
  fire: { mark: 'marked', reaction: 'blast' },
  lightning: { mark: 'soaked', reaction: 'conduct' },
  water: { mark: 'burning', reaction: 'steam' },
  earth: { mark: 'dazed', reaction: 'bedrock' },
};

/** The reaction an `element` hit triggers against `liveMarks`, or null (no element, no reacting mark, or that mark is the hit's own). */
export function reactionFor(element: ElementId | undefined, liveMarks: readonly MarkId[], ownMark?: MarkId): ReactionId | null {
  if (element === undefined || !Object.prototype.hasOwnProperty.call(REACTIONS, element)) return null;
  const r = REACTIONS[element];
  if (r.mark === ownMark || !liveMarks.includes(r.mark)) return null;
  return r.reaction;
}

/** 1, ELEMENT_WEAK_MULT or ELEMENT_RESIST_MULT for `element` damage against `kind`. */
export function elementMult(element: ElementId | undefined, kind: EnemyKindData): number {
  if (element === undefined) return 1;
  if (kind.weak === element) return ELEMENT_WEAK_MULT;
  if (kind.resist === element) return ELEMENT_RESIST_MULT;
  return 1;
}
