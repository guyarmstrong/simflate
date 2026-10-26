//! A tiny C-style API over blown-core for WebAssembly (no wasm-bindgen).
//! The UI's solver worker (ui/src/sim/worker.ts) is the only caller.
//!
//! Strings go in as UTF-8 JSON written into memory from `bs_alloc`; strings
//! come out through `bs_result_ptr` / `bs_result_len`. Arrays are read
//! straight from wasm memory via the `*_ptr` functions.

use std::cell::RefCell;

use blown_core::mesh::VertexKind;
use blown_core::finish::{FinishParams, RenderMesh};
use blown_core::{export::flat_uvs, Piece, Sim, SimSettings, Status};
use serde::Deserialize;

#[derive(Deserialize)]
struct CreateRequest {
    pieces: Vec<Piece>,
    #[serde(default)]
    settings: SimSettings,
}

#[derive(Default)]
struct State {
    sim: Option<Sim>,
    result: Vec<u8>,
    indices: Vec<u32>,
    uv: Vec<f32>,
    weld: Vec<u8>,
    positions: Vec<f32>,
    field: Vec<f32>,
    input: Vec<f32>,
    r_positions: Vec<f32>,
    r_indices: Vec<u32>,
    r_uv: Vec<f32>,
    r_origin: Vec<u32>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

#[no_mangle]
pub extern "C" fn bs_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `bs_alloc`.
#[no_mangle]
pub unsafe extern "C" fn bs_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

#[no_mangle]
pub extern "C" fn bs_result_ptr() -> *const u8 {
    with(|s| s.result.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_result_len() -> usize {
    with(|s| s.result.len())
}

/// Build a simulation from JSON `{ pieces, settings }`. Returns 1 on success;
/// on failure returns 0 and the error message is in the result buffer.
///
/// # Safety
/// `ptr`/`len` must describe valid UTF-8 written into memory from `bs_alloc`.
#[no_mangle]
pub unsafe extern "C" fn bs_create(ptr: *const u8, len: usize) -> i32 {
    let text = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("");
    let made = serde_json::from_str::<CreateRequest>(text)
        .map_err(|e| format!("Bad request: {e}"))
        .and_then(|req| Sim::new(&req.pieces, req.settings));
    with(|s| match made {
        Ok(sim) => {
            s.indices = sim.mesh.tris.iter().flatten().copied().collect();
            s.uv = flat_uvs(&sim.mesh).iter().flat_map(|p| [p[0] as f32, p[1] as f32]).collect();
            s.weld = sim.mesh.kind.iter().map(|k| (*k == VertexKind::Weld) as u8).collect();
            sim.positions_mm(&mut s.positions);
            let summary = serde_json::json!({
                "vertexCount": sim.num_vertices(),
                "triangleCount": sim.mesh.tris.len(),
                "topTriangles": sim.mesh.tri_sheet.iter().filter(|t| **t == 0).count(),
                "scaleMm": sim.scale,
                "center": sim.center,
                "warnings": sim.mesh.warnings,
                "info": sim.info(),
            });
            s.result = summary.to_string().into_bytes();
            s.sim = Some(sim);
            1
        }
        Err(e) => {
            s.sim = None;
            s.result = e.into_bytes();
            0
        }
    })
}

/// Advance one frame. Returns 1 while running, 0 once settled, -1 if no sim.
/// Frame stats JSON is left in the result buffer; positions are refreshed.
#[no_mangle]
pub extern "C" fn bs_step() -> i32 {
    with(|s| {
        let Some(sim) = s.sim.as_mut() else { return -1 };
        let info = sim.step_frame();
        sim.positions_mm(&mut s.positions);
        s.result = serde_json::to_vec(&info).unwrap_or_default();
        (info.status == Status::Running) as i32
    })
}

#[no_mangle]
pub extern "C" fn bs_raise_pressure(pressure: f64) -> i32 {
    with(|s| s.sim.as_mut().map_or(0, |sim| sim.raise_pressure(pressure) as i32))
}

#[no_mangle]
pub extern "C" fn bs_raise_height(height_mm: f64) -> i32 {
    with(|s| s.sim.as_mut().map_or(0, |sim| sim.raise_target_height(height_mm) as i32))
}

#[no_mangle]
pub extern "C" fn bs_vertex_count() -> usize {
    with(|s| s.positions.len() / 3)
}

#[no_mangle]
pub extern "C" fn bs_positions_ptr() -> *const f32 {
    with(|s| s.positions.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_index_count() -> usize {
    with(|s| s.indices.len())
}

#[no_mangle]
pub extern "C" fn bs_indices_ptr() -> *const u32 {
    with(|s| s.indices.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_uv_ptr() -> *const f32 {
    with(|s| s.uv.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_weld_ptr() -> *const u8 {
    with(|s| s.weld.as_ptr())
}

/// Per-vertex overlay field: 0 = crease strength, 1 = plate contact.
#[no_mangle]
pub extern "C" fn bs_field(kind: u32) -> *const f32 {
    with(|s| {
        s.field = match (&s.sim, kind) {
            (Some(sim), 0) => sim.crease_field(),
            (Some(sim), 1) => sim.contact_field(),
            _ => Vec::new(),
        };
        s.field.as_ptr()
    })
}

#[derive(Deserialize)]
struct AdoptRequest {
    indices: Vec<u32>,
    uv: Vec<f32>,
    weld: Vec<u8>,
    #[serde(rename = "topTriangles")]
    top_triangles: usize,
}

/// Give the finisher a snapshot's own mesh, JSON `{ indices, uv, weld,
/// topTriangles }`, when re-meshing its outline no longer gives the same
/// points (the mesher has changed since it was taken). Call after
/// `bs_create` with the snapshot's pieces and settings; only `bs_finish`
/// may follow. Returns 1 on success.
///
/// # Safety
/// `ptr`/`len` must describe valid UTF-8 written into memory from `bs_alloc`.
#[no_mangle]
pub unsafe extern "C" fn bs_adopt_mesh(ptr: *const u8, len: usize) -> i32 {
    let text = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("");
    let Ok(req) = serde_json::from_str::<AdoptRequest>(text) else { return 0 };
    with(|s| {
        let Some(sim) = s.sim.as_mut() else { return 0 };
        let n = req.weld.len();
        if n == 0 || req.uv.len() != n * 2 || req.indices.len() % 3 != 0 || req.indices.iter().any(|&i| i as usize >= n) {
            return 0;
        }
        // Flat layout back from the UVs, on the extent of the same outline re-meshed.
        let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
        for p in &sim.mesh.flat {
            for k in 0..2 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let span = (hi[0] - lo[0]).max(hi[1] - lo[1]).max(1e-9);
        let tris: Vec<[u32; 3]> = req.indices.chunks(3).map(|c| [c[0], c[1], c[2]]).collect();
        // Top sheet's triangles come first (as `SheetMesh::from_flat` builds them).
        let tri_sheet: Vec<u8> = (0..tris.len()).map(|i| (i >= req.top_triangles) as u8).collect();
        let mut kind = vec![VertexKind::Top; n];
        for (t, &sheet) in tris.iter().zip(&tri_sheet) {
            if sheet == 1 {
                for &v in t {
                    kind[v as usize] = VertexKind::Bottom;
                }
            }
        }
        for (k, &w) in kind.iter_mut().zip(&req.weld) {
            if w != 0 {
                *k = VertexKind::Weld;
            }
        }
        sim.mesh.flat = req.uv.chunks(2).map(|c| [lo[0] + c[0] as f64 * span, lo[1] + c[1] as f64 * span]).collect();
        sim.mesh.kind = kind;
        sim.mesh.tris = tris;
        sim.mesh.tri_sheet = tri_sheet;
        1
    })
}

/// Scratch buffer the UI fills with a frame's positions (mm) before `bs_finish`.
#[no_mangle]
pub extern "C" fn bs_input_ptr(len: usize) -> *mut f32 {
    with(|s| {
        s.input.resize(len, 0.0);
        s.input.as_mut_ptr()
    })
}

/// Turn the frame in the input buffer into a smooth render mesh (finisher).
/// Returns 1 on success; summary JSON goes to the result buffer and the mesh
/// is read through the `bs_render_*` functions.
#[no_mangle]
pub extern "C" fn bs_finish(levels: u32, smooth_iterations: u32, crease_angle_deg: f64, edge_ripples: f64, weld_fillet_mm: f64, ridge_sharpness: f64, show_thickness: i32) -> i32 {
    with(|s| {
        let Some(sim) = s.sim.as_mut() else { return 0 };
        // Edge ripples and the weld fillet only affect the render mesh, so the slider can change
        // them without re-running the solve.
        sim.settings.edge_ripples = edge_ripples;
        sim.settings.weld_fillet_mm = weld_fillet_mm;
        let sim = &*sim;
        let n = sim.mesh.num_vertices();
        if s.input.len() != n * 3 {
            s.result = b"frame size does not match the mesh".to_vec();
            return 0;
        }
        let pos: Vec<[f64; 3]> = s.input.chunks(3).map(|c| [c[0] as f64, c[1] as f64, c[2] as f64]).collect();
        let mut params = sim.finish_params(FinishParams { levels: levels.min(3), smooth_iterations, crease_angle_deg, ridge_sharpness, ..FinishParams::default() });
        // "Show at the edge" off: sheets as thin mid-surfaces (the solve still uses the thickness).
        if show_thickness == 0 {
            params.thickness_mm = 0.0;
        }
        let finished = RenderMesh::from_sim(&sim.mesh, &pos).finish(&params);
        let (split, origin) = finished.split_sheets();
        // UVs on the same scale as the solve mesh.
        let (mut lo, mut hi) = ([f64::MAX; 2], [f64::MIN; 2]);
        for p in &sim.mesh.flat {
            for k in 0..2 {
                lo[k] = lo[k].min(p[k]);
                hi[k] = hi[k].max(p[k]);
            }
        }
        let span = (hi[0] - lo[0]).max(hi[1] - lo[1]).max(1e-9);
        s.r_positions = split.pos.iter().flat_map(|p| [p[0] as f32, p[1] as f32, p[2] as f32]).collect();
        s.r_indices = split.tris.iter().flatten().copied().collect();
        s.r_uv = split.flat.iter().flat_map(|p| [((p[0] - lo[0]) / span) as f32, ((p[1] - lo[1]) / span) as f32]).collect();
        s.r_origin = origin;
        let top = split.tri_sheet.iter().filter(|t| **t == 0).count();
        s.result = format!("{{\"vertexCount\":{},\"indexCount\":{},\"topTriangles\":{}}}", split.pos.len(), s.r_indices.len(), top).into_bytes();
        1
    })
}

#[no_mangle]
pub extern "C" fn bs_render_positions_ptr() -> *const f32 {
    with(|s| s.r_positions.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_render_indices_ptr() -> *const u32 {
    with(|s| s.r_indices.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_render_uv_ptr() -> *const f32 {
    with(|s| s.r_uv.as_ptr())
}

#[no_mangle]
pub extern "C" fn bs_render_origin_ptr() -> *const u32 {
    with(|s| s.r_origin.as_ptr())
}

#[derive(Deserialize)]
struct TextRequest {
    postscript: String,
    text: String,
    height: f64,
}

/// Text tool (browser preview): outline `{ postscript, text, height }` (JSON
/// at `req`) in the font file at `font`. Result buffer: the outline as JSON;
/// returns 0 with the message there on failure.
///
/// # Safety
/// Both buffers must come from `bs_alloc` with the given lengths.
#[no_mangle]
pub unsafe extern "C" fn bs_text_outline(font: *const u8, font_len: usize, req: *const u8, req_len: usize) -> i32 {
    let data = std::slice::from_raw_parts(font, font_len);
    let text = std::str::from_utf8(std::slice::from_raw_parts(req, req_len)).unwrap_or("");
    let out = serde_json::from_str::<TextRequest>(text)
        .map_err(|e| format!("Bad request: {e}"))
        .and_then(|r| blown_core::text::outline(data, &r.postscript, &r.text, r.height));
    with(|s| match out {
        Ok(t) => {
            s.result = serde_json::to_vec(&t).unwrap_or_default();
            1
        }
        Err(e) => {
            s.result = e.into_bytes();
            0
        }
    })
}
