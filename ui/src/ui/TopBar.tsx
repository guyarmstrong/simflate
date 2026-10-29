// Top bar, laid out like a desktop app: File, Edit, New / Open / Save and
// undo / redo at the top left, the Draft / Inflate / Forms switch in the
// middle, Quick export PNG at the right.

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, DraftingCompass, FilePlus, FileOutput, FolderOpen, Gauge, ImageDown, Redo2, Save, Undo2 } from 'lucide-react';
import { FormIcon } from './icons';
import { useApp, type Mode } from '../state/store';
import { useLibrary } from '../library/library';
import { exportItems, onPackTextures, packTextures, runExport, setPackTextures, type OnScreen } from './exports';
import { quickPng } from './quickPng';
import { clearRecent, useRecent, whenText, type RecentProject } from '../io/recent';
import { nextRev } from '../io/project';
import { multiply, translate } from '../model/geometry';
import { newId } from '../model/shapes';
import { illustratorScale, onIllustratorScale, setIllustratorScale } from '../io/clipboard';
import { buildDxf, buildSvg } from '../io/flatExport';
import { saveFiles } from '../io/files';
import { DiagnosticsDialog } from './Diagnostics';

export type { OnScreen } from './exports';

/** File actions (App owns them so the shortcuts and the menu share them). */
export interface FileActions {
  newProject: () => void;
  open: () => void | Promise<void>;
  importOutline: () => void | Promise<void>;
  save: (mode: 'save' | 'as' | 'rev') => void | Promise<void>;
  openRecent: (r: RecentProject) => void | Promise<void>;
  paste: () => void;
  copy: (cut: boolean) => void;
}

// Internal ids stay 'shape' / 'snapshots'; Guy's names are Draft and Forms.
const MODES: { id: Mode; label: string; icon: (p: { size?: number; strokeWidth?: number }) => React.ReactNode; title: string }[] = [
  { id: 'shape', label: 'Draft', icon: DraftingCompass, title: 'Draw or import the flat outline' },
  { id: 'inflate', label: 'Inflate', icon: Gauge, title: 'Inflate it and watch' },
  { id: 'snapshots', label: 'Forms', icon: FormIcon, title: 'Saved forms' },
];

/** The Draft / Inflate / Forms switch, with a highlight that slides between them. */
function ModeSwitch() {
  const mode = useApp((s) => s.mode);
  const setMode = useApp((s) => s.setMode);
  const count = useLibrary((s) => s.snapshots.length);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const b = refs.current[mode];
      if (b) setPill({ left: b.offsetLeft, width: b.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [mode, count]);

  return (
    <nav className="modes" role="tablist">
      {pill && <span className="mode-pill" style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} />}
      {MODES.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          ref={(el) => {
            refs.current[id] = el;
          }}
          role="tab"
          aria-selected={mode === id}
          className={mode === id ? 'on' : ''}
          onClick={() => setMode(id)}
          title={title}
          data-testid={`mode-${id}`}
        >
          <Icon size={15} strokeWidth={1.8} />
          <span className="mode-label">{label}</span>
          {id === 'snapshots' && count > 0 && <span className="mode-count">{count}</span>}
        </button>
      ))}
    </nav>
  );
}

export function TopBar({ files, onScreen }: { files: FileActions; onScreen: () => OnScreen | null }) {
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const dirty = useApp((s) => s.project.dirty);
  const { undo, redo } = useApp.getState();
  const [about, setAbout] = useState(false);
  const openAbout = (e: React.MouseEvent) => {
    e.preventDefault();
    setAbout(true);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <button className="brand-btn" onClick={openAbout} onContextMenu={openAbout} title={`Simflate v${import.meta.env.VITE_APP_VERSION}: about, checks and problem reports`} data-testid="about">
          <img className="brand-mark" src="/favicon.png" alt="" />
          <span className="brand-name">Simflate</span>
        </button>
        {about && <DiagnosticsDialog onClose={() => setAbout(false)} />}
        <nav className="menubar" aria-label="Menus">
          <FileMenu files={files} onScreen={onScreen} />
          <EditMenu files={files} />
        </nav>
        <div className="undo-redo">
          <button className="icon-btn" onClick={files.newProject} title="New project (Ctrl+N)" data-testid="quick-new">
            <FilePlus size={16} />
          </button>
          <button className="icon-btn" onClick={() => void files.open()} title="Open a project (Ctrl+O)" data-testid="quick-open">
            <FolderOpen size={16} />
          </button>
          <button className={`icon-btn save-btn${dirty ? ' dirty' : ''}`} onClick={() => void files.save('save')} title={dirty ? 'Save (Ctrl+S) — there are unsaved changes' : 'Save (Ctrl+S)'} data-testid="quick-save">
            <Save size={16} />
          </button>
          <span className="cb-sep" />
          <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" data-testid="undo">
            <Undo2 size={16} />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" data-testid="redo">
            <Redo2 size={16} />
          </button>
        </div>
        <ProjectName />
      </div>
      <ModeSwitch />
      <div className="topbar-right">
        <QuickPng />
        <OutlineExport />
      </div>
    </header>
  );
}

function ProjectName() {
  const p = useApp((s) => s.project);
  return (
    <span className="project-name" title={p.path ?? 'Not saved yet'} data-testid="project-name">
      {p.name} <em>Rev {p.rev}</em>
      {p.dirty && <i className="dirty-dot" title="Unsaved changes" />}
    </span>
  );
}

interface MenuItem {
  label: string;
  hint: string;
  run: () => void;
  sep?: boolean;
  disabled?: boolean;
  /** A small heading above this item (e.g. "Recent projects"). */
  head?: string;
  title?: string;
  /** One line: a long label ends in "…" (Recent projects; full path in the tooltip). */
  clip?: boolean;
}

/** A menu (File, Edit at the top left; `right`: one at the right, e.g. the
 *  outline export): opens under its button, closes on any click outside. */
function Menu({ title, items, note, testId, right, buttonClass, tip }: { title: ReactNode; items: MenuItem[]; note?: string; testId: string; right?: boolean; buttonClass?: string; tip?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);
  return (
    <div className={right ? 'menu' : 'menu left'} ref={ref}>
      <button className={`${buttonClass ?? 'menubar-btn'}${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title={tip} data-testid={testId}>
        {title}
      </button>
      {open && (
        <div className="menu-list">
          {items.map((it) => (
            <Fragment key={it.label}>
              {it.sep && <hr className="menu-hr" />}
              {it.head && <p className="menu-head">{it.head}</p>}
              <button
                className={it.clip ? 'clip' : undefined}
                disabled={it.disabled}
                title={it.title ?? it.label}
                onClick={() => {
                  setOpen(false);
                  it.run();
                }}
              >
                <span>{it.label}</span>
                <em>{it.hint}</em>
              </button>
            </Fragment>
          ))}
          {note && <p className="menu-note">{note}</p>}
        </div>
      )}
    </div>
  );
}

function EditMenu({ files }: { files: FileActions }) {
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const shapeMode = useApp((s) => s.mode === 'shape');
  const anySelected = useApp((s) => s.selected.length > 0);
  const anyShapes = useApp((s) => s.shapes.length > 0);
  const showToast = useApp((s) => s.showToast);
  const [illus, setIllus] = useState(illustratorScale);
  useEffect(() => onIllustratorScale(() => setIllus(illustratorScale())), []);
  const st = useApp.getState;
  const duplicate = () => {
    const { shapes, selected, commit, select } = st();
    const copies = shapes.filter((s) => selected.includes(s.id)).map((s) => ({ ...s, id: newId(), name: `${s.name} copy`, matrix: multiply(translate(20, -20), s.matrix) }));
    commit([...shapes, ...copies]);
    select(copies.map((c) => c.id));
  };
  const items: MenuItem[] = [
    { label: 'Undo', hint: 'Ctrl+Z', run: () => st().undo(), disabled: !canUndo },
    { label: 'Redo', hint: 'Ctrl+Shift+Z', run: () => st().redo(), disabled: !canRedo },
    { label: 'Cut', hint: 'Ctrl+X', run: () => files.copy(true), disabled: !shapeMode || !anySelected, sep: true },
    { label: 'Copy', hint: 'Ctrl+C', run: () => files.copy(false), disabled: !shapeMode || !anySelected },
    { label: 'Paste', hint: 'Ctrl+V', run: files.paste, title: 'Shapes copied here, or in Illustrator or Word' },
    {
      label: `Illustrator pastes: ${illus === 'dxf' ? 'DXF mm (×2.83)' : 'real size'}`,
      hint: 'switch',
      title: "Real size: as Illustrator holds it. DXF mm: for a DXF opened in Illustrator, which reads each DXF unit as a point — its numbers are read as mm (2.83× bigger).",
      run: () => {
        const next = illus === 'dxf' ? 'real' : 'dxf';
        setIllustratorScale(next);
        showToast(next === 'dxf' ? "Illustrator pastes now read Illustrator's numbers as mm (for DXFs opened in Illustrator)." : 'Illustrator pastes now come in at real size.');
      },
    },
    { label: 'Duplicate', hint: 'Ctrl+D', run: duplicate, disabled: !shapeMode || !anySelected, sep: true },
    { label: 'Delete', hint: 'Del', run: () => st().deleteSelected(), disabled: !shapeMode || !anySelected },
    { label: 'Select all', hint: 'Ctrl+A', run: () => st().select(st().shapes.map((s) => s.id)), disabled: !shapeMode || !anyShapes, sep: true },
    { label: 'Select none', hint: 'Esc', run: () => st().select([]), disabled: !shapeMode || !anySelected },
  ];
  return <Menu title="Edit" items={items} testId="edit-menu" />;
}

function FileMenu({ files, onScreen }: { files: FileActions; onScreen: () => OnScreen | null }) {
  const rev = useApp((s) => s.project.rev);
  const saved = useApp((s) => !!s.project.path);
  const showToast = useApp((s) => s.showToast);
  const recent = useRecent((s) => s.list);
  const current = useApp((s) => s.project.path);
  const [tex, setTex] = useState(packTextures);
  useEffect(() => onPackTextures(() => setTex(packTextures())), []);
  const recentItems: MenuItem[] = recent
    .filter((r) => r.path !== current)
    .slice(0, 6)
    .map((r, i) => ({
      label: `${r.name} Rev ${r.rev}`,
      hint: whenText(r.when),
      title: r.path,
      sep: i === 0,
      head: i === 0 ? 'Recent projects' : undefined,
      clip: true,
      run: () => void files.openRecent(r),
    }));
  if (recentItems.length) recentItems.push({ label: 'Clear recent list', hint: '', run: clearRecent });
  // The full exports (KeyShot, OBJ, STEP, STL) of what the 3D view shows.
  const exports: MenuItem[] = exportItems(onScreen, showToast)
    .filter((it) => it.label !== 'PNG image')
    .map((it, i) => ({ label: `Export ${it.label}`, hint: it.hint, disabled: it.disabled, sep: i === 0, run: () => void runExport(it, showToast) }));
  exports.push({
    label: `${tex ? '☑' : '☐'} Package textures`,
    hint: 'GLB, OBJ, DAE',
    title: 'The finish and TIG weld baked into image maps, saved with the export. Off: plain stainless materials, quicker.',
    run: () => {
      setPackTextures(!tex);
      showToast(tex ? 'Exports now save plain materials, no textures.' : 'Exports now package the baked textures (GLB, OBJ, DAE).');
    },
  });
  const items: MenuItem[] = [
    { label: 'New project', hint: 'Ctrl+N', run: files.newProject },
    { label: 'Open…', hint: 'Ctrl+O', run: () => void files.open() },
    ...recentItems,
    { label: 'Save', hint: 'Ctrl+S', run: () => void files.save('save'), sep: true },
    { label: 'Save as…', hint: 'Ctrl+Shift+S', run: () => void files.save('as') },
    { label: saved ? `Save as Rev ${nextRev(rev)}` : 'Save as next revision', hint: 'keeps the old one', run: () => void files.save('rev') },
    { label: 'Import DXF / DWG / SVG…', hint: 'Ctrl+I', run: () => void files.importOutline(), sep: true },
    ...exports,
  ];
  return <Menu title="File" items={items} testId="file-menu" note="Projects save as .simflate (older .blownsim files open too; drawing, settings and look). The exports take what the 3D view shows (also in Forms → Export)." />;
}

/** Draft board: the flat drawing (the selection, or everything) as DXF or
 *  SVG, real size in mm, line types on their own layers (Guy, session 20).
 *  DWG is Autodesk's closed format: the DXF opens in AutoCAD, Save as DWG. */
function OutlineExport() {
  const draft = useApp((s) => s.mode === 'shape');
  const anySelected = useApp((s) => s.selected.length > 0);
  const anyShapes = useApp((s) => s.shapes.length > 0);
  const showToast = useApp((s) => s.showToast);
  if (!draft) return null;
  const run = async (which: 'selected' | 'all', format: 'dxf' | 'svg') => {
    const st = useApp.getState();
    const shapes = which === 'selected' ? st.shapes.filter((s) => st.selected.includes(s.id)) : st.shapes;
    if (!shapes.length) return;
    const name = `${st.project.name} Rev ${st.project.rev} ${which === 'selected' ? 'selection' : 'outline'}.${format}`;
    try {
      const where = await saveFiles([{ name, data: format === 'dxf' ? buildDxf(shapes) : buildSvg(shapes), type: format === 'dxf' ? 'application/dxf' : 'image/svg+xml' }]);
      if (where) showToast(`Saved to ${where}`);
    } catch (e) {
      showToast(`Could not export: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const items: MenuItem[] = [
    { label: 'Selected as DXF', hint: 'AutoCAD, cutting', run: () => void run('selected', 'dxf'), disabled: !anySelected, head: 'Selected pieces' },
    { label: 'Selected as SVG', hint: 'Illustrator', run: () => void run('selected', 'svg'), disabled: !anySelected },
    { label: 'All as DXF', hint: 'AutoCAD, cutting', run: () => void run('all', 'dxf'), disabled: !anyShapes, sep: true, head: 'Everything on the board' },
    { label: 'All as SVG', hint: 'Illustrator', run: () => void run('all', 'svg'), disabled: !anyShapes },
  ];
  return (
    <Menu
      right
      title={
        <>
          <FileOutput size={14} /> <span className="btn-label">Export outline</span> <ChevronDown size={13} />
        </>
      }
      buttonClass="btn ghost"
      tip="The flat drawing as DXF or SVG, real size in mm"
      items={items}
      note="Real size in mm; Outline, Weld and Construction on their own layers. For DWG: open the DXF in AutoCAD and Save as DWG."
      testId="outline-export"
    />
  );
}

/** One click: the main view (Draft board or 3D view) as a 4K PNG. */
function QuickPng() {
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const where = await quickPng();
      showToast(where ? `Saved to ${where}` : 'Nothing on screen to save yet.');
    } catch (e) {
      showToast(`Could not save the picture: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn ghost" onClick={() => void run()} disabled={busy} title="Save what's on screen as a 4K PNG picture — Draft board, Inflate or Forms" data-testid="export">
      <ImageDown size={14} /> <span className="btn-label">{busy ? 'Saving…' : 'Quick export PNG'}</span>
    </button>
  );
}
