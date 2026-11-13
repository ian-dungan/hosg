// The CSS of the gear screens (the character sheet, the stalls, the loot toasts, the level-up moment and the menu
// button), injected with the HUD's. Phone first: every control at least 48 px, no text under 14 px, full-screen sheets
// on phones (portrait and landscape) that scroll inside themselves, a 420 px panel on desktop.
export const GEAR_CSS = /* css */ `
/* ───────── the menu button (online only) ───────── */
.sg-char-btn{position:absolute;top:calc(var(--st) + var(--g));right:calc(var(--sr) + var(--g) + 112px);display:none;width:48px;height:48px;padding:10px;border:0;border-radius:50%;
  color:var(--goldl);background:rgba(16,18,42,.5);box-shadow:inset 0 0 0 1px rgba(255,226,160,.35)}
.sg-has-gear .sg-char-btn{display:block}
.sg-char-btn:active{transform:scale(.92)}
.sg-char-btn i{position:absolute;right:-3px;top:-3px;display:none;min-width:22px;height:22px;padding:0 5px;border-radius:11px;font:800 14px/22px var(--sans);font-style:normal;
  color:#3a2508;text-shadow:none;background:var(--gold2);box-shadow:0 0 8px rgba(242,183,66,.8)}
.sg-char-btn.badged i{display:block}
.sg-char-btn.badged{box-shadow:inset 0 0 0 1.5px var(--gold2),0 0 12px rgba(242,183,66,.45)}
@media (max-width:700px) and (orientation:portrait){
  .sg-char-btn{top:calc(var(--st) + var(--g) + 300px);right:calc(var(--sr) + var(--g) + 2px)}
}

/* ───────── sheets: shared ───────── */
.sg-gs{z-index:30;display:flex;justify-content:flex-end;align-items:stretch;padding:calc(var(--st) + 12px) calc(var(--sr) + 12px) calc(var(--sb) + 12px) 12px;
  background:rgba(14,14,36,.42);touch-action:manipulation;pointer-events:auto}
.sg-gs-panel{position:relative;display:flex;flex-direction:column;width:420px;max-width:100%;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(26,30,64,.97),rgba(16,18,42,.98));box-shadow:0 0 0 1px rgba(255,214,140,.32),0 16px 50px rgba(0,0,0,.4);
  transform:translateX(24px);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.sg-gs.in .sg-gs-panel{transform:none}
.sg-gs-head{flex:none;display:flex;align-items:center;gap:10px;padding:10px 8px 6px 14px}
.sg-gs-id{flex:1;min-width:0;display:flex;align-items:center;gap:10px}
.sg-gs-glyph{flex:none;width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font:700 20px/1 var(--serif);font-variant-emoji:text;text-shadow:none;
  color:var(--jf,#fff6e6);background:var(--jb,#3b3f7a);box-shadow:inset 0 0 0 2px rgba(255,255,255,.35)}
.sg-gs-titles{min-width:0;flex:1}
.sg-gs-title{font:italic 600 21px/1.15 var(--serif);color:var(--goldl);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-gs-sub{font-size:14px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-gs-xp{margin-top:4px;height:6px;border-radius:3px;overflow:hidden;background:rgba(10,10,26,.7)}
.sg-gs-xp i{display:block;height:100%;transform-origin:0 50%;background:linear-gradient(90deg,#d99a24,#ffd36a)}
.sg-gs-purse{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;font:700 14px var(--sans);font-variant-numeric:tabular-nums}
.sg-gs-purse span{display:flex;align-items:center;gap:5px;white-space:nowrap}
.sg-coin,.sg-seal{display:inline-block;flex:none;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#fff1b0,#F2B742 55%,#b77a1c);box-shadow:0 0 0 1px rgba(80,50,10,.6)}
.sg-seal{border-radius:3px;transform:rotate(45deg) scale(.86);background:radial-gradient(circle at 35% 30%,#e9dcff,#9b7ad8 55%,#5d4675)}
.sg-gs-x{flex:none;width:48px;height:48px;padding:13px;border:0;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.1);cursor:pointer}
.sg-gs-tabs{flex:none;display:flex;gap:4px;padding:0 10px 8px;overflow-x:auto;scrollbar-width:none}
.sg-gs-tabs::-webkit-scrollbar{display:none}
.sg-gs-tab{position:relative;flex:1 1 auto;min-width:48px;min-height:48px;padding:0 7px;border:0;border-radius:14px;font:600 14px var(--sans);color:var(--cream);
  background:rgba(255,246,230,.07);box-shadow:inset 0 0 0 1px rgba(255,226,160,.16);cursor:pointer;white-space:nowrap}
.sg-gs-tab.on{color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742);box-shadow:none}
.sg-gs-tab b{position:absolute;right:4px;top:4px;width:9px;height:9px;border-radius:50%;background:#ff8a5c;box-shadow:0 0 6px #ff8a5c}
.sg-gs-note{flex:none;margin:0 12px 8px;padding:9px 12px;border-radius:12px;font-size:14px;font-weight:600;line-height:1.35;color:#ffe8c4;
  background:rgba(236,106,76,.2);box-shadow:inset 0 0 0 1px rgba(255,170,130,.45)}
.sg-gs-note.calm{color:#d8fff9;background:rgba(63,176,166,.18);box-shadow:inset 0 0 0 1px rgba(63,176,166,.5)}
.sg-gs-body{flex:1;min-height:0;overflow:auto;touch-action:pan-y;overscroll-behavior:contain;padding:2px 10px 16px}
.sg-vendor .sg-gs-title{font-size:19px;white-space:normal;line-height:1.1}
.sg-gs-h{margin:12px 2px 6px;font-size:14px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--gold2)}
.sg-gs-h small{font-size:14px;letter-spacing:0;text-transform:none;font-weight:600;color:var(--cream);opacity:.75;margin-left:6px}
.sg-gs-empty{padding:14px;border-radius:12px;font-size:14px;line-height:1.4;opacity:.85;background:rgba(255,246,230,.05)}
.sg-gs-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:48px;min-width:48px;padding:0 16px;border:0;border-radius:24px;cursor:pointer;
  font:600 15px var(--sans);color:var(--cream);background:rgba(255,246,230,.1);box-shadow:inset 0 0 0 1.5px rgba(255,226,160,.45);white-space:nowrap}
.sg-gs-btn.gold{color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742 60%,#dc9a2c);box-shadow:0 0 0 1px rgba(255,240,200,.6),0 3px 12px rgba(242,183,66,.35)}
.sg-gs-btn.warn{color:#fff;background:linear-gradient(180deg,#f58a62,#c84a32)}
.sg-gs-btn:disabled,.sg-gs-btn.off{opacity:.42;pointer-events:none}
.sg-gs-btn.wait{pointer-events:none;opacity:.7}
.sg-gs-btn.wait::after{content:"";width:14px;height:14px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:sg-spin .7s linear infinite}
@keyframes sg-spin{to{transform:rotate(360deg)}}
.sg-gs-why{font-size:14px;line-height:1.35;color:#ffcbb8}

/* ───────── item tiles ───────── */
.sg-tile{position:relative;flex:none;width:64px;height:64px;border-radius:14px;border:0;padding:0;cursor:pointer;
  background:rgba(10,12,32,.55) center/52px no-repeat;box-shadow:inset 0 0 0 2px var(--rc,rgba(255,226,160,.25)),inset 0 -14px 20px -10px var(--rg,transparent)}
.sg-tile.t3{box-shadow:inset 0 0 0 2px var(--rc),0 0 10px -2px var(--rc)}
.sg-tile.empty{cursor:default;background:rgba(255,246,230,.035);box-shadow:inset 0 0 0 1.5px rgba(255,226,160,.12)}
.sg-tile.sel{outline:3px solid #fff6e6;outline-offset:1px}
.sg-tile-jobs{position:absolute;left:3px;bottom:3px;display:flex;gap:1px}
.sg-tile-jobs span{width:16px;height:16px;border-radius:50%;display:grid;place-items:center;font:700 14px/1 var(--serif);font-variant-emoji:text;transform:scale(.8);
  color:var(--jf);background:var(--jb);text-shadow:none}
.sg-tile-new{position:absolute;right:4px;top:4px;width:9px;height:9px;border-radius:50%;background:#ffd36a;box-shadow:0 0 6px #ffd36a}
.sg-grid{display:grid;grid-template-columns:repeat(auto-fill,64px);gap:5px;justify-content:center}
.sg-grid.bag{max-width:calc(6 * 64px + 5 * 5px);margin:0 auto}

/* ───────── the Gear tab ───────── */
.sg-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:4px}
.sg-stat{padding:8px 6px 7px;border-radius:12px;text-align:center;background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(255,226,160,.14)}
.sg-stat b{display:block;font:700 22px/1.1 var(--serif);color:#fffaf0;font-variant-numeric:tabular-nums}
.sg-stat span{font-size:14px;opacity:.78}
.sg-stat.sp b{font-size:18px}
.sg-stat.zero{opacity:.5}
.sg-doll{display:grid;grid-template-columns:auto 1fr auto;gap:0 8px;margin-top:10px;align-items:start}
.sg-doll-col{display:flex;flex-direction:column;gap:6px}
.sg-slot{display:flex;flex-direction:column;align-items:center;gap:1px;width:70px}
.sg-slot>span{font-size:14px;line-height:16px;opacity:.82;white-space:nowrap}
.sg-doll-mid{position:relative;align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:260px;border-radius:16px;
  background:radial-gradient(ellipse at 50% 42%,rgba(91,84,160,.45),rgba(16,18,42,0) 70%)}
.sg-doll-fig{width:100%;max-width:150px;height:210px;color:var(--jb,#ffe2a0);opacity:.42;filter:drop-shadow(0 0 14px var(--jb,#ffe2a0))}
.sg-doll-lv{margin-top:4px;font:italic 600 16px var(--serif);color:var(--goldl);text-align:center}
.sg-set{margin-top:6px;padding:9px 11px;border-radius:12px;background:rgba(255,246,230,.05);box-shadow:inset 3px 0 0 var(--sc)}
.sg-set-name{font:600 16px var(--serif);color:var(--sc)}
.sg-set-name small{font:600 14px var(--sans);color:var(--cream);opacity:.8;margin-left:6px}
.sg-set-line{margin-top:4px;font-size:14px;line-height:1.35;opacity:.5}
.sg-set-line.on{opacity:1}
.sg-set-line b{display:inline-block;min-width:22px;font-weight:800;color:var(--sc)}
.sg-set-line.on::after{content:" \\2714";color:#9fe58a}
.sg-named{margin-top:6px;padding:9px 11px;border-radius:12px;font:italic 15px/1.4 var(--serif);color:#ffe7a6;background:rgba(242,183,66,.1);box-shadow:inset 3px 0 0 #ffc94a}
.sg-gs-hintln{font-size:14px;line-height:1.35;opacity:.7;margin:6px 2px 0}

/* ───────── the item card ───────── */
.sg-card-wrap{position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;justify-content:flex-end;background:rgba(10,10,28,.55);animation:sg-fadein .18s ease-out}
@keyframes sg-fadein{from{opacity:0}}
.sg-card{position:relative;max-height:86%;overflow:auto;touch-action:pan-y;overscroll-behavior:contain;padding:14px 14px calc(14px + var(--sb));border-radius:18px 18px 0 0;
  background:linear-gradient(180deg,#262b5c,#171a3e);box-shadow:0 -1px 0 rgba(255,226,160,.35),0 -12px 40px rgba(0,0,0,.45);animation:sg-up .22s cubic-bezier(.2,.8,.2,1)}
@keyframes sg-up{from{transform:translateY(30px)}}
.sg-card-top{display:flex;gap:12px;align-items:flex-start}
.sg-card-top .sg-tile{cursor:default}
.sg-card-ttl{flex:1;min-width:0}
.sg-card-name{font:600 19px/1.2 var(--serif);color:var(--rc)}
.sg-card-meta{font-size:14px;opacity:.8;margin-top:2px}
.sg-card-stats{margin-top:8px;font:600 15px var(--sans);color:#fffaf0}
.sg-cmp{margin-top:10px;padding:10px 11px;border-radius:12px;background:rgba(10,12,32,.45)}
.sg-cmp-sum{font:700 16px var(--sans)}
.sg-cmp-sum .up{color:#9fe58a}.sg-cmp-sum .down{color:#ff9a84}
.sg-cmp-was{font-size:14px;opacity:.75;margin-top:2px}
.sg-cmp-rows{display:grid;grid-template-columns:auto 1fr auto;gap:3px 10px;margin-top:8px;font-size:14px;font-variant-numeric:tabular-nums}
.sg-cmp-rows span:nth-child(3n+2){opacity:.85}
.sg-cmp-rows .up{color:#9fe58a;font-weight:700}.sg-cmp-rows .down{color:#ff9a84;font-weight:700}.sg-cmp-rows .same{opacity:.45}
.sg-cmp-set{margin-top:6px;font-size:14px;line-height:1.35}
.sg-cmp-set.gain{color:#b8f0a6}.sg-cmp-set.lose{color:#ffb4a2}
.sg-card-worn{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;font-size:14px}
.sg-chipj{display:inline-flex;align-items:center;gap:5px;padding:3px 9px 3px 4px;border-radius:14px;background:rgba(255,246,230,.08)}
.sg-chipj i{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:700 14px/1 var(--serif);font-style:normal;font-variant-emoji:text;color:var(--jf);background:var(--jb);text-shadow:none}
.sg-card-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.sg-card-acts .sg-gs-btn{flex:1 1 140px}
.sg-card-close{position:absolute;right:8px;top:8px;width:48px;height:48px;padding:13px;border-radius:50%;min-width:0;z-index:1}
.sg-card>.sg-card-top,.sg-card>.sg-gs-h:first-of-type{padding-right:48px}

/* ───────── lists (the stalls, the slot picker, the wardrobe) ───────── */
.sg-rows{display:flex;flex-direction:column;gap:6px}
.sg-row{display:flex;align-items:center;gap:10px;min-height:64px;padding:6px 8px;border-radius:14px;background:rgba(255,246,230,.055);box-shadow:inset 0 0 0 1px rgba(255,226,160,.12)}
.sg-row.cur{box-shadow:inset 0 0 0 2px var(--gold2);background:rgba(242,183,66,.1)}
.sg-row-mid{flex:1;min-width:0;cursor:pointer}
.sg-row-name{font:600 16px/1.2 var(--serif);color:var(--rc,var(--cream));overflow:hidden;text-overflow:ellipsis}
.sg-row-sub{font-size:14px;line-height:1.3;opacity:.8}
.sg-row-cmp{font-size:14px;font-weight:700;line-height:1.3}
.sg-row-cmp .up{color:#9fe58a}.sg-row-cmp .down{color:#ff9a84}
.sg-row-end{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:4px}
.sg-price{display:flex;align-items:center;gap:5px;font:700 15px var(--sans);font-variant-numeric:tabular-nums}
.sg-price.short{color:#ffb4a2}
.sg-owned{font-size:14px;font-weight:700;color:#9fe58a}
.sg-badge{display:inline-block;padding:1px 7px;border-radius:8px;font-size:14px;font-weight:700;background:rgba(255,246,230,.12)}
.sg-badge.star{color:#3a2508;background:linear-gradient(180deg,#ffe49a,#F2B742);text-shadow:none}
.sg-filters{display:flex;gap:6px;overflow-x:auto;padding:2px 0 8px;scrollbar-width:none}
.sg-filters::-webkit-scrollbar{display:none}
.sg-filter{flex:none;min-height:48px;min-width:64px;padding:0 14px;border:0;border-radius:24px;font:600 15px var(--sans);color:var(--cream);cursor:pointer;
  background:rgba(255,246,230,.07);box-shadow:inset 0 0 0 1px rgba(255,226,160,.2)}
.sg-filter.on{background:rgba(242,183,66,.22);box-shadow:inset 0 0 0 2px var(--gold2)}
.sg-greet{margin:0 2px 8px;font:italic 15px/1.4 var(--serif);opacity:.88}

/* ───────── talents ───────── */
.sg-tr{margin-top:10px}
.sg-tr-h{display:flex;align-items:baseline;gap:8px;margin:0 2px 6px;font-size:14px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--gold2)}
.sg-tr-h small{font-size:14px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--cream);opacity:.75}
.sg-tr.locked .sg-tc{opacity:.45;cursor:default}
.sg-tc{position:relative;display:block;width:100%;text-align:left;min-height:64px;margin-bottom:6px;padding:9px 12px;border:0;border-radius:14px;cursor:pointer;color:var(--cream);
  background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(255,226,160,.16);font:inherit}
.sg-tc.sel{box-shadow:inset 0 0 0 2px #fff6e6;background:rgba(255,246,230,.12)}
.sg-tc.chosen{box-shadow:inset 0 0 0 2px var(--gold2),0 0 14px rgba(242,183,66,.3);background:rgba(242,183,66,.16)}
.sg-tr.done .sg-tc:not(.chosen){opacity:.55}
.sg-tc-name{font:600 16px var(--serif);color:#fffaf0}
.sg-tc-desc{font-size:14px;line-height:1.35;opacity:.88;margin-top:2px}
.sg-tc-needs{font-size:14px;font-weight:700;color:#ffcf7a;margin-top:3px}
.sg-tc-tag{position:absolute;right:10px;top:9px;padding:1px 8px;border-radius:8px;font-size:14px;font-weight:800;color:#3a2508;text-shadow:none;background:var(--gold2)}
.sg-tc-go{display:flex;margin-top:8px;width:100%}
.sg-respec{display:flex;align-items:center;gap:10px;margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(255,246,230,.05)}
.sg-respec>div{flex:1;min-width:0;font-size:14px;line-height:1.35}

/* ───────── wardrobe and dyes ───────── */
.sg-wopt{flex:1 1 140px;min-height:48px}
.sg-wrow{display:flex;flex-wrap:wrap;gap:6px}
.sg-wopt.on{color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742);box-shadow:none}
.sg-switchrow{display:flex;align-items:center;gap:12px;min-height:56px;margin-top:12px;padding:6px 12px;border-radius:14px;background:rgba(255,246,230,.06);cursor:pointer;width:100%;border:0;color:var(--cream);font:inherit;text-align:left}
.sg-switchrow>span{flex:1;font:600 15px var(--sans)}
.sg-sw{flex:none;position:relative;width:52px;height:32px;border-radius:16px;background:rgba(255,246,230,.2);box-shadow:inset 0 0 0 1px rgba(255,226,160,.35)}
.sg-sw::after{content:"";position:absolute;left:4px;top:4px;width:24px;height:24px;border-radius:50%;background:#fffaf0;transition:transform .2s}
.sg-sw.on{background:linear-gradient(180deg,#ffe49a,#F2B742)}
.sg-sw.on::after{transform:translateX(20px)}
.sg-swatches{display:grid;grid-template-columns:repeat(auto-fill,48px);gap:6px;justify-content:center}
.sg-swatch{width:48px;height:48px;border:0;border-radius:12px;cursor:pointer;background:var(--dc);box-shadow:inset 0 0 0 1px rgba(0,0,0,.35)}
.sg-swatch.undyed{background:repeating-linear-gradient(45deg,#e8dcc4 0 6px,#bfae90 6px 12px)}
.sg-swatch.cur{box-shadow:inset 0 0 0 3px #fff6e6,0 0 0 2px rgba(20,16,40,.9)}
.sg-swatch.sel{outline:3px solid var(--gold2);outline-offset:2px}
.sg-chips2{display:flex;flex-wrap:wrap;gap:6px}
.sg-dchip{display:inline-flex;align-items:center;gap:6px;min-height:48px;padding:0 12px 0 8px;border:0;border-radius:14px;cursor:pointer;font:600 15px var(--sans);color:var(--rc,var(--cream));
  background:rgba(255,246,230,.07);box-shadow:inset 0 0 0 1px rgba(255,226,160,.18)}
.sg-dchip.on{background:rgba(242,183,66,.18);box-shadow:inset 0 0 0 2px var(--gold2)}
.sg-dchip .sg-dot{margin:0}
.sg-dyebar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px}
.sg-dyebar>div{flex:1 1 160px;font-size:14px}
.sg-dot{display:inline-block;width:16px;height:16px;border-radius:5px;vertical-align:-3px;margin:0 3px;background:var(--dc);box-shadow:inset 0 0 0 1px rgba(0,0,0,.4)}
.sg-dot.undyed{background:repeating-linear-gradient(45deg,#e8dcc4 0 3px,#bfae90 3px 6px)}

/* ───────── phones: full-screen sheets ───────── */
@media (max-width:700px),(max-height:500px){
  .sg-gs{padding:0;background:none}
  .sg-gs-panel{width:100%;border-radius:0;padding:var(--st) var(--sr) 0 var(--sl);transform:translateY(24px)}
  .sg-gs-body{padding-bottom:calc(16px + var(--sb))}
  .sg-card{padding-left:calc(14px + var(--sl));padding-right:calc(14px + var(--sr))}
}
/* landscape phones: the doll and the stats side by side; the card is a side sheet */
@media (max-height:500px) and (min-width:560px){
  .sg-gear-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:0 14px;align-items:start}
  .sg-gs-head{padding-top:6px;padding-bottom:4px}
  .sg-gs-tabs{padding-bottom:6px}
  .sg-card-wrap{flex-direction:row;justify-content:flex-end}
  .sg-card{width:min(440px,70%);max-height:100%;border-radius:18px 0 0 18px}
}

/* ───────── loot toasts ───────── */
.sg-loot{position:absolute;right:calc(var(--sr) + var(--g));bottom:calc(var(--sb) + 150px);display:flex;flex-direction:column;align-items:flex-end;gap:6px;width:min(300px,60vw)}
.sg-lt{max-width:100%;padding:7px 12px 8px;border-radius:12px;background:rgba(18,20,46,.82);box-shadow:inset 3px 0 0 var(--rc,#fff6e6),0 4px 14px rgba(10,10,40,.3)}
.sg-lt-i{font:600 15px/1.3 var(--serif);color:var(--rc)}
.sg-lt-g{display:flex;align-items:center;gap:6px;font:700 14px var(--sans);color:#ffe2a0}
.sg-lt-s{font-size:14px;color:#ffcbb8}
.sg-lt.named{box-shadow:inset 3px 0 0 #ffc94a,0 0 0 1px rgba(255,201,74,.6),0 0 24px rgba(255,201,74,.55)}
@media (max-width:700px) and (orientation:portrait){
  /* clear of the fight in the middle: low on the left, above the joystick's zone */
  .sg-loot{right:auto;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + 34vh);align-items:flex-start;width:min(210px,56vw)}
}
@media (max-height:500px){
  .sg-loot{right:auto;left:calc(var(--sl) + var(--g));bottom:auto;top:calc(var(--st) + var(--g) + var(--tlh,62px) + 8px);align-items:flex-start;width:min(240px,32vw)}
}

/* ───────── the level-up moment ───────── */
.sg-lvl{position:absolute;left:50%;top:calc(var(--st) + 15vh);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;text-align:center;
  width:min(420px,calc(100% - 2 * var(--g)));padding:14px 18px 14px;border-radius:20px;opacity:0;
  background:radial-gradient(ellipse at 50% 0%,rgba(242,183,66,.35),rgba(18,20,46,.86) 70%);box-shadow:0 0 0 1px rgba(255,226,160,.55),0 8px 40px rgba(242,183,66,.35)}
.sg-lvl-k{font-size:14px;font-weight:800;letter-spacing:.32em;text-transform:uppercase;color:var(--goldl);padding-left:.32em}
.sg-lvl-t{font:italic 700 44px/1.05 var(--serif);color:#fff6d8;text-shadow:0 0 22px rgba(242,183,66,.9),0 2px 0 rgba(90,40,10,.6)}
.sg-lvl-g{margin-top:4px;font:600 15px var(--sans);color:#d8f6c8}
.sg-lvl-row{margin-top:10px;display:flex;flex-direction:column;align-items:center;gap:4px}
.sg-lvl-row .sg-gs-btn{pointer-events:auto;min-width:220px}
.sg-lvl-w{font-size:14px;color:#ffe2a0}
.sg-lvl-rays{position:absolute;inset:-30px;z-index:-1;pointer-events:none;border-radius:50%;
  background:repeating-conic-gradient(from 0deg,rgba(255,214,110,.22) 0 8deg,transparent 8deg 22deg);-webkit-mask:radial-gradient(circle,#000 20%,transparent 70%);mask:radial-gradient(circle,#000 20%,transparent 70%);
  animation:sg-rays 6s linear infinite}
@keyframes sg-rays{to{transform:rotate(360deg)}}
/* portrait: in the space left of the right-hand column of buttons */
@media (max-width:700px) and (orientation:portrait){ .sg-lvl{top:calc(var(--st) + var(--g) + var(--tlh,62px) + 12px);left:calc(50% - 32px);width:calc(100% - 2 * var(--g) - 64px);padding:12px 10px} .sg-lvl-t{font-size:38px} .sg-lvl-row .sg-gs-btn{min-width:0;width:100%} }
@media (max-height:500px){ .sg-lvl{top:calc(var(--st) + 8px);padding:8px 14px 10px} .sg-lvl-t{font-size:30px} }
`;
