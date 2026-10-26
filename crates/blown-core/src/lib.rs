//! blown-core: everything BlownSim needs to turn a flat welded outline into an
//! inflated stainless form — meshing, the XPBD shell solver, and exporters.
//!
//! Units: the public API takes and returns millimetres. Internally the solver
//! works in a normalised space (lengths divided by the outline's equivalent
//! radius, forces divided by the sheet's yield tension) so the same tuning
//! works for a 50 mm charm and a 2 m sculpture.

pub mod config;
pub mod export;
pub mod finish;
pub mod geometric;
pub mod mesh;
pub mod outline;
pub mod reference;
pub mod rng;
pub mod settings;
pub mod shapes;
pub mod solver;
pub mod symmetry;
pub mod text;

pub use config::Tuning;
pub use mesh::{FlatMesh, SheetMesh};
pub use outline::Piece;
pub use settings::{Material, MeshQuality, PlateSettings, SimSettings};
pub use solver::{FrameInfo, Sim, Status};
