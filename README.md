# BlownSim

In-house desktop app for Full Blown and Studio Vertigo: draw or import a flat
outline, treat it as two stainless sheets TIG-welded along every edge, and watch
it inflate — then export a render-ready model for KeyShot and SketchUp.

**To try it, see [HOW_TO_TEST.md](HOW_TO_TEST.md).** Where things stand: [docs/HANDOFF.md](docs/HANDOFF.md) · history: [docs/BUILD_LOG.md](docs/BUILD_LOG.md) · why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md) · guide for Claude sessions: [CLAUDE.md](CLAUDE.md). The full spec is the
`Inflated Metal Simulator — Spec & Claude Code Handoff (Rev F).docx` in this folder.

## Layout

```
ui/                    the interface (React + TypeScript + Three.js)
  src/editor/          2D drawing board: primitives, dimensions, handles
  src/viewer/          3D viewport and materials (stainless, zebra, maps)
  src/sim/             solver worker (runs the Rust core as WebAssembly)
  src/io/              DXF / SVG import, OBJ / STL export
crates/
  blown-core/          meshing, XPBD solver, plates, exporters (Rust, no UI)
  blown-cli/           headless runner that saves every frame (runs/<name>/)
  blown-wasm/          blown-core compiled to WebAssembly for the live view
  blown-skp/           SketchUp .skp writer (waits for the SketchUp SDK)
src-tauri/             desktop app shell (Tauri 2): window, Save-as dialogs
docs/                  PRIOR_ART.md, SKETCHUP_SDK.md
runs/                  saved command-line runs (not in git)
```

## How it fits together

The solver is written once in Rust (`blown-core`). It runs:

- inside the app as **WebAssembly** in a background worker, streaming a frame
  to the 3D view every few dozen solver steps (live Draft), and
- natively in **blown-cli** for headless runs and tests.

All tuning constants live in `crates/blown-core/src/config.rs`.

## Commands

| Command | Does |
|---|---|
| `npm run app` | Desktop app (dev mode, rebuilds on change) |
| `npm run preview` | Same app in a browser tab (Snapshots tab also lists command-line test runs) |
| `npm run suite` | The Phase 0 test shapes → `runs/` |
| `npm test` | Rust unit tests + TypeScript type check |
| `npm run housekeeping` | End-of-session checks (tests, build, git, CI, docs, stray files) |
| `npm run build:app` | Windows installer (`target/release/bundle/`) |
| `cargo run --release -p blown-cli -- run --shape square --size 300 --pressure 70 --name x` | One headless run |

Tools needed: Node 22 (via nvm), Rust stable with the `wasm32-unknown-unknown`
target, and (Windows) Visual Studio 2022 Build Tools with C++.
