import { CheckCircle2, Clock } from 'lucide-react';
import type { RecipeOutcomeTally } from '@/lib/bindings/RecipeOutcomeTally';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Run-outcome summary for a single recipe — the "is this working well enough
 * to automate?" signal.
 *
 * Renders raw counts rather than a success rate on purpose. The backend
 * (`commands/recipes/recipe_outcomes.rs`) deliberately returns counts because
 * what belongs in a success-rate denominator is a product judgement — a
 * cancelled run may or may not count against the recipe — and baking one in
 * would hide the choice. So the denominator is shown, not folded away:
 * `terminal` is the honest one (queued and running rows are not outcomes yet)
 * and `valueDelivered` is the strict bar, matching the per-execution
 * vocabulary in `display/BusinessOutcomeBadge`.
 *
 * Recipes that have never run are absent from the backend response, so this
 * renders nothing for them — an unrun recipe has no outcomes to report.
 */
export function RecipeOutcomeBadge({ tally }: { tally: RecipeOutcomeTally }) {
  const { t, tx } = useTranslation();

  // ts-rs maps the backend's `i64` counts onto TS `bigint`, but serde_json
  // puts plain JSON numbers on the wire — the annotation and the runtime value
  // disagree. Normalize once here so the comparisons below and <Numeric>'s
  // `number` prop work against either representation.
  const runs = Number(tally.runs);
  const terminal = Number(tally.terminal);
  const delivered = Number(tally.valueDelivered);
  const completed = Number(tally.completed);
  const failed = Number(tally.failed);

  if (runs === 0) return null;

  // Every run is still queued or in flight — there is no outcome to report
  // yet, and "0 of 0 delivered" would read as a failure rather than as an
  // absence.
  if (terminal === 0) {
    return (
      <div className="flex items-center gap-1.5 typo-body text-foreground">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <Numeric value={runs} unit="count" />
        <span>{t.recipes.outcome_pending}</span>
      </div>
    );
  }

  return (
    <Tooltip
      content={tx(t.recipes.outcome_breakdown, { runs, completed, failed })}
    >
      <div className="flex items-center gap-1.5 typo-body text-foreground">
        <CheckCircle2
          className={`w-3.5 h-3.5 shrink-0 ${delivered > 0 ? 'text-emerald-400' : 'text-foreground'}`}
        />
        <span className={delivered > 0 ? 'text-emerald-400' : undefined}>
          <Numeric value={delivered} unit="count" />
        </span>
        <span>{tx(t.recipes.outcome_of_runs, { terminal })}</span>
      </div>
    </Tooltip>
  );
}
