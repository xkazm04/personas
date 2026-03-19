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
    <div className="bg-secondary/30 border border-primary/10 border-b-primary/8 rounded-xl px-3 py-2.5 space-y-1.5">
      <div className="typo-label text-muted-foreground/50">{label}</div>
      <div className="flex items-center gap-3">
        <span className="text-base font-mono tabular-nums text-foreground/90">{format(leftVal)}</span>
        <span className="text-muted-foreground/40">{'→'}</span>
        <span className="text-base font-mono tabular-nums text-foreground/90">{format(rightVal)}</span>
      </div>
      <div className={`flex items-center gap-1 typo-code ${deltaColor(pct, lowerIsBetter)}`}>
        {deltaIcon(pct)}
        {fmtPct(pct)}
      </div>
    </div>
  );
}
