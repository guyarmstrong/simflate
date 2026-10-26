// Snapshots → Render: light the piece in a studio and save the current view
// as a picture. No cameras: orbit to the view you want, then Render.

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Download, ImageDown, X } from 'lucide-react';
import { useApp } from '../state/store';
import { useLibrary } from '../library/library';
import { ASPECTS, outputSize, renderHook, useRender, type Backdrop } from '../viewer/renderStore';
import { allStudios, studioById, type StudioDef } from '../viewer/studio';
import { importHdris, removeHdri, restoreHdris } from '../viewer/customHdri';
import { studioPreview } from '../viewer/studioPreview';
import { saveFiles } from '../io/files';
import { ColorSwatch } from './ColorPicker';
import { Segmented, SetRow, SliderField } from './controls';
import { PositionControls } from './PositionControls';

const BACKDROPS: { value: Backdrop; label: string; title: string }[] = [
  { value: 'studio', label: 'Studio', title: "The studio's own backdrop" },
  { value: 'black', label: 'Black', title: 'Black' },
  { value: 'white', label: 'White', title: 'White' },
  { value: 'colour', label: 'Colour', title: 'Pick a colour' },
  { value: 'transparent', label: 'Clear', title: 'See-through (PNG only)' },
];

// Bring back the HDRIs you imported before.
void restoreHdris();

export function RenderSection() {
  const r = useRender();
  const view = useLibrary((s) => s.view);
  const showToast = useApp((s) => s.showToast);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancel = useRef(false);

  const ratio = ASPECTS.find((a) => a.id === r.aspect)?.ratio ?? renderHook.viewAspect();
  const [w, h] = outputSize(r.size, ratio);

  const go = async () => {
    if (!renderHook.render || !view) {
      showToast('Pick a form first, then Render.');
      return;
    }
    setBusy(true);
    setProgress(0);
    cancel.current = false;
    try {
      const shape = ASPECTS.find((a) => a.id === r.aspect)?.ratio ?? renderHook.viewAspect();
      const [w, h] = outputSize(r.size, shape);
      const mime = r.format === 'png' ? 'image/png' : 'image/jpeg';
      const blob = await renderHook.render(
        w,
        h,
        mime,
        (d, t) => setProgress(d / t),
        () => cancel.current,
      );
      if (cancel.current) {
        showToast('Render cancelled.');
        return;
      }
      if (!blob) throw new Error('nothing drawn');
      const base = view.name.replace(/[^\w\- .]+/g, '').trim() || 'simflate';
      const name = `${base} - ${studioById(r.studio).name} ${w}x${h}.${r.format === 'png' ? 'png' : 'jpg'}`;
      const where = await saveFiles([{ name, data: blob, type: mime }]);
      if (where) showToast(`Saved ${name} to ${where}.`);
    } catch (e) {
      showToast(`Render failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="render-section">
      <div className="render-body">
        <PositionControls />

        <label className="sub-label">Studio</label>
        <StudioPicker />

        {/* One row per setting, as in the Inflate panel (Guy: no scrolling). */}
        <SetRow label="Light angle" info="Turns the studio's lights round the piece, −180° (left) … 180° (right).">
          <SliderField value={r.angle} min={-180} max={180} onChange={(v) => r.set({ angle: v })} unit="°" testId="render-angle" />
        </SetRow>
        <SetRow label="Light height" info="−1: low, grazing light … 1: overhead.">
          <SliderField value={r.height} min={-1} max={1} step={0.02} digits={2} onChange={(v) => r.set({ height: v })} testId="render-height" />
        </SetRow>
        <SetRow label="Brightness" info="Darker … brighter, in stops.">
          <SliderField value={r.exposure} min={-1.5} max={1.5} step={0.1} digits={1} onChange={(v) => r.set({ exposure: v })} />
        </SetRow>
        <SetRow label="Light edges" info="0: crisp edges on the studio lights' reflections … 1: soft.">
          <SliderField value={r.softness} min={0} max={1} step={0.05} digits={2} onChange={(v) => r.set({ softness: v })} testId="render-softness" />
        </SetRow>

        <label className="sub-label">Background</label>
        <Segmented small value={r.backdrop} options={BACKDROPS} onChange={(v) => r.set({ backdrop: v })} />
        {/* Its own line under the switch (beside it, it ran off the panel's edge). */}
        {r.backdrop === 'colour' && (
          <div className="render-colour-row">
            <ColorSwatch value={r.colour} onChange={(c) => r.set({ colour: c })} title="Background colour — click to change" testId="render-colour" />
            <span>Background colour</span>
          </div>
        )}

        <label className="sub-label">Shape</label>
        <Segmented small value={r.aspect} options={ASPECTS.map((a) => ({ value: a.id, label: a.label }))} onChange={(v) => r.set({ aspect: v })} />
        <div className="render-row">
          <Segmented
            small
            value={String(r.size) as '1024' | '2048'}
            options={[
              { value: '1024', label: '1K' },
              { value: '2048', label: '2K' },
            ]}
            onChange={(v) => r.set({ size: Number(v) as 1024 | 2048 })}
          />
          <Segmented
            small
            value={r.format}
            options={[
              { value: 'png', label: 'PNG' },
              {
                value: 'jpeg',
                label: 'JPEG',
                title: r.backdrop === 'transparent' ? 'JPEG has no see-through background' : undefined,
              },
            ]}
            onChange={(v) => r.set({ format: v })}
          />
        </div>
        <div className="render-foot">
        {busy ? (
          <div className="render-progress" data-testid="render-progress">
            <div className="render-bar">
              <div style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="render-progress-row">
              <span>{progress < 0.05 ? 'Building full-quality lighting…' : `Rendering ${Math.round(progress * 100)} %`}</span>
              <button className="btn" onClick={() => (cancel.current = true)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="btn primary render-go" onClick={go} disabled={!view} data-testid="render-go">
            <ImageDown size={14} /> Render {w} × {h}
          </button>
        )}
        </div>
      </div>
    </section>
  );
}

/** The chrome-ball picture of a studio (made once, then cached). */
function Thumb({ def }: { def: StudioDef }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    studioPreview(def)
      .then((u) => live && setSrc(u))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def.id, def.hdri]);
  return src ? <img className="studio-thumb" src={src} alt="" /> : <span className="studio-thumb" />;
}

const groupOf = (s: StudioDef) => s.group ?? 'Studios';

/** Step to the next / previous studio (built-in ones, then yours). */
function stepStudio(d: number) {
  const all = allStudios();
  const i = Math.max(
    0,
    all.findIndex((s) => s.id === useRender.getState().studio),
  );
  useRender.getState().set({ studio: all[(i + d + all.length) % all.length].id });
}

/** Studio dropdown with previews, ◀ ▶ to step through ([ and ] keys too), and Import HDRI. */
function StudioPicker() {
  const r = useRender();
  const showToast = useApp((s) => s.showToast);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // useRender() re-renders this when your HDRIs change.
  const list = allStudios();
  const current = studioById(r.studio);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
      if (e.key === '[' || e.key === ']') {
        e.preventDefault();
        stepStudio(e.key === ']' ? 1 : -1);
      } else if (e.key === 'Escape') setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, []);

  // The open list reaches down to just above the Render button (Guy).
  useLayoutEffect(() => {
    const m = menu.current;
    if (!open || !m) return;
    const fit = () => {
      const go = document.querySelector('[data-testid=render-go]');
      const bottom = go ? go.getBoundingClientRect().top - 8 : window.innerHeight - 16;
      m.style.maxHeight = `${Math.max(200, bottom - m.getBoundingClientRect().top)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [open]);

  return (
    <div className="studio-picker" ref={box}>
      <div className="studio-bar">
        <button className="icon-btn" onClick={() => stepStudio(-1)} title="Previous studio ( [ )" data-testid="studio-prev">
          <ChevronLeft size={16} />
        </button>
        <button className={`studio-current${open ? ' on' : ''}`} onClick={() => setOpen(!open)} title={current.hint} data-testid="studio-menu">
          <Thumb def={current} />
          <span className="studio-name">{current.name}</span>
          <ChevronDown size={14} />
        </button>
        <button className="icon-btn" onClick={() => stepStudio(1)} title="Next studio ( ] )" data-testid="studio-next">
          <ChevronRight size={16} />
        </button>
      </div>
      {open && (
        <div className="studio-menu" ref={menu} data-testid="studio-list">
          {list.map((s, i) => (
            <Fragment key={s.id}>
              {(i === 0 || groupOf(list[i - 1]) !== groupOf(s)) && <div className="studio-group">{groupOf(s)}</div>}
              <div className={`studio-item${s.id === r.studio ? ' on' : ''}`}>
                <button className="studio-pick" onClick={() => r.set({ studio: s.id })} title={s.hint} data-testid={`studio-${s.id}`}>
                  <Thumb def={s} />
                  <span className="studio-name">{s.name}</span>
                </button>
                {s.id.startsWith('hdri:') && (
                  <button className="icon-btn studio-remove" onClick={() => void removeHdri(s.id.slice(5))} title={`Remove ${s.hint}`}>
                    <X size={13} />
                  </button>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      )}
      <button
        className="btn studio-import"
        onClick={() => fileInput.current?.click()}
        title="Add your own HDRIs (.hdr or .exr); pick several at once. They join the studio list."
        data-testid="hdri-import"
      >
        <Download size={14} /> Import HDRI…
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".hdr,.exr,.jpg,.jpeg,.png"
        hidden
        data-testid="hdri-file"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          importHdris(files)
            .then((n) => showToast(`Added ${n} HDRI${n > 1 ? 's' : ''}. Step through with the arrows or the [ and ] keys.`))
            .catch((err) => showToast(`Could not use that HDRI: ${String((err as Error)?.message ?? err)}`));
        }}
      />
    </div>
  );
}
