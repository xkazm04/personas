/**
 * Column model for the evidence ledger (UnifiedTable). Extracted from the block
 * so the block stays at orchestration altitude, the way
 * `overview/sub_events/components/eventLogColumns.tsx` does it.
 *
 * The rows are the snapshot's evidence window joined to ONE step: each row is a
 * change, and the Outcome / Detail cells are that change's outcome FOR THE
 * SELECTED STEP. A change that recorded nothing for the step reads `unknown`
 * and an absence mark, never `done` and never a zero.
 *
 * The column model is skin-invariant on purpose: a variant may change the
 * table's density, height, frame and row accent (`EvidenceLedger` reads those
 * from the skin), but never a column, an order or a sort - that would be a
 * different surface, not a different look.
 *
 * VISUAL REBUILD, 2026-10-06. Two defects of the version this replaces:
 *  - the Outcome cell switched TYPE STEP by value: `typo-body` (--type-1) for
 *    `done` and `typo-label` (--type-0) for everything else. One column, two cap
 *    heights, so the ledger's ink was ragged inside a row rhythm the table was
 *    holding perfectly (Gate 2b). It is one step now, and the emphasis is weight
 *    - which is also the only real weight step this font has.
 *  - the source ref was `font-mono opacity-70`: a raw family and transparency
 *    standing in for the type scale. It is `typo-code`, the token that already
 *    means "a monospace identifier", which carries its own size and features.
 *
 * ONE EMPHASIS PER ROW (Gate 3b): when the outcome is bad it is the loud thing,
 * tinted and semibold; when it is `done` the title carries the row and the
 * outcome recedes to normal weight.
 */
import type { Translations } from '@/i18n/en';
import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { outcomeLabel, sourceKindGlyph, sourceKindLabel } from '../../journey/journeyLabels';
import { OUTCOME_DOT, OUTCOME_TEXT } from '../../journey/journeyStyles';
import type { EvidenceRow } from './evidenceRows';

/** Nothing was recorded. A mark, so the cell is visibly empty rather than looking like a value. */
const ABSENT = '·';

/**
 * Sort severity, worst first: a sort on Outcome is a question about what went
 * wrong, so `failed` leads and `done` trails. `unknown` sits above `done`
 * because an unobserved step is not a passed one.
 */
const SEVERITY: Record<LifecycleOutcome, number> = { failed: 0, skipped: 1, unknown: 2, done: 3 };

export function evidenceColumns(t: Translations): TableColumn<EvidenceRow>[] {
  const dl = t.plugins.dev_lifecycle;
  return [
    {
      key: 'outcome',
      label: t.overview.cockpit.fact_outcome,
      width: 'minmax(120px, 0.5fr)',
      sortable: true,
      sortFn: (a, b) => SEVERITY[a.outcome] - SEVERITY[b.outcome],
      render: (row) => (
        <span className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${OUTCOME_DOT[row.outcome]}`} aria-hidden />
          <span
            className={`typo-body truncate ${OUTCOME_TEXT[row.outcome]} ${row.outcome === 'done' ? '' : 'font-semibold'}`}
          >
            {outcomeLabel(dl, row.outcome)}
          </span>
        </span>
      ),
    },
    {
      key: 'title',
      label: t.overview.memory_table.title,
      width: 'minmax(200px, 1.5fr)',
      sortable: true,
      sortFn: (a, b) => a.item.title.localeCompare(b.item.title),
      render: (row) => <span className="typo-body text-foreground truncate block">{row.item.title}</span>,
    },
    {
      key: 'source',
      label: t.overview.cockpit.col_source,
      width: 'minmax(150px, 0.7fr)',
      sortable: true,
      sortFn: (a, b) => sourceKindLabel(dl, a.item.sourceKind).localeCompare(sourceKindLabel(dl, b.item.sourceKind)),
      render: (row) => {
        const Glyph = sourceKindGlyph(row.item.sourceKind);
        return (
          <span className="flex items-center gap-1.5 min-w-0 typo-caption">
            <Glyph className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">{sourceKindLabel(dl, row.item.sourceKind)}</span>
            <span className="typo-code truncate">{row.item.sourceRef.slice(0, 8)}</span>
          </span>
        );
      },
    },
    {
      key: 'when',
      label: t.triggers.col_time,
      width: 'minmax(120px, 0.6fr)',
      sortable: true,
      sortFn: (a, b) => a.item.occurredAt.localeCompare(b.item.occurredAt),
      render: (row) => (
        <span className="typo-caption tabular-nums">
          <RelativeTime timestamp={row.item.occurredAt} />
        </span>
      ),
    },
    {
      key: 'detail',
      label: t.overview.cockpit.col_detail,
      width: 'minmax(160px, 1fr)',
      render: (row) =>
        row.detail
          ? <span className="typo-caption truncate block">{row.detail}</span>
          : <span className="typo-caption" aria-label={dl.lc_outcome_unknown}>{ABSENT}</span>,
    },
  ];
}
