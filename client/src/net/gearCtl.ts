// Plan 5: the gear screens in a room (online.ts makes one per room, after entering it, and disposes it on leaving).
// It opens the character sheet (the menu button, I, C, O, T, the level-up's talent button, the job board's Talents)
// and the stalls (a tap on a booth walks over and opens it, like the Guild Board; E or the prompt in reach), keeps
// every open sheet in step with the server's `inventory` and `jobs` and with where the adventurer stands, sends the
// player's ops through the gate (a fresh random op id each, never twice for one double tap), toasts refusals, shows
// loot (a toast and a sparkle where the enemy fell) and level-ups (the banner and a column of light, also on others
// from their lvlAt), and labels the stalls within 12 m. Its sheets close with it (the bug class of the job board).
import { Matrix, Vector3, type Viewport } from '@babylonjs/core';
import { ITEMS, STALL_IDS, STALL_REACH, TOWN_STALLS, isItemId, type InvOp, type StallId, type ZoneId } from '@sg2/shared';
import type { HudApi, HudEvent, HudState, TapInfo } from '../core/contracts';
import type { CharSheetHandle, CharTab, SheetAct, SheetHandle } from '../core/gearViews';
import type { Game } from '../boot';
import type { CombatController } from '../combat/controller';
import { createGearFx } from '../combat/gearFx';
import { h } from '../hud/dom';
import type { Stalls } from '../world/stalls';
import { stallOfEid } from '../world/stallIds';
import { equipHook } from './equipHook';
import { firstOf } from './tapOrder';
import { InvClient, charSheetView, ctxFor, itemColour, levelShow, vendorView, type GearCtx } from './inventory';
import { barberHook } from './looks';
import type { Remotes } from './remotes';
import type { ZoneRoom } from './session';

/** The name over a booth shows within this (m). */
const LABEL_RANGE = 12;
/** How often the open sheets re-check where the adventurer stands (ms). */
const CTX_EVERY_MS = 400;
const VERB: Readonly<Record<StallId, string>> = { smithy: 'Shop', tailor: 'Costumes and dyes', barber: 'A new look', lampwright: 'Shop', vault: 'Your Vault' };

const CSS = /* css */ `
.sg-stall-labels{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.sg-stall-label{position:absolute;left:0;top:0;display:none;padding:3px 10px 4px;border-radius:10px;white-space:nowrap;transform:translate(-50%,-100%);
  font:italic 600 15px var(--serif,Georgia,serif);color:#fff6e6;background:rgba(18,20,46,.62);box-shadow:0 0 0 1px rgba(255,226,160,.35);text-shadow:0 1px 3px rgba(0,0,0,.6)}
.sg-stall-label.on{display:block}
.sg-modal-open .sg-stall-labels,.sg-hidden .sg-stall-labels{display:none}
`;
let cssDone = false;

export interface GearCtlOpts {
  game: Game; hud: HudApi; room: ZoneRoom; zone: ZoneId; state: HudState;
  /** The client inventory (it outlives each room: `inventory` may come before this exists). */
  inv: InvClient;
  combat: CombatController; remotes: Remotes;
  /** The stalls in this zone (the grove), or null. */
  stalls: () => Stalls | null;
  /** The instance's sealed arena (Plan 4), when in one. */
  sealed: () => boolean;
  send: (op: InvOp) => void;
  /** Where the stall labels go (the HUD root). */
  labelLayer: HTMLElement;
}

export interface GearCtl {
  /** A HUD event this handles (openChar, and interact when a stall is in reach); true when handled. */
  onHud(e: HudEvent): boolean;
  /** A tap on a stall (walk over and open it); true when handled. */
  onTap(tap: TapInfo): boolean;
  /** The server sent a new inventory (already in `inv`), or a refusal, or loot, or a level-up. */
  inventory(): void;
  refused(m: unknown): void;
  loot(m: unknown): void;
  levelUp(m: unknown): void;
  openChar(tab: CharTab | null): void;
  /** Call every frame after the combat controller (it may set the stall prompt). */
  update(dt: number): void;
  readonly stall: string | null;
  dispose(): void;
}

export function createGearCtl(o: GearCtlOpts): GearCtl {
  const { game, hud, room, state, inv } = o;
  if (!cssDone) { cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }
  const fx = createGearFx(game.scene);
  let disposed = false;
  let sheet: CharSheetHandle | null = null;
  let lastTab: CharTab = 'gear';
  let vendor: { id: StallId; h: SheetHandle } | null = null;
  let promptStall: StallId | null = null;
  let ctxKey = '';
  let ctxAt = 0;
  let lastJobs: unknown = null;
  const gearState = { badge: 0 };

  const pos = () => game.rig.position;
  const ctx = (): GearCtx => {
    const p = pos(), d = o.combat.debug.self;
    return ctxFor(o.combat.debug.jobs, {
      zone: o.zone, x: p.x, z: p.z, inCombat: state.inCombat, dead: !!d?.dead || !!state.player.dead,
      busy: !!d?.cast, sealed: o.sealed(),
    });
  };
  const keyOf = (c: GearCtx) => `${c.job}|${c.level}|${c.stall}|${c.jobSwitch}|${c.townBoard}|${c.inCombat}|${c.dead}|${c.busy}|${c.sealed}|${c.talents.join()}|${c.picks.join()}|${c.outfit ? JSON.stringify(c.outfit) : ''}`;

  const pending = () => { const k = inv.pendingKeys(); sheet?.setPending(k); vendor?.h.setPending(k); };
  const onAct = (a: SheetAct) => {
    if (disposed) return;
    if (a.kind === 'tab') { lastTab = a.tab; return; }
    if (a.kind === 'barber') { void barberHook.open?.(); return; }
    const op = inv.begin(a.op, performance.now());
    if (!op) return; // the same op is already with the server (a double tap)
    o.send(op);
    pending();
  };
  /** Redraws the open sheets from the last inventory and where the adventurer stands now. */
  const refresh = () => {
    const v = inv.view;
    if (!v) return;
    const c = ctx();
    ctxKey = keyOf(c);
    const cs = charSheetView(v, c);
    gearState.badge = cs.openRows;
    if (sheet?.open) sheet.update(cs);
    if (vendor?.h.open) vendor.h.update(vendorView(vendor.id, v, c, pos()));
    pending();
  };

  const openChar = (tab: CharTab | null) => {
    if (disposed) return;
    const v = inv.view;
    if (!v) { hud.toast('Your things are still on their way…'); return; }
    const t = tab ?? lastTab;
    if (sheet?.open) {
      if (tab === null || (sheet.tab === t && t !== 'vault')) { sheet.close(); return; } // the button again closes it
      sheet.setTab(t); return;
    }
    vendor?.h.close();
    const c = ctx();
    ctxKey = keyOf(c);
    sheet = hud.charSheet(charSheetView(v, c), t, onAct, () => { sheet = null; });
    pending();
  };
  const openStall = (id: StallId) => {
    if (disposed) return;
    if (id === 'barber') { sheet?.close(); vendor?.h.close(); void barberHook.open?.(); return; }
    if (id === 'vault') { sheet?.close(); openChar('vault'); return; }
    const v = inv.view;
    if (!v) { hud.toast('Your things are still on their way…'); return; }
    sheet?.close();
    if (vendor?.h.open) { if (vendor.id === id) return; vendor.h.close(); }
    const c = ctx();
    ctxKey = keyOf(c);
    const handle = hud.vendor(vendorView(id, v, c, pos()), onAct, () => { if (vendor?.h === handle) vendor = null; });
    vendor = { id, h: handle };
    pending();
  };
  /** A tap on a booth: walk over (tap-to-walk) and open it, like the Guild Board. */
  const walkAndOpen = (id: StallId) => {
    const s = TOWN_STALLS[id], p = pos();
    if (Math.hypot(s.x - p.x, s.z - p.z) <= STALL_REACH || !hud.settings.tapToWalk || state.player.dead) { game.walkTo(null); openStall(id); return; }
    const y = game.world.groundAt(s.x, s.z) ?? p.y;
    if (!game.walkTo(new Vector3(s.x, y, s.z), { within: STALL_REACH - 0.6, then: () => { if (!disposed) openStall(id); } })) openStall(id);
  };

  // ── the stall names over the booths (DOM, projected; only those within reach of sight) ──
  const labelBox = h('div', 'sg-stall-labels', null);
  o.labelLayer.prepend(labelBox); // under the HUD's controls
  const labels = {} as Record<StallId, HTMLElement>;
  for (const id of STALL_IDS) labels[id] = h('div', 'sg-stall-label', labelBox, TOWN_STALLS[id].name);
  const shown = new Set<StallId>();
  const lastXY = {} as Record<StallId, [number, number]>;
  for (const id of STALL_IDS) lastXY[id] = [NaN, NaN];
  const at = new Vector3(), out = new Vector3();
  let vp: Viewport | null = null, vpW = 0, vpH = 0;
  const drawLabels = () => {
    const st = o.stalls();
    const cam = game.scene.activeCamera, cv = game.scene.getEngine().getRenderingCanvas();
    const p = pos();
    for (const id of STALL_IDS) {
      const s = TOWN_STALLS[id];
      let on = !!st && !!cam && !!cv && Math.hypot(s.x - p.x, s.z - p.z) <= LABEL_RANGE;
      if (on && cam && cv) {
        const w = cv.clientWidth, hh = cv.clientHeight;
        if (!vp || w !== vpW || hh !== vpH) { vpW = w; vpH = hh; vp = cam.viewport.toGlobal(w, hh); }
        at.set(s.x, (game.world.groundAt(s.x, s.z) ?? 0) + 3.15, s.z);
        Vector3.ProjectToRef(at, Matrix.IdentityReadOnly, game.scene.getTransformMatrix(), vp, out);
        on = out.z > 0 && out.z < 1;
        const xy = lastXY[id];
        // moved by a pixel or more: placed again (a still camera writes nothing)
        if (on && (Math.abs(out.x - xy[0]) >= 1 || Math.abs(out.y - xy[1]) >= 1)) {
          xy[0] = out.x; xy[1] = out.y;
          labels[id].style.transform = `translate(${Math.round(out.x)}px,${Math.round(out.y)}px) translate(-50%,-100%)`;
        }
      }
      if (on !== shown.has(id)) { labels[id].classList.toggle('on', on); if (on) shown.add(id); else shown.delete(id); }
    }
  };

  // ── level-ups seen on others (their lvlAt moves) ──
  const lvlSeen = new Map<number, number>();
  let lvlCheckAt = 0;
  const checkLevels = (me: number) => {
    room.state.players?.forEach((p) => {
      const at2 = (p as unknown as { lvlAt?: number }).lvlAt ?? 0, eid = p.eid;
      if (typeof eid !== 'number') return;
      const was = lvlSeen.get(eid);
      lvlSeen.set(eid, at2);
      if (was !== undefined && at2 !== was && at2 > 0 && eid !== me) {
        const view = o.remotes.viewOfEid(eid);
        fx.column(view?.root ?? null, p.x, p.y, p.z);
      }
    });
  };

  const openGear = () => openChar('gear');
  equipHook.open = openGear;

  return {
    get stall() { return vendor?.h.open ? vendor.id : sheet?.open && sheet.tab === 'vault' ? 'vault' : null; },
    onHud(e) {
      if (disposed) return false;
      if (e.type === 'openChar') { openChar(e.tab); return true; }
      if (e.type === 'interact' && promptStall) { openStall(promptStall); return true; }
      return false;
    },
    onTap(tap) {
      const id = stallOfEid(firstOf(tap, (e) => stallOfEid(e) !== null));
      if (!id || o.zone !== 'grove' || disposed) return false;
      walkAndOpen(id);
      return true;
    },
    inventory() {
      if (disposed) return;
      refresh();
    },
    refused(m) {
      const line = inv.onRefused(m);
      if (line) hud.toast(line);
      pending();
    },
    loot(m) {
      const l = inv.onLoot(m);
      if (!l || disposed) return;
      hud.loot(l);
      const mm = m as { x?: unknown; z?: unknown; items?: { item?: unknown }[] };
      if (l.items.length && typeof mm.x === 'number' && typeof mm.z === 'number') {
        const best = (mm.items ?? []).map((i) => i.item).filter(isItemId).sort((a, b) => ITEMS[b]!.tier - ITEMS[a]!.tier || Number(!!ITEMS[b]!.named) - Number(!!ITEMS[a]!.named))[0];
        if (best) fx.sparkle(mm.x, game.world.groundAt(mm.x, mm.z) ?? pos().y, mm.z, itemColour(best), !!ITEMS[best]!.named);
      }
    },
    levelUp(m) {
      const lv = inv.onLevelUp(m);
      if (!lv || disposed) return;
      const show = levelShow(m, ctx());
      if (show) hud.levelUp(show, () => openChar('talents'));
      fx.column(game.rig.view.root, pos().x, pos().y, pos().z);
    },
    openChar,
    update(dt) {
      if (disposed) return;
      fx.update(dt);
      // the gear button (once the inventory is here), its badge from the last refresh
      state.gear = inv.view ? gearState : null;
      // the stall prompt: when nothing else wants the prompt and a stall is in reach
      promptStall = null;
      if (o.zone === 'grove' && state.prompt === null && !state.player.dead) {
        const p = pos();
        let best: StallId | null = null, bd = STALL_REACH;
        for (const id of STALL_IDS) { const s = TOWN_STALLS[id], d = Math.hypot(s.x - p.x, s.z - p.z); if (d <= bd) { bd = d; best = id; } }
        if (best) { promptStall = best; state.prompt = PROMPTS[best]; }
      }
      if (o.zone === 'grove') drawLabels();
      const now = performance.now();
      if (now - ctxAt > CTX_EVERY_MS) {
        ctxAt = now;
        if (inv.expire(now)) pending();
        const jobs = o.combat.debug.jobs;
        if (inv.view && (jobs !== lastJobs || ((sheet?.open || vendor?.h.open) && keyOf(ctx()) !== ctxKey))) { lastJobs = jobs; refresh(); }
      }
      if (now - lvlCheckAt > 250) { lvlCheckAt = now; const me = room.state.players?.get(room.sessionId)?.eid; checkLevels(typeof me === 'number' ? me : -1); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (equipHook.open === openGear) equipHook.open = null;
      sheet?.close(); vendor?.h.close();
      sheet = null; vendor = null;
      promptStall = null;
      state.gear = null;
      fx.dispose();
      labelBox.remove();
    },
  };
}

const PROMPTS: Readonly<Record<StallId, string>> = Object.fromEntries(STALL_IDS.map((id) => [id, `${TOWN_STALLS[id].name} · ${VERB[id]}`])) as Record<StallId, string>;
