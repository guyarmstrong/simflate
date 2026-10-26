//! Engine crash reports (session 19). A panic anywhere in the desktop side
//! writes a report to the app's crash folder, tells the screen (the
//! 'native-crash' event opens its crash window; the app goes on when the
//! panic was in a background task) and, when the main thread itself is going
//! down, says so in a native message box instead of the window vanishing.

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

/// Once the app is up: crash reports also reach the screen.
pub fn set_app(app: AppHandle) {
    let _ = APP.set(app);
}

/// Where reports go: next to the app's own data (Windows), Logs (Mac).
pub fn crash_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join("app.blownsim.v2"));
    #[cfg(target_os = "macos")]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library").join("Logs").join("Simflate"));
    #[cfg(not(any(windows, target_os = "macos")))]
    let base = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".simflate"));
    base.unwrap_or_else(std::env::temp_dir).join("crash-reports")
}

pub fn install() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown error".into());
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        let thread = std::thread::current().name().unwrap_or("unnamed").to_string();
        let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let text = format!(
            "{msg}\nSimflate engine crash\nTime (Unix): {secs}\nVersion: {}\nThread: {thread}\nAt: {place}\n\n{}",
            env!("CARGO_PKG_VERSION"),
            std::backtrace::Backtrace::force_capture()
        );
        let dir = crash_dir();
        let file = dir.join(format!("simflate-crash-{secs}.txt"));
        let saved = std::fs::create_dir_all(&dir).and_then(|_| std::fs::write(&file, &text)).is_ok();
        if let Some(app) = APP.get() {
            let _ = app.emit("native-crash", &text);
        }
        if thread == "main" {
            let where_ = if saved { format!("\n\nA report was saved to:\n{}", file.display()) } else { String::new() };
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Simflate has to close")
                .set_description(format!("Simflate stopped on an error:\n{msg}\n\nYour drawing and settings are saved automatically — open Simflate again to carry on.{where_}"))
                .set_buttons(rfd::MessageButtons::Ok)
                .show();
        }
        default(info);
    }));
}
