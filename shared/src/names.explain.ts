// Maintainer tool: why a name is refused, naming the blocklist entry by its fixture index and showing the
// matched letters ROT13-encoded only, so no plain entry is printed. Tests and scripts only: never import
// this from index.ts or shipped code (it pulls in the fixture).
import { blockHash } from './hash';
import { offensiveMatches } from './names';
import { LONG_FIXTURE, SHORT_FIXTURE, rot13 } from './names.fixture';

const collapse = (s: string) => s.replace(/(.)\1+/g, '$1');

/** Fixture indexes by hash, for each list. */
const index = (list: readonly string[]) => {
  const m = new Map<string, number[]>();
  list.forEach((enc, i) => {
    const h = blockHash(collapse(rot13(enc)));
    m.set(h, [...(m.get(h) ?? []), i]);
  });
  return m;
};
let byHash: { long: Map<string, number[]>; short: Map<string, number[]> } | undefined;

/** One line per distinct match: the list, the fixture index or indexes, and the matched letters in ROT13. */
export function explain(name: string): string[] {
  byHash ??= { long: index(LONG_FIXTURE), short: index(SHORT_FIXTURE) };
  const lines = offensiveMatches(name).map((m) => {
    const ids = byHash![m.kind].get(m.hash) ?? [];
    return `${m.kind} #${ids.join(',#') || '?'} window (rot13) ${rot13(m.window)}`;
  });
  return [...new Set(lines)];
}
