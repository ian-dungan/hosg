// Browser smoke test of parties and the Lampfall on a running Shady Grove 2 server (Playwright, headless Chromium).
//   node server/scripts/smoke-party.mjs <url> [--kill "<command that kills the server>"] [--shots <dir>] [--helpers]
// Start the server with SG2_START_AT=lampfall-mouth (new adventurers start in the Greenway at the crater mouth) and
// SG2_CLIENT_DIR=client/dist-online (after `npm run build:online` in client/), so it serves the online client.
// Page A (desktop) and page B (iPhone 13) play as guests (each takes the character creator's default look, Done);
// A taps B and invites it from the focus frame; B accepts on its invite card; each shows the other in a party frame;
// A's party chat line (with markup) reaches B as plain text, tagged as party chat; both walk into the crater mouth and
// stand in the same instance (__sg2net.roomId); both walk down to the Root Cellar, target with Tab and fight (autos
// and skills); the first pack (two Thornlings and an Archer) is dead within 300 s of game time (the instance lists
// root_cellar as cleared, and each of the three is seen dead in __sg2net.enemies), with both still in the instance;
// B reloads and is back in the same instance, in the party; A presses P, leaves the party, and within 15 s is told
// "You left the party…" and sent to the Greenway, where it stands at the mouth; killing the server shows
// "Connection lost". Any page error fails the test.
// --helpers: two helper bots (bots.ts --join A: a White Mage and a Black Mage) join A's party first and fight with it
// (the brief allows bots to assist the first pack); without it A and B fight alone.
// The server is killed at the end with --kill (required for the last step; without it the step is skipped).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, devices } from 'playwright';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { kill: { type: 'string' }, shots: { type: 'string' }, helpers: { type: 'boolean' } } });
if (positionals.length !== 1) {
  console.error('Usage: node server/scripts/smoke-party.mjs <url> [--kill "<command>"] [--shots <dir>] [--helpers]');
  process.exit(2);
}
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const shots = values.shots ?? null;
if (shots) mkdirSync(shots, { recursive: true });
const shot = async (p, name) => { if (shots) await p.page.screenshot({ path: `${shots}/party-${name}.png` }); };
// The shared data the steps need (read from @sg2/shared): the mouth, the walk from the rim into the Root Cellar
// (waypoints at most 10 m apart along the rim's corridor), the Root Cellar's pack, the notice for leaving the party.
const DATA = JSON.parse(execFileSync('npx', ['tsx', '-e', `import { LAMPFALL_MOUTH, REASON_LEFT_PARTY, ENCOUNTERS, lampfallLayout } from '@sg2/shared';
  const L = lampfallLayout(), rim = L.rooms.find((r) => r.id === 'rim'), cellar = L.rooms.find((r) => r.id === 'root_cellar');
  const c = L.corridors.find((k) => k.to === 'root_cellar');
  const ux = (cellar.x - c.bx), uz = (cellar.z - c.bz), d = Math.hypot(ux, uz);
  const stops = [{ x: rim.x, z: rim.z }, { x: c.ax, z: c.az }, { x: c.bx, z: c.bz }, { x: c.bx + (ux / d) * 4, z: c.bz + (uz / d) * 4 }];
  const route = [];
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 10));
    for (let k = 1; k <= n; k++) route.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  console.log(JSON.stringify({ mouth: { x: LAMPFALL_MOUTH.x, z: LAMPFALL_MOUTH.z, r: LAMPFALL_MOUTH.r }, arrive: LAMPFALL_MOUTH.arrive,
    leftParty: REASON_LEFT_PARTY, cellar: { x: cellar.x, z: cellar.z, r: cellar.r }, route,
    pack: ENCOUNTERS.root_cellar.spawns.map((s) => s.kind) }))`], { cwd: serverDir, encoding: 'utf8' }).trim().split('\n').pop());
const url = new URL(positionals[0]);
const page0 = new URL(url.href);
page0.searchParams.set('lockq', '');
const killCommand = values.kill ?? null;
console.log(`party smoke test of ${url.href}; ${killCommand ? `the server will be killed with: ${killCommand}` : 'no --kill given: the "Connection lost" step is skipped'}`);
const PARTY_CHAT = 'on <b>me</b> & "now"';
const LOAD_MS = 300_000; // the first page load compiles a large bundle under software rendering
const WAIT_MS = 180_000;
const PACK_GAME_S = 300;
const LEAVE_MS = 15_000;

const pageErrors = [];
const pages = [];
const browser = await chromium.launch();
let helpers = null;

async function open(label, contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_MS); // (a page renders at about 1 fps: a click waits for a stable element)
  page.on('pageerror', (err) => pageErrors.push(`${label}: ${err.message}`));
  await page.goto(page0.href, { timeout: LOAD_MS, waitUntil: 'domcontentloaded' });
  const p = { label, context, page, name: '' };
  pages.push(p);
  return p;
}

/**
 * Clicks "Play as guest", takes the character creator's default look (Done) when it opens, and waits until the page
 * is in its room. A join that timed out on a starved page is tried again with "Continue as".
 */
async function playAsGuest(p) {
  await p.page.waitForSelector('.sg-login.in', { timeout: LOAD_MS });
  const [response] = await Promise.all([
    p.page.waitForResponse((r) => r.url().endsWith('/api/guest'), { timeout: WAIT_MS }),
    p.page.click('button:has-text("Play as guest")', { timeout: WAIT_MS }),
  ]);
  const body = await response.json();
  if (!body.name) throw new Error(`${p.label}: guest login failed: ${JSON.stringify(body)}`);
  p.name = body.name;
  let creator = false;
  for (let retries = 4; ;) {
    const st = await p.page.waitForFunction(() => {
      if (/Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '')) return 'in';
      const done = document.querySelector('.sg-cr-foot button.done');
      if (done && !done.disabled) return 'creator';
      return document.querySelector('.sg-login.in .sg-login-err')?.textContent || false;
    }, null, { timeout: WAIT_MS, polling: 300 }).then((h) => h.jsonValue());
    if (st === 'in') break;
    if (st === 'creator') { creator = true; await p.page.click('.sg-cr-foot button.done', { timeout: WAIT_MS }); await p.page.waitForTimeout(500); continue; }
    if (retries-- === 0) throw new Error(`${p.label}: ${st}`);
    console.log(`     ${p.label}: ${st}; "Continue as" again`);
    await p.page.click('.sg-login-continue', { timeout: WAIT_MS });
  }
  if (!creator) throw new Error(`${p.label}: a new guest got no character creator`);
}

/** Waits until the page stands in a Lampfall instance (a starved join is tried again with "Continue as"). */
async function inLampfall(p, ms = WAIT_MS * 4) {
  const until = Date.now() + ms;
  for (let tries = 0; Date.now() < until;) {
    const st = await p.page.evaluate(() => {
      const n = window.__sg2net;
      if (n?.zone === 'lampfall' && n.instance && n.roomId && /online/.test(document.querySelector('.sg-online')?.textContent ?? '')) return 'in';
      return document.querySelector('.sg-login.in .sg-login-err')?.textContent || 'wait';
    }).catch(() => 'wait');
    if (st === 'in') return;
    if (st !== 'wait') {
      if (++tries > 8) throw new Error(`${p.label}: ${st}`);
      console.log(`     ${p.label}: ${st}; "Continue as" again`);
      await p.page.click('.sg-login-continue', { timeout: WAIT_MS });
    }
    await p.page.waitForTimeout(1000);
  }
  throw new Error(`${p.label}: not in the Lampfall after ${ms / 1000} s`);
}

const net = (p, f, arg) => p.page.evaluate(f, arg);
const waitFor = (p, f, arg, ms, why) => p.page.waitForFunction(f, arg, { timeout: ms, polling: 300 }).then((h) => h.jsonValue(), () => { throw new Error(`${p.label}: ${why}`); });
/** Tap-to-walk's own walk to (x, z), tried again (up to 5 times) until it stands within 1.5 m. */
async function walkTo(p, to, ms = WAIT_MS) {
  const until = Date.now() + ms;
  for (let tries = 0; tries < 5 && Date.now() < until; tries++) {
    await p.page.evaluate(({ x, z }) => {
      const g = window.__sg2.game, V = g.rig.position.constructor;
      g.walkTo(new V(x, g.world.groundAt(x, z) ?? g.rig.position.y, z));
    }, to);
    await p.page.waitForTimeout(1500); // (a frame or two at about 1 fps before the walk shows)
    const there = await p.page.waitForFunction(({ x, z }) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - x, r.z - z) < 1.5 || !window.__sg2.game.walking; }, to, { timeout: Math.max(1000, until - Date.now()), polling: 500 })
      .then(() => p.page.evaluate(({ x, z }) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - x, r.z - z) < 1.5; }, to), () => false);
    if (there) return;
  }
  throw new Error(`${p.label}: could not walk to ${to.x.toFixed(1)}, ${to.z.toFixed(1)}`);
}
/** The room's clock in seconds of game time. */
const gameS = (p) => p.page.evaluate(() => (window.__sg2.room?.state?.clock ?? 0) / 15);

let step = 'start';
async function check(name, fn) {
  step = name;
  const started = Date.now();
  await fn();
  console.log(`ok   ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
}

/** The helper bots (bots.ts --join <name>): their output lines are kept; `wait` resolves on the first matching line. */
function startHelpers(name) {
  const child = spawn('npx', ['tsx', 'scripts/bots.ts', '--url', url.href, '--join', name, '--count', '2', '--seconds', '3600'], { cwd: serverDir, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const seen = [], waiters = [];
  let buf = '';
  const onData = (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      seen.push(line);
      for (const w of [...waiters]) if (w.test(line)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(line); }
    }
  };
  child.stdout.setEncoding('utf8').on('data', onData);
  child.stderr.setEncoding('utf8').on('data', onData);
  let stopped = false;
  return {
    seen,
    wait(test, ms, why) {
      const old = seen.find(test);
      if (old) return Promise.resolve(old);
      return new Promise((resolve, reject) => {
        const w = { test, resolve };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) reject(new Error(`${why} (last lines: ${seen.slice(-4).join(' | ')})`)); }, ms);
      });
    },
    say(line) { if (!stopped) child.stdin.write(`${line}\n`); },
    stop() { if (stopped) return; stopped = true; try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } },
  };
}

try {
  let a, b;
  await check('A (desktop) and B (iPhone 13) play as guests, each through the character creator, at the crater mouth', async () => {
    a = await open('A (desktop)', { viewport: { width: 1280, height: 800 } });
    b = await open('B (iPhone 13)', { ...devices['iPhone 13'] });
    await Promise.all([playAsGuest(a), playAsGuest(b)]);
    for (const p of [a, b]) {
      const at = await net(p, () => ({ zone: window.__sg2net.zone, x: window.__sg2.rig.position.x, z: window.__sg2.rig.position.z }));
      if (at.zone !== 'greenway' || Math.hypot(at.x - DATA.mouth.x, at.z - DATA.mouth.z) > 15) throw new Error(`${p.label} is not at the crater mouth (start the server with SG2_START_AT=lampfall-mouth): ${JSON.stringify(at)}`);
    }
    console.log(`     A is ${a.name}, B is ${b.name}`);
  });

  await check('A taps B and invites it from the focus frame; B accepts on its card; each shows the other in a party frame', async () => {
    await waitFor(a, (n) => window.__sg2net.remotes.some((r) => r.name === n), b.name, WAIT_MS, 'A never saw B');
    // B steps 5 m west first (both start on the same spot: a tap there may pick A itself)
    await walkTo(b, { x: DATA.arrive.x - 5, z: DATA.arrive.z + 1 });
    // a tap on B's body focuses it; the focus frame then offers "Invite to party" (tried again if the frame closed
    // before the click landed: a page draws about one frame a second)
    for (let tries = 0; ; tries++) {
      // A turns to face B (where it stands, so nothing moves): the camera follows
      await a.page.evaluate((n) => {
        const r = window.__sg2net.remotes.find((x) => x.name === n), rig = window.__sg2.rig, p = rig.position;
        if (r) rig.teleport(p.clone(), Math.atan2(r.x - p.x, r.z - p.z));
      }, b.name);
      const at = await waitFor(a, (n) => {
        const r = window.__sg2net.remotes.find((x) => x.name === n);
        const pt = r && window.__sg2.screenOf(r.x, r.y + 1.0, r.z);
        return pt && pt.x > 0 && pt.y > 0 && pt.x < innerWidth && pt.y < innerHeight ? pt : null;
      }, b.name, WAIT_MS, 'B is not on A\'s screen');
      // (a second tap on a focused adventurer clears the focus: tap only when nobody is focused)
      if ((await net(a, () => window.__sg2net.allyFocus)) === null) await a.page.mouse.click(at.x, at.y);
      // force: at about 1 fps the frame never holds still for two frames, which a plain click waits for
      const ok = await a.page.waitForSelector('.sg-af-invite.on', { timeout: 60_000 }).then(() => a.page.click('.sg-af-invite.on', { timeout: 20_000, force: true })).then(() => true, () => false);
      if (ok) break;
      if (tries === 2) throw new Error('A could not invite B from the focus frame (3 tries)');
      console.log('     the focus frame closed before the click; tapping B again');
    }
    await waitFor(b, () => document.querySelector('.sg-invite.on') !== null, null, WAIT_MS, 'no invite card on B');
    const card = await net(b, () => document.querySelector('.sg-invite-text')?.textContent ?? '');
    if (!card.includes(a.name)) throw new Error(`B's invite card does not name A: "${card}"`);
    await shot(b, 'invite-card');
    await b.page.click('.sg-invite-yes');
    for (const [p, other] of [[a, b], [b, a]]) {
      await waitFor(p, (n) => window.__sg2net.party?.members.length === 2 && window.__sg2net.party.members.some((m) => m.name === n), other.name, WAIT_MS, 'no party of two');
      await waitFor(p, (n) => [...document.querySelectorAll('.sg-party-row:not(.off)')].some((r) => r.textContent.includes(n)), other.name, WAIT_MS, `no party frame for ${other.name}`);
    }
    await shot(a, 'frames-a');
    await shot(b, 'frames-b');
  });

  await check('A\'s party chat line (with markup) reaches B as plain text, tagged as party chat', async () => {
    await a.page.keyboard.press('Enter');
    await a.page.keyboard.insertText(`/p ${PARTY_CHAT}`);
    await a.page.keyboard.press('Enter');
    await waitFor(b, (t) => window.__sg2net.chatLog.some((l) => l.channel === 'party' && l.text === t), PARTY_CHAT, WAIT_MS, 'B never got the party line');
    const line = await net(b, (t) => {
      const el = [...document.querySelectorAll('.sg-chat-line.party')].find((x) => x.textContent.includes(t));
      return el ? { text: el.textContent, bold: el.querySelector('b') !== null } : null;
    }, PARTY_CHAT);
    if (!line) throw new Error('the party line is not in B\'s chat as a party line');
    if (line.bold) throw new Error('the markup in the party line was rendered as HTML');
    if (!/party/i.test(line.text)) throw new Error(`the party line is not tagged: "${line.text}"`);
    await shot(b, 'party-chat');
  });

  if (values.helpers) {
    await check('two helper bots join A\'s party (bots.ts --join)', async () => {
      helpers = startHelpers(a.name);
      const names = (await helpers.wait((l) => l.startsWith('join: names '), WAIT_MS, 'the helpers never joined')).slice('join: names '.length).split(',');
      helpers.say('hold');
      for (const n of names) {
        await a.page.keyboard.press('Enter');
        await a.page.keyboard.insertText(`/invite ${n}`);
        await a.page.keyboard.press('Enter');
        await a.page.waitForTimeout(1500);
      }
      await waitFor(a, () => window.__sg2net.party?.members.length === 4, null, WAIT_MS, 'the helpers are not in the party');
    });
  }

  let roomId = '';
  await check('both walk into the crater mouth and stand in the same instance', async () => {
    // a smaller page renders faster: the client gives a join 15 s of wall time, and the Lampfall's first frames are slow
    await a.page.setViewportSize({ width: 800, height: 500 });
    for (const p of [a, b]) await p.page.evaluate(({ x, z }) => {
      const g = window.__sg2.game, V = g.rig.position.constructor;
      g.walkTo(new V(x, g.world.groundAt(x, z) ?? g.rig.position.y, z));
    }, DATA.mouth);
    await Promise.all([inLampfall(a), inLampfall(b)]);
    const [ra, rb] = [await net(a, () => window.__sg2net.roomId), await net(b, () => window.__sg2net.roomId)];
    if (!ra || ra !== rb) throw new Error(`A and B are in different rooms: ${ra} / ${rb}`);
    roomId = ra;
    await a.page.waitForTimeout(1500);
    await shot(a, 'instance-a');
    await shot(b, 'instance-b');
  });

  await check(`both walk to the Root Cellar, target with Tab and fight; the first pack is dead within ${PACK_GAME_S} s of game time, both still inside`, async () => {
    const t0 = await gameS(a);
    let helping = false; // the helpers join in once both pages have a target (or after 60 s of game time)
    // down the corridor in short tap-to-walk legs
    for (const leg of DATA.route) await Promise.all([walkTo(a, leg), walkTo(b, { x: leg.x - 1, z: leg.z + 1.5 })]);
    const seen = new Map(); // the pack's enemies (eid -> kind) as first seen in the Root Cellar
    const tabs = new Map(), hit = new Set(), deaths = new Set(); // Tab presses per page; pages whose target was an enemy of the pack
    for (;;) {
      for (const p of [a, b]) {
        const view = await net(p, (c) => window.__sg2net.enemies.filter((e) => Math.hypot(e.x - c.x, e.z - c.z) <= c.r + 3).map((e) => ({ eid: e.eid, kind: e.kind, mode: e.mode })), DATA.cellar);
        for (const e of view) {
          const s = seen.get(e.eid) ?? { kind: e.kind, dead: false };
          if (e.mode === 'dead') s.dead = true;
          seen.set(e.eid, s);
        }
        // Tab to the next enemy when it has none alive; out of reach, a tap-to-walk into reach (no key presses while
        // it walks: a key ends the walk); in reach, its skills (autos run by themselves)
        const st = await net(p, () => {
          const n = window.__sg2net, e = n.enemies.find((v) => v.eid === n.self?.target && v.mode !== 'dead'), r = window.__sg2.rig.position;
          return { live: !!e, far: e ? Math.hypot(e.x - r.x, e.z - r.z) : 0, e: e ? { x: e.x, z: e.z } : null, walking: window.__sg2.game.walking, dead: n.self?.dead };
        });
        if (st.live) hit.add(p);
        if (st.dead || st.walking) continue;
        // up again at the rim after a release: down the corridor again
        const back = await net(p, (c) => { const r = window.__sg2.rig.position; return Math.hypot(r.x - c.x, r.z - c.z) > c.r + 6; }, DATA.cellar);
        if (back) { for (const leg of DATA.route) await walkTo(p, leg); continue; }
        if (!st.live) { await p.page.keyboard.press('Tab'); tabs.set(p, (tabs.get(p) ?? 0) + 1); }
        else if (st.far > 2.6) await p.page.evaluate(({ x, z }) => { const g = window.__sg2.game, r = g.rig.position, V = r.constructor; g.walkTo(new V(x, g.world.groundAt(x, z) ?? r.y, z)); }, st.e);
        else { await p.page.keyboard.press('Digit2'); await p.page.keyboard.press('Digit1'); }
      }
      if (helpers && !helping && ((hit.has(a) && hit.has(b)) || (await gameS(a)) - t0 > 60)) { helping = true; helpers.say('go'); }
      const cleared = await net(a, () => window.__sg2net.instance?.cleared ?? []);
      const kinds = [...seen.values()];
      if (cleared.includes('root_cellar') && kinds.length >= DATA.pack.length && kinds.every((k) => k.dead)) break;
      const now = await gameS(a);
      if (now - t0 > PACK_GAME_S) throw new Error(`the first pack is not dead after ${PACK_GAME_S} s of game time: cleared ${JSON.stringify(cleared)}, seen ${JSON.stringify([...seen])}`);
      for (const p of [a, b]) {
        const s = await net(p, () => ({ dead: window.__sg2net.self?.dead, zone: window.__sg2net.zone, screen: window.__sg2net.screen }));
        if (s.zone !== 'lampfall') throw new Error(`${p.label} left the Lampfall during the fight (${JSON.stringify(s)})`);
        // fallen: Release (from RELEASE_MIN_S on) and walk back in
        if (s.dead) { deaths.add(p.label); await p.page.click('.sg-end-btn:not(.waiting):has-text("Release")', { timeout: 1000 }).catch(() => {}); }
      }
      await a.page.waitForTimeout(500);
    }
    const kinds = [...seen.values()].map((k) => k.kind).sort().join(',');
    for (const p of [a, b]) if (!tabs.get(p) || !hit.has(p)) throw new Error(`${p.label} never targeted an enemy with Tab`);
    if (kinds !== [...DATA.pack].sort().join(',')) throw new Error(`the Root Cellar's pack was ${kinds}, not ${DATA.pack.join(',')}`);
    for (const p of [a, b]) if ((await net(p, () => window.__sg2net.roomId)) !== roomId) throw new Error(`${p.label} is not in the instance any more`);
    console.log(`     the pack (${kinds}) died ${((await gameS(a)) - t0).toFixed(0)} s of game time after the walk began${deaths.size ? ` (fell and released: ${[...deaths].join(', ')})` : ''}`);
    await shot(a, 'pack-dead-a');
  });

  await check('B reloads and is back in the same instance, in the party', async () => {
    await b.page.reload({ timeout: LOAD_MS, waitUntil: 'domcontentloaded' });
    await b.page.waitForSelector('.sg-login.in, .sg-online', { timeout: LOAD_MS });
    // "Continue as" (this tab still holds the account) when the login screen shows
    if (await b.page.$('.sg-login.in .sg-login-continue')) await b.page.click('.sg-login-continue', { timeout: WAIT_MS });
    await inLampfall(b);
    const rb = await net(b, () => window.__sg2net.roomId);
    if (rb !== roomId) throw new Error(`B came back to ${rb}, not ${roomId}`);
    await waitFor(b, (n) => window.__sg2net.party?.members.some((m) => m.name === n), a.name, WAIT_MS, 'B is not in the party after the reload');
  });

  await check(`A presses P and leaves the party; it is told why and within ${LEAVE_MS / 1000} s sent to the Greenway, where it stands at the mouth`, async () => {
    await a.page.keyboard.press('KeyP');
    await a.page.waitForSelector('.sg-ps-leave', { timeout: WAIT_MS });
    await shot(a, 'party-sheet');
    // the page's own clock times the notice and the travel (a MutationObserver: polling at about 1 fps would add seconds)
    await a.page.evaluate((t) => {
      const w = window, t0 = performance.now();
      w.__leave = { notice: null, travel: null };
      const look = () => {
        if (w.__leave.notice === null && [...document.querySelectorAll('.sg-toast')].some((e) => e.textContent.includes(t))) w.__leave.notice = performance.now() - t0;
        if (w.__leave.travel === null && (document.querySelector('.sg-travel.on') || w.__sg2net.zone === 'greenway')) w.__leave.travel = performance.now() - t0;
      };
      new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      setInterval(look, 100);
    }, DATA.leftParty);
    await a.page.click('.sg-ps-leave');
    const times = await waitFor(a, () => window.__leave.notice !== null && window.__leave.travel !== null && window.__leave, null, WAIT_MS, 'no notice or no travel after leaving the party');
    console.log(`     the notice ${(times.notice / 1000).toFixed(1)} s and the travel to the Greenway ${(times.travel / 1000).toFixed(1)} s after Leave (page clock)`);
    // (the server sends the notice as it takes the leave, and the travel INSTANCE_EVICT_S later; at about 1 fps the page
    // itself takes seconds to send the click and draw the toast, so the 15 s run from the notice)
    if (times.notice > 60_000) throw new Error(`no "${DATA.leftParty}" notice within 60 s of the click`);
    if (times.travel - times.notice > LEAVE_MS) throw new Error(`not sent to the Greenway within ${LEAVE_MS / 1000} s of the notice`);
    await shot(a, 'left-party-travel');
    await waitFor(a, () => /Adventurers online/.test(document.querySelector('.sg-online')?.textContent ?? '') && window.__sg2net.zone === 'greenway' && window.__sg2net.instance === null, null, WAIT_MS * 2, 'A never stood in the Greenway');
    const at = await net(a, () => ({ x: window.__sg2.rig.position.x, z: window.__sg2.rig.position.z }));
    if (Math.hypot(at.x - DATA.arrive.x, at.z - DATA.arrive.z) > 3) throw new Error(`A is not at the crater mouth: ${JSON.stringify(at)}`);
    if ((await net(a, () => window.__sg2net.party)) !== null) throw new Error('A is still in a party');
    await shot(a, 'back-at-mouth');
  });

  if (killCommand) {
    await check('killing the server shows "Connection lost"', async () => {
      if (helpers) { helpers.stop(); helpers = null; }
      execFileSync('sh', ['-c', killCommand], { stdio: 'inherit' });
      await waitFor(a, () => /Connection lost/.test(document.body.textContent ?? ''), null, WAIT_MS, 'no "Connection lost"');
    });
  } else console.log('skip killing the server: no --kill given');

  if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join(' | ')}`);
  console.log('PASS');
} catch (err) {
  console.log(`FAIL at "${step}": ${err instanceof Error ? err.message : err}`);
  if (pageErrors.length) console.log(`page errors: ${pageErrors.join(' | ')}`);
  for (const p of pages) if (!p.page.isClosed()) await shot(p, `fail-${p.label[0]}`).catch(() => {});
  process.exitCode = 1;
} finally {
  if (helpers) helpers.stop();
  await browser.close();
}
