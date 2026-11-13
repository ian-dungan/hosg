// Final review I1: the process guard logs and counts unhandled rejections (and uncaught exceptions) and
// never ends the process; /healthz shows the counts.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { installProcessGuard, processFaults } from './processGuard';
import { startServer } from './rooms/testHelpers';

describe('the process guard (final review I1)', () => {
  it('counts every fault and logs at most once every 10 s', () => {
    const proc = new EventEmitter();
    const lines: unknown[][] = [];
    let t = 0;
    const before = { ...processFaults };
    installProcessGuard(proc as any, (...args) => lines.push(args), () => t);
    proc.emit('unhandledRejection', new Error('one'));
    proc.emit('unhandledRejection', new Error('two'));
    proc.emit('uncaughtException', new Error('three'));
    expect(processFaults.unhandledRejections - before.unhandledRejections).toBe(2);
    expect(processFaults.uncaughtExceptions - before.uncaughtExceptions).toBe(1);
    expect(lines.length).toBe(1);
    t = 10_000;
    proc.emit('unhandledRejection', new Error('four'));
    expect(lines.length).toBe(2);
  });

  it('keeps a real Node process running after an unhandled rejection (index.ts installs it)', async () => {
    const guard = fileURLToPath(new URL('./processGuard.ts', import.meta.url));
    const index = fileURLToPath(new URL('./index.ts', import.meta.url));
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(index, 'utf8')).toMatch(/installProcessGuard\(\)/);
    const script = `const { installProcessGuard, processFaults } = await import(${JSON.stringify(guard)});
installProcessGuard(process, () => {});
Promise.reject(new Error('nobody catches this'));
setTimeout(() => { console.log('alive ' + processFaults.unhandledRejections); }, 200);`;
    const out = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.on('exit', (code) => resolve({ code, stdout }));
    });
    expect(out).toEqual({ code: 0, stdout: 'alive 1\n' });
  }, 20_000);

  it('/healthz shows the counts', async () => {
    const { url, app } = await startServer();
    try {
      const health = await (await fetch(`${url}/healthz`)).json() as any;
      expect(health.unhandledRejections).toBe(processFaults.unhandledRejections);
      expect(health.uncaughtExceptions).toBe(processFaults.uncaughtExceptions);
    } finally {
      await app.close();
    }
  }, 20_000);
});
