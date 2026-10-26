// The drawing board: primitives (drag or click-to-type), the pen, the shape
// builder, selection, move, scale and rotate handles, and live width/length
// dimensions you can type into.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useApp, type Tool } from '../state/store';
import {
  apply,
  boxCenter,
  boxHeight,
  boxWidth,
  distToSegment,
  fmt,
  multiply,
  pointInPolygon,
  rotationAbout,
  scaleAbout,
  translate,
  type Box,
  type Vec2,
} from '../model/geometry';
import { makeLine, makeShape, ownScale, pathData, pillSize, roleOf, scalesEvenly, shapeBox, shapesBox, worldContours, type Shape } from '../model/shapes';
import { selectionBox, setSelectionDimension, transformSelected } from '../model/transform';
import type { Piece, Problem } from '../model/pieces';
import { BODY_PRESETS, type BodyParams } from '../model/body';
import { CORNERS, SIDES, setTriAngle, setTriSide, triAngles, triCorners, triFromBase, triSides } from '../model/triangle';
import { Link, Unlink } from 'lucide-react';
import { ShapeDialog, type DialogResult, type SizeTool } from './ShapeDialog';
import { BodyWizard } from './BodyWizard';
import { StarWizard } from './StarWizard';
import { STAR_PRESETS, type StarParams } from '../model/star';
import { TextWizard, type TextResult } from './TextWizard';
import { makePenShape, smoothStroke, type Anchor } from '../model/pen';
import { applyBuild, buildFaces, canBuild, faceAt } from '../model/builder';
import { folderText, useRecent, whenText, type RecentProject } from '../io/recent';
import { FileClock } from 'lucide-react';

interface View {
  ox: number;
  oy: number;
  z: number; // px per mm
}

/** Tools that draw by dragging (or click to type a size). */
type DrawTool = Extract<Tool, SizeTool>;
/** Tools that open a wizard where you click. */
type WizardTool = 'body' | 'text' | 'star';
const isWizardTool = (t: Tool): t is WizardTool => t === 'body' || t === 'text' || t === 'star';

/** What a dimension label edits: box width / length, a circle's diameter,
 *  a pill's radius, or an unequal triangle's side (s0-s2) / corner (a0-a2). */
type DimTarget = 'x' | 'y' | 'd' | 'r' | 's0' | 's1' | 's2' | 'a0' | 'a1' | 'a2';

/** A snapped point for the weld line tool. */
interface Snap {
  p: Vec2;
  kind: 'corner' | 'centre' | 'middle' | 'edge' | null;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'draw'; tool: DrawTool; a: Vec2; b: Vec2; sx: number; sy: number; moved: boolean }
  | { kind: 'wizard'; tool: WizardTool; a: Vec2 }
  | { kind: 'weld'; a: Vec2; b: Vec2; moved: boolean }
  | { kind: 'move'; a: Vec2; orig: Shape[]; moved: boolean }
  | { kind: 'scale'; handle: Handle; box: Box; orig: Shape[] }
  | { kind: 'rotate'; c: Vec2; a0: number; orig: Shape[] }
  | { kind: 'marquee'; a: Vec2; b: Vec2; add: boolean }
  | { kind: 'penPoint'; a: Vec2; moved: boolean }
  | { kind: 'freehand'; pts: Vec2[] }
  | { kind: 'build'; picked: number[]; erase: boolean };

const HANDLE_CURSORS: Record<Handle, string> = {
  nw: 'nwse-resize',
  se: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
};

/** Largest size that can be typed (mm). */
const MAX_TYPED_MM = 100_000;

const lastSize = { w: 200, h: 120, radius: 100, sides: 6, pillW: 300, pillH: 120, pillR: 60, side: 200, base: 300, left: 50, right: 70 };
let lastBody: BodyParams = structuredClone(BODY_PRESETS[0].params);
/** Opens on Pebble the first time (it shows the tool makes pebbles too), then as last used. */
let lastStar: StarParams = { ...STAR_PRESETS[0] };

/** The board's zoom/pan, kept while you switch to Inflate and back. */
let savedView: View | null = null;

/** Set while the board is open: the world point in the middle of the view
 *  (pasted shapes land there, like Illustrator). */
export const board: { centre: (() => Vec2) | null } = { centre: null };

interface Props {
  pieces: Piece[];
  problems: Problem[];
  onOpenRecent: (r: RecentProject) => void;
}

export function Editor2D({ pieces, problems, onOpenRecent }: Props) {
  const recent = useRecent((s) => s.list);
  const shapes = useApp((s) => s.shapes);
  const selected = useApp((s) => s.selected);
  const tool = useApp((s) => s.tool);
  const sides = useApp((s) => s.polygonSides);
  const lock = useApp((s) => s.lockProportions);
  const fitRequest = useApp((s) => s.fitRequest);
  const { commit, preview, checkpoint, select } = useApp.getState();

  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>(savedView ?? { ox: 400, oy: 300, z: 1 });
  useEffect(() => {
    savedView = view;
  }, [view]);
  const drag = useRef<Drag | null>(null);
  const [ghost, setGhost] = useState<Shape | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [dialog, setDialog] = useState<{ tool: DrawTool; at: Vec2; screen: [number, number] } | null>(null);
  const [wizard, setWizard] = useState<{ tool: WizardTool; at: Vec2 } | null>(null);
  const [snap, setSnap] = useState<Snap | null>(null);
  const [editing, setEditing] = useState<{ target: DimTarget; x: number; y: number; value: string } | null>(null);
  const [cursor, setCursor] = useState('default');
  const [mouse, setMouse] = useState<Vec2 | null>(null);
  const space = useRef(false);
  // Pen: the anchors placed so far (null = no path in progress).
  const penRef = useRef<Anchor[] | null>(null);
  const [penAnchors, setPenState] = useState<Anchor[] | null>(null);
  const setPen = (a: Anchor[] | null) => {
    penRef.current = a;
    setPenState(a);
  };
  const [stroke, setStroke] = useState<Vec2[] | null>(null);
  // Shape builder: the region under the mouse and the ones being dragged over.
  const [hoverFace, setHoverFace] = useState(-1);
  const [picked, setPicked] = useState<{ ids: number[]; erase: boolean } | null>(null);
  const viewInit = useRef(savedView !== null);

  const toScreen = useCallback((p: Vec2): Vec2 => [view.ox + p[0] * view.z, view.oy - p[1] * view.z], [view]);
  const toWorld = useCallback((sx: number, sy: number): Vec2 => [(sx - view.ox) / view.z, (view.oy - sy) / view.z], [view]);

  // Size tracking.
  useLayoutEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      if (!viewInit.current && r.width > 0) {
        viewInit.current = true;
        setView({ ox: r.width / 2, oy: r.height / 2, z: Math.min(r.width, r.height) / 700 });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    const b = shapesBox(useApp.getState().shapes);
    if (!b) {
      setView({ ox: size.w / 2, oy: size.h / 2, z: Math.min(size.w, size.h) / 700 });
      return;
    }
    const bw = Math.max(boxWidth(b), 10);
    const bh = Math.max(boxHeight(b), 10);
    const z = Math.min((size.w - 160) / bw, (size.h - 160) / bh);
    const c = boxCenter(b);
    setView({ z, ox: size.w / 2 - c[0] * z, oy: size.h / 2 + c[1] * z });
  }, [size]);

  useEffect(() => {
    board.centre = () => toWorld(size.w / 2, size.h / 2);
    return () => {
      board.centre = null;
    };
  }, [toWorld, size]);

  useEffect(() => {
    if (fitRequest) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest]);

  // Space-to-pan and polygon corner count while dragging.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) {
        space.current = true;
        setCursor('grab');
        e.preventDefault();
      }
      const d = drag.current;
      if (d?.kind === 'draw' && d.tool === 'polygon' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        e.stopPropagation();
        const st = useApp.getState();
        st.setPolygonSides(st.polygonSides + (e.key === 'ArrowUp' ? 1 : -1));
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space.current = false;
        setCursor('default');
      }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Keep the ghost in sync if sides change mid-drag.
  useEffect(() => {
    const d = drag.current;
    if (d?.kind === 'draw') setGhost(shapeFromDrag(d.tool, d.a, d.b, false, false, sides, useApp.getState().triangleMode));
  }, [sides]);

  /** End the pen path: closed (clicked its first point) -> an outline;
   *  open -> a weld line. The pen stays picked, like Illustrator. */
  const finishPen = (closed: boolean) => {
    const a = penRef.current;
    setPen(null);
    if (!a || a.length < 2) return;
    if (closed && a.length < 3 && !a.some((q) => q.in || q.out)) closed = false;
    const s = makePenShape(a, closed);
    commit([...useApp.getState().shapes, s]);
    select([s.id]);
  };
  const finishPenRef = useRef(finishPen);
  finishPenRef.current = finishPen;

  // Pen keys while a path is open: Enter / Esc end it, Backspace takes back a point.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const a = penRef.current;
      if (!a || e.target instanceof HTMLInputElement) return;
      if (e.key === 'Enter' || e.key === 'Escape') finishPenRef.current(false);
      else if (e.key === 'Backspace' || e.key === 'Delete') setPen(a.length > 1 ? a.slice(0, -1) : null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', down, true);
    return () => window.removeEventListener('keydown', down, true);
  }, []);

  // Picking another tool ends a pen path where it is.
  useEffect(() => {
    if (tool !== 'pen' && penRef.current) finishPenRef.current(false);
    setHoverFace(-1);
  }, [tool]);

  // Shape builder: the selected outlines (or all of them if none is
  // selected) cut into the regions they make.
  const buildSources = useMemo(() => {
    if (tool !== 'builder') return [];
    const pool = shapes.filter(canBuild);
    const sel = pool.filter((s) => selected.includes(s.id));
    return sel.length ? sel : pool;
  }, [tool, shapes, selected]);
  const faces = useMemo(() => buildFaces(buildSources), [buildSources]);

  const selBox = useMemo(() => selectionBox(shapes, selected), [shapes, selected]);
  const allBox = useMemo(() => shapesBox(shapes), [shapes]);
  const badIds = useMemo(() => new Set(problems.map((p) => p.shapeId)), [problems]);

  // ── Hit testing ──────────────────────────────────────────────────────────
  const handlePoints = (b: Box): Record<Handle, Vec2> => {
    const [l, t] = toScreen([b.minX, b.maxY]);
    const [r, bo] = toScreen([b.maxX, b.minY]);
    const cx = (l + r) / 2;
    const cy = (t + bo) / 2;
    return { nw: [l, t], n: [cx, t], ne: [r, t], e: [r, cy], se: [r, bo], s: [cx, bo], sw: [l, bo], w: [l, cy] };
  };

  const rotateKnob = (b: Box): Vec2 => {
    const [l, t] = toScreen([b.minX, b.maxY]);
    const [r] = toScreen([b.maxX, b.minY]);
    return [(l + r) / 2, t - 30];
  };

  const hitHandle = (sx: number, sy: number): Handle | 'rotate' | null => {
    if (!selBox) return null;
    const k = rotateKnob(selBox);
    if (Math.hypot(sx - k[0], sy - k[1]) < 9) return 'rotate';
    const hp = handlePoints(selBox);
    for (const h of Object.keys(hp) as Handle[]) {
      if (Math.abs(sx - hp[h][0]) <= 6 && Math.abs(sy - hp[h][1]) <= 6) return h;
    }
    // Just outside a corner rotates, like Illustrator.
    for (const h of ['nw', 'ne', 'se', 'sw'] as Handle[]) {
      const d = Math.hypot(sx - hp[h][0], sy - hp[h][1]);
      const [l, t] = hp.nw;
      const [r, b] = hp.se;
      const outside = sx < l || sx > r || sy < t || sy > b;
      if (d > 7 && d < 22 && outside) return 'rotate';
    }
    return null;
  };

  const hitShape = (p: Vec2): Shape | null => {
    const tol = 6 / view.z;
    let best: Shape | null = null;
    let bestArea = Infinity;
    for (const s of shapes) {
      for (const c of worldContours(s)) {
        // Inside a closed shape counts as a hit — except for imported lines
        // not yet selected, so a box can be dragged inside an imported
        // outline to pick out the weld lines in it.
        let hit = c.closed && (!s.group || selected.includes(s.id)) && pointInPolygon(p, c.pts);
        if (!hit) {
          const n = c.pts.length;
          for (let i = 0; i < (c.closed ? n : n - 1) && !hit; i++) hit = distToSegment(p, c.pts[i], c.pts[(i + 1) % n]) < tol;
        }
        if (hit) {
          const b = shapeBox(s);
          const area = boxWidth(b) * boxHeight(b);
          if (area < bestArea) {
            best = s;
            bestArea = area;
          }
        }
      }
    }
    return best;
  };

  /** Weld line snapping: corners, centres and edge middles first, then the
   *  nearest point on any edge. */
  const snapPoint = (p: Vec2): Snap => {
    const near = 10 / view.z;
    let best: Snap = { p, kind: null };
    let bd = near;
    const consider = (q: Vec2, kind: Snap['kind']) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) {
        bd = d;
        best = { p: q, kind };
      }
    };
    for (const s of shapes) {
      const curved = s.kind === 'circle' || s.kind === 'ellipse' || s.kind === 'pill' || s.kind === 'body' || s.kind === 'star';
      if (s.kind === 'text') continue; // letters: edges only (below)
      if (s.kind === 'pen') {
        s.pen?.anchors.forEach((a) => consider(apply(s.matrix, a.p), 'corner'));
        consider(boxCenter(shapeBox(s)), 'centre');
        continue;
      }
      for (const c of worldContours(s)) {
        const n = c.pts.length;
        if (curved) {
          for (let i = 0; i < 4; i++) consider(c.pts[Math.round((i * n) / 4) % n], 'corner');
        } else {
          c.pts.forEach((q) => consider(q, 'corner'));
          for (let i = 0; i < (c.closed ? n : n - 1); i++) {
            const a = c.pts[i];
            const b = c.pts[(i + 1) % n];
            consider([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], 'middle');
          }
        }
      }
      if (s.kind !== 'line') consider(boxCenter(shapeBox(s)), 'centre');
    }
    if (best.kind) return best;
    bd = 8 / view.z;
    for (const s of shapes) {
      for (const c of worldContours(s)) {
        const n = c.pts.length;
        for (let i = 0; i < (c.closed ? n : n - 1); i++) {
          const a = c.pts[i];
          const b = c.pts[(i + 1) % n];
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const l2 = dx * dx + dy * dy || 1e-12;
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
          consider([a[0] + t * dx, a[1] + t * dy], 'edge');
        }
      }
    }
    return best;
  };

  /** Shift: keep the weld line at a multiple of 15 degrees. */
  const constrainAngle = (a: Vec2, b: Vec2): Vec2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ang = Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12)) * (Math.PI / 12);
    return [a[0] + l * Math.cos(ang), a[1] + l * Math.sin(ang)];
  };

  // ── Pointer handling ─────────────────────────────────────────────────────
  const local = (e: React.PointerEvent | React.WheelEvent): [number, number] => {
    const r = host.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (dialog || wizard || editing) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [sx, sy] = local(e);
    const p = toWorld(sx, sy);
    if (e.button === 1 || e.button === 2 || space.current) {
      drag.current = { kind: 'pan', sx, sy, ox: view.ox, oy: view.oy };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'weld') {
      const a = snapPoint(p).p;
      drag.current = { kind: 'weld', a, b: a, moved: false };
      return;
    }
    if (tool === 'pen') {
      if (useApp.getState().penMode === 'freehand') {
        drag.current = { kind: 'freehand', pts: [p] };
        setStroke([p]);
        return;
      }
      const cur = penRef.current ?? [];
      const last = cur[cur.length - 1];
      const q = e.shiftKey && last ? constrainAngle(last.p, p) : snapPoint(p).p;
      const near = (a: Vec2) => Math.hypot(q[0] - a[0], q[1] - a[1]) * view.z < 8;
      if (cur.length >= 2 && near(cur[0].p)) return finishPen(true);
      if (last && near(last.p)) return finishPen(false);
      setPen([...cur, { p: q }]);
      drag.current = { kind: 'penPoint', a: q, moved: false };
      return;
    }
    if (tool === 'builder') {
      const i = faceAt(faces, p);
      drag.current = { kind: 'build', picked: i >= 0 ? [i] : [], erase: e.altKey };
      setPicked({ ids: i >= 0 ? [i] : [], erase: e.altKey });
      return;
    }
    if (isWizardTool(tool)) {
      drag.current = { kind: 'wizard', tool, a: p };
      return;
    }
    if (tool !== 'select') {
      drag.current = { kind: 'draw', tool, a: p, b: p, sx, sy, moved: false };
      return;
    }
    const h = hitHandle(sx, sy);
    if (h && selBox) {
      checkpoint();
      if (h === 'rotate') {
        const c = boxCenter(selBox);
        drag.current = { kind: 'rotate', c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), orig: shapes };
      } else {
        drag.current = { kind: 'scale', handle: h, box: selBox, orig: shapes };
      }
      return;
    }
    const s = hitShape(p);
    if (s) {
      // Imported lines come as a group: a click takes the whole group (a
      // double-click picks out one line).
      const unit = s.group && !selected.includes(s.id) ? shapes.filter((o) => o.group === s.group).map((o) => o.id) : [s.id];
      let ids = selected;
      if (e.shiftKey) ids = selected.includes(s.id) ? selected.filter((i) => !unit.includes(i)) : [...selected, ...unit];
      else if (!selected.includes(s.id)) ids = unit;
      select(ids);
      drag.current = { kind: 'move', a: p, orig: shapes, moved: false };
      return;
    }
    if (!e.shiftKey) select([]);
    drag.current = { kind: 'marquee', a: p, b: p, add: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [sx, sy] = local(e);
    const p = toWorld(sx, sy);
    setMouse(p);
    const d = drag.current;
    if (!d) {
      if (space.current) return;
      if (tool === 'weld' || (tool === 'pen' && useApp.getState().penMode === 'points')) setSnap(snapPoint(p));
      if (tool === 'builder') setHoverFace(faceAt(faces, p));
      if (tool !== 'select') setCursor('crosshair');
      else {
        const h = hitHandle(sx, sy);
        setCursor(h === 'rotate' ? 'alias' : h ? HANDLE_CURSORS[h] : hitShape(p) ? 'move' : 'default');
      }
      return;
    }
    switch (d.kind) {
      case 'pan':
        setView((v) => ({ ...v, ox: d.ox + sx - d.sx, oy: d.oy + sy - d.sy }));
        break;
      case 'weld': {
        const sn: Snap = e.shiftKey ? { p: constrainAngle(d.a, p), kind: null } : snapPoint(p);
        d.b = sn.p;
        setSnap(sn);
        if (Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * view.z > 4) d.moved = true;
        if (d.moved) setGhost(makeLine(d.a, d.b));
        break;
      }
      case 'draw':
        d.b = p;
        if (Math.hypot(sx - d.sx, sy - d.sy) > 4) d.moved = true;
        if (d.moved) setGhost(shapeFromDrag(d.tool, d.a, d.b, e.shiftKey, e.altKey, useApp.getState().polygonSides, useApp.getState().triangleMode));
        break;
      case 'move': {
        let dx = p[0] - d.a[0];
        let dy = p[1] - d.a[1];
        if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
        if (!d.moved && Math.hypot(dx, dy) * view.z > 3) {
          d.moved = true;
          checkpoint();
        }
        if (d.moved) preview(transformSelected(d.orig, useApp.getState().selected, translate(dx, dy)));
        break;
      }
      case 'scale': {
        const b = d.box;
        const c = boxCenter(b);
        const h = d.handle;
        const ax = e.altKey ? c[0] : h.includes('w') ? b.maxX : b.minX;
        const ay = e.altKey ? c[1] : h.includes('n') ? b.minY : b.maxY;
        const hx = h.includes('w') ? b.minX : b.maxX;
        const hy = h.includes('n') ? b.maxY : b.minY;
        const affectsX = h.includes('w') || h.includes('e');
        const affectsY = h.includes('n') || h.includes('s');
        let sxk = affectsX ? (p[0] - ax) / (hx - ax || 1e-9) : 1;
        let syk = affectsY ? (p[1] - ay) / (hy - ay || 1e-9) : 1;
        const even = d.orig.some((s) => useApp.getState().selected.includes(s.id) && scalesEvenly(s));
        const uniform = even || lock !== e.shiftKey;
        if (uniform) {
          const k = affectsX && affectsY ? (Math.abs(sxk) > Math.abs(syk) ? sxk : syk) : affectsX ? sxk : syk;
          sxk = k;
          syk = k;
        }
        const clampK = (k: number) => (Math.abs(k) < 0.01 ? 0.01 * Math.sign(k || 1) : k);
        const anchor: Vec2 = [affectsX ? ax : c[0], affectsY ? ay : c[1]];
        if (uniform && !(affectsX && affectsY)) {
          // Edge handle with lock: scale evenly about the opposite edge's midpoint.
          if (affectsX) anchor[1] = c[1];
          else anchor[0] = c[0];
        }
        preview(transformSelected(d.orig, useApp.getState().selected, scaleAbout(clampK(sxk), clampK(syk), anchor)));
        break;
      }
      case 'rotate': {
        let delta = Math.atan2(p[1] - d.c[1], p[0] - d.c[0]) - d.a0;
        const first = d.orig.find((s) => useApp.getState().selected.includes(s.id));
        if (e.shiftKey && first) {
          const target = Math.round((first.rotation + (delta * 180) / Math.PI) / 15) * 15;
          delta = ((target - first.rotation) * Math.PI) / 180;
        }
        preview(transformSelected(d.orig, useApp.getState().selected, rotationAbout(delta, d.c), (delta * 180) / Math.PI));
        break;
      }
      case 'penPoint': {
        const cur = penRef.current;
        if (!cur?.length) break;
        if (!d.moved && Math.hypot(p[0] - d.a[0], p[1] - d.a[1]) * view.z > 3) d.moved = true;
        if (!d.moved) break;
        // Dragging pulls out curve handles; Alt moves only the outgoing one.
        const last = cur[cur.length - 1];
        const back: Vec2 = [2 * d.a[0] - p[0], 2 * d.a[1] - p[1]];
        setPen([...cur.slice(0, -1), { p: d.a, out: p, in: e.altKey ? last.in : back }]);
        break;
      }
      case 'freehand': {
        const last = d.pts[d.pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * view.z > 1.5) {
          d.pts.push(p);
          setStroke([...d.pts]);
        }
        break;
      }
      case 'build': {
        const i = faceAt(faces, p);
        if (i >= 0 && !d.picked.includes(i)) {
          d.picked.push(i);
          setPicked({ ids: [...d.picked], erase: d.erase });
        }
        setHoverFace(i);
        break;
      }
      case 'marquee':
        d.b = p;
        setMarquee({ minX: Math.min(d.a[0], p[0]), maxX: Math.max(d.a[0], p[0]), minY: Math.min(d.a[1], p[1]), maxY: Math.max(d.a[1], p[1]) });
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'pan') setCursor(space.current ? 'grab' : 'default');
    if (d.kind === 'wizard') setWizard({ tool: d.tool, at: d.a });
    if (d.kind === 'weld') {
      setGhost(null);
      if (!d.moved) {
        useApp.getState().showToast('Drag to draw a weld line. It snaps to corners, centres and edges; Shift keeps it to 15-degree steps.');
        return;
      }
      const line = makeLine(d.a, d.b);
      commit([...useApp.getState().shapes, line]);
      select([line.id]);
    }
    if (d.kind === 'draw') {
      setGhost(null);
      if (!d.moved) {
        const [sx, sy] = local(e);
        setDialog({ tool: d.tool, at: d.a, screen: [sx, sy] });
        return;
      }
      const s = shapeFromDrag(d.tool, d.a, d.b, e.shiftKey, e.altKey, useApp.getState().polygonSides, useApp.getState().triangleMode);
      const b = shapeBox(s);
      if (boxWidth(b) * view.z < 3 && boxHeight(b) * view.z < 3) return;
      commit([...useApp.getState().shapes, s]);
      select([s.id]);
    }
    if (d.kind === 'freehand') {
      setStroke(null);
      const pts = d.pts;
      const len = pts.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
      if (pts.length < 2 || len * view.z < 6) return;
      // Ending near the start closes it into an outline.
      const gap = Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
      const closed = pts.length > 3 && gap * view.z < 16 && gap < len / 4;
      const anchors = smoothStroke(pts, closed, 1.2 / view.z);
      if (anchors.length < 2) return;
      const s = makePenShape(anchors, closed);
      commit([...useApp.getState().shapes, s]);
      select([s.id]);
    }
    if (d.kind === 'build') {
      setPicked(null);
      if (!d.picked.length) return;
      const all = useApp.getState().shapes;
      const { shapes: next, made } = applyBuild(all, faces, d.picked, d.erase);
      commit(next);
      // Keep working on the result: the new pieces plus the untouched shapes.
      const srcIds = buildSources.map((s) => s.id);
      select([...made, ...next.filter((s) => srcIds.includes(s.id)).map((s) => s.id)]);
    }
    if (d.kind === 'marquee') {
      setMarquee(null);
      const m = { minX: Math.min(d.a[0], d.b[0]), maxX: Math.max(d.a[0], d.b[0]), minY: Math.min(d.a[1], d.b[1]), maxY: Math.max(d.a[1], d.b[1]) };
      if ((m.maxX - m.minX) * view.z < 3 && (m.maxY - m.minY) * view.z < 3) return;
      // Only lines that actually run through the box (so a box inside an
      // imported outline picks the weld lines, not the outline round them).
      const hits = shapes.filter((s) => worldContours(s).some((c) => polylineInBox(c.pts, c.closed, m))).map((s) => s.id);
      select(d.add ? [...new Set([...selected, ...hits])] : hits);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const [sx, sy] = local(e);
    const k = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const z = Math.max(0.005, Math.min(500, v.z * k));
      const wx = (sx - v.ox) / v.z;
      const wy = (v.oy - sy) / v.z;
      return { z, ox: sx - wx * z, oy: sy + wy * z };
    });
  };

  const onDialogOk = (r: DialogResult) => {
    if (!dialog) return;
    const t = dialog.tool;
    let s: Shape;
    if (t === 'polygon') {
      lastSize.radius = r.radius!;
      lastSize.sides = r.sides!;
      useApp.getState().setPolygonSides(r.sides!);
      s = makeShape('polygon', [0, 0], { radius: r.radius, sides: r.sides });
    } else if (r.tri) {
      // Next time the box opens on this triangle (base AB and its two angles).
      const [ab] = triSides(r.tri);
      const [a, b] = triAngles(r.tri);
      Object.assign(lastSize, { base: ab, left: a, right: b });
      s = makeShape('scalene', [0, 0], { tri: r.tri });
    } else if (t === 'pill') {
      Object.assign(lastSize, { pillW: r.w!, pillH: r.h!, pillR: r.radius! });
      s = makeShape('pill', [0, 0], { w: r.w, h: r.h, radius: r.radius });
    } else if (t === 'triangle') {
      lastSize.side = r.w!;
      s = makeShape('triangle', [0, 0], { w: r.w, h: r.h });
    } else {
      lastSize.w = r.w!;
      lastSize.h = r.h!;
      s = makeShape(t, [0, 0], { w: r.w, h: r.h });
    }
    placeAt(s, dialog.at);
    setDialog(null);
  };

  /** Illustrator places a typed shape with its top-left at the click point. */
  const placeAt = (shape: Shape, at: Vec2) => {
    const b = shapeBox(shape);
    const s = { ...shape, matrix: multiply(translate(at[0] - b.minX, at[1] - b.maxY), shape.matrix) };
    commit([...useApp.getState().shapes, s]);
    select([s.id]);
  };

  const onBodyOk = (p: BodyParams) => {
    if (!wizard) return;
    lastBody = structuredClone(p);
    const name = p.segs.length === 1 ? 'Egg' : `Body (${p.segs.length} parts)`;
    placeAt(makeShape('body', [0, 0], { body: p, name }), wizard.at);
    setWizard(null);
  };

  // Pebble / star: nothing to draw — the wizard opens as soon as the tool is
  // picked, and the shape lands in the middle of the board.
  useEffect(() => {
    if (tool === 'star' && !wizard) setWizard({ tool: 'star', at: toWorld(size.w / 2, size.h / 2) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool]);
  const closeStar = () => {
    setWizard(null);
    useApp.getState().setTool('select');
  };
  const onStarOk = (p: StarParams) => {
    if (!wizard) return;
    lastStar = { ...p };
    const s = makeShape('star', wizard.at, { star: { ...p }, name: p.name });
    commit([...useApp.getState().shapes, s]);
    select([s.id]);
    closeStar();
  };

  const onTextOk = (r: TextResult) => {
    if (!wizard) return;
    const all = r.outline.contours.flat();
    const cx = (Math.min(...all.map((q) => q[0])) + Math.max(...all.map((q) => q[0]))) / 2;
    const cy = (Math.min(...all.map((q) => q[1])) + Math.max(...all.map((q) => q[1]))) / 2;
    const contours = r.outline.contours.map((c) => ({ closed: true, pts: c.map(([x, y]) => [x - cx, y - cy] as Vec2) }));
    const s = makeShape('text', [0, 0], {
      contours,
      text: { text: r.text, family: r.family, bold: r.bold, cap: r.height },
      name: `Text “${r.text}”`,
    });
    placeAt(s, wizard.at);
    setWizard(null);
  };

  // ── Dimensions ───────────────────────────────────────────────────────────
  const dimBox = selBox ?? allBox;
  const dimIds = selBox ? selected : shapes.map((s) => s.id);

  const single = selBox && selected.length === 1 ? (shapes.find((s) => s.id === selected[0]) ?? null) : null;

  const applyDimension = (target: DimTarget, text: string) => {
    const v = Number(text.replace(',', '.'));
    setEditing(null);
    // "Infinity" or a slip of the keyboard (1e9) would wreck the drawing.
    if (!Number.isFinite(v) || v > MAX_TYPED_MM) return useApp.getState().showToast(`Please type a size up to ${MAX_TYPED_MM / 1000} m.`);
    if (!(v > 0) && target !== 'r') return;
    if (target === 'x' || target === 'y') {
      commit(setSelectionDimension(shapes, dimIds, target, v, useApp.getState().lockProportions));
    } else if (target === 'd') {
      commit(setSelectionDimension(shapes, dimIds, 'x', v, true));
    } else if (single && target === 'r') {
      const { w, h } = pillSize(single);
      if (v >= 0) commit(shapes.map((s) => (s.id === single.id ? { ...s, radius: Math.min(v, w / 2, h / 2) } : s)));
    } else if (single) {
      const i = Number(target[1]);
      const next = target[0] === 's' ? setTriSide(single, i, v) : setTriAngle(single, i, v);
      if (!next) useApp.getState().showToast('That angle can’t make a triangle — keep it under 180°.');
      else commit(shapes.map((s) => (s.id === single.id ? next : s)));
    }
  };

  const label = (x: number, y: number, text: string, target: DimTarget, vertical = false) => {
    const w = text.length * 7.4 + 16;
    return (
      <g
        key={target}
        className="dim-label"
        transform={`translate(${x},${y})${vertical ? ' rotate(-90)' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          // Edit just the number (drop "Ø ", "R ", "AB ", "A " and "°").
          setEditing({ target, x, y, value: text.replace(/^[^\d.-]+/, '').replace('°', '') });
        }}
        data-testid={target === 'x' ? 'dim-width' : target === 'y' ? 'dim-length' : `dim-${target}`}
      >
        <rect x={-w / 2} y={-10} width={w} height={20} rx={4} />
        <text textAnchor="middle" dy="4.5">
          {text}
        </text>
      </g>
    );
  };

  /** Unequal triangle: each side's length outside it, each corner's angle inside. */
  const renderTriDims = (s: Shape) => {
    const c = triCorners(s);
    if (c.length !== 3) return null;
    const lens = triSides(c);
    const angs = triAngles(c);
    const mid: Vec2 = [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3];
    return (
      <g className="dims">
        {c.map((p, i) => {
          const q = c[(i + 1) % 3];
          const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          // Outward normal of an anticlockwise side (world, Y up) -> screen.
          const nx = (q[1] - p[1]) / l;
          const ny = -(q[0] - p[0]) / l;
          const [mx, my] = toScreen([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]);
          return label(mx + nx * 20, my - ny * 20, `${SIDES[i]} ${fmt(lens[i])}`, `s${i}` as DimTarget);
        })}
        {c.map((p, i) => {
          const dx = mid[0] - p[0];
          const dy = mid[1] - p[1];
          const l = Math.hypot(dx, dy) || 1;
          // Just outside the corner, where a sharp tip leaves no room inside.
          const [px, py] = toScreen(p);
          return label(px - (dx / l) * 30, py + (dy / l) * 30, `${CORNERS[i]} ${fmt(angs[i])}°`, `a${i}` as DimTarget);
        })}
      </g>
    );
  };

  /** Pill: a leader from a corner's centre to its arc, with the radius. */
  const renderPillRadius = (s: Shape) => {
    const { w, h, r } = pillSize(s);
    const [sx, sy] = ownScale(s.matrix);
    const toLocal = (x: number, y: number): Vec2 => [x / sx, y / sy];
    // Top-left corner: the length dimension sits on the right.
    const centre = apply(s.matrix, toLocal(-w / 2 + r, h / 2 - r));
    const arc = apply(s.matrix, toLocal(-w / 2 + r - r * Math.SQRT1_2, h / 2 - r + r * Math.SQRT1_2));
    const [ax, ay] = toScreen(centre);
    const [bx, by] = toScreen(arc);
    const l = Math.hypot(bx - ax, by - ay) || 1;
    const ex = bx + ((bx - ax) / l) * 26;
    const ey = by + ((by - ay) / l) * 26;
    return (
      <g className="dims">
        <line x1={ax} y1={ay} x2={ex} y2={ey} />
        <circle className="dim-dot" cx={ax} cy={ay} r={2} />
        {label(ex + (ex >= bx ? 24 : -24), ey, `R ${fmt(r)}`, 'r')}
      </g>
    );
  };

  const renderDims = () => {
    if (!dimBox || dialog || wizard) return null;
    if (single?.kind === 'scalene') return renderTriDims(single);
    const circle = single?.kind === 'circle';
    const [l, t] = toScreen([dimBox.minX, dimBox.maxY]);
    const [r, b] = toScreen([dimBox.maxX, dimBox.minY]);
    const wy = b + 44;
    const hx = r + 44;
    const wText = fmt(boxWidth(dimBox));
    const hText = fmt(boxHeight(dimBox));
    const cls = selBox ? 'dims' : 'dims dims-faint';
    const arrow = (x: number, y: number, dir: 'l' | 'r' | 'u' | 'd') => {
      const s = 7;
      const w = 3;
      const pts =
        dir === 'l'
          ? [[x, y], [x + s, y - w], [x + s, y + w]]
          : dir === 'r'
            ? [[x, y], [x - s, y - w], [x - s, y + w]]
            : dir === 'u'
              ? [[x, y], [x - w, y + s], [x + w, y + s]]
              : [[x, y], [x - w, y - s], [x + w, y - s]];
      return <polygon points={pts.map((p) => p.join(',')).join(' ')} />;
    };
    return (
      <g className={cls}>
        <line x1={l} y1={b + 6} x2={l} y2={wy + 6} />
        <line x1={r} y1={b + 6} x2={r} y2={wy + 6} />
        <line x1={l} y1={wy} x2={r} y2={wy} />
        {arrow(l, wy, 'l')}
        {arrow(r, wy, 'r')}
        {circle ? label((l + r) / 2, wy, `Ø ${wText}`, 'd') : label((l + r) / 2, wy, wText, 'x')}
        {!circle && (
          <>
            <line x1={r + 6} y1={t} x2={hx + 6} y2={t} />
            <line x1={r + 6} y1={b} x2={hx + 6} y2={b} />
            <line x1={hx} y1={t} x2={hx} y2={b} />
            {arrow(hx, t, 'u')}
            {arrow(hx, b, 'd')}
            {label(hx, (t + b) / 2, hText, 'y', true)}
          </>
        )}
        {single?.kind === 'pill' && renderPillRadius(single)}
        {selBox && !circle && !(single && scalesEvenly(single)) && (
          // Chain link just off the shape's bottom-right corner, inside the two
          // dimensions (Adobe-style): linked =
          // typing one size scales the other with it.
          <g
            className={`dim-link${lock ? ' on' : ''}`}
            transform={`translate(${r + 24 - 15},${b + 24 - 15})`}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              useApp.getState().setLock(!lock);
            }}
            data-testid="dim-link"
          >
            <title>{lock ? 'Width and length linked — changing one scales the other' : 'Width and length unlinked — each changes on its own'}</title>
            <rect width={30} height={30} rx={7} />
            {lock ? <Link x={5} y={5} width={20} height={20} strokeWidth={1.9} /> : <Unlink x={5} y={5} width={20} height={20} strokeWidth={1.9} />}
          </g>
        )}
      </g>
    );
  };

  // ── Grid ─────────────────────────────────────────────────────────────────
  const grid = useMemo(() => {
    const minor = niceStep(14 / view.z);
    const major = minor * (String(minor)[0] === '2' ? 5 : 10);
    const [x0, y1] = toWorld(0, 0);
    const [x1, y0] = toWorld(size.w, size.h);
    const lines: React.ReactElement[] = [];
    const add = (step: number, cls: string) => {
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        const sx = view.ox + x * view.z;
        lines.push(<line key={`${cls}x${x}`} className={cls} x1={sx} y1={0} x2={sx} y2={size.h} />);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        const sy = view.oy - y * view.z;
        lines.push(<line key={`${cls}y${y}`} className={cls} x1={0} y1={sy} x2={size.w} y2={sy} />);
      }
    };
    if ((x1 - x0) / minor < 300) add(minor, 'grid-minor');
    add(major, 'grid-major');
    return { lines, minor };
  }, [view, size, toWorld]);

  const piecePath = useMemo(
    () =>
      pieces
        .map((p) =>
          [p.outer, ...p.holes]
            .map((loop) => `M${loop.map((q) => toScreen(q).map((v) => v.toFixed(1)).join(',')).join('L')}Z`)
            .join(''),
        )
        .join(''),
    [pieces, toScreen],
  );

  const ghostBox = ghost ? shapeBox(ghost) : null;

  return (
    <div
      ref={host}
      className="editor2d"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => {
        setMouse(null);
        setSnap(null);
      }}
      onDoubleClick={(e) => {
        if (tool !== 'select') return;
        const r = host.current!.getBoundingClientRect();
        const s = hitShape(toWorld(e.clientX - r.left, e.clientY - r.top));
        // Shift+double-click adds / removes one line of a group.
        if (s?.group) select(e.shiftKey ? (selected.includes(s.id) ? selected.filter((i) => i !== s.id) : [...selected, s.id]) : [s.id]);
      }}
      onWheel={onWheel}
      onContextMenu={(e) => e.preventDefault()}
      data-testid="editor2d"
    >
      <svg width={size.w} height={size.h}>
        <g>{grid.lines}</g>
        <line className="axis" x1={view.ox} y1={0} x2={view.ox} y2={size.h} />
        <line className="axis" x1={0} y1={view.oy} x2={size.w} y2={view.oy} />
        <path className="piece-fill" d={piecePath} fillRule="evenodd" />
        {shapes.map((s) => (
          <path
            key={s.id}
            className={`shape${roleOf(s) === 'weld' ? ' weldline' : roleOf(s) === 'construction' ? ' construction' : ''}${selected.includes(s.id) ? ' selected' : ''}${badIds.has(s.id) ? ' bad' : ''}`}
            d={pathData(s, toScreen)}
          />
        ))}
        {ghost && <path className={`shape ghost${ghost.kind === 'line' ? ' weldline' : ''}`} d={pathData(ghost, toScreen)} />}
        {(tool === 'weld' || tool === 'pen') && snap?.kind && <SnapMark snap={snap} toScreen={toScreen} />}
        {tool === 'builder' &&
          faces.map((f, i) => {
            const hot = picked ? picked.ids.includes(i) : i === hoverFace;
            return (
              <path
                key={i}
                className={`build-face${hot ? ' hot' : ''}${hot && picked?.erase ? ' erase' : ''}`}
                d={f.rings.map((r) => `M${r.map((q) => toScreen(q).map((v) => v.toFixed(1)).join(',')).join('L')}Z`).join('')}
                fillRule="evenodd"
              />
            );
          })}
        {stroke && stroke.length > 1 && <path className="shape ghost" d={`M${stroke.map((q) => toScreen(q).map((v) => v.toFixed(1)).join(',')).join('L')}`} />}
        {penAnchors && <PenPreview anchors={penAnchors} mouse={snap?.kind ? snap.p : mouse} toScreen={toScreen} />}
        {ghost && ghostBox && ghost.kind !== 'line' && (
          <text className="ghost-size" x={toScreen([ghostBox.maxX, ghostBox.minY])[0] + 10} y={toScreen([ghostBox.maxX, ghostBox.minY])[1] + 18}>
            {ghost.kind === 'polygon'
              ? `R ${fmt(ghost.radius)} · ${ghost.sides} corners  (↑↓ to change)`
              : `${fmt(boxWidth(ghostBox))} × ${fmt(boxHeight(ghostBox))} mm`}
          </text>
        )}
        {selBox && tool === 'select' && <SelectionFrame box={selBox} toScreen={toScreen} handles={handlePoints(selBox)} knob={rotateKnob(selBox)} />}
        {renderDims()}
        {marquee && (() => {
          const [l, t] = toScreen([marquee.minX, marquee.maxY]);
          const [r, b] = toScreen([marquee.maxX, marquee.minY]);
          return <rect className="marquee" x={l} y={t} width={r - l} height={b - t} />;
        })()}
      </svg>

      {editing && (
        <input
          className="dim-input"
          style={{ left: editing.x, top: editing.y }}
          autoFocus
          value={editing.value}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyDimension(editing.target, editing.value);
            if (e.key === 'Escape') setEditing(null);
            e.stopPropagation();
          }}
          onBlur={() => applyDimension(editing.target, editing.value)}
          data-testid="dim-input"
        />
      )}

      {dialog && (
        <ShapeDialog
          tool={dialog.tool}
          screen={dialog.screen}
          defaults={{ ...lastSize, sides }}
          onOk={onDialogOk}
          onCancel={() => setDialog(null)}
        />
      )}

      {wizard?.tool === 'body' && <BodyWizard initial={lastBody} onOk={onBodyOk} onCancel={() => setWizard(null)} />}
      {wizard?.tool === 'text' && <TextWizard onOk={onTextOk} onCancel={() => setWizard(null)} />}
      {wizard?.tool === 'star' && <StarWizard initial={lastStar} onOk={onStarOk} onCancel={closeStar} />}

      {!shapes.length && !penAnchors && !stroke && (
        <div className="empty-hint">
          <p>Pick a shape on the left, then <b>drag</b> on the board — or <b>click once</b> to type exact sizes.</p>
          <p>Or import a DXF / DWG / SVG outline — or copy a shape in Illustrator or Word and press <b>Ctrl+V</b>.</p>
          {recent.length > 0 && (
            <div className="recent-list" onPointerDown={(e) => e.stopPropagation()}>
              <h4>Recent projects</h4>
              {recent.slice(0, 5).map((r) => (
                <button key={r.path} onClick={() => onOpenRecent(r)} title={r.path} data-testid="recent-project">
                  <FileClock size={15} strokeWidth={1.6} />
                  <span className="recent-name">
                    {r.name} <em>Rev {r.rev}</em>
                  </span>
                  <span className="recent-where">{folderText(r.path) || 'kept in this browser'}</span>
                  <span className="recent-when">{whenText(r.when)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="statusbar">
        {mouse ? (
          <span>
            X {fmt(mouse[0])} · Y {fmt(mouse[1])} mm
          </span>
        ) : (
          <span>&nbsp;</span>
        )}
        <span>Grid {fmt(grid.minor, 3)} mm</span>
        <span className="hint">Wheel: zoom · Space/right-drag: pan · F: fit</span>
      </div>
    </div>
  );
}

function SelectionFrame({ box, toScreen, handles, knob }: { box: Box; toScreen: (p: Vec2) => Vec2; handles: Record<Handle, Vec2>; knob: Vec2 }) {
  const [l, t] = toScreen([box.minX, box.maxY]);
  const [r, b] = toScreen([box.maxX, box.minY]);
  return (
    <g className="selection">
      <rect x={l} y={t} width={r - l} height={b - t} />
      <line x1={(l + r) / 2} y1={t} x2={knob[0]} y2={knob[1] + 5} />
      <circle className="knob" cx={knob[0]} cy={knob[1]} r={5} />
      {Object.entries(handles).map(([k, [x, y]]) => (
        <rect key={k} className="handle" x={x - 4} y={y - 4} width={8} height={8} />
      ))}
    </g>
  );
}

/** Does any stretch of the polyline pass through the box? (Liang–Barsky clip.) */
function polylineInBox(pts: Vec2[], closed: boolean, b: Box): boolean {
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let ok = true;
    for (const [p, q] of [[-dx, x0 - b.minX], [dx, b.maxX - x0], [-dy, y0 - b.minY], [dy, b.maxY - y0]]) {
      if (p === 0) {
        if (q < 0) ok = false;
      } else {
        const r = q / p;
        if (p < 0) t0 = Math.max(t0, r);
        else t1 = Math.min(t1, r);
      }
    }
    if (ok && t0 <= t1) return true;
  }
  return false;
}

/** The pen path being drawn: placed segments, a rubber band to the mouse,
 *  the anchors, and the curve handles of the newest one. */
function PenPreview({ anchors, mouse, toScreen }: { anchors: Anchor[]; mouse: Vec2 | null; toScreen: (p: Vec2) => Vec2 }) {
  const f = (q: Vec2) => toScreen(q).map((v) => v.toFixed(1)).join(',');
  const seg = (a: Anchor, b: Anchor) => (a.out || b.in ? `C${f(a.out ?? a.p)} ${f(b.in ?? b.p)} ${f(b.p)}` : `L${f(b.p)}`);
  let d = `M${f(anchors[0].p)}`;
  for (let i = 1; i < anchors.length; i++) d += seg(anchors[i - 1], anchors[i]);
  const last = anchors[anchors.length - 1];
  const band = mouse ? `M${f(last.p)}${seg(last, { p: mouse })}` : '';
  const [fx, fy] = toScreen(anchors[0].p);
  const closing = !!mouse && anchors.length >= 2 && Math.hypot(toScreen(mouse)[0] - fx, toScreen(mouse)[1] - fy) < 8;
  return (
    <g className="pen-preview">
      <path className="shape ghost" d={d} />
      {band && <path className="pen-band" d={band} />}
      {[last.in, last.out].map((h, i) =>
        h ? (
          <g key={i} className="pen-handle">
            <line x1={toScreen(last.p)[0]} y1={toScreen(last.p)[1]} x2={toScreen(h)[0]} y2={toScreen(h)[1]} />
            <circle cx={toScreen(h)[0]} cy={toScreen(h)[1]} r={3} />
          </g>
        ) : null,
      )}
      {anchors.map((a, i) => {
        const [x, y] = toScreen(a.p);
        return <rect key={i} className={`pen-anchor${i === 0 && closing ? ' closing' : ''}`} x={x - 3.5} y={y - 3.5} width={7} height={7} />;
      })}
    </g>
  );
}

function SnapMark({ snap, toScreen }: { snap: Snap; toScreen: (p: Vec2) => Vec2 }) {
  const [x, y] = toScreen(snap.p);
  return (
    <g className="snap">
      {snap.kind === 'edge' ? (
        <circle cx={x} cy={y} r={5} />
      ) : (
        <rect x={x - 5} y={y - 5} width={10} height={10} transform={snap.kind === 'middle' ? `rotate(45 ${x} ${y})` : undefined} />
      )}
      <text x={x + 9} y={y - 8}>
        {snap.kind}
      </text>
    </g>
  );
}

function shapeFromDrag(tool: DrawTool, a: Vec2, b: Vec2, shift: boolean, alt: boolean, sides: number, triMode: 'equal' | 'unequal'): Shape {
  if (tool === 'polygon') {
    return makeShape('polygon', a, { radius: Math.max(0.01, Math.hypot(b[0] - a[0], b[1] - a[1])), sides });
  }
  if (tool === 'triangle' && shift && triMode === 'equal') {
    // Shift: exactly equal sides (height = width x sqrt 3 / 2).
    const w = Math.max(0.01, Math.abs(b[0] - a[0]) * (alt ? 2 : 1));
    const h = (w * Math.sqrt(3)) / 2;
    const c: Vec2 = alt ? a : [a[0] + (b[0] - a[0]) / 2, a[1] + (Math.sign(b[1] - a[1]) || 1) * (h / 2)];
    return makeShape('triangle', c, { w, h });
  }
  let dx = b[0] - a[0];
  let dy = b[1] - a[1];
  if (shift || tool === 'circle') {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = m * Math.sign(dx || 1);
    dy = m * Math.sign(dy || 1);
  }
  const w = Math.max(0.01, Math.abs(dx) * (alt ? 2 : 1));
  const h = Math.max(0.01, Math.abs(dy) * (alt ? 2 : 1));
  const c: Vec2 = alt ? a : [a[0] + dx / 2, a[1] + dy / 2];
  if (tool === 'pill') return makeShape('pill', c, { w, h, radius: Math.min(w, h) / 2 });
  if (tool === 'triangle' && triMode === 'unequal') {
    // The last typed angles, stretched to the dragged box.
    const tri = triFromBase(1, lastSize.left, lastSize.right) ?? triFromBase(1, 50, 70)!;
    const xs = tri.map((q) => q[0]);
    const ys = tri.map((q) => q[1]);
    const bw = Math.max(...xs) - Math.min(...xs);
    const bh = Math.max(...ys) - Math.min(...ys);
    return makeShape('scalene', c, { tri: tri.map(([x, y]) => [(x / bw) * w, (y / bh) * h] as Vec2) });
  }
  return makeShape(tool, c, { w, h });
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
