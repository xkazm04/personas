import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { ValueRollup } from '@/api/director';

/**
 * Value-leak diagnostic — decomposes the headline `valueDeliveredRate` KPI into
 * the outcome taxonomy the rollup already carries (delivered / partial / blocked
 * / no-input / unassessed). A single stacked bar shows the proportions; the
 * legend below names each band, its share, and an explanatory tooltip — so the
 * user sees *where* value leaks, not just the aggregate rate.
 */

type SegKey = 'delivered' | 'partial' | 'precondition' | 'no_input' | 'unknown';

const SEGMENTS: { key: SegKey; field: keyof ValueRollup; color: string }[] = [
  { key: 'delivered', field: 'valueDelivered', color: 'var(--status-success)' },
  { key: 'partial', field: 'partial', color: 'var(--status-warning)' },
  { key: 'precondition', field: 'preconditionFailed', color: 'var(--status-error)' },
  { key: 'no_input', field: 'noInputAvailable', color: 'var(--status-info)' },
  { key: 'unknown', field: 'unknown', color: 'var(--muted-foreground)' },
];

export function ValueLeakBar({ rollup }: { rollup: ValueRollup }) {
  const { t, tx } = useTranslation();
  const total = rollup.assessedExecutions;

  if (total === 0) {
    return <p className="typo-caption text-foreground py-2">{t.director.value_leak_empty}</p>;
  }

  const labels: Record<SegKey, string> = {
    delivered: t.director.value_leak_delivered,
    partial: t.director.value_leak_partial,
    precondition: t.director.value_leak_precondition,
    no_input: t.director.value_leak_no_input,
    unknown: t.director.value_leak_unknown,
  };
  const hints: Record<SegKey, string> = {
    delivered: t.director.value_leak_delivered_hint,
    partial: t.director.value_leak_partial_hint,
    precondition: t.director.value_leak_precondition_hint,
    no_input: t.director.value_leak_no_input_hint,
    unknown: t.director.value_leak_unknown_hint,
  };

  const segs = SEGMENTS.map((s) => {
    const count = (rollup[s.field] as number) ?? 0;
    return { ...s, count, pct: (count / total) * 100 };
  });
  const present = segs.filter((s) => s.count > 0);

  return (
    <div className="space-y-3">
      {/* Stacked proportion bar — decorative; the legend below is the semantic content. */}
      <div aria-hidden className="flex h-2.5 rounded-pill overflow-hidden bg-secondary/40">
        {present.map((s) => (
          <div
            key={s.key}
            className="h-full first:rounded-l-pill last:rounded-r-pill animate-fade-slide-in"
            style={{ width: `${s.pct}%`, background: s.color }}
          />
        ))}
      </div>

      {/* Legend — one entry per band, with its count and an explanatory tooltip. */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {segs.map((s) => (
          <Tooltip key={s.key} content={hints[s.key]}>
            <span className="inline-flex items-center gap-1.5 typo-caption text-foreground cursor-default">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
              <span>{labels[s.key]}</span>
              <Numeric value={s.count} className="text-foreground font-semibold tabular-nums" />
              <span className="text-foreground tabular-nums">
                {tx(t.director.value_leak_share, { pct: Math.round(s.pct) })}
              </span>
            </span>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
