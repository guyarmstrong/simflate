// Specified geometric tucks in mm (session 17): converting older forms'
// shares into mm, and how fine the mesh is for a given tuck width.

import { signedArea, type Vec2 } from './geometry';
import type { Piece } from './pieces';
import type { InflateSettings, Quality } from './presets';

/** Side length (mm) the tuck count refers to (TUCK_REF_MM in geometric.rs). */
const TUCK_REF_MM = 300;

/** Points per sheet for each mesh (draft/medium/final/xfine_vertices in config.rs). */
const MESH_POINTS: Record<Quality, number> = { draft: 1600, medium: 4000, final: 9000, xfine: 36000 };

/** Weld edge lengths between corners (turns over 35°), as geometric.rs splits them. */
function edgeLengths(pieces: Piece[]): number[] {
  const out: number[] = [];
  const cos35 = Math.cos((35 * Math.PI) / 180);
  const turns = (a: Vec2, b: Vec2, c: Vec2) => {
    const u = [b[0] - a[0], b[1] - a[1]];
    const v = [c[0] - b[0], c[1] - b[1]];
    const l = Math.max(Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]), 1e-12);
    return (u[0] * v[0] + u[1] * v[1]) / l < cos35;
  };
  const lines: [Vec2[], boolean][] = pieces.flatMap((p) => [[p.outer, true] as [Vec2[], boolean], ...p.holes.map((h) => [h, true] as [Vec2[], boolean]), ...p.seams.map((s) => [s, false] as [Vec2[], boolean])]);
  for (const [pts, closed] of lines) {
    const n = pts.length;
    if (n < 2) continue;
    const nseg = closed ? n : n - 1;
    const corners = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (closed ? turns(pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]) : i > 0 && i + 1 < n && turns(pts[i - 1], pts[i], pts[i + 1])) corners.add(i);
    }
    const start = closed ? ([...corners][0] ?? 0) : 0;
    let s = 0;
    for (let k = 0; k < nseg; k++) {
      const i = (start + k) % n;
      if (k > 0 && corners.has(i)) {
        out.push(s);
        s = 0;
      }
      const [a, b] = [pts[i], pts[(i + 1) % n]];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    out.push(s);
  }
  return out.filter((l) => l > 1);
}

/** Round outline: no closed weld line (outlines, cut-outs) turns by more
 *  than 35° anywhere — circles, ellipses, pills. Round mode's Auto
 *  (is_round in geometric.rs). */
export function isRoundOutline(pieces: Piece[]): boolean {
  const cos35 = Math.cos((35 * Math.PI) / 180);
  const loops = pieces.flatMap((p) => [p.outer, ...p.holes]);
  return (
    loops.length > 0 &&
    loops.every((pts) => {
      const n = pts.length;
      if (n < 3) return false;
      for (let i = 0; i < n; i++) {
        const [a, b, c] = [pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]];
        const u = [b[0] - a[0], b[1] - a[1]];
        const v = [c[0] - b[0], c[1] - b[1]];
        const l = Math.max(Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]), 1e-12);
        if ((u[0] * v[0] + u[1] * v[1]) / l < cos35) return false;
      }
      return true;
    })
  );
}

/** An older form's tuck shares as mm, on its typical (median) side. */
export function legacyTuckMm(pieces: Piece[], s: InflateSettings): Pick<InflateSettings, 'tuckWidthMm' | 'tuckLengthMm' | 'valleyDepthMm'> {
  const lens = edgeLengths(pieces).sort((a, b) => a - b);
  const side = lens.length ? lens[Math.floor(lens.length / 2)] : TUCK_REF_MM;
  const scaling = Math.min(1, Math.max(-1, s.tuckScaling));
  const k = s.wavesPerEdge > 0 ? Math.max(1, Math.round(s.wavesPerEdge * Math.pow(side / TUCK_REF_MM, scaling))) : 0;
  const gap = k > 0 ? side / k : side;
  const w = Math.min(1, Math.max(0.05, s.tuckWidth)) * gap;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    tuckWidthMm: r1(w),
    tuckLengthMm: r1(Math.min(4, Math.max(0.2, s.tuckLength)) * w),
    valleyDepthMm: r1(0.35 * Math.min(1, Math.max(0, s.waveDepth)) * w),
  };
}

/** Rough distance (mm) between mesh points for these pieces at this mesh. */
export function meshSpacingMm(pieces: Piece[], quality: Quality): number {
  const area = pieces.reduce((a, p) => a + Math.abs(signedArea(p.outer)) - p.holes.reduce((h, q) => h + Math.abs(signedArea(q)), 0), 0);
  return Math.sqrt((2 * Math.max(area, 1)) / (Math.sqrt(3) * MESH_POINTS[quality]));
}

/** Mesh points a tuck needs across it to show as a shape. */
export const POINTS_PER_TUCK = 4;

/** The coarsest mesh that shows tucks this wide, or null if even X fine is too coarse. */
export function meshForTucks(pieces: Piece[], widthMm: number): Quality | null {
  for (const q of ['draft', 'medium', 'final', 'xfine'] as Quality[]) {
    if (meshSpacingMm(pieces, q) * POINTS_PER_TUCK <= widthMm) return q;
  }
  return null;
}
