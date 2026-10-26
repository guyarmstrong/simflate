// Project files (.simflate; older .blownsim): the drawing, inflate settings and look, as JSON.
// Exports (OBJ, STL, PNG…) are separate — this is the editable source.

import { upgradeSettings, type InflateSettings } from '../model/presets';
import { migrateFinish, type FinishOpts } from '../viewer/materials';
import { useApp } from '../state/store';
import { checkShapes, type Shape } from '../model/shapes';
import { download, isDesktop } from './files';
import { fileSnapshots, library, snapshotFromFile, snapshotToFile } from '../library/library';
import type { Snapshot } from '../library/db';
import { rememberRecent } from './recent';

export const PROJECT_EXT = '.simflate';
/** Projects saved before the rename (BlownSim) open as before. */
export const isProjectName = (name: string) => /\.(simflate|blownsim)$/i.test(name);
const FORMAT = 1;

interface ProjectFile {
  app: 'Simflate' | 'BlownSim';
  format: number;
  saved: string;
  name: string;
  rev: string;
  shapes: Shape[];
  settings: unknown;
  presetId: string | null;
  look: string;
  pvdColor: string;
  finishOpts?: Partial<FinishOpts>;
  beetleFace: string;
  beetleEdge: string;
  smooth: boolean;
  showWelds?: boolean;
  lockProportions: boolean;
  polygonSides: number;
  /** This project's snapshots (without their smooth mesh, rebuilt on opening). */
  snapshots?: unknown[];
}

/** "Rev A" → "Rev B", …, "Rev Z" → "Rev AA". */
export function nextRev(rev: string): string {
  const s = rev.toUpperCase().replace(/[^A-Z]/g, '') || 'A';
  const chars = s.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    if (chars[i] !== 'Z') {
      chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[i] = 'A';
    i--;
  }
  return 'A' + chars.join('');
}

export function fileName(name: string, rev: string): string {
  return `${name} Rev ${rev}${PROJECT_EXT}`;
}

/** Split "Wave panel Rev C.simflate" into name and revision. */
function parseFileName(path: string): { name: string; rev: string } {
  const base = path.split(/[\\/]/).pop()!.replace(/\.(simflate|blownsim)$/i, '');
  const m = /^(.*?)\s+Rev\s+([A-Z]+)$/i.exec(base);
  return m ? { name: m[1], rev: m[2].toUpperCase() } : { name: base, rev: 'A' };
}

function serialise(name: string, rev: string): string {
  const s = useApp.getState();
  const file: ProjectFile = {
    app: 'Simflate',
    format: FORMAT,
    saved: new Date().toISOString(),
    name,
    rev,
    shapes: s.shapes,
    settings: s.settings,
    presetId: s.presetId,
    look: s.look,
    pvdColor: s.pvdColor,
    finishOpts: s.finishOpts,
    beetleFace: s.beetleFace,
    beetleEdge: s.beetleEdge,
    smooth: s.smooth,
    showWelds: s.showWelds,
    lockProportions: s.lockProportions,
    polygonSides: s.polygonSides,
    snapshots: fileSnapshots().map(snapshotToFile),
  };
  return JSON.stringify(file, null, 1);
}

/** The file this session has opened or saved. The project path also survives
 *  closing the app, so the first Save of a session asks where (pre-filled):
 *  otherwise new work could silently replace an old file (Guy lost one). */
let confirmedPath: string | null = null;

/** Save. `mode`: 'save' reuses the current file, 'as' always asks, 'rev'
 *  saves a copy as the next revision. Returns where it went, or null. */
export async function saveProject(mode: 'save' | 'as' | 'rev'): Promise<string | null> {
  const st = useApp.getState();
  if (mode === 'save' && st.project.path && st.project.path !== confirmedPath) mode = 'as';
  const name = st.project.name;
  const rev = mode === 'rev' && st.project.path ? nextRev(st.project.rev) : st.project.rev;
  const text = serialise(name, rev);
  let where: string | null;
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = mode === 'save' ? st.project.path : null;
    // The dialog opens in the current file's folder.
    const dir = st.project.path ? st.project.path.replace(/[\\/][^\\/]*$/, '') : null;
    where = await invoke<string | null>('save_project', { path, name: fileName(name, rev), text, dir });
    if (!where) return null;
    confirmedPath = where;
    const parsed = parseFileName(where);
    useApp.getState().setProject({ path: where, name: parsed.name, rev: parsed.rev, dirty: false });
    rememberRecent(where, parsed.name, parsed.rev);
    void library.relabel(`${parsed.name} Rev ${parsed.rev}`);
  } else {
    download(fileName(name, rev), text, 'application/json');
    useApp.getState().setProject({ path: fileName(name, rev), name, rev, dirty: false });
    rememberRecent(fileName(name, rev), name, rev, text);
    void library.relabel(`${name} Rev ${rev}`);
    where = 'your Downloads folder';
  }
  return where;
}

/** Load a project's text into the app. Throws with a readable message.
 *  Returns how many damaged shapes were left out. */
export function loadProject(text: string, path: string): number {
  let f: Partial<ProjectFile>;
  try {
    f = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Simflate project (it could not be read).');
  }
  if ((f.app !== 'Simflate' && f.app !== 'BlownSim') || !Array.isArray(f.shapes)) throw new Error('This file is not a Simflate project.');
  if ((f.format ?? 1) > FORMAT) throw new Error('This project was saved by a newer Simflate — please update the app.');
  const fromName = parseFileName(path);
  const { shapes, dropped } = checkShapes(f.shapes);
  useApp.setState((s) => ({
    shapes,
    selected: [],
    past: [],
    future: [],
    settings: upgradeSettings(f.settings as Partial<InflateSettings>),
    presetId: f.presetId ?? null,
    look: f.look ? migrateFinish(f.look, f.finishOpts).look : s.look,
    pvdColor: f.pvdColor ?? s.pvdColor,
    finishOpts: migrateFinish(f.look ?? s.look, f.finishOpts).opts,
    beetleFace: f.beetleFace ?? s.beetleFace,
    beetleEdge: f.beetleEdge ?? s.beetleEdge,
    smooth: f.smooth ?? s.smooth,
    showWelds: f.showWelds ?? s.showWelds,
    lockProportions: f.lockProportions ?? s.lockProportions,
    polygonSides: f.polygonSides ?? s.polygonSides,
    mode: 'shape',
    tool: 'select',
  }));
  useApp.getState().setProject({ path, name: f.name ?? fromName.name, rev: f.rev ?? fromName.rev, dirty: false });
  rememberRecent(path, f.name ?? fromName.name, f.rev ?? fromName.rev, text);
  confirmedPath = path;
  const snaps = (f.snapshots ?? []).map(snapshotFromFile).filter((x): x is Snapshot => !!x);
  void library.openFile(snaps);
  setTimeout(() => useApp.getState().requestFit(), 0);
  return dropped;
}

/** Ask for a file in the desktop app. Returns null if cancelled. */
export async function pickFile(project: boolean): Promise<{ path: string; text: string } | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<[string, string] | null>('open_file', { project });
  return r ? { path: r[0], text: r[1] } : null;
}

/** Start a fresh, empty project. */
export function newProject() {
  useApp.setState({ shapes: [], selected: [], past: [], future: [], mode: 'shape', tool: 'select' });
  useApp.getState().setProject({ path: null, name: 'Untitled', rev: 'A', dirty: false });
  void library.newFile();
}
