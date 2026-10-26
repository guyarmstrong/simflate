//! Which graphics chip draws the window (Windows laptops with two: the
//! built-in Intel one and a dedicated NVIDIA / AMD card). The window is drawn
//! by WebView2 in its own processes, so Windows' per-app graphics setting
//! for BlownSim doesn't reach it; instead WebView2 is started with
//! `--force_high_performance_gpu`. The choice is a small file in the app's
//! data folder, read before the window opens, so it applies from the next
//! start (the switch offers to restart now).
//! (The solvers run on the CPU either way: this only speeds up drawing, and
//! takes that load off the chip that shares power with the CPU.)

use std::path::PathBuf;

/// WebView2's own default arguments (Tauri passes these; setting the
/// variable replaces them, so they are repeated here).
const BASE_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";

fn choice_file() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("app.blownsim.v2").join("gpu-high-performance"))
}

fn high_performance() -> bool {
    choice_file().is_some_and(|f| f.is_file())
}

/// Called before the window is made.
pub fn apply_choice() {
    if cfg!(windows) && high_performance() {
        // Keep anything already asked for (e.g. a debugging port).
        let extra = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        let args = if extra.contains("--disable-features") { extra } else { format!("{BASE_ARGS} {extra}") };
        // Safety: set once at start-up, before any other thread exists.
        unsafe { std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", format!("{} --force_high_performance_gpu", args.trim())) };
    }
}

/// None when there's no choice to make (not Windows).
#[tauri::command]
pub fn gpu_get() -> Option<bool> {
    cfg!(windows).then(high_performance)
}

/// Remember the choice; it applies when the window's engine next starts
/// (now, with `restart`, or next time BlownSim opens). WebView2 picks its
/// graphics chip once, at start-up, so it can't change under a running window.
#[tauri::command]
pub fn gpu_set(app: tauri::AppHandle, high: bool, restart: bool) -> Result<(), String> {
    let f = choice_file().ok_or("No app data folder")?;
    if high {
        std::fs::create_dir_all(f.parent().unwrap()).map_err(|e| e.to_string())?;
        std::fs::write(&f, b"1").map_err(|e| e.to_string())?;
    } else if f.is_file() {
        std::fs::remove_file(&f).map_err(|e| e.to_string())?;
    }
    if restart {
        restart_app(&app);
    }
    Ok(())
}

/// Restart. In the development setup the window's code comes from a local
/// server that `npm run app` runs alongside the app, and it stops when the
/// app quits: a plain restart came back with no server (Reference then
/// failed at "Meshing", its worker's code couldn't load). So there, start
/// the usual launcher a moment after quitting instead.
fn restart_app(app: &tauri::AppHandle) {
    blown_ref::stop_all();
    #[cfg(all(windows, debug_assertions))]
    {
        use std::os::windows::process::CommandExt;
        let launcher = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("Start BlownSim v2.cmd");
        if launcher.is_file() {
            const DETACHED: u32 = 0x0000_0008; // DETACHED_PROCESS
            const NEW_GROUP: u32 = 0x0000_0200; // CREATE_NEW_PROCESS_GROUP
            let spawned = std::process::Command::new("cmd")
                .raw_arg(format!("/c timeout /t 5 /nobreak >nul & start \"BlownSim v2\" \"{}\"", launcher.display()))
                .creation_flags(DETACHED | NEW_GROUP)
                .spawn();
            if spawned.is_ok() {
                app.exit(0);
                return;
            }
        }
    }
    app.restart();
}
