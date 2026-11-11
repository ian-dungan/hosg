// Shady Grove 2: Windward — HUD. Plain DOM + CSS (injected), no Babylon.
import type { CreateHud, HudApi, HudEvent, HudState } from '../core/contracts';
import { injectStyles } from './style';
import { h, toggle, ICONS } from './dom';
import { PlayerFrame, TargetFrame, PartyFrames } from './frames';
import { AbilityBar } from './abilities';
import { Joystick } from './joystick';
import { QuestTracker } from './quest';
import { FloatText } from './float';
import { Overlays } from './overlays';

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
  const bossSlot = h('div', 'sg-bossslot', combat);
  const target = new TargetFrame(combat, bossSlot, () => emit({ type: 'clearTarget' }));
  const quest = new QuestTracker(combat);
  const abar = new AbilityBar(combat, emit);

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
  const floats = new FloatText(fx);
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

  // ── safety: no callouts / context menus / text selection on controls ──
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  root.addEventListener('selectstart', (e) => e.preventDefault());
  root.addEventListener('dblclick', (e) => e.preventDefault());

  // ── keyboard ──
  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlays.active) { if (overlays.handleKey(e)) e.preventDefault(); return; }
    const c = e.code;
    const d = /^(?:Digit|Numpad)([1-5])$/.exec(c);
    if (d) { if (!e.repeat) { const i = +d[1] - 1; abar.flash(i); abar.press(i); } e.preventDefault(); return; }
    if (e.repeat) return;
    if (c === 'KeyE') { if (promptCache) prompt.animate([{ filter: 'brightness(1.5)' }, { filter: 'none' }], { duration: 200 }); emit({ type: 'interact' }); }
    else if (c === 'KeyQ') { abar.flash('swap'); emit({ type: 'swapWeapon' }); }
    else if (c === 'KeyL') { abar.flash('loadout'); emit({ type: 'openLoadout' }); }
    else if (c === 'Escape') emit({ type: 'clearTarget' });
    else return;
    e.preventDefault();
  });

  const cache = { boss: false, combat: false, hasParty: false };

  const api: HudApi = {
    render(s: HudState) {
      player.update(s.player);
      const mode = target.update(s.target);
      const boss = mode === 2;
      if (boss !== cache.boss) { cache.boss = boss; toggle(root, 'sg-has-boss', boss); }
      const hasT = mode === 1;
      toggle(root, 'sg-has-target', hasT);
      party.update(s.party);
      quest.update(s.quest);
      abar.update(s.slots, s.player.weapon);
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
    loadout: (pool, current, weapon) => overlays.loadout(pool, current, weapon),
    endScreen: (kind, lines, buttons) => overlays.endScreen(kind, lines, buttons),
    fade: (toOpaque, color, seconds) => overlays.fade(toOpaque, color, seconds),
    setVisible(on) { toggle(root, 'sg-hidden', !on); if (!on) joy.reset(); },
  };
  return api;
};
