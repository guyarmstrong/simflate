// Inflation settings as shown in the UI, plus the presets from the spec.

export type InflateBy = 'pressure' | 'height';
/** 'xfine': Specified geometric only (small tucks); other solvers run it as 'final'. */
export type Quality = 'draft' | 'medium' | 'final' | 'xfine';
export type MaterialMode = 'metal' | 'soap';
export type RoundModeId = 'auto' | 'round' | 'corners';
export type SolverId ='fast' | 'steel' | 'reference' | 'symmetric' | 'geometric';

/** Solvers that run on OpenCourant (desktop app, minutes per run). */
export const usesReference = (id: SolverId) => id === 'reference' || id === 'symmetric';
/** Solvers that inflate between plates (the others hide the plates row, and
 *  the 3D view hides the plates, their eye and Contact). */
export const usesPlates = (id: SolverId) => !usesReference(id) && id !== 'geometric';

/** The solvers to choose from. `ready: false` shows in the list but can't be
 *  picked yet. */
export const SOLVERS: { id: SolverId; name: string; note: string; ready: boolean }[] = [
  { id: 'fast', name: 'Fast', note: 'Live and quick on any shape; folds approximate.', ready: true },
  {
    id: 'steel',
    name: 'Steel (experimental)',
    note: 'Real steel stiffness; slower.',
    ready: true,
  },
  {
    id: 'reference',
    name: 'Reference (accurate, slow)',
    note: 'Engineering-grade. Desktop app only. 10 min+.',
    ready: true,
  },
  {
    id: 'symmetric',
    name: 'Symmetric (accurate)',
    note: 'Reference on one slice of a symmetric shape: every corner and edge the same, several times faster. Desktop app only.',
    ready: true,
  },
  {
    id: 'geometric',
    name: 'Specified geometric',
    note: 'Not a simulation: the form is built from your settings (dome, tucks per edge, ridges). Instant and predictable.',
    ready: true,
  },
];

export interface InflateSettings {
  inflateBy: InflateBy;
  pressure: number; // 0–100
  heightMm: number;
  /** Sheet thickness (mm), both sheets. */
  thicknessMm: number;
  /** Show the thickness on the smooth mesh: the sheets' cut edge at the seam
   *  (tips, corners). Off: thin sheets meeting at a knife edge. Look only. */
  showThickness: boolean;
  character: number; // 0 Balloon … 1 Geometric (works as temper)
  platesOn: boolean;
  plateThicknessMm: number;
  plateOffsetMm: number;
  quality: Quality;
  material: MaterialMode;
  weldFilletMm: number;
  seed: number;
  creaseRandomness: number;
  plateFriction: number;
  bottomStiffness: number;
  fixOutline: boolean;
  /** Hold the sheet flat against folding while it inflates; the folds may set
   *  only once it is full (a static stand-in for the workshop's temporary clamp). */
  clampWhileInflating: boolean;
  /** 0–1: pleats where the metal is squeezed along welds (render mesh only). */
  edgeRipples: number;
  /** 0–1: crisp ridges on the smooth mesh — the soft valleys the solve finds
   *  are gathered onto sharp lines with flat facets either side. */
  ridgeSharpness: number;
  /** Which solver inflates the piece (see SOLVERS). */
  solver: SolverId;
  /** Older files: the Steel solver switch, before the solver list. */
  steelSolver?: boolean;
  /** Experimental: how strongly the seam resists opening like a book (0 = free). */
  seamStiffness: number;
  /** Symmetric solver: small regular waves seeded along each edge before
   *  pumping, crests per edge between corners (0 = none). */
  wavesPerEdge: number;
  /** Specified geometric: how deep the tucks go, 0–1. */
  waveDepth: number;
  /** Specified geometric: tuck width as a share of their spacing (1 = they run on into one another). */
  tuckWidth: number;
  /** Specified geometric: how far a tuck runs in from the weld, × its width. */
  tuckLength: number;
  /** Specified geometric: 0 all tucks equal … 1 shallow near corners, deep mid-side. */
  cornerFade: number;
  /** Specified geometric: how the count follows side length, −1…1 (count is for a 300 mm side). */
  tuckScaling: number;
  /** Specified geometric: how far the sides bow in (1 = as built). */
  edgePull: number;
  /** Specified geometric: the weld rising between tucks, 0–1. */
  edgeLift: number;
  /** Specified geometric: tuck shape, 0 Balloon (rounded) … 1 Geometric (flat floor, straight walls). */
  tuckShape: number;
  /** Specified geometric: 0 tucks pull the edge in (wavy) … 1 smooth arc. */
  edgeSmooth: number;
  /** Specified geometric: 0 pillow … 1 pill (sheets leave the weld straight up, round onto a crowned top). */
  sideWall: number;
  /** Specified geometric (session 17): tuck width, mm. Missing in older
   *  forms (they use `tuckWidth`) until the panel converts them. */
  tuckWidthMm?: number;
  /** Specified geometric: how far a tuck runs in from the weld, mm. */
  tuckLengthMm?: number;
  /** Specified geometric: valley depth at a tuck's centre, mm. */
  valleyDepthMm?: number;
  /** Specified geometric: 0 regular tucks … 1 spacing, width, length and depth varied (from `seed`). */
  tuckRandomness: number;
  /** Specified geometric: 0 tucks full width all the way in … 1 they narrow to a point. */
  tuckTaper: number;
  /** Specified geometric (session 19): round mode — evenly spread S-folds
   *  round each closed outline. Auto: on for outlines with no corners. */
  roundMode: RoundModeId;
  /** Round mode: how far each fold swings into an S, × its width (0 straight). */
  foldOver: number;
  /** Round mode: tightest bend a fold may make, mm (0 = no limit). */
  minBendMm: number;
  /** Panel only: Tuck width, length and valley depth scale together. */
  tuckLock?: boolean;
  /** Which pressure scale `pressure` is on: 3 = the curved slider (session 4).
   *  Missing in older projects, whose pressures were on a straight scale. */
  pressureCurve?: number;
}

/** Settings from a file, autosave or snapshot, brought up to date: defaults
 *  filled in, and an old straight-scale pressure moved onto the curved slider
 *  so the piece inflates exactly as it did. */
export function upgradeSettings(raw: Partial<InflateSettings> | null | undefined): InflateSettings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
  if (raw && raw.pressureCurve !== 3 && typeof raw.pressure === 'number') {
    s.pressure = Math.round(100 * Math.pow(Math.max(raw.pressure, 0) / 100, 1 / 3));
  }
  s.pressureCurve = 3;
  if (!raw?.solver) s.solver = raw?.steelSolver ? 'steel' : 'fast';
  if (!SOLVERS.some((o) => o.id === s.solver && o.ready)) s.solver = 'fast';
  delete s.steelSolver;
  // Older forms: no bend limit, so their tucks build as before.
  if (raw && raw.minBendMm === undefined) s.minBendMm = 0;
  // Older forms: tucks as shares, converted to mm by the panel (it knows the outline).
  if (raw && raw.tuckWidthMm === undefined) {
    delete s.tuckWidthMm;
    delete s.tuckLengthMm;
    delete s.valleyDepthMm;
  }
  return s;
}

export const DEFAULT_SETTINGS: InflateSettings = {
  inflateBy: 'pressure',
  pressure: 89,
  pressureCurve: 3,
  heightMm: 60,
  thicknessMm: 1,
  character: 0.3,
  platesOn: false,
  plateThicknessMm: 40,
  plateOffsetMm: 0,
  quality: 'medium',
  material: 'metal',
  weldFilletMm: 1.5,
  showThickness: true,
  seed: 1,
  creaseRandomness: 0.5,
  plateFriction: 0.05,
  bottomStiffness: 1,
  fixOutline: false,
  clampWhileInflating: false,
  edgeRipples: 0.5,
  ridgeSharpness: 0,
  solver: 'fast',
  seamStiffness: 0,
  wavesPerEdge: 0,
  waveDepth: 0.5,
  tuckWidth: 0.9,
  tuckLength: 1.2,
  cornerFade: 0.5,
  tuckScaling: 0,
  edgePull: 1,
  edgeLift: 0,
  tuckShape: 0,
  edgeSmooth: 0,
  sideWall: 0,
  tuckWidthMm: 40,
  tuckLengthMm: 50,
  valleyDepthMm: 8,
  tuckRandomness: 0,
  tuckTaper: 0,
  roundMode: 'auto',
  foldOver: 0,
  minBendMm: 4,
};

export interface Preset {
  id: string;
  name: string;
  look: string;
  apply: (s: InflateSettings) => InflateSettings;
}

/** The settings a preset sets. Changing any of these by hand turns the preset
 *  into Custom; everything else (plates, mesh, ripples, outline…) is
 *  independent of the preset. */
export const PRESET_KEYS: (keyof InflateSettings)[] = ['inflateBy', 'pressure', 'character', 'material', 'bottomStiffness'];

const metal = (s: InflateSettings, pressure: number, character: number): InflateSettings => ({
  ...s,
  inflateBy: 'pressure',
  pressure,
  character,
  material: 'metal',
  bottomStiffness: 1,
});

export const PRESETS: Preset[] = [
  { id: 'balloon', name: 'Balloon', look: 'Full, round, few creases', apply: (s) => metal(s, 98, 0) },
  { id: 'pillow', name: 'Pillow', look: 'Soft cushion, gentle edge ripples', apply: (s) => metal(s, 77, 0.5) },
  { id: 'geometric', name: 'Geometric', look: 'Faceted, crumpled, metal clearly resisting', apply: (s) => metal(s, 74, 1) },
  {
    id: 'soap',
    name: 'Soap film',
    look: 'Smooth minimal surface, for comparison',
    apply: (s) => ({ ...s, inflateBy: 'pressure', pressure: 79, material: 'soap', bottomStiffness: 1 }),
  },
];

/** Plate gap that suits a shape when plates are first switched on: 20 % of
 *  its narrowest width (what the old Pill preset used). */
export const autoPlateThicknessMm = (narrowestMm: number) => Math.max(2, Math.round(narrowestMm * 0.2));

/** Settings in the shape the Rust solver expects (SimSettings, camelCase). */
export function toSolverSettings(s: InflateSettings) {
  return {
    pressure: s.pressure,
    targetHeightMm: s.inflateBy === 'height' ? s.heightMm : null,
    thicknessMm: s.thicknessMm,
    character: s.character,
    plates: s.platesOn ? { thicknessMm: s.plateThicknessMm, offsetMm: s.plateOffsetMm } : null,
    quality: s.quality === 'xfine' && s.solver !== 'geometric' ? 'final' : s.quality,
    material: s.material,
    seed: Math.max(0, Math.round(s.seed)),
    creaseRandomness: s.creaseRandomness,
    plateFriction: s.plateFriction,
    bottomStiffness: s.bottomStiffness,
    fixOutline: s.fixOutline,
    // Any hold above the final pressure means: release once settled.
    creaseHold: s.clampWhileInflating && s.material !== 'soap' ? 1000 : 0,
    edgeRipples: s.edgeRipples,
    weldFilletMm: s.weldFilletMm,
    steelSolver: s.solver === 'steel' && s.material !== 'soap',
    seamStiffness: s.material === 'soap' ? 0 : s.seamStiffness,
    symmetric: s.solver === 'symmetric',
    wavesPerEdge: s.solver === 'symmetric' || s.solver === 'geometric' ? Math.max(0, Math.round(s.wavesPerEdge)) : 0,
    geometric: s.solver === 'geometric',
    waveDepth: s.waveDepth,
    tuckWidth: s.tuckWidth,
    tuckLength: s.tuckLength,
    cornerFade: s.cornerFade,
    tuckScaling: s.tuckScaling,
    edgePull: s.edgePull,
    edgeLift: s.edgeLift,
    tuckShape: s.tuckShape ?? 0,
    edgeSmooth: s.edgeSmooth ?? 0,
    sideWall: s.sideWall ?? 0,
    tuckWidthMm: s.tuckWidthMm ?? null,
    tuckLengthMm: s.tuckLengthMm ?? null,
    valleyDepthMm: s.valleyDepthMm ?? null,
    tuckRandomness: s.tuckRandomness ?? 0,
    tuckTaper: s.tuckTaper ?? 0,
    roundMode: s.roundMode ?? 'auto',
    foldOver: s.foldOver ?? 0,
    minBendMm: s.minBendMm ?? 0,
  };
}
