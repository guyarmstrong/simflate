//! Symmetric pieces (the Symmetric solver, session 16). An outline with
//! dihedral symmetry D_n (n mirror lines through a centre, n-fold rotation:
//! triangle 3, square 4, leaf 2, heart 1) is meshed as one wedge between two
//! neighbouring mirror lines and copied 2n times, so the mesh itself is exactly
//! symmetric. The Reference solver then solves the wedge alone with mirror
//! conditions on its cut edges (`Fold`), and every corner and edge of the
//! piece comes out the same.
//!
//! Local frame: the centre at the origin, the first mirror line along +x; the
//! wedge is the angles 0 … π/n (n = 1: the upper half, y ≥ 0).

use std::collections::BTreeMap;
use std::f64::consts::{PI, TAU};

use crate::mesh::{cut_step, triangulate_cut, FlatMesh};
use crate::outline::{centroid, clean, Piece, P2};

/// Largest rotation tested. An outline passing 11 and 12 is taken as round
/// and solved as a quarter (n = 2), so its wave count isn't forced.
pub const MAX_FOLD: usize = 12;

/// Default tolerance for "the same shape": 0.5 % of its size.
pub const TOLERANCE: f64 = 0.005;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Symmetry {
    pub center: P2,
    /// Angle of the first mirror line (radians).
    pub axis: f64,
    /// Number of mirror lines (= rotation order).
    pub n: usize,
}

impl Symmetry {
    pub fn to_local(&self, p: P2) -> P2 {
        let (s, c) = (-self.axis).sin_cos();
        let (x, y) = (p[0] - self.center[0], p[1] - self.center[1]);
        [c * x - s * y, s * x + c * y]
    }

    pub fn from_local(&self, q: P2) -> P2 {
        let (s, c) = self.axis.sin_cos();
        [self.center[0] + c * q[0] - s * q[1], self.center[1] + s * q[0] + c * q[1]]
    }

    /// The wedge's opening angle, π/n.
    pub fn wedge(&self) -> f64 {
        PI / self.n as f64
    }

    /// The 2n symmetry operations: (rotation step k, mirrored first).
    pub fn elements(&self) -> impl Iterator<Item = (usize, bool)> {
        let n = self.n;
        (0..n).flat_map(|k| [(k, false), (k, true)])
    }

    /// Apply an operation in the local frame: mirror in x (if `m`), then
    /// rotate by k · 2π/n.
    pub fn apply_local(&self, k: usize, m: bool, q: P2) -> P2 {
        let q = if m { [q[0], -q[1]] } else { q };
        let (s, c) = (k as f64 * TAU / self.n as f64).sin_cos();
        [c * q[0] - s * q[1], s * q[0] + c * q[1]]
    }

    /// Local point → (its image in the wedge, the operation that maps the image back onto it).
    pub fn to_wedge_local(&self, q: P2) -> (P2, usize, bool) {
        let n = self.n;
        let step = TAU / n as f64;
        let mut a = q[1].atan2(q[0]);
        if a < 0.0 {
            a += TAU;
        }
        let k = ((a / step).floor() as usize).min(n - 1);
        let r = q[0].hypot(q[1]);
        let a1 = a - k as f64 * step;
        if a1 <= step / 2.0 {
            let (s, c) = a1.sin_cos();
            ([r * c, r * s], k, false)
        } else {
            let (s, c) = (step - a1).sin_cos();
            ([r * c, r * s], (k + 1) % n, true)
        }
    }

    /// Mirror lines of the wedge in the local frame, as unit normals (the
    /// wedge lies on the side the normal points to): y ≥ 0, and for n ≥ 2 the
    /// line at π/n.
    pub fn wedge_normals(&self) -> Vec<P2> {
        let mut v = vec![[0.0, 1.0]];
        if self.n >= 2 {
            let (s, c) = self.wedge().sin_cos();
            v.push([s, -c]);
        }
        v
    }
}

fn seg_dist(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}

/// Distance from `p` to the closed polygon's edges.
fn poly_dist(p: P2, poly: &[P2]) -> f64 {
    let n = poly.len();
    (0..n).map(|i| seg_dist(p, poly[i], poly[(i + 1) % n])).fold(f64::MAX, f64::min)
}

/// `count` points evenly spaced along the closed polygon.
fn even_points(poly: &[P2], count: usize) -> Vec<P2> {
    let n = poly.len();
    let len: Vec<f64> = (0..n).map(|i| (poly[(i + 1) % n][0] - poly[i][0]).hypot(poly[(i + 1) % n][1] - poly[i][1])).collect();
    let total: f64 = len.iter().sum();
    let mut out = Vec::with_capacity(count);
    let (mut seg, mut start) = (0, 0.0);
    for k in 0..count {
        let s = total * k as f64 / count as f64;
        while seg + 1 < n && start + len[seg] < s {
            start += len[seg];
            seg += 1;
        }
        let t = if len[seg] > 0.0 { ((s - start) / len[seg]).clamp(0.0, 1.0) } else { 0.0 };
        let (a, b) = (poly[seg], poly[(seg + 1) % n]);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    out
}

/// Does `f` map every sample onto the polygon (within `tol`)?
fn maps_onto(samples: &[P2], poly: &[P2], tol: f64, f: &dyn Fn(P2) -> P2) -> bool {
    samples.iter().all(|&p| poly_dist(f(p), poly) <= tol)
}

/// Worst distance of the mapped samples from the polygon.
fn misfit(samples: &[P2], poly: &[P2], f: &dyn Fn(P2) -> P2) -> f64 {
    samples.iter().map(|&p| poly_dist(f(p), poly)).fold(0.0, f64::max)
}

fn rotate_about(c: P2, ang: f64) -> impl Fn(P2) -> P2 {
    let (s, co) = ang.sin_cos();
    move |p: P2| {
        let (x, y) = (p[0] - c[0], p[1] - c[1]);
        [c[0] + co * x - s * y, c[1] + s * x + co * y]
    }
}

fn mirror_about(c: P2, ang: f64) -> impl Fn(P2) -> P2 {
    let (s, co) = (2.0 * ang).sin_cos();
    move |p: P2| {
        let (x, y) = (p[0] - c[0], p[1] - c[1]);
        [c[0] + co * x + s * y, c[1] + s * x - co * y]
    }
}

/// Find the outline's mirror symmetry. `tol` = largest mismatch allowed, as a
/// fraction of the outline's size. Errors say in plain words what's missing.
pub fn detect(outline: &[P2], tol: f64) -> Result<Symmetry, String> {
    let size = {
        let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for p in outline {
            (x0, x1, y0, y1) = (x0.min(p[0]), x1.max(p[0]), y0.min(p[1]), y1.max(p[1]));
        }
        (x1 - x0).max(y1 - y0)
    };
    let poly = clean(outline, true, size * 1e-9);
    if poly.len() < 3 || !(size > 0.0) {
        return Err("The outline has no area.".into());
    }
    let tol = tol * size;
    let c = centroid(&poly);
    let mut samples = even_points(&poly, 256);
    samples.extend_from_slice(&poly);
    let passes = |n: usize| maps_onto(&samples, &poly, tol, &rotate_about(c, TAU / n as f64));
    let mut n = (2..=MAX_FOLD).rev().find(|&n| passes(n)).unwrap_or(1);
    if n >= MAX_FOLD - 1 && passes(MAX_FOLD - 1) && passes(MAX_FOLD) {
        n = 2; // round
    }
    // Mirror line: sweep the angle coarsely on few points, refine, then check properly.
    // (The real outline when it's small: corners cut by resampling shift the best angle.)
    let coarse_poly = if poly.len() <= 512 { poly.clone() } else { even_points(&poly, 512) };
    let coarse = even_points(&poly, 64);
    let period = PI / n as f64;
    let steps = 1440;
    let mut scored: Vec<(f64, f64)> = (0..steps)
        .map(|i| {
            let a = period * i as f64 / steps as f64;
            (misfit(&coarse, &coarse_poly, &mirror_about(c, a)), a)
        })
        .collect();
    scored.sort_by(|x, y| x.0.total_cmp(&y.0));
    let step = period / steps as f64;
    let fine = even_points(&poly, 256);
    let mut tried: Vec<f64> = Vec::new();
    for &(_, a0) in scored.iter().take(40) {
        if tried.iter().any(|&t| ((t - a0 + period / 2.0).rem_euclid(period) - period / 2.0).abs() < 3.0 * step) {
            continue;
        }
        tried.push(a0);
        if tried.len() > 4 {
            break;
        }
        // Golden-section refine within a few coarse steps.
        let (mut lo, mut hi) = (a0 - 3.0 * step, a0 + 3.0 * step);
        let g = (5f64.sqrt() - 1.0) / 2.0;
        let f = |a: f64| misfit(&fine, &poly, &mirror_about(c, a));
        let (mut x1, mut x2) = (hi - g * (hi - lo), lo + g * (hi - lo));
        let (mut f1, mut f2) = (f(x1), f(x2));
        for _ in 0..60 {
            if f1 < f2 {
                hi = x2;
                (x2, f2) = (x1, f1);
                x1 = hi - g * (hi - lo);
                f1 = f(x1);
            } else {
                lo = x1;
                (x1, f1) = (x2, f2);
                x2 = lo + g * (hi - lo);
                f2 = f(x2);
            }
        }
        let a = (lo + hi) / 2.0;
        if maps_onto(&samples, &poly, tol, &mirror_about(c, a)) {
            return Ok(Symmetry { center: c, axis: a.rem_euclid(period), n });
        }
    }
    if n >= 2 {
        Err(format!("The outline repeats {n} times round its centre but has no mirror line — Symmetric needs a mirror-symmetric shape."))
    } else {
        Err("The outline isn't symmetric (no mirror line found within 0.5 % of its size).".into())
    }
}

/// Clip a closed polygon to the half-plane nrm · p ≥ 0 (a line through the origin).
fn clip(poly: &[P2], nrm: P2, eps: f64) -> Vec<P2> {
    let f = |p: P2| {
        let v = nrm[0] * p[0] + nrm[1] * p[1];
        if v.abs() < eps { 0.0 } else { v }
    };
    // Put a point exactly on the line.
    let onto = |p: P2| {
        let d = nrm[0] * p[0] + nrm[1] * p[1];
        [p[0] - d * nrm[0], p[1] - d * nrm[1]]
    };
    let n = poly.len();
    let mut out = Vec::with_capacity(n + 4);
    for i in 0..n {
        let (a, b) = (poly[i], poly[(i + 1) % n]);
        let (fa, fb) = (f(a), f(b));
        if fa >= 0.0 {
            out.push(if fa == 0.0 { onto(a) } else { a });
        }
        if (fa > 0.0 && fb < 0.0) || (fa < 0.0 && fb > 0.0) {
            let t = fa / (fa - fb);
            out.push(onto([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
        }
    }
    out
}

/// The wedge's outline in the local frame, or why it can't be made.
pub fn wedge_outline(outline: &[P2], sym: &Symmetry) -> Result<Vec<P2>, String> {
    let local: Vec<P2> = outline.iter().map(|&p| sym.to_local(p)).collect();
    let size = local.iter().map(|p| p[0].hypot(p[1])).fold(0.0, f64::max);
    // Points this close to a mirror line (a tip drawn a hair off the axis)
    // go onto it, so no sliver is left beside the cut.
    let eps = size * 1e-3;
    let mut w = local;
    for nrm in sym.wedge_normals() {
        w = clip(&w, nrm, eps);
    }
    let w = clean(&w, true, eps);
    // Each cut line must cross the outline once (twice counting the centre):
    // otherwise the wedge falls apart into pieces.
    for nrm in sym.wedge_normals() {
        let on = w.iter().filter(|p| (nrm[0] * p[0] + nrm[1] * p[1]).abs() <= size * 1e-7).count();
        if on != 2 {
            return Err("This outline folds back on itself across a mirror line — Symmetric can't split it into equal slices.".into());
        }
    }
    if w.len() < 3 {
        return Err("The symmetric slice came out empty.".into());
    }
    Ok(w)
}

/// Does the whole piece (outline, cut-outs, weld lines) map onto itself under
/// `sym`'s rotation and mirror? Checked on every drawn point and segment middle.
fn fits(sym: &Symmetry, piece: &Piece, tol: f64) -> bool {
    let mut segs: Vec<(P2, P2)> = Vec::new();
    for l in std::iter::once(&piece.outer).chain(&piece.holes) {
        segs.extend((0..l.len()).map(|i| (l[i], l[(i + 1) % l.len()])));
    }
    for l in &piece.seams {
        segs.extend(l.windows(2).map(|w| (w[0], w[1])));
    }
    let samples: Vec<P2> = segs.iter().flat_map(|&(a, b)| [a, [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]]).collect();
    let on = |p: P2| segs.iter().any(|&(a, b)| seg_dist(p, a, b) <= tol);
    let rot = |p: P2| sym.from_local(sym.apply_local(1 % sym.n, false, sym.to_local(p)));
    let mir = |p: P2| sym.from_local(sym.apply_local(0, true, sym.to_local(p)));
    samples.iter().all(|&p| on(rot(p)) && on(mir(p)))
}

/// The largest symmetry of the outline that the cut-outs and weld lines share
/// too: the outline's own, or a smaller one (fewer mirror lines).
fn piece_symmetry(piece: &Piece) -> Result<Symmetry, String> {
    let sym = detect(&piece.outer, TOLERANCE)?;
    if piece.holes.is_empty() && piece.seams.is_empty() {
        return Ok(sym);
    }
    let size = piece.outer.iter().map(|p| (p[0] - sym.center[0]).hypot(p[1] - sym.center[1])).fold(0.0, f64::max);
    let tol = TOLERANCE * size;
    for n in (1..=sym.n).rev().filter(|n| sym.n % n == 0) {
        for j in 0..sym.n {
            let cand = Symmetry { center: sym.center, axis: (sym.axis + j as f64 * PI / sym.n as f64).rem_euclid(PI / n as f64), n };
            if fits(&cand, piece, tol) {
                return Ok(cand);
            }
        }
    }
    Err("The weld lines or cut-outs aren't symmetric with the outline — Symmetric needs the whole piece mirror-symmetric.".into())
}

/// The parts of an open polyline on the side nrm · p ≥ 0 (points within
/// `eps` of the line count as on it and are put exactly onto it).
fn clip_polyline(line: &[P2], nrm: P2, eps: f64) -> Vec<Vec<P2>> {
    let f = |p: P2| {
        let v = nrm[0] * p[0] + nrm[1] * p[1];
        if v.abs() < eps { 0.0 } else { v }
    };
    let onto = |p: P2| {
        let d = nrm[0] * p[0] + nrm[1] * p[1];
        [p[0] - d * nrm[0], p[1] - d * nrm[1]]
    };
    let mut out: Vec<Vec<P2>> = Vec::new();
    let mut cur: Vec<P2> = Vec::new();
    for (k, &p) in line.iter().enumerate() {
        let fp = f(p);
        if k > 0 {
            let q = line[k - 1];
            let fq = f(q);
            if (fq > 0.0 && fp < 0.0) || (fq < 0.0 && fp > 0.0) {
                let t = fq / (fq - fp);
                let x = onto([q[0] + (p[0] - q[0]) * t, q[1] + (p[1] - q[1]) * t]);
                cur.push(x);
                if fp < 0.0 {
                    out.push(std::mem::take(&mut cur));
                }
            }
        }
        if fp >= 0.0 {
            cur.push(if fp == 0.0 { onto(p) } else { p });
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    out.push(cur);
    out.into_iter().filter(|l| l.len() >= 2).collect()
}

/// The slice of a whole piece, in the local frame: its outline (a cut-out
/// round the centre becomes part of it), the cut-outs inside the slice, its
/// weld lines, and the stretches of mirror line that are welds.
struct Slice {
    outer: Vec<P2>,
    holes: Vec<Vec<P2>>,
    seams: Vec<Vec<P2>>,
    cut_welds: Vec<(P2, P2)>,
}

fn slice(piece: &Piece, sym: &Symmetry) -> Result<Slice, String> {
    let mut outer = wedge_outline(&piece.outer, sym)?;
    let normals = sym.wedge_normals();
    let size = outer.iter().map(|p| p[0].hypot(p[1])).fold(0.0, f64::max);
    let eps = size * 1e-3;
    let tiny = size * 1e-7;
    let on_line = |n: &P2, p: P2| (n[0] * p[0] + n[1] * p[1]).abs() <= tiny;
    let on_any = |p: P2| normals.iter().any(|n| on_line(n, p));
    let mut holes = Vec::new();
    for h in &piece.holes {
        let local: Vec<P2> = h.iter().map(|&p| sym.to_local(p)).collect();
        let mut w = local.clone();
        for &n in &normals {
            w = clip(&w, n, eps);
        }
        let w = clean(&w, true, eps);
        if w.len() < 3 || Piece::new(w.clone()).area() < size * size * 1e-9 {
            continue; // a copy of a cut-out in another slice
        }
        if !w.iter().any(|&p| on_any(p)) {
            holes.push(w);
            continue;
        }
        if !crate::outline::point_in_polygon([0.0, 0.0], &local) {
            return Err("A cut-out crosses a mirror line away from the centre — Symmetric can't handle that yet.".into());
        }
        // Round the centre: the cut-out's arc replaces the centre point
        // (several mirror lines) or the stretch of mirror line across it (one).
        let centre = |p: &P2| p[0].hypot(p[1]) <= tiny;
        let arc_pts: Vec<P2> = w.iter().filter(|p| !centre(p)).copied().collect();
        let m = arc_pts.len();
        // With the centre point gone, the two ends on mirror lines sit side by side.
        let k = (0..m).find(|&i| on_any(arc_pts[i]) && on_any(arc_pts[(i + 1) % m]));
        let Some(k) = k else { return Err("Couldn't fit the cut-out round the centre into the slice.".into()) };
        // The arc from one end on a mirror line round to the other.
        let mut arc: Vec<P2> = (1..=m).map(|j| arc_pts[(k + j) % m]).collect();
        if sym.n >= 2 {
            let c = outer.iter().position(centre).ok_or("The slice has no centre point.")?;
            let prev = outer[(c + outer.len() - 1) % outer.len()];
            let same_line = |a: P2, b: P2| normals.iter().any(|n| on_line(n, a) && on_line(n, b));
            if !same_line(arc[0], prev) {
                arc.reverse();
            }
            outer.splice(c..=c, arc);
        } else {
            // The edge along the mirror line that passes the centre.
            let n = outer.len();
            let e = (0..n).find(|&i| seg_dist([0.0, 0.0], outer[i], outer[(i + 1) % n]) <= tiny * 10.0).ok_or("The slice's mirror edge doesn't pass the centre.")?;
            let a = outer[e];
            let d = |p: P2| (p[0] - a[0]).hypot(p[1] - a[1]);
            if d(arc[0]) > d(arc[arc.len() - 1]) {
                arc.reverse();
            }
            outer.splice(e + 1..e + 1, arc);
        }
    }
    let mut seams = Vec::new();
    let mut cut_welds = Vec::new();
    for s in &piece.seams {
        let mut parts = vec![s.iter().map(|&p| sym.to_local(p)).collect::<Vec<P2>>()];
        for &n in &normals {
            parts = parts.iter().flat_map(|l| clip_polyline(l, n, eps)).collect();
        }
        for part in parts {
            let len: f64 = part.windows(2).map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1])).sum();
            if len < eps {
                continue;
            }
            if normals.iter().any(|n| part.iter().all(|&p| on_line(n, p))) {
                cut_welds.extend(part.windows(2).map(|w| (w[0], w[1])));
            } else {
                seams.push(part);
            }
        }
    }
    Ok(Slice { outer, holes, seams, cut_welds })
}

/// Mesh one wedge of a symmetric piece and copy it into the whole piece.
/// One outline, with weld lines and cut-outs (round the centre or inside a
/// slice). Returns the mesh (whole piece, in the drawing's coordinates) and
/// the symmetry used.
pub fn mesh_symmetric(pieces: &[Piece], target_vertices: f64, min_angle_deg: f64) -> Result<(FlatMesh, Symmetry), String> {
    let [piece] = pieces else {
        return Err("Symmetric works on one outline at a time.".into());
    };
    let sym = piece_symmetry(piece)?;
    let sl = slice(piece, &sym)?;
    let wedge = sl.outer.clone();
    let copies = 2 * sym.n;
    // Points along the cut lines every mesh spacing from the centre (the
    // mesher holds them, so the row on a mirror line sits on its lattice).
    let target = target_vertices / copies as f64;
    let spacing = (2.0 * (Piece::new(wedge.clone()).area() / target.max(10.0)) / 3f64.sqrt()).sqrt();
    let mut cut_wedge: Vec<P2> = Vec::with_capacity(wedge.len() * 4);
    let nrm = sym.wedge_normals();
    for i in 0..wedge.len() {
        let (a, b) = (wedge[i], wedge[(i + 1) % wedge.len()]);
        cut_wedge.push(a);
        let on = |p: P2| nrm.iter().any(|n| (n[0] * p[0] + n[1] * p[1]).abs() <= spacing * 1e-9);
        if !(on(a) && on(b)) || !nrm.iter().any(|n| (n[0] * a[0] + n[1] * a[1]).abs() <= spacing * 1e-9 && (n[0] * b[0] + n[1] * b[1]).abs() <= spacing * 1e-9) {
            continue;
        }
        let n = *nrm.iter().find(|n| (n[0] * a[0] + n[1] * a[1]).abs() <= spacing * 1e-9 && (n[0] * b[0] + n[1] * b[1]).abs() <= spacing * 1e-9).unwrap();
        let spacing = cut_step(n, spacing);
        // Signed distance along the line from the origin.
        let len = (b[0] - a[0]).hypot(b[1] - a[1]);
        let dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
        let (ra, rb) = (a[0] * dir[0] + a[1] * dir[1], b[0] * dir[0] + b[1] * dir[1]);
        let mut k = (ra / spacing).floor() + 1.0;
        while k * spacing < rb - 0.3 * spacing {
            if k * spacing > ra + 0.3 * spacing {
                cut_wedge.push([dir[0] * k * spacing, dir[1] * k * spacing]);
            }
            k += 1.0;
        }
    }
    let wm = triangulate_cut(&[Piece { outer: cut_wedge, holes: sl.holes.clone(), seams: sl.seams.clone() }], target, min_angle_deg, &nrm, &sl.cut_welds)?;

    // Weld = on the drawn outline only, not on the cut lines (except where they meet it).
    let tol = wm.spacing * 1e-5;
    let normals = sym.wedge_normals();
    let on_cut = |p: P2| normals.iter().any(|n| (n[0] * p[0] + n[1] * p[1]).abs() <= tol);
    let m = wedge.len();
    let on_line = |n: &P2, p: P2| (n[0] * p[0] + n[1] * p[1]).abs() <= tol;
    let outline_edges: Vec<(P2, P2)> = (0..m).map(|i| (wedge[i], wedge[(i + 1) % m])).filter(|&(a, b)| !normals.iter().any(|n| on_line(n, a) && on_line(n, b))).collect();
    let weld: Vec<bool> = wm
        .verts
        .iter()
        .zip(&wm.weld)
        .map(|(&p, &w)| {
            w && (!on_cut(p)
                || outline_edges.iter().chain(&sl.cut_welds).any(|&(a, b)| seg_dist(p, a, b) <= tol)
                || sl.seams.iter().any(|l| l.windows(2).any(|s| seg_dist(p, s[0], s[1]) <= tol))
                || sl.holes.iter().any(|h| (0..h.len()).any(|i| seg_dist(p, h[i], h[(i + 1) % h.len()]) <= tol)))
        })
        .collect();

    // Copy the wedge round, merging the points the copies share on the cut lines.
    let merge = wm.spacing * 1e-6;
    let cell = |p: P2| ((p[0] / merge).floor() as i64, (p[1] / merge).floor() as i64);
    let mut grid: BTreeMap<(i64, i64), Vec<u32>> = BTreeMap::new();
    let mut verts: Vec<P2> = Vec::new();
    let mut vweld: Vec<bool> = Vec::new();
    let mut tris: Vec<[u32; 3]> = Vec::with_capacity(wm.tris.len() * copies);
    for (k, mirrored) in sym.elements() {
        let ids: Vec<u32> = wm
            .verts
            .iter()
            .zip(&weld)
            .map(|(&q, &w)| {
                let p = sym.apply_local(k, mirrored, q);
                let (cx, cy) = cell(p);
                let mut found = None;
                'search: for dx in -1..=1 {
                    for dy in -1..=1 {
                        for &j in grid.get(&(cx + dx, cy + dy)).map(|v| v.as_slice()).unwrap_or(&[]) {
                            let o = verts[j as usize];
                            if (o[0] - p[0]).hypot(o[1] - p[1]) <= merge {
                                found = Some(j);
                                break 'search;
                            }
                        }
                    }
                }
                let id = found.unwrap_or_else(|| {
                    let id = verts.len() as u32;
                    verts.push(p);
                    vweld.push(false);
                    grid.entry((cx, cy)).or_default().push(id);
                    id
                });
                vweld[id as usize] |= w;
                id
            })
            .collect();
        for t in &wm.tris {
            let mut c = t.map(|v| ids[v as usize]);
            if mirrored {
                c.swap(1, 2);
            }
            tris.push(c);
        }
    }
    // Back to the drawing's coordinates.
    let verts = verts.into_iter().map(|q| sym.from_local(q)).collect();
    let mut warnings = wm.warnings;
    warnings.push(format!("Symmetric: {} mirror line{}, mesh copied {copies}×", sym.n, if sym.n == 1 { "" } else { "s" }));
    Ok((FlatMesh { verts, tris, weld: vweld, spacing: wm.spacing, warnings }, sym))
}

/// The outline of a two-sheet mesh: the top sheet's edges used by one
/// triangle, walked in order (counter-clockwise); with cut-outs, the longest
/// loop (the outline).
pub fn outline_ring(indices: &[u32], top_triangles: usize) -> Result<Vec<u32>, String> {
    let broken = || "The mesh outline isn't one closed loop.".to_string();
    let mut count: BTreeMap<(u32, u32), u32> = BTreeMap::new();
    for t in indices.chunks(3).take(top_triangles) {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            *count.entry((a.min(b), a.max(b))).or_default() += 1;
        }
    }
    let mut next: BTreeMap<u32, u32> = BTreeMap::new();
    for t in indices.chunks(3).take(top_triangles) {
        for k in 0..3 {
            let (a, b) = (t[k], t[(k + 1) % 3]);
            if count[&(a.min(b), a.max(b))] == 1 {
                next.insert(a, b);
            }
        }
    }
    // Walk every loop (outline and cut-outs); the outline is the longest.
    let mut seen: std::collections::BTreeSet<u32> = std::collections::BTreeSet::new();
    let mut best: Vec<u32> = Vec::new();
    for &start in next.keys() {
        if seen.contains(&start) {
            continue;
        }
        let mut ring = vec![start];
        seen.insert(start);
        let mut v = next[&start];
        while v != start {
            if !seen.insert(v) {
                return Err(broken());
            }
            ring.push(v);
            v = *next.get(&v).ok_or_else(broken)?;
        }
        if ring.len() > best.len() {
            best = ring;
        }
    }
    if best.is_empty() {
        return Err(broken());
    }
    let ring = best;
    Ok(ring)
}

/// A whole-piece mesh from `mesh_symmetric`, cut back to one wedge for the
/// Reference solver, with the way back: every point of the piece is a wedge
/// point moved by one of the symmetry operations. Arrays are in the
/// Reference job's layout (x, y, z per point; weld 0/1; top triangles first).
#[derive(Clone, Debug)]
pub struct Fold {
    pub sym: Symmetry,
    /// Wedge points in the local frame (centre at the origin, first mirror line along +x).
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub weld: Vec<u8>,
    pub top_triangles: usize,
    /// Per mirror line: its unit normal and the wedge points on it (not the centre).
    pub mirrors: Vec<(P2, Vec<u32>)>,
    /// Wedge points at the centre (on every mirror line; top and bottom sheet).
    pub centre: Vec<u32>,
    /// Whole-piece point each wedge point was taken from.
    pub source: Vec<u32>,
    /// Whole-piece point → (wedge point, rotation step, mirrored).
    map: Vec<(u32, u8, bool)>,
}

impl Fold {
    /// Find the mesh's own symmetry (exactly, from its points) and cut out the wedge.
    pub fn new(positions: &[f32], indices: &[u32], weld: &[u8], top_triangles: usize) -> Result<Fold, String> {
        let not_sym = || "This mesh isn't symmetric — mesh it again with the Symmetric solver.".to_string();
        let n_all = positions.len() / 3;
        let xy = |i: usize| [positions[3 * i] as f64, positions[3 * i + 1] as f64];
        // Sheet of each point: 0 top, 1 bottom, 2 weld (shared).
        let mut sheet = vec![2u8; n_all];
        for (ti, t) in indices.chunks(3).enumerate() {
            for &v in t {
                if weld[v as usize] == 0 {
                    sheet[v as usize] = if ti < top_triangles { 0 } else { 1 };
                }
            }
        }
        let ring = outline_ring(indices, top_triangles)?;
        let outline: Vec<P2> = ring.iter().map(|&i| xy(i as usize)).collect();
        let c = centroid(&outline);
        let m = outline.len();
        let mean_edge = (0..m).map(|i| (outline[(i + 1) % m][0] - outline[i][0]).hypot(outline[(i + 1) % m][1] - outline[i][1])).sum::<f64>() / m as f64;
        let size = outline.iter().map(|p| (p[0] - c[0]).hypot(p[1] - c[1])).fold(0.0, f64::max);
        let tol = (mean_edge * 1e-3).max(size * 2e-6);
        // Exact tests on the points themselves.
        let cell = |p: P2| ((p[0] / tol).floor() as i64, (p[1] / tol).floor() as i64);
        let mut grid: BTreeMap<(i64, i64), Vec<u32>> = BTreeMap::new();
        for i in 0..n_all {
            grid.entry(cell(xy(i))).or_default().push(i as u32);
        }
        let find = |p: P2, sh: u8| -> Option<u32> {
            let (cx, cy) = cell(p);
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &j in grid.get(&(cx + dx, cy + dy)).map(|v| v.as_slice()).unwrap_or(&[]) {
                        let q = xy(j as usize);
                        if sheet[j as usize] == sh && (q[0] - p[0]).hypot(q[1] - p[1]) <= tol {
                            return Some(j);
                        }
                    }
                }
            }
            None
        };
        // The outline first (quick), then every point on its own sheet.
        let maps = |f: &dyn Fn(P2) -> P2| ring.iter().all(|&i| find(f(xy(i as usize)), 2).is_some()) && (0..n_all).all(|i| find(f(xy(i)), sheet[i]).is_some());
        let n = (2..=MAX_FOLD).rev().find(|&n| maps(&rotate_about(c, TAU / n as f64))).unwrap_or(1);
        // A mirror line passes through a weld point (where the slice's cut met the outline).
        let axis = ring
            .iter()
            .map(|&i| {
                let p = xy(i as usize);
                (p[1] - c[1]).atan2(p[0] - c[0])
            })
            .find(|&a| maps(&mirror_about(c, a)))
            .ok_or_else(not_sym)?;
        let sym = Symmetry { center: c, axis: axis.rem_euclid(PI / n as f64), n };

        // The wedge: triangles whose middle lies between the mirror lines.
        let normals = sym.wedge_normals();
        let local: Vec<P2> = (0..n_all).map(|i| sym.to_local(xy(i))).collect();
        let mut new_id = vec![u32::MAX; n_all];
        let mut wpos: Vec<f32> = Vec::new();
        let mut wweld: Vec<u8> = Vec::new();
        let mut source: Vec<u32> = Vec::new();
        let mut windices: Vec<u32> = Vec::new();
        let mut wtop = 0;
        for (ti, t) in indices.chunks(3).enumerate() {
            let mid = t.iter().fold([0.0, 0.0], |s, &k| [s[0] + local[k as usize][0] / 3.0, s[1] + local[k as usize][1] / 3.0]);
            if !normals.iter().all(|nr| nr[0] * mid[0] + nr[1] * mid[1] > 0.0) {
                continue;
            }
            for &v in t {
                if new_id[v as usize] == u32::MAX {
                    new_id[v as usize] = (wpos.len() / 3) as u32;
                    let mut q = local[v as usize];
                    // Points on a mirror line go exactly onto it.
                    for nr in &normals {
                        let d = nr[0] * q[0] + nr[1] * q[1];
                        if d.abs() <= tol {
                            q = [q[0] - d * nr[0], q[1] - d * nr[1]];
                        }
                    }
                    wpos.extend([q[0] as f32, q[1] as f32, 0.0]);
                    wweld.push(weld[v as usize]);
                    source.push(v);
                }
                windices.push(new_id[v as usize]);
            }
            if ti < top_triangles {
                wtop += 1;
            }
        }
        // Every point of the piece comes from a wedge point on the same sheet.
        let mut map = Vec::with_capacity(n_all);
        for i in 0..n_all {
            let (img, k, m) = sym.to_wedge_local(local[i]);
            let j = find(sym.from_local(img), sheet[i]).ok_or_else(not_sym)?;
            let w = new_id[j as usize];
            if w == u32::MAX {
                return Err(not_sym());
            }
            map.push((w, k as u8, m));
        }
        let nw = wweld.len();
        let wq = |i: usize| [wpos[3 * i] as f64, wpos[3 * i + 1] as f64];
        let on = |nr: &P2, i: usize| (nr[0] * wq(i)[0] + nr[1] * wq(i)[1]).abs() <= tol;
        let centre: Vec<u32> = if n >= 2 { (0..nw).filter(|&i| normals.iter().all(|nr| on(nr, i))).map(|i| i as u32).collect() } else { vec![] };
        let mirrors = normals.iter().map(|nr| (*nr, (0..nw).filter(|&i| on(nr, i) && !centre.contains(&(i as u32))).map(|i| i as u32).collect())).collect();
        Ok(Fold { sym, positions: wpos, indices: windices, weld: wweld, top_triangles: wtop, mirrors, centre, source, map })
    }

    /// How many copies of the wedge make the piece (2n).
    pub fn copies(&self) -> usize {
        2 * self.sym.n
    }

    /// Wedge positions (local frame, as solved) → the whole piece in the drawing's frame.
    pub fn unfold(&self, wedge: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.map.len() * 3);
        for &(w, k, m) in &self.map {
            let w = w as usize;
            let q = self.sym.apply_local(k as usize, m, [wedge[3 * w] as f64, wedge[3 * w + 1] as f64]);
            let p = self.sym.from_local(q);
            out.extend([p[0] as f32, p[1] as f32, wedge[3 * w + 2]]);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::SheetMesh;
    use crate::shapes;

    fn order(p: &Piece) -> usize {
        detect(&p.outer, TOLERANCE).map(|s| s.n).unwrap_or(0)
    }

    #[test]
    fn finds_the_symmetry_of_common_shapes() {
        assert_eq!(order(&shapes::polygon(3, 300.0)), 3);
        assert_eq!(order(&shapes::square(300.0)), 4);
        assert_eq!(order(&shapes::polygon(6, 300.0)), 6);
        assert_eq!(order(&shapes::rect(300.0, 180.0)), 2);
        assert_eq!(order(&shapes::circle(300.0)), 2, "round → quarter");
        assert_eq!(order(&shapes::lshape(200.0)), 1, "L: one mirror line (the diagonal)");
        // Rotated and moved: same answer.
        let tri: Vec<P2> = shapes::polygon(3, 300.0).outer.iter().map(|p| {
            let (s, c) = 0.4f64.sin_cos();
            [c * p[0] - s * p[1] + 37.0, s * p[0] + c * p[1] - 12.0]
        }).collect();
        assert_eq!(detect(&tri, TOLERANCE).unwrap().n, 3);
        // A lopsided quadrilateral has none.
        assert!(detect(&[[0.0, 0.0], [100.0, 0.0], [130.0, 70.0], [10.0, 90.0]], TOLERANCE).is_err());
    }

    #[test]
    fn symmetric_mesh_is_watertight_and_mirrors_onto_itself() {
        for piece in [shapes::polygon(3, 300.0), shapes::square(240.0), shapes::lshape(200.0), shapes::circle(200.0), shapes::hexstar(300.0), shapes::quilt(240.0), shapes::ring(240.0)] {
            let (flat, sym) = mesh_symmetric(&[piece.clone()], 1500.0, 28.0).unwrap();
            let m = SheetMesh::from_flat(&flat);
            let mut uses: BTreeMap<(u32, u32), usize> = BTreeMap::new();
            for t in &m.tris {
                for k in 0..3 {
                    let (a, b) = (t[k], t[(k + 1) % 3]);
                    *uses.entry((a.min(b), a.max(b))).or_insert(0) += 1;
                }
            }
            for (e, c) in &uses {
                if *c != 2 {
                    let (a, b) = (sym.to_local(m.flat[e.0 as usize]), sym.to_local(m.flat[e.1 as usize]));
                    println!("edge used {c}: {a:?} {:?} -> {b:?} {:?}", m.kind[e.0 as usize], m.kind[e.1 as usize]);
                }
            }
            // Closed: outline / cut-out edges used twice, weld-line edges four times.
            assert!(uses.values().all(|&n| n == 2 || n == 4), "not watertight (n = {})", sym.n);
            // Every point has its mirror image in the mesh, with the same weld flag.
            let tol = flat.spacing * 1e-4;
            for (p, w) in flat.verts.iter().zip(&flat.weld) {
                let q = sym.to_local(*p);
                let r = sym.from_local([q[0], -q[1]]);
                let hit = flat.verts.iter().zip(&flat.weld).any(|(o, ow)| (o[0] - r[0]).hypot(o[1] - r[1]) < tol && ow == w);
                assert!(hit, "no mirror image for {p:?}");
            }
            // Welds only on the drawn welds: no weld point strays onto a mirror line.
            let on_weld = |p: P2| {
                std::iter::once(&piece.outer).chain(&piece.holes).any(|l| poly_dist(p, l) < flat.spacing * 0.01)
                    || piece.seams.iter().any(|l| l.windows(2).any(|s| seg_dist(p, s[0], s[1]) < flat.spacing * 0.01))
            };
            for (p, w) in flat.verts.iter().zip(&flat.weld) {
                assert_eq!(*w, on_weld(*p), "weld flag wrong at {p:?} (n = {})", sym.n);
            }
            let area: f64 = flat.tris.iter().map(|t| {
                let (a, b, c) = (flat.verts[t[0] as usize], flat.verts[t[1] as usize], flat.verts[t[2] as usize]);
                0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
            }).sum();
            assert!((area / piece.area() - 1.0).abs() < 0.01, "area {area} vs {}", piece.area());
        }
    }

    #[test]
    fn fold_cuts_the_wedge_and_unfolds_it_back() {
        for piece in [shapes::polygon(3, 300.0), shapes::square(240.0), shapes::lshape(200.0), shapes::circle(200.0), shapes::hexstar(300.0), shapes::quilt(240.0), shapes::ring(240.0)] {
            let (flat, sym) = mesh_symmetric(&[piece], 1500.0, 28.0).unwrap();
            let m = SheetMesh::from_flat(&flat);
            let pos: Vec<f32> = m.flat.iter().flat_map(|p| [p[0] as f32, p[1] as f32, 0.0]).collect();
            let idx: Vec<u32> = m.tris.iter().flatten().copied().collect();
            let weld: Vec<u8> = m.kind.iter().map(|k| (*k == crate::mesh::VertexKind::Weld) as u8).collect();
            let top = m.tri_sheet.iter().filter(|s| **s == 0).count();
            let f = Fold::new(&pos, &idx, &weld, top).unwrap();
            assert_eq!(f.sym.n, sym.n);
            let ratio = (idx.len() / 3) as f64 / (f.indices.len() / 3) as f64;
            assert!((ratio - f.copies() as f64).abs() < 1e-9, "wedge holds 1/{} of the triangles, got 1/{ratio}", f.copies());
            assert!(!f.mirrors[0].1.is_empty());
            assert!(f.centre.len() <= 2, "top and bottom centre points (one if welded, none round a cut-out)");
            // Unfolding the flat wedge gives back the flat piece.
            let back = f.unfold(&f.positions);
            let worst = pos.iter().zip(&back).map(|(a, b)| (a - b).abs()).fold(0.0f32, f32::max);
            assert!(worst < 1e-3, "unfold off by {worst} mm");
        }
    }

    #[test]
    fn to_wedge_inverts_apply() {
        let sym = Symmetry { center: [5.0, -3.0], axis: 0.3, n: 3 };
        for i in 0..50 {
            let a = i as f64 * 0.37;
            let q = [40.0 * a.cos(), 40.0 * a.sin()];
            let (w, k, m) = sym.to_wedge_local(q);
            let ang = w[1].atan2(w[0]);
            assert!(ang >= -1e-9 && ang <= sym.wedge() + 1e-9);
            let back = sym.apply_local(k, m, w);
            assert!((back[0] - q[0]).hypot(back[1] - q[1]) < 1e-9);
        }
    }
}
