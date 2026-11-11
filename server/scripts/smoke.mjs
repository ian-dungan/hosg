// Browser smoke test of a running Shady Grove 2 server (Playwright, headless Chromium).
//   node server/scripts/smoke.mjs <url> [--kill "<command that kills the server>"]
// Two desktop guests and one iPhone 13 guest see "Adventurers online: 3"; A walks and B sees A move
// more than 2 m; A's markup-laden chat line reaches B as plain text; signing in to A's account from
// a new browser shows "Signed in somewhere else" on A; killing the server shows "Connection lost".
// Any page error fails the test. Browser console errors are not counted: Chrome logs refused
// reconnect attempts and failed requests there, which are expected.
// The server is killed at the end: by default with `fuser -k -9 <port>/tcp` (a server on this
// machine); for Docker pass --kill "docker compose kill sg2-server".
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kill: { type: 'string' } } });
if (positionals.length !== 1) {
  console.error('Usage: node server/scripts/smoke.mjs <url> [--kill "<command>"]');
  process.exit(2);
}
const url = new URL(positionals[0]);
const killCommand = values.kill ?? `fuser -k -9 ${url.port || 80}/tcp`;
const CHAT = 'hello <img src=x onerror=window.__pwned=1>';
const LOAD_MS = 180_000; // the first page load compiles a large bundle under software rendering
const WAIT_MS = 120_000;

const pageErrors = [];
const browser = await chromium.launch();

async function open(label, contextOptions, token) {
  const context = await browser.newContext(contextOptions);
  if (token) await context.addInitScript((t) => sessionStorage.setItem('sg2.token', t), token);
  const page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
  await page.goto(url.href, { timeout: LOAD_MS });
  const opened = { label, context, page };
  pages.push(opened);
  return opened;
}

/** Clicks "Play as guest" and returns the adventurer's name. */
async function playAsGuest({ page }) {
  await page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/guest'), { timeout: WAIT_MS }),
    page.click('button:has-text("Play as guest")'),
  ]);
  const body = await response.json();
  if (!body.name) throw new Error(`guest login failed: ${JSON.stringify(body)}`);
  return body.name;
}

const onlineIs = (n) => new RegExp(`Adventurers online: ${n}$`).test(document.querySelector('.sg-online')?.textContent ?? '');
const loginError = (expected) => document.querySelector('.sg-login-err')?.textContent === expected;

let step = 'start';
const pages = [];
async function check(name, fn) {
  step = name;
  const started = Date.now();
  await fn();
  console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/** What each open page shows, for a failure report. */
async function describePages() {
  const lines = [];
  for (const { label, page } of pages) {
    if (page.isClosed()) continue;
    const seen = await page
      .evaluate(() => ({
        online: document.querySelector('.sg-online')?.textContent ?? null,
        login: document.querySelector('.sg-login.in') ? document.querySelector('.sg-login-err')?.textContent || '(login screen)' : null,
      }))
      .catch((err) => ({ error: err.message }));
    lines.push(`  ${label}: ${JSON.stringify(seen)}`);
  }
  return lines.join('\n');
}

try {
  const desktop = { viewport: { width: 1280, height: 800 } };
  let a, b, c, aName;
  await check('the client loads in two desktop browsers and an iPhone 13', async () => {
    a = await open('A (desktop)', desktop);
    b = await open('B (desktop)', desktop);
    c = await open('C (iPhone 13)', { ...devices['iPhone 13'] });
  });

  await check('three guests each see "Adventurers online: 3"', async () => {
    [aName] = await Promise.all([playAsGuest(a), playAsGuest(b), playAsGuest(c)]);
    for (const { page } of [a, b, c]) await page.waitForFunction(onlineIs, 3, { timeout: WAIT_MS });
  });

  await check('A walks and B sees A move more than 2 m', async () => {
    const remoteA = (name) => window.__sg2net?.remotes.find((r) => r.name === name) ?? null;
    const start = await b.page.waitForFunction(remoteA, aName, { timeout: WAIT_MS }).then((h) => h.jsonValue());
    await a.page.keyboard.down('KeyW');
    try {
      await b.page.waitForFunction(
        ([name, x, z]) => {
          const r = window.__sg2net?.remotes.find((p) => p.name === name);
          return r && Math.hypot(r.x - x, r.z - z) > 2;
        },
        [aName, start.x, start.z],
        { timeout: 60_000, polling: 250 },
      );
    } finally {
      await a.page.keyboard.up('KeyW');
    }
  });

  await check('A\'s chat line reaches B as plain text', async () => {
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.insertText(CHAT); // typing key by key takes minutes on a starved page
    await a.page.keyboard.press('Enter');
    await b.page.waitForFunction(
      (text) => document.querySelector('.sg-chat-log')?.textContent?.includes(text),
      CHAT,
      { timeout: WAIT_MS },
    );
    for (const { label, page } of [a, b, c]) {
      if ((await page.evaluate(() => typeof window.__pwned)) !== 'undefined') throw new Error(`markup ran in ${label}`);
    }
  });

  // Fewer software-rendered pages from here on, so the new sign-in is not starved of CPU.
  await b.context.close();
  await c.context.close();

  let a2;
  await check('signing in to A\'s account elsewhere shows "Signed in somewhere else" on A', async () => {
    const token = await a.page.evaluate(() => sessionStorage.getItem('sg2.token'));
    if (!token) throw new Error('A has no saved token');
    a2 = await open('A again (desktop)', desktop, token); // the saved token is set again on every load
    // A starved headless page can miss the client's 15 s join timeout ("Cannot reach the server"):
    // load it again, at most four times. Any other outcome is checked below.
    for (let retries = 4; ; retries--) {
      const joined = await a2.page.waitForFunction(
        () => /Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '') ||
          document.querySelector('.sg-login-err')?.textContent || false,
        null,
        { timeout: WAIT_MS, polling: 250 },
      ).then((h) => h.jsonValue());
      if (joined !== 'Cannot reach the server' || retries === 0) break;
      console.log('     the second sign-in timed out on this busy machine; loading it again');
      await a2.page.reload({ timeout: LOAD_MS });
    }
    await a.page.waitForFunction(loginError, 'Signed in somewhere else', { timeout: WAIT_MS });
    await a2.page.waitForFunction(onlineIs, 1, { timeout: WAIT_MS });
  });

  await check('killing the server shows "Connection lost" within 60 s', async () => {
    console.log(`     running: ${killCommand}`);
    execSync(killCommand, { stdio: 'ignore' });
    await a2.page.waitForFunction(loginError, 'Connection lost', { timeout: 60_000, polling: 500 });
  });

  step = 'page errors';
  if (pageErrors.length) throw new Error(`${pageErrors.length} page errors:\n  ${pageErrors.join('\n  ')}`);
  console.log('ok   no page errors');
  console.log('PASS');
} catch (err) {
  console.log(`FAIL at "${step}": ${err instanceof Error ? err.message.split('\n').slice(0, 6).join('\n') : err}`);
  console.log(`pages:\n${await describePages()}`);
  if (pageErrors.length && step !== 'page errors') console.log(`page errors so far:\n  ${pageErrors.join('\n  ')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
