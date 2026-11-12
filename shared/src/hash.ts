// cyrb53: a fast, well-mixed 53-bit string hash (integer arithmetic only, so every runtime agrees).
// Used for the name blocklist (seed BLOCKLIST_SEED) and to seed default looks.

/** The seed the name blocklist's hashes are made with. */
export const BLOCKLIST_SEED = 0x5e2;

/** A 53-bit hash of `s` (a safe integer), the same on server and client. */
export function cyrb53(s: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A blocklist hash: cyrb53 with BLOCKLIST_SEED, in base 36. */
export const blockHash = (s: string): string => cyrb53(s, BLOCKLIST_SEED).toString(36);
