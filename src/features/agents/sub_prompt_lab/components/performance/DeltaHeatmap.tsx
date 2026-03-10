import { fmtDate } from '../../libs/performanceHelpers';
import { type DeltaPoint, deltaCellClass, fmtDelta } from '../../libs/performanceChartTypes';

interface DeltaHeatmapProps {
  deltaSeries: DeltaPoint[];
  compALabel: string;
  compBLabel: string;
}

const heatRows = [
  { key: 'costDeltaPct' as const, label: 'Cost' },
  { key: 'latencyDeltaPct' as const, label: 'Latency' },
  { key: 'errorDeltaPct' as const, label: 'Error rate' },
];

export function DeltaHeatmap({ deltaSeries, compALabel, compBLabel }: DeltaHeatmapProps) {
  const heatmapDates = deltaSeries.slice(-14);

  return (
    <div className="col-span-2 bg-secondary/30 border border-primary/10 rounded-xl p-4">
      <h4 className="text-sm font-medium text-foreground/80 mb-3 uppercase tracking-wider">
        Comparison Delta Heatmap ({compALabel} to {compBLabel})
      </h4>
      <div className="space-y-2 overflow-x-auto">
        {heatRows.map((row) => (
          <div key={row.key} className="flex items-center gap-1.5 min-w-max">
            <div className="w-20 text-sm text-muted-foreground/70">{row.label}</div>
            {heatmapDates.map((point) => {
              const value = point[row.key];
              return (
                <div
                  key={`${row.key}-${point.date}`}
                  title={`${fmtDate(point.date)}: ${fmtDelta(value)}`}
                  className={`w-[52px] h-7 rounded border text-sm font-medium flex items-center justify-center ${deltaCellClass(value)}`}
                >
                  {fmtDelta(value)}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
