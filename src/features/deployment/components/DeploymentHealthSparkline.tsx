import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthDataPoint {
  date: string;
  count: number;
  successRate: number | null;
  cost: number;
}

interface DeploymentHealthSparklineProps {
  daily: HealthDataPoint[];
}

// ---------------------------------------------------------------------------
// Tiny SVG sparkline renderer
// ---------------------------------------------------------------------------

function MiniSparkline({
  values,
  color,
  label,
  formatValue,
}: {
  values: number[];
  color: string;
  label: string;
  formatValue: (v: number) => string;
}) {
  const W = 44;
  const H = 14;
  const PAD = 1;

  if (values.length < 2) {
    return (
      <div className="flex items-center gap-1" title={label}>
        <span className="text-[9px] text-muted-foreground/40">-</span>
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = PAD + (i / (values.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const lastVal = values[values.length - 1]!;

  return (
    <div className="flex items-center gap-1" title={`${label}: ${formatValue(lastVal)}`}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="inline-block align-middle flex-shrink-0"
      >
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composite health sparklines: success rate + volume + errors
// ---------------------------------------------------------------------------

export function DeploymentHealthSparkline({ daily }: DeploymentHealthSparklineProps) {
  const { successRates, volumes, errorCounts } = useMemo(() => {
    const sr: number[] = [];
    const vol: number[] = [];
    const errs: number[] = [];
    for (const d of daily) {
      sr.push(d.successRate != null ? d.successRate * 100 : 100);
      vol.push(d.count);
      const failCount = d.successRate != null
        ? Math.round(d.count * (1 - d.successRate))
        : 0;
      errs.push(failCount);
    }
    return { successRates: sr, volumes: vol, errorCounts: errs };
  }, [daily]);

  if (daily.length === 0) {
    return <span className="text-[10px] text-muted-foreground/40">No data</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <MiniSparkline
        values={successRates}
        color="rgb(52 211 153)"
        label="Success rate"
        formatValue={(v) => `${v.toFixed(0)}%`}
      />
      <MiniSparkline
        values={volumes}
        color="rgb(96 165 250)"
        label="Volume"
        formatValue={(v) => `${v}`}
      />
      <MiniSparkline
        values={errorCounts}
        color="rgb(248 113 113)"
        label="Errors"
        formatValue={(v) => `${v}`}
      />
    </div>
  );
}
