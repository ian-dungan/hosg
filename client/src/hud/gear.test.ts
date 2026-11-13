// The gear screens without a DOM (the repo has no jsdom): the CSS rules that make them phone-first, and the views
// they draw (a real browser measures the laid-out sheets on dev/gear.html; see the Task 10 report).
import { describe, expect, it } from 'vitest';
import { COSTUMES, ITEMS, applyInvOp, inventoryView, newInventory, newJobsSave, totalTo, type InvCtx, type InvOp, type InvState, type JobId } from '@sg2/shared';
import { GEAR_CSS } from './gearStyle';
import { charSheetView, ctxFor, vendorView } from '../net/inventory';

/** The declarations of the first rule whose selector list contains `sel`. */
const CSS = GEAR_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
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

describe('phone-first CSS', () => {
  it('bag tiles are 64 px', () => {
    expect(px(rule('.sg-tile'), 'width')).toBe(64);
    expect(px(rule('.sg-tile'), 'height')).toBe(64);
  });
  it('every control is at least 48 px', () => {
    for (const sel of ['.sg-gs-btn', '.sg-gs-tab', '.sg-filter', '.sg-dchip']) expect(px(rule(sel), 'min-height'), sel).toBeGreaterThanOrEqual(48);
    for (const sel of ['.sg-gs-x', '.sg-char-btn', '.sg-swatch']) {
      expect(px(rule(sel), 'width'), sel).toBeGreaterThanOrEqual(48);
      expect(px(rule(sel), 'height'), sel).toBeGreaterThanOrEqual(48);
    }
    expect(px(rule('.sg-tc'), 'min-height')).toBeGreaterThanOrEqual(48);
    expect(px(rule('.sg-switchrow'), 'min-height')).toBeGreaterThanOrEqual(48);
  });
  it('no text under 14 px', () => {
    const sizes = [...CSS.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(20);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(14);
  });
  it('sheets are full-screen on phones (portrait and landscape) and a 420 px panel on desktop; they scroll inside', () => {
    expect(px(rule('.sg-gs-panel'), 'width')).toBe(420);
    expect(GEAR_CSS).toMatch(/@media \(max-width:700px\),\(max-height:500px\)\{\s*\.sg-gs\{padding:0;background:none\}\s*\.sg-gs-panel\{width:100%/);
    expect(rule('.sg-gs-body')).toMatch(/overflow:auto/);
    expect(rule('.sg-gs-body')).toMatch(/min-height:0/);
    expect(rule('.sg-card')).toMatch(/overflow:auto/);
  });
  it('portrait loot toasts sit above the joystick zone (33vh) on the left, clear of the ability cluster', () => {
    const m = /@media \(max-width:700px\) and \(orientation:portrait\)\{\s*\/\*[^*]*\*\/\s*\.sg-loot\{([^}]*)\}/.exec(GEAR_CSS);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/left:/);
    const vh = /bottom:calc\(var\(--sb\) \+ (\d+)vh\)/.exec(m![1]!);
    expect(Number(vh![1])).toBeGreaterThanOrEqual(34);
  });
});

/** A server-made view (the shared rules) for `job` at `level`, after `ops`. */
function made(job: JobId, level: number, ops: [InvOp, Partial<InvCtx>?][] = [], gold = 1000) {
  const jobs = newJobsSave(job);
  jobs.jobs[job]!.xp = totalTo(level);
  let s: InvState = { inv: newInventory([0, 0]), gold, seals: 0, jobs };
  let n = 0;
  for (const [op, c] of ops) {
    const r = applyInvOp(s, { ...op, id: `testop${String(++n).padStart(8, '0')}` } as InvOp, { stall: null, jobSwitch: true, townBoard: true, inCombat: false, dead: false, busy: false, ...c });
    if ('refusal' in r) throw new Error(r.refusal);
    s = r.state;
  }
  const jv = { current: job, jobs: { [job]: { level, xp: totalTo(level), next: 0, picks: s.jobs.jobs[job]!.picks, talents: s.jobs.jobs[job]!.talents, outfit: s.jobs.jobs[job]!.outfit } } } as never;
  return { view: inventoryView(s), ctx: (x = 3, z = -6) => ctxFor(jv, { zone: 'grove', x, z, inCombat: false, dead: false, busy: false, sealed: false }) };
}

describe('the sheets draw what the views say', () => {
  it('a bag item\'s card carries the comparison with the current job\'s piece', () => {
    const m = made('warrior', 5, [[{ op: 'buy', stall: 'smithy', item: 'thornrunner_hands' }, { stall: 'smithy' }]]);
    const v = charSheetView(m.view, m.ctx());
    const gloves = v.bag.find((i) => i.item === 'thornrunner_hands')!;
    expect(gloves.equip).toMatchObject({ slot: 'hands', ok: true, why: null });
    expect(gloves.equip!.cmp!.replaces).toBe(ITEMS.plain_hands.name);
    expect(gloves.equip!.cmp!.lines.map((l) => l.key)).toContain('defence');
  });
  it('locked talent rows cannot be chosen: a level 1 adventurer has no open rows and no badge', () => {
    const v = charSheetView(made('ninja', 1).view, made('ninja', 1).ctx());
    expect(v.talents.rows.every((r) => !r.unlocked)).toBe(true);
    expect(v.openRows).toBe(0);
    const v4 = charSheetView(made('ninja', 4).view, made('ninja', 4).ctx());
    expect(v4.talents.rows.map((r) => r.unlocked)).toEqual([true, false, false]);
    expect(v4.openRows).toBe(1);
  });
  it('vendor prices and Owned states come from the data and the inventory', () => {
    const at = { x: 0, z: 0 };
    const m = made('paladin', 3, [[{ op: 'buyCostume', costume: 'orchard_smock' }, { stall: 'tailor' }]], 400);
    const t = vendorView('tailor', m.view, m.ctx(), at);
    expect(t.here).toBe(false);
    const smock = t.costumes.find((c) => c.id === 'orchard_smock')!;
    expect(smock).toMatchObject({ owned: true, why: 'Owned' });
    const finery = t.costumes.find((c) => c.id === 'solstice_finery')!;
    expect(finery.price).toBe(COSTUMES.solstice_finery.price);
    expect(finery.why).toBe(`Need ${COSTUMES.solstice_finery.price! - 100} more gold`);
  });
  it('the Vault tab exists only at the Vault', () => {
    const m = made('ranger', 2);
    expect(charSheetView(m.view, m.ctx()).vault).toBeNull();
    // the Vault's spot (shared TOWN_STALLS) gives the tab and its 60 slots
    const vv = charSheetView(m.view, m.ctx(15 * Math.cos((270 * Math.PI) / 180), 15 * Math.sin((270 * Math.PI) / 180)));
    expect(vv.vault).toEqual([]);
    expect(vv.vaultSlots).toBe(60);
  });
});
