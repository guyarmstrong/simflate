// Small shared inputs.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { fmt } from '../model/geometry';

/** A number box that commits on Enter or when you click away. ↑ / ↓ step it
 *  by `step` (default one unit of the last digit shown) and commit at once;
 *  held, the key repeats and after a moment steps ten at a time; Shift ×10. */
export function NumField({
  label,
  value,
  onCommit,
  unit = 'mm',
  digits = 1,
  min,
  max,
  width = 72,
  step,
  title,
  testId,
  after,
}: {
  label?: ReactNode;
  value: number;
  onCommit: (v: number) => void;
  unit?: string;
  digits?: number;
  min?: number;
  max?: number;
  width?: number;
  /** What ↑ / ↓ add or take away. */
  step?: number;
  title?: string;
  testId?: string;
  /** Shown in the unit's place (e.g. a lock button). */
  after?: ReactNode;
}) {
  const [text, setText] = useState(fmt(value, digits));
  const [focused, setFocused] = useState(false);
  const held = useRef(0);
  const inc = step ?? Math.pow(10, -digits);
  useEffect(() => {
    if (!focused) setText(fmt(value, digits));
  }, [value, digits, focused]);
  const commit = () => {
    let v = Number(text.replace(',', '.'));
    if (!Number.isFinite(v)) {
      setText(fmt(value, digits));
      return;
    }
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (Math.abs(v - value) > 1e-9) onCommit(v);
    else setText(fmt(value, digits));
  };
  return (
    <label className="numfield" title={title}>
      {label && <span className="numfield-label">{label}</span>}
      <input
        style={{ width }}
        value={text}
        inputMode="decimal"
        data-testid={testId}
        onFocus={(e) => {
          setFocused(true);
          e.target.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            held.current = e.repeat ? held.current + 1 : 0;
            const typed = Number(text.replace(',', '.'));
            const mul = (e.shiftKey ? 10 : 1) * (held.current > 25 ? 10 : 1);
            let v = (Number.isFinite(typed) ? typed : value) + (e.key === 'ArrowUp' ? 1 : -1) * inc * mul;
            v = Math.round(v / inc) * inc;
            v = Number(v.toFixed(Math.max(digits, Math.ceil(-Math.log10(inc)), 0)));
            if (min !== undefined) v = Math.max(min, v);
            if (max !== undefined) v = Math.min(max, v);
            setText(fmt(v, digits));
            if (Math.abs(v - value) > 1e-9) onCommit(v);
          }
          if (e.key === 'Escape') {
            setText(fmt(value, digits));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      {after ?? (unit && <em>{unit}</em>)}
    </label>
  );
}

export function Slider({
  value,
  onChange,
  onRelease,
  min = 0,
  max = 100,
  step = 1,
  left,
  right,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  onRelease?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  left?: string;
  right?: string;
  testId?: string;
}) {
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onRelease?.(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => onRelease?.(Number((e.target as HTMLInputElement).value))}
      />
      {(left || right) && (
        <div className="slider-ends">
          <span>{left}</span>
          <span>{right}</span>
        </div>
      )}
    </div>
  );
}

/** The standard slider row (Guy): the bar, with a box to type the exact
 *  value at its right on the same row, and the two ends' labels under the
 *  bar. `value` is in the units shown in the box; `log` spaces the bar
 *  logarithmically between min and max (for ranges like 0.1–3 mm). */
export function SliderField({
  value,
  onChange,
  onRelease,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
  log,
  left,
  right,
  unit = '',
  digits = 0,
  width = 46,
  testId,
  fieldTestId,
  typedMin,
  arrowStep,
  after,
}: {
  value: number;
  onChange: (v: number) => void;
  onRelease?: (v: number) => void;
  /** A typed value; defaults to onRelease, then onChange. */
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  log?: boolean;
  left?: string;
  right?: string;
  unit?: string;
  digits?: number;
  width?: number;
  testId?: string;
  fieldTestId?: string;
  /** Typed values may go below the slider's range (down to this). */
  typedMin?: number;
  /** What ↑ / ↓ in the box add (default: the slider's step, or one unit
   *  of the last digit on a log slider). */
  arrowStep?: number;
  /** Shown in the unit's place (e.g. a lock button). */
  after?: ReactNode;
}) {
  const toPos = (v: number) => (log ? (100 * Math.log(Math.min(max, Math.max(min, v)) / min)) / Math.log(max / min) : v);
  const fromPos = (p: number) => (log ? min * Math.pow(max / min, p / 100) : p);
  return (
    <div className="row-field">
      <Slider
        value={toPos(value)}
        min={log ? 0 : min}
        max={log ? 100 : max}
        step={log ? 0.5 : step}
        onChange={(p) => onChange(fromPos(p))}
        onRelease={onRelease && ((p) => onRelease(fromPos(p)))}
        left={left}
        right={right}
        testId={testId}
      />
      <NumField
        value={value}
        onCommit={onCommit ?? onRelease ?? onChange}
        // Always keep the unit's space so the boxes line up down the panel.
        unit={unit || ' '}
        digits={digits}
        min={typedMin ?? min}
        max={max}
        width={width}
        step={arrowStep ?? (log ? undefined : step)}
        testId={fieldTestId}
        after={after}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  small,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <div className={`segmented${small ? ' small' : ''}`}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} title={o.title} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A drop-down list. Options marked `disabled` show but can't be picked. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <span className="dropdown">
      <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function Toggle({ checked, onChange, label, testId }: { checked: boolean; onChange: (b: boolean) => void; label: ReactNode; testId?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="track">
        <span className="thumb" />
      </span>
      <span>{label}</span>
    </label>
  );
}

/** A small ⓘ that shows `text` on hover (the panel's descriptions live here,
 *  so they don't take room — Guy, session 16). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span className="info-tip" title={text} aria-label={text}>
      <Info size={12} />
    </span>
  );
}

/** One setting on one line: label (with its ⓘ) on the left, the control on
 *  the right — a slider and its number box, a switch, a field. `wide`: the
 *  label takes the row's free width (a switch needs little room). A "\n"
 *  in the label breaks it onto two lines. */
export function SetRow({ label, info, wide, children }: { label: string; info?: string; wide?: boolean; children: ReactNode }) {
  const twoLine = label.includes('\n');
  const plain = label.replace(/\n/g, ' ');
  return (
    <div className={wide ? 'set-row wide' : 'set-row'}>
      <span className="set-label" title={info ? `${plain}: ${info}` : plain}>
        <span className={twoLine ? 'set-name two-line' : 'set-name'}>{label}</span>
        {info && <InfoTip text={info} />}
      </span>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

/** The label column of the settings rows (`SetRow`) in each panel is as wide
 *  as the longest label showing there — not a fixed 112 px — so the sliders
 *  get the rest (Guy, session 20). Which rows show changes with the solver,
 *  Auto Shape Detection and so on, so it's measured again whenever a panel's
 *  rows change. Sets `--label-w` on each `.panel`. */
export function installLabelColumns() {
  let queued = false;
  const measure = () => {
    queued = false;
    document.querySelectorAll<HTMLElement>('.panel').forEach((panel) => {
      let widest = 0;
      panel.querySelectorAll<HTMLElement>('.set-row:not(.wide) > .set-label').forEach((label) => {
        if (label.offsetParent === null) return; // hidden (unused by this solver, closed section)
        const name = label.querySelector<HTMLElement>('.set-name');
        if (!name) return;
        // Its full width, measured on the page (real font and spacing): let
        // it take its natural width for a moment. (Style changes aren't
        // watched below, so this doesn't set off another measure.)
        const was = name.style.cssText;
        name.style.cssText = 'width: max-content; max-width: none; overflow: visible; flex: none';
        const text = name.getBoundingClientRect().width;
        name.style.cssText = was;
        const tip = label.querySelector<HTMLElement>('.info-tip');
        widest = Math.max(widest, text + (tip ? 4 + tip.offsetWidth : 0));
      });
      const w = widest > 0 ? `${Math.ceil(widest) + 2}px` : '';
      if (panel.style.getPropertyValue('--label-w') !== w) panel.style.setProperty('--label-w', w);
    });
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(measure);
  };
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', queue);
  void document.fonts?.ready.then(queue);
  queue();
}
