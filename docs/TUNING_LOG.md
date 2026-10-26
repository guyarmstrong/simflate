# Tuning log (v2)

Every look experiment: what was tried, the settings, the numbers, what we
learned. Newest at the bottom. Read this before trying something new.

**How to measure.** Runs go to `runs/<name>/` (CLI). Crease numbers come from
`scripts/creases.py runs <name>...`: height, permanent stretch, how far the
edge drew in, and the share of sheet edges folded sharper than 20° / 40° (welds
excluded). Numbers have misled us before, so always look too: Snapshots →
Test runs, Zebra.

**References.** `Refrence images/` in the v1 folder, sorted by Guy into
Geometric, Balloon, Creaseless (not clamped) and Creaseless (clamped). What
each shows is written up under 2026-10-21 below.

---

## 2026-10-21 · Reference images, read

- **Geometric** (Lyrae XL/XS, textured square, rack pillows, chair, fountain,
  hexagon wall): a few big folds — on a square 2–3 V-tucks per edge, each about
  a fifth of the edge; long straight ridges from inward notches. Flat-ish
  triangular facets between. Crests sharp in direction but rounded across
  (thickness limits how tight a fold gets). Edge draws in hard, scalloped.
  Height about a quarter to a third of the width. Hexagon wall: smooth domes,
  all the crumpling as long wavy pleats along the internal welds.
- **Balloon** (foil letters, Jo Malone, gold LV): full, round cross-section,
  smooth middle. All wrinkling in a narrow rim band — many small deep pleats at
  right angles to the edge (~40 round Jo Malone), reaching 5–10 % of the width
  in, folding over themselves. Narrow parts become tubes with tucks along the
  side seams.
- **Creaseless, not clamped** (bone sculpture): smooth everywhere, edge clearly
  drawn in, metal visibly stretched.
- **Creaseless, clamped** (blue tiles, bench): flat faces against the plates,
  rounded rims, pointy drawn-in corners, small tucks only at corners.
- Guy: the edge draws in on *all* of them (pointy corners); creaseless pieces
  are made at high pressure with a clamp that holds the edges early and is
  slowly released. He'd like to get there with settings and clamps that don't
  move.

## 2026-10-21 · Step 1: real thickness + pressure scale

- Thickness (mm) replaces Character's hidden thickness; Balloon ↔ Geometric
  multiplies the bending thickness ×0.6 (Balloon) … ×3 (Geometric).
- First try kept v1's pressure normalisation, which depends on thickness with
  exponent 1.6. Over 0.1–3 mm that runs away: square 300 mm, pressure 89 →
  0.3 mm Balloon **302 mm tall** (hit the 40 % stretch cap), 3 mm Geometric
  **27 mm**. Fix: pressure scale depends only on Balloon ↔ Geometric
  (reference sheet 1 mm on 300 mm). Then Balloon ≈ 155 mm at 0.3, 1 and 3 mm;
  Geometric 65–93 mm. Committed (f6e3672).

## 2026-10-21 · Pressure sweep, square 300 mm, 1 mm, Geo 0.3, Medium

| pressure | height | stretch % | draw-in % | folds >20° | >40° |
|---|---|---|---|---|---|
| 70 | 126 | 3.4 | 13.3 | 0.97 % | 0.20 % |
| 89 | 139 | 4.6 | 14.9 | 0.72 % | 0.07 % |
| 120 | 159 | 11.8 | 15.6 | 0.61 % | 0.05 % |
| 160 | 257 | 40 (cap) | −8.5 | — runs away (burst) | |
| 220 | 289 | 40 (cap) | −23 | — runs away | |

- Creases fall slowly with pressure. Above ~130 the dome runs away to the
  stretch cap — like a real piece bursting. The usable top of the scale is
  about 120–130.

## 2026-10-21 · Experiment: sheet plasticity (von Mises flow) — REJECTED

- Idea: edge draw-in leaves spare length along the rim; at high pressure the
  metal should take it up by flowing (longer across the rim, narrower along
  it, thinner) instead of buckling. Built a per-triangle von Mises yield with
  associated flow driving the link rest lengths.
- Result: no change in creases (89: 0.72 % → 0.72 %). Including the rim
  triangles made it worse: local 40 % stretch at the rim at pressure 120.
- Add-on tried: hinge plastic moment lowered by membrane tension,
  M_p·(1 − (σ/σ_y)²). Worse: more and sharper folds (89: 0.95 %, max 64°;
  120: 1.47 %) — under compression the weakened hinges kink.
- Both removed. Not the lever.

## 2026-10-21 · Experiment: folds that can't set — KEY FINDING

- Hinge plastic moment ×1000 (no fold can ever become permanent):

| | folds >20° | draw-in % | height |
|---|---|---|---|
| 89, normal | 0.72 % | 14.9 | 139 |
| 89, folds can't set | **0.00 %** | 9.2 | 125 |
| 120, normal | 0.61 % | 15.6 | 159 |
| 120, folds can't set | **0.02 %** | 12.9 | 159 |

- The sheet comes out smooth, still drawn in, same height. **All of our
  creases are folds that set permanently on the way up.** The solver's soft
  compression (compression_factor 0.25) already lets the rim squeeze in
  without buckling, so we don't need a flow rule for smoothness.
- This is exactly what Guy's temporary clamp does on real creaseless pieces.

## 2026-10-21 · Crease hold (static stand-in for the clamp)

- `crease_hold` (0–100, CLI `--hold`): folds can't set until the pressure
  passes the hold level. Released the moment the pressure passes it: 120/120
  gave 0.21 % (from 0.61 %) — the piece is still moving, folds set in that
  moment. Changed to: if the hold is at or above the final pressure, release
  once the piece has settled there.

| pressure / hold | folds >20° | >40° | max fold |
|---|---|---|---|
| 89 / 0 | 0.72 % | 0.07 % | 61° |
| 89 / 89 | 0.55 % | 0.02 % | 45° |
| 100 / 100 | 0.39 % | 0.00 % | 36° |
| 120 / 0 | 0.61 % | 0.05 % | 54° |
| 120 / 100 | 0.42 % | 0.00 % | 39° |
| 120 / 120 | 0.16 % | 0.00 % | 29° |

- Matches the real process: hold + high pressure → nearly creaseless with
  pointy drawn-in corners (looks like the blue tiles in Zebra). At moderate
  pressure the hold helps less (the springy wrinkles are still there when it
  comes off, and set).
- Seen in Zebra: the 1 mm / 300 mm square at 89–120 is already fairly smooth
  without the hold — our default sits too close to "creaseless". The rack
  pillows (Geometric refs) at similar fullness show big V-tucks. Needs the
  Geometric side tuned next.

## 2026-10-21 · Research: how other tools control creases

- **Cinema 4D (2023+ Cloth tag, PBD — same family as ours).** Controls:
  Stretchiness, Bendiness, Thickness (collision), Target Length (+ map; shrink
  the sheet to make wrinkles), Balloon with Overpressure and **Expansion
  Time** (how fast pressure comes up), plastic deformation for bend and
  stretch with *Deform Past* (yield), *Strength* (rate) and **Hardening**.
  Source: Maxon SDK parameter list (tsbd), Maxon help (Cloth tag, Balloon).
- **Houdini Vellum:** plasticity on bend and stretch (threshold, rate,
  hardening), balloon/pressure, "stopped" attribute to hold areas during
  inflation (= a clamp), creases added by painted bend stiffness.
- What we lack, in order of likely effect:
  1. **Hardening** — a fold gets stiffer as it yields, so it spreads instead
     of sharpening to a knife edge (Guy: thickness stops geometric creases
     getting too deep or fine). Try next on the Geometric side.
  2. **Self-collision with thickness** — balloon pleats that fold over
     themselves need it.
  3. **Expansion time** as a control — creases are decided on the way up.
  4. **Target length** (shrink) — an art-direction control for gathering.

## 2026-10-21 · Geometric end makes no folds — found why

- Fold hardening (`bend_hardening` 0/2/8/30) on Geometric 1, pressure 89:
  no folds at all at any value (max fold 7–11°), 72 mm tall, edge drawn in
  only 2.7 %. Not the problem *yet*; kept as a knob (default 0).
- Balloon ↔ Geometric 0.3 / 0.6 / 0.8 at pressure 100–120: fold amounts all
  0.4–0.66 %, and by eye all look like the same soft pillow with small rim
  crinkles. None has the reference V-tucks.
- `compression_factor` 0.25 → 1 → 4 (metal as stiff pushed as pulled):
  barely any change (0.65 → 0.74 %). Not the lever.
- Measured link lengths by distance from the weld: medians ≈ 0 % at every
  band (min −5…−7 %), so the rim is *not* squashing — it takes up its spare
  length in many tiny folds at mesh scale.
- **Causes, from the numbers in the code:**
  1. `character_pressure_exponent` 1.6 (from v1) gives Geometric 13× less
     pressure relative to its yield tension than Balloon — it never yields or
     draws in. Real Geometric pieces are fully inflated.
  2. At 1 mm / 300 mm the physical bending stiffness of the Balloon half sits
     *below* `min_bending_mesh_factor`'s floor (c 0.3: D = 0.0034 vs floor
     ≈ 0.011 on Medium), so Balloon ↔ Geometric does almost nothing there.
     And wrinkle spacing only grows as D^¼, so even a 3× stiffer sheet folds
     only ~1.3× wider.
- Exponent 0 (pressure per sheet strength), square 300, 1 mm, pressure 100:

| run | height | draw-in % | folds >20° | max |
|---|---|---|---|---|
| Geo 0, temper ×3 | 136 | 15.2 | 0.85 % | 62° |
| Geo 0.5, ×3 | 134 | 13.9 | 0.67 % | 59° |
| Geo 1, ×3 | 131 | 11.7 | 0.41 % | 41° |
| Geo 0.5, ×10 | 132 | 12.3 | 0.49 % | 45° |
| Geo 1, ×10 | 119 | 8.0 | 0.00 % | 20° |

- By eye: Geometric now inflates fully into a pillow with pulled-in sides and
  pointy corners (like the creaseless pillows) instead of a shallow lens.
  Still no big V-tucks along the sides. ×10 is too stiff (no folds). **Adopted
  exponent 0 as default.**
- Next: why no V-tucks. Suspects: the starting imperfection has too few/too
  fine bumps to seed big tucks; the weld-straightness/corner ties stiffen the
  rim; the mesh floor flattens the difference between thicknesses.

## 2026-10-21 · Reference pieces with real sizes (from Guy)

- **Lyrae XS**: 205 × 190 mm flat, **65 mm deep** inflated. **Lyrae XL**:
  580 H × 380 W mm, **100 mm deep**. Sheet "mid-range" (try ~1 mm).
  **Jo Malone** balloons: 600 mm wide, ~0.3–0.4 mm sheet.
- Outlines traced from Guy's silhouettes with `scripts/trace_silhouette.py`
  (silhouette PNG → grid via PowerShell System.Drawing → traced, smoothed,
  scaled) → `samples/reference/lyrae-xs.json`, `lyrae-xl.json`. Traced
  proportions match the stated sizes within 2 %.
- Use Target height = the real depth so only the creases are compared.
- `scripts/render_run.py` + `scripts/ppm2png.ps1`: picture of any run without
  the browser (chrome or zebra look), ~13 s for four runs.

## 2026-10-21 · Lyrae at real depth: far too smooth

- XS 1 mm, height 65, Medium: Geo 0.3 / 0.8 both a smooth heart pillow with
  crumpled lower rim; needed 35–40 % stretch (cap) to reach depth. XL 1 mm,
  height 100: smooth, crinkles only at the side notches, 1–3 % stretch.
  Reference: long sharp ridges from the notches across the face, big tucks,
  flat-ish facets.
- `min_bending_mesh_factor` 12 → 4 → 1 (XS, Geo 0.5): identical — the floor
  isn't active there. Not it.
- **Final mesh**: same look, but stretch 38 % → 12 % at the same depth — the
  Medium mesh is too coarse for a 200 mm piece.
- Raw solver output (no finisher) is just as smooth — the smoothing isn't
  erasing ridges; the solver doesn't make them.
- `weld_free_z` = 1 (seam may wave up/down, mean height held at 0; new knob,
  default 0): no visible change, stretch 12 → 10.5 %.
- Stretch capped at 2 % (`max_plastic_strain` 0.02): reaches 65 mm just the
  same, looks the same. So the depth doesn't come from stretch.
- Link lengths: some rim links sit 5–7 % *shorter* than their flat length.
  Real steel can't squash end-on — it buckles. **Suspect: one XPBD pass per
  substep under-converges, so in-plane stiffness is effectively far softer
  than set and the rim compresses instead of folding.** Testing
  `iterations_per_substep` 4 and 10 with `compression_factor` 1 (running at
  end of session 6 — result below if recorded, otherwise re-run:
  `cargo run --release -p blown-cli -- run --pieces samples/reference/lyrae-xs.json --medium --thickness 1 --character 0.5 --height 65 --tune iterations_per_substep=4 --tune compression_factor=1 --finish 1 --name xs-it4`).

**Result (4 passes, XS Medium, height 65):** folds >20° 0.22 % → 0.66 %, max
fold 34° → 41°. By eye: a ridge starts at the top notch, the right lobe shows
fold edges and facets — the first step toward the Lyrae look. **But 12×
slower** (536 s vs 43 s). Hypothesis supported. Next session: get the same
in-plane stiffness cheaply — e.g. extra passes on stretch only (not bending),
or a stiffer compression response, or fewer substeps with more passes — then
check XL and the square. (`creases.py`'s draw-in % is wrong for non-square
outlines — it assumes the run size is the uv span; ignore it for Lyrae.)
The 10-pass run (`xs-it10`) was still running at the end of the session.

## 2026-10-21 (session 7) · Cheap in-plane stiffness → adopted

All Lyrae XS Medium, 1 mm, Geo 0.5, height 65 unless noted. Baseline forced
to 600 frames (`settle_frames=100000`, run `xs-long`): 0.24 % folds >20°,
max 35° — so the 4-pass result was **not** just from running longer.

| Run | Change | Time | Frames | Folds >20° | >40° | Max |
|---|---|---|---|---|---|---|
| xs-long | baseline, 600 frames | 102 s | 600 | 0.24 % | 0 | 35° |
| xs-cf1 | compression_factor 1 | 123 s | 318 | 0.30 % | 0 | 35° |
| xs-it4 | 4 full passes + cf 1 | 536 s | 600 (never settles) | 0.66 % | 0.02 % | 41° |
| xs-sp3 | 3 extra stretch passes + cf 1 | 377 s | 600 (never settles) | 0.74 % | 0.06 % | 48° |
| **xs-sp1** | **1 extra stretch pass + cf 1** | **90 s** | **374** | **0.63 %** | 0 | **38°** |
| xs-sp1c | 1 extra stretch pass, cf 0.25 | 684 s | — | 0.50 % | 0.01 % | 48° |
| xs-sub20 | 20 substeps × 2 passes, dt ×2, cf 1 | 128 s | 352 | 0.20 % | 0 | 31° |
| xs-or15/18 | stretch over-relaxation 1.5/1.8 | — | blew up | — | — | — |

- Zebra by eye: extra stretch passes put a kink line from the top notch
  toward the lower left (the start of the Lyrae ridge); baseline has none.
  1 extra pass ≈ most of 3.
- Bigger steps with more passes lose it (time step matters more than passes).
  Over-relaxation explodes (λ accumulation). Removed.
- Wider check, base → new (stretch_passes 1 + cf 1):
  square 300 Geo 0: folds 1.05 → 1.52 %, stretch 4.1 → 9.5 %;
  square 300 Geo 1: 0.33 → 0.47 %, stretch 2.0 → 7.2 %;
  Lyrae XL height 100: 0.07 → 0.30 %, stretch 1.0 → 5.7 %.
  By eye modest: more rim crinkle, XL notch lines a bit stronger. Side
  effect: more stretch (stiffer sheet passes more force → more yielding).
- **Adopted as default:** `stretch_passes` 1 (new knob), `compression_factor` 1.
  Plates test contact threshold 0.2 → 0.12 (smaller flat patch, still exact).
- Clamp (`--hold 1000`) with new defaults: folds 0.63 → 0.02 %, smooth
  pillow; overshoots height mode (70 vs 65 mm).
- Still far from the reference ridges. Next to try: bigger starting
  imperfections, Final mesh, hardening, then whether the rim tie/weld
  straightness stiffens the rim.

## 2026-10-22 (session 8) · Dents, Final mesh, hardening — Lyrae XS

Lyrae XS, 1 mm, Geo 0.5, height 65, session-7 defaults (stretch_passes 1,
cf 1). Six runs in parallel, so times (~250–290 s each) are inflated ~3× by
sharing the CPU — not comparable with session 7's 90 s.

| Run | Change | Height | Stretch % | Folds >20° | >40° | Max |
|---|---|---|---|---|---|---|
| xs-sp1 | baseline (session 7) | 63 | 40 (cap) | 0.63 % | 0 | 38° |
| s8-amp01 | imperfection_amplitude 0.01 (×5) | 63 | 40 | 0.68 % | 0.01 % | 40° |
| s8-amp03 | 0.03 (×15) | 63 | 40 | 0.64 % | 0 | 39° |
| s8-amp08 | 0.08 (×40) | 63 | 40 | 0.49 % | 0 | 40° |
| s8-final | Final mesh | 66 | 10.6 | 0.02 % | 0 | 25° |
| s8-hard2 | bend_hardening 2 | 63 | 40 | 0.02 % | 0 | 25° |
| s8-hard8 | bend_hardening 8 | 63 | 25 | 0.00 % | 0 | 20° |

- Bigger starting dents: no effect. Not the lever.
- Hardening: removes folds entirely. Wrong direction for Geometric; leave off.
- **Final mesh: the Medium XS reaches 65 mm only by stretching to the 40 %
  cap** (impossible for 1 mm steel); on Final it gets there at 11 % — and is
  smooth. So Medium's XS "folds" are partly coarse-mesh artefacts, and the
  real problem stands: a properly resolved sheet makes no ridges.

### Rim stiffness — not it (4 runs in parallel, ~195 s each, inflated)

| Run | Change | Stretch % | Folds >20° | Max |
|---|---|---|---|---|
| s8-ws0 | weld_straightness 0 | 40 | 0.62 % | 38° |
| s8-cs0 | corner_stiffness 0 | 40 | 0.63 % | 38° |
| s8-wsf1 | weld_stiffness_factor 4 → 1 | 40 | 0.63 % | 38° |
| s8-rimfree-fin | all three, Final mesh | 11.7 | 0.01 % | 24° |

- No change at all. The rim ties don't hold the folds back.
- Remaining suspect: on Final the piece reaches depth by **stretching 11 %**;
  real 1 mm steel on a Lyrae stretches a few % and must buckle instead. And
  `elastic_strain_at_yield` is 0.004 (real 0.0011) — 3.6× softer in-plane, so
  it can squeeze instead of buckling. Testing next on Final.

### Real in-plane stiffness and low stretch cap — not it (Final, 3 parallel, ~240 s each)

| Run | Change | Stretch % | Folds >20° | Max |
|---|---|---|---|---|
| s8-final | baseline Final | 10.6 | 0.02 % | 25° |
| s8-fin-e2 | elastic_strain_at_yield 0.004 → 0.002 | 10.8 | 0.02 % | 25° |
| s8-fin-e11 | 0.0011 (real steel) | 10.8 | 0.02 % | 25° |
| s8-fin-mp4 | max_plastic_strain 0.04 | 4.0 | 0.02 % | 24° |

- Real-steel stiffness changes nothing at all — the set stiffness is not what
  the solver delivers (it is limited by convergence, as in session 7), so the
  knob is out of reach without more passes.
- Capped at 4 % stretch, the XS still reaches 66 mm and stays smooth: the
  depth comes from the edge drawing in, not from stretch, and the sheet takes
  up the spare rim length without folding. **The resolved sheet does not
  buckle into big ridges under any rim, dent, hardening, stiffness or stretch
  setting tried.** Next idea: the ridges are not a free-inflation result —
  they come from the notches/inward corners steering the folds; look at
  what the sheet does at the notch tips (zebra) and at a converged in-plane
  solve that stays cheap (e.g. Chebyshev / multigrid-style stretch passes).

## 2026-10-22 (session 8) · Triangle tips (Guy: inflate a little further toward the tip)

Triangle 300, 1 mm, Geo 1, pressure 100, Medium, ~22 s each (7 in parallel).
Measured with `scratchpad tip.py`: distance from each tip where the top sheet
first reaches 5 / 15 mm high (mean of three tips).

| Run | corner_reach | 5 mm high at | 15 mm high at |
|---|---|---|---|
| t-tri-base | 0.4 | 32.6 mm | 57.7 mm |
| t-tri-reach25 | 0.25 | 28.4 mm | 53.6 mm |
| t-tri-reach15 | 0.15 | 28.4 mm | 53.6 mm |

- 0.25 brings the inflation ~4 mm further down the tip; below that no change
  (the rest is natural geometry). **Adopted corner_reach 0.25.**
  (Earlier: corner_stiffness 0 vs 4 looked identical — the reach is the lever.)

## 2026-10-22 (session 8) · Geometric square — one variable at a time

Square 300, 1 mm, Geo 1, pressure 100, Medium, ~26–31 s each (parallel).

| Run | Change | Height | Folds >20° | >40° | Max | By eye |
|---|---|---|---|---|---|---|
| g-sq-base | — | 125 | 0.60 % | 0.05 % | 50° | smooth pillow, ragged mesh-scale rim crinkle |
| g-sq-floor150 | min_bending_mesh_factor 150 (elastic only) | 125 | 0.45 % | 0 | 38° | same |
| g-sq-temper6 | temper_geometric 6 | 116 | 0.15 % | 0 | 32° | same, rim rougher |
| g-sq-rate01 | plastic_rate 0.1 | 125 | 0.46 % | 0 | 40° | same |

- None gives V-tucks. Reference squares (pillow wall, fountain, chair): 2–3
  deep diamond V-tucks per side pinching the side in; ours put the spare rim
  length into many mesh-scale crinkles (likely also Guy's "edge ripples not
  accurate").

## 2026-10-22 (session 8) · Weld zig-zag (Guy's idea) — seam measurements

Guy: in the references the weld is pulled into a zig-zag, vertically or to
one side; the V-tucks come from that. Square 300, Geo 1, pressure 100, Medium.

- Lower fullness is *not* it: height 105 / 90 / 75 → folds 0.51 / 0.15 /
  0.01 % (fewer as it gets flatter). Pressure 60 → 0 %.
- Seam knobs alone, no effect: weld_straightness 0, weld_free_z 1, both,
  weld_stiffness_factor 1 (all 0.59–0.65 % folds, same look).
- **Measured the seam (`scratchpad seam.py`)**: it curves smoothly inward
  (6 mm at the corners → 25 mm mid-side), stays at z = 0, and is **2.2 %
  shorter** than drawn (300 → 293.5 mm). Real weld can't shorten; that spare
  6.5 mm/side is what should zig-zag. The solver lets it squash.
- New knob `weld_kink_yield` (+ `weld_flange_stiffness`): yielding seam, XPBD,
  force-based — stiff until a sideways force passes its yield, then kinks for
  good. Default 0 (off). Alone: no effect (the seam is loaded evenly, so it
  yields evenly along the smooth curve).
- New knob `weld_passes`: extra solver passes over the weld links only.

| Run | Change | Time | Seam length | Folds >20° | >40° | Max |
|---|---|---|---|---|---|---|
| g2-base | — | 19 s* | −2.16 % | 0.60 % | 0.05 % | 50° |
| w-p10 | weld_passes 10 | 57 s | −1.42 % | 0.85 % | 0.09 % | 59° |
| w-p40 | weld_passes 40 | 54 s | −0.97 % | 0.96 % | 0.12 % | 58° |
| w-p40-k | + weld_kink_yield 0.1 | 57 s | −0.98 % | 1.04 % | 0.15 % | 61° |
| w-p40-z | + weld_free_z | 54 s | −0.96 % | 0.95 % | 0.12 % | 60° |
| w-p40-kz | + both | 57 s | −0.98 % | 1.02 % | 0.14 % | 63° |

(*base was in a different batch; 5 runs in parallel here.) More folds by the
numbers, but by eye all are still smooth pillows — the seam stays smooth
and planar (z within ±0.3 mm). Why it won't buckle: the sheets either side
are in high tension and hold it taut like a string; top and bottom pull
equally; and the starting dents fade to exactly zero at the weld
(`imperfection_taper`), so the seam starts perfectly straight and flat.
Next: seed the seam itself with a small waviness (real TIG distortion).

### Seam seed (new knob `weld_seed`, default 0) — seam stays stable

| Run | Change | Seam z after | Folds >20° | Max |
|---|---|---|---|---|
| s-003z | weld_seed 0.003 (~0.5 mm) + free z | ±0.2 mm | 0.62 % | 51° |
| s-01z | 0.01 (~1.7 mm) + free z | ±0.2 mm | 0.61 % | 51° |
| s-03z | 0.03 (~5 mm) + free z | ±0.2 mm | 0.61 % | 50° |
| s-01z-p40 | 0.01 + free z + weld_passes 40 | ±0.2 mm | 0.96 % | 61° |
| s-01-lock | 0.01, seam held at its wavy start | −0.4…+1.3 | 0.63 % | 52° |

~50 s each, 5 in parallel. Any starting waviness is pulled flat again —
the seam is genuinely stable in our model. **Conclusion of the seam
series:** the seam is not where the zig-zag starts in our solver; it would
only follow the sheet. The sheet just inside the seam (the compressed
rim band) squashes instead of buckling (seam 2 % short, rim links −5…−7 %
in session 6), because one Gauss-Seidel pass can't deliver steel's in-plane
stiffness. More passes help the numbers but cost 2–12× and still look smooth.
Next: a solver that is stiff in-plane by construction (a global solve of
the stretch constraints, e.g. projective-dynamics style with a pre-factored
matrix), instead of more local passes.

## 2026-10-22 (session 8) · Real stainless and "no squash" (Guy: steel can't stretch much or squash; the shrinking perimeter must zig-zag)

Backup tag before this: `backup/solver-s8-before-stainless`. Square 300,
Geo 1, pressure 100, Medium. New meter `scratchpad squash.py`: share of sheet
links shorter than drawn.

| Run | Change | Time | Squashed >1 % | Worst | Stretch | Folds >20° |
|---|---|---|---|---|---|---|
| h-base | — | 41 s | 6.9 % | −5.2 % | 9.9 % | 0.60 % |
| h-304 | stretch_hardening 1 (304 curve) | 42 s | 7.9 % | −5.2 % | 4.5 % | 0.59 % |
| h-304-e | + elastic_strain_at_yield 0.0011 | 41 s | 6.9 % | −5.5 % | 5.4 % | 0.66 % |
| q-1 | squash_limit 0.01 | 280 s | 4.0 % | −5.6 % | 23.7 % | 0.73 % |
| q-03 | squash_limit 0.003 | 306 s | 0.8 % | −4.9 % | 40 (cap) | 1.01 % |
| q-03-p20 | + squash_passes 20 | 366 s | 0.1 % | −2.8 % | 40, **burst 217 mm** | 6.37 % |
| q-03-304 | 0.003 + 304 hardening | 319 s | 1.2 % | −5.4 % | 40 (cap) | 1.55 % |

- **304 hardening (new knob `stretch_hardening`, default 0)**: halves the
  stretch (9.9 → 4.5 %) at nearly the same height — realistic — but the
  folds don't change, because 7 % of links are still squashed.
- **`squash_limit` (strain limiting) — REJECTED**: the projection moves
  points outside the XPBD bookkeeping, so neighbours read it as tension and
  yield: stretch runs to the 40 % cap, runs never settle, strongest one
  burst. Knob kept, default 0.
- **Why the sheet is soft whatever stiffness we set:** λ starts from zero
  every substep and gets one pass, so in steady state the link has to be
  off by C ≈ λ·(α̃ + h²·Σw) to produce its force. With h = 0.004 and Medium
  masses, h²·Σw ≈ 0.1 vs steel's α ≈ 0.004 — **effective compliance ~25×
  softer than set.** That's why real-steel stiffness changed nothing.
- Next: **warm start** — carry each link's λ over from the last substep
  (and apply its impulse in the prediction) so one pass only corrects the
  change. Exact XPBD (same equations, better first guess); in a slow,
  damped inflation it should reach the set stiffness at ~no cost.

### Warm start (new knobs `warm_start`, `warm_start_bend`, `warm_start_tension`, all default 0)

Square 300, Geo 1, Medium. "p" = pressure 100, "h" = height 110.

| Run | Change | Time* | Squashed >1 % | Height | Stretch | Folds >20° | Max |
|---|---|---|---|---|---|---|---|
| ws-base | — | 52 s | 6.9 % | 125 | 9.9 % | 0.60 % | 50° |
| ws-09 | warm 0.9 (tension too) | 58 s | 0.7 % | 123 | 14.6 % | 0.93 % | 61° |
| ws-095 / ws-098 / 1 | warm ≥ 0.95 (tension too) | — | — | **burst / NaN** | 40 | — | — |
| ws-1-b, ws-09-b09 | + warm_start_bend | — | — | **NaN at once** | | | |
| c-* | + cap λ at yield force | — | — | still bursts ≥ 0.95 | | | |
| hh-09 | warm 0.9, height mode | 129 s | 0.2 % | **144 (overshoot)** | 40 | 0.08 % | 27° |
| **k-p-1** | **warm 1, compression only** | 80 s | **0.3 %** | 125 | 16.9 % | 0.94 % | 59° |
| **k-p-1-304** | + stretch_hardening 1 | 84 s | 0.4 % | 124 | 8.8 % | 1.13 % | 69° |
| k-h-1 | warm 1 compr., height 110 | 124 s | 0.3 % | 110 | 18.6 % | 0.97 % | 76° |
| k-h-1-304 | + 304 | 103 s | 0.4 % | 110 | 7.7 % | 0.97 % | 82° |
| hh-base | height 110, no warm | 65 s | 7.1 % | 107 | 7.0 % | 0.56 % | 55° |

*5 runs in parallel per batch.

- Warm-starting **tension** runs away: a large patch starts yielding at
  ~50 mm high and every substep the stale tension re-yields it (a local
  bulge / burst). Capping the carried λ at the yield force didn't stop it.
  Warm-starting **bending** goes NaN immediately.
- **Warm-starting only compression** is stable at 1.0 — links don't yield in
  compression, so there's no plastic feedback — and it does what we wanted:
  squashed links 7 % → 0.3 %. Folds ~double and get sharper (max 50 → 69–82°).
  Cost ~1.5×.
- By eye (chrome) still a pillow; zebra shows more rim disturbance and small
  kinks, no V-tucks. With squash gone, the spare rim length goes into small
  wrinkles rather than a few big tucks. Wrinkle size is set by bending
  stiffness vs hoop tension: ~30 mm for 1 mm steel (~50 mm at Geo 1's ×3),
  only 4–7 Medium edges — barely resolved, so they collapse to mesh scale.

### Lyrae with warm start + 304, and folds at real thickness

Lyrae, 1 mm, Medium unless noted. Compare session-7 runs xs-sp1 / xl-new.

| Run | Change | Time* | Squashed >1 % | Stretch | Folds >20° | Max |
|---|---|---|---|---|---|---|
| xs-sp1 | XS h65 Geo 0.5 (session 7) | 90 s | 6.6 % | 40 (cap) | 0.63 % | 38° |
| L-xs-m | XS + warm 1 + 304 | 173 s | 2.1 % | 40 (cap) | 0.88 % | 68° |
| L-xs-f | same, Final mesh | — | — | 40, never settled (stopped at frame 570) | | |
| k-h-1-304-fin | square h110, warm+304, Final | — | — | 40, overshoot 133 mm | | |
| xl-new | XL h100 Geo 0.5 (session 7) | — | 0.9 % | 5.7 % | 0.30 % | 33° |
| L-xl-m | XL + warm 1 + 304 | 81 s | 0.9 % | 10.1 % | 0.31 % | 33° |
| L-xl-m-geo1 | same, Geo 1 | 173 s | 0.9 % | 40 (cap) | 1.34 % | 137°, blemish |

- Warm start is **unstable on Final** (both runs ran to the stretch cap and
  never settled). Medium only for now.
- XL: no change in look. XS: sharper by the numbers, same by eye.

New knob `fold_moment_real` (default 0): folds set at the moment of the
real thickness while Balloon ↔ Geometric keeps the elastic stiffness
(Geo's ×3 bending thickness otherwise makes folds 9× harder to set).
XL h100, Medium, ~90 s each (5 parallel):

| Run | Change | Stretch | Folds >20° | Max |
|---|---|---|---|---|
| m-g05 | Geo 0.5 | 5.7 % | 0.30 % | 33° |
| m-g05-r | + fold_moment_real | 10.1 % | 0.25 % | 32° |
| m-g1 | Geo 1 | 2.7 % | 0.11 % | 26° |
| m-g1-r | + fold_moment_real | 16.2 % | 0.13 % | 31° |
| m-g1-r-w | + warm_start 1 | 27.5 % | 0.38 % | 38° |

- Top view: all five smooth, no notch ridges. Side view in zebra: the
  plain Geo 0.5 run **does** have the notch valley (stripes converge to a
  point — a cone from the right notch), soft but the right feature; the
  real-moment + warm run is crumpled all over like foil — wrong direction
  (many small folds, not a few big sharp ones). Not adopted.

## 2026-10-22 (session 8) · Ridge sharpening in the finisher (Guy chose: finisher first, new solver core after)

New finisher step 0 (`ridge_sharpness`, CLI `--ridges`, app slider **Ridges**,
default 0): on the solve mesh, find edges that bend ≥ `ridge_min_deg` and at
least as much as the four edges across the fold, joined into runs ≥
`ridge_min_len_mm`; pin them; relax the sheet 1–4 rings either side flat
(plain Laplacian) so the bend gathers onto the line; keep them sharp through
pre-smoothing, subdivision and Taubin. Costs nothing in the solve.

Square / triangle 300, 1 mm, Geo 0.5, pressure 100, Medium, ~20 s each.

| Run | Ridges | min deg | min len | By eye |
|---|---|---|---|---|
| r-sq-0 | 0 | — | — | smooth pillow |
| r-sq-05 / r-sq-1 | 0.5 / 1 | 6 | 30 | crisp fold lines from the corners, some rim noise |
| r-sq-L60 | 1 | 6 | 60 | cleaner |
| **r-sq-L60-d10** | 1 | 10 | 60 | **crisp fold lines in from the corners and a sharp ridge along the near side, no noise — best** |
| r-tri-0 | 0 | — | — | smooth; ragged lower rim already (edge crinkle) |
| r-tri-1 | 1 | 6 | 30 | rim made jagged — the rim crinkles got sharpened |
| r-tri-L60 / -d10 / L100 | 1 | 6–10 | 60–100 | clean, crisper tips; ragged rim unchanged (pre-existing) |

- **Defaults set to min 10°, min 60 mm** (short rim crinkles ignored; real
  tucks/ridges are ~a fifth of a side or longer).
- The triangle's ragged rim is the separate edge-crinkle problem (Guy: edge
  ripples not accurate) — still to do.

## 2026-10-22 (session 8) · Core B — quasi-static Newton solver (phase 2)

Backup tag: `backup/solver-s8-before-core-b`. New file
`crates/blown-core/src/solver/statics.rs`, switched by `--tune core=1`
(default 0 = XPBD core; soap always core 0). Each frame: step the pressure,
minimise E = stretch springs + hinges − p·V + small pull to last frame
(`static_dt`), projected Newton + sparse Cholesky (faer 0.24, symbolic
analysis reused; factorisation reused for up to `static_refactor_frames`
frames, refreshed whenever a stale one gives a short step), backtracking
line search; then permanent set from the exact equilibrium forces (links
past yield lengthen, hinges past M_p re-set), `static_plastic_cycles` 2.

- Speed: circle 200 default mesh **5.2 s** (XPBD core 6.7 s); the first
  version factorised every Newton step: 135 s (factor ~100 ms of each
  ~115 ms step). Square/triangle 300 Medium ~45–80 s with 4–5 in parallel.
- Same result with 2 or 8 Newton iterations per frame (steps are small).

Square 300 Medium, Geo 1 unless noted:

| Run | Settings | Height | Stretch | Squashed >1 % | Folds >20° | Max |
|---|---|---|---|---|---|---|
| ws-base | XPBD core | 125 | 9.9 % | 6.9 % | 0.60 % | 50° |
| b-sq | core B | 122 | 13.1 % | 0.2 % | 0.57 % | 33° |
| b-sq-steel | core B, elastic 0.0011 (real steel) | 118 | 14.8 % | 0.0 % | 0.73 % | 41° |
| b-p50 / b-p70 | steel, pressure 50 / 70 | 16 / 45 | 0.3 / 2.8 % | — | 0 | 1° / 12° |
| b-p85 | steel, pressure 85 | 99 | 18.6 % | — | 0.69 % | 46° |
| b-p100-304 | steel + 304 hardening | 115 | 12.4 % | — | 0.88 % | 46° |
| b-h100-304 | steel + 304, height 100 | 102 | 14.4 % | — | 0.96 % | 58° |
| b-real-p100 | steel, real 1 mm bending (temper ×1) | 123 | 11.7 % | — | 1.12 % | 52° |
| b-real-p100-f1 | + bending floor 1 (was 12) | 124 | 12.4 % | — | 1.46 % | 75° |
| b-real-h100-f1 | same, height 100 | 101 | 18.5 % | — | 1.49 % | 89° |
| b-real-p80-f1 | same, pressure 80 | 108 | 15.7 % | — | 1.45 % | 83° |

Triangle 300, Geo 1: core B 54 mm (XPBD 67), no folds; steel 51 mm.

- Core B does what it was built for: no squash, real steel stiffness,
  stable, as fast as XPBD. **By eye all are still smooth pillows** (rim
  crinkles one triangle wide).
- Below yield (p50/p70) the steel square barely rises and its edges don't
  draw in: the solver sits on the unbuckled balance (Newton converges to
  saddles; nothing knocks it off). Above yield it stretches plastically
  (12–18 %) into the pillow.
- Real 1 mm wrinkles should be ~30 mm; Medium (~7 mm edges) can't draw
  them smoothly. Next: Final mesh with core B (stable now), then a saddle
  escape (small random kick each frame, accepted only if energy drops).

### Core B on Final, saddle kick, weld shrink, seam hinge

"B-real" = core B, elastic 0.0011 (real steel), temper ×1 both ends (real
1 mm bending), bending floor 1. Square 300, pressure 100, Geo 1 slider.

| Run | Change | Time* | Height | Stretch | Folds >20° | >40° | Max | By eye |
|---|---|---|---|---|---|---|---|---|
| b-fin-sq | B-real, **Final** | 103 s | 124 | 10.8 % | 0.80 % | 0.14 % | 57° | clean smooth pillow |
| b-fin-tri | B-real triangle, Final | 86 s | 64 | 19.2 % | 0.02 % | 0 | 35° | smooth, rim crinkle one side |
| kk-m-4 / kk-m-3 | + static_kick 1e-4 / 1e-3 | 61 / 208 s | 124 / 140 | 12 / 18.5 % | 1.5 % | 0.5 % | 75° / 71° | pillow; a big kick is absorbed as stretch |
| kk-f-3 | kick 1e-3, Final | 398 s | 144 | 25.6 % | 0.70 % | 0.11 % | 57° | pillow |
| ws-a05…a2 | XPBD core + weld_shrink 0.5–2 % | ~80 s | 130 | 10 % | 1.0–1.2 % | 0.2 % | 70° | no change (XPBD absorbs it) |
| ws-b1 | B-real + weld_shrink 1 % | 72 s | 124 | 11.4 % | 1.35 % | 0.35 % | 58° | pillow |
| **ws-b2** | B-real + **weld_shrink 2 %** | 88 s | 120 | 13.1 % | 2.17 % | 0.49 % | 111° | **big folds at corners and sides — first large features** |
| ws-b25 / ws-b3 | 2.5 / 3 % | 57 / 47 s | 123 / 124 | 40 (cap) / 27 % | 2.7 / 3.0 % | 0.5 % | 154° / 100° | big tucks, corners twist and flip — messy |
| ws-tri2 / ws-tri3 | triangle 2 / 3 % | 36 / 40 s | 62 / 60 | 17 / 25 % | 0.8 / 1.0 % | 0.1 / 0.2 % | 57° / 87° | folded tips, modest |
| wc-* | shrink applied to corner ties too | | | | | | | (rerun; wc-sq3 dropped out) |
| sh-b1 | B-real + **seam_hinge 1** (yield ×4) | 95 s | 121 | 21.3 % | 3.0 % | 2.0 % | 65° | crisp line beside the weld all round |
| sh-b1-y1 | seam_hinge 1, yield ×1 | 94 s | 125 | 16.7 % | 2.8 % | 0.4 % | 66° | same, softer |
| sh-b1-w2 | seam_hinge 1 + weld_shrink 2 % | 100 s | 121 | 23.4 % | 2.8 % | 1.3 % | 91° | rim wavy and irregular |
| sh-tri-b1 | triangle, seam_hinge 1 | 108 s | 56 | 20.7 % | 2.0 % | 1.75 % | 54° | **rim crinkle gone**, clean edge line |
| sh-a1 | XPBD core, Geo 0.5, seam_hinge 1 | 18 s (alone) | 121 | 11.1 % | 2.5 % | 1.9 % | 68° | crisp rim line, cleaner edge |

*parallel batches of 4–6.

- New knobs (all default 0/off): `static_kick` (saddle escape),
  `weld_shrink` (TIG bead shortening; seam rest length × (1 − s), corner ties
  too), `seam_hinge` + `seam_hinge_yield` (Guy, session 8: the seam resists
  opening like a book — before this the top and bottom sheets met at a
  **free hinge**, zero resistance).
- **Weld shrink is the first thing that makes big features** (core B only).
  The seam hinge gives the real welded-edge line and removes the rim
  crinkle (the "edge ripples" Guy found inaccurate). The folds >40 % number
  now includes that rim line.
- Some parallel runs drop out silently (no output folder, no error; e.g.
  k-y01, wc-sq3, sh-a1). Alone they run fine. Re-run any that drop out.

### Weld shrink rejected as physics (Guy) · seam hinge + free seam

- **Guy: a seam welded all round two stacked sheets cannot shrink.** So
  `weld_shrink` is not physical; kept as an experiment knob, default 0, not
  to be used for the look. What it showed: big folds appear once the edge
  has more metal than its path allows — in a real piece that has to come
  from the inflation drawing the edge in, not the weld.
- Fully physical test: core B, real 1 mm steel, seam_hinge, **weld_free_z 1**
  (core B now re-centres the seam height like core 0). Square 300 Medium,
  pressure 100, ~60 s each (3 parallel):

| Run | Change | Seam length | Seam height | Folds >20° | Max | By eye |
|---|---|---|---|---|---|---|
| sh-b1 | seam_hinge 1, seam locked flat | −0.28 % | 0 | 3.0 % | 65° | pillow, crisp rim line |
| fz-sq | + seam free in z | −0.10 % | −0.6…+2.4 mm | 3.3 % | 97° | pillow, slightly wavy rim |
| fz-sq-h2 | seam_hinge 3, free z | −0.15 % | −4.2…+1.7 mm | 3.4 % | 97° | same, a bit wavier |
| fz-tri | triangle, seam_hinge 1, free z | | | 2.0 % | 55° | clean, no change |

- The seam keeps its length (−0.1 %, was −2.2 % on core 0) and does wave
  up and down, but only a few mm — not the reference zig-zag.

## 2026-10-22 (session 9) · Below-yield pressure with the Steel solver (Guy's best triangle)

Guy's app screenshot (closest yet to side tucks, one side only): Steel
solver, Seam stiffness 50, pressure **74**, 0.6 mm, Balloon ↔ Geometric 15,
ripples 0, ridges 0. Idea: below yield the sheet can't stretch into a
pillow, so the spare edge metal must fold.

| Run | Settings | Height | Stretch | By eye |
|---|---|---|---|---|
| k70-0 | B-real (temper ×1, floor 1), square, p70 | 95 | 18.7 % | (p70 is not below yield with temper ×1) |
| k70-k3 | + static_kick 1e-3 | 114 | 19.0 %, never settled | — |
| k70-k33 | + static_kick 3e-3 | 212 | 40 (cap), **burst** | — |
| gt-p66 | Guy's app settings, triangle 300, p66 | 27 | 4.1 % | smooth, faint rim marks |
| gt-p74 | same, p74 | 48 | 35.9 % (tip hot spot) | rolled rim, rough band along one side — mesh-scale, symmetric otherwise |
| gt-p82 | same, p82 | 54 | 20.4 % | rolled rim, smooth |
| gs-p74 | same, square 300, p74 | 108 | 22.4 % | pillow with rolled rim |

- The CLI does **not** reproduce Guy's crumpled side: its runs are smooth and
  symmetric. His came from the live app — likely the inflation path (how the
  slider moved), the mesh setting, or the seed. Need his project file.
- Pressure 66 → 74 → 82 on the triangle jumps from 4 % to 20–36 % stretch:
  "100 = yielding" is not true on the Steel solver at 0.6 mm; yield is
  around 70 here. The band where the sheet is full but not stretching is narrow.
- Saddle kick ≥ 3e-3 bursts the piece; 1e-3 never settles. Not the lever.

### Pressure steps and plates (Guy's second screenshot: plates on, 100 mm)

New CLI option `--stages 40,55,66,74` (settle at each pressure, then raise —
the app's slider path; pressure only goes up in the app).

| Run | Change | Height | Stretch | By eye |
|---|---|---|---|---|
| st-a / st-b / st-c | triangle 300, steps 40-55-66-74 / 60-74 / 66-70-74 | 47 | 28–35 % | **same as straight to 74** |
| ss-a | square 300, 40-55-66-74 | 103 | 40 (cap) | pillow, rolled rim |
| pt-600 | triangle 600, plates 100 | 100 (on plates, 13 %) | 18.5 % | smooth, rolled rim, no tucks |
| pt-300 | triangle 300, plates 50 | 48 (didn't reach plates) | 35.9 % | = gt-p74 |
| ps-300 | square 300, plates 50 | 50 | 40 (cap), never settled | **blew up** — Steel solver + plates unstable on the square (bug) |

- The slider path doesn't matter on the Steel solver (quasi-static).
- Guy's tucked triangle: settled in 33 frames at 4.9 % stretch, 100 mm on
  plates at pressure 74. Ours at 600 mm took 140 frames and 18.5 %. Size
  or another setting differs — waiting for his project file.

### Guy's project file and the analysis (see docs/TRIANGLE_ANALYSIS.md)

`runs/guy-tri` = his triangle (800 mm across corners, 0.19 mm, Balloon 1,
pressure 77, clamp on, Steel solver, Seam 50). Clamped it holds at 69 mm,
1 % stretch, smooth; after release it shoots up and **frame ~70 (125 mm, 7 %)
has the side folds** he paused on; it then runs to 194 mm / 39 % and the
folds stretch into lumps. New tools: `scripts/edge_excess.py` (spare edge
length and draw-in by depth), `render_run.py run@frame`.

## 2026-10-22 (session 9) · Buckling-mode seeding — built; the pillow is stable

Built in core B (all default off; `BLOWN_MODES=<file>` prints the checks and
dumps the shapes; `scripts/show_modes.py` draws them):
- `mode_seed` / `mode_seed_at` / `mode_count` / `mode_iterations` /
  `mode_check_frames`: every few frames, subspace inverse iteration on the
  **full** Hessian (compressed links' negative transverse term and the
  pressure term kept), whole-body moves and the inflate direction projected
  out, Rayleigh-Ritz on the stiffness alone. Seeds only when a shape is
  actually unstable.
- `compressive_yield`: links yield when squeezed too (welds excluded).
- `plastic_tangent` (check only): yielding links get 2 % stiffness along
  themselves (flowing metal is soft, why deep-drawing flanges wrinkle).
- `youngs_over_yield` now tunable (temper: same E, higher yield).
- Meters: `scripts/edge_strain.py` (strain along/across the edge band by
  depth), `edge_excess.py`, `render_run.py run@frame`.

Triangle/square 300, 0.6 mm, Geo 0.15, Steel solver, seam 50, Medium:

| Run | Change | Height | Stretch | Edge draw-in | Unstable? |
|---|---|---|---|---|---|
| ms-t3 | seed checks after ramp, p70 | 33 | 10 % | 4 mm | no — lowest shapes are whole-dome swell/rock/twist |
| ms-t8 | checks during the ramp | — | — | — | no (frame 0 "unstable" = flat sheet floppy) |
| ms-t4 | + 304 hardening | 31 | 6 % | 4 | no |
| ms-b1/b2 | 0.1 mm Balloon triangle / circle | 47 / 27 | 17 / 2 % | — | no |
| cy-t | + compressive yield | 32 | 5 % | 4.5 | no |
| ht-t70/t90/s70/s90 | + hard temper (ey 0.004, E/σy 250) | 39/61/104/121 | 3.5–6.7 % | 6 | no |
| cap-t90 / cap-s90 | + stretch capped 1 % | 60 / 118 | 1 % | **14 / 24** | no — spare edge metal yields in compression instead |
| pt-s90-free | + plastic tangent in the check | 121 | 6 % | — | yes at frame 20, but shapes = corner glitch + whole-dome bulge; look unchanged |

- Edge band strain (edge_strain.py): squeezed along the edge (−0.25…−0.33 %,
  2–3× yield strain) only in a strip ~10 mm wide; tension beyond. A strip
  that narrow is stable (needs width > t·√(3.6/ε) ≈ 17 mm).
- **Bending floor:** `min_bending_mesh_factor` 1 on Medium makes every sheet
  bend at least like ~0.45 mm (300 mm piece) to ~1 mm (800 mm piece); the
  classic default 12 like 1.5–3 mm. Balloon sheets (0.1–0.4 mm) can't make
  their fine waves at all. Fix needs a finer mesh along the welds.
- Conclusion: in the current model the smooth pillow is a stable resting
  shape under every setting tried; there is no hidden wave to seed. Next:
  validate the detector on a textbook case, finer weld-band mesh (balloons),
  Guy's CAD-flatten targets.

## 2026-10-22 (session 9) · Guy's research brief (Rev B): benchmarks — gross shape is wrong

New `scripts/benchmarks.py` (area ratio, Mylar circle R/R0 and H/R, teabag
V/side³). Full write-up and the KIT recipe in `docs/REFERENCE_SOLVER.md`.
Mylar circle fails on both solvers (Steel 0.99 / 0.18, classic 0.96 / 0.42
vs exact 0.763 / 1.198); teabag 0.17–0.20 vs 0.2055. Cause: the rim must
shorten ~24 % by crimping; our weld can't shorten and the sheet resists
squeezing. Free-in-compression test: 0.886 / 0.81, area 0.97 — right
direction. Recommendation: OpenRadioss reference copying KIT's recipe.

### Reference solver: KIT ring, first run (`ref/ring-0` -> `runs/ref-ring-0`)

Ø350/Ø35 mm, 0.8 mm 304, Medium BlownSim mesh (16,728 shells), 3 L water
over 50 ms, no mass scaling: 191,277 cycles, ~45 min, kinetic energy
0.2 % of internal (quasi-static). Height 4 -> 68 mm; peak plastic strain
0 -> 79 % (over-filled at the end).
- **Matches KIT qualitatively:** the outer edge buckles circumferentially
  from frame ~24 (34 mm, 1.8 L) and grows into big folds; the hole opens
  smoothly, no buckles.
- To check: buckles gather at left/right of the ring (mesh lattice
  direction?); fill less (~2 L) or add a pressure limit; try a finer weld
  band and mass scaling (now default in kit_deck.py).

## 2026-10-22 · Session 10 · Reference solver on Guy's shapes

### Square 300 mm, 0.8 mm (`ref/sq-0` -> `runs/ref-sq-0`)

Medium mesh (15,856 shells), 4.5 L water over 80 ms, fixed volume (written
before the stop-at-target runner). 111,113 cycles, ~30 min alone (the first
minutes shared the CPU with two other runs: three at once is ~8x slower each,
so run them one at a time). Mass scaling adds 49 % mass (cells < 4 mm).
- Pressure 0.32 bar at 0.8 L, 0.74 bar at 2.7 L, 1.06 at 4.1 L, 1.6 bar at
  4.6 L (stiffens near full). Height 105 mm at the end; V/side^3 0.17
  (teabag limit 0.2055); area ratio 1.0002 (no stretch overall); peak
  plastic strain 43 % (corners).
- **Look:** sides draw in, corners pinch up into ears, long folds fan out
  from every corner (zebra). This is the gross shape the Fast and Steel
  solvers miss.
- **Not yet:** the real Geometric square (`Refrence images/Geometric/image1.JPG`)
  has one V-tuck in the middle of each side. The perfect, symmetric
  reference model doesn't pick a place to buckle. Next: a small seeded
  imperfection (flatness noise of ~0.1 t, or weld residual stress as KIT
  found it changes where buckles start).
- The app's slider-70 target for this piece would be 2.8 bar (regime number
  0.27): beyond what 4.5 L reached, so slider pressures read high on the
  reference. Height targets are the safer stop for now.

### Guy's triangle, 693 mm, 0.19 mm, slider 77 (`ref/ref-tri` -> `runs/ref-tri`)

First run through the app's own pipeline (`blown-cli ref-run`). Medium
mesh (15,868 shells), target 0.58 bar; **stopped itself at frame 36,
26.8 min**. Pressure stays tiny while it fills (0.03 bar at 10 L, 0.1 bar
at 14.6 L / 194 mm), then climbs fast: 0.22 -> 0.44 -> 1.03 bar over the
last three frames (16.6 L, 228 mm, peak plastic strain 40 %).
- **The Geometric look appears**: one side buckles into a deep V-tuck at
  its middle (from frame ~18, height ~95 mm), and around frames 20-28 the
  lower edge carries a row of even small waves (the "even waves of X per
  side" in the reference triangles). Folds fan from the tips (zebra).
- Only one side tucks (the symmetric model picks one; real pieces tuck
  every side): seeded imperfection next, as for the square.
- Frames ~25-30 (150-190 mm, 18-28 % strain) look most like the photos;
  the last frames are over-blown. Slider 77 -> 0.58 bar is too far for
  0.19 mm: the pressure scale needs calibrating to the reference.

### Guy's medium leaf, 254 x 388 mm, 0.8 mm, height 80 mm (`ref/ref-leafm` -> `runs/ref-leafm`)

Medium mesh (18,884 shells, mass scaling +167 %); **7.1 min**, stopped
itself at 80 mm (frame 22, 1.74 L, 0.85 bar).
- Smooth, full pillow everywhere except the inward notch on the upper left,
  which pulls in and folds into a pinched tuck: the stretch gathers there
  (zebra lines converge on it), like the notches in the Lyrae photo.
- **Peak plastic strain 98 %** at that notch from frame ~18 (59 % at
  43 mm): unrealistic for steel (304 ~ 45-60 % at break). The notch is a
  sharp re-entrant corner in the mesh; the real weld rounds it. To check:
  where exactly (one element or a region), a small fillet / finer mesh at
  notches, and whether real pieces split there.

### Square with uneven sheets (`runs/ref-sq-imp05`) — one change from `ref-sq-0`

Only change: each sheet up to 0.5 mm out of flat (smooth random waviness,
wavelengths 1/8-1/2 of the size, seed 1, `--imperfection 0.5`). Same mesh,
water rate and time; stopped at 104 mm (frame 36, 4.1 L, 1.19 bar),
**17.0 min**.
- **Big change:** one side buckles into a deep V-tuck at its middle (as in
  `Refrence images/Geometric/image1.JPG`), and the opposite side starts one
  by the end. The corners no longer pinch into ears; the side draw-in is
  taken up by the tucks instead.
- Still one tuck clearly formed (photo: all four sides). Peak plastic strain
  67 % at the tuck root (flat run 38 % at the same height): high for 304.
- Next single changes to try: amplitude 1 mm; another seed (same
  amplitude) to see if the tuck count is luck; then the triangle and leaf
  with whichever wins.

### Square, sheets 1 mm uneven (`runs/ref-sq-imp10`) — one change from `ref-sq-imp05`

Only change: `--imperfection 1.0`. Stopped at 106.6 mm (frame 27, 3.1 L,
1.0 bar), **15.6 min**; peak plastic strain only 11 %.
- One deep tuck on one side, but the whole surface goes lumpy and dimpled
  (zebra full of blobs): too uneven for a polished piece.
- Re-read of 0.5 mm from above: tucks at the middle of **two** opposite
  sides (top and bottom), closest to the photo so far.
- **Verdict: 0.5 mm wins.** Next: same 0.5 mm, seed 2 (is two tucks luck?),
  then the triangle and leaf at 0.5 mm; then make it the app default.

### Square, 0.5 mm, seed 2 (`runs/ref-sq-imp05s2`) — one change from `ref-sq-imp05`

Only change: `--seed 2`. 25.6 min (shared the CPU with app tests).
- One clear mid-side V-tuck (right side) instead of two: the tuck *is*
  real (both patterns make mid-side tucks, as in the photo), the *count*
  depends on the sheet's unevenness, as it does in the workshop.
- To get tucks on every side: more pressure/fill past 104 mm, a finer mesh
  along the welds, or weld residual stress (KIT).

### Steel solver triangle unchanged (Guy: "can't get my good triangle back")

Guy's saved triangle settings on the build from before session 9's solver
changes (4d72d59) and on today's: 307 frames each, positions equal to
0.00002 mm. The look he liked (even edge ripples) is a passing stage around
frames 50-70 (76-125 mm, 2-7 % stretch); it settles at 194 mm / 39 %
with the ripples gone. Scrub back, or stop at a target height ~100-120 mm.
