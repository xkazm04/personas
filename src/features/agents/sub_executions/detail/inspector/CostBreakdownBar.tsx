import { estimateCost } from '@/lib/utils/platform/pricing';
import { formatCost } from './inspectorTypes';
import { useTranslation } from '@/i18n/useTranslation';

export function CostBreakdownBar({ model, inputTokens, outputTokens }: { model: string; inputTokens: number; outputTokens: number }) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const { inputCost, outputCost, totalCost, estimated } = estimateCost(model, inputTokens, outputTokens);
  const inputPct = totalCost > 0 ? (inputCost / totalCost) * 100 : 50;
  const outputPct = totalCost > 0 ? (outputCost / totalCost) * 100 : 50;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="typo-code text-muted-foreground/80 uppercase tracking-wider">{e.cost_breakdown}</div>
        {estimated && (
          <span className="typo-heading px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400/80">
            {e.unknown_model_pricing}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 typo-code">
        <span className="text-blue-400">{tx(e.input_label, { cost: formatCost(inputCost) })}</span>
        <span className="text-muted-foreground/80">|</span>
        <span className="text-amber-400">{tx(e.output_label, { cost: formatCost(outputCost) })}</span>
        <span className="text-muted-foreground/80">|</span>
        <span className="text-foreground/90">{tx(e.total_label, { cost: formatCost(totalCost) })}</span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden bg-secondary/60 border border-primary/10 flex">
        <div
          className="h-full bg-blue-500/40 transition-all"
          style={{ width: `${inputPct}%` }}
        />
        <div
          className="h-full bg-amber-500/40 transition-all"
          style={{ width: `${outputPct}%` }}
        />
      </div>
      <div className="flex justify-between typo-code text-muted-foreground/80">
        <span>{tx(e.input_pct, { percent: inputPct.toFixed(0) })}</span>
        <span>{tx(e.output_pct, { percent: outputPct.toFixed(0) })}</span>
      </div>
    </div>
  );
}
