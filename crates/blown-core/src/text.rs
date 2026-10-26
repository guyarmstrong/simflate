//! Text → outlines for the Text tool: each letter becomes closed contours
//! (outer edges and holes) at a given capital-letter height in mm.
//!
//! `font_faces` reads only a font file's name and OS/2 tables (fast enough to
//! list every font on the computer); `outline` uses the whole file.

use std::io::{Read, Seek, SeekFrom};

use serde::Serialize;
use ttf_parser::{name_id, Face, GlyphId, OutlineBuilder};

/// One face (style) of an installed font.
#[derive(Debug, Clone, Serialize)]
pub struct FaceInfo {
    pub family: String,
    pub style: String,
    pub postscript: String,
    pub weight: u16,
    pub italic: bool,
}

/// Letters as closed contours in mm (Y up, baseline at 0, starting at x = 0).
#[derive(Debug, Clone, Serialize)]
pub struct TextOutline {
    pub contours: Vec<Vec<[f64; 2]>>,
    /// Characters the font has no letter for (left out).
    pub missing: String,
}

fn be16(b: &[u8], at: usize) -> u16 {
    b.get(at..at + 2).map_or(0, |s| u16::from_be_bytes([s[0], s[1]]))
}

fn be32(b: &[u8], at: usize) -> u32 {
    b.get(at..at + 4).map_or(0, |s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn read_at<R: Read + Seek>(r: &mut R, offset: u64, len: usize) -> std::io::Result<Vec<u8>> {
    r.seek(SeekFrom::Start(offset))?;
    let mut buf = vec![0; len];
    r.read_exact(&mut buf)?;
    Ok(buf)
}

/// The faces in a font file (several for a .ttc collection). Unreadable or
/// non-font files give an empty list.
pub fn font_faces<R: Read + Seek>(r: &mut R) -> Vec<FaceInfo> {
    let Ok(head) = read_at(r, 0, 12) else { return vec![] };
    let offsets: Vec<u64> = if &head[0..4] == b"ttcf" {
        let n = be32(&head, 8).min(64) as usize;
        match read_at(r, 12, n * 4) {
            Ok(b) => (0..n).map(|i| be32(&b, i * 4) as u64).collect(),
            Err(_) => return vec![],
        }
    } else {
        vec![0]
    };
    offsets.into_iter().filter_map(|o| face_info(r, o).ok().flatten()).collect()
}

fn face_info<R: Read + Seek>(r: &mut R, offset: u64) -> std::io::Result<Option<FaceInfo>> {
    let head = read_at(r, offset, 12)?;
    let tag = be32(&head, 0);
    // TrueType outlines (0x00010000 / 'true') or CFF ('OTTO').
    if tag != 0x0001_0000 && &head[0..4] != b"OTTO" && &head[0..4] != b"true" {
        return Ok(None);
    }
    let n = be16(&head, 4) as usize;
    let dir = read_at(r, offset + 12, n * 16)?;
    let mut name = None;
    let mut os2 = None;
    for i in 0..n {
        let rec = &dir[i * 16..i * 16 + 16];
        let (off, len) = (be32(rec, 8) as u64, be32(rec, 12) as usize);
        match &rec[0..4] {
            b"name" => name = Some((off, len)),
            b"OS/2" => os2 = Some((off, len)),
            _ => {}
        }
    }
    let Some((noff, nlen)) = name else { return Ok(None) };
    let nb = read_at(r, noff, nlen.min(1 << 20))?;
    let count = be16(&nb, 2) as usize;
    let strings = be16(&nb, 4) as usize;
    // Prefer Windows English names, then any Windows / Unicode name.
    let mut best: [(i32, String); 7] = Default::default();
    for i in 0..count {
        let rec = 6 + i * 12;
        let (platform, lang, id) = (be16(&nb, rec), be16(&nb, rec + 4), be16(&nb, rec + 6) as usize);
        let (len, off) = (be16(&nb, rec + 8) as usize, be16(&nb, rec + 10) as usize);
        if !matches!(id, 1 | 2 | 6) && id != 16 && id != 17 {
            continue;
        }
        let slot = match id {
            1 => 0,
            2 => 1,
            6 => 2,
            16 => 3,
            _ => 4,
        };
        let score = match (platform, lang) {
            (3, 0x409) => 3,
            (3, _) | (0, _) => 2,
            _ => 1,
        };
        if score <= best[slot].0 {
            continue;
        }
        let Some(raw) = nb.get(strings + off..strings + off + len) else { continue };
        let text = if platform == 3 || platform == 0 {
            let units: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
            String::from_utf16_lossy(&units)
        } else {
            raw.iter().map(|&c| c as char).collect()
        };
        best[slot] = (score, text);
    }
    let pick = |typo: usize, plain: usize| if best[typo].1.is_empty() { best[plain].1.clone() } else { best[typo].1.clone() };
    let family = pick(3, 0);
    if family.is_empty() || family.starts_with('.') {
        return Ok(None);
    }
    let style = pick(4, 1);
    let (mut weight, mut italic) = (400, style.to_lowercase().contains("italic") || style.to_lowercase().contains("oblique"));
    if let Some((ooff, olen)) = os2 {
        if olen >= 64 {
            let ob = read_at(r, ooff, 64)?;
            weight = be16(&ob, 4);
            italic |= be16(&ob, 62) & 1 != 0;
        }
    }
    Ok(Some(FaceInfo { family, style, postscript: best[2].1.clone(), weight, italic }))
}

/// Which face of a (possibly collection) file has this PostScript name.
fn find_face<'a>(data: &'a [u8], postscript: &str) -> Result<Face<'a>, String> {
    let count = ttf_parser::fonts_in_collection(data).unwrap_or(1);
    let mut first = None;
    for i in 0..count {
        if let Ok(face) = Face::parse(data, i) {
            let ps = face.names().into_iter().find(|n| n.name_id == name_id::POST_SCRIPT_NAME).and_then(|n| n.to_string());
            if postscript.is_empty() || ps.as_deref() == Some(postscript) {
                return Ok(face);
            }
            first.get_or_insert(i);
        }
    }
    match first {
        Some(i) => Face::parse(data, i).map_err(|e| e.to_string()),
        None => Err("Not a font this app can read.".into()),
    }
}

/// Flattens glyph curves into polylines (font units, then scaled).
struct Flatten {
    scale: f64,
    dx: f64,
    tol: f64,
    contours: Vec<Vec<[f64; 2]>>,
    cur: Vec<[f64; 2]>,
}

impl Flatten {
    fn pt(&self, x: f32, y: f32) -> [f64; 2] {
        [self.dx + x as f64 * self.scale, y as f64 * self.scale]
    }
    fn last(&self) -> [f64; 2] {
        *self.cur.last().unwrap_or(&[0.0, 0.0])
    }
    fn push(&mut self, p: [f64; 2]) {
        let l = self.last();
        if self.cur.is_empty() || (p[0] - l[0]).hypot(p[1] - l[1]) > self.tol * 0.25 {
            self.cur.push(p);
        }
    }
    /// Pieces for a curve whose control polygon is `len` long.
    fn steps(&self, len: f64) -> usize {
        ((len / self.tol).sqrt().ceil() as usize).clamp(2, 64)
    }
}

impl OutlineBuilder for Flatten {
    fn move_to(&mut self, x: f32, y: f32) {
        self.close();
        let p = self.pt(x, y);
        self.cur.push(p);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.pt(x, y);
        self.push(p);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (p0, p1, p2) = (self.last(), self.pt(x1, y1), self.pt(x, y));
        let len = (p1[0] - p0[0]).hypot(p1[1] - p0[1]) + (p2[0] - p1[0]).hypot(p2[1] - p1[1]);
        let n = self.steps(len);
        for i in 1..=n {
            let t = i as f64 / n as f64;
            let u = 1.0 - t;
            self.push([u * u * p0[0] + 2.0 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2.0 * u * t * p1[1] + t * t * p2[1]]);
        }
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (p0, p1, p2, p3) = (self.last(), self.pt(x1, y1), self.pt(x2, y2), self.pt(x, y));
        let d = |a: [f64; 2], b: [f64; 2]| (b[0] - a[0]).hypot(b[1] - a[1]);
        let n = self.steps(d(p0, p1) + d(p1, p2) + d(p2, p3));
        for i in 1..=n {
            let t = i as f64 / n as f64;
            let u = 1.0 - t;
            let (a, b, c, e) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
            self.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
        }
    }
    fn close(&mut self) {
        let mut c = std::mem::take(&mut self.cur);
        if c.len() > 1 {
            let (a, b) = (c[0], c[c.len() - 1]);
            if (a[0] - b[0]).hypot(a[1] - b[1]) <= self.tol * 0.25 {
                c.pop();
            }
        }
        if c.len() >= 3 {
            self.contours.push(c);
        }
    }
}

/// Capital-letter height in font units: the font's own figure, else the
/// height of "H", else 70 % of the em.
fn cap_units(face: &Face) -> f64 {
    if let Some(h) = face.capital_height().filter(|&h| h > 0) {
        return h as f64;
    }
    if let Some(r) = face.glyph_index('H').and_then(|g| face.glyph_bounding_box(g)) {
        if r.y_max > 0 {
            return r.y_max as f64;
        }
    }
    face.units_per_em() as f64 * 0.7
}

fn kerning(face: &Face, a: GlyphId, b: GlyphId) -> f64 {
    face.tables()
        .kern
        .and_then(|k| k.subtables.into_iter().filter(|s| s.horizontal && !s.variable).find_map(|s| s.glyphs_kerning(a, b)))
        .unwrap_or(0) as f64
}

/// Lay out one line of text in the face named `postscript` (any face of the
/// file if empty), capitals `cap_height_mm` tall.
pub fn outline(data: &[u8], postscript: &str, text: &str, cap_height_mm: f64) -> Result<TextOutline, String> {
    if !(cap_height_mm > 0.0) {
        return Err("Height must be more than 0 mm.".into());
    }
    let face = find_face(data, postscript)?;
    let scale = cap_height_mm / cap_units(&face);
    let mut fl = Flatten { scale, dx: 0.0, tol: (cap_height_mm / 1500.0).max(0.02), contours: vec![], cur: vec![] };
    let mut missing = String::new();
    let mut prev: Option<GlyphId> = None;
    let mut pen = 0.0;
    for ch in text.chars().filter(|c| !c.is_control()) {
        let Some(g) = face.glyph_index(ch) else {
            if !ch.is_whitespace() {
                missing.push(ch);
            }
            prev = None;
            pen += face.units_per_em() as f64 * 0.3;
            continue;
        };
        if let Some(p) = prev {
            pen += kerning(&face, p, g);
        }
        fl.dx = pen * scale;
        face.outline_glyph(g, &mut fl);
        fl.close();
        pen += face.glyph_hor_advance(g).unwrap_or(0) as f64;
        prev = Some(g);
    }
    Ok(TextOutline { contours: fl.contours, missing })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arial() -> Option<Vec<u8>> {
        std::fs::read("C:/Windows/Fonts/arial.ttf").ok()
    }

    #[test]
    fn letter_a_has_an_outline_and_a_hole_at_the_asked_height() {
        let Some(data) = arial() else { return }; // only on Windows machines
        let t = outline(&data, "", "A", 100.0).unwrap();
        assert_eq!(t.contours.len(), 2, "outer edge + the triangle hole");
        let top = t.contours.iter().flatten().map(|p| p[1]).fold(f64::MIN, f64::max);
        assert!((top - 100.0).abs() < 1.0, "capital A is 100 mm tall, got {top}");
        assert!(t.missing.is_empty());
    }

    #[test]
    fn lists_faces_from_the_name_table() {
        let Ok(mut f) = std::fs::File::open("C:/Windows/Fonts/arialbd.ttf") else { return };
        let faces = font_faces(&mut f);
        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].family, "Arial");
        assert!(faces[0].weight >= 600);
    }
}
