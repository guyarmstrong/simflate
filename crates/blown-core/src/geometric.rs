//! Specified geometric (session 16): the inflated form built directly from
//! the outline, not solved. Instant and predictable; the knobs say what the
//! piece should look like rather than what the steel does.
//!
//! - **Dome**: each sheet rises with distance from the welds. Balloon ↔
//!   Geometric blends a smooth pillow (pressure-loaded membrane, ∇²u = −1)
//!   with the straight distance from the weld, whose creases run in from the
//!   corners along the middle of the shape (the ridges of a geometric piece).
//! - **Draw-in**: the metal that goes up into the dome comes from the edges,
//!   so each edge bows inwards between its corners (corners stay put).
//! - **Tucks**: evenly spaced, smooth rounded valleys along every edge
//!   (session 16, from Guy's photos): count on a 300 mm side and how it
//!   follows side length, width (at full width they run on into one
//!   another), length inwards, depth, corner fade (shallow near the corners,
//!   deep mid-side), and the weld's own lift between tucks.

use glam::DVec3;

use crate::mesh::{SheetMesh, VertexKind};
use crate::outline::{Piece, P2};
use crate::settings::{RoundMode, SimSettings};

/// Side length (mm) the tuck count refers to.
const TUCK_REF_MM: f64 = 300.0;

/// One weld edge between two corners (or a whole loop without corners).
struct Edge {
    len: f64,
    /// A loop without corners: no fade at the ends.
    periodic: bool,
}

/// A weld segment: ends, the edge it belongs to, distance along that edge at `a`.
struct Seg {
    a: P2,
    b: P2,
    edge: usize,
    s0: f64,
}

/// A corner: the line turns by more than 35° at b.
fn turn(a: P2, b: P2, c: P2) -> bool {
    let (u, v) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
    let l = (u[0].hypot(u[1]) * v[0].hypot(v[1])).max(1e-12);
    (u[0] * v[0] + u[1] * v[1]) / l < 35f64.to_radians().cos()
}

/// Round outline: no closed weld line (outlines and cut-outs) has a corner —
/// circles, ellipses, pills (round mode's Auto; `isRoundOutline` in the UI).
pub fn is_round(pieces: &[Piece]) -> bool {
    !pieces.is_empty()
        && pieces.iter().flat_map(|p| std::iter::once(&p.outer).chain(p.holes.iter())).all(|pts| {
            let n = pts.len();
            n >= 3 && (0..n).all(|i| !turn(pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]))
        })
}

/// Split every weld line at its corners (turns over 35°) into edges. Round
/// mode: closed lines have no corners, each is one loop.
fn weld_edges(pieces: &[Piece], round: bool) -> (Vec<Edge>, Vec<Seg>) {
    let mut edges = Vec::new();
    let mut segs = Vec::new();
    let lines = pieces.iter().flat_map(|p| std::iter::once((&p.outer, true)).chain(p.holes.iter().map(|h| (h, true))).chain(p.seams.iter().map(|s| (s, false))));
    for (pts, closed) in lines {
        let n = pts.len();
        if n < 2 {
            continue;
        }
        let nseg = if closed { n } else { n - 1 };
        // Corner indices (open lines: both ends).
        let mut corners: Vec<usize> = (0..n).filter(|&i| if closed { !round && turn(pts[(i + n - 1) % n], pts[i], pts[(i + 1) % n]) } else { i > 0 && i + 1 < n && turn(pts[i - 1], pts[i], pts[i + 1]) }).collect();
        let periodic = closed && corners.is_empty();
        if !closed {
            corners.insert(0, 0);
        } else if periodic {
            corners.push(0);
        }
        let start = corners[0];
        let mut edge = edges.len();
        edges.push(Edge { len: 0.0, periodic });
        let mut s = 0.0;
        for k in 0..nseg {
            let i = (start + k) % n;
            if k > 0 && corners.contains(&i) {
                edges[edge].len = s;
                edge = edges.len();
                edges.push(Edge { len: 0.0, periodic: false });
                s = 0.0;
            }
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            segs.push(Seg { a, b, edge, s0: s });
            s += (b[0] - a[0]).hypot(b[1] - a[1]);
        }
        edges[edge].len = s;
    }
    (edges, segs)
}

/// Nearest weld point: (distance, edge, distance along it, nearest point).
fn nearest(p: P2, segs: &[Seg]) -> (f64, usize, f64, P2) {
    let mut best = (f64::MAX, 0, 0.0, p);
    for sg in segs {
        let (dx, dy) = (sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 { (((p[0] - sg.a[0]) * dx + (p[1] - sg.a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
        let q = [sg.a[0] + t * dx, sg.a[1] + t * dy];
        let d = (p[0] - q[0]).hypot(p[1] - q[1]);
        if d < best.0 {
            best = (d, sg.edge, sg.s0 + t * l2.sqrt(), q);
        }
    }
    best
}

/// Height profile over u ∈ [0, 1] (0 at the weld, 1 at the top): steep at the
/// weld, flat on top.
fn profile(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    1.0 - (1.0 - u) * (1.0 - u)
}

/// The strongest tuck at a point on an edge.
struct Here {
    /// Strength 0–1 (times its corner envelope and depth variation).
    tuck: f64,
    /// Its width (mm).
    wmm: f64,
    /// Draw-in window along the edge (0 at corners).
    win: f64,
    /// Length variation (× the tuck length).
    len: f64,
}

/// A repeatable random number in [0, 1) for tuck `j` of edge `e`.
fn rand01(seed: u64, e: u64, j: u64, n: u64) -> f64 {
    let mut z = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ e.wrapping_mul(0xBF58_476D_1CE4_E5B9) ^ j.wrapping_mul(0x94D0_49BB_1331_11EB) ^ n.wrapping_add(0x2545_F491_4F6C_DD1D);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
}

/// Smooth minimum of a and b, rounded over a band k wide.
fn smooth_min(a: f64, b: f64, k: f64) -> f64 {
    let h = (0.5 + 0.5 * (b - a) / k).clamp(0.0, 1.0);
    b + h * (a - b) - k * h * (1.0 - h)
}

fn smooth_max(a: f64, b: f64, k: f64) -> f64 {
    -smooth_min(-a, -b, k)
}

/// The finished form, in mm (x, y as drawn), one point per mesh point.
pub fn build(pieces: &[Piece], mesh: &SheetMesh, settings: &SimSettings) -> Vec<DVec3> {
    let n = mesh.flat.len();
    let round = match settings.round_mode {
        RoundMode::Round => true,
        RoundMode::Corners => false,
        RoundMode::Auto => is_round(pieces),
    };
    let (edges, segs) = weld_edges(pieces, round);
    if segs.is_empty() {
        return mesh.flat.iter().map(|p| DVec3::new(p[0], p[1], 0.0)).collect();
    }
    let near: Vec<(f64, usize, f64, P2)> = mesh.flat.iter().map(|&p| if segs.is_empty() { (0.0, 0, 0.0, p) } else { nearest(p, &segs) }).collect();
    let weld = |i: usize| mesh.kind[i] == VertexKind::Weld;
    let dmax = near.iter().map(|x| x.0).fold(1e-9, f64::max);

    // Neighbours (each sheet on its own; they meet only at the weld, which is fixed).
    let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
    for t in &mesh.tris {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            if !nbrs[a as usize].contains(&b) {
                nbrs[a as usize].push(b);
            }
            if !nbrs[b as usize].contains(&a) {
                nbrs[b as usize].push(a);
            }
        }
    }
    // Smooth pillow: ∇²u = −1, u = 0 on the weld (Gauss–Seidel with over-relaxation).
    let h2 = mesh.spacing * mesh.spacing;
    let mut soft: Vec<f64> = near.iter().map(|x| x.0).collect();
    for i in 0..n {
        if weld(i) {
            soft[i] = 0.0;
        }
    }
    let sweeps = (4.0 * dmax / mesh.spacing.max(1e-9)).clamp(50.0, 2000.0) as usize;
    for _ in 0..sweeps {
        for i in 0..n {
            if weld(i) || nbrs[i].is_empty() {
                continue;
            }
            let k = nbrs[i].len() as f64;
            let avg = nbrs[i].iter().map(|&j| soft[j as usize]).sum::<f64>() / k;
            // Each neighbour ~one spacing away: u = avg + h²/(4)·(lattice factor).
            let target = avg + h2 / k;
            soft[i] += 1.8 * (target - soft[i]);
        }
    }
    let smax = soft.iter().cloned().fold(1e-12, f64::max);
    let ridged = settings.character.clamp(0.0, 1.0);
    let u: Vec<f64> = (0..n).map(|i| (1.0 - ridged) * soft[i] / smax + ridged * near[i].0 / dmax).collect();

    // Height: the target, or from the pressure slider (a full pillow rises
    // about 0.7 × its largest inscribed radius).
    let height = settings.target_height_mm.unwrap_or(0.7 * dmax * (settings.pressure / 100.0).clamp(0.0, 1.0));
    let half = height / 2.0;
    let wall = settings.side_wall.clamp(0.0, 1.0);

    // Metal taken up by the dome across its deepest section, per side.
    let steps = 200;
    let mut arc = 0.0;
    for k in 0..steps {
        let (t0, t1) = (k as f64 / steps as f64, (k + 1) as f64 / steps as f64);
        let dz = half * (profile(t1) - profile(t0));
        arc += (dz * dz + (dmax / steps as f64).powi(2)).sqrt();
    }
    let excess = (arc - dmax).max(0.0);
    let draw_in = 0.75 * excess * settings.edge_pull.clamp(0.0, 3.0);

    // Tucks per edge: the count on a 300 mm side, more or fewer on other
    // sides as `tuck_scaling` says (0 = the same on every side, 1 = in
    // proportion to length, below 0 = shorter sides get more).
    // Round mode: the count is round the longest loop (the outline), other
    // loops and weld lines in proportion to their length.
    let base = settings.waves_per_edge as f64;
    let loop_ref = edges.iter().filter(|e| e.periodic).map(|e| e.len).fold(0.0, f64::max);
    let count = |len: f64| {
        if base <= 0.0 || len <= 0.0 {
            0
        } else if round && loop_ref > 0.0 {
            (base * len / loop_ref).round().max(1.0) as u32
        } else {
            (base * (len / TUCK_REF_MM).powf(settings.tuck_scaling.clamp(-1.0, 1.0))).round().max(1.0) as u32
        }
    };
    // Tuck width / length / valley depth in mm (session 17). Older forms
    // carry shares instead (width of the spacing, length × width, depth
    // 0–1) and are built exactly as before until the panel converts them.
    let width_mm = settings.tuck_width_mm.map(|w| w.max(0.5));
    let length_mm = settings.tuck_length_mm.map(|l| l.max(0.5));
    let depth_mm = settings.valley_depth_mm.map(|d| d.max(0.0));
    let depth = settings.wave_depth.clamp(0.0, 1.0);
    let width = settings.tuck_width.clamp(0.05, 1.0);
    let length = settings.tuck_length.clamp(0.2, 4.0);
    // Randomness: each tuck shifted along the edge and its width, length
    // and depth varied, from the seed (same seed, same tucks).
    let random = settings.tuck_randomness.clamp(0.0, 1.0);
    let taper = settings.tuck_taper.clamp(0.0, 1.0);
    let seed = settings.seed;
    let fade = settings.corner_fade.clamp(0.0, 1.0);
    // Tuck shape across the valley, r = 0 at its centre … 1 at its side:
    // Balloon (0) a rounded valley (cos²); Geometric (1) thick material — a
    // V: straight walls down to a rounded bottom, a rounded shoulder where
    // they meet the form (a flat floor gave every valley a bottom, so a
    // wide shallow tuck was a trough — Guy, session 17).
    let shape = settings.tuck_shape.clamp(0.0, 1.0);
    let cross = |r: f64| -> f64 {
        let round = (std::f64::consts::FRAC_PI_2 * r).cos().powi(2);
        if shape <= 0.0 {
            return round;
        }
        // Bottom rounded over 18 % of the half-width, shoulder over ±0.15;
        // the result put back on 0…1.
        let a = 0.18;
        let rv = ((r * r + a * a).sqrt() - a) / ((1.0 + a * a).sqrt() - a);
        let k = 0.15;
        let geo = (smooth_max(1.0 - rv, 0.0, k) - 0.25 * k) / (1.0 - 0.25 * k);
        round + shape * (geo.clamp(0.0, 1.0) - round)
    };
    // Per edge position: the strongest tuck there.
    let along = |e: usize, s: f64| -> Here {
        let ed = &edges[e];
        let x = if ed.len > 0.0 { (s / ed.len).clamp(0.0, 1.0) } else { 0.0 };
        // Corners are stiff: no draw-in for `stiff` mm from each corner
        // (longer for thicker sheet and longer sides: ~40 mm at 1 mm on a
        // 450 mm side), then the arc starts smoothly — high pull-in used to
        // bend the side right from the corner (Guy, session 17).
        let stiff = (2.0 * (settings.thickness_mm.max(0.01) * ed.len).sqrt()).min(0.3 * ed.len);
        let xs = ((s - stiff) / (ed.len - 2.0 * stiff).max(1e-9)).clamp(0.0, 1.0);
        let win = if ed.periodic { 1.0 } else { (std::f64::consts::PI * xs).sin().max(0.0) };
        let k = count(ed.len);
        let gap = if k > 0 { ed.len / k as f64 } else { ed.len };
        let nominal = width_mm.unwrap_or(width * gap);
        let mut here = Here { tuck: 0.0, wmm: nominal, win, len: 1.0 };
        if k > 0 && ed.len > 0.0 {
            // Each tuck: a smooth valley (`cross` across), `nominal` mm
            // wide — as wide as the gap, they run on into one another.
            // Deeper away from the corners: envelope sin(π·x)^(3·fade).
            for j in 0..k {
                let r = |n: u64| if random > 0.0 { 2.0 * rand01(seed, e as u64, j as u64, n) - 1.0 } else { 0.0 };
                let c = (j as f64 + 0.5 + 0.4 * random * r(0)) / k as f64;
                let w_mm = nominal * (1.0 + 0.5 * random * r(1));
                let half_w = 0.5 * w_mm / ed.len;
                let mut dx = (x - c).abs();
                if ed.periodic {
                    dx = dx.min(1.0 - dx);
                }
                if dx < half_w {
                    let env = if ed.periodic { 1.0 } else { (std::f64::consts::PI * c.clamp(0.0, 1.0)).sin().powf(3.0 * fade) };
                    let deep = 1.0 - 0.6 * random * (0.5 + 0.5 * r(2));
                    let v = env * cross(dx / half_w) * deep;
                    if v > here.tuck {
                        here = Here { tuck: v, wmm: w_mm, win, len: 1.0 + 0.6 * random * r(3) };
                    }
                }
            }
        }
        here
    };
    // Edge smoothing: 0 = each tuck pulls the weld in further (a wavy edge);
    // 1 = the edge draws in as a smooth arc, by the edge's average tuck, so
    // the same metal goes in and the tucks stay in the surface only.
    let smooth = settings.edge_smooth.clamp(0.0, 1.0);
    // Balloon tucks flow into one another: the tuck pattern along each edge
    // is blurred over about a third of a tuck's width before it shapes the
    // weld and the valleys (each tuck on its own, cos² then flat, notched
    // the weld with ~5 mm fillets — Guy, session 17). The blur shrinks to
    // nothing towards Geometric; peaks are kept at their full depth.
    let soft: Vec<Vec<f64>> = (0..edges.len())
        .map(|e| {
            let ed = &edges[e];
            let m = ((ed.len / 0.5).ceil() as usize).clamp(256, 16384);
            let ds = ed.len / m as f64;
            let raw: Vec<f64> = (0..m).map(|k| along(e, (k as f64 + 0.5) * ds).tuck).collect();
            let sigma = 0.35 * (1.0 - shape) * along(e, 0.5 * ed.len).wmm;
            let h = (sigma / ds).round() as usize;
            if h == 0 {
                return raw;
            }
            // Three box passes ≈ a Gaussian; loops wrap, open edges clamp.
            let mut a = raw.clone();
            for _ in 0..3 {
                let mut b = vec![0.0; m];
                let mut sum = 0.0;
                let at = |k: isize| -> f64 { if ed.periodic { a[k.rem_euclid(m as isize) as usize] } else { a[k.clamp(0, m as isize - 1) as usize] } };
                for k in -(h as isize)..=(h as isize) {
                    sum += at(k);
                }
                for k in 0..m {
                    b[k] = sum / (2 * h + 1) as f64;
                    sum += at(k as isize + h as isize + 1) - at(k as isize - h as isize);
                }
                a = b;
            }
            let (pr, pb) = (raw.iter().cloned().fold(0.0, f64::max), a.iter().cloned().fold(0.0, f64::max));
            // The running sum's rounding leaves ~-1e-17 where there are no
            // tucks; taper's power turned that into NaN (pits, session 18).
            let k = if pb > 1e-9 { pr / pb } else { 1.0 };
            a.iter_mut().for_each(|v| *v = (*v * k).clamp(0.0, 1.0));
            a
        })
        .collect();
    let soft_at = |e: usize, s: f64| -> f64 {
        let v = &soft[e];
        let m = v.len();
        let x = (s / edges[e].len.max(1e-9) * m as f64 - 0.5).clamp(0.0, (m - 1) as f64);
        let k = (x.floor() as usize).min(m - 1);
        let f = x - k as f64;
        v[k] * (1.0 - f) + v[(k + 1).min(m - 1)] * f
    };
    let mean_tuck: Vec<f64> = soft.iter().map(|v| v.iter().sum::<f64>() / v.len().max(1) as f64).collect();

    // Round mode fold-over (session 19, the gold balloon's rim; Guy: the
    // fold lies over itself seen from above, an S across the fold — not a
    // fold that wanders sideways). Each fold leans along the edge: its
    // floor slides sideways by A while the ridges either side stay, so past
    // A ≈ width/π one wall turns back over the floor. With Randomness only
    // some folds lie over, by their own amounts, in either direction (Guy).
    // Each A stays within 45 % of the fold's width and of the gap to its
    // nearer neighbour, so two folds leaning together never meet. Between
    // folds A blends smoothly (smoothstep) through the still ridges.
    let sway = if round { settings.fold_over.clamp(0.0, 2.0) } else { 0.0 };
    // Minimum bend radius: no valley floor curves tighter than this.
    let min_bend = if round { settings.min_bend_mm.max(0.0) } else { 0.0 };
    // Each fold's own [centre mm, width mm, length ×, lean mm], the same
    // centre, width and length variation as in `along`. Width and length
    // used to come from whichever tuck was strongest at a point, so with
    // Randomness they jumped where one tuck handed over to the next: cracks
    // along the tucks (session 19). Now they blend from fold to fold.
    let folds: Vec<Vec<[f64; 4]>> = (0..edges.len())
        .map(|e| {
            let ed = &edges[e];
            let k = count(ed.len);
            if (sway <= 0.0 && random <= 0.0) || k == 0 {
                return Vec::new();
            }
            let gap = ed.len / k as f64;
            let nominal = width_mm.unwrap_or(width * gap);
            let v: Vec<[f64; 4]> = (0..k)
                .map(|j| {
                    let u = |n: u64| rand01(seed, e as u64, j as u64, n);
                    let r = |n: u64| if random > 0.0 { 2.0 * u(n) - 1.0 } else { 0.0 };
                    let c = (j as f64 + 0.5 + 0.4 * random * r(0)) / k as f64 * ed.len;
                    let w = nominal * (1.0 + 0.5 * random * r(1));
                    // Randomness: amounts spread 0…1, about 3 in 10 not
                    // over at all at full Randomness, and up to half the
                    // other way.
                    let (amount, dir) = if random > 0.0 { ((1.0 - random) + random * (1.4 * u(4) - 0.4).max(0.0), if u(5) < 0.5 * random { -1.0 } else { 1.0 }) } else { (1.0, 1.0) };
                    [c, w, 1.0 + 0.6 * random * r(3), dir * sway * 0.7 * w * amount]
                })
                .collect();
            let m = v.len();
            let step = |a: f64, b: f64| if ed.periodic { (b - a).rem_euclid(ed.len) } else { (b - a).abs() };
            (0..m)
                .map(|j| {
                    let [c, w, l, a] = v[j];
                    let prev = if m > 1 && (j > 0 || ed.periodic) { step(v[(j + m - 1) % m][0], c) } else { gap };
                    let next = if m > 1 && (j + 1 < m || ed.periodic) { step(c, v[(j + 1) % m][0]) } else { gap };
                    let cap = 0.45 * prev.min(next);
                    [c, w, l, a.clamp(-cap, cap)]
                })
                .collect()
        })
        .collect();
    // (width, length ×, lean) at s, blended between the folds either side.
    let fold_at = |e: usize, s: f64| -> Option<(f64, f64, f64)> {
        let v = &folds[e];
        let m = v.len();
        if m == 0 {
            return None;
        }
        let len = edges[e].len;
        let next = v.iter().position(|f| f[0] > s).unwrap_or(m);
        let shifted = |f: [f64; 4], by: f64| [f[0] + by, f[1], f[2], f[3]];
        let (lo, hi) = if edges[e].periodic {
            (if next == 0 { shifted(v[m - 1], -len) } else { v[next - 1] }, if next == m { shifted(v[0], len) } else { v[next] })
        } else if next == 0 {
            (v[0], v[0])
        } else if next == m {
            (v[m - 1], v[m - 1])
        } else {
            (v[next - 1], v[next])
        };
        let t = ((s - lo[0]) / (hi[0] - lo[0]).max(1e-9)).clamp(0.0, 1.0);
        let t = t * t * (3.0 - 2.0 * t);
        let mix = |k: usize| lo[k] + t * (hi[k] - lo[k]);
        Some((mix(1), mix(2), mix(3)))
    };
    // Curvature of a valley's floor per mm of depth, × (half-width)²: cos²
    // gives π²/2; Geometric's V (bottom rounded over 18 %) is tighter.
    let floor_k = (1.0 - shape) * std::f64::consts::PI.powi(2) / 2.0 + shape / (0.18 * ((1.0f64 + 0.18 * 0.18).sqrt() - 0.18));
    let bend_cap = |w: f64| (0.5 * w).powi(2) / (floor_k * min_bend);

    // Inward direction: away from the nearest weld point; weld points take their neighbours' average.
    let mut inward: Vec<P2> = (0..n)
        .map(|i| {
            let (d, _, _, q) = near[i];
            let p = mesh.flat[i];
            if d > 1e-9 { [(p[0] - q[0]) / d, (p[1] - q[1]) / d] } else { [0.0, 0.0] }
        })
        .collect();
    for i in 0..n {
        if near[i].0 <= 1e-9 {
            let s = nbrs[i].iter().filter(|&&j| near[j as usize].0 > 1e-9).fold([0.0, 0.0], |s, &j| [s[0] + inward[j as usize][0], s[1] + inward[j as usize][1]]);
            let l = s[0].hypot(s[1]);
            inward[i] = if l > 0.0 { [s[0] / l, s[1] / l] } else { [0.0, 0.0] };
        }
    }

    // Exactly the height asked for, set on the dome before the tucks go in.
    let dome = 1.0 / u.iter().map(|&v| profile(v)).fold(1e-9, f64::max);

    // Side wall → pill: the sheet rolled onto a stadium section instead of
    // lifted straight up (a height map squeezed the wall into a thin ring by
    // the weld: stretched triangles, a leaning wall, a hard shoulder). From
    // the weld straight up round a quarter circle onto a gently crowned top;
    // each point goes as far along the section as it was from the weld when
    // flat, so the mesh keeps its spacing up the wall. The weld draws in by
    // the metal the section takes up, so the middle stays put. The crown is
    // spread over the whole top (on the flat part alone it made a cap).
    // Blended with the pillow by the slider.
    use std::f64::consts::FRAC_PI_2;
    let crown = 0.15 * half;
    let hs = (half - crown).min(0.85 * dmax);
    let rho = hs.min((0.85 * dmax - hs).max(0.0) / (FRAC_PI_2 - 1.0)).max(1e-6);
    let straight = hs - rho;
    let s_end = straight + rho * FRAC_PI_2;
    // (in from the weld, up) at distance s along the section.
    let section = |s: f64| -> (f64, f64) {
        if s <= straight {
            (0.0, s)
        } else if s <= s_end {
            let phi = (s - straight) / rho;
            (rho * (1.0 - phi.cos()), straight + rho * phi.sin())
        } else {
            (rho + s - s_end, hs)
        }
    };
    let pill_in = dmax - section(dmax).0;
    let mut lift = vec![0.0f64; n];
    // Height of the dome without its tucks (kept through the blend below).
    let mut base_z = vec![0.0f64; n];
    let mut out: Vec<DVec3> = (0..n)
        .map(|i| {
            let p = mesh.flat[i];
            let (d, e, s, _) = near[i];
            let Here { wmm, win, len, .. } = along(e, s);
            let (wmm, len, fold_lean) = fold_at(e, s).unwrap_or((wmm, len, 0.0));
            let tuck = soft_at(e, s);
            // Valley depth at the tuck's centre (mm), and as a share for the
            // weld's pull (older forms: the share itself).
            let (valley, dr) = match depth_mm {
                Some(mm) => (mm, (mm / (0.35 * wmm.min(dmax)).max(1e-9)).min(1.5)),
                None => (0.35 * depth * wmm.min(dmax), depth),
            };
            // No floor tighter than the minimum bend: shallower valleys.
            let (valley, dr) = if min_bend > 0.0 && valley > bend_cap(wmm) { (bend_cap(wmm), dr * bend_cap(wmm) / valley) } else { (valley, dr) };
            let t = (d / dmax).clamp(0.0, 1.0);
            // The valley runs in from the weld the tuck's length, closing
            // smoothly… but never more than 80 % of the way to the middle.
            let reach = (length_mm.unwrap_or(length * wmm) * len).min(0.8 * dmax).max(1e-9);
            // Geometric tucks end more abruptly: the rounding at the inner
            // end shrinks to 30 % of the tuck's length.
            let g = ((1.0 - d / reach).max(0.0) / (1.0 - 0.7 * shape)).min(1.0);
            let g = g * g * (3.0 - 2.0 * g);
            // The draw-in: the edge's even pull fades out towards the middle;
            // each tuck's extra pull (the wave in the weld) only as far as the
            // tuck reaches (fading over the whole radius it ran up a pill's
            // wall and drew lines across the top).
            let even = draw_in * win * (1.0 + 2.0 * dr * mean_tuck[e]);
            let wave = draw_in * win * 2.0 * dr * (1.0 - smooth) * (tuck - mean_tuck[e]);
            let shift = even * (1.0 - t) * (1.0 - t) + wave * g;
            // In a tuck the sheet starts its rise further from the weld: a
            // valley that opens at the weld and closes towards the top
            // (lowering the height itself made pits in the middle).
            // Capped (a third of the way up at most) so a wide tuck can't
            // flatten the dome (session 16: one tuck per side did, and the
            // height correction then stretched the corners into spikes).
            // Taper: the tuck's two walls converge to a point at its full
            // length and it keeps its depth until near the tip, as on the
            // reference pieces (Guy, session 17); 0 = full width all the way
            // in, fading out shallow. Narrowed by raising the profile to a
            // power that grows along the tuck (width ∝ √(1 − taper·q)).
            let q = (d / reach).min(1.0);
            let (tuck_w, g) = if taper > 0.0 {
                let hold = ((1.0 - q) / 0.3).clamp(0.0, 1.0);
                (tuck.max(0.0).powf(1.0 / (1.0 - taper * q).max(0.02)), g + taper * (hold * hold * (3.0 - 2.0 * hold) - g))
            } else {
                (tuck, g)
            };
            // A tapering tuck narrows (∝ √(1 − taper·q)): the bend limit
            // makes it shallower towards the tip too.
            let valley = if min_bend > 0.0 && taper > 0.0 { valley.min(bend_cap(wmm * (1.0 - taper * q).max(0.02).sqrt())) } else { valley };
            let tau = (valley * tuck_w * g / dmax).min(0.35);
            // Fold-over: along the edge, the floor slides by A, the ridges
            // stay. Across the fold the section becomes (x + A·v, depth·v):
            // past A ≈ width/π the far wall turns back over the floor — an
            // S, still smooth, as the depth keeps changing where the slide
            // doubles back.
            let lean = fold_lean * tuck_w * g;
            let side = DVec3::new(-inward[i][1] * lean, inward[i][0] * lean, 0.0);
            // Edge lift: the weld dips at each tuck and rises between them.
            lift[i] = (1.0 - 2.0 * tuck_w) * g * win;
            let z = half * dome * profile((u[i] - tau).max(0.0));
            let z = match mesh.kind[i] {
                VertexKind::Top => z,
                VertexKind::Bottom => -z,
                VertexKind::Weld => 0.0,
            };
            let sign = match mesh.kind[i] {
                VertexKind::Top => 1.0,
                VertexKind::Bottom => -1.0,
                VertexKind::Weld => 0.0,
            };
            let z0 = sign * half * dome * profile(u[i]);
            base_z[i] = z0;
            let flat = DVec3::new(p[0] + inward[i][0] * shift, p[1] + inward[i][1] * shift, z) + side;
            if wall <= 0.0 {
                return flat;
            }
            base_z[i] = z0 + wall * (sign * (section(d).1 + crown * t * t * (3.0 - 2.0 * t)) - z0);
            // A tuck presses into the surface, square to it: into the wall,
            // and on round the shoulder as far as the tuck reaches.
            let (r_s, z_s) = section(d);
            let (a, b) = (section((d - 0.5).max(0.0)), section(d + 0.5));
            let (tr, tz) = (b.0 - a.0, b.1 - a.1);
            let tl = tr.hypot(tz).max(1e-9);
            let indent = tau * dmax;
            let (r_s, z_s) = (r_s + indent * tz / tl, z_s - indent * tr / tl);
            let z_s = z_s + crown * t * t * (3.0 - 2.0 * t);
            // Corners stay put (win → 0) and the middle stays put (t → 1).
            // The draw-in is already exact, so tucks only make the weld wavy
            // about it (an extra pull all round pinched a waist at the weld),
            // by at most a third of the tuck's width (a tall pill's draw-in
            // made spikes).
            let wavy = (1.0 - smooth) * (tuck - mean_tuck[e]) * (pill_in * win * 2.0 * dr).min(0.33 * wmm);
            let off = r_s - d + pill_in * (win + (1.0 - win) * t) + wavy * g;
            let z_s = match mesh.kind[i] {
                VertexKind::Top => z_s,
                VertexKind::Bottom => -z_s,
                VertexKind::Weld => 0.0,
            };
            let pill = DVec3::new(p[0] + inward[i][0] * off, p[1] + inward[i][1] * off, z_s) + side;
            flat + wall * (pill - flat)
        })
        .collect();
    // Where the nearest side switches (the corner bisectors) each point took
    // its pull-in and tucks from a different side, and neighbours jumped:
    // a zigzag seam that grew with the pull-in (Guy, session 17). Blend the
    // sideways shift and the tucks' depth across a band of a few mesh rings
    // there; the dome itself (and Character's ridges) is left alone.
    let mut band = vec![0u8; n];
    for i in 0..n {
        if near[i].0 > 1e-9 && nbrs[i].iter().any(|&j| near[j as usize].1 != near[i].1 && near[j as usize].0 > 1e-9) {
            band[i] = 1;
        }
    }
    for ring in 1..4u8 {
        for i in 0..n {
            if band[i] == ring {
                for &j in &nbrs[i] {
                    if band[j as usize] == 0 {
                        band[j as usize] = ring + 1;
                    }
                }
            }
        }
    }
    let mut delta: Vec<DVec3> = (0..n).map(|i| DVec3::new(out[i].x - mesh.flat[i][0], out[i].y - mesh.flat[i][1], out[i].z - base_z[i])).collect();
    for _ in 0..12 {
        let prev = delta.clone();
        for i in 0..n {
            if band[i] == 0 || weld(i) || nbrs[i].is_empty() {
                continue;
            }
            let avg = nbrs[i].iter().fold(DVec3::ZERO, |a, &j| a + prev[j as usize]) / nbrs[i].len() as f64;
            // Full blend on the seam, less towards the band's edge.
            let w = 1.0 - (band[i] - 1) as f64 / 4.0;
            delta[i] = prev[i] + w * (avg - prev[i]);
        }
    }
    for i in 0..n {
        if band[i] > 0 && !weld(i) {
            out[i] = DVec3::new(mesh.flat[i][0] + delta[i].x, mesh.flat[i][1] + delta[i].y, base_z[i] + delta[i].z);
        }
    }
    let lift_mm = settings.edge_lift.clamp(0.0, 1.0) * 0.12 * half;
    if lift_mm > 0.0 && base > 0.0 {
        for (q, l) in out.iter_mut().zip(&lift) {
            q.z += lift_mm * l;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::triangulate;
    use crate::shapes;

    #[test]
    fn square_domes_draws_in_and_tucks() {
        let piece = shapes::square(300.0);
        let mesh = SheetMesh::from_flat(&triangulate(&[piece.clone()], 1500.0, 28.0).unwrap());
        let mut st = SimSettings { pressure: 80.0, character: 0.3, waves_per_edge: 1, wave_depth: 0.8, ..SimSettings::default() };
        let p = build(&[piece.clone()], &mesh, &st);
        let (lo, hi) = p.iter().fold((f64::MAX, f64::MIN), |(lo, hi), q| (lo.min(q.z), hi.max(q.z)));
        let height = hi - lo;
        assert!((height - 0.7 * 150.0 * 0.8).abs() < 5.0, "height {height}");
        // Corners stay; edge middles come in.
        let at = |x: f64, y: f64| (0..p.len()).filter(|&i| mesh.kind[i] == VertexKind::Weld).min_by(|&a, &b| {
            let d = |i: usize| (mesh.flat[i][0] - x).hypot(mesh.flat[i][1] - y);
            d(a).total_cmp(&d(b))
        }).unwrap();
        let corner = at(150.0, 150.0);
        assert!((p[corner].x - 150.0).abs() < 1.0 && (p[corner].y - 150.0).abs() < 1.0);
        let mid = at(150.0, 0.0);
        assert!(p[mid].x < 140.0, "edge middle drawn in to {}", p[mid].x);
        // Symmetric: same on every side.
        let mid2 = at(0.0, 150.0);
        assert!((p[mid].x - p[mid2].y).abs() < 0.5);
        // Height target is met exactly.
        st.target_height_mm = Some(90.0);
        let p = build(&[piece], &mesh, &st);
        let (lo, hi) = p.iter().fold((f64::MAX, f64::MIN), |(lo, hi), q| (lo.min(q.z), hi.max(q.z)));
        assert!((hi - lo - 90.0).abs() < 1.0, "height {}", hi - lo);
    }

    /// Round mode (session 19): Auto finds circles but not squares; fold-over
    /// move the surface only inside the folds' reach, stay finite, and a
    /// large minimum bend radius flattens the valleys.
    #[test]
    fn round_mode_fold_over() {
        assert!(is_round(&[shapes::circle(300.0)]));
        assert!(is_round(&[shapes::ellipse(400.0, 250.0)]));
        assert!(!is_round(&[shapes::square(300.0)]));
        let piece = shapes::circle(400.0);
        let mesh = SheetMesh::from_flat(&triangulate(&[piece.clone()], 4000.0, 28.0).unwrap());
        let mut st = SimSettings {
            pressure: 80.0,
            side_wall: 1.0,
            waves_per_edge: 24,
            tuck_width_mm: Some(30.0),
            tuck_length_mm: Some(80.0),
            valley_depth_mm: Some(8.0),
            ..SimSettings::default()
        };
        let straight = build(&[piece.clone()], &mesh, &st);
        st.fold_over = 0.8;
        let s_folds = build(&[piece.clone()], &mesh, &st);
        let mut moved = 0;
        for i in 0..mesh.flat.len() {
            assert!(s_folds[i].is_finite());
            let r = mesh.flat[i][0].hypot(mesh.flat[i][1]);
            if r < 200.0 - 85.0 {
                assert!((s_folds[i] - straight[i]).length() < 1e-6, "fold-over reached point {i} at r {r:.1}");
            } else if (s_folds[i] - straight[i]).length() > 0.5 {
                moved += 1;
            }
        }
        assert!(moved > 50, "fold-over changed only {moved} points");
        // Corners mode: no fold-over at all.
        st.round_mode = RoundMode::Corners;
        let corners = build(&[piece.clone()], &mesh, &st);
        assert!((0..mesh.flat.len()).all(|i| (corners[i] - straight[i]).length() < 1e-6));
        // A 1 m minimum bend: valleys all but gone.
        st.round_mode = RoundMode::Auto;
        st.fold_over = 0.0;
        st.min_bend_mm = 1000.0;
        st.waves_per_edge = 0;
        let plain = build(&[piece.clone()], &mesh, &st);
        st.waves_per_edge = 24;
        let flat = build(&[piece], &mesh, &st);
        let dev = |a: &[DVec3]| (0..a.len()).map(|i| (a[i] - plain[i]).length()).fold(0.0, f64::max);
        assert!(dev(&flat) < 0.25 * dev(&straight), "bend limit left {} vs {}", dev(&flat), dev(&straight));
    }

    /// Tuck taper on Balloon tucks left pits and slots far from any tuck on
    /// Guy's ring (session 18): the blurred tuck pattern dipped a hair below
    /// zero, the taper's power made that NaN, and `min` turned NaN into the
    /// deepest valley. Beyond the tucks' reach taper must change nothing.
    #[test]
    fn taper_leaves_the_middle_alone() {
        let mut piece = shapes::circle(500.0);
        let mut hole = shapes::circle(180.0).outer;
        hole.reverse();
        piece.holes.push(hole);
        let mesh = SheetMesh::from_flat(&triangulate(&[piece.clone()], 6000.0, 28.0).unwrap());
        let mut st = SimSettings {
            pressure: 80.0,
            waves_per_edge: 21,
            tuck_width_mm: Some(8.0),
            tuck_length_mm: Some(60.0),
            valley_depth_mm: Some(11.0),
            ..SimSettings::default()
        };
        let plain = build(&[piece.clone()], &mesh, &st);
        st.tuck_taper = 0.65;
        let tapered = build(&[piece], &mesh, &st);
        for i in 0..mesh.flat.len() {
            let r = mesh.flat[i][0].hypot(mesh.flat[i][1]);
            if r > 90.0 + 65.0 && r < 250.0 - 65.0 {
                assert!(tapered[i].is_finite() && (tapered[i].z - plain[i].z).abs() < 0.05, "point {i} at r {r:.1}: z {} vs {}", tapered[i].z, plain[i].z);
            }
        }
    }
}
