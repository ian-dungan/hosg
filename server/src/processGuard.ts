// The last line of defence: an unhandled promise rejection or an uncaught exception anywhere in the
// process is logged (at most once every LOG_EVERY_MS, with the count) and counted in /healthz, and the
// server carries on (Node 22 would otherwise end the process, and everyone's session with it).

/** Faults caught by the guard since the process started (read by /healthz). */
export const processFaults = { unhandledRejections: 0, uncaughtExceptions: 0 };

const LOG_EVERY_MS = 10_000;

interface Emitter {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  on(event: 'uncaughtException', listener: (err: Error) => void): unknown;
}

/** Installs the guard on `proc` (the process by default); `log` and `now` are for tests. */
export function installProcessGuard(proc: Emitter = process, log: (...args: unknown[]) => void = console.error, now: () => number = Date.now): void {
  let loggedAt = -Infinity;
  const report = (what: string, err: unknown) => {
    const t = now();
    if (t - loggedAt < LOG_EVERY_MS) return;
    loggedAt = t;
    const { unhandledRejections, uncaughtExceptions } = processFaults;
    log(`Shady Grove 2 server: ${what} (carrying on; ${unhandledRejections} unhandled rejections and ${uncaughtExceptions} uncaught exceptions so far, logged at most once every ${LOG_EVERY_MS / 1000} s):`, err);
  };
  proc.on('unhandledRejection', (reason) => {
    processFaults.unhandledRejections++;
    report('an unhandled promise rejection', reason);
  });
  proc.on('uncaughtException', (err) => {
    processFaults.uncaughtExceptions++;
    report('an uncaught exception', err);
  });
}
