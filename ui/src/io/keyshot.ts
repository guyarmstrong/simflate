// Textured exports for KeyShot: the finish and TIG weld baked into maps
// (bake.ts) and carried by a GLB (one file, maps inside) and by the OBJ.
//
// The GLB is in metres with Y up (glTF's rules), so the piece arrives at its
// real size and standing the right way. Parts: Sheet top, Sheet bottom and —
// when the welds are shown — TIG weld (the band within ~12 mm of the seam),
// so a KeyShot library metal can go on the sheets while the baked weld stays.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { bakeMaps, canvasPng, type BakedMaps } from './bake';
import { buildObj, centred, normals, type ExportGeometry } from './files';
import { tigDistances } from '../viewer/tigBand';
import { FINISH_LOOKS, filmThicknessMap, type FinishOpts, type Look } from '../viewer/materials';
import type { Vec2 } from '../model/geometry';

/** Triangles with a corner this close to the seam (mm) belong to the weld part. */
const WELD_ZONE_MM = 12;

export interface FinishState {
  look: Look;
  pvd: string;
  beetleFace: string;
  showWelds: boolean;
  opts: FinishOpts;
}

/** Bake the maps for what's on screen (an analysis view exports as polished). */
export function bakeFor(geom: ExportGeometry, outlines: Vec2[][], f: FinishState): BakedMaps {
  const look: Look = FINISH_LOOKS.includes(f.look) ? f.look : 'polished';
  const pts = outlines.flat();
  const span = Math.max(Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1])));
  // About 0.1 mm per texel on small pieces; 4K at most.
  const size = span <= 250 ? 2048 : 4096;
  const film = f.opts.coat === 'heat' ? filmThicknessMap() : null;
  try {
    return bakeMaps({ geom, outlines, look, pvd: f.pvd, beetleFace: f.beetleFace, showWelds: f.showWelds, opts: f.opts, size }, film);
  } finally {
    film?.dispose();
  }
}

function texture(c: HTMLCanvasElement, srgb: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** The triangles of each part (point indices, three per triangle): Sheet top,
 *  Sheet bottom and — when the welds are shown — TIG weld, the band beside the seam. */
export function partsOf(geom: ExportGeometry, outlines: Vec2[][], showWelds: boolean): Record<string, number[]> {
  const dist = showWelds ? tigDistances(geom.uv, outlines).dist : null;
  const parts: Record<string, number[]> = { 'Sheet top': [], 'Sheet bottom': [], 'TIG weld': [] };
  const idx = geom.indices;
  for (let t = 0; t < idx.length / 3; t++) {
    const [a, b, c] = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const inWeld = dist && Math.min(dist[a], dist[b], dist[c]) < WELD_ZONE_MM;
    const key = inWeld ? 'TIG weld' : t < geom.topTriangles ? 'Sheet top' : 'Sheet bottom';
    parts[key].push(a, b, c);
  }
  return parts;
}

/** `maps` null = plain stainless materials, no textures packaged. */
export async function buildGlb(geom: ExportGeometry, frame: Float32Array, outlines: Vec2[][], maps: BakedMaps | null, f: FinishState, name: string): Promise<ArrayBuffer> {
  const pos = centred(frame);
  const nrm = normals(pos, geom.indices);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(geom.uv, 2));

  const colour = maps && texture(maps.colour, true);
  const orm = maps && texture(maps.orm, false);
  const normal = maps && texture(maps.normal, false);
  const material = (label: string) => {
    if (!maps) {
      const weld = label === 'TIG weld';
      return new THREE.MeshPhysicalMaterial({ name: label, color: weld ? 0xa9a6a1 : 0xd0d2d6, metalness: 1, roughness: weld ? 0.3 : 0.12, side: THREE.DoubleSide });
    }
    const m = new THREE.MeshPhysicalMaterial({
      name: label,
      color: 0xffffff,
      map: colour,
      roughness: 1,
      metalness: 1,
      roughnessMap: orm,
      metalnessMap: orm,
      aoMap: orm,
      normalMap: normal,
      clearcoat: maps.clearcoat,
      clearcoatRoughness: 0.1,
      side: THREE.DoubleSide,
    });
    if (f.look === 'brushed' && f.opts.coat !== 'powder') {
      m.anisotropy = 0.35;
      m.anisotropyRotation = (f.opts.brushAngle * Math.PI) / 180 + Math.PI / 2;
    }
    return m;
  };
  const sheet = material(maps?.finish ?? 'Stainless');
  const weld = material('TIG weld');

  const parts = partsOf(geom, outlines, f.showWelds);

  // glTF: metres, Y up. Our world is millimetres, Z up.
  const root = new THREE.Group();
  root.name = name;
  root.scale.setScalar(0.001);
  root.rotation.x = -Math.PI / 2;
  for (const [label, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const pg = g.clone();
    pg.setIndex(list);
    // Tangents travel with the normal map, so every program reads it the same way.
    if (maps) pg.computeTangents();
    const mesh = new THREE.Mesh(pg, label === 'TIG weld' ? weld : sheet);
    mesh.name = label;
    root.add(mesh);
  }
  const scene = new THREE.Scene();
  scene.add(root);
  const out = (await new GLTFExporter().parseAsync(scene, { binary: true, maxTextureSize: 8192 })) as ArrayBuffer;
  root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  for (const t of [colour, orm, normal]) t?.dispose();
  sheet.dispose();
  weld.dispose();
  return out;
}

/** OBJ + MTL that point at the baked maps (colour, roughness, normal). */
export async function buildTexturedObj(geom: ExportGeometry, frame: Float32Array, maps: BakedMaps, base: string) {
  const { obj } = buildObj(geom, frame, base);
  const mtl = [
    '# Simflate — finish and TIG weld baked into the maps (flat-pattern UVs)',
    'newmtl Stainless_Main',
    'Ka 0 0 0',
    'Kd 1 1 1',
    'Ks 0.9 0.9 0.9',
    'Ns 400',
    'Pm 1.0',
    'Pr 1.0',
    'illum 3',
    `map_Kd ${base}-colour.png`,
    `map_Pr ${base}-roughness.png`,
    `norm ${base}-normal.png`,
    `map_Bump ${base}-normal.png`,
    '',
  ].join('\n');
  return {
    obj,
    mtl,
    images: [
      { name: `${base}-colour.png`, data: await canvasPng(maps.colour), type: 'image/png' },
      { name: `${base}-roughness.png`, data: await canvasPng(maps.roughness), type: 'image/png' },
      { name: `${base}-normal.png`, data: await canvasPng(maps.normal), type: 'image/png' },
    ],
  };
}
