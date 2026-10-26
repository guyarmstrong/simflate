//! Every tuning constant in one place.
//!
//! Material values are typical annealed 304 stainless. A few are deliberately
//! softened for speed (noted below); the look is judged by eye against photos.

#[derive(Clone, Debug)]
pub struct Tuning {
    // ── Mesh ──────────────────────────────────────────────────────────────
    /// Approximate points per sheet for Draft.
    pub draft_vertices: f64,
    /// Approximate points per sheet for Medium.
    pub medium_vertices: f64,
    /// Approximate points per sheet for Final.
    pub final_vertices: f64,
    /// X fine mesh (Specified geometric, small tucks): points per sheet.
    pub xfine_vertices: f64,
    /// Minimum triangle angle the mesher aims for (degrees).
    pub min_angle_deg: f64,

    // ── Material (annealed 304) ───────────────────────────────────────────
    /// Young's modulus / yield stress ≈ 193 GPa / 215 MPa.
    pub youngs_over_yield: f64,
    pub poisson: f64,
    /// Membrane strain at first yield. Real steel ≈ 0.0011; softened so the
    /// solver converges quickly. Purely affects speed, not the final look.
    pub elastic_strain_at_yield: f64,
    /// Total stretch allowed before the sheet stops yielding (stainless ≈ 40 %).
    pub max_plastic_strain: f64,
    /// Work hardening of the sheet when it stretches (0 = perfectly plastic,
    /// as before; 1 = annealed 304: true stress ≈ 1275 MPa · ε^0.45, so the
    /// yield force is ×1.5 at 5 % stretch, ×2 at 10 %, ×2.9 at 20 %).
    pub stretch_hardening: f64,
    /// Interior sheet resistance to compression relative to tension. v1 used
    /// 0.25 so the sheet would buckle; v2 uses 1 (steel can't squash end-on)
    /// with an extra stretch pass, so the rim folds into ridges instead of
    /// shortening (tuning log, session 7).
    pub compression_factor: f64,
    /// Weld seam stiffness relative to the sheet (the weld can't change length).
    pub weld_stiffness_factor: f64,
    /// How firmly weld lines resist kinking sideways (0 = free, 1 = rigid).
    /// A seam is a doubled, welded strip; without this the weld zig-zags at
    /// mesh scale where the sheet squeezes along it.
    pub weld_straightness: f64,
    /// Stiff corners: where a weld turns to an inside angle below
    /// `corner_max_angle` (degrees), seam points within `corner_reach`
    /// (normalised; full for tips 40° sharper than the limit, less nearer it) of the corner are tied together across it with links of
    /// `corner_stiffness` (× a sheet strip). The welded tip keeps its shape.
    pub corner_max_angle: f64,
    pub corner_reach: f64,
    pub corner_stiffness: f64,
    /// Fraction of excess strain/angle converted to permanent set per substep.
    pub plastic_rate: f64,
    /// Work hardening of folds: plastic moment × (1 + k · set rotation in rad).
    pub bend_hardening: f64,
    /// 1 = the weld seam can move up and down (it only draws inward when 0).
    pub weld_free_z: f64,
    /// Yielding seam (0 = off, the old smooth straightness). The welded flange
    /// is stiff in-plane until its sideways force passes this yield (× the
    /// sheet's yield tension × segment length), then it kinks permanently —
    /// a few sharp kinks (each pulling in a V-tuck) instead of a smooth curve.
    /// Force-based like the folds (λ/h²). Replaces `weld_straightness` when on.
    pub weld_kink_yield: f64,
    /// In-plane stiffness of the yielding seam (× a sheet link's stiffness).
    pub weld_flange_stiffness: f64,
    /// Starting waviness of the seam itself (normalised height; 0 = off):
    /// real TIG seams are never perfectly flat, and a perfectly flat seam
    /// held taut by both sheets never buckles. Up/down, smooth random.
    pub weld_seed: f64,

    // ── Thickness + Balloon ↔ Geometric → how the sheet behaves ─────────────
    /// The sheet bends as if this many times its real thickness at the
    /// Balloon end (soft temper) and at the Geometric end (hard temper).
    /// 0.6–3 spans v1's Character range for 1 mm sheet on a 300 mm piece.
    pub temper_balloon: f64,
    pub temper_geometric: f64,
    /// Normalised pressure (p·R / yield tension) at Pressure = 100 for a sheet
    /// with `thickness_ratio_ref`. Thinner sheets see proportionally more.
    pub pressure_at_100: f64,
    /// Exponent of the pressure slider curve (see `normalised_pressure`).
    pub pressure_curve: f64,
    pub thickness_ratio_ref: f64,
    /// Real thickness / equivalent radius the pressure scale is set at
    /// (≈ 1 mm sheet on a 300 mm piece).
    pub pressure_reference_ratio: f64,
    /// How strongly Balloon ↔ Geometric changes the pressure the sheet feels,
    /// relative to its own yield tension. v1 used 1.6, which left Geometric
    /// 13× short of yielding — a shallow stiff lens that never drew in. v2: 0,
    /// so 100 means "yielding and full" at every setting (tuning log).
    pub character_pressure_exponent: f64,
    /// Lower bound on bending stiffness in units of (mesh edge)² so creases
    /// span a few triangles instead of single edges on coarse meshes.
    pub min_bending_mesh_factor: f64,

    /// Edge ripple spacing = factor × √(radius × thickness) (thin-shell
    /// wrinkle wavelength is ≈ 3.4 × √(R t)).
    pub ripple_wavelength_factor: f64,
    /// Weld fillet: rows of points across each side, and the furthest it
    /// reaches up a sheet (in radii) where the seam is very sharp.
    pub fillet_steps: f64,
    pub fillet_max_reach: f64,

    // ── Time stepping (normalised time) ───────────────────────────────────
    pub substep_dt: f64,
    pub substeps_per_frame: u32,
    pub iterations_per_substep: u32,
    /// Extra stretch-only passes per solver pass (in-plane stiffness without
    /// paying for more bending passes). One extra pass gives most of the
    /// ridges of 4 full passes at ~1.5x the time instead of 12x.
    pub stretch_passes: u32,
    /// Extra passes over the weld seam's links only (cheap: a few hundred
    /// links). One pass leaves the seam ~2 % short (it squashes instead of
    /// buckling); real weld can't shorten, its spare length must zig-zag.
    pub weld_passes: u32,
    /// No squashing (0 = off): after the passes, any link shorter than its
    /// rest length by more than this share is pushed back to it (strain
    /// limiting, a geometric limit — plasticity stays force-based). Steel
    /// can't shorten end-on, it buckles; this makes the spare rim length go
    /// into folds instead of quietly compressing (session 8: 7 % of links
    /// were >1 % short).
    pub squash_limit: f64,
    /// Warm start (0 = off): each link / hinge starts the substep with this
    /// share of its last multiplier λ (its impulse applied up front), so one
    /// pass only corrects the change. Without it λ restarts at zero and one
    /// pass leaves the sheet ~25× softer than set (tuning log, session 8).
    pub warm_start: f64,
    /// Same for the bending hinges (0 = off).
    pub warm_start_bend: f64,
    /// 0 = warm-start only links in compression (steel can't squash; no
    /// plastic feedback since links don't yield in compression); 1 = also
    /// links in tension (runs away: stale tension re-yields them).
    pub warm_start_tension: f64,
    /// 1 = folds set at the moment of the REAL sheet thickness, while
    /// Balloon ↔ Geometric still sets the elastic bending stiffness (0 = the
    /// tempered thickness sets both, as before: Geometric's ×3 thickness made
    /// folds 9× harder to set, so valleys stayed rounded).
    pub fold_moment_real: f64,

    // ── Core B: quasi-static Newton solver (solver/statics.rs) ───────────
    /// 0 = XPBD core (default), 1 = core B (steel-stiff, solved at rest
    /// every frame). Soap always uses core 0.
    pub core: f64,
    /// Stabiliser time step: each frame's solve is pulled gently toward the
    /// previous frame's shape by mass/dt² (bigger = weaker pull).
    pub static_dt: f64,
    /// Newton iterations per solve, and solve + set cycles per frame.
    pub static_iterations: u32,
    pub static_plastic_cycles: u32,
    /// Stop a solve when no point feels more than this force (normalised).
    pub static_tolerance: f64,
    /// Reuse a factorisation for up to this many frames (refactored early
    /// whenever a stale one gives a poor step).
    pub static_refactor_frames: u32,
    /// Saddle escape: each frame every free sheet point is nudged by up to
    /// this much (normalised; deterministic per frame and point) before the
    /// solve. Newton can rest on an unbuckled balance a real sheet would fall
    /// off; the nudge lets it fall. 0 = off.
    pub static_kick: f64,
    /// Buckling-mode seed (core B; tuning log session 9). From `mode_seed_at`
    /// × the target pressure, every `mode_check_frames` frames the sheet's
    /// softest shapes are found from the full stiffness (compression and
    /// pressure terms kept: the terms that make a sheet buckle). The first
    /// time any of the lowest `mode_count` has gone unstable, the sheet is
    /// nudged along the unstable ones by `mode_seed` × the sheet thickness.
    /// This is how engineers seed a buckling run: the sheet's own even waves
    /// instead of random dents. 0 = off.
    pub mode_seed: f64,
    /// Core B: links yield when squeezed past the yield force too (real
    /// steel does), shortening permanently by the excess (down to
    /// 1 − max_plastic_strain). Seams excluded. 0 = off (as before).
    pub compressive_yield: f64,
    /// Buckling check only: a yielding link's stiffness along itself, as a
    /// share of the elastic one (the metal's tangent modulus; 1 = elastic).
    pub plastic_tangent: f64,
    pub mode_seed_at: f64,
    pub mode_count: f64,
    /// Inverse-iteration rounds used to find the shapes.
    pub mode_iterations: f64,
    pub mode_check_frames: f64,
    /// TIG weld shrinkage (share, e.g. 0.005 = 0.5 %): the seam's rest length
    /// is this much shorter than the drawn edge, as a bead does when it cools.
    /// The sheet beside it is then in compression along the edge from the
    /// start and buckles into long waves (classic thin-plate weld
    /// distortion) — seeds for tucks. 0 = off.
    pub weld_shrink: f64,
    /// Seam hinge (Guy, session 8): the TIG seam resists opening like a
    /// book. Without it the top and bottom sheets meet at a free hinge. A
    /// hinge across every outline weld edge, between the top and bottom
    /// triangle, with this stiffness (× the sheet's own hinge) — 0 = off.
    pub seam_hinge: f64,
    /// Its plastic moment (× the sheet's): the bead is about two sheets
    /// thick, so ~4 (M_p ∝ t²). Past it the seam opens for good.
    pub seam_hinge_yield: f64,
    /// Passes over the squashed links per substep.
    pub squash_passes: u32,
    /// Velocity damping per substep — keeps the run quasi-static.
    pub damping: f64,
    /// Extra damping at the start, fading out over `soft_start_frames`: the
    /// flat sheet first lurches under pressure, and on fine meshes that lurch
    /// was read as yielding (spurious stretch, then crumpling).
    pub soft_start_damping: f64,
    pub soft_start_frames: f64,
    /// Time to ramp from zero to full target pressure.
    pub ramp_time: f64,
    /// Height mode: wanted rise per frame as a share of the remaining gap.
    pub height_approach: f64,
    /// Height mode: fastest rise per frame, as a share of the target height.
    pub height_max_rate: f64,
    /// Height mode: how hard the pressure is corrected toward the wanted rise.
    pub height_gain: f64,
    /// Max displacement per substep (normalised) counted as "settled".
    pub settle_displacement: f64,
    pub settle_frames: u32,
    pub max_frames: u32,

    // ── Imperfection (seeded) ─────────────────────────────────────────────
    pub imperfection_amplitude: f64,
    pub rest_length_noise: f64,
    /// Distance (normalised) over which the starting bump fades to zero at
    /// the welds, so the first frames don't snap a kink at the seam.
    pub imperfection_taper: f64,
}

impl Default for Tuning {
    fn default() -> Self {
        Tuning {
            draft_vertices: 1600.0,
            medium_vertices: 4000.0,
            final_vertices: 9000.0,
            xfine_vertices: 36000.0,
            min_angle_deg: 28.0,

            youngs_over_yield: 193_000.0 / 215.0,
            poisson: 0.29,
            elastic_strain_at_yield: 0.004,
            max_plastic_strain: 0.40,
            stretch_hardening: 0.0,
            compression_factor: 1.0,
            weld_stiffness_factor: 4.0,
            weld_straightness: 0.5,
            corner_max_angle: 100.0,
            corner_reach: 0.25,
            corner_stiffness: 4.0,
            plastic_rate: 0.5,
            bend_hardening: 0.0,
            weld_free_z: 0.0,
            weld_kink_yield: 0.0,
            weld_flange_stiffness: 1.0,
            weld_seed: 0.0,

            temper_balloon: 0.6,
            temper_geometric: 3.0,
            pressure_at_100: 0.8,
            pressure_curve: 3.0,
            thickness_ratio_ref: 0.009,
            pressure_reference_ratio: 0.0066,
            character_pressure_exponent: 0.0,
            min_bending_mesh_factor: 12.0,
            ripple_wavelength_factor: 3.0,
            fillet_steps: 5.0,
            fillet_max_reach: 3.0,

            substep_dt: 0.004,
            substeps_per_frame: 40,
            iterations_per_substep: 1,
            stretch_passes: 1,
            weld_passes: 0,
            squash_limit: 0.0,
            warm_start: 0.0,
            warm_start_bend: 0.0,
            warm_start_tension: 0.0,
            fold_moment_real: 0.0,
            core: 0.0,
            static_dt: 0.2,
            static_iterations: 3,
            static_plastic_cycles: 2,
            static_tolerance: 1e-7,
            static_refactor_frames: 5,
            static_kick: 0.0,
            mode_seed: 0.0,
            compressive_yield: 0.0,
            plastic_tangent: 0.02,
            mode_seed_at: 1.0,
            mode_count: 4.0,
            mode_iterations: 12.0,
            mode_check_frames: 3.0,
            weld_shrink: 0.0,
            seam_hinge: 0.0,
            seam_hinge_yield: 4.0,
            squash_passes: 8,
            damping: 0.025,
            soft_start_damping: 0.15,
            soft_start_frames: 12.0,
            ramp_time: 4.0,
            height_approach: 0.05,
            height_max_rate: 0.03,
            height_gain: 0.3,
            settle_displacement: 2e-6,
            settle_frames: 4,
            max_frames: 600,

            imperfection_amplitude: 0.002,
            rest_length_noise: 0.003,
            imperfection_taper: 0.15,
        }
    }
}

impl Tuning {
    /// Override one constant by name (for tuning experiments from the CLI).
    pub fn set(&mut self, name: &str, value: f64) -> bool {
        let slot: &mut f64 = match name {
            "draft_vertices" => &mut self.draft_vertices,
            "medium_vertices" => &mut self.medium_vertices,
            "final_vertices" => &mut self.final_vertices,
            "xfine_vertices" => &mut self.xfine_vertices,
            "elastic_strain_at_yield" => &mut self.elastic_strain_at_yield,
            "youngs_over_yield" => &mut self.youngs_over_yield,
            "max_plastic_strain" => &mut self.max_plastic_strain,
            "stretch_hardening" => &mut self.stretch_hardening,
            "squash_limit" => &mut self.squash_limit,
            "warm_start" => &mut self.warm_start,
            "warm_start_bend" => &mut self.warm_start_bend,
            "warm_start_tension" => &mut self.warm_start_tension,
            "fold_moment_real" => &mut self.fold_moment_real,
            "core" => &mut self.core,
            "static_dt" => &mut self.static_dt,
            "static_tolerance" => &mut self.static_tolerance,
            "static_kick" => &mut self.static_kick,
            "mode_seed" => &mut self.mode_seed,
            "compressive_yield" => &mut self.compressive_yield,
            "plastic_tangent" => &mut self.plastic_tangent,
            "mode_seed_at" => &mut self.mode_seed_at,
            "mode_count" => &mut self.mode_count,
            "mode_iterations" => &mut self.mode_iterations,
            "mode_check_frames" => &mut self.mode_check_frames,
            "weld_shrink" => &mut self.weld_shrink,
            "seam_hinge" => &mut self.seam_hinge,
            "seam_hinge_yield" => &mut self.seam_hinge_yield,
            "compression_factor" => &mut self.compression_factor,
            "weld_stiffness_factor" => &mut self.weld_stiffness_factor,
            "weld_straightness" => &mut self.weld_straightness,
            "plastic_rate" => &mut self.plastic_rate,
            "bend_hardening" => &mut self.bend_hardening,
            "weld_free_z" => &mut self.weld_free_z,
            "weld_kink_yield" => &mut self.weld_kink_yield,
            "weld_flange_stiffness" => &mut self.weld_flange_stiffness,
            "weld_seed" => &mut self.weld_seed,
            "corner_max_angle" => &mut self.corner_max_angle,
            "corner_reach" => &mut self.corner_reach,
            "corner_stiffness" => &mut self.corner_stiffness,
            "temper_balloon" => &mut self.temper_balloon,
            "temper_geometric" => &mut self.temper_geometric,
            "pressure_at_100" => &mut self.pressure_at_100,
            "pressure_curve" => &mut self.pressure_curve,
            "thickness_ratio_ref" => &mut self.thickness_ratio_ref,
            "pressure_reference_ratio" => &mut self.pressure_reference_ratio,
            "character_pressure_exponent" => &mut self.character_pressure_exponent,
            "min_bending_mesh_factor" => &mut self.min_bending_mesh_factor,
            "ripple_wavelength_factor" => &mut self.ripple_wavelength_factor,
            "fillet_steps" => &mut self.fillet_steps,
            "fillet_max_reach" => &mut self.fillet_max_reach,
            "substep_dt" => &mut self.substep_dt,
            "damping" => &mut self.damping,
            "soft_start_damping" => &mut self.soft_start_damping,
            "soft_start_frames" => &mut self.soft_start_frames,
            "ramp_time" => &mut self.ramp_time,
            "height_approach" => &mut self.height_approach,
            "height_max_rate" => &mut self.height_max_rate,
            "height_gain" => &mut self.height_gain,
            "settle_displacement" => &mut self.settle_displacement,
            "imperfection_amplitude" => &mut self.imperfection_amplitude,
            "rest_length_noise" => &mut self.rest_length_noise,
            "imperfection_taper" => &mut self.imperfection_taper,
            "substeps_per_frame" => {
                self.substeps_per_frame = value.max(1.0) as u32;
                return true;
            }
            "max_frames" => {
                self.max_frames = value.max(1.0) as u32;
                return true;
            }
            "settle_frames" => {
                self.settle_frames = value.max(1.0) as u32;
                return true;
            }
            "squash_passes" => {
                self.squash_passes = value.max(0.0) as u32;
                return true;
            }
            "static_refactor_frames" => {
                self.static_refactor_frames = value.max(0.0) as u32;
                return true;
            }
            "static_iterations" => {
                self.static_iterations = value.max(1.0) as u32;
                return true;
            }
            "static_plastic_cycles" => {
                self.static_plastic_cycles = value.max(1.0) as u32;
                return true;
            }
            "weld_passes" => {
                self.weld_passes = value.max(0.0) as u32;
                return true;
            }
            "stretch_passes" => {
                self.stretch_passes = value.max(0.0) as u32;
                return true;
            }
            "iterations_per_substep" => {
                self.iterations_per_substep = value.max(1.0) as u32;
                return true;
            }
            _ => return false,
        };
        *slot = value;
        true
    }

    /// The thickness / equivalent radius the sheet behaves with, for its
    /// real thickness ratio and the Balloon ↔ Geometric value.
    pub fn thickness_ratio(&self, real_ratio: f64, character: f64) -> f64 {
        let c = character.clamp(0.0, 1.0);
        real_ratio * self.temper_balloon * (self.temper_geometric / self.temper_balloon).powf(c)
    }

    /// Normalised pressure for a 0–100 Pressure value and Balloon ↔ Geometric.
    /// The 0–100 pressure slider follows a curve (`pressure_curve`): a flat
    /// pillow gains most of its height at low pressure, so a straight scale
    /// would put almost all the change in the first 15 %. With the curve the
    /// slider spreads evenly from a shallow bulge to full.
    ///
    /// The pressure is scaled by the Balloon ↔ Geometric value only, at a
    /// reference sheet (`pressure_reference_ratio`), not by the real
    /// thickness: normalised pressure is already per unit of the sheet's yield
    /// tension, so a thinner sheet gets proportionally less real pressure and
    /// the slider means the same fullness at any thickness (as in v1).
    pub fn normalised_pressure(&self, pressure: f64, character: f64) -> f64 {
        let t = self.thickness_ratio(self.pressure_reference_ratio, character);
        (pressure.max(0.0) / 100.0).powf(self.pressure_curve) * self.pressure_at_100 * (self.thickness_ratio_ref / t).powf(self.character_pressure_exponent)
    }

    /// Bending stiffness D / (yield tension · R²) for a thickness ratio.
    pub fn bending_stiffness(&self, thickness_ratio: f64) -> f64 {
        self.youngs_over_yield * thickness_ratio * thickness_ratio / (12.0 * (1.0 - self.poisson * self.poisson))
    }

    /// Curvature (×R) at which a plastic hinge forms: M_p / D.
    pub fn yield_curvature(&self, thickness_ratio: f64) -> f64 {
        3.0 * (1.0 - self.poisson * self.poisson) / (self.youngs_over_yield * thickness_ratio)
    }
}
