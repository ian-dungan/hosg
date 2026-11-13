import { describe, expect, it } from 'vitest';
import { LOOK_LIMITS, PEOPLES, defaultLook, parseLook, prng, randomLook, validateAdventurerName, type Look } from '@sg2/shared';
import { CreatorState, UNDO_DEPTH, controlsFor, getPath, swatchesFrom, type CreatorStateOpts } from './creatorState';
import { creatorLayout } from './creatorLayout';

const look = (): Look => parseLook({ ...defaultLook('acct-1'), people: 'human', fur: null, face: { ...defaultLook('acct-1').face, ears: 1 } })!;
const opts = (o: Partial<CreatorStateOpts> = {}): CreatorStateOpts => ({ look: look(), mode: 'create', needsName: false, gold: 0, free: true, validateName: validateAdventurerName, ...o });

describe('CreatorState', () => {
  it('lists the tabs, the Name tab only when a name is needed', () => {
    expect(new CreatorState(opts()).tabs).toEqual(['people', 'body', 'face', 'hair', 'colours', 'style', 'outfit']);
    expect(new CreatorState(opts({ needsName: true })).tabs.at(-1)).toBe('name');
  });

  it('every look field has a control on some tab (nothing is left out of the creator)', () => {
    const s = new CreatorState(opts());
    s.setPeople('brindlekin');
    const paths = new Set<string>();
    for (const t of s.tabs) for (const c of controlsFor(t, s.look)) if ('path' in c) paths.add(c.path);
    for (const p of Object.keys(LOOK_LIMITS)) expect(paths.has(p), p).toBe(true);
  });

  it('Undo restores each earlier look, and remembers only the last 20 changes', () => {
    const s = new CreatorState(opts());
    const start = s.look;
    expect(s.set('body.height', 3)).toBe(true);
    expect(s.set('hair.style', 7)).toBe(true);
    expect(getPath(s.look, 'hair.style')).toBe(7);
    expect(s.undo()).toBe(true);
    expect(getPath(s.look, 'hair.style')).toBe(start.hair.style);
    expect(getPath(s.look, 'body.height')).toBe(3);
    expect(s.undo()).toBe(true);
    expect(s.look).toEqual(start);
    expect(s.undo()).toBe(false);
    for (let i = 0; i < 30; i++) s.set('body.build', i % 2 ? 0 : 20);
    expect(s.undoDepth).toBe(UNDO_DEPTH);
  });

  it('clamps values into range and never makes an impossible look', () => {
    const s = new CreatorState(opts());
    s.set('body.height', 99);
    expect(getPath(s.look, 'body.height')).toBe(20);
    expect(s.set('face.ears', 5)).toBe(true); // a Human's ears stop at 3
    expect(getPath(s.look, 'face.ears')).toBe(3);
    expect(s.set('fur.tail', 2)).toBe(false); // no fur on a Human
    expect(parseLook(s.look)).not.toBeNull();
  });

  it('a new people gets or loses fur and keeps its ears in range; Surprise me keeps the people', () => {
    const s = new CreatorState(opts());
    s.set('face.ears', 3);
    expect(s.setPeople('brindlekin')).toBe(true);
    expect(s.look.fur).not.toBeNull();
    s.set('face.ears', 5);
    expect(s.setPeople('knollfolk')).toBe(true);
    expect(s.look.fur).toBeNull();
    expect(s.look.face.ears).toBeLessThanOrEqual(PEOPLES.knollfolk.earsMax);
    expect(parseLook(s.look)).not.toBeNull();
    expect(s.randomise(randomLook, prng(5))).toBe(true);
    expect(s.look.people).toBe('knollfolk');
  });

  it('pickers wrap round both ways', () => {
    const s = new CreatorState(opts());
    s.set('face.shape', 0);
    s.step('face.shape', -1);
    expect(getPath(s.look, 'face.shape')).toBe(5);
    s.step('face.shape', 1);
    expect(getPath(s.look, 'face.shape')).toBe(0);
  });

  it('shows the name error live, and Done is blocked until the name is good', () => {
    const s = new CreatorState(opts({ needsName: true }));
    expect(s.nameError).toBe('Choose a name for your adventurer');
    s.name = 'ab';
    expect(s.nameError).toBe(validateAdventurerName('ab'));
    expect(s.blocker).toBe(s.nameError);
    s.name = 'Bramblewick';
    expect(s.nameError).toBeNull();
    expect(s.blocker).toBeNull();
    expect(s.result()).toEqual({ look: s.look, name: 'Bramblewick' });
  });

  it('Done resolves the look; the Barber shows its price, or free on the free visit', () => {
    const c = new CreatorState(opts());
    expect(c.doneLabel).toBe('Done');
    expect(c.result()).toEqual({ look: c.look });
    const b = new CreatorState(opts({ mode: 'barber', free: false, gold: 100 }));
    expect(b.doneLabel).toBe('No change');
    b.set('hair.style', (b.look.hair.style + 1) % 20);
    expect(b.cost).toBe(40);
    expect(b.doneLabel).toBe('Change look — 40 gold');
    b.setPeople('larchfolk');
    expect(b.doneLabel).toBe('Change look — 200 gold');
    expect(b.blocker).toBe('You need 200 gold (you have 100)');
    const f = new CreatorState(opts({ mode: 'barber', free: true, gold: 0 }));
    f.setPeople('larchfolk');
    expect(f.doneLabel).toBe('Change look — free');
    expect(f.cost).toBe(0);
    expect(f.blocker).toBeNull();
  });

  it('offers twelve suggested swatches per colour, from the people ranges', () => {
    expect(swatchesFrom(PEOPLES.human.skinRange)).toHaveLength(12);
    const s = new CreatorState(opts());
    for (const c of controlsFor('colours', s.look)) if (c.kind === 'colour') expect(c.swatches).toHaveLength(12);
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
      if (h > w) expect(L.preview.h).toBeCloseTo(h * 0.45, 0);
    });
  }
});

describe('the creator overlay', () => {
  it('takes pointer events itself: the HUD root it sits in has none, so Done was unclickable (Plan 4 Task 10 live check)', async () => {
    const { CREATOR_CSS } = await import('./creator');
    expect(CREATOR_CSS).toMatch(/\.sg-cr\{[^}]*pointer-events:auto/);
  });
});

describe('the creator opened again after a refused name (live check: "That name is taken" never showed)', () => {
  const base = (o: Partial<CreatorStateOpts> = {}): CreatorStateOpts => ({ look: defaultLook('x'), mode: 'create', needsName: true, gold: 0, free: true, validateName: validateAdventurerName, ...o });
  it('keeps the name it was given, starts on the Name tab and shows the notice until something changes', () => {
    const s = new CreatorState(base({ name: 'Brambleton' }));
    expect(s.name).toBe('Brambleton');
    expect(s.startTab('That name is taken')).toBe('name');
    expect(s.noteLine('name', 'That name is taken')).toBe('That name is taken');
    expect(s.noteLine('people', 'That name is taken')).toBe('That name is taken');
    s.name = 'Brambletown';
    expect(s.noteLine('name', 'That name is taken')).toBe('');
  });
  it('without a notice: the blocker as before (and nothing on the Name tab, where the field says it)', () => {
    const s = new CreatorState(base());
    expect(s.startTab(undefined)).toBe('people');
    expect(s.noteLine('people', undefined)).toBe('Choose a name for your adventurer');
    expect(s.noteLine('name', undefined)).toBe('');
    const g = new CreatorState(base({ needsName: false }));
    expect(g.startTab('Something went wrong')).toBe('people');
    expect(g.noteLine('people', 'Something went wrong')).toBe('Something went wrong');
  });
});
