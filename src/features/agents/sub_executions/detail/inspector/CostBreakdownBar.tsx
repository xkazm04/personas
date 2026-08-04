import { estimateCost, isSubscriptionModel } from '@/lib/utils/platform/pricing';
import { formatCost } from './inspectorTypes';
import { useTranslation } from '@/i18n/useTranslation';

export function CostBreakdownBar({
  model,
  inputTokens,
  outputTokens,
  actualCostUsd,
}: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /**
   * The run's authoritative cost — the root span's `cost_usd`, which the CLI
   * reports and the tracer stores. When present it IS the total; the pricing
   * table is then used only to derive the input/output *ratio*, never a second
   * total. That keeps this component reconciled with `TraceSummary` instead of
   * printing a competing figure for the same run.
   */
  actualCostUsd?: number | null;
}) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  // `outputCost` is deliberately not destructured: the output side is derived
  // as the complement of the input share, so the two halves always sum to the
  // displayed total instead of drifting by a rounding step.
  const { inputCost, totalCost: pricedTotal, estimated } = estimateCost(model, inputTokens, outputTokens);

  // The split is only knowable when the pricing table recognised the model and
  // the run actually priced above zero. Otherwise we show the total alone
  // rather than a fabricated 50/50 bar (the previous default), which asserted a
  // decomposition nobody measured.
  const canSplit = pricedTotal > 0;
  const totalCost = actualCostUsd ?? pricedTotal;
  const inputShare = canSplit ? inputCost / pricedTotal : 0;
  const inputPct = inputShare * 100;
  const outputPct = 100 - inputPct;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="typo-code text-foreground uppercase tracking-wider">{e.cost_breakdown}</div>
        {estimated && (
          <span className="typo-heading px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400/80">
            {e.unknown_model_pricing}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 typo-code">
        {canSplit && (
          <>
            <span className="text-blue-400">{tx(e.input_label, { cost: formatCost(totalCost * inputShare) })}</span>
            <span className="text-foreground">|</span>
            <span className="text-amber-400">{tx(e.output_label, { cost: formatCost(totalCost * (1 - inputShare)) })}</span>
            <span className="text-foreground">|</span>
          </>
        )}
        <span className="text-foreground/90">{tx(e.total_label, { cost: formatCost(totalCost) })}</span>
      </div>
      {canSplit && (
        <>
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
          <div className="flex justify-between typo-code text-foreground">
            <span>{tx(e.input_pct, { percent: inputPct.toFixed(0) })}</span>
            <span>{tx(e.output_pct, { percent: outputPct.toFixed(0) })}</span>
          </div>
        </>
      )}
      {/* Subscription-vs-API reframe: this run's cost is the Anthropic API list
          price for the same tokens — on the user's Claude subscription it's
          included, not billed. Shown only for Claude models (external-API
          models are real per-token spend). This is a reframe of the SAME
          number, not a second computation — so it can't double-count. */}
      {isSubscriptionModel(model) && totalCost > 0 && !estimated && (
        <div className="typo-caption text-emerald-400" data-testid="subscription-cost-note">
          {tx(e.subscription_cost_note, { cost: formatCost(totalCost) })}
        </div>
      )}
    </div>
  );
}
