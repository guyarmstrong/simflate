// COLLADA (.dae) for SketchUp: one watertight piece in millimetres, Z up, with
// a material per part (Sheet top, Sheet bottom, TIG weld). COLLADA's common
// profile carries one colour texture per material — that's what SketchUp
// reads — so the packaged export uses the baked colour map (finish + weld).

import { canvasPng, type BakedMaps } from './bake';
import { centred, normals, type ExportGeometry } from './files';
import { partsOf } from './keyshot';
import type { Vec2 } from '../model/geometry';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain stainless when no textures go with it (linear RGB). */
const PLAIN: Record<string, [number, number, number]> = {
  'Sheet top': [0.62, 0.63, 0.65],
  'Sheet bottom': [0.62, 0.63, 0.65],
  'TIG weld': [0.45, 0.44, 0.42],
};

export async function buildDae(
  geom: ExportGeometry,
  frame: Float32Array,
  outlines: Vec2[][],
  showWelds: boolean,
  maps: BakedMaps | null,
  name: string,
  base: string,
): Promise<{ dae: string; images: { name: string; data: Blob; type: string }[] }> {
  const pos = centred(frame);
  const nrm = normals(pos, geom.indices);
  const n = pos.length / 3;

  // Shared positions (watertight, so SketchUp sees a solid); normals / UVs per point.
  const vOf = new Uint32Array(n);
  const P: string[] = [];
  const seen = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const o = geom.origin ? geom.origin[i] : i;
    let v = seen.get(o);
    if (v === undefined) {
      v = seen.size;
      seen.set(o, v);
      P.push(`${pos[i * 3].toFixed(4)} ${pos[i * 3 + 1].toFixed(4)} ${pos[i * 3 + 2].toFixed(4)}`);
    }
    vOf[i] = v;
  }
  const N: string[] = [];
  for (let i = 0; i < nrm.length; i += 3) N.push(`${nrm[i].toFixed(5)} ${nrm[i + 1].toFixed(5)} ${nrm[i + 2].toFixed(5)}`);
  const T: string[] = [];
  for (let i = 0; i < geom.uv.length; i += 2) T.push(`${geom.uv[i].toFixed(6)} ${geom.uv[i + 1].toFixed(6)}`);

  const parts = Object.entries(partsOf(geom, outlines, showWelds)).filter(([, list]) => list.length);
  const id = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const colourFile = `${base}-colour.png`;
  const finish = maps?.finish ?? 'Stainless';

  const L: string[] = [];
  L.push(
    '<?xml version="1.0" encoding="utf-8"?>',
    '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">',
    '  <asset>',
    '    <contributor><authoring_tool>Simflate</authoring_tool></contributor>',
    `    <created>${new Date().toISOString()}</created>`,
    `    <modified>${new Date().toISOString()}</modified>`,
    '    <unit name="millimeter" meter="0.001"/>',
    '    <up_axis>Z_UP</up_axis>',
    '  </asset>',
  );
  if (maps) L.push('  <library_images>', `    <image id="colour-map" name="colour"><init_from>${esc(colourFile)}</init_from></image>`, '  </library_images>');
  L.push('  <library_effects>');
  for (const [label] of parts) {
    const weld = label === 'TIG weld';
    const [r, g, b] = PLAIN[label];
    L.push(`    <effect id="${id(label)}-fx">`, '      <profile_COMMON>');
    if (maps) {
      L.push(
        '        <newparam sid="colour-surface"><surface type="2D"><init_from>colour-map</init_from></surface></newparam>',
        '        <newparam sid="colour-sampler"><sampler2D><source>colour-surface</source></sampler2D></newparam>',
      );
    }
    L.push(
      '        <technique sid="common">',
      '          <phong>',
      maps ? '            <diffuse><texture texture="colour-sampler" texcoord="UVSET0"/></diffuse>' : `            <diffuse><color>${r} ${g} ${b} 1</color></diffuse>`,
      '            <specular><color>0.9 0.9 0.9 1</color></specular>',
      `            <shininess><float>${weld ? 40 : 80}</float></shininess>`,
      '          </phong>',
      '        </technique>',
      '      </profile_COMMON>',
      '    </effect>',
    );
  }
  L.push('  </library_effects>', '  <library_materials>');
  for (const [label] of parts) {
    const matName = label === 'TIG weld' ? 'TIG weld' : `${finish} - ${label}`;
    L.push(`    <material id="${id(label)}-mat" name="${esc(matName)}"><instance_effect url="#${id(label)}-fx"/></material>`);
  }
  L.push(
    '  </library_materials>',
    '  <library_geometries>',
    `    <geometry id="piece" name="${esc(name)}">`,
    '      <mesh>',
    '        <source id="piece-pos">',
    `          <float_array id="piece-pos-array" count="${P.length * 3}">${P.join(' ')}</float_array>`,
    `          <technique_common><accessor source="#piece-pos-array" count="${P.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>`,
    '        </source>',
    '        <source id="piece-nrm">',
    `          <float_array id="piece-nrm-array" count="${N.length * 3}">${N.join(' ')}</float_array>`,
    `          <technique_common><accessor source="#piece-nrm-array" count="${N.length}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common>`,
    '        </source>',
    '        <source id="piece-uv">',
    `          <float_array id="piece-uv-array" count="${T.length * 2}">${T.join(' ')}</float_array>`,
    `          <technique_common><accessor source="#piece-uv-array" count="${T.length}" stride="2"><param name="S" type="float"/><param name="T" type="float"/></accessor></technique_common>`,
    '        </source>',
    '        <vertices id="piece-vtx"><input semantic="POSITION" source="#piece-pos"/></vertices>',
  );
  for (const [label, list] of parts) {
    const p: string[] = [];
    for (const i of list) p.push(`${vOf[i]} ${i} ${i}`);
    L.push(
      `        <triangles material="${id(label)}" count="${list.length / 3}">`,
      '          <input semantic="VERTEX" source="#piece-vtx" offset="0"/>',
      '          <input semantic="NORMAL" source="#piece-nrm" offset="1"/>',
      '          <input semantic="TEXCOORD" source="#piece-uv" offset="2" set="0"/>',
      `          <p>${p.join(' ')}</p>`,
      '        </triangles>',
    );
  }
  L.push(
    '      </mesh>',
    '    </geometry>',
    '  </library_geometries>',
    '  <library_visual_scenes>',
    '    <visual_scene id="scene" name="Simflate">',
    `      <node id="piece-node" name="${esc(name)}">`,
    '        <instance_geometry url="#piece">',
    '          <bind_material><technique_common>',
  );
  for (const [label] of parts) {
    L.push(`            <instance_material symbol="${id(label)}" target="#${id(label)}-mat"><bind_vertex_input semantic="UVSET0" input_semantic="TEXCOORD" input_set="0"/></instance_material>`);
  }
  L.push(
    '          </technique_common></bind_material>',
    '        </instance_geometry>',
    '      </node>',
    '    </visual_scene>',
    '  </library_visual_scenes>',
    '  <scene><instance_visual_scene url="#scene"/></scene>',
    '</COLLADA>',
    '',
  );
  const images = maps ? [{ name: colourFile, data: await canvasPng(maps.colour), type: 'image/png' }] : [];
  return { dae: L.join('\n'), images };
}
