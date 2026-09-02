import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { pctChange, fmtPct, deltaColor } from '../../libs/comparisonHelpers';

function deltaIcon(pct: number) {
  if (Math.abs(pct) < 5) return <Minus className="w-3 h-3 text-foreground" />;
  if (pct < 0) return <TrendingDown className="w-3 h-3 text-emerald-400" />;
  return <TrendingUp className="w-3 h-3 text-amber-400" />;
}

/** An absence, not a measurement. */
const EM_DASH = '—';

export function MetricDeltaCard({
  label,
  leftVal,
  rightVal,
  format,
  lowerIsBetter = true,
}: {
  label: string;
  /** `null` when the metric was never measured — rendered as an em dash. */
  leftVal: number | null;
  rightVal: number | null;
  format: (v: number) => string;
  lowerIsBetter?: boolean;
}) {
  // A delta between two numbers needs two numbers. `duration_ms` is nullable
  // (a run that never started, or one whose end was never recorded) and this
  // card used to be handed `?? 0` in its place — which `pctChange` reads as a
  // 0 -> N growth and hardcodes to +100%, so an UNMEASURED duration was
  // painted as "+100%" beside an amber TrendingUp: an invented regression,
  // indistinguishable from a real one.
  const measured = leftVal !== null && rightVal !== null;
  const pct = measured ? pctChange(leftVal, rightVal) : null;
  return (
    <div className="bg-secondary/30 border border-primary/10 rounded-modal px-3 py-2.5 space-y-1">
      <div className="typo-code uppercase tracking-wider text-foreground">{label}</div>
      <div className="flex items-center gap-3">
        <span className="typo-code text-foreground">{leftVal === null ? EM_DASH : format(leftVal)}</span>
        <span className="text-foreground">{'→'}</span>
        <span className="typo-code text-foreground">{rightVal === null ? EM_DASH : format(rightVal)}</span>
      </div>
      {pct === null ? (
        <div className="flex items-center gap-1 typo-code text-foreground">{EM_DASH}</div>
      ) : (
        <div className={`flex items-center gap-1 typo-code ${deltaColor(pct, lowerIsBetter)}`}>
          {deltaIcon(pct)}
          {fmtPct(pct)}
        </div>
      )}
    </div>
  );
}
