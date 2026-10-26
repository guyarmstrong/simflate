// Bakes the viewer's finish and TIG weld into textures for KeyShot.
//
// The mesh UVs are the flat cut pattern (0–1 across its longer side), so the
// sheet is drawn flat into the texture: each texel knows its flat position,
// its distance from the TIG weld and how far along the weld it is — exactly
// what the viewer's shader uses. The same recipe (bead dome and ripples, dark
// line, blue / magenta / gold band, straw halo; bare seam on coated finishes;
// brushed grain; heat-tint colours; the pressed pattern and its polished
// tops) is evaluated per texel into:
//   colour      base colour (sRGB)
//   orm         R occlusion, G roughness, B metalness (glTF packing)
//   normal      bead dome + ripples and the pattern as a tangent-space
//               normal map (+Y up)
// Both sheets share the flat UVs, so one set of maps covers the whole piece.

import * as THREE from 'three';
import { TIG_PITCH_GLSL, tigDistances } from '../viewer/tigBand';
import { FINISH_SURFACE, type Coat, type FinishOpts, type Look } from '../viewer/materials';
import { PATTERN_GLSL, POWDER_GLSL, patternDepthMm, patternIndex } from '../viewer/patterns';
import type { Vec2 } from '../model/geometry';
import type { ExportGeometry } from './files';

export interface BakeInput {
  geom: ExportGeometry;
  outlines: Vec2[][];
  look: Look;
  pvd: string;
  beetleFace: string;
  showWelds: boolean;
  opts: FinishOpts;
  /** Texture size in pixels (square). */
  size: number;
}

export interface BakedMaps {
  colour: HTMLCanvasElement;
  orm: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  /** Roughness alone (greyscale), for the OBJ's .mtl. */
  roughness: HTMLCanvasElement;
  /** What the finish is, for material names. */
  finish: string;
  /** Base surface values the textures multiply. */
  clearcoat: number;
}

const FINISH_NAMES: Partial<Record<Look, string>> = {
  polished: 'Polished stainless',
  mirror: 'Mirror stainless',
  brushed: 'Brushed stainless',
  bead: 'Bead-blast stainless',
};
const COAT_NAMES: Record<Coat, string> = { pvd: 'PVD', iridescent: 'iridescent', heat: 'heat-tinted', powder: 'powder-coated', candy: 'candy' };

/** Linear colour of a hex string (three.js converts sRGB hex to linear). */
const lin = (hex: string | number) => new THREE.Color(hex);

/** The finish sets the surface, the coat (as in the viewer) its colour. */
function finishParams(look: Look, o: FinishOpts, pvd: string, beetleFace: string): { base: THREE.Color; rough: number; coat: number; metal: number } {
  const f = FINISH_SURFACE[look] ?? FINISH_SURFACE.polished;
  const coat = o.coat;
  if (coat === 'powder') {
    // Paint: its own colour and gloss, the finish hidden.
    const metal = o.powderMetallic || o.powderTexture === 'hammer' ? 0.6 : 0;
    const rough = Math.min(1, 0.08 + 0.62 * (1 - o.powderGloss) + (o.powderTexture === 'fine' ? 0.12 : 0));
    return { base: lin(o.powderColor), rough, coat: o.powderGloss * o.powderGloss * 0.8, metal };
  }
  if (coat === 'candy') {
    // Face-on colour of the glass over the metal (a texture can't deepen
    // towards the edges as the viewer does).
    const c = lin(o.candyColor);
    const k = 0.4 + 1.6 * o.candyDepth;
    const base = lin(f.color).multiply(new THREE.Color(Math.pow(c.r, k), Math.pow(c.g, k), Math.pow(c.b, k)));
    return { base, rough: f.rough, coat: 1, metal: 1 };
  }
  const base = coat === 'pvd' ? lin(pvd) : coat === 'iridescent' ? lin(beetleFace) : coat === 'heat' ? lin(0xc4b08c) : lin(f.color);
  return { base, rough: f.rough, coat: coat === 'pvd' ? Math.max(f.coat, 0.4 * (1 - f.rough)) : f.coat, metal: 1 };
}

const bakeVertex = /* glsl */ `
  attribute float tig;
  attribute float tigS;
  uniform vec2 lo;
  uniform float span;
  varying float vTig;
  varying float vTigS;
  varying vec2 vFlat;
  void main() {
    vTig = tig;
    vTigS = tigS;
    vFlat = lo + position.xy * span;
    gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const bakeFragment = /* glsl */ `
  ${PATTERN_GLSL}
  ${POWDER_GLSL}
  uniform float baseMetal;
  uniform int channel;      // 0 colour, 1 orm, 2 normal
  uniform int brushedOn;    // brushed grain
  uniform int heatOn;       // heat-tint colours
  uniform int weldMode;     // -1 none, 0 bare stainless (as welded), 1 coated (bare seam), 2 painted over
  uniform vec3 baseColor;
  uniform float baseRough;
  uniform float mmPerTexel;
  uniform float brushAngle;
  uniform float brushGrain;
  uniform sampler2D film;
  uniform float heatSize;
  uniform vec2 heatOffset;
  uniform vec2 heatRange;
  uniform vec2 lo;
  uniform float span;
  varying float vTig;
  varying float vTigS;
  varying vec2 vFlat;

  float tigHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float tigNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(tigHash(i), tigHash(i + vec3(1, 0, 0)), f.x), mix(tigHash(i + vec3(0, 1, 0)), tigHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(tigHash(i + vec3(0, 0, 1)), tigHash(i + vec3(1, 0, 1)), f.x), mix(tigHash(i + vec3(0, 1, 1)), tigHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  // Oxide film colour on stainless by thickness (nm): straw, gold, bronze,
  // purple, blue — the heat-tint sequence.
  vec3 oxide(float nm) {
    vec3 c = vec3(0.80, 0.77, 0.71);
    c = mix(c, vec3(0.86, 0.70, 0.40), smoothstep(25.0, 42.0, nm));
    c = mix(c, vec3(0.70, 0.44, 0.24), smoothstep(42.0, 58.0, nm));
    c = mix(c, vec3(0.52, 0.25, 0.38), smoothstep(58.0, 74.0, nm));
    c = mix(c, vec3(0.32, 0.26, 0.62), smoothstep(74.0, 88.0, nm));
    c = mix(c, vec3(0.22, 0.38, 0.78), smoothstep(88.0, 105.0, nm));
    c = mix(c, vec3(0.46, 0.63, 0.86), smoothstep(110.0, 140.0, nm));
    return c;
  }
  // Bead height (mm) at distance d from the seam, s along it, flat position p.
  float beadHeight(float d, float s, vec2 p) {
    vec3 p3 = vec3(p, 0.0);
    float e = d / (0.8 + 0.45 * tigNoise(p3 / 35.0));
    float isBead = 1.0 - smoothstep(2.2, 2.7, e);
    float pitch = ${TIG_PITCH_GLSL};
    float phase = (s - 0.18 * d * d) / pitch;
    float ripple = 0.5 + 0.5 * sin(6.2831853 * (phase + 0.12 * sin(6.2831853 * phase)));
    float u = clamp(e / 2.6, 0.0, 1.0);
    return isBead * (0.35 * (1.0 - u * u) + 0.035 * ripple);
  }
  vec3 toSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  void main() {
    vec3 col = baseColor;
    float rough = baseRough;
    float metal = baseMetal;
    float ao = 1.0;
    float h = 0.0;
    vec2 slope = vec2(0.0);

    if (brushedOn == 1) {
      // Brush lines brushGrain mm apart at brushAngle on the flat sheet.
      vec2 across = vec2(-sin(brushAngle), cos(brushAngle));
      float row = floor(dot(vFlat, across) / max(brushGrain, 0.01));
      float along = dot(vFlat, vec2(cos(brushAngle), sin(brushAngle)));
      float r1 = tigHash(vec3(row, 1.0, 7.0));
      float r2 = tigHash(vec3(row + 1.0, 1.0, 7.0));
      float streak = 0.5 + 0.5 * sin(along / span * 6.2831853 * (1.0 + floor(r2 * 4.0)) + r1 * 6.28);
      rough *= 0.88 + 0.12 * (0.65 * r1 + 0.35 * streak * r2);
    }
    if (heatOn == 1) {
      vec2 uvFlat = (vFlat - lo) / heatSize + heatOffset;
      float t = texture2D(film, uvFlat).r;
      col = oxide(mix(heatRange.x, heatRange.y, t));
    }

    // Pressed pattern (as in the viewer: flat mm from the UVs' corner).
    if (patId > 0) {
      vec2 pf = vFlat - lo;
      float ph = patHeight(pf);
      float phx = patHeight(pf + dFdx(vFlat));
      float phy = patHeight(pf + dFdy(vFlat));
      slope += patDepth * vec2(phx - ph, phy - ph) / mmPerTexel;
      if (patTops > 0.5) {
        float top = patPolish(ph);
        col = mix(col, vec3(0.86, 0.87, 0.89), top);
        rough = mix(rough, 0.05, top);
      }
    }

    // Hammertone powder: the beaten dimples (fine texture is finer than a
    // texel; its roughness carries it).
    if (powTex > 1.5) {
      float h0 = powHeight(vFlat - lo, powTex);
      float hx2 = powHeight(vFlat - lo + dFdx(vFlat), powTex);
      float hy2 = powHeight(vFlat - lo + dFdy(vFlat), powTex);
      slope += 0.1 * vec2(hx2 - h0, hy2 - h0) / mmPerTexel;
    }

    if (weldMode == 2) {
      // Painted over: the bead's shape only, in the paint's colour.
      float u0 = clamp(vTig / 2.6, 0.0, 1.0);
      float b0 = (1.0 - smoothstep(2.2, 2.9, vTig)) * 0.3 * (1.0 - u0 * u0);
      float dx = vTig + dFdx(vTig);
      float dy = vTig + dFdy(vTig);
      float ux = clamp(dx / 2.6, 0.0, 1.0);
      float uy = clamp(dy / 2.6, 0.0, 1.0);
      float bx = (1.0 - smoothstep(2.2, 2.9, dx)) * 0.3 * (1.0 - ux * ux);
      float by = (1.0 - smoothstep(2.2, 2.9, dy)) * 0.3 * (1.0 - uy * uy);
      slope += vec2(bx - b0, by - b0) / mmPerTexel;
    }
    if (weldMode == 0) {
      float d = vTig;
      vec3 p3 = vec3(vFlat, 0.0);
      float wander = tigNoise(p3 / 35.0);
      float mottle = tigNoise(p3 / 1.3);
      float e = d / (0.8 + 0.45 * wander);
      float isBead = 1.0 - smoothstep(2.2, 2.7, e);
      float pitch = ${TIG_PITCH_GLSL};
      float phase = (vTigS - 0.18 * d * d) / pitch;
      float ripple = 0.5 + 0.5 * sin(6.2831853 * (phase + 0.12 * sin(6.2831853 * phase)));
      // Height one texel right and one up: the varyings change linearly
      // across a triangle, so their screen derivatives step them exactly.
      h = beadHeight(vTig, vTigS, vFlat);
      float hx = beadHeight(vTig + dFdx(vTig), vTigS + dFdx(vTigS), vFlat + dFdx(vFlat));
      float hy = beadHeight(vTig + dFdy(vTig), vTigS + dFdy(vTigS), vFlat + dFdy(vFlat));
      slope += vec2(hx - h, hy - h) / mmPerTexel;

      vec3 bead = mix(vec3(0.30, 0.25, 0.22), vec3(0.42, 0.34, 0.26), ripple);
      bead = mix(bead, vec3(0.30, 0.31, 0.40), 0.5 * mottle);
      vec3 c = bead;
      c = mix(c, vec3(0.22, 0.19, 0.22), smoothstep(2.4, 2.8, e));
      c = mix(c, vec3(0.26, 0.40, 0.86), smoothstep(2.8, 3.2, e));
      c = mix(c, vec3(0.66, 0.28, 0.55), smoothstep(3.3, 3.8, e));
      c = mix(c, vec3(0.92, 0.66, 0.30), smoothstep(3.8, 4.4, e));
      c = mix(c, vec3(0.72, 0.54, 0.36), smoothstep(4.4, 5.6, e));
      c = mix(c, vec3(0.82, 0.72, 0.52), smoothstep(5.6, 9.0, e));
      float w = 1.0 - smoothstep(8.0, 14.0, e);
      vec3 base = mix(col, vec3(0.74, 0.72, 0.68), 0.5);
      col = mix(col, mix(base, c, mix(0.6, 1.0, isBead)), w);

      float haze = mix(0.24, 0.09, smoothstep(2.6, 8.0, e)) + 0.04 * (wander - 0.5);
      rough = mix(rough, max(rough, haze), w);
      rough = mix(rough, mix(0.42, 0.24, ripple) + 0.12 * mottle, isBead);
      metal = mix(1.0, 0.45, isBead);
      ao = mix(1.0, 0.5 + 0.2 * mottle, isBead);
    } else if (weldMode == 1) {
      float bare = 1.0 - smoothstep(3.0, 6.0, vTig);
      col = mix(col, vec3(0.86, 0.87, 0.89), bare);
      rough = mix(rough, 0.09, bare);
    }

    if (channel == 0) {
      gl_FragColor = vec4(toSrgb(col), 1.0);
    } else if (channel == 1) {
      gl_FragColor = vec4(ao, clamp(rough, 0.02, 1.0), metal, 1.0);
    } else {
      vec3 n = normalize(vec3(-slope, 1.0));
      gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
    }
  }
`;

// Fills the empty texels round the outline with their neighbours' colour, so
// filtering at the weld edge never picks up the blank background.
const dilateFragment = /* glsl */ `
  uniform sampler2D src;
  uniform vec2 texel;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(src, vUv);
    if (c.a > 0.5) { gl_FragColor = c; return; }
    vec4 sum = vec4(0.0);
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec4 s = texture2D(src, vUv + vec2(float(x), float(y)) * texel);
        if (s.a > 0.5) sum += vec4(s.rgb, 1.0);
      }
    gl_FragColor = sum.a > 0.0 ? vec4(sum.rgb / sum.a, 1.0) : vec4(0.0);
  }
`;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function toCanvas(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, size: number): HTMLCanvasElement {
  const px = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(target, 0, 0, size, size, px);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  // GL rows run bottom-up; images run top-down (top row = v 1).
  for (let y = 0; y < size; y++) {
    const from = (size - 1 - y) * size * 4;
    img.data.set(px.subarray(from, from + size * 4), y * size * 4);
  }
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function greenChannel(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const ctx = c.getContext('2d')!;
  const img = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
  for (let i = 0; i < img.data.length; i += 4) img.data[i] = img.data[i + 2] = img.data[i + 1];
  ctx.putImageData(img, 0, 0);
  return c;
}

export function bakeMaps(input: BakeInput, film: THREE.Texture | null): BakedMaps {
  const { geom, outlines, look, size } = input;
  const pts = outlines.flat();
  const lo = new THREE.Vector2(Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])));
  const span = Math.max(Math.max(...pts.map((p) => p[0])) - lo.x, Math.max(...pts.map((p) => p[1])) - lo.y, 1e-6);
  const { dist, along } = tigDistances(geom.uv, outlines);
  const coat = input.opts.coat;
  const fp = finishParams(look, input.opts, input.pvd, input.beetleFace);
  const painted = coat === 'powder' || coat === 'candy';
  const coated = !!coat;
  const o = input.opts;
  // A thick powder coat fills fine patterns (as in the viewer).
  const fill = coat === 'powder' ? Math.min(1, Math.max(0.15, (o.patternSize - 0.8) / 6)) : 1;

  // The top sheet drawn flat: positions are its UVs.
  const g = new THREE.BufferGeometry();
  const n = geom.uv.length / 2;
  const flatPos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    flatPos[i * 3] = geom.uv[i * 2];
    flatPos[i * 3 + 1] = geom.uv[i * 2 + 1];
  }
  g.setAttribute('position', new THREE.BufferAttribute(flatPos, 3));
  g.setAttribute('tig', new THREE.BufferAttribute(dist, 1));
  g.setAttribute('tigS', new THREE.BufferAttribute(along, 1));
  g.setIndex(new THREE.BufferAttribute(geom.indices.slice(0, geom.topTriangles * 3), 1));

  const material = new THREE.ShaderMaterial({
    vertexShader: bakeVertex,
    fragmentShader: bakeFragment,
    side: THREE.DoubleSide,
    uniforms: {
      channel: { value: 0 },
      brushedOn: { value: look === 'brushed' ? 1 : 0 },
      heatOn: { value: coat === 'heat' ? 1 : 0 },
      patId: { value: patternIndex(o.pattern) },
      patSize: { value: o.patternSize },
      patDepth: { value: patternDepthMm(o.patternSize, o.patternDepth) * fill },
      patAngle: { value: (o.patternAngle * Math.PI) / 180 },
      patTops: { value: o.patternTops && !painted ? (o.patternInvert ? 2 : 1) : 0 },
      patNeg: { value: o.patternNegative ? 1 : 0 },
      patLevel: { value: o.patternLevel },
      weldMode: { value: input.showWelds ? (painted ? 2 : coated ? 1 : 0) : -1 },
      baseMetal: { value: fp.metal },
      powTex: { value: coat === 'powder' ? { smooth: 0, fine: 1, hammer: 2 }[o.powderTexture] : 0 },
      baseColor: { value: fp.base },
      baseRough: { value: fp.rough },
      mmPerTexel: { value: span / size },
      brushAngle: { value: (input.opts.brushAngle * Math.PI) / 180 },
      brushGrain: { value: input.opts.brushGrain },
      film: { value: film },
      heatSize: { value: Math.max(input.opts.heatSize, 1) },
      heatOffset: { value: new THREE.Vector2(input.opts.heatX, input.opts.heatY) },
      heatRange: { value: new THREE.Vector2(25, 45 + 110 * input.opts.heatRange) },
      lo: { value: lo },
      span: { value: span },
    },
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(g, material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const dilate = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: dilateFragment,
    uniforms: { src: { value: null }, texel: { value: new THREE.Vector2(1 / size, 1 / size) } },
  });
  const quadScene = new THREE.Scene();
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), dilate));

  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  const rt = () => new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  const a = rt();
  const b = rt();

  const bakeOne = (channel: number) => {
    material.uniforms.channel.value = channel;
    renderer.setRenderTarget(a);
    renderer.clear();
    renderer.render(scene, camera);
    // Grow the edge out by a few texels.
    let src = a;
    let dst = b;
    for (let i = 0; i < 8; i++) {
      dilate.uniforms.src.value = src.texture;
      renderer.setRenderTarget(dst);
      renderer.render(quadScene, camera);
      [src, dst] = [dst, src];
    }
    renderer.setRenderTarget(null);
    return toCanvas(renderer, src, size);
  };

  try {
    const colour = bakeOne(0);
    const orm = bakeOne(1);
    const normal = bakeOne(2);
    return { colour, orm, normal, roughness: greenChannel(orm), finish: (FINISH_NAMES[look] ?? 'Stainless') + (coat ? `, ${COAT_NAMES[coat]}` : ''), clearcoat: fp.coat };
  } finally {
    a.dispose();
    b.dispose();
    g.dispose();
    material.dispose();
    dilate.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export function canvasPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode the texture'))), 'image/png'));
}
