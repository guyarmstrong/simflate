// Egg / body shapes: one or more egg-shaped segments in a row (an egg, a
// peanut, an ant's head-thorax-abdomen), joined smoothly at narrow waists.

import type { Vec2 } from './geometry';

export interface BodySegment {
  /** Length along the body and greatest width (mm). */
  len: number;
  width: number;
  /** Egg-ness, -1…1: 0 is an ellipse; positive makes the left end the fat
   *  one, negative the right end. */
  egg: number;
}

export interface BodyParams {
  segs: BodySegment[];
  /** Width at each join between segments (mm). */
  waist: number;
}

export const BODY_PRESETS: { name: string; params: BodyParams }[] = [
  { name: 'Egg', params: { segs: [{ len: 300, width: 220, egg: 0.45 }], waist: 60 } },
  { name: 'Peanut', params: { segs: [{ len: 200, width: 160, egg: 0.15 }, { len: 200, width: 160, egg: -0.15 }], waist: 100 } },
  {
    name: 'Ant',
    params: {
      segs: [
        { len: 110, width: 95, egg: 0 },
        { len: 150, width: 80, egg: 0.2 },
        { len: 260, width: 170, egg: 0.35 },
      ],
      waist: 36,
    },
  },
];

const SAMPLES = 360;
/** How sharply the segments and waists blend (higher = tighter joins). */
const BLEND = 6;

/** Half-width of one egg segment at u ∈ [-1, 1] along it (unit peak). The
 *  bulge term moves the widest point toward the fat end. */
function eggShape(u: number, egg: number): number {
  if (u <= -1 || u >= 1) return 0;
  return Math.sqrt(1 - u * u) * (1 - 0.35 * egg * u) * Math.exp(-0.25 * egg * egg * u * u);
}

/** Peak of `eggShape` for this egg-ness (so `width` really is the widest). */
function eggPeak(egg: number): number {
  let m = 0;
  for (let i = 0; i <= 200; i++) m = Math.max(m, eggShape(-1 + i / 100, egg));
  return m || 1;
}

export function bodyLength(p: BodyParams): number {
  return p.segs.reduce((a, s) => a + Math.max(1, s.len), 0);
}

/** Closed outline, centred on its own box, Y up. */
export function bodyOutline(p: BodyParams): Vec2[] {
  const segs = p.segs.filter((s) => s.len > 0 && s.width > 0);
  if (!segs.length) return [];
  const total = bodyLength({ ...p, segs });
  const peaks = segs.map((s) => eggPeak(s.egg));
  const starts: number[] = [];
  segs.reduce((x, s) => (starts.push(x), x + s.len), 0);
  const joins = starts.slice(1);
  const halfAt = (x: number) => {
    let sum = 0;
    segs.forEach((s, i) => {
      const u = ((x - starts[i]) / s.len) * 2 - 1;
      const h = (eggShape(u, s.egg) / peaks[i]) * (s.width / 2);
      sum += h ** BLEND;
    });
    // A waist fills each join; it fades out within about one waist width.
    for (const xj of joins) {
      const sigma = Math.max(p.waist, 1) * 0.6;
      const h = (p.waist / 2) * Math.exp(-(((x - xj) / sigma) ** 2));
      sum += h ** BLEND;
    }
    return sum ** (1 / BLEND);
  };
  // Cosine spacing: more points round the two rounded ends.
  const xs: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push(((1 - Math.cos((Math.PI * i) / SAMPLES)) / 2) * total);
  const top: Vec2[] = [];
  const bottom: Vec2[] = [];
  for (const x of xs.slice(1, -1)) {
    const h = halfAt(x);
    top.push([x, h]);
    bottom.push([x, -h]);
  }
  const pts: Vec2[] = [[0, 0], ...bottom, [total, 0], ...top.reverse()];
  return pts.map(([x, y]) => [x - total / 2, y]);
}
