// Plan 4's bosses and the Warden's add, built in code like the Greenway's enemies (combat/enemies.ts): flat-shaded
// low-poly in PALETTE colours, one rigid-skinned body mesh plus one emissive mesh each, posed procedurally by the
// enemy rig's modes. Every telegraphed attack has its own readable wind-up; each boss phase changes the look:
//   - the Wickhound (the Warden's lamp-hound): a lean brass-and-stone hound, 2.2 m at the shoulder, whose wick-mane
//     still burns; in phase 2 ("Wick Unbound") the mane flares and its cracks glow;
//   - the Fallen Warden: the Beacon lighthouse's keeper, about 4.5 m: a striped stone tower body with brass bands,
//     a cracked lamp-room head, a bent brass lantern-arm and Felix's "F." maker's mark plate on its brass collar.
//     Phase 2 ("The Lamp Kindles") lights a crown of rays and its windows; phase 3 ("The Lens Falls") darkens the
//     head (the lens has fallen) and the light burns from a lens in its chest instead;
//   - the Lens Shard: a floating faceted crystal over a brass socket that turns slowly and sends a thin beam to the
//     Warden while it lives (the ward).
// Only types come from enemies.ts (it imports this module's values): nothing here runs at its load time.
import { hex, mix, tint, type RGB, type V3 } from '../world/mesh';
import { PAL } from '../world/parts';
import { PALETTE } from '../core/contracts';
import type { EnemyKindId } from '@sg2/shared';
import type { KindDef, Model } from './enemies';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const ease = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };
const rise = (t: number, d: number) => { const k = 1 - clamp01(t / d); return 1 - k * k * k; };
const pulse = (t: number, d: number, peak = 0.3) => (t < 0 || t > d ? 0 : t < d * peak ? ease(t / (d * peak)) : 1 - ease((t - d * peak) / (d * (1 - peak))));

const C = {
  stone: hex(PALETTE.stone), stone2: PAL.stone2, plinth: PAL.plinth, plinthDark: PAL.plinthDark, slate: hex('#8d8498'), slateDark: hex('#5f566c'),
  gold: hex(PALETTE.gold), brass: hex('#d49a3a'), brassDark: hex('#9a6a2a'), roof: hex(PALETTE.roof), roof2: PAL.roof2, orange: PAL.roof4,
  cream: hex('#f6ead6'), cloud: hex(PALETTE.cloud), hollow: hex('#1d1426'), rock: hex(PALETTE.rock), lamp: PAL.lamp, horizon: hex(PALETTE.horizon),
  ember: hex('#ff8a3c'), flame: hex('#ffb347'), crystal: hex('#9ff2ea'), timberDark: PAL.woodDark, hstone: hex('#b9a993'), hstoneDark: hex('#7a6a5e'), crystal2: hex('#5fc8d8'), teal: hex(PALETTE.teal), glass: hex('#4a3d5e'),
};

/** A flame tongue: two crossed double-sided triangles from `base` up `h`, `w` wide, leaning by (lx, lz). */
function flame(g: Model['g'], base: V3, h: number, w: number, lx = 0, lz = 0, c0: RGB = C.roof, c1: RGB = C.flame) {
  const tip: V3 = [base[0] + lx, base[1] + h, base[2] + lz];
  g.withHint(null, () => {
    g.tri([base[0] - w / 2, base[1], base[2]], [base[0] + w / 2, base[1], base[2]], tip, c0, c0, c1);
    g.tri([base[0], base[1], base[2] - w / 2], [base[0], base[1], base[2] + w / 2], tip, c0, c0, c1);
  });
}

// ───────────────────────── the Wickhound ─────────────────────────
export const WICKHOUND: KindDef = {
  height: 2.9,
  build(m) {
    m.joint('body', null, [0, 1.95, 0]);
    m.joint('chest', 'body', [0, 2.0, 0.75]);
    m.joint('neck', 'chest', [0, 2.3, 1.2]);
    m.joint('head', 'neck', [0, 2.7, 1.75]);
    m.joint('jaw', 'head', [0, 2.5, 1.95]);
    m.joint('breath', 'jaw', [0, 2.5, 2.45]);
    m.joint('maneA', 'neck', [0, 2.6, 1.3]);
    m.joint('maneB', 'body', [0, 2.45, 0.4]);
    m.joint('maneC', 'body', [0, 2.35, -0.5]);
    m.joint('flare', 'body', [0, 2.5, 0.4]);
    m.joint('cracks', 'body', [0, 1.95, 0]);
    m.joint('tail', 'body', [0, 2.15, -1.35]);
    const legs: [string, string, number, number][] = [['FL', 'chest', -0.5, 0.95], ['FR', 'chest', 0.5, 0.95], ['BL', 'body', -0.48, -0.95], ['BR', 'body', 0.48, -0.95]];
    for (const [n, parent, x, z] of legs) { m.joint('leg' + n, parent, [x, 1.95, z]); m.joint('shin' + n, 'leg' + n, [x * 1.05, 1.0, z + (z > 0 ? 0.12 : -0.18)]); }

    m.on('body', (b) => {
      b.ball([0, 1.98, -0.15], 0.95, C.hstone, 0.62, 0.52, 1.35, 1, 0.22, C.hstoneDark);   // the lean barrel
      b.ball([0, 1.95, -0.85], 0.6, C.hstone, 0.72, 0.7, 0.9, 1, 0.2, C.hstoneDark);       // the haunches
      // brass plates along the back and the wick sockets the mane burns in
      for (let k = 0; k < 4; k++) {
        const z = 0.55 - k * 0.5, y = 2.42 - k * 0.04;
        b.taperBox([0, y - 0.08, z], 0.7, 0.42, [0, y + 0.06, z - 0.02], 0.5, 0.34, C.brass, C.gold);
        b.prism([0, y + 0.05, z], [0, y + 0.18, z], 0.07, 0.05, 5, C.brassDark);
      }
      for (const sx of [-1, 1]) b.ball([sx * 0.42, 1.95, -0.9], 0.34, C.brass, 0.45, 0.8, 0.9, 0, 0.1);  // hip plates
    });
    m.on('cracks', (_b, g) => { // glowing seams in the stone (phase 2)
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
        const z = 0.3 - k * 0.55;
        g.prism([sx * 0.58, 2.2 - k * 0.05, z], [sx * 0.6, 1.75, z - 0.25], 0.035, 0.03, 3, C.ember, { caps: false });
      }
    });
    m.on('chest', (b) => {
      b.ball([0, 2.0, 0.8], 0.78, C.hstone, 0.82, 0.92, 0.8, 1, 0.2, C.hstoneDark);
      b.ball([0, 1.82, 1.12], 0.5, C.brass, 0.95, 0.9, 0.55, 1, 0.15, C.brassDark);    // the brass breastplate
      for (const sx of [-1, 1]) b.ball([sx * 0.55, 2.15, 0.95], 0.36, C.brass, 0.55, 0.9, 0.9, 0, 0.1); // shoulder plates
    });
    m.on('neck', (b) => {
      b.prism([0, 2.2, 1.0], [0, 2.62, 1.62], 0.46, 0.33, 7, C.hstone, { col2: C.hstoneDark });
      b.prism([0, 2.3, 1.18], [0, 2.38, 1.3], 0.5, 0.48, 9, C.gold, { caps: false });   // the collar
      b.box(0, 2.25, 1.55, 0.18, 0.16, 0.06, C.brassDark);                              // its tag
    });
    m.on('head', (b, g) => {
      b.ball([0, 2.78, 1.82], 0.46, C.hstone, 0.85, 0.78, 1.15, 1, 0.2, C.hstoneDark);
      b.prism([0, 2.72, 2.05], [0, 2.6, 2.85], 0.27, 0.14, 6, C.brass, { col2: C.gold });  // the long brass muzzle
      b.ball([0, 2.62, 2.86], 0.11, C.hollow, 1.2, 0.8, 0.7, 0);                           // nose
      b.ball([0, 2.92, 1.98], 0.26, C.brass, 1.3, 0.35, 0.9, 0, 0.1);                      // brow plate
      for (const sx of [-1, 1]) {
        b.prism([sx * 0.22, 2.98, 1.7], [sx * 0.42, 3.38, 1.45], 0.13, 0, 4, C.brass, { col2: C.gold }); // swept ears
        b.ball([sx * 0.24, 2.86, 2.08], 0.12, C.hollow, 1, 0.7, 0.8, 0);
        g.ball([sx * 0.26, 2.87, 2.14], 0.1, C.ember, 1, 0.75, 0.7, 0);                       // ember eyes
      }
    });
    m.on('jaw', (b) => {
      b.prism([0, 2.48, 1.98], [0, 2.46, 2.75], 0.19, 0.1, 6, C.brassDark, { col2: C.brass });
      for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) b.prism([sx * 0.1, 2.52, 2.2 + k * 0.13], [sx * 0.1, 2.64, 2.22 + k * 0.13], 0.028, 0, 3, C.cream);
    });
    m.on('breath', (_b, g) => { g.ball([0, 2.52, 2.5], 0.2, C.flame, 1.2, 0.9, 1.5, 0); for (let k = 0; k < 4; k++) flame(g, [0, 2.45, 2.45 + k * 0.08], 0.4, 0.25, 0, 0.3 + k * 0.1); });
    // the wick-mane: flame tongues in three tufts (they flicker apart)
    const mane = (j: string, z0: number, z1: number, y0: number, n: number, hgt: number) => m.on(j, (_b, g) => {
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1), z = z0 + (z1 - z0) * t, y = y0 - 0.05 * t;
        flame(g, [((i % 2) - 0.5) * 0.14, y, z], hgt * (0.75 + 0.35 * ((i * 7) % 3) / 2), 0.32, 0, -0.18);
      }
    });
    mane('maneA', 1.55, 1.15, 2.72, 4, 0.75);
    mane('maneB', 0.75, 0.05, 2.52, 4, 0.7);
    mane('maneC', -0.3, -0.9, 2.42, 3, 0.55);
    m.on('flare', (_b, g) => { for (let i = 0; i < 7; i++) flame(g, [((i % 3) - 1) * 0.22, 2.5, 1.3 - i * 0.33], 1.25, 0.45, 0, -0.3, C.roof, C.flame); });
    m.on('tail', (b, g) => {
      b.chain([[0, 2.15, -1.35], [0, 2.35, -1.75], [0, 2.7, -1.95]], [0.09, 0.07, 0.06], C.brass, 5);
      flame(g, [0, 2.75, -1.95], 0.55, 0.28, 0, -0.1);
    });
    for (const [n, , x, z] of legs) {
      const front = z > 0;
      m.on('leg' + n, (b) => { b.prism([x, 2.05, z], [x * 1.05, 1.0, z + (front ? 0.12 : -0.18)], front ? 0.36 : 0.42, 0.22, 6, C.hstone, { col2: C.hstoneDark }); });
      m.on('shin' + n, (b) => {
        const kx = x * 1.05, kz = z + (front ? 0.12 : -0.18);
        b.prism([kx, 1.02, kz], [kx, 0.12, kz + (front ? 0.08 : 0.12)], 0.19, 0.14, 6, C.brass, { col2: C.brassDark });
        b.ball([kx, 1.0, kz], 0.17, C.brassDark, 1, 1, 1, 0);
        b.ball([kx, 0.1, kz + 0.2], 0.17, C.hstoneDark, 1, 0.55, 1.5, 0);
      });
    }
  },
  pose(o, a) {
    const { T } = a;
    const p2 = a.bossPhase >= 1;
    // breathing, a slow head sweep and the mane's flicker (each tuft on its own beat)
    o.pos('body', 0, 0.02 * Math.sin(T * 1.6)); o.rot('chest', 0.02 * Math.sin(T * 1.6));
    o.rot('head', 0.06 * Math.sin(T * 0.8), 0.18 * Math.sin(T * 0.45));
    const mk = p2 ? 1.3 : 1;
    o.scale('maneA', mk * (1 + 0.08 * Math.sin(T * 11)), mk * (0.85 + 0.25 * Math.abs(Math.sin(T * 7.3))), mk);
    o.scale('maneB', mk * (1 + 0.08 * Math.sin(T * 9 + 1)), mk * (0.85 + 0.25 * Math.abs(Math.sin(T * 6.1 + 2))), mk);
    o.scale('maneC', mk, mk * (0.85 + 0.25 * Math.abs(Math.sin(T * 8.2 + 4))), mk);
    o.setScale('flare', p2 ? 1 : 0, p2 ? 0.8 + 0.3 * Math.abs(Math.sin(T * 5.5)) : 0, p2 ? 1 : 0);
    o.setScale('cracks', p2 ? 1 : 0);
    o.setScale('breath', 0);
    o.rot('tail', 0.2 * Math.sin(T * 1.9), 0.3 * Math.sin(T * 1.3));
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2), c = Math.cos(a.phase * Math.PI * 2);
      o.rot('legFL', 0.7 * s); o.rot('legFR', 0.7 * Math.sin(a.phase * Math.PI * 2 + 0.6));
      o.rot('legBL', -0.75 * s); o.rot('legBR', -0.75 * Math.sin(a.phase * Math.PI * 2 + 0.6));
      o.rot('shinFL', -0.5 * Math.max(0, c)); o.rot('shinFR', -0.5 * Math.max(0, c)); o.rot('shinBL', 0.4 * Math.max(0, -c)); o.rot('shinBR', 0.4 * Math.max(0, -c));
      o.pos('body', 0, 0.12 * Math.abs(s)); o.rot('body', 0.08 * c); o.rot('head', -0.12);
    }
    if (a.mode === 'windup') {
      const k = rise(a.wT, 0.18), hold = clamp01(a.wT / a.wDur), shake = Math.sin(T * 41);
      if (a.attack === 'wick_lunge') {      // haunches coiled, head low, front paws braced
        o.pos('body', 0, -0.35 * k, -0.35 * k); o.rot('body', -0.12 * k); o.rot('chest', 0.18 * k); o.rot('head', 0.3 * k);
        o.rot('legBL', 0.55 * k); o.rot('legBR', 0.55 * k); o.rot('shinBL', -0.5 * k); o.rot('shinBR', -0.5 * k);
        o.rot('legFL', -0.35 * k); o.rot('legFR', -0.35 * k);
        o.rot('body', 0, 0, 0.03 * k * shake); o.rot('tail', -0.5 * k);
      } else if (a.attack === 'ember_breath') { // head reared back, jaw opening, embers gathering in the mouth
        o.rot('neck', -0.45 * k); o.rot('head', -0.25 * k + 0.1 * hold); o.rot('jaw', 0.55 * rise(a.wT, 0.5));
        o.setScale('breath', 0.4 + 0.8 * hold * (0.85 + 0.15 * Math.sin(T * 23)));
        o.pos('body', 0, 0, -0.15 * k); o.rot('chest', -0.1 * k);
      } else if (a.attack === 'cinder_ring') { // rears up on the hind legs, the mane blazing
        o.rot('body', -0.55 * k); o.pos('body', 0, 0.35 * k, -0.3 * k);
        o.rot('legFL', -0.9 * k); o.rot('legFR', -0.7 * k); o.rot('shinFL', -0.9 * k); o.rot('shinFR', -1.0 * k);
        o.rot('legBL', 0.55 * k); o.rot('legBR', 0.55 * k); o.rot('neck', -0.3 * k); o.rot('jaw', 0.35 * k);
        o.setScale('flare', 1.2 + 0.4 * hold, 1.3 + 0.5 * hold * Math.abs(Math.sin(T * 9)), 1.2 + 0.4 * hold);
      }
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'wick_lunge') { const p = pulse(a.sT, 0.5, 0.25); o.pos('body', 0, 0.2 * p, 0.9 * p); o.rot('legFL', -0.9 * p); o.rot('legFR', -0.9 * p); o.rot('legBL', 0.8 * p); o.rot('legBR', 0.8 * p); o.rot('jaw', 0.5 * p); }
      else if (a.sAttack === 'ember_breath') { const p = pulse(a.sT, 0.6, 0.15); o.rot('neck', 0.25 * p); o.rot('jaw', 0.7 * p); o.setScale('breath', 1.6 * p, 1.4 * p, 2.8 * p); }
      else if (a.sAttack === 'cinder_ring') { const d = ease(a.sT / 0.15), back = ease((a.sT - 0.3) / 0.4); o.rot('body', -0.55 * (1 - d) + 0.12 * d * (1 - back)); o.pos('body', 0, 0.35 * (1 - d) - 0.2 * d * (1 - back)); o.setScale('flare', 1.6 * (1 - back) + (p2 ? back : 0)); }
      else { const p = pulse(a.sT, 0.4, 0.35); o.rot('neck', 0.35 * p); o.rot('jaw', 0.6 * p); o.pos('body', 0, 0, 0.25 * p); }
    }
    if (a.mode === 'phase' && a.phaseT >= 0) { // a howl: head thrown up, the mane bursting into flame
      const k = rise(a.phaseT, 0.4), f = 1 - ease((a.phaseT - 1.6) / 0.4);
      o.rot('neck', -0.75 * k * f); o.rot('head', -0.35 * k * f); o.rot('jaw', 0.6 * k * f); o.rot('body', -0.15 * k * f);
      o.setScale('flare', 1 + 0.8 * k * f * Math.abs(Math.sin(T * 8)));
      o.rot('body', 0, 0, 0.04 * k * f * Math.sin(T * 37));
    }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.3, 0.2); o.rot('body', 0, 0, 0.08 * p); o.pos('body', 0, 0, -0.12 * p); o.rot('head', -0.15 * p); }
    if (a.mode === 'stunned') { // a Break: sprawled, dazed, the mane guttering
      o.pos('body', 0, -0.55, 0); o.rot('legFL', -0.7); o.rot('legFR', -0.7); o.rot('shinFL', 1.2); o.rot('shinFR', 1.2); o.rot('legBL', 0.9); o.rot('legBR', 0.9); o.rot('shinBL', -1.3); o.rot('shinBR', -1.3);
      o.rot('head', 0.35 + 0.1 * Math.sin(T * 2.4), 0.25 * Math.sin(T * 1.3)); o.scale('maneA', 1, 0.45); o.scale('maneB', 1, 0.45); o.scale('maneC', 1, 0.45);
    }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.8); o.rot('body', 0, 0, 1.4 * k); o.pos('body', 0, -1.0 * k); o.rot('head', 0.4 * k); for (const l of ['FL', 'FR', 'BL', 'BR']) o.rot('leg' + l, 0, 0, -0.25 * k); o.scale('maneA', 1, 1 - 0.85 * k); o.scale('maneB', 1, 1 - 0.85 * k); o.scale('maneC', 1, 1 - 0.85 * k); o.setScale('flare', 0); o.setScale('cracks', 0); }
  },
  glow(a, base) { return a.mode === 'stunned' ? 0.35 + 0.35 * Math.abs(Math.sin(a.T * 13) * Math.sin(a.T * 3.1)) : base * (a.bossPhase >= 1 ? 1.15 : 1); },
};

// ───────────────────────── the Fallen Warden ─────────────────────────
export const FALLEN_WARDEN: KindDef = {
  height: 4.7,
  build(m) {
    m.joint('hips', null, [0, 1.45, 0]);
    m.joint('torso', 'hips', [0, 1.6, 0]);
    m.joint('windows', 'torso', [0, 2.4, 0]);
    m.joint('chestLamp', 'torso', [0, 2.45, 0.9]);
    m.joint('head', 'torso', [0, 3.5, 0]);
    m.joint('lamp', 'head', [0, 3.85, 0]);
    m.joint('lampDark', 'head', [0, 3.85, 0]);
    m.joint('halo', 'head', [0, 3.85, 0]);
    m.joint('armR', 'torso', [1.05, 3.05, 0.05]); m.joint('foreR', 'armR', [1.4, 2.15, 0.25]);
    m.joint('armL', 'torso', [-1.05, 3.05, 0.05]); m.joint('foreL', 'armL', [-1.55, 2.45, 0.35]); m.joint('lantern', 'foreL', [-1.5, 1.75, 0.95]);
    m.joint('legL', 'hips', [-0.55, 1.45, 0]); m.joint('legR', 'hips', [0.55, 1.45, 0]);
    const banded = (b: Model['b'], y0: number, y1: number, r0: number, r1: number, n: number) => {
      for (let i = 0; i < n; i++) {
        const ya = y0 + ((y1 - y0) * i) / n, yb = y0 + ((y1 - y0) * (i + 1)) / n;
        const ra = r0 + ((r1 - r0) * i) / n, rb = r0 + ((r1 - r0) * (i + 1)) / n;
        b.prism([0, ya, 0], [0, yb, 0], ra, rb, 10, i % 2 === 0 ? C.cream : C.roof, { caps: false, col2: tint(i % 2 === 0 ? C.cream : C.roof, 0.86) });
      }
    };
    m.on('hips', (b) => {
      b.prism([0, 1.15, 0], [0, 1.7, 0], 1.08, 1.02, 10, C.plinth, { col2: C.plinthDark });   // the stone foundation
      b.prism([0, 1.62, 0], [0, 1.74, 0], 1.12, 1.12, 10, C.brass, { caps: false });
    });
    m.on('torso', (b, g) => {
      banded(b, 1.72, 3.2, 1.0, 0.78, 5);                                       // the lighthouse stripes
      for (const y of [2.02, 2.62]) b.prism([0, y, 0], [0, y + 0.07, 0], 0.98 - (y - 1.72) * 0.15, 0.97 - (y - 1.72) * 0.15, 10, C.brassDark, { caps: false });
      b.prism([0, 3.18, 0], [0, 3.3, 0], 0.86, 0.9, 10, C.plinthDark);          // shoulders' stone ledge
      // the gallery collar: a brass ring with a railing, and Felix's maker's mark plate at its front
      b.prism([0, 3.28, 0], [0, 3.38, 0], 1.12, 1.12, 12, C.brass, { capB: C.gold });
      for (let k = 0; k < 12; k++) { const t = (k / 12) * Math.PI * 2; b.prism([Math.sin(t) * 1.07, 3.38, Math.cos(t) * 1.07], [Math.sin(t) * 1.07, 3.6, Math.cos(t) * 1.07], 0.03, 0.03, 3, C.brassDark, { caps: false }); }
      b.prism([0, 3.58, 0], [0, 3.63, 0], 1.1, 1.1, 12, C.gold, { caps: false });
      b.box(0, 3.33, 1.15, 0.5, 0.34, 0.06, tint(C.gold, 1.05));              // the plate
      b.box(-0.08, 3.33, 1.19, 0.06, 0.24, 0.03, C.hollow);                    // "F."
      b.box(0.0, 3.43, 1.19, 0.16, 0.05, 0.03, C.hollow);
      b.box(-0.02, 3.34, 1.19, 0.11, 0.045, 0.03, C.hollow);
      b.box(0.12, 3.24, 1.19, 0.05, 0.05, 0.03, C.hollow);
      // the keeper's door and a crack running up the stripes
      b.box(0, 2.0, 0.95, 0.42, 0.55, 0.12, C.timberDark);
      b.prism([0, 2.27, 0.97], [0, 2.38, 0.95], 0.21, 0.0, 6, C.timberDark, { caps: false });
      for (const [x0, y0, x1, y1] of [[0.3, 1.8, 0.45, 2.3], [0.45, 2.3, 0.35, 2.75], [0.35, 2.75, 0.55, 3.15]]) b.prism([x0, y0, 0.94 - y0 * 0.04], [x1, y1, 0.92 - y1 * 0.05], 0.035, 0.03, 3, C.hollow, { caps: false });
      b.taperBox([-0.62, 2.6, 0.72], 0.4, 0.2, [-0.55, 2.95, 0.66], 0.3, 0.16, C.plinthDark);  // a chipped-out stone
      // little dark windows up the tower (they light in phase 2: the 'windows' joint)
      for (const [x, y, z] of [[0.55, 2.3, 0.72], [-0.6, 2.85, 0.55], [0.1, 2.95, 0.84]]) b.box(x, y, z, 0.14, 0.22, 0.08, C.hollow);
      void g;
    });
    m.on('windows', (_b, g) => { for (const [x, y, z] of [[0.55, 2.3, 0.77], [-0.6, 2.85, 0.6], [0.1, 2.95, 0.89]]) g.box(x, y, z, 0.11, 0.18, 0.04, C.flame); });
    m.on('chestLamp', (b, g) => {
      b.prism([0, 2.45, 0.86], [0, 2.45, 1.02], 0.36, 0.36, 10, C.brass);
      g.prism([0, 2.45, 0.98], [0, 2.45, 1.06], 0.27, 0.22, 10, C.lamp);
      g.prism([0, 2.45, 1.06], [0, 2.45, 3.6], 0.13, 0.05, 6, C.flame, { caps: false });   // the light from its chest
    });
    m.on('head', (b) => {
      b.prism([0, 3.55, 0], [0, 3.62, 0], 0.72, 0.72, 10, C.brassDark);
      for (let k = 0; k < 8; k++) { const t = (k / 8) * Math.PI * 2 + 0.2; b.prism([Math.sin(t) * 0.62, 3.6, Math.cos(t) * 0.62], [Math.sin(t) * 0.62, 4.15, Math.cos(t) * 0.62], 0.045, 0.045, 4, C.brass, { caps: false }); }
      b.prism([0, 4.13, 0], [0, 4.2, 0], 0.72, 0.72, 10, C.brassDark);
      b.prism([0, 4.2, 0], [0, 4.75, 0], 0.8, 0.0, 10, C.roof, { col2: C.roof2 });             // the lamp-room cap
      b.ball([0, 4.82, 0], 0.11, C.gold, 1, 1, 1, 0);
      // the cracked front pane: a dark crack across the lens
      b.prism([-0.25, 4.05, 0.6], [0.05, 3.85, 0.63], 0.025, 0.02, 3, C.hollow, { caps: false });
      b.prism([0.05, 3.85, 0.63], [0.3, 3.68, 0.6], 0.025, 0.02, 3, C.hollow, { caps: false });
    });
    m.on('lamp', (_b, g) => {
      g.prism([0, 3.62, 0], [0, 4.13, 0], 0.6, 0.6, 8, C.lamp);
      g.ball([0, 3.88, 0.15], 0.3, C.cloud, 1, 1.1, 1, 0);                                    // the lens, white-hot
    });
    m.on('lampDark', (b) => {
      b.prism([0, 3.62, 0], [0, 4.13, 0], 0.59, 0.59, 8, C.glass, { col2: tint(C.glass, 0.7) });
      b.prism([0.6, 3.62, 0.0], [0.35, 3.75, 0.5], 0.06, 0.04, 3, C.hollow);                   // the empty lens socket's rim
    });
    m.on('halo', (_b, g) => {
      for (let k = 0; k < 10; k++) {
        const t = (k / 10) * Math.PI * 2, s = Math.sin(t), c = Math.cos(t), r0 = 0.75, r1 = k % 2 ? 2.4 : 3.3, w = 0.22;
        g.withHint(null, () => {
          g.tri([s * r0 - c * w, 3.88, c * r0 + s * w], [s * r0 + c * w, 3.88, c * r0 - s * w], [s * r1, 3.88, c * r1], C.flame, C.flame, C.lamp);
          g.tri([s * r0, 3.7, c * r0], [s * r0, 4.06, c * r0], [s * r1, 3.88, c * r1], C.flame, C.flame, C.lamp);
        });
      }
    });
    // the right arm: stone upper, brass forearm and a great fist
    m.on('armR', (b) => {
      b.ball([1.05, 3.05, 0.05], 0.42, C.brass, 1, 0.85, 1, 1, 0.1, C.brassDark);
      b.prism([1.1, 2.95, 0.05], [1.4, 2.15, 0.25], 0.32, 0.27, 7, C.plinth, { col2: C.plinthDark });
    });
    m.on('foreR', (b) => {
      b.prism([1.4, 2.15, 0.25], [1.5, 1.2, 0.55], 0.27, 0.24, 7, C.brass, { col2: C.brassDark });
      for (const y of [1.9, 1.55]) b.prism([1.43, y, 0.33], [1.45, y - 0.08, 0.36], 0.29, 0.29, 7, C.brassDark, { caps: false });
      b.ball([1.52, 1.0, 0.6], 0.38, C.plinth, 1.05, 0.95, 1.1, 1, 0.25, C.plinthDark);
    });
    // the left arm: a bent brass lantern-arm, a lantern hanging from its hook
    m.on('armL', (b) => {
      b.ball([-1.05, 3.05, 0.05], 0.38, C.brass, 1, 0.85, 1, 1, 0.1, C.brassDark);
      b.prism([-1.1, 3.0, 0.08], [-1.55, 2.45, 0.35], 0.13, 0.11, 6, C.brass);
      b.ball([-1.55, 2.45, 0.35], 0.16, C.brassDark, 1, 1, 1, 0);
    });
    m.on('foreL', (b) => {
      b.prism([-1.55, 2.45, 0.35], [-1.35, 2.25, 0.95], 0.1, 0.09, 6, C.brass);           // bent
      b.prism([-1.35, 2.25, 0.95], [-1.5, 2.0, 0.98], 0.07, 0.06, 5, C.brassDark);
      b.prism([-1.5, 2.0, 0.98], [-1.5, 1.92, 0.95], 0.1, 0.0, 4, C.brassDark);              // the hook
    });
    m.on('lantern', (b, g) => {
      b.prism([-1.5, 1.92, 0.95], [-1.5, 1.78, 0.95], 0.015, 0.015, 3, C.hollow, { caps: false });
      b.prism([-1.5, 1.78, 0.95], [-1.5, 1.7, 0.95], 0.08, 0.26, 6, C.roof);
      g.prism([-1.5, 1.7, 0.95], [-1.5, 1.32, 0.95], 0.2, 0.2, 6, C.lamp);
      for (let k = 0; k < 6; k++) { const t = (k / 6) * Math.PI * 2; b.prism([-1.5 + Math.sin(t) * 0.215, 1.7, 0.95 + Math.cos(t) * 0.215], [-1.5 + Math.sin(t) * 0.215, 1.32, 0.95 + Math.cos(t) * 0.215], 0.02, 0.02, 3, C.brassDark, { caps: false }); }
      b.prism([-1.5, 1.32, 0.95], [-1.5, 1.24, 0.95], 0.24, 0.12, 6, C.brass);
    });
    for (const [j, sx] of [['legL', -1], ['legR', 1]] as const) m.on(j, (b) => {
      b.prism([sx * 0.55, 1.35, 0], [sx * 0.62, 0.25, 0.05], 0.42, 0.38, 8, C.plinth, { col2: C.plinthDark });
      b.prism([sx * 0.6, 0.9, 0.02], [sx * 0.6, 0.78, 0.03], 0.42, 0.42, 8, C.brass, { caps: false });
      b.taperBox([sx * 0.62, 0, 0.12], 0.85, 1.1, [sx * 0.62, 0.3, 0.08], 0.7, 0.9, C.brassDark, C.brass);   // brass feet
    });
  },
  pose(o, a) {
    const { T } = a;
    const ph = a.bossPhase;
    const breath = Math.sin(T * 0.9);
    o.rot('torso', 0.015 * breath); o.pos('hips', 0, 0.025 * breath);
    o.rot('head', 0.03 * Math.sin(T * 0.6), 0.12 * Math.sin(T * 0.35));
    o.rot('lantern', 0.12 * Math.sin(T * 1.4), 0, 0.08 * Math.sin(T * 1.1));            // the lantern swings on its hook
    o.rot('armR', 0.04 * Math.sin(T * 0.9 + 1)); o.rot('armL', 0.04 * Math.sin(T * 0.9 + 2));
    // the phase looks: 2 lights the crown of rays and the windows; 3 has the lens fallen (head dark) and the chest lit
    o.setScale('lamp', ph >= 2 ? 0 : 1); o.setScale('lampDark', ph >= 2 ? 1 : 0);
    o.setScale('chestLamp', ph >= 2 ? 1 : 0);
    o.setScale('windows', ph >= 1 ? 1 : 0);
    const haloOn = ph === 1 ? 0.85 + 0.15 * Math.sin(T * 3) : 0;
    o.setScale('halo', haloOn, 1, haloOn); o.rot('halo', 0, T * 0.6);
    if (ph >= 2) { o.rot('torso', 0.12); o.rot('head', 0.28); o.pos('hips', 0, -0.08); }   // hunched over its chest light
    if (a.mode === 'run' || a.mode === 'return') {
      const s = Math.sin(a.phase * Math.PI * 2);
      o.rot('legL', 0.32 * s); o.rot('legR', -0.32 * s); o.rot('torso', 0.05, 0, 0.06 * s); o.rot('armR', -0.3 * s); o.rot('armL', 0.25 * s);
      o.pos('hips', 0, 0.06 * Math.abs(Math.sin(a.phase * Math.PI * 4)));
    }
    if (a.mode === 'windup') {
      const k = rise(a.wT, 0.22), hold = clamp01(a.wT / a.wDur), tremble = Math.sin(T * 33);
      const crown = (s: number) => { o.setScale('halo', s, 1, s); };
      if (a.attack === 'lamp_sweep') {          // the fist drawn back across the body
        o.rot('torso', 0, -0.55 * k); o.rot('armR', -0.6 * k, 0, 0.9 * k); o.rot('foreR', -0.5 * k); o.rot('armL', 0, 0, -0.3 * k);
      } else if (a.attack === 'brass_fall') {   // both arms raised: the old works above come loose
        o.rot('armR', -2.3 * k, 0, 0.25 * k); o.rot('armL', -2.1 * k, 0, -0.25 * k); o.rot('foreR', -0.3 * k); o.rot('torso', -0.12 * k); o.rot('head', -0.3 * k);
        crown(0.6 + 0.5 * hold);
      } else if (a.attack === 'keepers_toll') { // rocks back and swings the lantern like a bell
        o.rot('torso', -0.18 * k + 0.06 * Math.sin(T * 6) * k); o.rot('armL', -1.4 * k, 0, -0.5 * k); o.rot('lantern', 0.9 * k * Math.sin(T * 6));
        o.rot('head', -0.25 * k); crown(1.0 + 0.6 * hold);
      } else if (a.attack === 'beacon_lance') { // leans in, the light gathered and aimed
        o.rot('torso', 0.32 * k); o.rot('head', ph >= 2 ? 0.1 * k : 0.35 * k); o.rot('armR', -0.4 * k, 0, 0.5 * k); o.rot('armL', -0.4 * k, 0, -0.5 * k);
        if (ph < 2) crown(0.3 + 0.9 * hold);
      } else if (a.attack === 'turning_light') { // arms flung wide, turning with its own light
        o.rot('armR', 0, 0, 1.1 * k); o.rot('armL', 0, 0, -1.1 * k); o.rot('torso', 0.18 * k); o.rot('head', 0.2 * k);
      } else if (a.attack === 'last_light') {  // everything it has left
        o.rot('armR', -2.6 * k, 0, 0.4 * k); o.rot('armL', -2.6 * k, 0, -0.4 * k); o.rot('torso', -0.25 * k); o.rot('head', -0.4 * k);
        crown(1.5 + 0.5 * Math.abs(Math.sin(T * 9)));
      }
      o.rot('torso', 0, 0, 0.012 * k * tremble);
    }
    if (a.sT >= 0) {
      if (a.sAttack === 'lamp_sweep') { const p = pulse(a.sT, 0.5, 0.3); o.rot('torso', 0, 0.6 * p - 0.55 * (1 - ease(a.sT / 0.15))); o.rot('armR', -0.9 * p, 0, -0.5 * p); }
      else if (a.sAttack === 'brass_fall' || a.sAttack === 'last_light') { const back = ease(a.sT / 0.5); o.rot('armR', -2.3 * (1 - back), 0, 0.25); o.rot('armL', -2.1 * (1 - back), 0, -0.25); o.pos('hips', 0, -0.12 * pulse(a.sT, 0.4, 0.3)); }
      else if (a.sAttack === 'keepers_toll') { const p = pulse(a.sT, 0.6, 0.15); o.rot('torso', 0.1 * p); o.rot('lantern', -1.0 * p); o.setScale('halo', 2.2 * p, 1, 2.2 * p); }
      else if (a.sAttack === 'beacon_lance') { const p = pulse(a.sT, 0.45, 0.2); o.rot('torso', 0.4 * p); o.pos('hips', 0, 0, -0.2 * p); }
      else if (!a.sAttack) { const p = pulse(a.sT, 0.55, 0.35); o.rot('armR', -1.4 * p, 0, -0.3 * p); o.rot('foreR', -0.3 * p); o.rot('torso', 0.12 * p, -0.3 * p); }
    }
    if (a.mode === 'phase' && a.phaseT >= 0) {
      const k = rise(a.phaseT, 0.35), f = 1 - ease((a.phaseT - 3.4) / 0.6);
      if (ph >= 2) { // the lens falls: it reels, head bowed, then the chest kindles
        o.rot('torso', 0.35 * k * f); o.rot('head', 0.5 * k * f); o.pos('hips', 0, -0.35 * k * f); o.rot('armR', 0.4 * k * f); o.rot('armL', 0.4 * k * f);
        o.setScale('chestLamp', ph >= 2 ? ease((a.phaseT - 1.2) / 1.5) : 0);
      } else {       // the lamp kindles: it straightens, arms out, the light blazing up
        o.rot('torso', -0.2 * k * f); o.rot('head', -0.35 * k * f); o.rot('armR', 0, 0, 0.9 * k * f); o.rot('armL', 0, 0, -0.9 * k * f);
        o.setScale('halo', (0.6 + 1.2 * k * f) * (0.85 + 0.15 * Math.sin(T * 11)), 1, (0.6 + 1.2 * k * f) * (0.85 + 0.15 * Math.sin(T * 11)));
      }
      o.rot('hips', 0, 0, 0.02 * k * f * Math.sin(T * 29));
    }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.35, 0.2); o.rot('torso', -0.06 * p); o.rot('head', -0.1 * p); }
    if (a.mode === 'stunned') { // a Break: down on one knee, the light guttering
      o.pos('hips', 0, -0.55); o.rot('legL', -1.1); o.rot('legR', 0.5); o.rot('torso', 0.32 + 0.04 * Math.sin(T * 1.7), 0, 0.06 * Math.sin(T * 1.2));
      o.rot('head', 0.35); o.rot('armR', 0.5, 0, -0.2); o.rot('armL', 0.4, 0, 0.3); o.setScale('halo', 0);
    }
    if (a.mode === 'dead') { const k = ease(a.deadT / 1.4); o.pos('hips', 0, -0.9 * k); o.rot('torso', 0.55 * k, 0, 0.15 * k); o.rot('head', 0.45 * k); o.rot('armR', 0.7 * k); o.rot('armL', 0.6 * k); o.rot('legL', -1.2 * k); o.rot('legR', -1.2 * k); o.setScale('halo', 0); }
  },
  glow(a, base) {
    if (a.mode === 'stunned') return 0.25 + 0.45 * Math.abs(Math.sin(a.T * 17) * Math.sin(a.T * 4.3)); // guttering
    if (a.mode === 'dead') return 0.15 + 0.85 * (1 - ease(a.deadT / 1.2)) * (0.6 + 0.4 * Math.sin(a.T * 2));
    if (a.mode === 'windup') return 1.25 + 0.35 * Math.sin(a.T * 18) * rise(a.wT, 0.12);
    return base * (a.enraged ? 1.15 + 0.15 * Math.sin(a.T * 9) : 1);
  },
};

// ───────────────────────── the Lens Shard ─────────────────────────
export const LENS_SHARD: KindDef = {
  height: 2.6,
  build(m) {
    m.joint('socket', null, [0, 0, 0]);
    m.joint('crystal', null, [0, 1.55, 0]);
    m.joint('beam', null, [0, 1.55, 0]);
    m.on('socket', (b) => {
      b.prism([0, 0, 0], [0, 0.32, 0], 0.62, 0.5, 6, C.brassDark, { capB: C.brass });
      for (let k = 0; k < 3; k++) { const t = (k / 3) * Math.PI * 2; b.prism([Math.sin(t) * 0.42, 0.3, Math.cos(t) * 0.42], [Math.sin(t) * 0.22, 0.75, Math.cos(t) * 0.22], 0.07, 0.03, 4, C.brass); }
    });
    m.on('crystal', (b, g) => {
      // an elongated faceted crystal: two six-sided points, alternating light and dark facets
      const top: V3 = [0, 2.35, 0], bot: V3 = [0, 0.75, 0], mid = 1.5, R = 0.42;
      const ring: V3[] = []; for (let k = 0; k < 6; k++) { const t = (k / 6) * Math.PI * 2; ring.push([Math.sin(t) * R * (k % 2 ? 0.85 : 1), mid + (k % 2 ? 0.12 : -0.05), Math.cos(t) * R * (k % 2 ? 0.85 : 1)]); }
      g.withHint([0, mid, 0], () => {
        for (let k = 0; k < 6; k++) {
          const p = ring[k], q = ring[(k + 1) % 6], c = k % 2 ? C.crystal : C.crystal2;
          g.tri(p, q, top, c, c, C.cloud); g.tri(q, p, bot, mix(c, C.teal, 0.4), mix(c, C.teal, 0.4), C.teal);
        }
      });
      // brass bands binding it
      b.prism([0, 1.35, 0], [0, 1.42, 0], 0.4, 0.41, 6, C.brass, { caps: false });
    });
    m.on('beam', (_b, g) => { g.prism([0, 1.55, 0], [0, 1.55, 1], 0.05, 0.05, 4, C.crystal, { caps: false }); });
  },
  pose(o, a) {
    const { T } = a;
    o.rot('crystal', 0, T * 0.7); o.pos('crystal', 0, 0.08 * Math.sin(T * 1.7));
    // the ward beam, aimed at the tether point (model space)
    if (a.tOn && a.mode !== 'dead') {
      const dx = a.tx, dy = a.ty - 1.55, dz = a.tz, hz = Math.hypot(dx, dz), d = Math.hypot(hz, dy);
      o.rot('beam', -Math.atan2(dy, hz), Math.atan2(dx, dz)); o.setScale('beam', 1, 1, d);
    } else o.setScale('beam', 0);
    if (a.mode === 'windup') { const k = rise(a.wT, 0.2); o.rot('crystal', 0, T * 5 * k); o.scale('crystal', 1 + 0.12 * k + 0.05 * Math.sin(T * 25)); o.pos('crystal', 0, 0.2 * k); }
    if (a.sT >= 0) { const p = pulse(a.sT, 0.35, 0.2); o.scale('crystal', 1 + 0.25 * p); }
    if (a.hT >= 0) { const p = pulse(a.hT, 0.3, 0.2); o.pos('crystal', 0.06 * p, -0.05 * p); }
    if (a.mode === 'stunned') { o.pos('crystal', 0, -0.35); o.rot('crystal', 0.35 * Math.sin(T * 3), 0, 0.3); }
    if (a.mode === 'dead') { const k = ease(a.deadT / 0.5); o.pos('crystal', 0, -0.9 * k); o.scale('crystal', 1 - 0.6 * k); o.rot('crystal', 1.2 * k); }
  },
  glow(a) { return a.mode === 'dead' ? 0.2 : a.mode === 'windup' ? 1.2 + 0.3 * Math.sin(a.T * 20) : 0.9 + 0.1 * Math.sin(a.T * 2.5); },
};

/** Drawn size per new kind (the Warden and the shard are built at their true size; the hound a little big). */
export const BOSS_DRAW: Partial<Record<EnemyKindId, number>> = { wickhound: 0.86 };
/** Gait cadence per new kind (stride frequency per m/s). */
export const BOSS_CADENCE: Partial<Record<EnemyKindId, number>> = { wickhound: 0.3, fallen_warden: 0.24, lens_shard: 0 };
