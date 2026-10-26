// Left tool palette and the control bar along the top of the drawing board.

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Circle,
  Diamond,
  Download,
  Egg,
  Ellipse,
  Hexagon,
  Star,
  Link,
  Maximize,
  MousePointer2,
  PenTool,
  RectangleHorizontal,
  Slash,
  SquaresUnite,
  Triangle,
  Unlink,
} from 'lucide-react';
import { useApp, type Tool } from '../state/store';
import { boxCenter, boxHeight, boxWidth, scaleAbout } from '../model/geometry';
import { evenScale, pillSize, withMatrix, type Shape } from '../model/shapes';
import { PillIcon, TextIcon } from './icons';
import { TriFields } from './TriFields';
import { triCorners, withCorners } from '../model/triangle';
import { alignSelection, alignUnits, moveSelectionTo, rotateSelectionTo, selectionBox, setSelectionDimension, type Align } from '../model/transform';
import { NumField, Segmented } from './controls';
import { useFitColumn } from './fitColumn';

const ALIGN: { id: Align; icon: typeof Circle; title: string }[] = [
  { id: 'left', icon: AlignStartVertical, title: 'Align left edges' },
  { id: 'centreX', icon: AlignCenterVertical, title: 'Align centres (horizontally)' },
  { id: 'right', icon: AlignEndVertical, title: 'Align right edges' },
  { id: 'top', icon: AlignStartHorizontal, title: 'Align top edges' },
  { id: 'middleY', icon: AlignCenterHorizontal, title: 'Align middles (vertically)' },
  { id: 'bottom', icon: AlignEndHorizontal, title: 'Align bottom edges' },
];

type ToolIcon = (p: { size?: number; strokeWidth?: number }) => React.ReactNode;

// Guy's order: weld line and pen first, then the round shapes, then shapes
// from fewest corners to most (polygon last), then text and the builder.
const TOOLS: { id: Tool; icon: ToolIcon; label: string; title: string; key: string }[] = [
  { id: 'weld', icon: Slash, label: 'Weld line', title: 'Weld line — a laser-welded seam inside a shape, to quilt it. Snaps to corners and edges', key: 'W' },
  { id: 'pen', icon: PenTool, label: 'Pen', title: 'Pen — click for corners, drag for curves, click the first point to close. Or draw freehand', key: 'N' },
  { id: 'circle', icon: Circle, label: 'Circle', title: 'Circle', key: 'C' },
  { id: 'ellipse', icon: Ellipse, label: 'Ellipse', title: 'Ellipse', key: 'L' },
  { id: 'body', icon: Egg, label: 'Egg', title: 'Egg / body — an egg, or egg-shaped parts in a row (peanut, ant)', key: 'G' },
  { id: 'triangle', icon: Triangle, label: 'Triangle', title: 'Triangle — equal sides, or unequal (type any side or angle)', key: 'R' },
  { id: 'diamond', icon: Diamond, label: 'Diamond', title: 'Diamond', key: 'D' },
  { id: 'rect', icon: RectangleHorizontal, label: 'Rectangle', title: 'Rectangle', key: 'M' },
  { id: 'pill', icon: PillIcon, label: 'Pill', title: 'Pill — width, height and corner radius', key: 'O' },
  { id: 'polygon', icon: Hexagon, label: 'Polygon', title: 'Polygon', key: 'P' },
  { id: 'star', icon: Star, label: 'Pebble / star', title: 'Pebble / star — opens a wizard: pebbles, starfish and stars from the same few settings', key: 'S' },
  { id: 'text', icon: TextIcon, label: 'Text', title: 'Text — letters in any font on this computer', key: 'T' },
  { id: 'builder', icon: SquaresUnite, label: 'Builder', title: 'Shape builder — merge overlapping shapes by clicking or dragging across their regions (Alt deletes a region). The result becomes a fixed outline, like an import', key: 'Shift+M' },
];

const SELECT = { id: 'select' as Tool, icon: MousePointer2, label: 'Select', title: 'Select & move', key: 'V' };

/** Capital-letter height of a text shape on the board (mm). */
function capHeight(s: Shape): number {
  return (s.text?.cap ?? 0) * evenScale(s.matrix);
}

export function ToolPalette({ onImport }: { onImport: () => void }) {
  const fitRef = useFitColumn<HTMLElement>();
  const tool = useApp((s) => s.tool);
  const setTool = useApp((s) => s.setTool);
  const requestFit = useApp((s) => s.requestFit);
  const toolButton = ({ id, icon: Icon, label, title, key }: (typeof TOOLS)[number]) => (
    <button key={id} className={`tool${tool === id ? ' on' : ''}`} onClick={() => setTool(id)} title={`${title} (${key})`} data-testid={`tool-${id}`}>
      <Icon size={22} strokeWidth={1.5} />
      <span className="tool-label">{label}</span>
    </button>
  );
  return (
    <nav className="palette" aria-label="Shape tools" ref={fitRef}>
      <button className="tool" onClick={onImport} title="Import a DXF / DWG / SVG outline (Ctrl+I) — or paste one copied in Illustrator or Word (Ctrl+V)">
        <Download size={22} strokeWidth={1.5} />
        <span className="tool-label">Import</span>
      </button>
      <button className="tool" onClick={requestFit} title="Fit to screen (F)">
        <Maximize size={22} strokeWidth={1.5} />
        <span className="tool-label">Fit</span>
      </button>
      {toolButton(SELECT)}
      <h3>Draw</h3>
      <div className="tool-grid">{TOOLS.map(toolButton)}</div>
    </nav>
  );
}

export function ControlBar() {
  const tool = useApp((s) => s.tool);
  const shapes = useApp((s) => s.shapes);
  const selected = useApp((s) => s.selected);
  const sides = useApp((s) => s.polygonSides);
  const lock = useApp((s) => s.lockProportions);
  const triMode = useApp((s) => s.triangleMode);
  const penMode = useApp((s) => s.penMode);
  const { setPolygonSides, setLock, setTriangleMode, setPenMode, commit } = useApp.getState();

  const box = selectionBox(shapes, selected);
  const sel = shapes.filter((s) => selected.includes(s.id));
  const single = sel.length === 1 ? sel[0] : null;

  const lockBtn = (
    <button
      className={`icon-btn${lock ? ' on' : ''}`}
      onClick={() => setLock(!lock)}
      title={lock ? 'Width and length linked — typing one scales the other' : 'Width and length unlinked — each changes on its own'}
      data-testid="lock"
    >
      {lock ? <Link size={17} /> : <Unlink size={17} />}
    </button>
  );

  // The pen and the builder keep their own bar (mode switch, hints) even
  // while the shape they just made is selected.
  if (box && sel.length && tool !== 'pen' && tool !== 'builder') {
    const c = boxCenter(box);
    return (
      <div className="controlbar">
        <span className="cb-title">{single ? single.name : `${sel.length} shapes`}</span>
        <NumField label="X" value={c[0]} onCommit={(v) => commit(moveSelectionTo(shapes, selected, 'x', v))} />
        <NumField label="Y" value={c[1]} onCommit={(v) => commit(moveSelectionTo(shapes, selected, 'y', v))} />
        <span className="cb-sep" />
        {single?.kind === 'circle' ? (
          <NumField label="Ø" title="Diameter" value={boxWidth(box)} min={0.1} onCommit={(v) => commit(setSelectionDimension(shapes, selected, 'x', v, true))} testId="cb-diameter" />
        ) : single?.kind === 'text' ? (
          <NumField
            label="Height"
            title="Height of the capital letters — the text scales evenly"
            value={capHeight(single)}
            min={0.1}
            width={64}
            onCommit={(v) => {
              const k = v / (capHeight(single) || 1);
              commit(shapes.map((s) => (s.id === single.id ? withMatrix(s, scaleAbout(k, k, c)) : s)));
            }}
            testId="cb-cap"
          />
        ) : single?.kind === 'scalene' ? (
          <TriFields corners={triCorners(single)} onChange={(c) => commit(shapes.map((s) => (s.id === single.id ? withCorners(s, c) : s)))} />
        ) : (
          <>
            <NumField label="W" title="Width — left to right, always horizontal" value={boxWidth(box)} min={0.1} onCommit={(v) => commit(setSelectionDimension(shapes, selected, 'x', v, lock))} testId="cb-width" />
            {lockBtn}
            <NumField label="L" title="Length — bottom to top, always vertical" value={boxHeight(box)} min={0.1} onCommit={(v) => commit(setSelectionDimension(shapes, selected, 'y', v, lock))} testId="cb-length" />
          </>
        )}
        {single?.kind === 'pill' && (
          <NumField
            label="R"
            title="Corner radius — half the height gives round ends"
            value={pillSize(single).r}
            min={0}
            onCommit={(v) => {
              const { w, h } = pillSize(single);
              commit(shapes.map((s) => (s.id === single.id ? { ...s, radius: Math.min(v, w / 2, h / 2) } : s)));
            }}
            testId="cb-radius"
          />
        )}
        <span className="cb-sep" />
        <NumField label="∠" unit="°" value={sel[0].rotation} onCommit={(v) => commit(rotateSelectionTo(shapes, selected, v))} width={56} testId="cb-rotation" />
        {alignUnits(shapes, selected).length >= 2 && (
          <>
            <span className="cb-sep" />
            <div className="cb-align" role="group" aria-label="Align">
              {ALIGN.map((a, i) => (
                <button
                  key={a.id}
                  className={`icon-btn${i === 3 ? ' gap' : ''}`}
                  onClick={() => commit(alignSelection(shapes, selected, a.id))}
                  title={a.title}
                  data-testid={`align-${a.id}`}
                >
                  <a.icon size={15} strokeWidth={1.6} />
                </button>
              ))}
            </div>
          </>
        )}
        {single?.kind === 'polygon' && (
          <>
            <span className="cb-sep" />
            <NumField
              label="Corners"
              unit=""
              digits={0}
              min={3}
              max={64}
              width={44}
              value={single.sides}
              onCommit={(v) => {
                setPolygonSides(v);
                commit(shapes.map((s) => (s.id === single.id ? { ...s, sides: Math.round(v) } : s)));
              }}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="controlbar">
      {tool === 'select' && <span className="cb-hint">Click a shape to select it · drag to move · drag the handles to scale or rotate</span>}
      {tool === 'rect' && <span className="cb-hint">Drag to draw (Shift = square, Alt = from centre) · or click once to type a size</span>}
      {tool === 'circle' && <span className="cb-hint">Drag to draw (Alt = from centre) · or click once to type the diameter</span>}
      {tool === 'ellipse' && <span className="cb-hint">Drag to draw (Shift = circle, Alt = from centre) · or click once to type a size</span>}
      {tool === 'polygon' && (
        <>
          <NumField label="Corners" unit="" digits={0} min={3} max={64} width={44} value={sides} onCommit={setPolygonSides} testId="cb-sides" />
          <span className="cb-hint">Drag from the centre (↑ ↓ change corners while dragging) · or click once to type a size</span>
        </>
      )}
      {tool === 'triangle' && (
        <>
          <Segmented small value={triMode} onChange={setTriangleMode} options={[
              { value: 'equal', label: 'Equal sides' },
              { value: 'unequal', label: 'Unequal' },
            ]} />
          <span className="cb-hint">{triMode === 'equal' ? 'Drag to draw (Shift = equal sides) · or click once to type the side' : 'Drag to draw · or click once to type its sides and angles'}</span>
        </>
      )}
      {tool === 'diamond' && <span className="cb-hint">Drag to draw (Alt = from centre) · or click once to type a size</span>}
      {tool === 'pill' && <span className="cb-hint">Drag to draw (round ends) · or click once to type width, height and radius</span>}
      {tool === 'body' && <span className="cb-hint">Click on the board to make an egg, a peanut or an ant-like body</span>}
      {tool === 'text' && <span className="cb-hint">Click on the board where the text should go</span>}
      {tool === 'pen' && (
        <>
          <Segmented small value={penMode} onChange={setPenMode} options={[
              { value: 'points', label: 'Points' },
              { value: 'freehand', label: 'Freehand' },
            ]} />
          <span className="cb-hint">
            {penMode === 'points'
              ? 'Click for a corner · drag for a curve · click the first point to close it into an outline · Enter or click the last point to leave it open (a weld line) · Backspace undoes a point'
              : 'Draw with the mouse held down · end near where you started to close it into an outline'}
          </span>
        </>
      )}
      {tool === 'builder' && (
        <span className="cb-hint">
          Select the overlapping shapes first (or none for all) · click a region, or drag across several, to merge them · Alt+click or Alt+drag deletes regions
        </span>
      )}
    </div>
  );
}
