# Decisions

Short records of choices that shape the code, and why. Add new ones at the
bottom of their section. If a decision is reversed, strike it through and add
the new one — don't delete history.

## Architecture

- **Rust core, run as WebAssembly in a worker for the live view** (also native
  in the CLI). One solver codebase; the browser preview and the Tauri app behave
  identically; Tauri only does native jobs (Save-as, later .skp). *Session 1.*
- **No wasm-bindgen** — a tiny C-style API (`bs_*`) with JSON in, typed arrays
  out. Fewer tools to install and keep in sync. *Session 1.*
- **DXF/SVG import in TypeScript** (dxf-parser + own SVG path parser) rather
  than Rust, so it can use the browser's SVG transforms. *Session 1.*
- **Viewport takes its data as props** (live run or snapshot), so viewing
  snapshots never disturbs the live inflation. *Session 2.*
- **Snapshots in IndexedDB**, not files — works identically in browser and
  desktop; typed arrays stored directly. Export is separate. *Session 2.*

## Physics

- **Normalised units**: lengths ÷ equivalent radius, forces ÷ yield tension,
  so one tuning works for any size. *Session 1.*
- **Weld points stay on the weld plane, free in-plane** — the outline draws in,
  which is what makes real pieces crease. *Session 1.*
- **Plasticity from solver force (λ/h²), not apparent strain.** Strain-based
  yield ratcheted with solver error and made shape depend on step size
  (circle 117 → 206 mm). Force-based: 108/111/115 mm across 4× step sizes.
  *Session 1.* Do not revert.
- **Character exponent 1.6** on the pressure–thickness scaling to separate
  Balloon and Geometric clearly. *Session 1.*
- **Fixed outline = free inflation + harmonic warp of the weld onto the drawn
  outline.** ~~Pinning weld points~~ starved height (inextensible sheet with a
  fixed edge can't rise). *Session 2.*
- **Bending floor tied to mesh size, plastic moment kept physical.** Folds span
  several triangles; flooring stiffness alone made draft pieces stiffer
  (112 → 66 mm). *Session 2.*

- **Clean triangle row along every weld** (Guy's idea): a point over the
  middle of each weld segment, both sides. Irregular fans touching the weld at
  one corner crushed into one-triangle teeth. *Session 3.*
- **Never let the mesher split along a weld** (edges between weld points whose
  midpoint lies on a weld are left alone) — that produced needle fans that
  tore. Interior on a jittered lattice; refiner keeps weld edges. *Session 3.*
- **Weld straightness** constraint (in-plane, consecutive weld points): welds
  zig-zagged at mesh scale and let the sheet run away. *Session 3.*
- **Fine wrinkles are not solved directly.** A 10× finer mesh went unstable
  and is far too slow; the solve gives the form, the finisher adds pleats where
  the solve measures squeeze along a weld. *Session 3.*
- **Stiff welded corners** — where a weld turns to an inside angle under
  100°, seam points on both sides within `corner_reach` (0.4 of the equivalent
  radius, full for tips ≤ 60°, fading to nothing at 100°) are tied together
  across the corner by in-plane links whose stiffness fades with distance from
  the tip. The doubled, welded tip then keeps its drawn shape and stays low
  instead of bowing in to a needle and spiking up (Guy's photos). Square
  corners are left nearly free so they still pucker. Chosen over
  width-dependent bending as the smallest change; revisit if tips still look
  wrong on real pieces. *Session 5.*
- **Soft start + tapered starting bump** — the first frames get extra damping
  (0.15 → 0.025 over 12 frames) and the seeded starting bump fades to zero
  over 0.15 R from every weld. Before, the bump stepped straight up from the
  weld; on Final meshes that kink snapped and rang, and force-based
  plasticity read the ringing as yielding (17 % stretch while flat), which
  later showed as crumpled patches — worst in Target-height mode, which lowers
  pressure to brake. Draft runs were barely affected (suite heights unchanged);
  Medium/Final triangles lost a few mm of spurious height. *Session 5.*

- **Two solver cores (session 8).** Core 0 = XPBD (default, fast, soft:
  λ restarts every substep and gets one pass, so the sheet is ~25× softer
  in-plane than set — the rim squashes instead of buckling). Core B =
  quasi-static projected Newton per frame (`solver/statics.rs`, app switch
  *Steel solver*): minimise stretch + bending − p·V + a small pull to the
  last frame; sparse Cholesky (faer), symbolic analysis kept, factorisation
  reused ≤ 5 frames; plastic set from the exact equilibrium forces (still
  force-based). Chosen over warm-starting XPBD (tension/bend warm start ran
  away) and strain limiting (bookkeeping broke, burst). Core B is as fast as
  core 0 and stable on Final. Soap always uses core 0.
- **No clock calls in the solver path** — `std::time::Instant` panics in the
  app's WebAssembly (session 8 crash).
- **Seam hinge (session 8, Guy):** a hinge across every outline weld edge
  between the top and bottom triangle, rest = the closed starting angle,
  plastic moment ×4 the sheet's (bead ≈ two sheets thick). Before it the
  sheets met at a free hinge. Off by default (app *Seam stiffness*); with it
  on, the seam may move up/down (`weld_free_z`).
- **Weld shrink is not physics** (Guy: a seam welded all round two stacked
  sheets cannot shrink). `weld_shrink` stays as an experiment knob, default
  0; don't use it for the look.
- **Experiment knobs stay in `Tuning` with default off** and a TUNING_LOG
  entry (session 8: weld_passes, weld_kink_yield, weld_seed,
  stretch_hardening, squash_limit, warm_start*, fold_moment_real,
  static_kick, weld_shrink). Remove them once a direction is settled.
- **Tip stiffness reach 0.25** (was 0.4): inflation runs ~4 mm further
  toward a triangle's tip (Guy). *Session 8.*
- **Gross shape is judged against exact answers first** (`scripts/benchmarks.py`):
  Mylar circle R/R0 0.763, H/R 1.198; teabag square V ≈ 0.2055·side³; area
  ratio ≤ 1 below yield. Both app solvers fail (session 9), because the rim
  can't crimp: a real sheet is stiff when pulled and free when squeezed.
  Fold-tuning on top of a wrong gross shape is wasted. *Session 9.*
- **Reference solver = OpenCourant copying KIT's Die-Less Hydroforming
  recipe** (explicit shells at real thickness, two sheets merged at the
  weld, 304 curve, self-contact, fluid pumped in). It is the yardstick the
  fast solver is tuned to, and an offline "Reference" choice in the app.
  OpenCourant = community continuation of OpenRadioss (AGPL; runs as a
  separate program, installed outside the repo). *Session 9.*
- Session 9 knobs (default off): `mode_seed*` (buckling-mode seeding),
  `compressive_yield`, `plastic_tangent`. They showed the pillow is a
  stable equilibrium; keep until the reference settles the direction.

## Finisher

- **Pre-smooth on the coarse mesh, then subdivide, then a light smooth.**
  Smoothing only after subdivision can't reach triangle-sized bumps. Sharp:
  weld seam, seam lines, folds > 50° (pre-smooth protects > 75°). *Session 2.*
- **Edge ripples from measured squeeze**: amplitude A = λ/π·√(squeeze)
  (inextensible pleat), λ = 3·√(R·t), zero at the weld, ~1 λ falloff, faded at
  junctions. Render-only, so the slider re-smooths without re-solving.
  *Session 3.*
- **Folds touching a weld point aren't kept sharp** (they're teeth, not
  creases). *Session 3.*
- **Ridge sharpening (session 8, app *Ridges*, default 0):** on the solve
  mesh, edges bending ≥ 10° and at least as much as the four edges across
  the fold, in runs ≥ 60 mm, are pinned; the sheet 1–4 rings either side is
  relaxed flat (plain Laplacian), then the ridges stay sharp through
  smoothing and subdivision. It only sharpens folds the solve made; it
  can't create tucks. Chosen (Guy) before a new solver core.
- **Weld points duplicated per sheet in the render mesh** for a crisp seam;
  OBJ writes shared positions so the solid stays watertight. *Session 1.*

## UI (Guy's direction — keep)

- Near-black workspace, light linework, Lucide icons. *Session 1.*
- Illustrator-style primitives; dimensions = axis-aligned box from the furthest
  points, always horizontal/vertical; typing a size scales to exactly it
  (padlock = even scaling). *Session 1.*
- Mode switch with icons and sliding highlight; looks palette on the left of the
  3D views; snapshots in the third tab. *Session 2.*
- Mesh as three named steps (Draft/Medium/Final) rather than a slider. *Session 2.*
- Shape sidebar = materials sidebar width, labelled icons; Inflate icon a
  pressure gauge. *Session 3.*
- Iridescent = two-tone beetle shimmer (view-angle), not oil-slick. Colour
  picking in a flyout with a large square. *Session 3.*
- Weld lines + Weld/Construction (SolidWorks-style); imports as groups.
  *Session 3.*
- Thickness stays inside Character (shown as mm), not a second slider.
  *Session 3.*
- Projects are `.blownsim` JSON; revisions are "Save as next revision"
  (Name Rev B.blownsim). Exports stay separate. *Session 3.*
- **Line types: Outline / Weld line / Construction** per shape (`role`;
  old `construction: true` still read). A closed *weld* loop is a seam sent
  to the mesher as a polyline returning to its start — welded round, not a
  cut-out. Imported lines remember their file layer+colour (`src`); a
  multi-source import opens the Line types dialog (Outline / Weld / Construction
  / Leave out per source). File colours appear only as swatches there, never on
  the board. Guesses: remembered choice → layer name → biggest loop = outline,
  rest = weld. *Session 4.*
- Chain joining only within one layer/colour; where 3+ ends meet, ends pair by
  straightest continuation, so a weld touching the outline never merges into
  it. *Session 4.*
- Clicking inside an *unselected imported* outline starts a selection box
  (to pick weld lines inside it); drawn shapes keep click-inside-to-grab.
  *Session 4.*
- **TIG weld look is a shader band, not geometry**: each point carries its
  flat-pattern distance to the outline/holes (`viewer/tigBand.ts`, from the
  UVs); the metal and beetle shaders colour a band (`tigFragment` in
  `materials.ts`). Bare finishes → bead + heat-tint ramp (~0–7 mm; bead < 1 mm);
  coated finishes → bare polished seam (~1.5–3 mm) and iridescence off there.
  Weld zone has its own surface (Guy): bead rough 0.45–0.7, partly
  non-metallic oxide (0.2) and shaded as if in the seam crease; oxide halo
  hazy (0.24 → 0.09); no clear-coat, less grain. Interior laser seams
  excluded. Switch lives in the materials palette
  (Guy). Not yet in OBJ export. *Session 4.*
- **Brushed grain** = generated line texture (one row per brush line) used as
  roughness map (no bump — sub-pixel grooves bumped into fake dimples), in flat-pattern UV space, with three.js anisotropy
  turned to match; meshes get `computeTangents()` (live mesh each frame while
  Brushed) — without tangents three.js derives them per triangle and the
  finish shows the polygons. Anisotropy 0.35, not 0.85: strong anisotropy
  magnified small grain-direction twists into dimples (checked by toggling).
  Heat-tint pattern = film-thickness map repeat
  (size), offset (position) and thickness range (colour range). Settings in
  `finishOpts`, saved with the project. *Session 4.*
- **Top bar like a desktop app** (Guy): logo · **File** · **Edit** · undo/redo ·
  project name at the top left; mode switch centre; **Export** alone at the
  right (the hand-off). *Session 4.*
- **Creases view scales to each piece's own range** (2nd–99th percentile,
  Guy's suggestion) and snapshots now store the crease field; snapshots
  without it fall back to fold sharpness measured from the shape (max
  dihedral angle per point, welded rim ignored). *Session 4.*
- **Brushed grain is low-contrast** (roughness map 0.88–1.0, base 0.36):
  high contrast read as deep scratches / harsh streaks. *Session 4.*
- **Weld detail v2** (Guy: "90s video game"): points also carry `tigS`
  (mm along the weld). Bead = height field (dome + gentle crescent ripples
  every ~1.6 mm, k = 0.18 — stronger curvature closed ripples into ovals)
  bump-shaded from screen derivatives, faded out before it can alias. Oxide
  zone = painted colours + three.js thin film (IOR 2.3, ~120 nm at the bead
  thinning to ~15 nm) for the angle shimmer; the bead's film is weak and even
  (varying it drew oil rings). Seam fillet = shading: within the Weld fillet
  radius the normal rolls round to face straight outward, so the edge glints.
  Real fillet geometry still open (finisher). *Session 4.*
- **Weld fillet is real geometry, and only adds metal** (finisher, last
  step). On the TIG seam (welded edges between the two sheets — outline and
  holes; internal laser welds stay sharp) the weld points never move, so the
  outline is unchanged. `fillet_steps` (5) rows of points are added on every
  edge running off the seam, out to reach s, and each point within s is
  lifted off its sheet along the sheet's outward normal by
  h = cot(θ/2)·d·(1 − d/s)³ — both sheets turn to meet the weld square-on.
  Nose radius = s / (6 cos sin²(θ/2)), so s = 6 r cos sin²(θ/2) (capped at
  `fillet_max_reach` radii). Fades to nothing within 5 r of outline corners
  sharper than 35° and weld junctions. First version was a rolling-ball
  fillet inside the wedge: it pulled the seam in and ate sharp tips (Guy: the
  fillet must never change the boundary). The viewer shares one normal
  across the seam and switches off the shaded fillet on the smooth mesh; the
  raw mesh and old snapshots still shade it. Weld texture is not exported
  (Guy: not needed for now). *Session 6.*
- **Pressure slider is curved** (`pressure_curve` = 3: normalised p ∝
  (slider/100)³). A flat pillow gains most of its height at low pressure
  (inextensible-pillow geometry), so a straight scale put nearly all the
  change in the first 15 %. Presets / CLI suite converted (new = 100·(old/100)^⅓);
  settings carry `pressureCurve: 3`, older files are converted on load
  (`upgradeSettings`). Readout is shown back on the slider scale. *Session 4.*
- **Height mode is a controller, not a ramp**: each frame the pressure is
  nudged so the rise speed matches a wanted speed that shrinks with the gap
  (`height_approach`, `height_max_rate`, `height_gain`), and it may drop to
  brake. Ramp-and-freeze overshot massively (20 mm target → 127 mm) because
  the shape lags and creeps at constant pressure. Now 20 → 19.6, 60 → 61,
  110 → 110. *Session 4.*
- Not done: work hardening. Stretch stays small (≤ 8 %) at full pressure, so
  it barely matters yet; revisit if pressures go higher. *Session 4.*
- **Solver drop-down** (Guy, session 9): Inflate panel → Solver lists every
  solver we build — Fast (classic XPBD), Steel (experimental), Reference
  (OpenRadioss/OpenCourant copy of KIT's method, minutes per piece; listed
  but disabled until it works). Purpose: compare solvers side by side, and
  use the accurate slow one only where a shape needs it. Setting `solver`
  replaces the old `steelSolver` switch; older files are upgraded on load.
  Solver sits at the very top of the Inflate panel (it decides what the
  other settings mean).
- **Standard slider row** (Guy, session 9): every slider is `SliderField` —
  the bar with a box to type the exact value on the same row, the two end
  labels under the bar; the value is not repeated in the heading. Panel
  kept compact: one-line descriptions in 11 px, no gap under heading-only
  rows.

## Rendering (Snapshots → Render image)

- **Studios are what the metal reflects**, not lamps: polished steel is a
  mirror, so each studio is a baked environment of glowing panels (soft
  boxes, strips, black cards) on a graded dome, or a photographed room.
  Lights on a flat-ish piece seen from the usual raised view must sit
  *behind and above* it (that's where its top reflects) plus overhead and a
  broad front panel; front-only lights left Noir/Slate black. Tuned by eye
  against Guy's Full Blown photos (gold disc on black, heart on slate).
- **Light angle/height rebuild the environment** (PMREM from the studio
  scene, ~instant) rather than rotating the env map, so Z-up and cube-map
  conventions can't flip it. Studio is world-fixed, like a real studio: you
  move the camera through it.
- **PBR Neutral tone mapping in the studios** (ACES stays for the everyday
  viewer): ACES greyed and desaturated gold highlights.
- **No cameras**: Render draws the current view at the chosen size, keeping
  the view's width when the picture is wider.
- **Preview vs Render (like KeyShot)**, Guy: the viewport is a quick preview
  (lighting 256/face, normal pixel ratio). Render rebuilds the lighting at
  1024/face, then draws 3× supersampled in tiles (`setViewOffset`, ≤ 2048 px
  each) shrunk into the picture, with a progress bar and Cancel; the canvas
  is frozen behind a still of the preview meanwhile. The studio gradient is
  painted once on the picture (per tile it would restart).
- **Idle full quality**, Guy: in render mode, after 1.2 s with no input, one
  frame at full lighting and 2× pixel ratio is drawn and *held* (the loop
  stops drawing), so idle costs nothing. Any pointer-down / drag / wheel /
  key, a resize, or any re-render of the viewer (playback, settings) drops
  back instantly. Never runs outside render mode (live solving untouched).
- **HDRIs are CC0 from Poly Haven** (`ui/public/studio/`: photo_studio_loft_hall,
  forest_slope), 1k — enough for reflections, ~1.5 MB each.
- **Your own HDRIs** (Import HDRI, several at once): .hdr / .exr / .jpg-.png
  panorama, kept in IndexedDB (`blownsim-render`) so they survive restarts;
  each is a studio like the others (`hdri:<id>`), not a separate mode.
- **Crisp reflections**: the environment map is 1024 px per face (was 256,
  which blurred every edge on a mirror); Loft/Garden are the 2k HDRIs.
  **Light edges** slider: below the middle sharpens the panels' edges
  (soft boxes become hard-edged); above it blurs the whole studio (PMREM
  sigma), so it works on strips and HDRIs too. Two hard studios (*Strips*,
  *Edge*) because too many softboxes made pieces look fuzzy (Guy).
- **Studio picker**: dropdown with chrome-ball previews (rendered once in a
  small offscreen renderer, cached), ◀ ▶ and `[` `]` to step through, since
  chips don't scale to many HDRIs.
- Lives on branch `renders` (worktree folder `Sheet Metal Inflation Simulator renders`)
  touching only the viewer, Snapshots panel and new files, so it merges into
  both v1 `main` and v2 `v2-thickness`. *Session 6.*

## Tooling (session 8)

- **Installers build on request only** (`gh workflow run build.yml --ref
  v2-thickness`, or a `v*` tag) to save GitHub Actions minutes — macOS
  counts 10×. Tests run locally (`npm test`) before every push.
- **Backups are tags** `backup/…` (not `v…`, which would start a build).
- **Inter** is bundled (`@fontsource-variable/inter`) so the app looks the
  same offline; digits are tabular everywhere.

## Reference solver (session 10)

- **OpenCourant runs outside the app, driven by the desktop shell** (not
  bundled, not in WebAssembly): AGPL, Windows binaries, minutes per piece.
  Browser preview can't use it.
- **Water pumped by mass, stopped at the target** rather than a pressure
  load: KIT's recipe, stable through snap-through, and it's what the
  workshop does (pump until it looks right).
- **Deck writer and readers in Rust** (`blown_core::reference`,
  `crates/blown-ref`) so the app needs no Python; `reference/kit_deck.py`
  and `to_run.py` stay as the checked originals (the Rust deck is
  byte-identical).

## Snapshots (session 10, Guy)

- **Snapshots belong to their project file**; the app keeps only **Recent =
  the last 50 taken** (a count, not an age: you still see your last ones
  after time away). Older ones leave Recent and are deleted unless they're
  in the open project.
- **Files carry no smooth mesh** (2-8 MB each): a second solver worker
  re-meshes the snapshot's outline with its settings (deterministic, point
  counts checked) and runs the finisher on opening; the result is cached on
  this computer. Raw snapshot ~0.5 MB in the file.
- **Two distinct actions**: Apply settings (shape stays, no question) and
  Restore shape + settings (replaces the board, asks Save first / Replace /
  Cancel when unsaved, undoable).

## Session 10 (Guy's UI calls and reference findings)

- **Settings the chosen solver doesn't use are hidden**, not greyed
  (no scrolling past dead controls). Descriptions fit on one line.
- **The solver picker is the most prominent control** (it decides the
  panel), with an info bubble crediting where each solver comes from.
- **Inflate by Pressure / Target height use the same slider row**, so the
  panel never moves when switching; timeline readings have fixed slots.
- **Snapshots carry their finish** (look, PVD colour, finish options).
- **The first Save of each app session asks where**: the project path
  survives restarts, so a plain Save could silently replace an old file.
- **Reference sheets get a smooth random unevenness** (sum of plane waves,
  wavelengths 1/8-1/2 of the size, different per sheet, seeded): a
  perfectly flat symmetric model doesn't pick where to buckle. 0.5 mm on
  a 0.8 mm, 300 mm square gives the photo's mid-side tucks; 1 mm is lumpy.
  Still off by default in the app until the triangle and leaf agree.


## Session 11 (Draft overhaul, exports, packaging)

- **Names: Draft / Inflate / Forms.** Internal ids stay `shape` /
  `snapshots` (stored data and code); only the words changed.
- **Unequal triangle editing rules:** a triangle has three free numbers,
  so typing one moves something else. Angle at a corner = hinge (that
  corner's two side lengths kept); side length = far corner slides along
  the side (angle at the near corner kept); side AB keeps its direction so
  the triangle never spins while typing.
- **Pill radius is real mm** (not scaled by the matrix): stretching keeps
  round corners; a full-round pill becomes a rounded rectangle when made
  taller, unless the radius is raised.
- **Text height = capital height** (font's cap height, else the H glyph),
  so an "A" is exactly the typed height. Letters only scale evenly. Each
  letter is a separate piece; holes are welded cut-outs.
- **Fonts are read natively** (name/OS-2 tables only for the list; whole
  file only for the chosen face) rather than by a JS font library: handles
  .ttc collections and stays fast over hundreds of fonts.
- **KeyShot export = GLB with baked maps**, not KeyShot's own material
  format (undocumented). The weld/finish recipe is evaluated in flat-UV
  space so the maps match the viewer. Parts are split (sheets vs TIG weld
  zone, 12 mm) so a KeyShot library metal can go on the sheets. KeyShot's
  OBJ import historically ignores bump maps: the OBJ is a fallback.
- **STEP = faceted solid from the solver mesh** (not NURBS): exact to the
  simulated shape, opens as a solid; the smooth mesh would be too heavy.
- **Reference solver ships inside the Windows installer from the tested
  copy** (Guy: never fetch a package that could change). Only the parts
  BlownSim runs; checksummed pieces in git (<100 MB each, no LFS so CI
  checkout doesn't use LFS bandwidth); verified on every build. AGPL:
  licence text and a source note (exact release and commit) ship with it.
  macOS has no Reference solver (OpenCourant is Windows-only here).
- **Aspect lock = chain link** (Adobe): on the board just off the
  selection's bottom-right corner, between the dimensions (which moved out
  to 44 px), and in the top bar.

## Session 12 (pen, shape builder, clipboard, files)

- **Pen shapes keep their anchors** (kind `pen`, Bézier handles in local
  space, flattened for meshing), so point editing can come later; the
  matrix scales them like any shape. Freehand strokes are simplified
  (Douglas–Peucker) then smoothed (Catmull-Rom → Bézier); turns over 70°
  stay corners.
- **Shape builder = Illustrator's model**: the selected outlines (or all)
  are cut into regions with **polygon-clipping**; merged regions become one
  shape, untouched regions of affected shapes become their own shapes,
  shapes that overlap nothing stay as they were. Results are kind `path`
  (fixed, like an import) as Guy asked.
- **Paste reads the Windows clipboard natively** (clipboard-win): the web
  view can't see Word's `image/svg+xml` format. Illustrator's SVG has no
  size and counts in points; it's recognised by Illustrator's own formats
  on the clipboard and given a size in pt. Pasted shapes go through the SVG
  importer (same groups, Line types window) and land mid-view, like
  Illustrator. BlownSim's own copies are marked JSON text.
- **Recent projects**: paths on the desktop (read back by `read_project`,
  .blownsim only); the browser keeps a copy of each project instead.
- **Quick export PNG replaces the Export menu** (Guy); the full exports
  moved into File so a live inflation can still be exported without saving
  a form.
- **PVD variation is a thin film** over the colour (the same film map as
  heat tint, own size / position / strength), always on for PVD — before,
  it appeared only when Welds was on, by accident of the weld shader.

## Session 13 (speed, GPU, Illustrator)

- **Live GPU switching — wanted, later (Guy, 2026-10-24).** Guy wants to
  flip Built-in | GPU while BlownSim keeps running, like KeyShot. Not
  possible with today's view: WebView2 picks its graphics chip once at
  start-up (`--force_high_performance_gpu`, src-tauri/src/gpu.rs), so the
  switch saves the choice and applies it on restart. The way to do it live:
  move the 3D view to WebGPU (three.js WebGPURenderer), which can ask for
  the high-performance adapter at any time, and port the finish shaders
  (materials.ts, GLSL) to it. Shelved, not dropped: do it when the view is
  next reworked.
- Illustrator's clipboard SVG is in points whatever the document's ruler
  units (tested: same 195.35 × 293.23 pt with rulers in pt and in mm), so
  the document's units never change a paste. But Illustrator opens DXFs
  reading each unit as a point (even at "1 mm = 1 unit"), so a DXF opened
  there is 2.83× small. Hence Edit → **Illustrator pastes: real size | DXF
  mm (×2.83)**, remembered, switchable from each paste's message.
- Fast solver on several cores: colour batches + a fixed thread team
  (blown-core solver/par.rs), same result on any core count and in the
  browser. 6 threads default (best on the i7-12700H). Steel stays single
  threaded (its triangular solves dominate; faer threads gained ~7 %).
- Steel on several cores only where the result stays bit-identical:
  assembly in the colour batches (each matrix entry gets its additions in
  the same order) and per-item energies summed in order. Factor + solve
  stay single-threaded for now (faer's threads: +7 % at 6, half speed at 20).
- Reference: 4 MPI copies × 2 threads (`mpiexec -localonly`), measured best
  of 1×12 / 2×4 / 4×2 / 6×1 / 6×2 / 8×1 on the leaf. Differs from one copy
  by summing order only (same height, folds can shift a little) — accepted
  as "same piece" by eye. Falls back to one copy without the MPI engine.
- Fast / Steel run natively in the desktop app (src-tauri native.rs); the
  WebAssembly worker stays for the browser, the finisher, and Reference's
  meshing. Raw bytes over a Tauri Channel (JSON was too big per frame).
- Mesher: welds respaced to the mesh spacing with corners / ends / junctions
  held. Never keep the drawn points as they come: splines arrive as
  thousands of tiny steps and tear the sheet on every solver.
- Height mode settles only once the target is reached or the pressure is
  full (a pause while the controller still pumps isn't the end).
- The 3D view draws on demand (camera moved or something shown changed,
  plus a 4 fps safety tick); it used to draw every screen refresh.



## Session 14 (Reference speed, exports, robustness, thickness)

- Reference pumps over 2/3 of the old time (KE/IE ≈ 3 %, under ~5 %);
  single-precision engine by default (same piece to 0.01 mm). The installer
  ships only the SP MPI starter + engine; one copy runs via mpiexec -n 1.
- Reference engines are stopped by name (all variants) whenever a run
  starts, the app exits or restarts: only one run exists at a time, so any
  engine still alive is an orphan. Run folders carry the app's pid.
- OpenCourant paths are made plain (no `\\?\`): its Fortran can't read them.
- Steel factor/solve swap: not now. PARDISO would be ~1.6× on Final but is
  Windows-only and needs MKL's CNR mode for determinism; my own ND ordering
  didn't beat AMD. Revisit with real METIS or PARDISO + CNR if wanted.
- Thickness is a finisher step (render / export geometry), not a solver
  change: sheets offset out by t, seam split ±t vertically (outline fixed),
  rim strip 2t. Solvers already use t for stiffness; STEP (solver mesh) is
  still thin.
- The worker's finisher must always hold the live run's piece + settings
  (`prepare` on native runs): anything it reads from settings was silently
  stale on native Fast / Steel.
- SketchUp: COLLADA 1.4.1, one geometry, triangles per material, mm, Z up.
  SketchUp slows above ~150k faces → offer a meshoptimizer reduce to ~100k.
- UI: `.app` grid column `minmax(0, 1fr)`; bars shrink in steps (media +
  container queries) rather than ever widening the window.
- Symmetric solver (agreed with Guy, being built): mesh one wedge of a
  dihedral-symmetric outline and mirror it; Reference solves the wedge
  only, with mirror-plane SPCs in local `*DEFINE_COORDINATE_SYSTEM`s
  (OpenCourant reads them), water scaled by 1/(2n); frames unfolded to the
  full piece. Symmetry alone makes edges identical, not even → also seed
  edge waves ("Waves per edge").

## Session 15 (thickness edge, TIG pulses)

- Thickness push near the seam blends from straight up / down (at the weld,
  so the outline doesn't move) to the sheet's own normal across a band
  (fillet reach, or 3t without a fillet). Pushing every point along its
  normal folded the sideways-facing fillet rows out past the cut edge.
- Where the sheets reach the seam lying flat (tips; the fillet fades out
  there), the cut edge is a half-round nose of radius t · flatness that
  stands **proud of the outline by up to t**. Keeping the nose inside the
  outline (stepping the sheets in) collided at sharp tips and puckered the
  point. This is the one place the outline moves (render / export only).
- "Show at the edges" (thickness) is a look-only switch: passed to
  `bs_finish`, re-smooths without re-solving; exports follow it.
- TIG pulses: one fixed spacing (`TIG_PITCH` 1.6 mm in `tigBand.ts`, also
  used by the bake shader), no noise on the spacing, crescent from the plain
  distance (not the heat-wandered one), each loop stretched by a hair to a
  whole number of pulses, fade before ~5 px per pulse. Guy asked for even
  spacing; colours unchanged.
- Dev builds put the 3D view on `window.__view3d` (camera, controls,
  `dirty`) so test scripts can frame close-ups.

## Session 16 (Symmetric and Specified geometric)

- Symmetric: the mesh is symmetric by construction (one wedge triangulated,
  copied 2n times, points merged on a grid; weld = drawn outline only).
  Reference re-detects the symmetry from the mesh itself (exact test on
  every point, per sheet) rather than having it passed through the UI.
  Round outlines (pass 11 and 12) are solved as a quarter so the wave count
  isn't forced. One outline, no cut-outs or weld lines, for now.
- Mirror planes in the deck: local frame with x = plane normal, SPC dofx,
  dofry, dofrz; centre nodes SPC x, y, rx, ry, rz in the global frame (not in
  two skews). Planes pass through the origin, so the airbag's volume of the
  open slice is exact (checked ×8).
- Small models (< 2500 points) on one engine copy × 2 threads.
- Edge waves are a z seed laid on the whole piece (cos 2πk·s/L under a
  sin(π·s/L) window: zero at corners, symmetric about each edge's middle),
  then sliced. Seed height 2t (≥ 0.3 mm).
- Specified geometric is a construction, not physics (Guy's option C): dome =
  blend of membrane (∇²u = −1) and distance-from-weld (ridges on the medial
  axis) by Balloon ↔ Geometric; draw-in = 0.75 × metal taken up by the dome's
  deepest section, ×(1 + 2·tuck) at tucks, fading to the middle; tucks are
  tents across the edge (crease at the middle) with a groove a third of the
  tuck spacing deep. Height exact (target, or 0.7 × inscribed radius ×
  pressure/100). First tuning against image1.JPG (square, one tuck per edge).
- Tucks v2 (Guy's photos): a tuck delays the rise from the weld (u − τ),
  it doesn't scale the height; cos² across, `tuck_width` of the spacing,
  envelope sin(π·centre)^(3·corner_fade); count = round(n·(L/300 mm)^β).
- Symmetric mesh: cut lines are not welds (`triangulate_cut`), lattice
  aligned through the centre, cut-line points at the lattice step.
- Inflate panel: one row per setting, descriptions in a hover ⓘ, settings
  a solver ignores hidden; goal no scroll at full-screen desktop (Guy).
- Symmetric with weld lines / cut-outs: the whole piece (outline, cut-outs,
  welds) must map onto itself; if the welds are less symmetric than the
  outline, use the largest subgroup that fits. Welds are clipped into the
  slice; a weld lying on a mirror line is meshed as a weld (welded mirror
  edge, SPC'd like any mirror node). A cut-out round the centre replaces the
  slice's centre point (or its mirror edge, n = 1) with its arc; cut-outs
  crossing a mirror line elsewhere are refused.
- Specified geometric tuck valleys are capped (reach ≤ 0.8 × inscribed
  radius, τ ≤ 0.35) and the height is fixed on the dome before tucks: an
  uncapped wide tuck flattened the dome and renormalising made spikes.
- GPU switch lives in the 3D view bar beside Smooth (Guy).

## Session 18 (HDRIs, materials in three layers)

- **Fourteen photographed places**, all CC0 Poly Haven 2k `.hdr` (crisp
  mirror reflections; 1k blurred edges). Chosen for natural light and
  recognisable rooms/gardens (Guy: "like an actual room or a nice outside
  area"). Shipped in `ui/public/studio/`, not downloaded later (ship tested
  copies). Credits in `ui/public/studio/CREDITS.txt`.
- **Studio list grouped** (Studios / Rooms / Outdoors / Yours) — 21+ entries
  need headings. `hdriPower` per place tuned by eye so a polished top face
  isn't burnt out.
- **Finish balls are rendered, not CSS** (Guy: "more like KeyShot"): the
  viewer's own `applyLook` material on a sphere, Loft HDRI (the plain studio
  left a flat grey patch on polished). Analysis looks keep CSS swatches.
- **Finish x Colour x Pattern** (Guy): the four finishes stay as quick-pick
  balls; PVD / Iridescent / Heat tint are coats over any finish (three
  squares); one Pattern selector. Same number of buttons + 1.
- **Patterns are procedural height fields, not photos**: crisp, seamless,
  real millimetres, drawn on the flat sheet (UV x span) so they stretch with
  the metal like a pressed sheet. Shading is a screen-space bump (no
  tangents), with the slope taken from the pattern itself (the 2x2-pixel
  derivative stair-stepped); faded out when a repeat is under ~4 px.
  Depth = 12 % of the repeat at 100 %. **Never affects the physics** (Guy).
- **Polished tops**: parts above the Colour line (default 20 % of the depth,
  so a whole bump takes the tone, as on the catalogue sheets) become bright bare steel,
  roughness 0.05, coat/grain removed there — the two-tone catalogue sheets.
- **Powder and Candy are colour squares** (Guy: same result, keeps the
  grid). Powder hides the finish anyway; Candy needs the finish under it.
  Both go on after welding: the weld shows as a painted ridge.
- **Clay dropped** (Guy: not needed). `knownLook()` maps unknown saved looks
  to Polished.
- **Coat and pattern live in `finishOpts`**, not new store fields: projects,
  autosave, forms and exports already carry it, and `{...DEFAULT, ...saved}`
  fills new keys. `migrateFinish()` turns old PVD / Iridescent / Heat looks
  into Polished + coat at every restore point (autosave, project, form).
- **Silver square = no colour** (Guy): one click back; no "No colour" button.
- **Weld modes**: 0 bare (as welded), 1 bare seam through a coat made before
  welding (PVD, heat tint, iridescent), 2 painted over after welding (powder,
  candy: the bead's ridge only, in the paint colour).
- **Candy in the export** bakes its face-on colour (a texture can't deepen
  with the view angle); KeyShot's own candy material is the way to match it.
- **Clamp blurred / summed fields before `powf`** in the solver: a running
  box-sum leaves ~-1e-17, `powf` of a negative is NaN, and `f64::min(NaN, x)`
  returns x — the taper bug turned "no tuck" into the deepest valley.
- **Render placement follows `meshVersion`**: re-opening the same form makes
  a fresh empty geometry with the same frame array, so effects keyed only
  on the frame never refill it.

## Session 17 (Specified geometric tucks, Render position and shadows)

- Pill (Side wall) is an arc-length construction, not a height map: each
  point goes as far along a stadium section (straight up, quarter circle,
  crowned top) as it was from the weld when flat; the weld draws in by
  exactly the metal the section uses, so the middle stays put. A height map
  squeezed the wall into a ring by the weld (stretched triangles, leaning
  wall). Blended with the pillow by the slider. Meant for round outlines.
- Tucks in mm (width, length, valley depth) — Guy found the share-of-spacing
  sliders unreadable. Older forms keep their shares (`Option` = None) and the
  panel converts them once on their outline's median side; exact for equal
  sides, approximate otherwise.
- The weld wave of a tuck fades with the tuck's own length; only the even
  draw-in fades over the whole radius (otherwise scallops ran up a pill's
  wall and drew lines across the top).
- Balloon tucks: the per-edge tuck pattern is blurred (3 box passes,
  σ = 0.35·(1 − shape)·width, peaks kept) before it shapes weld and valley —
  isolated cos² bumps notched the weld with ~5 mm fillets. Geometric tucks
  are a rounded V (not a flat floor) and are not blurred.
- Corners are stiff: no draw-in for 2·√(thickness·side) from each corner,
  then sin(π·x) (was √sin from the corner). Nearest-side switching on the
  corner bisectors is blended over a 4-ring band (sideways shift and tuck
  depth only; Character's ridges kept).
- Taper narrows the profile by a growing power (width ∝ √(1 − taper·q)) and
  holds depth to 70 % of the length — keeps the blurred pattern usable.
- X fine mesh (36 000 points a sheet) only for Specified geometric (it is a
  construction, a few seconds); other solvers run 'xfine' as 'final'. A tuck
  needs ~4 mesh points across: the panel says which mesh shows it.
- Geometry position (Tilt, Spin in its own plane, Show ground, Softness) is
  Render's alone: the view, inflation and exports keep the flat solver frame;
  each mode keeps its own camera. The piece always sits on its lowest point
  (Wall = Standing without the ground). The camera follows the piece's
  middle, so re-runs and inflation keep it centred.
- Shadows: a zero-intensity directional light from the studio's biggest
  panel (turned / raised by Light angle / height) casts onto a ShadowMaterial
  catcher whose basic getShadow is replaced by a PCSS filter (blocker search,
  penumbra = depth gap × tan(light radius)); softness is its own slider
  (light radius 2°–45°), independent of Light edges. Plus a contact shadow
  and a floor disc in the background's colour (lifted ~6 % as seen on dark
  backgrounds). One light, no bounce — not KeyShot, but close.
- The camera re-frames only when the outline's extent changes (kept on the
  scene, so a rebuilt scene frames itself), on a position preset, or on
  entering / leaving Render.

## Session 19 (Round mode, Simflate v1.00)

- **Round mode is decided in the solver too** (`is_round`, the same 35°
  corner rule as the UI's `isRoundOutline`), so Auto can't disagree between
  the label and the build. Round treats every closed loop as corner-free;
  the count is round the longest loop, others in proportion.
- **Fold over, not a wandering S** (Guy: "fold over themselves from a bird's
  eye view"). The section across a fold becomes (x + A·v, depth·v): past
  A ≈ width/π a wall turns back over the floor, still smooth because depth
  keeps changing where the slide doubles back. Only the floor slides (the
  ridges stay), so neighbours leaning towards each other can't collide;
  each A ≤ 45 % of the gap to its nearer neighbour. Sliding the ridges too
  (zero-mean) made slits as soon as folds leaned different ways.
- **Randomness per fold is blended between fold centres** (width, length,
  lean) instead of taken from the strongest tuck — that switch was a jump,
  i.e. a crack. Non-random forms are unchanged.
- **Min bend caps valley depth** from the floor's curvature; older forms get
  0 (off) on load so they build as saved.
- **Rename keeps the app ID** `app.blownsim.v2` and every storage key /
  IndexedDB name: WebView2's data folder follows the ID, so changing it
  would hide Guy's autosave, forms and snapshots. Projects save `.simflate`,
  read both.
- **Splash in plain HTML** in index.html, not a second native window: shows
  as soon as the webview paints, works the same on Windows and Mac, no extra
  Rust. Steps are real (module loaded / fonts / first draw), with a short
  minimum so it isn't a flicker.
- **Crash reporting is local**: a window with Copy / Save report (no upload
  service, nothing leaves the machine); engine panics written to a file and
  sent to the screen; a native box only when the main thread dies.
- **One version number** in package.json; shown as major.minorpatch
  ("v1.00"); release = tag `vX.Y.Z`, installers kept on a draft release
  (artifacts expire after 90 days). Publisher Guy Armstrong, set only where
  Windows needs it.

## Session 20 (bug sweep, reproducible runs, outline export, Pebble / star)

- **A pressure or height change re-runs from flat** (Fast, Steel, Specified
  geometric). Guy, after discussing it: same settings must give the same,
  reproducible shape. Raising part-way kept the creases of the lower
  pressure — a staged inflation the project (final pressure only) can't
  record — and all raises shared one 600-frame budget, so later raises
  stalled. `raise_pressure` / `raise_target_height` stay in the core (and
  the Reference path still retargets its running engine upwards); if staged
  inflation is wanted later it should be a named, saved option.
- **Shapes from outside the running app are checked** (`checkShapes`):
  structure, known kind, finite matrix and points. A damaged shape is left
  out with a count, never loaded — the autosave would keep it and crash every
  reload. The crash window's Empty board keeps a copy of the autosave.
- **DXF extrusion is read by wrapping dxf-parser's handlers** (they drop
  group 230 for some entities): an entity in a flipped plane has x negated
  (arcs, circles, polylines, inserts); ellipses / splines are in world
  coordinates. Relies on the scanner's `_pointer` / `_data`; if those change
  it silently falls back to the old behaviour.
- **Desktop file writes are temp-then-rename** (`write_safely`); text files
  are read as UTF-8 or, failing that, Windows-1252 (`read_text`).
- **Exports go to the desktop as one raw message** (`save_bundle` reads
  `tauri::ipc::Request` body: u32 count, then name / data with u32 lengths),
  not a JSON number list.
- **The WebAssembly worker drops its instance after a trap**: a Rust panic
  leaves the `RefCell` borrowed, so every later call would fail too.
- **Copy = SVG in mm** (plain text + `image/svg+xml`), with the shapes JSON
  in `<metadata id="simflate-shapes">`: Illustrator pastes SVG text as
  artwork; Simflate reads its own shapes back exactly. Older marked-JSON
  copies still paste.
- **Outline export: DXF R12** (POLYLINE / VERTEX, CIRCLE for unstretched
  circles, `$INSUNITS` 4) because every CAD / cutting program reads it;
  layers OUTLINE / WELD / CONSTRUCTION. No DWG: closed format; the DXF opens
  in AutoCAD and saves as DWG there.
- **Pebble / star geometry**: Guy's V4 put the edge control points on the
  chord (edges never bent); edges now bow along the outward normal, with the
  tilt at each end capped at 40 % of the corner's room, the bow at 0.6 × the
  gap to the nearest other edge, and the tilt scaled by the straight share
  of the side (fully rounded pebbles are shaped by their corners). Rounded
  corners are quads aimed where the edge tangents meet. Stored as settings on
  the shape (kind `star`), like the Egg.
- **Label column measured on the page** (`installLabelColumns`): the longest
  visible label per panel, re-measured on any change in the panel's rows; a
  canvas measurement came out short (the `font` shorthand can read empty).
- **Splash once per window** (sessionStorage) — a mid-start reload can't
  bring it back; starts logged in `simflate.startLog` to trace a repeat.


## Session 21 (packaging 1.1, examples, short screens, Reference start-up)

- **Builds:** Windows installers are built locally (`npx tauri build`);
  GitHub Actions (free plan, minutes ran out) only for the Mac, on request.
  A Mac within reach (Tailscale + Remote Login) can replace GitHub entirely.
- **Example forms** ship as `ui/public/examples/forms.json` (project-file
  snapshot format) and are added once per fresh install; Recent keeps 30.
- **A snapshot's smooth mesh** is rebuilt from its own saved mesh when the
  outline no longer re-meshes to the same points (`bs_adopt_mesh`): flat
  layout from its UVs on the re-meshed outline's extent.
- **Tool columns fit by measuring** (`useFitColumn`): normal → small → two
  columns → scroll. Inflate splits Finish + Colour / Pattern and below.
- **Contact** is a view beside the Plates eye; plates exist only for Fast /
  Steel (`usesPlates`).
- **Windows installer is perMachine** with firewall block rules for the
  Reference programs: Intel MPI always listens on all addresses, no option
  changes it, and its traffic is loopback only.
- **Reference starter output is cached** per model fingerprint (FNV-1a of
  deck + copies + starter size/date) and prepared in the background; the
  engine gets identical input. Deck title fixed so the same piece gives the
  same deck. Kept: 8 newest.
- **Engine shipped as "Simflate Reference engine.exe"** (renamed, unchanged).
- **MPI pinning left at default:** no measurable gain plugged in.
- **Mac:** universal native build (no Rosetta). Reference / Symmetric need
  OpenCourant built for macOS (Rosetta can't run Windows programs).

## Session 22 (DWG import)

- **DWG import via acadrust** (pure Rust, MPL-2.0, used unmodified):
  `crates/blown-dwg` turns DWG into DXF text and the existing DXF import
  reads it, so layers, colours, units, blocks and the Line types window all
  work as for DXF. Desktop only (Import dialog converts in `open_file`; a
  dropped DWG goes to `dwg_to_dxf` as raw bytes). Its wasm build needs
  wasm-bindgen's JS glue (web-time), so the browser preview says "save it
  as DXF" instead of adding a build tool. Export stays DXF (AutoCAD saves
  it as DWG). LibreDWG was the alternative: GPL, a separate program to
  ship per platform.
- **Slow Reference start = OpenCourant `fill_igr.F`** (two `DO I = 1, 10000` loops opening ROOTNAME_NNNN.rad): 20,000 failed opens, ~1.5 ms each under Trend Micro. Reported upstream (OpenCourant#67). A binary edit (loop limits 10001 → 3) was proven harmless (byte-identical models, planted file ignored) but **not shipped**: Norton holds the unknown edited exe ~21 s per launch, and any self-built starter would be "unknown" too. Kept the original; preparing ahead hides most of it. `check-upstream.mjs` stops each build until the fix lands upstream.
- **File-open check** (`src-tauri/src/probe.rs`): failed opens timed a few seconds after start (best of 3 × 1,000; bands fine < 5 s, noticeable < 15 s, slow above — Guy's laptop measured 0.3–2.3 s, the Trend laptop 30–70 s) → expected starter-loop cost on this computer, kept in `file-open-check.txt` beside the crash reports. Works where Reference isn't installed (the Mac), so we know whether the loop matters there.
- **About & diagnostics on the logo** (`ui/src/ui/Diagnostics.tsx`, `src-tauri/src/diag.rs`): one place for version, checks and problem reports; screen errors are now saved as reports too (`simflate-screen-<s>.txt`), not only engine panics.

## Session 23 (Guy)

- **Seam stiffness defaults to 50** (setting 1: the seam bends like the sheet). A
  TIG seam is fused, not a free hinge; Guy's best runs used 50. Forms saved
  without the setting keep 0.
- **Edge ripples default to 0.** They are a finisher effect, not physics, and
  they reach the export; the solver's draw-in gives the edge its real waviness.
  Forms saved without the setting keep 50.
- **Height view measures from the seam** (piece's own z = 0), both sheets
  ramping to white at their tops. It used world z after the piece was set on
  the floor, so the top half saturated white.
- **Mac Reference = our public fork `guyarmstrong/opencourant-mac`** (branch
  `macos`), built free on GitHub's macos-15 runners with Homebrew GCC; the
  programs carry their dylibs (`bundle_deps.sh`, `@executable_path`, ad-hoc
  signed) so no Homebrew is needed on the user's Mac. Guy's MacBook (macOS
  14.6, can't be updated, no admin) is the test Mac for GitHub's builds, not a
  build machine.
- **Open reader on a newer starter:** unknown Radioss format (starter 2612)
  falls back to radioss2026 rather than adding a 2612 enum; the starter's own
  open-reader fallbacks (include / part / rigid-part APIs) are forced on with
  `-open_reader`. Both are upstream bugs to offer back.
- **Mac clipboard via NSPasteboard (objc2-app-kit 0.3)**, not a clipboard
  crate: it's already in the build through Tauri and gives the pasteboard
  types needed to recognise Illustrator.
- **Older Macs:** target macOS 11+ for Apple silicon and Intel (universal via
  `lipo`); check each program's minos in CI.

## Session 24 (Guy)

- **The open reader knows Radioss 2612** (reverses session 23's "fall back to
  2026"): the 2026 configs point at files only the 2612 folder has
  (`MAT/matl105.cfg`). The fallback stays for later starters, aimed at 2612.
- **One chip-neutral set of Mac programs** (`*_macos*`, renamed when packed),
  meant to be universal (lipo). Until the Intel half is good the set is arm64
  only, and Simflate reads the Mach-O header so an Intel Mac doesn't offer
  Reference rather than failing at run time.
- **Simflate clears the quarantine mark from its own engine folder** (once per
  session). A quarantined engine is killed with no message; the user's Open
  Anyway approves the app, not the programs inside it.
- **Mac engine runs one copy on several threads** (no MPI); stop by full
  command line (`pkill -f`), since a Mac truncates process names to 16
  characters.
- **Fork CI caches build folders** and re-dates sources so only changed files
  recompile; the cache key holds tool versions and the deployment target.
- **Intel engine not shipped** while it's ~70× slower than Apple silicon on the
  same model (results correct). Shipping it as-is would make Reference unusable
  on the client's Intel Macs. (Session 26: the 70× was a misreading; see below.)

## Session 26 (Guy)

- **Intel engine ships in the universal set** (1.1.3): the slowness was mostly a starter bug, now fixed.
- **Judge engine threads on real hardware, not CI:** GitHub's virtual Macs said 1 thread was fastest; the real M2 said 4 for larger models.
- **Mac threads:** 1 on Intel (best measured, repeat runs byte-identical, until a real Intel Mac says otherwise) and on small models on any Mac; larger models on Apple silicon unchanged, so their results stay as shipped.
- **No flush-to-zero:** no speed gain in a full run, and it would touch the numbers.
