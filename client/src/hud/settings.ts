// Settings: a gear button and a small panel of switches, saved in this browser.
import { h, toggle } from './dom';

const TAP_KEY = 'sg2.tapToWalk';

export interface SettingsValues { tapToWalk: boolean }

function load(): SettingsValues {
  let tap: string | null = null;
  try { tap = localStorage.getItem(TAP_KEY); } catch { /* storage blocked: defaults */ }
  return { tapToWalk: tap !== '0' };
}
function save(v: SettingsValues): void {
  try { localStorage.setItem(TAP_KEY, v.tapToWalk ? '1' : '0'); } catch { /* storage blocked: this visit only */ }
}

const GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>';

/** The gear button (in `buttonParent`) and the Settings panel (in `panelParent`). `values` is live. */
export class Settings {
  readonly values: SettingsValues = load();
  private panel: HTMLElement;
  private gear: HTMLButtonElement;
  private input: HTMLInputElement;
  constructor(buttonParent: HTMLElement, panelParent: HTMLElement) {
    const gear = this.gear = h('button', 'sg-gear sg-ctl', buttonParent);
    gear.type = 'button';
    gear.setAttribute('aria-label', 'Settings');
    gear.setAttribute('aria-expanded', 'false');
    gear.setAttribute('aria-controls', 'sg-settings-card');
    gear.innerHTML = GEAR;
    gear.addEventListener('pointerdown', (e) => e.stopPropagation());
    gear.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

    // the backdrop catches taps so they do not walk the adventurer; tapping it closes the panel
    this.panel = h('div', 'sg-settings sg-ctl', panelParent);
    this.panel.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.target === this.panel) this.close(); });
    const card = h('div', 'sg-settings-card', this.panel);
    card.id = 'sg-settings-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-label', 'Settings');
    const head = h('div', 'sg-settings-head', card);
    h('div', 'sg-settings-title', head, 'Settings');
    const x = h('button', 'sg-settings-close', head);
    x.type = 'button';
    x.setAttribute('aria-label', 'Close settings');
    x.innerHTML = CLOSE;
    x.addEventListener('click', () => this.close());

    const row = h('label', 'sg-switch-row', card);
    const txt = h('span', 'sg-switch-text', row);
    h('span', 'sg-switch-name', txt, 'Tap to walk');
    h('span', 'sg-switch-sub', txt, 'Tap the ground to walk there, or a person to walk over and talk.');
    const input = this.input = h('input', 'sg-switch-input', row);
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.checked = this.values.tapToWalk;
    h('span', 'sg-switch', row);
    input.addEventListener('change', () => { this.values.tapToWalk = input.checked; save(this.values); });
    // the switch keeps focus after a click, and the HUD ignores keys typed into inputs: close from here
    this.panel.addEventListener('keydown', (e) => {
      if ((e.code === 'Escape' || e.code === 'KeyO') && !e.repeat) { e.preventDefault(); e.stopPropagation(); this.close(); }
    });
  }
  get open(): boolean { return this.panel.classList.contains('on'); }
  toggle(): void { if (this.open) this.close(); else this.show(); }
  private show(): void {
    toggle(this.panel, 'on', true);
    this.gear.setAttribute('aria-expanded', 'true');
    this.input.focus({ preventScroll: true });
  }
  close(): void {
    if (!this.open) return;
    toggle(this.panel, 'on', false);
    this.gear.setAttribute('aria-expanded', 'false');
    // focus back on the gear (never left on the switch, which would swallow WASD: the game ignores keys typed into inputs)
    if (this.panel.contains(document.activeElement) || document.activeElement === document.body) this.gear.focus({ preventScroll: true });
  }
}
