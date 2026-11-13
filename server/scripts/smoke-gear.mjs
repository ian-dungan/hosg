// Browser smoke test of looks and gear on a running Shady Grove 2 server (Playwright, headless Chromium).
//   node server/scripts/smoke-gear.mjs <url> [--kill "<command that kills the server>"] [--shots <dir>]
// Start the server with SG2_TEST_START_GOLD=1000 and SG2_TEST_LOOT=always (test switches) and SG2_CLIENT_DIR=client/dist-online
// (after `npm run build:online` in client/), new adventurers starting in the grove (the default). Page A (iPhone 13) and
// page B (desktop):
// 1. A registers a new account; the character creator opens: Brindlekin, three body sliders, hair style 12, a free fur
//    colour (the hue strip), a name; Done. A stands in the grove with that look (people, hair and name checked from its
//    look code), and B (a guest through the creator) has A's look code among the codes its room sent (remoteLooks).
// 2. A walks to the Tailor, buys the Straw Sunhat and wears it: A's gear code as B holds it changes.
// 3. A walks out through the east gate to the Greenway, targets the nearest Thornling with Tab, walks up and fights it
//    until a `loot` (lastLoot) holds an item. Two helper bots (bots.ts --assist: a Black Mage and a White Mage) fight A's
//    target and revive A where it falls: a level-1 page rendering about one frame a second loses a Thornling alone.
// 4. A opens the bag and equips that item: __sg2net.stats changes as the shared kit rules say it must (the stats
//    before and after, worked out from the worn items).
// 5. A (no game master) sends `/gm announce hi`: no announcement reaches A or B.
// 6. Killing the server shows "Connection lost". Any page error fails the test.
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kill: { type: 'string' }, shots: { type: 'string' } } });
if (positionals.length !== 1) {
  console.error('Usage: node server/scripts/smoke-gear.mjs <url> [--kill "<command>"] [--shots <dir>]');
  process.exit(2);
}
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const shots = values.shots ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (p, name) => { if (shots) await p.page.screenshot({ path: `${shots}/gear-${name}.png` }); };
/** Runs `code` (a module body that prints one JSON line) with @sg2/shared, and parses the last line. */
const shared = (code) => JSON.parse(execFileSync('npx', ['tsx', '-e', code], { cwd: serverDir, encoding: 'utf8' }).trim().split('\n').pop());
// the stalls, the walk from the Tailor to the east gate (findPath over the grove's ground, waypoints at most 12 m apart), item names
const DATA = shared(`import { TOWN_STALLS, GROVE_EAST_GATE, ITEMS, COSTUMES, findPath, withClearance, zoneDef } from '@sg2/shared';
  const ground = zoneDef('grove').ground, t = TOWN_STALLS.tailor;
  const stand = (s) => ({ x: s.x + Math.sin(s.facing) * 1.6, z: s.z + Math.cos(s.facing) * 1.6 });
  const from = stand(t);
  const path = findPath(from, GROVE_EAST_GATE, withClearance((x, z) => ground(x, z) !== null, 0.6), { cell: 1, maxNodes: 60000 }) ?? [GROVE_EAST_GATE];
  const route = []; let at = from;
  for (const p of path) { const n = Math.ceil(Math.hypot(p.x - at.x, p.z - at.z) / 12); for (let k = 1; k <= n; k++) route.push({ x: at.x + ((p.x - at.x) * k) / n, z: at.z + ((p.z - at.z) * k) / n }); at = p; }
  console.log(JSON.stringify({ tailor: from, gate: GROVE_EAST_GATE, route, names: Object.fromEntries(Object.values(ITEMS).map((i) => [i.id, i.name])), hat: COSTUMES.straw_sunhat.name }))`);
const url = new URL(positionals[0]);
const page0 = new URL(url.href);
page0.searchParams.set('lockq', '');
const killCommand = values.kill ?? null;
console.log(`gear smoke test of ${url.href}; ${killCommand ? `the server will be killed with: ${killCommand}` : 'no --kill given: the "Connection lost" step is skipped'}`);
const LOAD_MS = 300_000;
const WAIT_MS = 180_000;
const NAME = `Fen${String.fromCharCode(97 + Math.floor(Math.random() * 26))}${String.fromCharCode(97 + Math.floor(Math.random() * 26))}ick`;
const USER = `gs${Date.now().toString(36)}`;

const pageErrors = [];
const pages = [];
const browser = await chromium.launch();
async function open(label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS);
  page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
  await page.goto(page0.href, { timeout: LOAD_MS, waitUntil: 'domcontentloaded' });
  const p = { label, context, page };
  pages.push(p);
  return p;
}
const ev = (p, f, arg) => p.page.evaluate(f, arg);
const waitFor = (p, f, arg, ms, why) => p.page.waitForFunction(f, arg, { timeout: ms, polling: 300 }).then((h) => h.jsonValue(), () => { throw new Error(`${p.label}: ${why}`); });
const inRoom = (p) => waitFor(p, () => /Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '') && !!window.__sg2net?.self, null, WAIT_MS * 2, 'never stood in its room');
/** Tap-to-walk's own walk to (x, z), tried again until it stands within `near` m (or has left the zone). */
async function walkTo(p, to, near = 1.5, ms = WAIT_MS) {
  const until = Date.now() + ms;
  for (let tries = 0; tries < 6 && Date.now() < until; tries++) {
    const zone = await ev(p, () => window.__sg2net.zone);
    await ev(p, ({ x, z }) => { const g = window.__sg2.game, V = g.rig.position.constructor; g.walkTo(new V(x, g.world.groundAt(x, z) ?? g.rig.position.y, z)); }, to);
    await p.page.waitForTimeout(1500);
    const there = await p.page.waitForFunction(([{ x, z }, d, z0]) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - x, r.z - z) < d || !window.__sg2.game.walking || window.__sg2net.zone !== z0; }, [to, near, zone], { timeout: Math.max(1000, until - Date.now()), polling: 500 })
      .then(() => ev(p, ([{ x, z }, d, z0]) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - x, r.z - z) < d || window.__sg2net.zone !== z0; }, [to, near, zone]), () => false);
    if (there) return;
  }
  throw new Error(`${p.label}: could not walk to ${to.x.toFixed(1)}, ${to.z.toFixed(1)}`);
}
const clickText = async (p, sel, text) => {
  const loc = p.page.locator(sel, { hasText: text }).first();
  await loc.waitFor({ state: 'visible', timeout: WAIT_MS });
  await loc.click({ timeout: WAIT_MS });
};

let step = 'start';
const t0 = Date.now();
/** A progress line (seconds since the start), so a slow step shows where it is. */
const note = (m) => console.log(`     [${((Date.now() - t0) / 1000).toFixed(0)} s] ${m}`);
async function check(name, fn) {
  step = name;
  const started = Date.now();
  await fn();
  console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

let helpers = null;
try {
  let a, b, aLook;
  await check('the client loads on an iPhone 13 (A) and a desktop (B)', async () => {
    a = await open('A (iPhone 13)', { ...devices['iPhone 13'] });
    b = await open('B (desktop)', { viewport: { width: 1280, height: 800 } });
  });

  await check('A registers; the creator opens: Brindlekin, three sliders, hair style 12, a free fur colour, a name, Done', async () => {
    await a.page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
    await a.page.fill('.sg-login input >> nth=0', USER);
    await a.page.fill('.sg-login input >> nth=1', 'smoke-gear-password-1');
    await a.page.click('button:has-text("Create account")');
    await a.page.waitForSelector('.sg-cr', { timeout: WAIT_MS });
    await clickText(a, '.sg-cr-tab', 'People');
    await clickText(a, '.sg-cr-card', 'Brindlekin');
    await waitFor(a, () => document.querySelector('.sg-cr-card.on')?.textContent?.includes('Brindlekin'), null, WAIT_MS, 'Brindlekin was not chosen');
    note('creator: Brindlekin');
    await clickText(a, '.sg-cr-tab', 'Body');
    await a.page.waitForSelector('.sg-cr-range');
    await ev(a, () => {
      const r = [...document.querySelectorAll('.sg-cr-range')].slice(0, 3);
      r.forEach((el, i) => { el.value = String([3, 17, 14][i]); el.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await clickText(a, '.sg-cr-tab', 'Hair');
    // the Hair picker's strip: chip 12 (styles count from 0)
    await a.page.locator('.sg-cr-row').filter({ has: a.page.locator('.sg-cr-lbl', { hasText: /^Hair$/ }) }).locator('.sg-cr-chip').nth(12).click();
    await clickText(a, '.sg-cr-tab', 'Colours');
    // a free colour: the Fur row's hue strip, tapped at 62%
    const bar = a.page.locator('.sg-cr-row').filter({ has: a.page.locator('.sg-cr-lbl', { hasText: /^Fur/ }) }).first().locator('.sg-cr-bar').first();
    const box = await bar.boundingBox();
    if (!box) throw new Error('no fur hue strip');
    await ev(a, ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 3, buttons: 1 }));
    }, [box.x + box.width * 0.62, box.y + box.height / 2]);
    note('creator: sliders, hair, fur colour');
    await clickText(a, '.sg-cr-tab', 'Name');
    await a.page.fill('.sg-cr-name', NAME);
    await shot(a, 'creator-a');
    note('creator: Done');
    await a.page.click('.sg-cr-foot button.done:not([disabled])');
    await inRoom(a);
    note('A in the grove');
    aLook = await waitFor(a, () => window.__sg2net.look || null, null, WAIT_MS, 'A has no look code');
    const decoded = shared(`import { decodeLook } from '@sg2/shared'; console.log(JSON.stringify(decodeLook(${JSON.stringify(aLook)})))`);
    if (decoded?.people !== 'brindlekin') throw new Error(`A's look is ${decoded?.people}, not brindlekin`);
    if (decoded.hair?.style !== 12) throw new Error(`A's hair style is ${decoded.hair?.style}, not 12`);
    if ([decoded.body.height, decoded.body.build, decoded.body.shoulders].join() !== '3,17,14') throw new Error(`A's sliders are ${JSON.stringify(decoded.body)}`);
    const me = await ev(a, () => window.__sg2.room?.state.players?.get(window.__sg2.room.sessionId)?.name);
    if (me !== NAME) throw new Error(`A is called ${me}, not ${NAME}`);
    await shot(a, 'a-in-grove');
  });

  await check('B (a guest through the creator) holds A\'s look among the looks its room sent', async () => {
    await b.page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
    await b.page.click('button:has-text("Play as guest")');
    await b.page.waitForSelector('.sg-cr-foot button.done:not([disabled])', { timeout: WAIT_MS });
    await b.page.click('.sg-cr-foot button.done');
    await inRoom(b);
    await waitFor(b, (code) => Object.values(window.__sg2net.remoteLooks).includes(code), aLook, WAIT_MS, 'B never got A\'s look code');
    await shot(b, 'b-sees-a');
  });

  let aEidOnB, gearBefore;
  await check('A buys the Straw Sunhat at the Tailor and wears it: A\'s gear code on B changes', async () => {
    aEidOnB = await ev(b, (code) => Number(Object.entries(window.__sg2net.remoteLooks).find(([, c]) => c === code)[0]), aLook);
    gearBefore = await ev(b, (eid) => window.__sg2net.remoteGear[eid], aEidOnB);
    await walkTo(a, DATA.tailor, 1.2);
    await waitFor(a, () => /Costumes/.test(document.querySelector('.sg-prompt')?.textContent ?? ''), null, WAIT_MS, 'no Tailor prompt by its booth');
    await a.page.click('.sg-prompt');
    // the Tailor's Costumes tab: a row per costume, Buy (then Wear) at its end
    const row = a.page.locator('.sg-row').filter({ has: a.page.locator('.sg-row-name', { hasText: DATA.hat }) }).first();
    await row.waitFor({ state: 'visible', timeout: WAIT_MS });
    await row.locator('.sg-gs-btn', { hasText: /^Buy$/ }).click();
    await waitFor(a, () => window.__sg2net.inventory?.wardrobe.includes('straw_sunhat'), null, WAIT_MS, 'the Sunhat never reached the wardrobe');
    await row.locator('.sg-gs-btn', { hasText: /^Wear$/ }).click();
    await waitFor(b, ([eid, g0]) => window.__sg2net.remoteGear[eid] !== undefined && window.__sg2net.remoteGear[eid] !== g0, [aEidOnB, gearBefore], WAIT_MS, 'A\'s gear code on B never changed');
    await shot(a, 'a-sunhat');
    await shot(b, 'b-sees-sunhat');
    await a.page.keyboard.press('Escape');
    await ev(a, () => document.querySelector('.sg-gs-x')?.click());
  });

  let loot;
  await check('A walks to the Greenway, kills a Thornling (with two helper bots) and its loot holds an item', async () => {
    await b.context.close(); // (fewer software-rendered pages for the long walk and the fight)
    helpers = spawn('npx', ['tsx', 'scripts/bots.ts', '--url', url.href, '--assist', NAME, '--seconds', '1500'], { cwd: serverDir, detached: true, stdio: 'ignore' });
    for (const to of [...DATA.route, { x: DATA.gate.x + 3, z: DATA.gate.z }]) {
      if (await ev(a, () => window.__sg2net.zone === 'greenway')) break;
      await walkTo(a, to, 2).catch(() => {});
    }
    await waitFor(a, () => window.__sg2net.zone === 'greenway' && !!window.__sg2net.self, null, WAIT_MS * 2, 'never reached the Greenway');
    await waitFor(a, () => (window.__sg2net.enemies.length ?? 0) > 0, null, WAIT_MS, 'no enemy in view');
    const until = Date.now() + 300_000;
    while (!(loot = await ev(a, () => window.__sg2net.lastLoot)) || loot.items.length === 0) {
      if (Date.now() > until) throw new Error(`no loot with an item: ${JSON.stringify(loot)}`);
      let t = await ev(a, () => { const t = window.__sg2net.self?.target; return window.__sg2net.enemies.find((e) => e.eid === t && e.mode !== 'dead') ?? null; });
      if (!t) {
        // the nearest live Thornling (Tab picks the nearest enemy; a Thornling is asked for by name)
        await a.page.keyboard.press('Tab');
        await a.page.waitForTimeout(800);
        t = await ev(a, () => { const t = window.__sg2net.self?.target; return window.__sg2net.enemies.find((e) => e.eid === t) ?? null; });
      }
      // into reach of it (tap-to-walk's own walk), again while it is more than 2.2 m away
      if (t && (await ev(a, (e) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - e.x, r.z - e.z) > 2.2 && !window.__sg2.game.walking; }, t))) {
        await ev(a, ({ x, z }) => { const g = window.__sg2.game, V = g.rig.position.constructor; g.walkTo(new V(x, g.world.groundAt(x, z) ?? 0, z)); }, t);
      }
      if (await ev(a, () => window.__sg2net.self?.dead)) {
        // the helper White Mage revives A where it fell (Second Dawn)
        note('A fell; waiting for the helper\'s revive');
        await waitFor(a, () => window.__sg2net.self && !window.__sg2net.self.dead || null, null, 90_000, 'A fell and was not revived');
      }
      await a.page.keyboard.press('Digit2');
      await a.page.keyboard.press('Digit1');
      await a.page.waitForTimeout(700);
    }
    console.log(`     loot: ${loot.items.join(', ')} and ${loot.gold} gold`);
    await shot(a, 'a-loot');
  });

  await check('A opens the bag and equips the item: the stats change as the item\'s stats say', async () => {
    // out of the fight first (equipping is refused in combat)
    await a.page.keyboard.press('Escape'); // (no target: nothing more to fight)
    await a.page.waitForTimeout(8000);
    const before = await ev(a, () => ({ stats: window.__sg2net.stats, inv: window.__sg2net.inventory, job: window.__sg2net.self?.job, level: window.__sg2net.jobs?.jobs[window.__sg2net.jobs.current]?.level ?? 1 }));
    // (lastLoot names the items: the bag holds them by id)
    const it = before.inv.bag.find((i) => loot.items.includes(DATA.names[i.item]) && i.worn.length === 0);
    if (!it) throw new Error('the dropped item is not in the bag');
    await a.page.click('.sg-char-btn');
    await clickText(a, '.sg-gs-tab', 'Bag');
    await a.page.locator(`.sg-tile[aria-label="${DATA.names[it.item]}"]`).first().click();
    await shot(a, 'a-bag-item');
    const equipBtn = a.page.locator('.sg-gs-btn', { hasText: /^Equip/ }).first();
    await equipBtn.waitFor({ state: 'visible', timeout: WAIT_MS });
    if (await equipBtn.evaluate((el) => el.classList.contains('off'))) throw new Error(`${DATA.names[it.item]} cannot be equipped by a ${before.job}`);
    // (a fight can start meanwhile: "Not while fighting" is refused, and it is asked again once the fight is over)
    for (let tries = 0; tries < 8; tries++) {
      await equipBtn.click();
      const worn = await a.page.waitForFunction((uid) => Object.values(window.__sg2net.inventory?.gear[window.__sg2net.jobs.current] ?? {}).includes(uid), it.uid, { timeout: 15_000, polling: 300 }).then(() => true, () => false);
      if (worn) break;
      console.log(`     equip not taken yet (${(await ev(a, () => window.__sg2net.invRefusals.slice(-1)[0])) ?? 'no answer'}); again`);
    }
    const after = await waitFor(a, (uid) => { const v = window.__sg2net.inventory; return v && Object.values(v.gear[window.__sg2net.jobs.current] ?? {}).includes(uid) ? { stats: window.__sg2net.stats, gear: v.gear[window.__sg2net.jobs.current], bag: v.bag } : null; }, it.uid, WAIT_MS, 'the item was never worn');
    // what the shared kit rules say the stats are, with the gear worn before and after
    const items = (gear, bag) => Object.fromEntries(Object.entries(gear).map(([s, uid]) => [s, bag.find((i) => i.uid === uid)?.item]).filter(([, i]) => i));
    const expect = shared(`import { kitFor } from '@sg2/shared';
      const k = (gear) => kitFor({ job: ${JSON.stringify(before.job)}, level: ${before.level}, gear, talents: [] }).stats;
      console.log(JSON.stringify({ before: k(${JSON.stringify(items(before.inv.gear[before.job] ?? {}, before.inv.bag))}), after: k(${JSON.stringify(items(after.gear, after.bag))}) }))`);
    const same = (x, y) => ['power', 'defence', 'maxHp'].every((s) => x[s] === y[s]);
    if (!same(before.stats, expect.before)) throw new Error(`stats before ${JSON.stringify(before.stats)}, the rules say ${JSON.stringify(expect.before)}`);
    if (!same(after.stats, expect.after)) throw new Error(`stats after ${JSON.stringify(after.stats)}, the rules say ${JSON.stringify(expect.after)}`);
    if (same(before.stats, after.stats)) throw new Error(`equipping ${it.item} changed no stat (${JSON.stringify(after.stats)})`);
    console.log(`     ${DATA.names[it.item]}: ${JSON.stringify(before.stats)} -> ${JSON.stringify(after.stats)}`);
    await shot(a, 'a-equipped');
    await ev(a, () => document.querySelector('.sg-gs-x')?.click());
  });

  await check('A (no game master) sends "/gm announce hi": no announcement reaches anyone', async () => {
    b = await open('B again (desktop)', { viewport: { width: 960, height: 600 } });
    await b.page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
    await b.page.click('button:has-text("Play as guest")');
    await b.page.waitForSelector('.sg-cr-foot button.done:not([disabled])', { timeout: WAIT_MS });
    await b.page.click('.sg-cr-foot button.done');
    await inRoom(b);
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.insertText('/gm announce hi');
    await a.page.keyboard.press('Enter');
    await a.page.waitForTimeout(8000);
    for (const p of [a, b]) {
      const got = await ev(p, () => ({ log: window.__sg2net.chatLog.filter((l) => l.channel === 'announce'), lines: document.querySelectorAll('.sg-chat-line.announce').length }));
      if (got.log.length || got.lines) throw new Error(`${p.label} saw an announcement: ${JSON.stringify(got)}`);
    }
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
  if (shots) for (const p of pages) if (!p.page.isClosed()) await p.page.screenshot({ path: `${shots}/gear-fail-${p.label.split(' ')[0]}.png`, timeout: 30_000 }).catch(() => {});
  if (pageErrors.length && step !== 'page errors') console.log(`page errors so far:\n  ${pageErrors.join('\n  ')}`);
  process.exitCode = 1;
} finally {
  if (helpers) try { process.kill(-helpers.pid, 'SIGTERM'); } catch { /* gone */ }
  await browser.close();
}
