// Unequal triangles: built from a base and its two angles, then edited one
// side or one corner at a time on the board.
//
// Corners are numbered anticlockwise; side i runs from corner i to corner i+1.
// Typing a side length keeps corner i, the side's direction and the other side
// at corner i (so only the far corner slides). Typing a corner's angle keeps
// that corner and both sides' lengths there, and swings the second side round
// (like opening a hinge).

import { apply, deg, rad, translate, type Vec2 } from './geometry';
import type { Shape } from './shapes';

/** Corners for a base along the bottom and the angles (degrees) at its two
 *  ends, centred on their box. Null when the angles can't make a triangle. */
export function triFromBase(base: number, leftDeg: number, rightDeg: number): Vec2[] | null {
  const a = rad(leftDeg);
  const b = rad(rightDeg);
  if (!(base > 0) || !(a > 0) || !(b > 0) || leftDeg + rightDeg >= 179.9) return null;
  const left = (base * Math.sin(b)) / Math.sin(a + b);
  const apex: Vec2 = [left * Math.cos(a), left * Math.sin(a)];
  const pts: Vec2[] = [[0, 0], [base, 0], apex];
  return centre(pts);
}

function centre(pts: Vec2[]): Vec2[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}

/** The triangle's corners on the board (world mm), anticlockwise. */
export function triCorners(s: Shape): Vec2[] {
  const pts = (s.tri ?? []).map((p) => apply(s.matrix, p));
  // A mirrored matrix flips the winding; put it back to anticlockwise.
  const area = pts.length === 3 ? (pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1]) : 1;
  return area < 0 ? [pts[0], pts[2], pts[1]] : pts;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function triSides(c: Vec2[]): number[] {
  return [0, 1, 2].map((i) => dist(c[i], c[(i + 1) % 3]));
}

/** Inside angle at each corner (degrees). */
export function triAngles(c: Vec2[]): number[] {
  return [0, 1, 2].map((i) => {
    const p = c[i];
    const a = c[(i + 1) % 3];
    const b = c[(i + 2) % 3];
    const u = Math.atan2(a[1] - p[1], a[0] - p[0]);
    const v = Math.atan2(b[1] - p[1], b[0] - p[0]);
    let d = Math.abs(deg(u - v)) % 360;
    if (d > 180) d = 360 - d;
    return d;
  });
}

/** Corner and side names, as shown on the board and in the boxes. */
export const CORNERS = ['A', 'B', 'C'];
export const SIDES = ['AB', 'BC', 'CA'];

/** Put new world corners back into the shape (matrix becomes a plain move). */
export function withCorners(s: Shape, c: Vec2[]): Shape {
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  const mid: Vec2 = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return { ...s, tri: c.map(([x, y]) => [x - mid[0], y - mid[1]]), matrix: translate(mid[0], mid[1]) };
}

/** After an edit, turn the triangle about corner A so side AB points the way
 *  it did before: typing a number never spins the triangle round. */
function keepBase(before: Vec2[], after: Vec2[]): Vec2[] {
  const turn =
    Math.atan2(before[1][1] - before[0][1], before[1][0] - before[0][0]) - Math.atan2(after[1][1] - after[0][1], after[1][0] - after[0][0]);
  const [ox, oy] = after[0];
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  return after.map(([x, y]) => [ox + (x - ox) * cos - (y - oy) * sin, oy + (x - ox) * sin + (y - oy) * cos]);
}

/** Side i (corner i → corner i+1) made `len` long: corner i, the side's
 *  direction and the other side at corner i stay; corner i+1 slides. */
export function triWithSide(c: Vec2[], i: number, len: number): Vec2[] | null {
  if (!(len > 0)) return null;
  const p = c[i];
  const q = c[(i + 1) % 3];
  const d = dist(p, q) || 1;
  const out = [...c];
  out[(i + 1) % 3] = [p[0] + ((q[0] - p[0]) / d) * len, p[1] + ((q[1] - p[1]) / d) * len];
  return keepBase(c, out);
}

/** Inside angle at corner i made `degrees`: corner i, its first side and the
 *  second side's length stay; the second side swings round (a hinge). */
export function triWithAngle(c: Vec2[], i: number, degrees: number): Vec2[] | null {
  if (!(degrees > 0.5) || degrees >= 179.5) return null;
  const p = c[i];
  const a = c[(i + 1) % 3];
  const b = c[(i + 2) % 3];
  // Anticlockwise corners: the second side lies anticlockwise of the first.
  const ang = Math.atan2(a[1] - p[1], a[0] - p[0]) + rad(degrees);
  const l = dist(p, b);
  const out = [...c];
  out[(i + 2) % 3] = [p[0] + l * Math.cos(ang), p[1] + l * Math.sin(ang)];
  return keepBase(c, out);
}

export function setTriSide(s: Shape, i: number, len: number): Shape | null {
  const c = triWithSide(triCorners(s), i, len);
  return c && withCorners(s, c);
}

export function setTriAngle(s: Shape, i: number, degrees: number): Shape | null {
  const c = triWithAngle(triCorners(s), i, degrees);
  return c && withCorners(s, c);
}
