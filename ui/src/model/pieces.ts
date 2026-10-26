// Turn the drawing into weldable pieces. Every contour is a weld unless it is
// construction:
//   outermost closed outline → perimeter of a piece
//   closed outline inside it → welded cut-out (hole)
//   closed outline inside a hole → a new, separate piece
//   weld line (open, or a closed weld loop) inside a piece → weld seam
// Anything that would leak (open perimeter, crossing welds) is reported.

import { pointInPolygon, polylinesCross, selfIntersects, signedArea, type Vec2 } from './geometry';
import { roleOf, worldContours, type Shape } from './shapes';

export interface Piece {
  outer: Vec2[];
  holes: Vec2[][];
  seams: Vec2[][];
}

export interface Problem {
  shapeId: string;
  message: string;
}

export interface PieceReport {
  pieces: Piece[];
  problems: Problem[];
}

interface Loop {
  shapeId: string;
  pts: Vec2[];
  area: number;
  depth: number;
  parent: number;
  piece: number;
}

export function buildPieces(shapes: Shape[]): PieceReport {
  const problems: Problem[] = [];
  const loops: Loop[] = [];
  const lines: { shapeId: string; pts: Vec2[] }[] = [];

  for (const s of shapes) {
    const role = roleOf(s);
    if (role === 'construction') continue;
    for (const c of worldContours(s)) {
      if (c.pts.length < 2) continue;
      if (role === 'weld') {
        // A closed weld loop goes to the mesher as a seam that comes back to
        // its start: welded round, not cut out.
        lines.push({ shapeId: s.id, pts: c.closed && c.pts.length > 2 ? [...c.pts, c.pts[0]] : c.pts });
      } else if (c.closed) {
        if (c.pts.length < 3 || Math.abs(signedArea(c.pts)) < 1e-6) continue;
        if (selfIntersects(c.pts, true)) {
          problems.push({ shapeId: s.id, message: `${s.name} crosses itself — the weld would leak` });
          continue;
        }
        loops.push({ shapeId: s.id, pts: c.pts, area: Math.abs(signedArea(c.pts)), depth: 0, parent: -1, piece: -1 });
      } else {
        lines.push({ shapeId: s.id, pts: c.pts });
      }
    }
  }

  // Crossing welds can't be meshed — flag both shapes.
  const crossed = new Set<number>();
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      if (polylinesCross(loops[i].pts, true, loops[j].pts, true)) {
        crossed.add(i);
        crossed.add(j);
        const a = shapes.find((s) => s.id === loops[i].shapeId)?.name ?? 'shape';
        const b = shapes.find((s) => s.id === loops[j].shapeId)?.name ?? 'shape';
        problems.push({ shapeId: loops[i].shapeId, message: `${a} overlaps ${b} — welds can't cross` });
        problems.push({ shapeId: loops[j].shapeId, message: `${b} overlaps ${a} — welds can't cross` });
      }
    }
  }
  const usable = loops.filter((_, i) => !crossed.has(i)).sort((a, b) => b.area - a.area);

  // Nesting: parent = smallest loop containing this one.
  for (let i = 0; i < usable.length; i++) {
    const probe = usable[i].pts[0];
    for (let j = i - 1; j >= 0; j--) {
      if (usable[j].area > usable[i].area && pointInPolygon(probe, usable[j].pts)) {
        usable[i].parent = j;
        usable[i].depth = usable[j].depth + 1;
        break;
      }
    }
  }

  const pieces: Piece[] = [];
  for (const l of usable) {
    if (l.depth % 2 === 0) {
      l.piece = pieces.length;
      pieces.push({ outer: ccw(l.pts), holes: [], seams: [] });
    }
  }
  for (const l of usable) {
    if (l.depth % 2 === 1) {
      l.piece = usable[l.parent].piece;
      pieces[l.piece].holes.push(l.pts);
    }
  }

  for (const line of lines) {
    let host = -1;
    // Test the middle of the first stretch: a weld line usually ends exactly
    // on the outline, where "inside" is a coin toss.
    const probe: Vec2 = [(line.pts[0][0] + line.pts[1][0]) / 2, (line.pts[0][1] + line.pts[1][1]) / 2];
    for (let j = usable.length - 1; j >= 0; j--) {
      if (pointInPolygon(probe, usable[j].pts)) {
        host = j;
        break;
      }
    }
    const name = shapes.find((s) => s.id === line.shapeId)?.name ?? 'Line';
    if (host < 0) {
      problems.push({ shapeId: line.shapeId, message: `${name} is a weld line outside any outline — it would leak. Move it inside an outline, or make it Outline (if closed) or Construction` });
    } else if (usable[host].depth % 2 === 1) {
      problems.push({ shapeId: line.shapeId, message: `${name} sits inside a cut-out and is ignored` });
    } else {
      pieces[usable[host].piece].seams.push(line.pts);
    }
  }

  return { pieces, problems };
}

function ccw(pts: Vec2[]): Vec2[] {
  return signedArea(pts) < 0 ? [...pts].reverse() : pts;
}
