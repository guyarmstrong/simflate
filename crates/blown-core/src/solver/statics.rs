//! Core B: quasi-static Newton solver (`Tuning::core` = 1).
//!
//! The XPBD core (core 0) restarts every constraint force from zero each
//! substep and gets one pass, so the sheet behaves ~25× softer in-plane than
//! the steel it is given (tuning log, session 8): it can stretch and squash
//! into a smooth dome instead of folding. Real 1 mm steel on a 300 mm piece
//! is paper-like — it bends easily but barely stretches, so it must facet and
//! ridge.
//!
//! This core finds the resting shape directly each frame: the pressure is
//! stepped up, then the total energy
//!
//!   E(x) = Σ ½k(l − r)²  +  Σ ½k_b(θ − θ₀)²  −  p·V(x)  +  Σ ½(m/h²)|x − x_prev|²
//!          stretch links    bending hinges      pressure     small stabiliser
//!
//! is minimised by projected Newton (springs' Hessians clamped to positive,
//! hinges Gauss-Newton, pressure left out of the Hessian) with a sparse
//! Cholesky (faer) whose symbolic analysis is reused for the whole run, and a
//! backtracking line search on E. Stiffness is exactly what the material
//! says, however stiff. After each solve, links and hinges whose force passes
//! their yield set permanently by exactly the excess (force-based, judged at
//! equilibrium, so independent of step size). Welds stay on the weld plane.
//! Plates are a simple clamp for now; soap uses core 0.

use faer::linalg::solvers::SolveCore;
use faer::sparse::linalg::LltError;
use faer::sparse::linalg::solvers::{Llt, SymbolicLlt};
use faer::sparse::{SparseColMatRef, SymbolicSparseColMat};
use faer::{Conj, MatMut, Side};
use glam::DVec3;

use super::par::{self, Shared};
use super::{dihedral, wrap_angle, Sim};
use crate::mesh::VertexKind;

/// Sparse lower-triangle pattern of the 3N×3N Hessian, built once. Columns
/// hold whole 3×3 vertex blocks (the upper part of diagonal blocks is stored
/// but never read), so entry (3i+r, 3j+c), i ≥ j, sits at
/// `col_ptr[3j+c] + 3·slot(i in nbrs[j]) + r`.
pub(super) struct Statics {
    col_ptr: Vec<usize>,
    /// Vertices i ≥ j coupled to vertex j, sorted.
    nbrs: Vec<Vec<u32>>,
    symbolic: SymbolicSparseColMat<usize>,
    llt_sym: SymbolicLlt<usize>,
    /// Per stretch link: block slots for (a,a), (b,b), (max,min).
    stretch_slots: Vec<[u32; 3]>,
    /// Per hinge: block slot for each ordered vertex pair (i ≥ j by index).
    bend_slots: Vec<[u32; 16]>,
    values: Vec<f64>,
    /// The current factorisation and how many frames old it is.
    llt: Option<Llt<usize, f64>>,
    pub(super) age: u32,
    /// The buckling-mode seed has been applied (once per run).
    seeded: bool,
    /// Buckling-shape search: the shapes found so far (carried from check to
    /// check so each converges in a few rounds) and the next frame to check.
    modes: Vec<Vec<f64>>,
    next_check: u32,
}

/// Cholesky of the assembled Hessian; on failure shift the diagonal and retry.
fn factor(st: &mut Statics, n: usize) -> Option<Llt<usize, f64>> {
    factor_shifted(st, n).map(|(f, _)| f)
}

/// As `factor`, also returning the diagonal shift it needed.
fn factor_shifted(st: &mut Statics, n: usize) -> Option<(Llt<usize, f64>, f64)> {
    let mut shift = 0.0;
    loop {
        let mat = SparseColMatRef::new(st.symbolic.as_ref(), &st.values);
        match Llt::try_new_with_symbolic(st.llt_sym.clone(), mat, Side::Lower) {
            Ok(f) => return Some((f, shift)),
            Err(LltError::Numeric(_)) | Err(LltError::Generic(_)) => {
                let s = if shift == 0.0 { 1e-6 } else { shift * 10.0 };
                let add = s - shift;
                for dof in 0..3 * n {
                    st.add_diag(dof, add);
                }
                shift = s;
                if shift > 1e6 {
                    return None;
                }
            }
        }
    }
}

impl Statics {
    pub(super) fn new(sim: &Sim) -> Statics {
        let n = sim.pos.len();
        let mut nbrs: Vec<Vec<u32>> = (0..n).map(|j| vec![j as u32]).collect();
        let mut link = |a: u32, b: u32| {
            let (i, j) = if a >= b { (a, b) } else { (b, a) };
            nbrs[j as usize].push(i);
        };
        for s in &sim.stretch {
            link(s.a, s.b);
        }
        for b in &sim.bend {
            for x in 0..4 {
                for y in 0..x {
                    link(b.v[x], b.v[y]);
                }
            }
        }
        for v in nbrs.iter_mut() {
            v.sort_unstable();
            v.dedup();
        }
        let mut col_ptr = Vec::with_capacity(3 * n + 1);
        let mut row_idx = Vec::new();
        col_ptr.push(0usize);
        for j in 0..n {
            for _c in 0..3 {
                for &i in &nbrs[j] {
                    for r in 0..3 {
                        row_idx.push(3 * i as usize + r);
                    }
                }
                col_ptr.push(row_idx.len());
            }
        }
        let symbolic = SymbolicSparseColMat::new_checked(3 * n, 3 * n, col_ptr.clone(), None, row_idx);
        let llt_sym = SymbolicLlt::try_new(symbolic.as_ref(), Side::Lower).expect("symbolic Cholesky");
        let slot = |a: u32, b: u32| -> u32 {
            let (i, j) = if a >= b { (a, b) } else { (b, a) };
            nbrs[j as usize].binary_search(&i).expect("pattern") as u32
        };
        let stretch_slots = sim.stretch.iter().map(|s| [slot(s.a, s.a), slot(s.b, s.b), slot(s.a, s.b)]).collect();
        let bend_slots = sim
            .bend
            .iter()
            .map(|b| {
                let mut o = [0u32; 16];
                for x in 0..4 {
                    for y in 0..4 {
                        o[4 * x + y] = slot(b.v[x], b.v[y]);
                    }
                }
                o
            })
            .collect();
        let nnz = symbolic.row_idx().len();
        Statics { col_ptr, nbrs, symbolic, llt_sym, stretch_slots, bend_slots, values: vec![0.0; nnz], llt: None, age: 0, seeded: false, modes: Vec::new(), next_check: 0 }
    }

    /// Add the 3×3 block `m` (row vertex i, column vertex j; any order) at a
    /// precomputed slot.
    fn add_block(&mut self, i: u32, j: u32, slot: u32, m: &[[f64; 3]; 3]) {
        let values = Shared(self.values.as_mut_ptr());
        // Safety: `&mut self`, nothing else writes.
        unsafe { add_block_at(&self.col_ptr, &values, i, j, slot, m) }
    }

    /// Block slot of the vertex pair, if the pattern couples them.
    fn slot(&self, a: u32, b: u32) -> Option<u32> {
        let (i, j) = if a >= b { (a, b) } else { (b, a) };
        self.nbrs[j as usize].binary_search(&i).ok().map(|s| s as u32)
    }

    /// y = H·x for the symmetric matrix held as its lower triangle.
    fn sym_mul(&self, x: &[f64], y: &mut [f64]) {
        y.iter_mut().for_each(|v| *v = 0.0);
        let rows = self.symbolic.row_idx();
        for col in 0..x.len() {
            for p in self.col_ptr[col]..self.col_ptr[col + 1] {
                let row = rows[p];
                if row < col {
                    continue; // upper half of a diagonal block: not part of the matrix
                }
                let v = self.values[p];
                y[row] += v * x[col];
                if row != col {
                    y[col] += v * x[row];
                }
            }
        }
    }

    fn add_diag(&mut self, dof: usize, v: f64) {
        let j = dof / 3;
        let c = dof % 3;
        // The diagonal block is slot 0 (nbrs[j] starts with j itself).
        self.values[self.col_ptr[3 * j + c] + c] += v;
    }
}

/// `Statics::add_block` on a shared value array.
///
/// # Safety
/// No other thread may write the same block at the same time.
unsafe fn add_block_at(col_ptr: &[usize], values: &Shared<f64>, i: u32, j: u32, slot: u32, m: &[[f64; 3]; 3]) {
    let (cj, tr) = if i >= j { (j, false) } else { (i, true) };
    for c in 0..3 {
        let base = col_ptr[3 * cj as usize + c] + 3 * slot as usize;
        for r in 0..3 {
            *unsafe { values.at(base + r) } += if tr { m[c][r] } else { m[r][c] };
        }
    }
}

/// s·[v]×, the matrix of v × (·).
fn skew(v: DVec3, s: f64) -> [[f64; 3]; 3] {
    [[0.0, -v.z * s, v.y * s], [v.z * s, 0.0, -v.x * s], [-v.y * s, v.x * s, 0.0]]
}

/// Deterministic value in [−1, 1] per (seed, a, b).
fn unit_hash(seed: u64, a: u64, b: u64) -> f64 {
    let mut h = seed ^ (a << 40) ^ b.wrapping_mul(0x2545_F491_4F6C_DD1D);
    h = h.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    h ^= h >> 31;
    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h ^= h >> 29;
    (h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
}

/// Eigen-decomposition of a small symmetric matrix (cyclic Jacobi).
/// Returns (values, vectors as columns: vecs[row][k]).
fn jacobi_eigen(mut a: Vec<Vec<f64>>) -> (Vec<f64>, Vec<Vec<f64>>) {
    let m = a.len();
    let mut v: Vec<Vec<f64>> = (0..m).map(|i| (0..m).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    for _ in 0..100 {
        let mut off = 0.0;
        for i in 0..m {
            for j in 0..m {
                if i != j {
                    off += a[i][j] * a[i][j];
                }
            }
        }
        if off < 1e-30 {
            break;
        }
        for p in 0..m {
            for q in p + 1..m {
                if a[p][q] == 0.0 {
                    continue;
                }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = if theta == 0.0 { 1.0 } else { theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt()) };
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..m {
                    let (akp, akq) = (a[k][p], a[k][q]);
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for k in 0..m {
                    let (apk, aqk) = (a[p][k], a[q][k]);
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for row in v.iter_mut() {
                    let (vkp, vkq) = (row[p], row[q]);
                    row[p] = c * vkp - s * vkq;
                    row[q] = s * vkp + c * vkq;
                }
            }
        }
    }
    ((0..m).map(|i| a[i][i]).collect(), v)
}

fn outer(a: DVec3, b: DVec3, s: f64) -> [[f64; 3]; 3] {
    let (a, b) = (a.to_array(), b.to_array());
    let mut m = [[0.0; 3]; 3];
    for r in 0..3 {
        for c in 0..3 {
            m[r][c] = s * a[r] * b[c];
        }
    }
    m
}

impl Sim {
    /// Stretch stiffness of a link (its XPBD compliance's inverse).
    fn k_link(&self, k: usize) -> f64 {
        1.0 / self.stretch[k].alpha
    }

    /// Is degree of freedom (vertex i, axis a) free to move?
    fn dof_free(&self, i: usize, a: usize) -> bool {
        if a == 2 {
            self.wz[i] > 0.0
        } else {
            self.w[i] > 0.0
        }
    }

    /// Total energy at positions `x` (see the module notes).
    fn static_energy(&self, x: &[DVec3], x_prev: &[DVec3], inertia: f64) -> f64 {
        // Each link's and hinge's energy is worked out on several cores, then
        // added up in the same order as before, so the total is identical.
        let mut terms = vec![0.0; self.stretch.len().max(self.bend.len())];
        let out = Shared(terms.as_mut_ptr());
        par::for_batches(&self.colour_s, |k| {
            let s = &self.stretch[k];
            let l = (x[s.b as usize] - x[s.a as usize]).length();
            // Safety: one write per index.
            unsafe { *out.at(k) = 0.5 * self.k_link(k) * (l - s.rest).powi(2) };
        });
        let mut e = 0.0;
        for t in &terms[..self.stretch.len()] {
            e += t;
        }
        let out = Shared(terms.as_mut_ptr());
        par::for_batches(&self.colour_b, |k| {
            let b = &self.bend[k];
            let iv = b.v.map(|v| v as usize);
            let v = match dihedral(x[iv[0]], x[iv[1]], x[iv[2]], x[iv[3]]) {
                Some((th, _)) => 0.5 / b.alpha * wrap_angle(th - b.rest).powi(2),
                None => 0.0,
            };
            unsafe { *out.at(k) = v };
        });
        // A hinge with no angle adds 0.0, which leaves the sum unchanged.
        for t in &terms[..self.bend.len()] {
            e += t;
        }
        let mut vol = 0.0;
        for t in &self.mesh.tris {
            vol += x[t[0] as usize].dot(x[t[1] as usize].cross(x[t[2] as usize])) / 6.0;
        }
        e -= self.p_now * vol;
        for i in 0..x.len() {
            if self.w[i] > 0.0 {
                e += 0.5 * inertia / self.w[i] * (x[i] - x_prev[i]).length_squared();
            }
        }
        e
    }

    /// Gradient (into `g`) and Hessian (into `st.values`) at the current
    /// positions. `full` keeps the terms projected Newton drops (the links'
    /// negative transverse stiffness in compression, and the pressure term),
    /// so the matrix shows the shapes the sheet wants to buckle into.
    fn static_assemble(&self, st: &mut Statics, g: &mut [DVec3], x_prev: &[DVec3], inertia: f64, full: bool) {
        let x = &self.pos;
        g.iter_mut().for_each(|v| *v = DVec3::ZERO);
        st.values.iter_mut().for_each(|v| *v = 0.0);
        let col_ptr = &st.col_ptr;
        let (stretch_slots, bend_slots) = (&st.stretch_slots, &st.bend_slots);
        let values = Shared(st.values.as_mut_ptr());
        let grad = Shared(g.as_mut_ptr());
        // Safety (both loops): constraints in one batch share no point, so
        // their gradient entries and matrix blocks are all different.
        let add_block = |i: u32, j: u32, slot: u32, m: &[[f64; 3]; 3]| unsafe { add_block_at(col_ptr, &values, i, j, slot, m) };
        par::for_batches(&self.colour_s, |k| {
            let s = &self.stretch[k];
            let (a, b) = (s.a as usize, s.b as usize);
            let d = x[b] - x[a];
            let l = d.length();
            if l < 1e-12 {
                return;
            }
            let n = d / l;
            let kk = self.k_link(k);
            let f = kk * (l - s.rest);
            unsafe {
                *grad.at(a) -= n * f;
                *grad.at(b) += n * f;
            }
            // k[n nᵀ + max(0, 1 − r/l)(I − n nᵀ)]: the transverse part is
            // dropped in compression (projected Newton).
            let t = if full { 1.0 - s.rest / l } else { (1.0 - s.rest / l).max(0.0) };
            // Material stiffness along the link. In the buckling check a link
            // that is yielding (pulled or, with `compressive_yield`, squeezed)
            // only has its tangent stiffness: flowing metal is soft, which
            // is why a yielding flange wrinkles so readily.
            let mut km = kk;
            if full && !s.weld && self.tuning.plastic_tangent < 1.0 {
                let mut fy = self.tuning.elastic_strain_at_yield * s.rest0 * kk;
                if self.tuning.stretch_hardening > 0.0 {
                    let ep = (s.rest / s.rest0 - 1.0).abs();
                    fy *= 1.0 + self.tuning.stretch_hardening * ((1275.0 / 215.0) * ep.powf(0.45) - 1.0).max(0.0);
                }
                let squeeze_yields = self.tuning.compressive_yield > 0.0;
                if f >= 0.99 * fy || (squeeze_yields && -f >= 0.99 * fy) {
                    km = kk * self.tuning.plastic_tangent;
                }
            }
            let mut h = outer(n, n, km - kk * t);
            for r in 0..3 {
                h[r][r] += kk * t;
            }
            let mut neg = h;
            neg.iter_mut().for_each(|row| row.iter_mut().for_each(|v| *v = -*v));
            let sl = stretch_slots[k];
            add_block(s.a, s.a, sl[0], &h);
            add_block(s.b, s.b, sl[1], &h);
            add_block(s.a, s.b, sl[2], &neg);
        });
        par::for_batches(&self.colour_b, |k| {
            let b = &self.bend[k];
            let iv = b.v.map(|v| v as usize);
            let Some((th, gr)) = dihedral(x[iv[0]], x[iv[1]], x[iv[2]], x[iv[3]]) else { return };
            let kb = 1.0 / b.alpha;
            let m = kb * wrap_angle(th - b.rest);
            for j in 0..4 {
                unsafe { *grad.at(iv[j]) += gr[j] * m };
            }
            // Gauss-Newton: k_b ∇θ ∇θᵀ (always positive).
            let sl = bend_slots[k];
            for xx in 0..4 {
                for yy in 0..=xx {
                    let blk = outer(gr[xx], gr[yy], kb);
                    if xx == yy {
                        add_block(b.v[xx], b.v[xx], sl[4 * xx + xx], &blk);
                    } else if b.v[xx] >= b.v[yy] {
                        add_block(b.v[xx], b.v[yy], sl[4 * xx + yy], &blk);
                    } else {
                        let tr = outer(gr[yy], gr[xx], kb);
                        add_block(b.v[yy], b.v[xx], sl[4 * yy + xx], &tr);
                    }
                }
            }
        });
        if full {
            // -p d2V: for each triangle (a, b, c), block (a, b) = (p/6)[x_c]x,
            // cyclic.
            let k = self.p_now / 6.0;
            for t in &self.mesh.tris {
                for e in 0..3 {
                    let (i, j, o) = (t[e], t[(e + 1) % 3], t[(e + 2) % 3]);
                    if let Some(sl) = st.slot(i, j) {
                        st.add_block(i, j, sl, &skew(x[o as usize], k));
                    }
                }
            }
        }
        for t in &self.mesh.tris {
            let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
            let k = self.p_now / 6.0;
            g[a] -= x[b].cross(x[c]) * k;
            g[b] -= x[c].cross(x[a]) * k;
            g[c] -= x[a].cross(x[b]) * k;
        }
        for i in 0..x.len() {
            if self.w[i] > 0.0 {
                let m = inertia / self.w[i];
                g[i] += (x[i] - x_prev[i]) * m;
                for a in 0..3 {
                    st.add_diag(3 * i + a, m);
                }
            }
        }
        // Fixed degrees of freedom: no gradient, a stiff diagonal.
        let big = 1e12;
        for i in 0..x.len() {
            for a in 0..3 {
                if !self.dof_free(i, a) {
                    let mut v = g[i].to_array();
                    v[a] = 0.0;
                    g[i] = DVec3::from_array(v);
                    st.add_diag(3 * i + a, big);
                }
            }
        }
    }

    /// One Newton solve toward equilibrium at the current pressure. Returns
    /// the largest remaining force.
    fn static_newton(&mut self, st: &mut Statics, x_prev: &[DVec3], inertia: f64, iterations: u32) -> f64 {
        let n = self.pos.len();
        let mut g = vec![DVec3::ZERO; n];
        let mut residual = f64::INFINITY;
        let prof = std::env::var("BLOWN_PROFILE").is_ok();
        let mut fresh_failed = false;
        let mut it = 0;
        while it < iterations {
            self.static_assemble(st, &mut g, x_prev, inertia, false);
            residual = g.iter().map(|v| v.abs().max_element()).fold(0.0, f64::max);
            if residual < self.tuning.static_tolerance {
                break;
            }
            // Factor only when there is no factorisation, it is too old, or
            // the old one just failed to give a good step (lagged Newton: the
            // shape changes little between frames, and a factorisation costs
            // ~15x a solve).
            let refactor = st.llt.is_none() || st.age >= self.tuning.static_refactor_frames || fresh_failed;
            let mut factored = false;
            if refactor {
                st.llt = factor(st, n);
                st.age = 0;
                factored = true;
            }
            let Some(llt) = st.llt.as_ref() else { break };
            let mut rhs: Vec<f64> = g.iter().flat_map(|v| [-v.x, -v.y, -v.z]).collect();
            llt.solve_in_place_with_conj(Conj::No, MatMut::from_column_major_slice_mut(&mut rhs, 3 * n, 1));
            let d: Vec<DVec3> = rhs.chunks(3).map(|c| DVec3::new(c[0], c[1], c[2])).collect();
            // Backtracking line search on the energy.
            let e0 = self.static_energy(&self.pos, x_prev, inertia);
            let slope: f64 = g.iter().zip(&d).map(|(a, b)| a.dot(*b)).sum();
            let mut alpha = 1.0;
            let mut trial = vec![DVec3::ZERO; n];
            let mut accepted = false;
            if slope < 0.0 {
                for _ in 0..12 {
                    for i in 0..n {
                        trial[i] = self.pos[i] + d[i] * alpha;
                    }
                    let e1 = self.static_energy(&trial, x_prev, inertia);
                    if e1.is_finite() && e1 <= e0 + 1e-4 * alpha * slope {
                        accepted = true;
                        break;
                    }
                    alpha *= 0.5;
                }
            }
            if prof {
                // (no clock here: std::time panics in the app's WebAssembly)
                eprintln!("refactor {factored} alpha {alpha} residual {residual:.2e}");
            }
            // A stale factorisation that needed a short step: refactor next.
            fresh_failed = !factored && (!accepted || alpha < 0.5);
            if !accepted {
                if factored {
                    break;
                }
                continue; // retry this iteration with a fresh factorisation
            }
            std::mem::swap(&mut self.pos, &mut trial);
            it += 1;
        }
        residual
    }

    /// Permanent set at equilibrium: links past their yield tension lengthen
    /// and hinges past their plastic moment re-set, each by exactly the
    /// excess (so the force sits at the yield surface).
    fn static_plasticity(&mut self) {
        let ey = self.tuning.elastic_strain_at_yield;
        let hard = self.tuning.stretch_hardening;
        let squeeze = self.tuning.compressive_yield > 0.0;
        for k in 0..self.stretch.len() {
            let kk = self.k_link(k);
            let s = &mut self.stretch[k];
            if s.weld {
                continue;
            }
            let l = (self.pos[s.b as usize] - self.pos[s.a as usize]).length();
            let tension = kk * (l - s.rest);
            let mut fy = ey * s.rest0 * kk;
            if hard > 0.0 {
                // 304 curve on the plastic strain either way (squeezing hardens too).
                let ep = (s.rest / s.rest0 - 1.0).abs();
                fy *= 1.0 + hard * ((1275.0 / 215.0) * ep.powf(0.45) - 1.0).max(0.0);
            }
            if tension > fy {
                s.rest = (s.rest + (tension - fy) / kk).min(s.rest_max);
            } else if squeeze && -tension > fy {
                // Real steel yields when squeezed as well as when pulled
                // (`compressive_yield`): the rim can then draw in, as the
                // flange does in deep drawing, instead of holding any
                // squeeze elastically.
                s.rest = (s.rest + (tension + fy) / kk).max(s.rest_min);
            }
        }
        if !self.hold_released {
            return;
        }
        let hardening = self.tuning.bend_hardening;
        for b in self.bend.iter_mut() {
            let iv = b.v.map(|v| v as usize);
            let Some((th, _)) = dihedral(self.pos[iv[0]], self.pos[iv[1]], self.pos[iv[2]], self.pos[iv[3]]) else { continue };
            let kb = 1.0 / b.alpha;
            let moment = kb * wrap_angle(th - b.rest);
            let my = b.theta_y * kb * (1.0 + hardening * b.set);
            if moment.abs() > my {
                let d = (moment.abs() - my) / kb;
                b.rest = wrap_angle(b.rest + moment.signum() * d);
                b.set += d;
            }
        }
    }

    /// Buckling check (see `Tuning::mode_seed`): find the sheet's softest
    /// shapes and, if any has gone unstable (negative stiffness: the real
    /// sheet would buckle into it now), nudge the sheet along the unstable
    /// ones. Returns true once seeded.
    ///
    /// Subspace inverse iteration with the solver's own matrix (full terms,
    /// plus the stabiliser so it factors), whole-body moves projected out,
    /// Rayleigh-Ritz with the sheet's stiffness alone (no stabiliser).
    fn check_buckling(&mut self, st: &mut Statics, x_prev: &[DVec3], inertia: f64) -> bool {
        let n = self.pos.len();
        let dofs = 3 * n;
        let mut g = vec![DVec3::ZERO; n];
        self.static_assemble(st, &mut g, x_prev, inertia, true);
        let Some((llt, _)) = factor_shifted(st, n) else { return false };
        // Stiffness alone, for the Rayleigh quotients.
        self.static_assemble(st, &mut g, x_prev, 0.0, true);
        st.llt = None; // the solver's matrix was overwritten
        let want = (self.tuning.mode_count.round() as usize).max(1);
        let m = want + 3;
        let seed = self.settings.seed as u64;
        let free: Vec<bool> = (0..dofs).map(|d| self.dof_free(d / 3, d % 3)).collect();
        // Whole-body moves (3 slides, 3 turns about the centre), orthonormal.
        let c = self.pos.iter().fold(DVec3::ZERO, |a, p| a + *p) / n as f64;
        let mut rigid: Vec<Vec<f64>> = Vec::new();
        for a in 0..6 {
            let mut v = vec![0.0; dofs];
            for i in 0..n {
                let mv = if a < 3 {
                    DVec3::from_array([0.0, 1.0, 2.0].map(|k: f64| if k as usize == a { 1.0 } else { 0.0 }))
                } else {
                    DVec3::from_array([0.0, 1.0, 2.0].map(|k: f64| if k as usize == a - 3 { 1.0 } else { 0.0 })).cross(self.pos[i] - c)
                };
                for k in 0..3 {
                    if free[3 * i + k] {
                        v[3 * i + k] = mv[k];
                    }
                }
            }
            for r in &rigid {
                let dot: f64 = v.iter().zip(r).map(|(a, b)| a * b).sum();
                v.iter_mut().zip(r).for_each(|(a, b)| *a -= dot * b);
            }
            let norm = v.iter().map(|a| a * a).sum::<f64>().sqrt();
            if norm > 1e-9 {
                v.iter_mut().for_each(|a| *a /= norm);
                rigid.push(v);
            }
        }
        // Inflating further (the volume gradient) is not a buckle: the
        // pressure drives it and makes it read as unstable while the sheet
        // is still flat. Leave it out too.
        {
            let mut v = vec![0.0; dofs];
            for t in &self.mesh.tris {
                let (a, b, cc) = (t[0] as usize, t[1] as usize, t[2] as usize);
                for (i, gv) in [(a, self.pos[b].cross(self.pos[cc])), (b, self.pos[cc].cross(self.pos[a])), (cc, self.pos[a].cross(self.pos[b]))] {
                    for k in 0..3 {
                        if free[3 * i + k] {
                            v[3 * i + k] += gv[k];
                        }
                    }
                }
            }
            for r in &rigid {
                let dot: f64 = v.iter().zip(r).map(|(a, b)| a * b).sum();
                v.iter_mut().zip(r).for_each(|(a, b)| *a -= dot * b);
            }
            let norm = v.iter().map(|a| a * a).sum::<f64>().sqrt();
            if norm > 1e-12 {
                v.iter_mut().for_each(|a| *a /= norm);
                rigid.push(v);
            }
        }
        if st.modes.len() != m {
            st.modes = (0..m).map(|k| (0..dofs).map(|d| if free[d] { unit_hash(seed, k as u64 + 7, d as u64) } else { 0.0 }).collect()).collect();
        }
        let mut basis = std::mem::take(&mut st.modes);
        let mut ax = vec![0.0; dofs];
        let mut vals = vec![0.0; m];
        let rounds = self.tuning.mode_iterations.max(1.0) as usize;
        for _ in 0..rounds {
            for v in basis.iter_mut() {
                llt.solve_in_place_with_conj(Conj::No, MatMut::from_column_major_slice_mut(v, dofs, 1));
                for d in 0..dofs {
                    if !free[d] {
                        v[d] = 0.0;
                    }
                }
                for r in &rigid {
                    let dot: f64 = v.iter().zip(r).map(|(a, b)| a * b).sum();
                    v.iter_mut().zip(r).for_each(|(a, b)| *a -= dot * b);
                }
            }
            // Orthonormalise (modified Gram-Schmidt).
            for k in 0..m {
                for j in 0..k {
                    let dot: f64 = basis[k].iter().zip(&basis[j]).map(|(a, b)| a * b).sum();
                    let (head, tail) = basis.split_at_mut(k);
                    tail[0].iter_mut().zip(&head[j]).for_each(|(a, b)| *a -= dot * b);
                }
                let norm = basis[k].iter().map(|a| a * a).sum::<f64>().sqrt().max(1e-300);
                basis[k].iter_mut().for_each(|a| *a /= norm);
            }
            // Rayleigh-Ritz on the subspace, with the stiffness alone.
            let av: Vec<Vec<f64>> = basis
                .iter()
                .map(|v| {
                    st.sym_mul(v, &mut ax);
                    ax.clone()
                })
                .collect();
            let t: Vec<Vec<f64>> = (0..m).map(|i| (0..m).map(|j| basis[i].iter().zip(&av[j]).map(|(a, b)| a * b).sum()).collect()).collect();
            let (ev, vecs) = jacobi_eigen(t);
            let mut order: Vec<usize> = (0..m).collect();
            order.sort_by(|&a, &b| ev[a].total_cmp(&ev[b]));
            basis = order.iter().map(|&k| (0..dofs).map(|d| (0..m).map(|i| basis[i][d] * vecs[i][k]).sum()).collect()).collect();
            vals = order.iter().map(|&k| ev[k]).collect();
        }
        let dump = std::env::var("BLOWN_MODES").ok();
        if dump.is_some() {
            let shown: Vec<String> = vals.iter().map(|v| format!("{v:.2e}")).collect();
            eprintln!("  frame {:4} buckling check, pressure {:.3}: {shown:?}", self.frame, self.p_now);
        }
        let unstable: Vec<usize> = (0..want).filter(|&k| vals[k] < 0.0).collect();
        if let Some(path) = dump.as_ref().filter(|p| p.len() > 1 && unstable.is_empty()) {
            // The lowest shapes so far (overwritten each check), one column each.
            let mut out = String::new();
            for i in 0..n {
                let row: Vec<String> = (0..want).map(|k| format!("{:.5}", basis[k][3 * i + 2])).collect();
                out.push_str(&row.join(" "));
                out.push('\n');
            }
            let _ = std::fs::write(path, out);
        }
        if unstable.is_empty() {
            st.modes = basis;
            return false;
        }
        let mut d = vec![0.0; dofs];
        for &k in &unstable {
            let sign = if unit_hash(seed, 99, k as u64) < 0.0 { -1.0 } else { 1.0 };
            d.iter_mut().zip(&basis[k]).for_each(|(a, b)| *a += sign * b);
        }
        let biggest = d.chunks(3).map(|c| (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt()).fold(0.0, f64::max);
        if biggest > 0.0 {
            let amp = self.tuning.mode_seed * self.settings.thickness_mm / self.scale / biggest;
            for i in 0..n {
                self.pos[i] += DVec3::new(d[3 * i], d[3 * i + 1], d[3 * i + 2]) * amp;
            }
        }
        if let Some(path) = dump.filter(|p| p.len() > 1) {
            // The seeded shapes' height pattern, one column per shape.
            let mut out = String::new();
            for i in 0..n {
                let row: Vec<String> = unstable.iter().map(|&k| format!("{:.5}", basis[k][3 * i + 2])).collect();
                out.push_str(&row.join(" "));
                out.push('\n');
            }
            let _ = std::fs::write(path, out);
            eprintln!("  seeded {} unstable shape(s)", unstable.len());
        }
        st.modes = basis;
        true
    }

    /// One frame of core B: step the pressure, solve, set.
    pub(super) fn static_frame(&mut self, st: &mut Statics) {
        let tn = self.tuning.clone();
        let frame_time = tn.substep_dt * tn.substeps_per_frame as f64;
        if self.p_now < self.p_target {
            self.p_now = (self.p_now + self.p_full * frame_time / tn.ramp_time).min(self.p_target);
        }
        let inertia = 1.0 / (tn.static_dt * tn.static_dt);
        let (iters, cycles) = (tn.static_iterations, tn.static_plastic_cycles.max(1));
        let start = self.pos.clone();
        self.prev.clone_from(&self.pos);
        if tn.mode_seed > 0.0 && !st.seeded && self.p_now >= tn.mode_seed_at * self.p_target && self.frame >= st.next_check {
            st.next_check = self.frame + tn.mode_check_frames.max(1.0) as u32;
            let x_prev = self.pos.clone();
            st.seeded = self.check_buckling(st, &x_prev, inertia);
        }
        if tn.static_kick > 0.0 {
            // Deterministic noise per (seed, frame, point, axis).
            let seed = self.settings.seed as u64;
            for i in 0..self.pos.len() {
                if self.w[i] == 0.0 || self.mesh.kind[i] == VertexKind::Weld {
                    continue;
                }
                let mut d = [0.0; 3];
                for (a, v) in d.iter_mut().enumerate() {
                    let mut h = seed ^ ((self.frame as u64) << 40) ^ ((i as u64) << 2) ^ a as u64;
                    h = h.wrapping_mul(0x9E37_79B9_7F4A_7C15);
                    h ^= h >> 31;
                    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
                    h ^= h >> 29;
                    *v = ((h >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0) * tn.static_kick;
                }
                self.pos[i] += DVec3::from_array(d);
            }
        }
        for _ in 0..cycles {
            let x_prev = start.clone();
            self.static_newton(st, &x_prev, inertia, iters);
            self.static_plasticity();
        }
        if tn.weld_free_z > 0.0 {
            // Free seam: keep the piece from drifting (mean seam height 0).
            let (mut sum, mut cnt) = (0.0_f64, 0.0_f64);
            for (p, k) in self.pos.iter().zip(&self.mesh.kind) {
                if *k == VertexKind::Weld {
                    sum += p.z;
                    cnt += 1.0;
                }
            }
            let dz = sum / cnt.max(1.0);
            for p in self.pos.iter_mut() {
                p.z -= dz;
            }
        }
        if let Some((zb, zt)) = self.plates {
            for i in 0..self.pos.len() {
                if self.wz[i] == 0.0 {
                    continue;
                }
                let p = &mut self.pos[i];
                let hit = p.z > zt || p.z < zb;
                p.z = p.z.clamp(zb, zt);
                self.contact[i] = hit;
            }
        }
        let motion = self.pos.iter().zip(&start).map(|(a, b)| (*a - *b).length()).fold(0.0, f64::max);
        // Reported per substep, so the settle threshold means the same thing.
        self.last_motion = motion / tn.substeps_per_frame.max(1) as f64;
        for v in self.vel.iter_mut() {
            *v = DVec3::ZERO;
        }
        self.time += frame_time;
        st.age += 1;
        let _ = &st.nbrs;
    }
}
