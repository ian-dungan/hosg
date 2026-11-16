// The Look v2 character creator and the Barber screen (phone first, plain DOM). A live 3D preview: drag to turn, pinch
// or the wheel to zoom, and quick camera buttons (Face, Body, Full); tabs Start (male or female, the people, presets,
// Surprise me, the look code to copy and paste), Body, Head, Eyes, Brows, Nose, Mouth, Ears, Skin, Hair, Facial hair,
// Marks, Style, and Name when a name is needed; sliders with 48 px targets and a reset each, a reset per tab, Undo and
// Redo, Compare (the look as it was), colour pickers (the palette's swatches and a custom colour, lightness-clamped),
// and Done (the Barber shows its price: a new people or body costs more; the free visit is free). The state is
// creatorState.ts; where things go on the screen is creatorLayout.ts; the 3D preview is injected
// (setCreatorPreview: player/creatorPreview.ts). Modal rules (movement and hotkeys held, closed on a room change) are
// the caller's (hud/index.ts overlays.hold, net/looks.ts createBarber).
import { BARBER_BODY_PRICE, BARBER_PEOPLE_PRICE, BARBER_PRICE, EMOTES, LOOK_PRESETS, PEOPLES, PEOPLE_IDS, clampLookColour, randomLook, type EmoteId, type Look } from '@sg2/shared';
import type { CreatorOpts } from '../core/contracts';
import { h } from './dom';
import { CreatorState, TAB_CAMERA, TAB_LABEL, controlsFor, dyeHex, dyeName, getPath, type Control, type CreatorTab } from './creatorState';
import { creatorLayout } from './creatorLayout';

/** The 3D preview the creator shows (a canvas of its own; see player/creatorPreview.ts). */
export interface CreatorPreview {
  readonly el: HTMLElement;
  setLook(l: Look): void;
  /** Frame the face, the upper body or the whole adventurer. */
  setFocus(f: 'face' | 'body' | 'full'): void;
  /** Walk in place (the Style tab), or stand. */
  setWalking(on: boolean): void;
  turn(dRad: number): void;
  zoom(factor: number): void;
  resize(): void;
  dispose(): void;
}
let previewFactory: (() => CreatorPreview) | null = null;
/** Installs the preview the creator draws (the online client does; tests and the offline demo need none). */
export function setCreatorPreview(f: (() => CreatorPreview) | null): void { previewFactory = f; }

/** The creator's own style (exported for its test). It takes pointer events itself: the HUD root it is put in has none. */
export const CREATOR_CSS = /* css */ `
.sg-cr{position:fixed;inset:0;z-index:80;pointer-events:auto;font:15px/1.35 var(--sans,system-ui,sans-serif);color:var(--cream,#fff6e6);
  background:radial-gradient(ellipse at 30% 30%,#3b3a6e 0%,#1e1b3a 70%);touch-action:none;-webkit-user-select:none;user-select:none}
.sg-cr *{box-sizing:border-box}
.sg-cr-pv{position:absolute;overflow:hidden;touch-action:none;cursor:grab}
.sg-cr-pv>canvas,.sg-cr-pv>div{position:absolute;inset:0;width:100%;height:100%;display:block;outline:none}
.sg-cr-ph{display:flex;align-items:center;justify-content:center;color:rgba(255,246,230,.5);font-size:14px}
.sg-cr-pnl{position:absolute;display:flex;flex-direction:column;background:rgba(16,18,42,.92);border-left:1px solid rgba(255,226,160,.16)}
.sg-cr.portrait .sg-cr-pnl{border-left:0;border-top:1px solid rgba(255,226,160,.22);border-radius:18px 18px 0 0}
.sg-cr-head{display:flex;align-items:center;gap:8px;padding:8px 12px 4px calc(12px + var(--sl,0px))}
.sg-cr-title{flex:1;font:700 18px/1.2 var(--serif,serif);color:var(--goldl,#ffe2a0)}
.sg-cr-gold{font-size:14px;color:#ffe08a}
.sg-cr-x{width:48px;height:48px;border-radius:24px;border:0;background:rgba(255,246,230,.1);color:inherit;font-size:22px;cursor:pointer}
.sg-cr-tabs{display:flex;gap:6px;overflow-x:auto;padding:4px 10px 8px;scrollbar-width:none;flex:none;touch-action:pan-x}
.sg-cr-tabs::-webkit-scrollbar{display:none}
.sg-cr-tab{flex:none;min-width:64px;height:48px;padding:0 14px;border-radius:24px;border:1px solid rgba(255,226,160,.25);
  background:rgba(255,246,230,.06);color:inherit;font:600 15px/1 var(--sans,sans-serif);cursor:pointer}
.sg-cr-tab.on{background:linear-gradient(180deg,#ffe49a,#F2B742);color:#3a2508;border-color:transparent}
.sg-cr-body{flex:1;min-height:0;overflow-y:auto;padding:6px 14px 10px;touch-action:pan-y;overscroll-behavior:contain}
.sg-cr-row{margin:6px 0 14px}
.sg-cr-lbl{display:flex;justify-content:space-between;align-items:baseline;font-weight:600;margin-bottom:4px;font-size:15px}
.sg-cr-lbl i{font-style:normal;font-weight:500;color:#ffe08a}
.sg-cr-ends{display:flex;justify-content:space-between;font-size:14px;color:rgba(255,246,230,.6)}
.sg-cr-range{-webkit-appearance:none;appearance:none;width:100%;height:48px;background:transparent;margin:0;touch-action:pan-y;cursor:pointer}
.sg-cr-range::-webkit-slider-runnable-track{height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(255,246,230,.18),rgba(242,183,66,.7))}
.sg-cr-range::-webkit-slider-thumb{-webkit-appearance:none;width:44px;height:44px;margin-top:-17px;border-radius:22px;border:3px solid #fff6e6;background:#F2B742;box-shadow:0 2px 6px rgba(0,0,0,.4)}
.sg-cr-range::-moz-range-track{height:10px;border-radius:5px;background:rgba(255,246,230,.25)}
.sg-cr-range::-moz-range-thumb{width:44px;height:44px;border-radius:22px;border:3px solid #fff6e6;background:#F2B742}
.sg-cr-pick{display:flex;align-items:center;gap:8px}
.sg-cr-arrow{flex:none;width:48px;height:48px;border-radius:24px;border:1px solid rgba(255,226,160,.3);background:rgba(255,246,230,.08);color:inherit;font-size:20px;cursor:pointer}
.sg-cr-val{flex:1;text-align:center;font-weight:600;font-size:16px}
.sg-cr-strip{display:flex;gap:6px;overflow-x:auto;padding:6px 0 2px;scrollbar-width:none;touch-action:pan-x}
.sg-cr-strip::-webkit-scrollbar{display:none}
.sg-cr-chip{flex:none;min-width:48px;height:48px;padding:0 10px;border-radius:12px;border:1px solid rgba(255,226,160,.2);background:rgba(255,246,230,.06);
  color:inherit;font:500 14px/1 var(--sans,sans-serif);cursor:pointer;white-space:nowrap}
.sg-cr-chip.on{border:2px solid #F2B742;background:rgba(242,183,66,.22)}
.sg-cr-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px;margin:4px 0 8px}
.sg-cr-swb{height:48px;min-width:48px;border-radius:12px;border:2px solid rgba(255,255,255,.18);cursor:pointer}
.sg-cr-swb.on{border:3px solid #fff6e6;box-shadow:0 0 0 2px #F2B742}
.sg-cr-swb.undyed{background:repeating-linear-gradient(45deg,#6b6a7a 0 6px,#8c8b9a 6px 12px)}
.sg-cr-bar{position:relative;height:48px;border-radius:12px;margin:6px 0;cursor:pointer;touch-action:none;border:1px solid rgba(255,255,255,.2)}
.sg-cr-bar b{position:absolute;top:-3px;bottom:-3px;width:10px;margin-left:-5px;border-radius:5px;border:2px solid #fff;box-shadow:0 0 0 1px #000a;pointer-events:none}
.sg-cr-chipc{display:inline-block;width:48px;height:28px;border-radius:8px;border:2px solid #fff6e6;vertical-align:middle;margin-left:8px}
.sg-cr-people{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.sg-cr-card{min-height:64px;text-align:left;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,226,160,.25);background:rgba(255,246,230,.06);color:inherit;cursor:pointer}
.sg-cr-card b{display:block;font:700 16px/1.2 var(--serif,serif);color:var(--goldl,#ffe2a0);margin-bottom:3px}
.sg-cr-card span{font-size:14px;color:rgba(255,246,230,.8)}
.sg-cr-card.on{border:2px solid #F2B742;background:rgba(242,183,66,.18)}
.sg-cr-name{width:100%;height:52px;border-radius:12px;border:2px solid rgba(255,226,160,.35);background:rgba(0,0,0,.25);color:inherit;font:600 18px var(--sans,sans-serif);padding:0 14px;outline:none;user-select:text;-webkit-user-select:text}
.sg-cr-name:focus{border-color:#F2B742}
.sg-cr-err{min-height:20px;margin-top:6px;font-size:14px;color:#ffb4a0}
.sg-cr-note{padding:0 14px;min-height:20px;font-size:14px;color:#ffb4a0;text-align:center}
.sg-cr-foot{display:flex;gap:8px;padding:6px 10px calc(10px + var(--sb,0px));flex:none}
.sg-cr-foot button{flex:1;min-width:0;height:52px;border-radius:26px;border:1px solid rgba(255,226,160,.35);background:rgba(255,246,230,.08);color:inherit;font:600 15px/1.1 var(--sans,sans-serif);cursor:pointer;padding:0 8px}
.sg-cr-foot .done{flex:1.6;color:#3a2508;border-color:transparent;background:linear-gradient(180deg,#ffe49a,#F2B742 60%,#dc9a2c)}
.sg-cr-foot button:disabled{opacity:.42;cursor:default}
.sg-cr-hint{position:absolute;left:0;right:0;bottom:8px;margin:0;text-align:center;font-size:14px;color:rgba(255,246,230,.6);pointer-events:none}
.sg-ew{position:fixed;inset:0;z-index:70;pointer-events:auto;display:flex;align-items:center;justify-content:center;background:rgba(10,10,26,.35)}
.sg-ew-ring{position:relative;width:260px;height:260px;border-radius:50%;background:rgba(16,18,42,.85);border:1px solid rgba(255,226,160,.3)}
.sg-ew-ring button{position:absolute;width:76px;height:56px;margin:-28px 0 0 -38px;border-radius:28px;border:1px solid rgba(255,226,160,.35);background:rgba(255,246,230,.1);color:#fff6e6;font:600 15px var(--sans,sans-serif);cursor:pointer}
`;
/** Look v2's additions to the creator's style (48 px targets everywhere). */
const CREATOR_CSS_V2 = /* css */ `
.sg-cr-pv>.sg-cr-cams,.sg-cr-pv>.sg-cr-tools{inset:auto;width:auto;height:auto}
.sg-cr-pv>.sg-cr-cams{position:absolute;right:8px;top:8px;display:flex;flex-direction:column;gap:6px;z-index:2}
.sg-cr-cams button,.sg-cr-tools button{min-width:56px;height:48px;padding:0 12px;border-radius:24px;border:1px solid rgba(255,226,160,.35);background:rgba(16,18,42,.72);color:#fff6e6;font:600 14px/1 var(--sans,sans-serif);cursor:pointer}
.sg-cr-cams button.on,.sg-cr-tools button.on{background:linear-gradient(180deg,#ffe49a,#F2B742);color:#3a2508}
.sg-cr-pv>.sg-cr-tools{position:absolute;left:8px;top:8px;display:flex;gap:6px;z-index:2;flex-wrap:wrap;max-width:calc(100% - 90px)}
.sg-cr-tools button:disabled{opacity:.4}
.sg-cr-rowh{display:flex;align-items:center;gap:8px}
.sg-cr-rowh .sg-cr-lbl{flex:1;margin:0}
.sg-cr-rst{flex:none;width:48px;height:48px;border-radius:24px;border:1px solid rgba(255,226,160,.25);background:rgba(255,246,230,.06);color:inherit;font-size:20px;cursor:pointer}
.sg-cr-tabrst{width:100%;height:48px;margin:4px 0 8px;border-radius:24px;border:1px dashed rgba(255,226,160,.35);background:transparent;color:inherit;font:600 14px var(--sans,sans-serif);cursor:pointer}
.sg-cr-two{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}
.sg-cr-big{height:56px;border-radius:16px;border:1px solid rgba(255,226,160,.3);background:rgba(255,246,230,.06);color:inherit;font:700 16px var(--serif,serif);cursor:pointer}
.sg-cr-big.on{border:2px solid #F2B742;background:rgba(242,183,66,.2)}
.sg-cr-sub{margin:12px 0 6px;font:700 15px var(--serif,serif);color:var(--goldl,#ffe2a0)}
.sg-cr-hintp{font-size:13px;color:rgba(255,246,230,.7);margin:2px 0 8px}
.sg-cr-code{width:100%;height:48px;border-radius:12px;border:2px solid rgba(255,226,160,.3);background:rgba(0,0,0,.25);color:inherit;font:13px ui-monospace,monospace;padding:0 10px;user-select:text;-webkit-user-select:text}
.sg-cr-swb.none{background:repeating-linear-gradient(45deg,#6b6a7a 0 6px,#8c8b9a 6px 12px);color:#fff;font:600 12px var(--sans,sans-serif)}
`;
function injectCss() {
  if (document.getElementById('sg-creator-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-creator-css';
  s.textContent = CREATOR_CSS + CREATOR_CSS_V2;
  document.head.appendChild(s);
}

const toHex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
function rgbToHsl(c: number): [number, number, number] {
  const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh *= 60; if (hh < 0) hh += 360;
  return [hh, s, l];
}
function hslToRgb(hh: number, s: number, l: number): number {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  const q = (v: number) => Math.max(0, Math.min(255, Math.round((v + m) * 255)));
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

export interface CreatorHandle {
  readonly done: Promise<{ look: Look; name?: string } | null>;
  close(): void;
  /** Tests and browser checks: the state behind the screen, and the tab shown. */
  readonly state: CreatorState;
  showTab(t: CreatorTab): void;
}

/** Opens the creator (or the Barber) over `host`; resolves on Done, or null when closed (the Barber only). */
export function openCreator(host: HTMLElement, o: CreatorOpts & { notice?: string }): CreatorHandle {
  injectCss();
  const st = new CreatorState(o);
  const root = h('div', 'sg-cr', host);
  root.setAttribute('role', 'dialog');
  const pv = h('div', 'sg-cr-pv', root);
  const preview = previewFactory?.() ?? null;
  if (preview) pv.appendChild(preview.el);
  else h('div', 'sg-cr-ph', pv, 'Preview');
  h('p', 'sg-cr-hint', pv, 'Drag to turn · pinch to zoom');
  // the preview's tools: camera, undo/redo, compare
  const cams = h('div', 'sg-cr-cams', pv);
  const camBtns = (['face', 'body', 'full'] as const).map((f) => {
    const b = h('button', '', cams, f === 'face' ? 'Face' : f === 'body' ? 'Body' : 'Full');
    b.addEventListener('click', (e) => { e.stopPropagation(); setCam(f); });
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    return [f, b] as const;
  });
  const tools = h('div', 'sg-cr-tools', pv);
  const undo = h('button', '', tools, '↶ Undo'), redo = h('button', '', tools, 'Redo ↷'), cmp = h('button', '', tools, 'Compare');
  for (const b of [undo, redo, cmp]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  const pnl = h('div', 'sg-cr-pnl', root);
  const head = h('div', 'sg-cr-head', pnl);
  h('div', 'sg-cr-title', head, o.mode === 'barber' ? 'The Trimmed Hedge' : 'Your adventurer');
  h('div', 'sg-cr-gold', head, o.mode === 'barber' && !o.free ? `${o.gold} gold` : '');
  let closeBtn: HTMLButtonElement | null = null;
  if (o.mode === 'barber') { closeBtn = h('button', 'sg-cr-x', head, '×'); closeBtn.setAttribute('aria-label', 'Close'); }
  const tabsEl = h('div', 'sg-cr-tabs', pnl);
  const body = h('div', 'sg-cr-body', pnl);
  const note = h('div', 'sg-cr-note', pnl, o.notice ?? '');
  const foot = h('div', 'sg-cr-foot', pnl);
  const surprise = h('button', '', foot, 'Surprise me');
  const done = h('button', 'done', foot, st.doneLabel);

  let tab: CreatorTab = st.startTab(o.notice);
  let cam: 'face' | 'body' | 'full' = TAB_CAMERA[tab];
  let resolve!: (v: { look: Look; name?: string } | null) => void;
  const promise = new Promise<{ look: Look; name?: string } | null>((r) => { resolve = r; });
  let finished = false;

  const setCam = (f: 'face' | 'body' | 'full') => { cam = f; preview?.setFocus(f); for (const [k, b] of camBtns) b.classList.toggle('on', k === f); };
  const showLook = () => preview?.setLook(st.shown);
  const refreshFoot = () => {
    undo.disabled = !st.canUndo; redo.disabled = !st.canRedo;
    cmp.classList.toggle('on', st.comparing);
    done.textContent = st.doneLabel;
    done.disabled = !!st.blocker;
    note.textContent = st.noteLine(tab, o.notice);
  };
  const changed = () => { showLook(); refreshFoot(); };
  /** A row's header: its label, its value, and a reset button. */
  const rowHead = (row: HTMLElement, c: Control, label: string) => {
    const hd = h('div', 'sg-cr-rowh', row);
    const lbl = h('div', 'sg-cr-lbl', hd, label);
    const val = h('i', '', lbl);
    const rst = h('button', 'sg-cr-rst', hd, '↺');
    rst.setAttribute('aria-label', `Reset ${label}`);
    rst.addEventListener('click', () => { if (st.reset(c)) { changed(); renderTab(); } });
    return val;
  };

  // ── controls ──
  const sliderRow = (c: Extract<Control, { kind: 'slider' }>) => {
    const row = h('div', 'sg-cr-row', body);
    const val = rowHead(row, c, c.label);
    const input = h('input', 'sg-cr-range', row);
    input.type = 'range'; input.min = String(c.min); input.max = String(c.max); input.step = '1';
    input.value = String(getPath(st.look, c.path) ?? c.neutral);
    input.setAttribute('aria-label', c.label);
    const ends = h('div', 'sg-cr-ends', row);
    h('span', '', ends, c.ends[0]); h('span', '', ends, c.ends[1]);
    const show = () => { const v = Number(getPath(st.look, c.path) ?? c.neutral), d = v - c.neutral; val.textContent = d === 0 ? (c.neutral === 0 ? 'none' : 'average') : d < 0 ? `−${-d}` : `+${d}`; };
    show();
    input.addEventListener('input', () => { if (st.set(c.path, Number(input.value))) changed(); show(); });
  };
  const pickerRow = (c: Extract<Control, { kind: 'picker' }>) => {
    const row = h('div', 'sg-cr-row', body);
    rowHead(row, c, c.label);
    const pick = h('div', 'sg-cr-pick', row);
    const prev = h('button', 'sg-cr-arrow', pick, '‹'); prev.setAttribute('aria-label', `Previous ${c.label}`);
    const val = h('div', 'sg-cr-val', pick);
    const next = h('button', 'sg-cr-arrow', pick, '›'); next.setAttribute('aria-label', `Next ${c.label}`);
    const strip = h('div', 'sg-cr-strip', row);
    const chips = c.options.map((name, i) => {
      const b = h('button', 'sg-cr-chip', strip, name);
      b.addEventListener('click', () => { if (st.set(c.path, i)) { changed(); show(); } });
      return b;
    });
    const show = () => {
      const v = Number(getPath(st.look, c.path) ?? 0);
      val.textContent = c.options[v] ?? String(v + 1);
      chips.forEach((b, i) => b.classList.toggle('on', i === v));
      chips[v]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    show();
    prev.addEventListener('click', () => { if (st.step(c.path, -1)) { changed(); show(); } });
    next.addEventListener('click', () => { if (st.step(c.path, 1)) { changed(); show(); } });
  };
  /** A drag strip (hue or lightness): tap or drag sets a value 0..1. */
  const strip = (row: HTMLElement, bg: () => string, at: () => number, set: (t: number) => void, label: string) => {
    const bar = h('div', 'sg-cr-bar', row);
    bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', label);
    const knob = h('b', '', bar);
    const paint = () => { bar.style.background = bg(); knob.style.left = `${(at() * 100).toFixed(1)}%`; };
    const from = (e: PointerEvent) => { const r = bar.getBoundingClientRect(); set(Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)))); };
    bar.addEventListener('pointerdown', (e) => { bar.setPointerCapture?.(e.pointerId); from(e); e.preventDefault(); });
    bar.addEventListener('pointermove', (e) => { if (e.buttons) from(e); });
    return paint;
  };
  const colourRow = (c: Extract<Control, { kind: 'colour' }>) => {
    const row = h('div', 'sg-cr-row', body);
    const val = rowHead(row, c, c.label);
    const chip = h('span', 'sg-cr-chipc', val);
    const sw = h('div', 'sg-cr-sw', row);
    const cur = () => getPath(st.look, c.path) ?? null;
    let paints: (() => void)[] = [];
    const btns: [HTMLButtonElement, number | null][] = [];
    if (c.none) {
      const b = h('button', 'sg-cr-swb none', sw, c.none);
      b.addEventListener('click', () => { if (st.set(c.path, null)) changed(); show(); });
      btns.push([b, null]);
    }
    for (const s of c.swatches) {
      const b = h('button', 'sg-cr-swb', sw);
      b.style.background = toHex(s.colour); b.setAttribute('aria-label', s.name); b.title = s.name;
      b.addEventListener('click', () => { if (st.set(c.path, s.colour)) changed(); show(); });
      btns.push([b, s.colour]);
    }
    h('div', 'sg-cr-hintp', row, 'Or your own colour:');
    const base = () => cur() ?? c.swatches[0]!.colour;
    const setHsl = (hh: number | null, l: number | null) => {
      const [h0, s0, l0] = rgbToHsl(base());
      const v = clampLookColour(hslToRgb(hh ?? h0, hh !== null && s0 < 0.08 ? 0.55 : s0, l ?? l0));
      if (st.set(c.path, v)) changed();
      show();
    };
    paints = [
      strip(row, () => 'linear-gradient(90deg,#f33,#fd3,#3e5,#3dd,#35f,#d3f,#f33)', () => rgbToHsl(base())[0] / 360, (t) => setHsl(t * 359.9, null), `${c.label} hue`),
      strip(row, () => { const [hh, s] = rgbToHsl(base()); return `linear-gradient(90deg,#111,${toHex(hslToRgb(hh, Math.max(s, 0.3), 0.5))},#f8f8f8)`; }, () => rgbToHsl(base())[2], (t) => setHsl(null, 0.04 + t * 0.92), `${c.label} lightness`),
    ];
    const show = () => {
      const v = cur();
      chip.style.background = v === null ? 'transparent' : toHex(v);
      for (const [b, col] of btns) b.classList.toggle('on', col === v);
      for (const p of paints) p();
    };
    show();
  };
  const paletteRow = (c: Extract<Control, { kind: 'palette' }>) => {
    const row = h('div', 'sg-cr-row', body);
    const val = rowHead(row, c, c.label);
    const sw = h('div', 'sg-cr-sw', row);
    const btns = [{ name: 'None', colour: -1 }, ...c.swatches].map((s, i) => {
      const b = h('button', i === 0 ? 'sg-cr-swb none' : 'sg-cr-swb', sw, i === 0 ? 'None' : '');
      if (i > 0) b.style.background = toHex(s.colour);
      b.setAttribute('aria-label', s.name); b.title = s.name;
      b.addEventListener('click', () => { if (st.set(c.path, i)) changed(); show(); });
      return b;
    });
    const show = () => { const v = Number(getPath(st.look, c.path) ?? 0); val.textContent = v ? c.swatches[v - 1]!.name : 'none'; btns.forEach((b, i) => b.classList.toggle('on', i === v)); };
    show();
  };
  const bitsRow = (c: Extract<Control, { kind: 'bits' }>) => {
    const row = h('div', 'sg-cr-row', body);
    rowHead(row, c, c.label);
    const strip2 = h('div', 'sg-cr-strip', row);
    strip2.style.flexWrap = 'wrap';
    const chips = c.options.map((name, i) => {
      const b = h('button', 'sg-cr-chip', strip2, name);
      b.addEventListener('click', () => { if (st.toggleBit(c.path, i)) changed(); show(); });
      return b;
    });
    const show = () => { const v = Number(getPath(st.look, c.path) ?? 0); chips.forEach((b, i) => b.classList.toggle('on', (v & (1 << i)) !== 0)); };
    show();
  };
  const dyeRow = (c: Extract<Control, { kind: 'dye' }>) => {
    const row = h('div', 'sg-cr-row', body);
    const val = rowHead(row, c, c.label);
    const sw = h('div', 'sg-cr-sw', row);
    const btns = Array.from({ length: 32 }, (_, d) => {
      const b = h('button', d === 0 ? 'sg-cr-swb undyed' : 'sg-cr-swb', sw);
      if (d > 0) b.style.background = dyeHex(d);
      b.setAttribute('aria-label', dyeName(d));
      b.addEventListener('click', () => { if (st.set(c.path, d)) changed(); show(); });
      return b;
    });
    const show = () => { const v = Number(getPath(st.look, c.path) ?? 0); val.textContent = dyeName(v); btns.forEach((b, i) => b.classList.toggle('on', i === v)); };
    show();
  };
  const startRows = () => {
    const priced = o.mode === 'barber' && !o.free;
    h('div', 'sg-cr-sub', body, 'Body');
    const two = h('div', 'sg-cr-two', body);
    for (const b of ['male', 'female'] as const) {
      const btn = h('button', 'sg-cr-big', two, b === 'male' ? 'Male' : 'Female');
      btn.classList.toggle('on', st.look.body === b);
      btn.addEventListener('click', () => { if (st.setBody(b)) { changed(); renderTab(); } });
    }
    h('div', 'sg-cr-hintp', body, priced ? `At the Barber: ${BARBER_PRICE} gold a change, ${BARBER_BODY_PRICE} for a new body, ${BARBER_PEOPLE_PRICE} for a new people.` : 'Every choice is open to both bodies.');
    h('div', 'sg-cr-sub', body, 'People');
    const grid = h('div', 'sg-cr-people', body);
    for (const p of PEOPLE_IDS) {
      const b = h('button', 'sg-cr-card', grid);
      h('b', '', b, PEOPLES[p].name);
      h('span', '', b, PEOPLES[p].blurb);
      b.classList.toggle('on', st.look.people === p);
      b.addEventListener('click', () => { if (st.setPeople(p)) { changed(); renderTab(); } });
    }
    h('div', 'sg-cr-sub', body, 'Start from a face');
    const ps = h('div', 'sg-cr-strip', body);
    ps.style.flexWrap = 'wrap';
    for (const p of LOOK_PRESETS) {
      const b = h('button', 'sg-cr-chip', ps, `${p.name}`);
      b.title = `${PEOPLES[p.look.people].name}, ${p.look.body}`;
      if (p.look.people === st.look.people && p.look.body === st.look.body) b.style.borderColor = '#F2B742';
      b.addEventListener('click', () => { if (st.applyPreset(p.id)) { changed(); renderTab(); } });
    }
    h('div', 'sg-cr-sub', body, 'Look code');
    h('div', 'sg-cr-hintp', body, 'Copy it to share your look; paste one to wear it.');
    const code = h('input', 'sg-cr-code', body);
    code.value = st.code; code.spellcheck = false; code.setAttribute('aria-label', 'Look code');
    code.addEventListener('keydown', (e) => e.stopPropagation());
    const two2 = h('div', 'sg-cr-two', body);
    const copy = h('button', 'sg-cr-big', two2, 'Copy');
    const paste = h('button', 'sg-cr-big', two2, 'Use this code');
    const err = h('div', 'sg-cr-err', body);
    copy.addEventListener('click', () => {
      code.value = st.code; code.select();
      void navigator.clipboard?.writeText(st.code).then(() => { err.textContent = 'Copied'; }, () => { err.textContent = 'Selected: copy it from the box'; });
    });
    paste.addEventListener('click', () => {
      const r = st.pasteCode(code.value);
      if (r.ok) { changed(); renderTab(); } else err.textContent = r.error;
    });
  };
  const nameRow = () => {
    const row = h('div', 'sg-cr-row', body);
    h('div', 'sg-cr-lbl', row, 'Name');
    const input = h('input', 'sg-cr-name', row);
    input.maxLength = 16; input.autocomplete = 'off'; input.spellcheck = false; input.placeholder = '3 to 16 letters';
    input.setAttribute('aria-label', 'Name');
    input.value = st.name;
    const err = h('div', 'sg-cr-err', row);
    const show = () => { err.textContent = st.name ? st.nameError ?? '' : ''; refreshFoot(); };
    input.addEventListener('input', () => { st.name = input.value; show(); });
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && !st.blocker) finish(st.result()); });
    show();
    h('div', 'sg-cr-ends', row, 'Names are for good: letters, and one space, hyphen or apostrophe between them.');
  };
  const renderTab = () => {
    const keep = body.scrollTop;
    const same = body.dataset.tab === tab;
    body.textContent = '';
    body.dataset.tab = tab;
    for (const b of tabsEl.children) b.classList.toggle('on', (b as HTMLElement).dataset.tab === tab);
    const cs = controlsFor(tab, st.look);
    if (cs.some((c) => 'path' in c)) {
      const r = h('button', 'sg-cr-tabrst', body, `Reset ${TAB_LABEL[tab]}`);
      r.addEventListener('click', () => { if (st.resetTab(tab)) { changed(); renderTab(); } });
    }
    for (const c of cs) {
      switch (c.kind) {
        case 'start': startRows(); break;
        case 'slider': sliderRow(c); break;
        case 'picker': pickerRow(c); break;
        case 'colour': colourRow(c); break;
        case 'palette': paletteRow(c); break;
        case 'bits': bitsRow(c); break;
        case 'dye': dyeRow(c); break;
        case 'name': nameRow(); break;
      }
    }
    preview?.setWalking(tab === 'style');
    body.scrollTop = same ? keep : 0;
    refreshFoot();
  };
  const showTab = (t: CreatorTab) => { tab = t; setCam(TAB_CAMERA[t]); renderTab(); };
  for (const t of st.tabs) {
    const b = h('button', 'sg-cr-tab', tabsEl, TAB_LABEL[t]);
    b.dataset.tab = t;
    b.addEventListener('click', () => showTab(t));
  }

  // ── preview: drag to turn, pinch or the wheel to zoom ──
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  pv.addEventListener('pointerdown', (e) => { pv.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
  pv.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    if (pts.size === 1) preview?.turn((e.clientX - p.x) * 0.012);
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (pinch > 0 && d > 0) preview?.zoom(pinch / d);
      pinch = d;
    }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = 0; };
  pv.addEventListener('pointerup', up); pv.addEventListener('pointercancel', up);
  pv.addEventListener('wheel', (e) => { e.preventDefault(); preview?.zoom(e.deltaY > 0 ? 1.1 : 0.9); }, { passive: false });

  // ── layout ──
  const place = () => {
    const w = window.innerWidth, hh = window.innerHeight;
    const L = creatorLayout(w, hh);
    root.className = `sg-cr ${L.kind}`;
    for (const [el, r] of [[pv, L.preview], [pnl, L.panel]] as const) {
      el.style.left = `${r.x}px`; el.style.top = `${r.y}px`; el.style.width = `${r.w}px`; el.style.height = `${r.h}px`;
    }
    preview?.resize();
  };
  window.addEventListener('resize', place);

  // ── buttons ──
  surprise.addEventListener('click', () => { if (st.randomise(randomLook, Math.random)) { changed(); renderTab(); } });
  undo.addEventListener('click', () => { if (st.undo()) { changed(); renderTab(); } });
  redo.addEventListener('click', () => { if (st.redo()) { changed(); renderTab(); } });
  cmp.addEventListener('click', () => { st.comparing = !st.comparing; changed(); });
  const finish = (v: { look: Look; name?: string } | null) => {
    if (finished) return;
    finished = true;
    window.removeEventListener('resize', place);
    window.removeEventListener('keydown', onKey, true);
    preview?.dispose();
    root.remove();
    resolve(v);
  };
  done.addEventListener('click', () => { if (!st.blocker) finish(st.result()); });
  closeBtn?.addEventListener('click', () => finish(null));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && o.mode === 'barber') { e.stopPropagation(); finish(null); }
  };
  window.addEventListener('keydown', onKey, true);

  place();
  showLook();
  showTab(tab);
  void cam;
  return { done: promise, close: () => finish(null), state: st, showTab };
}

/** The emote wheel: six emotes round a ring; resolves with the one tapped, or null (a tap outside, Esc). */
export function openEmoteWheel(host: HTMLElement): Promise<EmoteId | null> {
  injectCss();
  return new Promise((resolve) => {
    const root = h('div', 'sg-ew', host);
    const ring = h('div', 'sg-ew-ring', root);
    const end = (v: EmoteId | null) => { window.removeEventListener('keydown', key, true); root.remove(); resolve(v); };
    EMOTES.forEach((e, i) => {
      const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
      const b = h('button', '', ring, e[0]!.toUpperCase() + e.slice(1));
      b.style.left = `${130 + Math.cos(a) * 88}px`; b.style.top = `${130 + Math.sin(a) * 88}px`;
      b.addEventListener('click', (ev) => { ev.stopPropagation(); end(e); });
    });
    root.addEventListener('click', () => end(null));
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopPropagation(); end(null); } };
    window.addEventListener('keydown', key, true);
  });
}
