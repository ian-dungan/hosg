// Dev harness for the gear screens (dev/gear.html): the HUD with a stand-in server that runs the shared inventory rules
// (applyInvOp) on a local state, so every sheet, stall, toast and the level-up can be seen and measured without a game
// server. Not part of any build. URL: ?job=ranger&level=7&at=smithy&open=gear|bag|talents|wardrobe|vault|smithy|lampwright|
// tailor|dye&card=<item>&slot=<slot>&kit=t1|t2|t3&loot&levelup&fight
import {
  JOBS, TOWN_STALLS, applyInvOp, inventoryView, isJobId, kitItems, newInventory, newJobsSave, totalTo,
  type InvCtx, type InvOp, type InvState, type JobId, type JobsView, type StallId,
} from '@sg2/shared';
import type { CharTab, SheetAct } from '../core/gearViews';
import type { HudState } from '../core/contracts';
import { ABILITY_DEFS } from '../combat/abilityDefs';
import { InvClient, charSheetView, ctxFor, levelShow, lootShow, vendorView } from '../net/inventory';
import { createHud } from './index';

const params = new URLSearchParams(location.search);
const job: JobId = isJobId(params.get('job')) ? params.get('job') as JobId : 'ranger';
const level = Math.max(1, Math.min(10, Number(params.get('level') ?? 7)));
const at = (params.get('at') ?? '') as StallId | '';
const fight = params.has('fight');

// ───────── a stand-in server ─────────
const jobs = newJobsSave(job);
jobs.jobs[job]!.xp = totalTo(level) + 60;
let s: InvState = { inv: newInventory([0, 0]), gold: Number(params.get('gold') ?? 640), seals: Number(params.get('seals') ?? 7), jobs };
const SERVER: InvCtx = { stall: null, jobSwitch: true, townBoard: true, inCombat: false, dead: false, busy: false };
let n = 0;
const run = (op: InvOp, ctx: Partial<InvCtx> = {}) => {
  const r = applyInvOp(s, { ...op, id: `devop${String(++n).padStart(8, '0')}` } as InvOp, { ...SERVER, ...ctx });
  if ('refusal' in r) return r.refusal;
  s = r.state;
  return null;
};
// a lived-in bag: some Greenway and Lampfall finds, a Warden piece, a costume or two
for (const id of ['thornrunner_chest', 'thornrunner_legs', 'thornrunner_head', 'mossweave_hands', 'rootbound_feet', 'ashwood_longbow', 'millward_sword', 'hedge_buckler']) run({ op: 'buy', stall: 'smithy', item: id }, { stall: 'smithy' });
s.gold = Number(params.get('gold') ?? 640);
for (const id of ['cinderstep_chest', 'wickthread_head', 'brass_kite', 'tollwind_back', 'lens_quiver', 'longwatch']) {
  s = { ...s, inv: { ...s.inv, bag: [...s.inv.bag, { uid: s.inv.nextUid, item: id, dye: [0, 0] }], nextUid: s.inv.nextUid + 1 } };
}
const kit = params.get('kit');
if (kit === 't1' || kit === 't2' || kit === 't3') {
  const items = kitItems(kit === 't1' ? 1 : kit === 't2' ? 2 : 3, job);
  for (const [slot, id] of Object.entries(items)) {
    if (!id) continue;
    let inst = s.inv.bag.find((i) => i.item === id);
    if (!inst) { inst = { uid: s.inv.nextUid, item: id, dye: [0, 0] }; s = { ...s, inv: { ...s.inv, bag: [...s.inv.bag, inst], nextUid: s.inv.nextUid + 1 } }; }
    run({ op: 'equip', uid: inst.uid, slot: slot as never });
  }
} else {
  const eq = (item: string, slot: string) => { const i = s.inv.bag.find((x) => x.item === item); if (i) run({ op: 'equip', uid: i.uid, slot: slot as never }); };
  eq('thornrunner_chest', 'chest'); eq('thornrunner_legs', 'legs'); eq('thornrunner_head', 'head');
}
s.inv.wardrobe = ['straw_sunhat', 'patchwork_cape', 'beacon_halo'];
if (level >= 4) run({ op: 'talent', row: 0, choice: 1 });

const jobsView = (): JobsView => {
  const out = {} as JobsView['jobs'];
  for (const id of Object.keys(JOBS) as JobId[]) {
    const r = s.jobs.jobs[id];
    const lv = r ? (id === job ? level : 1) : 1;
    out[id] = { level: lv, xp: r?.xp ?? 0, next: 0, picks: r?.picks ?? [JOBS[id].picks.solo[0], JOBS[id].picks.solo[1]], talents: r?.talents ?? [], outfit: r?.outfit ?? null };
  }
  return { current: s.jobs.current, jobs: out };
};

// ───────── the HUD ─────────
const hud = createHud(document.getElementById('hud')!);
const client = new InvClient();
const pos = at ? { x: TOWN_STALLS[at].x, z: TOWN_STALLS[at].z } : { x: 3, z: -6 };
const ctx = () => ctxFor(jobsView(), { zone: 'grove', x: pos.x, z: pos.z, inCombat: fight, dead: false, busy: false, sealed: false });
client.onInventory(inventoryView(s));
let sheet: ReturnType<typeof hud.charSheet> | null = null;
let stall: ReturnType<typeof hud.vendor> | null = null;
const answer = (a: SheetAct) => {
  if (a.kind !== 'op') return;
  const op = client.begin(a.op, performance.now());
  if (!op) return;
  sheet?.setPending(client.pendingKeys()); stall?.setPending(client.pendingKeys());
  // the stand-in server answers after a short delay, like a real one
  setTimeout(() => {
    const c = ctx();
    const r = run(op, { stall: c.stall, jobSwitch: c.jobSwitch, townBoard: c.townBoard, inCombat: c.inCombat });
    if (r) hud.toast(client.onRefused({ op: op.op, reason: r, text: '' }) ?? r);
    else client.onInventory(inventoryView(s));
    refresh();
  }, 250);
};
const refresh = () => {
  const v = client.view!;
  sheet?.update(charSheetView(v, ctx()));
  if (stall && at && at !== 'vault' && at !== 'barber') stall.update(vendorView(at, v, ctx(), pos));
  sheet?.setPending(client.pendingKeys()); stall?.setPending(client.pendingKeys());
};
const openChar = (tab: CharTab) => { if (sheet?.open) { sheet.setTab(tab); return; } sheet = hud.charSheet(charSheetView(client.view!, ctx()), tab, answer, () => { sheet = null; }); };
const openStall = (id: StallId) => { stall = hud.vendor(vendorView(id, client.view!, ctx(), pos), answer, () => { stall = null; }); };
hud.on((e) => { if (e.type === 'openChar') openChar(e.tab ?? 'gear'); });

// a fight behind, so toasts and the level-up can be judged against it
const slots = JOBS[job].bar.concat(jobs.jobs[job]!.picks).map((id) => ({ ability: ABILITY_DEFS[id], cdRemaining: 0, usable: true }));
const t0 = performance.now();
const frame = (now: number) => {
  const t = (now - t0) / 1000;
  const state: HudState = {
    player: { name: 'Wren', hp: 140, maxHp: 162, statuses: [], level, weapon: JOBS[job].weapon, cast: null, momentum: 40, dodge: { charges: 2, max: 2, refill: 1 },
      job: { id: job, name: JOBS[job].name, glyph: JOBS[job].glyph, level } },
    target: fight ? { name: 'Thornling', hp: 90 - (t * 6) % 80, maxHp: 120, statuses: ['marked'], stagger: 0, maxStagger: 0, isBoss: false, cast: null } : null,
    party: [], slots, quest: null, prompt: fight ? null : at ? `${TOWN_STALLS[at].name} · Shop` : null, inCombat: fight,
    social: { inParty: false, invites: 0 }, gear: { badge: charSheetView(client.view!, ctx()).openRows },
  };
  hud.render(state);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

// background
const cv = document.getElementById('game') as HTMLCanvasElement;
const paint = () => {
  const w = innerWidth, hh = innerHeight, c = cv.getContext('2d')!;
  cv.width = w; cv.height = hh;
  const g = c.createLinearGradient(0, 0, 0, hh);
  g.addColorStop(0, '#1754D1'); g.addColorStop(0.4, '#479AF2'); g.addColorStop(0.62, '#FCB380'); g.addColorStop(0.63, '#8FD16A'); g.addColorStop(1, '#5aa95a');
  c.fillStyle = g; c.fillRect(0, 0, w, hh);
  if (fight) {
    c.fillStyle = '#EC6A4C'; c.beginPath(); c.ellipse(w * 0.5, hh * 0.6, 12, 30, 0, 0, 7); c.fill();
    c.fillStyle = '#5D4675'; c.beginPath(); c.ellipse(w * 0.62, hh * 0.52, 22, 18, 0, 0, 7); c.fill();
  }
};
paint(); addEventListener('resize', paint);

const open = params.get('open');
const dev = {
  hud, client, openChar, openStall,
  get s() { return s; },
  loot(named = false) {
    hud.loot(lootShow({ items: [{ item: named ? 'last_bell' : 'wickthread_head', uid: 1 }], gold: 12, soldFor: 0, x: 0, z: 0 })!);
    setTimeout(() => hud.loot(lootShow({ items: [], gold: 3, soldFor: 40, x: 0, z: 0 })!), 300);
  },
  levelUp(lv = 7) { hud.levelUp(levelShow({ job, level: lv, talentRow: lv === 4 ? 0 : lv === 7 ? 1 : lv === 10 ? 2 : null }, ctx())!, () => openChar('talents')); },
};
(window as unknown as { gearDev: typeof dev }).gearDev = dev;
setTimeout(() => {
  if (open === 'gear' || open === 'bag' || open === 'talents' || open === 'wardrobe' || open === 'vault') openChar(open);
  else if (open === 'smithy' || open === 'lampwright' || open === 'tailor') openStall(open);
  if (params.has('loot')) dev.loot(params.get('loot') === 'named');
  if (params.has('levelup')) dev.levelUp(Number(params.get('levelup')) || 7);
  (window as unknown as { gearReady: boolean }).gearReady = true;
}, 50);
