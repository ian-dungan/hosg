// Shady Grove 2 — HUD. Plain DOM + CSS (injected), no Babylon.
import type { CreateHud, HudApi, HudEvent, HudState } from '../core/contracts';
import { injectStyles } from './style';
import { h, toggle, ICONS } from './dom';
import { PlayerFrame, TargetFrame, PartyFrames, FocusFrame } from './frames';
import { AbilityBar } from './abilities';
import { Joystick } from './joystick';
import { QuestTracker } from './quest';
import { FloatText } from './float';
import { Overlays } from './overlays';
import { Settings } from './settings';
import { createDoubleTap } from '../combat/doubleTap';

/** Movement keys as a screen-space direction (x right, y up), for a dodge. */
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};

export const createHud: CreateHud = (host: HTMLElement): HudApi => {
  injectStyles();
  const listeners: ((e: HudEvent) => void)[] = [];
  const emit = (e: HudEvent) => { for (const l of listeners) l(e); };

  const root = h('div', 'sg-hud', host);
  // layers (DOM order = paint order)
  const combat = h('div', 'sg-combat', root);
  const fx = h('div', 'sg-fx', root);
  const modal = h('div', 'sg-modals', root);

  // ── input mode ──
  const coarse = window.matchMedia('(pointer: coarse)');
  const fine = window.matchMedia('(pointer: fine)');
  let touch = coarse.matches || (navigator.maxTouchPoints > 0 && !fine.matches);
  const setTouch = (on: boolean) => {
    touch = on;
    toggle(root, 'sg-touch', on);
    toggle(root, 'sg-desktop', !on);
  };
  setTouch(touch);
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touch) setTouch(true);
    else if (e.pointerType === 'mouse' && touch && !coarse.matches) setTouch(false);
  }, { capture: true, passive: true });

  // ── combat layer ──
  const joy = new Joystick(combat);
  const tl = h('div', 'sg-tl', combat);
  const castSlot = h('div', 'sg-castslot', combat);
  const player = new PlayerFrame(tl, castSlot);
  const party = new PartyFrames(tl);
  const ally = new FocusFrame(tl, () => emit({ type: 'clearAlly' }), () => emit({ type: 'interact' }));
  const bossSlot = h('div', 'sg-bossslot', combat);
  const target = new TargetFrame(combat, bossSlot, () => emit({ type: 'clearTarget' }));
  const quest = new QuestTracker(combat);
  // the movement keys held now (a Shift dodge goes that way) and double taps of one of them
  const held = new Set<string>();
  const taps = createDoubleTap();
  const keyDir = (): { x: number; y: number } | null => {
    let x = 0, y = 0;
    for (const k of held) { const v = MOVE_KEYS[k]; if (v) { x += v[0]; y += v[1]; } }
    return x || y ? { x, y } : null;
  };
  const dodgeDir = () => (touch ? (() => { const j = joy.value(); return Math.hypot(j.x, j.y) > 0.2 ? j : null; })() : keyDir());
  const abar = new AbilityBar(combat, emit, dodgeDir);
  joy.onFlick = (dir) => { abar.flash('dodge'); emit({ type: 'dodge', dir }); };

  const promptRow = h('div', 'sg-promptrow', combat);
  const prompt = h('div', 'sg-prompt sg-ctl', promptRow);
  const pKey = h('span', 'sg-prompt-key', prompt);
  pKey.innerHTML = '<b>E</b>' + ICONS.talk;
  const pText = h('span', 'sg-prompt-text', prompt);
  let promptCache: string | null = null;
  prompt.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    prompt.animate([{ transform: 'scale(.93)' }, { transform: 'scale(1)' }], { duration: 180 });
    emit({ type: 'interact' });
  });

  // ── fx layer: floats, banner, toasts ──
  // numbers start below the frames at the top (a heal on the adventurer never covers the target's bar)
  const floats = new FloatText(fx, () => [player.el, target.el, bossSlot]);
  // the red screen edge sits under the controls (they stay readable while it pulses)
  const danger = h('div', 'sg-danger', null);
  const hurtFlash = h('div', 'sg-danger', null);
  root.insertBefore(hurtFlash, combat);
  root.insertBefore(danger, hurtFlash);
  const banner = h('div', 'sg-banner', fx);
  const bKick = h('div', 'sg-banner-kicker', banner);
  const bTitle = h('div', 'sg-banner-title', banner);
  const bRule = h('div', 'sg-banner-rule', banner);
  h('i', '', bRule);
  let bannerAnim: Animation | null = null;
  const toasts = h('div', 'sg-toasts', fx);

  // ── overlays ──
  const modalKinds = new Set<string>();
  const overlays = new Overlays(modal, (kind, on) => {
    if (on) modalKinds.add(kind); else modalKinds.delete(kind);
    toggle(root, 'sg-modal-open', modalKinds.size > 0);
    toggle(root, 'sg-dialogue-open', modalKinds.has('dialogue'));
    if (on) joy.reset();
  }, () => touch);

  // ── settings: gear in the combat layer (hidden with it), panel above everything ──
  const settings = new Settings(combat, root);

  // ── safety: no callouts / context menus / text selection on controls ──
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('selectstart', (e) => e.preventDefault());
  root.addEventListener('dblclick', (e) => e.preventDefault());

  // ── keyboard ──
  /** Ability digits held down (slot indices). */
  const heldDigits = new Set<number>();
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlays.active) { if (overlays.handleKey(e)) e.preventDefault(); return; }
    const c = e.code;
    if (settings.open) {
      if ((c === 'KeyO' || c === 'Escape') && !e.repeat) { settings.close(); e.preventDefault(); }
      return;
    }
    const d = /^(?:Digit|Numpad)([1-5])$/.exec(c);
    if (d) { if (!e.repeat) { const i = +d[1] - 1; heldDigits.add(i); abar.flash(i); abar.press(i); } e.preventDefault(); return; }
    if (MOVE_KEYS[c]) {
      held.add(c);
      if (taps.down(c, performance.now(), e.repeat)) { const v = MOVE_KEYS[c]; abar.flash('dodge'); emit({ type: 'dodge', dir: { x: v[0], y: v[1] } }); }
      return; // the rig moves on these
    }
    if (e.repeat) { if (c === 'Tab') e.preventDefault(); return; }
    if (c === 'ShiftLeft' || c === 'ShiftRight') { abar.flash('dodge'); emit({ type: 'dodge', dir: keyDir() }); return; }
    if (c === 'Tab') { e.preventDefault(); emit({ type: 'cycleTarget' }); return; }
    if (c === 'KeyE') { if (promptCache) prompt.animate([{ filter: 'brightness(1.5)' }, { filter: 'none' }], { duration: 200 }); emit({ type: 'interact' }); }
    else if (c === 'KeyJ') { abar.flash('jobs'); emit({ type: 'openJobs' }); }
    else if (c === 'KeyL') { abar.flash('loadout'); emit({ type: 'openLoadout' }); }
    else if (c === 'KeyF') emit({ type: 'cycleAlly' });
    else if (c === 'KeyO') settings.toggle();
    else if (c === 'Escape') emit({ type: 'clearTarget' });
    else return;
    e.preventDefault();
  });

  window.addEventListener('keyup', (e) => {
    held.delete(e.code);
    const d = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (d) { heldDigits.delete(+d[1] - 1); emit({ type: 'abilityUp', slot: +d[1] - 1 }); }
  });
  // a held 1–5 whose keyup the page never gets (the window lost focus): released, so a Charged Shot is loosed
  window.addEventListener('blur', () => {
    held.clear(); taps.reset();
    for (const slot of heldDigits) emit({ type: 'abilityUp', slot });
    heldDigits.clear();
  });

  const cache = { boss: false, combat: false, hasParty: false };

  const api: HudApi = {
    settings: settings.values,
    render(s: HudState) {
      player.update(s.player);
      const mode = target.update(s.target);
      const boss = mode === 2;
      if (boss !== cache.boss) { cache.boss = boss; toggle(root, 'sg-has-boss', boss); }
      const hasT = mode === 1;
      toggle(root, 'sg-has-target', hasT);
      party.update(s.party);
      ally.update(s.ally ?? null);
      ally.prompt(s.ally ? s.prompt : null);
      toggle(root, 'sg-has-ally', !!s.ally);
      quest.update(s.quest);
      abar.update(s.slots, s.player);
      toggle(root, 'sg-no-abilities', s.slots.length === 0);
      if (s.inCombat !== cache.combat) { cache.combat = s.inCombat; toggle(root, 'sg-in-combat', s.inCombat); }
      if (s.prompt !== promptCache) {
        const was = promptCache;
        promptCache = s.prompt;
        if (s.prompt) {
          pText.textContent = s.prompt;
          if (!was) prompt.animate([{ opacity: 0, transform: 'translateY(10px) scale(.9)' }, { opacity: 1, transform: 'scale(1.04)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }], { duration: 320, easing: 'ease-out' });
        }
        toggle(prompt, 'on', !!s.prompt);
      }
    },
    on(cb) { listeners.push(cb); },
    joystick() { return touch ? joy.value() : { x: 0, y: 0 }; },
    banner(title, subtitle) {
      bTitle.textContent = title;
      bKick.textContent = subtitle;
      bKick.hidden = !subtitle;
      bannerAnim?.cancel();
      bannerAnim = banner.animate([
        { opacity: 0, transform: 'translateY(10px)', letterSpacing: '0.04em' },
        { opacity: 1, transform: 'none', letterSpacing: '0.01em', offset: 0.14 },
        { opacity: 1, transform: 'none', offset: 0.82 },
        { opacity: 0, transform: 'translateY(-6px)' },
      ], { duration: 4600, easing: 'ease-out' });
      bRule.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)', offset: 0.25 }, { transform: 'scaleX(1)' }], { duration: 4600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    },
    toast(text) {
      const el = h('div', 'sg-toast', toasts, text);
      while (toasts.children.length > 3) toasts.firstElementChild?.remove();
      const a = el.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.96)' }, { opacity: 1, transform: 'none', offset: 0.1 },
        { opacity: 1, transform: 'none', offset: 0.85 }, { opacity: 0, transform: 'translateY(-6px)' },
      ], { duration: 2600, easing: 'ease-out' });
      a.finished.then(() => el.remove(), () => el.remove());
    },
    floatText(x, y, text, kind) { floats.spawn(x, y, text, kind); },
    dialogue: (speaker, lines, choices) => overlays.dialogue(speaker, lines, choices),
    titleScreen: () => overlays.titleScreen(),
    loadout: (pool, current, title, count) => overlays.loadout(pool, current, title, count),
    jobs: (view) => overlays.jobs(view),
    endScreen: (kind, lines, buttons, opts) => overlays.endScreen(kind, lines, buttons, opts),
    dismissEndScreen: () => overlays.dismissEndScreen(),
    danger(mode) {
      if (mode === 'flash') hurtFlash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 600, easing: 'ease-out' });
      else toggle(danger, 'on', mode === 'on');
    },
    fade: (toOpaque, color, seconds) => overlays.fade(toOpaque, color, seconds),
    setVisible(on) { toggle(root, 'sg-hidden', !on); if (!on) { joy.reset(); settings.close(); } },
  };
  return api;
};
