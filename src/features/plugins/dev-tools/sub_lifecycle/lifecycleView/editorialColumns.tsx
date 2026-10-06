/**
 * VARIANT 2 (Editorial) - ledger cells. The outcome is a printer's mark and a
 * small-caps word, the change title carries the row, the source reads as a
 * byline ("Commit a1b2c3d4") and the step note is set as an italic aside.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { Translations } from '@/i18n/en';

import { outcomeLabel, sourceKindLabel } from '../journey/journeyLabels';
import { OUTCOME_TEXT } from '../journey/journeyStyles';
import { OutcomeMark } from './EditorialMarks';
import { ledgerColumns } from './variantColumns';

const ABSENT = '·';

export function editorialColumns(t: Translations) {
  const dl = t.plugins.dev_lifecycle;
  return ledgerColumns(t, {
    outcome: (row) => (
      <span className="flex items-center gap-2 min-w-0">
        <OutcomeMark outcome={row.outcome} size={9} />
        <span className={`typo-eyebrow truncate ${OUTCOME_TEXT[row.outcome]}`}>{outcomeLabel(dl, row.outcome)}</span>
      </span>
    ),
    title: (row) => <span className="typo-heading text-foreground truncate block">{row.item.title}</span>,
    source: (row) => (
      <span className="flex items-baseline gap-1.5 min-w-0 typo-caption">
        <span className="shrink-0">{sourceKindLabel(dl, row.item.sourceKind)}</span>
        <span className="typo-code truncate">{row.item.sourceRef.slice(0, 8)}</span>
      </span>
    ),
    when: (row) => (
      <span className="typo-caption tabular-nums">
        <RelativeTime timestamp={row.item.occurredAt} />
      </span>
    ),
    detail: (row) =>
      row.detail
        ? <span className="typo-caption italic truncate block">{row.detail}</span>
        : <span className="typo-caption" aria-label={dl.lc_outcome_unknown}>{ABSENT}</span>,
  });
}
