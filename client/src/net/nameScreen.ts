// The online name screen: shown once, after signing in, to an account whose adventurer has no name yet.
// One field with a live hint of the rules, and an inline error; styled like the login screen.
import { validateAdventurerName } from '@sg2/shared';
import { h } from '../hud/dom';
import { injectLoginStyles } from './loginScreen';

const RULES = '3 to 16 letters. Spaces, hyphens and apostrophes only between letters.';
const GOOD = 'Names are for good, so pick one you like.';

const CSS = /* css */ `
.sg-name .sg-title-name{font-size:clamp(28px,7.5vw,46px);line-height:1.1;white-space:normal}
.sg-name-hint{font-size:13px;font-weight:500;line-height:1.35;color:rgba(255,246,230,.75)}
.sg-name-hint.bad{color:#ffd9a0}
@media (max-height:500px){.sg-name .sg-title-name{font-size:30px}}
`;

function injectStyles(): void {
  injectLoginStyles();
  if (document.getElementById('sg-net-name-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-net-name-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** What the player typed, as it is sent: trimmed, with phone keyboards' curly apostrophes made straight. */
function cleaned(value: string): string {
  return value.replace(/[‘’ʼ]/g, "'").trim();
}

/** Thrown by a name screen's `submit` to close the screen: showNameScreen then rejects with it. */
export class LeaveNameScreen extends Error {}

/**
 * Shows the name screen over `root` until `submit` accepts a name; resolves with the name `submit`
 * resolves with. When `submit` throws, its message is shown and the player can try again, except
 * for a LeaveNameScreen, which closes the screen and rejects with it.
 */
export function showNameScreen(root: HTMLElement, submit: (name: string) => Promise<string>): Promise<string> {
  injectStyles();
  return new Promise((resolve, reject) => {
    const wrap = h('div', 'sg-hud', root);
    const screen = h('div', 'sg-login sg-name', wrap);
    const box = h('div', 'sg-login-box', screen);
    h('div', 'sg-title-name', box, 'Name your adventurer');
    h('div', 'sg-login-sub', box, 'The whole grove will know you by it');
    const form = h('form', 'sg-login-form', box);
    form.noValidate = true;
    const label = h('label', '', form, 'Adventurer name');
    const field = h('input', '', label);
    Object.assign(field, { type: 'text', name: 'adventurer-name', autocomplete: 'off', maxLength: 16, spellcheck: false });
    field.setAttribute('autocapitalize', 'words');
    field.setAttribute('aria-describedby', 'sg-name-hint');
    const hint = h('div', 'sg-name-hint', form, RULES);
    hint.id = 'sg-name-hint';
    const err = h('div', 'sg-login-err', form);
    err.setAttribute('role', 'alert');
    const enter = h('button', 'sg-btn sg-btn-gold', form, 'Enter Shady Grove');
    enter.type = 'submit';

    const showHint = () => {
      const name = cleaned(field.value);
      const problem = name === '' ? null : validateAdventurerName(name);
      hint.textContent = name === '' ? RULES : problem ?? GOOD;
      hint.classList.toggle('bad', problem !== null);
    };

    let busy = false;
    const attempt = async () => {
      if (busy) return;
      const name = cleaned(field.value);
      const problem = validateAdventurerName(name);
      if (problem) {
        hint.textContent = problem; // shown where the rules are, not twice
        hint.classList.add('bad');
        field.focus();
        return;
      }
      busy = true;
      screen.classList.add('busy');
      err.textContent = '';
      const close = () => {
        (document.activeElement as HTMLElement | null)?.blur?.();
        screen.classList.remove('in');
        window.setTimeout(() => wrap.remove(), 350);
      };
      try {
        const chosen = await submit(name);
        close();
        resolve(chosen);
      } catch (e) {
        if (e instanceof LeaveNameScreen) {
          close();
          reject(e);
          return;
        }
        err.textContent = e instanceof Error ? e.message : String(e);
        busy = false;
        screen.classList.remove('busy');
      }
    };
    field.addEventListener('input', () => {
      showHint();
      err.textContent = '';
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); void attempt(); });
    // Keys typed here belong to the form, not the game.
    screen.addEventListener('keydown', (e) => e.stopPropagation());
    requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add('in')));
  });
}
