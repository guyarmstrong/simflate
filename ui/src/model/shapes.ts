// Shapes on the drawing board. Each shape has fixed local geometry (centred
// on its own origin) and an affine matrix that places, scales and rotates it.
// Width and length dimensions are always measured on the world X/Y axes from
// the two furthest points, so they stay horizontal/vertical when rotated.

import {
  apply,
  boxCenter,
  boxHeight,
  boxOf,
  boxWidth,
  multiply,
  rotationAbout,
  scaleAbout,
  translate,
  type Box,
  type Mat,
  type Vec2,
} from './geometry';
import { bodyOutline, type BodyParams } from './body';
import { flattenPen, type PenPath } from './pen';
import { starOutline, type StarParams } from './star';

export type ShapeKind = 'rect' | 'circle' | 'ellipse' | 'polygon' | 'triangle' | 'scalene' | 'diamond' | 'pill' | 'body' | 'star' | 'text' | 'path' | 'line' | 'pen';

/** Text tool: what was typed and in which font (the letters' outlines are
 *  kept in `contours`). */
export interface TextParams {
  text: string;
  family: string;
  bold: boolean;
  /** Capital-letter height of the contours before the matrix (mm). */
  cap: number;
}

export interface Contour {
  pts: Vec2[];
  closed: boolean;
}

export interface Shape {
  id: string;
  kind: ShapeKind;
  name: string;
  /** rect / ellipse / circle / triangle / diamond / pill: local width and height (mm). */
  w: number;
  h: number;
  /** polygon: corner count and circumradius (mm). pill: corner radius in
   *  real mm (kept round however the pill is stretched). */
  sides: number;
  radius: number;
  /** path (imported), line (weld line) and text: local contours. */
  contours?: Contour[];
  /** scalene (unequal triangle): its three corners, anticlockwise. */
  tri?: Vec2[];
  /** body (egg / segmented body): its segments. */
  body?: BodyParams;
  /** star: pebble / star / starfish settings (Pebble / star wizard). */
  star?: StarParams;
  text?: TextParams;
  /** pen: its anchors and curve handles (local). */
  pen?: PenPath;
  /** What this line does — see `LineRole`. Unset: closed loops are
   *  outlines, open lines are weld lines. */
  role?: LineRole;
  /** Older projects: true meant construction (now `role`). */
  construction?: boolean;
  /** Imported lines: the file layer/colour they came from (`src` is the key,
   *  `srcLabel` and `srcColor` are only for the Line types dialog — the
   *  board itself never shows file colours). */
  src?: string;
  srcLabel?: string;
  srcColor?: string;
  /** Shapes imported together share a group: a click selects the whole
   *  group, a double-click picks out one line. */
  group?: string;
  matrix: Mat;
  /** Rotation shown in the UI, degrees (kept separately so it reads cleanly). */
  rotation: number;
}

/**
 * outline       the edge of the piece: the two sheets are welded all round it.
 *               A closed outline inside another becomes a welded cut-out.
 * weld          a weld line inside a piece (laser-welded seam that quilts it),
 *               open or closed — a closed weld loop is welded, not cut out.
 * construction  reference only, ignored when inflating (like SolidWorks).
 */
export type LineRole = 'outline' | 'weld' | 'construction';

export const ROLE_NAMES: Record<LineRole, string> = { outline: 'Outline', weld: 'Weld line', construction: 'Construction' };

/** The line type in force for a shape (filling in older files and defaults). */
export function roleOf(s: Shape): LineRole {
  if (s.role) return s.role;
  if (s.construction) return 'construction';
  return localContours(s).every((c) => !c.closed) ? 'weld' : 'outline';
}

export function withRole(s: Shape, role: LineRole): Shape {
  const { construction: _drop, ...rest } = s;
  return { ...rest, role };
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter}`;
}

const KIND_NAMES: Record<ShapeKind, string> = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  triangle: 'Triangle',
  scalene: 'Triangle',
  diamond: 'Diamond',
  pill: 'Pill',
  body: 'Egg',
  star: 'Pebble / star',
  text: 'Text',
  path: 'Imported',
  line: 'Weld line',
  pen: 'Pen shape',
};

export interface ShapeParams {
  w?: number;
  h?: number;
  sides?: number;
  radius?: number;
  contours?: Contour[];
  tri?: Vec2[];
  body?: BodyParams;
  /** star: pebble / star / starfish settings (Pebble / star wizard). */
  star?: StarParams;
  text?: TextParams;
  pen?: PenPath;
  name?: string;
  group?: string;
}

export function makeShape(kind: ShapeKind, at: Vec2, p: ShapeParams): Shape {
  return {
    id: newId(),
    kind,
    name: p.name ?? KIND_NAMES[kind],
    w: p.w ?? 0,
    h: p.h ?? 0,
    sides: p.sides ?? 6,
    radius: p.radius ?? 0,
    contours: p.contours,
    tri: p.tri,
    body: p.body,
    star: p.star,
    text: p.text,
    pen: p.pen,
    group: p.group,
    matrix: translate(at[0], at[1]),
    rotation: 0,
  };
}

const ELLIPSE_SEGMENTS = 180;
const PILL_ARC_SEGMENTS = 24;

/** How much the matrix stretches the shape's own x and y directions. */
export function ownScale(m: Mat): [number, number] {
  return [Math.hypot(m[0], m[1]) || 1, Math.hypot(m[2], m[3]) || 1];
}

/** Uniform size factor of the matrix (for shapes that only scale evenly). */
export function evenScale(m: Mat): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
}

/** A pill's real width, height and (clamped) corner radius in mm. */
export function pillSize(s: Shape): { w: number; h: number; r: number } {
  const [sx, sy] = ownScale(s.matrix);
  const w = s.w * sx;
  const h = s.h * sy;
  return { w, h, r: Math.max(0, Math.min(s.radius, w / 2, h / 2)) };
}

/** Rounded rectangle whose corners stay circular in real mm: built at real
 *  size, then divided by the matrix's own stretch. */
function pillContour(s: Shape): Vec2[] {
  const [sx, sy] = ownScale(s.matrix);
  const { w, h, r } = pillSize(s);
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, (3 * Math.PI) / 2],
  ];
  for (const [cx, cy, a0] of corners) {
    if (r < 1e-6) {
      pts.push([cx, cy]);
      continue;
    }
    for (let i = 0; i <= PILL_ARC_SEGMENTS; i++) {
      // Skip an arc end that coincides with the next arc's start (full round).
      const a = a0 + (Math.PI / 2) * (i / PILL_ARC_SEGMENTS);
      const p: Vec2 = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) pts.push(p);
    }
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6) pts.pop();
  return pts.map(([x, y]) => [x / sx, y / sy]);
}

/** A star's outline is worked out once per set of settings (the board
 *  draws it on every frame). */
const starCache = new WeakMap<StarParams, Vec2[]>();
function starPoints(p: StarParams): Vec2[] {
  let pts = starCache.get(p);
  if (!pts) {
    pts = starOutline(p);
    starCache.set(p, pts);
  }
  return pts;
}

/** Local contours (before the matrix). */
export function localContours(s: Shape): Contour[] {
  switch (s.kind) {
    case 'rect': {
      const w = s.w / 2;
      const h = s.h / 2;
      return [{ pts: [[-w, -h], [w, -h], [w, h], [-w, h]], closed: true }];
    }
    case 'circle':
    case 'ellipse': {
      const pts: Vec2[] = [];
      for (let i = 0; i < ELLIPSE_SEGMENTS; i++) {
        const a = (2 * Math.PI * i) / ELLIPSE_SEGMENTS;
        pts.push([(s.w / 2) * Math.cos(a), (s.h / 2) * Math.sin(a)]);
      }
      return [{ pts, closed: true }];
    }
    case 'polygon': {
      const pts: Vec2[] = [];
      const n = Math.max(3, Math.round(s.sides));
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + (2 * Math.PI * i) / n;
        pts.push([s.radius * Math.cos(a), s.radius * Math.sin(a)]);
      }
      return [{ pts, closed: true }];
    }
    case 'triangle': {
      const w = s.w / 2;
      const h = s.h / 2;
      return [{ pts: [[-w, -h], [w, -h], [0, h]], closed: true }];
    }
    case 'diamond': {
      const w = s.w / 2;
      const h = s.h / 2;
      return [{ pts: [[0, -h], [w, 0], [0, h], [-w, 0]], closed: true }];
    }
    case 'scalene':
      return [{ pts: s.tri ?? [], closed: true }];
    case 'pill':
      return [{ pts: pillContour(s), closed: true }];
    case 'body':
      return s.body ? [{ pts: bodyOutline(s.body), closed: true }] : [];
    case 'star':
      return s.star ? [{ pts: starPoints(s.star), closed: true }] : [];
    case 'text':
    case 'path':
    case 'line':
      return s.contours ?? [];
    case 'pen':
      return s.pen ? [flattenPen(s.pen)] : [];
  }
}

export function worldContours(s: Shape): Contour[] {
  return localContours(s).map((c) => ({ closed: c.closed, pts: c.pts.map((p) => apply(s.matrix, p)) }));
}

/** A straight weld line from a to b (world mm). */
export function makeLine(a: Vec2, b: Vec2): Shape {
  const c: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return makeShape('line', c, { contours: [{ closed: false, pts: [[a[0] - c[0], a[1] - c[1]], [b[0] - c[0], b[1] - c[1]]] }] });
}

/** Exact axis-aligned bounding box in world space. */
export function shapeBox(s: Shape): Box {
  if (s.kind === 'circle' || s.kind === 'ellipse') {
    const [a, b, c, d, e, f] = s.matrix;
    const rx = s.w / 2;
    const ry = s.h / 2;
    const hx = Math.hypot(a * rx, c * ry);
    const hy = Math.hypot(b * rx, d * ry);
    return { minX: e - hx, maxX: e + hx, minY: f - hy, maxY: f + hy };
  }
  return boxOf(worldContours(s).flatMap((c) => c.pts));
}

export function shapesBox(shapes: Shape[]): Box | null {
  if (!shapes.length) return null;
  return shapes.map(shapeBox).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function withMatrix(s: Shape, m: Mat): Shape {
  return { ...s, matrix: multiply(m, s.matrix) };
}

/**
 * Set the width ('x') or length ('y') to exactly `value` mm.
 * Locked: the whole shape scales evenly. Unlocked: only that direction stretches.
 */
/** Shapes that only ever scale evenly (a circle stays a circle, letters keep their proportions). */
export function scalesEvenly(s: Shape): boolean {
  return s.kind === 'circle' || s.kind === 'text';
}

export function setDimension(s: Shape, axis: 'x' | 'y', value: number, locked: boolean): Shape {
  const b = shapeBox(s);
  const cur = axis === 'x' ? boxWidth(b) : boxHeight(b);
  if (!(value > 0) || !(cur > 1e-9)) return s;
  const k = value / cur;
  const c = boxCenter(b);
  const m = locked ? scaleAbout(k, k, c) : axis === 'x' ? scaleAbout(k, 1, c) : scaleAbout(1, k, c);
  return withMatrix(s, m);
}

/** Rotate to an absolute angle (degrees) about the box centre. */
export function setRotation(s: Shape, degrees: number): Shape {
  const delta = ((degrees - s.rotation) * Math.PI) / 180;
  const c = boxCenter(shapeBox(s));
  return { ...withMatrix(s, rotationAbout(delta, c)), rotation: normaliseDeg(degrees) };
}

export function rotateBy(s: Shape, deltaRad: number, about: Vec2): Shape {
  return { ...withMatrix(s, rotationAbout(deltaRad, about)), rotation: normaliseDeg(s.rotation + (deltaRad * 180) / Math.PI) };
}

export function normaliseDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x <= -180) x += 360;
  return Math.abs(x) < 1e-9 ? 0 : x;
}

/** Move so the box's bottom-left (or centre) sits at a position. */
export function setPosition(s: Shape, axis: 'x' | 'y', value: number): Shape {
  const c = boxCenter(shapeBox(s));
  return withMatrix(s, axis === 'x' ? translate(value - c[0], 0) : translate(0, value - c[1]));
}

/** SVG path data for a shape in screen space. */
export function pathData(s: Shape, toScreen: (p: Vec2) => Vec2): string {
  return worldContours(s)
    .map((c) => {
      const pts = c.pts.map(toScreen);
      if (!pts.length) return '';
      return `M${pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L')}${c.closed ? 'Z' : ''}`;
    })
    .join('');
}

const KINDS = new Set(Object.keys(KIND_NAMES));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Shapes from outside the running app (project file, autosave, clipboard,
 *  snapshot): keep the ones that are whole and draw to finite points. A
 *  damaged one used to crash the board, and as the autosave kept it, every
 *  reload crashed again. */
export function checkShapes(raw: unknown): { shapes: Shape[]; dropped: number } {
  if (!Array.isArray(raw)) return { shapes: [], dropped: 0 };
  const shapes: Shape[] = [];
  for (const r of raw) {
    try {
      const s = r as Shape;
      if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !KINDS.has(s.kind)) continue;
      if (!Array.isArray(s.matrix) || s.matrix.length !== 6 || !s.matrix.every(finite)) continue;
      if (![s.w, s.h, s.sides, s.radius].every((v) => v === undefined || finite(v))) continue;
      const fixed: Shape = { ...s, name: typeof s.name === 'string' ? s.name : KIND_NAMES[s.kind], w: s.w ?? 0, h: s.h ?? 0, sides: s.sides ?? 6, radius: s.radius ?? 0, rotation: finite(s.rotation) ? s.rotation : 0 };
      const contours = worldContours(fixed);
      if (!contours.every((c) => Array.isArray(c.pts) && c.pts.every((p) => finite(p[0]) && finite(p[1])))) continue;
      shapes.push(fixed);
    } catch {
      // Damaged: left out.
    }
  }
  return { shapes, dropped: raw.length - shapes.length };
}
