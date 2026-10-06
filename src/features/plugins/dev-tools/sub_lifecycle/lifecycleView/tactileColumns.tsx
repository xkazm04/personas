/**
 * VARIANT 3 (Tactile) - ledger cells. The outcome is a pill chip with its bead
 * (the same bead the rail seats), and the source ref is a small raised tag with
 * the source's glyph, like a label on a part.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { Translations } from '@/i18n/en';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { outcomeLabel, sourceKindGlyph, sourceKindLabel } from '../journey/journeyLabels';
import { Bead } from './TactileKeys';
import { ledgerColumns } from './variantColumns';

const ABSENT = '·';

const CHIP: Record<LifecycleOutcome, string> = {
  done: 'border-status-success/30 bg-status-success/10 text-status-success',
  skipped: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  failed: 'border-status-error/30 bg-status-error/10 text-status-error',
  unknown: 'border-primary/15 bg-secondary/40 text-foreground',
};

export function tactileColumns(t: Translations) {
  const dl = t.plugins.dev_lifecycle;
  return ledgerColumns(t, {
    outcome: (row) => (
      <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 typo-label ${CHIP[row.outcome]}`}>
        <Bead outcome={row.outcome} />
        <span className="truncate">{outcomeLabel(dl, row.outcome)}</span>
      </span>
    ),
    title: (row) => <span className="typo-body text-foreground truncate block">{row.item.title}</span>,
    source: (row) => {
      const Glyph = sourceKindGlyph(row.item.sourceKind);
      return (
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-interactive border border-primary/15 bg-background px-1.5 py-0.5 shadow-elevation-1">
          <Glyph className="w-3.5 h-3.5 shrink-0 text-primary" aria-label={sourceKindLabel(dl, row.item.sourceKind)} />
          <span className="typo-code truncate">{row.item.sourceRef.slice(0, 8)}</span>
        </span>
      );
    },
    when: (row) => (
      <span className="typo-caption tabular-nums">
        <RelativeTime timestamp={row.item.occurredAt} />
      </span>
    ),
    detail: (row) =>
      row.detail
        ? <span className="typo-caption truncate block">{row.detail}</span>
        : <span className="typo-caption" aria-label={dl.lc_outcome_unknown}>{ABSENT}</span>,
  });
}
