// Maintainer tool: prints why each name given is refused (fixture index and ROT13 window), or "ok".
//   npx tsx shared/scripts/blocklist-explain.ts "Some Name" "Another"
import { explain } from '../src/names.explain';
import { validateAdventurerName } from '../src/names';

for (const name of process.argv.slice(2)) {
  const lines = explain(name);
  console.log(`${JSON.stringify(name)}: ${validateAdventurerName(name) ?? 'ok'}`);
  for (const line of lines) console.log(`  ${line}`);
}
