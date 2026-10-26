//! Fast / Steel solvers run natively in the desktop app, on several cores
//! (blown-core's `parallel` feature), instead of as WebAssembly in the window.
//! Same results as the WebAssembly solver (colour batches, see
//! blown-core `solver::par`), about twice as fast on Guy's laptop.
//!
//! `native_start` meshes the piece and returns the mesh and first frame as
//! raw bytes; a background thread then steps the run and sends each frame
//! down the given channel, also as raw bytes (see `pack_frame`). The finisher
//! (smooth render mesh) stays in the window's WebAssembly worker.

use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;

use blown_core::export::flat_uvs;
use blown_core::mesh::VertexKind;
use blown_core::{Piece, Sim, SimSettings, Status};
use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody, Response};
use tauri::State;

enum Cmd {
    Stop,
    Pause,
    Resume,
    Pressure(f64),
    Height(f64),
}

#[derive(Default)]
pub struct NativeState(Mutex<Option<Sender<Cmd>>>);

#[derive(Deserialize)]
struct StartRequest {
    pieces: Vec<Piece>,
    settings: SimSettings,
}

// Channel message kinds (first byte).
const FRAME: u8 = 1;
const SETTLED: u8 = 2;
const RAISED: u8 = 3;
const FAILED: u8 = 4;

/// Little-endian layout the window reads: header byte(s), then a u32 length
/// and JSON, padded to 4 bytes so the float arrays that follow line up.
fn put_json(out: &mut Vec<u8>, json: &[u8]) {
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(json);
    while out.len() % 4 != 0 {
        out.push(0);
    }
}

fn put_f32(out: &mut Vec<u8>, v: &[f32]) {
    out.reserve(v.len() * 4);
    for x in v {
        out.extend_from_slice(&x.to_le_bytes());
    }
}

/// [kind, 0, 0, 0][json len][frame info JSON][pad] positions (3n f32), crease (n), contact (n).
fn pack_frame(sim: &Sim, kind: u8, buf: &mut Vec<f32>) -> Vec<u8> {
    let mut out = vec![kind, 0, 0, 0];
    put_json(&mut out, &serde_json::to_vec(&sim.info()).unwrap_or_default());
    sim.positions_mm(buf);
    put_f32(&mut out, buf);
    put_f32(&mut out, &sim.crease_field());
    put_f32(&mut out, &sim.contact_field());
    out
}

fn message(kind: u8, json: serde_json::Value) -> Vec<u8> {
    let mut out = vec![kind, 0, 0, 0];
    put_json(&mut out, json.to_string().as_bytes());
    out
}

/// Mesh the piece and start solving. Returns [summary JSON][pad] indices
/// (u32), uv (2n f32), weld (n u8, padded), then the flat first frame as in
/// `pack_frame`. Any earlier native run is stopped.
#[tauri::command]
pub async fn native_start(state: State<'_, NativeState>, request: String, on_event: Channel<InvokeResponseBody>) -> Result<Response, String> {
    if let Some(old) = state.0.lock().unwrap().take() {
        let _ = old.send(Cmd::Stop);
    }
    let req: StartRequest = serde_json::from_str(&request).map_err(|e| format!("Bad request: {e}"))?;
    let sim = Sim::new(&req.pieces, req.settings)?;
    let out = pack_start(&sim);

    let (tx, rx) = channel();
    *state.0.lock().unwrap() = Some(tx);
    std::thread::Builder::new()
        .name("blown-native-run".into())
        .spawn(move || run(sim, rx, on_event))
        .map_err(|e| e.to_string())?;
    Ok(Response::new(out))
}

/// The start reply: mesh, then the flat first frame (layout above).
fn pack_start(sim: &Sim) -> Vec<u8> {
    let n = sim.num_vertices();
    let summary = serde_json::json!({
        "vertexCount": n,
        "triangleCount": sim.mesh.tris.len(),
        "topTriangles": sim.mesh.tri_sheet.iter().filter(|t| **t == 0).count(),
        "scaleMm": sim.scale,
        "center": sim.center,
        "warnings": sim.mesh.warnings,
        "info": sim.info(),
    });
    let mut out = Vec::new();
    put_json(&mut out, summary.to_string().as_bytes());
    let indices: Vec<u32> = sim.mesh.tris.iter().flatten().copied().collect();
    out.extend_from_slice(&(indices.len() as u32).to_le_bytes());
    for i in &indices {
        out.extend_from_slice(&i.to_le_bytes());
    }
    let uv: Vec<f32> = flat_uvs(&sim.mesh).iter().flat_map(|p| [p[0] as f32, p[1] as f32]).collect();
    put_f32(&mut out, &uv);
    out.extend(sim.mesh.kind.iter().map(|k| (*k == VertexKind::Weld) as u8));
    while out.len() % 4 != 0 {
        out.push(0);
    }
    let mut buf = Vec::new();
    out.extend(pack_frame(sim, FRAME, &mut buf));
    out
}

/// The run loop: one frame after another until settled, then wait for a
/// raise (continues the run) or a stop / new run.
fn run(mut sim: Sim, rx: Receiver<Cmd>, ch: Channel<InvokeResponseBody>) {
    let mut buf = Vec::new();
    let mut idle = false; // paused or settled: wait for a command
    loop {
        let cmd = if idle { rx.recv().ok() } else { rx.try_recv().ok() };
        if idle && cmd.is_none() {
            return; // the window went away
        }
        match cmd {
            Some(Cmd::Stop) => return,
            Some(Cmd::Pause) => idle = true,
            Some(Cmd::Resume) => idle = sim.status() == Status::Settled,
            Some(c @ (Cmd::Pressure(_) | Cmd::Height(_))) => {
                let (ok, what) = match c {
                    Cmd::Pressure(p) => (sim.raise_pressure(p), "pressure"),
                    Cmd::Height(h) => (sim.raise_target_height(h), "height"),
                    _ => unreachable!(),
                };
                if ok {
                    idle = false;
                }
                if ch.send(InvokeResponseBody::Raw(message(RAISED, serde_json::json!({ "ok": ok, "what": what })))).is_err() {
                    return;
                }
            }
            None => {}
        }
        if idle {
            continue;
        }
        let info = sim.step_frame();
        if ch.send(InvokeResponseBody::Raw(pack_frame(&sim, FRAME, &mut buf))).is_err() {
            return;
        }
        if !info.stable {
            let _ = ch.send(InvokeResponseBody::Raw(message(FAILED, serde_json::json!({ "message": "unstable" }))));
            idle = true;
        } else if info.status == Status::Settled {
            if ch.send(InvokeResponseBody::Raw(message(SETTLED, serde_json::json!({})))).is_err() {
                return;
            }
            idle = true;
        }
    }
}

fn send(state: &State<'_, NativeState>, cmd: Cmd) {
    if let Some(tx) = state.0.lock().unwrap().as_ref() {
        let _ = tx.send(cmd);
    }
}

#[tauri::command]
pub fn native_stop(state: State<'_, NativeState>) {
    if let Some(tx) = state.0.lock().unwrap().take() {
        let _ = tx.send(Cmd::Stop);
    }
}

#[tauri::command]
pub fn native_pause(state: State<'_, NativeState>, paused: bool) {
    send(&state, if paused { Cmd::Pause } else { Cmd::Resume });
}

#[tauri::command]
pub fn native_raise(state: State<'_, NativeState>, pressure: Option<f64>, height_mm: Option<f64>) {
    if let Some(p) = pressure {
        send(&state, Cmd::Pressure(p));
    } else if let Some(h) = height_mm {
        send(&state, Cmd::Height(h));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Writes a start reply and a frame for a small square to target/, for
    /// ui/scripts or a quick Node check of the reader in simStore.ts.
    #[test]
    fn packs_start_and_frame() {
        let sq = Piece::new(vec![[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]]);
        let mut sim = Sim::new(&[sq], SimSettings::default()).unwrap();
        let start = pack_start(&sim);
        sim.step_frame();
        let frame = pack_frame(&sim, FRAME, &mut Vec::new());
        assert_eq!(start.len() % 4, 0);
        let n = sim.num_vertices();
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("target");
        std::fs::write(dir.join("native-start.bin"), &start).unwrap();
        std::fs::write(dir.join("native-frame.bin"), &frame).unwrap();
        std::fs::write(dir.join("native-expect.json"), serde_json::json!({ "n": n, "tris": sim.mesh.tris.len(), "x0": sim.positions_f64_mm()[0][0] }).to_string()).unwrap();
    }
}
