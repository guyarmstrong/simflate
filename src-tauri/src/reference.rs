//! The Reference solver in the desktop app. The interface meshes the piece as
//! usual and hands the mesh over; `blown_ref::run` does the OpenCourant run
//! in a job folder on a background thread, and its frames and progress are
//! passed on to the window.
//!
//! Events: `reference-progress`, `reference-frame`, `reference-done`.
//!
//! `reference_prepare` runs OpenCourant's starter in the background while the
//! piece is being set up (one at a time, always the latest piece), so
//! pressing Inflate finds the model prepared (see `blown_ref::prepare`).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use blown_core::reference as rf;
use blown_core::Tuning;
use blown_ref::{Control, Event, FrameInfo, Job};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
pub struct RefState(Mutex<Option<(u32, Arc<Control>)>>, Mutex<Option<std::thread::JoinHandle<()>>>, Arc<PrepQueue>);

/// Background preparations: the latest piece waiting, and whether the
/// preparing thread is running.
#[derive(Default)]
pub struct PrepQueue {
    next: Mutex<Option<Job>>,
    busy: AtomicBool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefRequest {
    job: u32,
    positions: Vec<f32>,
    indices: Vec<u32>,
    weld: Vec<u8>,
    top_triangles: usize,
    thickness_mm: f64,
    character: f64,
    /// 0–100 slider (used when `target_height_mm` is None).
    pressure: f64,
    target_height_mm: Option<f64>,
    /// Symmetric solver: solve one slice of the (symmetric) mesh.
    #[serde(default)]
    symmetric: bool,
    #[serde(default)]
    waves_per_edge: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FrameEvent {
    job: u32,
    positions: Vec<f32>,
    info: FrameInfo,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    job: u32,
    fraction: f64,
    seconds_left: Option<f64>,
    phase: &'static str,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DoneEvent {
    job: u32,
    ok: bool,
    reached: bool,
    message: String,
    folder: String,
}

fn not_installed() -> String {
    "The Reference solver is missing from this installation (Windows only). Reinstall Simflate to put it back.".into()
}

/// OpenCourant: the copy installed with the app first (Windows installer,
/// see scripts/opencourant.mjs), then a separate install.
fn oc_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    let bundled = app.path().resource_dir().ok().into_iter().flat_map(|r| [r.join("opencourant"), r.join("resources").join("opencourant")]);
    blown_ref::install_dir_with(bundled)
}

/// Is the Reference solver installed? Ok(folder) or Err(what's missing).
#[tauri::command]
pub fn reference_check(app: AppHandle) -> Result<String, String> {
    oc_dir(&app).map(|d| d.display().to_string()).ok_or_else(not_installed)
}

/// Prepared models, kept between runs and app sessions (not in `reference`,
/// which every run clears).
fn prepared_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("reference-prepared"))
}

fn job_for(app: &AppHandle, oc: PathBuf, dir: PathBuf, req: RefRequest) -> Result<Job, String> {
    Ok(Job {
        oc,
        dir,
        positions: req.positions,
        indices: req.indices,
        weld: req.weld,
        top_triangles: req.top_triangles,
        thickness_mm: req.thickness_mm,
        character: req.character,
        pressure: req.pressure,
        target_height_mm: req.target_height_mm,
        options: None,
        symmetric: req.symmetric,
        waves_per_edge: req.waves_per_edge,
        prepared: Some(prepared_dir(app)?),
    })
}

/// Prepare this piece's model in the background (Reference chosen, piece or
/// settings changed). Later requests replace any still waiting.
#[tauri::command]
pub fn reference_prepare(app: AppHandle, state: State<'_, RefState>, req: RefRequest) -> Result<(), String> {
    let oc = oc_dir(&app).ok_or_else(not_installed)?;
    let scratch = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("reference-prepare");
    let job = job_for(&app, oc, scratch, req)?;
    let q = state.2.clone();
    *q.next.lock().unwrap() = Some(job);
    if !q.busy.swap(true, Ordering::SeqCst) {
        std::thread::spawn(move || loop {
            let next = q.next.lock().unwrap().take();
            match next {
                Some(job) => {
                    let _ = blown_ref::prepare(&job);
                }
                None => {
                    q.busy.store(false, Ordering::SeqCst);
                    // A request that came in just now: carry on, unless another thread took it.
                    if q.next.lock().unwrap().is_none() || q.busy.swap(true, Ordering::SeqCst) {
                        break;
                    }
                }
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn reference_start(app: AppHandle, state: State<'_, RefState>, req: RefRequest) -> Result<String, String> {
    let oc = oc_dir(&app).ok_or_else(not_installed)?;
    if let Some((_, old)) = state.0.lock().unwrap().take() {
        old.stop.store(true, Ordering::SeqCst);
    }
    let previous = state.1.lock().unwrap().take();
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("reference");
    // Unique to this app session too: job numbers restart with the app.
    let dir = base.join(format!("run-{}-{}", std::process::id(), req.job));
    let id = req.job;
    let job = job_for(&app, oc, dir, req)?;
    let ctl = Arc::new(Control::default());
    *ctl.target.lock().unwrap() = blown_ref::target_for(&job);
    *state.0.lock().unwrap() = Some((id, ctl.clone()));
    let folder = job.dir.display().to_string();
    let handle = std::thread::spawn(move || {
        // The run being replaced stops its engine first (within a second or
        // so); then nothing may be left over — not even from an app that
        // quit or restarted mid-run — before the folders are cleared.
        if let Some(h) = previous {
            let _ = h.join();
        }
        blown_ref::stop_all();
        // One folder per run; older runs are cleared (each is tens of MB).
        if let Ok(entries) = fs::read_dir(&base) {
            for e in entries.flatten() {
                let _ = fs::remove_dir_all(e.path());
            }
        }
        let mut on = |ev: Event| {
            let _ = match ev {
                Event::Progress { fraction, seconds_left, phase } => app.emit("reference-progress", ProgressEvent { job: id, fraction, seconds_left, phase }),
                Event::Frame { positions, info } => app.emit("reference-frame", FrameEvent { job: id, positions, info }),
            };
        };
        let (ok, reached, message) = match blown_ref::run(&job, &ctl, &mut on) {
            Ok(o) => (true, o.reached, o.message),
            Err(e) => (false, false, e),
        };
        let _ = app.emit("reference-done", DoneEvent { job: id, ok, reached, message, folder: job.dir.display().to_string() });
    });
    *state.1.lock().unwrap() = Some(handle);
    Ok(folder)
}

#[tauri::command]
pub fn reference_stop(state: State<'_, RefState>) {
    if let Some((_, ctl)) = state.0.lock().unwrap().as_ref() {
        ctl.stop.store(true, Ordering::SeqCst);
    }
}

/// Raise the target mid-run (slider 0–100, or mm in height mode).
#[tauri::command]
pub fn reference_retarget(state: State<'_, RefState>, job: u32, pressure: Option<f64>, height_mm: Option<f64>, character: f64, thickness_mm: f64, area_mm2: f64) {
    if let Some((_, ctl)) = state.0.lock().unwrap().as_ref().filter(|(id, _)| *id == job) {
        let mut t = ctl.target.lock().unwrap();
        if let (Some(p), Some(_)) = (pressure, t.pressure_mpa) {
            t.pressure_mpa = Some(rf::slider_to_mpa(&Tuning::default(), p, character, area_mm2, thickness_mm));
        }
        if let (Some(h), Some(_)) = (height_mm, t.height_mm) {
            t.height_mm = Some(h);
        }
    }
}
