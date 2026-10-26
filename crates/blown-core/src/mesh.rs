//! Meshing: flat outline → even triangle mesh → two sheets sharing weld points.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use spade::{AngleLimit, ConstrainedDelaunayTriangulation, Point2, RefinementParameters, Triangulation};

use crate::outline::{clean, join_welds, resample, Piece, P2};

type Cdt = ConstrainedDelaunayTriangulation<Point2<f64>>;

/// A flat triangle mesh of the outline (one sheet's worth).
#[derive(Clone, Debug, Default)]
pub struct FlatMesh {
    pub verts: Vec<P2>,
    /// Counter-clockwise triangles.
    pub tris: Vec<[u32; 3]>,
    /// True for points on any weld (perimeter, cut-out or seam).
    pub weld: Vec<bool>,
    /// Target edge length used (mm).
    pub spacing: f64,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VertexKind {
    Top,
    Bottom,
    Weld,
}

/// Two sheets: interior points are duplicated (top/bottom), weld points shared.
/// Together they form one closed (watertight) surface.
#[derive(Clone, Debug, Default)]
pub struct SheetMesh {
    /// Flat (cut-pattern) position of every 3D vertex, mm. Used for UVs.
    pub flat: Vec<P2>,
    pub kind: Vec<VertexKind>,
    /// Outward-facing triangles (top faces +z, bottom faces −z when flat).
    pub tris: Vec<[u32; 3]>,
    /// 0 = Sheet_Top, 1 = Sheet_Bottom.
    pub tri_sheet: Vec<u8>,
    pub spacing: f64,
    pub warnings: Vec<String>,
}

fn key(a: usize, b: usize) -> (usize, usize) {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

/// Distance between lattice points along a cut line (unit normal `n`) through
/// a lattice point: one spacing along the rows' directions (0°, 60°, 120°),
/// √3 spacings across them (30°, 90°, 150°); other angles don't meet the
/// lattice evenly, so one spacing.
pub fn cut_step(n: P2, spacing: f64) -> f64 {
    let ang = (-n[1]).atan2(n[0]).to_degrees().rem_euclid(60.0);
    if (ang - 30.0).abs() < 1e-6 {
        spacing * 3f64.sqrt()
    } else {
        spacing
    }
}

/// Triangulate `pieces` with roughly `target_vertices` points per sheet.
pub fn triangulate(pieces: &[Piece], target_vertices: f64, min_angle_deg: f64) -> Result<FlatMesh, String> {
    triangulate_cut(pieces, target_vertices, min_angle_deg, &[], &[])
}

/// As `triangulate`, for one slice of a symmetric piece: outline segments
/// lying on a cut line (a line through the origin, given by its unit normal)
/// are edges of the mesh but not welds — no weld row beside them and no gap
/// before the even lattice, which runs right up to them, lined up so the
/// origin is a lattice point (a cut line along a lattice direction is then
/// just another row). Session 16: treating them as welds left a strip of odd
/// triangles with long straight lines that the sheet folded along.
/// `cut_welds`: stretches of cut line that are welds (a weld line lying on a
/// mirror line), meshed as welds.
pub fn triangulate_cut(pieces: &[Piece], target_vertices: f64, min_angle_deg: f64, cuts: &[P2], cut_welds: &[(P2, P2)]) -> Result<FlatMesh, String> {
    let area: f64 = pieces.iter().map(|p| p.area()).sum();
    if !(area > 0.0) || !area.is_finite() {
        return Err("The outline has no area — is it closed?".into());
    }
    // Equilateral triangles: area per vertex = (√3/2)·a².
    let spacing = (2.0 * (area / target_vertices.max(10.0)) / 3f64.sqrt()).sqrt();
    let tol = spacing * 1e-4;

    let mut cdt = Cdt::new();
    let mut warnings = Vec::new();

    let add_line = |cdt: &mut Cdt, raw: &[P2], closed: bool, _what: &str| -> Result<(), String> {
        let pts = raw;
        if pts.len() < 2 {
            return Ok(());
        }
        let mut hs = Vec::with_capacity(pts.len());
        for p in pts {
            let h = cdt
                .insert(Point2::new(p[0], p[1]))
                .map_err(|e| format!("Could not mesh point {p:?}: {e:?}"))?;
            hs.push(h);
        }
        let n = hs.len();
        let segs = if closed { n } else { n - 1 };
        for i in 0..segs {
            let (a, b) = (hs[i], hs[(i + 1) % n]);
            if a == b {
                continue;
            }
            if cdt.can_add_constraint(a, b) {
                cdt.add_constraint(a, b);
            } else {
                // Welds that cross are welded together where they meet (quilt lines).
                cdt.add_constraint_and_split(a, b, |p| p);
            }
        }
        Ok(())
    };

    let mut lines: Vec<(Vec<P2>, bool)> = Vec::new();
    for piece in pieces {
        lines.push((clean(&piece.outer, true, tol), true));
        lines.extend(piece.holes.iter().map(|h| (clean(h, true, tol), true)));
        lines.extend(piece.seams.iter().map(|s| (clean(s, false, tol), false)));
    }
    join_welds(&mut lines, spacing * 0.02);
    // Respace every weld to the mesh spacing, holding weld junctions (points
    // two lines share after joining) exactly in place.
    let mut uses: BTreeMap<(u64, u64), usize> = BTreeMap::new();
    for (pts, _) in &lines {
        for p in pts {
            *uses.entry((p[0].to_bits(), p[1].to_bits())).or_default() += 1;
        }
    }
    // Cut lines: points a whole number of spacings from the origin are held,
    // so the row on the cut line sits on the lattice.
    let on_weld_cut = |p: P2| cut_welds.iter().any(|&(s0, s1)| dist_to_segment(p, s0, s1) <= spacing * 1e-5);
    let on_lattice = |p: P2| {
        cuts.iter().any(|n| {
            let r = p[0].hypot(p[1]) / cut_step(*n, spacing);
            (n[0] * p[0] + n[1] * p[1]).abs() <= spacing * 1e-6 && (r - r.round()).abs() < 1e-6
        })
    };
    let junction = |p: P2| uses.get(&(p[0].to_bits(), p[1].to_bits())).is_some_and(|&c| c > 1) || on_lattice(p);
    for (pts, closed) in lines.iter_mut() {
        *pts = resample(pts, *closed, spacing, &junction);
        if !cuts.is_empty() && *closed {
            // Along a cut line keep only the lattice points and the run's two
            // ends (respacing would put extra points between them).
            let n = pts.len();
            let line_of = |p: P2| cuts.iter().position(|c| (c[0] * p[0] + c[1] * p[1]).abs() <= spacing * 1e-6);
            let keep: Vec<bool> = (0..n)
                .map(|i| {
                    let p = pts[i];
                    match line_of(p) {
                        None => true,
                        Some(l) => on_lattice(p) || on_weld_cut(p) || line_of(pts[(i + n - 1) % n]) != Some(l) || line_of(pts[(i + 1) % n]) != Some(l) || p[0].hypot(p[1]) < spacing * 1e-6,
                    }
                })
                .collect();
            *pts = pts.iter().zip(&keep).filter(|(_, k)| **k).map(|(p, _)| *p).collect();
        }
    }
    // The same pieces, drawn with the respaced welds: everything below works on these.
    let mut it = lines.iter().map(|l| l.0.clone());
    let respaced: Vec<Piece> = pieces
        .iter()
        .map(|pc| Piece {
            outer: it.next().unwrap_or_default(),
            holes: pc.holes.iter().map(|_| it.next().unwrap_or_default()).collect(),
            seams: pc.seams.iter().map(|_| it.next().unwrap_or_default()).collect(),
        })
        .collect();
    let pieces = &respaced[..];
    for (pts, closed) in &lines {
        add_line(&mut cdt, pts, *closed, "weld")?;
    }

    // Interior points on an even triangular lattice (slightly jittered so
    // folds don't lock onto three grid directions), kept clear of the welds.
    // Seeding the inside this way, and never letting the refiner chop weld
    // edges, avoids fans of needle triangles along straight welds — those
    // tear under pressure.
    let cut_tol = spacing * 1e-6;
    let on_line = |n: &P2, p: P2| (n[0] * p[0] + n[1] * p[1]).abs() <= cut_tol;
    let welded = |p: P2| cut_welds.iter().any(|&(s0, s1)| dist_to_segment(p, s0, s1) <= cut_tol * 10.0);
    let on_cut = |a: P2, b: P2| cuts.iter().any(|n| on_line(n, a) && on_line(n, b)) && !welded([(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0]);
    let near_cut = |p: P2, r: f64| cuts.iter().any(|n| (n[0] * p[0] + n[1] * p[1]).abs() < r);
    let weld_segs: Vec<(P2, P2)> = pieces
        .iter()
        .flat_map(|pc| {
            let closed = std::iter::once(&pc.outer).chain(&pc.holes).flat_map(|l| (0..l.len()).map(move |i| (l[i], l[(i + 1) % l.len()])));
            let open = pc.seams.iter().flat_map(|l| l.windows(2).map(|w| (w[0], w[1])));
            closed.chain(open).collect::<Vec<_>>()
        })
        .filter(|&(a, b)| !on_cut(a, b))
        .collect();
    let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for pc in pieces {
        for p in &pc.outer {
            x0 = x0.min(p[0]);
            y0 = y0.min(p[1]);
            x1 = x1.max(p[0]);
            y1 = y1.max(p[1]);
        }
    }
    // A clean row of triangles along every weld: each weld segment gets a
    // point standing over its middle (both sides of a weld line), so every
    // segment carries a triangle with its base on the weld and the ones in
    // between are evenly shaped. The sheet then folds into the weld along
    // tidy, evenly spaced lines (smooth pleats) instead of crushing irregular
    // fan triangles into teeth.
    let row = spacing * 3f64.sqrt() / 2.0;
    let cell = spacing;
    let mut row_grid: BTreeMap<(i64, i64), Vec<P2>> = BTreeMap::new();
    let gkey = |p: P2| ((p[0] / cell).floor() as i64, (p[1] / cell).floor() as i64);
    let near_row = |grid: &BTreeMap<(i64, i64), Vec<P2>>, p: P2, r: f64| {
        let (gx, gy) = gkey(p);
        (-1..=1).any(|dx| (-1..=1).any(|dy| grid.get(&(gx + dx, gy + dy)).is_some_and(|v| v.iter().any(|q| (q[0] - p[0]).hypot(q[1] - p[1]) < r))))
    };
    for (pts, closed) in &lines {
        let n = pts.len();
        if n < 2 {
            continue;
        }
        for i in 0..if *closed { n } else { n - 1 } {
            let (a, b) = (pts[i], pts[(i + 1) % n]);
            let l = (b[0] - a[0]).hypot(b[1] - a[1]);
            if l < spacing * 0.3 || on_cut(a, b) {
                continue;
            }
            let h = (l * 3f64.sqrt() / 2.0).min(row);
            let nrm = [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
            let m = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
            for side in [1.0, -1.0] {
                let p = [m[0] + side * h * nrm[0], m[1] + side * h * nrm[1]];
                if !pieces.iter().any(|pc| pc.contains(p))
                    || weld_segs.iter().any(|&(s0, s1)| dist_to_segment(p, s0, s1) < h * 0.7)
                    || near_cut(p, spacing * 0.35)
                    || near_row(&row_grid, p, spacing * 0.6)
                {
                    continue;
                }
                let _ = cdt.insert(Point2::new(p[0], p[1]));
                row_grid.entry(gkey(p)).or_default().push(p);
            }
        }
    }

    let clear = spacing * 1.25;
    let aligned = !cuts.is_empty();
    let mut j = if aligned { (y0 / row).floor() as i64 } else { 0 };
    let mut y = if aligned { j as f64 * row } else { y0 + row * 0.5 };
    while y < y1 {
        let odd = if j.rem_euclid(2) == 1 { spacing * 0.5 } else { 0.0 };
        let mut x = if aligned { (x0 / spacing).floor() * spacing + odd } else { x0 + spacing * 0.5 + odd };
        let mut i = if aligned { (x0 / spacing).floor() as i64 } else { 0 };
        while x < x1 {
            let h = hash2(i, j);
            let p = [x + spacing * 0.12 * (h.0 - 0.5), y + spacing * 0.12 * (h.1 - 0.5)];
            if pieces.iter().any(|pc| pc.contains(p))
                && weld_segs.iter().all(|&(a, b)| dist_to_segment(p, a, b) > clear)
                && !near_cut(p, spacing * 0.35)
                && !near_row(&row_grid, p, spacing * 0.75)
            {
                let _ = cdt.insert(Point2::new(p[0], p[1]));
            }
            x += spacing;
            i += 1;
        }
        y += row;
        j += 1;
    }

    let tri_area = 3f64.sqrt() / 4.0 * spacing * spacing;
    let params = RefinementParameters::<f64>::new()
        .exclude_outer_faces(true)
        .keep_constraint_edges()
        .with_max_allowed_area(tri_area * 1.6)
        .with_angle_limit(AngleLimit::from_deg(min_angle_deg))
        .with_max_additional_vertices((target_vertices * 6.0) as usize);
    let result = cdt.refine(params);
    if !result.refinement_complete {
        warnings.push("Mesher hit its point limit; mesh may be uneven".into());
    }

    let inside = |p: P2| pieces.iter().any(|pc| pc.contains(p));

    // Split any non-weld edge whose two ends are both on a weld: otherwise the
    // top and bottom sheets would share that edge and pinch together.
    for _round in 0..8 {
        let cons = constraint_pairs(&cdt);
        let weld_v: HashSet<usize> = cons.iter().flat_map(|&(a, b)| [a, b]).collect();
        let mut splits: BTreeMap<(usize, usize), P2> = BTreeMap::new();
        for f in cdt.inner_faces() {
            let vs = f.vertices();
            let ps: Vec<P2> = vs.iter().map(|v| [v.position().x, v.position().y]).collect();
            let c = [(ps[0][0] + ps[1][0] + ps[2][0]) / 3.0, (ps[0][1] + ps[1][1] + ps[2][1]) / 3.0];
            if !inside(c) {
                continue;
            }
            for k in 0..3 {
                let (a, b) = (vs[k].fix().index(), vs[(k + 1) % 3].fix().index());
                if weld_v.contains(&a) && weld_v.contains(&b) && !cons.contains(&key(a, b)) {
                    let (pa, pb) = (ps[k], ps[(k + 1) % 3]);
                    let mid = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5];
                    // An edge lying along a weld (floating-point leftovers on
                    // straight welds) is not a short-cut across the inside;
                    // splitting it would just chop the weld into needles.
                    if weld_segs.iter().any(|&(s0, s1)| dist_to_segment(mid, s0, s1) < spacing * 1e-3) {
                        continue;
                    }
                    splits.insert(key(a, b), mid);
                }
            }
        }
        if splits.is_empty() {
            break;
        }
        for (_, m) in splits {
            let _ = cdt.insert(Point2::new(m[0], m[1]));
        }
    }

    // Extract the inside triangles.
    let cons = constraint_pairs(&cdt);
    let weld_v: HashSet<usize> = cons.iter().flat_map(|&(a, b)| [a, b]).collect();
    let mut remap: BTreeMap<usize, u32> = BTreeMap::new();
    let mut raw_tris: Vec<[usize; 3]> = Vec::new();
    let mut pos_of: BTreeMap<usize, P2> = BTreeMap::new();
    for f in cdt.inner_faces() {
        let vs = f.vertices();
        let ps: Vec<P2> = vs.iter().map(|v| [v.position().x, v.position().y]).collect();
        let c = [(ps[0][0] + ps[1][0] + ps[2][0]) / 3.0, (ps[0][1] + ps[1][1] + ps[2][1]) / 3.0];
        if !inside(c) {
            continue;
        }
        let idx = [vs[0].fix().index(), vs[1].fix().index(), vs[2].fix().index()];
        // A triangle walled in by welds on all three sides has no inside — skip.
        if (0..3).all(|k| cons.contains(&key(idx[k], idx[(k + 1) % 3]))) {
            continue;
        }
        for k in 0..3 {
            pos_of.insert(idx[k], ps[k]);
        }
        raw_tris.push(idx);
    }
    // Merge points that floating-point noise left almost on top of each other
    // (common on rotated straight edges), then drop zero-area slivers.
    let merge_tol = spacing * 1e-6;
    let cell = |p: P2| ((p[0] / merge_tol).floor() as i64, (p[1] / merge_tol).floor() as i64);
    let mut grid: std::collections::HashMap<(i64, i64), Vec<u32>> = std::collections::HashMap::new();
    let mut merged_pos: Vec<P2> = Vec::new();
    let mut merged_weld: Vec<bool> = Vec::new();
    for (&i, &p) in &pos_of {
        let (cx, cy) = cell(p);
        let mut found = None;
        'search: for dx in -1..=1 {
            for dy in -1..=1 {
                if let Some(list) = grid.get(&(cx + dx, cy + dy)) {
                    for &j in list {
                        let q = merged_pos[j as usize];
                        if (p[0] - q[0]).hypot(p[1] - q[1]) <= merge_tol {
                            found = Some(j);
                            break 'search;
                        }
                    }
                }
            }
        }
        let id = found.unwrap_or_else(|| {
            let id = merged_pos.len() as u32;
            merged_pos.push(p);
            merged_weld.push(false);
            grid.entry((cx, cy)).or_default().push(id);
            id
        });
        merged_weld[id as usize] |= weld_v.contains(&i);
        remap.insert(i, id);
    }
    // A point that lies on a weld line counts as welded even if the mesher
    // didn't register it on the constraint (another floating-point leftover).
    let all_pos: Vec<P2> = cdt.vertices().map(|v| [v.position().x, v.position().y]).collect();
    let segs: Vec<(P2, P2)> = cons.iter().map(|&(a, b)| (all_pos[a], all_pos[b])).collect();
    for (id, p) in merged_pos.iter().enumerate() {
        if !merged_weld[id] && segs.iter().any(|&(a, b)| dist_to_segment(*p, a, b) <= merge_tol * 10.0) {
            merged_weld[id] = true;
        }
    }
    let min_area2 = spacing * spacing * 1e-6;
    let mut kept: Vec<[u32; 3]> = Vec::with_capacity(raw_tris.len());
    for t in &raw_tris {
        let mut m = [remap[&t[0]], remap[&t[1]], remap[&t[2]]];
        if m[0] == m[1] || m[1] == m[2] || m[0] == m[2] {
            continue;
        }
        let (a, b, c) = (merged_pos[m[0] as usize], merged_pos[m[1] as usize], merged_pos[m[2] as usize]);
        let o = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if o.abs() < min_area2 {
            continue;
        }
        if o < 0.0 {
            m.swap(1, 2);
        }
        kept.push(m);
    }
    // Compact to the points still in use.
    let mut used = vec![u32::MAX; merged_pos.len()];
    let mut verts: Vec<P2> = Vec::new();
    let mut weld: Vec<bool> = Vec::new();
    let tris: Vec<[u32; 3]> = kept
        .iter()
        .map(|t| {
            t.map(|v| {
                if used[v as usize] == u32::MAX {
                    used[v as usize] = verts.len() as u32;
                    verts.push(merged_pos[v as usize]);
                    weld.push(merged_weld[v as usize]);
                }
                used[v as usize]
            })
        })
        .collect();
    if tris.is_empty() {
        return Err("Meshing produced no triangles — check the outline is closed".into());
    }
    Ok(FlatMesh { verts, tris, weld, spacing, warnings })
}

/// Deterministic pseudo-random pair in [0, 1) for lattice point (i, j).
fn hash2(i: i64, j: i64) -> (f64, f64) {
    let mut h = (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15) ^ (j as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F);
    h ^= h >> 31;
    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h ^= h >> 29;
    ((h & 0xFFFF_FFFF) as f64 / 4294967296.0, (h >> 32) as f64 / 4294967296.0)
}

fn dist_to_segment(p: P2, a: P2, b: P2) -> f64 {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
}

fn constraint_pairs(cdt: &Cdt) -> BTreeSet<(usize, usize)> {
    cdt.undirected_edges()
        .filter(|e| cdt.is_constraint_edge(e.fix()))
        .map(|e| {
            let [a, b] = e.vertices();
            key(a.fix().index(), b.fix().index())
        })
        .collect()
}

impl SheetMesh {
    pub fn from_flat(flat: &FlatMesh) -> SheetMesh {
        let n = flat.verts.len();
        let mut out = SheetMesh { spacing: flat.spacing, warnings: flat.warnings.clone(), ..Default::default() };
        let mut top_of = vec![0u32; n];
        let mut bot_of = vec![0u32; n];
        // Top sheet vertices (welds shared) first, then bottom interior ones.
        for i in 0..n {
            top_of[i] = out.flat.len() as u32;
            out.flat.push(flat.verts[i]);
            out.kind.push(if flat.weld[i] { VertexKind::Weld } else { VertexKind::Top });
        }
        for i in 0..n {
            if flat.weld[i] {
                bot_of[i] = top_of[i];
            } else {
                bot_of[i] = out.flat.len() as u32;
                out.flat.push(flat.verts[i]);
                out.kind.push(VertexKind::Bottom);
            }
        }
        for t in &flat.tris {
            out.tris.push([top_of[t[0] as usize], top_of[t[1] as usize], top_of[t[2] as usize]]);
            out.tri_sheet.push(0);
        }
        for t in &flat.tris {
            out.tris.push([bot_of[t[0] as usize], bot_of[t[2] as usize], bot_of[t[1] as usize]]);
            out.tri_sheet.push(1);
        }
        out
    }

    pub fn num_vertices(&self) -> usize {
        self.flat.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shapes;

    fn edge_use_counts(m: &SheetMesh) -> BTreeMap<(u32, u32), usize> {
        let mut c = BTreeMap::new();
        for t in &m.tris {
            for k in 0..3 {
                let (a, b) = (t[k], t[(k + 1) % 3]);
                *c.entry(if a < b { (a, b) } else { (b, a) }).or_insert(0) += 1;
            }
        }
        c
    }

    #[test]
    fn circle_mesh_is_even_and_inside() {
        let p = shapes::circle(300.0);
        let m = triangulate(&[p.clone()], 1500.0, 28.0).unwrap();
        assert!(m.verts.len() > 1000 && m.verts.len() < 2500, "got {}", m.verts.len());
        for t in &m.tris {
            let c = (0..3).fold([0.0, 0.0], |s, k| {
                let v = m.verts[t[k] as usize];
                [s[0] + v[0] / 3.0, s[1] + v[1] / 3.0]
            });
            assert!(p.contains(c));
        }
        assert!(m.weld.iter().filter(|w| **w).count() > 50);
    }

    #[test]
    fn two_sheets_are_watertight() {
        for piece in [shapes::square(200.0), shapes::lshape(200.0), shapes::ring(200.0)] {
            let flat = triangulate(&[piece], 800.0, 28.0).unwrap();
            let m = SheetMesh::from_flat(&flat);
            // Closed 2-manifold: every edge used by exactly two triangles.
            for (e, n) in edge_use_counts(&m) {
                assert_eq!(n, 2, "edge {e:?} used {n} times");
            }
        }
    }

    #[test]
    fn crossing_welds_meet_at_a_weld_point() {
        let flat = triangulate(&[crate::shapes::quilt(200.0)], 1500.0, 28.0).unwrap();
        let centre = flat.verts.iter().zip(&flat.weld).any(|(v, w)| *w && v[0].abs() < 1e-6 && v[1].abs() < 1e-6);
        assert!(centre, "the two welds should be joined where they cross");
        // Weld points along the outline edge where a seam ends.
        assert!(flat.verts.iter().zip(&flat.weld).any(|(v, w)| *w && (v[0] - 100.0).abs() < 1e-6 && v[1].abs() < 1e-6));
    }

    #[test]
    fn seams_are_welded() {
        let mut p = shapes::square(200.0);
        p.seams.push(vec![[-50.0, 0.0], [50.0, 0.0]]);
        let flat = triangulate(&[p], 800.0, 28.0).unwrap();
        let on_seam = flat.verts.iter().zip(&flat.weld).filter(|(v, w)| **w && v[1].abs() < 1e-9 && v[0].abs() < 49.0);
        assert!(on_seam.count() >= 5);
    }

    #[test]
    fn closed_weld_loop_quilts_without_cutting_a_hole() {
        // A weld loop inside the outline arrives as a seam whose last point
        // repeats its first: the sheets are welded around it, not cut out.
        let mut p = shapes::square(200.0);
        p.seams.push(vec![[-50.0, -50.0], [50.0, -50.0], [50.0, 50.0], [-50.0, 50.0], [-50.0, -50.0]]);
        let flat = triangulate(&[p], 800.0, 28.0).unwrap();
        let inside = flat.tris.iter().any(|t| (0..3).all(|k| flat.verts[t[k] as usize][0].abs() < 49.0 && flat.verts[t[k] as usize][1].abs() < 49.0));
        assert!(inside, "the middle of the loop should still be meshed");
        let on_loop = flat.verts.iter().zip(&flat.weld).filter(|(v, w)| **w && (v[1] - 50.0).abs() < 1e-9 && v[0].abs() < 49.0);
        assert!(on_loop.count() >= 5);
        // Closed: outline edges are shared by two triangles, weld-line edges
        // by four (both sheets, both sides).
        let m = SheetMesh::from_flat(&flat);
        for (e, n) in edge_use_counts(&m) {
            assert!(n == 2 || n == 4, "edge {e:?} used {n} times");
        }
    }
}

#[cfg(test)]
mod quality_tests {
    use super::*;
    use crate::outline::Piece;

    fn rotated_rect(deg: f64) -> Piece {
        let (c, s) = (deg.to_radians().cos(), deg.to_radians().sin());
        let (w, h) = (150.0, 112.4);
        Piece::new([[-w, -h], [w, -h], [w, h], [-w, h]].iter().map(|[x, y]| [c * x - s * y - 34.0, s * x + c * y + 42.0]).collect())
    }

    #[test]
    fn rotated_mesh_has_no_slivers() {
        for deg in [0.0, 13.0, 30.0, 45.0, 77.7] {
            let m = triangulate(&[rotated_rect(deg)], 1600.0, 28.0).unwrap();
            let mut min_area = f64::MAX;
            let mut min_edge = f64::MAX;
            for t in &m.tris {
                let (a, b, c) = (m.verts[t[0] as usize], m.verts[t[1] as usize], m.verts[t[2] as usize]);
                let ar = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
                min_area = min_area.min(ar);
                for (p, q) in [(a, b), (b, c), (c, a)] {
                    min_edge = min_edge.min(((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt());
                }
            }
            let ideal = 3f64.sqrt() / 4.0 * m.spacing * m.spacing;
            println!("{deg}°: min area {min_area:.3e} (ideal {ideal:.1}), min edge {min_edge:.3e} (spacing {:.2})", m.spacing);
            assert!(min_area > ideal * 0.01, "sliver at {deg}°");
        }
    }
}

#[cfg(test)]
mod rotated_watertight {
    use super::*;
    use crate::outline::Piece;

    #[test]
    fn rotated_shapes_stay_watertight() {
        for deg in [13.0f64, 30.0, 45.0, 77.7] {
            let (c, s) = (deg.to_radians().cos(), deg.to_radians().sin());
            let p = Piece::new([[-150.0, -112.4], [150.0, -112.4], [150.0, 112.4], [-150.0, 112.4]].iter().map(|[x, y]| [c * x - s * y, s * x + c * y]).collect());
            let m = SheetMesh::from_flat(&triangulate(&[p], 1600.0, 28.0).unwrap());
            let mut uses: BTreeMap<(u32, u32), usize> = BTreeMap::new();
            for t in &m.tris {
                for k in 0..3 {
                    let (a, b) = (t[k], t[(k + 1) % 3]);
                    *uses.entry(if a < b { (a, b) } else { (b, a) }).or_insert(0) += 1;
                }
            }
            for (e, n) in &uses { if *n != 2 { let (a, b) = (m.flat[e.0 as usize], m.flat[e.1 as usize]); println!("{deg}: edge {e:?} used {n} kinds {:?} {:?} pts {a:?} {b:?}", m.kind[e.0 as usize], m.kind[e.1 as usize]); } }
            assert!(uses.values().all(|n| *n == 2), "not watertight at {deg}°");
        }
    }
}
