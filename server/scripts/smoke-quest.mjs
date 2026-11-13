// Browser smoke test of the opening quest's first three beats on a running Shady Grove 2 server (Playwright, headless).
//   node server/scripts/smoke-quest.mjs <url> [--kill "<command that kills the server>"] [--shots <dir>]
// A server with default switches (new adventurers in the grove) and SG2_CLIENT_DIR=client/dist-online. Page A (iPhone 13)
// and page B (desktop), both guests:
// 1. A passes the creator with "Surprise me" and Done and stands in the grove; the tracker reads "Speak with Old Marrow".
// 2. A taps Old Marrow (where __sg2.screenOf puts him), walks over and pages through his dialogue: step pim_find.
// 3. A taps the pointer chip and is walked to the tavern; Pim's call shows (a dialogue by Pim); A taps Jump: step pim;
//    A taps Pim and pages through: step plaque.
// 4. A reloads: still at plaque. A taps the plaque and reads it: a questDone with scene 'beacon' arrives and the Beacon
//    is raised (beaconRaised).
// 5. B (in the grove all along) never gets a quest message about A (its quests view stays its own, at Marrow, and it
//    has no questDone), and B's bytes received in the 20 s before and after A's plaque differ by under 5%.
// 6. Killing the server shows "Connection lost". Any page error fails the test.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kill: { type: 'string' }, shots: { type: 'string' } } });
if (positionals.length !== 1) {
  console.error('Usage: node server/scripts/smoke-quest.mjs <url> [--kill "<command>"] [--shots <dir>]');
  process.exit(2);
}
const shots = values.shots ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (p, name) => { if (shots) await p.page.screenshot({ path: `${shots}/quest-${name}.png` }); };
const serverDir = fileURLToPath(new URL('..', import.meta.url));
// the main quest's step ids, in order (from @sg2/shared)
const STEP_IDS = JSON.parse(execFileSync('npx', ['tsx', '-e', `import { QUESTS } from '@sg2/shared'; console.log(JSON.stringify(QUESTS.solstice_crossing.steps.map((s) => s.id)))`], { cwd: serverDir, encoding: 'utf8' }).trim().split('\n').pop());
const url = new URL(positionals[0]);
const page0 = new URL(url.href);
page0.searchParams.set('lockq', '');
page0.searchParams.set('checks', ''); // the page's window.__sg2 hooks (playtests and browser checks only)
const killCommand = values.kill ?? null;
console.log(`quest smoke test of ${url.href}; ${killCommand ? `the server will be killed with: ${killCommand}` : 'no --kill given: the "Connection lost" step is skipped'}`);
const LOAD_MS = 300_000;
const WAIT_MS = 180_000;
const WINDOW_MS = 20_000;

const pageErrors = [];
const pages = [];
const browser = await chromium.launch();
async function open(label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
  const p = { label, context, page, frames: [] };
  // every websocket frame this page receives (time, bytes): B's bandwidth around A's plaque
  page.on('websocket', (ws) => ws.on('framereceived', (f) => p.frames.push([Date.now(), typeof f.payload === 'string' ? f.payload.length : f.payload.byteLength])));
  await page.goto(page0.href, { timeout: LOAD_MS, waitUntil: 'domcontentloaded' });
  pages.push(p);
  return p;
}
const ev = (p, f, arg) => p.page.evaluate(f, arg);
const waitFor = (p, f, arg, ms, why) => p.page.waitForFunction(f, arg, { timeout: ms, polling: 300 }).then((h) => h.jsonValue(), () => { throw new Error(`${p.label}: ${why}`); });
const inRoom = (p) => waitFor(p, () => /Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '') && !!window.__sg2net?.self, null, WAIT_MS * 2, 'never stood in its room');
const stepIs = (p, id) => waitFor(p, (sid) => {
  const q = window.__sg2net.quests?.active.find((a) => a.id === 'solstice_crossing');
  return q && window.__sg2quest?.ids[q.step] === sid ? true : null;
}, id, WAIT_MS, `the main quest never reached ${id} (it is at ${JSON.stringify(null)})`);
/** Pages through the open dialogue (a tap on its panel each page) until it closes. */
async function readDialogue(p, why) {
  await waitFor(p, () => !!document.querySelector('.sg-dlg'), null, WAIT_MS, `no dialogue (${why})`);
  const speaker = await ev(p, () => document.querySelector('.sg-dlg-name')?.textContent ?? '');
  for (let n = 0; n < 40 && (await ev(p, () => !!document.querySelector('.sg-dlg'))); n++) {
    await ev(p, () => { const el = document.querySelector('.sg-dlg-sheet .sg-dlg-panel') ?? document.querySelector('.sg-dlg'); el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await p.page.waitForTimeout(700);
  }
  return speaker;
}
/** Pages through any dialogue that opens (a step's done line, Marrow's words round the Beacon) until none has been open for `quiet` ms. */
async function settle(p, quiet = 3000, ms = 60_000) {
  const until = Date.now() + ms;
  let lastOpen = Date.now();
  while (Date.now() < until) {
    if (!(await ev(p, () => !!document.querySelector('.sg-dlg')))) { if (Date.now() - lastOpen > quiet) return; await p.page.waitForTimeout(400); continue; }
    lastOpen = Date.now();
    await ev(p, () => { const el = document.querySelector('.sg-dlg-sheet .sg-dlg-panel') ?? document.querySelector('.sg-dlg'); el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    await p.page.waitForTimeout(700);
  }
}
/** The plaque itself: on the statue's plinth (client world/storyNpcs.ts PLAQUE), not its talk spot on the ground in front. */
const PLAQUE_AT = { x: 0, y: 1.42, z: -2.62 };
/** Taps story spot `id` on A's screen (where screenOf puts it, `up` m above the ground; the plaque where it hangs). */
async function tapSpot(p, id, up = 1) {
  const at = await waitFor(p, ([sid, h, pl]) => {
    const s = window.__sg2net.story.find((v) => v.id === sid);
    const pt = sid === 'plaque' ? window.__sg2.screenOf(pl.x, pl.y, pl.z) : s && window.__sg2.screenOf(s.x, (window.__sg2.world.groundAt(s.x, s.z) ?? 0) + h, s.z);
    return pt && pt.x > 4 && pt.y > 4 && pt.x < innerWidth - 4 && pt.y < innerHeight - 4 ? pt : null;
  }, [id, up, PLAQUE_AT], WAIT_MS, `${id} never came on screen`);
  await p.page.touchscreen.tap(at.x, at.y);
}

let step = 'start';
async function check(name, fn) {
  step = name;
  const started = Date.now();
  await fn();
  console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}
const guest = async (p, surprise) => {
  await p.page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
  await p.page.click('button:has-text("Play as guest")');
  await p.page.waitForSelector('.sg-cr-foot button.done:not([disabled])', { timeout: WAIT_MS });
  if (surprise) await p.page.click('.sg-cr-foot button:has-text("Surprise me")');
  await p.page.click('.sg-cr-foot button.done');
  await inRoom(p);
};

try {
  let a, b;
  await check('A (iPhone 13) and B (desktop) pass the creator ("Surprise me" for A) and stand in the grove', async () => {
    a = await open('A (iPhone 13)', { ...devices['iPhone 13'] });
    b = await open('B (desktop)', { viewport: { width: 1280, height: 800 } });
    await Promise.all([guest(a, true), guest(b, false)]);
    for (const p of [a, b]) await ev(p, (ids) => { window.__sg2quest = { ids }; }, STEP_IDS);
    const zone = await ev(a, () => window.__sg2net.zone);
    if (zone !== 'grove') throw new Error(`A is in ${zone}, not the grove`);
  });

  await check('the tracker reads "Speak with Old Marrow"', async () => {
    await waitFor(a, () => window.__sg2net.tracker?.lines.some((l) => /Speak with Old Marrow/.test(l)) || null, null, WAIT_MS, `the tracker reads ${JSON.stringify(null)}`);
    await shot(a, '1-tracker');
  });

  await check('A taps Old Marrow, walks over and pages through: step pim_find', async () => {
    // (a first hint card may stand over the world: closed first)
    await ev(a, () => document.querySelector('.sg-qhint .sg-gs-x, .sg-qh-x, .sg-hint-x')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await tapSpot(a, 'marrow', 1);
    await shot(a, '2-marrow-tapped');
    const who = await readDialogue(a, 'Old Marrow');
    if (!/Marrow/.test(who)) throw new Error(`the dialogue is by "${who}", not Old Marrow`);
    await stepIs(a, 'pim_find');
    await settle(a);
  });

  await check('A taps the pointer chip and arrives at the tavern; Pim\'s call shows; A taps Jump: step pim', async () => {
    await waitFor(a, () => !!window.__sg2net.pointer && !document.querySelector('.sg-dlg'), null, WAIT_MS, 'no pointer');
    await shot(a, '3-pointer');
    await ev(a, () => document.querySelector('.sg-qp')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    const who = await readDialogue(a, 'Pim\'s call');
    console.log(`     the call on arriving is by "${who}"`);
    if (!/Pim/.test(who)) throw new Error(`the call is by "${who}", not Pim`);
    await stepIs(a, 'pim_hop');
    await settle(a);
    await shot(a, '4-pim-hop');
    for (let n = 0; n < 6; n++) {
      await a.page.locator('.sg-ab-jump').first().tap({ timeout: WAIT_MS });
      const ok = await a.page.waitForFunction(() => window.__sg2net.quests?.active[0]?.step >= window.__sg2quest.ids.indexOf('pim'), null, { timeout: 10_000, polling: 300 }).then(() => true, () => false);
      if (ok) break;
    }
    await stepIs(a, 'pim');
  });

  await check('A taps Pim and pages through: step plaque', async () => {
    await tapSpot(a, 'pim', 1);
    const who = await readDialogue(a, 'Pim');
    if (!/Pim/.test(who)) throw new Error(`the dialogue is by "${who}", not Pim`);
    await stepIs(a, 'plaque');
    await settle(a);
    await shot(a, '5-plaque-step');
  });

  await check('A reloads and is still at plaque', async () => {
    await a.page.reload({ timeout: LOAD_MS, waitUntil: 'domcontentloaded' });
    await inRoom(a);
    await ev(a, (ids) => { window.__sg2quest = { ids }; }, STEP_IDS);
    await stepIs(a, 'plaque');
  });

  let plaqueAt = 0;
  await check('A reads the plaque: questDone with scene beacon, and the Beacon is raised', async () => {
    // to the plaque first: the pointer chip walks there (tap-to-walk)
    await settle(a);
    await waitFor(a, () => !!window.__sg2net.pointer || null, null, WAIT_MS, 'no pointer to the plaque');
    await ev(a, () => document.querySelector('.sg-qp')?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await waitFor(a, () => { const s = window.__sg2net.story.find((v) => v.id === 'plaque'), r = window.__sg2.rig.position; return (s && Math.hypot(s.x - r.x, s.z - r.z) < 3.5 && !window.__sg2.game.walking) || null; }, null, WAIT_MS, 'never walked to the plaque');
    await tapSpot(a, 'plaque', 0.8);
    await readDialogue(a, 'the plaque');
    await waitFor(a, () => window.__sg2net.questDone.some((g) => g.scene === 'beacon') || null, null, WAIT_MS, 'no questDone with scene beacon');
    plaqueAt = Date.now();
    // Old Marrow speaks before the Beacon scene (and after it): paged through; the Beacon is up once the scene has played
    await settle(a, 5000, WAIT_MS);
    await waitFor(a, () => window.__sg2net.beaconRaised || null, null, WAIT_MS, 'the Beacon was not raised');
    await shot(a, '6-beacon');
  });

  await check('B never gets a quest message about A, and its bytes around A\'s plaque differ by under 5%', async () => {
    await b.page.waitForTimeout(Math.max(0, plaqueAt + WINDOW_MS - Date.now()) + 500);
    const got = await ev(b, () => ({ done: window.__sg2net.questDone.length, step: window.__sg2net.quests?.active.find((q) => q.id === 'solstice_crossing')?.step ?? null }));
    if (got.done !== 0 || got.step !== 0) throw new Error(`B's quest state moved: ${JSON.stringify(got)}`);
    const bytes = (from, to) => b.frames.filter(([t]) => t >= from && t < to).reduce((n, [, l]) => n + l, 0);
    const before = bytes(plaqueAt - WINDOW_MS, plaqueAt), after = bytes(plaqueAt, plaqueAt + WINDOW_MS);
    const diff = Math.abs(after - before) / Math.max(1, before);
    console.log(`     B received ${before} bytes in the 20 s before A's plaque and ${after} after (${(diff * 100).toFixed(1)}%)`);
    if (!(diff < 0.05)) throw new Error(`B's bytes differ by ${(diff * 100).toFixed(1)}% (${before} before, ${after} after)`);
  });

  if (!killCommand) console.log('skip killing the server shows "Connection lost" (no --kill)');
  else await check('killing the server shows "Connection lost"', async () => {
    execSync(killCommand, { stdio: 'ignore' });
    await waitFor(a, () => document.querySelector('.sg-login-err')?.textContent === 'Connection lost', null, 90_000, 'no "Connection lost"');
  });

  step = 'page errors';
  if (pageErrors.length) throw new Error(`${pageErrors.length} page errors:\n  ${pageErrors.join('\n  ')}`);
  console.log('ok   no page errors');
  console.log('PASS');
} catch (err) {
  console.log(`FAIL at "${step}": ${err instanceof Error ? err.message.split('\n').slice(0, 8).join('\n') : err}`);
  if (shots) for (const p of pages) if (!p.page.isClosed()) await p.page.screenshot({ path: `${shots}/quest-fail-${p.label.split(' ')[0]}.png`, timeout: 30_000 }).catch(() => {});
  if (pageErrors.length && step !== 'page errors') console.log(`page errors so far:\n  ${pageErrors.join('\n  ')}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
