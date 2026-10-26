// App state: the drawing (with undo), the active tool, and inflation settings.

import { upgradeSettings } from '../model/presets';
import { DEFAULT_FINISH_OPTS, migrateFinish, type FinishOpts } from '../viewer/materials';
import { create } from 'zustand';
import { checkShapes, type Shape } from '../model/shapes';
import type { Look } from '../viewer/materials';
import { DEFAULT_SETTINGS, PRESET_KEYS, type InflateSettings } from '../model/presets';

export type Tool = 'select' | 'rect' | 'circle' | 'ellipse' | 'polygon' | 'triangle' | 'diamond' | 'pill' | 'body' | 'star' | 'text' | 'weld' | 'pen' | 'builder';
/** Triangle tool: equal sides, or any three sides / angles. */
export type TriangleMode = 'equal' | 'unequal';
/** Pen tool: click points (Illustrator pen), or draw freehand. */
export type PenMode = 'points' | 'freehand';
export interface ToastAction {
  label: string;
  run: () => void;
}

export type Mode = 'shape' | 'inflate' | 'snapshots';
/** Where the piece is placed for the view and renders (exports keep the
 *  solver's frame), session 17: spun in its own plane, then tilted up from
 *  lying on its back (0°) to upright facing you (90°); always on its lowest
 *  point, `floor` showing the ground and a contact shadow or not. */
export interface PiecePosition {
  tilt: number;
  spin: number;
  floor: boolean;
  /** Shadow softness 0 (crisp) … 1 (very soft), its own setting (session 17). */
  softness: number;
}
export type PositionPreset = 'flat' | 'wall' | 'standing';
/** The presets set where the piece is; the shadow's softness stays yours. */
export const POSITION_PRESETS: Record<PositionPreset, Omit<PiecePosition, 'softness'>> = {
  flat: { tilt: 0, spin: 0, floor: true },
  wall: { tilt: 90, spin: 0, floor: false },
  standing: { tilt: 90, spin: 0, floor: true },
};
const POSITION_KEY = 'blownsim.position';
const savedPosition = (): PiecePosition => {
  try {
    const p = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
    if (p && typeof p.tilt === 'number' && typeof p.spin === 'number') return { tilt: p.tilt, spin: p.spin, floor: !!p.floor, softness: typeof p.softness === 'number' ? p.softness : 0.5 };
    // The three-way Display switch before it (same day).
    const d = localStorage.getItem('blownsim.display');
    if (d === 'wall' || d === 'standing') return { ...POSITION_PRESETS[d], softness: 0.5 };
  } catch {
    // A convenience only.
  }
  return { ...POSITION_PRESETS.flat, softness: 0.5 };
};

/** The open project file. `path` is null until it has been saved. */
export interface ProjectInfo {
  path: string | null;
  name: string;
  rev: string;
  /** Changed since the last save. */
  dirty: boolean;
}

interface State {
  mode: Mode;
  tool: Tool;
  shapes: Shape[];
  selected: string[];
  polygonSides: number;
  triangleMode: TriangleMode;
  penMode: PenMode;
  lockProportions: boolean;
  past: Shape[][];
  future: Shape[][];
  settings: InflateSettings;
  presetId: string | null;
  look: Look;
  pvdColor: string;
  /** Brushed grain and heat-tint pattern settings. */
  finishOpts: FinishOpts;
  beetleFace: string;
  beetleEdge: string;
  showPlates: boolean;
  /** Show the smooth render mesh (finisher) instead of the raw solve mesh. */
  smooth: boolean;
  /** Show the TIG welds round the outline and holes (heat tint on bare
   *  stainless; a bare polished seam on coloured finishes). */
  showWelds: boolean;
  position: PiecePosition;
  /** Bumped by the position presets: the view re-frames on the piece. */
  positionFrame: number;
  /** Bumped to ask the 2D view to fit everything on screen. */
  fitRequest: number;
  toast: string | null;
  /** Buttons on the toast (e.g. "Use 195 × 293 mm" after a paste). */
  toastActions: ToastAction[];
  project: ProjectInfo;

  setMode: (m: Mode) => void;
  setTool: (t: Tool) => void;
  setPolygonSides: (n: number) => void;
  setTriangleMode: (m: TriangleMode) => void;
  setPenMode: (m: PenMode) => void;
  setLock: (b: boolean) => void;
  select: (ids: string[]) => void;
  /** Replace shapes and record an undo step. */
  commit: (shapes: Shape[]) => void;
  /** Replace shapes without an undo step (during a drag); call `checkpoint` first. */
  preview: (shapes: Shape[]) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  deleteSelected: () => void;
  updateSettings: (patch: Partial<InflateSettings>, presetId?: string | null) => void;
  setLook: (l: Look) => void;
  setPvdColor: (c: string) => void;
  setFinishOpts: (patch: Partial<FinishOpts>) => void;
  setBeetle: (face: string, edge: string) => void;
  setShowPlates: (b: boolean) => void;
  setSmooth: (b: boolean) => void;
  setShowWelds: (b: boolean) => void;
  setPosition: (patch: Partial<PiecePosition>, reframe?: boolean) => void;
  requestFit: () => void;
  showToast: (msg: string | null, actions?: ToastAction | ToastAction[]) => void;
  setProject: (patch: Partial<ProjectInfo>) => void;
}

const HISTORY_LIMIT = 100;

export const useApp = create<State>((set, get) => ({
  mode: 'shape',
  tool: 'select',
  shapes: [],
  selected: [],
  polygonSides: 6,
  triangleMode: 'equal',
  penMode: 'points',
  lockProportions: true,
  past: [],
  future: [],
  settings: DEFAULT_SETTINGS,
  presetId: null,
  look: 'polished',
  pvdColor: '#e7c27a',
  finishOpts: DEFAULT_FINISH_OPTS,
  beetleFace: '#2fd27a',
  beetleEdge: '#2350e0',
  showPlates: true,
  smooth: true,
  showWelds: false,
  position: savedPosition(),
  positionFrame: 0,
  fitRequest: 0,
  toast: null,
  toastActions: [],
  project: { path: null, name: 'Untitled', rev: 'A', dirty: false },

  setMode: (mode) => set({ mode }),
  setTool: (tool) => set({ tool }),
  setPolygonSides: (n) => set({ polygonSides: Math.max(3, Math.min(64, Math.round(n) || 3)) }),
  setTriangleMode: (triangleMode) => set({ triangleMode }),
  setPenMode: (penMode) => set({ penMode }),
  setLock: (lockProportions) => set({ lockProportions }),
  select: (selected) => set({ selected }),
  commit: (shapes) =>
    set((s) => ({ shapes, past: [...s.past, s.shapes].slice(-HISTORY_LIMIT), future: [] })),
  preview: (shapes) => set({ shapes }),
  checkpoint: () => set((s) => ({ past: [...s.past, s.shapes].slice(-HISTORY_LIMIT), future: [] })),
  undo: () => {
    const { past, shapes, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ shapes: prev, past: past.slice(0, -1), future: [shapes, ...future], selected: get().selected.filter((id) => prev.some((p) => p.id === id)) });
  },
  redo: () => {
    const { past, shapes, future } = get();
    if (!future.length) return;
    set({ shapes: future[0], past: [...past, shapes], future: future.slice(1) });
  },
  deleteSelected: () => {
    const { shapes, selected } = get();
    if (!selected.length) return;
    get().commit(shapes.filter((s) => !selected.includes(s.id)));
    set({ selected: [] });
  },
  // An explicit presetId (or null) sets it; otherwise the preset stays unless
  // the patch changes a setting the preset controls, which makes it Custom.
  updateSettings: (patch, presetId) =>
    set((s) => ({
      settings: { ...s.settings, ...patch },
      presetId:
        presetId !== undefined ? presetId : PRESET_KEYS.some((k) => k in patch && patch[k] !== s.settings[k]) ? null : s.presetId,
    })),
  setLook: (look) =>
    set((s) => {
      const m = migrateFinish(look, s.finishOpts);
      return { look: m.look, finishOpts: m.opts };
    }),
  setPvdColor: (pvdColor) => set({ pvdColor }),
  setFinishOpts: (patch) => set((s) => ({ finishOpts: { ...s.finishOpts, ...patch } })),
  setBeetle: (beetleFace, beetleEdge) => set({ beetleFace, beetleEdge }),
  setShowPlates: (showPlates) => set({ showPlates }),
  setSmooth: (smooth) => set({ smooth }),
  setShowWelds: (showWelds) => set({ showWelds }),
  setPosition: (patch, reframe) =>
    set((s) => {
      const position = { ...s.position, ...patch };
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(position));
      } catch {
        // A convenience only.
      }
      return { position, positionFrame: s.positionFrame + (reframe ? 1 : 0) };
    }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  showToast: (toast, actions) => set({ toast, toastActions: actions ? [actions].flat() : [] }),
  setProject: (patch) => set((s) => ({ project: { ...s.project, ...patch } })),
}));

// ── Autosave: the drawing and settings come back when the app reopens. ──────
export const AUTOSAVE_KEY = 'blownsim.autosave.v1';

try {
  const raw = localStorage.getItem(AUTOSAVE_KEY);
  if (raw) {
    const saved = JSON.parse(raw);
    if (Array.isArray(saved.shapes)) {
      useApp.setState({
        shapes: checkShapes(saved.shapes).shapes,
        settings: upgradeSettings(saved.settings),
        presetId: saved.presetId ?? null,
        lockProportions: saved.lockProportions ?? true,
        polygonSides: saved.polygonSides ?? 6,
        look: migrateFinish(saved.look, saved.finishOpts).look,
        pvdColor: saved.pvdColor ?? '#e7c27a',
        finishOpts: migrateFinish(saved.look, saved.finishOpts).opts,
        beetleFace: saved.beetleFace ?? '#2fd27a',
        beetleEdge: saved.beetleEdge ?? '#2350e0',
        smooth: saved.smooth ?? true,
        showWelds: saved.showWelds ?? false,
        project: { path: null, name: 'Untitled', rev: 'A', dirty: false, ...(saved.project ?? {}) },
      });
    }
  }
} catch {
  // Storage unavailable or corrupt — start fresh.
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** Said once per session: autosave couldn't keep up (storage full). */
let autosaveWarned = false;
useApp.subscribe((s, prev) => {
  const keys = ['shapes', 'settings', 'lockProportions', 'polygonSides', 'look', 'pvdColor', 'finishOpts', 'beetleFace', 'beetleEdge', 'smooth', 'showWelds', 'presetId'] as const;
  const changed = !keys.every((k) => s[k] === prev[k]);
  if (!changed && s.project === prev.project) return;
  // Anything that goes into the project file marks it unsaved — unless this
  // very change is a save or an open (which sets the project info itself).
  if (changed && s.project === prev.project && !s.project.dirty) {
    useApp.setState({ project: { ...s.project, dirty: true } });
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        AUTOSAVE_KEY,
        JSON.stringify({
          shapes: s.shapes,
          settings: s.settings,
          presetId: s.presetId,
          lockProportions: s.lockProportions,
          polygonSides: s.polygonSides,
          look: s.look,
          pvdColor: s.pvdColor,
          finishOpts: s.finishOpts,
          beetleFace: s.beetleFace,
          beetleEdge: s.beetleEdge,
          smooth: s.smooth,
          showWelds: s.showWelds,
          project: s.project,
        }),
      );
    } catch {
      // Usually storage full (a very big drawing): autosave has stopped
      // keeping up, so say so once — the project file is the safe copy.
      if (!autosaveWarned) {
        autosaveWarned = true;
        useApp.getState().showToast('This drawing is too big for autosave — use File → Save to keep your work safe.');
      }
    }
  }, 400);
});
