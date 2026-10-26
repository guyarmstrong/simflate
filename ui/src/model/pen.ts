// Pen tool shapes: anchor points joined by straight lines or Bézier curves
// (like Illustrator's pen), or a freehand stroke smoothed into the same form.
// Anchors are kept in the shape's local space, so the matrix scales, rotates
// and stretches them exactly like any other shape.

import type { Vec2 } from './geometry';
import { makeShape, type Contour, type Shape } from './shapes';

/** A pen anchor: where the line passes, and its two curve handles (absent =
 *  a sharp corner on that side). Handles are absolute positions. */
export interface Anchor {
  p: Vec2;
  in?: Vec2;
  out?: Vec2;
}

export interface PenPath {
  anchors: Anchor[];
  closed: boolean;
}

const CURVE_STEPS = 32;

function bezier(a: Vec2, b: Vec2, c: Vec2, d: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return [k0 * a[0] + k1 * b[0] + k2 * c[0] + k3 * d[0], k0 * a[1] + k1 * b[1] + k2 * c[1] + k3 * d[1]];
}

/** The pen path as a polyline: straight runs stay two points, curves are sampled. */
export function flattenPen(path: PenPath): Contour {
  const { anchors, closed } = path;
  const pts: Vec2[] = [];
  const n = anchors.length;
  if (!n) return { pts, closed };
  const segs = closed ? n : n - 1;
  pts.push(anchors[0].p);
  for (let i = 0; i < segs; i++) {
    const a = anchors[i];
    const b = anchors[(i + 1) % n];
    if (a.out || b.in) {
      const c1 = a.out ?? a.p;
      const c2 = b.in ?? b.p;
      for (let k = 1; k <= CURVE_STEPS; k++) pts.push(bezier(a.p, c1, c2, b.p, k / CURVE_STEPS));
    } else {
      pts.push(b.p);
    }
  }
  // A closed path ends back on its first point: drop the repeat.
  if (closed && pts.length > 1) pts.pop();
  return { pts, closed };
}

const shift = (q: Vec2 | undefined, c: Vec2): Vec2 | undefined => (q ? [q[0] - c[0], q[1] - c[1]] : undefined);

/** A pen shape from anchors drawn in world mm. Closed → an outline; open →
 *  a weld line (the usual rule for open lines). */
export function makePenShape(anchors: Anchor[], closed: boolean): Shape {
  const all = anchors.flatMap((a) => [a.p, ...(a.in ? [a.in] : []), ...(a.out ? [a.out] : [])]);
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  const c: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const local = anchors.map((a) => ({ p: shift(a.p, c)!, in: shift(a.in, c), out: shift(a.out, c) }));
  return makeShape('pen', c, { pen: { anchors: local, closed }, name: closed ? 'Pen shape' : 'Pen line' });
}

/** Douglas–Peucker: keep only the points that matter at this tolerance. */
function simplify(pts: Vec2[], tol: number): Vec2[] {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const dx = bx - ax;
    const dy = by - ay;
    const l = Math.hypot(dx, dy) || 1e-12;
    let best = -1;
    let bd = tol;
    for (let k = i + 1; k < j; k++) {
      // Ends on top of each other (a closed loop): distance from that point.
      const d = l < tol ? Math.hypot(pts[k][0] - ax, pts[k][1] - ay) : Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / l;
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (best > 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/**
 * A freehand stroke as smooth pen anchors: thin the points out, then run a
 * Catmull-Rom curve through them. Sharp turns (over 70°) stay corners, so a
 * quick zig-zag keeps its points.
 */
export function smoothStroke(raw: Vec2[], closed: boolean, tol: number): Anchor[] {
  let pts = simplify(raw, tol);
  if (closed && pts.length > 2) {
    const [f, l] = [pts[0], pts[pts.length - 1]];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < tol * 4) pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 3) closed = false;
  return pts.map((p, i) => {
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!hasPrev || !hasNext || n < 3) {
      // Open ends: a handle pointing at the neighbour, a third of the way.
      const q = hasNext ? pts[i + 1] : hasPrev ? pts[i - 1] : p;
      const h: Vec2 = [p[0] + (q[0] - p[0]) / 3, p[1] + (q[1] - p[1]) / 3];
      return hasNext ? { p, out: n < 3 ? undefined : h } : { p, in: n < 3 ? undefined : h };
    }
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const t1 = Math.atan2(p[1] - a[1], p[0] - a[0]);
    const t2 = Math.atan2(b[1] - p[1], b[0] - p[0]);
    let turn = Math.abs(t2 - t1);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > (70 * Math.PI) / 180) return { p };
    const tx = (b[0] - a[0]) / 6;
    const ty = (b[1] - a[1]) / 6;
    return { p, in: [p[0] - tx, p[1] - ty] as Vec2, out: [p[0] + tx, p[1] + ty] as Vec2 };
  });
}
