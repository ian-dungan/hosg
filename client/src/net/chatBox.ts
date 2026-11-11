// Zone chat: the last lines in a corner, and a line to type in.
// Desktop: Enter opens the line and sends, Escape closes it. Touch: the Chat button opens it.
import { CHAT_MAX } from '@sg2/shared';
import { h } from '../hud/dom';

/** Lines kept on screen. */
const MAX_LINES = 50;

const CSS = /* css */ `
.sg-chat-log{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g) + 58px);
  width:min(440px,calc(100% - 2 * var(--g)));max-height:min(36vh,230px);overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-end;gap:2px;font-size:14px;line-height:1.35}
.sg-chat-line{padding:2px 9px;border-radius:8px;background:rgba(16,18,42,.42);align-self:flex-start;max-width:100%;overflow-wrap:anywhere;
  -webkit-user-select:text;user-select:text}
.sg-chat-from{font-weight:700;color:var(--goldl)}
.sg-chat-bar{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g));display:none;gap:8px;
  width:min(440px,calc(100% - 2 * var(--g)));pointer-events:auto}
.sg-chat-open .sg-chat-bar{display:flex}
.sg-chat-input{flex:1;min-width:0;min-height:44px;padding:0 14px;border:0;border-radius:12px;outline:none;
  font:500 16px var(--sans);color:var(--cream);background:rgba(16,18,42,.78);box-shadow:inset 0 0 0 2px var(--gold2);
  -webkit-user-select:text;user-select:text}
.sg-chat-send{min-width:0;min-height:44px;padding:0 16px}
.sg-chat-hint{position:absolute;left:calc(var(--sl) + var(--g));bottom:calc(var(--sb) + var(--g) + 12px);font-size:12px;opacity:.75}
.sg-chat-open .sg-chat-hint{display:none}
.sg-chat-btn{position:absolute;right:calc(var(--sr) + var(--g));top:calc(var(--st) + var(--g) + 30px);min-width:0;min-height:44px;padding:0 18px;
  pointer-events:auto;background:rgba(16,18,42,.55)}
/* touch: the log sits under the name plate, the typing line at the top, clear of the joystick and the keyboard */
.sg-chat-touch .sg-chat-log{bottom:auto;top:calc(var(--st) + var(--g) + 76px);max-height:min(26vh,160px);width:min(360px,calc(62% - var(--g)))}
.sg-chat-touch .sg-chat-bar{bottom:auto;top:calc(var(--st) + var(--g));width:calc(100% - 2 * var(--g))}
.sg-chat-touch .sg-chat-hint{display:none}
.sg-chat:not(.sg-chat-touch) .sg-chat-btn,.sg-chat-open .sg-chat-btn{display:none}
.sg-chat:not(.sg-chat-touch) .sg-chat-send{display:none}
`;

function injectStyles(): void {
  if (document.getElementById('sg-net-chat-css')) return;
  const s = document.createElement('style');
  s.id = 'sg-net-chat-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export interface ChatBox {
  add(from: string, text: string): void;
}

export function createChat(root: HTMLElement, send: (text: string) => void): ChatBox {
  injectStyles();
  const touch = matchMedia('(pointer: coarse)').matches;
  const wrap = h('div', 'sg-hud sg-chat' + (touch ? ' sg-chat-touch' : ''), root);
  const log = h('div', 'sg-chat-log', wrap);
  log.setAttribute('aria-live', 'polite');
  h('div', 'sg-chat-hint', wrap, 'Enter to chat');
  const bar = h('form', 'sg-chat-bar', wrap);
  const input = h('input', 'sg-chat-input', bar);
  Object.assign(input, { type: 'text', maxLength: CHAT_MAX, placeholder: 'Say something to everyone here', autocomplete: 'off', enterKeyHint: 'send' });
  const sendBtn = h('button', 'sg-btn sg-btn-gold sg-chat-send', bar, 'Send');
  sendBtn.type = 'submit';
  const open = h('button', 'sg-btn sg-chat-btn', wrap, 'Chat');
  open.type = 'button';

  const setOpen = (on: boolean) => {
    wrap.classList.toggle('sg-chat-open', on);
    if (on) input.focus();
    else { input.value = ''; input.blur(); }
  };
  bar.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text) send(text);
    setOpen(false);
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typed keys never reach the game
    if (e.key === 'Escape') setOpen(false);
  });
  input.addEventListener('blur', () => { if (!input.value.trim()) wrap.classList.remove('sg-chat-open'); });
  open.addEventListener('click', () => setOpen(!wrap.classList.contains('sg-chat-open')));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target === input || !wrap.isConnected) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
    e.preventDefault();
    setOpen(true);
  });

  return {
    add(from, text) {
      const line = h('div', 'sg-chat-line', log);
      h('span', 'sg-chat-from', line, from);
      line.append(': ' + text);
      while (log.childElementCount > MAX_LINES) log.firstElementChild?.remove();
    },
  };
}
