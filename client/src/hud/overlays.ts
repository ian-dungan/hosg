// Modal overlays: dialogue, title screen, loadout picker, end screen, fade.
import type { AbilityDef, WeaponId } from '../core/contracts';
import { h } from './dom';

type KeyHandler = (e: KeyboardEvent) => boolean;

export class Overlays {
  /** The top-most modal's key handler (null when nothing modal is open). */
  private handlers: KeyHandler[] = [];
  private dlgChain: Promise<unknown> = Promise.resolve();
  private fadeEl: HTMLElement;
  constructor(private layer: HTMLElement, private setModal: (kind: string, on: boolean) => void, private isTouch: () => boolean) {
    this.fadeEl = h('div', 'sg-fade', layer);
  }
  get active(): boolean { return this.handlers.length > 0; }
  handleKey(e: KeyboardEvent): boolean {
    const hd = this.handlers[this.handlers.length - 1];
    return hd ? hd(e) : false;
  }
  private push(kind: string, hd: KeyHandler): () => void {
    this.handlers.push(hd);
    this.setModal(kind, true);
    return () => {
      const i = this.handlers.indexOf(hd);
      if (i >= 0) this.handlers.splice(i, 1);
      this.setModal(kind, false);
    };
  }
  private close(el: HTMLElement): void {
    el.classList.remove('in');
    el.classList.add('out');
    el.style.pointerEvents = 'none';
    window.setTimeout(() => el.remove(), 400);
  }
  private show(el: HTMLElement): void { requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in'))); }

  // ───────────── dialogue ─────────────
  dialogue(speaker: string, lines: string[], choices?: string[]): Promise<number> {
    const run = this.dlgChain.then(() => this.runDialogue(speaker, lines.length ? lines : [''], choices ?? []));
    this.dlgChain = run.catch(() => 0);
    return run;
  }
  private runDialogue(speaker: string, lines: string[], choices: string[]): Promise<number> {
    return new Promise((resolve) => {
      const root = h('div', 'sg-dlg sg-ctl', this.layer);
      const panel = h('div', 'sg-dlg-panel', root);
      const name = h('div', 'sg-dlg-name', panel, speaker);
      name.hidden = !speaker;
      const text = h('div', 'sg-dlg-text', panel);
      const shown = document.createTextNode('');
      const hiddenSpan = h('span', 'sg-dlg-ghost');
      text.append(shown, hiddenSpan);
      const foot = h('div', 'sg-dlg-foot', panel);
      const pips = h('div', 'sg-dlg-pips', foot);
      const pipEls = lines.map(() => h('i', '', pips));
      if (lines.length < 2) pips.hidden = true;
      const next = h('div', 'sg-dlg-next', foot);
      next.textContent = this.isTouch() ? 'Tap to continue' : 'Enter to continue';
      const chWrap = h('div', 'sg-dlg-choices', panel);
      let li = 0, chars = 0, typing = false, raf = 0, last = 0, sel = 0, finished = false, shownAt = 0;
      let choiceEls: HTMLElement[] = [];
      const CPS = 48;
      const tick = (t: number) => {
        if (!typing) return;
        if (!last) last = t;
        const full = lines[li];
        chars = Math.min(full.length, chars + ((t - last) / 1000) * CPS);
        last = t;
        const n = Math.floor(chars);
        shown.data = full.slice(0, n);
        hiddenSpan.textContent = full.slice(n);
        if (n >= full.length) { typing = false; lineDone(); } else raf = requestAnimationFrame(tick);
      };
      const startLine = () => {
        chars = 0; last = 0; typing = true;
        shown.data = ''; hiddenSpan.textContent = lines[li];
        pipEls.forEach((p, i) => p.classList.toggle('on', i <= li));
        root.classList.remove('waiting');
        raf = requestAnimationFrame(tick);
      };
      const lineDone = () => {
        shown.data = lines[li]; hiddenSpan.textContent = '';
        if (li === lines.length - 1 && choices.length) showChoices();
        else root.classList.add('waiting');
        next.textContent = li === lines.length - 1 ? (this.isTouch() ? 'Tap to close' : 'Enter to close') : (this.isTouch() ? 'Tap to continue' : 'Enter to continue');
      };
      const showChoices = () => {
        root.classList.add('choosing');
        shownAt = performance.now();
        choiceEls = choices.map((c, i) => {
          const b = h('div', 'sg-choice', chWrap);
          if (!this.isTouch()) h('span', 'sg-choice-key', b, String(i + 1));
          h('span', '', b, c);
          b.style.animationDelay = i * 70 + 'ms';
          b.addEventListener('pointerenter', () => setSel(i));
          b.addEventListener('click', (e) => { e.stopPropagation(); if (performance.now() - shownAt > 350) finish(i); });
          b.addEventListener('pointerdown', (e) => e.stopPropagation());
          return b;
        });
        setSel(0);
      };
      const setSel = (i: number) => { sel = i; choiceEls.forEach((b, j) => b.classList.toggle('sel', j === i)); };
      const advance = () => {
        if (finished) return;
        if (typing) { typing = false; cancelAnimationFrame(raf); lineDone(); return; }
        if (choiceEls.length) return;
        if (li < lines.length - 1) { li++; startLine(); return; }
        finish(0);
      };
      const finish = (i: number) => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        off();
        this.close(root);
        resolve(i);
      };
      root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); advance(); });
      const off = this.push('dialogue', (e) => {
        const k = e.code;
        if (choiceEls.length) {
          if (k === 'ArrowDown' || k === 'KeyS') setSel((sel + 1) % choiceEls.length);
          else if (k === 'ArrowUp' || k === 'KeyW') setSel((sel + choiceEls.length - 1) % choiceEls.length);
          else if (k === 'Enter' || k === 'Space' || k === 'KeyE' || k === 'NumpadEnter') finish(sel);
          else { const d = /^(?:Digit|Numpad)([1-9])$/.exec(k); if (d && +d[1] <= choiceEls.length) finish(+d[1] - 1); else return false; }
          return true;
        }
        if (k === 'Enter' || k === 'Space' || k === 'KeyE' || k === 'NumpadEnter') { if (!e.repeat) advance(); return true; }
        return k === 'Escape' ? (advance(), true) : false;
      });
      this.show(root);
      startLine();
    });
  }

  // ───────────── title ─────────────
  titleScreen(): Promise<void> {
    return new Promise((resolve) => {
      const root = h('div', 'sg-title sg-ctl', this.layer);
      const box = h('div', 'sg-title-box', root);
      h('div', 'sg-title-name', box, 'Shady Grove 2');
      h('div', 'sg-title-credit', box, 'A sequel — in honour of Ellie & Felix');
      const play = h('div', 'sg-btn sg-btn-gold sg-title-play', box, 'Play');
      const hint = h('div', 'sg-title-hint', box);
      const items = this.isTouch()
        ? [['Left thumb', 'move'], ['Drag', 'look around'], ['Tap', 'walk & talk'], ['Pinch', 'zoom']]
        : [['WASD', 'move'], ['Drag', 'look around'], ['E', 'talk'], ['Click', 'walk & talk'], ['Wheel', 'zoom']];
      for (const [k, v] of items) { const s = h('span', '', hint); h('b', '', s, k); s.append(' ' + v); }
      const go = () => { off(); this.close(root); resolve(); };
      play.addEventListener('click', go);
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('title', (e) => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { go(); return true; } return true; });
      this.show(root);
    });
  }

  // ───────────── loadout ─────────────
  loadout(pool: AbilityDef[], current: string[], weapon: WeaponId): Promise<string[]> {
    return new Promise((resolve) => {
      const chosen = current.filter((id) => pool.some((a) => a.id === id)).slice(0, 5);
      const root = h('div', 'sg-modal sg-ctl', this.layer);
      const panel = h('div', 'sg-panel sg-loadout', root);
      const head = h('div', 'sg-panel-head', panel);
      h('div', 'sg-panel-title', head, 'Loadout');
      h('div', 'sg-panel-sub', head, `Choose five abilities · wielding ${weapon === 'blade' ? 'Blade' : 'Bow'}`);
      const grid = h('div', 'sg-lo-grid', panel);
      const foot = h('div', 'sg-panel-foot', panel);
      const count = h('div', 'sg-lo-count', foot);
      const cancel = h('div', 'sg-btn', foot, 'Cancel');
      const ok = h('div', 'sg-btn sg-btn-gold', foot, 'Confirm');
      const cards = pool.map((a) => {
        const c = h('div', 'sg-lo-card', grid);
        const g = h('div', 'sg-lo-glyph', c, a.glyph);
        g.dataset.kind = a.kind;
        const body = h('div', 'sg-lo-body', c);
        h('div', 'sg-lo-name', body, a.name);
        const tags = h('div', 'sg-lo-tags', body);
        const mismatch = a.weapon !== 'any' && a.weapon !== weapon;
        h('span', 'sg-tag' + (mismatch ? ' bad' : ''), tags, a.weapon === 'any' ? 'Any weapon' : mismatch ? `${a.weapon === 'blade' ? 'Blade' : 'Bow'} only` : a.weapon === 'blade' ? 'Blade' : 'Bow');
        h('span', 'sg-tag', tags, `${a.cooldown}s`);
        h('div', 'sg-lo-desc', body, a.desc);
        const badge = h('div', 'sg-lo-slot', c);
        if (mismatch) c.classList.add('mismatch');
        c.addEventListener('click', () => {
          const i = chosen.indexOf(a.id);
          if (i >= 0) chosen.splice(i, 1);
          else if (chosen.length < 5) chosen.push(a.id);
          else count.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 240 });
          refresh();
        });
        return { a, c, badge };
      });
      const refresh = () => {
        for (const { a, c, badge } of cards) {
          const i = chosen.indexOf(a.id);
          c.classList.toggle('sel', i >= 0);
          badge.textContent = i >= 0 ? String(i + 1) : '';
        }
        count.textContent = `${chosen.length} / 5 chosen`;
        ok.classList.toggle('disabled', chosen.length !== 5);
      };
      const done = (ids: string[]) => { off(); this.close(root); resolve(ids); };
      ok.addEventListener('click', () => { if (chosen.length === 5) done(chosen.slice()); });
      cancel.addEventListener('click', () => done(current.slice()));
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('loadout', (e) => {
        if (e.code === 'Escape' || e.code === 'KeyL') done(current.slice());
        else if (e.code === 'Enter' && chosen.length === 5) done(chosen.slice());
        return true;
      });
      refresh();
      this.show(root);
    });
  }

  // ───────────── end screen ─────────────
  endScreen(kind: 'victory' | 'defeat', lines: string[], buttons: string[]): Promise<number> {
    return new Promise((resolve) => {
      const root = h('div', 'sg-end sg-ctl ' + kind, this.layer);
      const box = h('div', 'sg-end-box', root);
      h('div', 'sg-end-title', box, kind === 'victory' ? 'Victory' : 'Defeated');
      h('div', 'sg-end-rule', box);
      for (const l of lines) h('div', 'sg-end-line', box, l);
      const row = h('div', 'sg-end-btns', box);
      const btns = (buttons.length ? buttons : ['Continue']).map((b, i) => {
        const el = h('div', 'sg-btn' + (i === 0 ? ' sg-btn-gold' : ''), row, b);
        el.addEventListener('click', () => done(i));
        return el;
      });
      const done = (i: number) => { off(); this.close(root); resolve(i); };
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('end', (e) => {
        if (e.code === 'Enter') done(0);
        const d = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (d && +d[1] <= btns.length) done(+d[1] - 1);
        return true;
      });
      this.show(root);
    });
  }

  // ───────────── fade ─────────────
  fade(toOpaque: boolean, color = '#000', seconds = 0.8): Promise<void> {
    const el = this.fadeEl;
    el.style.background = color;
    const from = getComputedStyle(el).opacity;
    const to = toOpaque ? '1' : '0';
    el.getAnimations().forEach((a) => a.cancel());
    el.style.opacity = to;
    el.style.pointerEvents = toOpaque ? 'auto' : 'none';
    if (seconds <= 0) return Promise.resolve();
    const anim = el.animate([{ opacity: from }, { opacity: to }], { duration: seconds * 1000, easing: 'ease-in-out' });
    return anim.finished.then(() => undefined, () => undefined);
  }
}
