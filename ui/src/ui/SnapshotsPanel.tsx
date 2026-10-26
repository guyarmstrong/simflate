// Snapshots tab, right panel: this project's snapshots (saved inside its
// file), the last few from anywhere else (Recent), and in the browser preview
// the runs made by the command-line solver.

import { upgradeSettings } from '../model/presets';
import { useEffect, useState } from 'react';
import { ArchiveRestore, Camera, ChevronDown, ChevronRight, Film, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useApp } from '../state/store';
import { migrateFinish } from '../viewer/materials';
import { RECENT_LIMIT, fileSnapshots, library, recentSnapshots, useLibrary } from '../library/library';
import { saveProject } from '../io/project';
import { fmt } from '../model/geometry';
import { checkShapes } from '../model/shapes';
import type { Snapshot } from '../library/db';
import { RenderSection } from './RenderSection';
import { useRender } from '../viewer/renderStore';
import { exportItems, onPackTextures, packTextures, runExport, setPackTextures, type OnScreen } from './exports';

interface RunEntry {
  name: string;
  frames: number;
  done: boolean;
}

function when(t: number) {
  const d = new Date(t);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `Today ${time}` : `${d.toLocaleDateString()} ${time}`;
}

/** Apply a snapshot's settings to whatever is on the board (shape untouched). */
function applySettings(snap: Snapshot) {
  const st = useApp.getState();
  st.updateSettings(upgradeSettings(snap.settings), null);
  st.setMode('inflate');
  st.showToast(`Settings from "${snap.name}" applied to your shape — press Re-run to inflate with them.`);
}

/** Put a snapshot's shape and settings back on the board (replaces it; Ctrl+Z undoes). */
function restoreAll(snap: Snapshot) {
  const st = useApp.getState();
  st.commit(checkShapes(snap.shapes).shapes);
  st.select([]);
  st.updateSettings(upgradeSettings(snap.settings), null);
  st.setMode('inflate');
  setTimeout(() => useApp.getState().requestFit(), 0);
  st.showToast(`Restored the shape and settings of "${snap.name}" — press Re-run to inflate. Ctrl+Z brings your previous shape back.`);
}

/** Open a snapshot with its own finish (Guy: a gold one opens gold). */
function openSnapshot(snap: Snapshot) {
  library.open(snap);
  if (!snap.look) return; // older snapshots didn't keep it
  const st = useApp.getState();
  // Its whole finish: coat and pattern too (none on forms saved before them).
  const { look, opts } = migrateFinish(snap.look, snap.finishOpts);
  st.setLook(look);
  st.setFinishOpts(opts);
  if (snap.pvdColor) st.setPvdColor(snap.pvdColor);
  if (snap.beetleFace && snap.beetleEdge) st.setBeetle(snap.beetleFace, snap.beetleEdge);
}

function SnapshotCard({ snap, active, fromFile, onRestore }: { snap: Snapshot; active: boolean; fromFile: boolean; onRestore: (s: Snapshot) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(snap.name);
  const s = snap.settings;
  // Three lines: when (and from which file), how it was made, what it came out as.
  const taken = [when(snap.created), ({ draft: 'Draft', medium: 'Medium', final: 'Final', xfine: 'X fine' } as Record<string, string>)[s.quality] ?? s.quality, !fromFile && snap.fileLabel ? `from ${snap.fileLabel}` : null]
    .filter(Boolean)
    .join(' · ');
  const made = [
    `P ${fmt(s.pressure, 0)}`,
    `${fmt(s.thicknessMm ?? 1, 2)} mm`,
    `Geo ${Math.round(s.character * 100)}`,
    s.platesOn ? `Plates ${fmt(s.plateThicknessMm)}` : null,
    s.fixOutline ? 'Fixed' : null,
    s.clampWhileInflating ? 'Clamped' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const result = snap.info ? `${fmt(snap.info.heightMm)} mm high · ${fmt(snap.info.volumeMl / 1000, 2)} L` : '';

  return (
    <li className={`snap${active ? ' on' : ''}`} onClick={() => openSnapshot(snap)} data-testid="snapshot-card">
      <div className="snap-screen">
        {/* The picture floats on the right of a black screen; words on the left (Guy). */}
        {snap.thumbnail ? <img src={snap.thumbnail} alt="" /> : null}
        <div className="snap-text">
          {editing ? (
            <input
              className="snap-name-input"
              value={name}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                setEditing(false);
                if (name.trim() && name !== snap.name) void library.rename(snap.id, name.trim());
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                  setName(snap.name);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <span
              className="snap-name"
              title="Double-click to rename"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditing(true);
              }}
            >
              {snap.name}
            </span>
          )}
          <span className="snap-meta" title={taken}>
            {taken}
          </span>
          <span className="snap-meta" title={made}>
            {made}
          </span>
          {result && (
            <span className="snap-meta" title={result}>
              {result}
            </span>
          )}
        </div>
        <div className="snap-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn"
            title={fromFile ? 'Delete form (from this file when you next save)' : 'Remove from Recent'}
            onClick={() => {
              if (confirmDelete(snap.name)) {
                void library.remove(snap.id);
                if (fromFile) useApp.getState().setProject({ dirty: true });
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="snap-buttons" onClick={(e) => e.stopPropagation()}>
        <button
          className="snap-btn"
          title="Copy these settings onto the shape on the board now (your shape stays)"
          onClick={() => applySettings(snap)}
          data-testid="snap-apply"
        >
          <SlidersHorizontal size={12} /> Apply settings
        </button>
        <button
          className="snap-btn"
          disabled={!snap.shapes?.length}
          title={
            snap.shapes?.length
              ? 'Replace the board with this form’s shape and settings'
              : 'This form is from before shapes were saved with it — use Apply settings'
          }
          onClick={() => onRestore(snap)}
          data-testid="snap-restore"
        >
          <ArchiveRestore size={12} /> Restore shape + settings
        </button>
      </div>
    </li>
  );
}

// A two-click delete: the first click arms it for 3 seconds.
let armed: { name: string; until: number } | null = null;
function confirmDelete(name: string): boolean {
  const now = Date.now();
  if (armed && armed.name === name && armed.until > now) {
    armed = null;
    return true;
  }
  armed = { name, until: now + 3000 };
  useApp.getState().showToast(`Click delete again to remove "${name}".`);
  return false;
}

/** Replace the board? Asked only when the current work isn't saved. */
function RestoreDialog({ snap, onClose }: { snap: Snapshot; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="dialog-backdrop dim" onPointerDown={onClose}>
      <div className="dialog ask" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid="restore-dialog">
        <h3>Replace your current work?</h3>
        <p className="muted small">“{snap.name}” will replace the shape and settings on the board. Your current work isn’t saved.</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onClose} autoFocus>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              restoreAll(snap);
              onClose();
            }}
            data-testid="restore-replace"
          >
            Replace
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const where = await saveProject('save');
                if (where) {
                  useApp.getState().showToast(`Saved to ${where}`);
                  restoreAll(snap);
                  onClose();
                }
              } catch (e) {
                useApp.getState().showToast(`Could not save: ${String((e as Error)?.message ?? e)}`);
              } finally {
                setBusy(false);
              }
            }}
            data-testid="restore-save"
          >
            Save first
          </button>
        </div>
      </div>
    </div>
  );
}

type PanelTab = 'forms' | 'render' | 'export';

/** Export tab: the same choices as the Export menu, as big buttons. */
function ExportSection({ onScreen }: { onScreen: () => OnScreen | null }) {
  const showToast = useApp((s) => s.showToast);
  useLibrary((s) => s.view); // ready once a form is open
  const [tex, setTex] = useState(packTextures);
  useEffect(() => onPackTextures(() => setTex(packTextures())), []);
  const items = exportItems(onScreen, showToast);
  return (
    <section className="export-section">
      <label className="export-tick" title="The finish and TIG weld baked into image maps, saved with the export. Off: plain stainless materials, quicker.">
        <input type="checkbox" checked={tex} onChange={(e) => setPackTextures(e.target.checked)} data-testid="pack-textures" />
        <span>Package textures</span>
        <em>KeyShot GLB, OBJ, SketchUp DAE</em>
      </label>
      {items.map((it) => (
        <button key={it.label} className="export-item" disabled={it.disabled} onClick={() => void runExport(it, showToast)}>
          <span>{it.label}</span>
          <em>{it.hint}</em>
        </button>
      ))}
      {items.every((it) => it.disabled) && <p className="muted small">Pick a form (or inflate a shape) first.</p>}
    </section>
  );
}

export function SnapshotsPanel({ runsAvailable, onScreen }: { runsAvailable: boolean; onScreen: () => OnScreen | null }) {
  useLibrary((s) => s.snapshots); // re-render when they change
  const mine = fileSnapshots().reverse();
  const recent = recentSnapshots();
  const view = useLibrary((s) => s.view);
  const project = useApp((s) => s.project);
  const [asking, setAsking] = useState<Snapshot | null>(null);
  const onRestore = (snap: Snapshot) => (useApp.getState().project.dirty ? setAsking(snap) : restoreAll(snap));
  const [runs, setRuns] = useState<RunEntry[]>([]);
  const [showRuns, setShowRuns] = useState(false);

  useEffect(() => {
    if (!runsAvailable || !showRuns) return;
    const refresh = () =>
      fetch('/api/runs', { cache: 'no-store' })
        .then((r) => r.json())
        .then(setRuns)
        .catch(() => setRuns([]));
    void refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [runsAvailable, showRuns]);

  // Forms | Render | Export tabs, side by side like KeyShot's. The Render
  // tab also switches the 3D view to the render studio.
  const studioOn = useRender((s) => s.open);
  const setRender = useRender((s) => s.set);
  const [picked, setPicked] = useState<PanelTab>('forms');
  const tab: PanelTab = studioOn ? 'render' : picked === 'render' ? 'forms' : picked;
  const pick = (t: PanelTab) => {
    setPicked(t);
    setRender({ open: t === 'render' });
  };
  const TABS: { id: PanelTab; label: string }[] = [
    { id: 'forms', label: 'Forms' },
    { id: 'render', label: 'Render' },
    { id: 'export', label: 'Export' },
  ];

  return (
    <aside className="panel">
      <nav className="panel-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => pick(t.id)} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'render' && <RenderSection />}
      {tab === 'export' && <ExportSection onScreen={onScreen} />}
      {tab === 'forms' && (
        <>
          <section className="grow">
            <header className="panel-head">
              <h2>
                This file{' '}
                <span className="preset-name">
                  · {project.name} Rev {project.rev}
                </span>
              </h2>
              <span className="value">{mine.length || ''}</span>
            </header>
            {mine.length === 0 ? (
              <div className="snap-empty">
                <Camera size={22} strokeWidth={1.4} />
                <p>
                  In <b>Inflate</b>, press <b>Save form</b> (or <b>S</b>) to save the piece exactly as it is on screen. Forms are saved inside this project’s
                  file.
                </p>
              </div>
            ) : (
              <ul className="snap-list">
                {mine.map((s) => (
                  <SnapshotCard key={s.id} snap={s} fromFile active={view?.kind === 'snapshot' && view.id === s.id} onRestore={onRestore} />
                ))}
              </ul>
            )}
            {recent.length > 0 && (
              <>
                <header className="panel-head snap-recent-head">
                  <h2>Recent</h2>
                  <span className="value" title={`The last ${RECENT_LIMIT} forms saved in this app, from any file`}>
                    {recent.length}
                  </span>
                </header>
                <ul className="snap-list">
                  {recent.map((s) => (
                    <SnapshotCard key={s.id} snap={s} fromFile={false} active={view?.kind === 'snapshot' && view.id === s.id} onRestore={onRestore} />
                  ))}
                </ul>
              </>
            )}
            {asking && <RestoreDialog snap={asking} onClose={() => setAsking(null)} />}
          </section>

          {runsAvailable && (
            <section>
              <button className="disclosure" onClick={() => setShowRuns(!showRuns)}>
                {showRuns ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Test runs (command line)
              </button>
              {showRuns && (
                <ul className="shape-list runs">
                  {runs.map((r) => (
                    <li
                      key={r.name}
                      className={view?.kind === 'run' && view.id === r.name ? 'on' : ''}
                      onClick={() => library.openRun(r.name)}
                      data-testid={`run-${r.name}`}
                    >
                      <Film size={14} strokeWidth={1.6} />
                      <span className="name">{r.name}</span>
                      <span className="size">{r.done ? `${r.frames} fr` : 'running…'}</span>
                    </li>
                  ))}
                  {!runs.length && <p className="muted small">None yet — double-click “Run test shapes.cmd”.</p>}
                </ul>
              )}
            </section>
          )}
        </>
      )}
    </aside>
  );
}
