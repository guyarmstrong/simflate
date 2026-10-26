// Fewer triangles for programs that slow down on big meshes (SketchUp makes a
// face and edges of every triangle). meshoptimizer collapses edges where the
// surface is flattest; it sees the seams (same position, different point) and
// keeps them closed, and weighs UVs and normals so the textures stay put.

import { MeshoptSimplifier } from 'meshoptimizer';
import { normals, type ExportGeometry } from './files';

/** SketchUp gets slow above about this many faces. */
export const SKETCHUP_COMFORTABLE = 150_000;

/** The mesh cut to about `target` triangles: new geometry and positions (only the points still used). */
export async function reduceMesh(geom: ExportGeometry, pos: Float32Array, target: number): Promise<{ geom: ExportGeometry; pos: Float32Array }> {
  await MeshoptSimplifier.ready;
  const n = pos.length / 3;
  const nrm = normals(pos, geom.indices);
  // Attributes: u, v (0–1 over the piece) and the normal.
  const attr = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) {
    attr.set([geom.uv[2 * i], geom.uv[2 * i + 1], nrm[3 * i], nrm[3 * i + 1], nrm[3 * i + 2]], 5 * i);
  }
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(geom.indices, pos, 3, attr, 5, [4, 4, 1, 1, 1], null, Math.max(3, Math.floor(target) * 3), 0.05, []);

  // Which sheet each triangle is on: bit 1 = a top-sheet point, 2 = bottom
  // (weld points can be both). A triangle of weld points only goes by which
  // way it faces.
  const sheet = new Uint8Array(n);
  for (let t = 0; t < geom.indices.length / 3; t++) for (let k = 0; k < 3; k++) sheet[geom.indices[3 * t + k]] |= t < geom.topTriangles ? 1 : 2;
  const tris = idx.length / 3;
  const isTop = (t: number) => {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    const s = [sheet[a], sheet[b], sheet[c]];
    if (s.includes(1)) return true;
    if (s.includes(2)) return false;
    const ux = pos[3 * b] - pos[3 * a], uy = pos[3 * b + 1] - pos[3 * a + 1];
    const vx = pos[3 * c] - pos[3 * a], vy = pos[3 * c + 1] - pos[3 * a + 1];
    return ux * vy - uy * vx > 0;
  };
  const order: number[] = [];
  for (let t = 0; t < tris; t++) if (isTop(t)) order.push(t);
  const topTriangles = order.length;
  for (let t = 0; t < tris; t++) if (!isTop(t)) order.push(t);

  // Keep only the points still used.
  const remap = new Int32Array(n).fill(-1);
  let m = 0;
  const indices = new Uint32Array(idx.length);
  order.forEach((t, j) => {
    for (let k = 0; k < 3; k++) {
      const v = idx[3 * t + k];
      if (remap[v] < 0) remap[v] = m++;
      indices[3 * j + k] = remap[v];
    }
  });
  const outPos = new Float32Array(m * 3);
  const uv = new Float32Array(m * 2);
  const origin = geom.origin ? new Uint32Array(m) : undefined;
  for (let v = 0; v < n; v++) {
    const r = remap[v];
    if (r < 0) continue;
    outPos.set(pos.subarray(3 * v, 3 * v + 3), 3 * r);
    uv.set(geom.uv.subarray(2 * v, 2 * v + 2), 2 * r);
    if (origin) origin[r] = geom.origin![v];
  }
  return { geom: { indices, uv, topTriangles, origin }, pos: outPos };
}
