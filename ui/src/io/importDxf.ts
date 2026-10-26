// DXF → contours (mm). Handles LINE, LWPOLYLINE/POLYLINE (with bulges), ARC,
// CIRCLE, ELLIPSE and SPLINE, including ones inside block INSERTs.

import DxfParser from 'dxf-parser';
import type { Vec2 } from '../model/geometry';
import type { Contour } from '../model/shapes';
import { arcPoints, joinChains, type SourcedContour } from './chains';
import { sourceKey } from './lineTypes';

// $INSUNITS code → mm per unit.
const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };

export interface ImportResult {
  /** Each contour knows the layer / colour it was drawn on (`src`). */
  contours: SourcedContour[];
  unitNote: string;
  /** Layer / colour of each `src` key, for the Line types dialog. */
  sources: Map<string, { label: string; color: string; hidden?: boolean }>;
}

type Xf = (p: Vec2) => Vec2;
/** Layer and colour a block's "BYLAYER on layer 0" / "BYBLOCK" contents inherit. */
interface Ctx {
  layer: string;
  color: number;
}

/** Entities whose own plane faces down (extrusion 0,0,−1): what AutoCAD's
 *  MIRROR makes of arcs, circles and polylines. Their coordinates are in that
 *  flipped plane, so x runs the other way. dxf-parser drops the extrusion for
 *  some types, so each handler is wrapped to read it from the groups it used. */
const FLIPPED = Symbol('flipped');

function keepExtrusion(parser: any) {
  const handlers: Record<string, any> | undefined = parser._entityHandlers;
  if (!handlers) return;
  for (const name of Object.keys(handlers)) {
    const inner = handlers[name];
    handlers[name] = {
      ForEntityName: inner.ForEntityName,
      parseEntity(scanner: any, curr: any) {
        const start: unknown = scanner._pointer;
        const e = inner.parseEntity(scanner, curr);
        const data: unknown = scanner._data;
        const end: unknown = scanner._pointer;
        if (e && typeof start === 'number' && typeof end === 'number' && Array.isArray(data)) {
          // Only the entity's own groups, up to its first VERTEX (a POLYLINE's children).
          for (let k = start; k + 1 < end; k += 2) {
            const code = parseInt(data[k]);
            if (code === 0) break;
            if (code === 230 && parseFloat(data[k + 1]) < 0) e[FLIPPED] = true;
          }
        }
        return e;
      },
    };
  }
}

export function importDxf(text: string): ImportResult {
  const parser = new DxfParser();
  keepExtrusion(parser);
  const dxf: any = parser.parseSync(text);
  if (!dxf) throw new Error('Could not read this DXF file');
  const code = dxf.header?.$INSUNITS as number | undefined;
  const mm = code && UNIT_MM[code] ? UNIT_MM[code] : 1;
  const unitNote = code && UNIT_MM[code] ? `File units: ${unitName(code)}` : 'No units in file — assumed millimetres';

  const layers: Record<string, any> = dxf.tables?.layer?.layers ?? {};
  const sources: ImportResult['sources'] = new Map();
  // CAD rules: colour 0 = BYBLOCK, 256 (or none) = BYLAYER; entities on
  // layer 0 inside a block take the insert's layer.
  const resolve = (e: any, ctx: Ctx): Ctx => {
    const layer = !e.layer || (e.layer === '0' && ctx.layer !== '0') ? ctx.layer : e.layer;
    let color: number;
    if (e.colorIndex === 0) color = ctx.color;
    else if (typeof e.color === 'number' && e.colorIndex !== 256) color = e.color;
    else color = typeof layers[layer]?.color === 'number' ? layers[layer].color : 0xffffff;
    return { layer, color };
  };

  const parts: SourcedContour[] = [];
  const walk = (entities: any[], xf: Xf, depth: number, ctx: Ctx) => {
    for (const e of entities ?? []) {
      // Print layouts (title blocks, frames) and hidden entities aren't the drawing.
      if (e.inPaperSpace || e.visible === false) continue;
      const here = resolve(e, ctx);
      // Mirrored plane (see FLIPPED): ellipses and splines are already in
      // world coordinates; LINE has no plane of its own.
      const ocsFlip = !!e[FLIPPED] && !['LINE', 'ELLIPSE', 'SPLINE'].includes(e.type);
      const exf: Xf = ocsFlip ? (p) => xf([-p[0], p[1]]) : xf;
      if (e.type === 'INSERT' && depth < 8) {
        const block = dxf.blocks?.[e.name];
        if (!block) continue;
        const sx = e.xScale ?? 1;
        const sy = e.yScale ?? 1;
        const rot = ((e.rotation ?? 0) * Math.PI) / 180;
        const bp = block.position ?? { x: 0, y: 0 };
        const ins = e.position ?? { x: 0, y: 0 };
        const cos = Math.cos(rot);
        const sin = Math.sin(rot);
        const inner: Xf = (p) => {
          const x = (p[0] - bp.x) * sx;
          const y = (p[1] - bp.y) * sy;
          return exf([ins.x + x * cos - y * sin, ins.y + x * sin + y * cos]);
        };
        walk(block.entities, inner, depth + 1, here);
        continue;
      }
      const c = entityToContour(e, !!e[FLIPPED]);
      if (!c) continue;
      const color = `#${(here.color & 0xffffff).toString(16).padStart(6, '0')}`;
      const src = sourceKey(here.layer, color);
      if (!sources.has(src)) {
        const l = layers[here.layer];
        sources.set(src, { label: here.layer, color, hidden: l ? l.visible === false || l.frozen === true : false });
      }
      parts.push({ closed: c.closed, pts: c.pts.map(exf), src });
    }
  };
  walk(dxf.entities, (p) => [p[0] * mm, p[1] * mm], 0, { layer: '0', color: 0xffffff });
  return { contours: joinChains(parts, 0.05), unitNote, sources };
}

function unitName(code: number) {
  return ({ 1: 'inches', 2: 'feet', 4: 'millimetres', 5: 'centimetres', 6: 'metres', 8: 'microinches', 9: 'mils', 10: 'yards' } as Record<number, string>)[code] ?? 'unknown';
}

function entityToContour(e: any, flipped: boolean): Contour | null {
  switch (e.type) {
    case 'LINE':
      return { pts: e.vertices.map((v: any) => [v.x, v.y]), closed: false };
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const vs = (e.vertices ?? []).filter((v: any) => !v.splineFrameControlPoint);
      if (vs.length < 2) return null;
      const closed = !!(e.shape || e.closed);
      const pts: Vec2[] = [];
      const n = vs.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = vs[i];
        const b = vs[(i + 1) % n];
        pts.push([a.x, a.y]);
        if (a.bulge) pts.push(...bulgeArc([a.x, a.y], [b.x, b.y], a.bulge).slice(1, -1));
      }
      if (!closed) pts.push([vs[n - 1].x, vs[n - 1].y]);
      return { pts, closed };
    }
    case 'CIRCLE':
      return { pts: arcPoints(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI).slice(0, -1), closed: true };
    case 'ARC': {
      let a0 = e.startAngle;
      let a1 = e.endAngle;
      if (a1 < a0) a1 += 2 * Math.PI;
      return { pts: arcPoints(e.center.x, e.center.y, e.radius, a0, a1), closed: false };
    }
    case 'ELLIPSE': {
      const mx = e.majorAxisEndPoint.x;
      const my = e.majorAxisEndPoint.y;
      const ra = Math.hypot(mx, my);
      const rb = ra * e.axisRatio;
      const rot = Math.atan2(my, mx);
      let t0 = e.startAngle ?? 0;
      let t1 = e.endAngle ?? 2 * Math.PI;
      if (t1 <= t0) t1 += 2 * Math.PI;
      const full = Math.abs(t1 - t0 - 2 * Math.PI) < 1e-6;
      const n = Math.max(16, Math.ceil(((t1 - t0) / (2 * Math.PI)) * 180));
      const pts: Vec2[] = [];
      for (let i = 0; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        const x = ra * Math.cos(t);
        // A mirrored ellipse runs the other way round from its major axis.
        const y = (flipped ? -rb : rb) * Math.sin(t);
        pts.push([e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot)]);
      }
      return full ? { pts: pts.slice(0, -1), closed: true } : { pts, closed: false };
    }
    case 'SPLINE':
      return splineToContour(e);
    default:
      return null;
  }
}

function bulgeArc(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord < 1e-12) return [a, b];
  const r = chord / (2 * Math.sin(theta / 2));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const d = r * Math.cos(theta / 2);
  const nx = -(b[1] - a[1]) / chord;
  const ny = (b[0] - a[0]) / chord;
  const cx = mx + nx * d;
  const cy = my + ny * d;
  const a0 = Math.atan2(a[1] - cy, a[0] - cx);
  return arcPoints(cx, cy, Math.abs(r), a0, a0 + theta);
}

function splineToContour(e: any): Contour | null {
  const ctrl: Vec2[] = (e.controlPoints ?? []).map((p: any) => [p.x, p.y]);
  const closed = !!(e.closed || (e.flags ?? 0) & 1);
  if (ctrl.length < 2) {
    const fit: Vec2[] = (e.fitPoints ?? []).map((p: any) => [p.x, p.y]);
    return fit.length >= 2 ? { pts: fit, closed } : null;
  }
  const deg = e.degree ?? 3;
  const knots: number[] = e.knotValues ?? [];
  const weights: number[] | undefined = e.weights;
  if (knots.length !== ctrl.length + deg + 1) return { pts: ctrl, closed };
  const t0 = knots[deg];
  const t1 = knots[knots.length - deg - 1];
  const n = Math.max(32, ctrl.length * 12);
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(deBoor(t0 + ((t1 - t0) * i) / n, deg, ctrl, knots, weights));
  return { pts: closed ? pts.slice(0, -1) : pts, closed };
}

function deBoor(t: number, p: number, ctrl: Vec2[], knots: number[], w?: number[]): Vec2 {
  let k = p;
  while (k < knots.length - p - 2 && t >= knots[k + 1]) k++;
  const d: [number, number, number][] = [];
  for (let j = 0; j <= p; j++) {
    const c = ctrl[j + k - p];
    const wt = w?.[j + k - p] ?? 1;
    d.push([c[0] * wt, c[1] * wt, wt]);
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = j + k - p;
      const den = knots[i + p - r + 1] - knots[i];
      const a = den === 0 ? 0 : (t - knots[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}
