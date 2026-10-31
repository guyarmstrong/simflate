# Handoff — Simflate (was BlownSim v2)

_Last updated: 2026-10-31, end of session 23 (Mac Reference port compiles; first model run pending)._

**Simflate** lives in this folder (`Sheet Metal Inflation Simulator v2`,
branch `v2-thickness`, port 1430, window "Simflate"). v1 (BlownSim) is
untouched in the sibling folder (branch `main`, tag `v1-character`). Push to
`origin v2-thickness`. Guy opens the app with the desktop shortcut
**Simflate** (runs `Start BlownSim v2.cmd` = `npm run app` = tauri dev).
Guy's reference photos: v1 folder `Refrence images/`.

## Where we are

Version **1.1.1** (package.json; not tagged). Everything is committed and
pushed. Share folder `D:\Gaia\Projects\Stephen Newby\Simflate 1.1 installers\`:
**Windows** `Simflate_1.1.1_x64-setup.exe` and **Mac**
`Simflate_1.1.1_universal.dmg` (built 2026-10-31, commit 89e7c62) plus install
notes. **Since 1.1.1 (not in any installer yet):** Mac icon without the black
tile, Mac clipboard (Illustrator paste), Height view from the seam, Seam
stiffness default 50, Edge ripples default 0. Guy tests Windows on the work
laptop (Tailscale "guyarmstrong1"); the client is Mac-first and has **older
Intel Macs too**. This laptop is on Tailscale as "msi".

**Guy's MacBook (test Mac):** MacBook Air M2, 8 GB, **macOS 14.6.1 — Guy can't
update it** (so no Homebrew: its .pkg needs macOS 15 + an admin; user `moe`
is not admin). `ssh -i ~/.ssh/simflate_mac moe@100.93.253.97` (Tailscale
`delaneys-macbook-air-2`). Has Apple Command Line Tools, Rust
(`~/.cargo`), conda env `~/simflate-build/env` (gfortran / gcc / g++ 16.2,
cmake, boost, metis, lapack) and `~/simflate-build/imgenv` (Pillow). Folders:
`oc/` = clone of our fork, `gh/` = GitHub build 9's bundled programs,
`app/` = Simflate's Rust sources (for `cargo check` / `cargo test` on Mac),
`icon/`. 18 GB free. Its own OpenCourant builds compile but the starter
can't start (conda g++ uses libc++; GCC 16 emits `__cxa_call_terminate`):
**run GitHub's bundled programs on it instead**. They run on 14.6 even
though everything says minos 15.0.

**Money rule (Guy):** no paid GitHub, no paid signing, no paid tools. Build
Windows locally.

**Public copy for free Mac builds (session 22):** `guyarmstrong/simflate`
(public) holds the current files only, one commit per publish, author
`200261854+guyarmstrong@users.noreply.github.com` (Guy's gmail is on every
commit of this private repo, so this one stays private). Publish with
`node scripts/publish-public.mjs` (committed files only), then
`gh workflow run build.yml -R guyarmstrong/simflate --ref main` — public
repos get free Actions minutes, Mac included. Workflow runs only on tags /
manual start. Before each publish: gitleaks on the exported files (the one
"generic-api-key" hit in `ui/src/io/recent.ts` is a localStorage key name).
Mac builds wait until Windows is ready (Guy).

## Next session — in this order

1. **Mac Reference port** (Guy: Reference must ship and work on every Mac,
   Apple silicon *and* Intel). Fork `guyarmstrong/opencourant-mac`, branch
   `macos`; local clone `D:\Gaia\Projects\Stephen Newby\opencourant-mac`
   (remote `fork`; sparse checkout — `MSYS_NO_PATHCONV=1` for
   `git sparse-checkout add`; `git grep` there is slow (blob:none): grep on
   the MacBook's `~/simflate-build/oc` instead; files are CRLF in the working
   copy — edit with scripts that keep line endings). Workflow
   `.github/workflows/macos_build.yml` (macos-15): Homebrew tools →
   `build_all.sh` (~12.5 min) → `bundle_deps.sh` → lldb + plain test run of
   `Compiling_tools/macos/test/model.k`, fails without NORMAL TERMINATION.
   a. **Build 10** (run 41213949485, commit 5b9e651: reader falls back to
      radioss2026 when the starter's 2612 is unknown) compiled and bundled,
      but its **test step ran 32 min with no output files** (the starter
      under lldb never finished; the run was then cancelled). Before the fix
      it failed in 1 s, so the reader now gets further. Next: run build 10's
      programs on the MacBook (`gh run download 41213949485 -R
      guyarmstrong/opencourant-mac`, copy `exec/` over, `xattr -cr`, run the
      starter on `Compiling_tools/macos/test/model.k` with RAD_CFG_PATH set,
      watch `starter.log` and CPU) to see whether it's slow, stuck or waiting
      on input. Drop lldb from the CI test (or `timeout` it) and add a
      `timeout-minutes` on the test step. The MacBook was offline at the end
      of the session (asleep / off Tailscale): ask Guy to wake it.
   b. **Faster CI (was about to start):** cache `starter/cbuild_*`,
      `engine/cbuild_*`, `reader/cbuild_macosa64`, `exec`, `extlib`,
      `extlib.zip`, `build_macos` with actions/cache (key: tool versions +
      sha; restore-keys prefix); after checkout `touch -t 2000…` all tracked
      files, then touch only `git diff --name-only <cached sha> HEAD` (record
      the sha in `.oc-built-sha`); make `make_recipes.py` write files only
      when their content changes. load_extlib skips when extlib exists.
   c. Results vs Windows: same model, heights frame by frame.
   d. **macOS 11+ and Intel:** set `MACOSX_DEPLOYMENT_TARGET=11.0`; link the
      GCC runtime statically where possible (`-static-libgfortran
      -static-libgcc`, static libquadmath); check every file's minos
      (`vtool -show-build`) and fail the build above 11.0. Intel job on a
      GitHub Intel runner (`macos64` recipes from `linux64`; Homebrew at
      /usr/local), then `lipo` into universal programs.
   e. Simflate side (can be done while CI runs): vendor the Mac programs like
      Windows (`scripts/opencourant.mjs` per platform; `tauri.macos.conf.json`
      resources incl. `hm_cfg_files`), `crates/blown-ref` already names the
      programs per platform and sets DYLD_LIBRARY_PATH; re-enable Reference /
      Symmetric on Mac **only when the engine is present** (SolverPicker
      `isMac` + a Rust check), ad-hoc sign, then a Mac installer via the
      public copy and Guy's checklist (HOW_TO_TEST → "On a Mac").
   f. Offer the fixes upstream to OpenCourant (with Guy's OK) — the 2612 /
      open-reader fallback and the open-reader build switches are real
      upstream bugs, not Mac-only.
2. **Guy's results**: work laptop 1.1.1 (DWG import; logo → Copy summary;
   Reference twice on the same piece); Mac icon final review on the Mac.
3. **Fast on more cores** (on the to-do list; wait for Guy).
4. **Reference engines idle ~25 s** after appearing (Windows, Intel MPI).

**Standing rules from this session**: every `tauri build` runs
`scripts/check-upstream.mjs` (stops if OpenCourant #67 closed or a newer
release; look, repack if fixed, tell Guy; `SIMFLATE_UPSTREAM_CHECKED=1` to
build anyway). Mac builds: `node scripts/publish-public.mjs` then
`gh workflow run build.yml -R guyarmstrong/simflate --ref main`. New
detectors / debug aids go in the logo's About & diagnostics.

**Slow starter details (for reference)**: edited-starter offsets
`cmp ebp,2711h` at file offset 0x1A1E89B and `cmp r14d,2711h` at 0x1A1F1AF
(immediates at +2 / +3: `11270000` → `03000000`), edited SHA-256 4ce51b4e…;
outputs identical except the 5-byte .rst run stamp. Not shipped (Norton).

## Resume in 60 seconds

1. Read `CLAUDE.md`, this file, the session 23 entry of `docs/BUILD_LOG.md`,
   DECISIONS → "Session 22" / "Session 23". `docs/VERSIONS.md` = versions and releases.
2. Bash PATH: `export PATH="/c/Users/guyke/AppData/Roaming/nvm/v22.20.0:/c/Users/guyke/.cargo/bin:$PATH"`
3. `npm test` (40 Rust tests incl. blown-dwg + type check). **`npm run wasm` after any Rust
   change in crates/.**
4. **Guy's app is `tauri dev` and opens his real project.** Edits under
   `crates/` or `src-tauri/` rebuild and restart his window; `ui/`
   hot-reloads. Own checks: `CARGO_TARGET_DIR=target/check-native`.
5. **UI tests without touching Guy's work:** `npx vite --config
   scripts/vite-isolated.config.mjs --strictPort` (port 1499) + puppeteer-core
   (`…/9f0521ec-…/scratchpad/node_modules/puppeteer-core`, Chrome headless,
   own `userDataDir`), or Playwright (WebKit = Safari's engine, `channel:
   'chrome'`) in `…/31e8a6bd-…/scratchpad/wk` (`mac-engine.mjs`,
   `examples.mjs`, `height.mjs`). The preview answers on `localhost`, not
   127.0.0.1. `window.__app` is the store in dev. Restart that vite before scripted imports after edits
   (HMR gives the page a different module instance). Stop it by killing the
   node processes whose command line has `vite-isolated` (TaskStop leaves
   the port held).
6. **Reference from the CLI** (the command must contain the OpenCourant
   path): `target/release/blown-cli.exe ref-run runs/leafm-mesh --root <v2>
   --oc C:/Users/guyke/OpenCourant/OpenCourant --name x --t 0.19 --height 40
   [--prepare]`. One at a time; time only when plugged in and quiet.

## State

| Area | State |
|---|---|
| Version | 1.1.1 (Simflate v1.11), App ID `app.blownsim.v2`. Windows installer perMachine + firewall hooks (`src-tauri/windows/hooks.nsh`); Mac ad-hoc signed, universal. |
| Forms | Nine example forms on a fresh install (`ui/public/examples/forms.json`); Recent keeps 30; smooth mesh rebuilt from a snapshot's own mesh when re-meshing differs. |
| Panels | Draft / Inflate tool columns fit short screens (`useFitColumn`). Contact beside the Plates eye; plates only for Fast / Steel. "3D display" switch. |
| Reference | Prepared ahead in the background and remembered (`reference-prepared`, 8 newest); engine shipped as "Simflate Reference engine.exe". Windows only; Mac port compiles (fork), first model run pending. |
| Mac | Icon without tile (`scripts/make-mac-icon.py`), NSPasteboard clipboard (`clip.rs`), ⌘ in messages. Display engine (WebKit) checked identical to Chrome. |
| Defaults | Seam stiffness 50, Edge ripples 0 (older forms keep 0 / 50 via `upgradeSettings`). Height view from the seam. |
| Draft board, solvers, materials, export | As session 20 (Pebble / star, Export outline, Ctrl+C, reproducible re-runs; Fast, Steel, Reference, Symmetric, Specified geometric; KeyShot GLB / OBJ, DAE, STEP, STL, PNG). |

## Open questions for Guy

- Which Macs does the client have? (Apple menu → About This Mac: chip,
  macOS version, year.) Anything below macOS 11 changes the plan.
- Real Illustrator on a Mac: does paste work as tested (SVG code setting)?
- Fast speed-up: OK for volume sums to change results very slightly (not
  visibly) if that's needed for the bigger gain?
- From before: Ctrl+C → Illustrator paste OK (Windows)? Double start-up screen seen
  again? Fold over amount; Min bend default; Steve's patterns.

## Known issues

- Test laptop (Trend Micro Apex One): the starter is held ~50 s each time it
  runs; preparing ahead hides it once the piece has been on Reference a few
  seconds or was run before. IT won't add an exclusion.
- GitHub tag `v1.1.0` build failed (no free minutes) — don't rerun; build the
  current version instead.
- Reference / Symmetric not on Mac yet (examples using them restore as Fast there).
- GitHub's Mac programs are marked minos 15.0 (they run on 14.6 anyway); deployment target still to set.
- DWG import: desktop only (the browser preview says "save it as DXF"); DWG export not offered (DXF opens in AutoCAD).
- From before: Pebble / star 4 of 960 extreme combinations cross themselves
  (weld check flags them); Specified geometric note past ~½
  the narrowest width; patterns shading only; STEP has no thickness;
  Illustrator opens DXFs 2.83× small; dev launcher shows a console window;
  GitHub warns about the two OpenCourant pieces (90 / 75 MB).
