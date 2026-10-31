# How to test Simflate

Everything here is double-click or one command. You never need to edit code.

Your drawing and settings are saved automatically and come back next time you open the app.

## Opening the app

| What | How | What you should see |
|---|---|---|
| **The app** | Double-click **Simflate** on the desktop | A black console window (leave it open — it's the development setup; the installed app has none), then the **start-up screen** (big icon, "Simflate", progress bar) and the Simflate window. After a code change the first start rebuilds for a minute or two. |
| **Re-run the test shapes** | Double-click **`Run test shapes.cmd`** | A console counting frames for the test runs. Then Forms → Test runs. |

To close: close the app window, then the black console window. The version
(Simflate v1.11) is at the bottom of the start-up screen and when you hover
over "Simflate" in the top bar.

If something goes wrong a **crash window** says so: your work is autosaved;
**Copy report** or **Save report** and send it to Claude; **Keep working** or
**Reload**.

> Advanced (optional): from a terminal in this folder, `npm run app`, `npm run preview`, `npm run suite`, `npm test`.

## 1 · Draft — what to try

1. **Draw a rectangle by dragging.** Pick the rectangle on the left (or press **M**) and drag on the board. Hold **Shift** for a square, **Alt** to draw from the centre.
2. **Draw by typing.** With a shape tool, **click once** (don't drag) → a box asks for exact width/length (or diameter, or radius + corners for a polygon).
2a. **New shapes** (session 11), on the left:
   - **Triangle** (**R**): a switch at the top (and in its size box) between **Equal sides** and **Unequal**. Unequal: type a base and its two angles; on the board each **side length** and each **corner angle** shows as a label — click one and type. A new angle swings that corner's second side round like a hinge (both side lengths at that corner kept); a new length slides the far corner along the side. Rotate it and the labels follow.
   - **Diamond** (**D**): width and length, as usual.
   - **Pill** (**O**): width, height and corner **radius**, each on its own (radius of half the height = round ends). Stretch it and the corners stay truly round; **R** in the top bar or the **R** label on the board changes the radius.
   - **Circle**: one **Ø diameter** dimension; it only ever scales evenly.
   - **Egg** (**G**): click on the board → a wizard: **Egg / Peanut / Ant** presets, or up to four parts in a row, each with length, width and a **fat end** slider (left · even · right), joined at a **waist** width. Live preview.
   - **Pebble / star** (**S**, under Polygon; session 20): no drawing — a wizard opens straight away. **Pebble / Starfish / Star** presets (first time it opens on Pebble), a live preview, then **Points**, **Size**, **Inner** (valleys as a % of the tips: near 100 = pebble, low = arms), **Tip / Valley rounding**, **Edges** Sharp · Rounded (bowed out) · Flowing (bowed in) · Wavy, **Edge curve**, **Organic** and **New variation**. OK puts it in the middle of the board. Try going from Pebble to Starfish to Star with the sliders alone.
   - **Text** (**T**, the **A**): click on the board → type a few letters, pick a **font** from this computer, **Bold**, and the **height of the capitals** in mm. More than one letter warns that each letter is its own piece (longer to inflate). On the board, **Height** in the top bar scales it evenly.
2b. **Pen and Shape builder** (session 12), at the bottom of the tools:
   - **Pen** (**N**), **Points**: click for a corner, click-and-drag for a curve (Alt while dragging bends only the outgoing side), **Shift** keeps a line to 15° steps; points snap like weld lines. Click the **first point** to close it into an outline; press **Enter**, or click the last point again, to leave it open (a weld line). **Backspace** takes back the last point.
   - **Pen**, **Freehand**: just draw with the mouse held down. End near where you started and it closes into a smooth outline; otherwise it's an open weld line.
   - **Builder** (**Shift+M**): draw two or three overlapping shapes, select them (or select nothing to use every outline), pick Builder. The regions they make show dashed; the one under the mouse lights up. **Click** a region, or **drag across several**, to merge them into one shape; **Alt**+click / Alt+drag deletes regions (red). Whatever is left over becomes separate pieces, like Illustrator. Anything that has been through the builder is a fixed **Built shape** — like an imported DXF you can only move, scale, stretch (W / L) and rotate it.
3. **Polygon corners.** Choose the polygon tool (**P**); type the number of corners in the bar at the top, or press **↑ / ↓ while dragging**.
4. **Dimensions.** A selected shape shows its **width** (horizontal) and **length** (vertical), measured between its two furthest points. **Click a number, type a new size, press Enter** — the shape scales to exactly that size.
   - The **chain link** — just off the shape's bottom-right corner on the board, and between W and L in the top bar — linked = the whole shape scales evenly; broken = only that direction stretches.
5. **Rotate.** Drag the round knob above the shape, or just outside a corner (**Shift** snaps to 15°), or type an angle in **∠**. The dimensions stay horizontal/vertical, showing the overall size of the rotated shape.
6. **Scale freely**, then type a dimension again → it snaps back to exactly that size.
7a. **Paste from Illustrator or Word** (desktop app): select a shape there, **Ctrl+C**, come back to Draft, **Ctrl+V** (or Edit → Paste). It lands in the middle of the view at its real size (Illustrator: as drawn; Word: the shape's size on the page) as a fixed outline, like an import. **Ctrl+C / Ctrl+X / Ctrl+V** also copy, cut and paste shapes inside BlownSim (Edit menu too). In the browser version only Illustrator copies paste. **Edit → Illustrator pastes: real size | DXF mm (×2.83)** — a DXF opened in Illustrator comes in 2.83× small (Illustrator reads each DXF unit as a point), so pick *DXF mm* for those; each Illustrator paste's message also has a button to switch (and resizes that paste). Messages close with the **×**.
7b. **Palette order**: Import, Fit and Select at the top; then Weld line, Pen, Circle, Ellipse, Egg, Triangle, Diamond, Rectangle, Pill, Polygon; Text and Builder at the bottom.
7. **Import** a DXF, **DWG** (desktop app; AutoCAD 2000–2018+ files) or SVG (**File → Import**, the Import button on the left, or drag the file onto the window). Try a Pentagonal Nova part DWG: the Cone Hub comes in at 133 × 89 mm with its five holes. Type the real width into the dimension to scale it correctly.
8. **Cut-outs.** Draw a circle inside a rectangle → it becomes a welded cut-out (ring weld). The **Weld check** panel confirms "One sealed piece". Overlapping shapes turn red (welds can't cross).
9. **Weld lines (quilting).** Pick **Weld line** (or press **W**) and drag across a shape. It snaps to corners, centres, edge middles and edges (a small marker says which); **Shift** keeps it to 15° steps. Try a hexagon with lines from the centre to every corner, or a square with a cross. Weld lines that cross are welded together.
10. **Line types.** Every line is one of: **Outline** (the edge, welded all round — inside another outline it's a welded cut-out), **Weld line** (quilting seam inside the piece; open or a closed loop — a loop is welded round, *not* cut out) or **Construction** (switched off: dashed grey, ignored when inflating). Select any line and use the three-way switch at the top of the Shapes panel.
    - **Importing with welds on their own layer or colour:** try `samples/quilt-by-layer.dxf`, `samples/quilt-by-colour.dxf` or `samples/quilt-colours.svg`. A **Line types** window opens: one row per layer/colour, with the file's colour as a little swatch (only there — the board stays monochrome). Pick Outline / Weld line / Construction / **Leave out** for each; the preview and the weld check at the bottom update as you go. It guesses from layer names (WELD, SEAM, CENTRE, DIM…) and remembers your choices for next time. Reopen it later with **Line types…** in the Shapes panel.
    - **Importing everything on one layer** (`samples/quilt-one-layer.dxf`): no window; closed loops come in as outlines, open lines as weld lines. Fix by hand: **double-click** a line to pick it out (Shift+double-click for more, or drag a box *inside* the outline — it only grabs lines the box touches), then switch its type, or press **Delete** to remove it. **Same layer** selects everything from the same layer/colour.
11a. **Align.** Select two or more shapes (Shift-click, drag a box, or Ctrl+A): six align buttons appear at the right of the top bar — left / centre / right, then top / middle / bottom, lined up on the selection's outer box (like Illustrator). An imported drawing that is fully selected moves as one piece. Handy for centring a cut-out or weld line in an outline.
11. **Save your work.** The **New / Open / Save** buttons beside the menus (Save turns orange when there are unsaved changes), or **File** (top left, next to **Edit** and undo / redo) → Save (Ctrl+S), Save as (Ctrl+Shift+S), **Save as next revision** (makes "Name Rev B"), Open (Ctrl+O), New (Ctrl+N), Import DXF/SVG (Ctrl+I). Projects are `.simflate` files (older `.blownsim` open too): the drawing, settings, finish and colours. The orange dot by the name means unsaved changes.
11d. **Recent projects**: **File** lists the last few projects you opened or saved (newest first, with when); the empty Draft board shows them too — click one to open it. A project that has been moved or deleted drops off the list when clicked.
11e. **Export outline** (top right on Draft, beside Quick export PNG; session 20): **Selected** pieces or **All**, as **DXF** (AutoCAD, laser / waterjet) or **SVG** (Illustrator), real size in mm, Outline / Weld / Construction each on their own layer. Try `samples/export-test.svg` in Illustrator and `samples/export-test.dxf` in CAD. No DWG: open the DXF in AutoCAD and Save as DWG. **Ctrl+C** on the board now puts the selection on the clipboard as an SVG drawing: paste it straight into Illustrator (tell Claude if it arrives as text instead of shapes, and which Illustrator version).
11f. **If something goes wrong** (session 20): a damaged project opens without the broken shapes (it says how many). If the crash window keeps coming back after **Reload**, press **Empty board** — a copy of the last drawing is kept.
11c. **Quick export PNG** (top right): one click saves a sharp 4K picture of whatever the main view shows — the Draft board, the Inflate view or a form. The full exports (KeyShot, OBJ, STEP, STL) are at the bottom of **File**, and in Forms → **Export**.
11b. **Edit** menu (top left): Undo, Redo, Duplicate, Delete, Select all, Select none — with their shortcuts shown.
12. **Undo / redo**: Ctrl+Z / Ctrl+Shift+Z. **Delete**: Del. **Duplicate**: Ctrl+D. **Nudge**: arrow keys (Shift = 10 mm). **Fit to screen**: F.

## 2 · Inflate — what to judge

- **Changing the pressure or Target height inflates again from flat** (session 20; Fast, Steel, Specified geometric), so the same settings always give the same shape and a saved project reproduces what you saw. Lowering works too. Scrub the timeline to watch any run rise. Reference still raises its running engine.
- **Specified geometric**: past a realistic height for the shape (about half its narrowest width) a note says *Beyond realistic max height of N mm* — it's still built as asked.

Use the switch at the top: **Draft** → **Inflate** (pressure gauge) → **Forms** (blown cushion). Press **Inflate** (or click a preset) and watch it blow up live.

- **Presets**: Balloon, Pillow, Geometric, Soap film. Change pressure, character (or Advanced → bottom stiffness / soap) by hand and the title and the **Custom** chip show you've left the preset. Plates are separate: any preset works with Plates on or off; switching Plates on fills in a gap that suits the shape (20 % of its narrowest width).
- **Brushed** and **Heat tint** settings: click the finish again to open its panel. Brushed: grain **direction** and **grain size** (the grain is laid on the flat sheet and follows the metal as it inflates). Heat tint: pattern **size**, **position** across / up, and **colour range** (straw only ↔ through to blue).
- **Weld** (materials palette on the left, under the finishes): turns the TIG weld on or off round the outline and every hole. On polished / mirror / brushed / bead-blast it shows the weld bead with the heat-tint rainbow of an unpassivated weld (blue → purple → bronze → straw, fading out). With a colour (PVD / iridescent / heat tint) it shows a bare polished stainless seam where the welding burnt the coating off. Internal laser weld lines stay clean. Try `samples/rounded-tag-with-hole.dxf`. Is the band the right width and colour compared with Full Blown photos?
- **Pressure** slider: raising it carries on from where it is. Lowering it does nothing until **Re-run** — creases are permanent, like real steel.
- **Pressure sets how much it inflates** (session 4): the slider is spread evenly — on a 300 mm square, 20 ≈ 12 mm tall, 30 ≈ 35, 40 ≈ 67, 50 ≈ 92, 60 ≈ 111, 77 ≈ 130, 100 ≈ 145. Presets and older projects were converted so they inflate exactly as before (their numbers look higher now).
- **Target height** (Inflate by → Target height): type e.g. 20 mm — it eases the pressure up and brakes, settling close to what you typed (usually within a millimetre or two; it's a target, not a guarantee). If a shape can't get that tall (quilted pieces) it stops at full pressure.
- **Sharp corners** (session 5): welded tips sharper than a right angle now stay stiff — the tip keeps its drawn shape and stays low instead of pulling in to a needle and spiking up. Try a triangle or a star on Final. Square corners still pucker as before.
- **Crumpling fixed** (session 5): Final-mesh pieces (especially in Target height mode) could suddenly crumple on one side. That came from a jolt in the first frames; it's gone. If you ever see it again, note the shape, mesh and settings.
- **Thickness**: slider 0.1–3 mm; type any value down to 0.01 mm in the box.
  - **Show at the edges** (switch under it): on = the smooth mesh shows both sheets and their cut edge at tips and corners; off = thin sheets meeting at a sharp edge. Look only — flipping it re-smooths, it doesn't re-inflate. Exports follow it.
  - Zoom into a tip with the **Mesh** look: the cut edge should be a clean, even band (no sawtooth lip where it meets the sheet). At the very tip the edge is rounded (the weld's rounding carries right round the point); it sits up to one sheet thickness outside the drawn outline there.
  - **Welds on**: the TIG pulses (ripples on the bead) are evenly spaced all the way round, about 1.6 mm apart; when zoomed out far they fade away rather than turning into uneven stripes.
- **Small windows**: drag the window to half the screen — the right panel stays on screen, the top bar goes icon-only (hover for names) and the bottom bar keeps Frame and Height.
- **Character**: Balloon (soft, rounded) ↔ Geometric (stiff, faceted). Underneath it shows the sheet thickness this behaves like at your piece's size. Changing it re-runs straight away.
- **Edge ripples**: pleats where the metal is squeezed along a weld (the ripples beside welds on quilted panels, the pleats round a pill's rim). Spaced by the sheet thickness. Shown on the smooth mesh; moving it re-smooths without re-running. Quilted cells are small, so push **Pressure** to 100.
- **Outline**: *Draws in* — the weld pulls inward and creases unevenly, like the real thing. *Fixed* — the piece inflates just as freely (same height, same creases), then the weld is laid exactly onto your drawn outline. Use it when a render needs the exact boundary.
- **Plates**: on/off and finished thickness — gives the flat-faced "pill".
- **Mesh** (one row right under Solver — solver and mesh decide the speed): *Draft* (fastest, rough creases — for finding the look), *Medium* (good creases, still quick — the default), *Final* (finest creases and smoothest render mesh — for exports, slower).
- **Changed the shape in Draft?** Going back to Inflate re-inflates the new shape straight away (Fast / Steel); on Reference the old piece is cleared and you press Inflate.
- **Imported curves** (session 13): DXF / Illustrator splines no longer tear the sheet (the spiky broken forms 1, 6 and 9 in *Atrium leaves*). Target-height runs keep going until they reach the height or full pressure; if the height is out of reach a note says so.
- **Looks** (left-hand column):
  - *Finish* (quick picks): polished, mirror, brushed, bead-blasted — rendered balls, wearing the colour you've picked.
  - *Colour* — a 3 × 2 grid: **Silver** (bare), **PVD** (stock presets, named: Gold, Rose gold, Champagne, Bronze, Black, Graphite), **Iridescent**, **Heat tint**, **Powder** (opaque paint: RAL presets, Gloss matt ↔ high, Texture Smooth / Fine / Hammertone, Metallic — hides the finish, covers the welds as a ridge, fills fine patterns) and **Candy** (coloured glass over the finish: Strength light ↔ deep; the finish and pattern show through, the colour deepens at the edges). The coats go **over** the finish (Brushed + gold PVD = satin gold, Bead-blast + blue = shot-blasted blue): **PVD** (any colour + presets), **iridescent** (beetle two-tone: one colour face-on, another where the surface turns away), **heat tint** (straw → bronze → purple → blue). The first square, **Silver**, is bare stainless (no colour) — one click back from any colour. Click a colour square to put it on (its settings open); click it again for the settings. The name under the squares says what's on.
  - *Pattern* — a pressed (embossed) sheet like the Steel Color catalogue, on any finish and colour: click the ball, pick **Linen, Dots, Chequer, Dune / 5WL, 6WL, Drops, Rain, Pearl** (or None); **Size** (mm), **Depth**, **Angle**, **Pressed in** (any pattern the other way: dots become dimples), and **Polished tops** (the raised parts polished back to bright steel, colour left in the hollows — Duna Blu, Goccia Rosso) with **Invert two-tone** (colour on the tops, polished hollows) and **Colour line** (where the two tones meet: whole bump ↔ just the tips). It stretches with the metal as it inflates; purely visual (the inflation doesn't change). It goes into the KeyShot export (normal map + colour).
  - *Analyse*: **zebra** (kinks in the stripes are kinks in the metal), height, **creases** (scaled to each piece, so the main crease always shows), **mesh** (triangles on black). The buttons are small rendered balls (lit by the Loft), like KeyShot's material library.
  - **Plate contact** (where the sheet touches the plates) has an eye like Plates and sits beside the **Plates** eye above the 3D view, only there when plates are on; click it again for your finish. Whenever plates come into use (switched on, or a solver that uses them) they are shown, even if you hid them before.
  - **Short or narrow screens:** both tool columns (Draft and Inflate) first shrink a little, then go two side by side (Inflate: Finish + Colour beside the drawing, Pattern and below further left), and only scroll after that. Try it by making the window shorter.
- **Smooth** (top right of the 3D view): once the piece is at rest it's turned into the smooth render mesh — creases and the weld kept crisp. Exports use it.
- **Save form** (camera button, or press **S**): saves the piece exactly as on screen to **Forms**.
- **Bottom bar** (a player over the recorded frames): first frame, one back, **replay**, one forward, newest — or ← / → keys. The track fills in as the run goes (bright = recorded, faint = still to come) and the status shows how far along it is ("Inflating 62 %", "Reference 40 %") for every solver. Stop the solver with **Stop** in the panel. **Polygons** at the far right = triangles in the mesh.
- **Graphics: Built-in | GPU** (top bar, Windows): which chip draws the 3D view. Your choice applies when BlownSim restarts (**Restart now** or next time). Hover it to see the chip in use. Solvers run on the processor either way; in the desktop app Fast uses 6 cores, Steel's set-up 6 cores, Reference 4 engine copies (about twice as fast as before).
- **Export** (top right, or the **Export** tab in Forms) — of whatever is on screen, with the finish you're looking at:
  - **KeyShot (textured)** — one `.glb` file: the piece at real size with the finish and the TIG weld (bead ripples, heat-tint bands) **baked into textures**. In KeyShot it comes in as three parts: *Sheet top*, *Sheet bottom* and *TIG weld*. Keep the baked materials, or drop a KeyShot metal on the two sheets and keep the weld as it is.
  - **OBJ for KeyShot** — the same textures as separate pictures beside the `.obj` (colour, roughness, normal). If KeyShot shows the colour but not the bead's relief, put the `-normal.png` into the material's bump/normal slot by hand.
  - **STEP for CAD** — a closed solid in millimetres (made of flat triangles) for SolidWorks / Fusion / Rhino. Uses the solver mesh, not the extra-smooth one, so CAD stays responsive.
  - **SketchUp (COLLADA)** — `.dae` (+ a `-colour.png` when textures are packaged): real size in mm, one closed piece, a material per part. In SketchUp: File → Import → COLLADA. If every triangle shows a line, select it → Window → Soften Edges (~20–30°). Over 150k triangles the app asks: reduce to ~100k, or export all.
  - **Package textures** (tick box at the top of the Export tab, also in File): on = GLB / OBJ / DAE carry the baked finish and weld; off = plain stainless materials, quicker.
  - **STL**, **PNG image**.
  - All but STEP carry the **real sheet thickness**: zoom into a flat tip with Smooth on — two sheets and a cut edge (clear at 1–3 mm, very fine at 0.12).
- Mouse in 3D: left-drag orbit, right-drag pan, wheel zoom.

**PVD variation** (click the **PVD** square for its panel): under the colour, **Variation** (Even → Strong), **Variation size**, and **Position across / up** move the coating's slight colour variation round the piece. It now shows with Welds on or off.

### The two new solvers (session 16)

- **Specified geometric** (Inflate → Solver): draw a square or triangle,
  press Inflate — it appears at once and updates live. Tucks section: Per
  side, Longer sides, Width, Length, Depth, Corner fade, Edge pull-in, Edge
  lift (hover the ⓘ for what each does). For your triangles try 450 mm, Per
  side 4, Width 100, Corner fade 80, Depth 90, Edge pull-in 150. Character
  = smooth pillow ↔ sharp ridges from the corners. Works in the browser too.
- **Symmetric mesh**: Mesh look on a symmetric rectangle — no line or strip
  down the mirror lines any more.
- **Inflate panel**: full screen, every solver — nothing to scroll; hover
  any ⓘ for the description.
- **3D display switch** (Built-in | GPU) is in the 3D view's bar, left of Smooth. It only picks the chip that draws the 3D view; the solvers always run on the main processor.
- **Symmetric (accurate)** (desktop app): your triangle, square or the
  flower hexagon (welds from the centre to each corner), Mesh Medium,
  Inflate. A few minutes instead of half an hour; all corners, edges and
  cells come out the same. Try **Edge waves** 0 and 3. Weld lines are fine;
  cut-outs work round the centre (like a ring) or inside one slice. Shapes
  that aren't mirror-symmetric get a plain message instead. Test runs to look at now: Forms → Test runs →
  `ref-sym-flower` (flower hexagon, 450 mm triangles), `ref-sym-tri` (no waves), `ref-sym-tri-w3` (3 waves), `ref-tri` (old
  whole-piece Reference, for comparison).

### Specified geometric, session 17

- **Reset** (top right of the panel, beside ⓘ) puts every setting back; Undo
  is in the message. In any number box, **↑ / ↓** step the value (Shift ×10,
  hold to run).
- **Pill**: draw a circle, Side wall 100, Target height 180–300, Edge ripples
  0. Then Per side 30–60, Tuck width ~14–30 mm, Tuck length 20–60 mm, Valley
  depth 4–8 mm, Randomness 60–70 and try a few **Random seed** numbers. Small
  tucks want **Mesh → X fine** (the yellow note says when; a few seconds per
  change).
- **Tuck shape** Balloon (soft, flowing) ↔ Geometric (rounded V valleys);
  **Tuck taper** 100 closes each tuck to a point. The 🔗 next to Tuck width
  locks width, length and depth together — drag one and the tuck just grows
  or shrinks.
- On a triangle, push **Edge pull-in** high: the corners stay straight for a
  short stiff stretch (longer with thicker sheet) and the corner lines stay
  clean.
- Forms → Test runs: `geo-pill-c~smooth`, `geo17-thin2~smooth`,
  `tri-taper-1~smooth`.

### Round mode and Fold over, session 19

- Draw a **circle** (or ellipse / pill), choose **Specified geometric**. The
  **Auto Shape Detection** row picks **Round** by itself (hover over Auto to
  see); Round / Corners override it. In Round you get **Folds** (round the
  whole outline) instead of Per side / Longer sides, and no Corner fade.
- Side wall 100 (Pill), Folds ~22, Tuck width ~45 mm, length ~110 mm, Valley
  depth ~14 mm, Tuck taper 50, **Mesh → X fine**. Raise **Fold over** to
  100: seen from above each fold laps over the next like roof tiles.
- **Randomness** ~50 and a few **Random seed** numbers: only some folds lie
  over, by different amounts, some the other way.
- **Min bend** (mm): higher = softer, shallower folds.
- Forms → Test runs: `over-100~smooth` (all lying over), `over-100r~smooth`
  (with randomness).

## 3 · Forms

Three tabs across the top of the right panel, side by side like KeyShot: **Forms | Render | Export**.

Every form you save collects here with a thumbnail, the time and its key settings. Click one to view it in 3D (your live inflation is untouched — switch back to Inflate and it's still there). Hover a card to **reuse its settings** or **delete** it; double-click the name to rename. Export works on the open snapshot. Snapshots stay on this computer between sessions. In the browser version, the command-line test runs are under *Test runs* at the bottom.

**Example forms (new install only):** the first time the installed app opens, Recent already holds nine example forms (your picks, marked *from Examples*). They sit below anything you save and drop off as Recent fills up (it keeps 30); delete any you don't want and they stay gone. Your own copy of the app (which already has forms) doesn't get them.

### Render tab (pictures, not CAD)

Open a form, then the **Render** tab. The view switches to the studio: no grid or outline, the chosen background and picture shape. Everything here is Render's own: leave the tab and the piece lies flat again with your usual camera; come back and the position and the render camera are as you left them. The **Render** button stays at the bottom.

- **Geometry position** (top): **Flat / Wall / Standing**, then **Tilt** (0° on its back … 90° upright facing you) and **Spin** (turns it in its own plane, so another edge or corner comes down — e.g. a triangle at Tilt 45, Spin 45 stands on one point). It always rests on its lowest point; the camera turns round it. **Show ground (with shadow)** adds the floor and a real shadow from the studio's main light — move **Light angle / Light height** and watch it swing and stretch; **Softness** from crisp to a big softbox (greyed out without the ground).
- **Studio** dropdown with previews: Studio, Noir, Slate, White, **Gallery** (white gallery wall, as in the hexagon-flower photo — use it with Wall or Standing), Strips, Edge; then **Rooms** (Loft, Bright room, Country hall, London hall, Sitting room, Cosy room, Atelier, Hotel room, Veranda) and **Outdoors** (Garden, Courtyard garden, Formal garden, Pond garden, Park overcast), then your own HDRIs — each group has a heading. **◀ ▶** or **[ ]** step through them. **Import HDRI…** under it adds `.hdr` / `.exr` (or `.jpg`/`.png` panoramas).
- **Light angle**, **Light height**, **Brightness**, **Light edges** (crisp ↔ soft reflections) — one row each; hover ⓘ for what they do.
- **Background**: Studio, Black, White, Colour (the colour square appears underneath), Clear (see-through PNG). **Shape**, **1K / 2K**, **PNG / JPEG**.
- The view is a quick preview; leave it a second and it sharpens to **Full quality**. Orbit to the view you want and press **Render**.

Try: a triangle, Standing, Gallery, Mirror finish, Show ground on — then Tilt 45 / Spin 45 and move Light angle.

### Phase 0 checklist — please tell Claude what you think

Open the browser version → **Snapshots** → *Test runs*:

- [ ] `square-free` pillows, with creases running into the corners
- [ ] `circle-free` stays fairly smooth
- [ ] `circle-plates` is a flat-faced disc with crumpled rim creases (the pill)
- [ ] `surfboard-plates` is an even slab with rounded/tapered ends, not a tall form
- [ ] `square-balloon` vs `square-geometric` look clearly different
- [ ] In the app: your own shapes inflate live and the controls feel right

What would help most next: **4–6 real DXFs and photos of the finished pieces** (including a Jo Malone pill) to tune the look against.

**Weld fillet** (Inflate panel, under Edge ripples): the rounded edge where the two sheets meet round the outline and holes. With Smooth on, zoom right in on the rim — try 0 (knife-sharp), 1.5 and 5 mm. It's real shape now, so it goes out in the OBJ/STL export. The weld line itself never moves — the outline stays exactly where it is; the metal beside it rolls round to meet it. It fades out at sharp corners (tips, where weld lines meet the edge). Internal weld lines stay sharp. Compare test runs `star-fillet-0~smooth` / `star-fillet-1.5~smooth` / `star-fillet-5~smooth` (Snapshots → Test runs).

**New in session 8** (Inflate panel; all start switched off, so pieces look as before until you change them):

- **Ridges** (under Edge ripples): drag it up on a Geometric square or triangle with Smooth on. Long soft folds are gathered into crisp ridge lines with flatter facets either side. It can only sharpen folds the simulation made — it doesn't add tucks. Moving it re-smooths without re-running.
- **Steel solver**: now chosen from the **Solver** list at the top of the panel (session 9). It holds real steel stiffness — the sheet can't squash. Try a 300 mm square and triangle on Medium, then compare with Fast. It's slower on Final.
- **Seam stiffness** (experimental slider, 0 = as before): how hard the TIG seam resists opening like a book. Around 50 it's like the sheet itself. Look at the rim: there should be a crisp line just inside the weld and the crinkly edge should calm down. Works with either solver.
- **Triangle tips**: the inflation now runs a little further toward each point.
- **Numbers and text** now use the Inter font.
- Your leaf outlines are in `samples/leaves/` (XL, L, M, S) — open them with Import.

**New in session 9**

- **Solver** list at the very top of the Inflate panel: *Fast* (the usual live solver), *Steel (experimental)*, and *Reference (accurate, slow)* (wired in, session 10). Older projects that had the Steel switch on open with Steel.
- **Every slider** now has its number box on the same row (click it and type an exact value) with the two end labels underneath. Same in the Brushed / Heat-tint pop-outs and Render settings.
- The panel is more compact: shorter one-line descriptions, no empty gap under switch-only rows like Plates.

**New in session 10 — the Reference solver works (desktop app only)**

- Inflate panel → **Solver → Reference (accurate, slow)**. Draw or open a piece, set Thickness and either Pressure or Height, press **Inflate**. The app meshes the piece and hands it to OpenCourant (the engineering solver; since session 11 it installs with BlownSim on Windows). Frames drop into the timeline as they're worked out — roughly one every 30–60 seconds on Medium.
- The bar at the bottom of the panel shows how far it's got and the solver's own estimate of time left (that estimate is to *full*; it usually stops sooner). It stops by itself when it reaches your target pressure or height, just like stopping the pump. **Stop** keeps the frames so far.
- **Draft mesh is about 4× quicker** (≈ 8–10 min) — use it to try a shape, Medium (≈ 30 min) for a proper look. Changing settings doesn't re-run it automatically; press Re-run.
- The timeline shows the **real water pressure in bar** for Reference frames.
- It uses only Thickness and Pressure/Height for now: plates, clamp, seed and Balloon↔Geometric aren't sent to it yet, so those settings are hidden while Reference is chosen. The ⓘ next to the solver says what each one is and who made it.
- **Height is the safer target for now**: the Pressure slider reads high on the reference (slider 70 on a 300 mm, 0.8 mm square asks for 2.8 bar; the reference square is already 105 mm high at 1.6 bar).
- Results to look at (Snapshots → Test runs, browser preview): `ref-sq-0` (300 mm square, 0.8 mm), `ref-tri` (your 693 mm triangle, 0.19 mm, slider 77), `ref-leafm` (your medium leaf, 0.8 mm).

**Snapshots (session 10)**

- The **Snapshot** button is now at the bottom of the Inflate panel, next to Inflate / Re-run (the S key still works). A snapshot opens in its own finish (a gold one opens gold).
- **Saving**: the first Save each time you open the app shows the Save dialog (in the file's folder, name filled in) so it can't replace an old file by surprise. Your lost test triangle is back as `Test Project files/Triangle 0.19 mm Rev A.blownsim` (in the v1 folder).
- The good rippled Steel triangle is a passing moment: scrub back to frames ~50-70, or use Target height ~100-120 mm.

- The Snapshots tab has **This file** (the open project's snapshots, saved inside its `.blownsim` file, so they travel with it) and **Recent** (the last 30 snapshots taken in the app, from any file, each labelled with the file it came from). Quit without saving and they're still in Recent.
- Each card has two buttons: **Apply settings** puts its settings onto the shape on the board now (your shape stays). **Restore shape + settings** replaces the board; if your work isn't saved it asks *Save first / Replace / Cancel*. Ctrl+Z brings your shape back.
- Try: snapshot a piece, Save, start a new project, open the file again: its snapshots are back under This file (the smooth mesh rebuilds in a second or two). Each snapshot adds about 0.5 MB to the file.

## Known gaps (coming next)

- Edge ripples are off by default (session 23): a finishing effect, not physics. The slider is still there for the look.
- Final mode's progress bar (Final currently runs live, just slower).
- SketchUp `.skp` export — waits for the SketchUp SDK (`.dae` works now).
- **Symmetric** and **Specified geometric** solvers — being built (session 15).
- Installers are built by GitHub only when asked (to save build minutes) — ask Claude for one.
- Geometric squares and triangles are still too smooth (no V-tucks); see `docs/HANDOFF.md`.

## About & diagnostics (session 22)

- **Click or right-click the Simflate logo** (top left). The popup shows the version, what the computer is (Windows / Mac), the **file-open check** (green "fine" or red "slow": whether an antivirus would slow OpenCourant's start on this computer; it runs a few seconds after Simflate opens), whether Reference is installed, the OpenCourant release with a link to our issue #67, and **problem reports**: click one to read it, **Copy report** to email it, **Copy summary** for the version and checks, **Folder** to see the files.
- In the browser preview it only shows the version.

## On a Mac (about 15 minutes)

Already checked by Claude, so no need to repeat: the 3D view, finishes, the live
solver and Forms behave the same in the Mac's display engine as on Windows
(same pillow, same height to 0.1 mm), and copy / paste works on the Mac
clipboard. What's left is what only a real Mac can show.

**Mac basics for this list**
- **⌘** (Command, next to the space bar) does what Ctrl does on Windows: ⌘S save, ⌘C copy, ⌘V paste, ⌘Z undo.
- **Finder** is the Mac's file explorer (the blue face in the Dock at the bottom). Downloads and Documents are in its left column.
- **Screenshot** of anything odd: ⇧⌘4 (Shift + Command + 4), then drag a box. It lands on the Desktop. Send those to Claude.
- To quit an app: ⌘Q.

**Install** — follow `How to install on a Mac.txt` in the share folder (the "Open Anyway" step the first time).
- Good: the Dock shows the blue pillow with no black square behind it, the same size as the other icons.

**Tick each one; screenshot anything that looks wrong**
1. **Opens**: Simflate opens to the Draft board; Forms holds the nine examples. Click one: it shows in 3D.
2. **Draw + inflate**: draw a rectangle, press Inflate, press play. It inflates smoothly (no stutter for more than a second).
3. **Save**: ⌘S. A Mac save window opens; save in Documents. Quit (⌘Q), reopen Simflate, File → Recent projects: your file is there and opens.
4. **Save as next revision**: File → Save as next revision. Good: a new file "… Rev B" next to the first in Finder.
5. **Import**: File → Import a DXF, an SVG and a DWG (any from `samples/` or the client's). Good: the outline appears at the right size.
6. **Export**: from Forms → Export, save each kind (KeyShot GLB, OBJ, DAE, STEP, STL, PNG) to one folder. Good: each file is there in Finder and isn't 0 KB. If KeyShot or SketchUp is on that Mac, open the GLB / DAE.
7. **Copy to Illustrator** (only if Illustrator is on that Mac): select shapes, ⌘C, paste in Illustrator (⌘V). Then the other way: copy a shape in Illustrator, ⌘V on the Draft board. If Simflate says "Include SVG Code", switch that on in Illustrator (Settings → Clipboard Handling) and copy again.
8. **Diagnostics**: click the Simflate logo top left → Copy summary, paste it into an email to Claude/Guy. It says Mac, the file-open check, and whether Reference is installed.
9. **Reference** (once the Mac engine is in a build): pick Reference, inflate the same rectangle. Good: it runs and lands at about the same height as on Windows.
