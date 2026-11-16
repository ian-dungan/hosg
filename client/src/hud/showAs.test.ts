// Show-as CSS stays phone first (no DOM in the repo: the rules themselves; dev/gear.html measures the laid-out sheets).
import { describe, expect, it } from 'vitest';
import { LOOK_CSS } from './showAsStyle';

const CSS = LOOK_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
function rule(sel: string): string {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(CSS))) if (m[1]!.split(',').map((x) => x.trim()).includes(sel)) return m[2]!;
  throw new Error(`no rule for ${sel}`);
}
const px = (decls: string, prop: string): number => {
  const m = new RegExp(`(?:^|;)\\s*${prop}:\\s*(\\d+(?:\\.\\d+)?)px`).exec(decls);
  return m ? Number(m[1]) : NaN;
};

describe('show-as CSS', () => {
  it('every control is at least 48 px', () => {
    for (const sel of ['.sg-lbar .sg-gs-btn', '.sg-lpart', '.sg-lcell']) expect(px(rule(sel), 'min-height'), sel).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-lrow-look'), 'min-height')).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-lrow-look'), 'min-width')).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-lrow'), 'min-height')).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-tpiece'), 'min-height')).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-orow-top'), 'min-height')).toBeGreaterThanOrEqual(48);
  });
  it('no text under 14 px', () => {
    const sizes = [...CSS.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(8);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });
  it('the rows never push the sheet sideways; the looks grid and dye rows scroll inside', () => {
    expect(rule('.sg-lrows')).toMatch(/minmax\(0,1fr\)/);
    expect(rule('.sg-lgrid')).toMatch(/overflow-y:auto/);
    expect(rule('.sg-ldye')).toMatch(/overflow-x:auto/);
  });
});
