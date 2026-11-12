// An enemy's threat table: who it is angry with, and whom it attacks.
import { TARGET_SWITCH_MULT, TAUNT_BONUS, TAUNT_MULT, TAUNT_S } from './constants';

export class ThreatTable {
  private readonly threat = new Map<number, number>();
  private forced: number | null = null;
  private forcedUntil = -Infinity;

  /** Adds `amount` to id's threat (entering it in the table at 0 first). */
  add(id: number, amount: number): void {
    this.threat.set(id, (this.threat.get(id) ?? 0) + (Number.isFinite(amount) ? amount : 0));
  }
  remove(id: number): void {
    this.threat.delete(id);
    if (this.forced === id) this.forced = null;
  }
  clear(): void {
    this.threat.clear();
    this.forced = null;
  }
  has(id: number): boolean { return this.threat.has(id); }
  /** Ids in the order they entered the table. */
  ids(): number[] { return [...this.threat.keys()]; }

  /** id's threat becomes the top threat × TAUNT_MULT + TAUNT_BONUS, and it is the forced target for TAUNT_S. */
  taunt(id: number, nowS: number): void {
    let top = 0;
    for (const v of this.threat.values()) top = Math.max(top, v);
    this.threat.set(id, top * TAUNT_MULT + TAUNT_BONUS);
    this.forced = id;
    this.forcedUntil = nowS + TAUNT_S;
  }

  /**
   * The forced target while a taunt lasts (and it is valid); else the valid id with the most threat
   * (the earliest on a tie), but `current` (if valid and in the table) is kept unless that id has at
   * least TARGET_SWITCH_MULT × current's threat. Null when no id is valid.
   */
  choose(current: number | null, nowS: number, valid: (id: number) => boolean): number | null {
    if (this.forced !== null && nowS < this.forcedUntil && this.threat.has(this.forced) && valid(this.forced)) return this.forced;
    let top: number | null = null, topV = -Infinity;
    for (const [id, v] of this.threat) if (v > topV && valid(id)) { top = id; topV = v; }
    if (top === null || current === null || current === top || !this.threat.has(current) || !valid(current)) return top;
    return topV >= this.threat.get(current)! * TARGET_SWITCH_MULT ? top : current;
  }
}
