// Viewport materials. World is Z-up and millimetres (same as the solver).

import * as THREE from 'three';
import { PATTERN_GLSL, POWDER_GLSL, patternDepthMm, patternIndex, type PatternId } from './patterns';
import { TIG_PITCH_GLSL } from './tigBand';

const overlayVertex = /* glsl */ `
  attribute float crease;
  attribute float contact;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrease;
  varying float vContact;
  varying float vZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vZ = position.z;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vCrease = crease;
    vContact = contact;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const overlayFragment = /* glsl */ `
  uniform int mode;          // 0 zebra, 1 height, 2 crease, 3 contact
  uniform float stripes;
  uniform vec2 zRange;
  uniform float creaseMin;
  uniform float creaseMax;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vCrease;
  varying float vContact;
  varying float vZ;

  // Perceptual-ish ramp: deep blue → teal → warm white.
  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 a = vec3(0.10, 0.16, 0.42);
    vec3 b = vec3(0.12, 0.62, 0.70);
    vec3 c = vec3(0.98, 0.86, 0.55);
    vec3 d = vec3(1.0, 0.98, 0.94);
    if (t < 0.4) return mix(a, b, t / 0.4);
    if (t < 0.8) return mix(b, c, (t - 0.4) / 0.4);
    return mix(c, d, (t - 0.8) / 0.2);
  }

  void main() {
    vec3 n = normalize(vNormal);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorldPos);
    float lambert = clamp(dot(n, v), 0.0, 1.0);
    vec3 col;
    if (mode == 0) {
      // Zebra: stripes reflected off the surface — kinks in the stripes are kinks in the form.
      vec3 r = reflect(-v, n);
      float a = asin(clamp(r.z, -1.0, 1.0)) / 3.14159265 * stripes;
      float k = sin(a * 6.2831853);
      float aa = max(fwidth(k), 1e-4);
      float s = smoothstep(-aa, aa, k);
      col = mix(vec3(0.02), vec3(0.96), s);
      gl_FragColor = vec4(col, 1.0);
      return;
    } else if (mode == 1) {
      // Height from the seam (the piece's own z = 0, before it is set on the
      // floor): dark at the weld, warm white at the top of each sheet.
      col = ramp(abs(vZ) / max(max(-zRange.x, zRange.y), 1e-6));
    } else if (mode == 2) {
      // creaseMax adapts to the piece on screen, so even a gently creased
      // piece shows its main crease; the strongest folds run hot to white.
      float t = clamp((vCrease - creaseMin) / max(creaseMax - creaseMin, 1e-6), 0.0, 1.0);
      col = mix(vec3(0.16, 0.18, 0.21), vec3(0.95, 0.36, 0.16), smoothstep(0.15, 0.6, t));
      col = mix(col, vec3(1.0, 0.93, 0.72), smoothstep(0.6, 1.0, t));
    } else {
      col = mix(vec3(0.22, 0.24, 0.27), vec3(0.98, 0.72, 0.36), clamp(vContact, 0.0, 1.0));
    }
    gl_FragColor = vec4(col * (0.35 + 0.65 * lambert), 1.0);
  }
`;

// ── TIG weld band ──────────────────────────────────────────────────────────
// Every point carries `tig` — its distance (mm, flat pattern) from the TIG
// weld round the outline and holes — and `tigS`, how far along that weld it
// is (mm). Mode 0 (bare stainless finishes): the weld as welded, before
// passivating. Mode 1 (PVD, iridescent, heat tint): the welding has burnt the
// coating off — a bare polished stainless seam blending into the colour.
// Both: the seam itself is a rounded fillet (shading), so its edge catches
// the light instead of meeting in a knife-sharp line.
const tigVertexHead = `attribute float tig;
attribute float tigS;
uniform vec2 patSpan;
varying vec2 vPatFlat;
varying float vTig;
varying float vTigS;
varying vec3 vTigPos;
`;
const tigFragmentHead = PATTERN_GLSL + POWDER_GLSL + `
varying vec2 vPatFlat;
uniform float candyOn;
uniform vec3 candyColor;
uniform float candyDepth;
uniform float tigOn;
uniform int tigMode;
uniform float tigScale;
uniform float tigFillet;
varying float vTig;
varying float vTigS;
varying vec3 vTigPos;
float tigHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
// Smooth value noise, 0–1.
float tigNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(tigHash(i), tigHash(i + vec3(1, 0, 0)), f.x), mix(tigHash(i + vec3(0, 1, 0)), tigHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(tigHash(i + vec3(0, 0, 1)), tigHash(i + vec3(1, 0, 1)), f.x), mix(tigHash(i + vec3(0, 1, 1)), tigHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
// Tilt the normal by a height field h (mm) using screen-space derivatives
// (bump mapping without a texture). Unnormalised position derivatives keep h
// in real millimetres whatever the zoom.
vec3 tigBump(vec3 pos, vec3 n, float h, float faceDir) {
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}
// The same, given the height's change one pixel right (dhx) and up (dhy).
vec3 patBumpD(vec3 pos, vec3 n, float dhx, float dhy, float faceDir) {
  vec3 sx = dFdx(pos);
  vec3 sy = dFdy(pos);
  vec3 r1 = cross(sy, n);
  vec3 r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - grad);
}
`;
// Profile read off Guy's photos of unpassivated TIG edge welds (brushed and
// mirror sheet), distances in mm from the seam:
//   0–2.6   bead: domed, with stacked crescent ripples along it; lumpy,
//           bronze-grey with temper colours catching on the ripples
//   ~2.8    a thin dark line where the bead stops
//   3–4.6   a narrow bright line: blue → magenta → gold
//   4.6–13  a broad soft straw/tan glow, fading; its width wanders with the
//           heat input along the weld
// The colours are an oxide film (interference), so besides the painted
// colours a real thin film runs over the zone, thickest at the bead: that is
// what gives the slight shimmer as the view changes.
const tigFragment = /* glsl */ `
  float tigKeep = 1.0;   // iridescence kept (coated: burnt off at the seam)
  float tigCoat = 1.0;   // clear-coat kept
  float tigAniso = 1.0;  // brushed grain kept
  float tigShade = 1.0;  // light reaching the bead in the seam's crease
  float tigIri = -1.0;   // >= 0: weld oxide film strength (replaces the finish's)
  float tigNm = 0.0;     // weld oxide film thickness, nm
  if (tigOn > 0.5) {
    float d = vTig / tigScale;
    vec3 viewPos = -vViewPosition;
    // Fillet: within the radius of the seam the surface rolls over to face
    // straight outward, like the rounded weld edge.
    if (tigFillet > 0.0 && d < tigFillet * 1.6) {
      vec3 wn = transformDirectionByInverseViewMatrix(normal, viewMatrix);
      float hl = length(wn.xy);
      if (hl > 0.05) {
        vec3 outward = vec3(wn.xy / hl, 0.0);
        float total = acos(clamp(dot(wn, outward), -1.0, 1.0));
        float f = clamp(d / max(tigFillet * total, 1e-3), 0.0, 1.0);
        vec3 fn = normalize(mix(outward, wn, f));
        normal = normalize((viewMatrix * vec4(fn, 0.0)).xyz);
      }
    }
    if (tigMode == 0) {
      float wander = tigNoise(vTigPos / 35.0);              // slow change along the weld
      float mottle = tigNoise(vTigPos / 1.3);               // bead lumps
      // The bright line and halo sit a little further out where more heat went in.
      float e = d / (0.8 + 0.45 * wander);
      float isBead = 1.0 - smoothstep(2.2, 2.7, e);

      // Bead shape: a low dome, crescent ripples (each one a frozen edge of
      // the weld pool, trailing back from the centre), and small lumps.
      // Evenly spaced pulses, all the same crescent (curve from the plain
      // distance, so the heat wander doesn't bend some more than others).
      float pitch = ${TIG_PITCH_GLSL};
      // Gentle arcs: much more curve and neighbouring ripples close into ovals.
      float phase = (vTigS - 0.18 * d * d) / pitch;
      // Each ripple rises gently and drops away a little more steeply.
      float ripple = 0.5 + 0.5 * sin(6.2831853 * (phase + 0.12 * sin(6.2831853 * phase)));
      // Fade only when the ripples themselves get too fine to draw — judged
      // along the weld, so a bead seen edge-on (where the across-the-bead part
      // of the phase changes fast) doesn't lose its ripples in patches.
      // Gone before they are ~5 pixels apart: finer than that they shimmer
      // into uneven stripes.
      float fade = 1.0 - smoothstep(0.1, 0.2, fwidth(vTigS / pitch));
      float u = clamp(e / 2.6, 0.0, 1.0);
      float dome = 0.35 * (1.0 - u * u);
      float h = isBead * (dome + fade * 0.035 * ripple);
      normal = tigBump(viewPos, normal, h, faceDirection);

      // Bead colour: bronze-grey, darker in the ripple troughs, temper
      // colours (gold / blue-grey) catching on the crests.
      vec3 bead = mix(vec3(0.30, 0.25, 0.22), vec3(0.42, 0.34, 0.26), ripple * fade);
      bead = mix(bead, vec3(0.30, 0.31, 0.40), 0.5 * mottle);
      // Outward from the bead.
      vec3 c = bead;
      c = mix(c, vec3(0.22, 0.19, 0.22), smoothstep(2.4, 2.8, e));  // dark line
      c = mix(c, vec3(0.26, 0.40, 0.86), smoothstep(2.8, 3.2, e));  // blue
      c = mix(c, vec3(0.66, 0.28, 0.55), smoothstep(3.3, 3.8, e));  // magenta
      c = mix(c, vec3(0.92, 0.66, 0.30), smoothstep(3.8, 4.4, e));  // gold
      c = mix(c, vec3(0.72, 0.54, 0.36), smoothstep(4.4, 5.6, e));  // bronze-tan
      c = mix(c, vec3(0.82, 0.72, 0.52), smoothstep(5.6, 9.0, e));  // straw
      float w = 1.0 - smoothstep(8.0, 14.0, e);
      // Painted colour carries most of the hue, the film adds the shimmer.
      vec3 base = mix(diffuseColor.rgb, vec3(0.74, 0.72, 0.68), 0.5);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(base, c, mix(0.6, 1.0, isBead)), w);
      // Oxide film: thick at the bead, thinning outward (thinner = straw).
      // (Even on the bead: a film that varied with the lumps drew oil-like rings.)
      tigNm = mix(15.0 + 105.0 * exp(-(e - 2.6) / 1.4), 112.0 + 12.0 * wander, isBead);
      tigIri = w * mix(0.75, 0.2, isBead);

      // Surface: an unpassivated weld never keeps the sheet's polish. The
      // bead is re-melted metal (no grain, no clear-coat), glinting on the
      // ripple crests; the oxide skin beside it is hazy — roughest by the
      // bead, easing back to the sheet's own finish as the tint fades.
      float haze = mix(0.24, 0.09, smoothstep(2.6, 8.0, e)) + 0.04 * (wander - 0.5);
      roughnessFactor = mix(roughnessFactor, max(roughnessFactor, haze), w);
      roughnessFactor = mix(roughnessFactor, mix(0.42, 0.24, ripple * fade) + 0.12 * mottle, isBead);
      // Weld scale is partly oxide: less mirror-like than the sheet.
      metalnessFactor = mix(metalnessFactor, 0.45, isBead);
      // The bead sits in the crease where the two sheets meet: a little shaded.
      tigShade = mix(1.0, 0.5 + 0.2 * mottle, isBead);
      tigCoat = 1.0 - w;
      tigAniso = 1.0 - max(isBead, 0.5 * w);
    } else if (tigMode == 1) {
      float bare = 1.0 - smoothstep(3.0, 6.0, d);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.89), bare);
      roughnessFactor = mix(roughnessFactor, 0.09, bare);
      tigKeep = 1.0 - bare;
    } else {
      // Powder coat / candy put on after welding: the bead's shape under the
      // paint (softened by it), the paint's own colour.
      float u = clamp(d / 2.6, 0.0, 1.0);
      float h = (1.0 - smoothstep(2.2, 2.9, d)) * 0.3 * (1.0 - u * u);
      normal = tigBump(viewPos, normal, h, faceDirection);
    }
  }
`;

export interface TigUniforms {
  tigOn: { value: number };
  tigMode: { value: number };
  /** Widths × this (1 = as in Guy's reference photos, ~1 mm sheet). */
  tigScale: { value: number };
  /** Radius of the rounded weld edge, mm (Weld fillet radius setting). */
  tigFillet: { value: number };
  /** Pressed pattern: index + 1 in PATTERNS (0 = none), repeat (mm), raised
   *  height (mm), angle (radians), polished tops (0/1), and mm per UV unit. */
  patId: { value: number };
  patSize: { value: number };
  patDepth: { value: number };
  patAngle: { value: number };
  patTops: { value: number };
  patNeg: { value: number };
  patLevel: { value: number };
  /** Powder-coat texture (0 smooth, 1 fine, 2 hammertone). */
  powTex: { value: number };
  /** Candy: on, its colour (linear), how deep (the exponent face-on). */
  candyOn: { value: number };
  candyColor: { value: THREE.Color };
  candyDepth: { value: number };
  patSpan: { value: THREE.Vector2 };
}

function withTig(sh: THREE.WebGLProgramParametersWithUniforms, u: TigUniforms) {
  Object.assign(sh.uniforms, u);
  sh.vertexShader = tigVertexHead + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vTig = tig;
  vTigS = tigS;
  vTigPos = transformed;
  vPatFlat = uv * patSpan;`);
  sh.fragmentShader = tigFragmentHead + sh.fragmentShader;
}

// Pressed pattern (patterns.ts): the surface bumped by its height field in
// real millimetres (no tangents needed: screen-space derivatives, like the
// weld bead), faded out before the repeat gets too fine to draw. Polished
// tops: the raised parts polished back to bright bare steel, the colour left
// in the hollows (two-tone catalogue sheets).
const patternFragment = /* glsl */ `
  float patKeep = 1.0;   // coating / grain kept (gone on polished tops)
  vec2 pdh = vec2(0.0);  // height change (mm) one pixel right / up
  float ph = 0.0;
  float pfade = 0.0;
  if (patId > 0) {
    ph = patHeight(vPatFlat);
    float cells = length(fwidth(vPatFlat)) / max(patSize, 0.05);
    pfade = 1.0 - smoothstep(0.12, 0.3, cells);
    // Slope across the flat sheet from the pattern itself (smooth at every
    // pixel; the 2x2-pixel derivative of the height drew stair-steps), then
    // onto the screen through how the flat sheet lies there.
    float pe = 0.01 * patSize;
    vec2 pg = vec2(patHeight(vPatFlat + vec2(pe, 0.0)) - ph, patHeight(vPatFlat + vec2(0.0, pe)) - ph) / pe;
    float pk = patDepth * pfade;
    pdh += pk * vec2(dot(pg, dFdx(vPatFlat)), dot(pg, dFdy(vPatFlat)));
  }
  if (powTex > 0.5) {
    // Powder-coat texture: fine sand, or hammertone dimples.
    float sc = powTex < 1.5 ? 0.3 : 5.0;
    float amp = powTex < 1.5 ? 0.02 : 0.1;
    float ff = 1.0 - smoothstep(0.15, 0.4, length(fwidth(vPatFlat)) / sc);
    float pe2 = 0.02 * sc;
    float h0 = powHeight(vPatFlat, powTex);
    vec2 g2 = vec2(powHeight(vPatFlat + vec2(pe2, 0.0), powTex) - h0, powHeight(vPatFlat + vec2(0.0, pe2), powTex) - h0) / pe2;
    pdh += amp * ff * vec2(dot(g2, dFdx(vPatFlat)), dot(g2, dFdy(vPatFlat)));
  }
  if (pdh.x != 0.0 || pdh.y != 0.0) normal = patBumpD(-vViewPosition, normal, pdh.x, pdh.y, faceDirection);
  if (patId > 0) {
    if (patTops > 0.5) {
      // Too fine to see: the average share of tops instead of shimmering.
      float top = mix(0.5, patPolish(ph), pfade);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.89), top);
      roughnessFactor = mix(roughnessFactor, 0.05, top);
      patKeep = 1.0 - top;
    }
  }
  if (candyOn > 0.5) {
    // Candy: coloured glass over the metal. Light crosses it twice, and
    // further at a slant, so the colour deepens towards the edges.
    float ndv = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.12, 1.0);
    diffuseColor.rgb *= pow(candyColor, vec3(candyDepth / ndv));
  }
`;

/** After the colour/roughness are known (and after the beetle colour). */
function tigAfter(sh: THREE.WebGLProgramParametersWithUniforms, anchor: string) {
  sh.fragmentShader = sh.fragmentShader
    .replace(anchor, `${anchor}
${patternFragment}
${tigFragment}`)
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
#ifdef USE_IRIDESCENCE
  if (tigIri >= 0.0) {
    material.iridescence = tigIri;
    material.iridescenceIOR = 2.3;
    material.iridescenceThickness = tigNm;
  } else {
    material.iridescence *= tigKeep * patKeep;
  }
#endif
#ifdef USE_CLEARCOAT
  material.clearcoat *= tigCoat;
#endif
#ifdef USE_ANISOTROPY
  material.anisotropy *= tigAniso * patKeep;
#endif`)
    .replace('#include <aomap_fragment>', `#include <aomap_fragment>
  reflectedLight.indirectDiffuse *= tigShade;
  reflectedLight.indirectSpecular *= tigShade;
  reflectedLight.directSpecular *= tigShade;`);
}

/** Settings for the finishes that have a pattern. */
export interface FinishOpts {
  /** Brushed: grain direction on the flat sheet, degrees (0 = along X). */
  brushAngle: number;
  /** Brushed: spacing of the brush lines, mm. */
  brushGrain: number;
  /** Heat tint: size of the colour pattern, mm. */
  heatSize: number;
  /** Heat tint: pattern position, 0–1 across one repeat. */
  heatX: number;
  heatY: number;
  /** Heat tint: 0 = pale straw only … 1 = right through bronze and purple to blue. */
  heatRange: number;
  /** PVD: size of the slight colour variation in the coating, mm. */
  pvdSize: number;
  /** PVD: variation position, 0–1 across one repeat. */
  pvdX: number;
  pvdY: number;
  /** PVD: how strong the variation is (0 = perfectly even colour). */
  pvdAmount: number;
  /** Colour coating over the finish (session 18), or bare stainless. */
  coat: Coat | null;
  /** Pressed pattern (purely visual), or a plain sheet. */
  pattern: PatternId | null;
  /** Pattern repeat, mm. */
  patternSize: number;
  /** Pattern depth, 0-1 (1 = raised by 12 % of the repeat). */
  patternDepth: number;
  /** Pattern angle on the flat sheet, degrees. */
  patternAngle: number;
  /** Raised parts polished back to bare steel (two-tone). */
  patternTops: boolean;
  /** Two-tone the other way round: hollows polished, colour on the tops. */
  patternInvert: boolean;
  /** Pressed in instead of raised (dots become dimples). */
  patternNegative: boolean;
  /** Two-tone line: the height (0-1 of the pattern's depth) where the
   *  colour meets the polished steel. */
  patternLevel: number;
  /** Powder coat: colour, gloss 0 (matt) - 1 (high gloss), texture, metallic. */
  powderColor: string;
  powderGloss: number;
  powderTexture: PowderTexture;
  powderMetallic: boolean;
  /** Candy: colour and how deep it goes (0 light tint - 1 deep). */
  candyColor: string;
  candyDepth: number;
}

/** Colour coatings that go over any finish. */
export type Coat = 'pvd' | 'iridescent' | 'heat' | 'powder' | 'candy';
export type PowderTexture = 'smooth' | 'fine' | 'hammer';

export const DEFAULT_FINISH_OPTS: FinishOpts = {
  brushAngle: 0,
  brushGrain: 0.3,
  heatSize: 250,
  heatX: 0,
  heatY: 0,
  heatRange: 0.75,
  pvdSize: 250,
  pvdX: 0,
  pvdY: 0,
  pvdAmount: 1,
  coat: null,
  pattern: null,
  patternSize: 9,
  patternDepth: 0.5,
  patternAngle: 0,
  patternTops: false,
  patternInvert: false,
  patternNegative: false,
  patternLevel: 0.2,
  powderColor: '#383e42',
  powderGloss: 0.5,
  powderTexture: 'smooth',
  powderMetallic: false,
  candyColor: '#b3121f',
  candyDepth: 0.5,
};

/** Rows in the brushed-grain texture: one row per brush line. */
const GRAIN_ROWS = 512;

/** Brush lines: every row its own shade, streaks of varying length. */
function brushGrainMap(): THREE.Texture {
  const n = GRAIN_ROWS;
  const data = new Uint8Array(n * n * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = Array.from({ length: n }, () => rnd());
  // Each row fades in and out along its length (streaks don't run forever).
  const phase = Array.from({ length: n }, () => rnd() * Math.PI * 2);
  const freq = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 4));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const along = 0.5 + 0.5 * Math.sin((x / n) * Math.PI * 2 * freq[y] + phase[y]);
      // Low contrast: real brushing changes the surface only slightly from line
      // to line; strong contrast read as deep scratches and harsh streaks.
      const v = 0.88 + 0.12 * (0.65 * rows[y] + 0.35 * along * rows[(y + 1) % n]);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(255 * v);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.center.set(0.5, 0.5);
  tex.needsUpdate = true;
  return tex;
}

export interface ViewerMaterials {
  tig: TigUniforms;
  grain: THREE.Texture;
  metal: THREE.MeshPhysicalMaterial;
  /** Two-tone beetle shimmer: one colour face-on, the other at glancing angles. */
  beetle: THREE.MeshPhysicalMaterial;
  beetleFace: { value: THREE.Color };
  beetleEdge: { value: THREE.Color };
  clay: THREE.MeshStandardMaterial;
  overlay: THREE.ShaderMaterial;
  /** Drawn over the surface for the Mesh look. */
  wire: THREE.MeshBasicMaterial;
}

/** Smooth swirling noise (0–1) used as the coating-thickness map for the
 *  iridescent and heat-tint looks, so colours vary across the surface. */
export function filmThicknessMap(): THREE.Texture {
  const n = 256;
  const data = new Uint8Array(n * n * 4);
  const waves = Array.from({ length: 5 }, (_, i) => {
    // Whole-number wave counts so the pattern tiles without a seam.
    const a = i * 2.39996 + 0.7;
    const k = 1.2 + i * 0.6;
    const kx = Math.round(Math.cos(a) * k) || 1;
    const ky = Math.round(Math.sin(a) * k) || 1;
    return { kx, ky, ph: i * 1.7, amp: 1 / (1 + i * 0.6) };
  });
  const norm = waves.reduce((t, w) => t + w.amp, 0);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = (x / n) * Math.PI * 2;
      const v = (y / n) * Math.PI * 2;
      let f = 0;
      for (const w of waves) f += w.amp * Math.sin(w.kx * u + w.ky * v + w.ph + Math.sin(v + w.ph) * 0.5);
      const t = Math.round(255 * (0.5 + (0.5 * f) / norm));
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = t;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function createMaterials(): ViewerMaterials {
  const metal = new THREE.MeshPhysicalMaterial({
    color: 0xd9dce1,
    metalness: 1,
    roughness: 0.14,
    clearcoat: 0.2,
    clearcoatRoughness: 0.1,
    side: THREE.DoubleSide,
  });
  metal.iridescenceThicknessMap = filmThicknessMap();
  const grain = brushGrainMap();
  const tig: TigUniforms = {
    tigOn: { value: 0 },
    tigMode: { value: 0 },
    tigScale: { value: 1 },
    tigFillet: { value: 1.5 },
    patId: { value: 0 },
    patSize: { value: 5 },
    patDepth: { value: 0 },
    patAngle: { value: 0 },
    patTops: { value: 0 },
    patNeg: { value: 0 },
    patLevel: { value: 0.2 },
    powTex: { value: 0 },
    candyOn: { value: 0 },
    candyColor: { value: new THREE.Color('#b3121f') },
    candyDepth: { value: 1 },
    patSpan: { value: new THREE.Vector2(300, 300) },
  };
  metal.onBeforeCompile = (sh) => {
    withTig(sh, tig);
    tigAfter(sh, '#include <normal_fragment_maps>');
  };
  metal.customProgramCacheKey = () => 'metal-tig';
  const beetleFace = { value: new THREE.Color('#2fd27a') };
  const beetleEdge = { value: new THREE.Color('#2350e0') };
  const beetle = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: 0.08,
    clearcoat: 0.25,
    clearcoatRoughness: 0.06,
    side: THREE.DoubleSide,
  });
  beetle.onBeforeCompile = (sh) => {
    sh.uniforms.beetleFace = beetleFace;
    sh.uniforms.beetleEdge = beetleEdge;
    sh.fragmentShader =
      'uniform vec3 beetleFace;\nuniform vec3 beetleEdge;\n' +
      sh.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Colour shifts with the angle you see the surface at, like a
          // beetle's shell: face-on one colour, rolling over to the other.
          float ndv = clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
          float k = smoothstep(0.35, 0.95, ndv);
          diffuseColor.rgb = mix(beetleEdge, beetleFace, k);
        }
        // tig-anchor`,
      );
    withTig(sh, tig);
    tigAfter(sh, '// tig-anchor');
  };
  beetle.customProgramCacheKey = () => 'beetle';
  const clay = new THREE.MeshStandardMaterial({ color: 0xb9bcc2, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  const overlay = new THREE.ShaderMaterial({
    vertexShader: overlayVertex,
    fragmentShader: overlayFragment,
    uniforms: {
      mode: { value: 0 },
      stripes: { value: 14 },
      zRange: { value: new THREE.Vector2(-1, 1) },
      creaseMin: { value: 0 },
      creaseMax: { value: 0.6 },
    },
    side: THREE.DoubleSide,
  });
  const wire = new THREE.MeshBasicMaterial({ color: 0xa6fff0, wireframe: true, transparent: true, opacity: 0.7, depthWrite: false });
  return { tig, grain, metal, beetle, beetleFace, beetleEdge, clay, overlay, wire };
}

export type Look =
  | 'polished'
  | 'mirror'
  | 'brushed'
  | 'bead'
  | 'zebra'
  | 'height'
  | 'crease'
  | 'contact'
  | 'mesh';

export interface LookInfo {
  value: Look;
  label: string;
  group: 'finish' | 'analysis';
  title: string;
  /** CSS background for the palette swatch. */
  swatch: string;
}

const chrome = (a: string, b: string, c: string) => `radial-gradient(circle at 32% 28%, #fff 0%, ${a} 22%, ${b} 55%, ${c} 100%)`;

export const LOOKS: LookInfo[] = [
  { value: 'polished', label: 'Polished', group: 'finish', title: 'Polished stainless', swatch: chrome('#dfe3e8', '#8d949d', '#2b3036') },
  { value: 'mirror', label: 'Mirror', group: 'finish', title: 'Mirror-polished stainless', swatch: chrome('#f2f4f7', '#6d747d', '#15181c') },
  { value: 'brushed', label: 'Brushed', group: 'finish', title: 'Brushed (satin) stainless', swatch: 'repeating-linear-gradient(100deg, #c9cdd3 0 2px, #aab0b8 2px 4px), #bbb' },
  { value: 'bead', label: 'Bead-blast', group: 'finish', title: 'Bead-blasted (matte) stainless', swatch: 'radial-gradient(circle at 35% 30%, #d7dadf, #9097a0 70%, #5d636b)' },
  { value: 'zebra', label: 'Zebra', group: 'analysis', title: 'Reflected stripes — kinks in stripes are kinks in the form', swatch: 'repeating-linear-gradient(45deg, #f2f2f2 0 4px, #111 4px 8px)' },
  { value: 'height', label: 'Height', group: 'analysis', title: 'Colour by height from the seam: dark at the weld, white at the top of each side', swatch: 'linear-gradient(180deg, #fbe7b0, #1f9eb2 55%, #1a2a6b)' },
  { value: 'crease', label: 'Creases', group: 'analysis', title: 'Where the metal has permanently folded', swatch: 'radial-gradient(circle, #ff7340 0 30%, #3a3d42 70%)' },
  { value: 'contact', label: 'Contact', group: 'analysis', title: 'Where the sheet touches the plates', swatch: 'radial-gradient(circle, #f9b85c 0 40%, #3a3d42 75%)' },
  { value: 'mesh', label: 'Mesh', group: 'analysis', title: 'Show the triangle mesh', swatch: 'repeating-linear-gradient(60deg, transparent 0 5px, #8ee6d2 5px 6px), repeating-linear-gradient(-60deg, transparent 0 5px, #8ee6d2 5px 6px), #2a2e33' },
];

/** The colour squares. */
export const COATS: { value: Coat; label: string; title: string }[] = [
  { value: 'pvd', label: 'PVD', title: 'PVD colour coating over the finish — pick any colour' },
  { value: 'iridescent', label: 'Iridescent', title: 'Two-tone beetle shimmer over the finish — colour shifts with the viewing angle' },
  { value: 'heat', label: 'Heat tint', title: 'Heat-tinted (straw → blue) over the finish' },
  { value: 'powder', label: 'Powder', title: 'Powder coat — opaque paint over everything, welds included; RAL colours, gloss, texture' },
  { value: 'candy', label: 'Candy', title: 'Candy — coloured glass over the polished metal: deeper colour at the edges, the finish shows through' },
];

const OLD_COATED = ['pvd', 'iridescent', 'heat'];

/** A saved look that still exists, else Polished (Clay was dropped in
 *  session 18; PVD / Iridescent / Heat tint became coats over Polished). */
export const knownLook = (l: unknown): Look => (LOOKS.some((x) => x.value === l) ? (l as Look) : 'polished');

/** A saved look + finish settings as they are now: older saves had PVD,
 *  Iridescent and Heat tint as finishes of their own (polished underneath). */
export function migrateFinish(look: unknown, opts: Partial<FinishOpts> | undefined): { look: Look; opts: FinishOpts } {
  const o = { ...DEFAULT_FINISH_OPTS, ...(opts ?? {}) };
  if (typeof look === 'string' && OLD_COATED.includes(look)) return { look: 'polished', opts: { ...o, coat: look as Coat } };
  return { look: knownLook(look), opts: o };
}

export const BEETLE_PRESETS: { name: string; face: string; edge: string }[] = [
  { name: 'Green / blue', face: '#2fd27a', edge: '#2350e0' },
  { name: 'Gold / green', face: '#e3c25a', edge: '#1f9a5a' },
  { name: 'Violet / teal', face: '#8a5cf0', edge: '#1fb5b0' },
  { name: 'Copper / magenta', face: '#e08a4a', edge: '#b02a8a' },
];

/** The stock PVD colours (any other colour from the picker). */
export const PVD_PRESETS: { name: string; color: string }[] = [
  { name: 'Gold', color: '#e7c27a' },
  { name: 'Rose gold', color: '#e8b6a0' },
  { name: 'Champagne', color: '#e3d5bd' },
  { name: 'Bronze', color: '#9c7b62' },
  { name: 'Black', color: '#2a2b2e' },
  { name: 'Graphite', color: '#5a5d63' },
];

/** Common RAL powder-coat colours. */
export const POWDER_PRESETS: { name: string; color: string }[] = [
  { name: '9005 Black', color: '#0e0e10' },
  { name: '9010 White', color: '#f1ece1' },
  { name: '7016 Anthracite', color: '#383e42' },
  { name: '9006 Aluminium', color: '#a1a1a0' },
  { name: '7035 Light grey', color: '#cbd0cc' },
  { name: '3020 Red', color: '#c1121c' },
  { name: '5002 Blue', color: '#20214f' },
  { name: '6005 Green', color: '#0f4336' },
  { name: '1023 Yellow', color: '#f0ca00' },
];

export const CANDY_PRESETS: { name: string; color: string }[] = [
  { name: 'Red', color: '#b3121f' },
  { name: 'Blue', color: '#1747c9' },
  { name: 'Green', color: '#12a040' },
  { name: 'Amber', color: '#e08a10' },
  { name: 'Purple', color: '#7a1fb5' },
  { name: 'Teal', color: '#0f9fa0' },
];

/** Configure the materials for a look; returns the surface material and whether to draw the wireframe. */
export interface LookColors {
  pvd: string;
  beetleFace: string;
  beetleEdge: string;
}

/** The stainless finishes (any of them can take a coat and a pattern). */
export const FINISH_LOOKS: Look[] = ['polished', 'mirror', 'brushed', 'bead'];

/** Each finish's surface: colour, roughness, brushed streak, clear-coat. */
export const FINISH_SURFACE: Record<string, { color: number; rough: number; aniso: number; coat: number }> = {
  polished: { color: 0xd9dce1, rough: 0.14, aniso: 0, coat: 0.2 },
  mirror: { color: 0xe8eaee, rough: 0.03, aniso: 0, coat: 0.6 },
  // Anisotropy kept moderate: at 0.85 the streaked highlight magnified tiny
  // twists in the grain direction across the stretched sheet into dimples.
  brushed: { color: 0xd2d5da, rough: 0.36, aniso: 0.35, coat: 0 },
  bead: { color: 0xc7cacf, rough: 0.55, aniso: 0, coat: 0 },
};

export function applyLook(
  m: ViewerMaterials,
  look: Look,
  colors: LookColors,
  showWelds = false,
  opts: FinishOpts = DEFAULT_FINISH_OPTS,
  /** The flat piece's longer side, mm (UVs run 0–1 across it). */
  spanMm = 300,
): { material: THREE.Material; wire: boolean } {
  // Brushed grain: lines `brushGrain` mm apart, at `brushAngle` on the flat
  // sheet (the sheet is brushed before it is welded and inflated). The
  // highlight streaks across the grain.
  const angle = (opts.brushAngle * Math.PI) / 180;
  const rep = spanMm / (GRAIN_ROWS * Math.max(opts.brushGrain, 0.01));
  m.grain.repeat.set(rep, rep);
  m.grain.rotation = angle;
  const brushed = look === 'brushed';
  // No bump map: the brush lines are far finer than a pixel, and bumping
  // them turned into fake dimples across the surface. The grain shows through
  // roughness and the anisotropic streak instead, like the real thing.
  m.metal.bumpMap = null;
  // Coating-thickness pattern (heat tint, or the slight variation in a PVD
  // coat): size and position, each coat with its own settings.
  const coat = FINISH_LOOKS.includes(look) ? opts.coat : null;
  const film = m.metal.iridescenceThicknessMap!;
  const pvd = coat === 'pvd';
  const hrep = spanMm / Math.max(pvd ? opts.pvdSize : opts.heatSize, 1);
  film.repeat.set(hrep, hrep);
  film.offset.set(pvd ? opts.pvdX : opts.heatX, pvd ? opts.pvdY : opts.heatY);
  m.tig.tigOn.value = showWelds && FINISH_LOOKS.includes(look) ? 1 : 0;
  // Weld: bare as welded; a bare seam through a coating made before
  // welding (PVD, heat tint, iridescent); or painted over (powder, candy).
  const painted = coat === 'powder' || coat === 'candy';
  m.tig.tigMode.value = painted ? 2 : coat ? 1 : 0;
  // Pressed pattern, on any finish.
  m.tig.patId.value = FINISH_LOOKS.includes(look) ? patternIndex(opts.pattern) : 0;
  m.tig.patSize.value = opts.patternSize;
  // A thick powder coat fills fine patterns; deep ones still show.
  const fill = coat === 'powder' ? Math.min(1, Math.max(0.15, (opts.patternSize - 0.8) / 6)) : 1;
  m.tig.patDepth.value = patternDepthMm(opts.patternSize, opts.patternDepth) * fill;
  m.tig.patAngle.value = (opts.patternAngle * Math.PI) / 180;
  // Polished tops: only where the colour is on the metal itself.
  m.tig.patTops.value = opts.patternTops && !painted ? (opts.patternInvert ? 2 : 1) : 0;
  m.tig.powTex.value = coat === 'powder' ? { smooth: 0, fine: 1, hammer: 2 }[opts.powderTexture] : 0;
  m.tig.candyOn.value = coat === 'candy' ? 1 : 0;
  m.tig.candyColor.value.set(opts.candyColor);
  m.tig.candyDepth.value = 0.4 + 1.6 * opts.candyDepth;
  m.tig.patNeg.value = opts.patternNegative ? 1 : 0;
  m.tig.patLevel.value = opts.patternLevel;
  m.tig.patSpan.value.set(spanMm, spanMm);
  const surface = FINISH_SURFACE[look];
  if (surface) {
    // The finish sets the surface; the coat (if any) its colour.
    const target = coat === 'iridescent' ? m.beetle : m.metal;
    target.roughness = surface.rough;
    target.roughnessMap = brushed ? m.grain : null;
    target.anisotropy = surface.aniso;
    target.anisotropyRotation = angle + Math.PI / 2;
    target.clearcoat = coat === 'pvd' ? Math.max(surface.coat, 0.4 * (1 - surface.rough)) : surface.coat;
    target.clearcoatRoughness = 0.1;
    m.metal.metalness = 1;
    target.needsUpdate = true;
    if (coat === 'powder') {
      // Paint: hides the finish (no grain, no polish of its own).
      const fine = opts.powderTexture === 'fine' ? 0.12 : 0;
      m.metal.color.set(opts.powderColor);
      m.metal.metalness = opts.powderMetallic || opts.powderTexture === 'hammer' ? 0.6 : 0;
      m.metal.roughness = Math.min(1, 0.08 + 0.62 * (1 - opts.powderGloss) + fine);
      m.metal.roughnessMap = null;
      m.metal.anisotropy = 0;
      m.metal.clearcoat = opts.powderGloss * opts.powderGloss * 0.8;
      m.metal.clearcoatRoughness = 0.06;
      m.metal.iridescence = 0;
      return { material: m.metal, wire: false };
    }
    if (coat === 'candy') {
      // The finish underneath, behind a glossy coloured coat.
      m.metal.color.set(surface.color);
      m.metal.clearcoat = 1;
      m.metal.clearcoatRoughness = 0.03;
      m.metal.iridescence = 0;
      return { material: m.metal, wire: false };
    }
    if (coat === 'iridescent') {
      m.beetleFace.value.set(colors.beetleFace);
      m.beetleEdge.value.set(colors.beetleEdge);
      return { material: m.beetle, wire: false };
    }
    m.metal.color.set(coat === 'pvd' ? colors.pvd : coat === 'heat' ? 0xc4b08c : surface.color);
    if (coat === 'pvd') {
      // A thin film over the colour gives the coating its slight variation.
      m.metal.iridescence = opts.pvdAmount;
      m.metal.iridescenceIOR = 1.3;
      m.metal.iridescenceThicknessRange = [100, 400];
    } else if (coat === 'heat') {
      // Oxide film ~20-130 nm (IOR ~ 2.3): straw, bronze, purple, blue.
      m.metal.iridescence = 1;
      m.metal.iridescenceIOR = 2.3;
      m.metal.iridescenceThicknessRange = [25, 45 + 110 * opts.heatRange];
    } else {
      // Bare finishes switch the film on only so the weld's oxide film can be
      // drawn; away from the weld the shader sets it back to nothing.
      m.metal.iridescence = m.tig.tigOn.value > 0.5 ? 1 : 0;
      m.metal.iridescenceIOR = 1.3;
      m.metal.iridescenceThicknessRange = [100, 400];
    }
    return { material: m.metal, wire: false };
  }
  switch (look) {
    case 'mesh':
      m.clay.color.set(0x24272c);
      return { material: m.clay, wire: true };
    default:
      m.clay.color.set(0xb9bcc2);
      m.overlay.uniforms.mode.value = { zebra: 0, height: 1, crease: 2, contact: 3 }[look as 'zebra'];
      return { material: m.overlay, wire: false };
  }
}
