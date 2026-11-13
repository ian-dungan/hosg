// Edge markers: an arrow at the screen's edge for each party member in this room who is off screen, pointing
// toward them, with their initial (at most 3, nearest first). Never inside the joystick zone, the ability
// cluster or the frames (the `exclusions`). edgeMarkerLayout is the pure, tested part; createEdgeMarkers is a
// small DOM layer that reuses its three elements (nothing allocated per frame).

/** A world point on screen: x, y in CSS px; front false when it is behind the camera. Written into `out`. */
export interface EdgeCam { project(x: number, y: number, z: number, out: { x: number; y: number; front: boolean }): void; readonly x: number; readonly z: number }
export interface EdgeViewport { w: number; h: number }
/** A party member in this room (world position; `initial` is shown in the arrow). */
export interface EdgeMember { id: number; x: number; y: number; z: number; initial: string }
/** A screen rectangle markers keep out of (CSS px). */
export interface EdgeRect { x0: number; y0: number; x1: number; y1: number }
/** One marker: where its centre is (CSS px), which way it points (rad, 0 = right, clockwise as screen y goes down). */
export interface EdgeMarker { id: number; x: number; y: number; angle: number; initial: string }

/** At most this many markers. */
export const EDGE_MAX = 3;
/** A marker's size (px) and its gap from the screen edge. */
export const EDGE_SIZE = 28;
const MARGIN = EDGE_SIZE / 2 + 6;

const inRect = (r: EdgeRect, x: number, y: number, pad: number) => x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad;

const proj = { x: 0, y: 0, front: true };
const order: { m: EdgeMember; d: number }[] = [];
const byDistance = (a: { m: EdgeMember; d: number }, b: { m: EdgeMember; d: number }) => a.d - b.d || a.m.id - b.m.id;

/**
 * The markers for `members` (an empty list when every one is on screen). A member is on screen when it projects
 * in front of the camera inside the viewport less a margin. Each off-screen member gets one marker on the
 * viewport's edge (inset by the margin) along the line from the centre toward it, moved out of any exclusion
 * along the edge. Nearest first (ground distance from the camera's target), at most EDGE_MAX. Written into
 * `out` (entries reused) and returned.
 */
export function edgeMarkerLayout(cam: EdgeCam, vp: EdgeViewport, members: readonly EdgeMember[], exclusions: readonly EdgeRect[], out: EdgeMarker[] = []): EdgeMarker[] {
  // (the order's entries are reused: nothing is allocated once warm)
  order.length = members.length;
  for (let i = 0; i < members.length; i++) { const m = members[i], o = (order[i] ??= { m, d: 0 }); o.m = m; o.d = Math.hypot(m.x - cam.x, m.z - cam.z); }
  order.sort(byDistance);
  const cx = vp.w / 2, cy = vp.h / 2, x0 = MARGIN, y0 = MARGIN, x1 = vp.w - MARGIN, y1 = vp.h - MARGIN;
  let n = 0;
  for (let i = 0; i < order.length; i++) {
    const m = order[i].m;
    if (n >= EDGE_MAX) break;
    cam.project(m.x, m.y, m.z, proj);
    let dx = proj.x - cx, dy = proj.y - cy;
    if (proj.front && proj.x >= x0 && proj.x <= x1 && proj.y >= y0 && proj.y <= y1) continue; // on screen
    if (!proj.front) { dx = -dx; dy = -dy; } // behind the camera: the projection is mirrored
    if (dx === 0 && dy === 0) dy = 1;
    // where the ray from the centre leaves the inset rectangle
    const sx = dx !== 0 ? (dx > 0 ? x1 - cx : x0 - cx) / dx : Infinity;
    const sy = dy !== 0 ? (dy > 0 ? y1 - cy : y0 - cy) / dy : Infinity;
    const s = Math.min(sx, sy);
    let px = cx + dx * s, py = cy + dy * s;
    const onSide = sx < sy; // on the left or right edge (else top or bottom)
    // out of the exclusions, sliding along the edge (try both ways; the nearer free spot wins)
    for (let pass = 0; pass < 3; pass++) {
      let r: EdgeRect | null = null;
      for (let k = 0; k < exclusions.length && !r; k++) if (inRect(exclusions[k], px, py, EDGE_SIZE / 2)) r = exclusions[k];
      if (!r) break;
      if (onSide) {
        const up = r.y0 - EDGE_SIZE / 2 - 1, down = r.y1 + EDGE_SIZE / 2 + 1;
        const upOk = up >= y0, downOk = down <= y1;
        py = upOk && (!downOk || Math.abs(up - py) <= Math.abs(down - py)) ? up : downOk ? down : Math.max(y0, Math.min(y1, py));
      } else {
        const left = r.x0 - EDGE_SIZE / 2 - 1, right = r.x1 + EDGE_SIZE / 2 + 1;
        const lOk = left >= x0, rOk = right <= x1;
        px = lOk && (!rOk || Math.abs(left - px) <= Math.abs(right - px)) ? left : rOk ? right : Math.max(x0, Math.min(x1, px));
      }
    }
    const o = (out[n] ??= { id: 0, x: 0, y: 0, angle: 0, initial: '' });
    o.id = m.id; o.x = px; o.y = py; o.angle = Math.atan2(dy, dx); o.initial = m.initial;
    n++;
  }
  out.length = n;
  return out;
}

/** The DOM layer: three arrows reused; `update` places them from a layout. */
export function createEdgeMarkers(parent: HTMLElement) {
  const els: { el: HTMLElement; letter: HTMLElement; shown: boolean; initial: string }[] = [];
  for (let i = 0; i < EDGE_MAX; i++) {
    const el = document.createElement('div');
    el.className = 'sg-edge';
    const arrow = document.createElement('i');
    const letter = document.createElement('b');
    el.append(arrow, letter);
    parent.appendChild(el);
    els.push({ el, letter, shown: false, initial: '' });
  }
  return {
    update(markers: readonly EdgeMarker[]) {
      for (let i = 0; i < EDGE_MAX; i++) {
        const e = els[i], m = markers[i];
        const on = !!m;
        if (on !== e.shown) { e.shown = on; e.el.classList.toggle('on', on); }
        if (!m) continue;
        if (m.initial !== e.initial) { e.initial = m.initial; e.letter.textContent = m.initial; }
        e.el.style.transform = `translate(${(m.x - EDGE_SIZE / 2).toFixed(1)}px,${(m.y - EDGE_SIZE / 2).toFixed(1)}px)`;
        e.el.style.setProperty('--a', `${m.angle.toFixed(3)}rad`);
      }
    },
    dispose() { for (const e of els) e.el.remove(); },
  };
}

export const EDGE_CSS = /* css */ `
.sg-edge{position:absolute;left:0;top:0;width:${EDGE_SIZE}px;height:${EDGE_SIZE}px;display:none;pointer-events:none;z-index:3}
.sg-edge.on{display:block}
.sg-modal-open .sg-edge,.sg-hidden .sg-edge{display:none}
.sg-edge i{position:absolute;inset:0;transform:rotate(var(--a,0rad))}
.sg-edge i::before{content:"";position:absolute;left:50%;top:50%;width:${EDGE_SIZE}px;height:${EDGE_SIZE}px;margin:-${EDGE_SIZE / 2}px 0 0 -${EDGE_SIZE / 2}px;border-radius:50% 50% 50% 0;
  transform:rotate(-135deg);background:#3FB0A6;box-shadow:0 0 0 2px rgba(255,250,240,.9),0 2px 6px rgba(0,0,0,.4)}
.sg-edge b{position:absolute;inset:0;display:grid;place-items:center;font:800 13px/1 var(--sans,system-ui);color:#0f2a28;text-shadow:none}
`;
