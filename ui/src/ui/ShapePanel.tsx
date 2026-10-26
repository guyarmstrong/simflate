// Right panel in Shape mode: the shapes on the board, weld check, and "Inflate".

import { useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Circle, Copy, Diamond, Egg, Ellipse, Hexagon, Layers, PenTool, RectangleHorizontal, Slash, Spline, Star, Trash2, Triangle } from 'lucide-react';
import { PillIcon, TextIcon } from './icons';
import { useApp } from '../state/store';
import { boxHeight, boxWidth, fmt, multiply, translate } from '../model/geometry';
import { localContours, newId, roleOf, shapeBox, withRole, worldContours, ROLE_NAMES, type LineRole, type Shape, type ShapeKind } from '../model/shapes';
import { currentChoices, remember, sourcesOf } from '../io/lineTypes';
import { LineTypesDialog, applyChoices } from './LineTypesDialog';
import type { PieceReport } from '../model/pieces';

const ICONS: Record<ShapeKind, (p: { size?: number; strokeWidth?: number }) => React.ReactNode> = {
  rect: RectangleHorizontal,
  circle: Circle,
  ellipse: Ellipse,
  polygon: Hexagon,
  triangle: Triangle,
  scalene: Triangle,
  diamond: Diamond,
  pill: PillIcon,
  body: Egg,
  star: Star,
  text: TextIcon,
  path: Spline,
  pen: PenTool,
  line: Slash,
};

/** Size text for the list: a line's length, otherwise width × length. */
function sizeText(s: Shape): string {
  if (s.kind === 'line') {
    const [a, b] = worldContours(s)[0].pts;
    return `${fmt(Math.hypot(b[0] - a[0], b[1] - a[1]))} long`;
  }
  const b = shapeBox(s);
  return `${fmt(boxWidth(b))} × ${fmt(boxHeight(b))}`;
}

export function ShapePanel({ report, onInflate }: { report: PieceReport; onInflate: () => void }) {
  const shapes = useApp((s) => s.shapes);
  const selected = useApp((s) => s.selected);
  const { select, commit, deleteSelected } = useApp.getState();
  const ok = report.pieces.length > 0 && report.problems.length === 0;
  const sel = shapes.filter((s) => selected.includes(s.id));
  const roles = new Set(sel.map(roleOf));
  const hasClosed = sel.some((s) => localContours(s).some((c) => c.closed));
  // Outline only makes sense for closed loops; open lines stay weld lines.
  const setRole = (role: LineRole) =>
    commit(shapes.map((s) => (!selected.includes(s.id) ? s : role === 'outline' && !localContours(s).some((c) => c.closed) ? s : withRole(s, role))));
  // The imported group (with file layers) the selection belongs to.
  const groupId = sel.find((s) => s.src && s.group)?.group;
  const groupShapes = groupId ? shapes.filter((s) => s.group === groupId) : [];
  const [lineTypes, setLineTypes] = useState(false);
  const sameLayer = () => {
    const keys = new Set(sel.map((s) => s.src).filter(Boolean));
    select(shapes.filter((s) => s.src && keys.has(s.src) && (!groupId || s.group === groupId)).map((s) => s.id));
  };

  const duplicate = () => {
    const sel = shapes.filter((s) => selected.includes(s.id));
    const copies = sel.map((s) => ({ ...s, id: newId(), name: `${s.name} copy`, matrix: multiply(translate(20, -20), s.matrix) }));
    commit([...shapes, ...copies]);
    select(copies.map((c) => c.id));
  };

  return (
    <aside className="panel">
      <section>
        <header className="panel-head">
          <h2>Shapes</h2>
          <div className="panel-actions">
            <button className="icon-btn" disabled={!selected.length} onClick={duplicate} title="Duplicate (Ctrl+D)">
              <Copy size={14} />
            </button>
            <button className="icon-btn" disabled={!selected.length} onClick={deleteSelected} title="Delete (Del)">
              <Trash2 size={14} />
            </button>
          </div>
        </header>
        {sel.length > 0 && (
          <div className="seg role-seg" role="group" aria-label="Line type">
            {(['outline', 'weld', 'construction'] as LineRole[]).map((r) => (
              <button
                key={r}
                className={roles.size === 1 && roles.has(r) ? 'on' : ''}
                disabled={r === 'outline' && !hasClosed}
                onClick={() => setRole(r)}
                title={
                  r === 'outline'
                    ? 'Outline: the edge of the piece, welded all round. Inside another outline it becomes a welded cut-out.'
                    : r === 'weld'
                      ? 'Weld line: welded seam inside the piece that quilts it. A closed loop is welded round, not cut out.'
                      : 'Construction: switched off — kept as a dashed reference, ignored when inflating'
                }
                data-testid={`role-${r}`}
              >
                {ROLE_NAMES[r]}
              </button>
            ))}
          </div>
        )}
        {groupShapes.length > 0 && (
          <div className="role-tools">
            <button className="btn ghost small" onClick={() => setLineTypes(true)} title="Set the line type for each layer / colour of this import" data-testid="open-line-types">
              <Layers size={13} /> Line types…
            </button>
            <button className="btn ghost small" onClick={sameLayer} title="Select every line on the same layer / colour as the selection">
              Same layer
            </button>
          </div>
        )}
        {lineTypes && groupShapes.length > 0 && (
          <LineTypesDialog
            title="Line types"
            okLabel="Apply"
            shapes={groupShapes}
            sources={sourcesOf(groupShapes)}
            initial={currentChoices(groupShapes)}
            onCancel={() => setLineTypes(false)}
            onApply={(choices) => {
              remember(choices);
              setLineTypes(false);
              const done = applyChoices(groupShapes, choices);
              const keep = new Set(done.map((s) => s.id));
              const byId = new Map(done.map((s) => [s.id, s]));
              commit(shapes.filter((s) => s.group !== groupId || keep.has(s.id)).map((s) => byId.get(s.id) ?? s));
              select(done.map((s) => s.id));
            }}
          />
        )}
        {shapes.length === 0 ? (
          <p className="muted">Nothing drawn yet.</p>
        ) : (
          <ul className="shape-list">
            {[...shapes].reverse().map((s) => {
              const Icon = ICONS[s.kind];
              const bad = report.problems.some((p) => p.shapeId === s.id);
              return (
                <li
                  key={s.id}
                  className={`${selected.includes(s.id) ? 'on' : ''}${bad ? ' bad' : ''}${roleOf(s) === 'construction' ? ' construction' : ''}`}
                  onClick={(e) => select(e.shiftKey ? [...new Set([...selected, s.id])] : [s.id])}
                >
                  <Icon size={14} strokeWidth={1.6} />
                  <span className="name">{s.name}</span>
                  <span className="size">{roleOf(s) === 'construction' ? 'construction' : roleOf(s) === 'weld' && s.kind !== 'line' ? `weld · ${sizeText(s)}` : sizeText(s)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <header className="panel-head">
          <h2>Weld check</h2>
        </header>
        {report.pieces.length === 0 && !report.problems.length && <p className="muted">Draw or import a closed outline.</p>}
        {report.pieces.length > 0 && (
          <p className="check ok">
            <Check size={14} />
            {report.pieces.length === 1 ? 'One sealed piece' : `${report.pieces.length} sealed pieces`}
            {report.pieces.reduce((n, p) => n + p.holes.length, 0) > 0 && ` · ${report.pieces.reduce((n, p) => n + p.holes.length, 0)} welded cut-out(s)`}
            {report.pieces.reduce((n, p) => n + p.seams.length, 0) > 0 && ` · ${report.pieces.reduce((n, p) => n + p.seams.length, 0)} weld line(s)`}
          </p>
        )}
        {report.problems.map((p, i) => (
          <p key={i} className="check bad" onClick={() => select([p.shapeId])}>
            <AlertTriangle size={14} />
            {p.message}
          </p>
        ))}
        <p className="muted small">
          Every line is welded unless it's Construction. Outlines inside an outline become welded cut-outs; weld lines (open or closed) inside an outline quilt
          it. Double-click an imported line to pick it out, Shift+double-click or drag a box for more, Delete to remove.
        </p>
      </section>

      <div className="panel-foot">
        <button className="btn primary big" disabled={!ok} onClick={onInflate} data-testid="go-inflate">
          Inflate <ArrowRight size={16} />
        </button>
      </div>
    </aside>
  );
}
