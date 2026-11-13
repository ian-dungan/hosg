// The 20 hair styles (HAIR_STYLES) and 8 facial-hair options (FACIAL_HAIR), built in code in the canonical human
// space (the look's warp fits them to every head). Bones: the close cap rides `head`; volume that a hood or helm
// would swallow (crowns, buns, crests, quiffs) rides `hair` (hidden under job headgear); long hanging hair, tails
// and braids ride `hairB`, a spring bone at the nape (the cape's secondary motion).
import { Color3, type Vector3 } from '@babylonjs/core';
import type { ShapeKit, V3 } from './character';
import { HY } from './faces';

const shade = (c: Color3, f: number) => new Color3(Math.min(1, c.r * f), Math.min(1, c.g * f), Math.min(1, c.b * f));
type J = 'head' | 'hair' | 'hairB';

/** A close shell over the skull with the face window pulled in (z0: the window's top edge forward; back: the nape's cut). */
function cap(k: ShapeKit, hc: Color3, z0 = 0.33, yFace = 0.22, back = -0.55, puff = 1) {
  k.ellip('head', [0, HY + 0.03, -0.012], [0.212 * puff, 0.215 * puff, 0.205 * puff], hc, { seg: 16, lat: 10,
    deform: (l: Vector3) => {
      const face = l.z > z0 && l.y < yFace + (Math.abs(l.x) > 0.55 ? -0.3 : 0);
      if (face || l.y < back) { l.x *= 0.8; l.y *= 0.8; l.z *= 0.8; }
      else if (l.y < -0.1 && l.z < 0) l.y -= 0.08;
    },
    paint: (_w, _uv, l) => (l.y > 0.5 ? shade(hc, 1.08) : undefined) });
}
/** A tapering lock through `pts`. */
function lock(k: ShapeKit, hc: Color3, pts: V3[], r: number, j: J = 'head', seg = 7) {
  k.tube(j, pts, pts.map((_, i) => (i === pts.length - 1 ? 0.004 : r * (1 - (i / pts.length) * 0.45))), hc, { seg, noOcc: true });
}
/** A braid: beads down a path (alternately shaded so the plaits read), with a tie at the end. */
function braid(k: ShapeKit, hc: Color3, pts: V3[], r: number, tie: Color3, j: J = 'hairB') {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1), rr = r * (1 - t * 0.35);
    k.ellip(j, pts[i]!, [rr, rr * 1.15, rr * 0.9], i % 2 ? shade(hc, 0.86) : hc, { seg: 7, lat: 5, noOcc: i > 0 });
  }
  const end = pts[n - 1]!;
  k.ellip(j, [end[0], end[1] - r * 0.9, end[2]], [r * 0.45, r * 0.45, r * 0.45], tie, { seg: 6, lat: 4, noOcc: true });
  k.tube(j, [[end[0], end[1] - r, end[2]], [end[0], end[1] - r * 2.6, end[2] - 0.01]], [r * 0.5, 0.004], hc, { seg: 5, noOcc: true });
}
const line = (a: V3, b: V3, n: number): V3[] => Array.from({ length: n }, (_, i) => { const t = i / (n - 1); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; });

/** HAIR_STYLES[style] in colour `hc`; `tie` colours the ties and beads. */
export function buildHair(k: ShapeKit, style: number, hc: Color3, tie: Color3): void {
  switch (style) {
    case 0: return; // Bald
    case 1: // Close crop
      cap(k, hc, 0.36, 0.38, -0.5, 0.97);
      return;
    case 2: // Tousled
      cap(k, hc, 0.32, 0.3, -0.58);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2, r = 0.12;
        lock(k, hc, [[Math.sin(a) * 0.06, HY + 0.2, Math.cos(a) * 0.06], [Math.sin(a) * r, HY + 0.24 - (i % 2) * 0.03, Math.cos(a) * r], [Math.sin(a) * (r + 0.07), HY + 0.2 - (i % 3) * 0.03, Math.cos(a) * (r + 0.07)]], 0.05, 'hair', 6);
      }
      return;
    case 3: // Side part
      cap(k, hc, 0.3, 0.32, -0.6);
      lock(k, hc, [[-0.11, HY + 0.2, 0.06], [0.0, HY + 0.21, 0.16], [0.12, HY + 0.15, 0.18], [0.17, HY + 0.06, 0.16]], 0.055);
      lock(k, hc, [[-0.12, HY + 0.2, 0.02], [-0.17, HY + 0.12, 0.08], [-0.19, HY + 0.02, 0.06]], 0.045);
      return;
    case 4: // Swept back
      cap(k, hc, 0.36, 0.42, -0.62);
      for (const x of [-0.1, -0.035, 0.035, 0.1]) lock(k, hc, [[x, HY + 0.17, 0.15], [x * 1.1, HY + 0.25, 0.02], [x * 1.15, HY + 0.22, -0.13], [x * 1.1, HY + 0.12, -0.23]], 0.06, 'hair');
      return;
    case 5: // Shaggy
      cap(k, hc, 0.3, 0.26, -0.62, 1.03);
      for (let i = 0; i < 9; i++) {
        const a = -2.2 + (i / 8) * 4.4, x = Math.sin(a), z = Math.cos(a);
        lock(k, hc, [[x * 0.17, HY + 0.12, z * 0.16], [x * 0.22, HY - 0.0, z * 0.18], [x * 0.22, HY - 0.12, z * 0.17 - 0.02]], 0.05, i % 2 ? 'hairB' : 'head', 6);
      }
      lock(k, hc, [[-0.1, HY + 0.2, 0.08], [0.0, HY + 0.17, 0.19], [0.1, HY + 0.1, 0.2]], 0.05);
      return;
    case 6: { // Long loose: down past the shoulders
      cap(k, hc, 0.3, 0.26, -0.75);
      const grid: V3[][] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6, y = HY + 0.08 - t * 0.5, row: V3[] = [];
        for (let j = 0; j <= 6; j++) {
          const a = Math.PI * (0.32 + (j / 6) * 1.36), r = 0.215 + t * 0.05;
          row.push([Math.sin(a) * r, y, Math.cos(a) * r * 0.95 - 0.02 - t * 0.04]);
        }
        grid.push(row);
      }
      k.sheet('hairB', grid, 0.03, hc, { paint: (_w, uv) => (uv[1] > 0.9 ? shade(hc, 0.85) : undefined) });
      lock(k, hc, [[-0.12, HY + 0.18, 0.08], [-0.05, HY + 0.15, 0.19], [0.08, HY + 0.1, 0.205]], 0.055);
      return;
    }
    case 7: // Low tail at the nape
      cap(k, hc, 0.3, 0.3, -0.55);
      k.ellip('hairB', [0, HY - 0.08, -0.21], [0.05, 0.05, 0.04], tie, { seg: 8, lat: 5, noOcc: true });
      k.tube('hairB', [[0, HY - 0.08, -0.22], [0, HY - 0.18, -0.26], [0, HY - 0.32, -0.27], [0, HY - 0.44, -0.24]], [0.05, 0.055, 0.04, 0.008], hc, { seg: 8 });
      return;
    case 8: // High tail from the crown
      cap(k, hc, 0.3, 0.3, -0.55);
      k.ellip('hair', [0, HY + 0.17, -0.16], [0.045, 0.04, 0.045], tie, { seg: 8, lat: 5, noOcc: true });
      k.tube('hair', [[0, HY + 0.18, -0.17], [0, HY + 0.24, -0.27], [0, HY + 0.12, -0.33]], [0.05, 0.055, 0.05], hc, { seg: 8 });
      k.tube('hairB', [[0, HY + 0.12, -0.33], [0, HY - 0.05, -0.33], [0, HY - 0.25, -0.3]], [0.05, 0.04, 0.006], hc, { seg: 8 });
      return;
    case 9: // Topknot
      cap(k, hc, 0.33, 0.34, -0.55);
      k.ellip('hair', [0, HY + 0.25, -0.03], [0.08, 0.075, 0.08], hc, { seg: 10, lat: 7 });
      k.lathe('hair', [0, HY + 0.2, -0.03], [[0, 0.05], [0.03, 0.052]], tie, { seg: 10 });
      return;
    case 10: // Twin buns
      cap(k, hc, 0.31, 0.3, -0.55);
      for (const sx of [-1, 1]) k.ellip('hair', [sx * 0.14, HY + 0.19, -0.05], [0.075, 0.07, 0.075], hc, { seg: 10, lat: 7 });
      lock(k, hc, [[0.12, HY + 0.17, 0.06], [0.03, HY + 0.17, 0.18], [-0.09, HY + 0.12, 0.2]], 0.045);
      return;
    case 11: // Single braid down the back
      cap(k, hc, 0.3, 0.27, -0.5);
      braid(k, hc, line([0, HY - 0.04, -0.22], [0, HY - 0.5, -0.27], 6), 0.045, tie);
      return;
    case 12: // Twin braids over the shoulders
      cap(k, hc, 0.31, 0.28, -0.55);
      for (const sx of [-1, 1]) braid(k, hc, [[sx * 0.17, HY - 0.06, -0.06], [sx * 0.19, HY - 0.15, -0.02], [sx * 0.2, HY - 0.24, 0.04], [sx * 0.2, HY - 0.33, 0.08], [sx * 0.19, HY - 0.42, 0.1]], 0.036, tie);
      return;
    case 13: { // Braid hood: braids wrapped round the head, and one down the back
      cap(k, hc, 0.31, 0.3, -0.55);
      const ring: V3[] = [];
      for (let i = 0; i < 9; i++) { const a = -1.9 + (i / 8) * 3.8; ring.push([Math.sin(a) * 0.205, HY + 0.13 - Math.cos(a) * 0.02, Math.cos(a) * 0.2 - 0.03]); }
      for (let i = 0; i < ring.length; i++) k.ellip('head', ring[i]!, [0.04, 0.034, 0.04], i % 2 ? shade(hc, 0.86) : hc, { seg: 7, lat: 5, noOcc: true });
      braid(k, hc, line([0, HY - 0.02, -0.21], [0, HY - 0.36, -0.25], 5), 0.04, tie);
      return;
    }
    case 14: { // Curls: small curls all over
      cap(k, hc, 0.32, 0.3, -0.58);
      let n = 0;
      for (let ring = 0; ring < 3; ring++) for (let i = 0; i < 7 - ring; i++) {
        const a = (i / (7 - ring)) * Math.PI * 2 + ring * 0.4, el = 0.25 + ring * 0.35;
        const x = Math.sin(a) * Math.cos(el) * 0.215, z = Math.cos(a) * Math.cos(el) * 0.205 - 0.01, y = HY + 0.03 + Math.sin(el) * 0.215;
        if (z > 0.13 && y < HY + 0.17) continue; // keep the face clear
        k.ellip(n++ % 2 ? 'hair' : 'head', [x, y, z], [0.05, 0.05, 0.05], n % 3 ? hc : shade(hc, 0.9), { seg: 6, lat: 4, noOcc: true });
      }
      return;
    }
    case 15: // Coils: a big round crown of hair
      k.ellip('hair', [0, HY + 0.1, -0.03], [0.29, 0.26, 0.27], hc, { seg: 14, lat: 9,
        deform: (l) => { const b = 1 + 0.06 * Math.sin(l.x * 13) * Math.sin(l.y * 11 + l.z * 9); l.x *= b; l.y *= b; l.z *= b; if (l.z > 0.45 && l.y < 0.15) { l.z *= 0.72; l.y *= 0.9; } if (l.y < -0.5) l.y = -0.5; } });
      cap(k, hc, 0.33, 0.3, -0.5);
      return;
    case 16: // Shaved sides: a band of hair over the top, the sides close-shaved
      k.ellip('head', [0, HY + 0.03, -0.012], [0.206, 0.209, 0.199], shade(hc, 0.75), { seg: 14, lat: 8,
        deform: (l) => { if ((l.z > 0.36 && l.y < 0.4) || l.y < -0.35) { l.x *= 0.8; l.y *= 0.8; l.z *= 0.8; } } });
      k.ellip('hair', [0, HY + 0.15, -0.03], [0.085, 0.12, 0.2], hc, { seg: 10, lat: 7, deform: (l) => { if (l.y < -0.2) l.y = -0.2; } });
      return;
    case 17: // Crest: a tall fin of hair from brow to nape
      k.ellip('head', [0, HY + 0.03, -0.012], [0.206, 0.209, 0.199], shade(hc, 0.72), { seg: 14, lat: 8,
        deform: (l) => { if ((l.z > 0.36 && l.y < 0.4) || l.y < -0.35) { l.x *= 0.8; l.y *= 0.8; l.z *= 0.8; } } });
      for (let i = 0; i < 5; i++) {
        const a = -0.6 + i * 0.5, y = HY + 0.03 + Math.cos(a) * 0.2, z = Math.sin(a) * -0.2;
        k.tube('hair', [[0, y - 0.02, z], [0, y + 0.13 - Math.abs(i - 1.5) * 0.02, z - 0.06]], [0.035, 0.004], i % 2 ? hc : shade(hc, 1.1), { seg: 5, flatten: 0.35, noOcc: true });
      }
      return;
    case 18: // Bob
      cap(k, hc, 0.32, 0.25, -0.75);
      k.lathe('hairB', [0, HY - 0.05, -0.01], [[-0.08, 0.205], [0.0, 0.228], [0.12, 0.222]], hc, { seg: 14, arc: [Math.PI * 0.32, Math.PI * 1.68], sz: 1.02 });
      lock(k, hc, [[-0.12, HY + 0.17, 0.1], [0.0, HY + 0.16, 0.2], [0.12, HY + 0.15, 0.17]], 0.05);
      return;
    default: { // 19 Windswept: the hero's hair
      cap(k, hc, 0.3, 0.3, -0.62);
      lock(k, hc, [[0.0, HY + 0.21, 0.02], [0.06, HY + 0.19, 0.14], [0.13, HY + 0.12, 0.2], [0.18, HY + 0.02, 0.19]], 0.065);
      lock(k, hc, [[-0.07, HY + 0.2, 0.03], [-0.03, HY + 0.17, 0.16], [0.02, HY + 0.11, 0.21], [0.06, HY + 0.05, 0.215]], 0.06);
      lock(k, hc, [[-0.12, HY + 0.17, 0.02], [-0.15, HY + 0.12, 0.13], [-0.17, HY + 0.04, 0.17], [-0.16, HY - 0.04, 0.165]], 0.055);
      lock(k, hc, [[0.0, HY + 0.19, 0.08], [0.0, HY + 0.28, -0.01], [0.0, HY + 0.28, -0.12], [0.0, HY + 0.21, -0.24]], 0.085, 'hair');
      for (const sx of [-1, 1]) lock(k, hc, [[sx * 0.08, HY + 0.18, 0.02], [sx * 0.13, HY + 0.25, -0.07], [sx * 0.16, HY + 0.21, -0.18], [sx * 0.19, HY + 0.12, -0.25]], 0.065, 'hair');
      lock(k, hc, [[0.0, HY + 0.08, -0.17], [0.0, HY - 0.05, -0.24], [0.02, HY - 0.16, -0.25]], 0.07, 'hairB');
      for (const sx of [-1, 1]) lock(k, hc, [[sx * 0.1, HY + 0.07, -0.15], [sx * 0.13, HY - 0.04, -0.21], [sx * 0.16, HY - 0.13, -0.2]], 0.055, 'hairB');
      for (const sx of [-1, 1]) lock(k, hc, [[sx * 0.16, HY + 0.13, 0.03], [sx * 0.2, HY + 0.02, 0.07], [sx * 0.19, HY - 0.09, 0.07]], 0.042);
    }
  }
}

/** Whether a style hangs long enough to swing (its `hairB` parts get the strongest spring). */
export const LONG_HAIR = new Set([6, 7, 8, 11, 12, 13, 18]);

/**
 * FACIAL_HAIR[facial] in colour `fc` (stubble and sideburns are mostly painted on the skin by faces.ts; this adds
 * their small geometry). `muzzleZ`: how far forward a Brindlekin's muzzle puts the chin (0 for the others).
 */
export function buildFacialHair(k: ShapeKit, facial: number, fc: Color3, muzzleZ: number, tie: Color3): void {
  const z = muzzleZ;
  const moustache = (thick: number) => {
    for (const sx of [-1, 1]) k.tube('head', [[0, HY - 0.072, 0.205 + z], [sx * 0.055, HY - 0.08, 0.195 + z], [sx * 0.11, HY - 0.1, 0.165 + z], [sx * 0.15, HY - 0.07, 0.13 + z * 0.5]],
      [0.03 * thick, 0.034 * thick, 0.024 * thick, 0.01], fc, { seg: 6, noOcc: true });
  };
  const beard = (size: number, drop: number) => {
    k.ellip('head', [0, HY - 0.13 - drop * 0.5, 0.08 + z * 0.8], [0.15 * size, 0.13 * size + drop, 0.11 * size], fc, { seg: 12, lat: 8,
      deform: (l) => { if (l.y < 0) { l.z += -l.y * 0.35; l.x *= 1 - 0.35 * -l.y; } if (l.y > 0.3 && l.z > 0.2) l.z -= 0.35; } });
  };
  switch (facial) {
    case 1: return; // stubble: painted
    case 2: beard(0.82, 0); return; // short beard
    case 3: beard(1, 0.03); moustache(1); return; // full beard
    case 4: // braided beard
      beard(0.9, 0.0); moustache(0.85);
      braid(k, fc, line([0, HY - 0.25, 0.17 + z], [0, HY - 0.42, 0.18 + z], 4), 0.032, tie, 'head');
      return;
    case 5: moustache(1); return; // moustache
    case 6: // sideburns: thick strips down the cheeks
      for (const sx of [-1, 1]) k.ellip('head', [sx * 0.178, HY - 0.06, 0.06], [0.03, 0.08, 0.05], fc, { seg: 6, lat: 5, noOcc: true });
      return;
    case 7: // goatee: a small chin beard and a thin moustache
      k.ellip('head', [0, HY - 0.17, 0.15 + z], [0.045, 0.06, 0.04], fc, { seg: 8, lat: 6, noOcc: true });
      moustache(0.6);
      return;
    default: return;
  }
}
