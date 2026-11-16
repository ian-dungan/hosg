import { describe, expect, it } from 'vitest';
import { BARBER_BODY_PRICE, BARBER_PEOPLE_PRICE, BARBER_PRICE, LOOK_LIMITS, LOOK_OPTIONAL_COLOURS, LOOK_PRESETS, LUMA_MIN, PEOPLES, defaultLook, encodeLook, lookLuma, parseLook, prng, randomLook, validateAdventurerName, type Look } from '@sg2/shared';
import { CreatorState, UNDO_DEPTH, controlsFor, getPath, swatchesFrom, type CreatorStateOpts } from './creatorState';
import { PREVIEW_TOOLS, creatorLayout, previewToolsLayout } from './creatorLayout';

const look = (): Look => LOOK_PRESETS.find((p) => p.id === 'harbour_pilot')!.look;
const opts = (o: Partial<CreatorStateOpts> = {}): CreatorStateOpts => ({ look: look(), mode: 'create', needsName: false, gold: 0, free: true, validateName: validateAdventurerName, ...o });

describe('CreatorState', () => {
  it('lists the tabs (Start … Marks, Style), the Name tab only when a name is needed', () => {
    expect(new CreatorState(opts()).tabs).toEqual(['start', 'body', 'head', 'eyes', 'brows', 'nose', 'mouth', 'ears', 'skin', 'hair', 'facial', 'marks', 'style']);
    expect(new CreatorState(opts({ needsName: true })).tabs.at(-1)).toBe('name');
  });

  it('every look field has a control on some tab (nothing is left out of the creator), for a furred people too', () => {
    for (const people of ['human', 'brindlekin'] as const) {
      const s = new CreatorState(opts());
      s.setPeople(people);
      const paths = new Set<string>();
      for (const t of s.tabs) for (const c of controlsFor(t, s.look)) if ('path' in c) paths.add(c.path);
      for (const p of [...Object.keys(LOOK_LIMITS), ...LOOK_OPTIONAL_COLOURS]) {
        if (p.startsWith('fur.') && people === 'human') continue;
        expect(paths.has(p), `${people}: ${p}`).toBe(true);
      }
    }
  });

  it('Undo and Redo walk the changes; a new change clears Redo; Undo remembers the last 50', () => {
    const s = new CreatorState(opts());
    const start = s.look;
    expect(s.set('build.height', 3)).toBe(true);
    expect(s.set('hair.style', 7)).toBe(true);
    expect(s.undo()).toBe(true);
    expect(getPath(s.look, 'hair.style')).toBe(start.hair.style);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(true);
    expect(getPath(s.look, 'hair.style')).toBe(7);
    expect(s.undo() && s.undo()).toBe(true);
    expect(s.look).toEqual(start);
    expect(s.undo()).toBe(false);
    s.set('build.weight', 2);
    expect(s.canRedo).toBe(false);
    for (let i = 0; i < 70; i++) s.set('build.weight', i % 2 ? 0 : 20);
    expect(s.undoDepth).toBe(UNDO_DEPTH);
  });

  it('resets a slider to its middle, a choice to how it opened, and a whole tab in one Undo step', () => {
    const s = new CreatorState(opts());
    const height = controlsFor('body', s.look).find((c) => 'path' in c && c.path === 'build.height')!;
    s.set('build.height', 2);
    expect(s.reset(height)).toBe(true);
    expect(getPath(s.look, 'build.height')).toBe(10);
    const was = s.look.eyes.shape;
    s.set('eyes.shape', (was + 3) % 12);
    s.set('eyes.size', 0); s.set('eyes.tilt', 10);
    expect(s.resetTab('eyes')).toBe(true);
    expect(s.look.eyes.shape).toBe(was);
    expect(s.look.eyes.size).toBe(5); expect(s.look.eyes.tilt).toBe(5);
    expect(s.undo()).toBe(true);
    expect(s.look.eyes.size).toBe(0);
  });

  it('Compare shows the look as it opened, without losing the edit', () => {
    const s = new CreatorState(opts());
    s.set('build.weight', 20);
    s.comparing = true;
    expect(s.shown).toEqual(s.original);
    s.comparing = false;
    expect(s.shown.build.weight).toBe(20);
  });

  it('clamps values into range, lightness-clamps free colours, and never makes an impossible look', () => {
    const s = new CreatorState(opts());
    s.set('build.height', 99);
    expect(getPath(s.look, 'build.height')).toBe(20);
    expect(s.set('ears.style', 5)).toBe(true); // a Human's ears stop at 3
    expect(getPath(s.look, 'ears.style')).toBe(3);
    expect(s.set('fur.tail', 2)).toBe(false); // no fur on a Human
    s.set('skin.colour', 0x000000);
    expect(lookLuma(s.look.skin.colour)).toBeGreaterThanOrEqual(LUMA_MIN);
    expect(s.set('eyes.colour2', null)).toBe(false); // already the same
    expect(s.set('eyes.colour2', 0x2f5d8a)).toBe(true);
    expect(s.set('eyes.colour', null)).toBe(false); // not optional
    expect(parseLook(s.look)).not.toBeNull();
  });

  it('a new people gets or loses fur; male and female are a choice; Surprise me keeps both', () => {
    const s = new CreatorState(opts());
    expect(s.setPeople('brindlekin')).toBe(true);
    expect(s.look.fur).not.toBeNull();
    s.set('ears.style', 5);
    expect(s.setPeople('knollfolk')).toBe(true);
    expect(s.look.fur).toBeNull();
    expect(s.look.ears.style).toBeLessThanOrEqual(PEOPLES.knollfolk.earsMax);
    expect(s.setBody('female')).toBe(true);
    expect(s.randomise(randomLook, prng(5))).toBe(true);
    expect([s.look.people, s.look.body]).toEqual(['knollfolk', 'female']);
  });

  it('presets keep the outfit dyes; moles toggle bit by bit', () => {
    const s = new CreatorState(opts());
    s.set('outfit.dye1', 7);
    expect(s.applyPreset('snowpelt')).toBe(true);
    expect(s.look.people).toBe('brindlekin');
    expect(s.look.outfit.dye1).toBe(7);
    const m = s.look.skin.moles;
    s.toggleBit('skin.moles', 2);
    expect(s.look.skin.moles).toBe(m ^ 4);
  });

  it('copies the look as its code and pastes a code back (a bad code is refused with a line)', () => {
    const s = new CreatorState(opts());
    const other = randomLook(prng(9));
    expect(s.pasteCode(encodeLook(other))).toEqual({ ok: true });
    expect({ ...s.look, outfit: other.outfit }).toEqual(other);
    expect(s.code).toBe(encodeLook(s.look));
    expect(s.pasteCode('not a code')).toEqual({ ok: false, error: 'That is not a look code' });
    expect(s.pasteCode('  ')).toEqual({ ok: false, error: 'Paste a look code first' });
  });

  it('pickers wrap round both ways', () => {
    const s = new CreatorState(opts());
    s.set('hair.style', 0);
    s.step('hair.style', -1);
    expect(getPath(s.look, 'hair.style')).toBe(43);
    s.step('hair.style', 1);
    expect(getPath(s.look, 'hair.style')).toBe(0);
  });

  it('shows the name error live, and Done is blocked until the name is good', () => {
    const s = new CreatorState(opts({ needsName: true }));
    expect(s.nameError).toBe('Choose a name for your adventurer');
    s.name = 'ab';
    expect(s.nameError).toBe(validateAdventurerName('ab'));
    expect(s.blocker).toBe(s.nameError);
    s.name = 'Bramblewick';
    expect(s.nameError).toBeNull();
    expect(s.result()).toEqual({ look: s.look, name: 'Bramblewick' });
  });

  it('the Barber: its price, more for a new body or people, nothing unchanged, free on the free visit', () => {
    const c = new CreatorState(opts());
    expect(c.doneLabel).toBe('Done');
    const b = new CreatorState(opts({ mode: 'barber', free: false, gold: 100 }));
    expect(b.doneLabel).toBe('No change');
    b.set('hair.style', (b.look.hair.style + 1) % 44);
    expect(b.cost).toBe(BARBER_PRICE);
    expect(b.doneLabel).toBe(`Change look — ${BARBER_PRICE} gold`);
    b.setBody(b.look.body === 'male' ? 'female' : 'male');
    expect(b.cost).toBe(BARBER_BODY_PRICE);
    b.setPeople('larchfolk');
    expect(b.cost).toBe(BARBER_PEOPLE_PRICE);
    expect(b.blocker).toBe(`You need ${BARBER_PEOPLE_PRICE} gold (you have 100)`);
    const f = new CreatorState(opts({ mode: 'barber', free: true, gold: 0 }));
    f.setPeople('larchfolk');
    expect(f.doneLabel).toBe('Change look — free');
    expect(f.blocker).toBeNull();
  });

  it('offers palette swatches for every colour, and twelve per people range', () => {
    expect(swatchesFrom(PEOPLES.human.skinRange)).toHaveLength(12);
    const s = new CreatorState(opts());
    for (const t of s.tabs) for (const c of controlsFor(t, s.look)) if (c.kind === 'colour') expect(c.swatches.length).toBeGreaterThanOrEqual(8);
  });
});

describe('creatorLayout', () => {
  const overlaps = (a: DOMRectLike, b: DOMRectLike) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  type DOMRectLike = { x: number; y: number; w: number; h: number };
  for (const [w, h] of [[390, 844], [844, 390], [360, 740], [375, 667], [1600, 900]] as const) {
    it(`places the preview and the panel without overlap at ${w}×${h}`, () => {
      const L = creatorLayout(w, h);
      expect(overlaps(L.preview, L.panel)).toBe(false);
      expect(L.panel.w).toBeGreaterThanOrEqual(Math.min(w, 300));
      expect(L.panel.x + L.panel.w).toBeLessThanOrEqual(w);
      expect(L.panel.y + L.panel.h).toBeLessThanOrEqual(h);
      if (w >= 1000) expect(L.panel.w).toBe(420);
      if (h > w) expect(L.preview.h).toBeCloseTo(h * 0.4, 0);
    });
    // live check: the preview's top bar ran together ("Facedo Bodydo Full") on every phone
    it(`lays the preview's camera and history controls out in two groups, none overlapping, at ${w}×${h}`, () => {
      const L = creatorLayout(w, h);
      const T = previewToolsLayout(L.preview.w, L.preview.h);
      expect(T.camera).toHaveLength(3);
      expect(T.history).toHaveLength(3);
      const all = [...T.camera, ...T.history];
      for (const r of all) {
        expect(r.w).toBeGreaterThanOrEqual(48);
        expect(r.h).toBeGreaterThanOrEqual(48);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(L.preview.w);
        expect(r.y + r.h).toBeLessThanOrEqual(L.preview.h);
      }
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i], all[j]), `${i}/${j}`).toBe(false);
      // the two groups stand apart (a clear gap between their boxes)
      const box = (rs: DOMRectLike[]) => {
        const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
        return { x: x - 6, y: y - 6, w: Math.max(...rs.map((r) => r.x + r.w)) - x + 12, h: Math.max(...rs.map((r) => r.y + r.h)) - y + 12 };
      };
      expect(overlaps(box(T.camera), box(T.history))).toBe(false);
    });
  }
  it('every preview control has a short label and an accessible name', () => {
    for (const c of PREVIEW_TOOLS) {
      expect(c.aria.length).toBeGreaterThan(3);
      expect(c.label.length).toBeLessThanOrEqual(7);
    }
  });
});

describe('the creator overlay', () => {
  it('takes pointer events itself: the HUD root it sits in has none, so Done was unclickable (Plan 4 Task 10 live check)', async () => {
    const { CREATOR_CSS } = await import('./creator');
    expect(CREATOR_CSS).toMatch(/\.sg-cr\{[^}]*pointer-events:auto/);
  });
  it('the emote wheel takes pointer events too (live check: its buttons were under the canvas, no emote could be chosen)', async () => {
    const { CREATOR_CSS } = await import('./creator');
    expect(CREATOR_CSS).toMatch(/\.sg-ew\{[^}]*pointer-events:auto/);
  });
});

describe('the creator opened again after a refused name (live check: "That name is taken" never showed)', () => {
  const base = (o: Partial<CreatorStateOpts> = {}): CreatorStateOpts => ({ look: defaultLook('x'), mode: 'create', needsName: true, gold: 0, free: true, validateName: validateAdventurerName, ...o });
  it('keeps the name it was given, starts on the Name tab and shows the notice until something changes', () => {
    const s = new CreatorState(base({ name: 'Brambleton' }));
    expect(s.name).toBe('Brambleton');
    expect(s.startTab('That name is taken')).toBe('name');
    expect(s.noteLine('name', 'That name is taken')).toBe('That name is taken');
    expect(s.noteLine('start', 'That name is taken')).toBe('That name is taken');
    s.name = 'Brambletown';
    expect(s.noteLine('name', 'That name is taken')).toBe('');
  });
  it('without a notice: the blocker as before (and nothing on the Name tab, where the field says it)', () => {
    const s = new CreatorState(base());
    expect(s.startTab(undefined)).toBe('start');
    expect(s.noteLine('start', undefined)).toBe('Choose a name for your adventurer');
    expect(s.noteLine('name', undefined)).toBe('');
    const g = new CreatorState(base({ needsName: false }));
    expect(g.startTab('Something went wrong')).toBe('start');
    expect(g.noteLine('start', 'Something went wrong')).toBe('Something went wrong');
  });
});
