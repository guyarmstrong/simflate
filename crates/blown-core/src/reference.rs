//! Reference solver support: write a KIT-style "Die-Less Hydroforming" model
//! (LS-DYNA keywords) for OpenCourant from a BlownSim mesh, and read its
//! results back (animation frames as VTK text, airbag pressure from the time
//! history). Same recipe as `reference/kit_deck.py`; see docs/REFERENCE_SOLVER.md.
//!
//! Units: mm, s, tonne, N (MPa). Node id = BlownSim vertex index + 1.

use crate::config::Tuning;

/// 304 (1.4301) yield stress, MPa (start of the Ludwik curve below).
pub const YIELD_MPA: f64 = 215.0;

#[derive(Clone, Debug)]
pub struct RefOptions {
    pub thickness_mm: f64,
    /// Water pumped in by the end of the run, litres.
    pub volume_l: f64,
    /// Simulated pumping time, s.
    pub time_s: f64,
    pub frames: u32,
    /// Starting gap between the sheets, mm.
    pub gap_mm: f64,
    /// Water bulk modulus, MPa.
    pub bulk_mpa: f64,
    pub contact: bool,
    /// Mass scaling: elements whose stable step is below this get just enough
    /// added mass to reach it (s). 0 = off.
    pub dt_min: f64,
    /// Out-of-flatness of each sheet, mm (largest bump): a smooth random
    /// waviness, different on the two sheets, so the model isn't perfectly
    /// symmetric and buckles can pick their places as on a real piece. 0 = flat.
    pub imperfection_mm: f64,
    /// Seed for the waviness (same seed, same sheets).
    pub seed: u64,
    /// Symmetric solver: mirror planes (vertical, through the origin) as
    /// (unit normal in x, y; point indices on the plane). Points on a plane
    /// can't cross it or tilt across it.
    pub mirrors: Vec<([f64; 2], Vec<u32>)>,
    /// Points on every mirror plane (the centre): only free to rise.
    pub centre: Vec<u32>,
    /// Extra starting height per point, mm (seeded edge waves); empty = none.
    pub z_seed: Vec<f32>,
}

impl Default for RefOptions {
    fn default() -> Self {
        RefOptions { thickness_mm: 0.8, volume_l: 4.0, time_s: 0.05, frames: 40, gap_mm: 0.3, bulk_mpa: 2200.0, contact: true, dt_min: 8.0e-7, imperfection_mm: 0.0, seed: 1, mirrors: vec![], centre: vec![], z_seed: vec![] }
    }
}

/// Flat area (mm²) of the top sheet: the piece's area.
pub fn flat_area(positions: &[f32], indices: &[u32], top_triangles: usize) -> f64 {
    let p = |i: u32| [positions[3 * i as usize] as f64, positions[3 * i as usize + 1] as f64];
    indices
        .chunks(3)
        .take(top_triangles)
        .map(|t| {
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs()
        })
        .sum()
}

/// A run plan for a piece of this area: enough water to over-fill it (the run
/// is normally stopped earlier, at the target pressure or height), pumped
/// slowly enough to stay quasi-static (KIT ring: 3 L in 50 ms, kinetic
/// energy 0.2 % of internal). Session 14: 1.5x faster than before — Guy's leaf
/// keeps kinetic energy at 2.5–3.5 % of internal, same piece (0.5 mm mean).
pub fn plan(area_mm2: f64, thickness_mm: f64) -> RefOptions {
    let r = (area_mm2 / std::f64::consts::PI).sqrt();
    let volume_l = 0.3 * area_mm2.powf(1.5) / 1.0e6;
    let time_s = (0.08 * r / 175.0).clamp(0.033, 0.2);
    RefOptions { thickness_mm, volume_l, time_s, frames: 60, ..RefOptions::default() }
}

/// Real water pressure (MPa) for the app's 0–100 Pressure slider: the same
/// normalised pressure the fast solver uses, read as the regime number
/// p·R / (σy·t), with R = √(area/π).
pub fn slider_to_mpa(tuning: &Tuning, slider: f64, character: f64, area_mm2: f64, thickness_mm: f64) -> f64 {
    let r = (area_mm2 / std::f64::consts::PI).sqrt();
    tuning.normalised_pressure(slider, character) * YIELD_MPA * thickness_mm / r
}

/// The inverse of `slider_to_mpa`, for showing a reference frame's pressure on the slider's scale.
pub fn mpa_to_slider(tuning: &Tuning, mpa: f64, character: f64, area_mm2: f64, thickness_mm: f64) -> f64 {
    let full = slider_to_mpa(tuning, 100.0, character, area_mm2, thickness_mm);
    if !(full > 0.0) || mpa <= 0.0 {
        return 0.0;
    }
    100.0 * (mpa / full).powf(1.0 / tuning.pressure_curve)
}

/// Python-style scientific number ("8.00e-07"), right-aligned in `width`.
fn sci(x: f64, prec: usize, width: usize) -> String {
    let s = format!("{x:.prec$e}");
    let (m, e) = s.split_once('e').unwrap_or((&s, "0"));
    let e: i32 = e.parse().unwrap_or(0);
    let t = format!("{m}e{}{:02}", if e < 0 { '-' } else { '+' }, e.abs());
    format!("{t:>width$}")
}

/// The model file (model.k). `positions` = the flat mesh (x, y used), `weld`
/// = 1 on weld points, the first `top_triangles` triangles are the top sheet.
pub fn deck(title: &str, positions: &[f32], indices: &[u32], weld: &[u8], top_triangles: usize, o: &RefOptions) -> String {
    let n = positions.len() / 3;
    let t = o.thickness_mm;
    let zoff = (t + o.gap_mm) / 2.0;
    // Which sheet each interior point belongs to; weld points are shared (z = 0).
    let mut sheet = vec![None; n];
    for (ti, tri) in indices.chunks(3).enumerate() {
        for &v in tri {
            if weld[v as usize] == 0 {
                sheet[v as usize] = Some(if ti < top_triangles { 0 } else { 1 });
            }
        }
    }
    let wave = Waviness::new(positions, o.imperfection_mm, o.seed);
    let tt = o.time_s;
    let mut s = String::with_capacity(n * 60 + indices.len() * 12);
    let mut line = |l: &str| {
        s.push_str(l);
        s.push('\n');
    };
    line("*KEYWORD");
    line("*TITLE");
    line(&format!("BlownSim reference - KIT die-less hydroforming ({title})"));
    line("*CONTROL_TERMINATION");
    line(&format!("{tt:10.5}"));
    line("*CONTROL_TIMESTEP");
    line("$   dtinit    tssfac      isdo    tslimt     dt2ms");
    line(&format!("{:10.1}{:10.2}{:10}{:10.1}{}", 0.0, 0.9, 0, 0.0, sci(-o.dt_min, 2, 10)));
    line("*DATABASE_BINARY_D3PLOT");
    line(&format!("{:10.6}", tt / o.frames as f64));
    line("*DATABASE_GLSTAT");
    line(&format!("{:10.6}", tt / 200.0));
    line("*DATABASE_ABSTAT");
    line(&format!("{:10.6}", tt / 200.0));
    line("*PART");
    line("top sheet");
    line("         1         1         1");
    line("*PART");
    line("bottom sheet");
    line("         2         1         1");
    line("*SECTION_SHELL");
    line("$    secid    elform      shrf       nip");
    line("         1         2    0.8333         5");
    line(&format!("{t:10.4}{t:10.4}{t:10.4}{t:10.4}"));
    line("*MAT_PIECEWISE_LINEAR_PLASTICITY");
    line("$      mid        ro         e        pr      sigy      etan");
    line("         1   7.90e-9  193000.0       0.3     215.0       0.0");
    line("$     fail      tdel         c         p      lcss      lcsr        vp");
    line("       0.0       0.0       0.0       0.0         3         0       0.0");
    line("       0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0");
    line("       0.0       0.0       0.0       0.0       0.0       0.0       0.0       0.0");
    line("*DEFINE_CURVE");
    line("         3");
    line("$ plastic strain, true stress (MPa): 304, Ludwik 215 + 1275*ep^0.75");
    for ep in [0.0f64, 0.002, 0.005, 0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.45, 0.6, 1.0] {
        line(&format!("{ep:20.5}{:20.3}", YIELD_MPA + 1275.0 * ep.powf(0.75)));
    }
    line("*NODE");
    for i in 0..n {
        let (x, y) = (positions[3 * i] as f64, positions[3 * i + 1] as f64);
        let seed = o.z_seed.get(i).copied().unwrap_or(0.0) as f64;
        let z = seed
            + match sheet[i] {
                None => 0.0,
                Some(0) => zoff + wave.at(0, x, y),
                Some(_) => -zoff + wave.at(1, x, y),
            };
        line(&format!("{:8}{:16.5}{:16.5}{:16.5}", i + 1, positions[3 * i], positions[3 * i + 1], z));
    }
    line("*ELEMENT_SHELL");
    for (ti, tri) in indices.chunks(3).enumerate() {
        let pid = if ti < top_triangles { 1 } else { 2 };
        line(&format!("{:8}{:8}{:8}{:8}{:8}{:8}", ti + 1, pid, tri[0] + 1, tri[1] + 1, tri[2] + 1, tri[2] + 1));
    }
    line("*SET_PART_LIST");
    line("         1");
    line("         1         2");
    // Mirror planes: in a frame whose x is the plane's normal, no movement
    // along x and no turning about the plane's own two directions.
    for (k, (nrm, nodes)) in o.mirrors.iter().enumerate() {
        let cid = k + 1;
        line("*DEFINE_COORDINATE_SYSTEM");
        line("$      cid        xo        yo        zo        xl        yl        zl");
        line(&format!("{cid:10}{:10.1}{:10.1}{:10.1}{:10.6}{:10.6}{:10.1}", 0.0, 0.0, 0.0, nrm[0], nrm[1], 0.0));
        line(&format!("{:10.6}{:10.6}{:10.1}", -nrm[1], nrm[0], 0.0));
        line("*BOUNDARY_SPC_NODE");
        line("$      nid       cid      dofx      dofy      dofz     dofrx     dofry     dofrz");
        for &v in nodes {
            line(&format!("{:10}{cid:10}         1         0         0         0         1         1", v + 1));
        }
    }
    if !o.centre.is_empty() {
        line("*BOUNDARY_SPC_NODE");
        for &v in &o.centre {
            line(&format!("{:10}         0         1         1         0         1         1         1", v + 1));
        }
    }
    if o.contact {
        line("*CONTACT_AUTOMATIC_SINGLE_SURFACE");
        line("$     ssid      msid     sstyp     mstyp");
        line("         1         0         2         0");
        line("$       fs        fd");
        line("       0.1       0.1");
        line("");
    }
    // Water pumped in: the mass rate ramps up over the first 10 %, then stays
    // constant, so the total is about the planned volume.
    let rho = 1.0e-9;
    let rate = rho * o.volume_l * 1.0e6 / (0.95 * tt);
    line("*AIRBAG_LINEAR_FLUID");
    line("$      sid    sidtyp      rbid      vsca      psca      vini       mwd      spsf");
    line("         1         1         0       1.0       1.0       0.0       0.0       0.0");
    line("$     bulk        ro     lcint    lcoutt    lcoutp     lcfit    lcbulk      lcid");
    line(&format!("{:10.1}{}         2         0         0         0         0         0", o.bulk_mpa, sci(rho, 2, 10)));
    line("*DEFINE_CURVE");
    line("         2");
    line(&format!("{:20.6}{}", 0.0, sci(0.0, 6, 20)));
    line(&format!("{:20.6}{}", 0.1 * tt, sci(rate, 6, 20)));
    line(&format!("{tt:20.6}{}", sci(rate, 6, 20)));
    line("*END");
    s
}

/// Height of the seeded edge waves: twice the sheet thickness, at least 0.3 mm
/// — enough to pick where the buckles start, far below what they grow to.
pub fn edge_wave_mm(thickness_mm: f64) -> f64 {
    (2.0 * thickness_mm).max(0.3)
}

/// Seeded edge waves ("Waves per edge", Symmetric solver): a small, regular
/// up-and-down ripple of the weld and the metal beside it, laid on before
/// pumping so the edge buckles start evenly spaced instead of wherever the
/// sheet happens to give first. Each edge between two corners (turns over
/// 35°) gets `waves` crests, shaped cos(2πk·s/L) under a sin(π·s/L) window
/// (zero at the corners, the same from either end, so a mirror line through
/// the edge's middle stays a mirror line). Both sheets move with the weld,
/// fading over half a wavelength. Returns a z offset per point (mm); all zero
/// for an outline without corners.
pub fn edge_waves(positions: &[f32], indices: &[u32], top_triangles: usize, waves: u32, amp_mm: f64) -> Vec<f32> {
    let n = positions.len() / 3;
    let mut out = vec![0.0f32; n];
    let Ok(ring) = crate::symmetry::outline_ring(indices, top_triangles) else { return out };
    let m = ring.len();
    if waves == 0 || amp_mm <= 0.0 || m < 6 {
        return out;
    }
    let xy = |i: u32| [positions[3 * i as usize] as f64, positions[3 * i as usize + 1] as f64];
    let p: Vec<[f64; 2]> = ring.iter().map(|&i| xy(i)).collect();
    let corners: Vec<usize> = (0..m)
        .filter(|&i| {
            let (a, b, c) = (p[(i + m - 1) % m], p[i], p[(i + 1) % m]);
            let (u, v) = ([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]);
            let cos = (u[0] * v[0] + u[1] * v[1]) / (u[0].hypot(u[1]) * v[0].hypot(v[1])).max(1e-12);
            cos < 35f64.to_radians().cos()
        })
        .collect();
    if corners.is_empty() {
        return out;
    }
    // Wave height and reach at every outline point.
    let mut ring_z = vec![0.0f64; m];
    let mut ring_reach = vec![1.0f64; m];
    for (e, &c0) in corners.iter().enumerate() {
        let c1 = corners[(e + 1) % corners.len()];
        let count = (c1 + m - c0) % m;
        let count = if count == 0 { m } else { count };
        let mut s = vec![0.0f64; count + 1];
        for k in 1..=count {
            let (a, b) = (p[(c0 + k - 1) % m], p[(c0 + k) % m]);
            s[k] = s[k - 1] + (b[0] - a[0]).hypot(b[1] - a[1]);
        }
        let len = s[count].max(1e-9);
        let reach = 0.5 * len / waves as f64;
        for k in 0..count {
            let u = s[k] / len;
            ring_z[(c0 + k) % m] = amp_mm * (std::f64::consts::TAU * waves as f64 * u).cos() * (std::f64::consts::PI * u).sin();
            ring_reach[(c0 + k) % m] = reach;
        }
    }
    for (k, &i) in ring.iter().enumerate() {
        out[i as usize] = ring_z[k] as f32;
    }
    // The sheets follow the nearest outline point, fading inwards.
    let on_ring: std::collections::BTreeSet<u32> = ring.iter().copied().collect();
    for i in 0..n {
        if on_ring.contains(&(i as u32)) {
            continue;
        }
        let q = xy(i as u32);
        let (k, d) = p.iter().enumerate().map(|(k, r)| (k, (r[0] - q[0]).hypot(r[1] - q[1]))).fold((0, f64::MAX), |b, x| if x.1 < b.1 { x } else { b });
        let f = (-(d / ring_reach[k]).powi(2)).exp();
        out[i] = (ring_z[k] * f) as f32;
    }
    out
}

/// Smooth random out-of-flatness: per sheet, a sum of plane waves with
/// wavelengths between 1/8 and 1/2 of the piece's size and random directions
/// and phases, scaled so the largest bump is `amp` mm.
struct Waviness {
    waves: [Vec<(f64, f64, f64, f64)>; 2],
    scale: [f64; 2],
}

impl Waviness {
    fn new(positions: &[f32], amp: f64, seed: u64) -> Self {
        let mut w = Waviness { waves: [vec![], vec![]], scale: [0.0; 2] };
        if amp <= 0.0 || positions.len() < 3 {
            return w;
        }
        let xs = positions.chunks(3).map(|p| (p[0] as f64, p[1] as f64));
        let (mut x0, mut x1, mut y0, mut y1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
        for (x, y) in xs {
            (x0, x1, y0, y1) = (x0.min(x), x1.max(x), y0.min(y), y1.max(y));
        }
        let size = (x1 - x0).max(y1 - y0).max(1.0);
        let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut rnd = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 11) as f64 / (1u64 << 53) as f64
        };
        for sh in 0..2 {
            for _ in 0..8 {
                let lambda = size * (0.125 + 0.375 * rnd());
                let ang = std::f64::consts::TAU * rnd();
                let k = std::f64::consts::TAU / lambda;
                w.waves[sh].push((k * ang.cos(), k * ang.sin(), std::f64::consts::TAU * rnd(), 0.5 + rnd()));
            }
            // Scale on a grid so the largest bump is `amp`.
            let mut peak = 1e-12f64;
            for i in 0..=40 {
                for j in 0..=40 {
                    let (x, y) = (x0 + (x1 - x0) * i as f64 / 40.0, y0 + (y1 - y0) * j as f64 / 40.0);
                    peak = peak.max(w.raw(sh, x, y).abs());
                }
            }
            w.scale[sh] = amp / peak;
        }
        w
    }

    fn raw(&self, sheet: usize, x: f64, y: f64) -> f64 {
        self.waves[sheet].iter().map(|(kx, ky, ph, a)| a * (kx * x + ky * y + ph).sin()).sum()
    }

    fn at(&self, sheet: usize, x: f64, y: f64) -> f64 {
        if self.waves[sheet].is_empty() {
            0.0
        } else {
            self.scale[sheet] * self.raw(sheet, x, y)
        }
    }
}

/// One animation frame read back from `anim_to_vtk` output.
#[derive(Clone, Debug)]
pub struct VtkFrame {
    /// Positions in BlownSim vertex order (n × 3).
    pub positions: Vec<f32>,
    /// Peak plastic strain over all shells (0.1 = 10 %).
    pub peak_plastic: f64,
    pub time: f64,
}

/// Parse a legacy-VTK frame written by `anim_to_vtk`; `n` = BlownSim vertex count.
pub fn read_vtk(text: &str, n: usize) -> Result<VtkFrame, String> {
    let lines: Vec<&str> = text.lines().collect();
    let block = |header: &str, count: usize| -> Result<Vec<&str>, String> {
        let i = lines.iter().position(|l| l.starts_with(header)).ok_or_else(|| format!("no {header} in frame"))?;
        let mut j = i + 1;
        if lines.get(j).is_some_and(|l| l.starts_with("LOOKUP_TABLE")) {
            j += 1;
        }
        let mut vals = Vec::with_capacity(count);
        while vals.len() < count && j < lines.len() {
            vals.extend(lines[j].split_whitespace());
            j += 1;
        }
        if vals.len() < count {
            return Err(format!("{header}: frame cut short"));
        }
        vals.truncate(count);
        Ok(vals)
    };
    let count_after = |key: &str| -> Result<usize, String> {
        lines
            .iter()
            .find(|l| l.starts_with(key))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|v| v.parse().ok())
            .ok_or_else(|| format!("no {key} in frame"))
    };
    let npts = count_after("POINTS")?;
    let pts = block("POINTS", npts * 3)?;
    let ids = block("SCALARS NODE_ID", npts)?;
    let mut positions = vec![0.0f32; 3 * n];
    for (k, id) in ids.iter().enumerate() {
        let v = id.parse::<usize>().map_err(|e| e.to_string())?.wrapping_sub(1);
        if v < n {
            for c in 0..3 {
                positions[3 * v + c] = pts[3 * k + c].parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
            }
        }
    }
    let mut peak_plastic = 0.0f64;
    if lines.iter().any(|l| l.starts_with("SCALARS 2DELEM_Plastic_Strain ")) {
        let ncell = count_after("CELL_DATA")?;
        for v in block("SCALARS 2DELEM_Plastic_Strain ", ncell)? {
            peak_plastic = peak_plastic.max(v.parse().unwrap_or(0.0));
        }
    }
    let time = lines.iter().position(|l| l.starts_with("TIME")).and_then(|k| lines.get(k + 1)).and_then(|l| l.trim().parse().ok()).unwrap_or(0.0);
    Ok(VtkFrame { positions, peak_plastic, time })
}

/// One time-history sample of the water volume.
#[derive(Clone, Copy, Debug)]
pub struct WaterSample {
    pub time: f64,
    pub volume_mm3: f64,
    pub pressure_mpa: f64,
}

/// Read the airbag (monitored volume) history from `modelT01`. The file is
/// big-endian Fortran records; after the header each sample is a cycle of
/// records starting with a 4-byte time, and the airbag's 12 values (MASS,
/// VOL, P, …) are its last 48-byte record. A partly written last cycle is
/// ignored, so this can be read while the run is going.
pub fn read_water_history(bytes: &[u8]) -> Vec<WaterSample> {
    let mut recs: Vec<&[u8]> = Vec::new();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let len = i32::from_be_bytes(bytes[i..i + 4].try_into().unwrap()) as usize;
        if i + 8 + len > bytes.len() {
            break;
        }
        recs.push(&bytes[i + 4..i + 4 + len]);
        i += 8 + len;
    }
    let f = |r: &[u8], k: usize| f32::from_be_bytes(r[4 * k..4 * k + 4].try_into().unwrap()) as f64;
    // The header ends with the variable lists; the first 4-byte record after
    // the last 44-byte title record starts the samples.
    let Some(last_title) = recs.iter().rposition(|r| r.len() == 44) else { return vec![] };
    let Some(start) = (last_title + 1..recs.len()).find(|&k| recs[k].len() == 4) else { return vec![] };
    let Some(cycle) = (start + 1..recs.len()).find(|&k| recs[k].len() == 4).map(|k| k - start) else { return vec![] };
    let mut out = Vec::new();
    let mut k = start;
    while k + cycle <= recs.len() {
        let group = &recs[k..k + cycle];
        if group[0].len() != 4 {
            break;
        }
        if let Some(mv) = group.iter().rev().find(|r| r.len() == 48) {
            out.push(WaterSample { time: f(group[0], 0), volume_mm3: f(mv, 1), pressure_mpa: f(mv, 2) });
        }
        k += cycle;
    }
    out
}

/// Pressure at time `t` from the history (linear between samples).
pub fn pressure_at(history: &[WaterSample], t: f64) -> Option<f64> {
    let k = history.iter().position(|s| s.time >= t)?;
    if k == 0 {
        return Some(history[0].pressure_mpa);
    }
    let (a, b) = (history[k - 1], history[k]);
    let u = if b.time > a.time { (t - a.time) / (b.time - a.time) } else { 1.0 };
    Some(a.pressure_mpa + u * (b.pressure_mpa - a.pressure_mpa))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sci_matches_python() {
        assert_eq!(sci(-8.0e-7, 2, 10), " -8.00e-07");
        assert_eq!(sci(1.0e-9, 2, 10), "  1.00e-09");
        assert_eq!(sci(0.0, 6, 20), "        0.000000e+00");
    }

    #[test]
    fn deck_has_two_sheets_sharing_the_weld() {
        // Two triangles per sheet over a unit square; corners are weld points.
        let pos = [0.0, 0.0, 0.0, 10.0, 0.0, 0.0, 10.0, 10.0, 0.0, 0.0, 10.0, 0.0f32];
        let idx = [0u32, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
        let weld = [1u8, 1, 1, 1];
        let k = deck("t", &pos, &idx, &weld, 2, &RefOptions::default());
        assert!(k.contains("*AIRBAG_LINEAR_FLUID"));
        let shells = k.split("*ELEMENT_SHELL\n").nth(1).unwrap().split('*').next().unwrap();
        let pids: Vec<&str> = shells.lines().map(|l| l[8..16].trim()).collect();
        assert_eq!(pids, ["1", "1", "2", "2"], "two shells per sheet");
        // Corner (weld) points sit at z = 0, shared by both sheets.
        assert!(k.contains("\n       1         0.00000         0.00000         0.00000\n"));
        assert!((flat_area(&pos, &idx, 2) - 100.0).abs() < 1e-9);
    }
}
