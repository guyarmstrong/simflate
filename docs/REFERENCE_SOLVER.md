# The most accurate simulation to date, and how we replicate it

_Session 9, 2026-10-22. From Guy's research brief (Rev B, in chat) and the
KIT 2017 paper read in full._

## KIT "Die-Less Hydroforming" (Metzger & Ummenhofer, 2014–2026)

The only published end-to-end simulation of exactly Full Blown's process
(their papers cite Full Blown's "Blown Metal" by name): two congruent 1.4301
(304) blanks, TIG face-welded without filler, inflated with no die.
LS-DYNA; checked against real samples (DIC, weld macro-sections).
Metzger's PhD (KIT, Jan 2026, German, open access, DOI 10.5445/IR/1000189900)
holds the flow curve and the full buckling study.

Recipe (2017 European LS-DYNA Conference paper, read in full):
- **Explicit dynamic solver** with time and mass scaling for inflation
  (implicit only for the welding step). Explicit = step through time with
  the real stiffness; buckling, snap-through and self-contact come out
  naturally. (Our Steel solver is static/implicit: the type the brief says
  "struggles with buckling", which is what session 9 measured.)
- 4-node Belytschko-Tsay shells, reduced integration, hourglass control,
  **real thickness** as an element property.
- **Two blanks**: mesh one, duplicate with a small gap d; move all edge nodes
  by t/2 + d/2 so they coincide; **merge** them. That is the seal weld: a
  yielding line. "Simplest solution, very good results."
- **Graded mesh**: fine at the weld and heat-affected zone, coarser inside.
- Material **MAT24** piecewise-linear plasticity from a uniaxial tension
  test (bi-/multi-linear flow curve), not perfect plasticity.
- **Self-contact** (automatic single surface) for wrinkles folding over.
- Load: **AIRBAG_LINEAR_FLUID**, a mass-inflow curve dM/dt; pressure follows
  from volume and bulk modulus (pressure curve also possible).
- Optional: thermo-mechanical weld simulation first (DynaWeld); distortion
  and residual stress carried into the inflation.

Benchmarks with known results:
- **Ring**: outer Ø350 mm, hole Ø35 mm, 0.8 mm 1.4301, welded at both edges.
  Perfect blank: the outer edge goes into circumferential compression ->
  small buckles once critical -> some huge self-contacting wrinkles; the hole
  goes into tension and enlarges a lot, no buckling. With weld residual
  stress: first buckles earlier, spread over a few states, different
  pattern; similar critical compressive stress. Welding distortion: 16 mm
  unclamped, 6.1 mm clamped between aluminium plates (matches real samples).
- **Strip** 965 × 160 mm (2018 paper): <= 0.8 mm buckles in a band along
  the welds, later straightens; 2 mm doesn't; 2 mm round at ~142 bar.

## What the brief showed we had missed (checked this session)

| Brief item | Our state | Measured |
|---|---|---|
| Mylar circle: R/R0 0.763, H/R 1.198 | **fails** | Steel solver 0.994–0.997 / 0.12–0.18; classic 0.96–0.98 / 0.30–0.42 (circle 300, 0.6 mm, p50–70) |
| Teabag square: V/side³ ≈ 0.2055 | low | 0.17–0.20 (Steel solver lowest) |
| Area ratio ≤ 1 in the Geometric band | ok | 1.000–1.010: no rubbery stretch overall; the logged "stretch %" is a local maximum |
| Regime number p·R/(σy·t) | ok | already our normalised pressure: slider 70 = 0.27, 90 = 0.58 (≈3–8 bar for 0.6 mm, 300 mm) |
| Real thickness | partly | real t/size, but Balloon↔Geometric multiplies bending thickness ×0.6–×3, and the mesh bending floor makes thin sheets bend like 0.45–1.5 mm |
| Two independent sheets | ok | top and bottom sheets share only the weld points |
| 304 hardening | knob | `stretch_hardening` (default off) |
| Volume-driven loading | **missing** | pressure-controlled only |
| Weld shrinkage / residual stress | rejected earlier (Guy) | KIT measured ~40 MPa compression and distortion from TIG; worth revisiting with Guy |
| Graded mesh at the seam | **missing** | even lattice |
| Self-contact | **missing** | |
| Explicit dynamic solver | **missing** | classic = XPBD (stiffness not real), Steel = static Newton |

**The core miss.** In the middle pressure band a real sheet is stiff when
pulled and free when squeezed (tension-field theory): squeezed parts crimp at
almost no cost, so the gross shape is set by geometry (Mylar, teabag). A
Mylar circle must shorten its rim ~24 % by crimping. Our weld can't
shorten and our sheet resists squeezing, so the rim stays where it was drawn
and the piece only bulges. That is also why session 9's stability check found
nothing to buckle into.

## Setup on Guy's laptop (session 9) — working

- **OpenCourant** = the community continuation of OpenRadioss (the official
  OpenRadioss GitHub repo is gone). Release `latest-20261011`,
  `OpenCourant_win64.zip`, SHA-256
  `6d0ea8b43b68aa12f0a2787b339384a554978cbb65a5d3dbaf1e40598f02e7e6`
  (matches GitHub's upload digest; built by github-actions). Norton: clean.
  VirusTotal: not on file yet (zip and the four main binaries).
- Installed at `C:\Users\guyke\OpenCourant\OpenCourant` (outside the repo).
- Claude Code needs Guy's allow rule `Bash(*OpenCourant*)` (in the v1
  folder's `.claude/settings.local.json`); call it as one plain command
  (`cmd.exe //c "C:/…/run_x.cmd" nopause`), nothing else chained.
- Environment (see `reference/tests/plate/run_plate.cmd`): `RAD_CFG_PATH`
  = hm_cfg_files, `RAD_H3D_PATH`, `KMP_STACKSIZE=400m`, PATH += hm_reader,
  Intel runtime, h3d libs. `starter_win64.exe -i model.k -np 1`, then
  `engine_win64.exe -i model_0001.rad -nt 4`. Frames `modelA###` ->
  `anim_to_vtk_win64.exe modelA011 > x.vtk` (positions, displacement,
  plastic strain, upper/lower stress tensors).
- LS-DYNA keyword input works. Quirks: MAT24 = exactly 4 cards; pressure
  via `*SET_SEGMENT` + `*LOAD_SEGMENT_SET` (`*LOAD_SHELL_SET` maps to an
  empty surface).
- Proof of life: 300 mm square, 0.8 mm 304 (MAT24 bilinear), edges pinned,
  0 -> 5 bar in 4 ms: normal termination, 900 shells, 2615 cycles,
  3.8 s total, centre deflection 17 mm (fast ramp overshoots; next runs
  ramp slowly and check kinetic energy ~1 % of internal).

## Recommendation: replicate KIT with OpenRadioss as a reference

OpenRadioss (open-source Altair Radioss, AGPL, Windows builds on GitHub
releases) has every ingredient: explicit shells at real thickness,
tabulated elasto-plastic laws, monitored volumes (airbag / LFLUID with
injected mass), self-contact.

1. Install OpenRadioss; run a tiny deck to prove it works on Guy's laptop.
2. `blown-cli` writes a Radioss deck from our outline: graded quad/tri mesh,
   two sheets with merged edge nodes, real t, 304 curve, fluid volume filled
   by mass, self-contact. Results converted back into our `runs/` frames so
   they show in the viewer next to our solvers.
3. Validate: KIT ring (dimensions above), Mylar circle, teabag square, then
   the KIT strip. Don't trust it until the ring's outer edge buckles and the
   hole opens.
4. Run Full Blown shapes (triangle, square, Lyrae, a balloon) and compare
   with the photos.
5. Then decide: (A) OpenRadioss as the app's "Final / Reference" solver
   (offline, minutes per piece; check AGPL terms for bundling), keep the fast
   solver for live preview; or (B) build our own explicit core in Rust
   matched against it; or (C) the brief's two-scale method (tension-field
   gross shape + folds from the compression map) for a fast preview, checked
   against the reference.

Confirmation (classic solver, circle 300, 0.6 mm, p70): making the sheet
nearly free in compression moves it toward the Mylar answer —
R/R0 0.962 -> 0.924 (-> 0.886 with the weld also free to shorten),
H/R 0.42 -> 0.67 (-> 0.81), area ratio 1.00 -> 0.97 (crimping). Exact:
0.763 / 1.198. Runs my-tf-70, my-tf-70w; `scripts/benchmarks.py`.

## In the app (session 10)

Solver -> **Reference** in the desktop app. Flow: the worker meshes the
piece as usual (mesh only, `meshOnly`), `simStore` sends the flat mesh to the
Tauri command `reference_start`; `crates/blown-ref` writes the model
(`blown_core::reference::deck`, identical to `kit_deck.py`), runs starter +
engine in `%LOCALAPPDATA%/app.blownsim.v2/reference/run-N/` (older runs
cleared), converts each finished `modelA###` with `anim_to_vtk` (stdout, then
the binary is deleted), reads the water pressure from `modelT01`
(`read_water_history`: big-endian Fortran records, the airbag's MASS / VOL /
P are the last 48-byte record of each sample) and emits
`reference-frame` / `reference-progress` / `reference-done`.

- **Plan** (`reference::plan`): water up to 0.3 * area^1.5 (over-fills; the
  teabag limit is ~0.2), pumped over 0.12 s * R/175 mm (0.05-0.3 s), 60
  frames, mass scaling to 8e-7 s.
- **Stop at target**: pressure mode = slider -> normalised pressure (same
  curve as the fast solver) read as the regime number p*R/(sigma_y*t), R =
  sqrt(area/pi), sigma_y 215 MPa; height mode = mm. The engine is killed at
  the first frame past the target. Retarget mid-run with the slider.
- Threads: half the logical cores, 2-8. **Don't run two at once** (three at
  once ran ~8x slower each).
- Same path from the command line (for Claude, allowed because the command
  names OpenCourant):
  `blown-cli ref-run runs/<mesh-run> --root <v2 folder> --oc C:/Users/guyke/OpenCourant/OpenCourant --name <run> [--t] [--pressure|--height]`
  -> job in `ref/<run>`, frames in `runs/<run>` (watchable live).
  `blown-cli ref-deck` writes a model only; `ref-water <dir>` prints the
  pressure history.
