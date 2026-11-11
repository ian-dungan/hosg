// The online login screen: name and password, Play / Create account / Play as guest, and an inline error.
// Styled like the HUD's title screen (it reuses the HUD's buttons and colours).
import { h } from '../hud/dom';
import { login } from './session';

const CSS = /* css */ `
.sg-login{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow-y:auto;pointer-events:auto;
  padding:calc(var(--st) + 16px) calc(var(--sr) + 16px) calc(var(--sb) + 16px) calc(var(--sl) + 16px);
  background:radial-gradient(ellipse 50% 40% at 50% 50%,rgba(24,18,56,.4),transparent 100%),
    linear-gradient(180deg,rgba(23,84,209,.18) 0%,rgba(30,24,70,.3) 45%,rgba(18,14,40,.75) 100%);
  opacity:0;transition:opacity .35s ease}
.sg-login.in{opacity:1}
.sg-login-box{display:flex;flex-direction:column;align-items:stretch;width:min(360px,100%);margin:auto}
.sg-login .sg-title-name{text-align:center;font-size:clamp(34px,10vw,64px)}
.sg-login-sub{margin:8px 0 22px;text-align:center;font:italic 400 16px var(--serif);color:rgba(255,246,230,.95)}
.sg-login-form{display:flex;flex-direction:column;gap:10px;padding:18px;border-radius:18px;
  background:linear-gradient(180deg,rgba(26,30,64,.82),rgba(16,18,42,.9));
  box-shadow:0 0 0 1px rgba(255,214,140,.32),0 12px 40px rgba(10,10,40,.4)}
.sg-login-form label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600;color:var(--goldl)}
.sg-login-form input{min-height:46px;padding:0 14px;border:0;border-radius:12px;outline:none;
  font:500 17px var(--sans);color:var(--cream);background:rgba(255,246,230,.1);box-shadow:inset 0 0 0 1.5px rgba(255,226,160,.35);
  -webkit-user-select:text;user-select:text}
.sg-login-form input:focus{box-shadow:inset 0 0 0 2px var(--gold2)}
.sg-login-err{min-height:1.3em;font-size:14px;font-weight:600;color:#ffb3a3;text-align:center}
.sg-login-err:empty{min-height:0}
.sg-login-row{display:flex;gap:10px}
.sg-login-row .sg-btn{flex:1;min-width:0;padding:0 12px}
.sg-login-guest{margin-top:2px}
.sg-login.busy .sg-btn{opacity:.55;pointer-events:none}
@media (max-height:500px){
  .sg-login .sg-title-name{font-size:36px}
  .sg-login-sub{margin:4px 0 10px}
  .sg-login-form{gap:7px;padding:12px}
  .sg-login-form input{min-height:40px}
}
`;

function injectStyles(): void {
  if (document.getElementById('sg-net-login-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-net-login-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Shows the login screen over `root` until an account is signed in. `notice` is shown as the error line (e.g. why you were sent back here). */
export function showLogin(root: HTMLElement, notice = ''): Promise<{ token: string; name: string }> {
  injectStyles();
  return new Promise((resolve) => {
    const wrap = h('div', 'sg-hud', root);
    const screen = h('div', 'sg-login', wrap);
    const box = h('div', 'sg-login-box', screen);
    h('div', 'sg-title-name', box, 'Shady Grove 2');
    h('div', 'sg-login-sub', box, 'Adventurers gather in the Plaza of the Two');
    const form = h('form', 'sg-login-form', box);
    form.noValidate = true;
    const nameLabel = h('label', '', form, 'Name');
    const name = h('input', '', nameLabel);
    Object.assign(name, { type: 'text', name: 'username', autocomplete: 'username', maxLength: 16, spellcheck: false });
    name.setAttribute('autocapitalize', 'off');
    const passLabel = h('label', '', form, 'Password');
    const pass = h('input', '', passLabel);
    Object.assign(pass, { type: 'password', name: 'password', autocomplete: 'current-password', maxLength: 72 });
    const err = h('div', 'sg-login-err', form, notice);
    err.setAttribute('role', 'alert');
    const row = h('div', 'sg-login-row', form);
    const play = h('button', 'sg-btn sg-btn-gold', row, 'Play');
    play.type = 'submit';
    const create = h('button', 'sg-btn', row, 'Create account');
    create.type = 'button';
    const guest = h('button', 'sg-btn sg-login-guest', form, 'Play as guest');
    guest.type = 'button';

    let busy = false;
    const attempt = async (kind: 'register' | 'login' | 'guest') => {
      if (busy) return;
      busy = true;
      screen.classList.add('busy');
      err.textContent = '';
      try {
        const session = kind === 'guest' ? await login('guest') : await login(kind, name.value.trim(), pass.value);
        (document.activeElement as HTMLElement | null)?.blur?.();
        screen.classList.remove('in');
        window.setTimeout(() => wrap.remove(), 350);
        resolve(session);
      } catch (e) {
        err.textContent = e instanceof Error ? e.message : String(e);
        busy = false;
        screen.classList.remove('busy');
      }
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); void attempt('login'); });
    create.addEventListener('click', () => void attempt('register'));
    guest.addEventListener('click', () => void attempt('guest'));
    // Keys typed here belong to the form, not the game.
    screen.addEventListener('keydown', (e) => e.stopPropagation());
    requestAnimationFrame(() => requestAnimationFrame(() => screen.classList.add('in')));
  });
}
