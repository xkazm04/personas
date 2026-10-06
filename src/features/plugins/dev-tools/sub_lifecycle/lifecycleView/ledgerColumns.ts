/**
 * The evidence ledger's column MODEL: keys, order, widths and sorts, with the
 * CELL renderers supplied by the caller (`tactileColumns`). The model decides
 * which question the ledger answers; the cells only decide how a row is drawn.
 */
import type { ReactNode } from 'react';

import type { TableColumn } from '@/features/shared/components/display/UnifiedTable';
import type { Translations } from '@/i18n/en';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { sourceKindLabel } from '../journey/journeyLabels';
import type { EvidenceRow } from './blocks/evidenceRows';

/** Worst first: a sort on Outcome asks what went wrong. */
const SEVERITY: Record<LifecycleOutcome, number> = { failed: 0, skipped: 1, unknown: 2, done: 3 };

export interface LedgerCells {
  outcome: (row: EvidenceRow) => ReactNode;
  title: (row: EvidenceRow) => ReactNode;
  source: (row: EvidenceRow) => ReactNode;
  when: (row: EvidenceRow) => ReactNode;
  detail: (row: EvidenceRow) => ReactNode;
}

export function ledgerColumns(t: Translations, cells: LedgerCells): TableColumn<EvidenceRow>[] {
  const dl = t.plugins.dev_lifecycle;
  return [
    {
      key: 'outcome',
      label: t.overview.cockpit.fact_outcome,
      width: 'minmax(120px, 0.5fr)',
      sortable: true,
      sortFn: (a, b) => SEVERITY[a.outcome] - SEVERITY[b.outcome],
      render: cells.outcome,
    },
    {
      key: 'title',
      label: t.overview.memory_table.title,
      width: 'minmax(200px, 1.5fr)',
      sortable: true,
      sortFn: (a, b) => a.item.title.localeCompare(b.item.title),
      render: cells.title,
    },
    {
      key: 'source',
      label: t.overview.cockpit.col_source,
      width: 'minmax(150px, 0.7fr)',
      sortable: true,
      sortFn: (a, b) => sourceKindLabel(dl, a.item.sourceKind).localeCompare(sourceKindLabel(dl, b.item.sourceKind)),
      render: cells.source,
    },
    {
      key: 'when',
      label: t.triggers.col_time,
      width: 'minmax(120px, 0.6fr)',
      sortable: true,
      sortFn: (a, b) => a.item.occurredAt.localeCompare(b.item.occurredAt),
      render: cells.when,
    },
    {
      key: 'detail',
      label: t.overview.cockpit.col_detail,
      width: 'minmax(160px, 1fr)',
      render: cells.detail,
    },
  ];
}
