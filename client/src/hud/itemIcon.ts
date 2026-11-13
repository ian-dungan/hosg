// Item icons, drawn in code on a canvas: each slot has its silhouette, each armour type its own outline (a cloth hood,
// a light cap, a heavy helm), each weapon and off-hand kind its shape, filled in the tier colour, with more trim at
// higher tiers and a glint on named weapons. Drawn once per look and kept as an image URL (no per-frame work).
import type { IconSpec } from '../core/gearViews';

const cache = new Map<string, string>();
const S = 128;

/** The icon's image URL ('' where there is no canvas: tests). */
export function iconUrl(i: IconSpec): string {
  const key = `${i.slot}|${i.type}|${i.kind}|${i.tier}|${i.named}|${i.colour}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    if (g) { draw(g, i); url = c.toDataURL('image/png'); }
  } catch { url = ''; }
  cache.set(key, url);
  return url;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

type P = [number, number][];
const poly = (g: CanvasRenderingContext2D, pts: P) => { g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]![0], pts[k]![1]); g.closePath(); };
const mirror = (half: P): P => [...half, ...half.slice().reverse().map(([x, y]) => [S - x, y] as [number, number])];

function draw(g: CanvasRenderingContext2D, i: IconSpec): void {
  const base = i.colour;
  const fill = g.createLinearGradient(0, 16, 0, 112);
  fill.addColorStop(0, shade(base, 0.35)); fill.addColorStop(0.55, base); fill.addColorStop(1, shade(base, -0.38));
  const ink = 'rgba(22,16,40,.92)';
  const trim = i.tier >= 2 ? shade(base, 0.62) : null;
  g.lineJoin = 'round'; g.lineCap = 'round';
  // a soft disc behind (the tier's glow)
  const halo = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  halo.addColorStop(0, i.tier >= 3 || i.named ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.08)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, S, S);
  const body = (path: () => void, lw = 6) => {
    path(); g.fillStyle = fill; g.fill(); g.lineWidth = lw; g.strokeStyle = ink; g.stroke();
  };
  const line = (pts: P, col: string, lw = 4) => { g.beginPath(); g.moveTo(pts[0]![0], pts[0]![1]); for (let k = 1; k < pts.length; k++) g.lineTo(pts[k]![0], pts[k]![1]); g.strokeStyle = col; g.lineWidth = lw; g.stroke(); };
  const t = i.type ?? 'plain';
  switch (i.slot) {
    case 'head':
      if (t === 'cloth') body(() => poly(g, mirror([[64, 14], [40, 40], [30, 76], [28, 108], [44, 104], [50, 74]])));
      else if (t === 'heavy') {
        body(() => { g.beginPath(); g.moveTo(26, 98); g.lineTo(26, 58); g.quadraticCurveTo(26, 22, 64, 20); g.quadraticCurveTo(102, 22, 102, 58); g.lineTo(102, 98); g.lineTo(76, 108); g.lineTo(52, 108); g.closePath(); });
        line([[38, 64], [90, 64]], ink, 7); line([[64, 64], [64, 100]], ink, 5);
        if (trim) line([[64, 20], [64, 8]], trim, 7);
      } else {
        body(() => { g.beginPath(); g.moveTo(22, 82); g.quadraticCurveTo(24, 30, 64, 28); g.quadraticCurveTo(104, 30, 106, 82); g.lineTo(116, 90); g.lineTo(12, 90); g.closePath(); });
        if (t === 'light') line([[30, 70], [98, 70]], trim ?? shade(base, -0.3), 5);
      }
      if (t === 'cloth' && trim) line([[40, 40], [64, 60], [88, 40]], trim, 4);
      break;
    case 'chest':
      if (t === 'cloth') body(() => poly(g, mirror([[64, 22], [42, 20], [20, 40], [28, 56], [40, 50], [30, 112], [64, 116]])));
      else if (t === 'heavy') {
        body(() => poly(g, mirror([[64, 26], [46, 22], [14, 30], [12, 58], [32, 62], [34, 104], [64, 112]])));
        line([[16, 46], [40, 46]], ink, 4); line([[112, 46], [88, 46]], ink, 4);
        if (trim) line([[48, 70], [64, 82], [80, 70]], trim, 6);
      } else {
        body(() => poly(g, mirror([[64, 30], [46, 20], [22, 34], [24, 56], [38, 54], [38, 106], [64, 108]])));
        line([[64, 30], [64, 106]], t === 'light' ? ink : shade(base, -0.3), 4);
        if (trim) line([[46, 20], [64, 46], [82, 20]], trim, 5);
      }
      break;
    case 'legs':
      if (t === 'heavy') {
        body(() => poly(g, mirror([[64, 18], [32, 18], [28, 110], [52, 110], [60, 50], [64, 50]])));
        line([[32, 60], [56, 60]], ink, 4); line([[96, 60], [72, 60]], ink, 4);
      } else body(() => poly(g, mirror(t === 'cloth' ? [[64, 18], [32, 18], [20, 108], [50, 112], [60, 52], [64, 52]] : [[64, 18], [36, 18], [32, 112], [52, 112], [60, 50], [64, 50]])));
      if (trim) line([[36, 26], [92, 26]], trim, 5);
      break;
    case 'hands':
      for (const sx of [0, 1]) {
        g.save(); if (sx) { g.translate(S, 0); g.scale(-1, 1); }
        if (t === 'heavy') body(() => poly(g, [[16, 40], [52, 34], [58, 70], [54, 104], [22, 106], [12, 74]]));
        else if (t === 'cloth') body(() => poly(g, [[22, 46], [50, 42], [56, 98], [26, 102]]));
        else body(() => { g.beginPath(); g.moveTo(20, 56); g.quadraticCurveTo(20, 30, 38, 30); g.quadraticCurveTo(56, 30, 56, 56); g.lineTo(54, 104); g.lineTo(22, 104); g.closePath(); });
        if (trim) line([[22, 84], [54, 84]], trim, 5);
        g.restore();
      }
      break;
    case 'feet':
      for (const sx of [0, 1]) {
        g.save(); if (sx) { g.translate(S, 0); g.scale(-1, 1); }
        const top = t === 'cloth' ? 70 : t === 'plain' ? 62 : 26;
        body(() => poly(g, [[30, top], [54, top], [56, 96], [60, 108], [14, 110], [12, 96], [28, 90]]));
        if (t === 'heavy') line([[30, 56], [54, 56]], ink, 4);
        if (trim) line([[28, top + 10], [54, top + 10]], trim, 5);
        g.restore();
      }
      break;
    case 'back':
      if (t === 'heavy') body(() => poly(g, mirror([[64, 20], [30, 20], [14, 44], [24, 112], [64, 104]])));
      else if (t === 'cloth') body(() => poly(g, mirror([[64, 26], [26, 24], [10, 70], [40, 64], [64, 92]])));
      else if (t === 'plain') { body(() => poly(g, [[18, 30], [110, 30], [110, 52], [74, 52], [80, 112], [58, 112], [54, 52], [18, 52]])); }
      else body(() => { g.beginPath(); g.moveTo(40, 18); g.lineTo(88, 18); g.quadraticCurveTo(112, 70, 104, 112); g.quadraticCurveTo(64, 100, 24, 112); g.quadraticCurveTo(16, 70, 40, 18); g.closePath(); });
      if (trim) line([[36, 26], [92, 26]], trim, 5);
      break;
    case 'weapon': weapon(g, i.kind ?? 'blade', body, line, ink, trim, fill); break;
    case 'offhand': offhand(g, i.kind ?? 'buckler', body, line, ink, trim, base); break;
  }
  if (i.tier >= 3 || i.named) {
    // a glint: the top tier and named weapons
    g.fillStyle = i.named ? '#fff3c4' : '#f4e8ff';
    star(g, 100, 24, 10); star(g, 22, 104, 6);
  }
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.beginPath();
  for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, rr = k % 2 ? r * 0.3 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

type Body = (path: () => void, lw?: number) => void;
type Line = (pts: P, col: string, lw?: number) => void;

function weapon(g: CanvasRenderingContext2D, kind: string, body: Body, line: Line, ink: string, trim: string | null, fill: CanvasGradient): void {
  const blade = (x0: number, y0: number, x1: number, y1: number, w: number) => {
    const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = -dy / l * w, ny = dx / l * w;
    body(() => poly(g, [[x0 + nx, y0 + ny], [x1 + nx * 0.4, y1 + ny * 0.4], [x1 + dx / l * 10, y1 + dy / l * 10], [x1 - nx * 0.4, y1 - ny * 0.4], [x0 - nx, y0 - ny]]));
  };
  switch (kind) {
    case 'bow':
      g.beginPath(); g.moveTo(40, 12); g.quadraticCurveTo(116, 64, 40, 116); g.lineWidth = 15; g.strokeStyle = ink; g.stroke();
      g.lineWidth = 8; g.strokeStyle = fill; g.stroke();
      line([[40, 12], [40, 116]], 'rgba(255,250,235,.9)', 3);
      if (trim) line([[76, 58], [80, 70]], trim, 8);
      break;
    case 'staff':
      line([[30, 116], [86, 40]], ink, 14); line([[30, 116], [86, 40]], '#8a5a3c', 8);
      body(() => { g.beginPath(); g.arc(92, 32, 20, 0, Math.PI * 2); });
      if (trim) { g.beginPath(); g.arc(92, 32, 27, 0, Math.PI * 2); g.lineWidth = 4; g.strokeStyle = trim; g.stroke(); }
      break;
    case 'daggers':
      blade(36, 108, 76, 26, 8); blade(92, 108, 52, 26, 8);
      line([[22, 96], [48, 108]], ink, 9); line([[106, 96], [80, 108]], ink, 9);
      break;
    case 'greatsword':
      blade(30, 104, 106, 18, 12);
      line([[18, 88], [46, 118]], ink, 12); line([[14, 120], [28, 106]], '#8a5a3c', 9);
      if (trim) line([[46, 88], [86, 46]], trim, 3);
      break;
    case 'sword':
      blade(34, 100, 100, 22, 9);
      line([[22, 86], [48, 112]], ink, 10); line([[18, 118], [32, 104]], '#8a5a3c', 8);
      break;
    default: // blade: a curved sabre
      body(() => { g.beginPath(); g.moveTo(34, 98); g.quadraticCurveTo(72, 70, 108, 16); g.quadraticCurveTo(96, 62, 46, 108); g.closePath(); });
      line([[22, 86], [50, 112]], ink, 10); line([[18, 118], [32, 104]], '#8a5a3c', 8);
      if (trim) line([[56, 84], [92, 40]], trim, 3);
  }
}
function offhand(g: CanvasRenderingContext2D, kind: string, body: Body, line: Line, ink: string, trim: string | null, base: string): void {
  switch (kind) {
    case 'quiver':
      body(() => poly(g, [[44, 40], [84, 40], [88, 116], [40, 116]]));
      for (const x of [52, 64, 76]) { line([[x, 40], [x - 6, 12]], ink, 6); line([[x - 6, 12], [x - 10, 22]], 'rgba(255,250,235,.9)', 4); }
      if (trim) line([[42, 70], [86, 70]], trim, 6);
      break;
    case 'shield':
      body(() => { g.beginPath(); g.moveTo(64, 14); g.lineTo(108, 26); g.quadraticCurveTo(106, 88, 64, 118); g.quadraticCurveTo(22, 88, 20, 26); g.closePath(); });
      line([[64, 24], [64, 104]], trim ?? 'rgba(20,16,40,.4)', 5);
      break;
    case 'tome':
      body(() => poly(g, [[28, 20], [100, 26], [100, 110], [28, 104]]));
      line([[38, 22], [38, 104]], ink, 5);
      if (trim) { line([[52, 50], [88, 52]], trim, 5); line([[52, 66], [80, 67]], trim, 5); }
      else line([[52, 56], [88, 58]], 'rgba(255,250,235,.7)', 4);
      break;
    default: // buckler
      body(() => { g.beginPath(); g.arc(64, 64, 40, 0, Math.PI * 2); });
      g.beginPath(); g.arc(64, 64, 12, 0, Math.PI * 2); g.fillStyle = trim ?? base; g.fill(); g.lineWidth = 5; g.strokeStyle = ink; g.stroke();
  }
}
