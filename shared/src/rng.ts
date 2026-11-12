// A tiny seeded generator (mulberry32) for code that must not pull in world generation: the same numbers
// as `prng` in world/recipe.ts for the same seed. Integer maths only.

/** A generator of numbers in [0, 1) from a 32-bit seed. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
