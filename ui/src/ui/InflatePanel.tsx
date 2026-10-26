// Right panel in Inflate mode: the short Soap-Skin-style control list.

import { useEffect, useState } from 'react';
import { Camera, ChevronDown, ChevronRight, Link, Play, RotateCcw, Square, Unlink } from 'lucide-react';
import { useApp } from '../state/store';
import { useSim, sim } from '../sim/simStore';
import { DEFAULT_SETTINGS, PRESETS, autoPlateThicknessMm, usesReference, toSolverSettings, type InflateSettings } from '../model/presets';
import type { Piece } from '../model/pieces';
import { NumField, Segmented, SetRow, SliderField, Toggle } from './controls';
import { SolverPicker } from './SolverPicker';
import { isDesktop } from '../io/files';
import { isRoundOutline, legacyTuckMm, meshForTucks, meshSpacingMm, POINTS_PER_TUCK } from '../model/tucks';

interface Props {
  pieces: Piece[];
  narrowestMm: number;
  /** Save the piece as on screen to Snapshots (also the S key). */
  onSnapshot: () => void;
  canSnapshot: boolean;
}

/** Settings whose change re-runs a Draft straight away. */
const RERUN_KEYS: (keyof InflateSettings)[] = [
  'wavesPerEdge',
  'waveDepth',
  'tuckWidth',
  'tuckLength',
  'cornerFade',
  'tuckScaling',
  'edgePull',
  'edgeLift',
  'tuckShape',
  'edgeSmooth',
  'sideWall',
  'tuckWidthMm',
  'tuckLengthMm',
  'valleyDepthMm',
  'tuckRandomness',
  'tuckTaper',
  'roundMode',
  'foldOver',
  'minBendMm',
  'character',
  'thicknessMm',
  'platesOn',
  'plateThicknessMm',
  'plateOffsetMm',
  'quality',
  'material',
  'seed',
  'creaseRandomness',
  'plateFriction',
  'bottomStiffness',
  'inflateBy',
  'fixOutline',
  'clampWhileInflating',
  // Pressure and Target height re-run from flat too (Guy, session 20): a run
  // raised part-way kept the creases of the lower pressure, so the saved
  // settings (final pressure only) couldn't reproduce it — and all raises
  // shared one 600-frame budget, so late raises stalled short.
  'pressure',
  'heightMm',
];

/** The last run's inputs — kept outside the component so it survives switching tabs. */
const lastRunMemo: { current: { piecesKey: string; settings: InflateSettings } | null } = { current: null };

export function InflatePanel({ pieces, narrowestMm, onSnapshot, canSnapshot }: Props) {
  const settings = useApp((s) => s.settings);
  const presetId = useApp((s) => s.presetId);
  const update = useApp((s) => s.updateSettings);
  const showToast = useApp((s) => s.showToast);
  const status = useSim((s) => s.status);
  const source = useSim((s) => s.source);
  const refMessage = useSim((s) => s.refMessage);
  const onReference = useSim((s) => s.reference);
  const [advanced, setAdvanced] = useState(false);
  const [pressure, setPressure] = useState(settings.pressure);
  const lastRun = lastRunMemo;
  const piecesKey = JSON.stringify(pieces);

  useEffect(() => setPressure(settings.pressure), [settings.pressure]);
  const [height, setHeight] = useState(settings.heightMm);
  useEffect(() => setHeight(settings.heightMm), [settings.heightMm]);
  // Target height slider: up to the piece's narrowest width (a pillow can't rise further).
  const heightMax = Math.max(100, Math.ceil(narrowestMm / 10) * 10, Math.ceil(settings.heightMm));
  // Real pieces rise to about half their narrowest width (Fast at full
  // pressure: 0.42 on a square). Specified geometric builds any height asked
  // for (creative freedom, Guy) — past this it only says so.
  const realisticMm = Math.round((narrowestMm * 0.5) / 5) * 5;
  // The slider shows the thickness while dragging; the run updates on release.
  const [thick, setThickness] = useState(settings.thicknessMm);
  useEffect(() => setThickness(settings.thicknessMm), [settings.thicknessMm]);

  const start = (s: InflateSettings = useApp.getState().settings) => {
    if (!pieces.length) return;
    lastRun.current = { piecesKey, settings: s };
    sim.start(pieces, toSolverSettings(s), usesReference(s.solver) && isDesktop);
  };

  // Reference: prepare the model in the background a moment after the piece
  // or its settings change, so Inflate finds it ready (see sim.prepareReference).
  const prepSig = usesReference(settings.solver) && isDesktop && pieces.length ? `${piecesKey}|${JSON.stringify(toSolverSettings(settings))}` : '';
  useEffect(() => {
    if (!prepSig) return;
    const t = setTimeout(() => sim.prepareReference(pieces, toSolverSettings(useApp.getState().settings)), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepSig]);

  const live = source === 'live' && status !== 'idle' && status !== 'error';
  const running = status === 'running' || status === 'meshing';

  // Draft is fully live: changing these re-runs at once.
  const rerunSig = RERUN_KEYS.map((k) => String(settings[k])).join('|');
  useEffect(() => {
    // The Reference solver takes minutes: only Inflate / Re-run starts it.
    if (!lastRun.current || source !== 'live' || usesReference(settings.solver)) return;
    const prev = RERUN_KEYS.map((k) => String(lastRun.current!.settings[k])).join('|');
    if (prev === rerunSig) return;
    const t = setTimeout(() => start(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rerunSig]);

  // Back from Draft with a changed shape: the old piece must not linger
  // under the new outline. Fast / Steel re-inflate at once; Reference takes
  // minutes, so it just clears and waits for Inflate.
  useEffect(() => {
    if (!lastRun.current || lastRun.current.piecesKey === piecesKey || source !== 'live') return;
    if (usesReference(settings.solver) || !pieces.length) {
      lastRun.current = null;
      sim.clear();
    } else start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piecesKey]);

  // Every setting back to its starting value, whatever the solver (Guy:
  // too many sliders to find your way back). Solver and mesh stay; Undo in
  // the message puts everything back.
  const resetAll = () => {
    const { settings: before, presetId: beforePreset } = useApp.getState();
    update({ ...DEFAULT_SETTINGS, solver: before.solver, quality: before.quality }, null);
    showToast('Settings back to their starting values (solver and mesh kept).', { label: 'Undo', run: () => update(before, beforePreset) });
  };

  // Fast / Steel / Specified geometric: a new pressure or height re-runs
  // from flat (RERUN_KEYS), so the same settings always give the same shape.
  // Reference runs take minutes: there the running engine is retargeted
  // upwards instead, and anything else waits for Re-run.
  const commitPressure = (v: number) => {
    const prev = lastRun.current?.settings.pressure ?? 0;
    update({ pressure: v }, null);
    if (!onRef || !live || !lastRun.current) return;
    if (v > prev) {
      lastRun.current = { ...lastRun.current, settings: { ...lastRun.current.settings, pressure: v } };
      sim.raisePressure(v, settings.character, settings.thicknessMm);
    } else if (v < prev) showToast('Reference: the pressure can only be raised during a run — press Re-run to start lower.');
  };

  const commitHeight = (v: number) => {
    const prev = lastRun.current?.settings.heightMm ?? 0;
    update({ heightMm: v }, null);
    if (!onRef || !live || !lastRun.current) return;
    if (v > prev) {
      lastRun.current = { ...lastRun.current, settings: { ...lastRun.current.settings, heightMm: v } };
      sim.raiseHeight(v, settings.character, settings.thicknessMm);
    } else if (v < prev) showToast('Reference: the target height can only be raised during a run — press Re-run to start lower.');
  };

  // Settings the chosen solver doesn't use aren't shown at all (Guy: no scrolling past dead controls).
  const onRef = usesReference(settings.solver);
  const unused = onRef ? 'unused' : undefined;
  // Specified geometric builds the form: the workshop settings don't apply.
  const geometric = settings.solver === 'geometric';
  const physicsOnly = onRef || geometric ? 'unused' : undefined;

  // An older form's tucks (shares of the spacing) become mm once, on this outline.
  useEffect(() => {
    if (geometric && settings.tuckWidthMm === undefined && pieces.length) update(legacyTuckMm(pieces, settings));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometric, settings.tuckWidthMm, piecesKey]);
  const tuckMm = settings.tuckWidthMm ?? DEFAULT_SETTINGS.tuckWidthMm!;
  const tuckLenMm = settings.tuckLengthMm ?? DEFAULT_SETTINGS.tuckLengthMm!;
  const valleyMm = settings.valleyDepthMm ?? DEFAULT_SETTINGS.valleyDepthMm!;
  // Chain locked: width, length and valley depth scale together, so a tuck
  // grows or shrinks keeping its look (Tuck shape and Taper are already
  // proportions). Guy: scaling a tuck took four sliders.
  const sizeTuck = (key: 'tuckWidthMm' | 'tuckLengthMm' | 'valleyDepthMm', v: number) => {
    const now = { tuckWidthMm: tuckMm, tuckLengthMm: tuckLenMm, valleyDepthMm: valleyMm };
    if (!settings.tuckLock || now[key] <= 0) return update({ [key]: v });
    const k = v / now[key];
    const r1 = (x: number) => Math.round(x * 10) / 10;
    update({
      tuckWidthMm: key === 'tuckWidthMm' ? v : r1(Math.min(200, Math.max(2, tuckMm * k))),
      tuckLengthMm: key === 'tuckLengthMm' ? v : r1(Math.min(400, Math.max(2, tuckLenMm * k))),
      valleyDepthMm: key === 'valleyDepthMm' ? v : r1(Math.min(60, Math.max(0, valleyMm * k))),
    });
  };
  // Tucks narrower than a few mesh points blur into stripes: say which mesh shows them.
  const meshQ = !geometric && settings.quality === 'xfine' ? 'final' : settings.quality;
  const spacing = pieces.length ? meshSpacingMm(pieces, meshQ) : 0;
  const tooCoarse = geometric && settings.wavesPerEdge > 0 && spacing * POINTS_PER_TUCK > tuckMm;
  const needed = tooCoarse ? meshForTucks(pieces, tuckMm) : null;
  const meshName = { draft: 'Draft', medium: 'Medium', final: 'Fine', xfine: 'X fine' } as const;
  // Round mode: Auto picks it for outlines without corners (the solver uses
  // the same rule); the Auto button says which it chose.
  const roundMode = settings.roundMode ?? 'auto';
  const looksRound = pieces.length > 0 && isRoundOutline(pieces);
  const round = roundMode === 'round' || (roundMode === 'auto' && looksRound);

  return (
    <aside className="panel">
      {/* Solver and mesh together: the two choices that set how long a run takes. */}
      <section>
        <SolverPicker value={settings.solver} onChange={(v) => update({ solver: v })} onReset={resetAll} />
        <div className="mesh-row" title="The solver and the mesh decide how long a run takes">
          <span className="sub-label">Mesh</span>
          <Segmented
            small
            value={meshQ}
            onChange={(v) => update({ quality: v })}
            options={
              geometric
                ? [
                    { value: 'draft', label: 'Draft', title: 'Fastest, for finding the look' },
                    { value: 'medium', label: 'Medium', title: 'Finer: smaller tucks show' },
                    { value: 'final', label: 'Fine', title: 'Fine mesh, smoothest render. For exports.' },
                    { value: 'xfine', label: 'X fine', title: 'Extra fine, for small, thin tucks at the weld (a few seconds per change)' },
                  ]
                : [
                    { value: 'draft', label: 'Draft', title: 'Fastest: rough creases, for finding the look' },
                    { value: 'medium', label: 'Medium', title: 'Good creases, still fairly quick' },
                    { value: 'final', label: 'Final', title: 'Finest creases and smoothest render mesh (slower). For exports.' },
                  ]
            }
          />
        </div>
      </section>

      <section className="compact">
        <header className="panel-head">
          <h2>
            Preset <span className="preset-name">· {PRESETS.find((p) => p.id === presetId)?.name ?? 'Custom'}</span>
          </h2>
        </header>
        <div className="chips row5">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`chip${presetId === p.id ? ' on' : ''}`}
              title={p.look}
              onClick={() => {
                const next = p.apply(useApp.getState().settings);
                update(next, p.id);
                // Not on Reference: it takes minutes, so only Inflate starts it.
                if (!lastRun.current && !usesReference(next.solver)) start(next);
              }}
              data-testid={`preset-${p.id}`}
            >
              {p.name}
            </button>
          ))}
          <span className={`chip static${presetId ? '' : ' on'}`} title="Shown when you've changed a preset's settings by hand" data-testid="preset-custom">
            Custom
          </span>
        </div>
      </section>

      <section className="compact">
        <header className="panel-head">
          <h2>Inflate by</h2>
          <Segmented
            small
            value={settings.inflateBy}
            onChange={(v) => update({ inflateBy: v })}
            options={[
              { value: 'pressure', label: 'Pressure' },
              { value: 'height', label: 'Target height' },
            ]}
          />
        </header>
        {settings.inflateBy === 'pressure' ? (
          <SetRow label="Pressure" info="0–100. A new pressure inflates again from flat, so the same settings always give the same shape (scrub the timeline to watch it rise).">
            <SliderField value={pressure} onChange={setPressure} onRelease={commitPressure} testId="pressure" />
          </SetRow>
        ) : (
          <SetRow label="Height" info={`Overall height of the finished piece, 1–${heightMax} mm (up to its narrowest width).`}>
            <SliderField
              value={height}
              min={1}
              max={heightMax}
              onChange={(v) => setHeight(Math.round(v))}
              onRelease={(v) => commitHeight(Math.round(v))}
              unit="mm"
              digits={0}
              testId="height"
            />
          </SetRow>
        )}
        {settings.solver === 'geometric' && settings.inflateBy === 'height' && narrowestMm > 0 && height > realisticMm && (
          <p className="wiz-warn tuck-warn" style={{ whiteSpace: 'nowrap' }} title="Built as asked — a real piece this shape rises to about half its narrowest width." data-testid="height-warn">
            Beyond realistic max height of {realisticMm} mm
          </p>
        )}
        <SetRow label="Thickness" info="Both sheets, 0.1–3 mm (type down to 0.01). Thicker: fewer, broader creases.">
          <SliderField
            value={thick}
            log
            min={0.1}
            max={3}
            onChange={(v) => setThickness(Math.round(v * 100) / 100)}
            onRelease={(v) => update({ thicknessMm: Math.round(v * 100) / 100 })}
            unit="mm"
            digits={2}
            testId="thickness-slider"
            fieldTestId="thickness"
            typedMin={0.01}
          />
        </SetRow>
        <SetRow wide label="Material thickness geometry at corners" info="On: tips, corners and edges show the real thickness of the two sheets (their cut edge). Off: thin sheets meeting at a sharp edge. Look only.">
          <Toggle checked={settings.showThickness} onChange={(b) => update({ showThickness: b })} label="" testId="show-thickness" />
        </SetRow>
        <div className={unused}>
          <SetRow label="Character" info="Balloon ↔ Geometric. Physics solvers: steel temper — soft flows round, hard folds into facets. Specified geometric: smooth pillow ↔ sharp ridges in from the corners.">
            <SliderField value={settings.character * 100} onChange={(v) => update({ character: v / 100 })} left="Balloon" right="Geometric" testId="character" />
          </SetRow>
        </div>
      </section>

      {geometric && (
        <section className="compact">
          <header className="panel-head">
            <h2>Tucks</h2>
          </header>
          <SetRow label={'Auto Shape\nDetection'} info="Round: folds spread evenly round the whole outline, with no corners — for circles, ellipses and pills. Corners: tucks along each side between corners. Auto picks Round when the outline has no corners (Folds shows instead of Per side).">
            <Segmented
              small
              value={roundMode}
              onChange={(v) => update({ roundMode: v })}
              options={[
                { value: 'auto', label: 'Auto', title: `Picks Round for outlines with no corners — this outline: ${looksRound ? 'Round' : 'Corners'}` },
                { value: 'round', label: 'Round', title: 'Folds evenly round the whole outline' },
                { value: 'corners', label: 'Corners', title: 'Tucks along each side between corners' },
              ]}
            />
          </SetRow>
          {round ? (
            <SetRow label="Folds" info="Folds round the whole outline. Cut-outs and inner weld lines get folds in proportion to their length.">
              <SliderField value={settings.wavesPerEdge} min={0} max={80} onChange={(v) => update({ wavesPerEdge: Math.round(v) })} testId="folds-round" />
            </SetRow>
          ) : (
            <>
              <SetRow label="Per side" info="Tucks along each side between corners. When ‘Longer sides’ isn’t 0, this is the count on a 300 mm side.">
                <SliderField value={settings.wavesPerEdge} min={0} max={40} onChange={(v) => update({ wavesPerEdge: Math.round(v) })} testId="tucks-per-edge" />
              </SetRow>
              <SetRow label="Longer sides" info="How the count follows side length. 0: the same on every side. +100: in proportion to length (long sides get more, like the teabags). −100: shorter sides get more (like the small pillows on the pyramid).">
                <SliderField value={settings.tuckScaling * 100} min={-100} max={100} onChange={(v) => update({ tuckScaling: v / 100 })} testId="tuck-scaling" />
              </SetRow>
            </>
          )}
          <SetRow label="Side wall" info="0: a pillow, sloping up from the weld. 100: a pill — each sheet leaves the weld straight up and rolls round onto a gently crowned top, like the Jo Malone balloons. The edges draw in to feed it.">
            <SliderField value={(settings.sideWall ?? 0) * 100} onChange={(v) => update({ sideWall: v / 100 })} left="Pillow" right="Pill" testId="side-wall" />
          </SetRow>
          <SetRow label="Tuck shape" info="Balloon: rounded valleys that blend softly into the dome. Geometric: thick-material tucks — flat floor, straighter side walls, a tighter rounded edge where they meet the rest of the form.">
            <SliderField value={(settings.tuckShape ?? 0) * 100} onChange={(v) => update({ tuckShape: v / 100 })} left="Balloon" right="Geometric" testId="tuck-shape" />
          </SetRow>
          <SetRow label="Tuck width" info="Width of each tuck along the weld, mm. Wider than the gap between them and they run on into one another. Small tucks need a finer mesh (it says which).">
            <SliderField
              value={tuckMm}
              log
              min={2}
              max={200}
              onChange={(v) => sizeTuck('tuckWidthMm', Math.round(v * 2) / 2)}
              unit="mm"
              digits={1}
              arrowStep={1}
              testId="tuck-width"
              after={
                <button
                  type="button"
                  className={`unit-lock${settings.tuckLock ? ' on' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    update({ tuckLock: !settings.tuckLock });
                  }}
                  title={settings.tuckLock ? 'Locked: Tuck width, length and valley depth scale together (mm). Click to unlock.' : 'Lock the tuck’s proportions: changing width, length or valley depth scales all three (mm)'}
                  data-testid="tuck-lock"
                >
                  {settings.tuckLock ? <Link size={13} /> : <Unlink size={13} />}
                </button>
              }
            />
          </SetRow>
          {tooCoarse && (
            <p
              className="wiz-warn tuck-warn"
              style={{ whiteSpace: 'nowrap' }}
              // One line (Guy); the reason is in the tooltip.
              title={
                needed
                  ? `Tucks this narrow blur into stripes on this mesh — ${meshName[needed]} has enough points across them.`
                  : `Tucks this narrow blur even on X fine (a point every ${meshSpacingMm(pieces, 'xfine').toFixed(1)} mm) — from about ${Math.ceil(meshSpacingMm(pieces, 'xfine') * POINTS_PER_TUCK)} mm wide they show.`
              }
              data-testid="mesh-warn"
            >
              {needed ? `Too narrow to show smoothly: choose ${meshName[needed]}` : `Too narrow to show smoothly: min ${Math.ceil(meshSpacingMm(pieces, 'xfine') * POINTS_PER_TUCK)} mm on X fine`}
            </p>
          )}
          <SetRow label="Tuck length" info="How far each tuck runs in from the weld, mm. Short: small crinkles at the weld. Long: folds up the wall and over the top.">
            <SliderField value={tuckLenMm} log min={2} max={400} onChange={(v) => sizeTuck('tuckLengthMm', Math.round(v * 2) / 2)} unit="mm" digits={1} arrowStep={1} testId="tuck-length" />
          </SetRow>
          <SetRow label="Tuck taper" info="0: each tuck keeps its width all the way in and fades out shallow. 100: its two sides close in to a point at the tuck’s length, staying crisp until the tip — like the reference pieces.">
            <SliderField value={(settings.tuckTaper ?? 0) * 100} onChange={(v) => update({ tuckTaper: v / 100 })} testId="tuck-taper" />
          </SetRow>
          <SetRow label="Valley depth" info="How deep each tuck’s valley goes at its centre, mm.">
            <SliderField value={valleyMm} min={0} max={60} step={0.5} onChange={(v) => sizeTuck('valleyDepthMm', v)} unit="mm" digits={1} testId="tuck-depth" />
          </SetRow>
          {round && (
            <>
              <SetRow label="Fold over" info="0: each fold is an open valley. Higher: the fold leans sideways and lies over on itself — seen from above, one side laps over the valley, like the rim of the gold balloon. With Randomness, only some folds lie over, by different amounts and in either direction.">

                <SliderField value={(settings.foldOver ?? 0) * 100} onChange={(v) => update({ foldOver: v / 100 })} testId="fold-over" />
              </SetRow>
              <SetRow label="Min bend" info="The tightest radius a fold may bend, mm. Folds never curve or crease tighter than this: higher gives softer, shallower folds. 0: no limit.">
                <SliderField value={settings.minBendMm ?? 0} min={0} max={50} step={0.5} onChange={(v) => update({ minBendMm: v })} unit="mm" digits={1} testId="min-bend" />
              </SetRow>
            </>
          )}
          <SetRow label="Randomness" info="0: every tuck the same, evenly spaced. Higher: each tuck shifts along the edge and varies in width, length and depth.">
            <SliderField value={(settings.tuckRandomness ?? 0) * 100} onChange={(v) => update({ tuckRandomness: v / 100 })} testId="tuck-randomness" />
          </SetRow>
          <SetRow wide label="Random seed" info="A different number, a different random pattern. Same seed, same tucks.">
            <NumField value={settings.seed} onCommit={(v) => update({ seed: Math.round(v) })} unit=" " digits={0} min={0} max={999999} width={46} testId="tuck-seed" />
          </SetRow>
          {!round && (
            <SetRow label="Corner fade" info="0: all tucks equally deep. 100: shallow near the corners, deepest mid-side.">
              <SliderField value={settings.cornerFade * 100} onChange={(v) => update({ cornerFade: v / 100 })} testId="corner-fade" />
            </SetRow>
          )}
          <SetRow label="Edge pull-in" info="How far each side bows in to feed the dome (the valley along the welds). 100 = as built.">
            <SliderField value={settings.edgePull * 100} min={0} max={300} onChange={(v) => update({ edgePull: v / 100 })} unit="%" testId="edge-pull" />
          </SetRow>
          <SetRow label="Edge smooth" info="0: each tuck pulls the weld in, so the edge goes wavy. 100: the edge draws in as one smooth arc and the tucks stay in the surface.">
            <SliderField value={(settings.edgeSmooth ?? 0) * 100} onChange={(v) => update({ edgeSmooth: v / 100 })} testId="edge-smooth" />
          </SetRow>
          <SetRow label="Edge lift Z" info="Up and down (Z): the weld rising between tucks and dipping at them.">
            <SliderField value={settings.edgeLift * 100} onChange={(v) => update({ edgeLift: v / 100 })} testId="edge-lift" />
          </SetRow>
        </section>
      )}

      {settings.solver === 'symmetric' && (
        <section className="compact">
          <SetRow label="Edge waves" info="A tiny ripple with this many crests seeded on every edge before pumping, so the buckles start evenly spaced. 0: off — the edges buckle where they give first (still the same on every edge).">
            <SliderField value={settings.wavesPerEdge} min={0} max={8} onChange={(v) => update({ wavesPerEdge: Math.round(v) })} testId="waves-per-edge" />
          </SetRow>
        </section>
      )}

      <section className="compact">
        <header className="panel-head">
          <h2>Smooth mesh</h2>
        </header>
        <SetRow label="Edge ripples" info="Pleats along squeezed welds on the smooth mesh.">
          <SliderField value={settings.edgeRipples * 100} onChange={(v) => update({ edgeRipples: v / 100 })} testId="edge-ripples" />
        </SetRow>
        <SetRow label="Ridges" info="Crisp ridges on long folds on the smooth mesh: soft ↔ crisp.">
          <SliderField value={settings.ridgeSharpness * 100} onChange={(v) => update({ ridgeSharpness: v / 100 })} testId="ridges" />
        </SetRow>
        <SetRow label="Weld fillet" info="Radius of the rounded TIG seam, mm.">
          <NumField value={settings.weldFilletMm} onCommit={(v) => update({ weldFilletMm: v })} min={0} max={20} width={46} testId="weld-fillet" />
        </SetRow>
      </section>

      <section className={`compact ${physicsOnly ?? ''}`}>
        <header className="panel-head">
          <h2>Workshop</h2>
        </header>
        <SetRow label="Outline" info="Draws in: the welded edge pulls inward and creases unevenly, like the real thing. Fixed: the weld stays exactly on the drawn line.">
          <Segmented
            small
            value={settings.fixOutline ? 'fixed' : 'free'}
            onChange={(v) => update({ fixOutline: v === 'fixed' })}
            options={[
              { value: 'free', label: 'Draws in' },
              { value: 'fixed', label: 'Fixed' },
            ]}
          />
        </SetRow>
        <SetRow label="Seam stiffness" info="How much the seam resists opening like a book: 0 free, 50 like the sheet.">
          <SliderField value={settings.seamStiffness * 50} onChange={(v) => update({ seamStiffness: v / 50 })} testId="seam-stiffness" />
        </SetRow>
        <SetRow wide label="Clamp whilst inflating" info="On: folds set only once it’s full — smooth, drawn-in pillows. Off: folds set as they form, like a free blow.">
          <Toggle checked={settings.clampWhileInflating} onChange={(b) => update({ clampWhileInflating: b })} label="" testId="clamp" />
        </SetRow>
        <SetRow label={'Max Height\nPlates'} info="Two flat plates the piece inflates between, which stop it rising higher: finished thickness (gap) and offset, mm.">
          {settings.platesOn && (
            <>
              <NumField value={settings.plateThicknessMm} onCommit={(v) => update({ plateThicknessMm: v })} min={0.5} width={46} title="Finished thickness (gap between the plates)" />
              <NumField value={settings.plateOffsetMm} onCommit={(v) => update({ plateOffsetMm: v })} width={46} title="Offset (moves both plates up or down)" />
            </>
          )}
          <Toggle
            checked={settings.platesOn}
            onChange={(b) =>
              // Switching on fills in a gap that suits the shape, unless one has been typed.
              update(b && (settings.plateThicknessMm === DEFAULT_SETTINGS.plateThicknessMm || settings.plateThicknessMm >= narrowestMm) ? { platesOn: b, plateThicknessMm: autoPlateThicknessMm(narrowestMm) } : { platesOn: b })
            }
            label=""
            testId="plates"
          />
        </SetRow>
      </section>

      <section className={`compact ${physicsOnly ?? ''}`}>
        <button className="disclosure" onClick={() => setAdvanced(!advanced)}>
          {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />} More
        </button>
        {advanced && (
          <>
            <SetRow label="Crease seed" info="Same seed, same creases.">
              <NumField value={settings.seed} onCommit={(v) => update({ seed: Math.round(v) })} unit="" digits={0} min={0} max={999999} width={56} />
            </SetRow>
            <SetRow label="Randomness" info="Crease randomness: even ↔ wild.">
              <SliderField value={settings.creaseRandomness * 100} onChange={(v) => update({ creaseRandomness: v / 100 })} />
            </SetRow>
            <SetRow label="Plate friction" info="Slippery ↔ grippy.">
              <SliderField value={settings.plateFriction * 100} onChange={(v) => update({ plateFriction: v / 100 })} />
            </SetRow>
            <SetRow label="Bottom sheet" info="Bottom sheet stiffness. Above 1 makes a one-sided piece: domed top, flatter bottom.">
              <NumField value={settings.bottomStiffness} onCommit={(v) => update({ bottomStiffness: v })} unit="×" digits={2} min={0.25} max={8} width={56} />
            </SetRow>
            <SetRow label="Soap film" info="No metal behaviour: constant surface tension, no bending — for comparison.">
              <Toggle checked={settings.material === 'soap'} onChange={(b) => update({ material: b ? 'soap' : 'metal' })} label="" />
            </SetRow>
          </>
        )}
      </section>

      <div className="panel-foot">
        {onReference && refMessage && !running && <p className="muted small">Reference · {refMessage}</p>}
        {/* Run on the left half, Snapshot on the right half (Guy: it was hidden). */}
        <div className="foot-row">
          {running ? (
            <button className="btn big" onClick={() => sim.stop()} data-testid="stop">
              <Square size={14} /> Stop
            </button>
          ) : (
            <button className="btn primary big" disabled={!pieces.length} onClick={() => start()} data-testid="run">
              {lastRun.current ? <RotateCcw size={16} /> : <Play size={16} />}
              {lastRun.current ? 'Re-run' : 'Inflate'}
            </button>
          )}
          <button className="btn big" onClick={onSnapshot} disabled={!canSnapshot} title="Save this piece, as on screen, to Forms (S)" data-testid="take-snapshot">
            <Camera size={16} /> Save form
          </button>
        </div>
      </div>
    </aside>
  );
}
