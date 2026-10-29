# Simflate (BlownSim v2) — guide for Claude Code sessions

> **This is Simflate** (was BlownSim v2; v1.00 = tag `v1.0.0`, see `docs/VERSIONS.md`) (branch
> `v2-thickness`, folder `Sheet Metal Inflation Simulator v2`, port 1430, window "Simflate",
> desktop shortcut "Simflate"). v2 replaces the Character slider with a real sheet
> **Thickness** (0.1–3 mm, both sheets the same) that is drawn in the mesh, rounds the weld
> edge (radius = thickness) and sets stiffness, plus a **Balloon ↔ Geometric** slider that
> works as temper (soft ↔ hard). v1 stays untouched in the sibling folder
> `Sheet Metal Inflation Simulator` (branch `main`, tag `v1-character`). Commit and push to
> `origin v2-thickness`, not main. **Every look experiment goes in `docs/TUNING_LOG.md`**
> (settings, numbers from `scripts/creases.py`, verdict) — read it before tuning.

Read this first, every session. Then read `docs/HANDOFF.md` (where we are now)
and the latest entry of `docs/BUILD_LOG.md`.

## The project in one paragraph

In-house desktop app for Full Blown / Studio Vertigo (Newcastle). Draw or import
a flat outline, treat it as two stainless sheets TIG-welded on every edge,
inflate it live, export render meshes for KeyShot (OBJ) and SketchUp (.skp,
pending SDK). Spec: `Inflated Metal Simulator — Spec & Claude Code Handoff (Rev F).docx`.
Accuracy is *visual* — judged against photos of real pieces, not engineering.

## Who you work with

Guy — not a developer. Work autonomously, explain in plain English, ask only
key questions. Every test you hand over must be something he can open and look
at (app window, browser tab, file). He has given standing permission to install
what's needed.

## Map

| Where | What |
|---|---|
| `crates/blown-core` | Rust: meshing (spade CDT), XPBD solver, plates, finisher, exporters. All tuning in `src/config.rs`. |
| `crates/blown-cli` | Headless runs → `runs/<name>/` (frames for playback). `--finish N` writes a smoothed copy. |
| `crates/blown-wasm` | C-style API over blown-core for the UI's solver worker. |
| `crates/blown-skp` | SketchUp writer stub (feature `sdk`), waits for SDK in `vendor/sketchup-sdk/`. |
| `src-tauri` | Desktop shell (Tauri 2): window, native Save-as. |
| `ui/src` | React + TS + Three.js. `editor/` 2D board, `viewer/` 3D + looks, `sim/` worker + live store, `library/` snapshots (IndexedDB), `ui/` panels. |
| `docs/` | `HANDOFF.md`, `BUILD_LOG.md`, `DECISIONS.md`, `PRIOR_ART.md`, `SKETCHUP_SDK.md` |
| `HOW_TO_TEST.md` | Guy's plain-English test guide — keep it current. |
| Render image (Snapshots) | `ui/src/viewer/studio.ts`, `renderStore.ts`, `customHdri.ts`, `ui/src/ui/RenderSection.tsx`, HDRIs in `ui/public/studio/`. |

## Commands

```
npm run app            desktop app (dev)          npm run preview   same app in a browser
npm test               Rust tests + type check    npm run suite     Phase 0 test shapes → runs/
npm run wasm           rebuild solver for the UI   npm run housekeeping   end-of-session checks
cargo run --release -p blown-cli -- run --shape square --size 300 --medium --finish 1 --name x
```

## Machine quirks (Guy's Windows laptop)

- Global Node is 18.8 (other projects). Use Node 22: `export PATH="/c/Users/guyke/AppData/Roaming/nvm/v22.20.0:/c/Users/guyke/.cargo/bin:$PATH"` in Bash. The `.cmd` launchers set this themselves.
- pip and winget's msstore source fail SSL → use `winget --source winget`.
- Chrome automation attaches a debugger that makes WebAssembly ~7× slower. Judge speed with `?bench` in Edge (writes `runs/bench.log`), or the CLI.
- Long multi-line edits: write a Python script to the scratchpad and run it (heredocs with quotes have broken before).

## Rules that keep this healthy

- **Physics changes are checked by eye**: run the CLI (`--finish 1`), view in the browser (Snapshots → Test runs), compare zebra + stainless. Numbers alone have misled us.
- Plasticity must stay **force-based** (λ/h²); strain-based ratchets with step size. See `DECISIONS.md`.
- Determinism: same seed → same result (there's a test). No HashMap iteration in the solver path.
- All tuning constants live in `config.rs`; add new ones to `Tuning::set` so the CLI can sweep them (`--tune name=value`).
- UI: near-black theme, Lucide icons, light linework. Keep Guy's UI requests (see `DECISIONS.md` → UI).
- Commit after each meaningful step, push to `origin v2-thickness` (v2) (private repo guyarmstrong/blownsim).
- **Builds** (Guy, session 22): Windows installers are built on this laptop (`npx tauri build --bundles nsis`). Mac builds run on the **public copy** `guyarmstrong/simflate` (free minutes): `node scripts/publish-public.mjs`, then `gh workflow run build.yml -R guyarmstrong/simflate --ref main`. Never publish history or Guy's email; gitleaks the exported files first.
- **OpenCourant check before every build** (Guy, session 22): `scripts/check-upstream.mjs` runs first in every `tauri build` and STOPS it if OpenCourant issue #67 (starter tries model_0000…9999.rad twice: 30–70 s on antivirus laptops) is closed or a newer release is out. Then: read the release, and if it fixes `fill_igr.F`, repack it (`node scripts/opencourant.mjs pack`), re-test Reference, and tell Guy. Build anyway only after looking: `SIMFLATE_UPSTREAM_CHECKED=1`.
- **Diagnostics in the app** (Guy, session 22): click / right-click the Simflate logo → About & diagnostics (version, checks, problem reports). Any new detector or debug aid goes there too.
- **Speed matters as well as accuracy** (Guy, session 8): note run time for every tuning experiment; prefer the change that gets the look at the lowest cost.
- Commit messages end with the Co-Authored-By line the session gives you.

## Session routine

**Start** (`/session-start`): read this file, `docs/HANDOFF.md`, last `BUILD_LOG` entry; `git status` + `git log -5`; check CI (`gh run list -L 3`); confirm the app builds (`npm test`). Then tell Guy in two lines where things stand and what you'll do.

**End** (`/session-end`, or when Guy says he's wrapping up / about to compact):
1. `npm run housekeeping` — tests, type check, wasm build, git state, CI, stray files. Fix anything red.
2. Append a dated entry to `docs/BUILD_LOG.md` (what was built, changed, fixed; what Guy asked for).
3. Rewrite `docs/HANDOFF.md` to the current truth (state, next steps, open questions, known issues).
4. Add any new technical decision to `docs/DECISIONS.md`; update `HOW_TO_TEST.md` if anything visible changed.
5. Commit + push; confirm CI started.
6. Update Claude's memory notes if something non-obvious was learned.
7. Tell Guy: what's done, what to try, what's next — short.
