// The GM role CLI's logic (server/scripts/gm.ts runs it on the server's shell with DATABASE_URL). This is the ONLY
// way the role (accounts.is_gm) changes: no route, client message, chat command or environment default sets it.
// Every grant and revoke, done or refused, writes an audit row (gm_account null, command 'role').
import type { Store } from '../store/types';

export const GM_CLI_USAGE = [
  'Usage: npm run gm -w server -- <command>   (in Docker: docker compose exec sg2-server node server/dist/gm.js <command>)',
  '  grant <username>    make the account a game master',
  '  revoke <username>   take the role away (its next /gm line is refused)',
  '  list                every game master account',
  '  audit [n]           the newest n audit rows (default 50, at most 1000)',
].join('\n');

/** Runs one CLI command against `store`; `who` is the shell user (recorded in the audit row). Resolves the exit code. */
export async function runRoleCli(argv: readonly string[], store: Store, out: (line: string) => void, who: string): Promise<number> {
  const [command, arg, extra] = argv;
  switch (command) {
    case 'grant':
    case 'revoke': {
      if (typeof arg !== 'string' || arg.length < 1 || arg.length > 64 || extra !== undefined) {
        out(GM_CLI_USAGE);
        return 2;
      }
      const on = command === 'grant';
      const account = await store.findAccountByUsername(arg);
      let ok = false, result: string;
      if (!account) result = `No account is called ${arg}`;
      else if (on && account.isGuest) result = `${account.username} is a guest account: guests cannot be game masters`;
      else {
        ok = await store.setGm(account.username, on);
        result = ok ? (on ? `${account.username} is a game master now` : `${account.username} is not a game master any more`) : `${account.username} could not be changed`;
      }
      await store.logGm({ gmAccount: null, command: 'role', target: (account?.username ?? arg).slice(0, 64), args: { on, by: who.slice(0, 64) }, ok, result });
      out(result);
      return ok ? 0 : 1;
    }
    case 'list': {
      const gms = await store.listGms();
      out(gms.length === 0 ? 'No game masters.' : gms.join('\n'));
      return 0;
    }
    case 'audit': {
      const n = arg === undefined ? 50 : Number(arg);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        out(GM_CLI_USAGE);
        return 2;
      }
      for (const r of (await store.gmAudit(n)).reverse()) {
        out(`${r.at}  ${r.gmAccount ?? 'shell'}  ${r.command}  ${r.target ?? '-'}  ${r.ok ? 'ok' : 'refused'}  ${r.result}  ${JSON.stringify(r.args)}`);
      }
      return 0;
    }
    default:
      out(GM_CLI_USAGE);
      return 2;
  }
}
