//! The finisher: solve mesh → smooth render mesh.
//!
//! 1. Mark sharp edges: the weld seam, seam lines, and folds sharper than the
//!    crease angle. These stay crisp.
//! 2. Loop subdivision (1–2 levels) with sharp-edge rules, so curvature gets
//!    smooth but creases don't melt.
//! 3. Taubin smoothing (λ/μ, non-shrinking) on everything except sharp edges.
//! 4. Edge ripples: where the solve shows the sheet squeezed along a weld,
//!    the spare metal is folded into smooth pleats running into the weld —
//!    the ripples real pieces show, which the solve mesh is too coarse to
//!    resolve. Their spacing comes from the sheet thickness (wrinkle
//!    wavelength ≈ √(radius × thickness)); their height from how much metal
//!    has to be taken up (a sine of amplitude A and wavelength λ uses
//!    (πA/λ)² extra length).
//!
//! 5. Weld fillet: the TIG seam round the outline and holes gets a real
//!    rounded edge. The seam itself never moves (the outline stays exactly
//!    where it is): a few thin rows of points are added beside it and lifted
//!    off each sheet so both sheets roll round to meet the weld square-on —
//!    a rounded nose of about the fillet radius, like the fused edge of a TIG
//!    weld. It only ever adds metal. It fades out towards sharp corners of the
//!    outline (tips), where there is no room for it. Internal (laser) welds
//!    stay sharp.
//!
//! 6. Real thickness (`thickness_mm`): the solve is two mid-surfaces with no
//!    thickness, so where the sheets lie flat together (unblown tips) they
//!    read as one paper-thin layer and the seam as a knife edge. Each sheet
//!    is moved out by the sheet thickness (top up, bottom down along its own
//!    normal), the weld line splits into a top and a bottom edge (t above and
//!    below the weld plane, so the outline doesn't move), and a strip 2t high
//!    joins them: the cut edge of the two sheets. Still one closed solid.
//!    Near the seam the push turns gradually from straight up / down (at the
//!    weld) to the sheet's own normal (a band of a few t, or the fillet's
//!    reach): the fillet rows face sideways, and pushing them sideways while
//!    the weld goes up folded the sheet back over the cut edge in a sawtooth.
//!    Where the sheets arrive flat (tips, where the fillet fades out) the cut
//!    edge is a half-round nose instead of a square edge, so the rounded weld
//!    runs right to the tip. The nose stands proud of the outline by up to t
//!    there, like a fused edge (stepping the sheets in to make room instead
//!    puckered the point of sharp tips, where both sides collide).
//!
//! 0. Ridge sharpening (optional, `ridge_sharpness`): the solve puts the
//!    valleys and ridges of geometric pieces in the right places but spreads
//!    each bend over a band of triangles, so it reads as a soft pillow. Long
//!    runs of edges that bend more than their neighbours across the fold are
//!    found on the solve mesh, pinned, and the sheet either side is relaxed
//!    flat (harmonic) so the bend gathers onto the line: flat facets meeting
//!    at a crisp ridge, as real Geometric pieces show. The ridges are then
//!    kept sharp through smoothing and subdivision.
//!
//! Positions are mm. UVs follow the flat cut pattern (new points take the
//! midpoint of their parents' flat positions).

use std::collections::HashMap;

use crate::mesh::{SheetMesh, VertexKind};

#[derive(Clone, Copy, Debug)]
pub struct FinishParams {
    pub levels: u32,
    /// Folds sharper than this (degrees between face normals) stay crisp.
    pub crease_angle_deg: f64,
    pub smooth_iterations: u32,
    /// Smoothing on the coarse solve mesh before subdividing — this is what
    /// removes triangle-sized bumps (smoothing afterwards only reaches a
    /// fraction of a solve triangle). Very sharp folds are protected.
    pub pre_smooth_iterations: u32,
    /// Ripple spacing (mm); 0 turns edge ripples off.
    pub ripple_wavelength_mm: f64,
    /// Ripple strength: 1 = exactly the spare metal measured, 0 = off.
    pub ripple_strength: f64,
    /// Radius of the rounded TIG seam (mm); 0 leaves it knife-sharp.
    pub fillet_radius_mm: f64,
    /// Rows of points across each side of the fillet.
    pub fillet_steps: u32,
    /// The fillet reaches at most this many radii up each sheet.
    pub fillet_max_reach: f64,
    /// Ridge sharpening, 0 (off) to 1 (strong): how wide a band either side
    /// of each detected ridge is flattened onto it.
    pub ridge_sharpness: f64,
    /// A solve edge counts toward a ridge when it bends at least this much
    /// (degrees) and more than its neighbours across the fold.
    pub ridge_min_deg: f64,
    /// Ridges shorter than this (mm, summed along the run) are ignored.
    pub ridge_min_len_mm: f64,
    /// Sheet thickness (mm) given to the render mesh (step 6); 0 = none.
    pub thickness_mm: f64,
}

impl Default for FinishParams {
    fn default() -> Self {
        FinishParams { levels: 1, crease_angle_deg: 50.0, smooth_iterations: 4, pre_smooth_iterations: 8, ripple_wavelength_mm: 0.0, ripple_strength: 0.0, fillet_radius_mm: 0.0, fillet_steps: 5, fillet_max_reach: 3.0, ridge_sharpness: 0.0, ridge_min_deg: 10.0, ridge_min_len_mm: 60.0, thickness_mm: 0.0 }
    }
}

#[derive(Clone, Debug, Default)]
pub struct RenderMesh {
    pub pos: Vec<[f64; 3]>,
    pub flat: Vec<[f64; 2]>,
    pub tris: Vec<[u32; 3]>,
    pub tri_sheet: Vec<u8>,
    pub weld: Vec<bool>,
}

type Key = (u32, u32);

/// f64 with a total order, for the distance queue.
#[derive(PartialEq, PartialOrd)]
struct OrdF(f64);
impl Eq for OrdF {}
impl Ord for OrdF {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

fn key(a: u32, b: u32) -> Key {
    if a < b {
        (a, b)
    } else {
        (b, a)
    }
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn len(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}

fn unit(a: [f64; 3]) -> [f64; 3] {
    let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if l > 0.0 {
        [a[0] / l, a[1] / l, a[2] / l]
    } else {
        a
    }
}

struct EdgeInfo {
    /// (triangle, opposite vertex) for each adjacent triangle.
    faces: Vec<(u32, u32)>,
}

fn edge_map(m: &RenderMesh) -> HashMap<Key, EdgeInfo> {
    let mut edges: HashMap<Key, EdgeInfo> = HashMap::with_capacity(m.tris.len() * 2);
    for (ti, t) in m.tris.iter().enumerate() {
        for k in 0..3 {
            edges
                .entry(key(t[k], t[(k + 1) % 3]))
                .or_insert_with(|| EdgeInfo { faces: Vec::with_capacity(2) })
                .faces
                .push((ti as u32, t[(k + 2) % 3]));
        }
    }
    edges
}

impl RenderMesh {
    pub fn from_sim(mesh: &SheetMesh, pos_mm: &[[f64; 3]]) -> RenderMesh {
        RenderMesh {
            pos: pos_mm.to_vec(),
            flat: mesh.flat.clone(),
            tris: mesh.tris.clone(),
            tri_sheet: mesh.tri_sheet.clone(),
            weld: mesh.kind.iter().map(|k| *k == VertexKind::Weld).collect(),
        }
    }

    fn initial_sharp(&self, crease_angle_deg: f64) -> std::collections::HashSet<Key> {
        let cos_limit = crease_angle_deg.to_radians().cos();
        let normals: Vec<[f64; 3]> = self
            .tris
            .iter()
            .map(|t| unit(cross(sub(self.pos[t[1] as usize], self.pos[t[0] as usize]), sub(self.pos[t[2] as usize], self.pos[t[0] as usize]))))
            .collect();
        edge_map(self)
            .into_iter()
            .filter(|((a, b), e)| {
                if e.faces.len() != 2 {
                    return true; // seam lines (4 faces) or open edges
                }
                let (t1, t2) = (e.faces[0].0 as usize, e.faces[1].0 as usize);
                if self.weld[*a as usize] && self.weld[*b as usize] && self.tri_sheet[t1] != self.tri_sheet[t2] {
                    return true; // the welded edge between the two sheets
                }
                // A fold edge that runs off a weld point is a one-triangle
                // tooth where the sheet squeezes along the weld (a ripple
                // the mesh is too coarse to resolve): smooth it, don't keep it.
                if self.weld[*a as usize] || self.weld[*b as usize] {
                    return false;
                }
                let (n1, n2) = (normals[t1], normals[t2]);
                n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2] < cos_limit
            })
            .map(|(k, _)| k)
            .collect()
    }

    /// Run the whole finisher.
    pub fn finish(&self, p: &FinishParams) -> RenderMesh {
        let mut m = self.clone();
        let ridges = if p.ridge_sharpness > 0.0 {
            let r = m.find_ridges(p.ridge_min_deg, p.ridge_min_len_mm);
            let s = p.ridge_sharpness.clamp(0.0, 1.0);
            m.flatten_beside(&r, 1 + (3.0 * s).round() as u32, (10.0 + 40.0 * s) as u32);
            r
        } else {
            Default::default()
        };
        if p.pre_smooth_iterations > 0 {
            let mut protect = m.initial_sharp((p.crease_angle_deg + 25.0).min(179.0));
            protect.extend(ridges.iter().copied());
            m.taubin(&protect, p.pre_smooth_iterations, None);
            // Beside the welds the sheet dimples one triangle at a time where
            // it is squeezed; smooth that band harder (the ripple layer puts
            // the squeeze back as proper pleats).
            let band = m.weld_band();
            m.taubin(&protect, p.pre_smooth_iterations * 2, Some(&band));
        }
        let mut sharp = m.initial_sharp(p.crease_angle_deg);
        sharp.extend(ridges.iter().copied());
        for _ in 0..p.levels {
            let (next, next_sharp) = m.subdivide(&sharp);
            m = next;
            sharp = next_sharp;
        }
        m.taubin(&sharp, p.smooth_iterations, None);
        if p.ripple_wavelength_mm > 0.0 && p.ripple_strength > 0.0 {
            m.ripple(p.ripple_wavelength_mm, p.ripple_strength);
        }
        if p.fillet_radius_mm > 0.0 && p.fillet_steps > 0 {
            m = m.fillet(p.fillet_radius_mm, p.fillet_steps, p.fillet_max_reach);
        }
        if p.thickness_mm > 0.0 {
            let fillet_band = if p.fillet_radius_mm > 0.0 && p.fillet_steps > 0 { 1.5 * p.fillet_max_reach * p.fillet_radius_mm } else { 0.0 };
            m = m.thicken(p.thickness_mm, fillet_band.max(3.0 * p.thickness_mm));
        }
        m
    }

    /// Step 6 (module notes): the sheets get their real thickness.
    /// `band`: distance (mm, through the sheet) over which the push turns
    /// from straight up / down at the seam to the sheet's normal.
    fn thicken(&self, t: f64, band: f64) -> RenderMesh {
        let n = self.pos.len();
        // Each sheet's outward normal at each point (area-weighted).
        let mut nrm = vec![[[0.0f64; 3]; 2]; n];
        let mut uses = vec![[false; 2]; n];
        for (tri, &s) in self.tris.iter().zip(&self.tri_sheet) {
            let s = (s as usize).min(1);
            let [a, b, c] = tri.map(|v| self.pos[v as usize]);
            let f = cross(sub(b, a), sub(c, a));
            for &v in tri {
                let v = v as usize;
                uses[v][s] = true;
                for k in 0..3 {
                    nrm[v][s][k] += f[k];
                }
            }
        }
        // The seam: welded edges where the top sheet meets the bottom one.
        let edges = edge_map(self);
        let mut keys: Vec<Key> = edges.keys().copied().collect();
        keys.sort_unstable();
        let mut seam = vec![false; n];
        let mut seam_edges = Vec::new();
        for &(a, b) in &keys {
            let e = &edges[&(a, b)];
            if e.faces.len() == 2 && self.weld[a as usize] && self.weld[b as usize] && self.tri_sheet[e.faces[0].0 as usize] != self.tri_sheet[e.faces[1].0 as usize] {
                seam[a as usize] = true;
                seam[b as usize] = true;
                seam_edges.push((a, b));
            }
        }
        // At each seam point: horizontal, straight out of the piece (the
        // average of its seam edges', away from the top sheet), and how much
        // the cut edge is rounded there (`nose`).
        let mut outward = vec![[0.0f64; 3]; n];
        let mut seam_top = Vec::with_capacity(seam_edges.len());
        for &(a, b) in &seam_edges {
            let e = &edges[&(a, b)];
            let top = e.faces.iter().find(|f| self.tri_sheet[f.0 as usize] == 0).copied();
            seam_top.push(top);
            let Some((_, c)) = top else { continue };
            let (pa, pb) = (self.pos[a as usize], self.pos[b as usize]);
            let mut o = unit([pa[1] - pb[1], pb[0] - pa[0], 0.0]);
            if dot(o, sub(self.pos[c as usize], pa)) > 0.0 {
                o = [-o[0], -o[1], 0.0];
            }
            for v in [a as usize, b as usize] {
                for k in 0..2 {
                    outward[v][k] += o[k];
                }
            }
        }
        // Where the fillet has rolled the sheets round to meet the weld
        // square-on, the sheets already arrive upright and the cut edge
        // carries on straight. Where they arrive flat (the tips, where the
        // fillet fades out) the cut edge itself is rounded: a half-round nose
        // of radius up to t standing proud of the outline, so the rounded
        // weld carries on right to the tip.
        let mut nose = vec![0.0f64; n];
        for v in 0..n {
            if !seam[v] {
                continue;
            }
            outward[v] = unit(outward[v]);
            let flat_top = unit(nrm[v][0])[2].max(0.0);
            let flat_bot = (-unit(nrm[v][1])[2]).max(0.0);
            nose[v] = t * (0.5 * (flat_top + flat_bot)).clamp(0.0, 1.0);
        }
        // Distance from the seam through the sheet, out to the band.
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        for &(a, b) in &keys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
        }
        let mut dist = vec![f64::INFINITY; n];
        let mut heap = std::collections::BinaryHeap::new();
        for v in 0..n {
            if seam[v] {
                dist[v] = 0.0;
                heap.push((std::cmp::Reverse(OrdF(0.0)), v));
            }
        }
        while let Some((std::cmp::Reverse(OrdF(d)), v)) = heap.pop() {
            if d > dist[v] {
                continue;
            }
            for &u in &nbrs[v] {
                let u = u as usize;
                let nd = d + len(sub(self.pos[u], self.pos[v]));
                if nd < dist[u] && nd < band {
                    dist[u] = nd;
                    heap.push((std::cmp::Reverse(OrdF(nd)), u));
                }
            }
        }
        // One copy of each point per sheet that uses it, moved out by t.
        let mut out = RenderMesh::default();
        let mut copy = vec![[u32::MAX; 2]; n];
        for v in 0..n {
            for s in 0..2 {
                if !uses[v][s] {
                    continue;
                }
                // On the seam: straight up / down, so the outline stays put;
                // turning to the sheet's own normal across the band.
                let up = if s == 0 { 1.0 } else { -1.0 };
                let f = (dist[v] / band.max(1e-9)).min(1.0);
                let w = f * f * (3.0 - 2.0 * f);
                let u = unit(nrm[v][s]);
                let u = unit([w * u[0], w * u[1], w * u[2] + (1.0 - w) * up]);
                let d = [u[0] * t, u[1] * t, u[2] * t];
                let p = self.pos[v];
                copy[v][s] = out.pos.len() as u32;
                out.pos.push([p[0] + d[0], p[1] + d[1], p[2] + d[2]]);
                out.flat.push(self.flat[v]);
                out.weld.push(self.weld[v]);
            }
        }
        for (tri, &s) in self.tris.iter().zip(&self.tri_sheet) {
            let k = (s as usize).min(1);
            out.tris.push(tri.map(|v| copy[v as usize][k]));
            out.tri_sheet.push(s);
        }
        // The cut edge: rings of points round the nose from the top copy to
        // the bottom one (straight up and down where there is no nose).
        const NOSE_STEPS: usize = 6;
        let mut ring = vec![[u32::MAX; NOSE_STEPS + 1]; n];
        for v in 0..n {
            if !seam[v] || copy[v][0] == u32::MAX || copy[v][1] == u32::MAX {
                continue;
            }
            ring[v][0] = copy[v][0];
            ring[v][NOSE_STEPS] = copy[v][1];
            let (p, o, r) = (self.pos[v], outward[v], nose[v]);
            for i in 1..NOSE_STEPS {
                let phi = std::f64::consts::FRAC_PI_2 - std::f64::consts::PI * i as f64 / NOSE_STEPS as f64;
                let fwd = r * phi.cos();
                ring[v][i] = out.pos.len() as u32;
                out.pos.push([p[0] + o[0] * fwd, p[1] + o[1] * fwd, p[2] + t * phi.sin()]);
                out.flat.push(self.flat[v]);
                out.weld.push(true);
            }
        }
        // Wound against the top sheet's triangle on that edge.
        for (&(a, b), top) in seam_edges.iter().zip(&seam_top) {
            let Some((f, _)) = *top else { continue };
            let tri = self.tris[f as usize];
            let i = tri.iter().position(|&v| v == a).unwrap_or(0);
            // In the top triangle, does the edge run a -> b?
            let forward = tri[(i + 1) % 3] == b;
            let (p, q) = if forward { (b as usize, a as usize) } else { (a as usize, b as usize) };
            if ring[p][0] == u32::MAX || ring[q][0] == u32::MAX {
                continue;
            }
            for i in 0..NOSE_STEPS {
                let (p0, q0, p1, q1) = (ring[p][i], ring[q][i], ring[p][i + 1], ring[q][i + 1]);
                out.tris.push([p0, q0, q1]);
                out.tri_sheet.push(0);
                out.tris.push([p0, q1, p1]);
                out.tri_sheet.push(0);
            }
        }
        out
    }

    /// Ridge lines on this mesh (module notes, step 0): edges inside one
    /// sheet that bend at least `min_deg` and at least as much (same sense)
    /// as the four edges across the fold, in connected runs at least
    /// `min_len` long. Sorted keys, so the result is deterministic.
    fn find_ridges(&self, min_deg: f64, min_len: f64) -> std::collections::HashSet<Key> {
        let normals: Vec<[f64; 3]> = self
            .tris
            .iter()
            .map(|t| unit(cross(sub(self.pos[t[1] as usize], self.pos[t[0] as usize]), sub(self.pos[t[2] as usize], self.pos[t[0] as usize]))))
            .collect();
        let em = edge_map(self);
        let mut keys: Vec<Key> = em.keys().copied().collect();
        keys.sort_unstable();
        // Signed bend per interior edge: + ridge (convex), - valley.
        let mut bend: HashMap<Key, (f64, u32, u32)> = HashMap::with_capacity(keys.len());
        for &k in &keys {
            let e = &em[&k];
            if e.faces.len() != 2 {
                continue;
            }
            let ((t1, c), (t2, d)) = (e.faces[0], e.faces[1]);
            if self.tri_sheet[t1 as usize] != self.tri_sheet[t2 as usize] || (self.weld[k.0 as usize] && self.weld[k.1 as usize]) {
                continue;
            }
            let (n1, n2) = (normals[t1 as usize], normals[t2 as usize]);
            let ang = dot(n1, n2).clamp(-1.0, 1.0).acos().to_degrees();
            let convex = dot(n1, sub(self.pos[d as usize], self.pos[k.0 as usize])) < 0.0;
            bend.insert(k, (if convex { ang } else { -ang }, c, d));
        }
        let mut cand: Vec<Key> = Vec::new();
        for &k in &keys {
            let Some(&(th, c, d)) = bend.get(&k) else { continue };
            if th.abs() < min_deg {
                continue;
            }
            let across = [key(k.0, c), key(k.1, c), key(k.0, d), key(k.1, d)];
            if across.iter().all(|q| bend.get(q).map_or(true, |&(t2, _, _)| t2 * th <= 0.0 || t2.abs() <= th.abs())) {
                cand.push(k);
            }
        }
        // Connected runs (union-find over shared points); keep the long ones.
        let mut parent: Vec<usize> = (0..cand.len()).collect();
        fn find(p: &mut [usize], i: usize) -> usize {
            let mut r = i;
            while p[r] != r {
                r = p[r];
            }
            let mut j = i;
            while p[j] != r {
                let n = p[j];
                p[j] = r;
                j = n;
            }
            r
        }
        let mut by_vert: std::collections::BTreeMap<u32, usize> = std::collections::BTreeMap::new();
        for (i, &(a, b)) in cand.iter().enumerate() {
            for v in [a, b] {
                if self.weld[v as usize] {
                    continue; // runs don't join through the seam
                }
                if let Some(&j) = by_vert.get(&v) {
                    let (ra, rb) = (find(&mut parent, i), find(&mut parent, j));
                    parent[ra] = rb;
                } else {
                    by_vert.insert(v, i);
                }
            }
        }
        let mut length: HashMap<usize, f64> = HashMap::new();
        for (i, &(a, b)) in cand.iter().enumerate() {
            let r = find(&mut parent, i);
            *length.entry(r).or_default() += len(sub(self.pos[a as usize], self.pos[b as usize]));
        }
        (0..cand.len()).filter(|&i| length[&find(&mut parent, i)] >= min_len).map(|i| cand[i]).collect()
    }

    /// Relax the points within `rings` hops of the ridges flat (plain
    /// Laplacian; ridge points, welds and the band's outside held), so the
    /// bend gathers onto the ridge lines.
    fn flatten_beside(&mut self, ridges: &std::collections::HashSet<Key>, rings: u32, iterations: u32) {
        if ridges.is_empty() || rings == 0 || iterations == 0 {
            return;
        }
        let n = self.pos.len();
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut keys: Vec<Key> = edge_map(self).keys().copied().collect();
        keys.sort_unstable();
        for (a, b) in keys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
        }
        let mut hops = vec![u32::MAX; n];
        let mut queue = std::collections::VecDeque::new();
        let mut rv: Vec<u32> = ridges.iter().flat_map(|&(a, b)| [a, b]).collect();
        rv.sort_unstable();
        rv.dedup();
        for v in rv {
            hops[v as usize] = 0;
            queue.push_back(v as usize);
        }
        while let Some(v) = queue.pop_front() {
            if hops[v] >= rings {
                continue;
            }
            for &u in &nbrs[v] {
                if hops[u as usize] == u32::MAX {
                    hops[u as usize] = hops[v] + 1;
                    queue.push_back(u as usize);
                }
            }
        }
        let free: Vec<bool> = (0..n).map(|v| hops[v] >= 1 && hops[v] <= rings && !self.weld[v]).collect();
        let mut tmp = self.pos.clone();
        for _ in 0..iterations {
            for v in 0..n {
                if !free[v] {
                    tmp[v] = self.pos[v];
                    continue;
                }
                let mut avg = [0.0; 3];
                for &u in &nbrs[v] {
                    for i in 0..3 {
                        avg[i] += self.pos[u as usize][i];
                    }
                }
                let k = nbrs[v].len() as f64;
                for i in 0..3 {
                    tmp[v][i] = avg[i] / k;
                }
            }
            std::mem::swap(&mut self.pos, &mut tmp);
        }
    }

    /// Round the TIG seam (see the module notes). Returns the refined mesh.
    fn fillet(&self, radius: f64, steps: u32, max_reach: f64) -> RenderMesh {
        let n = self.pos.len();
        let edges = edge_map(self);
        let mut keys: Vec<Key> = edges.keys().copied().collect();
        keys.sort_unstable();

        // The seam: welded edges where the top sheet meets the bottom one.
        let mut seam = vec![false; n];
        let mut seam_nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut seam_edges: Vec<Key> = Vec::new();
        for &(a, b) in &keys {
            let e = &edges[&(a, b)];
            if e.faces.len() == 2
                && self.weld[a as usize]
                && self.weld[b as usize]
                && self.tri_sheet[e.faces[0].0 as usize] != self.tri_sheet[e.faces[1].0 as usize]
            {
                seam[a as usize] = true;
                seam[b as usize] = true;
                seam_nbrs[a as usize].push(b);
                seam_nbrs[b as usize].push(a);
                seam_edges.push((a, b));
            }
        }
        if seam_edges.is_empty() {
            return self.clone();
        }
        // Which sheet each point lies on (2 = both, e.g. internal welds).
        let mut sheet = vec![255u8; n];
        for (t, &s) in self.tris.iter().zip(&self.tri_sheet) {
            for &v in t {
                let v = v as usize;
                sheet[v] = if sheet[v] == 255 || sheet[v] == s { s } else { 2 };
            }
        }

        // At each seam point, each sheet's direction straight away from the
        // seam (in the sheet, square to the seam).
        let mut tangent = vec![[[0.0; 3]; 2]; n];
        let mut along = vec![[0.0; 3]; n];
        for v in 0..n {
            if !seam[v] {
                continue;
            }
            let s = &seam_nbrs[v];
            along[v] = match s.len() {
                1 => unit(sub(self.pos[s[0] as usize], self.pos[v])),
                2 => unit(sub(self.pos[s[1] as usize], self.pos[s[0] as usize])),
                _ => continue, // junction: no single direction
            };
        }
        for (t, &s) in self.tris.iter().zip(&self.tri_sheet) {
            for k in 0..3 {
                let v = t[k] as usize;
                if !seam[v] || along[v] == [0.0; 3] {
                    continue;
                }
                let e = along[v];
                for x in [t[(k + 1) % 3] as usize, t[(k + 2) % 3] as usize] {
                    if seam[x] || self.weld[x] {
                        continue;
                    }
                    let w = sub(self.pos[x], self.pos[v]);
                    let d = dot(w, e);
                    let w = unit([w[0] - d * e[0], w[1] - d * e[1], w[2] - d * e[2]]);
                    for i in 0..3 {
                        tangent[v][s as usize][i] += w[i];
                    }
                }
            }
        }
        for v in 0..n {
            for s in 0..2 {
                tangent[v][s] = unit(tangent[v][s]);
            }
        }
        let has_tangents = |v: usize| tangent[v][0] != [0.0; 3] && tangent[v][1] != [0.0; 3];
        // How far up each sheet the fillet reaches at a seam point: chosen so
        // the nose at the weld has the fillet radius (see `bead`).
        let reach = |t0: [f64; 3], t1: [f64; 3]| -> f64 {
            let th = dot(t0, t1).clamp(-1.0, 1.0).acos();
            if !(0.05..std::f64::consts::PI - 0.05).contains(&th) {
                return 0.0;
            }
            let half = 0.5 * th;
            (6.0 * radius * half.cos() * half.sin().powi(2)).min(max_reach * radius)
        };
        // Fade out towards sharp corners of the outline (and weld junctions):
        // 0 at the corner, full strength a few radii along the seam.
        let corner: Vec<usize> = (0..n)
            .filter(|&v| {
                if !seam[v] {
                    return false;
                }
                let s = &seam_nbrs[v];
                if s.len() != 2 || self.weld_junction(v) {
                    return true;
                }
                let (p, a, b) = (self.flat[v], self.flat[s[0] as usize], self.flat[s[1] as usize]);
                let (u, w) = ([p[0] - a[0], p[1] - a[1]], [b[0] - p[0], b[1] - p[1]]);
                let c = (u[0] * w[0] + u[1] * w[1]) / (u[0].hypot(u[1]) * w[0].hypot(w[1])).max(1e-18);
                c < 35f64.to_radians().cos()
            })
            .collect();
        let fade_len = 5.0 * radius;
        let fade: Vec<f64> = (0..n)
            .map(|v| {
                if !seam[v] {
                    return 0.0;
                }
                let p = self.flat[v];
                let d = corner.iter().map(|&c| (self.flat[c][0] - p[0]).hypot(self.flat[c][1] - p[1])).fold(f64::INFINITY, f64::min);
                let t = (d / fade_len).min(1.0);
                t * t * (3.0 - 2.0 * t)
            })
            .collect();

        // Rows of new points on every edge running off the seam.
        let mut out = RenderMesh { pos: self.pos.clone(), flat: self.flat.clone(), tris: Vec::new(), tri_sheet: Vec::new(), weld: self.weld.clone() };
        let mut chain: HashMap<Key, Vec<u32>> = HashMap::new(); // ordered from the seam end
        for &(a, b) in &keys {
            let (w, v) = match (seam[a as usize], seam[b as usize]) {
                (true, false) => (a as usize, b as usize),
                (false, true) => (b as usize, a as usize),
                _ => continue,
            };
            if self.weld[v] || sheet[v] > 1 || !has_tangents(w) {
                continue;
            }
            let s = reach(tangent[w][0], tangent[w][1]) * fade[w].sqrt();
            let off = sub(self.pos[v], self.pos[w]);
            let d = dot(off, along[w]);
            let h = (dot(off, off) - d * d).max(0.0).sqrt();
            let dmax = s.min(0.85 * h);
            if dmax <= 1e-6 {
                continue;
            }
            let mut ids = Vec::with_capacity(steps as usize);
            for i in 1..=steps {
                let f = dmax * i as f64 / steps as f64 / h;
                let (pw, pv, fw, fv) = (self.pos[w], self.pos[v], self.flat[w], self.flat[v]);
                ids.push(out.pos.len() as u32);
                out.pos.push([pw[0] + f * (pv[0] - pw[0]), pw[1] + f * (pv[1] - pw[1]), pw[2] + f * (pv[2] - pw[2])]);
                out.flat.push([fw[0] + f * (fv[0] - fw[0]), fw[1] + f * (fv[1] - fw[1])]);
                out.weld.push(false);
            }
            chain.insert((a, b), ids);
        }
        // Points strictly between a and b, in order from a.
        let between = |a: u32, b: u32| -> Option<Vec<u32>> {
            let c = chain.get(&key(a, b))?;
            Some(if seam[a as usize] { c.clone() } else { c.iter().rev().copied().collect() })
        };

        // Re-triangulate the triangles beside the seam (winding kept).
        for (t, &s) in self.tris.iter().zip(&self.tri_sheet) {
            let mut push = |tri: [u32; 3]| {
                out.tris.push(tri);
                out.tri_sheet.push(s);
            };
            let c = [0, 1, 2].map(|k| chain.contains_key(&key(t[k], t[(k + 1) % 3])));
            match c.iter().filter(|x| **x).count() {
                1 => {
                    let k = c.iter().position(|x| *x).unwrap();
                    let (a, b, opp) = (t[k], t[(k + 1) % 3], t[(k + 2) % 3]);
                    let mut q = vec![a];
                    q.extend(between(a, b).unwrap());
                    q.push(b);
                    for i in 0..q.len() - 1 {
                        push([opp, q[i], q[i + 1]]);
                    }
                }
                2 => {
                    // X: the corner both chained edges share.
                    let k = c.iter().position(|x| !*x).unwrap(); // unchained edge t[k]→t[k+1]
                    let (x, y, z) = (t[(k + 2) % 3], t[k], t[(k + 1) % 3]);
                    if seam[x as usize] {
                        let (cy, cz) = (between(x, y).unwrap(), between(x, z).unwrap());
                        let m = cy.len();
                        push([x, cy[0], cz[0]]);
                        for i in 0..m - 1 {
                            push([cy[i], cy[i + 1], cz[i + 1]]);
                            push([cy[i], cz[i + 1], cz[i]]);
                        }
                        push([cy[m - 1], y, z]);
                        push([cy[m - 1], z, cz[m - 1]]);
                    } else {
                        let (cy, cz) = (between(y, x).unwrap(), between(z, x).unwrap());
                        let m = cy.len();
                        push([y, z, cz[0]]);
                        push([y, cz[0], cy[0]]);
                        for i in 0..m - 1 {
                            push([cy[i], cz[i], cz[i + 1]]);
                            push([cy[i], cz[i + 1], cy[i + 1]]);
                        }
                        push([cy[m - 1], cz[m - 1], x]);
                    }
                }
                _ => push(*t),
            }
        }

        // Nearest seam point for every point near the seam (through the sheet).
        let m = out.pos.len();
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); m];
        let mut okeys: Vec<Key> = edge_map(&out).keys().copied().collect();
        okeys.sort_unstable();
        for &(a, b) in &okeys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
        }
        let limit = 1.5 * max_reach * radius;
        let mut dist = vec![f64::INFINITY; m];
        let mut src = vec![u32::MAX; m];
        let mut heap = std::collections::BinaryHeap::new();
        for v in 0..n {
            if seam[v] {
                dist[v] = 0.0;
                src[v] = v as u32;
                heap.push((std::cmp::Reverse(OrdF(0.0)), v));
            }
        }
        while let Some((std::cmp::Reverse(OrdF(d)), v)) = heap.pop() {
            if d > dist[v] {
                continue;
            }
            for &u in &nbrs[v] {
                let u = u as usize;
                let nd = d + len(sub(out.pos[u], out.pos[v]));
                if nd < dist[u] && nd < limit {
                    dist[u] = nd;
                    src[u] = src[v];
                    heap.push((std::cmp::Reverse(OrdF(nd)), u));
                }
            }
        }
        let mut osheet = vec![255u8; m];
        for (t, &s) in out.tris.iter().zip(&out.tri_sheet) {
            for &v in t {
                let v = v as usize;
                osheet[v] = if osheet[v] == 255 || osheet[v] == s { s } else { 2 };
            }
        }

        // Lift a point at distance d from the seam off its sheet, along the
        // sheet's outward normal, by h(d) = cot(θ/2)·d·(1 − d/s)³: zero at the
        // weld (which stays put) and at the reach s, rising so that right at
        // the weld the sheet has turned to meet it square-on. In the plane
        // across the seam the nose then has radius s / (6 cos sin²(θ/2)),
        // which `reach` sets to the fillet radius. Nothing goes past the weld.
        let bead = |t_own: [f64; 3], t_oth: [f64; 3], d: f64, strength: f64| -> Option<[f64; 3]> {
            let s = reach(t_own, t_oth) * strength.sqrt();
            if s <= 0.0 || d >= s {
                return None;
            }
            let half = 0.5 * dot(t_own, t_oth).clamp(-1.0, 1.0).acos();
            let b = unit([t_own[0] + t_oth[0], t_own[1] + t_oth[1], t_own[2] + t_oth[2]]);
            let c = dot(b, t_own);
            let nrm = unit([c * t_own[0] - b[0], c * t_own[1] - b[1], c * t_own[2] - b[2]]);
            let h = strength * d * (1.0 - d / s).powi(3) / half.tan();
            Some([h * nrm[0], h * nrm[1], h * nrm[2]])
        };
        let lerp = |a: [f64; 3], b: [f64; 3], u: f64| unit([a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1]), a[2] + u * (b[2] - a[2])]);
        let mut offset = vec![[0.0; 3]; m];
        for v in 0..m {
            if v < n && seam[v] {
                continue; // the weld stays exactly where it is
            }
            let k = osheet[v];
            if src[v] == u32::MAX || k > 1 || out.weld[v] {
                continue;
            }
            // Closest point on the seam edges round the nearest seam point.
            let w = src[v] as usize;
            let p = out.pos[v];
            let mut best: Option<(f64, [f64; 3], usize, usize, f64)> = None;
            for &u in &seam_nbrs[w] {
                let (a, b) = (w, u as usize);
                let ab = sub(out.pos[b], out.pos[a]);
                let t = (dot(sub(p, out.pos[a]), ab) / dot(ab, ab).max(1e-18)).clamp(0.0, 1.0);
                let q = [out.pos[a][0] + t * ab[0], out.pos[a][1] + t * ab[1], out.pos[a][2] + t * ab[2]];
                let d = len(sub(p, q));
                if best.is_none_or(|b| d < b.0) {
                    best = Some((d, q, a, b, t));
                }
            }
            let Some((d, _q, a, b, t)) = best else { continue };
            if !has_tangents(a) || !has_tangents(b) {
                continue;
            }
            let k = k as usize;
            let t_own = lerp(tangent[a][k], tangent[b][k], t);
            let t_oth = lerp(tangent[a][1 - k], tangent[b][1 - k], t);
            if let Some(o) = bead(t_own, t_oth, d, fade[a] + t * (fade[b] - fade[a])) {
                offset[v] = o;
            }
        }
        for v in 0..m {
            for i in 0..3 {
                out.pos[v][i] += offset[v][i];
            }
        }
        out
    }

    /// A weld point with a welded edge running off the seam (where an
    /// internal weld meets the outline).
    fn weld_junction(&self, v: usize) -> bool {
        self.tris.iter().any(|t| {
            t.contains(&(v as u32))
                && t.iter().filter(|&&u| u as usize != v && self.weld[u as usize]).count() == 2
                && t.iter().all(|&u| self.weld[u as usize])
        })
    }

    /// Points on or next to a weld.
    fn weld_band(&self) -> Vec<bool> {
        let mut band = self.weld.clone();
        for t in &self.tris {
            if t.iter().any(|&v| self.weld[v as usize]) {
                for &v in t {
                    band[v as usize] = true;
                }
            }
        }
        band
    }

    /// Fold the spare metal along welds into pleats (see the module notes).
    fn ripple(&mut self, wavelength: f64, strength: f64) {
        let n = self.pos.len();
        let mut keys: Vec<Key> = edge_map(self).keys().copied().collect();
        keys.sort_unstable();
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        for &(a, b) in &keys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
        }
        let fdist = |a: usize, b: usize| (self.flat[a][0] - self.flat[b][0]).hypot(self.flat[a][1] - self.flat[b][1]);

        // Arc length along each weld (and its direction in the flat pattern).
        let mut s_along = vec![f64::NAN; n];
        let mut tangent = vec![[1.0, 0.0]; n];
        for start in 0..n {
            if !self.weld[start] || !s_along[start].is_nan() {
                continue;
            }
            s_along[start] = 0.0;
            let mut stack = vec![start];
            while let Some(v) = stack.pop() {
                for &u in &nbrs[v] {
                    let u = u as usize;
                    if self.weld[u] && s_along[u].is_nan() {
                        let l = fdist(v, u);
                        s_along[u] = s_along[v] + l;
                        let d = [(self.flat[u][0] - self.flat[v][0]) / l.max(1e-12), (self.flat[u][1] - self.flat[v][1]) / l.max(1e-12)];
                        tangent[u] = d;
                        if tangent[v] == [1.0, 0.0] && s_along[v] == 0.0 {
                            tangent[v] = d;
                        }
                        stack.push(u);
                    }
                }
            }
        }

        // Distance to (and nearest point on) the welds, through the sheet.
        let mut dist = vec![f64::INFINITY; n];
        let mut src = vec![u32::MAX; n];
        let mut heap = std::collections::BinaryHeap::new();
        for v in 0..n {
            if self.weld[v] {
                dist[v] = 0.0;
                src[v] = v as u32;
                heap.push((std::cmp::Reverse(OrdF(0.0)), v));
            }
        }
        while let Some((std::cmp::Reverse(OrdF(d)), v)) = heap.pop() {
            if d > dist[v] {
                continue;
            }
            for &u in &nbrs[v] {
                let u = u as usize;
                let nd = d + fdist(v, u);
                if nd < dist[u] {
                    dist[u] = nd;
                    src[u] = src[v];
                    heap.push((std::cmp::Reverse(OrdF(nd)), u));
                }
            }
        }

        // Squeeze along the weld direction, per triangle → per point.
        let mut squeeze = vec![0.0; n];
        let mut count = vec![0.0; n];
        for t in &self.tris {
            let [a, b, c] = t.map(|v| v as usize);
            if src[a] == u32::MAX {
                continue;
            }
            let tg = tangent[src[a] as usize];
            let (f0, f1, f2) = (self.flat[a], self.flat[b], self.flat[c]);
            let (u1, u2) = ([f1[0] - f0[0], f1[1] - f0[1]], [f2[0] - f0[0], f2[1] - f0[1]]);
            let det = u1[0] * u2[1] - u1[1] * u2[0];
            if det.abs() < 1e-12 {
                continue;
            }
            // Flat-direction weights: tg = α·u1 + β·u2.
            let al = (tg[0] * u2[1] - tg[1] * u2[0]) / det;
            let be = (u1[0] * tg[1] - u1[1] * tg[0]) / det;
            let (p0, p1, p2) = (self.pos[a], self.pos[b], self.pos[c]);
            let mut g = [0.0; 3];
            for i in 0..3 {
                g[i] = al * (p1[i] - p0[i]) + be * (p2[i] - p0[i]);
            }
            let stretch = (g[0] * g[0] + g[1] * g[1] + g[2] * g[2]).sqrt();
            let e = (1.0 - stretch).max(0.0);
            for v in [a, b, c] {
                squeeze[v] += e;
                count[v] += 1.0;
            }
        }
        for v in 0..n {
            if count[v] > 0.0 {
                squeeze[v] /= count[v];
            }
        }
        // Even it out a little: pleats run in bands, not per triangle.
        for _ in 0..6 {
            let prev = squeeze.clone();
            for v in 0..n {
                if nbrs[v].is_empty() {
                    continue;
                }
                let avg: f64 = nbrs[v].iter().map(|&u| prev[u as usize]).sum::<f64>() / nbrs[v].len() as f64;
                squeeze[v] = 0.5 * prev[v] + 0.5 * avg;
            }
        }

        // Outward normals.
        let mut normal = vec![[0.0; 3]; n];
        for t in &self.tris {
            let [a, b, c] = t.map(|v| v as usize);
            let nf = cross(sub(self.pos[b], self.pos[a]), sub(self.pos[c], self.pos[a]));
            for v in [a, b, c] {
                for i in 0..3 {
                    normal[v][i] += nf[i];
                }
            }
        }

        // Where welds meet, pleats from different welds would collide — fade
        // them out around junctions (and weld ends).
        let junctions: Vec<[f64; 2]> = (0..n)
            .filter(|&v| self.weld[v] && nbrs[v].iter().filter(|&&u| self.weld[u as usize]).count() != 2)
            .map(|v| self.flat[v])
            .collect();
        let tau = std::f64::consts::TAU;
        for v in 0..n {
            if self.weld[v] || src[v] == u32::MAX || !dist[v].is_finite() {
                continue;
            }
            let d = dist[v];
            if d > 2.0 * wavelength {
                continue;
            }
            let amp = (strength * wavelength / std::f64::consts::PI * squeeze[v].sqrt()).min(0.1 * wavelength);
            // Zero at the weld (it is welded flat), strongest a little way
            // in, gone within about a wavelength.
            let across = (1.0 - (-d / (0.25 * wavelength)).exp()) * (-d / (0.6 * wavelength)).exp();
            let fv = self.flat[v];
            let jd = junctions.iter().map(|j| (j[0] - fv[0]).hypot(j[1] - fv[1])).fold(f64::INFINITY, f64::min);
            let t = (jd / (1.5 * wavelength)).min(1.0);
            let near_junction = t * t * (3.0 - 2.0 * t);
            let across = across * near_junction;
            let s = s_along[src[v] as usize];
            let h = amp * across * (tau * s / wavelength).sin();
            let nv = unit(normal[v]);
            for i in 0..3 {
                self.pos[v][i] += h * nv[i];
            }
        }
    }

    /// One level of Loop subdivision honouring sharp edges.
    fn subdivide(&self, sharp: &std::collections::HashSet<Key>) -> (RenderMesh, std::collections::HashSet<Key>) {
        let n = self.pos.len();
        let edges = edge_map(self);
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut sharp_nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut keys: Vec<Key> = edges.keys().copied().collect();
        keys.sort_unstable();
        for &(a, b) in &keys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
            if sharp.contains(&(a, b)) {
                sharp_nbrs[a as usize].push(b);
                sharp_nbrs[b as usize].push(a);
            }
        }

        let mut out = RenderMesh::default();
        // Old vertices, repositioned.
        for v in 0..n {
            let p = self.pos[v];
            let s = &sharp_nbrs[v];
            let np = match s.len() {
                0 | 1 => {
                    let k = nbrs[v].len() as f64;
                    if k < 3.0 {
                        p
                    } else {
                        let c = 3.0 / 8.0 + 0.25 * (2.0 * std::f64::consts::PI / k).cos();
                        let beta = (5.0 / 8.0 - c * c) / k;
                        let mut q = [p[0] * (1.0 - k * beta), p[1] * (1.0 - k * beta), p[2] * (1.0 - k * beta)];
                        for &u in &nbrs[v] {
                            let r = self.pos[u as usize];
                            for i in 0..3 {
                                q[i] += beta * r[i];
                            }
                        }
                        q
                    }
                }
                2 => {
                    let (a, b) = (self.pos[s[0] as usize], self.pos[s[1] as usize]);
                    [0.75 * p[0] + 0.125 * (a[0] + b[0]), 0.75 * p[1] + 0.125 * (a[1] + b[1]), 0.75 * p[2] + 0.125 * (a[2] + b[2])]
                }
                _ => p, // corner: stays put
            };
            out.pos.push(np);
            out.flat.push(self.flat[v]);
            out.weld.push(self.weld[v]);
        }
        // New edge vertices.
        let mut mid: HashMap<Key, u32> = HashMap::with_capacity(keys.len());
        for &(a, b) in &keys {
            let e = &edges[&(a, b)];
            let (pa, pb) = (self.pos[a as usize], self.pos[b as usize]);
            let p = if sharp.contains(&(a, b)) || e.faces.len() != 2 {
                [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5]
            } else {
                let (c, d) = (self.pos[e.faces[0].1 as usize], self.pos[e.faces[1].1 as usize]);
                let mut q = [0.0; 3];
                for i in 0..3 {
                    q[i] = 0.375 * (pa[i] + pb[i]) + 0.125 * (c[i] + d[i]);
                }
                q
            };
            let (fa, fb) = (self.flat[a as usize], self.flat[b as usize]);
            mid.insert((a, b), out.pos.len() as u32);
            out.pos.push(p);
            out.flat.push([(fa[0] + fb[0]) * 0.5, (fa[1] + fb[1]) * 0.5]);
            out.weld.push(self.weld[a as usize] && self.weld[b as usize] && sharp.contains(&(a, b)));
        }
        // Four triangles per triangle.
        for (t, s) in self.tris.iter().zip(&self.tri_sheet) {
            let ab = mid[&key(t[0], t[1])];
            let bc = mid[&key(t[1], t[2])];
            let ca = mid[&key(t[2], t[0])];
            for tri in [[t[0], ab, ca], [ab, t[1], bc], [ca, bc, t[2]], [ab, bc, ca]] {
                out.tris.push(tri);
                out.tri_sheet.push(*s);
            }
        }
        let mut next_sharp = std::collections::HashSet::with_capacity(sharp.len() * 2);
        for &(a, b) in sharp {
            if let Some(&m) = mid.get(&(a, b)) {
                next_sharp.insert(key(a, m));
                next_sharp.insert(key(m, b));
            }
        }
        (out, next_sharp)
    }

    /// Taubin λ|μ smoothing: removes faceting without shrinking the form.
    /// Points on a sharp edge are smoothed only *along* it (so a crease or the
    /// weld seam stays sharp but runs cleanly); where sharp edges meet, the
    /// point stays put.
    fn taubin(&mut self, sharp: &std::collections::HashSet<Key>, iterations: u32, only: Option<&[bool]>) {
        if iterations == 0 {
            return;
        }
        let n = self.pos.len();
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut sharp_nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        let mut keys: Vec<Key> = edge_map(self).keys().copied().collect();
        keys.sort_unstable();
        for (a, b) in keys {
            nbrs[a as usize].push(b);
            nbrs[b as usize].push(a);
            if sharp.contains(&(a, b)) {
                sharp_nbrs[a as usize].push(b);
                sharp_nbrs[b as usize].push(a);
            }
        }
        // Which neighbours each point averages over (empty = fixed).
        let ring: Vec<&[u32]> = (0..n)
            .map(|v| match sharp_nbrs[v].len() {
                _ if only.is_some_and(|o| !o[v]) => &[][..],
                0 => nbrs[v].as_slice(),
                2 => sharp_nbrs[v].as_slice(),
                _ => &[][..],
            })
            .collect();
        let (lambda, mu) = (0.5, -0.53);
        let mut tmp = self.pos.clone();
        for _ in 0..iterations {
            for f in [lambda, mu] {
                for v in 0..n {
                    let r = ring[v];
                    if r.is_empty() {
                        tmp[v] = self.pos[v];
                        continue;
                    }
                    let mut avg = [0.0; 3];
                    for &u in r {
                        let q = self.pos[u as usize];
                        for i in 0..3 {
                            avg[i] += q[i];
                        }
                    }
                    let k = r.len() as f64;
                    let p = self.pos[v];
                    for i in 0..3 {
                        tmp[v][i] = p[i] + f * (avg[i] / k - p[i]);
                    }
                    if self.weld[v] {
                        tmp[v][2] = p[2]; // the weld stays on its plane
                    }
                }
                std::mem::swap(&mut self.pos, &mut tmp);
            }
        }
    }

    /// Duplicate the points shared by both sheets so each sheet gets its own
    /// normals (a crisp weld seam). Returns the split mesh and, for every new
    /// point, the index of the original (watertight) point.
    pub fn split_sheets(&self) -> (RenderMesh, Vec<u32>) {
        let mut out = RenderMesh::default();
        let mut origin = Vec::new();
        let mut map: HashMap<(u32, u8), u32> = HashMap::new();
        // Top triangles first, then bottom, so each sheet is one contiguous range.
        for sheet in 0..2u8 {
            for (t, s) in self.tris.iter().zip(&self.tri_sheet) {
                if *s != sheet {
                    continue;
                }
                let tri = t.map(|v| {
                    *map.entry((v, sheet)).or_insert_with(|| {
                        let id = out.pos.len() as u32;
                        out.pos.push(self.pos[v as usize]);
                        out.flat.push(self.flat[v as usize]);
                        out.weld.push(self.weld[v as usize]);
                        origin.push(v);
                        id
                    })
                });
                out.tris.push(tri);
                out.tri_sheet.push(sheet);
            }
        }
        (out, origin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::{triangulate, SheetMesh};
    use crate::settings::SimSettings;
    use crate::shapes;
    use crate::solver::Sim;

    fn inflated() -> (SheetMesh, Vec<[f64; 3]>) {
        let mut sim = Sim::new(&[shapes::circle(200.0)], SimSettings::default()).unwrap();
        for _ in 0..30 {
            sim.step_frame();
        }
        let pos = sim.positions_f64_mm();
        (sim.mesh, pos)
    }

    #[test]
    fn subdivision_quadruples_triangles_and_stays_closed() {
        let (mesh, pos) = inflated();
        let r = RenderMesh::from_sim(&mesh, &pos);
        let f = r.finish(&FinishParams { levels: 1, ..Default::default() });
        assert_eq!(f.tris.len(), r.tris.len() * 4);
        let edges = edge_map(&f);
        assert!(edges.values().all(|e| e.faces.len() == 2), "render mesh is not watertight");
        assert!(f.pos.iter().all(|p| p.iter().all(|x| x.is_finite())));
    }

    #[test]
    fn weld_seam_stays_on_the_weld_plane() {
        let (mesh, pos) = inflated();
        let f = RenderMesh::from_sim(&mesh, &pos).finish(&FinishParams { levels: 2, ..Default::default() });
        for (p, w) in f.pos.iter().zip(&f.weld) {
            if *w {
                assert!(p[2].abs() < 1e-9, "weld point lifted to z={}", p[2]);
            }
        }
    }

    #[test]
    fn taubin_does_not_shrink_a_dome_much() {
        let (mesh, pos) = inflated();
        let r = RenderMesh::from_sim(&mesh, &pos);
        let h0 = r.pos.iter().map(|p| p[2]).fold(f64::MIN, f64::max);
        let f = r.finish(&FinishParams { levels: 1, smooth_iterations: 10, pre_smooth_iterations: 10, ..Default::default() });
        let h1 = f.pos.iter().map(|p| p[2]).fold(f64::MIN, f64::max);
        assert!((h1 - h0).abs() / h0 < 0.05, "height changed from {h0} to {h1}");
    }

    /// Largest angle between the two sheets' triangles across the seam.
    fn seam_crease_deg(m: &RenderMesh) -> f64 {
        let normal = |t: [u32; 3]| unit(cross(sub(m.pos[t[1] as usize], m.pos[t[0] as usize]), sub(m.pos[t[2] as usize], m.pos[t[0] as usize])));
        edge_map(m)
            .into_iter()
            .filter(|((a, b), e)| e.faces.len() == 2 && m.weld[*a as usize] && m.weld[*b as usize] && m.tri_sheet[e.faces[0].0 as usize] != m.tri_sheet[e.faces[1].0 as usize])
            .map(|(_, e)| dot(normal(m.tris[e.faces[0].0 as usize]), normal(m.tris[e.faces[1].0 as usize])).clamp(-1.0, 1.0).acos().to_degrees())
            .fold(0.0, f64::max)
    }

    #[test]
    fn fillet_rounds_the_seam_and_stays_closed() {
        let (mesh, pos) = inflated();
        let r = RenderMesh::from_sim(&mesh, &pos);
        let sharp = r.finish(&FinishParams { levels: 1, ..Default::default() });
        let round = r.finish(&FinishParams { levels: 1, fillet_radius_mm: 3.0, ..Default::default() });
        assert!(round.tris.len() > sharp.tris.len());
        assert!(edge_map(&round).values().all(|e| e.faces.len() == 2), "filleted mesh is not watertight");
        assert!(round.pos.iter().all(|p| p.iter().all(|x| x.is_finite())));
        let (a, b) = (seam_crease_deg(&sharp), seam_crease_deg(&round));
        assert!(b < 0.5 * a, "seam crease {a:.0}° only went to {b:.0}°");
        // The weld stays exactly where it was, and nothing reaches past it.
        let rmax = |m: &RenderMesh| m.pos.iter().map(|p| p[0].hypot(p[1])).fold(0.0, f64::max);
        for v in 0..sharp.pos.len() {
            if sharp.weld[v] {
                let (p, q) = (sharp.pos[v], round.pos[v]);
                assert!(len(sub(p, q)) < 1e-9, "weld point moved");
            }
        }
        assert!(rmax(&round) <= rmax(&sharp) + 1e-6, "fillet pushed past the outline");
    }

    #[test]
    fn thickness_keeps_a_closed_solid_and_the_outline() {
        let (mesh, pos) = inflated();
        let r = RenderMesh::from_sim(&mesh, &pos);
        let thin = r.finish(&FinishParams { levels: 1, fillet_radius_mm: 3.0, ..Default::default() });
        let thick = r.finish(&FinishParams { levels: 1, fillet_radius_mm: 3.0, thickness_mm: 0.5, ..Default::default() });
        assert!(edge_map(&thick).values().all(|e| e.faces.len() == 2), "thick mesh is not watertight");
        // Consistent winding: every edge used once in each direction.
        let mut dir = std::collections::HashSet::new();
        for t in &thick.tris {
            for k in 0..3 {
                assert!(dir.insert((t[k], t[(k + 1) % 3])), "two triangles run the same way along an edge");
            }
        }
        // The outline stays where it was (seam copies only move up / down).
        let rmax = |m: &RenderMesh| m.pos.iter().map(|p| p[0].hypot(p[1])).fold(0.0, f64::max);
        assert!((rmax(&thick) - rmax(&thin)).abs() < 0.6, "outline moved: {} vs {}", rmax(&thick), rmax(&thin));
        // The seam edge is 2t high.
        let zs: Vec<f64> = thick.pos.iter().zip(&thick.weld).filter(|(_, w)| **w).map(|(p, _)| p[2]).collect();
        assert!(zs.iter().any(|z| (z - 0.5).abs() < 1e-9) && zs.iter().any(|z| (z + 0.5).abs() < 1e-9));
    }

    #[test]
    fn split_sheets_duplicates_only_welds() {
        let flat = triangulate(&[shapes::square(100.0)], 300.0, 28.0).unwrap();
        let mesh = SheetMesh::from_flat(&flat);
        let pos: Vec<[f64; 3]> = mesh.flat.iter().map(|p| [p[0], p[1], 0.0]).collect();
        let r = RenderMesh::from_sim(&mesh, &pos);
        let (s, origin) = r.split_sheets();
        let welds = r.weld.iter().filter(|w| **w).count();
        assert_eq!(s.pos.len(), r.pos.len() + welds);
        assert_eq!(origin.len(), s.pos.len());
    }
}
