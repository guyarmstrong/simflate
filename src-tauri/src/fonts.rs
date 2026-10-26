//! The Text tool's fonts: list the fonts installed on this computer and turn
//! text into outlines (blown_core::text does the work).

use std::path::PathBuf;

use blown_core::text::{font_faces, outline, FaceInfo, TextOutline};
use serde::Serialize;

#[derive(Serialize)]
pub struct FontEntry {
    #[serde(flatten)]
    face: FaceInfo,
    path: String,
}

fn font_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![];
    #[cfg(windows)]
    {
        let windir = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        dirs.push(PathBuf::from(windir).join("Fonts"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            dirs.push(PathBuf::from(local).join("Microsoft\\Windows\\Fonts"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        dirs.push("/System/Library/Fonts".into());
        dirs.push("/System/Library/Fonts/Supplemental".into());
        dirs.push("/Library/Fonts".into());
        if let Ok(home) = std::env::var("HOME") {
            dirs.push(PathBuf::from(home).join("Library/Fonts"));
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        dirs.push("/usr/share/fonts".into());
    }
    dirs
}

/// Every face of every font file in the system and user font folders.
#[tauri::command]
pub async fn list_fonts() -> Vec<FontEntry> {
    let mut out = vec![];
    for dir in font_dirs() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            let ext = path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
            if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") {
                continue;
            }
            let Ok(mut f) = std::fs::File::open(&path) else { continue };
            for face in font_faces(&mut f) {
                out.push(FontEntry { face, path: path.display().to_string() });
            }
        }
    }
    out
}

/// Outlines for `text` in the face `postscript` of the font file at `path`.
#[tauri::command]
pub async fn text_outline(path: String, postscript: String, text: String, height: f64) -> Result<TextOutline, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Could not read the font: {e}"))?;
    outline(&data, &postscript, &text, height)
}
