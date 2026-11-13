// Modal overlays: dialogue, title screen, loadout picker, end screen, fade.
import type { JobId } from '@sg2/shared';
import type { AbilityDef, DialogueOpts, EndScreenOpts, JobBoardView, JournalAnswer, JournalView, PartyAction, PartySheetView } from '../core/contracts';
import { openJournal } from './journal';
import { openPartySheet } from './party';
import { h } from './dom';
import { abilityMeta, openJobBoard } from './jobs';
import { Sheets } from './sheets';
import type { CharSheetHandle, CharSheetView, CharTab, SheetAct, SheetHandle, VendorView } from '../core/gearViews';
import { openCharSheet } from './bag';
import { openVendor } from './vendor';

type KeyHandler = (e: KeyboardEvent) => boolean;

export class Overlays {
  /** The top-most modal's key handler (null when nothing modal is open). */
  private handlers: KeyHandler[] = [];
  private dlgChain: Promise<unknown> = Promise.resolve();
  /** Bumped by closeDialogue: dialogues queued before it resolve -1 without showing. */
  private dlgGen = 0;
  /** Closes the dialogue on screen (it resolves -1), if any. */
  private dlgClose: (() => void) | null = null;
  private fadeEl: HTMLElement;
  /** The open job board and picks chooser (closeSheets closes them). */
  readonly sheets = new Sheets();
  constructor(private layer: HTMLElement, private setModal: (kind: string, on: boolean) => void, private isTouch: () => boolean) {
    this.fadeEl = h('div', 'sg-fade', layer);
  }
  get active(): boolean { return this.handlers.length > 0; }
  handleKey(e: KeyboardEvent): boolean {
    const hd = this.handlers[this.handlers.length - 1];
    return hd ? hd(e) : false;
  }
  /**
   * A modal that draws itself outside this layer (the creator): while held, the game's keys wait (the HUD's
   * keyboard handler sees `active`) and the HUD hides as for any sheet. Returns the release (call it once).
   */
  hold(kind: string): () => void { return this.push(kind, () => false); }
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
  dialogue(speaker: string, lines: string[], choices?: string[], opts: DialogueOpts = {}): Promise<number> {
    const gen = this.dlgGen;
    const run = this.dlgChain.then(() => (gen !== this.dlgGen ? -1 : this.runDialogue(speaker, lines.length ? lines : [''], choices ?? [], opts)));
    this.dlgChain = run.catch(() => 0);
    return run;
  }
  /** Closes the open dialogue (it resolves -1) and every one queued behind it. */
  closeDialogue(): void {
    this.dlgGen++;
    this.dlgClose?.();
  }
  private runDialogue(speaker: string, lines: string[], choices: string[], opts: DialogueOpts): Promise<number> {
    return new Promise((resolve) => {
      // a closable dialogue (Plan 6) is a bottom sheet: only the panel takes taps, the world above it stays live
      const root = h('div', 'sg-dlg sg-ctl' + (opts.closable ? ' sg-dlg-sheet' : ''), this.layer);
      const panel = h('div', 'sg-dlg-panel', root);
      // "Nell Thistlewood, the road-keeper": the name, with what they are in smaller type
      const comma = opts.closable ? speaker.indexOf(', ') : -1;
      const name = h('div', 'sg-dlg-name', panel, comma > 0 ? speaker.slice(0, comma) : speaker);
      if (comma > 0) h('span', 'sg-dlg-role', name, speaker.slice(comma + 2));
      name.hidden = !speaker;
      if (!speaker) root.classList.add('sg-dlg-narration');
      if (opts.closable) {
        const x = h('button', 'sg-dlg-x', panel);
        x.type = 'button';
        x.setAttribute('aria-label', 'Close');
        x.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';
        x.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); finish(-1); });
      }
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
      let li = Math.max(0, Math.min(lines.length - 1, Math.floor(opts.start ?? 0))), chars = 0, typing = false, raf = 0, last = 0, sel = 0, finished = false, shownAt = 0;
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
        opts.onPage?.(li);
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
        if (this.dlgClose === closeMe) this.dlgClose = null;
        off();
        this.close(root);
        resolve(i);
      };
      const closeMe = () => finish(-1);
      this.dlgClose = closeMe;
      // the sheet: the panel advances (the whole of it is the tap target); the backdrop stays the world's
      (opts.closable ? panel : root).addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); advance(); });
      const off = this.push('dialogue', (e) => {
        const k = e.code;
        if (choiceEls.length) {
          if (k === 'ArrowDown' || k === 'KeyS') setSel((sel + 1) % choiceEls.length);
          else if (k === 'ArrowUp' || k === 'KeyW') setSel((sel + choiceEls.length - 1) % choiceEls.length);
          else if (k === 'Enter' || k === 'Space' || k === 'KeyE' || k === 'NumpadEnter') finish(sel);
          else if (k === 'Escape' && opts.closable) finish(-1);
          else { const d = /^(?:Digit|Numpad)([1-9])$/.exec(k); if (d && +d[1] <= choiceEls.length) finish(+d[1] - 1); else return false; }
          return true;
        }
        if (k === 'Enter' || k === 'Space' || k === 'KeyE' || k === 'NumpadEnter') { if (!e.repeat) advance(); return true; }
        if (k === 'Escape' && opts.closable) { finish(-1); return true; }
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
        : [['WASD', 'move'], ['Drag', 'look around'], ['E', 'talk'], ['Click', 'walk & talk'], ['Wheel', 'zoom'], ['O', 'settings']];
      for (const [k, v] of items) { const s = h('span', '', hint); h('b', '', s, k); s.append(' ' + v); }
      const go = () => { off(); this.close(root); resolve(); };
      play.addEventListener('click', go);
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('title', (e) => { if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') { go(); return true; } return true; });
      this.show(root);
    });
  }

  // ───────────── loadout ─────────────
  loadout(pool: AbilityDef[], current: string[], title: string, count = 5): Promise<string[]> {
    return new Promise((resolve) => {
      const chosen = current.filter((id) => pool.some((a) => a.id === id)).slice(0, count);
      const root = h('div', 'sg-modal sg-ctl', this.layer);
      const panel = h('div', 'sg-panel sg-loadout', root);
      const head = h('div', 'sg-panel-head', panel);
      h('div', 'sg-panel-title', head, `${title} · Picks`);
      h('div', 'sg-panel-sub', head, `Choose ${count === 5 ? 'five' : count === 2 ? 'two' : count} abilities for buttons ${count === 2 ? '4 and 5' : '1–5'}`);
      const grid = h('div', 'sg-lo-grid', panel);
      const foot = h('div', 'sg-panel-foot', panel);
      const countEl = h('div', 'sg-lo-count', foot);
      const cancel = h('div', 'sg-btn', foot, 'Cancel');
      const ok = h('div', 'sg-btn sg-btn-gold', foot, 'Confirm');
      const cards = pool.map((a) => {
        const c = h('div', 'sg-lo-card', grid);
        const g = h('div', 'sg-lo-glyph', c, a.glyph);
        g.dataset.kind = a.kind;
        const body = h('div', 'sg-lo-body', c);
        h('div', 'sg-lo-name', body, a.name);
        h('div', 'sg-lo-meta', body, abilityMeta(a));
        h('div', 'sg-lo-desc', body, a.desc);
        const badge = h('div', 'sg-lo-slot', c);
        c.addEventListener('click', () => {
          const i = chosen.indexOf(a.id);
          if (i >= 0) chosen.splice(i, 1);
          else if (chosen.length < count) chosen.push(a.id);
          else countEl.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 240 });
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
        countEl.textContent = `${chosen.length} / ${count} chosen`;
        ok.classList.toggle('disabled', chosen.length !== count);
      };
      let answered = false;
      const done = (ids: string[]) => { if (answered) return; answered = true; this.sheets.remove('loadout', cancelIt); off(); this.close(root); resolve(ids); };
      const cancelIt = () => done(current.slice());
      ok.addEventListener('click', () => { if (chosen.length === count) done(chosen.slice()); });
      cancel.addEventListener('click', () => done(current.slice()));
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('loadout', (e) => {
        if (e.code === 'Escape' || e.code === 'KeyL') done(current.slice());
        else if (e.code === 'Enter' && chosen.length === count) done(chosen.slice());
        return true;
      });
      refresh();
      this.sheets.add('loadout', cancelIt);
      this.show(root);
    });
  }

  // ───────────── job board ─────────────
  jobs(view: JobBoardView): Promise<JobId | 'talents' | null> {
    let closer: () => void = () => {};
    const p = openJobBoard(this.layer, view, (kind, keys) => this.push(kind, keys), (el) => this.show(el), (el) => this.close(el), (c) => { closer = c; this.sheets.add('jobs', c); });
    return p.finally(() => this.sheets.remove('jobs', closer));
  }

  // ───────────── journal (Plan 6) ─────────────
  journal(view: JournalView): Promise<JournalAnswer | null> {
    let closer: () => void = () => {};
    const p = openJournal(this.layer, view, (kind, keys) => this.push(kind, keys), (el) => this.show(el), (el) => this.close(el), (c) => { closer = c; this.sheets.add('journal', c); });
    return p.finally(() => this.sheets.remove('journal', closer));
  }

  // ───────────── party sheet ─────────────
  partySheet(view: PartySheetView): Promise<PartyAction | null> {
    let closer: () => void = () => {};
    const p = openPartySheet(this.layer, view, (kind, keys) => this.push(kind, keys), (el) => this.show(el), (el) => this.close(el), (c) => { closer = c; this.sheets.add('party', c); });
    return p.finally(() => this.sheets.remove('party', closer));
  }

  // ───────────── Plan 5: the character sheet and the stall sheets (closeSheets closes them) ─────────────
  charSheet(view: CharSheetView, tab: CharTab, onAct: (a: SheetAct) => void, onClosed: () => void): CharSheetHandle {
    let handle: CharSheetHandle | null = null;
    const closer = () => handle?.close();
    handle = openCharSheet(this.layer, view, tab, onAct, () => { this.sheets.remove('charsheet', closer); onClosed(); }, this.sheetDeps());
    this.sheets.add('charsheet', closer);
    return handle;
  }
  vendor(view: VendorView, onAct: (a: SheetAct) => void, onClosed: () => void): SheetHandle {
    let handle: SheetHandle | null = null;
    const closer = () => handle?.close();
    handle = openVendor(this.layer, view, onAct, () => { this.sheets.remove('vendor', closer); onClosed(); }, this.sheetDeps());
    this.sheets.add('vendor', closer);
    return handle;
  }
  private sheetDeps() {
    return { push: (kind: string, keys: KeyHandler) => this.push(kind, keys), show: (el: HTMLElement) => this.show(el), close: (el: HTMLElement) => this.close(el) };
  }

  // ───────────── end screen ─────────────
  private endDone: ((i: number) => void) | null = null;
  endScreen(kind: 'victory' | 'defeat', lines: string[], buttons: string[], opts: EndScreenOpts = {}): Promise<number> {
    this.endDone?.(-1); // one end screen at a time
    return new Promise((resolve) => {
      const root = h('div', 'sg-end sg-ctl ' + kind, this.layer);
      const box = h('div', 'sg-end-box', root);
      h('div', 'sg-end-title', box, opts.title ?? (kind === 'victory' ? 'Victory' : 'Defeated'));
      h('div', 'sg-end-rule', box);
      for (const l of lines) h('div', 'sg-end-line', box, l);
      const row = h('div', 'sg-end-btns', box);
      const t0 = performance.now();
      let awake = !(opts.waitS && opts.waitS > 0);
      const btns = (buttons.length ? buttons : ['Continue']).map((b, i) => {
        const el = h('div', 'sg-btn sg-end-btn' + (i === 0 ? ' sg-btn-gold' : '') + (awake ? '' : ' waiting'), row, b);
        el.addEventListener('click', () => { if (awake) done(i); });
        return el;
      });
      const cd = opts.countdown ? h('div', 'sg-end-count', box) : null;
      let timer = 0;
      const tick = () => {
        const el = (performance.now() - t0) / 1000;
        if (!awake && el >= (opts.waitS ?? 0)) { awake = true; for (const b of btns) b.classList.remove('waiting'); }
        if (cd && opts.countdown) {
          const left = Math.max(0, Math.ceil(opts.countdown.seconds - el));
          const t = left === 0 && opts.countdown.doneText ? opts.countdown.doneText : opts.countdown.text.replace('{s}', String(left));
          if (cd.textContent !== t) cd.textContent = t;
        }
      };
      tick();
      timer = window.setInterval(tick, 200);
      const done = (i: number) => { if (this.endDone !== done) return; this.endDone = null; clearInterval(timer); off(); this.close(root); resolve(i); };
      this.endDone = done;
      root.addEventListener('pointerdown', (e) => e.stopPropagation());
      const off = this.push('end', (e) => {
        if (!awake) return true;
        if (e.code === 'Enter') done(0);
        const d = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
        if (d && +d[1] <= btns.length) done(+d[1] - 1);
        return true;
      });
      this.show(root);
    });
  }
  /** Closes the end screen, if one is open (it resolves with -1). */
  dismissEndScreen(): void { this.endDone?.(-1); }
  /** Closes the job board and the picks chooser, if open (they resolve as cancelled). */
  closeSheets(): void { this.sheets.closeAll(); }

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
