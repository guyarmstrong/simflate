//! DWG → DXF text, so the UI's DXF import (ui/src/io/importDxf.ts) reads
//! DWG files too: layers, colours, units and blocks come through as they are.
//! The reading is acadrust's (MPL-2.0, unmodified, R13–R2018+ DWG). Native
//! only: acadrust's wasm build needs wasm-bindgen's JS glue, so the browser
//! preview doesn't open DWGs.

use acadrust::{DwgReader, DxfWriter};

/// DWG bytes → ASCII DXF text.
pub fn dwg_to_dxf(dwg: &[u8]) -> Result<String, String> {
    let doc = DwgReader::from_stream(std::io::Cursor::new(dwg)).read().map_err(|e| e.to_string())?;
    let dxf = DxfWriter::new(&doc).write_to_vec().map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&dxf).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_what_is_not_a_dwg() {
        assert!(dwg_to_dxf(b"0\nSECTION\n").is_err());
        assert!(dwg_to_dxf(&[]).is_err());
    }
}
