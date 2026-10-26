// A proper-size colour picker: saturation/brightness square, hue strip, hex
// box and preset swatches. Used for PVD and the iridescent two-tone; the
// Render background uses the small swatch that opens it on a click.

import { useEffect, useRef, useState } from 'react';

type HSV = [number, number, number];

export function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max > 0 ? d / max : 0, max];
}

export function hsvToHex([h, s, v]: HSV): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

/** Drag inside an element; reports the pointer position as 0–1 fractions. */
function useDrag(onMove: (fx: number, fy: number) => void, onUp?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const handler = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onMove(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };
  return {
    ref,
    onPointerDown: (e: React.PointerEvent) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      handler(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.buttons & 1) handler(e);
    },
    onPointerUp: () => onUp?.(),
  };
}

interface Props {
  value: string;
  onChange: (hex: string) => void;
  presets?: { name: string; color: string }[];
  /** A colour has been settled on (square released, preset clicked, hex + Enter). */
  onDone?: () => void;
  /** Presets spaced out with their names under them. */
  labelled?: boolean;
  /** Presets drawn as metal (a sheen across the colour). */
  metallic?: boolean;
}

export function ColorPicker({ value, onChange, presets, onDone, labelled, metallic }: Props) {
  // Keep hue/saturation while dragging through black or grey (hex loses them).
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  useEffect(() => {
    if (hsvToHex(hsv).toLowerCase() !== value.toLowerCase()) setHsv(hexToHsv(value));
    setText(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const set = (next: HSV) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };
  const square = useDrag((fx, fy) => set([hsv[0], fx, 1 - fy]), onDone);
  const hue = useDrag((fx) => set([Math.min(359.9, fx * 360), hsv[1], hsv[2]]));
  const pure = hsvToHex([hsv[0], 1, 1]);

  return (
    <div className="cpick">
      <div className="cpick-square" {...square} style={{ background: pure }} data-testid="cpick-square">
        <div className="cpick-white" />
        <div className="cpick-black" />
        <span className="cpick-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: value }} />
      </div>
      <div className="cpick-hue" {...hue}>
        <span className="cpick-hue-knob" style={{ left: `${(hsv[0] / 360) * 100}%`, background: pure }} />
      </div>
      <div className="cpick-row">
        <span className="cpick-chip" style={{ background: value }} />
        <input
          className="cpick-hex"
          value={text}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            const v = e.target.value.trim();
            if (/^#?[0-9a-f]{6}$/i.test(v)) onChange(v.startsWith('#') ? v : `#${v}`);
          }}
          onKeyDown={(e) => e.key === 'Enter' && onDone?.()}
          data-testid="cpick-hex"
        />
      </div>
      {presets && (
        <div className={`cpick-presets${labelled ? ' labelled' : ''}`}>
          {presets.map((p) => {
            const bg = metallic ? `linear-gradient(135deg, #fff9 0%, ${p.color} 38%, ${p.color} 62%, #0007 100%)` : p.color;
            const on = p.color.toLowerCase() === value.toLowerCase();
            const pick = () => {
              onChange(p.color);
              onDone?.();
            };
            return labelled ? (
              <button key={p.color} className={`cpick-named${on ? ' on' : ''}`} title={p.name} onClick={pick}>
                <span className="cpick-preset" style={{ background: bg }} />
                <span className="cpick-name">{p.name}</span>
              </button>
            ) : (
              <button key={p.color} className={`cpick-preset${on ? ' on' : ''}`} style={{ background: bg }} title={p.name} onClick={pick} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A small colour square: click it to open the picker under it; picking a
 *  colour (or clicking anywhere else) closes it again. */
export function ColorSwatch({ value, onChange, presets, title, testId }: Props & { title?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="cswatch" ref={ref}>
      <button className={`cswatch-btn${open ? ' on' : ''}`} style={{ background: value }} onClick={() => setOpen(!open)} title={title ?? value} data-testid={testId} />
      {open && (
        <div className="cswatch-pop">
          <ColorPicker value={value} onChange={onChange} presets={presets} onDone={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
