// Egg / body wizard: an egg, or a few egg-shaped segments in a row joined at
// narrow waists (peanut, ant). Live preview; start from a preset.

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { BODY_PRESETS, bodyLength, bodyOutline, type BodyParams } from '../model/body';
import { fmt } from '../model/geometry';

const MAX_SEGS = 4;

interface Props {
  initial: BodyParams;
  onOk: (p: BodyParams) => void;
  onCancel: () => void;
}

export function BodyWizard({ initial, onOk, onCancel }: Props) {
  const [p, setP] = useState<BodyParams>(initial);
  const valid = p.segs.every((s) => s.len > 0 && s.width > 0) && (p.segs.length < 2 || p.waist > 0);
  const outline = useMemo(() => (valid ? bodyOutline(p) : []), [p, valid]);
  const widest = Math.max(...p.segs.map((s) => s.width));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const setSeg = (i: number, patch: Partial<BodyParams['segs'][number]>) => setP({ ...p, segs: p.segs.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const num = (v: string) => Number(v.replace(',', '.'));

  return (
    <div className="dialog-backdrop dim" onPointerDown={onCancel}>
      <form
        className="dialog wizard"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onOk(p);
        }}
        data-testid="body-wizard"
      >
        <h3>Egg / body</h3>
        <div className="wiz-presets">
          {BODY_PRESETS.map((pr) => (
            <button key={pr.name} type="button" className="btn ghost small" onClick={() => setP(structuredClone(pr.params))}>
              {pr.name}
            </button>
          ))}
        </div>
        <OutlinePreview pts={outline} />
        <p className="wiz-size">
          {fmt(bodyLength(p))} × {fmt(widest)} mm
        </p>
        <table className="wiz-table">
          <thead>
            <tr>
              <th>Part</th>
              <th>Length</th>
              <th>Width</th>
              <th title="Which end is the fat one">Fat end</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.segs.map((s, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input value={s.len} onChange={(e) => setSeg(i, { len: num(e.target.value) })} inputMode="decimal" aria-label={`Part ${i + 1} length`} />
                </td>
                <td>
                  <input value={s.width} onChange={(e) => setSeg(i, { width: num(e.target.value) })} inputMode="decimal" aria-label={`Part ${i + 1} width`} />
                </td>
                <td className="wiz-egg">
                  <span>L</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.05}
                    value={-s.egg}
                    onChange={(e) => setSeg(i, { egg: -Number(e.target.value) })}
                    title="Slide toward the end that should be fatter; middle = even (an ellipse)"
                    aria-label={`Part ${i + 1} fat end`}
                  />
                  <span>R</span>
                </td>
                <td>
                  {p.segs.length > 1 && (
                    <button type="button" className="icon-btn" title="Remove this part" onClick={() => setP({ ...p, segs: p.segs.filter((_, k) => k !== i) })}>
                      <X size={13} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.segs.length < MAX_SEGS && (
          <button
            type="button"
            className="btn ghost small wiz-add"
            onClick={() => {
              const last = p.segs[p.segs.length - 1];
              setP({ ...p, segs: [...p.segs, { ...last, egg: 0 }] });
            }}
          >
            <Plus size={13} /> Add a part
          </button>
        )}
        {p.segs.length > 1 && (
          <label className="field">
            <span>Waist</span>
            <input value={p.waist} onChange={(e) => setP({ ...p, waist: num(e.target.value) })} inputMode="decimal" aria-label="Waist width" />
            <em>mm</em>
          </label>
        )}
        <p className="dialog-note">Lengths run left to right. The waist is the width where two parts join. Stretch it on the board afterwards like any shape.</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!valid}>
            OK
          </button>
        </div>
      </form>
    </div>
  );
}

/** A closed outline drawn to fit a fixed box. */
export function OutlinePreview({ pts, contours, width = 420, height = 150 }: { pts?: [number, number][]; contours?: [number, number][][]; width?: number; height?: number }) {
  const loops = contours ?? (pts && pts.length ? [pts] : []);
  const all = loops.flat();
  if (!all.length) return <svg className="dialog-preview" width={width} height={height} />;
  const xs = all.map((q) => q[0]);
  const ys = all.map((q) => q[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const k = Math.min((width - 24) / (maxX - minX || 1), (height - 20) / (maxY - minY || 1));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const d = loops
    .map((l) => `M${l.map(([x, y]) => `${(width / 2 + (x - cx) * k).toFixed(1)},${(height / 2 - (y - cy) * k).toFixed(1)}`).join('L')}Z`)
    .join('');
  return (
    <svg className="dialog-preview" width={width} height={height}>
      <path d={d} fillRule="evenodd" />
    </svg>
  );
}
