// Quest tracker. Desktop and tablets: top right under the gear, every objective line of the step with its
// counts, and the step's hint under them. Phones: compact (the title and the current line), in a reserved spot
// that never covers the ability cluster, the frames or the fight (portrait: under the frames' column; landscape:
// under the gear, hidden while a boss frame is up). A tap opens the journal (its chevron says so); "+2" counts
// the other active quests. It peeks open (every line) for a moment when the step changes, and a line that
// completes flashes gold.
import type { HudState } from '../core/contracts';
import { h, toggle, ICONS } from './dom';

export class QuestTracker {
  readonly el: HTMLElement;
  private kicker: HTMLElement;
  private more: HTMLElement;
  private title: HTMLElement;
  private list: HTMLElement;
  private hint: HTMLElement;
  private key = '';
  private done: boolean[] = [];
  private peekTimer = 0;
  constructor(parent: HTMLElement, onTap: () => void) {
    this.el = h('div', 'sg-quest sg-ctl');
    parent.appendChild(this.el);
    this.el.setAttribute('role', 'button');
    this.el.setAttribute('aria-label', 'Open the journal');
    const head = h('div', 'sg-quest-head', this.el);
    this.kicker = h('div', 'sg-quest-kicker', head, 'Main quest');
    this.more = h('span', 'sg-quest-more', head);
    h('span', 'sg-quest-book', head).innerHTML = ICONS.chevron;
    this.title = h('div', 'sg-quest-title', this.el);
    this.list = h('ul', 'sg-quest-steps', this.el);
    this.hint = h('div', 'sg-quest-hint', this.el);
    this.el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); });
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(this.peekTimer);
      this.el.classList.remove('expanded');
      this.el.animate([{ transform: 'scale(.97)' }, { transform: 'none' }], { duration: 160 });
      onTap();
    });
  }
  private small(): boolean { return window.innerWidth < 700 || window.innerHeight < 500; }
  /** Every line for a moment on small screens when the step changes. */
  private peek(): void {
    if (!this.small()) return;
    this.el.classList.add('expanded');
    clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => this.el.classList.remove('expanded'), 4500);
  }
  update(q: HudState['quest']): void {
    const key = q ? q.title + '\u0001' + (q.hint ?? '') + '\u0001' + (q.more ?? 0) + '\u0001' + (q.kicker ?? '') + '\u0001' + q.steps.map((s) => (s.done ? '1' : '0') + s.text).join('\u0002') : '';
    if (key === this.key) return;
    const firstTime = this.key === '';
    const sameQuest = !!q && this.title.textContent === q.title;
    const before = this.list.textContent;
    this.key = key;
    toggle(this.el, 'on', !!q);
    if (!q) { this.done = []; return; }
    this.title.textContent = q.title;
    this.kicker.textContent = q.kicker ?? 'Main quest';
    const more = q.more ?? 0;
    this.more.textContent = more > 0 ? `+${more}` : '';
    this.more.title = more > 0 ? `${more} more in the journal` : '';
    this.hint.textContent = q.hint ?? '';
    toggle(this.hint, 'on', !!q.hint);
    this.list.textContent = '';
    const cur = q.steps.findIndex((s) => !s.done);
    q.steps.forEach((s, i) => {
      const li = h('li', s.done ? 'done' : i === cur ? 'cur' : '', this.list);
      h('i', '', li);
      h('span', '', li, s.text);
      const justDone = sameQuest && s.done && this.done[i] === false;
      const isNew = sameQuest && this.done[i] === undefined;
      if (justDone) li.animate([{ background: 'rgba(255,207,90,.55)' }, { background: 'rgba(255,207,90,0)' }], { duration: 1400, easing: 'ease-out' });
      if (isNew) li.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'ease-out' });
    });
    if (!sameQuest) this.el.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    this.done = q.steps.map((s) => s.done);
    // a new step (or a new quest) peeks open; a count going up only flashes
    if (!firstTime && (!sameQuest || q.steps.length !== this.list.children.length || before.replace(/\d+/g, '') !== this.list.textContent!.replace(/\d+/g, ''))) this.peek();
  }
}

/** The tracker's layout (after the base HUD's: these rules win). */
export const TRACKER_CSS = /* css */ `
.sg-quest-head{display:flex;align-items:center;gap:6px}
.sg-quest-kicker{font-size:14px;letter-spacing:.14em}
.sg-quest-more{display:none;min-width:26px;height:20px;padding:0 7px;border-radius:10px;font:800 14px/20px var(--sans);text-align:center;color:#3a2508;text-shadow:none;background:var(--gold2)}
.sg-quest-more:not(:empty){display:inline-block}
.sg-quest-book{width:16px;height:16px;color:var(--goldl);opacity:.85;transform:rotate(-90deg)}
.sg-quest-hint{display:none;margin-top:8px;font-size:14px;line-height:1.35;font-style:italic;color:rgba(255,250,240,.86)}
.sg-quest-steps li{font-size:14px}
@media (min-width:701px) and (min-height:501px){ .sg-quest-hint.on{display:block} }
@media (max-width:700px),(max-height:500px){
  .sg-quest{padding:7px 12px 8px 20px}
  .sg-quest::before{left:9px;top:10px;bottom:10px}
  .sg-quest-kicker{display:none}
  .sg-quest-head{position:absolute;right:8px;top:8px}
  .sg-quest-title{margin:0;padding-right:44px;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sg-quest-steps{margin-top:3px;gap:3px}
  .sg-quest-steps li{font-size:14px}
  .sg-quest:not(.expanded) .sg-quest-steps li:not(.cur){display:none}
  .sg-quest.expanded .sg-quest-steps li{display:flex}
  .sg-quest-steps li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .sg-quest.expanded .sg-quest-steps li span{white-space:normal}
}
/* portrait phones: the reserved spot is the frames' own column, just under them (clear of the right-hand buttons) */
@media (max-width:700px) and (orientation:portrait){
  .sg-hud .sg-quest,.sg-hud.sg-has-target .sg-quest{top:calc(var(--st) + var(--g) + var(--tlh,62px) + 8px);right:auto;left:calc(var(--sl) + var(--g));
    width:min(270px,calc(100vw - 2 * var(--g) - 72px));max-width:none;border-radius:12px;
    background:linear-gradient(90deg,rgba(18,22,48,.5),rgba(18,22,48,.28));-webkit-mask-image:none;mask-image:none}
  .sg-hud.sg-has-boss .sg-quest{top:calc(var(--st) + var(--g) + var(--tlh,62px) + var(--bsh,96px) + 14px)}
  /* the prompt (and the crater's note) step down under the tracker */
  .sg-hud.sg-touch.sg-has-quest:not(.sg-no-abilities) .sg-promptrow{top:calc(var(--st) + var(--g) + var(--tlh,62px) + var(--qh,0px) + 14px)}
  .sg-hud.sg-touch.sg-has-quest.sg-has-boss:not(.sg-no-abilities) .sg-promptrow{top:calc(var(--st) + var(--g) + var(--tlh,62px) + var(--bsh,96px) + var(--qh,0px) + 20px)}
}
/* the smallest phones in a fight: the title alone (the tracker stays above 45% of the screen) */
@media (max-width:700px) and (orientation:portrait) and (max-height:640px){
  .sg-hud.sg-in-combat .sg-quest:not(.expanded) .sg-quest-steps{display:none}
  .sg-hud.sg-has-bossframe .sg-quest.on,.sg-hud.sg-has-boss.sg-has-party .sg-quest.on{display:none}
}
/* tablets and narrow desktops: under the target or boss frame's row while one is up */
@media (min-width:701px) and (max-width:1100px) and (min-height:501px){
  .sg-hud.sg-has-target .sg-quest,.sg-hud.sg-has-boss .sg-quest,.sg-hud.sg-has-bossframe .sg-quest{top:calc(var(--st) + var(--g) + 156px)}
}
/* landscape phones: under the gear on the right, above the thumb cluster; a boss frame takes the top (the tracker steps aside) */
@media (max-height:500px){
  .sg-hud.sg-touch:not(.sg-no-abilities) .sg-quest.on,.sg-hud .sg-quest.on{display:block}
  .sg-hud .sg-quest{top:calc(var(--st) + var(--g) + 54px);right:calc(var(--sr) + var(--g));width:auto;max-width:min(250px,30vw);border-radius:12px;
    background:linear-gradient(90deg,rgba(18,22,48,.5),rgba(18,22,48,.3));-webkit-mask-image:none;mask-image:none}
  .sg-hud.sg-touch.sg-has-boss .sg-quest.on,.sg-hud.sg-touch.sg-has-bossframe .sg-quest.on{display:none}
  .sg-hud .sg-quest.expanded .sg-quest-steps li:not(.cur){display:none}
}
`;
