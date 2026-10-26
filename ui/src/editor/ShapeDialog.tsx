// Click (without dragging) with a shape tool → type the exact size, like Illustrator.

import { useEffect, useRef, useState } from 'react';
import { useApp, type Tool } from '../state/store';
import type { Vec2 } from '../model/geometry';
import { CORNERS, triFromBase } from '../model/triangle';
import { TriFields } from '../ui/TriFields';
import { Segmented } from '../ui/controls';

export interface DialogResult {
  w?: number;
  h?: number;
  radius?: number;
  sides?: number;
  /** Unequal triangle: its corners. */
  tri?: Vec2[];
}

export type SizeTool = 'rect' | 'circle' | 'ellipse' | 'polygon' | 'triangle' | 'diamond' | 'pill';

export interface SizeDefaults {
  w: number;
  h: number;
  radius: number;
  sides: number;
  pillW: number;
  pillH: number;
  pillR: number;
  side: number;
  base: number;
  left: number;
  right: number;
}

interface Props {
  tool: Extract<Tool, SizeTool>;
  screen: [number, number];
  defaults: SizeDefaults;
  onOk: (r: DialogResult) => void;
  onCancel: () => void;
}

const TITLES: Record<SizeTool, string> = {
  rect: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  polygon: 'Polygon',
  triangle: 'Triangle',
  diamond: 'Diamond',
  pill: 'Pill',
};

export function ShapeDialog({ tool, screen, defaults, onOk, onCancel }: Props) {
  const triMode = useApp((s) => s.triangleMode);
  const setTriMode = useApp((s) => s.setTriangleMode);
  const pillTool = tool === 'pill';
  const [w, setW] = useState(String(pillTool ? defaults.pillW : defaults.w));
  const [h, setH] = useState(String(pillTool ? defaults.pillH : defaults.h));
  const [radius, setRadius] = useState(String(pillTool ? defaults.pillR : defaults.radius));
  const [sides, setSides] = useState(String(defaults.sides));
  const [side, setSide] = useState(String(defaults.side));
  // Unequal triangle: its corners, edited one side / angle at a time. The ref
  // is what OK reads (Enter in a box commits and submits in the same keypress).
  const [tri, setTriState] = useState<Vec2[]>(() => triFromBase(defaults.base, defaults.left, defaults.right) ?? triFromBase(300, 50, 70)!);
  const triRef = useRef(tri);
  const setTri = (c: Vec2[]) => {
    triRef.current = c;
    setTriState(c);
  };
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    first.current?.select();
  }, [triMode]);

  // Unreadable or absurd numbers (Infinity, 1e9) count as not filled in.
  const n = (s: string) => {
    const v = Number(s.replace(',', '.'));
    return Number.isFinite(v) && v <= 100_000 ? v : NaN;
  };

  const submit = () => {
    if (tool === 'rect' || tool === 'ellipse' || tool === 'diamond') {
      if (n(w) > 0 && n(h) > 0) onOk({ w: n(w), h: n(h) });
    } else if (tool === 'pill') {
      if (n(w) > 0 && n(h) > 0 && n(radius) >= 0) onOk({ w: n(w), h: n(h), radius: Math.min(n(radius), n(w) / 2, n(h) / 2) });
    } else if (tool === 'circle') {
      if (n(w) > 0) onOk({ w: n(w), h: n(w) });
    } else if (tool === 'triangle') {
      if (triMode === 'equal') {
        if (n(side) > 0) onOk({ w: n(side), h: (n(side) * Math.sqrt(3)) / 2 });
      } else onOk({ tri: triRef.current });
    } else if (n(radius) > 0 && n(sides) >= 3) {
      // 100 000 corners froze the board; the arrow keys stop at 64 too.
      onOk({ radius: n(radius), sides: Math.min(64, Math.round(n(sides))) });
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, unit = 'mm', isFirst = false) => (
    <label className="field">
      <span>{label}</span>
      <input ref={isFirst ? first : undefined} value={value} onChange={(e) => set(e.target.value)} inputMode="decimal" />
      <em>{unit}</em>
    </label>
  );

  const left0 = Math.min(screen[0] + 12, window.innerWidth - 260);
  const top0 = Math.min(screen[1] + 12, window.innerHeight - 340);

  return (
    <div className="dialog-backdrop" onPointerDown={onCancel}>
      <form
        className="dialog"
        style={{ left: left0, top: top0 }}
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        <h3>{TITLES[tool]}</h3>
        {(tool === 'rect' || tool === 'ellipse' || tool === 'diamond') && (
          <>
            {field('Width', w, setW, 'mm', true)}
            {field('Length', h, setH)}
          </>
        )}
        {tool === 'pill' && (
          <>
            {field('Width', w, setW, 'mm', true)}
            {field('Height', h, setH)}
            {field('Radius', radius, setRadius)}
            <p className="dialog-note">Radius of half the height gives round ends.</p>
          </>
        )}
        {tool === 'circle' && field('Diameter', w, setW, 'mm', true)}
        {tool === 'polygon' && (
          <>
            {field('Radius', radius, setRadius, 'mm', true)}
            {field('Corners', sides, setSides, '')}
          </>
        )}
        {tool === 'triangle' && (
          <>
            <Segmented small value={triMode} onChange={setTriMode} options={[
              { value: 'equal', label: 'Equal sides' },
              { value: 'unequal', label: 'Unequal' },
            ]} />
            {triMode === 'equal' ? (
              field('Side', side, setSide, 'mm', true)
            ) : (
              <>
                <TriPreview tri={tri} />
                <div className="tri-grid">
                  <TriFields corners={tri} onChange={setTri} />
                </div>
                <p className="dialog-note">A new angle swings that corner's second side round; a new length slides the far corner along the side. Change them again any time: select the triangle.</p>
              </>
            )}
          </>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}

function TriPreview({ tri }: { tri: Vec2[] }) {
  const W = 260;
  const H = 120;
  const xs = tri.map((p) => p[0]);
  const ys = tri.map((p) => p[1]);
  const bw = Math.max(...xs) - Math.min(...xs) || 1;
  const bh = Math.max(...ys) - Math.min(...ys) || 1;
  const k = Math.min((W - 44) / bw, (H - 36) / bh);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const scr = tri.map(([x, y]) => [W / 2 + (x - cx) * k, H / 2 - (y - cy) * k]);
  const mid = [(scr[0][0] + scr[1][0] + scr[2][0]) / 3, (scr[0][1] + scr[1][1] + scr[2][1]) / 3];
  return (
    <svg className="dialog-preview" width={W} height={H}>
      <polygon points={scr.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ')} />
      {scr.map(([x, y], i) => {
        const dx = x - mid[0];
        const dy = y - mid[1];
        const l = Math.hypot(dx, dy) || 1;
        return (
          <text key={i} className="tri-letter" x={x + (dx / l) * 11} y={y + (dy / l) * 11 + 4} textAnchor="middle">
            {CORNERS[i]}
          </text>
        );
      })}
    </svg>
  );
}
