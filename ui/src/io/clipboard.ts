// Copy / paste on the drawing board. BlownSim's own shapes travel as marked
// text; shapes copied in Illustrator or Word arrive as SVG (read natively by
// the desktop app, see src-tauri/src/clip.rs) and go through the SVG importer.

import { isDesktop } from './files';
import { checkShapes, type Shape } from '../model/shapes';
import { buildSvg, shapesFromSvg } from './flatExport';


export interface ClipContents {
  text: string;
  /** "illustrator": SVG in points. "svg": SVG in 96-dpi pixels (Word,
   *  PowerPoint …). "text": anything else (or the browser version). */
  source: 'illustrator' | 'svg' | 'text';
}

export async function readClipboard(): Promise<ClipContents | null> {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<ClipContents | null>('clipboard_read');
  }
  // Browser: only plain text is visible (Illustrator's copy is; Word's isn't).
  const text = await navigator.clipboard.readText();
  return text ? { text, source: 'text' } : null;
}

async function writeClipboard(text: string, svg = false) {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      return await invoke('clipboard_write', { text, svg });
    } catch {
      // The desktop clipboard writer is Windows only: the Mac copies as text.
    }
  }
  return navigator.clipboard.writeText(text);
}

/** Copied shapes go on the clipboard as an SVG drawing in mm: Illustrator
 *  pastes it as artwork, and it carries the shapes themselves, so pasting
 *  back here is exact (`ownShapes`). */
export function copyShapes(shapes: Shape[]) {
  return writeClipboard(buildSvg(shapes), true);
}

/** BlownSim shapes on the clipboard, or null. */
export function ownShapes(text: string): Shape[] | null {
  // Windows hands text back with \r\n line ends.
  const fromSvg = shapesFromSvg(text);
  if (fromSvg) return checkShapes(fromSvg).shapes;
  // Copies made before session 20: marked JSON.
  const m = /^BlownSim shapes v1\r?\n/.exec(text);
  if (!m) return null;
  try {
    const shapes = JSON.parse(text.slice(m[0].length));
    return Array.isArray(shapes) ? checkShapes(shapes).shapes : null;
  } catch {
    return null;
  }
}

/**
 * The SVG to import, sized right: Illustrator's copies have no width or
 * height and count in points (1/72 inch), while the importer assumes 96-dpi
 * pixels — so they get an explicit size in points.
 */
export function pastedSvg(clip: ClipContents): string | null {
  const start = clip.text.indexOf('<svg');
  if (start < 0) return null;
  const doc = new DOMParser().parseFromString(clip.text.slice(clip.text.lastIndexOf('<?xml', start) >= 0 ? clip.text.lastIndexOf('<?xml', start) : start), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg') return null;
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const unsized = !svg.getAttribute('width') || !svg.getAttribute('height');
  if ((clip.source === 'illustrator' || (clip.source === 'text' && unsized)) && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    svg.setAttribute('width', `${vb[2]}pt`);
    svg.setAttribute('height', `${vb[3]}pt`);
  }
  return new XMLSerializer().serializeToString(svg);
}

/** Illustrator pastes: real size (its clipboard is in points), or its
 *  numbers read as mm — for DXFs opened in Illustrator, which reads each
 *  DXF unit as a point and so shows the drawing's mm as pt (2.83× small). */
export type IllustratorScale = 'real' | 'dxf';
const ILLUSTRATOR_SCALE = 'blownsim.illustratorScale';
/** pt → mm when Illustrator's numbers are read as mm. */
export const DXF_IN_ILLUSTRATOR = 72 / 25.4;

export function illustratorScale(): IllustratorScale {
  try {
    return localStorage.getItem(ILLUSTRATOR_SCALE) === 'dxf' ? 'dxf' : 'real';
  } catch {
    return 'real';
  }
}

export function setIllustratorScale(v: IllustratorScale) {
  try {
    localStorage.setItem(ILLUSTRATOR_SCALE, v);
  } catch {
    /* private storage: the choice just isn't remembered */
  }
  window.dispatchEvent(new Event(ILLUSTRATOR_SCALE));
}

/** Follow the setting (Edit menu and paste message both change it). */
export function onIllustratorScale(f: () => void): () => void {
  window.addEventListener(ILLUSTRATOR_SCALE, f);
  return () => window.removeEventListener(ILLUSTRATOR_SCALE, f);
}
