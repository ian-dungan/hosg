// The GM role CLI: run on the server's shell, with DATABASE_URL set as for the server (see deploy/README.md).
//   npm run gm -w server -- grant|revoke <username> | list | audit [n]
//   docker compose exec sg2-server node server/dist/gm.js grant|revoke <username> | list | audit [n]
import { userInfo } from 'node:os';
import { GM_CLI_USAGE, runRoleCli } from '../src/gm/cli';
import { createPgStore } from '../src/store/pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Shady Grove 2 GM tool: DATABASE_URL is not set (the GM role lives in the database; there is no memory-store role).');
  console.error(GM_CLI_USAGE);
  process.exit(1);
}
let who = 'shell';
try {
  who = userInfo().username || who;
} catch {
  // (no user name on this system: recorded as "shell")
}
let code = 1;
try {
  const store = await createPgStore(databaseUrl);
  try {
    code = await runRoleCli(process.argv.slice(2), store, (line) => console.log(line), who);
  } finally {
    await store.close();
  }
} catch (err) {
  console.error(`Shady Grove 2 GM tool: ${(err as Error)?.message ?? String(err)}`);
}
process.exit(code);
