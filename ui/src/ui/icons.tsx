// Icons Lucide doesn't have, drawn the same way (24 px box, round strokes,
// currentColor) so they sit beside Lucide icons.

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Svg({ size = 24, strokeWidth = 2, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A pill: full outside width and height, rounded ends. */
export function PillIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
    </Svg>
  );
}

/** Text tool: a capital A. */
export function TextIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.5 20 12 4l6.5 16" />
      <path d="M8 14h8" />
    </Svg>
  );
}

/** Forms: a blown square seen from above: edges drawn in between pinched
 *  corners, a puffed middle with a highlight, and folds at the corners. */
export function FormIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 3.5Q12 7.5 20.5 3.5Q16.5 12 20.5 20.5Q12 16.5 3.5 20.5Q7.5 12 3 3.5Z" />
      <path d="M8.6 10.2a4.6 4.6 0 0 1 4.4-2" />
      <path d="M3 3.5 6.6 7M20.5 20.5 17 17" />
    </Svg>
  );
}
