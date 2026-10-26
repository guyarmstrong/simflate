// Shape builder (like Illustrator's): overlapping closed shapes are cut into
// the separate regions they make. Merge regions (click, or drag across them)
// into one shape, or delete them (Alt). Whatever comes out is a fixed outline
// — like an imported DXF, it can be moved, scaled, stretched and rotated, but
// its own sizes (radius, corners …) are gone.

import pc from 'polygon-clipping';
import type { MultiPolygon, Polygon, Ring } from 'polygon-clipping';
import { boxOf, pointInPolygon, signedArea, type Vec2 } from './geometry';
import { makeShape, roleOf, withRole, worldContours, type Contour, type Shape } from './shapes';

export interface Face {
  /** Outer ring, then holes (world mm, open rings: last ≠ first). */
  rings: Vec2[][];
  /** Ids of the shapes this region lies inside. */
  sources: string[];
}

/** Shapes the builder works on: closed outlines (not weld lines or construction). */
export function canBuild(s: Shape): boolean {
  return roleOf(s) === 'outline' && worldContours(s).some((c) => c.closed && c.pts.length > 2);
}

const toRing = (pts: Vec2[]): Ring => [...pts, pts[0]];
const fromRing = (r: Ring): Vec2[] => r.slice(0, -1).map(([x, y]) => [x, y] as Vec2);

/** A shape's filled area: its closed contours, odd-even (so holes stay holes). */
function areaOf(s: Shape): MultiPolygon {
  const rings = worldContours(s)
    .filter((c) => c.closed && c.pts.length > 2 && Math.abs(signedArea(c.pts)) > 1e-9)
    .map((c) => [toRing(c.pts)] as Polygon);
  if (!rings.length) return [];
  return rings.length === 1 ? [rings[0]] : pc.xor(rings[0], ...rings.slice(1));
}

function polyArea(p: Polygon): number {
  return p.reduce((a, r, i) => a + (i ? -1 : 1) * Math.abs(signedArea(fromRing(r))), 0);
}

/** Cut the shapes into the regions they make (each region one connected piece). */
export function buildFaces(shapes: Shape[]): Face[] {
  let faces: { geom: Polygon; sources: string[] }[] = [];
  let total = 0;
  for (const s of shapes) {
    const g = areaOf(s);
    if (!g.length) continue;
    total += g.reduce((a, p) => a + polyArea(p), 0);
    const next: typeof faces = [];
    for (const f of faces) {
      for (const p of pc.intersection(f.geom, g)) next.push({ geom: p, sources: [...f.sources, s.id] });
      for (const p of pc.difference(f.geom, g)) next.push({ geom: p, sources: f.sources });
    }
    const rest = faces.length ? pc.difference(g, ...faces.map((f) => f.geom)) : g;
    for (const p of rest) next.push({ geom: p, sources: [s.id] });
    faces = next;
  }
  // Drop slivers left by rounding where edges run along each other.
  const min = Math.max(1e-6, total * 1e-7);
  return faces.filter((f) => polyArea(f.geom) > min).map((f) => ({ rings: f.geom.map(fromRing), sources: f.sources }));
}

export function faceAt(faces: Face[], p: Vec2): number {
  return faces.findIndex((f) => pointInPolygon(p, f.rings[0]) && !f.rings.slice(1).some((h) => pointInPolygon(p, h)));
}

/** A fixed-outline shape from world-space contours. */
function builtShape(contours: Vec2[][], name: string): Shape {
  const b = boxOf(contours.flat());
  const c: Vec2 = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  const local: Contour[] = contours.map((pts) => ({ closed: true, pts: pts.map(([x, y]) => [x - c[0], y - c[1]] as Vec2) }));
  return withRole(makeShape('path', c, { contours: local, name }), 'outline');
}

/**
 * Merge (or, with `erase`, delete) the picked regions. Shapes that overlap
 * others, or had a region picked, are replaced by their regions; shapes that
 * overlap nothing and weren't picked stay exactly as they were.
 */
export function applyBuild(shapes: Shape[], faces: Face[], picked: number[], erase: boolean): { shapes: Shape[]; made: string[] } {
  const pick = new Set(picked);
  const consumed = new Set<string>();
  faces.forEach((f, i) => {
    if (f.sources.length > 1 || pick.has(i)) f.sources.forEach((id) => consumed.add(id));
  });
  // A shape is consumed with all of its regions.
  const added: Shape[] = [];
  if (!erase && pick.size) {
    const polys = [...pick].map((i) => faces[i].rings.map(toRing) as Polygon);
    const merged = polys.length === 1 ? [polys[0]] : pc.union(polys[0], ...polys.slice(1));
    added.push(builtShape(merged.flatMap((p) => p.map(fromRing)), 'Built shape'));
  }
  faces.forEach((f, i) => {
    if (pick.has(i) || !f.sources.some((id) => consumed.has(id))) return;
    added.push(builtShape(f.rings, 'Built shape'));
  });
  // New shapes go where the first consumed shape was (keeps the list order).
  const at = shapes.findIndex((s) => consumed.has(s.id));
  const kept = shapes.filter((s) => !consumed.has(s.id));
  const insert = at < 0 ? kept.length : shapes.slice(0, at).filter((s) => !consumed.has(s.id)).length;
  return { shapes: [...kept.slice(0, insert), ...added, ...kept.slice(insert)], made: added.map((s) => s.id) };
}
