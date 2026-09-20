// Coverage: how much of the rubric's weight was actually measured, against
// the floor below which there is no overall at all. The tick is the floor,
// drawn on the ring rather than written beside it.
const TAU = Math.PI * 2;

export function CoverageRing({
  coverage,
  floor,
  size = 72,
  label,
  text,
}: {
  coverage: number;
  floor: number;
  size?: number;
  label: string;
  /** The percentage, already formatted by the locale-aware helper. */
  text: string;
}) {
  const r = size / 2 - 7;
  const c = size / 2;
  const circumference = TAU * r;
  const a = floor * TAU - Math.PI / 2;
  const ok = coverage >= floor;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={ok ? 'var(--primary)' : 'var(--status-warning)'}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(circumference * Math.max(0, Math.min(1, coverage))).toFixed(1)} ${circumference.toFixed(1)}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
      <line
        x1={(c + Math.cos(a) * (r - 7)).toFixed(1)}
        y1={(c + Math.sin(a) * (r - 7)).toFixed(1)}
        x2={(c + Math.cos(a) * (r + 7)).toFixed(1)}
        y2={(c + Math.sin(a) * (r + 7)).toFixed(1)}
        stroke="var(--foreground)"
        strokeWidth="2"
      />
      <text
        x={c}
        y={c + 5}
        textAnchor="middle"
        fontSize={size > 80 ? 18 : 15}
        fontWeight={700}
        fill="var(--foreground)"
      >
        {text}
      </text>
    </svg>
  );
}

export default CoverageRing;
