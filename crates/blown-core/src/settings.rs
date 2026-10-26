//! The user-facing settings for one simulation run (the short Soap-Skin-style
//! control list plus the Advanced extras). All lengths are millimetres.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MeshQuality {
    /// Fast, fully live (a few thousand points).
    #[default]
    Draft,
    /// In between: good creases, still fairly quick.
    Medium,
    /// Fine mesh for export.
    Final,
    /// Specified geometric only: extra fine, for small tucks.
    XFine,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Material {
    /// Stainless: barely stretches, creases, keeps its creases.
    #[default]
    Metal,
    /// Soap film: constant surface tension, no bending — for comparison.
    Soap,
}

/// Specified geometric (session 19): round outlines get evenly spread,
/// S-shaped folds round the whole loop instead of tucks between corners.
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum RoundMode {
    /// Round when every closed outline has no corners (circles, ellipses, pills).
    #[default]
    Auto,
    Round,
    Corners,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PlateSettings {
    /// Finished thickness = distance between the two plates.
    pub thickness_mm: f64,
    /// Moves both plates up (+) or down (−) relative to the weld plane.
    #[serde(default)]
    pub offset_mm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct SimSettings {
    /// Relative pressure, 0–100.
    pub pressure: f64,
    /// If set, inflate until this overall height (mm) is reached instead.
    pub target_height_mm: Option<f64>,
    /// Sheet thickness (mm), both sheets the same.
    pub thickness_mm: f64,
    /// Balloon ↔ Geometric, 0–1. Works as temper: soft annealed sheet flows
    /// into round forms, hard sheet folds into facets (exaggerated so both
    /// looks are reachable at any thickness).
    pub character: f64,
    pub plates: Option<PlateSettings>,
    pub quality: MeshQuality,
    pub material: Material,
    /// Crease randomness seed — same seed, same creases.
    pub seed: u64,
    /// Crease randomness strength, 0–1.
    pub crease_randomness: f64,
    /// Plate friction, 0–1.
    pub plate_friction: f64,
    /// Bottom sheet stiffness relative to the top (1 = same; >1 for one-sided pieces).
    pub bottom_stiffness: f64,
    /// Keep the welded outline exactly where it was drawn. The piece still
    /// inflates freely (so it keeps its height and natural creases); the
    /// result is then smoothly mapped so the weld sits on the drawn outline.
    /// Off (default): the edge draws inward, as real pieces do.
    pub fix_outline: bool,
    /// Edge ripples, 0–1: how strongly the smooth render mesh folds the
    /// metal squeezed along welds into pleats (0.5 = as measured).
    pub edge_ripples: f64,
    /// Hold creases until this pressure (0–100 scale; 0 = off). Below it,
    /// folds stay springy and can't set — what the temporary clamp does on
    /// real creaseless pieces — so a high-pressure piece comes out smooth.
    pub crease_hold: f64,
    /// Radius of the rounded TIG seam on the smooth render mesh (mm).
    pub weld_fillet_mm: f64,
    /// Experimental (session 8): the steel solver — core B, solved at rest
    /// every frame with real steel stiffness and real bending.
    pub steel_solver: bool,
    /// Experimental (session 8): how strongly the TIG seam resists opening
    /// like a book (× the sheet's own hinge; 0 = free hinge, as before).
    /// Above 0 the seam may also move up and down.
    pub seam_stiffness: f64,
    /// Symmetric solver (session 16): mesh one slice of a mirror-symmetric
    /// outline and copy it round, so the mesh is exactly symmetric (the
    /// Reference engine then solves the slice alone). Errors if the outline
    /// isn't symmetric.
    pub symmetric: bool,
    /// Symmetric solver: seeded edge waves, crests per edge (0 = none).
    /// Specified geometric: tucks per edge.
    pub waves_per_edge: u32,
    /// Specified geometric solver (session 16): build the form directly
    /// (dome, edge draw-in, tucks) instead of solving it.
    pub geometric: bool,
    /// Specified geometric: how deep the tucks go, 0–1.
    pub wave_depth: f64,
    /// Specified geometric: tuck width as a share of their spacing (1 = they
    /// run on into one another).
    pub tuck_width: f64,
    /// Specified geometric: how far a tuck runs in from the weld, × its width.
    pub tuck_length: f64,
    /// Specified geometric: 0 = all tucks equally deep; 1 = shallow near the
    /// corners, deepest mid-side.
    pub corner_fade: f64,
    /// Specified geometric: how the tuck count follows side length (count is
    /// for a 300 mm side; 0 = same on every side, 1 = in proportion, −1 =
    /// shorter sides get more).
    pub tuck_scaling: f64,
    /// Specified geometric: how far the edges bow in to feed the dome (1 = as built).
    pub edge_pull: f64,
    /// Specified geometric: the weld rising between tucks and dipping at them, 0–1.
    pub edge_lift: f64,
    /// Specified geometric: tuck shape, 0 = Balloon (rounded valleys) … 1 =
    /// Geometric (thick material: flat floor, straight walls, tight shoulder).
    pub tuck_shape: f64,
    /// Specified geometric: 0 = tucks pull the weld in (wavy edge) … 1 = the
    /// edge draws in as a smooth arc.
    pub edge_smooth: f64,
    /// Specified geometric: 0 = pillow … 1 = pill (each sheet leaves the weld
    /// straight up, round a quarter circle onto a gently crowned top).
    pub side_wall: f64,
    /// Specified geometric (session 17): tuck width, mm. None (older forms) =
    /// `tuck_width` as a share of the spacing.
    pub tuck_width_mm: Option<f64>,
    /// Specified geometric: how far a tuck runs in from the weld, mm. None =
    /// `tuck_length` × the width.
    pub tuck_length_mm: Option<f64>,
    /// Specified geometric: valley depth at a tuck's centre, mm. None =
    /// `wave_depth` 0–1.
    pub valley_depth_mm: Option<f64>,
    /// Specified geometric: 0 = regular tucks … 1 = spacing, width, length
    /// and depth varied (from `seed`).
    pub tuck_randomness: f64,
    /// Specified geometric: 0 = tucks full width all the way in … 1 = they
    /// narrow to a point at their length.
    pub tuck_taper: f64,
    /// Specified geometric: round mode (Auto picks it for corner-free outlines).
    pub round_mode: RoundMode,
    /// Round mode: how far each fold's centre line swings into an S, × its
    /// width (0 = straight).
    pub fold_over: f64,
    /// Round mode: tightest bend a fold may make, mm (caps the S and the
    /// valley depth; 0 = no limit).
    pub min_bend_mm: f64,
}

impl Default for SimSettings {
    fn default() -> Self {
        SimSettings {
            pressure: 89.0,
            target_height_mm: None,
            thickness_mm: 1.0,
            character: 0.3,
            plates: None,
            quality: MeshQuality::Draft,
            material: Material::Metal,
            seed: 1,
            crease_randomness: 0.5,
            plate_friction: 0.05,
            bottom_stiffness: 1.0,
            fix_outline: false,
            edge_ripples: 0.5,
            crease_hold: 0.0,
            weld_fillet_mm: 1.5,
            steel_solver: false,
            seam_stiffness: 0.0,
            symmetric: false,
            waves_per_edge: 0,
            geometric: false,
            wave_depth: 0.5,
            tuck_width: 0.9,
            tuck_length: 1.2,
            corner_fade: 0.5,
            tuck_scaling: 0.0,
            edge_pull: 1.0,
            edge_lift: 0.0,
            tuck_shape: 0.0,
            edge_smooth: 0.0,
            side_wall: 0.0,
            tuck_width_mm: None,
            tuck_length_mm: None,
            valley_depth_mm: None,
            tuck_randomness: 0.0,
            tuck_taper: 0.0,
            round_mode: RoundMode::Auto,
            fold_over: 0.0,
            min_bend_mm: 0.0,
        }
    }
}
