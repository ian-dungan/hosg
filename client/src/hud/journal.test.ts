// The journal's, pointer's and moment's pure parts. (No DOM in this test environment: jsdom is not installed and
// cannot be; the layout rules, 48 px controls and 14 px text are checked in a browser at 390×844, 844×390,
// 768×1024, 1280×800, 360×740, 320×568 and 1600×900 — see the Task 6 report.)
import { describe, expect, it } from 'vitest';
import { confirmText, tabLabels, timesText } from './journal';
import { POINTER_SIZE, pointerLayout } from './questPointer';
import { rewardChips } from './questMoment';

describe('journal', () => {
  it('a skip confirm says plainly that it gives no reward; a drop says the progress is lost', () => {
    expect(confirmText('skip', 'The Solstice Crossing').line).toMatch(/no reward/);
    expect(confirmText('abandon', 'Bristle Bounty')).toEqual({ line: 'Drop Bristle Bounty? Its progress is lost. You can take it again later.', yes: 'Drop quest', no: 'Keep it' });
  });
  it('tabs carry their counts; times read as words', () => {
    expect(tabLabels({ active: [], offers: [{} as never], done: [{} as never, {} as never] })).toEqual({ active: 'Active 0', offers: 'Offers 1', done: 'Done 2' });
    expect(timesText(1)).toBe('Done once');
    expect(timesText(4)).toBe('Done 4 times');
  });
});

describe('quest pointer layout', () => {
  it('on screen it sits on the target; off screen it clamps to the edge (48 px chip inside) and points that way', () => {
    expect(pointerLayout(200, 300, true, 390, 844, [])).toMatchObject({ x: 200, y: 300, onScreen: true });
    const right = pointerLayout(900, 422, true, 390, 844, []);
    expect(right.onScreen).toBe(false);
    expect(right.x).toBeLessThanOrEqual(390 - POINTER_SIZE / 2);
    expect(Math.abs(right.angle)).toBeLessThan(0.01);
    // behind the camera: mirrored (a target behind and to the right points left)
    expect(pointerLayout(900, 422, false, 390, 844, []).x).toBeLessThan(195);
  });
  it('slides out of the controls (an exclusion on the right edge)', () => {
    const ex = [{ x0: 250, y0: 300, x1: 390, y1: 600 }];
    const p = pointerLayout(900, 422, true, 390, 844, ex);
    expect(p.y < 300 - POINTER_SIZE / 2 || p.y > 600 + POINTER_SIZE / 2).toBe(true);
  });
});

describe('completion moment', () => {
  it('reward chips in order, none for a step that pays nothing', () => {
    expect(rewardChips({ xp: 40, gold: 40, item: 'Thornrunner Jerkin' })).toEqual(['+40 xp', '+40 gold', 'Thornrunner Jerkin']);
    expect(rewardChips({ xp: 0, gold: 0, item: null })).toEqual([]);
  });
});
