// 2D geometry helpers. World space is millimetres, Y up (like CAD).

export type Vec2 = [number, number];

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type Mat = [number, number, number, number, number, number];

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function apply(m: Mat, p: Vec2): Vec2 {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** a ∘ b: apply b first, then a. */
export function multiply(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function translate(dx: number, dy: number): Mat {
  return [1, 0, 0, 1, dx, dy];
}

export function rotationAbout(angleRad: number, c: Vec2): Mat {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return multiply(translate(c[0], c[1]), multiply([cos, sin, -sin, cos, 0, 0], translate(-c[0], -c[1])));
}

export function scaleAbout(sx: number, sy: number, c: Vec2): Mat {
  return multiply(translate(c[0], c[1]), multiply([sx, 0, 0, sy, 0, 0], translate(-c[0], -c[1])));
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function boxOf(points: Vec2[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    if (x < b.minX) b.minX = x;
    if (y < b.minY) b.minY = y;
    if (x > b.maxX) b.maxX = x;
    if (y > b.maxY) b.maxY = y;
  }
  return b;
}

export function unionBox(a: Box, b: Box): Box {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

export const boxWidth = (b: Box) => b.maxX - b.minX;
export const boxHeight = (b: Box) => b.maxY - b.minY;
export const boxCenter = (b: Box): Vec2 => [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];

export function signedArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function orient(a: Vec2, b: Vec2, c: Vec2) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

export function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const d1 = orient(b1, b2, a1);
  const d2 = orient(b1, b2, a2);
  const d3 = orient(a1, a2, b1);
  const d4 = orient(a1, a2, b2);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

/** Segments of a polyline sorted by their left end, for a sweep from left
 *  to right: only segments whose x ranges overlap are ever compared.
 *  Testing every pair took 1.6 s per edit on a 20 000-point import. */
interface Seg {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Which polyline, and which segment of it. */
  line: number;
  i: number;
}

function segments(poly: Vec2[], closed: boolean, line: number, out: Seg[]) {
  const n = poly.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    out.push({ minX: Math.min(p[0], q[0]), maxX: Math.max(p[0], q[0]), minY: Math.min(p[1], q[1]), maxY: Math.max(p[1], q[1]), line, i });
  }
}

/** Sweep: true as soon as `test` says a pair of overlapping segments crosses. */
function sweep(segs: Seg[], test: (a: Seg, b: Seg) => boolean): boolean {
  segs.sort((a, b) => a.minX - b.minX);
  for (let k = 0; k < segs.length; k++) {
    const a = segs[k];
    for (let m = k + 1; m < segs.length && segs[m].minX <= a.maxX; m++) {
      const b = segs[m];
      if (b.minY > a.maxY || a.minY > b.maxY) continue;
      if (test(a, b)) return true;
    }
  }
  return false;
}

/** Does a polyline cross itself? (Neighbouring segments share a point and don't count.) */
export function selfIntersects(poly: Vec2[], closed: boolean): boolean {
  const n = poly.length;
  const last = (closed ? n : n - 1) - 1;
  const segs: Seg[] = [];
  segments(poly, closed, 0, segs);
  return sweep(segs, (a, b) => {
    const [i, j] = a.i < b.i ? [a.i, b.i] : [b.i, a.i];
    if (j - i < 2 || (closed && i === 0 && j === last)) return false;
    return segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n]);
  });
}

/** Do two polylines cross each other? */
export function polylinesCross(a: Vec2[], aClosed: boolean, b: Vec2[], bClosed: boolean): boolean {
  const ba = boxOf(a);
  const bb = boxOf(b);
  if (ba.maxX < bb.minX || bb.maxX < ba.minX || ba.maxY < bb.minY || bb.maxY < ba.minY) return false;
  const lines = [a, b];
  const segs: Seg[] = [];
  segments(a, aClosed, 0, segs);
  segments(b, bClosed, 1, segs);
  return sweep(segs, (s, t) => {
    if (s.line === t.line) return false;
    const [p, q] = s.line === 0 ? [s, t] : [t, s];
    const pa = lines[0];
    const pb = lines[1];
    return segmentsCross(pa[p.i], pa[(p.i + 1) % pa.length], pb[q.i], pb[(q.i + 1) % pb.length]);
  });
}

export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;

/** Round for display: 0.1 mm, without trailing ".0". */
export function fmt(mm: number | null | undefined, digits = 1): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return '–';
  const r = Number(mm.toFixed(digits));
  return Object.is(r, -0) ? '0' : String(r);
}
