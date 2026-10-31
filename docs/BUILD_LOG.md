# Build log

Newest first. One entry per session: what Guy asked for, what was built, what
changed underneath, and how it was checked.

---

## Session 23 — 2026-10-31 · Mac Reference port compiles; Mac icon, Mac clipboard, Height view, new defaults

**Guy asked for:** carry on with the Mac Reference port (he approved the
public fork); a Mac icon without the black tile, smaller like other Dock
icons; Illustrator copy / paste to work on the Mac (no Illustrator there to
test); whether other features need Mac end-to-end checks; Height view fixed
(only half the piece was coloured); Seam stiffness default 50 and Edge
ripples default 0 (not realistic); the nine example forms must keep working;
Intel Macs too (client has older machines); faster builds; a fresh chat.

**Mac Reference port (fork `guyarmstrong/opencourant-mac`, branch `macos`)**
- Public fork created, `macos` pushed, Actions on; workflow moved to
  `macos-15` (macos-14 images retire 2 Nov 2026; brownouts cancelled runs).
- Starter, engine, open reader and anim_to_vtk now **compile and link** on
  Apple silicon. Fixes (all `__APPLE__`-guarded or harmless elsewhere):
  off_t / fseeko / ftello for 64-bit offsets; `map<string,…>` (libc++ refuses
  const keys); superscript ² ³ as `'\xB2'` / `'\xB3'`; cpuinfo via sysctl;
  builtin-arch detection without `__unix`; `/proc` readers tolerate absence;
  no `malloc.h`; `RTLD_DEEPBIND` 0; `htobe64` via libkern; `my_real` outside
  the Python block plus all missing no-Python stubs; starter's own
  open-reader fallbacks (`HM_READER_LEGACY_INCLUDE_API`, `…_PART_API`,
  `HM_READER_NO_RBODIES_FROM_RIGID_PARTS`) forced on with `-open_reader`;
  C++ runtime chosen by `OC_CXX_LIB`; `endian_compat.h` for anim_to_vtk;
  `build_all.sh` builds starter and engine even if one fails.
- `Compiling_tools/macos/bundle_deps.sh`: copies every non-system dylib next
  to the programs, rewrites to `@executable_path`, ad-hoc signs. Runs without
  Homebrew (checked on Guy's MacBook, macOS 14.6, although everything says
  minos 15.0).
- Test run under lldb found the reader stopping with "CFG Kernel Not Loaded":
  the starter is version **2612**, the open reader only knows formats up to
  radioss2026, so no Radioss kernel loads (upstream bug: Linux open-reader
  builds fail the same way). Fix: fall back to radioss2026 when the format is
  unknown (`radiossblk.cxx`). **Build 10 (run 41213949485) with this fix was
  still running at the end of the session.**
- MacBook: Command Line Tools installed; Rust installed (user-local); conda
  g++ added. Its own builds compile but the starter can't start (conda g++
  uses libc++, GCC 16 emits `__cxa_call_terminate`): use GitHub's bundled
  programs on it instead. Homebrew .pkg downloaded to its desktop but **not
  needed** (needs macOS 15 and an admin; Guy can't update that Mac).

**Simflate**
- **Mac icon**: blue pillow cut out of its black tile, 80 % of the canvas,
  soft shadow (`scripts/make-mac-icon.py`, run on a Mac; `assets/icon-mac.*`);
  replaces `src-tauri/icons/icon.icns` only. Windows icon unchanged. Guy
  approved; final check is on the Mac.
- **Mac clipboard** (`clip.rs`, NSPasteboard via objc2-app-kit 0.3, already in
  the lockfile through Tauri): copy writes text + `public.svg-image`; paste
  reads SVG, marks it "illustrator" when Illustrator's types are present (so
  it's sized in points), and says "turn on Include SVG Code" when Illustrator
  copied without SVG. Paste message says ⌘C / ⌘V on the Mac.
- **Height view** ramps from the seam (the piece's own z = 0) to white at the
  top of each sheet. It used world z after the piece was set on the floor, so
  the top half saturated white.
- **Seam stiffness default 50**, **Edge ripples default 0**; forms saved
  without these keys keep 0 / 50 (`upgradeSettings`).
- `HOW_TO_TEST.md`: "On a Mac" checklist for a non-Mac user.

**Checked**
- Rust tests + type check (39 + 1 + dwg), `cargo check` and a pasteboard
  round-trip test (`clip::mac_tests`, ignored by default) **on the MacBook**.
- Playwright WebKit (Safari's engine) vs Chrome on the isolated preview: load,
  draw, Fast inflate, finishes, Save form, reload — identical (134.2 mm,
  11.5 %, 6 416 polys), no errors.
- All nine example forms open and "Restore shape + settings" brings back their
  own settings, in both engines (WebKit reports as a Mac, so Reference /
  Symmetric examples restore as Fast, as designed until the Mac engine ships).
- Height view and Seam 50 by eye (side + ¾ views); fresh pillow settles at
  135.4 mm (134.2 at 0).

---

## Session 22 — 2026-10-27…31 · DWG import, public Mac builds, slow starter found, diagnostics, Mac Reference port started

**Guy asked for:** DWG import; the Windows 1.1.1 installer for the work
laptop; free Mac builds without leaking his email or credentials (a new
public repo); the slow Reference start on the work laptop explained and
reported to OpenCourant; a check before every build for an OpenCourant fix;
a detector telling whether the starter's slow loop affects a computer (Mac
included); one place in the app for version, detectors and bug reports (the
logo); Tailscale for the work laptop and a Mac; **Reference must ship and
work on every Mac install**, like Windows.

**Built**
- **DWG import** (desktop): `crates/blown-dwg` (acadrust 0.6.7, MPL-2.0,
  pure Rust) turns DWG into DXF text for the existing DXF import (layers,
  colours, units, Line types). Import dialog converts in `open_file`; a
  dropped DWG goes to `dwg_to_dxf` as raw bytes. Browser preview says "save
  it as DXF" (acadrust's wasm needs wasm-bindgen glue). Tested on Guy's
  Pentagonal Nova DWGs (Cone Hub 133 × 89 mm, five holes).
- **Public copy for free Mac builds**: `guyarmstrong/simflate`, current files
  only, author = GitHub no-reply address (`scripts/publish-public.mjs`).
  History scanned with gitleaks + an email scan first: no secrets; Guy's
  gmail only in the private repo's commit authors.
- **Slow Reference start found**: OpenCourant `starter/source/model/sets/
  fill_igr.F` loops `DO I = 1, 10000` twice opening `ROOTNAME_NNNN.rad` →
  20,000 failed opens, ~1.5 ms each under Trend Micro (stack sampling on the
  work laptop). Reported: **OpenCourant/OpenCourant#67**. A binary edit (loop
  limits 10001 → 3, offsets in HANDOFF) was proven harmless (byte-identical
  models, planted file ignored) but **not shipped**: Norton holds an unknown
  edited exe ~21 s per launch. `scripts/check-upstream.mjs` now runs first in
  every `tauri build` and stops it if #67 is closed or a newer release is out.
- **File-open check** (`src-tauri/src/probe.rs`): a few seconds after start,
  best of 3 × 1,000 failed opens → the starter loop's cost here (fine < 5 s,
  noticeable < 15 s, slow above), kept in `file-open-check.txt`.
- **About & diagnostics** on the Simflate logo (click / right-click):
  version, platform, file-open check, Reference installed, OpenCourant
  release + #67, problem reports (engine panics and now screen errors) to
  read / copy, folder button, Copy summary.
- **Mac**: Reference and Symmetric shown greyed "(Windows only for now)";
  forms bringing Reference fall back to Fast; clearer message.
  `crates/blown-ref` is platform-aware (program names `prog("starter","_sp")`
  → `starter_macosa64_sp`, one engine on threads where no Intel MPI,
  DYLD_LIBRARY_PATH, pkill); compiles for aarch64-apple-darwin.
- Installers 1.1.1 (Windows + universal Mac) built on the public repo, in
  the share folder.

**Mac Reference port (in progress)**: OpenCourant has no macOS build; its
closed hm_reader has no Mac copy, but the repo's open reader (`reader/`)
does the same job. Local fork working copy `D:\Gaia\Projects\Stephen
Newby\opencourant-mac` (branch `macos` on cb760c2, one commit 7916201):
`Compiling_tools/macos/` (make_recipes.py writes the `macosa64` recipes from
`linuxa64` ones; md5.c written from RFC 1321 + test, passes all 7 RFC
vectors; build_all.sh; test model), `.github/workflows/macos_build.yml`.
Creating the public fork `guyarmstrong/opencourant-mac` was blocked by the
permission classifier — needs Guy's explicit OK at that step. Guy's MacBook
Air (M2, 8 GB, macOS 14.6, Tailscale `delaneys-macbook-air-2`, user `moe`,
SSH key `~/.ssh/simflate_mac`) has conda toolchain in `~/simflate-build/env`
(gfortran 16, clang, cmake, boost 1.92, metis, netlib lapack, openmpi) and
the OpenCourant source + extlib in `~/simflate-build/src/OpenCourant`;
Apple Command Line Tools were still downloading.

**Mistake**: stopped the vite on port 1430 that belonged to Guy's still-open
window (a second launch had failed); restarted it and Guy reloaded. Memory
note updated: check `blownsim.exe` first.

**Checked:** `npm test` (39 + 1 blown-dwg) and type check after each step;
src-tauri compiles; blown-ref compiles for aarch64-apple-darwin; DWG import
in an isolated browser test; About popup screenshots (browser + faked
desktop); starter timing kits and stack sampling on the work laptop;
original vs edited starter compared byte for byte; public builds green
(Windows + Mac).

---

## Session 21 — 2026-10-26 · Packaging 1.1, example forms, short screens, Reference start-up

**Guy asked for:** final Windows + Mac packages in a folder to share (Windows
tested by him on another laptop, Mac straight to the customer); the nine
forms from his screenshots preinstalled as examples; Recent capped at 30; on
his test laptop (wider aspect, shorter screen): tool columns that shrink, then
go two side by side, before scrolling; Contact out of the materials column,
next to the Plates eye; plates / eye / Contact hidden for solvers without
plates; no Windows Firewall questions for the Reference engine; why
Reference takes 1:15 to start there; engines recognisable in Task Manager;
the CPU / GPU switch renamed so nobody thinks it speeds up the solvers; no
money spent on GitHub (free minutes ran out).

**Built**
- **Example forms** (`ui/public/examples/forms.json`, 19.6 MB): Guy's nine
  picks, pulled from his app's IndexedDB (copied into a scratch Chrome
  profile) and project files; added to Recent once on a fresh install
  (`simflate.examplesAdded`), below everything saved, labelled "from
  Examples"; deleting one sticks. Form 1 got its board shape rebuilt from
  its outline and a polished finish. Recent keeps **30** (was 50).
- **Snapshots that no longer re-mesh to the same points** (older versions,
  project files) get their smooth mesh from their own saved mesh:
  `bs_adopt_mesh` in the wasm API + worker `adopt` message.
- **Short screens**: `ui/fitColumn.ts` measures the Draft and Inflate tool
  columns: normal → smaller icons → two columns → scroll. Inflate's two
  columns: Finish + Colour beside the drawing, Pattern / Weld / Analyse
  further left.
- **Contact** moved to a button beside the Plates eye (`ContactButton`),
  only with plates; click again returns to the finish. `usesPlates()`: plates,
  eye and Contact hidden for Specified geometric, Reference, Symmetric.
- **Graphics switch** labelled "3D display" (tooltip: the solvers always run
  on the main processor).
- **Windows installer**: perMachine (one admin prompt) + NSIS hooks
  (`src-tauri/windows/hooks.nsh`) adding inbound-block firewall rules for
  mpiexec, hydra proxies and the engine; removed on uninstall.
- **Reference prepared ahead**: `blown_ref::prepare` + desktop
  `reference_prepare` (one at a time, latest wins); the Inflate panel asks
  1.5 s after the piece / settings change while Reference / Symmetric is
  chosen. Starter output kept per model fingerprint in
  `%LOCALAPPDATA%\app.blownsim.v2\reference-prepared` (8 newest); runs copy
  it in. Deck title fixed to "Simflate". CLI `ref-run --prepare`.
- **Engine renamed** "Simflate Reference engine.exe" at unpack (same file;
  SOURCE.md says so); stop-by-name and firewall rule follow.
- Mac app ad-hoc signed (`signingIdentity: "-"`). Versions 1.1.0 → 1.1.1.
- Share folder `D:\Gaia\Projects\Stephen Newby\Simflate 1.1 installers\`:
  Windows installer (1.1.0, built locally — stale now), install notes for
  Windows and Mac, a prompt for Claude Code on the test laptop.

**Found**
- GitHub Actions free minutes used up (34 builds in October, Mac counts
  10×): tagged build v1.1.0 refused. Windows builds locally from now on;
  GitHub only for the Mac, on request.
- Test laptop (HP Omen, i9-12900H, Trend Micro Apex One, company-managed):
  the starter takes ~50 s every run (2 s here) — idle, held by the AV.
  Hence preparing ahead. IT won't add an exclusion; no code signing (cost).
- Intel MPI (2021.14) always listens on 0.0.0.0 (`-localhost`, `-iface`,
  `I_MPI_HYDRA_IFACE`, `-localroot`, port range all tested) → firewall
  prompts; its bootstrap proxy exits, so engines can't be grouped under
  Simflate in Task Manager.
- Engines use ~1 core each (not 2). Pinning (`I_MPI_PIN_DOMAIN=omp`,
  `I_MPI_PIN=0`) made no difference plugged in (75–116 s each, A/B/C × 2); a
  "2.5× faster" first result was the laptop on battery. Engines sit ~25 s
  idle after appearing (start one by one) — not looked into yet.
- Fast here: 1 thread 45 s, 6 threads 15 s (300 mm square, Final) — ~80 %
  parallel. The test laptop reported 1–1.5 cores; unexplained.

**Checked:** Rust tests + type check after every step; fresh-profile
browser test of the examples (all nine appear, each rebuilds its smooth
mesh, deleted one stays gone; screenshots of forms 5 and 8); tool columns
measured at 1000→340 px tall in both modes + screenshots; Contact / plates
toggling scripted; Reference via blown-cli: run 1 prepares + keeps, run 2
skips the starter (same heights frame by frame), background prepare 1.7 s
then the run starts at once, renamed engine runs through mpiexec. Windows
installer 1.1.0 built locally and installed by Guy on the test laptop
(examples OK; firewall prompts and slow start found there).

## Session 20 — 2026-10-26 · Bug and stability sweep, reproducible runs, outline export, Pebble / star

**Guy asked for**: the bug / stability / edge-case sweep from the handoff —
a list of suggested fixes first, nothing that changes solver results without
discussing it. Then: the start-up screen came back a few seconds after
loading; Recent projects wrapping in the File menu; D1–D3 discussed (below);
one-line warnings; sliders closer to the ⓘ icons without cutting labels;
"Clamp whilst inflating" on one line like the thickness switch; a label on
the GPU switch; on the Draft board an export of the selected pieces or
everything as DXF / SVG (DWG asked for), and Ctrl+C that pastes into
Illustrator; a Pebble / star tool from his Star Generator V4 (presets
Pebble, Starfish, Star of David), no explainer text, no scrolling. Next
session: final packaging of the first version.

**The sweep** — a scratch probe (its own crate and target folder, so Guy's
`tauri dev` was never rebuilt under him) ran ~100 awkward outlines and
settings through mesh → solve → finish: 2 mm to 10 m pieces, slivers, needle
stars, duplicate / collinear / NaN points, holes and weld lines touching,
crossing or outside the outline, 0–1000 folds, thickness 0–50, pressure
−5–1000, every solver. No panics, no NaN, no instability. Found:

- *Crash loop* (verified): a damaged project crashed the board, the autosave
  kept it, Reload crashed again for ever. Shapes are now checked wherever
  they come in (project, autosave, paste, form restore; `checkShapes`), with
  a count of any left out; the crash window has **Empty board** (keeps a copy
  of the autosave as `…autosave.v1.before-crash`).
- *Imports* (verified): compact SVG arc flags (`a40 40 0 1180 0`, SVGO /
  Illustrator) gave NaN shapes; mirrored DXF arcs / circles / polylines
  (extrusion 0,0,−1, AutoCAD MIRROR) landed on the wrong side; paper-space
  title blocks and hidden entities came in; older Windows-encoded DXFs
  failed to open on the desktop ("not valid UTF-8"). All fixed; broken
  points are never let onto the board.
- *Saving*: projects and exports write a temp file then swap (a failed save
  no longer truncates the old file); exports reach the desktop as raw bytes
  (a 55 MB OBJ as a JSON number list took ~1 GB of memory).
- *Solver worker*: a WebAssembly trap left its state locked and the next
  Inflate hung on "Meshing"; it now drops the instance and reloads it.
- *Speed*: the "crosses itself" check by sweep — 20 000 points 1.3 s → 3 ms,
  identical answers on 40 000 random cases.
- Small: autosave-full warning; limits on typed sizes (100 m), polygon
  corners (64), seeds; Reference message said "BlownSim"; plates message;
  3D view freed old weld / plate lines; Mac copy failed (now falls back).

**Discussed with Guy** — D1: all pressure raises shared one 600-frame budget
(raising to 80 / 90 / 100 after it ran out did one frame each; stuck at
~75), and a raised run kept the lower pressure's creases, which the saved
settings (final pressure only) can't reproduce. Guy chose reproducibility:
**a new pressure or target height inflates again from flat** (Fast, Steel,
Specified geometric; Reference still retargets upwards); lowering works now.
D2: narrow strips staying flat in Fast / Steel is realistic — left. D3:
Specified geometric builds any height (creative freedom) — a note
"Beyond realistic max height of N mm" (½ × narrowest width) only.

**Built / changed (visible)**
- Start-up screen once per window (sessionStorage; starts logged in
  `simflate.startLog`). Not reproducible outside the desktop window (one
  page load in Chrome, cold and warm) — likely the earlier failed start.
- File menu 320 px, Recent names one line with "…" and the path as tooltip.
- Warnings on one line, detail in tooltips ("Too narrow to show smoothly:
  min 6 mm on X fine").
- Settings label column = the longest label showing in each panel, measured
  on the page (`installLabelColumns`), 89–102 px instead of 112.
- Clamp whilst inflating on one line; **Graphics processor** label.
- **Export outline** (Draft, beside Quick export PNG): selected / all as
  DXF (R12, mm, layers OUTLINE / WELD / CONSTRUCTION, true circles) or SVG
  (mm, groups per line type). **Ctrl+C** = SVG in mm on the clipboard (text
  + image/svg+xml) carrying Simflate's own shapes; DWG: via AutoCAD.
- **Pebble / star** tool (under Polygon, key S) — wizard on pick: presets,
  preview, Points, Size, Inner %, tip / valley rounding, edges Sharp /
  Rounded / Flowing / Wavy, edge curve, Organic + New variation.

**Underneath**: `model/shapes.ts checkShapes`; `io/flatExport.ts`
(`buildSvg`, `buildDxf`, `shapesFromSvg`); `model/star.ts` (outline: V4's
edge control points lay on the chord, so edges now bow along the outward
normal; bow capped at 40 % of the corner's room and 0.6 × the gap to the
nearest edge, tilt scaled by the straight share of the side; rounded
corners are quads aimed where the edge tangents meet); DXF reader wraps
dxf-parser's handlers to keep extrusion; `src-tauri lib.rs` `read_text`
(UTF-8 or Windows-1252), `write_safely`, raw `save_bundle`; clip.rs writes
SVG formats; worker `recover()`.

**Fixed along the way**: Guy's `tauri dev` hit LNK1120 again after a desktop
rebuild — `cargo clean -p blownsim` + rebuild.

**Checked**: probe (no crashes / NaN); headless Chrome in my own profile and
vite cache: crash loop before / after, import cases, export round trips
(DXF and SVG back at exactly 345.70 × 559.86 mm, layers intact), pressure
40 → 80 → 60 each from flat, wizard presets, 960 star settings (4 cross, all
24 points / inner 5 %), panels on every solver; Rust tests for read_text /
write_safely / bundle; Guy: DXF samples, save / open, OBJ export (checked
watertight, 96 006 points, maps present). 39 Rust tests + type check.

---

## Session 19 — 2026-10-26 · Round mode, Fold over, and BlownSim becomes Simflate v1.00

**Guy asked for**: Round mode as agreed (handoff step 3) — first detection,
the tidier panel and the S-folds; then corrected the S: folds should *lie
over on themselves seen from above*, not wander sideways, and with
Randomness only some should, by different amounts and either way; a new app
icon (blue pillow, his picture); labels "Auto Shape Detection", "Clamp whilst
inflating", "Max Height Plates"; rename the app **Simflate**; checks on
packaging (install wizards, no console windows, splash, crash windows); a
start-up screen with the big icon, "Simflate" in bold white, progress and the
step running; publisher Guy Armstrong but not advertised; version tracking
with this as **Simflate v1.00**; installers built and kept ready for testing
on other machines in a later session.

**Built / changed (visible)**
- *Round mode* (Specified geometric): **Auto Shape Detection** row — Auto /
  Round / Corners (Auto's pick in its tooltip). Round: folds spread evenly
  round each closed outline, **Folds** count (round the outline; cut-outs
  and weld lines in proportion) replaces Per side / Longer sides; Corner fade
  hidden. **Fold over**: each fold's floor slides along the edge while its
  ridges stay, so one wall laps over the valley (an S across the fold);
  Randomness: about 3 in 10 not over at full, the rest by their own amount,
  up to half the other way, never past 45 % of the gap to a neighbour.
  **Min bend** (mm): no valley floor tighter than this (shallower valleys;
  new forms 4 mm, older forms 0 so they build as before).
- *Randomness cracks fixed* (any shape): each point took its tuck's random
  width / length from whichever tuck was strongest, so they jumped where one
  handed over to the next — thin dark cracks along the tucks. Now blended
  from fold to fold.
- *New app icon* (Guy's blue pillow) in every size, favicon, desktop shortcut
  (re-pointed to `icons/shortcut-v2.ico`: Windows had cached the old one).
- *Simflate*: window, top bar, installers, messages, export headers. Projects
  save as `.simflate`; `.blownsim` still opens (picker, Recent, drag-drop).
  Desktop shortcut renamed **Simflate**. The app ID `app.blownsim.v2` and
  the storage keys are unchanged (autosave, forms and snapshots live there).
- *Start-up screen*: big icon, "Simflate" in bold white over it, progress bar,
  the step ("Restoring your last project…", "Loading fonts…", "Preparing the
  3D view…"), version at the bottom; at least ~0.9 s, then fades.
- *Crash window*: screen errors (Copy report, Save report, Keep working,
  Reload; fatal ones Reload only) and engine panics (report file in
  `%APPDATA%\app.blownsim.v2\crash-reports`, event to the screen, native
  message box if the main thread is going down).
- *Version 1.0.0* = "Simflate v1.00": start-up screen, top bar tooltip, crash
  reports. Tag `v1.0.0` built the installers (draft release).
- *Installer*: publisher Guy Armstrong (only in Windows' Installed apps),
  wizard icon, per-user install (no admin), no language page.

**Underneath**
- `geometric.rs`: `RoundMode` (settings), `is_round` / `turn`; `weld_edges(…,
  round)`; count `base × len / longest loop`; `folds` table per edge
  `[centre, width, length ×, lean]` + `fold_at` (smoothstep between folds)
  feeds width, length and lean; lean = `A · tuck_w · g` added along the edge
  tangent to both the pillow and pill positions; `bend_cap` from the floor
  curvature (cos² π²/2 … Geometric V). Test `round_mode_fold_over`.
- Settings `roundMode` / `foldOver` / `minBendMm` (UI + Rust, camelCase);
  CLI `--round auto|round|corners --fold-over --min-bend-mm`.
- `SetRow`: a `\n` in the label makes a two-line label.
- `ui/index.html` splash (plain HTML, `window.__splash.step/done`),
  `main.tsx` steps; `ui/src/ui/CrashReport.tsx` (store, global handlers,
  `CrashBoundary`, `CrashWindow`); `src-tauri/src/crash.rs` (panic hook,
  `rfd` with the dialog plugin's own features — default features added 630
  lock lines).
- Version: `package.json` only; `tauri.conf.json` `"version": "../package.json"`;
  `vite.config.ts` sets `VITE_APP_VERSION` (1.00) / `VITE_APP_SEMVER`.
  Workflow: tagged builds attach installers to a draft release
  (softprops/action-gh-release, `contents: write`). `docs/VERSIONS.md`.

**Fixed along the way**
- Guy's `tauri dev` failed with "could not compile blownsim": it rebuilt
  while geometric.rs was mid-edit, then hit LNK1120. `cargo clean -p blownsim`
  + rebuild fixed it.

**Checked**: 39 Rust tests; type check; CLI renders by eye (top view and
35°) — straight, Fold over 50 / 100, Randomness 0.5 / 1 (cracks gone, mixed
lean, no slits); splash and crash window screenshotted in my own preview
(port 1499, headless Chrome); `cargo check -p blownsim`; `vite build` shows
"Simflate v1.00". Installer build: run 40248670076 (tag v1.0.0).

---

## Session 18 — 2026-10-25/26 · Rooms and gardens to render in; materials in three layers

**Guy asked for**: more HDRIs that look like real rooms and nice outdoor
places; two bugs (pits and slots with Tuck taper on a ring; a piece half
sunk in the Render floor); the studio list to reach the Render button; no
Clay; realistic, KeyShot-like finish balls; then — from the Steel Color and
patterned-sheet catalogues — coats over any finish, pressed patterns (bumpy
coloured textures Steve uses), two-tone, powder coat and candy.

**Built / changed (visible)**
- *Render*: 12 new photographed places (CC0 Poly Haven, 2k): **Rooms** —
  Bright room, Country hall, London hall, Sitting room, Cosy room, Atelier,
  Hotel room, Veranda; **Outdoors** — Courtyard garden, Formal garden, Pond
  garden, Park (overcast). Studio list grouped under headings (Studios ·
  Rooms · Outdoors · Yours) and opens down to just above the Render button.
- *Palette* (left): **Finish** — Polished, Mirror, Brushed, Bead-blast as
  rendered metal balls (Loft-lit, wearing the current colour). **Colour** —
  a 3 x 2 grid of squares over the finish: Silver (bare), PVD (stock six
  presets, named and spaced: Gold, Rose gold, Champagne, Bronze, Black,
  Graphite), Iridescent, Heat tint, **Powder** (RAL presets, Gloss, Smooth /
  Fine / Hammertone, Metallic) and **Candy** (tinted glass over the finish,
  Strength). **Pattern** — one ball opening Linen, Dots, Chequer, Dune/5WL,
  6WL, Drops, Rain, Pearl with Size, Depth, Angle, **Pressed in** (negative),
  **Polished tops** (two-tone), **Invert two-tone** and **Colour line**.
  **Weld** — a flat close-up swatch of the seam (rippled bead + heat tint;
  bare seam through PVD-type coats; painted ridge under powder / candy).
  **Analyse** — Zebra and Mesh as rendered balls; Clay removed.
- Patterns, coats and two-tone go into the KeyShot export (colour, ORM and
  normal maps).

**Fixed**
- *Pits and slots with Tuck taper* (Balloon tucks): the blurred tuck
  pattern's running sum left ~-1e-17 where there were no tucks; taper
  raised it to a power -> NaN, and `f64::min` turned NaN into the deepest
  valley. Clamped to 0-1. Test `taper_leaves_the_middle_alone`.
- *Piece half sunk in the Render floor* after double-clicking a form:
  re-opening the same form built a fresh empty geometry with the same
  frame, so the frame effect never refilled it and placement found no
  lowest point. Frame effect now also depends on `meshVersion`.
- Finish balls not following the Powder / Candy colour (missing deps).

**Underneath**
- `viewer/studio.ts`: `place()` builds an HDRI studio; `StudioDef.group`.
  Brightness by eye: Bright room 0.7, Sitting room 0.8, sunny gardens 0.8,
  overcast park 0.3. ~78 MB added to `ui/public/studio/` (`*.hdr binary`).
- `viewer/finishPreview.ts`: one offscreen renderer, R = 18 mm sphere with
  the viewer's own materials, Loft PMREM, cached by look + coat + pattern.
- `viewer/patterns.ts`: `PATTERN_GLSL` (8 height fields, `patNeg`,
  `patPolish` with `patLevel`) and `POWDER_GLSL` (fine noise, hammertone
  Voronoi), shared by the viewer shader, `io/bake.ts` and the balls. Bump is
  screen-space with the slope taken from the field itself (no tangents).
- `viewer/materials.ts`: Look = 4 finishes + analysis; `Coat` = pvd /
  iridescent / heat / powder / candy in `finishOpts` with all pattern and
  powder / candy settings (so projects, autosave, forms, exports keep them);
  `FINISH_SURFACE`; `migrateFinish` (old PVD / Iridescent / Heat looks ->
  Polished + coat; Clay -> Polished). Weld `tigMode` 2 = painted over.
- `io/bake.ts`: finish x coat params, `baseMetal`, pattern + hammertone
  slopes, painted weld ridge, tops, powder fill of fine patterns.

**Checked**: `npm test` (38 Rust + type check); my own preview (port 1499)
with puppeteer — every pattern close up on a geometric triangle, blue Drops
+ polished tops vs Goccia Blu, gold Pearl over Mirror, negative / inverted
two-tone, powder gloss red and hammertone, candy red over Polished and blue
over Brushed + Dune, the palette at 1600x900; a baked export (colour +
normal maps) with a pattern and with powder; old-save migration; CLI ring
with Guy's taper settings (`--finish 1`), zebra + stainless renders.

## Session 17 — 2026-10-25 · Specified geometric grows up; Render gets a geometry position and real shadows

**Guy asked for**: clearer tuck slider names; a Balloon ↔ Geometric tuck
shape and a smooth-edge slider; a true pill (Jo Malone balloons, his
reference photos saved to v1 `Refrence images/Jo Malone/`); tucks in mm,
small thin tucks at the weld, randomness; a finer mesh for this solver with a
warning; a Reset button; arrow keys in number boxes; the camera not
resetting on re-run; V-shaped geometric valleys, stiff corners, no zigzag at
high pull-in; tapered tuck ends; a tuck size lock; then for rendering a way
to stand the piece up (Flat / Wall / Standing → Tilt / Spin), a white-wall
gallery studio, a proper shadow, and a tidier Render panel.

**Built / changed (visible)**
- *Specified geometric → Tucks*: **Side wall** (Pillow ↔ Pill: the sheet
  rolls onto a stadium section, straight up from the weld, round a quarter
  circle onto a crowned top), **Tuck shape** (Balloon rounded and blurred
  into one another ↔ Geometric rounded V), **Tuck width / Tuck length /
  Valley depth in mm** with a 🔗 lock that scales all three, **Tuck taper**
  (narrows to a point, crisp to the tip), **Randomness** + **Random seed**,
  **Edge smooth** (wavy weld ↔ smooth arc), **Edge lift Z**; Per side up to
  40. Older forms convert their shares to mm once, on their outline.
- Mesh for this solver: **Draft / Medium / Fine / X fine** (36 000 points a
  sheet) with a yellow hint when the tucks are too narrow for the mesh.
- Corners stay stiff (no draw-in for 2·√(thickness·side) from each corner);
  no more zigzag seam along the corner bisectors.
- **Reset** (Solver header, beside ⓘ): every setting to its start, solver and
  mesh kept, Undo in the message. **↑ / ↓** in any number box (Shift ×10,
  held repeats and speeds up).
- Camera keeps your view on a re-run. Switch renamed **Material thickness
  geometry at corners**; label column wider.
- *Render tab*: **Geometry position** at the top — presets Flat / Wall /
  Standing, **Tilt** 0–90°, **Spin** (in its own plane), **Show ground (with
  shadow)**, **Softness** (greyed out without the ground). Render only: out
  of Render the piece lies flat with the usual camera; each mode keeps its
  own camera. Wall and Standing are the same place (always on the lowest
  point); the camera follows the piece's middle.
- **Gallery** studio (white gallery wall, as in the hexagon-flower photo).
- Real cast **shadow** from the studio's main light (moves with Light angle /
  height, the piece's actual shape), soft area-light filter: sharp at the
  contact, softer and paler with distance; plus a contact shadow and a soft
  ground disc in the background's colour.
- Render panel: one row per slider, Render button pinned to the bottom, no
  scroll at 1600×900 and 1920×960; Import HDRI as wide as the dropdown;
  the Background colour square sits on its own line under the switch.

**Underneath**
- `geometric.rs`: `section()` arc-length pill blended by `side_wall`;
  per-edge tuck pattern sampled and box-blurred ×3 (σ = 0.35·(1−shape)·width,
  peaks kept); `Here { tuck, wmm, win, len }`; `rand01` (splitmix) per tuck;
  weld wave fades with the tuck's own `g`, the even draw-in with (1−t)²;
  stiff-corner window; bisector band (4 rings) where the sideways shift and
  tuck depth are Jacobi-blended, dome left alone; taper = profile^(1/(1−taper·q))
  + depth held to 70 % of the length. New settings `side_wall, tuck_shape,
  edge_smooth, tuck_width_mm, tuck_length_mm, valley_depth_mm (Option),
  tuck_randomness, tuck_taper`; `MeshQuality::XFine`; CLI flags to match.
- UI: `model/tucks.ts` (legacy → mm, mesh spacing); `PositionControls.tsx`;
  store `position {tilt, spin, floor, softness}` in localStorage; Viewport3D
  puts the piece in a `piece` group, `placePiece` / `frameCamera` /
  `placeSun`; framing memory kept on the scene (a rebuilt scene frames
  itself); per-mode cameras swapped on Render on/off. Shadows: BasicShadowMap,
  a zero-intensity directional light from `keyLight()` (studio's biggest
  panel), ShadowMaterial catcher with its getShadow swapped for a PCSS
  filter (found by its depth-lookup line — the built three.js has no comments).
- `SetRow wide`, `NumField after/step`, `SliderField arrowStep/after`.

**Checked**
- 37 Rust tests, type check, wasm each step. Specified geometric by eye with
  CLI runs rendered by `render_run.py` (pills, crinkles, notches before/after,
  V valleys in zebra, taper 0/60/100, corner close-ups); a converted old form
  matches the old build to 0.001 mm.
- UI in a private preview (port 1499, puppeteer): panel rows, mesh hint,
  X fine 8.7 s in headless Chrome, Reset + Undo, arrow keys, tuck lock maths,
  Flat/Wall/Standing framing (piece centre projected at screen 0,0 through
  re-runs), Render on/off/on cameras restored exactly, shadows at three light
  settings and soft vs crisp, Render panel scroll height = visible height.

---

## Session 16 — 2026-10-25 · The two new solvers: Symmetric and Specified geometric

**Guy asked for**: continue from session 15 and build the two new solvers.

**Built / changed (visible)**
- Solver list → **Symmetric (accurate)** (desktop): Reference on one slice of
  a mirror-symmetric outline. BlownSim finds the mirror lines (triangle 3,
  square 4, leaf 2, heart / L-shape 1; a circle is solved as a quarter),
  meshes one slice, copies it round, and OpenCourant solves the slice alone
  with mirror planes; frames are unfolded to the whole piece. Every corner
  and edge comes out the same. **Waves per edge** slider (0 = off) seeds a
  small regular ripple on every edge before pumping.
- Solver list → **Specified geometric**: the form is built, not solved —
  a dome (Balloon ↔ Geometric = smooth pillow ↔ sharp ridges from the
  corners), edges drawn in between corners to feed it, **Tucks per edge** and
  **Tuck depth**. Instant (25 frames), live on every slider, works in the
  browser too.
- CLI: `run --symmetric`, `--mesh-only`, `--geometric --waves N --wave-depth d`;
  `ref-run --waves N`.

**Underneath**
- `symmetry.rs`: `detect` (rotation test on the outline, mirror-axis sweep +
  golden refine, tolerance 0.5 % of size), `wedge_outline` (half-plane clips,
  points within 0.1 % of a mirror line snapped onto it), `mesh_symmetric`,
  `outline_ring`, `Fold` (exact re-detection from the mesh's own points —
  outline AND interior — wedge cut, `unfold`).
- `reference::deck`: `mirrors` → `*DEFINE_COORDINATE_SYSTEM` (x = plane
  normal) + `*BOUNDARY_SPC_NODE` dofx/dofry/dofrz; centre held in x, y and
  all rotations; `z_seed`; `edge_waves`, `edge_wave_mm` (2t, ≥ 0.3 mm).
- `blown-ref`: `Job.symmetric`, `waves_per_edge`; water ÷ 2n; models under
  2500 points run on one engine copy × 2 threads.
- `geometric.rs` + `Sim.geo` (eases into the form, rebuilds on raise).

**Checked**
- 300 mm square, 0.8 mm, to 60 mm, same symmetric mesh solved whole vs 1/8
  slice: 61.5 vs 61.4 mm, 0.926 vs 0.923 bar, nodes 0.13 mm mean apart
  (95 % 0.51); the slice is exactly symmetric, the whole run 0.17 mm off.
  Slice water ×8 = unfolded volume (2.226 vs 2.228 L) — the open bag's
  volume is right with planes through the origin. OpenCourant reads the skew
  frames (1 warning: non-closed surface).
- Slice timing: 4×2 1.6 min, 1×4 1.5, 1×2 1.2, 1×1 0.8 (engine compute
  11.5 s of it). Guy's 800 mm triangle, 0.19 mm, slider 77, 1/6 slice:
  2.3 min (old whole-piece run 27 min on older settings), one even central
  tuck per edge. With 3 seeded waves: same result — the seed (0.4 mm) doesn't
  override the one-tuck mode at this pressure.
- Geometric square + triangle in the browser preview (own server, port
  1499, closed after): settled, sliders shown. 37 Rust tests, type check, wasm.
**Later in the session (Guy's feedback + photos)**: the Symmetric mesh had
breaks along the mirror lines; study his reference photos (hexagon of
triangles, triangle close-up, square, teabags, square pyramid, stacked
pillows) for the Specified geometric tucks; the Inflate panel must fit a
full-screen desktop with no scrolling. Sizes: triangles ~450 mm a side,
square ~350 mm (but should work at other sizes).
- **Symmetric mesh fix**: mirror lines were meshed as welds (weld rows +
  gap → a strip of odd triangles with long straight lines the sheet folded
  along). Now `triangulate_cut`: cut lines are edges, not welds; the lattice
  runs up to them, lined up through the centre; points on each line sit at
  the lattice's own step (`cut_step`: 1 spacing along row directions, √3
  across). Rectangle and triangle: seamless; the square's 45° line can't
  match a triangular lattice (small irregular spots only).
- **Tucks, rebuilt from the photos**: smooth rounded valleys (cos² across)
  that open at the weld and close inwards (the rise from the weld is
  delayed, not the height scaled — scaling made pits); count on a 300 mm
  side and **Longer sides** (−1…1: how the count follows side length);
  **Width** (1 = they run on into one another); **Length**; **Depth**;
  **Corner fade** (sin(πx)^(3·fade): shallow-deep-deep-shallow); **Edge
  pull-in**; **Edge lift**. 450 mm triangle, 4 per side, fade 0.8: four
  valleys per side, middle two deepest (zebra).
- **Inflate panel**: one row per setting (label + ⓘ hover description +
  slider + number), presets on one line, sections Inflate by / Tucks /
  Smooth mesh / Workshop / More (closed); Workshop and More hidden for
  Reference, Symmetric and Specified geometric. Solver note moved into the
  ⓘ bubble. Measured at 1920 × 960: no scroll for Fast, Steel, Symmetric,
  Specified geometric (was 1065 px of content in 912).

**Then (Guy's screenshots)**: Specified geometric made spikes at triangle
corners and craters at rectangle ends — one tuck per side was as wide as the
side, its valley flattened the dome and the height correction stretched what
was left. Valleys now capped (reach ≤ 0.8 × inscribed radius, depth ≤ a
third of the rise) and the height set on the dome before the tucks.
Symmetric now takes weld lines (clipped into the slice; a weld on a mirror
line becomes a welded mirror edge) and cut-outs (round the centre, or inside
a slice); if the welds are less symmetric than the outline it uses fewer
mirror lines. Flower hexagon (`hexstar`, 900 mm across = 450 mm triangles,
0.8 mm, slider 80) as a 1/12 slice: 3.0 min, six identical cells
(`ref-sym-flower`). Geometric flower (`geo-flower~smooth`): six domed cells,
lens valleys and tucks along the radial welds. GPU switch moved to the 3D
view bar, left of Smooth.

**End of session**: Guy's app failed to start — "LNK1120 unresolved
externals" (a half-written build of the desktop crate) and then "Port 1430
already in use" (the failed start's vite). Fixed with `cargo clean -p
blownsim` + rebuild, and stopping that one vite. Experiment runs cleared;
kept `ref-sym-flower`, `ref-sym-tri(-w3)`, `ref-sym-sq`, `geo-flower`,
`geo-tri450`, the sym mesh runs and the earlier baselines.

- Engine start-up: ~10 s before the first cycle when launched as the app does
  (cause not found; my "Norton" guess was wrong — the bare launches I timed
  were stuck on a missing-DLL dialog because I ran the engine without its PATH).

---

## Session 15 — 2026-10-25 · Clean thickness edge, rounded tips, even TIG pulses

**Guy asked for**: pick up from session 14 (Symmetric and the other new
solver); the thickness at the tips works but the mesh looks jagged where
the cut edge meets the sheet (screenshots); the weld pattern should have
evenly spaced TIG pulses, colours unchanged; a switch for whether the
thickness shows at the edges; the weld fillet should go all the way to the
tip when thickness is on. Then close the session; the two new solvers get
the next one (not started this session).

**Built / changed (visible)**
- Thickness edge no longer jagged: the sawtooth lip along the cut edge is
  gone (the edge is a clean, even band in the Mesh look).
- Tips: the cut edge is rounded (a half-round nose) where the sheets lie
  flat, so the rounded weld carries right round the point. It stands up
  to one sheet thickness proud of the outline there.
- Inflate → Thickness → **Show at the edges** switch (on by default; off =
  thin sheets meeting at a sharp edge). Look only, re-smooths, exports
  follow it. Older projects open with it on.
- TIG pulses evenly spaced (1.6 mm) all the way round, the same crescent
  everywhere, no half pulse where a loop closes, and they fade when zoomed
  far out instead of turning into uneven stripes. Same in baked export maps.

**Underneath**
- `finish.rs` `thicken(t, band)`: Dijkstra distance from the seam; push
  direction = smoothstep blend of ±z → sheet normal across the band;
  per-seam-point horizontal outward (from the seam edges, away from the
  top sheet) and nose radius t · flatness (top / bottom normals' z); rings
  of 6 steps round the nose replace the 2-triangle strip.
- `bs_finish(..., show_thickness)`; worker / simStore / library / App pass
  `thick`; `InflateSettings.showThickness`.
- `tigBand.ts`: `TIG_PITCH`, per-loop `fit` stretch; `materials.ts` and
  `bake.ts` use it.
- `Viewport3D`: `window.__view3d` in dev builds.

**Checked**
- 300 mm triangle, 1.5 mm, fillet 2 (CLI `--finish 1`): triangles folded
  back on a neighbour 3763 → 127 (blend) → 117 (with the nose); the rest
  sit within 15 mm of the corners, inside the solve's own tip pucker.
- Headless Chrome (own profile, Guy's dev server) on Test runs: Mesh and
  Polished close-ups of edge and tip, before / after; a live inflate in the
  browser for the weld pulses with Welds on. The Show-at-the-edges switch
  off was not screenshotted (the headless run timed out first).
- 32 Rust tests, type check, wasm, housekeeping.

## Session 14 — 2026-10-24/25 · Reference faster, SketchUp DAE, small windows, Reference crash fixes, real sheet thickness

**Guy asked for**: carry on from session 13 — Fast and Steel now feel quick,
Reference still slow; COLLADA (.dae) export with a tick box to package
textures on formats that carry them; a polygon check / reduce for SketchUp;
the UI to work in half-screen and small windows; the installer to get the
fast Reference engine; Steel faster only where the result can't change
(2a); then fix three Reference errors in a row ("stopped early",
"unresolved externals" build error, "could not read the model") and make
sure it really runs before handing back; thickness typable down to 0.01 mm;
the flat tips to show real sheet thickness; a Symmetric solver (Reference
engine on 1/6 of a triangle, mirrored) and later a "Specified geometric"
(designed waves) solver, both as new entries in the solver list.

**Built / changed (visible)**
- Reference: Guy's small leaf to 80 mm 3.3 → about 1.8–2.0 min (pumping
  1.5× faster, plus the single-precision engine, ~12 % on a quiet A/B).
- Installer ships the fast Reference engine (single precision, multi-copy)
  in place of the standard one (+3 MB).
- Export → **SketchUp (COLLADA)** `.dae`: mm, Z up, one closed piece, a
  material per part (Sheet top / bottom / TIG weld), baked colour map when
  packaged. Over 150k triangles it asks: reduce to ~100k, or export all.
  Guy opened it in SketchUp 2022: fine.
- **Package textures** tick box (Export tab and File menu, remembered):
  GLB, OBJ and DAE with or without the baked maps (off = plain materials,
  no baking).
- Small / half-screen windows: the right panel never gets pushed off; top
  bar drops the word mark, shortens the project name, goes icon-only;
  bottom bar drops readouts (Volume first … Frame and Height stay); panel
  narrower; tool columns tighter on short windows. Checked 1700 → 800 px.
- Reference errors fixed: (1) "OpenCourant stopped early" — the GPU
  "Restart now" restarted the app mid-run, the old engines kept going and
  clashed with the next run in the same folder; (2) "could not read the
  model" — the app handed OpenCourant its folder as `\\?\D:\…`, which the
  starter can't read (hidden until a clean rebuild made the app use its own
  bundled copy; installs would have hit it). The build error came from me
  stopping a dev session mid-build (cleaned and rebuilt).
- Thickness can be typed down to 0.01 mm (slider stays 0.1–3).
- Real sheet thickness on the smooth mesh and in GLB / OBJ / DAE / STL:
  flat tips show two sheets and a cut edge 2t high instead of a knife edge.
  In the desktop app this only appeared after a second fix (below).

**Underneath**
- `reference::plan`: pumping time ×2/3 (KE/IE 2.5–3.5 %, was 1–1.5 %).
  `blown-ref`: `_sp` starter / engines when present (`BLOWN_REF_SP=0` off);
  one copy can run through the MPI engine; `usable()` instead of requiring
  `engine_win64.exe`; `plain_path()` strips `\\?\`; `stop_all()` kills every
  engine variant, mpiexec and the hydra proxies.
- `scripts/opencourant.mjs` KEEP: `starter_win64_sp.exe` +
  `engine_win64_impi_sp.exe` (pack re-made, 2 pieces).
- src-tauri: `reference_start` joins the previous run's thread, then
  `stop_all()`, then clears folders — inside the run thread, so the window
  never blocks; folders `run-<pid>-<job>`; `RunEvent::Exit` and
  `restart_app` call `stop_all()`; `save_bundle` renames the DAE's texture
  reference too.
- UI: `io/dae.ts`, `io/reduce.ts` (meshoptimizer 1.3.0
  `simplifyWithAttributes`, UV + normal weights), `partsOf` shared with the
  GLB; GLB / OBJ have plain-material paths. Layout: `.app` column
  `minmax(0, 1fr)` (Chrome sized the grid to 2× the widest top-bar group),
  container queries on the bottom bar.
- Finisher step 6 `thicken(t)`; `FinishParams::thickness_mm` from
  `finish_params`. The worker gets a quiet `prepare` (same pieces +
  settings) when Fast / Steel run natively — before, its finisher smoothed
  with the last worker run's settings (stale thickness).
- Steel 2a tried and **reverted**: PARDISO (MKL in OpenCourant's runtime,
  `mkl_pds_lp64_pardiso` from `mkl_intel_thread.2.dll` after
  `mkl_pds_lp64_pardisoinit`) factors the leaf's Final matrix in 66 ms vs
  faer's 551; METIS ordering in faer 294 ms. My own geometric nested
  dissection only cut fill 11 % (METIS 30 %) → no gain (quiet A/B 66–77 s
  both).

**Checked**
- Reference speed A/B on a quiet machine; shapes compared by node distance
  (single vs double precision 0.01 mm mean; faster pump 0.48 mm mean).
  Side-by-side renders misled me — compare numbers / pixels.
- DAE parsed back independently, closed (every edge twice), reduced 16k →
  5k in 27 ms and still closed; Guy: SketchUp imports the full one fine.
- Desktop app driven over CDP: Reference to the target, mid-run mesh
  changes hand over cleanly, closing mid-run leaves no engines; 3 mm
  triangle on native Fast: smooth tip −3.6 / +2.5 mm.
- Headless screenshots at 1700 / 1280 / 960 / 800 px; 32 Rust tests +
  blown-ref path test.

## Session 13 — 2026-10-24 · Torn meshes on Illustrator splines, early settling, player timeline, faster solvers, GPU switch, Illustrator paste scale

**Guy asked for** (testing `Atrium leaves.blownsim`, 13 forms of the leaf
DXFs): why a dropped DXF and the same leaf pasted from Illustrator come in
at different sizes; forms 1, 6 and 9 had broken, spiky meshes and some runs
ended early; many runs settled after a few frames, short of the target, on
all three solvers; after editing a shape in Draft the old piece stayed in
Inflate under the new outline (until Ctrl+R); the orange dashed outline got
huge dashes after rescaling. UI: frame back / forward, explain Play, show
load progress on the timeline for every solver, Mesh (Draft / Medium /
Final) directly under the solver and compact. Then: why the Intel chip
does the work when he has an NVIDIA card — a switch for it (in the top bar,
KeyShot-style Built-in | GPU, greyed on Mac; live switching **wanted
later**); make Reference and Steel faster without losing accuracy (coarse-
mesh-first ruled out: the mesh switch covers that); Polygons in the bottom
bar (far right); a close button on messages; an Illustrator paste switch.

**Built / changed (visible)**
- Imported / pasted curves no longer tear: Form 1 (Fast) used to jitter
  forever and spike on the right edge; now settles in 43 s, clean. Form 9
  (XL, Steel, Final) inflates to 159 mm cleanly. Reference on the leaf now
  runs to the target (it blew up at frame 2).
- Target-height runs keep pumping until they reach the target or full
  pressure (form 13: 54 → 121 mm). A hint says when a target can't be
  reached ("this outline can't rise to 183 mm … stretch limit").
- Back from Draft with a changed shape: Fast / Steel re-inflate at once,
  Reference clears and waits for Inflate.
- Dashed outline sized by the piece (it used its distance from the origin).
- Bottom bar = a player: first / back / replay / forward / newest, ← → keys,
  the track fills as the run goes ("Inflating 62 %", "Reference 40 %") for
  all solvers; Play replays, it no longer pauses the solver. Polygons (mesh
  triangles, both sheets) at the far right.
- Mesh Draft | Medium | Final is one row under Solver.
- Top bar: **Built-in | GPU** (Windows; greyed on Mac). Saves the choice;
  "Restart now" or it applies next start. Checked: draws on the RTX 3070 Ti.
- Edit → **Illustrator pastes: real size | DXF mm (×2.83)**, remembered,
  also switchable from each paste's message (resizes that paste).
- Messages have a close ×.
- Speed (desktop app): Fast ~1.9× (6 cores), Steel 1.3× (identical
  result), Reference engine ~2× (4 copies × 2 threads), the leaf to 80 mm
  4.5 → 3.3 min. The 3D view only redraws when something changes.

**Underneath**
- Mesher: `outline::resample` respaces every weld to the mesh spacing
  (holds corners > 30°, line ends, weld junctions; extra point where a chord
  would cut > 0.1 × spacing off the curve). Illustrator splines came in as
  2604 steps of 0.02 mm → needle triangles (0.017 mm edges beside 1 mm).
- Height mode: not settled while the controller is still raising pressure.
- `solver/par.rs`: constraints greedily coloured (no shared point per
  batch, tiny colours to an in-order spill batch) and stably reordered;
  `parallel` feature: a fixed rayon team broadcasts once per pass, chunks of
  64, spin barrier between batches. Bit-identical on any thread count and
  in WebAssembly. 6 threads default (BLOWN_THREADS). Corner links are
  coloured too (first attempt coloured before they were added).
- Steel: assembly in colour batches + per-item energies summed in order —
  bit-identical to the old code. faer's own threads: +7 % at 6, half speed
  at 20 → left off. Profile: assemble 21 %, factor 32 %, solve 34 %.
- `src-tauri/native.rs`: Fast / Steel run natively, mesh + frames as raw
  bytes over a Channel; finisher stays in the worker; falls back to the
  worker. `gpu.rs`: WebView2 started with `--force_high_performance_gpu`
  (file in %APPDATA%\app.blownsim.v2), keeps other args; in debug builds
  "Restart now" relaunches `Start BlownSim v2.cmd` (a plain restart lost the
  dev server → worker code missing → Reference "Solver crashed").
- `blown-ref`: starter -np 4, `mpiexec -localonly -n 4 engine_win64_impi
  -nt 2`; stop kills all copies by name (ranks aren't mpiexec's children).
- CLI: `--steel`, `--seam`, prints solver ms/frame.

**Checked**
- Guy's own outlines (forms 1, 9, 13, 6) through the CLI; edge-length and
  stretch analysis per frame; zebra/chrome renders.
- Desktop app over a WebView2 debugging port: NVIDIA drawing, worker
  meshes, Reference past Meshing in GPU mode. Native byte layout checked by
  a Rust test + the window's reader in Node.
- Illustrator (COM): its clipboard is the same with rulers in pt or mm;
  DXFs open 2.83× small even at "1 mm = 1 unit"; ratio 2.8346 gives real
  size (pref left at that; Guy reset it by opening via the dialog).
- Reference 1×12 vs 4×2: same height, mean 0.39 mm, folds shift slightly;
  single-copy runs bit-identical. 31 Rust tests + type check.

---

## Session 12 — 2026-10-23 · Pen, Shape builder, paste from Illustrator / Word, Recent projects, Quick export PNG, PVD variation

**Guy asked for:** two more Draft tools — a **pen** to draw any shape, and
an Illustrator-style **shape builder** whose result becomes a fixed outline
like an imported DXF (only width, length, rotate and scale). Basic file
buttons top left (**quick Save**, anything else useful). The lock symbol
off the empty board (only on a selected shape). The top-right Export
button to become **Quick export PNG**: whatever the viewport shows, in
Draft, Inflate or Forms, as an HD PNG. The Render tab's background colour
as a **small swatch** that opens the palette and closes on a pick (the
palette was huge and stayed open). **PVD** variation needs **scale and
position** sliders. **Paste** shapes copied in **Illustrator** or **Word**
straight onto the board (Ctrl+C there, Ctrl+V here). **Recent projects**
in File, suggested like other programs. The palette **reordered**: Import
and Fit on top, then weld line, pen, circle, ellipse, egg, shapes from
fewest corners to most, polygon last, text and shape builder at the bottom.
A **desktop shortcut** to open the app. Asked what SketchUp export exists
(none yet without the SDK) — **COLLADA (.dae) next session**.

**Built / changed (visible)**
- **Pen** (N): *Points* — click = corner, drag = curve (Alt bends one
  side), click the first point = closed outline, Enter / click the last
  point = open weld line, Backspace = undo a point, Shift = 15°, snaps like
  weld lines. *Freehand* — draw; ending near the start closes it, smoothed.
- **Shape builder** (Shift+M): selected outlines (or all) cut into regions;
  hover lights one up; click / drag across = merge, Alt = delete (red).
  Leftover regions become separate pieces (Illustrator behaviour). Result:
  **Built shape**, a fixed outline (kind `path`, like an import).
- Top left: **New / Open / Save** buttons (Save orange when unsaved).
  Edit menu: **Cut / Copy / Paste**. File: **Recent projects** (last 6,
  with when) + Clear; the full exports (KeyShot, OBJ, STEP, STL) moved to
  the bottom of File (also Forms → Export).
- Top right: **Quick export PNG** — 3840 px on the long side; Draft board
  (SVG with styles inlined) or the 3D view drawn at that size.
- **Paste** (Ctrl+V) from Illustrator, Word or BlownSim itself, in the
  middle of the view at real size; several colours/layers → the Line types
  window. Ctrl+C / Ctrl+X copy BlownSim shapes.
- Empty Draft board lists **recent projects** (click to open).
- Render background: small **colour swatch**, compact popover, closes on a
  pick (square released, preset, hex + Enter) or a click elsewhere.
- **PVD**: Variation (even → strong), Variation size, Position across / up.
  The film now shows with Welds on or off (before: only with Welds on).
- Palette reordered as asked; **Select** sits with Import and Fit on top.
- No chain-link lock in the top bar when nothing is selected.
- Desktop shortcut **BlownSim v2** (runs `Start BlownSim v2.cmd`, app icon).

**Underneath**
- `model/pen.ts` (anchors with Bézier handles, flattening, Douglas–Peucker
  + Catmull-Rom freehand smoothing); shape kind `pen`.
- `model/builder.ts` with **polygon-clipping 0.15.7** (new npm dependency):
  regions built incrementally (intersect / difference per shape), slivers
  dropped, merges by union.
- `src-tauri/src/clip.rs` (new Rust dependency **clipboard-win 5.4**,
  Windows only): `clipboard_read` / `clipboard_write`. Word puts
  `image/svg+xml` (96-dpi px) on the clipboard; Illustrator puts its SVG as
  plain text in **points** with no width/height (recognised by its
  "Adobe Illustrator …" / "ADOBE AI3" formats) → given an explicit size in
  pt. BlownSim's own copies are marked text (`BlownSim shapes v1`).
- `read_project` command (Recent list; .blownsim only). `io/recent.ts`:
  paths on desktop, a copy of the project in the browser version.
- `ui/quickPng.ts`; `quickShot` hook in `Viewport3D`; `board.centre` hook
  in `Editor2D` for pasting.
- `FinishOpts` gains `pvdSize / pvdX / pvdY / pvdAmount` (older files and
  forms fill in the defaults).

**Checked:** type check + 29 Rust tests; headless Chrome walkthroughs of
the pen (points and freehand, incl. a loop ending on its start — fixed a
crash there), shape builder (two rectangles → regions → merge), Quick PNG
from Draft and Inflate (3840 px files), the colour swatch closing on a
pick, Recent projects reopening a saved project, own copy/paste. Real
clipboard: copied a shape in **Word** and in **Illustrator** by automation
and read it with the Rust code (ignored test `clip::tests`) — both sized
**70.6 × 42.3 mm** for a 200 × 120 pt shape. Not checked by Claude: Ctrl+V
inside the desktop window itself, the desktop Recent list, the PVD sliders
on an inflated piece (Guy checks those).

**Lesson:** stopping a background `npx vite` leaves node holding port 1430,
so Guy's app couldn't start until it was killed.

---

## Session 11 — 2026-10-23 · Draft / Inflate / Forms, new shapes, textured KeyShot + STEP export, Reference solver in the installer

**Guy asked for:** rename the modes **Draft / Inflate / Forms** (snapshots
are forms; the button reads **Save form**, camera kept; the Forms switch
icon an obvious blown 3D shape). New Draft shapes: **diamond**, **unequal
triangle**, **pill**, **text** (the A icon; a wizard: a few letters, a
warning that more letters mean long runs, a font from the computer, bold,
height in mm; scale by height on the board) and an **egg / ant's body**
shape with a simple wizard. Equal triangles keep width/length; unequal
triangles: **every side and every angle set individually, also after
drawing**. Pill: full outside width, height and radius independently.
Circle: one diameter dimension (not like an ellipse). Tools stay **one
column**. Import/export icons were back to front. **Forms | Render |
Export** as side-by-side tabs (KeyShot style). Export a model **with
textures that opens in KeyShot with similar materials**, and **STEP**.
The **Reference solver must install with the program** — from the copy
we have, never fetched later. Aspect lock as Adobe's **chain link** (two
diagonal links, broken when unlinked), bigger on the canvas, just off the
shape's bottom-right corner with a small gap, and kept in the top bar.

**Built / changed (visible)**
- Top switch **Draft / Inflate / Forms**; Forms icon = a blown square
  (edges drawn in, pinched corners, highlight). "Snapshot" wording → form
  everywhere; **Save form** (camera) button; PNG export renamed PNG image.
- Tools (one column): Select, Weld line, Rectangle, Circle, Ellipse,
  Polygon, **Triangle (R)**, **Diamond (D)**, **Pill (O)**, **Egg (G)**,
  **Text (T)**. R no longer selects the rectangle (M does).
- **Triangle**: Equal sides | Unequal switch (top bar and size box).
  Unequal: AB, BC, CA and ∠A, ∠B, ∠C in the size box (lettered preview)
  and in the top bar when selected; lettered labels on the board (click to
  type). Angle = hinge (both sides at that corner keep their length);
  length = far corner slides along the side; side AB keeps its direction.
- **Diamond** (w × h). **Pill**: W, H and R; corners stay truly round when
  stretched (radius kept in real mm); R label with a leader on the board.
- **Circle**: single Ø dimension; circles and text only scale evenly.
- **Egg / body wizard**: Egg / Peanut / Ant presets, up to four parts
  (length, width, fat-end slider), waist width, live preview.
- **Text wizard**: letters, font family from the computer, Bold (off when
  the font has none), capital height in mm, live outline preview, warning
  for more than one letter; on the board a **Height** box (capitals).
- **Chain link** (Link / Unlink icons) in the top bar and on the board.
- **Forms | Render | Export** tabs; Render tab switches the studio on.
  Import icons = arrow in, Export = arrow out.
- **Exports**: **KeyShot (textured)** `.glb` (real size, metres, Y up;
  parts Sheet top / Sheet bottom / TIG weld; finish + weld baked into
  colour, roughness-metal-occlusion and normal maps, 2K or 4K);
  **OBJ for KeyShot** now with the same maps as PNGs; **STEP for CAD**
  (closed faceted solid, mm, from the solver mesh).
- **Reference solver installs with BlownSim (Windows)**; info bubble says
  so.

**Built underneath**
- `blown_core::text`: font face listing from the name/OS-2 tables only
  (fast over ~600 system fonts) and text outlines (ttf-parser, kerning,
  curves flattened to ~height/1500); Tauri `list_fonts`, `text_outline`;
  wasm `bs_text_outline` + `queryLocalFonts` for the browser preview.
- Shape kinds `triangle`, `scalene` (corners), `diamond`, `pill`,
  `body` (parts), `text` (contours + font info); `model/body.ts`
  (egg profile with a shifted widest point, parts blended with a smooth
  max and Gaussian waists), `model/triangle.ts`.
- `io/bake.ts`: UV-space baking of the viewer's weld/finish recipe (bead
  height normals from exact one-texel offsets of the interpolated weld
  distances; 8-texel edge dilation); `io/keyshot.ts` (GLTFExporter with
  tangents); `io/step.ts` (AP214 faceted_brep: FACE_SURFACE on PLANE with
  POLY_LOOP per triangle); `ui/exports.ts` shared by menu and tab.
- Desktop `save_bundle` keeps each file's own suffix (several PNGs) and
  fixes references in .obj/.mtl when renamed.
- `scripts/opencourant.mjs pack | unpack`; `vendor/opencourant/` (2
  pieces, manifest of SHA-256 per piece and per file, LICENSE.md AGPL
  text, SOURCE.md); `src-tauri/tauri.windows.conf.json` (unpack before
  build, resources → `opencourant/`); app looks in its resource folder
  first (`blown_ref::install_dir_with`).
- Housekeeping: studio HDRIs and solver pieces are allowed large files.

**Reference runs finished (not yet compared):** `ref-tri-imp05` (Guy's
triangle, 0.5 mm unevenness, 37 frames) and `ref-leafm-imp05` (leaf to
80 mm, 11 min; **peak plastic strain 180 %** at the notch vs 98 % flat).

**Checked:** 29 Rust tests (2 new: letter A outline + hole at 100 mm,
Arial Bold face info), type check, wasm, CLI and desktop builds; every
UI change looked at in the browser (egg/ant wizard, text BOA in Arial
Bold with holes → 5 pieces / 4 cut-outs, height 300→150 scales evenly,
unequal triangle edits and rotation, pill radius independent, circle Ø,
chain link both places, tabs). GLB: Khronos glTF validator 0 errors, and
loaded back in a separate three.js scene the bead ripples and colour
bands sit on the seam. STEP: read as one solid by OpenCascade
(occt-import-js) on a closed test solid. Windows installer built locally
(114 MB) and a reference run from the bundled copy succeeded. **Not
checked:** opening the GLB/OBJ in KeyShot and the STEP in Guy's CAD;
installing the installer; inflating the new shapes (browser extension
dropped at that moment).

---

## Session 10 — 2026-10-22 · Reference solver in the app, uneven sheets, snapshots per file, panel polish

**Guy asked for:** connect the Reference solver in the app and run a square,
his triangle and the leaves through it; say when Claude is idle so UI work
can run alongside; then (finding the snapshots disappointing) try sheet
unevenness. UI: a big, prominent Solver picker with an info button and a
speech bubble saying what the solver is and who made it; settings the
solver doesn't use **hidden**, not greyed; descriptions on one line, no
"experimental", no Weld fillet description; the ⓘ centred; Pressure /
Target height switch must not move the panel; snapshots belong to their
file with a finite Recent list (a count, not an age), and two **distinct**
reuse actions (settings only vs shape + settings, with protection for
unsaved work); snapshots open in their own finish; smaller cards (picture
on the right of a black screen, words left, buttons always shown); the
Snapshot button next to Re-run; timeline numbers must not jump. Asked why
his good Steel triangle no longer appears. He overwrote his test project by
accident and asked for it back and for a check that stops it happening.

**Built / changed (visible)**
- **Solver → Reference** (desktop app): meshes the piece, runs OpenCourant
  offline (KIT's die-less hydroforming recipe), frames stream into the
  timeline with the real water pressure in bar, stops itself at the target
  pressure or height; progress bar with the engine's time estimate; Stop
  keeps the frames; play/pause replays frames instead of stopping the run;
  scrubbed-back frames are smoothed while it runs; presets and setting
  changes don't start it by themselves.
- **Solver picker**: full width, 16 px bold, at the top; **ⓘ** opens a
  speech bubble per solver (Reference: OpenCourant / OpenRadioss lineage,
  AGPL, KIT Metzger & Ummenhofer) with links that open in the browser.
- Inflate panel: settings the solver doesn't use are hidden; Target height
  is a slider row like Pressure (nothing moves when switching); shorter
  one-line descriptions; **Snapshot** button beside Inflate / Re-run.
- Timeline readings in fixed slots with even-width digits; one width for
  the status label.
- **Snapshots**: *This file* (saved inside the `.blownsim`, ~0.5 MB each,
  smooth mesh rebuilt on opening) and *Recent* (last 50 from any file,
  labelled with their file). **Apply settings** vs **Restore shape +
  settings** (asks Save first / Replace / Cancel when unsaved; Ctrl+Z
  undoes). Each snapshot keeps and restores its finish. Compact cards.
- **Saving**: the first Save of each app session asks where (dialog in the
  file's folder; Windows asks before replacing). Guy's lost test triangle
  restored as `Test Project files/Triangle 0.19 mm Rev A.blownsim` (v1
  folder) from the copy read at session start.

**Built underneath**
- `blown_core::reference`: model writer (byte-identical to
  `reference/kit_deck.py`), VTK frame reader, airbag pressure reader for
  `modelT01` (big-endian Fortran records), run plan, slider ↔ bar mapping,
  smooth random sheet waviness (`imperfection_mm`, `seed`; default flat).
- New crate `crates/blown-ref`: the run loop shared by the app and the CLI
  (starter, engine, frame conversion, stop at target, progress).
- `src-tauri`: `reference_check / start / stop / retarget`, `open_url`;
  save dialog takes a folder.
- CLI: `ref-run` (same path as the app; `--root`, `--imperfection`,
  `--seed`, `--height`, `--pressure`), `ref-deck`, `ref-water`.
- Snapshots: Recent / This-file flags in IndexedDB, base64 packing into
  project files, a second solver worker rebuilds smooth meshes.
- Leaf DXF splines → `samples/leaves/json/*.json` outlines.

**Results (TUNING_LOG)**
- Square 300 mm, 0.8 mm: draws in, corners pinch, folds fan from corners;
  no mid-side tucks while the sheets are perfectly flat. **0.5 mm
  unevenness**: mid-side V-tucks like Guy's photo (two sides with seed 1,
  one with seed 2). 1 mm: too lumpy.
- Guy's triangle (693 mm, 0.19 mm): a deep mid-side V-tuck and even edge
  waves; slider 77 over-blows it (228 mm). Leaf: smooth with a pinched
  notch; 98 % strain at the notch (to check).
- Steel solver triangle proven unchanged since session 9 (positions equal
  to 0.00002 mm): Guy's good look is a passing stage (frames 50-70).
- Running three reference runs at once is ~8× slower each: one at a time.

**Checked:** 27 Rust tests, type check, wasm and CLI builds; Rust deck
diffed against the Python one; every UI change looked at in the browser
preview (bubble, hidden settings, steady timeline, snapshot round trip
through a project file, smooth rebuild, finish restore, restore dialog).
The Reference button itself has not been clicked in the desktop window
(Claude can't); its pipeline was run end to end through `blown-cli ref-run`.

---

## Session 9 — 2026-10-22 · Why the pillow won't fold, the reference solver, solver list, compact panel

**Guy asked for:** pick up from the handoff and keep improving squares and
triangles (organic shapes are fine). Sent two screenshots of his best
triangle (Steel solver, seam 50, pressure 74, plates on) and then the project
file (`Test Project files/Untitled Rev A.blownsim` in the v1 folder: 693 mm
triangle, 0.19 mm, Balloon 1, pressure 77, clamp on), which he had **paused
mid-inflation**. Asked for a full analysis of the reference triangles (even
waves of X per side), research, working backwards from the shape, before
building; then "go ahead" with buckling-mode seeding (also expecting it to
help the Jo Malone balloons: many regular fluid waves, waves before buckles).
Suggested modelling a reference triangle in CAD and flattening it (logged).
Sent a research brief (Rev B: KIT "Die-Less Hydroforming", regime map, exact
benchmarks, two-scale method, self-diagnostics) and asked to replicate the
most accurate solver; asked for a **solver drop-down** to compare solvers and
use the slow accurate one when needed; verified OpenCourant himself (Norton
clean) and added a permission rule so Claude can run it. UI: Solver at the
very top, less scrolling, smaller/briefer descriptions, no padding under
Plates; **every slider with its value box on the same row** and min/max
under the bar.

**Found (details: docs/TRIANGLE_ANALYSIS.md, docs/REFERENCE_SOLVER.md, TUNING_LOG)**
- Guy's tucked triangle = a moment during a fast rise after the clamp let go
  (frame ~70: 125 mm, 7 % stretch); it later stretches to 194 mm / 39 %.
  The app's slider path doesn't matter on the Steel solver (`--stages`).
- Buckling-mode seeding built and working, but the smooth pillow is a
  **stable** equilibrium in our model under every setting tried (thin
  balloon, 304 hardening, hard temper, compressive yield, stretch capped at
  1 %, plastic tangent). The squeezed band is only ~10 mm wide.
- **Root cause (the brief's exact benchmarks):** the Mylar circle fails on
  both solvers (R/R0 0.96–0.99 vs 0.763; H/R 0.18–0.42 vs 1.198); the
  teabag square holds 0.17–0.20·side³ vs 0.2055. A real sheet is stiff
  pulled and free squeezed, so its rim crimps ~24 % shorter; our weld can't
  shorten and our sheet resists squeezing, so the edge never draws in.
  Free-in-compression moves the circle to 0.886 / 0.81.
- The mesh bending floor makes thin sheets bend like 0.45–1.5 mm: balloon
  waves can't form until the weld band is meshed finer.

**Built / changed (visible)**
- Inflate panel: **Solver** drop-down at the top — Fast (classic) / Steel
  (experimental) / Reference (accurate, slow; listed, not yet selectable).
  Old files with the Steel switch open on Steel.
- Panel compacted; one-line 11 px descriptions; no gap under heading-only
  rows. **SliderField** everywhere (Inflate panel, Brushed / Heat-tint
  flyouts, Render): bar + typed value on one row, ends under the bar.

**Built underneath**
- Steel solver (all default off): `mode_seed`, `mode_seed_at`, `mode_count`,
  `mode_iterations`, `mode_check_frames` (full-Hessian subspace inverse
  iteration, whole-body + inflate moves projected out, seeds only unstable
  shapes; `BLOWN_MODES` env prints/dumps); `compressive_yield`;
  `plastic_tangent`; `youngs_over_yield` now tunable.
- CLI `--stages 40,55,66,74`. Scripts: `edge_excess.py`, `edge_strain.py`,
  `show_modes.py`, `benchmarks.py` (area ratio, Mylar, teabag),
  `render_run.py run@frame`.
- **Reference solver:** OpenCourant (community continuation of OpenRadioss,
  AGPL) at `C:\Users\guyke\OpenCourant`, SHA-256 checked. `reference/`:
  `kit_deck.py` (KIT recipe as LS-DYNA keywords from any BlownSim mesh: two
  sheets merged at the weld, real thickness, 304 curve, self-contact, water
  pumped in via AIRBAG_LINEAR_FLUID, mass scaling), `run_ref.cmd`,
  `to_run.py` (results back into `runs/`). Proof-of-life plate: normal
  termination. KIT ring (Ø350/Ø35, 0.8 mm, `ref/ring-0`): reads clean,
  quasi-static (kinetic 0.2 % of internal); ~80 % done at wrap-up.

**Checked:** 25 Rust tests, type check, wasm, CLI build; screenshots of the
panel, solver list and heat-tint flyout in the running app.

---

## Session 8 — 2026-10-22 · Steel solver, seam hinge, Ridges, renders merged

**Guy asked for:** check the encoding-fix installer build (green); save
GitHub Actions minutes; fast runs as well as accurate ones; merge the
parallel chat's render-image work and run the app; a cleaner font in number
fields; triangle tips to inflate a little further toward the point; back up
the solver (leaves crease well) and keep at the Geometric look on squares
and triangles (leaves are fine); one variable at a time. His physics input:
real stainless barely stretches and can't squash; the shrinking perimeter
zig-zags the weld; a TIG seam resists opening like a book and is stiffer;
a seam welded all round two stacked sheets **cannot** shrink; most pieces
inflate smoothly, some pop. Chose: ridge sharpening in the finisher first,
then a new solver core.

**Built / changed (visible)**
- Snapshots → **Render image** merged from branch `renders` (studios, HDRI
  import, light sliders, tiled supersampled render). CLAUDE.md conflict kept
  v2's.
- **Inter** font bundled (`@fontsource-variable/inter`) for all text and
  number fields; even-width digits.
- Triangle tips: `corner_reach` 0.4 → 0.25 (lift starts ~4 mm nearer the tip).
- Inflate panel, all default off: **Ridges** (finisher gathers long soft folds
  onto crisp lines with flat facets), **Steel solver** (experimental core B),
  **Seam stiffness** (experimental seam hinge; the seam may also move up/down).
- Guy's leaf DXFs in `samples/leaves/`.
- Right panel 300 → 340 px; the Inflate / Re-run / Stop button is pinned to the
  bottom of the panel (sticky), so it never needs scrolling to (Guy).

**Underneath**
- CI: installers build **on request only** (`gh workflow run build.yml --ref
  v2-thickness`, or a `v*` tag); `concurrency` cancels superseded runs.
- **Core B** (`crates/blown-core/src/solver/statics.rs`, `--tune core=1`):
  quasi-static projected Newton per frame with a sparse Cholesky (faer 0.24),
  symbolic analysis kept for the run, factorisation reused for up to 5
  frames (refreshed when a stale one gives a short step). Plastic set from
  the exact equilibrium forces. Circle 200: 5.2 s (XPBD 6.7 s); stable on
  Final. Runs in the app's WebAssembly (no clock calls in the solver path —
  `std::time` panics there).
- Seam hinge (`seam_hinge`, `seam_hinge_yield`): before this the top and
  bottom sheets met at a **free hinge**. Gives the real welded-edge line and
  removes the rim crinkle.
- Many experiment knobs, all default off, each written up in TUNING_LOG:
  `weld_passes`, `weld_kink_yield`, `weld_seed`, `stretch_hardening` (304
  curve), `squash_limit` (rejected), `warm_start` (compression only is
  stable; tension/bend unstable), `fold_moment_real`, `static_kick`,
  `weld_shrink` (rejected as physics by Guy).
- Backups: tags `backup/solver-s8-leaf-crease`,
  `backup/solver-s8-before-stainless`, `backup/solver-s8-before-core-b`.

**Findings** (TUNING_LOG has the numbers)
- The XPBD core is ~25× softer in-plane than the steel it is given (λ
  restarts each substep, one pass): the rim squashed 2–7 % instead of
  buckling. Core B fixes that (−0.1 %), but even with real steel stiffness,
  real 1 mm bending, the seam hinge and a free seam, squares and triangles
  stay smooth pillows; above yield they stretch 12–20 % into a dome.
- Big folds appeared only with an artificially shortened seam — not
  physical, but it shows tucks need more edge metal than its path allows.

**Checked:** 25 Rust tests + type check every push; wasm build; core B run
headless in Node through the wasm (square 300 Draft, 9 s); renders of every
experiment (scripts/render_run.py), zebra side views; app launched on Guy's
laptop with the merged render work.

---

## Session 7 — 2026-10-21 · Clamp switch, stiffer in-plane solve

**Guy asked for:** Crease hold as whichever form gives the best results →
an on/off **Clamp while inflating** switch (folds set only once full); carry on
tuning.

**Built / changed**
- Inflate panel: *Clamp while inflating* switch (independent of presets;
  shown as "Clamped" on snapshots). Sends `creaseHold` 1000 = release once
  settled.
- Solver: new `stretch_passes` (extra in-plane passes only); defaults now
  `stretch_passes` 1 and `compression_factor` 1 — the rim folds instead of
  squashing; ~1.5× the time per frame. Creases up 1.5–4× across shapes; more
  stretch as a side effect. Full numbers in `TUNING_LOG.md`.
- Plates test threshold relaxed (contact 0.2 → 0.12).

**Checked:** 25 tests + type check; wasm rebuilt; zebra renders of Lyrae
XS/XL and the square.

---

## Session 6 — 2026-10-21 · Presets, real weld fillet, then v2 (thickness)

**Guy asked for:** presets in two rows; Weld fillet moved to Materials, then
back to Inflate once it became real geometry; plates independent of presets;
drop One-sided (and Pill); a preset title that turns to Custom when edited;
fillet must never change the boundary. Then: a real sheet thickness driving
look, rounded rim and drawn thickness — as a separate v2 so v1 isn't lost.

**v1 (branch main, tag v1-character)**
- Presets: Balloon, Pillow, Geometric, Soap film + a Custom chip; title shows
  "Preset · name" / Custom; only pressure, character, inflate-by, soap and
  bottom stiffness count as edits; presets never touch plates; Plates on fills
  in a gap of 20 % of the narrowest width. Preset remembered across reloads.
- Weld fillet is real geometry in the finisher (into smooth mesh + OBJ/STL).
  First version (rolling ball inside the wedge) ate sharp tips; rebuilt so the
  weld never moves and the sheets roll round to meet it (adds metal only),
  fading out near sharp corners and weld junctions.
- Fixed: blotchy shading on internal weld lines (seam normal sharing was also
  applied to back-to-back sheets). Lesson: `npm run wasm` after Rust changes
  before saying it's in Guy's app (it wasn't, once).

**v2 (sibling folder, branch v2-thickness)** — see `docs/TUNING_LOG.md`
- Thickness 0.1–3 mm replaces Character's hidden thickness; Balloon ↔
  Geometric works as temper. Pressure means "full" per sheet strength at any
  thickness (v1's scaling left Geometric 13× short of yielding — a shallow
  lens).
- Crease hold (CLI): folds can't set until the hold pressure / until settled —
  the static stand-in for the real temporary clamp. Found that all our creases
  are folds set on the way up.
- Tried and rejected: sheet (von Mises) flow, tension-weakened hinges,
  compression stiffness, bending floor, free seam, stretch cap — logged.
- Reference images read; Lyrae XS/XL traced to outlines at real size; crease
  numbers script and a browser-free renderer.
- Open: our pieces are too smooth vs the Geometric references; testing more
  solver passes at the end of the session.

## Session 5 — 2026-10-21 · Stiff corners, crumple bug, Target height

**Guy asked for:** (from four screenshots of a blue triangle) start the
corner fix — acute tips pulled in to needles and spiked up; rename Height to
**Target height** (it lands close, not exactly — that's fine); hunt the bug
where a Final mesh suddenly wrinkled up badly on one side. Ripples and
geometric character left for next session (one change at a time).

**Built / fixed**
- **Stiff welded corners**: tips under 100° tie their seams together across
  the corner (fading with distance and with how sharp the corner is). 300 mm
  triangle, Final: 20 mm from the tip the width kept went 71–87 % → 100 %, and
  the height there 5 mm → 1 mm. New test `sharp_welded_tips_keep_their_shape`.
- **Crumple bug**: found with a probe — on Final meshes thousands of links
  "yielded" in the first 2–3 frames while the sheet was still flat (worst
  17 %), whatever the pressure. Cause: the seeded starting bump stepped up
  from the weld, and the snap rang; plasticity read the ringing as yielding,
  and the extra metal crumpled later (badly in height mode, which lowers
  pressure to brake). Fix: starting bump fades to zero near welds + extra
  damping for the first 12 frames. Final triangle stretch 18 % → 3.5 %;
  Target height 20 → 20.0 mm with no crumple. Draft suite unchanged (±0.7 mm).
- **Target height** label (Inflate by switch, field, toast).
- CLI: `BS_CORNERS=1` prints how each sharp corner held up.

**Checked**: 24 Rust tests + type check; triangle Final with/without stiff
corners side by side in the browser (runs `tri-corner`, `tri-nocorner`,
`tri-h20` kept for Guy); suite heights before/after.

---

## Session 4 — 2026-10-21 · Line types, the TIG weld look, finishes, inflation control

**Guy asked for:** a way to tell weld lines from outlines in imported DXFs
(by layer or colour, no colours brought in, a simple assign step, plus tools to
re-type or delete individual lines); Construction = a weld switched off; a
**Weld** switch in the materials that shows unpassivated TIG welds (heat-tint
rainbow) on bare stainless and a bare polished seam on PVD / iridescent / heat
tint, matched to his reference photos (narrower; its own roughness; more
detail, shimmer, ripples; a glinting fillet at the seam); brushed direction +
grain size and heat-tint pattern size / position; fixes for brushed showing
polygons and dimples; a dynamic Creases view; align tools; File / Edit / undo
at the top left; pressure that sets *how much* it inflates and a height target
that is respected. Discussed (not built): acute corners over-deforming.

**Built**
- **Line types**: every line is Outline / Weld line / Construction. DXF/SVG
  lines keep their layer + colour; a multi-layer import opens a **Line types**
  window (swatch, Outline / Weld line / Construction / Leave out, live weld
  check, remembers choices, guesses from layer names). Closed weld loops quilt
  instead of cutting holes. Shapes panel: three-way switch, Line types…, Same
  layer; Shift+double-click, box-select inside an outline, Delete.
- **Weld look** (Welds on/off in the materials palette): bead with crescent
  TIG ripples, thin dark line, narrow blue→magenta→gold line, straw halo with a
  wandering width; thin-film shimmer; own roughness (dull bead, hazy oxide);
  rounded fillet glint at the seam (Weld fillet radius). Coated finishes get a
  bare polished seam. Internal laser welds stay clean.
- **Finishes**: Brushed direction + grain size (smooth tangents, low-contrast
  grain, moderate anisotropy); Heat tint pattern size / position / colour range.
- **Creases view** scales to each piece's own range; snapshots keep crease data.
- **Align** buttons (2+ shapes). **Top bar**: File · Edit · undo/redo at the
  top left, Export at the right. Size dialogs no longer spill the unit outside.
- **Inflation**: pressure slider on a curve (spreads 0–100 from a shallow bulge
  to full); height mode is a rise-speed controller that brakes on target.

**Underneath**
- Mesher test for closed weld loops; chain joining per layer/colour with
  straightest-continuation at junctions.
- Points carry `tig` (distance to outline/hole weld) and `tigS` (along it).
- Solver: `steer_height` controller (`height_approach/max_rate/gain`);
  `pressure_curve` = 3; old settings upgraded on load (`pressureCurve`).

**Checked**: 23 Rust tests + type check; import samples (by layer, colour,
one layer, SVG) in the browser; weld look zoomed in repeatedly (probes found the
fingerprint rings = over-curved crescents); brushed A/B by toggling parts;
Creases live + old snapshot; CLI pressure curve (P20 12 mm … P100 145 mm, P77 =
old P45) and height targets (20→19.6, 60→61, 110→110; circle/L/surfboard within
0.5 mm; app 20→19.5). Not checked: desktop Save/Open dialogs (still).

---

## Session 3 — 2026-10-21 · Quilting welds, edge ripples, project files

**Guy asked for:** the triangular "flower" panel's ripples along every weld
(reference photo) and the Jo Malone pill's rim pleats; a proper-size custom
PVD colour square; iridescent as a beetle's two-tone green ↔ blue shimmer;
Creases view that adapts so the main crease shows on gently creased pieces;
more contrast and a darker background for Mesh; a pressure-gauge icon for
Inflate; shape sidebar the same width as the materials one, bigger icons with
words; how projects are saved (Save / Save as, file type). Mid-session he
added: **weld lines in Shape mode** (laser-welded seams to quilt a piece) that
snap to points/lines, with imported lines switchable to *construction* like
SolidWorks; asked whether sheet thickness should be a slider; and suggested
making the welds proper sides of the mesh rather than letting triangles sit
across them — which turned out to be the key fix for smooth creases.

**Built**
- **Weld line tool** (W): drag a straight weld; snaps to corners, centres,
  edge middles and edges (Shift = 15° steps). Weld lines inside a shape quilt
  it; crossing welds are joined where they cross. **Weld / Construction**
  switch in the Shapes panel for any shape or line; construction is dashed grey
  and ignored when inflating. **Imports become a group** of one shape per line
  or loop: click selects the group, double-click picks one line.
- **Project files `.blownsim`** (JSON: drawing, settings, look and colours).
  File menu: New, Open, Save, Save as, **Save as next revision** (Rev A → B …),
  Import DXF/SVG. Ctrl+N / O / S / Shift+S / I. Project name + Rev and an
  unsaved dot in the top bar. Native dialogs in the desktop app; download /
  file picker in the browser.
- **Looks**: iridescent is now a **two-tone beetle shimmer** (face-on colour →
  glancing colour, both pickable, 4 presets); a **colour flyout** with a large
  saturation/brightness square, hue strip, hex box and presets (PVD and
  iridescent); **Creases** scales to each piece's strongest folds (98th
  percentile) and runs hot to white; **Mesh** on pure black with bright lines.
- Shape sidebar 88 px with labelled 22 px icons (Draw / View groups); Inflate
  icon is a pressure gauge.
- **Edge ripples** slider (Inflate panel) and Character now reads "behaves like
  ≈ X mm sheet at this size".

**Physics / mesh / finisher**
- **Mesher bug fixed**: the pass that splits edges joining two weld points kept
  halving along slightly-off straight welds → fans of 0.8 mm needle triangles
  that tore (plain 600 mm hexagon blew out to the 40 % cap). Interior points
  now on an even jittered lattice; the refiner may not chop weld edges.
- **Clean row of triangles along every weld** (Guy's suggestion): each weld
  segment gets a point standing over its middle, both sides of a weld line.
  Removed the one-triangle "teeth" beside seams; creases into welds are smooth.
- **Weld joins**: crossing welds and seam ends touching the outline become
  shared corners before spacing (no slivers at junctions; quilt 7.6 % stretch).
- **Weld straightness** (solver): weld points resist kinking sideways (a seam
  is a doubled strip). Welded hexagon: 40 % runaway → 9–12 %.
- **Finisher**: extra smoothing in the band beside welds; **edge ripples**
  layer — pleats where the solve shows the metal squeezed along a weld,
  amplitude from the spare length ((πA/λ)²), spacing 3·√(R·t) from sheet
  thickness, zero at the weld, gone within ~1 wavelength, faded at junctions.
  Fold edges touching a weld point are not kept sharp.

**Checked**: 22 Rust tests + type check; suite (square 8.8 %, surfboards,
plates fine; circle and L-shape each have one small hot spot at 40 %, as
before); hexstar and quilt test shapes viewed by eye in polished / mesh /
iridescent / creases; weld tool, snapping, Weld/Construction, File menu and
looks exercised in the browser. Not yet clicked through: the desktop Save /
Open dialogs (compiled, not hand-tested).

---

## Session 2 — 2026-10-21 · Look, snapshots, and truer creases

**Guy asked for:** icons + animation on the mode switch; materials down the
left side with room to grow, a mesh (polygon) view, iridescent, PVD with a
colour picker; a fix for jagged polygons even with Smooth; study real inflated
stainless (Full Blown residential/sculpture pages + image search) and make the
presets behave like it; Fixed outline gave too little height; creases seemed to
follow the mesh lines; a 3-step mesh setting; a snapshot button with snapshots
collected in the third tab.

**Built**
- Mode switch Shape / Inflate / Snapshots with Lucide icons and a sliding,
  glowing highlight; snapshot count badge.
- Left **look palette** in the 3D views. Finishes: polished, mirror, brushed,
  bead-blast, PVD (6 presets + custom colour), iridescent (oil-slick), heat tint
  (straw → bronze → purple → blue, oxide-film range). Analyse: zebra, height,
  creases, contact, **mesh** wireframe, clay. Film-thickness noise map so
  iridescent colours swirl (seamless, low frequency).
- **Snapshots**: camera button / `S` saves the piece as on screen (smooth mesh
  if ready) with a thumbnail; Snapshots tab with cards, rename, delete, reuse
  settings; stored in IndexedDB; export works on the open snapshot; the live
  inflation is never disturbed (viewport now takes its data as props).
  CLI test runs moved under "Test runs" in that tab.
- **Mesh: Draft / Medium / Final** (Medium default; Final subdivides twice).
- Autosave now also keeps look, PVD colour and Smooth.

**Physics / finisher**
- **Fixed outline redone**: the piece inflates freely, then a harmonic in-plane
  warp maps the weld onto the drawn outline → full height and natural creases
  (300 mm square: 121 mm, same as free). Pinning was what starved the height.
- Bending stiffness floored to the mesh size (folds span several triangles)
  while the **plastic fold moment stays physical** → shape no longer depends
  on mesh density.
- Finisher **pre-smooths the coarse mesh** before subdividing, protecting very
  sharp folds; creases smoothed along their length; weld stays on its plane.
  This is what removed the jaggedness under Smooth.
- Pillow preset lowered (P45) to match photo proportions.
- CLI: `--medium`, `--finish N`, `--pre-smooth`, `--crease-angle`.

**Research notes** (Full Blown photos): creases are few, long and coherent
with crisp ridges; pillows ≈ 0.2–0.35 × short side; corners pinch into
star/fish-mouth folds; long edges ripple; Soft Seat = Geometric reference.

**Checked:** 21 Rust tests; type check; visual A/B of finisher and fold floor
in zebra; live inflate → settle → smooth → snapshot in the browser; looks
screenshotted.

---

## Session 1 — 2026-10-21 · First build (Phase 0 + most of Phase 1)

**Guy asked for:** start from the Rev F handoff, work autonomously, install
everything; near-black UI with light linework and a zebra view; Illustrator-
style primitives (circle, ellipse, rectangle, polygon by drag or typed size,
typed corner count); width/length dimensions from the furthest points, always
horizontal/vertical, typed sizes scale the shape (also for imports); Lucide
icons; an option to fix the outline.

**Installed:** VS 2022 Build Tools (C++), Rust stable + wasm32 target, Node 22
via nvm (alongside 18). Private GitHub repo + CI (Windows + Mac installers).

**Built**
- Rust core: CDT meshing with weld detection, sliver/duplicate clean-up, two
  sheets sharing weld points (watertight); XPBD solver (stretch with yield and
  strain cap, dihedral bending with plastic hinges, pressure, plates with
  friction, seeded imperfection); exporters (OBJ/MTL, STL); 16→21 tests.
- CLI with frame output and the Phase 0 suite; WASM bridge; worker streaming.
- UI: 2D board (primitives, click-to-type dialogs, handles, rotate knob,
  marquee, undo/redo, nudge, lock proportions, editable dimensions), DXF/SVG
  import (bulges, arcs, splines, blocks, SVG paths/arcs), weld check, presets,
  pressure/height, character, plates, timeline, OBJ/STL/PNG export, autosave.
- Finisher v1 (Loop subdivision + Taubin), Smooth toggle, viewer finishes.
- Tauri desktop shell with native Save-as, app icon, double-click launchers.
- Docs: README, HOW_TO_TEST, PRIOR_ART, SKETCHUP_SDK.

**Key fixes:** plasticity moved from apparent strain to solver force
(results were time-step dependent); rotated outlines produced slivers/NaN;
dimension box lost focus on open.
