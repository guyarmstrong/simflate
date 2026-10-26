// SVG → contours (mm). Paths (all commands incl. arcs), rect, circle,
// ellipse, line, polyline, polygon — with group transforms applied.

import type { Vec2 } from '../model/geometry';
import type { Contour } from '../model/shapes';
import { joinChains, type SourcedContour } from './chains';
import type { ImportResult } from './importDxf';
import { sourceKey } from './lineTypes';

const PX_TO_MM = 25.4 / 96;

export function importSvg(text: string): ImportResult {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Could not read this SVG file');

  // Mount off-screen so the browser resolves transforms and units for us.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden;width:10px;height:10px;overflow:hidden';
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  const vb = svg.viewBox?.baseVal;
  let unitNote = 'Sized from the SVG (96 px = 1 inch)';
  if (!svg.getAttribute('width') || !svg.getAttribute('height') || svg.getAttribute('width')!.endsWith('%')) {
    if (vb && vb.width > 0) {
      svg.setAttribute('width', String(vb.width));
      svg.setAttribute('height', String(vb.height));
    }
  } else if (/mm|cm|in|pt$/.test(svg.getAttribute('width')!)) {
    unitNote = `File units: ${svg.getAttribute('width')!.replace(/[\d.\s]/g, '')}`;
  }
  host.appendChild(svg);
  document.body.appendChild(host);

  const parts: SourcedContour[] = [];
  const sources: ImportResult['sources'] = new Map();
  try {
    const els = svg.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon');
    els.forEach((el) => {
      if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) return;
      const g = el as SVGGraphicsElement;
      const m = g.getCTM();
      if (!m) return;
      const xf = (p: Vec2): Vec2 => {
        const x = m.a * p[0] + m.c * p[1] + m.e;
        const y = m.b * p[0] + m.d * p[1] + m.f;
        return [x * PX_TO_MM, -y * PX_TO_MM]; // flip: SVG is Y-down, the board is Y-up
      };
      // Lines are told apart by stroke colour and by layer (a top-level
      // group, as Illustrator and Inkscape write them).
      const st = getComputedStyle(el);
      const color = cssHex(st.stroke && st.stroke !== 'none' ? st.stroke : st.fill);
      const layer = layerName(el, svg);
      const src = sourceKey(layer, color);
      if (!sources.has(src)) sources.set(src, { label: layer, color, hidden: hiddenInFile(el, svg) });
      for (const c of elementContours(el)) parts.push({ closed: c.closed, pts: c.pts.map(xf), src });
    });
  } finally {
    host.remove();
  }
  return { contours: joinChains(parts, 0.05), unitNote, sources };
}

/** Hidden in the file itself (the off-screen copy we measure is all hidden). */
function hiddenInFile(el: Element, svg: Element): boolean {
  for (let e: Element | null = el; e && e !== svg; e = e.parentElement) {
    const style = (e.getAttribute('style') ?? '').replace(/\s/g, '');
    if (e.getAttribute('display') === 'none' || e.getAttribute('visibility') === 'hidden' || /display:none|visibility:hidden/.test(style)) return true;
  }
  return false;
}

function layerName(el: Element, svg: Element): string {
  let g: Element | null = el;
  while (g && g.parentElement && g.parentElement !== svg) g = g.parentElement;
  if (!g || g === el) return 'Drawing';
  return g.getAttribute('inkscape:label') ?? g.getAttribute('data-name') ?? g.getAttribute('id') ?? 'Drawing';
}

function cssHex(c: string | null | undefined): string {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(c ?? '');
  if (!m) return '#ffffff';
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

function num(el: Element, a: string): number {
  return parseFloat(el.getAttribute(a) ?? '0') || 0;
}

function elementContours(el: Element): Contour[] {
  switch (el.nodeName.toLowerCase()) {
    case 'rect': {
      const x = num(el, 'x');
      const y = num(el, 'y');
      const w = num(el, 'width');
      const h = num(el, 'height');
      let rx = num(el, 'rx');
      let ry = num(el, 'ry');
      if (!el.hasAttribute('ry')) ry = rx;
      if (!el.hasAttribute('rx')) rx = ry;
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx > 0 && ry > 0) {
        const d = `M${x + rx},${y}H${x + w - rx}A${rx},${ry} 0 0 1 ${x + w},${y + ry}V${y + h - ry}A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}H${x + rx}A${rx},${ry} 0 0 1 ${x},${y + h - ry}V${y + ry}A${rx},${ry} 0 0 1 ${x + rx},${y}Z`;
        return parsePath(d);
      }
      return [{ pts: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true }];
    }
    case 'circle':
    case 'ellipse': {
      const cx = num(el, 'cx');
      const cy = num(el, 'cy');
      const rx = el.nodeName === 'circle' ? num(el, 'r') : num(el, 'rx');
      const ry = el.nodeName === 'circle' ? num(el, 'r') : num(el, 'ry');
      const pts: Vec2[] = [];
      for (let i = 0; i < 180; i++) {
        const a = (2 * Math.PI * i) / 180;
        pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
      }
      return [{ pts, closed: true }];
    }
    case 'line':
      return [{ pts: [[num(el, 'x1'), num(el, 'y1')], [num(el, 'x2'), num(el, 'y2')]], closed: false }];
    case 'polyline':
    case 'polygon': {
      const n = (el.getAttribute('points') ?? '').match(/-?[\d.]+(?:e-?\d+)?/gi)?.map(Number) ?? [];
      const pts: Vec2[] = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return [{ pts, closed: el.nodeName === 'polygon' }];
    }
    case 'path':
      return parsePath(el.getAttribute('d') ?? '');
  }
  return [];
}

/** Parse SVG path data into flattened contours. */
export function parsePath(d: string): Contour[] {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const out: Contour[] = [];
  let i = 0;
  let cmd = '';
  let cur: Vec2 = [0, 0];
  let start: Vec2 = [0, 0];
  let lastCtrl: Vec2 | null = null;
  let lastQ: Vec2 | null = null;
  let pts: Vec2[] = [];
  const isCmd = (t: string) => /^[a-zA-Z]$/.test(t);
  const n = () => parseFloat(tokens[i++]);
  // Arc flags are single digits and may run straight on into the next
  // number ("a40 40 0 1180 0" = flags 1, 1 then 80): SVGO and some
  // Illustrator exports write them like that.
  const flag = () => {
    const t = tokens[i] ?? '';
    if (t.length > 1 && (t[0] === '0' || t[0] === '1')) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    i++;
    return parseFloat(t);
  };
  const flush = (closed: boolean) => {
    if (pts.length > 1) out.push({ pts, closed });
    pts = [];
  };
  const STEPS = 24;

  while (i < tokens.length) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const base: Vec2 = rel ? cur : [0, 0];
    switch (cmd.toUpperCase()) {
      case 'M': {
        flush(false);
        cur = [base[0] + n(), base[1] + n()];
        start = cur;
        pts = [cur];
        cmd = rel ? 'l' : 'L';
        lastCtrl = lastQ = null;
        break;
      }
      case 'L':
        cur = [base[0] + n(), base[1] + n()];
        pts.push(cur);
        lastCtrl = lastQ = null;
        break;
      case 'H':
        cur = [(rel ? cur[0] : 0) + n(), cur[1]];
        pts.push(cur);
        lastCtrl = lastQ = null;
        break;
      case 'V':
        cur = [cur[0], (rel ? cur[1] : 0) + n()];
        pts.push(cur);
        lastCtrl = lastQ = null;
        break;
      case 'C':
      case 'S': {
        let c1: Vec2;
        if (cmd.toUpperCase() === 'C') c1 = [base[0] + n(), base[1] + n()];
        else c1 = lastCtrl ? [2 * cur[0] - lastCtrl[0], 2 * cur[1] - lastCtrl[1]] : cur;
        const c2: Vec2 = [base[0] + n(), base[1] + n()];
        const e: Vec2 = [base[0] + n(), base[1] + n()];
        for (let k = 1; k <= STEPS; k++) {
          const t = k / STEPS;
          const u = 1 - t;
          pts.push([
            u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
            u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
          ]);
        }
        lastCtrl = c2;
        lastQ = null;
        cur = e;
        break;
      }
      case 'Q':
      case 'T': {
        let c: Vec2;
        if (cmd.toUpperCase() === 'Q') c = [base[0] + n(), base[1] + n()];
        else c = lastQ ? [2 * cur[0] - lastQ[0], 2 * cur[1] - lastQ[1]] : cur;
        const e: Vec2 = [base[0] + n(), base[1] + n()];
        for (let k = 1; k <= STEPS; k++) {
          const t = k / STEPS;
          const u = 1 - t;
          pts.push([u * u * cur[0] + 2 * u * t * c[0] + t * t * e[0], u * u * cur[1] + 2 * u * t * c[1] + t * t * e[1]]);
        }
        lastQ = c;
        lastCtrl = null;
        cur = e;
        break;
      }
      case 'A': {
        const rx = n();
        const ry = n();
        const rot = n();
        const large = flag();
        const sweep = flag();
        const e: Vec2 = [base[0] + n(), base[1] + n()];
        pts.push(...arcToPoints(cur, e, rx, ry, rot, !!large, !!sweep).slice(1));
        cur = e;
        lastCtrl = lastQ = null;
        break;
      }
      case 'Z':
        if (pts.length && Math.hypot(pts[pts.length - 1][0] - start[0], pts[pts.length - 1][1] - start[1]) < 1e-9) pts.pop();
        flush(true);
        cur = start;
        pts = [cur];
        lastCtrl = lastQ = null;
        break;
      default:
        i++;
    }
  }
  flush(false);
  return out;
}

function arcToPoints(p0: Vec2, p1: Vec2, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean): Vec2[] {
  if (rx === 0 || ry === 0) return [p0, p1];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cxp = (co * rx * y1) / ry;
  const cyp = (-co * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 32)));
  const pts: Vec2[] = [];
  for (let k = 0; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
  return pts;
}
