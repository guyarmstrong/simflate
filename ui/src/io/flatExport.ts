// The flat drawing out again, as CAD files: SVG (Illustrator, Inkscape) and
// DXF (AutoCAD, laser / waterjet software), in real millimetres. Each line
// type gets its own layer (Outline, Weld, Construction), so a file brought
// back in sorts itself in the Line types dialog. The SVG also carries
// Simflate's own copy of the shapes, so a Ctrl+C / Ctrl+V round trip within
// the app is exact (Illustrator ignores it).

import { boxOf, type Vec2 } from '../model/geometry';
import { roleOf, worldContours, type LineRole, type Shape } from '../model/shapes';

interface Layer {
  role: LineRole;
  name: string;
  /** SVG stroke. */
  stroke: string;
  /** DXF colour number (7 = black / white, 5 = blue, 8 = grey). */
  aci: number;
}

const LAYERS: Layer[] = [
  { role: 'outline', name: 'Outline', stroke: '#000000', aci: 7 },
  { role: 'weld', name: 'Weld', stroke: '#2f6fe0', aci: 5 },
  { role: 'construction', name: 'Construction', stroke: '#9a9a9a', aci: 8 },
];

/** Marks the SVG's copy of the shapes (see `shapesFromSvg`). */
const META_ID = 'simflate-shapes';

const n = (v: number) => {
  const s = v.toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function byLayer(shapes: Shape[]) {
  return LAYERS.map((layer) => ({ layer, shapes: shapes.filter((s) => roleOf(s) === layer.role) })).filter((l) => l.shapes.length);
}

/** SVG in mm (width / height in mm, 1 unit = 1 mm), Y up as on the board. */
export function buildSvg(shapes: Shape[]): string {
  const all = shapes.flatMap((s) => worldContours(s).flatMap((c) => c.pts));
  const b = boxOf(all.length ? all : [[0, 0]]);
  const w = Math.max(b.maxX - b.minX, 0.001);
  const h = Math.max(b.maxY - b.minY, 0.001);
  const L: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="${n(b.minX)} ${n(-b.maxY)} ${n(w)} ${n(h)}" overflow="visible">`,
    `<metadata id="${META_ID}">${xml(JSON.stringify(shapes))}</metadata>`,
  ];
  for (const { layer, shapes: group } of byLayer(shapes)) {
    const dash = layer.role === 'construction' ? ' stroke-dasharray="2 1.5"' : '';
    L.push(`<g id="${layer.name}" data-name="${layer.name}" fill="none" stroke="${layer.stroke}" stroke-width="0.25"${dash}>`);
    for (const s of group) {
      const d = worldContours(s)
        .filter((c) => c.pts.length >= 2)
        .map((c) => `M${c.pts.map((p) => `${n(p[0])},${n(-p[1])}`).join('L')}${c.closed ? 'Z' : ''}`)
        .join('');
      if (d) L.push(`<path id="${xml(s.id)}" d="${d}"/>`);
    }
    L.push('</g>');
  }
  L.push('</svg>');
  return L.join('\n') + '\n';
}

/** Simflate's own shapes inside an SVG made by `buildSvg`, or null. */
export function shapesFromSvg(text: string): unknown[] | null {
  if (!text.includes(META_ID)) return null;
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const meta = doc.getElementById(META_ID);
    const shapes = meta ? JSON.parse(meta.textContent ?? '') : null;
    return Array.isArray(shapes) ? shapes : null;
  } catch {
    return null;
  }
}

/** A circle placed without stretching or skewing: centre and radius (mm). */
function trueCircle(s: Shape): { c: Vec2; r: number } | null {
  if (s.kind !== 'circle') return null;
  const [a, b, c, d, e, f] = s.matrix;
  const sx = Math.hypot(a, b);
  const sy = Math.hypot(c, d);
  if (Math.abs(sx - sy) > 1e-6 * sx || Math.abs(a * c + b * d) > 1e-6 * sx * sy || a * d - b * c <= 0) return null;
  return { c: [e, f], r: (s.w / 2) * sx };
}

/** DXF (AutoCAD R12, the version every CAD and cutting program reads), mm. */
export function buildDxf(shapes: Shape[]): string {
  const L: (string | number)[] = [];
  const g = (code: number, value: string | number) => L.push(code, typeof value === 'number' ? n(value) : value);
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, 4); // millimetres
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  const layers = byLayer(shapes);
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layers.length);
  for (const { layer } of layers) {
    g(0, 'LAYER'); g(2, layer.name.toUpperCase()); g(70, 0); g(62, layer.aci); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const { layer, shapes: group } of layers) {
    const name = layer.name.toUpperCase();
    for (const s of group) {
      const circle = trueCircle(s);
      if (circle) {
        g(0, 'CIRCLE'); g(8, name); g(10, circle.c[0]); g(20, circle.c[1]); g(30, 0); g(40, circle.r);
        continue;
      }
      for (const c of worldContours(s)) {
        if (c.pts.length < 2) continue;
        g(0, 'POLYLINE'); g(8, name); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, c.closed ? 1 : 0);
        for (const p of c.pts) {
          g(0, 'VERTEX'); g(8, name); g(10, p[0]); g(20, p[1]); g(30, 0);
        }
        g(0, 'SEQEND'); g(8, name);
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return L.join('\n') + '\n';
}
