// All HUD CSS, injected once as a <style> so the build stays a single file.
import { JOBS_CSS } from './jobs';
import { PARTY_CSS } from './party';
import { BOSS_CSS } from './boss';
import { EDGE_CSS } from '../combat/edgeMarkers';
import { GEAR_CSS } from './gearStyle';
import { TRACKER_CSS } from './quest';
import { JOURNAL_CSS } from './journal';
import { POINTER_CSS } from './questPointer';
import { MOMENT_CSS } from './questMoment';
import { DIALOGUE_SHEET_CSS } from './dialogueSheet';

const CSS = /* css */ `
.sg-hud{
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,"DejaVu Serif",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue","DejaVu Sans",Arial,sans-serif;
  --gold:#F2B742; --gold2:#ffcf5a; --goldl:#ffe2a0; --cream:#fff6e6;
  --ink:rgba(18,22,48,.55); --ink2:rgba(16,18,42,.82);
  --coral:#EC6A4C; --teal:#3FB0A6; --meadow:#8FD16A; --rock:#5D4675;
  --st:env(safe-area-inset-top,0px); --sr:env(safe-area-inset-right,0px);
  --sb:env(safe-area-inset-bottom,0px); --sl:env(safe-area-inset-left,0px);
  --g:18px; --k:1;
  position:absolute; inset:0; overflow:hidden; pointer-events:none;
  font-family:var(--sans); color:var(--cream); font-size:14px; line-height:1.3;
  -webkit-user-select:none; user-select:none; -webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent; -webkit-font-smoothing:antialiased;
  text-shadow:0 1px 3px rgba(20,16,44,.55);
}
.sg-hud *{box-sizing:border-box}
.sg-hud svg{width:100%;height:100%;display:block}
.sg-ctl{pointer-events:auto;touch-action:none;cursor:pointer}
.sg-combat,.sg-fx,.sg-modals{position:absolute;inset:0;pointer-events:none}
.sg-combat{transition:opacity .35s ease, visibility .35s}
.sg-hidden .sg-combat,.sg-modal-open .sg-combat{opacity:0;visibility:hidden}
.sg-modal-open .sg-banner{opacity:0!important}

/* ───────── bars ───────── */
.sg-bar{position:relative;height:12px;border-radius:7px;overflow:hidden;
  background:rgba(14,14,34,.55);box-shadow:inset 0 0 0 1px rgba(255,236,200,.22),0 1px 4px rgba(10,10,30,.25)}
.sg-bar-fill,.sg-bar-trail{position:absolute;inset:0;transform-origin:0 50%;border-radius:inherit}
.sg-bar-fill{transition:transform .14s ease-out;
  background:linear-gradient(180deg,rgba(255,255,255,.35),rgba(255,255,255,0) 55%),var(--bar,#8FD16A)}
.sg-bar-trail{transition:transform .6s ease-in .35s;background:rgba(255,236,190,.85)}
.sg-bar-text{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;letter-spacing:.04em;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7);font-variant-numeric:tabular-nums}
.sg-hp-player{--bar:linear-gradient(90deg,#5fb84a,#8FD16A)}
.sg-hp-party{--bar:linear-gradient(90deg,#2f9c93,#5fd0c4);height:7px}
.sg-hp-enemy{--bar:linear-gradient(90deg,#c84a32,#EC6A4C)}
.sg-hp-boss{--bar:linear-gradient(90deg,#a8344a,#EC6A4C 70%,#f58a62);height:16px}

/* ───────── status chips ───────── */
.sg-chips{display:flex;flex-wrap:wrap;gap:4px;min-height:0}
.sg-chips:empty{display:none}
.sg-chip{display:inline-flex;align-items:center;gap:4px;height:19px;padding:0 6px;border-radius:10px;
  background:rgba(16,18,42,.6);box-shadow:inset 0 0 0 1px var(--c);font-size:11px;font-weight:600}
.sg-chip b{color:var(--c);font-size:12px}

/* ───────── player frame (top-left) ───────── */
.sg-tl{position:absolute;top:calc(var(--st) + var(--g));left:calc(var(--sl) + var(--g));width:300px;display:flex;flex-direction:column;gap:10px}
.sg-pf{display:flex;align-items:center;gap:10px;padding:8px 14px 9px 8px;border-radius:40px 16px 16px 40px;
  background:linear-gradient(90deg,rgba(18,22,48,.62),rgba(18,22,48,.32));}
.sg-pf-emblem{flex:none;width:46px;height:46px;border-radius:50%;display:grid;place-items:center;
  background:radial-gradient(circle at 35% 30%,#3b3f7a,#1c1f45);box-shadow:inset 0 0 0 2px var(--gold),0 0 0 3px rgba(242,183,66,.25),0 2px 8px rgba(0,0,0,.3)}
.sg-pf-emblem span{font:700 19px/1 var(--serif);color:var(--goldl)}
.sg-pf-emblem{position:relative}
.sg-pf-job{display:none}
.sg-pf.has-job .sg-pf-emblem{background:var(--jb);box-shadow:inset 0 0 0 2px rgba(255,255,255,.4),0 0 0 3px rgba(242,183,66,.35),0 2px 8px rgba(0,0,0,.3)}
.sg-pf.has-job .sg-pf-job{display:block;font:700 22px/1 var(--serif);font-variant-emoji:text;color:var(--jf);text-shadow:none}
.sg-pf.has-job .sg-pf-emblem span{position:absolute;right:-5px;bottom:-4px;min-width:19px;height:19px;padding:0 4px;border-radius:10px;display:grid;place-items:center;
  font:800 11px/1 var(--sans);color:#3a2508;text-shadow:none;background:var(--gold2);box-shadow:0 1px 3px rgba(0,0,0,.4)}
/* the focused ally: under the player frame */
.sg-af{display:none;flex-direction:column;gap:4px;width:min(240px,100%);margin-left:14px;padding:6px 8px 7px 10px;border-radius:12px;
  background:linear-gradient(90deg,rgba(20,52,30,.62),rgba(18,22,48,.3));box-shadow:inset 0 0 0 1.5px rgba(143,209,106,.7)}
.sg-af.on{display:flex}
.sg-af.far{box-shadow:inset 0 0 0 1px rgba(143,209,106,.3);opacity:.75}
.sg-af.dead{box-shadow:inset 0 0 0 1.5px rgba(236,106,76,.8)}
.sg-af-head{display:flex;align-items:center;gap:6px}
.sg-af-glyph{flex:none;font:700 15px/1 var(--serif);font-variant-emoji:text;color:#cfeec0}
.sg-af-name{flex:1;min-width:0;font:600 14px var(--serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-af-tag{flex:none;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#cfeec0;opacity:.85}
.sg-af.dead .sg-af-tag{color:#ffb8a8}
.sg-af-close{position:relative;flex:none;width:24px;height:24px;padding:4px;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.12)}
.sg-af-close::before{content:"";position:absolute;inset:-12px}
.sg-hp-ally{height:7px;--bar:linear-gradient(90deg,#5fb84a,#8FD16A)}
.sg-cast-ally .sg-cast-name{font-size:10px}
.sg-af-act{display:none;align-items:center;justify-content:center;min-height:48px;margin-top:2px;padding:0 14px;border-radius:24px;font:600 14px var(--sans);
  color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742 60%,#dc9a2c);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-pf-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:5px}
.sg-pf-top{display:flex;align-items:center;gap:8px}
.sg-pf-name{flex:1;min-width:0;font:600 17px/1.1 var(--serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-pf-weapon{width:18px;height:18px;color:var(--goldl);opacity:.9}
.sg-pf.low .sg-hp-player{animation:sg-low 1s ease-in-out infinite}
@keyframes sg-low{50%{box-shadow:inset 0 0 0 1px rgba(255,120,100,.9),0 0 12px rgba(236,106,76,.8)}}
/* the focus frame's Invite (a stranger) */
.sg-af-invite{display:none;align-items:center;justify-content:center;min-height:48px;margin-top:2px;padding:0 14px;border-radius:24px;font:600 14px var(--sans);
  color:#0f2a28;text-shadow:none;background:linear-gradient(180deg,#bff3ec,#3FB0A6);box-shadow:0 0 0 1px rgba(200,255,250,.6)}
.sg-af-invite.on{display:flex}

/* ───────── target frame ───────── */
.sg-tf{position:fixed;top:calc(var(--st) + var(--g));left:calc(var(--sl) + var(--g) + 320px);width:260px;
  padding:8px 12px 10px;border-radius:14px;background:linear-gradient(90deg,rgba(48,18,30,.55),rgba(18,22,48,.35));
  display:none;flex-direction:column;gap:5px}
.sg-tf.on{display:flex}
.sg-tf-head{display:flex;align-items:center;gap:6px}
.sg-tf-name{flex:1;font:600 16px var(--serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sg-tf-close{position:relative;width:24px;height:24px;padding:4px;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.12)}
.sg-tf-close::before{content:"";position:absolute;inset:-16px}

/* ───────── boss bar ───────── */
.sg-boss{position:absolute;top:calc(var(--st) + var(--g));left:50%;transform:translateX(-50%);width:min(560px,44vw);
  display:none;flex-direction:column;gap:5px;align-items:stretch}
.sg-boss.on{display:flex}
.sg-boss-name{text-align:center;font:italic 600 21px var(--serif);color:#fff2dc;text-shadow:0 2px 8px rgba(30,10,30,.6)}
.sg-stag-wrap{position:relative;display:flex;align-items:center;gap:8px;margin:0 8%}
.sg-stag-label{font-size:9px;font-weight:800;letter-spacing:.18em;color:var(--goldl)}
.sg-stag{flex:1;height:7px;--bar:repeating-linear-gradient(-45deg,#F2B742 0 6px,#ffd877 6px 12px)}
.sg-boss.staggered .sg-stag{animation:sg-pulse .5s ease-in-out infinite alternate}
@keyframes sg-pulse{to{filter:brightness(1.7)}}
.sg-break{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);opacity:0;
  font:italic 800 26px var(--serif);color:#fff3c4;text-shadow:0 0 12px #F2B742,0 2px 4px rgba(60,20,0,.8)}
.sg-boss .sg-chips{justify-content:center}

/* ───────── cast bars ───────── */
.sg-cast{display:none;flex-direction:column;gap:3px}
.sg-cast.on{display:flex}
.sg-cast-name{font-size:11px;font-weight:600;letter-spacing:.04em}
.sg-cast .sg-bar{height:7px}
.sg-cast .sg-bar-fill{transition:none}
.sg-cast .sg-bar-trail{display:none}
.sg-cast-bar{--bar:linear-gradient(90deg,#d9c8ff,#9b86d6)}
.sg-cast.intr .sg-cast-bar{--bar:linear-gradient(90deg,#ffe08a,#F2B742)}
.sg-cast.intr .sg-cast-name::after{content:"  \\00B7  INTERRUPT";color:var(--gold2);animation:sg-blink .6s steps(2) infinite}
.sg-cast:not(.intr) .sg-cast-name::before{content:"\\25C6  ";color:#b9a6f2}
@keyframes sg-blink{50%{opacity:.35}}
.sg-cast-boss{align-items:center}.sg-cast-boss .sg-bar{width:60%}
.sg-castslot{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(var(--sb) + 130px);width:260px}
.sg-cast-player{align-items:center}.sg-cast-player .sg-bar{width:100%;height:9px}
.sg-cast-player .sg-cast-bar{--bar:linear-gradient(90deg,#ffe08a,#F2B742)}
.sg-cast.sg-cast-player .sg-cast-name::before,.sg-cast.sg-cast-player .sg-cast-name::after{content:none}

/* ───────── quest tracker (top-right) ───────── */
.sg-quest{position:absolute;top:calc(var(--st) + var(--g) + 4px);right:calc(var(--sr));width:330px;
  padding:12px calc(var(--g) + 6px) 14px 26px;display:none;cursor:pointer;
  background:linear-gradient(90deg,rgba(18,22,48,0),rgba(18,22,48,.36) 22%,rgba(18,22,48,.46));
  -webkit-mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);
  mask-image:linear-gradient(180deg,transparent,#000 14px,#000 calc(100% - 14px),transparent);
  transition:opacity .4s}
.sg-quest.on{display:block}
.sg-quest::before{content:"";position:absolute;left:12px;top:14px;bottom:14px;width:2px;border-radius:1px;background:rgba(255,207,90,.9)}
.sg-quest-head{display:flex;align-items:center;gap:6px}
.sg-quest-kicker{font-size:11px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--gold2)}
.sg-quest-chev{width:14px;height:14px;color:var(--goldl);opacity:.8;transition:transform .25s;display:none}
.sg-quest-title{margin-top:4px;font:600 19px/1.2 var(--serif);color:var(--cream)}
.sg-quest-steps{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:5px}
.sg-quest-steps li{display:flex;gap:9px;align-items:baseline;font-size:14px;color:rgba(255,250,240,.93);border-radius:6px;margin:0 -6px;padding:1px 6px}
.sg-quest-steps li i{flex:none;width:9px;height:9px;transform:rotate(45deg) translateY(-1px);border:1.5px solid rgba(255,246,230,.9);border-radius:1px}
.sg-quest-steps li.cur i{border-color:var(--gold2);box-shadow:0 0 6px rgba(255,207,90,.8)}
.sg-quest-steps li.done{color:rgba(255,250,240,.55);text-decoration:line-through;text-decoration-color:rgba(255,226,160,.6)}
.sg-quest-steps li.done i{background:var(--gold2);border-color:var(--gold2)}
.sg-in-combat .sg-quest{opacity:.55}

/* ───────── prompt ───────── */
.sg-promptrow{position:absolute;left:0;right:0;top:61%;display:flex;justify-content:center;padding:0 var(--g)}
.sg-prompt{display:none;align-items:center;gap:10px;height:38px;padding:0 18px 0 6px;border-radius:19px;
  background:rgba(20,25,50,.6);box-shadow:0 0 0 1px rgba(255,226,160,.25),0 4px 16px rgba(10,10,40,.25);max-width:100%}
.sg-prompt.on{display:flex}
.sg-prompt-key{flex:none;width:26px;height:26px;border-radius:7px;background:var(--cream);color:#2a2a44;display:grid;place-items:center;
  font:800 14px var(--sans);text-shadow:none;box-shadow:0 2px 0 rgba(0,0,0,.25)}
.sg-prompt-key svg{display:none;width:26px;height:26px}
.sg-prompt-text{font-size:15px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ───────── ability bar: desktop row ───────── */
.sg-abar{position:absolute;left:50%;bottom:calc(var(--sb) + var(--g));transform:translateX(-50%);display:flex;align-items:flex-end;gap:8px;
  padding:8px 12px;border-radius:20px;background:linear-gradient(180deg,rgba(18,22,48,.25),rgba(18,22,48,.5))}
.sg-desktop .sg-abar.off{display:none}
.sg-abar.off>.sg-ab:not(.sg-ab-jump){display:none}
.sg-abar:not(.has-dodge)>.sg-ab-dodge{display:none}
.sg-desktop .sg-ab-jump{display:none}
.sg-ab{position:relative;width:68px;height:68px;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
  background:radial-gradient(circle at 50% 30%,rgba(70,76,140,.85),rgba(24,26,58,.9));
  box-shadow:inset 0 0 0 2px var(--kc,rgba(255,226,160,.6)),0 3px 10px rgba(10,10,40,.3);transition:filter .2s,scale .08s;overflow:hidden}
.sg-ab.off{display:none}
.sg-ab.down{scale:.92}
.sg-ab-glyph{font:700 24px/1 var(--serif);color:var(--cream)}
.sg-ab-name{font-size:9.5px;font-weight:600;max-width:62px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}
/* ability names wrap onto two short lines rather than truncating ("Lantern Flare", "Second Dawn") */
.sg-ab-skill .sg-ab-name{white-space:normal;text-align:center;line-height:1.05;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;hyphens:auto}
.sg-ab-icon{width:24px;height:24px;color:var(--goldl)}
.sg-ab-cd{position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:conic-gradient(rgba(8,10,26,.72) calc(var(--cd,0) * 360deg),transparent 0)}
.sg-ab-sec{position:absolute;inset:0;display:grid;place-items:center;font:800 22px var(--sans);color:#fff;text-shadow:0 1px 4px #000;font-variant-numeric:tabular-nums}
.sg-ab.unusable{filter:grayscale(.85) brightness(.7)}
.sg-ab.cooling .sg-ab-name{visibility:hidden} /* the cooldown number shows instead: never over the label */
.sg-ab.cooling .sg-ab-glyph{opacity:.35}
.sg-key{position:absolute;top:3px;left:5px;font-size:10px;font-weight:800;color:var(--goldl);opacity:.85}
.sg-ab-jobs,.sg-ab-loadout{width:56px;height:56px;border-radius:14px;--kc:rgba(255,226,160,.55)}
.sg-ab-jobglyph{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;font:700 16px/1 var(--serif);font-variant-emoji:text;text-shadow:none;
  color:var(--jf,#fff6e6);background:var(--jb,#3b3f7a);box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.4)}
.sg-ab-skill .sg-ab-glyph{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;font-variant-emoji:text;font-size:21px;text-shadow:none;
  color:var(--jf,#fff6e6);background:var(--jb,rgba(255,255,255,.08));box-shadow:inset 0 0 0 2px var(--kc,rgba(255,226,160,.6)),0 1px 4px rgba(0,0,0,.35)}
.sg-ab.casting{filter:none;box-shadow:inset 0 0 0 3px #ffe08a,0 0 16px rgba(255,214,110,.75)}
.sg-tip{position:absolute;transform:translateY(-100%);padding:10px 12px;border-radius:12px;background:var(--ink2);
  box-shadow:0 0 0 1px rgba(255,226,160,.3),0 6px 20px rgba(0,0,0,.3);opacity:0;transition:opacity .15s;z-index:5}
.sg-tip.on{opacity:1}
.sg-tip-name{font:600 16px var(--serif);color:var(--goldl)}
.sg-tip-meta{font-size:11px;opacity:.7;margin:2px 0 5px}
.sg-tip-desc{font-size:13px;line-height:1.4}

/* ───────── joystick (touch only) ───────── */
.sg-joyzone{display:none;position:absolute;left:0;bottom:0;width:min(46vw,420px);height:min(52vh,420px)}
.sg-joy{position:absolute;left:calc(var(--sl) + 92px);top:auto;bottom:calc(var(--sb) + 30px);width:124px;height:124px;border-radius:50%;
  transform:translate(-50%,-50%);translate:0 50%;opacity:.5;transition:opacity .25s;
  background:radial-gradient(circle,rgba(18,22,48,.12) 40%,rgba(18,22,48,.38) 72%);box-shadow:inset 0 0 0 2px rgba(255,236,200,.45)}
.sg-joyzone.active .sg-joy{opacity:1;translate:none;transition:none}
.sg-joy-arrows{position:absolute;inset:7px;border-radius:50%}
.sg-joy-arrows::before,.sg-joy-arrows::after{content:"";position:absolute;left:50%;top:50%;width:100%;height:100%;transform:translate(-50%,-50%);
  background:
    radial-gradient(circle at 50% 3px,rgba(255,236,200,.8) 2.5px,transparent 3px),
    radial-gradient(circle at 50% calc(100% - 3px),rgba(255,236,200,.8) 2.5px,transparent 3px),
    radial-gradient(circle at 3px 50%,rgba(255,236,200,.8) 2.5px,transparent 3px),
    radial-gradient(circle at calc(100% - 3px) 50%,rgba(255,236,200,.8) 2.5px,transparent 3px)}
.sg-joy-arrows::after{display:none}
.sg-joy-knob{position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle at 40% 35%,#fffaf0,#ecd9b8 60%,#c9a86e);box-shadow:0 3px 10px rgba(20,16,44,.4),inset 0 -3px 0 rgba(120,80,30,.25)}

/* ───────── touch layout ───────── */
.sg-touch .sg-joyzone{display:block}
.sg-touch .sg-key{display:none}
.sg-touch .sg-abar{left:auto;transform:none;right:calc(var(--sr) + var(--g) + 38px);bottom:calc(var(--sb) + var(--g) + 38px);
  width:0;height:0;padding:0;background:none;display:block}
.sg-touch .sg-ab{position:absolute;left:0;top:0;width:64px;height:64px;border-radius:50%;
  transform:translate(-50%,-50%) translate(calc(var(--ax,0) * var(--k) * 1px),calc(var(--ay,0) * var(--k) * 1px))}
.sg-touch .sg-ab-skill .sg-ab-name{font-size:8.5px;max-width:52px}
.sg-touch .sg-ab-jobs{width:60px;height:60px}
.sg-touch .sg-ab-skill .sg-ab-glyph{width:32px;height:32px;font-size:18px}
.sg-touch .sg-ab-loadout{width:56px;height:56px}
.sg-touch .sg-ab-jump{width:72px;height:72px;--kc:rgba(255,240,200,.85);background:radial-gradient(circle at 40% 30%,#ffe9a8,#F2B742 70%,#d99a24)}
.sg-touch .sg-ab-jump .sg-ab-name{font:700 15px var(--sans);color:#3a2a08;text-shadow:none;max-width:none}
.sg-touch .sg-ab-dodge .sg-ab-name{font-size:9px}
.sg-touch .sg-ab-loadout .sg-ab-name{font-size:9px}
.sg-touch .sg-ab-loadout .sg-ab-icon{width:20px;height:20px}
.sg-touch .sg-castslot{top:62%;bottom:auto}
.sg-touch .sg-promptrow{top:auto;bottom:calc(var(--sb) + 40px)}
.sg-touch .sg-prompt{height:58px;padding:0 24px 0 7px;border-radius:29px;gap:12px;
  background:linear-gradient(180deg,rgba(28,32,66,.78),rgba(18,20,46,.85));box-shadow:0 0 0 1.5px rgba(255,214,120,.65),0 6px 22px rgba(10,10,40,.35)}
.sg-touch .sg-prompt-key{width:44px;height:44px;border-radius:50%;padding:10px;color:#3a2a10;
  background:radial-gradient(circle at 40% 30%,#ffe9a8,#F2B742 70%,#d99a24);box-shadow:0 0 14px rgba(242,183,66,.6)}
.sg-touch .sg-prompt-key b{display:none}
.sg-touch .sg-prompt-key svg{display:block;width:24px;height:24px}
.sg-touch .sg-prompt-text{font-size:17px;font-weight:600}
.sg-touch .sg-prompt.on{animation:sg-breathe 2.2s ease-in-out infinite}
@keyframes sg-breathe{50%{box-shadow:0 0 0 1.5px rgba(255,214,120,.95),0 0 26px rgba(242,183,66,.45)}}

/* ───────── combat: Momentum, dodge, cast notch, danger edge ───────── */
.sg-mom{display:none;height:6px;--bar:linear-gradient(90deg,#d99a24,#ffd36a)}
.sg-pf.has-mom .sg-mom{display:block}
.sg-mom .sg-bar-trail{display:none}
.sg-mom-mark{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(255,250,235,.85);z-index:1}
.sg-mom.ready{box-shadow:inset 0 0 0 1px rgba(255,220,120,.9),0 0 8px rgba(242,183,66,.7);animation:sg-mom 1.4s ease-in-out infinite}
.sg-mom.full{animation-duration:.7s}
@keyframes sg-mom{50%{box-shadow:inset 0 0 0 1px rgba(255,240,180,1),0 0 14px rgba(255,200,80,.95)}}
.sg-pf.dead{filter:grayscale(.9) brightness(.8)}
.sg-cast-mark{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;background:#fff;box-shadow:0 0 5px #fff;z-index:2}
.sg-cast.past-mark .sg-cast-bar{--bar:linear-gradient(90deg,#ffd36a,#ff8a4c)}
.sg-cast.past-mark .sg-cast-name{color:#ffd36a}
.sg-ab.locked{filter:grayscale(1) brightness(.6)}
.sg-ab-dodge{--kc:rgba(127,240,255,.7)}
.sg-ab-ring{position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:conic-gradient(rgba(127,240,255,.95) calc(var(--rf,1) * 360deg),rgba(127,240,255,.12) 0);
  -webkit-mask:radial-gradient(circle,transparent 62%,#000 64%);mask:radial-gradient(circle,transparent 62%,#000 64%)}
.sg-desktop .sg-ab-ring{-webkit-mask:linear-gradient(#000,#000) bottom/100% 4px no-repeat;mask:linear-gradient(#000,#000) bottom/100% 4px no-repeat}
.sg-ab-pips{position:absolute;bottom:7px;display:flex;gap:5px}
.sg-ab-pips i{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.22);box-shadow:inset 0 0 0 1px rgba(127,240,255,.6)}
.sg-ab-pips i.on{background:#7ff0ff;box-shadow:0 0 6px rgba(127,240,255,.9)}
.sg-ab-dodge .sg-ab-glyph{margin-top:-8px}
.sg-danger{position:absolute;inset:0;opacity:0;pointer-events:none;
  background:radial-gradient(ellipse at center,transparent 64%,rgba(232,36,28,.3) 84%,rgba(232,36,28,.66));box-shadow:inset 0 0 0 5px rgba(255,60,40,.95),inset 0 0 48px rgba(255,30,20,.7)}
.sg-danger.on{animation:sg-danger .45s ease-in-out infinite alternate}
@keyframes sg-danger{from{opacity:.55}to{opacity:1}}
.sg-boss.immune .sg-stag{filter:grayscale(1);opacity:.55}
.sg-boss.immune .sg-stag-label::after{content:" \\00B7 IMMUNE";color:#c8c6d8}
.sg-tf.surge .sg-tf-name::after,.sg-boss.surge .sg-boss-name::after{content:"  \\00BB\\00BB";color:#7ff0ff;text-shadow:0 0 6px rgba(80,220,255,.9)}
.sg-end-btn.waiting{opacity:.4;pointer-events:none}
.sg-end-count{margin-top:12px;font:500 15px var(--sans);opacity:.85;font-variant-numeric:tabular-nums}

/* ───────── fx: floats, banner, toasts ───────── */
.sg-floats{position:absolute;inset:0}
.sg-ft{position:absolute;left:0;top:0;opacity:0;white-space:nowrap;will-change:transform,opacity;
  font:800 20px var(--sans);color:#fff;text-shadow:0 2px 0 rgba(40,20,40,.6),0 0 6px rgba(0,0,0,.35)}
.sg-ft.crit{font-size:30px;color:#ffd66e;font-style:italic;text-shadow:0 2px 0 #7a3a10,0 0 12px rgba(255,170,60,.8)}
.sg-ft.heal{color:#a8f08a;text-shadow:0 2px 0 rgba(20,60,20,.7)}
.sg-ft.hurt{color:#ff7a62;text-shadow:0 2px 0 rgba(70,10,10,.7)}
.sg-ft.info{font:600 italic 17px var(--serif);color:var(--cream)}
.sg-ft.other{font:700 14px var(--sans);color:#e8e2f4;opacity:.8;text-shadow:0 1px 0 rgba(30,20,50,.7)}
.sg-ft.damage{color:#fff3d6}
.sg-ft.combo{font:italic 800 34px var(--serif);color:#fff3c4;letter-spacing:.02em;
  text-shadow:0 0 16px rgba(242,183,66,.95),0 0 4px #F2B742,0 3px 0 rgba(90,40,10,.8)}
.sg-vignette{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse at center,transparent 55%,rgba(242,183,66,.45))}
.sg-banner{position:absolute;left:0;right:0;top:calc(var(--st) + 13vh);text-align:center;opacity:0;padding:0 var(--g)}
.sg-has-boss .sg-banner{top:calc(var(--st) + 20vh)}
.sg-banner-kicker{font-size:15px;font-weight:600;letter-spacing:.42em;text-transform:uppercase;color:var(--goldl);margin-bottom:6px;padding-left:.42em;
  text-shadow:0 1px 10px rgba(30,20,60,.5)}
.sg-banner-title{font:italic 600 50px/1.1 var(--serif);color:#fffaf0;text-shadow:0 2px 16px rgba(30,20,60,.5),0 1px 2px rgba(30,20,60,.4)}
.sg-banner-rule{position:relative;margin:14px auto 0;width:min(480px,80%);height:1.5px;
  background:linear-gradient(90deg,rgba(255,226,160,0),rgba(255,226,160,.9),rgba(255,226,160,0))}
.sg-banner-rule i{position:absolute;left:50%;top:50%;width:9px;height:9px;background:var(--goldl);transform:translate(-50%,-50%) rotate(45deg)}
.sg-toasts{position:absolute;left:0;right:0;top:calc(var(--st) + 31%);display:flex;flex-direction:column;align-items:center;gap:6px;padding:0 var(--g)}
.sg-toast{padding:8px 18px;border-radius:18px;background:rgba(20,25,50,.74);font-size:15px;font-weight:500;
  box-shadow:0 0 0 1px rgba(255,226,160,.4),0 4px 14px rgba(10,10,40,.2);text-align:center;max-width:100%}

/* ───────── modal shared ───────── */
.sg-modals>*{position:absolute;inset:0;opacity:0;transition:opacity .35s ease}
.sg-modals>.in{opacity:1}
.sg-modals>.out{opacity:0}
.sg-fade{opacity:0;pointer-events:none;transition:none;z-index:50}
.sg-btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;min-width:120px;padding:0 24px;border-radius:24px;
  font:600 16px var(--sans);color:var(--cream);background:rgba(255,246,230,.1);box-shadow:inset 0 0 0 1.5px rgba(255,226,160,.45);
  cursor:pointer;transition:transform .12s,filter .15s,background .15s;touch-action:manipulation}
.sg-btn:hover{background:rgba(255,246,230,.18)}
.sg-btn:active{transform:scale(.96)}
.sg-btn-gold{color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742 60%,#dc9a2c);
  box-shadow:0 0 0 1px rgba(255,240,200,.6),0 4px 18px rgba(242,183,66,.45),inset 0 1px 0 rgba(255,255,255,.6)}
.sg-btn-gold:hover{background:linear-gradient(180deg,#ffeab0,#f6c255 60%,#e2a23a);filter:brightness(1.05)}
.sg-btn.disabled{opacity:.4;pointer-events:none}

/* ───────── dialogue ───────── */
.sg-dlg{display:flex;align-items:flex-end;justify-content:center;
  padding:0 calc(var(--sr) + var(--g)) calc(var(--sb) + var(--g) + 8px) calc(var(--sl) + var(--g));
  background:linear-gradient(180deg,transparent 45%,rgba(14,14,36,.4))}
.sg-dlg-panel{position:relative;width:min(820px,100%);padding:30px 32px 14px;border-radius:18px;
  background:linear-gradient(180deg,rgba(26,30,64,.86),rgba(16,18,42,.92));
  box-shadow:0 0 0 1px rgba(255,214,140,.32),0 12px 40px rgba(10,10,40,.4);
  transform:translateY(16px);transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.sg-dlg.in .sg-dlg-panel{transform:none}
.sg-dlg-panel::before{content:"";position:absolute;left:18px;right:18px;top:7px;height:1px;
  background:linear-gradient(90deg,transparent,rgba(255,226,160,.35),transparent)}
.sg-dlg-name{position:absolute;left:22px;top:0;transform:translateY(-55%);padding:5px 18px 6px;border-radius:16px;
  font:italic 600 21px/1 var(--serif);color:#3a2508;text-shadow:none;
  background:linear-gradient(180deg,#ffe49a,#F2B742);box-shadow:0 3px 10px rgba(10,10,40,.3)}
.sg-dlg-text{font:400 21px/1.55 var(--serif);color:#fffaf0;min-height:3.1em}
.sg-dlg-ghost{color:transparent;text-shadow:none}
.sg-dlg-foot{display:flex;align-items:center;justify-content:space-between;margin-top:8px;min-height:20px}
.sg-dlg-pips{display:flex;gap:5px}
.sg-dlg-pips i{width:6px;height:6px;border-radius:50%;background:rgba(255,246,230,.25)}
.sg-dlg-pips i.on{background:var(--goldl)}
.sg-dlg-next{margin-left:auto;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--goldl);opacity:0;transition:opacity .2s}
.sg-dlg-next::after{content:" \\25BE";display:inline-block;animation:sg-bob 1s ease-in-out infinite}
.sg-dlg.waiting .sg-dlg-next{opacity:.9}
@keyframes sg-bob{50%{transform:translateY(3px)}}
.sg-dlg-choices{display:none;flex-direction:column;gap:8px;margin:6px 0 8px}
.sg-dlg.choosing .sg-dlg-choices{display:flex}
.sg-dlg.choosing .sg-dlg-foot{display:none}
.sg-choice{display:flex;align-items:center;gap:12px;min-height:48px;padding:8px 16px;border-radius:12px;cursor:pointer;
  font:500 16px var(--sans);background:rgba(255,246,230,.07);box-shadow:inset 0 0 0 1px rgba(255,226,160,.25);
  animation:sg-in .3s ease-out both;transition:background .15s,box-shadow .15s}
.sg-choice.sel{background:rgba(242,183,66,.2);box-shadow:inset 0 0 0 1.5px var(--gold2)}
.sg-choice-key{flex:none;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;font-size:12px;font-weight:800;
  background:rgba(255,246,230,.85);color:#2a2a44;text-shadow:none}
@keyframes sg-in{from{opacity:0;transform:translateY(6px)}}

/* ───────── title screen ───────── */
.sg-title{display:flex;align-items:center;justify-content:center;padding:calc(var(--st) + 20px) calc(var(--sr) + 20px) calc(var(--sb) + 20px) calc(var(--sl) + 20px);
  background:radial-gradient(ellipse 46% 34% at 50% 48%,rgba(24,18,56,.38),transparent 100%),
    linear-gradient(180deg,rgba(23,84,209,.18) 0%,rgba(30,24,70,.25) 45%,rgba(18,14,40,.72) 100%)}
.sg-title-box{display:flex;flex-direction:column;align-items:center;text-align:center;transform:translateY(12px);transition:transform 1s cubic-bezier(.2,.8,.2,1)}
.sg-title.in .sg-title-box{transform:none}
.sg-title-name{font:700 clamp(34px,9.6vw,92px)/1 var(--serif);white-space:nowrap;color:#fffaf0;letter-spacing:.01em;
  text-shadow:0 3px 0 rgba(93,70,117,.55),0 8px 40px rgba(40,20,70,.55)}
.sg-title-sub{display:flex;align-items:center;gap:16px;margin-top:10px;font:italic 600 clamp(24px,3.6vw,38px) var(--serif);color:var(--goldl);
  letter-spacing:.14em;text-shadow:0 2px 14px rgba(60,30,10,.5)}
.sg-title-sub i{width:clamp(40px,8vw,90px);height:1.5px;background:linear-gradient(90deg,transparent,var(--goldl))}
.sg-title-sub i:last-child{background:linear-gradient(90deg,var(--goldl),transparent)}
.sg-title-credit{margin-top:18px;font:italic 400 16px var(--serif);color:rgba(255,246,230,.95);text-shadow:0 1px 8px rgba(20,14,50,.7)}
.sg-title-play{margin-top:36px;min-width:210px;min-height:60px;border-radius:30px;font:600 22px var(--serif);letter-spacing:.06em}
.sg-title-play{animation:sg-glow 2.4s ease-in-out infinite}
@keyframes sg-glow{50%{box-shadow:0 0 0 1px rgba(255,240,200,.8),0 4px 34px rgba(242,183,66,.75),inset 0 1px 0 rgba(255,255,255,.6)}}
.sg-title-hint{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 18px;margin-top:30px;max-width:560px;font-size:13px;color:rgba(255,246,230,.85)}
.sg-title-hint b{display:inline-block;padding:2px 7px;margin-right:2px;border-radius:5px;font-size:11px;font-weight:800;
  background:rgba(255,246,230,.16);box-shadow:inset 0 0 0 1px rgba(255,226,160,.35);color:var(--goldl)}

/* ───────── loadout (basic) ───────── */
.sg-modal{display:flex;align-items:center;justify-content:center;padding:calc(var(--st) + 12px) calc(var(--sr) + 12px) calc(var(--sb) + 12px) calc(var(--sl) + 12px);
  background:rgba(14,14,36,.5);touch-action:manipulation}
.sg-panel{display:flex;flex-direction:column;width:min(940px,100%);max-height:100%;border-radius:18px;overflow:hidden;
  background:linear-gradient(180deg,rgba(26,30,64,.94),rgba(16,18,42,.96));box-shadow:0 0 0 1px rgba(255,214,140,.32),0 16px 50px rgba(0,0,0,.4)}
.sg-panel-head{padding:16px 20px 10px}
.sg-panel-title{font:italic 600 26px var(--serif);color:var(--goldl)}
.sg-panel-sub{font-size:13px;opacity:.75}
.sg-lo-grid{flex:1;min-height:0;overflow:auto;touch-action:pan-y;padding:6px 16px 12px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.sg-lo-card{position:relative;display:flex;gap:10px;min-height:56px;padding:10px 12px;border-radius:12px;cursor:pointer;background:rgba(255,246,230,.06);box-shadow:inset 0 0 0 1px rgba(255,226,160,.18)}
.sg-lo-card.sel{background:rgba(242,183,66,.16);box-shadow:inset 0 0 0 2px var(--gold2)}
.sg-lo-card.mismatch .sg-lo-glyph{filter:grayscale(.7);opacity:.6}
.sg-lo-glyph{flex:none;width:42px;height:42px;border-radius:50%;display:grid;place-items:center;font:700 20px var(--serif);font-variant-emoji:text;
  background:rgba(24,26,58,.9);box-shadow:inset 0 0 0 2px #F2B742}
.sg-lo-glyph[data-kind=damage]{box-shadow:inset 0 0 0 2px #EC6A4C}.sg-lo-glyph[data-kind=heal]{box-shadow:inset 0 0 0 2px #8FD16A}
.sg-lo-glyph[data-kind=defence]{box-shadow:inset 0 0 0 2px #479AF2}.sg-lo-glyph[data-kind=utility]{box-shadow:inset 0 0 0 2px #3FB0A6}
.sg-lo-body{min-width:0}
.sg-lo-name{font:600 16px var(--serif)}
.sg-lo-tags{display:flex;gap:5px;margin:3px 0}
.sg-lo-meta{font-size:11px;opacity:.65;margin:2px 0 3px}
.sg-tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:6px;background:rgba(255,246,230,.12)}
.sg-tag.bad{background:rgba(236,106,76,.3);color:#ffd2c6}
.sg-lo-desc{font-size:12.5px;line-height:1.35;opacity:.85}
.sg-lo-slot{position:absolute;right:8px;top:8px;width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:800;color:#3a2508;text-shadow:none;background:var(--gold2)}
.sg-lo-slot:empty{display:none}
.sg-panel-foot{display:flex;align-items:center;gap:10px;padding:12px 16px;border-top:1px solid rgba(255,226,160,.15)}
.sg-lo-count{margin-right:auto;font-weight:600;color:var(--goldl)}

/* ───────── end screen (basic) ───────── */
.sg-end{display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(ellipse at center,rgba(18,14,40,.45),rgba(18,14,40,.8))}
.sg-end.defeat{background:radial-gradient(ellipse at center,rgba(40,14,24,.5),rgba(30,10,20,.85))}
.sg-end-box{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;max-width:560px}
.sg-end-title{font:italic 700 clamp(44px,8vw,80px)/1 var(--serif);color:var(--goldl);text-shadow:0 0 30px rgba(242,183,66,.5)}
.sg-end.defeat .sg-end-title{color:#f3b8ae;text-shadow:0 0 30px rgba(236,106,76,.4)}
.sg-end-rule{width:240px;height:1.5px;margin:10px 0;background:linear-gradient(90deg,transparent,var(--goldl),transparent)}
.sg-end-line{font:400 17px var(--serif)}
.sg-end-btns{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:20px}

/* ───────── small screens ───────── */
@media (max-width:700px){
  .sg-hud{--g:12px}
  .sg-tl{width:calc(50vw - 1.5 * var(--g))}
  .sg-quest{top:calc(var(--st) + var(--g) + 64px)}
  .sg-toasts{top:calc(var(--st) + 44%)}
  .sg-banner{top:calc(var(--st) + 30vh)}
  .sg-pf{padding:6px 10px 7px 6px;gap:8px}
  .sg-pf-emblem{width:38px;height:38px}.sg-pf-emblem span{font-size:16px}
  .sg-pf-name{font-size:15px}
  .sg-tf{left:auto;right:calc(var(--sr) + var(--g));width:calc(50vw - 1.5 * var(--g))}
  .sg-boss{top:calc(var(--st) + var(--g) + 70px);width:calc(100% - 2 * var(--g))}
  .sg-boss-name{font-size:17px}
  .sg-has-target .sg-quest{top:calc(var(--st) + var(--g) + 128px)}
  .sg-has-boss .sg-quest{top:calc(var(--st) + var(--g) + 150px)}
  .sg-banner-title{font-size:29px}
  .sg-banner-kicker{font-size:12px;letter-spacing:.34em}
  .sg-dlg-panel{padding:24px 18px 12px}
  .sg-dlg-text{font-size:17px}
  .sg-dlg-name{font-size:18px}
  .sg-title-credit{font-size:14px}
}
@media (max-width:700px),(max-height:500px){
  .sg-quest{width:auto;max-width:min(62vw,300px);padding:9px calc(var(--g) + 4px) 10px 22px}
  .sg-quest::before{left:10px}
  .sg-quest-chev{display:block}
  .sg-quest-title{font-size:16px}
  .sg-quest-steps li{font-size:13px}
  .sg-quest:not(.expanded) .sg-quest-steps li:not(.cur){display:none}
  .sg-quest.expanded .sg-quest-chev{transform:rotate(180deg)}
  .sg-quest.collapsed .sg-quest-steps{display:none}
}
@media (max-height:500px){
  .sg-hud{--g:10px;--k:.86}
  .sg-touch .sg-ab{transform:translate(-50%,-50%) translate(calc(var(--lx,0) * var(--k) * 1px),calc(var(--ly,0) * var(--k) * 1px))}
  .sg-touch:not(.sg-no-abilities) .sg-quest{display:none}
  .sg-tl{width:220px}
  .sg-tf{left:calc(var(--sl) + var(--g) + 232px);width:210px}
  .sg-pf-emblem{width:36px;height:36px}
  .sg-banner{top:calc(var(--st) + 28vh)}
  .sg-banner-title{font-size:27px}
  .sg-banner-kicker{font-size:11px;letter-spacing:.34em;margin-bottom:2px}
  .sg-banner-rule{margin-top:8px}
  .sg-dlg-panel{padding:20px 20px 10px}
  .sg-dlg-choices{flex-direction:row;flex-wrap:wrap}
  .sg-choice{flex:1 1 30%;min-height:44px;font-size:15px}
  .sg-touch .sg-castslot{top:58%;bottom:auto;width:220px}
  .sg-touch .sg-promptrow{bottom:calc(var(--sb) + 18px)}
  .sg-joyzone{height:min(72vh,calc(100vh - var(--st) - var(--g) - var(--tlh,62px) - 8px))}
  .sg-dlg-text{font-size:16px;min-height:2.6em}
  .sg-title-credit{margin-top:8px}.sg-title-play{margin-top:16px}.sg-title-hint{margin-top:14px}
  .sg-title-name{font-size:52px}
}
@media (min-width:768px) and (min-height:700px){ .sg-touch{--k:1.12} }
/* portrait phones: the thumb cluster stands in two columns (clear of the joystick); the prompt sits above it */
@media (max-width:700px) and (orientation:portrait){
  .sg-touch .sg-ab{transform:translate(-50%,-50%) translate(calc(var(--cx,0) * var(--k) * 1px),calc(var(--cy,0) * var(--k) * 1px))}
  /* the target frame takes the second row, under the player frame (the right column keeps the gear and Chat) */
  /* portrait: the frames stack in the top-left column (player, party, boss, target, focus), so none overlaps another */
  .sg-tl{width:min(270px,calc(100vw - 2 * var(--g) - 64px));gap:6px}
  .sg-tf{position:relative;order:3;left:auto;right:auto;top:auto;width:auto}
  .sg-tl>.sg-pf{order:0}.sg-tl>.sg-party{order:1}.sg-tl>.sg-bf{order:2}.sg-tl>.sg-af{order:4}
  /* Jobs and Picks: small, out of the way in the right-hand column under Chat (the cluster keeps to the bottom 30%) */
  .sg-touch .sg-ab-jobs,.sg-touch .sg-ab-loadout{width:52px;height:52px;border-radius:14px}
  .sg-touch .sg-ab-jobs .sg-ab-jobglyph{width:24px;height:24px;font-size:14px}
  .sg-touch .sg-ab-jobs .sg-ab-name,.sg-touch .sg-ab-loadout .sg-ab-name{font-size:9px}
  .sg-touch .sg-ab-jobs{transform:translate(-50%,-50%) translate(0px,calc(var(--st) + var(--sb) + 2 * var(--g) + 190px - 100vh));
    transform:translate(-50%,-50%) translate(0px,calc(var(--st) + var(--sb) + 2 * var(--g) + 190px - 100dvh))}
  .sg-touch .sg-ab-loadout{transform:translate(-50%,-50%) translate(0px,calc(var(--st) + var(--sb) + 2 * var(--g) + 248px - 100vh));
    transform:translate(-50%,-50%) translate(0px,calc(var(--st) + var(--sb) + 2 * var(--g) + 248px - 100dvh))}
  .sg-touch .sg-ab-jump{width:64px;height:64px}
  .sg-touch .sg-ab-jump .sg-ab-name{font-size:14px}
  /* the cast bar: centred above the ability cluster (the cluster spans 138 + 64 px from the right edge) */
  .sg-touch .sg-castslot{left:auto;right:calc(var(--sr) + var(--g));transform:none;width:202px;top:auto;bottom:calc(var(--sb) + var(--g) + 38px + 140px + 44px)}
  /* the joystick: further left, so the cluster's third column clears its zone */
  .sg-joy{left:calc(var(--sl) + 74px)}
  .sg-pf-name{font-size:14px}
  .sg-tl{width:min(250px,calc(100vw - 2 * var(--g) - 64px))}
  .sg-pf{max-width:calc(100vw - 2 * var(--g) - 64px)}
  .sg-boss{top:calc(var(--st) + var(--g) + var(--tlh,62px) + 8px)}
  .sg-quest,.sg-has-target .sg-quest,.sg-has-boss .sg-quest{top:calc(var(--st) + var(--g) + var(--tlh,62px) + 8px)}
  /* with the ability cluster up the right edge, the prompt sits near the top, under the frames (never over the cluster or mid-screen) */
  .sg-touch:not(.sg-no-abilities) .sg-promptrow{top:calc(var(--st) + var(--g) + var(--tlh,138px) + 8px);bottom:auto;justify-content:flex-start;padding-right:96px}
  .sg-touch:not(.sg-no-abilities) .sg-prompt{height:48px;border-radius:24px}
  .sg-touch:not(.sg-no-abilities) .sg-prompt-key{width:38px;height:38px;padding:8px}
  .sg-touch.sg-has-boss:not(.sg-no-abilities) .sg-promptrow{top:calc(var(--st) + var(--g) + var(--tlh,138px) + 76px)}
  /* the focused ally: under the target frame's row, in the top third; it carries the prompt (a revive) itself */
  .sg-touch .sg-af{position:relative;margin:0;width:auto}
  .sg-touch .sg-af .sg-chips,.sg-touch .sg-af .sg-cast{display:none}
  .sg-touch.sg-has-ally:not(.sg-no-abilities) .sg-promptrow{display:none}
  .sg-touch.sg-has-ally .sg-af-act.on{display:flex}
  .sg-touch.sg-no-abilities .sg-promptrow{justify-content:flex-end;bottom:calc(var(--sb) + 132px)}
  .sg-touch .sg-prompt-text{font-size:16px}
  /* the joystick's (invisible) touch zone stays in the bottom third: a tap on an enemy mid-screen is never taken by it */
  .sg-joyzone{height:min(33vh,calc(100vh - var(--st) - var(--g) - var(--tlh,138px) - 12px));width:38vw}
}
/* the narrowest phones (iPhone SE, 320 px): the grid packs a little tighter and the joystick a little smaller */
@media (max-width:340px) and (orientation:portrait){
  .sg-touch{--k:.95}
  .sg-joy{left:calc(var(--sl) + 56px);width:104px;height:104px}
  .sg-joyzone{width:33vw}
}

/* ───────── settings (gear + panel) ───────── */
.sg-gear{position:absolute;top:calc(var(--st) + var(--g));right:calc(var(--sr) + var(--g));width:48px;height:48px;padding:12px;border:0;border-radius:50%;
  color:var(--goldl);background:rgba(16,18,42,.5);box-shadow:inset 0 0 0 1px rgba(255,226,160,.35);transition:transform .15s}
.sg-gear:active{transform:scale(.92)}
.sg-gear::before{content:"";position:absolute;inset:-6px}
.sg-settings{position:absolute;inset:0;display:none;align-items:center;justify-content:center;
  padding:calc(var(--st) + 12px) calc(var(--sr) + 12px) calc(var(--sb) + 12px) calc(var(--sl) + 12px);background:rgba(14,14,36,.35)}
.sg-settings.on{display:flex}
.sg-settings-card{width:min(380px,100%);padding:14px 18px 18px;border-radius:18px;animation:sg-in .25s ease-out both;
  background:linear-gradient(180deg,rgba(26,30,64,.94),rgba(16,18,42,.96));box-shadow:0 0 0 1px rgba(255,214,140,.32),0 16px 50px rgba(0,0,0,.4)}
.sg-settings-head{display:flex;align-items:center;margin-bottom:10px}
.sg-settings-title{flex:1;font:italic 600 24px var(--serif);color:var(--goldl)}
.sg-settings-close{position:relative;width:32px;height:32px;padding:6px;border:0;border-radius:50%;color:var(--cream);background:rgba(255,255,255,.12);cursor:pointer}
.sg-settings-close::before{content:"";position:absolute;inset:-8px}
.sg-switch-row{display:flex;align-items:center;gap:14px;min-height:56px;padding:10px 12px;border-radius:12px;cursor:pointer;
  background:rgba(255,246,230,.07);box-shadow:inset 0 0 0 1px rgba(255,226,160,.22)}
.sg-switch-text{flex:1;display:flex;flex-direction:column;gap:3px}
.sg-switch-name{font:600 16px var(--sans)}
.sg-switch-sub{font-size:12.5px;line-height:1.35;opacity:.8}
.sg-switch-input{position:absolute;opacity:0;width:1px;height:1px;pointer-events:none}
.sg-switch{flex:none;position:relative;width:50px;height:30px;border-radius:15px;background:rgba(255,246,230,.2);
  box-shadow:inset 0 0 0 1px rgba(255,226,160,.35);transition:background .2s}
.sg-switch::after{content:"";position:absolute;left:3px;top:3px;width:24px;height:24px;border-radius:50%;background:#fffaf0;
  box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .2s}
.sg-switch-input:checked+.sg-switch{background:linear-gradient(180deg,#ffe49a,#F2B742)}
.sg-switch-input:checked+.sg-switch::after{transform:translateX(20px)}
.sg-switch-input:focus-visible+.sg-switch{outline:2px solid var(--goldl);outline-offset:2px}
/* the gear sits in the top-right corner: wide screens move the quest tracker down below it */
@media (min-width:701px){ .sg-quest{top:calc(var(--st) + var(--g) + 52px)} }
`;

/** The passive line under the prompt (the crater mouth's note). */
const HINT_CSS = /* css */ `
.sg-hint{display:none;max-width:min(520px,100%);margin-top:6px;padding:6px 14px;border-radius:14px;font-size:13.5px;line-height:1.35;text-align:center;
  background:rgba(20,25,50,.66);box-shadow:0 0 0 1px rgba(63,176,166,.55)}
.sg-hint.on{display:block}
.sg-promptrow{flex-direction:column;align-items:center}
@media (max-width:700px) and (orientation:portrait){ .sg-touch:not(.sg-no-abilities) .sg-promptrow{align-items:flex-start} .sg-touch.sg-no-abilities .sg-promptrow{align-items:flex-end} .sg-hint{text-align:left;font-size:12.5px;max-width:calc(100vw - 2 * var(--g) - 96px)} }
`;

let injected = false;
export function injectStyles(): void {
  if (injected || document.getElementById('sg-hud-css')) { injected = true; return; }
  injected = true;
  const s = document.createElement('style');
  s.id = 'sg-hud-css';
  s.textContent = CSS + JOBS_CSS + PARTY_CSS + BOSS_CSS + EDGE_CSS + HINT_CSS + GEAR_CSS + TRACKER_CSS + JOURNAL_CSS + POINTER_CSS + MOMENT_CSS + DIALOGUE_SHEET_CSS;
  document.head.appendChild(s);
}
