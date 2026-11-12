// Tiny DOM helpers for the HUD (no framework).

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, parent?: HTMLElement | null, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** Toggle a class only when the wanted state differs from the cached one. */
export function toggle(e: HTMLElement, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

export const ICONS = {
  blade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4l-9.5 9.5"/><path d="M20 4h-3.5l-9 9M20 4v3.5l-9 9"/><path d="M6 13l5 5"/><path d="M8.5 15.5L4 20"/></svg>',
  bow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3c9 2.5 9 15.5 0 18"/><path d="M7 3v18" stroke-width="1.2"/><path d="M4 12h15M16 9l3 3-3 3"/></svg>',
  sword: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4l-8 8"/><path d="M20 4h-3l-7 7M20 4v3l-7 7"/><path d="M8 12l4 4"/><path d="M9.5 14.5L7 17"/><path d="M4 10c0 5 2 8 5 10c-3-1-5-3-5-10z"/></svg>',
  greatsword: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3l-11 11"/><path d="M21 3h-4l-10 10M21 3v4l-10 10"/><path d="M5.5 12.5l6 6"/><path d="M8.5 15.5L3.5 20.5"/></svg>',
  daggers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4c3 2 6 5 8 9"/><path d="M19 4c-3 2-6 5-8 9"/><path d="M10 15l-4 4M14 15l4 4"/><path d="M8.5 13.5l2 2M15.5 13.5l-2 2"/></svg>',
  staff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 21L15 9"/><path d="M17 3l2.5 3-2.5 4-2.5-3z"/><circle cx="17" cy="6.5" r="5" stroke-width="1.2"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a8 8 0 0 1 14-3l2 2"/><path d="M20 4v4h-4"/><path d="M20 15a8 8 0 0 1-14 3l-2-2"/><path d="M4 20v-4h4"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  talk: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H10l-5 4v-4H4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01" stroke-width="2.8"/></svg>',
};
