//! Flat outlines. Every contour is a weld:
//! - `outer`  — the perimeter (closed),
//! - `holes`  — welded cut-outs (closed, inside the perimeter),
//! - `seams`  — open weld lines joining the two sheets inside the piece.

use serde::{Deserialize, Serialize};

pub type P2 = [f64; 2];

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Piece {
    pub outer: Vec<P2>,
    pub holes: Vec<Vec<P2>>,
    pub seams: Vec<Vec<P2>>,
}

impl Piece {
    pub fn new(outer: Vec<P2>) -> Self {
        Piece { outer, holes: vec![], seams: vec![] }
    }

    /// Net area (outer minus holes), mm².
    pub fn area(&self) -> f64 {
        signed_area(&self.outer).abs() - self.holes.iter().map(|h| signed_area(h).abs()).sum::<f64>()
    }

    /// True if `p` is inside the material (inside outer, outside every hole).
    pub fn contains(&self, p: P2) -> bool {
        point_in_polygon(p, &self.outer) && !self.holes.iter().any(|h| point_in_polygon(p, h))
    }
}

pub fn signed_area(poly: &[P2]) -> f64 {
    let n = poly.len();
    let mut a = 0.0;
    for i in 0..n {
        let p = poly[i];
        let q = poly[(i + 1) % n];
        a += p[0] * q[1] - q[0] * p[1];
    }
    0.5 * a
}

/// Area-weighted centroid of a closed polygon.
pub fn centroid(poly: &[P2]) -> P2 {
    let n = poly.len();
    let (mut cx, mut cy, mut a) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let p = poly[i];
        let q = poly[(i + 1) % n];
        let cr = p[0] * q[1] - q[0] * p[1];
        a += cr;
        cx += (p[0] + q[0]) * cr;
        cy += (p[1] + q[1]) * cr;
    }
    if a.abs() < 1e-300 {
        let s = poly.iter().fold([0.0, 0.0], |s, p| [s[0] + p[0], s[1] + p[1]]);
        return [s[0] / n as f64, s[1] / n as f64];
    }
    [cx / (3.0 * a), cy / (3.0 * a)]
}

pub fn point_in_polygon(p: P2, poly: &[P2]) -> bool {
    let n = poly.len();
    let mut inside = false;
    let mut j = n.wrapping_sub(1);
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
        j = i;
    }
    inside
}

fn dist(a: P2, b: P2) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// Remove consecutive duplicates (and the closing duplicate for closed loops).
pub fn clean(poly: &[P2], closed: bool, tol: f64) -> Vec<P2> {
    let mut out: Vec<P2> = Vec::with_capacity(poly.len());
    for &p in poly {
        if out.last().map_or(true, |&q| dist(p, q) > tol) {
            out.push(p);
        }
    }
    if closed {
        while out.len() > 2 && dist(out[0], *out.last().unwrap()) <= tol {
            out.pop();
        }
    }
    out
}

/// Make every place where two welds cross or touch a shared corner of both
/// polylines (each line is `(points, closed)`), so spacing them out later puts
/// a weld point exactly at the junction instead of a sliver beside it. A seam
/// end within `tol` of another weld is moved onto it.
pub fn join_welds(lines: &mut [(Vec<P2>, bool)], tol: f64) {
    let seg = |l: &(Vec<P2>, bool), i: usize| (l.0[i], l.0[(i + 1) % l.0.len()]);
    let nseg = |l: &(Vec<P2>, bool)| if l.1 { l.0.len() } else { l.0.len().saturating_sub(1) };
    // Insertions per line: (segment index, parameter along it, point).
    let mut ins: Vec<Vec<(usize, f64, P2)>> = vec![Vec::new(); lines.len()];
    for i in 0..lines.len() {
        // Open line ends that touch another weld: snap them on.
        if !lines[i].1 && lines[i].0.len() >= 2 {
            for end in [0, lines[i].0.len() - 1] {
                let p = lines[i].0[end];
                for j in 0..lines.len() {
                    if j == i {
                        continue;
                    }
                    for s in 0..nseg(&lines[j]) {
                        let (a, b) = seg(&lines[j], s);
                        let (q, t) = project(p, a, b);
                        if dist(p, q) <= tol {
                            lines[i].0[end] = q;
                            if t > 1e-9 && t < 1.0 - 1e-9 {
                                ins[j].push((s, t, q));
                            }
                        }
                    }
                }
            }
        }
    }
    for i in 0..lines.len() {
        for j in i + 1..lines.len() {
            for si in 0..nseg(&lines[i]) {
                let (a, b) = seg(&lines[i], si);
                for sj in 0..nseg(&lines[j]) {
                    let (c, d) = seg(&lines[j], sj);
                    if let Some((t, u)) = seg_cross(a, b, c, d) {
                        let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                        if t > 1e-9 && t < 1.0 - 1e-9 {
                            ins[i].push((si, t, p));
                        }
                        if u > 1e-9 && u < 1.0 - 1e-9 {
                            ins[j].push((sj, u, p));
                        }
                    }
                }
            }
        }
    }
    for (l, mut add) in lines.iter_mut().zip(ins) {
        if add.is_empty() {
            continue;
        }
        add.sort_by(|x, y| (x.0, x.1).partial_cmp(&(y.0, y.1)).unwrap());
        let mut out = Vec::with_capacity(l.0.len() + add.len());
        let mut k = 0;
        for s in 0..l.0.len() {
            out.push(l.0[s]);
            while k < add.len() && add[k].0 == s {
                out.push(add[k].2);
                k += 1;
            }
        }
        l.0 = out;
    }
}

fn project(p: P2, a: P2, b: P2) -> (P2, f64) {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    ([a[0] + t * dx, a[1] + t * dy], t)
}

/// Parameters (t on ab, u on cd) where two segments properly cross.
fn seg_cross(a: P2, b: P2, c: P2, d: P2) -> Option<(f64, f64)> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let den = r[0] * s[1] - r[1] * s[0];
    if den.abs() < 1e-12 {
        return None;
    }
    let q = [c[0] - a[0], c[1] - a[1]];
    let t = (q[0] * s[1] - q[1] * s[0]) / den;
    let u = (q[0] * r[1] - q[1] * r[0]) / den;
    if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
        Some((t, u))
    } else {
        None
    }
}

/// Respace a weld line to about `spacing` per segment. Corners (turns over
/// 30°), the ends of an open line and any point `keep` says to hold (weld
/// junctions) stay exactly where they are; in between, points are spread
/// evenly along the line. Curves exported as thousands of tiny steps (Illustrator
/// splines) are thinned this way — those steps made needle triangles that
/// tore under pressure. Where a straight segment would cut more than a tenth
/// of `spacing` off the drawn curve (a tight tip), the farthest drawn point is
/// held as well.
pub fn resample(poly: &[P2], closed: bool, spacing: f64, keep: &dyn Fn(P2) -> bool) -> Vec<P2> {
    let n = poly.len();
    if n < 2 {
        return poly.to_vec();
    }
    // Arc length to each drawn point (closed: one extra entry back to the start).
    let m = if closed { n + 1 } else { n };
    let at = |i: usize| poly[i % n];
    let mut s = vec![0.0; m];
    for i in 1..m {
        s[i] = s[i - 1] + dist(at(i - 1), at(i));
    }
    let total = s[m - 1];

    // Points to hold: ends and junctions first, then corners not crowding them.
    let mut held: Vec<usize> = Vec::new();
    if !closed {
        held.push(0);
        held.push(n - 1);
    }
    for i in 0..n {
        if keep(poly[i]) {
            held.push(i);
        }
    }
    let gap = |a: usize, b: usize| {
        let d = (s[a] - s[b]).abs();
        if closed { d.min(total - d) } else { d }
    };
    for i in 0..n {
        if !closed && (i == 0 || i == n - 1) {
            continue;
        }
        let (a, b, c) = (at(i + n - 1), poly[i], at(i + 1));
        let (u, v) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
        let (lu, lv) = (u[0].hypot(u[1]), v[0].hypot(v[1]));
        if lu == 0.0 || lv == 0.0 {
            continue;
        }
        let cos = (u[0] * v[0] + u[1] * v[1]) / (lu * lv);
        if cos < 30f64.to_radians().cos() && held.iter().all(|&h| gap(h, i) > spacing * 0.3) {
            held.push(i);
        }
    }
    if held.is_empty() {
        held.push(0);
    }
    held.sort_unstable();
    held.dedup();

    // Even points between held i and j (indices into s; j may be n for "back to start").
    fn span(poly: &[P2], s: &[f64], i: usize, j: usize, spacing: f64, out: &mut Vec<P2>) {
        let n = poly.len();
        let at = |k: usize| poly[k % n];
        let len = s[j] - s[i];
        let k = (len / spacing).ceil().max(1.0) as usize;
        let start = out.len();
        let mut seg = i;
        for q in 0..k {
            let target = s[i] + len * q as f64 / k as f64;
            while seg + 1 < j && s[seg + 1] <= target {
                seg += 1;
            }
            let l = s[seg + 1] - s[seg];
            let t = if l > 0.0 { (target - s[seg]) / l } else { 0.0 };
            let (a, b) = (at(seg), at(seg + 1));
            out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        // How far does each drawn point sit off the new segments?
        let end = at(j);
        let (mut worst, mut far) = (0.0, 0);
        for d in i + 1..j {
            let q = (((s[d] - s[i]) / len * k as f64) as usize).min(k - 1);
            let a = out[start + q];
            let b = if q + 1 < k { out[start + q + 1] } else { end };
            let e = dist_to_seg(at(d), a, b);
            if e > worst {
                worst = e;
                far = d;
            }
        }
        if worst > spacing * 0.1 {
            out.truncate(start);
            span(poly, s, i, far, spacing, out);
            span(poly, s, far, j, spacing, out);
        }
    }

    let mut out = Vec::new();
    for w in 0..held.len() {
        let i = held[w];
        let j = if w + 1 < held.len() { held[w + 1] } else if closed { held[0] + n } else { break };
        if j > n {
            // Wraps past the start: walk a rotated copy so indices stay increasing.
            let rot: Vec<P2> = (0..n).map(|k| poly[(k + i) % n]).collect();
            let mut rs = vec![0.0; n + 1];
            for k in 1..=n {
                rs[k] = rs[k - 1] + dist(rot[k - 1], rot[k % n]);
            }
            span(&rot, &rs, 0, j - i, spacing, &mut out);
        } else {
            span(poly, &s, i, j, spacing, &mut out);
        }
    }
    if !closed {
        out.push(poly[n - 1]);
    }
    out
}

fn dist_to_seg(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    dist(p, [a[0] + dx * t, a[1] + dy * t])
}

/// Does a polyline cross itself? (O(n²); outlines are a few hundred points.)
pub fn self_intersects(poly: &[P2], closed: bool) -> bool {
    let n = poly.len();
    if n < 4 {
        return false;
    }
    let segs = if closed { n } else { n - 1 };
    for i in 0..segs {
        let a1 = poly[i];
        let a2 = poly[(i + 1) % n];
        for j in (i + 2)..segs {
            if closed && i == 0 && j == segs - 1 {
                continue; // first and last segments share a point
            }
            let b1 = poly[j];
            let b2 = poly[(j + 1) % n];
            if segments_cross(a1, a2, b1, b2) {
                return true;
            }
        }
    }
    false
}

fn orient(a: P2, b: P2, c: P2) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

pub fn segments_cross(a1: P2, a2: P2, b1: P2, b2: P2) -> bool {
    let d1 = orient(b1, b2, a1);
    let d2 = orient(b1, b2, a2);
    let d3 = orient(a1, a2, b1);
    let d4 = orient(a1, a2, b2);
    ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0)) && d1 != 0.0 && d2 != 0.0 && d3 != 0.0 && d4 != 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_area_and_contains() {
        let sq = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let mut p = Piece::new(sq);
        p.holes.push(vec![[4.0, 4.0], [6.0, 4.0], [6.0, 6.0], [4.0, 6.0]]);
        assert!((p.area() - 96.0).abs() < 1e-9);
        assert!(p.contains([1.0, 1.0]));
        assert!(!p.contains([5.0, 5.0]));
        assert!(!p.contains([11.0, 5.0]));
    }

    #[test]
    fn resample_keeps_corners() {
        let sq = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        let r = resample(&sq, true, 2.5, &|_| false);
        assert_eq!(r.len(), 16);
        assert!(r.contains(&[10.0, 10.0]));
    }

    #[test]
    fn resample_thins_fine_curves() {
        // A 100 mm circle flattened into 5000 tiny steps (as Illustrator splines arrive).
        let circle: Vec<P2> = (0..5000).map(|i| {
            let a = i as f64 / 5000.0 * std::f64::consts::TAU;
            [50.0 * a.cos(), 50.0 * a.sin()]
        }).collect();
        let r = resample(&circle, true, 2.0, &|_| false);
        let n = r.len();
        let edges: Vec<f64> = (0..n).map(|i| dist(r[i], r[(i + 1) % n])).collect();
        let (lo, hi) = edges.iter().fold((f64::MAX, 0f64), |(lo, hi), &e| (lo.min(e), hi.max(e)));
        assert!(lo > 1.0 && hi <= 2.0 + 1e-9, "edges {lo:.3}..{hi:.3}");
        // A held point survives exactly.
        let r = resample(&circle, true, 2.0, &|p| p == circle[1234]);
        assert!(r.contains(&circle[1234]));
    }

    #[test]
    fn detects_bow_tie() {
        let bow = vec![[0.0, 0.0], [10.0, 10.0], [10.0, 0.0], [0.0, 10.0]];
        assert!(self_intersects(&bow, true));
        let sq = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
        assert!(!self_intersects(&sq, true));
    }
}
