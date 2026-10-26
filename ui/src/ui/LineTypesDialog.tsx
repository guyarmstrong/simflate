// Line types: after importing a DXF / SVG whose lines sit on different layers
// or colours, say what each one is — outline, weld line, construction — or
// leave it out. Reopened from the Shapes panel for any imported group.

import { useMemo, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import { boxOf, fmt, type Vec2 } from '../model/geometry';
import { buildPieces } from '../model/pieces';
import { pathData, roleOf, withRole, worldContours, type Shape } from '../model/shapes';
import { type LineSource, type SourceChoice } from '../io/lineTypes';

const CHOICES: { id: SourceChoice; label: string; title: string }[] = [
  { id: 'outline', label: 'Outline', title: 'The edge of the piece: the two sheets are welded all round it. A loop inside another outline becomes a welded cut-out.' },
  { id: 'weld', label: 'Weld line', title: 'A weld inside the piece that quilts it (open lines or closed loops — a loop is welded round, not cut out).' },
  { id: 'construction', label: 'Construction', title: 'Switched off: kept on the board as a dashed reference, ignored when inflating.' },
  { id: 'leave', label: 'Leave out', title: 'Not brought onto the board at all (dimensions, text, frames…).' },
];

/** Shapes with the choices applied (left-out sources dropped). */
export function applyChoices(shapes: Shape[], choices: Record<string, SourceChoice>): Shape[] {
  return shapes.flatMap((s) => {
    const c = s.src ? choices[s.src] : undefined;
    if (!c) return [s];
    return c === 'leave' ? [] : [withRole(s, c)];
  });
}

interface Props {
  title: string;
  okLabel: string;
  shapes: Shape[];
  sources: LineSource[];
  initial: Record<string, SourceChoice>;
  onApply: (choices: Record<string, SourceChoice>) => void;
  onCancel: () => void;
}

const W = 340;
const H = 300;

export function LineTypesDialog({ title, okLabel, shapes, sources, initial, onApply, onCancel }: Props) {
  const [choices, setChoices] = useState(initial);
  const [hover, setHover] = useState<string | null>(null);

  const result = useMemo(() => applyChoices(shapes, choices), [shapes, choices]);
  const report = useMemo(() => buildPieces(result), [result]);
  const seams = report.pieces.reduce((n, p) => n + p.seams.length, 0);
  const holes = report.pieces.reduce((n, p) => n + p.holes.length, 0);

  // Fit the whole import into the preview (Y up, like the board).
  const toScreen = useMemo(() => {
    const b = boxOf(shapes.flatMap((s) => worldContours(s).flatMap((c) => c.pts)));
    const k = Math.min((W - 24) / Math.max(b.maxX - b.minX, 1e-6), (H - 24) / Math.max(b.maxY - b.minY, 1e-6));
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return (p: Vec2): Vec2 => [W / 2 + (p[0] - cx) * k, H / 2 - (p[1] - cy) * k];
  }, [shapes]);

  const lineClass = (s: Shape) => {
    const c = s.src ? choices[s.src] : roleOf(s);
    const role = c === 'leave' ? 'left-out' : c === 'weld' ? 'weldline' : c === 'construction' ? 'construction' : '';
    return `shape ${role}${hover && s.src === hover ? ' selected' : ''}`;
  };

  const meta = (s: LineSource) =>
    [s.loops && `${s.loops} loop${s.loops > 1 ? 's' : ''}`, s.lines && `${s.lines} line${s.lines > 1 ? 's' : ''}`, `${fmt(s.length)} mm`].filter(Boolean).join(' · ');

  return (
    <div className="dialog-backdrop dim" onPointerDown={onCancel}>
      <div className="dialog line-types" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onCancel()} data-testid="line-types">
        <h3>{title}</h3>
        <p className="muted small">
          This drawing has {sources.length} kinds of line (by layer or colour). Say what each one is. The colours are only shown here so you can tell
          them apart — they aren't brought onto the board.
        </p>
        <div className="lt-body">
          <svg className="lt-preview" width={W} height={H}>
            {shapes.map((s) => (
              <path key={s.id} className={lineClass(s)} d={pathData(s, toScreen)} onPointerEnter={() => setHover(s.src ?? null)} onPointerLeave={() => setHover(null)} />
            ))}
          </svg>
          <ul className="lt-list">
            {sources.map((s) => (
              <li key={s.key} className={hover === s.key ? 'hot' : ''} onPointerEnter={() => setHover(s.key)} onPointerLeave={() => setHover(null)}>
                <div className="lt-head">
                  <span className="swatch" style={{ background: s.color }} />
                  <span className="name">{s.label}</span>
                  <span className="size">{meta(s)}</span>
                </div>
                <div className="seg role-seg four">
                  {CHOICES.map((c) => (
                    <button
                      key={c.id}
                      className={choices[s.key] === c.id ? 'on' : ''}
                      title={c.title}
                      onClick={() => setChoices({ ...choices, [s.key]: c.id })}
                      data-testid={`lt-${c.id}`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
        {report.problems.length ? (
          <p className="check bad">
            <AlertTriangle size={14} />
            {report.problems[0].message}
            {report.problems.length > 1 && ` (+${report.problems.length - 1} more)`}
          </p>
        ) : report.pieces.length ? (
          <p className="check ok">
            <Check size={14} />
            {report.pieces.length === 1 ? 'One sealed piece' : `${report.pieces.length} sealed pieces`}
            {holes > 0 && ` · ${holes} welded cut-out(s)`}
            {seams > 0 && ` · ${seams} weld line(s)`}
          </p>
        ) : (
          <p className="check bad">
            <AlertTriangle size={14} />
            No closed outline yet — mark the layer with the outside edge as Outline.
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => onApply(choices)} data-testid="lt-ok">
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
