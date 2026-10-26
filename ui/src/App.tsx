import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Sparkles, X } from 'lucide-react';
import { useApp } from './state/store';
import { sim, useSim } from './sim/simStore';
import { captureThumbnail, fileSnapshots, library, useLibrary } from './library/library';
import { PRESETS, usesPlates } from './model/presets';
import { buildPieces } from './model/pieces';
import { boxCenter, boxHeight, boxOf, boxWidth, fmt, multiply, scaleAbout, translate, type Vec2 } from './model/geometry';
import { DXF_IN_ILLUSTRATOR, illustratorScale, setIllustratorScale, type IllustratorScale } from './io/clipboard';
import { newId, shapesBox, type Shape } from './model/shapes';
import { guessChoices, remember } from './io/lineTypes';
import { LineTypesDialog, applyChoices } from './ui/LineTypesDialog';
import { transformSelected } from './model/transform';
import { importSummary, isDesktop, outlineFileText, readOutlineText } from './io/files';
import { isProjectName, loadProject, newProject, pickFile, saveProject } from './io/project';
import { Editor2D, board } from './editor/Editor2D';
import { copyShapes, ownShapes, pastedSvg, readClipboard } from './io/clipboard';
import { forgetRecent, readRecent, type RecentProject } from './io/recent';
import { Viewport3D } from './viewer/Viewport3D';
import { TopBar, type OnScreen } from './ui/TopBar';
import { ControlBar, ToolPalette } from './ui/ShapeTools';
import { ShapePanel } from './ui/ShapePanel';
import { InflatePanel } from './ui/InflatePanel';
import { SnapshotsPanel } from './ui/SnapshotsPanel';
import { LibraryTimeline, LiveTimeline, stepFrame } from './ui/Timeline';
import { ContactButton, LookPalette } from './ui/LookPalette';
import { GpuSwitch } from './ui/GpuSwitch';

void library.load();

export function App() {
  const mode = useApp((s) => s.mode);
  const shapes = useApp((s) => s.shapes);
  const settings = useApp((s) => s.settings);
  const showPlates = useApp((s) => s.showPlates);
  const toast = useApp((s) => s.toast);
  const toastActions = useApp((s) => s.toastActions);
  const simError = useSim((s) => s.error);
  const simStatus = useSim((s) => s.status);
  const smooth = useApp((s) => s.smooth);
  const liveMesh = useSim((s) => s.mesh);
  const liveVersion = useSim((s) => s.meshVersion);
  const liveFrame = useSim((s) => s.frames[s.current]);
  const liveCrease = useSim((s) => s.crease[s.current]);
  const liveContact = useSim((s) => s.contact[s.current]);
  const libView = useLibrary((s) => s.view);
  const libCurrent = useLibrary((s) => s.current);
  const libVersion = useLibrary((s) => s.viewVersion);
  const current = useSim((s) => s.current);
  const simSource = useSim((s) => s.source);
  const render = useSim((s) => s.render);
  const finishing = useSim((s) => s.finishing);
  // A Reference run takes minutes per frame: frames scrubbed back to can be smoothed meanwhile.
  const refBrowsing = useSim((s) => s.reference && !s.follow);
  const levels = settings.quality === 'final' ? 2 : 1;
  const ripples = settings.edgeRipples;
  const fillet = settings.weldFilletMm;
  const ridges = settings.ridgeSharpness;
  const thick = settings.showThickness;
  const finishDone = !!render && render.frame === current;
  // A height run that came to rest short of its target: say why.
  const lastInfo = useSim((s) => s.infos[s.infos.length - 1]);
  const shortOfTarget =
    simStatus === 'settled' && !useSim.getState().reference && settings.inflateBy === 'height' && lastInfo && lastInfo.heightMm < settings.heightMm * 0.97 ? lastInfo : null;

  // The finisher runs whenever the piece is at rest on screen (settled,
  // paused or scrubbed) and Smooth is on. Final quality subdivides twice.
  useEffect(() => {
    if (!smooth || simSource !== 'live' || mode !== 'inflate') return;
    if ((simStatus === 'running' && !refBrowsing) || simStatus === 'meshing' || simStatus === 'idle') return;
    if (render && render.frame === current && render.levels === levels && render.ripples === ripples && render.fillet === fillet && (render.ridges ?? 0) === ridges && (render.thick ?? true) === thick) return;
    const t = setTimeout(() => sim.finish(current, levels, ripples, fillet, ridges, thick), 150);
    return () => clearTimeout(t);
  }, [smooth, simSource, simStatus, refBrowsing, current, render, levels, mode, ripples, fillet, ridges, thick]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [runsAvailable, setRunsAvailable] = useState(false);

  const report = useMemo(() => buildPieces(shapes), [shapes]);
  const outlines = useMemo<Vec2[][]>(() => report.pieces.flatMap((p) => [p.outer, ...p.holes]), [report]);
  const narrowest = useMemo(() => {
    if (!report.pieces.length) return 100;
    const b = boxOf(report.pieces.flatMap((p) => p.outer));
    return Math.min(boxWidth(b), boxHeight(b));
  }, [report]);

  // The Runs tab only exists when the preview server can serve saved runs.
  useEffect(() => {
    fetch('/api/runs')
      .then((r) => setRunsAvailable(r.ok && (r.headers.get('content-type') ?? '').includes('json')))
      .catch(() => setRunsAvailable(false));
  }, []);

  /** Open a project, or import an outline, from a file's name and text. */
  const openText = (name: string, text: string) => {
    const st = useApp.getState();
    try {
      if (isProjectName(name)) {
        const dropped = loadProject(text, name);
        const file = name.split(/[\\/]/).pop();
        st.showToast(dropped ? `Opened ${file} — ${dropped} damaged shape${dropped === 1 ? ' was' : 's were'} left out.` : `Opened ${file}`);
        return;
      }
      const imp = readOutlineText(name, text);
      st.setMode('shape');
      st.setTool('select');
      // Lines on different layers / colours: ask what each one is first.
      if (imp.sources.length > 1) setPendingImport(imp);
      else placeImport(imp.shapes, imp.name, imp.note);
    } catch (e) {
      st.showToast(String((e as Error).message ?? e));
    }
  };
  const placeImport = (added: Shape[], label: string, note: string, pasted = false) => {
    const st = useApp.getState();
    if (!added.length) return st.showToast(`${label}: every line was left out — nothing imported.`);
    st.commit([...st.shapes, ...added]);
    st.select(added.map((s) => s.id));
    if (pasted && label === 'Illustrator') return illustratorPasted(added);
    if (pasted) return st.showToast(`Pasted from ${label}. ${importSummary(added)}. It's a fixed outline: move, scale and rotate it like an import.`);
    setTimeout(() => st.requestFit(), 0);
    st.showToast(
      `${label}: ${note}. ${importSummary(added)}. Type the real width or length into a dimension to scale it. Double-click a line to pick it out (Shift+double-click for more), then set Outline / Weld line / Construction in the Shapes panel, or press Delete.`,
    );
  };
  /** Illustrator paste: apply the Edit → Illustrator pastes setting, and
   *  offer the other one (which also becomes the setting). */
  const illustratorPasted = (added: Shape[]) => {
    const ids = added.map((s) => s.id);
    const rescale = (f: number) => {
      const now = useApp.getState();
      const box = shapesBox(now.shapes.filter((s) => ids.includes(s.id)));
      if (box) now.commit(transformSelected(now.shapes, ids, scaleAbout(f, f, boxCenter(box))));
    };
    const k = DXF_IN_ILLUSTRATOR;
    const say = (mode: IllustratorScale) => {
      const now = useApp.getState();
      const b = shapesBox(now.shapes.filter((s) => ids.includes(s.id)));
      const size = b ? `${fmt(boxWidth(b))} × ${fmt(boxHeight(b))} mm` : '';
      now.showToast(
        mode === 'dxf'
          ? `Pasted from Illustrator at ${size}: Illustrator's numbers read as mm (DXF opened in Illustrator, ×2.83). Set in Edit → Illustrator pastes.`
          : `Pasted from Illustrator at real size, ${size}. If it came from a DXF opened in Illustrator, it's 2.83× too small: switch below (also in Edit → Illustrator pastes).`,
        {
          label: mode === 'dxf' ? 'Use real size' : 'Read as DXF mm (×2.83)',
          run: () => {
            const next: IllustratorScale = mode === 'dxf' ? 'real' : 'dxf';
            setIllustratorScale(next);
            rescale(next === 'dxf' ? k : 1 / k);
            say(next);
          },
        },
      );
    };
    const mode = illustratorScale();
    if (mode === 'dxf') rescale(k);
    say(mode);
  };
  const [pendingImport, setPendingImport] = useState<(ReturnType<typeof readOutlineText> & { pasted?: boolean }) | null>(null);

  /** Ctrl+V: shapes copied in Simflate, Illustrator or Word, dropped in the
   *  middle of the board. */
  const paste = async () => {
    const st = useApp.getState();
    if (st.mode !== 'shape') {
      st.setMode('shape');
      await new Promise((r) => setTimeout(r, 50));
    }
    let clip;
    try {
      clip = await readClipboard();
    } catch (e) {
      return st.showToast(`Could not read the clipboard: ${String((e as Error)?.message ?? e)}`);
    }
    const centre = board.centre?.() ?? [0, 0];
    const toCentre = (list: Shape[]) => {
      const b = shapesBox(list);
      if (!b) return list;
      const c = boxCenter(b);
      return list.map((s) => ({ ...s, matrix: multiply(translate(centre[0] - c[0], centre[1] - c[1]), s.matrix) }));
    };
    const own = clip ? ownShapes(clip.text) : null;
    if (own?.length) {
      // Fresh ids; shapes copied together stay grouped together.
      const groups = new Map<string, string>();
      const copies = own.map((s) => ({ ...s, id: newId(), group: s.group ? (groups.get(s.group) ?? groups.set(s.group, newId()).get(s.group)) : undefined }));
      const placed = toCentre(copies);
      st.commit([...useApp.getState().shapes, ...placed]);
      st.select(placed.map((s) => s.id));
      return;
    }
    const svg = clip ? pastedSvg(clip) : null;
    if (!svg) {
      return st.showToast(
        isDesktop
          ? 'Nothing to paste. In Illustrator or Word, select a shape and press Ctrl+C, then come back and press Ctrl+V.'
          : 'Nothing to paste. In the browser only Illustrator copies can be pasted (Word needs the desktop app).',
      );
    }
    const from = clip!.source === 'illustrator' ? 'Illustrator' : clip!.source === 'svg' ? 'Word / Office' : 'the clipboard';
    try {
      const imp = readOutlineText('Pasted.svg', svg);
      const shapes = toCentre(imp.shapes);
      if (imp.sources.length > 1) setPendingImport({ ...imp, shapes, name: `pasted from ${from}`, pasted: true });
      else placeImport(shapes, from, imp.note, true);
    } catch (e) {
      st.showToast(`Could not paste from ${from}: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const copy = async (cut: boolean) => {
    const st = useApp.getState();
    const sel = st.shapes.filter((s) => st.selected.includes(s.id));
    if (st.mode !== 'shape' || !sel.length) return;
    try {
      await copyShapes(sel);
      if (cut) st.deleteSelected();
    } catch (e) {
      st.showToast(`Could not copy: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const importFile = async (file: File) => {
    try {
      openText(file.name, await outlineFileText(file));
    } catch (e) {
      useApp.getState().showToast(String((e as Error)?.message ?? e));
    }
  };

  const fileInput2 = useRef<HTMLInputElement>(null);
  const files = {
    newProject: () => {
      if (useApp.getState().project.dirty && !window.confirm('Start a new project? Unsaved changes to this one will be lost.')) return;
      newProject();
    },
    open: async () => {
      if (useApp.getState().project.dirty && !window.confirm('Open another project? Unsaved changes to this one will be lost.')) return;
      if (!isDesktop) return fileInput2.current?.click();
      try {
        const f = await pickFile(true);
        if (f) openText(f.path, f.text);
      } catch (e) {
        useApp.getState().showToast(String((e as Error)?.message ?? e));
      }
    },
    importOutline: async () => {
      if (!isDesktop) return fileInput.current?.click();
      try {
        const f = await pickFile(false);
        if (f) openText(f.path, f.text);
      } catch (e) {
        useApp.getState().showToast(String((e as Error)?.message ?? e));
      }
    },
    openRecent: async (r: RecentProject) => {
      const st = useApp.getState();
      if (st.project.dirty && !window.confirm('Open another project? Unsaved changes to this one will be lost.')) return;
      try {
        openText(r.path, await readRecent(r));
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (/isn't there any more|wasn't kept/.test(msg)) forgetRecent(r.path);
        st.showToast(msg);
      }
    },
    paste: () => void paste(),
    copy: (cut: boolean) => void copy(cut),
    save: async (mode: 'save' | 'as' | 'rev') => {
      try {
        const where = await saveProject(mode);
        if (where) useApp.getState().showToast(`Saved to ${where}`);
      } catch (e) {
        useApp.getState().showToast(`Could not save: ${String((e as Error)?.message ?? e)}`);
      }
    },
  };
  const filesRef = useRef(files);
  filesRef.current = files;

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (document.querySelector('.dialog-backdrop')) return; // a dialog has the keys
      const st = useApp.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (ctrl && k === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (ctrl && k === 'y') {
        e.preventDefault();
        st.redo();
      } else if (ctrl && k === 's') {
        e.preventDefault();
        void filesRef.current.save(e.shiftKey ? 'as' : 'save');
      } else if (ctrl && k === 'o') {
        e.preventDefault();
        void filesRef.current.open();
      } else if (ctrl && k === 'i') {
        e.preventDefault();
        void filesRef.current.importOutline();
      } else if (ctrl && k === 'n') {
        e.preventDefault();
        filesRef.current.newProject();
      } else if (ctrl && k === 'v') {
        e.preventDefault();
        filesRef.current.paste();
      } else if (ctrl && (k === 'c' || k === 'x') && st.mode === 'shape' && st.selected.length) {
        e.preventDefault();
        filesRef.current.copy(k === 'x');
      } else if (ctrl && k === 'a' && st.mode === 'shape') {
        e.preventDefault();
        st.select(st.shapes.map((s) => s.id));
      } else if (ctrl && k === 'd' && st.selected.length) {
        e.preventDefault();
        const copies = st.shapes
          .filter((s) => st.selected.includes(s.id))
          .map((s) => ({ ...s, id: newId(), name: `${s.name} copy`, matrix: multiply(translate(20, -20), s.matrix) }));
        st.commit([...st.shapes, ...copies]);
        st.select(copies.map((c) => c.id));
      } else if (ctrl) {
        return;
      } else if (st.mode === 'inflate' && k === 's') {
        takeSnapshotRef.current();
      } else if (st.mode !== 'shape' && (k === 'arrowleft' || k === 'arrowright')) {
        e.preventDefault();
        stepFrame(st.mode === 'inflate' ? 'live' : 'library', k === 'arrowleft' ? -1 : 1);
      } else if (st.mode === 'shape') {
        if (k === 'v') st.setTool('select');
        else if (k === 'm') st.setTool(e.shiftKey ? 'builder' : 'rect');
        else if (k === 'n') st.setTool('pen');
        else if (k === 'c') st.setTool('circle');
        else if (k === 'l' || k === 'e') st.setTool('ellipse');
        else if (k === 'p') st.setTool('polygon');
        else if (k === 'r') st.setTool('triangle');
        else if (k === 'd') st.setTool('diamond');
        else if (k === 'o') st.setTool('pill');
        else if (k === 'g') st.setTool('body');
        else if (k === 's') st.setTool('star');
        else if (k === 't') st.setTool('text');
        else if (k === 'w') st.setTool('weld');
        else if (k === 'f') st.requestFit();
        else if (k === 'delete' || k === 'backspace') st.deleteSelected();
        else if (k === 'escape') {
          st.select([]);
          st.setTool('select');
        } else if (k.startsWith('arrow') && st.selected.length) {
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          const [dx, dy] = { arrowleft: [-d, 0], arrowright: [d, 0], arrowup: [0, d], arrowdown: [0, -d] }[k] as [number, number];
          st.commit(transformSelected(st.shapes, st.selected, translate(dx, dy)));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Toasts fade on their own.
  useEffect(() => {
    if (!toast) return;
    // One with a button stays longer, so there's time to read and press it.
    const id = setTimeout(() => useApp.getState().showToast(null), toastActions.length ? 20000 : 7000);
    return () => clearTimeout(id);
  }, [toast, toastActions]);

  // Drag-and-drop a DXF / DWG / SVG anywhere.
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void importFile(f);
  };

  const livePlates = settings.platesOn && usesPlates(settings.solver)
    ? { bottom: settings.plateOffsetMm - settings.plateThicknessMm / 2, top: settings.plateOffsetMm + settings.plateThicknessMm / 2 }
    : null;
  const inLibrary = mode === 'snapshots';
  const plates = inLibrary ? libView?.plates ?? null : livePlates;
  // Plates coming into use (switched on, or a solver that uses them) are
  // always shown, whatever the eye was left at (Guy: hidden plates on a
  // fresh switch-on would confuse a new user).
  const platesInUse = !!livePlates;
  useEffect(() => {
    if (platesInUse) useApp.getState().setShowPlates(true);
  }, [platesInUse]);

  /** Save the live piece, exactly as on screen, to Snapshots. */
  const takeSnapshot = async () => {
    const s = useSim.getState();
    const frame = s.frames[s.current];
    if (!s.mesh || !frame) {
      useApp.getState().showToast('Inflate something first, then save it as a form.');
      return;
    }
    const st = useApp.getState();
    const smoothRender = st.smooth && s.render && s.render.frame === s.current ? s.render : null;
    const preset = PRESETS.find((p) => p.id === st.presetId)?.name ?? 'Custom';
    const b = report.pieces.length ? boxOf(report.pieces.flatMap((p) => p.outer)) : null;
    const size = b ? ` · ${Math.round(boxWidth(b))}×${Math.round(boxHeight(b))}` : '';
    const n = fileSnapshots().length + 1;
    try {
      const snap = await library.save({
        name: `${n}. ${preset}${size}`,
        thumbnail: captureThumbnail(),
        settings: st.settings,
        pieces: report.pieces,
        outline: outlines,
        plates: livePlates,
        info: s.infos[s.current] ?? null,
        mesh: { vertexCount: s.mesh.vertexCount, indices: s.mesh.indices, uv: s.mesh.uv, weld: s.mesh.weld, topTriangles: s.mesh.topTriangles },
        positions: frame.slice(),
        crease: s.crease[s.current]?.slice(),
        render: smoothRender ? { ...smoothRender, positions: smoothRender.positions.slice() } : null,
        shapes: st.shapes,
        fileLabel: `${st.project.name} Rev ${st.project.rev}`,
        look: st.look,
        pvdColor: st.pvdColor,
        finishOpts: st.finishOpts,
        beetleFace: st.beetleFace,
        beetleEdge: st.beetleEdge,
      });
      // It's part of the project now, so the file has unsaved changes.
      useApp.getState().setProject({ dirty: true });
      st.showToast(
        `Saved “${snap.name}” to Forms${smoothRender ? '' : ' (raw mesh: turn on Smooth and let it settle to save the smooth one)'}.`,
      );
    } catch (e) {
      st.showToast(`Could not save the form: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const takeSnapshotRef = useRef(takeSnapshot);
  takeSnapshotRef.current = takeSnapshot;

  /** Whatever the 3D view shows, for the Export menu. */
  const onScreen = (): OnScreen | null => {
    const smoothOn = useApp.getState().smooth;
    if (useApp.getState().mode === 'snapshots') {
      const v = useLibrary.getState().view;
      const i = useLibrary.getState().current;
      if (!v || !v.frames[i]) return null;
      const useRender = smoothOn && v.render && v.render.frame === i;
      return {
        name: v.name,
        geom: useRender ? v.render! : v.mesh,
        pos: useRender ? v.render!.positions : v.frames[i],
        settings: v.settings,
        pieces: null,
        info: v.infos[i] ?? null,
        raw: { geom: v.mesh, pos: v.frames[i] },
        outlines: v.outline ?? [],
      };
    }
    const s = useSim.getState();
    if (!s.mesh || !s.frames[s.current]) return null;
    const useRender = smoothOn && s.render && s.render.frame === s.current;
    return {
      name: PRESETS.find((p) => p.id === useApp.getState().presetId)?.name ?? 'simflate',
      geom: useRender ? s.render! : s.mesh,
      pos: useRender ? s.render!.positions : s.frames[s.current],
      settings: useApp.getState().settings,
      pieces: report.pieces,
      info: s.infos[s.current] ?? null,
      raw: { geom: s.mesh, pos: s.frames[s.current] },
      outlines,
    };
  };

  return (
    <div className={`app mode-${mode}`} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <TopBar files={files} onScreen={onScreen} />
      <input
        ref={fileInput}
        type="file"
        accept=".dxf,.dwg,.svg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
        data-testid="file-input"
      />
      <input
        ref={fileInput2}
        type="file"
        accept=".simflate,.blownsim,.dxf,.dwg,.svg"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
        data-testid="project-input"
      />

      {mode === 'shape' ? (
        <div className="workspace">
          <ToolPalette onImport={() => void files.importOutline()} />
          <div className="center">
            <ControlBar />
            <Editor2D pieces={report.pieces} problems={report.problems} onOpenRecent={(r) => void files.openRecent(r)} />
          </div>
          <ShapePanel report={report} onInflate={() => useApp.getState().setMode('inflate')} />
        </div>
      ) : (
        <div className="workspace">
          <LookPalette />
          <div className="center">
            <div className="viewbar">
              <span className="viewbar-title">
                {inLibrary ? (libView ? libView.name : 'Pick a form on the right') : simStatus === 'idle' ? 'Ready to inflate' : 'Live'}
              </span>
              <span className="cb-spacer" />
              {/* Graphics chip, beside the view it draws (Guy, session 16). */}
              <GpuSwitch />
              <button
                className={`icon-btn${smooth ? ' on' : ''}`}
                onClick={() => useApp.getState().setSmooth(!smooth)}
                title="Smooth render mesh: subdivided and smoothed, keeping creases and the weld crisp. Shown once the piece is at rest."
                data-testid="smooth"
              >
                <Sparkles size={14} />
                <span className="icon-btn-label">{!inLibrary && finishing ? 'Smoothing…' : 'Smooth'}</span>
              </button>
              {plates && (
                <button className="icon-btn" onClick={() => useApp.getState().setShowPlates(!showPlates)} title={showPlates ? 'Hide plates' : 'Show plates'}>
                  {showPlates ? <Eye size={14} /> : <EyeOff size={14} />}
                  <span className="icon-btn-label">Plates</span>
                </button>
              )}
              <ContactButton plates={!!plates} />
            </div>
            <div className="viewport-wrap">
              {inLibrary ? (
                <Viewport3D
                  outlines={libView?.outline ?? []}
                  plates={plates}
                  mesh={libView?.mesh ?? null}
                  meshVersion={100000 + libVersion}
                  frame={libView?.frames[libCurrent]}
                  crease={libView?.creases?.[libCurrent]}
                  current={libCurrent}
                  render={libView?.render ?? null}
                  stage
                />
              ) : (
                <Viewport3D
                  outlines={outlines}
                  plates={plates}
                  mesh={liveMesh}
                  meshVersion={liveVersion}
                  frame={liveFrame}
                  crease={liveCrease}
                  contact={liveContact}
                  current={current}
                  render={render}
                />
              )}
              {!inLibrary && simStatus === 'error' && simError && <div className="view-error">{simError}</div>}
              {!inLibrary && simStatus === 'idle' && (
                <div className="view-hint">
                  Pick a preset or press <b>Inflate</b> to watch it blow up.
                </div>
              )}
              {!inLibrary && shortOfTarget && (
                <div className="view-hint subtle" data-testid="short-of-target">
                  Came to rest at {Math.round(shortOfTarget.heightMm)} mm at full pressure: this outline can't rise to {Math.round(settings.heightMm)} mm
                  {shortOfTarget.maxStretchPct >= 39 ? ' (the metal has reached its stretch limit)' : ''}. Lower the target height.
                </div>
              )}
              {!inLibrary && smooth && simStatus === 'settled' && !finishDone && finishing && <div className="view-hint subtle">Smoothing…</div>}
              {inLibrary && !libView && <div className="view-hint">Your forms are listed on the right.</div>}
            </div>
            {inLibrary ? <LibraryTimeline /> : <LiveTimeline />}
          </div>
          {inLibrary ? <SnapshotsPanel runsAvailable={runsAvailable} onScreen={onScreen} /> : <InflatePanel pieces={report.pieces} narrowestMm={narrowest} onSnapshot={takeSnapshot} canSnapshot={!!liveFrame} />}
        </div>
      )}

      {pendingImport && (
        <LineTypesDialog
          title={`Import ${pendingImport.name}`}
          okLabel="Import"
          shapes={pendingImport.shapes}
          sources={pendingImport.sources}
          initial={guessChoices(pendingImport.sources)}
          onCancel={() => setPendingImport(null)}
          onApply={(choices) => {
            remember(choices);
            setPendingImport(null);
            placeImport(applyChoices(pendingImport.shapes, choices), pendingImport.name, pendingImport.note, pendingImport.pasted);
          }}
        />
      )}

      {toast && (
        <div className="toast" onClick={() => useApp.getState().showToast(null)}>
          <button className="icon-btn toast-close" onClick={() => useApp.getState().showToast(null)} title="Close" data-testid="toast-close">
            <X size={14} />
          </button>
          {toast}
          {toastActions.length > 0 && (
            <div className="toast-actions">
              {toastActions.map((a, i) => (
                <button
                  key={a.label}
                  className={`btn${i === 0 ? ' primary' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    a.run();
                  }}
                  data-testid={`toast-action-${i}`}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
