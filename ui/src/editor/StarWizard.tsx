// Pebble / star wizard: opens as soon as the tool is picked (nothing to
// draw). Presets at the top, a live preview, then the controls that move one
// shape between pebble, starfish and star (see model/star.ts). The first
// time it opens on Pebble, to show that a "star" tool makes pebbles too.

import { useEffect, useMemo, useState } from 'react';
import { Shuffle } from 'lucide-react';
import { STAR_PRESETS, starOutline, type EdgeStyle, type StarParams } from '../model/star';
import { boxHeight, boxOf, boxWidth, fmt } from '../model/geometry';
import { Segmented, SetRow, SliderField } from '../ui/controls';
import { OutlinePreview } from './BodyWizard';

interface Props {
  initial: StarParams;
  onOk: (p: StarParams) => void;
  onCancel: () => void;
}

const CUSTOM = 'Pebble / star';

export function StarWizard({ initial, onOk, onCancel }: Props) {
  const [p, setP] = useState<StarParams>(initial);
  const outline = useMemo(() => starOutline(p), [p]);
  const box = boxOf(outline);
  // Any change after a preset makes it the user's own shape.
  const set = (patch: Partial<StarParams>) => setP((q) => ({ ...q, ...patch, name: CUSTOM }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop dim" onPointerDown={onCancel}>
      <form
        className="dialog wizard star-wizard"
        onPointerDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onOk(p);
        }}
        data-testid="star-wizard"
      >
        <h3>Pebble / star</h3>
        <div className="wiz-presets">
          {STAR_PRESETS.map((pr) => (
            <button
              key={pr.name}
              type="button"
              className={`btn ghost small${p.name === pr.name ? ' on' : ''}`}
              // A preset keeps the size you've set.
              onClick={() => setP({ ...pr, size: p.size })}
            >
              {pr.name}
            </button>
          ))}
        </div>
        <OutlinePreview pts={outline} width={484} height={210} />
        <p className="wiz-size">
          {fmt(boxWidth(box))} × {fmt(boxHeight(box))} mm
        </p>
        <SetRow label="Points" info="How many tips (or lobes, on a pebble): 2–24.">
          <SliderField value={p.points} min={2} max={24} onChange={(v) => set({ points: Math.round(v) })} testId="star-points" />
        </SetRow>
        <SetRow label="Size" info="Across the tips, mm. Scale it on the board afterwards like any shape.">
          <SliderField value={p.size} log min={20} max={2000} onChange={(v) => set({ size: Math.round(v) })} unit="mm" testId="star-size" />
        </SetRow>
        <SetRow label="Inner" info="Valleys as a % of the tips. Near 100: a pebble or rounded polygon. Low: long arms.">
          <SliderField value={p.inner} min={5} max={100} step={0.5} digits={1} onChange={(v) => set({ inner: v })} unit="%" testId="star-inner" />
        </SetRow>
        <SetRow label="Tip rounding" info="0: sharp tips. 100: fully rounded.">
          <SliderField value={p.tipRound} onChange={(v) => set({ tipRound: v })} unit="%" />
        </SetRow>
        <SetRow label="Valley rounding" info="0: sharp valleys. 100: fully rounded.">
          <SliderField value={p.valleyRound} onChange={(v) => set({ valleyRound: v })} unit="%" />
        </SetRow>
        <SetRow label="Edges" info="Sharp: straight. Rounded: bowed out (pebbles). Flowing: bowed in (starfish arms). Wavy: an S.">
          <Segmented<EdgeStyle>
            small
            value={p.edge}
            onChange={(v) => set({ edge: v })}
            options={[
              { value: 'sharp', label: 'Sharp' },
              { value: 'rounded', label: 'Rounded' },
              { value: 'flowing', label: 'Flowing' },
              { value: 'wavy', label: 'Wavy' },
            ]}
          />
        </SetRow>
        <SetRow label="Edge curve" info="How far the edges bow (not used with Sharp).">
          <SliderField value={p.curvature} onChange={(v) => set({ curvature: v })} unit="%" />
        </SetRow>
        <SetRow label="Organic" info="0: regular. Higher: tips, valleys and spacing vary from one to the next, like a real pebble or starfish.">
          <SliderField value={p.variation} onChange={(v) => set({ variation: v })} unit="%" testId="star-variation" />
        </SetRow>
        <button type="button" className="btn ghost small wiz-add" disabled={!p.variation} onClick={() => set({ seed: p.seed + 1 })} title="Another variation with the same settings">
          <Shuffle size={13} /> New variation
        </button>
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
