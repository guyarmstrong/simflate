// Line types for imported drawings. A DXF / SVG tells its lines apart by layer
// and colour; each layer+colour combination is one "source", and the person
// says what each source is: outline, weld line, construction — or leaves it
// out. The board never shows file colours; they only appear as swatches in
// the Line types dialog so the person can recognise their own layers.

import { signedArea } from '../model/geometry';
import { localContours, roleOf, type LineRole, type Shape } from '../model/shapes';

/** What to do with a source: a line type, or leave it out of the drawing. */
export type SourceChoice = LineRole | 'leave';

export interface LineSource {
  key: string;
  label: string;
  color: string;
  loops: number;
  lines: number;
  /** Total length, mm. */
  length: number;
  /** Largest closed area, mm² (the outline is usually the biggest loop). */
  biggest: number;
  hidden?: boolean;
}

export function sourceKey(layer: string, color: string): string {
  return `${layer}|${color.toLowerCase()}`;
}

/** The sources present in a set of shapes, biggest first. */
export function sourcesOf(shapes: Shape[]): LineSource[] {
  const map = new Map<string, LineSource>();
  for (const s of shapes) {
    if (!s.src) continue;
    let src = map.get(s.src);
    if (!src) {
      src = { key: s.src, label: s.srcLabel ?? 'Lines', color: s.srcColor ?? '#ffffff', loops: 0, lines: 0, length: 0, biggest: 0 };
      map.set(s.src, src);
    }
    for (const c of localContours(s)) {
      if (c.closed) {
        src.loops += 1;
        src.biggest = Math.max(src.biggest, Math.abs(signedArea(c.pts)));
      } else src.lines += 1;
      for (let i = 1; i < c.pts.length + (c.closed ? 1 : 0); i++) {
        const a = c.pts[i - 1];
        const b = c.pts[i % c.pts.length];
        src.length += Math.hypot(b[0] - a[0], b[1] - a[1]);
      }
    }
  }
  const list = [...map.values()].sort((a, b) => b.biggest - a.biggest || b.length - a.length);
  // Readable names: "Layer 0", and the colour when one layer holds several.
  const perLayer = new Map<string, number>();
  for (const s of list) perLayer.set(s.label, (perLayer.get(s.label) ?? 0) + 1);
  return list.map((s) => {
    const base = /^\d+$/.test(s.label) ? `Layer ${s.label}` : s.label;
    return { ...s, label: perLayer.get(s.label)! > 1 ? `${base} · ${colourName(s.color)}` : base };
  });
}

const NAMES: Record<string, string> = {
  '#ff0000': 'red', '#ffff00': 'yellow', '#00ff00': 'green', '#00ffff': 'cyan', '#0000ff': 'blue', '#ff00ff': 'magenta',
  '#ffffff': 'white', '#000000': 'black', '#808080': 'grey', '#c0c0c0': 'light grey',
};

function colourName(hex: string): string {
  const h = hex.toLowerCase();
  if (NAMES[h]) return NAMES[h];
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx - mn < 0.12) return mx > 0.8 ? 'white' : mx < 0.2 ? 'black' : 'grey';
  const hue = mx === r ? ((g - b) / (mx - mn) + 6) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
  return ['red', 'orange', 'yellow', 'green', 'green', 'cyan', 'cyan', 'blue', 'blue', 'purple', 'magenta', 'pink'][Math.floor(hue * 2) % 12];
}

const WELD = /weld|seam|quilt|stitch|laser/i;
const CONSTRUCTION = /constr|cent(er|re)|axis|dim|text|note|hidden|guide|ref|grid|title|border/i;
const OUTLINE = /outline|outer|outside|profile|perim|cut|edge|shape/i;
const MEMORY = 'blownsim.lineTypes';

function remembered(): Record<string, SourceChoice> {
  try {
    return JSON.parse(localStorage.getItem(MEMORY) ?? '{}');
  } catch {
    return {};
  }
}

/** Keep what the person chose, so the same layers come in the same way next time. */
export function remember(choices: Record<string, SourceChoice>) {
  try {
    localStorage.setItem(MEMORY, JSON.stringify({ ...remembered(), ...choices }));
  } catch {
    /* private window etc. — only a convenience */
  }
}

/**
 * First guess for each source: what the person picked last time for the
 * same layer + colour; else from the layer name; else the source holding
 * the biggest loop is the outline and everything else is a weld line.
 */
export function guessChoices(sources: LineSource[]): Record<string, SourceChoice> {
  const mem = remembered();
  const out: Record<string, SourceChoice> = {};
  const biggest = sources.reduce<LineSource | null>((a, s) => (s.biggest > (a?.biggest ?? 0) ? s : a), null);
  for (const s of sources) {
    if (mem[s.key]) out[s.key] = mem[s.key];
    else if (s.hidden) out[s.key] = 'construction';
    else if (WELD.test(s.label)) out[s.key] = 'weld';
    else if (CONSTRUCTION.test(s.label)) out[s.key] = 'construction';
    else if (OUTLINE.test(s.label) || s === biggest) out[s.key] = 'outline';
    else out[s.key] = 'weld';
  }
  return out;
}

/** The current choices of shapes already on the board (for reopening the dialog). */
export function currentChoices(shapes: Shape[]): Record<string, SourceChoice> {
  const out: Record<string, SourceChoice> = {};
  for (const s of shapes) if (s.src && !out[s.src]) out[s.src] = roleOf(s);
  return out;
}
