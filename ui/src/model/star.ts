// Pebble / star shapes (Guy, session 20; from his Star Generator V4): tips
// on an outer circle and valleys on an inner one, joined by straight or
// bowed edges, with the tips and valleys rounded off. Brought close together
// (inner near 100 %), rounded right off and given some organic variation,
// the same controls make pebbles; far apart, stars; with flowing edges and
// rounded tips, starfish.

import type { Vec2 } from './geometry';

export type EdgeStyle = 'sharp' | 'rounded' | 'flowing' | 'wavy';

export interface StarParams {
  /** Name shown on the board (the preset's, or "Pebble / star"). */
  name: string;
  /** Number of tips, 2–24. */
  points: number;
  /** Across the tips (outer circle), mm. */
  size: number;
  /** Valley circle as a % of the tip circle (100: no valleys — a polygon or, rounded, a pebble). */
  inner: number;
  /** Straight edges, or bowed out (rounded), in (flowing) or into an S (wavy). */
  edge: EdgeStyle;
  /** How far the edges bow, 0–100. */
  curvature: number;
  /** Rounding of the tips and of the valleys, 0–100. */
  tipRound: number;
  valleyRound: number;
  /** Organic variation, 0–100: tips (fully), valleys and spacing (a little)
   *  vary from one to the next, from `seed`. 0 = regular. */
  variation: number;
  seed: number;
}

export const STAR_PRESETS: StarParams[] = [
  { name: 'Pebble', points: 5, size: 300, inner: 84, edge: 'rounded', curvature: 60, tipRound: 100, valleyRound: 100, variation: 45, seed: 3 },
  { name: 'Starfish', points: 5, size: 300, inner: 36, edge: 'flowing', curvature: 35, tipRound: 75, valleyRound: 60, variation: 30, seed: 7 },
  { name: 'Star', points: 6, size: 300, inner: 57.7, edge: 'sharp', curvature: 0, tipRound: 0, valleyRound: 0, variation: 0, seed: 1 },
];

/** Same seed, same shape. */
function random(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state / 4294967296) * 2 - 1;
  };
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function quad(a: Vec2, c: Vec2, b: Vec2, steps: number, out: Vec2[]) {
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
}

function cubic(a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, steps: number, out: Vec2[]) {
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    out.push([
      u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
      u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1],
    ]);
  }
}

/** The outline (mm, centred on the middle, first tip straight up), anticlockwise. */
export function starOutline(p: StarParams): Vec2[] {
  const n = Math.max(2, Math.min(24, Math.round(p.points)));
  const outer = Math.max(0.5, p.size / 2);
  const inner = (outer * Math.max(1, Math.min(100, p.inner))) / 100;
  const vary = p.variation > 0 ? Math.min(100, p.variation) / 100 : 0;
  const rnd = random(p.seed);
  const step = Math.PI / n;

  const verts: { at: Vec2; tip: boolean }[] = [];
  for (let i = 0; i < 2 * n; i++) {
    const tip = i % 2 === 0;
    let r = tip ? outer : inner;
    let a = Math.PI / 2 + i * step;
    if (vary) {
      r *= 1 + rnd() * vary * (tip ? 0.32 : 0.14);
      a += rnd() * vary * step * 0.22;
    }
    verts.push({ at: [Math.cos(a) * r, Math.sin(a) * r], tip });
  }

  // Each corner is cut back along both its edges and replaced by a curve.
  const m = verts.length;
  const cuts = verts.map((v, i) => {
    const prev = verts[(i - 1 + m) % m].at;
    const next = verts[(i + 1) % m].at;
    const round = Math.max(0, Math.min(100, v.tip ? p.tipRound : p.valleyRound)) / 100;
    const cut = Math.min(dist(v.at, prev), dist(v.at, next)) * 0.46 * round;
    return {
      start: dist(v.at, prev) ? lerp(v.at, prev, cut / dist(v.at, prev)) : v.at,
      end: dist(v.at, next) ? lerp(v.at, next, cut / dist(v.at, next)) : v.at,
      round: cut > 1e-9,
    };
  });

  // Inside angle at each corner (0…2π): tips are sharp, valleys reflex.
  const angles = verts.map((v, i) => {
    const prev = verts[(i - 1 + m) % m].at;
    const next = verts[(i + 1) % m].at;
    const u: Vec2 = [next[0] - v.at[0], next[1] - v.at[1]];
    const w: Vec2 = [prev[0] - v.at[0], prev[1] - v.at[1]];
    const t = Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]);
    return t < 0 ? t + 2 * Math.PI : t;
  });

  // The outline as straight pieces: corner curve chords (2k) and edges (2k + 1).
  const chords: [Vec2, Vec2][] = cuts.flatMap((c, k): [Vec2, Vec2][] => [
    [c.start, c.end],
    [c.end, cuts[(k + 1) % m].start],
  ]);

  // Each edge (corner i to i + 1) as a cubic: its two inner control points
  // (on the straight line when it doesn't bow).
  const bow = Math.max(0, Math.min(100, p.curvature)) / 100;
  const edges = cuts.map((c, i): [Vec2, Vec2, Vec2, Vec2] => {
    const a = c.end;
    const b = cuts[(i + 1) % m].start;
    const len = dist(a, b);
    if (p.edge === 'sharp' || bow === 0 || len < 1e-9) return [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b];
    // Outward normal (the outline runs anticlockwise: outside is on the right).
    const nx = (b[1] - a[1]) / len;
    const ny = -(b[0] - a[0]) / len;
    // Each end leaves the straight line at an angle; capped at 40 % of the
    // room at that corner (the inside angle when bowing in, the outside one
    // when bowing out), so neighbouring edges can never cross.
    // And the bow (3/4 of the offset, at its deepest) stays under 45 % of
    // the gap to the nearest other edge: the two sides of a thin arm bowing
    // in, or two arms bowing out into the valley between them, never meet.
    // Scaled by how much of the side is still straight edge: rounded right
    // off (a pebble) the corners make the shape and the short edges between
    // them barely tilt; tilting them fully bent the big corner curves into
    // scallops.
    const lean = Math.atan(1.05 * bow) * (len / Math.max(len, dist(verts[i].at, verts[(i + 1) % m].at)));
    const mid = lerp(a, b, 0.5);
    const gap = Math.min(...chords.filter((_, k) => k !== 2 * i + 1).map(([s, e]) => distToSeg(mid, s, e)));
    const off = (t: number, corner: number, s: number): Vec2 => {
      const room = s > 0 ? 2 * Math.PI - angles[corner] : angles[corner];
      const h = Math.min((len / 3) * Math.tan(Math.min(lean, 0.4 * room)), 0.6 * gap);
      const q = lerp(a, b, t);
      return [q[0] + nx * h * s, q[1] + ny * h * s];
    };
    const j = (i + 1) % m;
    const [s1, s2] = p.edge === 'rounded' ? [1, 1] : p.edge === 'flowing' ? [-1, -1] : [1, -1];
    return [a, off(1 / 3, i, s1), off(2 / 3, j, s2), b];
  });

  const unit = (from: Vec2, to: Vec2): Vec2 => {
    const l = dist(from, to);
    return l > 1e-12 ? [(to[0] - from[0]) / l, (to[1] - from[1]) / l] : [0, 0];
  };
  const out: Vec2[] = [];
  for (let i = 0; i < m; i++) {
    const v = verts[i];
    const c = cuts[i];
    if (c.round) {
      // The rounded corner leaves each edge in the edge's own direction (a
      // bowed edge arrives at an angle to the straight line: a corner curve
      // aimed at the old corner point left a small nub on pebbles).
      // Aimed at where the two edge directions meet (the old corner point
      // when the edges are straight); if they don't meet sensibly, at the
      // corner point.
      const tin = unit(edges[(i - 1 + m) % m][2], c.start);
      const tout = unit(c.end, edges[i][1]);
      const d: Vec2 = [c.end[0] - c.start[0], c.end[1] - c.start[1]];
      const den = tin[0] * tout[1] - tin[1] * tout[0];
      let ctl = v.at;
      if (Math.abs(den) > 1e-9) {
        const s = (d[0] * tout[1] - d[1] * tout[0]) / den;
        const t = (tin[0] * d[1] - tin[1] * d[0]) / den;
        if (s > 0 && t > 0 && s < 2 * dist(c.start, v.at) && t < 2 * dist(c.end, v.at)) ctl = [c.start[0] + tin[0] * s, c.start[1] + tin[1] * s];
      }
      out.push(c.start);
      quad(c.start, ctl, c.end, 10, out);
    } else out.push(v.at);
    const e = edges[i];
    if (p.edge !== 'sharp' && bow > 0) {
      cubic(e[0], e[1], e[2], e[3], 14, out);
      out.pop(); // the next corner starts here
    }
  }

  // Tidy: no repeated points; centre the outline on its own box.
  const pts = out.filter((q, i) => dist(q, out[(i + 1) % out.length]) > 1e-6);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [x - cx, y - cy]);
}
