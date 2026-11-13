// Loot feedback and the level-up moment. A kill's drops come as one small card ("+ Wickthread Hood" in its tier
// colour, "+12 gold", "Bag full: sold for 40 gold"), stacked at the edge of the screen and never over the middle of
// the fight; a named weapon gets a gold glow and stays longer. A level-up shows a short banner with what the level
// gave, and at a talent level a button that opens Talents (or says where to go to choose).
import type { LevelShow, LootShow } from '../core/gearViews';
import { h } from './dom';

export class LootToasts {
  private box: HTMLElement;
  constructor(layer: HTMLElement) { this.box = h('div', 'sg-loot', layer); }
  show(l: LootShow): void {
    if (!l.items.length && l.gold <= 0 && l.soldFor <= 0) return;
    const named = l.items.some((i) => i.named);
    const el = h('div', 'sg-lt' + (named ? ' named' : ''), this.box);
    if (l.items[0]) el.style.setProperty('--rc', l.items[0].colour);
    for (const i of l.items) { const r = h('div', 'sg-lt-i', el, `+ ${i.name}`); r.style.setProperty('--rc', i.colour); }
    if (l.gold > 0) { const g = h('div', 'sg-lt-g', el); h('i', 'sg-coin', g); g.append(`+${l.gold} gold`); }
    if (l.soldFor > 0) h('div', 'sg-lt-s', el, `Bag full: sold for ${l.soldFor} gold`);
    while (this.box.children.length > 3) this.box.firstElementChild?.remove();
    const ms = named ? 6000 : l.items.length ? 3800 : 2400;
    const a = el.animate([
      { opacity: 0, transform: 'translateY(10px) scale(.94)' }, { opacity: 1, transform: 'none', offset: 0.06 },
      { opacity: 1, transform: 'none', offset: 0.88 }, { opacity: 0, transform: 'translateY(-6px)' },
    ], { duration: ms, easing: 'ease-out' });
    if (named) el.animate([{ filter: 'brightness(2.2)' }, { filter: 'brightness(1)' }], { duration: 900, easing: 'ease-out' });
    a.finished.then(() => el.remove(), () => el.remove());
  }
  clear(): void { this.box.textContent = ''; }
}

export class LevelBanner {
  private el: HTMLElement | null = null;
  private anim: Animation | null = null;
  constructor(private layer: HTMLElement) {}
  show(l: LevelShow, onTalent: () => void): void {
    this.anim?.cancel();
    this.el?.remove();
    const el = h('div', 'sg-lvl', this.layer);
    h('div', 'sg-lvl-rays', el);
    h('div', 'sg-lvl-k', el, l.jobName);
    h('div', 'sg-lvl-t', el, `Level ${l.level}`);
    h('div', 'sg-lvl-g', el, l.gains);
    if (l.talent) {
      const row = h('div', 'sg-lvl-row', el);
      if (l.talent.ok) {
        const b = h('button', 'sg-gs-btn gold', row, `New talent row · Choose`) as HTMLButtonElement;
        b.type = 'button';
        b.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('click', () => { this.hide(); onTalent(); });
      } else h('div', 'sg-lvl-w', row, `New talent row open. ${l.talent.why ?? ''}`.trim());
    }
    this.el = el;
    const ms = l.talent ? 7000 : 4200;
    this.anim = el.animate([
      { opacity: 0, transform: 'translateX(-50%) translateY(14px) scale(.9)' }, { opacity: 1, transform: 'translateX(-50%) scale(1.04)', offset: 0.07 },
      { opacity: 1, transform: 'translateX(-50%) scale(1)', offset: 0.12 }, { opacity: 1, transform: 'translateX(-50%)', offset: 0.88 },
      { opacity: 0, transform: 'translateX(-50%) translateY(-8px)' },
    ], { duration: ms, easing: 'ease-out' });
    this.anim.finished.then(() => { if (this.el === el) this.hide(); }, () => {});
  }
  hide(): void { this.anim?.cancel(); this.anim = null; this.el?.remove(); this.el = null; }
}
