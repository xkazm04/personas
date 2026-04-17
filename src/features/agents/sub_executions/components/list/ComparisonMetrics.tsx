import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { pctChange, fmtPct, deltaColor } from '../../libs/comparisonHelpers';

function deltaIcon(pct: number) {
  if (Math.abs(pct) < 5) return <Minus className="w-3 h-3 text-foreground" />;
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
    <div className="bg-secondary/30 border border-primary/10 rounded-modal px-3 py-2.5 space-y-1">
      <div className="typo-code uppercase tracking-wider text-foreground">{label}</div>
      <div className="flex items-center gap-3">
        <span className="typo-code text-foreground">{format(leftVal)}</span>
        <span className="text-foreground">{'→'}</span>
        <span className="typo-code text-foreground">{format(rightVal)}</span>
      </div>
      <div className={`flex items-center gap-1 typo-code ${deltaColor(pct, lowerIsBetter)}`}>
        {deltaIcon(pct)}
        {fmtPct(pct)}
      </div>
    </div>
  );
}
