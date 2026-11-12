// Browser smoke test of a running Shady Grove 2 server (Playwright, headless Chromium).
//   node server/scripts/smoke.mjs <url> [--kill "<command that kills the server>"] [--no-combat]
// Two desktop guests and one iPhone 13 guest see "Adventurers online: 3"; A walks and B sees A move
// more than 2 m; A jumps (Space) and B sees A more than 0.5 m up; A's markup-laden chat line reaches B
// as plain text; signing in to A's account from a new browser shows "Signed in somewhere else" on A;
// killing the server shows "Connection lost".
// Combat (start the server with SG2_START_ZONE=greenway, so every step runs in the Greenway): after the
// chat step A targets the nearest Thornling with Tab, walks into reach by tap-to-walk (a click on it) and
// kills it within 90 s (it shows dead in __sg2net.enemies, or the kill's credit is in the combat log; an
// enemy that merely left the view does not count), having taken damage on the way; then clears
// its target, walks to the next camp and stands there until "Defeated" shows (within 150 s), clicks
// "Return to the statue" and is in the grove at full health. A server whose adventurers start anywhere
// else fails, unless --no-combat is passed (then the combat steps are skipped, with a note).
// Any page error fails the test. Browser console errors are not counted: Chrome logs refused
// reconnect attempts and failed requests there, which are expected.
// The server is killed at the end. Only for a URL on this machine (localhost, 127.0.0.1 or ::1)
// with an explicit port is there a default, `fuser -k -9 <port>/tcp`; for Docker pass
// --kill "docker compose kill sg2-server". For any other URL, without --kill the "Connection lost"
// step is skipped (with a note) and the exit code reflects only the steps that ran.
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kill: { type: 'string' }, 'no-combat': { type: 'boolean' } } });
if (positionals.length !== 1) {
  console.error('Usage: node server/scripts/smoke.mjs <url> [--kill "<command>"] [--no-combat]');
  process.exit(2);
}
const url = new URL(positionals[0]);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']); // URL keeps the brackets on IPv6
// Never a default for a remote host (it would kill whatever holds that port HERE) or for a URL
// without an explicit port (that would be 80 or 443, typically another site's web server).
const killCommand = values.kill ?? (LOCAL_HOSTS.has(url.hostname) && url.port ? `fuser -k -9 ${url.port}/tcp` : null);
console.log(killCommand
  ? `smoke test of ${url.href}; the server will be killed with: ${killCommand}`
  : `smoke test of ${url.href}; no --kill given and the URL is not localhost/127.0.0.1/::1 with a port, so the "Connection lost" step will be skipped`);
const CHAT = 'hello <img src=x onerror=window.__pwned=1>';
const LOAD_MS = 180_000; // the first page load compiles a large bundle under software rendering
const WAIT_MS = 120_000;
const KILL_MS = 90_000;
const DEFEAT_MS = 150_000;

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
    page.click('button:has-text("Play as guest")', { timeout: WAIT_MS }),
  ]);
  const body = await response.json();
  if (!body.name) throw new Error(`guest login failed: ${JSON.stringify(body)}`);
  return body.name;
}

/** Waits until the page is in the room; a join that timed out on a starved page is tried again with "Continue as". */
async function rejoinIfStarved({ label, page }) {
  for (let retries = 4; ; retries--) {
    const joined = await page.waitForFunction(
      () => /Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '') ||
        document.querySelector('.sg-login.in .sg-login-err')?.textContent || false,
      null,
      { timeout: WAIT_MS, polling: 250 },
    ).then((h) => h.jsonValue());
    if (joined !== 'Cannot reach the server' || retries === 0) return;
    console.log(`     ${label}: the join timed out on this busy machine; "Continue as" again`);
    await page.click('.sg-login-continue', { timeout: WAIT_MS });
  }
}

const onlineIs = (n) => new RegExp(`Adventurers online: ${n}$`).test(document.querySelector('.sg-online')?.textContent ?? '');
const loginError = (expected) => document.querySelector('.sg-login-err')?.textContent === expected;

let step = 'start';
let minHp = 100;
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
    // Three software-rendered pages building the Greenway at once can miss the client's 15 s join timeout
    // ("Cannot reach the server", the account kept): "Continue as" joins again, at most four times.
    await Promise.all([a, b, c].map(rejoinIfStarved));
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

  await check('A jumps and B sees A more than 0.5 m up within 20 s', async () => {
    // Heights are measured from where A stands (the plaza is not at height 0).
    const remoteY = (name) => window.__sg2net?.remotes.find((r) => r.name === name)?.y ?? null;
    const before = await b.page.evaluate(remoteY, aName);
    if (typeof before !== 'number') throw new Error('B does not see A');
    await a.page.keyboard.press('Space');
    await b.page.waitForFunction(
      ([name, y0]) => (window.__sg2net?.remotes.find((r) => r.name === name)?.y ?? y0) > y0 + 0.5,
      [aName, before],
      { timeout: 20_000, polling: 100 },
    );
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

  // Fewer software-rendered pages from here on, so the fight and the new sign-in are not starved of CPU.
  await b.context.close();
  await c.context.close();

  const zone = await a.page.evaluate(() => window.__sg2net?.zone);
  if (values['no-combat']) {
    console.log(`skip the combat steps (--no-combat): A is in "${zone}"`);
  } else if (zone !== 'greenway') {
    await check('A starts in the Greenway, for the combat steps', async () => {
      throw new Error(`A is in "${zone}": start the server with SG2_START_ZONE=greenway, or pass --no-combat to skip the combat steps`);
    });
  } else {
    let thornling;
    await check('A targets the nearest Thornling with Tab, walks into reach by tap-to-walk and kills it within 90 s', async () => {
      // the nearest enemy (Tab picks the nearest first) is a Thornling at the Greenway's first camp
      await a.page.waitForFunction(() => (window.__sg2net?.enemies.length ?? 0) > 0, null, { timeout: WAIT_MS });
      await a.page.keyboard.press('Tab');
      thornling = await a.page.waitForFunction(() => {
        const t = window.__sg2net?.self?.target;
        const e = window.__sg2net?.enemies.find((v) => v.eid === t);
        return e ? { eid: e.eid, kind: e.kind } : null;
      }, null, { timeout: WAIT_MS, polling: 250 }).then((h) => h.jsonValue());
      if (thornling.kind !== 'thornling') throw new Error(`Tab picked a ${thornling.kind}, not a Thornling`);
      // turn toward it (where it stands, so nothing moves), then tap it (a click on its body): with
      // tap-to-walk on (the default) A walks into reach
      await a.page.evaluate((eid) => {
        const e = window.__sg2net.enemies.find((v) => v.eid === eid), rig = window.__sg2.rig, p = rig.position;
        rig.teleport(p.clone(), Math.atan2(e.x - p.x, e.z - p.z));
      }, thornling.eid);
      const at = await a.page.waitForFunction((eid) => {
        const e = window.__sg2net.enemies.find((v) => v.eid === eid);
        const pt = e && window.__sg2.screenOf(e.x, (window.__sg2.world.groundAt(e.x, e.z) ?? 0) + 0.6, e.z);
        return pt && pt.x > 0 && pt.y > 0 && pt.x < innerWidth && pt.y < innerHeight ? pt : null;
      }, thornling.eid, { timeout: WAIT_MS, polling: 500 }).then((h) => h.jsonValue());
      // kills credited before the fight, so one credited during it counts (the enemy may leave the view as it dies)
      const credits = () => a.page.evaluate(() => (window.__sg2.combat?.debug.log ?? []).filter((l) => l.e?.t === 'credit' && l.e.kind === 'thornling').length);
      const creditsBefore = await credits();
      await a.page.mouse.click(at.x, at.y);
      const started = Date.now();
      // fight: autos run by themselves; Slash and Sunder now and then
      for (;;) {
        const s = await a.page.evaluate((eid) => {
          const e = window.__sg2net.enemies.find((v) => v.eid === eid);
          return { dead: e?.mode === 'dead', hp: window.__sg2net.self?.hp ?? 100 };
        }, thornling.eid);
        minHp = Math.min(minHp, s.hp);
        if (s.dead || (await credits()) > creditsBefore) break;
        if (Date.now() - started > KILL_MS) {
          const seen = await a.page.evaluate((eid) => {
            const e = window.__sg2net.enemies.find((v) => v.eid === eid), p = window.__sg2.rig.position;
            return { enemy: e ?? null, distance: e ? Math.hypot(e.x - p.x, e.z - p.z) : null, self: window.__sg2net.self, refusals: window.__sg2.combat?.debug.refusals.slice(-5) };
          }, thornling.eid);
          throw new Error(`the Thornling is not dead after ${KILL_MS / 1000} s: ${JSON.stringify(seen)}`);
        }
        await a.page.keyboard.press('Digit2');
        await a.page.keyboard.press('Digit1');
        await a.page.waitForTimeout(500);
      }
    });

    await check('A took damage in the fight', async () => {
      if (!(minHp < 100)) throw new Error(`A's health never went below 100 (lowest ${minHp})`);
    });

    await check('A stands at the next camp until "Defeated" shows (within 150 s), returns to the statue and is in the grove at full health', async () => {
      await a.page.keyboard.press('Escape');
      // the next camp: the nearest live enemy at least 20 m from the first camp's Thornling. The next camp
      // is beyond this client's view (60 m), so A walks on east (the Greenway runs from its west gate east)
      // 15 m at a time until one comes into view, then walks to it and stands there.
      const first = await a.page.evaluate((eid) => {
        const e = window.__sg2net.enemies.find((v) => v.eid === eid);
        return e ? { x: e.x, z: e.z } : { x: window.__sg2.rig.position.x, z: window.__sg2.rig.position.z };
      }, thornling.eid);
      const walkTo = (to) => a.page.evaluate(({ x, z }) => {
        const V = window.__sg2.rig.position.constructor;
        return window.__sg2.game.walkTo(new V(x, window.__sg2.world.groundAt(x, z) ?? 0, z)); // tap-to-walk's own walk
      }, to);
      let goal = null;
      for (let probe = 0; probe < 12 && !goal; probe++) {
        goal = await a.page.evaluate((f) => {
          const me = window.__sg2.rig.position;
          const next = window.__sg2net.enemies.filter((v) => v.mode !== 'dead' && Math.hypot(v.x - f.x, v.z - f.z) > 20)
            .sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z))[0];
          return next ? { x: next.x, z: next.z } : null;
        }, first);
        if (goal) break;
        const me = await a.page.evaluate(() => ({ x: window.__sg2.rig.position.x, z: window.__sg2.rig.position.z }));
        for (const [dx, dz] of [[15, 0], [15, 10], [15, -10], [10, 15], [10, -15]]) if (await walkTo({ x: me.x + dx, z: me.z + dz })) break;
        await a.page.waitForFunction(() => !window.__sg2.game.walking, null, { timeout: WAIT_MS, polling: 500 });
      }
      if (!goal) throw new Error('no other camp came into view');
      await walkTo(goal);
      await a.page.waitForFunction(() => /Defeated/.test(document.querySelector('.sg-end-title')?.textContent ?? ''), null, { timeout: DEFEAT_MS, polling: 500 });
      // the button wakes after DEATH_MIN_S
      await a.page.waitForSelector('.sg-end-btn:not(.waiting):has-text("Return to the statue")', { timeout: WAIT_MS });
      await a.page.click('.sg-end-btn:has-text("Return to the statue")', { timeout: WAIT_MS });
      await a.page.waitForFunction(() => window.__sg2net?.zone === 'grove' && window.__sg2net.self?.hp === 100 && !window.__sg2net.self.dead,
        null, { timeout: WAIT_MS, polling: 500 });
    });
  }

  let a2;
  async function joinA2() {
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
  }

  await check('signing in to A\'s account elsewhere shows "Signed in somewhere else" on A', async () => {
    const token = await a.page.evaluate(() => sessionStorage.getItem('sg2.token'));
    if (!token) throw new Error('A has no saved token');
    // Shrink A's page first: software rendering costs CPU per pixel, and a full-size A starves the
    // new page's join. (Freezing A with CDP does not stop its rendering.) A stays connected.
    await a.page.setViewportSize({ width: 160, height: 120 });
    a2 = await open('A again (desktop)', desktop, token); // the saved token is set again on every load
    await joinA2();
    await a.page.waitForFunction(loginError, 'Signed in somewhere else', { timeout: WAIT_MS });
    await a2.page.waitForFunction(onlineIs, 1, { timeout: WAIT_MS });
  });

  if (!killCommand) {
    console.log('skip killing the server shows "Connection lost": the URL is not localhost/127.0.0.1/::1 with a port,');
    console.log('     so nothing is killed by default; pass --kill "<command that kills the server>" to run this step');
  } else await check('killing the server shows "Connection lost" within 60 s', async () => {
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
