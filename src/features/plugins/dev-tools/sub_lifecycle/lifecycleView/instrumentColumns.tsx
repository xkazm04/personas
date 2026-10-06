/**
 * VARIANT 1 (Instrument) - ledger cells. The outcome cell leads with the same
 * tick the rail's trace draws (height = outcome), the source ref is a framed
 * monospace tag, and the time is a figure.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { Translations } from '@/i18n/en';

import { outcomeLabel, sourceKindGlyph, sourceKindLabel } from '../journey/journeyLabels';
import { OUTCOME_TEXT } from '../journey/journeyStyles';
import { TICK } from './InstrumentRail';
import { ledgerColumns } from './variantColumns';

/** Nothing was recorded: a mark, so the cell reads empty rather than as a value. */
const ABSENT = '·';

export function instrumentColumns(t: Translations) {
  const dl = t.plugins.dev_lifecycle;
  return ledgerColumns(t, {
    outcome: (row) => (
      <span className="flex items-center gap-2 min-w-0">
        <span className="flex h-3 w-1 items-end" aria-hidden>
          <span className={`block w-1 ${TICK[row.outcome]}`} />
        </span>
        <span className={`${row.outcome === 'done' ? 'typo-body' : 'typo-heading'} truncate ${OUTCOME_TEXT[row.outcome]}`}>
          {outcomeLabel(dl, row.outcome)}
        </span>
      </span>
    ),
    title: (row) => <span className="typo-body text-foreground truncate block">{row.item.title}</span>,
    source: (row) => {
      const Glyph = sourceKindGlyph(row.item.sourceKind);
      return (
        <span className="flex items-center gap-1.5 min-w-0 typo-caption">
          <Glyph className="w-3.5 h-3.5 shrink-0" aria-label={sourceKindLabel(dl, row.item.sourceKind)} />
          <span className="typo-code truncate rounded-interactive border border-primary/15 px-1.5">
            {row.item.sourceRef.slice(0, 8)}
          </span>
        </span>
      );
    },
    when: (row) => (
      <span className="typo-data tabular-nums">
        <RelativeTime timestamp={row.item.occurredAt} />
      </span>
    ),
    detail: (row) =>
      row.detail
        ? <span className="typo-caption truncate block">{row.detail}</span>
        : <span className="typo-caption" aria-label={dl.lc_outcome_unknown}>{ABSENT}</span>,
  });
}
