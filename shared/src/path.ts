// Ground-level route finding for tap-to-walk: A* over a square grid, then smoothed into straight legs.
// Pure maths, no world knowledge: the caller says where an adventurer may walk.

export interface Vec2 { x: number; z: number }
/** cell: grid size in m (0.5). maxNodes: most cells expanded before giving up (20000). snap: how far the goal (or a
 *  start on blocked ground) may move to the nearest passable cell, in m (2). */
export interface PathOpts { cell?: number; maxNodes?: number; snap?: number }

/** Distance between line-of-sight samples when smoothing, in m. */
const SIGHT_STEP = 0.25;
const SQRT2 = Math.SQRT2;
// cell (i, j) -> one number; i and j stay within ±2^20 for any sane cell size and map
const OFF = 1 << 20, SPAN = 1 << 21;
const keyOf = (i: number, j: number) => (i + OFF) * SPAN + (j + OFF);

/** True if every point along a→b (sampled every SIGHT_STEP m, both ends included) is passable. */
function clearLine(a: Vec2, b: Vec2, passable: (x: number, z: number) => boolean): boolean {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(1, Math.ceil(d / SIGHT_STEP));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!passable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
  }
  return true;
}

/** `standable` with a margin: (x, z) and 8 points `r` m around it must all be standable. */
export function withClearance(standable: (x: number, z: number) => boolean, r: number): (x: number, z: number) => boolean {
  const d = r * Math.SQRT1_2;
  const ring = [[r, 0], [-r, 0], [0, r], [0, -r], [d, d], [d, -d], [-d, d], [-d, -d]];
  return (x, z) => {
    if (!standable(x, z)) return false;
    for (const [ox, oz] of ring) if (!standable(x + ox, z + oz)) return false;
    return true;
  };
}

/** Binary min-heap of node ids ordered by f (lazy: stale entries are skipped by the caller). */
class Heap {
  private ids: number[] = [];
  private fs: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, f: number) {
    const ids = this.ids, fs = this.fs;
    let i = ids.length;
    ids.push(id); fs.push(f);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fs[p] <= f) break;
      ids[i] = ids[p]; fs[i] = fs[p]; i = p;
    }
    ids[i] = id; fs[i] = f;
  }
  pop(): number {
    const ids = this.ids, fs = this.fs;
    const top = ids[0];
    const id = ids.pop()!, f = fs.pop()!;
    const n = ids.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const c = l + 1 < n && fs[l + 1] < fs[l] ? l + 1 : l;
        if (fs[c] >= f) break;
        ids[i] = ids[c]; fs[i] = fs[c]; i = c;
      }
      ids[i] = id; fs[i] = f;
    }
    return top;
  }
}

/**
 * Ground-level route from `from` to as near `to` as can be stood on. `passable(x, z)` = may an adventurer walk
 * here without jumping. Returns waypoints (excluding `from`, ending at the reached point) or null if there is no
 * route within the limits.
 */
export function findPath(from: Vec2, to: Vec2, passable: (x: number, z: number) => boolean, opts: PathOpts = {}): Vec2[] | null {
  const cell = opts.cell ?? 0.5, maxNodes = opts.maxNodes ?? 20000, snap = opts.snap ?? 2;

  // nodes, created as the search touches cells; passability is asked once per cell
  const index = new Map<number, number>();
  const ni: number[] = [], nj: number[] = [], ok: boolean[] = [], g: number[] = [], parent: number[] = [], closed: boolean[] = [];
  const node = (i: number, j: number): number => {
    const k = keyOf(i, j);
    let id = index.get(k);
    if (id === undefined) {
      id = ni.length;
      index.set(k, id);
      ni.push(i); nj.push(j); ok.push(passable(i * cell, j * cell)); g.push(Infinity); parent.push(-1); closed.push(false);
    }
    return id;
  };
  const at = (id: number): Vec2 => ({ x: ni[id] * cell, z: nj[id] * cell });

  /** The passable cell nearest p within `snap` m (p's own cell first), or -1. */
  const nearestPassable = (p: Vec2): number => {
    const ci = Math.round(p.x / cell), cj = Math.round(p.z / cell);
    const own = node(ci, cj);
    if (ok[own]) return own;
    const R = Math.ceil(snap / cell);
    let best = -1, bestD = snap * snap;
    for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
      const x = (ci + di) * cell, z = (cj + dj) * cell;
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      if (d2 > bestD) continue;
      const id = node(ci + di, cj + dj);
      if (ok[id] && (best < 0 || d2 < bestD)) { best = id; bestD = d2; }
    }
    return best;
  };

  const goal = nearestPassable(to);
  if (goal < 0) return null;
  const start = nearestPassable(from);
  if (start < 0) return null;
  const end: Vec2 = passable(to.x, to.z) ? { x: to.x, z: to.z } : at(goal);

  // A* with 8 neighbours; a diagonal step needs both cells beside it passable (no cutting corners)
  const gi = ni[goal], gj = nj[goal];
  const h = (id: number) => {
    const dx = Math.abs(ni[id] - gi), dz = Math.abs(nj[id] - gj);
    return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * 1.001; // octile; a hair over, to break ties
  };
  const open = new Heap();
  g[start] = 0;
  open.push(start, h(start));
  let expanded = 0, found = false;
  while (open.size > 0) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) { found = true; break; }
    closed[cur] = true;
    if (++expanded > maxNodes) return null;
    const i = ni[cur], j = nj[cur];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (di === 0 && dj === 0) continue;
      const nb = node(i + di, j + dj);
      if (!ok[nb] || closed[nb]) continue;
      const diag = di !== 0 && dj !== 0;
      if (diag && (!ok[node(i + di, j)] || !ok[node(i, j + dj)])) continue;
      const ng = g[cur] + (diag ? SQRT2 : 1);
      if (ng < g[nb]) { g[nb] = ng; parent[nb] = cur; open.push(nb, ng + h(nb)); }
    }
  }
  if (!found) return null;

  // cells start → goal, keeping only the turns, then the exact end point
  const cells: number[] = [];
  for (let id = goal; id >= 0; id = parent[id]) cells.push(id);
  cells.reverse();
  const raw: Vec2[] = [from];
  for (let k = 0; k < cells.length; k++) {
    const id = cells[k];
    if (k > 0 && k < cells.length - 1) {
      const a = cells[k - 1], b = cells[k + 1];
      if (ni[id] - ni[a] === ni[b] - ni[id] && nj[id] - nj[a] === nj[b] - nj[id]) continue; // straight on
    }
    raw.push(at(id));
  }
  raw.push(end);

  // smooth: from each kept point, go on to the farthest next point still in a clear straight line
  const out: Vec2[] = [];
  let a = 0;
  while (a < raw.length - 1) {
    let k = a + 1;
    while (k + 1 < raw.length && clearLine(raw[a], raw[k + 1], passable)) k++;
    out.push(raw[k]);
    a = k;
  }
  return dedupe(out, from);
}

/** Drops points that repeat the one before (the start cell can be `from` itself, the goal cell the end point). */
function dedupe(pts: Vec2[], from: Vec2): Vec2[] {
  const res: Vec2[] = [];
  let prev = from;
  for (const p of pts) {
    if (Math.hypot(p.x - prev.x, p.z - prev.z) > 1e-6) { res.push(p); prev = p; }
  }
  return res.length ? res : [pts[pts.length - 1]];
}
