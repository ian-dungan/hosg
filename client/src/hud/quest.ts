// Quest tracker (top-right). Collapses to title + current step on small screens; tap to toggle.
import type { HudState } from '../core/contracts';
import { h, toggle, ICONS } from './dom';

export class QuestTracker {
  readonly el: HTMLElement;
  private title: HTMLElement;
  private list: HTMLElement;
  private key = '';
  private done: boolean[] = [];
  private open: boolean | null = null; // null = automatic (by screen size)
  private peekTimer = 0;
  constructor(parent: HTMLElement) {
    this.el = h('div', 'sg-quest sg-ctl');
    parent.appendChild(this.el);
    const head = h('div', 'sg-quest-head', this.el);
    h('div', 'sg-quest-kicker', head, 'Main Quest');
    h('span', 'sg-quest-chev', head).innerHTML = ICONS.chevron;
    this.title = h('div', 'sg-quest-title', this.el);
    this.list = h('ul', 'sg-quest-steps', this.el);
    this.el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      clearTimeout(this.peekTimer);
      const expanded = this.el.classList.contains('expanded') || (!this.el.classList.contains('collapsed') && !this.small());
      this.open = !expanded;
      this.applyOpen();
    });
    this.applyOpen();
  }
  private small(): boolean { return window.innerWidth < 700 || window.innerHeight < 500; }
  private applyOpen(): void {
    toggle(this.el, 'expanded', this.open === true);
    toggle(this.el, 'collapsed', this.open === false);
  }
  /** Briefly expand on small screens when the quest changes. */
  private peek(): void {
    if (!this.small() || this.open === true) return;
    const prev = this.open;
    this.open = true; this.applyOpen();
    clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => { this.open = prev; this.applyOpen(); }, 4500);
  }
  update(q: HudState['quest']): void {
    const key = q ? q.title + '\u0001' + q.steps.map((s) => (s.done ? '1' : '0') + s.text).join('\u0002') : '';
    if (key === this.key) return;
    const firstTime = this.key === '';
    const sameQuest = !!q && this.title.textContent === q.title;
    this.key = key;
    toggle(this.el, 'on', !!q);
    if (!q) { this.done = []; return; }
    this.title.textContent = q.title;
    this.list.textContent = '';
    const cur = q.steps.findIndex((s) => !s.done);
    q.steps.forEach((s, i) => {
      const li = h('li', s.done ? 'done' : i === cur ? 'cur' : '', this.list);
      h('i', '', li);
      h('span', '', li, s.text);
      const justDone = sameQuest && s.done && this.done[i] === false;
      const isNew = sameQuest && this.done[i] === undefined;
      if (justDone) li.animate([{ background: 'rgba(255,207,90,.45)' }, { background: 'rgba(255,207,90,0)' }], { duration: 1400, easing: 'ease-out' });
      if (isNew) li.animate([{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }], { duration: 500, easing: 'ease-out' });
    });
    if (!sameQuest) this.el.animate([{ opacity: 0, transform: 'translateX(24px)' }, { opacity: 1, transform: 'none' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    this.done = q.steps.map((s) => s.done);
    if (!firstTime) this.peek();
  }
}
