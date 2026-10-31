//! The Reference solver run: OpenCourant (open-source explicit FE, the
//! OpenRadioss successor) on KIT's die-less hydroforming recipe. Given a
//! BlownSim mesh it writes the model into a job folder, runs the starter and
//! engine, turns each animation frame back into BlownSim vertex order and
//! hands it over as it appears. Water is pumped in steadily; the run stops
//! when it reaches the target pressure or height (like stopping the pump in
//! the workshop). Used by the desktop app and by `blown-cli ref-run`.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use blown_core::reference::{self as rf, RefOptions};
use blown_core::symmetry::Fold;
use blown_core::Tuning;
use serde::Serialize;

/// Where OpenCourant lives: `BLOWNSIM_OPENCOURANT`, else `~/OpenCourant/OpenCourant`.
pub fn install_dir() -> Option<PathBuf> {
    install_dir_with([])
}

/// As `install_dir`, but trying `first` before anything else (the desktop
/// app's own copy, installed with it).
pub fn install_dir_with(first: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    let candidates = first
        .into_iter()
        .chain(std::env::var_os("BLOWNSIM_OPENCOURANT").map(PathBuf::from))
        .chain(std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join("OpenCourant").join("OpenCourant")));
    let found = candidates.into_iter().map(|d| plain_path(&d)).find(|d| usable(d));
    #[cfg(target_os = "macos")]
    if let Some(d) = &found {
        unquarantine(d);
    }
    found
}

/// A downloaded app's files carry the Mac's quarantine mark, and the Mac may
/// refuse to start an engine program that has it even once Simflate itself
/// is allowed. Cleared from our own engine folder once per app session; if
/// it can't be (app folder not writable), runs report the engine's error.
#[cfg(target_os = "macos")]
fn unquarantine(oc: &Path) {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let _ = Command::new("xattr").args(["-dr", "com.apple.quarantine"]).arg(oc.join("exec")).stdout(Stdio::null()).stderr(Stdio::null()).status();
    });
}

/// `\\?\D:\…` → `D:\…` (and `\\?\UNC\server\…` → `\\server\…`). The app
/// finds its own folder in Windows' long-path form, which OpenCourant's
/// starter can't read ("Reader configuration files are not available").
fn plain_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{rest}"))
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        p.to_path_buf()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_paths_become_plain() {
        assert_eq!(plain_path(Path::new(r"\\?\D:\Apps\BlownSim\opencourant")), PathBuf::from(r"D:\Apps\BlownSim\opencourant"));
        assert_eq!(plain_path(Path::new(r"\\?\UNC\server\share\oc")), PathBuf::from(r"\\server\share\oc"));
        assert_eq!(plain_path(Path::new(r"C:\OpenCourant")), PathBuf::from(r"C:\OpenCourant"));
    }

    #[test]
    fn mac_programs_by_chip() {
        let thin = |cpu: u32| [0xFEED_FACFu32.to_le_bytes(), cpu.to_le_bytes()].concat();
        assert!(macho_has(&thin(ARM64), ARM64));
        assert!(!macho_has(&thin(ARM64), X86_64));
        let mut fat = [0xCAFE_BABEu32.to_be_bytes(), 2u32.to_be_bytes()].concat();
        for cpu in [X86_64, ARM64] {
            fat.extend(cpu.to_be_bytes());
            fat.extend([0u8; 16]);
        }
        assert!(macho_has(&fat, ARM64) && macho_has(&fat, X86_64));
        assert!(!macho_has(b"MZ\x90\0not a mac program", ARM64));
    }
}

/// Mach-O CPU types (cputype field).
const ARM64: u32 = 0x0100_000C;
const X86_64: u32 = 0x0100_0007;

/// Does this Mach-O file (thin or universal) hold code for `cpu`?
fn macho_has(b: &[u8], cpu: u32) -> bool {
    let le = |i: usize| b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]));
    let be = |i: usize| b.get(i..i + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]));
    if le(0) == Some(0xFEED_FACF) {
        return le(4) == Some(cpu);
    }
    if be(0) == Some(0xCAFE_BABE) {
        let n = be(4).unwrap_or(0).min(16) as usize;
        return (0..n).any(|k| be(8 + k * 20) == Some(cpu));
    }
    false
}

/// On a Mac: can this program run on this Mac's chip? Our Mac engine is
/// Apple silicon only until the Intel build joins it (then one universal
/// set), so an Intel Mac must not offer Reference with it.
fn for_this_chip(file: &Path) -> bool {
    if !cfg!(target_os = "macos") {
        return true;
    }
    use std::io::Read;
    let mut head = Vec::new();
    let read = fs::File::open(file).and_then(|f| f.take(4096).read_to_end(&mut head));
    read.is_ok() && macho_has(&head, if cfg!(target_arch = "aarch64") { ARM64 } else { X86_64 })
}

/// What one run inflates and how far.
#[derive(Clone, Debug)]
pub struct Job {
    /// OpenCourant folder (see `install_dir`).
    pub oc: PathBuf,
    /// Job folder (made if missing).
    pub dir: PathBuf,
    /// Flat mesh: x, y per point (z ignored); `weld` = 1 on weld points; the
    /// first `top_triangles` triangles are the top sheet.
    pub positions: Vec<f32>,
    pub indices: Vec<u32>,
    pub weld: Vec<u8>,
    pub top_triangles: usize,
    pub thickness_mm: f64,
    pub character: f64,
    /// 0–100 slider (used when `target_height_mm` is None).
    pub pressure: f64,
    pub target_height_mm: Option<f64>,
    /// Overrides the automatic plan (water, pumping time, frames).
    pub options: Option<RefOptions>,
    /// Symmetric solver: the mesh is mirror-symmetric (meshed with
    /// `SimSettings::symmetric`); solve one slice with mirror planes and
    /// unfold every frame to the whole piece.
    pub symmetric: bool,
    /// Seeded edge waves: crests per edge between corners (0 = none).
    pub waves_per_edge: u32,
    /// Prepared models are kept here between runs (see `prepare`); None:
    /// every run prepares its own.
    pub prepared: Option<PathBuf>,
}

/// When to stop pumping. Either can be raised while the run goes.
#[derive(Clone, Copy, Debug, Default)]
pub struct Target {
    pub pressure_mpa: Option<f64>,
    pub height_mm: Option<f64>,
}

/// Shared with whoever started the run: stop it, or move the target.
#[derive(Default)]
pub struct Control {
    pub stop: AtomicBool,
    pub target: Mutex<Target>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FrameInfo {
    pub frame: usize,
    pub time: f64,
    /// On the app's 0–100 slider scale.
    pub pressure: f64,
    pub pressure_bar: Option<f64>,
    pub height_mm: f64,
    pub volume_ml: f64,
    pub contact_fraction: f64,
    pub max_stretch_pct: f64,
    pub motion: f64,
    pub status: &'static str,
    pub stable: bool,
}

pub enum Event {
    /// `fraction` 0–1 of the way to the target (or the end of the pumping);
    /// `seconds_left` = the engine's own estimate to the end of the pumping.
    Progress { fraction: f64, seconds_left: Option<f64>, phase: &'static str },
    Frame { positions: Vec<f32>, info: FrameInfo },
}

pub struct Outcome {
    pub reached: bool,
    pub message: String,
    pub seconds: f64,
}

/// The target for the job's settings.
pub fn target_for(job: &Job) -> Target {
    let area = rf::flat_area(&job.positions, &job.indices, job.top_triangles);
    Target {
        pressure_mpa: match job.target_height_mm {
            Some(_) => None,
            None => Some(rf::slider_to_mpa(&Tuning::default(), job.pressure, job.character, area, job.thickness_mm)),
        },
        height_mm: job.target_height_mm,
    }
}

/// How the engine runs: (copies, threads each). Several copies, each on its
/// own part of the sheet (MPI), beat one copy on many threads: Guy's leaf on
/// the i7-12700H to 0.02 s took 182 s on 1 × 12, 108 s on 2 × 4, 87 s on
/// 4 × 2, 96 s on 6 × 1. The shape matches to rounding (same height; folds
/// can shift a little, as with any change in summing order). Needs the MPI
/// engine and Intel's launcher; otherwise one copy as before. A small model
/// (a Symmetric slice) is quicker on one copy, two threads: the copies spend
/// their time talking (300 mm square, 1/8 slice, 400 points: 4 x 2 1.6 min,
/// 1 x 4 1.5, 1 x 2 1.2, 1 x 1 0.8 — half of that is the engine starting).
fn layout(oc: &Path, points: usize) -> (usize, usize) {
    let cores = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let mpi = has_mpi(oc);
    match std::env::var("BLOWN_REF_LAYOUT").ok().and_then(|v| v.split_once('x').map(|(a, b)| (a.parse().ok(), b.parse().ok()))) {
        Some((Some(r), Some(t))) if r >= 1 && t >= 1 && (r == 1 || mpi) => return (r, t),
        _ => {}
    }
    if points < SMALL_MODEL {
        (1, 2.min(cores))
    } else if mpi && cores >= 8 {
        (4, 2)
    } else {
        (1, (cores / 2).clamp(2, 8))
    }
}

/// Below this many points a model runs on one engine copy.
const SMALL_MODEL: usize = 2500;

fn exe(oc: &Path, name: &str) -> bool {
    oc.join("exec").join(name).is_file()
}

/// OpenCourant's platform tag in program and library folder names: `win64`
/// (their release); `macos` for our own Mac build (session 22; OpenCourant
/// publishes no Mac version), one universal set for Apple silicon and Intel,
/// renamed from `macosa64_gf` when packed (scripts/opencourant.mjs);
/// `linux64` / `linuxa64`.
const ARCH: &str = if cfg!(windows) {
    "win64"
} else if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(target_arch = "aarch64") {
    "linuxa64"
} else {
    "linux64"
};
const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// `starter` + `_sp` → `starter_win64_sp.exe` here, `starter_macos_sp` on a Mac.
fn prog(stem: &str, suffix: &str) -> String {
    format!("{stem}_{ARCH}{suffix}{EXE}")
}

/// Single precision: OpenCourant's `_sp` starter and engines, used when
/// they're there (`BLOWN_REF_SP=0` turns it off). Guy's leaf to 80 mm: same
/// piece to 0.01 mm, 2.3 -> 1.9 min.
fn single(oc: &Path) -> bool {
    std::env::var("BLOWN_REF_SP").map(|v| v != "0").unwrap_or(true)
        && exe(oc, &prog("starter", "_sp"))
        && (exe(oc, &prog("engine", "_sp")) || exe(oc, &prog("engine", "_impi_sp")) || exe(oc, BRANDED_ENGINE))
}

/// The installer ships `engine_win64_impi_sp.exe` under this name (same
/// file), so the four copies in Task Manager say whose they are (Guy:
/// unnamed engines at a few % each look like nothing is happening).
pub const BRANDED_ENGINE: &str = if cfg!(windows) { "Simflate Reference engine.exe" } else { "Simflate Reference engine" };

/// `engine_win64` + `_impi` (several copies) + `_sp` (single precision).
/// The Mac build has no MPI: one engine copy on several threads.
fn engine_exe(oc: &Path, mpi: bool) -> String {
    if (mpi || !cfg!(windows)) && single(oc) && exe(oc, BRANDED_ENGINE) {
        return BRANDED_ENGINE.into();
    }
    prog("engine", &format!("{}{}", if mpi { "_impi" } else { "" }, if single(oc) { "_sp" } else { "" }))
}

fn has_mpi(oc: &Path) -> bool {
    cfg!(windows) && exe(oc, &engine_exe(oc, true)) && mpiexec(oc).is_file()
}

/// Something to run: a starter and an engine (the installer ships only the
/// single-precision MPI pair; a full OpenCourant install has them all).
fn usable(oc: &Path) -> bool {
    (exe(oc, &prog("starter", "")) || exe(oc, &prog("starter", "_sp")))
        && (exe(oc, &engine_exe(oc, false)) || has_mpi(oc))
        && for_this_chip(&oc.join("exec").join(engine_exe(oc, false)))
}

fn mpiexec(oc: &Path) -> PathBuf {
    oc.join("extlib").join("intelOneAPI_runtime").join("win64").join("mpiexec.exe")
}

fn engine_command(oc: &Path, dir: &Path, ranks: usize, threads: usize) -> Command {
    let nt = threads.to_string();
    let plain = engine_exe(oc, false);
    // One copy: the plain engine if it's there, else the MPI one on its own.
    if ranks <= 1 && exe(oc, &plain) {
        let mut c = command(oc, &plain, dir);
        c.args(["-i", "model_0001.rad", "-nt", &nt]);
        return c;
    }
    let c = command(oc, &plain, dir);
    let engine = oc.join("exec").join(engine_exe(oc, true));
    // Same environment, but started through Intel's launcher on this computer only.
    let mut m = Command::new(mpiexec(oc));
    for (k, v) in c.get_envs() {
        if let Some(v) = v {
            m.env(k, v);
        }
    }
    m.current_dir(dir).stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        m.creation_flags(0x0800_0000); // no console window
    }
    m.args(["-localonly", "-n", &ranks.max(1).to_string()]).arg(engine).args(["-i", "model_0001.rad", "-nt", &nt]);
    m
}

/// Stop the engine, every copy of it. The MPI copies are started by Intel's
/// proxy, not as children of the launcher, so they're stopped by name (only
/// one Reference run happens at a time).
fn stop_engine(engine: &mut Child) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/PID", &engine.id().to_string(), "/T", "/F"]).creation_flags(0x0800_0000).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    stop_all();
    let _ = engine.kill();
    let _ = engine.wait();
}

/// Stop every Reference engine on this computer: all its versions, Intel's
/// launcher and proxies. Only one Reference run happens at a time, so any
/// still going is left over — from the run being replaced, or from an app
/// that quit or restarted mid-run (session 14: an orphaned run kept writing
/// into the folder the next one used, and the new engine crashed).
pub fn stop_all() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        for name in ["engine_win64.exe", "engine_win64_sp.exe", "engine_win64_impi.exe", "engine_win64_impi_sp.exe", BRANDED_ENGINE, "hydra_pmi_proxy.exe", "mpiexec.exe"] {
            let _ = Command::new("taskkill").args(["/IM", name, "/F"]).creation_flags(0x0800_0000).stdout(Stdio::null()).stderr(Stdio::null()).status();
        }
    }
    // A Mac keeps only 16 characters of a process name, so the branded engine
    // is found by its whole command line (-f) instead of its name (-x).
    #[cfg(not(windows))]
    for (how, name) in [("-x", prog("engine", "")), ("-x", prog("engine", "_sp")), ("-f", format!("exec/{BRANDED_ENGINE}"))] {
        let _ = Command::new("pkill").args([how, &name]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
}

fn command(oc: &Path, exe: &str, dir: &Path) -> Command {
    let mut c = Command::new(oc.join("exec").join(exe));
    let ext = oc.join("extlib");
    let h3d = ext.join("h3d").join("lib").join(ARCH);
    // Where the programs find their libraries: PATH on Windows; on the Mac the
    // reader, compiler runtime and OpenMP live in extlib/runtime/<arch>.
    let var = if cfg!(windows) { "PATH" } else if cfg!(target_os = "macos") { "DYLD_LIBRARY_PATH" } else { "LD_LIBRARY_PATH" };
    let path = std::env::join_paths(
        [ext.join("hm_reader").join(ARCH), ext.join("intelOneAPI_runtime").join(ARCH), ext.join("runtime").join(ARCH), h3d.clone()]
            .into_iter()
            .filter(|d| cfg!(windows) || d.is_dir())
            .chain(std::env::var_os(var).map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).unwrap_or_default()),
    )
    .unwrap_or_default();
    c.current_dir(dir)
        .env("RAD_CFG_PATH", oc.join("hm_cfg_files"))
        .env("RAD_H3D_PATH", &h3d)
        .env("KMP_STACKSIZE", "400m")
        .env(var, path)
        .stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // no console window
    }
    c
}

fn log_file(dir: &Path, name: &str) -> Result<Stdio, String> {
    fs::File::create(dir.join(name)).map(Stdio::from).map_err(|e| e.to_string())
}

/// Last "T=" and "REMAINING TIME=" from the engine's log.
fn engine_progress(dir: &Path) -> (Option<f64>, Option<f64>) {
    let Ok(text) = fs::read_to_string(dir.join("engine.log")) else { return (None, None) };
    let mut cut = text.len().saturating_sub(4000);
    while !text.is_char_boundary(cut) {
        cut += 1;
    }
    let tail = &text[cut..];
    let num_after = |key: &str| tail.rfind(key).and_then(|i| tail[i + key.len()..].split_whitespace().next()).and_then(|v| v.parse::<f64>().ok());
    (num_after(" T="), num_after("REMAINING TIME="))
}

fn minutes(secs: f64) -> String {
    let m = (secs / 60.0).round().max(1.0);
    format!("{m} min")
}

/// Run the job to the target (or the end of the pumping). Frames and
/// progress go to `on` as they appear. The caller sets `ctl.target`
/// (usually `target_for(job)`) before starting.
/// The model as OpenCourant's starter reads it, and everything that
/// follows from it.
struct Model {
    area: f64,
    opts: RefOptions,
    fold: Option<Fold>,
    deck: String,
    ranks: usize,
    threads: usize,
    /// Same key, same starter output: the deck, the number of copies and
    /// the starter itself.
    key: String,
}

fn model(job: &Job) -> Result<Model, String> {
    let n = job.positions.len() / 3;
    if n == 0 || job.weld.len() != n {
        return Err("No mesh to send to the Reference solver.".into());
    }
    let area = rf::flat_area(&job.positions, &job.indices, job.top_triangles);
    let mut opts = job.options.clone().unwrap_or_else(|| rf::plan(area, job.thickness_mm));
    let fold = if job.symmetric { Some(Fold::new(&job.positions, &job.indices, &job.weld, job.top_triangles)?) } else { None };
    // Edge waves are laid on the whole piece (so they're the same on every
    // edge), then the slice takes its share.
    let seed = if job.waves_per_edge > 0 { rf::edge_waves(&job.positions, &job.indices, job.top_triangles, job.waves_per_edge, rf::edge_wave_mm(job.thickness_mm)) } else { vec![] };
    // One title for every run, so the same piece gives the same deck.
    let title = "Simflate";
    let deck = match &fold {
        Some(f) => {
            // One slice gets its share of the water.
            opts.volume_l /= f.copies() as f64;
            opts.mirrors = f.mirrors.clone();
            opts.centre = f.centre.clone();
            if !seed.is_empty() {
                opts.z_seed = f.source.iter().map(|&i| seed[i as usize]).collect();
            }
            rf::deck(title, &f.positions, &f.indices, &f.weld, f.top_triangles, &opts)
        }
        None => {
            opts.z_seed = seed;
            rf::deck(title, &job.positions, &job.indices, &job.weld, job.top_triangles, &opts)
        }
    };
    let (ranks, threads) = layout(&job.oc, fold.as_ref().map_or(job.positions.len(), |f| f.positions.len()) / 3);
    let starter = job.oc.join("exec").join(starter_exe(&job.oc));
    let stamp = fs::metadata(&starter).map(|m| format!("{} {:?}", m.len(), m.modified().ok())).unwrap_or_default();
    let key = format!("{:016x}", fnv1a(&[deck.as_bytes(), &ranks.to_le_bytes(), stamp.as_bytes()]));
    Ok(Model { area, opts, fold, deck, ranks, threads, key })
}

/// 64-bit FNV-1a: a fixed, simple fingerprint (same on every computer and build).
fn fnv1a(parts: &[&[u8]]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for part in parts {
        for &b in *part {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        h ^= 0xff;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn starter_exe(oc: &Path) -> String {
    prog("starter", if single(oc) { "_sp" } else { "" })
}

/// OpenCourant's starter: model.k → the engine's input (model_0001.rad) and
/// one restart file per copy (model_0000_000N.rst).
fn run_starter(oc: &Path, dir: &Path, ranks: usize) -> Result<(), String> {
    let status = command(oc, &starter_exe(oc), dir)
        .args(["-i", "model.k", "-np", &ranks.to_string()])
        .stdout(log_file(dir, "starter.log")?)
        .stderr(log_file(dir, "starter.err")?)
        .status()
        .map_err(|e| format!("Could not start OpenCourant: {e}"))?;
    if !dir.join("model_0001.rad").exists() {
        return Err(format!("OpenCourant could not read the model (starter exit {status}). Details: {}", dir.join("model_0000.out").display()));
    }
    Ok(())
}

// --- Prepared models -----------------------------------------------------
// The starter can be slow on company laptops (Guy's test laptop: ~50 s, held
// by its antivirus; 2 s here). Its output depends only on the model, so it's
// kept: `prepare` runs it in the background while the piece is being set
// up, and a run with the same model copies the files in instead. The engine
// gets exactly the same input either way.

/// How many prepared models are kept (each is a few to tens of MB).
const KEEP_PREPARED: usize = 8;

/// The model being prepared in the background right now (its key).
static PREPARING: Mutex<Option<String>> = Mutex::new(None);

fn is_starter_output(name: &str) -> bool {
    name.starts_with("model_0000") || name == "model_0001.rad"
}

fn copy_files(from: &Path, to: &Path, keep: impl Fn(&str) -> bool) -> Result<(), String> {
    for f in fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let name = f.file_name().to_string_lossy().to_string();
        if name != "done" && keep(&name) {
            fs::copy(f.path(), to.join(&name)).map_err(|e| format!("Could not copy the prepared model: {e}"))?;
        }
    }
    Ok(())
}

/// The folder holding this model's starter output, once it's complete;
/// waits for a background preparation of the same model to finish.
fn wait_for_prepared(cache: &Path, key: &str, stopped: &dyn Fn() -> bool) -> Option<PathBuf> {
    let ready = cache.join(key);
    loop {
        if ready.join("done").is_file() {
            // Recently used: the last to be cleared.
            let _ = fs::write(ready.join("done"), b"");
            return Some(ready);
        }
        if stopped() || PREPARING.lock().unwrap().as_deref() != Some(key) {
            return None;
        }
        std::thread::sleep(Duration::from_millis(300));
    }
}

/// Keep a run folder's starter output as this model's prepared copy.
fn keep_prepared(cache: &Path, key: &str, dir: &Path) {
    let part = cache.join(format!("{key}.part{}", std::process::id()));
    let _ = fs::remove_dir_all(&part);
    let kept = fs::create_dir_all(&part).is_ok() && copy_files(dir, &part, is_starter_output).is_ok() && fs::write(part.join("done"), b"").is_ok() && fs::rename(&part, cache.join(key)).is_ok();
    if !kept {
        let _ = fs::remove_dir_all(&part);
    }
    prune(cache);
}

/// Only the most recently used prepared models stay.
fn prune(cache: &Path) {
    let Ok(entries) = fs::read_dir(cache) else { return };
    let mut ready: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let t = fs::metadata(p.join("done")).and_then(|m| m.modified()).ok()?;
            Some((t, p))
        })
        .collect();
    ready.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, p) in ready.into_iter().skip(KEEP_PREPARED) {
        let _ = fs::remove_dir_all(p);
    }
}

/// Prepare this job's model ahead of its run (the starter, in `job.dir`, a
/// scratch folder), so pressing Inflate can start the engines at once.
/// Returns false if it was prepared already.
pub fn prepare(job: &Job) -> Result<bool, String> {
    let Some(cache) = &job.prepared else { return Ok(false) };
    let m = model(job)?;
    if cache.join(&m.key).join("done").is_file() {
        return Ok(false);
    }
    struct Busy;
    impl Drop for Busy {
        fn drop(&mut self) {
            *PREPARING.lock().unwrap() = None;
        }
    }
    *PREPARING.lock().unwrap() = Some(m.key.clone());
    let _busy = Busy;
    let dir = &job.dir;
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("model.k"), &m.deck).map_err(|e| e.to_string())?;
    run_starter(&job.oc, dir, m.ranks)?;
    keep_prepared(cache, &m.key, dir);
    let _ = fs::remove_dir_all(dir);
    Ok(true)
}

pub fn run(job: &Job, ctl: &Control, on: &mut dyn FnMut(Event)) -> Result<Outcome, String> {
    let Model { area, opts, fold, deck, ranks, threads, key } = model(job)?;
    let tuning = Tuning::default();
    let dir = &job.dir;
    fs::create_dir_all(dir).map_err(|e| format!("Could not make the run folder: {e}"))?;
    fs::write(dir.join("model.k"), deck).map_err(|e| e.to_string())?;
    for f in fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
        let name = f.file_name().to_string_lossy().to_string();
        if name.starts_with("modelA") || name.starts_with("modelT") || name.starts_with("model_000") {
            let _ = fs::remove_file(f.path());
        }
    }
    let started = Instant::now();
    on(Event::Progress { fraction: 0.0, seconds_left: None, phase: "Preparing the model" });
    let stopped = || ctl.stop.load(Ordering::SeqCst);
    // Prepared already (in the background, or by an earlier run)? Then the
    // starter's files are copied in instead of running it again.
    match job.prepared.as_deref().and_then(|c| wait_for_prepared(c, &key, &stopped)) {
        Some(ready) => copy_files(&ready, dir, |_| true)?,
        None => {
            if stopped() {
                return Ok(Outcome { reached: false, message: "Stopped.".into(), seconds: started.elapsed().as_secs_f64() });
            }
            run_starter(&job.oc, dir, ranks)?;
            if let Some(c) = &job.prepared {
                keep_prepared(c, &key, dir);
            }
        }
    }
    if stopped() {
        return Ok(Outcome { reached: false, message: "Stopped.".into(), seconds: started.elapsed().as_secs_f64() });
    }
    let mut engine: Child = engine_command(&job.oc, dir, ranks, threads)
        .env("OMP_NUM_THREADS", threads.to_string())
        .stdout(log_file(dir, "engine.log")?)
        .stderr(log_file(dir, "engine.err")?)
        .spawn()
        .map_err(|e| format!("Could not start the OpenCourant engine: {e}"))?;

    let mut next = 1usize; // next animation file to read (modelA001 …)
    let mut sent = 0usize;
    loop {
        let exited = engine.try_wait().map_err(|e| e.to_string())?.is_some();
        if stopped() && !exited {
            stop_engine(&mut engine);
            return Ok(Outcome { reached: false, message: "Stopped.".into(), seconds: started.elapsed().as_secs_f64() });
        }
        let history = fs::read(dir.join("modelT01")).map(|b| rf::read_water_history(&b)).unwrap_or_default();
        // A frame is complete once the next one exists, or the engine has finished.
        let mut reached = false;
        while dir.join(format!("modelA{next:03}")).exists() && (exited || dir.join(format!("modelA{:03}", next + 1)).exists()) {
            let (positions, info) = read_frame(job, fold.as_ref(), &tuning, area, next, sent, &history, exited)?;
            next += 1;
            sent += 1;
            let t = *ctl.target.lock().unwrap();
            let hit_p = matches!((t.pressure_mpa, info.pressure_bar), (Some(tp), Some(pb)) if pb / 10.0 >= tp);
            let hit_h = matches!(t.height_mm, Some(th) if info.height_mm >= th);
            on(Event::Frame { positions, info });
            if (hit_p || hit_h) && sent > 1 {
                reached = true;
                break;
            }
        }
        if reached {
            stop_engine(&mut engine);
            let seconds = started.elapsed().as_secs_f64();
            return Ok(Outcome { reached: true, message: format!("Reached the target in {}.", minutes(seconds)), seconds });
        }
        if exited {
            let out = fs::read_to_string(dir.join("model_0001.out")).unwrap_or_default();
            let seconds = started.elapsed().as_secs_f64();
            if out.contains("NORMAL TERMINATION") {
                return Ok(Outcome { reached: false, message: format!("Pumped the full amount in {} without reaching the target.", minutes(seconds)), seconds });
            }
            return Err(format!("OpenCourant stopped early. Details: {}", dir.join("model_0001.out").display()));
        }
        // Progress: the further of time pumped and the way to the target.
        let (t_now, left) = engine_progress(dir);
        let by_time = t_now.unwrap_or(0.0) / opts.time_s;
        let tgt = *ctl.target.lock().unwrap();
        let by_target = match tgt.pressure_mpa {
            Some(tp) if tp > 0.0 => history.last().map(|s| s.pressure_mpa / tp).unwrap_or(0.0),
            _ => 0.0,
        };
        on(Event::Progress { fraction: by_time.max(by_target).clamp(0.0, 1.0), seconds_left: left, phase: "Inflating" });
        std::thread::sleep(Duration::from_millis(700));
    }
}

/// Convert animation file `modelA<file>` and measure it. The binary is
/// deleted once read (the folder stays small).
#[allow(clippy::too_many_arguments)]
fn read_frame(job: &Job, fold: Option<&Fold>, tuning: &Tuning, area: f64, file: usize, index: usize, history: &[rf::WaterSample], last: bool) -> Result<(Vec<f32>, FrameInfo), String> {
    let name = format!("modelA{file:03}");
    let out = command(&job.oc, &prog("anim_to_vtk", ""), &job.dir).arg(&name).stdout(Stdio::piped()).stderr(Stdio::null()).output().map_err(|e| e.to_string())?;
    let mut fr = rf::read_vtk(&String::from_utf8_lossy(&out.stdout), fold.map_or(job.positions.len(), |f| f.positions.len()) / 3)?;
    if let Some(f) = fold {
        fr.positions = f.unfold(&fr.positions);
    }
    let _ = fs::remove_file(job.dir.join(&name));
    let (lo, hi) = fr.positions.chunks(3).map(|p| p[2] as f64).fold((f64::MAX, f64::MIN), |(lo, hi), z| (lo.min(z), hi.max(z)));
    let p = |i: u32| {
        let k = 3 * i as usize;
        [fr.positions[k] as f64, fr.positions[k + 1] as f64, fr.positions[k + 2] as f64]
    };
    let volume: f64 = job
        .indices
        .chunks(3)
        .map(|t| {
            let (a, b, c) = (p(t[0]), p(t[1]), p(t[2]));
            a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
        })
        .sum::<f64>()
        .abs()
        / 6.0;
    // The history file is written in chunks: if it lags, use its latest value.
    let mpa = rf::pressure_at(history, fr.time).or(history.last().map(|s| s.pressure_mpa));
    let info = FrameInfo {
        frame: index,
        time: fr.time,
        pressure: mpa.map(|m| rf::mpa_to_slider(tuning, m, job.character, area, job.thickness_mm)).unwrap_or(0.0),
        pressure_bar: mpa.map(|m| m * 10.0),
        height_mm: hi - lo,
        volume_ml: volume / 1000.0,
        contact_fraction: 0.0,
        max_stretch_pct: 100.0 * fr.peak_plastic,
        motion: 0.0,
        status: if last { "settled" } else { "running" },
        stable: true,
    };
    Ok((fr.positions, info))
}
