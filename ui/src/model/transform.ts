// Operations on a selection of shapes (one or many), about their shared box.

import { boxCenter, boxHeight, boxWidth, multiply, rotationAbout, scaleAbout, translate, type Box, type Mat } from './geometry';
import { normaliseDeg, scalesEvenly, shapeBox, type Shape } from './shapes';

export function selectionBox(shapes: Shape[], ids: string[]): Box | null {
  const sel = shapes.filter((s) => ids.includes(s.id));
  if (!sel.length) return null;
  return sel.map(shapeBox).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function transformSelected(shapes: Shape[], ids: string[], m: Mat, rotationDelta = 0): Shape[] {
  return shapes.map((s) =>
    ids.includes(s.id) ? { ...s, matrix: multiply(m, s.matrix), rotation: normaliseDeg(s.rotation + rotationDelta) } : s,
  );
}

/** Type a width ('x') or length ('y') for the selection. */
export function setSelectionDimension(shapes: Shape[], ids: string[], axis: 'x' | 'y', value: number, locked: boolean): Shape[] {
  const b = selectionBox(shapes, ids);
  if (!b || !(value > 0)) return shapes;
  const cur = axis === 'x' ? boxWidth(b) : boxHeight(b);
  if (!(cur > 1e-9)) return shapes;
  const k = value / cur;
  const c = boxCenter(b);
  // Circles and letters only scale evenly, whatever the lock says.
  if (shapes.some((s) => ids.includes(s.id) && scalesEvenly(s))) locked = true;
  const m = locked ? scaleAbout(k, k, c) : axis === 'x' ? scaleAbout(k, 1, c) : scaleAbout(1, k, c);
  return transformSelected(shapes, ids, m);
}

export function moveSelectionTo(shapes: Shape[], ids: string[], axis: 'x' | 'y', value: number): Shape[] {
  const b = selectionBox(shapes, ids);
  if (!b) return shapes;
  const c = boxCenter(b);
  return transformSelected(shapes, ids, axis === 'x' ? translate(value - c[0], 0) : translate(0, value - c[1]));
}

/** Rotate the selection to an absolute angle (uses the first shape's angle as reference). */
export function rotateSelectionTo(shapes: Shape[], ids: string[], degrees: number): Shape[] {
  const b = selectionBox(shapes, ids);
  const first = shapes.find((s) => ids.includes(s.id));
  if (!b || !first) return shapes;
  const delta = degrees - first.rotation;
  return transformSelected(shapes, ids, rotationAbout((delta * Math.PI) / 180, boxCenter(b)), delta);
}

export type Align = 'left' | 'centreX' | 'right' | 'top' | 'middleY' | 'bottom';

/**
 * What moves together when aligning: an imported group whose lines are all
 * selected moves as one piece; everything else moves shape by shape.
 */
export function alignUnits(shapes: Shape[], ids: string[]): string[][] {
  const units = new Map<string, string[]>();
  for (const s of shapes) {
    if (!ids.includes(s.id)) continue;
    const whole = s.group && shapes.every((o) => o.group !== s.group || ids.includes(o.id));
    const key = whole ? `g:${s.group}` : `s:${s.id}`;
    if (!units.has(key)) units.set(key, []);
    units.get(key)!.push(s.id);
  }
  return [...units.values()];
}

/** Line the selected shapes up on one edge or centre of the selection's box (like Illustrator). */
export function alignSelection(shapes: Shape[], ids: string[], how: Align): Shape[] {
  const all = selectionBox(shapes, ids);
  if (!all) return shapes;
  let out = shapes;
  for (const unit of alignUnits(shapes, ids)) {
    const b = selectionBox(shapes, unit)!;
    let dx = 0;
    let dy = 0;
    if (how === 'left') dx = all.minX - b.minX;
    else if (how === 'right') dx = all.maxX - b.maxX;
    else if (how === 'centreX') dx = boxCenter(all)[0] - boxCenter(b)[0];
    else if (how === 'bottom') dy = all.minY - b.minY;
    else if (how === 'top') dy = all.maxY - b.maxY;
    else dy = boxCenter(all)[1] - boxCenter(b)[1];
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) out = transformSelected(out, unit, translate(dx, dy));
  }
  return out;
}
