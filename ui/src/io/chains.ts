// Join loose polyline pieces end-to-end (within a tolerance) into contours.
// A chain whose ends meet becomes a closed contour. Pieces only join others
// from the same source (file layer / colour), so a weld line drawn on its own
// layer never merges into the outline. Where three or more ends meet (a weld
// line touching the outline at one of its corners, two welds crossing), each
// line carries straight on: ends are paired by the smallest turn, the rest
// stay ends.

import type { Vec2 } from '../model/geometry';
import type { Contour } from '../model/shapes';

export interface SourcedContour extends Contour {
  /** Which file layer / colour this came from (see `LineSource`). */
  src?: string;
}

const close = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;

export function joinChains<T extends SourcedContour>(parts: T[], tol: number): T[] {
  const bySrc = new Map<string | undefined, T[]>();
  for (const p of parts) {
    if (!bySrc.has(p.src)) bySrc.set(p.src, []);
    bySrc.get(p.src)!.push(p);
  }
  const out: T[] = [];
  for (const [src, group] of bySrc) {
    for (const c of joinGroup(group, tol)) out.push({ ...group[0], ...c, src } as T);
  }
  return out;
}

function joinGroup(parts: Contour[], tol: number): Contour[] {
  const done: Contour[] = [];
  const open: Vec2[][] = [];
  for (const p of parts) {
    const pts = dedupe(p.pts, tol * 0.01);
    if (pts.length < 2) continue;
    if (p.closed) done.push({ pts, closed: true });
    else open.push(pts);
  }
  if (!open.length) return done;

  // Ends: id 2i = head of open[i], 2i+1 = tail. `dir` points from the end
  // into its own line.
  const n = open.length;
  const endPt = (e: number): Vec2 => (e & 1 ? open[e >> 1][open[e >> 1].length - 1] : open[e >> 1][0]);
  const endDir = (e: number): Vec2 => {
    const l = open[e >> 1];
    const a = e & 1 ? l[l.length - 1] : l[0];
    const b = e & 1 ? l[l.length - 2] : l[1];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };

  // Group ends that sit on the same spot (grid + union-find).
  const parent = Array.from({ length: 2 * n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = (p: Vec2) => [Math.floor(p[0] / tol), Math.floor(p[1] / tol)];
  const grid = new Map<string, number[]>();
  for (let e = 0; e < 2 * n; e++) {
    const [cx, cy] = cell(endPt(e));
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const o of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (close(endPt(e), endPt(o), tol)) parent[find(e)] = find(o);
    const k = `${cx},${cy}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(e);
  }
  const clusters = new Map<number, number[]>();
  for (let e = 0; e < 2 * n; e++) {
    const r = find(e);
    if (!clusters.has(r)) clusters.set(r, []);
    clusters.get(r)!.push(e);
  }

  // Pair the ends in each cluster: straightest continuation first.
  const partner = new Int32Array(2 * n).fill(-1);
  for (const ends of clusters.values()) {
    if (ends.length < 2) continue;
    const pairs: [number, number, number][] = [];
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        const a = endDir(ends[i]);
        const b = endDir(ends[j]);
        pairs.push([a[0] * b[0] + a[1] * b[1], ends[i], ends[j]]); // −1 = dead straight
      }
    pairs.sort((x, y) => x[0] - y[0]);
    for (const [, a, b] of pairs) {
      if (partner[a] >= 0 || partner[b] >= 0) continue;
      partner[a] = b;
      partner[b] = a;
    }
  }

  // Walk the pairings into chains.
  const used = new Uint8Array(n);
  for (let s = 0; s < n; s++) {
    if (used[s]) continue;
    used[s] = 1;
    let chain = [...open[s]];
    let closed = false;
    // Forward from the tail.
    let e = 2 * s + 1;
    for (;;) {
      const q = partner[e];
      if (q < 0) break;
      const li = q >> 1;
      if (li === s) {
        closed = true;
        break;
      }
      if (used[li]) break;
      used[li] = 1;
      const pts = q & 1 ? [...open[li]].reverse() : open[li];
      chain = [...chain, ...pts.slice(1)];
      e = q ^ 1;
    }
    // Backward from the head.
    e = 2 * s;
    while (!closed) {
      const q = partner[e];
      if (q < 0) break;
      const li = q >> 1;
      if (used[li]) break;
      used[li] = 1;
      const pts = q & 1 ? open[li] : [...open[li]].reverse();
      chain = [...pts.slice(0, -1), ...chain];
      e = q ^ 1;
    }
    if (closed || (chain.length > 3 && close(chain[0], chain[chain.length - 1], tol))) done.push({ pts: chain.slice(0, -1), closed: true });
    else done.push({ pts: chain, closed: false });
  }
  return done.map((c) => ({ ...c, pts: dedupe(c.pts, tol * 0.01) }));
}

function dedupe(pts: Vec2[], tol: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) if (!out.length || !close(out[out.length - 1], p, tol)) out.push(p);
  return out;
}

/** Points on a circular arc from a0 to a1 (radians, CCW if a1 > a0). */
export function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, maxSegAngle = Math.PI / 48): Vec2[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / maxSegAngle));
  const pts: Vec2[] = [];
  for (let i = 0; i < n + 1; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
