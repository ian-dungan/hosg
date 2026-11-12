// Marks left by finishers. A finisher detonates every other live mark (a combo), then leaves its own.
import { MARK_S } from './constants';

export type MarkId = 'soaked' | 'burning' | 'marked';
export const MARK_BITS: Record<MarkId, number> = { soaked: 1, burning: 2, marked: 4 };
/** Mark -> the time (s) it expires. */
export type Marks = Partial<Record<MarkId, number>>;

const ORDER: readonly MarkId[] = ['soaked', 'burning', 'marked'];

/** The marks live at nowS (expiry after nowS), in the order soaked, burning, marked. */
export function liveMarks(marks: Marks, nowS: number): MarkId[] {
  return ORDER.filter((m) => (marks[m] ?? -Infinity) > nowS);
}

/**
 * A finisher leaving `mark` lands: every other live mark detonates and is removed (returned, in
 * liveMarks order), expired marks are dropped, and `mark` is set (or refreshed) to nowS + MARK_S.
 * Mutates `marks`.
 */
export function applyFinisherMark(marks: Marks, mark: MarkId, nowS: number): MarkId[] {
  const detonated = liveMarks(marks, nowS).filter((m) => m !== mark);
  for (const m of ORDER) if (m !== mark) delete marks[m];
  marks[mark] = nowS + MARK_S;
  return detonated;
}

/** The live marks as MARK_BITS flags. */
export function markBits(marks: Marks, nowS: number): number {
  let bits = 0;
  for (const m of liveMarks(marks, nowS)) bits |= MARK_BITS[m];
  return bits;
}
