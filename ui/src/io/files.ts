// Opening outline files and saving exports.

import { boxCenter, boxHeight, boxOf, boxWidth, fmt } from '../model/geometry';
import { localContours, makeShape, newId, shapesBox, type Shape } from '../model/shapes';
import { importDxf } from './importDxf';
import { importSvg } from './importSvg';
import { sourcesOf, type LineSource } from './lineTypes';

export async function readOutlineFile(file: File): Promise<{ shapes: Shape[]; name: string; note: string }> {
  return readOutlineText(file.name, await outlineFileText(file));
}

/** A dropped / picked file's text; a DWG comes back as the DXF the desktop
 *  app converts it to (crates/blown-dwg). */
export async function outlineFileText(file: File): Promise<string> {
  if (!file.name.toLowerCase().endsWith('.dwg')) return file.text();
  if (!isDesktop) throw new Error('DWG files open in the desktop app; here, save it as DXF first.');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('dwg_to_dxf', new Uint8Array(await file.arrayBuffer()));
}

/** Imported lines become one group of shapes (one per line or loop), each
 *  remembering the file layer / colour it came from, so a whole layer can be
 *  given a line type (Line types dialog) or one line picked out and changed. */
export function readOutlineText(fileName: string, text: string): { shapes: Shape[]; name: string; note: string; sources: LineSource[] } {
  const lower = fileName.toLowerCase();
  // A DWG's text is already the DXF it was converted to (outlineFileText, or natively on the desktop).
  const res = lower.endsWith('.dxf') || lower.endsWith('.dwg') ? importDxf(text) : lower.endsWith('.svg') ? importSvg(text) : null;
  if (!res) throw new Error('Please choose a .dxf, .dwg or .svg file');
  // Points that came out broken (a damaged or cut-short file) are left out.
  const contours = res.contours
    .map((c) => ({ ...c, pts: c.pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) }))
    .filter((c) => c.pts.length >= 2);
  if (!contours.length) throw new Error('No lines or curves found in this file');
  const name = fileName.split(/[\\/]/).pop()!.replace(/\.(dxf|dwg|svg)$/i, '');
  const group = newId();
  const several = new Set(contours.map((k) => k.src)).size > 1;
  const shapes = contours.map((k, i) => {
    const c = boxCenter(boxOf(k.pts));
    const local = [{ closed: k.closed, pts: k.pts.map(([x, y]) => [x - c[0], y - c[1]] as [number, number]) }];
    const info = k.src ? res.sources.get(k.src) : undefined;
    const label = contours.length === 1 ? name : `${several && info ? info.label : name} · ${k.closed ? 'loop' : 'line'} ${i + 1}`;
    const shape = makeShape('path', c, { contours: local, name: label, group });
    return info ? { ...shape, src: k.src, srcLabel: info.label, srcColor: info.color } : shape;
  });
  const sources = sourcesOf(shapes).map((s) => ({ ...s, hidden: res.sources.get(s.key)?.hidden }));
  // Name lines by their friendly layer label ("Layer 0 · red · line 3").
  const nice = new Map(sources.map((s) => [s.key, s.label]));
  const named = several ? shapes.map((s, i) => (s.src ? { ...s, name: `${nice.get(s.src)} · ${contours[i].closed ? 'loop' : 'line'} ${i + 1}` } : s)) : shapes;
  return { shapes: named, name, note: res.unitNote, sources };
}

/** "Size W × L mm · n open line(s)" for what actually landed on the board. */
export function importSummary(shapes: Shape[]): string {
  const b = shapesBox(shapes);
  const open = shapes.filter((s) => localContours(s).every((c) => !c.closed)).length;
  return b ? `Size ${fmt(boxWidth(b))} × ${fmt(boxHeight(b))} mm${open ? ` · ${open} open line(s)` : ''}` : '';
}

/** True inside the desktop app (Tauri), false in a plain browser tab. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Files packed as one raw message for the desktop app's save_bundle
 *  (layout in src-tauri/src/lib.rs, `unpack_bundle`). */
async function packBundle(files: { name: string; data: BlobPart }[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts = await Promise.all(files.map(async (f) => ({ name: enc.encode(f.name), data: new Uint8Array(await new Blob([f.data]).arrayBuffer()) })));
  const out = new Uint8Array(4 + parts.reduce((n, p) => n + 8 + p.name.length + p.data.length, 0));
  const dv = new DataView(out.buffer);
  let at = 0;
  dv.setUint32(at, parts.length, true);
  at += 4;
  for (const p of parts) {
    dv.setUint32(at, p.name.length, true);
    out.set(p.name, at + 4);
    at += 4 + p.name.length;
    dv.setUint32(at, p.data.length, true);
    out.set(p.data, at + 4);
    at += 4 + p.data.length;
  }
  return out;
}

/**
 * Save one or more files. In the desktop app this opens a "Save as…" dialog
 * (extra files land next to the first one); in a browser it downloads them.
 * Resolves to where it was saved, or null if cancelled.
 */
export async function saveFiles(files: { name: string; data: BlobPart; type?: string }[]): Promise<string | null> {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string | null>('save_bundle', await packBundle(files));
  }
  files.forEach((f) => download(f.name, f.data, f.type));
  return 'your Downloads folder';
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function centred(pos: Float32Array): Float32Array {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]);
    maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]);
    maxY = Math.max(maxY, pos[i + 1]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const out = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    out[i] = pos[i] - cx;
    out[i + 1] = pos[i + 1] - cy;
    out[i + 2] = pos[i + 2];
  }
  return out;
}

export function normals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      n[v] += fx;
      n[v + 1] += fy;
      n[v + 2] += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** What the exporters need: triangles (top sheet first), UVs, and optionally
 *  a map from each point to its watertight original (smooth render mesh). */
export interface ExportGeometry {
  indices: Uint32Array;
  uv: Float32Array;
  topTriangles: number;
  origin?: Uint32Array;
}

/** OBJ + MTL for KeyShot: parts Sheet_Top / Sheet_Bottom, material Stainless_Main, mm, watertight. */
export function buildObj(mesh: ExportGeometry, frame: Float32Array, base: string): { obj: string; mtl: string } {
  const pos = centred(frame);
  const nrm = normals(pos, mesh.indices);
  const n = pos.length / 3;
  // Shared positions (so the solid stays watertight); normals/UVs per point.
  const vOf = new Uint32Array(n);
  const L: string[] = ['# Simflate export — units: millimetres', `mtllib ${base}.mtl`];
  if (mesh.origin) {
    const seen = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      const o = mesh.origin[i];
      let v = seen.get(o);
      if (v === undefined) {
        v = seen.size;
        seen.set(o, v);
        L.push(`v ${pos[i * 3].toFixed(4)} ${pos[i * 3 + 1].toFixed(4)} ${pos[i * 3 + 2].toFixed(4)}`);
      }
      vOf[i] = v;
    }
  } else {
    for (let i = 0; i < n; i++) {
      vOf[i] = i;
      L.push(`v ${pos[i * 3].toFixed(4)} ${pos[i * 3 + 1].toFixed(4)} ${pos[i * 3 + 2].toFixed(4)}`);
    }
  }
  for (let i = 0; i < mesh.uv.length; i += 2) L.push(`vt ${mesh.uv[i].toFixed(6)} ${mesh.uv[i + 1].toFixed(6)}`);
  for (let i = 0; i < nrm.length; i += 3) L.push(`vn ${nrm[i].toFixed(5)} ${nrm[i + 1].toFixed(5)} ${nrm[i + 2].toFixed(5)}`);
  const top = mesh.topTriangles;
  const tris = mesh.indices.length / 3;
  const corner = (i: number) => `${vOf[i] + 1}/${i + 1}/${i + 1}`;
  for (const [name, from, to] of [['Sheet_Top', 0, top], ['Sheet_Bottom', top, tris]] as const) {
    L.push(`o ${name}`, `g ${name}`, 'usemtl Stainless_Main', 's 1');
    for (let t = from; t < to; t++) {
      L.push(`f ${corner(mesh.indices[t * 3])} ${corner(mesh.indices[t * 3 + 1])} ${corner(mesh.indices[t * 3 + 2])}`);
    }
  }
  const mtl = ['Stainless_Main', 'Stainless_Weld']
    .map((m) => `newmtl ${m}\nKa 0 0 0\nKd 0.55 0.56 0.58\nKs 0.9 0.9 0.9\nNs 400\nPm 1.0\nPr ${m === 'Stainless_Main' ? 0.15 : 0.3}\nillum 3\n`)
    .join('\n');
  return { obj: L.join('\n') + '\n', mtl };
}

/** Binary STL (mm). */
export function buildStl(mesh: ExportGeometry, frame: Float32Array): ArrayBuffer {
  const pos = centred(frame);
  const tris = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50);
  const dv = new DataView(buf);
  const tag = 'Simflate STL (mm)';
  for (let i = 0; i < tag.length; i++) dv.setUint8(i, tag.charCodeAt(i));
  dv.setUint32(80, tris, true);
  let o = 84;
  for (let t = 0; t < tris; t++) {
    const v = [mesh.indices[t * 3] * 3, mesh.indices[t * 3 + 1] * 3, mesh.indices[t * 3 + 2] * 3];
    const ux = pos[v[1]] - pos[v[0]], uy = pos[v[1] + 1] - pos[v[0] + 1], uz = pos[v[1] + 2] - pos[v[0] + 2];
    const wx = pos[v[2]] - pos[v[0]], wy = pos[v[2] + 1] - pos[v[0] + 1], wz = pos[v[2] + 2] - pos[v[0] + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const x of [nx, ny, nz]) { dv.setFloat32(o, x, true); o += 4; }
    for (const vi of v) for (let k = 0; k < 3; k++) { dv.setFloat32(o, pos[vi + k], true); o += 4; }
    o += 2;
  }
  return buf;
}
