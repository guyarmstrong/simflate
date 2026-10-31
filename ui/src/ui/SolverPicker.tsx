// Top of the Inflate panel: the solver list (it decides the whole panel) and
// an info bubble saying what each solver is and who made it.

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Info, RotateCcw } from 'lucide-react';
import { SOLVERS, usesReference, type SolverId } from '../model/presets';
import { isDesktop } from '../io/files';

/** Reference and Symmetric run OpenCourant: in every Windows installer; on a
 *  Mac only with our Mac build packed in and on its chip, so the app is asked. */
const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent);
let macCheck: Promise<boolean> | undefined;
function referenceOnMac(): Promise<boolean> {
  macCheck ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke('reference_check'))
    .then(() => true, () => false);
  return macCheck;
}

/** Can Reference run here? null while a Mac is still being asked. */
function useReferenceHere(): boolean | null {
  const [here, setHere] = useState<boolean | null>(isDesktop && isMac ? null : isDesktop);
  useEffect(() => {
    if (isDesktop && isMac) void referenceOnMac().then(setHere);
  }, []);
  return here;
}

interface About {
  title: string;
  lines: string[];
  links: { label: string; url: string }[];
}

const ABOUT: Record<SolverId, About> = {
  fast: {
    title: 'Fast — Simflate’s own live solver',
    lines: [
      'Built for this app. Position-based dynamics (XPBD), the method used for cloth in games and film: quick and steady on any shape, so you can watch it inflate and change settings live.',
      'The sheet is steel-like rather than real steel, so folds are approximate.',
    ],
    links: [],
  },
  steel: {
    title: 'Steel — Simflate’s experimental solver',
    lines: [
      'Built for this app. Solves for the resting shape with real steel stiffness (Newton’s method), so the sheet can’t squash.',
      'Experimental: slower, and it finds smooth pillows more readily than folds.',
    ],
    links: [],
  },
  reference: {
    title: 'Reference — OpenCourant, on KIT’s method',
    lines: [
      'OpenCourant is an open-source engineering solver: the community continuation of OpenRadioss (originally Altair Radioss, later Siemens), licensed under the GNU AGPL. It is used for crash and metal-forming simulation.',
      'It steps through time with the real stiffness of the steel, so buckles, tucks and folds come out by themselves.',
      'The model follows the Karlsruhe Institute of Technology (KIT) “Die-Less Hydroforming” research by Metzger and Ummenhofer, the published simulation of this exact process, checked against real welded samples: two 304 stainless sheets joined at the weld, real thickness, measured hardening, self-contact, water pumped in.',
      'Runs on this computer (installed with Simflate, Windows); 10 min or more per piece.',
    ],
    links: [
      { label: 'OpenCourant on GitHub', url: 'https://github.com/OpenCourant/OpenCourant' },
      { label: 'KIT research (Metzger, 2026)', url: 'https://doi.org/10.5445/IR/1000189900' },
    ],
  },
  symmetric: {
    title: 'Symmetric — Reference on one slice',
    lines: [
      'For shapes that are the same on both sides of a mirror line: triangles, squares, stars, leaves, hearts. Simflate finds the mirror lines, meshes one slice (a sixth of a triangle, an eighth of a square, half a heart) and copies it round, so the mesh itself is symmetric.',
      'OpenCourant then solves that slice alone, with the cut edges held as mirrors, and the slice is copied back into the whole piece. Every corner and every edge comes out the same, and it runs several times faster than Reference.',
      'Same engine and method as Reference (KIT’s die-less hydroforming). Needs one outline without cut-outs or weld lines, symmetric to within 0.5 % of its size.',
    ],
    links: [{ label: 'OpenCourant on GitHub', url: 'https://github.com/OpenCourant/OpenCourant' }],
  },
  geometric: {
    title: 'Specified geometric — built, not simulated',
    lines: [
      'Built for this app. Instead of working out what the steel does, Simflate builds the form you describe: a dome rising from the welds, edges drawn in between the corners to feed it, and evenly spaced tucks along every edge.',
      'Balloon ↔ Geometric runs from a smooth pillow to sharp ridges running in from the corners. Tucks per side, Tuck width, Tuck length and Valley depth set the folds. Same settings, same piece, every time — and it appears at once.',
      'Use it to design a look quickly; use Symmetric or Reference to check what the metal will really do.',
    ],
    links: [],
  },
};

async function openLink(url: string) {
  if (isDesktop) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_url', { url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

export function SolverPicker({ value, onChange, onReset }: { value: SolverId; onChange: (v: SolverId) => void; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const about = ABOUT[value];
  const referenceHere = useReferenceHere();
  const macWithout = isMac && referenceHere === false;

  // A form or project saved on Windows may bring Reference to a Mac without it: fall back to Fast.
  useEffect(() => {
    if (macWithout && usesReference(value)) onChange('fast');
  }, [macWithout, value, onChange]);

  // Close on a click elsewhere or Escape.

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="solver-picker" ref={box}>
      <header className="panel-head">
        <h2>Solver</h2>
        <span className="solver-head-btns">
          {onReset && (
            <button className="reset-btn" onClick={onReset} title="Put every setting back to its starting value (keeps the solver and mesh). Undo in the message." data-testid="reset-settings">
              <RotateCcw size={12} />
              Reset
            </button>
          )}
          <button className={`info-btn${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title={`${SOLVERS.find((o) => o.id === value)?.note ?? ''} — click for more`} aria-expanded={open} data-testid="solver-info">
            <Info size={14} />
          </button>
        </span>
      </header>
      <select className="solver-select" value={value} onChange={(e) => onChange(e.target.value as SolverId)} data-testid="solver">
        {SOLVERS.map((o) => (
          <option key={o.id} value={o.id} disabled={!o.ready || (usesReference(o.id) && !referenceHere)}>
            {o.name}
            {usesReference(o.id) && macWithout ? ' (not on this Mac yet)' : ''}
          </option>
        ))}
      </select>
      {open && (
        <div className="bubble" role="dialog" data-testid="solver-about">
          <h3>{about.title}</h3>
          <p className="bubble-note">{SOLVERS.find((o) => o.id === value)?.note}</p>
          {about.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {about.links.length > 0 && (
            <div className="bubble-links">
              {about.links.map((l) => (
                <button key={l.url} className="link-btn" onClick={() => void openLink(l.url)} title={l.url}>
                  <ExternalLink size={12} /> {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
