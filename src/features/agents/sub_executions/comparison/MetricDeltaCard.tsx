import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { pctChange, fmtPct, deltaColor } from './comparisonHelpers';

function deltaIcon(pct: number) {
  if (Math.abs(pct) < 5) return <Minus className="w-3 h-3 text-muted-foreground/60" />;
  if (pct < 0) return <TrendingDown className="w-3 h-3 text-emerald-400" />;
  return <TrendingUp className="w-3 h-3 text-amber-400" />;
}

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
      <div className="text-xs uppercase tracking-wider text-muted-foreground/50">{label}</div>
      <div className="flex items-center gap-3">
        <span className="text-base font-mono tabular-nums text-foreground/90">{format(leftVal)}</span>
        <span className="text-muted-foreground/40">&rarr;</span>
        <span className="text-base font-mono tabular-nums text-foreground/90">{format(rightVal)}</span>
      </div>
      <div className={`flex items-center gap-1 text-sm font-mono ${deltaColor(pct, lowerIsBetter)}`}>
        {deltaIcon(pct)}
        {fmtPct(pct)}
      </div>
    </div>
  );
}
