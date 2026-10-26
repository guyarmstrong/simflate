//! SketchUp export.
//!
//! The real writer links Trimble's SketchUp C SDK (`SketchUpAPI.dll` on
//! Windows) and calls `SUModelSaveToFileWithVersion(..., SUModelVersion_SU2020)`.
//! The SDK has to be downloaded by hand from Trimble's developer site into
//! `vendor/sketchup-sdk/`, so this crate is feature-gated: without the `sdk`
//! feature it compiles to a stub that reports the SDK is missing.

use blown_core::SheetMesh;

#[derive(Debug)]
pub enum SkpError {
    SdkMissing,
    Sdk(String),
}

impl std::fmt::Display for SkpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkpError::SdkMissing => write!(
                f,
                "SketchUp export needs Trimble's SketchUp C SDK in vendor/sketchup-sdk/ (see docs/SKETCHUP_SDK.md). Use OBJ or Collada meanwhile."
            ),
            SkpError::Sdk(e) => write!(f, "SketchUp SDK error: {e}"),
        }
    }
}

/// Write `mesh` (positions in mm) to a SketchUp 2020 .skp file.
pub fn write_skp(_path: &std::path::Path, _mesh: &SheetMesh, _pos: &[[f64; 3]]) -> Result<(), SkpError> {
    #[cfg(not(feature = "sdk"))]
    {
        Err(SkpError::SdkMissing)
    }
    #[cfg(feature = "sdk")]
    {
        Err(SkpError::Sdk("SDK binding not written yet".into()))
    }
}
