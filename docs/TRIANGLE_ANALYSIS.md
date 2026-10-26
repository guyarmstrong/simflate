# Geometric triangles and squares — analysis before the next solver step

_Session 9, 2026-10-22. Asked by Guy: study the reference triangles, model the
shape, work backwards, research, think it through before building._

## 1. What the references show

Triangles are the cells of the hexagon wall (`Geometric/Cd1G2_RW8AARDhc.jpg`,
`Geometric/Screenshot 2026-10-21 203956.png`); squares are the pillow wall,
the stacked fountain, the textured square, the chair.

- **The middle of each cell is a smooth dome.** All the character is in a band
  along each weld, about a tenth to a sixth of the cell size wide.
- **Along each side the band carries evenly spaced waves**, about 4–6 per side
  on the triangles. They are like a snake: the crest swings from side to side
  and the weld valley between two cells weaves with it. The spacing is even
  along the middle of the side and tightens toward the corners.
- **Corners pinch to a point.** From each corner a long straight valley runs
  inward (the "spokes" of the hexagon wall).
- **Squares:** fewer, bigger features. 1–3 V-tucks per side, where the weld
  itself is folded inward in plan (`image1.JPG`: a V-notch in the weld at
  mid-side). A V-notch of width w and depth D stores 2√((w/2)² + D²) − w of
  extra weld length: on `image1.JPG` about 2–3 % of the side per tuck.

## 2. Guy's project (`Test Project files/Untitled Rev A.blownsim`)

Triangle 800 mm across the corners (sides 693 mm), 0.19 mm, Balloon end (1),
pressure 77, **Clamp while inflating on**, Steel solver, Seam stiffness 50,
Medium. He **paused it partway through the inflation**.

The same thing on the CLI (`runs/guy-tri`; frames rendered with
`render_run.py runs/guy-tri@N`):

| Frame | State | Height | Stretch | Edge draw-in (mid-side) | Look |
|---|---|---|---|---|---|
| 20–45 | clamped, settled | 63–69 mm | 0.8–1.3 % | 5 mm | smooth |
| 55 | clamp released, starting to rise | 76 | 1.6 % | — | almost smooth |
| **70** | **rising fast** | **125** | **7 %** | **23 mm** | **folds along the sides** — what Guy paused on |
| 100 → end | keeps rising | 158 → 194 | 15 → 39 % | — | folds stretched into lumps, burst-like |

So the folds **appear during a fast rise, when the sheet suddenly has spare
edge metal**. If the run carries on, the stretch smooths them out again.

## 3. The physics (research)

- **Why the edge has spare metal.** The pillow's middle rises; a sheet that
  can hardly stretch has to pull its edge inward to do that, more at mid-side
  than at the corners. Lines along the edge get shorter than the metal on
  them ("laterally stretched and longitudinally compressed"; Vetter et al.,
  ETH, *Simulating thin sheets*, which reproduces folds at the middle of each
  edge of a square pillow, **pressurised suddenly**). Mylar cube balloons do
  the same, with wrinkles at right angles to the edges (Paulsen, *Wrapping
  liquids, solids and gases in thin sheets*). Where the sheet can't
  compress, it must wave (tension-field theory).
- **What sets the spacing.** Bending stiffness against the tension across the
  band: λ ≈ 2π·(B·L²/T)^¼ (Cerda & Mahadevan, *Geometry and physics of
  wrinkling*). Here B = E·t³/12(1−ν²), L = band width, T = tension across it.
  - 1 mm steel, band 50–80 mm, T 60–215 N/mm → **λ ≈ 130–240 mm → 3–5
    waves on a 600 mm side.** Matches the references.
  - 0.19 mm (Guy's file; the solver uses 0.12 mm bending at the Balloon end)
    → λ ≈ 30–70 mm → 10–20 waves per side.
  - Thicker or lower tension → fewer, longer waves. Spacing depends on t^¾,
    so it is very sensitive to thickness.
- **When they're decided.** At low pressure, when the tension is low and the
  sheet is still elastic. Later pressure raises the tension (which would want
  shorter waves) but the waves have already set plastically, so they keep
  their early, longer spacing and just get sharper. This is why real pieces
  have fewer, bigger waves than the end-state tension would give.
- **How even they are.** Evenness comes from the sheet picking its natural
  buckling mode, which is periodic along a straight side. A random start
  (our dents, kicks) gives an uneven, lopsided pattern; Guy's paused run is
  uneven for that reason.
- **Engineering practice (FE buckling).** Real metal-forming and shell
  analyses seed the nonlinear run with the **lowest buckling modes** from an
  eigenvalue analysis, not with random noise, because a perfect model
  otherwise stays on the symmetric path (our core B does exactly that).

## 4. Why our solver misses it

1. **Classic solver:** squashes in-plane (~25× softer than steel), so the
   spare edge metal disappears into compression instead of waves (session 8).
2. **Steel solver:** can't squash, but a quasi-static Newton solve follows
   the perfectly symmetric path. Nothing tells it which way to buckle until a
   sudden jump (clamp release) shakes it, and then it buckles randomly and
   lopsidedly.
3. **Too much stretch afterwards:** at pressure 77+ the sheet keeps stretching
   (15–39 %). Real 304 hardens fast and stretches a few %, so real pieces
   keep the waves; ours stretch them out.
4. **Too little draw-in:** clamped, our mid-side draws in 5 mm (0.2 % spare
   edge length); the reference tucks need several %.

## 5. Proposed plan (one variable at a time, measured and looked at)

A. **Buckling-mode seeding in the Steel solver.** At low pressure, find the
   sheet's softest buckling shapes from the solver's own stiffness matrix
   (it already has it; add the pressure term, left out so far), and nudge
   the sheet along them. This is the standard engineering method; it should
   give the even waves along each side, with their number set by thickness
   and size rather than by chance. Deterministic (same seed → same piece).
B. **Real 304 hardening on** (`stretch_hardening 1`) with the Steel solver,
   so the sheet stops stretching and has to draw in and keep its waves.
C. **Fast inflation step** (pressure applied quickly, like the ETH pillow and
   Guy's paused run) as a second way to trigger the pattern, if A alone is
   too gentle.
D. **Measures:** waves per side and their evenness (new meter, from the edge
   band's height along each side), spare edge length and draw-in
   (`scripts/edge_excess.py`), stretch, plus renders against the hexagon
   wall cells (triangles) and `image1.JPG` (square).

Checks: 300 mm and 693 mm triangles, 300 mm square, at 0.19, 0.6 and 1 mm;
expected wave count per side from §3 vs measured.

## 6. Guy's suggestion (logged, session 9)

Model a reference triangle in CAD exactly as it looks in the photos, then
flatten its faces and compare with the drawn outline: that measures the
real spare edge length, draw-in and stretch directly (the "work backwards"
numbers), to set targets for the solver.
