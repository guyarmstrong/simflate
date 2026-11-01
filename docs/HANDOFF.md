# Handoff — Simflate (was BlownSim v2)

_Last updated: 2026-11-02, session 26 (Intel Mac engine fixed; Simflate 1.1.3 committed; Mac installer not built yet)._

**Simflate** lives in this folder (`Sheet Metal Inflation Simulator v2`,
branch `v2-thickness`, port 1430, window "Simflate"). v1 (BlownSim) is
untouched in the sibling folder (branch `main`, tag `v1-character`). Push to
`origin v2-thickness`. Guy opens the app with the desktop shortcut
**Simflate** (runs `Start BlownSim v2.cmd` = `npm run app` = tauri dev).
Guy's reference photos: v1 folder `Refrence images/`.

## Where we are

**Session 26 state:** 1.1.3 is committed and pushed (193c603): universal Mac engine (fork commit 4e4233a, run 41345080291), so Reference / Symmetric now run on Intel Macs. **Not published to the public copy and no 1.1.3 installer built:** waiting for Guy's OK to publish (gitleaks on the export is clean apart from the known recent.ts key name). No Windows installer needed: its engine and behaviour are unchanged. The share folder and the client still have 1.1.2. Client's Mac: M1 2024 (Guy), macOS version not known yet.

Version **1.1.2** (Simflate v1.12; package.json; not tagged). Everything is
committed and pushed. Share folder `D:\Gaia\Projects\Stephen Newby\Simflate 1.1 installers\`:
`Windows\Simflate_1.1.2_x64-setup.exe` (built here, commit c59cf99) and
`Mac\Simflate_1.1.2_universal.dmg` (public-copy build of c59cf99) plus the
install notes (Mac note updated for Reference). **Both sent to the client
2026-11-01.** Specified geometric was not tried on the real MacBook (checked
in WebKit in session 23); ask Guy / the client if it behaves.

**Reference on the Mac works on Apple silicon** (M1–M4): our OpenCourant
build (fork commit 84a0325) is packed in `vendor/opencourant-mac/` and
bundled; results match Windows (test model identical to every printed digit;
Guy's 500 × 300 rectangle 192.3 mm on both; Symmetric within 0.001 mm).
In **1.1.2 Intel Macs** show Reference / Symmetric as "(not on this Mac yet)"; 1.1.3 offers them.

**Guy's MacBook (test Mac):** MacBook Air M2, 8 GB, macOS 14.6.1 (can't be
updated, user `moe` not admin, no Homebrew).
`ssh -i ~/.ssh/simflate_mac moe@100.93.253.97` (Tailscale
`delaneys-macbook-air-2`). **It sleeps after 1 minute idle** and drops off
Tailscale: keep it awake with `nohup caffeinate -i -t 10800 &` over SSH.
Simflate 1.1.2 installed in /Applications and approved (Open Anyway).
`~/simflate-build/`: `oc/` fork clone (old), `b12/`, `t112/` (test copy of
the app, quarantine test), `symrun/` (Symmetric test), conda envs, Rust,
Command Line Tools (clang works). **Running anything quarantined there pops
Apple's warning on Guy's screen** — clear the mark first or warn him.

**Money rule (Guy):** no paid GitHub, no paid signing, no paid tools. Build
Windows locally; Mac on the public copy `guyarmstrong/simflate`
(`node scripts/publish-public.mjs`, then `gh workflow run build.yml -R
guyarmstrong/simflate --ref main`; gitleaks on a `git archive` export first —
the one hit in `ui/src/io/recent.ts` is a localStorage key name).

## Next session — in this order

**Next release build requirements: `docs/private/BUILD_REQUIREMENTS.md`** (Guy's decisions, 2026-11-01) and
3D inflation resources: `docs/private/3d-inflator/` (record only, nothing built). Read
both before discussing features. `docs/private/` is on Guy's laptop only, not in git.
Planning is closed. Guy is writing the client document in the Claude app (prompt: `docs/private/CLIENT_DOC_PROMPT.md`).
Feature work waits for the client to pick features and priorities; the client sets the direction. Client feedback on 1.1.2 is item 1 below.
**Next:** with Guy's OK run `node scripts/publish-public.mjs`, `gh workflow run build.yml -R guyarmstrong/simflate --ref main`, put the dmg in the share folder as 1.1.3, update the Mac install note (it still says Intel later), install on the M2, re-run Reference there. Then find a real Intel Mac to time.

1. **Client feedback on 1.1.2** (sent 2026-11-01) (Windows and
   Mac). Which Macs the client has (Apple menu → About This Mac: chip, macOS,
   year) decides 2 and 3.
2. **Intel engine: fixed in 1.1.3, untested on a real Intel Mac.** See BUILD_LOG session 26. The "~70x slower" figure was wrong (the starter used most of the time limit). Virtual Intel Mac, test model: starter 20 min -> 7 s; full run 28-42 min on 1 thread. Real Intel timing with 1 v 2 threads is the open item: the virtual machine's thread results did not hold on the real M2.
3. **Older macOS:** our programs are minos 11.0, but Homebrew's dylibs are
   14.0 (Intel) / 15.0 (arm: libgfortran, libgomp, libquadmath, libstdc++,
   boost, lapack, metis). They run on 14.6; below that is unknown. If the
   client has macOS < 14: link the GCC runtime statically (`-static-libgfortran
   -static-libgcc`, static libquadmath) and build METIS / LAPACK / Boost with
   the deployment target (or from source in CI).
4. **Licences in the Mac package:** add the Homebrew libraries' licence texts
   (GCC runtime exception, Boost, METIS Apache, LAPACK BSD) beside SOURCE.md.
5. **Offer upstream** (with Guy's OK): the open reader's 2612 support and the
   open-reader build fixes are real OpenCourant bugs (Linux open-reader builds
   fail the same way).
6. From before: Guy's results on the work laptop (DWG import; Copy summary;
   Reference twice on the same piece); Fast on more cores (wait for Guy);
   Reference engines idle ~25 s after appearing (Windows, Intel MPI).

**Standing rules**: every Windows `tauri build` runs
`scripts/check-upstream.mjs` (stops if OpenCourant #67 closed or a newer
release — look, repack if fixed, tell Guy; `SIMFLATE_UPSTREAM_CHECKED=1` to
build anyway). New detectors / debug aids go in the logo's About & diagnostics.

## Mac engine — how it's made

- Fork `guyarmstrong/opencourant-mac`, branch `macos`; local clone
  `D:\Gaia\Projects\Stephen Newby\opencourant-mac` (remote `fork`, sparse
  checkout; `MSYS_NO_PATHCONV=1` for `git sparse-checkout add`; some files are
  CRLF in the working copy — edit with scripts that keep line endings).
- Workflow `.github/workflows/macos_build.yml`: matrix arm64 (macos-15) +
  x86_64 (macos-15-intel), cached build folders (key: tools + deployment
  target), `build_all.sh` → `bundle_deps.sh` → minos list → "Package for
  Simflate" → test model (must print NORMAL TERMINATION) → artifacts
  `simflate-opencourant-macos-<chip>`; job `universal` lipos both. A cached
  build with a small change takes ~1 min; a full one ~16 min (arm).
- Into Simflate: `gh run download <run> -R guyarmstrong/opencourant-mac -n
  simflate-opencourant-macos-<chip>`, then `node scripts/opencourant.mjs pack
  --mac <folder>`, update `vendor/opencourant-mac/SOURCE.md` (commit, run) and
  the Diagnostics label (`ui/src/ui/Diagnostics.tsx` OC_RELEASE), version
  bump, publish, build.

## Resume in 60 seconds

1. Read `CLAUDE.md`, this file, the session 24 entry of `docs/BUILD_LOG.md`,
   DECISIONS → "Session 23" / "Session 24". `docs/VERSIONS.md` = versions and releases.
2. Bash PATH: `export PATH="/c/Users/guyke/AppData/Roaming/nvm/v22.20.0:/c/Users/guyke/.cargo/bin:$PATH"`
3. `npm test` (40 Rust tests incl. blown-dwg + type check); `cargo test -p
   blown-ref` (2). **`npm run wasm` after any Rust change in crates/.** Mac
   Rust: `CARGO_TARGET_DIR=target/check-mac cargo check --target aarch64-apple-darwin -p blown-ref`.
4. **Guy's app is `tauri dev` and opens his real project.** Edits under
   `crates/` or `src-tauri/` rebuild and restart his window; `ui/`
   hot-reloads. Own checks: `CARGO_TARGET_DIR=target/check-native`.
5. **UI tests without touching Guy's work:** `npx vite --config
   scripts/vite-isolated.config.mjs --strictPort` (port 1499) + puppeteer-core
   (`…/9f0521ec-…/scratchpad/node_modules/puppeteer-core`, Chrome headless,
   own `userDataDir`), or Playwright (WebKit = Safari's engine, `channel:
   'chrome'`) in `…/31e8a6bd-…/scratchpad/wk`. The preview answers on
   `localhost`, not 127.0.0.1. `window.__app` is the store in dev. Stop it by
   killing the node processes whose command line has `vite-isolated`.
6. **Reference from the CLI** (the command must contain the OpenCourant
   path): `target/release/blown-cli.exe ref-run runs/leafm-mesh --root .
   --oc C:/Users/guyke/OpenCourant/OpenCourant --name x [--t 0.19 --height 40]
   [--prepare]`; results in `ref/<name>/` (model.k, last frame). One at a
   time. Last runs of the app: `%LOCALAPPDATA%\app.blownsim.v2\reference\run-*`
   (Windows), `~/Library/Application Support/app.blownsim.v2/reference/` (Mac);
   a new run clears them. Frames → shape: `anim_to_vtk_win64.exe modelA0NN`
   reads Mac frames too.

## State

| Area | State |
|---|---|
| Version | 1.1.3 (Simflate v1.13; 1.1.2 is the last shipped), App ID `app.blownsim.v2`. Windows installer perMachine + firewall hooks (`src-tauri/windows/hooks.nsh`); Mac ad-hoc signed, universal app. |
| Reference | Windows: OpenCourant latest-20261011, 4 MPI copies, "Simflate Reference engine.exe". Mac: our build, universal; one engine, 1 thread on Intel and small models, otherwise half the cores; offered only when the engine has this chip's code (`for_this_chip`); quarantine cleared on first use. Prepared ahead and remembered (`reference-prepared`). |
| Mac | Icon without tile, NSPasteboard clipboard, ⌘ in messages, Reference / Symmetric on Apple silicon. Display engine (WebKit) checked identical to Chrome. |
| Forms | Nine example forms on a fresh install; Recent keeps 30. Reference / Symmetric examples restore as such on an Apple-silicon Mac (Guy checked). |
| Defaults | Seam stiffness 50, Edge ripples 0 (older forms keep 0 / 50). Height view from the seam. |
| Draft board, solvers, materials, export | As session 20 (Pebble / star, Export outline, Ctrl+C, reproducible re-runs; Fast, Steel, Reference, Symmetric, Specified geometric; KeyShot GLB / OBJ, DAE, STEP, STL, PNG). |

## Open questions for Guy

- Which Macs does the client have (chip, macOS version, year)? Intel and
  anything below macOS 14 change the plan (next steps 2–3).
- Real Illustrator on a Mac: does paste work as tested (SVG code setting)?
- Offer the OpenCourant fixes upstream under his name?
- Fast speed-up: OK for volume sums to change results very slightly (not
  visibly) if that's needed for the bigger gain?
- From before: Ctrl+C → Illustrator paste OK (Windows)? Double start-up screen
  seen again? Fold over amount; Min bend default; Steve's patterns.

## Known issues

- Intel Macs (from 1.1.3): Reference / Symmetric run on one thread, never tried on a real Intel Mac.
- 1.1.2 Macs still have the unset-count bug (read as 0 on an M1 in CI, harmless so far); 1.1.3 removes it.
- Mac engine dylibs need macOS 14 / 15 per Homebrew (run on 14.6); older macOS untested.
- Test laptop (Trend Micro Apex One): the Windows starter is held ~50 s each
  time it runs; preparing ahead hides it once the piece has been on Reference
  a few seconds or was run before. IT won't add an exclusion.
- GitHub tag `v1.1.0` build failed (no free minutes) — don't rerun.
- DWG import: desktop only; DWG export not offered (DXF opens in AutoCAD).
- From before: Pebble / star 4 of 960 extreme combinations cross themselves
  (weld check flags them); Specified geometric note past ~½ the narrowest
  width; patterns shading only; STEP has no thickness; Illustrator opens DXFs
  2.83× small; dev launcher shows a console window; GitHub warns about the
  OpenCourant pieces (90 / 75 MB).
