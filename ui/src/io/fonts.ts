// Fonts for the Text tool. Desktop app: the fonts installed on the computer,
// read and outlined natively. Browser preview: the browser's local-font
// access (Chrome / Edge), outlined by the solver's WebAssembly.

import { isDesktop } from './files';
import type { Vec2 } from '../model/geometry';

export interface FontFace {
  family: string;
  style: string;
  postscript: string;
  weight: number;
  italic: boolean;
  /** Desktop: the font file. */
  path?: string;
  /** Browser: the font's bytes on demand. */
  blob?: () => Promise<Blob>;
}

export interface FontFamily {
  name: string;
  faces: FontFace[];
}

export interface TextOutline {
  contours: Vec2[][];
  missing: string;
}

let families: Promise<FontFamily[]> | null = null;

/** Font families on this computer, A–Z (cached after the first call). */
export function listFonts(): Promise<FontFamily[]> {
  families ??= loadFaces().then(group).catch((e) => {
    families = null;
    throw e;
  });
  return families;
}

interface LocalFontData {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}

async function loadFaces(): Promise<FontFace[]> {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<FontFace[]>('list_fonts');
  }
  const query = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!query) throw new Error('This browser can’t read your fonts — use the desktop app (or Chrome / Edge).');
  const list = await query();
  return list.map((f) => {
    const st = f.style.toLowerCase();
    return {
      family: f.family,
      style: f.style,
      postscript: f.postscriptName,
      weight: /black|heavy/.test(st) ? 900 : /extra ?bold|ultra ?bold/.test(st) ? 800 : /semi ?bold|demi/.test(st) ? 600 : /bold/.test(st) ? 700 : /light|thin/.test(st) ? 300 : 400,
      italic: /italic|oblique/.test(st),
      blob: () => f.blob(),
    };
  });
}

function group(faces: FontFace[]): FontFamily[] {
  const map = new Map<string, FontFace[]>();
  for (const f of faces) {
    if (!f.family) continue;
    if (!map.has(f.family)) map.set(f.family, []);
    map.get(f.family)!.push(f);
  }
  return [...map.entries()].map(([name, faces]) => ({ name, faces })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The upright face nearest to regular (or bold) weight; null if the family
 *  has no bold when bold is asked for. */
export function pickFace(fam: FontFamily, bold: boolean): FontFace | null {
  const upright = fam.faces.filter((f) => !f.italic);
  const pool = upright.length ? upright : fam.faces;
  const want = bold ? 700 : 400;
  const ok = pool.filter((f) => (bold ? f.weight >= 600 : f.weight < 600));
  if (!ok.length) return bold ? null : pool[0] ?? null;
  return ok.reduce((a, b) => (Math.abs(b.weight - want) < Math.abs(a.weight - want) ? b : a));
}

/** Letters as closed contours in mm, capitals `height` tall, baseline at 0. */
export async function textOutline(face: FontFace, text: string, height: number): Promise<TextOutline> {
  if (face.path) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<TextOutline>('text_outline', { path: face.path, postscript: face.postscript, text, height });
  }
  if (!face.blob) throw new Error('Font not available.');
  const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
  return wasmOutline(bytes, JSON.stringify({ postscript: face.postscript, text, height }));
}

interface TextExports {
  memory: WebAssembly.Memory;
  bs_alloc(len: number): number;
  bs_free(ptr: number, len: number): void;
  bs_result_ptr(): number;
  bs_result_len(): number;
  bs_text_outline(font: number, fontLen: number, req: number, reqLen: number): number;
}

let wasm: Promise<TextExports> | null = null;

async function wasmOutline(font: Uint8Array, request: string): Promise<TextOutline> {
  wasm ??= fetch('/blown_wasm.wasm')
    .then((r) => r.arrayBuffer())
    .then((b) => WebAssembly.instantiate(b, {}))
    .then(({ instance }) => instance.exports as unknown as TextExports);
  const e = await wasm;
  const req = new TextEncoder().encode(request);
  const fp = e.bs_alloc(font.length);
  new Uint8Array(e.memory.buffer, fp, font.length).set(font);
  const rp = e.bs_alloc(req.length);
  new Uint8Array(e.memory.buffer, rp, req.length).set(req);
  const ok = e.bs_text_outline(fp, font.length, rp, req.length);
  const text = new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.bs_result_ptr(), e.bs_result_len()));
  e.bs_free(fp, font.length);
  e.bs_free(rp, req.length);
  if (!ok) throw new Error(text);
  return JSON.parse(text);
}
