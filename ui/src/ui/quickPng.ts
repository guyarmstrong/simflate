// Quick export PNG (top right): whatever the main view shows — the Draft
// board, or the 3D view in Inflate / Forms — saved as a big, sharp picture.

import { saveFiles } from '../io/files';
import { useApp } from '../state/store';
import { useLibrary } from '../library/library';
import { PRESETS } from '../model/presets';
import { backgroundOf, quickShot } from '../viewer/Viewport3D';

/** Long side of the picture (4K). */
const LONG_SIDE = 3840;

/** SVG properties the board's stylesheet sets, copied inline so the picture
 *  looks like the screen (an SVG drawn as an image has no stylesheet). */
const SVG_STYLE = [
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
  'stroke-linejoin', 'stroke-linecap', 'opacity', 'display', 'visibility',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
];

/** The Draft board as a canvas, `longSide` px across its long side. */
async function boardPicture(longSide: number): Promise<HTMLCanvasElement | null> {
  const svg = document.querySelector('.editor2d svg') as SVGSVGElement | null;
  if (!svg) return null;
  const w = svg.clientWidth || Number(svg.getAttribute('width'));
  const h = svg.clientHeight || Number(svg.getAttribute('height'));
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [copy, ...copy.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    (dst[i] as SVGElement).setAttribute('style', SVG_STYLE.map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';'));
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const k = longSide / Math.max(w, h, 1);
  copy.setAttribute('width', String(Math.round(w * k)));
  copy.setAttribute('height', String(Math.round(h * k)));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const out = document.createElement('canvas');
    out.width = Math.round(w * k);
    out.height = Math.round(h * k);
    const g = out.getContext('2d')!;
    g.fillStyle = backgroundOf(svg.parentElement);
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(img, 0, 0, out.width, out.height);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Save the main view as a PNG; returns where it went (null if nothing to save). */
export async function quickPng(): Promise<string | null> {
  const st = useApp.getState();
  const canvas = st.mode === 'shape' ? await boardPicture(LONG_SIDE) : quickShot.grab?.(LONG_SIDE) ?? null;
  if (!canvas) return null;
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return null;
  const view = { shape: 'draft', inflate: 'inflate', snapshots: 'form' }[st.mode];
  const name =
    st.mode === 'snapshots'
      ? useLibrary.getState().view?.name
      : st.project.path || st.project.name !== 'Untitled'
        ? st.project.name
        : PRESETS.find((p) => p.id === st.presetId)?.name;
  const slug = (name ?? 'simflate').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'simflate';
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
  return saveFiles([{ name: `${slug}-${view}-${stamp}.png`, data: blob, type: 'image/png' }]);
}
