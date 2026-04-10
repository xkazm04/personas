/** Inline 48x16 SVG sparkline for cost trend. No charting library needed. */
export function CostSparkline({ costs }: { costs: number[] }) {
  if (costs.length < 2) return null;

  const W = 48;
  const H = 16;
  const PAD = 1;

  const min = Math.min(...costs);
  const max = Math.max(...costs);
  const range = max - min || 1;

  const points = costs.map((c, i) => {
    const x = PAD + (i / (costs.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((c - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Highlight last point amber if it exceeds 2x the median
  const sorted = [...costs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const lastCost = costs[costs.length - 1]!;
  const isSpike = lastCost > median * 2;

  const lastX = PAD + ((costs.length - 1) / (costs.length - 1)) * (W - PAD * 2);
  const lastY = H - PAD - ((lastCost - min) / range) * (H - PAD * 2);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="inline-block align-middle flex-shrink-0"
      data-testid="cost-sparkline"
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {isSpike && (
        <circle
          cx={lastX.toFixed(1)}
          cy={lastY.toFixed(1)}
          r="2"
          fill="var(--status-warning)"
        />
      )}
    </svg>
  );
}
