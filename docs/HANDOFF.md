# Handoff — Simflate (was BlownSim v2)

_Last updated: 2026-10-27, session 22 (DWG import, Windows 1.1.1 installer)._

**Simflate** lives in this folder (`Sheet Metal Inflation Simulator v2`,
branch `v2-thickness`, port 1430, window "Simflate"). v1 (BlownSim) is
untouched in the sibling folder (branch `main`, tag `v1-character`). Push to
`origin v2-thickness`. Guy opens the app with the desktop shortcut
**Simflate** (runs `Start BlownSim v2.cmd` = `npm run app` = tauri dev).
Guy's reference photos: v1 folder `Refrence images/`.

## Where we are

Version **1.1.1** (package.json; not tagged — tag `v1.1.0` is older and its
GitHub build was refused). Everything is committed and pushed. The share
folder `D:\Gaia\Projects\Stephen Newby\Simflate 1.1 installers\` holds the
**Windows 1.1.1 installer** (built 2026-10-27, includes DWG import; 1.1.0
files deleted), the Windows and Mac install notes, and the prompt Guy used
for Claude Code on his test laptop. **Guy is testing 1.1.1 on the test
laptop**; Windows comes first, the Mac waits until Windows is ready (Guy).

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

1. **Guy's results from the test laptop (1.1.1)**: fix what he finds. He
   was asked to uninstall the old Simflate first, then check: a DWG imports
   (first DWG through the real desktop app: Import dialog and drag-and-drop;
   Pentagonal Nova Cone Hub = 133 × 89 mm, five holes); no firewall boxes;
   Reference starts quickly the 2nd time on the same piece; Task Manager
   shows "Simflate Reference engine" ×4; tool columns fit his short screen.
   Rebuild: `npx tauri build --bundles nsis` (~10 min), copy into Windows\.
   **Slow starter — CAUSE FOUND (2026-10-30):** OpenCourant
   `starter/source/model/sets/fill_igr.F` (commit cb760c2) loops
   `DO I = 1, 10000` twice, `OPEN(... ROOTNAME_NNNN.rad, STATUS='OLD')`
   for every number 0000–9999, looking for engine files with /DT/NODA,
   /DYREL, /H3D… keywords. None exist for our LS-DYNA decks → 20,000 failed
   opens; Trend Micro (tmmon64 hook on NtCreateFile + filter drivers) makes
   each ~1.5 ms → 30–70 s. Found by stack sampling on the test laptop (49/50
   samples in NtCreateFile via tmmon64 from CreateFileA; file names counted
   up 0000→9999 twice). Hashes of our starter / hm_reader / libapr match
   the test laptop's. Fix options put to Guy: rebuild the starter from
   source with the loop stopping at the first missing file (Intel oneAPI,
   free; same patched build needed for the Mac anyway; AGPL → publish the
   patch), or binary-patch the loop count, and report upstream.
   **Edited starter (2026-10-30, Guy chose option 2 then report upstream):**
   the two loop limits are `cmp ebp,2711h` at file offset 0x1A1E89B and
   `cmp r14d,2711h` at 0x1A1F1AF (immediates at 0x1A1E89D / 0x1A1F1B2,
   `11270000` → `03000000`); edited SHA-256 4ce51b4e… Checked here: outputs
   identical (only the 5-byte run stamp at the end of each .rst differs, as
   between two original runs); a planted model_0500.rad crashes the original
   (exit 59) and is ignored by the edited one. **But Norton 360 on Guy's
   laptop holds the unknown edited exe ~21 s at every launch** (the
   original public release isn't held) — any edited or self-built starter
   is "unknown" to AV reputation. Kit for the test laptop in the share
   folder ("Prompt 2 - edited starter.txt"): does Trend hold it too? Only
   if it's a net win there: apply the edit in `scripts/opencourant.mjs`
   unpack (check original bytes → patch → check new hash, keep the
   "already unpacked" check working), note it in SOURCE.md (AGPL), rebuild.
   Upstream issue posted 2026-10-30: OpenCourant/OpenCourant#67 — watch
   for a fix; a fixed official release (known to AV) is the cleanest cure.
   Publisher name stays "Guy Armstrong" (Guy). Signing costs money (no).
2. **Fast on more cores** (on the to-do list; Guy said not now, wait to be
   asked): here 1 thread 45 s, 6 threads 15 s
   (~80 % parallel; only stretch / bend batches use `par.rs`). Make the
   per-point loops (integration, pressure forces, plasticity) parallel —
   no result change; fixed-chunk reductions (volume) change results
   slightly → Guy's call. Also find why the test laptop showed 1–1.5 cores
   (test Fast on a big piece while it's rising; check the installed app runs
   the native solver, not the worker).
3. **Reference engines idle ~25 s** after appearing (they start one by one,
   0 % CPU) — look at Intel MPI start-up. Engines use ~1 core each, not 2;
   pinning made no difference (session 21 benchmarks).
4. **Mac — after Windows is ready**: build on the public copy (above). The
   alternative, if ever needed, is his own Mac:
   **Mac build via Guy's Mac** (all free): Tailscale on the Mac + this
   laptop, Remote Login on the Mac; Guy gives the user name + Tailscale
   name. Then install Xcode CLT (Guy clicks), Homebrew (Guy types password),
   Rust, Node 22; build Simflate (`npx tauri build --target
   universal-apple-darwin`) → `.dmg` to the share folder (Mac\). This
   replaces GitHub for Mac builds.
5. **Reference / Symmetric on the Mac** (Guy needs them there): first check
   whether OpenCourant / OpenRadioss publish macOS (arm64) builds; else build
   OpenCourant from source on the Mac (gfortran + OpenMP; MPI optional — one
   copy many threads, or Open MPI). Then bundle like the Windows copy
   (`scripts/opencourant.mjs` is Windows-only today; `blown-ref` paths and
   exe names are Windows — `exec/*.exe`, `extlib/intelOneAPI_runtime`).
   Rosetta can't help (it only translates Intel Mac programs).

## Resume in 60 seconds

1. Read `CLAUDE.md`, this file, the session 21 entry of `docs/BUILD_LOG.md`,
   DECISIONS → "Session 21". `docs/VERSIONS.md` = versions and releases.
2. Bash PATH: `export PATH="/c/Users/guyke/AppData/Roaming/nvm/v22.20.0:/c/Users/guyke/.cargo/bin:$PATH"`
3. `npm test` (40 Rust tests incl. blown-dwg + type check). **`npm run wasm` after any Rust
   change in crates/.**
4. **Guy's app is `tauri dev` and opens his real project.** Edits under
   `crates/` or `src-tauri/` rebuild and restart his window; `ui/`
   hot-reloads. Own checks: `CARGO_TARGET_DIR=target/check-native`.
5. **UI tests without touching Guy's work:** `npx vite --config
   scripts/vite-isolated.config.mjs --strictPort` (port 1499) + puppeteer-core
   (`…/9f0521ec-…/scratchpad/node_modules/puppeteer-core`, Chrome headless,
   own `userDataDir`). Restart that vite before scripted imports after edits
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
| Reference | Prepared ahead in the background and remembered (`reference-prepared`, 8 newest); engine shipped as "Simflate Reference engine.exe". Windows only. |
| Draft board, solvers, materials, export | As session 20 (Pebble / star, Export outline, Ctrl+C, reproducible re-runs; Fast, Steel, Reference, Symmetric, Specified geometric; KeyShot GLB / OBJ, DAE, STEP, STL, PNG). |

## Open questions for Guy

- Mac access: user name and Tailscale name, when ready.
- Fast speed-up: OK for volume sums to change results very slightly (not
  visibly) if that's needed for the bigger gain?
- From before: Ctrl+C → Illustrator paste OK? Double start-up screen seen
  again? Fold over amount; Min bend default; Steve's patterns.

## Known issues

- Test laptop (Trend Micro Apex One): the starter is held ~50 s each time it
  runs; preparing ahead hides it once the piece has been on Reference a few
  seconds or was run before. IT won't add an exclusion.
- GitHub tag `v1.1.0` build failed (no free minutes) — don't rerun; build the
  current version instead.
- Reference / Symmetric not on Mac yet.
- DWG import: desktop only (the browser preview says "save it as DXF"); DWG export not offered (DXF opens in AutoCAD).
- From before: Pebble / star 4 of 960 extreme combinations cross themselves
  (weld check flags them); Specified geometric note past ~½
  the narrowest width; patterns shading only; STEP has no thickness;
  Illustrator opens DXFs 2.83× small; dev launcher shows a console window;
  GitHub warns about the two OpenCourant pieces (90 / 75 MB).
