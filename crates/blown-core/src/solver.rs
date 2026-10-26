//! The XPBD shell solver (same family as Houdini's Vellum).
//!
//! Each substep:
//!   1. pressure pushes every triangle outward along its normal,
//!   2. positions are predicted from velocity (heavily damped → quasi-static),
//!   3. stretch constraints (elastic → yields → strain cap) and dihedral
//!      bending constraints (elastic → plastic hinge = permanent crease) are
//!      projected,
//!   4. the plates push back (infinite half-spaces with friction).
//!
//! Weld points stay on the weld plane (z = 0) but can slide in-plane, so the
//! perimeter draws inward as the piece inflates. Its length can't change,
//! which is what makes the metal crease and pillow near the seam.

use std::collections::BTreeMap;

use glam::DVec3;
use serde::Serialize;

use crate::config::Tuning;
use crate::mesh::{triangulate, SheetMesh, VertexKind};
use crate::outline::Piece;
use crate::rng::Rng;
use crate::settings::{Material, MeshQuality, SimSettings};

mod par;
mod statics;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Running,
    Settled,
}

/// Per-frame numbers for the UI and logs.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameInfo {
    pub frame: u32,
    pub time: f64,
    /// Current pressure on the 0–100 scale.
    pub pressure: f64,
    pub height_mm: f64,
    pub volume_ml: f64,
    /// Fraction of sheet points touching a plate.
    pub contact_fraction: f64,
    /// Largest permanent stretch anywhere, %.
    pub max_stretch_pct: f64,
    /// Largest point movement in the last substep (normalised).
    pub motion: f64,
    pub status: Status,
    /// False if the solver went numerically unstable (the run is stopped).
    pub stable: bool,
}

#[derive(Clone, Debug)]
struct Stretch {
    a: u32,
    b: u32,
    rest: f64,
    rest0: f64,
    rest_max: f64,
    /// Shortest it may set to when squeezed (`compressive_yield`).
    rest_min: f64,
    alpha: f64,
    weld: bool,
}

#[derive(Clone, Debug)]
struct Bend {
    v: [u32; 4],
    rest: f64,
    /// Plastic rotation so far (rad), for work hardening.
    set: f64,
    alpha: f64,
    theta_y: f64,
}

pub struct Sim {
    pub mesh: SheetMesh,
    pub tuning: Tuning,
    pub settings: SimSettings,
    /// mm per normalised unit (the outline's equivalent radius).
    pub scale: f64,
    /// Outline centroid, mm.
    pub center: [f64; 2],

    pos: Vec<DVec3>,
    prev: Vec<DVec3>,
    vel: Vec<DVec3>,
    w: Vec<f64>,
    wz: Vec<f64>,
    force: Vec<DVec3>,
    stretch: Vec<Stretch>,
    bend: Vec<Bend>,
    lambda_s: Vec<f64>,
    lambda_b: Vec<f64>,
    /// Colour batches of `stretch` / `bend` (see `par`).
    colour_s: Vec<par::Batch>,
    colour_b: Vec<par::Batch>,
    contact: Vec<bool>,

    soap: bool,
    p_full: f64,
    p_target: f64,
    p_now: f64,
    target_height: Option<f64>,
    height_reached: bool,
    /// Height mode: last frame's (pressure, height), for the rise speed.
    height_probe: Option<(f64, f64)>,
    plates: Option<(f64, f64)>,

    time: f64,
    frame: u32,
    settled_count: u32,
    status: Status,
    last_motion: f64,
    stable: bool,
    /// Fixed outline: the piece inflates freely (full height, natural
    /// creases), then this smooth in-plane offset maps the weld back onto the
    /// drawn outline. Zero unless `fix_outline` is on.
    warp: Vec<[f64; 2]>,
    warp_nbrs: Vec<Vec<u32>>,
    /// Consecutive weld points (a, b, c) and b's rest offset from the line
    /// a–c: the seam is a doubled, welded strip that resists kinking sideways.
    weld_bend: Vec<(u32, u32, u32, f64)>,
    /// Yielding seam (`weld_kink_yield` > 0): XPBD multipliers per weld_bend.
    lambda_w: Vec<f64>,
    /// Indices into `stretch` of the weld links (for `weld_passes`).
    weld_links: Vec<usize>,
    /// Crease hold (see `SimSettings::crease_hold`): false while folds can't set.
    hold_released: bool,
    /// Core B's sparse pattern and factorisation (built on first use).
    statics: Option<statics::Statics>,
    /// Specified geometric: the drawn outline (to rebuild on a new pressure /
    /// height) and the finished form (normalised); the frames ease into it.
    /// Also the frame it last changed.
    geo: Option<(Vec<Piece>, Vec<DVec3>, u32)>,
}

/// Signed dihedral angle across edge (a,b) between triangles (a,b,c) and
/// (b,a,d), positive when the wings fold toward the triangles' normals, plus
/// its gradient with respect to a, b, c, d.
pub fn dihedral(pa: DVec3, pb: DVec3, pc: DVec3, pd: DVec3) -> Option<(f64, [DVec3; 4])> {
    let e = pb - pa;
    let l = e.length();
    if l < 1e-12 {
        return None;
    }
    let n1 = e.cross(pc - pa);
    let n2 = (pa - pb).cross(pd - pb);
    let n1s = n1.length_squared();
    let n2s = n2.length_squared();
    if n1s < 1e-24 || n2s < 1e-24 {
        return None;
    }
    let (n1n, n2n) = (n1 / n1s.sqrt(), n2 / n2s.sqrt());
    let sin = n2n.cross(n1n).dot(e / l);
    let cos = n1n.dot(n2n);
    let theta = sin.atan2(cos);
    let gc = n1 * (l / n1s);
    let gd = n2 * (l / n2s);
    let ga = n1 * ((pc - pb).dot(e) / l / n1s) + n2 * ((pd - pb).dot(e) / l / n2s);
    let gb = -(n1 * ((pc - pa).dot(e) / l / n1s) + n2 * ((pd - pa).dot(e) / l / n2s));
    Some((theta, [ga, gb, gc, gd]))
}

/// Signed in-plane distance of b from the line through a and c.
fn side_offset(a: DVec3, b: DVec3, c: DVec3) -> f64 {
    let (ex, ey) = (c.x - a.x, c.y - a.y);
    let l = (ex * ex + ey * ey).sqrt();
    if l < 1e-12 {
        return 0.0;
    }
    (ex * (b.y - a.y) - ey * (b.x - a.x)) / l
}

fn wrap_angle(a: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    let mut x = a % tau;
    if x > std::f64::consts::PI {
        x -= tau;
    } else if x < -std::f64::consts::PI {
        x += tau;
    }
    x
}

/// A smooth random field (sum of plane waves) for the seeded imperfection.
struct Field {
    waves: Vec<(f64, f64, f64, f64)>,
}

impl Field {
    fn new(rng: &mut Rng, count: usize) -> Field {
        let waves = (0..count)
            .map(|_| {
                let ang = rng.f64() * std::f64::consts::TAU;
                let k = 3.0 + 7.0 * rng.f64();
                (k * ang.cos(), k * ang.sin(), rng.f64() * std::f64::consts::TAU, 0.5 + 0.5 * rng.f64())
            })
            .collect();
        Field { waves }
    }
    fn at(&self, x: f64, y: f64) -> f64 {
        let s: f64 = self.waves.iter().map(|(kx, ky, ph, a)| a * (kx * x + ky * y + ph).sin()).sum();
        s / (self.waves.len() as f64).sqrt()
    }
}

impl Sim {
    pub fn new(pieces: &[Piece], settings: SimSettings) -> Result<Sim, String> {
        Self::with_tuning(pieces, settings, Tuning::default())
    }

    pub fn with_tuning(pieces: &[Piece], settings: SimSettings, mut tuning: Tuning) -> Result<Sim, String> {
        // Experimental switches from the app (tuning log, session 8).
        if settings.steel_solver {
            tuning.core = 1.0;
            tuning.elastic_strain_at_yield = 0.0011;
            tuning.min_bending_mesh_factor = 1.0;
        }
        if settings.seam_stiffness > 0.0 {
            tuning.seam_hinge = settings.seam_stiffness;
            tuning.weld_free_z = 1.0;
        }
        if pieces.is_empty() {
            return Err("Nothing to inflate — draw or import a closed shape first".into());
        }
        let target = match settings.quality {
            MeshQuality::Draft => tuning.draft_vertices,
            MeshQuality::Medium => tuning.medium_vertices,
            MeshQuality::Final => tuning.final_vertices,
            MeshQuality::XFine => tuning.xfine_vertices,
        };
        let flat = if settings.symmetric {
            crate::symmetry::mesh_symmetric(pieces, target, tuning.min_angle_deg)?.0
        } else {
            triangulate(pieces, target, tuning.min_angle_deg)?
        };
        let mesh = SheetMesh::from_flat(&flat);
        let soap = settings.material == Material::Soap;

        // Scale and centre from the flat top sheet.
        let (mut area, mut cx, mut cy) = (0.0, 0.0, 0.0);
        for t in &flat.tris {
            let (a, b, c) = (flat.verts[t[0] as usize], flat.verts[t[1] as usize], flat.verts[t[2] as usize]);
            let ar = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
            area += ar;
            cx += ar * (a[0] + b[0] + c[0]) / 3.0;
            cy += ar * (a[1] + b[1] + c[1]) / 3.0;
        }
        let center = [cx / area, cy / area];
        let scale = (area / std::f64::consts::PI).sqrt();
        let spacing = flat.spacing / scale;

        let mut rng = Rng::new(settings.seed);
        let randomness = settings.crease_randomness.clamp(0.0, 1.0);
        let amp = tuning.imperfection_amplitude * (0.3 + randomness);
        let field_top = Field::new(&mut rng, 6);
        let field_bot = Field::new(&mut rng, 6);

        let n = mesh.num_vertices();
        // The starting bump fades smoothly to zero at the welds. A step from
        // the weld straight up to full height kinks the first row of
        // triangles; on fine meshes that kink snaps back, rings, and the
        // ringing was read as yielding (thousands of links overstretched
        // before the piece had risen at all, then crumpling).
        let mut hops = vec![u32::MAX; n];
        let mut nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        for t in &mesh.tris {
            for k in 0..3 {
                nbrs[t[k] as usize].push(t[(k + 1) % 3]);
                nbrs[t[(k + 1) % 3] as usize].push(t[k]);
            }
        }
        let mut queue: std::collections::VecDeque<usize> = (0..n).filter(|&i| mesh.kind[i] == VertexKind::Weld).collect();
        for &i in &queue {
            hops[i] = 0;
        }
        while let Some(i) = queue.pop_front() {
            for &j in &nbrs[i] {
                if hops[j as usize] == u32::MAX {
                    hops[j as usize] = hops[i] + 1;
                    queue.push_back(j as usize);
                }
            }
        }
        let taper = |i: usize| {
            let t = (hops[i] as f64 * spacing / tuning.imperfection_taper).min(1.0);
            t * t * (3.0 - 2.0 * t)
        };
        // Seam seed: only drawn when on, so the random sequence (and every
        // result) is unchanged when off.
        let field_weld = if tuning.weld_seed > 0.0 { Some(Field::new(&mut rng, 6)) } else { None };
        let mut pos = Vec::with_capacity(n);
        for i in 0..n {
            let x = (mesh.flat[i][0] - center[0]) / scale;
            let y = (mesh.flat[i][1] - center[1]) / scale;
            let z = match mesh.kind[i] {
                VertexKind::Weld => field_weld.as_ref().map_or(0.0, |f| tuning.weld_seed * f.at(x, y)),
                VertexKind::Top => amp * taper(i) * (1.0 + 0.6 * field_top.at(x, y)),
                VertexKind::Bottom => -amp * taper(i) * (1.0 + 0.6 * field_bot.at(x, y)),
            };
            pos.push(DVec3::new(x, y, z));
        }

        // Lumped masses from flat triangle areas (unit areal density).
        let mut mass = vec![0.0; n];
        let flat_area = |t: &[u32; 3]| -> f64 {
            let (a, b, c) = (pos[t[0] as usize], pos[t[1] as usize], pos[t[2] as usize]);
            0.5 * ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)).abs()
        };
        let tri_area: Vec<f64> = mesh.tris.iter().map(flat_area).collect();
        for (t, ar) in mesh.tris.iter().zip(&tri_area) {
            for &v in t {
                mass[v as usize] += ar / 3.0;
            }
        }
        let w: Vec<f64> = mass
            .iter()
            .zip(&mesh.kind)
            .map(|(m, _)| if *m > 0.0 { 1.0 / m } else { 0.0 })
            .collect();
        // Weld points stay on the weld plane unless `weld_free_z` lets the seam
        // wave up and down like the real thing.
        let free = tuning.weld_free_z > 0.0;
        let wz: Vec<f64> = (0..n).map(|i| if mesh.kind[i] == VertexKind::Weld && !free { 0.0 } else { w[i] }).collect();

        // Material per sheet. Forces are normalised by the top sheet's yield tension.
        let t_top = tuning.thickness_ratio(settings.thickness_mm.max(0.01) / scale, settings.character);
        let t_bot = t_top * settings.bottom_stiffness.clamp(0.25, 8.0);
        let ny = [1.0, t_bot / t_top];
        let bend_floor = tuning.min_bending_mesh_factor * spacing * spacing;
        // Physical bending stiffness, and the regularised one used by the
        // solver (never below a floor tied to mesh size, so folds span a few
        // triangles instead of zig-zagging along single edges).
        let d_phys = [tuning.bending_stiffness(t_top), tuning.bending_stiffness(t_bot) * t_bot / t_top];
        let dd = [d_phys[0].max(bend_floor), d_phys[1].max(bend_floor)];
        let kappa_y = [tuning.yield_curvature(t_top), tuning.yield_curvature(t_bot)];
        // Fold moment at the real thickness (`fold_moment_real`): M_p ∝ t², so
        // scale by (real / tempered)².
        let m_scale = if tuning.fold_moment_real > 0.0 {
            let t_real = settings.thickness_mm.max(0.01) / scale;
            [(t_real / t_top).powi(2), (t_real * settings.bottom_stiffness.clamp(0.25, 8.0) / t_bot).powi(2)]
        } else {
            [1.0, 1.0]
        };

        // Edge → adjacent (triangle, opposite vertex). BTreeMap keeps it deterministic.
        let mut edges: BTreeMap<(u32, u32), Vec<(usize, u32)>> = BTreeMap::new();
        for (ti, t) in mesh.tris.iter().enumerate() {
            for k in 0..3 {
                let (a, b, c) = (t[k], t[(k + 1) % 3], t[(k + 2) % 3]);
                edges.entry(if a < b { (a, b) } else { (b, a) }).or_default().push((ti, c));
            }
        }

        let ey = tuning.elastic_strain_at_yield;
        let noise = tuning.rest_length_noise * randomness;
        let mut stretch = Vec::with_capacity(edges.len());
        let mut bend = Vec::new();
        for (&(a, b), adj) in &edges {
            let l = (pos[a as usize] - pos[b as usize]).truncate().length();
            if l < 1e-12 {
                continue;
            }
            let weld = mesh.kind[a as usize] == VertexKind::Weld && mesh.kind[b as usize] == VertexKind::Weld;
            let fy: f64 = adj.iter().map(|&(ti, _)| ny[mesh.tri_sheet[ti] as usize] * tri_area[ti]).sum::<f64>() / l;
            let mut alpha = ey * l / fy.max(1e-12);
            if weld {
                alpha /= tuning.weld_stiffness_factor;
            }
            let mut rest = l * (1.0 + noise * rng.signed());
            if weld {
                rest *= 1.0 - tuning.weld_shrink;
            }
            stretch.push(Stretch {
                a,
                b,
                rest,
                rest0: rest,
                rest_max: if soap { f64::INFINITY } else { rest * (1.0 + tuning.max_plastic_strain) },
                rest_min: rest * (1.0 - tuning.max_plastic_strain).max(0.05),
                alpha,
                weld,
            });

            if soap {
                continue;
            }
            for sheet in 0..2u8 {
                let wings: Vec<&(usize, u32)> = adj.iter().filter(|(ti, _)| mesh.tri_sheet[*ti] == sheet).collect();
                if wings.len() != 2 {
                    continue;
                }
                let (t1, c) = *wings[0];
                let (t2, d) = *wings[1];
                // Orient so triangle t1 runs a→b.
                let tri = mesh.tris[t1];
                let runs_ab = (0..3).any(|k| tri[k] == a && tri[(k + 1) % 3] == b);
                let (ea, eb) = if runs_ab { (a, b) } else { (b, a) };
                let a12 = tri_area[t1] + tri_area[t2];
                let geom = 3.0 * l * l / a12;
                let k_b = dd[sheet as usize] * geom;
                let h_e = (2.0 / 3.0) * a12 / l;
                // Keep the plastic (fold) moment physical even when the elastic
                // stiffness is floored: the hinge yields at the real steel moment.
                let m_y = d_phys[sheet as usize] * geom * kappa_y[sheet as usize] * h_e * m_scale[sheet as usize];
                bend.push(Bend { v: [ea, eb, c, d], rest: 0.0, set: 0.0, alpha: 1.0 / k_b, theta_y: m_y / k_b });
            }

            // Seam hinge: across an outline weld edge, between its top and
            // bottom triangle — the seam resists opening like a book. Rest =
            // the starting (closed) angle.
            if weld && tuning.seam_hinge > 0.0 && adj.len() == 2 && mesh.tri_sheet[adj[0].0] != mesh.tri_sheet[adj[1].0] {
                let (t1, c) = adj[0];
                let (t2, d) = adj[1];
                let tri = mesh.tris[t1];
                let runs_ab = (0..3).any(|k| tri[k] == a && tri[(k + 1) % 3] == b);
                let (ea, eb) = if runs_ab { (a, b) } else { (b, a) };
                if let Some((th0, _)) = dihedral(pos[ea as usize], pos[eb as usize], pos[c as usize], pos[d as usize]) {
                    let a12 = tri_area[t1] + tri_area[t2];
                    let geom = 3.0 * l * l / a12;
                    let k_b = dd[0] * geom * tuning.seam_hinge;
                    let h_e = (2.0 / 3.0) * a12 / l;
                    let m_y = d_phys[0] * geom * kappa_y[0] * h_e * m_scale[0] * tuning.seam_hinge_yield;
                    bend.push(Bend { v: [ea, eb, c, d], rest: th0, set: 0.0, alpha: 1.0 / k_b, theta_y: m_y / k_b });
                }
            }
        }

        let plates = match settings.plates {
            Some(p) => {
                let zt = (p.offset_mm + p.thickness_mm / 2.0) / scale;
                let zb = (p.offset_mm - p.thickness_mm / 2.0) / scale;
                if !(zt > 0.0 && zb < 0.0) {
                    return Err("The plates must sit either side of the weld — make the plate gap bigger or the offset smaller".into());
                }
                Some((zb, zt))
            }
            None => None,
        };

        let p_full = tuning.normalised_pressure(100.0, settings.character);
        let (p_target, target_height) = match settings.target_height_mm {
            // Height mode starts at zero and is stepped up by `steer_height`.
            Some(h) if h > 0.0 => (0.0, Some(h / scale)),
            _ => (tuning.normalised_pressure(settings.pressure, settings.character), None),
        };

        // Weld chains: a weld point with exactly two weld neighbours gets a
        // straightness constraint (junctions and ends are left free).
        let mut weld_nbrs: Vec<Vec<u32>> = vec![Vec::new(); n];
        for st in stretch.iter().filter(|s| s.weld) {
            weld_nbrs[st.a as usize].push(st.b);
            weld_nbrs[st.b as usize].push(st.a);
        }
        let mut weld_bend = Vec::new();
        if !soap {
            for (b, nb) in weld_nbrs.iter().enumerate() {
                if let [a, c] = nb[..] {
                    let d0 = side_offset(pos[a as usize], pos[b], pos[c as usize]);
                    weld_bend.push((a, b as u32, c, d0));
                }
            }
        }

        // Stiff corners: where a weld turns sharply, the doubled, welded tip
        // is far stiffer than open sheet. Tie the seam points on both sides
        // of the corner together (every pair within reach) so the tip keeps
        // its drawn shape instead of bowing in to a needle and spiking up.
        if !soap && tuning.corner_reach > 0.0 {
            let walk = |from: u32, first: u32, reach: f64| -> Vec<u32> {
                let (mut prev, mut cur) = (from, first);
                let mut out = Vec::new();
                loop {
                    let (p, c) = (pos[from as usize], pos[cur as usize]);
                    if (c - p).truncate().length() > reach || out.len() > 200 {
                        break;
                    }
                    out.push(cur);
                    let nb = &weld_nbrs[cur as usize];
                    if nb.len() != 2 {
                        break;
                    }
                    let next = if nb[0] == prev { nb[1] } else { nb[0] };
                    prev = cur;
                    cur = next;
                }
                out
            };
            let mut ties = Vec::new();
            for (b, nb) in weld_nbrs.iter().enumerate() {
                let [a, c] = nb[..] else { continue };
                let (u, v) = ((pos[a as usize] - pos[b]).truncate(), (pos[c as usize] - pos[b]).truncate());
                let ang = (u.dot(v) / (u.length() * v.length()).max(1e-12)).clamp(-1.0, 1.0).acos().to_degrees();
                if ang >= tuning.corner_max_angle {
                    continue;
                }
                // Full reach for tips 40° sharper than the limit; fades to
                // nothing at the limit (square corners are left nearly free).
                let reach = tuning.corner_reach * ((tuning.corner_max_angle - ang) / 40.0).min(1.0).powi(2);
                let (sa, sc) = (walk(b as u32, a, reach), walk(b as u32, c, reach));
                for &i in &sa {
                    for &j in &sc {
                        let l = (pos[i as usize] - pos[j as usize]).truncate().length();
                        // Fade out toward the end of the reach so the stiff
                        // tip blends into the free seam without a kink.
                        let far = (pos[i as usize] - pos[b]).truncate().length().max((pos[j as usize] - pos[b]).truncate().length());
                        let fade = (1.0 - far / reach).max(0.0).powi(2);
                        if l > 1e-12 && fade > 1e-3 {
                            ties.push((i.min(j), i.max(j), l, fade));
                        }
                    }
                }
            }
            ties.sort_by(|x, y| (x.0, x.1).cmp(&(y.0, y.1)).then(y.3.total_cmp(&x.3)));
            ties.dedup_by(|x, y| x.0 == y.0 && x.1 == y.1);
            let fy_ref = spacing; // yield force of a strip one mesh-spacing wide
            for (a, b, l, fade) in ties {
                let alpha = ey * l / (fy_ref * tuning.corner_stiffness * fade);
                let l = l * (1.0 - tuning.weld_shrink); // the whole seam shrinks, corners too
                stretch.push(Stretch { a, b, rest: l, rest0: l, rest_max: l, rest_min: l, alpha, weld: true });
            }
        }

        // Group links and hinges into batches that share no point, so each
        // batch can be solved on several cores (same result as one core).
        // Last, once every link (corners too) exists: this reorders them.
        let colour_s = par::colour(&mut stretch, n, |s| [s.a, s.b, s.a, s.b]);
        let colour_b = par::colour(&mut bend, n, |b| b.v);
        let weld_links: Vec<usize> = stretch.iter().enumerate().filter(|(_, s)| s.weld).map(|(i, _)| i).collect();

        let settings_hold_off = soap || settings.crease_hold <= 0.0;
        let ns = stretch.len();
        let nb = bend.len();
        let mut warp_nbrs: Vec<Vec<u32>> = Vec::new();
        if settings.fix_outline {
            warp_nbrs = vec![Vec::new(); n];
            for st in &stretch {
                warp_nbrs[st.a as usize].push(st.b);
                warp_nbrs[st.b as usize].push(st.a);
            }
        }
        let mut sim = Sim {
            mesh,
            tuning,
            settings,
            scale,
            center,
            prev: pos.clone(),
            vel: vec![DVec3::ZERO; n],
            pos,
            w,
            wz,
            force: vec![DVec3::ZERO; n],
            stretch,
            bend,
            lambda_s: vec![0.0; ns],
            lambda_b: vec![0.0; nb],
            colour_s,
            colour_b,
            contact: vec![false; n],
            soap,
            p_full,
            p_target,
            p_now: 0.0,
            target_height,
            height_reached: false,
            height_probe: None,
            plates,
            time: 0.0,
            frame: 0,
            settled_count: 0,
            status: Status::Running,
            last_motion: 0.0,
            stable: true,
            warp: vec![[0.0; 2]; n],
            warp_nbrs,
            lambda_w: vec![0.0; weld_bend.len()],
            weld_links,
            weld_bend,
            hold_released: settings_hold_off,
            statics: None,
            geo: None,
        };
        if sim.settings.geometric {
            let target = sim.geo_target(pieces);
            sim.geo = Some((pieces.to_vec(), target, 0));
        }
        Ok(sim)
    }

    /// Specified geometric: the finished form, normalised.
    fn geo_target(&self, pieces: &[Piece]) -> Vec<DVec3> {
        crate::geometric::build(pieces, &self.mesh, &self.settings)
            .into_iter()
            .map(|p| DVec3::new((p.x - self.center[0]) / self.scale, (p.y - self.center[1]) / self.scale, p.z / self.scale))
            .collect()
    }

    /// Specified geometric: ease from where the piece is into the form over
    /// `GEO_FRAMES` frames, then settle.
    fn geo_frame(&mut self) -> FrameInfo {
        const GEO_FRAMES: u32 = 24;
        if self.status == Status::Running {
            if let Some((_, target, _)) = &self.geo {
                let left = GEO_FRAMES.saturating_sub(self.geo_step()) as f64;
                let f = if left <= 1.0 { 1.0 } else { 1.0 / left };
                let mut motion = 0.0f64;
                for (p, t) in self.pos.iter_mut().zip(target) {
                    let d = (*t - *p) * f;
                    motion = motion.max(d.length());
                    *p += d;
                }
                self.last_motion = motion;
            }
            self.frame += 1;
            self.p_now = self.p_target;
            if self.geo_step() >= GEO_FRAMES {
                self.status = Status::Settled;
                self.update_warp(400);
            }
        }
        self.info()
    }

    /// Specified geometric: a new pressure or height rebuilds the form; the
    /// piece eases on from where it is.
    fn geo_rebuild(&mut self) {
        if let Some((pieces, _, _)) = self.geo.take() {
            let target = self.geo_target(&pieces);
            self.geo = Some((pieces, target, self.frame));
        }
    }

    /// Frames since the form last changed.
    fn geo_step(&self) -> u32 {
        self.frame - self.geo.as_ref().map_or(0, |g| g.2)
    }

    pub fn status(&self) -> Status {
        self.status
    }

    pub fn frame(&self) -> u32 {
        self.frame
    }

    /// Raise the pressure mid-run (0–100). Pressure only goes forward:
    /// lower values are ignored (creases are permanent). Returns true if applied.
    pub fn raise_pressure(&mut self, pressure: f64) -> bool {
        let p = self.tuning.normalised_pressure(pressure, self.settings.character);
        if self.target_height.is_none() && p > self.p_target + 1e-9 {
            self.p_target = p;
            self.settings.pressure = pressure;
            self.status = Status::Running;
            self.settled_count = 0;
            self.geo_rebuild();
            true
        } else {
            false
        }
    }

    /// Raise the target height mid-run (mm). Returns true if applied.
    pub fn raise_target_height(&mut self, height_mm: f64) -> bool {
        let h = height_mm / self.scale;
        match self.target_height {
            Some(cur) if h > cur + 1e-9 => {
                self.target_height = Some(h);
                self.settings.target_height_mm = Some(height_mm);
                self.p_target = self.p_now;
                self.height_reached = false;
                self.status = Status::Running;
                self.settled_count = 0;
                self.geo_rebuild();
                true
            }
            _ => false,
        }
    }

    /// Advance one display frame (several substeps). Returns the frame stats.
    pub fn step_frame(&mut self) -> FrameInfo {
        if self.geo.is_some() {
            return self.geo_frame();
        }
        if self.status == Status::Running {
            if self.tuning.core >= 1.0 && !self.soap {
                let mut st = self.statics.take().unwrap_or_else(|| statics::Statics::new(self));
                self.static_frame(&mut st);
                self.statics = Some(st);
            } else {
                let h = self.tuning.substep_dt;
                for _ in 0..self.tuning.substeps_per_frame {
                    self.substep(h);
                }
            }
            self.frame += 1;
            if !self.pos.iter().all(|p| p.is_finite()) {
                // Roll back to the last good positions and stop.
                self.pos.clone_from(&self.prev);
                if !self.pos.iter().all(|p| p.is_finite()) {
                    self.pos = self.mesh.flat.iter().map(|f| DVec3::new((f[0] - self.center[0]) / self.scale, (f[1] - self.center[1]) / self.scale, 0.0)).collect();
                }
                self.stable = false;
                self.status = Status::Settled;
                return self.info();
            }

            let (zmin, zmax) = self.z_range();
            if let Some(th) = self.target_height {
                self.steer_height(th, zmax - zmin);
            }
            // Height mode isn't done while the controller is still raising the
            // pressure: a pause in the motion then (common on Steel, which
            // moves in small static steps) used to end the run far short.
            let pushing = self.target_height.is_some() && !self.height_reached && self.p_now < self.p_full * (1.0 - 1e-6);
            let ramp_done = !pushing && self.p_now >= self.p_target - 1e-12;
            if ramp_done && self.last_motion < self.tuning.settle_displacement {
                self.settled_count += 1;
            } else {
                self.settled_count = 0;
            }
            // Crease hold: the "clamp" comes off once the pressure passes the
            // hold level on the way up — or, if the hold is at or above the
            // final pressure, once the piece has settled there.
            if !self.hold_released {
                let reached = self.slider_pressure() >= self.settings.crease_hold - 1e-6;
                if (reached && !ramp_done) || self.settled_count >= self.tuning.settle_frames {
                    self.hold_released = true;
                    self.settled_count = 0;
                }
            }
            if self.settled_count >= self.tuning.settle_frames || self.frame >= self.tuning.max_frames {
                self.status = Status::Settled;
            }
            let iters = if self.status == Status::Settled { 400 } else { 40 };
            self.update_warp(iters);
        }
        self.info()
    }

    /// Height mode: steer the pressure so the piece rises at a speed that
    /// shrinks as it nears the target, braking (pressure may drop here) so it
    /// arrives without overshooting. Ramping pressure straight up overshoots
    /// badly — the shape lags the pressure and keeps creeping at a fixed
    /// pressure, and a flat pillow gains most of its height at low pressure.
    /// Lowering the pressure only stops growth: the bends already made stay.
    fn steer_height(&mut self, th: f64, h: f64) {
        let v = match self.height_probe {
            Some((_, h0)) => h - h0,
            None => 0.0,
        };
        self.height_probe = Some((self.p_now, h));
        let tn = &self.tuning;
        // Wanted rise per frame: a fixed share of the gap, capped.
        let v_star = ((th - h) * tn.height_approach).clamp(-0.02 * th, tn.height_max_rate * th);
        let dp = self.p_full * tn.height_gain * (v_star - v) / th;
        let p = (self.p_now + dp).clamp(0.0, self.p_full);
        self.p_now = p;
        self.p_target = p;
        if (th - h).abs() < 0.01 * th {
            self.height_reached = true;
        }
    }

    /// Relax the fixed-outline offset field (harmonic: each point takes the
    /// average of its neighbours; weld points are pinned to their drawn spot).
    fn update_warp(&mut self, iterations: u32) {
        if self.warp_nbrs.is_empty() {
            return;
        }
        for i in 0..self.pos.len() {
            if self.mesh.kind[i] == VertexKind::Weld {
                let f = self.mesh.flat[i];
                self.warp[i] = [(f[0] - self.center[0]) / self.scale - self.pos[i].x, (f[1] - self.center[1]) / self.scale - self.pos[i].y];
            }
        }
        for _ in 0..iterations {
            for i in 0..self.pos.len() {
                if self.mesh.kind[i] == VertexKind::Weld || self.warp_nbrs[i].is_empty() {
                    continue;
                }
                let (mut x, mut y) = (0.0, 0.0);
                for &j in &self.warp_nbrs[i] {
                    x += self.warp[j as usize][0];
                    y += self.warp[j as usize][1];
                }
                let k = self.warp_nbrs[i].len() as f64;
                self.warp[i] = [x / k, y / k];
            }
        }
    }

    /// Normalised output position (with the fixed-outline offset applied).
    fn out_pos(&self, i: usize) -> DVec3 {
        let p = self.pos[i];
        let w = self.warp[i];
        DVec3::new(p.x + w[0], p.y + w[1], p.z)
    }

    /// The pressure right now, back on the 0–100 slider scale.
    fn slider_pressure(&self) -> f64 {
        100.0 * (self.p_now / self.p_full).max(0.0).powf(1.0 / self.tuning.pressure_curve)
    }

    fn z_range(&self) -> (f64, f64) {
        self.pos.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), p| (lo.min(p.z), hi.max(p.z)))
    }

    pub fn info(&self) -> FrameInfo {
        let (zmin, zmax) = self.z_range();
        let mut vol = 0.0;
        for t in &self.mesh.tris {
            let (a, b, c) = (self.pos[t[0] as usize], self.pos[t[1] as usize], self.pos[t[2] as usize]);
            vol += a.dot(b.cross(c)) / 6.0;
        }
        let sheet_pts = self.wz.iter().filter(|w| **w > 0.0).count().max(1);
        let touching = self.contact.iter().filter(|c| **c).count();
        let max_stretch = self.stretch.iter().map(|s| s.rest / s.rest0 - 1.0).fold(0.0, f64::max);
        FrameInfo {
            frame: self.frame,
            time: self.time,
            pressure: self.slider_pressure(),
            height_mm: (zmax - zmin) * self.scale,
            volume_ml: vol * self.scale.powi(3) / 1000.0,
            contact_fraction: touching as f64 / sheet_pts as f64,
            max_stretch_pct: 100.0 * max_stretch,
            motion: self.last_motion,
            status: self.status,
            stable: self.stable,
        }
    }

    fn substep(&mut self, h: f64) {
        let tn = &self.tuning;
        let inv_h2 = 1.0 / (h * h);

        // 1. Pressure ramps toward its target, then pushes along triangle normals.
        if self.p_now < self.p_target {
            self.p_now = (self.p_now + self.p_full * h / tn.ramp_time).min(self.p_target);
        }
        for f in self.force.iter_mut() {
            *f = DVec3::ZERO;
        }
        if self.p_now > 0.0 {
            let k = self.p_now / 6.0;
            for t in &self.mesh.tris {
                let (a, b, c) = (self.pos[t[0] as usize], self.pos[t[1] as usize], self.pos[t[2] as usize]);
                let f = (b - a).cross(c - a) * k;
                for &v in t {
                    self.force[v as usize] += f;
                }
            }
        }

        // 2. Predict (damped; extra at the start, see `soft_start_damping`).
        let ramp = (1.0 - self.frame as f64 / tn.soft_start_frames.max(1.0)).max(0.0);
        let keep = 1.0 - (tn.damping + (tn.soft_start_damping - tn.damping).max(0.0) * ramp);
        for i in 0..self.pos.len() {
            let f = self.force[i];
            self.vel[i] += DVec3::new(self.w[i] * f.x, self.w[i] * f.y, self.wz[i] * f.z) * h;
            self.vel[i] *= keep;
            self.prev[i] = self.pos[i];
            self.pos[i] += self.vel[i] * h;
        }

        // 3. Constraints.
        self.warm_start_constraints();
        self.lambda_w.iter_mut().for_each(|l| *l = 0.0);
        let (passes, stretch_passes, weld_passes) = (self.tuning.iterations_per_substep, self.tuning.stretch_passes, self.tuning.weld_passes);
        for _ in 0..passes {
            self.solve_stretch(inv_h2);
            for _ in 0..stretch_passes {
                self.solve_stretch(inv_h2);
            }
            for _ in 0..weld_passes {
                self.solve_weld_links(inv_h2);
            }
            if self.tuning.weld_kink_yield > 0.0 {
                self.solve_weld_kink(inv_h2);
            } else {
                self.solve_weld_bend();
            }
            if !self.soap {
                self.solve_bend(inv_h2);
            }
        }

        // No squashing: hard limit on shortening, iterated on the squashed set.
        if !self.soap && self.tuning.squash_limit > 0.0 {
            self.limit_squash();
        }

        // 4. Plates.
        if let Some((zb, zt)) = self.plates {
            let mu = self.settings.plate_friction.clamp(0.0, 1.0);
            for i in 0..self.pos.len() {
                if self.wz[i] == 0.0 {
                    continue;
                }
                let p = &mut self.pos[i];
                let hit = if p.z > zt {
                    p.z = zt;
                    true
                } else if p.z < zb {
                    p.z = zb;
                    true
                } else {
                    false
                };
                if hit && mu > 0.0 {
                    let q = self.prev[i];
                    p.x -= (p.x - q.x) * mu;
                    p.y -= (p.y - q.y) * mu;
                }
                self.contact[i] = hit;
            }
        }

        // Free seam: keep the piece from drifting up or down (the seam's mean
        // height stays at zero).
        if self.tuning.weld_free_z > 0.0 {
            let (mut sum, mut cnt) = (0.0_f64, 0.0_f64);
            for (p, k) in self.pos.iter().zip(&self.mesh.kind) {
                if *k == VertexKind::Weld {
                    sum += p.z;
                    cnt += 1.0;
                }
            }
            let dz = sum / cnt.max(1.0);
            for (p, q) in self.pos.iter_mut().zip(self.prev.iter_mut()) {
                p.z -= dz;
                q.z -= dz;
            }
        }

        // 5. Permanent set, judged on the solved shape (judging it on the
        //    predicted shape would ratchet the metal longer every substep).
        self.apply_plasticity(inv_h2);

        // 6. Velocities from positions.
        let mut motion: f64 = 0.0;
        for i in 0..self.pos.len() {
            let d = self.pos[i] - self.prev[i];
            motion = motion.max(d.length_squared());
            self.vel[i] = d / h;
        }
        self.last_motion = motion.sqrt();
        self.time += h;
    }

    /// Permanent set from the forces the solver just applied (λ/h²): a link
    /// whose tension passes its yield force lengthens by the excess; a hinge
    /// whose moment passes its plastic moment re-sets its rest angle. Judging
    /// by force rather than apparent strain keeps solver error from being
    /// mistaken for yielding, so the result doesn't depend on the time step.
    fn apply_plasticity(&mut self, inv_h2: f64) {
        let ey = self.tuning.elastic_strain_at_yield;
        let rate = self.tuning.plastic_rate;
        let hard = self.tuning.stretch_hardening;
        // With warm start, a yielded link/hinge carries no more than its yield
        // force into the next substep (perfect plasticity); otherwise the
        // stale excess re-yields it every substep and it runs away.
        let (cap_s, cap_b) = (self.tuning.warm_start > 0.0, self.tuning.warm_start_bend > 0.0);
        for (s, lam) in self.stretch.iter_mut().zip(self.lambda_s.iter_mut()) {
            if s.weld {
                continue;
            }
            let tension = -*lam * inv_h2;
            let mut fy = ey * s.rest0 / s.alpha;
            if hard > 0.0 {
                // 304 hardening curve relative to first yield (215 MPa).
                let ep = (s.rest / s.rest0 - 1.0).max(0.0);
                fy *= 1.0 + hard * ((1275.0 / 215.0) * ep.powf(0.45) - 1.0).max(0.0);
            }
            if tension > fy {
                s.rest = (s.rest + (tension - fy) * s.alpha * rate).min(s.rest_max);
                if cap_s {
                    *lam = -fy / inv_h2;
                }
            } else if self.soap && -tension > fy {
                s.rest = (s.rest - (-tension - fy) * s.alpha * rate).max(s.rest0 * 0.02);
            }
        }
        if self.tuning.weld_kink_yield > 0.0 && !self.soap {
            // Yielding seam: a sideways force past the flange's yield kinks it
            // for good (its rest offset follows), so later kinks gather there.
            let alpha = self.tuning.elastic_strain_at_yield / self.tuning.weld_flange_stiffness.max(1e-9);
            for (wb, lam) in self.weld_bend.iter_mut().zip(&self.lambda_w) {
                let (pa, pc) = (self.pos[wb.0 as usize], self.pos[wb.2 as usize]);
                let seg = 0.5 * DVec3::new(pc.x - pa.x, pc.y - pa.y, 0.0).length();
                let force = -lam * inv_h2;
                let fy = self.tuning.weld_kink_yield * seg;
                if force.abs() > fy {
                    wb.3 += force.signum() * (force.abs() - fy) * alpha * rate;
                }
            }
        }
        if self.soap || !self.hold_released {
            return;
        }
        let hardening = self.tuning.bend_hardening;
        for (b, lam) in self.bend.iter_mut().zip(self.lambda_b.iter_mut()) {
            let moment = -*lam * inv_h2;
            // Work hardening: a fold gets harder to bend further the more it
            // has already yielded, so bending spreads instead of sharpening.
            let my = b.theta_y / b.alpha * (1.0 + hardening * b.set);
            if moment.abs() > my {
                let d = (moment.abs() - my) * b.alpha * rate;
                b.rest = wrap_angle(b.rest + moment.signum() * d);
                b.set += d;
                if cap_b {
                    *lam = -moment.signum() * my / inv_h2;
                }
            }
        }
    }

    /// Start each multiplier at a share of last substep's (`warm_start`,
    /// `warm_start_bend`) and apply that impulse up front; zero when off.
    /// Same XPBD equations, better first guess.
    fn warm_start_constraints(&mut self) {
        let ws = self.tuning.warm_start;
        if ws > 0.0 {
            let tension_too = self.tuning.warm_start_tension > 0.0;
            for (s, lam) in self.stretch.iter().zip(self.lambda_s.iter_mut()) {
                // λ > 0 = compression (see solve_stretch).
                *lam = if *lam > 0.0 || tension_too { *lam * ws } else { 0.0 };
                let (ia, ib) = (s.a as usize, s.b as usize);
                let d = self.pos[ib] - self.pos[ia];
                let l = d.length();
                if l < 1e-12 {
                    continue;
                }
                let n = d / l;
                let dl = *lam;
                self.pos[ia] -= DVec3::new(self.w[ia] * n.x, self.w[ia] * n.y, self.wz[ia] * n.z) * dl;
                self.pos[ib] += DVec3::new(self.w[ib] * n.x, self.w[ib] * n.y, self.wz[ib] * n.z) * dl;
            }
        } else {
            self.lambda_s.iter_mut().for_each(|l| *l = 0.0);
        }
        let wb = self.tuning.warm_start_bend;
        if wb > 0.0 && !self.soap {
            for (b, lam) in self.bend.iter().zip(self.lambda_b.iter_mut()) {
                *lam *= wb;
                let iv = b.v.map(|v| v as usize);
                let Some((_, g)) = dihedral(self.pos[iv[0]], self.pos[iv[1]], self.pos[iv[2]], self.pos[iv[3]]) else {
                    continue;
                };
                let dl = *lam;
                for j in 0..4 {
                    let (wv, wzv) = (self.w[iv[j]], self.wz[iv[j]]);
                    self.pos[iv[j]] += DVec3::new(wv * g[j].x, wv * g[j].y, wzv * g[j].z) * dl;
                }
            }
        } else {
            self.lambda_b.iter_mut().for_each(|l| *l = 0.0);
        }
    }

    /// Strain limiting in compression (`squash_limit`): collect the links
    /// shorter than (1 − limit) × rest, then project just those back to that
    /// length for `squash_passes` passes (neighbours they push are caught on
    /// the next substep).
    fn limit_squash(&mut self) {
        let lim = 1.0 - self.tuning.squash_limit;
        let active: Vec<usize> = self
            .stretch
            .iter()
            .enumerate()
            .filter(|(_, s)| (self.pos[s.b as usize] - self.pos[s.a as usize]).length() < s.rest * lim)
            .map(|(k, _)| k)
            .collect();
        for _ in 0..self.tuning.squash_passes {
            for &k in &active {
                let s = &self.stretch[k];
                let (ia, ib) = (s.a as usize, s.b as usize);
                let d = self.pos[ib] - self.pos[ia];
                let l = d.length();
                let target = s.rest * lim;
                if l >= target || l < 1e-12 {
                    continue;
                }
                let n = d / l;
                let (wa, wza, wb, wzb) = (self.w[ia], self.wz[ia], self.w[ib], self.wz[ib]);
                let denom = (wa + wb) * (n.x * n.x + n.y * n.y) + (wza + wzb) * n.z * n.z;
                if denom < 1e-20 {
                    continue;
                }
                let dl = (target - l) / denom;
                self.pos[ia] -= DVec3::new(wa * n.x, wa * n.y, wza * n.z) * dl;
                self.pos[ib] += DVec3::new(wb * n.x, wb * n.y, wzb * n.z) * dl;
            }
        }
    }

    /// Extra Gauss-Seidel passes over the weld links only (`weld_passes`).
    fn solve_weld_links(&mut self, inv_h2: f64) {
        for &k in &self.weld_links {
            let s = &self.stretch[k];
            let (ia, ib) = (s.a as usize, s.b as usize);
            let d = self.pos[ib] - self.pos[ia];
            let l = d.length();
            if l < 1e-12 {
                continue;
            }
            let n = d / l;
            let c = l - s.rest;
            let alpha = s.alpha * inv_h2;
            let (wa, wza, wb, wzb) = (self.w[ia], self.wz[ia], self.w[ib], self.wz[ib]);
            let denom = (wa + wb) * (n.x * n.x + n.y * n.y) + (wza + wzb) * n.z * n.z + alpha;
            if denom < 1e-20 {
                continue;
            }
            let lam = &mut self.lambda_s[k];
            let dl = (-c - alpha * *lam) / denom;
            *lam += dl;
            self.pos[ia] -= DVec3::new(wa * n.x, wa * n.y, wza * n.z) * dl;
            self.pos[ib] += DVec3::new(wb * n.x, wb * n.y, wzb * n.z) * dl;
        }
    }

    fn solve_stretch(&mut self, inv_h2: f64) {
        let compression = self.tuning.compression_factor;
        let soap = self.soap;
        let (stretch, w, wz) = (&self.stretch[..], &self.w[..], &self.wz[..]);
        let pos = par::Shared(self.pos.as_mut_ptr());
        let lambda = par::Shared(self.lambda_s.as_mut_ptr());
        par::for_batches(&self.colour_s, |k| {
            let s = &stretch[k];
            let (ia, ib) = (s.a as usize, s.b as usize);
            // Safety: links in one batch share no point (see `par`).
            let (pa, pb) = unsafe { (pos.at(ia), pos.at(ib)) };
            let d = *pb - *pa;
            let l = d.length();
            if l < 1e-12 {
                return;
            }
            let n = d / l;
            let c = l - s.rest;
            let mut alpha = s.alpha * inv_h2;
            if c < 0.0 && !s.weld && !soap {
                alpha /= compression;
            }
            let (wa, wza, wb, wzb) = (w[ia], wz[ia], w[ib], wz[ib]);
            let nxy2 = n.x * n.x + n.y * n.y;
            let nz2 = n.z * n.z;
            let denom = (wa + wb) * nxy2 + (wza + wzb) * nz2 + alpha;
            if denom < 1e-20 {
                return;
            }
            let lam = unsafe { lambda.at(k) };
            let dl = (-c - alpha * *lam) / denom;
            *lam += dl;
            *pa -= DVec3::new(wa * n.x, wa * n.y, wza * n.z) * dl;
            *pb += DVec3::new(wb * n.x, wb * n.y, wzb * n.z) * dl;
        });
    }

    /// Yielding seam (XPBD): like `solve_weld_bend` but with a real stiffness
    /// and multipliers, so `apply_plasticity` can read the sideways force.
    fn solve_weld_kink(&mut self, inv_h2: f64) {
        let alpha = self.tuning.elastic_strain_at_yield / self.tuning.weld_flange_stiffness.max(1e-9) * inv_h2;
        for (k, &(a, b, c, d0)) in self.weld_bend.iter().enumerate() {
            let (pa, pb, pc) = (self.pos[a as usize], self.pos[b as usize], self.pos[c as usize]);
            let ac = DVec3::new(pc.x - pa.x, pc.y - pa.y, 0.0);
            let l = ac.length();
            if l < 1e-12 {
                continue;
            }
            let nrm = DVec3::new(-ac.y / l, ac.x / l, 0.0);
            let err = side_offset(pa, pb, pc) - d0;
            let (wa, wb, wc) = (self.w[a as usize], self.w[b as usize], self.w[c as usize]);
            let denom = wb + 0.25 * (wa + wc) + alpha;
            if denom < 1e-20 {
                continue;
            }
            let lam = &mut self.lambda_w[k];
            let dl = (-err - alpha * *lam) / denom;
            *lam += dl;
            self.pos[b as usize] += nrm * (dl * wb);
            self.pos[a as usize] -= nrm * (dl * 0.5 * wa);
            self.pos[c as usize] -= nrm * (dl * 0.5 * wc);
        }
    }

    /// Keep weld lines from kinking sideways at mesh scale (in-plane only;
    /// weld points stay on the weld plane anyway).
    fn solve_weld_bend(&mut self) {
        let k = self.tuning.weld_straightness;
        if k <= 0.0 {
            return;
        }
        for &(a, b, c, d0) in &self.weld_bend {
            let (pa, pb, pc) = (self.pos[a as usize], self.pos[b as usize], self.pos[c as usize]);
            let ac = DVec3::new(pc.x - pa.x, pc.y - pa.y, 0.0);
            let l = ac.length();
            if l < 1e-12 {
                continue;
            }
            let nrm = DVec3::new(-ac.y / l, ac.x / l, 0.0);
            let err = side_offset(pa, pb, pc) - d0;
            // b moves against the error; a and c share the opposite move
            // (gradient weights 1 and -1/2, -1/2).
            let (wa, wb, wc) = (self.w[a as usize], self.w[b as usize], self.w[c as usize]);
            let denom = wb + 0.25 * (wa + wc);
            if denom < 1e-20 {
                continue;
            }
            let s = -k * err / denom;
            self.pos[b as usize] += nrm * (s * wb);
            self.pos[a as usize] -= nrm * (s * 0.5 * wa);
            self.pos[c as usize] -= nrm * (s * 0.5 * wc);
        }
    }

    fn solve_bend(&mut self, inv_h2: f64) {
        let (bend, w, wz) = (&self.bend[..], &self.w[..], &self.wz[..]);
        let pos = par::Shared(self.pos.as_mut_ptr());
        let lambda = par::Shared(self.lambda_b.as_mut_ptr());
        par::for_batches(&self.colour_b, |k| {
            let b = &bend[k];
            let iv = b.v.map(|v| v as usize);
            // Safety: hinges in one batch share no point (see `par`).
            let p = unsafe { iv.map(|i| pos.at(i)) };
            let Some((theta, g)) = dihedral(*p[0], *p[1], *p[2], *p[3]) else {
                return;
            };
            let c = wrap_angle(theta - b.rest);
            let alpha = b.alpha * inv_h2;
            let mut denom = alpha;
            for j in 0..4 {
                denom += w[iv[j]] * (g[j].x * g[j].x + g[j].y * g[j].y) + wz[iv[j]] * g[j].z * g[j].z;
            }
            if denom < 1e-20 {
                return;
            }
            let lam = unsafe { lambda.at(k) };
            let dl = (-c - alpha * *lam) / denom;
            *lam += dl;
            for j in 0..4 {
                let (wv, wzv) = (w[iv[j]], wz[iv[j]]);
                *p[j] += DVec3::new(wv * g[j].x, wv * g[j].y, wzv * g[j].z) * dl;
            }
        });
    }

    /// The thickness (mm) the sheet bends with: its real thickness scaled by
    /// Balloon ↔ Geometric (see `Tuning::thickness_ratio`).
    pub fn thickness_mm(&self) -> f64 {
        self.tuning.thickness_ratio(self.settings.thickness_mm.max(0.01) / self.scale, self.settings.character) * self.scale
    }

    /// Finisher settings for this run: the caller's smoothing choices plus
    /// edge ripples sized from the sheet thickness.
    pub fn finish_params(&self, mut p: crate::finish::FinishParams) -> crate::finish::FinishParams {
        p.ripple_wavelength_mm = self.tuning.ripple_wavelength_factor * (self.scale * self.thickness_mm()).sqrt();
        p.ripple_strength = if self.soap { 0.0 } else { self.settings.edge_ripples.clamp(0.0, 1.0) };
        p.fillet_radius_mm = if self.soap { 0.0 } else { self.settings.weld_fillet_mm.max(0.0) };
        p.fillet_steps = self.tuning.fillet_steps.round().max(1.0) as u32;
        p.fillet_max_reach = self.tuning.fillet_max_reach;
        p.thickness_mm = if self.soap { 0.0 } else { self.settings.thickness_mm.max(0.0) };
        p
    }

    // ── Output ───────────────────────────────────────────────────────────

    /// Positions in mm, in the outline's own coordinates (x, y as drawn).
    pub fn positions_mm(&self, out: &mut Vec<f32>) {
        out.clear();
        out.reserve(self.pos.len() * 3);
        for i in 0..self.pos.len() {
            let p = self.out_pos(i);
            out.push((p.x * self.scale + self.center[0]) as f32);
            out.push((p.y * self.scale + self.center[1]) as f32);
            out.push((p.z * self.scale) as f32);
        }
    }

    pub fn positions_f64_mm(&self) -> Vec<[f64; 3]> {
        (0..self.pos.len())
            .map(|i| {
                let p = self.out_pos(i);
                [p.x * self.scale + self.center[0], p.y * self.scale + self.center[1], p.z * self.scale]
            })
            .collect()
    }

    /// Per-point crease strength (largest permanent fold angle at the point, radians).
    pub fn crease_field(&self) -> Vec<f32> {
        let mut out = vec![0f32; self.pos.len()];
        for b in &self.bend {
            if self.mesh.kind[b.v[0] as usize] == VertexKind::Weld && self.mesh.kind[b.v[1] as usize] == VertexKind::Weld {
                continue; // seam hinges rest at the closed-book angle, not a crease
            }
            let r = b.rest.abs() as f32;
            for &v in &b.v[..2] {
                let o = &mut out[v as usize];
                *o = o.max(r);
            }
        }
        out
    }

    /// Per-point plate contact (1 = touching).
    pub fn contact_field(&self) -> Vec<f32> {
        self.contact.iter().map(|c| if *c { 1.0 } else { 0.0 }).collect()
    }

    pub fn num_vertices(&self) -> usize {
        self.pos.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings::PlateSettings;
    use crate::shapes;

    #[test]
    fn dihedral_gradient_matches_finite_differences() {
        let p = [
            DVec3::new(0.1, -0.05, 0.02),
            DVec3::new(1.0, 0.1, -0.03),
            DVec3::new(0.4, 0.9, 0.3),
            DVec3::new(0.6, -0.8, 0.25),
        ];
        let (_, g) = dihedral(p[0], p[1], p[2], p[3]).unwrap();
        let eps = 1e-6;
        for j in 0..4 {
            for axis in 0..3 {
                let mut q = p;
                q[j][axis] += eps;
                let (tp, _) = dihedral(q[0], q[1], q[2], q[3]).unwrap();
                q[j][axis] -= 2.0 * eps;
                let (tm, _) = dihedral(q[0], q[1], q[2], q[3]).unwrap();
                let fd = (tp - tm) / (2.0 * eps);
                assert!((fd - g[j][axis]).abs() < 1e-5, "vertex {j} axis {axis}: fd {fd} vs analytic {}", g[j][axis]);
            }
        }
    }

    #[test]
    fn flat_is_zero_angle() {
        let (t, _) = dihedral(
            DVec3::new(0.0, 0.0, 0.0),
            DVec3::new(1.0, 0.0, 0.0),
            DVec3::new(0.5, 1.0, 0.0),
            DVec3::new(0.5, -1.0, 0.0),
        )
        .unwrap();
        assert!(t.abs() < 1e-12);
    }

    fn run(piece: Piece, settings: SimSettings, frames: u32) -> Sim {
        let mut sim = Sim::new(&[piece], settings).unwrap();
        for _ in 0..frames {
            if sim.step_frame().status == Status::Settled {
                break;
            }
        }
        sim
    }

    fn quick() -> SimSettings {
        SimSettings { quality: MeshQuality::Draft, ..Default::default() }
    }

    /// Width kept between the two seams 30 mm back from a triangle's top tip.
    fn tip_width_kept(sim: &Sim) -> f64 {
        let pm = sim.positions_f64_mm();
        let tip = [0.0, 150.0];
        let at = |q: [f64; 2]| {
            (0..pm.len())
                .filter(|&i| sim.mesh.kind[i] == VertexKind::Weld)
                .min_by(|&i, &j| {
                    let d = |i: usize| (sim.mesh.flat[i][0] - q[0]).hypot(sim.mesh.flat[i][1] - q[1]);
                    d(i).total_cmp(&d(j))
                })
                .unwrap()
        };
        let s: f64 = 15.0; // inside the stiff zone (corner_reach 0.25 ≈ 24 mm here)
        let (dx, dy) = (s * 30f64.to_radians().sin(), s * 30f64.to_radians().cos());
        let (i, j) = (at([tip[0] - dx, tip[1] - dy]), at([tip[0] + dx, tip[1] - dy]));
        let w0 = (sim.mesh.flat[i][0] - sim.mesh.flat[j][0]).hypot(sim.mesh.flat[i][1] - sim.mesh.flat[j][1]);
        (pm[i][0] - pm[j][0]).hypot(pm[i][1] - pm[j][1]) / w0
    }

    #[test]
    fn sharp_welded_tips_keep_their_shape() {
        let stiff = run(shapes::polygon(3, 300.0), quick(), 120);
        let mut tn = Tuning::default();
        tn.corner_reach = 0.0;
        let mut free = Sim::with_tuning(&[shapes::polygon(3, 300.0)], quick(), tn).unwrap();
        for _ in 0..120 {
            if free.step_frame().status == Status::Settled {
                break;
            }
        }
        let (ws, wf) = (tip_width_kept(&stiff), tip_width_kept(&free));
        assert!(ws > 0.95, "stiff tip kept only {ws:.2} of its width (free {wf:.2})");
        assert!(ws > wf + 0.05, "corners made no difference ({ws:.2} vs {wf:.2})");
    }

    #[test]
    fn same_seed_gives_identical_output() {
        let a = run(shapes::square(200.0), quick(), 10).positions_f64_mm();
        let b = run(shapes::square(200.0), quick(), 10).positions_f64_mm();
        assert_eq!(a, b);
        let mut other = quick();
        other.seed = 99;
        let c = run(shapes::square(200.0), other, 10).positions_f64_mm();
        assert_ne!(a, c);
    }

    #[test]
    fn inflates_symmetrically_and_welds_stay_put() {
        let sim = run(shapes::circle(200.0), quick(), 40);
        let info = sim.info();
        assert!(info.height_mm > 20.0, "height only {}", info.height_mm);
        assert!(info.volume_ml > 0.0);
        let pos = sim.positions_f64_mm();
        for (i, k) in sim.mesh.kind.iter().enumerate() {
            if *k == VertexKind::Weld {
                assert!(pos[i][2].abs() < 1e-9, "weld point left the weld plane");
            }
        }
    }

    #[test]
    fn plates_are_never_crossed() {
        let mut s = quick();
        s.pressure = 100.0;
        s.thickness_mm = 0.6; // as v1's default Character on this size
        s.plates = Some(PlateSettings { thickness_mm: 30.0, offset_mm: 0.0 });
        let sim = run(shapes::circle(200.0), s, 60);
        let pos = sim.positions_f64_mm();
        let zmax = pos.iter().map(|p| p[2]).fold(f64::MIN, f64::max);
        let zmin = pos.iter().map(|p| p[2]).fold(f64::MAX, f64::min);
        assert!(zmax <= 15.0 + 1e-6 && zmin >= -15.0 - 1e-6, "z range {zmin}..{zmax}");
        // 0.12: the stiffer in-plane solve (session 7) presses a smaller flat patch.
        assert!(sim.info().contact_fraction > 0.12, "barely touching the plates: {} h {}", sim.info().contact_fraction, sim.info().height_mm);
    }

    #[test]
    fn fixed_outline_does_not_move() {
        let mut s = quick();
        s.fix_outline = true;
        let sim = run(shapes::square(200.0), s, 30);
        let pos = sim.positions_f64_mm();
        for (i, k) in sim.mesh.kind.iter().enumerate() {
            if *k == VertexKind::Weld {
                let f = sim.mesh.flat[i];
                assert!((pos[i][0] - f[0]).abs() < 1e-9 && (pos[i][1] - f[1]).abs() < 1e-9, "weld point moved");
            }
        }
        // …and with it free, the edge draws inward.
        let free = run(shapes::square(200.0), quick(), 30);
        let pos = free.positions_f64_mm();
        let moved = free.mesh.kind.iter().enumerate().filter(|(_, k)| **k == VertexKind::Weld).any(|(i, _)| (pos[i][0] - free.mesh.flat[i][0]).abs() > 0.5);
        assert!(moved, "free outline never drew in");
    }

    #[test]
    fn pressure_only_goes_forward() {
        let mut sim = Sim::new(&[shapes::circle(100.0)], quick()).unwrap();
        assert!(!sim.raise_pressure(10.0));
        assert!(sim.raise_pressure(90.0));
    }
}
