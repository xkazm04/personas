// The subject's rounds against the threshold, so a reader can see whether
// the council is converging or stalling before reading a single number.
//
// A round with no overall is drawn as a dashed empty circle labelled "no
// overall": a round that could not be scored is not a round that scored
// zero.
export interface RoundPoint {
  roundNo: number;
  /** Null when coverage never cleared the floor. Never 0. */
  overall: number | null;
  runId: string;
}

export function RoundHistory({
  points,
  threshold,
  currentRound,
  width = 236,
  height = 92,
  label,
  noOverallLabel,
  roundLabel,
  onPickRound,
}: {
  points: RoundPoint[];
  threshold: number;
  currentRound: number;
  width?: number;
  height?: number;
  label: string;
  noOverallLabel: string;
  /** `round {n}` already interpolated per point, indexed by round number. */
  roundLabel: (roundNo: number) => string;
  onPickRound?: (runId: string) => void;
}) {
  const px = (k: number) => (points.length === 1 ? width / 2 : 42 + (k * (width - 84)) / (points.length - 1));
  const py = (v: number) => height - 30 - v * (height - 52);
  const line = points
    .map((p, k) => (p.overall == null ? null : `${px(k)},${py(p.overall)}`))
    .filter((s): s is string => s !== null);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line
        x1="6"
        x2={width - 6}
        y1={py(threshold)}
        y2={py(threshold)}
        stroke="var(--muted-foreground)"
        strokeOpacity="0.55"
        strokeDasharray="4 4"
      />
      {line.length > 1 ? (
        <polyline points={line.join(' ')} fill="none" stroke="var(--primary)" strokeWidth="2.5" />
      ) : null}
      {points.map((p, k) => {
        const x = px(k);
        const current = p.roundNo === currentRound;
        const clickable = points.length > 1 && onPickRound;
        return (
          <g
            key={p.runId}
            onClick={clickable ? () => onPickRound(p.runId) : undefined}
            style={clickable ? { cursor: 'pointer' } : undefined}
          >
            {p.overall == null ? (
              <>
                <circle
                  cx={x}
                  cy={height - 44}
                  r="7"
                  fill="none"
                  stroke="var(--muted-dark)"
                  strokeDasharray="2.5 3"
                  strokeWidth="1.6"
                />
                <text x={x} y={height - 56} textAnchor="middle" fontSize="13" fill="var(--muted-dark)">
                  {noOverallLabel}
                </text>
              </>
            ) : (
              <>
                <circle
                  cx={x}
                  cy={py(p.overall)}
                  r={current ? 8 : 6}
                  fill={p.overall >= threshold ? 'var(--primary)' : 'var(--status-warning)'}
                  stroke="var(--background)"
                  strokeWidth="2"
                />
                <text
                  x={x}
                  y={py(p.overall) - 14}
                  textAnchor="middle"
                  fontSize="15"
                  fontWeight="700"
                  fill="var(--foreground)"
                >
                  {p.overall.toFixed(2)}
                </text>
              </>
            )}
            <text
              x={x}
              y={height - 6}
              textAnchor="middle"
              fontSize="13"
              fontWeight={current ? 700 : 500}
              fill={current ? 'var(--foreground)' : 'var(--muted-dark)'}
            >
              {roundLabel(p.roundNo)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default RoundHistory;
