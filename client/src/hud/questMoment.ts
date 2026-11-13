// The quest's moments on the HUD (Plan 6): the completion of a step (a gold banner with the step's line and
// its reward chips, a title toast), the teaching hints (short, dismissible, never modal: only their close
// button takes taps) and the quest card (the epilogue's offer, the equip prompt: a small card with buttons,
// never modal either). One element each, reused; text is set as text.
import type { QuestCardOpts, QuestMoment } from '../core/contracts';
import { h, ICONS } from './dom';

/** How long a step's moment stays, in ms (a finished quest's a little longer). */
export const MOMENT_MS = 2800;
const QUEST_MOMENT_MS = 3800;
/** A hint goes by itself after this many seconds unless told otherwise. */
export const HINT_S = 9;

/** The reward chips of a moment: "+20 xp", "+10 gold", the item, in that order (nothing for a step that pays nothing). */
export function rewardChips(g: Pick<QuestMoment, 'xp' | 'gold' | 'item'>): string[] {
  const out: string[] = [];
  if (g.xp > 0) out.push(`+${g.xp} xp`);
  if (g.gold > 0) out.push(`+${g.gold} gold`);
  if (g.item) out.push(g.item);
  return out;
}

export class QuestMoments {
  private moment: HTMLElement;
  private mKick: HTMLElement;
  private mTitle: HTMLElement;
  private mChips: HTMLElement;
  private mTitle2: HTMLElement;
  private queue: QuestMoment[] = [];
  private playing = false;
  private hintEl: HTMLElement;
  private hintText: HTMLElement;
  private hintDone: ((dismissed: boolean) => void) | null = null;
  private hintTimer = 0;
  private card: HTMLElement;
  private cardKick: HTMLElement;
  private cardTitle: HTMLElement;
  private cardText: HTMLElement;
  private cardBtns: HTMLElement;
  private cardDone: ((i: number) => void) | null = null;
  private cardTimer = 0;

  constructor(fx: HTMLElement, combat: HTMLElement) {
    this.moment = h('div', 'sg-qm', fx);
    this.mKick = h('div', 'sg-qm-kick', this.moment);
    this.mTitle = h('div', 'sg-qm-title', this.moment);
    h('div', 'sg-qm-rule', this.moment);
    this.mChips = h('div', 'sg-qm-chips', this.moment);
    this.mTitle2 = h('div', 'sg-qm-title2', this.moment);

    this.hintEl = h('div', 'sg-qh', combat);
    h('i', 'sg-qh-icon', this.hintEl).textContent = '?';
    this.hintText = h('div', 'sg-qh-text', this.hintEl);
    const hx = h('button', 'sg-qh-x sg-ctl', this.hintEl);
    hx.type = 'button'; hx.setAttribute('aria-label', 'Got it'); hx.innerHTML = ICONS.close;
    hx.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.endHint(true); });

    this.card = h('div', 'sg-qc sg-ctl', combat);
    this.cardKick = h('div', 'sg-qc-kick', this.card);
    this.cardTitle = h('div', 'sg-qc-title', this.card);
    this.cardText = h('div', 'sg-qc-text', this.card);
    this.cardBtns = h('div', 'sg-qc-btns', this.card);
    const cx = h('button', 'sg-qc-x', this.card);
    cx.type = 'button'; cx.setAttribute('aria-label', 'Close'); cx.innerHTML = ICONS.close;
    cx.addEventListener('click', (e) => { e.stopPropagation(); this.endCard(-1); });
    this.card.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  // ── the completion moment ──
  done(g: QuestMoment): void {
    this.queue.push(g);
    if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4);
    if (!this.playing) this.next();
  }
  private next(): void {
    const g = this.queue.shift();
    if (!g) { this.playing = false; return; }
    this.playing = true;
    this.mKick.textContent = g.questDone ? 'Quest complete' : 'Step complete';
    this.mTitle.textContent = g.questDone ? g.title : g.step;
    this.mChips.textContent = '';
    for (const c of rewardChips(g)) h('span', 'sg-qm-chip', this.mChips, c);
    this.moment.classList.toggle('big', g.questDone);
    const ms = g.questDone ? QUEST_MOMENT_MS : MOMENT_MS;
    const a = this.moment.animate([
      { opacity: 0, transform: 'translateY(12px) scale(.96)' }, { opacity: 1, transform: 'none', offset: 0.1 },
      { opacity: 1, transform: 'none', offset: 0.84 }, { opacity: 0, transform: 'translateY(-8px)' },
    ], { duration: ms, easing: 'ease-out' });
    this.mChips.querySelectorAll('.sg-qm-chip').forEach((c, i) => (c as HTMLElement).animate(
      [{ opacity: 0, transform: 'translateY(8px) scale(.8)' }, { opacity: 1, transform: 'scale(1.12)', offset: 0.6 }, { opacity: 1, transform: 'none' }],
      { duration: 420, delay: 260 + i * 140, easing: 'ease-out', fill: 'backwards' }));
    this.mTitle2.textContent = g.title2 ? `New title: ${g.title2}` : '';
    a.finished.then(() => this.next(), () => this.next());
  }

  // ── hints ──
  hint(text: string | null, seconds = HINT_S): Promise<boolean> {
    this.endHint(false);
    if (!text) return Promise.resolve(false);
    this.hintText.textContent = text;
    this.hintEl.classList.add('on');
    this.hintEl.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' });
    this.hintTimer = window.setTimeout(() => this.endHint(false), Math.max(2, seconds) * 1000);
    return new Promise((r) => { this.hintDone = r; });
  }
  private endHint(dismissed: boolean): void {
    clearTimeout(this.hintTimer);
    const d = this.hintDone;
    this.hintDone = null;
    if (!d) return;
    this.hintEl.classList.remove('on');
    d(dismissed);
  }

  // ── the card ──
  open(c: QuestCardOpts): Promise<number> {
    this.endCard(-1);
    this.cardKick.textContent = c.kicker;
    this.cardTitle.textContent = c.title;
    this.cardText.textContent = c.text;
    this.cardBtns.textContent = '';
    c.buttons.forEach((b, i) => {
      const el = h('button', 'sg-btn sg-qc-btn' + (i === 0 ? ' sg-btn-gold' : ''), this.cardBtns, b);
      el.type = 'button';
      el.addEventListener('click', (e) => { e.stopPropagation(); this.endCard(i); });
    });
    this.card.classList.add('on');
    this.card.animate([{ opacity: 0, transform: 'translateY(14px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (c.seconds) this.cardTimer = window.setTimeout(() => this.endCard(-1), c.seconds * 1000);
    return new Promise((r) => { this.cardDone = r; });
  }
  endCard(i: number): void {
    clearTimeout(this.cardTimer);
    const d = this.cardDone;
    this.cardDone = null;
    if (!d) return;
    this.card.classList.remove('on');
    d(i);
  }
}

export const MOMENT_CSS = /* css */ `
.sg-qm{position:absolute;left:0;right:0;margin:0 auto;top:calc(var(--st) + 17vh);opacity:0;pointer-events:none;text-align:center;
  width:min(440px,calc(100vw - 2 * var(--g)));padding:12px 20px 14px;border-radius:18px;
  background:radial-gradient(ellipse at 50% 0%,rgba(242,183,66,.38),rgba(26,22,52,.78) 70%);box-shadow:0 0 0 1.5px rgba(255,214,120,.75),0 8px 30px rgba(40,20,0,.35),0 0 40px rgba(242,183,66,.3)}
.sg-qm-kick{font-size:14px;font-weight:800;letter-spacing:.24em;text-transform:uppercase;color:var(--gold2);padding-left:.24em}
.sg-qm-title{margin-top:4px;font:italic 600 24px/1.2 var(--serif);color:#fffaf0}
.sg-qm.big .sg-qm-title{font-size:30px}
.sg-qm-rule{width:60%;height:1.5px;margin:8px auto 8px;background:linear-gradient(90deg,transparent,var(--goldl),transparent)}
.sg-qm-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.sg-qm-chips:empty,.sg-qm-title2:empty{display:none}
.sg-qm-title2{margin-top:8px;font:italic 600 17px/1.25 var(--serif);color:var(--goldl);text-shadow:0 0 12px rgba(242,183,66,.7)}
.sg-qm-chip{padding:4px 12px;border-radius:14px;font:700 15px var(--sans);color:#3a2508;text-shadow:none;background:linear-gradient(180deg,#ffe49a,#F2B742)}
.sg-qh{position:absolute;left:0;right:0;margin:0 auto;bottom:calc(var(--sb) + 128px);display:none;align-items:center;gap:10px;
  width:max-content;max-width:min(520px,calc(100vw - 2 * var(--g)));padding:8px 6px 8px 12px;border-radius:16px;pointer-events:none;
  background:rgba(16,22,48,.84);box-shadow:0 0 0 1.5px rgba(63,176,166,.8),0 6px 20px rgba(10,10,40,.3)}
.sg-qh.on{display:flex}
.sg-qh-icon{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:800 15px/1 var(--sans);font-style:normal;color:#0f2a28;text-shadow:none;background:#3FB0A6}
.sg-qh-text{flex:1;min-width:0;font-size:15px;line-height:1.35}
.sg-qh-x{position:relative;flex:none;width:48px;height:48px;margin:-8px 0;padding:14px;border:0;border-radius:50%;color:var(--cream);background:none;cursor:pointer}
.sg-qc{position:absolute;left:0;right:0;margin:0 auto;top:38%;display:none;flex-direction:column;gap:6px;
  width:min(400px,calc(100vw - 2 * var(--g)));padding:14px 16px 14px;border-radius:18px;text-align:center;
  background:linear-gradient(180deg,rgba(30,32,70,.95),rgba(16,18,42,.96));box-shadow:0 0 0 1.5px rgba(255,214,140,.6),0 14px 40px rgba(0,0,0,.4)}
.sg-qc.on{display:flex}
.sg-qc-kick{font-size:14px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--gold2)}
.sg-qc-title{font:italic 600 24px/1.2 var(--serif);color:var(--goldl)}
.sg-qc-text{font:400 16px/1.4 var(--serif);color:#fffaf0}
.sg-qc-btns{display:flex;gap:8px;margin-top:6px}
.sg-qc-btn{flex:1;min-width:0;min-height:48px;padding:0 12px}
.sg-qc-x{position:absolute;right:4px;top:4px;width:48px;height:48px;padding:15px;border:0;border-radius:50%;color:var(--cream);background:none;cursor:pointer}
.sg-modal-open .sg-qc,.sg-modal-open .sg-qh{visibility:hidden}
.sg-desktop .sg-qh{bottom:calc(var(--sb) + 132px)}
@media (max-width:700px) and (orientation:portrait){
  .sg-qm{top:calc(var(--st) + 33%);padding:10px 14px 12px}
  .sg-qm-title{font-size:20px}.sg-qm.big .sg-qm-title{font-size:24px}
  /* hints: the band between the adventurer's feet and the thumb controls */
  .sg-touch .sg-qh{bottom:calc(var(--sb) + 236px);top:auto;width:calc(100vw - 2 * var(--g))}
  .sg-qc{top:33%}
}
@media (max-height:500px){
  .sg-qm{top:calc(var(--st) + 14vh);padding:8px 16px 10px}
  .sg-qm-title{font-size:19px}.sg-qm.big .sg-qm-title{font-size:22px}
  /* landscape phones: between the joystick and the thumb cluster, under the adventurer */
  .sg-touch .sg-qh{bottom:calc(var(--sb) + 10px);max-width:min(400px,calc(100vw - 420px))}
  .sg-qc{top:auto;bottom:calc(var(--sb) + 10px);width:min(380px,calc(100vw - 440px));padding:10px 12px}
  .sg-qc-title{font-size:19px}.sg-qc-text{font-size:14px}
}
`;
