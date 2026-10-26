// Snapshots are kept on this computer in the app's own database (IndexedDB),
// so they survive closing the app. Typed arrays are stored as-is.

import type { InflateSettings } from '../model/presets';
import type { Piece } from '../model/pieces';
import type { Vec2 } from '../model/geometry';
import type { Shape } from '../model/shapes';
import type { FinishOpts } from '../viewer/materials';
import type { FrameInfo, RenderMeshData } from '../sim/simStore';

export interface Snapshot {
  id: string;
  name: string;
  created: number;
  /** Small JPEG of the 3D view when it was taken. */
  thumbnail: string;
  settings: InflateSettings;
  pieces: Piece[];
  outline: Vec2[][];
  plates: { bottom: number; top: number } | null;
  info: FrameInfo | null;
  mesh: { vertexCount: number; indices: Uint32Array; uv: Float32Array; weld: Uint8Array; topTriangles: number };
  positions: Float32Array;
  /** Permanent fold per point (Creases view). Older snapshots lack it. */
  crease?: Float32Array;
  render: RenderMeshData | null;
  /** The board's shapes when it was taken (for Restore shape + settings). Older snapshots lack it. */
  shapes?: Shape[];
  /** Which project it was taken in, e.g. "Leaf Rev B" (shown on Recent cards). */
  fileLabel?: string;
  /** When it joined the Recent list (taken in this app); absent = only in a file. */
  recentAt?: number;
  /** Belongs to the project that is open now (saved inside its file). */
  openFile?: boolean;
  /** Its finish when taken (opening it brings the finish back). Older snapshots lack it. */
  look?: string;
  pvdColor?: string;
  finishOpts?: FinishOpts;
  beetleFace?: string;
  beetleEdge?: string;
}

const DB = 'blownsim';
const STORE = 'snapshots';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => {
      db.close();
      reject(t.error);
    };
  });
}

export const snapshotsDb = {
  all: () => tx<Snapshot[]>('readonly', (s) => s.getAll() as IDBRequest<Snapshot[]>),
  put: (snap: Snapshot) => tx('readwrite', (s) => s.put(snap)),
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)),
};
