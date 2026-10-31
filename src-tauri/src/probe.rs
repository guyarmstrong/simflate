//! File-open check (session 22). OpenCourant's starter tries to open
//! model_0000.rad … model_9999.rad twice (OpenCourant issue #67): 20,000
//! opens of files that aren't there. Free on most computers, 30–70 s where
//! an antivirus checks every open (Guy's test laptop, Trend Micro). A few
//! seconds after start-up this times such opens in an empty folder (best of
//! three rounds of 1,000: the app is still busy starting) and notes what the
//! starter's loop would cost here, so we know on any computer
//! (the client's Macs included) whether it matters, Reference installed or not.
//! One line per start in `file-open-check.txt` beside the crash reports.

use std::fs;
use std::io::Write;
use std::time::{Duration, Instant};

const TRIES: u32 = 1_000;
const ROUNDS: u32 = 3;
const STARTER_TRIES: f64 = 20_000.0;
const KEEP_LINES: usize = 30;

pub fn start() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(5));
        if let Some(line) = measure() {
            note(&line);
        }
    });
}

fn measure() -> Option<String> {
    let dir = std::env::temp_dir().join(format!("simflate-open-check-{}", std::process::id()));
    fs::create_dir_all(&dir).ok()?;
    let mut found = 0;
    let mut best = f64::MAX;
    for _ in 0..ROUNDS {
        let t = Instant::now();
        for i in 0..TRIES {
            if fs::File::open(dir.join(format!("model_{i:04}.rad"))).is_ok() {
                found += 1;
            }
        }
        best = best.min(t.elapsed().as_secs_f64());
    }
    let per_ms = best * 1000.0 / TRIES as f64;
    let _ = fs::remove_dir_all(&dir);
    let starter_s = per_ms * STARTER_TRIES / 1000.0;
    // The starter itself takes ~2–4 s; up to 5 s more goes unnoticed.
    let verdict = if starter_s < 5.0 {
        "fine"
    } else if starter_s < 15.0 {
        "noticeable"
    } else {
        "SLOW: antivirus checks each open"
    };
    let when = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    Some(format!(
        "{when} (unix s) · Simflate {} · {} · failed open {per_ms:.3} ms → OpenCourant starter loop ≈ {starter_s:.1} s · {verdict}{}",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        if found > 0 { " · (some test names existed)" } else { "" }
    ))
}

/// Appends the line, keeping the newest few.
fn note(line: &str) {
    let Some(dir) = crate::crash::crash_dir().parent().map(|p| p.to_path_buf()) else { return };
    let path = dir.join("file-open-check.txt");
    let _ = fs::create_dir_all(&dir);
    let mut lines: Vec<String> = fs::read_to_string(&path).unwrap_or_default().lines().map(String::from).collect();
    lines.push(line.to_string());
    let start = lines.len().saturating_sub(KEEP_LINES);
    if let Ok(mut f) = fs::File::create(&path) {
        let _ = writeln!(f, "{}", lines[start..].join("\n"));
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn measures_failed_opens() {
        let line = super::measure().expect("a line");
        println!("{line}");
        assert!(line.contains("starter loop ≈") && !line.contains("some test names existed"));
    }
}
