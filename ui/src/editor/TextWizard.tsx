// Text wizard: type a few letters, pick a font from this computer, bold or
// not, and the height of the capitals in mm. Each letter becomes a piece.

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { listFonts, pickFace, textOutline, type FontFamily, type TextOutline } from '../io/fonts';
import { OutlinePreview } from './BodyWizard';
import { fmt } from '../model/geometry';
import { Toggle } from '../ui/controls';

export interface TextResult {
  outline: TextOutline;
  text: string;
  family: string;
  bold: boolean;
  height: number;
}

/** Kept for the next time the wizard opens. */
const last = { text: 'A', family: '', bold: true, height: 300 };

export function TextWizard({ onOk, onCancel }: { onOk: (r: TextResult) => void; onCancel: () => void }) {
  const [fonts, setFonts] = useState<FontFamily[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(last.text);
  const [family, setFamily] = useState(last.family);
  const [bold, setBold] = useState(last.bold);
  const [height, setHeight] = useState(String(last.height));
  const [outline, setOutline] = useState<TextOutline | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listFonts()
      .then((f) => {
        setFonts(f);
        if (!f.some((x) => x.name === family)) setFamily(f.find((x) => x.name === 'Arial')?.name ?? f[0]?.name ?? '');
      })
      .catch((e) => setError(String((e as Error)?.message ?? e)));
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fam = fonts?.find((f) => f.name === family) ?? null;
  const hasBold = !!fam && pickFace(fam, true) !== null;
  const face = fam ? pickFace(fam, bold && hasBold) : null;
  const h = Number(height.replace(',', '.'));
  const letters = [...text.replace(/\s/g, '')].length;

  // Live preview (a short pause after typing).
  useEffect(() => {
    if (!face || !text.trim() || !(h > 0)) {
      setOutline(null);
      return;
    }
    let live = true;
    const id = setTimeout(() => {
      setBusy(true);
      textOutline(face, text, h)
        .then((o) => live && (setOutline(o), setError(null)))
        .catch((e) => live && setError(String((e as Error)?.message ?? e)))
        .finally(() => live && setBusy(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [face, text, h]);

  const ok = !!outline && outline.contours.length > 0 && !busy;
  const all = outline?.contours.flat() ?? [];
  const width = all.length ? Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0])) : 0;

  return (
    <div className="dialog-backdrop dim" onPointerDown={onCancel}>
      <form
        className="dialog wizard"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok || !outline) return;
          Object.assign(last, { text, family, bold, height: h });
          onOk({ outline, text, family, bold: bold && hasBold, height: h });
        }}
        data-testid="text-wizard"
      >
        <h3>Text</h3>
        <input className="wiz-text" value={text} onChange={(e) => setText(e.target.value)} autoFocus onFocus={(e) => e.target.select()} placeholder="Type a few letters" maxLength={24} aria-label="Text" />
        {letters > 1 && (
          <p className="wiz-warn">
            <AlertTriangle size={13} /> Each letter is its own piece: {letters} letters may take a long time to inflate.
          </p>
        )}
        <label className="field wide">
          <span>Font</span>
          <select value={family} onChange={(e) => setFamily(e.target.value)} disabled={!fonts} aria-label="Font">
            {!fonts && <option>Loading fonts…</option>}
            {fonts?.map((f) => (
              <option key={f.name} value={f.name}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className={`wiz-bold${hasBold ? '' : ' off'}`}>
          <Toggle checked={bold && hasBold} onChange={(b) => hasBold && setBold(b)} label={fam && !hasBold ? 'Bold (not in this font)' : 'Bold'} />
        </div>
        <label className="field">
          <span>Height</span>
          <input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" aria-label="Letter height" />
          <em>mm</em>
        </label>
        <p className="dialog-note">Height of the capital letters. Scale it on the board afterwards with the Height box.</p>
        <OutlinePreview contours={outline?.contours} />
        <p className="wiz-size">{outline ? `${fmt(width)} mm wide` : ' '}</p>
        {outline?.missing && <p className="wiz-warn">Not in this font, left out: {outline.missing}</p>}
        {error && <p className="wiz-warn">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok}>
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
