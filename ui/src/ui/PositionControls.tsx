// Render panel → Geometry position (session 17): presets Flat / Wall /
// Standing, then Tilt (lying on its back 0° … upright 90°), Spin (turns the
// piece in its own plane, so another edge or corner comes down) and Show
// ground (the floor and a contact shadow; the piece always sits on its
// lowest point, so Wall and Standing are the same place). The camera does
// any turning round. Render only: outside it the piece lies flat with its
// usual camera; back in Render, the position and camera are as you left them.
// Exports unchanged.

import { POSITION_PRESETS, useApp, type PositionPreset } from '../state/store';
import { SetRow, SliderField, Toggle } from './controls';

const PRESETS: { id: PositionPreset; label: string; title: string }[] = [
  { id: 'flat', label: 'Flat', title: 'Lying flat on its back' },
  { id: 'wall', label: 'Wall', title: 'Upright facing you, as hung on a wall — no ground, no shadow' },
  { id: 'standing', label: 'Standing', title: 'Upright, standing on its lowest edge with a soft shadow' },
];

export function PositionControls() {
  const pos = useApp((s) => s.position);
  const setPosition = useApp((s) => s.setPosition);
  const preset = PRESETS.find((p) => {
    const q = POSITION_PRESETS[p.id];
    return q.tilt === pos.tilt && q.spin === pos.spin && q.floor === pos.floor;
  });
  return (
    <>
      <label className="sub-label">
        Geometry position <span className="preset-name">· {preset?.label ?? 'Custom'}</span>
      </label>
      <div className="segmented small position-presets" data-testid="position-presets">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className={preset?.id === p.id ? 'on' : ''} title={p.title} onClick={() => setPosition(POSITION_PRESETS[p.id], true)} data-testid={`position-${p.id}`}>
            {p.label}
          </button>
        ))}
      </div>
      <SetRow label="Tilt" info="0°: lying flat on its back … 90°: upright, facing you.">
        <SliderField value={pos.tilt} min={0} max={90} onChange={(v) => setPosition({ tilt: Math.round(v) })} unit="°" testId="position-tilt" />
      </SetRow>
      <SetRow label="Spin" info="Turns the piece in its own plane, so another edge or corner comes down. The camera does the turning round.">
        <SliderField value={pos.spin} min={-180} max={180} onChange={(v) => setPosition({ spin: Math.round(v) })} unit="°" testId="position-spin" />
      </SetRow>
      <div className="position-floor" title="On: the floor shows, with a soft shadow where the piece touches it. Off: no ground and no shadow (as on a wall). The piece stays where it is either way.">
        <span>Show ground (with shadow)</span>
        <Toggle checked={pos.floor} onChange={(b) => setPosition({ floor: b })} label="" testId="position-floor" />
      </div>
      <div className={pos.floor ? undefined : 'is-off'}>
        <SetRow label="Softness" info="Shadow softness. 0: crisp … 100: as under a big soft studio light. Sharp where the piece touches either way. Greyed out without the ground.">
          <SliderField value={Math.round(pos.softness * 100)} onChange={(v) => setPosition({ softness: v / 100 })} testId="shadow-softness" />
        </SetRow>
      </div>
    </>
  );
}
