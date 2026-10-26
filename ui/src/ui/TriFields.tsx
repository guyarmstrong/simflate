// An unequal triangle's three sides and three angles, each typed on its own
// (in the size box when drawing, and in the top bar once it's drawn).

import type { Vec2 } from '../model/geometry';
import { CORNERS, SIDES, triAngles, triSides, triWithAngle, triWithSide } from '../model/triangle';
import { useApp } from '../state/store';
import { NumField } from './controls';

export function TriFields({ corners, onChange, width = 58 }: { corners: Vec2[]; onChange: (c: Vec2[]) => void; width?: number }) {
  const sides = triSides(corners);
  const angles = triAngles(corners);
  const apply = (next: Vec2[] | null) => (next ? onChange(next) : useApp.getState().showToast('That angle can’t make a triangle — keep it under 180°.'));
  return (
    <>
      {SIDES.map((name, i) => (
        <NumField key={name} label={name} value={sides[i]} min={0.1} width={width} title={`Side ${name}`} onCommit={(v) => apply(triWithSide(corners, i, v))} testId={`tri-side-${i}`} />
      ))}
      {CORNERS.map((name, i) => (
        <NumField
          key={name}
          label={`∠${name}`}
          unit={'°'}
          value={angles[i]}
          min={0.6}
          max={179}
          width={width - 6}
          title={`Angle at corner ${name}`}
          onCommit={(v) => apply(triWithAngle(corners, i, v))}
          testId={`tri-angle-${i}`}
        />
      ))}
    </>
  );
}
