//! Simflate desktop shell. The interface (ui/) runs inside this window.
//! Native jobs live here: the Fast / Steel solvers on several cores
//! (native.rs; the browser version runs them as WebAssembly), saving exports
//! through a proper "Save as…" dialog, the Reference solver (OpenCourant,
//! run offline: see reference.rs), and the graphics-card choice (gpu.rs).

mod clip;
mod crash;
mod diag;
mod fonts;
mod gpu;
mod native;
mod probe;
mod reference;

use std::path::PathBuf;

use tauri_plugin_dialog::DialogExt;

fn ask_path(app: &tauri::AppHandle, name: &str) -> Option<PathBuf> {
    let ext = name.rsplit('.').next().unwrap_or("").to_string();
    let mut dialog = app.dialog().file().set_file_name(name);
    if !ext.is_empty() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }
    dialog.blocking_save_file().and_then(|p| p.into_path().ok())
}

/// Write a file so that a failed save (disk full, a sync program holding it,
/// the app closing) never leaves a half-written file: write a temporary copy
/// beside it, then swap it in. The old file stays intact until the swap.
fn write_safely(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let fail = |e: std::io::Error| format!("Could not save {}: {e}", path.display());
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".saving");
    let tmp = PathBuf::from(tmp);
    let written = (|| {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()
    })();
    if let Err(e) = written.and_then(|_| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail(e));
    }
    Ok(())
}

/// Ask where to save, then write the bytes. Returns the chosen path, or None if cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, data: Vec<u8>) -> Result<Option<String>, String> {
    let Some(path) = ask_path(&app, &name) else { return Ok(None) };
    write_safely(&path, &data)?;
    Ok(Some(path.display().to_string()))
}

/// The files of a bundle, sent as raw bytes (a big OBJ sent as a JSON list of
/// numbers took about 1 GB of memory): u32 count, then for each file u32
/// name length, the name (UTF-8), u32 data length, the data. Little-endian.
fn unpack_bundle(body: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let bad = || "The export arrived damaged — please try again.".to_string();
    let mut at = 0usize;
    let u32_at = |at: &mut usize| -> Result<usize, String> {
        let b = body.get(*at..*at + 4).ok_or_else(bad)?;
        *at += 4;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
    };
    let count = u32_at(&mut at)?;
    let mut files = Vec::with_capacity(count.min(64));
    for _ in 0..count {
        let n = u32_at(&mut at)?;
        let name = String::from_utf8(body.get(at..at + n).ok_or_else(bad)?.to_vec()).map_err(|_| bad())?;
        at += n;
        let n = u32_at(&mut at)?;
        let data = body.get(at..at + n).ok_or_else(bad)?.to_vec();
        at += n;
        files.push((name, data));
    }
    Ok(files)
}

/// Save several files side by side (e.g. .obj + .mtl + .json): ask once for
/// the main file, the others go next to it with the same base name. The
/// request body is the raw bundle (`unpack_bundle`).
#[tauri::command]
async fn save_bundle(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<Option<String>, String> {
    let files = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => unpack_bundle(b)?,
        _ => return Err("The export arrived in the wrong form — please try again.".into()),
    };
    let Some((first_name, _)) = files.first() else { return Ok(None) };
    let Some(main) = ask_path(&app, first_name) else { return Ok(None) };
    let dir = main.parent().map(PathBuf::from).unwrap_or_default();
    let base = main.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "simflate".into());
    let orig_base = first_name.rsplit_once('.').map(|(b, _)| b.to_string()).unwrap_or_default();
    for (i, (name, data)) in files.iter().enumerate() {
        // The others keep their own ending ("-normal.png", ".mtl") after the chosen name.
        let path = if i == 0 {
            main.clone()
        } else {
            match name.strip_prefix(orig_base.as_str()) {
                Some(rest) if !orig_base.is_empty() => dir.join(format!("{base}{rest}")),
                _ => dir.join(name),
            }
        };
        // Keep cross-references (mtllib, texture maps) pointing at the renamed files.
        let text = name.ends_with(".obj") || name.ends_with(".mtl") || name.ends_with(".dae");
        let bytes = if text && base != orig_base && !orig_base.is_empty() {
            let s = String::from_utf8_lossy(data).replace(&format!(" {orig_base}"), &format!(" {base}"));
            // COLLADA names its texture as <init_from>name-colour.png</init_from>.
            s.replace(&format!(">{orig_base}-"), &format!(">{base}-")).into_bytes()
        } else {
            data.clone()
        };
        write_safely(&path, &bytes)?;
    }
    Ok(Some(main.display().to_string()))
}

/// Save a project. With a known path (plain Save) it writes straight there;
/// otherwise it asks where. Returns the path, or None if cancelled.
#[tauri::command]
async fn save_project(app: tauri::AppHandle, path: Option<String>, name: String, text: String, dir: Option<String>) -> Result<Option<String>, String> {
    let path = match path {
        Some(p) => PathBuf::from(p),
        None => {
            let mut dialog = app.dialog().file().set_file_name(&name).add_filter("Simflate project", &["simflate"]);
            if let Some(d) = dir.filter(|d| std::path::Path::new(d).is_dir()) {
                dialog = dialog.set_directory(d);
            }
            // Windows' own dialog asks before replacing an existing file.
            let picked = dialog
                .blocking_save_file()
                .and_then(|p| p.into_path().ok());
            let Some(p) = picked else { return Ok(None) };
            p
        }
    };
    write_safely(&path, text.as_bytes())?;
    Ok(Some(path.display().to_string()))
}

/// Read a text file. Older DXFs (AutoCAD before 2007, many CAM programs) are
/// in the Windows code page, not UTF-8 — a ° or Ø in them made the whole
/// import fail; those bytes are read as Windows-1252 instead.
fn read_text(path: &std::path::Path) -> std::io::Result<String> {
    let bytes = std::fs::read(path)?;
    match String::from_utf8(bytes) {
        Ok(s) => Ok(s),
        Err(e) => Ok(e.into_bytes().iter().map(|&b| cp1252(b)).collect()),
    }
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}',
        '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    if (0x80..0xa0).contains(&b) {
        HIGH[(b - 0x80) as usize]
    } else {
        b as char
    }
}

/// Ask for a project (or an outline to import) and read it.
/// Returns (path, contents), or None if cancelled.
#[tauri::command]
async fn open_file(app: tauri::AppHandle, project: bool) -> Result<Option<(String, String)>, String> {
    let mut dialog = app.dialog().file();
    dialog = if project {
        dialog.add_filter("Simflate project", &["simflate", "blownsim"]).add_filter("Outline (DXF / DWG / SVG)", &["dxf", "dwg", "svg"])
    } else {
        dialog.add_filter("Outline (DXF / DWG / SVG)", &["dxf", "dwg", "svg"])
    };
    let Some(path) = dialog.blocking_pick_file().and_then(|p| p.into_path().ok()) else { return Ok(None) };
    // A DWG comes back as the DXF it converts to; the UI reads it as a DXF.
    let text = if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("dwg")) {
        let bytes = std::fs::read(&path).map_err(|e| format!("Could not open {}: {e}", path.display()))?;
        blown_dwg::dwg_to_dxf(&bytes).map_err(|e| format!("Could not read this DWG file: {e}"))?
    } else {
        read_text(&path).map_err(|e| format!("Could not open {}: {e}", path.display()))?
    };
    Ok(Some((path.display().to_string(), text)))
}

/// A DWG dropped on the window (raw bytes) → the DXF it converts to.
#[tauri::command]
async fn dwg_to_dxf(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => blown_dwg::dwg_to_dxf(b).map_err(|e| format!("Could not read this DWG file: {e}")),
        _ => Err("The DWG arrived in the wrong form — please try again.".into()),
    }
}

/// Read a project from the Recent list. Only project files (.simflate, older .blownsim).
#[tauri::command]
async fn read_project(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("simflate") || e.eq_ignore_ascii_case("blownsim")) {
        return Err("Only Simflate projects can be opened from the Recent list.".into());
    }
    if !p.is_file() {
        return Err(format!("{} isn't there any more — it may have been moved or renamed.", p.display()));
    }
    read_text(&p).map_err(|e| format!("Could not open {}: {e}", p.display()))
}

/// Open a web page in the system browser (the info bubbles' links). https only.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") || url.contains(['"', ' ', '&', '|', '^', '<', '>']) {
        return Err("Only plain https links can be opened.".into());
    }
    #[cfg(windows)]
    let r = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(not(any(windows, target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&url).spawn();
    r.map(|_| ()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    crash::install();
    gpu::apply_choice();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(reference::RefState::default())
        .manage(native::NativeState::default())
        .setup(|app| {
            crash::set_app(app.handle().clone());
            probe::start();
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_file,
            save_bundle,
            save_project,
            open_file,
            dwg_to_dxf,
            diag::diagnostics,
            diag::diag_read,
            diag::diag_save_report,
            diag::diag_open_folder,
            read_project,
            open_url,
            clip::clipboard_read,
            clip::clipboard_write,
            fonts::list_fonts,
            fonts::text_outline,
            reference::reference_check,
            reference::reference_start,
            reference::reference_prepare,
            reference::reference_stop,
            reference::reference_retarget,
            native::native_start,
            native::native_stop,
            native::native_pause,
            native::native_raise,
            gpu::gpu_get,
            gpu::gpu_set
        ])
        .build(tauri::generate_context!())
        .expect("error while starting Simflate")
        .run(|_app, event| {
            // A Reference run doesn't outlive the app (its engines would
            // keep running and clash with the next run).
            if let tauri::RunEvent::Exit = event {
                blown_ref::stop_all();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_windows_text_still_reads() {
        let dir = std::env::temp_dir().join("simflate-read-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("old.dxf");
        // "Ø 50 °" in Windows-1252, as AutoCAD 2004 writes it.
        std::fs::write(&p, [0xd8, b' ', b'5', b'0', b' ', 0xb0, b' ', 0x80]).unwrap();
        assert_eq!(read_text(&p).unwrap(), "Ø 50 ° €");
        std::fs::write(&p, "Ø UTF-8").unwrap();
        assert_eq!(read_text(&p).unwrap(), "Ø UTF-8");
    }

    #[test]
    fn safe_write_replaces_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join("simflate-write-test");
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.simflate");
        write_safely(&p, b"first").unwrap();
        write_safely(&p, b"second").unwrap();
        assert_eq!(std::fs::read(&p).unwrap(), b"second");
        assert!(!dir.join("a.simflate.saving").exists());
        // A folder that isn't there: an error, nothing written.
        assert!(write_safely(&dir.join("missing").join("b.simflate"), b"x").is_err());
    }

    #[test]
    fn bundle_unpacks_and_rejects_damage() {
        let mut b = Vec::new();
        b.extend(2u32.to_le_bytes());
        for (name, data) in [("x.obj", &b"v 1 2 3"[..]), ("x.mtl", &b""[..])] {
            b.extend((name.len() as u32).to_le_bytes());
            b.extend(name.as_bytes());
            b.extend((data.len() as u32).to_le_bytes());
            b.extend(data);
        }
        let files = unpack_bundle(&b).unwrap();
        assert_eq!(files, vec![("x.obj".to_string(), b"v 1 2 3".to_vec()), ("x.mtl".to_string(), vec![])]);
        assert!(unpack_bundle(&b[..b.len() - 3]).is_err());
        assert!(unpack_bundle(&[]).is_err());
    }
}
