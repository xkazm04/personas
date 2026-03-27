import { metricUnitForKey, type MetricUnit } from '@/features/overview/sub_usage/charts/chartConstants';

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

type TooltipValueFormatter = (value: number, unit: MetricUnit) => string;

const defaultNumberFormatter = new Intl.NumberFormat();

const defaultFormatter: TooltipValueFormatter = (value, unit) => {
  if (!Number.isFinite(value)) return '--';
  switch (unit) {
    case 'usd':
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
    case 'ms':
      return `${defaultNumberFormatter.format(value)} ms`;
    case 'tokens':
      return `${defaultNumberFormatter.format(value)} tokens`;
    case 'percent':
      return `${defaultNumberFormatter.format(value)}%`;
    default:
      return defaultNumberFormatter.format(value);
  }
};

export function ChartTooltip({
  active,
  payload,
  label,
  formatter = defaultFormatter,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  formatter?: TooltipValueFormatter;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-background/95 backdrop-blur border border-foreground/10 rounded-xl shadow-elevation-4 px-4 py-3">
      {label && <p className="text-sm text-foreground/90 mb-1.5">{label}</p>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-foreground/90">{entry.name}:</span>
          <span className="text-foreground font-medium">{formatter(entry.value, metricUnitForKey(entry.dataKey))}</span>
        </div>
      ))}
    </div>
  );
}
