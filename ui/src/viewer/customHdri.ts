// Your own HDRIs for rendering (Render → Import HDRI). The files are kept in
// this browser's / app's storage so they're still there next time.

import { dropHdri, setImportedStudios, type HdriKind } from './studio';
import { useRender, type ImportedHdri } from './renderStore';

const DB = 'blownsim-render';
const STORE = 'hdri';

interface Saved {
  name: string;
  kind: HdriKind;
  data: Blob;
  added: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export function kindOf(name: string): HdriKind | null {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'hdr') return 'hdr';
  if (ext === 'exr') return 'exr';
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 'image';
  return null;
}

/** In memory: id → file, kind and address. */
const loaded = new Map<string, { name: string; kind: HdriKind; url: string; added: number }>();

function publish() {
  const list = [...loaded.entries()].sort((a, b) => a[1].added - b[1].added).map(([id, h]) => ({ id, ...h }));
  setImportedStudios(list);
  useRender.setState({ hdris: list.map(({ id, name, url }): ImportedHdri => ({ id, name, url })) });
}

function add(id: string, saved: Saved) {
  loaded.set(id, { name: saved.name, kind: saved.kind, url: URL.createObjectURL(saved.data), added: saved.added });
}

/** Add these files to the studio list; switches to the first. Returns how many were used. */
export async function importHdris(files: File[]): Promise<number> {
  const ok = files.filter((f) => kindOf(f.name));
  if (!ok.length) throw new Error('use .hdr or .exr files (or .jpg/.png panoramas)');
  const ids: string[] = [];
  for (const [i, f] of ok.entries()) {
    const id = `${Date.now().toString(36)}${i}${Math.random().toString(36).slice(2, 6)}`;
    const saved: Saved = { name: f.name, kind: kindOf(f.name)!, data: f, added: Date.now() + i };
    add(id, saved);
    ids.push(id);
    try {
      await tx('readwrite', (s) => s.put(saved, id));
    } catch {
      /* storage blocked: still works until the app closes */
    }
  }
  publish();
  useRender.getState().set({ studio: `hdri:${ids[0]}` });
  return ok.length;
}

export async function removeHdri(id: string) {
  const h = loaded.get(id);
  if (h) {
    dropHdri(h.url);
    URL.revokeObjectURL(h.url);
    loaded.delete(id);
  }
  publish();
  if (useRender.getState().studio === `hdri:${id}`) useRender.getState().set({ studio: 'noir' });
  try {
    await tx('readwrite', (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}

/** Bring back the HDRIs from last time (called once at start). */
export async function restoreHdris() {
  try {
    const keys = (await tx('readonly', (s) => s.getAllKeys())) as string[];
    for (const id of keys) {
      const saved = await tx<Saved | undefined>('readonly', (s) => s.get(id) as IDBRequest<Saved | undefined>);
      if (saved) add(id, { ...saved, added: saved.added ?? 0 });
    }
    publish();
    // Earlier single-HDRI version kept it as "custom".
    if (useRender.getState().studio === 'custom' && loaded.has('custom')) useRender.getState().set({ studio: 'hdri:custom' });
  } catch {
    /* nothing saved, or storage blocked */
  }
}
