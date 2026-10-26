// What can be exported (shared by the Export menu, top right, and the Export
// tab beside Forms and Render).

import { buildObj, buildStl, saveFiles, type ExportGeometry } from '../io/files';
import { buildDae } from '../io/dae';
import { reduceMesh, SKETCHUP_COMFORTABLE } from '../io/reduce';
import { bakeFor, buildGlb, buildTexturedObj, type FinishState } from '../io/keyshot';
import { useApp } from '../state/store';
import { snapshot } from '../viewer/Viewport3D';
import { buildStep } from '../io/step';
import type { Vec2 } from '../model/geometry';

/** What's in the 3D view right now, ready to export. */
export interface OnScreen {
  name: string;
  geom: ExportGeometry;
  pos: Float32Array;
  settings: unknown;
  pieces: unknown;
  info: unknown;
  /** The solver's own mesh for this frame (lighter than the smooth one). */
  raw: { geom: ExportGeometry; pos: Float32Array };
  /** The TIG weld round the outline and holes, flat (mm). */
  outlines: Vec2[][];
}

const PACK_TEXTURES = 'blownsim.exportTextures';

/** Package textures with the exports that can carry them (GLB, OBJ, DAE)? On unless turned off. */
export function packTextures(): boolean {
  try {
    return localStorage.getItem(PACK_TEXTURES) !== 'off';
  } catch {
    return true;
  }
}

export function setPackTextures(on: boolean) {
  try {
    localStorage.setItem(PACK_TEXTURES, on ? 'on' : 'off');
  } catch {
    /* private storage: the choice just isn't remembered */
  }
  window.dispatchEvent(new Event(PACK_TEXTURES));
}

/** Follow the setting (Export tab and File menu both change it). */
export function onPackTextures(f: () => void): () => void {
  window.addEventListener(PACK_TEXTURES, f);
  return () => window.removeEventListener(PACK_TEXTURES, f);
}

export interface ExportItem {
  label: string;
  hint: string;
  disabled?: boolean;
  /** Can carry textures (follows the "Package textures" setting). */
  textured?: boolean;
  /** Saves the file(s); returns where, or null if cancelled. */
  run: () => Promise<string | null> | void;
}

export function exportItems(onScreen: () => OnScreen | null, showToast: (msg: string) => void): ExportItem[] {
  const ready = !!onScreen();
  const exportable = () => onScreen()!;
  const base = () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    const slug = onScreen()?.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    return slug ? `${slug}-${stamp}` : `simflate-${stamp}`;
  };
  const sidecar = () => {
    const o = exportable();
    return { app: 'Simflate', exported: new Date().toISOString(), name: o.name, settings: o.settings, pieces: o.pieces, frame: o.info };
  };
  // The finish and welds as shown, baked into textures.
  const finish = (): FinishState => {
    const s = useApp.getState();
    return { look: s.look, pvd: s.pvdColor, beetleFace: s.beetleFace, showWelds: s.showWelds, opts: s.finishOpts };
  };
  // The baked maps, or null when textures aren't being packaged.
  const baking = async () => {
    if (!packTextures()) return null;
    showToast('Baking the finish and welds into textures…');
    // Let the message paint before the GPU work starts.
    await new Promise((r) => setTimeout(r, 50));
    const o = exportable();
    return bakeFor(o.geom, o.outlines, finish());
  };
  const tex = packTextures();
  return [
    {
      label: tex ? 'KeyShot (textured)' : 'KeyShot',
      hint: tex ? '.glb — finish + TIG weld baked in, real size' : '.glb — plain stainless, real size',
      disabled: !ready,
      textured: true,
      run: async () => {
        const b = base();
        const o = exportable();
        const maps = await baking();
        const glb = await buildGlb(o.geom, o.pos, o.outlines, maps, finish(), o.name);
        return saveFiles([
          { name: `${b}.glb`, data: glb, type: 'model/gltf-binary' },
          { name: `${b}.json`, data: JSON.stringify(sidecar(), null, 2), type: 'application/json' },
        ]);
      },
    },
    {
      label: 'OBJ for KeyShot',
      hint: tex ? '.obj + .mtl + texture maps + settings' : '.obj + .mtl + settings',
      disabled: !ready,
      textured: true,
      run: async () => {
        const b = base();
        const { geom, pos } = exportable();
        const maps = await baking();
        const { obj, mtl, images } = maps ? await buildTexturedObj(geom, pos, maps, b) : { ...buildObj(geom, pos, b), images: [] };
        return saveFiles([
          { name: `${b}.obj`, data: obj, type: 'text/plain' },
          { name: `${b}.mtl`, data: mtl, type: 'text/plain' },
          ...images,
          { name: `${b}.json`, data: JSON.stringify(sidecar(), null, 2), type: 'application/json' },
        ]);
      },
    },
    {
      label: 'SketchUp (COLLADA)',
      hint: tex ? '.dae + colour map — mm, one solid, a material per part' : '.dae — mm, one solid, a material per part',
      disabled: !ready,
      textured: true,
      run: async () => {
        // SketchUp makes a face and edges of every triangle: offer fewer on big pieces.
        const save = async (target: number | null) => {
          const b = base();
          const o = exportable();
          const maps = await baking();
          let { geom, pos } = o;
          if (target) {
            showToast(`Reducing to about ${count(target)} triangles…`);
            await new Promise((r) => setTimeout(r, 50));
            ({ geom, pos } = await reduceMesh(geom, pos, target));
          }
          const { dae, images } = await buildDae(geom, pos, o.outlines, finish().showWelds, maps, o.name, b);
          return saveFiles([
            { name: `${b}.dae`, data: dae, type: 'model/vnd.collada+xml' },
            ...images,
            { name: `${b}.json`, data: JSON.stringify(sidecar(), null, 2), type: 'application/json' },
          ]);
        };
        const tris = exportable().geom.indices.length / 3;
        if (tris <= SKETCHUP_COMFORTABLE) return save(null);
        const target = SKETCHUP_COMFORTABLE * 0.66;
        const then = (t: number | null) => () => void runExport({ label: 'SketchUp (COLLADA)', hint: '', run: () => save(t) }, showToast);
        useApp.getState().showToast(`This piece has ${count(tris)} triangles — SketchUp gets slow above about ${count(SKETCHUP_COMFORTABLE)}.`, [
          { label: `Reduce to ~${count(target)}`, run: then(target) },
          { label: `Export all ${count(tris)}`, run: then(null) },
        ]);
        return null;
      },
    },
    {
      label: 'STEP for CAD',
      hint: '.step — closed solid, mm (solver mesh)',
      disabled: !ready,
      run: () => {
        const o = exportable();
        return saveFiles([{ name: `${base()}.step`, data: buildStep(o.raw.geom, o.raw.pos, o.name), type: 'application/step' }]);
      },
    },
    {
      label: 'STL',
      hint: 'for a printed maquette',
      disabled: !ready,
      run: () => {
        const { geom, pos } = exportable();
        return saveFiles([{ name: `${base()}.stl`, data: buildStl(geom, pos) }]);
      },
    },
    {
      label: 'PNG image',
      hint: 'of the 3D view',
      disabled: !ready,
      run: async () => {
        const url = snapshot();
        if (!url) return null;
        const blob = await (await fetch(url)).blob();
        return saveFiles([{ name: `${base()}.png`, data: blob, type: 'image/png' }]);
      },
    },
    { label: 'SketchUp .skp', hint: 'needs the SketchUp SDK', disabled: true, run: () => showToast('SketchUp export arrives once the SketchUp SDK is downloaded') },
  ];
}

const count = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString('en-GB'));

/** Run an export and say where it went (or why it failed). */
export async function runExport(item: ExportItem, showToast: (msg: string) => void) {
  try {
    const where = await item.run();
    if (where) showToast(`Saved to ${where}`);
  } catch (e) {
    showToast(`Export failed: ${String((e as Error)?.message ?? e)}`);
  }
}
