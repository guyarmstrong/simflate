// Pressed (embossed) sheet patterns, like the Steel Color / Rimex / Rigidized
// catalogues: purely visual, a height field drawn on the flat sheet in real
// millimetres, so it stretches with the metal as it inflates. One recipe for
// the viewer, the KeyShot bake and the palette balls (`PATTERN_GLSL`).

export type PatternId = 'linen' | 'dots' | 'chequer' | 'dune' | 'wl6' | 'drops' | 'rain' | 'pearl';

export interface PatternInfo {
  id: PatternId;
  name: string;
  /** Catalogue names it stands for. */
  title: string;
  /** Repeat size the pattern starts at, mm. */
  size: number;
}

/** In shader order: `patId` is the index here + 1 (0 = no pattern). */
export const PATTERNS: PatternInfo[] = [
  { id: 'linen', name: 'Linen', title: 'Linen — a fine woven texture (Lino)', size: 1.6 },
  { id: 'dots', name: 'Dots', title: 'Dots — small raised dots in a grid', size: 2.5 },
  { id: 'chequer', name: 'Chequer', title: 'Chequer — alternate raised squares (Quadro, Dama)', size: 5 },
  { id: 'dune', name: 'Dune / 5WL', title: 'Dune / 5WL — rows of long lenses (Duna, Rete, 5WL)', size: 9 },
  { id: 'wl6', name: '6WL', title: '6WL — faceted diamonds', size: 12 },
  { id: 'drops', name: 'Drops', title: 'Drops — rounded oval bumps, spaced apart (Goccia)', size: 9 },
  { id: 'rain', name: 'Rain', title: 'Rain — narrow raised teardrops in rows (Pioggia)', size: 8 },
  { id: 'pearl', name: 'Pearl', title: 'Pearl — plump rounded diamonds, touching (Perla, weave)', size: 8 },
];

export const patternIndex = (id: PatternId | null | undefined) => (id ? PATTERNS.findIndex((p) => p.id === id) + 1 : 0);

/** Height of the pattern's raised parts in mm at Depth 100 %: a share of the
 *  repeat, so fine and coarse patterns look equally pressed. */
export const patternDepthMm = (size: number, depth: number) => Math.max(0, depth) * 0.12 * size;

/** GLSL for powder-coat textures, self-contained: `powHeight(flatMm, kind)`,
 *  0-1, kind 1 = fine texture (sandy, ~0.3 mm), 2 = hammertone (beaten
 *  dimples, ~5 mm). Uniforms `powTex` (0 smooth, 1, 2). */
export const POWDER_GLSL = /* glsl */ `
uniform float powTex;
float powHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float powNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(powHash(i), powHash(i + vec2(1.0, 0.0)), f.x), mix(powHash(i + vec2(0.0, 1.0)), powHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float powHeight(vec2 p, float kind) {
  if (kind < 1.5) return 0.6 * powNoise(p / 0.35) + 0.4 * powNoise(p / 0.15);
  // Hammertone: a dimple round a random point in each ~5 mm cell.
  vec2 q = p / 5.0;
  vec2 c = floor(q);
  float d = 9.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 o = c + vec2(float(x), float(y));
      vec2 pt = o + vec2(powHash(o), powHash(o + 17.3));
      d = min(d, length(q - pt));
    }
  return smoothstep(0.0, 0.6, d);
}
`;

/** GLSL: `float patHeight(vec2 flatMm)`, 0 (hollow) … 1 (raised top). Needs
 *  the uniforms `patId`, `patSize` (mm), `patAngle` (radians). */
export const PATTERN_GLSL = /* glsl */ `
uniform int patId;
uniform float patSize;
uniform float patDepth;
uniform float patAngle;
uniform float patTops;   // 0 off, 1 polished tops, 2 inverted (polished hollows)
uniform float patNeg;    // 1: pressed in instead of raised
uniform float patLevel;  // two-tone line: height (0-1) where the colour meets the polish
// A smooth dome: 1 in the middle (e = 0), 0 at its rim (e = 1) and beyond.
float patBump(float e) {
  float t = clamp(1.0 - e, 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
// Brick-staggered cells, each rowH tall: the point's offset from its cell's
// middle, in cell widths (x) and cell heights (y).
vec2 patStagger(vec2 q, float rowH) {
  float row = floor(q.y / rowH);
  q.x += 0.5 * mod(row, 2.0);
  return vec2(fract(q.x) - 0.5, fract(q.y / rowH) - 0.5);
}
float patCell(int id, vec2 q) {
  if (id == 1) {
    // Linen: a basket weave — threads alternately across and along.
    vec2 f = fract(q);
    float k = mod(floor(q.x) + floor(q.y), 2.0);
    float a = sin(3.14159 * f.y);
    float b = sin(3.14159 * f.x);
    return mix(a, b, k) * 0.8 + 0.2 * a * b;
  } else if (id == 2) {
    // Dots.
    return patBump(length(fract(q) - 0.5) / 0.3);
  } else if (id == 3) {
    // Chequer: each square one Size across, edges rounded.
    float s = sin(3.14159265 * q.x) * sin(3.14159265 * q.y);
    return 0.5 + 0.5 * clamp(s * 3.0, -1.0, 1.0);
  } else if (id == 4) {
    // Dune / 5WL: long lenses, rows staggered, meeting in narrow valleys.
    vec2 l = patStagger(q, 0.5);
    float e = pow(pow(abs(l.x) / 0.5, 1.6) + pow(abs(l.y) / 0.5, 1.6), 1.0 / 1.6);
    return patBump(e);
  } else if (id == 5) {
    // 6WL: faceted diamonds (flat sides), staggered.
    vec2 l = patStagger(q, 0.6);
    float e = (abs(l.x) + abs(l.y)) / 0.5;
    return clamp(1.0 - e, 0.0, 1.0);
  } else if (id == 6) {
    // Drops: oval bumps with flat sheet between.
    vec2 l = patStagger(q, 0.75);
    return patBump(length(vec2(l.x / 0.32, l.y / 0.42)));
  } else if (id == 7) {
    // Rain: narrow teardrops in staggered rows.
    vec2 l = patStagger(q, 0.5);
    float drop = l.y + 0.12;
    return patBump(length(vec2(l.x / 0.46, drop / (drop > 0.0 ? 0.42 : 0.3))));
  } else if (id == 8) {
    // Pearl: plump rounded diamonds, nearly touching.
    vec2 l = patStagger(q, 0.6);
    float e = pow(pow(abs(l.x) / 0.5, 1.3) + pow(abs(l.y) / 0.5, 1.3), 1.0 / 1.3);
    return patBump(e * 1.05);
  }
  return 0.0;
}
float patHeight(vec2 p) {
  float c = cos(patAngle), s = sin(patAngle);
  float h = patCell(patId, vec2(c * p.x + s * p.y, -s * p.x + c * p.y) / max(patSize, 0.05));
  // Pressed in: dots become dimples, lenses become hollows.
  return patNeg > 0.5 ? 1.0 - h : h;
}
// Share of polished steel at height h (two-tone): above the line, or with
// Invert below it. The line sits low by default so a whole bump takes the
// other tone, as on the catalogue sheets (at 0.55-0.8 only the tips did).
float patPolish(float h) {
  float top = smoothstep(patLevel - 0.06, patLevel + 0.06, h);
  return patTops > 1.5 ? 1.0 - top : top;
}
`;
