import { pctChange, fmtPct, deltaIcon, deltaColor } from './comparisonHelpers';

export function MetricDeltaCard({
  label,
  leftVal,
  rightVal,
  format,
  lowerIsBetter = true,
}: {
  label: string;
  leftVal: number;
  rightVal: number;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  const pct = pctChange(leftVal, rightVal);
  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-xl px-3 py-2.5 space-y-1">
      <div className="text-sm uppercase tracking-wider text-muted-foreground/60 font-mono">{label}</div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-mono text-foreground/80">{format(leftVal)}</span>
        <span className="text-muted-foreground/40">→</span>
        <span className="text-sm font-mono text-foreground/80">{format(rightVal)}</span>
      </div>
      <div className={`flex items-center gap-1 text-sm font-mono ${deltaColor(pct, lowerIsBetter)}`}>
        {deltaIcon(pct)}
        {fmtPct(pct)}
      </div>
    </div>
  );
}
