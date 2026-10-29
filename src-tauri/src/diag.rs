//! About & diagnostics (session 22): what the logo's popup shows — version,
//! platform, the file-open check (probe.rs), Reference installed or not, and
//! the problem reports kept in the crash folder (engine panics from crash.rs,
//! screen errors saved here by the UI).

use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

use crate::crash::crash_dir;

#[derive(Serialize)]
pub struct Report {
    name: String,
    /// Unix seconds, from the file name (simflate-crash-<s>.txt, simflate-screen-<s>.txt).
    secs: u64,
    first_line: String,
}

#[derive(Serialize)]
pub struct Diagnostics {
    version: String,
    os: String,
    arch: String,
    reports_dir: String,
    reports: Vec<Report>,
    file_check: Vec<String>,
    reference: Option<String>,
}

#[tauri::command]
pub fn diagnostics(app: AppHandle) -> Diagnostics {
    let dir = crash_dir();
    let mut reports: Vec<Report> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let secs = name.strip_suffix(".txt")?.rsplit('-').next()?.parse().ok()?;
            let text = fs::read_to_string(e.path()).ok()?;
            // Screen reports start with a heading; their error is on the "Error:" line.
            let line = text.lines().find_map(|l| l.strip_prefix("Error: ")).or_else(|| text.lines().next()).unwrap_or("");
            let first_line = line.chars().take(160).collect();
            Some(Report { name, secs, first_line })
        })
        .collect();
    reports.sort_by(|a, b| b.secs.cmp(&a.secs));
    let file_check = dir
        .parent()
        .and_then(|p| fs::read_to_string(p.join("file-open-check.txt")).ok())
        .map(|t| t.lines().rev().map(String::from).collect())
        .unwrap_or_default();
    Diagnostics {
        version: env!("CARGO_PKG_VERSION").into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        reports_dir: dir.display().to_string(),
        reports,
        file_check,
        reference: crate::reference::reference_check(app).ok(),
    }
}

/// One report's text. Only plain names inside the crash folder.
#[tauri::command]
pub fn diag_read(name: String) -> Result<String, String> {
    if name.contains(['/', '\\']) || name.contains("..") || !name.ends_with(".txt") {
        return Err("Not a report name.".into());
    }
    fs::read_to_string(crash_dir().join(&name)).map_err(|e| e.to_string())
}

/// Keep a screen error's report with the others (the UI's crash window).
#[tauri::command]
pub fn diag_save_report(text: String) -> Result<(), String> {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let dir = crash_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut path: PathBuf = dir.join(format!("simflate-screen-{secs}.txt"));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("simflate-screen-{}.txt", secs + n));
        n += 1;
    }
    fs::write(path, text).map_err(|e| e.to_string())
}

/// Show the reports folder in Explorer / Finder.
#[tauri::command]
pub fn diag_open_folder() -> Result<(), String> {
    let dir = crash_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let r = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&dir).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}
