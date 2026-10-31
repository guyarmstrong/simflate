//! Clipboard for Copy / Paste on the drawing board. Illustrator and Word each
//! put an SVG copy of what was copied on the clipboard, but in places the web
//! view can't see (Word: the "image/svg+xml" format; Illustrator: plain text,
//! measured in points). This reads them directly and says where they came
//! from, so the board can size them right.

use serde::Serialize;

#[derive(Serialize)]
pub struct ClipVector {
    /// The SVG, or plain text (BlownSim's own copies, anything else).
    pub text: String,
    /// "illustrator" (units are points), "svg" (units are 96-dpi pixels,
    /// e.g. Word, PowerPoint) or "text".
    pub source: &'static str,
}

#[cfg(windows)]
mod win {
    use super::ClipVector;
    use clipboard_win::{Clipboard, raw};

    fn named(name: &str) -> Option<u32> {
        raw::register_format(name).map(|f| f.get()).filter(|f| raw::is_format_avail(*f))
    }

    fn bytes(format: u32) -> Option<String> {
        let mut out = Vec::new();
        raw::get_vec(format, &mut out).ok()?;
        // Formats copied as C strings end in nulls.
        while out.last() == Some(&0) {
            out.pop();
        }
        String::from_utf8(out).ok()
    }

    fn text() -> Option<String> {
        let mut out = Vec::new();
        raw::get_string(&mut out).ok()?;
        String::from_utf8(out).ok()
    }

    pub fn read() -> Result<Option<ClipVector>, String> {
        let _open = Clipboard::new_attempts(10).map_err(|e| format!("The clipboard is busy ({e})"))?;
        let from_illustrator = raw::EnumFormats::new().any(|f| {
            raw::format_name_big(f).is_some_and(|n| n.starts_with("Adobe Illustrator") || n == "ADOBE AI3")
        });
        if from_illustrator {
            let svg = named("Scalable Vector Graphics").and_then(bytes).or_else(text);
            if let Some(svg) = svg.filter(|s| s.contains("<svg")) {
                return Ok(Some(ClipVector { text: svg, source: "illustrator" }));
            }
        }
        if let Some(svg) = named("image/svg+xml").and_then(bytes).filter(|s| s.contains("<svg")) {
            return Ok(Some(ClipVector { text: svg, source: "svg" }));
        }
        Ok(text().map(|t| ClipVector { text: t, source: "text" }))
    }

    /// `svg`: the text is an SVG drawing — also offered as "image/svg+xml"
    /// (Office, Inkscape); as plain text Illustrator pastes it as artwork.
    pub fn write(text: &str, svg: bool) -> Result<(), String> {
        let _open = Clipboard::new_attempts(10).map_err(|e| format!("The clipboard is busy ({e})"))?;
        raw::set_string(text).map_err(|e| format!("Could not copy ({e})"))?;
        if svg {
            if let Some(f) = raw::register_format("image/svg+xml") {
                raw::set_without_clear(f.get(), text.as_bytes()).map_err(|e| format!("Could not copy ({e})"))?;
            }
        }
        Ok(())
    }
}

/// Mac: Illustrator puts its own types (AICB, PDF) on the pasteboard, plus the
/// SVG as text when its "Include SVG code" clipboard setting is on.
#[cfg(target_os = "macos")]
mod mac {
    use super::ClipVector;
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};

    const TEXT: &str = "public.utf8-plain-text";
    const SVG: &str = "public.svg-image";

    #[allow(unused_unsafe)]
    pub fn read() -> Result<Option<ClipVector>, String> {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            let types: Vec<String> = pb.types().map(|a| a.iter().map(|t| t.to_string()).collect()).unwrap_or_default();
            let from_illustrator = types.iter().any(|t| {
                let t = t.to_lowercase();
                t.contains("illustrator") || t.contains("aicb")
            });
            let svg_data = pb
                .dataForType(&NSString::from_str(SVG))
                .and_then(|d| String::from_utf8(d.to_vec()).ok())
                .filter(|s| s.contains("<svg"));
            let text = pb.stringForType(&NSString::from_str(TEXT)).map(|s| s.to_string());
            let svg = svg_data.or_else(|| text.clone().filter(|s| s.contains("<svg")));
            match (svg, from_illustrator) {
                (Some(svg), true) => Ok(Some(ClipVector { text: svg, source: "illustrator" })),
                (Some(svg), false) => Ok(Some(ClipVector { text: svg, source: "text" })),
                (None, true) => Err("Illustrator copied without SVG: in Illustrator turn on Settings > Clipboard Handling > Include SVG Code, then copy again".into()),
                (None, false) => Ok(text.map(|t| ClipVector { text: t, source: "text" })),
            }
        }
    }

    #[allow(unused_unsafe)]
    pub fn write(text: &str, svg: bool) -> Result<(), String> {
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            if !pb.setString_forType(&NSString::from_str(text), &NSString::from_str(TEXT)) {
                return Err("Could not copy".into());
            }
            if svg {
                pb.setData_forType(Some(&NSData::with_bytes(text.as_bytes())), &NSString::from_str(SVG));
            }
        }
        Ok(())
    }
}

/// What's on the clipboard that could be pasted on the board.
#[tauri::command]
pub fn clipboard_read() -> Result<Option<ClipVector>, String> {
    #[cfg(windows)]
    return win::read();
    #[cfg(target_os = "macos")]
    return mac::read();
    #[cfg(not(any(windows, target_os = "macos")))]
    return Ok(None);
}

/// Put text on the clipboard: copied shapes, as an SVG drawing (`svg`).
#[tauri::command]
pub fn clipboard_write(text: String, svg: Option<bool>) -> Result<(), String> {
    #[cfg(windows)]
    return win::write(&text, svg.unwrap_or(false));
    #[cfg(target_os = "macos")]
    return mac::write(&text, svg.unwrap_or(false));
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (text, svg);
        Err("not available".into())
    }
}

#[cfg(all(test, target_os = "macos"))]
mod mac_tests {
    use objc2_app_kit::NSPasteboard;
    use objc2_foundation::{NSData, NSString};

    const SQUARE: &str = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>"#;

    /// Uses the real pasteboard (overwrites it):
    /// cargo test -p blownsim mac_tests -- --ignored --test-threads=1
    #[test]
    #[ignore]
    #[allow(unused_unsafe)]
    fn pasteboard_round_trips() {
        // Simflate's own copy reads back as SVG text.
        super::mac::write(SQUARE, true).unwrap();
        let c = super::mac::read().unwrap().unwrap();
        assert_eq!((c.source, c.text.as_str()), ("text", SQUARE));

        // Illustrator-style: its own type plus the SVG as text.
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            pb.setData_forType(Some(&NSData::with_bytes(b"AICB")), &NSString::from_str("com.adobe.illustrator.aicb"));
            pb.setString_forType(&NSString::from_str(SQUARE), &NSString::from_str("public.utf8-plain-text"));
        }
        let c = super::mac::read().unwrap().unwrap();
        assert_eq!((c.source, c.text.as_str()), ("illustrator", SQUARE));

        // Illustrator without its SVG setting: a hint, not a silent nothing.
        unsafe {
            let pb = NSPasteboard::generalPasteboard();
            pb.clearContents();
            pb.setData_forType(Some(&NSData::with_bytes(b"AICB")), &NSString::from_str("com.adobe.illustrator.aicb"));
        }
        assert!(super::mac::read().err().unwrap_or_default().contains("Include SVG Code"));
    }
}

#[cfg(all(test, windows))]
mod tests {
    /// Copy something in Illustrator or Word first, then:
    /// cargo test -p blownsim clip -- --ignored --nocapture
    #[test]
    #[ignore]
    fn shows_what_would_paste() {
        match super::win::read() {
            Ok(Some(c)) => println!("source={} len={}\n{}", c.source, c.text.len(), &c.text[..c.text.len().min(600)]),
            other => println!("nothing: {:?}", other.map(|_| ())),
        }
    }
}
