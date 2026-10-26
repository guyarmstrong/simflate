// The Snapshots tab: saved snapshots (and, in the browser preview, the
// command-line test runs). Viewing one never disturbs the live inflation.

import { create } from 'zustand';
import type { Vec2 } from '../model/geometry';
import type { InflateSettings } from '../model/presets';
import type { FrameInfo, RenderMeshData, SimMesh } from '../sim/simStore';
import { snapshotsDb, type Snapshot } from './db';
import { toSolverSettings, upgradeSettings } from '../model/presets';
import type { FromWorker, ToWorker } from '../sim/worker';

export interface LibraryView {
  kind: 'snapshot' | 'run';
  id: string;
  name: string;
  mesh: SimMesh;
  frames: Float32Array[];
  /** Crease field per frame, when known. */
  creases?: Float32Array[];
  infos: FrameInfo[];
  render: RenderMeshData | null;
  outline: Vec2[][];
  plates: { bottom: number; top: number } | null;
  settings: InflateSettings | null;
  done: boolean;
}

interface LibraryState {
  snapshots: Snapshot[];
  loaded: boolean;
  view: LibraryView | null;
  current: number;
  playing: boolean;
  viewVersion: number;
  setCurrent: (i: number) => void;
  setPlaying: (b: boolean) => void;
}

export const useLibrary = create<LibraryState>((set) => ({
  snapshots: [],
  loaded: false,
  view: null,
  current: 0,
  playing: false,
  viewVersion: 0,
  setCurrent: (i) => set((s) => ({ current: Math.max(0, Math.min((s.view?.frames.length ?? 1) - 1, i)) })),
  setPlaying: (playing) => set({ playing }),
}));

/** How many snapshots the Recent list keeps (Guy: a number, not an age). */
export const RECENT_LIMIT = 30;

let newId = 0;

/** Snapshots of the open project, oldest first (what goes into its file). */
export function fileSnapshots(): Snapshot[] {
  return useLibrary
    .getState()
    .snapshots.filter((s) => s.openFile)
    .sort((a, b) => a.created - b.created);
}

/** Snapshots from other projects (and unsaved work), newest first. */
export function recentSnapshots(): Snapshot[] {
  return useLibrary
    .getState()
    .snapshots.filter((s) => !s.openFile && s.recentAt)
    .sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0));
}

async function putAll(snaps: Snapshot[]) {
  for (const s of snaps) await snapshotsDb.put(s);
}

/** Keep the newest RECENT_LIMIT in Recent. Older ones leave it; they're
 *  deleted unless they belong to the open project (then they stay in its file). */
async function trimRecent() {
  const recent = useLibrary
    .getState()
    .snapshots.filter((s) => s.recentAt)
    .sort((a, b) => (b.recentAt ?? 0) - (a.recentAt ?? 0));
  const old = recent.slice(RECENT_LIMIT);
  if (!old.length) return;
  const gone = new Set<string>();
  const kept: Snapshot[] = [];
  for (const s of old) {
    if (s.openFile) {
      const next = { ...s, recentAt: undefined };
      await snapshotsDb.put(next);
      kept.push(next);
    } else {
      await snapshotsDb.remove(s.id);
      gone.add(s.id);
    }
  }
  const byId = new Map(kept.map((k) => [k.id, k]));
  useLibrary.setState((st) => ({ snapshots: st.snapshots.filter((x) => !gone.has(x.id)).map((x) => byId.get(x.id) ?? x) }));
}

/** The open project's snapshots leave "This file": ones also in Recent stay there, the rest are dropped. */
async function releaseFile() {
  const all = useLibrary.getState().snapshots;
  const next: Snapshot[] = [];
  for (const s of all) {
    if (!s.openFile) {
      next.push(s);
    } else if (s.recentAt) {
      const r = { ...s, openFile: false };
      await snapshotsDb.put(r);
      next.push(r);
    } else {
      await snapshotsDb.remove(s.id);
    }
  }
  useLibrary.setState({ snapshots: next });
}

const EXAMPLES_KEY = 'simflate.examplesAdded';

/** A fresh install starts with example forms in Recent (Guy's picks,
 *  bundled in public/examples). They sit below everything taken here and
 *  leave as Recent fills up. Only ever once, so deleting them sticks. */
async function addExamples(have: number): Promise<Snapshot[]> {
  try {
    if (localStorage.getItem(EXAMPLES_KEY)) return [];
    localStorage.setItem(EXAMPLES_KEY, '1');
  } catch {
    return [];
  }
  if (have) return [];
  try {
    const file = await (await fetch('/examples/forms.json')).json();
    const raw: unknown[] = file.examples ?? [];
    const snaps = raw
      .map(snapshotFromFile)
      .filter((s): s is Snapshot => !!s)
      .map((s, i, all) => ({ ...s, recentAt: all.length - i }));
    await putAll(snaps);
    return snaps;
  } catch {
    return [];
  }
}

export const library = {
  async load() {
    try {
      const all = await snapshotsDb.all();
      all.push(...(await addExamples(all.length)));
      // Snapshots from before Recent / This file: treat as recent, in taking order.
      const upgraded = all.map((s) => (s.recentAt || s.openFile ? s : { ...s, recentAt: s.created }));
      useLibrary.setState({ snapshots: upgraded, loaded: true });
      await putAll(upgraded.filter((s, i) => s !== all[i]));
      await trimRecent();
    } catch {
      useLibrary.setState({ loaded: true });
    }
  },

  /** A new snapshot: it belongs to the open project and joins Recent. */
  async save(snap: Omit<Snapshot, 'id' | 'created' | 'recentAt' | 'openFile'>): Promise<Snapshot> {
    const now = Date.now();
    const full: Snapshot = { ...snap, id: `snap-${now.toString(36)}-${(newId++).toString(36)}`, created: now, recentAt: now, openFile: true };
    await snapshotsDb.put(full);
    useLibrary.setState((s) => ({ snapshots: [full, ...s.snapshots] }));
    await trimRecent();
    return full;
  },

  async rename(id: string, name: string) {
    const snap = useLibrary.getState().snapshots.find((s) => s.id === id);
    if (!snap) return;
    const next = { ...snap, name };
    await snapshotsDb.put(next);
    useLibrary.setState((s) => ({
      snapshots: s.snapshots.map((x) => (x.id === id ? next : x)),
      view: s.view?.id === id ? { ...s.view, name } : s.view,
    }));
  },

  async remove(id: string) {
    await snapshotsDb.remove(id);
    useLibrary.setState((s) => ({ snapshots: s.snapshots.filter((x) => x.id !== id), view: s.view?.id === id ? null : s.view }));
  },

  /** A project was opened: its file's snapshots become "This file". */
  async openFile(snaps: Snapshot[]) {
    await releaseFile();
    const have = new Map(useLibrary.getState().snapshots.map((s) => [s.id, s]));
    const mine = snaps.map((s) => ({ ...s, openFile: true, recentAt: have.get(s.id)?.recentAt, render: have.get(s.id)?.render ?? null }));
    await putAll(mine);
    const ids = new Set(mine.map((s) => s.id));
    useLibrary.setState((st) => ({ snapshots: [...st.snapshots.filter((x) => !ids.has(x.id)), ...mine], view: null }));
  },

  /** A new, empty project: nothing in "This file". */
  async newFile() {
    await releaseFile();
    useLibrary.setState({ view: null });
  },

  /** The project was saved under a (new) name: label its snapshots. */
  async relabel(fileLabel: string) {
    const mine = useLibrary
      .getState()
      .snapshots.filter((s) => s.openFile && s.fileLabel !== fileLabel)
      .map((s) => ({ ...s, fileLabel }));
    await putAll(mine);
    const byId = new Map(mine.map((m) => [m.id, m]));
    useLibrary.setState((st) => ({ snapshots: st.snapshots.map((x) => byId.get(x.id) ?? x) }));
  },

  open(snap: Snapshot) {
    stopPolling();
    useLibrary.setState((s) => ({
      view: {
        kind: 'snapshot',
        id: snap.id,
        name: snap.name,
        mesh: snap.mesh,
        frames: [snap.positions],
        creases: snap.crease ? [snap.crease] : undefined,
        infos: snap.info ? [snap.info] : [],
        render: snap.render ? { ...snap.render, frame: 0 } : null,
        outline: snap.outline,
        plates: snap.plates,
        settings: snap.settings,
        done: true,
      },
      current: 0,
      playing: false,
      viewVersion: s.viewVersion + 1,
    }));
    // Snapshots from a project file carry no smooth mesh (it's big): rebuild it.
    if (!snap.render) void rebuildRender(snap);
  },

  /** Play back a run saved by the command-line solver (runs/<name>/). */
  async openRun(name: string) {
    stopPolling();
    const mesh = await (await fetch(`/runs/${encodeURIComponent(name)}/mesh.json`, { cache: 'no-store' })).json();
    const p = mesh.settings?.plates;
    useLibrary.setState((s) => ({
      view: {
        kind: 'run',
        id: name,
        name,
        mesh: {
          vertexCount: mesh.vertexCount,
          indices: new Uint32Array(mesh.indices),
          uv: new Float32Array(mesh.uv),
          weld: new Uint8Array(mesh.weld),
          topTriangles: mesh.topTriangles,
        },
        frames: [],
        infos: [],
        render: null,
        outline: mesh.outline ?? [],
        plates: p ? { bottom: p.offsetMm - p.thicknessMm / 2, top: p.offsetMm + p.thicknessMm / 2 } : null,
        settings: null,
        done: false,
      },
      current: 0,
      playing: false,
      viewVersion: s.viewVersion + 1,
    }));
    const poll = async () => {
      const v = useLibrary.getState().view;
      if (!v || v.kind !== 'run' || v.id !== name) return;
      const manifest = await (await fetch(`/runs/${encodeURIComponent(name)}/manifest.json`, { cache: 'no-store' })).json();
      const have = v.frames.length;
      const want = manifest.frames as number;
      const fresh: Float32Array[] = [];
      for (let i = have; i < want; i += 16) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(16, want - i) }, (_, k) =>
            fetch(`/runs/${encodeURIComponent(name)}/frames/${String(i + k).padStart(5, '0')}.bin`, { cache: 'no-store' }).then((r) => r.arrayBuffer()),
          ),
        );
        fresh.push(...batch.map((b) => new Float32Array(b)));
      }
      const st = useLibrary.getState();
      if (!st.view || st.view.id !== name) return;
      const frames = [...st.view.frames, ...fresh];
      const atEnd = st.current >= st.view.frames.length - 1;
      const done = manifest.done && want === frames.length;
      useLibrary.setState({
        view: { ...st.view, frames, infos: manifest.info.slice(0, frames.length), done },
        current: atEnd ? frames.length - 1 : st.current,
      });
      if (!done) pollTimer = setTimeout(poll, 400);
    };
    await poll();
  },
};

let pollTimer: ReturnType<typeof setTimeout> | null = null;
function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

/** Shrink the 3D canvas to a small JPEG for the snapshot card. */
export function captureThumbnail(): string {
  const c = document.querySelector('.viewport3d canvas') as HTMLCanvasElement | null;
  if (!c) return '';
  const w = 360;
  const h = Math.round((w * c.height) / Math.max(c.width, 1));
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  t.getContext('2d')!.drawImage(c, 0, 0, w, h);
  return t.toDataURL('image/jpeg', 0.82);
}

// --- Rebuilding a snapshot's smooth mesh (project files don't carry it).
// A second solver worker re-meshes the snapshot's outline with its settings
// (meshing is deterministic, so the points match) and runs the finisher on
// the saved shape. One at a time.
let finisher: Worker | null = null;
let queue: Promise<void> = Promise.resolve();

function rebuildRender(snap: Snapshot): Promise<void> {
  queue = queue.then(() => rebuildOne(snap)).catch(() => {});
  return queue;
}

async function rebuildOne(snap: Snapshot) {
  if (!snap.pieces?.length) return;
  finisher ??= new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const w = finisher;
  const s = upgradeSettings(snap.settings);
  const render = await new Promise<RenderMeshData | null>((resolve) => {
    const done = (r: RenderMeshData | null) => {
      w.removeEventListener('message', onMsg);
      resolve(r);
    };
    const finish = () => {
      const msg: ToWorker = {
        type: 'finish',
        frame: 0,
        positions: snap.positions.slice(),
        levels: s.quality === 'final' ? 2 : 1,
        iterations: 4,
        creaseDeg: 50,
        ripples: s.edgeRipples,
        fillet: s.weldFilletMm,
        ridges: s.ridgeSharpness,
        thick: s.showThickness,
      };
      w.postMessage(msg);
    };
    const onMsg = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'mesh') {
        // The mesher has changed since it was taken: finish the snapshot's own mesh instead.
        if (m.vertexCount !== snap.mesh.vertexCount) {
          const { indices, uv, weld, topTriangles } = snap.mesh;
          const adopt: ToWorker = { type: 'adopt', indices, uv, weld, topTriangles };
          w.postMessage(adopt);
        } else finish();
      } else if (m.type === 'adopted') {
        if (m.ok) finish();
        else done(null);
      } else if (m.type === 'finished') {
        const { frame, levels, ripples, fillet, ridges, thick, positions, indices, uv, origin, topTriangles } = m;
        done({ frame, levels, ripples, fillet, ridges, thick, positions, indices, uv, origin, topTriangles });
      } else if (m.type === 'error' || m.type === 'finishFailed') {
        done(null);
      }
    };
    w.addEventListener('message', onMsg);
    const start: ToWorker = { type: 'start', pieces: snap.pieces, settings: toSolverSettings(s), meshOnly: true };
    w.postMessage(start);
  });
  if (!render) return;
  const st = useLibrary.getState();
  if (st.view?.kind === 'snapshot' && st.view.id === snap.id) useLibrary.setState({ view: { ...st.view, render } });
  // Keep it on this computer so reopening is instant (the file stays small).
  const rec = st.snapshots.find((x) => x.id === snap.id);
  if (rec) {
    const next = { ...rec, render };
    await snapshotsDb.put(next);
    useLibrary.setState((x) => ({ snapshots: x.snapshots.map((y) => (y.id === snap.id ? next : y)) }));
  }
}

// --- Snapshots inside project files: typed arrays as base64, no smooth mesh.
function b64(a: ArrayBufferView): string {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** A snapshot as stored in a project file. */
export function snapshotToFile(s: Snapshot): unknown {
  return {
    id: s.id,
    name: s.name,
    created: s.created,
    thumbnail: s.thumbnail,
    settings: s.settings,
    pieces: s.pieces,
    outline: s.outline,
    plates: s.plates,
    info: s.info,
    shapes: s.shapes,
    fileLabel: s.fileLabel,
    look: s.look,
    pvdColor: s.pvdColor,
    finishOpts: s.finishOpts,
    beetleFace: s.beetleFace,
    beetleEdge: s.beetleEdge,
    mesh: {
      vertexCount: s.mesh.vertexCount,
      topTriangles: s.mesh.topTriangles,
      indices: b64(s.mesh.indices),
      uv: b64(s.mesh.uv),
      weld: b64(s.mesh.weld),
    },
    positions: b64(s.positions),
    crease: s.crease ? b64(s.crease) : undefined,
  };
}

/** Read one back; null if it's damaged. */
export function snapshotFromFile(raw: any): Snapshot | null {
  try {
    return {
      id: String(raw.id),
      name: String(raw.name),
      created: Number(raw.created),
      thumbnail: raw.thumbnail ?? '',
      settings: raw.settings,
      pieces: raw.pieces ?? [],
      outline: raw.outline ?? [],
      plates: raw.plates ?? null,
      info: raw.info ?? null,
      shapes: raw.shapes,
      fileLabel: raw.fileLabel,
      look: raw.look,
      pvdColor: raw.pvdColor,
      finishOpts: raw.finishOpts,
      beetleFace: raw.beetleFace,
      beetleEdge: raw.beetleEdge,
      mesh: {
        vertexCount: raw.mesh.vertexCount,
        topTriangles: raw.mesh.topTriangles,
        indices: new Uint32Array(unb64(raw.mesh.indices)),
        uv: new Float32Array(unb64(raw.mesh.uv)),
        weld: new Uint8Array(unb64(raw.mesh.weld)),
      },
      positions: new Float32Array(unb64(raw.positions)),
      crease: raw.crease ? new Float32Array(unb64(raw.crease)) : undefined,
      render: null,
    };
  } catch {
    return null;
  }
}
