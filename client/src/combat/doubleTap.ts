// A double tap of a movement key (or a flick of the touch joystick the same way twice) asks for a dodge.

/** Two presses of the same key at most this far apart (ms) are a double tap. */
export const DOUBLE_TAP_MS = 250;

export interface DoubleTap {
  /** A key went down at `tMs`; true when it completes a double tap. Key auto-repeat (`repeat`) never counts. */
  down(key: string, tMs: number, repeat?: boolean): boolean;
  /** Forget the last press (focus lost, a dodge already fired). */
  reset(): void;
}

export function createDoubleTap(windowMs = DOUBLE_TAP_MS): DoubleTap {
  let lastKey: string | null = null;
  let lastAt = -Infinity;
  return {
    down(key, tMs, repeat = false) {
      if (repeat) return false;
      const hit = key === lastKey && tMs - lastAt <= windowMs;
      if (hit) { lastKey = null; lastAt = -Infinity; return true; }
      lastKey = key; lastAt = tMs;
      return false;
    },
    reset() { lastKey = null; lastAt = -Infinity; },
  };
}
