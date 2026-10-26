// Render settings (Snapshots → Render): studio, light angle/height,
// background, format and size. Kept in its own small store and remembered
// in this browser, apart from the project file.

import { create } from 'zustand';
import type { StudioId } from './studio';

export type Backdrop = 'studio' | 'black' | 'white' | 'colour' | 'transparent';
export type Aspect = 'view' | '1:1' | '4:5' | '3:2' | '16:9';

export interface RenderSettings {
  /** Render mode on: the Snapshots view shows the studio, backdrop and frame. */
  open: boolean;
  studio: StudioId;
  /** Light angle, degrees (turns the studio round the piece). */
  angle: number;
  /** Light height, −1 (low, grazing) … 1 (overhead). */
  height: number;
  /** Brightness, stops (±). */
  exposure: number;
  backdrop: Backdrop;
  colour: string;
  format: 'png' | 'jpeg';
  size: 1024 | 2048;
  aspect: Aspect;
  /** Light edges: 0 crisp … 0.5 as designed … 1 very soft. */
  softness: number;
  /** Your imported HDRIs, once loaded (the files live in IndexedDB, not here). */
  hdris: ImportedHdri[];
}

export interface ImportedHdri {
  id: string;
  name: string;
  url: string;
}

const KEY = 'blownsim.render';
const DEFAULTS: RenderSettings = {
  open: false,
  studio: 'noir',
  angle: 0,
  height: 0,
  exposure: 0,
  backdrop: 'studio',
  colour: '#1b1d22',
  format: 'png',
  size: 2048,
  aspect: 'view',
  softness: 0.5,
  hdris: [],
};

function load(): RenderSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), open: false, hdris: [] };
  } catch {
    /* private window or blocked storage: defaults */
  }
  return DEFAULTS;
}

interface RenderStore extends RenderSettings {
  set: (patch: Partial<RenderSettings>) => void;
}

export const useRender = create<RenderStore>((set) => ({
  ...load(),
  set: (patch) =>
    set((s) => {
      const next = { ...s, ...patch };
      // JPEG has no see-through background.
      if (patch.backdrop === 'transparent') next.format = 'png';
      if (patch.format === 'jpeg' && next.backdrop === 'transparent') next.backdrop = 'studio';
      try {
        const { set: _, hdris: _h, ...keep } = next;
        localStorage.setItem(KEY, JSON.stringify(keep));
      } catch {
        /* ignore */
      }
      return next;
    }),
}));

export const ASPECTS: { id: Aspect; label: string; ratio: number | null }[] = [
  { id: 'view', label: 'View', ratio: null },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
];

/** Output pixel size: the long edge is 1K or 2K. */
export function outputSize(size: number, ratio: number): [number, number] {
  return ratio >= 1 ? [size, Math.round(size / ratio)] : [Math.round(size * ratio), size];
}

/** Hook for the viewer to register its renderer; the Render button calls it. */
export const renderHook: { render: ((w: number, h: number, mime: string, progress: (done: number, total: number) => void, cancelled: () => boolean) => Promise<Blob | null>) | null; viewAspect: () => number } = {
  render: null,
  viewAspect: () => 1,
};
