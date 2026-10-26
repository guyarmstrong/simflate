// Distance (mm, measured in the flat cut pattern) from each point to the TIG
// weld — the outline and the holes, where the two sheets' edges are welded —
// and how far along that weld the nearest point is (mm), for the bead's
// ripples. Internal laser weld lines are not included: they leave no heat
// tint.
//
// Mesh UVs are the flat pattern scaled to 0–1 across its longer side from
// its lower-left corner (`flat_uvs` in blown-core), and the flat pattern's
// box is the outline's box, so a point's flat position is lo + uv · span.

import type { Vec2 } from '../model/geometry';

/** Beyond this, a point is "far" (the shader only looks within ~20 mm). */
export const TIG_FAR = 1000;
/** Spacing of the TIG pulses (ripples) along the bead, mm. The same
 *  everywhere; each loop's length is stretched by a hair so it holds a whole
 *  number of pulses (no half pulse where the loop closes). */
export const TIG_PITCH = 1.6;
/** TIG_PITCH as a GLSL float literal, for the shaders. */
export const TIG_PITCH_GLSL = TIG_PITCH.toFixed(3);
const REACH = 40;

export interface TigFields {
  /** Distance to the weld, mm. */
  dist: Float32Array;
  /** Position along the weld, mm. */
  along: Float32Array;
}

export function tigDistances(uv: Float32Array, outlines: Vec2[][]): TigFields {
  const n = uv.length / 2;
  const dist = new Float32Array(n).fill(TIG_FAR);
  const along = new Float32Array(n);
  const pts = outlines.flat();
  if (!pts.length) return { dist, along };
  let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
  for (const [x, y] of pts) {
    lx = Math.min(lx, x);
    ly = Math.min(ly, y);
    hx = Math.max(hx, x);
    hy = Math.max(hy, y);
  }
  const span = Math.max(hx - lx, hy - ly, 1e-9);

  // Segments (with the arc length where each starts) into a grid of
  // REACH-sized cells.
  const cell = REACH;
  const grid = new Map<string, number[]>();
  // x0, y0, x1, y1, position along the weld at the start, its stretch.
  const segs: [number, number, number, number, number, number][] = [];
  for (const loop of outlines) {
    let total = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const fit = total > 0 ? (Math.max(1, Math.round(total / TIG_PITCH)) * TIG_PITCH) / total : 1;
    let s0 = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i];
      const b = loop[(i + 1) % loop.length];
      const k = segs.length;
      segs.push([a[0], a[1], b[0], b[1], s0, fit]);
      s0 += Math.hypot(b[0] - a[0], b[1] - a[1]) * fit;
      const x0 = Math.floor(Math.min(a[0], b[0]) / cell), x1 = Math.floor(Math.max(a[0], b[0]) / cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / cell), y1 = Math.floor(Math.max(a[1], b[1]) / cell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = `${gx},${gy}`;
          let list = grid.get(key);
          if (!list) grid.set(key, (list = []));
          list.push(k);
        }
    }
  }

  for (let i = 0; i < n; i++) {
    const px = lx + uv[i * 2] * span;
    const py = ly + uv[i * 2 + 1] * span;
    const gx = Math.floor(px / cell);
    const gy = Math.floor(py / cell);
    let best = TIG_FAR * TIG_FAR;
    let bestS = 0;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${gx + dx},${gy + dy}`);
        if (!list) continue;
        for (const k of list) {
          const [ax, ay, bx, by, s0, fit] = segs[k];
          const ex = bx - ax, ey = by - ay;
          const l2 = ex * ex + ey * ey;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2)) : 0;
          const qx = ax + ex * t - px, qy = ay + ey * t - py;
          const d2 = qx * qx + qy * qy;
          if (d2 < best) {
            best = d2;
            bestS = s0 + t * Math.sqrt(l2) * fit;
          }
        }
      }
    dist[i] = Math.min(Math.sqrt(best), TIG_FAR);
    along[i] = bestS;
  }
  return { dist, along };
}
