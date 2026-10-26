# Prior art: how inflation is simulated today, and what BlownSim borrows

Short notes for the solver, the controls and the smoothing. Written at the start
of Phase 0 from general knowledge of these tools; refine as we test.

## Houdini — Vellum

- **Method:** XPBD (extended position-based dynamics). Cloth is a set of
  *distance* (stretch) and *bend* constraints with a stiffness/compliance each,
  solved iteratively with substeps. Inflation is a **pressure constraint**
  (a target volume scaled up over time) or a velocity/force push along normals.
- **Plasticity:** stretch and bend constraints have a plastic threshold and rate.
  Past the threshold the *rest* length/angle moves toward the current shape, so
  folds become permanent. Artists use this for crumpling cans and steel sheet.
- **Crease control:** pre-scored lines get a lower bend stiffness or a rest angle.
  "Stopped"/pinned points keep seams in place.
- **Borrowed:** the whole solver family (XPBD with substeps); plastic rest
  updates for stretch *and* bending; pinned weld points; per-constraint compliance
  derived from physical stiffness so results don't depend on iteration count.
- **Not borrowed:** volume-target pressure. Metal needs *pressure* as the control
  (load stepping), with volume as the result.

## Cinema 4D — Cloth tag (2023+ solver)

*Rewritten in v2 (2026-10-21) from Maxon's parameter list; the first version
of this note was from memory and wrong.* Guy rates C4D as the most accurate
inflation tool he knows.

- **Method:** position-based cloth (same family as Vellum and BlownSim) with a
  Balloon option: *Overpressure* and *Expansion Time* (how fast the pressure
  comes up).
- **Material:** Stretchiness, Bendiness, Thickness (collision thickness, so
  folds can lie on each other — self-collision), Target Length (+ map; shrink
  the cloth to gather it into wrinkles), Mass.
- **Plastic deformation**, separately for bending and stretching: *Deform Past*
  (yield), *Strength* (rate) and **Hardening** (each yield makes the next one
  harder).
- **Borrow:** hardening (folds spread instead of sharpening), self-collision
  for fold-over pleats, expansion time, target length as an art control. See
  `docs/TUNING_LOG.md`.

## Blender — cloth with internal pressure and plasticity

- **Method:** mass-spring cloth with *Internal Springs* and *Pressure*
  (constant or target volume). Plasticity was added to cloth (shrink/plastic
  settings) so deformation can stay.
- **Pain points:** fiddly setup, slow on fine meshes, tuning per shape.
- **Borrowed:** pressure as a force on triangle normals (area-weighted per
  vertex); the idea of a "shrink" factor, which we use only in Soap film mode.

## SketchUp — Soap Skin & Bubble

- **Method:** relaxes a grid between boundary edges toward a minimal surface
  (soap film), with a "bubble" pressure term.
- **What's right:** dead simple: select edges, set pressure, generate. This is
  the UX benchmark.
- **What's missing:** no stiffness, no creases, no plates; boundaries are fixed.
- **Borrowed:** the control list (shape, pressure, go); a Soap film mode for
  comparison and a fast first preview; simple solve mesh → smooth render mesh at
  the end.

## Research — inflating near-inextensible sheets

- Sealed, near-inextensible envelopes (Mylar balloons, inflated paper/plastic
  pillows) **cannot stretch to dome**, so they shorten their perimeter by
  **wrinkling and crumpling** near the seam. The welded edge length is fixed;
  the cross-section wants to pull it inward.
- Experiments and simulations on sealed sheets show **localized sharp crumples
  at low pressure turning into smoother, more regular wrinkles at higher
  pressure**, once the material starts to stretch.
- The "Mylar balloon" shape (a flat circle inflated without stretching) has a
  known analytic profile: a lens much flatter than a sphere, with a ruffled rim.
- **Borrowed:** this is exactly the Balloon ↔ Geometric axis. In BlownSim,
  *Character* sets the sheet's yield tension and bending stiffness relative to
  pressure: low character = yields broadly (balloon, smooth wrinkles); high
  character = barely stretches (geometric, crumpled).

## Inflated steel in practice

- Zieta's FiDU process (stools, sculptures) inflates welded thin steel with
  water or air at roughly 3–50 bar. Full Blown has inflated stainless since 1995.
- Real pieces show: edges drawn inward between corners, diagonal creases into
  corners, crumpled rims where a plate stops the dome, permanent creases.

## Decisions taken from this

| Area | Decision |
|---|---|
| Solver | XPBD shell: stretch (elastic → yield → strain cap), dihedral bending (elastic → plastic hinge), pressure along normals, plates as half-spaces with friction. Same family as Vellum. |
| Weld | Weld points shared by both sheets, kept on the weld plane, free to draw inward (or pinned with *Fixed outline*). The seam can't change length. |
| Imperfection | Seeded smooth noise in initial shape and rest lengths, so creases form naturally and repeatably. |
| Controls | Pressure (or target height), Character, Plates, Draft/Final, Outline draws-in/fixed. Everything else in Advanced. |
| Smoothing | Keep Soap Skin's "simple solve mesh → smooth render mesh" pipeline, but crease-aware (Loop subdivision with sharp creases + Taubin smoothing masked off creases). Phase 2. |
| Accuracy | Visual, judged against photos. No FEM. |
