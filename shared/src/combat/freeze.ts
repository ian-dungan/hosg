// Rule tables are shared by the engine, the server and the client: they are frozen all the way down,
// so nothing can change a number at run time. No imports: safe to call at the top level of any module.

/** Freezes `o` and everything reachable from it; returns it. */
export function deepFreeze<T>(o: T): T {
  if (typeof o === 'object' && o !== null && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}
