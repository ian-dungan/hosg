// The CSS of show-as (the Gear tab's slot rows, a slot card's Appearance part, the set picker, the dye rows, the
// outfits and the Tailor's pieces), added once on first use. Phone first like the gear sheets: every control at
// least 48 px, no text under 14 px; long lists scroll inside the card.
export const LOOK_CSS = /* css */ `
/* ───────── the Gear tab: slot rows ───────── */
.sg-lbar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.sg-lbar .sg-gs-btn{flex:1 1 140px;min-width:0;min-height:48px;padding:4px 12px;white-space:normal;line-height:1.2;text-align:center}
.sg-lbar svg,.sg-lrow-look svg{width:20px;height:20px;flex:none}
.sg-lrows{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.sg-lrow{display:flex;align-items:center;gap:10px;min-height:72px;padding:4px 6px 4px 4px;border-radius:14px;background:rgba(255,246,230,.055);box-shadow:inset 0 0 0 1px rgba(255,226,160,.12)}
.sg-lrow.sel{box-shadow:inset 0 0 0 2px #fff6e6}
.sg-lrow.shown{background:rgba(63,176,166,.1);box-shadow:inset 0 0 0 1px rgba(63,176,166,.45)}
.sg-lrow .sg-tile.none{opacity:.35;cursor:default}
.sg-lrow-mid{flex:1;min-width:0;cursor:pointer;padding:2px 0}
.sg-lrow-slot{font-size:14px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--gold2);line-height:1.2}
.sg-lrow-mid .sg-row-name{white-space:nowrap}
.sg-lrow-stats{font-size:14px;line-height:1.3;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-lrow-as{margin-top:2px;font-size:14px;font-weight:600;line-height:1.3;color:#bff3ec}
.sg-lrow-as svg{display:inline-block;width:16px;height:16px;vertical-align:-3px;margin-right:4px}
.sg-lrow-as b{color:var(--rc,#fff6e6)}
.sg-lrow-as.hid{color:#ffd9a8}
.sg-lrow-look{flex:none;flex-direction:column;gap:0;min-width:56px;min-height:56px;padding:4px 6px;border-radius:14px;font-size:14px;line-height:1.1}
@media (min-width:701px) and (min-height:501px){ .sg-lrow-look{min-width:52px} }

/* ───────── the slot card: Item | Appearance ───────── */
.sg-lparts{display:flex;gap:4px;margin:0 52px 10px 0;padding:3px;border-radius:16px;background:rgba(10,12,32,.5)}
.sg-lpart{flex:1;min-height:48px;border-radius:13px;box-shadow:none;background:none}
.sg-lpart.on{color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742)}
.sg-card .sg-wrow .sg-wopt{flex:1 1 120px;min-width:0;white-space:normal;line-height:1.2;padding:4px 10px}
.sg-lworn{font-size:14px;line-height:1.35;opacity:.9;margin:2px 2px 8px}
.sg-lworn b{color:var(--rc)}
.sg-lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:6px;max-height:min(316px,46vh);overflow-y:auto;touch-action:pan-y;overscroll-behavior:contain;
  padding:2px;border-radius:12px;background:rgba(10,12,32,.3)}
.sg-lcell{display:flex;align-items:center;justify-content:flex-start;gap:8px;min-height:64px;padding:6px 8px;border-radius:12px;text-align:left;white-space:normal;
  box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--rc) 55%,transparent);background:rgba(255,246,230,.06)}
.sg-lcell.on{background:rgba(63,176,166,.22);box-shadow:inset 0 0 0 3px var(--rc)}
.sg-lcell-ic{flex:none;width:44px;height:44px;border-radius:10px;background:rgba(10,12,32,.55) center/40px no-repeat;box-shadow:inset 0 0 0 1.5px var(--rc)}
.sg-lcell-t{flex:1;min-width:0;display:flex;flex-direction:column}
.sg-lcell-t b{font:600 16px/1.2 var(--serif);color:var(--rc);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.sg-lcell-t small{font-size:14px;line-height:1.2;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-lcell.on small{opacity:1;font-weight:700;color:#bff3ec}

/* ───────── dyes: three swatch rows ───────── */
.sg-ldye-lab{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:8px 2px 4px;font-size:14px;font-weight:700}
.sg-ldye-lab span:last-child{font-weight:600;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-ldye{display:flex;gap:6px;overflow-x:auto;touch-action:pan-x;overscroll-behavior:contain;padding:4px 4px 6px;scrollbar-width:thin}
.sg-ldye .sg-swatch{flex:none;position:relative}
.sg-ldye .sg-swatch.off{opacity:.55;cursor:default}
.sg-ldye .sg-swatch span{position:absolute;inset:auto 0 3px;font:800 14px/1 var(--sans);color:#3a2508;text-shadow:0 0 3px #fff6e6}

/* ───────── outfits ───────── */
.sg-orow{padding:8px 8px 8px 12px;border-radius:14px;background:rgba(255,246,230,.055);box-shadow:inset 0 0 0 1px rgba(255,226,160,.12)}
.sg-orow.cur{box-shadow:inset 0 0 0 2px var(--gold2);background:rgba(242,183,66,.1)}
.sg-orow.empty .sg-row-name{opacity:.6;font-style:italic}
.sg-orow-top{display:flex;align-items:center;gap:8px;min-height:48px;flex-wrap:wrap}
.sg-orow-top .sg-row-mid{flex:1 1 150px;cursor:default}
.sg-orow-acts{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto}
.sg-oedit{margin-top:6px}
.sg-oedit .sg-gs-btn{white-space:normal;line-height:1.2;min-width:0}
.sg-olabels{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.sg-olabels .sg-filter{flex:1 1 96px;min-width:0}

/* ───────── the loot toast's "New look unlocked" ───────── */
.sg-lt-new{display:inline-block;margin:2px 0 2px 14px;padding:1px 8px;border-radius:8px;font:800 14px/1.4 var(--sans);color:#10302c;text-shadow:none;background:linear-gradient(180deg,#bff3ec,#3FB0A6)}

/* ───────── the Tailor: costume pieces ───────── */
.sg-tcost{margin-top:8px;padding:8px 8px 8px 12px;border-radius:14px;background:rgba(255,246,230,.055);box-shadow:inset 0 0 0 1px rgba(255,226,160,.12)}
.sg-tcost.cur{box-shadow:inset 0 0 0 1.5px rgba(159,229,138,.5)}
.sg-tcost-top{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;--rc:#ffe2a0}
.sg-tcost-top .sg-badge{margin-left:8px;font-family:var(--sans)}
.sg-tpiece{display:flex;align-items:center;gap:8px;min-height:56px;border-top:1px solid rgba(255,226,160,.1)}
.sg-tpiece .sg-row-mid{cursor:default}
.sg-tpiece-n{font-size:15px;line-height:1.25}
.sg-tpiece-buy{display:flex;align-items:center;gap:8px}
`;

let done = false;
/** Adds the CSS once (no-op without a document: tests). */
export function ensureLookCss(): void {
  if (done || typeof document === 'undefined') return;
  done = true;
  const s = document.createElement('style');
  s.textContent = LOOK_CSS;
  document.head.appendChild(s);
}
